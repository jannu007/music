/**
 * ドラム / ベース / ギターで共有するエフェクト群。
 * すべて Web Audio API の標準ノードだけで組んでいる（外部ライブラリ・音源ファイル
 * なし）ので、オフライン書き出しでもリアルタイム再生とまったく同じ結果になる。
 *
 * 「切」のときは処理側の枝を丸ごと外して、原音だけを素通しさせる。
 * 音量を 0 にするだけだと、鳴っていなくても全ノードが毎フレーム計算され続け、
 * スマホのように余力の少ない端末では音が途切れてしまうため。
 * 切り替えでプツッと鳴らないよう、まず音量を落としてから少し遅れて外している。
 */

export type DistortionType = 'off' | 'soft' | 'hard' | 'fuzz';
export type FilterMode = 'off' | 'lowpass' | 'highpass' | 'bandpass';
export type ModMode = 'off' | 'tremolo' | 'autopan';

/** 書き出し用の OfflineAudioContext では時定数つきの変化を使わない */
function isLive(ctx: BaseAudioContext): boolean {
  return !('startRendering' in ctx);
}

function setParam(param: AudioParam, value: number, ctx: BaseAudioContext, tau = 0.02) {
  if (isLive(ctx)) param.setTargetAtTime(value, ctx.currentTime, tau);
  else param.value = value;
}

/** 音量を落としきってから枝を外すまでの待ち時間（ミリ秒） */
const UNWIRE_DELAY = 160;

/**
 * エフェクト1個ぶんの土台。
 *
 * 入口 ─┬─ 素通し ──────────────┬─ 出口
 *       └─ 処理（切のときは外す）─┘
 *
 * ドライ／ウェット型（歪み・コーラスなど）は素通しを常時つないだままにし、
 * 差し替え型（フィルター・ステレオ幅など）は処理中だけ素通しを外す。
 */
abstract class FxUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  protected ctx: BaseAudioContext;
  /** 原音側のゲイン。ドライ／ウェット型では混ぜ量の調整にも使う */
  protected dry: GainNode;
  /** 処理側の入口／出口。派生クラスが組み立ててから wire() で登録する */
  private procIn: AudioNode | null = null;
  private procOut: AudioNode | null = null;
  private readonly keepDry: boolean;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: BaseAudioContext, keepDry: boolean) {
    this.ctx = ctx;
    this.keepDry = keepDry;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
  }

  /** 派生クラスが処理側を組み終えたら呼ぶ */
  protected setProcessing(procIn: AudioNode, procOut: AudioNode) {
    this.procIn = procIn;
    this.procOut = procOut;
  }

  protected setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (on) {
      // つなぐのは先。ウェットの音量は 0 から立ち上がるので鳴り始めは滑らか
      this.wire(true);
    } else if (isLive(this.ctx)) {
      // 音量が落ちきるのを待ってから外す（即座に外すとプツッと鳴る）
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.active) this.wire(false);
      }, UNWIRE_DELAY);
    } else {
      this.wire(false);
    }
  }

  private wire(on: boolean) {
    if (!this.procIn || !this.procOut) return;
    try {
      if (on) {
        this.input.connect(this.procIn);
        this.procOut.connect(this.output);
        if (!this.keepDry) this.input.disconnect(this.dry);
      } else {
        this.input.disconnect(this.procIn);
        this.procOut.disconnect(this.output);
        if (!this.keepDry) this.input.connect(this.dry);
      }
    } catch {
      /* 二重の接続／切断は無視する */
    }
  }
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

export class Distortion extends FxUnit {
  private shaper: WaveShaperNode;
  private tone: BiquadFilterNode;
  private wet: GainNode;
  private curveKey = '';

  constructor(ctx: BaseAudioContext) {
    super(ctx, true);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    // 非対称に歪ませると直流が乗るので必ず抜く
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = 26;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 12000;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    this.shaper.connect(dcBlock).connect(this.tone).connect(this.wet);
    this.setProcessing(this.shaper, this.wet);
  }

  update(type: DistortionType, amount: number, tone: number, mix: number) {
    const on = type !== 'off' && mix > 0;
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
    this.setActive(on);
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

export class BitCrusher extends FxUnit {
  private shaper: WaveShaperNode;
  private wet: GainNode;
  private bits = -1;

  constructor(ctx: BaseAudioContext) {
    super(ctx, true);
    this.shaper = ctx.createWaveShaper();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.shaper.connect(this.wet);
    this.setProcessing(this.shaper, this.wet);
  }

  update(bits: number, mix: number) {
    const b = Math.round(Math.max(2, Math.min(16, bits)));
    // 16bit は事実上そのままなので「切」として扱う
    const on = b < 16 && mix > 0;
    if (on && b !== this.bits) {
      this.shaper.curve = crushCurve(b);
      this.bits = b;
    }
    setParam(this.wet.gain, on ? mix : 0, this.ctx);
    setParam(this.dry.gain, on ? 1 - mix : 1, this.ctx);
    this.setActive(on);
  }
}

// ------------------------------------------------------------------ フィルター

export class SweepFilter extends FxUnit {
  private filter: BiquadFilterNode;
  private lfo: { osc: OscillatorNode; depth: GainNode };

  constructor(ctx: BaseAudioContext) {
    super(ctx, false);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;
    this.lfo = makeLfo(ctx);
    this.lfo.depth.connect(this.filter.frequency);
    this.setProcessing(this.filter, this.filter);
  }

  update(mode: FilterMode, freq: number, q: number, rate: number, depth: number) {
    const on = mode !== 'off';
    if (on) {
      this.filter.type = mode as BiquadFilterType;
      const base = Math.max(40, Math.min(18000, freq));
      setParam(this.filter.frequency, base, this.ctx);
      setParam(this.filter.Q, Math.max(0.3, Math.min(20, q)), this.ctx);
      this.lfo.osc.frequency.value = Math.max(0.02, rate);
      // 基準周波数に対する割合で揺らす（低い周波数でも同じくらい動いて聞こえる）
      setParam(this.lfo.depth.gain, base * Math.min(0.92, depth), this.ctx);
    } else {
      setParam(this.lfo.depth.gain, 0, this.ctx);
    }
    this.setActive(on);
  }
}

// -------------------------------------------------------------------- コーラス

export class Chorus extends FxUnit {
  private delays: DelayNode[] = [];
  private lfos: { osc: OscillatorNode; depth: GainNode }[] = [];
  private wet: GainNode;
  /** 声部ごとの基準ディレイ（秒）と定位 */
  private static readonly VOICES = [
    { base: 0.014, pan: -0.7, detune: 1 },
    { base: 0.019, pan: 0, detune: 1.31 },
    { base: 0.025, pan: 0.7, detune: 0.79 },
  ];

  constructor(ctx: BaseAudioContext) {
    super(ctx, true);
    const head = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    Chorus.VOICES.forEach((voice, i) => {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = voice.base;
      const pan = ctx.createStereoPanner();
      pan.pan.value = voice.pan;
      const level = ctx.createGain();
      level.gain.value = 1 / Chorus.VOICES.length;
      head.connect(delay).connect(pan).connect(level).connect(this.wet);

      const lfo = makeLfo(ctx, i * 0.37);
      lfo.depth.connect(delay.delayTime);
      this.delays.push(delay);
      this.lfos.push(lfo);
    });
    this.setProcessing(head, this.wet);
  }

  update(on: boolean, rate: number, depth: number, mix: number) {
    const live = on && mix > 0;
    Chorus.VOICES.forEach((voice, i) => {
      this.lfos[i].osc.frequency.value = Math.max(0.02, rate * voice.detune);
      // 最大 6ms 前後まで。基準ディレイを超えて負にならない範囲に収める
      const swing = Math.min(voice.base * 0.55, 0.006 * depth);
      setParam(this.lfos[i].depth.gain, live ? swing : 0, this.ctx);
      this.delays[i].delayTime.value = voice.base;
    });
    setParam(this.wet.gain, live ? mix : 0, this.ctx);
    // 原音は残しつつ、混ぜるほど少しだけ下げて音量が膨らみすぎないようにする
    setParam(this.dry.gain, live ? 1 - mix * 0.35 : 1, this.ctx);
    this.setActive(live);
  }
}

// ------------------------------------------------------------------ フランジャー

export class Flanger extends FxUnit {
  private delay: DelayNode;
  private feedback: GainNode;
  private lfo: { osc: OscillatorNode; depth: GainNode };
  private wet: GainNode;
  private static readonly BASE = 0.0035;

  constructor(ctx: BaseAudioContext) {
    super(ctx, true);
    this.delay = ctx.createDelay(0.05);
    this.delay.delayTime.value = Flanger.BASE;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    // フィードバックで櫛の谷が深くなり、ジェット機のような音になる
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wet);

    this.lfo = makeLfo(ctx);
    this.lfo.depth.connect(this.delay.delayTime);
    this.setProcessing(this.delay, this.wet);
  }

  update(on: boolean, rate: number, depth: number, feedback: number, mix: number) {
    const live = on && mix > 0;
    this.lfo.osc.frequency.value = Math.max(0.02, rate);
    setParam(this.lfo.depth.gain, live ? Flanger.BASE * 0.85 * depth : 0, this.ctx);
    setParam(this.feedback.gain, live ? Math.min(0.85, feedback) : 0, this.ctx);
    setParam(this.wet.gain, live ? mix : 0, this.ctx);
    setParam(this.dry.gain, live ? 1 - mix * 0.5 : 1, this.ctx);
    this.setActive(live);
  }
}

// ------------------------------------------------------------------- フェイザー

export class Phaser extends FxUnit {
  private stages: BiquadFilterNode[] = [];
  private feedback: GainNode;
  private lfo: { osc: OscillatorNode; depth: GainNode };
  private wet: GainNode;
  /** オールパスを4段。段ごとに中心周波数をずらすと谷が広がる */
  private static readonly STAGE_FREQ = [320, 640, 1280, 2560];

  constructor(ctx: BaseAudioContext) {
    super(ctx, true);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.lfo = makeLfo(ctx);

    const head = ctx.createGain();
    let node: AudioNode = head;
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
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = 22;
    node.connect(dcBlock).connect(this.wet);

    // Web Audio はディレイを含まない帰還路を鳴らさないので、最短のディレイを挟む
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    const fbDelay = ctx.createDelay(0.05);
    fbDelay.delayTime.value = 0.002;
    node.connect(this.feedback).connect(fbDelay).connect(this.stages[0]);

    this.setProcessing(head, this.wet);
  }

  update(on: boolean, rate: number, depth: number, feedback: number, mix: number) {
    const live = on && mix > 0;
    this.lfo.osc.frequency.value = Math.max(0.02, rate);
    // 各段の中心周波数を最大で 1 オクターブ半ほど持ち上げる
    setParam(this.lfo.depth.gain, live ? 1400 * depth : 0, this.ctx);
    const fb = Math.min(0.55, feedback);
    setParam(this.feedback.gain, live ? fb : 0, this.ctx);
    // 帰還を上げるほど共振でピークが伸びるので、その分だけ戻す
    setParam(this.wet.gain, live ? mix * (1 - fb * 0.6) : 0, this.ctx);
    // 原音と等量で混ぜたときに谷がいちばん深くなる
    setParam(this.dry.gain, live ? 1 - mix * 0.5 : 1, this.ctx);
    this.setActive(live);
  }
}

// ------------------------------------------------------------ リングモジュレーター

export class RingMod extends FxUnit {
  private osc: OscillatorNode;
  private wet: GainNode;

  constructor(ctx: BaseAudioContext) {
    super(ctx, true);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    // ゲインを 0 にしたうえで gain に音声信号を突っ込むと「掛け算」になる
    const ring = ctx.createGain();
    ring.gain.value = 0;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.value = 220;
    this.osc.connect(ring.gain);
    this.osc.start();

    ring.connect(this.wet);
    this.setProcessing(ring, this.wet);
  }

  update(on: boolean, freq: number, mix: number) {
    const live = on && mix > 0;
    this.osc.frequency.value = Math.max(10, Math.min(4000, freq));
    setParam(this.wet.gain, live ? mix : 0, this.ctx);
    setParam(this.dry.gain, live ? 1 - mix * 0.7 : 1, this.ctx);
    this.setActive(live);
  }
}

// --------------------------------------------------- トレモロ / オートパン

export class ModShaper extends FxUnit {
  private trem: GainNode;
  private tremLfo: { osc: OscillatorNode; depth: GainNode };
  private panner: StereoPannerNode;
  private panLfo: { osc: OscillatorNode; depth: GainNode };
  private panComp: GainNode;

  constructor(ctx: BaseAudioContext) {
    super(ctx, false);
    this.trem = ctx.createGain();
    this.trem.gain.value = 1;
    this.tremLfo = makeLfo(ctx);
    this.tremLfo.depth.connect(this.trem.gain);

    this.panner = ctx.createStereoPanner();
    this.panLfo = makeLfo(ctx);
    this.panLfo.depth.connect(this.panner.pan);
    // 端まで振ると片チャンネルが 3dB 上がるので、深さに応じて下げておく
    this.panComp = ctx.createGain();

    this.trem.connect(this.panner).connect(this.panComp);
    this.setProcessing(this.trem, this.panComp);
  }

  update(mode: ModMode, rate: number, depth: number) {
    const hz = Math.max(0.05, rate);
    this.tremLfo.osc.frequency.value = hz;
    this.panLfo.osc.frequency.value = hz;

    const live = mode !== 'off' && depth > 0;
    const tremolo = live && mode === 'tremolo';
    const autopan = live && mode === 'autopan';
    // 音量は「1 - 深さ」〜「1」の間で揺れる（最大でも無音にはしない）
    setParam(this.trem.gain, tremolo ? 1 - depth * 0.5 : 1, this.ctx);
    setParam(this.tremLfo.depth.gain, tremolo ? depth * 0.5 : 0, this.ctx);
    setParam(this.panLfo.depth.gain, autopan ? Math.min(1, depth) : 0, this.ctx);
    setParam(this.panComp.gain, autopan ? 1 - Math.min(1, depth) * 0.3 : 1, this.ctx);
    if (!autopan) setParam(this.panner.pan, 0, this.ctx);
    this.setActive(live);
  }
}

// ------------------------------------------------------------------ ステレオ幅

/**
 * ミッド／サイドで左右の広がりを変える。
 *   L' = L(1+w)/2 + R(1-w)/2 ,  R' = L(1-w)/2 + R(1+w)/2
 * w=1 でそのまま、0 でモノラル、2 で目一杯広い。
 */
export class StereoWidth extends FxUnit {
  private same: GainNode[] = [];
  private cross: GainNode[] = [];

  constructor(ctx: BaseAudioContext) {
    super(ctx, false);
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    for (let ch = 0; ch < 2; ch++) {
      const same = ctx.createGain();
      same.gain.value = 1;
      const cross = ctx.createGain();
      cross.gain.value = 0;
      splitter.connect(same, ch);
      splitter.connect(cross, ch);
      same.connect(merger, 0, ch);
      cross.connect(merger, 0, 1 - ch);
      this.same.push(same);
      this.cross.push(cross);
    }
    this.setProcessing(splitter, merger);
  }

  update(width: number) {
    const w = Math.max(0, Math.min(2, width));
    // 100% はそのままなので、行列を通さず素通しさせる
    const live = Math.abs(w - 1) > 0.005;
    if (live) {
      for (let ch = 0; ch < 2; ch++) {
        setParam(this.same[ch].gain, (1 + w) / 2, this.ctx);
        setParam(this.cross[ch].gain, (1 - w) / 2, this.ctx);
      }
    }
    this.setActive(live);
  }
}

// ---------------------------------------------------------------- ディレイ

/**
 * 左右にまたがるディレイ。ピンポン（左右交互）にも切り替えられる。
 * ドラムは同じものをエンジン側に持っているので、これはベース用。
 */
export class StereoDelay extends FxUnit {
  private delayL: DelayNode;
  private delayR: DelayNode;
  private dampL: BiquadFilterNode;
  private dampR: BiquadFilterNode;
  private fbLL: GainNode;
  private fbLR: GainNode;
  private fbRR: GainNode;
  private fbRL: GainNode;
  private wet: GainNode;

  constructor(ctx: BaseAudioContext, maxSeconds = 2.5) {
    super(ctx, true);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    this.delayL = ctx.createDelay(maxSeconds);
    this.delayR = ctx.createDelay(maxSeconds);
    this.dampL = ctx.createBiquadFilter();
    this.dampL.type = 'lowpass';
    this.dampL.frequency.value = 3600;
    this.dampR = ctx.createBiquadFilter();
    this.dampR.type = 'lowpass';
    this.dampR.frequency.value = 3600;
    this.fbLL = ctx.createGain();
    this.fbLR = ctx.createGain();
    this.fbRR = ctx.createGain();
    this.fbRL = ctx.createGain();
    for (const g of [this.fbLL, this.fbLR, this.fbRR, this.fbRL]) g.gain.value = 0;

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
    merger.connect(this.wet);

    this.setProcessing(splitter, this.wet);
  }

  update(time: number, feedback: number, mix: number, pingPong: boolean, damp = 3600) {
    const on = mix > 0;
    const t = Math.max(0.01, Math.min(2.4, time));
    // ピンポンは片側を半分の時間にして、左右へ交互に渡す
    setParam(this.delayL.delayTime, pingPong ? t * 0.5 : t, this.ctx);
    setParam(this.delayR.delayTime, t, this.ctx);
    const fb = on ? Math.min(0.85, feedback) : 0;
    setParam(this.fbLL.gain, pingPong ? 0 : fb, this.ctx);
    setParam(this.fbRR.gain, pingPong ? 0 : fb, this.ctx);
    setParam(this.fbLR.gain, pingPong ? fb : 0, this.ctx);
    setParam(this.fbRL.gain, pingPong ? fb : 0, this.ctx);
    this.dampL.frequency.value = damp;
    this.dampR.frequency.value = damp;
    setParam(this.wet.gain, on ? mix : 0, this.ctx);
    this.setActive(on);
  }
}
