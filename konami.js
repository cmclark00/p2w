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

  let board, current, next, score, level, lines, dropMs, dropAcc, lastTime, gameOver, paused, rafId;
  let ctx, nextCtx, scoreEl, levelEl, linesEl;
  let overlay;

  function open() {
    if (isOpen) return;
    isOpen = true;
    document.body.style.overflow = 'hidden';
    overlay = document.createElement('div');
    overlay.className = 'konami-overlay';
    overlay.innerHTML =
      '<div class="konami-modal" role="dialog" aria-label="Bulky-Tris">' +
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
            '<div class="konami-stat"><strong>Next</strong>' +
              '<canvas id="kn-next" width="96" height="96"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<p class="konami-controls">' +
          '<span>← →</span> MOVE &middot; <span>↑</span> ROTATE &middot; <span>↓</span> SOFT DROP &middot; ' +
          '<span>SPACE</span> HARD DROP &middot; <span>P</span> PAUSE &middot; <span>ESC</span> QUIT' +
        '</p>' +
        '<div id="kn-overlay-msg" class="kn-msg" hidden></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.konami-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    ctx = overlay.querySelector('#kn-board').getContext('2d');
    nextCtx = overlay.querySelector('#kn-next').getContext('2d');
    scoreEl = overlay.querySelector('#kn-score');
    levelEl = overlay.querySelector('#kn-level');
    linesEl = overlay.querySelector('#kn-lines');

    document.addEventListener('keydown', handleKey);
    startGame();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
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
    if (collides(current, 0, 0, 0)) gameOver = true;
    if (gameOver) showGameOver();
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
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
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

  function drawNext() {
    nextCtx.fillStyle = '#15132a';
    nextCtx.fillRect(0, 0, 96, 96);
    const s = PIECES[next.type][0];
    const size = 18;
    const cellW = s[0].length, cellH = s.length;
    const offX = (96 - cellW * size) / 2;
    const offY = (96 - cellH * size) / 2;
    for (let i = 0; i < cellH; i++) {
      for (let j = 0; j < cellW; j++) {
        if (s[i][j]) {
          const px = offX + j * size, py = offY + i * size;
          nextCtx.fillStyle = COLORS[next.type];
          nextCtx.fillRect(px, py, size, size);
          nextCtx.fillStyle = 'rgba(255,255,255,0.18)';
          nextCtx.fillRect(px, py, size, 2);
          nextCtx.fillRect(px, py, 2, size);
          nextCtx.fillStyle = 'rgba(0,0,0,0.28)';
          nextCtx.fillRect(px, py + size - 2, size, 2);
          nextCtx.fillRect(px + size - 2, py, 2, size);
        }
      }
    }
  }

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
  }

  function showGameOver() {
    showMessage('GAME OVER',
      'Score: ' + score.toLocaleString() + ' &middot; Lines: ' + lines +
      '<br><br>Press ENTER or SPACE to play again, ESC to quit.');
  }
})();
