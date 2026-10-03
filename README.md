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

## Setup

- Play White, Black, or both sides. Opponent strength is 1320 to 3190 Elo.
- Paste any FEN to analyse a position from your own games, then play it out with *Both sides*.
- Flip, undo, copy FEN, adjustable analysis depth.

## About live games

This does not read the screen or hook into chess.com or Lichess. Using engine help during a
rated game is cheating and gets accounts banned. Use it against the built-in opponent, for
training, and for analysing your own finished games.

## Layout

```
index.html, style.css     UI
js/app.js                 game flow, modes, panels
js/board.js               board, drag and click input, arrow/ring overlay layer
js/engine.js              UCI wrapper for the Stockfish worker
js/analysis.js            scores, grading, explanations (no DOM, unit tested)
vendor/                   chess.js (BSD-2), Stockfish 17.1 lite (GPL-3)
assets/pieces/            cburnett piece set
```

Licensed GPL-3.0-or-later because of the bundled Stockfish.
