# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A classic Tetris implementation in vanilla JavaScript, rendered with the HTML5 Canvas 2D API. Zero dependencies, zero build step: no `package.json`, no bundler, no transpiler, no linter, no test framework. The entire game lives in one file, `game.js`.

## Running the game

There is no build/install step. Either:
- Open `index.html` directly in a browser, or
- Serve the directory statically and visit it (recommended, avoids some browser file:// restrictions):
  - `python3 -m http.server 8000`
  - `npx serve .`
  - `php -S localhost:8000`

There is no test suite and no lint/format tooling configured — verify changes by opening the game in a browser and playing it.

## Controls

- ← / → : move
- ↑ or X : rotate clockwise
- ↓ : soft drop
- Space : hard drop
- C or Shift : hold piece (once per spawn; power-ups cannot be held)
- P : pause/resume

## Architecture (game.js)

Everything is procedural, module-scope global state — no classes, no imports. `index.html` loads `style.css` then `game.js`; the last line of `game.js` calls `init()`, which resets state and starts the loop.

- **Constants** (top of file): `COLS=10`, `ROWS=20`, `BLOCK=30` (px per cell), `COLORS[]` (indexed by piece id 1-7), `PIECES[]` (the 7 tetromino shape matrices, null-padded at index 0), `LINE_SCORES=[0,100,300,500,800]`.
- **Board model**: `board` is a `ROWS × COLS` matrix of 0 (empty) or a color-index 1-7 (locked cell), built by `createBoard()`.
- **Piece state**: `current` / `next` hold the active/preview piece. `randomPiece()` spawns a new tetromino centered at the top.
- **Rotation**: `rotateCW(shape)` transposes+reverses the shape matrix; `tryRotate()` applies it and attempts wall-kick offsets `[0,-1,1,-2,2]` until one doesn't collide.
- **Collision/locking**: `collide(shape, ox, oy)` checks bounds/overlap against `board`. `lockPiece()` = `merge()` (bakes the piece into `board`) + `clearLines()` (scans bottom-up, removes full rows, updates score/lines/level/dropInterval) + spawn next piece.
- **Dropping**: `softDrop()` (down arrow, +1 pt/row) vs `hardDrop()`/`ghostY()` (space, instant drop to the ghost position, +2 pts/row). The ghost piece is drawn at `globalAlpha=0.2`.
- **Game loop**: `loop(ts)` is driven by `requestAnimationFrame`, accumulates elapsed time, advances the piece by one row once `dropAccum >= dropInterval`, then calls `draw()` and reschedules itself.
- **Rendering**: `draw()` clears and redraws the grid + locked board + ghost piece + active piece on `#board` every frame; `drawNext()` renders the preview piece on the separate `#next-canvas`.
- **Lifecycle**: `init()` (reset + start loop), `togglePause()` (P key, starts/stops the rAF loop), `endGame()` (stops the loop, shows the Game Over overlay). The restart button's click handler calls `init()` again.
- **Hold**: `held` stores a piece type, `holdUsed` blocks re-holding until the next `spawn()`. `holdPiece()` swaps or stashes; `drawHold()` renders `#hold-canvas`.
- **Power-ups**: every `POWERUP_EVERY` (5) cleared lines sets `powerPending`, so the next `randomPiece()` is a 1×1 power-up (ids 9-13 in `POWERUPS`: bomb, lightning, tint, gravity, freeze). On landing, `lockPiece()` calls `applyPowerUp()` instead of `merge()`. Tint turns the most common color into `WILD` (8). Freeze pauses gravity for `FREEZE_MS` via `freezeLeft`; a toast (`toastText`/`toastLeft`) announces each effect.
- **Input**: a single `keydown` listener dispatches ArrowLeft/Right/Down/Up, KeyX, KeyC/Shift, Space, KeyP, and calls `preventDefault()` on arrows/Space to stop page scrolling.

### Changing board dimensions
If you change `COLS`, `ROWS`, or `BLOCK` in `game.js`, you must also update the `<canvas id="board">` `width`/`height` attributes in `index.html` to match, or rendering will be clipped/misaligned.
