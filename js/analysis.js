// Pure chess reasoning on top of chess.js: scores, move grading and the plain
// language explanations. No DOM in here so it can be tested from Node.

import { Chess } from '../vendor/chess.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const other = (c) => (c === 'w' ? 'b' : 'w');

export const uciToMove = (uci) => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  promotion: uci.length > 4 ? uci[4] : undefined,
});

export function sanOf(fen, uci) {
  try {
    return new Chess(fen).move(uciToMove(uci)).san;
  } catch {
    return uci;
  }
}

// ---------------------------------------------------------------- scores

const MATE_CP = 10000;

// UCI scores are from the side to move. Return centipawns from White's view.
export function whiteCp(score, turn) {
  let cp;
  if (score.mate !== undefined) {
    cp = score.mate === 0 ? -MATE_CP : Math.sign(score.mate) * (MATE_CP - Math.abs(score.mate) * 10);
  } else {
    cp = score.cp;
  }
  return turn === 'w' ? cp : -cp;
}

// 0..100 chance of winning for the side the cp value favours (Lichess curve).
export const winPercent = (cp) => 100 / (1 + Math.exp(-0.00368208 * cp));

export function formatScore(score, turn) {
  if (score.mate !== undefined) {
    const m = turn === 'w' ? score.mate : -score.mate;
    return `${m > 0 ? '+' : '-'}M${Math.abs(m)}`;
  }
  const v = whiteCp(score, turn) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

export const QUALITY = {
  best: { label: 'Best move', glyph: '★', rank: 0 },
  excellent: { label: 'Excellent', glyph: '✓', rank: 1 },
  good: { label: 'Good', glyph: '✓', rank: 2 },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', rank: 3 },
  mistake: { label: 'Mistake', glyph: '?', rank: 4 },
  blunder: { label: 'Blunder', glyph: '??', rank: 5 },
};

// loss = drop in the mover's winning chance, in percentage points.
export function classify(loss, isBest) {
  if (isBest) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 15) return 'mistake';
  return 'blunder';
}

// ------------------------------------------------------------ tactics radar

// Pieces of `color` that the opponent can win material on right now: either
// not defended at all, or attacked by something cheaper.
export function enPrise(chess, color) {
  const out = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== color || cell.type === 'k') continue;
      const attackers = chess.attackers(cell.square, other(color));
      if (!attackers.length) continue;
      const defended = chess.attackers(cell.square, color).length > 0;
      // A king can't take a defended piece.
      const types = attackers.map((s) => chess.get(s).type).filter((t) => !(defended && t === 'k'));
      if (!types.length) continue;
      const cheapest = Math.min(...types.map((t) => VALUE[t]));
      if (!defended) {
        out.push({ square: cell.square, piece: cell.type, color, reason: 'loose', gain: VALUE[cell.type] });
      } else if (cheapest < VALUE[cell.type]) {
        out.push({ square: cell.square, piece: cell.type, color, reason: 'outvalued', gain: VALUE[cell.type] - cheapest });
      }
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

export function material(chess, color) {
  let total = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) total += (cell.color === color ? 1 : -1) * VALUE[cell.type];
    }
  }
  return total;
}

const article = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');

export function threatSentences(chess, color) {
  const mine = enPrise(chess, color).map((e) =>
    e.reason === 'loose'
      ? `Your ${NAME[e.piece]} on ${e.square} is attacked and has no protection.`
      : `Your ${NAME[e.piece]} on ${e.square} is attacked by a cheaper piece.`,
  );
  const theirs = enPrise(chess, other(color)).map((e) =>
    e.reason === 'loose'
      ? `Their ${NAME[e.piece]} on ${e.square} is loose. You can take it.`
      : `Their ${NAME[e.piece]} on ${e.square} can be won with a cheaper piece.`,
  );
  return { mine, theirs };
}

const HOME = {
  w: { n: ['b1', 'g1'], b: ['c1', 'f1'] },
  b: { n: ['b8', 'g8'], b: ['c8', 'f8'] },
};

export function openingTip(chess, color) {
  if (chess.moveNumber() > 12) return null;
  let undeveloped = 0;
  for (const type of ['n', 'b']) {
    for (const sq of HOME[color][type]) {
      const p = chess.get(sq);
      if (p && p.color === color && p.type === type) undeveloped++;
    }
  }
  if (undeveloped > 0) {
    return `Develop your knights and bishops. ${undeveloped} still ${undeveloped === 1 ? 'sits' : 'sit'} at home.`;
  }
  const rights = chess.getCastlingRights(color);
  if (rights.k || rights.q) return 'Your minor pieces are out. Castle to get the king safe.';
  const centre = ['d4', 'e4', 'd5', 'e5'].some((sq) => {
    const p = chess.get(sq);
    return p && p.color === color && p.type === 'p';
  });
  if (!centre) return 'Put a pawn in the centre (d4/e4 or d5/e5) or hit it with a piece.';
  return null;
}

// ------------------------------------------------------- move descriptions

// Describe a move (UCI) in the given position in plain language.
export function describeMove(fen, uci) {
  const before = new Chess(fen);
  const mover = before.turn();
  const after = new Chess(fen);
  const mv = after.move(uciToMove(uci));
  const parts = [];
  let theme = 'quiet';
  const setTheme = (t) => {
    if (theme === 'quiet') theme = t;
  };

  const enemyBefore = enPrise(before, other(mover));
  const ownBefore = enPrise(before, mover);

  if (mv.san.endsWith('#')) {
    parts.push('Checkmate.');
    setTheme('mate');
  }
  if (mv.captured) {
    const target = enemyBefore.find((e) => e.square === mv.to);
    const cv = VALUE[mv.captured];
    const pv = VALUE[mv.piece];
    if (target && target.reason === 'loose') parts.push(`Wins a free ${NAME[mv.captured]} on ${mv.to}.`);
    else if (cv > pv) parts.push(`Wins ${article(NAME[mv.captured])} ${NAME[mv.captured]} for ${article(NAME[mv.piece])} ${NAME[mv.piece]}.`);
    else if (cv === pv) parts.push(`Trades your ${NAME[mv.piece]} for their ${NAME[mv.captured]}.`);
    else parts.push(`Takes the ${NAME[mv.captured]} on ${mv.to}.`);
    setTheme('capture');
  }
  if (mv.promotion) {
    parts.push(`Promotes to ${article(NAME[mv.promotion])} ${NAME[mv.promotion]}.`);
    setTheme('promotion');
  }
  if (mv.isKingsideCastle() || mv.isQueensideCastle()) {
    parts.push('Castles: the king gets safe and the rook joins the game.');
    setTheme('castle');
  }
  if (mv.san.endsWith('+') && !mv.san.endsWith('#')) {
    parts.push('Gives check.');
    setTheme('check');
  }
  if (!mv.captured && (mv.piece === 'n' || mv.piece === 'b') && before.moveNumber() <= 12) {
    const backRank = mover === 'w' ? '1' : '8';
    if (mv.from[1] === backRank && mv.to[1] !== backRank) {
      parts.push(`Develops the ${NAME[mv.piece]}.`);
      setTheme('develop');
    }
  }
  if (mv.piece === 'p' && !mv.captured && ['d4', 'e4', 'd5', 'e5'].includes(mv.to)) {
    parts.push('Claims space in the centre.');
  }
  if (ownBefore.length) {
    const top = ownBefore[0];
    const now = enPrise(after, mover).some((e) => e.square === (top.square === mv.from ? mv.to : top.square));
    if (!now) {
      parts.push(`Saves your ${NAME[top.piece]} on ${top.square}.`);
      setTheme('defend');
    }
  }
  if (!mv.san.endsWith('#')) {
    const fresh = enPrise(after, other(mover)).filter((e) => !enemyBefore.some((b) => b.square === e.square));
    if (fresh.length) {
      parts.push(`Threatens their ${NAME[fresh[0].piece]} on ${fresh[0].square}.`);
      setTheme('threat');
    }
  }
  if (!parts.length) parts.push('A quiet move that improves your position.');
  return { san: mv.san, text: parts.slice(0, 3).join(' '), theme, captured: mv.captured || null };
}

const THEME_HINT = {
  mate: 'There is a forced checkmate. Look at your checks.',
  capture: 'Material is on offer here. Look at the captures.',
  promotion: 'A pawn is ready to promote.',
  defend: 'Something of yours is under attack. Sort that out first.',
  check: 'A forcing check works well here.',
  castle: 'King safety matters now. Think about castling.',
  develop: 'Bring another piece into the game.',
  threat: 'Look for a move that creates a threat.',
  quiet: 'No tactics on the board. Look for a calm, useful move.',
};

// Three escalating hints for the engine's best move.
export function hintLevels(fen, uci, score) {
  const d = describeMove(fen, uci);
  const theme = score && score.mate > 0 ? 'mate' : d.theme;
  const piece = new Chess(fen).get(uci.slice(0, 2)).type;
  return [
    THEME_HINT[theme],
    `Think about your ${NAME[piece]} on ${uci.slice(0, 2)}.`,
    `Best move: ${d.san}. ${d.text}`,
  ];
}

// ------------------------------------------------------- mistake feedback

const MISSED_NOUN = {
  mate: 'a forced checkmate',
  capture: 'a chance to win material',
  promotion: 'a promotion',
};

// Explain why `playedUci` was worse than `bestUci`.
//  replyPv:    engine's line after the played move (first move is the reply)
//  afterScore: score of the position after the move, side to move's view
export function explainMistake({ fenBefore, playedUci, bestUci, replyPv, afterScore, loss, evalBefore, evalAfter }) {
  const before = new Chess(fenBefore);
  const mover = before.turn();
  const after = new Chess(fenBefore);
  const played = after.move(uciToMove(playedUci));
  const reasons = [];

  // Walk the engine's refutation a few plies and watch the material.
  const walk = new Chess(after.fen());
  const base = material(before, mover);
  let first = null;
  const sans = [];
  let balanceAt = {};
  for (let i = 0; i < Math.min(replyPv.length, 4); i++) {
    let m;
    try {
      m = walk.move(uciToMove(replyPv[i]));
    } catch {
      break;
    }
    sans.push(m.san);
    if (i === 0) first = m;
    balanceAt[i + 1] = material(walk, mover);
  }
  const plies = sans.length;
  const settled = plies >= 2 ? (plies >= 4 ? 4 : 2) : plies;
  const net = plies ? balanceAt[settled] - base : 0;

  if (first && first.san.endsWith('#')) {
    reasons.push(`Allows checkmate with ${first.san}.`);
  } else if (afterScore && afterScore.mate > 0) {
    reasons.push(`Allows a forced mate in ${afterScore.mate}.`);
  } else if (first && net <= -2) {
    reasons.push(
      first.captured
        ? `Allows ${first.san}, which wins your ${NAME[first.captured]} on ${first.to}. You end up ${-net} points down.`
        : `Allows ${first.san}, and you end up ${-net} points down in the exchanges that follow.`,
    );
  } else if (first && first.captured && net < 0) {
    reasons.push(`Allows ${first.san}, winning your ${NAME[first.captured]}.`);
  }

  const afterOwn = enPrise(after, mover);
  const covered = (sq) => first && first.captured && first.to === sq;
  const movedExposed = afterOwn.find((e) => e.square === played.to);
  if (movedExposed && !covered(movedExposed.square) && !reasons.length) {
    reasons.push(`Your ${NAME[movedExposed.piece]} on ${movedExposed.square} can be taken for free or a bad trade.`);
  }
  for (const e of enPrise(before, mover)) {
    if (e.square === played.from) continue;
    if (afterOwn.some((o) => o.square === e.square) && !covered(e.square)) {
      reasons.push(`You ignored the attack on your ${NAME[e.piece]} on ${e.square}.`);
      break;
    }
  }

  let missed = null;
  if (bestUci && bestUci !== playedUci) {
    const best = describeMove(fenBefore, bestUci);
    if (MISSED_NOUN[best.theme] && (best.theme !== 'capture' || loss >= 10)) {
      missed = { theme: best.theme, text: `You missed ${MISSED_NOUN[best.theme]}.` };
    }
  }
  if (!reasons.length && !missed) {
    reasons.push(`The evaluation drops from ${evalBefore} to ${evalAfter}. The engine found something clearly stronger.`);
  }
  return { reasons, missed };
}
