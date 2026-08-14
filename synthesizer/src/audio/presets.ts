/**
 * Akatsuki Synth — ファクトリー音色ライブラリ
 *
 * すべての音色はオシレーター／フィルター／EG／LFO のパラメータのみで構成されており、
 * サンプル音源は使用していません（＝配布・商用利用時のライセンス制約がありません）。
 */
import type { DrumType, Patch } from './types';

export const CATEGORIES = [
  'BASS',
  'LEAD',
  'PAD',
  'KEYS',
  'PLUCK / BELL',
  'BRASS / STRINGS',
  'SEQ / ARP',
  'SFX',
  'DRUM',
] as const;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function basePatch(): Patch {
  return {
    id: 'init',
    name: 'Init Patch',
    category: 'KEYS',
    kind: 'synth',
    drum: { type: 'kick', tune: 0, decay: 0.5, tone: 0.5, snap: 0.5, drive: 0.15 },
    osc1: { wave: 'sawtooth', octave: 0, semitone: 0, detune: 0, level: 0.85, pulseWidth: 0.5, spread: 0.5, phase: 0 },
    osc2: { wave: 'sawtooth', octave: 0, semitone: 0, detune: 7, level: 0.85, pulseWidth: 0.5, spread: 0.5, phase: -1 },
    sub: { wave: 'sine', octave: -1, level: 0 },
    noise: { type: 'white', level: 0 },
    oscMix: 0.5,
    ringMod: false,
    oscSync: false,
    fmAmount: 0,
    filter: {
      model: 'ladder',
      type: 'lowpass',
      slope: 24,
      cutoff: 3200,
      resonance: 0.15,
      drive: 0.15,
      envAmount: 0.2,
      keyTrack: 0.3,
      velAmount: 0.15,
    },
    filterEnv: { attack: 0.004, decay: 0.35, sustain: 0.4, release: 0.35 },
    ampEnv: { attack: 0.006, decay: 0.4, sustain: 0.8, release: 0.35 },
    lfo1: { wave: 'triangle', rate: 5, sync: false, division: 1, target: 'none', amount: 0.2, fade: 0.4, retrigger: false },
    lfo2: { wave: 'triangle', rate: 0.6, sync: false, division: 2, target: 'none', amount: 0.2, fade: 0, retrigger: false },
    voiceMode: 'poly',
    glide: 0,
    bendRange: 2,
    velSens: 0.6,
    modWheel: { target: 'lfo1', amount: 0.6 },
    fx: { drive: 0, chorus: 0, delay: 0, reverb: 0.12 },
    volume: 0.8,
    pan: 0,
  };
}

function merge<T>(target: T, patch: DeepPartial<T>): T {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key] as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merge(target[key] as object, value as DeepPartial<object>);
    } else if (value !== undefined) {
      target[key] = value as T[keyof T];
    }
  }
  return target;
}

function def(id: string, name: string, category: string, overrides: DeepPartial<Patch>): Patch {
  const p = basePatch();
  p.id = id;
  p.name = name;
  p.category = category;
  return merge(p, overrides);
}

function drum(id: string, name: string, type: DrumType, overrides: DeepPartial<Patch> = {}): Patch {
  return def(id, name, 'DRUM', merge({ kind: 'drum', drum: { type }, volume: 0.85 } as DeepPartial<Patch>, overrides));
}

// ---------------------------------------------------------------------------
export const PRESETS: Patch[] = [
  // ---------------------------------------------------------------- BASS
  def('bass_analog', 'Analog Bass', 'BASS', {
    osc1: { wave: 'sawtooth', level: 0.9 },
    osc2: { wave: 'square', detune: -6, level: 0.7 },
    sub: { wave: 'sine', octave: -1, level: 0.45 },
    oscMix: 0.35,
    filter: { cutoff: 480, resonance: 0.35, envAmount: 0.42, drive: 0.35, keyTrack: 0.35 },
    filterEnv: { attack: 0.002, decay: 0.16, sustain: 0.1, release: 0.12 },
    ampEnv: { attack: 0.003, decay: 0.5, sustain: 0.85, release: 0.12 },
    voiceMode: 'mono',
    volume: 0.85,
  }),
  def('bass_acid', 'Acid 303', 'BASS', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { level: 0 },
    oscMix: 0,
    filter: { cutoff: 300, resonance: 0.82, envAmount: 0.55, drive: 0.5, keyTrack: 0.2 },
    filterEnv: { attack: 0.001, decay: 0.22, sustain: 0.0, release: 0.1 },
    ampEnv: { attack: 0.002, decay: 0.4, sustain: 0.9, release: 0.08 },
    voiceMode: 'mono',
    glide: 0.06,
    fx: { drive: 0.3 },
  }),
  def('bass_sub', 'Deep Sub', 'BASS', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', octave: -1, level: 0.6 },
    oscMix: 0.4,
    filter: { cutoff: 1200, resonance: 0.05, envAmount: 0.05, drive: 0.1 },
    ampEnv: { attack: 0.01, decay: 0.6, sustain: 0.95, release: 0.2 },
    voiceMode: 'mono',
    volume: 0.9,
    fx: { reverb: 0 },
  }),
  def('bass_reese', 'Reese Bass', 'BASS', {
    osc1: { wave: 'sawtooth', detune: -14, level: 0.9 },
    osc2: { wave: 'sawtooth', detune: 15, level: 0.9 },
    sub: { level: 0.35 },
    oscMix: 0.5,
    filter: { cutoff: 700, resonance: 0.28, envAmount: 0.2, drive: 0.4 },
    ampEnv: { attack: 0.01, decay: 0.5, sustain: 0.95, release: 0.25 },
    lfo1: { target: 'filter', wave: 'triangle', rate: 0.35, amount: 0.18 },
    voiceMode: 'mono',
    fx: { chorus: 0.2 },
  }),
  def('bass_fm', 'FM Bass', 'BASS', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', octave: 1, level: 0.8 },
    oscMix: 0,
    fmAmount: 0.42,
    filter: { cutoff: 2200, resonance: 0.1, envAmount: 0.3, drive: 0.2 },
    filterEnv: { attack: 0.001, decay: 0.2, sustain: 0.15, release: 0.1 },
    ampEnv: { attack: 0.002, decay: 0.35, sustain: 0.7, release: 0.1 },
    voiceMode: 'mono',
  }),
  def('bass_pluck', 'Pluck Bass', 'BASS', {
    osc1: { wave: 'square', level: 0.9 },
    osc2: { wave: 'sawtooth', octave: -1, level: 0.7 },
    oscMix: 0.45,
    filter: { cutoff: 380, resonance: 0.45, envAmount: 0.6, keyTrack: 0.4 },
    filterEnv: { attack: 0.001, decay: 0.13, sustain: 0.0, release: 0.1 },
    ampEnv: { attack: 0.002, decay: 0.28, sustain: 0.25, release: 0.12 },
    voiceMode: 'poly',
  }),
  def('bass_growl', 'Growl Bass', 'BASS', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'pulse', pulseWidth: 0.25, semitone: 7, level: 0.6 },
    oscMix: 0.4,
    filter: { cutoff: 420, resonance: 0.6, envAmount: 0.35, drive: 0.65 },
    lfo1: { target: 'filter', wave: 'sine', sync: true, division: 0.5, amount: 0.4, fade: 0 },
    ampEnv: { attack: 0.005, decay: 0.4, sustain: 0.9, release: 0.15 },
    voiceMode: 'mono',
    fx: { drive: 0.35 },
  }),

  // ---------------------------------------------------------------- LEAD
  def('lead_super', 'Super Saw Lead', 'LEAD', {
    osc1: { wave: 'superSaw', spread: 0.7, level: 1 },
    osc2: { wave: 'superSaw', spread: 0.45, octave: -1, level: 0.7 },
    oscMix: 0.35,
    filter: { cutoff: 5200, resonance: 0.12, envAmount: 0.2, keyTrack: 0.4 },
    ampEnv: { attack: 0.01, decay: 0.5, sustain: 0.9, release: 0.35 },
    fx: { chorus: 0.35, delay: 0.25, reverb: 0.25 },
    volume: 0.72,
  }),
  def('lead_saw', 'Classic Saw Lead', 'LEAD', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'sawtooth', detune: 12, level: 0.8 },
    filter: { cutoff: 3800, resonance: 0.25, envAmount: 0.3 },
    ampEnv: { attack: 0.008, decay: 0.4, sustain: 0.85, release: 0.2 },
    voiceMode: 'mono',
    glide: 0.03,
    lfo1: { target: 'pitch', wave: 'sine', rate: 5.5, amount: 0.05, fade: 0.6 },
    fx: { delay: 0.25, reverb: 0.2 },
  }),
  def('lead_square', 'Hollow Square', 'LEAD', {
    osc1: { wave: 'pulse', pulseWidth: 0.22, level: 1 },
    osc2: { wave: 'pulse', pulseWidth: 0.35, detune: -8, level: 0.7 },
    filter: { cutoff: 2600, resonance: 0.2, envAmount: 0.25 },
    lfo2: { target: 'pulseWidth', wave: 'triangle', rate: 0.4, amount: 0.35 },
    ampEnv: { attack: 0.01, decay: 0.4, sustain: 0.85, release: 0.25 },
    fx: { chorus: 0.25, reverb: 0.2 },
  }),
  def('lead_sync', 'Sync Lead', 'LEAD', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'sawtooth', semitone: 7, level: 0.9 },
    oscMix: 1,
    oscSync: true,
    filter: { cutoff: 6000, resonance: 0.15, envAmount: 0.25 },
    filterEnv: { attack: 0.002, decay: 0.4, sustain: 0.4, release: 0.2 },
    lfo1: { target: 'osc2Pitch', wave: 'triangle', rate: 0.25, amount: 0.5, fade: 0 },
    voiceMode: 'mono',
    fx: { delay: 0.2, reverb: 0.2 },
  }),
  def('lead_fm', 'FM Lead', 'LEAD', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', semitone: 12, level: 0.85 },
    oscMix: 0,
    fmAmount: 0.35,
    filter: { cutoff: 7000, resonance: 0.05, envAmount: 0.15 },
    filterEnv: { attack: 0.002, decay: 0.5, sustain: 0.3, release: 0.2 },
    ampEnv: { attack: 0.005, decay: 0.5, sustain: 0.75, release: 0.25 },
    fx: { delay: 0.3, reverb: 0.25 },
  }),
  def('lead_flute', 'Soft Flute', 'LEAD', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'triangle', detune: 5, level: 0.5 },
    noise: { type: 'pink', level: 0.06 },
    filter: { cutoff: 2600, resonance: 0.1, envAmount: 0.15, keyTrack: 0.5 },
    ampEnv: { attack: 0.08, decay: 0.3, sustain: 0.9, release: 0.25 },
    lfo1: { target: 'pitch', wave: 'sine', rate: 5, amount: 0.04, fade: 0.7 },
    fx: { reverb: 0.35 },
  }),
  def('lead_chip', 'Chiptune Lead', 'LEAD', {
    osc1: { wave: 'pulse', pulseWidth: 0.125, level: 1 },
    osc2: { level: 0 },
    oscMix: 0,
    filter: { model: 'svf', cutoff: 12000, resonance: 0.05, envAmount: 0, slope: 12 },
    ampEnv: { attack: 0.001, decay: 0.1, sustain: 0.9, release: 0.05 },
    voiceMode: 'mono',
    velSens: 0.2,
    fx: { reverb: 0.08 },
  }),
  def('lead_whistle', 'Sine Whistle', 'LEAD', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { level: 0 },
    oscMix: 0,
    filter: { cutoff: 9000, resonance: 0 },
    ampEnv: { attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.4 },
    lfo1: { target: 'pitch', wave: 'sine', rate: 6, amount: 0.06, fade: 0.5 },
    fx: { delay: 0.3, reverb: 0.4 },
  }),

  // ---------------------------------------------------------------- PAD
  def('pad_warm', 'Warm Pad', 'PAD', {
    osc1: { wave: 'sawtooth', detune: -8, level: 0.8 },
    osc2: { wave: 'sawtooth', detune: 9, level: 0.8 },
    sub: { level: 0.2 },
    filter: { cutoff: 1500, resonance: 0.12, envAmount: 0.3, keyTrack: 0.35 },
    filterEnv: { attack: 1.2, decay: 1.5, sustain: 0.5, release: 1.5 },
    ampEnv: { attack: 0.9, decay: 1.5, sustain: 0.85, release: 1.6 },
    lfo2: { target: 'pan', wave: 'sine', rate: 0.15, amount: 0.4 },
    fx: { chorus: 0.4, reverb: 0.5, delay: 0.15 },
    volume: 0.68,
  }),
  def('pad_glass', 'Glass Pad', 'PAD', {
    osc1: { wave: 'triangle', level: 0.9 },
    osc2: { wave: 'sine', semitone: 7, detune: 6, level: 0.7 },
    filter: { model: 'svf', type: 'bandpass', cutoff: 2200, resonance: 0.3, envAmount: 0.3, slope: 12 },
    filterEnv: { attack: 1.5, decay: 2, sustain: 0.6, release: 2 },
    ampEnv: { attack: 1.1, decay: 2, sustain: 0.8, release: 2.2 },
    fx: { chorus: 0.3, reverb: 0.6 },
    volume: 0.7,
  }),
  def('pad_choir', 'Choir Aah', 'PAD', {
    osc1: { wave: 'sawtooth', detune: -5, level: 0.75 },
    osc2: { wave: 'pulse', pulseWidth: 0.4, detune: 6, level: 0.6 },
    noise: { type: 'pink', level: 0.04 },
    filter: { model: 'svf', type: 'bandpass', cutoff: 900, resonance: 0.45, envAmount: 0.25, slope: 12 },
    filterEnv: { attack: 0.8, decay: 1.5, sustain: 0.7, release: 1.5 },
    ampEnv: { attack: 0.6, decay: 1.2, sustain: 0.85, release: 1.4 },
    lfo1: { target: 'pitch', wave: 'sine', rate: 4.5, amount: 0.03, fade: 1 },
    fx: { chorus: 0.5, reverb: 0.55 },
    volume: 0.68,
  }),
  def('pad_sweep', 'Sweep Pad', 'PAD', {
    osc1: { wave: 'superSaw', spread: 0.55, level: 0.9 },
    osc2: { wave: 'sawtooth', octave: -1, detune: -10, level: 0.6 },
    filter: { cutoff: 400, resonance: 0.35, envAmount: 0.65 },
    filterEnv: { attack: 2.5, decay: 3, sustain: 0.55, release: 2 },
    ampEnv: { attack: 1.2, decay: 2, sustain: 0.9, release: 2 },
    fx: { chorus: 0.35, delay: 0.2, reverb: 0.5 },
    volume: 0.66,
  }),
  def('pad_dark', 'Dark Drone', 'PAD', {
    osc1: { wave: 'sawtooth', octave: -1, level: 0.9 },
    osc2: { wave: 'square', octave: -1, detune: -12, level: 0.7 },
    sub: { level: 0.3 },
    filter: { cutoff: 620, resonance: 0.25, envAmount: 0.1, drive: 0.3 },
    ampEnv: { attack: 1.5, decay: 2, sustain: 0.9, release: 2.5 },
    lfo1: { target: 'filter', wave: 'triangle', rate: 0.1, amount: 0.3 },
    fx: { reverb: 0.65, chorus: 0.2 },
    volume: 0.7,
  }),
  def('pad_shimmer', 'Shimmer Air', 'PAD', {
    osc1: { wave: 'triangle', octave: 1, level: 0.7 },
    osc2: { wave: 'sine', octave: 2, detune: 8, level: 0.5 },
    noise: { type: 'pink', level: 0.05 },
    filter: { model: 'svf', type: 'highpass', cutoff: 500, resonance: 0.15, slope: 12, envAmount: 0.1 },
    ampEnv: { attack: 1.8, decay: 2.5, sustain: 0.8, release: 3 },
    lfo2: { target: 'pan', wave: 'triangle', rate: 0.12, amount: 0.6 },
    fx: { chorus: 0.4, delay: 0.35, reverb: 0.7 },
    volume: 0.6,
  }),

  // ---------------------------------------------------------------- KEYS
  def('keys_ep', 'Electric Piano', 'KEYS', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', octave: 2, level: 0.75 },
    oscMix: 0,
    fmAmount: 0.22,
    filter: { cutoff: 4200, resonance: 0.05, envAmount: 0.25, keyTrack: 0.5 },
    filterEnv: { attack: 0.001, decay: 0.9, sustain: 0.1, release: 0.4 },
    ampEnv: { attack: 0.002, decay: 1.6, sustain: 0.28, release: 0.5 },
    velSens: 0.85,
    fx: { chorus: 0.25, reverb: 0.28 },
  }),
  def('keys_clav', 'Clavinet', 'KEYS', {
    osc1: { wave: 'pulse', pulseWidth: 0.18, level: 1 },
    osc2: { wave: 'square', detune: -7, level: 0.6 },
    filter: { model: 'svf', type: 'bandpass', cutoff: 1800, resonance: 0.35, envAmount: 0.4, slope: 12, keyTrack: 0.6 },
    filterEnv: { attack: 0.001, decay: 0.14, sustain: 0.1, release: 0.1 },
    ampEnv: { attack: 0.001, decay: 0.5, sustain: 0.3, release: 0.12 },
    velSens: 0.8,
    fx: { drive: 0.2, reverb: 0.15 },
  }),
  def('keys_organ', 'Drawbar Organ', 'KEYS', {
    osc1: { wave: 'sine', level: 0.9 },
    osc2: { wave: 'sine', octave: 1, semitone: 7, level: 0.75 },
    sub: { wave: 'sine', octave: -1, level: 0.4 },
    filter: { cutoff: 6000, resonance: 0.05, envAmount: 0 },
    ampEnv: { attack: 0.004, decay: 0.1, sustain: 1, release: 0.08 },
    lfo1: { target: 'pitch', wave: 'sine', rate: 6.2, amount: 0.03, fade: 0 },
    velSens: 0.2,
    fx: { chorus: 0.45, reverb: 0.25, drive: 0.15 },
  }),
  def('keys_house', 'House Piano', 'KEYS', {
    osc1: { wave: 'sawtooth', level: 0.9 },
    osc2: { wave: 'square', detune: 8, level: 0.7 },
    filter: { cutoff: 3400, resonance: 0.18, envAmount: 0.45, keyTrack: 0.5 },
    filterEnv: { attack: 0.001, decay: 0.45, sustain: 0.05, release: 0.25 },
    ampEnv: { attack: 0.002, decay: 1.1, sustain: 0.25, release: 0.35 },
    velSens: 0.7,
    fx: { chorus: 0.2, reverb: 0.3 },
  }),
  def('keys_toy', 'Toy Box', 'KEYS', {
    osc1: { wave: 'triangle', octave: 1, level: 1 },
    osc2: { wave: 'sine', octave: 2, semitone: 7, level: 0.5 },
    filter: { cutoff: 5000, resonance: 0.1, envAmount: 0.2 },
    ampEnv: { attack: 0.001, decay: 0.7, sustain: 0.05, release: 0.35 },
    fx: { delay: 0.2, reverb: 0.35 },
  }),

  // ---------------------------------------------------------- PLUCK / BELL
  def('pluck_synth', 'Synth Pluck', 'PLUCK / BELL', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'square', detune: 9, level: 0.6 },
    filter: { cutoff: 900, resonance: 0.3, envAmount: 0.55, keyTrack: 0.5 },
    filterEnv: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.15 },
    ampEnv: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.25 },
    fx: { delay: 0.28, reverb: 0.3 },
  }),
  def('pluck_koto', 'Koto', 'PLUCK / BELL', {
    osc1: { wave: 'triangle', level: 1 },
    osc2: { wave: 'sawtooth', detune: 4, level: 0.45 },
    filter: { cutoff: 2600, resonance: 0.25, envAmount: 0.5, keyTrack: 0.6 },
    filterEnv: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 },
    ampEnv: { attack: 0.001, decay: 1.1, sustain: 0, release: 0.5 },
    fx: { reverb: 0.4, delay: 0.1 },
  }),
  def('bell_glocken', 'Glockenspiel', 'PLUCK / BELL', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', semitone: 12, detune: 4, level: 0.8 },
    oscMix: 0,
    fmAmount: 0.5,
    filter: { cutoff: 9000, resonance: 0.05, envAmount: 0.1 },
    ampEnv: { attack: 0.001, decay: 1.4, sustain: 0, release: 1 },
    velSens: 0.8,
    fx: { reverb: 0.45, delay: 0.15 },
    volume: 0.7,
  }),
  def('bell_tubular', 'Tubular Bell', 'PLUCK / BELL', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', semitone: 19, level: 0.7 },
    oscMix: 0,
    fmAmount: 0.34,
    ringMod: false,
    filter: { cutoff: 6000, resonance: 0.1, envAmount: 0.2 },
    ampEnv: { attack: 0.002, decay: 3, sustain: 0, release: 2 },
    fx: { reverb: 0.6 },
    volume: 0.7,
  }),
  def('bell_metal', 'Metal Ring', 'PLUCK / BELL', {
    osc1: { wave: 'square', level: 0.9 },
    osc2: { wave: 'square', semitone: 6, detune: 12, level: 0.9 },
    ringMod: true,
    filter: { model: 'svf', type: 'bandpass', cutoff: 3200, resonance: 0.4, slope: 12, envAmount: 0.2 },
    ampEnv: { attack: 0.001, decay: 1.2, sustain: 0, release: 0.8 },
    fx: { reverb: 0.5, delay: 0.2 },
    volume: 0.65,
  }),
  def('pluck_marimba', 'Marimba', 'PLUCK / BELL', {
    osc1: { wave: 'sine', level: 1 },
    osc2: { wave: 'sine', semitone: 19, level: 0.35 },
    oscMix: 0.25,
    filter: { cutoff: 3500, resonance: 0.1, envAmount: 0.3, keyTrack: 0.6 },
    ampEnv: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
    velSens: 0.8,
    fx: { reverb: 0.3 },
  }),

  // ------------------------------------------------------- BRASS / STRINGS
  def('brass_synth', 'Synth Brass', 'BRASS / STRINGS', {
    osc1: { wave: 'sawtooth', level: 0.95 },
    osc2: { wave: 'sawtooth', detune: -11, level: 0.85 },
    filter: { cutoff: 1100, resonance: 0.18, envAmount: 0.5, keyTrack: 0.4, drive: 0.2 },
    filterEnv: { attack: 0.09, decay: 0.5, sustain: 0.5, release: 0.3 },
    ampEnv: { attack: 0.04, decay: 0.4, sustain: 0.9, release: 0.28 },
    velSens: 0.7,
    fx: { chorus: 0.2, reverb: 0.3 },
    volume: 0.75,
  }),
  def('brass_stab', 'Brass Stab', 'BRASS / STRINGS', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'pulse', pulseWidth: 0.35, detune: 10, level: 0.8 },
    filter: { cutoff: 900, resonance: 0.25, envAmount: 0.6, drive: 0.25 },
    filterEnv: { attack: 0.01, decay: 0.22, sustain: 0.15, release: 0.2 },
    ampEnv: { attack: 0.006, decay: 0.3, sustain: 0.6, release: 0.2 },
    fx: { reverb: 0.28, delay: 0.12 },
  }),
  def('strings_ensemble', 'String Ensemble', 'BRASS / STRINGS', {
    osc1: { wave: 'sawtooth', detune: -7, level: 0.8 },
    osc2: { wave: 'sawtooth', detune: 8, level: 0.8 },
    filter: { cutoff: 2400, resonance: 0.1, envAmount: 0.25, keyTrack: 0.4 },
    filterEnv: { attack: 0.4, decay: 1, sustain: 0.6, release: 0.8 },
    ampEnv: { attack: 0.3, decay: 0.8, sustain: 0.9, release: 0.7 },
    lfo1: { target: 'pitch', wave: 'sine', rate: 5.2, amount: 0.025, fade: 0.8 },
    fx: { chorus: 0.5, reverb: 0.45 },
    volume: 0.7,
  }),
  def('strings_solo', 'Solo Strings', 'BRASS / STRINGS', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'triangle', detune: 6, level: 0.4 },
    filter: { cutoff: 2000, resonance: 0.2, envAmount: 0.3, keyTrack: 0.5 },
    ampEnv: { attack: 0.15, decay: 0.6, sustain: 0.9, release: 0.4 },
    lfo1: { target: 'pitch', wave: 'sine', rate: 5.8, amount: 0.05, fade: 0.5 },
    voiceMode: 'legato',
    glide: 0.05,
    fx: { reverb: 0.4 },
  }),

  // ------------------------------------------------------------- SEQ / ARP
  def('seq_pulse', 'Pulse Sequence', 'SEQ / ARP', {
    osc1: { wave: 'pulse', pulseWidth: 0.3, level: 1 },
    osc2: { wave: 'sawtooth', octave: -1, level: 0.5 },
    filter: { cutoff: 1400, resonance: 0.4, envAmount: 0.5 },
    filterEnv: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 },
    ampEnv: { attack: 0.001, decay: 0.2, sustain: 0.2, release: 0.1 },
    fx: { delay: 0.3, reverb: 0.2 },
  }),
  def('seq_blip', 'Blip Arp', 'SEQ / ARP', {
    osc1: { wave: 'square', level: 1 },
    osc2: { wave: 'square', octave: 1, detune: 8, level: 0.5 },
    filter: { cutoff: 2800, resonance: 0.35, envAmount: 0.4, keyTrack: 0.6 },
    filterEnv: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 },
    ampEnv: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 },
    fx: { delay: 0.35, reverb: 0.25 },
  }),
  def('seq_dust', 'Dust Motion', 'SEQ / ARP', {
    osc1: { wave: 'triangle', level: 0.9 },
    osc2: { wave: 'sine', octave: 1, level: 0.5 },
    noise: { type: 'pink', level: 0.05 },
    filter: { cutoff: 1800, resonance: 0.3, envAmount: 0.4 },
    lfo1: { target: 'filter', wave: 'sampleHold', sync: true, division: 0.25, amount: 0.4, fade: 0 },
    ampEnv: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.2 },
    fx: { delay: 0.4, reverb: 0.4 },
  }),

  // ----------------------------------------------------------------- SFX
  def('sfx_riser', 'Riser', 'SFX', {
    osc1: { wave: 'superSaw', spread: 1, level: 1 },
    osc2: { wave: 'noise', level: 0.4 },
    oscMix: 0.3,
    filter: { model: 'svf', type: 'bandpass', cutoff: 400, resonance: 0.5, slope: 12, envAmount: 0.9 },
    filterEnv: { attack: 3.5, decay: 0.5, sustain: 1, release: 0.3 },
    ampEnv: { attack: 2.5, decay: 1, sustain: 1, release: 0.2 },
    lfo1: { target: 'pitch', wave: 'sawtooth', rate: 0.12, amount: 0.35, fade: 0 },
    fx: { delay: 0.3, reverb: 0.5 },
    volume: 0.6,
  }),
  def('sfx_laser', 'Laser Zap', 'SFX', {
    osc1: { wave: 'sawtooth', level: 1 },
    osc2: { wave: 'square', semitone: -12, level: 0.5 },
    filter: { cutoff: 6000, resonance: 0.5, envAmount: -0.9 },
    filterEnv: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 },
    ampEnv: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    lfo1: { target: 'pitch', wave: 'sawtooth', rate: 8, amount: 0.3, fade: 0 },
    fx: { delay: 0.35, reverb: 0.3 },
  }),
  def('sfx_wind', 'Wind Noise', 'SFX', {
    osc1: { wave: 'noise', level: 1 },
    osc2: { level: 0 },
    oscMix: 0,
    noise: { type: 'pink', level: 0.3 },
    filter: { model: 'svf', type: 'bandpass', cutoff: 700, resonance: 0.55, slope: 12, envAmount: 0.3 },
    lfo1: { target: 'filter', wave: 'triangle', rate: 0.18, amount: 0.6, fade: 0 },
    ampEnv: { attack: 1.2, decay: 1, sustain: 0.9, release: 1.5 },
    fx: { reverb: 0.6 },
    volume: 0.6,
  }),
  def('sfx_impact', 'Impact Hit', 'SFX', {
    osc1: { wave: 'sawtooth', octave: -2, level: 1 },
    osc2: { wave: 'noise', level: 0.7 },
    oscMix: 0.35,
    filter: { cutoff: 1500, resonance: 0.3, envAmount: -0.6, drive: 0.5 },
    filterEnv: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.5 },
    ampEnv: { attack: 0.001, decay: 1.6, sustain: 0, release: 1 },
    fx: { reverb: 0.6, drive: 0.3 },
  }),

  // ---------------------------------------------------------------- DRUM
  drum('dr_kick', 'Kick 909', 'kick', { drum: { decay: 0.55, tone: 0.5, snap: 0.6, drive: 0.2 }, volume: 0.95 }),
  drum('dr_kick808', 'Kick 808', 'kick2', { drum: { decay: 1.1, tone: 0.4, snap: 0.25, drive: 0.15 }, volume: 0.95 }),
  drum('dr_kick_tight', 'Kick Tight', 'kick', { drum: { tune: 2, decay: 0.28, snap: 0.8, drive: 0.35 }, volume: 0.92 }),
  drum('dr_snare', 'Snare', 'snare', { drum: { decay: 0.9, tone: 0.5, snap: 0.6 }, volume: 0.82 }),
  drum('dr_snare_rim', 'Rim Shot', 'rim', { drum: { decay: 1, tone: 0.6, snap: 0.5 }, volume: 0.75 }),
  drum('dr_clap', 'Hand Clap', 'clap', { drum: { decay: 1, tone: 0.5 }, volume: 0.78 }),
  drum('dr_hat_closed', 'Hat Closed', 'hatClosed', { drum: { decay: 1, tone: 0.55 }, volume: 0.6 }),
  drum('dr_hat_open', 'Hat Open', 'hatOpen', { drum: { decay: 1, tone: 0.55 }, volume: 0.55 }),
  drum('dr_tom_low', 'Tom Low', 'tomLow', { drum: { decay: 1 }, volume: 0.8 }),
  drum('dr_tom_mid', 'Tom Mid', 'tomMid', { drum: { decay: 0.9 }, volume: 0.8 }),
  drum('dr_tom_high', 'Tom High', 'tomHigh', { drum: { decay: 0.8 }, volume: 0.8 }),
  drum('dr_crash', 'Crash', 'crash', { drum: { decay: 1, tone: 0.5 }, volume: 0.55 }),
  drum('dr_ride', 'Ride', 'ride', { drum: { decay: 1, tone: 0.5 }, volume: 0.55 }),
  drum('dr_cowbell', 'Cowbell', 'cowbell', { drum: { decay: 1, tone: 0.5 }, volume: 0.6 }),
  drum('dr_shaker', 'Shaker', 'shaker', { drum: { decay: 1, tone: 0.5 }, volume: 0.5 }),
  drum('dr_clave', 'Clave', 'clave', { drum: { decay: 1, tone: 0.5 }, volume: 0.6 }),
];

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

export function clonePatch(p: Patch): Patch {
  return JSON.parse(JSON.stringify(p)) as Patch;
}

export function getPreset(id: string): Patch {
  const p = PRESET_MAP.get(id) ?? PRESETS[0];
  return clonePatch(p);
}

/**
 * 旧バージョン（v1）で保存された音色や、フィールドが欠けた音色を安全に読み込む。
 */
export function normalizePatch(raw: unknown): Patch {
  const base = basePatch();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Record<string, unknown> & Partial<Patch>;
  const out = merge(base, src as DeepPartial<Patch>);

  // v1 互換：isDrum / drumType → kind / drum.type
  const legacy = src as { isDrum?: boolean; drumType?: DrumType; fx?: { drive?: number } };
  if (legacy.isDrum) {
    out.kind = 'drum';
    if (legacy.drumType) out.drum.type = legacy.drumType;
  }
  if (out.kind !== 'drum') out.kind = 'synth';
  // v1 のレゾナンスは Q 値（0.1..20）だったため 0..1 に丸め直す
  if (out.filter.resonance > 1) out.filter.resonance = Math.min(1, out.filter.resonance / 20);
  if (out.filter.cutoff > 20000) out.filter.cutoff = 20000;
  if (!Number.isFinite(out.filter.cutoff) || out.filter.cutoff < 20) out.filter.cutoff = 20;
  return out;
}

const USER_PATCH_KEY = 'mss.userPatches.v2';

export function loadUserPatches(): Patch[] {
  try {
    const raw = localStorage.getItem(USER_PATCH_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown[];
    return Array.isArray(list) ? list.map(normalizePatch) : [];
  } catch {
    return [];
  }
}

export function saveUserPatches(patches: Patch[]) {
  try {
    localStorage.setItem(USER_PATCH_KEY, JSON.stringify(patches));
  } catch {
    /* ストレージ不可の環境では保存をスキップ */
  }
}
