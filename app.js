const CONFIG = {
  spawnIntervalMs: 1400,
  hotWordIntervalMs: 28000,
  pressureCheckMs: 1200,
  maxLanes: 10,
  initialLanes: 6,
  minActiveLanes: 6,
  rates: {
    coldSignal: 0.0167,
    hotSignal: 0.0833,
    hotNoise: 0.54,
  },
  hotWordFiles: {
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
  detained: document.getElementById('detainedCount'),
  missed: document.getElementById('missedCount'),
  selectedMeta: document.getElementById('selectedMeta'),
  selectedText: document.getElementById('selectedText'),
  detainBtn: document.getElementById('detainBtn'),
  releaseBtn: document.getElementById('releaseBtn'),
  log: document.getElementById('log'),
  briefing: document.getElementById('briefingOverlay'),
  startBtn: document.getElementById('startGameBtn'),
};

const mobileQuery = window.matchMedia('(max-width: 700px)');

const game = {
  currentHotWord: '',
  basePool: [],
  hotPools: {},
  laneSlots: [],
  activeLanes: new Map(),
  hotWordOrder: [],
  hotWordIndex: 0,
  selectedLaneId: null,
  detainedCount: 0,
  missedCount: 0,
  started: false,
  timers: {
    spawnTimeout: null,
    hotWordInterval: null,
    pressureInterval: null,
  },
};

function sanitizeLines(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((line) => typeof line === 'string')
    .map((line) => line.trim())
    .filter(Boolean);
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function choose(list, fallback = '') {
  if (!Array.isArray(list) || list.length === 0) return fallback;
  return list[randomInt(list.length)] ?? fallback;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateMetrics() {
  dom.pressure.textContent = String(game.activeLanes.size);
  dom.detained.textContent = String(game.detainedCount);
  dom.missed.textContent = String(game.missedCount);
}

function appendAudit(line) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} // ${line}`;
  dom.log.prepend(item);
  while (dom.log.children.length > 18) {
    dom.log.removeChild(dom.log.lastChild);
  }
}

function renderLineWithHighlight(text) {
  const normalized = typeof text === 'string' ? text : String(text ?? '');
  if (!game.currentHotWord) return normalized;
  const rx = new RegExp(`(${escapeRegExp(game.currentHotWord)})`, 'ig');
  return normalized.replace(rx, '<span class="hot">$1</span>');
}

function clearSelection() {
  game.selectedLaneId = null;
  document.body.classList.remove('focus-mode', 'decision-open');

  for (const lane of game.activeLanes.values()) {
    lane.slot.classList.remove('selected');
  }

  dom.selectedMeta.textContent = 'No channel selected. Click a moving lane to isolate and review.';
  dom.selectedText.textContent = '--';
  dom.detainBtn.disabled = true;
  dom.releaseBtn.disabled = true;
}

function selectLane(id) {
  const lane = game.activeLanes.get(id);
  if (!lane) return;

  game.selectedLaneId = id;
  document.body.classList.add('focus-mode');
  if (mobileQuery.matches) {
    document.body.classList.add('decision-open');
  }

  for (const laneObj of game.activeLanes.values()) {
    laneObj.slot.classList.toggle('selected', laneObj.id === id);
  }

  dom.selectedMeta.textContent = `${lane.meta} // case ambiguous // action required before timeout`;
  dom.selectedText.innerHTML = renderLineWithHighlight(lane.text);
  dom.detainBtn.disabled = false;
  dom.releaseBtn.disabled = false;
}

function resetSlot(slot) {
  slot.classList.remove('active', 'selected');
  slot.classList.add('slot-empty');
  slot.dataset.id = '';
  slot.querySelector('.lane-meta').textContent = 'idle channel';
  const text = slot.querySelector('.lane-text');
  text.textContent = '...';
  text.style.animation = 'none';
}

function removeLane(id, reason) {
  const lane = game.activeLanes.get(id);
  if (!lane) return;

  if (lane.signal && (reason === 'timeout' || reason === 'evicted')) {
    game.missedCount += 1;
  }

  if (game.selectedLaneId === id) {
    if (reason === 'timeout') {
      appendAudit(`LOST ${lane.meta} // lane timed out before decision`);
    }
    clearSelection();
  }

  resetSlot(lane.slot);
  game.activeLanes.delete(id);
}

function resolveSelection(action) {
  const laneId = game.selectedLaneId;
  if (!laneId) return;

  const lane = game.activeLanes.get(laneId);
  if (!lane) {
    clearSelection();
    return;
  }

  if (action === 'detain') {
    game.detainedCount += 1;
    appendAudit(`DETAINED ${lane.meta} // ${lane.signal ? 'possible operational lead' : 'likely hot-word noise'}`);
  } else if (lane.signal) {
    game.missedCount += 1;
    appendAudit(`RELEASED ${lane.meta} // potential lead missed`);
  } else {
    appendAudit(`RELEASED ${lane.meta} // chatter remains unverified`);
  }

  removeLane(laneId, 'resolved');
  updateMetrics();
}

function seedSlots() {
  for (let i = 0; i < CONFIG.maxLanes; i += 1) {
    const slot = dom.laneTemplate.content.firstElementChild.cloneNode(true);
    const textEl = slot.querySelector('.lane-text');

    slot.dataset.slotIndex = String(i);
    resetSlot(slot);

    slot.addEventListener('click', () => {
      const id = slot.dataset.id;
      if (id) selectLane(id);
    });

    textEl.addEventListener('animationend', () => {
      const id = slot.dataset.id;
      if (!id) return;
      if (!game.activeLanes.has(id)) return;
      removeLane(id, 'timeout');
      updateMetrics();
    });

    dom.stream.append(slot);
    game.laneSlots.push(slot);
  }
}

function findTargetSlot() {
  const empty = game.laneSlots.find((slot) => !slot.dataset.id);
  if (empty) return empty;

  let oldest = null;
  for (const lane of game.activeLanes.values()) {
    if (!oldest || lane.createdAt < oldest.createdAt) {
      oldest = lane;
    }
  }

  if (oldest) {
    appendAudit(`EVICTED ${oldest.meta} // queue cap enforced`);
    removeLane(oldest.id, 'evicted');
    return oldest.slot;
  }

  return game.laneSlots[0];
}

function buildExpandedSignals(hotWord) {
  const out = new Set(SIGNAL_FRAGMENTS);
  const connectors = [' then ', ' and ', ' but ', '. '];

  for (let i = 0; out.size < 120; i += 1) {
    const a = SIGNAL_FRAGMENTS[i % SIGNAL_FRAGMENTS.length];
    const b = SIGNAL_FRAGMENTS[(i * 3 + 7) % SIGNAL_FRAGMENTS.length];
    const c = SIGNAL_FRAGMENTS[(i * 5 + 11) % SIGNAL_FRAGMENTS.length];

    out.add(`${a}${connectors[i % connectors.length]}${b}`);
    if (i % 2 === 0) out.add(`${a}. ${c}`);
    if (i % 3 === 0) out.add(`${b} around the ${hotWord}`);
  }

  while (out.size < 150) {
    out.add(`${choose(SIGNAL_FRAGMENTS)}. ${choose(SIGNAL_FRAGMENTS)} near the ${hotWord}`);
  }

  return [...out].slice(0, 150);
}

function injectHotWord(line, hotWord) {
  if (line.toLowerCase().includes(hotWord.toLowerCase())) return line;
  const pos = Math.floor(line.length * (0.3 + Math.random() * 0.45));
  return `${line.slice(0, pos)} ${hotWord} ${line.slice(pos)}`;
}

function mutateWithDonor(host, donor) {
  if (Math.random() > 0.4) return host;

  const donorParts = donor.split(/[,.!?;]/).map((p) => p.trim()).filter(Boolean);
  const insert = choose(donorParts);
  if (!insert) return host;

  const cut = Math.max(12, Math.floor(host.length * (0.35 + Math.random() * 0.34)));
  return `${host.slice(0, cut).trim()} ${insert}. ${host.slice(cut).trim()}`;
}

function generateNoiseLine(forceHotWord) {
  const hotPool = game.hotPools[game.currentHotWord] ?? [];
  const basePool = game.basePool;
  const sourcePool = Math.random() < 0.65 && hotPool.length ? hotPool : basePool;

  const host = choose(sourcePool, 'nothing to report');
  const donor = choose(basePool, host);
  const mutated = mutateWithDonor(host, donor);

  return forceHotWord ? injectHotWord(mutated, game.currentHotWord) : mutated;
}

function generateHotSignalLine() {
  const stealth = choose(buildExpandedSignals(game.currentHotWord));
  if (Math.random() < 0.55) {
    return injectHotWord(stealth, game.currentHotWord);
  }

  const template = choose(SIGNAL_TEMPLATES).replace('{word}', game.currentHotWord);
  return `${stealth}. ${template}`;
}

function generateColdSignalLine() {
  const stealth = choose(buildExpandedSignals(game.currentHotWord));
  const rx = new RegExp(escapeRegExp(game.currentHotWord), 'ig');
  return stealth.replace(rx, 'that place').replace(/\s{2,}/g, ' ').trim();
}

function generateLanePayload() {
  const roll = Math.random();
  const { coldSignal, hotSignal, hotNoise } = CONFIG.rates;

  if (roll < coldSignal) {
    return { signal: true, text: generateColdSignalLine() };
  }

  if (roll < coldSignal + hotSignal) {
    return { signal: true, text: generateHotSignalLine() };
  }

  if (roll < coldSignal + hotSignal + hotNoise) {
    return { signal: false, text: generateNoiseLine(true) };
  }

  return { signal: false, text: generateNoiseLine(false) };
}

function maintainLanePressure() {
  const deficit = CONFIG.minActiveLanes - game.activeLanes.size;
  if (deficit <= 0) return;

  const refillCount = Math.min(deficit, 2);
  for (let i = 0; i < refillCount; i += 1) {
    spawnLane();
  }
}

function activateSlot(slot, payload) {
  const laneId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const laneNumber = randomInt(9) + 1;
  const confidence = randomInt(44) + 51;
  const source = Math.random() < 0.5 ? 'domestic scrape' : 'merchant log';
  const meta = `CH-${laneNumber} / source=${source} / confidence=${confidence}%`;

  const textEl = slot.querySelector('.lane-text');

  slot.classList.remove('slot-empty');
  slot.classList.add('active');
  slot.dataset.id = laneId;
  slot.querySelector('.lane-meta').textContent = meta;

  textEl.style.animation = 'none';
  textEl.innerHTML = renderLineWithHighlight(payload.text);
  void textEl.offsetWidth;
  textEl.style.animation = `slide-left ${16 + Math.random() * 12}s linear forwards`;

  game.activeLanes.set(laneId, {
    id: laneId,
    meta,
    text: payload.text,
    signal: payload.signal,
    createdAt: Date.now(),
    slot,
  });
}

function spawnLane() {
  if (!game.currentHotWord) rotateHotWord();
  const slot = findTargetSlot();
  const payload = generateLanePayload();
  activateSlot(slot, payload);
  updateMetrics();
}

function rotateHotWord() {
  if (!game.hotWordOrder.length || game.hotWordIndex >= game.hotWordOrder.length) {
    game.hotWordOrder = shuffle(Object.keys(CONFIG.hotWordFiles));
    game.hotWordIndex = 0;
  }

  if (!game.hotWordOrder.length) {
    throw new Error('No hot words configured');
  }

  game.currentHotWord = game.hotWordOrder[game.hotWordIndex];
  game.hotWordIndex += 1;
  dom.hotWord.textContent = game.currentHotWord;
  appendAudit(`Priority lexeme rotated: ${game.currentHotWord}`);
}

function queueSpawnLoop() {
  clearTimeout(game.timers.spawnTimeout);
  game.timers.spawnTimeout = setTimeout(() => {
    try {
      spawnLane();
    } catch (error) {
      appendAudit(`SPAWN LOOP ERROR: ${error.message}`);
    } finally {
      queueSpawnLoop();
    }
  }, CONFIG.spawnIntervalMs);
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

async function loadChatterPools() {
  const [baseData, packEntries] = await Promise.all([
    loadJson('./secret_police_chatter_merged.json'),
    Promise.all(Object.entries(CONFIG.hotWordFiles).map(async ([word, path]) => [word, await loadJson(path)])),
  ]);

  game.basePool = sanitizeLines(baseData.all);
  game.hotPools = Object.fromEntries(packEntries.map(([word, lines]) => [word, sanitizeLines(lines)]));
}

function onViewportChange(event) {
  if (!event.matches) {
    document.body.classList.remove('decision-open');
    return;
  }

  if (game.selectedLaneId) {
    document.body.classList.add('decision-open');
  }
}

async function startGame() {
  if (game.started) return;
  game.started = true;

  if (dom.startBtn) {
    dom.startBtn.disabled = true;
    dom.startBtn.removeEventListener('click', startGame);
  }

  if (dom.briefing) {
    dom.briefing.remove();
  }
  document.body.classList.remove('pre-briefing');
  appendAudit('Boot sequence started');

  try {
    await loadChatterPools();

    seedSlots();
    rotateHotWord();
    updateMetrics();

    for (let i = 0; i < CONFIG.initialLanes; i += 1) {
      spawnLane();
    }

    game.timers.hotWordInterval = setInterval(() => {
      try {
        rotateHotWord();
      } catch (error) {
        appendAudit(`HOTWORD LOOP ERROR: ${error.message}`);
      }
    }, CONFIG.hotWordIntervalMs);
    game.timers.pressureInterval = setInterval(() => {
      try {
        maintainLanePressure();
      } catch (error) {
        appendAudit(`PRESSURE LOOP ERROR: ${error.message}`);
      }
    }, CONFIG.pressureCheckMs);
    queueSpawnLoop();
  } catch (error) {
    game.started = false;
    appendAudit(`BOOT FAILURE: ${error.message}`);
    dom.selectedMeta.textContent = 'Prototype failed to load content files.';

    if (dom.startBtn) {
      dom.startBtn.disabled = false;
      dom.startBtn.addEventListener('click', startGame);
    }
  }
}

function wireUi() {
  document.body.classList.add('pre-briefing');
  dom.startBtn.addEventListener('click', startGame);

  dom.detainBtn.addEventListener('click', () => resolveSelection('detain'));
  dom.releaseBtn.addEventListener('click', () => resolveSelection('release'));

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', onViewportChange);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(onViewportChange);
  }
}

wireUi();
