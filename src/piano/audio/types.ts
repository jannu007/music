export type ReverbType = 'off' | 'room' | 'studio' | 'hall' | 'church';

/** 音源とエフェクトの全パラメータ */
export interface PianoSettings {
  /** マスター音量 0..1 */
  volume: number;
  /** ハンマーの硬さ＝明るさ 0..1 */
  brightness: number;
  /** 減衰時間の倍率 0.4..1.8 */
  decay: number;
  /** 共鳴弦の量 0..1 */
  stringRes: number;
  /** ユニゾン弦のずれ（うなり） 0..1 */
  unison: number;
  /** 打弦ノイズ 0..1 */
  hammerNoise: number;
  /** 離鍵ノイズ 0..1 */
  releaseNoise: number;
  /** ベロシティカーブ 0.6..2.0（大きいほど重い） */
  velCurve: number;
  /** ダイナミクスレンジ 0.4..1.4 */
  dynamics: number;
  /** 基準ピッチ Hz */
  a4: number;
  /** ストレッチチューニング量 0..1.5 */
  stretch: number;
  /** 打弦位置 0..1 */
  strikePos: number;
  /** 屋根（大屋根）の開き 0..1 */
  lid: number;
  /** トーン（高域シェルフ） -1..1 */
  tone: number;
  /** リバーブ種別 */
  reverbType: ReverbType;
  /** リバーブ量 0..1 */
  reverbMix: number;
  /** 最大同時発音数 */
  maxVoices: number;
}

/** 演奏イベント（録音・書き出し・デモ再生で共通利用） */
export type PerformanceEvent =
  | { time: number; type: 'note'; note: number; vel: number }
  | { time: number; type: 'off'; note: number }
  | { time: number; type: 'sustain'; value: number }
  | { time: number; type: 'sostenuto'; value: number }
  | { time: number; type: 'soft'; value: number };

/** 時刻を持たない演奏イベント（録音時に時刻を付与する） */
export type PerformanceEventInput =
  | { type: 'note'; note: number; vel: number }
  | { type: 'off'; note: number }
  | { type: 'sustain'; value: number }
  | { type: 'sostenuto'; value: number }
  | { type: 'soft'; value: number };

export const DEFAULT_SETTINGS: PianoSettings = {
  volume: 0.8,
  brightness: 0.5,
  decay: 1.0,
  stringRes: 0.55,
  unison: 0.5,
  hammerNoise: 0.4,
  releaseNoise: 0.5,
  velCurve: 1.0,
  dynamics: 1.0,
  a4: 440,
  stretch: 1.0,
  strikePos: 0.5,
  lid: 0.85,
  tone: 0,
  reverbType: 'hall',
  reverbMix: 0.28,
  maxVoices: 40,
};
