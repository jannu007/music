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
  root.append(el('div', 'ctl-label', label));
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

export function select<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void
): HTMLElement {
  const root = el('div', 'ctl');
  root.append(el('div', 'ctl-label', label));
  const node = el('select', 'ctl-select');
  for (const opt of options) {
    const option = el('option', undefined, opt.label);
    option.value = opt.value;
    node.append(option);
  }
  node.value = value;
  node.addEventListener('change', () => onChange(node.value as T));
  root.append(node);
  return root;
}
