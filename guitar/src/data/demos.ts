/**
 * デモ演奏。
 * 音符を1つずつ持たせるのではなく「コード進行 + リズムパターン」で持ち、
 * 再生時にアレンジャーが演奏イベントへ展開する。
 * データが小さく、チューニングやカポを変えても破綻しない。
 */
export interface Demo {
  id: string;
  title: string;
  description: string;
  /** 使用する音色プリセット */
  presetId: string;
  /** リズムパターン */
  patternId: string;
  bpm: number;
  /** 1小節1コード（コードネームで記述） */
  chords: string[];
  /** 繰り返し回数 */
  repeat: number;
  /** ハイポジションで弾かせたい場合 */
  minFret?: number;
  /** ブリッジミュート */
  palm?: number;
}

export const DEMOS: Demo[] = [
  {
    id: 'canon',
    title: 'カノン進行',
    description: '定番中の定番。フォークストロークで。',
    presetId: 'steel',
    patternId: 'folk',
    bpm: 96,
    chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'],
    repeat: 2,
  },
  {
    id: 'ballad',
    title: 'バラード・アルペジオ',
    description: '指弾きのアルペジオ。夜に似合う響き。',
    presetId: 'fingerpick',
    patternId: 'ballad',
    bpm: 76,
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm7', 'G7'],
    repeat: 2,
  },
  {
    id: 'komuro',
    title: '小室進行（16ビート）',
    description: 'Am-F-G-C。16分のカッティングで疾走感を出す。',
    presetId: 'funk',
    patternId: 'sixteen',
    bpm: 122,
    chords: ['Am', 'F', 'G', 'C'],
    repeat: 4,
  },
  {
    id: 'blues12',
    title: 'ブルース12小節',
    description: 'A7-D7-E7 のスリーコード。シャッフルで。',
    presetId: 'blues',
    patternId: 'shuffle',
    bpm: 104,
    chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'],
    repeat: 1,
  },
  {
    id: 'bossa',
    title: 'ボサノバ',
    description: 'ナイロン弦でシンコペーション。',
    presetId: 'nylon',
    patternId: 'bossa',
    bpm: 132,
    chords: ['Am7', 'D7', 'GM7', 'CM7', 'F#m7b5', 'B7', 'Em7', 'Em7'],
    repeat: 2,
  },
  {
    id: 'rock8',
    title: '8ビート・ロック',
    description: 'G-D-Em-C。ブリティッシュな歪みで。',
    presetId: 'british',
    patternId: 'eighth',
    bpm: 138,
    chords: ['G', 'D', 'Em', 'C'],
    repeat: 4,
  },
  {
    id: 'chug',
    title: 'パワーコード刻み',
    description: 'ブリッジミュートの効いたリフ。ハイゲインで。',
    presetId: 'metal',
    patternId: 'chug',
    bpm: 150,
    chords: ['E5', 'E5', 'G5', 'A5'],
    repeat: 4,
    palm: 0.72,
  },
  {
    id: 'country',
    title: 'カントリー（オルタネイトベース）',
    description: '低音を刻みながらコードを挟む定番の伴奏。',
    presetId: 'parlor',
    patternId: 'country',
    bpm: 112,
    chords: ['G', 'G', 'C', 'D', 'G', 'Em', 'C', 'D'],
    repeat: 2,
  },
  {
    id: 'waltz',
    title: 'ワルツ（3拍子）',
    description: 'ズン・チャッ・チャッの3拍子。',
    presetId: 'steel',
    patternId: 'waltz',
    bpm: 150,
    chords: ['C', 'G7', 'C', 'C7', 'F', 'C', 'G7', 'C'],
    repeat: 2,
  },
  {
    id: 'ambient',
    title: 'アンビエント',
    description: '広いディレイとリバーブ。コードを置くだけで空間になる。',
    presetId: 'ambient',
    patternId: 'slowarp',
    bpm: 68,
    chords: ['Cadd9', 'Em7', 'Fadd9', 'G'],
    repeat: 3,
  },
  {
    id: 'funk9',
    title: 'ファンク・カッティング',
    description: 'Em9-A9 の2コード。オートワウと合わせても。',
    presetId: 'funk',
    patternId: 'sixteen',
    bpm: 108,
    chords: ['Em9', 'Em9', 'A9', 'A9'],
    repeat: 4,
  },
  {
    id: 'jazz251',
    title: 'ジャズ II-V-I',
    description: 'Dm7-G7-CM7。アーチトップの丸いトーンで。',
    presetId: 'jazz',
    patternId: 'bossa',
    bpm: 126,
    chords: ['Dm7', 'G7', 'CM7', 'CM7', 'Am7', 'D7', 'GM7', 'GM7'],
    repeat: 2,
    minFret: 3,
  },
  {
    id: 'surf',
    title: 'サーフ・インスト',
    description: 'トレモロとスプリングリバーブの60年代サウンド。',
    presetId: 'surf',
    patternId: 'eighth',
    bpm: 160,
    chords: ['Em', 'Em', 'Am', 'B7'],
    repeat: 4,
  },
  {
    id: 'uke',
    title: 'ウクレレ・ハワイアン',
    description: '4弦ウクレレの軽やかなストローク。',
    presetId: 'ukulele',
    patternId: 'folk',
    bpm: 118,
    chords: ['C', 'Am', 'F', 'G7'],
    repeat: 4,
  },
  {
    id: 'bassline',
    title: 'ベースライン',
    description: 'エレキベースで8分のルート弾き。',
    presetId: 'bass',
    patternId: 'eighth',
    bpm: 104,
    chords: ['Am', 'F', 'C', 'G'],
    repeat: 4,
  },
];

export function findDemo(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
