const HOT_WORD_INTERVAL_MS = 28000;
const SPAWN_INTERVAL_MS = 1400;
const MAX_LANES = 12;

const streamEl = document.getElementById('stream');
const laneTemplate = document.getElementById('laneTemplate');
const hotWordEl = document.getElementById('hotWord');
const pressureEl = document.getElementById('pressure');
const detainedCountEl = document.getElementById('detainedCount');
const missedCountEl = document.getElementById('missedCount');
const selectedMetaEl = document.getElementById('selectedMeta');
const selectedTextEl = document.getElementById('selectedText');
const detainBtn = document.getElementById('detainBtn');
const releaseBtn = document.getElementById('releaseBtn');
const logEl = document.getElementById('log');

const SUPPORTED_HOT_WORDS = ['culvert', 'latch', 'threshold', 'cinder', 'spigot'];
const FALSE_POSITIVE_RATE = 0.9;
const TRUE_SIGNAL_RATE = 0.045;

const state = {
  currentHotWord: '',
  chatterBase: [],
  chatterPacks: {},
  lanes: new Map(),
  selectedLaneId: null,
  detained: 0,
  missedSignal: 0,
};

const trueSignalTemplates = [
  'keep the {word} note off main thread. use the blue van route after midnight.',
  'change meeting point past the {word}. no phones, no repeats.',
  'stash key in the {word} housing then switch bags at north lot.',
  'if patrol stays loud use {word} path. burn this and stay quiet.',
  'merchant gate is watched. pivot to {word} side and confirm package drop.'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderMetric() {
  pressureEl.textContent = String(state.lanes.size);
  detainedCountEl.textContent = String(state.detained);
  missedCountEl.textContent = String(state.missedSignal);
}

function addAudit(text) {
  const row = document.createElement('li');
  row.textContent = `${new Date().toLocaleTimeString()} // ${text}`;
  logEl.prepend(row);
  while (logEl.children.length > 18) {
    logEl.removeChild(logEl.lastChild);
  }
}

function maybeCorruptLine(host, donor) {
  if (Math.random() > 0.4) {
    return host;
  }
  const donorParts = donor.split(/[,.!?;]/).filter(Boolean);
  const donorHalf = donorParts[Math.floor(Math.random() * donorParts.length)]?.trim();
  if (!donorHalf) {
    return host;
  }
  const cut = Math.max(12, Math.floor(host.length * (0.35 + Math.random() * 0.34)));
  return `${host.slice(0, cut).trim()} ${donorHalf}. ${host.slice(cut).trim()}`;
}

function withHotWord(text, hotWord) {
  if (text.toLowerCase().includes(hotWord.toLowerCase())) {
    return text;
  }
  const insertPoint = Math.floor(text.length * (0.3 + Math.random() * 0.45));
  return `${text.slice(0, insertPoint)} ${hotWord} ${text.slice(insertPoint)}`;
}

function pickNoiseMessage() {
  const hotWordPack = state.chatterPacks[state.currentHotWord] ?? [];
  const source = Math.random() < 0.8 && hotWordPack.length ? hotWordPack : state.chatterBase;
  const host = source[Math.floor(Math.random() * source.length)] ?? 'nothing to report';
  const donor = state.chatterBase[Math.floor(Math.random() * state.chatterBase.length)] ?? host;
  const mutated = maybeCorruptLine(host, donor);

  return Math.random() < FALSE_POSITIVE_RATE
    ? withHotWord(mutated, state.currentHotWord)
    : mutated;
}

function pickTrueSignalMessage() {
  const template = trueSignalTemplates[Math.floor(Math.random() * trueSignalTemplates.length)];
  return template.replace('{word}', state.currentHotWord);
}

function pickMessage() {
  const signal = Math.random() < TRUE_SIGNAL_RATE;
  const text = signal ? pickTrueSignalMessage() : pickNoiseMessage();
  return { signal, text };
}

function renderLaneText(text) {
  const pattern = new RegExp(`(${escapeRegExp(state.currentHotWord)})`, 'ig');
  return text.replace(pattern, '<span class="hot">$1</span>');
}

function clearSelection() {
  state.selectedLaneId = null;
  document.body.classList.remove('focus-mode');
  for (const laneObj of state.lanes.values()) {
    laneObj.el.classList.remove('selected');
  }
  selectedMetaEl.textContent = 'No channel selected. Click a moving lane to isolate and review.';
  selectedTextEl.textContent = '--';
  detainBtn.disabled = true;
  releaseBtn.disabled = true;
}

function selectLane(id) {
  const lane = state.lanes.get(id);
  if (!lane) {
    return;
  }
  state.selectedLaneId = id;
  document.body.classList.add('focus-mode');
  for (const [laneId, laneObj] of state.lanes) {
    laneObj.el.classList.toggle('selected', laneId === id);
  }
  selectedMetaEl.textContent = `${lane.meta} // case ambiguous // action required before timeout`;
  selectedTextEl.innerHTML = renderLaneText(lane.text);
  detainBtn.disabled = false;
  releaseBtn.disabled = false;
}

function resolveLane(action) {
  const id = state.selectedLaneId;
  if (!id) {
    return;
  }
  const lane = state.lanes.get(id);
  if (!lane) {
    clearSelection();
    return;
  }

  if (action === 'detain') {
    state.detained += 1;
    addAudit(`DETAINED ${lane.meta} // ${lane.signal ? 'possible operational lead' : 'likely hot-word noise'}`);
  } else {
    if (lane.signal) {
      state.missedSignal += 1;
      addAudit(`RELEASED ${lane.meta} // potential lead missed`);
    } else {
      addAudit(`RELEASED ${lane.meta} // chatter remains unverified`);
    }
  }

  lane.el.remove();
  state.lanes.delete(id);
  clearSelection();
  renderMetric();
}

function spawnLane() {
  if (state.lanes.size >= MAX_LANES) {
    const oldest = [...state.lanes.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) {
      if (oldest.id === state.selectedLaneId) {
        addAudit(`MISSED ${oldest.meta} // conversation lost in queue overflow`);
      }
      if (oldest.signal) {
        state.missedSignal += 1;
      }
      oldest.el.remove();
      state.lanes.delete(oldest.id);
    }
  }

  const laneData = pickMessage();
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const laneNumber = Math.floor(Math.random() * 9) + 1;
  const meta = `CH-${laneNumber} / source=${Math.random() < 0.5 ? 'domestic scrape' : 'merchant log'} / confidence=${Math.floor(Math.random() * 44) + 51}%`;

  const laneEl = laneTemplate.content.firstElementChild.cloneNode(true);
  laneEl.dataset.id = id;
  laneEl.querySelector('.lane-meta').textContent = meta;

  const laneTextEl = laneEl.querySelector('.lane-text');
  laneTextEl.innerHTML = renderLaneText(laneData.text);
  laneTextEl.style.animationDuration = `${16 + Math.random() * 12}s`;

  laneEl.addEventListener('click', () => selectLane(id));

  laneTextEl.addEventListener('animationend', () => {
    if (state.selectedLaneId === id) {
      addAudit(`LOST ${meta} // lane scrolled off before decision`);
      if (laneData.signal) {
        state.missedSignal += 1;
      }
      clearSelection();
    }
    if (state.lanes.has(id)) {
      laneEl.remove();
      state.lanes.delete(id);
      renderMetric();
    }
  });

  streamEl.prepend(laneEl);
  state.lanes.set(id, { id, text: laneData.text, signal: laneData.signal, createdAt: Date.now(), el: laneEl, meta });
  renderMetric();
}

function rotateHotWord() {
  state.currentHotWord = SUPPORTED_HOT_WORDS[Math.floor(Math.random() * SUPPORTED_HOT_WORDS.length)];
  hotWordEl.textContent = state.currentHotWord;
  addAudit(`Priority lexeme rotated: ${state.currentHotWord}`);
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function bootstrap() {
  const [baseData, culvertPack, latchPack, thresholdPack, cinderPack, spigotPack] = await Promise.all([
    loadJson('./secret_police_chatter_merged.json'),
    loadJson('./culvert_chatter_50.json'),
    loadJson('./latch_chatter_50.json'),
    loadJson('./threshold_chatter_50.json'),
    loadJson('./cinder_chatter_50.json'),
    loadJson('./spigot_chatter_50.json'),
  ]);

  state.chatterBase = baseData.all;
  state.chatterPacks = {
    culvert: culvertPack,
    latch: latchPack,
    threshold: thresholdPack,
    cinder: cinderPack,
    spigot: spigotPack,
  };

  rotateHotWord();
  renderMetric();
  for (let i = 0; i < 8; i += 1) {
    spawnLane();
  }

  setInterval(spawnLane, SPAWN_INTERVAL_MS);
  setInterval(rotateHotWord, HOT_WORD_INTERVAL_MS);
}

detainBtn.addEventListener('click', () => resolveLane('detain'));
releaseBtn.addEventListener('click', () => resolveLane('release'));

bootstrap().catch((error) => {
  addAudit(`BOOT FAILURE: ${error.message}`);
  selectedMetaEl.textContent = 'Prototype failed to load content files.';
});
