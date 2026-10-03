// Screen watching: capture a window, let the user mark the board, calibrate on
// the starting position, then follow the game and report moves to the app.

import { validateFen } from '../vendor/chess.js';
import { BoardReader } from './vision.js';
import { track, readingToFen } from './tracker.js';

const TICK_MS = 400;

export function createWatcher({ root, getChess, getStartFen, hooks }) {
  const q = (sel) => root.querySelector(sel);
  const modal = document.getElementById('watchModal');
  const canvas = document.getElementById('watchCanvas');
  const ctx = canvas.getContext('2d');
  const msg = document.getElementById('watchMsg');
  const goBtn = document.getElementById('watchGo');

  const reader = new BoardReader();
  let stream = null;
  let video = null;
  let timer = null;
  let active = false;
  let lastKey = '';
  let stable = 0;
  let picked = null;       // refined rect in source pixels
  let scale = 1;

  const status = (text, tone = '') => {
    const el = q('#watchStatus');
    el.textContent = text;
    el.className = `watch-status ${tone}`;
  };

  function setUi(on) {
    q('#watchStart').classList.toggle('hidden', on);
    q('#watchStop').classList.toggle('hidden', !on);
    q('#watchTools').classList.toggle('hidden', !on);
  }

  // ---- capture
  async function start() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      status('This browser cannot share the screen. Use Chrome, Edge or Safari.', 'bad');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch {
      status('Screen sharing was cancelled or blocked. On a Mac, allow Screen Recording for your browser in System Settings > Privacy & Security.', 'bad');
      return;
    }
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => stop('Screen sharing ended.'));
    await video.play();
    await new Promise((r) => setTimeout(r, 400));
    openPicker(video);
  }

  // Test hook and fallback: any canvas or image works as the "screen".
  function useSource(source) {
    video = null;
    openPicker(source);
  }

  // ---- picker
  function openPicker(source) {
    reader.setSource(source);
    const frame = reader.snapshot();
    const maxW = Math.min(window.innerWidth * 0.9, 1100);
    const maxH = window.innerHeight * 0.62;
    scale = Math.min(maxW / frame.width, maxH / frame.height, 1);
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    picked = null;
    goBtn.disabled = true;
    msg.textContent = 'Put the game at its starting position, then drag a box around the board.';
    msg.className = 'watch-msg';
    modal.classList.remove('hidden');
  }

  function drawSelection(rect, refined) {
    ctx.drawImage(reader.full, 0, 0, canvas.width, canvas.height);
    const x = rect.x * scale;
    const y = rect.y * scale;
    const s = rect.size * scale;
    ctx.save();
    ctx.strokeStyle = refined ? '#3ec28f' : '#f2b84b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, s, s);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      ctx.moveTo(x + (s * i) / 8, y);
      ctx.lineTo(x + (s * i) / 8, y + s);
      ctx.moveTo(x, y + (s * i) / 8);
      ctx.lineTo(x + s, y + (s * i) / 8);
    }
    ctx.stroke();
    ctx.restore();
  }

  let dragStart = null;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    dragStart = { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const size = Math.max(Math.abs(x - dragStart.x), Math.abs(y - dragStart.y)) / scale;
    drawSelection({ x: Math.min(dragStart.x, x) / scale, y: Math.min(dragStart.y, y) / scale, size }, false);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const size = Math.max(Math.abs(x - dragStart.x), Math.abs(y - dragStart.y)) / scale;
    const rough = { x: Math.min(dragStart.x, x) / scale, y: Math.min(dragStart.y, y) / scale, size };
    dragStart = null;
    if (size < 80) return;
    // Keep the search window inside the frame.
    rough.x = Math.max(0, Math.min(rough.x, reader.full.width - size));
    rough.y = Math.max(0, Math.min(rough.y, reader.full.height - size));
    picked = reader.refine(rough);
    drawSelection(picked, picked.refined);
    goBtn.disabled = false;
    msg.textContent = picked.refined
      ? 'Grid snapped to the board. If the lines sit on the squares, press Calibrate.'
      : 'Could not snap the grid. If the lines are off, drag again a bit tighter around the board.';
    msg.className = 'watch-msg';
  });

  goBtn.addEventListener('click', () => {
    if (!picked) return;
    const whiteBottom = document.querySelector('input[name="wbottom"]:checked').value === 'w';
    const res = reader.calibrate(picked, whiteBottom);
    if (!res.ok) {
      msg.textContent = res.error;
      msg.className = 'watch-msg bad';
      return;
    }
    modal.classList.add('hidden');
    begin(whiteBottom);
  });
  document.getElementById('watchCancel').addEventListener('click', () => {
    modal.classList.add('hidden');
    if (!active) stop('');
  });

  // ---- following the game
  function begin(whiteBottom) {
    active = true;
    lastKey = '';
    stable = 0;
    setUi(true);
    status('Watching. Moves on the screen show up here.', 'good');
    hooks.onStart({ whiteBottom });
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
  }

  function tick() {
    if (!active || !reader.calibrated) return;
    if (video && video.readyState < 2) return;
    const reading = reader.read();
    const key = reading.join(',');
    if (key === lastKey) stable++;
    else {
      lastKey = key;
      stable = 1;
    }
    if (stable !== 2) return;
    const res = track(getChess(), reading, getStartFen());
    switch (res.kind) {
      case 'moves':
        status('Watching.', 'good');
        hooks.onMoves(res.moves);
        break;
      case 'undo':
        hooks.onUndo(res.plies);
        break;
      case 'newgame':
        hooks.onNewGame();
        break;
      case 'lost':
        status('Lost track of the board. Press "Sync from screen" once the position is settled.', 'warn');
        break;
      default:
        break;
    }
  }

  function sync() {
    if (!active) return;
    const reading = reader.read();
    let turn = q('#syncTurn').value;
    if (turn === 'auto') turn = hooks.guessTurn();
    const fen = readingToFen(reading, turn);
    const check = validateFen(fen);
    if (!check.ok) {
      status(`Could not read a valid position (${check.error}). Is the board fully visible?`, 'bad');
      return;
    }
    hooks.onSync(fen);
    status('Synced from the screen.', 'good');
  }

  function stop(text = 'Stopped watching.') {
    clearInterval(timer);
    timer = null;
    const was = active;
    active = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video = null;
    setUi(false);
    status(text, text ? 'warn' : '');
    if (was) hooks.onStop();
  }

  q('#watchStart').addEventListener('click', start);
  q('#watchStop').addEventListener('click', () => stop());
  q('#watchRecal').addEventListener('click', () => {
    if (!reader.source) return;
    hooks.beforeRecalibrate?.();
    openPicker(video || reader.source);
  });
  q('#watchSync').addEventListener('click', sync);

  return { start, stop, useSource, isActive: () => active, reader };
}
