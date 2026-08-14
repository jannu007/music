/*
 * 音素テーブル
 *
 * 母音は「フォルマント（声道の共鳴）」、子音は「閉鎖・摩擦・鼻音の型 +
 * 母音へ向かうロクス（遷移の出発点）」で表す。値は成人男性の中庸な声道を
 * 基準にした Hz で、声色の tract 倍率でスケールして使う。
 */

import type { Vowel } from './types';

export interface VowelSpec {
  /** F1..F5（Hz） */
  f: number[];
  /** 各フォルマントの帯域幅（Hz） */
  b: number[];
  /** 鼻音の反共振（Hz）。np と等しいときは打ち消し合って無効になる */
  nz: number;
  /** 鼻音の共振（Hz） */
  np: number;
  /** 口の開き具合（0=閉じ 1=開き）。息の量やレベルの微調整に使う */
  open: number;
}

/** 鼻音成分を無効にする位置（nz と np を揃えると極と零が相殺する） */
export const NASAL_OFF = 1200;

export const VOWELS: Record<Vowel, VowelSpec> = {
  a: { f: [730, 1150, 2500, 3400, 4500], b: [80, 95, 150, 230, 300], nz: NASAL_OFF, np: NASAL_OFF, open: 1.0 },
  i: { f: [280, 2280, 2950, 3600, 4700], b: [50, 95, 155, 230, 300], nz: NASAL_OFF, np: NASAL_OFF, open: 0.35 },
  u: { f: [345, 1250, 2350, 3400, 4600], b: [55, 95, 155, 230, 300], nz: NASAL_OFF, np: NASAL_OFF, open: 0.35 },
  e: { f: [480, 1900, 2600, 3500, 4650], b: [60, 95, 155, 230, 300], nz: NASAL_OFF, np: NASAL_OFF, open: 0.6 },
  o: { f: [500, 860, 2550, 3400, 4600], b: [60, 90, 155, 230, 300], nz: NASAL_OFF, np: NASAL_OFF, open: 0.65 },
  N: { f: [280, 1350, 2200, 3300, 4400], b: [95, 120, 190, 260, 320], nz: 480, np: 270, open: 0.2 },
};

export type ConsonantKind =
  | 'stop'      // 破裂音（閉鎖 → 破裂）
  | 'fric'      // 摩擦音
  | 'affricate' // 破擦音（閉鎖 → 摩擦）
  | 'nasal'     // 鼻音
  | 'flap'      // はじき音（ら行）
  | 'glide'     // 半母音（や・わ行）
  | 'aspirate'; // 気息音（は行）

export interface ConsonantSpec {
  kind: ConsonantKind;
  /** 閉鎖（無音／こもり）の長さ 秒 */
  closure: number;
  /** 子音本体（破裂・摩擦・鼻音）の長さ 秒 */
  dur: number;
  /** 母音へ向かう遷移の長さ 秒 */
  trans: number;
  /** 子音時点の F1..F3（ロクス）。母音へ向かってここから動く */
  locus: number[];
  /** ロクスの効き 0..1（1 で完全にロクスの値になる） */
  pull: number;
  /** 有声度 0..1（子音本体の声帯振動） */
  voiced: number;
  /** 閉鎖中の有声のうなり 0..1（濁音の「ブー」） */
  bar: number;
  /** 摩擦・破裂ノイズの量 0..1 */
  fric: number;
  /** 気息（声道を通るノイズ）の量 0..1 */
  breath: number;
  /** 摩擦ノイズのバンド中心 Hz（2バンド） */
  sf: number[];
  /** 摩擦ノイズのバンド幅 Hz */
  sb: number[];
  /** 摩擦ノイズのバンドごとの強さ */
  sg: number[];
  /** 前の音とのつなぎ目で音量を落とす量 0..1 */
  dip: number;
}

const BASE: ConsonantSpec = {
  kind: 'stop',
  closure: 0,
  dur: 0.05,
  trans: 0.032,
  locus: [300, 1500, 2500],
  pull: 0.85,
  voiced: 0,
  bar: 0,
  fric: 0,
  breath: 0,
  sf: [2500, 4000],
  sb: [600, 1200],
  sg: [0, 0],
  dip: 1,
};

function spec(patch: Partial<ConsonantSpec>): ConsonantSpec {
  return { ...BASE, ...patch };
}

/**
 * 子音の定義。破裂音の破裂帯域と鼻音・はじき音のロクスは
 * 実際の調音位置（唇・歯茎・軟口蓋）に合わせてある。
 */
export const CONSONANTS: Record<string, ConsonantSpec> = {
  // --- 無声破裂音 ---
  k: spec({
    kind: 'stop', closure: 0.032, dur: 0.034, trans: 0.036,
    locus: [250, 1500, 2450], pull: 0.7,
    fric: 0.85, breath: 0.5, sf: [1900, 3300], sb: [500, 900], sg: [1.0, 0.55],
  }),
  t: spec({
    kind: 'stop', closure: 0.03, dur: 0.026, trans: 0.028,
    locus: [250, 1750, 2700], pull: 0.8,
    fric: 0.9, breath: 0.35, sf: [3900, 5300], sb: [900, 1400], sg: [0.85, 0.7],
  }),
  p: spec({
    kind: 'stop', closure: 0.034, dur: 0.024, trans: 0.03,
    locus: [220, 1050, 2200], pull: 0.85,
    fric: 0.7, breath: 0.3, sf: [800, 1700], sb: [500, 1000], sg: [0.9, 0.5],
  }),
  // --- 有声破裂音（閉鎖中に声帯が鳴り続ける） ---
  g: spec({
    kind: 'stop', closure: 0.03, dur: 0.022, trans: 0.036,
    locus: [250, 1550, 2450], pull: 0.7,
    voiced: 0.5, bar: 0.55, fric: 0.35, sf: [1800, 3000], sb: [500, 900], sg: [0.7, 0.35],
  }),
  d: spec({
    kind: 'stop', closure: 0.028, dur: 0.018, trans: 0.026,
    locus: [250, 1700, 2650], pull: 0.8,
    voiced: 0.5, bar: 0.6, fric: 0.4, sf: [3600, 4800], sb: [900, 1300], sg: [0.55, 0.4],
  }),
  b: spec({
    kind: 'stop', closure: 0.032, dur: 0.018, trans: 0.03,
    locus: [220, 1000, 2150], pull: 0.85,
    voiced: 0.5, bar: 0.6, fric: 0.35, sf: [700, 1500], sb: [450, 900], sg: [0.6, 0.3],
  }),
  // --- 摩擦音 ---
  s: spec({
    kind: 'fric', dur: 0.088, trans: 0.03,
    locus: [270, 1720, 2700], pull: 0.75,
    fric: 1.0, sf: [5100, 7000], sb: [900, 1600], sg: [0.9, 0.6], dip: 1,
  }),
  sh: spec({
    kind: 'fric', dur: 0.092, trans: 0.034,
    locus: [280, 2000, 2750], pull: 0.7,
    fric: 1.0, sf: [2400, 3600], sb: [700, 1200], sg: [1.0, 0.7],
  }),
  z: spec({
    kind: 'fric', dur: 0.058, trans: 0.03,
    locus: [270, 1700, 2700], pull: 0.7,
    voiced: 0.55, bar: 0.3, fric: 0.5, sf: [4400, 6200], sb: [900, 1500], sg: [0.55, 0.35],
  }),
  j: spec({
    kind: 'affricate', closure: 0.018, dur: 0.055, trans: 0.034,
    locus: [280, 2000, 2750], pull: 0.7,
    voiced: 0.5, bar: 0.35, fric: 0.6, sf: [2300, 3400], sb: [700, 1200], sg: [0.7, 0.45],
  }),
  ts: spec({
    kind: 'affricate', closure: 0.03, dur: 0.072, trans: 0.028,
    locus: [270, 1720, 2700], pull: 0.75,
    fric: 1.0, sf: [4600, 6400], sb: [900, 1600], sg: [0.9, 0.6],
  }),
  ch: spec({
    kind: 'affricate', closure: 0.03, dur: 0.076, trans: 0.034,
    locus: [280, 2000, 2750], pull: 0.7,
    fric: 1.0, sf: [2500, 3700], sb: [700, 1200], sg: [1.0, 0.7],
  }),
  f: spec({
    kind: 'fric', dur: 0.07, trans: 0.032,
    locus: [280, 1100, 2300], pull: 0.6,
    fric: 0.6, sf: [1400, 3700], sb: [900, 2000], sg: [0.5, 0.45],
  }),
  // --- 気息音（声道をそのまま息が通る） ---
  h: spec({
    kind: 'aspirate', dur: 0.058, trans: 0.03,
    locus: [400, 1400, 2400], pull: 0.15,
    breath: 1.0, fric: 0.12, sf: [1200, 2600], sb: [1200, 2200], sg: [0.3, 0.25],
  }),
  hy: spec({
    kind: 'aspirate', dur: 0.062, trans: 0.032,
    locus: [280, 2100, 2900], pull: 0.5,
    breath: 0.7, fric: 0.55, sf: [2700, 4100], sb: [800, 1400], sg: [0.6, 0.45],
  }),
  // --- 鼻音 ---
  m: spec({
    kind: 'nasal', dur: 0.062, trans: 0.03,
    locus: [250, 950, 2200], pull: 0.95,
    voiced: 0.85, fric: 0, dip: 0.55,
  }),
  n: spec({
    kind: 'nasal', dur: 0.056, trans: 0.028,
    locus: [260, 1650, 2650], pull: 0.9,
    voiced: 0.85, fric: 0, dip: 0.55,
  }),
  // --- はじき音・半母音 ---
  r: spec({
    kind: 'flap', dur: 0.03, trans: 0.03,
    locus: [320, 1500, 2050], pull: 0.85,
    voiced: 0.9, dip: 0.45,
  }),
  w: spec({
    kind: 'glide', dur: 0.045, trans: 0.058,
    locus: [320, 700, 2200], pull: 0.95,
    voiced: 1.0, dip: 0.85,
  }),
  y: spec({
    kind: 'glide', dur: 0.042, trans: 0.05,
    locus: [260, 2250, 3000], pull: 0.95,
    voiced: 1.0, dip: 0.9,
  }),
  /** 促音「っ」＝ 次の子音の閉鎖を伸ばす無音 */
  Q: spec({ kind: 'stop', closure: 0.075, dur: 0, trans: 0.012, pull: 0, dip: 1 }),
};

/** 前寄りの母音（軟口蓋音の破裂帯域が上がる） */
const FRONT: Record<string, boolean> = { i: true, e: true };

/**
 * 後続母音に合わせて子音を調整する（調音結合）。
 * 「か」と「き」で k の破裂音が違って聞こえるのはこの処理による。
 */
export function coarticulate(name: string, vowel: Vowel): ConsonantSpec {
  const base = CONSONANTS[name];
  if (!base) return CONSONANTS.h;
  const s: ConsonantSpec = {
    ...base,
    locus: [...base.locus],
    sf: [...base.sf],
    sb: [...base.sb],
    sg: [...base.sg],
  };
  const front = FRONT[vowel] === true;

  if (name === 'k' || name === 'g') {
    // 軟口蓋音は前母音の前で調音位置が前へ動き、破裂が高くなる
    if (front) {
      s.locus[1] = 2200;
      s.locus[2] = 2900;
      s.sf[0] = 2900;
      s.sf[1] = 4200;
    } else if (vowel === 'u') {
      s.locus[1] = 1350;
      s.sf[0] = 1700;
    } else if (vowel === 'o') {
      s.sf[0] = 1500;
      s.sf[1] = 2600;
    }
  } else if (name === 'h') {
    // は行は後続母音の声道をそのまま使う（ロクスを母音に寄せる）
    const v = VOWELS[vowel];
    s.locus = [v.f[0], v.f[1], v.f[2]];
    s.pull = 1;
    if (vowel === 'u') {
      s.sf = [1400, 3400];
      s.fric = 0.4;
    }
  } else if (name === 'f') {
    s.locus[1] = vowel === 'i' ? 1600 : 1100;
  } else if (name === 's' && vowel === 'u') {
    s.sf[0] = 4700;
  } else if (name === 'n' && front) {
    s.locus[1] = 1900;
  } else if (name === 'r') {
    // ら行のはじきは母音によって F2 が動く
    s.locus[1] = front ? 1800 : vowel === 'o' || vowel === 'u' ? 1250 : 1500;
  }
  return s;
}

/** 子音全体（閉鎖 + 本体 + 遷移）の長さ 秒 */
export function consonantSpan(s: ConsonantSpec): number {
  return s.closure + s.dur;
}
