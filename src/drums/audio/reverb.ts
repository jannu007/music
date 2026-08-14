import type { ReverbType } from './types';

interface RoomSpec {
  /** 残響長（秒） */
  seconds: number;
  /** 減衰カーブの鋭さ */
  decay: number;
  /** プリディレイ（ms） */
  preDelay: number;
  /** 高域の減衰しやすさ 0..1（大きいほど暗い） */
  damping: number;
  /** 初期反射の本数 */
  earlyCount: number;
  /** 初期反射の間隔（秒） */
  earlyGap: number;
  label: string;
}

export const ROOMS: Record<Exclude<ReverbType, 'off'>, RoomSpec> = {
  room: { seconds: 0.7, decay: 3.0, preDelay: 4, damping: 0.6, earlyCount: 8, earlyGap: 0.009, label: 'ルーム' },
  plate: { seconds: 1.6, decay: 2.4, preDelay: 8, damping: 0.28, earlyCount: 14, earlyGap: 0.005, label: 'プレート' },
  hall: { seconds: 2.8, decay: 1.9, preDelay: 24, damping: 0.34, earlyCount: 16, earlyGap: 0.013, label: 'ホール' },
  cavern: { seconds: 4.8, decay: 1.4, preDelay: 45, damping: 0.5, earlyCount: 20, earlyGap: 0.021, label: 'カヴァーン' },
};

/**
 * ステレオのインパルス応答をその場で生成する（外部の IR ファイルは使わない）。
 * 指数減衰ノイズ + 初期反射 + 時間とともに暗くなる1極ローパス。
 * プレートだけは初期反射を密にして、金属板らしい隙間のない響きにしている。
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
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / Math.max(1, length - preDelay);
      const env = Math.pow(1 - t, spec.decay);
      const coef = 0.85 - spec.damping * 0.75 * t;
      lp += (Math.random() * 2 - 1 - lp) * Math.max(0.04, coef);
      data[i] = lp * env;
    }

    for (let e = 0; e < spec.earlyCount; e++) {
      const jitter = ch === 0 ? 1 : 1.19;
      const pos =
        preDelay + Math.floor(rate * (0.003 + spec.earlyGap * e * jitter + Math.random() * 0.003));
      if (pos >= length) break;
      const g = (0.6 / (1 + e * 0.7)) * (Math.random() > 0.5 ? 1 : -1);
      data[pos] += g;
    }

    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const norm = 0.72 / peak;
      for (let i = 0; i < length; i++) data[i] *= norm;
    }
  }

  return buffer;
}
