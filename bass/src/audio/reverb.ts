import type { CabType, ReverbType } from './types';

interface RoomSpec {
  seconds: number;
  decay: number;
  preDelay: number;
  damping: number;
  earlyCount: number;
  label: string;
}

export const ROOMS: Record<Exclude<ReverbType, 'off'>, RoomSpec> = {
  room: { seconds: 0.7, decay: 2.8, preDelay: 5, damping: 0.62, earlyCount: 8, label: 'ルーム' },
  studio: { seconds: 1.2, decay: 2.4, preDelay: 10, damping: 0.5, earlyCount: 11, label: 'スタジオ' },
  hall: { seconds: 2.2, decay: 2.0, preDelay: 20, damping: 0.38, earlyCount: 15, label: 'ホール' },
};

/**
 * ステレオのインパルス応答をその場で生成する（IRファイルのダウンロードは無し）。
 * ベースは低域が飽和しやすいので、残響側の低域は落としてある。
 */
export function createImpulseResponse(
  ctx: BaseAudioContext,
  type: Exclude<ReverbType, 'off'>
): AudioBuffer {
  const spec = ROOMS[type];
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * spec.seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor((spec.preDelay / 1000) * rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    let hp = 0;
    for (let i = 0; i < length; i++) {
      if (i < preDelay) continue;
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.pow(1 - t, spec.decay);
      const coef = 0.85 - spec.damping * 0.75 * t;
      lp += ((Math.random() * 2 - 1) - lp) * Math.max(0.04, coef);
      // 低域を抜いて、ベースの芯を残響で濁らせない
      hp += (lp - hp) * 0.012;
      data[i] = (lp - hp) * env;
    }

    for (let e = 0; e < spec.earlyCount; e++) {
      const jitter = ch === 0 ? 1 : 1.19;
      const pos = preDelay + Math.floor(rate * (0.003 + 0.009 * e * jitter + Math.random() * 0.003));
      if (pos >= length) break;
      const g = (0.55 / (1 + e * 0.8)) * (Math.random() > 0.5 ? 1 : -1);
      data[pos] += g;
    }

    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const norm = 0.7 / peak;
      for (let i = 0; i < length; i++) data[i] *= norm;
    }
  }

  return buffer;
}

export interface CabSpec {
  label: string;
  hint: string;
  /** 低域の下限（Hz） */
  highpass: number;
  /** 高域の上限（Hz） */
  lowpass: number;
  /** スピーカーの共振（Hz / dB / Q） */
  bump: { freq: number; gain: number; q: number };
  /** 中域の癖 */
  mid: { freq: number; gain: number; q: number };
  /** 抜けの良さ */
  presence: { freq: number; gain: number; q: number };
}

/**
 * キャビネットの周波数特性。
 * 実機のスピーカーは「低域の共振」「中域のディップ」「高域の急落」でできているので、
 * 3つのピーキングと2つのフィルターで十分それらしくなる。
 */
export const CABS: Record<CabType, CabSpec> = {
  di: {
    label: 'DI（ライン）',
    hint: 'キャビネットを通さない素の音。宅録・打ち込み向き',
    highpass: 28, lowpass: 9000,
    bump: { freq: 70, gain: 0, q: 0.7 },
    mid: { freq: 700, gain: 0, q: 1 },
    presence: { freq: 3200, gain: 0, q: 0.8 },
  },
  '1x15': {
    label: '1×15"',
    hint: '大口径1発。丸くて太い、モータウン系の音',
    highpass: 42, lowpass: 2600,
    bump: { freq: 78, gain: 4.5, q: 1.1 },
    mid: { freq: 520, gain: -3.5, q: 1.0 },
    presence: { freq: 1800, gain: -2.0, q: 0.9 },
  },
  '4x10': {
    label: '4×10"',
    hint: '万能。芯があって抜けが良い、いちばん使いやすい',
    highpass: 50, lowpass: 4800,
    bump: { freq: 92, gain: 3.0, q: 1.0 },
    mid: { freq: 800, gain: -2.0, q: 0.9 },
    presence: { freq: 2600, gain: 3.0, q: 0.8 },
  },
  '8x10': {
    label: '8×10"',
    hint: '定番の巨大キャビ。低域の圧と歪みの相性が良い',
    highpass: 55, lowpass: 3600,
    bump: { freq: 84, gain: 5.0, q: 1.2 },
    mid: { freq: 420, gain: -4.0, q: 1.1 },
    presence: { freq: 2000, gain: 1.5, q: 0.9 },
  },
};
