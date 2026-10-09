'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// Habilidades cargables
const MAX_ENERGY = 100;
const ENERGY_PER_LINE = 25;
const PEEK_COUNT = 5;
const SLOW_DURATION = 10000; // ms
const SLOW_FACTOR = 2.5;
const SKILL_ORDER = ['peek', 'swap', 'slow', 'undo', 'hold'];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const peekSection = document.getElementById('peek-section');
const peekCanvas = document.getElementById('peek-canvas');
const peekCtx = peekCanvas.getContext('2d');
const energyFill = document.getElementById('energy-fill');
const energyHint = document.getElementById('energy-hint');
const slowEl = document.getElementById('slow-indicator');
const skillMenu = document.getElementById('skill-menu');
const skillButtons = document.querySelectorAll('#skill-menu [data-skill]');
const skillCancel = document.getElementById('skill-cancel');
const skillNote = document.getElementById('skill-note');

let board, current, queue, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let energy, menuOpen, holdType, peekLeft, slowTimer, undoSnapshot;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  return makePiece(Math.floor(Math.random() * 7) + 1);
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = intervalForLevel(level);
    energy = Math.min(MAX_ENERGY, energy + cleared * ENERGY_PER_LINE);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function intervalForLevel(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

function lockPiece() {
  undoSnapshot = {
    board: board.map(row => [...row]),
    score, lines, level,
    type: current.type,
  };
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = queue.shift();
  while (queue.length < PEEK_COUNT) queue.push(randomPiece());
  if (peekLeft > 0) peekLeft--;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  drawPeek();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  const full = energy >= MAX_ENERGY;
  energyFill.style.width = `${(energy / MAX_ENERGY) * 100}%`;
  energyFill.classList.toggle('full', full);
  energyHint.textContent = full ? 'Q: ¡activar!' : `${energy}%`;
  slowEl.classList.toggle('hidden', slowTimer <= 0);
  slowEl.textContent = `LENTO ${Math.ceil(slowTimer / 1000)}s`;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// Dibuja una pieza recortada y centrada en el rectángulo (cx, cy, w, h)
function drawMini(context, shape, cx, cy, w, h, size) {
  const rows = [], cols = [];
  shape.forEach((row, r) => row.forEach((v, c) => {
    if (v) { rows.push(r); cols.push(c); }
  }));
  const minR = Math.min(...rows), maxR = Math.max(...rows);
  const minC = Math.min(...cols), maxC = Math.max(...cols);
  const ox = cx + (w - (maxC - minC + 1) * size) / 2;
  const oy = cy + (h - (maxR - minR + 1) * size) / 2;
  context.save();
  context.translate(ox, oy);
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      drawBlock(context, c - minC, r - minR, shape[r][c], size);
  context.restore();
}

function drawHold() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (holdType) drawMini(holdCtx, PIECES[holdType], 0, 0, holdCanvas.width, holdCanvas.height, 24);
}

function drawPeek() {
  peekSection.classList.toggle('hidden', peekLeft <= 0);
  if (peekLeft <= 0) return;
  peekCtx.clearRect(0, 0, peekCanvas.width, peekCanvas.height);
  const slotH = peekCanvas.height / PEEK_COUNT;
  for (let i = 0; i < PEEK_COUNT; i++)
    drawMini(peekCtx, queue[i].shape, 0, i * slotH, peekCanvas.width, slotH, 14);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = queue[0].shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

// ---- Habilidades ----
function openSkillMenu() {
  if (paused || gameOver || menuOpen || energy < MAX_ENERGY) return;
  menuOpen = true;
  cancelAnimationFrame(animId);
  skillNote.textContent = undoSnapshot ? '' : 'Deshacer no disponible todavía';
  skillMenu.classList.remove('hidden');
}

function closeSkillMenu() {
  menuOpen = false;
  skillMenu.classList.add('hidden');
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

function useSkill(name) {
  if (name === 'undo' && !undoSnapshot) return;
  switch (name) {
    case 'peek':
      peekLeft = PEEK_COUNT + 1; // se descuenta al aparecer la siguiente pieza
      break;
    case 'swap': {
      let type;
      do { type = Math.floor(Math.random() * 7) + 1; } while (type === current.type);
      const piece = makePiece(type);
      piece.y = current.y;
      piece.x = Math.min(current.x, COLS - piece.shape[0].length);
      if (collide(piece.shape, piece.x, piece.y)) { piece.x = makePiece(type).x; piece.y = 0; }
      current = piece;
      if (collide(current.shape, current.x, current.y)) endGame();
      break;
    }
    case 'slow':
      slowTimer = SLOW_DURATION;
      break;
    case 'undo':
      // la pieza activa vuelve al frente de la cola y se recupera la colocada
      queue.unshift(makePiece(current.type));
      board = undoSnapshot.board;
      score = undoSnapshot.score;
      lines = undoSnapshot.lines;
      level = undoSnapshot.level;
      dropInterval = intervalForLevel(level);
      current = makePiece(undoSnapshot.type);
      undoSnapshot = null;
      break;
    case 'hold': {
      const prev = holdType;
      holdType = current.type;
      if (prev) {
        current = makePiece(prev);
        if (collide(current.shape, current.x, current.y)) endGame();
      } else {
        spawn();
      }
      break;
    }
  }
  energy = 0;
  drawHold();
  drawNext();
  drawPeek();
  updateHUD();
  if (!gameOver) closeSkillMenu();
  else skillMenu.classList.add('hidden');
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (slowTimer > 0) {
    slowTimer = Math.max(0, slowTimer - dt);
    updateHUD();
  }
  const interval = slowTimer > 0 ? dropInterval * SLOW_FACTOR : dropInterval;
  if (dropAccum >= interval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  energy = 0;
  menuOpen = false;
  holdType = null;
  peekLeft = 0;
  slowTimer = 0;
  undoSnapshot = null;
  queue = Array.from({ length: PEEK_COUNT + 1 }, randomPiece);
  spawn();
  drawHold();
  updateHUD();
  overlay.classList.add('hidden');
  skillMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (menuOpen) {
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit) useSkill(SKILL_ORDER[digit[1] - 1]);
    else if (e.code === 'Escape' || e.code === 'KeyQ') closeSkillMenu();
    return;
  }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyQ') { openSkillMenu(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

skillButtons.forEach(btn =>
  btn.addEventListener('click', () => useSkill(btn.dataset.skill)));
skillCancel.addEventListener('click', closeSkillMenu);
restartBtn.addEventListener('click', init);

init();
