/*
 * 収録デモ。
 *
 * すべて本アプリのために書き下ろしたもので、第三者の楽曲・音源は含まない。
 * 鳴っている音は付属音源（factory.ts）で、それ自体も録音ではなく合成なので、
 * デモを書き出した音源もそのまま商用利用できる。
 *
 * 記法
 *
 *   1トークン = 1ステップ。既定は16分（stepsPerBeat = 4）。
 *
 *     .        休み
 *     -        直前の音を1ステップ伸ばす
 *     C4       音名（C D E F G A B に # と b、末尾にオクターブ）
 *     C4+E4+G4 和音（+ でつなぐ）
 *     C4!      強く
 *     C4,      弱く
 *
 *   `|` は読みやすさのための区切りで、読み飛ばされる。
 *
 * 声部（lane）は同時に鳴る。ベース・和音・旋律を別々の行に書ける。
 */

import type { PerformanceEvent } from '../audio/recorder';
import type { FxSettings, Instrument } from '../audio/types';

export interface DemoLane {
  /** 音の並び。1トークン = 1ステップ */
  steps: string;
  /** 基準の強さ 1..127 */
  vel?: number;
  /** 音の長さ。1 でステップ長ぴったり、0.5 で歯切れよく、1.5 で重ねる */
  gate?: number;
}

export interface DemoSong {
  id: string;
  /** どの付属音源で鳴らすか */
  instrument: string;
  bpm: number;
  /** 1拍あたりのステップ数。既定は4（16分） */
  stepsPerBeat?: number;
  /**
   * 何回繰り返すか。既定は1。
   * リズムのように1小節で完結する型は、繰り返さないと曲として短すぎる
   */
  repeats?: number;
  /** この曲のための音づくり。既定から変えたいところだけ書く */
  tweak?: Partial<Omit<Instrument, 'fx'>> & { fx?: Partial<FxSettings> };
  lanes: DemoLane[];
}

const NOTE_OFFSETS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** `C4` `F#3` `Eb5` を MIDI ノート番号に */
function parseNote(text: string): number | null {
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(text);
  if (!m) return null;
  const base = NOTE_OFFSETS[m[1].toLowerCase()];
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  return (octave + 1) * 12 + base + accidental;
}

interface Sounding {
  event: PerformanceEvent;
  /** 何ステップ伸びているか */
  steps: number;
}

/** 声部の文字列をトークンに割る */
function tokenize(steps: string): string[] {
  return steps.replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/** 1つの声部を音符に変える */
function buildLane(lane: DemoLane, secondsPerStep: number, offset: number): PerformanceEvent[] {
  const tokens = tokenize(lane.steps);
  const baseVel = lane.vel ?? 96;
  const gate = lane.gate ?? 0.95;
  const events: PerformanceEvent[] = [];
  // いま伸ばしている音。`-` が来たら長さを足す
  let held: Sounding[] = [];

  const close = () => {
    for (const h of held) h.event.duration = h.steps * secondsPerStep * gate;
    held = [];
  };

  tokens.forEach((token, index) => {
    if (token === '-') {
      for (const h of held) h.steps++;
      return;
    }
    close();
    if (token === '.') return;

    for (const piece of token.split('+')) {
      let vel = baseVel;
      let name = piece;
      // 末尾の記号で強弱を付ける
      while (name.length > 1 && (name.endsWith('!') || name.endsWith(','))) {
        vel += name.endsWith('!') ? 24 : -26;
        name = name.slice(0, -1);
      }
      const note = parseNote(name);
      if (note === null) return;
      const event: PerformanceEvent = {
        note,
        velocity: Math.max(1, Math.min(127, vel)),
        time: offset + index * secondsPerStep,
        duration: secondsPerStep * gate,
      };
      events.push(event);
      held.push({ event, steps: 1 });
    }
  });
  close();
  return events;
}

/** デモを演奏（音符の並び）に変える */
export function buildDemo(demo: DemoSong): PerformanceEvent[] {
  const stepsPerBeat = demo.stepsPerBeat ?? 4;
  const secondsPerStep = 60 / demo.bpm / stepsPerBeat;
  // 繰り返しの間隔は、いちばん長い声部の長さにそろえる
  const patternSteps = Math.max(...demo.lanes.map((lane) => tokenize(lane.steps).length));
  const patternSeconds = patternSteps * secondsPerStep;
  const repeats = Math.max(1, demo.repeats ?? 1);

  const events: PerformanceEvent[] = [];
  for (let r = 0; r < repeats; r++) {
    for (const lane of demo.lanes) {
      events.push(...buildLane(lane, secondsPerStep, r * patternSeconds));
    }
  }
  return events.sort((a, b) => a.time - b.time);
}

export function findDemo(id: string): DemoSong | undefined {
  return DEMO_SONGS.find((d) => d.id === id);
}

// ------------------------------------------------------------------ 収録曲

export const DEMO_SONGS: DemoSong[] = [
  {
    // 五音音階を、間を空けて置いていく。音と音のあいだの静けさが主役
    id: 'stoneGarden',
    instrument: 'kotoStrings',
    bpm: 72,
    tweak: { fx: { reverbType: 'hall', reverbMix: 0.3, width: 1.2 } },
    lanes: [
      {
        vel: 88,
        gate: 3.5,
        steps: `
          D3 . . . | . . A3 . | . . . . | F3 . . .
          . . . . | C4 . . . | . . . . | A3 . . .
          D3 . . . | . . . . | G3 . . . | . . A3 .
          . . . . | . . . . | F3 . . . | . . . .
        `,
      },
      {
        vel: 62,
        gate: 5,
        steps: `
          D2 . . . | . . . . | . . . . | . . . .
          . . . . | . . . . | . . . . | . . . .
          A1 . . . | . . . . | . . . . | . . . .
          . . . . | . . . . | . . . . | . . . .
        `,
      },
    ],
  },
  {
    // 上下に折り返す分散和音。硬い金属弦が転がるように
    id: 'frost',
    instrument: 'steelHarp',
    bpm: 96,
    tweak: { fx: { reverbType: 'plate', reverbMix: 0.24, delayMix: 0.18, delayTime: 0.26 } },
    lanes: [
      {
        vel: 84,
        gate: 1.6,
        steps: `
          E3 B3 E4 G4 | B4 G4 E4 B3 | E3 B3 E4 G4 | B4 G4 E4 B3
          C3 G3 C4 E4 | G4 E4 C4 G3 | C3 G3 C4 E4 | G4 E4 C4 G3
          A2 E3 A3 C4 | E4 C4 A3 E3 | A2 E3 A3 C4 | E4 C4 A3 E3
          B2 F#3 B3 D4 | F#4 D4 B3 F#3 | B2 F#3 B3 D4 | F#4! . . .
        `,
      },
    ],
  },
  {
    // ゆっくり立ち上がる和音を重ねる。輪郭をぼかしたまま動かす
    id: 'morningMist',
    instrument: 'mistPad',
    bpm: 60,
    stepsPerBeat: 2,
    tweak: {
      amp: { attack: 1.1, decay: 1.6, sustain: 0.9, release: 2.4 },
      // 3和音を重ねたまま伸ばすので、そのままだと足し合わさって振り切れる
      gainDb: -6,
      fx: { reverbType: 'cavern', reverbMix: 0.34, width: 1.5 },
    },
    lanes: [
      {
        vel: 74,
        gate: 7.5,
        steps: `
          F3+A3+C4 . . . . . . . | Eb3+G3+Bb3 . . . . . . .
          Db3+F3+Ab3 . . . . . . . | C3+Eb3+G3 . . . . . . .
        `,
      },
      {
        vel: 54,
        gate: 15,
        steps: `
          F2 . . . . . . . | . . . . . . . .
          Db2 . . . . . . . | . . . . . . . .
        `,
      },
    ],
  },
  {
    // 奇数倍音だけの音で、素朴な旋律をひとつ
    id: 'reedPath',
    instrument: 'hollowReed',
    bpm: 88,
    tweak: {
      mono: true,
      glide: 0.06,
      amp: { attack: 0.08, decay: 0.4, sustain: 0.9, release: 0.4 },
      fx: { reverbType: 'room', reverbMix: 0.2 },
    },
    lanes: [
      {
        vel: 92,
        gate: 0.92,
        steps: `
          G3 . A3 . | Bb3 - - . | A3 . G3 . | F3 - - .
          G3 . Bb3 . | C4 - - - | Bb3 . A3 . | G3 - - .
          D4 - . C4 | Bb3 - A3 . | G3 . F3 . | G3 - - -
          . . . . | Eb4! - - - | D4 - C4 - | Bb3 - - -
        `,
      },
    ],
  },
  {
    // 音程の定まらない金物を、疎らに置く
    id: 'bellHill',
    instrument: 'bellField',
    bpm: 66,
    stepsPerBeat: 2,
    tweak: { fx: { reverbType: 'cavern', reverbMix: 0.4, delayMix: 0.22, delayTime: 0.62, delayFeedback: 0.42 } },
    lanes: [
      {
        vel: 90,
        gate: 6,
        steps: `
          C4 . . . . . E4 . | . . G4 . . . . .
          A3 . . . . . . . | D4 . . . F4, . . .
          C4 . . . . . . . | . . B3 . . . . .
          E4 . . . G4 . . . | . . . . . . . .
        `,
      },
    ],
  },
  {
    // 土の音の、素直な四つ打ち
    id: 'earthPulse',
    instrument: 'drumField',
    bpm: 92,
    repeats: 8,
    tweak: { fx: { reverbType: 'room', reverbMix: 0.14 } },
    lanes: [
      { vel: 108, gate: 0.6, steps: `C2! . . . | . . C2, . | C2! . . . | . . . .` },
      { vel: 100, gate: 0.6, steps: `. . . . | D2! . . . | . . . . | D2! . . D2,` },
      { vel: 74, gate: 0.5, steps: `F#2 . F#2, . | F#2 . F#2, . | F#2 . F#2, . | F#2 . F#2 F#2,` },
      { vel: 84, gate: 0.8, steps: `. . . . | . . . . | . . . . | . . A#2 .` },
    ],
  },
  {
    // 落ちてくる雫のように、高いところから降りてくる
    id: 'raindrops',
    instrument: 'kotoStrings',
    bpm: 108,
    tweak: { fx: { reverbType: 'plate', reverbMix: 0.26, delayMix: 0.2, delayTime: 0.34, delayPingPong: true } },
    lanes: [
      {
        vel: 78,
        gate: 2.4,
        steps: `
          A5 . . E5 | . . C5 . | . A4 . . | E4 . . .
          G5 . . D5 | . . B4 . | . G4 . . | D4 . . .
          A5 . . E5 | . . C5 . | . A4 . . | . . . .
          F5 . . C5 | . . A4 . | F4 . . . | . . . .
        `,
      },
      {
        vel: 58,
        gate: 6,
        steps: `
          A2 . . . | . . . . | . . . . | . . . .
          G2 . . . | . . . . | . . . . | . . . .
          A2 . . . | . . . . | . . . . | . . . .
          F2 . . . | . . . . | . . . . | . . . .
        `,
      },
    ],
  },
  {
    // 疎らな高音に、長いディレイを効かせる
    id: 'stardust',
    instrument: 'steelHarp',
    bpm: 78,
    stepsPerBeat: 2,
    tweak: {
      fx: {
        reverbType: 'cavern',
        reverbMix: 0.36,
        delayMix: 0.34,
        delayTime: 0.72,
        delayFeedback: 0.52,
        delayPingPong: true,
        width: 1.4,
      },
    },
    lanes: [
      {
        vel: 72,
        gate: 4,
        steps: `
          E5 . . . B4 . . . | . . E5 . . . F#5 .
          . . . . C#5 . . . | A4 . . . . . . .
          B4 . . . F#5 . . . | . . B4 . . . C#6, .
          . . . . G#5 . . . | E5 . . . . . . .
        `,
      },
    ],
  },
  {
    // 深いところで鳴っている持続音。ほとんど動かない
    id: 'trench',
    instrument: 'mistPad',
    bpm: 52,
    stepsPerBeat: 1,
    tweak: {
      amp: { attack: 2.2, decay: 2, sustain: 0.95, release: 3.5 },
      filter: {
        mode: 'lowpass',
        freq: 900,
        q: 1.2,
        keyTrack: 0.2,
        envAmount: 1.4,
        env: { attack: 2.5, decay: 3, sustain: 0.7, release: 2 },
      },
      // 4声が最後まで重なったままなので、こちらも下げておく
      gainDb: -5,
      fx: { reverbType: 'cavern', reverbMix: 0.42, width: 1.6, modMode: 'autopan', modRate: 0.12, modDepth: 0.35 },
    },
    lanes: [
      { vel: 70, gate: 8, steps: `C2+G2 . . . . . . . | Bb1+F2 . . . . . . .` },
      { vel: 50, gate: 8, steps: `C3+Eb3 . . . . . . . | Bb2+D3 . . . . . . .` },
    ],
  },
  {
    // 祭りの手数。裏を詰めて前へ転がす
    id: 'festival',
    instrument: 'drumField',
    bpm: 132,
    repeats: 8,
    tweak: { fx: { reverbType: 'room', reverbMix: 0.18, width: 1.25 } },
    lanes: [
      { vel: 110, gate: 0.6, steps: `C2! . . C2, | . . C2 . | C2! . . . | . C2, . .` },
      { vel: 98, gate: 0.6, steps: `. . . . | D2! . . D2, | . . . . | D2! . D2, D2,` },
      { vel: 70, gate: 0.4, steps: `F#2 F#2, F#2 F#2, | F#2 F#2, F#2 F#2, | F#2 F#2, F#2 F#2, | F#2 F#2, F#2 F#2,` },
      { vel: 88, gate: 0.9, steps: `. . . . | . . . . | A#2 . . . | . . . .` },
      { vel: 80, gate: 0.7, steps: `. . E2 . | . . . . | . . E2 . | . E2, . .` },
      { vel: 92, gate: 1.2, steps: `. . . . | . . . . | . . . . | . . . C3!` },
    ],
  },
];
