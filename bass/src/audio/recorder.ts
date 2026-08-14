import type { BassEngine } from './BassEngine';
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
  duration(tail = 3): number {
    if (this.events.length === 0) return 0;
    return this.lastTime + tail;
  }
}

/** イベント列を先読みスケジュールで再生する */
export class Player {
  private timer: number | null = null;
  private engine: BassEngine;
  private events: PerformanceEvent[] = [];
  private index = 0;
  private startTime = 0;
  private endTime = 0;
  private rate = 1;
  playing = false;
  onProgress: ((elapsed: number, total: number) => void) | null = null;
  onEnd: (() => void) | null = null;
  onEvent: ((ev: PerformanceEvent) => void) | null = null;

  constructor(engine: BassEngine) {
    this.engine = engine;
  }

  play(events: PerformanceEvent[], tail = 2.5, rate = 1) {
    this.stop();
    if (events.length === 0) return;
    this.events = [...events].sort((a, b) => a.time - b.time);
    this.index = 0;
    this.rate = rate;
    this.startTime = this.engine.now + 0.14;
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
        window.setTimeout(() => {
          if (this.playing) this.onEvent?.(ev);
        }, delay);
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
 * 弦ごとに「いま鳴っている音」を追いかけ、消音・スライドのときに
 * ちゃんとノートオフを書き出す。
 */
export function encodeMidi(events: PerformanceEvent[], bpm = 100): Blob {
  const ppq = 480;
  const secondsPerTick = 60 / bpm / ppq;
  const sorted = [...events].sort((a, b) => a.time - b.time);

  const track: number[] = [];
  const usPerQuarter = Math.round(60000000 / bpm);
  track.push(
    0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );
  // 楽器＝フィンガー・エレクトリックベース
  track.push(0x00, 0xc0, 33);

  let lastTick = 0;
  const sounding = new Map<number, number>(); // 弦 → MIDIノート

  const write = (time: number, bytes: number[]) => {
    const tick = Math.round(time / secondsPerTick);
    const delta = Math.max(0, tick - lastTick);
    lastTick = Math.max(lastTick, tick);
    track.push(...variableLength(delta), ...bytes);
  };

  const noteOff = (time: number, str: number) => {
    const note = sounding.get(str);
    if (note === undefined) return;
    sounding.delete(str);
    write(time, [0x80, note & 0x7f, 0x40]);
  };

  for (const ev of sorted) {
    switch (ev.type) {
      case 'pluck':
        noteOff(ev.time, ev.str);
        write(ev.time, [0x90, ev.note & 0x7f, Math.max(1, Math.round(ev.vel * 127)) & 0x7f]);
        sounding.set(ev.str, ev.note);
        break;
      case 'slide': {
        const vel = 78;
        noteOff(ev.time, ev.str);
        write(ev.time, [0x90, ev.note & 0x7f, vel]);
        sounding.set(ev.str, ev.note);
        break;
      }
      case 'bend': {
        // ±2半音のピッチベンドとして書き出す
        const value = Math.max(-8192, Math.min(8191, Math.round((ev.cents / 200) * 8192))) + 8192;
        write(ev.time, [0xe0, value & 0x7f, (value >> 7) & 0x7f]);
        break;
      }
      case 'mute':
        if (ev.amount > 0.4) noteOff(ev.time, ev.str);
        break;
      case 'muteAll':
        for (const str of [...sounding.keys()]) noteOff(ev.time, str);
        break;
    }
  }

  const endTime = sorted.length > 0 ? sorted[sorted.length - 1].time + 0.5 : 0;
  for (const str of [...sounding.keys()]) noteOff(endTime, str);
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
