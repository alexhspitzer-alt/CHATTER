const HOT_WORD_INTERVAL_MS = 28000;
const SPAWN_INTERVAL_MS = 1400;
const MAX_LANES = 10;

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
const mobileQuery = window.matchMedia('(max-width: 700px)');

const SUPPORTED_HOT_WORDS = ['culvert', 'latch', 'threshold', 'cinder', 'spigot'];
const HOT_CHATTER_RATE = 0.34;
const HOT_SIGNAL_RATE = 0.045;
const COLD_SIGNAL_RATE = 0.008;

const state = {
  currentHotWord: '',
  chatterBase: [],
  chatterPacks: {},
  lanes: new Map(),
  slots: [],
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

const seedSignalFragments = [
  'same as before just later if they\'re still up',
  'use the side one if it stays quiet over there',
  'not both just the smaller one this time',
  'leave it there if it still looks clear',
  'same way as last time but dont stop',
  'if he answers fast then fine if not leave it',
  'wait a bit first if theres still movement',
  'dont use the front unless you have to',
  'same place just not in the same order',
  'if the lights are on keep going for now',
  'bring less than last time and dont improvise',
  'not that one the other one if its there',
  'if it feels off just back out and wait',
  'same setup just dont leave anything this time',
  'later is better if theyre still around',
  'do the quiet part first then get out',
  'if she stays up skip it and move on',
  'dont call when youre close just wait',
  'same route should still work if its clear',
  'leave early enough that you dont rush it'
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


function buildExpandedSignals(hotWord) {
  const expanded = new Set();
  const connectors = [' then ', ' and ', ' but ', '. '];

  seedSignalFragments.forEach((line) => expanded.add(line));

  for (let i = 0; expanded.size < 120; i += 1) {
    const a = seedSignalFragments[i % seedSignalFragments.length];
    const b = seedSignalFragments[(i * 3 + 7) % seedSignalFragments.length];
    const c = seedSignalFragments[(i * 5 + 11) % seedSignalFragments.length];
    const joiner = connectors[i % connectors.length];

    expanded.add(`${a}${joiner}${b}`);
    if (i % 2 === 0) {
      expanded.add(`${a}. ${c}`);
    }
    if (i % 3 === 0) {
      expanded.add(`${b} around the ${hotWord}`);
    }
  }

  while (expanded.size < 150) {
    const a = seedSignalFragments[Math.floor(Math.random() * seedSignalFragments.length)];
    const b = seedSignalFragments[Math.floor(Math.random() * seedSignalFragments.length)];
    expanded.add(`${a}. ${b} near the ${hotWord}`);
  }

  return [...expanded].slice(0, 150);
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

function pickNoiseMessage(forceHotWord = false) {
  const hotWordPack = state.chatterPacks[state.currentHotWord] ?? [];
  const source = Math.random() < 0.65 && hotWordPack.length ? hotWordPack : state.chatterBase;
  const host = source[Math.floor(Math.random() * source.length)] ?? 'nothing to report';
  const donor = state.chatterBase[Math.floor(Math.random() * state.chatterBase.length)] ?? host;
  const mutated = maybeCorruptLine(host, donor);

  return forceHotWord ? withHotWord(mutated, state.currentHotWord) : mutated;
}

function pickTrueSignalMessage() {
  const expandedSignals = buildExpandedSignals(state.currentHotWord);
  const stealthSignal = expandedSignals[Math.floor(Math.random() * expandedSignals.length)];

  if (Math.random() < 0.55) {
    return withHotWord(stealthSignal, state.currentHotWord);
  }

  const template = trueSignalTemplates[Math.floor(Math.random() * trueSignalTemplates.length)]
    .replace('{word}', state.currentHotWord);
  return `${stealthSignal}. ${template}`;
}


function pickColdSignalMessage() {
  const expandedSignals = buildExpandedSignals(state.currentHotWord);
  const stealthSignal = expandedSignals[Math.floor(Math.random() * expandedSignals.length)];
  const hotWordPattern = new RegExp(escapeRegExp(state.currentHotWord), 'ig');
  return stealthSignal
    .replace(hotWordPattern, 'that place')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pickMessage() {
  const roll = Math.random();

  if (roll < COLD_SIGNAL_RATE) {
    return { signal: true, text: pickColdSignalMessage() };
  }

  if (roll < COLD_SIGNAL_RATE + HOT_SIGNAL_RATE) {
    return { signal: true, text: pickTrueSignalMessage() };
  }

  if (roll < COLD_SIGNAL_RATE + HOT_SIGNAL_RATE + HOT_CHATTER_RATE) {
    return { signal: false, text: pickNoiseMessage(true) };
  }

  return { signal: false, text: pickNoiseMessage(false) };
}

function renderLaneText(text) {
  const pattern = new RegExp(`(${escapeRegExp(state.currentHotWord)})`, 'ig');
  return text.replace(pattern, '<span class="hot">$1</span>');
}

function clearSelection() {
  state.selectedLaneId = null;
  document.body.classList.remove('focus-mode');
  document.body.classList.remove('decision-open');
  for (const laneObj of state.lanes.values()) {
    laneObj.slot.classList.remove('selected');
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
  if (mobileQuery.matches) {
    document.body.classList.add('decision-open');
  }

  for (const laneObj of state.lanes.values()) {
    laneObj.slot.classList.toggle('selected', laneObj.id === id);
  }

  selectedMetaEl.textContent = `${lane.meta} // case ambiguous // action required before timeout`;
  selectedTextEl.innerHTML = renderLaneText(lane.text);
  detainBtn.disabled = false;
  releaseBtn.disabled = false;
}

function resetSlot(slot) {
  slot.classList.remove('selected', 'active');
  slot.classList.add('slot-empty');
  slot.dataset.id = '';
  slot.querySelector('.lane-meta').textContent = 'idle channel';
  const laneTextEl = slot.querySelector('.lane-text');
  laneTextEl.textContent = '...';
  laneTextEl.style.animation = 'none';
}

function removeLaneById(id, reason) {
  const lane = state.lanes.get(id);
  if (!lane) {
    return;
  }
  if (lane.signal && (reason === 'evicted' || reason === 'timeout')) {
    state.missedSignal += 1;
  }
  if (state.selectedLaneId === id) {
    if (reason === 'timeout') {
      addAudit(`LOST ${lane.meta} // lane timed out before decision`);
    }
    clearSelection();
  }
  resetSlot(lane.slot);
  state.lanes.delete(id);
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
  } else if (lane.signal) {
    state.missedSignal += 1;
    addAudit(`RELEASED ${lane.meta} // potential lead missed`);
  } else {
    addAudit(`RELEASED ${lane.meta} // chatter remains unverified`);
  }

  removeLaneById(id, 'resolved');
  renderMetric();
}

function buildSlots() {
  for (let i = 0; i < MAX_LANES; i += 1) {
    const slot = laneTemplate.content.firstElementChild.cloneNode(true);
    const textEl = slot.querySelector('.lane-text');

    slot.classList.add('slot-empty');
    slot.dataset.slotIndex = String(i);
    resetSlot(slot);

    slot.addEventListener('click', () => {
      const laneId = slot.dataset.id;
      if (laneId) {
        selectLane(laneId);
      }
    });

    textEl.addEventListener('animationend', () => {
      const laneId = slot.dataset.id;
      if (laneId && state.lanes.has(laneId)) {
        removeLaneById(laneId, 'timeout');
        renderMetric();
      }
    });

    streamEl.append(slot);
    state.slots.push(slot);
  }
}

function pickAvailableSlot() {
  const empty = state.slots.find((slot) => !slot.dataset.id);
  if (empty) {
    return empty;
  }

  const oldest = [...state.lanes.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
  if (oldest) {
    addAudit(`EVICTED ${oldest.meta} // queue cap enforced`);
    removeLaneById(oldest.id, 'evicted');
    return oldest.slot;
  }
  return state.slots[0];
}

function activateSlot(slot, laneData) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const laneNumber = Math.floor(Math.random() * 9) + 1;
  const meta = `CH-${laneNumber} / source=${Math.random() < 0.5 ? 'domestic scrape' : 'merchant log'} / confidence=${Math.floor(Math.random() * 44) + 51}%`;

  slot.classList.add('active');
  slot.classList.remove('slot-empty');
  slot.dataset.id = id;
  slot.querySelector('.lane-meta').textContent = meta;

  const textEl = slot.querySelector('.lane-text');
  textEl.style.animation = 'none';
  textEl.innerHTML = renderLaneText(laneData.text);
  void textEl.offsetWidth;
  textEl.style.animation = `slide-left ${16 + Math.random() * 12}s linear forwards`;

  state.lanes.set(id, {
    id,
    meta,
    text: laneData.text,
    signal: laneData.signal,
    createdAt: Date.now(),
    slot,
  });
}

function spawnLane() {
  const laneData = pickMessage();
  const slot = pickAvailableSlot();
  activateSlot(slot, laneData);
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

  buildSlots();
  rotateHotWord();
  renderMetric();

  for (let i = 0; i < 6; i += 1) {
    spawnLane();
  }

  setInterval(spawnLane, SPAWN_INTERVAL_MS);
  setInterval(rotateHotWord, HOT_WORD_INTERVAL_MS);
}

detainBtn.addEventListener('click', () => resolveLane('detain'));
releaseBtn.addEventListener('click', () => resolveLane('release'));

mobileQuery.addEventListener('change', (event) => {
  if (!event.matches) {
    document.body.classList.remove('decision-open');
  } else if (state.selectedLaneId) {
    document.body.classList.add('decision-open');
  }
});

bootstrap().catch((error) => {
  addAudit(`BOOT FAILURE: ${error.message}`);
  selectedMetaEl.textContent = 'Prototype failed to load content files.';
});
