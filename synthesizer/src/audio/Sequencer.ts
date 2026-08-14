/**
 * Akatsuki Synth — マルチトラック・シーケンサー
 *
 * 各トラックは AudioWorklet（mss-synth）1インスタンスで構成され、
 * ノートイベントは「絶対時刻付き」でワークレットに送られます。
 * そのため UI の負荷やガベージコレクションの影響を受けず、
 * サンプル単位で正確なタイミングで発音します。
 */
import type { AudioEngine } from './AudioEngine';
import type { Patch, SynthEvent } from './types';
import { clonePatch, getPreset, normalizePatch } from './presets';

export const PIANO_ROLL_MIN = 24; // C1
export const PIANO_ROLL_MAX = 96; // C7
export const STEPS_PER_BEAT = 4;  // 16分音符
export const STEPS_PER_BAR = STEPS_PER_BEAT * 4;
export const PATTERN_SLOTS = 4;

export interface SeqNote {
  step: number;
  pitch: number;
  length: number;   // ステップ数
  velocity: number; // 0..1
}

export interface Pattern {
  length: number;
  notes: SeqNote[];
}

export interface Scene {
  name: string;
  bars: number;
  patterns: Record<string, number>;
}

export function emptyPattern(length = 16): Pattern {
  return { length, notes: [] };
}

function makeWaveshaperCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k > 0 ? Math.tanh(x * (1 + k)) / Math.tanh(1 + k) : x;
  }
  return curve;
}

export class Track {
  id: string;
  name: string;
  patch: Patch;
  patterns: Pattern[] = [];
  activePattern = 0;
  muted = false;
  solo = false;
  volume = 0.85;
  pan = 0;
  peak = 0;
  voices = 0;

  node: AudioWorkletNode;
  private shaper: WaveShaperNode;
  private gain: GainNode;
  private panner: StereoPannerNode;
  private sendReverb: GainNode;
  private sendDelay: GainNode;
  private sendChorus: GainNode;
  private engine: AudioEngine;

  constructor(engine: AudioEngine, id: string, name: string, patch: Patch, events?: SynthEvent[]) {
    const ctx = engine.ctx;
    this.engine = engine;
    this.id = id;
    this.name = name;
    this.patch = patch;
    for (let i = 0; i < PATTERN_SLOTS; i++) this.patterns.push(emptyPattern());

    this.node = new AudioWorkletNode(ctx, 'mss-synth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { patch, bpm: engine.bpm, events },
    });
    this.node.port.onmessage = (e) => {
      if (e.data?.type === 'meter') {
        this.peak = e.data.peak;
        this.voices = e.data.voices;
      }
    };

    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.panner = ctx.createStereoPanner();
    this.sendReverb = ctx.createGain();
    this.sendDelay = ctx.createGain();
    this.sendChorus = ctx.createGain();

    this.node.connect(this.shaper);
    this.shaper.connect(this.gain);
    this.gain.connect(this.panner);
    this.panner.connect(engine.sumBus);
    this.panner.connect(this.sendReverb);
    this.panner.connect(this.sendDelay);
    this.panner.connect(this.sendChorus);
    this.sendReverb.connect(engine.reverbSend);
    this.sendDelay.connect(engine.delaySend);
    this.sendChorus.connect(engine.chorusSend);

    this.applyPatch(true);
  }

  get pattern(): Pattern {
    return this.patterns[this.activePattern] ?? this.patterns[0];
  }

  applyPatch(immediate = false) {
    const t = this.engine.ctx.currentTime;
    this.node.port.postMessage({ type: 'patch', patch: this.patch });
    this.shaper.curve = makeWaveshaperCurve(this.patch.fx.drive) as Float32Array<ArrayBuffer>;
    const set = (p: AudioParam, v: number) => {
      if (immediate) p.setValueAtTime(v, t);
      else p.setTargetAtTime(v, t, 0.02);
    };
    set(this.sendReverb.gain, this.patch.fx.reverb);
    set(this.sendDelay.gain, this.patch.fx.delay);
    set(this.sendChorus.gain, this.patch.fx.chorus);
  }

  setPatch(patch: Patch) {
    this.patch = patch;
    this.applyPatch();
  }

  setPreset(id: string) {
    const p = getPreset(id);
    p.pan = this.patch.pan;
    this.setPatch(p);
  }

  setTempo(bpm: number) {
    this.node.port.postMessage({ type: 'tempo', bpm });
  }

  setVolume(v: number) {
    this.volume = v;
    this.gain.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02);
  }

  setPan(p: number) {
    this.pan = p;
    this.panner.pan.setTargetAtTime(p, this.engine.ctx.currentTime, 0.02);
  }

  send(event: SynthEvent) {
    this.node.port.postMessage({ type: 'event', event });
  }

  sendBulk(events: SynthEvent[]) {
    this.node.port.postMessage({ type: 'events', events });
  }

  noteOn(note: number, velocity: number, time: number) {
    this.send({ type: 'noteOn', note, velocity, time });
  }

  noteOff(note: number, time: number) {
    this.send({ type: 'noteOff', note, time });
  }

  allNotesOff() {
    this.node.port.postMessage({ type: 'panic' });
  }

  setBend(value: number) {
    this.node.port.postMessage({ type: 'bend', value });
  }

  setMod(value: number) {
    this.node.port.postMessage({ type: 'mod', value });
  }

  setSustain(on: boolean) {
    this.node.port.postMessage({ type: 'sustain', value: on });
  }

  toggleNote(step: number, pitch: number, length: number, velocity: number): boolean {
    const pat = this.pattern;
    const idx = pat.notes.findIndex((n) => n.pitch === pitch && step >= n.step && step < n.step + n.length);
    if (idx >= 0) {
      pat.notes.splice(idx, 1);
      return false;
    }
    pat.notes.push({ step, pitch, length, velocity });
    pat.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
    return true;
  }

  dispose() {
    this.allNotesOff();
    this.node.port.postMessage({ type: 'dispose' });
    this.node.disconnect();
    this.shaper.disconnect();
    this.gain.disconnect();
    this.panner.disconnect();
    this.sendReverb.disconnect();
    this.sendDelay.disconnect();
    this.sendChorus.disconnect();
  }
}

const LOOKAHEAD_MS = 20;
const SCHEDULE_AHEAD = 0.15;

export type PlayMode = 'pattern' | 'song';

export class Sequencer {
  engine: AudioEngine;
  tracks: Track[] = [];
  scenes: Scene[] = [{ name: 'A', bars: 4, patterns: {} }];
  bpm = 120;
  swing = 0;
  playing = false;
  mode: PlayMode = 'pattern';
  metronome = false;
  loopBars = 0; // 0 = パターン長に従う

  onStep: ((tick: number) => void) | null = null;
  onSceneChange: ((index: number) => void) | null = null;

  private timer: number | null = null;
  private nextStepTime = 0;
  private tick = 0;
  private trackCounter = 0;
  private currentScene = -1;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  addTrack(presetId: string, name?: string): Track {
    this.trackCounter++;
    const id = `t${this.trackCounter}`;
    const t = new Track(this.engine, id, name ?? `Track ${this.trackCounter}`, getPreset(presetId));
    t.setTempo(this.bpm);
    this.tracks.push(t);
    for (const s of this.scenes) if (s.patterns[id] === undefined) s.patterns[id] = 0;
    return t;
  }

  removeTrack(id: string) {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tracks[idx].dispose();
    this.tracks.splice(idx, 1);
    for (const s of this.scenes) delete s.patterns[id];
  }

  moveTrack(id: string, delta: number) {
    const idx = this.tracks.findIndex((t) => t.id === id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= this.tracks.length) return;
    const [t] = this.tracks.splice(idx, 1);
    this.tracks.splice(next, 0, t);
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
    this.engine.setTempo(bpm);
    for (const t of this.tracks) t.setTempo(bpm);
  }

  get stepDuration(): number {
    return 60 / this.bpm / STEPS_PER_BEAT;
  }

  get songLengthBars(): number {
    return this.scenes.reduce((s, sc) => s + Math.max(1, sc.bars), 0);
  }

  /** 指定 tick が属するシーンの index を返す */
  sceneAt(tick: number): number {
    if (this.scenes.length === 0) return -1;
    const totalTicks = this.songLengthBars * STEPS_PER_BAR;
    let t = totalTicks > 0 ? tick % totalTicks : 0;
    for (let i = 0; i < this.scenes.length; i++) {
      const len = Math.max(1, this.scenes[i].bars) * STEPS_PER_BAR;
      if (t < len) return i;
      t -= len;
    }
    return this.scenes.length - 1;
  }

  play(fromTick = 0) {
    if (this.playing) return;
    this.playing = true;
    this.engine.resume();
    this.tick = fromTick;
    this.currentScene = -1;
    this.nextStepTime = this.engine.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    for (const t of this.tracks) t.allNotesOff();
    this.onStep?.(-1);
  }

  private schedulerTick() {
    const ctx = this.engine.ctx;
    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleTick(this.tick, this.nextStepTime);
      const dur = this.stepDuration;
      // スイング：偶数ステップを遅らせ、奇数ステップを詰める
      const swingShift = dur * this.swing * 0.34;
      this.nextStepTime += this.tick % 2 === 0 ? dur + swingShift : dur - swingShift;
      this.tick++;
    }
  }

  private scheduleTick(tick: number, time: number) {
    const dur = this.stepDuration;
    const anySolo = this.tracks.some((t) => t.solo);

    if (this.mode === 'song') {
      const sceneIdx = this.sceneAt(tick);
      if (sceneIdx !== this.currentScene) {
        this.currentScene = sceneIdx;
        const scene = this.scenes[sceneIdx];
        if (scene) {
          for (const t of this.tracks) {
            const p = scene.patterns[t.id];
            if (p !== undefined && p >= 0 && p < t.patterns.length) t.activePattern = p;
          }
        }
        const delay = Math.max(0, (time - this.engine.ctx.currentTime) * 1000);
        window.setTimeout(() => this.onSceneChange?.(sceneIdx), delay);
      }
    }

    for (const track of this.tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      const pat = track.pattern;
      if (!pat || pat.length <= 0) continue;
      const local = ((tick % pat.length) + pat.length) % pat.length;
      for (const note of pat.notes) {
        if (note.step !== local) continue;
        track.noteOn(note.pitch, note.velocity, time);
        if (track.patch.kind !== 'drum') {
          track.noteOff(note.pitch, time + Math.max(0.02, dur * note.length * 0.94));
        }
      }
    }

    if (this.metronome) this.clickAt(time, tick % STEPS_PER_BAR === 0, tick % STEPS_PER_BEAT === 0);

    const delay = Math.max(0, (time - this.engine.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.playing) this.onStep?.(tick);
    }, delay);
  }

  private clickAt(time: number, barStart: boolean, beat: boolean) {
    if (!beat) return;
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = barStart ? 1600 : 1050;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(barStart ? 0.22 : 0.12, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(g);
    g.connect(this.engine.masterGain);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  // ------------------------------------------------------------------
  // 保存 / 読込
  // ------------------------------------------------------------------
  toJSON() {
    return {
      format: 'akatsuki-synth',
      version: 2,
      bpm: this.bpm,
      swing: this.swing,
      mode: this.mode,
      master: this.engine.settings,
      scenes: this.scenes.map((s) => ({ ...s, patterns: { ...s.patterns } })),
      tracks: this.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        patch: t.patch,
        patterns: t.patterns,
        activePattern: t.activePattern,
        muted: t.muted,
        solo: t.solo,
        volume: t.volume,
        pan: t.pan,
      })),
    };
  }

  loadJSON(data: any) {
    this.stop();
    for (const t of [...this.tracks]) this.removeTrack(t.id);
    this.scenes = [];
    this.trackCounter = 0;

    this.setBpm(Number(data.bpm) || 120);
    this.swing = Number(data.swing) || 0;
    this.mode = data.mode === 'song' ? 'song' : 'pattern';
    if (data.master) this.engine.applySettings({ ...this.engine.settings, ...data.master });
    this.engine.rebuildReverb();

    const idMap = new Map<string, string>();
    for (const td of data.tracks ?? []) {
      const patch = normalizePatch(td.patch);
      this.trackCounter++;
      const id = `t${this.trackCounter}`;
      idMap.set(td.id ?? id, id);
      const track = new Track(this.engine, id, td.name ?? id, patch);
      track.setTempo(this.bpm);
      if (Array.isArray(td.patterns)) {
        // v2 形式（パターンスロット）
        for (let i = 0; i < PATTERN_SLOTS; i++) {
          const p = td.patterns[i];
          track.patterns[i] = p ? { length: p.length ?? 16, notes: p.notes ?? [] } : emptyPattern();
        }
      } else if (Array.isArray(td.pattern)) {
        // v1 形式（単一パターン）
        track.patterns[0] = {
          length: td.patternLength ?? 16,
          notes: td.pattern.map((n: any) => ({
            step: n.step ?? 0,
            pitch: n.pitch ?? 60,
            length: n.length ?? 1,
            velocity: n.velocity ?? 0.9,
          })),
        };
      }
      track.activePattern = Math.min(PATTERN_SLOTS - 1, Math.max(0, td.activePattern ?? 0));
      track.muted = !!td.muted;
      track.solo = !!td.solo;
      track.setVolume(td.volume ?? 0.85);
      track.setPan(td.pan ?? 0);
      this.tracks.push(track);
    }

    const scenes: Scene[] = [];
    for (const sc of data.scenes ?? []) {
      const patterns: Record<string, number> = {};
      for (const [oldId, value] of Object.entries(sc.patterns ?? {})) {
        const newId = idMap.get(oldId);
        if (newId) patterns[newId] = Number(value) || 0;
      }
      scenes.push({ name: sc.name ?? 'A', bars: Math.max(1, Number(sc.bars) || 4), patterns });
    }
    this.scenes = scenes.length > 0 ? scenes : [{ name: 'A', bars: 4, patterns: {} }];
    for (const s of this.scenes) for (const t of this.tracks) if (s.patterns[t.id] === undefined) s.patterns[t.id] = 0;
  }

  /** 現在の曲を複製用にディープコピー */
  snapshot(): string {
    return JSON.stringify(this.toJSON());
  }
}

/** シーケンスからノートイベント列（絶対時刻）を生成する。オフライン書き出し用。 */
export function collectEvents(
  seq: ReturnType<Sequencer['toJSON']>,
  totalTicks: number,
  startTime = 0
): Map<string, SynthEvent[]> {
  const result = new Map<string, SynthEvent[]>();
  const stepDur = 60 / seq.bpm / STEPS_PER_BEAT;
  const anySolo = seq.tracks.some((t) => t.solo);
  const sceneList = seq.scenes ?? [];
  const songTicks = sceneList.reduce((s, sc) => s + Math.max(1, sc.bars) * STEPS_PER_BAR, 0);

  const timeOfTick = (tick: number) => {
    // スイングを含む累積時間
    const pairs = Math.floor(tick / 2);
    const rest = tick % 2;
    return startTime + pairs * 2 * stepDur + rest * (stepDur + stepDur * seq.swing * 0.34);
  };

  for (const track of seq.tracks) {
    const events: SynthEvent[] = [];
    if (!track.muted && !(anySolo && !track.solo)) {
      let activePattern = track.activePattern ?? 0;
      for (let tick = 0; tick < totalTicks; tick++) {
        if (seq.mode === 'song' && songTicks > 0) {
          let t = tick % songTicks;
          for (const sc of sceneList) {
            const len = Math.max(1, sc.bars) * STEPS_PER_BAR;
            if (t < len) {
              const p = sc.patterns?.[track.id];
              if (p !== undefined) activePattern = p;
              break;
            }
            t -= len;
          }
        }
        const pat = track.patterns[activePattern] ?? track.patterns[0];
        if (!pat || pat.length <= 0) continue;
        const local = tick % pat.length;
        for (const note of pat.notes) {
          if (note.step !== local) continue;
          const time = timeOfTick(tick);
          events.push({ type: 'noteOn', note: note.pitch, velocity: note.velocity, time });
          if (track.patch.kind !== 'drum') {
            events.push({ type: 'noteOff', note: note.pitch, time: time + Math.max(0.02, stepDur * note.length * 0.94) });
          }
        }
      }
    }
    events.sort((a, b) => a.time - b.time);
    result.set(track.id, events);
  }
  return result;
}

export function clonePatchForTrack(p: Patch): Patch {
  return clonePatch(p);
}
