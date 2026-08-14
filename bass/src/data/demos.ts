import { findPosition, noteFrequency } from '../audio/fretboard';
import type { PerformanceEvent, Technique } from '../audio/types';

export interface Demo {
  id: string;
  title: string;
  style: string;
  note: string;
  presetId: string;
  bpm: number;
  /** 一緒に鳴らすと気持ちいいドラムパターン */
  rhythmId: string;
  build: (tuning: number[], a4: number) => PerformanceEvent[];
}

/** 再現性のある微小な揺らぎ（毎回同じ演奏になるよう固定シード） */
function humanizer(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const NOTE_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "E1" "A#1" "Gb2" → MIDIノート */
function parseNote(text: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(text.trim());
  if (!m) return null;
  const base = NOTE_OFFSET[m[1]];
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return base + accidental + (Number(m[3]) + 1) * 12;
}

const TECH_CODES: Record<string, Technique> = {
  f: 'finger',
  p: 'pick',
  s: 'slap',
  o: 'pop',
  m: 'mute',
  g: 'ghost',
  h: 'harmonic',
  n: 'hammer',
};

/**
 * ベースラインを組み立てる補助クラス。
 * 押さえる弦とフレットは、実際のベーシストと同じように
 * 「いま手がある位置」から選ぶので、開放弦や運指も自然になる。
 */
class Take {
  events: PerformanceEvent[] = [];
  private rand: () => number;
  private tuning: number[];
  private a4: number;
  private hand = 3;
  private sounding = new Map<number, number>();
  defaultTech: Technique = 'finger';

  constructor(tuning: number[], a4: number, seed: number, tech: Technique = 'finger') {
    this.tuning = tuning;
    this.a4 = a4;
    this.rand = humanizer(seed);
    this.defaultTech = tech;
  }

  /** 左手のポジション（この付近のフレットが選ばれる） */
  position(fret: number) {
    this.hand = fret;
    return this;
  }

  /** 1音置く。duration は「音を伸ばす長さ」（秒） */
  note(time: number, midi: number, duration: number, vel = 0.7, tech?: Technique) {
    const pos = findPosition(midi, this.tuning, this.hand);
    if (!pos) return this;
    const technique = tech ?? this.defaultTech;
    const jitter = (this.rand() - 0.5) * 0.011;
    const start = Math.max(0, time + jitter);
    const velocity = Math.max(0.08, Math.min(1, vel + (this.rand() - 0.5) * 0.09));

    // 同じ弦で前の音が鳴っていたら、その音は自然に消える（1本の弦は1音まで）
    this.stopString(pos.str, start - 0.004);

    this.events.push({
      time: start,
      type: 'pluck',
      str: pos.str,
      fret: pos.fret,
      note: midi,
      freq: noteFrequency(midi, this.a4),
      vel: velocity,
      tech: technique,
    });
    this.sounding.set(pos.str, start + Math.max(0.05, duration));
    this.events.push({
      time: start + Math.max(0.05, duration),
      type: 'mute',
      str: pos.str,
      amount: 1,
    });
    return this;
  }

  /** すでに置いたミュートを前倒ししない（重複を避ける） */
  private stopString(str: number, time: number) {
    const until = this.sounding.get(str);
    if (until === undefined || until <= time) return;
    this.sounding.delete(str);
    // 直後に弾き直すので、消音イベントは削っておく
    const idx = this.events.findIndex(
      (e) => e.type === 'mute' && e.str === str && Math.abs(e.time - until) < 1e-6
    );
    if (idx >= 0) this.events.splice(idx, 1);
  }

  /** スライド（前の音から滑らせる） */
  slideTo(time: number, midi: number, duration: number) {
    const pos = findPosition(midi, this.tuning, this.hand);
    if (!pos) return this;
    this.events.push({
      time,
      type: 'slide',
      str: pos.str,
      fret: pos.fret,
      note: midi,
      freq: noteFrequency(midi, this.a4),
      glide: Math.min(0.18, duration * 0.6),
    });
    this.sounding.set(pos.str, time + duration);
    this.events.push({ time: time + duration, type: 'mute', str: pos.str, amount: 1 });
    return this;
  }

  /**
   * 譜面文字列を並べる。
   *   "E1:1 G1:0.5 r:0.5 E2:1/o"
   *     音名:長さ（unit の倍数）  末尾 "!"=強め "~"=弱め "/x"=奏法
   * 返り値は次の音が始まる時刻。
   */
  seq(start: number, spec: string, unit: number, vel = 0.7, gate = 0.92): number {
    let time = start;
    for (const token of spec.trim().split(/\s+/)) {
      if (!token) continue;
      const [head, techCode] = token.split('/');
      let body = head;
      let accent = 1;
      while (body.endsWith('!') || body.endsWith('~')) {
        accent *= body.endsWith('!') ? 1.28 : 0.68;
        body = body.slice(0, -1);
      }
      const [nameRaw, lenRaw] = body.split(':');
      const len = (lenRaw ? Number(lenRaw) : 1) * unit;
      const name = nameRaw.trim();
      if (name === 'r' || name === 'R') {
        time += len;
        continue;
      }
      const midi = parseNote(name);
      if (midi === null) {
        time += len;
        continue;
      }
      const tech = techCode ? TECH_CODES[techCode] : undefined;
      // ゴーストノートは音程を持たないので短く切る
      const hold = tech === 'ghost' ? Math.min(len * 0.5, 0.12) : len * gate;
      this.note(time, midi, hold, Math.min(1, vel * accent), tech);
      time += len;
    }
    return time;
  }

  /** 演奏の最後に全部の弦を止める */
  finish(time: number) {
    this.events.push({ time, type: 'muteAll' });
    return this.events;
  }
}

/** 4分音符の長さ（秒） */
const beat = (bpm: number) => 60 / bpm;

export const DEMOS: Demo[] = [
  {
    id: 'rock8',
    title: 'ロック 8ビート',
    style: 'ピック弾き',
    note: 'ルート主体の8分。まずはこれが弾ければバンドで通用します',
    presetId: 'pickrock',
    bpm: 132,
    rhythmId: 'rock8',
    build: (tuning, a4) => {
      const u = beat(132) / 2; // 8分
      const t = new Take(tuning, a4, 11, 'pick').position(2);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'E1! E1 E1 E1 E1! E1 E1 E1', u, 0.78);
        time = t.seq(time, 'G1! G1 G1 G1 G1! G1 G1 G1', u, 0.78);
        time = t.seq(time, 'A1! A1 A1 A1 A1! A1 A1 A1', u, 0.78);
        time = t.seq(time, 'D2! D2 D2 D2 C2! C2 B1 B1', u, 0.78);
      }
      return t.finish(time + 0.4);
    },
  },
  {
    id: 'motown',
    title: 'モータウン風',
    style: '指弾き',
    note: '歌の隙間を埋めるように動く、ソウル／R&B の定番ライン',
    presetId: 'vintage',
    bpm: 116,
    rhythmId: 'rock8',
    build: (tuning, a4) => {
      const u = beat(116) / 2;
      const t = new Take(tuning, a4, 23, 'finger').position(3);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'C2! r:0.5 C2~ E2 G2 r:0.5 A2 G2', u, 0.72);
        time = t.seq(time, 'F1! r:0.5 F1~ A1 C2 r:0.5 D2 C2', u, 0.72);
        time = t.seq(time, 'G1! r:0.5 G1~ B1 D2 r:0.5 E2 D2', u, 0.72);
        time = t.seq(time, 'C2! r:0.5 C2~ E2 G2 A2 G2 E2', u, 0.72);
      }
      return t.finish(time + 0.5);
    },
  },
  {
    id: 'walking',
    title: 'ウォーキング・ジャズ',
    style: '4ビート',
    note: 'II-V-I を歩き回る4分音符。ゴーストノートで推進力を出しています',
    presetId: 'jazz',
    bpm: 138,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      const u = beat(138);
      const t = new Take(tuning, a4, 37, 'finger').position(4);
      let time = 0;
      time = t.seq(time, 'D2! F2 A2 B2', u, 0.66, 0.6);
      time = t.seq(time, 'C2! E2 G2 A2', u, 0.66, 0.6);
      time = t.seq(time, 'F1! A1 C2 E2', u, 0.66, 0.6);
      time = t.seq(time, 'F1! G1 A1 B1', u, 0.66, 0.6);
      time = t.seq(time, 'E1! G1 B1 D2', u, 0.66, 0.6);
      time = t.seq(time, 'A1! C2 E2 G2', u, 0.66, 0.6);
      time = t.seq(time, 'D2! A1 F1 A1', u, 0.66, 0.6);
      time = t.seq(time, 'D1! r:0.5 D1/g A1 C2', u, 0.66, 0.6);
      return t.finish(time + 0.6);
    },
  },
  {
    id: 'slapfunk',
    title: 'スラップ・ファンク',
    style: 'サム＆プル',
    note: '親指（スラップ）と人差し指（プル）、そして休符が主役の16ビート',
    presetId: 'slapfunk',
    bpm: 104,
    rhythmId: 'funk',
    build: (tuning, a4) => {
      const u = beat(104) / 4; // 16分
      const t = new Take(tuning, a4, 51, 'slap').position(2);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'E1!:2/s E1:1/g E2:1/o r:1 E1:1/s E1:1/g G2:2/o', u, 0.86);
        time = t.seq(time, 'r:1 E1:1/g E1:2/s D2:2/o r:1 E1:1/g A1:2/s', u, 0.86);
        time = t.seq(time, 'G1!:2/s G1:1/g G2:1/o r:1 G1:1/s F1:1/g F2:2/o', u, 0.86);
        time = t.seq(time, 'A1!:2/s A1:1/g A2:2/o r:1 G1:1/s E1:2/s r:1', u, 0.86);
      }
      return t.finish(time + 0.5);
    },
  },
  {
    id: 'disco',
    title: 'ディスコ・オクターブ',
    style: '指弾き',
    note: 'ルートとオクターブ上を行き来する、踊れる8分のライン',
    presetId: 'modern',
    bpm: 122,
    rhythmId: 'rock16',
    build: (tuning, a4) => {
      const u = beat(122) / 2;
      const t = new Take(tuning, a4, 67, 'finger').position(5);
      let time = 0;
      const bar = (low: string, high: string) => {
        time = t.seq(time, `${low}! ${high} ${low} ${high} ${low}! ${high} ${low} ${high}`, u, 0.74, 0.55);
      };
      for (let rep = 0; rep < 2; rep++) {
        bar('A1', 'A2');
        bar('D2', 'D3');
        bar('F1', 'F2');
        bar('G1', 'G2');
      }
      return t.finish(time + 0.4);
    },
  },
  {
    id: 'reggae',
    title: 'レゲエ／ダブ',
    style: 'ミュート',
    note: '1拍目を抜いた、うねる低音。音の隙間そのものがグルーヴになります',
    presetId: 'dub',
    bpm: 76,
    rhythmId: 'halftime',
    build: (tuning, a4) => {
      const u = beat(76) / 4;
      const t = new Take(tuning, a4, 83, 'finger').position(3);
      let time = 0;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, 'r:2 A1!:2 C2:2 D2:4 r:2 A1:2 G1:2', u, 0.8, 0.8);
        time = t.seq(time, 'r:2 F1!:2 A1:2 C2:4 r:4 E1:2', u, 0.8, 0.8);
      }
      return t.finish(time + 0.8);
    },
  },
  {
    id: 'metal',
    title: 'メタル・ピック刻み',
    style: 'ピック弾き',
    note: '16分の高速ダウンピッキング。歪ませても輪郭が残ります',
    presetId: 'grind',
    bpm: 168,
    rhythmId: 'rock16',
    build: (tuning, a4) => {
      const u = beat(168) / 4;
      const t = new Take(tuning, a4, 97, 'pick').position(2);
      let time = 0;
      const drive = (n: string) => `${n}! ${n} ${n} ${n} ${n}! ${n} ${n} ${n} ${n}! ${n} ${n} ${n} ${n}! ${n} ${n} ${n}`;
      for (let rep = 0; rep < 2; rep++) {
        time = t.seq(time, drive('E1'), u, 0.85, 0.5);
        time = t.seq(time, drive('G1'), u, 0.85, 0.5);
        time = t.seq(time, drive('F1'), u, 0.85, 0.5);
        time = t.seq(time, 'D2!:2 D2:2 C2:2 C2:2 B1!:2 B1:2 A1:4', u, 0.9, 0.5);
      }
      return t.finish(time + 0.4);
    },
  },
  {
    id: 'blues',
    title: 'ブルース・シャッフル',
    style: '指弾き',
    note: '12小節のブルース進行を、はねたリズムで',
    presetId: 'vintage',
    bpm: 92,
    rhythmId: 'shuffle',
    build: (tuning, a4) => {
      const u = beat(92) / 2;
      const t = new Take(tuning, a4, 113, 'finger').position(3);
      let time = 0;
      const shuffle = (root: string, third: string, fifth: string, sixth: string) => {
        time = t.seq(time, `${root}! ${fifth} ${sixth} ${fifth} ${root}! ${fifth} ${sixth} ${fifth}`, u, 0.72, 0.62);
      };
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('D2', 'A2', 'B2', 'A2');
      shuffle('D2', 'A2', 'B2', 'A2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      shuffle('E2', 'B2', 'C#3', 'B2');
      shuffle('D2', 'A2', 'B2', 'A2');
      shuffle('A1', 'E2', 'F#2', 'E2');
      time = t.seq(time, 'E1! G1 A1 A#1 B1! r:1 E1:2', u, 0.78, 0.62);
      return t.finish(time + 0.6);
    },
  },
  {
    id: 'ballad',
    title: 'フレットレス・バラード',
    style: 'フレットレス',
    note: 'スライドで音程を繋ぐ、歌うようなライン',
    presetId: 'fretless',
    bpm: 68,
    rhythmId: 'click',
    build: (tuning, a4) => {
      const u = beat(68);
      const t = new Take(tuning, a4, 131, 'finger').position(5);
      let time = 0;
      t.note(time, 45, u * 1.6, 0.6);          // A2
      t.slideTo(time + u * 0.6, 47, u * 1.2);  // → B2
      time += u * 2;
      time = t.seq(time, 'E2:2 G2:1 A2:1', u, 0.6, 0.9);
      t.note(time, 41, u * 1.8, 0.62);         // F2
      t.slideTo(time + u * 0.9, 40, u * 1.1);  // → E2
      time += u * 2;
      time = t.seq(time, 'D2:2 C2:1 D2:1', u, 0.6, 0.9);
      time = t.seq(time, 'A1:2 E2:1 G2:1 A2:4', u, 0.62, 0.95);
      return t.finish(time + 1.2);
    },
  },
  {
    id: 'bossa',
    title: 'ボサノバ',
    style: '指弾き',
    note: 'ルートと5度だけで作る、ゆったりしたラテンの土台',
    presetId: 'jazz',
    bpm: 128,
    rhythmId: 'latin',
    build: (tuning, a4) => {
      const u = beat(128) / 2;
      const t = new Take(tuning, a4, 149, 'finger').position(3);
      let time = 0;
      const bar = (root: string, fifth: string) => {
        time = t.seq(time, `${root}!:3 ${fifth}:1 ${root}:2 ${fifth}:2`, u, 0.66, 0.75);
      };
      for (let rep = 0; rep < 2; rep++) {
        bar('D2', 'A1');
        bar('G1', 'D2');
        bar('C2', 'G1');
        bar('F1', 'C2');
      }
      return t.finish(time + 0.8);
    },
  },
];
