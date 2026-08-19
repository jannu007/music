// 天問 (Tenmon) — スタンドアロン・アルバム用ドラム・パート
//
// drums/src/data/songs.ts に以前存在した DEMO_SONGS 配列の
// tenmon-01..tenmon-10 エントリ（アプリの Demo UI からは撤去済み）を、
// 「アルバム・ミックス書き出し専用」のデータモジュールとして再構成した
// ものです。drums/src 配下は一切変更していません（DemoSong / PatternSource /
// SongSlot 型と loadDemo() をそのまま再利用します）。
//
// 変更点（前回ラウンドとの差分）:
//   ・全曲の合計コーラス数を、6パート（ピアノ・ベース・ギター・ドラム・
//     ボーカル・シンセ）すべてが揃える必要のあるロック済み仕様
//     （/scratchpad/album-render-spec.md）の N に合わせて再構成した。
//     構成は Head, Head, Solo × (N-3), Head-out（末尾のタグ／頭出し前の
//     1小節フィルは廃止— ロック仕様が「タグ／イントロの余剰小節を
//     持たない」ことを要求するため）。
//   ・ソロコーラスは「ビルド → トレード → クライマックス変奏 → クライ
//     マックス」の4種を1サイクルとして繰り返し（バラードの2曲だけは
//     「ビルド → クライマックス変奏」の2種）、最後のソロコーラスだけは
//     クライマックスの最終小節をフィル・パターンに置き換えた「ターン
//     バック」にして、ヘッドアウトへの受け渡しを作る。これは元実装の
//     「ソロは同じパターンを十数小節そのまま繰り返さない」という設計を
//     維持したまま、任意のソロコーラス数 N-3 に一般化したもの。
//
// キー・コード進行・メロディック・フック・パターンの中身（ノーテーション）
// はオリジナル仕様（/scratchpad/album-tenmon-spec.md）から一切変更していない。
// パターン数・拍子・BPM・スウィング・キットもすべて元のまま。

import type { DemoSong } from '../../drums/src/data/songs';
import type { PatternSource } from '../../drums/src/audio/project';
import type { SongSlot } from '../../drums/src/audio/types';

// ------------------------------------------------------------------
// ロック済み構造（/scratchpad/album-render-spec.md 準拠）
//   N = 総コーラス数（Head, Head, Solo×(N-3), Head-out）
//   bars = 1コーラスの小節数
// ------------------------------------------------------------------
interface TenmonMeta {
  bars: number;
  n: number;
  ballad: boolean;
}

const LOCKED: Record<string, TenmonMeta> = {
  'tenmon-01': { bars: 8, n: 9, ballad: false },
  'tenmon-02': { bars: 12, n: 9, ballad: false },
  'tenmon-03': { bars: 12, n: 14, ballad: false },
  'tenmon-04': { bars: 8, n: 12, ballad: false },
  'tenmon-05': { bars: 8, n: 6, ballad: true },
  'tenmon-06': { bars: 16, n: 8, ballad: false },
  'tenmon-07': { bars: 8, n: 13, ballad: false },
  'tenmon-08': { bars: 8, n: 11, ballad: false },
  'tenmon-09': { bars: 8, n: 19, ballad: false },
  'tenmon-10': { bars: 8, n: 5, ballad: true },
};

// パターン索引: 0=A メイン(head) 1=B 展開 2=C ブレイク 3=D フィル 4=E クライマックス
type Flavor = 'build' | 'trade' | 'climaxVar' | 'climax' | 'climaxTurnback';

/** 1ソロコーラス分（bars 小節）を、指定した「味付け」で組み立てる */
function flavorSlots(flavor: Flavor, bars: number): SongSlot[] {
  const half = bars / 2;
  const q = bars / 4;
  switch (flavor) {
    case 'build':
      // B(展開)半分 → E(クライマックス)半分。ソロの立ち上がり
      return [
        { pattern: 1, repeats: half },
        { pattern: 4, repeats: half },
      ];
    case 'trade':
      // E(呼びかけ)と C(ブレイク=応答)を1/4小節ずつ交互に。トレーディング
      return [
        { pattern: 4, repeats: q },
        { pattern: 2, repeats: q },
        { pattern: 4, repeats: q },
        { pattern: 2, repeats: q },
      ];
    case 'climaxVar':
      // B/E を1/4小節ずつ交互に。頂点のゆらぎ
      return [
        { pattern: 1, repeats: q },
        { pattern: 4, repeats: q },
        { pattern: 1, repeats: q },
        { pattern: 4, repeats: q },
      ];
    case 'climax':
      // E(クライマックス)をコーラス全体で。ソロの頂点
      return [{ pattern: 4, repeats: bars }];
    case 'climaxTurnback':
      // クライマックスの最終小節をフィルに差し替え、ヘッドアウトへの
      // 受け渡し（ターンバック）を作る。小節数は変えない
      return [
        { pattern: 4, repeats: bars - 1 },
        { pattern: 3, repeats: 1 },
      ];
  }
}

/** ソロコーラス数ぶんの「味付け」の並びを作る（隣り合うコーラスが同じ味にならないように） */
function buildFlavors(count: number, ballad: boolean): Flavor[] {
  if (ballad) {
    // バラードは激しいクライマックスやトレーディングを使わず、
    // ビルドとクライマックス変奏だけを交互に（2周期なので隣接重複は起きない）
    const cycle: Flavor[] = ['build', 'climaxVar'];
    return Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
  }
  const cycle: Flavor[] = ['build', 'trade', 'climaxVar', 'climax'];
  const out: Flavor[] = Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
  // 最後のソロコーラスは必ずターンバック（ヘッドアウトへの受け渡し）にする
  if (out.length > 0) out[out.length - 1] = 'climaxTurnback';
  return out;
}

/** ロック済み N・bars から song: SongSlot[] を組み立てる */
function buildTenmonSong(bars: number, n: number, ballad: boolean): SongSlot[] {
  const soloCount = n - 3;
  const flavors = buildFlavors(soloCount, ballad);
  const song: SongSlot[] = [];
  song.push({ pattern: 0, repeats: bars }); // head 1
  song.push({ pattern: 0, repeats: bars }); // head 2
  for (const f of flavors) song.push(...flavorSlots(f, bars));
  song.push({ pattern: 0, repeats: bars }); // head-out
  return song;
}

// ------------------------------------------------------------------
// 各曲のパターン定義（ノーテーションはオリジナル仕様のまま。song のみ差し替え）
// ------------------------------------------------------------------
interface TenmonSpec {
  id: string;
  name: string;
  desc: string;
  bpm: number;
  swing: number;
  humanize: number;
  patterns: PatternSource[];
}

const SPECS: TenmonSpec[] = [
  {
    id: 'tenmon-01',
    name: '混沌の序章',
    desc: '天問 - モーダル・スウィング。ミステリアスで間を活かした一曲目',
    bpm: 96,
    swing: 60,
    humanize: 0.26,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|....|x...|....',
          ch: '....|....|....|x...',
          snare: '....|.o..|...o|....',
          rim: '....|....|....|..o.',
          kick: 'o?..|....|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|..x.|x...|.x..',
          ch: '....|....|x...|x...',
          snare: '..o.|.o.X|....|.o.o',
          rim: '....|o...|....|..o.',
          kick: 'o...|...?|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ch: '....|....|....|x...',
          snare: '....|....|....|..o?',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x.x.|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '..oX|.o.X|..oX|.oXX',
          tom2: '....|....|....|x...',
          tom1: '....|....|....|.x.X',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          snare: '.o.X|.o.o|.o.X|.o.o',
          rim: '....|o...|....|o...',
          kick: 'o...|..o?|o...|..o?',
        },
      },
    ],
  },

  {
    id: 'tenmon-02',
    name: '誰が空を創ったのか',
    desc: '天問 - ミディアム・スウィングの12小節ブルース',
    bpm: 144,
    swing: 58,
    humanize: 0.24,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          ch: '....|x...|....|x...',
          snare: '..o.|....|.o..|....',
          kick: 'o...|....|o...|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|..x.|x.x.|..x.',
          ch: '....|x...|....|x...',
          snare: '..oX|..o.|.o.X|..o.',
          rim: '....|..o.|....|..o.',
          kick: 'o...|..o.|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride: 'x...|....|x...|....',
          ch: '....|x...|....|x...',
          snare: '....|X...|....|..oX',
          rim: 'o...|..o.|o...|..o.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '..o.|.oXX|..o.|.oXX',
          tom2: '....|....|....|x...',
          tom1: '....|....|....|..xX',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          snare: '..oX|.o.o|..oX|.o.X',
          rim: '....|..o.|....|..o.',
          kick: 'o...|..o.|o...|X.o.',
        },
      },
    ],
  },

  {
    id: 'tenmon-03',
    name: '星の回廊',
    desc: '天問 - 3拍子のジャズ・ワルツ',
    bpm: 168,
    swing: 56,
    humanize: 0.24,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        length: 12,
        rows: {
          ride: 'X...|..x.|x...',
          ch: '....|x...|....',
          snare: '....|..o.|....',
          kick: 'o...|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        length: 12,
        rows: {
          ride: 'X...|..x.|x.x.',
          ch: '....|x...|....',
          snare: '..o.|.o.X|..o.',
          rim: '....|....|o...',
          kick: 'o...|....|..o.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        length: 12,
        rows: {
          ride: 'X...|....|x...',
          ch: '....|x...|....',
          snare: '....|....|..oX',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        length: 12,
        rows: {
          ride: 'X...|..x.|x...',
          crash: 'X...|....|....',
          snare: '..o.|.o.X|..oX',
          tom2: '....|....|x...',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        length: 12,
        rows: {
          ride: 'X.x.|x.x.|x...',
          ch: '....|x...|....',
          snare: '.o.X|.o.o|..oX',
          rim: '....|o...|....',
          kick: 'o...|....|.o..',
        },
      },
    ],
  },

  {
    id: 'tenmon-04',
    name: '地の果てへ',
    desc: '天問 - ボサノヴァ。柔らかいリムとシェイカーで',
    bpm: 132,
    swing: 50,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick: 'X...|..x.|X...|..x.',
          rim: 'x..x|..x.|..x.|x...',
          shaker: 'x.x.|x.x.|x.x.|x.x.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick: 'X...|..x.|X.x.|..x.',
          rim: 'x..x|..x.|..x.|x.x.',
          shaker: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|....|x...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          rim: 'x..x|....|..x.|x...',
          shaker: 'x.x.|x...|x.x.|x...',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick: 'X...|..x.|X...|..x.',
          rim: 'x..x|..x.|..x.|x...',
          crash: '....|....|....|...X',
          tom2: '....|....|....|x.x.',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          kick: 'X..x|..x.|X.x.|..x.',
          rim: 'x.xx|..x.|x.xx|x...',
          shaker: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          tom2: '....|....|x...|....',
        },
      },
    ],
  },

  {
    id: 'tenmon-05',
    name: '問いかける月',
    desc: '天問 - バラード。ブラシとライドだけの静けさ',
    bpm: 63,
    swing: 54,
    humanize: 0.3,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|....|x...|....',
          snare: '....|....|..o.|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|....|x...|..x.',
          snare: '....|.o..|..o.|....',
          kick: '....|....|o...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          crash: 'X...|....|....|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|....|x...|....',
          snare: '....|....|..o.|.o.X',
          crash: '....|....|....|...X',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          snare: '....|.o..|..o.|.o..',
          kick: '....|....|o...|....',
        },
      },
    ],
  },

  {
    id: 'tenmon-06',
    name: '龍の眠り',
    desc: '天問 - ハードバップ。速いテンポで攻める',
    bpm: 176,
    swing: 64,
    humanize: 0.22,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          ch: '....|x...|....|x...',
          snare: '.o..|....|.o.X|....',
          kick: 'o...|....|o...|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|..x.|x.x.|..x.',
          ch: '....|x...|....|x...',
          snare: '.o.X|..o.|.oXo|..oX',
          kick: 'o...|X.o.|....|o.X.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride: 'x...|....|x...|....',
          ch: '....|x...|....|x...',
          snare: '....|X...|....|..oX',
          kick: '....|....|X...|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '.oXX|.o.X|.oXX|.oXX',
          tom3: '....|....|....|x...',
          tom2: '....|....|....|.x..',
          tom1: '....|....|....|..xX',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          snare: '.oXo|.o.X|.oXo|.o.X',
          kick: 'o.X.|X.o.|o.X.|X.o?',
          crash: 'X?..|....|....|....',
        },
      },
    ],
  },

  {
    id: 'tenmon-07',
    name: '見えない橋',
    desc: '天問 - アフロキューバン・ジャズ。クラーベとライドの融合',
    bpm: 138,
    swing: 54,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          ch: '....|x...|....|x...',
          kick: 'X...|..x.|..X.|....',
          rim: 'x..x|..x.|..x.|x...',
          shaker: 'o.x.|o.x.|o.x.|o.x.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|..x.|x.x.|..x.',
          ch: '....|x...|....|x...',
          kick: 'X..x|..x.|..X.|..x.',
          rim: 'x..x|..x.|..x.|x.x.',
          shaker: 'oxox|oxox|oxox|oxox',
          cowbell: 'x...|....|x...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride: 'x...|....|x...|....',
          rim: 'x..x|..x.|..x.|x...',
          shaker: 'o.x.|o.x.|o.x.|o.x.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          tom3: 'x.x.|....|x.x.|....',
          tom2: '....|x.x.|....|x...',
          kick: 'X...|..x.|..X.|....',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          kick: 'X..x|..x.|X.X.|..x.',
          rim: 'x..x|..xx|..x.|x.x.',
          shaker: 'oxox|oxox|oxox|oxox',
          cowbell: 'x...|..x.|x...|..x.',
        },
      },
    ],
  },

  {
    id: 'tenmon-08',
    name: '光と影のあいだ',
    desc: '天問 - モーダル・ジャズ。2コードのヴァンプ',
    bpm: 120,
    swing: 55,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          ch: '....|x...|....|x...',
          snare: '....|.o..|....|..o.',
          kick: 'o...|....|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|..x.|x.x.|..x.',
          ch: '....|x...|....|x...',
          snare: '.o..|..oX|.o..|..oX',
          kick: 'o...|..o.|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride: 'x...|....|x...|....',
          ch: '....|x...|....|x...',
          snare: '....|....|.o..|...X',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '.o.X|.o..|.o.X|.oXX',
          tom2: '....|....|....|x.x.',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          snare: '.o.o|.o.X|.o.o|.o.X',
          kick: 'o...|..o.|o...|..o?',
        },
      },
    ],
  },

  {
    id: 'tenmon-09',
    name: '天の川を渡る',
    desc: '天問 - アップテンポ・スウィング。リズムチェンジ系',
    bpm: 200,
    swing: 62,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          ch: '....|x...|....|x...',
          snare: '.o..|....|..o.|....',
          kick: 'o...|....|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|..x.|x.x.|..x.',
          ch: '....|x...|....|x...',
          snare: '.o.X|..o.|.o..|..oX',
          kick: 'o...|..o.|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride: 'x...|....|x...|....',
          ch: '....|x...|....|x...',
          snare: '....|X...|....|..oX',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '.oXX|.o.X|.oXX|.oXX',
          tom2: '....|....|....|x...',
          tom1: '....|....|....|..xX',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x.x.|x.x.|x.x.|x.x.',
          ch: '....|x...|....|x...',
          snare: '.o.X|.o.o|.o.X|.o.o',
          kick: 'o...|X.o.|o...|X.o.',
        },
      },
    ],
  },

  {
    id: 'tenmon-10',
    name: '終わりなき問い',
    desc: '天問 - バラード。アルバムを締めくくるエピローグ',
    bpm: 58,
    swing: 52,
    humanize: 0.3,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride: 'x...|....|x...|....',
          snare: '....|....|..o.|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride: 'x...|....|x...|..x.',
          snare: '....|.o..|..o.|....',
          kick: '....|....|o...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          crash: 'X...|....|....|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride: 'x...|....|x...|....',
          snare: '....|....|..o.|.o.X',
          crash: '....|....|....|...X',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride: 'x...|....|x...|..x.',
          snare: '....|.o..|..o.|.o..',
          kick: '....|....|o...|....',
          crash: '....|....|....|...?',
        },
      },
    ],
  },
];

const BY_ID = new Map(SPECS.map((s) => [s.id, s]));

/** id (tenmon-01..tenmon-10) からロック済み構造の DemoSong を組み立てる */
export function drumsTenmonTrack(id: string): DemoSong {
  const spec = BY_ID.get(id);
  const meta = LOCKED[id];
  if (!spec || !meta) throw new Error(`unknown tenmon track id: ${id}`);
  return {
    id: spec.id,
    name: spec.name,
    desc: spec.desc,
    kitId: 'acoustic',
    bpm: spec.bpm,
    swing: spec.swing,
    humanize: spec.humanize,
    patterns: spec.patterns,
    song: buildTenmonSong(meta.bars, meta.n, meta.ballad),
  };
}

export const TENMON_TRACK_IDS = SPECS.map((s) => s.id);
