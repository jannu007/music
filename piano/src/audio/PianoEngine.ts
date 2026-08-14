import processorUrl from './piano-processor.js?url';
import { createImpulseResponse } from './reverb';
import { DEFAULT_SETTINGS, type PerformanceEvent, type PianoSettings } from './types';

/** ワークレットへそのまま渡すパラメータ名 */
const ENGINE_KEYS = [
  'brightness', 'decay', 'stringRes', 'unison', 'hammerNoise', 'releaseNoise',
  'velCurve', 'dynamics', 'a4', 'stretch', 'strikePos', 'maxVoices',
] as const;

type ScheduledEvent = PerformanceEvent & { atFrame: number };

function engineParams(s: PianoSettings): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of ENGINE_KEYS) values[key] = s[key];
  values.gain = 0.9;
  return values;
}

function softClipCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35);
  }
  return curve;
}

/**
 * 音源ノード + 響き（大屋根 / EQ / コンプ / リバーブ）の信号経路。
 * リアルタイム再生とオフライン書き出しの両方で同じものを組み立てる。
 */
export class PianoChain {
  readonly ctx: BaseAudioContext;
  readonly node: AudioWorkletNode;
  readonly output: GainNode;

  private lidFilter: BiquadFilterNode;
  private bodyLow: BiquadFilterNode;
  private presence: BiquadFilterNode;
  private toneShelf: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private dry: GainNode;
  private send: GainNode;
  private wet: GainNode;
  private convolver: ConvolverNode;
  private master: GainNode;
  private settings: PianoSettings = { ...DEFAULT_SETTINGS };
  private irCache = new Map<string, AudioBuffer>();

  constructor(ctx: BaseAudioContext, settings?: PianoSettings, events?: ScheduledEvent[]) {
    this.ctx = ctx;
    if (settings) this.settings = { ...settings };
    this.node = new AudioWorkletNode(ctx, 'piano-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        params: engineParams(this.settings),
        events: events ?? [],
      },
    });

    // --- 大屋根（開き具合）と響板のキャラクター ---
    this.lidFilter = ctx.createBiquadFilter();
    this.lidFilter.type = 'lowpass';
    this.lidFilter.Q.value = 0.6;

    this.bodyLow = ctx.createBiquadFilter();
    this.bodyLow.type = 'peaking';
    this.bodyLow.frequency.value = 165;
    this.bodyLow.Q.value = 0.8;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 2800;
    this.presence.Q.value = 0.9;

    this.toneShelf = ctx.createBiquadFilter();
    this.toneShelf.type = 'highshelf';
    this.toneShelf.frequency.value = 5200;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 2.0;
    this.comp.attack.value = 0.02;
    this.comp.release.value = 0.3;

    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    // 正規化を切ると残響のゲインがインパルス応答の長さに比例して暴れるため有効にする
    this.convolver.normalize = true;

    const limiter = ctx.createWaveShaper();
    limiter.curve = softClipCurve();
    limiter.oversample = '2x';

    this.master = ctx.createGain();
    this.output = ctx.createGain();

    this.node
      .connect(this.lidFilter)
      .connect(this.bodyLow)
      .connect(this.presence)
      .connect(this.toneShelf);

    this.toneShelf.connect(this.dry).connect(this.comp);
    this.toneShelf.connect(this.send).connect(this.convolver);
    this.convolver.connect(this.wet).connect(this.comp);

    this.comp.connect(this.master).connect(limiter).connect(this.output);

    this.applySettings(this.settings);
  }

  applySettings(next: PianoSettings) {
    this.settings = { ...next };
    const s = this.settings;

    this.node.port.postMessage({ type: 'params', values: engineParams(s) });

    // 大屋根：閉じるほど高域が落ち、低中域が持ち上がる
    const lid = Math.max(0, Math.min(1, s.lid));
    this.lidFilter.frequency.value = 1400 * Math.pow(14, lid);
    this.bodyLow.gain.value = (1 - lid) * 4.5;
    this.presence.gain.value = -2.5 + lid * 4.0;
    this.toneShelf.gain.value = s.tone * 7;

    const mix = Math.max(0, Math.min(1, s.reverbMix));
    const on = s.reverbType !== 'off';
    this.dry.gain.value = on ? 1 - mix * 0.32 : 1;
    this.send.gain.value = on ? mix : 0;
    this.wet.gain.value = on ? 1.0 : 0;
    if (on) this.convolver.buffer = this.impulse(s.reverbType);

    this.master.gain.value = Math.pow(Math.max(0, Math.min(1, s.volume)), 1.4) * 1.7;
  }

  private impulse(type: PianoSettings['reverbType']): AudioBuffer | null {
    if (type === 'off') return null;
    let ir = this.irCache.get(type);
    if (!ir) {
      ir = createImpulseResponse(this.ctx, type);
      this.irCache.set(type, ir);
    }
    return ir;
  }

  send_(msg: Record<string, unknown>) {
    this.node.port.postMessage(msg);
  }
}

async function loadWorklet(ctx: BaseAudioContext) {
  await ctx.audioWorklet.addModule(processorUrl);
}

/** ブラウザ再生用のエンジン */
export class PianoEngine {
  ctx: AudioContext | null = null;
  chain: PianoChain | null = null;
  analyser: AnalyserNode | null = null;
  voiceCount = 0;

  private settings: PianoSettings = { ...DEFAULT_SETTINGS };
  private levelData = new Uint8Array(0);
  private ready = false;

  get isReady() {
    return this.ready;
  }

  async init(): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    await loadWorklet(ctx);

    const chain = new PianoChain(ctx, this.settings);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    chain.output.connect(analyser);
    chain.output.connect(ctx.destination);

    chain.node.port.onmessage = (e) => {
      if (e.data?.type === 'status') this.voiceCount = e.data.voices;
    };

    this.ctx = ctx;
    this.chain = chain;
    this.analyser = analyser;
    this.levelData = new Uint8Array(analyser.fftSize);
    this.ready = true;
    chain.applySettings(this.settings);
    await ctx.resume();
  }

  updateSettings(next: PianoSettings) {
    this.settings = { ...next };
    this.chain?.applySettings(this.settings);
  }

  getSettings(): PianoSettings {
    return { ...this.settings };
  }

  noteOn(note: number, velocity: number) {
    this.chain?.send_({ type: 'note', note, vel: velocity });
  }

  noteOff(note: number) {
    this.chain?.send_({ type: 'off', note });
  }

  sustain(value: number) {
    this.chain?.send_({ type: 'sustain', value });
  }

  sostenuto(value: number) {
    this.chain?.send_({ type: 'sostenuto', value });
  }

  soft(value: number) {
    this.chain?.send_({ type: 'soft', value });
  }

  panic() {
    this.chain?.send_({ type: 'panic' });
  }

  /** オーディオクロック（秒） */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** サンプル精度で先読みスケジュールする（デモ再生・録音再生用） */
  schedule(ev: PerformanceEvent, atTime: number) {
    if (!this.ctx || !this.chain) return;
    const atFrame = Math.max(0, Math.round(atTime * this.ctx.sampleRate));
    this.chain.send_({ ...ev, atFrame });
  }

  /** 0..1 のピークレベル（メーター用） */
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

/**
 * 録音した演奏をオフラインで再合成する（WAV書き出し用）。
 * イベントはフレーム指定でワークレットに渡すため、実時間より速く、
 * かつリアルタイム再生と同じタイミングでレンダリングされる。
 */
export async function renderPerformance(
  events: PerformanceEvent[],
  settings: PianoSettings,
  durationSec: number,
  sampleRate = 48000
): Promise<AudioBuffer> {
  const total = Math.max(1, Math.ceil((durationSec + 0.05) * sampleRate));
  const OfflineCtor: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, total, sampleRate);
  await loadWorklet(ctx);

  const scheduled: ScheduledEvent[] = events.map((ev) => ({
    ...ev,
    atFrame: Math.max(0, Math.round(ev.time * sampleRate)),
  }));

  const chain = new PianoChain(ctx, settings, scheduled);
  chain.output.connect(ctx.destination);

  return ctx.startRendering();
}
