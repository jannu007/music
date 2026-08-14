import type { PianoEngine } from '../audio/PianoEngine';

/** 練習用メトロノーム（クリック音も合成、音源ファイルなし） */
export class Metronome {
  private engine: PianoEngine | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private beat = 0;
  bpm = 90;
  running = false;

  attach(engine: PianoEngine) {
    this.engine = engine;
  }

  setBpm(bpm: number) {
    this.bpm = Math.max(20, Math.min(280, bpm));
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
      this.click(ctx, this.nextTime, this.beat % 4 === 0);
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
    gain.gain.exponentialRampToValueAtTime(accent ? 0.18 : 0.11, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  }
}
