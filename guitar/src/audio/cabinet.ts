import type { BodyType, CabType, ReverbType } from './types';

/**
 * ボディ（胴）・キャビネット・残響を、外部のIRファイルを一切使わずに合成する。
 * すべてその場で計算するので、追加ダウンロードも著作権上の制約も発生しない。
 */

// --------------------------------------------------------------------- ボディ

interface BodyMode {
  /** 共振周波数 Hz */
  f: number;
  /** 減衰時間（秒） */
  t: number;
  /** 振幅 */
  a: number;
}

interface BodySpec {
  label: string;
  modes: BodyMode[];
  /** 拡散成分（板の高次モード）の長さ（秒） */
  airTime: number;
  airAmount: number;
  /** 低域の量感 */
  weight: number;
}

const BODIES: Record<Exclude<BodyType, 'none'>, BodySpec> = {
  dread: {
    label: 'ドレッドノート',
    // ヘルムホルツ共鳴(約100Hz)・表板・裏板・高次モード
    modes: [
      { f: 99, t: 0.20, a: 1.0 },
      { f: 196, t: 0.15, a: 0.72 },
      { f: 258, t: 0.11, a: 0.5 },
      { f: 392, t: 0.09, a: 0.42 },
      { f: 620, t: 0.07, a: 0.33 },
      { f: 1080, t: 0.05, a: 0.26 },
      { f: 1720, t: 0.04, a: 0.2 },
      { f: 2600, t: 0.03, a: 0.15 },
      { f: 3800, t: 0.02, a: 0.1 },
    ],
    airTime: 0.16,
    airAmount: 0.34,
    weight: 1.0,
  },
  parlor: {
    label: 'パーラー（小型）',
    modes: [
      { f: 126, t: 0.15, a: 0.85 },
      { f: 232, t: 0.12, a: 0.7 },
      { f: 318, t: 0.1, a: 0.55 },
      { f: 470, t: 0.08, a: 0.45 },
      { f: 780, t: 0.06, a: 0.36 },
      { f: 1350, t: 0.045, a: 0.3 },
      { f: 2100, t: 0.03, a: 0.22 },
      { f: 3300, t: 0.022, a: 0.14 },
    ],
    airTime: 0.11,
    airAmount: 0.3,
    weight: 0.72,
  },
  nylon: {
    label: 'クラシック（ナイロン）',
    modes: [
      { f: 94, t: 0.22, a: 1.0 },
      { f: 188, t: 0.17, a: 0.66 },
      { f: 385, t: 0.12, a: 0.44 },
      { f: 545, t: 0.09, a: 0.34 },
      { f: 820, t: 0.07, a: 0.24 },
      { f: 1250, t: 0.05, a: 0.16 },
      { f: 1900, t: 0.035, a: 0.1 },
    ],
    airTime: 0.14,
    airAmount: 0.28,
    weight: 0.95,
  },
  archtop: {
    label: 'アーチトップ',
    modes: [
      { f: 132, t: 0.13, a: 0.8 },
      { f: 240, t: 0.1, a: 0.62 },
      { f: 350, t: 0.085, a: 0.5 },
      { f: 560, t: 0.06, a: 0.38 },
      { f: 900, t: 0.045, a: 0.26 },
      { f: 1500, t: 0.03, a: 0.18 },
      { f: 2400, t: 0.02, a: 0.1 },
    ],
    airTime: 0.1,
    airAmount: 0.22,
    weight: 0.8,
  },
  resonator: {
    label: 'リゾネーター（金属）',
    modes: [
      { f: 148, t: 0.1, a: 0.6 },
      { f: 320, t: 0.12, a: 0.7 },
      { f: 640, t: 0.14, a: 0.8 },
      { f: 980, t: 0.12, a: 0.7 },
      { f: 1550, t: 0.1, a: 0.6 },
      { f: 2350, t: 0.08, a: 0.45 },
      { f: 3500, t: 0.06, a: 0.3 },
      { f: 5000, t: 0.04, a: 0.2 },
    ],
    airTime: 0.09,
    airAmount: 0.18,
    weight: 0.6,
  },
};

export function bodyLabel(type: BodyType): string {
  return type === 'none' ? 'なし（エレキ）' : BODIES[type].label;
}

/**
 * ボディのインパルス応答を作る。
 * 減衰する正弦波（＝共振モード）の和 + 拡散成分。
 * 左右でモード周波数をわずかにずらし、自然な広がりを作る。
 */
export function createBodyImpulse(ctx: BaseAudioContext, type: Exclude<BodyType, 'none'>): AudioBuffer {
  const spec = BODIES[type];
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * (spec.airTime + 0.06)));
  const buffer = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const detune = ch === 0 ? 1 : 1.006;

    // 直接音（マイクに直接届く成分）
    data[0] = 0.85;

    for (const mode of spec.modes) {
      const f = mode.f * detune;
      const w = (2 * Math.PI * f) / rate;
      const decay = Math.exp(-1 / (mode.t * rate));
      const phase = ch === 0 ? 0 : 0.35;
      let env = mode.a * spec.weight;
      for (let i = 0; i < length; i++) {
        data[i] += Math.sin(w * i + phase) * env * 0.28;
        env *= decay;
        if (env < 1e-6) break;
      }
    }

    // 高次モードの集まり（板の拡散的な鳴り）
    const airLen = Math.floor(spec.airTime * rate);
    let lp = 0;
    for (let i = 0; i < airLen && i < length; i++) {
      const t = i / airLen;
      lp += (Math.random() * 2 - 1 - lp) * 0.4;
      data[i] += lp * spec.airAmount * Math.pow(1 - t, 3);
    }
  }

  normalize(buffer, 0.9);
  return buffer;
}

// ----------------------------------------------------------------- キャビネット

export interface CabBand {
  type: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
}

export interface CabSpec {
  label: string;
  bands: CabBand[];
}

/**
 * スピーカーキャビネットの周波数特性。
 * 実機のキャビは「低域の共振・中域のクセ・5kHz付近からの急峻な落ち込み」で
 * 特徴づけられるので、その3点をフィルタの組み合わせで再現する。
 */
export const CABS: Record<Exclude<CabType, 'off'>, CabSpec> = {
  combo1x12: {
    label: '1x12 コンボ',
    bands: [
      { type: 'highpass', freq: 85, q: 0.8, gain: 0 },
      { type: 'peaking', freq: 120, q: 1.6, gain: 4.5 },
      { type: 'peaking', freq: 400, q: 1.1, gain: -4 },
      { type: 'peaking', freq: 1900, q: 1.3, gain: 3.5 },
      { type: 'peaking', freq: 3600, q: 2.2, gain: 3 },
      { type: 'lowpass', freq: 5200, q: 1.1, gain: 0 },
      { type: 'lowpass', freq: 6200, q: 0.6, gain: 0 },
    ],
  },
  twin2x12: {
    label: '2x12 ツイン',
    bands: [
      { type: 'highpass', freq: 78, q: 0.8, gain: 0 },
      { type: 'peaking', freq: 105, q: 1.4, gain: 4 },
      { type: 'peaking', freq: 500, q: 1.0, gain: -3 },
      { type: 'peaking', freq: 2400, q: 1.4, gain: 4 },
      { type: 'peaking', freq: 4200, q: 2.5, gain: 2 },
      { type: 'lowpass', freq: 6000, q: 1.0, gain: 0 },
      { type: 'lowpass', freq: 7500, q: 0.6, gain: 0 },
    ],
  },
  stack4x12: {
    label: '4x12 スタック',
    bands: [
      { type: 'highpass', freq: 70, q: 0.9, gain: 0 },
      { type: 'peaking', freq: 95, q: 1.8, gain: 6 },
      { type: 'peaking', freq: 330, q: 1.0, gain: -5.5 },
      { type: 'peaking', freq: 1600, q: 1.5, gain: 4.5 },
      { type: 'peaking', freq: 3100, q: 2.6, gain: 3.5 },
      { type: 'lowpass', freq: 4400, q: 1.2, gain: 0 },
      { type: 'lowpass', freq: 5200, q: 0.7, gain: 0 },
    ],
  },
  bass8x10: {
    label: '8x10 ベースキャビ',
    bands: [
      { type: 'highpass', freq: 38, q: 0.7, gain: 0 },
      { type: 'peaking', freq: 68, q: 1.2, gain: 5 },
      { type: 'peaking', freq: 260, q: 1.0, gain: -3 },
      { type: 'peaking', freq: 900, q: 1.2, gain: 2.5 },
      { type: 'lowpass', freq: 3600, q: 1.0, gain: 0 },
      { type: 'lowpass', freq: 5000, q: 0.6, gain: 0 },
    ],
  },
};

// --------------------------------------------------------------------- 残響

interface RoomSpec {
  label: string;
  seconds: number;
  decay: number;
  preDelay: number;
  damping: number;
  earlyCount: number;
  /** スプリングリバーブ特有の分散（チャープ） */
  spring?: boolean;
}

export const ROOMS: Record<Exclude<ReverbType, 'off'>, RoomSpec> = {
  room: { label: 'ルーム', seconds: 0.9, decay: 2.6, preDelay: 7, damping: 0.55, earlyCount: 10 },
  plate: { label: 'プレート', seconds: 1.8, decay: 2.0, preDelay: 4, damping: 0.22, earlyCount: 22 },
  spring: { label: 'スプリング', seconds: 1.5, decay: 2.4, preDelay: 3, damping: 0.4, earlyCount: 7, spring: true },
  hall: { label: 'ホール', seconds: 2.8, decay: 1.9, preDelay: 24, damping: 0.32, earlyCount: 16 },
};

/**
 * 残響のインパルス応答。
 * スプリングだけは「バネの分散でインパルスがチャープになる」性質を持つので、
 * 反射ごとに周波数が下降するチャープを置いて、あの独特の響きを作る。
 */
export function createReverbImpulse(
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
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.pow(1 - t, spec.decay);
      const coef = 0.85 - spec.damping * 0.75 * t;
      lp += (Math.random() * 2 - 1 - lp) * Math.max(0.04, coef);
      data[i] = lp * env;
    }

    if (spec.spring) {
      // バネを伝わる波は高域ほど速いので、反射のたびに下降チャープになる
      const jitter = ch === 0 ? 1 : 1.09;
      for (let e = 0; e < 9; e++) {
        const start = preDelay + Math.floor(rate * 0.031 * (e + 1) * jitter);
        if (start >= length) break;
        const chirpLen = Math.floor(rate * 0.05);
        const amp = 0.62 / (1 + e * 0.85);
        let phase = 0;
        for (let i = 0; i < chirpLen && start + i < length; i++) {
          const u = i / chirpLen;
          const f = 2400 * Math.pow(0.12, u);
          phase += (2 * Math.PI * f) / rate;
          data[start + i] += Math.sin(phase) * amp * Math.pow(1 - u, 1.6);
        }
      }
    } else {
      // 初期反射（左右で位置をずらして広がりを作る）
      const jitter = ch === 0 ? 1 : 1.17;
      for (let e = 0; e < spec.earlyCount; e++) {
        const pos =
          preDelay + Math.floor(rate * (0.004 + 0.011 * e * jitter + Math.random() * 0.004));
        if (pos >= length) break;
        data[pos] += (0.62 / (1 + e * 0.75)) * (Math.random() > 0.5 ? 1 : -1);
      }
    }
  }

  normalize(buffer, 0.72);
  return buffer;
}

function normalize(buffer: AudioBuffer, target: number) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak <= 0) return;
  const gain = target / peak;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}

// ------------------------------------------------------------------- 歪みカーブ

/**
 * 歪みの伝達曲線。種類ごとに「潰れ方」を変える。
 * 非対称にすることで偶数次倍音が出て、真空管らしい太さが出る。
 */
export function driveCurve(kind: 'boost' | 'overdrive' | 'distortion' | 'fuzz', amount: number) {
  const n = 4096;
  const curve = new Float32Array(n);
  const k = 1 + amount * amount * 60;

  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    switch (kind) {
      case 'boost':
        // ごく浅いソフトクリップ（音量を持ち上げて頭を丸める）
        y = Math.tanh(x * (1 + amount * 3));
        break;
      case 'overdrive': {
        // 非対称ソフトクリップ：チューブアンプ風
        const bias = 0.12 * amount;
        const xa = x + bias;
        y = Math.tanh(xa * (1 + amount * 8)) - Math.tanh(bias * (1 + amount * 8));
        break;
      }
      case 'distortion': {
        // ハードめのクリップに、少しだけ丸みを持たせる
        const d = x * (1 + amount * 18);
        y = d / (1 + Math.abs(d));
        y = Math.sign(y) * Math.pow(Math.abs(y), 0.78);
        break;
      }
      case 'fuzz': {
        // ほぼ矩形波までいく、荒いクリップ
        const d = x * k;
        y = (2 / Math.PI) * Math.atan(d * 3);
        y = y * 0.75 + Math.sign(y) * Math.pow(Math.abs(y), 4) * 0.25;
        break;
      }
    }
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

/** 最終段のリミッター（クリップの代わりに柔らかく頭打ちさせる） */
export function limiterCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3);
  }
  return curve;
}
