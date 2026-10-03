import { Chess, validateFen } from '../vendor/chess.js';
import { Board } from './board.js';
import { Engine } from './engine.js';
import * as A from './analysis.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ settings
const DEFAULTS = { mode: 'help', human: 'w', elo: 1600, depth: 14, arrows: true, radar: true, autopilot: false };
const settings = { ...DEFAULTS, ...readStored() };

function readStored() {
  try {
    return JSON.parse(localStorage.getItem('chessHelper.settings') || '{}');
  } catch {
    return {};
  }
}
function saveSettings() {
  try {
    localStorage.setItem('chessHelper.settings', JSON.stringify(settings));
  } catch { /* private mode etc. */ }
}

// --------------------------------------------------------------- state
const chess = new Chess();
const state = {
  gen: 0,            // bumps whenever the position changes; stale async work checks it
  ann: [],           // quality per ply (tips mode)
  tally: { inaccuracy: 0, mistake: 0, blunder: 0 },
  lines: null,       // engine lines for the current position (help mode)
  hint: null,        // { level, uci } (tips mode)
  review: null,      // feedback on the last human move
  pending: null,     // review that is waiting for the player's decision
  thinking: false,   // opponent is choosing a move
  flipped: false,
  engineError: null,
};

let engine = null;
try {
  engine = new Engine();
  engine.ready.catch((e) => {
    state.engineError = e.message;
    render();
  });
} catch (e) {
  state.engineError = e.message;
}

// --------------------------------------------------------------- board
const board = new Board($('boardHost'), {
  canMove: (sq) => {
    const p = chess.get(sq);
    return !!p && p.color === chess.turn() && isHumanTurn() && !state.thinking && !state.pending && !chess.isGameOver();
  },
  getTargets: (sq) => {
    const seen = new Set();
    return chess.moves({ square: sq, verbose: true }).filter((m) => !seen.has(m.to) && seen.add(m.to)).map((m) => ({ to: m.to, capture: !!m.captured }));
  },
  isPromotion: (from, to) => chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion),
  onMove: (from, to, promotion) => humanMove(from, to, promotion),
});

const isHumanTurn = () => settings.human === 'both' || chess.turn() === settings.human;

// ------------------------------------------------------- engine access
const cache = new Map();

function analyse(fen, multipv = 3) {
  if (!engine || state.engineError) return Promise.resolve(null);
  const wide = cache.get(`${fen}|3|${settings.depth}`);
  if (wide) return wide;
  const key = `${fen}|${multipv}|${settings.depth}`;
  if (cache.has(key)) return cache.get(key);
  const p = engine.analyse(fen, { depth: settings.depth, multipv }).then((r) => {
    if (!r || !r.lines.length) cache.delete(key);
    return r && r.lines.length ? r : null;
  });
  cache.set(key, p);
  return p;
}

function resetAsync() {
  engine?.cancelAll();
  state.gen++;
  state.thinking = false;
  state.lines = null;
  state.hint = null;
}

// ------------------------------------------------------------ rendering
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function render() {
  const pieces = new Map();
  for (const row of chess.board()) for (const c of row) if (c) pieces.set(c.square, { type: c.type, color: c.color });
  let checkSquare = null;
  if (chess.inCheck()) {
    for (const [sq, p] of pieces) if (p.type === 'k' && p.color === chess.turn()) checkSquare = sq;
  }
  const last = chess.history({ verbose: true }).at(-1);
  board.setPosition({ pieces, lastMove: last ? { from: last.from, to: last.to } : null, checkSquare });
  board.setFlipped(state.flipped);
  board.setInteractive(isHumanTurn() && !state.thinking && !state.pending && !chess.isGameOver() && !state.engineError);
  renderOverlays();
  renderMoves();
  renderControls();
  renderLines();
  renderReview();
  if (state.engineError) {
    setCoach({
      tone: 'bad',
      chip: 'Engine offline',
      title: 'Stockfish could not start',
      lines: ['Open this page through a local web server instead of the file itself, for example:', 'python3 -m http.server 8080', `(${state.engineError})`],
    });
  }
}

function renderOverlays() {
  const arrows = [];
  const rings = [];
  const mine = isHumanTurn() && !state.pending && !chess.isGameOver() && !state.thinking;
  if (settings.mode === 'help' && settings.arrows && state.lines && mine) {
    const style = [
      { kind: 'best', width: 0.17, opacity: 0.92 },
      { kind: 'alt', width: 0.12, opacity: 0.7 },
      { kind: 'alt2', width: 0.1, opacity: 0.55 },
    ];
    state.lines.slice(0, 3).forEach((l, i) => {
      arrows.push({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), ...style[i] });
    });
  }
  if (settings.mode === 'tips' && state.hint && mine) {
    if (state.hint.level === 2) rings.push({ square: state.hint.uci.slice(0, 2), kind: 'hint' });
    if (state.hint.level >= 3) arrows.push({ from: state.hint.uci.slice(0, 2), to: state.hint.uci.slice(2, 4), kind: 'best', width: 0.17, opacity: 0.92 });
  }
  if (state.pending) {
    arrows.push({ from: state.pending.rec.from, to: state.pending.rec.to, kind: 'bad', width: 0.15, opacity: 0.85 });
  }
  if (settings.radar && mine) {
    for (const e of A.enPrise(chess, chess.turn())) rings.push({ square: e.square, kind: 'danger' });
    for (const e of A.enPrise(chess, A.other(chess.turn()))) rings.push({ square: e.square, kind: 'chance' });
  }
  board.setArrows(arrows);
  board.setRings(rings);
}

function renderMoves() {
  const host = $('moves');
  host.replaceChildren();
  const hist = chess.history({ verbose: true });
  const startNo = Number(new Chess(firstFen()).fen().split(' ')[5]);
  const startsBlack = new Chess(firstFen()).turn() === 'b';
  const cell = (ply, m) => {
    const d = h('div', 'mv' + (ply === hist.length - 1 ? ' current' : ''));
    if (!m) return d;
    d.append(h('span', '', m.san));
    const q = state.ann[ply];
    if (q) d.append(h('span', `q q-${q}`, A.QUALITY[q].glyph));
    return d;
  };
  // Pad so that black's first reply lines up when the game starts from a black-to-move FEN.
  const plies = startsBlack ? [null, ...hist] : hist;
  const offset = startsBlack ? 1 : 0;
  for (let i = 0; i < plies.length; i += 2) {
    host.append(h('div', 'no', `${startNo + i / 2}.`));
    host.append(cell(i - offset, plies[i]));
    host.append(cell(i + 1 - offset, plies[i + 1]));
  }
  host.scrollTop = host.scrollHeight;
  const t = state.tally;
  $('tally').textContent = settings.mode === 'tips' ? `?! ${t.inaccuracy} · ? ${t.mistake} · ?? ${t.blunder}` : '';
}

let startFen = new Chess().fen();
const firstFen = () => startFen;

function renderControls() {
  document.querySelectorAll('.mode-switch button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === settings.mode)));
  $('human').value = settings.human;
  $('elo').value = settings.elo;
  $('eloOut').textContent = `${settings.elo} Elo`;
  $('depth').value = settings.depth;
  $('depthOut').textContent = String(settings.depth);
  $('optArrows').checked = settings.arrows;
  $('optRadar').checked = settings.radar;
  $('optAuto').checked = settings.autopilot;
  $('eloRow').classList.toggle('hidden', settings.human === 'both');
  $('autoRow').classList.toggle('hidden', settings.mode !== 'help' || settings.human === 'both');
  $('optArrows').closest('label').classList.toggle('hidden', settings.mode !== 'help');
  $('evalbar').classList.toggle('hidden', settings.mode !== 'help');
  $('evalbar').classList.toggle('flipped', state.flipped);
}

function renderLines() {
  const card = $('linesCard');
  const show = settings.mode === 'help' && state.lines && isHumanTurn() && !chess.isGameOver();
  card.classList.toggle('hidden', !show);
  if (!show) return;
  const fen = chess.fen();
  const list = $('lines');
  list.replaceChildren();
  for (const l of state.lines.slice(0, 3)) {
    const li = h('li');
    li.title = 'Click to play this move';
    li.append(h('span', 'dot'), h('span', 'san', A.sanOf(fen, l.pv[0])), h('span', 'ev', A.formatScore(l.score, chess.turn())), h('span', 'pv', pvAfterFirst(fen, l.pv, 6)));
    li.addEventListener('click', () => playUci(l.pv[0]));
    list.append(li);
  }
}

function formatLine(fen, pv) {
  const g = new Chess(fen);
  const out = [];
  for (const u of pv) {
    try {
      const num = g.moveNumber();
      const black = g.turn() === 'b';
      const m = g.move(A.uciToMove(u));
      out.push((black ? (out.length ? '' : `${num}… `) : `${num}. `) + m.san);
    } catch {
      break;
    }
  }
  return out.join(' ');
}

// PV continuation after the first move has been played on a copy of the position.
function pvAfterFirst(fen, pv, n = 6) {
  const g = new Chess(fen);
  try { g.move(A.uciToMove(pv[0])); } catch { return ''; }
  return formatLine(g.fen(), pv.slice(1, n));
}

// ----------------------------------------------------------------- coach
function setCoach({ tone = 'info', chip, title, lines = [], actions = [], items = [] }) {
  const root = $('coach');
  root.replaceChildren();
  root.append(h('span', `chip ${tone}`, chip));
  if (title) root.append(h('p', 'title', title));
  for (const l of lines) root.append(h('p', l.startsWith('(') || l.startsWith('python3') ? 'muted' : '', l));
  if (items.length) {
    const ul = h('ul', 'reasons');
    for (const it of items) ul.append(h('li', it.tone || '', it.text));
    root.append(ul);
  }
  if (actions.length) {
    const box = h('div', 'actions');
    for (const a of actions) {
      const b = h('button', a.cls || '', a.label);
      b.type = 'button';
      b.disabled = !!a.disabled;
      b.addEventListener('click', a.onClick);
      box.append(b);
    }
    root.append(box);
  }
}

function renderReview() {
  const root = $('review');
  const r = state.review;
  root.classList.toggle('hidden', !r || settings.mode !== 'tips');
  if (!r || settings.mode !== 'tips') return;
  root.replaceChildren();
  const tone = { best: 'good', excellent: 'good', good: 'good', inaccuracy: 'warn', mistake: 'bad', blunder: 'bad' }[r.quality];
  root.append(h('span', `chip ${tone}`, `${A.QUALITY[r.quality].glyph} ${A.QUALITY[r.quality].label}`));
  root.append(h('p', 'title', `${r.rec.san}`));
  root.append(h('p', 'muted', `Evaluation ${r.evalBefore} → ${r.evalAfter}`));
  if (r.quality === 'best') root.append(h('p', '', r.moveText));
  else if (r.quality === 'excellent' || r.quality === 'good') root.append(h('p', '', 'Solid. The engine would pick something else, but you lose next to nothing.'));
  const items = r.reasons.map((t) => ({ text: t }));
  if (r.missed) items.push({ text: r.missed.text, tone: 'warn' });
  if (items.length && !['best', 'excellent', 'good'].includes(r.quality)) {
    const ul = h('ul', 'reasons');
    for (const it of items) ul.append(h('li', it.tone || '', it.text));
    root.append(ul);
  }
  const actions = h('div', 'actions');
  const add = (label, cls, fn) => {
    const b = h('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    actions.append(b);
  };
  if (state.pending === r) {
    add('Take back', 'primary', () => takeBack(false));
    add('Take back and show best', '', () => takeBack(true));
    add('Keep my move', '', keepMove);
  } else if (['inaccuracy'].includes(r.quality) && !r.revealed) {
    add('What was better?', '', () => {
      r.revealed = true;
      renderReview();
    });
  }
  if (r.revealed && state.pending !== r) {
    root.append(h('p', '', `Better was ${r.bestSan}. ${r.bestText}`));
  }
  if (actions.children.length) root.append(actions);
}

function describeResult() {
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'Black' : 'White';
    return { tone: 'info', chip: 'Game over', title: `Checkmate. ${winner} wins.` };
  }
  if (chess.isStalemate()) return { tone: 'info', chip: 'Game over', title: 'Stalemate. Draw.' };
  if (chess.isThreefoldRepetition()) return { tone: 'info', chip: 'Game over', title: 'Draw by repetition.' };
  if (chess.isInsufficientMaterial()) return { tone: 'info', chip: 'Game over', title: 'Draw. Not enough material.' };
  return { tone: 'info', chip: 'Game over', title: 'Draw (fifty-move rule).' };
}

// ------------------------------------------------------------- game flow
function commit(move, fenBefore) {
  state.gen++;
  state.lines = null;
  state.hint = null;
  state.ann.push(null);
  return { fenBefore, fenAfter: chess.fen(), san: move.san, from: move.from, to: move.to, uci: move.from + move.to + (move.promotion || ''), color: move.color };
}

async function humanMove(from, to, promotion) {
  const fenBefore = chess.fen();
  let move;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    return;
  }
  state.review = null;
  state.pending = null;
  const rec = commit(move, fenBefore);
  if (settings.mode === 'tips') {
    render();
    await grade(rec);
  } else {
    engine?.cancelAll();
    drive();
  }
}

function playUci(uci) {
  if (!isHumanTurn() || chess.isGameOver() || state.thinking || state.pending) return;
  const m = A.uciToMove(uci);
  humanMove(m.from, m.to, m.promotion);
}

async function grade(rec) {
  const gen = state.gen;
  setCoach({ tone: 'info', chip: 'Checking', title: 'Looking at your move…', lines: [] });
  const before = await analyse(rec.fenBefore, 3);
  if (gen !== state.gen) return;
  if (!before) return drive();
  const mover = rec.color;
  const opp = A.other(mover);
  const best = before.lines[0];
  const bestWhite = A.whiteCp(best.score, mover);

  let afterWhite;
  let replyPv = [];
  let afterScore = null;
  const line = before.lines.find((l) => l.pv[0] === rec.uci);
  const after = new Chess(rec.fenAfter);
  if (after.isGameOver()) {
    afterWhite = after.isCheckmate() ? (mover === 'w' ? 10000 : -10000) : 0;
  } else if (line) {
    afterWhite = A.whiteCp(line.score, mover);
    replyPv = line.pv.slice(1);
    afterScore = line.score.mate !== undefined ? { mate: -line.score.mate } : { cp: -line.score.cp };
  } else {
    const res = await analyse(rec.fenAfter, 1);
    if (gen !== state.gen) return;
    if (!res) return drive();
    afterWhite = A.whiteCp(res.lines[0].score, opp);
    replyPv = res.lines[0].pv;
    afterScore = res.lines[0].score;
  }

  const win = (cpWhite) => A.winPercent(mover === 'w' ? cpWhite : -cpWhite);
  const loss = Math.max(0, win(bestWhite) - win(afterWhite));
  const quality = A.classify(loss, rec.uci === best.pv[0]);
  const fmt = (cp) => A.formatScore({ cp }, 'w');
  const showEval = (cp, mate) => (Math.abs(cp) > 9000 ? A.formatScore({ mate }, 'w') : fmt(cp));
  const mateOf = (cp) => (cp > 0 ? 1 : -1) * Math.round((10000 - Math.abs(cp)) / 10);
  const evalBefore = showEval(bestWhite, mateOf(bestWhite));
  const evalAfter = after.isCheckmate() ? 'checkmate' : showEval(afterWhite, mateOf(afterWhite));

  const review = {
    rec, quality, loss, evalBefore, evalAfter,
    reasons: [], missed: null, revealed: false,
    bestUci: best.pv[0], bestSan: A.sanOf(rec.fenBefore, best.pv[0]),
    bestText: A.describeMove(rec.fenBefore, best.pv[0]).text,
    moveText: A.describeMove(rec.fenBefore, rec.uci).text,
  };
  if (['inaccuracy', 'mistake', 'blunder'].includes(quality)) {
    const why = A.explainMistake({ fenBefore: rec.fenBefore, playedUci: rec.uci, bestUci: best.pv[0], replyPv, afterScore, loss, evalBefore, evalAfter });
    review.reasons = why.reasons;
    review.missed = why.missed;
    state.tally[quality]++;
  }
  state.ann[state.ann.length - 1] = quality;
  state.review = review;

  if (quality === 'mistake' || quality === 'blunder') {
    state.pending = review;
    render();
    setCoach({ tone: 'warn', chip: 'Your call', title: 'Take it back?', lines: ['The opponent has not replied yet. You can fix this.'] });
    return;
  }
  drive();
}

function takeBack(showBest) {
  const r = state.pending;
  if (!r) return;
  const wasBad = r;
  chess.undo();
  state.ann.pop();
  state.pending = null;
  state.review = null;
  resetAsync();
  // The take back is still part of the tally; the move was graded once.
  drive();
  if (showBest) {
    state.hint = { level: 3, uci: wasBad.bestUci };
    setCoach({ tone: 'good', chip: 'Hint 3/3', title: `Best move: ${wasBad.bestSan}`, lines: [wasBad.bestText] });
    renderOverlays();
  }
}

function keepMove() {
  state.pending = null;
  drive();
}

function drive() {
  render();
  if (chess.isGameOver()) {
    const res = describeResult();
    if (settings.mode === 'tips') {
      const t = state.tally;
      res.lines = [`Your moves: ${t.inaccuracy} inaccuracies, ${t.mistake} mistakes, ${t.blunder} blunders.`];
    }
    setCoach(res);
    return;
  }
  if (state.engineError) return;
  if (!isHumanTurn()) {
    opponentMove();
    return;
  }
  helper();
}

async function opponentMove() {
  const gen = state.gen;
  state.thinking = true;
  board.setInteractive(false);
  setCoach({ tone: 'info', chip: 'Opponent', title: 'Thinking…', lines: [] });
  const fenBefore = chess.fen();
  const res = await engine.play(fenBefore, { elo: settings.elo, movetime: 700 });
  if (gen !== state.gen || !res || !res.best) return;
  state.thinking = false;
  const move = chess.move(A.uciToMove(res.best));
  commit(move, fenBefore);
  drive();
}

async function helper() {
  const gen = state.gen;
  const fen = chess.fen();
  state.hint = null;
  if (settings.mode === 'help') {
    setCoach({ tone: 'info', chip: 'Full help', title: 'Analysing…', lines: [] });
    const res = await analyse(fen, 3);
    if (gen !== state.gen || !res) return;
    state.lines = res.lines;
    const best = res.lines[0];
    updateEvalBar(best.score);
    const d = A.describeMove(fen, best.pv[0]);
    const line = formatLine(fen, best.pv.slice(0, 6));
    setCoach({
      tone: 'good',
      chip: 'Full help',
      title: `Play ${d.san}`,
      lines: [d.text, `Evaluation ${A.formatScore(best.score, chess.turn())} at depth ${best.depth}.${line ? ` Main line: ${line}` : ''}`],
      actions: [{ label: `Play ${d.san}`, cls: 'primary', onClick: () => playUci(best.pv[0]) }],
    });
    render();
    if (settings.autopilot && settings.human !== 'both') {
      await sleep(900);
      if (gen === state.gen && settings.autopilot && settings.mode === 'help') playUci(best.pv[0]);
    }
  } else {
    showTipsStatus();
    analyse(fen, 3); // warm the cache so grading is instant
  }
}

function updateEvalBar(score) {
  const cp = A.whiteCp(score, chess.turn());
  $('evalfill').style.height = `${A.winPercent(cp).toFixed(1)}%`;
  $('evaltext').textContent = A.formatScore(score, chess.turn());
}

function showTipsStatus() {
  const turn = chess.turn();
  const items = [];
  const lines = [];
  if (chess.inCheck()) lines.push('You are in check. Get out of it first.');
  if (settings.radar) {
    const t = A.threatSentences(chess, turn);
    for (const s of t.mine) items.push({ text: s, tone: 'warn' });
    for (const s of t.theirs) items.push({ text: s, tone: 'chance' });
    if (!items.length && !chess.inCheck()) {
      lines.push(A.openingTip(chess, turn) || 'Nothing is hanging on either side. Check what your opponent threatens before you commit.');
    }
  } else if (!chess.inCheck()) {
    lines.push('Your move. Use a hint if you get stuck.');
  }
  const level = state.hint ? state.hint.level : 0;
  setCoach({
    tone: 'info',
    chip: 'Tips',
    title: 'Your move',
    lines,
    items,
    actions: [{ label: level >= 3 ? 'Hint (max)' : `Hint (${level}/3)`, disabled: level >= 3, onClick: giveHint }],
  });
}

async function giveHint() {
  const gen = state.gen;
  const fen = chess.fen();
  const res = await analyse(fen, 3);
  if (gen !== state.gen || !res) return;
  const level = Math.min(3, (state.hint ? state.hint.level : 0) + 1);
  const best = res.lines[0];
  state.hint = { level, uci: best.pv[0] };
  const texts = A.hintLevels(fen, best.pv[0], best.score);
  showTipsStatus();
  const root = $('coach');
  const p = h('p', 'hint-text', `Hint ${level}/3: ${texts[level - 1]}`);
  root.querySelector('.title').after(p);
  renderOverlays();
}

// --------------------------------------------------------------- controls
function newGame(fen) {
  chess.load(fen || new Chess().fen());
  startFen = chess.fen();
  state.ann = [];
  state.tally = { inaccuracy: 0, mistake: 0, blunder: 0 };
  state.review = null;
  state.pending = null;
  cache.clear();
  resetAsync();
  if (!fen) state.flipped = settings.human === 'b';
  $('evalfill').style.height = '50%';
  $('evaltext').textContent = '0.0';
  drive();
}

document.querySelectorAll('.mode-switch button').forEach((b) =>
  b.addEventListener('click', () => {
    if (settings.mode === b.dataset.mode) return;
    settings.mode = b.dataset.mode;
    saveSettings();
    state.pending = null;
    state.review = null;
    resetAsync();
    drive();
  }),
);

$('newGame').addEventListener('click', () => newGame());
$('flip').addEventListener('click', () => {
  state.flipped = !state.flipped;
  render();
});
$('undo').addEventListener('click', () => {
  if (!chess.history().length) return;
  chess.undo();
  state.ann.pop();
  if (settings.human !== 'both' && chess.turn() !== settings.human && chess.history().length) {
    chess.undo();
    state.ann.pop();
  }
  state.pending = null;
  state.review = null;
  resetAsync();
  drive();
});
$('human').addEventListener('change', (e) => {
  settings.human = e.target.value;
  if (settings.human !== 'both') state.flipped = settings.human === 'b';
  if (settings.human === 'both') settings.autopilot = false;
  saveSettings();
  state.pending = null;
  resetAsync();
  drive();
});
$('elo').addEventListener('input', (e) => {
  settings.elo = Number(e.target.value);
  $('eloOut').textContent = `${settings.elo} Elo`;
  saveSettings();
});
$('depth').addEventListener('input', (e) => {
  settings.depth = Number(e.target.value);
  $('depthOut').textContent = String(settings.depth);
  saveSettings();
});
$('depth').addEventListener('change', () => {
  cache.clear();
  if (isHumanTurn() && !state.pending && !chess.isGameOver()) {
    resetAsync();
    drive();
  }
});
for (const [id, key] of [['optArrows', 'arrows'], ['optRadar', 'radar'], ['optAuto', 'autopilot']]) {
  $(id).addEventListener('change', (e) => {
    settings[key] = e.target.checked;
    saveSettings();
    if (key === 'autopilot' && settings.autopilot && settings.mode === 'help' && state.lines && isHumanTurn()) {
      playUci(state.lines[0].pv[0]);
      return;
    }
    if (settings.mode === 'tips' && key === 'radar' && isHumanTurn() && !state.pending && !chess.isGameOver()) showTipsStatus();
    renderOverlays();
  });
}
$('copyFen').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(chess.fen());
    $('copyFen').textContent = 'Copied';
  } catch {
    $('fenInput').value = chess.fen();
    $('copyFen').textContent = 'FEN in box';
  }
  setTimeout(() => ($('copyFen').textContent = 'Copy FEN'), 1500);
});
$('fenForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fen = $('fenInput').value.trim();
  if (!fen) return;
  const check = validateFen(fen);
  $('fenError').classList.toggle('hidden', check.ok);
  if (!check.ok) {
    $('fenError').textContent = check.error;
    return;
  }
  settings.human = 'both';
  saveSettings();
  newGame(fen);
  state.flipped = new Chess(fen).turn() === 'b';
  render();
});

newGame();
