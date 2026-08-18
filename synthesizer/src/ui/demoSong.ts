/**
 * Akatsuki Synth — デモ曲集
 * 初回起動でもすぐに「鳴る状態」から始められるよう、起動時に1曲目を自動で読み込みます。
 * 「ソング構成」タブの一覧から、他のジャンルのデモ曲にも切り替えられます。
 */
import { basePatch, getPreset } from '../audio/presets';
import type { Patch } from '../audio/types';
import { emptyPattern, PATTERN_SLOTS, type Pattern } from '../audio/Sequencer';
import { t } from './i18n';

interface DemoTrack {
  name: string;
  preset: string;
  volume?: number;
  pan?: number;
  patterns: { length: number; notes: [number, number, number, number][] }[];
}

interface DemoSpec {
  id: string;
  bpm: number;
  swing: number;
  tracks: DemoTrack[];
}

/** [step, pitch, length, velocity] の簡易表記でパターンを書く */
function pattern(length: number, notes: [number, number, number, number][]): Pattern {
  return { length, notes: notes.map(([step, pitch, len, vel]) => ({ step, pitch, length: len, velocity: vel })) };
}

// ============================================================== 1. Sunrise Groove（ハウス）
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

const SUNRISE_TRACKS: DemoTrack[] = [
  { name: 'Kick', preset: 'dr_kick', volume: 1, patterns: [{ length: 16, notes: KICK }, { length: 16, notes: KICK_B }] },
  { name: 'Clap', preset: 'dr_clap', volume: 0.8, patterns: [{ length: 16, notes: CLAP }, { length: 16, notes: CLAP }] },
  { name: 'Hat', preset: 'dr_hat_closed', volume: 0.6, pan: 0.12, patterns: [{ length: 16, notes: HAT }, { length: 16, notes: HAT }] },
  { name: 'Open Hat', preset: 'dr_hat_open', volume: 0.5, pan: -0.15, patterns: [{ length: 16, notes: HAT_OPEN }, { length: 16, notes: HAT_OPEN }] },
  { name: 'Bass', preset: 'bass_analog', volume: 0.95, patterns: [{ length: 16, notes: BASS }, { length: 16, notes: BASS_B }] },
  { name: 'Pad', preset: 'pad_warm', volume: 0.6, patterns: [{ length: 16, notes: PAD_A }, { length: 16, notes: PAD_A }] },
  { name: 'Arp', preset: 'seq_blip', volume: 0.55, pan: 0.25, patterns: [{ length: 16, notes: ARP }, { length: 16, notes: ARP }] },
  { name: 'Lead', preset: 'lead_super', volume: 0.7, patterns: [{ length: 16, notes: LEAD }, { length: 16, notes: LEAD_B }] },
];

// ============================================================ 2. Midnight Drift（アンビエント）
const KICK_SOFT: [number, number, number, number][] = [[0, 60, 1, 0.85], [8, 60, 1, 0.8]];
const KICK_SOFT_B: [number, number, number, number][] = [[0, 60, 1, 0.85], [6, 60, 1, 0.5], [8, 60, 1, 0.8]];
const HAT_SOFT: [number, number, number, number][] = [
  [0, 60, 1, 0.35], [2, 60, 1, 0.3], [4, 60, 1, 0.35], [6, 60, 1, 0.3],
  [8, 60, 1, 0.35], [10, 60, 1, 0.3], [12, 60, 1, 0.35], [14, 60, 1, 0.3],
];
const SUBBASS_A: [number, number, number, number][] = [[0, 36, 8, 0.8], [8, 33, 8, 0.75]];
const SUBBASS_B: [number, number, number, number][] = [[0, 38, 8, 0.8], [8, 36, 8, 0.75]];
const PADW_A: [number, number, number, number][] = [
  [0, 48, 8, 0.6], [0, 55, 8, 0.55], [0, 60, 8, 0.6], [8, 45, 8, 0.6], [8, 53, 8, 0.55], [8, 60, 8, 0.58],
];
const PADW_B: [number, number, number, number][] = [
  [0, 50, 8, 0.6], [0, 57, 8, 0.55], [0, 62, 8, 0.6], [8, 48, 8, 0.6], [8, 55, 8, 0.55], [8, 60, 8, 0.58],
];
const PADG_A: [number, number, number, number][] = [[0, 72, 16, 0.35], [0, 67, 16, 0.3]];
const PADG_B: [number, number, number, number][] = [[0, 74, 16, 0.35], [0, 69, 16, 0.3]];
const FLUTE_A: [number, number, number, number][] = [
  [0, 67, 3, 0.55], [3, 72, 2, 0.5], [6, 71, 3, 0.5], [10, 67, 3, 0.5], [13, 64, 3, 0.45],
];
const FLUTE_B: [number, number, number, number][] = [
  [0, 69, 3, 0.55], [3, 74, 2, 0.5], [6, 72, 3, 0.5], [10, 69, 3, 0.5], [13, 65, 3, 0.45],
];
const BELL_A: [number, number, number, number][] = [[2, 79, 1, 0.4], [7, 84, 1, 0.35], [11, 76, 1, 0.4]];
const BELL_B: [number, number, number, number][] = [[2, 81, 1, 0.4], [7, 86, 1, 0.35], [11, 77, 1, 0.4]];
const DUST_A: [number, number, number, number][] = [[5, 60, 1, 0.3], [13, 64, 1, 0.28]];
const DUST_B: [number, number, number, number][] = [[5, 62, 1, 0.3], [13, 65, 1, 0.28]];

const MIDNIGHT_TRACKS: DemoTrack[] = [
  { name: 'Kick', preset: 'dr_kick_tight', volume: 0.75, patterns: [{ length: 16, notes: KICK_SOFT }, { length: 16, notes: KICK_SOFT_B }] },
  { name: 'Hat', preset: 'dr_hat_closed', volume: 0.35, pan: 0.1, patterns: [{ length: 16, notes: HAT_SOFT }, { length: 16, notes: HAT_SOFT }] },
  { name: 'Sub Bass', preset: 'bass_sub', volume: 0.8, patterns: [{ length: 16, notes: SUBBASS_A }, { length: 16, notes: SUBBASS_B }] },
  { name: 'Warm Pad', preset: 'pad_warm', volume: 0.55, patterns: [{ length: 16, notes: PADW_A }, { length: 16, notes: PADW_B }] },
  { name: 'Glass Pad', preset: 'pad_glass', volume: 0.4, pan: -0.2, patterns: [{ length: 16, notes: PADG_A }, { length: 16, notes: PADG_B }] },
  { name: 'Flute', preset: 'lead_flute', volume: 0.55, patterns: [{ length: 16, notes: FLUTE_A }, { length: 16, notes: FLUTE_B }] },
  { name: 'Bell', preset: 'bell_glocken', volume: 0.4, pan: 0.25, patterns: [{ length: 16, notes: BELL_A }, { length: 16, notes: BELL_B }] },
  { name: 'Dust', preset: 'seq_dust', volume: 0.3, pan: -0.3, patterns: [{ length: 16, notes: DUST_A }, { length: 16, notes: DUST_B }] },
];

// ============================================================= 3. Neon Runner（シンセウェイブ）
const KICK_SW: [number, number, number, number][] = [[0, 60, 1, 1], [4, 60, 1, 0.9], [8, 60, 1, 1], [12, 60, 1, 0.9]];
const KICK_SW_B: [number, number, number, number][] = [
  [0, 60, 1, 1], [4, 60, 1, 0.9], [8, 60, 1, 1], [10, 60, 1, 0.6], [12, 60, 1, 0.9],
];
const CLAP_SW: [number, number, number, number][] = [[4, 60, 1, 0.9], [12, 60, 1, 0.9]];
const HATC_SW: [number, number, number, number][] = [
  [0, 60, 1, 0.5], [2, 60, 1, 0.5], [4, 60, 1, 0.5], [6, 60, 1, 0.5],
  [8, 60, 1, 0.5], [10, 60, 1, 0.5], [12, 60, 1, 0.5], [14, 60, 1, 0.5],
];
const HATO_SW: [number, number, number, number][] = [[6, 60, 1, 0.55], [14, 60, 1, 0.55]];
const BASS_SW_A: [number, number, number, number][] = [
  [0, 40, 2, 0.9], [2, 40, 1, 0.6], [4, 40, 2, 0.9], [8, 43, 2, 0.9], [10, 43, 1, 0.6], [12, 45, 2, 0.9], [14, 40, 2, 0.85],
];
const BASS_SW_B: [number, number, number, number][] = [
  [0, 38, 2, 0.9], [2, 38, 1, 0.6], [4, 38, 2, 0.9], [8, 41, 2, 0.9], [10, 41, 1, 0.6], [12, 43, 2, 0.9], [14, 38, 2, 0.85],
];
const PADSWEEP_A: [number, number, number, number][] = [[0, 52, 16, 0.4], [0, 59, 16, 0.35], [0, 64, 16, 0.35]];
const PADSWEEP_B: [number, number, number, number][] = [[0, 50, 16, 0.4], [0, 57, 16, 0.35], [0, 62, 16, 0.35]];
const ARP_SW_A: [number, number, number, number][] = [
  [0, 64, 1, 0.7], [1, 67, 1, 0.6], [2, 71, 1, 0.7], [3, 67, 1, 0.6],
  [4, 64, 1, 0.7], [5, 67, 1, 0.6], [6, 71, 1, 0.7], [7, 67, 1, 0.6],
  [8, 62, 1, 0.7], [9, 65, 1, 0.6], [10, 69, 1, 0.7], [11, 65, 1, 0.6],
  [12, 62, 1, 0.7], [13, 65, 1, 0.6], [14, 69, 1, 0.7], [15, 65, 1, 0.6],
];
const ARP_SW_B: [number, number, number, number][] = [
  [0, 60, 1, 0.7], [1, 64, 1, 0.6], [2, 67, 1, 0.7], [3, 64, 1, 0.6],
  [4, 60, 1, 0.7], [5, 64, 1, 0.6], [6, 67, 1, 0.7], [7, 64, 1, 0.6],
  [8, 64, 1, 0.7], [9, 67, 1, 0.6], [10, 71, 1, 0.7], [11, 67, 1, 0.6],
  [12, 64, 1, 0.7], [13, 67, 1, 0.6], [14, 71, 1, 0.7], [15, 67, 1, 0.6],
];
const LEADSYNC_A: [number, number, number, number][] = [
  [0, 76, 2, 0.85], [2, 79, 2, 0.8], [4, 83, 2, 0.9], [6, 79, 1, 0.7],
  [7, 76, 1, 0.7], [8, 74, 3, 0.8], [12, 71, 2, 0.75], [14, 74, 2, 0.8],
];
const LEADSYNC_B: [number, number, number, number][] = [
  [0, 81, 2, 0.85], [2, 79, 2, 0.8], [4, 76, 2, 0.85], [6, 74, 2, 0.7],
  [8, 72, 2, 0.8], [10, 74, 2, 0.75], [12, 79, 4, 0.85],
];

const NEON_TRACKS: DemoTrack[] = [
  { name: 'Kick', preset: 'dr_kick808', volume: 1, patterns: [{ length: 16, notes: KICK_SW }, { length: 16, notes: KICK_SW_B }] },
  { name: 'Clap', preset: 'dr_clap', volume: 0.85, patterns: [{ length: 16, notes: CLAP_SW }, { length: 16, notes: CLAP_SW }] },
  { name: 'Hat', preset: 'dr_hat_closed', volume: 0.55, pan: 0.15, patterns: [{ length: 16, notes: HATC_SW }, { length: 16, notes: HATC_SW }] },
  { name: 'Open Hat', preset: 'dr_hat_open', volume: 0.45, pan: -0.15, patterns: [{ length: 16, notes: HATO_SW }, { length: 16, notes: HATO_SW }] },
  { name: 'Bass', preset: 'bass_reese', volume: 0.9, patterns: [{ length: 16, notes: BASS_SW_A }, { length: 16, notes: BASS_SW_B }] },
  { name: 'Sweep Pad', preset: 'pad_sweep', volume: 0.45, patterns: [{ length: 16, notes: PADSWEEP_A }, { length: 16, notes: PADSWEEP_B }] },
  { name: 'Arp', preset: 'seq_pulse', volume: 0.55, pan: 0.3, patterns: [{ length: 16, notes: ARP_SW_A }, { length: 16, notes: ARP_SW_B }] },
  { name: 'Lead', preset: 'lead_sync', volume: 0.75, patterns: [{ length: 16, notes: LEADSYNC_A }, { length: 16, notes: LEADSYNC_B }] },
];

// =============================================================== 4. Pixel Rush（チップチューン）
const KICK_CHIP: [number, number, number, number][] = [[0, 60, 1, 1], [4, 60, 1, 0.9], [8, 60, 1, 1], [12, 60, 1, 0.9]];
const KICK_CHIP_B: [number, number, number, number][] = [
  [0, 60, 1, 1], [3, 60, 1, 0.7], [6, 60, 1, 0.85], [8, 60, 1, 1], [11, 60, 1, 0.7], [14, 60, 1, 0.85],
];
const CLAP_CHIP: [number, number, number, number][] = [[4, 60, 1, 0.85], [12, 60, 1, 0.85]];
const HAT_CHIP: [number, number, number, number][] = [
  [0, 60, 1, 0.45], [2, 60, 1, 0.4], [4, 60, 1, 0.45], [6, 60, 1, 0.4],
  [8, 60, 1, 0.45], [10, 60, 1, 0.4], [12, 60, 1, 0.45], [14, 60, 1, 0.4],
];
const BASSPLUCK_A: [number, number, number, number][] = [
  [0, 48, 1, 0.85], [2, 48, 1, 0.6], [4, 51, 1, 0.85], [6, 48, 1, 0.6],
  [8, 53, 1, 0.85], [10, 53, 1, 0.6], [12, 50, 1, 0.85], [14, 48, 1, 0.6],
];
const BASSPLUCK_B: [number, number, number, number][] = [
  [0, 46, 1, 0.85], [2, 46, 1, 0.6], [4, 49, 1, 0.85], [6, 46, 1, 0.6],
  [8, 51, 1, 0.85], [10, 51, 1, 0.6], [12, 48, 1, 0.85], [14, 46, 1, 0.6],
];
const LEADCHIP_A: [number, number, number, number][] = [
  [0, 72, 1, 0.9], [1, 72, 1, 0.7], [2, 75, 1, 0.9], [3, 72, 1, 0.7], [4, 79, 2, 0.95],
  [6, 77, 1, 0.7], [7, 75, 1, 0.7], [8, 72, 1, 0.9], [9, 72, 1, 0.7], [10, 74, 1, 0.9],
  [11, 72, 1, 0.7], [12, 77, 2, 0.9], [14, 75, 2, 0.85],
];
const LEADCHIP_B: [number, number, number, number][] = [
  [0, 74, 1, 0.9], [1, 74, 1, 0.7], [2, 77, 1, 0.9], [3, 74, 1, 0.7], [4, 81, 2, 0.95],
  [6, 79, 1, 0.7], [7, 77, 1, 0.7], [8, 74, 1, 0.9], [9, 74, 1, 0.7], [10, 76, 1, 0.9],
  [11, 74, 1, 0.7], [12, 79, 4, 0.9],
];
const ARPBLIP_A: [number, number, number, number][] = [
  [0, 84, 1, 0.6], [2, 84, 1, 0.5], [4, 84, 1, 0.6], [6, 84, 1, 0.5],
  [8, 86, 1, 0.6], [10, 86, 1, 0.5], [12, 84, 1, 0.6], [14, 84, 1, 0.5],
];
const ARPBLIP_B: [number, number, number, number][] = [
  [0, 86, 1, 0.6], [2, 86, 1, 0.5], [4, 86, 1, 0.6], [6, 86, 1, 0.5],
  [8, 89, 1, 0.6], [10, 89, 1, 0.5], [12, 86, 1, 0.6], [14, 86, 1, 0.5],
];
const BELLMETAL_A: [number, number, number, number][] = [[7, 60, 1, 0.5], [15, 60, 1, 0.5]];
const BELLMETAL_B: [number, number, number, number][] = [[7, 62, 1, 0.5], [15, 60, 1, 0.5]];

const PIXEL_TRACKS: DemoTrack[] = [
  { name: 'Kick', preset: 'dr_kick_tight', volume: 0.95, patterns: [{ length: 16, notes: KICK_CHIP }, { length: 16, notes: KICK_CHIP_B }] },
  { name: 'Clap', preset: 'dr_clap', volume: 0.75, patterns: [{ length: 16, notes: CLAP_CHIP }, { length: 16, notes: CLAP_CHIP }] },
  { name: 'Hat', preset: 'dr_hat_closed', volume: 0.5, pan: 0.1, patterns: [{ length: 16, notes: HAT_CHIP }, { length: 16, notes: HAT_CHIP }] },
  { name: 'Bass', preset: 'bass_pluck', volume: 0.75, patterns: [{ length: 16, notes: BASSPLUCK_A }, { length: 16, notes: BASSPLUCK_B }] },
  { name: 'Lead', preset: 'lead_chip', volume: 0.8, patterns: [{ length: 16, notes: LEADCHIP_A }, { length: 16, notes: LEADCHIP_B }] },
  { name: 'Arp', preset: 'seq_blip', volume: 0.5, pan: 0.25, patterns: [{ length: 16, notes: ARPBLIP_A }, { length: 16, notes: ARPBLIP_B }] },
  { name: 'Bell', preset: 'bell_metal', volume: 0.4, pan: -0.25, patterns: [{ length: 16, notes: BELLMETAL_A }, { length: 16, notes: BELLMETAL_B }] },
];

const SPECS: DemoSpec[] = [
  { id: 'sunrise', bpm: 112, swing: 0.12, tracks: SUNRISE_TRACKS },
  { id: 'midnight', bpm: 78, swing: 0.08, tracks: MIDNIGHT_TRACKS },
  { id: 'neon', bpm: 120, swing: 0.05, tracks: NEON_TRACKS },
  { id: 'pixel', bpm: 150, swing: 0, tracks: PIXEL_TRACKS },
];

function build(spec: DemoSpec) {
  const tracks = spec.tracks.map((tr, i) => {
    const patch: Patch = tr.preset ? getPreset(tr.preset) : basePatch();
    patch.pan = tr.pan ?? 0;
    const patterns: Pattern[] = [];
    for (let s = 0; s < PATTERN_SLOTS; s++) {
      const src = tr.patterns[s];
      patterns.push(src ? pattern(src.length, src.notes) : emptyPattern());
    }
    return {
      id: `t${i + 1}`,
      name: tr.name,
      patch,
      patterns,
      activePattern: 0,
      muted: false,
      solo: false,
      volume: tr.volume ?? 0.85,
      pan: tr.pan ?? 0,
    };
  });

  const sceneA: Record<string, number> = {};
  const sceneB: Record<string, number> = {};
  for (const tr of tracks) {
    sceneA[tr.id] = 0;
    sceneB[tr.id] = 1;
  }

  return {
    format: 'akatsuki-synth',
    version: 2,
    bpm: spec.bpm,
    swing: spec.swing,
    mode: 'pattern' as const,
    master: undefined,
    scenes: [
      { name: 'Intro', bars: 4, patterns: sceneA },
      { name: 'Verse', bars: 4, patterns: sceneB },
    ],
    tracks,
  };
}

export interface DemoEntry {
  id: string;
  /** 一覧表示用（ロケールに応じて翻訳される） */
  title: () => string;
  subtitle: () => string;
  /** 呼び出すたびに新しいトラック・パターンを作る（使い回すと編集が原本を書き換えてしまうため） */
  build: () => ReturnType<typeof build>;
}

export const DEMOS: DemoEntry[] = SPECS.map((spec) => ({
  id: spec.id,
  title: () => t(`demo.${spec.id}.title`),
  subtitle: () => t(`demo.${spec.id}.subtitle`),
  build: () => build(spec),
}));

/** 起動時に読み込むデフォルトのデモ曲 */
export function demoSong() {
  return DEMOS[0].build();
}
