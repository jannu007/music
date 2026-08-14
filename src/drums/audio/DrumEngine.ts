import processorUrl from './drum-processor.js?url';
import { createImpulseResponse } from './reverb';
import type { DelayDivision, MasterSettings, Pattern, Project, TrackConfig } from './types';

/** ワークレットに渡すシーケンサー状態（UI用の項目は含めない） */
function engineState(project: Project) {
  return {
    bpm: project.bpm,
    swing: project.swing,
    humanize: project.humanize,
    stepsPerBeat: project.stepsPerBeat,
    current: project.current,
    songMode: project.songMode,
    song: project.song,
    patterns: project.patterns,
    tracks: project.tracks.map(engineTrack),
  };
}

function engineTrack(t: TrackConfig) {
  return {
    id: t.id,
    type: t.type,
    variant: t.variant,
    choke: t.choke,
    params: t.params,
    mute: t.mute,
    solo: t.solo,
  };
}

/** 音符の長さ（秒）。ディレイをテンポに同期させるために使う */
export function divisionSeconds(division: DelayDivision, bpm: number): number {
  const beat = 60 / Math.max(20, bpm);
  switch (division) {
    case '1/16': return beat / 4;
    case '1/8T': return beat / 3;
    case '1/8': return beat / 2;
    case '1/8.': return beat * 0.75;
    case '1/4': return beat;
    default: return beat / 2;
  }
}

function saturationCurve(amount: number) {
  const n = 2048;
  const curve = new Float32Array(n);
  // ピークは 1 のまま、小さい音だけがわずかに持ち上がる程度に抑える
  // （k を大きくしすぎると全体が四角い波になり、書き出しが歪んだ音になる）
  const k = 0.5 + amount * 2.5;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

function limiterCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.25) / Math.tanh(1.25);
  }
  return curve;
}

/**
 * 音源ノード + ミックスバス（サチュレーション / EQ / バスコンプ / リバーブ / ディレイ）。
 * リアルタイム再生とオフライン書き出しで同じものを組み立てる。
 */
export class DrumChain {
  readonly ctx: BaseAudioContext;
  readonly node: AudioWorkletNode;
  readonly output: GainNode;

  private bus: GainNode;
  private shaper: WaveShaperNode;
  private lowShelf: BiquadFilterNode;
  private highShelf: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private master: GainNode;

  private convolver: ConvolverNode;
  private reverbReturn: GainNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private dampL: BiquadFilterNode;
  private dampR: BiquadFilterNode;
  private fbLL: GainNode;
  private fbLR: GainNode;
  private fbRR: GainNode;
  private fbRL: GainNode;
  private delayReturn: GainNode;

  private irCache = new Map<string, AudioBuffer>();
  private bpm = 120;

  constructor(ctx: BaseAudioContext, project: Project, options: Record<string, unknown> = {}) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'drum-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 3,
      outputChannelCount: [2, 2, 2],
      processorOptions: { state: engineState(project), ...options },
    });

    this.bus = ctx.createGain();
    // 14トラックを足し込むので、マスター前に十分な余裕を持たせる
    this.bus.gain.value = 0.62;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.lowShelf = ctx.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 160;
    this.highShelf = ctx.createBiquadFilter();
    this.highShelf.type = 'highshelf';
    this.highShelf.frequency.value = 4800;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = 24;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.18;

    const limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    limiter.oversample = '2x';

    this.master = ctx.createGain();
    this.output = ctx.createGain();
    // リミッター後に少し余裕を残す（書き出しが 0dBFS に張り付かないように）
    this.output.gain.value = 0.92;

    // --- リバーブ ---
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.reverbReturn = ctx.createGain();

    // --- ディレイ（ピンポン可能なクロスフィードバック） ---
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    this.delayL = ctx.createDelay(2.5);
    this.delayR = ctx.createDelay(2.5);
    this.dampL = ctx.createBiquadFilter();
    this.dampL.type = 'lowpass';
    this.dampL.frequency.value = 4200;
    this.dampR = ctx.createBiquadFilter();
    this.dampR.type = 'lowpass';
    this.dampR.frequency.value = 4200;
    this.fbLL = ctx.createGain();
    this.fbLR = ctx.createGain();
    this.fbRR = ctx.createGain();
    this.fbRL = ctx.createGain();
    this.delayReturn = ctx.createGain();

    this.node.connect(this.bus, 0);
    this.node.connect(this.convolver, 1);
    this.node.connect(splitter, 2);

    this.convolver.connect(this.reverbReturn).connect(this.bus);

    splitter.connect(this.delayL, 0);
    splitter.connect(this.delayR, 1);
    this.delayL.connect(this.dampL);
    this.delayR.connect(this.dampR);
    this.dampL.connect(this.fbLL).connect(this.delayL);
    this.dampL.connect(this.fbLR).connect(this.delayR);
    this.dampR.connect(this.fbRR).connect(this.delayR);
    this.dampR.connect(this.fbRL).connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);
    merger.connect(this.delayReturn).connect(this.bus);

    this.bus
      .connect(this.shaper)
      .connect(this.lowShelf)
      .connect(this.highShelf)
      .connect(this.comp)
      .connect(this.master)
      .connect(limiter)
      .connect(this.output);

    this.applyMaster(project.master, project.bpm);
  }

  applyMaster(m: MasterSettings, bpm: number) {
    this.bpm = bpm;
    this.shaper.curve = saturationCurve(m.drive);
    this.lowShelf.gain.value = m.low;
    this.highShelf.gain.value = m.high;
    this.comp.threshold.value = -4 - m.glue * 20;
    this.comp.ratio.value = 1.4 + m.glue * 4;
    this.master.gain.value = Math.pow(Math.max(0, Math.min(1, m.volume)), 1.3) * 1.6;

    const reverbOn = m.reverbType !== 'off';
    if (reverbOn) this.convolver.buffer = this.impulse(m.reverbType);
    this.reverbReturn.gain.value = reverbOn ? m.reverbMix * 1.6 : 0;

    const delayOn = m.delayDivision !== 'off';
    const time = divisionSeconds(m.delayDivision, bpm);
    // 再生中の時間変更は滑らかに、書き出し時は即座に反映する
    const live = !('startRendering' in this.ctx);
    const setTime = (node: DelayNode, value: number) => {
      if (live) node.delayTime.setTargetAtTime(value, this.ctx.currentTime, 0.02);
      else node.delayTime.value = value;
    };
    setTime(this.delayL, m.delayPingPong ? time * 0.5 : time);
    setTime(this.delayR, time);
    const fb = delayOn ? Math.min(0.85, m.delayFeedback) : 0;
    this.fbLL.gain.value = m.delayPingPong ? 0 : fb;
    this.fbRR.gain.value = m.delayPingPong ? 0 : fb;
    this.fbLR.gain.value = m.delayPingPong ? fb : 0;
    this.fbRL.gain.value = m.delayPingPong ? fb : 0;
    this.delayReturn.gain.value = delayOn ? m.delayMix * 1.3 : 0;
  }

  private impulse(type: MasterSettings['reverbType']): AudioBuffer | null {
    if (type === 'off') return null;
    let ir = this.irCache.get(type);
    if (!ir) {
      ir = createImpulseResponse(this.ctx, type);
      this.irCache.set(type, ir);
    }
    return ir;
  }

  post(msg: Record<string, unknown>) {
    this.node.port.postMessage(msg);
  }
}

export interface StepInfo {
  step: number;
  abs: number;
  pattern: number;
  slot: number;
  at: number;
}

/** ブラウザ再生用のエンジン */
export class DrumEngine {
  ctx: AudioContext | null = null;
  chain: DrumChain | null = null;
  analyser: AnalyserNode | null = null;
  playing = false;

  onStep: ((info: StepInfo) => void) | null = null;
  onMeters: ((peaks: number[]) => void) | null = null;

  private levelData = new Uint8Array(0);
  private ready = false;

  get isReady() {
    return this.ready;
  }

  async init(project: Project): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(processorUrl);

    const chain = new DrumChain(ctx, project);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    chain.output.connect(analyser);
    chain.output.connect(ctx.destination);

    chain.node.port.onmessage = (e) => {
      const data = e.data;
      if (data?.type === 'step') this.onStep?.(data as StepInfo);
      else if (data?.type === 'meters') this.onMeters?.(data.peaks);
    };

    this.ctx = ctx;
    this.chain = chain;
    this.analyser = analyser;
    this.levelData = new Uint8Array(analyser.fftSize);
    this.ready = true;
    await ctx.resume();
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  syncAll(project: Project) {
    this.chain?.post({ type: 'state', state: engineState(project) });
    this.chain?.applyMaster(project.master, project.bpm);
  }

  syncTracks(project: Project) {
    this.chain?.post({ type: 'tracks', tracks: project.tracks.map(engineTrack) });
  }

  syncPattern(index: number, pattern: Pattern) {
    this.chain?.post({ type: 'pattern', index, pattern });
  }

  syncTransport(project: Project) {
    this.chain?.post({
      type: 'transportParams',
      bpm: project.bpm,
      swing: project.swing,
      humanize: project.humanize,
      stepsPerBeat: project.stepsPerBeat,
      current: project.current,
      songMode: project.songMode,
      song: project.song,
    });
    this.chain?.applyMaster(project.master, project.bpm);
  }

  syncMaster(project: Project) {
    this.chain?.applyMaster(project.master, project.bpm);
  }

  play(startStep = 0) {
    this.playing = true;
    this.chain?.post({ type: 'transport', playing: true, startStep });
  }

  stop() {
    this.playing = false;
    this.chain?.post({ type: 'transport', playing: false });
  }

  hit(trackId: string, vel: number) {
    this.chain?.post({ type: 'hit', track: trackId, vel });
  }

  panic() {
    this.playing = false;
    this.chain?.post({ type: 'transport', playing: false });
    this.chain?.post({ type: 'panic' });
  }

  /** 0..1 のピークレベル（マスターメーター用） */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.levelData);
    let peak = 0;
    for (let i = 0; i < this.levelData.length; i++) {
      const v = Math.abs(this.levelData[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }
}

/** 書き出す長さ（ステップ数）。ソングモードなら曲全体、そうでなければパターン×繰り返し */
export function projectSteps(project: Project, loops: number): number {
  if (project.songMode && project.song.length > 0) {
    let total = 0;
    for (const slot of project.song) {
      const pattern = project.patterns[slot.pattern];
      if (!pattern) continue;
      total += pattern.length * Math.max(1, slot.repeats);
    }
    return Math.max(1, total) * Math.max(1, loops);
  }
  const pattern = project.patterns[project.current];
  return Math.max(1, pattern.length) * Math.max(1, loops);
}

export function projectSeconds(project: Project, loops: number): number {
  const steps = projectSteps(project, loops);
  return (steps * 60) / project.bpm / project.stepsPerBeat;
}

export interface RenderOptions {
  loops: number;
  /** 指定するとそのトラックだけを鳴らす（ステム書き出し） */
  soloTrack?: string | null;
  /** 末尾の余韻（秒） */
  tail?: number;
  sampleRate?: number;
}

/**
 * 演奏をオフラインで再合成する（WAV 書き出し用）。
 * シーケンサーがワークレット内にあるため、画面で聴いた演奏と同じ結果になる。
 */
export async function renderProject(
  project: Project,
  opts: RenderOptions
): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 48000;
  const tail = opts.tail ?? 2.5;
  const seconds = projectSeconds(project, opts.loops) + tail;
  const OfflineCtor: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, Math.ceil(seconds * sampleRate), sampleRate);
  await ctx.audioWorklet.addModule(processorUrl);

  const chain = new DrumChain(ctx, project, {
    autoStart: true,
    soloTrack: opts.soloTrack ?? null,
    // 確率・揺らぎを含む演奏でも書き出しを再現可能にする
    seed: 987654321,
  });
  chain.output.connect(ctx.destination);
  return ctx.startRendering();
}
