import type { FilterMode } from '../../../shared/audio/fx';
export type { FilterMode };
export type BodyType = 'none' | 'dread' | 'parlor' | 'nylon' | 'archtop' | 'resonator';
export type AmpType = 'off' | 'clean' | 'tweed' | 'british' | 'modern' | 'bassamp';
export type CabType = 'off' | 'combo1x12' | 'twin2x12' | 'stack4x12' | 'bass8x10';
export type DriveType = 'off' | 'boost' | 'overdrive' | 'distortion' | 'fuzz';
export type ModType = 'off' | 'chorus' | 'phaser' | 'tremolo' | 'wah' | 'vibrato';
export type ReverbType = 'off' | 'room' | 'plate' | 'spring' | 'hall';

/** 音源とエフェクトの全パラメータ */
export interface GuitarSettings {
  /** マスター音量 0..1 */
  volume: number;
  /** プリセットごとの出力レベル合わせ 0.2..3（音色を変えても音量が揃うようにする） */
  outputTrim: number;

  // ------------------------------------------------------------ 弦（音源）
  /** チューニングID */
  tuningId: string;
  /** カポの位置（フレット） */
  capo: number;
  /** 基準ピッチ Hz */
  a4: number;
  /** ピッキング位置 0.03(ブリッジ寄り)..0.5(ネック寄り) */
  pickPos: number;
  /** ピックの硬さ 0(指)..1(硬いピック) */
  pickHard: number;
  /** 弦の明るさ（高域の減衰しにくさ） 0..1 */
  brightness: number;
  /** サステイン（減衰時間の倍率） 0.3..2.2 */
  sustain: number;
  /** 弦の硬さ＝倍音のずれ 0..1 */
  stiffness: number;
  /** ブリッジを介した弦どうしの共鳴 0..1 */
  coupling: number;
  /** ピックのアタックノイズ 0..1 */
  pickNoise: number;
  /** 指のこすれ・フレットノイズ 0..1 */
  fretNoise: number;
  /** ビビり（強く弾いたときのバズ） 0..1 */
  buzz: number;
  /** ベロシティカーブ 0.5..2.0 */
  velCurve: number;
  /** 弦ごとの左右の広がり 0..1 */
  spread: number;
  /** ボディ（胴鳴り）の種類 */
  bodyType: BodyType;
  /** ボディ鳴りの量 0..1 */
  bodyMix: number;

  // ------------------------------------------------------------ アンプ
  ampType: AmpType;
  driveType: DriveType;
  /** ドライブ量 0..1 */
  drive: number;
  /** コンプレッサー 0..1 */
  compress: number;
  /** EQ -1..1 */
  bass: number;
  mid: number;
  treble: number;
  presence: number;
  cabType: CabType;

  // ------------------------------------------------------------ 空間系
  modType: ModType;
  /** モジュレーション速度 Hz */
  modRate: number;
  /** モジュレーション深さ 0..1 */
  modDepth: number;
  /** ディレイ量 0..1（0でオフ） */
  delayMix: number;
  /** ディレイタイム（秒） */
  delayTime: number;
  /** フィードバック 0..0.85 */
  delayFeedback: number;
  reverbType: ReverbType;
  /** リバーブ量 0..1 */
  reverbMix: number;

  // --------------------------------------------------- 追加のエフェクター
  // 上の modType（コーラス／フェイザー／トレモロ／ワウ／ビブラート）が
  // 1つしか選べないのに対して、こちらは重ねがけできる。既定はすべて切。
  fxFlangerOn: boolean;
  fxFlangerRate: number;
  fxFlangerDepth: number;
  /** フランジャーのフィードバック 0..0.85 */
  fxFlangerFeedback: number;
  fxFlangerMix: number;
  /** ビット数 2..16（16 = 切） */
  fxCrushBits: number;
  fxCrushMix: number;
  fxRingOn: boolean;
  /** リングモジュレーターの周波数 10..2000 Hz */
  fxRingFreq: number;
  fxRingMix: number;
  fxFilterMode: FilterMode;
  /** カットオフ 40..18000 Hz */
  fxFilterFreq: number;
  /** レゾナンス 0.3..20 */
  fxFilterQ: number;
  /** 揺らしの速さ 0..8 Hz */
  fxFilterLfoRate: number;
  /** 揺らしの深さ 0..1 */
  fxFilterLfoDepth: number;
  /** オートパンの速さ 0.05..16 Hz（深さ0で切） */
  fxPanRate: number;
  /** オートパンの深さ 0..1 */
  fxPanDepth: number;
  /** ステレオ幅 0（モノラル）..1（そのまま）..2（最大） */
  fxWidth: number;
}

/** 演奏イベント（録音・書き出し・デモ再生で共通利用） */
export type PerformanceEvent =
  /** 弦を弾く */
  | { time: number; type: 'pluck'; string: number; fret: number; vel: number; mute?: number }
  /** 押弦位置だけを変える（ハンマリング/プリング/スライド） */
  | { time: number; type: 'fret'; string: number; fret: number; slide?: number; vel?: number }
  /** チョーキング（半音単位） */
  | { time: number; type: 'bend'; string: number; amount: number }
  /** ビブラート（深さ・速さ） */
  | { time: number; type: 'vibrato'; string: number; depth: number; rate: number }
  /** 弦をミュートする */
  | { time: number; type: 'damp'; string: number; amount?: number }
  /** 全弦ミュート */
  | { time: number; type: 'dampAll' }
  /** ブリッジミュート量 */
  | { time: number; type: 'palm'; value: number };

export type PerformanceEventInput =
  | { type: 'pluck'; string: number; fret: number; vel: number; mute?: number }
  | { type: 'fret'; string: number; fret: number; slide?: number; vel?: number }
  | { type: 'bend'; string: number; amount: number }
  | { type: 'vibrato'; string: number; depth: number; rate: number }
  | { type: 'damp'; string: number; amount?: number }
  | { type: 'dampAll' }
  | { type: 'palm'; value: number };

export const DEFAULT_SETTINGS: GuitarSettings = {
  volume: 0.8,
  outputTrim: 1.0,

  tuningId: 'standard',
  capo: 0,
  a4: 440,
  pickPos: 0.17,
  pickHard: 0.55,
  brightness: 0.6,
  sustain: 1.0,
  stiffness: 0.35,
  coupling: 0.45,
  pickNoise: 0.4,
  fretNoise: 0.4,
  buzz: 0.2,
  velCurve: 1.0,
  spread: 0.5,
  bodyType: 'dread',
  bodyMix: 0.85,

  ampType: 'off',
  driveType: 'off',
  drive: 0.3,
  compress: 0.2,
  bass: 0.05,
  mid: 0,
  treble: 0.1,
  presence: 0.1,
  cabType: 'off',

  modType: 'off',
  modRate: 1.2,
  modDepth: 0.4,
  delayMix: 0,
  delayTime: 0.36,
  delayFeedback: 0.32,
  reverbType: 'room',
  reverbMix: 0.24,

  fxFlangerOn: false,
  fxFlangerRate: 0.3,
  fxFlangerDepth: 0.7,
  fxFlangerFeedback: 0.5,
  fxFlangerMix: 0.4,
  fxCrushBits: 16,
  fxCrushMix: 0.5,
  fxRingOn: false,
  fxRingFreq: 240,
  fxRingMix: 0.35,
  fxFilterMode: 'off',
  fxFilterFreq: 1400,
  fxFilterQ: 3,
  fxFilterLfoRate: 0.5,
  fxFilterLfoDepth: 0,
  fxPanRate: 3,
  fxPanDepth: 0,
  fxWidth: 1,
};
