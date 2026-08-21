import type { DistortionType, FilterMode, ModMode } from '../../../shared/audio/fx';
export type { DistortionType, FilterMode, ModMode };
/** 奏法 */
export type Technique =
  | 'finger'
  | 'pick'
  | 'slap'
  | 'pop'
  | 'mute'
  | 'ghost'
  | 'harmonic'
  | 'hammer';

export type CabType = 'di' | '1x15' | '4x10' | '8x10';
export type ReverbType = 'off' | 'room' | 'studio' | 'hall';

/** 音源・アンプ・エフェクトの全パラメータ */
export interface BassSettings {
  // --- 楽器 ---
  /** 弦の数 4..6 */
  stringCount: number;
  /** チューニングID */
  tuningId: string;
  /** 基準ピッチ Hz */
  a4: number;
  /** フレットレスか */
  fretless: boolean;

  // --- 弦 ---
  /** 弦の明るさ（使い込んだ弦 ↔ 張りたての弦） 0..1 */
  brightness: number;
  /** 余韻の長さ 0.4..1.7 */
  sustain: number;
  /** 弦の硬さ（不協和度・ゴリッとした唸り） 0..1 */
  stiffness: number;
  /** フレットのビビり（弦高の低さ） 0..1 */
  buzz: number;
  /** 撥弦ノイズ 0..1 */
  noise: number;
  /** うなり（縦横の振動のズレ） 0..1 */
  beat: number;
  /** 他弦の共鳴 0..1 */
  sympathetic: number;
  /** 弾く位置の補正 -1..1 */
  pluckPos: number;

  // --- ピックアップ ---
  /** フロント／リアのバランス 0=フロント 1=リア */
  pickupBlend: number;
  /** フロント・ピックアップ位置（ブリッジからの割合） */
  pickupNeck: number;
  /** リア・ピックアップ位置 */
  pickupBridge: number;
  /** ピックアップの共振の強さ（パッシブらしさ） 0..1 */
  pickupTone: number;

  // --- アンプ ---
  /** 歪みの量 0..1 */
  drive: number;
  /** 低音 -1..1 */
  ampBass: number;
  /** 中音 -1..1 */
  ampMid: number;
  /** 中音の中心周波数 Hz */
  ampMidFreq: number;
  /** 高音 -1..1 */
  ampTreble: number;
  /** コンプレッサー 0..1 */
  comp: number;
  /** キャビネット */
  cab: CabType;

  // --- エフェクト ---
  /** コーラス 0..1 */
  chorus: number;
  /** オートワウ（エンベロープフィルター） 0..1 */
  wah: number;
  /** オートワウの反応の速さ 0..1 */
  wahSens: number;
  /** 残響の種類 */
  reverbType: ReverbType;
  /** 残響の量 0..1 */
  reverbMix: number;

  // --- 追加エフェクト（3アプリ共通の実装を使う。既定はすべて切） ---
  distType: DistortionType;
  /** 歪みの深さ 0..1 */
  distAmount: number;
  /** 歪んだ音の明るさ 0..1 */
  distTone: number;
  /** 歪んだ音の混ぜ量 0..1 */
  distMix: number;
  /** ビット数 2..16（16 = 切） */
  crushBits: number;
  /** ビットクラッシャーの混ぜ量 0..1 */
  crushMix: number;
  filterMode: FilterMode;
  /** カットオフ 40..18000 Hz */
  filterFreq: number;
  /** レゾナンス 0.3..20 */
  filterQ: number;
  /** 揺らしの速さ 0..8 Hz */
  filterLfoRate: number;
  /** 揺らしの深さ 0..1 */
  filterLfoDepth: number;
  flangerOn: boolean;
  flangerRate: number;
  flangerDepth: number;
  /** フランジャーのフィードバック 0..0.85 */
  flangerFeedback: number;
  flangerMix: number;
  phaserOn: boolean;
  phaserRate: number;
  phaserDepth: number;
  /** フェイザーのフィードバック 0..0.55 */
  phaserFeedback: number;
  phaserMix: number;
  ringOn: boolean;
  /** リングモジュレーターの周波数 10..2000 Hz */
  ringFreq: number;
  ringMix: number;
  modMode: ModMode;
  /** トレモロ／オートパンの速さ 0.05..16 Hz */
  modRate: number;
  /** トレモロ／オートパンの深さ 0..1 */
  modDepth: number;
  /** ディレイタイム（秒） 0.02..1.2 */
  delayTime: number;
  /** ディレイのフィードバック 0..0.85 */
  delayFeedback: number;
  /** ディレイの量 0..1 */
  delayMix: number;
  /** ディレイを左右交互にする */
  delayPingPong: boolean;
  /** ステレオ幅 0（モノラル）..1（そのまま）..2（最大） */
  width: number;

  // --- 演奏 ---
  /** ベロシティカーブ 0.5..2.2 */
  velCurve: number;
  /** ダイナミクス 0.4..1.4 */
  dynamics: number;
  /** ミュートの速さ 0..1 */
  release: number;
  /** スライドにかかる時間（秒） */
  glide: number;
  /** マスター音量 0..1 */
  volume: number;
}

/** 演奏イベント（録音・書き出し・デモ再生で共通利用） */
export type PerformanceEvent =
  | {
      time: number;
      type: 'pluck';
      str: number;
      fret: number;
      note: number;
      freq: number;
      vel: number;
      tech: Technique;
    }
  | { time: number; type: 'slide'; str: number; fret: number; note: number; freq: number; glide: number }
  | { time: number; type: 'bend'; str: number; note: number; freq: number; cents: number }
  | { time: number; type: 'mute'; str: number; amount: number }
  | { time: number; type: 'muteAll' };

export type PerformanceEventInput =
  | Omit<Extract<PerformanceEvent, { type: 'pluck' }>, 'time'>
  | Omit<Extract<PerformanceEvent, { type: 'slide' }>, 'time'>
  | Omit<Extract<PerformanceEvent, { type: 'bend' }>, 'time'>
  | Omit<Extract<PerformanceEvent, { type: 'mute' }>, 'time'>
  | Omit<Extract<PerformanceEvent, { type: 'muteAll' }>, 'time'>;

export const DEFAULT_SETTINGS: BassSettings = {
  stringCount: 4,
  tuningId: 'standard4',
  a4: 440,
  fretless: false,

  brightness: 0.55,
  sustain: 1.0,
  stiffness: 0.45,
  buzz: 0.36,
  noise: 0.5,
  beat: 0.5,
  sympathetic: 0.35,
  pluckPos: 0,

  pickupBlend: 0.42,
  pickupNeck: 0.30,
  pickupBridge: 0.115,
  pickupTone: 0.5,

  drive: 0.08,
  ampBass: 0.18,
  ampMid: -0.05,
  ampMidFreq: 700,
  ampTreble: 0.12,
  comp: 0.35,
  cab: '4x10',

  chorus: 0,
  wah: 0,
  wahSens: 0.5,
  reverbType: 'studio',
  reverbMix: 0.12,

  distType: 'off',
  distAmount: 0.4,
  distTone: 0.5,
  distMix: 0.5,
  crushBits: 16,
  crushMix: 0.5,
  filterMode: 'off',
  filterFreq: 900,
  filterQ: 2,
  filterLfoRate: 0.5,
  filterLfoDepth: 0,
  flangerOn: false,
  flangerRate: 0.3,
  flangerDepth: 0.7,
  flangerFeedback: 0.5,
  flangerMix: 0.4,
  phaserOn: false,
  phaserRate: 0.4,
  phaserDepth: 0.7,
  phaserFeedback: 0.4,
  phaserMix: 0.5,
  ringOn: false,
  ringFreq: 120,
  ringMix: 0.35,
  modMode: 'off',
  modRate: 4,
  modDepth: 0.5,
  delayTime: 0.32,
  delayFeedback: 0.3,
  delayMix: 0,
  delayPingPong: true,
  width: 1,

  velCurve: 1.0,
  dynamics: 1.0,
  release: 0.5,
  glide: 0.055,
  volume: 0.8,
};
