const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_JA = ['ド', '', 'レ', '', 'ミ', 'ファ', '', 'ソ', '', 'ラ', '', 'シ'];

/** 実機に近づけるための黒鍵の左右の寄り（白鍵幅に対する比） */
const BLACK_OFFSET: Record<number, number> = { 1: -0.07, 3: 0.07, 6: -0.09, 8: 0, 10: 0.09 };

export type LabelMode = 'off' | 'c' | 'all' | 'ja';

export interface KeyboardCallbacks {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
}

export function noteName(note: number): string {
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export class PianoKeyboard {
  readonly element: HTMLElement;
  private keys = new Map<number, HTMLElement>();
  private pointers = new Map<number, number>();
  private cb: KeyboardCallbacks;
  private low = 21;
  private high = 108;
  private labelMode: LabelMode = 'c';
  private fixedVelocity: number | null = null;

  constructor(container: HTMLElement, cb: KeyboardCallbacks) {
    this.cb = cb;
    this.element = document.createElement('div');
    this.element.className = 'keybed';
    container.appendChild(this.element);
    this.render();
    this.bindPointer();
  }

  setRange(low: number, high: number) {
    this.low = Math.max(21, Math.min(low, 108));
    this.high = Math.min(108, Math.max(high, this.low + 11));
    this.render();
  }

  getRange(): [number, number] {
    return [this.low, this.high];
  }

  setLabels(mode: LabelMode) {
    this.labelMode = mode;
    this.render();
  }

  setFixedVelocity(v: number | null) {
    this.fixedVelocity = v;
  }

  /** 外部（MIDI・PCキー・デモ再生）からの点灯 */
  highlight(note: number, on: boolean, velocity = 0.6) {
    const el = this.keys.get(note);
    if (!el) return;
    el.classList.toggle('down', on);
    el.style.setProperty('--hit', on ? String(0.25 + velocity * 0.75) : '0');
  }

  clearAll() {
    for (const el of this.keys.values()) {
      el.classList.remove('down');
      el.style.setProperty('--hit', '0');
    }
  }

  private render() {
    this.element.innerHTML = '';
    this.keys.clear();

    let whiteCount = 0;
    for (let n = this.low; n <= this.high; n++) if (!BLACK.has(n % 12)) whiteCount++;
    this.element.style.setProperty('--white-count', String(whiteCount));

    const whiteLayer = document.createElement('div');
    whiteLayer.className = 'key-layer white-layer';
    const blackLayer = document.createElement('div');
    blackLayer.className = 'key-layer black-layer';

    let whiteIndex = 0;
    for (let n = this.low; n <= this.high; n++) {
      const pc = n % 12;
      const key = document.createElement('div');
      key.dataset.note = String(n);
      key.setAttribute('role', 'button');
      key.setAttribute('aria-label', noteName(n));

      if (BLACK.has(pc)) {
        key.className = 'pkey black';
        const offset = BLACK_OFFSET[pc] ?? 0;
        key.style.left = `calc((${whiteIndex} + ${offset} - 0.325) * var(--pkey-w))`;
        blackLayer.appendChild(key);
      } else {
        key.className = 'pkey white';
        key.style.left = `calc(${whiteIndex} * var(--pkey-w))`;
        const label = this.labelFor(n);
        if (label) {
          const span = document.createElement('span');
          span.className = 'pkey-label';
          span.textContent = label;
          key.appendChild(span);
        }
        whiteLayer.appendChild(key);
        whiteIndex++;
      }
      this.keys.set(n, key);
    }

    this.element.appendChild(whiteLayer);
    this.element.appendChild(blackLayer);
  }

  private labelFor(note: number): string {
    const pc = note % 12;
    switch (this.labelMode) {
      case 'off': return '';
      case 'c': return pc === 0 ? noteName(note) : '';
      case 'all': return NAMES[pc];
      case 'ja': return NAMES_JA[pc];
    }
  }

  // ------------------------------------------------------------------ input

  private noteAt(x: number, y: number): { note: number; velocity: number } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const key = el?.closest?.('.pkey') as HTMLElement | null;
    if (!key || !key.dataset.note) return null;
    const note = Number(key.dataset.note);
    if (this.fixedVelocity !== null) return { note, velocity: this.fixedVelocity };
    const rect = key.getBoundingClientRect();
    // 手前（下側）ほど強く鳴る、実機の打鍵位置に合わせた挙動
    const ratio = Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height)));
    const velocity = 0.32 + Math.pow(ratio, 0.85) * 0.68;
    return { note, velocity };
  }

  private press(pointerId: number, note: number, velocity: number) {
    this.pointers.set(pointerId, note);
    this.cb.onNoteOn(note, velocity);
    this.highlight(note, true, velocity);
  }

  private release(pointerId: number) {
    const note = this.pointers.get(pointerId);
    if (note === undefined) return;
    this.pointers.delete(pointerId);
    if (![...this.pointers.values()].includes(note)) {
      this.cb.onNoteOff(note);
      this.highlight(note, false);
    }
  }

  private bindPointer() {
    const el = this.element;

    el.addEventListener('pointerdown', (e) => {
      const hit = this.noteAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      this.press(e.pointerId, hit.note, hit.velocity);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const hit = this.noteAt(e.clientX, e.clientY);
      const current = this.pointers.get(e.pointerId);
      if (!hit) {
        this.release(e.pointerId);
        return;
      }
      if (hit.note !== current) {
        // グリッサンド
        this.release(e.pointerId);
        this.press(e.pointerId, hit.note, hit.velocity * 0.85);
      }
    });

    const end = (e: PointerEvent) => this.release(e.pointerId);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
    window.addEventListener('blur', () => {
      for (const id of [...this.pointers.keys()]) this.release(id);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
