/**
 * Akatsuki Synth — バーチャル鍵盤（マルチタッチ／ベロシティ対応）
 * 押す位置が下に行くほどベロシティが強くなります（実機のアフタータッチ風）。
 */
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface KeyboardOptions {
  low: number;
  high: number;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  onBend: (value: number) => void;
  onMod: (value: number) => void;
  onOctaveShift: (delta: number) => void;
}

export interface KeyboardHandle {
  element: HTMLElement;
  highlight(note: number, on: boolean): void;
  setRange(low: number, high: number): void;
}

export function buildVirtualKeyboard(container: HTMLElement, opts: KeyboardOptions): KeyboardHandle {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'keyboard-area';

  // --- ホイール類 ---
  const wheels = document.createElement('div');
  wheels.className = 'wheels';
  const bend = createWheel('BEND', true, (v) => opts.onBend(v));
  const mod = createWheel('MOD', false, (v) => opts.onMod(v));
  wheels.append(bend.element, mod.element);

  const octWrap = document.createElement('div');
  octWrap.className = 'octave-buttons';
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'btn btn-sm';
  down.textContent = 'OCT −';
  down.addEventListener('click', () => opts.onOctaveShift(-12));
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn btn-sm';
  up.textContent = 'OCT ＋';
  up.addEventListener('click', () => opts.onOctaveShift(12));
  octWrap.append(down, up);
  wheels.appendChild(octWrap);

  const kbScroll = document.createElement('div');
  kbScroll.className = 'kb-scroll';
  const kb = document.createElement('div');
  kb.className = 'keyboard';
  kbScroll.appendChild(kb);

  root.append(wheels, kbScroll);
  container.appendChild(root);

  let noteToEl = new Map<number, HTMLElement>();
  let low = opts.low;
  let high = opts.high;

  function build() {
    kb.innerHTML = '';
    noteToEl = new Map();
    let whiteIndex = 0;
    let whiteCount = 0;
    for (let n = low; n <= high; n++) if (!BLACK_KEYS.has(((n % 12) + 12) % 12)) whiteCount++;
    kb.style.setProperty('--white-count', String(Math.max(1, whiteCount)));

    for (let n = low; n <= high; n++) {
      const pc = ((n % 12) + 12) % 12;
      if (BLACK_KEYS.has(pc)) continue;
      const key = document.createElement('div');
      key.className = 'key white';
      key.dataset.note = String(n);
      if (pc === 0) {
        const label = document.createElement('span');
        label.className = 'key-label';
        label.textContent = `${NOTE_NAMES[pc]}${Math.floor(n / 12) - 1}`;
        key.appendChild(label);
      }
      key.style.left = `calc(${whiteIndex} * var(--key-w))`;
      kb.appendChild(key);
      noteToEl.set(n, key);
      whiteIndex++;
    }

    whiteIndex = 0;
    for (let n = low; n <= high; n++) {
      const pc = ((n % 12) + 12) % 12;
      if (!BLACK_KEYS.has(pc)) {
        whiteIndex++;
        continue;
      }
      const key = document.createElement('div');
      key.className = 'key black';
      key.dataset.note = String(n);
      key.style.left = `calc(${whiteIndex} * var(--key-w) - var(--key-w) * 0.32)`;
      kb.appendChild(key);
      noteToEl.set(n, key);
    }
  }

  const active = new Map<number, number>(); // pointerId -> note

  function velocityFor(el: HTMLElement, clientY: number): number {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return 0.45 + ratio * 0.55;
  }

  function noteFromPoint(x: number, y: number): { note: number; el: HTMLElement } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el || !el.dataset || el.dataset.note === undefined) {
      const parent = el?.closest('.key') as HTMLElement | null;
      if (!parent?.dataset.note) return null;
      return { note: Number(parent.dataset.note), el: parent };
    }
    return { note: Number(el.dataset.note), el };
  }

  function press(pointerId: number, note: number, velocity: number) {
    const prev = active.get(pointerId);
    if (prev === note) return;
    if (prev !== undefined) release(pointerId);
    active.set(pointerId, note);
    noteToEl.get(note)?.classList.add('pressed');
    opts.onNoteOn(note, velocity);
  }

  function release(pointerId: number) {
    const note = active.get(pointerId);
    if (note === undefined) return;
    active.delete(pointerId);
    if (![...active.values()].includes(note)) {
      noteToEl.get(note)?.classList.remove('pressed');
      opts.onNoteOff(note);
    }
  }

  kb.addEventListener('pointerdown', (e) => {
    const hit = noteFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    kb.setPointerCapture(e.pointerId);
    press(e.pointerId, hit.note, velocityFor(hit.el, e.clientY));
  });
  kb.addEventListener('pointermove', (e) => {
    if (!active.has(e.pointerId)) return;
    const hit = noteFromPoint(e.clientX, e.clientY);
    if (!hit) {
      release(e.pointerId);
      return;
    }
    press(e.pointerId, hit.note, velocityFor(hit.el, e.clientY));
  });
  const end = (e: PointerEvent) => {
    release(e.pointerId);
    try {
      kb.releasePointerCapture(e.pointerId);
    } catch {
      /* 解放済み */
    }
  };
  kb.addEventListener('pointerup', end);
  kb.addEventListener('pointercancel', end);
  kb.addEventListener('pointerleave', (e) => {
    if (active.has(e.pointerId) && e.buttons === 0) release(e.pointerId);
  });

  build();

  return {
    element: root,
    highlight(note, on) {
      noteToEl.get(note)?.classList.toggle('pressed', on);
    },
    setRange(l, h) {
      low = l;
      high = h;
      build();
    },
  };
}

function createWheel(label: string, spring: boolean, onChange: (v: number) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'wheel-wrap';
  const track = document.createElement('div');
  track.className = 'wheel';
  const knob = document.createElement('div');
  knob.className = 'wheel-knob';
  track.appendChild(knob);
  const name = document.createElement('span');
  name.className = 'wheel-label';
  name.textContent = label;
  wrap.append(track, name);

  let value = spring ? 0 : 0; // bend: -1..1 / mod: 0..1
  const render = () => {
    const norm = spring ? (value + 1) / 2 : value;
    knob.style.bottom = `calc(${norm * 100}% - ${norm * 22}px)`;
  };
  render();

  let dragging = false;
  const setFromY = (clientY: number) => {
    const rect = track.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    value = spring ? norm * 2 - 1 : norm;
    render();
    onChange(value);
  };

  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    track.setPointerCapture(e.pointerId);
    setFromY(e.clientY);
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging) setFromY(e.clientY);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      track.releasePointerCapture(e.pointerId);
    } catch {
      /* 解放済み */
    }
    if (spring) {
      value = 0;
      render();
      onChange(0);
    }
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);

  return { element: wrap };
}
