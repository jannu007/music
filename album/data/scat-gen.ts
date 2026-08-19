// 天問 (Tenmon) — スキャット即興生成エンジン（アルバム書き出し専用）
//
// vocal/src 配下は一切変更せず、そこにある createNote / noteNameToMidi を
// そのまま使ってコードトーンを意識した「言葉のない」スキャット・ソロを
// 手続き的に組み立てる。決定論的な擬似乱数（トラックIDでシード）なので、
// 何度書き出しても同じ演奏になる。
//
// 設計方針:
//   ・与えられた4小節のフック・モチーフをヘッドの冒頭にそのまま置き、
//     残りの小節はコードトーン／スケールトーンを重み付けした生成器で
//     つなぐ（強拍はコードトーン優先、弱拍はスケール／半音アプローチ）
//   ・ソロ・コーラスは「density curve」（エネルギー・カーブ）で
//     コーラスごとに音数・音域・跳躍confidenceを変化させ、山なりの
//     アーク（発展）を作る。トラック09はエネルギーの漸増に加えて
//     偶数/奇数コーラスで音域・密度を交互に変える「トレーディング」風の
//     処理を重ねる。
//   ・すべてのセクションは要求された拍数をきっちり消費するため、
//     コーラス数×1コーラス秒＝仕様表の合計時間に正確に一致する。

import { createNote, noteNameToMidi } from '../../vocal/src/audio/song';
import type { ChordEvent, VocalNote } from '../../vocal/src/audio/types';

// ------------------------------------------------------------- 疑似乱数

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------- コード

const PITCH_CLASS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export interface ChordInfo {
  root: number;
  chordTones: number[];
  scale: number[];
}

/** [正規表現, コードトーン(root起点の半音), 対応スケール] の並び。上から順に最初にマッチしたものを使う */
const QUALITY_DEFS: [RegExp, number[], number[]][] = [
  [/^m7b5|^ø/, [0, 3, 6, 10], [0, 2, 3, 5, 6, 8, 10]], // locrian
  [/^dim7|^o7/, [0, 3, 6, 9], [0, 2, 3, 5, 6, 8, 9, 11]], // whole-half diminished
  [/^dim|^o(?!7)/, [0, 3, 6], [0, 2, 3, 5, 6, 8, 9, 11]],
  [/^aug|^\+/, [0, 4, 8], [0, 2, 4, 6, 8, 10]], // whole tone
  [/^maj9|^M9|^△9/, [0, 4, 7, 11, 2], [0, 2, 4, 5, 7, 9, 11]],
  [/^maj7|^M7|^△7|^△/, [0, 4, 7, 11], [0, 2, 4, 5, 7, 9, 11]], // ionian
  [/^m9/, [0, 3, 7, 10, 2], [0, 2, 3, 5, 7, 9, 10]],
  [/^m6/, [0, 3, 7, 9], [0, 2, 3, 5, 7, 9, 11]], // melodic minor
  [/^m7/, [0, 3, 7, 10], [0, 2, 3, 5, 7, 9, 10]], // dorian
  [/^madd9/, [0, 3, 7, 2], [0, 2, 3, 5, 7, 9, 10]],
  [/^mM7/, [0, 3, 7, 11], [0, 2, 3, 5, 7, 9, 11]],
  [/^m/, [0, 3, 7], [0, 2, 3, 5, 7, 9, 10]],
  [/^sus4|^sus/, [0, 5, 7], [0, 2, 5, 7, 9, 10]],
  [/^sus2/, [0, 2, 7], [0, 2, 4, 5, 7, 9]],
  [/^add9/, [0, 4, 7, 2], [0, 2, 4, 5, 7, 9, 11]],
  [/^69/, [0, 4, 7, 9, 2], [0, 2, 4, 5, 7, 9, 11]],
  [/^6/, [0, 4, 7, 9], [0, 2, 4, 5, 7, 9, 11]],
  [/^7alt/, [0, 4, 7, 10], [0, 1, 3, 4, 6, 8, 10]], // altered scale（オルタード7thは先に判定する）
  [/^9/, [0, 4, 7, 10, 2], [0, 2, 4, 5, 7, 9, 10]],
  [/^7sus4/, [0, 5, 7, 10], [0, 2, 5, 7, 9, 10]],
  [/^7/, [0, 4, 7, 10], [0, 2, 4, 5, 7, 9, 10]], // mixolydian
];

const DEFAULT_INFO: ChordInfo = { root: 0, chordTones: [0, 4, 7], scale: [0, 2, 4, 5, 7, 9, 11] };

/** "Am7" "E7alt" "Bbmaj7" などをルート＋コードトーン＋関連スケールに解釈する */
export function chordInfo(symbol: string): ChordInfo {
  const text = symbol.trim();
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(text);
  if (!m) return DEFAULT_INFO;
  let root = PITCH_CLASS[m[1].toLowerCase()];
  if (m[2] === '#') root += 1;
  if (m[2] === 'b') root -= 1;
  root = ((root % 12) + 12) % 12;
  let rest = m[3];
  const slash = rest.indexOf('/');
  if (slash >= 0) rest = rest.slice(0, slash);
  for (const [re, chordTones, scale] of QUALITY_DEFS) {
    if (re.test(rest)) return { root, chordTones, scale };
  }
  return { root, chordTones: [0, 4, 7], scale: [0, 2, 4, 5, 7, 9, 11] };
}

export interface ChordSpan {
  start: number;
  length: number;
  symbol: string;
}

/** 曲全体（コーラス展開済み）のコード列から、その拍位置のコードを引く */
export function chordAt(chords: ChordSpan[] | ChordEvent[], beat: number): string {
  for (const c of chords) {
    if (beat >= c.start - 1e-9 && beat < c.start + c.length - 1e-9) return c.symbol;
  }
  return chords.length ? chords[chords.length - 1].symbol : 'C';
}

// ------------------------------------------------------------- 音高選び

export interface PitchCtx {
  rng: () => number;
  prev: number | null;
  center: number;
  range: [number, number];
  energy: number;
  strong: boolean;
}

/** コードトーン／スケールトーン（時々半音アプローチ）から、直前の音・音域中心に近い音高を選ぶ */
export function pickPitch(symbol: string, ctx: PitchCtx): number {
  const info = chordInfo(symbol);
  const chordWeight = ctx.strong ? 0.8 : 0.48;
  const pool = ctx.rng() < chordWeight ? info.chordTones : info.scale;
  const pcs = pool.map((iv) => (info.root + iv) % 12);

  const leapProb = 0.12 + ctx.energy * 0.28;
  const wantLeap = ctx.rng() < leapProb;

  const [lo, hi] = ctx.range;
  const scored = pcs.map((pc) => {
    let midi = pc + 12 * Math.round((ctx.center - pc) / 12);
    if (midi < lo) midi += 12;
    if (midi > hi) midi -= 12;
    const distPrev = ctx.prev !== null ? Math.abs(midi - ctx.prev) : 0;
    const distCenter = Math.abs(midi - ctx.center);
    const score = distPrev * (wantLeap ? 0.15 : 0.85) + distCenter * 0.3;
    return { midi, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const pickIdx = wantLeap && scored.length > 1 ? 1 + Math.floor(ctx.rng() * (scored.length - 1)) : 0;
  let midi = scored[Math.min(pickIdx, scored.length - 1)].midi;

  // ビバップ風の半音アプローチ（弱拍・高エネルギーほど出やすい）
  const chromProb = (ctx.strong ? 0.04 : 0.1) + ctx.energy * 0.22;
  if (ctx.rng() < chromProb) midi += ctx.rng() < 0.5 ? -1 : 1;

  midi = Math.max(lo, Math.min(hi, Math.round(midi)));
  return midi;
}

// ----------------------------------------------------------- 歌詞（音節）

const SYLLABLES = ['ダ', 'ドゥ', 'ビ', 'バ', 'ラ', 'ナ', 'ワ', 'ヤ', 'マ', 'ガ', 'シュ', 'ヴァ'];

export function makeSyllablePicker(rng: () => number): (strong: boolean) => string {
  let prev = '';
  let prev2 = '';
  return () => {
    let pick = SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
    let tries = 0;
    while ((pick === prev || pick === prev2) && tries < 6) {
      pick = SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
      tries++;
    }
    prev2 = prev;
    prev = pick;
    return pick;
  };
}

// --------------------------------------------------------------- フック

export interface HookToken {
  start: number;
  len: number;
  note: number | null;
}

/** "NOTE:BEATS" / "r:BEATS" のトークン列（'|' は無視してよい区切り）を読む */
export function parseHook(text: string): HookToken[] {
  const out: HookToken[] = [];
  let at = 0;
  for (const raw of text.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    const parts = raw.split(':');
    if (parts[0] === 'r') {
      at += Number(parts[1] ?? 1);
      continue;
    }
    const len = Number(parts[1] ?? 1);
    out.push({ start: at, len, note: noteNameToMidi(parts[0]) });
    at += len;
  }
  return out;
}

// ------------------------------------------------------------- 生成本体

export interface SectionParams {
  rng: () => number;
  chords: ChordSpan[];
  startBeat: number;
  bars: number;
  beatsPerBar: number;
  energy: number;
  center: number;
  spread: number;
  range: [number, number];
  prevNote: number | null;
  syl: (strong: boolean) => string;
  out: VocalNote[];
}

/**
 * 8分音符グリッド上で「新しい音を置く／直前の音をタイで伸ばす／休符／
 * 16分に分割する」を確率的に選び、拍数ぴったりのフレーズを生成する。
 * energy が高いほど密度・跳躍・半音アプローチが増える。
 * 戻り値は最後に鳴らした音（次のセクションへ渡して滑らかにつなぐ）。
 */
export function generateSection(p: SectionParams): number {
  const totalBeats = p.bars * p.beatsPerBar;
  const totalEighths = Math.max(0, Math.round(totalBeats * 2));
  let prev = p.prevNote;
  let pendingStart: number | null = null;
  let pendingLen = 0;
  let pendingStrong = false;

  const restBase = 0.24 - p.energy * 0.14;
  const tieBase = 0.3 - p.energy * 0.2;
  const subdivBase = 0.08 + p.energy * 0.34;

  const registerAt = (beatPos: number) => {
    const barIdx = Math.floor(beatPos / p.beatsPerBar);
    return p.center + p.spread * Math.sin((Math.PI * (barIdx + 0.5)) / Math.max(1, p.bars));
  };

  const emit = (beatPos: number, len: number, strong: boolean) => {
    const absBeat = p.startBeat + beatPos;
    const center = registerAt(beatPos);
    const midi = pickPitch(chordAt(p.chords, absBeat), {
      rng: p.rng,
      prev,
      center,
      range: p.range,
      energy: p.energy,
      strong,
    });
    prev = midi;
    const vel = 0.58 + p.energy * 0.2 + (strong ? 0.06 : 0);
    p.out.push(createNote({ start: absBeat, length: len, note: midi, lyric: p.syl(strong), vel: Math.min(0.95, vel) }));
  };

  const closePending = () => {
    if (pendingStart === null) return;
    emit(pendingStart, pendingLen, pendingStrong);
    pendingStart = null;
    pendingLen = 0;
  };

  for (let slot = 0; slot < totalEighths; slot++) {
    const beatPos = slot * 0.5;
    const isBeatStart = slot % 2 === 0;
    const barLocal = beatPos % p.beatsPerBar;
    const phraseEdge = barLocal < 0.001 && Math.floor(beatPos / p.beatsPerBar) % 2 === 1;

    const canTie = pendingStart !== null && pendingLen < 3.0 && isBeatStart;
    if (canTie && p.rng() < tieBase) {
      pendingLen += 0.5;
      continue;
    }
    closePending();

    const restProb = restBase + (phraseEdge ? 0.12 : 0);
    if (p.rng() < restProb) continue;

    if (p.energy > 0.28 && isBeatStart && p.rng() < subdivBase) {
      const strongFirst = true;
      emit(beatPos, 0.25, strongFirst);
      emit(beatPos + 0.25, 0.25, false);
      continue;
    }

    pendingStart = beatPos;
    pendingLen = 0.5;
    pendingStrong = isBeatStart;
  }
  closePending();
  return prev ?? p.center;
}

export interface HeadParams {
  rng: () => number;
  chords: ChordSpan[];
  startBeat: number;
  bars: number;
  beatsPerBar: number;
  hook: HookToken[];
  headEnergy: number;
  center: number;
  spread: number;
  range: [number, number];
  prevNote: number | null;
  syl: (strong: boolean) => string;
  out: VocalNote[];
}

/**
 * ヘッド・コーラスを組み立てる：与えられた4小節フックをそのまま置き
 * （フックの拍数が4小節にわずかに満たない場合は生成器で継ぎ足す）、
 * 5小節目以降が残っていればコードに沿った旋律で埋める。
 */
export function generateHead(p: HeadParams): number {
  const hookBeats = Math.min(4, p.bars) * p.beatsPerBar;
  let prev = p.prevNote;
  let cursor = 0;

  for (const tok of p.hook) {
    if (tok.start >= hookBeats - 1e-9) break;
    let len = tok.len;
    if (tok.start + len > hookBeats) len = hookBeats - tok.start;
    if (len <= 1e-9) continue;
    if (tok.note !== null) {
      let midi = tok.note;
      while (midi < p.range[0]) midi += 12;
      while (midi > p.range[1]) midi -= 12;
      const strong = Math.abs(tok.start % 1) < 1e-9;
      p.out.push(
        createNote({ start: p.startBeat + tok.start, length: len, note: midi, lyric: p.syl(strong), vel: 0.7 })
      );
      prev = midi;
    }
    cursor = tok.start + len;
  }

  if (cursor < hookBeats - 1e-9) {
    prev = generateSection({
      rng: p.rng,
      chords: p.chords,
      startBeat: p.startBeat + cursor,
      bars: (hookBeats - cursor) / p.beatsPerBar,
      beatsPerBar: p.beatsPerBar,
      energy: p.headEnergy * 0.7,
      center: p.center,
      spread: p.spread * 0.5,
      range: p.range,
      prevNote: prev,
      syl: p.syl,
      out: p.out,
    });
  }

  if (p.bars > 4) {
    prev = generateSection({
      rng: p.rng,
      chords: p.chords,
      startBeat: p.startBeat + hookBeats,
      bars: p.bars - 4,
      beatsPerBar: p.beatsPerBar,
      energy: p.headEnergy,
      center: p.center,
      spread: p.spread,
      range: p.range,
      prevNote: prev,
      syl: p.syl,
      out: p.out,
    });
  }

  return prev ?? p.center;
}
