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

  let board, current, next, hold, canHold, score, level, lines, dropMs, dropAcc, lastTime, gameOver, paused, rafId;
  let ctx, nextCtx, holdCtx, scoreEl, levelEl, linesEl;
  let overlay;
  let initialsMode = false;
  let viewingLeaderboard = false;

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
          '<canvas id="kn-board" width="' + (COLS*BLOCK) + '" height="' + (ROWS*BLOCK) + '"></canvas>' +
          '<div class="konami-side">' +
            '<div class="konami-stat"><strong>Score</strong><span id="kn-score">0</span></div>' +
            '<div class="konami-stat"><strong>Level</strong><span id="kn-level">1</span></div>' +
            '<div class="konami-stat"><strong>Lines</strong><span id="kn-lines">0</span></div>' +
            '<div class="konami-stat"><strong>Hold</strong>' +
              '<canvas id="kn-hold" width="96" height="96"></canvas>' +
            '</div>' +
            '<div class="konami-stat"><strong>Next</strong>' +
              '<canvas id="kn-next" width="96" height="96"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<p class="konami-controls">' +
          '<span>← →</span> MOVE &middot; <span>↑</span> ROTATE &middot; <span>↓</span> SOFT DROP &middot; ' +
          '<span>SPACE</span> HARD DROP &middot; <span>C</span> HOLD &middot; <span>P</span> PAUSE &middot; <span>ESC</span> QUIT' +
        '</p>' +
        '<div class="konami-actions">' +
          '<button type="button" class="kn-btn kn-btn--board">LEADERBOARD</button>' +
        '</div>' +
        '<div id="kn-overlay-msg" class="kn-msg" hidden></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.konami-close').addEventListener('click', close);
    overlay.querySelector('.kn-btn--board').addEventListener('click', viewLeaderboard);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    ctx = overlay.querySelector('#kn-board').getContext('2d');
    nextCtx = overlay.querySelector('#kn-next').getContext('2d');
    holdCtx = overlay.querySelector('#kn-hold').getContext('2d');
    scoreEl = overlay.querySelector('#kn-score');
    levelEl = overlay.querySelector('#kn-level');
    linesEl = overlay.querySelector('#kn-lines');

    document.addEventListener('keydown', handleKey);
    startGame();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    initialsMode = false;
    viewingLeaderboard = false;
    document.removeEventListener('keydown', handleKey);
    if (rafId) cancelAnimationFrame(rafId);
    document.body.style.overflow = '';
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function startGame() {
    board = Array.from({length: ROWS}, () => Array(COLS).fill(null));
    score = 0; level = 1; lines = 0;
    dropMs = 800; dropAcc = 0; lastTime = 0;
    gameOver = false; paused = false;
    hold = null; canHold = true;
    next = spawnPiece();
    current = spawnPiece();
    updateStats();
    drawAll();
    rafId = requestAnimationFrame(loop);
  }

  function spawnPiece() {
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
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
    clearLines();
    current = next;
    next = spawnPiece();
    canHold = true;
    if (collides(current, 0, 0, 0)) gameOver = true;
    if (gameOver) showGameOver();
  }

  function holdPiece() {
    if (!canHold) return;
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
    if (collides(current, 0, 0, 0)) { gameOver = true; showGameOver(); }
  }

  function clearLines() {
    let cleared = 0;
    for (let i = ROWS - 1; i >= 0; i--) {
      if (board[i].every(c => c)) {
        board.splice(i, 1);
        board.unshift(Array(COLS).fill(null));
        cleared++;
        i++;
      }
    }
    if (cleared) {
      lines += cleared;
      score += [0, 100, 300, 500, 800][cleared] * level;
      const newLevel = Math.floor(lines / 10) + 1;
      if (newLevel > level) {
        level = newLevel;
        dropMs = Math.max(80, 800 - (level - 1) * 60);
      }
      updateStats();
    }
  }

  function move(dx) { if (!collides(current, dx, 0, 0)) current.x += dx; }
  function softDrop() {
    if (!collides(current, 0, 1, 0)) { current.y++; score++; updateStats(); }
    else lock();
  }
  function hardDrop() {
    let dropped = 0;
    while (!collides(current, 0, 1, 0)) { current.y++; dropped++; }
    score += dropped * 2;
    updateStats();
    lock();
  }
  function rotate(dir) {
    if (!collides(current, 0, 0, dir)) {
      current.rot = (current.rot + dir + 4) % PIECES[current.type].length;
      return;
    }
    for (const kick of [-1, 1, -2, 2]) {
      if (!collides(current, kick, 0, dir)) {
        current.x += kick;
        current.rot = (current.rot + dir + 4) % PIECES[current.type].length;
        return;
      }
    }
  }

  function handleKey(e) {
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
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideGameOver(); startGame(); }
      return;
    }
    if (e.key === 'p' || e.key === 'P') {
      paused = !paused;
      if (paused) showMessage('PAUSED', 'Press P to resume');
      else hideGameOver();
      e.preventDefault();
      return;
    }
    if (paused) return;
    switch (e.key) {
      case 'ArrowLeft':  move(-1); e.preventDefault(); break;
      case 'ArrowRight': move(1);  e.preventDefault(); break;
      case 'ArrowDown':  softDrop(); e.preventDefault(); break;
      case 'ArrowUp':
      case 'x': case 'X': rotate(1); e.preventDefault(); break;
      case 'z': case 'Z': rotate(-1); e.preventDefault(); break;
      case ' ':          hardDrop(); e.preventDefault(); break;
      case 'c': case 'C': case 'Shift': holdPiece(); e.preventDefault(); break;
    }
  }

  function loop(t) {
    if (!isOpen) return;
    const dt = lastTime ? t - lastTime : 0;
    lastTime = t;
    if (!gameOver && !paused) {
      dropAcc += dt;
      if (dropAcc >= dropMs) {
        dropAcc = 0;
        if (!collides(current, 0, 1, 0)) current.y++;
        else lock();
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
    // settled blocks
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        if (board[i][j]) drawBlock(ctx, j, i, board[i][j]);
      }
    }
    // ghost piece
    if (!gameOver) {
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
  }

  function drawNext() { drawPreview(nextCtx, next.type, false); }
  function drawHold() { drawPreview(holdCtx, hold, !canHold); }

  function updateStats() {
    scoreEl.textContent = score.toLocaleString();
    levelEl.textContent = level;
    linesEl.textContent = lines;
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
        '<p class="kn-tip">Press ENTER to play again &middot; ESC to quit</p>';
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
      return '<tr><td colspan="3" class="kn-empty">Be the first to score!</td></tr>';
    }
    return scores.map(function (s, i) {
      const isMe = justAdded && s.name === justAdded.name && s.score === justAdded.score;
      return '<tr class="' + (isMe ? 'kn-just-added' : '') + '">' +
        '<td class="kn-rank">' + (i + 1) + '</td>' +
        '<td class="kn-name">' + escapeHtml(s.name) + '</td>' +
        '<td class="kn-score">' + (s.score || 0).toLocaleString() + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderLeaderboard(m, scores, justAdded) {
    m.innerHTML =
      '<h3>HIGH SCORES</h3>' +
      '<p class="kn-final">Your run: <strong>' + score.toLocaleString() + '</strong> &middot; Lines: ' + lines + '</p>' +
      '<table class="kn-leaderboard">' +
        '<thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>' +
        '<tbody>' + leaderboardRows(scores, justAdded) + '</tbody>' +
      '</table>' +
      '<p class="kn-tip">ENTER to play again &middot; ESC to quit</p>';
  }

  // ── View the leaderboard mid-game (pauses play) ──────────────────────
  async function viewLeaderboard(e) {
    if (e && e.currentTarget) e.currentTarget.blur();
    if (gameOver || initialsMode || viewingLeaderboard) return;
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
        '<thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>' +
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
})();
