/*
 * Aozora Grand Piano - 物理モデリング音源プロセッサ
 *
 * サンプル素材を一切使わず、弦のモード（部分音）合成でグランドピアノを生成する。
 *  - 弦 : 2極共振器バンク（不協和度 B を含む部分音周波数）
 *  - ハンマー : 打弦時間で明るさが変わる余弦パルス + フェルトノイズ
 *  - ダンパー : 離鍵時の音高依存レリーズ、高音域はダンパー無し
 *  - 共鳴 : サステインペダル時に働く共鳴弦バンク
 *
 * すべて浮動小数の再帰式なので、オフラインレンダリング（WAV書き出し）でも
 * リアルタイムと同じ音になる。
 */

const MAX_VOICES = 48;
const MAX_MODES = 56;
const TWO_PI = Math.PI * 2;

/** 共鳴弦バンクに使う音高（各4部分音） */
const SYMPATHETIC_NOTES = [33, 40, 45, 50, 55, 60, 64, 67, 72, 76, 79, 84];
const SYMPATHETIC_MODES = 4;

/** ダンパーが付いていない最低音（実機同様、最高音域は常に鳴りっぱなし） */
const FIRST_UNDAMPED_NOTE = 93; // A6 付近から上

const DEFAULT_PARAMS = {
  gain: 0.85,
  brightness: 0.5,   // ハンマーの硬さ（0=フェルト 1=ブライト）
  decay: 1.0,        // 減衰時間の倍率
  stringRes: 0.5,    // 共鳴弦の量
  unison: 0.5,       // ユニゾン弦のずれ（うなり）
  hammerNoise: 0.4,  // 打弦ノイズ
  releaseNoise: 0.5, // 離鍵ノイズ
  velCurve: 1.0,     // ベロシティカーブ（>1 で重い）
  dynamics: 1.0,     // ダイナミクスレンジ
  a4: 440,
  stretch: 1.0,      // ストレッチチューニング（レイルズバック曲線）
  strikePos: 0.5,    // 打弦位置（0=端に近い＝硬い 1=中央寄り＝丸い）
  maxVoices: 40,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** ストレッチチューニングを含む基音周波数 */
function noteFrequency(note, a4, stretch) {
  const d = note - 69;
  const cents = stretch * 0.014 * d * Math.abs(d);
  return a4 * Math.pow(2, (d + cents / 100) / 12);
}

/** 弦の不協和度 B（低音の巻線は小さく、高音ほど急激に大きい） */
function inharmonicity(note) {
  return Math.pow(10, -4.6 + 0.0295 * (note - 21));
}

/** 基音の減衰時定数（秒） */
function baseTau(note) {
  return 8.0 * Math.exp(-0.042 * (note - 21)) + 0.12;
}

/**
 * ハンマーパルス（2つの指数関数の差）の角周波数 w における伝達量。
 * H(z) = 1/(1 - pd z^-1) - 1/(1 - pa z^-1) の振幅特性。
 */
function excitationGain(w, pd, pa) {
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const dr1 = 1 - pd * cw, di1 = pd * sw;
  const dr2 = 1 - pa * cw, di2 = pa * sw;
  const m1 = dr1 * dr1 + di1 * di1;
  const m2 = dr2 * dr2 + di2 * di2;
  const re = dr1 / m1 - dr2 / m2;
  const im = -di1 / m1 + di2 / m2;
  return Math.sqrt(re * re + im * im);
}

/** 離鍵時のダンパー時定数（低音ほどゆっくり止まる） */
function damperTau(note) {
  return 0.30 * Math.exp(-0.018 * (note - 21)) + 0.045;
}

class PianoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.params = { ...DEFAULT_PARAMS };
    this.frame = 0;
    this.pending = [];

    // オフラインレンダリングでは postMessage の到達順が保証されないため、
    // パラメータと演奏イベントは processorOptions からも受け取れるようにする。
    const opts = (options && options.processorOptions) || {};
    if (opts.params) Object.assign(this.params, opts.params);

    // --- 弦（モード）状態: voice * MAX_MODES のフラット配列 ---
    const cells = MAX_VOICES * MAX_MODES;
    this.y1 = new Float64Array(cells);
    this.y2 = new Float64Array(cells);
    this.a1 = new Float64Array(cells);
    this.a2 = new Float64Array(cells);
    this.mg = new Float64Array(cells);

    // --- ボイス状態 ---
    this.vNote = new Int16Array(MAX_VOICES).fill(-1);
    this.vModes = new Int16Array(MAX_VOICES);
    this.vActive = new Uint8Array(MAX_VOICES);
    this.vKeyDown = new Uint8Array(MAX_VOICES);
    this.vSostenuto = new Uint8Array(MAX_VOICES);
    this.vEnv = new Float64Array(MAX_VOICES);        // ダンパー包絡
    this.vEnvCoef = new Float64Array(MAX_VOICES);    // 1.0 = 減衰なし
    this.vGainL = new Float64Array(MAX_VOICES);
    this.vGainR = new Float64Array(MAX_VOICES);
    this.vExD = new Float64Array(MAX_VOICES);
    this.vExA = new Float64Array(MAX_VOICES);
    this.vExPd = new Float64Array(MAX_VOICES);
    this.vExPa = new Float64Array(MAX_VOICES);
    this.vExN = new Float64Array(MAX_VOICES);
    this.vExEnd = new Float64Array(MAX_VOICES);
    this.vExAmp = new Float64Array(MAX_VOICES);
    this.vNoiseIdx = new Float64Array(MAX_VOICES);
    this.vNoiseLen = new Float64Array(MAX_VOICES);
    this.vNoiseAmp = new Float64Array(MAX_VOICES);
    this.vNoiseLp = new Float64Array(MAX_VOICES);
    this.vPeak = new Float64Array(MAX_VOICES);
    this.vAge = new Float64Array(MAX_VOICES);

    // --- 共鳴弦バンク ---
    const sCount = SYMPATHETIC_NOTES.length * SYMPATHETIC_MODES;
    this.sy1 = new Float64Array(sCount);
    this.sy2 = new Float64Array(sCount);
    this.sa1 = new Float64Array(sCount);
    this.sa2 = new Float64Array(sCount);
    this.sg = new Float64Array(sCount);
    this.sympGain = 0;
    this.sympTarget = 0;
    this.buildSympathetic();

    // --- ペダル ---
    this.sustain = 0;
    this.soft = 0;

    // --- 離鍵ノイズ ---
    this.relNoise = 0;
    this.relNoiseDecay = 0;
    this.relNoiseLp = 0;

    this.blockCount = 0;
    this.masterGain = this.params.gain;
    // オーディオスレッドで確保しないよう作業用バッファは先に用意しておく
    this.monoSum = new Float64Array(1024);
    this.ampScratch = new Float64Array(MAX_MODES);

    if (Array.isArray(opts.events)) {
      for (const ev of opts.events) {
        if (ev.atFrame > 0) this.pending.push(ev);
        else this.applyEvent(ev);
      }
    }

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  // ---------------------------------------------------------------- messages

  handleMessage(msg) {
    if (!msg) return;
    if (msg.type === 'params') {
      const prevA4 = this.params.a4;
      const prevStretch = this.params.stretch;
      const prevLimit = clamp(this.params.maxVoices | 0, 8, MAX_VOICES);
      Object.assign(this.params, msg.values);
      this.masterGain = this.params.gain;
      // 調律が変わったときだけ共鳴弦を組み直す（毎回だと響きが途切れるため）
      if (this.params.a4 !== prevA4 || this.params.stretch !== prevStretch) {
        this.buildSympathetic();
      }
      // 同時発音数を減らしたときは、範囲外に残ったボイスを止める
      const limit = clamp(this.params.maxVoices | 0, 8, MAX_VOICES);
      if (limit < prevLimit) {
        for (let v = limit; v < MAX_VOICES; v++) this.killVoice(v);
      }
      return;
    }
    if (msg.type === 'panic') {
      this.pending.length = 0;
      for (let v = 0; v < MAX_VOICES; v++) this.killVoice(v);
      this.sustain = 0;
      this.sympTarget = 0;
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
      case 'note':
        this.noteOn(msg.note, msg.vel);
        break;
      case 'off':
        this.noteOff(msg.note);
        break;
      case 'sustain':
        this.setSustain(msg.value);
        break;
      case 'sostenuto':
        this.setSostenuto(msg.value);
        break;
      case 'soft':
        this.soft = msg.value;
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

  // ------------------------------------------------------------------ voices

  allocVoice(note) {
    const limit = clamp(this.params.maxVoices | 0, 8, MAX_VOICES);
    // 同音の再打鍵は同じボイスに打ち込む（実機の再打弦と同じ挙動）
    for (let v = 0; v < limit; v++) {
      if (this.vActive[v] && this.vNote[v] === note) return v;
    }
    let free = -1;
    let quietest = -1;
    let quietestScore = Infinity;
    for (let v = 0; v < limit; v++) {
      if (!this.vActive[v]) { free = v; break; }
      const score = this.vPeak[v] * this.vEnv[v] * 1000 + this.vAge[v] * -1e-6;
      if (score < quietestScore) { quietestScore = score; quietest = v; }
    }
    if (free >= 0) return free;
    return quietest >= 0 ? quietest : 0;
  }

  noteOn(note, velocity) {
    note = clamp(note | 0, 21, 108);
    const p = this.params;
    const vel = clamp(velocity, 0.01, 1);

    const v = this.allocVoice(note);
    const reuse = this.vActive[v] === 1 && this.vNote[v] === note;
    const base = v * MAX_MODES;

    const f0 = noteFrequency(note, p.a4, p.stretch);
    const B = inharmonicity(note);
    const tau0 = baseTau(note) * clamp(p.decay, 0.3, 2.0);

    // 部分音の本数（可聴域まで、低音ほど多く）
    const modeCount = clamp(Math.floor(9000 / f0), 6, MAX_MODES);

    // 打弦位置（端に近いほど高次倍音が強い）
    const alpha = (0.075 + 0.055 * clamp(p.strikePos, 0, 1)) * (1 - 0.25 * (note - 21) / 87);
    // 1つの音に張られた2〜3本の弦のずれ（cent）。低次部分音を2本に分けてうなりを作る
    const detuneCents = 0.3 + 12 * Math.pow(clamp(p.unison, 0, 1), 1.8);

    if (!reuse) {
      for (let m = 0; m < MAX_MODES; m++) {
        this.y1[base + m] = 0;
        this.y2[base + m] = 0;
      }
    }

    let ampSum = 0;
    const amps = this.ampScratch;
    for (let k = 1; k <= modeCount; k++) {
      const a = Math.abs(Math.sin(Math.PI * k * alpha)) / Math.pow(k, 0.55);
      amps[k - 1] = a;
      ampSum += a;
    }
    if (ampSum <= 0) ampSum = 1;

    // --- ハンマー（打弦の力パルス）---
    // 2つの指数関数の差で作る。矩形/余弦パルスと違いスペクトルに零点がないため、
    // 高音でも痩せず、打弦時間だけで自然に明るさが変わる。
    const soft = this.soft;
    const velCurved = Math.pow(vel, clamp(p.velCurve, 0.4, 2.5));
    const dyn = clamp(p.dynamics, 0.2, 1.6);
    let amp = (0.035 + 0.965 * velCurved) * (1 - soft * 0.28);
    amp = Math.pow(amp, dyn);

    // 打弦時間（ms）：低音ほど長く、強打・ブライトなほど短い＝倍音が増える
    const contactMs = (0.24 + 3.6 * Math.exp(-0.035 * (note - 21)))
      * (1.9 - 1.15 * velCurved)
      * (1.5 - clamp(p.brightness, 0, 1) * 1.0)
      * (1 + soft * 0.5);
    const tauEx = Math.max(1.1, (contactMs / 1000) * sampleRate / 3);
    const pd = Math.exp(-1 / tauEx);
    const pa = Math.exp(-1 / (tauEx * 0.18));

    const nyq = sampleRate * 0.5;
    const f0Ratio15 = Math.pow(f0 / 1500, 1.4);
    let predicted = 0;
    let used = 0;
    for (let k = 1; k <= modeCount; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk >= nyq * 0.97) break;
      if (used >= MAX_MODES) break;

      const shape = Math.max(
        1,
        1 + 0.30 * (fk / f0 - 1) + 2.4 * (Math.pow(fk / 1500, 1.4) - f0Ratio15)
      );
      const tau = Math.max(0.02, tau0 / shape);
      const r = Math.exp(-1 / (tau * sampleRate));
      const modeAmp = amps[k - 1] / ampSum;

      // 低次部分音は「わずかにずれた2本の弦」として鳴らし、うなりを生む
      const pair = k <= 6 && used + 1 < MAX_MODES;
      const spread = detuneCents * (1 + k * 0.06);

      const writeMode = (freq, gain) => {
        const w = TWO_PI * freq / sampleRate;
        const idx = base + used;
        this.a1[idx] = 2 * r * Math.cos(w);
        this.a2[idx] = -r * r;
        // sin(w) を掛けて、部分音ごとの共振利得の差を打ち消す
        this.mg[idx] = gain * Math.sin(w);
        // この部分音にハンマーパルスがどれだけ伝わるかを積算し、音量を揃える
        predicted += gain * excitationGain(w, pd, pa);
        used++;
      };

      if (pair) {
        writeMode(fk * Math.pow(2, -spread / 2400), modeAmp * 0.56);
        writeMode(fk * Math.pow(2, spread / 2400), modeAmp * 0.44);
      } else {
        writeMode(fk, modeAmp);
      }
    }
    this.vModes[v] = used;

    this.vExD[v] = 1;
    this.vExA[v] = 1;
    this.vExPd[v] = pd;
    this.vExPa[v] = pa;
    this.vExN[v] = 0;
    this.vExEnd[v] = Math.ceil(tauEx * 9);
    // 音域によらず同じ強さで鳴るよう、伝達量で正規化する
    const exAmp = (amp * 0.42) / Math.max(0.05, predicted);
    this.vExAmp[v] = exAmp;

    this.vNoiseLen[v] = Math.max(12, tauEx * 6);
    this.vNoiseIdx[v] = 0;
    this.vNoiseAmp[v] = exAmp * clamp(p.hammerNoise, 0, 1) * 0.9;
    this.vNoiseLp[v] = 0;

    // --- 定位（低音=左 / 高音=右、実際の弦の並びに合わせる）---
    const pan = clamp((note - 62) / 45, -1, 1) * 0.55;
    const theta = (pan + 1) * Math.PI * 0.25;
    // 実機同様、低音側をわずかに前に出す
    const noteGain = 1 + 0.18 * clamp((60 - note) / 39, -0.5, 1);
    this.vGainL[v] = Math.cos(theta) * noteGain;
    this.vGainR[v] = Math.sin(theta) * noteGain;

    this.vNote[v] = note;
    this.vActive[v] = 1;
    this.vKeyDown[v] = 1;
    this.vSostenuto[v] = 0;
    this.vEnv[v] = 1;
    this.vEnvCoef[v] = 1;
    this.vPeak[v] = amp;
    this.vAge[v] = this.frame;
  }

  noteOff(note) {
    note = note | 0;
    for (let v = 0; v < MAX_VOICES; v++) {
      if (!this.vActive[v] || this.vNote[v] !== note) continue;
      this.vKeyDown[v] = 0;
      if (this.sustain > 0.45 || this.vSostenuto[v]) continue;
      this.startDamper(v);
    }
  }

  startDamper(v) {
    const note = this.vNote[v];
    if (note >= FIRST_UNDAMPED_NOTE) return; // ダンパー無し音域
    const tau = damperTau(note);
    this.vEnvCoef[v] = Math.exp(-1 / (tau * sampleRate));

    // ダンパーがフェルトで弦に触れる音
    const amt = clamp(this.params.releaseNoise, 0, 1);
    if (amt > 0) {
      this.relNoise = Math.max(this.relNoise, 0.02 * amt * Math.min(1, this.vPeak[v] * 2.2));
      this.relNoiseDecay = Math.exp(-1 / (0.02 * sampleRate));
    }
  }

  setSustain(value) {
    this.sustain = value;
    this.sympTarget = value > 0.45 ? clamp(this.params.stringRes, 0, 1) : 0;
    if (value <= 0.45) {
      for (let v = 0; v < MAX_VOICES; v++) {
        if (this.vActive[v] && !this.vKeyDown[v] && !this.vSostenuto[v]) this.startDamper(v);
      }
    } else {
      for (let v = 0; v < MAX_VOICES; v++) {
        if (this.vActive[v]) this.vEnvCoef[v] = 1;
      }
    }
  }

  setSostenuto(value) {
    if (value > 0.45) {
      for (let v = 0; v < MAX_VOICES; v++) {
        if (this.vActive[v] && this.vKeyDown[v]) {
          this.vSostenuto[v] = 1;
          this.vEnvCoef[v] = 1;
        }
      }
    } else {
      for (let v = 0; v < MAX_VOICES; v++) {
        if (!this.vSostenuto[v]) continue;
        this.vSostenuto[v] = 0;
        if (!this.vKeyDown[v] && this.sustain <= 0.45) this.startDamper(v);
      }
    }
  }

  killVoice(v) {
    this.vActive[v] = 0;
    this.vKeyDown[v] = 0;
    this.vSostenuto[v] = 0;
    this.vNote[v] = -1;
    this.vEnv[v] = 0;
    this.vPeak[v] = 0;
    this.vModes[v] = 0;
  }

  // ------------------------------------------------------------- sympathetic

  buildSympathetic() {
    const p = this.params;
    let i = 0;
    for (const note of SYMPATHETIC_NOTES) {
      const f0 = noteFrequency(note, p.a4, p.stretch);
      const B = inharmonicity(note);
      for (let k = 1; k <= SYMPATHETIC_MODES; k++) {
        const fk = k * f0 * Math.sqrt(1 + B * k * k);
        const w = TWO_PI * fk / sampleRate;
        const tau = Math.max(0.15, baseTau(note) * 0.55 / (1 + 0.4 * (k - 1)));
        const r = Math.exp(-1 / (tau * sampleRate));
        this.sa1[i] = 2 * r * Math.cos(w);
        this.sa2[i] = -r * r;
        // 共振で振幅が積み上がるため (1-r) で正規化する（これが無いと発散する）
        this.sg[i] = (1 - r) * Math.sin(w) * 1.6 / k;
        this.sy1[i] = 0;
        this.sy2[i] = 0;
        i++;
      }
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

    const y1 = this.y1, y2 = this.y2, a1 = this.a1, a2 = this.a2, mg = this.mg;
    const limit = clamp(this.params.maxVoices | 0, 8, MAX_VOICES);
    if (this.monoSum.length < n) this.monoSum = new Float64Array(n);
    const monoSum = this.monoSum;
    monoSum.fill(0, 0, n);
    let voiceCount = 0;

    for (let v = 0; v < limit; v++) {
      if (!this.vActive[v]) continue;
      voiceCount++;

      const base = v * MAX_MODES;
      const modes = this.vModes[v];
      const gL = this.vGainL[v];
      const gR = this.vGainR[v];
      const envCoef = this.vEnvCoef[v];
      let env = this.vEnv[v];

      let exD = this.vExD[v];
      let exA = this.vExA[v];
      const exPd = this.vExPd[v];
      const exPa = this.vExPa[v];
      let exN = this.vExN[v];
      const exEnd = this.vExEnd[v];
      const exAmp = this.vExAmp[v];
      let nsIdx = this.vNoiseIdx[v];
      const nsLen = this.vNoiseLen[v];
      const nsAmp = this.vNoiseAmp[v];
      let nsLp = this.vNoiseLp[v];

      let peak = 0;

      for (let i = 0; i < n; i++) {
        // --- 励振（ハンマー） ---
        let ex = 0;
        if (exN < exEnd) {
          ex = exAmp * (exD - exA);
          exD *= exPd;
          exA *= exPa;
          exN++;
        }
        if (nsIdx < nsLen) {
          const shape = 1 - nsIdx / nsLen;
          // フェルトの当たり音は帯域を絞ってから弦に入れる
          nsLp += ((Math.random() * 2 - 1) - nsLp) * 0.35;
          ex += nsLp * nsAmp * shape * shape;
          nsIdx++;
        }

        // --- 弦のモード合成 ---
        let s = 0;
        for (let m = 0; m < modes; m++) {
          const idx = base + m;
          const y = a1[idx] * y1[idx] + a2[idx] * y2[idx] + mg[idx] * ex;
          y2[idx] = y1[idx];
          y1[idx] = y;
          s += y;
        }

        if (envCoef !== 1) env *= envCoef;
        s *= env;

        const av = s < 0 ? -s : s;
        if (av > peak) peak = av;

        monoSum[i] += s;
        left[i] += s * gL;
        if (right !== left) right[i] += s * gR;
      }

      this.vExD[v] = exD;
      this.vExA[v] = exA;
      this.vExN[v] = exN;
      this.vNoiseIdx[v] = nsIdx;
      this.vNoiseLp[v] = nsLp;
      this.vEnv[v] = env;
      this.vPeak[v] = peak;

      // 聞こえなくなったボイスは解放
      if (peak < 2e-5 && exN >= exEnd) this.killVoice(v);
    }

    // --- 共鳴弦（ペダルダウン時）---
    const sympStep = 1 / (0.05 * sampleRate);
    const sCount = this.sa1.length;
    if (this.sympGain > 1e-4 || this.sympTarget > 1e-4) {
      const sy1 = this.sy1, sy2 = this.sy2, sa1 = this.sa1, sa2 = this.sa2, sg = this.sg;
      for (let i = 0; i < n; i++) {
        if (this.sympGain < this.sympTarget) this.sympGain = Math.min(this.sympTarget, this.sympGain + sympStep);
        else if (this.sympGain > this.sympTarget) this.sympGain = Math.max(this.sympTarget, this.sympGain - sympStep);
        const drive = monoSum[i] * this.sympGain * 0.5;
        let acc = 0;
        for (let m = 0; m < sCount; m++) {
          const y = sa1[m] * sy1[m] + sa2[m] * sy2[m] + sg[m] * drive;
          sy2[m] = sy1[m];
          sy1[m] = y;
          acc += y;
        }
        const wet = acc * 0.22;
        left[i] += wet;
        if (right !== left) right[i] += wet * 0.9;
      }
    }

    // --- 離鍵ノイズ（ダンパー接触音）---
    if (this.relNoise > 1e-5) {
      for (let i = 0; i < n; i++) {
        this.relNoiseLp += ((Math.random() * 2 - 1) - this.relNoiseLp) * 0.25;
        const s = this.relNoiseLp * this.relNoise;
        left[i] += s;
        if (right !== left) right[i] += s * 0.8;
        this.relNoise *= this.relNoiseDecay;
      }
      if (this.relNoise < 1e-5) this.relNoise = 0;
    }

    // --- マスター ---
    const g = this.masterGain;
    for (let i = 0; i < n; i++) {
      left[i] *= g;
      if (right !== left) right[i] *= g;
    }

    this.frame += n;
    if (++this.blockCount % 16 === 0) {
      this.port.postMessage({ type: 'status', voices: voiceCount, frame: this.frame });
    }
    return true;
  }
}

registerProcessor('piano-processor', PianoProcessor);
