const CONFIG = {
  spawnEveryMs: 1400,
  hotWordRotateEveryMs: 28000,
  maxLanes: 10,
  initialLanes: 6,
  hotNoiseRate: 0.34,
  hotSignalRate: 0.045,
  coldSignalRate: 0.008,
  maxAuditRows: 18,
  hotWordPacks: {
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
  },
};

const SIGNAL_TEMPLATES = [
  'keep the {word} note off main thread. use the blue van route after midnight.',
  'change meeting point past the {word}. no phones, no repeats.',
  'stash key in the {word} housing then switch bags at north lot.',
  'if patrol stays loud use {word} path. burn this and stay quiet.',
  'merchant gate is watched. pivot to {word} side and confirm package drop.',
];

const SIGNAL_FRAGMENTS = [
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
  'leave early enough that you dont rush it',
];

const dom = {
  stream: document.getElementById('stream'),
  laneTemplate: document.getElementById('laneTemplate'),
  hotWord: document.getElementById('hotWord'),
  pressure: document.getElementById('pressure'),
  detainedCount: document.getElementById('detainedCount'),
  missedCount: document.getElementById('missedCount'),
  selectedMeta: document.getElementById('selectedMeta'),
  selectedText: document.getElementById('selectedText'),
  detainBtn: document.getElementById('detainBtn'),
  releaseBtn: document.getElementById('releaseBtn'),
  auditLog: document.getElementById('log'),
  briefingOverlay: document.getElementById('briefingOverlay'),
  startBtn: document.getElementById('startGameBtn'),
};

const appState = {
  lanesById: new Map(),
  slots: [],
  selectedId: null,
  currentHotWord: null,
  detained: 0,
  missedSignals: 0,
  baseLines: [],
  hotWordLines: {},
  timers: [],
};

function normalizeLines(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function randomItem(items, fallback = '') {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Unable to load ${path}`);
  }
  return response.json();
}

function writeAudit(message) {
  const row = document.createElement('li');
  row.textContent = `${new Date().toLocaleTimeString()} // ${message}`;
  dom.auditLog.prepend(row);

  while (dom.auditLog.children.length > CONFIG.maxAuditRows) {
    dom.auditLog.removeChild(dom.auditLog.lastChild);
  }
}

function updateStatusPanel() {
  dom.hotWord.textContent = appState.currentHotWord ?? '--';
  dom.pressure.textContent = String(appState.lanesById.size);
  dom.detainedCount.textContent = String(appState.detained);
  dom.missedCount.textContent = String(appState.missedSignals);
}

function clearSelection() {
  appState.selectedId = null;
  document.body.classList.remove('focus-mode', 'decision-open');

  for (const lane of appState.lanesById.values()) {
    lane.slot.classList.remove('selected');
  }

  dom.selectedMeta.textContent = 'No channel selected. Click a moving lane to isolate and review.';
  dom.selectedText.textContent = '--';
  dom.detainBtn.disabled = true;
  dom.releaseBtn.disabled = true;
}

function paintLine(text) {
  const safe = typeof text === 'string' ? text : String(text ?? '');
  if (!appState.currentHotWord) {
    return safe;
  }

  const needle = new RegExp(`(${escapeRegex(appState.currentHotWord)})`, 'ig');
  return safe.replace(needle, '<span class="hot">$1</span>');
}

function selectLane(id) {
  const lane = appState.lanesById.get(id);
  if (!lane) {
    return;
  }

  appState.selectedId = id;
  document.body.classList.add('focus-mode', 'decision-open');

  for (const item of appState.lanesById.values()) {
    item.slot.classList.toggle('selected', item.id === id);
  }

  dom.selectedMeta.textContent = `${lane.meta} // case ambiguous // action required before timeout`;
  dom.selectedText.innerHTML = paintLine(lane.text);
  dom.detainBtn.disabled = false;
  dom.releaseBtn.disabled = false;
}

function resetSlot(slot) {
  slot.classList.remove('active', 'selected');
  slot.classList.add('slot-empty');
  slot.dataset.id = '';
  slot.querySelector('.lane-meta').textContent = 'idle channel';

  const textEl = slot.querySelector('.lane-text');
  textEl.textContent = '...';
  textEl.style.animation = 'none';
}

function removeLane(id, reason = 'resolved') {
  const lane = appState.lanesById.get(id);
  if (!lane) {
    return;
  }

  if ((reason === 'timeout' || reason === 'evicted') && lane.signal) {
    appState.missedSignals += 1;
  }

  if (appState.selectedId === id) {
    if (reason === 'timeout') {
      writeAudit(`LOST ${lane.meta} // lane timed out before decision`);
    }
    clearSelection();
  }

  resetSlot(lane.slot);
  appState.lanesById.delete(id);
}

function resolveSelection(action) {
  const id = appState.selectedId;
  if (!id) {
    return;
  }

  const lane = appState.lanesById.get(id);
  if (!lane) {
    clearSelection();
    return;
  }

  if (action === 'detain') {
    appState.detained += 1;
    writeAudit(`DETAINED ${lane.meta} // ${lane.signal ? 'possible operational lead' : 'likely hot-word noise'}`);
  } else if (lane.signal) {
    appState.missedSignals += 1;
    writeAudit(`RELEASED ${lane.meta} // potential lead missed`);
  } else {
    writeAudit(`RELEASED ${lane.meta} // chatter remains unverified`);
  }

  removeLane(id, 'resolved');
  updateStatusPanel();
}

function createSlots() {
  for (let i = 0; i < CONFIG.maxLanes; i += 1) {
    const slot = dom.laneTemplate.content.firstElementChild.cloneNode(true);
    const textEl = slot.querySelector('.lane-text');

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
      if (laneId && appState.lanesById.has(laneId)) {
        removeLane(laneId, 'timeout');
        updateStatusPanel();
      }
    });

    dom.stream.appendChild(slot);
    appState.slots.push(slot);
  }
}

function availableSlot() {
  const empty = appState.slots.find((slot) => !slot.dataset.id);
  if (empty) {
    return empty;
  }

  const oldest = [...appState.lanesById.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
  if (oldest) {
    writeAudit(`EVICTED ${oldest.meta} // queue cap enforced`);
    removeLane(oldest.id, 'evicted');
    return oldest.slot;
  }

  return appState.slots[0];
}

function rotateHotWord() {
  const words = Object.keys(CONFIG.hotWordPacks);
  if (words.length === 0) {
    throw new Error('No hot words configured');
  }

  appState.currentHotWord = randomItem(words, words[0]);
  writeAudit(`Priority lexeme rotated: ${appState.currentHotWord}`);
  updateStatusPanel();
}

function synthesizeSignalVariants(word) {
  const variants = new Set();
  const joins = [' then ', ' and ', ' but ', '. '];

  SIGNAL_FRAGMENTS.forEach((line) => variants.add(line));

  for (let i = 0; variants.size < 120; i += 1) {
    const a = SIGNAL_FRAGMENTS[i % SIGNAL_FRAGMENTS.length];
    const b = SIGNAL_FRAGMENTS[(i * 3 + 7) % SIGNAL_FRAGMENTS.length];
    const c = SIGNAL_FRAGMENTS[(i * 5 + 11) % SIGNAL_FRAGMENTS.length];

    variants.add(`${a}${joins[i % joins.length]}${b}`);
    if (i % 2 === 0) {
      variants.add(`${a}. ${c}`);
    }
    if (i % 3 === 0) {
      variants.add(`${b} around the ${word}`);
    }
  }

  while (variants.size < 150) {
    const one = randomItem(SIGNAL_FRAGMENTS);
    const two = randomItem(SIGNAL_FRAGMENTS);
    variants.add(`${one}. ${two} near the ${word}`);
  }

  return [...variants].slice(0, 150);
}

function injectHotWord(line, word) {
  if (!word || line.toLowerCase().includes(word.toLowerCase())) {
    return line;
  }

  const pivot = Math.floor(line.length * (0.3 + Math.random() * 0.45));
  return `${line.slice(0, pivot)} ${word} ${line.slice(pivot)}`;
}

function spliceWithDonor(host, donor) {
  if (Math.random() > 0.4) {
    return host;
  }

  const donorParts = donor.split(/[,.!?;]/).map((item) => item.trim()).filter(Boolean);
  const donorPart = randomItem(donorParts);
  if (!donorPart) {
    return host;
  }

  const cut = Math.max(12, Math.floor(host.length * (0.35 + Math.random() * 0.34)));
  return `${host.slice(0, cut).trim()} ${donorPart}. ${host.slice(cut).trim()}`;
}

function buildNoiseLine(forceHotWord = false) {
  const hotPool = appState.hotWordLines[appState.currentHotWord] ?? [];
  const sourcePool = hotPool.length > 0 && Math.random() < 0.65 ? hotPool : appState.baseLines;
  const host = randomItem(sourcePool, 'nothing to report');
  const donor = randomItem(appState.baseLines, host);
  const blended = spliceWithDonor(host, donor);

  return forceHotWord ? injectHotWord(blended, appState.currentHotWord) : blended;
}

function buildTrueSignalLine() {
  const variants = synthesizeSignalVariants(appState.currentHotWord);
  const stealth = randomItem(variants, 'same setup, same window');

  if (Math.random() < 0.55) {
    return injectHotWord(stealth, appState.currentHotWord);
  }

  const template = randomItem(SIGNAL_TEMPLATES, SIGNAL_TEMPLATES[0]).replace('{word}', appState.currentHotWord);
  return `${stealth}. ${template}`;
}

function buildColdSignalLine() {
  const variants = synthesizeSignalVariants(appState.currentHotWord);
  const line = randomItem(variants, 'same setup, same window');

  if (!appState.currentHotWord) {
    return line;
  }

  const pattern = new RegExp(escapeRegex(appState.currentHotWord), 'ig');
  return line.replace(pattern, 'that place').replace(/\s{2,}/g, ' ').trim();
}

function generateLanePayload() {
  const roll = Math.random();

  if (roll < CONFIG.coldSignalRate) {
    return { signal: true, text: buildColdSignalLine() };
  }

  if (roll < CONFIG.coldSignalRate + CONFIG.hotSignalRate) {
    return { signal: true, text: buildTrueSignalLine() };
  }

  if (roll < CONFIG.coldSignalRate + CONFIG.hotSignalRate + CONFIG.hotNoiseRate) {
    return { signal: false, text: buildNoiseLine(true) };
  }

  return { signal: false, text: buildNoiseLine(false) };
}

function mountLane(slot, lanePayload) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const channel = Math.floor(Math.random() * 9) + 1;
  const meta = `CH-${channel} / source=${Math.random() < 0.5 ? 'domestic scrape' : 'merchant log'} / confidence=${Math.floor(Math.random() * 44) + 51}%`;

  const textEl = slot.querySelector('.lane-text');
  const rendered = paintLine(lanePayload.text);

  slot.classList.remove('slot-empty');
  slot.classList.add('active');
  slot.dataset.id = id;
  slot.querySelector('.lane-meta').textContent = meta;

  textEl.style.animation = 'none';
  textEl.innerHTML = rendered;
  void textEl.offsetWidth;
  textEl.style.animation = `slide-left ${16 + Math.random() * 12}s linear forwards`;

  appState.lanesById.set(id, {
    id,
    slot,
    meta,
    text: lanePayload.text,
    signal: lanePayload.signal,
    createdAt: Date.now(),
  });
}

function spawnLane() {
  if (!appState.currentHotWord) {
    rotateHotWord();
  }

  const payload = generateLanePayload();
  const slot = availableSlot();
  mountLane(slot, payload);
  updateStatusPanel();
}

async function loadContent() {
  const [basePayload, packEntries] = await Promise.all([
    fetchJson('./secret_police_chatter_merged.json'),
    Promise.all(
      Object.entries(CONFIG.hotWordPacks).map(async ([word, path]) => {
        const packPayload = await fetchJson(path);
        return [word, normalizeLines(packPayload)];
      })
    ),
  ]);

  appState.baseLines = normalizeLines(basePayload.all);
  appState.hotWordLines = Object.fromEntries(packEntries);
}

function attachUiEvents() {
  dom.detainBtn.addEventListener('click', () => resolveSelection('detain'));
  dom.releaseBtn.addEventListener('click', () => resolveSelection('release'));

  const onViewportChange = (event) => {
    if (!event.matches) {
      document.body.classList.remove('decision-open');
    } else if (appState.selectedId) {
      document.body.classList.add('decision-open');
    }
  };

  const query = window.matchMedia('(max-width: 700px)');
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onViewportChange);
  } else if (typeof query.addListener === 'function') {
    query.addListener(onViewportChange);
  }
}

function startRuntimeLoops() {
  appState.timers.push(setInterval(spawnLane, CONFIG.spawnEveryMs));
  appState.timers.push(setInterval(rotateHotWord, CONFIG.hotWordRotateEveryMs));
}

async function startGame() {
  try {
    dom.startBtn.disabled = true;
    await loadContent();
    createSlots();
    clearSelection();
    rotateHotWord();

    for (let i = 0; i < CONFIG.initialLanes; i += 1) {
      spawnLane();
    }

    startRuntimeLoops();
    document.body.classList.remove('pre-briefing');
    dom.briefingOverlay.remove();
  } catch (error) {
    writeAudit(`BOOT FAILURE: ${error.message}`);
    dom.selectedMeta.textContent = 'Prototype failed to load content files.';
    dom.startBtn.disabled = false;
  }
}

function init() {
  attachUiEvents();
  document.body.classList.add('pre-briefing');
  dom.startBtn.addEventListener('click', startGame, { once: true });
}

init();
