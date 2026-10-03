// Thin UCI wrapper around the bundled Stockfish web worker.
// Jobs run strictly one after another. cancelAll() aborts the running job
// and drops everything queued; cancelled jobs resolve with null.

const STOCKFISH_URL = new URL('../vendor/stockfish/stockfish-17.1-lite-single-03e3232.js', import.meta.url).href;

export class Engine {
  constructor(url = STOCKFISH_URL) {
    this.worker = new Worker(url);
    this.queue = [];
    this.current = null;
    this.ready = this.#boot();
  }

  #boot() {
    return new Promise((resolve, reject) => {
      let stage = 'uci';
      const fail = (e) => reject(new Error(e?.message || 'Stockfish worker failed to start'));
      this.worker.onerror = fail;
      this.worker.onmessage = (e) => {
        const line = String(e.data);
        if (stage === 'uci' && line === 'uciok') {
          stage = 'ready';
          this.worker.postMessage('isready');
        } else if (stage === 'ready' && line === 'readyok') {
          stage = 'done';
          this.worker.onerror = null;
          this.worker.onmessage = (ev) => this.#onLine(String(ev.data));
          resolve();
        }
      };
      this.worker.postMessage('uci');
    });
  }

  // Full-strength multi-line analysis to a fixed depth.
  analyse(fen, { depth = 14, multipv = 3 } = {}) {
    return this.#enqueue({
      kind: 'analyse',
      fen,
      go: `go depth ${depth}`,
      options: { MultiPV: multipv, UCI_LimitStrength: false, 'Skill Level': 20 },
    });
  }

  // One move at a limited strength, for the opponent.
  play(fen, { elo = 1600, movetime = 600 } = {}) {
    return this.#enqueue({
      kind: 'play',
      fen,
      go: `go movetime ${movetime}`,
      options: { MultiPV: 1, UCI_LimitStrength: true, UCI_Elo: elo },
    });
  }

  cancelAll() {
    for (const job of this.queue) job.resolve(null);
    this.queue = [];
    if (this.current) {
      this.current.cancelled = true;
      this.worker.postMessage('stop');
    }
  }

  #enqueue(job) {
    return new Promise((resolve) => {
      this.queue.push({ ...job, resolve, lines: new Map(), cancelled: false });
      this.#pump();
    });
  }

  async #pump() {
    if (this.current || !this.queue.length) return;
    await this.ready;
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    for (const [name, value] of Object.entries(job.options)) {
      this.worker.postMessage(`setoption name ${name} value ${value}`);
    }
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(job.go);
  }

  #onLine(line) {
    const job = this.current;
    if (!job) return;
    if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
      const parsed = parseInfo(line);
      if (parsed) job.lines.set(parsed.multipv, parsed);
    } else if (line.startsWith('bestmove')) {
      this.current = null;
      if (job.cancelled) {
        job.resolve(null);
      } else {
        const best = line.split(/\s+/)[1];
        const lines = [...job.lines.values()].sort((a, b) => a.multipv - b.multipv);
        job.resolve({ best: best === '(none)' ? null : best, lines });
      }
      this.#pump();
    }
  }
}

function parseInfo(line) {
  const tok = line.split(/\s+/);
  const get = (key) => {
    const i = tok.indexOf(key);
    return i === -1 ? null : tok[i + 1];
  };
  const si = tok.indexOf('score');
  const kind = tok[si + 1];
  const val = Number(tok[si + 2]);
  if (kind !== 'cp' && kind !== 'mate') return null;
  const pvi = tok.indexOf('pv');
  return {
    multipv: Number(get('multipv') || 1),
    depth: Number(get('depth') || 0),
    // Score from the side to move's point of view, as UCI reports it.
    score: kind === 'cp' ? { cp: val } : { mate: val },
    pv: tok.slice(pvi + 1),
  };
}
