/*
 * 声のプリセット（ボイスバンク）
 *
 * 収録音声ではなく「声帯と声道のパラメータ一式」なので、1 人分が数十バイトで済む。
 * 実在の人物の声を模したものではなく、すべて数式上の架空の声。
 */

import { DEFAULT_CHARACTER, DEFAULT_EXPRESSION, type Expression, type VoiceCharacter } from './types';

export interface VoicePreset {
  id: string;
  /** 表示名 */
  name: string;
  /** 一言説明 */
  description: string;
  character: VoiceCharacter;
  /** この声に合う歌い方の調整 */
  expression: Partial<Expression>;
  /** 得意音域（MIDI ノート） */
  range: [number, number];
}

function character(patch: Partial<VoiceCharacter>): VoiceCharacter {
  return { ...DEFAULT_CHARACTER, ...patch };
}

export const VOICES: VoicePreset[] = [
  {
    id: 'yoi',
    name: '宵（よい）',
    description: '透明感のある女性ポップ・ボーカル。まっすぐ伸びる中高音。',
    character: character({ tract: 1.16, center: 69, brightness: 0.15, breath: 0.3, tension: 0.5, nasality: 0.14, body: 0.42 }),
    expression: { vibDepth: 32, vibRate: 5.5, portamento: 65 },
    range: [57, 81],
  },
  {
    id: 'mio',
    name: '澪（みお）',
    description: 'クラシック寄りの女性ソプラノ。深いビブラートとレガート。',
    character: character({ tract: 1.24, center: 72, brightness: -0.05, breath: 0.16, tension: 0.62, nasality: 0.1, body: 0.5 }),
    expression: { vibDepth: 52, vibRate: 5.8, vibDelay: 0.28, portamento: 95, scoop: 0.18, dynamics: 0.75 },
    range: [60, 86],
  },
  {
    id: 'akari',
    name: '燈（あかり）',
    description: '明るく前に出るキュートな声。アップテンポの曲に。',
    character: character({ tract: 1.28, center: 71, brightness: 0.35, breath: 0.24, tension: 0.6, nasality: 0.3, body: 0.32 }),
    expression: { vibDepth: 28, vibRate: 6.2, vibDelay: 0.42, portamento: 45, scoop: 0.35, consonant: 0.9 },
    range: [59, 84],
  },
  {
    id: 'nagi',
    name: '凪（なぎ）',
    description: '中性的なウィスパー・ボイス。息成分が多く、静かな曲に合う。',
    character: character({ tract: 1.09, center: 65, brightness: 0.05, breath: 0.62, tension: 0.32, nasality: 0.18, body: 0.3 }),
    expression: { vibDepth: 20, vibRate: 5.0, portamento: 85, scoop: 0.15, dynamics: 0.45, breathNoise: 0.62 },
    range: [53, 77],
  },
  {
    id: 'sou',
    name: '蒼（そう）',
    description: '素直な男性テノール。合唱にもポップスにも。',
    character: character({ tract: 1.0, center: 60, brightness: 0.1, breath: 0.26, tension: 0.52, nasality: 0.12, body: 0.55 }),
    expression: { vibDepth: 34, vibRate: 5.2, portamento: 70 },
    range: [45, 69],
  },
  {
    id: 'riku',
    name: '陸（りく）',
    description: '少しハスキーな男性ポップ。語尾のエッジが効く。',
    character: character({ tract: 0.97, center: 57, brightness: 0.22, breath: 0.42, tension: 0.66, nasality: 0.14, growl: 0.22, body: 0.5 }),
    expression: { vibDepth: 26, vibRate: 5.0, vibDelay: 0.45, portamento: 55, scoop: 0.4, consonant: 1.1 },
    range: [43, 67],
  },
  {
    id: 'hibiki',
    name: '響（ひびき）',
    description: '太く低い男性バリトン。コーラスの土台に。',
    character: character({ tract: 0.9, center: 52, brightness: -0.15, breath: 0.2, tension: 0.45, nasality: 0.1, body: 0.72 }),
    expression: { vibDepth: 30, vibRate: 4.8, portamento: 90, dynamics: 0.5 },
    range: [38, 62],
  },
  {
    id: 'kotori',
    name: '小鳥（ことり）',
    description: '子どもらしい高くて軽い声。童謡や合いの手に。',
    character: character({ tract: 1.36, center: 74, brightness: 0.3, breath: 0.34, tension: 0.55, nasality: 0.24, body: 0.24 }),
    expression: { vibDepth: 22, vibRate: 6.0, vibDelay: 0.5, portamento: 40, scoop: 0.3, consonant: 0.95 },
    range: [62, 88],
  },
];

export const DEFAULT_VOICE = VOICES[0];

export function findVoice(id: string): VoicePreset {
  return VOICES.find((v) => v.id === id) ?? DEFAULT_VOICE;
}

/** プリセットの声色と歌い方を取り出す */
export function voiceDefaults(id: string): { character: VoiceCharacter; expression: Expression } {
  const preset = findVoice(id);
  return {
    character: { ...preset.character },
    expression: { ...DEFAULT_EXPRESSION, ...preset.expression },
  };
}
