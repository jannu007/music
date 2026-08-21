import type { DistortionType, FilterMode, ModMode } from './types';

/**
 * マスターバスに挿すエフェクト群。すべて Web Audio API の標準ノードだけで
 * 組んでいる（外部ライブラリ・音源ファイルなし）ので、オフライン書き出しでも
 * リアルタイム再生とまったく同じ結果になる。
 *
 * 各エフェクトは常時つながったままで、「切」のときは wet を 0 にして素通しにする。
 * ノードの付け外しをしないぶん、切り替えでプツッと鳴ることがない。
 */

/** 書き出し用の OfflineAudioContext では時定数つきの変化を使わない */
function isLive(ctx: BaseAudioContext): boolean {
  return !('startRendering' in ctx);
}

function setParam(param: AudioParam, value: number, ctx: BaseAudioContext, tau = 0.02) {
  if (isLive(ctx)) param.setTargetAtTime(value, ctx.currentTime, tau);
  else param.value = value;
}

/** 位相をずらした LFO を作る（複数の声部を同時に揺らすときに使う） */
function makeLfo(ctx: BaseAudioContext, phase = 0): { osc: OscillatorNode; depth: GainNode } {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 0.5;
  const depth = ctx.createGain();
  depth.gain.value = 0;
  osc.connect(depth);
  // start に負のオフセットは渡せないので、周期のぶんだけ遅らせて位相差をつくる
  osc.start(phase);
  return { osc, depth };
}

// --------------------------------------------------------------------- 歪み

function distortionCurve(type: DistortionType, amount: number) {
  const n = 4096;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));

  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = shape(type, x, a);
  }
  return curve;
}

function shape(type: DistortionType, x: number, a: number): number {
  switch (type) {
    case 'soft': {
      // なめらかに潰れる。倍音は奇数次が中心でチューブっぽい
      const k = 1 + a * 16;
      return Math.tanh(x * k) / Math.tanh(k);
    }
    case 'hard': {
      // 頭を切り落とす。ざらついた攻撃的な歪み
      const th = Math.max(0.06, 1 - a * 0.94);
      return Math.max(-th, Math.min(th, x)) / th;
    }
    case 'fuzz': {
      // 上下で歪み方を変える（非対称）と偶数次倍音が出てファズらしくなる
      const k = 1 + a * 26;
      const g = (t: number) => (1 - Math.exp(-Math.abs(t) * k)) / (1 - Math.exp(-k));
      return x >= 0 ? g(x) : -g(x) * 0.72;
    }
    default:
      return x;
  }
}

export class Distortion {
  readonly input: GainNode;
  readonly output: GainNode;
  private shaper: WaveShaperNode;
  private dcBlock: BiquadFilterNode;
  private tone: BiquadFilterNode;
  private wet: GainNode;
  private dry: GainNode;
  private ctx: BaseAudioContext;
  private curveKey = '';

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    // 非対称に歪ませると直流が乗るので必ず抜く
    this.dcBlock = ctx.createBiquadFilter();
    this.dcBlock.type = 'highpass';
    this.dcBlock.frequency.value = 26;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 12000;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.shaper).connect(this.dcBlock).connect(this.tone).connect(this.wet).connect(this.output);
  }

  update(type: DistortionType, amount: number, tone: number, mix: number) {
    const on = type !== 'off';
    const key = `${type}:${amount.toFixed(3)}`;
    if (on && key !== this.curveKey) {
      this.shaper.curve = distortionCurve(type, amount);
      this.curveKey = key;
    }
    // 800Hz〜14kHz。絞るとこもった歪み、開けるとジリジリした歪みになる
    this.tone.frequency.value = 800 * Math.pow(14000 / 800, Math.max(0, Math.min(1, tone)));
    // 深く歪ませるほど音量が上がるので、その分だけ戻す
    const makeup = 1 - amount * 0.45;
    setParam(this.wet.gain, on ? mix * makeup : 0, this.ctx);
    setParam(this.dry.gain, on ? 1 - mix * 0.85 : 1, this.ctx);
  }
}

// --------------------------------------------------------- ビットクラッシャー

function crushCurve(bits: number) {
  const n = 4096;
  const curve = new Float32Array(n);
  const levels = Math.pow(2, Math.max(1, bits) - 1);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

export class BitCrusher {
  readonly input: GainNode;
  readonly output: GainNode;
  private shaper: WaveShaperNode;
  private wet: GainNode;
  private dry: GainNode;
  private ctx: BaseAudioContext;
  private bits = -1;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.shaper).connect(this.wet).connect(this.output);
  }

  update(bits: number, mix: number) {
    const b = Math.round(Math.max(2, Math.min(16, bits)));
    // 16bit は事実上そのままなので「切」として扱う
    const on = b < 16 && mix > 0;
    if (b !== this.bits) {
      this.shaper.curve = crushCurve(b);
      this.bits = b;
    }
    setParam(this.wet.gain, on ? mix : 0, this.ctx);
    setParam(this.dry.gain, on ? 1 - mix : 1, this.ctx);
  }
}

// ------------------------------------------------------------------ フィルター

export class SweepFilter {
  readonly input: BiquadFilterNode;
  readonly output: GainNode;
  private lfo: { osc: OscillatorNode; depth: GainNode };
  private ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createBiquadFilter();
    this.input.type = 'lowpass';
    this.input.frequency.value = 20000;
    this.input.Q.value = 0.7;
    this.output = ctx.createGain();
    this.input.connect(this.output);

    this.lfo = makeLfo(ctx);
    this.lfo.depth.connect(this.input.frequency);
  }

  update(mode: FilterMode, freq: number, q: number, rate: number, depth: number) {
    const on = mode !== 'off';
    this.input.type = on ? (mode as BiquadFilterType) : 'lowpass';
    const base = on ? Math.max(40, Math.min(18000, freq)) : 20000;
    setParam(this.input.frequency, base, this.ctx);
    setParam(this.input.Q, on ? Math.max(0.3, Math.min(20, q)) : 0.7, this.ctx);
    this.lfo.osc.frequency.value = Math.max(0.02, rate);
    // 基準周波数に対する割合で揺らす（低い周波数でも同じくらい動いて聞こえる）
    setParam(this.lfo.depth.gain, on ? base * Math.min(0.92, depth) : 0, this.ctx);
  }
}

// -------------------------------------------------------------------- コーラス

export class Chorus {
  readonly input: GainNode;
  readonly output: GainNode;
  private delays: DelayNode[] = [];
  private lfos: { osc: OscillatorNode; depth: GainNode }[] = [];
  private wet: GainNode;
  private dry: GainNode;
  private ctx: BaseAudioContext;
  /** 声部ごとの基準ディレイ（秒）と定位 */
  private static readonly VOICES = [
    { base: 0.014, pan: -0.7, detune: 1 },
    { base: 0.019, pan: 0, detune: 1.31 },
    { base: 0.025, pan: 0.7, detune: 0.79 },
  ];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.input.connect(this.dry).connect(this.output);

    Chorus.VOICES.forEach((voice, i) => {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = voice.base;
      const pan = ctx.createStereoPanner();
      pan.pan.value = voice.pan;
      const level = ctx.createGain();
      level.gain.value = 1 / Chorus.VOICES.length;
      this.input.connect(delay).connect(pan).connect(level).connect(this.wet);

      const lfo = makeLfo(ctx, i * 0.37);
      lfo.depth.connect(delay.delayTime);
      this.delays.push(delay);
      this.lfos.push(lfo);
    });
    this.wet.connect(this.output);
  }

  update(on: boolean, rate: number, depth: number, mix: number) {
    Chorus.VOICES.forEach((voice, i) => {
      this.lfos[i].osc.frequency.value = Math.max(0.02, rate * voice.detune);
      // 最大 6ms 前後まで。基準ディレイを超えて負にならない範囲に収める
      const swing = Math.min(voice.base * 0.55, 0.006 * depth);
      setParam(this.lfos[i].depth.gain, on ? swing : 0, this.ctx);
      this.delays[i].delayTime.value = voice.base;
    });
    setParam(this.wet.gain, on ? mix : 0, this.ctx);
    // 原音は残しつつ、混ぜるほど少しだけ下げて音量が膨らみすぎないようにする
    setParam(this.dry.gain, on ? 1 - mix * 0.35 : 1, this.ctx);
  }
}

// ------------------------------------------------------------------ フランジャー

export class Flanger {
  readonly input: GainNode;
  readonly output: GainNode;
  private delay: DelayNode;
  private feedback: GainNode;
  private lfo: { osc: OscillatorNode; depth: GainNode };
  private wet: GainNode;
  private dry: GainNode;
  private ctx: BaseAudioContext;
  private static readonly BASE = 0.0035;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.delay = ctx.createDelay(0.05);
    this.delay.delayTime.value = Flanger.BASE;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.delay);
    // フィードバックで櫛の谷が深くなり、ジェット機のような音になる
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wet).connect(this.output);

    this.lfo = makeLfo(ctx);
    this.lfo.depth.connect(this.delay.delayTime);
  }

  update(on: boolean, rate: number, depth: number, feedback: number, mix: number) {
    this.lfo.osc.frequency.value = Math.max(0.02, rate);
    setParam(this.lfo.depth.gain, on ? Flanger.BASE * 0.85 * depth : 0, this.ctx);
    setParam(this.feedback.gain, on ? Math.min(0.85, feedback) : 0, this.ctx);
    setParam(this.wet.gain, on ? mix : 0, this.ctx);
    setParam(this.dry.gain, on ? 1 - mix * 0.5 : 1, this.ctx);
  }
}

// ------------------------------------------------------------------- フェイザー

export class Phaser {
  readonly input: GainNode;
  readonly output: GainNode;
  private stages: BiquadFilterNode[] = [];
  private dcBlock: BiquadFilterNode;
  private feedback: GainNode;
  private fbDelay: DelayNode;
  private lfo: { osc: OscillatorNode; depth: GainNode };
  private wet: GainNode;
  private dry: GainNode;
  private ctx: BaseAudioContext;
  /** オールパスを4段。段ごとに中心周波数をずらすと谷が広がる */
  private static readonly STAGE_FREQ = [320, 640, 1280, 2560];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.input.connect(this.dry).connect(this.output);

    this.lfo = makeLfo(ctx);

    let node: AudioNode = this.input;
    for (const freq of Phaser.STAGE_FREQ) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = freq;
      ap.Q.value = 0.6;
      this.lfo.depth.connect(ap.frequency);
      node.connect(ap);
      node = ap;
      this.stages.push(ap);
    }
    // オールパスは直流も通すため、帰還で溜まったオフセットをここで抜く
    this.dcBlock = ctx.createBiquadFilter();
    this.dcBlock.type = 'highpass';
    this.dcBlock.frequency.value = 22;
    node.connect(this.dcBlock).connect(this.wet).connect(this.output);

    // Web Audio はディレイを含まない帰還路を鳴らさないので、最短のディレイを挟む
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    this.fbDelay = ctx.createDelay(0.05);
    this.fbDelay.delayTime.value = 0.002;
    node.connect(this.feedback).connect(this.fbDelay).connect(this.stages[0]);
  }

  update(on: boolean, rate: number, depth: number, feedback: number, mix: number) {
    this.lfo.osc.frequency.value = Math.max(0.02, rate);
    // 各段の中心周波数を最大で 1 オクターブ半ほど持ち上げる
    setParam(this.lfo.depth.gain, on ? 1400 * depth : 0, this.ctx);
    const fb = Math.min(0.55, feedback);
    setParam(this.feedback.gain, on ? fb : 0, this.ctx);
    // 帰還を上げるほど共振でピークが伸びるので、その分だけ戻す
    setParam(this.wet.gain, on ? mix * (1 - fb * 0.6) : 0, this.ctx);
    // 原音と等量で混ぜたときに谷がいちばん深くなる
    setParam(this.dry.gain, on ? 1 - mix * 0.5 : 1, this.ctx);
  }
}

// ------------------------------------------------------------ リングモジュレーター

export class RingMod {
  readonly input: GainNode;
  readonly output: GainNode;
  private osc: OscillatorNode;
  private ring: GainNode;
  private wet: GainNode;
  private dry: GainNode;
  private ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;

    // ゲインを 0 にしたうえで gain に音声信号を突っ込むと「掛け算」になる
    this.ring = ctx.createGain();
    this.ring.gain.value = 0;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.value = 220;
    this.osc.connect(this.ring.gain);
    this.osc.start();

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.ring).connect(this.wet).connect(this.output);
  }

  update(on: boolean, freq: number, mix: number) {
    this.osc.frequency.value = Math.max(10, Math.min(4000, freq));
    setParam(this.wet.gain, on ? mix : 0, this.ctx);
    setParam(this.dry.gain, on ? 1 - mix * 0.7 : 1, this.ctx);
  }
}

// --------------------------------------------------- トレモロ / オートパン

export class ModShaper {
  readonly input: GainNode;
  readonly output: GainNode;
  private trem: GainNode;
  private tremLfo: { osc: OscillatorNode; depth: GainNode };
  private panner: StereoPannerNode;
  private panLfo: { osc: OscillatorNode; depth: GainNode };
  private panComp: GainNode;
  private ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.trem = ctx.createGain();
    this.trem.gain.value = 1;
    this.tremLfo = makeLfo(ctx);
    this.tremLfo.depth.connect(this.trem.gain);

    this.panner = ctx.createStereoPanner();
    this.panLfo = makeLfo(ctx);
    this.panLfo.depth.connect(this.panner.pan);
    // 端まで振ると片チャンネルが 3dB 上がるので、深さに応じて下げておく
    this.panComp = ctx.createGain();

    this.input.connect(this.trem).connect(this.panner).connect(this.panComp).connect(this.output);
  }

  update(mode: ModMode, rate: number, depth: number) {
    const hz = Math.max(0.05, rate);
    this.tremLfo.osc.frequency.value = hz;
    this.panLfo.osc.frequency.value = hz;

    const tremolo = mode === 'tremolo';
    const autopan = mode === 'autopan';
    // 音量は「1 - 深さ」〜「1」の間で揺れる（最大でも無音にはしない）
    setParam(this.trem.gain, tremolo ? 1 - depth * 0.5 : 1, this.ctx);
    setParam(this.tremLfo.depth.gain, tremolo ? depth * 0.5 : 0, this.ctx);
    setParam(this.panLfo.depth.gain, autopan ? Math.min(1, depth) : 0, this.ctx);
    setParam(this.panComp.gain, autopan ? 1 - Math.min(1, depth) * 0.3 : 1, this.ctx);
    if (!autopan) setParam(this.panner.pan, 0, this.ctx);
  }
}

// ------------------------------------------------------------------ ステレオ幅

/**
 * ミッド／サイドで左右の広がりを変える。
 *   L' = L(1+w)/2 + R(1-w)/2 ,  R' = L(1-w)/2 + R(1+w)/2
 * w=1 でそのまま、0 でモノラル、2 で目一杯広い。
 */
export class StereoWidth {
  readonly input: ChannelSplitterNode;
  readonly output: ChannelMergerNode;
  private same: GainNode[] = [];
  private cross: GainNode[] = [];
  private ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);

    for (let ch = 0; ch < 2; ch++) {
      const same = ctx.createGain();
      same.gain.value = 1;
      const cross = ctx.createGain();
      cross.gain.value = 0;
      this.input.connect(same, ch);
      this.input.connect(cross, ch);
      same.connect(this.output, 0, ch);
      cross.connect(this.output, 0, 1 - ch);
      this.same.push(same);
      this.cross.push(cross);
    }
  }

  update(width: number) {
    const w = Math.max(0, Math.min(2, width));
    for (let ch = 0; ch < 2; ch++) {
      setParam(this.same[ch].gain, (1 + w) / 2, this.ctx);
      setParam(this.cross[ch].gain, (1 - w) / 2, this.ctx);
    }
  }
}
