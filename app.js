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
const FALSE_POSITIVE_RATE = 0.9;
const TRUE_SIGNAL_RATE = 0.045;

const state = {
  currentHotWord: '',
  chatterBase: [],
  chatterPacks: {},
  slots: [],
  selectedLaneId: null,
  detained: 0,
  missedSignal: 0,
  spawnCursor: 0,
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

function activePressure() {
  return state.slots.filter((slot) => slot.active).length;
}

function renderMetric() {
  pressureEl.textContent = String(activePressure());
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
  document.body.classList.remove('decision-open');
  for (const slot of state.slots) {
    slot.el.classList.remove('selected');
  }
  selectedMetaEl.textContent = 'No channel selected. Click a moving lane to isolate and review.';
  selectedTextEl.textContent = '--';
  detainBtn.disabled = true;
  releaseBtn.disabled = true;
}

function selectLane(laneId) {
  const slot = state.slots.find((lane) => lane.activeId === laneId);
  if (!slot || !slot.active) {
    return;
  }

  state.selectedLaneId = laneId;
  document.body.classList.add('focus-mode');
  if (mobileQuery.matches) {
    document.body.classList.add('decision-open');
  }

  for (const laneSlot of state.slots) {
    laneSlot.el.classList.toggle('selected', laneSlot.activeId === laneId);
  }

  selectedMetaEl.textContent = `${slot.meta} // case ambiguous // action required before timeout`;
  selectedTextEl.innerHTML = renderLaneText(slot.text);
  detainBtn.disabled = false;
  releaseBtn.disabled = false;
}

function markSlotInactive(slot) {
  slot.active = false;
  slot.activeId = null;
  slot.text = '';
  slot.signal = false;
  slot.createdAt = 0;
  slot.meta = 'channel idle';
  slot.metaEl.textContent = slot.meta;
  slot.textEl.innerHTML = '';
}

function resolveLane(action) {
  const id = state.selectedLaneId;
  if (!id) {
    return;
  }

  const slot = state.slots.find((lane) => lane.activeId === id);
  if (!slot || !slot.active) {
    clearSelection();
    return;
  }

  if (action === 'detain') {
    state.detained += 1;
    addAudit(`DETAINED ${slot.meta} // ${slot.signal ? 'possible operational lead' : 'likely hot-word noise'}`);
  } else if (slot.signal) {
    state.missedSignal += 1;
    addAudit(`RELEASED ${slot.meta} // potential lead missed`);
  } else {
    addAudit(`RELEASED ${slot.meta} // chatter remains unverified`);
  }

  markSlotInactive(slot);
  clearSelection();
  renderMetric();
}

function replaceAnimatedText(slot, html, durationSeconds, laneId) {
  const newTextNode = slot.textEl.cloneNode(false);
  newTextNode.innerHTML = html;
  newTextNode.style.animationDuration = `${durationSeconds}s`;

  newTextNode.addEventListener('animationend', () => {
    if (!slot.active || slot.activeId !== laneId) {
      return;
    }

    if (state.selectedLaneId === laneId) {
      addAudit(`LOST ${slot.meta} // lane scrolled off before decision`);
      if (slot.signal) {
        state.missedSignal += 1;
      }
      clearSelection();
    }

    markSlotInactive(slot);
    renderMetric();
  });

  slot.textEl.replaceWith(newTextNode);
  slot.textEl = newTextNode;
}

function spawnLane() {
  const laneData = pickMessage();
  const laneId = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const laneNumber = Math.floor(Math.random() * 9) + 1;
  const meta = `CH-${laneNumber} / source=${Math.random() < 0.5 ? 'domestic scrape' : 'merchant log'} / confidence=${Math.floor(Math.random() * 44) + 51}%`;

  const slot = state.slots[state.spawnCursor];
  state.spawnCursor = (state.spawnCursor + 1) % state.slots.length;

  if (slot.active) {
    if (slot.activeId === state.selectedLaneId) {
      addAudit(`MISSED ${slot.meta} // replaced by incoming queue`);
      if (slot.signal) {
        state.missedSignal += 1;
      }
      clearSelection();
    }
  }

  slot.active = true;
  slot.activeId = laneId;
  slot.signal = laneData.signal;
  slot.text = laneData.text;
  slot.createdAt = Date.now();
  slot.meta = meta;
  slot.metaEl.textContent = meta;

  replaceAnimatedText(slot, renderLaneText(laneData.text), 16 + Math.random() * 12, laneId);
  renderMetric();
}

function rotateHotWord() {
  state.currentHotWord = SUPPORTED_HOT_WORDS[Math.floor(Math.random() * SUPPORTED_HOT_WORDS.length)];
  hotWordEl.textContent = state.currentHotWord;
  addAudit(`Priority lexeme rotated: ${state.currentHotWord}`);
}

function initSlots() {
  for (let i = 0; i < MAX_LANES; i += 1) {
    const laneEl = laneTemplate.content.firstElementChild.cloneNode(true);
    const metaEl = laneEl.querySelector('.lane-meta');
    const textEl = laneEl.querySelector('.lane-text');

    metaEl.textContent = 'channel idle';
    textEl.innerHTML = '';
    laneEl.addEventListener('click', () => {
      const slot = state.slots[i];
      if (slot?.active && slot.activeId) {
        selectLane(slot.activeId);
      }
    });

    streamEl.append(laneEl);
    state.slots.push({
      el: laneEl,
      metaEl,
      textEl,
      active: false,
      activeId: null,
      signal: false,
      text: '',
      createdAt: 0,
      meta: 'channel idle',
    });
  }
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

  initSlots();
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
