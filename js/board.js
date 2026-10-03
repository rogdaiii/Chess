// Board rendering and input. A square grid, a piece layer and an SVG overlay
// layer on top that carries arrows and rings (the "overlay" part).

const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.append(e);
  return e;
};

export class Board {
  // cfg: { getTargets(sq) -> [{to, capture}], canMove(sq) -> bool,
  //        isPromotion(from, to) -> bool, onMove(from, to, promotion?) }
  constructor(root, cfg) {
    this.cfg = cfg;
    this.flipped = false;
    this.pieces = new Map();
    this.lastMove = null;
    this.checkSquare = null;
    this.selected = null;
    this.targets = [];
    this.arrows = [];
    this.rings = [];
    this.interactive = true;
    this.drag = null;

    this.root = el('div', 'board', root);
    this.squaresLayer = el('div', 'layer squares', this.root);
    this.piecesLayer = el('div', 'layer pieces', this.root);
    this.overlay = document.createElementNS(SVG_NS, 'svg');
    this.overlay.setAttribute('class', 'layer overlay');
    this.overlay.setAttribute('viewBox', '0 0 8 8');
    this.root.append(this.overlay);
    this.promoLayer = el('div', 'promo hidden', this.root);

    this.root.addEventListener('pointerdown', (e) => this.#down(e));
    this.root.addEventListener('pointermove', (e) => this.#move(e));
    this.root.addEventListener('pointerup', (e) => this.#up(e));
    this.root.addEventListener('pointercancel', () => this.#cancelDrag());
    this.#buildSquares();
  }

  // ---- coordinates
  #xy(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return this.flipped ? [7 - f, r] : [f, 7 - r];
  }

  #sqFromXY(x, y) {
    const f = this.flipped ? 7 - x : x;
    const r = this.flipped ? y : 7 - y;
    return FILES[f] + (r + 1);
  }

  #squareAt(e) {
    const rect = this.root.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.#sqFromXY(x, y);
  }

  // ---- public state setters
  setPosition({ pieces, lastMove, checkSquare }) {
    this.pieces = pieces;
    this.lastMove = lastMove || null;
    this.checkSquare = checkSquare || null;
    this.clearSelection(false);
    this.#renderSquares();
    this.#renderPieces();
  }

  setFlipped(flipped) {
    if (this.flipped === flipped) return;
    this.flipped = flipped;
    this.#buildSquares();
    this.#renderSquares();
    this.#renderPieces();
    this.#renderOverlay();
  }

  setInteractive(on) {
    this.interactive = on;
    if (!on) this.clearSelection();
  }

  setArrows(arrows) {
    this.arrows = arrows;
    this.#renderOverlay();
  }

  setRings(rings) {
    this.rings = rings;
    this.#renderOverlay();
  }

  clearSelection(render = true) {
    this.selected = null;
    this.targets = [];
    if (render) this.#renderSquares();
  }

  // ---- squares
  #buildSquares() {
    this.squaresLayer.replaceChildren();
    this.squareEls = new Map();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sq = this.#sqFromXY(x, y);
        const d = el('div', 'sq ' + ((x + y) % 2 ? 'dark' : 'light'), this.squaresLayer);
        d.dataset.sq = sq;
        if (x === 0) el('span', 'coord rank', d).textContent = sq[1];
        if (y === 7) el('span', 'coord file', d).textContent = sq[0];
        this.squareEls.set(sq, d);
      }
    }
  }

  #renderSquares() {
    const targetMap = new Map(this.targets.map((t) => [t.to, t]));
    for (const [sq, d] of this.squareEls) {
      d.classList.toggle('last', !!this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to));
      d.classList.toggle('sel', sq === this.selected);
      d.classList.toggle('check', sq === this.checkSquare);
      const t = targetMap.get(sq);
      d.classList.toggle('target', !!t);
      d.classList.toggle('capture', !!t && !!t.capture);
    }
  }

  #renderPieces() {
    this.piecesLayer.replaceChildren();
    this.pieceEls = new Map();
    for (const [sq, p] of this.pieces) {
      const [x, y] = this.#xy(sq);
      const img = el('img', 'piece', this.piecesLayer);
      img.src = new URL(`../assets/pieces/${p.color}${p.type.toUpperCase()}.svg`, import.meta.url).href;
      img.alt = '';
      img.draggable = false;
      img.style.left = `${x * 12.5}%`;
      img.style.top = `${y * 12.5}%`;
      this.pieceEls.set(sq, img);
    }
  }

  // ---- overlay (arrows + rings)
  #renderOverlay() {
    this.overlay.replaceChildren();
    const svg = (tag, attrs) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      this.overlay.append(n);
      return n;
    };
    for (const r of this.rings) {
      const [x, y] = this.#xy(r.square);
      svg('rect', {
        x: x + 0.05, y: y + 0.05, width: 0.9, height: 0.9, rx: 0.12,
        class: `ring ring-${r.kind}`,
      });
    }
    // Weakest arrows first so the best one is on top.
    for (const a of [...this.arrows].reverse()) {
      const [x1, y1] = this.#xy(a.from).map((v) => v + 0.5);
      const [x2, y2] = this.#xy(a.to).map((v) => v + 0.5);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      const w = a.width ?? 0.14;
      const head = w * 3.2;
      const tipX = x2 - ux * 0.08;
      const tipY = y2 - uy * 0.08;
      const baseX = tipX - ux * head;
      const baseY = tipY - uy * head;
      const g = svg('g', { class: `arrow arrow-${a.kind}`, opacity: a.opacity ?? 0.85 });
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1 - ux * 0.0);
      line.setAttribute('y1', y1 - uy * 0.0);
      line.setAttribute('x2', baseX + ux * 0.02);
      line.setAttribute('y2', baseY + uy * 0.02);
      line.setAttribute('stroke-width', w);
      line.setAttribute('stroke-linecap', 'round');
      const px = -uy;
      const py = ux;
      const tri = document.createElementNS(SVG_NS, 'polygon');
      tri.setAttribute(
        'points',
        [
          [tipX, tipY],
          [baseX + px * head * 0.62, baseY + py * head * 0.62],
          [baseX - px * head * 0.62, baseY - py * head * 0.62],
        ].map((p) => p.join(',')).join(' '),
      );
      g.append(line, tri);
    }
  }

  // ---- promotion picker
  pickPromotion(color) {
    return new Promise((resolve) => {
      this.promoLayer.replaceChildren();
      this.promoLayer.classList.remove('hidden');
      const box = el('div', 'promo-box', this.promoLayer);
      for (const t of ['q', 'r', 'b', 'n']) {
        const b = el('button', 'promo-btn', box);
        b.type = 'button';
        b.setAttribute('aria-label', `Promote to ${t}`);
        const img = el('img', '', b);
        img.src = new URL(`../assets/pieces/${color}${t.toUpperCase()}.svg`, import.meta.url).href;
        img.alt = '';
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.promoLayer.classList.add('hidden');
          resolve(t);
        });
      }
      this.promoLayer.onclick = () => {
        this.promoLayer.classList.add('hidden');
        resolve(null);
      };
    });
  }

  // ---- input
  #down(e) {
    if (!this.interactive || e.button > 0 || !this.promoLayer.classList.contains('hidden')) return;
    const sq = this.#squareAt(e);
    if (!sq) return;
    if (this.selected && this.targets.some((t) => t.to === sq)) {
      this.#attempt(this.selected, sq);
      return;
    }
    if (this.pieces.has(sq) && this.cfg.canMove(sq)) {
      const reselect = this.selected === sq;
      this.selected = sq;
      this.targets = this.cfg.getTargets(sq);
      this.#renderSquares();
      this.drag = { from: sq, x: e.clientX, y: e.clientY, active: false, reselect, id: e.pointerId };
      this.root.setPointerCapture(e.pointerId);
    } else {
      this.clearSelection();
    }
  }

  #move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.active = true;
      const src = this.pieceEls.get(d.from);
      if (!src) return;
      src.classList.add('lifted');
      d.ghost = src.cloneNode();
      d.ghost.className = 'piece ghost';
      this.piecesLayer.append(d.ghost);
    }
    if (d.active && d.ghost) {
      const rect = this.root.getBoundingClientRect();
      d.ghost.style.left = `${((e.clientX - rect.left) / rect.width) * 100 - 6.25}%`;
      d.ghost.style.top = `${((e.clientY - rect.top) / rect.height) * 100 - 6.25}%`;
    }
  }

  #up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    this.pieceEls.get(d.from)?.classList.remove('lifted');
    try { this.root.releasePointerCapture(d.id); } catch { /* already released */ }
    if (d.active) {
      const to = this.#squareAt(e);
      if (to && this.targets.some((t) => t.to === to)) this.#attempt(d.from, to);
      else this.clearSelection();
    } else if (d.reselect) {
      this.clearSelection();
    }
  }

  #cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    this.pieceEls.get(d.from)?.classList.remove('lifted');
  }

  async #attempt(from, to) {
    let promotion;
    if (this.cfg.isPromotion(from, to)) {
      promotion = await this.pickPromotion(this.pieces.get(from).color);
      if (!promotion) {
        this.clearSelection();
        return;
      }
    }
    this.clearSelection(false);
    this.cfg.onMove(from, to, promotion);
  }
}
