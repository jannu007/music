import processorUrl from './guitar-processor.js?url';
import {
  CABS,
  createBodyImpulse,
  createReverbImpulse,
  driveCurve,
  limiterCurve,
} from './cabinet';
import { findTuning } from '../music/tunings';
import { DEFAULT_SETTINGS, type GuitarSettings, type PerformanceEvent } from './types';

/** ワークレットへそのまま渡すパラメータ名 */
const ENGINE_KEYS = [
  'a4', 'capo', 'pickPos', 'pickHard', 'brightness', 'sustain', 'stiffness',
  'coupling', 'pickNoise', 'fretNoise', 'buzz', 'velCurve', 'spread',
] as const;

type ScheduledEvent = PerformanceEvent & { atFrame: number };

/** キャビネットは常に7段のフィルタで構成し、係数だけ差し替える */
const CAB_BANDS = 7;
/** フェイザーの段数 */
const PHASER_STAGES = 4;

interface AmpSpec {
  label: string;
  /** 歪む前に低域を削る（ブーミーな潰れ方を防ぐ） */
  preHP: number;
  /** 歪む前のミッド強調（アンプのキャラクター） */
  preMid: { f: number; q: number; g: number };
  /** 歪んだ後のローパス */
  postLP: number;
  bassF: number;
  midF: number;
  midQ: number;
  trebF: number;
  presF: number;
  /** 歪みへの入力ゲイン倍率 */
  drive: number;
  /** 出力の補正 */
  makeup: number;
}

export const AMPS: Record<string, AmpSpec> = {
  off: {
    label: 'アンプなし（生音）',
    preHP: 45, preMid: { f: 800, q: 0.7, g: 0 }, postLP: 16000,
    bassF: 120, midF: 800, midQ: 0.8, trebF: 4000, presF: 7500, drive: 1.0, makeup: 1.0,
  },
  clean: {
    label: 'クリーン',
    preHP: 70, preMid: { f: 800, q: 0.7, g: 0 }, postLP: 9000,
    bassF: 100, midF: 650, midQ: 0.8, trebF: 3000, presF: 5000, drive: 1.2, makeup: 0.95,
  },
  tweed: {
    label: 'ツイード',
    preHP: 110, preMid: { f: 700, q: 1.0, g: 4 }, postLP: 6500,
    bassF: 120, midF: 600, midQ: 0.9, trebF: 2800, presF: 4200, drive: 2.4, makeup: 0.78,
  },
  british: {
    label: 'ブリティッシュ',
    preHP: 130, preMid: { f: 1100, q: 1.2, g: 5 }, postLP: 7000,
    bassF: 130, midF: 800, midQ: 1.0, trebF: 3200, presF: 5200, drive: 3.4, makeup: 0.68,
  },
  modern: {
    label: 'モダンハイゲイン',
    preHP: 160, preMid: { f: 450, q: 1.4, g: -4 }, postLP: 6000,
    bassF: 90, midF: 500, midQ: 1.2, trebF: 3600, presF: 6000, drive: 5.5, makeup: 0.55,
  },
  bassamp: {
    label: 'ベースアンプ',
    preHP: 35, preMid: { f: 250, q: 0.9, g: 2 }, postLP: 5000,
    bassF: 70, midF: 400, midQ: 0.9, trebF: 2200, presF: 3500, drive: 1.5, makeup: 0.85,
  },
};

function engineParams(s: GuitarSettings, wound: number): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of ENGINE_KEYS) values[key] = s[key];
  values.wound = wound;
  values.gain = 0.9;
  return values;
}

/**
 * 音源ノード + ボディ + アンプ + 空間系の信号経路。
 * リアルタイム再生とオフライン書き出しの両方で、まったく同じものを組み立てる。
 */
export class GuitarChain {
  readonly ctx: BaseAudioContext;
  readonly node: AudioWorkletNode;
  readonly output: GainNode;

  // ボディ（アコースティックの胴鳴り）
  private bodyDry: GainNode;
  private bodySend: GainNode;
  private bodyWet: GainNode;
  private bodyConv: ConvolverNode;
  private bodySum: GainNode;

  // アンプ
  private comp: DynamicsCompressorNode;
  private preHP: BiquadFilterNode;
  private preMid: BiquadFilterNode;
  private driveIn: GainNode;
  private shaper: WaveShaperNode;
  private postLP: BiquadFilterNode;
  private makeup: GainNode;
  private eqBass: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqTreble: BiquadFilterNode;
  private eqPresence: BiquadFilterNode;
  private cab: BiquadFilterNode[] = [];

  // モジュレーション
  private modIn: GainNode;
  private modOut: GainNode;
  private modDry: GainNode;
  private lfo: OscillatorNode;
  private lfoGainChorus: GainNode;
  private lfoGainPhaser: GainNode;
  private lfoGainTrem: GainNode;
  private lfoGainWah: GainNode;
  private lfoOffsetTrem: ConstantSourceNode;
  private chorusA: DelayNode;
  private chorusB: DelayNode;
  private chorusGain: GainNode;
  private phaserStages: BiquadFilterNode[] = [];
  private phaserGain: GainNode;
  private tremGain: GainNode;
  private tremOut: GainNode;
  private wah: BiquadFilterNode;
  private wahOut: GainNode;

  // 空間系
  private delayNode: DelayNode;
  private delayFb: GainNode;
  private delayTone: BiquadFilterNode;
  private delayWet: GainNode;
  private revSend: GainNode;
  private revWet: GainNode;
  private revConv: ConvolverNode;
  private preMaster: GainNode;
  private master: GainNode;

  private settings: GuitarSettings = { ...DEFAULT_SETTINGS };
  private tuning: number[];
  private irCache = new Map<string, AudioBuffer>();
  private curveCache = new Map<string, ReturnType<typeof driveCurve>>();

  constructor(
    ctx: BaseAudioContext,
    tuning: number[],
    settings?: GuitarSettings,
    events?: ScheduledEvent[]
  ) {
    this.ctx = ctx;
    this.tuning = [...tuning];
    if (settings) this.settings = { ...settings };
    const wound = findTuning(this.settings.tuningId).wound;

    this.node = new AudioWorkletNode(ctx, 'guitar-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        params: engineParams(this.settings, wound),
        tuning: this.tuning,
        events: events ?? [],
      },
    });

    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.707) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };

    // ---------- ボディ（胴鳴り） ----------
    this.bodyDry = gain(1);
    this.bodySend = gain(0);
    this.bodyWet = gain(1);
    this.bodyConv = ctx.createConvolver();
    this.bodyConv.normalize = true;
    this.bodySum = gain(1);

    this.node.connect(this.bodyDry).connect(this.bodySum);
    this.node.connect(this.bodySend).connect(this.bodyConv);
    this.bodyConv.connect(this.bodyWet).connect(this.bodySum);

    // ---------- アンプ ----------
    this.comp = ctx.createDynamicsCompressor();
    this.preHP = filter('highpass', 70, 0.7);
    this.preMid = filter('peaking', 800, 1.0);
    this.driveIn = gain(1);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.postLP = filter('lowpass', 9000, 0.7);
    this.makeup = gain(1);
    this.eqBass = filter('lowshelf', 110);
    this.eqMid = filter('peaking', 650, 0.8);
    this.eqTreble = filter('highshelf', 3000);
    this.eqPresence = filter('peaking', 5000, 1.1);

    this.bodySum
      .connect(this.comp)
      .connect(this.preHP)
      .connect(this.preMid)
      .connect(this.driveIn)
      .connect(this.shaper)
      .connect(this.postLP)
      .connect(this.makeup)
      .connect(this.eqBass)
      .connect(this.eqMid)
      .connect(this.eqTreble)
      .connect(this.eqPresence);

    let cabTail: AudioNode = this.eqPresence;
    for (let i = 0; i < CAB_BANDS; i++) {
      const f = filter('peaking', 1000, 1);
      f.gain.value = 0;
      cabTail.connect(f);
      cabTail = f;
      this.cab.push(f);
    }

    // ---------- モジュレーション ----------
    this.modIn = gain(1);
    this.modOut = gain(1);
    this.modDry = gain(1);
    cabTail.connect(this.modIn);
    this.modIn.connect(this.modDry).connect(this.modOut);

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 1.2;
    this.lfoGainChorus = gain(0);
    this.lfoGainPhaser = gain(0);
    this.lfoGainTrem = gain(0);
    this.lfoGainWah = gain(0);
    this.lfo.connect(this.lfoGainChorus);
    this.lfo.connect(this.lfoGainPhaser);
    this.lfo.connect(this.lfoGainTrem);
    this.lfo.connect(this.lfoGainWah);

    // コーラス / ビブラート：2本の可変ディレイ
    this.chorusA = ctx.createDelay(0.06);
    this.chorusA.delayTime.value = 0.018;
    this.chorusB = ctx.createDelay(0.06);
    this.chorusB.delayTime.value = 0.024;
    this.chorusGain = gain(0);
    const chorusInvert = gain(-1);
    this.lfoGainChorus.connect(this.chorusA.delayTime);
    this.lfoGainChorus.connect(chorusInvert).connect(this.chorusB.delayTime);
    const chorusPanL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const chorusPanR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.modIn.connect(this.chorusA);
    this.modIn.connect(this.chorusB);
    if (chorusPanL && chorusPanR) {
      chorusPanL.pan.value = -0.6;
      chorusPanR.pan.value = 0.6;
      this.chorusA.connect(chorusPanL).connect(this.chorusGain);
      this.chorusB.connect(chorusPanR).connect(this.chorusGain);
    } else {
      this.chorusA.connect(this.chorusGain);
      this.chorusB.connect(this.chorusGain);
    }
    this.chorusGain.connect(this.modOut);

    // フェイザー：オールパスを4段、LFOで周波数を揺らす
    this.phaserGain = gain(0);
    let phaserTail: AudioNode = this.modIn;
    for (let i = 0; i < PHASER_STAGES; i++) {
      const ap = filter('allpass', 400 * Math.pow(2.4, i), 0.7);
      this.lfoGainPhaser.connect(ap.frequency);
      phaserTail.connect(ap);
      phaserTail = ap;
      this.phaserStages.push(ap);
    }
    phaserTail.connect(this.phaserGain).connect(this.modOut);

    // トレモロ：音量をLFOで揺らす
    this.tremGain = gain(1);
    this.tremOut = gain(0);
    this.lfoOffsetTrem = ctx.createConstantSource();
    this.lfoOffsetTrem.offset.value = 0;
    this.tremGain.gain.value = 0;
    this.lfoOffsetTrem.connect(this.tremGain.gain);
    this.lfoGainTrem.connect(this.tremGain.gain);
    this.modIn.connect(this.tremGain).connect(this.tremOut).connect(this.modOut);

    // ワウ：バンドパスの中心周波数をLFOで動かす
    this.wah = filter('bandpass', 900, 3.2);
    this.wahOut = gain(0);
    this.lfoGainWah.connect(this.wah.frequency);
    this.modIn.connect(this.wah).connect(this.wahOut).connect(this.modOut);

    // ---------- ディレイ ----------
    this.delayNode = ctx.createDelay(2.5);
    this.delayNode.delayTime.value = 0.36;
    this.delayFb = gain(0);
    this.delayTone = filter('lowpass', 3200, 0.7);
    this.delayWet = gain(0);
    this.modOut.connect(this.delayNode);
    this.delayNode.connect(this.delayTone).connect(this.delayFb).connect(this.delayNode);
    this.delayNode.connect(this.delayWet);

    // ---------- リバーブ ----------
    this.preMaster = gain(1);
    this.modOut.connect(this.preMaster);
    this.delayWet.connect(this.preMaster);

    this.revSend = gain(0);
    this.revWet = gain(1);
    this.revConv = ctx.createConvolver();
    this.revConv.normalize = true;
    this.preMaster.connect(this.revSend).connect(this.revConv);

    // ---------- マスター ----------
    this.master = gain(1);
    const limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    limiter.oversample = '2x';
    // リミッターは tanh(x*1.3)/tanh(1.3) なので最大 1/tanh(1.3) まで出る。
    // その逆数を掛けて、どれだけ突っ込んでも 0dBFS を超えないようにする
    this.output = gain(Math.tanh(1.3));

    this.preMaster.connect(this.master);
    this.revConv.connect(this.revWet).connect(this.master);
    this.master.connect(limiter).connect(this.output);

    // オフラインでは currentTime が 0 なので、そのまま渡せば両方で正しく始まる
    this.lfo.start(ctx.currentTime);
    this.lfoOffsetTrem.start(ctx.currentTime);

    this.applySettings(this.settings, this.tuning);
  }

  applySettings(next: GuitarSettings, tuning: number[]) {
    this.settings = { ...next };
    this.tuning = [...tuning];
    const s = this.settings;
    const tune = findTuning(s.tuningId);

    this.node.port.postMessage({
      type: 'params',
      values: engineParams(s, tune.wound),
      tuning: this.tuning,
    });

    // ---------- ボディ ----------
    if (s.bodyType === 'none') {
      this.bodyDry.gain.value = 1;
      this.bodySend.gain.value = 0;
      this.bodyWet.gain.value = 0;
    } else {
      const mix = clamp01(s.bodyMix);
      this.bodyConv.buffer = this.bodyImpulse(s.bodyType);
      // 胴鳴りは「直接音 + 箱の応答」なので、両方を残したまま比率を変える
      this.bodyDry.gain.value = 1 - mix * 0.55;
      this.bodySend.gain.value = mix;
      this.bodyWet.gain.value = 1.35;
    }

    // ---------- アンプ ----------
    const amp = AMPS[s.ampType] ?? AMPS.off;
    const comp = clamp01(s.compress);
    this.comp.threshold.value = -6 - comp * 26;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 1.6 + comp * 8;
    this.comp.attack.value = 0.006 + (1 - comp) * 0.02;
    this.comp.release.value = 0.18;

    this.preHP.frequency.value = amp.preHP;
    this.preMid.frequency.value = amp.preMid.f;
    this.preMid.Q.value = amp.preMid.q;
    this.preMid.gain.value = amp.preMid.g;
    this.postLP.frequency.value = amp.postLP;

    if (s.driveType === 'off') {
      this.shaper.curve = null;
      this.driveIn.gain.value = 1;
      // 歪みなしでもコンプの分だけ音量が変わるので補正する
      this.makeup.gain.value = 1 + comp * 0.8;
    } else {
      const amount = clamp01(s.drive);
      this.shaper.curve = this.curve(s.driveType, amount);
      this.driveIn.gain.value = 1 + amount * amp.drive * 6;
      // 歪みカーブの出力は常に ±1 付近まで振れるので、
      // 入力を上げたぶんだけ後段を下げないと、音全体が潰れてしまう
      this.makeup.gain.value = (amp.makeup * (1 + comp * 0.5)) / (1 + amount * 1.7);
    }

    this.eqBass.frequency.value = amp.bassF;
    this.eqBass.gain.value = s.bass * 11;
    this.eqMid.frequency.value = amp.midF;
    this.eqMid.Q.value = amp.midQ;
    this.eqMid.gain.value = s.mid * 11;
    this.eqTreble.frequency.value = amp.trebF;
    this.eqTreble.gain.value = s.treble * 11;
    this.eqPresence.frequency.value = amp.presF;
    this.eqPresence.gain.value = s.presence * 9;

    // ---------- キャビネット ----------
    const cabSpec = s.cabType === 'off' ? null : CABS[s.cabType];
    for (let i = 0; i < CAB_BANDS; i++) {
      const band = cabSpec?.bands[i];
      const node = this.cab[i];
      if (!band) {
        // 使わない段は「ゲイン0のピーキング」＝素通しにしておく
        node.type = 'peaking';
        node.frequency.value = 1000;
        node.Q.value = 1;
        node.gain.value = 0;
      } else {
        node.type = band.type;
        node.frequency.value = band.freq;
        node.Q.value = band.q;
        node.gain.value = band.gain;
      }
    }

    // ---------- モジュレーション ----------
    const depth = clamp01(s.modDepth);
    this.lfo.frequency.value = Math.max(0.05, s.modRate);
    this.lfoGainChorus.gain.value = 0;
    this.lfoGainPhaser.gain.value = 0;
    this.lfoGainTrem.gain.value = 0;
    this.lfoGainWah.gain.value = 0;
    this.chorusGain.gain.value = 0;
    this.phaserGain.gain.value = 0;
    this.tremOut.gain.value = 0;
    this.wahOut.gain.value = 0;
    this.modDry.gain.value = 1;
    this.lfoOffsetTrem.offset.value = 0;
    this.tremGain.gain.value = 0;

    switch (s.modType) {
      case 'chorus':
        this.lfoGainChorus.gain.value = 0.0016 + depth * 0.004;
        this.chorusGain.gain.value = 0.55 + depth * 0.25;
        break;
      case 'vibrato':
        this.lfoGainChorus.gain.value = 0.0008 + depth * 0.0035;
        this.chorusGain.gain.value = 1.0;
        this.modDry.gain.value = 0;
        break;
      case 'phaser':
        this.lfoGainPhaser.gain.value = 320 + depth * 1400;
        this.phaserGain.gain.value = 0.85;
        break;
      case 'tremolo':
        // LFO は -1..1 なので、中心を上げて 0..1 の音量変化にする
        this.lfoOffsetTrem.offset.value = 1 - depth * 0.5;
        this.lfoGainTrem.gain.value = depth * 0.5;
        this.tremOut.gain.value = 1;
        this.modDry.gain.value = 0;
        break;
      case 'wah':
        this.wah.frequency.value = 850 + depth * 350;
        this.wah.Q.value = 2.5 + depth * 3.5;
        this.lfoGainWah.gain.value = 350 + depth * 1100;
        this.wahOut.gain.value = 2.2;
        this.modDry.gain.value = 0;
        break;
      default:
        break;
    }

    // ---------- ディレイ ----------
    const delayMix = clamp01(s.delayMix);
    this.delayNode.delayTime.value = Math.min(2.4, Math.max(0.01, s.delayTime));
    this.delayFb.gain.value = delayMix > 0 ? Math.min(0.85, Math.max(0, s.delayFeedback)) : 0;
    this.delayWet.gain.value = delayMix;
    this.delayTone.frequency.value = 2200 + (1 - delayMix) * 3000;

    // ---------- リバーブ ----------
    const revMix = clamp01(s.reverbMix);
    const revOn = s.reverbType !== 'off' && revMix > 0;
    if (revOn) this.revConv.buffer = this.reverbImpulse(s.reverbType);
    this.revSend.gain.value = revOn ? revMix : 0;
    this.revWet.gain.value = revOn ? 1.1 : 0;
    this.preMaster.gain.value = revOn ? 1 - revMix * 0.28 : 1;

    const trim = Math.max(0.2, Math.min(3, s.outputTrim));
    this.master.gain.value = Math.pow(clamp01(s.volume), 1.4) * 1.9 * trim;
  }

  private bodyImpulse(type: GuitarSettings['bodyType']): AudioBuffer | null {
    if (type === 'none') return null;
    const key = `body:${type}`;
    let ir = this.irCache.get(key);
    if (!ir) {
      ir = createBodyImpulse(this.ctx, type);
      this.irCache.set(key, ir);
    }
    return ir;
  }

  private reverbImpulse(type: GuitarSettings['reverbType']): AudioBuffer | null {
    if (type === 'off') return null;
    const key = `rev:${type}`;
    let ir = this.irCache.get(key);
    if (!ir) {
      ir = createReverbImpulse(this.ctx, type);
      this.irCache.set(key, ir);
    }
    return ir;
  }

  private curve(kind: Exclude<GuitarSettings['driveType'], 'off'>, amount: number) {
    // カーブは 0.05 刻みで丸めて再利用する（つまみを動かすたびに作り直さない）
    const step = Math.round(amount * 20) / 20;
    const key = `${kind}:${step}`;
    let c = this.curveCache.get(key);
    if (!c) {
      c = driveCurve(kind, step);
      this.curveCache.set(key, c);
    }
    return c;
  }

  send(msg: Record<string, unknown>) {
    this.node.port.postMessage(msg);
  }

  dispose() {
    try {
      this.lfo.stop();
      this.lfoOffsetTrem.stop();
    } catch {
      /* 既に停止済みなら無視 */
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

async function loadWorklet(ctx: BaseAudioContext) {
  await ctx.audioWorklet.addModule(processorUrl);
}

export interface StringStatus {
  levels: Float32Array;
  freqs: Float32Array;
  sounding: number;
}

/** ブラウザ再生用のエンジン */
export class GuitarEngine {
  ctx: AudioContext | null = null;
  chain: GuitarChain | null = null;
  analyser: AnalyserNode | null = null;
  status: StringStatus = { levels: new Float32Array(8), freqs: new Float32Array(8), sounding: 0 };

  private settings: GuitarSettings = { ...DEFAULT_SETTINGS };
  private tuning: number[] = findTuning(DEFAULT_SETTINGS.tuningId).notes;
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

    const chain = new GuitarChain(ctx, this.tuning, this.settings);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    chain.output.connect(analyser);
    chain.output.connect(ctx.destination);

    chain.node.port.onmessage = (e) => {
      if (e.data?.type === 'status') {
        this.status = {
          levels: e.data.levels,
          freqs: e.data.freqs,
          sounding: e.data.sounding,
        };
      }
    };

    this.ctx = ctx;
    this.chain = chain;
    this.analyser = analyser;
    this.levelData = new Uint8Array(analyser.fftSize);
    this.ready = true;
    chain.applySettings(this.settings, this.tuning);
    await ctx.resume();
  }

  updateSettings(next: GuitarSettings, tuning: number[]) {
    this.settings = { ...next };
    this.tuning = [...tuning];
    this.chain?.applySettings(this.settings, this.tuning);
  }

  getSettings(): GuitarSettings {
    return { ...this.settings };
  }

  pluck(string: number, fret: number, vel: number, mute?: number) {
    this.chain?.send({ type: 'pluck', string, fret, vel, mute });
  }

  setFret(string: number, fret: number, slide?: number, vel?: number) {
    this.chain?.send({ type: 'fret', string, fret, slide, vel });
  }

  bend(string: number, amount: number) {
    this.chain?.send({ type: 'bend', string, amount });
  }

  vibrato(string: number, depth: number, rate: number) {
    this.chain?.send({ type: 'vibrato', string, depth, rate });
  }

  damp(string: number, amount = 1) {
    this.chain?.send({ type: 'damp', string, amount });
  }

  dampAll() {
    this.chain?.send({ type: 'dampAll' });
  }

  palm(value: number) {
    this.chain?.send({ type: 'palm', value });
  }

  panic() {
    this.chain?.send({ type: 'panic' });
  }

  /** オーディオクロック（秒） */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** サンプル精度で先読みスケジュールする（デモ再生・自動ストローク用） */
  schedule(ev: PerformanceEvent, atTime: number) {
    if (!this.ctx || !this.chain) return;
    const atFrame = Math.max(0, Math.round(atTime * this.ctx.sampleRate));
    this.chain.send({ ...ev, atFrame });
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
  settings: GuitarSettings,
  tuning: number[],
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

  const chain = new GuitarChain(ctx, tuning, settings, scheduled);
  chain.output.connect(ctx.destination);

  return ctx.startRendering();
}
