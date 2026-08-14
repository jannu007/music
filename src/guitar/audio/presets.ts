import { findTuning } from '../music/tunings';
import { DEFAULT_SETTINGS, type GuitarSettings } from './types';

export interface GuitarPreset {
  id: string;
  name: string;
  description: string;
  /** この音色に合うストロークパターン（デモ・自動演奏の初期値） */
  pattern?: string;
  settings: Partial<GuitarSettings>;
}

/**
 * 音色プリセット。すべて同じ物理モデル＋アンプのパラメータ違いなので、
 * サンプルの追加ダウンロードは一切発生しない。
 */
export const PRESETS: GuitarPreset[] = [
  {
    id: 'steel',
    name: 'アコースティック（スチール弦）',
    description: '定番のドレッドノート。弾き語りの基本の音。',
    pattern: 'folk',
    settings: {
      pickPos: 0.16, pickHard: 0.5, brightness: 0.62, sustain: 1.0, stiffness: 0.35,
      coupling: 0.5, pickNoise: 0.42, fretNoise: 0.45, buzz: 0.15, spread: 0.55,
      bodyType: 'dread', bodyMix: 0.85,
      ampType: 'off', driveType: 'off', compress: 0.18,
      bass: 0.05, mid: -0.05, treble: 0.12, presence: 0.1, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.26,
    },
  },
  {
    id: 'strum',
    name: 'ストラム（ジャキッと）',
    description: 'ピックで強めに弾いた、抜けの良いストローク向け。',
    pattern: 'eighth',
    settings: {
      pickPos: 0.11, pickHard: 0.85, brightness: 0.75, sustain: 0.95, stiffness: 0.4,
      coupling: 0.45, pickNoise: 0.6, fretNoise: 0.4, buzz: 0.3, spread: 0.6,
      bodyType: 'dread', bodyMix: 0.8,
      ampType: 'off', driveType: 'off', compress: 0.3,
      bass: 0, mid: -0.1, treble: 0.25, presence: 0.2, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.2,
    },
  },
  {
    id: 'fingerpick',
    name: 'フィンガーピッキング',
    description: '指弾きの柔らかいアタック。アルペジオに。',
    pattern: 'ballad',
    settings: {
      outputTrim: 1.15,
      pickPos: 0.22, pickHard: 0.12, brightness: 0.52, sustain: 1.15, stiffness: 0.3,
      coupling: 0.6, pickNoise: 0.2, fretNoise: 0.5, buzz: 0.05, spread: 0.5,
      bodyType: 'dread', bodyMix: 0.9,
      ampType: 'off', driveType: 'off', compress: 0.15,
      bass: 0.08, mid: 0, treble: 0.05, presence: 0.05, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'hall', reverbMix: 0.3,
    },
  },
  {
    id: 'nylon',
    name: 'クラシックギター（ナイロン）',
    description: '柔らかく丸いナイロン弦。ボサノバやクラシックに。',
    pattern: 'bossa',
    settings: {
      outputTrim: 1.6,
      pickPos: 0.24, pickHard: 0.08, brightness: 0.4, sustain: 0.9, stiffness: 0.12,
      coupling: 0.55, pickNoise: 0.18, fretNoise: 0.15, buzz: 0.02, spread: 0.45,
      bodyType: 'nylon', bodyMix: 0.95,
      ampType: 'off', driveType: 'off', compress: 0.1,
      bass: 0.1, mid: 0.05, treble: -0.1, presence: -0.05, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.28,
    },
  },
  {
    id: 'parlor',
    name: 'パーラー（小型ボディ）',
    description: '小ぶりな箱の軽やかな鳴り。ブルースやラグタイムに。',
    pattern: 'threefinger',
    settings: {
      outputTrim: 1.1,
      pickPos: 0.14, pickHard: 0.45, brightness: 0.66, sustain: 0.85, stiffness: 0.38,
      coupling: 0.4, pickNoise: 0.45, fretNoise: 0.5, buzz: 0.25, spread: 0.5,
      bodyType: 'parlor', bodyMix: 0.85,
      ampType: 'off', driveType: 'off', compress: 0.2,
      bass: -0.1, mid: 0.1, treble: 0.15, presence: 0.1, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.22,
    },
  },
  {
    id: 'resonator',
    name: 'リゾネーター（スライド）',
    description: '金属の共鳴板。ボトルネック奏法に。オープンGと相性◎',
    pattern: 'shuffle',
    settings: {
      outputTrim: 0.95,
      pickPos: 0.1, pickHard: 0.7, brightness: 0.8, sustain: 1.1, stiffness: 0.45,
      coupling: 0.7, pickNoise: 0.55, fretNoise: 0.7, buzz: 0.4, spread: 0.4,
      bodyType: 'resonator', bodyMix: 1.0,
      ampType: 'off', driveType: 'off', compress: 0.35,
      bass: -0.15, mid: 0.25, treble: 0.2, presence: 0.15, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'plate', reverbMix: 0.24,
    },
  },
  {
    id: 'clean',
    name: 'エレキ・クリーン',
    description: '素直なクリーントーン。コード弾きにもアルペジオにも。',
    pattern: 'ballad',
    settings: {
      outputTrim: 1.0,
      pickPos: 0.13, pickHard: 0.6, brightness: 0.7, sustain: 1.35, stiffness: 0.3,
      coupling: 0.35, pickNoise: 0.35, fretNoise: 0.3, buzz: 0.1, spread: 0.35,
      bodyType: 'none', bodyMix: 0,
      ampType: 'clean', driveType: 'off', compress: 0.3,
      bass: 0.05, mid: -0.05, treble: 0.15, presence: 0.15, cabType: 'twin2x12',
      modType: 'off', delayMix: 0.12, delayTime: 0.32, delayFeedback: 0.2,
      reverbType: 'spring', reverbMix: 0.24,
    },
  },
  {
    id: 'funk',
    name: 'ファンク・カッティング',
    description: 'コンプの効いた歯切れの良いカッティング。',
    pattern: 'sixteen',
    settings: {
      outputTrim: 0.95,
      pickPos: 0.07, pickHard: 0.9, brightness: 0.82, sustain: 1.0, stiffness: 0.32,
      coupling: 0.3, pickNoise: 0.5, fretNoise: 0.35, buzz: 0.2, spread: 0.3,
      bodyType: 'none', bodyMix: 0,
      ampType: 'clean', driveType: 'boost', drive: 0.15, compress: 0.75,
      bass: -0.2, mid: 0.1, treble: 0.3, presence: 0.25, cabType: 'combo1x12',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.14,
    },
  },
  {
    id: 'jazz',
    name: 'ジャズ・アーチトップ',
    description: 'フロントピックアップの太く丸いトーン。',
    pattern: 'bossa',
    settings: {
      outputTrim: 1.5,
      pickPos: 0.34, pickHard: 0.3, brightness: 0.32, sustain: 1.2, stiffness: 0.25,
      coupling: 0.45, pickNoise: 0.25, fretNoise: 0.25, buzz: 0.05, spread: 0.3,
      bodyType: 'archtop', bodyMix: 0.55,
      ampType: 'clean', driveType: 'off', compress: 0.35,
      bass: 0.2, mid: 0.1, treble: -0.3, presence: -0.25, cabType: 'combo1x12',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.2,
    },
  },
  {
    id: 'blues',
    name: 'ブルース・クランチ',
    description: '軽く歪んだチューブアンプ。ピッキングの強弱で表情が出る。',
    pattern: 'shuffle',
    settings: {
      outputTrim: 0.8,
      pickPos: 0.12, pickHard: 0.65, brightness: 0.72, sustain: 1.4, stiffness: 0.32,
      coupling: 0.35, pickNoise: 0.4, fretNoise: 0.35, buzz: 0.2, spread: 0.3,
      bodyType: 'none', bodyMix: 0,
      ampType: 'tweed', driveType: 'overdrive', drive: 0.4, compress: 0.3,
      bass: 0.1, mid: 0.15, treble: 0.1, presence: 0.15, cabType: 'combo1x12',
      modType: 'off', delayMix: 0.1, delayTime: 0.28, delayFeedback: 0.2,
      reverbType: 'spring', reverbMix: 0.22,
    },
  },
  {
    id: 'british',
    name: 'ブリティッシュ・ロック',
    description: '中域の張り出したロックンロールの歪み。',
    pattern: 'eighth',
    settings: {
      outputTrim: 0.7,
      pickPos: 0.1, pickHard: 0.8, brightness: 0.75, sustain: 1.5, stiffness: 0.35,
      coupling: 0.3, pickNoise: 0.45, fretNoise: 0.3, buzz: 0.3, spread: 0.25,
      bodyType: 'none', bodyMix: 0,
      ampType: 'british', driveType: 'distortion', drive: 0.5, compress: 0.35,
      bass: 0.05, mid: 0.2, treble: 0.15, presence: 0.25, cabType: 'stack4x12',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.16,
    },
  },
  {
    id: 'metal',
    name: 'モダン・ハイゲイン',
    description: 'ミッドを削った重い歪み。ブリッジミュートの刻みに。',
    pattern: 'chug',
    settings: {
      outputTrim: 0.55,
      pickPos: 0.06, pickHard: 0.95, brightness: 0.7, sustain: 1.6, stiffness: 0.4,
      coupling: 0.25, pickNoise: 0.5, fretNoise: 0.25, buzz: 0.35, spread: 0.2,
      bodyType: 'none', bodyMix: 0,
      ampType: 'modern', driveType: 'distortion', drive: 0.8, compress: 0.4,
      bass: 0.3, mid: -0.35, treble: 0.3, presence: 0.35, cabType: 'stack4x12',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.12,
    },
  },
  {
    id: 'fuzz',
    name: 'ファズ・リード',
    description: '荒々しいファズ。単音リードで真価を発揮。',
    pattern: 'whole',
    settings: {
      outputTrim: 0.6,
      pickPos: 0.19, pickHard: 0.6, brightness: 0.68, sustain: 1.8, stiffness: 0.3,
      coupling: 0.3, pickNoise: 0.35, fretNoise: 0.3, buzz: 0.25, spread: 0.25,
      bodyType: 'none', bodyMix: 0,
      ampType: 'british', driveType: 'fuzz', drive: 0.7, compress: 0.5,
      bass: 0.1, mid: 0.3, treble: 0.05, presence: 0.1, cabType: 'stack4x12',
      modType: 'off', delayMix: 0.18, delayTime: 0.4, delayFeedback: 0.35,
      reverbType: 'plate', reverbMix: 0.2,
    },
  },
  {
    id: 'surf',
    name: 'サーフ（スプリング＋トレモロ）',
    description: '揺れるトレモロとバネの残響。60年代のインスト。',
    pattern: 'eighth',
    settings: {
      outputTrim: 0.95,
      pickPos: 0.09, pickHard: 0.9, brightness: 0.8, sustain: 1.2, stiffness: 0.35,
      coupling: 0.3, pickNoise: 0.5, fretNoise: 0.3, buzz: 0.2, spread: 0.35,
      bodyType: 'none', bodyMix: 0,
      ampType: 'clean', driveType: 'off', compress: 0.3,
      bass: 0.05, mid: -0.05, treble: 0.25, presence: 0.2, cabType: 'twin2x12',
      modType: 'tremolo', modRate: 5.2, modDepth: 0.7,
      delayMix: 0, reverbType: 'spring', reverbMix: 0.4,
    },
  },
  {
    id: 'ambient',
    name: 'アンビエント（ディレイ）',
    description: '深いディレイとホール。コードを置くだけで空間が広がる。',
    pattern: 'slowarp',
    settings: {
      outputTrim: 1.05,
      pickPos: 0.26, pickHard: 0.25, brightness: 0.6, sustain: 1.6, stiffness: 0.25,
      coupling: 0.5, pickNoise: 0.2, fretNoise: 0.2, buzz: 0.05, spread: 0.7,
      bodyType: 'none', bodyMix: 0,
      ampType: 'clean', driveType: 'off', compress: 0.4,
      bass: 0, mid: -0.1, treble: 0.1, presence: 0.05, cabType: 'twin2x12',
      modType: 'chorus', modRate: 0.5, modDepth: 0.55,
      delayMix: 0.42, delayTime: 0.48, delayFeedback: 0.55,
      reverbType: 'hall', reverbMix: 0.5,
    },
  },
  {
    id: 'chorus',
    name: 'コーラス・クリーン',
    description: '80年代風の煌びやかなコーラス。アルペジオに。',
    pattern: 'ballad',
    settings: {
      outputTrim: 1.0,
      pickPos: 0.15, pickHard: 0.5, brightness: 0.74, sustain: 1.4, stiffness: 0.3,
      coupling: 0.35, pickNoise: 0.3, fretNoise: 0.28, buzz: 0.08, spread: 0.4,
      bodyType: 'none', bodyMix: 0,
      ampType: 'clean', driveType: 'off', compress: 0.35,
      bass: 0.05, mid: -0.1, treble: 0.2, presence: 0.15, cabType: 'twin2x12',
      modType: 'chorus', modRate: 0.9, modDepth: 0.6,
      delayMix: 0.14, delayTime: 0.3, delayFeedback: 0.22,
      reverbType: 'plate', reverbMix: 0.28,
    },
  },
  {
    id: 'wah',
    name: 'オートワウ・ファンク',
    description: '周期的に動くワウ。カッティングと合わせて。',
    pattern: 'sixteen',
    settings: {
      outputTrim: 0.9,
      pickPos: 0.08, pickHard: 0.85, brightness: 0.78, sustain: 1.1, stiffness: 0.32,
      coupling: 0.3, pickNoise: 0.45, fretNoise: 0.3, buzz: 0.2, spread: 0.3,
      bodyType: 'none', bodyMix: 0,
      ampType: 'tweed', driveType: 'boost', drive: 0.25, compress: 0.6,
      bass: -0.1, mid: 0.15, treble: 0.2, presence: 0.2, cabType: 'combo1x12',
      modType: 'wah', modRate: 2.4, modDepth: 0.7,
      delayMix: 0, reverbType: 'room', reverbMix: 0.14,
    },
  },
  {
    id: 'bass',
    name: 'エレキベース',
    description: '4弦ベース。チューニングも自動でベースに切り替わります。',
    pattern: 'eighth',
    settings: {
      outputTrim: 1.0,
      tuningId: 'bass',
      pickPos: 0.13, pickHard: 0.45, brightness: 0.5, sustain: 1.3, stiffness: 0.5,
      coupling: 0.3, pickNoise: 0.35, fretNoise: 0.4, buzz: 0.15, spread: 0.15,
      bodyType: 'none', bodyMix: 0,
      ampType: 'bassamp', driveType: 'off', compress: 0.5,
      bass: 0.25, mid: 0, treble: 0.05, presence: -0.1, cabType: 'bass8x10',
      modType: 'off', delayMix: 0, reverbType: 'off', reverbMix: 0,
    },
  },
  {
    id: 'ukulele',
    name: 'ウクレレ',
    description: '4弦ウクレレ。チューニングも自動で切り替わります。',
    pattern: 'folk',
    settings: {
      outputTrim: 1.3,
      tuningId: 'ukulele',
      pickPos: 0.2, pickHard: 0.35, brightness: 0.6, sustain: 0.6, stiffness: 0.1,
      coupling: 0.5, pickNoise: 0.3, fretNoise: 0.2, buzz: 0.05, spread: 0.4,
      bodyType: 'parlor', bodyMix: 0.9,
      ampType: 'off', driveType: 'off', compress: 0.15,
      bass: -0.25, mid: 0.15, treble: 0.15, presence: 0.1, cabType: 'off',
      modType: 'off', delayMix: 0, reverbType: 'room', reverbMix: 0.24,
    },
  },
];

export function findPreset(id: string): GuitarPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * プリセットを適用する。
 * チューニング・カポ・基準ピッチ・音量は演奏者の設定なので、
 * プリセットが明示している場合を除いて引き継ぐ。
 */
export function applyPreset(base: GuitarSettings, presetId: string): GuitarSettings {
  const preset = findPreset(presetId);
  // ベースやウクレレから6弦の音色に戻したときは、標準調弦に戻す。
  // そうしないと「アコースティックを選んだのに4弦のまま」になってしまう。
  let tuningId = base.tuningId;
  if (!preset.settings.tuningId && findTuning(tuningId).notes.length !== 6) {
    tuningId = 'standard';
  }
  return {
    ...DEFAULT_SETTINGS,
    volume: base.volume,
    tuningId,
    capo: base.capo,
    a4: base.a4,
    velCurve: base.velCurve,
    ...preset.settings,
  };
}
