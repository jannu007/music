import type { Tuning } from './tunings';

export interface Fretting {
  string: number;
  fret: number;
}

/**
 * 音名（MIDIノート）を、どの弦の何フレットで鳴らすか決める。
 * 実際のギターと同じく1弦につき1音しか出せないので、
 * すでに鳴っている弦を避けながら、押さえやすい位置を選ぶ。
 */
export function findFretting(
  tuning: Tuning,
  note: number,
  capo: number,
  busy: boolean[] = [],
  maxFret = 22
): Fretting | null {
  const candidates: Fretting[] = [];
  for (let s = 0; s < tuning.notes.length; s++) {
    const fret = note - tuning.notes[s] - capo;
    if (fret < 0 || fret > maxFret) continue;
    candidates.push({ string: s, fret });
  }
  if (candidates.length === 0) return null;

  // フレットが小さいほど押さえやすい。同じなら高音弦（細い弦）を優先。
  candidates.sort((a, b) => a.fret - b.fret || b.string - a.string);
  const free = candidates.find((c) => !busy[c.string]);
  return free ?? candidates[0];
}

/** 押さえられる最低音・最高音 */
export function noteRange(tuning: Tuning, capo: number, maxFret = 22): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const open of tuning.notes) {
    low = Math.min(low, open + capo);
    high = Math.max(high, open + capo + maxFret);
  }
  return [low, high];
}

/**
 * ストロークの並び。
 * ダウンは低音弦→高音弦、アップは逆。ミュートされた弦（-1）は飛ばす。
 */
export function strumOrder(
  frets: number[],
  dir: 'down' | 'up',
  low = 0,
  high = Number.MAX_SAFE_INTEGER
): number[] {
  const order: number[] = [];
  for (let s = 0; s < frets.length; s++) {
    if (s < low || s > high) continue;
    order.push(s);
  }
  if (dir === 'up') order.reverse();
  return order;
}

/** 鳴っている弦（低音側から数えた順）のうち、slot 番目の弦を返す */
export function slotToString(frets: number[], slot: number): number {
  const sounding: number[] = [];
  for (let s = 0; s < frets.length; s++) if (frets[s] >= 0) sounding.push(s);
  if (sounding.length === 0) return -1;
  const idx = slot >= 0
    ? Math.min(slot, sounding.length - 1)
    : Math.max(0, sounding.length + slot);
  return sounding[idx];
}
