import type { PerformanceEvent } from '../audio/types';

export interface Demo {
  id: string;
  title: string;
  composer: string;
  note: string;
  presetId: string;
  build: () => PerformanceEvent[];
}

/** 再現性のある微小な揺らぎ（毎回同じ演奏になるよう固定シード） */
function humanizer(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class Take {
  events: PerformanceEvent[] = [];
  private rand: () => number;

  constructor(seed: number) {
    this.rand = humanizer(seed);
  }

  note(time: number, note: number, duration: number, vel: number, spread = 0.012) {
    const jitter = (this.rand() - 0.5) * spread;
    const start = Math.max(0, time + jitter);
    const v = Math.max(0.05, Math.min(1, vel + (this.rand() - 0.5) * 0.08));
    this.events.push({ time: start, type: 'note', note, vel: v });
    this.events.push({ time: start + Math.max(0.05, duration), type: 'off', note });
  }

  pedal(time: number, value: number) {
    this.events.push({ time: Math.max(0, time), type: 'sustain', value });
  }

  /** 1小節ごとにペダルを踏み替える（直前で上げ、直後に踏み直す） */
  pedalPerBar(barStart: number) {
    if (barStart > 0.05) this.pedal(barStart - 0.02, 0);
    this.pedal(barStart + 0.06, 1);
  }

  /** 指定した時刻ごとにペダルを踏み替え、最後に離す */
  pedalMarks(times: number[], end: number) {
    for (const t of times) this.pedalPerBar(t);
    this.pedal(end, 0);
  }

  /**
   * 楽譜文字列を並べる。
   *   "C5:1 D5:0.5 r:1 C4+E4+G4:2"  … 音名:長さ（長さは unit の倍数）
   *   末尾の "!" で強め、"~" で弱め
   * 返り値は次の音が始まる時刻。
   */
  seq(start: number, spec: string, unit: number, vel: number, legato = 0.92): number {
    let time = start;
    for (const token of spec.trim().split(/\s+/)) {
      if (!token || token === '|') continue;
      const [head, lenText] = token.split(':');
      const len = Number(lenText ?? 1) * unit;
      let v = vel;
      let names = head;
      if (names.endsWith('!')) { v += 0.12; names = names.slice(0, -1); }
      else if (names.endsWith('~')) { v -= 0.1; names = names.slice(0, -1); }
      if (names !== 'r' && names !== 'R') {
        for (const name of names.split('+')) {
          this.note(time, midiOf(name), Math.max(0.06, len * legato), v);
        }
      }
      time += len;
    }
    return time;
  }

  /** 和音をまとめて置く */
  hit(time: number, names: string[], duration: number, vel: number) {
    for (const name of names) this.note(time, midiOf(name), duration, vel, 0.008);
  }

  done(): PerformanceEvent[] {
    return this.events.sort((a, b) => a.time - b.time);
  }
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" "Bb2" "F5" → MIDIノート番号 */
function midiOf(name: string): number {
  const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`音名を解釈できません: ${name}`);
  let value = STEP[m[1].toUpperCase()];
  for (const accidental of m[2]) value += accidental === '#' ? 1 : -1;
  return value + (Number(m[3]) + 1) * 12;
}

/** 同じフレーズを繰り返す */
function repeat(spec: string, times: number): string {
  return new Array(times).fill(spec).join(' ');
}

// ---------------------------------------------------------------------------
// J.S. Bach : 平均律クラヴィーア曲集 第1巻 前奏曲 第1番 ハ長調 BWV 846（パブリックドメイン）
// ---------------------------------------------------------------------------

const BWV846_BARS: number[][] = [
  [48, 52, 55, 60, 64],
  [48, 50, 57, 62, 65],
  [47, 50, 55, 62, 65],
  [48, 52, 55, 60, 64],
  [48, 52, 57, 64, 69],
  [48, 50, 54, 57, 62],
  [47, 50, 55, 62, 67],
  [47, 48, 52, 55, 60],
  [45, 48, 52, 55, 60],
  [38, 45, 50, 54, 60],
  [43, 47, 50, 55, 59],
  [43, 46, 52, 55, 61],
  [41, 45, 50, 57, 62],
  [41, 44, 50, 53, 59],
  [40, 43, 48, 55, 60],
  [40, 41, 45, 48, 53],
];

/** 各半小節は 16分音符 8つ：低音2つ + 上声3つの反復 */
const BWV846_PATTERN = [0, 1, 2, 3, 4, 2, 3, 4];

function buildBWV846(): PerformanceEvent[] {
  const take = new Take(20240401);
  const quarter = 60 / 66;
  const sixteenth = quarter / 4;
  const bar = quarter * 4;

  BWV846_BARS.forEach((chord, barIndex) => {
    const barStart = barIndex * bar;
    take.pedalPerBar(barStart);

    // 曲の流れに沿った大きな強弱
    const arc = Math.sin((barIndex / BWV846_BARS.length) * Math.PI);
    const dynamic = 0.42 + arc * 0.22;

    for (let half = 0; half < 2; half++) {
      const halfStart = barStart + half * bar * 0.5;
      BWV846_PATTERN.forEach((slot, i) => {
        const time = halfStart + i * sixteenth;
        const note = chord[slot];
        const isBass = slot <= 1;
        // 低音2声は小節いっぱい保持、上声は次の音まで
        const duration = isBass ? bar * 0.5 - i * sixteenth : sixteenth * 2.4;
        const accent = i === 0 ? 0.1 : i === 2 ? 0.04 : 0;
        const vel = dynamic + accent + (isBass ? 0.05 : 0);
        take.note(time, note, duration, vel);
      });
    }
  });

  // 終止（ハ長調の主和音）
  const end = BWV846_BARS.length * bar;
  take.pedal(end - 0.03, 0);
  take.pedal(end + 0.05, 1);
  for (const note of [36, 48, 52, 55, 60, 64]) {
    take.note(end, note, bar * 1.6, 0.5);
  }
  take.pedal(end + bar * 1.8, 0);

  return take.done();
}

// ---------------------------------------------------------------------------
// オリジナル楽曲「夜明けのノクターン」（本アプリのために書き下ろし／権利処理不要）
// ---------------------------------------------------------------------------

/** 左手の分散和音（低音・中音・高音） */
const NOCTURNE_CHORDS: number[][] = [
  [45, 52, 57], // Am
  [41, 48, 57], // F
  [36, 48, 55], // C
  [43, 50, 59], // G
  [45, 52, 57], // Am
  [41, 48, 57], // F
  [36, 48, 55], // C
  [40, 52, 56], // E7
  [45, 52, 57], // Am
  [38, 50, 57], // Dm
  [43, 50, 59], // G
  [36, 48, 55], // C
  [41, 48, 57], // F
  [38, 50, 57], // Dm
  [40, 52, 56], // E7
  [45, 52, 57], // Am
];

/** 右手：[小節, 拍, 音高, 長さ(拍), 強さ] */
const NOCTURNE_MELODY: [number, number, number, number, number][] = [
  [0, 0, 76, 2, 0.62], [0, 2, 72, 1, 0.5], [0, 3, 74, 1, 0.52],
  [1, 0, 72, 3, 0.58], [1, 3, 69, 1, 0.48],
  [2, 0, 67, 2, 0.5], [2, 2, 69, 1, 0.48], [2, 3, 71, 1, 0.52],
  [3, 0, 71, 4, 0.55],
  [4, 0, 76, 2, 0.66], [4, 2, 79, 1, 0.62], [4, 3, 77, 1, 0.58],
  [5, 0, 76, 3, 0.6], [5, 3, 72, 1, 0.5],
  [6, 0, 74, 2, 0.54], [6, 2, 76, 2, 0.56],
  [7, 0, 71, 4, 0.5],
  [8, 0, 69, 1, 0.52], [8, 1, 72, 1, 0.54], [8, 2, 76, 2, 0.62],
  [9, 0, 77, 2, 0.66], [9, 2, 74, 2, 0.58],
  [10, 0, 71, 2, 0.56], [10, 2, 74, 2, 0.58],
  [11, 0, 72, 4, 0.54],
  [12, 0, 81, 2, 0.72], [12, 2, 79, 1, 0.64], [12, 3, 77, 1, 0.6],
  [13, 0, 76, 2, 0.58], [13, 2, 74, 2, 0.54],
  [14, 0, 71, 2, 0.5], [14, 2, 68, 2, 0.48],
  [15, 0, 69, 4, 0.5],
];

const NOCTURNE_PATTERN = [0, 1, 2, 1, 0, 1, 2, 1];

function buildNocturne(): PerformanceEvent[] {
  const take = new Take(19850612);
  const quarter = 60 / 72;
  const eighth = quarter / 2;
  const bar = quarter * 4;

  NOCTURNE_CHORDS.forEach((chord, barIndex) => {
    const barStart = barIndex * bar;
    take.pedalPerBar(barStart);
    NOCTURNE_PATTERN.forEach((slot, i) => {
      const time = barStart + i * eighth;
      const vel = (slot === 0 ? 0.42 : 0.3) + (i === 0 ? 0.06 : 0);
      take.note(time, chord[slot], eighth * 2.2, vel, 0.016);
    });
  });

  for (const [barIndex, beat, note, dur, vel] of NOCTURNE_MELODY) {
    take.note(barIndex * bar + beat * quarter, note, dur * quarter * 0.96, vel, 0.02);
  }

  // 終止：Am を静かに広げて終わる
  const end = NOCTURNE_CHORDS.length * bar;
  take.pedal(end - 0.03, 0);
  take.pedal(end + 0.05, 1);
  for (const note of [33, 45, 57, 60, 64, 69]) {
    take.note(end, note, bar * 2, 0.4);
  }
  take.pedal(end + bar * 2.2, 0);

  return take.done();
}

// ---------------------------------------------------------------------------
// L.v. ベートーヴェン「エリーゼのために」WoO 59（パブリックドメイン）
// ---------------------------------------------------------------------------

function buildFurElise(): PerformanceEvent[] {
  const take = new Take(18100);
  const u = 0.152; // 16分音符

  // 主題（前半）と終止形（後半）
  const rhA = 'E5:1 D#5:1 E5:1 D#5:1 E5:1 B4:1 D5:1 C5:1 A4:4 r:2 '
    + 'C4:1 E4:1 A4:1 B4:4 r:2 E4:1 G#4:1 B4:1 C5:4 r:2 E4:1 E5:1 D#5:1';
  const lhA = 'r:8 A2:2 E3:2 A3:2 r:3 E2:2 E3:2 G#3:2 r:3 A2:2 E3:2 A3:2 r:3';
  const rhB = 'E5:1 D#5:1 E5:1 D#5:1 E5:1 B4:1 D5:1 C5:1 A4:4 r:2 '
    + 'C4:1 E4:1 A4:1 B4:4 r:2 E4:1 C5:1 B4:1 A4:8';
  const lhB = 'r:8 A2:2 E3:2 A3:2 r:3 E2:2 E3:2 G#3:2 r:3 A2:8';

  let time = 0;
  for (let pass = 0; pass < 2; pass++) {
    const vel = pass === 0 ? 0.5 : 0.58;
    take.seq(time, rhA, u, vel, 0.85);
    take.seq(time, lhA, u, vel - 0.12, 0.9);
    take.pedalMarks([8, 17, 26].map((n) => time + n * u), time + 35 * u);
    time += 35 * u;

    take.seq(time, rhB, u, vel, 0.85);
    take.seq(time, lhB, u, vel - 0.12, 0.9);
    take.pedalMarks([8, 17, 26].map((n) => time + n * u), time + 34 * u + 1.6);
    time += 34 * u;
  }
  return take.done();
}

// ---------------------------------------------------------------------------
// L.v. ベートーヴェン ピアノソナタ第14番「月光」第1楽章 冒頭（パブリックドメイン）
// ---------------------------------------------------------------------------

function buildMoonlight(): PerformanceEvent[] {
  const take = new Take(18010);
  const u = 0.385; // 3連符1つ
  const bar = 12 * u;

  // 3連符アルペジオと低音（1小節ぶん）
  const bars: { arp: string; bass: string[] }[] = [
    { arp: repeat('G#3:1 C#4:1 E4:1', 4), bass: ['C#2', 'C#3'] },
    { arp: repeat('G#3:1 C#4:1 E4:1', 4), bass: ['C#2', 'C#3'] },
    { arp: repeat('A3:1 C#4:1 E4:1', 2) + ' ' + repeat('A3:1 D4:1 F#4:1', 2), bass: ['A1', 'A2'] },
    { arp: repeat('G#3:1 B#3:1 F#4:1', 2) + ' ' + repeat('G#3:1 C#4:1 E4:1', 2), bass: ['G#1', 'G#2'] },
  ];
  // 2巡目に重ねる旋律
  const melody = ['G#4:12', 'G#4:6 G#4:2 G#4:4', 'A4:6 F#4:6', 'G#4:8 F#4:4'];

  let time = 0;
  for (let pass = 0; pass < 2; pass++) {
    bars.forEach((b, i) => {
      take.pedalPerBar(time);
      take.seq(time, b.arp, u, 0.3, 0.95);
      take.hit(time, b.bass, bar * 0.98, 0.42);
      if (pass === 1) take.seq(time, melody[i], u, 0.58, 0.98);
      time += bar;
    });
  }

  // 終止
  take.pedalPerBar(time);
  take.seq(time, bars[0].arp, u, 0.26, 0.95);
  take.hit(time, bars[0].bass, bar, 0.38);
  take.seq(time, 'G#4:12', u, 0.5, 0.98);
  time += bar;
  take.pedalPerBar(time);
  take.hit(time, ['C#2', 'C#3', 'G#3', 'C#4', 'E4'], 5, 0.4);
  take.pedal(time + 5.5, 0);

  return take.done();
}

// ---------------------------------------------------------------------------
// J. パッヘルベル「カノン ニ長調」（パブリックドメイン）
// ---------------------------------------------------------------------------

const CANON_GROUND: { bass: string; chord: string[]; arp: string }[] = [
  { bass: 'D2', chord: ['F#3', 'A3'], arp: 'F#4:1 A4:1 D5:1 A4:1' },
  { bass: 'A2', chord: ['E3', 'A3'], arp: 'E4:1 A4:1 C#5:1 A4:1' },
  { bass: 'B2', chord: ['F#3', 'B3'], arp: 'D4:1 F#4:1 B4:1 F#4:1' },
  { bass: 'F#2', chord: ['C#3', 'F#3'], arp: 'C#4:1 F#4:1 A4:1 F#4:1' },
  { bass: 'G2', chord: ['D3', 'G3'], arp: 'B3:1 D4:1 G4:1 D4:1' },
  { bass: 'D2', chord: ['F#3', 'A3'], arp: 'A3:1 D4:1 F#4:1 D4:1' },
  { bass: 'G2', chord: ['D3', 'G3'], arp: 'B3:1 D4:1 G4:1 D4:1' },
  { bass: 'A2', chord: ['E3', 'A3'], arp: 'C#4:1 E4:1 A4:1 E4:1' },
];

/** 有名な上声（1和音につき2拍） */
const CANON_DESCANT = ['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'];

function buildCanon(): PerformanceEvent[] {
  const take = new Take(16800);
  const u = 0.44; // 8分音符（♩≒68）
  const chordLen = 4 * u;

  let time = 0;
  for (let cycle = 0; cycle < 4; cycle++) {
    CANON_GROUND.forEach((g, i) => {
      take.pedalPerBar(time);
      take.hit(time, [g.bass], chordLen * 0.95, 0.42);
      take.hit(time + 2 * u, g.chord, chordLen * 0.5, 0.32);
      if (cycle >= 1 && cycle !== 2) {
        take.seq(time, `${CANON_DESCANT[i]}:4`, u, 0.52, 0.98);
      }
      if (cycle >= 2) {
        take.seq(time, g.arp, u, cycle === 2 ? 0.44 : 0.38, 0.9);
      }
      time += chordLen;
    });
  }

  // 終止（ニ長調の主和音）
  take.pedalPerBar(time);
  take.hit(time, ['D2', 'A2', 'F#3', 'A3', 'D4', 'F#4'], 4.5, 0.45);
  take.pedal(time + 5, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// C. ペツォールト「メヌエット ト長調」BWV Anh.114（パブリックドメイン）
// ---------------------------------------------------------------------------

const MINUET_RH = [
  'D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5',
  'D5:1 G4:1 G4:1',
  'E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5',
  'G5:1 G4:1 G4:1',
  'C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5',
  'B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5',
  'F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5',
  'A4:3',
  'D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5',
  'D5:1 G4:1 G4:1',
  'E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5',
  'G5:1 G4:1 G4:1',
  'C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5',
  'B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5',
  'A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5',
  'G4:3',
];

const MINUET_LH: { bass: string; chord: string[] }[] = [
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'D3', chord: ['F#3', 'A3'] },
  { bass: 'D3', chord: ['F#3', 'A3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
  { bass: 'D3', chord: ['F#3', 'A3'] },
  { bass: 'G2', chord: ['D3', 'B3'] },
];

function buildMinuet(): PerformanceEvent[] {
  const take = new Take(17250);
  const u = 0.46; // 4分音符（♩≒130）
  const bar = 3 * u;

  let time = 0;
  MINUET_RH.forEach((spec, i) => {
    const lh = MINUET_LH[i];
    take.seq(time, spec, u, i === 0 || i === 8 ? 0.58 : 0.52, 0.88);
    take.hit(time, [lh.bass], u * 0.9, 0.42);
    take.hit(time + u, lh.chord, u * 0.9, 0.3);
    take.hit(time + 2 * u, lh.chord, u * 0.9, 0.28);
    time += bar;
  });
  take.pedal(time, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// L.v. ベートーヴェン 交響曲第9番より「歓喜の歌」（パブリックドメイン）
// ---------------------------------------------------------------------------

const JOY_RH = [
  'F#5:1 F#5:1 G5:1 A5:1',
  'A5:1 G5:1 F#5:1 E5:1',
  'D5:1 D5:1 E5:1 F#5:1',
  'F#5:1.5 E5:0.5 E5:2',
  'F#5:1 F#5:1 G5:1 A5:1',
  'A5:1 G5:1 F#5:1 E5:1',
  'D5:1 D5:1 E5:1 F#5:1',
  'E5:1.5 D5:0.5 D5:2',
  'E5:1 E5:1 F#5:1 D5:1',
  'E5:1 F#5:0.5 G5:0.5 F#5:1 D5:1',
  'E5:1 F#5:0.5 G5:0.5 F#5:1 E5:1',
  'D5:1 E5:1 A4:2',
  'F#5:1 F#5:1 G5:1 A5:1',
  'A5:1 G5:1 F#5:1 E5:1',
  'D5:1 D5:1 E5:1 F#5:1',
  'E5:1.5 D5:0.5 D5:2',
];

const JOY_LH: { bass: string; chord: string[] }[] = [
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'A2', chord: ['A3', 'C#4', 'E4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
  { bass: 'D2', chord: ['A3', 'D4', 'F#4'] },
];

function buildOdeToJoy(): PerformanceEvent[] {
  const take = new Take(18240);
  const u = 0.5; // 4分音符（♩=120）
  const bar = 4 * u;

  let time = 0;
  JOY_RH.forEach((spec, i) => {
    const lh = JOY_LH[i];
    take.pedalPerBar(time);
    // 後半にかけて盛り上げる
    const vel = 0.48 + (i >= 12 ? 0.12 : i >= 8 ? 0.06 : 0);
    take.seq(time, spec, u, vel, 0.9);
    take.hit(time, [lh.bass], bar * 0.95, vel - 0.08);
    take.hit(time + 2 * u, lh.chord, 2 * u * 0.9, vel - 0.16);
    time += bar;
  });

  take.pedalPerBar(time);
  take.hit(time, ['D2', 'D3', 'A3', 'D4', 'F#4'], 4, 0.55);
  take.pedal(time + 4.5, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// 「きらきら星」フランス民謡（パブリックドメイン）
// ---------------------------------------------------------------------------

const TWINKLE_RH = [
  'C5:1 C5:1 G5:1 G5:1',
  'A5:1 A5:1 G5:2',
  'F5:1 F5:1 E5:1 E5:1',
  'D5:1 D5:1 C5:2',
  'G5:1 G5:1 F5:1 F5:1',
  'E5:1 E5:1 D5:2',
  'G5:1 G5:1 F5:1 F5:1',
  'E5:1 E5:1 D5:2',
  'C5:1 C5:1 G5:1 G5:1',
  'A5:1 A5:1 G5:2',
  'F5:1 F5:1 E5:1 E5:1',
  'D5:1 D5:1 C5:2',
];

/** 半小節ごとの和音（アルベルティ・バスに展開する） */
const TWINKLE_CHORDS: string[][] = [
  ['C3', 'G3', 'E3'], ['C3', 'G3', 'E3'],
  ['F3', 'C4', 'A3'], ['C3', 'G3', 'E3'],
  ['F3', 'C4', 'A3'], ['C3', 'G3', 'E3'],
  ['G2', 'D3', 'B3'], ['C3', 'G3', 'E3'],
  ['C3', 'G3', 'E3'], ['F3', 'C4', 'A3'],
  ['C3', 'G3', 'E3'], ['G2', 'D3', 'B3'],
  ['C3', 'G3', 'E3'], ['F3', 'C4', 'A3'],
  ['C3', 'G3', 'E3'], ['G2', 'D3', 'B3'],
  ['C3', 'G3', 'E3'], ['C3', 'G3', 'E3'],
  ['F3', 'C4', 'A3'], ['C3', 'G3', 'E3'],
  ['F3', 'C4', 'A3'], ['C3', 'G3', 'E3'],
  ['G2', 'D3', 'B3'], ['C3', 'G3', 'E3'],
];

function buildTwinkle(): PerformanceEvent[] {
  const take = new Take(17610);
  const u = 0.5; // 4分音符（♩=120）
  const bar = 4 * u;

  let time = 0;
  for (let pass = 0; pass < 2; pass++) {
    TWINKLE_RH.forEach((spec, i) => {
      take.pedalPerBar(time);
      // 2巡目は1オクターブ上でオルゴールのように
      const melody = pass === 0 ? spec : spec.replace(/([A-G]#?)(\d)/g, (_, n, o) => `${n}${Number(o) + 1}`);
      take.seq(time, melody, u, pass === 0 ? 0.5 : 0.4, 0.9);
      // アルベルティ・バス（8分音符）
      for (let half = 0; half < 2; half++) {
        const [a, b, c] = TWINKLE_CHORDS[i * 2 + half];
        take.seq(time + half * 2 * u, `${a}:0.5 ${b}:0.5 ${c}:0.5 ${b}:0.5`, u, 0.3, 0.9);
      }
      time += bar;
    });
  }
  take.pedalPerBar(time);
  take.hit(time, ['C3', 'G3', 'C4', 'E4', 'C5'], 3.5, 0.4);
  take.pedal(time + 4, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// 「アメイジング・グレイス」賛美歌（パブリックドメイン）
// ---------------------------------------------------------------------------

const GRACE_BARS = [
  'G4:2 B4:0.5 G4:0.5',
  'B4:2 A4:1',
  'G4:2 E4:1',
  'D4:2 D4:1',
  'G4:2 B4:0.5 G4:0.5',
  'B4:2 A4:1',
  'D5:3',
  'D5:2 D5:1',
  'D5:2 B4:1',
  'D5:2 B4:1',
  'A4:3',
  'G4:2 E4:1',
  'D4:2 D4:1',
  'G4:2 B4:0.5 G4:0.5',
  'B4:2 A4:1',
  'G4:3',
];

const GRACE_LH: { bass: string; chord: string[] }[] = [
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3', 'C4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3', 'C4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3', 'C4'] },
  { bass: 'D3', chord: ['F#3', 'A3', 'D4'] },
  { bass: 'C3', chord: ['E3', 'G3', 'C4'] },
  { bass: 'D3', chord: ['F#3', 'A3', 'D4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'D3', chord: ['F#3', 'A3', 'D4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
];

function buildAmazingGrace(): PerformanceEvent[] {
  const take = new Take(17790);
  const u = 0.72; // 4分音符（♩≒84）
  const bar = 3 * u;

  // アウフタクト
  let time = 0;
  take.seq(time, 'D4:1', u, 0.45, 0.9);
  time += u;

  GRACE_BARS.forEach((spec, i) => {
    const lh = GRACE_LH[i];
    take.pedalPerBar(time);
    const vel = 0.46 + (i >= 6 && i <= 11 ? 0.08 : 0);
    take.seq(time, spec, u, vel, 0.95);
    take.hit(time, [lh.bass], bar * 0.95, vel - 0.1);
    take.hit(time + u, lh.chord, 2 * u * 0.9, vel - 0.18);
    time += bar;
  });

  take.pedalPerBar(time);
  take.hit(time, ['G2', 'D3', 'G3', 'B3', 'G4'], 4, 0.4);
  take.pedal(time + 4.5, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// 「グリーンスリーブス」イングランド民謡（パブリックドメイン）
// ---------------------------------------------------------------------------

const GREEN_BARS = [
  'C5:2 D5:1 E5:2 F5:1',
  'E5:3 D5:2 B4:1',
  'G4:2 A4:1 B4:2 C5:1',
  'A4:3 A4:2 G#4:1',
  'C5:2 D5:1 E5:2 F5:1',
  'E5:3 D5:2 B4:1',
  'G4:2 A4:1 B4:2 G#4:1',
  'A4:6',
  'G5:3 F5:2 E5:1',
  'E5:3 D5:2 B4:1',
  'G4:2 A4:1 B4:2 C5:1',
  'A4:3 A4:2 G#4:1',
  'G5:3 F5:2 E5:1',
  'E5:3 D5:2 B4:1',
  'G4:2 A4:1 B4:2 G#4:1',
  'A4:6',
];

const GREEN_LH: { bass: string; chord: string[] }[] = [
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
  { bass: 'E2', chord: ['E3', 'G#3', 'B3'] },
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
  { bass: 'E2', chord: ['E3', 'G#3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3', 'C4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
  { bass: 'E2', chord: ['E3', 'G#3', 'B3'] },
  { bass: 'C3', chord: ['E3', 'G3', 'C4'] },
  { bass: 'G2', chord: ['D3', 'G3', 'B3'] },
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
  { bass: 'A2', chord: ['E3', 'A3', 'C4'] },
];

function buildGreensleeves(): PerformanceEvent[] {
  const take = new Take(15800);
  const u = 0.28; // 8分音符（6/8, ♩.≒71）
  const bar = 6 * u;

  let time = 0;
  take.seq(time, 'A4:1', u, 0.42, 0.9);
  time += u;

  GREEN_BARS.forEach((spec, i) => {
    const lh = GREEN_LH[i];
    take.pedalPerBar(time);
    const vel = 0.46 + (i >= 8 ? 0.08 : 0);
    take.seq(time, spec, u, vel, 0.92);
    take.hit(time, [lh.bass], bar * 0.5, vel - 0.12);
    take.hit(time + 3 * u, lh.chord, bar * 0.45, vel - 0.2);
    time += bar;
  });

  take.pedalPerBar(time);
  take.hit(time, ['A2', 'E3', 'A3', 'C4', 'E4'], 3.5, 0.38);
  take.pedal(time + 4, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// オリジナル「星降る夜のワルツ」（本アプリ書き下ろし）
// ---------------------------------------------------------------------------

const WALTZ_RH = [
  'A4:1 C5:1 F5:1', 'E5:2 C5:1', 'D5:1 F5:1 A5:1', 'G5:2 D5:1',
  'A5:1 G5:1 F5:1', 'E5:2 G5:1', 'F5:3', 'r:1 C5:1 E5:1',
  'D5:2 F5:1', 'A4:2 C5:1', 'B4:2 D5:1', 'C5:3',
  'D5:1 F5:1 A5:1', 'C5:2 A4:1', 'E5:2 D5:1', 'C5:3',
  'A4:1 C5:1 F5:1', 'E5:2 C5:1', 'D5:1 F5:1 A5:1', 'G5:2 D5:1',
  'A5:1 G5:1 F5:1', 'E5:2 G5:1', 'F5:2 A5:1', 'F5:3',
];

const WALTZ_LH: { bass: string; chord: string[] }[] = [
  { bass: 'F2', chord: ['A3', 'C4'] }, { bass: 'C3', chord: ['G3', 'C4'] },
  { bass: 'D3', chord: ['A3', 'D4'] }, { bass: 'Bb2', chord: ['F3', 'Bb3'] },
  { bass: 'F2', chord: ['A3', 'C4'] }, { bass: 'C3', chord: ['G3', 'C4'] },
  { bass: 'F2', chord: ['A3', 'C4'] }, { bass: 'C3', chord: ['G3', 'Bb3'] },
  { bass: 'Bb2', chord: ['F3', 'Bb3'] }, { bass: 'F2', chord: ['A3', 'C4'] },
  { bass: 'G2', chord: ['B3', 'F4'] }, { bass: 'C3', chord: ['G3', 'C4'] },
  { bass: 'Bb2', chord: ['F3', 'Bb3'] }, { bass: 'F2', chord: ['A3', 'C4'] },
  { bass: 'C3', chord: ['G3', 'Bb3'] }, { bass: 'F2', chord: ['A3', 'C4'] },
  { bass: 'F2', chord: ['A3', 'C4'] }, { bass: 'C3', chord: ['G3', 'C4'] },
  { bass: 'D3', chord: ['A3', 'D4'] }, { bass: 'Bb2', chord: ['F3', 'Bb3'] },
  { bass: 'F2', chord: ['A3', 'C4'] }, { bass: 'C3', chord: ['G3', 'C4'] },
  { bass: 'F2', chord: ['A3', 'C4'] }, { bass: 'F2', chord: ['A3', 'C4'] },
];

function buildWaltz(): PerformanceEvent[] {
  const take = new Take(19240);
  const u = 0.375; // 4分音符（♩=160）
  const bar = 3 * u;

  let time = 0;
  WALTZ_RH.forEach((spec, i) => {
    const lh = WALTZ_LH[i];
    take.pedalPerBar(time);
    const vel = 0.48 + (i >= 16 ? 0.07 : 0);
    take.seq(time, spec, u, vel, 0.9);
    take.hit(time, [lh.bass], u * 1.6, vel - 0.06);
    take.hit(time + u, lh.chord, u * 0.85, vel - 0.2);
    take.hit(time + 2 * u, lh.chord, u * 0.85, vel - 0.22);
    time += bar;
  });

  take.pedalPerBar(time);
  take.hit(time, ['F2', 'F3', 'A3', 'C4', 'F4'], 3, 0.42);
  take.pedal(time + 3.5, 0);
  return take.done();
}

// ---------------------------------------------------------------------------
// オリジナル「夏の終わりのバラード」（本アプリ書き下ろし）
// ---------------------------------------------------------------------------

const BALLAD_RH = [
  'G4:1 A4:1 B4:1 C5:1',
  'D5:2 A4:2',
  'B4:1 C#5:1 D5:2',
  'E5:3 D5:1',
  'C5:1 B4:1 A4:1 G4:1',
  'A4:2 F#4:2',
  'G4:4',
  'r:2 D5:1 E5:1',
  'G5:1 E5:1 G5:2',
  'F#5:2 D5:2',
  'D5:1 E5:1 F#5:2',
  'E5:4',
  'E5:1 D5:1 C5:1 B4:1',
  'A4:2 D5:2',
  'B4:4',
  'G4:4',
];

/** 左手の分散和音（低音・中音・高音） */
const BALLAD_LH: string[][] = [
  ['C3', 'G3', 'E4'], ['D3', 'A3', 'F#4'], ['B2', 'F#3', 'D4'], ['E3', 'B3', 'G4'],
  ['C3', 'G3', 'E4'], ['D3', 'A3', 'F#4'], ['G2', 'D3', 'B3'], ['D3', 'A3', 'F#4'],
  ['C3', 'G3', 'E4'], ['D3', 'A3', 'F#4'], ['B2', 'F#3', 'D4'], ['E3', 'B3', 'G4'],
  ['C3', 'G3', 'E4'], ['D3', 'A3', 'F#4'], ['G2', 'D3', 'B3'], ['G2', 'D3', 'B3'],
];

function buildBallad(): PerformanceEvent[] {
  const take = new Take(19790);
  const u = 0.833; // 4分音符（♩=72）
  const bar = 4 * u;

  let time = 0;
  BALLAD_RH.forEach((spec, i) => {
    const [low, mid, high] = BALLAD_LH[i];
    take.pedalPerBar(time);
    // サビ（9小節目〜）で歌わせる
    const vel = 0.46 + (i >= 8 && i < 14 ? 0.1 : 0);
    take.seq(time, spec, u, vel, 0.96);
    take.seq(
      time,
      `${low}:0.5 ${mid}:0.5 ${high}:0.5 ${mid}:0.5 ${low}:0.5 ${mid}:0.5 ${high}:0.5 ${mid}:0.5`,
      u,
      vel - 0.16,
      0.9
    );
    time += bar;
  });

  take.pedalPerBar(time);
  take.hit(time, ['G2', 'D3', 'G3', 'B3', 'D4', 'G4'], 5, 0.4);
  take.pedal(time + 5.5, 0);
  return take.done();
}

export const DEMOS: Demo[] = [
  {
    id: 'bwv846',
    title: '前奏曲 第1番 ハ長調 BWV 846',
    composer: 'J.S. バッハ',
    note: 'パブリックドメイン',
    presetId: 'concert',
    build: buildBWV846,
  },
  {
    id: 'furelise',
    title: 'エリーゼのために WoO 59',
    composer: 'L.v. ベートーヴェン',
    note: 'パブリックドメイン',
    presetId: 'concert',
    build: buildFurElise,
  },
  {
    id: 'moonlight',
    title: 'ピアノソナタ第14番「月光」第1楽章',
    composer: 'L.v. ベートーヴェン',
    note: 'パブリックドメイン',
    presetId: 'cinematic',
    build: buildMoonlight,
  },
  {
    id: 'canon',
    title: 'カノン ニ長調',
    composer: 'J. パッヘルベル',
    note: 'パブリックドメイン',
    presetId: 'concert',
    build: buildCanon,
  },
  {
    id: 'minuet',
    title: 'メヌエット ト長調 BWV Anh.114',
    composer: 'C. ペツォールト',
    note: 'パブリックドメイン',
    presetId: 'studio',
    build: buildMinuet,
  },
  {
    id: 'odetojoy',
    title: '歓喜の歌（交響曲第9番より）',
    composer: 'L.v. ベートーヴェン',
    note: 'パブリックドメイン',
    presetId: 'bright',
    build: buildOdeToJoy,
  },
  {
    id: 'twinkle',
    title: 'きらきら星',
    composer: 'フランス民謡',
    note: 'パブリックドメイン',
    presetId: 'felt',
    build: buildTwinkle,
  },
  {
    id: 'amazinggrace',
    title: 'アメイジング・グレイス',
    composer: '賛美歌',
    note: 'パブリックドメイン',
    presetId: 'warm',
    build: buildAmazingGrace,
  },
  {
    id: 'greensleeves',
    title: 'グリーンスリーブス',
    composer: 'イングランド民謡',
    note: 'パブリックドメイン',
    presetId: 'felt',
    build: buildGreensleeves,
  },
  {
    id: 'waltz',
    title: '星降る夜のワルツ',
    composer: 'オリジナル',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildWaltz,
  },
  {
    id: 'ballad',
    title: '夏の終わりのバラード',
    composer: 'オリジナル',
    note: '本アプリ書き下ろし',
    presetId: 'warm',
    build: buildBallad,
  },
  {
    id: 'nocturne',
    title: '夜明けのノクターン',
    composer: 'オリジナル',
    note: '本アプリ書き下ろし',
    presetId: 'warm',
    build: buildNocturne,
  },
];
