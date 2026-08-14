/*
 * かな → 音素の変換
 *
 * 1音符 = 1モーラを基本とし、「きゃ」のような拗音、「っ」の促音、
 * 語末の「ん」（撥音の付いた音符）、「ー」の長音までを解釈する。
 * ローマ字入力（ka, kya, la …）も同じ形に落とし込む。
 */

import type { Vowel } from './types';

export interface ParsedLyric {
  /** 子音の並び（例: きゃ → ['k','y']、っと → ['Q','t']） */
  onset: string[];
  /** 母音。null は「前の音を伸ばす」 */
  vowel: Vowel | null;
  /** 語末の撥音「ん」／促音「っ」 */
  coda: 'N' | 'Q' | null;
  /** 「ー」など、前の母音を伸ばすだけの音符か */
  extend: boolean;
}

interface MoraEntry {
  onset: string[];
  vowel: Vowel;
}

const VOWEL_ORDER: Vowel[] = ['a', 'i', 'u', 'e', 'o'];

const TABLE = new Map<string, MoraEntry>();

/** 「かきくけこ」のような五十音の行をまとめて登録する */
function row(kana: string, onset: string[]) {
  const chars = [...kana];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '　' || chars[i] === '・') continue;
    TABLE.set(chars[i], { onset: [...onset], vowel: VOWEL_ORDER[i] });
  }
}

/** 拗音（2文字）をまとめて登録する。母音は あ・う・お の順 */
function yoon(kana: string, onset: string[]) {
  const pairs = kana.match(/../g) ?? [];
  const vowels: Vowel[] = ['a', 'u', 'o'];
  pairs.forEach((k, i) => TABLE.set(k, { onset: [...onset], vowel: vowels[i] }));
}

row('あいうえお', []);
row('かきくけこ', ['k']);
row('がぎぐげご', ['g']);
row('さしすせそ', ['s']);
row('ざじずぜぞ', ['z']);
row('たちつてと', ['t']);
row('だぢづでど', ['d']);
row('なにぬねの', ['n']);
row('はひふへほ', ['h']);
row('ばびぶべぼ', ['b']);
row('ぱぴぷぺぽ', ['p']);
row('まみむめも', ['m']);
row('らりるれろ', ['r']);
row('ぁぃぅぇぉ', []);

// 行の中で子音が変わるもの
TABLE.set('し', { onset: ['sh'], vowel: 'i' });
TABLE.set('じ', { onset: ['j'], vowel: 'i' });
TABLE.set('ち', { onset: ['ch'], vowel: 'i' });
TABLE.set('つ', { onset: ['ts'], vowel: 'u' });
TABLE.set('ぢ', { onset: ['j'], vowel: 'i' });
TABLE.set('づ', { onset: ['z'], vowel: 'u' });
TABLE.set('ひ', { onset: ['hy'], vowel: 'i' });
TABLE.set('ふ', { onset: ['f'], vowel: 'u' });

TABLE.set('や', { onset: ['y'], vowel: 'a' });
TABLE.set('ゆ', { onset: ['y'], vowel: 'u' });
TABLE.set('よ', { onset: ['y'], vowel: 'o' });
TABLE.set('ゃ', { onset: ['y'], vowel: 'a' });
TABLE.set('ゅ', { onset: ['y'], vowel: 'u' });
TABLE.set('ょ', { onset: ['y'], vowel: 'o' });
TABLE.set('わ', { onset: ['w'], vowel: 'a' });
TABLE.set('ゐ', { onset: ['w'], vowel: 'i' });
TABLE.set('ゑ', { onset: ['w'], vowel: 'e' });
TABLE.set('を', { onset: [], vowel: 'o' });
TABLE.set('ゔ', { onset: ['b'], vowel: 'u' });

yoon('きゃきゅきょ', ['k', 'y']);
yoon('ぎゃぎゅぎょ', ['g', 'y']);
yoon('しゃしゅしょ', ['sh']);
yoon('じゃじゅじょ', ['j']);
yoon('ちゃちゅちょ', ['ch']);
yoon('ぢゃぢゅぢょ', ['j']);
yoon('にゃにゅにょ', ['n', 'y']);
yoon('ひゃひゅひょ', ['hy']);
yoon('びゃびゅびょ', ['b', 'y']);
yoon('ぴゃぴゅぴょ', ['p', 'y']);
yoon('みゃみゅみょ', ['m', 'y']);
yoon('りゃりゅりょ', ['r', 'y']);

// 外来語・口語で使う組み合わせ
const EXTRA: [string, string[], Vowel][] = [
  ['しぇ', ['sh'], 'e'], ['じぇ', ['j'], 'e'], ['ちぇ', ['ch'], 'e'],
  ['つぁ', ['ts'], 'a'], ['つぃ', ['ts'], 'i'], ['つぇ', ['ts'], 'e'], ['つぉ', ['ts'], 'o'],
  ['てぃ', ['t'], 'i'], ['でぃ', ['d'], 'i'], ['とぅ', ['t'], 'u'], ['どぅ', ['d'], 'u'],
  ['ふぁ', ['f'], 'a'], ['ふぃ', ['f'], 'i'], ['ふぇ', ['f'], 'e'], ['ふぉ', ['f'], 'o'],
  ['ふゅ', ['f', 'y'], 'u'],
  ['うぃ', ['w'], 'i'], ['うぇ', ['w'], 'e'], ['うぉ', ['w'], 'o'],
  ['ゔぁ', ['b'], 'a'], ['ゔぃ', ['b'], 'i'], ['ゔぇ', ['b'], 'e'], ['ゔぉ', ['b'], 'o'],
  ['くぁ', ['k', 'w'], 'a'], ['ぐぁ', ['g', 'w'], 'a'],
];
for (const [k, onset, vowel] of EXTRA) TABLE.set(k, { onset, vowel });

const SMALL = new Set([...'ぁぃぅぇぉゃゅょ']);
const LONG = new Set([...'ーｰ―‐−-']);
const SOKUON = 'っ';
const HATSUON = 'ん';

/** カタカナ・全角英数をひらがなに揃える */
export function normalizeKana(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // カタカナ（ァ..ヶ）→ ひらがな
    if (code >= 0x30a1 && code <= 0x30f6) out += String.fromCodePoint(code - 0x60);
    else if (code >= 0xff21 && code <= 0xff5a) out += String.fromCodePoint(code - 0xfee0);
    else out += ch;
  }
  return out.toLowerCase();
}

/** 歌詞をモーラ（音符1つ分）に分割する。空白・句読点は区切りとして捨てる */
export function splitMora(text: string): string[] {
  const src = normalizeKana(text);
  const out: string[] = [];
  const chars = [...src];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (/\s|[、。，．,.!！?？「」『』（）()・]/.test(ch)) {
      i++;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      // ローマ字はまとめて 1 モーラ分だけ取り出す
      let j = i;
      while (j < chars.length && /[a-z']/.test(chars[j])) j++;
      const word = chars.slice(i, j).join('');
      out.push(...splitRomaji(word));
      i = j;
      continue;
    }
    const pair = chars[i + 1] !== undefined ? ch + chars[i + 1] : '';
    if (pair && TABLE.has(pair) && SMALL.has(chars[i + 1])) {
      out.push(pair);
      i += 2;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out;
}

const ROMAJI_ONSETS = [
  'kya', 'kyu', 'kyo', 'gya', 'gyu', 'gyo', 'sha', 'shu', 'sho', 'sya', 'syu', 'syo',
  'cha', 'chu', 'cho', 'ja', 'ju', 'jo', 'nya', 'nyu', 'nyo', 'hya', 'hyu', 'hyo',
  'bya', 'byu', 'byo', 'pya', 'pyu', 'pyo', 'mya', 'myu', 'myo', 'rya', 'ryu', 'ryo',
];

/** ローマ字を 1 モーラずつに割る（ra / kya / n など） */
function splitRomaji(word: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < word.length) {
    const three = word.slice(i, i + 3);
    if (ROMAJI_ONSETS.includes(three)) {
      out.push(three);
      i += 3;
      continue;
    }
    const m = /^([bcdfghjklmnpqrstvwxyz]{0,3})([aiueo])/.exec(word.slice(i));
    if (m) {
      out.push(m[0]);
      i += m[0].length;
      continue;
    }
    out.push(word[i]);
    i += 1;
  }
  return out;
}

const ROMAJI_MAP: Record<string, string[]> = {
  '': [], k: ['k'], g: ['g'], s: ['s'], sh: ['sh'], sy: ['sh'], z: ['z'], j: ['j'], jy: ['j'],
  t: ['t'], ts: ['ts'], ch: ['ch'], ty: ['ch'], d: ['d'], n: ['n'], h: ['h'], hy: ['hy'],
  f: ['f'], b: ['b'], p: ['p'], m: ['m'], y: ['y'], r: ['r'], l: ['r'], w: ['w'], v: ['b'],
  ky: ['k', 'y'], gy: ['g', 'y'], ny: ['n', 'y'], by: ['b', 'y'], py: ['p', 'y'],
  my: ['m', 'y'], ry: ['r', 'y'], fy: ['f', 'y'], kw: ['k', 'w'], gw: ['g', 'w'],
};

function lookupRomaji(mora: string): MoraEntry | null {
  const m = /^([a-z]*)([aiueo])$/.exec(mora);
  if (!m) return null;
  const onset = ROMAJI_MAP[m[1]];
  if (!onset) return null;
  return { onset: [...onset], vowel: m[2] as Vowel };
}

/**
 * 音符ひとつ分の歌詞を音素に変換する。
 * 「っと」のような促音付き、「さん」のような撥音付きも 1 音符で歌える。
 */
export function parseLyric(lyric: string): ParsedLyric {
  const empty: ParsedLyric = { onset: [], vowel: null, coda: null, extend: false };
  const trimmed = lyric.trim();
  if (!trimmed) return empty;

  const morae = splitMora(trimmed);
  if (morae.length === 0) return empty;

  // 「ー」だけなら前の母音を伸ばす
  if (morae.every((m) => LONG.has(m))) return { ...empty, extend: true };

  const onset: string[] = [];
  let vowel: Vowel | null = null;
  let coda: ParsedLyric['coda'] = null;

  for (let i = 0; i < morae.length; i++) {
    const m = morae[i];
    if (LONG.has(m)) continue;
    if (m === SOKUON) {
      if (vowel === null) onset.push('Q');
      else coda = 'Q';
      continue;
    }
    if (m === HATSUON || m === 'nn' || (m === 'n' && vowel !== null)) {
      if (vowel === null) vowel = 'N';
      else coda = 'N';
      continue;
    }
    const entry = TABLE.get(m) ?? lookupRomaji(m);
    if (!entry) continue;
    if (vowel === null) {
      onset.push(...entry.onset);
      vowel = entry.vowel;
    } else {
      // 1音符に2モーラ以上ある場合、後ろのモーラの子音だけを語尾に足す
      coda = coda ?? null;
      onset.push(...entry.onset);
      vowel = entry.vowel;
    }
  }

  if (vowel === null) return { ...empty, extend: onset.length === 0 };
  return { onset, vowel, coda, extend: false };
}

/** 歌詞をまとめて入力するとき用。空白・改行はブレス位置の目印として返す */
export interface LyricToken {
  mora: string;
  /** この語の前に空白があった（＝ブレスを置ける） */
  breakBefore: boolean;
}

export function tokenizeLyrics(text: string): LyricToken[] {
  const tokens: LyricToken[] = [];
  const words = normalizeKana(text).split(/[\s、。,.]+/).filter(Boolean);
  for (const word of words) {
    const morae = splitMora(word);
    morae.forEach((mora, i) => tokens.push({ mora, breakBefore: i === 0 && tokens.length > 0 }));
  }
  return tokens;
}

/** 表示用：母音だけのローマ字（ピアノロールの補助表示） */
export function romajiOf(lyric: string): string {
  const p = parseLyric(lyric);
  if (p.extend) return '-';
  if (!p.vowel) return '';
  const onset = p.onset.filter((c) => c !== 'Q').join('');
  const coda = p.coda === 'N' ? 'n' : p.coda === 'Q' ? 'q' : '';
  return `${onset}${p.vowel === 'N' ? 'n' : p.vowel}${coda}`;
}
