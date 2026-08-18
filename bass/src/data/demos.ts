import { findPosition, noteFrequency } from '../audio/fretboard';
import type { PerformanceEvent, Technique } from '../audio/types';

export interface Demo {
  id: string;
  title: string;
  style: string;
  note: string;
  presetId: string;
  bpm: number;
  /** 一緒に鳴らすと気持ちいいドラムパターン */
  rhythmId: string;
  build: (tuning: number[], a4: number) => PerformanceEvent[];
}

/** 再現性のある微小な揺らぎ（毎回同じ演奏になるよう固定シード） */
function humanizer(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const NOTE_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "E1" "A#1" "Gb2" → MIDIノート */
function parseNote(text: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(text.trim());
  if (!m) return null;
  const base = NOTE_OFFSET[m[1]];
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return base + accidental + (Number(m[3]) + 1) * 12;
}

const TECH_CODES: Record<string, Technique> = {
  f: 'finger',
  p: 'pick',
  s: 'slap',
  o: 'pop',
  m: 'mute',
  g: 'ghost',
  h: 'harmonic',
  n: 'hammer',
};

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

  /** スライド（前の音から滑らせる） */
  slideTo(time: number, midi: number, duration: number) {
    const pos = findPosition(midi, this.tuning, this.hand);
    if (!pos) return this;
    this.events.push({
      time,
      type: 'slide',
      str: pos.str,
      fret: pos.fret,
      note: midi,
      freq: noteFrequency(midi, this.a4),
      glide: Math.min(0.18, duration * 0.6),
    });
    this.sounding.set(pos.str, time + duration);
    this.events.push({ time: time + duration, type: 'mute', str: pos.str, amount: 1 });
    return this;
  }

  /**
   * 譜面文字列を並べる。
   *   "E1:1 G1:0.5 r:0.5 E2:1/o"
   *     音名:長さ（unit の倍数）  末尾 "!"=強め "~"=弱め "/x"=奏法
   * 返り値は次の音が始まる時刻。
   */
  seq(start: number, spec: string, unit: number, vel = 0.7, gate = 0.92): number {
    let time = start;
    for (const token of spec.trim().split(/\s+/)) {
      if (!token) continue;
      const [head, techCode] = token.split('/');
      let body = head;
      let accent = 1;
      while (body.endsWith('!') || body.endsWith('~')) {
        accent *= body.endsWith('!') ? 1.28 : 0.68;
        body = body.slice(0, -1);
      }
      const [nameRaw, lenRaw] = body.split(':');
      const len = (lenRaw ? Number(lenRaw) : 1) * unit;
      const name = nameRaw.trim();
      if (name === 'r' || name === 'R') {
        time += len;
        continue;
      }
      const midi = parseNote(name);
      if (midi === null) {
        time += len;
        continue;
      }
      const tech = techCode ? TECH_CODES[techCode] : undefined;
      // ゴーストノートは音程を持たないので短く切る
      const hold = tech === 'ghost' ? Math.min(len * 0.5, 0.12) : len * gate;
      this.note(time, midi, hold, Math.min(1, vel * accent), tech);
      time += len;
    }
    return time;
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

/** "Am7" "Bb7" "E7alt" "Ebm6" → { letter, accidental, quality } */
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
  return ctx.time;
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

/** 曲の最後：5度でちょっと寄りかかってからルート→オクターブ上へ伸ばして締める、2小節のタグ */
function tagEnding(
  t: Take,
  bars: string[][],
  beatsPerBar: number,
  u: number,
  center: number,
  time: number,
  prevMidi: number
): number {
  const lastChord = bars[bars.length - 1];
  const sym = lastChord[lastChord.length - 1];
  const pcs = chordPcs(sym);
  const root = pickTone(pcs.root, prevMidi, center, 9);
  const five = pickTone(pcs.fifth, root, center, 9);
  t.note(time, five, u * beatsPerBar * 0.35, 0.68);
  time += u * beatsPerBar * 0.4;
  t.note(time, root, u * beatsPerBar * 0.5, 0.82);
  time += u * beatsPerBar * 0.6;
  t.note(time, root + 12, u * beatsPerBar * 1.7, 0.78);
  time += u * beatsPerBar;
  return time;
}

type TenmonKind = 'walk' | 'ballad' | 'bossa' | 'latin';

/**
 * 「天問」10曲共通のビルダー。
 *   totalChoruses = ヘッド2回 + ソロ何周か + 最後のヘッド1回（内訳は各曲のコメント参照）
 *   ヘッド（role='head'）は控えめに、ソロ（role='solo'）は型のバリエーションと
 *   音量を増やして「盛り上がり」を作り、最後のヘッド（role='headOut'）で落ち着く。
 *   末尾に2小節のエンディング・タグを付ける。
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
): PerformanceEvent[] {
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
  time = tagEnding(t, bars, beatsPerBar, u, center, time, prevRef.midi);
  return t.finish(time + 0.7);
}

export const DEMOS: Demo[] = [
  {
    id: 'rock8',
    title: 'ロック 8ビート',
    style: 'ピック弾き',
    note: 'ルート主体の8分。まずはこれが弾ければバンドで通用します',
    presetId: 'pickrock',
    bpm: 132,
    rhythmId: 'rock8',
    build: (tuning, a4) => {
      const u = beat(132) / 2; // 8分
      const t = new Take(tuning, a4, 11, 'pick').position(2);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'E1! E1 E1 E1 E1! E1 E1 E1', u, 0.78);
        time = t.seq(time, 'G1! G1 G1 G1 G1! G1 G1 G1', u, 0.78);
        time = t.seq(time, 'A1! A1 A1 A1 A1! A1 A1 A1', u, 0.78);
        time = t.seq(time, 'D2! D2 D2 D2 C2! C2 B1 B1', u, 0.78);
      }
      return t.finish(time + 0.4);
    },
  },
  {
    id: 'motown',
    title: 'モータウン風',
    style: '指弾き',
    note: '歌の隙間を埋めるように動く、ソウル／R&B の定番ライン',
    presetId: 'vintage',
    bpm: 116,
    rhythmId: 'rock8',
    build: (tuning, a4) => {
      const u = beat(116) / 2;
      const t = new Take(tuning, a4, 23, 'finger').position(3);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'C2! r:0.5 C2~ E2 G2 r:0.5 A2 G2', u, 0.72);
        time = t.seq(time, 'F1! r:0.5 F1~ A1 C2 r:0.5 D2 C2', u, 0.72);
        time = t.seq(time, 'G1! r:0.5 G1~ B1 D2 r:0.5 E2 D2', u, 0.72);
        time = t.seq(time, 'C2! r:0.5 C2~ E2 G2 A2 G2 E2', u, 0.72);
      }
      return t.finish(time + 0.5);
    },
  },
  {
    id: 'walking',
    title: 'ウォーキング・ジャズ',
    style: '4ビート',
    note: 'II-V-I を歩き回る4分音符。ゴーストノートで推進力を出しています',
    presetId: 'jazz',
    bpm: 138,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      const u = beat(138);
      const t = new Take(tuning, a4, 37, 'finger').position(4);
      let time = 0;
      time = t.seq(time, 'D2! F2 A2 B2', u, 0.66, 0.6);
      time = t.seq(time, 'C2! E2 G2 A2', u, 0.66, 0.6);
      time = t.seq(time, 'F1! A1 C2 E2', u, 0.66, 0.6);
      time = t.seq(time, 'F1! G1 A1 B1', u, 0.66, 0.6);
      time = t.seq(time, 'E1! G1 B1 D2', u, 0.66, 0.6);
      time = t.seq(time, 'A1! C2 E2 G2', u, 0.66, 0.6);
      time = t.seq(time, 'D2! A1 F1 A1', u, 0.66, 0.6);
      time = t.seq(time, 'D1! r:0.5 D1/g A1 C2', u, 0.66, 0.6);
      return t.finish(time + 0.6);
    },
  },
  {
    id: 'slapfunk',
    title: 'スラップ・ファンク',
    style: 'サム＆プル',
    note: '親指（スラップ）と人差し指（プル）、そして休符が主役の16ビート',
    presetId: 'slapfunk',
    bpm: 104,
    rhythmId: 'funk',
    build: (tuning, a4) => {
      const u = beat(104) / 4; // 16分
      const t = new Take(tuning, a4, 51, 'slap').position(2);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'E1!:2/s E1:1/g E2:1/o r:1 E1:1/s E1:1/g G2:2/o', u, 0.86);
        time = t.seq(time, 'r:1 E1:1/g E1:2/s D2:2/o r:1 E1:1/g A1:2/s', u, 0.86);
        time = t.seq(time, 'G1!:2/s G1:1/g G2:1/o r:1 G1:1/s F1:1/g F2:2/o', u, 0.86);
        time = t.seq(time, 'A1!:2/s A1:1/g A2:2/o r:1 G1:1/s E1:2/s r:1', u, 0.86);
      }
      return t.finish(time + 0.5);
    },
  },
  {
    id: 'disco',
    title: 'ディスコ・オクターブ',
    style: '指弾き',
    note: 'ルートとオクターブ上を行き来する、踊れる8分のライン',
    presetId: 'modern',
    bpm: 122,
    rhythmId: 'rock16',
    build: (tuning, a4) => {
      const u = beat(122) / 2;
      const t = new Take(tuning, a4, 67, 'finger').position(5);
      let time = 0;
      const bar = (low: string, high: string) => {
        time = t.seq(time, `${low}! ${high} ${low} ${high} ${low}! ${high} ${low} ${high}`, u, 0.74, 0.55);
      };
      for (let rep = 0; rep < 2; rep++) {
        bar('A1', 'A2');
        bar('D2', 'D3');
        bar('F1', 'F2');
        bar('G1', 'G2');
      }
      return t.finish(time + 0.4);
    },
  },
  {
    id: 'reggae',
    title: 'レゲエ／ダブ',
    style: 'ミュート',
    note: '1拍目を抜いた、うねる低音。音の隙間そのものがグルーヴになります',
    presetId: 'dub',
    bpm: 76,
    rhythmId: 'halftime',
    build: (tuning, a4) => {
      const u = beat(76) / 4;
      const t = new Take(tuning, a4, 83, 'finger').position(3);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'r:2 A1!:2 C2:2 D2:4 r:2 A1:2 G1:2', u, 0.8, 0.8);
        time = t.seq(time, 'r:2 F1!:2 A1:2 C2:4 r:4 E1:2', u, 0.8, 0.8);
      }
      return t.finish(time + 0.8);
    },
  },
  {
    id: 'metal',
    title: 'メタル・ピック刻み',
    style: 'ピック弾き',
    note: '16分の高速ダウンピッキング。歪ませても輪郭が残ります',
    presetId: 'grind',
    bpm: 168,
    rhythmId: 'rock16',
    build: (tuning, a4) => {
      const u = beat(168) / 4;
      const t = new Take(tuning, a4, 97, 'pick').position(2);
      let time = 0;
      const drive = (n: string) => `${n}! ${n} ${n} ${n} ${n}! ${n} ${n} ${n} ${n}! ${n} ${n} ${n} ${n}! ${n} ${n} ${n}`;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, drive('E1'), u, 0.85, 0.5);
        time = t.seq(time, drive('G1'), u, 0.85, 0.5);
        time = t.seq(time, drive('F1'), u, 0.85, 0.5);
        time = t.seq(time, 'D2!:2 D2:2 C2:2 C2:2 B1!:2 B1:2 A1:4', u, 0.9, 0.5);
      }
      return t.finish(time + 0.4);
    },
  },
  {
    id: 'blues',
    title: 'ブルース・シャッフル',
    style: '指弾き',
    note: '12小節のブルース進行を、はねたリズムで',
    presetId: 'vintage',
    bpm: 92,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      const u = beat(92) / 2;
      const t = new Take(tuning, a4, 113, 'finger').position(3);
      let time = 0;
      const shuffle = (root: string, third: string, fifth: string, sixth: string) => {
        time = t.seq(time, `${root}! ${fifth} ${sixth} ${fifth} ${root}! ${fifth} ${sixth} ${fifth}`, u, 0.72, 0.62);
      };
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('D2', 'A2', 'B2', 'A2');
      shuffle('D2', 'A2', 'B2', 'A2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('E2', 'B2', 'C#3', 'B2');
      shuffle('D2', 'A2', 'B2', 'A2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      time = t.seq(time, 'E1! G1 A1 A#1 B1! r:1 E1:2', u, 0.78, 0.62);
      return t.finish(time + 0.6);
    },
  },
  {
    id: 'ballad',
    title: 'フレットレス・バラード',
    style: 'フレットレス',
    note: 'スライドで音程を繋ぐ、歌うようなライン',
    presetId: 'fretless',
    bpm: 68,
    rhythmId: 'click',
    build: (tuning, a4) => {
      const u = beat(68);
      const t = new Take(tuning, a4, 131, 'finger').position(5);
      let time = 0;
      t.note(time, 45, u * 1.6, 0.6);          // A2
      t.slideTo(time + u * 0.6, 47, u * 1.2);  // → B2
      time += u * 2;
      time = t.seq(time, 'E2:2 G2:1 A2:1', u, 0.6, 0.9);
      t.note(time, 41, u * 1.8, 0.62);         // F2
      t.slideTo(time + u * 0.9, 40, u * 1.1);  // → E2
      time += u * 2;
      time = t.seq(time, 'D2:2 C2:1 D2:1', u, 0.6, 0.9);
      time = t.seq(time, 'A1:2 E2:1 G2:1 A2:4', u, 0.62, 0.95);
      return t.finish(time + 1.2);
    },
  },
  {
    id: 'bossa',
    title: 'ボサノバ',
    style: '指弾き',
    note: 'ルートと5度だけで作る、ゆったりしたラテンの土台',
    presetId: 'jazz',
    bpm: 128,
    rhythmId: 'latin',
    build: (tuning, a4) => {
      const u = beat(128) / 2;
      const t = new Take(tuning, a4, 149, 'finger').position(3);
      let time = 0;
      const bar = (root: string, fifth: string) => {
        time = t.seq(time, `${root}!:3 ${fifth}:1 ${root}:2 ${fifth}:2`, u, 0.66, 0.75);
      };
      for (let rep = 0; rep < 2; rep++) {
        bar('D2', 'A1');
        bar('G1', 'D2');
        bar('C2', 'G1');
        bar('F1', 'C2');
      }
      return t.finish(time + 0.8);
    },
  },

  // -------------------------------------------------------------------------
  // アルバム「天問」(Tenmon) 全10曲。すべて buildTenmonTrack() でウォーキング
  // ベースラインを自動生成する。各曲のコード進行はアルバム仕様書のとおり。
  // -------------------------------------------------------------------------
  {
    id: 'tenmon-01',
    title: '混沌の序章',
    style: '天問',
    note: 'Aマイナー・ドリアン、8小節のモーダル・ヴァンプをスウィングで歩く',
    presetId: 'jazz',
    bpm: 96,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      // Am7|Am7|Dm7|Dm7|Am7|Dm7|E7alt|Am7（8小節、4/4）
      // フックはA4〜F5あたりを漂う静かなモチーフなので、ベースは1〜2オクターブ
      // 下（A1中心）で支え、ヘッドとソロで音の運び方（variant）を変えて単調さを避ける。
      // 1コーラス = (4*60/96)*8 = 20秒。2ヘッド+5ソロ+1ヘッド=8コーラス=160秒
      // + タグ2小節 約5秒 ≈ 165秒（2:30〜3:30の範囲内）
      const bars: string[][] = [
        ['Am7'], ['Am7'], ['Dm7'], ['Dm7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'],
      ];
      return buildTenmonTrack(tuning, a4, 173, 96, 4, bars, 33, 3, 8, 'walk');
    },
  },
  {
    id: 'tenmon-02',
    title: '誰が空を創ったのか',
    style: '天問',
    note: 'Bbのミディアム・スウィング12小節ブルース。定番のI-IV-I-V進行を歩く',
    presetId: 'jazz',
    bpm: 144,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      // Bb7|Eb7|Bb7|Bb7|Eb7|Edim7|Bb7|G7|Cm7|F7|Bb7 G7|Cm7 F7（12小節、4/4）
      // フックはBb4〜F5の力強い上行下降なので、レジスターはBb1中心。
      // 1コーラス = (4*60/144)*12 ≈ 20秒。2ヘッド+5ソロ+1ヘッド=8コーラス=160秒
      // + タグ2小節 約3.3秒 ≈ 163秒
      const bars: string[][] = [
        ['Bb7'], ['Eb7'], ['Bb7'], ['Bb7'], ['Eb7'], ['Edim7'], ['Bb7'], ['G7'],
        ['Cm7'], ['F7'], ['Bb7', 'G7'], ['Cm7', 'F7'],
      ];
      return buildTenmonTrack(tuning, a4, 191, 144, 4, bars, 34, 3, 8, 'walk');
    },
  },
  {
    id: 'tenmon-03',
    title: '星の回廊',
    style: '天問',
    note: 'Dマイナーのジャズ・ワルツ。3拍子を4分音符で歩き回る',
    presetId: 'jazz',
    bpm: 168,
    rhythmId: 'click',
    build: (tuning, a4) => {
      // Dm7|Gm7|C7|Fmaj7|Bbmaj7|E7alt|Am7|D7|Gm7|C7|Dm7|Dm7（12小節、3/4）
      // フックの跳ねる上行形をイメージし、レジスターはD2中心。3拍子の
      // 内蔵パターンが無いため rhythmId は click（メトロノーム）を使用。
      // 1コーラス = (3*60/168)*12 ≈ 12.86秒。2ヘッド+10ソロ+1ヘッド=13コーラス
      // ≈ 167秒 + タグ2小節 約2.1秒 ≈ 169秒
      const bars: string[][] = [
        ['Dm7'], ['Gm7'], ['C7'], ['Fmaj7'], ['Bbmaj7'], ['E7alt'],
        ['Am7'], ['D7'], ['Gm7'], ['C7'], ['Dm7'], ['Dm7'],
      ];
      return buildTenmonTrack(tuning, a4, 211, 168, 3, bars, 38, 4, 13, 'walk');
    },
  },
  {
    id: 'tenmon-04',
    title: '地の果てへ',
    style: '天問',
    note: 'Fのボサノバ。ルートと5度でシンコペーションする8小節',
    presetId: 'jazz',
    bpm: 132,
    rhythmId: 'latin',
    build: (tuning, a4) => {
      // Fmaj7|Em7b5 A7alt|Dm7|Gm7 C7|Fmaj7|Em7b5 A7alt|Dm7 G7|Cmaj7（8小節、4/4）
      // フックはC5〜A4のなだらかな旋律なので、ベースはF1〜C2の低い帯で
      // 支える。1コーラス = (4*60/132)*8 ≈ 14.55秒。2ヘッド+9ソロ+1ヘッド=12コーラス
      // ≈ 174.5秒 + タグ2小節 約3.6秒 ≈ 178秒
      const bars: string[][] = [
        ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7'], ['Gm7', 'C7'],
        ['Fmaj7'], ['Em7b5', 'A7alt'], ['Dm7', 'G7'], ['Cmaj7'],
      ];
      return buildTenmonTrack(tuning, a4, 229, 132, 4, bars, 36, 3, 12, 'bossa');
    },
  },
  {
    id: 'tenmon-05',
    title: '問いかける月',
    style: '天問',
    note: 'Ebのバラード。半音符でゆったり歌う、ルートと5度の土台',
    presetId: 'fretless',
    bpm: 63,
    rhythmId: 'click',
    build: (tuning, a4) => {
      // Ebmaj7|Cm7|Fm7|Bb7|Ebmaj7|Ab7|Gm7 C7|Fm7 Bb7（8小節、4/4）
      // フックはBb4〜Eb5と高めに漂うので、ベースはEb2中心の落ち着いた帯域。
      // 1コーラス = (4*60/63)*8 ≈ 30.48秒。2ヘッド+2ソロ+1ヘッド=5コーラス
      // ≈ 152.4秒 + タグ2小節 約7.6秒 ≈ 160秒
      const bars: string[][] = [
        ['Ebmaj7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ab7'], ['Gm7', 'C7'], ['Fm7', 'Bb7'],
      ];
      return buildTenmonTrack(tuning, a4, 251, 63, 4, bars, 41, 5, 5, 'ballad');
    },
  },
  {
    id: 'tenmon-06',
    title: '龍の眠り',
    style: '天問',
    note: 'Cマイナーのハードバップ。速い4ビートで16小節を駆け抜ける',
    presetId: 'jazz',
    bpm: 176,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      // Cm7|Cm7|Fm7|Bb7|Ebmaj7|Abmaj7|Dm7b5|G7alt|Cm7|Fm7 Bb7|Ebmaj7 Abmaj7|
      // Dm7b5 G7alt|Cm7|Ab7|G7|Cm7（16小節、4/4）
      // フックの跳躍が大きいアップテンポなので推進力重視、C2中心。
      // 1コーラス = (4*60/176)*16 ≈ 21.82秒。2ヘッド+5ソロ+1ヘッド=8コーラス
      // ≈ 174.5秒 + タグ2小節 約2.7秒 ≈ 177秒
      const bars: string[][] = [
        ['Cm7'], ['Cm7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Abmaj7'], ['Dm7b5'], ['G7alt'],
        ['Cm7'], ['Fm7', 'Bb7'], ['Ebmaj7', 'Abmaj7'], ['Dm7b5', 'G7alt'],
        ['Cm7'], ['Ab7'], ['G7'], ['Cm7'],
      ];
      return buildTenmonTrack(tuning, a4, 269, 176, 4, bars, 36, 3, 8, 'walk');
    },
  },
  {
    id: 'tenmon-07',
    title: '見えない橋',
    style: '天問',
    note: 'Aマイナーのアフロキューバン／ラテン・ジャズ。跳ねるシンコペーション',
    presetId: 'jazz',
    bpm: 138,
    rhythmId: 'latin',
    build: (tuning, a4) => {
      // Am7|Am7|Dm7|E7alt|Am7|Dm7|E7alt|Am7（8小節、4/4）
      // フックはE5〜A5の高い跳躍で始まるので、ベースはA1中心で土台を作る。
      // ボサノバ（4曲目）とは違い、1拍目を溜めて2拍目裏でルートを先取りする
      // トゥンバオ的シンコペーション（'latin'）でアフロキューバンの跳ねを出す。
      // 1コーラス = (4*60/138)*8 ≈ 13.91秒。2ヘッド+10ソロ+1ヘッド=13コーラス
      // ≈ 180.9秒 + タグ2小節 約3.5秒 ≈ 184秒
      const bars: string[][] = [
        ['Am7'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'], ['Dm7'], ['E7alt'], ['Am7'],
      ];
      return buildTenmonTrack(tuning, a4, 283, 138, 4, bars, 33, 3, 13, 'latin');
    },
  },
  {
    id: 'tenmon-08',
    title: '光と影のあいだ',
    style: '天問',
    note: 'Dドリアンの2コード・モーダル・ヴァンプ。"So What"系のサウンド',
    presetId: 'jazz',
    bpm: 120,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      // Dm7|Dm7|Dm7|Dm7|Ebmaj7|Ebmaj7|Dm7|Dm7（8小節ヴァンプ、4/4）
      // フックはD5からの跳躍を含むモーダルな形。ベースはD2中心。
      // 1コーラス = (4*60/120)*8 = 16秒。2ヘッド+8ソロ+1ヘッド=11コーラス
      // = 176秒 + タグ2小節 4秒 = 180秒
      const bars: string[][] = [
        ['Dm7'], ['Dm7'], ['Dm7'], ['Dm7'], ['Ebmaj7'], ['Ebmaj7'], ['Dm7'], ['Dm7'],
      ];
      return buildTenmonTrack(tuning, a4, 307, 120, 4, bars, 38, 4, 11, 'walk');
    },
  },
  {
    id: 'tenmon-09',
    title: '天の川を渡る',
    style: '天問',
    note: 'Bbのアップテンポ・スウィング。リズムチェンジ系「A」セクションを疾走',
    presetId: 'jazz',
    bpm: 200,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      // Bbmaj7|Gm7|Cm7|F7|Fm7|Bb7|Ebmaj7|Ebm6（8小節、4/4）
      // フックはF5〜Bb5の速い上行から始まるアップテンポの主題。ベースはBb1中心。
      // 1コーラス = (4*60/200)*8 = 9.6秒。2ヘッド+15ソロ+1ヘッド=18コーラス
      // = 172.8秒 + タグ2小節 2.4秒 = 175.2秒
      const bars: string[][] = [
        ['Bbmaj7'], ['Gm7'], ['Cm7'], ['F7'], ['Fm7'], ['Bb7'], ['Ebmaj7'], ['Ebm6'],
      ];
      return buildTenmonTrack(tuning, a4, 331, 200, 4, bars, 34, 3, 18, 'walk');
    },
  },
  {
    id: 'tenmon-10',
    title: '終わりなき問い',
    style: '天問',
    note: 'Gのバラード。アルバムの終曲、半音符で静かに歩く8小節',
    presetId: 'fretless',
    bpm: 58,
    rhythmId: 'click',
    build: (tuning, a4) => {
      // Gmaj7|Em7|Am7|D7|Gmaj7|Cmaj7|Am7 D7|Gmaj7（8小節、4/4）
      // フックはG5まで駆け上がって終わる終曲らしい形。ベースはG2中心で
      // 静かに支える。1コーラス = (4*60/58)*8 ≈ 33.1秒。2ヘッド+2ソロ+1ヘッド=5コーラス
      // ≈ 165.5秒 + タグ2小節 約8.3秒 ≈ 174秒
      const bars: string[][] = [
        ['Gmaj7'], ['Em7'], ['Am7'], ['D7'], ['Gmaj7'], ['Cmaj7'], ['Am7', 'D7'], ['Gmaj7'],
      ];
      return buildTenmonTrack(tuning, a4, 349, 58, 4, bars, 43, 5, 5, 'ballad');
    },
  },
];
