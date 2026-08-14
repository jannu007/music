/*
 * Kurogane Bass - 物理モデリング・エレキベース音源プロセッサ
 *
 * 録音済みのサンプルを一切使わず、弦の振動をデジタル導波管（waveguide）で
 * その場で計算する。実機のベースと同じ構造をそのままモデル化している。
 *
 *  - 弦     : 遅延ループ + ループフィルター（1本の弦は同時に1音＝実機と同じ）
 *  - 偏波   : 縦振動／横振動の2ループ。わずかなズレが「うなり」と2段階減衰を生む
 *  - 弾く位置 : 励振を櫛形フィルター化して、ネック寄り／ブリッジ寄りの音色差を作る
 *  - ピックアップ : 位置の異なる2基（フロント／リア）を弦の2点読み出しで再現
 *  - 硬さ   : オールパス分散フィルターによる不協和度（太い弦ほど強い「唸り」）
 *  - フレット : 振幅が大きいとフレットに当たってビビる（スラップの音の正体）
 *  - 共鳴   : ブリッジを介した他弦への振動伝達（開放弦が一緒に鳴る）
 *
 * すべて浮動小数の再帰式なので、オフラインレンダリング（WAV書き出し）でも
 * リアルタイム再生と完全に同じ音になる。
 */

const MAX_STRINGS = 6;
/** 遅延線の長さ。48kHz で約 11.7Hz まで対応（5弦の低B = 30.9Hz でも余裕） */
const DELAY_MAX = 4096;
/** 励振バッファ長（撥弦の接触時間はどんなに長くても 20ms 程度） */
const EX_MAX = 1536;
const TWO_PI = Math.PI * 2;

/**
 * 奏法ごとの励振の性格。
 *   width    : 弦に触れている時間（ms）。短いほど倍音が増える
 *   noise    : 摩擦・爪・ピックの当たり音の量
 *   noiseHf  : ノイズの明るさ（0=こもる 1=シャリつく）
 *   pluckPos : 弦を弾く位置（ブリッジからの割合）。0 に近いほど硬い
 *   decay    : 余韻の倍率（ミュート系は短い）
 *   damp     : ループフィルターの追加ダンピング（0=そのまま 1=完全に丸い）
 *   level    : 音量の倍率
 *   buzz     : フレットに当たりやすさの倍率（スラップは弦を叩きつけるので大きい）
 */
const TECHNIQUES = {
  // 指弾き（2フィンガー）: 丸く太い基本の音
  finger:   { width: 2.6, noise: 0.30, noiseHf: 0.25, pluckPos: 0.185, decay: 1.00, damp: 0.00, level: 1.00, buzz: 1.00 },
  // ピック弾き: 接触時間が短く、当たりの音が硬い
  pick:     { width: 1.05, noise: 0.62, noiseHf: 0.80, pluckPos: 0.125, decay: 0.94, damp: -0.10, level: 1.02, buzz: 1.15 },
  // サムピング（親指で叩く）: 弦がフレットに当たって「バチッ」と鳴る
  slap:     { width: 0.85, noise: 0.55, noiseHf: 0.55, pluckPos: 0.34, decay: 0.90, damp: -0.14, level: 1.30, buzz: 2.60 },
  // プル（引っ張って離す）: 最も攻撃的
  pop:      { width: 0.70, noise: 0.66, noiseHf: 0.92, pluckPos: 0.115, decay: 0.88, damp: -0.18, level: 1.34, buzz: 2.30 },
  // ブリッジミュート（手のひらで軽く触れる）
  mute:     { width: 2.2, noise: 0.34, noiseHf: 0.30, pluckPos: 0.10, decay: 0.16, damp: 0.42, level: 0.92, buzz: 0.70 },
  // ゴーストノート（音程のない「ドッ」）
  ghost:    { width: 3.0, noise: 1.00, noiseHf: 0.42, pluckPos: 0.30, decay: 0.05, damp: 0.72, level: 0.72, buzz: 1.40 },
  // ハーモニクス: 節に軽く触れて倍音だけを鳴らす
  harmonic: { width: 1.6, noise: 0.16, noiseHf: 0.55, pluckPos: 0.24, decay: 1.35, damp: -0.05, level: 0.78, buzz: 0.35 },
  // ハンマリング／プリング（左手だけ）: 励振がごく弱い
  hammer:   { width: 3.6, noise: 0.22, noiseHf: 0.18, pluckPos: 0.42, decay: 0.96, damp: 0.06, level: 0.45, buzz: 1.20 },
};
const TECH_NAMES = Object.keys(TECHNIQUES);

const DEFAULT_PARAMS = {
  gain: 0.9,
  /** 余韻の長さ 0.4..1.7 */
  sustain: 1.0,
  /** 弦の明るさ（新しい弦 ↔ 使い込んだ弦） 0..1 */
  brightness: 0.55,
  /** 弦の硬さ＝不協和度 0..1 */
  stiffness: 0.45,
  /** 弾く位置の補正 -1..1（奏法ごとの既定値をずらす） */
  pluckPos: 0,
  /** フロント（ネック側）ピックアップ位置：ブリッジからの割合 */
  pickupNeck: 0.30,
  /** リア（ブリッジ側）ピックアップ位置 */
  pickupBridge: 0.115,
  /** ピックアップ・ブレンド 0=フロント 1=リア */
  pickupBlend: 0.42,
  /** 偏波のズレ（うなり） 0..1 */
  beat: 0.5,
  /** 他弦への共鳴 0..1 */
  sympathetic: 0.35,
  /** フレットのビビり（弦高の低さ） 0..1 */
  buzz: 0.38,
  /** 撥弦ノイズ 0..1 */
  noise: 0.5,
  /** ベロシティカーブ 0.5..2.2 */
  velCurve: 1.0,
  /** ダイナミクスレンジ 0.4..1.4 */
  dynamics: 1.0,
  /** ミュート（消音）の速さ 0..1 */
  release: 0.5,
  /** フレットレス 0/1 */
  fretless: 0,
  /** 基準ピッチ（開放弦の共鳴に使う） */
  a4: 440,
  /** オートワウ（エンベロープフィルター）の効き 0..1 */
  wah: 0,
  /** オートワウの反応の速さ 0..1 */
  wahSens: 0.5,
  /** スライドにかかる時間（秒） */
  glide: 0.055,
  /** 弦の数 */
  stringCount: 4,
  /** 各弦の開放音（MIDIノート） */
  tuning: [28, 33, 38, 43],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 1極ローパス y[n] = y[n-1] + a(x[n] - y[n-1]) の f における位相遅れ（サンプル） */
function lowpassPhaseDelay(a, w) {
  if (w < 1e-6) return 0;
  const b = 1 - a;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

/** 1次オールパス (c + z^-1)/(1 + c z^-1) の f における位相遅れ（サンプル） */
function allpassPhaseDelay(c, w) {
  if (w < 1e-6) return (1 - c) / (1 + c);
  const num = Math.atan2(-Math.sin(w), c + Math.cos(w));
  const den = Math.atan2(-c * Math.sin(w), 1 + c * Math.cos(w));
  return -(num - den) / w;
}

/** 1本の弦（縦・横2方向の振動を持つ） */
class StringVoice {
  constructor() {
    this.buf = [new Float64Array(DELAY_MAX), new Float64Array(DELAY_MAX)];
    this.write = 0;

    this.delay = [200, 200];      // 現在の遅延長（サンプル・小数）
    this.target = [200, 200];     // スライド／チョーキングの目標
    this.lp = [0, 0];             // ループフィルター状態
    this.lpA = [0.5, 0.5];        // ループフィルター係数
    this.loopGain = [0.99, 0.99];
    this.ap1x = [0, 0]; this.ap1y = [0, 0];
    this.ap2x = [0, 0]; this.ap2y = [0, 0];
    this.apC = 0;
    this.polGain = [0.62, 0.38];

    this.ex = new Float64Array(EX_MAX);
    this.exLen = 0;
    this.exPos = 0;
    this.exOffset = 0;
    this.exGain = 0;

    this.tapNeckA = 0; this.tapNeckB = 0;
    this.tapBridgeA = 0; this.tapBridgeB = 0;

    this.buzzLimit = 1e9;
    this.dcX = 0; this.dcY = 0;
    this.glideCoef = 1;
    this.bridgeOut = 0;
    this.active = false;
    /** 弾かれてはいないが、開放弦として共鳴できる状態か */
    this.armed = false;
    this.peak = 0;
    this.silentBlocks = 0;
    this.fret = 0;
    this.freq = 0;
    this.openNote = 28;
    this.thickness = 0.5;
    this.slideNoise = 0;
    this.slideNoiseLp = 0;
    this.age = 0;
  }

  reset() {
    this.buf[0].fill(0);
    this.buf[1].fill(0);
    this.lp[0] = this.lp[1] = 0;
    this.ap1x[0] = this.ap1x[1] = 0;
    this.ap1y[0] = this.ap1y[1] = 0;
    this.ap2x[0] = this.ap2x[1] = 0;
    this.ap2y[0] = this.ap2y[1] = 0;
    this.dcX = this.dcY = 0;
    this.exLen = 0;
    this.exPos = 0;
    this.bridgeOut = 0;
    this.slideNoise = 0;
    this.active = false;
    this.armed = false;
    this.peak = 0;
    this.silentBlocks = 0;
  }

  /** 遅延線の中身を弱める（新しく弾き直すときに指が触れる分） */
  dampContents(factor) {
    const a = this.buf[0];
    const b = this.buf[1];
    for (let i = 0; i < DELAY_MAX; i++) {
      a[i] *= factor;
      b[i] *= factor;
    }
    this.lp[0] *= factor;
    this.lp[1] *= factor;
  }
}

class BassProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.params = { ...DEFAULT_PARAMS, tuning: [...DEFAULT_PARAMS.tuning] };
    this.frame = 0;
    this.pending = [];

    this.strings = [];
    for (let i = 0; i < MAX_STRINGS; i++) this.strings.push(new StringVoice());

    this.coupling = 0;      // ブリッジに集まる振動
    this.blockCount = 0;

    // オートワウ（弾く強さでフィルターが開くエンベロープフィルター）
    this.wahEnv = 0;
    this.wahLp = 0;
    this.wahBp = 0;

    // 弦とボディを繋ぐ簡易な胴鳴り（2つの共振）
    this.bodyY1 = [0, 0];
    this.bodyY2 = [0, 0];
    this.bodyA1 = [0, 0];
    this.bodyA2 = [0, 0];
    this.bodyG = [0, 0];

    const opts = (options && options.processorOptions) || {};
    if (opts.params) this.setParams(opts.params);
    this.configureStrings();
    this.buildBody();

    if (Array.isArray(opts.events)) {
      for (const ev of opts.events) {
        if (ev.atFrame > 0) this.pending.push(ev);
        else this.applyEvent(ev);
      }
    }

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  // ---------------------------------------------------------------- messages

  setParams(values) {
    for (const key of Object.keys(values)) {
      if (key === 'tuning') {
        const t = values.tuning;
        if (Array.isArray(t) && t.length > 0) this.params.tuning = t.slice(0, MAX_STRINGS);
      } else if (key in this.params) {
        this.params[key] = values[key];
      }
    }
    this.params.stringCount = clamp(this.params.stringCount | 0, 4, MAX_STRINGS);
  }

  handleMessage(msg) {
    if (!msg) return;
    if (msg.type === 'params') {
      this.setParams(msg.values);
      this.configureStrings();
      return;
    }
    if (msg.type === 'panic') {
      this.pending.length = 0;
      for (const s of this.strings) s.reset();
      this.coupling = 0;
      return;
    }
    if (msg.atFrame !== undefined && msg.atFrame > this.frame) {
      this.pending.push(msg);
      return;
    }
    this.applyEvent(msg);
  }

  applyEvent(msg) {
    switch (msg.type) {
      case 'pluck':
        this.pluck(msg.str, msg.freq, msg.vel, msg.tech, msg.fret);
        break;
      case 'slide':
        this.retune(msg.str, msg.freq, msg.fret, msg.glide);
        break;
      case 'bend':
        this.retune(msg.str, msg.freq, msg.fret, 0.012);
        break;
      case 'mute':
        this.mute(msg.str, msg.amount === undefined ? 1 : msg.amount);
        break;
      case 'muteAll':
        for (let i = 0; i < this.params.stringCount; i++) this.mute(i, 1);
        break;
    }
  }

  drainPending() {
    if (this.pending.length === 0) return;
    const limit = this.frame + 128;
    let write = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const ev = this.pending[i];
      if (ev.atFrame < limit) this.applyEvent(ev);
      else this.pending[write++] = ev;
    }
    this.pending.length = write;
  }

  // -------------------------------------------------------------- string set

  /** 弦の太さなど、チューニングから決まる性質を作り直す */
  configureStrings() {
    const p = this.params;
    for (let i = 0; i < MAX_STRINGS; i++) {
      const s = this.strings[i];
      const open = p.tuning[i] !== undefined ? p.tuning[i] : 28 + i * 5;
      s.openNote = open;
      // G弦(43)を 0、低B(23)を 1 とした太さ
      s.thickness = clamp((43 - open) / 20, 0, 1.15);
      // チューニングが変わったら開放弦の共鳴も調律し直す
      if (!s.active) s.armed = false;
    }
  }

  /**
   * 押さえられていない弦を開放の音程に合わせておく。
   * 他の弦を弾いたときに、この弦がブリッジ経由で一緒に鳴る（共鳴弦）。
   */
  armOpen(s) {
    const freq = this.params.a4 * Math.pow(2, (s.openNote - 69) / 12);
    // 残っているわずかな振動を消してから調律する。
    // 消さずに減衰時間だけ伸ばすと、止めたはずの音が甦ってしまう。
    s.dampContents(0.02);
    this.tuneString(s, freq, 'finger', true);
    s.armed = true;
    s.exLen = 0;
    s.exPos = 0;
    s.silentBlocks = 0;
  }

  /** ボディ／ネックの胴鳴り（ソリッドボディなので控えめ） */
  buildBody() {
    const specs = [
      { f: 92, q: 6.5, g: 0.30 },
      { f: 196, q: 8.0, g: 0.18 },
    ];
    for (let i = 0; i < specs.length; i++) {
      const { f, q, g } = specs[i];
      const w = TWO_PI * f / sampleRate;
      const r = Math.exp(-w / (2 * q));
      this.bodyA1[i] = 2 * r * Math.cos(w);
      this.bodyA2[i] = -r * r;
      this.bodyG[i] = (1 - r) * Math.sin(w) * g;
      this.bodyY1[i] = 0;
      this.bodyY2[i] = 0;
    }
  }

  // ------------------------------------------------------------------ tuning

  /**
   * 指定した周波数で弦が鳴るよう、遅延長・ループフィルター・分散を決める。
   * ループフィルターとオールパスの位相遅れを差し引くので、音程は数セント以内に収まる。
   */
  tuneString(s, freq, tech, fromPluck) {
    const p = this.params;
    const t = TECHNIQUES[tech] || TECHNIQUES.finger;
    const f0 = clamp(freq, 14, 1400);
    const w0 = TWO_PI * f0 / sampleRate;
    const thick = s.thickness;

    // --- ループフィルター（高域の減衰）---
    // 新しい弦ほど、細い弦ほど高域が残る。ミュート系はさらに丸くなる。
    const damp = clamp(0.5 + t.damp - (p.brightness - 0.5) * 0.9 + thick * 0.16, 0.02, 0.98);
    let fc = 260 + 9000 * Math.pow(1 - damp, 2.0);
    if (p.fretless) fc *= 0.72;             // 指板に当たる分だけ高域が落ちる
    fc = clamp(fc, 150, sampleRate * 0.35);
    const a = 1 - Math.exp(-TWO_PI * fc / sampleRate);

    // --- 分散（弦の硬さ）---
    // 太い弦ほど高次倍音が高めにずれ、あの「ゴリッ」とした唸りになる
    const stiff = clamp(p.stiffness, 0, 1) * (0.45 + 0.85 * thick);
    const apC = -clamp(stiff * 0.16, 0, 0.4);
    s.apC = apC;

    // --- 減衰時間（T60）---
    const note = 69 + 12 * Math.log2(f0 / 440);
    let t60 = (11.5 * Math.exp(-0.055 * (note - 28)) + 1.1)
      * clamp(p.sustain, 0.3, 1.8)
      * t.decay;
    if (p.fretless) t60 *= 0.92;
    t60 = clamp(t60, 0.05, 40);

    // --- 偏波（縦・横）: 片方は速く減衰し、わずかに音程がずれる ---
    const beat = clamp(p.beat, 0, 1);
    const detune = 0.14 + beat * 1.9;        // cent
    const phaseLP = lowpassPhaseDelay(a, w0);
    const phaseAP = allpassPhaseDelay(apC, w0) * 2;

    for (let pol = 0; pol < 2; pol++) {
      const ratio = pol === 0 ? 1 : Math.pow(2, detune / 1200);
      const total = sampleRate / (f0 * ratio);
      const d = clamp(total - phaseLP - phaseAP, 4, DELAY_MAX - 4);
      s.target[pol] = d;
      if (fromPluck || s.delay[pol] < 4) s.delay[pol] = d;
      s.lpA[pol] = a;
      // 縦振動（pol=1）はブリッジに逃げやすく、速く減衰する
      const decayScale = pol === 0 ? 1 : 0.34 + 0.22 * (1 - beat);
      const g = Math.pow(10, -3 / (f0 * ratio * t60 * decayScale));
      s.loopGain[pol] = clamp(g, 0, 0.99995);
    }
    s.polGain[0] = 0.66;
    s.polGain[1] = 0.34;

    // --- ピックアップの読み出し位置（弦の2点の差が出力になる）---
    const setTaps = (pos, key) => {
      const d = s.target[0];
      const o1 = Math.max(1, Math.round(clamp(pos, 0.02, 0.48) * d * 0.5));
      const o2 = Math.max(o1 + 1, Math.round(d) - o1);
      s[key + 'A'] = o1;
      s[key + 'B'] = clamp(o2, 1, DELAY_MAX - 1);
    };
    setTaps(p.pickupNeck, 'tapNeck');
    setTaps(p.pickupBridge, 'tapBridge');

    // --- フレットに当たる限界振幅（弦高）---
    const buzzAmount = clamp(p.buzz, 0, 1) * t.buzz;
    s.buzzLimit = buzzAmount <= 0.001 ? 1e9 : 0.055 / (0.04 + buzzAmount * 0.9);
    s.freq = f0;
  }

  // ------------------------------------------------------------------ events

  pluck(strIndex, freq, velocity, tech, fret) {
    const p = this.params;
    const idx = clamp(strIndex | 0, 0, p.stringCount - 1);
    const s = this.strings[idx];
    const name = TECH_NAMES.includes(tech) ? tech : 'finger';
    const t = TECHNIQUES[name];

    const vel = clamp(velocity, 0.02, 1);
    const velCurved = Math.pow(vel, clamp(p.velCurve, 0.4, 2.5));
    const dyn = clamp(p.dynamics, 0.2, 1.6);
    let amp = Math.pow(0.06 + 0.94 * velCurved, dyn) * t.level;

    // 弾き直しでは、まず指／ピックが弦に触れて前の振動を止める
    s.dampContents(name === 'hammer' ? 0.86 : 0.22 - velCurved * 0.1);
    this.tuneString(s, freq, name, true);

    // --- 励振（弦をはじく力）---
    // 強く弾くほど接触時間が短くなり、音量だけでなく音色も明るくなる
    const widthMs = t.width * (1.35 - 0.55 * velCurved) * (1 + s.thickness * 0.45);
    const width = clamp(Math.round((widthMs / 1000) * sampleRate), 3, EX_MAX - 2);
    const noiseAmt = clamp(p.noise, 0, 1) * t.noise;
    const noiseCoef = 0.08 + 0.6 * t.noiseHf;

    const ex = s.ex;
    let lpn = 0;
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const u = i / width;
      // 撥弦の力：立ち上がりが速く、離れる瞬間に鋭いピークを持つ非対称な形
      const bump = Math.pow(Math.sin(Math.PI * u), 1.4);
      lpn += ((Math.random() * 2 - 1) - lpn) * noiseCoef;
      const scratch = lpn * noiseAmt * Math.pow(1 - u, 1.6);
      const v = bump + scratch;
      ex[i] = v;
      sum += v;
    }
    // 直流成分を抜く（弦は静止位置に戻るので、力積の総和はゼロ）
    const mean = sum / Math.max(1, width);
    for (let i = 0; i < width; i++) ex[i] -= mean;
    for (let i = width; i < EX_MAX; i++) ex[i] = 0;

    // --- 弾く位置による櫛形フィルター ---
    // 弦の同じ点に符号の違う2つの波が生まれる = ここで倍音の欠けが決まる
    const pos = clamp(t.pluckPos + p.pluckPos * 0.14, 0.03, 0.48);
    const offset = clamp(Math.round(s.target[0] * pos), 1, DELAY_MAX - 2);
    s.exOffset = offset;
    s.exLen = width + offset;
    s.exPos = 0;
    // ループの共振で持ち上がる分を打ち消し、音域が変わっても音量を揃える
    const norm = (1 - s.loopGain[0]) * 0.5 + 0.06;
    s.exGain = amp * 0.85 * Math.pow(norm, 0.34);

    s.active = true;
    s.armed = false;
    s.glideCoef = 1;
    s.bridgeOut = 0;
    s.fret = fret === undefined ? 0 : fret;
    s.age = this.frame;
  }

  /** 弾き直さずに音程だけ変える（スライド・ハンマリング・チョーキング） */
  retune(strIndex, freq, fret, time) {
    const p = this.params;
    const idx = clamp(strIndex | 0, 0, p.stringCount - 1);
    const s = this.strings[idx];
    if (!s.active) return;

    const before = s.target[0];
    this.tuneString(s, freq, 'finger', false);
    const glide = time === undefined ? p.glide : time;
    s.glideCoef = 1 - Math.exp(-1 / Math.max(1, glide * sampleRate));

    // フレットをまたぐスライドでは指が擦れる音が出る
    const semis = Math.abs(Math.log2(before / Math.max(1, s.target[0])) * 12);
    if (semis > 0.7 && !p.fretless) {
      s.slideNoise = Math.min(0.5, 0.05 + semis * 0.02) * clamp(p.noise, 0, 1);
    }
    if (fret !== undefined) s.fret = fret;
  }

  /** 弦に触れて止める（0=そのまま 1=完全に止める） */
  mute(strIndex, amount) {
    const p = this.params;
    const idx = clamp(strIndex | 0, 0, p.stringCount - 1);
    const s = this.strings[idx];
    if (!s.active) return;
    const a = clamp(amount, 0, 1);
    if (a <= 0.02) return;

    // 指を置く速さ：release が大きいほどすぐ止まる
    const t60 = (0.42 - clamp(p.release, 0, 1) * 0.33) / (0.25 + a * 0.75);
    const f0 = Math.max(20, s.freq);
    const g = Math.pow(10, -3 / (f0 * Math.max(0.02, t60)));
    for (let pol = 0; pol < 2; pol++) {
      s.loopGain[pol] = Math.min(s.loopGain[pol], g);
      // 指が触れると高域から先に消える
      s.lpA[pol] = Math.min(s.lpA[pol], 1 - Math.exp(-TWO_PI * (900 - a * 500) / sampleRate));
    }
  }

  // ------------------------------------------------------------------ render

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0];
    const right = out.length > 1 ? out[1] : out[0];
    const n = left.length;

    this.drainPending();
    left.fill(0);
    if (right !== left) right.fill(0);

    const p = this.params;
    const count = clamp(p.stringCount | 0, 4, MAX_STRINGS);
    const blend = clamp(p.pickupBlend, 0, 1);
    const gNeck = Math.cos(blend * Math.PI * 0.5);
    const gBridge = Math.sin(blend * Math.PI * 0.5);
    const symp = clamp(p.sympathetic, 0, 1) * 0.02;
    const sympOn = symp > 1e-4;
    const master = p.gain;
    const wahAmount = clamp(p.wah, 0, 1);
    const wahSens = clamp(p.wahSens, 0, 1);
    const wahAttack = 1 - Math.exp(-1 / (0.004 * sampleRate));
    const wahRelease = 1 - Math.exp(-1 / ((0.34 - wahSens * 0.28) * sampleRate));
    let active = 0;

    // 弾かれていない弦も開放弦として鳴らせるように調律しておく
    if (sympOn) {
      for (let si = 0; si < count; si++) {
        const s = this.strings[si];
        if (!s.active && !s.armed) this.armOpen(s);
      }
    }

    for (let i = 0; i < n; i++) {
      let mix = 0;
      let bridge = 0;

      for (let si = 0; si < count; si++) {
        const s = this.strings[si];
        if (!s.active && !(sympOn && s.armed)) continue;

        // 前サンプルでブリッジに集まった振動を他の弦へ伝える。
        // 自分自身の分を引かないとループ利得が 1 を超えて発振するため必ず除く。
        const drive = (this.coupling - s.bridgeOut) * symp;
        let own = 0;

        // --- 励振（撥弦位置による正負2つの波）---
        let exc = 0;
        if (s.exPos < s.exLen) {
          const k = s.exPos;
          const a0 = k < EX_MAX ? s.ex[k] : 0;
          const k2 = k - s.exOffset;
          const a1 = k2 >= 0 && k2 < EX_MAX ? s.ex[k2] : 0;
          exc = (a1 - a0) * s.exGain;
          s.exPos++;
        }
        if (s.slideNoise > 1e-5) {
          s.slideNoiseLp += ((Math.random() * 2 - 1) - s.slideNoiseLp) * 0.55;
          exc += s.slideNoiseLp * s.slideNoise * 0.06;
          s.slideNoise *= 0.9994;
        }

        const buf0 = s.buf[0];
        const buf1 = s.buf[1];
        const w = s.write;
        const glide = s.glideCoef || 1;
        let sample = 0;

        for (let pol = 0; pol < 2; pol++) {
          const buf = pol === 0 ? buf0 : buf1;

          // スライド／チョーキングでは遅延長がなめらかに変化する
          let d = s.delay[pol];
          const tgt = s.target[pol];
          if (d !== tgt) {
            d += (tgt - d) * glide;
            if (Math.abs(tgt - d) < 1e-4) d = tgt;
            s.delay[pol] = d;
          }

          // --- 遅延線の読み出し（線形補間）---
          let rp = w - d;
          while (rp < 0) rp += DELAY_MAX;
          const i0 = rp | 0;
          const frac = rp - i0;
          const i1 = i0 + 1 >= DELAY_MAX ? 0 : i0 + 1;
          let y = buf[i0] + (buf[i1] - buf[i0]) * frac;

          // --- ループフィルター（高域ほど速く減衰）---
          const lp = s.lp[pol] + s.lpA[pol] * (y - s.lp[pol]);
          s.lp[pol] = lp;
          y = lp * s.loopGain[pol];

          // --- 分散（弦の硬さによる不協和度）---
          const c = s.apC;
          if (c !== 0) {
            const a1y = c * y + s.ap1x[pol] - c * s.ap1y[pol];
            s.ap1x[pol] = y; s.ap1y[pol] = a1y;
            const a2y = c * a1y + s.ap2x[pol] - c * s.ap2y[pol];
            s.ap2x[pol] = a1y; s.ap2y[pol] = a2y;
            y = a2y;
          }

          // --- フレットとの衝突（振幅が大きいと弦が当たってビビる）---
          const limit = s.buzzLimit;
          if (y > limit) y = limit + (y - limit) * 0.22;
          else if (y < -limit) y = -limit + (y + limit) * 0.22;

          buf[w] = y + exc * (pol === 0 ? 0.72 : 0.28) + drive;

          // --- ピックアップ（弦の2点の差を読む＝位置による櫛形フィルター）---
          let t1 = w - s.tapNeckA; if (t1 < 0) t1 += DELAY_MAX;
          let t2 = w - s.tapNeckB; if (t2 < 0) t2 += DELAY_MAX;
          let t3 = w - s.tapBridgeA; if (t3 < 0) t3 += DELAY_MAX;
          let t4 = w - s.tapBridgeB; if (t4 < 0) t4 += DELAY_MAX;
          const neck = buf[t1] - buf[t2];
          const brdg = buf[t3] - buf[t4];
          sample += (neck * gNeck + brdg * gBridge) * s.polGain[pol];
          own += y * s.polGain[pol];
        }

        s.bridgeOut = own;
        bridge += own;
        s.write = w + 1 >= DELAY_MAX ? 0 : w + 1;

        // --- DCカット（ピックアップはコイルなので直流は出ない）---
        const dc = sample - s.dcX + 0.9985 * s.dcY;
        s.dcX = sample;
        s.dcY = dc;

        const av = dc < 0 ? -dc : dc;
        if (av > s.peak) s.peak = av;
        mix += dc;
      }

      this.coupling = bridge;

      // --- ボディ／ネックの鳴り ---
      let body = 0;
      for (let b = 0; b < 2; b++) {
        const y = this.bodyA1[b] * this.bodyY1[b] + this.bodyA2[b] * this.bodyY2[b] + this.bodyG[b] * mix;
        this.bodyY2[b] = this.bodyY1[b];
        this.bodyY1[b] = y;
        body += y;
      }

      let s = mix + body;

      // --- オートワウ（弾いた強さでフィルターが開く）---
      if (wahAmount > 0) {
        const av = s < 0 ? -s : s;
        // アタックは速く、戻りはゆっくり（実機のエンベロープフィルターと同じ）
        if (av > this.wahEnv) this.wahEnv += (av - this.wahEnv) * wahAttack;
        else this.wahEnv += (av - this.wahEnv) * wahRelease;

        const fc = clamp(150 + 5200 * Math.min(1, this.wahEnv * 9), 80, sampleRate * 0.24);
        const f = 2 * Math.sin(Math.PI * fc / sampleRate);
        const hp = s - this.wahLp - 0.35 * this.wahBp;
        this.wahBp += f * hp;
        this.wahLp += f * this.wahBp;
        s = s * (1 - wahAmount) + this.wahBp * wahAmount * 1.4;
      }

      s *= master;
      left[i] += s;
      if (right !== left) right[i] += s;
    }

    // --- 鳴り終わった弦を止める（CPUの節約）---
    for (let si = 0; si < count; si++) {
      const s = this.strings[si];
      if (!s.active) continue;
      // 弦の出力はパルス状で、1周期のあいだに無音の谷がある。
      // 1ブロックだけ静かでも止めず、静かなブロックが続いたときだけ解放する。
      // また低音は波が1周してくるまで出力が現れないため、数周ぶんは待つ。
      s.silentBlocks = s.peak < 2e-5 ? s.silentBlocks + 1 : 0;
      const settled = this.frame - s.age > 2 * s.delay[0] + 256;
      if (settled && s.silentBlocks > 24 && s.exPos >= s.exLen) {
        s.active = false;
        s.armed = false;
      } else {
        active++;
      }
      s.peak = 0;
    }

    this.frame += n;
    if (++this.blockCount % 16 === 0) {
      this.port.postMessage({ type: 'status', voices: active, frame: this.frame });
    }
    return true;
  }
}

registerProcessor('bass-processor', BassProcessor);
