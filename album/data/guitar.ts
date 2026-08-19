/**
 * アルバム「天問」(Tenmon) — ギター・パートのスタンドアロン・レンダー用データ。
 *
 * guitar/src/data/demos.ts (元は PR でマージされ、その後 UI の Demo 機能ごと
 * revert された) の tenmon-01..10 のデータをそのまま移植し、コーラス数
 * (repeat) だけを album-render-spec.md のロックされた表に合わせて調整した。
 *
 * chords/patternId/bpm/minFret/palm はオリジナルの音楽的な作り込みを一切
 * 変えていない。実際に PerformanceEvent[] へ展開する処理は、UI が使っている
 * のと全く同じ実モジュール (arrange / parseChord / findPattern / findTuning)
 * を再利用する — チェイン自体を再実装はしない。
 */
import type { PerformanceEvent } from '../../guitar/src/audio/types';
import { arrange, arrangeDuration, type ArrangeBar } from '../../guitar/src/music/arranger';
import { parseChord } from '../../guitar/src/music/chords';
import { findPattern } from '../../guitar/src/music/strum';
import { findTuning } from '../../guitar/src/music/tunings';
import { findPreset } from '../../guitar/src/audio/presets';

/** guitar/src/ui/App.ts の DEFAULT_UI と同じ値（デモ再生時に実際に使われる初期値） */
const DEFAULT_STRUM_SPREAD = 0.014;
const DEFAULT_HUMANIZE = 0.3;

interface TenmonTrackSpec {
  id: string;
  title: string;
  presetId: string;
  patternId: string;
  bpm: number;
  /** 1コーラス分のコード進行（1小節1コード） */
  chords: string[];
  /** コーラス数。album-render-spec.md でロックされた N */
  repeat: number;
  minFret?: number;
  palm?: number;
}

// --------------------------------------------------------------------
// アルバム「天問」(Tenmon) 全10曲分のデータ。
// chords / patternId / bpm / minFret / palm は元の guitar/src/data/demos.ts
// の tenmon-01..10 と完全に同一（音楽的な作り込みは無変更）。
// repeat のみ album-render-spec.md のロックされたコーラス数 N に合わせている。
//
// tenmon-09 だけ、元の repeat=18 (合計172.8s) から spec 表の N=19
// (合計182.4s) へ変更した。理由: 8小節/コーラス・BPM200・
// chorus_sec=9.6s の掛け算で他の6パートと1曲の合計尺を一致させる必要が
// あり、spec のロック値がこの曲だけ元の値と食い違っていたため
// （spec のコメントにある「ソロ16コーラス」= N-3 = 19-3 = 16 とも整合する）。
// 他の9曲は元の repeat 値がそのまま spec のロック値 N と一致していたので
// 変更していない（1小節あたりの拍数・bpm・chords の小節数から算出される
// 1コーラスの秒数が、spec 表の Chorus sec 列と全て一致することを確認済み）。
// --------------------------------------------------------------------
const TENMON_TRACKS: TenmonTrackSpec[] = [
  {
    id: 'tenmon-01',
    title: '混沌の序章',
    presetId: 'jazz',
    patternId: 'threefinger',
    bpm: 96,
    chords: ['Am7', 'Am7', 'Dm7', 'Dm7', 'Am7', 'Dm7', 'E7#9', 'Am7'],
    repeat: 9, // 8小節 x 4*60/96=2.5s/拍 -> 20.0s/コーラス x 9 = 180.0s
    minFret: 5,
  },
  {
    id: 'tenmon-02',
    title: '誰が空を創ったのか',
    presetId: 'blues',
    patternId: 'shuffle',
    bpm: 144,
    chords: [
      'Bb7', 'Eb7', 'Bb7', 'Bb7', 'Eb7', 'Edim7',
      'Bb7', 'G7', 'Cm7', 'F7', 'Bb7', 'Cm7',
    ],
    repeat: 9, // 12小節 -> 20.0s/コーラス x 9 = 180.0s
    minFret: 3,
  },
  {
    id: 'tenmon-03',
    title: '星の回廊',
    presetId: 'jazz',
    patternId: 'waltz',
    bpm: 168,
    chords: [
      'Dm7', 'Gm7', 'C7', 'Fmaj7', 'Bbmaj7', 'E7#9',
      'Am7', 'D7', 'Gm7', 'C7', 'Dm7', 'Dm7',
    ],
    repeat: 14, // 3/4拍子・12小節 -> 12.857s/コーラス x 14 = 180.0s
    minFret: 4,
  },
  {
    id: 'tenmon-04',
    title: '地の果てへ',
    presetId: 'nylon',
    patternId: 'bossa',
    bpm: 132,
    chords: ['Fmaj7', 'Em7b5', 'Dm7', 'Gm7', 'Fmaj7', 'Em7b5', 'Dm7', 'Cmaj7'],
    repeat: 12, // 8小節 -> 14.545s/コーラス x 12 = 174.5s
    minFret: 2,
  },
  {
    id: 'tenmon-05',
    title: '問いかける月',
    presetId: 'fingerpick',
    patternId: 'ballad',
    bpm: 63,
    chords: ['Ebmaj7', 'Cm7', 'Fm7', 'Bb7', 'Ebmaj7', 'Ab7', 'Gm7', 'Fm7'],
    repeat: 6, // 8小節 -> 30.476s/コーラス x 6 = 182.9s
    minFret: 5,
    palm: 0.22,
  },
  {
    id: 'tenmon-06',
    title: '龍の眠り',
    presetId: 'jazz',
    patternId: 'shuffle',
    bpm: 176,
    chords: [
      'Cm7', 'Cm7', 'Fm7', 'Bb7', 'Ebmaj7', 'Abmaj7', 'Dm7b5', 'G7#9',
      'Cm7', 'Fm7', 'Ebmaj7', 'Dm7b5', 'Cm7', 'Ab7', 'G7', 'Cm7',
    ],
    repeat: 8, // 16小節 -> 21.818s/コーラス x 8 = 174.5s
    minFret: 5,
  },
  {
    id: 'tenmon-07',
    title: '見えない橋',
    presetId: 'nylon',
    patternId: 'sixteen',
    bpm: 138,
    chords: ['Am7', 'Am7', 'Dm7', 'E7#9', 'Am7', 'Dm7', 'E7#9', 'Am7'],
    repeat: 13, // 8小節 -> 13.913s/コーラス x 13 = 180.9s
    minFret: 2,
  },
  {
    id: 'tenmon-08',
    title: '光と影のあいだ',
    presetId: 'jazz',
    patternId: 'slowarp',
    bpm: 120,
    chords: ['Dm7', 'Dm7', 'Dm7', 'Dm7', 'Ebmaj7', 'Ebmaj7', 'Dm7', 'Dm7'],
    repeat: 11, // 8小節 -> 16.0s/コーラス x 11 = 176.0s
    minFret: 5,
  },
  {
    id: 'tenmon-09',
    title: '天の川を渡る',
    presetId: 'jazz',
    patternId: 'shuffle',
    bpm: 200,
    chords: ['Bbmaj7', 'Gm7', 'Cm7', 'F7', 'Fm7', 'Bb7', 'Ebmaj7', 'Ebm6'],
    // album-render-spec.md でロックされた N=19（元データは repeat=18 だった）。
    // 8小節 -> 9.6s/コーラス x 19 = 182.4s。Head,Head,Solo x16,Head-out。
    repeat: 19,
    minFret: 7,
  },
  {
    id: 'tenmon-10',
    title: '終わりなき問い',
    presetId: 'ambient',
    patternId: 'whole',
    bpm: 58,
    chords: ['Gmaj7', 'Em7', 'Am7', 'D7', 'Gmaj7', 'Cmaj7', 'Am7', 'Gmaj7'],
    repeat: 5, // 8小節 -> 33.103s/コーラス x 5 = 165.5s
    minFret: 3,
  },
];

function findTrack(id: string): TenmonTrackSpec {
  const track = TENMON_TRACKS.find((t) => t.id === id);
  if (!track) throw new Error(`unknown tenmon track id: ${id}`);
  return track;
}

/** guitar/src/ui/App.ts の buildBars() と同じ変換（コード名 -> ArrangeBar） */
function buildBars(chordNames: string[]): ArrangeBar[] {
  const bars: ArrangeBar[] = [];
  for (const name of chordNames) {
    const chord = parseChord(name);
    if (!chord) throw new Error(`unparseable chord: ${name}`);
    bars.push({ chord });
  }
  return bars;
}

export interface TenmonGuitarTrack {
  events: PerformanceEvent[];
  presetId: string;
  tuning: number[];
  durationSec: number;
}

/**
 * アルバム「天問」のギター・パートを、実際のアプリと同一のアレンジャー経路
 * (arrange / parseChord / findPattern) で PerformanceEvent[] に展開する。
 * guitar/src/ui/App.ts の playDemo() と同じ処理を、UI 抜きで再現している。
 */
export function guitarTenmonTrack(id: string): TenmonGuitarTrack {
  const track = findTrack(id);
  const pattern = findPattern(track.patternId);
  const preset = findPreset(track.presetId);
  // applyPreset() はプリセットが tuningId を明示していない限りベース
  // (= 標準チューニング) を引き継ぐ。天問の全プリセット (jazz/blues/nylon/
  // fingerpick/ambient) はどれも tuningId を指定しないため常に 'standard'。
  const tuningId = preset.settings.tuningId ?? 'standard';
  const tuning = findTuning(tuningId);

  const one = buildBars(track.chords);
  const all: ArrangeBar[] = [];
  for (let i = 0; i < track.repeat; i++) all.push(...one);

  const events = arrange(tuning, all, pattern, {
    bpm: track.bpm,
    strumSpread: DEFAULT_STRUM_SPREAD,
    humanize: DEFAULT_HUMANIZE,
    palm: track.palm,
    minFret: track.minFret,
  });

  const durationSec = arrangeDuration(all, pattern, track.bpm);

  return {
    events,
    presetId: track.presetId,
    tuning: tuning.notes,
    durationSec,
  };
}

export function listTenmonTrackIds(): string[] {
  return TENMON_TRACKS.map((t) => t.id);
}
