/**
 * Akatsuki Synth — 起動時に読み込まれるデモ曲
 * 初回起動でもすぐに「鳴る状態」から始められるようにしています。
 */
import { basePatch, getPreset } from '../audio/presets';
import type { Patch } from '../audio/types';
import { emptyPattern, PATTERN_SLOTS, type Pattern } from '../audio/Sequencer';

interface DemoTrack {
  name: string;
  preset: string;
  volume?: number;
  pan?: number;
  patterns: { length: number; notes: [number, number, number, number][] }[];
}

/** [step, pitch, length, velocity] の簡易表記でパターンを書く */
function pattern(length: number, notes: [number, number, number, number][]): Pattern {
  return { length, notes: notes.map(([step, pitch, len, vel]) => ({ step, pitch, length: len, velocity: vel })) };
}

const KICK: [number, number, number, number][] = [
  [0, 60, 1, 1], [4, 60, 1, 0.95], [8, 60, 1, 1], [12, 60, 1, 0.95], [14, 60, 1, 0.55],
];
const KICK_B: [number, number, number, number][] = [
  [0, 60, 1, 1], [3, 60, 1, 0.6], [6, 60, 1, 0.9], [8, 60, 1, 1], [11, 60, 1, 0.6], [14, 60, 1, 0.85],
];
const CLAP: [number, number, number, number][] = [[4, 60, 1, 0.9], [12, 60, 1, 0.9]];
const HAT: [number, number, number, number][] = [
  [0, 60, 1, 0.5], [2, 60, 1, 0.75], [4, 60, 1, 0.5], [6, 60, 1, 0.8],
  [8, 60, 1, 0.5], [10, 60, 1, 0.75], [12, 60, 1, 0.5], [14, 60, 1, 0.8],
  [1, 60, 1, 0.32], [5, 60, 1, 0.32], [9, 60, 1, 0.32], [13, 60, 1, 0.32],
];
const HAT_OPEN: [number, number, number, number][] = [[6, 60, 1, 0.6], [14, 60, 1, 0.55]];

const BASS: [number, number, number, number][] = [
  [0, 45, 3, 1], [3, 45, 1, 0.7], [6, 45, 2, 0.85], [8, 48, 2, 0.9],
  [11, 43, 2, 0.85], [14, 40, 2, 0.9],
];
const BASS_B: [number, number, number, number][] = [
  [0, 41, 3, 1], [3, 41, 1, 0.7], [6, 41, 2, 0.85], [8, 45, 2, 0.9], [12, 43, 4, 0.9],
];

const PAD_A: [number, number, number, number][] = [
  [0, 57, 8, 0.75], [0, 60, 8, 0.7], [0, 64, 8, 0.72], [0, 67, 8, 0.68],
  [8, 53, 8, 0.75], [8, 57, 8, 0.7], [8, 60, 8, 0.72], [8, 64, 8, 0.68],
];

const LEAD: [number, number, number, number][] = [
  [0, 72, 2, 0.9], [2, 76, 2, 0.8], [4, 79, 2, 0.95], [6, 76, 1, 0.7],
  [7, 74, 1, 0.7], [8, 72, 3, 0.85], [12, 69, 2, 0.8], [14, 72, 2, 0.85],
];
const LEAD_B: [number, number, number, number][] = [
  [0, 77, 2, 0.9], [2, 76, 2, 0.8], [4, 72, 2, 0.9], [6, 69, 2, 0.75],
  [8, 71, 2, 0.85], [10, 72, 2, 0.8], [12, 76, 4, 0.9],
];

const ARP: [number, number, number, number][] = [
  [0, 69, 1, 0.7], [2, 72, 1, 0.6], [4, 76, 1, 0.7], [6, 81, 1, 0.6],
  [8, 76, 1, 0.7], [10, 72, 1, 0.6], [12, 69, 1, 0.7], [14, 64, 1, 0.6],
];

const DEMO_TRACKS: DemoTrack[] = [
  { name: 'Kick', preset: 'dr_kick', volume: 1, patterns: [{ length: 16, notes: KICK }, { length: 16, notes: KICK_B }] },
  { name: 'Clap', preset: 'dr_clap', volume: 0.8, patterns: [{ length: 16, notes: CLAP }, { length: 16, notes: CLAP }] },
  { name: 'Hat', preset: 'dr_hat_closed', volume: 0.6, pan: 0.12, patterns: [{ length: 16, notes: HAT }, { length: 16, notes: HAT }] },
  { name: 'Open Hat', preset: 'dr_hat_open', volume: 0.5, pan: -0.15, patterns: [{ length: 16, notes: HAT_OPEN }, { length: 16, notes: HAT_OPEN }] },
  { name: 'Bass', preset: 'bass_analog', volume: 0.95, patterns: [{ length: 16, notes: BASS }, { length: 16, notes: BASS_B }] },
  { name: 'Pad', preset: 'pad_warm', volume: 0.6, patterns: [{ length: 16, notes: PAD_A }, { length: 16, notes: PAD_A }] },
  { name: 'Arp', preset: 'seq_blip', volume: 0.55, pan: 0.25, patterns: [{ length: 16, notes: ARP }, { length: 16, notes: ARP }] },
  { name: 'Lead', preset: 'lead_super', volume: 0.7, patterns: [{ length: 16, notes: LEAD }, { length: 16, notes: LEAD_B }] },
];

export function demoSong() {
  const tracks = DEMO_TRACKS.map((t, i) => {
    const patch: Patch = t.preset ? getPreset(t.preset) : basePatch();
    patch.pan = t.pan ?? 0;
    const patterns: Pattern[] = [];
    for (let s = 0; s < PATTERN_SLOTS; s++) {
      const src = t.patterns[s];
      patterns.push(src ? pattern(src.length, src.notes) : emptyPattern());
    }
    return {
      id: `t${i + 1}`,
      name: t.name,
      patch,
      patterns,
      activePattern: 0,
      muted: false,
      solo: false,
      volume: t.volume ?? 0.85,
      pan: t.pan ?? 0,
    };
  });

  const sceneA: Record<string, number> = {};
  const sceneB: Record<string, number> = {};
  for (const t of tracks) {
    sceneA[t.id] = 0;
    sceneB[t.id] = 1;
  }

  return {
    format: 'akatsuki-synth',
    version: 2,
    bpm: 112,
    swing: 0.12,
    mode: 'pattern' as const,
    master: undefined,
    scenes: [
      { name: 'Intro', bars: 4, patterns: sceneA },
      { name: 'Verse', bars: 4, patterns: sceneB },
    ],
    tracks,
  };
}
