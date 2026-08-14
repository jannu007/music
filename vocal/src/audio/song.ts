/*
 * 曲データの操作（生成・整形・歌詞流し込み）
 */

import { splitMora, tokenizeLyrics } from './kana';
import { voiceDefaults } from './voices';
import {
  DEFAULT_MIX,
  DEFAULT_SETTINGS,
  type Song,
  type VocalNote,
  type VocalSettings,
} from './types';

const NOTE_LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 'A4' 'F#3' → MIDI ノート番号 */
export function noteNameToMidi(name: string): number {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(name.trim());
  if (!m) return 60;
  let value = NOTE_LETTERS[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === '♯') value += 1;
  if (m[2] === 'b' || m[2] === '♭') value -= 1;
  return value + (Number(m[3]) + 1) * 12;
}

export function midiToNoteName(note: number): string {
  const n = Math.round(note);
  return `${SHARP_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

let idCounter = 1;

export function nextNoteId(): number {
  return idCounter++;
}

/** 読み込んだ曲の ID が衝突しないようにカウンタを進める */
export function syncNoteIds(notes: VocalNote[]) {
  for (const n of notes) if (n.id >= idCounter) idCounter = n.id + 1;
}

export function createNote(patch: Partial<VocalNote>): VocalNote {
  return {
    id: nextNoteId(),
    start: 0,
    length: 1,
    note: 69,
    lyric: 'ら',
    vel: 0.7,
    vib: -1,
    scoop: -1,
    breath: false,
    ...patch,
  };
}

export function createSong(patch: Partial<Song> = {}): Song {
  const voiceId = patch.settings?.voiceId ?? DEFAULT_SETTINGS.voiceId;
  const defaults = voiceDefaults(voiceId);
  const settings: VocalSettings = {
    voiceId,
    a4: 440,
    character: { ...defaults.character },
    expression: { ...defaults.expression },
    mix: { ...DEFAULT_MIX },
    ...patch.settings,
  };
  return {
    title: '新しい曲',
    bpm: 96,
    beatsPerBar: 4,
    notes: [],
    chords: [],
    style: 'ballad',
    ...patch,
    settings,
  };
}

/** 読み込んだデータに足りない項目を補う（古い保存データ対策） */
export function normalizeSong(input: Partial<Song>): Song {
  const base = createSong();
  const settings = input.settings ?? base.settings;
  const song: Song = {
    ...base,
    ...input,
    settings: {
      ...base.settings,
      ...settings,
      character: { ...base.settings.character, ...settings.character },
      expression: { ...base.settings.expression, ...settings.expression },
      mix: { ...base.settings.mix, ...settings.mix },
    },
    notes: (input.notes ?? []).map((n) => ({ ...createNote({}), ...n })),
    chords: (input.chords ?? []).map((c) => ({
      start: Number(c.start) || 0,
      length: Number(c.length) || 4,
      symbol: String(c.symbol ?? ''),
    })),
  };
  song.notes.sort((a, b) => a.start - b.start);
  syncNoteIds(song.notes);
  return song;
}

/** 曲の長さ（拍） */
export function songBeats(song: Song): number {
  let last = 0;
  for (const n of song.notes) last = Math.max(last, n.start + n.length);
  for (const c of song.chords) last = Math.max(last, c.start + c.length);
  return last;
}

/**
 * 歌詞テキストを音符へ順番に流し込む。
 * 空白は語の切れ目として扱い、語頭にはブレスを立てる。
 */
export function applyLyrics(notes: VocalNote[], text: string, startIndex = 0): number {
  const tokens = tokenizeLyrics(text);
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  let applied = 0;
  for (let i = 0; i < tokens.length; i++) {
    const target = sorted[startIndex + i];
    if (!target) break;
    target.lyric = tokens[i].mora;
    target.breath = tokens[i].breakBefore;
    applied++;
  }
  return applied;
}

/** 歌詞の文字数と音符数を数えて、過不足を伝える */
export function lyricFit(notes: VocalNote[], text: string): { morae: number; notes: number } {
  return { morae: tokenizeLyrics(text).length, notes: notes.length };
}

/** 歌詞欄に入れた1音符分の文字列を整える */
export function cleanLyric(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'ら';
  const morae = splitMora(trimmed);
  return morae.length ? trimmed : 'ら';
}

/** 音符を移調する */
export function transpose(notes: VocalNote[], semitones: number) {
  for (const n of notes) n.note = Math.max(24, Math.min(96, n.note + semitones));
}

/** 拍にスナップする */
export function snapValue(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}
