import { DEFAULT_SETTINGS, type PianoSettings } from './types';

export interface PianoPreset {
  id: string;
  name: string;
  description: string;
  settings: Partial<PianoSettings>;
}

/**
 * 音色プリセット。すべて同じ物理モデルのパラメータ違いなので、
 * サンプルの追加ダウンロードは一切発生しない。
 */
export const PRESETS: PianoPreset[] = [
  {
    id: 'concert',
    name: 'コンサートグランド',
    description: 'ホールの9フィート・フルコンサート。伸びやかで華やか。',
    settings: {
      brightness: 0.55, decay: 1.1, stringRes: 0.6, unison: 0.5, hammerNoise: 0.35,
      releaseNoise: 0.45, strikePos: 0.45, lid: 1.0, tone: 0.05,
      reverbType: 'hall', reverbMix: 0.3, stretch: 1.0, velCurve: 1.0, dynamics: 1.0,
    },
  },
  {
    id: 'studio',
    name: 'スタジオグランド',
    description: '近接マイクの締まったサウンド。レコーディング向け。',
    settings: {
      brightness: 0.6, decay: 0.95, stringRes: 0.45, unison: 0.4, hammerNoise: 0.5,
      releaseNoise: 0.55, strikePos: 0.4, lid: 0.9, tone: 0.1,
      reverbType: 'studio', reverbMix: 0.18, stretch: 0.9, velCurve: 0.95, dynamics: 1.0,
    },
  },
  {
    id: 'warm',
    name: 'ウォームバラード',
    description: '柔らかいハンマー。弾き語りやバラードに。',
    settings: {
      brightness: 0.3, decay: 1.15, stringRes: 0.6, unison: 0.55, hammerNoise: 0.25,
      releaseNoise: 0.4, strikePos: 0.7, lid: 0.6, tone: -0.15,
      reverbType: 'hall', reverbMix: 0.32, stretch: 1.0, velCurve: 1.15, dynamics: 0.95,
    },
  },
  {
    id: 'bright',
    name: 'ブライトポップ',
    description: '硬めのハンマーで抜けの良い音。バンドの中でも埋もれない。',
    settings: {
      brightness: 0.85, decay: 0.9, stringRes: 0.4, unison: 0.45, hammerNoise: 0.55,
      releaseNoise: 0.5, strikePos: 0.25, lid: 1.0, tone: 0.3,
      reverbType: 'room', reverbMix: 0.16, stretch: 0.85, velCurve: 0.85, dynamics: 1.05,
    },
  },
  {
    id: 'jazz',
    name: 'ジャズクラブ',
    description: 'ややタイトな減衰と近い響き。コンピングが濁らない。',
    settings: {
      brightness: 0.62, decay: 0.8, stringRes: 0.35, unison: 0.6, hammerNoise: 0.45,
      releaseNoise: 0.6, strikePos: 0.35, lid: 0.75, tone: 0.05,
      reverbType: 'room', reverbMix: 0.2, stretch: 1.05, velCurve: 0.9, dynamics: 1.0,
    },
  },
  {
    id: 'felt',
    name: 'フェルトピアノ',
    description: 'ハンマーにフェルトを挟んだ、囁くようなローファイ音色。',
    settings: {
      brightness: 0.08, decay: 1.05, stringRes: 0.7, unison: 0.5, hammerNoise: 0.75,
      releaseNoise: 0.8, strikePos: 0.85, lid: 0.35, tone: -0.4,
      reverbType: 'studio', reverbMix: 0.35, stretch: 1.0, velCurve: 1.3, dynamics: 0.8,
    },
  },
  {
    id: 'cinematic',
    name: 'シネマティック',
    description: '大聖堂の残響と豊かな共鳴。アンビエント／劇伴向け。',
    settings: {
      brightness: 0.4, decay: 1.3, stringRes: 0.9, unison: 0.65, hammerNoise: 0.3,
      releaseNoise: 0.35, strikePos: 0.6, lid: 0.8, tone: -0.05,
      reverbType: 'church', reverbMix: 0.45, stretch: 1.1, velCurve: 1.1, dynamics: 0.9,
    },
  },
  {
    id: 'honkytonk',
    name: 'ホンキートンク',
    description: '調律の狂ったアップライト風。酒場のピアノ。',
    settings: {
      brightness: 0.75, decay: 0.7, stringRes: 0.3, unison: 1.0, hammerNoise: 0.7,
      releaseNoise: 0.7, strikePos: 0.2, lid: 0.5, tone: 0.2,
      reverbType: 'room', reverbMix: 0.14, stretch: 1.4, velCurve: 0.9, dynamics: 1.1,
    },
  },
];

export function applyPreset(base: PianoSettings, presetId: string): PianoSettings {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  return { ...DEFAULT_SETTINGS, volume: base.volume, maxVoices: base.maxVoices, ...preset.settings };
}
