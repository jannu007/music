import type { GuitarEngine } from './GuitarEngine';
import type { PerformanceEvent, PerformanceEventInput } from './types';

/** 演奏の録音（音声ではなくイベントを記録するので、後から音色を変えて書き出せる） */
export class Recorder {
  events: PerformanceEvent[] = [];
  recording = false;
  private startedAt = 0;
  private lastTime = 0;

  start(now: number) {
    this.events = [];
    this.startedAt = now;
    this.lastTime = 0;
    this.recording = true;
  }

  stop(now: number) {
    if (!this.recording) return;
    this.lastTime = Math.max(this.lastTime, now - this.startedAt);
    this.recording = false;
  }

  clear() {
    this.events = [];
    this.lastTime = 0;
  }

  capture(ev: PerformanceEventInput, now: number) {
    if (!this.recording) return;
    const time = Math.max(0, now - this.startedAt);
    this.lastTime = Math.max(this.lastTime, time);
    this.events.push({ ...ev, time } as PerformanceEvent);
  }

  get isEmpty() {
    return this.events.length === 0;
  }

  /** 録音開始からの経過秒 */
  elapsed(now: number): number {
    return this.recording ? Math.max(0, now - this.startedAt) : this.lastTime;
  }

  /** 末尾の余韻を含めた長さ（秒） */
  duration(tail = 3.5): number {
    if (this.events.length === 0) return 0;
    return this.lastTime + tail;
  }
}

/** イベント列を先読みスケジュールで再生する */
export class Player {
  private timer: number | null = null;
  private engine: GuitarEngine;
  private events: PerformanceEvent[] = [];
  private index = 0;
  private startTime = 0;
  private endTime = 0;
  private rate = 1;
  playing = false;
  onProgress: ((elapsed: number, total: number) => void) | null = null;
  onEnd: (() => void) | null = null;
  onEvent: ((ev: PerformanceEvent) => void) | null = null;

  constructor(engine: GuitarEngine) {
    this.engine = engine;
  }

  play(events: PerformanceEvent[], tail = 3, rate = 1) {
    this.stop();
    if (events.length === 0) return;
    this.events = [...events].sort((a, b) => a.time - b.time);
    this.index = 0;
    this.rate = rate;
    this.startTime = this.engine.now + 0.12;
    this.endTime = this.startTime + this.events[this.events.length - 1].time / rate + tail;
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 40);
  }

  private tick() {
    const now = this.engine.now;
    const horizon = now + 0.25;
    while (this.index < this.events.length) {
      const ev = this.events[this.index];
      const at = this.startTime + ev.time / this.rate;
      if (at > horizon) break;
      this.engine.schedule(ev, at);
      if (this.onEvent) {
        const delay = Math.max(0, (at - now) * 1000);
        window.setTimeout(() => this.onEvent?.(ev), delay);
      }
      this.index++;
    }
    const total = this.endTime - this.startTime;
    this.onProgress?.(Math.min(total, Math.max(0, now - this.startTime)), total);
    if (now >= this.endTime) {
      this.stop();
      this.onEnd?.();
    }
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.playing) {
      this.playing = false;
      this.engine.panic();
    }
  }
}

// --------------------------------------------------------------------- WAV

/** AudioBuffer を 24bit PCM の WAV に変換する */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 3;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
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
      view.setUint8(offset++, v & 0xff);
      view.setUint8(offset++, (v >> 8) & 0xff);
      view.setUint8(offset++, (v >> 16) & 0xff);
    }
  }

  return new Blob([view.buffer], { type: 'audio/wav' });
}

// -------------------------------------------------------------------- MIDI

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

/**
 * 演奏イベントを標準MIDIファイル（フォーマット0）にする。
 * 弦とフレットの組み合わせを実音に直し、同じ弦の次の音で前の音を止める
 * （実際のギターと同じ挙動）ことでノートの重なりを防ぐ。
 */
export function encodeMidi(
  events: PerformanceEvent[],
  tuning: number[],
  capo: number,
  bpm = 100,
  program = 25
): Blob {
  const ppq = 480;
  const secondsPerTick = 60 / bpm / ppq;
  const sorted = [...events].sort((a, b) => a.time - b.time);

  interface Msg { time: number; data: number[] }
  const messages: Msg[] = [];
  const ringing = new Map<number, number>(); // 弦 -> 鳴っているノート

  const noteOff = (string: number, time: number) => {
    const note = ringing.get(string);
    if (note === undefined) return;
    messages.push({ time, data: [0x80, note & 0x7f, 0x40] });
    ringing.delete(string);
  };

  for (const ev of sorted) {
    switch (ev.type) {
      case 'pluck': {
        noteOff(ev.string, ev.time);
        if (ev.fret < 0) break; // ブラッシングは音程が無いので書き出さない
        const note = clampNote(tuning[ev.string] + ev.fret + capo);
        messages.push({
          time: ev.time,
          data: [0x90, note, Math.max(1, Math.round(ev.vel * 127)) & 0x7f],
        });
        ringing.set(ev.string, note);
        break;
      }
      case 'fret': {
        const prev = ringing.get(ev.string);
        if (prev === undefined) break;
        noteOff(ev.string, ev.time);
        const note = clampNote(tuning[ev.string] + Math.max(0, ev.fret) + capo);
        messages.push({ time: ev.time, data: [0x90, note, ev.vel ? Math.round(ev.vel * 127) : 72] });
        ringing.set(ev.string, note);
        break;
      }
      case 'bend': {
        // ピッチベンドはチャンネル単位なので、±2半音レンジとして近似する
        const value = Math.round(8192 + (ev.amount / 2) * 8191);
        const v = Math.max(0, Math.min(16383, value));
        messages.push({ time: ev.time, data: [0xe0, v & 0x7f, (v >> 7) & 0x7f] });
        break;
      }
      case 'damp':
        noteOff(ev.string, ev.time);
        break;
      case 'dampAll':
        for (const string of [...ringing.keys()]) noteOff(string, ev.time);
        break;
      default:
        break;
    }
  }
  const endTime = sorted.length > 0 ? sorted[sorted.length - 1].time + 1 : 1;
  for (const string of [...ringing.keys()]) noteOff(string, endTime);

  messages.sort((a, b) => a.time - b.time);

  const track: number[] = [];
  const usPerQuarter = Math.round(60000000 / bpm);
  track.push(
    0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );
  track.push(0x00, 0xc0, program & 0x7f);

  let lastTick = 0;
  for (const msg of messages) {
    const tick = Math.round(msg.time / secondsPerTick);
    const delta = Math.max(0, tick - lastTick);
    lastTick = tick;
    track.push(...variableLength(delta), ...msg.data);
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0, // format 0
    0, 1, // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  const len = track.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
  ];

  return new Blob([new Uint8Array([...header, ...trackHeader, ...track])], {
    type: 'audio/midi',
  });
}

function clampNote(n: number): number {
  return Math.max(0, Math.min(127, Math.round(n)));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}
