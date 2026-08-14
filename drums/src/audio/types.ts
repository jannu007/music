/** ドラム音源の発音方式（すべてその場で合成する。録音サンプルは一切使わない） */
export type DrumType =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'rim'
  | 'hat'
  | 'tom'
  | 'cymbal'
  | 'cowbell'
  | 'shaker'
  | 'perc';

/** 音色の派生（同じ方式でも鳴り方を変える） */
export type DrumVariant = 'closed' | 'open' | 'ride' | 'crash' | 'default';

/**
 * 1トラック分の音づくりパラメータ。
 * tone / snap の意味は方式ごとに異なる（DRUMS.md の対応表を参照）。
 */
export interface VoiceParams {
  /** 音量 0..1.6 */
  level: number;
  /** 定位 -1..1 */
  pan: number;
  /** 音程 -24..24（半音） */
  tune: number;
  /** 減衰の長さ倍率 0.1..3 */
  decay: number;
  /** 音の明るさ 0..1 */
  tone: number;
  /** アタック成分（ノイズ・クリック）の量 0..1 */
  snap: number;
  /** サチュレーション 0..1 */
  drive: number;
  /** リバーブ送り 0..1 */
  reverb: number;
  /** ディレイ送り 0..1 */
  delay: number;
}

export interface TrackConfig {
  id: string;
  /** 表示名 */
  name: string;
  /** グリッド左端の略称 */
  short: string;
  type: DrumType;
  variant: DrumVariant;
  /** 同じ番号のトラックは互いに音を止め合う（0 = なし） */
  choke: number;
  /** MIDI 書き出し時のノート番号（GM ドラムマップ） */
  midi: number;
  params: VoiceParams;
  mute: boolean;
  solo: boolean;
}

/** 1ステップの内容。null なら無音 */
export interface Step {
  /** ベロシティ 0.05..1 */
  v: number;
  /** 発音確率 0..1 */
  p: number;
  /** 連打数 1..8（ロール） */
  r: number;
  /** 位置の微調整 -0.5..0.5（1ステップ幅に対する比） */
  s: number;
}

export interface TrackPattern {
  /** 64ステップ分（後方は未使用でも保持する） */
  steps: (Step | null)[];
  /** このトラックだけの長さ。0 ならパターン全体の長さに従う（ポリメーター） */
  length: number;
}

export interface Pattern {
  name: string;
  /** パターンの長さ（ステップ数） 1..64 */
  length: number;
  tracks: Record<string, TrackPattern>;
}

export type ReverbType = 'off' | 'room' | 'plate' | 'hall' | 'cavern';
export type DelayDivision = 'off' | '1/16' | '1/8T' | '1/8' | '1/8.' | '1/4';

export interface MasterSettings {
  /** マスター音量 0..1 */
  volume: number;
  /** サチュレーション 0..1 */
  drive: number;
  /** 低域シェルフ -12..12 dB */
  low: number;
  /** 高域シェルフ -12..12 dB */
  high: number;
  /** バスコンプの効き 0..1 */
  glue: number;
  reverbType: ReverbType;
  /** リバーブの戻り量 0..1 */
  reverbMix: number;
  delayDivision: DelayDivision;
  /** ディレイのフィードバック 0..0.85 */
  delayFeedback: number;
  /** ディレイの戻り量 0..1 */
  delayMix: number;
  /** ピンポン（左右交互）にする */
  delayPingPong: boolean;
}

/** ソングモードの1ブロック */
export interface SongSlot {
  /** パターン番号 */
  pattern: number;
  /** 繰り返し回数 1..16 */
  repeats: number;
}

export interface Project {
  version: 1;
  name: string;
  kitId: string;
  bpm: number;
  /** スウィング 50..75（%） */
  swing: number;
  /** 人間らしい揺らぎ 0..1 */
  humanize: number;
  /** 全体の細かさ（1拍あたりのステップ数） */
  stepsPerBeat: number;
  tracks: TrackConfig[];
  patterns: Pattern[];
  /** 編集中のパターン番号 */
  current: number;
  song: SongSlot[];
  songMode: boolean;
  master: MasterSettings;
}

export const STEP_MAX = 64;
export const PATTERN_COUNT = 8;

export const DEFAULT_MASTER: MasterSettings = {
  volume: 0.75,
  drive: 0.18,
  low: 0,
  high: 0,
  glue: 0.35,
  reverbType: 'room',
  reverbMix: 0.22,
  delayDivision: 'off',
  delayFeedback: 0.32,
  delayMix: 0.22,
  delayPingPong: true,
};

export function makeStep(v = 0.75, p = 1, r = 1, s = 0): Step {
  return { v, p, r, s };
}

export function emptyTrackPattern(): TrackPattern {
  return { steps: new Array(STEP_MAX).fill(null), length: 0 };
}

export function emptyPattern(name: string, trackIds: string[], length = 16): Pattern {
  const tracks: Record<string, TrackPattern> = {};
  for (const id of trackIds) tracks[id] = emptyTrackPattern();
  return { name, length, tracks };
}
