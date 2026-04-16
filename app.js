const HOT_WORD_ROTATE_MS = 25000;
const SPAWN_INTERVAL_MS = 620;
const SIGNAL_RATE = 0.14;

const monitor = document.getElementById("monitor");
const selectedInfo = document.getElementById("selectedInfo");
const detainBtn = document.getElementById("detainBtn");
const releaseBtn = document.getElementById("releaseBtn");

const statsEls = {
  hotWord: document.getElementById("hotWord"),
  round: document.getElementById("round"),
  detains: document.getElementById("detains"),
  truePos: document.getElementById("truePos"),
  falsePos: document.getElementById("falsePos"),
  missed: document.getElementById("missed"),
};

const state = {
  hotWords: [],
  chatterPool: [],
  messages: [],
  lastSpawn: 0,
  laneCount: 11,
  hotWord: "culvert",
  round: 1,
  selectedId: null,
  score: { detains: 0, truePos: 0, falsePos: 0, missed: 0 },
};

const authoredSignalTemplates = [
  "switch from {hotWord} to spare route. no phones after 21:10.",
  "if anyone asks, {hotWord} means grill parts and nothing else.",
  "meet by old {hotWord} marker. bring two bags, leave one.",
  "stop saying {hotWord} in public channels. use garden words only.",
  "truck delayed. {hotWord} handoff moved to dawn behind service gate.",
  "we only proceed if {hotWord} text arrives from known number.",
  "burn list after transfer. {hotWord} mention means package is live.",
  "do not use main road. check {hotWord} path and avoid cameras.",
  "attendance changed. if {hotWord} appears twice, abort and scatter.",
  "same account pattern as last week. {hotWord} cluster is intentional.",
];

init();

async function init() {
  const [hotWordsJson, baseMerged, expansion] = await Promise.all([
    fetchJson("./secret_police_hot_words.json"),
    fetchJson("./secret_police_chatter_merged.json"),
    fetchJson("./secret_police_chatter_expansion_175.json"),
  ]);

  state.hotWords = shuffle((hotWordsJson.hot_words || ["culvert", "latch", "cinder"]).slice());
  state.hotWord = state.hotWords[0];

  const mergedFlat = flattenValues(baseMerged);
  const expansionFlat = flattenValues(expansion);
  state.chatterPool = [...mergedFlat, ...expansionFlat].filter(Boolean);

  updateScoreboard();
  startSchedulers();
  requestAnimationFrame(tick);
}

function fetchJson(path) {
  return fetch(path).then((res) => {
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  });
}

function flattenValues(obj) {
  if (Array.isArray(obj)) return obj;
  return Object.values(obj).flatMap((v) => (Array.isArray(v) ? v : []));
}

function startSchedulers() {
  setInterval(() => {
    state.round += 1;
    state.hotWord = state.hotWords[state.round % state.hotWords.length];
    updateScoreboard();
  }, HOT_WORD_ROTATE_MS);

  detainBtn.addEventListener("click", detainSelected);
  releaseBtn.addEventListener("click", releaseFocus);
}

function tick(ts) {
  if (ts - state.lastSpawn >= SPAWN_INTERVAL_MS) {
    spawnMessage();
    state.lastSpawn = ts;
  }

  const monitorRect = monitor.getBoundingClientRect();

  for (const msg of state.messages) {
    msg.x -= msg.speed;
    msg.el.style.transform = `translateX(${msg.x}px)`;

    if (msg.x + msg.width < 0 && !msg.resolved) {
      msg.resolved = true;
      if (msg.isSignal) {
        state.score.missed += 1;
        updateScoreboard();
      }
      if (state.selectedId === msg.id) {
        releaseFocus();
      }
      msg.el.remove();
    }
  }

  state.messages = state.messages.filter((m) => m.x + m.width >= -5);

  if (!monitorRect.width) return requestAnimationFrame(tick);
  requestAnimationFrame(tick);
}

function spawnMessage() {
  const isSignal = Math.random() < SIGNAL_RATE;
  const text = isSignal ? makeSignal() : makeNoise();
  const lane = Math.floor(Math.random() * state.laneCount);

  const el = document.createElement("div");
  el.className = `lane-message ${isSignal ? "signal" : ""}`;
  el.innerHTML = highlightHotWord(text);

  const rowHeight = monitor.clientHeight / state.laneCount;
  el.style.top = `${lane * rowHeight + 6}px`;

  monitor.appendChild(el);

  const msg = {
    id: crypto.randomUUID(),
    text,
    isSignal,
    lane,
    x: monitor.clientWidth + Math.random() * 100,
    speed: 0.7 + Math.random() * 1.2,
    width: el.getBoundingClientRect().width,
    el,
    resolved: false,
  };

  el.style.transform = `translateX(${msg.x}px)`;
  el.addEventListener("click", () => selectMessage(msg.id));

  state.messages.push(msg);
}

function makeNoise() {
  const host = pick(state.chatterPool);
  const donor = pick(state.chatterPool);

  if (Math.random() < 0.38) {
    return hostDonorCorruption(host, donor);
  }
  return host;
}

function makeSignal() {
  const template = pick(authoredSignalTemplates);
  return template.replaceAll("{hotWord}", state.hotWord);
}

function hostDonorCorruption(host, donor) {
  const donorWords = donor.split(" ");
  if (donorWords.length < 8) return host;

  const half = Math.floor(donorWords.length / 2);
  const donorSlice = donorWords.slice(half - 2, half + 4).join(" ");

  const hostWords = host.split(" ");
  const pivot = Math.max(5, Math.floor(hostWords.length * (0.35 + Math.random() * 0.35)));

  return [...hostWords.slice(0, pivot), donorSlice, ...hostWords.slice(pivot)].join(" ");
}

function highlightHotWord(text) {
  const escaped = state.hotWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${escaped}s?)\\b`, "ig");
  return text.replace(re, '<span class="hot">$1</span>');
}

function selectMessage(id) {
  state.selectedId = id;
  const msg = state.messages.find((m) => m.id === id);
  if (!msg) return;

  monitor.classList.add("dimmed");
  state.messages.forEach((m) => m.el.classList.toggle("focused", m.id === id));
  selectedInfo.innerHTML = highlightHotWord(msg.text);
  selectedInfo.style.borderColor = msg.isSignal ? "#6f4332" : "#2c3d33";

  detainBtn.disabled = false;
  releaseBtn.disabled = false;
}

function releaseFocus() {
  state.selectedId = null;
  monitor.classList.remove("dimmed");
  state.messages.forEach((m) => m.el.classList.remove("focused"));
  selectedInfo.textContent = "No conversation isolated.";
  selectedInfo.style.borderColor = "#27352c";

  detainBtn.disabled = true;
  releaseBtn.disabled = true;
}

function detainSelected() {
  if (!state.selectedId) return;

  const msg = state.messages.find((m) => m.id === state.selectedId);
  if (!msg) return releaseFocus();

  state.score.detains += 1;
  if (msg.isSignal) {
    state.score.truePos += 1;
  } else {
    state.score.falsePos += 1;
  }

  msg.resolved = true;
  msg.el.remove();
  state.messages = state.messages.filter((m) => m.id !== msg.id);

  selectedInfo.innerHTML = `<strong style="color:${msg.isSignal ? "var(--ok)" : "var(--alert)"};">${msg.isSignal ? "Detention justified" : "False certainty logged"}</strong><br/>${highlightHotWord(msg.text)}`;
  updateScoreboard();
  releaseFocus();
}

function updateScoreboard() {
  statsEls.hotWord.textContent = state.hotWord;
  statsEls.round.textContent = String(state.round);
  statsEls.detains.textContent = String(state.score.detains);
  statsEls.truePos.textContent = String(state.score.truePos);
  statsEls.falsePos.textContent = String(state.score.falsePos);
  statsEls.missed.textContent = String(state.score.missed);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
