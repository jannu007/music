/*
 * コード解釈と伴奏パターンの生成
 *
 * 歌だけでは曲にならないので、コード進行から簡単なバッキングを組み立てる。
 * 伴奏の音もサンプリングではなく、ワークレット内の小さな合成音源で鳴らす。
 */

import { ACCOMP_INST, type AccompNote, type AccompStyle, type ChordEvent, type Song } from './types';

const PITCH_CLASS: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

export interface ParsedChord {
  /** 根音のピッチクラス 0..11 */
  root: number;
  /** 根音からの半音（0 を含む） */
  intervals: number[];
  /** 分数コードのベース音（ピッチクラス）。無ければ null */
  bass: number | null;
}

const QUALITIES: [RegExp, number[]][] = [
  [/^m7b5|^ø/, [0, 3, 6, 10]],
  [/^dim7|^o7/, [0, 3, 6, 9]],
  [/^dim|^o(?!7)/, [0, 3, 6]],
  [/^aug|^\+/, [0, 4, 8]],
  [/^maj9|^M9|^△9/, [0, 4, 7, 11, 14]],
  [/^maj7|^M7|^△7|^△/, [0, 4, 7, 11]],
  [/^m9/, [0, 3, 7, 10, 14]],
  [/^m7/, [0, 3, 7, 10]],
  [/^m6/, [0, 3, 7, 9]],
  [/^madd9/, [0, 3, 7, 14]],
  [/^mM7/, [0, 3, 7, 11]],
  [/^m/, [0, 3, 7]],
  [/^sus4|^sus/, [0, 5, 7]],
  [/^sus2/, [0, 2, 7]],
  [/^add9/, [0, 4, 7, 14]],
  [/^69/, [0, 4, 7, 9, 14]],
  [/^6/, [0, 4, 7, 9]],
  [/^9/, [0, 4, 7, 10, 14]],
  [/^7sus4/, [0, 5, 7, 10]],
  [/^7/, [0, 4, 7, 10]],
];

/** 「Am7」「F#m」「G/B」などを解釈する。読めないときは null */
export function parseChord(symbol: string): ParsedChord | null {
  const text = symbol.trim();
  if (!text || text === '-' || text === 'N.C.' || text === 'NC') return null;

  const m = /^([A-Ga-g])([#♯b♭]?)(.*)$/.exec(text);
  if (!m) return null;

  let root = PITCH_CLASS[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === '♯') root += 1;
  if (m[2] === 'b' || m[2] === '♭') root -= 1;
  root = ((root % 12) + 12) % 12;

  let rest = m[3];
  let bass: number | null = null;
  const slash = rest.indexOf('/');
  if (slash >= 0) {
    const bm = /^([A-Ga-g])([#♯b♭]?)/.exec(rest.slice(slash + 1));
    if (bm) {
      let b = PITCH_CLASS[bm[1].toLowerCase()];
      if (bm[2] === '#' || bm[2] === '♯') b += 1;
      if (bm[2] === 'b' || bm[2] === '♭') b -= 1;
      bass = ((b % 12) + 12) % 12;
    }
    rest = rest.slice(0, slash);
  }

  let intervals = [0, 4, 7];
  for (const [re, iv] of QUALITIES) {
    if (re.test(rest)) {
      intervals = iv;
      break;
    }
  }
  return { root, intervals, bass };
}

/** コード表記のテキスト（1行 = 1小節、'|' 区切りも可）を ChordEvent に変換する */
export function parseChordText(text: string, beatsPerBar: number): ChordEvent[] {
  const out: ChordEvent[] = [];
  const bars = text
    .split(/[\n|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  bars.forEach((bar, index) => {
    const symbols = bar.split(/\s+/).filter(Boolean);
    if (symbols.length === 0) return;
    const each = beatsPerBar / symbols.length;
    symbols.forEach((symbol, i) => {
      out.push({ start: index * beatsPerBar + i * each, length: each, symbol });
    });
  });
  return out;
}

/** ChordEvent 群をテキストに戻す（編集欄の表示用） */
export function chordsToText(chords: ChordEvent[], beatsPerBar: number): string {
  if (chords.length === 0) return '';
  const bars: string[][] = [];
  for (const c of chords) {
    const bar = Math.max(0, Math.floor(c.start / beatsPerBar));
    while (bars.length <= bar) bars.push([]);
    bars[bar].push(c.symbol);
  }
  return bars.map((b) => (b.length ? b.join(' ') : '-')).join('\n');
}

/** 前回の押さえ方に近い形へ転回する（声部の動きを滑らかにする） */
function voice(intervals: number[], root: number, previous: number[] | null): number[] {
  const base = 60 + root; // C4 付近
  const notes = intervals.map((iv) => base + iv);
  if (!previous || previous.length === 0) {
    return notes.map((n) => (n > 72 ? n - 12 : n));
  }
  const target = previous.reduce((a, b) => a + b, 0) / previous.length;
  let best = notes;
  let bestScore = Infinity;
  for (let shift = -2; shift <= 1; shift++) {
    const cand = notes.map((n) => n + shift * 12);
    const avg = cand.reduce((a, b) => a + b, 0) / cand.length;
    const score = Math.abs(avg - target) + (avg > 76 ? 20 : 0) + (avg < 52 ? 20 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

interface Ctx {
  push: (n: AccompNote) => void;
  beat: (b: number) => number;
  bpm: number;
}

/** コード進行から伴奏ノートを組み立てる */
export function buildAccompaniment(song: Song): AccompNote[] {
  const style = song.style;
  if (style === 'off' || song.chords.length === 0) return [];

  const out: AccompNote[] = [];
  const secPerBeat = 60 / song.bpm;
  const ctx: Ctx = {
    push: (n) => out.push(n),
    beat: (b) => b * secPerBeat,
    bpm: song.bpm,
  };

  const sorted = [...song.chords].sort((a, b) => a.start - b.start);
  let previous: number[] | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const chord = sorted[i];
    const parsed = parseChord(chord.symbol);
    if (!parsed) {
      previous = null;
      continue;
    }
    const notes = voice(parsed.intervals, parsed.root, previous);
    previous = notes;
    const bassPc = parsed.bass ?? parsed.root;
    const bass = 36 + bassPc + (bassPc < 4 ? 12 : 0);
    const span = chord.length;
    const start = chord.start;
    const barStart = Math.abs(start % song.beatsPerBar) < 1e-6;

    switch (style) {
      case 'ballad':
        ballad(ctx, notes, bass, start, span);
        break;
      case 'pop':
        pop(ctx, notes, bass, start, span);
        break;
      case 'arpeggio':
        arpeggio(ctx, notes, bass, start, span);
        break;
      case 'pad':
        pad(ctx, notes, bass, start, span);
        break;
      case 'band':
        band(ctx, notes, bass, start, span, barStart);
        break;
      default:
        break;
    }
  }

  if (style === 'pop' || style === 'band') {
    drums(ctx, song, style);
  }
  return out;
}

function ballad(ctx: Ctx, notes: number[], bass: number, start: number, span: number) {
  ctx.push({ time: ctx.beat(start), dur: ctx.beat(span), note: bass, vel: 0.55, inst: ACCOMP_INST.bass, pan: 0 });
  // 分散させながら和音を置く（アルペジオ気味のバラード伴奏）
  const step = span >= 2 ? 0.5 : 0.25;
  notes.forEach((n, i) => {
    ctx.push({
      time: ctx.beat(start + i * step * 0.35),
      dur: ctx.beat(span),
      note: n,
      vel: 0.42 - i * 0.03,
      inst: ACCOMP_INST.electricPiano,
      pan: (i - (notes.length - 1) / 2) * 0.18,
    });
  });
  ctx.push({ time: ctx.beat(start), dur: ctx.beat(span), note: notes[0] + 12, vel: 0.16, inst: ACCOMP_INST.pad, pan: 0 });
}

function pop(ctx: Ctx, notes: number[], bass: number, start: number, span: number) {
  const eighths = Math.max(1, Math.round(span * 2));
  for (let i = 0; i < eighths; i++) {
    const t = start + i * 0.5;
    const accent = i % 2 === 1 ? 0.34 : 0.2;
    notes.forEach((n, k) => {
      ctx.push({
        time: ctx.beat(t),
        dur: ctx.beat(0.42),
        note: n,
        vel: accent - k * 0.02,
        inst: ACCOMP_INST.electricPiano,
        pan: (k - (notes.length - 1) / 2) * 0.22,
      });
    });
  }
  const bassBeats = Math.max(1, Math.round(span));
  for (let i = 0; i < bassBeats; i++) {
    ctx.push({
      time: ctx.beat(start + i),
      dur: ctx.beat(0.9),
      note: i % 2 === 0 ? bass : bass + 7,
      vel: 0.6,
      inst: ACCOMP_INST.bass,
      pan: 0,
    });
  }
}

function arpeggio(ctx: Ctx, notes: number[], bass: number, start: number, span: number) {
  const pattern = [...notes, ...notes.slice(0, -1).reverse()].map((n) => n + 12);
  const steps = Math.max(1, Math.round(span * 2));
  for (let i = 0; i < steps; i++) {
    const n = pattern[i % pattern.length];
    ctx.push({
      time: ctx.beat(start + i * 0.5),
      dur: ctx.beat(0.9),
      note: n,
      vel: 0.34 - (i % 2) * 0.06,
      inst: ACCOMP_INST.pluck,
      pan: ((i % 4) - 1.5) * 0.16,
    });
  }
  ctx.push({ time: ctx.beat(start), dur: ctx.beat(span), note: bass, vel: 0.5, inst: ACCOMP_INST.bass, pan: 0 });
  ctx.push({ time: ctx.beat(start), dur: ctx.beat(span), note: notes[0], vel: 0.12, inst: ACCOMP_INST.pad, pan: 0 });
}

function pad(ctx: Ctx, notes: number[], bass: number, start: number, span: number) {
  notes.forEach((n, i) => {
    ctx.push({
      time: ctx.beat(start),
      dur: ctx.beat(span),
      note: n,
      vel: 0.3 - i * 0.02,
      inst: ACCOMP_INST.pad,
      pan: (i - (notes.length - 1) / 2) * 0.35,
    });
  });
  ctx.push({ time: ctx.beat(start), dur: ctx.beat(span), note: bass, vel: 0.42, inst: ACCOMP_INST.bass, pan: 0 });
}

function band(ctx: Ctx, notes: number[], bass: number, start: number, span: number, barStart: boolean) {
  // 裏拍のカッティング
  const eighths = Math.max(1, Math.round(span * 2));
  for (let i = 0; i < eighths; i++) {
    if (i % 2 === 0 && !(barStart && i === 0)) continue;
    notes.forEach((n, k) => {
      ctx.push({
        time: ctx.beat(start + i * 0.5),
        dur: ctx.beat(0.3),
        note: n + 12,
        vel: 0.3 - k * 0.03,
        inst: ACCOMP_INST.pluck,
        pan: (k - (notes.length - 1) / 2) * 0.3,
      });
    });
  }
  notes.forEach((n, k) => {
    ctx.push({
      time: ctx.beat(start),
      dur: ctx.beat(span),
      note: n,
      vel: 0.2 - k * 0.02,
      inst: ACCOMP_INST.electricPiano,
      pan: (k - (notes.length - 1) / 2) * 0.2,
    });
  });
  const steps = Math.max(1, Math.round(span * 2));
  for (let i = 0; i < steps; i++) {
    ctx.push({
      time: ctx.beat(start + i * 0.5),
      dur: ctx.beat(0.44),
      note: i % 4 === 3 ? bass + 7 : bass,
      vel: i % 2 === 0 ? 0.62 : 0.44,
      inst: ACCOMP_INST.bass,
      pan: 0,
    });
  }
}

/** ドラム（キック36 / スネア38 / ハイハット42） */
function drums(ctx: Ctx, song: Song, style: AccompStyle) {
  const last = song.chords.reduce((m, c) => Math.max(m, c.start + c.length), 0);
  const bars = Math.ceil(last / song.beatsPerBar);
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * song.beatsPerBar;
    for (let b = 0; b < song.beatsPerBar; b++) {
      const beat = base + b;
      // ハイハットは8分
      for (const off of [0, 0.5]) {
        ctx.push({
          time: ctx.beat(beat + off),
          dur: 0.06,
          note: 42,
          vel: off === 0 ? 0.3 : 0.2,
          inst: ACCOMP_INST.drum,
          pan: 0.22,
        });
      }
      if (b % 2 === 0) {
        ctx.push({ time: ctx.beat(beat), dur: 0.2, note: 36, vel: 0.85, inst: ACCOMP_INST.drum, pan: 0 });
        if (style === 'band' && b === 2) {
          ctx.push({ time: ctx.beat(beat + 0.75), dur: 0.2, note: 36, vel: 0.5, inst: ACCOMP_INST.drum, pan: 0 });
        }
      } else {
        ctx.push({ time: ctx.beat(beat), dur: 0.25, note: 38, vel: 0.7, inst: ACCOMP_INST.drum, pan: -0.12 });
      }
    }
  }
}
