/*
 * Hibiki Drum Machine — 音源とシーケンサー本体（AudioWorklet）
 *
 * 録音サンプルを一切使わず、すべての打楽器をその場で合成する。
 * シーケンサーもこの中で走らせているため、タイミングはサンプル単位で正確で、
 * OfflineAudioContext でそのまま書き出すと画面で聴いた演奏と完全に一致する。
 *
 * 出力は3系統：
 *   outputs[0] … ドライ（ステレオ）
 *   outputs[1] … リバーブ送り（ステレオ）
 *   outputs[2] … ディレイ送り（ステレオ）
 */

const TAU = Math.PI * 2;

/** 疑似乱数（書き出しを再現可能にするためシード付き） */
function makeRng(seed) {
  let s = seed >>> 0 || 0x2f6e2b1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** 減衰係数（time 秒で -60dB 付近まで落ちる指数減衰） */
function coefFor(time, sr) {
  return Math.exp(-1 / Math.max(1, sr * Math.max(0.0005, time)));
}

/** TPT 型ステートバリアブルフィルター（lp / bp / hp を同時に得る） */
class Svf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 1;
    this.lp = 0;
    this.bp = 0;
    this.hp = 0;
  }

  set(freq, q, sr) {
    const g = Math.tan((Math.PI * Math.min(Math.max(freq, 10), sr * 0.48)) / sr);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
    return v2;
  }

  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
  }
}

// --------------------------------------------------------------- ボイス基底

class VoiceBase {
  constructor(sr, rng) {
    this.sr = sr;
    this.rng = rng;
    this.active = false;
    this.ck = 1;
    this.choking = false;
    this.ckCoef = coefFor(0.006, sr);
    this.age = 0;
  }

  noise() {
    return this.rng() * 2 - 1;
  }

  /** 同じチョークグループの音に消される（ハイハットのクローズ→オープンなど） */
  choke() {
    this.choking = true;
  }

  begin() {
    this.active = true;
    this.choking = false;
    this.ck = 1;
    this.age = 0;
  }

  /** チョーク中のゲイン。各 render() の最後に掛ける */
  gate() {
    this.age++;
    if (!this.choking) return 1;
    this.ck *= this.ckCoef;
    if (this.ck < 1e-4) this.active = false;
    return this.ck;
  }
}

// ------------------------------------------------------------------ キック

class KickVoice extends VoiceBase {
  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    this.f0 = 47 * Math.pow(2, p.tune / 12);
    // 強く叩くほどアタックのピッチが高い＝抜けが良くなる
    this.fStart = this.f0 * (3.2 + p.tone * 8) * (0.72 + 0.42 * vel);
    this.pitchCoef = coefFor(0.011 + (1 - p.tone) * 0.05, sr);
    this.pitchEnv = 1;
    this.ampCoef = coefFor(0.075 + 0.42 * p.decay, sr);
    this.amp = 1;
    this.clickCoef = coefFor(0.0025 + p.tone * 0.004, sr);
    this.click = p.snap * (0.35 + 0.4 * vel);
    this.phase = 0;
    this.drive = 0.8 + p.drive * 7;
    this.norm = 1 / Math.tanh(this.drive);
    this.hp = this.hp || new Svf();
    this.hp.set(26, 0.7, sr);
  }

  render() {
    const f = this.f0 + (this.fStart - this.f0) * this.pitchEnv;
    this.pitchEnv *= this.pitchCoef;
    this.phase += f / this.sr;
    if (this.phase >= 1) this.phase -= 1;

    let s = Math.sin(this.phase * TAU) * this.amp;
    s = Math.tanh(s * this.drive) * this.norm;
    s += this.noise() * this.click * 0.55;
    this.click *= this.clickCoef;
    this.amp *= this.ampCoef;
    if (this.amp < 2e-4 && this.click < 2e-4) this.active = false;

    this.hp.process(s);
    return this.hp.hp * this.vel * this.gate();
  }
}

// ----------------------------------------------------------------- スネア

class SnareVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
    this.hp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    const base = 178 * Math.pow(2, p.tune / 12);
    this.f1 = base;
    this.f2 = base * 1.588;
    this.ph1 = 0;
    this.ph2 = 0;
    this.bodyEnv = 1;
    this.bodyCoef = coefFor(0.035 + 0.13 * p.decay, sr);
    this.noiseEnv = 1;
    this.noiseCoef = coefFor(0.04 + 0.24 * p.decay * (0.55 + p.tone * 0.9), sr);
    this.snap = 0.25 + p.snap * 0.95;
    this.body = 1.15 - p.snap * 0.55;
    this.bp.set(1300 * Math.pow(2, p.tone * 2.1), 0.8, sr);
    this.bp.reset();
    this.hp.set(240, 0.7, sr);
    this.drive = 0.6 + p.drive * 4;
    this.norm = 1 / Math.tanh(this.drive);
  }

  render() {
    this.ph1 += this.f1 / this.sr;
    this.ph2 += this.f2 / this.sr;
    if (this.ph1 >= 1) this.ph1 -= 1;
    if (this.ph2 >= 1) this.ph2 -= 1;

    const body =
      (Math.sin(this.ph1 * TAU) * 0.7 + Math.sin(this.ph2 * TAU) * 0.45) * this.bodyEnv * this.body;
    this.bp.process(this.noise());
    const rattle = this.bp.bp * this.noiseEnv * this.snap * 1.5;

    this.bodyEnv *= this.bodyCoef;
    this.noiseEnv *= this.noiseCoef;
    if (this.bodyEnv < 2e-4 && this.noiseEnv < 2e-4) this.active = false;

    let s = Math.tanh((body + rattle) * this.drive) * this.norm;
    this.hp.process(s);
    return this.hp.hp * this.vel * 0.9 * this.gate();
  }
}

// ------------------------------------------------------------------ クラップ

class ClapVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
    this.hp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    this.bp.set(760 * Math.pow(2, p.tone * 2.2 + p.tune / 12), 1.5, sr);
    this.bp.reset();
    this.hp.set(420, 0.7, sr);
    // 4回の短いバーストで「複数の手が少しずれて鳴る」音を作る
    this.bursts = 3 + Math.round(p.snap * 2);
    this.spacing = Math.max(1, Math.round(sr * (0.0068 + (1 - p.snap) * 0.005)));
    this.count = this.spacing;
    this.env = 1;
    this.burstCoef = coefFor(0.0042, sr);
    this.tailCoef = coefFor(0.045 + 0.16 * p.decay, sr);
    this.spread = 0.45 + p.snap * 0.4;
  }

  render() {
    let s = 0;
    this.bp.process(this.noise());
    s = this.bp.bp * this.env * 1.8;

    if (this.bursts > 0) {
      this.env *= this.burstCoef;
      if (--this.count <= 0) {
        this.bursts--;
        this.count = this.spacing;
        this.env = this.bursts > 0 ? this.spread : 1;
      }
    } else {
      this.env *= this.tailCoef;
      if (this.env < 2e-4) this.active = false;
    }

    this.hp.process(s);
    return this.hp.hp * this.vel * this.gate();
  }
}

// ------------------------------------------------------------------ リム

class RimVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    const t = Math.pow(2, p.tune / 12);
    this.f1 = 1720 * t;
    this.f2 = 468 * t;
    this.ph1 = 0;
    this.ph2 = 0.25;
    this.env = 1;
    this.envCoef = coefFor(0.006 + 0.03 * p.decay, sr);
    this.noiseEnv = p.snap;
    this.noiseCoef = coefFor(0.0025, sr);
    this.bp.set(2400 * Math.pow(2, p.tone * 1.2), 1.1, sr);
    this.bp.reset();
  }

  render() {
    this.ph1 += this.f1 / this.sr;
    this.ph2 += this.f2 / this.sr;
    if (this.ph1 >= 1) this.ph1 -= 1;
    if (this.ph2 >= 1) this.ph2 -= 1;

    let s = (Math.sin(this.ph1 * TAU) * 0.8 + Math.sin(this.ph2 * TAU) * 0.6) * this.env;
    s += this.noise() * this.noiseEnv * 0.8;
    this.noiseEnv *= this.noiseCoef;
    this.env *= this.envCoef;
    if (this.env < 3e-4) this.active = false;

    this.bp.process(s);
    return (this.bp.bp * 0.9 + s * 0.35) * this.vel * this.gate();
  }
}

// ------------------------------------------------------- 金物（ハット/シンバル）

/** 6基の矩形波を非整数比で重ねる、アナログドラムマシン方式の金属音 */
const METAL_RATIOS = [1, 1.4832, 1.8009, 2.5468, 2.6316, 3.8974];
const METAL_BASE = 205.3;

class MetalVoice extends VoiceBase {
  constructor(sr, rng, variant) {
    super(sr, rng);
    this.variant = variant;
    this.hp = new Svf();
    this.bp = new Svf();
    this.ping = new Svf();
    this.phases = new Float64Array(6);
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    const t = Math.pow(2, p.tune / 12);
    this.freqs = METAL_RATIOS.map((r) => METAL_BASE * r * t);
    for (let i = 0; i < 6; i++) this.phases[i] = this.rng();

    const v = this.variant;
    let decay;
    if (v === 'closed') decay = 0.016 + 0.07 * p.decay;
    else if (v === 'open') decay = 0.06 + 0.34 * p.decay;
    else if (v === 'ride') decay = 0.25 + 0.9 * p.decay;
    else decay = 0.4 + 1.6 * p.decay; // crash

    this.env = 1;
    this.envCoef = coefFor(decay, sr);
    // シンバルは立ち上がりに一瞬の伸びがある
    this.attack = v === 'crash' ? 0 : 1;
    this.attackCoef = coefFor(0.004 + (v === 'crash' ? 0.012 : 0), sr);
    this.noiseAmt = (v === 'crash' ? 0.85 : v === 'ride' ? 0.3 : 0.18) * (0.5 + p.snap);
    this.hp.set(3200 + p.tone * 6500, 0.7, sr);
    this.bp.set(7200 + p.tone * 5000, 0.9, sr);
    this.hp.reset();
    this.bp.reset();
    this.pingEnv = v === 'ride' ? 1 : 0;
    this.pingCoef = coefFor(0.05 + 0.12 * p.decay, sr);
    this.ping.set(3350 * t, 6, sr);
    this.ping.reset();
  }

  render() {
    let metal = 0;
    for (let i = 0; i < 6; i++) {
      let ph = this.phases[i] + this.freqs[i] / this.sr;
      if (ph >= 1) ph -= 1;
      this.phases[i] = ph;
      metal += ph < 0.5 ? 1 : -1;
    }
    metal /= 6;

    let s = metal + this.noise() * this.noiseAmt;
    this.hp.process(s);
    this.bp.process(this.hp.hp);
    let out = this.hp.hp * 0.6 + this.bp.bp * 0.7;

    if (this.pingEnv > 0) {
      this.ping.process(metal);
      out += this.ping.bp * this.pingEnv * 0.9;
      this.pingEnv *= this.pingCoef;
    }

    this.attack += (1 - this.attack) * (1 - this.attackCoef);
    this.env *= this.envCoef;
    if (this.env < 2e-4) this.active = false;

    return out * this.env * this.attack * this.vel * 1.35 * this.gate();
  }
}

// ------------------------------------------------------------------- タム

class TomVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    this.f0 = 110 * Math.pow(2, p.tune / 12);
    this.fStart = this.f0 * (1.35 + p.tone * 0.9);
    this.pitchEnv = 1;
    this.pitchCoef = coefFor(0.03 + 0.05 * p.decay, sr);
    this.phase = 0;
    this.env = 1;
    this.envCoef = coefFor(0.08 + 0.34 * p.decay, sr);
    this.noiseEnv = p.snap * 0.9;
    this.noiseCoef = coefFor(0.012 + 0.03 * p.decay, sr);
    this.bp.set(this.f0 * 5.5, 0.9, sr);
    this.bp.reset();
    this.drive = 0.6 + p.drive * 4;
    this.norm = 1 / Math.tanh(this.drive);
  }

  render() {
    const f = this.f0 + (this.fStart - this.f0) * this.pitchEnv;
    this.pitchEnv *= this.pitchCoef;
    this.phase += f / this.sr;
    if (this.phase >= 1) this.phase -= 1;

    let s = Math.sin(this.phase * TAU) * this.env;
    this.bp.process(this.noise());
    s += this.bp.bp * this.noiseEnv * 0.8;
    this.noiseEnv *= this.noiseCoef;
    this.env *= this.envCoef;
    if (this.env < 2e-4) this.active = false;

    return Math.tanh(s * this.drive) * this.norm * this.vel * this.gate();
  }
}

// ---------------------------------------------------------------- カウベル

class CowbellVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    const t = Math.pow(2, p.tune / 12);
    this.f1 = 540 * t;
    this.f2 = 800 * t;
    this.ph1 = 0;
    this.ph2 = 0;
    this.env = 1;
    this.envCoef = coefFor(0.04 + 0.2 * p.decay, sr);
    this.attack = 0.35;
    this.attackCoef = coefFor(0.002, sr);
    this.bp.set(2200 + p.tone * 2600, 1.4, sr);
    this.bp.reset();
  }

  render() {
    this.ph1 += this.f1 / this.sr;
    this.ph2 += this.f2 / this.sr;
    if (this.ph1 >= 1) this.ph1 -= 1;
    if (this.ph2 >= 1) this.ph2 -= 1;
    const sq = (this.ph1 < 0.5 ? 1 : -1) * 0.55 + (this.ph2 < 0.5 ? 1 : -1) * 0.45;

    this.bp.process(sq);
    const s = (this.bp.bp * 1.1 + sq * 0.25) * this.env;
    this.env *= this.envCoef;
    this.attack += (1 - this.attack) * (1 - this.attackCoef);
    if (this.env < 2e-4) this.active = false;
    return s * this.attack * this.vel * 0.7 * this.gate();
  }
}

// ---------------------------------------------------------------- シェイカー

class ShakerVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
    this.hp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    this.bp.set(4200 * Math.pow(2, p.tone * 1.4 + p.tune / 12), 1.1, sr);
    this.hp.set(2600, 0.7, sr);
    this.bp.reset();
    // 立ち上がりに少し時間をかけると「振る」感じになる
    this.attackLen = Math.max(1, Math.round(sr * (0.0008 + (1 - p.snap) * 0.005)));
    this.pos = 0;
    this.env = 0;
    this.envCoef = coefFor(0.016 + 0.1 * p.decay, sr);
  }

  render() {
    if (this.pos < this.attackLen) {
      this.pos++;
      this.env = this.pos / this.attackLen;
    } else {
      this.env *= this.envCoef;
      if (this.env < 2e-4) this.active = false;
    }

    this.bp.process(this.noise());
    this.hp.process(this.bp.bp);
    return this.hp.hp * this.env * this.vel * 1.2 * this.gate();
  }
}

// -------------------------------------------------------------- パーカッション

class PercVoice extends VoiceBase {
  constructor(sr, rng) {
    super(sr, rng);
    this.bp = new Svf();
  }

  trigger(p, vel) {
    const sr = this.sr;
    this.begin();
    this.vel = vel;
    this.f0 = 220 * Math.pow(2, p.tune / 12);
    this.fStart = this.f0 * (1.15 + p.tone * 0.5);
    this.pitchEnv = 1;
    this.pitchCoef = coefFor(0.012, sr);
    this.phase = 0;
    this.env = 1;
    this.envCoef = coefFor(0.05 + 0.22 * p.decay, sr);
    this.slapEnv = p.snap;
    this.slapCoef = coefFor(0.004, sr);
    this.bp.set(this.f0 * 3.2, 1.6, sr);
    this.bp.reset();
  }

  render() {
    const f = this.f0 + (this.fStart - this.f0) * this.pitchEnv;
    this.pitchEnv *= this.pitchCoef;
    this.phase += f / this.sr;
    if (this.phase >= 1) this.phase -= 1;

    let s = Math.sin(this.phase * TAU) * this.env;
    s += Math.sin(this.phase * TAU * 2.4) * this.env * 0.18;
    this.bp.process(this.noise());
    s += this.bp.bp * this.slapEnv * 0.9;
    this.slapEnv *= this.slapCoef;
    this.env *= this.envCoef;
    if (this.env < 2e-4) this.active = false;
    return s * this.vel * this.gate();
  }
}

function makeVoice(type, variant, sr, rng) {
  switch (type) {
    case 'kick': return new KickVoice(sr, rng);
    case 'snare': return new SnareVoice(sr, rng);
    case 'clap': return new ClapVoice(sr, rng);
    case 'rim': return new RimVoice(sr, rng);
    case 'hat': return new MetalVoice(sr, rng, variant === 'open' ? 'open' : 'closed');
    case 'cymbal': return new MetalVoice(sr, rng, variant === 'ride' ? 'ride' : 'crash');
    case 'tom': return new TomVoice(sr, rng);
    case 'cowbell': return new CowbellVoice(sr, rng);
    case 'shaker': return new ShakerVoice(sr, rng);
    default: return new PercVoice(sr, rng);
  }
}

/** 方式ごとの同時発音数（金物は余韻が長いので多め） */
function poolSize(type, variant) {
  if (type === 'cymbal') return 4;
  if (type === 'hat') return variant === 'open' ? 3 : 2;
  if (type === 'kick') return 2;
  return 3;
}

// -------------------------------------------------------------- プロセッサー

class DrumProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.rng = makeRng(opts.seed || 12345);
    this.tracks = [];
    this.patterns = [];
    this.song = [];
    this.songMode = false;
    this.bpm = 120;
    this.swing = 50;
    this.humanize = 0;
    this.stepsPerBeat = 4;
    this.current = 0;
    this.soloTrack = opts.soloTrack || null;
    this.playing = false;
    this.frame = 0;
    this.pending = [];
    this.meterFrames = 0;
    this.meters = [];
    this.lastPostedStep = -1;

    if (opts.state) this.setState(opts.state);
    this.port.onmessage = (e) => this.onMessage(e.data);

    if (opts.autoStart) this.start(opts.startStep || 0);
  }

  // ------------------------------------------------------------ 状態の更新

  setState(state) {
    if (state.bpm) this.bpm = state.bpm;
    if (typeof state.swing === 'number') this.swing = state.swing;
    if (typeof state.humanize === 'number') this.humanize = state.humanize;
    if (typeof state.stepsPerBeat === 'number') this.stepsPerBeat = state.stepsPerBeat;
    if (typeof state.current === 'number') this.current = state.current;
    if (typeof state.songMode === 'boolean') this.songMode = state.songMode;
    if (state.song) this.song = state.song;
    if (state.patterns) this.patterns = state.patterns;
    if (state.tracks) this.setTracks(state.tracks);
  }

  setTracks(configs) {
    const kept = new Map(this.tracks.map((t) => [t.id, t]));
    this.tracks = configs.map((cfg) => {
      const prev = kept.get(cfg.id);
      const reuse = prev && prev.type === cfg.type && prev.variant === cfg.variant;
      const voices = reuse
        ? prev.voices
        : Array.from({ length: poolSize(cfg.type, cfg.variant) }, () =>
            makeVoice(cfg.type, cfg.variant, sampleRate, this.rng)
          );
      return {
        id: cfg.id,
        type: cfg.type,
        variant: cfg.variant,
        choke: cfg.choke || 0,
        params: cfg.params,
        mute: !!cfg.mute,
        solo: !!cfg.solo,
        voices,
        peak: 0,
      };
    });
    this.anySolo = this.tracks.some((t) => t.solo);
    this.meters = new Array(this.tracks.length).fill(0);
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.setState(msg.state);
        break;
      case 'tracks':
        this.setTracks(msg.tracks);
        break;
      case 'patterns':
        this.patterns = msg.patterns;
        break;
      case 'pattern':
        // 編集中の1パターンだけを差し替える（打ち込みのたびに全体を送らないため）
        this.patterns[msg.index] = msg.pattern;
        break;
      case 'transportParams':
        if (typeof msg.bpm === 'number') this.bpm = msg.bpm;
        if (typeof msg.swing === 'number') this.swing = msg.swing;
        if (typeof msg.humanize === 'number') this.humanize = msg.humanize;
        if (typeof msg.stepsPerBeat === 'number') this.stepsPerBeat = msg.stepsPerBeat;
        if (typeof msg.current === 'number') this.current = msg.current;
        if (typeof msg.songMode === 'boolean') this.songMode = msg.songMode;
        if (msg.song) this.song = msg.song;
        break;
      case 'transport':
        if (msg.playing) this.start(msg.startStep || 0);
        else this.stop(msg.silence !== false);
        break;
      case 'hit':
        this.triggerTrack(this.indexOf(msg.track), msg.vel, true);
        break;
      case 'panic':
        this.allOff();
        break;
      default:
        break;
    }
  }

  indexOf(id) {
    for (let i = 0; i < this.tracks.length; i++) if (this.tracks[i].id === id) return i;
    return -1;
  }

  // -------------------------------------------------------------- 再生制御

  get stepFrames() {
    return (sampleRate * 60) / Math.max(20, this.bpm) / Math.max(1, this.stepsPerBeat);
  }

  /** スウィングを含めた1ステップの長さ（偶数ステップを長く、奇数ステップを短く） */
  stepDuration(stepIndex) {
    const base = this.stepFrames;
    if (this.stepsPerBeat % 2 !== 0) return base;
    const sw = Math.min(0.75, Math.max(0.5, this.swing / 100));
    return stepIndex % 2 === 0 ? base * 2 * sw : base * 2 * (1 - sw);
  }

  start(startStep) {
    this.pending.length = 0;
    this.playing = true;
    this.frame = 0;
    const pattern = this.songMode && this.song.length ? this.song[0].pattern : this.current;
    this.cur = {
      pattern: Math.min(pattern, Math.max(0, this.patterns.length - 1)),
      step: startStep,
      slot: 0,
      repeat: 0,
      abs: startStep,
    };
    this.curFrame = 0;
    this.scheduleStep(this.cur, 0, 0);
    this.postStep(this.cur);
    this.prepareNext();
  }

  stop(silence) {
    this.playing = false;
    this.pending.length = 0;
    if (silence) this.allOff();
    this.lastPostedStep = -1;
    this.port.postMessage({ type: 'step', step: -1, pattern: this.cur ? this.cur.pattern : 0 });
  }

  allOff() {
    for (const t of this.tracks) for (const v of t.voices) { v.active = false; v.choking = false; }
  }

  prepareNext() {
    this.nextFrame = this.curFrame + this.stepDuration(this.cur.step);
    this.next = this.advance(this.cur);
    this.scheduleStep(this.next, this.nextFrame, this.curFrame);
  }

  /** 次のステップ位置（パターン長・ソングモードを考慮） */
  advance(pos) {
    const p = this.patterns[pos.pattern];
    const len = p ? Math.max(1, p.length) : 16;
    const next = { pattern: pos.pattern, step: pos.step + 1, slot: pos.slot, repeat: pos.repeat, abs: pos.abs + 1 };
    if (next.step >= len) {
      next.step = 0;
      if (!this.songMode) {
        // パターン切り替えは小節の切れ目で反映する（ポリメーターの周期は保つ）
        if (this.current !== next.pattern) {
          next.pattern = this.current;
          next.abs = 0;
        }
      } else if (this.song.length > 0) {
        next.repeat++;
        const slot = this.song[next.slot] || this.song[0];
        if (next.repeat >= Math.max(1, slot.repeats)) {
          next.repeat = 0;
          next.slot = (next.slot + 1) % this.song.length;
        }
        next.pattern = this.song[next.slot].pattern;
        next.abs = 0;
      }
    }
    return next;
  }

  /**
   * 指定ステップの発音を予約する。
   * ステップごとのずらし量が負でも間に合うよう、1ステップ先を予約している。
   */
  scheduleStep(pos, atFrame, minFrame) {
    const pattern = this.patterns[pos.pattern];
    if (!pattern) return;
    const stepFrames = this.stepFrames;
    const dur = this.stepDuration(pos.step);

    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      const tp = pattern.tracks[track.id];
      if (!tp) continue;
      const own = tp.length | 0;
      const index = own > 0 ? pos.abs % own : pos.step;
      const step = tp.steps[index];
      if (!step) continue;
      if (step.p < 1 && this.rng() > step.p) continue;

      const rolls = Math.max(1, Math.min(8, step.r | 0 || 1));
      const shift = (step.s || 0) * stepFrames;
      const jitter = this.humanize > 0 ? (this.rng() - 0.5) * this.humanize * stepFrames * 0.22 : 0;
      for (let r = 0; r < rolls; r++) {
        const at = Math.max(minFrame, Math.round(atFrame + shift + jitter + (dur * r) / rolls));
        let vel = step.v;
        if (rolls > 1) vel *= 1 - (r / rolls) * 0.35;
        if (this.humanize > 0) vel *= 1 - this.rng() * this.humanize * 0.28;
        this.queue(at, i, Math.max(0.02, Math.min(1, vel)));
      }
    }
  }

  queue(frame, trackIndex, vel) {
    const ev = { frame, track: trackIndex, vel };
    const list = this.pending;
    let i = list.length;
    while (i > 0 && list[i - 1].frame > frame) i--;
    list.splice(i, 0, ev);
  }

  triggerTrack(index, vel, live) {
    const track = this.tracks[index];
    if (!track) return;
    if (this.soloTrack !== null && this.soloTrack !== undefined) {
      if (track.id !== this.soloTrack) return;
    } else {
      if (track.mute) return;
      if (this.anySolo && !track.solo) return;
    }

    if (track.choke) {
      for (const other of this.tracks) {
        if (other.choke === track.choke && other !== track) {
          for (const v of other.voices) if (v.active) v.choke();
        }
      }
      // 同じトラックの連打も、余韻の長い音は前の音を止める
      if (track.type === 'hat' || track.type === 'cymbal') {
        for (const v of track.voices) if (v.active) v.choke();
      }
    }

    let voice = null;
    for (const v of track.voices) {
      if (!v.active) { voice = v; break; }
    }
    if (!voice) {
      voice = track.voices[0];
      for (const v of track.voices) if (v.age > voice.age) voice = v;
    }
    voice.trigger(track.params, vel);
    if (live) track.peak = Math.max(track.peak, vel);
  }

  postStep(pos) {
    if (pos.step === this.lastPostedStep && pos.pattern === this.lastPostedPattern) return;
    this.lastPostedStep = pos.step;
    this.lastPostedPattern = pos.pattern;
    this.port.postMessage({
      type: 'step',
      step: pos.step,
      abs: pos.abs,
      pattern: pos.pattern,
      slot: pos.slot,
      at: currentTime,
    });
  }

  // ------------------------------------------------------------------ 生成

  process(_inputs, outputs) {
    const dry = outputs[0];
    const rev = outputs[1];
    const dly = outputs[2];
    const dryL = dry[0];
    const dryR = dry[1];
    const revL = rev && rev[0];
    const revR = rev && rev[1];
    const dlyL = dly && dly[0];
    const dlyR = dly && dly[1];
    const frames = dryL.length;

    for (let i = 0; i < frames; i++) {
      if (this.playing) {
        while (this.frame >= this.nextFrame) {
          this.cur = this.next;
          this.curFrame = this.nextFrame;
          this.prepareNext();
          this.postStep(this.cur);
        }
        while (this.pending.length > 0 && this.pending[0].frame <= this.frame) {
          const ev = this.pending.shift();
          this.triggerTrack(ev.track, ev.vel, false);
        }
      }

      let l = 0;
      let r = 0;
      let rl = 0;
      let rr = 0;
      let dl = 0;
      let dr = 0;

      for (let t = 0; t < this.tracks.length; t++) {
        const track = this.tracks[t];
        let sum = 0;
        const voices = track.voices;
        for (let v = 0; v < voices.length; v++) {
          if (voices[v].active) sum += voices[v].render();
        }
        if (sum === 0) continue;

        const p = track.params;
        sum *= p.level;
        const abs = sum < 0 ? -sum : sum;
        if (abs > track.peak) track.peak = abs;

        // 等パワーパン
        const pan = (p.pan + 1) * 0.5;
        const gl = Math.cos(pan * Math.PI * 0.5);
        const gr = Math.sin(pan * Math.PI * 0.5);
        const sl = sum * gl;
        const sr = sum * gr;
        l += sl;
        r += sr;
        if (p.reverb > 0) { rl += sl * p.reverb; rr += sr * p.reverb; }
        if (p.delay > 0) { dl += sl * p.delay; dr += sr * p.delay; }
      }

      dryL[i] = l;
      dryR[i] = r;
      if (revL) { revL[i] = rl; revR[i] = rr; }
      if (dlyL) { dlyL[i] = dl; dlyR[i] = dr; }

      if (this.playing) this.frame++;
    }

    // メーター（およそ 20ms ごと）
    this.meterFrames += frames;
    if (this.meterFrames >= 1024) {
      this.meterFrames = 0;
      const peaks = new Array(this.tracks.length);
      for (let t = 0; t < this.tracks.length; t++) {
        peaks[t] = this.tracks[t].peak;
        this.tracks[t].peak = 0;
      }
      this.port.postMessage({ type: 'meters', peaks });
    }

    return true;
  }
}

registerProcessor('drum-processor', DrumProcessor);
