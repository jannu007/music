/*
 * 再生の中身。
 *
 * サンプラーは AudioWorklet を使わず、AudioBufferSourceNode をそのまま使う。
 * 波形をなぞって再生速度で音程を変えるという処理は、ブラウザの中で
 * 最適化されて動いていて、自分で書くより速く、音も良い。
 * （合成が中心のほかの5本とは、そこが違う）
 *
 * 1音ぶんの流れ
 *
 *   BufferSource → ゲイン（エンベロープ） → フィルター → パン ─┐
 *                                                              ├→ 楽器の出口
 *   LFO → 音程・遮断周波数・音量                                ┘
 *
 * 楽器の出口から先は、6アプリ共通のエフェクト（shared/audio/fx.ts）へつながる。
 */

import {
  BitCrusher,
  Chorus,
  Distortion,
  Flanger,
  ModShaper,
  Phaser,
  RingMod,
  StereoDelay,
  StereoWidth,
  SweepFilter,
} from '../../../shared/audio/fx';
import { createImpulseResponse } from './reverb';
import type { Instrument, Zone } from './types';
import { midiToFreq } from './types';

/** 鳴っている1音 */
interface Voice {
  note: number;
  /** 同時に押された同じ音を見分ける */
  id: number;
  zone: Zone;
  source: AudioBufferSourceNode;
  amp: GainNode;
  filter: BiquadFilterNode | null;
  pan: StereoPannerNode;
  lfo: OscillatorNode | null;
  lfoGains: GainNode[];
  /** 鳴らし始めた時刻 */
  started: number;
  /** 離した時刻。まだ押されていれば null */
  released: number | null;
  releaseSeconds: number;
}

export interface EngineSample {
  buffer: AudioBuffer;
  /** 逆再生ぶん。使うときに作る */
  reversed?: AudioBuffer;
}

const MIN_GAIN = 0.0001;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** 押した強さから音量を出す。0 のとき無音にならないよう下限を持たせる */
function velocityGain(velocity: number, amount: number): number {
  const norm = Math.max(1, Math.min(127, velocity)) / 127;
  // 耳に自然になるよう、まっすぐではなく少し曲げる
  const curved = norm * norm * 0.7 + norm * 0.3;
  return 1 - amount + amount * curved;
}

export class SamplerEngine {
  readonly ctx: BaseAudioContext;
  /** 楽器の入口。ここに1音ずつつなぐ */
  private readonly voiceBus: GainNode;
  private readonly master: GainNode;
  readonly output: GainNode;

  private readonly dist: Distortion;
  private readonly crush: BitCrusher;
  private readonly sweep: SweepFilter;
  private readonly chorus: Chorus;
  private readonly flanger: Flanger;
  private readonly phaser: Phaser;
  private readonly ring: RingMod;
  private readonly mod: ModShaper;
  private readonly width: StereoWidth;
  private readonly delay: StereoDelay;

  private readonly reverbSend: GainNode;
  private readonly reverbReturn: GainNode;
  private convolver: ConvolverNode | null = null;
  private reverbLoaded: Instrument['fx']['reverbType'] = 'off';

  private readonly voices: Voice[] = [];
  private buffers = new Map<string, EngineSample>();
  private instrument: Instrument;
  private voiceSeq = 0;
  /** ラウンドロビンの現在位置。組ごとに覚えておく */
  private roundRobin = new Map<number, number>();
  /** 単音のとき、いま鳴っている音程（グライドの起点） */
  private lastNote: number | null = null;

  constructor(ctx: BaseAudioContext, instrument: Instrument) {
    this.ctx = ctx;
    this.instrument = instrument;

    this.voiceBus = ctx.createGain();
    this.master = ctx.createGain();
    this.output = ctx.createGain();

    this.dist = new Distortion(ctx);
    this.crush = new BitCrusher(ctx);
    this.sweep = new SweepFilter(ctx);
    this.chorus = new Chorus(ctx);
    this.flanger = new Flanger(ctx);
    this.phaser = new Phaser(ctx);
    this.ring = new RingMod(ctx);
    this.mod = new ModShaper(ctx);
    this.width = new StereoWidth(ctx);
    this.delay = new StereoDelay(ctx);

    // つなぎ順は、実機のペダルボードと同じ並びにしてある
    this.voiceBus
      .connect(this.dist.input);
    this.dist.output.connect(this.crush.input);
    this.crush.output.connect(this.sweep.input);
    this.sweep.output.connect(this.chorus.input);
    this.chorus.output.connect(this.flanger.input);
    this.flanger.output.connect(this.phaser.input);
    this.phaser.output.connect(this.ring.input);
    this.ring.output.connect(this.mod.input);
    this.mod.output.connect(this.width.input);
    this.width.output.connect(this.delay.input);
    this.delay.output.connect(this.master);

    // リバーブは並列。送り量で深さを決める
    this.reverbSend = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.delay.output.connect(this.reverbSend);
    this.reverbReturn.connect(this.master);

    this.master.connect(this.output);
    this.apply(instrument);
  }

  /** 素材を渡す。ゾーンが参照する id と対応していること */
  setBuffers(buffers: Map<string, EngineSample>) {
    this.buffers = buffers;
  }

  get settings(): Instrument {
    return this.instrument;
  }

  /** 設定を反映する。鳴っている音は次の発音から新しい設定になる */
  apply(instrument: Instrument) {
    this.instrument = instrument;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(dbToGain(instrument.gainDb), now, 0.02);

    const fx = instrument.fx;
    this.dist.update(fx.distType, fx.distAmount, fx.distTone, fx.distMix);
    this.crush.update(fx.crushBits, fx.crushMix);
    this.sweep.update(fx.filterMode, fx.filterFreq, fx.filterQ, fx.filterRate, fx.filterDepth);
    this.chorus.update(fx.chorusOn, fx.chorusRate, fx.chorusDepth, fx.chorusMix);
    this.flanger.update(fx.flangerOn, fx.flangerRate, fx.flangerDepth, fx.flangerFeedback, fx.flangerMix);
    this.phaser.update(fx.phaserOn, fx.phaserRate, fx.phaserDepth, fx.phaserFeedback, fx.phaserMix);
    this.ring.update(fx.ringOn, fx.ringFreq, fx.ringMix);
    this.mod.update(fx.modMode, fx.modRate, fx.modDepth);
    this.width.update(fx.width);
    this.delay.update(fx.delayTime, fx.delayFeedback, fx.delayMix, fx.delayPingPong);
    this.updateReverb(fx.reverbType, fx.reverbMix);
  }

  private updateReverb(type: Instrument['fx']['reverbType'], mix: number) {
    const now = this.ctx.currentTime;
    if (type === 'off' || mix <= 0) {
      this.reverbSend.gain.setTargetAtTime(0, now, 0.05);
      return;
    }
    if (type !== this.reverbLoaded) {
      // 響きの種類が変わったときだけ作り直す（毎回作ると重い）
      this.convolver?.disconnect();
      const conv = this.ctx.createConvolver();
      conv.buffer = createImpulseResponse(this.ctx, type);
      this.reverbSend.connect(conv);
      conv.connect(this.reverbReturn);
      this.convolver = conv;
      this.reverbLoaded = type;
    }
    this.reverbSend.gain.setTargetAtTime(mix, now, 0.05);
    this.reverbReturn.gain.setTargetAtTime(1, now, 0.05);
  }

  // ---------------------------------------------------------------- ゾーン選び

  /**
   * その鍵盤・その強さで鳴るゾーンを選ぶ。
   *
   * 同じ範囲に複数あるときは、組（group）ごとに順番に鳴らす。
   * 同じ音を続けて弾いたときに、まったく同じ波形が重ならないようにするため。
   */
  private pickZones(note: number, velocity: number): Zone[] {
    const matching = this.instrument.zones.filter(
      (z) => note >= z.loKey && note <= z.hiKey && velocity >= z.loVel && velocity <= z.hiVel
    );
    if (matching.length <= 1) return matching;

    const byGroup = new Map<number, Zone[]>();
    for (const z of matching) {
      const list = byGroup.get(z.group);
      if (list) list.push(z);
      else byGroup.set(z.group, [z]);
    }

    const picked: Zone[] = [];
    for (const [group, list] of byGroup) {
      if (list.length === 1) {
        picked.push(list[0]);
        continue;
      }
      const next = (this.roundRobin.get(group) ?? 0) % list.length;
      this.roundRobin.set(group, next + 1);
      picked.push(list[next]);
    }
    return picked;
  }

  /** 逆再生ぶんの波形を、必要になったときだけ作る */
  private bufferFor(zone: Zone): AudioBuffer | null {
    const entry = this.buffers.get(zone.sampleId);
    if (!entry) return null;
    if (!zone.reverse) return entry.buffer;
    if (!entry.reversed) {
      const src = entry.buffer;
      const rev = this.ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
      for (let c = 0; c < src.numberOfChannels; c++) {
        const from = src.getChannelData(c);
        const to = rev.getChannelData(c);
        for (let i = 0; i < from.length; i++) to[i] = from[from.length - 1 - i];
      }
      entry.reversed = rev;
    }
    return entry.reversed;
  }

  // ---------------------------------------------------------------- 発音

  noteOn(note: number, velocity: number, when?: number): void {
    const time = when ?? this.ctx.currentTime;
    const inst = this.instrument;
    const sounding = note + inst.transpose;
    const zones = this.pickZones(sounding, Math.max(1, Math.min(127, velocity)));
    if (zones.length === 0) return;

    if (inst.mono) {
      // 単音のときは、前の音を止めてから鳴らす
      for (const v of this.voices) if (v.released === null) this.stopVoice(v, time, 0.02);
    }
    this.limitPolyphony(zones.length, time);

    for (const zone of zones) {
      this.startVoice(zone, note, sounding, velocity, time);
    }
    this.lastNote = sounding;
  }

  private startVoice(zone: Zone, note: number, sounding: number, velocity: number, time: number) {
    const buffer = this.bufferFor(zone);
    if (!buffer) return;
    const ctx = this.ctx;
    const inst = this.instrument;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // 音程。基準の音からの差を再生速度にする
    const semis = sounding - zone.rootKey + zone.tuneSemis + zone.tuneCents / 100;
    const rate = Math.pow(2, semis / 12);
    source.playbackRate.value = rate;
    if (inst.mono && inst.glide > 0 && this.lastNote !== null) {
      const fromSemis = this.lastNote - zone.rootKey + zone.tuneSemis + zone.tuneCents / 100;
      source.playbackRate.setValueAtTime(Math.pow(2, fromSemis / 12), time);
      source.playbackRate.exponentialRampToValueAtTime(Math.max(0.01, rate), time + inst.glide);
    }

    // 鳴らす範囲。割合で持っているので、ここで秒に直す
    const duration = buffer.duration;
    const startSec = Math.max(0, Math.min(duration, zone.start * duration));
    const endSec = Math.max(startSec, Math.min(duration, zone.end * duration));
    if (zone.loop) {
      source.loop = true;
      const ls = Math.max(startSec, Math.min(endSec, zone.loopStart * duration));
      const le = Math.max(ls + 0.002, Math.min(endSec, zone.loopEnd * duration));
      source.loopStart = ls;
      source.loopEnd = le;
    }

    // 音量のエンベロープ
    const amp = ctx.createGain();
    const env = inst.amp;
    const peak = dbToGain(zone.gainDb) * velocityGain(velocity, inst.velToVolume);
    amp.gain.setValueAtTime(MIN_GAIN, time);
    const attackEnd = time + Math.max(0.0005, env.attack);
    amp.gain.linearRampToValueAtTime(peak, attackEnd);
    const sustain = Math.max(MIN_GAIN, peak * env.sustain);
    amp.gain.setTargetAtTime(sustain, attackEnd, Math.max(0.005, env.decay) / 3);

    // フィルター
    let filter: BiquadFilterNode | null = null;
    const fs = inst.filter;
    if (fs.mode !== 'off') {
      filter = ctx.createBiquadFilter();
      filter.type = fs.mode;
      filter.Q.value = fs.q;
      // 鍵盤が高いほど遮断周波数も上げると、どの音域でも同じ明るさに聞こえる
      const keyOffset = ((sounding - 60) / 12) * fs.keyTrack;
      const velOffset = (velocity / 127) * inst.velToFilter;
      const base = fs.freq * Math.pow(2, keyOffset + velOffset);
      const nyquist = ctx.sampleRate / 2;
      const clamp = (f: number) => Math.max(20, Math.min(nyquist * 0.98, f));
      if (fs.envAmount !== 0) {
        const top = clamp(base * Math.pow(2, fs.envAmount));
        filter.frequency.setValueAtTime(clamp(base), time);
        filter.frequency.linearRampToValueAtTime(top, time + Math.max(0.001, fs.env.attack));
        filter.frequency.setTargetAtTime(
          clamp(base + (top - base) * fs.env.sustain),
          time + fs.env.attack,
          Math.max(0.005, fs.env.decay) / 3
        );
      } else {
        filter.frequency.value = clamp(base);
      }
    }

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, zone.pan));

    // LFO。深さが 0 のときは作らない（作るだけで毎フレーム計算される）
    let lfo: OscillatorNode | null = null;
    const lfoGains: GainNode[] = [];
    const ls = inst.lfo;
    if (ls.toPitch !== 0 || ls.toFilter !== 0 || ls.toAmp !== 0) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = ls.rate;
      const startAt = time + Math.max(0, ls.delay);
      if (ls.toPitch !== 0) {
        const g = ctx.createGain();
        // detune はセント単位。そのまま入れられる
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(ls.toPitch, startAt + 0.05);
        lfo.connect(g).connect(source.detune);
        lfoGains.push(g);
      }
      if (ls.toFilter !== 0 && filter) {
        const g = ctx.createGain();
        // オクターブを Hz に直す。中心の周波数ぶんだけ動かす
        const depthHz = filter.frequency.value * (Math.pow(2, ls.toFilter) - 1);
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(depthHz, startAt + 0.05);
        lfo.connect(g).connect(filter.frequency);
        lfoGains.push(g);
      }
      if (ls.toAmp !== 0) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(peak * ls.toAmp * 0.5, startAt + 0.05);
        lfo.connect(g).connect(amp.gain);
        lfoGains.push(g);
      }
      lfo.start(time);
    }

    // つなぐ
    let tail: AudioNode = source;
    tail = tail.connect(amp);
    if (filter) tail = tail.connect(filter);
    tail.connect(pan).connect(this.voiceBus);

    source.start(time, startSec);

    const voice: Voice = {
      note,
      id: ++this.voiceSeq,
      zone,
      source,
      amp,
      filter,
      pan,
      lfo,
      lfoGains,
      started: time,
      released: null,
      releaseSeconds: inst.amp.release,
    };
    this.voices.push(voice);

    // ループしない音は、鳴り終わったら自分で片付ける
    source.onended = () => this.dispose(voice);
    if (!zone.loop) {
      const playSeconds = (endSec - startSec) / rate;
      source.stop(time + playSeconds + 0.01);
    }
  }

  noteOff(note: number, when?: number): void {
    const time = when ?? this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.note === note && v.released === null) this.stopVoice(v, time, v.releaseSeconds);
    }
    if (this.instrument.mono) this.lastNote = null;
  }

  /** 押している音を離す。余韻は残る */
  allNotesOff(when?: number): void {
    const time = when ?? this.ctx.currentTime;
    for (const v of this.voices) if (v.released === null) this.stopVoice(v, time, 0.05);
    this.lastNote = null;
  }

  /**
   * 予約したものまで含めて、すべて即座に止める。
   *
   * 記録した演奏を再生するとき、音は先の時刻まで一気に予約してしまう。
   * これを途中で止めるには allNotesOff では足りない。
   *
   *   1. 同時発音数の制限に引っかかった音は、その時点で「離した」印が付く。
   *      allNotesOff は離した音を飛ばすので、そこで取りこぼす
   *   2. 印が付いていても、止まるのは予約された未来の時刻なので、
   *      放っておけばそのまま鳴り続ける
   *
   * ここでは印を見ずに、全部のボイスの音量を今すぐ落として止める。
   * （エフェクトの残響だけは、そのまま自然に消えるに任せる）
   */
  panic(when?: number): void {
    const time = when ?? this.ctx.currentTime;
    for (const voice of [...this.voices]) {
      try {
        voice.amp.gain.cancelScheduledValues(time);
        voice.amp.gain.setValueAtTime(MIN_GAIN, time);
        voice.source.stop(time);
        voice.lfo?.stop(time);
      } catch {
        /* すでに止まっていれば、何もしなくてよい */
      }
      voice.released = time;
    }
    this.lastNote = null;
  }

  private stopVoice(voice: Voice, time: number, release: number) {
    voice.released = time;
    const tau = Math.max(0.004, release) / 3;
    voice.amp.gain.cancelScheduledValues(time);
    // いまの値から下げる。押しっぱなしの途中で離しても段差が出ない
    voice.amp.gain.setValueAtTime(Math.max(MIN_GAIN, voice.amp.gain.value), time);
    voice.amp.gain.setTargetAtTime(MIN_GAIN, time, tau);
    const stopAt = time + Math.max(0.02, release) + 0.05;
    try {
      voice.source.stop(stopAt);
      voice.lfo?.stop(stopAt);
    } catch {
      /* すでに止まっていれば何もしなくてよい */
    }
  }

  /** 同時発音数を超えそうなら、古い音から引き取る */
  private limitPolyphony(incoming: number, time: number) {
    const limit = Math.max(1, this.instrument.polyphony);
    const alive = this.voices.filter((v) => v.released === null);
    const over = alive.length + incoming - limit;
    if (over <= 0) return;
    // 鳴らし始めが古いものから止める
    alive.sort((a, b) => a.started - b.started);
    for (let i = 0; i < over && i < alive.length; i++) this.stopVoice(alive[i], time, 0.03);
  }

  private dispose(voice: Voice) {
    const at = this.voices.indexOf(voice);
    if (at >= 0) this.voices.splice(at, 1);
    try {
      voice.source.disconnect();
      voice.amp.disconnect();
      voice.filter?.disconnect();
      voice.pan.disconnect();
      voice.lfo?.disconnect();
      for (const g of voice.lfoGains) g.disconnect();
    } catch {
      /* すでに切れていれば何もしなくてよい */
    }
  }

  /** いま鳴っている数。画面のメーターに使う */
  get activeVoices(): number {
    return this.voices.length;
  }

  /** その鍵盤に素材が割り当たっているか（鍵盤の色分けに使う） */
  hasZoneFor(note: number): boolean {
    const sounding = note + this.instrument.transpose;
    return this.instrument.zones.some((z) => sounding >= z.loKey && sounding <= z.hiKey);
  }

  /** 参考: その鍵盤で鳴る周波数 */
  frequencyFor(note: number): number {
    return midiToFreq(note + this.instrument.transpose);
  }
}
