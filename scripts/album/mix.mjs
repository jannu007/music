/**
 * 天問 (Tenmon) アルバム — 6ステム・ミックスダウン
 *
 * album-stems/tenmon-NN/{piano,bass,guitar,drums,vocal,synth}.wav を読み込み、
 * ゲイン・パンを付けて1つのステレオ WAV にミックスダウンする。
 * 外部コーデック（ffmpeg等）には依存せず、WAV の読み書きは素の Node で行う。
 *
 *   node scripts/album/mix.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STEMS_DIR = '/tmp/claude-0/-home-user-music/805a8a77-5c19-5b35-97cf-ece722cd1a0c/scratchpad/album-stems';
const OUT_DIR = '/tmp/claude-0/-home-user-music/805a8a77-5c19-5b35-97cf-ece722cd1a0c/scratchpad/album-master';

const TRACK_IDS = Array.from({ length: 10 }, (_, i) => `tenmon-${String(i + 1).padStart(2, '0')}`);

// instrument: { gain(線形倍率), pan(-1..1) }
// synth は元々「ジャズコンボ全体」を1トラックで表現しているため、他5パートと
// 重複しないよう控えめな音量に絞り、背景の質感／倍音の厚みとして混ぜる。
const MIX_RECIPE = {
  drums: { gain: 0.85, pan: 0.0 },
  bass: { gain: 0.95, pan: 0.0 },
  piano: { gain: 0.75, pan: -0.22 },
  guitar: { gain: 0.7, pan: 0.28 },
  vocal: { gain: 0.9, pan: 0.0 },
  synth: { gain: 0.28, pan: 0.0 },
};

const INSTRUMENTS = Object.keys(MIX_RECIPE);

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('RIFF/WAVE ヘッダが不正です');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error('fmt/data チャンクが見つかりません');

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / (bytesPerSample * fmt.channels));
  const channels = [];
  for (let ch = 0; ch < fmt.channels; ch++) channels.push(new Float32Array(frameCount));

  for (let i = 0; i < frameCount; i++) {
    for (let ch = 0; ch < fmt.channels; ch++) {
      const p = dataOffset + (i * fmt.channels + ch) * bytesPerSample;
      let v;
      if (fmt.bitsPerSample === 16) {
        v = buf.readInt16LE(p) / 32768;
      } else if (fmt.bitsPerSample === 24) {
        const b0 = buf.readUInt8(p);
        const b1 = buf.readUInt8(p + 1);
        const b2 = buf.readInt8(p + 2);
        v = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      } else if (fmt.bitsPerSample === 32) {
        v = buf.readInt32LE(p) / 2147483648;
      } else {
        throw new Error(`未対応の bitsPerSample: ${fmt.bitsPerSample}`);
      }
      channels[ch][i] = v;
    }
  }
  return { sampleRate: fmt.sampleRate, channels, frameCount };
}

function encodeWav16(left, right, sampleRate) {
  const frameCount = left.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample * 2;
  const dataSize = frameCount * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  let off = 44;
  for (let i = 0; i < frameCount; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(l * 32767), off);
    buf.writeInt16LE(Math.round(r * 32767), off + 2);
    off += 4;
  }
  return buf;
}

/**
 * 配信サイズ制限（1ファイル30MB）に収めるため、最終ミックスを 48kHz→24kHz に
 * ダウンサンプルする。ウィンドウ付き sinc のローパス FIR でエイリアシングを
 * 抑えてから間引く（単純な間引きだけだと折り返しノイズが乗る）。
 */
function makeLowpassKernel(taps, cutoffRatio) {
  // cutoffRatio: 新しいナイキスト周波数 / 元のサンプルレート（例: 12000/48000=0.25）
  const kernel = new Float32Array(taps);
  const center = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - center;
    const sinc = x === 0 ? 2 * cutoffRatio : Math.sin(2 * Math.PI * cutoffRatio * x) / (Math.PI * x);
    // Hann window
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * w;
    sum += kernel[i];
  }
  for (let i = 0; i < taps; i++) kernel[i] /= sum; // DCゲインを1に正規化
  return kernel;
}

function downsampleBy2(input, kernel) {
  const taps = kernel.length;
  const half = (taps - 1) / 2;
  const outLen = Math.floor(input.length / 2);
  const out = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const center = o * 2;
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const idx = center + (k - half);
      if (idx >= 0 && idx < input.length) acc += input[idx] * kernel[k];
    }
    out[o] = acc;
  }
  return out;
}

function equalPowerPan(pan) {
  // pan: -1(左) .. 0(中央) .. +1(右)
  const angle = ((pan + 1) * Math.PI) / 4; // 0..pi/2
  return { l: Math.cos(angle), r: Math.sin(angle) };
}

function analyze(left, right, sampleRate) {
  let peak = 0;
  let sumSq = 0;
  let dcL = 0;
  let dcR = 0;
  let nan = 0;
  const n = left.length;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) nan++;
    dcL += l;
    dcR += r;
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    sumSq += l * l + r * r;
  }
  return {
    peak,
    rms: Math.sqrt(sumSq / Math.max(1, n * 2)),
    dc: (Math.abs(dcL) + Math.abs(dcR)) / Math.max(1, n * 2),
    nan,
    seconds: n / sampleRate,
  };
}

async function mixTrack(id) {
  const dir = resolve(STEMS_DIR, id);
  const stems = {};
  let sampleRate = null;
  let maxFrames = 0;

  for (const inst of INSTRUMENTS) {
    const path = resolve(dir, `${inst}.wav`);
    if (!existsSync(path)) throw new Error(`${id}: ${inst}.wav が見つかりません (${path})`);
    const buf = await readFile(path);
    const parsed = parseWav(buf);
    if (sampleRate === null) sampleRate = parsed.sampleRate;
    else if (parsed.sampleRate !== sampleRate) {
      throw new Error(`${id}: ${inst}.wav のサンプルレートが不一致 (${parsed.sampleRate} != ${sampleRate})`);
    }
    stems[inst] = parsed;
    maxFrames = Math.max(maxFrames, parsed.frameCount);
  }

  const outL = new Float32Array(maxFrames);
  const outR = new Float32Array(maxFrames);

  for (const inst of INSTRUMENTS) {
    const { gain, pan } = MIX_RECIPE[inst];
    const { l: panL, r: panR } = equalPowerPan(pan);
    const parsed = stems[inst];
    const chL = parsed.channels[0];
    const chR = parsed.channels[parsed.channels.length > 1 ? 1 : 0];
    for (let i = 0; i < parsed.frameCount; i++) {
      outL[i] += chL[i] * gain * panL;
      outR[i] += chR[i] * gain * panR;
    }
  }

  // 簡易リミッター：ピークが 0.98 を超えたら全体を down-scale してクリッピングを防ぐ
  let peak = 0;
  for (let i = 0; i < maxFrames; i++) {
    const a = Math.abs(outL[i]);
    const b = Math.abs(outR[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  if (peak > 0.98) {
    const scale = 0.98 / peak;
    for (let i = 0; i < maxFrames; i++) {
      outL[i] *= scale;
      outR[i] *= scale;
    }
  }

  // 配信サイズを1ファイル30MB制限内に収めるため 48kHz -> 24kHz にダウンサンプル
  const lpKernel = makeLowpassKernel(31, 0.25); // 24kHz出力のナイキスト(12kHz)/48kHz = 0.25
  const dsL = downsampleBy2(outL, lpKernel);
  const dsR = downsampleBy2(outR, lpKernel);
  const outSampleRate = sampleRate / 2;

  const wav = encodeWav16(dsL, dsR, outSampleRate);
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, `${id}.wav`);
  await writeFile(outPath, wav);

  const stats = analyze(dsL, dsR, outSampleRate);
  return { id, outPath, sampleRate: outSampleRate, limited: peak > 0.98, prelimitPeak: peak, ...stats };
}

async function main() {
  console.log('▶ 天問 (Tenmon) 全10曲ミックスダウン開始\n');
  const results = [];
  const failures = [];
  for (const id of TRACK_IDS) {
    try {
      const r = await mixTrack(id);
      results.push(r);
      console.log(
        `  ${id}: ${r.seconds.toFixed(1)}s  peak=${r.peak.toFixed(4)}  rms=${r.rms.toFixed(4)}  dc=${r.dc.toExponential(2)}  ` +
        `nan=${r.nan}  limited=${r.limited}  -> ${r.outPath}`
      );
      if (r.rms < 0.01) failures.push(`${id}: ほぼ無音 (RMS=${r.rms.toFixed(4)})`);
      if (r.peak > 1.0) failures.push(`${id}: クリッピング (peak=${r.peak.toFixed(4)})`);
      if (r.nan > 0) failures.push(`${id}: NaN/非有限値を含む (${r.nan})`);
      if (r.dc > 0.01) failures.push(`${id}: DCオフセットが大きい (${r.dc.toExponential(2)})`);
    } catch (err) {
      failures.push(`${id}: ${err.message}`);
      console.error(`  ${id}: 失敗 -> ${err.message}`);
    }
  }

  console.log('\n--- 結果 ---');
  console.log(`成功: ${results.length}/10`);
  if (failures.length > 0) {
    console.log('失敗/警告:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('すべてのトラックが正常にミックスされました。');
  }
}

main();
