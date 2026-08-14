import processorUrl from './bass-processor.js?url';
import { CABS, createImpulseResponse } from './reverb';
import { findTuning } from './fretboard';
import { DEFAULT_SETTINGS, type BassSettings, type PerformanceEvent } from './types';

type ScheduledEvent = PerformanceEvent & { atFrame: number };

/** ワークレット（弦の物理モデル）へ渡すパラメータ */
function engineParams(s: BassSettings): Record<string, unknown> {
  const tuning = findTuning(s.tuningId).notes;
  return {
    gain: 0.9,
    sustain: s.sustain,
    brightness: s.brightness,
    stiffness: s.stiffness,
    pluckPos: s.pluckPos,
    pickupNeck: s.pickupNeck,
    pickupBridge: s.pickupBridge,
    pickupBlend: s.pickupBlend,
    beat: s.beat,
    sympathetic: s.sympathetic,
    buzz: s.buzz,
    noise: s.noise,
    velCurve: s.velCurve,
    dynamics: s.dynamics,
    release: s.release,
    fretless: s.fretless ? 1 : 0,
    glide: s.glide,
    a4: s.a4,
    wah: s.wah,
    wahSens: s.wahSens,
    stringCount: tuning.length,
    tuning,
  };
}

/** 真空管らしい非対称なひずみカーブ */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + amount * 26;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // 上下で潰れ方を変えると、偶数次倍音が出て「太い歪み」になる
    const bias = x >= 0 ? 1 : 0.72;
    curve[i] = Math.tanh(x * k * bias) / Math.tanh(k);
  }
  return curve;
}

/**
 * 最終段のソフトリミッター。
 * しきい値より下は素通し（増幅も減衰もしない）で、そこから上だけをなめらかに天井 1.0 へ寄せる。
 * 常時かかるカーブにすると、クリーンな音にまで歪みが乗ってしまう。
 */
function limiterCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const threshold = 0.7;
  const range = 1 - threshold;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= threshold ? a : threshold + range * Math.tanh((a - threshold) / range);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

/**
 * 弦 → プリアンプ → 歪み → キャビネット → 空間系 の信号経路。
 * リアルタイム再生とオフライン書き出しで、まったく同じものを組み立てる。
 */
export class BassChain {
  readonly ctx: BaseAudioContext;
  readonly node: AudioWorkletNode;
  readonly output: GainNode;

  private input: GainNode;
  private pickupPeak: BiquadFilterNode;
  private pickupRoll: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private compMakeup: GainNode;

  // 歪みは低域と高域に分けてかける（低音は歪ませない＝実機のベース用歪みと同じ）
  private splitLow: BiquadFilterNode;
  private splitHigh: BiquadFilterNode;
  private cleanLow: GainNode;
  private shaper: WaveShaperNode;
  private driveGain: GainNode;
  private driveMix: GainNode;
  private driveSum: GainNode;

  private eqBass: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqTreble: BiquadFilterNode;

  private cabHigh: BiquadFilterNode;
  private cabLow: BiquadFilterNode;
  private cabBump: BiquadFilterNode;
  private cabMid: BiquadFilterNode;
  private cabPresence: BiquadFilterNode;

  private chorusDelayL: DelayNode;
  private chorusDelayR: DelayNode;
  private chorusLfo: OscillatorNode;
  private chorusDepth: GainNode;
  private chorusMix: GainNode;
  private merger: ChannelMergerNode;

  private mixBus: GainNode;
  private send: GainNode;
  private wet: GainNode;
  private convolver: ConvolverNode;
  private master: GainNode;

  private settings: BassSettings = { ...DEFAULT_SETTINGS };
  private irCache = new Map<string, AudioBuffer>();
  private started = false;

  constructor(ctx: BaseAudioContext, settings?: BassSettings, events?: ScheduledEvent[]) {
    this.ctx = ctx;
    if (settings) this.settings = { ...settings };

    this.node = new AudioWorkletNode(ctx, 'bass-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        params: engineParams(this.settings),
        events: events ?? [],
      },
    });

    this.input = ctx.createGain();

    // --- ピックアップのコイル共振（パッシブ楽器らしい 2〜3kHz の山）---
    this.pickupPeak = ctx.createBiquadFilter();
    this.pickupPeak.type = 'peaking';
    this.pickupPeak.frequency.value = 2400;
    this.pickupPeak.Q.value = 1.1;
    this.pickupRoll = ctx.createBiquadFilter();
    this.pickupRoll.type = 'lowpass';
    this.pickupRoll.frequency.value = 6000;
    this.pickupRoll.Q.value = 0.6;

    // --- コンプレッサー ---
    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = 18;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.18;
    this.compMakeup = ctx.createGain();

    // --- 歪み（低域はクリーンのまま通す）---
    this.splitLow = ctx.createBiquadFilter();
    this.splitLow.type = 'lowpass';
    this.splitLow.frequency.value = 140;
    this.splitLow.Q.value = 0.7;
    this.splitHigh = ctx.createBiquadFilter();
    this.splitHigh.type = 'highpass';
    this.splitHigh.frequency.value = 140;
    this.splitHigh.Q.value = 0.7;
    this.cleanLow = ctx.createGain();
    this.driveGain = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.driveMix = ctx.createGain();
    this.driveSum = ctx.createGain();

    // --- アンプのトーン ---
    this.eqBass = ctx.createBiquadFilter();
    this.eqBass.type = 'lowshelf';
    this.eqBass.frequency.value = 110;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.Q.value = 0.8;
    this.eqTreble = ctx.createBiquadFilter();
    this.eqTreble.type = 'highshelf';
    this.eqTreble.frequency.value = 2600;

    // --- キャビネット ---
    this.cabHigh = ctx.createBiquadFilter();
    this.cabHigh.type = 'highpass';
    this.cabHigh.Q.value = 0.7;
    this.cabBump = ctx.createBiquadFilter();
    this.cabBump.type = 'peaking';
    this.cabMid = ctx.createBiquadFilter();
    this.cabMid.type = 'peaking';
    this.cabPresence = ctx.createBiquadFilter();
    this.cabPresence.type = 'peaking';
    this.cabLow = ctx.createBiquadFilter();
    this.cabLow.type = 'lowpass';
    this.cabLow.Q.value = 0.8;

    // --- コーラス（左右で揺れをずらしてステレオ感を出す）---
    this.chorusDelayL = ctx.createDelay(0.05);
    this.chorusDelayL.delayTime.value = 0.012;
    this.chorusDelayR = ctx.createDelay(0.05);
    this.chorusDelayR.delayTime.value = 0.019;
    this.chorusLfo = ctx.createOscillator();
    this.chorusLfo.type = 'sine';
    this.chorusLfo.frequency.value = 0.55;
    this.chorusDepth = ctx.createGain();
    this.chorusDepth.gain.value = 0;
    this.chorusMix = ctx.createGain();
    this.merger = ctx.createChannelMerger(2);

    // --- 空間 ---
    this.mixBus = ctx.createGain();
    this.send = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;

    const limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    limiter.oversample = '2x';

    this.master = ctx.createGain();
    this.output = ctx.createGain();

    // ---- 配線 ----
    this.node.connect(this.input);
    this.input.connect(this.pickupPeak).connect(this.pickupRoll);
    this.pickupRoll.connect(this.comp).connect(this.compMakeup);

    // 低域はクリーンのまま、高域だけを歪ませて足し合わせる
    this.compMakeup.connect(this.splitLow).connect(this.cleanLow).connect(this.driveSum);
    this.compMakeup.connect(this.splitHigh);
    this.splitHigh.connect(this.driveMix).connect(this.driveSum);
    this.splitHigh.connect(this.driveGain).connect(this.shaper).connect(this.driveSum);

    this.driveSum.connect(this.eqBass).connect(this.eqMid).connect(this.eqTreble);
    this.eqTreble
      .connect(this.cabHigh)
      .connect(this.cabBump)
      .connect(this.cabMid)
      .connect(this.cabPresence)
      .connect(this.cabLow);

    // コーラス：原音に、揺れた遅延音を左右へ重ねる
    this.cabLow.connect(this.chorusDelayL).connect(this.merger, 0, 0);
    this.cabLow.connect(this.chorusDelayR).connect(this.merger, 0, 1);
    this.chorusLfo.connect(this.chorusDepth);
    this.chorusDepth.connect(this.chorusDelayL.delayTime);
    this.chorusDepth.connect(this.chorusDelayR.delayTime);
    this.merger.connect(this.chorusMix);

    this.cabLow.connect(this.mixBus);
    this.chorusMix.connect(this.mixBus);
    this.cabLow.connect(this.send).connect(this.convolver);
    this.convolver.connect(this.wet).connect(this.mixBus);

    this.mixBus.connect(this.master).connect(limiter).connect(this.output);

    this.applySettings(this.settings);
  }

  /** オシレーター（コーラスLFO）を動かす。再生開始時に一度だけ呼ぶ */
  start(when = 0) {
    if (this.started) return;
    this.started = true;
    try {
      this.chorusLfo.start(when);
    } catch {
      /* すでに動いている場合は無視 */
    }
  }

  applySettings(next: BassSettings) {
    this.settings = { ...next };
    const s = this.settings;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

    this.node.port.postMessage({ type: 'params', values: engineParams(s) });

    // ピックアップの共振：強いほどパッシブらしい鼻にかかった音になる
    const tone = clamp01(s.pickupTone);
    this.pickupPeak.gain.value = tone * 7 - 1;
    this.pickupRoll.frequency.value = 2600 + tone * 6500;

    // コンプレッサー
    const comp = clamp01(s.comp);
    this.comp.threshold.value = -6 - comp * 26;
    this.comp.ratio.value = 1.4 + comp * 7;
    this.compMakeup.gain.value = 1 + comp * 0.85;

    // 歪み：量に応じて入力を持ち上げ、素の音と混ぜる
    const drive = clamp01(s.drive);
    this.shaper.curve = driveCurve(drive);
    this.driveGain.gain.value = 0.6 + drive * 7;
    this.driveMix.gain.value = Math.max(0, 1 - drive * 1.25);
    this.cleanLow.gain.value = 1;
    this.driveSum.gain.value = 1 / (1 + drive * 0.9);
    this.splitLow.frequency.value = 90 + (1 - drive) * 90;
    this.splitHigh.frequency.value = this.splitLow.frequency.value;

    // アンプEQ
    this.eqBass.gain.value = s.ampBass * 12;
    this.eqMid.frequency.value = Math.max(150, Math.min(3000, s.ampMidFreq));
    this.eqMid.gain.value = s.ampMid * 12;
    this.eqTreble.gain.value = s.ampTreble * 12;

    // キャビネット
    const cab = CABS[s.cab] ?? CABS['4x10'];
    this.cabHigh.frequency.value = cab.highpass;
    this.cabLow.frequency.value = cab.lowpass;
    this.cabBump.frequency.value = cab.bump.freq;
    this.cabBump.gain.value = cab.bump.gain;
    this.cabBump.Q.value = cab.bump.q;
    this.cabMid.frequency.value = cab.mid.freq;
    this.cabMid.gain.value = cab.mid.gain;
    this.cabMid.Q.value = cab.mid.q;
    this.cabPresence.frequency.value = cab.presence.freq;
    this.cabPresence.gain.value = cab.presence.gain;
    this.cabPresence.Q.value = cab.presence.q;

    // コーラス
    const chorus = clamp01(s.chorus);
    this.chorusDepth.gain.value = chorus * 0.0035;
    this.chorusMix.gain.value = chorus * 0.75;

    // 残響
    const mix = clamp01(s.reverbMix);
    const on = s.reverbType !== 'off' && mix > 0.001;
    this.send.gain.value = on ? mix : 0;
    this.wet.gain.value = on ? 1.1 : 0;
    if (on) this.convolver.buffer = this.impulse(s.reverbType as Exclude<typeof s.reverbType, 'off'>);

    // 既定音量でピークが -3dBFS 前後に収まるよう調整してある。
    // リミッターはあくまで保険で、常時かかると音が潰れてしまう。
    this.master.gain.value = Math.pow(clamp01(s.volume), 1.4) * 1.05;
  }

  private impulse(type: Exclude<BassSettings['reverbType'], 'off'>): AudioBuffer | null {
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

async function loadWorklet(ctx: BaseAudioContext) {
  await ctx.audioWorklet.addModule(processorUrl);
}

/** ブラウザ再生用のエンジン */
export class BassEngine {
  ctx: AudioContext | null = null;
  chain: BassChain | null = null;
  analyser: AnalyserNode | null = null;
  voiceCount = 0;

  private settings: BassSettings = { ...DEFAULT_SETTINGS };
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

    const chain = new BassChain(ctx, this.settings);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    chain.output.connect(analyser);
    chain.output.connect(ctx.destination);
    chain.start(ctx.currentTime);

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

  updateSettings(next: BassSettings) {
    this.settings = { ...next };
    this.chain?.applySettings(this.settings);
  }

  getSettings(): BassSettings {
    return { ...this.settings };
  }

  pluck(str: number, freq: number, vel: number, tech: string, fret: number) {
    this.chain?.post({ type: 'pluck', str, freq, vel, tech, fret });
  }

  slide(str: number, freq: number, fret: number, glide?: number) {
    this.chain?.post({ type: 'slide', str, freq, fret, glide });
  }

  bend(str: number, freq: number) {
    this.chain?.post({ type: 'bend', str, freq });
  }

  mute(str: number, amount = 1) {
    this.chain?.post({ type: 'mute', str, amount });
  }

  muteAll() {
    this.chain?.post({ type: 'muteAll' });
  }

  panic() {
    this.chain?.post({ type: 'panic' });
  }

  /** オーディオクロック（秒） */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** サンプル精度で先読みスケジュールする（デモ再生・録音再生用） */
  schedule(ev: PerformanceEvent, atTime: number) {
    if (!this.ctx || !this.chain) return;
    const atFrame = Math.max(0, Math.round(atTime * this.ctx.sampleRate));
    this.chain.post({ ...ev, atFrame });
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
 * 実時間より速く、かつリアルタイム再生と同じタイミング・同じ音で書き出せる。
 */
export async function renderPerformance(
  events: PerformanceEvent[],
  settings: BassSettings,
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

  const chain = new BassChain(ctx, settings, scheduled);
  chain.output.connect(ctx.destination);
  chain.start(0);

  return ctx.startRendering();
}
