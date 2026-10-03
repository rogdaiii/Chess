import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { track, readingFromChess, readingToFen } from '../js/tracker.js';

const START = new Chess().fen();
const play = (c, ...sans) => sans.forEach((s) => c.move(s));

test('same position', () => {
  const c = new Chess();
  assert.equal(track(c, readingFromChess(c), START).kind, 'same');
});

test('detects a single move, castling, en passant, promotion', () => {
  const c = new Chess();
  const r = readingFromChess(new Chess(START));
  const next = new Chess();
  next.move('e4');
  assert.deepEqual(track(c, readingFromChess(next), START).moves, [{ from: 'e2', to: 'e4', promotion: undefined }]);

  const cs = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const after = new Chess('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
  assert.equal(track(cs, readingFromChess(after), cs.fen()).moves[0].to, 'g1');

  const ep = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const epAfter = new Chess('4k3/8/3P4/8/8/8/8/4K3 b - - 0 1');
  assert.equal(track(ep, readingFromChess(epAfter), ep.fen()).moves[0].to, 'd6');

  const pr = new Chess('8/P6k/8/8/8/8/6K1/8 w - - 0 1');
  const prAfter = new Chess('N7/7k/8/8/8/8/6K1/8 b - - 0 1');
  assert.equal(track(pr, readingFromChess(prAfter), pr.fen()).moves[0].promotion, 'n');
  assert.ok(r.length === 64);
});

test('two moves at once', () => {
  const c = new Chess();
  const next = new Chess();
  play(next, 'e4', 'e5');
  const res = track(c, readingFromChess(next), START);
  assert.equal(res.kind, 'moves');
  assert.equal(res.moves.length, 2);
});

test('survives one misread square but not a pile of them', () => {
  const c = new Chess();
  const next = new Chess();
  next.move('Nf3');
  const noisy = readingFromChess(next);
  noisy[noisy.indexOf('wP')] = 'bP'; // one wrong square
  assert.equal(track(c, noisy, START).kind, 'moves');
  const garbage = readingFromChess(next).map((p, i) => (i % 3 === 0 ? '' : p));
  assert.equal(track(c, garbage, START).kind, 'lost');
});

test('take back and new game', () => {
  const c = new Chess();
  play(c, 'e4', 'e5', 'Nf3');
  const back = new Chess();
  play(back, 'e4', 'e5');
  assert.deepEqual(track(c, readingFromChess(back), START), { kind: 'undo', plies: 1 });
  assert.equal(track(c, readingFromChess(new Chess()), START).kind, 'undo');
  const custom = new Chess('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  assert.equal(track(custom, readingFromChess(new Chess()), custom.fen()).kind, 'newgame');
});

test('fen from reading', () => {
  assert.equal(readingToFen(readingFromChess(new Chess()), 'w'), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const c = new Chess();
  play(c, 'e4');
  assert.match(readingToFen(readingFromChess(c), 'b'), /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b KQkq/);
});
