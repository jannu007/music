/*
 * Yamabiko Sampler のデータモデル。
 *
 * 楽器（Instrument）は「ゾーン（Zone）」の集まり。ゾーンは1つの音の素材を
 * 鍵盤の範囲・強さの範囲に割り当てたもので、Kontakt などの多段サンプラーと
 * 同じ考え方になっている。
 *
 *   ゾーン = 素材 + 鍵盤の範囲 + 強さの範囲 + 基準の音程 + ループ
 *
 * 同じ鍵盤に複数のゾーンが重なっていてよい。強さで層を切り替えたり
 * （ベロシティレイヤー）、同じ層を順番に鳴らし分けたり（ラウンドロビン）できる。
 *
 * 音の素材そのもの（波形）はここには入れない。容量が大きいので IndexedDB に
 * 置き、ここでは id で参照する（store.ts）。
 */

import type { DistortionType, FilterMode, ModMode } from '../../../shared/audio/fx';

export type { DistortionType, FilterMode, ModMode };

export type ReverbType = 'off' | 'room' | 'plate' | 'hall' | 'cavern';

/** 音の素材ひとつ。波形は別に持ち、ここには素性だけを置く */
export interface SampleMeta {
  id: string;
  name: string;
  /** サンプリング周波数 */
  sampleRate: number;
  /** フレーム数（片チャンネルあたり） */
  frames: number;
  channels: number;
  /** 取り込み元。表示にだけ使う */
  origin: 'factory' | 'import' | 'record';
}

/** 鍵盤と強さの範囲に素材を割り当てたもの */
export interface Zone {
  id: string;
  sampleId: string;
  /** 鳴らす鍵盤の範囲（MIDI ノート番号・両端を含む） */
  loKey: number;
  hiKey: number;
  /** 鳴らす強さの範囲 1..127（両端を含む） */
  loVel: number;
  hiVel: number;
  /** この素材が本来鳴っている音程。ここを基準に再生速度を変える */
  rootKey: number;
  /** 半音単位の補正 */
  tuneSemis: number;
  /** セント単位の補正 */
  tuneCents: number;
  /** 音量 dB */
  gainDb: number;
  /** 定位 -1..1 */
  pan: number;
  /** 素材のうち鳴らす範囲（0..1 の割合） */
  start: number;
  end: number;
  /** ループするか */
  loop: boolean;
  /** ループの範囲（0..1 の割合。start..end の内側） */
  loopStart: number;
  loopEnd: number;
  /** ラウンドロビンの組。同じ組のゾーンが順番に鳴る */
  group: number;
  /** 逆再生 */
  reverse: boolean;
}

/** 音の立ち上がりと減衰 */
export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface FilterSettings {
  mode: FilterMode;
  /** 遮断周波数 Hz */
  freq: number;
  q: number;
  /** 鍵盤の高さで遮断周波数を動かす量 0..1 */
  keyTrack: number;
  /** エンベロープで動かす量（オクターブ） */
  envAmount: number;
  env: Envelope;
}

export interface LfoSettings {
  rate: number;
  /** 音程へ（セント） */
  toPitch: number;
  /** 遮断周波数へ（オクターブ） */
  toFilter: number;
  /** 音量へ 0..1 */
  toAmp: number;
  /** 鳴らし始めてから効き始めるまで（秒） */
  delay: number;
}

/** エフェクト。9種類は6アプリ共通の shared/audio/fx.ts を使う */
export interface FxSettings {
  distType: DistortionType;
  distAmount: number;
  distTone: number;
  distMix: number;

  crushBits: number;
  crushMix: number;

  filterMode: FilterMode;
  filterFreq: number;
  filterQ: number;
  filterRate: number;
  filterDepth: number;

  chorusOn: boolean;
  chorusRate: number;
  chorusDepth: number;
  chorusMix: number;

  flangerOn: boolean;
  flangerRate: number;
  flangerDepth: number;
  flangerFeedback: number;
  flangerMix: number;

  phaserOn: boolean;
  phaserRate: number;
  phaserDepth: number;
  phaserFeedback: number;
  phaserMix: number;

  ringOn: boolean;
  ringFreq: number;
  ringMix: number;

  modMode: ModMode;
  modRate: number;
  modDepth: number;

  width: number;

  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  delayPingPong: boolean;

  reverbType: ReverbType;
  reverbMix: number;
}

/** 楽器ひとつ */
export interface Instrument {
  id: string;
  name: string;
  zones: Zone[];
  amp: Envelope;
  filter: FilterSettings;
  lfo: LfoSettings;
  fx: FxSettings;
  /** 同時に鳴らせる音の数 */
  polyphony: number;
  /** 強さが音量に効く度合い 0..1 */
  velToVolume: number;
  /** 強さが遮断周波数に効く量（オクターブ） */
  velToFilter: number;
  /** 音から音へ滑らかにつなぐ時間（秒。0 で切り替え） */
  glide: number;
  /** 単音で鳴らす（グライドを効かせたいとき） */
  mono: boolean;
  /** 全体の音量 dB */
  gainDb: number;
  /** 移調（半音） */
  transpose: number;
}

export const DEFAULT_ENVELOPE: Envelope = { attack: 0.002, decay: 0.35, sustain: 0.85, release: 0.28 };

export const DEFAULT_FILTER: FilterSettings = {
  mode: 'lowpass',
  freq: 16000,
  q: 0.7,
  keyTrack: 0.3,
  envAmount: 0,
  env: { attack: 0.004, decay: 0.5, sustain: 0.6, release: 0.3 },
};

export const DEFAULT_LFO: LfoSettings = {
  rate: 5,
  toPitch: 0,
  toFilter: 0,
  toAmp: 0,
  delay: 0.15,
};

export const DEFAULT_FX: FxSettings = {
  distType: 'off',
  distAmount: 0.3,
  distTone: 0.5,
  distMix: 0.5,

  crushBits: 16,
  crushMix: 0,

  filterMode: 'off',
  filterFreq: 1200,
  filterQ: 4,
  filterRate: 0.5,
  filterDepth: 0,

  chorusOn: false,
  chorusRate: 0.6,
  chorusDepth: 0.4,
  chorusMix: 0.4,

  flangerOn: false,
  flangerRate: 0.3,
  flangerDepth: 0.5,
  flangerFeedback: 0.4,
  flangerMix: 0.4,

  phaserOn: false,
  phaserRate: 0.4,
  phaserDepth: 0.6,
  phaserFeedback: 0.3,
  phaserMix: 0.45,

  ringOn: false,
  ringFreq: 220,
  ringMix: 0.3,

  modMode: 'off',
  modRate: 5,
  modDepth: 0,

  width: 1,

  delayTime: 0.28,
  delayFeedback: 0.3,
  delayMix: 0,
  delayPingPong: true,

  reverbType: 'hall',
  reverbMix: 0.14,
};

/** 音名（表示用）。C-1 を 0 とする一般的な数え方 */
export function noteName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = Math.round(midi);
  return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
