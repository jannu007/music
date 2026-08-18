/**
 * Akatsuki Synth — デモ曲集
 * 初回起動でもすぐに「鳴る状態」から始められるよう、起動時に1曲目を自動で読み込みます。
 * 「ソング構成」タブの一覧から、他のジャンルのデモ曲にも切り替えられます。
 */
import { basePatch, getPreset } from '../audio/presets';
import type { Patch } from '../audio/types';
import { emptyPattern, PATTERN_SLOTS, STEPS_PER_BAR, STEPS_PER_BEAT, type Pattern } from '../audio/Sequencer';
import { t } from './i18n';

interface DemoTrack {
  name: string;
  preset: string;
  volume?: number;
  pan?: number;
  patterns: { length: number; notes: [number, number, number, number][] }[];
}

/** シーン（曲構成の1区間）：全トラックが同じパターン・スロットへ一斉に切り替わる */
interface SceneSpec {
  name: string;
  bars: number;
  slot: number;
}

interface DemoSpec {
  id: string;
  bpm: number;
  swing: number;
  tracks: DemoTrack[];
  /** 省略時は従来通り Intro(slot0)/Verse(slot1) の2シーン構成にフォールバックする */
  scenes?: SceneSpec[];
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

// ============================================================ 5-14. 「天問」(Tenmon) — オリジナル・ジャズ組曲
// 10曲通しのオリジナル・ジャズアルバム。各曲を「ブラシ・ドラム＋ウォーキングベース＋
// ローズ／ピアノのコンピング＋リード（フック→ソロ）」の生ジャズコンボ編成で自動生成する。
// コード進行とヘッド・フックはアルバム仕様書（album-tenmon-spec.md）どおり。
// 減7度／半音アプローチを用いた歩くベース、シンコペーションを効かせたコンピング、
// コードトーン＋クロマチック・アプローチで生成する即興ソロラインなど、既存4曲
// （ハウス／アンビエント／シンセウェイブ／チップチューン）とは似ても似つかないジャズの語法で書く。
type Notes = [number, number, number, number][];

const PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

function noteAt(pcName: string, octave: number): number {
  return PC[pcName] + (octave + 1) * 12;
}

/** "C5" / "Eb4" / "F#5" のような記譜をMIDIノート番号に変換 */
function midi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!m) throw new Error(`tenmon: bad note token "${name}"`);
  return noteAt(m[1] + (m[2] ?? ''), parseInt(m[3], 10));
}

function note(step: number, pitch: number, length: number, vel: number): [number, number, number, number] {
  return [step, pitch, length, Math.max(0.05, Math.min(1, vel))];
}

/** コード品質 → ルートからの音程（半音、1=3度 2=5度 3=7度） */
const QUALITIES: Record<string, number[]> = {
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  m7: [0, 3, 7, 10],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  '7alt': [0, 4, 6, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
};

interface ChordEvt {
  pc: string;
  q: string;
  beats: number;
}

/**
 * ヘッド・メロディのフック記法をノート配列に変換する。
 * "NOTE:BEATS"（四分音符=1拍）/ "r:BEATS"（休符）をスペース区切りで並べ、
 * "|" は小節の区切り（パース上は無視、拍数の合計だけを見る）。
 */
function hookNotes(tokens: string, vel = 0.95): Notes {
  const out: Notes = [];
  let step = 0;
  for (const raw of tokens.replace(/\|/g, ' ').trim().split(/\s+/)) {
    const [tok, beatStr] = raw.split(':');
    const lenSteps = Math.round(parseFloat(beatStr) * STEPS_PER_BEAT);
    if (tok !== 'r') out.push(note(step, midi(tok), lenSteps, vel));
    step += lenSteps;
  }
  return out;
}

/**
 * ジャズの定石どおりに生成する歩くベース：
 * 4拍コードは「ルート→5度→3度→次のコードへの半音アプローチ」、
 * 3拍は「ルート→5度→半音アプローチ」、2拍は「ルート→半音アプローチ」。
 * スケールを機械的になぞるのではなく、コードトーン＋クロマチック・アプローチで運指する。
 */
function walkingBass(chords: ChordEvt[], octave = 2, vel = 0.85): Notes {
  const out: Notes = [];
  let step = 0;
  const bs = STEPS_PER_BEAT;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const next = chords[(i + 1) % chords.length];
    const root = noteAt(c.pc, octave);
    const iv = QUALITIES[c.q];
    const third = root + iv[1];
    const fifth = root + iv[2];
    const nextRoot = noteAt(next.pc, octave);
    let approach = nextRoot - 1;
    if (approach === root || approach === third) approach = nextRoot + 1;
    if (c.beats >= 4) {
      out.push(
        note(step, root, bs, vel),
        note(step + bs, fifth, bs, vel * 0.92),
        note(step + bs * 2, third, bs, vel * 0.9),
        note(step + bs * 3, approach, bs, vel * 0.88)
      );
    } else if (c.beats === 3) {
      out.push(note(step, root, bs, vel), note(step + bs, fifth, bs, vel * 0.9), note(step + bs * 2, approach, bs, vel * 0.88));
    } else {
      out.push(note(step, root, bs, vel), note(step + bs, approach, bs, vel * 0.88));
    }
    step += c.beats * bs;
  }
  return out;
}

/** バラード用ベース：ルートを長く伸ばし、コードの最後で5度へ軽く動いて次へ橋渡しする */
function balladBass(chords: ChordEvt[], octave = 2, vel = 0.75): Notes {
  const out: Notes = [];
  let step = 0;
  const bs = STEPS_PER_BEAT;
  for (const c of chords) {
    const dur = c.beats * bs;
    const root = noteAt(c.pc, octave);
    const fifth = root + QUALITIES[c.q][2];
    if (c.beats >= 4) {
      out.push(note(step, root, dur - bs, vel), note(step + dur - bs, fifth, bs, vel * 0.7));
    } else {
      out.push(note(step, root, dur, vel));
    }
    step += dur;
  }
  return out;
}

function upperVoicing(c: ChordEvt, octave = 4): number[] {
  const root = noteAt(c.pc, octave);
  const iv = QUALITIES[c.q];
  return [root + iv[1], root + iv[2], root + iv[3], Math.min(96, root + 14)];
}

function compHits(dur: number): [number, number][] {
  // 3拍・4拍のコードは「頭拍＋2拍めのウラ」で食う、いわゆるチャールストン型のシンコペーション。
  // 2拍以下のコードはコード・チェンジが速いので一発だけ置く。
  if (dur >= 12) return [[0, 5], [6, dur - 7]];
  return [[0, dur - 1]];
}

/** シンコペーションを効かせたコンピング（頭拍を食う／2拍めのウラで刺す、を基本形にする） */
function compingChords(chords: ChordEvt[], octave = 4, vel = 0.6): Notes {
  const out: Notes = [];
  let step = 0;
  for (const c of chords) {
    const dur = c.beats * STEPS_PER_BEAT;
    const voicing = upperVoicing(c, octave);
    for (const [off, len] of compHits(dur)) for (const n of voicing) out.push(note(step + off, n, len, vel));
    step += dur;
  }
  return out;
}

/** ソロ・コーラス用の間を残したコンピング：一発だけ短く置いてソリストにスペースを譲る */
function compingSparse(chords: ChordEvt[], octave = 4, vel = 0.48): Notes {
  const out: Notes = [];
  let step = 0;
  for (const c of chords) {
    const dur = c.beats * STEPS_PER_BEAT;
    const voicing = upperVoicing(c, octave);
    const len = Math.max(2, Math.round(dur * 0.42));
    for (const n of voicing) out.push(note(step, n, len, vel));
    step += dur;
  }
  return out;
}

/** ペダル・パッド：コードのルート＋5度を長く伸ばして響きに色をつける */
function padPedal(chords: ChordEvt[], octave = 3, vel = 0.32): Notes {
  const out: Notes = [];
  let step = 0;
  for (const c of chords) {
    const dur = c.beats * STEPS_PER_BEAT;
    const root = noteAt(c.pc, octave);
    const fifth = root + QUALITIES[c.q][2];
    out.push(note(step, root, dur, vel), note(step, fifth, dur, vel * 0.75));
    step += dur;
  }
  return out;
}

/**
 * コードトーン＋半音アプローチで即興ソロラインを生成する。
 * ヘッドのフックとは別の輪郭になるよう、コードごとにジグザグの方向を反転させながら
 * アルペジオで運指し、各コードの最後の音は次のコードへの半音アプローチにする
 * （＝ビバップ的な「ターゲット・ノートへの半音進行」の定石）。
 */
function soloLine(chords: ChordEvt[], opts: { octave?: number; busy?: boolean; startIdx?: number; vel?: number } = {}): Notes {
  const octave = opts.octave ?? 4;
  const stepUnit = opts.busy ? 2 : 4;
  const vel = opts.vel ?? 0.82;
  const out: Notes = [];
  let step = 0;
  let dir = (opts.startIdx ?? 0) % 2 === 0 ? 1 : -1;
  let toneIdx = opts.startIdx ?? 2;
  for (let ci = 0; ci < chords.length; ci++) {
    const c = chords[ci];
    const next = chords[(ci + 1) % chords.length];
    const dur = c.beats * STEPS_PER_BEAT;
    const root = noteAt(c.pc, octave);
    const iv = QUALITIES[c.q];
    const tones = [root, root + iv[1], root + iv[2], root + iv[3], Math.min(96, root + 12), Math.min(96, root + 14)];
    const nextRoot = noteAt(next.pc, octave);
    const positions: number[] = [];
    for (let s = 0; s < dur; s += stepUnit) positions.push(s);
    // 2コードにつき1回、最後の一打を抜いて「間」を作る（機械的な8分の羅列にしない）
    const skipLast = ci % 2 === 1 && positions.length > 2;
    const usable = skipLast ? positions.slice(0, -1) : positions;
    for (let pi = 0; pi < usable.length; pi++) {
      const isLast = pi === usable.length - 1;
      let pitch: number;
      if (isLast) {
        pitch = dir > 0 ? nextRoot - 1 : nextRoot + 1;
      } else {
        toneIdx = (toneIdx + dir + tones.length) % tones.length;
        pitch = tones[toneIdx];
      }
      const nlen = pi < usable.length - 1 ? usable[pi + 1] - usable[pi] : dur - usable[pi];
      out.push(note(step + usable[pi], pitch, nlen, pi % 2 === 0 ? vel : vel * 0.85));
    }
    dir = -dir;
    step += dur;
  }
  return out;
}

type DrumStyle = 'swing' | 'waltz' | 'bossa' | 'ballad' | 'latin' | 'modal';

interface DrumKit {
  topPreset: string;
  hatPreset: string;
  top: Notes;
  hat: Notes;
  kick: Notes;
  rim: Notes;
}

/** ブラシ・ジャズの各スタイル別、1小節ぶんのグルーヴ（すべて既存のドラム・プリセットのみ使用） */
function drumKit(style: DrumStyle, busy: boolean): DrumKit {
  switch (style) {
    case 'waltz': {
      const rv = busy ? 0.58 : 0.48;
      return {
        topPreset: 'dr_ride', hatPreset: 'dr_hat_closed',
        top: [note(0, 60, 3, rv), note(4, 60, 3, rv * 0.82), note(8, 60, 3, rv * 0.88)],
        hat: [note(8, 60, 1, 0.38)],
        kick: [note(0, 60, 2, 0.36)],
        rim: busy ? [note(6, 60, 1, 0.32), note(10, 60, 1, 0.28)] : [note(6, 60, 1, 0.26)],
      };
    }
    case 'bossa': {
      return {
        topPreset: 'dr_shaker', hatPreset: 'dr_hat_closed',
        top: [note(0, 60, 1, 0.34), note(2, 60, 1, 0.26), note(4, 60, 1, 0.3), note(6, 60, 1, 0.26), note(8, 60, 1, 0.34), note(10, 60, 1, 0.26), note(12, 60, 1, 0.3), note(14, 60, 1, 0.26)],
        hat: [note(4, 60, 1, 0.28), note(12, 60, 1, 0.28)],
        kick: [note(0, 60, 2, 0.42), note(6, 60, 1, 0.3), note(10, 60, 1, 0.34)],
        rim: busy
          ? [note(0, 60, 1, 0.3), note(3, 60, 1, 0.34), note(6, 60, 1, 0.26), note(10, 60, 1, 0.32), note(13, 60, 1, 0.28)]
          : [note(3, 60, 1, 0.28), note(10, 60, 1, 0.3)],
      };
    }
    case 'ballad': {
      return {
        topPreset: 'dr_ride', hatPreset: 'dr_hat_closed',
        top: [note(0, 60, 4, 0.3), note(8, 60, 4, 0.26)],
        hat: [],
        kick: [note(0, 60, 3, 0.28)],
        rim: busy ? [note(10, 60, 1, 0.22), note(14, 60, 1, 0.2)] : [note(10, 60, 1, 0.18)],
      };
    }
    case 'latin': {
      return {
        topPreset: 'dr_clave', hatPreset: 'dr_cowbell',
        top: [note(0, 60, 1, 0.55), note(3, 60, 1, 0.5), note(6, 60, 1, 0.5), note(10, 60, 1, 0.55), note(12, 60, 1, 0.5)],
        hat: [note(2, 60, 1, 0.34), note(6, 60, 1, 0.3), note(10, 60, 1, 0.34), note(14, 60, 1, 0.3)],
        kick: [note(0, 60, 1, 0.42), note(7, 60, 1, 0.34), note(12, 60, 1, 0.4)],
        rim: busy ? [note(3, 60, 1, 0.3), note(9, 60, 1, 0.28), note(13, 60, 1, 0.3)] : [note(9, 60, 1, 0.26)],
      };
    }
    case 'modal': {
      const rv = busy ? 0.5 : 0.4;
      return {
        topPreset: 'dr_ride', hatPreset: 'dr_hat_closed',
        top: [note(0, 60, 4, rv), note(4, 60, 4, rv * 0.8), note(8, 60, 4, rv * 0.85), note(12, 60, 4, rv * 0.8)],
        hat: [note(4, 60, 1, 0.36), note(12, 60, 1, 0.36)],
        kick: [note(0, 60, 2, 0.34)],
        rim: busy ? [note(6, 60, 1, 0.3), note(14, 60, 1, 0.32)] : [note(14, 60, 1, 0.24)],
      };
    }
    case 'swing':
    default: {
      const rv = busy ? 0.62 : 0.5;
      return {
        topPreset: 'dr_ride', hatPreset: 'dr_hat_closed',
        // 「スパン・スパンガラン」の定番スウィング・ライド（1拍め、2拍めのウラ、3拍め、4拍めのウラ）
        top: [note(0, 60, 2, rv), note(4, 60, 2, rv * 0.82), note(6, 60, 1, rv * 0.65), note(8, 60, 2, rv * 0.92), note(12, 60, 2, rv * 0.82), note(14, 60, 1, rv * 0.65)],
        hat: [note(4, 60, 1, 0.4), note(12, 60, 1, 0.4)],
        kick: busy ? [note(0, 60, 2, 0.5), note(10, 60, 1, 0.32)] : [note(0, 60, 2, 0.38)],
        rim: busy ? [note(3, 60, 1, 0.38), note(7, 60, 1, 0.3), note(13, 60, 1, 0.42)] : [note(3, 60, 1, 0.28), note(11, 60, 1, 0.26)],
      };
    }
  }
}

interface TenmonDef {
  id: string;
  bpm: number;
  beatsPerBar: number;
  chorusBars: number;
  swing: number;
  chords: ChordEvt[];
  hook: string;
  leadPreset: string;
  isBallad?: boolean;
  padPreset?: string;
  drums: DrumStyle;
  /** コーラス数（ヘッド／ソロ1／ソロ2／アウトヘッド）とタグ（エンディング）の小節数 */
  rep: { r0: number; r1: number; r2: number; rout: number; tag: number };
}

/** ジャズコンボ編成（ブラシ・ドラム4声＋クラッシュ＋ベース＋ローズ＋リード[+パッド]）を1曲ぶん組み立てる */
function buildTenmon(def: TenmonDef): DemoSpec {
  const barSteps = def.beatsPerBar * STEPS_PER_BEAT; // 曲の拍子に応じた実小節の長さ（ステップ数）
  const toEngineBars = (musicalBars: number) => (musicalBars * barSteps) / STEPS_PER_BAR;

  const chorusLen = barSteps * def.chorusBars;
  const headLen = barSteps * 4; // フックは常に4小節ぶんの記譜
  const tagLen = barSteps * def.rep.tag;

  const head = hookNotes(def.hook);
  const bass = def.isBallad ? balladBass(def.chords) : walkingBass(def.chords);
  const comp = compingChords(def.chords);
  const compSolo = compingSparse(def.chords);
  const solo1 = soloLine(def.chords, { octave: 4, busy: false, startIdx: 2 });
  const solo2 = soloLine(def.chords, { octave: 4, busy: !def.isBallad, startIdx: 5, vel: 0.86 });

  const finalChord = def.chords[0]; // どの曲も先頭コードがトニック（i / I）に戻る作りにしてある
  const tagBassRoot = noteAt(finalChord.pc, 2);
  const tagLeadRoot = noteAt(finalChord.pc, 5);
  const tagVoicing = upperVoicing(finalChord, 4);

  const kitHead = drumKit(def.drums, false);
  const kitSolo = drumKit(def.drums, true);

  function pat(length: number, notes: Notes) {
    return { length, notes };
  }

  const tracks: DemoTrack[] = [
    {
      name: 'Ride', preset: kitHead.topPreset, volume: 0.55,
      patterns: [pat(barSteps, kitHead.top), pat(barSteps, kitSolo.top), pat(barSteps, kitSolo.top), pat(tagLen, [note(0, 60, tagLen, 0.42)])],
    },
    {
      name: 'Hi-Hat', preset: kitHead.hatPreset, volume: 0.42, pan: -0.12,
      patterns: [pat(barSteps, kitHead.hat), pat(barSteps, kitSolo.hat), pat(barSteps, kitSolo.hat), pat(tagLen, [])],
    },
    {
      name: 'Kick', preset: 'dr_kick_tight', volume: 0.55,
      patterns: [pat(barSteps, kitHead.kick), pat(barSteps, kitSolo.kick), pat(barSteps, kitSolo.kick), pat(tagLen, [note(0, 60, 2, 0.4)])],
    },
    {
      name: 'Brush', preset: 'dr_snare_rim', volume: 0.5, pan: 0.15,
      patterns: [pat(barSteps, kitHead.rim), pat(barSteps, kitSolo.rim), pat(barSteps, kitSolo.rim), pat(tagLen, [])],
    },
    {
      name: 'Crash', preset: 'dr_crash', volume: 0.5,
      patterns: [pat(barSteps, []), pat(barSteps, []), pat(barSteps, []), pat(tagLen, [note(0, 60, 4, 0.55)])],
    },
    {
      name: 'Bass', preset: 'bass_sub', volume: 0.9,
      patterns: [pat(chorusLen, bass), pat(chorusLen, bass), pat(chorusLen, bass), pat(tagLen, [note(0, tagBassRoot, tagLen, 0.7)])],
    },
    {
      name: 'Rhodes', preset: 'keys_ep', volume: 0.62,
      patterns: [pat(chorusLen, comp), pat(chorusLen, compSolo), pat(chorusLen, compSolo), pat(tagLen, tagVoicing.map((n) => note(0, n, tagLen, 0.5)))],
    },
    {
      name: 'Lead', preset: def.leadPreset, volume: 0.78,
      patterns: [pat(headLen, head), pat(chorusLen, solo1), pat(chorusLen, solo2), pat(tagLen, [note(0, tagLeadRoot, tagLen, 0.85)])],
    },
  ];

  if (def.padPreset) {
    const pad = padPedal(def.chords);
    tracks.push({
      name: 'Pad', preset: def.padPreset, volume: 0.4,
      patterns: [pat(chorusLen, pad), pat(chorusLen, pad), pat(chorusLen, pad), pat(tagLen, tagVoicing.map((n) => note(0, n, tagLen, 0.35)))],
    });
  }

  const scenes: SceneSpec[] = [{ name: 'Head', bars: toEngineBars(def.chorusBars * def.rep.r0), slot: 0 }];
  if (def.rep.r1 > 0) scenes.push({ name: 'Solo 1', bars: toEngineBars(def.chorusBars * def.rep.r1), slot: 1 });
  if (def.rep.r2 > 0) scenes.push({ name: 'Solo 2', bars: toEngineBars(def.chorusBars * def.rep.r2), slot: 2 });
  scenes.push({ name: 'Head Out', bars: toEngineBars(def.chorusBars * def.rep.rout), slot: 0 });
  scenes.push({ name: 'Tag', bars: toEngineBars(def.rep.tag), slot: 3 });

  return { id: def.id, bpm: def.bpm, swing: def.swing, tracks, scenes };
}

const TENMON_DEFS: TenmonDef[] = [
  {
    // #1 混沌の序章 — Am dorian, 4/4, 96bpm, モーダル・スウィング（寂寥感のあるヴァンプ）
    // 尺: (2+3+2+1)*8小節 + 4小節タグ = 68小節 * 2.5s/小節 = 170.0s (2:50)
    id: 'tenmon-01', bpm: 96, beatsPerBar: 4, chorusBars: 8, swing: 0.48,
    chords: [
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 },
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'E', q: '7alt', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 },
    ],
    hook: 'A4:0.5 C5:0.5 r:1 E5:1 D5:0.5 C5:0.5 | A4:1 r:2 D5:0.5 F5:0.5 | E5:1 D5:0.5 C5:0.5 A4:1 r:1 | G4:0.5 A4:1.5 r:2',
    leadPreset: 'lead_flute', padPreset: 'pad_dark', drums: 'swing',
    rep: { r0: 2, r1: 3, r2: 2, rout: 1, tag: 4 },
  },
  {
    // #2 誰が空を創ったのか — Bb, 4/4, 144bpm, ミディアム・スウィングの12小節ブルース
    // 尺: (2+3+2+1)*12小節 + 4小節タグ = 100小節 * 1.667s/小節 = 166.7s (2:47)
    id: 'tenmon-02', bpm: 144, beatsPerBar: 4, chorusBars: 12, swing: 0.55,
    chords: [
      { pc: 'Bb', q: '7', beats: 4 }, { pc: 'Eb', q: '7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 },
      { pc: 'Eb', q: '7', beats: 4 }, { pc: 'E', q: 'dim7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 }, { pc: 'G', q: '7', beats: 4 },
      { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: '7', beats: 4 },
      { pc: 'Bb', q: '7', beats: 2 }, { pc: 'G', q: '7', beats: 2 }, { pc: 'C', q: 'm7', beats: 2 }, { pc: 'F', q: '7', beats: 2 },
    ],
    hook: 'Bb4:0.5 D5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1 | C5:1 r:1.5 Bb4:0.5 D5:1 | F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 Bb4:2 | r:4',
    leadPreset: 'lead_flute', drums: 'swing',
    rep: { r0: 2, r1: 3, r2: 2, rout: 1, tag: 4 },
  },
  {
    // #3 星の回廊 — Dm, 3/4, 168bpm, ジャズ・ワルツ（12小節フォーム、速いテンポなので反復多め）
    // 尺: (3+5+4+2)*12小節 + 8小節タグ = 176小節 * 1.0714s/小節 = 188.6s (3:09)
    id: 'tenmon-03', bpm: 168, beatsPerBar: 3, chorusBars: 12, swing: 0.18,
    chords: [
      { pc: 'D', q: 'm7', beats: 3 }, { pc: 'G', q: 'm7', beats: 3 }, { pc: 'C', q: '7', beats: 3 }, { pc: 'F', q: 'maj7', beats: 3 },
      { pc: 'Bb', q: 'maj7', beats: 3 }, { pc: 'E', q: '7alt', beats: 3 }, { pc: 'A', q: 'm7', beats: 3 }, { pc: 'D', q: '7', beats: 3 },
      { pc: 'G', q: 'm7', beats: 3 }, { pc: 'C', q: '7', beats: 3 }, { pc: 'D', q: 'm7', beats: 3 }, { pc: 'D', q: 'm7', beats: 3 },
    ],
    hook: 'D5:1 F5:0.5 A5:0.5 G5:1 | F5:1 E5:1 D5:1 | C5:1.5 D5:1.5 | A4:3',
    leadPreset: 'lead_flute', drums: 'waltz',
    rep: { r0: 3, r1: 5, r2: 4, rout: 2, tag: 8 },
  },
  {
    // #4 地の果てへ — F, 4/4, 132bpm, ボサノヴァ
    // 尺: (2+5+4+1)*8小節 + 4小節タグ = 100小節 * 1.818s/小節 = 181.8s (3:02)
    id: 'tenmon-04', bpm: 132, beatsPerBar: 4, chorusBars: 8, swing: 0,
    chords: [
      { pc: 'F', q: 'maj7', beats: 4 }, { pc: 'E', q: 'm7b5', beats: 2 }, { pc: 'A', q: '7alt', beats: 2 }, { pc: 'D', q: 'm7', beats: 4 },
      { pc: 'G', q: 'm7', beats: 2 }, { pc: 'C', q: '7', beats: 2 }, { pc: 'F', q: 'maj7', beats: 4 },
      { pc: 'E', q: 'm7b5', beats: 2 }, { pc: 'A', q: '7alt', beats: 2 }, { pc: 'D', q: 'm7', beats: 2 }, { pc: 'G', q: '7', beats: 2 }, { pc: 'C', q: 'maj7', beats: 4 },
    ],
    hook: 'C5:1 A4:0.5 F4:0.5 G4:1 A4:1 | Bb4:1 A4:0.5 G4:0.5 F4:2 | E4:1 G4:1 C5:1 Bb4:1 | A4:2 r:2',
    leadPreset: 'pluck_marimba', drums: 'bossa',
    rep: { r0: 2, r1: 5, r2: 4, rout: 1, tag: 4 },
  },
  {
    // #5 問いかける月 — Eb, 4/4, 63bpm, スロー・バラード
    // 尺: (2+2+0+1)*8小節 + 8小節タグ = 48小節 * 3.810s/小節 = 182.9s (3:03)
    id: 'tenmon-05', bpm: 63, beatsPerBar: 4, chorusBars: 8, swing: 0.05, isBallad: true,
    chords: [
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: 'm7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 },
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Ab', q: '7', beats: 4 },
      { pc: 'G', q: 'm7', beats: 2 }, { pc: 'C', q: '7', beats: 2 }, { pc: 'F', q: 'm7', beats: 2 }, { pc: 'Bb', q: '7', beats: 2 },
    ],
    hook: 'Bb4:1.5 Eb5:0.5 D5:1 C5:1 | Bb4:2 Ab4:1 G4:1 | F4:1 G4:1 Ab4:1 Bb4:1 | Eb5:4',
    leadPreset: 'strings_solo', padPreset: 'pad_shimmer', drums: 'ballad',
    rep: { r0: 2, r1: 2, r2: 0, rout: 1, tag: 8 },
  },
  {
    // #6 龍の眠り — Cm, 4/4, 176bpm, ハードバップ（16小節フォーム）
    // 尺: (2+3+2+1)*16小節 + 4小節タグ = 132小節 * 1.3636s/小節 = 180.0s (3:00)
    id: 'tenmon-06', bpm: 176, beatsPerBar: 4, chorusBars: 16, swing: 0.6,
    chords: [
      { pc: 'C', q: 'm7', beats: 4 }, { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: 'm7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 },
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Ab', q: 'maj7', beats: 4 }, { pc: 'D', q: 'm7b5', beats: 4 }, { pc: 'G', q: '7alt', beats: 4 },
      { pc: 'C', q: 'm7', beats: 4 },
      { pc: 'F', q: 'm7', beats: 2 }, { pc: 'Bb', q: '7', beats: 2 }, { pc: 'Eb', q: 'maj7', beats: 2 }, { pc: 'Ab', q: 'maj7', beats: 2 },
      { pc: 'D', q: 'm7b5', beats: 2 }, { pc: 'G', q: '7alt', beats: 2 },
      { pc: 'C', q: 'm7', beats: 4 }, { pc: 'Ab', q: '7', beats: 4 }, { pc: 'G', q: '7', beats: 4 }, { pc: 'C', q: 'm7', beats: 4 },
    ],
    hook: 'C5:0.5 Eb5:0.5 G5:0.5 F5:0.5 Eb5:1 D5:1 | C5:0.5 D5:0.5 Eb5:1 G4:2 | Ab4:0.5 Bb4:0.5 C5:0.5 D5:0.5 Eb5:2 | D5:1 C5:1 G4:2',
    leadPreset: 'lead_flute', drums: 'swing',
    rep: { r0: 2, r1: 3, r2: 2, rout: 1, tag: 4 },
  },
  {
    // #7 見えない橋 — Am, 4/4, 138bpm, アフロキューバン／ラテン・ジャズ（クラーベで、スウィングは0）
    // 尺: (2+4+4+2)*8小節 + 4小節タグ = 100小節 * 1.7391s/小節 = 173.9s (2:54)
    id: 'tenmon-07', bpm: 138, beatsPerBar: 4, chorusBars: 8, swing: 0,
    chords: [
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'E', q: '7alt', beats: 4 },
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'E', q: '7alt', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 },
    ],
    hook: 'E5:0.5 A5:0.5 G5:1 E5:1 r:1 | D5:0.5 C5:0.5 A4:1 r:2 | E5:0.5 F5:0.5 E5:0.5 D5:0.5 C5:2 | B4:1 C5:1 A4:2',
    leadPreset: 'pluck_marimba', drums: 'latin',
    rep: { r0: 2, r1: 4, r2: 4, rout: 2, tag: 4 },
  },
  {
    // #8 光と影のあいだ — D dorian, 4/4, 120bpm, 2コード・ヴァンプのモーダル・ジャズ（"So What"系、ストレート）
    // 尺: (2+4+3+2)*8小節 + 4小節タグ = 92小節 * 2.000s/小節 = 184.0s (3:04)
    id: 'tenmon-08', bpm: 120, beatsPerBar: 4, chorusBars: 8, swing: 0,
    chords: [
      { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 },
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 },
    ],
    hook: 'D5:1 F5:0.5 A5:0.5 G5:1 F5:1 | E5:0.5 D5:0.5 C5:1 D5:2 | Eb5:1 F5:1 Eb5:1 D5:1 | C5:2 D5:2',
    leadPreset: 'strings_solo', padPreset: 'pad_warm', drums: 'modal',
    rep: { r0: 2, r1: 4, r2: 3, rout: 2, tag: 4 },
  },
  {
    // #9 天の川を渡る — Bb, 4/4, 200bpm, アップテンポ・スウィング（リズムチェンジ系「A」セクション）
    // 尺: (3+6+6+2)*8小節 + 4小節タグ = 140小節 * 1.200s/小節 = 168.0s (2:48)
    id: 'tenmon-09', bpm: 200, beatsPerBar: 4, chorusBars: 8, swing: 0.5,
    chords: [
      { pc: 'Bb', q: 'maj7', beats: 4 }, { pc: 'G', q: 'm7', beats: 4 }, { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: '7', beats: 4 },
      { pc: 'F', q: 'm7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 }, { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Eb', q: 'm6', beats: 4 },
    ],
    hook: 'F5:0.5 G5:0.5 A5:0.5 Bb5:0.5 A5:1 G5:1 | F5:0.5 D5:0.5 C5:1 Bb4:2 | D5:0.5 Eb5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1 | C5:2 Bb4:2',
    leadPreset: 'lead_square', drums: 'swing',
    rep: { r0: 3, r1: 6, r2: 6, rout: 2, tag: 4 },
  },
  {
    // #10 終わりなき問い — G, 4/4, 58bpm, ルバート気味のエピローグ・バラード
    // 尺: (2+1+0+1)*8小節 + 8小節タグ = 40小節 * 4.1379s/小節 = 165.5s (2:46)
    id: 'tenmon-10', bpm: 58, beatsPerBar: 4, chorusBars: 8, swing: 0.05, isBallad: true,
    chords: [
      { pc: 'G', q: 'maj7', beats: 4 }, { pc: 'E', q: 'm7', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: '7', beats: 4 },
      { pc: 'G', q: 'maj7', beats: 4 }, { pc: 'C', q: 'maj7', beats: 4 },
      { pc: 'A', q: 'm7', beats: 2 }, { pc: 'D', q: '7', beats: 2 }, { pc: 'G', q: 'maj7', beats: 4 },
    ],
    hook: 'D5:1.5 B4:0.5 A4:1 G4:1 | F#4:2 E4:1 D4:1 | G4:1 A4:1 B4:1 D5:1 | G5:4',
    leadPreset: 'lead_whistle', padPreset: 'pad_glass', drums: 'ballad',
    rep: { r0: 2, r1: 1, r2: 0, rout: 1, tag: 8 },
  },
];

const TENMON_SPECS: DemoSpec[] = TENMON_DEFS.map(buildTenmon);

const SPECS: DemoSpec[] = [
  { id: 'sunrise', bpm: 112, swing: 0.12, tracks: SUNRISE_TRACKS },
  { id: 'midnight', bpm: 78, swing: 0.08, tracks: MIDNIGHT_TRACKS },
  { id: 'neon', bpm: 120, swing: 0.05, tracks: NEON_TRACKS },
  { id: 'pixel', bpm: 150, swing: 0, tracks: PIXEL_TRACKS },
  ...TENMON_SPECS,
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

  let scenes: { name: string; bars: number; patterns: Record<string, number> }[];
  if (spec.scenes && spec.scenes.length > 0) {
    // カスタム構成（天問アルバムのようなヘッド〜ソロ〜ヘッドの曲展開）：
    // 全トラックがシーンごとに同じパターン・スロットへ切り替わる
    scenes = spec.scenes.map((sc) => {
      const patterns: Record<string, number> = {};
      for (const tr of tracks) patterns[tr.id] = sc.slot;
      return { name: sc.name, bars: sc.bars, patterns };
    });
  } else {
    const sceneA: Record<string, number> = {};
    const sceneB: Record<string, number> = {};
    for (const tr of tracks) {
      sceneA[tr.id] = 0;
      sceneB[tr.id] = 1;
    }
    scenes = [
      { name: 'Intro', bars: 4, patterns: sceneA },
      { name: 'Verse', bars: 4, patterns: sceneB },
    ];
  }

  return {
    format: 'akatsuki-synth',
    version: 2,
    bpm: spec.bpm,
    swing: spec.swing,
    mode: 'pattern' as const,
    master: undefined,
    scenes,
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
