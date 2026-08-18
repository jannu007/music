import { PATTERN_NAMES, buildPattern, createProject, type PatternSource } from '../audio/project';
import { emptyPattern } from '../audio/types';
import { TRACK_IDS } from '../audio/kits';
import type { Project, SongSlot } from '../audio/types';
import { t } from '../ui/i18n';

/**
 * 収録デモ。すべて本アプリのために書き下ろしたリズムパターンで、
 * 第三者の楽曲・音源は含まない（DRUMS.md の「権利について」を参照）。
 *
 * 記法は 4ステップごとに `|` で区切っている（`|` は読み飛ばされる）。
 *   `.` 休み / `o` ゴースト / `x` 通常 / `X` アクセント
 *   `r` 2連打 / `R` 3連打 / `?` 50%の確率
 */
export interface DemoSong {
  id: string;
  name: string;
  desc: string;
  kitId: string;
  bpm: number;
  swing: number;
  humanize?: number;
  stepsPerBeat?: number;
  patterns: PatternSource[];
  song: SongSlot[];
}

export const DEMO_SONGS: DemoSong[] = [
  {
    id: 'house',
    name: 'ディープ・ハウス',
    desc: '四つ打ち + 裏拍のオープンハット。クラブ系の基本形',
    kitId: 'house',
    bpm: 124,
    swing: 52,
    humanize: 0.12,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|X...|X...|X...',
          clap:   '....|X...|....|X...',
          ch:     'o.x.|o.x.|o.x.|o.x.',
          oh:     '..x.|..x.|..x.|..x.',
          shaker: '..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X...|X...|X...|X..x',
          clap:   '....|X...|....|X...',
          ch:     'o.x.|o.x.|o.x.|oxxx',
          oh:     '..x.|..x.|..x.|....',
          perc:   '....|..x.|....|x.x.',
          shaker: 'o.o.|o.o.|o.o.|o.o.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          clap:   '....|X...|....|X...',
          ch:     'x.x.|x.x.|x.x.|x.x.',
          oh:     '....|....|..x.|..x.',
          perc:   'x...|..x.|x...|..x.',
          rim:    '..o.|....|..o.|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:   'X...|X...|X...|....',
          clap:   '....|X...|....|....',
          ch:     'o.x.|o.x.|o.x.|....',
          tom3:   '....|....|....|x.x.',
          tom2:   '....|....|....|..x.',
          tom1:   '....|....|....|...X',
          crash:  '....|....|....|....',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 3 },
      { pattern: 3, repeats: 1 },
    ],
  },

  {
    id: 'techno',
    name: 'ハード・テクノ',
    desc: '歪んだキックと16分のハット。ミニマルに押し切る',
    kitId: 'techno',
    bpm: 138,
    swing: 50,
    humanize: 0.06,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|X...|X...|X...',
          ch:     'oxox|oxox|oxox|oxox',
          oh:     '..x.|....|..x.|....',
          rim:    '....|..x.|....|..x.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X...|X...|X...|X.X.',
          ch:     'oxox|oxox|oxox|oxRx',
          oh:     '..x.|....|..x.|..x.',
          clap:   '....|X...|....|X...',
          perc:   '...x|....|x...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ch:     'oxox|oxox|oxox|oxox',
          oh:     '..x.|..x.|..x.|..x.',
          clap:   '....|X...|....|X..x',
          cowbell:'x...|....|..x.|....',
        },
      },
      {
        name: 'D 落とし',
        sectionKey: 'drop',
        length: 32,
        rows: {
          kick:   'X...|X...|X...|X...|X...|X...|X...|....',
          ch:     'oxox|oxox|oxox|oxox|oxox|oxox|oxRx|RRRR',
          clap:   '....|X...|....|X...|....|X...|....|X.X.',
          crash:  '....|....|....|....|....|....|....|...X',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 1 },
    ],
  },

  {
    id: 'boombap',
    name: 'ブーンバップ',
    desc: 'ハネたゴーストノートと重いスネア。90年代のヒップホップ的な間',
    kitId: 'lofi',
    bpm: 88,
    swing: 58,
    humanize: 0.3,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|..x.|..X.|....',
          snare:  '....|X...|....|X...',
          ch:     'x.o.|x.o.|x.o.|x.oo',
          shaker: '..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X..x|..x.|..X.|.x..',
          snare:  '....|X...|....|X..o',
          ch:     'x.o.|x.o.|x.o.|x.o.',
          oh:     '....|....|....|..x.',
          rim:    '....|....|o...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          kick:   'X...|....|..X.|....',
          snare:  '....|X...|....|X...',
          ride:   'x.o.|x.o.|x.o.|x.o.',
          perc:   '....|..o.|....|..o.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:   'X...|..x.|....|....',
          snare:  '....|X...|o.o.|X.oX',
          ch:     'x.o.|x.o.|....|....',
          tom2:   '....|....|..x.|....',
          tom1:   '....|....|....|x...',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 3 },
      { pattern: 3, repeats: 1 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
    ],
  },

  {
    id: 'trap',
    name: 'トラップ',
    desc: 'ハーフタイムのスネアと、細かく転がすハイハットロール',
    kitId: 'trap',
    bpm: 140,
    swing: 50,
    humanize: 0.08,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|....|..X.|.X..',
          snare:  '....|....|X...|....',
          ch:     'x.x.|x.xr|x.x.|xRxr',
          oh:     '....|...x|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X...|..x.|..X.|.X.x',
          snare:  '....|....|X...|....',
          clap:   '....|....|X...|....',
          ch:     'x.xr|x.x.|xRx.|xrxR',
          shaker: '..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'C 静か',
        sectionKey: 'quiet',
        rows: {
          kick:   'X...|....|....|....',
          snare:  '....|....|X...|....',
          ch:     'x...|x...|x...|x...',
          rim:    '....|..o.|....|..o.',
        },
      },
      {
        name: 'D 転がし',
        sectionKey: 'roll',
        rows: {
          kick:   'X...|....|..X.|....',
          snare:  '....|....|X...|..X.',
          ch:     'xRxR|xRxR|RRRR|RRRR',
          crash:  'X...|....|....|....',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 1 },
    ],
  },

  {
    id: 'dnb',
    name: 'ドラムンベース',
    desc: '2小節のブレイクビート。速いテンポで走らせる',
    kitId: 'punch',
    bpm: 174,
    swing: 50,
    humanize: 0.14,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        length: 32,
        rows: {
          kick:   'X...|....|..x.|....|....|X...|..x.|....',
          snare:  '....|X...|....|X..o|....|X...|....|X.o.',
          ch:     'o.x.|o.x.|o.x.|o.x.|o.x.|o.x.|o.x.|o.xx',
          oh:     '....|....|..x.|....|....|....|..x.|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        length: 32,
        rows: {
          kick:   'X...|....|..x.|.x..|X...|....|..x.|....',
          snare:  '....|X...|....|X...|.o..|X...|....|X.oX',
          ch:     'o.x.|o.x.|o.x.|o.x.|o.x.|o.x.|o.x.|o.x.',
          ride:   '....|....|....|....|x.x.|x.x.|x.x.|x.x.',
          perc:   '....|..o.|....|..o.|....|..o.|....|..o.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          snare:  '....|X...|....|X...',
          ch:     'o.x.|o.x.|o.x.|o.x.',
          rim:    'o...|..o.|o...|..o.',
          shaker: '..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '..o.|X.o.|..oX|XoXX',
          ch:     'o.x.|o.x.|....|....',
          crash:  '....|....|....|...X',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 1 },
    ],
  },

  {
    id: 'rock',
    name: 'エイトビート',
    desc: 'ロックの基本形。生ドラム寄りのキットで',
    kitId: 'acoustic',
    bpm: 128,
    swing: 50,
    humanize: 0.22,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '....|X...|....|X...',
          ch:     'x.o.|x.o.|x.o.|x.o.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X...|..x.|X...|....',
          snare:  '....|X...|....|X..o',
          ch:     'x.o.|x.o.|x.o.|x.o.',
          crash:  'X...|....|....|....',
        },
      },
      {
        name: 'C サビ',
        sectionKey: 'chorus',
        rows: {
          kick:   'X...|..x.|X..x|....',
          snare:  '....|X...|....|X...',
          ride:   'x.x.|x.x.|x.x.|x.x.',
          crash:  'X...|....|....|....',
          tom3:   '....|....|....|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:   'X...|....|....|....',
          snare:  '....|X...|x.x.|....',
          ch:     'x.o.|x.o.|....|....',
          tom3:   '....|....|....|x...',
          tom2:   '....|....|....|..x.',
          tom1:   '....|....|....|...X',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 3 },
      { pattern: 3, repeats: 1 },
      { pattern: 2, repeats: 4 },
    ],
  },

  {
    id: 'funk',
    name: 'ファンク・シャッフル',
    desc: '強いハネとゴーストノート。スウィング 62%',
    kitId: 'acoustic',
    bpm: 104,
    swing: 62,
    humanize: 0.28,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X..x|....|..X.|.x..',
          snare:  '..o.|X.o.|..o.|X.o.',
          ch:     'x.ox|x.ox|x.ox|x.ox',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X..x|...x|..X.|.x.x',
          snare:  '..o.|X.o.|.oo.|X.oo',
          ch:     'x.ox|x.ox|x.ox|x.o.',
          oh:     '....|....|....|...x',
          cowbell:'x...|..x.|x...|..x.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          kick:   'X...|....|..X.|....',
          snare:  '..o.|X...|..o.|X...',
          rim:    'x...|..x.|x...|..x.',
          shaker: 'o.oo|o.oo|o.oo|o.oo',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '..o.|X.oo|X.oX|o.XX',
          tom2:   '....|....|..x.|....',
          tom1:   '....|....|....|x...',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 1 },
    ],
  },

  {
    id: 'latin',
    name: 'ラテン・パーカッション',
    desc: 'クラーベを軸にしたパーカッシブなリズム',
    kitId: 'acoustic',
    bpm: 100,
    swing: 50,
    humanize: 0.2,
    patterns: [
      {
        name: 'A クラーベ',
        sectionKey: 'clave',
        rows: {
          rim:    'x..x|..x.|..x.|x...',
          kick:   'X...|..x.|..X.|....',
          shaker: 'o.x.|o.x.|o.x.|o.x.',
          perc:   'x..o|.x..|x..o|.x..',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          rim:    'x..x|..x.|..x.|x...',
          kick:   'X..x|..x.|..X.|..x.',
          shaker: 'oxox|oxox|oxox|oxox',
          perc:   'x..o|.x.o|x..o|.x.x',
          cowbell:'x...|x...|x...|x...',
        },
      },
      {
        name: 'C 静か',
        sectionKey: 'quiet',
        rows: {
          shaker: 'o.x.|o.x.|o.x.|o.x.',
          perc:   'x..o|.x..|x..o|.x..',
          rim:    '....|..o.|....|..o.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          tom3:   'x.x.|....|x.x.|....',
          tom2:   '....|x.x.|....|x...',
          tom1:   '....|....|....|.x.X',
          perc:   'x...|..x.|x...|....',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 1 },
    ],
  },

  {
    id: 'polymeter',
    name: 'ポリメーター実験',
    desc: 'シェイカー7歩・パーカッション5歩。トラックごとに長さを変えると模様がゆっくり移り変わる',
    kitId: 'ambient',
    bpm: 96,
    swing: 50,
    humanize: 0.1,
    patterns: [
      {
        name: 'A 基本',
        sectionKey: 'basic',
        length: 16,
        rows: {
          kick:   'X...|....|..X.|....',
          rim:    '....|x...|....|x...',
          ch:     'o.x.|o.x.|o.x.|o.x.',
          shaker: 'x.o.|o.o',
          perc:   'x.o.|o',
        },
        polymeter: { shaker: 7, perc: 5 },
      },
      {
        name: 'B 厚く',
        sectionKey: 'thicker',
        length: 16,
        rows: {
          kick:   'X...|..x.|..X.|....',
          snare:  '....|....|X...|....',
          ch:     'o.x.|o.x.|o.x.|o.xx',
          shaker: 'x.o.|o.o',
          perc:   'x.o.|o',
          ride:   'x...|....|x...|....',
        },
        polymeter: { shaker: 7, perc: 5 },
      },
      {
        name: 'C 余白',
        sectionKey: 'space',
        length: 16,
        rows: {
          kick:   'X...|....|....|....',
          ch:     'o...|..o.|o...|..o.',
          shaker: 'x.o.|o.o',
          crash:  'X...|....|....|....',
        },
        polymeter: { shaker: 7 },
      },
      {
        name: 'D 収束',
        sectionKey: 'converge',
        length: 16,
        rows: {
          kick:   'X...|X...|X...|X...',
          tom1:   '..x.|....|..x.|....',
          tom2:   '....|..x.|....|..x.',
          ch:     'oxox|oxox|oxox|oxox',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 2 },
    ],
  },

  {
    id: 'synthpop',
    name: 'シンセポップ',
    desc: '80年代風。ゲートのかかった硬いスネアとカウベル',
    kitId: 'analog',
    bpm: 118,
    swing: 50,
    humanize: 0.05,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '....|X...|....|X...',
          ch:     'x.x.|x.x.|x.x.|x.x.',
          cowbell:'..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X...|...x|X...|....',
          snare:  '....|X...|....|X...',
          ch:     'x.x.|x.x.|x.x.|x.xx',
          oh:     '....|..x.|....|..x.',
          clap:   '....|X...|....|X...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ch:     'x.x.|x.x.|x.x.|x.x.',
          clap:   '....|X...|....|X...',
          cowbell:'x...|..x.|x...|..x.',
          perc:   '....|....|..o.|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '....|X...|..x.|x.xX',
          tom3:   '....|....|x...|....',
          tom2:   '....|....|..x.|....',
          crash:  '....|....|....|...X',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 3, repeats: 1 },
    ],
  },

  // ------------------------------------------------------------------
  // アルバム「天問」(Tenmon) 全10曲。ジャズ・ドラミング
  // （ライドシンバルのスウィング、ゴーストノート中心の控えめなスネア・
  // コンピング）で書き下ろした。専用のブラシ/ジャズキットは存在しない
  // ため、14トラック中もっとも生ドラムに近い 'acoustic' キットを使用
  // （kits.ts 参照）。
  //
  // 構成は Head - Head - Solo(複数コーラス) - Head(+タグ) で、
  // seconds_per_chorus = (拍子 * 60 / bpm) * 小節数 を基準に
  // 2:30〜3:30 に収まるようソング配列のリピート数を決めている
  // （計算根拠は各曲コメントを参照）。
  //
  // ソロ・コーラスは「同じパターンを十数小節そのまま繰り返す」ことを
  // 避けるため、5番目のパターン E＝クライマックス（B＝展開よりさらに
  // 密度を上げたソロ後半用）を各曲に追加し、コーラスごとに役割を
  // 入れ替えて構成している：
  //   build      = B(展開)半分 → E(クライマックス)半分。ソロの立ち上がり
  //   climax     = E(クライマックス)をコーラス全体で。ソロの頂点
  //   climaxVar  = B/E を1/4小節ずつ交互に。頂点のゆらぎ
  //   trade      = E(呼びかけ)と C(ブレイク＝応答)を1/4小節ずつ交互に。
  //                「トレーディング」（掛け合い）。16小節の06のみ実質
  //                トレーディング・フォーズ（4小節ずつの掛け合い）になる
  // 2つのバラード（05・10）だけは激しいクライマックスが不似合いなため
  // trade は使わず、E も抑えた強弱の"ゆらぎ"として書いている。
  // ------------------------------------------------------------------

  {
    // 8小節ヴァンプ。head×2 + build/climax/trade/climaxVar/climax の
    // 5ソロコーラス + head-out + タグ = 69小節
    // 69 * (4*60/96) = 172.5s = 2:52
    id: 'tenmon-01',
    name: '混沌の序章',
    desc: '天問 - モーダル・スウィング。ミステリアスで間を活かした一曲目',
    kitId: 'acoustic',
    bpm: 96,
    swing: 60,
    humanize: 0.26,
    patterns: [
      {
        // 頭打ちを避け、1拍目・3拍目だけを置く"漂う"ライド。ゴーストは
        // 拍の裏(eの位置)にずらして配置し、正解の見えない不安定さを出す
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|....|x...|....',
          ch:    '....|....|....|x...',
          snare: '....|.o..|...o|....',
          rim:   '....|....|....|..o.',
          kick:  'o?..|....|....|....',
        },
      },
      {
        // 展開＝ライドに裏拍を足し、ゴーストが増殖していく（混沌が募る）
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|..x.|x...|.x..',
          ch:    '....|....|x...|x...',
          snare: '..o.|.o.X|....|.o.o',
          rim:   '....|o...|....|..o.',
          kick:  'o...|...?|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ch:    '....|....|....|x...',
          snare: '....|....|....|..o?',
        },
      },
      {
        // フィル＝それまで溜めてきた静けさが一気に噴き出す転調点
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride:  'x.x.|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '..oX|.o.X|..oX|.oXX',
          tom2:  '....|....|....|x...',
          tom1:  '....|....|....|.x.X',
        },
      },
      {
        // クライマックス＝ライドが8分で回りだし、混沌が最高潮に達する
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x.x.|x.x.|x.x.|x.x.',
          ch:    '....|x...|....|x...',
          snare: '.o.X|.o.o|.o.X|.o.o',
          rim:   '....|o...|....|o...',
          kick:  'o...|..o?|o...|..o?',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 4, repeats: 8 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 12小節ブルース。head×2 + build/climax/trade/climaxVar/trade/climax
    // の6ソロコーラス + head-out + タグ = 113小節
    // 113 * (4*60/144) = 188.3s = 3:08
    id: 'tenmon-02',
    name: '誰が空を創ったのか',
    desc: '天問 - ミディアム・スウィングの12小節ブルース',
    kitId: 'acoustic',
    bpm: 144,
    swing: 58,
    humanize: 0.24,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          ch:    '....|x...|....|x...',
          snare: '..o.|....|.o..|....',
          kick:  'o...|....|o...|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|..x.|x.x.|..x.',
          ch:    '....|x...|....|x...',
          snare: '..oX|..o.|.o.X|..o.',
          rim:   '....|..o.|....|..o.',
          kick:  'o...|..o.|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride:  'x...|....|x...|....',
          ch:    '....|x...|....|x...',
          snare: '....|X...|....|..oX',
          rim:   'o...|..o.|o...|..o.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '..o.|.oXX|..o.|.oXX',
          tom2:  '....|....|....|x...',
          tom1:  '....|....|....|..xX',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x.x.|x.x.|x.x.|x.x.',
          ch:    '....|x...|....|x...',
          snare: '..oX|.o.o|..oX|.o.X',
          rim:   '....|..o.|....|..o.',
          kick:  'o...|..o.|o...|X.o.',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 12 },
      { pattern: 0, repeats: 12 },
      { pattern: 1, repeats: 6 },
      { pattern: 4, repeats: 6 },
      { pattern: 4, repeats: 12 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 4, repeats: 12 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 12 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 3/4拍子ジャズ・ワルツ。1小節=3拍*4ステップ=12ステップとして
    // パターン長を12に設定（このアプリのステップ長は拍子を仮定しない
    // ため、そのまま3拍子として成立する）。
    // 12小節コーラス。head×2 + 11ソロコーラス(build/climax/trade/
    // climaxVarを2.75周) + head-out + タグ = 173小節
    // 173 * (3*60/168) = 185.4s = 3:05
    id: 'tenmon-03',
    name: '星の回廊',
    desc: '天問 - 3拍子のジャズ・ワルツ',
    kitId: 'acoustic',
    bpm: 168,
    swing: 56,
    humanize: 0.24,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        length: 12,
        rows: {
          ride:  'X...|..x.|x...',
          ch:    '....|x...|....',
          snare: '....|..o.|....',
          kick:  'o...|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        length: 12,
        rows: {
          ride:  'X...|..x.|x.x.',
          ch:    '....|x...|....',
          snare: '..o.|.o.X|..o.',
          rim:   '....|....|o...',
          kick:  'o...|....|..o.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        length: 12,
        rows: {
          ride:  'X...|....|x...',
          ch:    '....|x...|....',
          snare: '....|....|..oX',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        length: 12,
        rows: {
          ride:  'X...|..x.|x...',
          crash: 'X...|....|....',
          snare: '..o.|.o.X|..oX',
          tom2:  '....|....|x...',
        },
      },
      {
        name: 'E クライマックス',
        sectionKey: 'climax',
        length: 12,
        rows: {
          ride:  'X.x.|x.x.|x...',
          ch:    '....|x...|....',
          snare: '.o.X|.o.o|..oX',
          rim:   '....|o...|....',
          kick:  'o...|....|.o..',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 12 },
      { pattern: 0, repeats: 12 },
      { pattern: 1, repeats: 6 },
      { pattern: 4, repeats: 6 },
      { pattern: 4, repeats: 12 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 1, repeats: 6 },
      { pattern: 4, repeats: 6 },
      { pattern: 4, repeats: 12 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 1, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 1, repeats: 6 },
      { pattern: 4, repeats: 6 },
      { pattern: 4, repeats: 12 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 4, repeats: 3 },
      { pattern: 2, repeats: 3 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 12 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 8小節ボサノヴァ。head×2 + 9ソロコーラス(build/climax/trade/
    // climaxVarを2周+climax) + head-out + タグ = 101小節
    // 101 * (4*60/132) = 183.6s = 3:04
    id: 'tenmon-04',
    name: '地の果てへ',
    desc: '天問 - ボサノヴァ。柔らかいリムとシェイカーで',
    kitId: 'acoustic',
    bpm: 132,
    swing: 50,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          kick:   'X...|..x.|X...|..x.',
          rim:    'x..x|..x.|..x.|x...',
          shaker: 'x.x.|x.x.|x.x.|x.x.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          kick:   'X...|..x.|X.x.|..x.',
          rim:    'x..x|..x.|..x.|x.x.',
          shaker: 'x.x.|x.x.|x.x.|x.x.',
          ch:     '....|....|x...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          rim:    'x..x|....|..x.|x...',
          shaker: 'x.x.|x...|x.x.|x...',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          kick:  'X...|..x.|X...|..x.',
          rim:   'x..x|..x.|..x.|x...',
          crash: '....|....|....|...X',
          tom2:  '....|....|....|x.x.',
        },
      },
      {
        // クライマックス＝リムに裏拍を足しシンコペーションを強める
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          kick:   'X..x|..x.|X.x.|..x.',
          rim:    'x.xx|..x.|x.xx|x...',
          shaker: 'x.x.|x.x.|x.x.|x.x.',
          ch:     '....|x...|....|x...',
          tom2:   '....|....|x...|....',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 4, repeats: 8 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 8小節バラード。head×2 + build/climaxVarの2ソロコーラスのみ
    // （バラードには激しいクライマックスやトレーディングは不似合い
    // なので、Eも抑えた"ゆらぎ"として書き、tradeは使わない） +
    // head-out + タグ = 45小節
    // 45 * (4*60/63) = 171.4s = 2:51
    id: 'tenmon-05',
    name: '問いかける月',
    desc: '天問 - バラード。ブラシとライドだけの静けさ',
    kitId: 'acoustic',
    bpm: 63,
    swing: 54,
    humanize: 0.3,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|....|x...|....',
          snare: '....|....|..o.|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|....|x...|..x.',
          snare: '....|.o..|..o.|....',
          kick:  '....|....|o...|....',
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
          ride:  'x...|....|x...|....',
          snare: '....|....|..o.|.o.X',
          crash: '....|....|....|...X',
        },
      },
      {
        // クライマックス＝ブラシがわずかに揺れ、月を見上げる呼吸のような膨らみ
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          snare: '....|.o..|..o.|.o..',
          kick:  '....|....|o...|....',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 16小節ハードバップ。head×2 + build/climax/trade(実質フォーズ)/
    // climaxVar/climaxの5ソロコーラス + head-out + タグ = 133小節
    // 133 * (4*60/176) = 181.4s = 3:01
    id: 'tenmon-06',
    name: '龍の眠り',
    desc: '天問 - ハードバップ。速いテンポで攻める',
    kitId: 'acoustic',
    bpm: 176,
    swing: 64,
    humanize: 0.22,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          ch:    '....|x...|....|x...',
          snare: '.o..|....|.o.X|....',
          kick:  'o...|....|o...|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|..x.|x.x.|..x.',
          ch:    '....|x...|....|x...',
          snare: '.o.X|..o.|.oXo|..oX',
          kick:  'o...|X.o.|....|o.X.',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride:  'x...|....|x...|....',
          ch:    '....|x...|....|x...',
          snare: '....|X...|....|..oX',
          kick:  '....|....|X...|....',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '.oXX|.o.X|.oXX|.oXX',
          tom3:  '....|....|....|x...',
          tom2:  '....|....|....|.x..',
          tom1:  '....|....|....|..xX',
        },
      },
      {
        // クライマックス＝キックのシンコペーションとクラッシュの
        // 確率的な差し込みで一気にテンションを上げる
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x.x.|x.x.|x.x.|x.x.',
          ch:    '....|x...|....|x...',
          snare: '.oXo|.o.X|.oXo|.o.X',
          kick:  'o.X.|X.o.|o.X.|X.o?',
          crash: 'X?..|....|....|....',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 16 },
      { pattern: 0, repeats: 16 },
      { pattern: 1, repeats: 8 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 16 },
      { pattern: 4, repeats: 4 },
      { pattern: 2, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 2, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 16 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 16 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 8小節アフロキューバン。head×2 + ソロ(build/climax/trade/climaxVar
    // を軸に組み替え) + head-out + タグ = 93小節
    // 93 * (4*60/138) = 161.7s = 2:42
    // クラーベ/シェイカーのラテン・リズムに、指示どおりスウィング・
    // ライドとハイハット(2,4拍)を重ねるハイブリッド編成。
    // ラテン曲としてスウィング量は控えめ(54)にしている。
    id: 'tenmon-07',
    name: '見えない橋',
    desc: '天問 - アフロキューバン・ジャズ。クラーベとライドの融合',
    kitId: 'acoustic',
    bpm: 138,
    swing: 54,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:   'x...|..x.|x...|..x.',
          ch:     '....|x...|....|x...',
          kick:   'X...|..x.|..X.|....',
          rim:    'x..x|..x.|..x.|x...',
          shaker: 'o.x.|o.x.|o.x.|o.x.',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:    'x...|..x.|x.x.|..x.',
          ch:      '....|x...|....|x...',
          kick:    'X..x|..x.|..X.|..x.',
          rim:     'x..x|..x.|..x.|x.x.',
          shaker:  'oxox|oxox|oxox|oxox',
          cowbell: 'x...|....|x...|....',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride:   'x...|....|x...|....',
          rim:    'x..x|..x.|..x.|x...',
          shaker: 'o.x.|o.x.|o.x.|o.x.',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          tom3:  'x.x.|....|x.x.|....',
          tom2:  '....|x.x.|....|x...',
          kick:  'X...|..x.|..X.|....',
        },
      },
      {
        // クライマックス＝クラーベを保ったままカウベルとシェイカーを
        // 前に出し、キックのシンコペーションを増やす
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:    'x.x.|x.x.|x.x.|x.x.',
          ch:      '....|x...|....|x...',
          kick:    'X..x|..x.|X.X.|..x.',
          rim:     'x..x|..xx|..x.|x.x.',
          shaker:  'oxox|oxox|oxox|oxox',
          cowbell: 'x...|..x.|x...|..x.',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 8 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 8小節モーダル・ヴァンプ。head×2 + ソロ(build/climax/trade/
    // climaxVarを組み替え) + head-out = 81小節
    // 81 * (4*60/120) = 162.0s = 2:42
    // "So What"系のモーダル・ジャズなのでスウィングは控えめ(55)。
    id: 'tenmon-08',
    name: '光と影のあいだ',
    desc: '天問 - モーダル・ジャズ。2コードのヴァンプ',
    kitId: 'acoustic',
    bpm: 120,
    swing: 55,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          ch:    '....|x...|....|x...',
          snare: '....|.o..|....|..o.',
          kick:  'o...|....|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|..x.|x.x.|..x.',
          ch:    '....|x...|....|x...',
          snare: '.o..|..oX|.o..|..oX',
          kick:  'o...|..o.|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride:  'x...|....|x...|....',
          ch:    '....|x...|....|x...',
          snare: '....|....|.o..|...X',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '.o.X|.o..|.o.X|.oXX',
          tom2:  '....|....|....|x.x.',
        },
      },
      {
        // クライマックス＝ライド8分＋スネアのアクセントで密度を上げる
        // （モーダルらしいクールさは保ち、ハードバップほど過激にはしない）
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x.x.|x.x.|x.x.|x.x.',
          ch:    '....|x...|....|x...',
          snare: '.o.o|.o.X|.o.o|.o.X',
          kick:  'o...|..o.|o...|..o?',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 8 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
    ],
  },

  {
    // 8小節Aセクション(リズムチェンジ系)。head×2 + ソロ(build/climax/
    // trade/climaxVarを複数周) + head-out + タグ = 133小節
    // 133 * (4*60/200) = 159.6s = 2:40
    id: 'tenmon-09',
    name: '天の川を渡る',
    desc: '天問 - アップテンポ・スウィング。リズムチェンジ系',
    kitId: 'acoustic',
    bpm: 200,
    swing: 62,
    humanize: 0.2,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          ch:    '....|x...|....|x...',
          snare: '.o..|....|..o.|....',
          kick:  'o...|....|....|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|..x.|x.x.|..x.',
          ch:    '....|x...|....|x...',
          snare: '.o.X|..o.|.o..|..oX',
          kick:  'o...|..o.|....|o...',
        },
      },
      {
        name: 'C ブレイク',
        sectionKey: 'break',
        rows: {
          ride:  'x...|....|x...|....',
          ch:    '....|x...|....|x...',
          snare: '....|X...|....|..oX',
        },
      },
      {
        name: 'D フィル',
        sectionKey: 'fill',
        rows: {
          ride:  'x...|..x.|x...|..x.',
          crash: 'X...|....|....|....',
          snare: '.oXX|.o.X|.oXX|.oXX',
          tom2:  '....|....|....|x...',
          tom1:  '....|....|....|..xX',
        },
      },
      {
        // クライマックス＝速いテンポなりに8分ライドを維持しつつ
        // キックにシンコペーションを足して推進力を上げる
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x.x.|x.x.|x.x.|x.x.',
          ch:    '....|x...|....|x...',
          snare: '.o.X|.o.o|.o.X|.o.o',
          kick:  'o...|X.o.|o...|X.o.',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 4, repeats: 8 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 2, repeats: 2 },
      { pattern: 4, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 4 },
    ],
  },

  {
    // 8小節バラード。head×2 + build/climaxVarの2ソロコーラスのみ
    // （終曲=エピローグなので静けさを保つ。trade・激しいEは使わない）
    // + head-out + タグ = 45小節
    // 45 * (4*60/58) = 186.2s = 3:06
    id: 'tenmon-10',
    name: '終わりなき問い',
    desc: '天問 - バラード。アルバムを締めくくるエピローグ',
    kitId: 'acoustic',
    bpm: 58,
    swing: 52,
    humanize: 0.3,
    patterns: [
      {
        name: 'A メイン',
        sectionKey: 'main',
        rows: {
          ride:  'x...|....|x...|....',
          snare: '....|....|..o.|....',
        },
      },
      {
        name: 'B 展開',
        sectionKey: 'dev',
        rows: {
          ride:  'x...|....|x...|..x.',
          snare: '....|.o..|..o.|....',
          kick:  '....|....|o...|....',
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
          ride:  'x...|....|x...|....',
          snare: '....|....|..o.|.o.X',
          crash: '....|....|....|...X',
        },
      },
      {
        // クライマックス＝「終わりなき問い」に応えるように、末尾に
        // ごく控えめなクラッシュを50%の確率で置く（答えの出ない揺らぎ）
        name: 'E クライマックス',
        sectionKey: 'climax',
        rows: {
          ride:  'x...|....|x...|..x.',
          snare: '....|.o..|..o.|.o..',
          kick:  '....|....|o...|....',
          crash: '....|....|....|...?',
        },
      },
    ],
    song: [
      { pattern: 0, repeats: 8 },
      { pattern: 0, repeats: 8 },
      { pattern: 1, repeats: 4 },
      { pattern: 4, repeats: 4 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 1, repeats: 2 },
      { pattern: 4, repeats: 2 },
      { pattern: 3, repeats: 1 },
      { pattern: 0, repeats: 8 },
      { pattern: 3, repeats: 4 },
    ],
  },
];

export function findDemo(id: string): DemoSong | undefined {
  return DEMO_SONGS.find((d) => d.id === id);
}

/** デモを1つのプロジェクトとして読み込む（空きパターンは空のまま残す） */
export function loadDemo(demo: DemoSong): Project {
  const project: Project = createProject(demo.kitId);
  project.name = demo.name;
  project.bpm = demo.bpm;
  project.swing = demo.swing;
  project.humanize = demo.humanize ?? 0.1;
  project.stepsPerBeat = demo.stepsPerBeat ?? 4;
  project.patterns = PATTERN_NAMES.map((label, i) => {
    const src = demo.patterns[i];
    if (!src) return emptyPattern(label, TRACK_IDS, 16);
    const section = src.sectionKey ? t(`section.${src.sectionKey}`) : src.name.replace(/^[A-H]\s*/, '');
    return buildPattern({ ...src, name: `${label} ${section}` });
  });
  project.song = demo.song.map((slot) => ({ ...slot }));
  project.songMode = true;
  project.current = 0;
  return project;
}
