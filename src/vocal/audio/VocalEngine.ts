/*
 * 音の出口（信号経路とワークレットの管理）
 *
 * ボーカルと伴奏を別バスで処理し、ボーカルにはハイパス・EQ・コンプ・
 * ダブラー・ディレイ・リバーブという、実際のミックスと同じ順で通す。
 * 再生（AudioContext）と書き出し（OfflineAudioContext）で同じ経路を組む。
 */

import processorUrl from './vocal-processor.js?url';
import { createImpulseResponse } from './reverb';
import { PARAM_NAMES, type CompiledSong, type MixSettings, type VocalSettings } from './types';

export interface BusMute {
  vocal: boolean;
  accomp: boolean;
}

/** ワークレットに渡す演奏データ一式 */
export interface LoadPayload {
  times: Float32Array;
  values: Float32Array;
  curves: Uint8Array;
  offsets: Int32Array;
  accomp: CompiledSong['accomp'];
  startFrame: number;
  duration: number;
}

function buildPayload(compiled: CompiledSong, startFrame: number, duration?: number): LoadPayload {
  const packed = packAutomation(compiled);
  return {
    ...packed,
    accomp: compiled.accomp,
    startFrame,
    duration: duration ?? compiled.duration,
  };
}

/** ワークレットへ渡す形（転送可能な TypedArray）に詰め直す */
export function packAutomation(compiled: CompiledSong) {
  const params = compiled.automation.params;
  let total = 0;
  for (const p of params) total += p.times.length;

  const times = new Float32Array(total);
  const values = new Float32Array(total);
  const curves = new Uint8Array(total);
  const offsets = new Int32Array(params.length + 1);

  let at = 0;
  for (let i = 0; i < params.length; i++) {
    offsets[i] = at;
    const p = params[i];
    for (let k = 0; k < p.times.length; k++) {
      times[at] = p.times[k];
      values[at] = p.values[k];
      curves[at] = p.curves[k];
      at++;
    }
  }
  offsets[params.length] = at;
  return { times, values, curves, offsets };
}

function softClipCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
  }
  return curve;
}

/** 音源ノード + ミックスの信号経路 */
export class VocalChain {
  readonly ctx: BaseAudioContext;
  readonly node: AudioWorkletNode;
  readonly output: GainNode;

  private highpass: BiquadFilterNode;
  private lowMid: BiquadFilterNode;
  private presence: BiquadFilterNode;
  private air: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private vocalLevel: GainNode;
  private dry: GainNode;
  private doubleL: DelayNode;
  private doubleR: DelayNode;
  private doubleGainL: GainNode;
  private doubleGainR: GainNode;
  private panL: StereoPannerNode | null;
  private panR: StereoPannerNode | null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private delay: DelayNode;
  private delayFeedback: GainNode;
  private delaySend: GainNode;
  private reverbSend: GainNode;
  private convolver: ConvolverNode;
  private reverbReturn: GainNode;
  private accompTone: BiquadFilterNode;
  private accompLevel: GainNode;
  private master: GainNode;
  private irCache = new Map<string, AudioBuffer>();
  private bpm = 100;

  constructor(ctx: BaseAudioContext, settings: VocalSettings, bpm: number, load?: LoadPayload) {
    this.ctx = ctx;
    this.bpm = bpm;

    this.node = new AudioWorkletNode(ctx, 'vocal-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [1, 2],
      processorOptions: {
        layout: [...PARAM_NAMES],
        a4: settings.a4,
        load,
      },
    });

    // ------------------------------------------------------------ ボーカル
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.Q.value = 0.7;

    this.lowMid = ctx.createBiquadFilter();
    this.lowMid.type = 'peaking';
    this.lowMid.frequency.value = 320;
    this.lowMid.Q.value = 1.0;
    this.lowMid.gain.value = -1.5;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 3400;
    this.presence.Q.value = 0.9;

    this.air = ctx.createBiquadFilter();
    this.air.type = 'highshelf';
    this.air.frequency.value = 8500;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = 18;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.16;

    this.vocalLevel = ctx.createGain();
    this.dry = ctx.createGain();

    // ダブラー（少しずらして左右に重ねる＝重ね録り風の厚み）
    this.doubleL = ctx.createDelay(0.1);
    this.doubleL.delayTime.value = 0.019;
    this.doubleR = ctx.createDelay(0.1);
    this.doubleR.delayTime.value = 0.028;
    this.doubleGainL = ctx.createGain();
    this.doubleGainR = ctx.createGain();
    this.panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    if (typeof ctx.createOscillator === 'function') {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.27;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.0016;
      lfo.connect(lfoGain);
      lfoGain.connect(this.doubleL.delayTime);
      const lfo2Gain = ctx.createGain();
      lfo2Gain.gain.value = -0.0021;
      lfo.connect(lfo2Gain);
      lfo2Gain.connect(this.doubleR.delayTime);
      lfo.start();
      this.lfo = lfo;
      this.lfoGain = lfoGain;
    }

    this.delay = ctx.createDelay(2.5);
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.28;
    this.delaySend = ctx.createGain();

    this.reverbSend = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.reverbReturn = ctx.createGain();

    // ---------------------------------------------------------------- 伴奏
    this.accompTone = ctx.createBiquadFilter();
    this.accompTone.type = 'peaking';
    this.accompTone.frequency.value = 2600;
    this.accompTone.Q.value = 0.8;
    this.accompTone.gain.value = -2.2; // 歌の帯域を少し空ける
    this.accompLevel = ctx.createGain();

    const limiter = ctx.createWaveShaper();
    limiter.curve = softClipCurve();
    limiter.oversample = '2x';

    this.master = ctx.createGain();
    this.output = ctx.createGain();

    // ------------------------------------------------------------ 配線
    this.node.connect(this.highpass, 0);
    this.highpass
      .connect(this.lowMid)
      .connect(this.presence)
      .connect(this.air)
      .connect(this.comp)
      .connect(this.vocalLevel);

    this.vocalLevel.connect(this.dry).connect(this.master);

    this.vocalLevel.connect(this.doubleL).connect(this.doubleGainL);
    this.vocalLevel.connect(this.doubleR).connect(this.doubleGainR);
    if (this.panL && this.panR) {
      this.doubleGainL.connect(this.panL).connect(this.master);
      this.doubleGainR.connect(this.panR).connect(this.master);
      this.panL.pan.value = -0.85;
      this.panR.pan.value = 0.85;
    } else {
      this.doubleGainL.connect(this.master);
      this.doubleGainR.connect(this.master);
    }

    this.vocalLevel.connect(this.delaySend).connect(this.delay);
    this.delay.connect(this.delayFeedback).connect(this.delay);
    this.delay.connect(this.master);
    this.delay.connect(this.reverbSend);

    this.vocalLevel.connect(this.reverbSend).connect(this.convolver);
    this.convolver.connect(this.reverbReturn).connect(this.master);

    this.node.connect(this.accompTone, 1);
    this.accompTone.connect(this.accompLevel).connect(this.master);
    this.accompLevel.connect(this.reverbSend);

    this.master.connect(limiter).connect(this.output);

    this.applySettings(settings, bpm);
  }

  applySettings(settings: VocalSettings, bpm = this.bpm) {
    this.bpm = bpm;
    const m: MixSettings = settings.mix;

    this.node.port.postMessage({ type: 'params', a4: settings.a4 });

    this.highpass.frequency.value = 70 + m.lowCut * 90;
    this.presence.gain.value = 1.5 + m.tone * 4.5;
    this.air.gain.value = 1 + m.tone * 6;

    this.comp.threshold.value = -10 - m.comp * 20;
    this.comp.ratio.value = 1.6 + m.comp * 5;

    // ゲイン配分：既定値でリミッターの手前がピーク 0.8 前後に収まるよう合わせてある
    this.vocalLevel.gain.value = Math.pow(Math.max(0, m.vocalLevel), 1.3) * 0.95;
    this.dry.gain.value = 1;

    const dbl = m.doubler * 0.55;
    this.doubleGainL.gain.value = dbl;
    this.doubleGainR.gain.value = dbl;
    if (this.panL && this.panR) {
      const spread = 0.35 + m.width * 0.65;
      this.panL.pan.value = -spread;
      this.panR.pan.value = spread;
    }

    this.delay.delayTime.value = Math.min(2.4, (m.delayBeats * 60) / Math.max(30, bpm));
    this.delaySend.gain.value = m.delayMix * 0.7;
    this.delayFeedback.gain.value = 0.18 + m.delayMix * 0.3;

    const on = m.reverbType !== 'off';
    this.reverbSend.gain.value = on ? m.reverbMix * 1.1 : 0;
    this.reverbReturn.gain.value = on ? 1 : 0;
    if (on) this.convolver.buffer = this.impulse(m.reverbType);

    this.accompLevel.gain.value = Math.pow(Math.max(0, m.accompLevel), 1.3) * 1.05;
    this.master.gain.value = Math.pow(Math.max(0, m.volume), 1.3) * 0.9;
  }

  /** ステム書き出し用にバスを切る */
  setMute(mute: BusMute) {
    if (mute.vocal) this.vocalLevel.gain.value = 0;
    if (mute.accomp) this.accompLevel.gain.value = 0;
  }

  private impulse(type: MixSettings['reverbType']): AudioBuffer | null {
    if (type === 'off') return null;
    let ir = this.irCache.get(type);
    if (!ir) {
      ir = createImpulseResponse(this.ctx, type);
      this.irCache.set(type, ir);
    }
    return ir;
  }

  post(msg: Record<string, unknown>, transfer?: Transferable[]) {
    if (transfer && transfer.length) this.node.port.postMessage(msg, transfer);
    else this.node.port.postMessage(msg);
  }

  dispose() {
    try {
      this.lfo?.stop();
    } catch {
      /* 既に止まっている場合は無視 */
    }
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.output.disconnect();
  }
}

async function loadWorklet(ctx: BaseAudioContext) {
  await ctx.audioWorklet.addModule(processorUrl);
}

/** ブラウザ再生用のエンジン */
export class VocalEngine {
  ctx: AudioContext | null = null;
  chain: VocalChain | null = null;
  analyser: AnalyserNode | null = null;

  onPosition: ((time: number) => void) | null = null;
  onEnd: (() => void) | null = null;

  private ready = false;
  private levelData = new Uint8Array(0);
  private startedAt = 0;
  private playingFlag = false;
  private preroll = 0;

  get isReady() {
    return this.ready;
  }

  get isPlaying() {
    return this.playingFlag;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  async init(settings: VocalSettings, bpm: number): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    await loadWorklet(ctx);

    const chain = new VocalChain(ctx, settings, bpm);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    chain.output.connect(analyser);
    chain.output.connect(ctx.destination);

    chain.node.port.onmessage = (e) => {
      const data = e.data;
      if (data?.type === 'pos') this.onPosition?.(data.time);
      else if (data?.type === 'end') {
        this.playingFlag = false;
        this.onEnd?.();
      }
    };

    this.ctx = ctx;
    this.chain = chain;
    this.analyser = analyser;
    this.levelData = new Uint8Array(analyser.fftSize);
    this.ready = true;
    await ctx.resume();
  }

  updateSettings(settings: VocalSettings, bpm: number) {
    this.chain?.applySettings(settings, bpm);
  }

  /** コンパイル済みの曲を再生する（lead は先読みの余裕 秒） */
  play(compiled: CompiledSong, lead = 0.12) {
    if (!this.ctx || !this.chain) return;
    const startFrame = Math.round((this.ctx.currentTime + lead) * this.ctx.sampleRate);
    const payload = buildPayload(compiled, startFrame);
    this.startedAt = this.ctx.currentTime + lead;
    this.preroll = compiled.preroll;
    this.playingFlag = true;
    this.chain.post({ type: 'load', ...payload }, [
      payload.times.buffer,
      payload.values.buffer,
      payload.curves.buffer,
      payload.offsets.buffer,
    ]);
  }

  stop() {
    this.playingFlag = false;
    this.chain?.post({ type: 'stop' });
  }

  /** 1 拍目からの経過秒（助走の分を差し引いた、譜面上の位置） */
  elapsed(): number {
    if (!this.ctx || !this.playingFlag) return 0;
    return Math.max(0, this.ctx.currentTime - this.startedAt - this.preroll);
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

export interface RenderOptions {
  /** 書き出すバス */
  mute?: BusMute;
  sampleRate?: number;
  /** 末尾の余韻 秒 */
  tail?: number;
  /** ピークを -1dBFS に揃える */
  normalize?: boolean;
}

/** オフラインでレンダリングする（WAV 書き出し用。再生と同じ音になる） */
export async function renderSong(
  compiled: CompiledSong,
  settings: VocalSettings,
  bpm: number,
  options: RenderOptions = {}
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 48000;
  const tail = options.tail ?? 2.6;
  const total = Math.max(1, Math.ceil((compiled.duration + tail) * sampleRate));
  const OfflineCtor: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, total, sampleRate);
  await loadWorklet(ctx);

  // 曲データはコンストラクタ経由で渡す（postMessage だとレンダリング開始に間に合わない）
  const chain = new VocalChain(ctx, settings, bpm, buildPayload(compiled, 0, compiled.duration + tail));
  if (options.mute) chain.setMute(options.mute);
  chain.output.connect(ctx.destination);

  const buffer = await ctx.startRendering();
  if (options.normalize !== false) normalizePeak(buffer, 0.891);
  return buffer;
}

/** ピークを揃える（書き出しの音量を安定させる） */
function normalizePeak(buffer: AudioBuffer, target: number) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak < 1e-5) return;
  const gain = target / peak;
  if (gain > 8) return; // ほぼ無音のときは持ち上げない
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}
