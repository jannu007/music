/*
 * 録音した歌声から音符を取り出す
 *
 * 1. 解析しやすいように 16kHz へ落とす
 * 2. YIN（差分関数 + 累積平均正規化）で 10ms ごとの基本周波数を測る
 * 3. 無音で区切り、さらに音程の変わり目で割って音符にする
 * 4. 母音（あいうえお）を第1・第2フォルマントからざっくり推定する
 *
 * 外部ライブラリは使わず、すべてこの場で計算する（アプリ全体の方針に合わせる）。
 */

import type { Recording } from './mic';

export interface DetectedNote {
  /** 録音の先頭からの開始位置（秒） */
  startSec: number;
  /** 長さ（秒） */
  lengthSec: number;
  /** MIDI ノート番号（整数） */
  midi: number;
  /** 強さ 0..1 */
  vel: number;
  /** 推定した母音（ひらがな1文字）。取れなければ null */
  vowel: string | null;
}

export interface AnalyzeOptions {
  /** 基準ピッチ Hz */
  a4?: number;
  /** 感度 0..1（大きいほど小さな声も拾う） */
  sensitivity?: number;
  /** これより短い音は捨てる（秒） */
  minNoteSec?: number;
  /** これ以下の無音は同じ音符の中（子音）とみなす（秒） */
  maxGapSec?: number;
  /** 母音を推定するか */
  detectVowels?: boolean;
}

const ANALYSIS_RATE = 16000;
/** 解析窓（サンプル）。16kHz で 64ms */
const FRAME = 1024;
/** 10ms ごとに測る */
const HOP = 160;
/** 約 1230Hz まで */
const MIN_TAU = 13;
/** 約 65Hz まで */
const MAX_TAU = 246;
const YIN_THRESHOLD = 0.15;

// ---------------------------------------------------------------- 前処理

/** RBJ の 2次ローパス（折り返しを抑えてから間引く） */
function lowpass(input: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = ((1 - cos) / 2) / a0;
  const b1 = (1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;

  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** 解析用のサンプリング周波数へ落とす */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (Math.abs(from - to) < 1) return input.slice();
  const src = to < from ? lowpass(input, from, to * 0.45) : input;
  const ratio = from / to;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

// ---------------------------------------------------------------- ピッチ検出

export interface PitchResult {
  /** 基本周波数 Hz（取れなければ 0） */
  freq: number;
  /** 確からしさ 0..1 */
  confidence: number;
}

/**
 * YIN で 1 フレーム分の基本周波数を求める。
 * buf[offset .. offset+FRAME+MAX_TAU) を読むので、呼ぶ側で長さを確かめること。
 */
export function detectPitch(buf: Float32Array, offset: number, sampleRate: number): PitchResult {
  const diff = new Float32Array(MAX_TAU + 1);
  for (let tau = 1; tau <= MAX_TAU; tau++) {
    let sum = 0;
    for (let j = 0; j < FRAME; j++) {
      const d = buf[offset + j] - buf[offset + j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // 累積平均で正規化する（低い tau ばかり選ばれるのを防ぐ）
  const norm = new Float32Array(MAX_TAU + 1);
  norm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= MAX_TAU; tau++) {
    running += diff[tau];
    norm[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }

  let tau = -1;
  for (let t = MIN_TAU; t <= MAX_TAU; t++) {
    if (norm[t] < YIN_THRESHOLD) {
      while (t + 1 <= MAX_TAU && norm[t + 1] < norm[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // しきい値を割らなければ、いちばん谷が深いところを採る
    let best = MIN_TAU;
    for (let t = MIN_TAU + 1; t <= MAX_TAU; t++) if (norm[t] < norm[best]) best = t;
    tau = best;
  }

  // 放物線で山（谷）の頂点を補間して、半音より細かい精度を得る
  let refined = tau;
  if (tau > MIN_TAU && tau < MAX_TAU) {
    const s0 = norm[tau - 1];
    const s1 = norm[tau];
    const s2 = norm[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-9) refined = tau + (s2 - s0) / denom;
  }
  if (refined <= 0) return { freq: 0, confidence: 0 };

  const confidence = Math.max(0, Math.min(1, 1 - norm[tau]));
  return { freq: sampleRate / refined, confidence };
}

// ---------------------------------------------------------------- FFT（母音推定用）

/** 反復版 radix-2 FFT（実部・虚部をその場で書き換える） */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const FFT_SIZE = 1024;

/** 窓をかけて振幅スペクトルを足し込む */
function addSpectrum(buf: Float32Array, offset: number, into: Float32Array) {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
    re[i] = (buf[offset + i] ?? 0) * w;
  }
  fft(re, im);
  for (let i = 0; i < into.length; i++) into[i] += Math.hypot(re[i], im[i]);
}

/** 倍音の凹凸をならして、声道の共鳴（フォルマント）の形だけを残す */
function smoothSpectrum(mag: Float32Array, binHz: number, widthHz: number): Float32Array {
  const half = Math.max(1, Math.round(widthHz / binHz / 2));
  const out = new Float32Array(mag.length);
  let sum = 0;
  for (let i = 0; i < mag.length; i++) {
    sum += mag[i];
    if (i > 2 * half) sum -= mag[i - 2 * half - 1];
    const from = Math.max(0, i - 2 * half);
    out[Math.max(0, i - half)] = sum / (i - from + 1);
  }
  return out;
}

/** 範囲の中でいちばん高い山を探す */
function peakIn(mag: Float32Array, binHz: number, lowHz: number, highHz: number): number {
  const from = Math.max(1, Math.round(lowHz / binHz));
  const to = Math.min(mag.length - 2, Math.round(highHz / binHz));
  let bestBin = -1;
  let bestValue = -Infinity;
  for (let i = from; i <= to; i++) {
    if (mag[i] >= mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > bestValue) {
      bestValue = mag[i];
      bestBin = i;
    }
  }
  if (bestBin < 0) {
    for (let i = from; i <= to; i++) {
      if (mag[i] > bestValue) {
        bestValue = mag[i];
        bestBin = i;
      }
    }
  }
  return bestBin < 0 ? 0 : bestBin * binHz;
}

const VOWEL_KANA = ['あ', 'い', 'う', 'え', 'お'];
/** 日本語5母音の第1・第2フォルマント（Hz）のおおよその中心 */
const FORMANTS_LOW = [
  [775, 1163],
  [263, 2263],
  [363, 1300],
  [475, 1738],
  [550, 838],
];
const FORMANTS_HIGH = [
  [888, 1363],
  [325, 2725],
  [375, 1675],
  [483, 2317],
  [483, 925],
];

/** F1・F2 からいちばん近い母音を選ぶ（対数距離） */
function classifyVowel(f1: number, f2: number, high: boolean): string | null {
  if (f1 <= 0 || f2 <= 0) return null;
  const table = high ? FORMANTS_HIGH : FORMANTS_LOW;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < table.length; i++) {
    const d1 = Math.log(f1 / table[i][0]);
    const d2 = Math.log(f2 / table[i][1]);
    const dist = d1 * d1 + 0.8 * d2 * d2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best < 0 ? null : VOWEL_KANA[best];
}

// ---------------------------------------------------------------- 音符の取り出し

interface Frame {
  midi: number;
  confidence: number;
  rms: number;
  voiced: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[i];
}

/** 幅 width の最頻値フィルタ（音程のちらつきを均す） */
function modeFilter(values: number[], width: number): number[] {
  const half = width >> 1;
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const counts = new Map<number, number>();
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      counts.set(values[j], (counts.get(values[j]) ?? 0) + 1);
    }
    let best = values[i];
    let bestCount = 0;
    for (const [value, count] of counts) {
      // 同数なら元の値を優先する
      if (count > bestCount || (count === bestCount && value === values[i])) {
        best = value;
        bestCount = count;
      }
    }
    out.push(best);
  }
  return out;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 録音から音符を取り出す */
export async function analyzeRecording(
  recording: Recording,
  options: AnalyzeOptions = {},
  onProgress?: (ratio: number) => void
): Promise<DetectedNote[]> {
  const a4 = options.a4 ?? 440;
  const sensitivity = Math.max(0, Math.min(1, options.sensitivity ?? 0.5));
  const minNoteSec = options.minNoteSec ?? 0.09;
  const maxGapSec = options.maxGapSec ?? 0.1;
  const detectVowels = options.detectVowels ?? false;

  const signal = resample(recording.samples, recording.sampleRate, ANALYSIS_RATE);
  const hopSec = HOP / ANALYSIS_RATE;
  const need = FRAME + MAX_TAU;
  const frameCount = Math.max(0, Math.floor((signal.length - need) / HOP) + 1);
  if (frameCount <= 0) return [];

  const frames: Frame[] = [];
  for (let f = 0; f < frameCount; f++) {
    const offset = f * HOP;
    let energy = 0;
    for (let j = 0; j < FRAME; j++) {
      const v = signal[offset + j];
      energy += v * v;
    }
    const rms = Math.sqrt(energy / FRAME);
    const { freq, confidence } = detectPitch(signal, offset, ANALYSIS_RATE);
    const midi = freq > 0 ? 69 + 12 * Math.log2(freq / a4) : 0;
    frames.push({ midi, confidence, rms, voiced: false });

    if ((f & 127) === 127) {
      onProgress?.(f / frameCount);
      await yieldToUi();
    }
  }

  // 声が出ているフレームを決める（暗騒音と音量のばらつきに合わせる）
  const rmsValues = frames.map((f) => f.rms);
  const floor = percentile(rmsValues, 0.2);
  const loud = percentile(rmsValues, 0.95);
  // 息継ぎなしで歌い続けると「静かな側」まで歌声で埋まるため、暗騒音を基準にしたしきい値は
  // 大きな声の半分までに抑える。こうすると無音のない録音でも取りこぼさない。
  const noiseGate = Math.min(floor * (3.2 - 2.0 * sensitivity), loud * 0.45);
  // 感度が高いほどしきい値を下げる
  const gate = Math.max(loud * (0.13 - 0.08 * sensitivity), noiseGate, 0.0015);
  const minConfidence = 0.62 - 0.22 * sensitivity;
  for (const frame of frames) {
    frame.voiced = frame.confidence >= minConfidence && frame.rms >= gate && frame.midi >= 24 && frame.midi <= 100;
  }

  // 無音で区切ってフレーズにする（短い無声区間は子音とみなして繋ぐ）
  const maxGapFrames = Math.max(1, Math.round(maxGapSec / hopSec));
  const phrases: { from: number; to: number }[] = [];
  let start = -1;
  let silence = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].voiced) {
      if (start < 0) start = i;
      silence = 0;
    } else if (start >= 0) {
      silence++;
      if (silence > maxGapFrames) {
        phrases.push({ from: start, to: i - silence });
        start = -1;
        silence = 0;
      }
    }
  }
  if (start >= 0) phrases.push({ from: start, to: frames.length - 1 - silence });

  // フレーズの中を音程の変わり目で割る
  const minNoteFrames = Math.max(1, Math.round(minNoteSec / hopSec));
  const segments: { from: number; to: number }[] = [];
  for (const phrase of phrases) {
    const indices: number[] = [];
    for (let i = phrase.from; i <= phrase.to; i++) if (frames[i].voiced) indices.push(i);
    if (indices.length === 0) continue;
    const steps = modeFilter(indices.map((i) => Math.round(frames[i].midi)), 5);

    let segFrom = 0;
    for (let k = 1; k <= steps.length; k++) {
      if (k === steps.length || steps[k] !== steps[segFrom]) {
        const length = k - segFrom;
        if (length >= minNoteFrames) {
          segments.push({ from: indices[segFrom], to: indices[k - 1] });
        } else if (segments.length > 0 && segFrom > 0) {
          // 短すぎる切れ端は直前の音符に含める（しゃくり・ゆれの取りこぼし対策）
          segments[segments.length - 1].to = indices[k - 1];
        }
        segFrom = k;
      }
    }
  }

  if (segments.length === 0) return [];

  // 声の高さで男声/女声のフォルマント表を選ぶ
  const allMidi = segments.flatMap((s) => {
    const values: number[] = [];
    for (let i = s.from; i <= s.to; i++) if (frames[i].voiced) values.push(frames[i].midi);
    return values;
  });
  const highVoice = median(allMidi) >= 55; // 約 G3 より上なら高い声とみなす

  const notes: DetectedNote[] = [];
  let peakRms = 0;
  for (const seg of segments) for (let i = seg.from; i <= seg.to; i++) peakRms = Math.max(peakRms, frames[i].rms);

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const midis: number[] = [];
    let rmsSum = 0;
    let rmsCount = 0;
    for (let i = seg.from; i <= seg.to; i++) {
      if (frames[i].voiced) midis.push(frames[i].midi);
      rmsSum += frames[i].rms;
      rmsCount++;
    }
    if (midis.length === 0) continue;

    const midi = Math.round(median(midis));
    const level = rmsCount > 0 ? rmsSum / rmsCount : 0;
    const vel = peakRms > 0 ? Math.max(0.35, Math.min(1, 0.35 + 0.65 * (level / peakRms))) : 0.7;

    let vowel: string | null = null;
    if (detectVowels) {
      // 音符の中ほど（子音が終わって母音が伸びている辺り）を見る
      const span = seg.to - seg.from;
      const from = seg.from + Math.floor(span * 0.3);
      const to = seg.from + Math.max(1, Math.ceil(span * 0.7));
      const mag = new Float32Array(FFT_SIZE / 2);
      let used = 0;
      for (let i = from; i <= to && used < 8; i++) {
        const offset = i * HOP;
        if (offset + FFT_SIZE > signal.length) break;
        addSpectrum(signal, offset, mag);
        used++;
      }
      if (used > 0) {
        const binHz = ANALYSIS_RATE / FFT_SIZE;
        const f0 = 440 * Math.pow(2, (midi - 69) / 12);
        const smoothed = smoothSpectrum(mag, binHz, Math.max(180, f0 * 1.4));
        const f1 = peakIn(smoothed, binHz, 220, 1050);
        const f2 = peakIn(smoothed, binHz, Math.max(f1 + 250, 700), 2900);
        vowel = classifyVowel(f1, f2, highVoice);
      }
    }

    notes.push({
      startSec: seg.from * hopSec,
      lengthSec: Math.max(minNoteSec, (seg.to - seg.from + 1) * hopSec),
      midi,
      vel,
      vowel,
    });

    if ((s & 15) === 15) await yieldToUi();
  }

  onProgress?.(1);
  return notes;
}

// ---------------------------------------------------------------- 拍への割り当て

export interface QuantizeOptions {
  bpm: number;
  /** スナップ幅（拍）。0 でスナップなし */
  snap: number;
  /** 挿入位置（拍） */
  offsetBeats?: number;
  /** 最初の音符が拍の頭に来るように前を詰める */
  trimStart?: boolean;
  /** 最短の長さ（拍） */
  minLengthBeats?: number;
}

export interface QuantizedNote {
  start: number;
  length: number;
  note: number;
  vel: number;
  vowel: string | null;
}

/** 秒で取り出した音符を拍に直し、グリッドへ合わせる */
export function quantizeToBeats(notes: DetectedNote[], options: QuantizeOptions): QuantizedNote[] {
  const { bpm, snap } = options;
  const offset = options.offsetBeats ?? 0;
  const minLength = options.minLengthBeats ?? (snap > 0 ? snap : 0.25);
  if (notes.length === 0) return [];

  const perBeat = bpm / 60;
  const shift = options.trimStart ? notes[0].startSec : 0;
  const snapTo = (beat: number) => (snap > 0 ? Math.round(beat / snap) * snap : beat);

  const out: QuantizedNote[] = [];
  for (const note of notes) {
    const rawStart = (note.startSec - shift) * perBeat;
    const rawEnd = rawStart + note.lengthSec * perBeat;
    let start = snapTo(rawStart);
    let end = snapTo(rawEnd);
    if (end - start < minLength) end = start + minLength;
    if (start < 0) {
      end -= start;
      start = 0;
    }

    const previous = out[out.length - 1];
    // 前の音符と重なったら、前を切り詰めて繋がるようにする
    if (previous && start < previous.start + previous.length) {
      const trimmed = start - previous.start;
      if (trimmed >= minLength) previous.length = trimmed;
      else start = previous.start + previous.length;
      if (end - start < minLength) end = start + minLength;
    }

    out.push({
      start: Number((start + offset).toFixed(6)),
      length: Number((end - start).toFixed(6)),
      note: note.midi,
      vel: note.vel,
      vowel: note.vowel,
    });
  }
  return out;
}
