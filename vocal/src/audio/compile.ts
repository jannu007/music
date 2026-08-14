/*
 * 楽譜（音符 + 歌詞）→ 歌声の制御曲線
 *
 * ここが「歌わせる」部分の中心。音符の並びから
 *   ・子音を拍の手前に置く（母音が拍の頭に来るように歌う）
 *   ・母音のフォルマントへ滑らかに移る（調音結合）
 *   ・音程を繋ぐ（ポルタメント）、しゃくり、ビブラート
 *   ・強弱・息・語尾の処理
 * を組み立て、パラメータごとの折れ線に落とす。
 * 折れ線にしておくと、再生でも WAV 書き出しでも完全に同じ音になる。
 */

import { parseLyric } from './kana';
import { CONSONANTS, VOWELS, coarticulate, type ConsonantSpec } from './phonemes';
import {
  CURVE_LINEAR,
  CURVE_SMOOTH,
  CURVE_STEP,
  PARAM_NAMES,
  type Automation,
  type CompiledSong,
  type ParamName,
  type Song,
  type VocalNote,
  type Vowel,
  type VoiceCharacter,
  type Expression,
} from './types';
import { buildAccompaniment } from './chords';

const PARAM_INDEX = new Map<ParamName, number>(PARAM_NAMES.map((n, i) => [n, i]));

/** パラメータごとに折れ線を積む小さなビルダー */
class Curves {
  readonly params: { times: number[]; values: number[]; curves: number[] }[];
  /** すべての時刻に足す助走時間（曲頭の子音を拍の前に置くため） */
  bias = 0;

  constructor() {
    this.params = PARAM_NAMES.map(() => ({ times: [], values: [], curves: [] }));
  }

  /** 1 点打つ。時刻は必ず単調増加になるよう詰める（同時刻はステップ扱い） */
  set(name: ParamName, rawTime: number, value: number, curve = CURVE_LINEAR) {
    const p = this.params[PARAM_INDEX.get(name)!];
    const time = rawTime + this.bias;
    const last = p.times.length ? p.times[p.times.length - 1] : -Infinity;
    p.times.push(time < last ? last : time);
    p.values.push(value);
    p.curves.push(curve);
  }

  /** t0 の値から t1 の値へ動かす */
  ramp(name: ParamName, t0: number, v0: number, t1: number, v1: number, curve = CURVE_SMOOTH) {
    this.set(name, t0, v0, CURVE_LINEAR);
    this.set(name, Math.max(t1, t0), v1, curve);
  }

  /** その時刻から一定値にする（直前の値から一気に切り替える） */
  step(name: ParamName, time: number, value: number) {
    this.set(name, time, value, CURVE_STEP);
  }

  lastValue(name: ParamName): number {
    const p = this.params[PARAM_INDEX.get(name)!];
    return p.values.length ? p.values[p.values.length - 1] : 0;
  }

  lastTime(name: ParamName): number {
    const p = this.params[PARAM_INDEX.get(name)!];
    return p.times.length ? p.times[p.times.length - 1] : 0;
  }

  toAutomation(): Automation {
    return { params: this.params };
  }
}

/** 声道スケールを掛けたフォルマント（F1 は顎の開きで決まるため効きを弱くする） */
function scaleFormants(f: number[], tract: number): number[] {
  return [
    f[0] * Math.pow(tract, 0.72),
    f[1] * Math.pow(tract, 0.94),
    f[2] * tract,
    f[3] * tract,
    f[4] * tract,
  ];
}

function scaleBandwidths(b: number[], tract: number, breath: number): number[] {
  const w = Math.pow(tract, 0.5) * (1 + breath * 0.28);
  return b.map((v) => v * w);
}

function midiToHz(note: number, a4: number): number {
  return a4 * Math.pow(2, (note - 69) / 12);
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Plan {
  note: VocalNote;
  onset: ConsonantSpec[];
  onsetNames: string[];
  vowel: Vowel;
  coda: 'N' | 'Q' | null;
  /** 母音の開始（拍頭）と音符の終わり 秒 */
  t0: number;
  t1: number;
  /** 子音の開始 秒 */
  cStart: number;
  /** 前の音符から続けて歌う（子音なしで繋がる） */
  legato: boolean;
  /** フレーズの先頭 */
  phraseStart: boolean;
  level: number;
}

export interface CompileOptions {
  /** 何拍目から書き出すか（部分再生用） */
  fromBeat?: number;
}

/** 曲を歌声の制御曲線 + 伴奏ノートに変換する */
export function compileSong(song: Song, options: CompileOptions = {}): CompiledSong {
  const spb = 60 / song.bpm;
  const ch = song.settings.character;
  const ex = song.settings.expression;
  const a4 = song.settings.a4;
  const from = options.fromBeat ?? 0;
  const offset = from * spb;

  const notes = [...song.notes]
    .filter((n) => n.start + n.length > from + 1e-6)
    .sort((a, b) => a.start - b.start);

  const c = new Curves();
  initialState(c, ch, ex);

  const plans: Plan[] = [];
  let previousVowel: Vowel = 'a';

  for (const note of notes) {
    const parsed = parseLyric(note.lyric);
    const vowel: Vowel = parsed.extend || !parsed.vowel ? previousVowel : parsed.vowel;
    previousVowel = vowel;

    const onsetNames = parsed.extend ? [] : parsed.onset;
    const onset = onsetNames
      .map((name) => (name === 'Q' ? CONSONANTS.Q : coarticulate(name, vowel)))
      .filter(Boolean);

    plans.push({
      note,
      onset,
      onsetNames,
      vowel,
      coda: parsed.coda,
      t0: note.start * spb - offset,
      t1: (note.start + note.length) * spb - offset,
      cStart: 0,
      legato: false,
      phraseStart: false,
      level: 0,
    });
  }

  // --- 子音の置き場所と、フレーズの切れ目を決める ---
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    const prev = i > 0 ? plans[i - 1] : null;
    const gap = prev ? p.t0 - prev.t1 : Infinity;

    const consScale = ex.consonant * clamp((p.t1 - p.t0) / 0.22, 0.55, 1);
    let span = p.onset.reduce((sum, s) => sum + (s.closure + s.dur) * consScale, 0);
    if (prev) {
      // 前の音符を食い潰さないように詰める
      const room = Math.max(0.028, (p.t0 - prev.t0) * 0.6 + Math.max(0, gap));
      if (span > room) span = room;
    }
    p.cStart = p.t0 - span;
    p.phraseStart = !prev || gap > 0.22 || p.note.breath;
    p.legato = !!prev && !p.phraseStart && p.onset.length === 0;

    const vel = clamp(p.note.vel, 0, 1);
    p.level = clamp(0.82 + (vel - 0.7) * 1.15 * ex.dynamics, 0.25, 1.15);
  }

  // 曲頭の音符は子音やブレスが 0 秒より前から始まるので、その分だけ全体をずらす
  let earliest = 0;
  for (const p of plans) {
    const lead = p.phraseStart && ex.breathNoise > 0 ? 0.26 : 0.03;
    earliest = Math.min(earliest, p.cStart - lead);
  }
  const preroll = earliest < 0 ? -earliest : 0;
  c.bias = preroll;

  // --- 実際に曲線を書く ---
  for (let i = 0; i < plans.length; i++) {
    writeNote(c, plans, i, ch, ex, a4);
  }

  const last = plans.length ? plans[plans.length - 1] : null;
  const tail = last ? last.t1 + ex.release / 1000 + 0.05 : 0;
  if (last) {
    c.set('level', tail, 0, CURVE_LINEAR);
    c.set('breath', tail, 0, CURVE_LINEAR);
    c.set('fric', tail, 0, CURVE_LINEAR);
  }

  const accomp = buildAccompaniment(song)
    .map((n) => ({ ...n, time: n.time - offset }))
    .filter((n) => n.time + n.dur > 0)
    .map((n) => (n.time < 0 ? { ...n, dur: n.dur + n.time, time: 0 } : n))
    .map((n) => ({ ...n, time: n.time + preroll }));

  const accompEnd = accomp.reduce((m, n) => Math.max(m, n.time + n.dur), 0);
  const duration = Math.max(tail + preroll, accompEnd);

  return { automation: c.toAutomation(), accomp, duration, preroll };
}

/** 曲の頭で各パラメータに初期値を置く */
function initialState(c: Curves, ch: VoiceCharacter, ex: Expression) {
  const v = VOWELS.a;
  const f = scaleFormants(v.f, ch.tract);
  const b = scaleBandwidths(v.b, ch.tract, ch.breath);
  c.set('pitch', 0, 60, CURVE_STEP);
  c.set('level', 0, 0, CURVE_STEP);
  c.set('breath', 0, 0, CURVE_STEP);
  c.set('fric', 0, 0, CURVE_STEP);
  for (let i = 0; i < 5; i++) {
    c.set(`f${i + 1}` as ParamName, 0, f[i], CURVE_STEP);
    c.set(`b${i + 1}` as ParamName, 0, b[i], CURVE_STEP);
  }
  const nasalBase = 280 * ch.tract;
  c.set('nz', 0, nasalBase + ch.nasality * 200, CURVE_STEP);
  c.set('np', 0, nasalBase, CURVE_STEP);
  c.set('sf1', 0, 3000, CURVE_STEP);
  c.set('sb1', 0, 900, CURVE_STEP);
  c.set('sg1', 0, 0, CURVE_STEP);
  c.set('sf2', 0, 5000, CURVE_STEP);
  c.set('sb2', 0, 1400, CURVE_STEP);
  c.set('sg2', 0, 0, CURVE_STEP);
  c.set('oq', 0, 0.6, CURVE_STEP);
  c.set('rq', 0, 0.05, CURVE_STEP);
  c.set('tilt', 0, 3000, CURVE_STEP);
  c.set('vibDepth', 0, 0, CURVE_STEP);
  c.set('vibRate', 0, ex.vibRate, CURVE_STEP);
  c.set('growl', 0, ch.growl, CURVE_STEP);
  c.set('bar', 0, 0, CURVE_STEP);
  c.set('body', 0, ch.body, CURVE_STEP);
  c.set('drift', 0, ex.drift, CURVE_STEP);
}

/** 母音のフォルマント（高音では F1 を基音まで持ち上げる＝実際の歌唱と同じ挙動） */
function vowelFormants(vowel: Vowel, ch: VoiceCharacter, f0: number) {
  const v = VOWELS[vowel];
  const f = scaleFormants(v.f, ch.tract);
  const b = scaleBandwidths(v.b, ch.tract, ch.breath);
  if (f0 > f[0]) f[0] = f0 * 1.03;
  if (f[1] < f[0] * 1.15) f[1] = f[0] * 1.15;
  const nasalBase = 280 * ch.tract;
  const nasalAmount = vowel === 'N' ? 1 : ch.nasality;
  const nz = vowel === 'N' ? 480 * ch.tract : nasalBase + nasalAmount * 200;
  const np = nasalBase;
  return { f, b, nz, np };
}

function writeNote(
  c: Curves,
  plans: Plan[],
  index: number,
  ch: VoiceCharacter,
  ex: Expression,
  a4: number
) {
  const p = plans[index];
  const prev = index > 0 ? plans[index - 1] : null;
  const next = index + 1 < plans.length ? plans[index + 1] : null;
  const n = p.note;
  const f0 = midiToHz(n.note, a4);
  const target = vowelFormants(p.vowel, ch, f0);
  const level = p.level;
  const attack = ex.attack / 1000;
  const release = ex.release / 1000;
  const noteLen = Math.max(0.05, p.t1 - p.t0);

  // ------------------------------------------------------------------ 音程
  const scoop = n.scoop >= 0 ? n.scoop : ex.scoop;
  const porta = ex.portamento / 1000;
  if (p.phraseStart) {
    const drop = 1.6 * scoop + 0.15;
    c.set('pitch', Math.max(0, p.cStart - 0.02), n.note - drop, CURVE_STEP);
    c.set('pitch', p.t0 + Math.min(0.11 + scoop * 0.07, noteLen * 0.4), n.note, CURVE_SMOOTH);
  } else if (prev) {
    // 前の音から滑らかに繋ぐ。子音があるときは子音の中で音程を変える
    const mid = p.onset.length > 0 ? p.cStart + (p.t0 - p.cStart) * 0.5 : p.t0;
    c.set('pitch', Math.max(c.lastTime('pitch'), mid - porta * 0.6), prev.note.note, CURVE_LINEAR);
    c.set('pitch', mid + porta * 0.4, n.note, CURVE_SMOOTH);
  }

  // ---------------------------------------------------------------- 声の質
  const tension = clamp(ch.tension + (level - 0.85) * 0.35, 0, 1);
  const oq = clamp(0.74 - tension * 0.3, 0.3, 0.85);
  // 戻り相は声門が閉じる瞬間の鋭さ。周期の数%が実際の声に近く、
  // 長くすると倍音が消えて「こもった声」になる。
  const rq = clamp(0.012 + (1 - tension) * 0.055 + (1 - level) * 0.02, 0.008, 0.12);
  const tilt = clamp(2300 + ch.brightness * 3000 + level * 2600 + f0 * 0.8, 900, 11000);
  const breathAmt = clamp(ch.breath * (0.62 + (1 - level) * 0.7), 0, 1.2);
  c.set('oq', p.t0, oq);
  c.set('rq', p.t0, rq);
  c.set('tilt', p.t0, tilt);
  c.set('growl', p.t0, ch.growl * clamp(level * 1.1, 0, 1));

  // -------------------------------------------------------------- 息継ぎ音
  const gapPrev = prev ? p.t0 - prev.t1 : Infinity;
  if (p.phraseStart && ex.breathNoise > 0 && gapPrev > 0.42 && index > 0) {
    const bEnd = p.cStart - 0.035;
    const bStart = Math.max(prev ? prev.t1 + 0.04 : 0, bEnd - 0.2);
    if (bEnd - bStart > 0.06) {
      c.set('sf1', bStart, 850, CURVE_STEP);
      c.set('sb1', bStart, 1500, CURVE_STEP);
      c.set('sf2', bStart, 2300, CURVE_STEP);
      c.set('sb2', bStart, 2600, CURVE_STEP);
      c.set('sg1', bStart, 0.5, CURVE_STEP);
      c.set('sg2', bStart, 0.4, CURVE_STEP);
      c.set('fric', bStart, 0, CURVE_STEP);
      c.set('fric', bStart + (bEnd - bStart) * 0.55, 0.16 * ex.breathNoise, CURVE_SMOOTH);
      c.set('fric', bEnd, 0, CURVE_SMOOTH);
    }
  }

  // ---------------------------------------------------------------- 子音部
  let cursor = p.cStart;
  const consScale = p.onset.length
    ? (p.t0 - p.cStart) / p.onset.reduce((s, x) => s + x.closure + x.dur, 0)
    : 1;

  if (p.phraseStart && p.onset.length > 0) {
    // フレーズ頭は無音から始める
    c.set('level', Math.max(c.lastTime('level'), p.cStart - 0.01), 0, CURVE_LINEAR);
    c.set('breath', Math.max(c.lastTime('breath'), p.cStart - 0.01), 0, CURVE_LINEAR);
  }

  for (let k = 0; k < p.onset.length; k++) {
    const s = p.onset[k];
    const isLast = k === p.onset.length - 1;
    const closure = s.closure * consScale;
    const body = s.dur * consScale;
    const cs = cursor;
    const bs = cs + closure;
    const be = bs + body;
    cursor = be;

    // 子音の声道（ロクス）。母音の値へ pull の割合だけ寄せる
    const loc = [0, 1, 2].map((j) =>
      target.f[j] + (s.locus[j] * Math.pow(ch.tract, j === 0 ? 0.72 : 0.94) - target.f[j]) * s.pull
    );

    if (closure > 0) {
      // 閉鎖：声を切る（濁音は低いうなりを残す）
      c.set('level', cs, s.bar > 0 ? level * 0.22 : 0, s.kind === 'stop' ? CURVE_STEP : CURVE_LINEAR);
      c.set('breath', cs, 0, CURVE_STEP);
      c.set('fric', cs, 0, CURVE_STEP);
      c.set('bar', cs, s.bar, CURVE_STEP);
      c.set('bar', be, s.bar * 0.4, CURVE_LINEAR);
      for (let j = 0; j < 3; j++) c.set(`f${j + 1}` as ParamName, cs, loc[j], CURVE_LINEAR);
    } else {
      for (let j = 0; j < 3; j++) c.set(`f${j + 1}` as ParamName, bs, loc[j], CURVE_SMOOTH);
    }

    // 摩擦・破裂のノイズ帯域
    if (s.fric > 0 || s.breath > 0) {
      c.set('sf1', bs, s.sf[0] * Math.pow(ch.tract, 0.4), CURVE_STEP);
      c.set('sb1', bs, s.sb[0], CURVE_STEP);
      c.set('sf2', bs, s.sf[1] * Math.pow(ch.tract, 0.4), CURVE_STEP);
      c.set('sb2', bs, s.sb[1], CURVE_STEP);
      c.set('sg1', bs, s.sg[0], CURVE_STEP);
      c.set('sg2', bs, s.sg[1], CURVE_STEP);
    }

    switch (s.kind) {
      case 'stop': {
        // 破裂：一瞬の強いノイズ → 気息 → 母音
        const burst = Math.min(0.012, body * 0.45);
        c.set('fric', bs, 0, CURVE_STEP);
        c.set('fric', bs + 0.0015, s.fric, CURVE_STEP);
        c.set('fric', bs + burst, s.fric * 0.32, CURVE_LINEAR);
        c.set('fric', be, s.fric * 0.12, CURVE_LINEAR);
        c.set('breath', bs + burst, s.breath, CURVE_LINEAR);
        c.set('breath', be, s.breath * 0.5, CURVE_LINEAR);
        c.set('level', bs, s.voiced * level * 0.3, CURVE_STEP);
        break;
      }
      case 'affricate': {
        c.set('fric', bs, s.fric * 0.5, CURVE_STEP);
        c.set('fric', bs + body * 0.25, s.fric, CURVE_LINEAR);
        c.set('fric', be, s.fric * 0.7, CURVE_LINEAR);
        c.set('level', bs, s.voiced * level * 0.5, CURVE_LINEAR);
        break;
      }
      case 'fric': {
        c.set('fric', bs, s.fric * 0.35, CURVE_LINEAR);
        c.set('fric', bs + body * 0.4, s.fric, CURVE_SMOOTH);
        c.set('fric', be, s.fric * 0.55, CURVE_LINEAR);
        c.set('level', bs, s.voiced * level * 0.55, CURVE_LINEAR);
        c.set('bar', bs, s.bar, CURVE_LINEAR);
        c.set('bar', be, 0, CURVE_LINEAR);
        break;
      }
      case 'aspirate': {
        c.set('breath', bs, s.breath * 1.1, CURVE_LINEAR);
        c.set('breath', be, s.breath * 0.5, CURVE_LINEAR);
        c.set('fric', bs, s.fric, CURVE_LINEAR);
        c.set('fric', be, s.fric * 0.4, CURVE_LINEAR);
        c.set('level', bs, 0, CURVE_LINEAR);
        break;
      }
      case 'nasal': {
        c.set('level', bs, level * 0.78, CURVE_SMOOTH);
        c.set('fric', bs, 0, CURVE_LINEAR);
        c.set('breath', bs, breathAmt * 0.3, CURVE_LINEAR);
        c.set('nz', bs, 480 * ch.tract, CURVE_SMOOTH);
        c.set('np', bs, 270 * ch.tract, CURVE_SMOOTH);
        break;
      }
      case 'glide': {
        c.set('level', bs, level * s.dip, CURVE_SMOOTH);
        c.set('fric', bs, 0, CURVE_LINEAR);
        break;
      }
      case 'flap': {
        c.set('level', bs, level * s.dip, CURVE_LINEAR);
        c.set('level', be, level * 0.85, CURVE_LINEAR);
        c.set('fric', bs, 0, CURVE_LINEAR);
        break;
      }
    }

    if (!isLast) {
      // 子音が連続するとき（きゃ = k + y など）は次のロクスへ動かす
      continue;
    }
  }

  // ---------------------------------------------------------------- 母音部
  const trans = (p.onset.length ? p.onset[p.onset.length - 1].trans : 0.02) * clamp(consScale, 0.5, 1.5);
  const vStart = p.t0;
  const vFull = vStart + Math.max(trans, 0.012);

  for (let j = 0; j < 5; j++) {
    c.set(`f${j + 1}` as ParamName, vFull, target.f[j], CURVE_SMOOTH);
    c.set(`b${j + 1}` as ParamName, vFull, target.b[j], CURVE_SMOOTH);
  }
  c.set('nz', vFull, target.nz, CURVE_SMOOTH);
  c.set('np', vFull, target.np, CURVE_SMOOTH);
  c.set('bar', vStart, 0, CURVE_LINEAR);

  // 立ち上がり（子音の種類で自然な速さが変わる）
  const lastCons = p.onset.length ? p.onset[p.onset.length - 1] : null;
  const softOnset = lastCons && (lastCons.kind === 'nasal' || lastCons.kind === 'glide' || lastCons.kind === 'flap');
  if (p.legato) {
    c.set('level', vStart, level, CURVE_SMOOTH);
  } else if (softOnset) {
    c.set('level', vStart + attack * 0.6, level, CURVE_SMOOTH);
  } else {
    c.set('level', vStart, c.lastValue('level'), CURVE_LINEAR);
    c.set('level', vStart + attack, level, CURVE_SMOOTH);
  }
  c.set('breath', vStart + attack, breathAmt, CURVE_SMOOTH);
  c.set('fric', vStart + Math.max(trans, 0.02), 0, CURVE_LINEAR);
  c.set('sg1', vStart + Math.max(trans, 0.02), 0, CURVE_LINEAR);
  c.set('sg2', vStart + Math.max(trans, 0.02), 0, CURVE_LINEAR);

  // 伸ばしている間のふくらみ（棒歌いを防ぐ）
  if (noteLen > 0.5) {
    const swellAt = vStart + noteLen * 0.55;
    c.set('level', swellAt, level * 1.06, CURVE_SMOOTH);
  }

  // -------------------------------------------------------------- ビブラート
  const vibAmount = n.vib >= 0 ? n.vib : 1;
  const depth = ex.vibDepth * vibAmount;
  if (depth > 1 && noteLen > 0.34) {
    const start = vStart + Math.max(0.12, noteLen * clamp(ex.vibDelay, 0, 0.9));
    const full = Math.min(p.t1 - 0.04, start + 0.22);
    if (full > start) {
      c.set('vibDepth', start, 0, CURVE_LINEAR);
      c.set('vibDepth', full, depth, CURVE_SMOOTH);
      c.set('vibRate', start, ex.vibRate * (0.94 + ((index * 37) % 13) / 100), CURVE_LINEAR);
    }
  } else {
    c.set('vibDepth', vStart, 0, CURVE_LINEAR);
  }

  // -------------------------------------------------------------- 語尾（撥音・促音・切り方）
  const nextIsClose = next && next.cStart - p.t1 < 0.02;
  let endLevelAt = p.t1;

  if (p.coda === 'N') {
    const codaLen = Math.min(0.16, noteLen * 0.35);
    const codaStart = p.t1 - codaLen;
    const nasal = vowelFormants('N', ch, f0);
    for (let j = 0; j < 3; j++) {
      c.set(`f${j + 1}` as ParamName, codaStart, target.f[j], CURVE_LINEAR);
      c.set(`f${j + 1}` as ParamName, p.t1, nasal.f[j], CURVE_SMOOTH);
    }
    c.set('nz', codaStart, target.nz, CURVE_LINEAR);
    c.set('nz', p.t1, 480 * ch.tract, CURVE_SMOOTH);
    c.set('np', p.t1, 270 * ch.tract, CURVE_SMOOTH);
    c.set('level', p.t1, level * 0.7, CURVE_SMOOTH);
    c.set('vibDepth', codaStart, 0, CURVE_LINEAR);
  } else if (p.coda === 'Q') {
    // 促音で切る（「あっ」）
    endLevelAt = p.t1 - Math.min(0.09, noteLen * 0.3);
    c.set('level', endLevelAt, level, CURVE_LINEAR);
    c.set('level', endLevelAt + 0.016, 0, CURVE_LINEAR);
    c.set('breath', endLevelAt + 0.016, 0, CURVE_LINEAR);
  }

  if (p.coda !== 'Q') {
    if (!next) {
      // 曲の終わり：息が抜けるように消す
      c.set('level', p.t1, level * 0.9, CURVE_LINEAR);
      c.set('level', p.t1 + release, 0, CURVE_SMOOTH);
      c.set('breath', p.t1, breathAmt * 1.5, CURVE_LINEAR);
      c.set('breath', p.t1 + release, 0, CURVE_SMOOTH);
      c.set('vibDepth', p.t1 + release, 0, CURVE_LINEAR);
    } else if (!nextIsClose) {
      const fall = Math.min(release, Math.max(0.03, next.cStart - p.t1 - 0.01));
      c.set('level', p.t1, level * 0.88, CURVE_LINEAR);
      c.set('level', p.t1 + fall, 0, CURVE_SMOOTH);
      c.set('breath', p.t1 + fall, 0, CURVE_LINEAR);
      c.set('vibDepth', p.t1 + fall * 0.5, 0, CURVE_LINEAR);
    }
  }
}
