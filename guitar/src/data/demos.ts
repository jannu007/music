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

  // --------------------------------------------------------------------
  // アルバム「天問」(Tenmon) 全10曲。オリジナル・ジャズアルバム。
  // 各曲は「1コーラス分の chords 配列」×「repeat（コーラス数）」で
  // Head-Head-Solo(s)-Head の構成を近似する。
  // repeat は seconds_per_chorus = beats_per_bar*60/bpm*bars_per_chorus を
  // 目安に、合計が2:30〜3:30に収まるよう選んだ（下記コメント参照）。
  // E7alt / A7alt / G7alt はこのアプリのコードパーサーが "alt" を解釈できないため、
  // 最も近い属七の変化系として "7#9"（セブンス・シャープナイン）に置き換えている。
  // 1小節に2コード書かれている箇所（例: "Bb7 G7"）は、このアプリのコード進行が
  // 1小節=1コード固定のため、小節前半のコードを代表として採用した。
  // patternId は曲ごとのスタイルに合わせて描き分けている（スウィングは shuffle、
  // 3拍子は waltz、ボサノバは bossa、というように使い回さない）。minFret は
  // 実際のジャズギタリストの慣習に沿って中〜高ポジションのクローズ・ヴォイシングを
  // 弾かせるためのもので、いわゆる「開放弦のコードストローク」にはならないよう
  // 曲ごとに調整した（voiceChord() で実際に運指が成立することを確認済み）。
  // --------------------------------------------------------------------
  {
    id: 'tenmon-01',
    title: '混沌の序章',
    description: 'アルバム「天問」#1。Aマイナー、モーダルなスウィングで幽玄に始まる序曲。',
    presetId: 'jazz',
    // フィンガースタイルの p-i-m-i で内声を拾う、幽玄で間の空いたコンピング。
    patternId: 'threefinger',
    bpm: 96,
    // 8小節ヴァンプ。4*60/96*8=20s/コーラス。9コーラスで180s(3:00)。
    chords: ['Am7', 'Am7', 'Dm7', 'Dm7', 'Am7', 'Dm7', 'E7#9', 'Am7'],
    repeat: 9,
    minFret: 5,
  },
  {
    id: 'tenmon-02',
    title: '誰が空を創ったのか',
    description: 'アルバム「天問」#2。Bbの12小節ジャズブルース、ミディアムスウィングで。',
    presetId: 'blues',
    // ハネた8分のシャッフル・コンピング。王道のジャズブルースの推進力。
    patternId: 'shuffle',
    bpm: 144,
    // 12小節ブルース。4*60/144*12=20s/コーラス。9コーラスで180s(3:00)。
    chords: [
      'Bb7', 'Eb7', 'Bb7', 'Bb7', 'Eb7', 'Edim7',
      'Bb7', 'G7', 'Cm7', 'F7', 'Bb7', 'Cm7',
    ],
    repeat: 9,
    minFret: 3,
  },
  {
    id: 'tenmon-03',
    title: '星の回廊',
    description: 'アルバム「天問」#3。Dマイナーの3拍子、ジャズワルツで駆け抜ける。',
    presetId: 'jazz',
    // 3拍子ヴォイシングはこのエンジンで唯一の3/4パターン。
    patternId: 'waltz',
    bpm: 168,
    // 3/4拍子・12小節。3*60/168*12=12.857s/コーラス。14コーラスで180s(3:00)。
    chords: [
      'Dm7', 'Gm7', 'C7', 'Fmaj7', 'Bbmaj7', 'E7#9',
      'Am7', 'D7', 'Gm7', 'C7', 'Dm7', 'Dm7',
    ],
    repeat: 14,
    minFret: 4,
  },
  {
    id: 'tenmon-04',
    title: '地の果てへ',
    description: 'アルバム「天問」#4。Fメジャーのボサノバ、ナイロン弦のシンコペーション。',
    presetId: 'nylon',
    patternId: 'bossa',
    bpm: 132,
    // 8小節。4*60/132*8≒14.55s/コーラス。12コーラスで≒174.5s(2:55)。
    chords: ['Fmaj7', 'Em7b5', 'Dm7', 'Gm7', 'Fmaj7', 'Em7b5', 'Dm7', 'Cmaj7'],
    repeat: 12,
    minFret: 2,
  },
  {
    id: 'tenmon-05',
    title: '問いかける月',
    description: 'アルバム「天問」#5。Ebメジャーのバラード、指弾きで静かに問いかける。',
    presetId: 'fingerpick',
    patternId: 'ballad',
    bpm: 63,
    // 8小節。4*60/63*8≒30.5s/コーラス。6コーラスで≒182.9s(3:03)。
    chords: ['Ebmaj7', 'Cm7', 'Fm7', 'Bb7', 'Ebmaj7', 'Ab7', 'Gm7', 'Fm7'],
    repeat: 6,
    minFret: 5,
    // 弱めのブリッジミュートで音を近く・内向きに。バラードらしい親密さを添える。
    palm: 0.22,
  },
  {
    id: 'tenmon-06',
    title: '龍の眠り',
    description: 'アルバム「天問」#6。Cマイナーのハードバップ、速いスウィングで駆ける。',
    presetId: 'jazz',
    // 02と同じシャッフルだが、より高いポジション（minFret 5）で
    // 密集したハードバップらしい緊張感のあるヴォイシングにする。
    patternId: 'shuffle',
    bpm: 176,
    // 16小節。4*60/176*16≒21.8s/コーラス。8コーラスで≒174.5s(2:55)。
    chords: [
      'Cm7', 'Cm7', 'Fm7', 'Bb7', 'Ebmaj7', 'Abmaj7', 'Dm7b5', 'G7#9',
      'Cm7', 'Fm7', 'Ebmaj7', 'Dm7b5', 'Cm7', 'Ab7', 'G7', 'Cm7',
    ],
    repeat: 8,
    minFret: 5,
  },
  {
    id: 'tenmon-07',
    title: '見えない橋',
    description: 'アルバム「天問」#7。Aマイナー、アフロキューバン／ラテンジャズの8小節。',
    presetId: 'nylon',
    // 16分のシンコペーション＋ゴーストミュートで、モントゥーノ風の
    // アフロキューバンな刻みを表現（ボサノバの16とは違う質感に）。
    patternId: 'sixteen',
    bpm: 138,
    // 8小節。4*60/138*8≒13.9s/コーラス。13コーラスで≒180.9s(3:01)。
    chords: ['Am7', 'Am7', 'Dm7', 'E7#9', 'Am7', 'Dm7', 'E7#9', 'Am7'],
    repeat: 13,
    minFret: 2,
  },
  {
    id: 'tenmon-08',
    title: '光と影のあいだ',
    description: 'アルバム「天問」#8。Dドリアンの2コード・モーダルヴァンプ。',
    presetId: 'jazz',
    // "So What" 系のモーダル・ヴァンプらしく、静止したコードの上で
    // ゆったり分散和音を積むスローアルペジオを採用。
    patternId: 'slowarp',
    bpm: 120,
    // 8小節ヴァンプ。4*60/120*8=16s/コーラス。11コーラスで176s(2:56)。
    chords: ['Dm7', 'Dm7', 'Dm7', 'Dm7', 'Ebmaj7', 'Ebmaj7', 'Dm7', 'Dm7'],
    repeat: 11,
    minFret: 5,
  },
  {
    id: 'tenmon-09',
    title: '天の川を渡る',
    description: 'アルバム「天問」#9。Bbメジャー、リズムチェンジ系のアップテンポスウィング。',
    presetId: 'jazz',
    patternId: 'shuffle',
    bpm: 200,
    // 8小節A section。4*60/200*8=9.6s/コーラス。18コーラスで172.8s(2:53)。
    chords: ['Bbmaj7', 'Gm7', 'Cm7', 'F7', 'Fm7', 'Bb7', 'Ebmaj7', 'Ebm6'],
    repeat: 18,
    // 明るく抜けるアップテンポ・スウィングらしく、さらに高いポジションの
    // クローズ・ヴォイシングでミュートなし＝ブライトに弾き抜ける。
    minFret: 7,
  },
  {
    id: 'tenmon-10',
    title: '終わりなき問い',
    description: 'アルバム「天問」#10。Gメジャー、ルバート気味の終曲バラード。',
    presetId: 'ambient',
    // 小節頭に一度だけ鳴らして深いディレイ／ホールに溶かす、
    // ルバートな終曲にふさわしい「置くだけ」の全音符コンピング。
    patternId: 'whole',
    bpm: 58,
    // 8小節。4*60/58*8≒33.1s/コーラス。5コーラスで≒165.5s(2:46)。
    chords: ['Gmaj7', 'Em7', 'Am7', 'D7', 'Gmaj7', 'Cmaj7', 'Am7', 'Gmaj7'],
    repeat: 5,
    minFret: 3,
  },
];

export function findDemo(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
