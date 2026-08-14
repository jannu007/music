/*
 * Hoshizora Vocal — データモデル
 *
 * 音声素材（サンプリング音源）を一切持たず、声そのものを式で組み立てる。
 * そのため楽曲データは「音符 + 歌詞（かな）+ 表情」という軽い構造だけで足りる。
 */

/** 日本語の母音（N は撥音「ん」） */
export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'N';

export type ReverbType = 'off' | 'room' | 'plate' | 'hall' | 'church';

/** 伴奏のスタイル */
export type AccompStyle = 'off' | 'ballad' | 'pop' | 'arpeggio' | 'pad' | 'band';

/** 声色（声帯と声道の形） */
export interface VoiceCharacter {
  /** 声道スケール 0.85..1.4（大きいほど声道が短く＝フォルマントが高く、女性/子どもの声になる） */
  tract: number;
  /** 声の高さの中心（表示・自動オクターブ用の目安 MIDI ノート） */
  center: number;
  /** 明るさ（スペクトル傾斜） -1..1 */
  brightness: number;
  /** 気息（息漏れ） 0..1 */
  breath: number;
  /** 声の張り 0..1（大きいほど開放率が下がり、鋭く前に出る） */
  tension: number;
  /** 鼻にかかる量 0..1 */
  nasality: number;
  /** うなり・エッジ（パワー系のガリガリ） 0..1 */
  growl: number;
  /** 声の太さ（基本波の補強） 0..1 */
  body: number;
}

/** 歌い方（表情付け） */
export interface Expression {
  /** ビブラート深さ（セント） */
  vibDepth: number;
  /** ビブラート速さ（Hz） */
  vibRate: number;
  /** ビブラート開始位置（音符長に対する比 0..0.9） */
  vibDelay: number;
  /** ポルタメント（音程の繋ぎ）時間 ms */
  portamento: number;
  /** 子音の長さ倍率 0.5..1.8 */
  consonant: number;
  /** 立ち上がり ms */
  attack: number;
  /** 語尾の消え方 ms */
  release: number;
  /** しゃくり（フレーズ頭の下から入る量） 0..1 */
  scoop: number;
  /** 抑揚（ベロシティの効き） 0..1 */
  dynamics: number;
  /** ピッチの自然な揺らぎ 0..1 */
  drift: number;
  /** ブレス（息継ぎ音） 0..1 */
  breathNoise: number;
}

/** ミックス（ボーカル処理と伴奏バランス） */
export interface MixSettings {
  /** マスター音量 0..1 */
  volume: number;
  /** トーン（高域シェルフ） -1..1 */
  tone: number;
  /** 低域の整理（ハイパスの強さ） 0..1 */
  lowCut: number;
  /** コンプレッサーの深さ 0..1 */
  comp: number;
  /** ダブラー（重ね録り風の厚み） 0..1 */
  doubler: number;
  /** ステレオの広がり 0..1 */
  width: number;
  /** ディレイ量 0..1 */
  delayMix: number;
  /** ディレイ時間（8分＝0.5拍などの拍指定） */
  delayBeats: number;
  /** リバーブ種別 */
  reverbType: ReverbType;
  /** リバーブ量 0..1 */
  reverbMix: number;
  /** 伴奏の音量 0..1 */
  accompLevel: number;
  /** ボーカルの音量 0..1 */
  vocalLevel: number;
}

export interface VocalSettings {
  /** 声のプリセット ID */
  voiceId: string;
  character: VoiceCharacter;
  expression: Expression;
  mix: MixSettings;
  /** 基準ピッチ Hz */
  a4: number;
}

/** 音符（1モーラ＝1音符） */
export interface VocalNote {
  id: number;
  /** 開始位置（4分音符 = 1.0） */
  start: number;
  /** 長さ（拍） */
  length: number;
  /** MIDI ノート番号 */
  note: number;
  /** 歌詞（かな1モーラ。'ー' で前の母音を伸ばす） */
  lyric: string;
  /** 強さ 0..1 */
  vel: number;
  /** ビブラート量 0..1（-1 で全体設定に従う） */
  vib: number;
  /** しゃくり量 0..1（-1 で全体設定に従う） */
  scoop: number;
  /** この音符の前でブレス（息継ぎ）を入れる */
  breath: boolean;
}

/** コード（伴奏用） */
export interface ChordEvent {
  /** 開始位置（拍） */
  start: number;
  /** 長さ（拍） */
  length: number;
  /** コードネーム（C, Am7, F#m, G/B など） */
  symbol: string;
}

/** 曲データ */
export interface Song {
  title: string;
  bpm: number;
  /** 1小節の拍数 */
  beatsPerBar: number;
  notes: VocalNote[];
  chords: ChordEvent[];
  style: AccompStyle;
  settings: VocalSettings;
}

export const DEFAULT_CHARACTER: VoiceCharacter = {
  tract: 1.16,
  center: 69,
  brightness: 0.12,
  breath: 0.3,
  tension: 0.5,
  nasality: 0.14,
  growl: 0.0,
  body: 0.42,
};

export const DEFAULT_EXPRESSION: Expression = {
  vibDepth: 34,
  vibRate: 5.4,
  vibDelay: 0.35,
  portamento: 70,
  consonant: 1.0,
  attack: 26,
  release: 90,
  scoop: 0.25,
  dynamics: 0.6,
  drift: 0.45,
  breathNoise: 0.4,
};

export const DEFAULT_MIX: MixSettings = {
  volume: 0.82,
  tone: 0.1,
  lowCut: 0.5,
  comp: 0.5,
  doubler: 0.22,
  width: 0.5,
  delayMix: 0.14,
  delayBeats: 0.75,
  reverbType: 'plate',
  reverbMix: 0.3,
  accompLevel: 0.6,
  vocalLevel: 0.9,
};

export const DEFAULT_SETTINGS: VocalSettings = {
  voiceId: 'yoi',
  character: { ...DEFAULT_CHARACTER },
  expression: { ...DEFAULT_EXPRESSION },
  mix: { ...DEFAULT_MIX },
  a4: 440,
};

/** ワークレットへ渡す制御パラメータの名前（順序は実行時に共有するので自由に増やせる） */
export const PARAM_NAMES = [
  'pitch',   // MIDI ノート番号（実数）
  'level',   // 有声音の量 0..1
  'breath',  // 声門ノイズ（気息）0..1
  'fric',    // 摩擦・破裂ノイズ 0..1
  'f1', 'b1', 'f2', 'b2', 'f3', 'b3', 'f4', 'b4', 'f5', 'b5',
  'nz',      // 鼻音の反共振 Hz
  'np',      // 鼻音の共振 Hz
  'sf1', 'sb1', 'sg1', // 摩擦音バンド1
  'sf2', 'sb2', 'sg2', // 摩擦音バンド2
  'oq',      // 声門の開放率 0.25..0.85
  'rq',      // 声門の戻り相 0.02..0.5（大きいほど柔らかい）
  'tilt',    // スペクトル傾斜カットオフ Hz
  'vibDepth',// ビブラート深さ（セント）
  'vibRate', // ビブラート速さ Hz
  'growl',   // うなり 0..1
  'bar',     // 有声閉鎖のうなり（b/d/g/m/n の閉鎖中）0..1
  'body',    // 基本波の補強 0..1
  'drift',   // ピッチ揺らぎ 0..1
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export const PARAM_COUNT = PARAM_NAMES.length;

/** 補間の種類 */
export const CURVE_STEP = 0;
export const CURVE_LINEAR = 1;
export const CURVE_SMOOTH = 2;

/** 伴奏の音色（ワークレットと数値で共有する） */
export const ACCOMP_INST = {
  electricPiano: 0,
  pad: 1,
  bass: 2,
  pluck: 3,
  drum: 4,
} as const;

export type AccompInst = (typeof ACCOMP_INST)[keyof typeof ACCOMP_INST];

/** ワークレットに渡す伴奏ノート */
export interface AccompNote {
  /** 開始時刻（秒） */
  time: number;
  /** 長さ（秒） */
  dur: number;
  note: number;
  vel: number;
  inst: AccompInst;
  /** ステレオ位置 -1..1 */
  pan: number;
}

/** 1 パラメータ分のブレークポイント列 */
export interface ParamCurve {
  /** 時刻（秒。昇順） */
  times: number[];
  /** 値 */
  values: number[];
  /** その点へ向かう補間の種類（CURVE_STEP / LINEAR / SMOOTH） */
  curves: number[];
}

/** ワークレットに渡す歌声の制御曲線（パラメータごとに独立した折れ線） */
export interface Automation {
  params: ParamCurve[];
}

/** 演奏（歌声 + 伴奏）を丸ごと表したもの。再生と書き出しで同じものを使う */
export interface CompiledSong {
  automation: Automation;
  accomp: AccompNote[];
  /** 曲の長さ（秒。余韻を含まない） */
  duration: number;
  /**
   * 1 拍目の手前に用意した助走（秒）。
   * 頭の音符の子音やブレスは拍の前から始まるため、その分だけ全体を後ろへずらす。
   */
  preroll: number;
}
