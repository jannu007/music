import { PATTERN_NAMES, buildPattern, createProject, type PatternSource } from '../audio/project';
import { emptyPattern } from '../audio/types';
import { TRACK_IDS } from '../audio/kits';
import type { Project, SongSlot } from '../audio/types';

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
        rows: {
          kick:   'X...|X...|X...|X...',
          ch:     'oxox|oxox|oxox|oxox',
          oh:     '..x.|....|..x.|....',
          rim:    '....|..x.|....|..x.',
        },
      },
      {
        name: 'B 展開',
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
        rows: {
          ch:     'oxox|oxox|oxox|oxox',
          oh:     '..x.|..x.|..x.|..x.',
          clap:   '....|X...|....|X..x',
          cowbell:'x...|....|..x.|....',
        },
      },
      {
        name: 'D 落とし',
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
        rows: {
          kick:   'X...|..x.|..X.|....',
          snare:  '....|X...|....|X...',
          ch:     'x.o.|x.o.|x.o.|x.oo',
          shaker: '..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'B 展開',
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
        rows: {
          kick:   'X...|....|..X.|....',
          snare:  '....|X...|....|X...',
          ride:   'x.o.|x.o.|x.o.|x.o.',
          perc:   '....|..o.|....|..o.',
        },
      },
      {
        name: 'D フィル',
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
        rows: {
          kick:   'X...|....|..X.|.X..',
          snare:  '....|....|X...|....',
          ch:     'x.x.|x.xr|x.x.|xRxr',
          oh:     '....|...x|....|....',
        },
      },
      {
        name: 'B 展開',
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
        rows: {
          kick:   'X...|....|....|....',
          snare:  '....|....|X...|....',
          ch:     'x...|x...|x...|x...',
          rim:    '....|..o.|....|..o.',
        },
      },
      {
        name: 'D 転がし',
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
        rows: {
          snare:  '....|X...|....|X...',
          ch:     'o.x.|o.x.|o.x.|o.x.',
          rim:    'o...|..o.|o...|..o.',
          shaker: '..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'D フィル',
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
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '....|X...|....|X...',
          ch:     'x.o.|x.o.|x.o.|x.o.',
        },
      },
      {
        name: 'B 展開',
        rows: {
          kick:   'X...|..x.|X...|....',
          snare:  '....|X...|....|X..o',
          ch:     'x.o.|x.o.|x.o.|x.o.',
          crash:  'X...|....|....|....',
        },
      },
      {
        name: 'C サビ',
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
        rows: {
          kick:   'X..x|....|..X.|.x..',
          snare:  '..o.|X.o.|..o.|X.o.',
          ch:     'x.ox|x.ox|x.ox|x.ox',
        },
      },
      {
        name: 'B 展開',
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
        rows: {
          kick:   'X...|....|..X.|....',
          snare:  '..o.|X...|..o.|X...',
          rim:    'x...|..x.|x...|..x.',
          shaker: 'o.oo|o.oo|o.oo|o.oo',
        },
      },
      {
        name: 'D フィル',
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
        rows: {
          rim:    'x..x|..x.|..x.|x...',
          kick:   'X...|..x.|..X.|....',
          shaker: 'o.x.|o.x.|o.x.|o.x.',
          perc:   'x..o|.x..|x..o|.x..',
        },
      },
      {
        name: 'B 展開',
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
        rows: {
          shaker: 'o.x.|o.x.|o.x.|o.x.',
          perc:   'x..o|.x..|x..o|.x..',
          rim:    '....|..o.|....|..o.',
        },
      },
      {
        name: 'D フィル',
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
        rows: {
          kick:   'X...|....|X...|....',
          snare:  '....|X...|....|X...',
          ch:     'x.x.|x.x.|x.x.|x.x.',
          cowbell:'..o.|..o.|..o.|..o.',
        },
      },
      {
        name: 'B 展開',
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
        rows: {
          ch:     'x.x.|x.x.|x.x.|x.x.',
          clap:   '....|X...|....|X...',
          cowbell:'x...|..x.|x...|..x.',
          perc:   '....|....|..o.|....',
        },
      },
      {
        name: 'D フィル',
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
    return buildPattern({ ...src, name: `${label} ${src.name.replace(/^[A-H]\s*/, '')}` });
  });
  project.song = demo.song.map((slot) => ({ ...slot }));
  project.songMode = true;
  project.current = 0;
  return project;
}
