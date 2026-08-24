/*
 * パッド。
 *
 * 録音した演奏を1枚ずつ載せておき、押したら鳴る。実機のサンプラーの
 * パッドと同じで、載っているのは「音そのもの」——録音を先に焼いたもの。
 *
 * なぜ焼くのか。押した瞬間に鳴らないと楽器にならないが、演奏を composite し直すと
 * エフェクトまで含めて数百ミリ秒かかる。焼いてしまえば、押す＝波形を流すだけになる。
 * 音づくりを変えても、載せたときの音のまま残るのも、実機と同じふるまい。
 *
 * 同じパッドを続けて押したときは、前の音を止めてから鳴らし直す（リトリガー）。
 * 重ねると連打のたびに音が厚くなっていってしまうため。
 */

export interface PadSlot {
  slot: number;
  name: string;
  buffer: AudioBuffer;
}

/** パッドの数。4×4 は実機で見慣れた並び */
export const PAD_ROWS = 4;
export const PAD_COLUMNS = 4;
export const PAD_COUNT = PAD_ROWS * PAD_COLUMNS;

export class PadPlayer {
  readonly output: GainNode;
  private readonly pads = new Map<number, PadSlot>();
  /** いま鳴っている音。パッドごとに1つだけ持つ */
  private readonly playing = new Map<number, AudioBufferSourceNode>();

  constructor(private readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
  }

  set(slot: number, name: string, buffer: AudioBuffer) {
    this.pads.set(slot, { slot, name, buffer });
  }

  remove(slot: number) {
    this.stop(slot);
    this.pads.delete(slot);
  }

  get(slot: number): PadSlot | undefined {
    return this.pads.get(slot);
  }

  has(slot: number): boolean {
    return this.pads.has(slot);
  }

  /** 空いているいちばん若い番号。無ければ null */
  firstFree(): number | null {
    for (let i = 0; i < PAD_COUNT; i++) if (!this.pads.has(i)) return i;
    return null;
  }

  get count(): number {
    return this.pads.size;
  }

  /**
   * 鳴らす。すでにそのパッドが鳴っていれば、止めてから鳴らし直す。
   * 戻り値は音の長さ（秒）。画面の表示に使う
   */
  play(slot: number, when?: number): number {
    const pad = this.pads.get(slot);
    if (!pad) return 0;
    this.stop(slot);

    const source = this.ctx.createBufferSource();
    source.buffer = pad.buffer;
    source.connect(this.output);
    source.start(when ?? this.ctx.currentTime);
    source.onended = () => {
      // 自分がまだ現役のときだけ片付ける（鳴らし直された後なら触らない）
      if (this.playing.get(slot) === source) this.playing.delete(slot);
      try {
        source.disconnect();
      } catch {
        /* すでに切れていれば何もしなくてよい */
      }
    };
    this.playing.set(slot, source);
    return pad.buffer.duration;
  }

  stop(slot: number) {
    const source = this.playing.get(slot);
    if (!source) return;
    this.playing.delete(slot);
    try {
      source.stop();
    } catch {
      /* すでに止まっていれば何もしなくてよい */
    }
  }

  stopAll() {
    for (const slot of [...this.playing.keys()]) this.stop(slot);
  }

  /** そのパッドがいま鳴っているか */
  isPlaying(slot: number): boolean {
    return this.playing.has(slot);
  }
}

/**
 * パッドの色。
 *
 * 段ごとに色を変える。並びのどこを押しているかが、目を落とさなくても分かるように
 * （実機のパッドが段ごとに光り分けているのと同じ理由）。
 */
export const PAD_HUES = [168, 40, 320, 265];

export function padHue(slot: number): number {
  return PAD_HUES[Math.floor(slot / PAD_COLUMNS) % PAD_HUES.length];
}
