import { DEFAULT_SETTINGS, type BassSettings, type Technique } from './types';

export interface BassPreset {
  id: string;
  name: string;
  description: string;
  /** このプリセットで既定にする奏法 */
  technique: Technique;
  settings: Partial<BassSettings>;
}

/**
 * 音色プリセット。すべて同じ物理モデルのパラメータ違いなので、
 * サンプルの追加ダウンロードは一切発生しない。
 */
export const PRESETS: BassPreset[] = [
  {
    id: 'vintage',
    name: 'ヴィンテージ・フィンガー',
    description: 'フロントPU＋古い弦の丸い音。モータウンや歌モノの土台に。',
    technique: 'finger',
    settings: {
      brightness: 0.3, sustain: 0.95, stiffness: 0.4, buzz: 0.28, noise: 0.42, beat: 0.55,
      pickupBlend: 0.05, pickupTone: 0.35, pluckPos: 0.2,
      drive: 0.05, ampBass: 0.28, ampMid: 0.05, ampMidFreq: 600, ampTreble: -0.25,
      comp: 0.45, cab: '1x15', chorus: 0, wah: 0, reverbType: 'studio', reverbMix: 0.1,
    },
  },
  {
    id: 'modern',
    name: 'モダン・フィンガー',
    description: '両PUミックスの万能サウンド。どんな曲にも馴染む基本の音。',
    technique: 'finger',
    settings: {
      brightness: 0.58, sustain: 1.05, stiffness: 0.45, buzz: 0.35, noise: 0.5, beat: 0.5,
      pickupBlend: 0.45, pickupTone: 0.5, pluckPos: 0,
      drive: 0.08, ampBass: 0.18, ampMid: -0.05, ampMidFreq: 700, ampTreble: 0.15,
      comp: 0.35, cab: '4x10', chorus: 0, wah: 0, reverbType: 'studio', reverbMix: 0.12,
    },
  },
  {
    id: 'pickrock',
    name: 'ピック・ロック',
    description: 'ピック弾きの硬いアタック。ギターの壁の中でも輪郭が消えない。',
    technique: 'pick',
    settings: {
      brightness: 0.72, sustain: 0.9, stiffness: 0.5, buzz: 0.45, noise: 0.6, beat: 0.45,
      pickupBlend: 0.7, pickupTone: 0.6, pluckPos: -0.3,
      drive: 0.28, ampBass: 0.12, ampMid: 0.18, ampMidFreq: 900, ampTreble: 0.3,
      comp: 0.4, cab: '8x10', chorus: 0, wah: 0, reverbType: 'room', reverbMix: 0.08,
    },
  },
  {
    id: 'slapfunk',
    name: 'スラップ・ファンク',
    description: '低域と高域を持ち上げた「ドンシャリ」。親指と人差し指のための音。',
    technique: 'slap',
    settings: {
      brightness: 0.88, sustain: 1.1, stiffness: 0.55, buzz: 0.62, noise: 0.55, beat: 0.5,
      pickupBlend: 0.5, pickupTone: 0.75, pluckPos: 0,
      drive: 0.05, ampBass: 0.42, ampMid: -0.42, ampMidFreq: 550, ampTreble: 0.5,
      comp: 0.6, cab: '4x10', chorus: 0.12, wah: 0, reverbType: 'room', reverbMix: 0.1,
    },
  },
  {
    id: 'autowah',
    name: 'オートワウ・ファンク',
    description: '弾く強さでフィルターが開くエンベロープフィルター。16分のカッティングに。',
    technique: 'finger',
    settings: {
      brightness: 0.8, sustain: 0.95, stiffness: 0.5, buzz: 0.5, noise: 0.55, beat: 0.5,
      pickupBlend: 0.6, pickupTone: 0.7, pluckPos: -0.1,
      drive: 0.1, ampBass: 0.2, ampMid: -0.1, ampMidFreq: 800, ampTreble: 0.25,
      comp: 0.5, cab: '4x10', chorus: 0, wah: 0.72, wahSens: 0.6,
      reverbType: 'room', reverbMix: 0.08,
    },
  },
  {
    id: 'fretless',
    name: 'フレットレス',
    description: 'フレットの無い指板の「ムワッ」とした鳴り。スライドで歌わせる音。',
    technique: 'finger',
    settings: {
      fretless: true,
      brightness: 0.42, sustain: 1.0, stiffness: 0.35, buzz: 0.12, noise: 0.45, beat: 0.6,
      pickupBlend: 0.35, pickupTone: 0.55, pluckPos: 0.25, glide: 0.09,
      drive: 0.06, ampBass: 0.22, ampMid: 0.22, ampMidFreq: 750, ampTreble: 0,
      comp: 0.35, cab: '1x15', chorus: 0.2, wah: 0, reverbType: 'hall', reverbMix: 0.2,
    },
  },
  {
    id: 'jazz',
    name: 'ウォーキング・ジャズ',
    description: '減衰の速い太い音。ウッドベースに寄せた4ビート向けの設定。',
    technique: 'finger',
    settings: {
      brightness: 0.16, sustain: 0.72, stiffness: 0.3, buzz: 0.3, noise: 0.68, beat: 0.65,
      pickupBlend: 0, pickupTone: 0.25, pluckPos: 0.6,
      drive: 0.04, ampBass: 0.3, ampMid: 0.15, ampMidFreq: 450, ampTreble: -0.45,
      comp: 0.4, cab: '1x15', chorus: 0, wah: 0, reverbType: 'studio', reverbMix: 0.16,
    },
  },
  {
    id: 'dub',
    name: 'ダブ／レゲエ',
    description: '高域を完全に落とした地を這う低音。ルート弾きが気持ちいい。',
    technique: 'mute',
    settings: {
      brightness: 0.08, sustain: 0.85, stiffness: 0.3, buzz: 0.2, noise: 0.35, beat: 0.5,
      pickupBlend: 0, pickupTone: 0.2, pluckPos: 0.5,
      drive: 0.04, ampBass: 0.55, ampMid: -0.2, ampMidFreq: 400, ampTreble: -0.7,
      comp: 0.55, cab: '1x15', chorus: 0, wah: 0, reverbType: 'room', reverbMix: 0.14,
    },
  },
  {
    id: 'grind',
    name: 'グラインド・ドライブ',
    description: '歪ませても低音が痩せない、真空管アンプ風のオーバードライブ。',
    technique: 'pick',
    settings: {
      brightness: 0.75, sustain: 0.95, stiffness: 0.65, buzz: 0.5, noise: 0.6, beat: 0.45,
      pickupBlend: 0.65, pickupTone: 0.6, pluckPos: -0.2,
      drive: 0.62, ampBass: 0.25, ampMid: 0.28, ampMidFreq: 850, ampTreble: 0.2,
      comp: 0.45, cab: '8x10', chorus: 0, wah: 0, reverbType: 'room', reverbMix: 0.06,
    },
  },
  {
    id: 'flatline',
    name: 'DI クリーン',
    description: 'キャビネットを通さない素の音。打ち込みやミックスの素材に。',
    technique: 'finger',
    settings: {
      brightness: 0.6, sustain: 1.1, stiffness: 0.45, buzz: 0.3, noise: 0.45, beat: 0.45,
      pickupBlend: 0.45, pickupTone: 0.45, pluckPos: 0,
      drive: 0, ampBass: 0.05, ampMid: 0, ampMidFreq: 700, ampTreble: 0.05,
      comp: 0.3, cab: 'di', chorus: 0, wah: 0, reverbType: 'off', reverbMix: 0,
    },
  },
];

/** プリセットを適用する（楽器の設定と音量は引き継ぐ） */
export function applyPreset(base: BassSettings, presetId: string): BassSettings {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  return {
    ...DEFAULT_SETTINGS,
    volume: base.volume,
    stringCount: base.stringCount,
    tuningId: base.tuningId,
    a4: base.a4,
    velCurve: base.velCurve,
    dynamics: base.dynamics,
    release: base.release,
    ...preset.settings,
  };
}
