/** 弦のチューニング定義（弦0 = 最低音弦 / 最後の要素 = 1弦） */
export interface Tuning {
  id: string;
  name: string;
  /** 開放弦のMIDIノート番号（低音弦から順） */
  notes: number[];
  /** 弦の種類（音色に反映）: 巻線かどうかの境目 */
  wound: number;
  hint: string;
}

export const TUNINGS: Tuning[] = [
  {
    id: 'standard',
    name: 'スタンダード (EADGBE)',
    notes: [40, 45, 50, 55, 59, 64],
    wound: 3,
    hint: '一般的な6弦ギターの調弦。',
  },
  {
    id: 'dropd',
    name: 'ドロップD (DADGBE)',
    notes: [38, 45, 50, 55, 59, 64],
    wound: 3,
    hint: '6弦を1音下げ。パワーコードを1本指で押さえられる。',
  },
  {
    id: 'halfdown',
    name: '半音下げ (E♭A♭D♭G♭B♭E♭)',
    notes: [39, 44, 49, 54, 58, 63],
    wound: 3,
    hint: '全弦を半音下げ。太くルーズな響き。',
  },
  {
    id: 'wholedown',
    name: '1音下げ (DGCFAD)',
    notes: [38, 43, 48, 53, 57, 62],
    wound: 3,
    hint: '全弦を1音下げ。ヘヴィなリフ向け。',
  },
  {
    id: 'dropc',
    name: 'ドロップC (CGCFAD)',
    notes: [36, 43, 48, 53, 57, 62],
    wound: 3,
    hint: '低く重いリフに。ラウド系で定番。',
  },
  {
    id: 'dadgad',
    name: 'DADGAD',
    notes: [38, 45, 50, 55, 57, 62],
    wound: 3,
    hint: 'ケルト/アコースティック系の変則調弦。浮遊感のある響き。',
  },
  {
    id: 'openg',
    name: 'オープンG (DGDGBD)',
    notes: [38, 43, 50, 55, 59, 62],
    wound: 3,
    hint: '開放でGメジャー。スライドやブルースに。',
  },
  {
    id: 'opend',
    name: 'オープンD (DADF♯AD)',
    notes: [38, 45, 50, 54, 57, 62],
    wound: 3,
    hint: '開放でDメジャー。ボトルネック向け。',
  },
  {
    id: 'opene',
    name: 'オープンE (EBEG♯BE)',
    notes: [40, 47, 52, 56, 59, 64],
    wound: 3,
    hint: '開放でEメジャー。荒々しいブルースに。',
  },
  {
    id: 'bass',
    name: 'ベース4弦 (EADG)',
    notes: [28, 33, 38, 43],
    wound: 4,
    hint: 'エレキベースの調弦。ベース音色と組み合わせて。',
  },
  {
    id: 'ukulele',
    name: 'ウクレレ (GCEA)',
    notes: [67, 60, 64, 69],
    wound: 0,
    hint: 'ハイG調弦のソプラノウクレレ。ナイロン音色で。',
  },
];

export function findTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function noteName(midi: number, withOctave = true): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

/** フレット位置から実音を求める（カポ分は押弦位置に加算済みとして扱う） */
export function fretNote(tuning: Tuning, string: number, fret: number): number {
  return tuning.notes[string] + fret;
}

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}
