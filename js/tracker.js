// Follows a game from noisy board readings. A reading is an array of 64 entries
// in chess.js SQUARES order (a8, b8, ... h1), each '' or a piece code like 'wP'.
// Instead of trusting a reading outright, we look for the legal move(s) that
// turn the known position into it. That survives the odd misread square.

import { Chess, SQUARES } from '../vendor/chess.js';

export const squareIndex = (sq) => SQUARES.indexOf(sq);

export function readingFromChess(chess) {
  const out = [];
  for (const row of chess.board()) {
    for (const c of row) out.push(c ? c.color + c.type.toUpperCase() : '');
  }
  return out;
}

export function mismatches(a, b) {
  let n = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++;
  return n;
}

const START = readingFromChess(new Chess());

// Result kinds:
//   same     nothing to do
//   moves    apply result.moves ([{from,to,promotion}]) in order
//   undo     take back result.plies half-moves
//   newgame  the screen shows the starting position again
//   lost     the reading matches nothing we can explain
export function track(chess, reading, startFen) {
  const cur = readingFromChess(chess);
  const curMis = mismatches(reading, cur);
  if (curMis === 0) return { kind: 'same' };

  // One legal move, exact.
  const probe = new Chess(chess.fen());
  const first = probe.moves({ verbose: true });
  const scored = first.map((m) => {
    probe.move(m);
    const mis = mismatches(reading, readingFromChess(probe));
    probe.undo();
    return { m, mis };
  });
  const exact = scored.filter((s) => s.mis === 0);
  if (exact.length >= 1) return { kind: 'moves', moves: [toMove(exact[0].m)] };

  // Taking back moves: the reading equals an earlier position.
  if (startFen) {
    const walk = new Chess(startFen);
    const keys = [readingFromChess(walk)];
    for (const san of chess.history()) {
      walk.move(san);
      keys.push(readingFromChess(walk));
    }
    for (let p = keys.length - 2; p >= 0; p--) {
      if (mismatches(reading, keys[p]) === 0) {
        return { kind: 'undo', plies: keys.length - 1 - p };
      }
    }
  }

  // A brand-new game while we were looking elsewhere.
  if (mismatches(reading, START) <= 1 && curMis > 3) return { kind: 'newgame' };

  // Two moves at once (fast opponent, or a missed frame).
  for (const a of first) {
    probe.move(a);
    for (const b of probe.moves({ verbose: true })) {
      probe.move(b);
      const mis = mismatches(reading, readingFromChess(probe));
      probe.undo();
      if (mis === 0) {
        const out = { kind: 'moves', moves: [toMove(a), toMove(b)] };
        probe.undo();
        return out;
      }
    }
    probe.undo();
  }

  // Tolerate a misread square: a move that explains all but one square wins.
  const near = scored.filter((s) => s.mis <= 1).sort((x, y) => x.mis - y.mis);
  if (near.length === 1) return { kind: 'moves', moves: [toMove(near[0].m)] };
  // A few stray squares that no move explains are overlays (arrows, hover effects), not a new position.
  if (curMis <= 3) return { kind: 'same' };
  return { kind: 'lost' };
}

const toMove = (m) => ({ from: m.from, to: m.to, promotion: m.promotion });

// FEN from a reading. The side to move and castling rights have to be supplied
// or guessed, a screenshot cannot tell us.
export function readingToFen(reading, turn = 'w') {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = reading[r * 8 + f];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const at = (sq) => reading[squareIndex(sq)];
  let castling = '';
  if (at('e1') === 'wK' && at('h1') === 'wR') castling += 'K';
  if (at('e1') === 'wK' && at('a1') === 'wR') castling += 'Q';
  if (at('e8') === 'bK' && at('h8') === 'bR') castling += 'k';
  if (at('e8') === 'bK' && at('a8') === 'bR') castling += 'q';
  return `${rows.join('/')} ${turn} ${castling || '-'} - 0 1`;
}
