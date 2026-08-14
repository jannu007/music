/*
 * 残響（インパルス応答をその場で生成する）
 *
 * IR ファイルを配布すると権利関係が発生するので、すべて計算で作る。
 * 歌に合わせて、初期反射が細かくプレート系の残響も用意した。
 */

import type { ReverbType } from './types';

interface RoomSpec {
  /** 残響長 秒 */
  seconds: number;
  /** 減衰カーブの鋭さ */
  decay: number;
  /** プリディレイ ms */
  preDelay: number;
  /** 高域の減衰しやすさ 0..1 */
  damping: number;
  /** 初期反射の本数 */
  earlyCount: number;
  /** 初期反射の密度（大きいほど詰まる） */
  density: number;
  label: string;
}

export const ROOMS: Record<Exclude<ReverbType, 'off'>, RoomSpec> = {
  room: { seconds: 0.8, decay: 2.8, preDelay: 5, damping: 0.55, earlyCount: 10, density: 1.6, label: 'ルーム' },
  plate: { seconds: 1.9, decay: 2.0, preDelay: 8, damping: 0.28, earlyCount: 26, density: 3.4, label: 'プレート' },
  hall: { seconds: 2.9, decay: 1.85, preDelay: 24, damping: 0.34, earlyCount: 16, density: 1.2, label: 'ホール' },
  church: { seconds: 4.8, decay: 1.5, preDelay: 40, damping: 0.24, earlyCount: 20, density: 0.9, label: '大聖堂' },
};

export const ROOM_LABEL: Record<ReverbType, string> = {
  off: 'なし',
  room: ROOMS.room.label,
  plate: ROOMS.plate.label,
  hall: ROOMS.hall.label,
  church: ROOMS.church.label,
};

/** 疑似乱数（同じ残響を毎回作るため、Math.random は使わない） */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/** ステレオのインパルス応答を作る */
export function createImpulseResponse(
  ctx: BaseAudioContext,
  type: Exclude<ReverbType, 'off'>
): AudioBuffer {
  const spec = ROOMS[type];
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * spec.seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor((spec.preDelay / 1000) * rate);
  const random = rng(0x51ed2701);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / Math.max(1, length - preDelay);
      const env = Math.pow(1 - t, spec.decay);
      const coef = 0.86 - spec.damping * 0.76 * t;
      lp += ((random() * 2 - 1) - lp) * Math.max(0.04, coef);
      data[i] = lp * env;
    }

    // 初期反射（左右でずらして広がりを作る）
    for (let e = 0; e < spec.earlyCount; e++) {
      const jitter = ch === 0 ? 1 : 1.19;
      const pos =
        preDelay +
        Math.floor(rate * ((0.003 + 0.009 * e * jitter) / spec.density + random() * 0.003));
      if (pos >= length) break;
      const g = (0.6 / (1 + e * 0.7)) * (random() > 0.5 ? 1 : -1);
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
