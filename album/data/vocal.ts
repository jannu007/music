// 天問 (Tenmon) — スタンドアロン・アルバム用ボーカル・パート（スキャット）
//
// vocal/src/data/demos.ts に以前存在した天問 Vol.1〜10 を、アプリの Demo UI
// から完全に切り離した「アルバム・ミックス書き出し専用」モジュールとして
// 再構成したもの。vocal/src 配下は一切変更していない。
//
// 前回ラウンドとの差分（/scratchpad/album-render-spec.md のロック仕様に合わせる）:
//   ・全曲、コーラス数（ヘッド×2 + ソロ×N-3 + ヘッドアウト×1 = 合計N）を
//     ロック済みの N に付け替えた。以前は各曲2:30〜3:30の範囲で自由に
//     コーラス数を選んでいたが（152.0〜191.1秒）、今回は他5パート
//     （ピアノ・ベース・ギター・ドラム・シンセ）と完全に同じ長さへ
//     揃える必要があるため、下表の値に統一した。
//   ・末尾のタグ／伸ばしは廃止し、ヘッドアウト・コーラスの最後の音符が
//     終わった瞬間に「N × 1コーラス秒」ぴったりになるようにした。
//   ・スキャットの節回し自体は前回と同じ生成方針（強拍にコードトーン、
//     弱拍にスケール／半音アプローチ、コーラスごとのエネルギー・カーブで
//     密度・音域を発展させる）を album/data/scat-gen.ts に汎用化して
//     再利用している。フック・モチーフ／コード進行／キー／使用ボイス／
//     ミックス設定は /scratchpad/album-tenmon-spec.md のオリジナル仕様と
//     前回選定した声から変更していない。
//
//   曲   小節/コーラス 拍子  BPM   コーラス秒  N（合計コーラス） ソロ数(N-3)
//   01   8            4/4   96    20.000s     9                 6
//   02   12           4/4   144   20.000s     9                 6
//   03   12           3/4   168   12.857s     14                11
//   04   8            4/4   132   14.545s     12                9
//   05   8            4/4   63    30.476s     6                 3
//   06   16           4/4   176   21.818s     8                 5
//   07   8            4/4   138   13.913s     13                10
//   08   8            4/4   120   16.000s     11                8
//   09   8            4/4   200   9.600s      19                16（トレーディング風の交互アーク）
//   10   8            4/4   58    33.103s     5                 2
//
// 09番だけは「速く短いコーラスを16連続でソロを回す」曲なので、単純な
// 山なりアークではなく、全体を漸増させながら偶数/奇数コーラスで
// 音域・密度を入れ替える alternate モードを使い、実際の「回し」らしい
// 抑揚をつけている。

import { createSong } from '../../vocal/src/audio/song';
import { parseChordText } from '../../vocal/src/audio/chords';
import { voiceDefaults, findVoice } from '../../vocal/src/audio/voices';
import { DEFAULT_MIX, type Expression, type MixSettings, type Song, type VocalNote, type ChordEvent, type AccompStyle } from '../../vocal/src/audio/types';
import { mulberry32, hashSeed, makeSyllablePicker, parseHook, generateHead, generateSection, type ChordSpan } from './scat-gen';

interface TenmonTrackSpec {
  id: string;
  title: string;
  subtitle: string;
  voiceId: string;
  bpm: number;
  beatsPerBar: number;
  barsPerChorus: number;
  /** 1行 = 1小節のコード進行（1コーラス分） */
  chords: string;
  /** 4小節分のフック・モチーフ（"NOTE:BEATS" / "r:BEATS"） */
  hook: string;
  /** ロック済みの合計コーラス数（ヘッド2 + ソロ(n-3) + ヘッドアウト1） */
  n: number;
  /** ヘッド／ソロ最低エネルギー（0..1、密度・音域の出発点） */
  baseEnergy: number;
  /** ソロの山場でのエネルギー */
  soloPeak: number;
  /** トラック09専用：漸増しつつ偶数/奇数コーラスで音域・密度を交互に振る */
  alternate?: boolean;
  mix: Partial<MixSettings>;
  expression: Partial<Expression>;
}

const TRACKS: TenmonTrackSpec[] = [
  {
    id: 'tenmon-01',
    title: '混沌の序章',
    subtitle: 'モーダル・スウィング｜天問 Vol.1',
    voiceId: 'nagi',
    bpm: 96,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Am7
Am7
Dm7
Dm7
Am7
Dm7
E7alt
Am7`,
    hook: 'A4:0.5 C5:0.5 r:1 E5:1 D5:0.5 C5:0.5 A4:1 r:1 D5:0.5 F5:0.5 E5:1 D5:0.5 C5:0.5 A4:1 r:1 G4:0.5 A4:1.5 r:2',
    n: 9,
    baseEnergy: 0.22,
    soloPeak: 0.75,
    mix: { reverbType: 'church', reverbMix: 0.42, delayMix: 0.1, accompLevel: 0.4 },
    expression: { vibDepth: 16, portamento: 120, scoop: 0.3, breathNoise: 0.7, drift: 0.6 },
  },
  {
    id: 'tenmon-02',
    title: '誰が空を創ったのか',
    subtitle: '12小節のジャズ・ブルース｜天問 Vol.2',
    voiceId: 'yoi',
    bpm: 144,
    beatsPerBar: 4,
    barsPerChorus: 12,
    chords: `Bb7
Eb7
Bb7
Bb7
Eb7
Edim7
Bb7
G7
Cm7
F7
Bb7 G7
Cm7 F7`,
    hook: 'Bb4:0.5 D5:0.5 F5:1 Eb5:0.5 D5:0.5 C5:1 r:0.5 Bb4:0.5 D5:1 F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 Bb4:2 r:4',
    n: 9,
    baseEnergy: 0.36,
    soloPeak: 0.85,
    mix: { reverbType: 'room', reverbMix: 0.18, delayMix: 0.1, accompLevel: 0.62, tone: 0.2 },
    expression: { vibDepth: 22, scoop: 0.5, consonant: 1.15, portamento: 40, dynamics: 0.75 },
  },
  {
    id: 'tenmon-03',
    title: '星の回廊',
    subtitle: 'ジャズ・ワルツ｜天問 Vol.3',
    voiceId: 'yoi',
    bpm: 168,
    beatsPerBar: 3,
    barsPerChorus: 12,
    chords: `Dm7
Gm7
C7
Fmaj7
Bbmaj7
E7alt
Am7
D7
Gm7
C7
Dm7
Dm7`,
    hook: 'D5:1 F5:0.5 A5:0.5 G5:1 F5:1 E5:1 D5:1 C5:1.5 D5:1.5 A4:3',
    n: 14,
    baseEnergy: 0.3,
    soloPeak: 0.8,
    mix: { reverbType: 'plate', reverbMix: 0.28, delayMix: 0.12, accompLevel: 0.5 },
    expression: { vibDepth: 30, portamento: 75, scoop: 0.2, dynamics: 0.65 },
  },
  {
    id: 'tenmon-04',
    title: '地の果てへ',
    subtitle: 'ボサノヴァ｜天問 Vol.4',
    voiceId: 'yoi',
    bpm: 132,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Fmaj7
Em7b5 A7alt
Dm7
Gm7 C7
Fmaj7
Em7b5 A7alt
Dm7 G7
Cmaj7`,
    hook: 'C5:1 A4:0.5 F4:0.5 G4:1 A4:1 Bb4:1 A4:0.5 G4:0.5 F4:2 E4:1 G4:1 C5:1 Bb4:1 A4:2 r:2',
    n: 12,
    baseEnergy: 0.24,
    soloPeak: 0.62,
    mix: { reverbType: 'room', reverbMix: 0.24, delayMix: 0.16, accompLevel: 0.5, tone: 0.05 },
    expression: { vibDepth: 20, portamento: 90, scoop: 0.15, breathNoise: 0.5, dynamics: 0.5 },
  },
  {
    id: 'tenmon-05',
    title: '問いかける月',
    subtitle: 'バラード｜天問 Vol.5',
    voiceId: 'mio',
    bpm: 63,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Ebmaj7
Cm7
Fm7
Bb7
Ebmaj7
Ab7
Gm7 C7
Fm7 Bb7`,
    hook: 'Bb4:1.5 Eb5:0.5 D5:1 C5:1 Bb4:2 Ab4:1 G4:1 F4:1 G4:1 Ab4:1 Bb4:1 Eb5:4',
    n: 6,
    baseEnergy: 0.14,
    soloPeak: 0.5,
    mix: { reverbType: 'hall', reverbMix: 0.4, delayMix: 0.1, accompLevel: 0.46 },
    expression: { vibDepth: 44, vibDelay: 0.3, portamento: 110, scoop: 0.22, dynamics: 0.7 },
  },
  {
    id: 'tenmon-06',
    title: '龍の眠り',
    subtitle: 'ハード・バップ｜天問 Vol.6',
    voiceId: 'yoi',
    bpm: 176,
    beatsPerBar: 4,
    barsPerChorus: 16,
    chords: `Cm7
Cm7
Fm7
Bb7
Ebmaj7
Abmaj7
Dm7b5
G7alt
Cm7
Fm7 Bb7
Ebmaj7 Abmaj7
Dm7b5 G7alt
Cm7
Ab7
G7
Cm7`,
    hook: 'C5:0.5 Eb5:0.5 G5:0.5 F5:0.5 Eb5:1 D5:1 C5:0.5 D5:0.5 Eb5:1 G4:2 Ab4:0.5 Bb4:0.5 C5:0.5 D5:0.5 Eb5:2 D5:1 C5:1 G4:2',
    n: 8,
    baseEnergy: 0.4,
    soloPeak: 0.95,
    mix: { reverbType: 'room', reverbMix: 0.16, delayMix: 0.08, accompLevel: 0.68, tone: 0.25 },
    expression: { vibDepth: 18, scoop: 0.35, consonant: 1.2, portamento: 30, dynamics: 0.85, drift: 0.5 },
  },
  {
    id: 'tenmon-07',
    title: '見えない橋',
    subtitle: 'アフロキューバン・ジャズ｜天問 Vol.7',
    voiceId: 'yoi',
    bpm: 138,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Am7
Am7
Dm7
E7alt
Am7
Dm7
E7alt
Am7`,
    hook: 'E5:0.5 A5:0.5 G5:1 E5:1 D5:0.5 C5:0.5 A4:1 r:1 E5:0.5 F5:0.5 E5:0.5 D5:0.5 C5:2 B4:1 C5:1 A4:2',
    n: 13,
    baseEnergy: 0.32,
    soloPeak: 0.8,
    mix: { reverbType: 'plate', reverbMix: 0.22, delayMix: 0.18, delayBeats: 0.75, accompLevel: 0.6 },
    expression: { vibDepth: 26, scoop: 0.4, consonant: 1.05, portamento: 45, dynamics: 0.7 },
  },
  {
    id: 'tenmon-08',
    title: '光と影のあいだ',
    subtitle: 'モーダル・ジャズ｜天問 Vol.8',
    voiceId: 'yoi',
    bpm: 120,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Dm7
Dm7
Dm7
Dm7
Ebmaj7
Ebmaj7
Dm7
Dm7`,
    hook: 'D5:1 F5:0.5 A5:0.5 G5:1 F5:1 E5:0.5 D5:0.5 C5:1 D5:2 Eb5:1 F5:1 Eb5:1 D5:1 C5:2 D5:2',
    n: 11,
    baseEnergy: 0.22,
    soloPeak: 0.68,
    mix: { reverbType: 'hall', reverbMix: 0.3, delayMix: 0.14, accompLevel: 0.5 },
    expression: { vibDepth: 20, portamento: 80, scoop: 0.2, dynamics: 0.55, drift: 0.55 },
  },
  {
    id: 'tenmon-09',
    title: '天の川を渡る',
    subtitle: 'アップテンポ・スウィング｜天問 Vol.9',
    voiceId: 'mio',
    bpm: 200,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Bbmaj7
Gm7
Cm7
F7
Fm7
Bb7
Ebmaj7
Ebm6`,
    hook: 'F5:0.5 G5:0.5 A5:0.5 Bb5:0.5 A5:1 G5:1 F5:0.5 D5:0.5 C5:1 Bb4:2 D5:0.5 Eb5:0.5 F5:1 Eb5:0.5 D5:0.5 C5:2 Bb4:2',
    n: 19,
    baseEnergy: 0.35,
    soloPeak: 1.0,
    alternate: true,
    mix: { reverbType: 'room', reverbMix: 0.14, delayMix: 0.06, accompLevel: 0.7, tone: 0.2 },
    expression: { vibDepth: 14, vibRate: 6.0, portamento: 20, scoop: 0.25, consonant: 1.25, dynamics: 0.8, drift: 0.35 },
  },
  {
    id: 'tenmon-10',
    title: '終わりなき問い',
    subtitle: 'バラード（終曲）｜天問 Vol.10',
    voiceId: 'mio',
    bpm: 58,
    beatsPerBar: 4,
    barsPerChorus: 8,
    chords: `Gmaj7
Em7
Am7
D7
Gmaj7
Cmaj7
Am7 D7
Gmaj7`,
    hook: 'D5:1.5 B4:0.5 A4:1 G4:1 F#4:2 E4:1 D4:1 G4:1 A4:1 B4:1 D5:1 G5:4',
    n: 5,
    baseEnergy: 0.1,
    soloPeak: 0.4,
    mix: { reverbType: 'church', reverbMix: 0.46, delayMix: 0.08, accompLevel: 0.4 },
    expression: { vibDepth: 48, vibDelay: 0.32, portamento: 130, scoop: 0.28, dynamics: 0.68, breathNoise: 0.5 },
  },
];

function buildSong(spec: TenmonTrackSpec): Song {
  const defaults = voiceDefaults(spec.voiceId);
  const voice = findVoice(spec.voiceId);
  const range: [number, number] = [voice.range[0], voice.range[1]];
  const center = (range[0] + range[1]) / 2 + 2;

  const chorusBeats = spec.barsPerChorus * spec.beatsPerBar;
  const oneChorus = parseChordText(spec.chords, spec.beatsPerBar);
  const chords: ChordSpan[] = [];
  for (let c = 0; c < spec.n; c++) {
    for (const ev of oneChorus) {
      chords.push({ start: ev.start + c * chorusBeats, length: ev.length, symbol: ev.symbol });
    }
  }

  const hookTokens = parseHook(spec.hook);
  const rng = mulberry32(hashSeed(spec.id));
  const syl = makeSyllablePicker(rng);
  const notes: VocalNote[] = [];

  let prev: number | null = null;

  // ヘッド ×2
  for (let h = 0; h < 2; h++) {
    prev = generateHead({
      rng,
      chords,
      startBeat: chorusBeats * h,
      bars: spec.barsPerChorus,
      beatsPerBar: spec.beatsPerBar,
      hook: hookTokens,
      headEnergy: spec.baseEnergy,
      center,
      spread: 5,
      range,
      prevNote: prev,
      syl,
      out: notes,
    });
  }

  // ソロ ×(N-3)
  const soloCount = spec.n - 3;
  for (let s = 0; s < soloCount; s++) {
    const x = soloCount > 1 ? s / (soloCount - 1) : 0.5;
    let energy: number;
    let regOffset = 0;
    if (spec.alternate) {
      const base = spec.baseEnergy + (spec.soloPeak - spec.baseEnergy) * x;
      const mod = s % 2 === 0 ? -0.12 : 0.14;
      energy = Math.max(0.05, Math.min(1, base + mod));
      regOffset = s % 2 === 0 ? -3 : 6;
    } else {
      const arc = Math.sin(Math.PI * Math.pow(x, 0.85));
      energy = Math.max(0.05, Math.min(1, spec.baseEnergy + (spec.soloPeak - spec.baseEnergy) * arc));
    }
    const secCenter = center + (energy - 0.5) * 16 + regOffset;
    const spread = 4 + energy * 8;
    prev = generateSection({
      rng,
      chords,
      startBeat: chorusBeats * (2 + s),
      bars: spec.barsPerChorus,
      beatsPerBar: spec.beatsPerBar,
      energy,
      center: secCenter,
      spread,
      range,
      prevNote: prev,
      syl,
      out: notes,
    });
  }

  // ヘッドアウト ×1
  prev = generateHead({
    rng,
    chords,
    startBeat: chorusBeats * (spec.n - 1),
    bars: spec.barsPerChorus,
    beatsPerBar: spec.beatsPerBar,
    hook: hookTokens,
    headEnergy: spec.baseEnergy,
    center,
    spread: 5,
    range,
    prevNote: prev,
    syl,
    out: notes,
  });

  notes.sort((a, b) => a.start - b.start);

  // アルバム・ミックスでは各アプリが自分の楽器だけを鳴らす（ピアノ・ベース等の
  // 内蔵伴奏は他アプリの担当と二重になるため無効化する）。'off' にすると
  // buildAccompaniment() が空配列を返し、伴奏ノートは一切生成されない。
  const style: AccompStyle = 'off';

  return createSong({
    title: spec.title,
    bpm: spec.bpm,
    beatsPerBar: spec.beatsPerBar,
    style,
    notes,
    chords: chords as ChordEvent[],
    settings: {
      voiceId: spec.voiceId,
      a4: 440,
      character: { ...defaults.character },
      expression: { ...defaults.expression, ...spec.expression },
      mix: { ...DEFAULT_MIX, ...spec.mix },
    },
  });
}

const CACHE = new Map<string, Song>();

/** tenmon-01 .. tenmon-10 のスキャット・パートを compileSong() にそのまま渡せる Song として返す */
export function vocalTenmonTrack(id: string): Song {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const spec = TRACKS.find((t) => t.id === id);
  if (!spec) throw new Error(`unknown tenmon track id: ${id}`);
  const song = buildSong(spec);
  CACHE.set(id, song);
  return song;
}

export const TENMON_TRACK_IDS = TRACKS.map((t) => t.id);
