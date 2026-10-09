/* ============================================================
   FOODMANIA — Find Your Free Food!
   script.js  |  Vanilla JavaScript game logic
   ------------------------------------------------------------
   Contents:
     1.  Tiny helpers
     2.  Sound engine (Web Audio, no external files)
     3.  Confetti effect
     4.  Screen manager
     5.  Game data (levels, foods, prizes)
     6.  Progress + reward storage (localStorage)
     7.  Level select rendering
     8.  Gameplay (room build, timer, finding foods)
     9.  Modals (pause / win / game over / reward)
     10. Lucky spin wheel
     11. Reward codes
     12. Boot / event wiring
   ============================================================ */

/* ============================================================
   1. TINY HELPERS
   ============================================================ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Random integer between min and max (inclusive). */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Random float between min and max. */
const randFloat = (min, max) => Math.random() * (max - min) + min;

/** Fisher–Yates shuffle (returns the same array, shuffled). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick n unique random items from an array. */
function sample(arr, n) {
  return shuffle(arr.slice()).slice(0, n);
}

/* ============================================================
   2. SOUND ENGINE
   All audio is synthesised with the Web Audio API so the game
   has zero external dependencies. Includes light background
   music plus short sound effects.
   ============================================================ */
const Sound = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let musicTimer = null;
  let step = 0;
  let muted = false;

  // A cheerful pentatonic melody (Hz). null = rest.
  const melody = [
    523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 880.00, 783.99,
    523.25, 659.25, 783.99, 1046.50, 880.00, 783.99, 659.25, null,
  ];
  // Simple bass line, one note every 4 steps.
  const bass = [130.81, 174.61, 196.00, 174.61];

  /** Create the audio context on first user gesture (autoplay policy). */
  function unlock() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // audio not supported — game still works silently
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85; // honour a saved mute preference
      master.connect(ctx.destination);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.10;
      musicGain.connect(master);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.35;
      sfxGain.connect(master);
    } catch (e) {
      ctx = null; // fail silently — audio is optional
    }
  }

  /** Play a single enveloped tone. */
  function tone(freq, dur, type = 'triangle', vol = 1, when = 0, dest = null, slideTo = null) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest || sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Schedule one background-music step. */
  function musicStep() {
    if (!ctx) return;
    const note = melody[step % melody.length];
    if (note) tone(note, 0.42, 'triangle', 1, 0, musicGain);
    if (step % 4 === 0) {
      const b = bass[(step / 4) % bass.length];
      tone(b, 0.5, 'sine', 0.9, 0, musicGain);
    }
    step++;
  }

  function startMusic() {
    if (!ctx || musicTimer) return;
    musicStep();
    musicTimer = setInterval(musicStep, 300);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  /** Named sound effects. */
  function sfx(name) {
    if (!ctx || muted) return;
    switch (name) {
      case 'click':   tone(660, 0.08, 'square', 0.5); break;
      case 'found':   // happy ascending arpeggio
        tone(659.25, 0.12, 'triangle', 0.9, 0);
        tone(783.99, 0.12, 'triangle', 0.9, 0.09);
        tone(1046.50, 0.22, 'triangle', 0.9, 0.18);
        break;
      case 'wrong':   tone(200, 0.22, 'sawtooth', 0.5, 0, null, 120); break;
      case 'win':     // fanfare
        [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((f, i) =>
          tone(f, 0.35, 'triangle', 0.9, i * 0.13));
        break;
      case 'lose':    tone(392, 0.3, 'triangle', 0.8, 0);
                      tone(311, 0.3, 'triangle', 0.8, 0.22);
                      tone(233, 0.5, 'triangle', 0.8, 0.44); break;
      case 'spin':    tone(300, 0.5, 'square', 0.3, 0, null, 900); break;
      case 'reward':  [659.25, 880, 1046.50, 1318.51].forEach((f, i) =>
                        tone(f, 0.4, 'sine', 0.9, i * 0.12)); break;
      case 'tick':    tone(880, 0.05, 'square', 0.25); break;
    }
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.85;
  }
  function isMuted() { return muted; }

  return { unlock, startMusic, stopMusic, sfx, setMuted, isMuted };
})();

/* ============================================================
   3. CONFETTI
   ============================================================ */
const CONFETTI_COLORS = ['#556B2F', '#6B8E23', '#8AA74E', '#E8B93C', '#ffffff', '#D9534F', '#F7D476'];

function burstConfetti(count = 120) {
  const layer = $('#confettiLayer');
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = randFloat(0, 100) + 'vw';
    piece.style.background = CONFETTI_COLORS[randInt(0, CONFETTI_COLORS.length - 1)];
    piece.style.animationDuration = randFloat(2.4, 4.5) + 's';
    piece.style.animationDelay = randFloat(0, 0.8) + 's';
    piece.style.width = randInt(7, 13) + 'px';
    piece.style.height = randInt(9, 16) + 'px';
    if (Math.random() > 0.6) piece.style.borderRadius = '50%';
    layer.appendChild(piece);
    // Clean up after the animation finishes
    setTimeout(() => piece.remove(), 5600);
  }
}

/* ============================================================
   4. SCREEN MANAGER
   ============================================================ */
const SCREENS = ['welcome', 'levels', 'game', 'spin'];
let currentScreen = 'welcome';

function showScreen(name) {
  SCREENS.forEach(s => {
    const el = $('#screen-' + s);
    if (el) el.classList.toggle('is-active', s === name);
  });
  currentScreen = name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   5. GAME DATA
   ============================================================ */
// Master food catalogue (key -> emoji + label)
const FOODS = {
  pizza:   { emoji: '🍕', name: 'Pizza' },
  burger:  { emoji: '🍔', name: 'Burger' },
  fries:   { emoji: '🍟', name: 'French Fries' },
  taco:    { emoji: '🌮', name: 'Taco' },
  donut:   { emoji: '🍩', name: 'Donut' },
  sushi:   { emoji: '🍣', name: 'Sushi' },
  hotdog:  { emoji: '🌭', name: 'Hot Dog' },
  pasta:   { emoji: '🍝', name: 'Pasta' },
  ramen:   { emoji: '🍜', name: 'Ramen' },
  salad:   { emoji: '🥗', name: 'Salad' },
  sandwich:{ emoji: '🥪', name: 'Sandwich' },
  pancake: { emoji: '🥞', name: 'Pancakes' },
  cake:    { emoji: '🍰', name: 'Cake' },
  cupcake: { emoji: '🧁', name: 'Cupcake' },
  cookie:  { emoji: '🍪', name: 'Cookie' },
  icecream:{ emoji: '🍦', name: 'Ice Cream' },
  popcorn: { emoji: '🍿', name: 'Popcorn' },
  pretzel: { emoji: '🥨', name: 'Pretzel' },
};

// Decoy foods that appear in the room but are NOT targets.
const DECOY_POOL = [
  'sushi', 'hotdog', 'pasta', 'ramen', 'salad', 'sandwich',
  'pancake', 'cake', 'cupcake', 'cookie', 'icecream', 'popcorn', 'pretzel',
];

// Level definitions. Level 1 is the fully fleshed-out challenge.
const LEVELS = [
  {
    id: 1,
    subtitle: 'Level 1',
    title: 'Food Finder',
    emoji: '🔎',
    desc: 'Find 5 hidden foods in 60 seconds.',
    time: 60,
    targets: ['pizza', 'burger', 'fries', 'taco', 'donut'],
    decoys: 10,
    thumbs: '🍕🍔🍟🌮🍩',
  },
  {
    id: 2,
    subtitle: 'Level 2',
    title: 'Master Chef',
    emoji: '👨‍🍳',
    desc: 'Find 7 hidden foods in 50 seconds.',
    time: 50,
    targets: ['pizza', 'burger', 'fries', 'taco', 'donut', 'sushi', 'ramen'],
    decoys: 11,
    thumbs: '🍕🍔🍟🌮🍩🍣🍜',
  },
  {
    id: 3,
    subtitle: 'Level 3',
    title: 'Foodmania Champion',
    emoji: '🏆',
    desc: 'Find 10 hidden foods in 45 seconds.',
    time: 45,
    targets: ['pizza', 'burger', 'fries', 'taco', 'donut', 'sushi', 'ramen',
              'cake', 'hotdog', 'icecream'],
    decoys: 12,
    thumbs: '🍕🍔🍟🌮🍩🍣🍜🍰🌭🍦',
  },
];

// Lucky spin prizes (index order matters for the wheel).
const PRIZES = [
  { label: 'Free Pizza',          emoji: '🍕', reward: 'Free Pizza' },
  { label: 'Free Burger',         emoji: '🍔', reward: 'Free Burger' },
  { label: 'Free French Fries',   emoji: '🍟', reward: 'Free French Fries' },
  { label: 'Free Donut',          emoji: '🍩', reward: 'Free Donut' },
  { label: 'Free Drink',          emoji: '🥤', reward: 'Free Drink' },
  { label: 'Free Dessert',        emoji: '🍰', reward: 'Free Dessert' },
  { label: 'Special Surprise',    emoji: '🎁', reward: 'Special Foodmania Surprise' },
  { label: 'Try Again',           emoji: '⭐', reward: null }, // null = no prize
];

// Segment colours (alternating dark/light for readability).
const SEG_COLORS = ['#6B8E23', '#FBF7EA', '#8AA74E', '#FBF7EA', '#6B8E23', '#FBF7EA', '#E8B93C', '#FBF7EA'];

/* ============================================================
   6. PROGRESS + REWARD STORAGE
   ============================================================ */
const STORE_KEYS = {
  unlocked: 'foodmania_unlocked',
  completed: 'foodmania_completed',
  rewards: 'foodmania_rewards',
  muted: 'foodmania_muted',
};

const Progress = {
  unlocked: 1,
  completed: [],   // array of completed level ids

  load() {
    try {
      this.unlocked = parseInt(localStorage.getItem(STORE_KEYS.unlocked), 10) || 1;
      this.completed = JSON.parse(localStorage.getItem(STORE_KEYS.completed) || '[]');
    } catch (e) { this.unlocked = 1; this.completed = []; }
  },
  save() {
    try {
      localStorage.setItem(STORE_KEYS.unlocked, String(this.unlocked));
      localStorage.setItem(STORE_KEYS.completed, JSON.stringify(this.completed));
    } catch (e) { /* storage may be unavailable — ignore */ }
  },
  completeLevel(id) {
    if (!this.completed.includes(id)) this.completed.push(id);
    if (id + 1 > this.unlocked && id + 1 <= LEVELS.length) this.unlocked = id + 1;
    this.save();
  },
  isUnlocked(id) { return id <= this.unlocked; },
  isCompleted(id) { return this.completed.includes(id); },
};

const Rewards = {
  list() {
    try { return JSON.parse(localStorage.getItem(STORE_KEYS.rewards) || '[]'); }
    catch (e) { return []; }
  },
  add(entry) {
    const all = this.list();
    all.unshift(entry);
    try { localStorage.setItem(STORE_KEYS.rewards, JSON.stringify(all.slice(0, 20))); }
    catch (e) { /* ignore quota errors */ }
  },
  latest() { return this.list()[0] || null; },
};

/** Generate a unique, staff-friendly reward code like FOOD-7K9P2. */
function generateRewardCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[randInt(0, chars.length - 1)];
  return 'FOOD-' + code;
}

/* ============================================================
   7. LEVEL SELECT
   ============================================================ */
function renderLevels() {
  const grid = $('#levelGrid');
  grid.innerHTML = '';

  LEVELS.forEach(level => {
    const unlocked = Progress.isUnlocked(level.id);
    const done = Progress.isCompleted(level.id);

    const card = document.createElement('article');
    card.className = 'level-card ' + (unlocked ? 'playable' : 'locked');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', unlocked ? '0' : '-1');
    card.setAttribute('aria-label', `${level.subtitle}: ${level.title}${unlocked ? '' : ' (locked)'}`);

    const statusClass = done ? 'status-done' : (unlocked ? 'status-play' : 'status-lock');
    const statusText  = done ? '✓ Completed' : (unlocked ? '▶ Play' : '🔒 Locked');

    card.innerHTML = `
      <div class="level-inner">
        <span class="level-num">${level.subtitle}</span>
        <div class="level-thumbs">${level.thumbs}</div>
        <h3>${level.emoji} ${level.title}</h3>
        <p class="level-desc">${level.desc}</p>
        <div class="level-stats">
          <div class="stat"><span>🍽️</span><small>${level.targets.length} foods</small></div>
          <div class="stat"><span>⏱️</span><small>${level.time}s</small></div>
        </div>
        <span class="level-status ${statusClass}">${statusText}</span>
      </div>
      ${unlocked ? '' : '<span class="lock-badge">🔒</span>'}
    `;

    if (unlocked) {
      const start = () => { Sound.sfx('click'); startLevel(level.id); };
      card.addEventListener('click', start);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
      });
    }
    grid.appendChild(card);
  });
}

/* ============================================================
   8. GAMEPLAY
   ============================================================ */
const Game = {
  level: null,
  found: new Set(),
  running: false,
  paused: false,
  timeLeft: 0,
  endTime: 0,
  tickId: null,

  /** Current time remaining in whole seconds. */
  remaining() {
    return Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
  },
};

function startLevel(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return;

  Game.level = level;
  Game.found = new Set();
  Game.running = false;
  Game.paused = false;

  // Header
  $('#gameLevelName').textContent = level.subtitle;
  $('#gameLevelTitle').textContent = level.emoji + ' ' + level.title;

  // Mission chips + timer display
  renderTargets(level);
  updateProgress(level);
  Game.timeLeft = level.time;
  updateTimerDisplay(level.time);

  // Show the screen first so the room has real dimensions for the grid.
  showScreen('game');
  buildRoom(level);

  // Give a moment for the entrance animation, then show START prompt.
  setTimeout(() => promptStart(level), 350);
}

/** Render the target food chips in the mission panel. */
function renderTargets(level) {
  const list = $('#targetList');
  list.innerHTML = '';
  level.targets.forEach(key => {
    const food = FOODS[key];
    const chip = document.createElement('span');
    chip.className = 'target-chip';
    chip.dataset.food = key;
    chip.innerHTML = `<span class="chip-emoji">${food.emoji}</span>
                      <span class="chip-name">${food.name}</span>
                      <span class="chip-check"></span>`;
    list.appendChild(chip);
  });
}

function updateProgress(level) {
  const total = level.targets.length;
  const found = Game.found.size;
  $('#progressCount').textContent = `${found}/${total} Foods Found`;
  $('#progressFill').style.width = (found / total * 100) + '%';
}

/** Build the clickable room: targets + decoys placed on a shuffled grid. */
function buildRoom(level) {
  const layer = $('#foodLayer');
  layer.innerHTML = '';

  // Decide grid shape from the room's current aspect ratio.
  const rect = $('#room').getBoundingClientRect();
  const tall = rect.height > rect.width;
  const cols = tall ? 5 : 7;
  const rows = tall ? 6 : 4;

  // Build the slot list then shuffle so positions change every restart.
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) slots.push({ c, r });
  }
  shuffle(slots);

  // Item list = targets + decoys (decoys = level.decoys, itself a number).
  const decoyKeys = sample(DECOY_POOL.filter(k => !level.targets.includes(k)), level.decoys);
  const items = shuffle([
    ...level.targets.map(k => ({ key: k, target: true })),
    ...decoyKeys.map(k => ({ key: k, target: false })),
  ]);

  const usedSlots = slots.slice(0, items.length);
  const cellW = 100 / cols;
  const cellH = 100 / rows;

  items.forEach((item, i) => {
    const slot = usedSlots[i];
    // Keep items inside the room with a small safe margin.
    const jitterX = randFloat(-cellW * 0.22, cellW * 0.22);
    const jitterY = randFloat(-cellH * 0.22, cellH * 0.22);
    const x = Math.min(94, Math.max(6, (slot.c + 0.5) * cellW + jitterX));
    const y = Math.min(93, Math.max(7, (slot.r + 0.5) * cellH + jitterY));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'food-item';
    btn.dataset.food = item.key;
    btn.dataset.target = item.target ? '1' : '0';
    btn.style.left = x + '%';
    btn.style.top = y + '%';
    btn.setAttribute('aria-label', 'Hidden food item');

    // Emoji sits in an inner span so the idle bob can animate independently.
    const span = document.createElement('span');
    span.className = 'food-emoji';
    span.textContent = FOODS[item.key].emoji;
    span.style.animationDelay = randFloat(0, 2.4) + 's';
    span.style.animationDuration = randFloat(2.8, 4.2) + 's';
    btn.appendChild(span);

    btn.addEventListener('click', onFoodClick);
    layer.appendChild(btn);
  });
}

/** Handle a click on any room food item. */
function onFoodClick(e) {
  if (!Game.running || Game.paused) return;

  const btn = e.currentTarget;
  const key = btn.dataset.food;
  const isTarget = btn.dataset.target === '1';

  // Already found a target in this spot — ignore.
  if (btn.classList.contains('found')) return;

  if (isTarget && !Game.found.has(key)) {
    // ---- Correct find ----
    Game.found.add(key);
    btn.classList.add('found');
    btn.disabled = true;

    playFindEffect(btn);
    Sound.sfx('found');
    markChipFound(key);
    updateProgress(Game.level);

    // Stop the timer the instant the last target is found.
    if (Game.found.size === Game.level.targets.length) {
      winLevel();
    }
  } else {
    // ---- Wrong guess ----
    btn.classList.remove('wrong');
    void btn.offsetWidth; // restart animation
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 450);
    Sound.sfx('wrong');
    showHint('Oops! That is not it — keep searching! 🔍', true);
  }
}

/** Confetti-like burst + "+1" text where a food was found. */
function playFindEffect(btn) {
  const room = $('#room');
  const x = parseFloat(btn.style.left);
  const y = parseFloat(btn.style.top);

  const ring = document.createElement('span');
  ring.className = 'burst';
  ring.style.left = x + '%';
  ring.style.top = y + '%';
  room.appendChild(ring);
  setTimeout(() => ring.remove(), 800);

  const point = document.createElement('span');
  point.className = 'float-point';
  point.textContent = '+1 FOUND!';
  point.style.left = x + '%';
  point.style.top = y + '%';
  room.appendChild(point);
  setTimeout(() => point.remove(), 1050);
}

/** Mark a target chip as found. */
function markChipFound(key) {
  const chip = $(`#targetList .target-chip[data-food="${key}"]`);
  if (chip) {
    chip.classList.add('found');
    chip.querySelector('.chip-check').textContent = '✓';
  }
}

/** Transient hint toast near the bottom of the screen. */
let hintTimer = null;
function showHint(text, warn = false) {
  const hint = $('#hint');
  hint.textContent = text;
  hint.classList.toggle('warn', warn);
  hint.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.add('hidden'), 1700);
}

/* ---------- Timer ---------- */
function startTimer() {
  const level = Game.level;
  Game.endTime = Date.now() + Game.timeLeft * 1000;
  Game.running = true;
  Game.paused = false;

  clearInterval(Game.tickId);
  Game.tickId = setInterval(() => {
    if (Game.paused) return;
    const left = Game.remaining();
    if (left !== Game.timeLeft) {
      Game.timeLeft = left;
      updateTimerDisplay(left);
      if (left <= 5 && left > 0) Sound.sfx('tick');
    }
    if (left <= 0) {
      clearInterval(Game.tickId);
      Game.tickId = null;
      loseLevel();
    }
  }, 200);

  updateTimerDisplay(Game.timeLeft);
}

function updateTimerDisplay(seconds) {
  const timerEl = $('#timer');
  const wrap = $('#timerWrap');
  timerEl.textContent = seconds;
  wrap.classList.toggle('warn', seconds <= 10 && seconds > 5);
  wrap.classList.toggle('danger', seconds <= 5);
}

function stopTimer() {
  clearInterval(Game.tickId);
  Game.tickId = null;
  Game.running = false;
}

/* ---------- Pause ---------- */
function pauseGame() {
  if (!Game.running || Game.paused) return;
  Game.paused = true;
  Game.timeLeft = Game.remaining();
  clearInterval(Game.tickId);
  Game.tickId = null;
  openPauseModal();
}

function resumeGame() {
  closeModal();
  Game.paused = false;
  startTimerFrom(Game.timeLeft);
}

/** Continue the countdown from an existing value (used after pause). */
function startTimerFrom(seconds) {
  Game.endTime = Date.now() + seconds * 1000;
  Game.running = true;
  Game.paused = false;
  clearInterval(Game.tickId);
  Game.tickId = setInterval(() => {
    if (Game.paused) return;
    const left = Game.remaining();
    if (left !== Game.timeLeft) {
      Game.timeLeft = left;
      updateTimerDisplay(left);
      if (left <= 5 && left > 0) Sound.sfx('tick');
    }
    if (left <= 0) {
      clearInterval(Game.tickId);
      Game.tickId = null;
      loseLevel();
    }
  }, 200);
}

/* ---------- Win / Lose ---------- */
function winLevel() {
  stopTimer();
  Sound.sfx('win');
  burstConfetti(160);
  Progress.completeLevel(Game.level.id);

  // Celebrate briefly, then move to the lucky spin screen.
  const total = Game.level.targets.length;
  $('#celebrateTitle').textContent = `AMAZING! YOU FOUND ALL ${total} FOODS!`;
  $('#celebrateSub').textContent = 'Congratulations! You unlocked the FOODMANIA Lucky Spin!';

  setTimeout(() => {
    resetWheel();
    showScreen('spin');
  }, 900);
}

function loseLevel() {
  stopTimer();
  Game.paused = false;
  Sound.sfx('lose');
  openLoseModal();
}

/* ============================================================
   9. MODALS
   ============================================================ */
function openModal(html) {
  $('#modalCard').innerHTML = html;
  $('#overlay').classList.remove('hidden');
}
function closeModal() {
  $('#overlay').classList.add('hidden');
  $('#modalCard').innerHTML = '';
}

/** Pre-level "START LEVEL" prompt. */
function promptStart(level) {
  openModal(`
    <div class="modal-emoji">${level.emoji}</div>
    <h3 class="modal-title">${level.title}</h3>
    <p class="modal-text">
      Find <strong>${level.targets.length} hidden foods</strong> hidden around the room
      in <strong>${level.time} seconds</strong>!<br>
      Tap the correct food items to mark them found.
    </p>
    <div class="modal-actions">
      <button class="btn btn-primary btn-xl" id="startLevelBtn">▶ START LEVEL</button>
      <button class="btn btn-ghost" id="cancelLevelBtn">Back to Levels</button>
    </div>
  `);
  $('#startLevelBtn').addEventListener('click', () => {
    Sound.unlock();
    Sound.sfx('click');
    closeModal();
    Game.timeLeft = level.time;
    updateTimerDisplay(level.time);
    startTimer();
  });
  $('#cancelLevelBtn').addEventListener('click', () => {
    Sound.sfx('click');
    closeModal();
    goToLevels();
  });
}

function openPauseModal() {
  openModal(`
    <div class="modal-emoji">⏸️</div>
    <h3 class="modal-title">Game Paused</h3>
    <p class="modal-text">Take a breather — the food isn't going anywhere. 😄</p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="resumeBtn">▶ Resume</button>
      <button class="btn btn-ghost" id="restartBtn">↻ Restart Level</button>
      <button class="btn btn-ghost" id="pauseLevelsBtn">Back to Levels</button>
    </div>
  `);
  $('#resumeBtn').addEventListener('click', () => { Sound.sfx('click'); resumeGame(); });
  $('#restartBtn').addEventListener('click', () => { Sound.sfx('click'); closeModal(); startLevel(Game.level.id); });
  $('#pauseLevelsBtn').addEventListener('click', () => { Sound.sfx('click'); closeModal(); goToLevels(); });
}

function openLoseModal() {
  openModal(`
    <div class="modal-emoji">⏰</div>
    <h3 class="modal-title">Time's Up!</h3>
    <p class="modal-text">
      You found <strong>${Game.found.size}/${Game.level.targets.length}</strong> foods.
      So close — give it another try!
    </p>
    <div class="modal-actions">
      <button class="btn btn-primary btn-xl" id="tryAgainBtn">↻ TRY AGAIN</button>
      <button class="btn btn-ghost" id="loseLevelsBtn">Back to Levels</button>
    </div>
  `);
  $('#tryAgainBtn').addEventListener('click', () => { Sound.sfx('click'); closeModal(); startLevel(Game.level.id); });
  $('#loseLevelsBtn').addEventListener('click', () => { Sound.sfx('click'); closeModal(); goToLevels(); });
}

/* ============================================================
   10. LUCKY SPIN WHEEL
   ============================================================ */
const Spin = {
  built: false,
  rotation: 0,
  spinning: false,
  used: false,
};

/** Draw the wheel segments + labels (once). */
function buildWheel() {
  const wheel = $('#wheel');
  wheel.innerHTML = '';
  const n = PRIZES.length;
  const seg = 360 / n;

  // Background wedges
  const stops = PRIZES.map((_, i) => {
    const color = SEG_COLORS[i % SEG_COLORS.length];
    return `${color} ${i * seg}deg ${(i + 1) * seg}deg`;
  }).join(', ');
  wheel.style.background = `conic-gradient(from 0deg, ${stops})`;

  // Labels, positioned along each segment's centre angle.
  PRIZES.forEach((prize, i) => {
    const center = i * seg + seg / 2;
    const dark = SEG_COLORS[i % SEG_COLORS.length] !== '#FBF7EA';

    const holder = document.createElement('div');
    holder.className = 'wheel-seg';
    holder.style.transform = `rotate(${center}deg)`;

    const content = document.createElement('div');
    content.className = 'seg-content ' + (dark ? 'on-dark' : 'on-light');
    content.style.transform = `translateX(-50%) rotate(${-center}deg)`;
    content.innerHTML = `<span class="seg-emoji">${prize.emoji}</span><span>${prize.label}</span>`;

    holder.appendChild(content);
    wheel.appendChild(holder);
  });

  Spin.built = true;
}

/** Reset the spin button so a fresh game can spin once. */
function resetWheel() {
  if (!Spin.built) buildWheel();
  Spin.used = false;
  Spin.spinning = false;
  const btn = $('#spinBtn');
  btn.disabled = false;
  btn.textContent = 'SPIN & WIN!';
}

/**
 * Perform a spin.
 * The winning prize is chosen with REAL JavaScript logic (random index),
 * then the wheel is rotated so that the chosen segment lands under the pointer.
 */
function spinWheel() {
  if (Spin.spinning || Spin.used) return;
  Spin.spinning = true;
  Spin.used = true;

  const btn = $('#spinBtn');
  btn.disabled = true;
  btn.textContent = 'Spinning…';
  Sound.sfx('spin');

  const n = PRIZES.length;
  const seg = 360 / n;

  // 1) Choose the winning index with real logic.
  const winIndex = randInt(0, n - 1);

  // 2) Compute the rotation that puts that segment's centre under the top pointer.
  const center = winIndex * seg + seg / 2;
  const currentMod = ((Spin.rotation % 360) + 360) % 360;
  const desiredMod = ((360 - center) % 360 + 360) % 360;
  let delta = desiredMod - currentMod;
  if (delta < 0) delta += 360;

  const fullSpins = 6; // spin several times for drama
  const target = Spin.rotation + fullSpins * 360 + delta;
  Spin.rotation = target;

  const wheel = $('#wheel');
  wheel.style.transform = `rotate(${target}deg)`;

  // 3) When the animation ends, reveal the prize.
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    Spin.spinning = false;
    onSpinEnd(PRIZES[winIndex]);
  };
  wheel.addEventListener('transitionend', settle, { once: true });
  setTimeout(settle, 5500); // fallback in case transitionend doesn't fire
}

/** Called when the wheel stops. */
function onSpinEnd(prize) {
  if (!prize.reward) {
    // ⭐ Try Again
    Sound.sfx('lose');
    openModal(`
      <div class="modal-emoji">⭐</div>
      <h3 class="modal-title">So Close!</h3>
      <p class="modal-text">The wheel landed on <strong>Try Again</strong>. No treat this time — but you can play again for another chance!</p>
      <div class="modal-actions">
        <button class="btn btn-primary btn-xl" id="spinAgainBtn">↻ PLAY AGAIN</button>
      </div>
    `);
    $('#spinAgainBtn').addEventListener('click', () => { Sound.sfx('click'); resetToWelcome(); });
    return;
  }

  // 🎉 A real treat
  Sound.sfx('reward');
  burstConfetti(140);
  openModal(`
    <div class="modal-emoji">🎉</div>
    <h3 class="modal-title">YOU WON A FOODMANIA TREAT!</h3>
    <p class="modal-text">You have won:</p>
    <div class="reward-box">
      <div style="font-size:3rem;line-height:1;">${prize.emoji}</div>
      <strong style="display:block;font-size:1.25rem;color:#3E4A1E;margin-top:6px;">${prize.reward}</strong>
    </div>
    <div class="modal-actions">
      <button class="btn btn-gold btn-xl" id="claimBtn">🎁 CLAIM MY REWARD</button>
    </div>
    <p class="promo-note">Prizes are subject to Foodmania's actual promotion terms.</p>
  `);
  $('#claimBtn').addEventListener('click', () => { Sound.sfx('click'); claimReward(prize); });
}

/** Generate + save a reward code and show it to the player. */
function claimReward(prize) {
  const code = generateRewardCode();
  const entry = { code, prize: prize.reward, emoji: prize.emoji, date: new Date().toISOString() };
  Rewards.add(entry);

  Sound.sfx('reward');
  burstConfetti(120);

  openModal(`
    <div class="modal-emoji">🎊</div>
    <h3 class="modal-title">Reward Claimed!</h3>
    <p class="modal-text">Congratulations! You have won:</p>
    <div class="reward-box">
      <div style="font-size:2.4rem;line-height:1;">${prize.emoji}</div>
      <strong style="display:block;font-size:1.2rem;color:#3E4A1E;margin:6px 0;">${prize.reward}</strong>
      <div class="reward-label">Your Reward Code</div>
      <div class="reward-code">${code}</div>
      <p class="reward-hint">Show this reward code to Foodmania staff to redeem your prize.</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary btn-xl" id="playAgainBtn">↻ PLAY AGAIN</button>
    </div>
    <p class="promo-note">
      This code was generated by the game and saved on your device.
      Prizes are subject to Foodmania's actual promotion terms — no order has been placed automatically.
    </p>
  `);
  $('#playAgainBtn').addEventListener('click', () => { Sound.sfx('click'); resetToWelcome(); });
}

/* ============================================================
   11. NAVIGATION HELPERS
   ============================================================ */
function goToLevels() {
  if (Game.running) stopTimer();
  Game.running = false;
  Game.paused = false;
  renderLevels();
  showScreen('levels');
}

function resetToWelcome() {
  closeModal();
  if (Game.running) stopTimer();
  Game.running = false;
  Game.paused = false;
  Spin.used = false;
  Spin.spinning = false;
  renderSavedReward();
  showScreen('welcome');
}

/* ============================================================
   12. WELCOME DECOR + SAVED REWARD
   ============================================================ */
const FLOAT_EMOJIS = ['🍕', '🍔', '🍟', '🌮', '🍩', '🍣', '🍜', '🥗', '🍰', '🧁', '🍪', '🍦', '🍿', '🥨', '🌭', '🥤'];

function buildFloatingEmojis() {
  const layer = $('#floatingLayer');
  const count = window.innerWidth < 600 ? 12 : 20;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'float-emoji';
    el.textContent = FLOAT_EMOJIS[randInt(0, FLOAT_EMOJIS.length - 1)];
    el.style.left = randFloat(0, 96) + 'vw';
    el.style.fontSize = randFloat(1.4, 3.0) + 'rem';
    el.style.animationDuration = randFloat(9, 18) + 's';
    el.style.animationDelay = randFloat(0, 12) + 's';
    layer.appendChild(el);
  }
}

function renderSavedReward() {
  const box = $('#savedReward');
  const latest = Rewards.latest();
  if (!latest) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `
    🎁 Your latest reward: <strong>${latest.emoji || '🎉'} ${latest.prize}</strong>
    <span class="code">${latest.code}</span>
    <div style="margin-top:6px;font-size:.78rem;">Show this code to Foodmania staff to redeem. Subject to promotion terms.</div>
  `;
}

/* ============================================================
   13. BOOT / EVENT WIRING
   ============================================================ */
function updateMuteUI() {
  $('#muteIcon').textContent = Sound.isMuted() ? '🔇' : '🔊';
}

function init() {
  Progress.load();
  buildFloatingEmojis();
  buildWheel();
  renderLevels();
  renderSavedReward();

  // Restore mute preference
  let startMuted = false;
  try { startMuted = localStorage.getItem(STORE_KEYS.muted) === '1'; } catch (e) {}
  Sound.setMuted(startMuted);
  updateMuteUI();

  /* ---- Welcome ---- */
  $('#playBtn').addEventListener('click', () => {
    Sound.unlock();
    Sound.sfx('click');
    Sound.startMusic();       // begin light background music
    goToLevels();
  });

  /* ---- Mute toggle ---- */
  $('#muteBtn').addEventListener('click', () => {
    Sound.unlock();
    const m = !Sound.isMuted();
    Sound.setMuted(m);
    updateMuteUI();
    try { localStorage.setItem(STORE_KEYS.muted, m ? '1' : '0'); } catch (e) {}
    if (!m) Sound.startMusic(); // ensure music resumes if it was muted
  });

  /* ---- Game screen controls ---- */
  $('#gameBackBtn').addEventListener('click', () => { Sound.sfx('click'); goToLevels(); });
  $('#pauseBtn').addEventListener('click', () => { Sound.sfx('click'); pauseGame(); });

  /* ---- Back buttons with data-back ---- */
  $$('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => { Sound.sfx('click'); showScreen(btn.dataset.back); });
  });

  /* ---- Spin ---- */
  $('#spinBtn').addEventListener('click', spinWheel);

  /* ---- Rebuild the room grid if the window is resized a lot ---- */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (currentScreen !== 'game' || !Game.level) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Preserve found targets across a relayout.
      const found = new Set(Game.found);
      buildRoom(Game.level);
      $$('#foodLayer .food-item').forEach(btn => {
        const key = btn.dataset.food;
        if (btn.dataset.target === '1' && found.has(key)) {
          btn.classList.add('found');
          btn.disabled = true;
        }
      });
    }, 300);
  });
}

document.addEventListener('DOMContentLoaded', init);
