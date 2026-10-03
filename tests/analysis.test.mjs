import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import {
  enPrise, material, describeMove, explainMistake, classify, winPercent,
  whiteCp, formatScore, hintLevels, openingTip, threatSentences, sanOf,
} from '../js/analysis.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('start position has nothing hanging', () => {
  const c = new Chess(START);
  assert.deepEqual(enPrise(c, 'w'), []);
  assert.deepEqual(enPrise(c, 'b'), []);
  assert.equal(material(c, 'w'), 0);
});

test('undefended attacked pawn is loose, defended one is not', () => {
  const c = new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
  const e = enPrise(c, 'b');
  assert.equal(e.length, 1);
  assert.equal(e[0].square, 'e5');
  assert.equal(e[0].reason, 'loose');
  // after ...Nc6 the pawn is defended
  const d = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  assert.deepEqual(enPrise(d, 'b'), []);
});

test('piece attacked by a cheaper piece counts even when defended', () => {
  // black knight on d5 is defended by nothing but attacked by the e4 pawn
  const e = enPrise(new Chess('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1'), 'b');
  assert.equal(e[0].square, 'd5');
  // defended knight attacked by a pawn: still outvalued
  const f = enPrise(new Chess('4k3/8/2p5/3n4/4P3/8/8/4K3 w - - 0 1'), 'b');
  assert.equal(f[0].reason, 'outvalued');
});

test('king does not count as attacker of a defended piece', () => {
  assert.equal(enPrise(new Chess('4k3/8/8/8/8/2pK4/8/8 b - - 0 1'), 'b')[0].square, 'c3');
  // add a defender: the king may not take it
  assert.deepEqual(enPrise(new Chess('4k3/8/8/8/1p6/2pK4/8/8 b - - 0 1'), 'b'), []);
});

test('describeMove: mate, free capture, castle, develop', () => {
  const scholar = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const d = describeMove(scholar, 'h5f7');
  assert.equal(d.san, 'Qxf7#');
  assert.equal(d.theme, 'mate');
  const free = describeMove('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'.replace(' b ', ' w '), 'f3e5');
  assert.match(free.text, /free pawn/);
  assert.equal(describeMove(START, 'g1f3').theme, 'develop');
  const castle = describeMove('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5', 'e1g1');
  assert.equal(castle.theme, 'castle');
});

test('explainMistake finds the mate it allows', () => {
  const fenBefore = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
  const r = explainMistake({
    fenBefore, playedUci: 'g8f6', bestUci: 'g7g6', replyPv: ['h5f7'],
    afterScore: { mate: 1 }, loss: 100, evalBefore: '+0.3', evalAfter: '-M1',
  });
  assert.match(r.reasons[0], /Qxf7#/);
});

test('explainMistake finds a hanging piece', () => {
  // White plays Nxe5?? hmm: use Qh5 Nc6 Qxe5+ style: black blunders queen to a square attacked by a pawn
  const fenBefore = 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 2';
  const r = explainMistake({
    fenBefore, playedUci: 'd8h4', bestUci: 'e5d4', replyPv: ['g2g3', 'h4e4'],
    afterScore: { cp: 50 }, loss: 20, evalBefore: '0.0', evalAfter: '+1.0',
  });
  assert.ok(r.reasons.length > 0);
});

test('scores and grading', () => {
  assert.equal(whiteCp({ cp: 50 }, 'w'), 50);
  assert.equal(whiteCp({ cp: 50 }, 'b'), -50);
  assert.ok(whiteCp({ mate: 3 }, 'w') > 9000);
  assert.ok(whiteCp({ mate: -3 }, 'w') < -9000);
  assert.equal(formatScore({ mate: 2 }, 'b'), '-M2');
  assert.equal(formatScore({ cp: 123 }, 'w'), '+1.2');
  assert.ok(Math.abs(winPercent(0) - 50) < 1e-9);
  assert.equal(classify(0, true), 'best');
  assert.equal(classify(1, false), 'excellent');
  assert.equal(classify(7, false), 'inaccuracy');
  assert.equal(classify(12, false), 'mistake');
  assert.equal(classify(30, false), 'blunder');
});

test('hint levels never leak the move early', () => {
  const [a, b, c] = hintLevels(START, 'g1f3', { cp: 30 });
  assert.ok(!/Nf3|g1f3/.test(a));
  assert.ok(/knight on g1/.test(b) && !/Nf3/.test(b));
  assert.match(c, /Nf3/);
});

test('opening tip and threats text', () => {
  assert.match(openingTip(new Chess(START), 'w'), /Develop/);
  const t = threatSentences(new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'), 'b');
  assert.match(t.mine[0], /e5/);
  assert.equal(sanOf(START, 'e2e4'), 'e4');
});
