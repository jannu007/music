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
  label: string;
}

export const ROOMS: Record<Exclude<ReverbType, 'off'>, RoomSpec> = {
  room: { seconds: 0.9, decay: 2.6, preDelay: 6, damping: 0.55, earlyCount: 9, label: 'ルーム' },
  studio: { seconds: 1.5, decay: 2.2, preDelay: 12, damping: 0.42, earlyCount: 12, label: 'スタジオ' },
  hall: { seconds: 2.6, decay: 1.9, preDelay: 22, damping: 0.32, earlyCount: 16, label: 'コンサートホール' },
  church: { seconds: 4.6, decay: 1.5, preDelay: 38, damping: 0.24, earlyCount: 20, label: '教会' },
};

/**
 * ステレオのインパルス応答を生成する。
 * 指数減衰ノイズ + 初期反射 + 時間とともに暗くなる1極ローパスで、
 * 外部のIRファイルを一切使わずに自然な残響を作る。
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
    for (let i = 0; i < length; i++) {
      if (i < preDelay) continue;
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.pow(1 - t, spec.decay);
      // 時間経過とともに高域が減るようカットオフを下げる
      const coef = 0.85 - spec.damping * 0.75 * t;
      lp += ((Math.random() * 2 - 1) - lp) * Math.max(0.04, coef);
      data[i] = lp * env;
    }

    // 初期反射（左右で位置をずらして広がりを作る）
    for (let e = 0; e < spec.earlyCount; e++) {
      const jitter = ch === 0 ? 1 : 1.17;
      const pos = preDelay + Math.floor(rate * (0.004 + 0.011 * e * jitter + Math.random() * 0.004));
      if (pos >= length) break;
      const g = (0.62 / (1 + e * 0.75)) * (Math.random() > 0.5 ? 1 : -1);
      data[pos] += g;
    }

    // 正規化
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const norm = 0.72 / peak;
      for (let i = 0; i < length; i++) data[i] *= norm;
    }
  }

  return buffer;
}
