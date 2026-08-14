/** 小さな UI 部品（外部の UI ライブラリは使わない） */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  hint?: string;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

export function slider(opts: SliderOptions): HTMLElement {
  const root = el('div', 'ctl');
  const head = el('div', 'ctl-head');
  const name = el('span', 'ctl-label', opts.label);
  const value = el('span', 'ctl-value');
  head.append(name, value);

  const input = el('input', 'ctl-range');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);

  const fmt = opts.format ?? ((v: number) => v.toFixed(2));
  const paint = () => {
    const v = Number(input.value);
    value.textContent = fmt(v);
    const pct = ((v - opts.min) / (opts.max - opts.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };
  input.addEventListener('input', () => {
    paint();
    opts.onInput(Number(input.value));
  });
  paint();

  root.append(head, input);
  if (opts.hint) root.append(el('div', 'ctl-hint', opts.hint));
  return root;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function segmented<T extends string>(
  label: string,
  options: SegmentedOption<T>[],
  value: T,
  onChange: (v: T) => void
): HTMLElement {
  const root = el('div', 'ctl');
  if (label) root.append(el('div', 'ctl-label', label));
  const group = el('div', 'segmented');
  const buttons: HTMLButtonElement[] = [];
  for (const opt of options) {
    const btn = el('button', 'seg-btn', opt.label);
    btn.type = 'button';
    if (opt.value === value) btn.classList.add('active');
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('active');
      btn.classList.add('active');
      onChange(opt.value);
    });
    buttons.push(btn);
    group.append(btn);
  }
  root.append(group);
  return root;
}

export function button(label: string, className = '', onClick?: () => void): HTMLButtonElement {
  const btn = el('button', `btn ${className}`.trim(), label);
  btn.type = 'button';
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

export function switchRow(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
  hint?: string
): HTMLElement {
  const root = el('label', 'switch-row');
  const texts = el('div', 'switch-texts');
  texts.append(el('span', 'ctl-label', label));
  if (hint) texts.append(el('span', 'ctl-hint', hint));
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.className = 'switch-input';
  const track = el('span', 'switch-track');
  input.addEventListener('change', () => onChange(input.checked));
  root.append(texts, input, track);
  return root;
}

export interface FieldOptions {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  onChange: (v: string) => void;
}

export function textField(opts: FieldOptions): HTMLElement {
  const root = el('div', 'ctl');
  root.append(el('div', 'ctl-label', opts.label));
  const input = el('input', 'text-input');
  input.type = 'text';
  input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.addEventListener('change', () => opts.onChange(input.value));
  root.append(input);
  if (opts.hint) root.append(el('div', 'ctl-hint', opts.hint));
  return root;
}

export function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
  hint?: string
): HTMLElement {
  const root = el('div', 'ctl');
  root.append(el('div', 'ctl-label', label));
  const input = el('input', 'text-input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Number(input.value) || min));
    input.value = String(v);
    onChange(v);
  });
  root.append(input);
  if (hint) root.append(el('div', 'ctl-hint', hint));
  return root;
}

export function textArea(
  label: string,
  value: string,
  rows: number,
  onChange: (v: string) => void,
  hint?: string
): HTMLTextAreaElement {
  const root = el('div', 'ctl');
  root.append(el('div', 'ctl-label', label));
  const area = el('textarea', 'text-area');
  area.value = value;
  area.rows = rows;
  area.spellcheck = false;
  area.addEventListener('change', () => onChange(area.value));
  root.append(area);
  if (hint) root.append(el('div', 'ctl-hint', hint));
  // 呼び出し側から値を書き換えられるよう、textarea 自身に親を持たせて返す
  (area as any).fieldRoot = root;
  return area;
}

/** textArea が返した要素から、画面に差し込む親要素を取り出す */
export function fieldRootOf(node: HTMLElement): HTMLElement {
  return ((node as any).fieldRoot as HTMLElement) ?? node;
}

export function section(title: string, hint?: string): HTMLElement {
  const root = el('div', 'section');
  const head = el('div', 'section-head');
  head.append(el('h3', 'section-title', title));
  if (hint) head.append(el('span', 'section-hint', hint));
  root.append(head);
  return root;
}
