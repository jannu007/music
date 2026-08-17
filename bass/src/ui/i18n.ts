/*
 * 表示言語（日本語 / 英語）の切り替え
 *
 * フレームワークを使わないアプリなので、キー→訳文の単純な辞書と、
 * ロケール変更を購読できる仕組みだけを用意する。
 */

export type Locale = 'ja' | 'en';

const STORAGE_KEY = 'kurogane-bass-lang';

type Dict = Record<string, string>;
const strings: Record<Locale, Dict> = { ja: {}, en: {} };

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    /* プライベートモード等で読めない場合は言語検出にフォールバック */
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* 保存できなくても切り替え自体は続行する */
  }
  document.documentElement.lang = locale;
  for (const fn of listeners) fn();
}

export function toggleLocale() {
  setLocale(current === 'ja' ? 'en' : 'ja');
}

/** ロケールが変わるたびに呼ばれる。呼び出し側は再描画すること */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 辞書を登録する（複数ファイルから呼んでまとめてよい） */
export function registerStrings(ja: Dict, en: Dict) {
  Object.assign(strings.ja, ja);
  Object.assign(strings.en, en);
}

/** キーを訳文に変換する。{name} のようなプレースホルダーを vars で埋められる */
export function t(key: string, vars?: Record<string, string | number>): string {
  let value = strings[current][key] ?? strings.ja[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) value = value.split(`{${k}}`).join(String(v));
  }
  return value;
}
