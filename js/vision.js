// Reads a chess board from pixels. Nothing site specific: in the starting
// position every piece is on a known square, so calibration just learns what
// each piece looks like on this screen, then new squares are matched against it.

import { Chess, SQUARES } from '../vendor/chess.js';

const CELL = 32;          // working size of one square in pixels
const GRID = 16;          // descriptor resolution per square
const BOARD = CELL * 8;

const dims = (src) => [src.videoWidth || src.naturalWidth || src.width, src.videoHeight || src.naturalHeight || src.height];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const START = (() => {
  const map = new Map();
  for (const row of new Chess().board()) for (const c of row) if (c) map.set(c.square, c.color + c.type.toUpperCase());
  return map;
})();

// Cell (column, row) on screen -> square name.
function cellSquare(col, row, whiteBottom) {
  const file = whiteBottom ? col : 7 - col;
  const rank = whiteBottom ? 8 - row : row + 1;
  return 'abcdefgh'[file] + rank;
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

// Per square: background colour from the corners, then how each pixel differs
// from it. Highlights, tinted squares and light or dark squares drop out.
function describeCell(data, x0, y0) {
  const stride = BOARD * 4;
  const patches = [];
  for (const [cx, cy] of [[1, 1], [CELL - 5, 1], [1, CELL - 5], [CELL - 5, CELL - 5]]) {
    const rs = [];
    const gs = [];
    const bs = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y0 + cy + y) * stride + (x0 + cx + x) * 4;
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
    patches.push([median(rs), median(gs), median(bs)]);
  }
  // Two corners that agree are the background; a corner touching a neighbour's highlight is not.
  let pair = [0, 1];
  let tight = Infinity;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const d = Math.abs(patches[i][0] - patches[j][0]) + Math.abs(patches[i][1] - patches[j][1]) + Math.abs(patches[i][2] - patches[j][2]);
      if (d < tight) {
        tight = d;
        pair = [i, j];
      }
    }
  }
  const br = (patches[pair[0]][0] + patches[pair[1]][0]) / 2;
  const bg = (patches[pair[0]][1] + patches[pair[1]][1]) / 2;
  const bb = (patches[pair[0]][2] + patches[pair[1]][2]) / 2;
  const lumaBg = 0.299 * br + 0.587 * bg + 0.114 * bb;
  const desc = new Float32Array(GRID * GRID * 2);
  let fg = 0;
  const step = CELL / GRID;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const i = (y0 + y) * stride + (x0 + x) * 4;
      const dr = data[i] - br;
      const dg = data[i + 1] - bg;
      const db = data[i + 2] - bb;
      const chroma = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 765;
      if (chroma > 0.08) fg++;
      const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] - lumaBg) / 255;
      const g = ((y / step) | 0) * GRID + ((x / step) | 0);
      desc[g * 2] += luma / (step * step);
      desc[g * 2 + 1] += chroma / (step * step);
    }
  }
  return { desc, fg: fg / (CELL * CELL) };
}

const dist = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
};

export class BoardReader {
  constructor() {
    this.source = null;
    this.rect = null;        // { x, y, size } in source pixels
    this.whiteBottom = true;
    this.templates = [];     // { label, desc }
    this.emptyThreshold = 0.1;
    this.work = makeCanvas(BOARD, BOARD);
    this.workCtx = this.work.getContext('2d', { willReadFrequently: true });
    this.workCtx.imageSmoothingQuality = 'high';
    this.full = makeCanvas(1, 1);
  }

  get calibrated() {
    return this.templates.length > 0 && !!this.rect;
  }

  setSource(source) {
    this.source = source;
  }

  // Whole frame as a canvas (for the picker and the edge search).
  snapshot() {
    const [w, h] = dims(this.source);
    if (this.full.width !== w || this.full.height !== h) {
      this.full.width = w;
      this.full.height = h;
    }
    const ctx = this.full.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.source, 0, 0);
    return this.full;
  }

  #pixels(rect) {
    this.workCtx.drawImage(this.source, rect.x, rect.y, rect.size, rect.size, 0, 0, BOARD, BOARD);
    return this.workCtx.getImageData(0, 0, BOARD, BOARD).data;
  }

  // Snap a rough rectangle onto the real grid. Every inner grid line is an edge
  // between a light and a dark square along the whole board, so edge energy
  // summed along columns (and rows) has seven sharp peaks, evenly spaced.
  refine(rough) {
    const frame = this.snapshot();
    const m = Math.round(rough.size * 0.12);
    const x0 = Math.max(0, Math.round(rough.x - m));
    const y0 = Math.max(0, Math.round(rough.y - m));
    const w = Math.min(frame.width - x0, Math.round(rough.size + 2 * m));
    const h = Math.min(frame.height - y0, Math.round(rough.size + 2 * m));
    const px = frame.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data;
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

    const rx = rough.x - x0;
    const ry = rough.y - y0;
    const band = (lo, hi) => [Math.max(1, Math.round(lo)), Math.min(Math.round(hi), 1e9)];
    const [cy0, cy1] = band(ry + rough.size * 0.1, ry + rough.size * 0.9);
    const [cx0, cx1] = band(rx + rough.size * 0.1, rx + rough.size * 0.9);
    const Ex = new Float64Array(w);
    const Ey = new Float64Array(h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (y >= cy0 && y <= cy1) Ex[x] += Math.abs(L[y * w + x + 1] - L[y * w + x - 1]);
        if (x >= cx0 && x <= cx1) Ey[y] += Math.abs(L[(y + 1) * w + x] - L[(y - 1) * w + x]);
      }
    }
    const smooth = (E) => E.map((v, i) => (E[i - 1] || 0) + v + (E[i + 1] || 0));
    const Sx = smooth(Ex);
    const Sy = smooth(Ey);
    // All nine grid lines should be strong; one cell beyond either edge should be quiet.
    // The penalty is what stops the grid from locking on one square off.
    const lines = (S, o, size) => {
      let t = 0;
      for (let c = 0; c <= 8; c++) t += S[Math.round(o + (c * size) / 8)] || 0;
      t -= 0.6 * ((S[Math.round(o - size / 8)] || 0) + (S[Math.round(o + (9 * size) / 8)] || 0));
      return t;
    };
    const best1d = (S, centre, size) => {
      let best = { s: -1, o: centre };
      for (let o = Math.round(centre - rough.size * 0.07); o <= centre + rough.size * 0.07; o++) {
        const s = lines(S, o, size);
        if (s > best.s) best = { s, o };
      }
      return best;
    };
    let best = null;
    for (let size = Math.round(rough.size * 0.93); size <= rough.size * 1.07; size++) {
      const bx = best1d(Sx, rx, size);
      const by = best1d(Sy, ry, size);
      const total = bx.s + by.s;
      if (!best || total > best.total) best = { total, size, x: bx.o, y: by.o };
    }
    const roughScore = lines(Sx, rx, rough.size) + lines(Sy, ry, rough.size);
    if (!best || best.total <= roughScore * 1.05) return { ...rough, refined: false };
    return { x: x0 + best.x, y: y0 + best.y, size: best.size, refined: true };
  }

  // Learn the pieces from the starting position currently on screen.
  calibrate(rect, whiteBottom) {
    this.rect = rect;
    this.whiteBottom = whiteBottom;
    this.templates = [];
    const nudge = Math.max(1, Math.round(rect.size / 8 * 0.04));
    const offsets = [[0, 0], [nudge, 0], [-nudge, 0], [0, nudge], [0, -nudge]];
    let maxEmpty = 0;
    let minPiece = 1;
    offsets.forEach(([dx, dy], pass) => {
      const data = this.#pixels({ x: rect.x + dx, y: rect.y + dy, size: rect.size });
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const { desc, fg } = describeCell(data, col * CELL, row * CELL);
          const label = START.get(cellSquare(col, row, whiteBottom));
          if (label) {
            this.templates.push({ label, desc });
            if (pass === 0) minPiece = Math.min(minPiece, fg);
          } else if (pass === 0) {
            maxEmpty = Math.max(maxEmpty, fg);
          }
        }
      }
    });
    if (maxEmpty >= minPiece * 0.9) {
      this.templates = [];
      return { ok: false, error: 'Cannot tell pieces from empty squares. Is the full board visible at the starting position?' };
    }
    this.emptyThreshold = maxEmpty + (minPiece - maxEmpty) * 0.4;
    // The starting position must read back as itself.
    const back = this.read();
    const wrong = SQUARES.filter((sq) => (back[SQUARES.indexOf(sq)] || '') !== (START.get(sq) || ''));
    if (wrong.length) {
      this.templates = [];
      return { ok: false, error: `Board did not read back correctly (${wrong.length} squares off). Select the board again, tighter.` };
    }
    return { ok: true };
  }

  // Diagnostics for one square: how much of it differs from its own background.
  inspect(square) {
    const data = this.#pixels(this.rect);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (cellSquare(col, row, this.whiteBottom) === square) return { fg: describeCell(data, col * CELL, row * CELL).fg, threshold: this.emptyThreshold };
      }
    }
    return null;
  }

  // 64 entries in chess.js SQUARES order: '' or a piece code like 'wN'.
  read() {
    const data = this.#pixels(this.rect);
    const out = new Array(64).fill('');
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const { desc, fg } = describeCell(data, col * CELL, row * CELL);
        if (fg < this.emptyThreshold) continue;
        let best = Infinity;
        let label = '';
        for (const t of this.templates) {
          const d = dist(desc, t.desc);
          if (d < best) {
            best = d;
            label = t.label;
          }
        }
        out[SQUARES.indexOf(cellSquare(col, row, this.whiteBottom))] = label;
      }
    }
    return out;
  }
}
