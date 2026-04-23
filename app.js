const SPAWN_EVERY_MS = 1400;
const ROTATE_HOTWORD_EVERY_MS = 28000;
const LANE_COUNT = 10;

const HOTWORD_FILES = {
  acorn: './acorn_chatter_50.json',
  awning: './awning_chatter_50.json',
  cinder: './cinder_chatter_50.json',
  cobblestone: './cobblestone_chatter_50.json',
  culvert: './culvert_chatter_50.json',
  expat: './expat_chatter_50.json',
  latch: './latch_chatter_50.json',
  rookie: './rookie_chatter_50.json',
  spigot: './spigot_chatter_50.json',
  threshold: './threshold_chatter_50.json',
  wick: './wick_chatter_50.json',
};

const RATES = {
  coldSignal: 0.008,
  hotSignal: 0.045,
  hotNoise: 0.34,
};

const authoredSignalTemplates = [
  'keep the {word} note off main thread. use the blue van route after midnight.',
  'change meeting point past the {word}. no phones, no repeats.',
  'stash key in the {word} housing then switch bags at north lot.',
  'if patrol stays loud use {word} path. burn this and stay quiet.',
  'merchant gate is watched. pivot to {word} side and confirm package drop.',
];

const signalSeeds = [
  'same as before just later if they are still up',
  'use the side one if it stays quiet over there',
  'not both just the smaller one this time',
  'leave it there if it still looks clear',
  'same way as last time but do not stop',
  'if he answers fast then fine if not leave it',
  'wait a bit first if there is still movement',
  'do not use the front unless you have to',
  'same place just not in the same order',
  'if the lights are on keep going for now',
  'bring less than last time and do not improvise',
  'not that one the other one if it is there',
  'if it feels off back out and wait',
  'same setup just do not leave anything this time',
  'later is better if they are still around',
  'do the quiet part first then get out',
  'if she stays up skip it and move on',
  'do not call when you are close just wait',
  'same route should still work if it is clear',
  'leave early enough that you do not rush it',
];

const dom = {
  stream: document.getElementById('stream'),
  laneTemplate: document.getElementById('laneTemplate'),
  hotWord: document.getElementById('hotWord'),
  pressure: document.getElementById('pressure'),
  detained: document.getElementById('detainedCount'),
  missed: document.getElementById('missedCount'),
  selectedMeta: document.getElementById('selectedMeta'),
  selectedText: document.getElementById('selectedText'),
  detainBtn: document.getElementById('detainBtn'),
  releaseBtn: document.getElementById('releaseBtn'),
  log: document.getElementById('log'),
  overlay: document.getElementById('briefingOverlay'),
  startBtn: document.getElementById('startGameBtn'),
};

const runtime = {
  hotWord: '',
  baseLines: [],
  packs: {},
  lanesById: new Map(),
  slotEls: [],
  selectedId: null,
  detained: 0,
  missed: 0,
  spawnTimer: null,
  rotateTimer: null,
};

const mobileMq = window.matchMedia('(max-width: 700px)');

function safeArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function randIndex(length) {
  return Math.floor(Math.random() * length);
}

function sample(list, fallback = '') {
  if (!Array.isArray(list) || list.length === 0) return fallback;
  return list[randIndex(list.length)];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recordAudit(message) {
  const row = document.createElement('li');
  row.textContent = `${new Date().toLocaleTimeString()} // ${message}`;
  dom.log.prepend(row);

  while (dom.log.children.length > 18) {
    dom.log.removeChild(dom.log.lastChild);
  }
}

function refreshMetrics() {
  dom.pressure.textContent = String(runtime.lanesById.size);
  dom.detained.textContent = String(runtime.detained);
  dom.missed.textContent = String(runtime.missed);
}

function emphasizeHotWord(text) {
  const term = runtime.hotWord || '';
  if (!term) return text;
  const matcher = new RegExp(`(${escapeRegex(term)})`, 'ig');
  return text.replace(matcher, '<span class="hot">$1</span>');
}

function ensureContainsHotWord(text, hotWord) {
  if (!hotWord) return text;
  if (text.toLowerCase().includes(hotWord.toLowerCase())) return text;
  const at = Math.floor(text.length * (0.25 + Math.random() * 0.5));
  return `${text.slice(0, at)} ${hotWord} ${text.slice(at)}`;
}

function spliceWithDonor(host, donor) {
  if (Math.random() > 0.4) return host;
  const donorChunks = donor.split(/[,.!?;:]/).map((part) => part.trim()).filter(Boolean);
  if (!donorChunks.length) return host;

  const piece = sample(donorChunks, '');
  if (!piece) return host;

  const splitAt = Math.max(10, Math.floor(host.length * (0.35 + Math.random() * 0.3)));
  return `${host.slice(0, splitAt).trim()} ${piece}. ${host.slice(splitAt).trim()}`.trim();
}

function buildSignalPool(hotWord) {
  const output = new Set(signalSeeds);
  const joins = [' and ', ' then ', ' but ', '. '];

  for (let i = 0; output.size < 120; i += 1) {
    const a = signalSeeds[i % signalSeeds.length];
    const b = signalSeeds[(i * 3 + 1) % signalSeeds.length];
    const c = signalSeeds[(i * 5 + 2) % signalSeeds.length];
    output.add(`${a}${joins[i % joins.length]}${b}`);
    if (i % 2 === 0) output.add(`${a}. ${c}`);
    if (i % 3 === 0) output.add(`${b} around the ${hotWord}`);
  }

  while (output.size < 150) {
    output.add(`${sample(signalSeeds)}. ${sample(signalSeeds)} near the ${hotWord}`);
  }

  return [...output];
}

function generateNoiseLine(forceHotWord) {
  const hotPack = runtime.packs[runtime.hotWord] || [];
  const base = runtime.baseLines;

  const primaryPool = Math.random() < 0.65 && hotPack.length ? hotPack : base;
  const host = sample(primaryPool, sample(base, 'nothing to report'));
  const donor = sample(base, host);

  const stitched = spliceWithDonor(host, donor);
  return forceHotWord ? ensureContainsHotWord(stitched, runtime.hotWord) : stitched;
}

function generateHotSignalLine() {
  const stealth = sample(buildSignalPool(runtime.hotWord), 'stay quiet and move late');
  if (Math.random() < 0.55) {
    return ensureContainsHotWord(stealth, runtime.hotWord);
  }

  const authored = sample(authoredSignalTemplates, 'use the {word} route and avoid calls')
    .replace('{word}', runtime.hotWord);
  return `${stealth}. ${authored}`;
}

function generateColdSignalLine() {
  const stealth = sample(buildSignalPool(runtime.hotWord), 'same as before only later');
  const matcher = new RegExp(escapeRegex(runtime.hotWord), 'ig');
  return stealth.replace(matcher, 'that place').replace(/\s{2,}/g, ' ').trim();
}

function createLanePayload() {
  const roll = Math.random();
  const coldCeiling = RATES.coldSignal;
  const hotSignalCeiling = RATES.coldSignal + RATES.hotSignal;
  const hotNoiseCeiling = RATES.coldSignal + RATES.hotSignal + RATES.hotNoise;

  if (roll < coldCeiling) {
    return { signal: true, text: generateColdSignalLine() };
  }
  if (roll < hotSignalCeiling) {
    return { signal: true, text: generateHotSignalLine() };
  }
  if (roll < hotNoiseCeiling) {
    return { signal: false, text: generateNoiseLine(true) };
  }
  return { signal: false, text: generateNoiseLine(false) };
}

function deselectLane() {
  runtime.selectedId = null;
  document.body.classList.remove('focus-mode', 'decision-open');

  runtime.lanesById.forEach((lane) => lane.slot.classList.remove('selected'));

  dom.selectedMeta.textContent = 'No channel selected. Click a moving lane to isolate and review.';
  dom.selectedText.textContent = '--';
  dom.detainBtn.disabled = true;
  dom.releaseBtn.disabled = true;
}

function selectLane(id) {
  const lane = runtime.lanesById.get(id);
  if (!lane) return;

  runtime.selectedId = id;
  document.body.classList.add('focus-mode', 'decision-open');

  runtime.lanesById.forEach((entry) => {
    entry.slot.classList.toggle('selected', entry.id === id);
  });

  dom.selectedMeta.textContent = `${lane.meta} // case ambiguous // action required before timeout`;
  dom.selectedText.innerHTML = emphasizeHotWord(lane.text);
  dom.detainBtn.disabled = false;
  dom.releaseBtn.disabled = false;
}

function resetSlot(slot) {
  slot.classList.remove('active', 'selected');
  slot.classList.add('slot-empty');
  slot.dataset.id = '';
  slot.querySelector('.lane-meta').textContent = 'idle channel';
  const laneText = slot.querySelector('.lane-text');
  laneText.textContent = '...';
  laneText.style.animation = 'none';
}

function removeLane(id, reason) {
  const lane = runtime.lanesById.get(id);
  if (!lane) return;

  if (lane.signal && (reason === 'timeout' || reason === 'evicted')) {
    runtime.missed += 1;
  }

  if (runtime.selectedId === id) {
    if (reason === 'timeout') {
      recordAudit(`LOST ${lane.meta} // lane timed out before decision`);
    }
    deselectLane();
  }

  resetSlot(lane.slot);
  runtime.lanesById.delete(id);
}

function resolveSelected(action) {
  if (!runtime.selectedId) return;
  const lane = runtime.lanesById.get(runtime.selectedId);
  if (!lane) {
    deselectLane();
    return;
  }

  if (action === 'detain') {
    runtime.detained += 1;
    recordAudit(`DETAINED ${lane.meta} // ${lane.signal ? 'possible operational lead' : 'likely hot-word noise'}`);
  } else if (lane.signal) {
    runtime.missed += 1;
    recordAudit(`RELEASED ${lane.meta} // potential lead missed`);
  } else {
    recordAudit(`RELEASED ${lane.meta} // chatter remains unverified`);
  }

  removeLane(lane.id, 'resolved');
  refreshMetrics();
}

function oldestLane() {
  return [...runtime.lanesById.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
}

function claimSlot() {
  const openSlot = runtime.slotEls.find((slot) => !slot.dataset.id);
  if (openSlot) return openSlot;

  const oldest = oldestLane();
  if (oldest) {
    recordAudit(`EVICTED ${oldest.meta} // queue cap enforced`);
    removeLane(oldest.id, 'evicted');
    return oldest.slot;
  }

  return runtime.slotEls[0];
}

function mountLane(slot, payload) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const channel = Math.floor(Math.random() * 9) + 1;
  const meta = `CH-${channel} / source=${Math.random() < 0.5 ? 'domestic scrape' : 'merchant log'} / confidence=${Math.floor(Math.random() * 44) + 51}%`;

  slot.classList.remove('slot-empty');
  slot.classList.add('active');
  slot.dataset.id = id;
  slot.querySelector('.lane-meta').textContent = meta;

  const laneText = slot.querySelector('.lane-text');
  laneText.style.animation = 'none';
  laneText.innerHTML = emphasizeHotWord(payload.text);
  void laneText.offsetWidth;
  laneText.style.animation = `slide-left ${16 + Math.random() * 12}s linear forwards`;

  runtime.lanesById.set(id, {
    id,
    meta,
    text: payload.text,
    signal: payload.signal,
    createdAt: Date.now(),
    slot,
  });
}

function spawnLane() {
  if (!runtime.hotWord) rotateHotWord();
  const payload = createLanePayload();
  const slot = claimSlot();
  mountLane(slot, payload);
  refreshMetrics();
}

function rotateHotWord() {
  const words = Object.keys(HOTWORD_FILES);
  if (!words.length) throw new Error('No hot-word packs configured');

  runtime.hotWord = sample(words, words[0]);
  dom.hotWord.textContent = runtime.hotWord;
  recordAudit(`Priority lexeme rotated: ${runtime.hotWord}`);
}

function buildLaneSlots() {
  for (let i = 0; i < LANE_COUNT; i += 1) {
    const slot = dom.laneTemplate.content.firstElementChild.cloneNode(true);
    const laneText = slot.querySelector('.lane-text');

    slot.dataset.slot = String(i);
    resetSlot(slot);

    slot.addEventListener('click', () => {
      const id = slot.dataset.id;
      if (id) selectLane(id);
    });

    laneText.addEventListener('animationend', () => {
      const id = slot.dataset.id;
      if (id && runtime.lanesById.has(id)) {
        removeLane(id, 'timeout');
        refreshMetrics();
      }
    });

    dom.stream.appendChild(slot);
    runtime.slotEls.push(slot);
  }
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function loadContent() {
  const [baseData, packs] = await Promise.all([
    fetchJson('./secret_police_chatter_merged.json'),
    Promise.all(
      Object.entries(HOTWORD_FILES).map(async ([word, file]) => [word, await fetchJson(file)])
    ),
  ]);

  runtime.baseLines = safeArray(baseData.all);
  runtime.packs = Object.fromEntries(
    packs.map(([word, entries]) => [word, safeArray(entries)])
  );
}

function onViewportChange(event) {
  if (!event.matches) {
    document.body.classList.remove('decision-open');
  } else if (runtime.selectedId) {
    document.body.classList.add('decision-open');
  }
}

function startLoops() {
  runtime.spawnTimer = window.setInterval(spawnLane, SPAWN_EVERY_MS);
  runtime.rotateTimer = window.setInterval(rotateHotWord, ROTATE_HOTWORD_EVERY_MS);
}

async function startGame() {
  try {
    dom.startBtn.removeEventListener('click', startGame);
    dom.overlay.remove();
    document.body.classList.remove('pre-briefing');

    await loadContent();
    buildLaneSlots();
    rotateHotWord();
    refreshMetrics();

    for (let i = 0; i < 6; i += 1) {
      spawnLane();
    }

    startLoops();
  } catch (error) {
    recordAudit(`BOOT FAILURE: ${error.message}`);
    dom.selectedMeta.textContent = 'Prototype failed to load content files.';
  }
}

function init() {
  document.body.classList.add('pre-briefing');
  dom.detainBtn.addEventListener('click', () => resolveSelected('detain'));
  dom.releaseBtn.addEventListener('click', () => resolveSelected('release'));

  if (typeof mobileMq.addEventListener === 'function') {
    mobileMq.addEventListener('change', onViewportChange);
  } else if (typeof mobileMq.addListener === 'function') {
    mobileMq.addListener(onViewportChange);
  }

  dom.startBtn.addEventListener('click', startGame);
}

init();
