/**
 * Akatsuki Synth — 共通UIコンポーネント
 * ノブ・スイッチ・セレクト・モジュール枠など、ハードウェアシンセ風の部品群。
 */

export interface KnobOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  /** 対数的に変化させる（カットオフ周波数など） */
  curve?: 'linear' | 'log';
  bipolar?: boolean;
  unit?: string;
  size?: 'sm' | 'md';
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export interface KnobHandle extends HTMLElement {
  setKnobValue(v: number): void;
}

const ARC_START = -135;
const ARC_SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function createKnob(opts: KnobOptions): KnobHandle {
  const { min, max } = opts;
  const log = opts.curve === 'log' && min > 0;
  const step = opts.step ?? (max - min) / 200;
  let value = opts.value;

  const wrap = document.createElement('div');
  wrap.className = `knob${opts.size === 'sm' ? ' knob-sm' : ''}`;
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-label', opts.label);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.classList.add('knob-svg');

  const track = document.createElementNS(svgNs, 'path');
  track.setAttribute('d', arcPath(24, 24, 18, ARC_START, ARC_START + ARC_SWEEP));
  track.setAttribute('class', 'knob-track');
  svg.appendChild(track);

  const fill = document.createElementNS(svgNs, 'path');
  fill.setAttribute('class', 'knob-fill');
  svg.appendChild(fill);

  const cap = document.createElementNS(svgNs, 'circle');
  cap.setAttribute('cx', '24');
  cap.setAttribute('cy', '24');
  cap.setAttribute('r', '13');
  cap.setAttribute('class', 'knob-cap');
  svg.appendChild(cap);

  const pointer = document.createElementNS(svgNs, 'line');
  pointer.setAttribute('class', 'knob-pointer');
  svg.appendChild(pointer);

  const label = document.createElement('div');
  label.className = 'knob-label';
  label.textContent = opts.label;
  const readout = document.createElement('div');
  readout.className = 'knob-value';

  const toNorm = (v: number) => {
    if (log) return Math.log(v / min) / Math.log(max / min);
    return (v - min) / (max - min);
  };
  const fromNorm = (n: number) => {
    if (log) return min * Math.pow(max / min, n);
    return min + n * (max - min);
  };

  function render() {
    const n = Math.max(0, Math.min(1, toNorm(value)));
    const angle = ARC_START + n * ARC_SWEEP;
    const zero = opts.bipolar ? ARC_START + ARC_SWEEP / 2 : ARC_START;
    fill.setAttribute('d', arcPath(24, 24, 18, Math.min(zero, angle), Math.max(zero, angle)));
    const tip = polar(24, 24, 12.5, angle);
    const root = polar(24, 24, 5, angle);
    pointer.setAttribute('x1', root.x.toFixed(2));
    pointer.setAttribute('y1', root.y.toFixed(2));
    pointer.setAttribute('x2', tip.x.toFixed(2));
    pointer.setAttribute('y2', tip.y.toFixed(2));
    readout.textContent = opts.format ? opts.format(value) : value.toFixed(2) + (opts.unit ?? '');
    wrap.setAttribute('aria-valuenow', String(Math.round(value * 1000) / 1000));
    wrap.setAttribute('aria-valuemin', String(min));
    wrap.setAttribute('aria-valuemax', String(max));
  }

  function setValue(v: number, notify: boolean) {
    if (!Number.isFinite(v)) return;
    const snapped = opts.step ? Math.round(v / opts.step) * opts.step : v;
    value = Math.max(min, Math.min(max, snapped));
    render();
    if (notify) opts.onChange(value);
  }

  let dragging = false;
  let startY = 0;
  let startNorm = 0;

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startNorm = toNorm(value);
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('active');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const fine = e.shiftKey ? 0.25 : 1;
    const delta = ((startY - e.clientY) / 180) * fine;
    setValue(fromNorm(Math.max(0, Math.min(1, startNorm + delta))), true);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      wrap.releasePointerCapture(e.pointerId);
    } catch {
      /* すでに解放済み */
    }
    wrap.classList.remove('active');
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('dblclick', () => setValue(opts.value, true));
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = -Math.sign(e.deltaY);
      setValue(fromNorm(Math.max(0, Math.min(1, toNorm(value) + dir * (e.shiftKey ? 0.005 : 0.02)))), true);
    },
    { passive: false }
  );
  wrap.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      setValue(fromNorm(Math.min(1, toNorm(value) + big)), true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setValue(fromNorm(Math.max(0, toNorm(value) - big)), true);
    } else if (e.key === 'Home') {
      setValue(opts.value, true);
    }
  });

  render();
  wrap.append(svg, label, readout);
  const handle = wrap as unknown as KnobHandle;
  handle.setKnobValue = (v: number) => setValue(v, false);
  void step;
  return handle;
}

export function createSelect<T extends string>(
  label: string,
  options: { value: T; text: string }[],
  current: T,
  onChange: (v: T) => void
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const lbl = document.createElement('span');
  lbl.className = 'field-label';
  lbl.textContent = label;
  const sel = document.createElement('select');
  sel.className = 'field-select';
  for (const o of options) {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.text;
    if (o.value === current) el.selected = true;
    sel.appendChild(el);
  }
  sel.addEventListener('change', () => onChange(sel.value as T));
  wrap.append(lbl, sel);
  return wrap;
}

export function createToggle(label: string, current: boolean, onChange: (v: boolean) => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'switch' + (current ? ' on' : '');
  btn.setAttribute('aria-pressed', String(current));
  const dot = document.createElement('span');
  dot.className = 'switch-led';
  const text = document.createElement('span');
  text.textContent = label;
  btn.append(dot, text);
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('on');
    btn.classList.toggle('on', next);
    btn.setAttribute('aria-pressed', String(next));
    onChange(next);
  });
  return btn;
}

export function createButton(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${className}`.trim();
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export function moduleBox(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  const box = document.createElement('section');
  box.className = 'module';
  const header = document.createElement('header');
  header.className = 'module-header';
  header.textContent = title;
  const body = document.createElement('div');
  body.className = 'module-body';
  for (const c of children) if (c) body.appendChild(c);
  box.append(header, body);
  return box;
}

export function row(...children: (HTMLElement | null)[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/** モーダルダイアログ（設定・ヘルプ・書き出し用） */
export function openModal(title: string, content: HTMLElement, actions?: HTMLElement[]): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);

  const head = document.createElement('div');
  head.className = 'modal-head';
  const h = document.createElement('h2');
  h.textContent = title;
  const close = document.createElement('button');
  close.className = 'modal-close';
  close.setAttribute('aria-label', '閉じる');
  close.textContent = '×';
  head.append(h, close);

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.appendChild(content);

  dialog.append(head, body);
  if (actions && actions.length > 0) {
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    for (const a of actions) foot.appendChild(a);
    dialog.appendChild(foot);
  }
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const dispose = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dispose();
  };
  close.addEventListener('click', dispose);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) dispose();
  });
  document.addEventListener('keydown', onKey);
  return dispose;
}

let toastTimer: number | null = null;
export function toast(message: string) {
  let el = document.getElementById('mss-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mss-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2600);
}
