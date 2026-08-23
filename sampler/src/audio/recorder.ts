/*
 * 演奏の記録と、書き出し。
 *
 * 鍵盤を弾いた通りに音符を溜めておき、あとから
 *
 *   - オフラインで一気に描き直して WAV にする（実時間を待たない）
 *   - MIDI にする（ほかのソフトへ持っていける）
 *
 * ファイルの保存そのものは6アプリ共通の shared/download.ts に任せる。
 */

export { saveBlob as downloadBlob, type SaveOutcome } from '../../../shared/download';

import { SamplerEngine, type EngineSample } from './SamplerEngine';
import type { Instrument } from './types';

export interface PerformanceEvent {
  note: number;
  velocity: number;
  /** 演奏開始からの秒 */
  time: number;
  /** 押していた長さ（秒）。離すまでは null */
  duration: number | null;
}

export class Recorder {
  events: PerformanceEvent[] = [];
  recording = false;
  private startedAt = 0;
  private lastTime = 0;
  /** まだ離されていない音。あとから長さを埋める */
  private open = new Map<number, PerformanceEvent>();

  start(now: number) {
    this.events = [];
    this.open.clear();
    this.startedAt = now;
    this.lastTime = 0;
    this.recording = true;
  }

  stop(now: number) {
    if (!this.recording) return;
    const time = Math.max(0, now - this.startedAt);
    // 押しっぱなしの音は、止めた時点で離したことにする
    for (const ev of this.open.values()) ev.duration = Math.max(0.02, time - ev.time);
    this.open.clear();
    this.lastTime = Math.max(this.lastTime, time);
    this.recording = false;
  }

  clear() {
    this.events = [];
    this.open.clear();
    this.lastTime = 0;
  }

  noteOn(note: number, velocity: number, now: number) {
    if (!this.recording) return;
    const time = Math.max(0, now - this.startedAt);
    this.lastTime = Math.max(this.lastTime, time);
    const ev: PerformanceEvent = { note, velocity, time, duration: null };
    this.events.push(ev);
    this.open.set(note, ev);
  }

  noteOff(note: number, now: number) {
    if (!this.recording) return;
    const ev = this.open.get(note);
    if (!ev) return;
    const time = Math.max(0, now - this.startedAt);
    ev.duration = Math.max(0.02, time - ev.time);
    this.lastTime = Math.max(this.lastTime, time);
    this.open.delete(note);
  }

  /**
   * 外から演奏を入れる（収録デモの読み込み）。
   * 弾いて録ったものと同じ扱いになるので、そのまま再生も書き出しもできる
   */
  load(events: PerformanceEvent[]) {
    this.recording = false;
    this.open.clear();
    this.events = events.map((ev) => ({ ...ev }));
    this.lastTime = this.events.reduce((max, ev) => Math.max(max, ev.time + (ev.duration ?? 0)), 0);
  }

  get isEmpty(): boolean {
    return this.events.length === 0;
  }

  elapsed(now: number): number {
    return this.recording ? Math.max(0, now - this.startedAt) : this.lastTime;
  }

  /** 余韻を含めた長さ */
  duration(tail = 3): number {
    if (this.events.length === 0) return 0;
    const last = this.events.reduce((max, ev) => Math.max(max, ev.time + (ev.duration ?? 0.5)), 0);
    return last + tail;
  }
}

/**
 * 記録した演奏を、実時間を待たずに描き直す。
 *
 * 端末のスピーカーへ出さずに計算だけするので、5分の曲でも数秒で終わる。
 * 鳴らしているのは実演と同じエンジンなので、聞こえた音と書き出した音が一致する。
 */
export async function renderPerformance(
  events: PerformanceEvent[],
  instrument: Instrument,
  samples: Map<string, Float32Array[]>,
  sampleRate: number,
  seconds: number
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(seconds * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  // 素材を、この文脈の AudioBuffer に載せ替える
  const buffers = new Map<string, EngineSample>();
  for (const [id, channels] of samples) {
    if (channels.length === 0 || channels[0].length === 0) continue;
    const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c);
    buffers.set(id, { buffer });
  }

  const engine = new SamplerEngine(ctx, instrument);
  engine.setBuffers(buffers);
  engine.output.connect(ctx.destination);

  for (const ev of events) {
    engine.noteOn(ev.note, ev.velocity, ev.time);
    engine.noteOff(ev.note, ev.time + (ev.duration ?? 0.5));
  }

  return ctx.startRendering();
}

/** AudioBuffer を 24bit PCM の WAV にする */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 3;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  const writeText = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let s = data[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      const v = Math.round(s * 8388607);
      bytes[offset++] = v & 0xff;
      bytes[offset++] = (v >> 8) & 0xff;
      bytes[offset++] = (v >> 16) & 0xff;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

// ------------------------------------------------------------------ MIDI

function variableLength(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

/** 記録した演奏を MIDI にする。ほかのソフトで開いて続きを作れる */
export function encodeMidi(events: PerformanceEvent[], bpm = 120): Blob {
  const ppq = 480;
  const secondsToTicks = (s: number) => Math.round((s * bpm * ppq) / 60);

  // 押した・離したを時刻順に並べ直す
  type Raw = { tick: number; on: boolean; note: number; velocity: number };
  const raw: Raw[] = [];
  for (const ev of events) {
    const note = Math.max(0, Math.min(127, Math.round(ev.note)));
    raw.push({ tick: secondsToTicks(ev.time), on: true, note, velocity: Math.max(1, Math.min(127, ev.velocity)) });
    raw.push({ tick: secondsToTicks(ev.time + (ev.duration ?? 0.5)), on: false, note, velocity: 0 });
  }
  // 同じ時刻なら、離す方を先に。同じ音を続けて弾いたとき音が消えなくなるのを防ぐ
  raw.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));

  const track: number[] = [];
  // テンポ
  const usPerBeat = Math.round(60000000 / bpm);
  track.push(0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);

  let prev = 0;
  for (const ev of raw) {
    track.push(...variableLength(Math.max(0, ev.tick - prev)));
    prev = ev.tick;
    track.push(ev.on ? 0x90 : 0x80, ev.note, ev.velocity);
  }
  track.push(0, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0, // フォーマット0（1トラック）
    0, 1,
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  const len = track.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
  ];

  return new Blob([new Uint8Array([...header, ...trackHeader, ...track])], { type: 'audio/midi' });
}

export function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}
