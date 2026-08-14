/**
 * Akatsuki Synth — ピアノロール・エディタ
 *
 * Canvas で描画し、ノートの追加／移動／長さ変更／ベロシティ編集／
 * パターンスロット切替・コピー＆ペースト・アンドゥに対応します。
 */
import { PATTERN_SLOTS, PIANO_ROLL_MAX, PIANO_ROLL_MIN, STEPS_PER_BAR, type Pattern, type SeqNote, type Track } from '../audio/Sequencer';
import { toast } from './widgets';

const KEY_W = 46;
const RULER_H = 20;
const VEL_H = 54;
const MIN_ROW_H = 8;
const MAX_ROW_H = 26;
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface PianoRollOptions {
  getTrack: () => Track | null;
  onPreview: (pitch: number, velocity: number) => void;
  onPreviewEnd: (pitch: number) => void;
  onChange: () => void;
}

export interface PianoRollHandle {
  element: HTMLElement;
  refresh(): void;
  setPlayhead(tick: number): void;
  undo(): void;
  destroy(): void;
}

type DragMode = 'none' | 'create' | 'move' | 'resize' | 'velocity' | 'scroll';

export function createPianoRoll(container: HTMLElement, opts: PianoRollOptions): PianoRollHandle {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'roll';
  container.appendChild(root);

  // ------------------------------------------------------------ toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'roll-toolbar';
  root.appendChild(toolbar);

  const slotWrap = document.createElement('div');
  slotWrap.className = 'slot-group';
  const slotButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < PATTERN_SLOTS; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot-btn';
    b.textContent = String.fromCharCode(65 + i);
    b.title = `パターン ${String.fromCharCode(65 + i)}`;
    b.addEventListener('click', () => {
      const track = opts.getTrack();
      if (!track) return;
      track.activePattern = i;
      refresh();
      opts.onChange();
    });
    slotButtons.push(b);
    slotWrap.appendChild(b);
  }
  toolbar.appendChild(slotWrap);

  const lengthSel = document.createElement('select');
  lengthSel.className = 'field-select';
  for (const len of [8, 16, 24, 32, 48, 64]) {
    const o = document.createElement('option');
    o.value = String(len);
    o.textContent = `${len} steps (${(len / STEPS_PER_BAR).toFixed(len % STEPS_PER_BAR ? 2 : 0)}小節)`;
    lengthSel.appendChild(o);
  }
  lengthSel.addEventListener('change', () => {
    const track = opts.getTrack();
    if (!track) return;
    pushUndo();
    track.pattern.length = Number(lengthSel.value);
    track.pattern.notes = track.pattern.notes.filter((n) => n.step < track.pattern.length);
    refresh();
    opts.onChange();
  });
  toolbar.appendChild(labeled('長さ', lengthSel));

  const noteLenSel = document.createElement('select');
  noteLenSel.className = 'field-select';
  for (const [v, t] of [
    ['1', '16分'],
    ['2', '8分'],
    ['4', '4分'],
    ['8', '2分'],
    ['16', '全音符'],
  ] as const) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    noteLenSel.appendChild(o);
  }
  noteLenSel.value = '1';
  toolbar.appendChild(labeled('入力長', noteLenSel));

  const velInput = document.createElement('input');
  velInput.type = 'range';
  velInput.min = '10';
  velInput.max = '100';
  velInput.value = '90';
  velInput.className = 'roll-vel-input';
  toolbar.appendChild(labeled('強さ', velInput));

  const spacer = document.createElement('div');
  spacer.className = 'flex-spacer';
  toolbar.appendChild(spacer);

  const mkBtn = (label: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    toolbar.appendChild(b);
    return b;
  };

  let clipboard: Pattern | null = null;
  mkBtn('コピー', 'このパターンをコピー', () => {
    const track = opts.getTrack();
    if (!track) return;
    clipboard = JSON.parse(JSON.stringify(track.pattern));
    toast('パターンをコピーしました');
  });
  mkBtn('貼付', 'コピーしたパターンを貼り付け', () => {
    const track = opts.getTrack();
    if (!track || !clipboard) return;
    pushUndo();
    track.patterns[track.activePattern] = JSON.parse(JSON.stringify(clipboard));
    refresh();
    opts.onChange();
    toast('パターンを貼り付けました');
  });
  mkBtn('元に戻す', 'Ctrl+Z', () => undo());
  mkBtn('クリア', 'このパターンのノートを全消去', () => {
    const track = opts.getTrack();
    if (!track) return;
    pushUndo();
    track.pattern.notes = [];
    refresh();
    opts.onChange();
  });
  mkBtn('−', '縮小', () => setRowH(rowH - 3));
  mkBtn('＋', '拡大', () => setRowH(rowH + 3));

  // ------------------------------------------------------------ canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'roll-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'roll-canvas';
  canvasWrap.appendChild(canvas);
  root.appendChild(canvasWrap);

  let rowH = 13;
  let colW = 30;
  let scrollY = 0;
  let playhead = -1;
  const undoStack: string[] = [];
  let selected: SeqNote | null = null;

  const pitchCount = PIANO_ROLL_MAX - PIANO_ROLL_MIN + 1;

  function pattern(): Pattern | null {
    return opts.getTrack()?.pattern ?? null;
  }

  function pushUndo() {
    const pat = pattern();
    if (!pat) return;
    undoStack.push(JSON.stringify(pat));
    if (undoStack.length > 60) undoStack.shift();
  }

  function undo() {
    const track = opts.getTrack();
    if (!track || undoStack.length === 0) return;
    const data = undoStack.pop()!;
    track.patterns[track.activePattern] = JSON.parse(data);
    selected = null;
    refresh();
    opts.onChange();
  }

  function setRowH(v: number) {
    rowH = Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, v));
    draw();
  }

  function gridHeight(): number {
    return Math.max(40, canvasWrap.clientHeight - RULER_H - VEL_H);
  }

  function maxScroll(): number {
    return Math.max(0, pitchCount * rowH - gridHeight());
  }

  function pitchAtY(y: number): number {
    const idx = Math.floor((y - RULER_H + scrollY) / rowH);
    return PIANO_ROLL_MAX - idx;
  }

  function yOfPitch(pitch: number): number {
    return RULER_H + (PIANO_ROLL_MAX - pitch) * rowH - scrollY;
  }

  function stepAtX(x: number): number {
    return Math.floor((x - KEY_W) / colW);
  }

  function xOfStep(step: number): number {
    return KEY_W + step * colW;
  }

  function updateColW() {
    const pat = pattern();
    const steps = pat?.length ?? 16;
    const avail = Math.max(120, canvasWrap.clientWidth - KEY_W - 2);
    colW = Math.max(9, avail / steps);
  }

  function noteAt(step: number, pitch: number): SeqNote | null {
    const pat = pattern();
    if (!pat) return null;
    for (let i = pat.notes.length - 1; i >= 0; i--) {
      const n = pat.notes[i];
      if (n.pitch === pitch && step >= n.step && step < n.step + n.length) return n;
    }
    return null;
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvasWrap.clientWidth;
    const h = canvasWrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pat = pattern();
    const track = opts.getTrack();
    updateColW();
    const steps = pat?.length ?? 16;
    const gh = gridHeight();
    const gridBottom = RULER_H + gh;

    const bg = cssVar('--roll-bg', '#141019');
    const bgAlt = cssVar('--roll-bg-alt', '#191320');
    const line = cssVar('--roll-line', 'rgba(255,255,255,0.05)');
    const lineStrong = cssVar('--roll-line-strong', 'rgba(255,255,255,0.14)');
    const accent = cssVar('--accent', '#ff8ab3');
    const accent2 = cssVar('--accent-2', '#8ad7ff');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // --- 行（音階）背景 ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(KEY_W, RULER_H, w - KEY_W, gh);
    ctx.clip();
    for (let p = PIANO_ROLL_MAX; p >= PIANO_ROLL_MIN; p--) {
      const y = yOfPitch(p);
      if (y + rowH < RULER_H || y > gridBottom) continue;
      const isBlack = BLACK_KEYS.has(((p % 12) + 12) % 12);
      ctx.fillStyle = isBlack ? bg : bgAlt;
      ctx.fillRect(KEY_W, y, w - KEY_W, rowH);
      if (p % 12 === 0) {
        ctx.fillStyle = lineStrong;
        ctx.fillRect(KEY_W, y + rowH - 1, w - KEY_W, 1);
      }
    }

    // --- 縦グリッド ---
    for (let s = 0; s <= steps; s++) {
      const x = xOfStep(s);
      const isBar = s % STEPS_PER_BAR === 0;
      const isBeat = s % 4 === 0;
      if (!isBeat && colW < 14) continue;
      ctx.fillStyle = isBar ? lineStrong : isBeat ? line : 'rgba(255,255,255,0.03)';
      ctx.fillRect(Math.round(x), RULER_H, isBar ? 1.5 : 1, gh);
    }

    // --- ノート ---
    if (pat) {
      const isDrum = track?.patch.kind === 'drum';
      for (const n of pat.notes) {
        const y = yOfPitch(n.pitch);
        if (y + rowH < RULER_H || y > gridBottom) continue;
        const x = xOfStep(n.step);
        const nw = Math.max(3, n.length * colW - 1.5);
        const alpha = 0.4 + n.velocity * 0.6;
        const grad = ctx.createLinearGradient(x, y, x, y + rowH);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, accent2);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = grad;
        roundRect(ctx, x + 0.5, y + 1, nw, Math.max(3, rowH - 2), Math.min(3, rowH / 3));
        ctx.fill();
        ctx.globalAlpha = 1;
        if (n === selected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          roundRect(ctx, x + 0.5, y + 1, nw, Math.max(3, rowH - 2), Math.min(3, rowH / 3));
          ctx.stroke();
        }
        void isDrum;
      }
    }

    // --- 再生ヘッド ---
    if (playhead >= 0 && pat) {
      const local = ((playhead % pat.length) + pat.length) % pat.length;
      const x = xOfStep(local);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, RULER_H, colW, gh);
      ctx.fillStyle = accent;
      ctx.fillRect(x, RULER_H, 2, gh);
    }
    ctx.restore();

    // --- ルーラー ---
    ctx.fillStyle = cssVar('--panel-2', '#1b1622');
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let s = 0; s < steps; s += STEPS_PER_BAR) {
      const x = xOfStep(s);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(String(s / STEPS_PER_BAR + 1), x + 4, RULER_H / 2);
      ctx.fillStyle = lineStrong;
      ctx.fillRect(x, 0, 1, RULER_H);
    }

    // --- 鍵盤（左） ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, KEY_W, gh);
    ctx.clip();
    for (let p = PIANO_ROLL_MAX; p >= PIANO_ROLL_MIN; p--) {
      const y = yOfPitch(p);
      if (y + rowH < RULER_H || y > gridBottom) continue;
      const isBlack = BLACK_KEYS.has(((p % 12) + 12) % 12);
      ctx.fillStyle = isBlack ? '#15111b' : '#e9e2ee';
      ctx.fillRect(0, y, KEY_W - 1, rowH - 0.5);
      if (p % 12 === 0 && rowH >= 9) {
        ctx.fillStyle = '#7a6f85';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(noteName(p), 4, y + rowH / 2);
      }
    }
    ctx.restore();

    // --- ベロシティレーン ---
    const vy = gridBottom;
    ctx.fillStyle = cssVar('--panel-2', '#1b1622');
    ctx.fillRect(0, vy, w, VEL_H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('VELOCITY', 5, vy + 10);
    if (pat) {
      for (const n of pat.notes) {
        const x = xOfStep(n.step);
        const bh = (VEL_H - 14) * n.velocity;
        ctx.fillStyle = n === selected ? '#fff' : accent;
        ctx.globalAlpha = n === selected ? 1 : 0.75;
        ctx.fillRect(x + 1, vy + VEL_H - 4 - bh, Math.max(2, Math.min(colW - 2, 8)), bh);
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = lineStrong;
    ctx.beginPath();
    ctx.moveTo(0, vy + 0.5);
    ctx.lineTo(w, vy + 0.5);
    ctx.stroke();
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    const rr = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // ------------------------------------------------------------ pointer
  let drag: DragMode = 'none';
  let dragNote: SeqNote | null = null;
  let dragOffsetStep = 0;
  let lastPreview = -1;
  let scrollStartY = 0;
  let scrollStartScroll = 0;

  function localPos(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const track = opts.getTrack();
    const pat = pattern();
    if (!track || !pat) return;
    const { x, y } = localPos(e);
    canvas.setPointerCapture(e.pointerId);
    const gridBottom = RULER_H + gridHeight();

    // 鍵盤ガター：試聴
    if (x < KEY_W && y > RULER_H && y < gridBottom) {
      const pitch = pitchAtY(y);
      lastPreview = pitch;
      opts.onPreview(pitch, Number(velInput.value) / 100);
      drag = 'scroll';
      scrollStartY = e.clientY;
      scrollStartScroll = scrollY;
      return;
    }

    // ベロシティレーン
    if (y >= gridBottom) {
      drag = 'velocity';
      applyVelocity(x, y);
      return;
    }
    if (y < RULER_H) return;

    const step = stepAtX(x);
    const pitch = pitchAtY(y);
    if (step < 0 || step >= pat.length || pitch < PIANO_ROLL_MIN || pitch > PIANO_ROLL_MAX) return;

    const hit = noteAt(step, pitch);
    const erase = e.button === 2 || e.altKey || e.metaKey;

    if (hit && erase) {
      pushUndo();
      pat.notes.splice(pat.notes.indexOf(hit), 1);
      selected = null;
      draw();
      opts.onChange();
      return;
    }

    if (hit) {
      pushUndo();
      selected = hit;
      dragNote = hit;
      const rightEdge = xOfStep(hit.step + hit.length);
      drag = x > rightEdge - Math.min(10, colW * 0.4) ? 'resize' : 'move';
      dragOffsetStep = step - hit.step;
      opts.onPreview(hit.pitch, hit.velocity);
      lastPreview = hit.pitch;
      draw();
      return;
    }

    if (erase) return;

    pushUndo();
    const len = Math.max(1, Math.min(pat.length - step, Number(noteLenSel.value)));
    const note: SeqNote = { step, pitch, length: len, velocity: Number(velInput.value) / 100 };
    pat.notes.push(note);
    pat.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
    selected = note;
    dragNote = note;
    drag = 'create';
    opts.onPreview(pitch, note.velocity);
    lastPreview = pitch;
    draw();
    opts.onChange();
  });

  canvas.addEventListener('pointermove', (e) => {
    const pat = pattern();
    if (!pat) return;
    const { x, y } = localPos(e);

    if (drag === 'none') {
      const step = stepAtX(x);
      const pitch = pitchAtY(y);
      const hit = y > RULER_H && y < RULER_H + gridHeight() && x > KEY_W ? noteAt(step, pitch) : null;
      if (hit) {
        const rightEdge = xOfStep(hit.step + hit.length);
        canvas.style.cursor = x > rightEdge - Math.min(10, colW * 0.4) ? 'ew-resize' : 'grab';
      } else {
        canvas.style.cursor = x < KEY_W ? 'pointer' : 'crosshair';
      }
      return;
    }

    if (drag === 'scroll') {
      const dy = e.clientY - scrollStartY;
      scrollY = Math.max(0, Math.min(maxScroll(), scrollStartScroll - dy));
      draw();
      return;
    }

    if (drag === 'velocity') {
      applyVelocity(x, y);
      return;
    }

    if (!dragNote) return;
    const step = stepAtX(x);
    if (drag === 'create' || drag === 'resize') {
      const len = Math.max(1, Math.min(pat.length - dragNote.step, step - dragNote.step + 1));
      if (len !== dragNote.length) {
        dragNote.length = len;
        draw();
      }
    } else if (drag === 'move') {
      const pitch = Math.max(PIANO_ROLL_MIN, Math.min(PIANO_ROLL_MAX, pitchAtY(y)));
      const newStep = Math.max(0, Math.min(pat.length - dragNote.length, step - dragOffsetStep));
      if (pitch !== dragNote.pitch || newStep !== dragNote.step) {
        if (pitch !== dragNote.pitch && lastPreview !== pitch) {
          opts.onPreviewEnd(lastPreview);
          opts.onPreview(pitch, dragNote.velocity);
          lastPreview = pitch;
        }
        dragNote.pitch = pitch;
        dragNote.step = newStep;
        draw();
      }
    }
  });

  function applyVelocity(x: number, y: number) {
    const pat = pattern();
    if (!pat) return;
    const step = stepAtX(x);
    const vy = RULER_H + gridHeight();
    const v = Math.max(0.05, Math.min(1, (vy + VEL_H - 4 - y) / (VEL_H - 14)));
    let touched = false;
    for (const n of pat.notes) {
      if (n.step === step) {
        n.velocity = v;
        touched = true;
      }
    }
    if (touched) {
      draw();
      opts.onChange();
    }
  }

  const endPointer = (e: PointerEvent) => {
    if (drag !== 'none') {
      if (lastPreview >= 0) {
        opts.onPreviewEnd(lastPreview);
        lastPreview = -1;
      }
      if (drag !== 'scroll') opts.onChange();
    }
    drag = 'none';
    dragNote = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* 解放済み */
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setRowH(rowH - Math.sign(e.deltaY) * 2);
        return;
      }
      e.preventDefault();
      scrollY = Math.max(0, Math.min(maxScroll(), scrollY + e.deltaY));
      draw();
    },
    { passive: false }
  );

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (!selected) return;
    const pat = pattern();
    if (!pat) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      pushUndo();
      const idx = pat.notes.indexOf(selected);
      if (idx >= 0) pat.notes.splice(idx, 1);
      selected = null;
      draw();
      opts.onChange();
    }
  };
  document.addEventListener('keydown', onKey);

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(canvasWrap);

  let lastTrackKey = '';

  function refresh() {
    const track = opts.getTrack();
    if (track) {
      lengthSel.value = String(track.pattern.length);
      slotButtons.forEach((b, i) => b.classList.toggle('on', i === track.activePattern));
      slotButtons.forEach((b, i) => b.classList.toggle('has-notes', (track.patterns[i]?.notes.length ?? 0) > 0));

      // トラック／パターンを切り替えたら、打ち込まれている音域が見えるようスクロール
      const key = `${track.id}:${track.activePattern}`;
      if (key !== lastTrackKey) {
        lastTrackKey = key;
        const notes = track.pattern.notes;
        const center =
          notes.length > 0
            ? Math.round(notes.reduce((sum, n) => sum + n.pitch, 0) / notes.length)
            : track.patch.kind === 'drum'
              ? 60
              : 62;
        const rows = Math.max(1, Math.floor(gridHeight() / rowH));
        scrollY = Math.max(0, Math.min(maxScroll(), (PIANO_ROLL_MAX - center - Math.floor(rows / 2)) * rowH));
      }
    }
    draw();
  }

  refresh();

  return {
    element: root,
    refresh,
    setPlayhead(tick: number) {
      if (tick === playhead) return;
      playhead = tick;
      draw();
    },
    undo,
    destroy() {
      resizeObserver.disconnect();
      document.removeEventListener('keydown', onKey);
    },
  };
}

function labeled(label: string, el: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field field-inline';
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = label;
  wrap.append(span, el);
  return wrap;
}
