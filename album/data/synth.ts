/**
 * アルバム「天問」(Tenmon) — シンセ・パート（ジャズコンボ編成）書き出し用データ
 *
 * synthesizer/src/ui/demoSong.ts に一度実装したジャズ生成ツールキット
 * （ウォーキングベース／チャールストン・コンピング／ビバップ・ソロライン／
 * ブラシ・ドラム）を、アプリの Demo UI とは完全に切り離して再利用する。
 * コード進行・キー・フックは元の仕様のまま、コーラス数（曲構成）だけを
 * /scratchpad/album-render-spec.md のロック済み表に合わせて再設定した。
 *
 * 曲構成は必ず「Head, Head, Solo × (N-3), Head Out」の合計 N コーラスで、
 * タグ（エンディング用の追加小節）は付けない———最後のコーラスがそのまま
 * ヘッド・アウトになる、というアルバム仕様の指示に従っている。
 */
import { basePatch, getPreset } from '../../synthesizer/src/audio/presets';
import type { Patch } from '../../synthesizer/src/audio/types';
import {
  emptyPattern,
  PATTERN_SLOTS,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  type Pattern,
} from '../../synthesizer/src/audio/Sequencer';
import type { Sequencer } from '../../synthesizer/src/audio/Sequencer';

type Notes = [number, number, number, number][];

interface DemoTrack {
  name: string;
  preset: string;
  volume?: number;
  pan?: number;
  patterns: { length: number; notes: Notes }[];
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
  scenes: SceneSpec[];
}

function pattern(length: number, notes: Notes): Pattern {
  return { length, notes: notes.map(([step, pitch, len, vel]) => ({ step, pitch, length: len, velocity: vel })) };
}

// ============================================================== 音楽理論ヘルパー
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
 * コードトーン＋半音アプローチで即興ソロラインを生成する（1コーラスぶん）。
 * コードごとにジグザグの方向を反転させながらアルペジオで運指し、各コードの
 * 最後の音は次のコードへの半音アプローチにする（ビバップ的な定石）。
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

/** ソロ区間の各コーラスで使う「声」（音域の起点と密度）を切り替え、trading っぽい変化を作る */
const SOLO_VOICES: { startIdx: number; busy: boolean }[] = [
  { startIdx: 2, busy: false },
  { startIdx: 5, busy: true },
  { startIdx: 0, busy: false },
  { startIdx: 3, busy: true },
];

/**
 * ソロ区間全体（N-3コーラスぶん）を、コーラスごとに実際に違うラインとして
 * 通し作曲する（＝機械的な同一ループの繰り返しにしない）。
 * 声部を巡回させつつ、後半にかけて密度・音域・音量を持ち上げてクライマックスを
 * 作り、最後のコーラスだけは次のヘッド・アウトへ受け渡すため少し落ち着かせる。
 */
function soloArc(chords: ChordEvt[], count: number, chorusLen: number, isBallad: boolean): Notes {
  const out: Notes = [];
  for (let i = 0; i < count; i++) {
    const phase = count <= 1 ? 0 : i / (count - 1);
    const voice = SOLO_VOICES[i % SOLO_VOICES.length];
    const climax = !isBallad && phase > 0.5 && phase < 0.85;
    const busy = isBallad ? i % 3 === 2 : voice.busy || climax;
    const octave = climax && i % 4 === 2 ? 5 : 4;
    const isLast = i === count - 1;
    const vel = Math.min(0.95, 0.74 + phase * 0.16 + (climax ? 0.06 : 0) - (isLast ? 0.08 : 0));
    const line = soloLine(chords, { octave, busy, startIdx: voice.startIdx, vel });
    for (const [step, pitch, len, v] of line) out.push(note(step + i * chorusLen, pitch, len, v));
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
  /** アルバム仕様書のロック済み表に合わせた合計コーラス数（Head,Head,Solo×(N-3),Head Out） */
  chorusCount: number;
}

/** ジャズコンボ編成（ブラシ・ドラム4声＋ベース＋ローズ＋リード[+パッド]）を1曲ぶん組み立てる */
function buildTenmon(def: TenmonDef): DemoSpec {
  const barSteps = def.beatsPerBar * STEPS_PER_BEAT; // 曲の拍子に応じた実小節の長さ（ステップ数）
  const toEngineBars = (musicalBars: number) => (musicalBars * barSteps) / STEPS_PER_BAR;

  const chorusLen = barSteps * def.chorusBars;
  const headLen = barSteps * 4; // フックは常に4小節ぶんの記譜
  const solos = Math.max(1, def.chorusCount - 3);

  const head = hookNotes(def.hook);
  const bass = def.isBallad ? balladBass(def.chords) : walkingBass(def.chords);
  const comp = compingChords(def.chords);
  const compSolo = compingSparse(def.chords);
  const soloLead = soloArc(def.chords, solos, chorusLen, !!def.isBallad);

  const kitHead = drumKit(def.drums, false);
  const kitSolo = drumKit(def.drums, true);

  function pat(length: number, notes: Notes) {
    return { length, notes };
  }

  const tracks: DemoTrack[] = [
    {
      name: 'Ride', preset: kitHead.topPreset, volume: 0.55,
      patterns: [pat(barSteps, kitHead.top), pat(barSteps, kitSolo.top)],
    },
    {
      name: 'Hi-Hat', preset: kitHead.hatPreset, volume: 0.42, pan: -0.12,
      patterns: [pat(barSteps, kitHead.hat), pat(barSteps, kitSolo.hat)],
    },
    {
      name: 'Kick', preset: 'dr_kick_tight', volume: 0.55,
      patterns: [pat(barSteps, kitHead.kick), pat(barSteps, kitSolo.kick)],
    },
    {
      name: 'Brush', preset: 'dr_snare_rim', volume: 0.5, pan: 0.15,
      patterns: [pat(barSteps, kitHead.rim), pat(barSteps, kitSolo.rim)],
    },
    {
      name: 'Bass', preset: 'bass_sub', volume: 0.9,
      patterns: [pat(chorusLen, bass), pat(chorusLen, bass)],
    },
    {
      name: 'Rhodes', preset: 'keys_ep', volume: 0.62,
      patterns: [pat(chorusLen, comp), pat(chorusLen, compSolo)],
    },
    {
      name: 'Lead', preset: def.leadPreset, volume: 0.78,
      patterns: [pat(headLen, head), pat(chorusLen * solos, soloLead)],
    },
  ];

  if (def.padPreset) {
    const pad = padPedal(def.chords);
    tracks.push({
      name: 'Pad', preset: def.padPreset, volume: 0.4,
      patterns: [pat(chorusLen, pad), pat(chorusLen, pad)],
    });
  }

  // 曲構成：Head(×2), Solo(×(N-3)), Head Out(×1) の合計 N コーラス。
  // Head Out はヘッドと全く同じスロット(0)を再利用する（＝実演奏どおり、頭のヘッドを
  // そのまま出のヘッドとして演奏する）。タグ／追加小節は付けない。
  const scenes: SceneSpec[] = [
    { name: 'Head', bars: toEngineBars(def.chorusBars * 2), slot: 0 },
    { name: 'Solo', bars: toEngineBars(def.chorusBars * solos), slot: 1 },
    { name: 'Head Out', bars: toEngineBars(def.chorusBars * 1), slot: 0 },
  ];

  return { id: def.id, bpm: def.bpm, swing: def.swing, tracks, scenes };
}

// 元の音楽仕様（キー／コード進行／フック／スタイル）は album-tenmon-spec.md のまま。
// chorusCount のみ album-render-spec.md のロック済み表に合わせて更新した。
const TENMON_DEFS: TenmonDef[] = [
  {
    // #1 混沌の序章 — Am dorian, 4/4, 96bpm, モーダル・スウィング。N=9 (180.0s)
    id: 'tenmon-01', bpm: 96, beatsPerBar: 4, chorusBars: 8, swing: 0.48,
    chords: [
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 },
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'E', q: '7alt', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 },
    ],
    hook: 'A4:0.5 C5:0.5 r:1 E5:1 D5:0.5 C5:0.5 | A4:1 r:2 D5:0.5 F5:0.5 | E5:1 D5:0.5 C5:0.5 A4:1 r:1 | G4:0.5 A4:1.5 r:2',
    leadPreset: 'lead_flute', padPreset: 'pad_dark', drums: 'swing',
    chorusCount: 9,
  },
  {
    // #2 誰が空を創ったのか — Bb, 4/4, 144bpm, ミディアム・スウィングの12小節ブルース。N=9 (180.0s)
    id: 'tenmon-02', bpm: 144, beatsPerBar: 4, chorusBars: 12, swing: 0.55,
    chords: [
      { pc: 'Bb', q: '7', beats: 4 }, { pc: 'Eb', q: '7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 },
      { pc: 'Eb', q: '7', beats: 4 }, { pc: 'E', q: 'dim7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 }, { pc: 'G', q: '7', beats: 4 },
      { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: '7', beats: 4 },
      { pc: 'Bb', q: '7', beats: 2 }, { pc: 'G', q: '7', beats: 2 }, { pc: 'C', q: 'm7', beats: 2 }, { pc: 'F', q: '7', beats: 2 },
    ],
    hook: 'Bb4:0.5 D5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1 | C5:1 r:1.5 Bb4:0.5 D5:1 | F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 Bb4:2 | r:4',
    leadPreset: 'lead_flute', drums: 'swing',
    chorusCount: 9,
  },
  {
    // #3 星の回廊 — Dm, 3/4, 168bpm, ジャズ・ワルツ（12小節フォーム）。N=14 (180.0s)
    id: 'tenmon-03', bpm: 168, beatsPerBar: 3, chorusBars: 12, swing: 0.18,
    chords: [
      { pc: 'D', q: 'm7', beats: 3 }, { pc: 'G', q: 'm7', beats: 3 }, { pc: 'C', q: '7', beats: 3 }, { pc: 'F', q: 'maj7', beats: 3 },
      { pc: 'Bb', q: 'maj7', beats: 3 }, { pc: 'E', q: '7alt', beats: 3 }, { pc: 'A', q: 'm7', beats: 3 }, { pc: 'D', q: '7', beats: 3 },
      { pc: 'G', q: 'm7', beats: 3 }, { pc: 'C', q: '7', beats: 3 }, { pc: 'D', q: 'm7', beats: 3 }, { pc: 'D', q: 'm7', beats: 3 },
    ],
    hook: 'D5:1 F5:0.5 A5:0.5 G5:1 | F5:1 E5:1 D5:1 | C5:1.5 D5:1.5 | A4:3',
    leadPreset: 'lead_flute', drums: 'waltz',
    chorusCount: 14,
  },
  {
    // #4 地の果てへ — F, 4/4, 132bpm, ボサノヴァ。N=12 (174.5s)
    id: 'tenmon-04', bpm: 132, beatsPerBar: 4, chorusBars: 8, swing: 0,
    chords: [
      { pc: 'F', q: 'maj7', beats: 4 }, { pc: 'E', q: 'm7b5', beats: 2 }, { pc: 'A', q: '7alt', beats: 2 }, { pc: 'D', q: 'm7', beats: 4 },
      { pc: 'G', q: 'm7', beats: 2 }, { pc: 'C', q: '7', beats: 2 }, { pc: 'F', q: 'maj7', beats: 4 },
      { pc: 'E', q: 'm7b5', beats: 2 }, { pc: 'A', q: '7alt', beats: 2 }, { pc: 'D', q: 'm7', beats: 2 }, { pc: 'G', q: '7', beats: 2 }, { pc: 'C', q: 'maj7', beats: 4 },
    ],
    hook: 'C5:1 A4:0.5 F4:0.5 G4:1 A4:1 | Bb4:1 A4:0.5 G4:0.5 F4:2 | E4:1 G4:1 C5:1 Bb4:1 | A4:2 r:2',
    leadPreset: 'pluck_marimba', drums: 'bossa',
    chorusCount: 12,
  },
  {
    // #5 問いかける月 — Eb, 4/4, 63bpm, スロー・バラード。N=6 (182.9s)
    id: 'tenmon-05', bpm: 63, beatsPerBar: 4, chorusBars: 8, swing: 0.05, isBallad: true,
    chords: [
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: 'm7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 },
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Ab', q: '7', beats: 4 },
      { pc: 'G', q: 'm7', beats: 2 }, { pc: 'C', q: '7', beats: 2 }, { pc: 'F', q: 'm7', beats: 2 }, { pc: 'Bb', q: '7', beats: 2 },
    ],
    hook: 'Bb4:1.5 Eb5:0.5 D5:1 C5:1 | Bb4:2 Ab4:1 G4:1 | F4:1 G4:1 Ab4:1 Bb4:1 | Eb5:4',
    leadPreset: 'strings_solo', padPreset: 'pad_shimmer', drums: 'ballad',
    chorusCount: 6,
  },
  {
    // #6 龍の眠り — Cm, 4/4, 176bpm, ハードバップ（16小節フォーム）。N=8 (174.5s)
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
    chorusCount: 8,
  },
  {
    // #7 見えない橋 — Am, 4/4, 138bpm, アフロキューバン／ラテン・ジャズ。N=13 (180.9s)
    id: 'tenmon-07', bpm: 138, beatsPerBar: 4, chorusBars: 8, swing: 0,
    chords: [
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'E', q: '7alt', beats: 4 },
      { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'E', q: '7alt', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 },
    ],
    hook: 'E5:0.5 A5:0.5 G5:1 E5:1 r:1 | D5:0.5 C5:0.5 A4:1 r:2 | E5:0.5 F5:0.5 E5:0.5 D5:0.5 C5:2 | B4:1 C5:1 A4:2',
    leadPreset: 'pluck_marimba', drums: 'latin',
    chorusCount: 13,
  },
  {
    // #8 光と影のあいだ — D dorian, 4/4, 120bpm, 2コード・ヴァンプのモーダル・ジャズ。N=11 (176.0s)
    id: 'tenmon-08', bpm: 120, beatsPerBar: 4, chorusBars: 8, swing: 0,
    chords: [
      { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 },
      { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 }, { pc: 'D', q: 'm7', beats: 4 },
    ],
    hook: 'D5:1 F5:0.5 A5:0.5 G5:1 F5:1 | E5:0.5 D5:0.5 C5:1 D5:2 | Eb5:1 F5:1 Eb5:1 D5:1 | C5:2 D5:2',
    leadPreset: 'strings_solo', padPreset: 'pad_warm', drums: 'modal',
    chorusCount: 11,
  },
  {
    // #9 天の川を渡る — Bb, 4/4, 200bpm, アップテンポ・スウィング。N=19、うちソロ16コーラスの
    // 長尺ブローイング・セクション（soloArc がクライマックスへ向けたアークを作る）。(182.4s)
    id: 'tenmon-09', bpm: 200, beatsPerBar: 4, chorusBars: 8, swing: 0.5,
    chords: [
      { pc: 'Bb', q: 'maj7', beats: 4 }, { pc: 'G', q: 'm7', beats: 4 }, { pc: 'C', q: 'm7', beats: 4 }, { pc: 'F', q: '7', beats: 4 },
      { pc: 'F', q: 'm7', beats: 4 }, { pc: 'Bb', q: '7', beats: 4 }, { pc: 'Eb', q: 'maj7', beats: 4 }, { pc: 'Eb', q: 'm6', beats: 4 },
    ],
    hook: 'F5:0.5 G5:0.5 A5:0.5 Bb5:0.5 A5:1 G5:1 | F5:0.5 D5:0.5 C5:1 Bb4:2 | D5:0.5 Eb5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1 | C5:2 Bb4:2',
    leadPreset: 'lead_square', drums: 'swing',
    chorusCount: 19,
  },
  {
    // #10 終わりなき問い — G, 4/4, 58bpm, ルバート気味のエピローグ・バラード。N=5 (165.5s)
    id: 'tenmon-10', bpm: 58, beatsPerBar: 4, chorusBars: 8, swing: 0.05, isBallad: true,
    chords: [
      { pc: 'G', q: 'maj7', beats: 4 }, { pc: 'E', q: 'm7', beats: 4 }, { pc: 'A', q: 'm7', beats: 4 }, { pc: 'D', q: '7', beats: 4 },
      { pc: 'G', q: 'maj7', beats: 4 }, { pc: 'C', q: 'maj7', beats: 4 },
      { pc: 'A', q: 'm7', beats: 2 }, { pc: 'D', q: '7', beats: 2 }, { pc: 'G', q: 'maj7', beats: 4 },
    ],
    hook: 'D5:1.5 B4:0.5 A4:1 G4:1 | F#4:2 E4:1 D4:1 | G4:1 A4:1 B4:1 D5:1 | G5:4',
    leadPreset: 'lead_whistle', padPreset: 'pad_glass', drums: 'ballad',
    chorusCount: 5,
  },
];

const TENMON_BY_ID = new Map<string, TenmonDef>(TENMON_DEFS.map((d) => [d.id, d]));

/** マスターFXのデフォルト設定（AudioEngine.defaultMasterSettings() と同じ内容） */
function defaultMaster() {
  return {
    volume: 0.62,
    drive: 0,
    eqLow: 0,
    eqMid: 0,
    eqMidFreq: 1000,
    eqHigh: 0,
    compress: 0.25,
    limiter: true,
    reverb: { mix: 0.32, size: 2.4, damp: 0.45, preDelay: 0.02, width: 0.9 },
    delay: { mix: 0.28, sync: true, division: 0.75, time: 0.35, feedback: 0.38, tone: 0.55, pingPong: true },
    chorus: { mix: 0.3, rate: 0.55, depth: 0.55, spread: 0.8 },
  };
}

function build(spec: DemoSpec): ReturnType<Sequencer['toJSON']> {
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

  // レンダラー（Sequencer.collectEvents）はシーンを 'song' モードのときだけ参照するため、
  // アプリの UI 経由（デモ読込→手動で song モードへ切替）とは違い、ここでは最初から
  // 'song' モードで組み立てる。
  const scenes = spec.scenes.map((sc) => {
    const patterns: Record<string, number> = {};
    for (const tr of tracks) patterns[tr.id] = sc.slot;
    return { name: sc.name, bars: sc.bars, patterns };
  });

  return {
    format: 'akatsuki-synth',
    version: 2,
    bpm: spec.bpm,
    swing: spec.swing,
    mode: 'song' as const,
    master: defaultMaster(),
    scenes,
    tracks,
  } as unknown as ReturnType<Sequencer['toJSON']>;
}

/** id ('tenmon-01' .. 'tenmon-10') からシンセ・パート（ジャズコンボ）のソング・データを組み立てる */
export function synthTenmonTrack(id: string): ReturnType<Sequencer['toJSON']> {
  const def = TENMON_BY_ID.get(id);
  if (!def) throw new Error(`synthTenmonTrack: unknown track id "${id}"`);
  return build(buildTenmon(def));
}
