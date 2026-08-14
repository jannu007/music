/*
 * Takibi Guitar - 物理モデリング・ギター音源プロセッサ
 *
 * サンプル素材を一切使わず、弦を「デジタル導波管（遅延ループ）」として
 * その場で計算する。1弦 = 1ループなので、実際のギターと同じく
 * 「同じ弦で次の音を弾くと前の音が止まる」という挙動が自然に出る。
 *
 *  - 弦     : 分数遅延ループ + ループフィルタ（高域減衰） + 分散オールパス（弦の張り）
 *  - 撥弦   : ピッキング位置に頂点を持つ三角形の初期変位 + ピックのアタックノイズ
 *  - ピック位置 : 三角形の頂点位置がそのままコムフィルタになる（実弦と同じ原理）
 *  - 出力   : 変位を微分して速度に変換（ピックアップ/駒の感じ方に合わせる）
 *  - 共鳴   : 全弦の和をブリッジ経由で各弦に返す（開放弦が共鳴する）
 *  - 奏法   : チョーキング・スライド・ハンマリング・ビブラート・ブリッジミュート
 *
 * すべて浮動小数の再帰式なので、オフラインレンダリング（WAV書き出し）でも
 * リアルタイムと同じ音になる。
 */

const MAX_STRINGS = 8;
const DELAY_BITS = 12;
const DELAY_LEN = 1 << DELAY_BITS; // 4096 サンプル ≒ 11Hz まで対応
const DELAY_MASK = DELAY_LEN - 1;
const AP_STAGES = 2;

const DEFAULT_PARAMS = {
  gain: 0.9,
  a4: 440,
  capo: 0,
  pickPos: 0.17,
  pickHard: 0.55,
  brightness: 0.6,
  sustain: 1.0,
  stiffness: 0.35,
  coupling: 0.45,
  pickNoise: 0.4,
  fretNoise: 0.4,
  buzz: 0.2,
  velCurve: 1.0,
  spread: 0.5,
  stringCount: 6,
  wound: 3,
};

const DEFAULT_TUNING = [40, 45, 50, 55, 59, 64];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 1極ローパス H(z)=(1-a)/(1-a z^-1) の位相遅延（サンプル） */
function lowpassPhaseDelay(a, w) {
  if (w < 1e-6) return a / (1 - a);
  return Math.atan2(a * Math.sin(w), 1 - a * Math.cos(w)) / w;
}

/** 1次オールパス H(z)=(c+z^-1)/(1+c z^-1) の位相遅延（サンプル、c<0 で分散） */
function allpassPhaseDelay(c, w) {
  if (w < 1e-6) return (1 - c) / (1 + c);
  const s = Math.sin(w);
  const co = Math.cos(w);
  const angN = Math.atan2(-s, c + co);
  const angD = Math.atan2(-c * s, 1 + c * co);
  return -(angN - angD) / w;
}

class GuitarProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.params = { ...DEFAULT_PARAMS };
    this.tuning = DEFAULT_TUNING.slice();
    this.frame = 0;
    this.pending = [];

    const opts = (options && options.processorOptions) || {};
    if (opts.params) Object.assign(this.params, opts.params);
    if (Array.isArray(opts.tuning) && opts.tuning.length > 0) {
      this.tuning = opts.tuning.slice(0, MAX_STRINGS);
    }

    // --- 弦の状態 ---
    this.buf = new Float64Array(MAX_STRINGS * DELAY_LEN);
    this.wIdx = new Int32Array(MAX_STRINGS);
    this.delay = new Float64Array(MAX_STRINGS).fill(100);
    this.delayTarget = new Float64Array(MAX_STRINGS).fill(100);
    /** グリッサンド：残りサンプル数と1サンプルあたりの倍率（音程が対数で動くよう掛け算で進める） */
    this.slideLeft = new Int32Array(MAX_STRINGS);
    this.slideMul = new Float64Array(MAX_STRINGS).fill(1);
    this.slideTime = new Float64Array(MAX_STRINGS).fill(0.012);
    this.freq = new Float64Array(MAX_STRINGS).fill(110);
    this.fret = new Int16Array(MAX_STRINGS).fill(-1);
    this.bend = new Float64Array(MAX_STRINGS);
    this.vibDepth = new Float64Array(MAX_STRINGS);
    this.vibRate = new Float64Array(MAX_STRINGS);
    this.vibPhase = new Float64Array(MAX_STRINGS);
    this.lpA = new Float64Array(MAX_STRINGS).fill(0.3);
    this.lpZ = new Float64Array(MAX_STRINGS);
    this.apC = new Float64Array(MAX_STRINGS);
    this.apX = new Float64Array(MAX_STRINGS * AP_STAGES);
    this.apY = new Float64Array(MAX_STRINGS * AP_STAGES);
    this.loopGain = new Float64Array(MAX_STRINGS).fill(0.99);
    this.loopTarget = new Float64Array(MAX_STRINGS).fill(0.99);
    this.outScale = new Float64Array(MAX_STRINGS).fill(1);
    this.exScale = new Float64Array(MAX_STRINGS).fill(1);
    this.coupScale = new Float64Array(MAX_STRINGS).fill(0);
    this.prevRaw = new Float64Array(MAX_STRINGS);
    this.active = new Uint8Array(MAX_STRINGS);
    this.level = new Float64Array(MAX_STRINGS);
    this.gainL = new Float64Array(MAX_STRINGS).fill(0.7);
    this.gainR = new Float64Array(MAX_STRINGS).fill(0.7);
    this.damped = new Uint8Array(MAX_STRINGS);
    this.palmString = new Float64Array(MAX_STRINGS);

    // 撥弦ノイズ（ピックが弦に当たる音）
    this.nsIdx = new Float64Array(MAX_STRINGS);
    this.nsLen = new Float64Array(MAX_STRINGS);
    this.nsAmp = new Float64Array(MAX_STRINGS);
    this.nsLp = new Float64Array(MAX_STRINGS);
    this.nsRattle = new Float64Array(MAX_STRINGS);

    // --- ブリッジ（弦間の共鳴）---
    this.bridgeZ = 0;
    this.bridgeZ2 = 0;

    // --- 指のこすれ音（スライド時）---
    this.squeak = 0;
    this.squeakDecay = 0.999;
    this.squeakLp = 0;
    this.squeakBp = 0;

    this.palm = 0;
    this.masterGain = this.params.gain;
    this.blockCount = 0;
    this.scratch = new Float64Array(DELAY_LEN);
    this.apPrime = new Float64Array(AP_STAGES * 2);
    this.levelsMsg = new Float32Array(MAX_STRINGS);
    this.freqMsg = new Float32Array(MAX_STRINGS);

    for (let s = 0; s < MAX_STRINGS; s++) this.updatePan(s);

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
      Object.assign(this.params, msg.values);
      if (Array.isArray(msg.tuning) && msg.tuning.length > 0) {
        this.tuning = msg.tuning.slice(0, MAX_STRINGS);
      }
      this.masterGain = this.params.gain;
      for (let s = 0; s < MAX_STRINGS; s++) {
        this.updatePan(s);
        if (this.active[s]) this.retune(s, false);
      }
      return;
    }
    if (msg.type === 'panic') {
      this.pending.length = 0;
      for (let s = 0; s < MAX_STRINGS; s++) this.killString(s);
      this.palm = 0;
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
        this.pluck(msg.string, msg.fret, msg.vel, msg.mute);
        break;
      case 'fret':
        this.setFret(msg.string, msg.fret, msg.slide, msg.vel);
        break;
      case 'bend':
        this.setBend(msg.string, msg.amount);
        break;
      case 'vibrato':
        this.setVibrato(msg.string, msg.depth, msg.rate);
        break;
      case 'damp':
        this.damp(msg.string, msg.amount === undefined ? 1 : msg.amount);
        break;
      case 'dampAll':
        for (let s = 0; s < MAX_STRINGS; s++) this.damp(s, 1);
        break;
      case 'palm':
        this.setPalm(msg.value);
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

  // ------------------------------------------------------------------ tuning

  stringCount() {
    return clamp(this.tuning.length, 1, MAX_STRINGS);
  }

  /** 押弦位置から実際の周波数を求める */
  fretFreq(string, fret) {
    const p = this.params;
    const note = this.tuning[string] + Math.max(0, fret) + p.capo + this.bend[string];
    return p.a4 * Math.pow(2, (note - 69) / 12);
  }

  updatePan(s) {
    const n = Math.max(1, this.stringCount() - 1);
    const spread = clamp(this.params.spread, 0, 1);
    // 低音弦を左、高音弦を右に置く（客席から見たギターの弦の並び）
    const pan = ((s / n) * 2 - 1) * spread * 0.7;
    const theta = (pan + 1) * Math.PI * 0.25;
    this.gainL[s] = Math.cos(theta);
    this.gainR[s] = Math.sin(theta);
  }

  /** 現在の周波数・減衰設定からループ係数を組み直す */
  retune(s, immediate) {
    const p = this.params;
    const f0 = clamp(this.fretFreq(s, this.fret[s]), 20, sampleRate * 0.35);
    this.freq[s] = f0;
    const w = (2 * Math.PI * f0) / sampleRate;

    // --- ループフィルタ（高域の減衰）---
    // カットオフは「基音の何倍音か」で決める。絶対周波数で決めると
    // 高音側で基音そのものが強く減衰し、音が一瞬で消えてしまうため。
    const palm = clamp(Math.max(this.palm, this.palmString[s]), 0, 1);
    const bright = clamp(p.brightness, 0, 1);
    let harmonics = 2.2 * Math.pow(14, bright);
    // 巻線の低音弦はもともと高域が伸びにくい
    const woundIdx = clamp(p.wound, 0, MAX_STRINGS);
    if (s < woundIdx) harmonics *= 0.6 + 0.4 * (s / Math.max(1, woundIdx));
    harmonics *= 1 - palm * 0.88;
    harmonics = clamp(harmonics, 3.0, 400);
    const fc = clamp(f0 * harmonics, 160, sampleRate * 0.47);
    const a = clamp(Math.exp((-2 * Math.PI * fc) / sampleRate), 0.0, 0.995);
    this.lpA[s] = a;

    // --- 分散（弦の張り＝倍音のわずかなずれ）---
    const stiff = clamp(p.stiffness, 0, 1);
    // 低音弦（太い弦）ほど分散が大きい
    const c = -0.45 * stiff * (1 - (s / Math.max(1, this.stringCount() - 1)) * 0.55);
    this.apC[s] = c;

    // --- 遅延長：ループ全体の位相遅延が 1周期になるよう補正する ---
    const pdLp = lowpassPhaseDelay(a, w);
    const pdAp = allpassPhaseDelay(c, w) * AP_STAGES;
    let d = sampleRate / f0 - pdLp - pdAp;
    d = clamp(d, 2, DELAY_LEN - 4);
    this.delayTarget[s] = d;
    if (immediate) {
      this.delay[s] = d;
      this.slideLeft[s] = 0;
    } else {
      this.startSlide(s, d);
    }

    // --- ループゲイン（T60 から算出）---
    let t60 = (1.9 + 9.5 * Math.exp(-0.031 * (this.tuning[s] + Math.max(0, this.fret[s]) - 40)))
      * clamp(p.sustain, 0.2, 2.5);
    if (palm > 0) t60 = t60 * (1 - palm) + 0.11 * palm;
    t60 = Math.max(0.05, t60);
    const g = Math.pow(10, -3 / (t60 * f0));
    this.loopTarget[s] = clamp(g, 0, 0.99995);
    if (immediate) this.loopGain[s] = this.loopTarget[s];

    // --- 出力ゲイン：微分（変位→速度）の周波数依存を打ち消す ---
    const diff = Math.max(1e-4, 2 * Math.sin(Math.PI * f0 / sampleRate));
    this.outScale[s] = 0.22 / diff;
    // 弦へノイズを注入するときは、出力側の倍率を打ち消してから入れる
    // （そうしないと微分で高域が持ち上がり、低音弦ほど爆音になる）
    this.exScale[s] = 1 / this.outScale[s];
    // 共鳴の注入量：遅延ループの共振ゲインは 1/(1-g) まで持ち上がるので、
    // (1-g) を掛けて打ち消しておかないと弦どうしで正帰還して暴走する
    this.coupScale[s] = (1 - this.loopTarget[s]) * this.exScale[s];
  }

  /**
   * 目標の遅延長へ滑らかに移動させる。
   * 音程が対数で動くよう、毎サンプル一定の「倍率」を掛けて進める。
   */
  startSlide(s, target) {
    const from = this.delay[s];
    if (from <= 0 || target <= 0) {
      this.delay[s] = target;
      this.slideLeft[s] = 0;
      return;
    }
    const ratio = target / from;
    if (Math.abs(ratio - 1) < 1e-7) {
      this.delay[s] = target;
      this.slideLeft[s] = 0;
      return;
    }
    const n = Math.max(1, Math.round(this.slideTime[s] * sampleRate));
    this.slideMul[s] = Math.pow(ratio, 1 / n);
    this.slideLeft[s] = n;
  }

  // ------------------------------------------------------------------ 奏法

  pluck(string, fret, velocity, mute) {
    const s = clamp(string | 0, 0, this.stringCount() - 1);
    const p = this.params;
    const vel = clamp(velocity, 0.02, 1);

    this.fret[s] = Math.max(-1, fret | 0);
    this.bend[s] = 0;
    this.vibDepth[s] = 0;
    this.damped[s] = 0;
    this.palmString[s] = mute === undefined ? 0 : clamp(mute, 0, 1);
    this.retune(s, true);

    const amp = Math.pow(vel, clamp(p.velCurve, 0.4, 2.5));
    const L = Math.max(8, Math.min(DELAY_LEN - 8, Math.round(this.delay[s])));
    const beta = clamp(p.pickPos, 0.02, 0.5);
    const scratch = this.scratch;

    // --- ピッキング位置に頂点を持つ三角形の初期変位 ---
    // scratch[t] は「読み出される順」に並べる（t=0 が最初に鳴る）。
    // 三角形の角（＝出力では段差）がループの継ぎ目に来ると、1周期後に
    // フィルタ通過後の波形との差が段差として出てしまうため、
    // 角が発音直後に来るよう波形を回転させておく。
    const lead = Math.min(Math.round(L * 0.05) + 6, Math.max(1, Math.floor(L * 0.25)));
    let sum = 0;
    for (let t = 0; t < L; t++) {
      let x = (t + L - lead) / L;
      x -= Math.floor(x);
      const tri = x < beta ? x / beta : (1 - x) / (1 - beta);
      scratch[t] = tri;
      sum += tri;
    }
    // 直流成分を取り除く（残すと低い唸りとして残ってしまう）
    const mean = sum / L;
    for (let t = 0; t < L; t++) scratch[t] -= mean;

    // --- ピックの当たり幅（柔らかいほど頂点が鈍る＝高域が減る）---
    const passes = Math.round((1 - clamp(p.pickHard, 0, 1)) * 7) + 1;
    for (let pass = 0; pass < passes; pass++) {
      let prev = scratch[L - 1];
      for (let t = 0; t < L; t++) {
        const cur = scratch[t];
        const next = scratch[(t + 1) % L];
        scratch[t] = (prev + 2 * cur + next) * 0.25;
        prev = cur;
      }
    }

    // --- ループフィルタを1周ぶん先に通しておく ---
    // これが無いと「生の三角波（1周期目）」と「フィルタ通過後（2周期目以降）」の
    // 差が継ぎ目の段差になる。ミュートなど減衰の強い設定ほど顕著。
    {
      const a = this.lpA[s];
      let z = scratch[L - 1];
      // 1周目は状態を収束させるだけ、2周目で実際に書き換える
      for (let t = 0; t < L; t++) z = (1 - a) * scratch[t] + a * z;
      for (let t = 0; t < L; t++) {
        z = (1 - a) * scratch[t] + a * z;
        scratch[t] = z;
      }
    }

    // --- 弦へ書き込む（前の音が鳴っていればピックが触れて減衰する）---
    // 1周期ぶんの減衰を先に波形へ織り込む。こうしないとミュート時のように
    // 減衰が速い設定で、1周期ごとに音量が階段状に落ちてクリックになる。
    const base = s * DELAY_LEN;
    const w = this.wIdx[s];
    const retain = 0.16;
    const scale = amp * 1.0;
    const taper = Math.log(Math.max(1e-6, this.loopGain[s])) / L;
    // 遅延長は整数とは限らず、線形補間は1サンプル手前も読む。
    // 手前2サンプルまで円環的に埋めておかないと、発音の1サンプル目に
    // 「初期変位」と「未書き込みの 0」の段差が出てクリックになる。
    for (let t = -2; t < L; t++) {
      const ci = ((t % L) + L) % L;
      const idx = base + ((w - L + t) & DELAY_MASK);
      this.buf[idx] = this.buf[idx] * retain + scratch[ci] * scale * Math.exp(taper * t);
    }

    // 初期変位を書き込んだだけだと、ループフィルタの内部状態が 0 のままなので
    // 1周期後に「書き戻した値」と「初期変位」の段差が出て巨大なクリックになる。
    // 直前に読まれるはずの波形をあらかじめ通して、状態を充填しておく。
    {
      const primeN = Math.min(L, 128);
      const a = this.lpA[s];
      const gg = this.loopGain[s];
      const c = this.apC[s];
      const apPrime = this.apPrime;
      apPrime.fill(0);
      let z = this.buf[base + ((w - primeN) & DELAY_MASK)];
      // 読み出し順（i = primeN-1 → 0）に沿ってループの伝達を再現する
      for (let i = primeN - 1; i >= 0; i--) {
        const x = this.buf[base + ((w - 1 - i) & DELAY_MASK)];
        z = (1 - a) * x + a * z;
        let v = z * gg;
        for (let k = 0; k < AP_STAGES; k++) {
          const px = apPrime[k * 2];
          const py = apPrime[k * 2 + 1];
          const y = c * v + px - c * py;
          apPrime[k * 2] = v;
          apPrime[k * 2 + 1] = y;
          v = y;
        }
      }
      this.lpZ[s] = z;
      for (let k = 0; k < AP_STAGES; k++) {
        this.apX[s * AP_STAGES + k] = apPrime[k * 2];
        this.apY[s * AP_STAGES + k] = apPrime[k * 2 + 1];
      }
      // 微分の直前値も、読み出し順で 1つ前にあたる値（補間込み）に合わせる
      const d0 = this.delay[s];
      const intD = d0 | 0;
      const frac = d0 - intD;
      const r0 = this.buf[base + ((w - 1 - intD) & DELAY_MASK)];
      const r1 = this.buf[base + ((w - 2 - intD) & DELAY_MASK)];
      this.prevRaw[s] = r0 * (1 - frac) + r1 * frac;
    }

    // --- ピックのアタックノイズ（弦をこする瞬間の音）---
    const noise = clamp(p.pickNoise, 0, 1) * (0.35 + 0.65 * clamp(p.pickHard, 0, 1));
    this.nsLen[s] = Math.max(24, sampleRate * (0.0012 + 0.0035 * (1 - clamp(p.pickHard, 0, 1))));
    this.nsIdx[s] = 0;
    this.nsAmp[s] = noise * amp * 0.5;
    this.nsLp[s] = 0;
    // 強く弾いたときのビビり
    this.nsRattle[s] = clamp(p.buzz, 0, 1) * Math.max(0, amp - 0.55) * 2.2;

    this.active[s] = 1;
    this.level[s] = amp;

    // フレットを押さえずに弾いた＝ブラッシング（すぐ止まる打楽器的な音）
    if (fret < 0) this.damp(s, 1);
  }

  /** 押弦位置だけを変える（ハンマリング/プリング/スライド） */
  setFret(string, fret, slideTime, vel) {
    const s = clamp(string | 0, 0, this.stringCount() - 1);
    const prev = this.fret[s];
    this.fret[s] = Math.max(0, fret | 0);
    this.bend[s] = 0;
    const time = slideTime === undefined ? 0.012 : Math.max(0.001, slideTime);
    this.slideTime[s] = time;
    this.retune(s, false);

    if (!this.active[s]) return;
    this.damped[s] = 0;

    // ハンマリング/プリングは弦を新しく叩くので少しだけ励振する
    if (vel !== undefined && vel > 0) {
      const amp = clamp(vel, 0, 1);
      this.nsLen[s] = Math.max(20, sampleRate * 0.003);
      this.nsIdx[s] = 0;
      this.nsAmp[s] = amp * 0.22 * (0.4 + clamp(this.params.pickNoise, 0, 1));
      this.nsLp[s] = 0;
      this.nsRattle[s] = 0;
      this.level[s] = Math.max(this.level[s], amp * 0.6);
    }

    // スライドの指こすれ音（巻線ほど大きい）
    const distance = Math.abs(this.fret[s] - prev);
    if (distance >= 2 && slideTime !== undefined && s < clamp(this.params.wound, 0, MAX_STRINGS)) {
      const amt = clamp(this.params.fretNoise, 0, 1);
      this.squeak = Math.max(this.squeak, amt * 0.06 * Math.min(1, distance / 5));
      this.squeakDecay = Math.exp(-1 / (Math.max(0.02, time) * sampleRate));
    }
  }

  setBend(string, amount) {
    const s = clamp(string | 0, 0, this.stringCount() - 1);
    this.bend[s] = clamp(amount, -3, 3);
    // チョーキングは指の動きなので少しだけ滑らかに追従させる
    this.slideTime[s] = 0.02;
    this.retune(s, false);
  }

  setVibrato(string, depth, rate) {
    const s = clamp(string | 0, 0, this.stringCount() - 1);
    this.vibDepth[s] = clamp(depth, 0, 1.5);
    this.vibRate[s] = clamp(rate, 0.5, 12);
  }

  damp(string, amount) {
    const s = clamp(string | 0, 0, this.stringCount() - 1);
    if (!this.active[s]) return;
    const amt = clamp(amount, 0, 1);
    // 指で触れて止める：T60 を一気に短くする
    const t60 = 0.5 * (1 - amt) + 0.055;
    const f0 = Math.max(20, this.freq[s]);
    this.loopTarget[s] = clamp(Math.pow(10, -3 / (t60 * f0)), 0, 0.9999);
    this.damped[s] = 1;
  }

  setPalm(value) {
    this.palm = clamp(value, 0, 1);
    for (let s = 0; s < MAX_STRINGS; s++) {
      if (this.active[s] && !this.damped[s]) this.retune(s, false);
    }
  }

  killString(s) {
    this.active[s] = 0;
    this.damped[s] = 0;
    this.level[s] = 0;
    this.lpZ[s] = 0;
    this.prevRaw[s] = 0;
    this.nsIdx[s] = 0;
    this.nsLen[s] = 0;
    this.vibDepth[s] = 0;
    this.bend[s] = 0;
    const base = s * DELAY_LEN;
    this.buf.fill(0, base, base + DELAY_LEN);
    for (let k = 0; k < AP_STAGES; k++) {
      this.apX[s * AP_STAGES + k] = 0;
      this.apY[s * AP_STAGES + k] = 0;
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

    const count = this.stringCount();
    const buf = this.buf;
    const coupling = clamp(this.params.coupling, 0, 1) * 1.5;
    const twoPiOverSr = (2 * Math.PI) / sampleRate;

    // ブリッジに集まった前ブロックの振動を各弦に返す（共鳴）
    let bridgeFeed = this.bridgeZ * coupling;

    for (let i = 0; i < n; i++) {
      let mixL = 0;
      let mixR = 0;
      let bridgeSum = 0;

      for (let s = 0; s < count; s++) {
        if (!this.active[s]) continue;

        // --- 遅延長の追従（スライド・チョーキング・ビブラート）---
        let d = this.delay[s];
        if (this.slideLeft[s] > 0) {
          d *= this.slideMul[s];
          if (--this.slideLeft[s] === 0) d = this.delayTarget[s];
          this.delay[s] = d;
        }
        if (this.vibDepth[s] > 0) {
          this.vibPhase[s] += twoPiOverSr * this.vibRate[s];
          if (this.vibPhase[s] > Math.PI * 2) this.vibPhase[s] -= Math.PI * 2;
          d *= Math.pow(2, (-this.vibDepth[s] * Math.sin(this.vibPhase[s])) / 12);
        }

        // --- 分数遅延の読み出し（線形補間）---
        const base = s * DELAY_LEN;
        const w = this.wIdx[s];
        const intD = d | 0;
        const frac = d - intD;
        const i0 = base + ((w - intD) & DELAY_MASK);
        const i1 = base + ((w - intD - 1) & DELAY_MASK);
        const raw = buf[i0] * (1 - frac) + buf[i1] * frac;

        // --- ループフィルタ（高域の減衰）---
        const a = this.lpA[s];
        let lp = (1 - a) * raw + a * this.lpZ[s];
        this.lpZ[s] = lp;

        // ループゲインを滑らかに追従させる（ミュート時のプツッを防ぐ）
        let g = this.loopGain[s];
        const gt = this.loopTarget[s];
        if (g !== gt) {
          g += (gt - g) * 0.0015;
          this.loopGain[s] = g;
        }
        let v = lp * g;

        // --- 分散オールパス（弦の張りによる倍音のずれ）---
        const c = this.apC[s];
        if (c !== 0) {
          for (let k = 0; k < AP_STAGES; k++) {
            const idx = s * AP_STAGES + k;
            const x = v;
            const y = c * x + this.apX[idx] - c * this.apY[idx];
            this.apX[idx] = x;
            this.apY[idx] = y;
            v = y;
          }
        }

        // --- 励振（ピックのアタックノイズ・ビビり）---
        // 出力段の微分ぶんを打ち消してから入れる（exScale）
        if (this.nsIdx[s] < this.nsLen[s]) {
          const t = this.nsIdx[s] / this.nsLen[s];
          const shape = (1 - t) * (1 - t);
          this.nsLp[s] += (Math.random() * 2 - 1 - this.nsLp[s]) * 0.55;
          let ex = this.nsLp[s] * this.nsAmp[s] * shape;
          if (this.nsRattle[s] > 0 && Math.random() < 0.25) {
            ex += (Math.random() * 2 - 1) * this.nsRattle[s] * shape * 0.4;
          }
          v += ex * this.exScale[s];
          this.nsIdx[s]++;
        }

        // --- 他の弦からの共鳴（出力レベルの信号なので弦の単位に戻す）---
        v += bridgeFeed * this.coupScale[s];

        buf[base + w] = v;
        this.wIdx[s] = (w + 1) & DELAY_MASK;

        // --- 出力（変位を微分して速度に）---
        const dif = raw - this.prevRaw[s];
        this.prevRaw[s] = raw;
        const y = dif * this.outScale[s];

        const av = y < 0 ? -y : y;
        if (av > this.level[s]) this.level[s] = av;

        bridgeSum += y;
        mixL += y * this.gainL[s];
        mixR += y * this.gainR[s];
      }

      // ブリッジは低域寄りの伝達特性を持つ（駒と表板のフィルタ）
      this.bridgeZ += (bridgeSum - this.bridgeZ) * 0.22;
      this.bridgeZ2 += (this.bridgeZ - this.bridgeZ2) * 0.5;
      bridgeFeed = (this.bridgeZ - this.bridgeZ2) * coupling;

      // --- 指のこすれ音 ---
      if (this.squeak > 1e-5) {
        this.squeakLp += (Math.random() * 2 - 1 - this.squeakLp) * 0.6;
        this.squeakBp += (this.squeakLp - this.squeakBp) * 0.08;
        const sq = (this.squeakLp - this.squeakBp) * this.squeak;
        mixL += sq;
        mixR += sq * 0.85;
        this.squeak *= this.squeakDecay;
        if (this.squeak < 1e-5) this.squeak = 0;
      }

      left[i] += mixL;
      if (right !== left) right[i] += mixR;
    }

    // --- レベル更新とボイス解放 ---
    let sounding = 0;
    const decay = Math.exp(-n / (0.05 * sampleRate));
    for (let s = 0; s < count; s++) {
      if (!this.active[s]) continue;
      this.level[s] *= decay;
      if (this.level[s] < 1.5e-5) this.killString(s);
      else sounding++;
    }

    const g = this.masterGain;
    if (g !== 1) {
      for (let i = 0; i < n; i++) {
        left[i] *= g;
        if (right !== left) right[i] *= g;
      }
    }

    this.frame += n;
    if (++this.blockCount % 6 === 0) {
      for (let s = 0; s < MAX_STRINGS; s++) {
        this.levelsMsg[s] = this.active[s] ? this.level[s] : 0;
        this.freqMsg[s] = this.active[s] ? this.freq[s] : 0;
      }
      this.port.postMessage({
        type: 'status',
        sounding,
        levels: this.levelsMsg,
        freqs: this.freqMsg,
      });
    }
    return true;
  }
}

registerProcessor('guitar-processor', GuitarProcessor);
