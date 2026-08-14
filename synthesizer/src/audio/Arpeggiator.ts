/**
 * Akatsuki Synth — アルペジエーター
 * 押さえている鍵盤から自動的にフレーズを生成します（ラッチ／スイング対応）。
 */
import type { ArpParams } from './types';

const LOOKAHEAD_MS = 20;
const SCHEDULE_AHEAD = 0.15;

export interface ArpTarget {
  now: () => number;
  noteOn: (note: number, velocity: number, time: number) => void;
  noteOff: (note: number, time: number) => void;
  allNotesOff: () => void;
}

export class Arpeggiator {
  params: ArpParams;
  private target: ArpTarget;
  private getTempo: () => number;
  private held: number[] = [];
  private latched: number[] = [];
  private sequence: number[] = [];
  private timer: number | null = null;
  private nextTime = 0;
  private index = 0;
  private step = 0;
  private velocity = 0.9;

  constructor(target: ArpTarget, getTempo: () => number, params: ArpParams) {
    this.target = target;
    this.getTempo = getTempo;
    this.params = params;
  }

  setTarget(target: ArpTarget) {
    this.stop();
    this.target = target;
  }

  get activeNotes(): number[] {
    return this.params.latch && this.held.length === 0 ? this.latched : this.held;
  }

  noteOn(note: number, velocity: number) {
    if (this.params.latch && this.held.length === 0 && this.latched.length > 0 && !this.latchExtend) {
      this.latched = [];
    }
    if (!this.held.includes(note)) this.held.push(note);
    if (this.params.latch) {
      if (!this.latched.includes(note)) this.latched.push(note);
    }
    this.velocity = velocity;
    this.rebuild();
    if (this.params.enabled) this.start();
  }

  private latchExtend = false;

  noteOff(note: number) {
    this.held = this.held.filter((n) => n !== note);
    this.rebuild();
    if (this.activeNotes.length === 0) {
      this.stop();
      this.target.allNotesOff();
    }
  }

  clearLatch() {
    this.latched = [];
    if (this.held.length === 0) {
      this.stop();
      this.target.allNotesOff();
    }
  }

  setEnabled(enabled: boolean) {
    this.params.enabled = enabled;
    if (!enabled) {
      this.stop();
      this.target.allNotesOff();
    } else if (this.activeNotes.length > 0) {
      this.start();
    }
  }

  private rebuild() {
    const notes = [...this.activeNotes];
    const sorted = [...notes].sort((a, b) => a - b);
    const octaves = Math.max(1, Math.min(4, this.params.octaves));
    const expanded: number[] = [];
    for (let o = 0; o < octaves; o++) for (const n of sorted) expanded.push(n + o * 12);

    switch (this.params.mode) {
      case 'down':
        this.sequence = expanded.slice().reverse();
        break;
      case 'updown':
        this.sequence = expanded.length > 2 ? expanded.concat(expanded.slice(1, -1).reverse()) : expanded;
        break;
      case 'order': {
        const ordered: number[] = [];
        for (let o = 0; o < octaves; o++) for (const n of notes) ordered.push(n + o * 12);
        this.sequence = ordered;
        break;
      }
      case 'chord':
      case 'random':
      case 'up':
      default:
        this.sequence = expanded;
        break;
    }
    if (this.index >= this.sequence.length) this.index = 0;
  }

  private start() {
    if (this.timer !== null) return;
    this.index = 0;
    this.step = 0;
    this.nextTime = this.target.now() + 0.05;
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private stepDuration(): number {
    return 60 / this.getTempo() / Math.max(1, this.params.rate);
  }

  private tick() {
    const now = this.target.now();
    while (this.nextTime < now + SCHEDULE_AHEAD) {
      const dur = this.stepDuration();
      if (this.sequence.length > 0) {
        const gate = Math.max(0.05, this.params.gate);
        if (this.params.mode === 'chord') {
          for (const note of this.sequence) {
            this.target.noteOn(note, this.velocity, this.nextTime);
            this.target.noteOff(note, this.nextTime + dur * gate);
          }
        } else {
          const idx = this.params.mode === 'random' ? Math.floor(Math.random() * this.sequence.length) : this.index;
          const note = this.sequence[idx % this.sequence.length];
          this.target.noteOn(note, this.velocity, this.nextTime);
          this.target.noteOff(note, this.nextTime + dur * gate);
          this.index = (this.index + 1) % this.sequence.length;
        }
      }
      const swingShift = dur * this.params.swing * 0.34;
      this.nextTime += this.step % 2 === 0 ? dur + swingShift : dur - swingShift;
      this.step++;
    }
  }

  dispose() {
    this.stop();
  }
}
