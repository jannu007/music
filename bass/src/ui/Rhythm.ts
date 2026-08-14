import type { BassEngine } from '../audio/BassEngine';

export interface RhythmPattern {
  id: string;
  name: string;
  /** 16分音符 16 ステップぶんの譜面（K=キック S=スネア h=ハイハット H=オープン . =休み） */
  steps: string;
  /** はねの量 0..1 */
  swing: number;
}

/**
 * 練習用のリズム。クリックもドラムも合成音なので音源ファイルは不要。
 */
export const PATTERNS: RhythmPattern[] = [
  { id: 'click', name: 'クリック', steps: 'C...c...c...c...', swing: 0 },
  { id: 'rock8', name: '8ビート', steps: 'Kh.hSh.hKhKhSh.h', swing: 0 },
  { id: 'rock16', name: '16ビート', steps: 'KhhhShhhKhhhShhh', swing: 0 },
  { id: 'shuffle', name: 'シャッフル', steps: 'K..h S..h K..h S..h'.replace(/ /g, ''), swing: 0.62 },
  { id: 'funk', name: 'ファンク', steps: 'K.hKS.hKh.hKSh.h', swing: 0.08 },
  { id: 'halftime', name: 'ハーフタイム', steps: 'Kh.h.h.hSh.h.hKh', swing: 0 },
  { id: 'latin', name: 'ラテン', steps: 'K.hHK.hHK.hHK.hH', swing: 0 },
];

/** メトロノームとドラムパターン（音はすべてその場で合成する） */
export class Rhythm {
  private engine: BassEngine | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private out: GainNode | null = null;

  bpm = 96;
  patternId = 'click';
  volume = 0.7;
  running = false;
  onStep: ((step: number) => void) | null = null;

  attach(engine: BassEngine) {
    this.engine = engine;
    if (engine.ctx && !this.out) {
      this.out = engine.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(engine.ctx.destination);
    }
  }

  setBpm(bpm: number) {
    this.bpm = Math.max(30, Math.min(260, bpm));
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.out) this.out.gain.value = this.volume;
  }

  setPattern(id: string) {
    this.patternId = id;
  }

  get pattern(): RhythmPattern {
    return PATTERNS.find((p) => p.id === this.patternId) ?? PATTERNS[0];
  }

  start(bpm?: number) {
    if (bpm) this.setBpm(bpm);
    const ctx = this.engine?.ctx;
    if (!ctx || this.running) return;
    this.attach(this.engine!);
    this.running = true;
    this.step = 0;
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

  toggle(bpm?: number) {
    if (this.running) this.stop();
    else this.start(bpm);
  }

  private schedule() {
    const ctx = this.engine?.ctx;
    if (!ctx || !this.running) return;
    const pattern = this.pattern;
    const sixteenth = 60 / this.bpm / 4;

    while (this.nextTime < ctx.currentTime + 0.25) {
      const index = this.step % 16;
      const symbol = pattern.steps[index] ?? '.';
      // はね（スウィング）: 裏の8分を後ろへずらす
      const swing = index % 2 === 1 ? pattern.swing * sixteenth * 0.62 : 0;
      const at = this.nextTime + swing;

      switch (symbol) {
        case 'K': this.kick(ctx, at); break;
        case 'S': this.snare(ctx, at); break;
        case 'h': this.hat(ctx, at, false); break;
        case 'H': this.hat(ctx, at, true); break;
        case 'C': this.click(ctx, at, true); break;
        case 'c': this.click(ctx, at, false); break;
      }
      if (this.onStep && index % 4 === 0) {
        const delay = Math.max(0, (at - ctx.currentTime) * 1000);
        const beat = index / 4;
        window.setTimeout(() => this.onStep?.(beat), delay);
      }

      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private get bus(): AudioNode | null {
    return this.out ?? this.engine?.ctx?.destination ?? null;
  }

  private click(ctx: AudioContext, time: number, accent: boolean) {
    const bus = this.bus;
    if (!bus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1180;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.13, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  private kick(ctx: AudioContext, time: number) {
    const bus = this.bus;
    if (!bus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // 打点で高い音から一気に下がる = バスドラムのアタック
    osc.frequency.setValueAtTime(115, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.75, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    osc.connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.4);
  }

  private snare(ctx: AudioContext, time: number) {
    const bus = this.bus;
    if (!bus) return;
    const noise = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    noise.buffer = buffer;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.4;

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(150, time + 0.08);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.3, time + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    noise.connect(band).connect(gain).connect(bus);
    body.connect(bodyGain).connect(bus);
    noise.start(time);
    body.start(time);
    body.stop(time + 0.15);
  }

  private hat(ctx: AudioContext, time: number, open: boolean) {
    const bus = this.bus;
    if (!bus) return;
    const decay = open ? 0.28 : 0.055;
    const len = Math.floor(ctx.sampleRate * (decay + 0.02));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, open ? 1.6 : 3.2);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const gain = ctx.createGain();
    gain.gain.value = open ? 0.16 : 0.13;
    noise.connect(hp).connect(gain).connect(bus);
    noise.start(time);
  }
}
