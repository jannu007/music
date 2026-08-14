/**
 * ストローク／アルペジオのリズムパターン。
 * 1ステップ = 16分音符。beats はその小節の拍数（4 なら4/4で16ステップ）。
 */
export type PatternStep =
  | { kind: 'rest' }
  /** 全弦を弾く。dir はピッキング方向、mute はブラッシング */
  | { kind: 'strum'; dir: 'down' | 'up'; vel: number; mute?: boolean; low?: number; high?: number }
  /**
   * 単弦を弾く。slot は鳴っている弦のうち低音から数えた位置。
   * 負の値は高音側から数える（-1 = 1弦側）。
   */
  | { kind: 'pick'; slot: number; vel: number };

export interface RhythmPattern {
  id: string;
  name: string;
  beats: number;
  /** ハネる度合い 0..0.5（0=イーブン） */
  swing: number;
  steps: PatternStep[];
  hint: string;
}

const R: PatternStep = { kind: 'rest' };
const D = (vel = 0.8, o: Partial<Extract<PatternStep, { kind: 'strum' }>> = {}): PatternStep =>
  ({ kind: 'strum', dir: 'down', vel, ...o });
const U = (vel = 0.62, o: Partial<Extract<PatternStep, { kind: 'strum' }>> = {}): PatternStep =>
  ({ kind: 'strum', dir: 'up', vel, ...o });
const P = (slot: number, vel = 0.72): PatternStep => ({ kind: 'pick', slot, vel });

function bar(steps: PatternStep[], length: number): PatternStep[] {
  const out = steps.slice(0, length);
  while (out.length < length) out.push(R);
  return out;
}

export const PATTERNS: RhythmPattern[] = [
  {
    id: 'whole',
    name: 'ジャーン（全音符）',
    beats: 4,
    swing: 0,
    hint: '小節あたま1回だけ。コードの響きを確かめるときに。',
    steps: bar([D(0.9)], 16),
  },
  {
    id: 'eighth',
    name: '8ビート・ストローク',
    beats: 4,
    swing: 0,
    hint: '8分の全ダウン。ロック/ポップスの基本。',
    steps: bar(
      [D(0.92), R, D(0.6), R, D(0.8), R, D(0.6), R, D(0.9), R, D(0.6), R, D(0.8), R, D(0.65), R],
      16
    ),
  },
  {
    id: 'folk',
    name: 'フォーク（D DU UDU）',
    beats: 4,
    swing: 0,
    hint: '弾き語りの定番ストローク。',
    steps: bar(
      [D(0.92), R, R, R, D(0.78), R, U(0.6), R, R, R, U(0.6), R, D(0.82), R, U(0.62), R],
      16
    ),
  },
  {
    id: 'sixteen',
    name: '16ビート・カッティング',
    beats: 4,
    swing: 0,
    hint: '空ピッキングを混ぜた16分。ファンク/シティポップに。',
    steps: bar(
      [
        D(0.9), U(0.4, { mute: true }), D(0.55, { mute: true }), U(0.7),
        D(0.85), U(0.4, { mute: true }), D(0.5, { mute: true }), U(0.66),
        D(0.88), U(0.4, { mute: true }), D(0.55, { mute: true }), U(0.7),
        D(0.8), U(0.45, { mute: true }), D(0.5, { mute: true }), U(0.72),
      ],
      16
    ),
  },
  {
    id: 'shuffle',
    name: 'シャッフル',
    beats: 4,
    swing: 0.33,
    hint: 'ハネた8分。ブルース/ロカビリーに。',
    steps: bar(
      [D(0.92), R, U(0.55), R, D(0.8), R, U(0.55), R, D(0.9), R, U(0.55), R, D(0.82), R, U(0.6), R],
      16
    ),
  },
  {
    id: 'ballad',
    name: 'バラード・アルペジオ',
    beats: 4,
    swing: 0,
    hint: '低音→内声→高音の順に爪弾く定番アルペジオ。',
    steps: bar(
      [
        P(0, 0.8), R, P(2, 0.6), R, P(-1, 0.66), R, P(1, 0.58), R,
        P(-2, 0.62), R, P(2, 0.56), R, P(-1, 0.64), R, P(1, 0.55), R,
      ],
      16
    ),
  },
  {
    id: 'threefinger',
    name: 'スリーフィンガー',
    beats: 4,
    swing: 0,
    hint: 'p-i-m-i の交互ピッキング。カントリー/フォーク。',
    steps: bar(
      [
        P(0, 0.82), R, P(-1, 0.6), R, P(1, 0.7), R, P(-2, 0.6), R,
        P(0, 0.78), R, P(-1, 0.6), R, P(1, 0.68), R, P(-2, 0.6), R,
      ],
      16
    ),
  },
  {
    id: 'bossa',
    name: 'ボサノバ',
    beats: 4,
    swing: 0,
    hint: 'シンコペーションの効いたブラジリアン・リズム。',
    steps: bar(
      [
        P(0, 0.75), R, R, D(0.62, { low: 2 }), R, R, D(0.6, { low: 2 }), R,
        P(0, 0.7), R, D(0.6, { low: 2 }), R, R, R, D(0.58, { low: 2 }), R,
      ],
      16
    ),
  },
  {
    id: 'country',
    name: 'オルタネイトベース',
    beats: 4,
    swing: 0,
    hint: '低音を交互に弾きながら和音を挟むカントリー奏法。',
    steps: bar(
      [
        P(0, 0.85), R, D(0.6, { low: 2 }), R, P(1, 0.78), R, D(0.6, { low: 2 }), R,
        P(0, 0.82), R, D(0.6, { low: 2 }), R, P(1, 0.76), R, D(0.62, { low: 2 }), R,
      ],
      16
    ),
  },
  {
    id: 'chug',
    name: 'ブリッジミュート刻み',
    beats: 4,
    swing: 0,
    hint: '8分の刻み。パワーコード＋歪みで。',
    steps: bar(
      [
        D(0.95, { high: 2 }), R, D(0.7, { high: 2 }), R, D(0.8, { high: 2 }), R, D(0.7, { high: 2 }), R,
        D(0.92, { high: 2 }), R, D(0.7, { high: 2 }), R, D(0.8, { high: 2 }), R, D(0.72, { high: 2 }), R,
      ],
      16
    ),
  },
  {
    id: 'waltz',
    name: 'ワルツ（3拍子）',
    beats: 3,
    swing: 0,
    hint: '3/4拍子。ズン・チャッ・チャッ。',
    steps: bar([P(0, 0.85), R, R, R, D(0.68), R, R, R, D(0.66), R, R, R], 12),
  },
  {
    id: 'slowarp',
    name: 'スローアルペジオ',
    beats: 4,
    swing: 0,
    hint: '1拍1音のゆったりした分散和音。',
    steps: bar([P(0, 0.78), R, R, R, P(2, 0.6), R, R, R, P(-2, 0.64), R, R, R, P(-1, 0.6), R, R, R], 16),
  },
];

export function findPattern(id: string): RhythmPattern {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];
}

/** ステップ位置（16分単位）を秒に変換する（スウィング込み） */
export function stepTime(step: number, bpm: number, swing: number): number {
  const sixteenth = 60 / bpm / 4;
  // 裏の8分（16分で2つめ）を後ろにずらしてハネさせる
  const inPair = step % 4;
  let offset = 0;
  if (swing > 0 && inPair === 2) offset = swing * sixteenth * 2;
  return step * sixteenth + offset;
}
