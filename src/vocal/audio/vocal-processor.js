/*
 * Hoshizora Vocal — 歌声合成プロセッサ
 *
 * 録音した人の声（サンプル素材）は一切使わず、声を物理モデルで組み立てる。
 *   声帯   : 声門流の微分波（開放相の多項式 + 戻り相）＋ ゆらぎ（ジッタ／シマー）
 *   声道   : 5段の共振器カスケード + 鼻音の極零対（Klatt 型のカスケード合成）
 *   雑音   : 気息（声道を通る）と摩擦・破裂（独立したバンドパス2段）
 * これらを制御曲線（compile.ts が作る折れ線）で時間変化させて「歌」にする。
 *
 * 伴奏も同じプロセッサ内の小さな合成音源で鳴らす（出力2系統）。
 * すべて再帰式なので、オフライン書き出しでも再生と完全に同じ波形になる。
 */

const CONTROL_STEP = 16; // 制御パラメータの更新間隔（サンプル）
const MAX_ACCOMP_VOICES = 28;
const TWO_PI = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 白色雑音（xorshift。乱数列が固定なので書き出しでも同じ音になる） */
class Noise {
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return (this.s / 0x80000000) - 1;
  }
}

/** 2極共振器（直流でゲイン1に正規化＝フォルマント用） */
class Resonator {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0;
    this.y1 = 0; this.y2 = 0;
  }
  set(freq, bw, sr) {
    const r = Math.exp((-Math.PI * bw) / sr);
    const theta = (TWO_PI * freq) / sr;
    this.b = 2 * r * Math.cos(theta);
    this.c = -r * r;
    this.a = 1 - this.b - this.c;
  }
  run(x) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  reset() {
    this.y1 = 0; this.y2 = 0;
  }
}

/** 2零フィルター（鼻音の反共振） */
class AntiResonator {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0;
    this.x1 = 0; this.x2 = 0;
  }
  set(freq, bw, sr) {
    const r = Math.exp((-Math.PI * bw) / sr);
    const theta = (TWO_PI * freq) / sr;
    const b = 2 * r * Math.cos(theta);
    const c = -r * r;
    // 極と同じ形の分子にして、極零が一致したとき完全に打ち消し合うようにする
    const a = 1 - b - c;
    this.a = 1 / a;
    this.b = -b / a;
    this.c = -c / a;
  }
  run(x) {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2;
    this.x2 = this.x1;
    this.x1 = x;
    return y;
  }
  reset() {
    this.x1 = 0; this.x2 = 0;
  }
}

/** ピークでゲイン1のバンドパス（摩擦音用） */
class BandPass {
  constructor() {
    this.a = 0; this.b = 0; this.c = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  set(freq, bw, sr) {
    const r = Math.exp((-Math.PI * bw) / sr);
    const theta = (TWO_PI * Math.min(freq, sr * 0.48)) / sr;
    this.b = 2 * r * Math.cos(theta);
    this.c = -r * r;
    this.a = (1 - r * r) * 0.5;
  }
  run(x) {
    const y = this.a * (x - this.x2) + this.b * this.y1 + this.c * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  reset() {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
}

// --------------------------------------------------------------- 伴奏の音源

class AccompVoice {
  constructor() {
    this.active = false;
    this.inst = 0;
    this.startFrame = 0;
    this.endFrame = 0;
    this.freq = 440;
    this.note = 60;
    this.vel = 0.5;
    this.pan = 0;
    this.done = false;
    this.phase = 0;
    this.phase2 = 0;
    this.phase3 = 0;
    this.env = 0;
    this.env2 = 0;
    this.lp = 0; this.lp2 = 0;
    this.hp = 0; this.hpx = 0;
    this.released = false;
    this.ks = null;
    this.ksIndex = 0;
    this.age = 0;
  }
}

/** polyBLEP（のこぎり波のエイリアスを抑える補正） */
function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

class VocalProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    const layout = opts.layout || [];
    this.index = {};
    layout.forEach((name, i) => {
      this.index[name] = i;
    });
    this.paramCount = layout.length;
    this.a4 = opts.a4 || 440;
    this.vocalGain = opts.vocalGain === undefined ? 1 : opts.vocalGain;
    this.accompGain = opts.accompGain === undefined ? 1 : opts.accompGain;

    // --- 制御曲線 ---
    this.times = null;
    this.values = null;
    this.curves = null;
    this.offsets = null;
    this.cursor = new Int32Array(this.paramCount);
    this.p = new Float32Array(this.paramCount);
    this.smoothed = new Float32Array(this.paramCount);
    this.smoothCoef = new Float32Array(this.paramCount);
    this.startFrame = 0;
    this.duration = 0;
    this.playing = false;
    this.reported = -1;

    this.setupSmoothing(layout);

    // --- 声のDSP ---
    this.sr = sampleRate;
    this.noise = new Noise(0x2545f491);
    this.formants = [new Resonator(), new Resonator(), new Resonator(), new Resonator(), new Resonator()];
    this.nasalPole = new Resonator();
    this.nasalZero = new AntiResonator();
    this.fric1 = new BandPass();
    this.fric2 = new BandPass();
    this.phase = 0;
    this.jitter = 0;
    this.shimmer = 0;
    this.driftValue = 0;
    this.driftTarget = 0;
    this.driftCount = 0;
    this.periodCount = 0;
    this.periodGain = 1;
    this.tiltState = 0;
    this.bodyState = 0;
    this.barState = 0;
    this.dcX = 0;
    this.dcY = 0;
    this.vibPhase = 0;
    this.noiseLp = 0;

    // --- 伴奏 ---
    this.accomp = [];
    this.accompIndex = 0;
    this.voices = [];
    for (let i = 0; i < MAX_ACCOMP_VOICES; i++) this.voices.push(new AccompVoice());
    this.voiceAge = 0;

    this.port.onmessage = (e) => this.onMessage(e.data);

    // オフライン書き出しでは postMessage がレンダリングに間に合わないことがあるため、
    // 曲データを processorOptions で直接受け取れるようにしておく。
    if (opts.load) this.onMessage({ type: 'load', ...opts.load });
  }

  /** パラメータごとの追従の速さ（急に変わると歪むものはゆっくりにする） */
  setupSmoothing(layout) {
    const tau = {
      pitch: 0.004, level: 0.003, breath: 0.006, fric: 0.0015,
      nz: 0.008, np: 0.008, oq: 0.01, rq: 0.01, tilt: 0.008,
      vibDepth: 0.02, vibRate: 0.05, growl: 0.02, bar: 0.004,
      body: 0.02, drift: 0.05,
    };
    layout.forEach((name, i) => {
      let t = tau[name];
      if (t === undefined) t = /^[fb][1-5]$/.test(name) ? 0.006 : 0.004;
      const dt = CONTROL_STEP / sampleRate;
      this.smoothCoef[i] = 1 - Math.exp(-dt / t);
    });
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'load': {
        this.times = msg.times;
        this.values = msg.values;
        this.curves = msg.curves;
        this.offsets = msg.offsets;
        this.accomp = msg.accomp || [];
        this.startFrame = msg.startFrame || 0;
        this.duration = msg.duration || 0;
        this.cursor.fill(0);
        this.accompIndex = 0;
        this.playing = true;
        this.reported = -1;
        this.resetVoices();
        this.primeSmoothing();
        break;
      }
      case 'stop':
        this.playing = false;
        this.releaseAll();
        break;
      case 'params':
        if (msg.a4) this.a4 = msg.a4;
        if (msg.vocalGain !== undefined) this.vocalGain = msg.vocalGain;
        if (msg.accompGain !== undefined) this.accompGain = msg.accompGain;
        break;
      default:
        break;
    }
  }

  resetVoices() {
    for (const v of this.voices) v.active = false;
    for (const f of this.formants) f.reset();
    this.nasalPole.reset();
    this.nasalZero.reset();
    this.fric1.reset();
    this.fric2.reset();
    this.phase = 0;
    this.vibPhase = 0;
    this.dcX = 0;
    this.dcY = 0;
    this.tiltState = 0;
    this.bodyState = 0;
  }

  releaseAll() {
    for (const v of this.voices) v.released = true;
  }

  /** 再生開始時に、曲頭のパラメータへ一気に合わせる */
  primeSmoothing() {
    this.evaluate(0);
    this.smoothed.set(this.p);
    this.applyCoefficients();
  }

  /** 制御曲線から時刻 t（秒）の値を取り出す */
  evaluate(t) {
    const { times, values, curves, offsets } = this;
    if (!times) return;
    for (let i = 0; i < this.paramCount; i++) {
      const begin = offsets[i];
      const end = offsets[i + 1];
      if (end <= begin) continue;
      let idx = this.cursor[i];
      if (idx < begin || idx >= end) idx = begin;
      // 巻き戻し（再生位置が戻った場合）
      if (t < times[idx]) idx = begin;
      while (idx + 1 < end && t >= times[idx + 1]) idx++;
      this.cursor[i] = idx;

      let v;
      if (idx + 1 >= end) {
        v = values[idx];
      } else {
        const t0 = times[idx];
        const t1 = times[idx + 1];
        if (t <= t0 || t1 <= t0) {
          v = values[idx];
        } else {
          let u = (t - t0) / (t1 - t0);
          const curve = curves[idx + 1];
          if (curve === 0) u = 0;
          else if (curve === 2) u = u * u * (3 - 2 * u);
          v = values[idx] + (values[idx + 1] - values[idx]) * u;
        }
      }
      this.p[i] = v;
    }
  }

  /** なめらかにした値をフィルター係数へ反映する */
  applyCoefficients() {
    const s = this.smoothed;
    const ix = this.index;
    const sr = this.sr;
    for (let k = 0; k < 5; k++) {
      const f = clamp(s[ix['f' + (k + 1)]], 90, sr * 0.47);
      const b = clamp(s[ix['b' + (k + 1)]], 30, 2000);
      this.formants[k].set(f, b, sr);
    }
    this.nasalPole.set(clamp(s[ix.np], 150, 1500), 130, sr);
    this.nasalZero.set(clamp(s[ix.nz], 150, 1500), 130, sr);
    this.fric1.set(clamp(s[ix.sf1], 200, sr * 0.47), clamp(s[ix.sb1], 100, 4000), sr);
    this.fric2.set(clamp(s[ix.sf2], 200, sr * 0.47), clamp(s[ix.sb2], 100, 4000), sr);
  }

  // ------------------------------------------------------------------ 歌声

  renderVoice(out, blockStart, blockSize) {
    const ix = this.index;
    const s = this.smoothed;
    const sr = this.sr;

    for (let i = 0; i < blockSize; i++) {
      if (((blockStart + i) & (CONTROL_STEP - 1)) === 0) {
        const t = (this.startFrame >= 0 ? currentFrame + i - this.startFrame : 0) / sr;
        this.evaluate(t);
        for (let k = 0; k < this.paramCount; k++) {
          s[k] += (this.p[k] - s[k]) * this.smoothCoef[k];
        }
        this.applyCoefficients();
      }

      const level = s[ix.level];
      const breath = s[ix.breath];
      const fric = s[ix.fric];
      const bar = s[ix.bar];

      // --- 音程（ビブラート + 自然な揺らぎ） ---
      const vibDepth = s[ix.vibDepth];
      const vibRate = s[ix.vibRate];
      this.vibPhase += vibRate / sr;
      if (this.vibPhase >= 1) this.vibPhase -= 1;
      const vib = Math.sin(TWO_PI * this.vibPhase) * vibDepth;

      this.driftCount--;
      if (this.driftCount <= 0) {
        this.driftCount = Math.floor(sr * 0.045);
        this.driftTarget = this.noise.next() * 9 * s[ix.drift];
      }
      this.driftValue += (this.driftTarget - this.driftValue) * 0.0016;

      const cents = vib + this.driftValue + this.jitter * 26 * s[ix.drift];
      const f0 = clamp(this.a4 * Math.pow(2, (s[ix.pitch] - 69) / 12 + cents / 1200), 40, 2000);

      // --- 声門流の微分波 ---
      const oq = clamp(s[ix.oq], 0.25, 0.88);
      const rq = clamp(s[ix.rq], 0.02, 1 - oq - 0.02);
      const inc = f0 / sr;
      this.phase += inc;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.periodCount++;
        // 周期ごとのゆらぎ
        this.jitter = this.jitter * 0.82 + this.noise.next() * 0.18;
        this.shimmer = this.shimmer * 0.85 + this.noise.next() * 0.15;
        const growl = s[ix.growl];
        this.periodGain = 1 - growl * 0.42 * (this.periodCount & 1) + this.shimmer * 0.05 * s[ix.drift];
      }

      let glottal = 0;
      const ph = this.phase;
      if (ph < oq) {
        const t = ph / oq;
        glottal = (2 * t - 3 * t * t) * oq; // 開放相（正規化済み）
      } else if (ph < oq + rq) {
        const t = (ph - oq) / rq;
        glottal = -(1 - t) * Math.exp(-3 * t); // 戻り相（閉鎖の角を丸める）
      }
      glottal *= this.periodGain;

      // 直流を抜く
      const dc = glottal - this.dcX + 0.996 * this.dcY;
      this.dcX = glottal;
      this.dcY = dc;

      // スペクトル傾斜（声の柔らかさ）
      const tiltCoef = clamp((TWO_PI * s[ix.tilt]) / sr, 0.02, 1);
      this.tiltState += (dc - this.tiltState) * tiltCoef;
      let source = this.tiltState;

      // 基本波の補強（声の太さ）
      this.bodyState += (source - this.bodyState) * clamp((TWO_PI * 210) / sr, 0.005, 1);
      source += this.bodyState * s[ix.body] * 1.0;

      // 気息（声門の開いている間に強く出る）
      const white = this.noise.next();
      this.noiseLp += (white - this.noiseLp) * 0.55;
      const shaped = white - this.noiseLp * 0.72; // 高域寄りの雑音
      const openness = ph < oq ? Math.sin((ph / oq) * Math.PI) : 0;
      const aspiration = shaped * breath * (0.22 + 0.78 * openness) * 0.34;

      let excitation = (source * level + aspiration) * 0.22;

      // 有声閉鎖のうなり（濁音の閉鎖中）
      if (bar > 0.001) {
        this.barState += (source - this.barState) * clamp((TWO_PI * 240) / sr, 0.005, 1);
        excitation += this.barState * bar * 0.16;
      }

      // --- 声道（鼻音の極零 → フォルマント5段） ---
      // 極を先に通す（零を先にすると高域が一度大きく持ち上がるため）
      let v = this.nasalPole.run(excitation);
      v = this.nasalZero.run(v);
      for (let k = 0; k < 5; k++) v = this.formants[k].run(v);

      // --- 摩擦・破裂（声道を通さない独立経路） ---
      let f = 0;
      if (fric > 0.0005) {
        const n = this.noise.next();
        f = (this.fric1.run(n) * s[ix.sg1] + this.fric2.run(n) * s[ix.sg2]) * fric * 0.9;
      }

      out[i] += (v + f * 0.55) * this.vocalGain;
    }
  }

  // ------------------------------------------------------------------ 伴奏

  startAccompVoices(frameStart, frameEnd) {
    while (this.accompIndex < this.accomp.length) {
      const n = this.accomp[this.accompIndex];
      const at = this.startFrame + Math.round(n.time * this.sr);
      if (at >= frameEnd) break;
      this.accompIndex++;
      if (at + 1 < frameStart) continue;
      this.allocate(n, Math.max(at, frameStart));
    }
  }

  allocate(n, atFrame) {
    let slot = null;
    for (const v of this.voices) {
      if (!v.active) {
        slot = v;
        break;
      }
    }
    if (!slot) {
      let oldest = this.voices[0];
      for (const v of this.voices) if (v.age < oldest.age) oldest = v;
      slot = oldest;
    }
    slot.active = true;
    slot.inst = n.inst;
    slot.startFrame = atFrame;
    slot.endFrame = atFrame + Math.max(1, Math.round(n.dur * this.sr));
    slot.freq = 440 * Math.pow(2, (n.note - 69) / 12);
    slot.vel = n.vel;
    slot.pan = n.pan || 0;
    slot.note = n.note;
    slot.phase = 0;
    slot.phase2 = 0;
    slot.phase3 = 0;
    slot.env = 0;
    slot.lp = 0;
    slot.lp2 = 0;
    slot.hp = 0;
    slot.hpx = 0;
    slot.released = false;
    slot.done = false;
    slot.env2 = 1;
    slot.age = ++this.voiceAge;
    if (n.inst === 3) {
      // 撥弦（Karplus-Strong）の遅延線を用意する
      const len = Math.max(8, Math.round(this.sr / slot.freq));
      slot.ks = new Float32Array(len);
      for (let i = 0; i < len; i++) slot.ks[i] = this.noise.next();
      slot.ksIndex = 0;
      slot.ksLast = 0;
    } else {
      slot.ks = null;
    }
  }

  renderAccomp(left, right, blockSize) {
    const sr = this.sr;
    for (const v of this.voices) {
      if (!v.active) continue;
      const panL = Math.cos((v.pan + 1) * Math.PI * 0.25);
      const panR = Math.sin((v.pan + 1) * Math.PI * 0.25);
      for (let i = 0; i < blockSize; i++) {
        const frame = currentFrame + i;
        if (frame < v.startFrame) continue;
        const released = frame >= v.endFrame || v.released;
        const sample = this.accompSample(v, released, sr);
        left[i] += sample * panL * this.accompGain;
        right[i] += sample * panR * this.accompGain;
        if (v.done || (released && v.env < 0.0004)) {
          v.active = false;
          break;
        }
      }
    }
  }

  accompSample(v, released, sr) {
    const inc = v.freq / sr;
    switch (v.inst) {
      case 0: {
        // エレクトリックピアノ（2オペレータFM。倍音が減りながら伸びる）
        v.env += ((released ? 0 : 1) - v.env) * (released ? 0.00028 : 0.02);
        v.env2 -= v.env2 * 0.000045;
        v.phase += inc;
        if (v.phase >= 1) v.phase -= 1;
        v.phase2 += inc;
        if (v.phase2 >= 1) v.phase2 -= 1;
        const decay = v.env2;
        const mod = Math.sin(TWO_PI * v.phase2) * (1.7 * decay * decay + 0.12);
        return Math.sin(TWO_PI * v.phase + mod) * v.env * decay * v.vel * 0.45;
      }
      case 1: {
        // パッド（デチューンしたのこぎり波3本 + 2次ローパス）
        v.env += ((released ? 0 : 1) - v.env) * (released ? 0.00012 : 0.0006);
        const i2 = inc * 1.0032;
        const i3 = inc * 0.9968;
        v.phase += inc;
        if (v.phase >= 1) v.phase -= 1;
        v.phase2 += i2;
        if (v.phase2 >= 1) v.phase2 -= 1;
        v.phase3 += i3;
        if (v.phase3 >= 1) v.phase3 -= 1;
        const saw =
          (2 * v.phase - 1 - polyBlep(v.phase, inc)) * 0.34 +
          (2 * v.phase2 - 1 - polyBlep(v.phase2, i2)) * 0.33 +
          (2 * v.phase3 - 1 - polyBlep(v.phase3, i3)) * 0.33;
        const cut = clamp((TWO_PI * (620 + v.freq * 2.0)) / sr, 0.01, 0.9);
        v.lp += (saw - v.lp) * cut;
        v.lp2 += (v.lp - v.lp2) * cut;
        return v.lp2 * v.env * v.vel * 0.5;
      }
      case 2: {
        // ベース（のこぎり波 + サブ + 閉じていくローパス）
        v.env += ((released ? 0 : 1) - v.env) * (released ? 0.0012 : 0.05);
        v.env2 -= v.env2 * 0.00007;
        v.phase += inc;
        if (v.phase >= 1) v.phase -= 1;
        v.phase2 += inc * 0.5;
        if (v.phase2 >= 1) v.phase2 -= 1;
        const saw = 2 * v.phase - 1 - polyBlep(v.phase, inc);
        const sub = Math.sin(TWO_PI * v.phase2);
        const cut = clamp((TWO_PI * (200 + 950 * v.env2 * v.vel)) / sr, 0.005, 0.6);
        v.lp += (saw * 0.8 + sub * 0.55 - v.lp) * cut;
        v.lp2 += (v.lp - v.lp2) * cut;
        return v.lp2 * v.env * v.vel * 0.9;
      }
      case 3: {
        // 撥弦（Karplus-Strong の弦モデル）
        if (!v.ks) return 0;
        v.env += ((released ? 0 : 1) - v.env) * (released ? 0.0009 : 0.2);
        const buf = v.ks;
        const len = buf.length;
        const idx = v.ksIndex;
        const cur = buf[idx];
        const nxt = buf[idx + 1 === len ? 0 : idx + 1];
        buf[idx] = (cur + nxt) * 0.5 * 0.9965;
        v.ksIndex = idx + 1 === len ? 0 : idx + 1;
        v.lp += (cur - v.lp) * 0.55;
        return v.lp * v.env * v.vel * 0.55;
      }
      case 4: {
        // ドラム（36=キック 38=スネア 42=ハイハット）
        const note = v.note || 36;
        if (note <= 37) {
          v.env2 -= v.env2 * 0.00065;
          const pitch = 48 + 90 * v.env2 * v.env2;
          v.phase += pitch / sr;
          if (v.phase >= 1) v.phase -= 1;
          const amp = Math.pow(v.env2, 0.6);
          if (amp < 0.001) v.done = true;
          return Math.sin(TWO_PI * v.phase) * amp * v.vel * 0.9;
        }
        if (note <= 40) {
          v.env2 -= v.env2 * 0.0017;
          v.phase += 185 / sr;
          if (v.phase >= 1) v.phase -= 1;
          const n = this.noise.next();
          v.lp += (n - v.lp) * 0.42;
          const amp = Math.pow(v.env2, 1.1);
          if (amp < 0.001) v.done = true;
          return (v.lp * 1.1 + Math.sin(TWO_PI * v.phase) * 0.35) * amp * v.vel * 0.5;
        }
        v.env2 -= v.env2 * 0.0062;
        const n = this.noise.next();
        v.hp = n - v.hpx + 0.86 * v.hp;
        v.hpx = n;
        const amp = Math.pow(v.env2, 1.4);
        if (amp < 0.001) v.done = true;
        return v.hp * amp * v.vel * 0.28;
      }
      default:
        return 0;
    }
  }

  process(inputs, outputs) {
    const vocalOut = outputs[0][0];
    const accompL = outputs[1][0];
    const accompR = outputs[1][1] || outputs[1][0];
    const blockSize = vocalOut.length;

    if (!this.playing) return true;

    const frameStart = currentFrame;
    const frameEnd = currentFrame + blockSize;

    if (frameEnd > this.startFrame) {
      this.renderVoice(vocalOut, frameStart, blockSize);
      this.startAccompVoices(frameStart, frameEnd);
      this.renderAccomp(accompL, accompR, blockSize);
    }

    const elapsed = (frameEnd - this.startFrame) / this.sr;
    if (elapsed - this.reported > 0.04) {
      this.reported = elapsed;
      this.port.postMessage({ type: 'pos', time: elapsed });
    }
    if (this.duration > 0 && elapsed > this.duration + 1.2) {
      this.playing = false;
      this.port.postMessage({ type: 'end' });
    }
    return true;
  }
}

registerProcessor('vocal-processor', VocalProcessor);
