/**
 * Akatsuki Synth — 音色パラメータの型定義
 *
 * ここで定義したオブジェクトはそのまま AudioWorklet（synth-processor.js）へ
 * 転送され、DSP 側でも同じフィールド名で参照されます。
 */

export type OscWave = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse' | 'superSaw' | 'noise';
export type SubWave = 'sine' | 'triangle' | 'square';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
export type FilterModel = 'ladder' | 'svf';
export type NoiseType = 'white' | 'pink';
export type LfoWave = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'sampleHold';
export type LfoTarget = 'none' | 'pitch' | 'osc2Pitch' | 'pulseWidth' | 'filter' | 'amp' | 'pan' | 'fm';
export type ModWheelTarget = 'none' | 'lfo1' | 'lfo2' | 'filter';
export type VoiceMode = 'poly' | 'mono' | 'legato';
export type ArpMode = 'up' | 'down' | 'updown' | 'random' | 'order' | 'chord';
export type PatchKind = 'synth' | 'drum';

export type DrumType =
  | 'kick' | 'kick2' | 'snare' | 'rim' | 'clap' | 'hatClosed' | 'hatOpen'
  | 'tomLow' | 'tomMid' | 'tomHigh' | 'crash' | 'ride' | 'cowbell' | 'shaker' | 'clave';

export interface Envelope {
  attack: number;   // 秒
  decay: number;    // 秒
  sustain: number;  // 0..1
  release: number;  // 秒
}

export interface OscParams {
  wave: OscWave;
  octave: number;      // -3..3
  semitone: number;    // -12..12
  detune: number;      // cents -50..50
  level: number;       // 0..1
  pulseWidth: number;  // 0.03..0.97（pulse 波形）
  spread: number;      // 0..1（superSaw のデチューン幅）
  phase: number;       // 0..1 の固定初期位相 / -1 でフリーラン
}

export interface SubOscParams {
  wave: SubWave;
  octave: -1 | -2;
  level: number; // 0..1
}

export interface NoiseParams {
  type: NoiseType;
  level: number; // 0..1
}

export interface FilterParams {
  model: FilterModel;   // ladder = ムーグ型ラダー（LPF専用の太い音）
  type: FilterType;
  slope: 12 | 24;       // dB/oct
  cutoff: number;       // Hz
  resonance: number;    // 0..1
  drive: number;        // 0..1（フィルター前段のサチュレーション）
  envAmount: number;    // -1..1（±5オクターブ）
  keyTrack: number;     // 0..1
  velAmount: number;    // 0..1（ベロシティ→カットオフ）
}

export interface LfoParams {
  wave: LfoWave;
  rate: number;      // Hz（sync=false のとき）
  sync: boolean;     // テンポ同期
  division: number;  // 1周期の拍数（sync=true のとき）
  target: LfoTarget;
  amount: number;    // 0..1
  fade: number;      // 秒（フェードイン）
  retrigger: boolean;
}

export interface ModWheelParams {
  target: ModWheelTarget;
  amount: number; // 0..1
}

export interface DrumParams {
  type: DrumType;
  tune: number;   // -12..12 半音
  decay: number;  // 0.05..4 秒相当
  tone: number;   // 0..1
  snap: number;   // 0..1
  drive: number;  // 0..1
}

export interface EffectsSend {
  drive: number;
  chorus: number;
  delay: number;
  reverb: number;
}

export interface Patch {
  id: string;
  name: string;
  category: string;
  kind: PatchKind;
  drum: DrumParams;
  osc1: OscParams;
  osc2: OscParams;
  sub: SubOscParams;
  noise: NoiseParams;
  oscMix: number;    // 0 = OSC1 のみ, 1 = OSC2 のみ
  ringMod: boolean;
  oscSync: boolean;
  fmAmount: number;  // 0..1（OSC2 → OSC1 の位相変調）
  filter: FilterParams;
  filterEnv: Envelope;
  ampEnv: Envelope;
  lfo1: LfoParams;
  lfo2: LfoParams;
  voiceMode: VoiceMode;
  glide: number;      // 秒
  bendRange: number;  // 半音
  velSens: number;    // 0..1（ベロシティ→音量）
  modWheel: ModWheelParams;
  fx: EffectsSend;
  volume: number;     // 0..1
  pan: number;        // -1..1
}

export interface ArpParams {
  enabled: boolean;
  mode: ArpMode;
  octaves: number;  // 1..4
  rate: number;     // 1拍あたりのステップ数
  gate: number;     // 0..1
  swing: number;    // 0..1
  latch: boolean;
}

/** シンセ側へ送るノートイベント（time は AudioContext 時刻） */
export interface SynthEvent {
  type: 'noteOn' | 'noteOff' | 'allNotesOff' | 'panic' | 'bend' | 'mod';
  time: number;
  note?: number;
  velocity?: number;
  value?: number;
}
