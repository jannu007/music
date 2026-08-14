import { NOTE_NAMES, type Tuning } from './tunings';

/** コードの種類（構成音は根音からの半音数） */
export interface ChordQuality {
  id: string;
  /** コードネームに付く記号 */
  suffix: string;
  name: string;
  intervals: number[];
  /** 省略してよい構成音（半音数）。押さえきれない時に落とす */
  optional: number[];
}

export const QUALITIES: ChordQuality[] = [
  { id: 'maj', suffix: '', name: 'メジャー', intervals: [0, 4, 7], optional: [] },
  { id: 'min', suffix: 'm', name: 'マイナー', intervals: [0, 3, 7], optional: [] },
  { id: 'dom7', suffix: '7', name: 'セブンス', intervals: [0, 4, 7, 10], optional: [7] },
  { id: 'min7', suffix: 'm7', name: 'マイナーセブンス', intervals: [0, 3, 7, 10], optional: [7] },
  { id: 'maj7', suffix: 'M7', name: 'メジャーセブンス', intervals: [0, 4, 7, 11], optional: [7] },
  { id: 'min6', suffix: 'm6', name: 'マイナーシックス', intervals: [0, 3, 7, 9], optional: [7] },
  { id: 'maj6', suffix: '6', name: 'シックス', intervals: [0, 4, 7, 9], optional: [7] },
  { id: 'sus4', suffix: 'sus4', name: 'サスフォー', intervals: [0, 5, 7], optional: [] },
  { id: 'sus2', suffix: 'sus2', name: 'サスツー', intervals: [0, 2, 7], optional: [] },
  { id: '7sus4', suffix: '7sus4', name: 'セブンスサスフォー', intervals: [0, 5, 7, 10], optional: [7] },
  { id: 'add9', suffix: 'add9', name: 'アドナイン', intervals: [0, 2, 4, 7], optional: [7] },
  { id: 'dom9', suffix: '9', name: 'ナインス', intervals: [0, 2, 4, 7, 10], optional: [7, 0] },
  { id: 'min9', suffix: 'm9', name: 'マイナーナインス', intervals: [0, 2, 3, 7, 10], optional: [7, 0] },
  { id: 'maj9', suffix: 'M9', name: 'メジャーナインス', intervals: [0, 2, 4, 7, 11], optional: [7, 0] },
  { id: 'min7b5', suffix: 'm7♭5', name: 'ハーフディミニッシュ', intervals: [0, 3, 6, 10], optional: [] },
  { id: 'dim7', suffix: 'dim7', name: 'ディミニッシュセブンス', intervals: [0, 3, 6, 9], optional: [] },
  { id: 'aug', suffix: 'aug', name: 'オーギュメント', intervals: [0, 4, 8], optional: [] },
  { id: 'dom7b9', suffix: '7♭9', name: 'セブンスフラットナイン', intervals: [0, 1, 4, 7, 10], optional: [7, 0] },
  { id: 'dom7s9', suffix: '7♯9', name: 'セブンスシャープナイン', intervals: [0, 3, 4, 7, 10], optional: [7, 0] },
  { id: 'power', suffix: '5', name: 'パワーコード', intervals: [0, 7], optional: [] },
];

export function findQuality(id: string): ChordQuality {
  return QUALITIES.find((q) => q.id === id) ?? QUALITIES[0];
}

export interface Chord {
  /** 根音のピッチクラス 0=C */
  root: number;
  quality: ChordQuality;
}

export function chordName(chord: Chord): string {
  return NOTE_NAMES[chord.root] + chord.quality.suffix;
}

/**
 * 押さえ方。要素は弦ごとのフレット（0=開放、-1=ミュート）。
 * 配列の並びは Tuning.notes と同じ（低音弦から）。
 */
export interface Voicing {
  frets: number[];
  /** 最低フレット（0 は開放のみ） */
  position: number;
  /** セーハするフレット（無い場合は 0） */
  barre: number;
  score: number;
}

interface Candidate {
  fret: number;
  /** 根音からの半音差 */
  degree: number;
}

const MAX_FRET = 15;
const SPAN = 4;

/** 弦・フレットの実音のピッチクラス */
function pitchClass(tuning: Tuning, string: number, fret: number): number {
  return (((tuning.notes[string] + fret) % 12) + 12) % 12;
}

/**
 * 指定のコードを、そのチューニングで実際に押さえられる形に落とし込む。
 * 開放弦の活用・ルートの最低音・押さえやすさを点数化して最良の形を返す。
 * 形をハードコードしないので、変則チューニングやカポでも破綻しない。
 */
export function voiceChord(
  tuning: Tuning,
  chord: Chord,
  options: { minFret?: number; maxFret?: number; preferOpen?: boolean } = {}
): Voicing {
  const stringCount = tuning.notes.length;
  const minFret = options.minFret ?? 0;
  const maxFret = Math.min(MAX_FRET, options.maxFret ?? 12);
  const preferOpen = options.preferOpen ?? true;

  const degrees = chord.quality.intervals;
  const required = degrees.filter((d) => !chord.quality.optional.includes(d));
  const degreeOf = new Map<number, number>();
  for (const d of degrees) degreeOf.set((chord.root + d) % 12, d);

  // 入れ子関数から書き換えるため、オブジェクトに包んで保持する
  const state: { best: Voicing | null } = { best: null };

  for (let base = minFret; base <= maxFret; base++) {
    // 各弦の候補フレット（コード構成音のみ）
    const perString: Candidate[][] = [];
    for (let s = 0; s < stringCount; s++) {
      const list: Candidate[] = [];
      const lo = base === 0 ? 0 : base;
      const hi = base === 0 ? SPAN - 1 : base + SPAN - 1;
      for (let f = lo; f <= hi; f++) {
        const deg = degreeOf.get(pitchClass(tuning, s, f));
        if (deg !== undefined) list.push({ fret: f, degree: deg });
      }
      if (base > 0) {
        const deg = degreeOf.get(pitchClass(tuning, s, 0));
        if (deg !== undefined) list.push({ fret: 0, degree: deg });
      }
      // ミュート
      list.push({ fret: -1, degree: -1 });
      perString.push(list);
    }

    // 全組み合わせを走査（1弦あたり最大6候補・6弦なので現実的な計算量）
    const frets = new Array<number>(stringCount).fill(-1);
    const deg = new Array<number>(stringCount).fill(-1);

    const walk = (s: number) => {
      if (s === stringCount) {
        const v = evaluate(tuning, frets, deg, required, base, preferOpen);
        if (v && (!state.best || v.score > state.best.score)) state.best = v;
        return;
      }
      for (const cand of perString[s]) {
        frets[s] = cand.fret;
        deg[s] = cand.degree;
        walk(s + 1);
      }
    };
    walk(0);
  }

  if (state.best) return state.best;

  // どうしても押さえられない場合はルートのみのフォールバック
  const frets = new Array<number>(stringCount).fill(-1);
  for (let s = 0; s < stringCount; s++) {
    for (let f = 0; f <= 12; f++) {
      if (pitchClass(tuning, s, f) === chord.root) {
        frets[s] = f;
        break;
      }
    }
    if (frets[s] >= 0) break;
  }
  return { frets, position: 0, barre: 0, score: 0 };
}

function evaluate(
  tuning: Tuning,
  frets: number[],
  degrees: number[],
  required: number[],
  base: number,
  preferOpen: boolean
): Voicing | null {
  const stringCount = frets.length;
  let sounded = 0;
  let lowest = -1;
  let lowestNote = Infinity;
  let highFret = 0;
  let lowFret = 99;
  let openCount = 0;
  const present = new Set<number>();

  for (let s = 0; s < stringCount; s++) {
    const f = frets[s];
    if (f < 0) continue;
    sounded++;
    present.add(degrees[s]);
    const note = tuning.notes[s] + f;
    if (note < lowestNote) {
      lowestNote = note;
      lowest = degrees[s];
    }
    if (f === 0) openCount++;
    else {
      if (f > highFret) highFret = f;
      if (f < lowFret) lowFret = f;
    }
  }

  const minSound = Math.min(4, stringCount);
  if (sounded < minSound) return null;
  for (const d of required) if (!present.has(d)) return null;

  // 内側のミュート（鳴らす弦に挟まれた消音）は弾きにくいので弾く
  let first = -1;
  let last = -1;
  for (let s = 0; s < stringCount; s++) {
    if (frets[s] >= 0) {
      if (first < 0) first = s;
      last = s;
    }
  }
  let innerMutes = 0;
  for (let s = first; s <= last; s++) if (frets[s] < 0) innerMutes++;
  if (innerMutes > 1) return null;

  const span = lowFret === 99 ? 0 : highFret - lowFret;
  if (span >= 5) return null;

  // 運指：最低フレットをセーハで押さえられるか
  const fretted = frets.filter((f) => f > 0);
  const atLow = fretted.filter((f) => f === lowFret).length;
  const needBarre = fretted.length > 4 || (fretted.length - atLow >= 4 && atLow >= 2);
  let barre = 0;
  if (atLow >= 2 && (needBarre || atLow >= 3)) {
    // セーハは最低音側から連続していないと成立しない
    const idx = frets.map((f, s) => (f === lowFret ? s : -1)).filter((s) => s >= 0);
    if (idx.length >= 2) barre = lowFret;
  }
  const fingers = barre > 0 ? fretted.length - atLow + 1 : fretted.length;
  if (fingers > 4) return null;

  let score = 100;
  score += sounded * 8;
  score += present.size * 6;
  score -= innerMutes * 25;
  score -= span * 7;
  score -= fingers * 5;
  score -= Math.max(0, lowFret === 99 ? 0 : lowFret) * 1.6;
  if (preferOpen) score += openCount * 4;
  if (base === 0) score += 8;
  // 最低音がルートだと安定して聞こえる
  if (lowest === 0) score += 26;
  else if (lowest === 7) score += 8;
  else score -= 6;
  // 5弦・6弦のどちらかは鳴らしたい（低音の厚み）
  if (frets[0] < 0 && frets[1] < 0) score -= 10;
  if (barre > 0) score -= 4;

  return { frets: [...frets], position: lowFret === 99 ? 0 : lowFret, barre, score };
}

const voicingCache = new Map<string, Voicing>();

/** よく使うコードは結果を再利用する（探索は毎回やると重いため） */
export function cachedVoicing(
  tuning: Tuning,
  chord: Chord,
  minFret = 0
): Voicing {
  const key = `${tuning.id}|${chord.root}|${chord.quality.id}|${minFret}`;
  let v = voicingCache.get(key);
  if (!v) {
    v = voiceChord(tuning, chord, { minFret });
    voicingCache.set(key, v);
  }
  return v;
}

/** 押さえている音（低音弦から順）を返す */
export function voicingNotes(tuning: Tuning, voicing: Voicing, capo = 0): number[] {
  const out: number[] = [];
  for (let s = 0; s < voicing.frets.length; s++) {
    const f = voicing.frets[s];
    if (f < 0) continue;
    out.push(tuning.notes[s] + f + capo);
  }
  return out;
}

/** コード進行の文字列（例: "Am7"）を解析する */
export function parseChord(text: string): Chord | null {
  const m = /^([A-G])([#♯b♭]?)(.*)$/.exec(text.trim());
  if (!m) return null;
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let root = letters[m[1]];
  if (m[2] === '#' || m[2] === '♯') root = (root + 1) % 12;
  if (m[2] === 'b' || m[2] === '♭') root = (root + 11) % 12;
  const suffix = m[3]
    .replace('♭', 'b')
    .replace('♯', '#')
    .replace('maj', 'M')
    .trim();
  const table: Record<string, string> = {
    '': 'maj', m: 'min', min: 'min', '7': 'dom7', m7: 'min7', min7: 'min7',
    M7: 'maj7', '6': 'maj6', m6: 'min6', sus4: 'sus4', sus2: 'sus2',
    '7sus4': '7sus4', add9: 'add9', '9': 'dom9', m9: 'min9', M9: 'maj9',
    m7b5: 'min7b5', dim: 'dim7', dim7: 'dim7', aug: 'aug', '7b9': 'dom7b9',
    '7#9': 'dom7s9', '5': 'power',
  };
  const qid = table[suffix];
  if (!qid) return null;
  return { root, quality: findQuality(qid) };
}
