import type { Project } from './types';

/** AudioBuffer を 24bit PCM の WAV に変換する */
export function encodeWav(buffer: AudioBuffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 3;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

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
      bytes[offset++] = v & 0xff;
      bytes[offset++] = (v >> 8) & 0xff;
      bytes[offset++] = (v >> 16) & 0xff;
    }
  }
  return bytes;
}

// -------------------------------------------------------------------- ステップ列

export interface StepPosition {
  pattern: number;
  step: number;
  /** そのパターンに入ってからの通し番号（ポリメーター用） */
  abs: number;
  /** 曲の先頭からの通し番号 */
  index: number;
}

/**
 * 再生順にステップ位置を並べる（ワークレット側の進行と同じ規則）。
 * MIDI 書き出しと所要時間の計算で使う。
 */
export function stepSequence(project: Project, loops: number): StepPosition[] {
  const out: StepPosition[] = [];
  const patterns = project.patterns;
  const push = (pattern: number, step: number, abs: number) =>
    out.push({ pattern, step, abs, index: out.length });

  if (project.songMode && project.song.length > 0) {
    for (let loop = 0; loop < Math.max(1, loops); loop++) {
      for (const slot of project.song) {
        const pattern = patterns[slot.pattern];
        if (!pattern) continue;
        for (let r = 0; r < Math.max(1, slot.repeats); r++) {
          for (let s = 0; s < pattern.length; s++) push(slot.pattern, s, s);
        }
      }
    }
    return out;
  }

  const pattern = patterns[project.current];
  let abs = 0;
  for (let loop = 0; loop < Math.max(1, loops); loop++) {
    for (let s = 0; s < pattern.length; s++) push(project.current, s, abs++);
  }
  return out;
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

const PPQ = 480;

/**
 * パターン／ソングを標準MIDIファイル（フォーマット0・チャンネル10）に書き出す。
 * スウィング・ずらし・ロールも位置に反映する。
 */
export function encodeMidi(project: Project, loops = 1) {
  const spb = project.stepsPerBeat;
  const stepTicks = PPQ / spb;
  const sw = Math.min(0.75, Math.max(0.5, project.swing / 100));
  const swingable = spb % 2 === 0;

  interface MidiNote { tick: number; note: number; vel: number }
  const notes: MidiNote[] = [];

  const positions = stepSequence(project, loops);
  positions.forEach((pos, i) => {
    const pattern = project.patterns[pos.pattern];
    if (!pattern) return;
    // スウィングは2ステップ1組。組の先頭を伸ばし、裏を詰める
    const pairBase = Math.floor(i / 2) * 2;
    const inPair = i % 2;
    const baseTicks = swingable
      ? (pairBase + inPair * 2 * sw) * stepTicks
      : i * stepTicks;
    const durTicks = swingable
      ? stepTicks * 2 * (inPair === 0 ? sw : 1 - sw)
      : stepTicks;

    for (const track of project.tracks) {
      if (track.mute) continue;
      const tp = pattern.tracks[track.id];
      if (!tp) continue;
      const own = tp.length | 0;
      const index = own > 0 ? pos.abs % own : pos.step;
      const step = tp.steps[index];
      if (!step) continue;
      const rolls = Math.max(1, Math.min(8, step.r));
      for (let r = 0; r < rolls; r++) {
        const tick = Math.round(baseTicks + step.s * stepTicks + (durTicks * r) / rolls);
        let vel = step.v * (rolls > 1 ? 1 - (r / rolls) * 0.35 : 1);
        notes.push({
          tick: Math.max(0, tick),
          note: track.midi,
          vel: Math.max(1, Math.min(127, Math.round(vel * 127))),
        });
      }
    }
  });

  notes.sort((a, b) => a.tick - b.tick);

  const events: { tick: number; data: number[] }[] = [];
  for (const n of notes) {
    events.push({ tick: n.tick, data: [0x99, n.note, n.vel] });
    // ドラムは長さを持たないので、短いノートオフを直後に置く
    events.push({ tick: n.tick + Math.max(4, Math.round(stepTicks * 0.5)), data: [0x89, n.note, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick);

  const track: number[] = [];
  const usPerQuarter = Math.round(60000000 / project.bpm);
  track.push(0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  // トラック名
  const title = Array.from(new TextEncoder().encode(project.name.slice(0, 40)));
  track.push(0x00, 0xff, 0x03, title.length, ...title);

  let lastTick = 0;
  for (const ev of events) {
    track.push(...variableLength(Math.max(0, ev.tick - lastTick)));
    lastTick = ev.tick;
    track.push(...ev.data);
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0,
    0, 1,
    (PPQ >> 8) & 0xff, PPQ & 0xff,
  ];
  const len = track.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
  ];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}

// --------------------------------------------------------------------- ZIP

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * 無圧縮（stored）の ZIP を作る。WAV はもともと圧縮が効きにくいので、
 * 圧縮ライブラリを持ち込まずに済ませている。
 */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const head = new Uint8Array(46 + name.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);

    chunks.push(local, entry.data);
    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' });
}

// ------------------------------------------------------------------ ダウンロード

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

/** ファイル名に使えない文字を落とす */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'pattern';
}
