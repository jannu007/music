/*
 * 付属音源をその場で合成する。
 *
 * サンプラーなのに録音素材を1つも持たないのは、意図的なつくり。
 * 第三者の録音を同梱すると、その使用許諾がアプリの販売条件に縛りをかける。
 * ここで鳴っている音はすべてこのファイルの計算から出ているので、
 * **付属音源も、それで作った曲も、そのまま商用利用できる**。
 *
 * 音づくりの方針
 *
 *   撥弦・打弦 … Karplus-Strong（弦の往復をディレイで模す）
 *   打楽器     … 帯域を絞った雑音と、急に落ちる正弦波
 *   持続音     … 倍音を重ねたうえで、非整数比のうなりを混ぜる
 *
 * どれも1音ずつ AudioBuffer に書き出して、ふつうの素材として扱う。
 * 合成した瞬間から、取り込んだ音と区別なく編集できる。
 */

import type { Instrument, SampleMeta, Zone } from './types';
import { DEFAULT_ENVELOPE, DEFAULT_FILTER, DEFAULT_FX, DEFAULT_LFO, midiToFreq, noteName } from './types';

/** 決まった順番の疑似乱数。同じ音源が毎回まったく同じに鳴るようにする */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/** なめらかに 0→1→0 する窓。切れ目のプツッという音を消す */
function fadeEdges(data: Float32Array, rate: number, inSec: number, outSec: number) {
  const inN = Math.min(data.length, Math.floor(rate * inSec));
  const outN = Math.min(data.length - inN, Math.floor(rate * outSec));
  for (let i = 0; i < inN; i++) data[i] *= i / inN;
  for (let i = 0; i < outN; i++) {
    const k = data.length - outN + i;
    data[k] *= 1 - i / outN;
  }
}

function normalize(channels: Float32Array[], target = 0.89) {
  let peak = 0;
  for (const ch of channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-6) return;
  const g = target / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

// ------------------------------------------------------------------ 音の作り方

/**
 * 弦。短いディレイに雑音を入れて往復させると弦になる（Karplus-Strong）。
 * 減衰の速さを周波数で変えて、高い音ほど早く消えるようにしている。
 */
function pluck(
  freq: number,
  rate: number,
  seconds: number,
  opts: { bright: number; sustain: number; seed: number }
): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const rnd = makeRandom(opts.seed);
  const period = rate / freq;
  const size = Math.max(2, Math.floor(period));
  const frac = period - size;
  const buf = new Float32Array(size);

  // 撥（はじき）の瞬間。明るさで雑音の高域の量を変える
  let last = 0;
  for (let i = 0; i < size; i++) {
    const noise = rnd() * 2 - 1;
    last = last + (noise - last) * (0.25 + opts.bright * 0.7);
    buf[i] = last;
  }

  // 減衰の速さ。
  //
  // 弦の値は「1周期に1回」書き戻されるので、1周期あたりどれだけ減るかで決まる。
  // ここを勘で置くと、周波数によって鳴る長さがばらばらになる。そこで
  // 「-60dB まで何秒か（T60）」から逆算する。弾いた感じが音域を通してそろう。
  //
  // 高い音ほど自然に早く消えるので、T60 自体も周波数で少し縮める。
  const t60 = opts.sustain * Math.pow(freq / 220, -0.6);
  const periodsToSilence = Math.max(1, freq * t60);
  const loss = Math.pow(10, -3 / periodsToSilence);
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const next = buf[(idx + 1) % size];
    // 小数ぶんの位置を補間して、音程のずれを無くす
    const v = cur + (next - cur) * frac;
    out[i] = v;
    // 平均を取ると高域から落ちる。弦が丸くなっていく理由がこれ
    const filtered = (v + prev) * 0.5 * loss;
    prev = v;
    buf[idx] = filtered;
    idx = (idx + 1) % size;
  }
  fadeEdges(out, rate, 0.0005, 0.02);
  return out;
}

/** 倍音を重ねた持続音。倍音ごとに少しずらして、機械的にならないようにする */
function harmonicPad(
  freq: number,
  rate: number,
  seconds: number,
  opts: { partials: number; tilt: number; detune: number; odd: boolean; seed: number }
): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const rnd = makeRandom(opts.seed);
  for (let h = 1; h <= opts.partials; h++) {
    if (opts.odd && h % 2 === 0) continue;
    const f = freq * h * (1 + (rnd() * 2 - 1) * opts.detune);
    if (f > rate * 0.45) break;
    const amp = Math.pow(h, -opts.tilt);
    const phase = rnd() * Math.PI * 2;
    // 倍音ごとに違う速さで揺らすと、合わさったときに「うねり」になる
    const beat = 0.15 + rnd() * 0.5;
    const w = (2 * Math.PI * f) / rate;
    for (let i = 0; i < n; i++) {
      const env = 1 + 0.12 * Math.sin((2 * Math.PI * beat * i) / rate + phase);
      out[i] += Math.sin(w * i + phase) * amp * env;
    }
  }
  fadeEdges(out, rate, 0.02, 0.05);
  return out;
}

/** 打楽器の胴。急に下がる正弦波（キックやタムの芯） */
function drumBody(freq: number, rate: number, seconds: number, drop: number, decay: number): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = freq * (1 + drop * Math.exp(-t * 28));
    phase += (2 * Math.PI * f) / rate;
    out[i] = Math.sin(phase) * Math.exp(-t * decay);
  }
  fadeEdges(out, rate, 0.0004, 0.01);
  return out;
}

/** 帯域を絞った雑音。スネアの「ざらつき」やハイハットに使う */
function filteredNoise(
  rate: number,
  seconds: number,
  opts: { lo: number; hi: number; decay: number; seed: number }
): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const rnd = makeRandom(opts.seed);
  // 1極ずつの高域通過と低域通過を重ねて帯域にする
  const aLo = Math.exp((-2 * Math.PI * opts.lo) / rate);
  const aHi = Math.exp((-2 * Math.PI * opts.hi) / rate);
  let lp = 0;
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const white = rnd() * 2 - 1;
    lp = white * (1 - aHi) + lp * aHi;
    hp = lp * (1 - aLo) + hp * aLo;
    out[i] = (lp - hp) * Math.exp((-i / rate) * opts.decay);
  }
  fadeEdges(out, rate, 0.0003, 0.006);
  return out;
}

/** 金属。非整数比の正弦波を重ねると、音程の定まらない金物になる */
function metallic(base: number, rate: number, seconds: number, seed: number): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const rnd = makeRandom(seed);
  const ratios = [1, 1.41, 1.93, 2.71, 3.42, 4.37, 5.61, 7.13];
  for (const r of ratios) {
    const f = base * r * (0.98 + rnd() * 0.04);
    if (f > rate * 0.45) continue;
    const w = (2 * Math.PI * f) / rate;
    const decay = 3 + rnd() * 5;
    const phase = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) out[i] += Math.sin(w * i + phase) * Math.exp((-i / rate) * decay);
  }
  fadeEdges(out, rate, 0.0005, 0.02);
  return out;
}

// ------------------------------------------------------------------ 付属音源

/** どの鍵盤ぶんを作るか。全音は作らず、間は再生速度で埋める */
interface FactorySpec {
  id: string;
  /** 表示名は i18n のキー。strings.ts に ja/en を持つ */
  keys: number[];
  seconds: (midi: number) => number;
  /** その音程ぶんの波形を作る */
  render: (midi: number, rate: number, seconds: number) => Float32Array[];
  /** ループさせるか（持続音のみ） */
  loop?: boolean;
  tweak?: Partial<Instrument>;
}

const PLUCK_KEYS = [36, 43, 48, 55, 60, 67, 72, 79, 84];
const PAD_KEYS = [36, 48, 60, 72, 84];

export const FACTORY_SPECS: FactorySpec[] = [
  {
    // 木の胴を持つ撥弦。指ではじいた琴のような音
    id: 'kotoStrings',
    keys: PLUCK_KEYS,
    seconds: (m) => (m < 55 ? 2.8 : 1.9),
    render: (midi, rate, seconds) => {
      return [pluck(midiToFreq(midi), rate, seconds, { bright: 0.55, sustain: 2.0, seed: 1000 + midi })];
    },
  },
  {
    // 金属弦。硬く、伸びる
    id: 'steelHarp',
    tweak: { fx: { ...DEFAULT_FX, width: 1.2, reverbMix: 0.18 } },
    keys: PLUCK_KEYS,
    seconds: (m) => (m < 55 ? 3.4 : 2.3),
    render: (midi, rate, seconds) => {
      return [pluck(midiToFreq(midi), rate, seconds, { bright: 0.85, sustain: 3.4, seed: 2000 + midi })];
    },
  },
  {
    // やわらかい持続音。倍音のうねりで動きを出している
    id: 'mistPad',
    keys: PAD_KEYS,
    seconds: () => 2.6,
    loop: true,
    render: (midi, rate, seconds) => {
      return [
        harmonicPad(midiToFreq(midi), rate, seconds, {
          partials: 18,
          tilt: 1.35,
          detune: 0.004,
          odd: false,
          seed: 3000 + midi,
        }),
      ];
    },
    tweak: {
      amp: { attack: 0.5, decay: 1.2, sustain: 0.9, release: 1.4 },
      // 素材はモノラル。広がりはここで付ける（波形を2本持つより軽い）
      fx: { ...DEFAULT_FX, width: 1.45, reverbMix: 0.22 },
    },
  },
  {
    // 奇数倍音だけの持続音。クラリネットのような、芯のある太さ
    id: 'hollowReed',
    keys: PAD_KEYS,
    seconds: () => 2.2,
    loop: true,
    render: (midi, rate, seconds) => {
      return [
        harmonicPad(midiToFreq(midi), rate, seconds, {
          partials: 15,
          tilt: 1.1,
          detune: 0.002,
          odd: true,
          seed: 4000 + midi,
        }),
      ];
    },
    tweak: {
      amp: { attack: 0.06, decay: 0.4, sustain: 0.92, release: 0.35 },
      fx: { ...DEFAULT_FX, width: 1.15 },
    },
  },
  {
    // 金物。音程が定まらないので、鍵盤で音色が変わっていく
    id: 'bellField',
    tweak: { fx: { ...DEFAULT_FX, width: 1.35, reverbMix: 0.26 } },
    keys: [48, 60, 72],
    seconds: () => 2.8,
    render: (midi, rate, seconds) => {
      return [metallic(midiToFreq(midi), rate, seconds, 5000 + midi)];
    },
  },
];

/** ドラムキットだけは鍵盤ごとに別の音を割り当てる（音程ではなく音色の地図） */
interface DrumSlot {
  key: number;
  id: string;
  render: (rate: number) => Float32Array[];
}

const DRUM_SLOTS: DrumSlot[] = [
  {
    key: 36,
    id: 'kick',
    render: (rate) => {
      const body = drumBody(52, rate, 0.9, 2.2, 9);
      const click = filteredNoise(rate, 0.03, { lo: 1200, hi: 6000, decay: 180, seed: 11 });
      const out = new Float32Array(body.length);
      for (let i = 0; i < out.length; i++) out[i] = body[i] + (click[i] ?? 0) * 0.35;
      return [out];
    },
  },
  {
    key: 38,
    id: 'snare',
    render: (rate) => {
      const body = drumBody(185, rate, 0.4, 0.35, 26);
      const rattle = filteredNoise(rate, 0.4, { lo: 180, hi: 8500, decay: 16, seed: 12 });
      const out = new Float32Array(body.length);
      for (let i = 0; i < out.length; i++) out[i] = body[i] * 0.55 + rattle[i] * 0.8;
      return [out];
    },
  },
  {
    key: 40,
    id: 'rim',
    render: (rate) => {
      const out = filteredNoise(rate, 0.12, { lo: 900, hi: 9000, decay: 60, seed: 13 });
      return [out];
    },
  },
  {
    key: 42,
    id: 'hatClosed',
    render: (rate) => {
      const out = metallic(340, rate, 0.14, 14);
      return [out];
    },
  },
  {
    key: 46,
    id: 'hatOpen',
    render: (rate) => {
      const out = metallic(340, rate, 0.85, 15);
      return [out];
    },
  },
  {
    key: 45,
    id: 'tomLow',
    render: (rate) => {
      const out = drumBody(110, rate, 0.7, 0.9, 11);
      return [out];
    },
  },
  {
    key: 48,
    id: 'tomHigh',
    render: (rate) => {
      const out = drumBody(190, rate, 0.55, 0.9, 13);
      return [out];
    },
  },
  {
    key: 49,
    id: 'crash',
    render: (rate) => {
      const metal = metallic(180, rate, 2.4, 16);
      const air = filteredNoise(rate, 2.4, { lo: 2500, hi: 14000, decay: 2.4, seed: 17 });
      const out = new Float32Array(metal.length);
      for (let i = 0; i < out.length; i++) out[i] = metal[i] * 0.7 + air[i] * 0.5;
      return [out];
    },
  },
];

// ------------------------------------------------------------------ 組み立て

export interface FactoryBuild {
  instrument: Instrument;
  samples: { meta: SampleMeta; channels: Float32Array[] }[];
}

function baseInstrument(id: string): Instrument {
  return {
    id,
    name: id,
    zones: [],
    amp: { ...DEFAULT_ENVELOPE },
    filter: { ...DEFAULT_FILTER, env: { ...DEFAULT_FILTER.env } },
    lfo: { ...DEFAULT_LFO },
    fx: { ...DEFAULT_FX },
    polyphony: 32,
    velToVolume: 0.75,
    velToFilter: 1.2,
    glide: 0,
    mono: false,
    gainDb: 0,
    transpose: 0,
  };
}

/** ある鍵盤ぶんの素材が、どこからどこまでを担当するかを決める */
function keyRanges(keys: number[]): { lo: number; hi: number; root: number }[] {
  const sorted = [...keys].sort((a, b) => a - b);
  return sorted.map((root, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    // 隣との中間で区切る。両端は鍵盤の端まで引き伸ばす
    const lo = prev === undefined ? 0 : Math.floor((prev + root) / 2) + 1;
    const hi = next === undefined ? 127 : Math.floor((root + next) / 2);
    return { lo, hi, root };
  });
}

let zoneCounter = 0;
function zoneId(): string {
  zoneCounter++;
  return `z${zoneCounter.toString(36)}`;
}

function makeZone(sampleId: string, over: Partial<Zone>): Zone {
  return {
    id: zoneId(),
    sampleId,
    loKey: 0,
    hiKey: 127,
    loVel: 1,
    hiVel: 127,
    rootKey: 60,
    tuneSemis: 0,
    tuneCents: 0,
    gainDb: 0,
    pan: 0,
    start: 0,
    end: 1,
    loop: false,
    loopStart: 0.35,
    loopEnd: 0.95,
    group: 0,
    reverse: false,
    ...over,
  };
}

/**
 * 付属音源をひととおり合成する。
 *
 * 端末の CPU で走るので、鍵盤ぶんを全部作るのではなく数音だけ作り、
 * 間は再生速度で埋める。合成そのものは 6アプリと同じ考え方で、
 * 録音素材はひとつも使っていない。
 */
export function buildFactory(sampleRate: number, only?: string): FactoryBuild[] {
  const builds: FactoryBuild[] = [];

  for (const spec of FACTORY_SPECS) {
    if (only && spec.id !== only) continue;
    const inst = baseInstrument(spec.id);
    if (spec.tweak) Object.assign(inst, spec.tweak);
    const samples: FactoryBuild['samples'] = [];
    const ranges = keyRanges(spec.keys);

    for (const range of ranges) {
      const seconds = spec.seconds(range.root);
      const channels = spec.render(range.root, sampleRate, seconds);
      normalize(channels);
      const sampleId = `${spec.id}-${range.root}`;
      samples.push({
        meta: {
          id: sampleId,
          // 画面に出る名前。どの音域ぶんかが分かればよい
          name: noteName(range.root),
          sampleRate,
          frames: channels[0].length,
          channels: channels.length,
          origin: 'factory',
        },
        channels,
      });
      inst.zones.push(
        makeZone(sampleId, {
          loKey: range.lo,
          hiKey: range.hi,
          rootKey: range.root,
          loop: spec.loop ?? false,
          // 持続音は後ろ半分をループさせる。頭のうねりは残しておきたい
          loopStart: 0.45,
          loopEnd: 0.98,
        })
      );
    }
    builds.push({ instrument: inst, samples });
  }

  // ドラムキット
  if (!only || only === 'drumField') {
    const inst = baseInstrument('drumField');
    inst.amp = { attack: 0.0005, decay: 0.6, sustain: 1, release: 0.12 };
    inst.velToVolume = 0.9;
    inst.filter = { ...DEFAULT_FILTER, keyTrack: 0, env: { ...DEFAULT_FILTER.env } };
    const samples: FactoryBuild['samples'] = [];
    for (const slot of DRUM_SLOTS) {
      const channels = slot.render(sampleRate);
      normalize(channels, 0.85);
      // id の頭は必ず音源の id にする。ここがずれると、保存した楽器を
      // 開き直したときに「どの音源の素材か」を辿れなくなる
      const sampleId = `drumField-${slot.id}`;
      samples.push({
        meta: {
          id: sampleId,
          // 打楽器は id をそのまま名前にし、表示のときに訳す（strings.ts）
          name: slot.id,
          sampleRate,
          frames: channels[0].length,
          channels: channels.length,
          origin: 'factory',
        },
        channels,
      });
      // 打楽器は音程を動かさない。1鍵に1音だけ置く
      inst.zones.push(makeZone(sampleId, { loKey: slot.key, hiKey: slot.key, rootKey: slot.key }));
    }
    builds.push({ instrument: inst, samples });
  }

  return builds;
}

/** 付属音源の id 一覧（表示名は i18n 側が持つ） */
export const FACTORY_IDS = [...FACTORY_SPECS.map((s) => s.id), 'drumField'];
