// 天問 (Tenmon) — スタンドアロン・アルバム用ピアノ・パート
//
// piano/src/data/demos.ts に以前存在した Take/seq フレームワークと
// tenmon-01..tenmon-10 の楽曲構築ロジックを、アプリの Demo UI から完全に
// 切り離した「アルバム・ミックス書き出し専用」モジュールとして再構成した
// ものです。piano/src 配下は一切変更していません。
//
// 変更点（前回ラウンドとの差分）:
//   ・全曲の合計コーラス数を、6パートすべてが揃える必要のあるロック済み
//     仕様（/scratchpad/album-render-spec.md）の N に合わせて調整した
//     （03: 10→11, 05: 2→3, 09: 15→16 ソロコーラス。他は元々一致）。
//   ・末尾のタグ（終止フレーズ＋伸ばしコード）を廃止し、最後のヘッド・
//     アウト・コーラスの終わりでちょうど N×1コーラス秒＝仕様表の合計時間
//     になるようにした（「タグ／イントロの余剰小節を持たない」という
//     ロック仕様の要求のため）。
//
// キー・コード進行・メロディック・フックはオリジナル仕様
// （/scratchpad/album-tenmon-spec.md）から変更していない。

import type { PerformanceEvent } from '../../piano/src/audio/types';

/** 再現性のある微小な揺らぎ（毎回同じ演奏になるよう固定シード） */
function humanizer(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class Take {
  events: PerformanceEvent[] = [];
  private rand: () => number;

  constructor(seed: number) {
    this.rand = humanizer(seed);
  }

  note(time: number, note: number, duration: number, vel: number, spread = 0.012) {
    const jitter = (this.rand() - 0.5) * spread;
    const start = Math.max(0, time + jitter);
    const v = Math.max(0.05, Math.min(1, vel + (this.rand() - 0.5) * 0.08));
    this.events.push({ time: start, type: 'note', note, vel: v });
    this.events.push({ time: start + Math.max(0.05, duration), type: 'off', note });
  }

  pedal(time: number, value: number) {
    this.events.push({ time: Math.max(0, time), type: 'sustain', value });
  }

  /** 1小節ごとにペダルを踏み替える（直前で上げ、直後に踏み直す） */
  pedalPerBar(barStart: number) {
    if (barStart > 0.05) this.pedal(barStart - 0.02, 0);
    this.pedal(barStart + 0.06, 1);
  }

  /**
   * 楽譜文字列を並べる。
   *   "C5:1 D5:0.5 r:1 C4+E4+G4:2"  … 音名:長さ（長さは unit の倍数）
   *   末尾の "!" で強め、"~" で弱め
   * 返り値は次の音が始まる時刻。
   */
  seq(start: number, spec: string, unit: number, vel: number, legato = 0.92): number {
    let time = start;
    for (const token of spec.trim().split(/\s+/)) {
      if (!token || token === '|') continue;
      const [head, lenText] = token.split(':');
      const len = Number(lenText ?? 1) * unit;
      let v = vel;
      let names = head;
      if (names.endsWith('!')) { v += 0.12; names = names.slice(0, -1); }
      else if (names.endsWith('~')) { v -= 0.1; names = names.slice(0, -1); }
      if (names !== 'r' && names !== 'R') {
        for (const name of names.split('+')) {
          this.note(time, midiOf(name), Math.max(0.06, len * legato), v);
        }
      }
      time += len;
    }
    return time;
  }

  done(): PerformanceEvent[] {
    return this.events.sort((a, b) => a.time - b.time);
  }
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" "Bb2" "F5" → MIDIノート番号 */
function midiOf(name: string): number {
  const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`音名を解釈できません: ${name}`);
  let value = STEP[m[1].toUpperCase()];
  for (const accidental of m[2]) value += accidental === '#' ? 1 : -1;
  return value + (Number(m[3]) + 1) * 12;
}

// ---------------------------------------------------------------------------
// アルバム「天問」(Tenmon) 全10曲 — 本アプリのために書き下ろしたオリジナルの
// ジャズ・ピアノアルバム。
//
// 各曲は次の共通ヘルパーで組み立てる：
//   ・コード記号（"Am7" 等）をルート＋3/5/7/9度に解析し、中心音高に近い
//     オクターブへ配置する（tenmonTones / tenmonVoicing）
//   ・左手はルートレスの3和音ヴォイシング（3度・7度＋9度or5度）で、
//     曲ごとに用意したスウィング／ボサノバ／ラテン／モーダル／3拍子の
//     コンピング・パターンから拍位置を選んでシンコペーションする
//   ・右手のアドリブ・コーラスは、強拍にコードトーン、弱拍に半音／全音の
//     経過音・アプローチノートを置く生成ロジックで、コードチェンジに
//     沿った即興ラインを作る（バラードは四分・二分音符主体の生成に切替）
//   ・ヘッドは、スペックで与えられた4小節のフックをそのまま冒頭に使い、
//     残りの小節はそのモチーフ／和声にふさわしい旋律を書き下ろして続け、
//     ヘッド2回目の最終小節だけ別フレーズ（turnFill）に差し替えて
//     ソロへの橋渡しにする
//   構成 = ヘッド×2 → アドリブ・ソロ×Nコーラス → ヘッド・アウト×1
//   （タグなし。/scratchpad/album-render-spec.md のロック仕様どおり、
//     ヘッド・アウトの終わりでちょうど合計時間になる）。
// ---------------------------------------------------------------------------

type TenmonBar = string[]; // 1小節に入るコード（複数記述なら等分）

interface TenmonQuality { third: number; fifth: number; seventh: number; ninth: number; }

/** コードの構成音（ルートからの半音数）。アルバムに登場する種類のみ対応 */
const TENMON_QUALITY: Record<string, TenmonQuality> = {
  '': { third: 4, fifth: 7, seventh: 11, ninth: 14 },
  maj7: { third: 4, fifth: 7, seventh: 11, ninth: 14 },
  '7': { third: 4, fifth: 7, seventh: 10, ninth: 14 },
  m7: { third: 3, fifth: 7, seventh: 10, ninth: 14 },
  m7b5: { third: 3, fifth: 6, seventh: 10, ninth: 14 },
  dim7: { third: 3, fifth: 6, seventh: 9, ninth: 14 },
  '7alt': { third: 4, fifth: 6, seventh: 10, ninth: 13 }, // ♭9のテンションで代用
  m6: { third: 3, fifth: 7, seventh: 9, ninth: 14 },
};

/** "Am7" "Bb7" "E7alt" → { ピッチクラス, コード種 } */
function tenmonParseChord(sym: string): { pc: number; quality: string } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym.trim());
  if (!m) return { pc: 0, quality: '' };
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const pc = ((STEP[m[1]] + acc) % 12 + 12) % 12;
  return { pc, quality: m[3] };
}

/** ピッチクラスを center にいちばん近いオクターブの MIDI ノートにする */
function tenmonNearestPc(pc: number, center: number): number {
  return pc + 12 * Math.round((center - pc) / 12);
}

function tenmonTones(sym: string, center: number) {
  const { pc, quality } = tenmonParseChord(sym);
  const q = TENMON_QUALITY[quality] ?? TENMON_QUALITY['7'];
  return {
    root: tenmonNearestPc(pc, center),
    third: tenmonNearestPc((pc + q.third) % 12, center),
    fifth: tenmonNearestPc((pc + q.fifth) % 12, center),
    seventh: tenmonNearestPc((pc + q.seventh) % 12, center),
    ninth: tenmonNearestPc((pc + q.ninth) % 12, center),
  };
}

/** ルートレスの3声ヴォイシング（3度・7度＋9度 or 5度） */
function tenmonVoicing(sym: string, center: number, useNinth: boolean): number[] {
  const t = tenmonTones(sym, center);
  return [t.third, t.seventh, useNinth ? t.ninth : t.fifth].sort((a, b) => a - b);
}

/** 1小節に入るコードを拍で等分する */
function tenmonBarChords(bar: TenmonBar, beatsPerBar: number): { sym: string; beats: number }[] {
  const each = beatsPerBar / bar.length;
  return bar.map((sym) => ({ sym, beats: each }));
}

/** コンピングのオフセット候補（拍単位）。曲ごとのスタイルに合わせて使い分ける */
const TENMON_SWING_PATTERNS: number[][] = [[0, 1.67], [0.67, 2], [1, 2.67, 3], [0, 2, 3.67]];
const TENMON_MODAL_PATTERNS: number[][] = [[0.5, 2.5], [1.5, 3], [0, 2.5], [0.67, 2.67]];
const TENMON_WALTZ_PATTERNS: number[][] = [[0, 1.67], [0.67, 2], [0, 2]];
const TENMON_BOSSA_PATTERNS: number[][] = [[0, 1.5, 3], [0, 2, 3.5], [0, 1.5, 2.5]];
const TENMON_LATIN_PATTERNS: number[][] = [[0, 1.5, 2, 3.5], [0, 1, 2.5, 3], [0, 1.5, 3, 3.5]];

/** 1小節ぶんのコンピング（曲のパターン候補から拍位置を選び、ヴォイシングを置く） */
function tenmonCompBar(
  take: Take,
  bar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  patterns: number[][],
  center: number,
  vel: number,
  rand: () => number
) {
  const chords = tenmonBarChords(bar, beatsPerBar);
  const offs = patterns[Math.floor(rand() * patterns.length)];
  offs.forEach((off, oi) => {
    let acc = 0;
    let idx = chords.length - 1;
    for (let i = 0; i < chords.length; i++) {
      if (off < acc + chords[i].beats - 1e-6) { idx = i; break; }
      acc += chords[i].beats;
    }
    const notes = tenmonVoicing(chords[idx].sym, center, rand() < 0.6);
    const nextOff = offs[oi + 1] ?? beatsPerBar;
    const holdBeats = Math.max(0.55, (nextOff - off) * 0.85);
    const time = barStart + off * quarter;
    const v = vel + (rand() - 0.5) * 0.05;
    for (const n of notes) take.note(time, n, quarter * holdBeats, v, 0.01);
  });
}

/** バラード用コンピング：コードごとに長く伸ばして置く */
function tenmonCompBallad(
  take: Take,
  bar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  vel: number,
  rand: () => number
) {
  let t = barStart;
  for (const c of tenmonBarChords(bar, beatsPerBar)) {
    const notes = tenmonVoicing(c.sym, center, rand() < 0.5);
    for (const n of notes) take.note(t, n, quarter * c.beats * 0.94, vel + (rand() - 0.5) * 0.04, 0.02);
    t += quarter * c.beats;
  }
}

/** 8分音符主体のアドリブ：強拍=コードトーン、弱拍=半音/全音の経過・アプローチ音 */
function tenmonSoloBar(
  take: Take,
  sym: string,
  nextSym: string,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number,
  swing: boolean
) {
  const t = tenmonTones(sym, center);
  const targets = [t.root, t.third, t.fifth, t.seventh, t.ninth];
  const nextRoot = tenmonNearestPc(tenmonParseChord(nextSym).pc, center);
  const slots = Math.round(beatsPerBar * 2);
  let prev = targets[Math.floor(rand() * targets.length)];
  for (let i = 0; i < slots; i++) {
    const beatPos = i / 2;
    const isStrong = i % 2 === 0;
    let time = barStart + beatPos * quarter;
    if (swing && !isStrong) time = barStart + Math.floor(beatPos) * quarter + quarter * 0.667;
    if (!isStrong && rand() < 0.22) continue; // シンコペーションのための小休止
    let note: number;
    if (isStrong) {
      note = targets.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (rand() < 0.3) note = targets[Math.floor(rand() * targets.length)];
    } else {
      const isBarEnd = i === slots - 1;
      const anchor = isBarEnd ? nextRoot : prev;
      const dir = rand() < 0.5 ? -1 : 1;
      const step = rand() < 0.6 ? 1 : 2; // クロマチック or 全音アプローチ
      note = anchor + dir * step;
    }
    const dur = quarter * 0.5 * (swing ? (isStrong ? 0.85 : 0.7) : 0.82);
    const v = vel + (isStrong ? 0.04 : -0.03) + (rand() - 0.5) * 0.05;
    take.note(time, note, dur, Math.max(0.18, v));
    prev = note;
  }
}

/** 盛り上がりの小節に使う、16分音符のダブルタイム風フレーズ */
function tenmonSoloBarFast(
  take: Take,
  sym: string,
  nextSym: string,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number
) {
  const t = tenmonTones(sym, center);
  const targets = [t.root, t.third, t.fifth, t.seventh, t.ninth];
  const nextRoot = tenmonNearestPc(tenmonParseChord(nextSym).pc, center);
  const sixteenth = quarter / 4;
  const slots = Math.round(beatsPerBar * 4);
  let prev = targets[Math.floor(rand() * targets.length)];
  for (let i = 0; i < slots; i++) {
    const time = barStart + i * sixteenth;
    const isStrong = i % 4 === 0;
    if (!isStrong && rand() < 0.12) continue;
    let note: number;
    if (isStrong) {
      note = targets.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (rand() < 0.25) note = targets[Math.floor(rand() * targets.length)];
    } else {
      const dir = rand() < 0.5 ? -1 : 1;
      note = prev + dir * (rand() < 0.7 ? 1 : 2);
    }
    if (i === slots - 1) note = nextRoot;
    take.note(time, note, sixteenth * 0.85, vel + (isStrong ? 0.03 : -0.02) + (rand() - 0.5) * 0.04);
    prev = note;
  }
}

/** バラード用：四分・二分音符主体のゆったりしたアドリブ */
function tenmonSoloBarBallad(
  take: Take,
  sym: string,
  nextSym: string,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number
) {
  const t = tenmonTones(sym, center);
  const targets = [t.root, t.third, t.fifth, t.seventh, t.ninth];
  const nextRoot = tenmonNearestPc(tenmonParseChord(nextSym).pc, center);
  let time = barStart;
  let beatsLeft = beatsPerBar;
  let prev = targets[Math.floor(rand() * targets.length)];
  let first = true;
  while (beatsLeft > 0.01) {
    const dur = beatsLeft >= 2 && rand() < 0.55 ? 2 : 1;
    let note: number;
    if (first || rand() < 0.7) {
      note = targets.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (rand() < 0.3) note = targets[Math.floor(rand() * targets.length)];
    } else {
      const dir = rand() < 0.5 ? -1 : 1;
      note = prev + dir * (rand() < 0.6 ? 1 : 2);
    }
    const isLast = beatsLeft - dur <= 0.01;
    if (isLast && rand() < 0.4) note = nextRoot;
    take.note(time, note, quarter * dur * 0.9, vel + (rand() - 0.5) * 0.06);
    time += quarter * dur;
    beatsLeft -= dur;
    prev = note;
    first = false;
  }
}

/** 1小節（複数コードのこともある）ぶんのアドリブを、含まれるコードごとに分けて演奏 */
function tenmonSoloBarAny(
  take: Take,
  chordBar: TenmonBar,
  nextChordBar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number,
  swing: boolean,
  fast: boolean
) {
  const chords = tenmonBarChords(chordBar, beatsPerBar);
  let t = barStart;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const nextSym = i < chords.length - 1 ? chords[i + 1].sym : nextChordBar[0];
    if (fast) tenmonSoloBarFast(take, c.sym, nextSym, t, quarter, c.beats, center, rand, vel);
    else tenmonSoloBar(take, c.sym, nextSym, t, quarter, c.beats, center, rand, vel, swing);
    t += quarter * c.beats;
  }
}

function tenmonSoloBarBalladAny(
  take: Take,
  chordBar: TenmonBar,
  nextChordBar: TenmonBar,
  barStart: number,
  quarter: number,
  beatsPerBar: number,
  center: number,
  rand: () => number,
  vel: number
) {
  const chords = tenmonBarChords(chordBar, beatsPerBar);
  let t = barStart;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const nextSym = i < chords.length - 1 ? chords[i + 1].sym : nextChordBar[0];
    tenmonSoloBarBallad(take, c.sym, nextSym, t, quarter, c.beats, center, rand, vel);
    t += quarter * c.beats;
  }
}

interface TenmonTrackDef {
  bpm: number;
  beatsPerBar: number;
  bars: TenmonBar[];
  headBars: string[];
  turnFill: string;
  lhCenter: number;
  compPatterns: number[][];
  solo: 'swing' | 'straight' | 'ballad';
  soloCenter: number;
  soloChoruses: number;
  seed: number;
}

interface TenmonBuildResult {
  events: PerformanceEvent[];
  durationSec: number;
}

/**
 * ヘッド×2 → アドリブ・ソロ×N → ヘッド・アウト×1、という共通の曲の骨格。
 * ロック済みレンダー仕様どおり、タグ／イントロの余剰小節は一切持たず、
 * ヘッド・アウト・コーラスの終わりでちょうど
 * N（= 2 + soloChoruses + 1）× 1コーラス秒 の合計時間になる。
 */
function buildTenmonTrack(def: TenmonTrackDef): TenmonBuildResult {
  const take = new Take(def.seed);
  const rand = humanizer(def.seed + 777);
  const quarter = 60 / def.bpm;
  const bpb = def.beatsPerBar;
  const bar = quarter * bpb;
  const numBars = def.bars.length;
  const isBallad = def.solo === 'ballad';
  let time = 0;

  function playHeadChorus(vel: number, useTurnFill: boolean) {
    for (let i = 0; i < numBars; i++) {
      const barStart = time + i * bar;
      take.pedalPerBar(barStart);
      if (isBallad) tenmonCompBallad(take, def.bars[i], barStart, quarter, bpb, def.lhCenter, vel * 0.6, rand);
      else tenmonCompBar(take, def.bars[i], barStart, quarter, bpb, def.compPatterns, def.lhCenter, vel * 0.58, rand);
      const spec = useTurnFill && i === numBars - 1 ? def.turnFill : def.headBars[i];
      take.seq(barStart, spec, quarter, vel, 0.9);
    }
    time += numBars * bar;
  }

  playHeadChorus(0.5, false);
  playHeadChorus(0.52, true);

  for (let c = 0; c < def.soloChoruses; c++) {
    const vel = 0.4 + Math.min(0.14, c * 0.012);
    for (let i = 0; i < numBars; i++) {
      const barStart = time + i * bar;
      take.pedalPerBar(barStart);
      const chordBar = def.bars[i];
      const nextChordBar = def.bars[(i + 1) % numBars];
      if (isBallad) {
        tenmonCompBallad(take, chordBar, barStart, quarter, bpb, def.lhCenter, 0.26, rand);
        tenmonSoloBarBalladAny(take, chordBar, nextChordBar, barStart, quarter, bpb, def.soloCenter, rand, vel);
      } else {
        tenmonCompBar(take, chordBar, barStart, quarter, bpb, def.compPatterns, def.lhCenter, 0.3, rand);
        const isFinalRun = c === def.soloChoruses - 1 && i === numBars - 1;
        tenmonSoloBarAny(
          take, chordBar, nextChordBar, barStart, quarter, bpb, def.soloCenter, rand, vel,
          def.solo === 'swing', isFinalRun
        );
      }
    }
    time += numBars * bar;
  }

  playHeadChorus(0.58, false);
  // タグなし。ここで time はちょうど N×1コーラス秒（= ロック仕様の合計時間）。

  // 最後の小節の余韻（ペダルを含む）が自然に収まるよう、末尾でダンパーを上げる
  take.pedal(time - 0.02, 0);

  return { events: take.done(), durationSec: time };
}

// 01. 混沌の序章 — Aマイナー・ドリアン、4/4、96bpm、幻想的なモーダル・スウィング
// 8小節ヴァンプ、1コーラス=20.000秒。ロック仕様: N=9（ソロ6コーラス）＝180.0秒。
const TENMON_01_BARS: TenmonBar[] = [
  ['Am7'], ['Am7'], ['Dm7'], ['Dm7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'],
];
const TENMON_01_HEAD: string[] = [
  'A4:0.5 C5:0.5 r:1 E5:1 D5:0.5 C5:0.5',
  'A4:1 r:1 D5:0.5 F5:0.5 r:1',
  'E5:1 D5:0.5 C5:0.5 A4:1 r:1',
  'G4:0.5 A4:1.5 r:2',
  'E5:0.5 C5:0.5 r:1 A4:1 G4:0.5 A4:0.5',
  'F5:1 r:1 D5:0.5 C5:0.5 r:1',
  'D#5:0.5 E5:0.5 G5:0.5 F5:0.5 E5:1 r:1',
  'A4:0.5 C5:0.5 E5:1 A5:2',
];
function buildTenmon01(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 96, beatsPerBar: 4, bars: TENMON_01_BARS, headBars: TENMON_01_HEAD,
    turnFill: 'A4:0.5 C5:0.5 E5:0.5 G5:0.5 A5:0.5 G5:0.5 E5:0.5 C5:0.5',
    lhCenter: 57, compPatterns: TENMON_MODAL_PATTERNS, solo: 'swing', soloCenter: 69,
    soloChoruses: 6, seed: 90010101,
  });
}

// 02. 誰が空を創ったのか — Bb、4/4、144bpm、ミディアム・スウィングの12小節ブルース
// 1コーラス=20.000秒。ロック仕様: N=9（ソロ6コーラス）＝180.0秒。
const TENMON_02_BARS: TenmonBar[] = [
  ['Bb7'], ['Eb7'], ['Bb7'], ['Bb7'], ['Eb7'], ['Edim7'],
  ['Bb7'], ['G7'], ['Cm7'], ['F7'], ['Bb7', 'G7'], ['Cm7', 'F7'],
];
const TENMON_02_HEAD: string[] = [
  'Bb4:0.5 D5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1',
  'C5:1 r:0.5 Bb4:0.5 D5:1 r:1',
  'F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 Bb4:2',
  'r:4',
  'Eb5:0.5 D5:0.5 C5:1 Bb4:1 r:1',
  'F5:0.5 Eb5:0.5 D5:0.5 B4:0.5 Bb4:2',
  'D5:1 F5:0.5 Eb5:0.5 D5:1 Bb4:1',
  'G4:0.5 B4:0.5 D5:1 F5:1 r:1',
  'Eb5:1 D5:0.5 C5:0.5 Bb4:1 G4:1',
  'A4:0.5 C5:0.5 Eb5:1 D5:1 C5:1',
  'D5:1 F5:1 E5:0.5 D5:0.5 B4:1',
  'C5:1 Eb5:0.5 D5:0.5 Bb4:1 F4:1',
];
function buildTenmon02(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 144, beatsPerBar: 4, bars: TENMON_02_BARS, headBars: TENMON_02_HEAD,
    turnFill: 'Eb5:0.5 C5:0.5 Bb4:0.5 Ab4:0.5 F4:1 Eb4:1',
    lhCenter: 58, compPatterns: TENMON_SWING_PATTERNS, solo: 'swing', soloCenter: 70,
    soloChoruses: 6, seed: 90020202,
  });
}

// 03. 星の回廊 — Dマイナー、3/4、168bpm、ジャズワルツの12小節
// 1コーラス=12.857秒。ロック仕様: N=14（ソロ11コーラス）＝180.0秒。
// ※前ラウンドはソロ10コーラス（N=13）だった → +1コーラスに調整。
const TENMON_03_BARS: TenmonBar[] = [
  ['Dm7'], ['Gm7'], ['C7'], ['Fmaj7'], ['Bbmaj7'], ['E7alt'],
  ['Am7'], ['D7'], ['Gm7'], ['C7'], ['Dm7'], ['Dm7'],
];
const TENMON_03_HEAD: string[] = [
  'D5:1 F5:0.5 A5:0.5 G5:1',
  'F5:1 E5:1 D5:1',
  'C5:1.5 D5:1.5',
  'A4:3',
  'Bb4:1 D5:0.5 F5:0.5 A5:1',
  'G#4:1 B4:1 D5:1',
  'C5:1.5 E5:1.5',
  'F#4:1 A4:1 C5:1',
  'D5:1 Bb4:1 G4:1',
  'E4:1 G4:1 Bb4:1',
  'F4:1.5 A4:1.5',
  'D5:3',
];
function buildTenmon03(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 168, beatsPerBar: 3, bars: TENMON_03_BARS, headBars: TENMON_03_HEAD,
    turnFill: 'D5:0.5 F5:0.5 A5:0.5 G5:0.5 F5:0.5 D5:0.5',
    lhCenter: 50, compPatterns: TENMON_WALTZ_PATTERNS, solo: 'straight', soloCenter: 74,
    soloChoruses: 11, seed: 90030303,
  });
}

// 04. 地の果てへ — F、4/4、132bpm、ボサノバの8小節
// 1コーラス=14.545秒。ロック仕様: N=12（ソロ9コーラス）＝174.5秒。
const TENMON_04_BARS: TenmonBar[] = [
  ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7'], ['Gm7', 'C7'],
  ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7', 'G7'], ['Cmaj7'],
];
const TENMON_04_HEAD: string[] = [
  'C5:1 A4:0.5 F4:0.5 G4:1 A4:1',
  'Bb4:1 A4:0.5 G4:0.5 F4:2',
  'E4:1 G4:1 C5:1 Bb4:1',
  'A4:2 r:2',
  'C5:1 Bb4:0.5 A4:0.5 G4:1 F4:1',
  'G4:1 Bb4:0.5 A4:0.5 C#5:1 C5:1',
  'D5:1 F5:0.5 E5:0.5 D5:1 B4:1',
  'C5:1 E5:1 G5:2',
];
function buildTenmon04(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 132, beatsPerBar: 4, bars: TENMON_04_BARS, headBars: TENMON_04_HEAD,
    turnFill: 'C5:0.5 E5:0.5 G5:0.5 B5:0.5 C6:1 G5:1',
    lhCenter: 53, compPatterns: TENMON_BOSSA_PATTERNS, solo: 'straight', soloCenter: 65,
    soloChoruses: 9, seed: 90040404,
  });
}

// 05. 問いかける月 — Eb、4/4、63bpm、バラードの8小節
// 1コーラス=30.476秒。ロック仕様: N=6（ソロ3コーラス）＝182.9秒。
// ※前ラウンドはソロ2コーラス（N=5）だった → +1コーラスに調整。
const TENMON_05_BARS: TenmonBar[] = [
  ['Ebmaj7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ab7'], ['Gm7', 'C7'], ['Fm7', 'Bb7'],
];
const TENMON_05_HEAD: string[] = [
  'Bb4:1.5 Eb5:0.5 D5:1 C5:1',
  'Bb4:2 Ab4:1 G4:1',
  'F4:1 G4:1 Ab4:1 Bb4:1',
  'Eb5:4',
  'G4:1.5 Bb4:0.5 Eb5:2',
  'C5:1 Bb4:1 Ab4:2',
  'Bb4:1.5 G4:0.5 E5:1 D5:1',
  'Ab4:1 F4:1 D5:2',
];
function buildTenmon05(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 63, beatsPerBar: 4, bars: TENMON_05_BARS, headBars: TENMON_05_HEAD,
    turnFill: 'Ab4:0.5 F4:0.5 D5:0.5 Bb4:0.5 Ab4:1 F4:1',
    lhCenter: 51, compPatterns: [], solo: 'ballad', soloCenter: 70,
    soloChoruses: 3, seed: 90050505,
  });
}

// 06. 龍の眠り — Cマイナー、4/4、176bpm、ハードバップの16小節
// 1コーラス=21.818秒。ロック仕様: N=8（ソロ5コーラス）＝174.5秒。
const TENMON_06_BARS: TenmonBar[] = [
  ['Cm7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Abmaj7'], ['Dm7b5'], ['G7alt'],
  ['Cm7'], ['Fm7', 'Bb7'], ['Ebmaj7', 'Abmaj7'], ['Dm7b5', 'G7alt'], ['Cm7'], ['Ab7'], ['G7'], ['Cm7'],
];
const TENMON_06_HEAD: string[] = [
  'C5:0.5 Eb5:0.5 G5:0.5 F5:0.5 Eb5:1 D5:1',
  'C5:0.5 D5:0.5 Eb5:1 G4:2',
  'Ab4:0.5 Bb4:0.5 C5:0.5 D5:0.5 Eb5:2',
  'D5:1 C5:1 G4:2',
  'Bb4:0.5 D5:0.5 G5:0.5 F5:0.5 Eb5:1 D5:1',
  'C5:0.5 Eb5:0.5 Ab5:0.5 G5:0.5 F5:1 Eb5:1',
  'F4:0.5 Ab4:0.5 C5:0.5 Bb4:0.5 Ab4:2',
  'Bb4:0.5 Db5:0.5 F5:0.5 Ab4:0.5 G4:2',
  'Eb5:0.5 G5:0.5 C6:0.5 Bb5:0.5 G5:1 F5:1',
  'Ab5:0.5 F5:0.5 Eb5:1 D5:0.5 Bb4:0.5 F4:1',
  'G4:0.5 Bb4:0.5 Eb5:1 C5:0.5 Ab4:0.5 F4:1',
  'F4:0.5 Ab4:0.5 C5:1 B4:0.5 G4:1.5',
  'C5:0.5 Eb5:0.5 G5:1 Eb5:0.5 D5:0.5 C5:1',
  'Ab4:1 C5:1 Eb5:2',
  'B4:1 D5:1 F5:2',
  'Eb5:0.5 G5:0.5 C6:3',
];
function buildTenmon06(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 176, beatsPerBar: 4, bars: TENMON_06_BARS, headBars: TENMON_06_HEAD,
    turnFill: 'C5:0.5 Eb5:0.5 G5:0.5 Bb5:0.5 C6:0.5 Bb5:0.5 G5:0.5 Eb5:0.5',
    lhCenter: 48, compPatterns: TENMON_SWING_PATTERNS, solo: 'swing', soloCenter: 72,
    soloChoruses: 5, seed: 90060606,
  });
}

// 07. 見えない橋 — Aマイナー、4/4、138bpm、アフロキューバン／ラテンジャズの8小節
// 1コーラス=13.913秒。ロック仕様: N=13（ソロ10コーラス）＝180.9秒。
const TENMON_07_BARS: TenmonBar[] = [
  ['Am7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'],
];
const TENMON_07_HEAD: string[] = [
  'E5:0.5 A5:0.5 G5:1 E5:1 r:1',
  'D5:0.5 C5:0.5 A4:1 r:2',
  'E5:0.5 F5:0.5 E5:0.5 D5:0.5 C5:2',
  'B4:1 C5:1 A4:2',
  'C5:0.5 E5:0.5 A5:1 G5:1 r:1',
  'F5:0.5 A5:0.5 G5:1 F5:1 D5:1',
  'G#4:0.5 B4:0.5 D5:1 C5:1 r:1',
  'E5:0.5 C5:0.5 A4:3',
];
function buildTenmon07(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 138, beatsPerBar: 4, bars: TENMON_07_BARS, headBars: TENMON_07_HEAD,
    turnFill: 'A4:0.5 C5:0.5 E5:0.5 G5:0.5 A5:0.5 E5:0.5 C5:0.5 A4:0.5',
    lhCenter: 57, compPatterns: TENMON_LATIN_PATTERNS, solo: 'straight', soloCenter: 72,
    soloChoruses: 10, seed: 90070707,
  });
}

// 08. 光と影のあいだ — Dドリアン、4/4、120bpm、モーダル・ジャズの8小節ヴァンプ
// 1コーラス=16.000秒。ロック仕様: N=11（ソロ8コーラス）＝176.0秒。
const TENMON_08_BARS: TenmonBar[] = [
  ['Dm7'], ['Dm7'], ['Dm7'], ['Dm7'], ['Ebmaj7'], ['Ebmaj7'], ['Dm7'], ['Dm7'],
];
const TENMON_08_HEAD: string[] = [
  'D5:1 F5:0.5 A5:0.5 G5:1 F5:1',
  'E5:0.5 D5:0.5 C5:1 D5:2',
  'Eb5:1 F5:1 Eb5:1 D5:1',
  'C5:2 D5:2',
  'G4:1 Bb4:0.5 Eb5:0.5 F5:1 Eb5:1',
  'D5:1 Eb5:0.5 F5:0.5 G5:1 Eb5:1',
  'F5:1 D5:0.5 C5:0.5 A4:1 D5:1',
  'F5:1 A5:3',
];
function buildTenmon08(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 120, beatsPerBar: 4, bars: TENMON_08_BARS, headBars: TENMON_08_HEAD,
    turnFill: 'D5:0.5 F5:0.5 A5:0.5 C6:0.5 A5:0.5 F5:0.5 D5:0.5 A4:0.5',
    lhCenter: 50, compPatterns: TENMON_MODAL_PATTERNS, solo: 'swing', soloCenter: 72,
    soloChoruses: 8, seed: 90080808,
  });
}

// 09. 天の川を渡る — Bb、4/4、200bpm、アップテンポ・スウィング（リズムチェンジ系）の8小節
// 1コーラス=9.600秒。ロック仕様: N=19（ソロ16コーラス）＝182.4秒。
// ※前ラウンドはソロ15コーラス（N=18）だった → +1コーラスに調整。速い短い
// コーラスの「トレーディング」的なブロウ・セッションとして密度に変化を
// つける（tenmonSoloBarAny の isFinalRun による倍速フレーズ切替を利用）。
const TENMON_09_BARS: TenmonBar[] = [
  ['Bbmaj7'], ['Gm7'], ['Cm7'], ['F7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ebm6'],
];
const TENMON_09_HEAD: string[] = [
  'F5:0.5 G5:0.5 A5:0.5 Bb5:0.5 A5:1 G5:1',
  'F5:0.5 D5:0.5 C5:1 Bb4:2',
  'D5:0.5 Eb5:0.5 F5:1 Eb5:0.5 D5:0.5 r:1',
  'C5:2 Bb4:2',
  'Ab5:0.5 F5:0.5 Eb5:1 D5:0.5 C5:0.5 Bb4:1',
  'D5:0.5 F5:0.5 Ab5:0.5 G5:0.5 F5:1 D5:1',
  'G5:0.5 Bb5:0.5 Eb6:0.5 D6:0.5 C6:1 Bb5:1',
  'G5:0.5 Eb5:0.5 C6:1 Bb5:2',
];
function buildTenmon09(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 200, beatsPerBar: 4, bars: TENMON_09_BARS, headBars: TENMON_09_HEAD,
    turnFill: 'Eb5:0.25 Gb5:0.25 Bb5:0.25 C6:0.25 Bb5:0.5 Gb5:0.5 Eb5:1 Bb4:1',
    lhCenter: 58, compPatterns: TENMON_SWING_PATTERNS, solo: 'swing', soloCenter: 74,
    soloChoruses: 16, seed: 90090909,
  });
}

// 10. 終わりなき問い — G、4/4、58bpm、バラード／エピローグの8小節
// 1コーラス=33.103秒。ロック仕様: N=5（ソロ2コーラス）＝165.5秒。
const TENMON_10_BARS: TenmonBar[] = [
  ['Gmaj7'], ['Em7'], ['Am7'], ['D7'], ['Gmaj7'], ['Cmaj7'], ['Am7', 'D7'], ['Gmaj7'],
];
const TENMON_10_HEAD: string[] = [
  'D5:1.5 B4:0.5 A4:1 G4:1',
  'F#4:2 E4:1 D4:1',
  'G4:1 A4:1 B4:1 D5:1',
  'G5:4',
  'B4:1.5 D5:0.5 G5:1 F#5:1',
  'E5:2 D5:1 C5:1',
  'C5:1.5 B4:0.5 A4:1 F#4:1',
  'G4:1 B4:1 D5:2',
];
function buildTenmon10(): TenmonBuildResult {
  return buildTenmonTrack({
    bpm: 58, beatsPerBar: 4, bars: TENMON_10_BARS, headBars: TENMON_10_HEAD,
    turnFill: 'D5:1 B4:1 G4:2',
    lhCenter: 55, compPatterns: [], solo: 'ballad', soloCenter: 71,
    soloChoruses: 2, seed: 90101010,
  });
}

interface TenmonTrackMeta {
  presetId: string;
  build: () => TenmonBuildResult;
}

const TENMON_TRACKS: Record<string, TenmonTrackMeta> = {
  'tenmon-01': { presetId: 'cinematic', build: buildTenmon01 },
  'tenmon-02': { presetId: 'jazz', build: buildTenmon02 },
  'tenmon-03': { presetId: 'jazz', build: buildTenmon03 },
  'tenmon-04': { presetId: 'jazz', build: buildTenmon04 },
  'tenmon-05': { presetId: 'warm', build: buildTenmon05 },
  'tenmon-06': { presetId: 'jazz', build: buildTenmon06 },
  'tenmon-07': { presetId: 'jazz', build: buildTenmon07 },
  'tenmon-08': { presetId: 'jazz', build: buildTenmon08 },
  'tenmon-09': { presetId: 'bright', build: buildTenmon09 },
  'tenmon-10': { presetId: 'cinematic', build: buildTenmon10 },
};

export function pianoTenmonTrack(id: string): {
  events: PerformanceEvent[];
  presetId: string;
  durationSec: number;
} {
  const meta = TENMON_TRACKS[id];
  if (!meta) throw new Error(`未知のトラックID: ${id}`);
  const { events, durationSec } = meta.build();
  return { events, presetId: meta.presetId, durationSec };
}
