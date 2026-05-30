// ╔════════════════════════════════════════════════════════════════════╗
// ║ Konami easter egg: BULKY-TRIS                                      ║
// ║ Trigger: ↑ ↑ ↓ ↓ ← → ← → B A                                       ║
// ║ Self-contained — no external assets. Vanilla JS + Canvas.          ║
// ╚════════════════════════════════════════════════════════════════════╝
(function () {
  const KONAMI = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
    'b', 'a'
  ];
  let buffer = [];
  let isOpen = false;

  function normKey(k) { return k.length === 1 ? k.toLowerCase() : k; }

  document.addEventListener('keydown', function (e) {
    if (isOpen) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    buffer.push(normKey(e.key));
    if (buffer.length > KONAMI.length) buffer.shift();
    if (buffer.length === KONAMI.length &&
        KONAMI.every((k, i) => normKey(k) === buffer[i])) {
      buffer = [];
      open();
    }
  });

  // ── Tetris definitions ───────────────────────────────────────────────
  const COLS = 10, ROWS = 20, BLOCK = 24;
  const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // selectable start levels
  const COLORS = {
    I: '#00ffff', O: '#ffe600', T: '#e040ff',
    S: '#00ff66', Z: '#ff2a55', J: '#5a8eff', L: '#ffa033'
  };
  const PIECES = {
    I: [
      [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]]
    ],
    O: [[[1,1],[1,1]]],
    T: [
      [[0,1,0],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,1],[0,1,0]],
      [[0,1,0],[1,1,0],[0,1,0]]
    ],
    S: [
      [[0,1,1],[1,1,0],[0,0,0]],
      [[0,1,0],[0,1,1],[0,0,1]]
    ],
    Z: [
      [[1,1,0],[0,1,1],[0,0,0]],
      [[0,0,1],[0,1,1],[0,1,0]]
    ],
    J: [
      [[1,0,0],[1,1,1],[0,0,0]],
      [[0,1,1],[0,1,0],[0,1,0]],
      [[0,0,0],[1,1,1],[0,0,1]],
      [[0,1,0],[0,1,0],[1,1,0]]
    ],
    L: [
      [[0,0,1],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,0],[0,1,1]],
      [[0,0,0],[1,1,1],[1,0,0]],
      [[1,1,0],[0,1,0],[0,1,0]]
    ]
  };
  const TYPES = Object.keys(PIECES);
  // Reverse map so settled blocks (stored as colors) can show their letter in
  // colorblind/labels mode.
  const LETTER_BY_COLOR = {};
  TYPES.forEach(function (t) { LETTER_BY_COLOR[COLORS[t]] = t; });

  // ── Global leaderboard (Firebase Firestore) ──────────────────────────
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAVf2_7vqQL--vt12udlpJ-EW0BSW_EjaM",
    authDomain: "p2w-leaderboard.firebaseapp.com",
    projectId: "p2w-leaderboard",
    storageBucket: "p2w-leaderboard.firebasestorage.app",
    messagingSenderId: "900204827002",
    appId: "1:900204827002:web:4a3950730e0e79bce246c3"
  };
  const MAX_SCORES = 10;
  const BLOCKED = new Set([
    'ASS','FUC','FUK','FCK','SHT','SHI','BCH','CNT','DCK','PSS','JIZ','CUM','TIT','SEX','HOE','PNS','POO',
    'FAG','FGT','GAY',
    'NIG','NGR','KKK','NZI','NAZ','JAP','JEW','SPC','KYK','WOP','CHK','SLT','RTD',
    'KYS','DIE','SCM','RPE','MOL','PED'
  ]);

  let fb = null, fbLoading = null;
  async function loadFirebase() {
    if (fb) return fb;
    if (fbLoading) return fbLoading;
    fbLoading = (async function () {
      const [appMod, fsMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js')
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      fb = {
        db: fsMod.getFirestore(app),
        collection: fsMod.collection,
        addDoc: fsMod.addDoc,
        query: fsMod.query,
        orderBy: fsMod.orderBy,
        limit: fsMod.limit,
        getDocs: fsMod.getDocs,
        serverTimestamp: fsMod.serverTimestamp
      };
      return fb;
    })();
    return fbLoading;
  }

  async function submitScore(name, sc, lv, ln) {
    const f = await loadFirebase();
    await f.addDoc(f.collection(f.db, 'scores'), {
      name: name, score: sc, level: lv, lines: ln, ts: f.serverTimestamp()
    });
  }

  async function getTopScores(n) {
    const f = await loadFirebase();
    const q = f.query(f.collection(f.db, 'scores'), f.orderBy('score', 'desc'), f.limit(n || MAX_SCORES));
    const snap = await f.getDocs(q);
    return snap.docs.map(function (d) { return d.data(); });
  }

  function isValidInitials(s) {
    if (!/^[A-Z]{3}$/.test(s)) return false;
    if (BLOCKED.has(s)) return false;
    return true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Sound FX (Web Audio, synthesized — no audio files) ───────────────
  let audioCtx = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem('p2w-bt-muted') !== '1'; } catch (e) {}

  // Start level — chosen on the level-select screen, remembered across games.
  let startLevel = 1;
  try {
    const sl = parseInt(localStorage.getItem('p2w-bt-startlevel'), 10);
    if (sl >= 1 && sl <= LEVELS.length) startLevel = sl;
  } catch (e) {}

  // Personal best — remembered locally so there's always a target offline.
  let bestScore = 0;
  try {
    const bs = parseInt(localStorage.getItem('p2w-bt-best'), 10);
    if (bs > 0) bestScore = bs;
  } catch (e) {}
  let isNewBest = false;
  function saveBest() {
    try { localStorage.setItem('p2w-bt-best', String(bestScore)); } catch (e) {}
  }

  // Colorblind "labels" mode — draws each piece's letter on its blocks.
  let colorBlind = false;
  try { colorBlind = localStorage.getItem('p2w-bt-cb') === '1'; } catch (e) {}
  function setColorBlind(on) {
    colorBlind = on;
    try { localStorage.setItem('p2w-bt-cb', on ? '1' : '0'); } catch (e) {}
  }

  // Create/resume the shared AudioContext (used by both SFX and music).
  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function ensureAudio() {
    return soundOn ? getCtx() : null;  // SFX respect the mute toggle
  }

  function tone(freq, start, dur, type, vol) {
    const ac = audioCtx;
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function beep(freq, dur, type, vol) {
    if (!ensureAudio()) return;
    tone(freq, 0, dur || 0.08, type, vol);
  }

  function arp(freqs, step, type, vol) {
    if (!ensureAudio()) return;
    freqs.forEach(function (f, i) { tone(f, i * step, step + 0.05, type, vol); });
  }

  const SFX = {
    move:    function () { beep(220, 0.04, 'square', 0.05); },
    rotate:  function () { beep(330, 0.05, 'square', 0.06); },
    soft:    function () { beep(170, 0.03, 'square', 0.035); },
    hard:    function () { beep(110, 0.09, 'square', 0.10); },
    lock:    function () { beep(90, 0.07, 'triangle', 0.08); },
    hold:    function () { beep(440, 0.06, 'sine', 0.07); },
    clear:   function (n) {
      if (n >= 4) arp([523, 659, 784, 1047, 1319], 0.07, 'square', 0.11);
      else arp([440, 660, 880].slice(0, n + 1), 0.05, 'square', 0.09);
    },
    levelup: function () { arp([523, 784, 1047], 0.08, 'triangle', 0.10); },
    combo:   function (n) { beep(Math.min(1600, 520 + n * 90), 0.07, 'square', 0.09); },
    tetris:  function () { arp([523, 659, 784, 1047, 1319, 1568], 0.06, 'square', 0.12); },
    count:   function (go) { beep(go ? 880 : 440, go ? 0.18 : 0.1, 'square', 0.09); },
    over:    function () { arp([392, 311, 247, 165], 0.13, 'sawtooth', 0.09); }
  };

  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('p2w-bt-muted', on ? '0' : '1'); } catch (e) {}
    if (on) ensureAudio();
  }

  // ── Background music (Korobeiniki — public-domain folk tune, synthesized) ──
  // Opt-in toggle, independent of the SFX mute. The melody loops via lookahead
  // scheduling on the shared AudioContext, routed through its own gain node.
  const NOTE = { A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, A5: 880, R: 0 };
  const MELODY = [
    ['E5',2],['B4',1],['C5',1],['D5',2],['C5',1],['B4',1],
    ['A4',2],['A4',1],['C5',1],['E5',2],['D5',1],['C5',1],
    ['B4',3],['C5',1],['D5',2],['E5',2],
    ['C5',2],['A4',2],['A4',2],['R',2]
  ];
  const EIGHTH = 0.15;  // seconds per beat unit

  let musicOn = false;
  try { musicOn = localStorage.getItem('p2w-bt-music') === '1'; } catch (e) {}
  let musicTimer = null, musicGain = null;

  function scheduleMelody() {
    const ctx = getCtx();
    if (!ctx) return;
    if (!musicGain) { musicGain = ctx.createGain(); musicGain.connect(ctx.destination); }
    musicGain.gain.value = 1;
    let t = ctx.currentTime + 0.06;
    MELODY.forEach(function (pair) {
      const dur = pair[1] * EIGHTH;
      const f = NOTE[pair[0]];
      if (f) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
        osc.connect(g).connect(musicGain);
        osc.start(t);
        osc.stop(t + dur);
      }
      t += dur;
    });
    const ms = (t - ctx.currentTime) * 1000;
    musicTimer = setTimeout(function () { if (musicOn && isOpen) scheduleMelody(); }, ms - 60);
  }

  function startMusic() {
    if (!musicOn || !isOpen) return;
    if (musicTimer) return;  // already looping — don't double-schedule (overlap)
    scheduleMelody();
  }
  function stopMusic() {
    if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
    if (musicGain) musicGain.gain.value = 0;  // mute any already-scheduled notes
  }
  function setMusic(on) {
    musicOn = on;
    try { localStorage.setItem('p2w-bt-music', on ? '1' : '0'); } catch (e) {}
    if (on) startMusic(); else stopMusic();
  }

  let board, current, next, hold, canHold, score, level, lines, dropMs, dropAcc, lastTime, gameOver, paused, rafId;
  let combo;  // consecutive line-clearing placements; -1 = no active combo (Guideline)
  let b2bActive, lastWasRotation;   // Back-to-Back chain + T-spin rotation flag
  let lockMs, lockResets, lowestY;  // lock-delay state for the active piece
  let heldDir, dasMs, dasCharged, softHeld, softMs;  // keyboard DAS/ARR state
  let countingDown = false, countTimer = null;       // pre-game READY countdown
  let ctx, nextCtx, holdCtx, scoreEl, levelEl, linesEl, comboEl, bestEl;
  let overlay;
  let initialsMode = false;
  let viewingLeaderboard = false;
  let selectingLevel = false;
  let selLevel = startLevel;  // highlighted level on the level-select screen
  let clearing = null;   // { rows:[...], start } while a line-clear flash plays
  let bag = [];          // 7-bag randomizer queue
  const CLEAR_MS = 220;  // line-clear flash duration
  const LOCK_DELAY = 500;     // ms a grounded piece waits before locking
  const LOCK_RESET_MAX = 15;  // max move/rotate lock-delay refreshes per row (Guideline)
  const DAS = 150;            // ms before held left/right auto-shift engages
  const ARR = 40;             // ms between auto-shift steps once engaged
  const SOFT_REPEAT = 45;     // ms between held soft-drop steps

  function open() {
    if (isOpen) return;
    isOpen = true;
    document.body.style.overflow = 'hidden';
    overlay = document.createElement('div');
    overlay.className = 'konami-overlay';
    overlay.innerHTML =
      '<div class="konami-modal" role="dialog" aria-modal="true" aria-label="Bulky-Tris">' +
        '<button class="konami-close" aria-label="Close">×</button>' +
        '<div class="konami-titlebar">' +
          '<img class="kn-bulky" src="assets/shop-header.png" alt="" aria-hidden="true">' +
          '<div>' +
            '<h2 class="konami-title">BULKY-TRIS</h2>' +
            '<p class="konami-sub">Whenever you play, Play 2 Win!</p>' +
          '</div>' +
          '<img class="kn-bulky kn-bulky--flip" src="assets/shop-header.png" alt="" aria-hidden="true">' +
        '</div>' +
        '<div class="konami-game">' +
          '<div class="kn-board-wrap">' +
            '<canvas id="kn-board" width="' + (COLS*BLOCK) + '" height="' + (ROWS*BLOCK) + '"></canvas>' +
            '<div class="kn-flash" aria-hidden="true"></div>' +
            '<div class="kn-callout" aria-hidden="true"></div>' +
          '</div>' +
          '<div class="konami-side">' +
            '<div class="konami-stat"><strong>Score</strong><span id="kn-score">0</span></div>' +
            '<div class="konami-stat"><strong>Level</strong><span id="kn-level">1</span></div>' +
            '<div class="konami-stat"><strong>Lines</strong><span id="kn-lines">0</span></div>' +
            '<div class="konami-stat kn-stat-combo"><strong>Combo</strong><span id="kn-combo">0</span>' +
              '<small class="kn-b2b-badge" id="kn-b2b" hidden>B2B</small></div>' +
            '<div class="konami-stat kn-stat-best"><strong>Best</strong><span id="kn-best">0</span></div>' +
            '<div class="konami-stat"><strong>Hold</strong>' +
              '<canvas id="kn-hold" width="96" height="96"></canvas>' +
            '</div>' +
            '<div class="konami-stat"><strong>Next</strong>' +
              '<canvas id="kn-next" width="96" height="96"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kn-touch" aria-label="Touch controls">' +
          '<button type="button" class="kn-tbtn" data-act="hold" aria-label="Hold">HOLD</button>' +
          '<button type="button" class="kn-tbtn" data-act="rotate" aria-label="Rotate">↻</button>' +
          '<button type="button" class="kn-tbtn" data-act="pause" aria-label="Pause">II</button>' +
          '<button type="button" class="kn-tbtn" data-act="left" aria-label="Move left">◀</button>' +
          '<button type="button" class="kn-tbtn" data-act="soft" aria-label="Soft drop">▼</button>' +
          '<button type="button" class="kn-tbtn" data-act="right" aria-label="Move right">▶</button>' +
          '<button type="button" class="kn-tbtn kn-tbtn--wide" data-act="hard" aria-label="Hard drop">⬇ DROP</button>' +
        '</div>' +
        '<p class="konami-controls">' +
          '<span>← →</span> MOVE &middot; <span>↑</span> ROTATE &middot; <span>↓</span> SOFT DROP &middot; ' +
          '<span>SPACE</span> HARD DROP &middot; <span>C</span> HOLD &middot; <span>P</span> PAUSE &middot; <span>ESC</span> QUIT' +
        '</p>' +
        '<div class="konami-actions">' +
          '<button type="button" class="kn-btn kn-btn--board">LEADERBOARD</button>' +
          '<button type="button" class="kn-btn kn-btn--sound" aria-pressed="true">SOUND: ON</button>' +
          '<button type="button" class="kn-btn kn-btn--music" aria-pressed="false">MUSIC: OFF</button>' +
          '<button type="button" class="kn-btn kn-btn--cb" aria-pressed="false">LABELS: OFF</button>' +
        '</div>' +
        '<div id="kn-overlay-msg" class="kn-msg" hidden></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.konami-close').addEventListener('click', close);
    overlay.querySelector('.kn-btn--board').addEventListener('click', viewLeaderboard);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    const soundBtn = overlay.querySelector('.kn-btn--sound');
    function syncSoundBtn() {
      soundBtn.textContent = soundOn ? 'SOUND: ON' : 'SOUND: OFF';
      soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    }
    syncSoundBtn();
    soundBtn.addEventListener('click', function () { setSound(!soundOn); syncSoundBtn(); });

    const musicBtn = overlay.querySelector('.kn-btn--music');
    function syncMusicBtn() {
      musicBtn.textContent = musicOn ? 'MUSIC: ON' : 'MUSIC: OFF';
      musicBtn.setAttribute('aria-pressed', musicOn ? 'true' : 'false');
    }
    syncMusicBtn();
    musicBtn.addEventListener('click', function () { setMusic(!musicOn); syncMusicBtn(); });

    const cbBtn = overlay.querySelector('.kn-btn--cb');
    function syncCbBtn() {
      cbBtn.textContent = colorBlind ? 'LABELS: ON' : 'LABELS: OFF';
      cbBtn.setAttribute('aria-pressed', colorBlind ? 'true' : 'false');
    }
    syncCbBtn();
    cbBtn.addEventListener('click', function () { setColorBlind(!colorBlind); syncCbBtn(); if (isOpen) drawAll(); });

    const touchActs = {
      left:   function () { if (playable()) move(-1); },
      right:  function () { if (playable()) move(1); },
      soft:   function () { if (playable()) softDrop(); },
      rotate: function () { if (playable()) rotate(1); },
      hard:   function () { if (playable()) hardDrop(); },
      hold:   function () { if (playable()) holdPiece(); },
      pause:  function () { togglePause(); }
    };
    const REPEAT = { left: 110, right: 110, soft: 60 };
    overlay.querySelectorAll('.kn-tbtn').forEach(function (btn) {
      bindHold(btn, touchActs[btn.dataset.act], REPEAT[btn.dataset.act] || 0);
    });

    // Tap the dimmed overlay (not its buttons) to resume from pause or restart after game over
    overlay.querySelector('#kn-overlay-msg').addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      if (paused && !gameOver && !viewingLeaderboard && !initialsMode && !selectingLevel) { togglePause(); return; }
      if (gameOver && !initialsMode && !viewingLeaderboard && !selectingLevel) { hideGameOver(); showLevelSelect(); }
    });

    ctx = overlay.querySelector('#kn-board').getContext('2d');
    nextCtx = overlay.querySelector('#kn-next').getContext('2d');
    holdCtx = overlay.querySelector('#kn-hold').getContext('2d');
    scoreEl = overlay.querySelector('#kn-score');
    levelEl = overlay.querySelector('#kn-level');
    linesEl = overlay.querySelector('#kn-lines');
    comboEl = overlay.querySelector('#kn-combo');
    bestEl = overlay.querySelector('#kn-best');

    document.addEventListener('keydown', handleKey);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseKeys);
    showLevelSelect();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    saveBest();
    stopMusic();
    if (countTimer) { clearTimeout(countTimer); countTimer = null; }
    countingDown = false;
    initialsMode = false;
    viewingLeaderboard = false;
    document.removeEventListener('keydown', handleKey);
    document.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', releaseKeys);
    if (rafId) cancelAnimationFrame(rafId);
    document.body.style.overflow = '';
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function startGame() {
    board = Array.from({length: ROWS}, () => Array(COLS).fill(null));
    score = 0; level = startLevel; lines = 0;
    dropMs = Math.max(80, 800 - (level - 1) * 60); dropAcc = 0; lastTime = 0;
    gameOver = false; paused = false;
    hold = null; canHold = true;
    combo = -1;
    b2bActive = false; lastWasRotation = false;
    isNewBest = false;
    heldDir = 0; dasMs = 0; dasCharged = false; softHeld = false; softMs = 0;
    clearing = null; bag = [];
    next = spawnPiece();
    current = spawnPiece();
    resetLockState();
    updateStats();
    drawAll();
    runCountdown();
    startMusic();
    rafId = requestAnimationFrame(loop);
  }

  // Brief "3 · 2 · 1 · GO!" before play; gravity/input are gated until GO.
  function runCountdown() {
    if (countTimer) clearTimeout(countTimer);
    countingDown = true;
    const steps = ['3', '2', '1'];
    let i = 0;
    flashCallout(steps[i]);
    SFX.count(false);
    const tick = function () {
      i++;
      if (i < steps.length) {
        flashCallout(steps[i]);
        SFX.count(false);
        countTimer = setTimeout(tick, 550);
      } else {
        countingDown = false;
        flashCallout('GO!');
        SFX.count(true);
        countTimer = null;
      }
    };
    countTimer = setTimeout(tick, 550);
  }

  // ── Level select (shown on open and before each replay) ──────────────
  function showLevelSelect() {
    selectingLevel = true;
    initialsMode = false;
    viewingLeaderboard = false;
    gameOver = false;
    paused = true;
    if (rafId) cancelAnimationFrame(rafId);
    selLevel = startLevel;
    const m = overlay.querySelector('#kn-overlay-msg');
    m.hidden = false;
    m.innerHTML =
      '<h3>SELECT LEVEL</h3>' +
      '<p class="kn-final">Higher start = faster drop &amp; bigger points.</p>' +
      '<div class="kn-levels">' +
        LEVELS.map(function (n) {
          return '<button type="button" class="kn-lvl' + (n === selLevel ? ' kn-lvl--sel' : '') +
            '" data-lvl="' + n + '">' + n + '</button>';
        }).join('') +
      '</div>' +
      '<p class="kn-tip">Click a level &middot; or ← → then ENTER &middot; ESC to quit</p>';
    m.querySelectorAll('.kn-lvl').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startAtLevel(parseInt(btn.dataset.lvl, 10));
      });
    });
  }

  function highlightLevel() {
    if (!overlay) return;
    overlay.querySelectorAll('.kn-lvl').forEach(function (btn) {
      btn.classList.toggle('kn-lvl--sel', parseInt(btn.dataset.lvl, 10) === selLevel);
    });
  }

  function startAtLevel(n) {
    startLevel = Math.min(LEVELS.length, Math.max(1, n));
    try { localStorage.setItem('p2w-bt-startlevel', String(startLevel)); } catch (e) {}
    selectingLevel = false;
    const m = overlay.querySelector('#kn-overlay-msg');
    m.hidden = true;
    m.innerHTML = '';
    startGame();
  }

  function handleLevelSelectKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      selLevel = selLevel > 1 ? selLevel - 1 : LEVELS.length;
      highlightLevel(); SFX.move(); e.preventDefault(); return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      selLevel = selLevel < LEVELS.length ? selLevel + 1 : 1;
      highlightLevel(); SFX.move(); e.preventDefault(); return;
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startAtLevel(selLevel); return; }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      startAtLevel(e.key === '0' ? 10 : parseInt(e.key, 10));
    }
  }

  function nextType() {
    if (bag.length === 0) {
      bag = TYPES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
    }
    return bag.pop();
  }

  function spawnPiece() {
    const type = nextType();
    return { type, rot: 0, x: type === 'O' ? 4 : 3, y: type === 'I' ? -1 : 0 };
  }

  function shape(p) {
    return PIECES[p.type][p.rot % PIECES[p.type].length];
  }

  function collides(p, dx, dy, drot) {
    const r = ((p.rot + (drot || 0)) % PIECES[p.type].length + PIECES[p.type].length) % PIECES[p.type].length;
    const s = PIECES[p.type][r];
    for (let i = 0; i < s.length; i++) {
      for (let j = 0; j < s[i].length; j++) {
        if (!s[i][j]) continue;
        const x = p.x + j + (dx||0);
        const y = p.y + i + (dy||0);
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && board[y][x]) return true;
      }
    }
    return false;
  }

  function lock() {
    const s = shape(current);
    for (let i = 0; i < s.length; i++) {
      for (let j = 0; j < s[i].length; j++) {
        if (s[i][j]) {
          const y = current.y + i;
          if (y < 0) { gameOver = true; continue; }
          board[y][current.x + j] = COLORS[current.type];
        }
      }
    }
    SFX.lock();
    if (gameOver) { showGameOver(); return; }
    const ts = detectTSpin();
    const full = fullRows();
    if (full.length) {
      clearing = { rows: full, start: performance.now(), tspin: ts.tspin, mini: ts.mini };
      SFX.clear(full.length);
    } else {
      // No lines cleared. A T-spin with no clear still scores and (per Guideline)
      // does NOT affect the Back-to-Back chain; the combo streak still breaks.
      if (ts.tspin) {
        score += (ts.mini ? 100 : 400) * level;
        flashCallout(ts.mini ? 'T-SPIN MINI' : 'T-SPIN');
        SFX.combo(ts.mini ? 2 : 5);
      }
      combo = -1;
      updateStats();
      spawnNext();
    }
  }

  function fullRows() {
    const rows = [];
    for (let i = 0; i < ROWS; i++) if (board[i].every(c => c)) rows.push(i);
    return rows;
  }

  // T-spin detection via the 3-corner rule: the last action was a rotation, the
  // piece is a T, and >=3 of its 3x3 box corners are blocked (wall/floor/cells).
  // "Mini" when only one of the two corners the T points toward is blocked.
  function detectTSpin() {
    if (current.type !== 'T' || !lastWasRotation) return { tspin: false, mini: false };
    const cx = current.x, cy = current.y;
    function blocked(r, c) {
      const x = cx + c, y = cy + r;
      if (x < 0 || x >= COLS || y >= ROWS) return true;  // wall / floor
      if (y < 0) return false;                            // above the board
      return !!board[y][x];
    }
    const tl = blocked(0, 0), tr = blocked(0, 2), bl = blocked(2, 0), br = blocked(2, 2);
    const count = tl + tr + bl + br;
    if (count < 3) return { tspin: false, mini: false };
    const rot = ((current.rot % 4) + 4) % 4;
    // Front corners = the two on the side the T points toward.
    const front = rot === 0 ? [tl, tr] : rot === 1 ? [tr, br] : rot === 2 ? [bl, br] : [tl, bl];
    return { tspin: true, mini: !(front[0] && front[1]) };
  }

  function spawnNext() {
    current = next;
    next = spawnPiece();
    canHold = true;
    resetLockState();
    if (collides(current, 0, 0, 0)) { gameOver = true; showGameOver(); }
  }

  // Lock-delay bookkeeping for the active piece.
  function grounded() { return collides(current, 0, 1, 0); }

  function resetLockState() {
    lockMs = 0;
    lockResets = 0;
    lowestY = current ? current.y : 0;
    dropAcc = 0;  // each new piece starts with a full gravity interval
    lastWasRotation = false;  // a fresh piece hasn't been rotated yet
  }

  // After a successful move/rotate, refresh the lock delay if the piece is
  // resting — capped per row by LOCK_RESET_MAX (Guideline "move reset" rule).
  function onPieceShift() {
    if (grounded() && lockResets < LOCK_RESET_MAX) {
      lockMs = 0;
      lockResets++;
    }
  }

  function holdPiece() {
    if (!canHold) return;
    SFX.hold();
    const curType = current.type;
    if (hold === null) {
      hold = curType;
      current = next;
      next = spawnPiece();
    } else {
      const swapType = hold;
      hold = curType;
      current = { type: swapType, rot: 0, x: swapType === 'O' ? 4 : 3, y: swapType === 'I' ? -1 : 0 };
    }
    canHold = false;
    resetLockState();
    if (collides(current, 0, 0, 0)) { gameOver = true; showGameOver(); }
  }

  function finishClear() {
    const rows = clearing.rows;
    const cleared = rows.length;
    // Remove every full row first (highest index down, so the lower indices in
    // `rows` stay valid), THEN drop in the replacement empties. Doing the
    // unshift inside the loop would re-index the board mid-pass and leave one
    // full line (usually the bottom of the group) uncleared until the next lock.
    for (let k = rows.length - 1; k >= 0; k--) {
      board.splice(rows[k], 1);
    }
    for (let k = 0; k < cleared; k++) {
      board.unshift(Array(COLS).fill(null));
    }
    const tspin = clearing.tspin, mini = clearing.mini;
    clearing = null;
    lines += cleared;

    // Base line-clear value (x level). T-spins score much higher than normal
    // clears (Guideline). A Tetris or any T-spin line clear is a "difficult"
    // clear and feeds the Back-to-Back chain.
    let lineScore, difficult;
    if (tspin) {
      lineScore = mini ? [0, 200, 400][cleared] : [0, 800, 1200, 1600][cleared];
      difficult = true;
    } else {
      lineScore = [0, 100, 300, 500, 800][cleared];
      difficult = (cleared === 4);  // Tetris
    }
    lineScore *= level;

    // Back-to-Back: a difficult clear chained to the previous difficult clear
    // (no normal line clear between) is worth x1.5. A normal clear breaks it.
    let chained = false;
    if (difficult) {
      if (b2bActive) { lineScore = Math.floor(lineScore * 1.5); chained = true; }
      b2bActive = true;
    } else {
      b2bActive = false;
    }
    score += lineScore;

    // Combo: each consecutive line-clearing placement scores 50 x combo x level
    // (Guideline). combo starts at -1, so the first clear (combo 0) pays nothing
    // and the bonus kicks in from the second consecutive clear onward.
    combo++;
    if (combo > 0) {
      score += 50 * combo * level;
      SFX.combo(combo);
      flashCombo();
    }

    // Celebratory callout for the notable clears.
    let label = '';
    if (tspin) label = (mini ? 'T-SPIN MINI' : 'T-SPIN') + (['', ' SINGLE', ' DOUBLE', ' TRIPLE'][cleared] || '');
    else if (cleared === 4) label = 'TETRIS';
    if (label) {
      if (chained) label = 'B2B ' + label;
      flashCallout(label);
      if (cleared === 4 || tspin) { SFX.tetris(); flashBigClear(); }
    }

    const newLevel = startLevel + Math.floor(lines / 10);
    if (newLevel > level) {
      level = newLevel;
      dropMs = Math.max(80, 800 - (level - 1) * 60);
      SFX.levelup();
    }
    updateStats();
    spawnNext();
  }

  function move(dx) { if (!collides(current, dx, 0, 0)) { current.x += dx; lastWasRotation = false; SFX.move(); onPieceShift(); } }
  function softDrop() {
    if (!collides(current, 0, 1, 0)) {
      current.y++; score++; lastWasRotation = false; updateStats(); SFX.soft();
      if (current.y > lowestY) { lowestY = current.y; lockResets = 0; lockMs = 0; }
    }
    // Grounded: the lock delay in loop() handles locking — no instant lock,
    // so players can still slide/tuck. Hard drop (SPACE) is the instant-lock.
  }
  function hardDrop() {
    let dropped = 0;
    while (!collides(current, 0, 1, 0)) { current.y++; dropped++; }
    if (dropped > 0) lastWasRotation = false;  // a drop isn't a spin
    score += dropped * 2;
    updateStats();
    SFX.hard();
    lock();
  }
  function rotate(dir) {
    if (!collides(current, 0, 0, dir)) {
      current.rot = (current.rot + dir + 4) % PIECES[current.type].length;
      lastWasRotation = true;
      SFX.rotate();
      onPieceShift();
      return;
    }
    for (const kick of [-1, 1, -2, 2]) {
      if (!collides(current, kick, 0, dir)) {
        current.x += kick;
        current.rot = (current.rot + dir + 4) % PIECES[current.type].length;
        lastWasRotation = true;
        SFX.rotate();
        onPieceShift();
        return;
      }
    }
  }

  function playable() {
    return !gameOver && !paused && !clearing && !viewingLeaderboard && !initialsMode && !selectingLevel && !countingDown;
  }

  function togglePause() {
    if (gameOver || clearing || viewingLeaderboard || initialsMode || selectingLevel || countingDown) return;
    paused = !paused;
    if (paused) { releaseKeys(); showMessage('PAUSED', 'Tap here or press P to resume'); }
    else hideGameOver();
  }

  // Tap-and-hold support for the on-screen touch buttons (one fire on press,
  // then auto-repeat for move/soft-drop). Pointer events cover mouse + touch.
  function bindHold(btn, action, repeatMs) {
    let to = null, iv = null;
    function fire(e) {
      if (e) e.preventDefault();
      action();
      if (repeatMs) {
        to = setTimeout(function () { iv = setInterval(action, repeatMs); }, 220);
      }
    }
    function stop() {
      if (to) clearTimeout(to);
      if (iv) clearInterval(iv);
      to = iv = null;
    }
    btn.addEventListener('pointerdown', fire);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  }

  function handleKey(e) {
    if (selectingLevel) { handleLevelSelectKey(e); return; }
    if (countingDown) { if (e.key === 'Escape') { e.preventDefault(); close(); } return; }
    if (viewingLeaderboard) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        closeLeaderboardView();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (initialsMode) return; // form handles its own keys
    if (gameOver) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideGameOver(); showLevelSelect(); }
      return;
    }
    if (clearing) return; // ignore input during the line-clear flash
    if (e.key === 'p' || e.key === 'P') {
      togglePause();
      e.preventDefault();
      return;
    }
    if (paused) return;
    // Ignore the OS key-repeat stream — held-key auto-shift is driven by the
    // game loop (DAS/ARR) so movement feels consistent across keyboards.
    if (e.repeat) { e.preventDefault(); return; }
    switch (e.key) {
      case 'ArrowLeft':  startDir(-1); e.preventDefault(); break;
      case 'ArrowRight': startDir(1);  e.preventDefault(); break;
      case 'ArrowDown':  startSoft();  e.preventDefault(); break;
      case 'ArrowUp':
      case 'x': case 'X': rotate(1); e.preventDefault(); break;
      case 'z': case 'Z': rotate(-1); e.preventDefault(); break;
      case ' ':          hardDrop(); e.preventDefault(); break;
      case 'c': case 'C': case 'Shift': holdPiece(); e.preventDefault(); break;
    }
  }

  // Initial press handlers: act once immediately, then the loop auto-repeats
  // while the key stays held (cleared by handleKeyUp / releaseKeys).
  function startDir(dir) {
    heldDir = dir;
    dasMs = 0;
    dasCharged = false;
    move(dir);
  }
  function startSoft() {
    softHeld = true;
    softMs = 0;
    softDrop();
  }
  function handleKeyUp(e) {
    if (e.key === 'ArrowLeft' && heldDir === -1) heldDir = 0;
    else if (e.key === 'ArrowRight' && heldDir === 1) heldDir = 0;
    else if (e.key === 'ArrowDown') softHeld = false;
  }
  function releaseKeys() { heldDir = 0; softHeld = false; }

  function loop(t) {
    if (!isOpen) return;
    const dt = lastTime ? t - lastTime : 0;
    lastTime = t;
    if (clearing) {
      if (performance.now() - clearing.start >= CLEAR_MS) finishClear();
    } else if (!gameOver && !paused && !countingDown) {
      // Held-key auto-shift: wait DAS, then step every ARR. Guards cap the work
      // if dt spikes (e.g. the tab was backgrounded) so we never runaway-loop.
      if (heldDir !== 0) {
        dasMs += dt;
        if (!dasCharged) {
          if (dasMs >= DAS) { dasCharged = true; dasMs -= DAS; move(heldDir); }
        } else {
          let g = 0;
          while (dasMs >= ARR && g++ < COLS) { dasMs -= ARR; move(heldDir); }
        }
      }
      if (softHeld) {
        softMs += dt;
        let g = 0;
        while (softMs >= SOFT_REPEAT && g++ < ROWS) { softMs -= SOFT_REPEAT; softDrop(); }
      }
      dropAcc += dt;
      if (dropAcc >= dropMs) {
        dropAcc = 0;
        if (!collides(current, 0, 1, 0)) {
          current.y++;
          lastWasRotation = false;  // a gravity drop isn't a spin
          // Falling to a new lowest row grants a fresh batch of lock resets.
          if (current.y > lowestY) { lowestY = current.y; lockResets = 0; lockMs = 0; }
        }
      }
      // Lock delay: a grounded piece waits LOCK_DELAY (refreshed by move/rotate)
      // before it locks, so last-moment slides and tucks are possible.
      if (collides(current, 0, 1, 0)) {
        lockMs += dt;
        if (lockMs >= LOCK_DELAY) lock();
      } else {
        lockMs = 0;
      }
    }
    drawAll();
    rafId = requestAnimationFrame(loop);
  }

  function drawAll() {
    drawBoard();
    drawNext();
    drawHold();
  }

  function drawBoard() {
    ctx.fillStyle = '#15132a';
    ctx.fillRect(0, 0, COLS*BLOCK, ROWS*BLOCK);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i*BLOCK, 0); ctx.lineTo(i*BLOCK, ROWS*BLOCK); ctx.stroke();
    }
    for (let i = 1; i < ROWS; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i*BLOCK); ctx.lineTo(COLS*BLOCK, i*BLOCK); ctx.stroke();
    }
    // settled blocks (+ line-clear flash)
    const flashOn = clearing && Math.floor((performance.now() - clearing.start) / 55) % 2 === 0;
    for (let i = 0; i < ROWS; i++) {
      const isFlash = clearing && clearing.rows.indexOf(i) !== -1;
      for (let j = 0; j < COLS; j++) {
        if (!board[i][j]) continue;
        if (isFlash && flashOn) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(j*BLOCK, i*BLOCK, BLOCK, BLOCK);
        } else {
          drawBlock(ctx, j, i, board[i][j]);
        }
      }
    }
    // ghost piece
    if (!gameOver && !clearing) {
      let gy = current.y;
      while (!collides(current, 0, gy - current.y + 1, 0)) gy++;
      const s = shape(current);
      for (let i = 0; i < s.length; i++) {
        for (let j = 0; j < s[i].length; j++) {
          if (s[i][j]) {
            const y = gy + i;
            if (y >= 0) drawGhost(ctx, current.x + j, y, COLORS[current.type]);
          }
        }
      }
      // current piece
      for (let i = 0; i < s.length; i++) {
        for (let j = 0; j < s[i].length; j++) {
          if (s[i][j]) {
            const y = current.y + i;
            if (y >= 0) drawBlock(ctx, current.x + j, y, COLORS[current.type]);
          }
        }
      }
    }
  }

  function drawBlock(c, x, y, color) {
    const px = x * BLOCK, py = y * BLOCK;
    c.fillStyle = color;
    c.fillRect(px, py, BLOCK, BLOCK);
    // bright highlight
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(px, py, BLOCK, 4);
    c.fillRect(px, py, 4, BLOCK);
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(px, py + BLOCK - 4, BLOCK, 4);
    c.fillRect(px + BLOCK - 4, py, 4, BLOCK);
    // subtle inner glow ring
    c.strokeStyle = 'rgba(255,255,255,0.15)';
    c.lineWidth = 1;
    c.strokeRect(px + 0.5, py + 0.5, BLOCK - 1, BLOCK - 1);
    // colorblind "labels" mode: stamp the piece letter on the block
    if (colorBlind) {
      const letter = LETTER_BY_COLOR[color];
      if (letter) {
        c.fillStyle = 'rgba(0,0,0,0.72)';
        c.font = 'bold ' + Math.round(BLOCK * 0.6) + 'px ' + 'monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(letter, px + BLOCK / 2, py + BLOCK / 2 + 1);
      }
    }
  }

  function drawGhost(c, x, y, color) {
    const px = x * BLOCK, py = y * BLOCK;
    c.strokeStyle = color + '88';
    c.lineWidth = 2;
    c.strokeRect(px + 2, py + 2, BLOCK - 4, BLOCK - 4);
  }

  function drawPreview(c, type, dim) {
    c.fillStyle = '#15132a';
    c.fillRect(0, 0, 96, 96);
    if (!type) return;
    const s = PIECES[type][0];
    const size = 18;
    const cellW = s[0].length, cellH = s.length;
    const offX = (96 - cellW * size) / 2;
    const offY = (96 - cellH * size) / 2;
    const color = dim ? '#5a5774' : COLORS[type];
    for (let i = 0; i < cellH; i++) {
      for (let j = 0; j < cellW; j++) {
        if (s[i][j]) {
          const px = offX + j * size, py = offY + i * size;
          c.fillStyle = color;
          c.fillRect(px, py, size, size);
          c.fillStyle = 'rgba(255,255,255,0.18)';
          c.fillRect(px, py, size, 2);
          c.fillRect(px, py, 2, size);
          c.fillStyle = 'rgba(0,0,0,0.28)';
          c.fillRect(px, py + size - 2, size, 2);
          c.fillRect(px + size - 2, py, 2, size);
        }
      }
    }
    if (colorBlind && !dim) {
      c.fillStyle = 'rgba(0,0,0,0.72)';
      c.font = 'bold 22px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(type, 48, 49);
    }
  }

  function drawNext() { drawPreview(nextCtx, next.type, false); }
  function drawHold() { drawPreview(holdCtx, hold, !canHold); }

  function updateStats() {
    scoreEl.textContent = score.toLocaleString();
    levelEl.textContent = level;
    linesEl.textContent = lines;
    if (comboEl) {
      const active = combo > 0;
      comboEl.textContent = active ? '×' + combo : '0';  // ×N while active
      const stat = comboEl.closest('.konami-stat');
      if (stat) stat.classList.toggle('kn-combo-live', active);
    }
    const b2bEl = overlay && overlay.querySelector('#kn-b2b');
    if (b2bEl) b2bEl.hidden = !b2bActive;  // badge shows while the B2B chain is live
    if (bestEl) {
      if (score > bestScore) { bestScore = score; isNewBest = true; }  // live PB
      bestEl.textContent = bestScore.toLocaleString();
      const stat = bestEl.closest('.konami-stat');
      if (stat) stat.classList.toggle('kn-best-live', isNewBest);
    }
  }

  // Restart the brief combo pulse each time the streak grows.
  function flashCombo() {
    if (!comboEl) return;
    const stat = comboEl.closest('.konami-stat');
    if (!stat) return;
    stat.classList.remove('kn-combo-pulse');
    void stat.offsetWidth;  // force reflow so the animation replays
    stat.classList.add('kn-combo-pulse');
  }

  // Transient centered callout over the board (TETRIS / T-SPIN / B2B …).
  function flashCallout(text) {
    const el = overlay && overlay.querySelector('.kn-callout');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;  // restart the animation
    el.classList.add('show');
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function restartAnim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // Celebratory shake + white flash for big clears (skipped under reduced motion).
  function flashBigClear() {
    if (prefersReducedMotion()) return;
    restartAnim(overlay && overlay.querySelector('.kn-board-wrap'), 'kn-shake');
    restartAnim(overlay && overlay.querySelector('.kn-flash'), 'show');
  }

  function showMessage(title, sub) {
    const m = overlay.querySelector('#kn-overlay-msg');
    m.innerHTML = '<h3>' + title + '</h3><p>' + sub + '</p>';
    m.hidden = false;
  }

  function hideGameOver() {
    const m = overlay.querySelector('#kn-overlay-msg');
    m.hidden = true;
    initialsMode = false;
  }

  async function showGameOver() {
    SFX.over();
    if (score >= bestScore) { bestScore = score; isNewBest = true; }
    saveBest();
    const m = overlay.querySelector('#kn-overlay-msg');
    m.hidden = false;
    m.innerHTML =
      '<h3>GAME OVER</h3>' +
      '<p class="kn-final">Score: <strong>' + score.toLocaleString() + '</strong> &middot; Lines: ' + lines + '</p>' +
      '<p class="kn-loading">Loading leaderboard&hellip;</p>';

    let top;
    try {
      top = await getTopScores(MAX_SCORES);
    } catch (err) {
      console.warn('Leaderboard fetch failed', err);
      m.innerHTML =
        '<h3>GAME OVER</h3>' +
        '<p class="kn-final">Score: <strong>' + score.toLocaleString() + '</strong> &middot; Lines: ' + lines + '</p>' +
        '<p class="kn-error">Couldn\'t reach the leaderboard. Check your connection.</p>' +
        '<p class="kn-tip">Tap or ENTER to pick level &middot; ESC to quit</p>';
      return;
    }

    const qualifies = score > 0 && (
      top.length < MAX_SCORES ||
      score > top[top.length - 1].score
    );

    if (qualifies) showInitialsPrompt(m, top);
    else renderLeaderboard(m, top, null);
  }

  function showInitialsPrompt(m, currentTop) {
    initialsMode = true;
    m.innerHTML =
      '<img class="kn-cheer" src="assets/bulky-mascot.webp" alt="" aria-hidden="true">' +
      '<h3 class="kn-newhi">NEW HIGH SCORE!</h3>' +
      '<p class="kn-final">Score: <strong>' + score.toLocaleString() + '</strong> &middot; Lines: ' + lines + '</p>' +
      '<form class="kn-initials-form" novalidate>' +
        '<label for="kn-initials">Your initials</label>' +
        '<input id="kn-initials" type="text" maxlength="3" autocomplete="off" inputmode="latin" placeholder="___">' +
        '<p class="kn-initials-error" hidden></p>' +
        '<div class="kn-form-actions">' +
          '<button type="submit" class="kn-btn kn-btn--primary">SUBMIT</button>' +
          '<button type="button" class="kn-btn kn-btn--skip">SKIP</button>' +
        '</div>' +
      '</form>';

    const input = m.querySelector('#kn-initials');
    const form = m.querySelector('form');
    const err = m.querySelector('.kn-initials-error');
    const submitBtn = m.querySelector('button[type="submit"]');
    const skipBtn = m.querySelector('.kn-btn--skip');

    setTimeout(function () { input.focus(); }, 60);

    input.addEventListener('input', function (e) {
      const cleaned = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
      if (cleaned !== e.target.value) e.target.value = cleaned;
      err.hidden = true;
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const val = (input.value || '').trim().toUpperCase();
      if (val.length !== 3) {
        err.textContent = 'Need exactly 3 letters.';
        err.hidden = false;
        input.focus();
        return;
      }
      if (!isValidInitials(val)) {
        err.textContent = 'Try a different combo.';
        err.hidden = false;
        input.select();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'SUBMITTING…';
      try {
        await submitScore(val, score, level, lines);
      } catch (sErr) {
        console.warn('submit failed', sErr);
        err.textContent = 'Submit failed — try again.';
        err.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'SUBMIT';
        return;
      }
      let fresh;
      try { fresh = await getTopScores(MAX_SCORES); }
      catch (e) { fresh = currentTop.concat([{ name: val, score: score, level: level, lines: lines }]).sort(function(a,b){return b.score-a.score;}).slice(0, MAX_SCORES); }
      initialsMode = false;
      renderLeaderboard(m, fresh, { name: val, score: score });
    });

    skipBtn.addEventListener('click', function () {
      initialsMode = false;
      renderLeaderboard(m, currentTop, null);
    });
  }

  function leaderboardRows(scores, justAdded) {
    if (!scores || !scores.length) {
      return '<tr><td colspan="5" class="kn-empty">Be the first to score!</td></tr>';
    }
    return scores.map(function (s, i) {
      const isMe = justAdded && s.name === justAdded.name && s.score === justAdded.score;
      return '<tr class="' + (isMe ? 'kn-just-added' : '') + '">' +
        '<td class="kn-rank">' + (i + 1) + '</td>' +
        '<td class="kn-name">' + escapeHtml(s.name) + '</td>' +
        '<td class="kn-score">' + (s.score || 0).toLocaleString() + '</td>' +
        '<td class="kn-lvcol">' + (s.level || 1) + '</td>' +
        '<td class="kn-lncol">' + (s.lines || 0) + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderLeaderboard(m, scores, justAdded) {
    m.innerHTML =
      '<h3>HIGH SCORES</h3>' +
      '<p class="kn-final">Your run: <strong>' + score.toLocaleString() + '</strong> &middot; Lines: ' + lines +
        (isNewBest ? ' &middot; <span class="kn-pb">NEW BEST!</span>' : '') + '</p>' +
      '<table class="kn-leaderboard">' +
        '<thead><tr><th>#</th><th>Name</th><th>Score</th><th>Lv</th><th>Lines</th></tr></thead>' +
        '<tbody>' + leaderboardRows(scores, justAdded) + '</tbody>' +
      '</table>' +
      '<p class="kn-tip">Tap or ENTER to play again &middot; ESC to quit</p>';
  }

  // ── View the leaderboard mid-game (pauses play) ──────────────────────
  async function viewLeaderboard(e) {
    if (e && e.currentTarget) e.currentTarget.blur();
    if (gameOver || initialsMode || viewingLeaderboard || selectingLevel) return;
    viewingLeaderboard = true;
    paused = true;
    const m = overlay.querySelector('#kn-overlay-msg');
    m.hidden = false;
    m.innerHTML = '<h3>HIGH SCORES</h3><p class="kn-loading">Loading leaderboard&hellip;</p>';

    let top;
    try {
      top = await getTopScores(MAX_SCORES);
    } catch (err) {
      console.warn('Leaderboard fetch failed', err);
      if (!viewingLeaderboard) return;
      m.innerHTML =
        '<h3>HIGH SCORES</h3>' +
        '<p class="kn-error">Couldn\'t reach the leaderboard. Check your connection.</p>' +
        '<div class="kn-form-actions"><button type="button" class="kn-btn kn-btn--primary kn-resume">RESUME</button></div>';
      m.querySelector('.kn-resume').addEventListener('click', closeLeaderboardView);
      return;
    }
    if (!viewingLeaderboard) return; // resumed before the fetch landed

    m.innerHTML =
      '<h3>HIGH SCORES</h3>' +
      '<table class="kn-leaderboard">' +
        '<thead><tr><th>#</th><th>Name</th><th>Score</th><th>Lv</th><th>Lines</th></tr></thead>' +
        '<tbody>' + leaderboardRows(top, null) + '</tbody>' +
      '</table>' +
      '<div class="kn-form-actions"><button type="button" class="kn-btn kn-btn--primary kn-resume">RESUME</button></div>' +
      '<p class="kn-tip">P or ESC to resume</p>';
    m.querySelector('.kn-resume').addEventListener('click', closeLeaderboardView);
  }

  function closeLeaderboardView() {
    if (!viewingLeaderboard) return;
    viewingLeaderboard = false;
    paused = false;
    const m = overlay.querySelector('#kn-overlay-msg');
    m.hidden = true;
    m.innerHTML = '';
  }

  // ── Mobile launcher: tap the footer mascot 5x quickly ────────────────
  (function bindMascotLauncher() {
    const mascots = document.querySelectorAll('.footer-mascot');
    if (!mascots.length) return;
    let taps = 0, timer = null;
    function onTap() {
      taps++;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { taps = 0; }, 700);
      if (taps >= 5) {
        taps = 0;
        clearTimeout(timer);
        if (!isOpen) open();
      }
    }
    mascots.forEach(function (m) {
      m.style.cursor = 'pointer';
      m.addEventListener('click', onTap);
    });
  })();
})();
