/*
 * Akatsuki Synth — シンセシス DSP コア (AudioWorklet)
 *
 * 1トラック = 1プロセッサ。ポリフォニックなボイス管理・オシレーター・フィルター・
 * エンベロープ・LFO・ドラム音源をすべてこのファイル内で生成します。
 * サンプル音源や外部ライブラリは一切使用していません。
 *
 * ノートイベントは { time } 付きでメインスレッドから送られ、レンダークォンタム内の
 * サンプル位置に変換して適用されるため、シーケンサー再生はサンプル単位で正確です。
 * （オフラインレンダリング＝WAV書き出し時は全イベントを事前に流し込みます）
 */

const MAX_VOICES = 16;
const SUPER_SAW_COUNT = 7;

/* JP-8000 系スーパーソウのデチューン比 */
const SUPER_SAW_SPREAD = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242];
const SUPER_SAW_GAIN = [0.62, 0.72, 0.86, 1.0, 0.86, 0.72, 0.62];

/* 金属系ドラム（ハイハット/シンバル）の非整数倍音比（TR-808 由来） */
const METAL_RATIOS = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function midiToFreq(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/* Padé 近似による高速 tanh（サチュレーション用） */
function fastTanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/* PolyBLEP：ノコギリ波・矩形波の不連続点を補正しエイリアスノイズを抑える */
function polyBlep(t, dt) {
  if (dt <= 0) return 0;
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

// ---------------------------------------------------------------------------
// オシレーター
// ---------------------------------------------------------------------------
class Osc {
  constructor() {
    this.phase = 0;
    this.phases = new Float64Array(SUPER_SAW_COUNT);
    this.wrapped = false;
    this.wrapFrac = 0;
  }

  reset(randomize) {
    this.phase = randomize ? Math.random() : 0;
    for (let i = 0; i < SUPER_SAW_COUNT; i++) this.phases[i] = randomize ? Math.random() : 0;
  }

  /** phase をそのまま設定（ハードシンク用） */
  setPhase(p) {
    this.phase = p - Math.floor(p);
  }

  /**
   * 1サンプル生成して位相を進める。
   * @param wave 波形名
   * @param dt   位相増分（freq / sampleRate）
   * @param pw   パルス幅 0.02..0.98
   * @param spread スーパーソウの広がり 0..1
   * @param nz   ノイズ波形用にあらかじめ生成したノイズサンプル
   */
  render(wave, dt, pw, spread, nz) {
    this.wrapped = false;
    if (wave === 'noise') {
      this.phase = 0;
      return nz;
    }
    if (wave === 'superSaw') {
      let sum = 0;
      let gain = 0;
      for (let i = 0; i < SUPER_SAW_COUNT; i++) {
        const d = dt * (1 + SUPER_SAW_SPREAD[i] * spread);
        let p = this.phases[i] + d;
        if (p >= 1) p -= 1;
        this.phases[i] = p;
        const g = SUPER_SAW_GAIN[i];
        sum += (2 * p - 1 - polyBlep(p, d)) * g;
        gain += g;
      }
      // マスター位相（シンク検出用）
      this.phase += dt;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.wrapped = true;
        this.wrapFrac = this.phase / dt;
      }
      return (sum / gain) * 1.15;
    }

    const p0 = this.phase;
    let p = p0 + dt;
    if (p >= 1) {
      p -= 1;
      this.wrapped = true;
      this.wrapFrac = p / dt;
    }
    this.phase = p;

    switch (wave) {
      case 'sine':
        return Math.sin(2 * Math.PI * p);
      case 'triangle':
        // 倍音が 1/n² で減衰するためナイーブ生成でも実用上エイリアスは無視できる
        return 1 - 4 * Math.abs(p - 0.5);
      case 'square':
      case 'pulse': {
        const duty = wave === 'square' ? 0.5 : clamp(pw, 0.02, 0.98);
        let v = p < duty ? 1 : -1;
        v += polyBlep(p, dt);
        let t2 = p - duty;
        if (t2 < 0) t2 += 1;
        v -= polyBlep(t2, dt);
        // デューティ比による直流成分を除去
        return v - (2 * duty - 1);
      }
      case 'sawtooth':
      default:
        return 2 * p - 1 - polyBlep(p, dt);
    }
  }
}

// ---------------------------------------------------------------------------
// エンベロープ（アナログ的な指数カーブ）
// ---------------------------------------------------------------------------
const IDLE = 0;
const ATTACK = 1;
const DECAY = 2;
const SUSTAIN = 3;
const RELEASE = 4;

class ADSR {
  constructor(sr) {
    this.sr = sr;
    this.stage = IDLE;
    this.value = 0;
    this.sustainLevel = 0.7;
    this.ka = 0.01;
    this.kd = 0.01;
    this.kr = 0.01;
  }

  setParams(a, d, s, r) {
    // 1.466τ で目標 1.0 に到達（オーバーシュート 1.3 を目標にした指数カーブ）
    this.ka = 1 - Math.exp(-1 / Math.max(1, this.sr * Math.max(0.0005, a) * 0.682));
    this.kd = 1 - Math.exp(-1 / Math.max(1, this.sr * Math.max(0.001, d) * 0.2174));
    this.kr = 1 - Math.exp(-1 / Math.max(1, this.sr * Math.max(0.001, r) * 0.2174));
    this.sustainLevel = clamp(s, 0, 1);
  }

  trigger(fromZero) {
    if (fromZero) this.value = 0;
    this.stage = ATTACK;
  }

  release() {
    if (this.stage !== IDLE) this.stage = RELEASE;
  }

  kill() {
    this.stage = IDLE;
    this.value = 0;
  }

  get active() {
    return this.stage !== IDLE;
  }

  process() {
    switch (this.stage) {
      case ATTACK:
        this.value += (1.3 - this.value) * this.ka;
        if (this.value >= 1) {
          this.value = 1;
          this.stage = DECAY;
        }
        break;
      case DECAY:
        this.value += (this.sustainLevel - 0.0015 - this.value) * this.kd;
        if (this.value <= this.sustainLevel + 0.0012) {
          this.value = this.sustainLevel;
          this.stage = this.sustainLevel <= 0.0005 ? IDLE : SUSTAIN;
        }
        break;
      case SUSTAIN:
        this.value += (this.sustainLevel - this.value) * 0.002;
        break;
      case RELEASE:
        this.value += (-0.0015 - this.value) * this.kr;
        if (this.value <= 0.0004) {
          this.value = 0;
          this.stage = IDLE;
        }
        break;
      default:
        this.value = 0;
    }
    return this.value;
  }
}

// ---------------------------------------------------------------------------
// フィルター
// ---------------------------------------------------------------------------

/* Moog ラダー型（4ポール／非線形フィードバック）。LPF 用。 */
class Ladder {
  constructor() {
    this.y1 = 0;
    this.y2 = 0;
    this.y3 = 0;
    this.y4 = 0;
    this.t1 = 0;
    this.t2 = 0;
    this.t3 = 0;
    this.t4 = 0;
  }

  reset() {
    this.y1 = this.y2 = this.y3 = this.y4 = 0;
    this.t1 = this.t2 = this.t3 = this.t4 = 0;
  }

  /** @param g 1 - exp(-2πfc/sr) @param k レゾナンス 0..4.2 @param pole4 24dB/oct なら true */
  process(x, g, k, pole4) {
    const fb = pole4 ? this.y4 : this.y2;
    const input = x - k * fb;
    const ti = fastTanh(input);
    this.y1 += g * (ti - this.t1);
    this.t1 = fastTanh(this.y1);
    this.y2 += g * (this.t1 - this.t2);
    this.t2 = fastTanh(this.y2);
    if (!pole4) return this.y2 * (1 + k * 0.35);
    this.y3 += g * (this.t2 - this.t3);
    this.t3 = fastTanh(this.y3);
    this.y4 += g * (this.t3 - this.t4);
    this.t4 = fastTanh(this.y4);
    return this.y4 * (1 + k * 0.5);
  }
}

/* ZDF ステートバリアブル（TPT）。HPF / BPF / Notch 用。 */
class SVF {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  /** @param g tan(π fc / sr) @param k 1/Q @param mode 0=LP 1=HP 2=BP 3=Notch */
  process(x, g, k, mode) {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (mode) {
      case 1:
        return x - k * v1 - v2;
      case 2:
        return v1;
      case 3:
        return x - k * v1;
      default:
        return v2;
    }
  }
}

/* 1ポール LPF（ダンピング用の軽量フィルター） */
class OnePole {
  constructor() {
    this.z = 0;
  }
  reset() {
    this.z = 0;
  }
  lp(x, g) {
    this.z += g * (x - this.z);
    return this.z;
  }
  hp(x, g) {
    this.z += g * (x - this.z);
    return x - this.z;
  }
}

// ---------------------------------------------------------------------------
// LFO
// ---------------------------------------------------------------------------
class Lfo {
  constructor() {
    this.phase = 0;
    this.sh = 0;
    this.fadeGain = 0;
  }

  reset(randomize) {
    this.phase = randomize ? Math.random() : 0;
    this.sh = Math.random() * 2 - 1;
    this.fadeGain = 0;
  }

  render(wave, dt, fadeCoef) {
    let p = this.phase + dt;
    if (p >= 1) {
      p -= Math.floor(p);
      if (wave === 'sampleHold') this.sh = Math.random() * 2 - 1;
    }
    this.phase = p;
    this.fadeGain += (1 - this.fadeGain) * fadeCoef;
    let v;
    switch (wave) {
      case 'sine':
        v = Math.sin(2 * Math.PI * p);
        break;
      case 'sawtooth':
        v = 2 * p - 1;
        break;
      case 'square':
        v = p < 0.5 ? 1 : -1;
        break;
      case 'sampleHold':
        v = this.sh;
        break;
      case 'triangle':
      default:
        v = 1 - 4 * Math.abs(p - 0.5);
        break;
    }
    return v * this.fadeGain;
  }
}

// ---------------------------------------------------------------------------
// ノイズ生成（ホワイト／ピンク）
// ---------------------------------------------------------------------------
class NoiseGen {
  constructor() {
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
    this.b3 = 0;
    this.b4 = 0;
    this.b5 = 0;
    this.b6 = 0;
  }

  white() {
    return Math.random() * 2 - 1;
  }

  /* Paul Kellet のピンクノイズ近似 */
  pink() {
    const w = Math.random() * 2 - 1;
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return out * 0.16;
  }
}

// ---------------------------------------------------------------------------
// シンセ・ボイス
// ---------------------------------------------------------------------------
class Voice {
  constructor(sr) {
    this.sr = sr;
    this.osc1 = new Osc();
    this.osc2 = new Osc();
    this.subOsc = new Osc();
    this.noise = new NoiseGen();
    this.ampEnv = new ADSR(sr);
    this.filterEnv = new ADSR(sr);
    this.lfo1 = new Lfo();
    this.lfo2 = new Lfo();
    this.ladder = new Ladder();
    this.svf1 = new SVF();
    this.svf2 = new SVF();
    this.dcBlock = new OnePole();

    this.note = 60;
    this.velocity = 1;
    this.age = 0;
    this.held = false;
    this.sustained = false;
    this.freq = 440;
    this.targetFreq = 440;
    this.glideCoef = 1;
    this.cutoffSmooth = 1000;
    this.panSmooth = 0;
    this.fm = 0;
  }

  get active() {
    return this.ampEnv.active;
  }

  start(note, velocity, patch, glideFrom, tick) {
    this.note = note;
    this.velocity = velocity;
    this.age = tick;
    this.held = true;
    this.sustained = false;
    this.targetFreq = midiToFreq(note);
    const legato = glideFrom > 0 && patch.glide > 0;
    this.freq = legato ? glideFrom : this.targetFreq;
    this.setGlide(patch.glide);

    const retrig = !legato || patch.voiceMode !== 'legato';
    if (retrig) {
      const free = patch.osc1.phase < 0;
      this.osc1.reset(free);
      this.osc2.reset(free);
      this.subOsc.reset(free);
      if (patch.lfo1.retrigger) this.lfo1.reset(false);
      if (patch.lfo2.retrigger) this.lfo2.reset(false);
      this.ladder.reset();
      this.svf1.reset();
      this.svf2.reset();
      this.ampEnv.trigger(this.ampEnv.stage === IDLE);
      this.filterEnv.trigger(this.filterEnv.stage === IDLE);
      this.cutoffSmooth = patch.filter.cutoff;
    }
  }

  setGlide(glide) {
    this.glideCoef = glide > 0 ? 1 - Math.exp(-1 / Math.max(1, this.sr * glide * 0.3)) : 1;
  }

  glideTo(note) {
    this.note = note;
    this.targetFreq = midiToFreq(note);
  }

  release() {
    this.held = false;
    this.ampEnv.release();
    this.filterEnv.release();
  }

  kill() {
    this.held = false;
    this.ampEnv.kill();
    this.filterEnv.kill();
  }

  /** 加算合成でステレオバッファに書き込む */
  render(outL, outR, from, to, patch, ctl) {
    const sr = this.sr;
    const p = patch;
    const o1 = p.osc1;
    const o2 = p.osc2;
    const f = p.filter;
    const invSr = 1 / sr;

    this.ampEnv.setParams(p.ampEnv.attack, p.ampEnv.decay, p.ampEnv.sustain, p.ampEnv.release);
    this.filterEnv.setParams(p.filterEnv.attack, p.filterEnv.decay, p.filterEnv.sustain, p.filterEnv.release);

    const lfo1Rate = lfoRate(p.lfo1, ctl.bpm);
    const lfo2Rate = lfoRate(p.lfo2, ctl.bpm);
    const lfo1Dt = lfo1Rate * invSr;
    const lfo2Dt = lfo2Rate * invSr;
    const fade1 = fadeCoef(p.lfo1.fade, sr);
    const fade2 = fadeCoef(p.lfo2.fade, sr);

    const ratio1 = Math.pow(2, o1.octave + o1.semitone / 12 + o1.detune / 1200);
    const ratio2 = Math.pow(2, o2.octave + o2.semitone / 12 + o2.detune / 1200);
    const subRatio = Math.pow(2, p.sub.octave);

    const velAmp = 1 - p.velSens + p.velSens * this.velocity;
    const velFilt = f.velAmount * this.velocity;
    const bendRatio = Math.pow(2, (ctl.bend * p.bendRange) / 12);

    const mw = ctl.mod;
    const modLfo1 = p.modWheel.target === 'lfo1' ? mw * p.modWheel.amount : 0;
    const modLfo2 = p.modWheel.target === 'lfo2' ? mw * p.modWheel.amount : 0;
    const modFilter = p.modWheel.target === 'filter' ? mw * p.modWheel.amount : 0;

    const mix1 = Math.min(1, 2 - 2 * p.oscMix) * o1.level;
    const mix2 = Math.min(1, 2 * p.oscMix) * o2.level;

    // 変調先のルーティングを事前に展開（サンプルループ内での分岐・関数生成を避ける）
    const t1 = p.lfo1.target;
    const t2 = p.lfo2.target;
    const pinkNoise = p.noise.type === 'pink';
    const needNoise = p.noise.level > 0 || o1.wave === 'noise' || o2.wave === 'noise';
    const cutoffCoef = 1 - Math.exp(-1 / (sr * 0.004));
    const panCoef = 1 - Math.exp(-1 / (sr * 0.01));
    const keyTrackOffset = (this.note - 60) * f.keyTrack;
    const drive = 1 + p.filter.drive * 9;
    const driveComp = 1 / (1 + p.filter.drive * 3);
    const ladderMode = f.type === 'lowpass' && f.model === 'ladder';
    const svfMode = f.type === 'highpass' ? 1 : f.type === 'bandpass' ? 2 : f.type === 'notch' ? 3 : 0;
    const pole4 = f.slope === 24;
    const reso = clamp(f.resonance, 0, 1);
    const ladderK = reso * 4.0;
    const svfK = 1 / (0.6 + reso * 9.4);
    const nyquist = sr * 0.5;
    const dcCoef = clamp(2 * Math.PI * 12 * invSr, 0, 1);

    for (let i = from; i < to; i++) {
      // --- 変調源 ---
      const l1 = this.lfo1.render(p.lfo1.wave, lfo1Dt, fade1) * clamp(p.lfo1.amount + modLfo1, 0, 1);
      const l2 = this.lfo2.render(p.lfo2.wave, lfo2Dt, fade2) * clamp(p.lfo2.amount + modLfo2, 0, 1);
      const fEnv = this.filterEnv.process();
      const aEnv = this.ampEnv.process();

      let pitchMod = 0;
      let osc2Mod = 0;
      let pwMod = 0;
      let filtMod = 0;
      let ampMod = 0;
      let panMod = 0;
      let fmMod = 0;
      if (t1 === 'pitch') pitchMod += l1;
      else if (t1 === 'osc2Pitch') osc2Mod += l1;
      else if (t1 === 'pulseWidth') pwMod += l1;
      else if (t1 === 'filter') filtMod += l1;
      else if (t1 === 'amp') ampMod += l1;
      else if (t1 === 'pan') panMod += l1;
      else if (t1 === 'fm') fmMod += l1;
      if (t2 === 'pitch') pitchMod += l2;
      else if (t2 === 'osc2Pitch') osc2Mod += l2;
      else if (t2 === 'pulseWidth') pwMod += l2;
      else if (t2 === 'filter') filtMod += l2;
      else if (t2 === 'amp') ampMod += l2;
      else if (t2 === 'pan') panMod += l2;
      else if (t2 === 'fm') fmMod += l2;

      // --- ピッチ ---
      this.freq += (this.targetFreq - this.freq) * this.glideCoef;
      const base = this.freq * bendRatio * Math.pow(2, pitchMod * 0.5);
      let f1 = base * ratio1;
      let f2 = base * ratio2 * Math.pow(2, osc2Mod * 0.5);
      f1 = clamp(f1, 0.01, nyquist * 0.98);
      f2 = clamp(f2, 0.01, nyquist * 0.98);
      const dt1 = f1 * invSr;
      const dt2 = f2 * invSr;

      const pw1 = clamp(o1.pulseWidth + pwMod * 0.45, 0.03, 0.97);
      const pw2 = clamp(o2.pulseWidth + pwMod * 0.45, 0.03, 0.97);

      // --- オシレーター ---
      const nz = needNoise ? (pinkNoise ? this.noise.pink() : this.noise.white()) : 0;
      let s2 = this.osc2.render(o2.wave, dt2, pw2, o2.spread, nz);

      // FM（osc2 → osc1 の位相変調）
      const fmAmt = clamp(p.fmAmount + fmMod, 0, 1);
      if (fmAmt > 0) {
        this.osc1.setPhase(this.osc1.phase + s2 * fmAmt * 0.35);
      }
      let s1 = this.osc1.render(o1.wave, dt1, pw1, o1.spread, nz);

      // ハードシンク（osc1 がマスター、osc2 の位相をサンプル内の正確な位置でリセット）
      if (p.oscSync && this.osc1.wrapped) {
        this.osc2.setPhase(dt2 * clamp(this.osc1.wrapFrac, 0, 1));
        s2 = 2 * this.osc2.phase - 1 - polyBlep(this.osc2.phase, dt2);
      }

      let sig;
      if (p.ringMod) {
        sig = s1 * s2 * (mix1 + mix2) * 1.4;
      } else {
        sig = s1 * mix1 + s2 * mix2;
      }

      if (p.sub.level > 0) {
        const fs = clamp(base * subRatio, 0.01, nyquist * 0.98);
        sig += this.subOsc.render(p.sub.wave, fs * invSr, 0.5, 0, nz) * p.sub.level;
      }
      if (p.noise.level > 0) sig += nz * p.noise.level;

      // --- フィルター ---
      let cutoffTarget = f.cutoff * Math.pow(2, keyTrackOffset / 12);
      cutoffTarget *= Math.pow(2, (f.envAmount * fEnv + velFilt * fEnv + filtMod + modFilter) * 5);
      cutoffTarget = clamp(cutoffTarget, 20, nyquist * 0.92);
      this.cutoffSmooth += (cutoffTarget - this.cutoffSmooth) * cutoffCoef;
      const fc = this.cutoffSmooth;

      let filtered;
      const driven = drive > 1 ? fastTanh(sig * drive) * driveComp : sig;
      if (ladderMode) {
        const g = 1 - Math.exp((-2 * Math.PI * fc) * invSr);
        filtered = this.ladder.process(driven, g, ladderK, pole4);
      } else {
        const g = Math.tan(Math.PI * clamp(fc, 20, nyquist * 0.49) * invSr);
        filtered = this.svf1.process(driven, g, svfK, svfMode);
        if (pole4) filtered = this.svf2.process(filtered, g, svfK, svfMode);
      }

      // --- アンプ ---
      let amp = aEnv * velAmp * p.volume;
      if (ampMod !== 0) amp *= clamp(1 + ampMod, 0, 2);
      let out = this.dcBlock.hp(filtered, dcCoef) * amp;

      // --- パン ---
      const panTarget = clamp(p.pan + panMod, -1, 1);
      this.panSmooth += (panTarget - this.panSmooth) * panCoef;
      const pan = this.panSmooth;
      const angle = (pan + 1) * 0.25 * Math.PI;
      outL[i] += out * Math.cos(angle);
      outR[i] += out * Math.sin(angle);
    }
  }
}

function lfoRate(lfo, bpm) {
  if (lfo.sync) {
    const beats = Math.max(0.0625, lfo.division);
    return bpm / 60 / beats;
  }
  return Math.max(0.01, lfo.rate);
}

function fadeCoef(fade, sr) {
  if (!fade || fade <= 0) return 1;
  return 1 - Math.exp(-1 / Math.max(1, sr * fade * 0.35));
}

// ---------------------------------------------------------------------------
// ドラム・ボイス（アナログ／PCM 風リズムマシンのモデリング）
// ---------------------------------------------------------------------------
class DrumVoice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.t = 0;
    this.noise = new NoiseGen();
    this.body = new Osc();
    this.body2 = new Osc();
    this.metal = [];
    for (let i = 0; i < METAL_RATIOS.length; i++) this.metal.push(new Osc());
    this.bp = new SVF();
    this.hp = new SVF();
    this.lp = new OnePole();
    this.type = 'kick';
    this.params = null;
    this.vel = 1;
    this.dur = 1;
    this.age = 0;
  }

  start(patch, velocity, tick) {
    const d = patch.drum;
    this.type = d.type;
    this.params = d;
    this.patch = patch;
    this.vel = velocity;
    this.t = 0;
    this.active = true;
    this.age = tick;
    this.bp.reset();
    this.hp.reset();
    this.lp.reset();
    this.body.reset(false);
    this.body2.reset(false);
    for (const m of this.metal) m.reset(true);
    this.dur = drumDuration(d);
  }

  kill() {
    this.active = false;
  }

  render(outL, outR, from, to) {
    if (!this.active) return;
    const sr = this.sr;
    const invSr = 1 / sr;
    const d = this.params;
    const p = this.patch;
    const tune = Math.pow(2, d.tune / 12);
    const dec = Math.max(0.02, d.decay);
    const tone = clamp(d.tone, 0, 1);
    const snap = clamp(d.snap, 0, 1);
    const level = this.vel * p.volume;
    const driveAmt = 1 + d.drive * 12;
    const driveComp = 1 / (1 + d.drive * 4);
    const pan = clamp(p.pan, -1, 1);
    const angle = (pan + 1) * 0.25 * Math.PI;
    const gl = Math.cos(angle);
    const gr = Math.sin(angle);
    const nyquist = sr * 0.5;

    for (let i = from; i < to; i++) {
      const t = this.t;
      if (t > this.dur) {
        this.active = false;
        break;
      }
      let s = 0;

      switch (this.type) {
        case 'kick':
        case 'kick2': {
          const deep = this.type === 'kick2';
          const f0 = (deep ? 120 : 165) * tune;
          const fEnd = (deep ? 33 : 48) * tune;
          const pitchDecay = deep ? 0.055 : 0.032;
          const freq = fEnd + (f0 - fEnd) * Math.exp(-t / pitchDecay);
          const bodyDecay = dec * (deep ? 0.85 : 0.5);
          const env = Math.exp(-t / bodyDecay);
          s = this.body.render('sine', freq * invSr, 0.5, 0, 0) * env * 1.15;
          // クリック（アタック成分）
          if (t < 0.01) {
            const clickEnv = Math.exp(-t / 0.0025) * snap * 0.55;
            s += (this.noise.white() * 0.5 + this.body2.render('triangle', 2200 * invSr, 0.5, 0, 0)) * clickEnv;
          }
          break;
        }
        case 'snare': {
          const f0 = 250 * tune;
          const env = Math.exp(-t / (dec * 0.16));
          const bodyEnv = Math.exp(-t / (dec * 0.11));
          const tone1 = this.body.render('triangle', f0 * invSr, 0.5, 0, 0);
          const tone2 = this.body2.render('triangle', f0 * 1.48 * invSr, 0.5, 0, 0);
          const n = this.hp.process(this.noise.white(), Math.tan(Math.PI * clamp(1200 + tone * 4000, 100, nyquist * 0.48) * invSr), 0.9, 1);
          s = (tone1 * 0.6 + tone2 * 0.35) * bodyEnv * (1 - snap * 0.45) + n * env * (0.45 + snap * 0.6);
          break;
        }
        case 'rim': {
          const env = Math.exp(-t / (dec * 0.02));
          const a = this.body.render('square', 1720 * tune * invSr, 0.5, 0, 0);
          const b = this.body2.render('square', 480 * tune * invSr, 0.5, 0, 0);
          s = (a * 0.5 + b * 0.5 + this.noise.white() * 0.35 * snap) * env;
          break;
        }
        case 'clap': {
          // 3回の短いバースト＋テイル
          const burst = t < 0.03 ? (Math.floor(t / 0.0095) % 2 === 0 ? 1 : 0.25) : 0;
          const tail = Math.exp(-Math.max(0, t - 0.028) / (dec * 0.09));
          const envc = t < 0.03 ? burst : tail;
          const n = this.bp.process(this.noise.white(), Math.tan(Math.PI * clamp(900 + tone * 1400, 100, nyquist * 0.48) * invSr), 0.45, 2);
          s = n * envc * 1.6;
          break;
        }
        case 'hatClosed':
        case 'hatOpen': {
          const open = this.type === 'hatOpen';
          const dcy = dec * (open ? 0.35 : 0.035);
          const env = Math.exp(-t / dcy);
          let m = 0;
          for (let k = 0; k < METAL_RATIOS.length; k++) {
            m += this.metal[k].render('square', clamp(METAL_RATIOS[k] * 320 * tune, 20, nyquist * 0.9) * invSr, 0.5, 0, 0);
          }
          m /= METAL_RATIOS.length;
          const hpF = Math.tan(Math.PI * clamp(6000 + tone * 4000, 500, nyquist * 0.48) * invSr);
          s = this.hp.process(m * 0.9 + this.noise.white() * 0.35, hpF, 1.1, 1) * env * 1.4;
          break;
        }
        case 'tomLow':
        case 'tomMid':
        case 'tomHigh': {
          const baseF = (this.type === 'tomLow' ? 110 : this.type === 'tomMid' ? 165 : 235) * tune;
          const freq = baseF * (0.72 + 0.28 * Math.exp(-t / 0.05));
          const env = Math.exp(-t / (dec * 0.3));
          s = this.body.render('sine', freq * invSr, 0.5, 0, 0) * env;
          s += this.noise.white() * env * 0.12 * snap;
          break;
        }
        case 'crash':
        case 'ride': {
          const ride = this.type === 'ride';
          const dcy = dec * (ride ? 0.5 : 0.9);
          const env = Math.exp(-t / dcy);
          let m = 0;
          for (let k = 0; k < METAL_RATIOS.length; k++) {
            m += this.metal[k].render('square', clamp(METAL_RATIOS[k] * (ride ? 430 : 275) * tune, 20, nyquist * 0.9) * invSr, 0.5, 0, 0);
          }
          m /= METAL_RATIOS.length;
          const hpF = Math.tan(Math.PI * clamp((ride ? 4800 : 3200) + tone * 4000, 500, nyquist * 0.48) * invSr);
          const ping = ride ? this.body.render('sine', 1900 * tune * invSr, 0.5, 0, 0) * Math.exp(-t / 0.06) * 0.4 : 0;
          s = (this.hp.process(m + this.noise.white() * 0.55, hpF, 0.9, 1) * env + ping) * 0.9;
          break;
        }
        case 'cowbell': {
          const env = Math.exp(-t / (dec * 0.12));
          const a = this.body.render('square', 812 * tune * invSr, 0.5, 0, 0);
          const b = this.body2.render('square', 538 * tune * invSr, 0.5, 0, 0);
          const bpF = Math.tan(Math.PI * clamp(2200 + tone * 2500, 200, nyquist * 0.48) * invSr);
          s = this.bp.process((a + b) * 0.5, bpF, 0.35, 2) * env * 1.6;
          break;
        }
        case 'shaker': {
          const env = Math.exp(-t / (dec * 0.05)) * (1 - Math.exp(-t / 0.004));
          const bpF = Math.tan(Math.PI * clamp(5000 + tone * 5000, 500, nyquist * 0.48) * invSr);
          s = this.bp.process(this.noise.white(), bpF, 0.6, 2) * env * 2.2;
          break;
        }
        case 'clave': {
          const env = Math.exp(-t / (dec * 0.03));
          s = this.body.render('sine', 2400 * tune * invSr, 0.5, 0, 0) * env;
          break;
        }
        default:
          s = 0;
      }

      if (d.drive > 0) s = fastTanh(s * driveAmt) * driveComp;
      s *= level;
      outL[i] += s * gl;
      outR[i] += s * gr;
      this.t += invSr;
    }
  }
}

function drumDuration(d) {
  const dec = Math.max(0.02, d.decay);
  switch (d.type) {
    case 'crash':
      return dec * 6 + 0.2;
    case 'ride':
      return dec * 4 + 0.2;
    case 'hatOpen':
      return dec * 2.5 + 0.1;
    case 'kick':
    case 'kick2':
      return dec * 4 + 0.1;
    case 'snare':
    case 'clap':
      return dec * 1.6 + 0.1;
    default:
      return dec * 2.5 + 0.08;
  }
}

// ---------------------------------------------------------------------------
// プロセッサ本体
// ---------------------------------------------------------------------------
class SynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = sampleRate;
    this.patch = options.processorOptions?.patch ?? null;
    this.bpm = options.processorOptions?.bpm ?? 120;
    this.voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(sr));
    this.drums = [];
    for (let i = 0; i < 10; i++) this.drums.push(new DrumVoice(sr));
    // オフラインレンダリングでは全イベントを processorOptions で受け取る
    // （port 経由だとレンダリング開始と配送順序が競合する場合があるため）
    const preset = options.processorOptions?.events;
    this.queue = Array.isArray(preset) ? preset.slice().sort((a, b) => a.time - b.time) : [];
    this.tick = 0;
    this.bend = 0;
    this.mod = 0;
    this.sustainPedal = false;
    this.lastFreq = 0;
    this.peak = 0;
    this.meterCounter = 0;
    this.disposed = false;

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'patch':
        this.patch = msg.patch;
        break;
      case 'tempo':
        this.bpm = msg.bpm;
        break;
      case 'event':
        this.queue.push(msg.event);
        this.queue.sort((a, b) => a.time - b.time);
        break;
      case 'events':
        for (const ev of msg.events) this.queue.push(ev);
        this.queue.sort((a, b) => a.time - b.time);
        break;
      case 'bend':
        this.bend = msg.value;
        break;
      case 'mod':
        this.mod = msg.value;
        break;
      case 'sustain':
        this.sustainPedal = !!msg.value;
        if (!this.sustainPedal) {
          for (const v of this.voices) {
            if (v.sustained && !v.held) {
              v.sustained = false;
              v.release();
            }
          }
        }
        break;
      case 'panic':
        this.queue.length = 0;
        for (const v of this.voices) v.kill();
        for (const d of this.drums) d.kill();
        break;
      case 'dispose':
        this.disposed = true;
        break;
      default:
        break;
    }
  }

  applyEvent(ev) {
    const p = this.patch;
    if (!p) return;
    switch (ev.type) {
      case 'noteOn':
        if (p.kind === 'drum') this.startDrum(ev.velocity ?? 1);
        else this.noteOn(ev.note, ev.velocity ?? 1);
        break;
      case 'noteOff':
        if (p.kind !== 'drum') this.noteOff(ev.note);
        break;
      case 'allNotesOff':
        for (const v of this.voices) v.release();
        break;
      case 'panic':
        for (const v of this.voices) v.kill();
        for (const d of this.drums) d.kill();
        break;
      case 'bend':
        this.bend = ev.value;
        break;
      case 'mod':
        this.mod = ev.value;
        break;
      default:
        break;
    }
  }

  startDrum(velocity) {
    let slot = this.drums.find((d) => !d.active);
    if (!slot) {
      slot = this.drums.reduce((a, b) => (a.age <= b.age ? a : b));
    }
    slot.start(this.patch, velocity, this.tick++);
  }

  noteOn(note, velocity) {
    const p = this.patch;
    const mono = p.voiceMode === 'mono' || p.voiceMode === 'legato';
    if (mono) {
      const v = this.voices[0];
      const gliding = v.active && p.glide > 0;
      if (v.active && p.voiceMode === 'legato') {
        v.glideTo(note);
        v.velocity = velocity;
        v.held = true;
        v.setGlide(p.glide);
        this.heldStack = this.heldStack || [];
      } else {
        v.start(note, velocity, p, gliding ? v.freq : 0, this.tick++);
      }
      this.monoStack = this.monoStack || [];
      this.monoStack = this.monoStack.filter((n) => n !== note);
      this.monoStack.push(note);
      return;
    }

    // 同音再発音は前のボイスを素早く解放
    for (const v of this.voices) {
      if (v.active && v.note === note && v.held) {
        v.held = false;
        v.release();
      }
    }
    let voice = this.voices.find((v) => !v.active);
    if (!voice) {
      // 最も古い（かつリリース済みを優先して）ボイスを奪う
      const released = this.voices.filter((v) => !v.held);
      const pool = released.length > 0 ? released : this.voices;
      voice = pool.reduce((a, b) => (a.age <= b.age ? a : b));
    }
    voice.start(note, velocity, this.patch, 0, this.tick++);
  }

  noteOff(note) {
    const p = this.patch;
    const mono = p.voiceMode === 'mono' || p.voiceMode === 'legato';
    if (mono) {
      this.monoStack = (this.monoStack || []).filter((n) => n !== note);
      const v = this.voices[0];
      if (this.monoStack.length > 0) {
        const last = this.monoStack[this.monoStack.length - 1];
        if (p.voiceMode === 'legato') v.glideTo(last);
        else v.start(last, v.velocity, p, v.freq, this.tick++);
      } else if (this.sustainPedal) {
        v.sustained = true;
        v.held = false;
      } else {
        v.release();
      }
      return;
    }
    for (const v of this.voices) {
      if (v.active && v.note === note && v.held) {
        if (this.sustainPedal) {
          v.held = false;
          v.sustained = true;
        } else {
          v.release();
        }
      }
    }
  }

  process(_inputs, outputs) {
    if (this.disposed) return false;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const len = outL.length;
    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const p = this.patch;
    if (!p) return true;

    const ctl = { bend: this.bend, mod: this.mod, bpm: this.bpm };

    let cursor = 0;
    while (cursor < len) {
      // 現在位置までのイベントを適用
      while (this.queue.length > 0) {
        const offset = Math.round((this.queue[0].time - currentTime) * sampleRate);
        if (offset <= cursor) {
          this.applyEvent(this.queue.shift());
        } else {
          break;
        }
      }
      let next = len;
      if (this.queue.length > 0) {
        const offset = Math.round((this.queue[0].time - currentTime) * sampleRate);
        if (offset < len) next = Math.max(cursor + 1, offset);
      }
      this.renderRange(outL, outR, cursor, next, p, ctl);
      cursor = next;
    }

    // 出力レベル計測（UI メーター用）
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(outL[i]);
      const b = Math.abs(outR[i]);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    this.peak = Math.max(this.peak * 0.85, peak);
    this.meterCounter += len;
    if (this.meterCounter >= sampleRate * 0.05) {
      this.meterCounter = 0;
      let voices = 0;
      for (const v of this.voices) if (v.active) voices++;
      for (const d of this.drums) if (d.active) voices++;
      this.port.postMessage({ type: 'meter', peak: this.peak, voices });
    }
    return true;
  }

  renderRange(outL, outR, from, to, patch, ctl) {
    if (to <= from) return;
    if (patch.kind === 'drum') {
      for (const d of this.drums) d.render(outL, outR, from, to);
    } else {
      for (const v of this.voices) {
        if (v.active) v.render(outL, outR, from, to, patch, ctl);
      }
    }
  }
}

registerProcessor('mss-synth', SynthProcessor);
