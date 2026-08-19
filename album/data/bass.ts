// album/data/bass.ts
//
// アルバム「天問」(Tenmon) — ベース・パートの単独レンダリング用データモジュール。
// bass/src/data/demos.ts (アプリのデモUI) とは完全に独立しており、
// bass/src 以下のファイルは一切変更しない。ここではウォーキングベース生成器
// （声部連結・方向を汲んだアプローチノート・曲調ごとの小節の「型」）を
// 過去の実装から移植し、10曲すべてのコーラス数を
// /tmp/.../scratchpad/album-render-spec.md に定められた固定値 N に合わせている。
//
// 各曲の構成は「ヘッド, ヘッド, ソロ x (N-3), ヘッドアウト」の N コーラスのみ。
// 曲末の追加タグ（旧実装にあった2小節のエンディング）は、6パート合算時に
// 尺がずれる原因になるため廃止した — ヘッドアウト（最後のコーラス）が
// そのまま終止を兼ねる。

import { findPosition, noteFrequency, findTuning } from '../../bass/src/audio/fretboard';
import { DEFAULT_SETTINGS, type PerformanceEvent, type Technique } from '../../bass/src/audio/types';

/** 再現性のある微小な揺らぎ（毎回同じ演奏になるよう固定シード） */
function humanizer(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const NOTE_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * ベースラインを組み立てる補助クラス。
 * 押さえる弦とフレットは、実際のベーシストと同じように
 * 「いま手がある位置」から選ぶので、開放弦や運指も自然になる。
 */
class Take {
  events: PerformanceEvent[] = [];
  private rand: () => number;
  private tuning: number[];
  private a4: number;
  private hand = 3;
  private sounding = new Map<number, number>();
  defaultTech: Technique = 'finger';

  constructor(tuning: number[], a4: number, seed: number, tech: Technique = 'finger') {
    this.tuning = tuning;
    this.a4 = a4;
    this.rand = humanizer(seed);
    this.defaultTech = tech;
  }

  /** 左手のポジション（この付近のフレットが選ばれる） */
  position(fret: number) {
    this.hand = fret;
    return this;
  }

  /** 1音置く。duration は「音を伸ばす長さ」（秒） */
  note(time: number, midi: number, duration: number, vel = 0.7, tech?: Technique) {
    const pos = findPosition(midi, this.tuning, this.hand);
    if (!pos) return this;
    const technique = tech ?? this.defaultTech;
    const jitter = (this.rand() - 0.5) * 0.011;
    const start = Math.max(0, time + jitter);
    const velocity = Math.max(0.08, Math.min(1, vel + (this.rand() - 0.5) * 0.09));

    // 同じ弦で前の音が鳴っていたら、その音は自然に消える（1本の弦は1音まで）
    this.stopString(pos.str, start - 0.004);

    this.events.push({
      time: start,
      type: 'pluck',
      str: pos.str,
      fret: pos.fret,
      note: midi,
      freq: noteFrequency(midi, this.a4),
      vel: velocity,
      tech: technique,
    });
    this.sounding.set(pos.str, start + Math.max(0.05, duration));
    this.events.push({
      time: start + Math.max(0.05, duration),
      type: 'mute',
      str: pos.str,
      amount: 1,
    });
    return this;
  }

  /** すでに置いたミュートを前倒ししない（重複を避ける） */
  private stopString(str: number, time: number) {
    const until = this.sounding.get(str);
    if (until === undefined || until <= time) return;
    this.sounding.delete(str);
    // 直後に弾き直すので、消音イベントは削っておく
    const idx = this.events.findIndex(
      (e) => e.type === 'mute' && e.str === str && Math.abs(e.time - until) < 1e-6
    );
    if (idx >= 0) this.events.splice(idx, 1);
  }

  /** 演奏の最後に全部の弦を止める */
  finish(time: number) {
    this.events.push({ time, type: 'muteAll' });
    return this.events;
  }
}

/** 4分音符の長さ（秒） */
const beat = (bpm: number) => 60 / bpm;

// ---------------------------------------------------------------------------
// アルバム「天問」(Tenmon) 用のウォーキング・ベース生成ヘルパー
//
// コード進行（"Am7" のような文字列）から、実際のジャズ・ベーシストが弾くような
// ルート → コードトーン → 次のコードへのアプローチ、というウォーキングラインを
// 自動で組み立てる。10曲すべてがこの仕組みを共有する。
// ---------------------------------------------------------------------------

/** コードの構成音（ルートからの半音数）。スペックに登場する種類のみ対応 */
const QUALITY: Record<string, { third: number; fifth: number; seventh: number }> = {
  '': { third: 4, fifth: 7, seventh: 7 }, // 予備（メジャートライアド）
  maj7: { third: 4, fifth: 7, seventh: 11 },
  '7': { third: 4, fifth: 7, seventh: 10 },
  m7: { third: 3, fifth: 7, seventh: 10 },
  m7b5: { third: 3, fifth: 6, seventh: 10 },
  dim7: { third: 3, fifth: 6, seventh: 9 },
  '7alt': { third: 4, fifth: 6, seventh: 10 },
  m6: { third: 3, fifth: 7, seventh: 9 },
};

/** "Am7" "Bb7" "E7alt" "Ebm6" → { pc, quality } */
function parseChordSymbol(sym: string): { pc: number; quality: string } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym.trim());
  if (!m) return { pc: 0, quality: '' };
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const pc = ((NOTE_OFFSET[m[1]] + acc) % 12 + 12) % 12;
  return { pc, quality: m[3] };
}

/** ルートの音名（ピッチクラス）だけを取り出す */
function chordRootPc(sym: string): number {
  return parseChordSymbol(sym).pc;
}

/** ピッチクラスを、center にいちばん近いオクターブの MIDI ノートにする */
function nearestPc(pc: number, center: number): number {
  return pc + 12 * Math.round((center - pc) / 12);
}

/** コード1つ分の構成音を「ピッチクラス（0〜11、オクターブ未確定）」のまま返す */
function chordPcs(sym: string) {
  const { pc, quality } = parseChordSymbol(sym);
  const q = QUALITY[quality] ?? QUALITY[''];
  return {
    root: pc,
    third: (pc + q.third) % 12,
    fifth: (pc + q.fifth) % 12,
    seventh: (pc + q.seventh) % 12,
    ninth: (pc + 2) % 12, // 9度（スケール・パッシングトーンとしても使う）
    sixth: (pc + 9) % 12, // 6度（bebop 経過音・m6 コードの構成音）
  };
}

/**
 * ピッチクラスを「直前に弾いた音にいちばん近いオクターブ」で確定する。
 * ただし center から maxJump 半音より離れてしまう場合は center 側の
 * オクターブに戻す（音域が徐々に迷子にならないようにする、緩いクランプ）。
 * これが実際のベーシストの「スムーズな運指」＝声部連結の核。
 */
function pickTone(pc: number, prevMidi: number, center: number, maxJump = 8): number {
  const nearPrev = nearestPc(pc, prevMidi);
  if (Math.abs(nearPrev - center) <= maxJump) return nearPrev;
  return nearestPc(pc, center);
}

interface BarCtx {
  t: Take;
  center: number;
  u: number; // このバー内での「1拍」の秒数（4分音符 or 8分音符）
  time: number;
  prevMidi: number;
  velBase: number;
}

/** 1音置いて、時間と「直前の音」を進める（声部連結の起点はここ） */
function place(ctx: BarCtx, pc: number, beats: number, velMul = 1, maxJump = 8): void {
  const midi = pickTone(pc, ctx.prevMidi, ctx.center, maxJump);
  ctx.t.note(ctx.time, midi, ctx.u * beats * 0.88, ctx.velBase * velMul);
  ctx.time += ctx.u * beats;
  ctx.prevMidi = midi;
}

/**
 * 次のコードのルートへ、半音上／半音下のどちらか「直前の音から近い方」で
 * 入るターゲット・アプローチノートを置く。進行方向（上行してきたか下行して
 * きたか）を汲んで半音の向きを選ぶので、機械的に「常に半音下から」にはならない。
 */
function placeApproach(ctx: BarCtx, nextRootPc: number, beats: number, velMul = 1): void {
  const below = nearestPc((nextRootPc + 11) % 12, ctx.prevMidi);
  const above = nearestPc((nextRootPc + 1) % 12, ctx.prevMidi);
  const midi = Math.abs(below - ctx.prevMidi) <= Math.abs(above - ctx.prevMidi) ? below : above;
  ctx.t.note(ctx.time, midi, ctx.u * beats * 0.9, ctx.velBase * velMul);
  ctx.time += ctx.u * beats;
  ctx.prevMidi = midi;
}

// --- 4/4（または4拍ぶん）の小節の「型」。複数用意して曲中で混ぜることで、
//     機械的な「ルート-3-5-アプローチ」の単純な繰り返しにならないようにする。

/** ルート→3度→5度→アプローチ（王道の上行形） */
function shapeArcUp(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.third, 1);
  place(ctx, pcs.fifth, 1);
  placeApproach(ctx, nextRootPc, 1);
}

/** ルート→5度→3度→アプローチ（弓なりの輪郭） */
function shapeArcDown(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.fifth, 1);
  place(ctx, pcs.third, 1);
  placeApproach(ctx, nextRootPc, 1);
}

/** ルート→9度→3度→アプローチ（スケール的に段階進行するライン） */
function shapeStepwise(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.ninth, 1, 0.85);
  place(ctx, pcs.third, 1);
  placeApproach(ctx, nextRootPc, 1);
}

/** ルート→7度→5度→3度（下降アルペジオ。次小節へは経過的につながる） */
function shapeDescend(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.seventh, 1);
  place(ctx, pcs.fifth, 1);
  place(ctx, pcs.third, 1, 0.95);
}

/** ルート→5度→（上から半音／下から半音の）二重アプローチで挟み込む、ビバップ的な仕掛け */
function shapeEnclosure(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.fifth, 1);
  place(ctx, (nextRootPc + 1) % 12, 0.5, 0.8);
  place(ctx, (nextRootPc + 11) % 12, 0.5, 1.0);
}

/** ルート→3度→8分音符4つの駆け上がり／下り→アプローチ。速いテンポでの推進力用 */
function shapeBebopRun(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.third, 1);
  place(ctx, pcs.fifth, 0.5, 0.85);
  place(ctx, pcs.sixth, 0.5, 0.8);
  place(ctx, pcs.seventh, 0.5, 0.85);
  placeApproach(ctx, nextRootPc, 0.5, 1.05);
}

/** 同じコードが次の小節も続くとき用：ルート中心に留まる（モーダルな静けさ） */
function shapePedal(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>) {
  place(ctx, pcs.root, 1.5, 1.15);
  place(ctx, pcs.fifth, 1, 0.8);
  place(ctx, pcs.ninth, 1, 0.75);
  place(ctx, pcs.root, 0.5, 0.9);
}

function pickWalkShape4(
  rng: () => number,
  role: 'head' | 'solo' | 'headOut',
  bpm: number,
  chordRepeats: boolean,
  lastShape: string | null
): string {
  const pool: string[] = [];
  if (chordRepeats) {
    pool.push('pedal', 'pedal', 'stepwise');
  } else {
    pool.push('arcUp', 'arcUp', 'arcDown', 'stepwise', 'descend');
    if (role !== 'head' || bpm < 130) pool.push('enclosure');
    if (bpm >= 150) pool.push('bebopRun', role === 'solo' ? 'bebopRun' : 'arcUp');
  }
  let choice = pool[Math.floor(rng() * pool.length)];
  if (choice === lastShape && pool.length > 1) choice = pool[Math.floor(rng() * pool.length)];
  return choice;
}

// --- 3/4（ジャズ・ワルツ）用の型 ---

function shapeArc3(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.fifth, 1);
  placeApproach(ctx, nextRootPc, 1);
}
function shapeStep3(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.third, 1, 0.85);
  placeApproach(ctx, nextRootPc, 1);
}
function shapeArp3(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.seventh, 1);
  place(ctx, pcs.fifth, 1, 0.95);
}
function shapePedal3(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>) {
  place(ctx, pcs.root, 1.5, 1.15);
  place(ctx, pcs.fifth, 1, 0.8);
  place(ctx, pcs.root, 0.5, 0.9);
}
function pickWalkShape3(rng: () => number, chordRepeats: boolean, lastShape: string | null): string {
  const pool = chordRepeats ? ['pedal3', 'pedal3', 'arc3'] : ['arc3', 'arc3', 'step3', 'arp3'];
  let choice = pool[Math.floor(rng() * pool.length)];
  if (choice === lastShape && pool.length > 1) choice = pool[Math.floor(rng() * pool.length)];
  return choice;
}

/** コード記号1つぶん（1小節、または早変わりの半小節）を実際に鳴らす */
function walkBarPlay(
  t: Take,
  sym: string,
  nextSym: string,
  beatsPerBar: number,
  u: number,
  center: number,
  role: 'head' | 'solo' | 'headOut',
  bpm: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number },
  chordRepeats: boolean,
  lastShapeRef: { shape: string | null }
): number {
  const pcs = chordPcs(sym);
  const nextRootPc = chordRootPc(nextSym);
  const ctx: BarCtx = { t, center, u, time, prevMidi: prevRef.midi, velBase };
  if (beatsPerBar >= 4) {
    const shape = pickWalkShape4(rng, role, bpm, chordRepeats, lastShapeRef.shape);
    lastShapeRef.shape = shape;
    if (shape === 'arcUp') shapeArcUp(ctx, pcs, nextRootPc);
    else if (shape === 'arcDown') shapeArcDown(ctx, pcs, nextRootPc);
    else if (shape === 'stepwise') shapeStepwise(ctx, pcs, nextRootPc);
    else if (shape === 'descend') shapeDescend(ctx, pcs);
    else if (shape === 'enclosure') shapeEnclosure(ctx, pcs, nextRootPc);
    else if (shape === 'bebopRun') shapeBebopRun(ctx, pcs, nextRootPc);
    else shapePedal(ctx, pcs);
  } else if (beatsPerBar === 3) {
    const shape = pickWalkShape3(rng, chordRepeats, lastShapeRef.shape);
    lastShapeRef.shape = shape;
    if (shape === 'arc3') shapeArc3(ctx, pcs, nextRootPc);
    else if (shape === 'step3') shapeStep3(ctx, pcs, nextRootPc);
    else if (shape === 'arp3') shapeArp3(ctx, pcs);
    else shapePedal3(ctx, pcs);
  } else if (beatsPerBar === 2) {
    if (rng() < 0.5) shapeArc2(ctx, pcs, nextRootPc);
    else shapeThird2(ctx, pcs, nextRootPc);
  } else {
    place(ctx, pcs.root, beatsPerBar || 1, 1.1);
  }
  prevRef.midi = ctx.prevMidi;
  // Bar-shapes place notes freely (e.g. shapeEnclosure ends on a short
  // chromatic pickup that only totals 3 of the bar's 4 beats, leaving a
  // deliberate quarter-rest before the next downbeat). The *clock* must
  // still advance by exactly one bar's worth of beats regardless of how
  // much of it a given shape filled with audible notes — otherwise bars
  // silently drift short and the whole track's total duration slips out
  // of lock-step with the other 5 stems it will be mixed with.
  return time + u * beatsPerBar;
}

// --- 1小節に2コードが入る「早変わり」半小節（2拍）用の型 ---
function shapeArc2(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  placeApproach(ctx, nextRootPc, 1);
}
function shapeThird2(ctx: BarCtx, pcs: ReturnType<typeof chordPcs>, nextRootPc: number) {
  place(ctx, pcs.root, 1, 1.15);
  place(ctx, pcs.third, 0.5, 0.85);
  placeApproach(ctx, nextRootPc, 0.5, 1.0);
}

/** ウォーキング・コーラスを1周ぶん演奏する（ヘッド／ソロで型の出方を変える） */
function playWalkChorus(
  t: Take,
  bars: string[][],
  beatsPerBar: number,
  u: number,
  center: number,
  role: 'head' | 'solo' | 'headOut',
  bpm: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number },
  lastShapeRef: { shape: string | null }
): number {
  for (let i = 0; i < bars.length; i++) {
    const chord = bars[i];
    const nextChord = bars[(i + 1) % bars.length];
    if (chord.length === 1) {
      const repeats = chord[0] === nextChord[0];
      time = walkBarPlay(t, chord[0], nextChord[0], beatsPerBar, u, center, role, bpm, time, velBase, rng, prevRef, repeats, lastShapeRef);
    } else {
      // 1小節に2つコード＝それぞれ半分の拍数で駆け足に切り替える
      const half = beatsPerBar / chord.length;
      for (let c = 0; c < chord.length; c++) {
        const nxt = c < chord.length - 1 ? chord[c + 1] : nextChord[0];
        time = walkBarPlay(t, chord[c], nxt, half, u, center, role, bpm, time, velBase, rng, prevRef, false, lastShapeRef);
      }
    }
  }
  return time;
}

/**
 * バラード用：小節ごと・コーラスごとに「半音符主体で歌う型」を混ぜる。
 * 1コーラス目は伸びやかなロング・トーン中心、以降はコード・トーンを
 * 使った動きや、拍の頭をわずかにずらすシンコペーションを混ぜて単調さを避ける。
 */
function playBalladChorus(
  t: Take,
  bars: string[][],
  u: number,
  center: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number },
  chorusIdx: number
): number {
  for (const chord of bars) {
    if (chord.length === 1) {
      const pcs = chordPcs(chord[0]);
      const ctx: BarCtx = { t, center, u, time, prevMidi: prevRef.midi, velBase };
      const move = chorusIdx === 0 ? 0 : Math.floor(rng() * 3);
      if (move === 0) {
        // ルートを長く伸ばし、後半で5度へゆっくり動く（呼吸するロング・トーン）
        place(ctx, pcs.root, 2.5, 1.05);
        place(ctx, pcs.fifth, 1.5, 0.85);
      } else if (move === 1) {
        // ルート→3度→5度、階段状に登る
        place(ctx, pcs.root, 2, 1.05);
        place(ctx, pcs.third, 1, 0.85);
        place(ctx, pcs.fifth, 1, 0.8);
      } else {
        // シンコペーション気味：ルート→5度→（次のコードへ寄りかかる）7度
        place(ctx, pcs.root, 1.5, 1.05);
        place(ctx, pcs.fifth, 1, 0.8);
        place(ctx, pcs.seventh, 1.5, 0.85);
      }
      time = ctx.time;
      prevRef.midi = ctx.prevMidi;
    } else {
      for (const sym of chord) {
        const pcs = chordPcs(sym);
        const ctx: BarCtx = { t, center, u, time, prevMidi: prevRef.midi, velBase };
        place(ctx, pcs.root, 1.5, 1.0);
        place(ctx, pcs.fifth, 0.5, 0.8);
        time = ctx.time;
        prevRef.midi = ctx.prevMidi;
      }
    }
  }
  return time;
}

/** ボサノバ用：付点4分＋8分の伝統的なリズムの型に、コード・トーンの動きを3パターン混ぜる */
function bossaFigure(
  t: Take,
  sym: string,
  u8: number,
  center: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number },
  totalEighths: number
): number {
  const pcs = chordPcs(sym);
  const ctx: BarCtx = { t, center, u: u8, time, prevMidi: prevRef.midi, velBase };
  if (totalEighths >= 8) {
    const variant = Math.floor(rng() * 3);
    if (variant === 0) {
      place(ctx, pcs.root, 3, 1.15);
      place(ctx, pcs.fifth, 1, 0.82);
      place(ctx, pcs.root, 2, 1.0);
      place(ctx, pcs.fifth, 2, 0.9);
    } else if (variant === 1) {
      place(ctx, pcs.root, 3, 1.15);
      place(ctx, pcs.third, 1, 0.8);
      place(ctx, pcs.fifth, 2, 0.95);
      place(ctx, pcs.seventh, 2, 0.85);
    } else {
      place(ctx, pcs.root, 3, 1.15);
      place(ctx, pcs.fifth, 1, 0.82);
      place(ctx, pcs.third, 2, 0.9);
      place(ctx, pcs.root, 2, 0.85);
    }
  } else {
    if (rng() < 0.5) {
      place(ctx, pcs.root, 3, 1.1);
      place(ctx, pcs.fifth, 1, 0.85);
    } else {
      place(ctx, pcs.root, 3, 1.1);
      place(ctx, pcs.third, 1, 0.85);
    }
  }
  prevRef.midi = ctx.prevMidi;
  return ctx.time;
}

function playBossaChorus(
  t: Take,
  bars: string[][],
  u8: number, // 8分音符の長さ
  center: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number }
): number {
  for (const chord of bars) {
    if (chord.length === 1) {
      time = bossaFigure(t, chord[0], u8, center, time, velBase, rng, prevRef, 8);
    } else {
      const halfUnits = 8 / chord.length;
      for (const sym of chord) time = bossaFigure(t, sym, u8, center, time, velBase, rng, prevRef, halfUnits);
    }
  }
  return time;
}

/**
 * アフロキューバン／トゥンバオ用：1拍目・2拍目表を休符にし、
 * 「2拍目の裏」でルートを先取りして3拍目まで伸ばし、「4拍目の裏」で
 * 5度（または次のコードへの半音アプローチ）を先取りして次小節へ食い込ませる。
 * ボサノバとは違う「アンティシペーション」中心の跳ねを作る。
 */
function tumbaoFigure(
  t: Take,
  sym: string,
  nextRootPc: number,
  u8: number,
  center: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number },
  totalEighths: number
): number {
  const pcs = chordPcs(sym);
  const ctx: BarCtx = { t, center, u: u8, time, prevMidi: prevRef.midi, velBase };
  if (totalEighths >= 8) {
    ctx.time += u8 * 2; // 1拍目ぶん休み、溜める
    place(ctx, pcs.root, 3, 1.2);
    if (rng() < 0.55) {
      place(ctx, pcs.fifth, 3, 0.95);
    } else {
      placeApproach(ctx, nextRootPc, 3, 1.0);
    }
  } else {
    ctx.time += u8 * 1;
    place(ctx, pcs.root, 3, 1.15);
  }
  prevRef.midi = ctx.prevMidi;
  return ctx.time;
}

function playLatinChorus(
  t: Take,
  bars: string[][],
  u8: number,
  center: number,
  time: number,
  velBase: number,
  rng: () => number,
  prevRef: { midi: number }
): number {
  for (let i = 0; i < bars.length; i++) {
    const chord = bars[i];
    const nextChord = bars[(i + 1) % bars.length];
    if (chord.length === 1) {
      time = tumbaoFigure(t, chord[0], chordRootPc(nextChord[0]), u8, center, time, velBase, rng, prevRef, 8);
    } else {
      const halfUnits = 8 / chord.length;
      for (let c = 0; c < chord.length; c++) {
        const nxt = c < chord.length - 1 ? chord[c + 1] : nextChord[0];
        time = tumbaoFigure(t, chord[c], chordRootPc(nxt), u8, center, time, velBase, rng, prevRef, halfUnits);
      }
    }
  }
  return time;
}

type TenmonKind = 'walk' | 'ballad' | 'bossa' | 'latin';

/**
 * 「天問」10曲共通のビルダー。
 *   totalChoruses = ヘッド2回 + ソロ (totalChoruses-3) 周 + 最後のヘッドアウト1回。
 *   ヘッド（role='head'）は控えめに、ソロ（role='solo'）は型のバリエーションと
 *   音量を増やして「盛り上がり」を作り、最後のヘッドアウト（role='headOut'）で
 *   落ち着く。6パート合算時の尺を厳密にそろえるため、末尾の追加タグは付けない
 *   ——ヘッドアウトの最終音がそのまま曲の終わりになる。
 *   戻り値の durationSec は「実際に鳴らした最終イベント時刻」そのものなので、
 *   このモジュールの計算と、渡された仕様書の合計秒数は一致する。
 */
function buildTenmonTrack(
  tuning: number[],
  a4: number,
  seed: number,
  bpm: number,
  beatsPerBar: number,
  bars: string[][],
  center: number,
  hand: number,
  totalChoruses: number,
  kind: TenmonKind
): { events: PerformanceEvent[]; durationSec: number } {
  const t = new Take(tuning, a4, seed, 'finger').position(hand);
  const rng = humanizer(seed + 9001);
  const u = beat(bpm);
  let time = 0;
  const prevRef = { midi: center };
  const lastShapeRef: { shape: string | null } = { shape: null };
  for (let c = 0; c < totalChoruses; c++) {
    const role: 'head' | 'solo' | 'headOut' = c <= 1 ? 'head' : c === totalChoruses - 1 ? 'headOut' : 'solo';
    if (kind === 'ballad') {
      const velBase = 0.58 + (role === 'solo' ? 0.05 : 0);
      time = playBalladChorus(t, bars, u, center, time, velBase, rng, prevRef, c);
    } else if (kind === 'bossa') {
      const velBase = 0.62 + (role === 'solo' ? 0.04 : 0);
      time = playBossaChorus(t, bars, u / 2, center, time, velBase, rng, prevRef);
    } else if (kind === 'latin') {
      const velBase = 0.66 + (role === 'solo' ? 0.05 : 0);
      time = playLatinChorus(t, bars, u / 2, center, time, velBase, rng, prevRef);
    } else {
      const velBase = role === 'solo' ? 0.66 + Math.min(0.08, (c - 2) * 0.012) : role === 'headOut' ? 0.63 : 0.6;
      time = playWalkChorus(t, bars, beatsPerBar, u, center, role, bpm, time, velBase, rng, prevRef, lastShapeRef);
    }
  }
  const durationSec = time;
  const events = t.finish(time);
  return { events, durationSec };
}

// ---------------------------------------------------------------------------
// 曲データ（キー／コード進行／フックは album-tenmon-spec.md のまま。
// コーラス数のみ album-render-spec.md の固定値 N に合わせてある）
// ---------------------------------------------------------------------------

interface TenmonTrackDef {
  id: string;
  title: string;
  presetId: string;
  bpm: number;
  beatsPerBar: number;
  bars: string[][];
  center: number;
  hand: number;
  totalChoruses: number; // = N（ロック済み）
  kind: TenmonKind;
  seed: number;
}

const TENMON_TRACKS: TenmonTrackDef[] = [
  {
    id: 'tenmon-01',
    title: '混沌の序章',
    presetId: 'jazz',
    bpm: 96,
    beatsPerBar: 4,
    bars: [['Am7'], ['Am7'], ['Dm7'], ['Dm7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7']],
    center: 33,
    hand: 3,
    totalChoruses: 9, // N=9 → 9 * 20.000s = 180.0s
    kind: 'walk',
    seed: 173,
  },
  {
    id: 'tenmon-02',
    title: '誰が空を創ったのか',
    presetId: 'jazz',
    bpm: 144,
    beatsPerBar: 4,
    bars: [
      ['Bb7'], ['Eb7'], ['Bb7'], ['Bb7'], ['Eb7'], ['Edim7'], ['Bb7'], ['G7'],
      ['Cm7'], ['F7'], ['Bb7', 'G7'], ['Cm7', 'F7'],
    ],
    center: 34,
    hand: 3,
    totalChoruses: 9, // N=9 → 9 * 20.000s = 180.0s
    kind: 'walk',
    seed: 191,
  },
  {
    id: 'tenmon-03',
    title: '星の回廊',
    presetId: 'jazz',
    bpm: 168,
    beatsPerBar: 3,
    bars: [
      ['Dm7'], ['Gm7'], ['C7'], ['Fmaj7'], ['Bbmaj7'], ['E7alt'],
      ['Am7'], ['D7'], ['Gm7'], ['C7'], ['Dm7'], ['Dm7'],
    ],
    center: 38,
    hand: 4,
    totalChoruses: 14, // N=14 → 14 * 12.857s = 180.0s
    kind: 'walk',
    seed: 211,
  },
  {
    id: 'tenmon-04',
    title: '地の果てへ',
    presetId: 'jazz',
    bpm: 132,
    beatsPerBar: 4,
    bars: [
      ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7'], ['Gm7', 'C7'],
      ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7', 'G7'], ['Cmaj7'],
    ],
    center: 36,
    hand: 3,
    totalChoruses: 12, // N=12 (unchanged) → 12 * 14.545s = 174.5s
    kind: 'bossa',
    seed: 229,
  },
  {
    id: 'tenmon-05',
    title: '問いかける月',
    presetId: 'fretless',
    bpm: 63,
    beatsPerBar: 4,
    bars: [
      ['Ebmaj7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ab7'], ['Gm7', 'C7'], ['Fm7', 'Bb7'],
    ],
    center: 41,
    hand: 5,
    totalChoruses: 6, // N=6 → 6 * 30.476s = 182.9s
    kind: 'ballad',
    seed: 251,
  },
  {
    id: 'tenmon-06',
    title: '龍の眠り',
    presetId: 'jazz',
    bpm: 176,
    beatsPerBar: 4,
    bars: [
      ['Cm7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Abmaj7'], ['Dm7b5'], ['G7alt'],
      ['Cm7'], ['Fm7', 'Bb7'], ['Ebmaj7', 'Abmaj7'], ['Dm7b5', 'G7alt'],
      ['Cm7'], ['Ab7'], ['G7'], ['Cm7'],
    ],
    center: 36,
    hand: 3,
    totalChoruses: 8, // N=8 (unchanged) → 8 * 21.818s = 174.5s
    kind: 'walk',
    seed: 269,
  },
  {
    id: 'tenmon-07',
    title: '見えない橋',
    presetId: 'jazz',
    bpm: 138,
    beatsPerBar: 4,
    bars: [['Am7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7']],
    center: 33,
    hand: 3,
    totalChoruses: 13, // N=13 (unchanged) → 13 * 13.913s = 180.9s
    kind: 'latin',
    seed: 283,
  },
  {
    id: 'tenmon-08',
    title: '光と影のあいだ',
    presetId: 'jazz',
    bpm: 120,
    beatsPerBar: 4,
    bars: [['Dm7'], ['Dm7'], ['Dm7'], ['Dm7'], ['Ebmaj7'], ['Ebmaj7'], ['Dm7'], ['Dm7']],
    center: 38,
    hand: 4,
    totalChoruses: 11, // N=11 (unchanged) → 11 * 16.000s = 176.0s
    kind: 'walk',
    seed: 307,
  },
  {
    id: 'tenmon-09',
    title: '天の川を渡る',
    presetId: 'jazz',
    bpm: 200,
    beatsPerBar: 4,
    bars: [['Bbmaj7'], ['Gm7'], ['Cm7'], ['F7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ebm6']],
    center: 34,
    hand: 3,
    // N=19（2ヘッド + 16ソロ + 1ヘッドアウト）→ 19 * 9.600s = 182.4s。
    // 16コーラスのソロは「トレーディング」的なブロウイング・セクション：
    // velBase が徐々に持ち上がり（0.66 → 上限0.74で頭打ち）、pickWalkShape4の
    // 乱数選択で型が毎回入れ替わるため、単純な16回ループの繰り返しにはならない。
    totalChoruses: 19,
    kind: 'walk',
    seed: 331,
  },
  {
    id: 'tenmon-10',
    title: '終わりなき問い',
    presetId: 'fretless',
    bpm: 58,
    beatsPerBar: 4,
    bars: [['Gmaj7'], ['Em7'], ['Am7'], ['D7'], ['Gmaj7'], ['Cmaj7'], ['Am7', 'D7'], ['Gmaj7']],
    center: 43,
    hand: 5,
    totalChoruses: 5, // N=5 (unchanged) → 5 * 33.103s = 165.5s
    kind: 'ballad',
    seed: 349,
  },
];

/**
 * デフォルトのチューニング／基準ピッチを、Kurogane Bass アプリの
 * DEFAULT_SETTINGS（4弦レギュラー E1 A1 D2 G2 / A4=440Hz）から解決して使う。
 */
const DEFAULT_TUNING = findTuning(DEFAULT_SETTINGS.tuningId).notes;
const DEFAULT_A4 = DEFAULT_SETTINGS.a4;

/**
 * アルバム「天問」の指定トラックIDに対応する、ベースパートの完全な
 * PerformanceEvent 列とプリセットID・尺（秒）を返す。
 * tenmon-01 .. tenmon-10 のみ有効。
 */
export function bassTenmonTrack(id: string): {
  events: PerformanceEvent[];
  presetId: string;
  durationSec: number;
} {
  const def = TENMON_TRACKS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown tenmon track id: ${id}`);
  const { events, durationSec } = buildTenmonTrack(
    DEFAULT_TUNING,
    DEFAULT_A4,
    def.seed,
    def.bpm,
    def.beatsPerBar,
    def.bars,
    def.center,
    def.hand,
    def.totalChoruses,
    def.kind
  );
  return { events, presetId: def.presetId, durationSec };
}
