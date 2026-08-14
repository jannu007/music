import type { GuitarEngine } from '../audio/GuitarEngine';

/** 練習用メトロノーム（クリック音も合成、音源ファイルなし） */
export class Metronome {
  private engine: GuitarEngine | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private beat = 0;
  bpm = 100;
  beatsPerBar = 4;
  running = false;
  onBeat: ((beat: number, bar: number) => void) | null = null;

  attach(engine: GuitarEngine) {
    this.engine = engine;
  }

  setBpm(bpm: number) {
    this.bpm = Math.max(30, Math.min(280, bpm));
  }

  start(bpm?: number) {
    if (bpm) this.setBpm(bpm);
    const ctx = this.engine?.ctx;
    if (!ctx || this.running) return;
    this.running = true;
    this.beat = 0;
    this.nextTime = ctx.currentTime + 0.12;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule() {
    const ctx = this.engine?.ctx;
    if (!ctx || !this.running) return;
    const interval = 60 / this.bpm;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const beat = this.beat;
      const accent = beat % this.beatsPerBar === 0;
      this.click(ctx, this.nextTime, accent);
      if (this.onBeat) {
        const delay = Math.max(0, (this.nextTime - ctx.currentTime) * 1000);
        window.setTimeout(
          () => this.onBeat?.(beat % this.beatsPerBar, Math.floor(beat / this.beatsPerBar)),
          delay
        );
      }
      this.nextTime += interval;
      this.beat++;
    }
  }

  private click(ctx: AudioContext, time: number, accent: boolean) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1180;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.1, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  }
}

/** チューナー用の基準音（正弦波＋倍音を少し混ぜた聞き取りやすい音） */
export class ReferenceTone {
  private engine: GuitarEngine | null = null;
  private nodes: { osc: OscillatorNode; gain: GainNode }[] = [];

  attach(engine: GuitarEngine) {
    this.engine = engine;
  }

  play(freq: number, seconds = 2.2) {
    const ctx = this.engine?.ctx;
    if (!ctx) return;
    this.stop();
    const now = ctx.currentTime;
    for (const [mult, level] of [[1, 0.16], [2, 0.05], [3, 0.02]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + 0.02);
      gain.gain.setValueAtTime(level, now + seconds - 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + seconds + 0.05);
      this.nodes.push({ osc, gain });
    }
  }

  stop() {
    for (const { osc } of this.nodes) {
      try {
        osc.stop();
      } catch {
        /* すでに停止済みなら無視 */
      }
    }
    this.nodes = [];
  }
}
