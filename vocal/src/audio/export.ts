/*
 * 書き出し（WAV / 標準MIDI / プロジェクトJSON）
 *
 * WAV は 24bit（配信・販売にそのまま使える品質）、MIDI は歌詞メタイベント付きで
 * 他の DAW やボーカル系ソフトへ持ち出せる形にする。
 */

import { parseChord } from './chords';
import type { Song } from './types';

/** AudioBuffer を 24bit PCM の WAV にする */
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

function textBytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

function metaEvent(type: number, text: string): number[] {
  const body = textBytes(text);
  return [0xff, type, ...variableLength(body.length), ...body];
}

function chunk(id: string, body: number[]): number[] {
  const len = body.length;
  return [
    ...id.split('').map((c) => c.charCodeAt(0)),
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...body,
  ];
}

interface MidiEvent {
  tick: number;
  /** 同じ tick のときの並び順（ノートオフを先に出す） */
  order: number;
  bytes: number[];
}

function buildTrack(events: MidiEvent[], name: string): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [0x00, ...metaEvent(0x03, name)];
  let last = 0;
  for (const ev of sorted) {
    body.push(...variableLength(Math.max(0, ev.tick - last)), ...ev.bytes);
    last = ev.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return chunk('MTrk', body);
}

/**
 * 標準MIDIファイル（フォーマット1）を作る。
 *  トラック1: テンポ・曲名
 *  トラック2: 歌メロ + 歌詞メタイベント
 *  トラック3: コード（伴奏の参考用）
 */
export function encodeMidi(song: Song): Blob {
  const ppq = 480;
  const tracks: number[][] = [];

  // --- 1. コンダクター ---
  const usPerQuarter = Math.round(60000000 / song.bpm);
  const conductor: number[] = [
    0x00, ...metaEvent(0x03, song.title || 'Hoshizora Vocal'),
    0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff,
    0x00, 0xff, 0x58, 0x04, song.beatsPerBar, 0x02, 0x18, 0x08,
    0x00, 0xff, 0x2f, 0x00,
  ];
  tracks.push(chunk('MTrk', conductor));

  // --- 2. 歌メロ（歌詞付き） ---
  const melody: MidiEvent[] = [];
  for (const n of [...song.notes].sort((a, b) => a.start - b.start)) {
    const on = Math.round(n.start * ppq);
    const off = Math.round((n.start + n.length) * ppq);
    if (n.lyric) melody.push({ tick: on, order: 0, bytes: metaEvent(0x05, n.lyric) });
    melody.push({ tick: on, order: 1, bytes: [0x90, n.note & 0x7f, Math.max(1, Math.round(n.vel * 127)) & 0x7f] });
    melody.push({ tick: off, order: -1, bytes: [0x80, n.note & 0x7f, 0x40] });
  }
  tracks.push(buildTrack(melody, 'Vocal'));

  // --- 3. コード ---
  if (song.chords.length > 0) {
    const chords: MidiEvent[] = [];
    for (const c of song.chords) {
      const parsed = parseChord(c.symbol);
      if (!parsed) continue;
      const on = Math.round(c.start * ppq);
      const off = Math.round((c.start + c.length) * ppq);
      chords.push({ tick: on, order: 0, bytes: metaEvent(0x06, c.symbol) });
      for (const iv of parsed.intervals) {
        const note = 48 + parsed.root + iv;
        chords.push({ tick: on, order: 1, bytes: [0x91, note & 0x7f, 0x50] });
        chords.push({ tick: off, order: -1, bytes: [0x81, note & 0x7f, 0x40] });
      }
    }
    tracks.push(buildTrack(chords, 'Chords'));
  }

  const header = chunk('MThd', [
    0, 1, // format 1
    0, tracks.length,
    (ppq >> 8) & 0xff, ppq & 0xff,
  ]);

  const bytes = new Uint8Array([...header, ...tracks.flat()]);
  return new Blob([bytes], { type: 'audio/midi' });
}

// ----------------------------------------------------------------- Project

export const PROJECT_FORMAT = 'hoshizora-vocal';

export function encodeProject(song: Song): Blob {
  const data = { format: PROJECT_FORMAT, version: 1, song };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function decodeProject(text: string): Song | null {
  try {
    const data = JSON.parse(text);
    const song = data?.song ?? data;
    if (!song || !Array.isArray(song.notes)) return null;
    return song as Song;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 共通

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
export function safeFileName(name: string): string {
  return (name || 'song').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}
