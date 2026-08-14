const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export interface Tuning {
  id: string;
  name: string;
  /** 低い弦から順の開放音（MIDIノート） */
  notes: number[];
  hint: string;
}

/** 実機で一般的なチューニング。低い弦が先頭。 */
export const TUNINGS: Tuning[] = [
  { id: 'standard4', name: '4弦 レギュラー', notes: [28, 33, 38, 43], hint: 'E1 A1 D2 G2 ・ 最も標準的' },
  { id: 'dropd4', name: '4弦 ドロップD', notes: [26, 33, 38, 43], hint: 'D1 A1 D2 G2 ・ ロック／メタル' },
  { id: 'halfdown4', name: '4弦 半音下げ', notes: [27, 32, 37, 42], hint: 'E♭1 A♭1 D♭2 G♭2' },
  { id: 'wholedown4', name: '4弦 1音下げ', notes: [26, 31, 36, 41], hint: 'D1 G1 C2 F2 ・ 重心の低いサウンド' },
  { id: 'standard5', name: '5弦 (低B)', notes: [23, 28, 33, 38, 43], hint: 'B0 E1 A1 D2 G2 ・ 低音の拡張' },
  { id: 'high5', name: '5弦 (高C)', notes: [28, 33, 38, 43, 48], hint: 'E1 A1 D2 G2 C3 ・ ソロ向き' },
  { id: 'standard6', name: '6弦', notes: [23, 28, 33, 38, 43, 48], hint: 'B0 E1 A1 D2 G2 C3' },
];

export const MAX_FRET = 24;

export function findTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

export function noteName(note: number, flat = false): string {
  const names = flat ? NAMES_FLAT : NAMES;
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

export function pitchClass(note: number, flat = false): string {
  const names = flat ? NAMES_FLAT : NAMES;
  return names[((note % 12) + 12) % 12];
}

/** 基準ピッチを考慮した周波数 */
export function noteFrequency(note: number, a4 = 440): number {
  return a4 * Math.pow(2, (note - 69) / 12);
}

/** 自然ハーモニクスが出るフレットと、その倍率 */
export const HARMONIC_FRETS: { fret: number; ratio: number; label: string }[] = [
  { fret: 12, ratio: 2, label: '8度' },
  { fret: 7, ratio: 3, label: '12度' },
  { fret: 5, ratio: 4, label: '15度' },
  { fret: 19, ratio: 3, label: '12度' },
];

export function harmonicRatio(fret: number): number | null {
  const hit = HARMONIC_FRETS.find((h) => h.fret === fret);
  return hit ? hit.ratio : null;
}

export interface Position {
  str: number;
  fret: number;
}

/**
 * MIDIノートを押さえる弦とフレットに変換する。
 * 実際のベーシストと同じように、
 *   1. いま手がある位置（preferredFret）の近くを優先
 *   2. 同じ音なら低い弦（太い弦）の方が太い音になるので、極端な高フレットは避ける
 * という基準で選ぶ。開放弦で弾ける場合はそれを優先する。
 */
export function findPosition(
  note: number,
  tuning: number[],
  preferredFret = 4,
  maxFret = MAX_FRET
): Position | null {
  let best: Position | null = null;
  let bestScore = Infinity;

  for (let str = tuning.length - 1; str >= 0; str--) {
    const fret = note - tuning[str];
    if (fret < 0 || fret > maxFret) continue;
    // 手の移動距離が近いほど、また低いポジションほど自然
    let score = Math.abs(fret - preferredFret) * 1.0 + fret * 0.22;
    if (fret === 0) score -= 2.2;             // 開放弦は鳴らしやすい
    if (fret > 0 && fret < 2) score += 0.6;   // 1フレットは押さえにくい
    if (score < bestScore) {
      bestScore = score;
      best = { str, fret };
    }
  }
  return best;
}

/** 弦とフレットから鳴る音（ハーモニクスにも対応） */
export function positionFrequency(
  tuning: number[],
  str: number,
  fret: number,
  a4: number,
  harmonic = false
): number {
  const open = tuning[Math.max(0, Math.min(tuning.length - 1, str))];
  const base = noteFrequency(open + fret, a4);
  if (!harmonic) return base;
  const ratio = harmonicRatio(fret);
  if (!ratio) return base;
  // ハーモニクスは押さえた音ではなく、開放弦の整数倍で鳴る
  return noteFrequency(open, a4) * ratio;
}

/** 弦とフレットに対応する MIDI ノート（記録・MIDI書き出し用） */
export function positionNote(tuning: number[], str: number, fret: number, harmonic = false): number {
  const open = tuning[Math.max(0, Math.min(tuning.length - 1, str))];
  if (harmonic) {
    const ratio = harmonicRatio(fret);
    if (ratio) return Math.round(open + 12 * Math.log2(ratio));
  }
  return open + fret;
}
