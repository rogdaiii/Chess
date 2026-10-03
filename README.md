# Chess Overlay Helper

A chess board that helps you in one of two ways. It runs completely in the browser,
the engine is Stockfish 17.1 (WASM) shipped in `vendor/`. No build step, no accounts,
nothing leaves your machine.

## Run it

Browsers refuse to start web workers and WASM from `file://`, so serve the folder:

```
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Tests for the reasoning layer: `npm test` (Node 20+).

## The two modes

**Full Help.** The engine does the thinking for you.
- Arrows on the board for its top three moves (green is best), an evaluation bar,
  and the main line in plain notation.
- A one sentence reason for the best move ("Wins a free knight", "Develops the bishop", ...).
- Click a line or the *Play* button to play it. *Autopilot* plays the best move for you every turn.

**Tips & Corrections.** You do the thinking, it checks your work.
- The engine stays hidden. A threat radar rings your hanging pieces in red and loose enemy
  pieces in green, and gives opening advice when nothing is on fire.
- *Hint* escalates in three steps: the theme, the piece to look at, the move.
- After every move you get a grade (best, excellent, good, inaccuracy, mistake, blunder) based
  on how much winning chance you gave up, with the reason: the mate you allow, the piece you
  hang, the threat you ignored, the tactic you missed.
- On a mistake or blunder the game pauses before the opponent replies, so you can
  *take back*, *take back and show the best move*, or *keep it*.

## Watch a game on your screen

For games against bots or the computer (chess.com bots, Lichess vs Stockfish, a local engine)
and for reviewing your own games.

1. Open the game in another window, at the starting position.
2. Press *Share game window* and pick that window. Your browser asks for screen recording
   permission once (on a Mac: System Settings > Privacy & Security > Screen Recording).
3. Drag a box around the board. The grid snaps onto the squares by itself, then press *Calibrate*.
   Calibration learns what the pieces look like on your screen, so it works with any board theme.
4. From then on the helper follows the game. Your moves and the bot's moves are picked up from
   the screen. Full Help shows the best move on the helper's own board, Tips & Corrections grades
   what you played (no take back here, the other site owns the game).

*Pop out* (Chrome and Edge) moves the helper into a small always-on-top window you can park next
to the game. *Sync from screen* re-reads the whole board if it ever loses track, *Recalibrate*
if you resize the game window or change the board theme.

Limits: calibration needs the starting position on screen, the board must stay fully visible and
should not be covered, and a game that starts mid-way needs *Sync from screen* after calibrating on
a fresh board. Arrows and highlights drawn by the site are tolerated.

## Setup

- Play White, Black, or both sides. Opponent strength is 1320 to 3190 Elo.
- Paste any FEN to analyse a position from your own games, then play it out with *Both sides*.
- Flip, undo, copy FEN, adjustable analysis depth.

## About live games

Screen watching is meant for bots, the computer and your own analysis. Using engine help against
a human opponent in an online game is cheating and gets accounts banned, so do not point this at
one.

## Layout

```
index.html, style.css     UI
js/app.js                 game flow, modes, panels, pop-out window
js/board.js               board, drag and click input, arrow/ring overlay layer
js/engine.js              UCI wrapper for the Stockfish worker
js/watch.js               screen capture, board picker, follow loop
js/vision.js              board finding, calibration, piece reading from pixels
js/tracker.js             turns noisy readings into legal moves (no DOM, unit tested)
js/analysis.js            scores, grading, explanations (no DOM, unit tested)
vendor/                   chess.js (BSD-2), Stockfish 17.1 lite (GPL-3)
assets/pieces/            cburnett piece set
```

Licensed GPL-3.0-or-later because of the bundled Stockfish.
