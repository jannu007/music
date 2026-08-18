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

// ---------------------------------------------------------------------------
// アルバム「天問」(Tenmon) 全10曲 — 本アプリのために書き下ろしたオリジナルの
// ジャズ・ピアノアルバム。既存デモ（パブリックドメイン曲／既存オリジナル曲）
// の旋律・ヴォイシング・アレンジは一切参照・流用していない。
//
// 各曲は次の共通ヘルパーで組み立てる：
//   ・コード記号（"Am7" 等）をルート＋3/5/7/9度に解析し、中心音高に近い
//     オクターブへ配置する（tenmonTones / tenmonVoicing）
//   ・左手はルートレスの3和音ヴォイシング（3度・7度＋9度or5度）で、
//     曲ごとに用意したスウィング／ボサノバ／ラテン／モーダル／3拍子の
//     コンピング・パターンから拍位置を選んでシンコペーションする
//   ・右手のアドリブ・コーラスは、強拍にコードトーン、弱拍に半音／全音の
//     経過音・アプローチノートを置く生成ロジックで、コードチェンジに
//     沿った即興ラインを作る（バラードは四分・二分音符主体の生成に切替）
//   ・ヘッドは、スペックで与えられた4小節のフックをそのまま冒頭に使い、
//     残りの小節はそのモチーフ／和声にふさわしい旋律を書き下ろして続け、
//     ヘッド2回目の最終小節だけ別フレーズ（turnFill）に差し替えて
//     ソロへの橋渡しにする
//   構成 = ヘッド×2 → アドリブ・ソロ×Nコーラス → ヘッド・アウト×1 → タグ。
//   各曲のコーラス数はコメントに秒数の根拠を明記した（2:30〜3:30に収まる）。
// ---------------------------------------------------------------------------

type TenmonBar = string[]; // 1小節に入るコード（複数記述なら等分）

interface TenmonQuality { third: number; fifth: number; seventh: number; ninth: number; }

/** コードの構成音（ルートからの半音数）。アルバムに登場する種類のみ対応 */
const TENMON_QUALITY: Record<string, TenmonQuality> = {
  '': { third: 4, fifth: 7, seventh: 11, ninth: 14 },
  maj7: { third: 4, fifth: 7, seventh: 11, ninth: 14 },
  '7': { third: 4, fifth: 7, seventh: 10, ninth: 14 },
  m7: { third: 3, fifth: 7, seventh: 10, ninth: 14 },
  m7b5: { third: 3, fifth: 6, seventh: 10, ninth: 14 },
  dim7: { third: 3, fifth: 6, seventh: 9, ninth: 14 },
  '7alt': { third: 4, fifth: 6, seventh: 10, ninth: 13 }, // ♭9のテンションで代用
  m6: { third: 3, fifth: 7, seventh: 9, ninth: 14 },
};

/** "Am7" "Bb7" "E7alt" → { ピッチクラス, コード種 } */
function tenmonParseChord(sym: string): { pc: number; quality: string } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym.trim());
  if (!m) return { pc: 0, quality: '' };
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const pc = ((STEP[m[1]] + acc) % 12 + 12) % 12;
  return { pc, quality: m[3] };
}

/** ピッチクラスを center にいちばん近いオクターブの MIDI ノートにする */
function tenmonNearestPc(pc: number, center: number): number {
  return pc + 12 * Math.round((center - pc) / 12);
}

function tenmonTones(sym: string, center: number) {
  const { pc, quality } = tenmonParseChord(sym);
  const q = TENMON_QUALITY[quality] ?? TENMON_QUALITY['7'];
  return {
    root: tenmonNearestPc(pc, center),
    third: tenmonNearestPc((pc + q.third) % 12, center),
    fifth: tenmonNearestPc((pc + q.fifth) % 12, center),
    seventh: tenmonNearestPc((pc + q.seventh) % 12, center),
    ninth: tenmonNearestPc((pc + q.ninth) % 12, center),
  };
}

/** ルートレスの3声ヴォイシング（3度・7度＋9度 or 5度） */
function tenmonVoicing(sym: string, center: number, useNinth: boolean): number[] {
  const t = tenmonTones(sym, center);
  return [t.third, t.seventh, useNinth ? t.ninth : t.fifth].sort((a, b) => a - b);
}

/** 1小節に入るコードを拍で等分する */
function tenmonBarChords(bar: TenmonBar, beatsPerBar: number): { sym: string; beats: number }[] {
  const each = beatsPerBar / bar.length;
  return bar.map((sym) => ({ sym, beats: each }));
}

/** コンピングのオフセット候補（拍単位）。曲ごとのスタイルに合わせて使い分ける */
const TENMON_SWING_PATTERNS: number[][] = [[0, 1.67], [0.67, 2], [1, 2.67, 3], [0, 2, 3.67]];
const TENMON_MODAL_PATTERNS: number[][] = [[0.5, 2.5], [1.5, 3], [0, 2.5], [0.67, 2.67]];
const TENMON_WALTZ_PATTERNS: number[][] = [[0, 1.67], [0.67, 2], [0, 2]];
const TENMON_BOSSA_PATTERNS: number[][] = [[0, 1.5, 3], [0, 2, 3.5], [0, 1.5, 2.5]];
const TENMON_LATIN_PATTERNS: number[][] = [[0, 1.5, 2, 3.5], [0, 1, 2.5, 3], [0, 1.5, 3, 3.5]];

/** 1小節ぶんのコンピング（曲のパターン候補から拍位置を選び、ヴォイシングを置く） */
function tenmonCompBar(
  take: Take,
  bar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  patterns: number[][],
  center: number,
  vel: number,
  rand: () => number
) {
  const chords = tenmonBarChords(bar, beatsPerBar);
  const offs = patterns[Math.floor(rand() * patterns.length)];
  offs.forEach((off, oi) => {
    let acc = 0;
    let idx = chords.length - 1;
    for (let i = 0; i < chords.length; i++) {
      if (off < acc + chords[i].beats - 1e-6) { idx = i; break; }
      acc += chords[i].beats;
    }
    const notes = tenmonVoicing(chords[idx].sym, center, rand() < 0.6);
    const nextOff = offs[oi + 1] ?? beatsPerBar;
    const holdBeats = Math.max(0.55, (nextOff - off) * 0.85);
    const time = barStart + off * quarter;
    const v = vel + (rand() - 0.5) * 0.05;
    for (const n of notes) take.note(time, n, quarter * holdBeats, v, 0.01);
  });
}

/** バラード用コンピング：コードごとに長く伸ばして置く */
function tenmonCompBallad(
  take: Take,
  bar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  vel: number,
  rand: () => number
) {
  let t = barStart;
  for (const c of tenmonBarChords(bar, beatsPerBar)) {
    const notes = tenmonVoicing(c.sym, center, rand() < 0.5);
    for (const n of notes) take.note(t, n, quarter * c.beats * 0.94, vel + (rand() - 0.5) * 0.04, 0.02);
    t += quarter * c.beats;
  }
}

/** 8分音符主体のアドリブ：強拍=コードトーン、弱拍=半音/全音の経過・アプローチ音 */
function tenmonSoloBar(
  take: Take,
  sym: string,
  nextSym: string,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number,
  swing: boolean
) {
  const t = tenmonTones(sym, center);
  const targets = [t.root, t.third, t.fifth, t.seventh, t.ninth];
  const nextRoot = tenmonNearestPc(tenmonParseChord(nextSym).pc, center);
  const slots = Math.round(beatsPerBar * 2);
  let prev = targets[Math.floor(rand() * targets.length)];
  for (let i = 0; i < slots; i++) {
    const beatPos = i / 2;
    const isStrong = i % 2 === 0;
    let time = barStart + beatPos * quarter;
    if (swing && !isStrong) time = barStart + Math.floor(beatPos) * quarter + quarter * 0.667;
    if (!isStrong && rand() < 0.22) continue; // シンコペーションのための小休止
    let note: number;
    if (isStrong) {
      note = targets.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (rand() < 0.3) note = targets[Math.floor(rand() * targets.length)];
    } else {
      const isBarEnd = i === slots - 1;
      const anchor = isBarEnd ? nextRoot : prev;
      const dir = rand() < 0.5 ? -1 : 1;
      const step = rand() < 0.6 ? 1 : 2; // クロマチック or 全音アプローチ
      note = anchor + dir * step;
    }
    const dur = quarter * 0.5 * (swing ? (isStrong ? 0.85 : 0.7) : 0.82);
    const v = vel + (isStrong ? 0.04 : -0.03) + (rand() - 0.5) * 0.05;
    take.note(time, note, dur, Math.max(0.18, v));
    prev = note;
  }
}

/** 盛り上がりの小節に使う、16分音符のダブルタイム風フレーズ */
function tenmonSoloBarFast(
  take: Take,
  sym: string,
  nextSym: string,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number
) {
  const t = tenmonTones(sym, center);
  const targets = [t.root, t.third, t.fifth, t.seventh, t.ninth];
  const nextRoot = tenmonNearestPc(tenmonParseChord(nextSym).pc, center);
  const sixteenth = quarter / 4;
  const slots = Math.round(beatsPerBar * 4);
  let prev = targets[Math.floor(rand() * targets.length)];
  for (let i = 0; i < slots; i++) {
    const time = barStart + i * sixteenth;
    const isStrong = i % 4 === 0;
    if (!isStrong && rand() < 0.12) continue;
    let note: number;
    if (isStrong) {
      note = targets.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (rand() < 0.25) note = targets[Math.floor(rand() * targets.length)];
    } else {
      const dir = rand() < 0.5 ? -1 : 1;
      note = prev + dir * (rand() < 0.7 ? 1 : 2);
    }
    if (i === slots - 1) note = nextRoot;
    take.note(time, note, sixteenth * 0.85, vel + (isStrong ? 0.03 : -0.02) + (rand() - 0.5) * 0.04);
    prev = note;
  }
}

/** バラード用：四分・二分音符主体のゆったりしたアドリブ */
function tenmonSoloBarBallad(
  take: Take,
  sym: string,
  nextSym: string,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number
) {
  const t = tenmonTones(sym, center);
  const targets = [t.root, t.third, t.fifth, t.seventh, t.ninth];
  const nextRoot = tenmonNearestPc(tenmonParseChord(nextSym).pc, center);
  let time = barStart;
  let beatsLeft = beatsPerBar;
  let prev = targets[Math.floor(rand() * targets.length)];
  let first = true;
  while (beatsLeft > 0.01) {
    const dur = beatsLeft >= 2 && rand() < 0.55 ? 2 : 1;
    let note: number;
    if (first || rand() < 0.7) {
      note = targets.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (rand() < 0.3) note = targets[Math.floor(rand() * targets.length)];
    } else {
      const dir = rand() < 0.5 ? -1 : 1;
      note = prev + dir * (rand() < 0.6 ? 1 : 2);
    }
    const isLast = beatsLeft - dur <= 0.01;
    if (isLast && rand() < 0.4) note = nextRoot;
    take.note(time, note, quarter * dur * 0.9, vel + (rand() - 0.5) * 0.06);
    time += quarter * dur;
    beatsLeft -= dur;
    prev = note;
    first = false;
  }
}

/** 1小節（複数コードのこともある）ぶんのアドリブを、含まれるコードごとに分けて演奏 */
function tenmonSoloBarAny(
  take: Take,
  chordBar: TenmonBar,
  nextChordBar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number,
  swing: boolean,
  fast: boolean
) {
  const chords = tenmonBarChords(chordBar, beatsPerBar);
  let t = barStart;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const nextSym = i < chords.length - 1 ? chords[i + 1].sym : nextChordBar[0];
    if (fast) tenmonSoloBarFast(take, c.sym, nextSym, t, quarter, c.beats, center, rand, vel);
    else tenmonSoloBar(take, c.sym, nextSym, t, quarter, c.beats, center, rand, vel, swing);
    t += quarter * c.beats;
  }
}

function tenmonSoloBarBalladAny(
  take: Take,
  chordBar: TenmonBar,
  nextChordBar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number
) {
  const chords = tenmonBarChords(chordBar, beatsPerBar);
  let t = barStart;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const nextSym = i < chords.length - 1 ? chords[i + 1].sym : nextChordBar[0];
    tenmonSoloBarBallad(take, c.sym, nextSym, t, quarter, c.beats, center, rand, vel);
    t += quarter * c.beats;
  }
}

interface TenmonTrackDef {
  bpm: number;
  beatsPerBar: number;
  bars: TenmonBar[];
  headBars: string[];
  turnFill: string;
  lhCenter: number;
  compPatterns: number[][];
  solo: 'swing' | 'straight' | 'ballad';
  soloCenter: number;
  soloChoruses: number;
  seed: number;
  tagLick: string;
  tagChordNotes: string[];
}

/** ヘッド×2 → アドリブ・ソロ×N → ヘッド・アウト×1 → タグ、という共通の曲の骨格 */
function buildTenmonTrack(def: TenmonTrackDef): PerformanceEvent[] {
  const take = new Take(def.seed);
  const rand = humanizer(def.seed + 777);
  const quarter = 60 / def.bpm;
  const bpb = def.beatsPerBar;
  const bar = quarter * bpb;
  const numBars = def.bars.length;
  const isBallad = def.solo === 'ballad';
  let time = 0;

  function playHeadChorus(vel: number, useTurnFill: boolean) {
    for (let i = 0; i < numBars; i++) {
      const barStart = time + i * bar;
      take.pedalPerBar(barStart);
      if (isBallad) tenmonCompBallad(take, def.bars[i], barStart, quarter, bpb, def.lhCenter, vel * 0.6, rand);
      else tenmonCompBar(take, def.bars[i], barStart, quarter, bpb, def.compPatterns, def.lhCenter, vel * 0.58, rand);
      const spec = useTurnFill && i === numBars - 1 ? def.turnFill : def.headBars[i];
      take.seq(barStart, spec, quarter, vel, 0.9);
    }
    time += numBars * bar;
  }

  playHeadChorus(0.5, false);
  playHeadChorus(0.52, true);

  for (let c = 0; c < def.soloChoruses; c++) {
    const vel = 0.4 + Math.min(0.14, c * 0.012);
    for (let i = 0; i < numBars; i++) {
      const barStart = time + i * bar;
      take.pedalPerBar(barStart);
      const chordBar = def.bars[i];
      const nextChordBar = def.bars[(i + 1) % numBars];
      if (isBallad) {
        tenmonCompBallad(take, chordBar, barStart, quarter, bpb, def.lhCenter, 0.26, rand);
        tenmonSoloBarBalladAny(take, chordBar, nextChordBar, barStart, quarter, bpb, def.soloCenter, rand, vel);
      } else {
        tenmonCompBar(take, chordBar, barStart, quarter, bpb, def.compPatterns, def.lhCenter, 0.3, rand);
        const isFinalRun = c === def.soloChoruses - 1 && i === numBars - 1;
        tenmonSoloBarAny(
          take, chordBar, nextChordBar, barStart, quarter, bpb, def.soloCenter, rand, vel,
          def.solo === 'swing', isFinalRun
        );
      }
    }
    time += numBars * bar;
  }

  playHeadChorus(0.58, false);

  // --- タグ（終止） ---
  take.pedalPerBar(time);
  if (isBallad) tenmonCompBallad(take, def.bars[0], time, quarter, bpb, def.lhCenter, 0.3, rand);
  else tenmonCompBar(take, def.bars[0], time, quarter, bpb, def.compPatterns, def.lhCenter, 0.32, rand);
  take.seq(time, def.tagLick, quarter, 0.55, 0.85);
  const chordTime = time + bar;
  take.pedal(chordTime - 0.03, 0);
  take.pedal(chordTime + 0.05, 1);
  for (const name of def.tagChordNotes) take.note(chordTime, midiOf(name), bar * 2.2, 0.5);
  take.pedal(chordTime + bar * 2.4, 0);

  return take.done();
}

// 01. 混沌の序章 — Aマイナー・ドリアン、4/4、96bpm、幻想的なモーダル・スウィング
// 8小節ヴァンプ。1コーラス = 4*60/96*8 = 20秒。
// ヘッド×2 + ソロ6コーラス + ヘッド・アウト×1 = 9コーラス=180秒 + タグ≒8.5秒 ≒188.5秒(3:08)
const TENMON_01_BARS: TenmonBar[] = [
  ['Am7'], ['Am7'], ['Dm7'], ['Dm7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'],
];
const TENMON_01_HEAD: string[] = [
  'A4:0.5 C5:0.5 r:1 E5:1 D5:0.5 C5:0.5',
  'A4:1 r:1 D5:0.5 F5:0.5 r:1',
  'E5:1 D5:0.5 C5:0.5 A4:1 r:1',
  'G4:0.5 A4:1.5 r:2',
  'E5:0.5 C5:0.5 r:1 A4:1 G4:0.5 A4:0.5',
  'F5:1 r:1 D5:0.5 C5:0.5 r:1',
  'D#5:0.5 E5:0.5 G5:0.5 F5:0.5 E5:1 r:1',
  'A4:0.5 C5:0.5 E5:1 A5:2',
];
function buildTenmon01(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 96, beatsPerBar: 4, bars: TENMON_01_BARS, headBars: TENMON_01_HEAD,
    turnFill: 'A4:0.5 C5:0.5 E5:0.5 G5:0.5 A5:0.5 G5:0.5 E5:0.5 C5:0.5',
    lhCenter: 57, compPatterns: TENMON_MODAL_PATTERNS, solo: 'swing', soloCenter: 69,
    soloChoruses: 6, seed: 90010101,
    tagLick: 'E5:0.5 C5:0.5 A5:0.5 G5:0.5 E5:1 C5:1',
    tagChordNotes: ['A1', 'E2', 'A2', 'C3', 'E3', 'A3', 'C4', 'E4', 'A4'],
  });
}

// 02. 誰が空を創ったのか — Bb、4/4、144bpm、ミディアム・スウィングの12小節ブルース
// 1コーラス = 4*60/144*12 = 20秒。ヘッド×2 + ソロ6 + ヘッド・アウト×1 = 9コーラス=180秒
// + タグ≒5.7秒 ≒185.7秒(3:05.7)
const TENMON_02_BARS: TenmonBar[] = [
  ['Bb7'], ['Eb7'], ['Bb7'], ['Bb7'], ['Eb7'], ['Edim7'],
  ['Bb7'], ['G7'], ['Cm7'], ['F7'], ['Bb7', 'G7'], ['Cm7', 'F7'],
];
const TENMON_02_HEAD: string[] = [
  'Bb4:0.5 D5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1',
  'C5:1 r:0.5 Bb4:0.5 D5:1 r:1',
  'F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 Bb4:2',
  'r:4',
  'Eb5:0.5 D5:0.5 C5:1 Bb4:1 r:1',
  'F5:0.5 Eb5:0.5 D5:0.5 B4:0.5 Bb4:2',
  'D5:1 F5:0.5 Eb5:0.5 D5:1 Bb4:1',
  'G4:0.5 B4:0.5 D5:1 F5:1 r:1',
  'Eb5:1 D5:0.5 C5:0.5 Bb4:1 G4:1',
  'A4:0.5 C5:0.5 Eb5:1 D5:1 C5:1',
  'D5:1 F5:1 E5:0.5 D5:0.5 B4:1',
  'C5:1 Eb5:0.5 D5:0.5 Bb4:1 F4:1',
];
function buildTenmon02(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 144, beatsPerBar: 4, bars: TENMON_02_BARS, headBars: TENMON_02_HEAD,
    turnFill: 'Eb5:0.5 C5:0.5 Bb4:0.5 Ab4:0.5 F4:1 Eb4:1',
    lhCenter: 58, compPatterns: TENMON_SWING_PATTERNS, solo: 'swing', soloCenter: 70,
    soloChoruses: 6, seed: 90020202,
    tagLick: 'D5:0.5 F5:0.5 Ab5:0.5 G5:0.5 F5:1 D5:1',
    tagChordNotes: ['Bb1', 'F2', 'Bb2', 'D3', 'F3', 'Ab3', 'Bb3', 'D4'],
  });
}

// 03. 星の回廊 — Dマイナー、3/4、168bpm、ジャズワルツの12小節
// 1コーラス = 3*60/168*12 = 12.857秒。ヘッド×2 + ソロ10 + ヘッド・アウト×1 = 13コーラス
// ≒167.14秒 + タグ≒3.64秒 ≒170.8秒(2:50.8)
const TENMON_03_BARS: TenmonBar[] = [
  ['Dm7'], ['Gm7'], ['C7'], ['Fmaj7'], ['Bbmaj7'], ['E7alt'],
  ['Am7'], ['D7'], ['Gm7'], ['C7'], ['Dm7'], ['Dm7'],
];
const TENMON_03_HEAD: string[] = [
  'D5:1 F5:0.5 A5:0.5 G5:1',
  'F5:1 E5:1 D5:1',
  'C5:1.5 D5:1.5',
  'A4:3',
  'Bb4:1 D5:0.5 F5:0.5 A5:1',
  'G#4:1 B4:1 D5:1',
  'C5:1.5 E5:1.5',
  'F#4:1 A4:1 C5:1',
  'D5:1 Bb4:1 G4:1',
  'E4:1 G4:1 Bb4:1',
  'F4:1.5 A4:1.5',
  'D5:3',
];
function buildTenmon03(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 168, beatsPerBar: 3, bars: TENMON_03_BARS, headBars: TENMON_03_HEAD,
    turnFill: 'D5:0.5 F5:0.5 A5:0.5 G5:0.5 F5:0.5 D5:0.5',
    lhCenter: 50, compPatterns: TENMON_WALTZ_PATTERNS, solo: 'straight', soloCenter: 74,
    soloChoruses: 10, seed: 90030303,
    tagLick: 'D5:1 F5:1 A5:1',
    tagChordNotes: ['D2', 'A2', 'D3', 'F3', 'A3', 'D4', 'F4'],
  });
}

// 04. 地の果てへ — F、4/4、132bpm、ボサノバの8小節
// 1コーラス = 4*60/132*8 = 14.545秒。ヘッド×2 + ソロ9 + ヘッド・アウト×1 = 12コーラス
// ≒174.55秒 + タグ≒6.18秒 ≒180.7秒(3:00.7)
const TENMON_04_BARS: TenmonBar[] = [
  ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7'], ['Gm7', 'C7'],
  ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7', 'G7'], ['Cmaj7'],
];
const TENMON_04_HEAD: string[] = [
  'C5:1 A4:0.5 F4:0.5 G4:1 A4:1',
  'Bb4:1 A4:0.5 G4:0.5 F4:2',
  'E4:1 G4:1 C5:1 Bb4:1',
  'A4:2 r:2',
  'C5:1 Bb4:0.5 A4:0.5 G4:1 F4:1',
  'G4:1 Bb4:0.5 A4:0.5 C#5:1 C5:1',
  'D5:1 F5:0.5 E5:0.5 D5:1 B4:1',
  'C5:1 E5:1 G5:2',
];
function buildTenmon04(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 132, beatsPerBar: 4, bars: TENMON_04_BARS, headBars: TENMON_04_HEAD,
    turnFill: 'C5:0.5 E5:0.5 G5:0.5 B5:0.5 C6:1 G5:1',
    lhCenter: 53, compPatterns: TENMON_BOSSA_PATTERNS, solo: 'straight', soloCenter: 65,
    soloChoruses: 9, seed: 90040404,
    tagLick: 'F4:0.5 A4:0.5 C5:0.5 E5:0.5 F5:1 C5:1',
    tagChordNotes: ['F1', 'C2', 'F2', 'A2', 'C3', 'E3', 'F3', 'A3'],
  });
}

// 05. 問いかける月 — Eb、4/4、63bpm、バラードの8小節
// 1コーラス = 4*60/63*8 = 30.48秒。ヘッド×2 + ソロ2 + ヘッド・アウト×1 = 5コーラス
// =152.4秒 + タグ≒12.95秒 ≒165.3秒(2:45.3)
const TENMON_05_BARS: TenmonBar[] = [
  ['Ebmaj7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ab7'], ['Gm7', 'C7'], ['Fm7', 'Bb7'],
];
const TENMON_05_HEAD: string[] = [
  'Bb4:1.5 Eb5:0.5 D5:1 C5:1',
  'Bb4:2 Ab4:1 G4:1',
  'F4:1 G4:1 Ab4:1 Bb4:1',
  'Eb5:4',
  'G4:1.5 Bb4:0.5 Eb5:2',
  'C5:1 Bb4:1 Ab4:2',
  'Bb4:1.5 G4:0.5 E5:1 D5:1',
  'Ab4:1 F4:1 D5:2',
];
function buildTenmon05(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 63, beatsPerBar: 4, bars: TENMON_05_BARS, headBars: TENMON_05_HEAD,
    turnFill: 'Ab4:0.5 F4:0.5 D5:0.5 Bb4:0.5 Ab4:1 F4:1',
    lhCenter: 51, compPatterns: [], solo: 'ballad', soloCenter: 70,
    soloChoruses: 2, seed: 90050505,
    tagLick: 'G4:1 Bb4:1 Eb5:2',
    tagChordNotes: ['Eb1', 'Bb1', 'Eb2', 'G2', 'Bb2', 'D3', 'Eb3', 'G3'],
  });
}

// 06. 龍の眠り — Cマイナー、4/4、176bpm、ハードバップの16小節
// 1コーラス = 4*60/176*16 = 21.818秒。ヘッド×2 + ソロ5 + ヘッド・アウト×1 = 8コーラス
// ≒174.5秒 + タグ≒4.64秒 ≒179.2秒(2:59.2)
const TENMON_06_BARS: TenmonBar[] = [
  ['Cm7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Abmaj7'], ['Dm7b5'], ['G7alt'],
  ['Cm7'], ['Fm7', 'Bb7'], ['Ebmaj7', 'Abmaj7'], ['Dm7b5', 'G7alt'], ['Cm7'], ['Ab7'], ['G7'], ['Cm7'],
];
const TENMON_06_HEAD: string[] = [
  'C5:0.5 Eb5:0.5 G5:0.5 F5:0.5 Eb5:1 D5:1',
  'C5:0.5 D5:0.5 Eb5:1 G4:2',
  'Ab4:0.5 Bb4:0.5 C5:0.5 D5:0.5 Eb5:2',
  'D5:1 C5:1 G4:2',
  'Bb4:0.5 D5:0.5 G5:0.5 F5:0.5 Eb5:1 D5:1',
  'C5:0.5 Eb5:0.5 Ab5:0.5 G5:0.5 F5:1 Eb5:1',
  'F4:0.5 Ab4:0.5 C5:0.5 Bb4:0.5 Ab4:2',
  'Bb4:0.5 Db5:0.5 F5:0.5 Ab4:0.5 G4:2',
  'Eb5:0.5 G5:0.5 C6:0.5 Bb5:0.5 G5:1 F5:1',
  'Ab5:0.5 F5:0.5 Eb5:1 D5:0.5 Bb4:0.5 F4:1',
  'G4:0.5 Bb4:0.5 Eb5:1 C5:0.5 Ab4:0.5 F4:1',
  'F4:0.5 Ab4:0.5 C5:1 B4:0.5 G4:1.5',
  'C5:0.5 Eb5:0.5 G5:1 Eb5:0.5 D5:0.5 C5:1',
  'Ab4:1 C5:1 Eb5:2',
  'B4:1 D5:1 F5:2',
  'Eb5:0.5 G5:0.5 C6:3',
];
function buildTenmon06(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 176, beatsPerBar: 4, bars: TENMON_06_BARS, headBars: TENMON_06_HEAD,
    turnFill: 'C5:0.5 Eb5:0.5 G5:0.5 Bb5:0.5 C6:0.5 Bb5:0.5 G5:0.5 Eb5:0.5',
    lhCenter: 48, compPatterns: TENMON_SWING_PATTERNS, solo: 'swing', soloCenter: 72,
    soloChoruses: 5, seed: 90060606,
    tagLick: 'Eb5:0.5 G5:0.5 C6:0.5 G5:0.5 Eb5:1 C5:1',
    tagChordNotes: ['C1', 'G1', 'C2', 'Eb2', 'G2', 'Bb2', 'C3', 'Eb3'],
  });
}

// 07. 見えない橋 — Aマイナー、4/4、138bpm、アフロキューバン／ラテンジャズの8小節
// 1コーラス = 4*60/138*8 = 13.913秒。ヘッド×2 + ソロ10 + ヘッド・アウト×1 = 13コーラス
// ≒180.9秒 + タグ≒5.91秒 ≒186.9秒(3:06.9)
const TENMON_07_BARS: TenmonBar[] = [
  ['Am7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'],
];
const TENMON_07_HEAD: string[] = [
  'E5:0.5 A5:0.5 G5:1 E5:1 r:1',
  'D5:0.5 C5:0.5 A4:1 r:2',
  'E5:0.5 F5:0.5 E5:0.5 D5:0.5 C5:2',
  'B4:1 C5:1 A4:2',
  'C5:0.5 E5:0.5 A5:1 G5:1 r:1',
  'F5:0.5 A5:0.5 G5:1 F5:1 D5:1',
  'G#4:0.5 B4:0.5 D5:1 C5:1 r:1',
  'E5:0.5 C5:0.5 A4:3',
];
function buildTenmon07(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 138, beatsPerBar: 4, bars: TENMON_07_BARS, headBars: TENMON_07_HEAD,
    turnFill: 'A4:0.5 C5:0.5 E5:0.5 G5:0.5 A5:0.5 E5:0.5 C5:0.5 A4:0.5',
    lhCenter: 57, compPatterns: TENMON_LATIN_PATTERNS, solo: 'straight', soloCenter: 72,
    soloChoruses: 10, seed: 90070707,
    tagLick: 'E5:0.5 A5:0.5 C6:0.5 A5:0.5 E5:1 A4:1',
    tagChordNotes: ['A1', 'E2', 'A2', 'C3', 'E3', 'G3', 'A3'],
  });
}

// 08. 光と影のあいだ — Dドリアン、4/4、120bpm、モーダル・ジャズの8小節ヴァンプ
// 1コーラス = 4*60/120*8 = 16秒。ヘッド×2 + ソロ8 + ヘッド・アウト×1 = 11コーラス
// =176秒 + タグ≒6.8秒 ≒182.8秒(3:02.8)
const TENMON_08_BARS: TenmonBar[] = [
  ['Dm7'], ['Dm7'], ['Dm7'], ['Dm7'], ['Ebmaj7'], ['Ebmaj7'], ['Dm7'], ['Dm7'],
];
const TENMON_08_HEAD: string[] = [
  'D5:1 F5:0.5 A5:0.5 G5:1 F5:1',
  'E5:0.5 D5:0.5 C5:1 D5:2',
  'Eb5:1 F5:1 Eb5:1 D5:1',
  'C5:2 D5:2',
  'G4:1 Bb4:0.5 Eb5:0.5 F5:1 Eb5:1',
  'D5:1 Eb5:0.5 F5:0.5 G5:1 Eb5:1',
  'F5:1 D5:0.5 C5:0.5 A4:1 D5:1',
  'F5:1 A5:3',
];
function buildTenmon08(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 120, beatsPerBar: 4, bars: TENMON_08_BARS, headBars: TENMON_08_HEAD,
    turnFill: 'D5:0.5 F5:0.5 A5:0.5 C6:0.5 A5:0.5 F5:0.5 D5:0.5 A4:0.5',
    lhCenter: 50, compPatterns: TENMON_MODAL_PATTERNS, solo: 'swing', soloCenter: 72,
    soloChoruses: 8, seed: 90080808,
    tagLick: 'D5:1 F5:1 A5:2',
    tagChordNotes: ['D1', 'A1', 'D2', 'F2', 'A2', 'C3', 'D3', 'F3'],
  });
}

// 09. 天の川を渡る — Bb、4/4、200bpm、アップテンポ・スウィング（リズムチェンジ系）の8小節
// 1コーラス = 4*60/200*8 = 9.6秒。ヘッド×2 + ソロ15 + ヘッド・アウト×1 = 18コーラス
// =172.8秒 + タグ≒4.08秒 ≒176.9秒(2:56.9)
const TENMON_09_BARS: TenmonBar[] = [
  ['Bbmaj7'], ['Gm7'], ['Cm7'], ['F7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ebm6'],
];
const TENMON_09_HEAD: string[] = [
  'F5:0.5 G5:0.5 A5:0.5 Bb5:0.5 A5:1 G5:1',
  'F5:0.5 D5:0.5 C5:1 Bb4:2',
  'D5:0.5 Eb5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1',
  'C5:2 Bb4:2',
  'Ab5:0.5 F5:0.5 Eb5:1 D5:0.5 C5:0.5 Bb4:1',
  'D5:0.5 F5:0.5 Ab5:0.5 G5:0.5 F5:1 D5:1',
  'G5:0.5 Bb5:0.5 Eb6:0.5 D6:0.5 C6:1 Bb5:1',
  'G5:0.5 Eb5:0.5 C6:1 Bb5:2',
];
function buildTenmon09(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 200, beatsPerBar: 4, bars: TENMON_09_BARS, headBars: TENMON_09_HEAD,
    turnFill: 'Eb5:0.25 Gb5:0.25 Bb5:0.25 C6:0.25 Bb5:0.5 Gb5:0.5 Eb5:1 Bb4:1',
    lhCenter: 58, compPatterns: TENMON_SWING_PATTERNS, solo: 'swing', soloCenter: 74,
    soloChoruses: 15, seed: 90090909,
    tagLick: 'Bb5:0.25 F5:0.25 D5:0.25 Bb4:0.25 F5:0.5 D5:0.5 Bb4:1 F4:1',
    tagChordNotes: ['Bb1', 'F2', 'Bb2', 'D3', 'F3', 'Bb3', 'D4'],
  });
}

// 10. 終わりなき問い — G、4/4、58bpm、バラード／エピローグの8小節
// 1コーラス = 4*60/58*8 = 33.103秒。ヘッド×2 + ソロ2 + ヘッド・アウト×1 = 5コーラス
// ≒165.52秒 + タグ≒14.07秒 ≒179.6秒(2:59.6)
const TENMON_10_BARS: TenmonBar[] = [
  ['Gmaj7'], ['Em7'], ['Am7'], ['D7'], ['Gmaj7'], ['Cmaj7'], ['Am7', 'D7'], ['Gmaj7'],
];
const TENMON_10_HEAD: string[] = [
  'D5:1.5 B4:0.5 A4:1 G4:1',
  'F#4:2 E4:1 D4:1',
  'G4:1 A4:1 B4:1 D5:1',
  'G5:4',
  'B4:1.5 D5:0.5 G5:1 F#5:1',
  'E5:2 D5:1 C5:1',
  'C5:1.5 B4:0.5 A4:1 F#4:1',
  'G4:1 B4:1 D5:2',
];
function buildTenmon10(): PerformanceEvent[] {
  return buildTenmonTrack({
    bpm: 58, beatsPerBar: 4, bars: TENMON_10_BARS, headBars: TENMON_10_HEAD,
    turnFill: 'D5:1 B4:1 G4:2',
    lhCenter: 55, compPatterns: [], solo: 'ballad', soloCenter: 71,
    soloChoruses: 2, seed: 90101010,
    tagLick: 'D5:1 B4:1 G5:2',
    tagChordNotes: ['G1', 'D2', 'G2', 'B2', 'D3', 'G3', 'B3', 'D4', 'G4'],
  });
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
  {
    id: 'tenmon-01',
    title: '01. 混沌の序章',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'cinematic',
    build: buildTenmon01,
  },
  {
    id: 'tenmon-02',
    title: '02. 誰が空を創ったのか',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildTenmon02,
  },
  {
    id: 'tenmon-03',
    title: '03. 星の回廊',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildTenmon03,
  },
  {
    id: 'tenmon-04',
    title: '04. 地の果てへ',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildTenmon04,
  },
  {
    id: 'tenmon-05',
    title: '05. 問いかける月',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'warm',
    build: buildTenmon05,
  },
  {
    id: 'tenmon-06',
    title: '06. 龍の眠り',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildTenmon06,
  },
  {
    id: 'tenmon-07',
    title: '07. 見えない橋',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildTenmon07,
  },
  {
    id: 'tenmon-08',
    title: '08. 光と影のあいだ',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'jazz',
    build: buildTenmon08,
  },
  {
    id: 'tenmon-09',
    title: '09. 天の川を渡る',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'bright',
    build: buildTenmon09,
  },
  {
    id: 'tenmon-10',
    title: '10. 終わりなき問い',
    composer: '天問',
    note: '本アプリ書き下ろし',
    presetId: 'cinematic',
    build: buildTenmon10,
  },
];
