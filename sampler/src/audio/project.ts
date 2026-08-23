/*
 * 保存と読み込み。
 *
 * 読み込むファイルは**利用者が別の端末から持ってきたもの**でありうるので、
 * 中身をひとつも信用せずに組み立て直す。JSON.parse の結果をそのまま
 * 設定オブジェクトとして使うと、次の2つが起きる。
 *
 *   1. 想定外の型（文字列の周波数、負のループ長）でエンジンが壊れる
 *   2. __proto__ や constructor を含むデータで、他のオブジェクトの
 *      ふるまいまで書き換えられてしまう（プロトタイプ汚染）
 *
 * そこで decode 側は「既定値から始めて、認めた項目だけを、範囲を確かめて
 * 上書きする」という書き方だけで通している。知らない項目は捨てる。
 */

import type {
  DistortionType,
  Envelope,
  FilterMode,
  FilterSettings,
  FxSettings,
  Instrument,
  LfoSettings,
  ModMode,
  ReverbType,
  Zone,
} from './types';
import { DEFAULT_ENVELOPE, DEFAULT_FILTER, DEFAULT_FX, DEFAULT_LFO } from './types';

export const PROJECT_APP = 'yamabiko-sampler';
export const PROJECT_VERSION = 1;

/** 危ない鍵。取り込むデータからは必ず外す */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** そのままでは触らせない。認めた鍵だけを持つ素のオブジェクトに写し替える */
function plain(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value as object)) {
    if (FORBIDDEN.has(key)) continue;
    out[key] = (value as Record<string, unknown>)[key];
  }
  return out;
}

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function int(value: unknown, fallback: number, lo: number, hi: number): number {
  return Math.round(num(value, fallback, lo, hi));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** 表示にもファイル名にも使うので、長さと文字種を絞る */
function text(value: unknown, fallback: string, max = 60): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : fallback;
}

/** id は参照に使うだけなので、安全な文字だけに限る */
function id(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned || fallback;
}

const DIST_TYPES = ['off', 'soft', 'hard', 'fuzz'] as const satisfies readonly DistortionType[];
const FILTER_MODES = ['off', 'lowpass', 'highpass', 'bandpass'] as const satisfies readonly FilterMode[];
const MOD_MODES = ['off', 'tremolo', 'autopan'] as const satisfies readonly ModMode[];
const REVERBS = ['off', 'room', 'plate', 'hall', 'cavern'] as const satisfies readonly ReverbType[];

function decodeEnvelope(raw: unknown, fallback: Envelope): Envelope {
  const e = plain(raw);
  return {
    attack: num(e.attack, fallback.attack, 0, 10),
    decay: num(e.decay, fallback.decay, 0.001, 20),
    sustain: num(e.sustain, fallback.sustain, 0, 1),
    release: num(e.release, fallback.release, 0.001, 20),
  };
}

function decodeFilter(raw: unknown): FilterSettings {
  const f = plain(raw);
  return {
    mode: pick(f.mode, FILTER_MODES, DEFAULT_FILTER.mode),
    freq: num(f.freq, DEFAULT_FILTER.freq, 20, 20000),
    q: num(f.q, DEFAULT_FILTER.q, 0.05, 24),
    keyTrack: num(f.keyTrack, DEFAULT_FILTER.keyTrack, 0, 2),
    envAmount: num(f.envAmount, DEFAULT_FILTER.envAmount, -6, 6),
    env: decodeEnvelope(f.env, DEFAULT_FILTER.env),
  };
}

function decodeLfo(raw: unknown): LfoSettings {
  const l = plain(raw);
  return {
    rate: num(l.rate, DEFAULT_LFO.rate, 0.01, 40),
    toPitch: num(l.toPitch, DEFAULT_LFO.toPitch, -1200, 1200),
    toFilter: num(l.toFilter, DEFAULT_LFO.toFilter, -4, 4),
    toAmp: num(l.toAmp, DEFAULT_LFO.toAmp, 0, 1),
    delay: num(l.delay, DEFAULT_LFO.delay, 0, 5),
  };
}

function decodeFx(raw: unknown): FxSettings {
  const f = plain(raw);
  const d = DEFAULT_FX;
  return {
    distType: pick(f.distType, DIST_TYPES, d.distType),
    distAmount: num(f.distAmount, d.distAmount, 0, 1),
    distTone: num(f.distTone, d.distTone, 0, 1),
    distMix: num(f.distMix, d.distMix, 0, 1),

    crushBits: num(f.crushBits, d.crushBits, 1, 16),
    crushMix: num(f.crushMix, d.crushMix, 0, 1),

    filterMode: pick(f.filterMode, FILTER_MODES, d.filterMode),
    filterFreq: num(f.filterFreq, d.filterFreq, 20, 20000),
    filterQ: num(f.filterQ, d.filterQ, 0.05, 24),
    filterRate: num(f.filterRate, d.filterRate, 0.01, 20),
    filterDepth: num(f.filterDepth, d.filterDepth, 0, 1),

    chorusOn: bool(f.chorusOn, d.chorusOn),
    chorusRate: num(f.chorusRate, d.chorusRate, 0.01, 10),
    chorusDepth: num(f.chorusDepth, d.chorusDepth, 0, 1),
    chorusMix: num(f.chorusMix, d.chorusMix, 0, 1),

    flangerOn: bool(f.flangerOn, d.flangerOn),
    flangerRate: num(f.flangerRate, d.flangerRate, 0.01, 10),
    flangerDepth: num(f.flangerDepth, d.flangerDepth, 0, 1),
    flangerFeedback: num(f.flangerFeedback, d.flangerFeedback, 0, 0.95),
    flangerMix: num(f.flangerMix, d.flangerMix, 0, 1),

    phaserOn: bool(f.phaserOn, d.phaserOn),
    phaserRate: num(f.phaserRate, d.phaserRate, 0.01, 10),
    phaserDepth: num(f.phaserDepth, d.phaserDepth, 0, 1),
    phaserFeedback: num(f.phaserFeedback, d.phaserFeedback, 0, 0.95),
    phaserMix: num(f.phaserMix, d.phaserMix, 0, 1),

    ringOn: bool(f.ringOn, d.ringOn),
    ringFreq: num(f.ringFreq, d.ringFreq, 1, 8000),
    ringMix: num(f.ringMix, d.ringMix, 0, 1),

    modMode: pick(f.modMode, MOD_MODES, d.modMode),
    modRate: num(f.modRate, d.modRate, 0.01, 30),
    modDepth: num(f.modDepth, d.modDepth, 0, 1),

    width: num(f.width, d.width, 0, 2),

    delayTime: num(f.delayTime, d.delayTime, 0.01, 2.5),
    delayFeedback: num(f.delayFeedback, d.delayFeedback, 0, 0.9),
    delayMix: num(f.delayMix, d.delayMix, 0, 1),
    delayPingPong: bool(f.delayPingPong, d.delayPingPong),

    reverbType: pick(f.reverbType, REVERBS, d.reverbType),
    reverbMix: num(f.reverbMix, d.reverbMix, 0, 1),
  };
}

function decodeZone(raw: unknown, index: number): Zone | null {
  const z = plain(raw);
  const sampleId = id(z.sampleId, '');
  if (!sampleId) return null; // 素材を指していないゾーンは意味がない

  // 範囲は必ず lo <= hi にそろえる。逆に入っていても壊れないようにする
  const a = int(z.loKey, 0, 0, 127);
  const b = int(z.hiKey, 127, 0, 127);
  const v1 = int(z.loVel, 1, 1, 127);
  const v2 = int(z.hiVel, 127, 1, 127);
  const start = num(z.start, 0, 0, 1);
  const end = num(z.end, 1, 0, 1);
  const ls = num(z.loopStart, 0.35, 0, 1);
  const le = num(z.loopEnd, 0.95, 0, 1);

  return {
    id: id(z.id, `z${index}`),
    sampleId,
    loKey: Math.min(a, b),
    hiKey: Math.max(a, b),
    loVel: Math.min(v1, v2),
    hiVel: Math.max(v1, v2),
    rootKey: int(z.rootKey, 60, 0, 127),
    tuneSemis: int(z.tuneSemis, 0, -48, 48),
    tuneCents: num(z.tuneCents, 0, -100, 100),
    gainDb: num(z.gainDb, 0, -60, 12),
    pan: num(z.pan, 0, -1, 1),
    start: Math.min(start, end),
    end: Math.max(start, end),
    loop: bool(z.loop, false),
    loopStart: Math.min(ls, le),
    loopEnd: Math.max(ls, le),
    group: int(z.group, 0, 0, 31),
    reverse: bool(z.reverse, false),
  };
}

/** ゾーンの上限。1つの楽器に無制限に持たせない（画面も端末も持たない） */
export const MAX_ZONES = 256;

export function decodeInstrument(raw: unknown): Instrument {
  const i = plain(raw);
  const zonesRaw = Array.isArray(i.zones) ? i.zones.slice(0, MAX_ZONES) : [];
  const zones = zonesRaw
    .map((z, index) => decodeZone(z, index))
    .filter((z): z is Zone => z !== null);

  return {
    id: id(i.id, 'instrument'),
    name: text(i.name, 'Instrument'),
    zones,
    amp: decodeEnvelope(i.amp, DEFAULT_ENVELOPE),
    filter: decodeFilter(i.filter),
    lfo: decodeLfo(i.lfo),
    fx: decodeFx(i.fx),
    polyphony: int(i.polyphony, 32, 1, 64),
    velToVolume: num(i.velToVolume, 0.75, 0, 1),
    velToFilter: num(i.velToFilter, 1.2, 0, 6),
    glide: num(i.glide, 0, 0, 2),
    mono: bool(i.mono, false),
    gainDb: num(i.gainDb, 0, -60, 12),
    transpose: int(i.transpose, 0, -24, 24),
  };
}

export function encodeInstrument(inst: Instrument): Instrument {
  // 書き出しは decode を通したものだけにする。
  // 画面の操作で変な値が入っていても、保存の時点で正される
  return decodeInstrument(inst);
}

export interface ProjectFile {
  app: string;
  version: number;
  instrument: Instrument;
  /** 同梱する素材。付属音源は合成し直せるので含めない */
  samples: { id: string; name: string; sampleRate: number; channels: number; data: string }[];
}

/** 保存データを読む。形が違えば null を返す（例外は投げない） */
export function decodeProjectFile(raw: unknown): { instrument: Instrument; samples: ProjectFile['samples'] } | null {
  const p = plain(raw);
  if (p.app !== PROJECT_APP) return null;
  if (!p.instrument) return null;
  const samplesRaw = Array.isArray(p.samples) ? p.samples.slice(0, MAX_ZONES) : [];
  const samples = samplesRaw
    .map((s) => {
      const o = plain(s);
      const sid = id(o.id, '');
      const data = typeof o.data === 'string' ? o.data : '';
      if (!sid || !data) return null;
      // base64 として妥当な文字だけか。ここで弾けば復号でつまずかない
      if (!/^[A-Za-z0-9+/=]*$/.test(data)) return null;
      return {
        id: sid,
        name: text(o.name, sid),
        sampleRate: int(o.sampleRate, 48000, 8000, 192000),
        channels: int(o.channels, 1, 1, 2),
        data,
      };
    })
    .filter((s): s is ProjectFile['samples'][number] => s !== null);

  return { instrument: decodeInstrument(p.instrument), samples };
}

/** ファイル名に使えない文字を落とす */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'instrument';
}
