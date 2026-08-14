/**
 * Akatsuki Synth — マスターバス／センドエフェクト
 *
 * リアルタイム再生用の AudioContext と、書き出し用の OfflineAudioContext の
 * 両方で同じグラフを構築できるように BaseAudioContext を受け取る設計にしています。
 */
import workletUrl from './worklets/synth-processor.js?url';
import recorderUrl from './worklets/recorder-processor.js?url';

export interface ReverbSettings {
  mix: number;      // 0..1
  size: number;     // 0.2..8 秒
  damp: number;     // 0..1（高域減衰）
  preDelay: number; // 秒
  width: number;    // 0..1
}

export interface DelaySettings {
  mix: number;
  sync: boolean;
  division: number; // 拍数（sync=true）
  time: number;     // 秒（sync=false）
  feedback: number; // 0..0.95
  tone: number;     // 0..1（フィードバックのローパス）
  pingPong: boolean;
}

export interface ChorusSettings {
  mix: number;
  rate: number;  // Hz
  depth: number; // 0..1
  spread: number; // 0..1
}

export interface MasterSettings {
  volume: number;
  drive: number;
  eqLow: number;
  eqMid: number;
  eqMidFreq: number;
  eqHigh: number;
  compress: number; // 0..1
  limiter: boolean;
  reverb: ReverbSettings;
  delay: DelaySettings;
  chorus: ChorusSettings;
}

export function defaultMasterSettings(): MasterSettings {
  return {
    volume: 0.62,
    drive: 0,
    eqLow: 0,
    eqMid: 0,
    eqMidFreq: 1000,
    eqHigh: 0,
    compress: 0.25,
    limiter: true,
    reverb: { mix: 0.32, size: 2.4, damp: 0.45, preDelay: 0.02, width: 0.9 },
    delay: { mix: 0.28, sync: true, division: 0.75, time: 0.35, feedback: 0.38, tone: 0.55, pingPong: true },
    chorus: { mix: 0.3, rate: 0.55, depth: 0.55, spread: 0.8 },
  };
}

/* ------------------------------------------------------------------ */
/* インパルス応答の生成（初期反射＋指数減衰＋高域ダンピング）           */
/* ------------------------------------------------------------------ */
export function buildReverbImpulse(ctx: BaseAudioContext, size: number, damp: number, width: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const seconds = Math.max(0.15, Math.min(9, size));
  const length = Math.max(64, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, length, sr);
  // 初期反射（部屋の大きさに比例したタップ位置）
  const taps = [0.0043, 0.0097, 0.0151, 0.0209, 0.0277, 0.0331, 0.0413, 0.0492];
  const dampCoefBase = 0.35 + (1 - damp) * 0.6;

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    const sign = ch === 0 ? 1 : -1;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // 減衰カーブ（後半ほど密度を上げるためベロシティ・ノイズを整形）
      const decay = Math.pow(1 - t, 2.4 + damp * 2);
      let s = (Math.random() * 2 - 1) * decay;
      // 時間経過とともに高域を落とす（空気吸収のモデル化）
      const g = Math.max(0.02, dampCoefBase * (1 - t * damp));
      lp += g * (s - lp);
      s = lp;
      data[i] = s;
    }
    // 初期反射を重ねる
    for (let k = 0; k < taps.length; k++) {
      const idx = Math.floor(taps[k] * (0.6 + seconds * 0.35) * sr) + (ch === 0 ? 0 : 13);
      if (idx < length) data[idx] += sign * (0.7 - k * 0.075) * (k % 2 === 0 ? 1 : -1);
    }
    // 立ち上がりのクリック防止
    const fade = Math.min(64, length);
    for (let i = 0; i < fade; i++) data[i] *= i / fade;
  }

  // ステレオ幅（0 でモノラル化）
  if (width < 1) {
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const m = (l[i] + r[i]) * 0.5;
      l[i] = m + (l[i] - m) * width;
      r[i] = m + (r[i] - m) * width;
    }
  }

  // ノーマライズ（音量が音色設定で暴れないように）
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    const gain = 0.6 / peak;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) d[i] *= gain;
    }
  }
  return buf;
}

function makeDriveCurve(amount: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = amount * amount * 120;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k > 0 ? Math.tanh(x * (1 + k)) / Math.tanh(1 + k) : x;
  }
  return curve;
}

let workletModulePromise: WeakMap<BaseAudioContext, Promise<void>> | null = null;

/** シンセ／レコーダーの AudioWorklet モジュールを（コンテキストごとに1回だけ）読み込む */
export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  if (!workletModulePromise) workletModulePromise = new WeakMap();
  let p = workletModulePromise.get(ctx);
  if (!p) {
    p = (async () => {
      await ctx.audioWorklet.addModule(workletUrl);
      try {
        await ctx.audioWorklet.addModule(recorderUrl);
      } catch {
        /* 録音用ワークレットが読めなくても再生は継続できる */
      }
    })();
    workletModulePromise.set(ctx, p);
  }
  return p;
}

export class AudioEngine {
  ctx: BaseAudioContext;
  settings: MasterSettings;

  /** 各トラックの出力先（ドライ信号） */
  sumBus: GainNode;
  /** センド */
  reverbSend: GainNode;
  delaySend: GainNode;
  chorusSend: GainNode;

  private convolver: ConvolverNode;
  private reverbPre: DelayNode;
  private reverbReturn: GainNode;

  private delayL: DelayNode;
  private delayR: DelayNode;
  private delayFb: GainNode;
  private delayTone: BiquadFilterNode;
  private delayReturn: GainNode;
  private delayMergeL: StereoPannerNode;
  private delayMergeR: StereoPannerNode;
  private delayCross: GainNode;

  private chorusVoices: { delay: DelayNode; lfo: OscillatorNode; depth: GainNode; pan: StereoPannerNode }[] = [];
  private chorusReturn: GainNode;

  private driveNode: WaveShaperNode;
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private limiter: DynamicsCompressorNode;
  masterGain: GainNode;
  analyser: AnalyserNode;
  /** ステレオ・レベル計測用（左右個別） */
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;

  private recorderNode: AudioWorkletNode | null = null;
  private recChunks: Float32Array[][] = [];
  recording = false;

  bpm = 120;

  constructor(ctx: BaseAudioContext, settings: MasterSettings = defaultMasterSettings()) {
    this.ctx = ctx;
    this.settings = settings;

    this.sumBus = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.delaySend = ctx.createGain();
    this.chorusSend = ctx.createGain();

    // --- リバーブ ---
    this.reverbPre = ctx.createDelay(0.5);
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false;
    this.reverbReturn = ctx.createGain();
    this.reverbSend.connect(this.reverbPre);
    this.reverbPre.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.sumBus);

    // --- ディレイ（ピンポン） ---
    this.delayL = ctx.createDelay(4);
    this.delayR = ctx.createDelay(4);
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayFb = ctx.createGain();
    this.delayCross = ctx.createGain();
    this.delayReturn = ctx.createGain();
    this.delayMergeL = ctx.createStereoPanner();
    this.delayMergeL.pan.value = -1;
    this.delayMergeR = ctx.createStereoPanner();
    this.delayMergeR.pan.value = 1;

    this.delaySend.connect(this.delayL);
    this.delayL.connect(this.delayTone);
    this.delayTone.connect(this.delayR);
    this.delayR.connect(this.delayFb);
    this.delayFb.connect(this.delayL);
    this.delayL.connect(this.delayMergeL);
    this.delayR.connect(this.delayMergeR);
    // ピンポンを切ると通常のステレオディレイになるよう右チャンネルにも直接送る
    this.delaySend.connect(this.delayCross);
    this.delayCross.connect(this.delayR);
    this.delayMergeL.connect(this.delayReturn);
    this.delayMergeR.connect(this.delayReturn);
    this.delayReturn.connect(this.sumBus);

    // --- コーラス（3 ボイス／位相をずらした LFO） ---
    this.chorusReturn = ctx.createGain();
    const baseTimes = [0.0091, 0.0134, 0.0177];
    const rates = [1, 1.37, 0.79];
    const pans = [-1, 0, 1];
    for (let i = 0; i < 3; i++) {
      const delay = ctx.createDelay(0.08);
      delay.delayTime.value = baseTimes[i];
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.5 * rates[i];
      const depth = ctx.createGain();
      depth.gain.value = 0.002;
      const pan = ctx.createStereoPanner();
      pan.pan.value = pans[i];
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      this.chorusSend.connect(delay);
      delay.connect(pan);
      pan.connect(this.chorusReturn);
      lfo.start();
      this.chorusVoices.push({ delay, lfo, depth, pan });
    }
    this.chorusReturn.connect(this.sumBus);

    // --- マスターチェーン ---
    this.driveNode = ctx.createWaveShaper();
    this.driveNode.oversample = '4x';
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 180;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.Q.value = 0.9;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 4500;
    this.comp = ctx.createDynamicsCompressor();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.06;
    this.masterGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    for (const a of [this.analyserL, this.analyserR]) {
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0.4;
    }

    this.sumBus.connect(this.driveNode);
    this.driveNode.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // 左右のチャンネルを分けてレベルを測る。無音のシンクへ流すことで、
    // 出力に影響を与えずにレンダリンググラフへ確実に組み込まれるようにする
    const splitter = ctx.createChannelSplitter(2);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    this.masterGain.connect(splitter);
    splitter.connect(this.analyserL, 0);
    splitter.connect(this.analyserR, 1);
    this.analyserL.connect(silent);
    this.analyserR.connect(silent);
    silent.connect(ctx.destination);

    this.applySettings(settings, true);
  }

  get realtimeCtx(): AudioContext | null {
    return typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext ? this.ctx : null;
  }

  resume() {
    const rt = this.realtimeCtx;
    if (rt && rt.state !== 'running') void rt.resume();
  }

  setTempo(bpm: number) {
    this.bpm = bpm;
    this.updateDelayTime();
  }

  /** 設定をグラフへ反映。immediate=true なら補間なしで即時適用（初期化・オフライン用） */
  applySettings(s: MasterSettings, immediate = false) {
    this.settings = s;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      if (immediate) p.setValueAtTime(v, t);
      else p.setTargetAtTime(v, t, 0.02);
    };

    set(this.masterGain.gain, s.volume);
    this.driveNode.curve = makeDriveCurve(s.drive) as Float32Array<ArrayBuffer>;
    set(this.eqLow.gain, s.eqLow);
    set(this.eqMid.gain, s.eqMid);
    set(this.eqMid.frequency, s.eqMidFreq);
    set(this.eqHigh.gain, s.eqHigh);

    // コンプレッサー（0 = ほぼバイパス、1 = 強め）
    const c = s.compress;
    set(this.comp.threshold, -6 - c * 22);
    set(this.comp.ratio, 1 + c * 7);
    set(this.comp.knee, 30 - c * 24);
    set(this.comp.attack, 0.006 - c * 0.004);
    set(this.comp.release, 0.25);
    set(this.limiter.threshold, s.limiter ? -1.2 : 0);

    set(this.reverbSend.gain, 1);
    set(this.reverbReturn.gain, s.reverb.mix * 1.5);
    set(this.reverbPre.delayTime, Math.min(0.45, s.reverb.preDelay));

    set(this.delayReturn.gain, s.delay.mix * 1.2);
    set(this.delayFb.gain, Math.min(0.92, s.delay.feedback));
    set(this.delayTone.frequency, 400 + s.delay.tone * 12000);
    set(this.delayCross.gain, s.delay.pingPong ? 0 : 1);
    this.updateDelayTime(immediate);

    set(this.chorusReturn.gain, s.chorus.mix * 1.3);
    for (let i = 0; i < this.chorusVoices.length; i++) {
      const v = this.chorusVoices[i];
      set(v.lfo.frequency, s.chorus.rate * [1, 1.37, 0.79][i]);
      set(v.depth.gain, 0.0006 + s.chorus.depth * 0.004);
      set(v.pan.pan, [-1, 0, 1][i] * s.chorus.spread);
    }
  }

  private updateDelayTime(immediate = false) {
    const s = this.settings.delay;
    const seconds = s.sync ? (60 / this.bpm) * Math.max(0.0625, s.division) : s.time;
    const clamped = Math.max(0.005, Math.min(3.9, seconds));
    const t = this.ctx.currentTime;
    for (const d of [this.delayL, this.delayR]) {
      if (immediate) d.delayTime.setValueAtTime(clamped, t);
      else d.delayTime.setTargetAtTime(clamped, t, 0.05);
    }
  }

  /** リバーブのインパルス応答を再生成（size / damp / width 変更時） */
  rebuildReverb() {
    const s = this.settings.reverb;
    this.convolver.buffer = buildReverbImpulse(this.ctx, s.size, s.damp, s.width);
  }

  // ------------------------------------------------------------------
  // リアルタイム録音（AudioWorklet ベース）
  // ------------------------------------------------------------------
  startRecording(): boolean {
    const rt = this.realtimeCtx;
    if (!rt || this.recording) return false;
    try {
      this.recorderNode = new AudioWorkletNode(rt, 'mss-recorder', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 });
    } catch {
      return false;
    }
    this.recChunks = [];
    this.recorderNode.port.onmessage = (e) => {
      if (e.data?.type === 'chunk') this.recChunks.push(e.data.channels as Float32Array[]);
    };
    this.masterGain.connect(this.recorderNode);
    this.recorderNode.port.postMessage({ type: 'start' });
    this.recording = true;
    return true;
  }

  stopRecording(): { channels: Float32Array[]; sampleRate: number } | null {
    if (!this.recording || !this.recorderNode) return null;
    this.recording = false;
    this.recorderNode.port.postMessage({ type: 'stop' });
    try {
      this.masterGain.disconnect(this.recorderNode);
    } catch {
      /* すでに切断済み */
    }
    this.recorderNode.disconnect();
    this.recorderNode = null;

    if (this.recChunks.length === 0) return null;
    const total = this.recChunks.reduce((sum, c) => sum + c[0].length, 0);
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    let off = 0;
    for (const chunk of this.recChunks) {
      left.set(chunk[0], off);
      right.set(chunk[1] ?? chunk[0], off);
      off += chunk[0].length;
    }
    this.recChunks = [];
    return { channels: [left, right], sampleRate: this.ctx.sampleRate };
  }
}
