/**
 * 画面上部に置く、マスター音量のつまみ。
 *
 * もともと音量は各アプリの奥（アンプ画面やミキサー）にしか無かった。
 * いちど 0 にすると値は保存され、次に開いても無音のまま。画面には何も
 * 出ないので「壊れた」と思われてしまう。実際にそうなった。
 *
 * 直し方は単純で、いつでも見えて届くところに置くこと。0 なら一目で分かり、
 * その場で戻せる。7本とも同じ作りにするため、ここに一つだけ置く。
 *
 * 見た目の色はアプリごとに違うので、CSS 変数で受ける。
 * 何も指定しなければ、無難な既定値で描く。
 *
 *   --mv-panel   土台の色
 *   --mv-line    枠の色
 *   --mv-accent  つまみと溝の色
 *   --mv-zero    0 のときの色（既定は赤）
 *   --mv-pop-bg  畳んだ形で出てくる溝の土台（不透明にすること）
 */

export interface MasterVolumeOptions {
  /** 読み上げと吹き出しに使う名前（例: マスター音量） */
  label: string;
  /** いまの音量（0..1） */
  get: () => number;
  /** 動かされたときに呼ばれる */
  set: (value: number) => void;
  /** 上限。既定は 1。シンセのように 1 を超えるものだけ渡す */
  max?: number;
  /**
   * 狭い画面用の畳んだ形。
   *
   * 上に並べる物が増えると、溝（86px）が場所を食って、隣の文字が
   * 切れる。押すと溝が下に出てくるアイコン1つに畳む。0 のときは
   * アイコンが赤くなるので、「音が出ない理由がここにある」ことは
   * 畳んでいても一目で分かる。
   */
  compact?: boolean;
}

export interface MasterVolumeControl {
  /** ヘッダーへ入れる要素 */
  root: HTMLElement;
  /** 外（設定画面など）で音量が変わったときに呼ぶと、見た目を合わせる */
  sync: () => void;
}

const STYLE_ID = 'shared-master-volume-style';

/** 骨組みの見た目。色はアプリ側の変数を優先する */
const CSS = `
.mv-wrap {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: none;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: var(--mv-panel, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--mv-line, rgba(255, 255, 255, 0.16));
}
.mv-icon svg { width: 17px; height: 17px; display: block; color: var(--mv-accent, #9fd8ff); }
.mv-range {
  -webkit-appearance: none;
  appearance: none;
  width: 86px;
  height: 20px;
  background: transparent;
  margin: 0;
}
.mv-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: var(--mv-accent, #9fd8ff);
}
.mv-range::-moz-range-track {
  height: 4px; border-radius: 2px;
  background: var(--mv-accent, #9fd8ff);
}
/* 指で掴める大きさにする（実機で 20px 未満は掴みにくい） */
.mv-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 20px; height: 20px; margin-top: -8px;
  border-radius: 50%;
  background: var(--mv-accent, #9fd8ff);
  border: 1px solid rgba(0, 0, 0, 0.75);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.mv-range::-moz-range-thumb {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--mv-accent, #9fd8ff);
  border: 1px solid rgba(0, 0, 0, 0.75);
}
/* 0 のときは色を変える。音が出ない理由がここにあると、見ただけで分かる */
.mv-wrap.is-zero { border-color: var(--mv-zero, #e4674f); }
.mv-wrap.is-zero .mv-icon svg { color: var(--mv-zero, #e4674f); }
.mv-range.is-zero::-webkit-slider-thumb { background: var(--mv-zero, #e4674f); }
.mv-range.is-zero::-moz-range-thumb { background: var(--mv-zero, #e4674f); }
/* ── 畳んだ形 ── */
.mv-wrap.is-compact {
  position: relative;
  padding: 0;
  border: none;
  background: none;
}
.mv-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 999px;
  background: var(--mv-panel, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--mv-line, rgba(255, 255, 255, 0.16));
  color: inherit;
  cursor: pointer;
}
.mv-wrap.is-compact.is-zero .mv-toggle { border-color: var(--mv-zero, #e4674f); }
.mv-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  display: none;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  border-radius: 12px;
  /* 透けると、後ろの操作の文字が重なって読めなくなる。ここは不透明にする */
  background: var(--mv-pop-bg, #17120f);
  border: 1px solid var(--mv-line, rgba(255, 255, 255, 0.16));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.mv-wrap.is-compact.is-open .mv-pop { display: flex; }
.mv-pop .mv-range { width: 132px; }

/* 狭い画面でも隠さない。隠すと、また 0 に気づけない状態に戻ってしまう */
@media (max-width: 559px) {
  .mv-wrap { padding: 0.15rem 0.35rem; gap: 0.25rem; }
  .mv-range { width: 64px; }
}
`;

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

export function masterVolumeControl(opts: MasterVolumeOptions): MasterVolumeControl {
  ensureStyle();

  const root = document.createElement('div');
  root.className = opts.compact ? 'mv-wrap is-compact' : 'mv-wrap';
  root.title = opts.label;

  // 畳んだ形では、アイコンそのものが押しボタンになる
  const icon = document.createElement(opts.compact ? 'button' : 'span');
  icon.className = opts.compact ? 'mv-icon mv-toggle' : 'mv-icon';
  if (icon instanceof HTMLButtonElement) {
    icon.type = 'button';
    icon.setAttribute('aria-label', opts.label);
  } else {
    icon.setAttribute('aria-hidden', 'true');
  }
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" focusable="false">'
    + '<path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" fill="currentColor" />'
    + '<path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.9 6.7a7.5 7.5 0 0 1 0 10.6"'
    + ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />'
    + '</svg>';

  const range = document.createElement('input');
  range.className = 'mv-range';
  range.type = 'range';
  range.min = '0';
  range.max = String(opts.max ?? 1);
  range.step = '0.01';
  range.setAttribute('aria-label', opts.label);

  const sync = () => {
    const v = opts.get();
    const text = String(v);
    if (range.value !== text) range.value = text;
    const zero = v <= 0;
    range.classList.toggle('is-zero', zero);
    root.classList.toggle('is-zero', zero);
  };

  range.addEventListener('input', () => {
    opts.set(Number(range.value));
    sync();
  });

  if (opts.compact) {
    const pop = document.createElement('div');
    pop.className = 'mv-pop';
    pop.append(range);
    root.append(icon, pop);

    const close = () => root.classList.remove('is-open');
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      root.classList.toggle('is-open');
    });
    // 外を触ったら閉じる。開きっぱなしだと指板を隠してしまう
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  } else {
    root.append(icon, range);
  }
  sync();
  return { root, sync };
}
