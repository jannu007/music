import type { MasterSettings, TrackConfig, VoiceParams } from './types';

/** トラックの並び（音源の構成そのもの。パターンやキットはこの id を参照する） */
interface TrackSpec {
  id: string;
  name: string;
  short: string;
  type: TrackConfig['type'];
  variant: TrackConfig['variant'];
  choke: number;
  midi: number;
  params: VoiceParams;
}

const p = (
  level: number,
  pan: number,
  tune: number,
  decay: number,
  tone: number,
  snap: number,
  drive: number,
  reverb: number,
  delay = 0
): VoiceParams => ({ level, pan, tune, decay, tone, snap, drive, reverb, delay });

export const TRACK_SPECS: TrackSpec[] = [
  { id: 'kick', name: 'キック', short: 'BD', type: 'kick', variant: 'default', choke: 0, midi: 36,
    params: p(1.05, 0, 0, 0.55, 0.34, 0.34, 0.24, 0.03) },
  { id: 'snare', name: 'スネア', short: 'SD', type: 'snare', variant: 'default', choke: 0, midi: 38,
    params: p(0.86, 0, 0, 0.5, 0.44, 0.58, 0.18, 0.14) },
  { id: 'clap', name: 'クラップ', short: 'CP', type: 'clap', variant: 'default', choke: 0, midi: 39,
    params: p(0.7, 0.1, 0, 0.45, 0.5, 0.6, 0.08, 0.22) },
  { id: 'rim', name: 'リムショット', short: 'RS', type: 'rim', variant: 'default', choke: 0, midi: 37,
    params: p(0.62, -0.16, 0, 0.4, 0.5, 0.4, 0.05, 0.12) },
  { id: 'ch', name: 'クローズドハット', short: 'CH', type: 'hat', variant: 'closed', choke: 1, midi: 42,
    params: p(0.6, 0.14, 0, 0.35, 0.5, 0.4, 0.04, 0.05) },
  { id: 'oh', name: 'オープンハット', short: 'OH', type: 'hat', variant: 'open', choke: 1, midi: 46,
    params: p(0.55, 0.14, 0, 0.35, 0.5, 0.4, 0.04, 0.14) },
  { id: 'tom1', name: 'ロータム', short: 'LT', type: 'tom', variant: 'default', choke: 0, midi: 41,
    params: p(0.82, -0.34, -5, 0.5, 0.4, 0.3, 0.12, 0.16) },
  { id: 'tom2', name: 'ミドルタム', short: 'MT', type: 'tom', variant: 'default', choke: 0, midi: 45,
    params: p(0.8, 0, 0, 0.46, 0.42, 0.3, 0.12, 0.16) },
  { id: 'tom3', name: 'ハイタム', short: 'HT', type: 'tom', variant: 'default', choke: 0, midi: 48,
    params: p(0.78, 0.32, 5, 0.42, 0.45, 0.3, 0.12, 0.16) },
  { id: 'ride', name: 'ライド', short: 'RD', type: 'cymbal', variant: 'ride', choke: 0, midi: 51,
    params: p(0.46, 0.26, 0, 0.42, 0.45, 0.35, 0.02, 0.18) },
  { id: 'crash', name: 'クラッシュ', short: 'CR', type: 'cymbal', variant: 'crash', choke: 0, midi: 49,
    params: p(0.44, -0.3, 0, 0.5, 0.5, 0.6, 0.02, 0.26) },
  { id: 'cowbell', name: 'カウベル', short: 'CB', type: 'cowbell', variant: 'default', choke: 0, midi: 56,
    params: p(0.42, -0.2, 0, 0.4, 0.4, 0.3, 0.06, 0.1) },
  { id: 'shaker', name: 'シェイカー', short: 'SK', type: 'shaker', variant: 'default', choke: 0, midi: 70,
    params: p(0.5, 0.32, 0, 0.4, 0.5, 0.6, 0.02, 0.1) },
  { id: 'perc', name: 'パーカッション', short: 'PC', type: 'perc', variant: 'default', choke: 0, midi: 64,
    params: p(0.62, -0.32, 0, 0.4, 0.5, 0.5, 0.06, 0.16) },
];

export const TRACK_IDS = TRACK_SPECS.map((t) => t.id);

export interface Kit {
  id: string;
  name: string;
  desc: string;
  /** 既定パラメータからの差分だけを持つ */
  tweaks: Record<string, Partial<VoiceParams>>;
  master?: Partial<MasterSettings>;
}

/**
 * キット＝14トラック分の音づくりのプリセット。
 * 実在の機種名は使わず、音のキャラクターで名付けている。
 */
export const KITS: Kit[] = [
  {
    id: 'analog',
    name: 'クラシック・アナログ',
    desc: '長く伸びる正弦波のキックと金属的なハット。80年代のリズムマシン的な響き',
    tweaks: {},
    master: { drive: 0.18, glue: 0.32, reverbType: 'room', reverbMix: 0.2 },
  },
  {
    id: 'punch',
    name: 'パンチ・マシン',
    desc: '短くタイトに詰めた、抜けの良いダンス系キット',
    tweaks: {
      kick: { decay: 0.34, tone: 0.5, snap: 0.5, drive: 0.4, level: 1.1 },
      snare: { decay: 0.34, tone: 0.55, snap: 0.72, drive: 0.3 },
      clap: { decay: 0.3, tone: 0.6, snap: 0.75 },
      ch: { decay: 0.22, tone: 0.68 },
      oh: { decay: 0.28, tone: 0.62 },
      ride: { decay: 0.34, tone: 0.6 },
      crash: { decay: 0.42, tone: 0.6 },
      tom1: { decay: 0.36, snap: 0.42 },
      tom2: { decay: 0.34, snap: 0.42 },
      tom3: { decay: 0.32, snap: 0.42 },
    },
    master: { drive: 0.22, glue: 0.45, reverbType: 'room', reverbMix: 0.14, high: 1.5 },
  },
  {
    id: 'acoustic',
    name: 'アコースティック',
    desc: '胴鳴りとノイズ成分を多めにした、生ドラムに寄せたキット',
    tweaks: {
      kick: { tune: 2, decay: 0.4, tone: 0.42, snap: 0.55, drive: 0.12 },
      snare: { tune: 1, decay: 0.44, tone: 0.5, snap: 0.85, drive: 0.1, reverb: 0.24 },
      rim: { snap: 0.6, reverb: 0.2 },
      ch: { tone: 0.58, snap: 0.62, decay: 0.3 },
      oh: { tone: 0.55, snap: 0.7, decay: 0.42, reverb: 0.22 },
      tom1: { tune: -7, decay: 0.62, snap: 0.5, reverb: 0.26 },
      tom2: { tune: -2, decay: 0.58, snap: 0.5, reverb: 0.26 },
      tom3: { tune: 4, decay: 0.52, snap: 0.5, reverb: 0.26 },
      ride: { decay: 0.6, tone: 0.5, snap: 0.5, reverb: 0.26 },
      crash: { decay: 0.66, snap: 0.75, reverb: 0.34 },
      perc: { snap: 0.65, reverb: 0.24 },
    },
    master: { drive: 0.1, glue: 0.3, reverbType: 'hall', reverbMix: 0.3 },
  },
  {
    id: 'lofi',
    name: 'ローファイ・ヒップホップ',
    desc: '角を落とした丸い音。少し歪んだキックと控えめなハット',
    tweaks: {
      kick: { tune: -3, decay: 0.5, tone: 0.2, snap: 0.25, drive: 0.5, level: 1.1 },
      snare: { tune: -2, decay: 0.42, tone: 0.28, snap: 0.5, drive: 0.35 },
      rim: { tone: 0.32, level: 0.55 },
      ch: { tone: 0.28, decay: 0.26, level: 0.5 },
      oh: { tone: 0.3, decay: 0.4, level: 0.46 },
      ride: { tone: 0.3, level: 0.4 },
      crash: { tone: 0.32, level: 0.38 },
      shaker: { tone: 0.32, level: 0.42 },
      perc: { tone: 0.35 },
    },
    master: { drive: 0.34, glue: 0.46, low: 2, high: -3.5, reverbType: 'room', reverbMix: 0.26 },
  },
  {
    id: 'techno',
    name: 'テクノ・インダストリアル',
    desc: '歪ませたキックと硬い金物。空間を広くとったハードな音',
    tweaks: {
      kick: { tune: -1, decay: 0.42, tone: 0.45, snap: 0.45, drive: 0.75, level: 1.15 },
      snare: { decay: 0.36, tone: 0.6, snap: 0.7, drive: 0.5, reverb: 0.3 },
      clap: { decay: 0.4, tone: 0.62, reverb: 0.35 },
      rim: { tone: 0.62, reverb: 0.3 },
      ch: { tone: 0.72, decay: 0.2, drive: 0.2 },
      oh: { tone: 0.68, decay: 0.34, reverb: 0.28 },
      ride: { tone: 0.62, reverb: 0.3 },
      crash: { tone: 0.62, decay: 0.6, reverb: 0.4 },
      cowbell: { tone: 0.6, reverb: 0.28 },
      perc: { tune: 5, tone: 0.6, reverb: 0.32 },
    },
    master: { drive: 0.32, glue: 0.5, low: 1.5, reverbType: 'cavern', reverbMix: 0.3, delayDivision: '1/8', delayMix: 0.16, delayFeedback: 0.35 },
  },
  {
    id: 'house',
    name: 'ハウス',
    desc: '四つ打ち向け。深めのキックと粒立ちの良いハット・クラップ',
    tweaks: {
      kick: { tune: -2, decay: 0.46, tone: 0.36, snap: 0.4, drive: 0.35, level: 1.12 },
      snare: { decay: 0.36, tone: 0.5, snap: 0.68 },
      clap: { decay: 0.42, tone: 0.55, snap: 0.7, reverb: 0.3, level: 0.78 },
      ch: { decay: 0.24, tone: 0.62, level: 0.58 },
      oh: { decay: 0.42, tone: 0.58, level: 0.56, reverb: 0.2 },
      shaker: { level: 0.52, tone: 0.56 },
      ride: { decay: 0.5, tone: 0.55 },
      perc: { tune: 3, reverb: 0.24 },
    },
    master: { drive: 0.2, glue: 0.42, low: 1, reverbType: 'plate', reverbMix: 0.24 },
  },
  {
    id: 'trap',
    name: 'トラップ',
    desc: '長く沈むサブベース級のキックと、細かく刻める短いハット',
    tweaks: {
      kick: { tune: -7, decay: 1.15, tone: 0.22, snap: 0.3, drive: 0.3, level: 1.15 },
      snare: { tune: 3, decay: 0.32, tone: 0.6, snap: 0.72 },
      clap: { decay: 0.32, tone: 0.62, snap: 0.7, level: 0.8 },
      rim: { tone: 0.6, level: 0.55 },
      ch: { decay: 0.14, tone: 0.7, level: 0.5 },
      oh: { decay: 0.22, tone: 0.66, level: 0.48 },
      tom1: { tune: -9, decay: 0.7 },
      cowbell: { tone: 0.55, level: 0.38 },
      shaker: { decay: 0.24, tone: 0.6 },
    },
    master: { drive: 0.24, glue: 0.4, low: 2.5, high: 1, reverbType: 'room', reverbMix: 0.16 },
  },
  {
    id: 'ambient',
    name: 'アンビエント',
    desc: '柔らかいアタックと長い余韻。静かな曲やIDM向け',
    tweaks: {
      kick: { decay: 0.7, tone: 0.18, snap: 0.15, drive: 0.08, level: 0.9, reverb: 0.2 },
      snare: { decay: 0.6, tone: 0.35, snap: 0.5, level: 0.7, reverb: 0.4 },
      clap: { decay: 0.6, tone: 0.4, level: 0.55, reverb: 0.45 },
      rim: { decay: 0.5, level: 0.5, reverb: 0.4 },
      ch: { decay: 0.3, tone: 0.4, level: 0.44, reverb: 0.2 },
      oh: { decay: 0.6, tone: 0.4, level: 0.44, reverb: 0.4 },
      tom1: { decay: 0.8, reverb: 0.4 },
      tom2: { decay: 0.75, reverb: 0.4 },
      tom3: { decay: 0.7, reverb: 0.4 },
      ride: { decay: 0.8, tone: 0.4, reverb: 0.42 },
      crash: { decay: 0.9, tone: 0.42, reverb: 0.5 },
      shaker: { decay: 0.5, level: 0.42, reverb: 0.3 },
      perc: { decay: 0.6, reverb: 0.4 },
    },
    master: { drive: 0.08, glue: 0.25, high: -1, reverbType: 'hall', reverbMix: 0.42, delayDivision: '1/8.', delayMix: 0.22, delayFeedback: 0.42 },
  },
];

export function findKit(id: string): Kit {
  return KITS.find((k) => k.id === id) ?? KITS[0];
}

/** キットを適用した14トラックを作る */
export function createTracks(kitId: string): TrackConfig[] {
  const kit = findKit(kitId);
  return TRACK_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    short: spec.short,
    type: spec.type,
    variant: spec.variant,
    choke: spec.choke,
    midi: spec.midi,
    params: { ...spec.params, ...(kit.tweaks[spec.id] ?? {}) },
    mute: false,
    solo: false,
  }));
}

/** ミュート・ソロを保ったままキットだけ差し替える */
export function applyKit(tracks: TrackConfig[], kitId: string): TrackConfig[] {
  const next = createTracks(kitId);
  for (const track of next) {
    const prev = tracks.find((t) => t.id === track.id);
    if (prev) {
      track.mute = prev.mute;
      track.solo = prev.solo;
    }
  }
  return next;
}
