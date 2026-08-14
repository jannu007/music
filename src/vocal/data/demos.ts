/*
 * デモ曲
 *
 * 収録曲はすべてこのアプリのために書き下ろしたオリジナル（詞・曲とも）で、
 * 既存楽曲の引用は一切していない。そのままアプリに同梱して配布・販売できる。
 *
 * 記法: 「歌詞:音名:拍数」を空白区切りで並べる。休符は「r:拍数」。
 *       拍数を省略すると 1 拍。例）ら:A4:0.5  r:2
 */

import { parseChordText } from '../audio/chords';
import { createNote, createSong, noteNameToMidi } from '../audio/song';
import { voiceDefaults } from '../audio/voices';
import { DEFAULT_MIX, type AccompStyle, type Expression, type MixSettings, type Song, type VocalNote } from '../audio/types';

interface DemoSpec {
  id: string;
  title: string;
  subtitle: string;
  voiceId: string;
  bpm: number;
  beatsPerBar: number;
  style: AccompStyle;
  /** 1 行 = 1 小節のコード進行 */
  chords: string;
  /** メロディと歌詞 */
  seq: string;
  mix?: Partial<MixSettings>;
  expression?: Partial<Expression>;
}

/** 記法をパースして音符に変換する */
function sequence(text: string): VocalNote[] {
  const notes: VocalNote[] = [];
  let at = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const parts = token.split(':');
    if (parts[0] === 'r') {
      at += Number(parts[1] ?? 1);
      continue;
    }
    const [lyric, name, beats] = parts;
    const length = Number(beats ?? 1);
    notes.push(
      createNote({
        start: at,
        length,
        note: noteNameToMidi(name),
        lyric,
        vel: 0.72,
      })
    );
    at += length;
  }
  return notes;
}

const SPECS: DemoSpec[] = [
  {
    id: 'hoshi',
    title: '星のことば',
    subtitle: 'しっとりしたバラード｜宵',
    voiceId: 'yoi',
    bpm: 76,
    beatsPerBar: 4,
    style: 'ballad',
    chords: `C
G
Am
F
C
G
F
Am
Em
F
C
G
F
G
C
C`,
    seq: `
      r:1 よ:E4:0.5 ぞ:E4:0.5 ら:G4:1 に:G4:1
      ひ:A4:1 か:G4:0.5 る:E4:1.5 r:1
      ほ:A4:0.5 し:A4:0.5 の:C5:1 こ:B4:1 え:A4:3 r:2
      r:0.5 そっ:E4:0.5 と:G4:0.5 て:G4:0.5 の:A4:0.5 ひ:G4:0.5 ら:E4:0.5 に:E4:0.5
      お:D4:0.5 ち:E4:0.5 て:G4:1 く:A4:0.5 る:G4:1.5
      r:4
      き:G4:0.5 み:A4:0.5 が:C5:1 r:0.5 わ:C5:0.5 らっ:D5:0.5 た:C5:0.5
      あ:A4:0.5 の:C5:0.5 ひ:B4:1 か:A4:0.5 ら:G4:1.5
      ぼ:F4:0.5 く:G4:0.5 の:A4:1 せ:A4:0.5 か:G4:0.5 い:A4:0.5 は:C5:0.5
      い:C5:0.5 ろ:D5:0.5 づ:C5:1 い:A4:0.5 た:G4:1.5
      r:4
      ずっ:A4:1 と:C5:1 r:0.5 ずっ:C5:0.5 と:D5:1
      r:0.5 わ:D5:0.5 す:C5:0.5 れ:B4:0.5 な:A4:0.5 い:G4:5.5
      r:4
    `,
    mix: { reverbType: 'hall', reverbMix: 0.34, delayMix: 0.12, accompLevel: 0.52 },
    expression: { vibDepth: 38, portamento: 85 },
  },
  {
    id: 'asahi',
    title: 'はしれ、あさひ',
    subtitle: '疾走するポップ｜燈',
    voiceId: 'akari',
    bpm: 132,
    beatsPerBar: 4,
    style: 'band',
    chords: `G
D
Em
C
G
D
C
D`,
    seq: `
      あ:D4:0.5 さ:G4:0.5 の:G4:0.5 r:0.5 ひ:G4:0.5 か:A4:0.5 り:B4:0.5 を:A4:0.5
      け:B4:0.5 と:B4:0.5 ば:A4:0.5 し:G4:0.5 て:A4:1.5 r:0.5
      は:B4:0.5 し:B4:0.5 る:D5:1 r:0.5 か:B4:0.5 ぜ:B4:0.5 よ:A4:0.5
      り:G4:0.5 r:0.5 は:A4:0.5 や:B4:0.5 く:A4:0.5 な:G4:0.5 れ:E4:1
      ま:D5:0.5 だ:D5:0.5 r:0.5 み:B4:0.5 ぬ:B4:0.5 r:0.5 ま:A4:0.5 ち:B4:0.5
      の:A4:0.5 r:0.5 む:B4:0.5 こ:D5:0.5 う:D5:0.5 ま:B4:0.5 で:A4:1
      い:G4:0.5 こ:A4:0.5 う:B4:1 r:0.5 い:B4:0.5 ま:C5:0.5 す:B4:0.5
      ぐ:A4:0.5 r:0.5 と:B4:0.5 び:C5:0.5 だ:D5:0.5 そ:B4:0.5 う:G4:1
    `,
    mix: { reverbType: 'room', reverbMix: 0.2, delayMix: 0.18, accompLevel: 0.66, tone: 0.25 },
    expression: { vibDepth: 24, consonant: 0.9, scoop: 0.35 },
  },
  {
    id: 'minamo',
    title: 'みなもの うた',
    subtitle: '静かなアルペジオ｜凪',
    voiceId: 'nagi',
    bpm: 68,
    beatsPerBar: 4,
    style: 'arpeggio',
    chords: `Am
F
C
G
Am
F
C
Am`,
    seq: `
      r:1 し:A4:0.5 ず:A4:0.5 か:C5:1 な:A4:1
      み:F4:0.5 な:A4:0.5 も:A4:1 に:G4:1 r:1
      つ:E4:0.5 き:G4:0.5 が:A4:2 r:1
      お:G4:0.5 ち:E4:0.5 る:D4:3
      な:A4:0.5 み:A4:0.5 だ:C5:1 の:A4:1 r:1
      あ:F4:0.5 と:A4:0.5 を:G4:2 r:1
      そっ:E4:0.5 と:G4:0.5 な:A4:1 で:G4:2
      る:A4:4
    `,
    mix: { reverbType: 'plate', reverbMix: 0.42, delayMix: 0.24, accompLevel: 0.44, doubler: 0.3 },
    expression: { vibDepth: 18, breathNoise: 0.6, portamento: 110 },
  },
  {
    id: 'yuki',
    title: 'ゆきの こもりうた',
    subtitle: '3拍子の子守唄｜澪',
    voiceId: 'mio',
    bpm: 60,
    beatsPerBar: 3,
    style: 'pad',
    chords: `G
D
Em
C
G
D
Em
C
G
G`,
    seq: `
      ゆ:B4:1 き:D5:1 が:D5:1
      し:C5:1 ず:B4:1 か:A4:0.5 に:B4:0.5
      つ:B4:1.5 も:A4:0.5 る:G4:1
      よ:E4:1 る:G4:2
      ね:D5:1 む:D5:1 れ:B4:1
      わ:A4:0.5 た:B4:0.5 し:A4:1 の:G4:1
      ち:B4:1 い:D5:1 さ:D5:0.5 な:C5:0.5
      ひ:B4:1 と:G4:5
    `,
    mix: { reverbType: 'church', reverbMix: 0.44, delayMix: 0.06, accompLevel: 0.4, tone: -0.05 },
    expression: { vibDepth: 46, vibDelay: 0.3, portamento: 120, dynamics: 0.7 },
  },
  {
    id: 'machi',
    title: 'まちの あかり',
    subtitle: '夜のシティポップ｜陸',
    voiceId: 'riku',
    bpm: 104,
    beatsPerBar: 4,
    style: 'pop',
    chords: `FM7
G7
Em7
Am7
FM7
G7
C
G`,
    seq: `
      r:0.5 ま:A4:0.5 ち:C5:0.5 の:C5:0.5 r:0.5 あ:C5:0.5 か:D5:0.5 り:C5:0.5
      が:A4:0.5 r:0.5 に:G4:0.5 じ:A4:0.5 む:C5:0.5 よ:A4:0.5 る:G4:1
      r:0.5 き:B4:0.5 み:D5:0.5 の:D5:0.5 r:0.5 こ:C5:0.5 え:D5:0.5 だ:C5:0.5
      け:A4:0.5 r:0.5 さ:A4:0.5 が:C5:0.5 し:C5:0.5 て:A4:0.5 た:G4:1
      r:0.5 よ:A4:0.5 る:C5:0.5 の:C5:0.5 r:0.5 す:C5:0.5 き:D5:0.5 ま:C5:0.5
      に:A4:0.5 r:0.5 お:G4:0.5 ち:A4:0.5 て:C5:0.5 ゆ:A4:0.5 く:G4:1
      r:0.5 ひ:G4:0.5 と:A4:0.5 り:C5:0.5 の:C5:0.5 ま:D5:0.5 ち:C5:1
      の:A4:0.5 ま:G4:0.5 ん:A4:0.5 な:C5:0.5 か:A4:0.5 で:G4:1.5
    `,
    mix: { reverbType: 'plate', reverbMix: 0.26, delayMix: 0.2, delayBeats: 0.75, accompLevel: 0.6, tone: 0.15 },
    expression: { vibDepth: 26, scoop: 0.4, consonant: 1.1 },
  },
  {
    id: 'akatsuki',
    title: 'あかつきの こえ',
    subtitle: '低音の讃歌｜響',
    voiceId: 'hibiki',
    bpm: 72,
    beatsPerBar: 4,
    style: 'pad',
    chords: `Dm
Bb
F
C
Dm
Bb
C
Dm`,
    seq: `
      あ:D3:1 か:F3:1 つ:A3:1 き:A3:1
      の:G3:1 か:F3:1 ぜ:D3:2
      よ:F3:1 ぶ:A3:3
      r:4
      と:A3:1 お:A3:1 い:C4:2
      ゆ:A3:1 め:G3:1 の:F3:2
      は:E3:1 て:F3:1 で:D3:2
      r:4
    `,
    mix: { reverbType: 'church', reverbMix: 0.4, delayMix: 0.05, accompLevel: 0.46, lowCut: 0.25 },
    expression: { vibDepth: 30, portamento: 100 },
  },
];

export interface DemoSong {
  id: string;
  title: string;
  subtitle: string;
  song: Song;
}

function build(spec: DemoSpec): DemoSong {
  const defaults = voiceDefaults(spec.voiceId);
  const song = createSong({
    title: spec.title,
    bpm: spec.bpm,
    beatsPerBar: spec.beatsPerBar,
    style: spec.style,
    notes: sequence(spec.seq),
    chords: parseChordText(spec.chords, spec.beatsPerBar),
    settings: {
      voiceId: spec.voiceId,
      a4: 440,
      character: { ...defaults.character },
      expression: { ...defaults.expression, ...spec.expression },
      mix: { ...DEFAULT_MIX, ...spec.mix },
    },
  });
  return { id: spec.id, title: spec.title, subtitle: spec.subtitle, song };
}

export const DEMOS: DemoSong[] = SPECS.map(build);

/** 起動時に開くデモ */
export const DEFAULT_DEMO = DEMOS[0];
