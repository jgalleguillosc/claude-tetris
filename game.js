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
  '#6b6b80', // basura / bloques fijos - gris
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

const GARBAGE = 8;
const REVERSE_FROM_LEVEL = 5;

// Modos de juego. `time` es un límite (ms), `survive` el tiempo (ms) a sobrevivir,
// `lines`/`level` son metas a alcanzar.
const MODES = {
  classic:   { name: 'Clásico', desc: 'Sin objetivo. Juega hasta perder.' },
  sprint:    { name: 'Sprint', desc: 'Limpia 40 líneas en 2 minutos.', lines: 40, time: 120000 },
  garbage:   { name: 'Basura', desc: 'Sobrevive 90 s: sube basura desde abajo cada 10 s.', survive: 90000, garbageEvery: 10000 },
  preset:    { name: 'Bloques fijos', desc: 'Tablero con bloques pre-colocados. Limpia 15 líneas.', lines: 15, preset: true },
  invisible: { name: 'Invisibles', desc: 'Las piezas se vuelven invisibles al tocar el suelo. Limpia 10 líneas.', lines: 10, invisible: true },
  reverse:   { name: 'Rotación inversa', desc: `Desde el nivel ${REVERSE_FROM_LEVEL} la rotación se invierte. Llega al nivel 8.`, level: 8, reverse: true },
};

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
const modeSelect = document.getElementById('mode-select');
const objectiveEl = document.getElementById('objective');
const timerEl = document.getElementById('timer');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let mode, elapsed, garbageAccum;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
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

function rotateCCW(shape) {
  return rotateCW(rotateCW(rotateCW(shape)));
}

function tryRotate() {
  const inverted = mode.reverse && level >= REVERSE_FROM_LEVEL;
  const rotated = inverted ? rotateCCW(current.shape) : rotateCW(current.shape);
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
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
    checkGoal();
  }
}

function addGarbageRow() {
  if (board[0].some(v => v !== 0)) { endGame(false, 'GAME OVER'); return; }
  board.shift();
  const hole = Math.floor(Math.random() * COLS);
  board.push(Array.from({ length: COLS }, (_, c) => (c === hole ? 0 : GARBAGE)));
  // la pieza actual sube con el tablero; si queda atrapada, se pierde
  if (collide(current.shape, current.x, current.y)) {
    current.y--;
    if (collide(current.shape, current.x, current.y)) endGame(false, 'GAME OVER');
  }
}

function applyPreset() {
  // 5 filas inferiores con bloques fijos y al menos un hueco por fila
  for (let r = ROWS - 5; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (Math.random() < 0.6) board[r][c] = GARBAGE;
    }
    board[r][Math.floor(Math.random() * COLS)] = 0;
  }
}

function checkGoal() {
  if (gameOver) return;
  if ((mode.lines && lines >= mode.lines) || (mode.level && level >= mode.level)) {
    endGame(true, '¡OBJETIVO CUMPLIDO!');
  }
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function updateObjective() {
  let text = mode.desc;
  if (mode.lines) text += ` (${Math.min(lines, mode.lines)}/${mode.lines})`;
  if (mode.level) text += ` (nivel ${level}/${mode.level})`;
  objectiveEl.textContent = text;
  if (mode.time) timerEl.textContent = formatTime(mode.time - elapsed);
  else if (mode.survive) timerEl.textContent = formatTime(mode.survive - elapsed);
  else timerEl.textContent = formatTime(elapsed);
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

function lockPiece() {
  merge();
  clearLines();
  if (gameOver) return;
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  updateObjective();
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
      if (!(mode.invisible && board[r][c] !== GARBAGE)) drawBlock(ctx, c, r, board[r][c], BLOCK);

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

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame(win = false, title = 'GAME OVER') {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.classList.toggle('win', win);
  overlayTitle.textContent = title;
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
    overlayTitle.classList.remove('win');
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  elapsed += dt;
  if (mode.garbageEvery) {
    garbageAccum += dt;
    if (garbageAccum >= mode.garbageEvery) {
      garbageAccum -= mode.garbageEvery;
      addGarbageRow();
    }
  }
  if (!gameOver && mode.survive && elapsed >= mode.survive) endGame(true, '¡SOBREVIVISTE!');
  if (!gameOver && mode.time && elapsed >= mode.time) endGame(false, 'TIEMPO AGOTADO');
  if (gameOver) { updateHUD(); draw(); return; }
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) { updateHUD(); draw(); return; }
  updateObjective();
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  mode = MODES[modeSelect.value];
  elapsed = 0;
  garbageAccum = 0;
  board = createBoard();
  if (mode.preset) applyPreset();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
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

restartBtn.addEventListener('click', init);
modeSelect.addEventListener('change', () => { modeSelect.blur(); init(); });
for (const [key, m] of Object.entries(MODES)) {
  modeSelect.add(new Option(m.name, key));
}

init();
