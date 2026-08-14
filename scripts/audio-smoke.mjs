/**
 * Micro Sakura Studio — 音声出力の自動検証スクリプト
 *
 * ヘッドレス Chromium で実際にアプリを起動し、WAV 書き出しを実行して
 * 生成された音声を解析します（無音・クリップ・NaN・DC オフセットを検出）。
 *
 *   node scripts/audio-smoke.mjs
 *
 * 事前に `npm run build` が必要です。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = 4178;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath = join(ROOT, decodeURIComponent(url.pathname));
      const info = await stat(filePath).catch(() => null);
      if (!info || info.isDirectory()) filePath = join(filePath, 'index.html');
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

function analyzeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (String.fromCharCode(...buffer.subarray(0, 4)) !== 'RIFF') throw new Error('RIFF ヘッダがありません');
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);

  // data チャンクを探す
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error('data チャンクがありません');

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataSize / (bytesPerSample * channels));
  let peak = 0;
  let sum = 0;
  let sumSq = 0;
  let clipped = 0;
  let nan = 0;
  const rmsWindow = [];
  const windowFrames = Math.floor(sampleRate * 0.05);
  let windowSum = 0;
  let windowCount = 0;

  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const p = dataOffset + (i * channels + ch) * bytesPerSample;
      let v;
      if (bits === 16) v = view.getInt16(p, true) / 32768;
      else {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getInt8(p + 2);
        v = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      }
      if (!Number.isFinite(v)) nan++;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a > 0.999) clipped++;
      sum += v;
      sumSq += v * v;
      windowSum += v * v;
    }
    windowCount++;
    if (windowCount >= windowFrames) {
      rmsWindow.push(Math.sqrt(windowSum / (windowCount * channels)));
      windowSum = 0;
      windowCount = 0;
    }
  }

  const total = frames * channels;
  return {
    sampleRate,
    channels,
    bits,
    seconds: frames / sampleRate,
    peak,
    rms: Math.sqrt(sumSq / total),
    dc: sum / total,
    clippedRatio: clipped / total,
    nan,
    silentWindows: rmsWindow.filter((r) => r < 0.0005).length,
    totalWindows: rmsWindow.length,
  };
}


/* --- 簡易 FFT（エイリアスノイズ測定用） --- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

/** ノコギリ波の倍音以外（＝エイリアス歪み）のエネルギー比を dB で返す */
function aliasRatioDb(samples, sampleRate, fundamental) {
  const n = 16384;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hann 窓
    re[i] = (samples[i] ?? 0) * w;
  }
  fft(re, im);
  const binHz = sampleRate / n;
  let harmonic = 0;
  let alias = 0;
  for (let k = 1; k < n / 2; k++) {
    const freq = k * binHz;
    if (freq < 60 || freq > sampleRate * 0.47) continue;
    const mag = re[k] * re[k] + im[k] * im[k];
    const ratio = freq / fundamental;
    const nearest = Math.round(ratio);
    const isHarmonic = nearest >= 1 && Math.abs(freq - nearest * fundamental) < binHz * 3;
    if (isHarmonic) harmonic += mag;
    else alias += mag;
  }
  return 10 * Math.log10(alias / Math.max(harmonic, 1e-12));
}

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const server = await serve();
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(existsSync(executablePath) ? { executablePath } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

console.log('\n▶ アプリを起動…');
await page.goto(`http://localhost:${PORT}/synthesizer/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /スタジオを起動/ }).click();
await page.waitForSelector('.shell', { timeout: 15000 });
check('アプリが起動する', true);

// 再生してオーディオが動くことを確認
await page.waitForTimeout(300);
await page.click('#play-btn');
await page.waitForTimeout(1200);
const position = await page.textContent('#position');
check('シーケンサーが進行する', position !== '001 : 1', `位置 = ${position}`);
await page.click('#play-btn');


console.log('\n▶ ピアノロールの編集を検証…');
await page.locator('.track-row').nth(4).click(); // Bass トラック
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.__mss.sequencer.tracks.find((t) => t.id === window.__mss.sequencer.tracks[4].id).pattern.notes.length);
const canvas = page.locator('.roll-canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
await page.waitForTimeout(200);
const after = await page.evaluate(() => window.__mss.sequencer.tracks[4].pattern.notes.length);
check('ピアノロールでノートを追加できる', after === before + 1, `${before} → ${after}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
const undone = await page.evaluate(() => window.__mss.sequencer.tracks[4].pattern.notes.length);
check('Ctrl+Z で元に戻せる', undone === before, `${after} → ${undone}`);

console.log('\n▶ リアルタイム再生を録音して検証…');
await page.click('#play-btn');
await page.click('#rec-btn');
await page.waitForTimeout(2500);
const recPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#rec-btn');
const recFile = await recPromise;
const recWav = await readFile(await recFile.path());
const rec = analyzeWav(recWav);
check('リアルタイム再生が録音される', rec.seconds > 1.2, `${rec.seconds.toFixed(2)} 秒`);
check('リアルタイム再生で音が出ている', rec.rms > 0.02, `RMS=${rec.rms.toFixed(4)}`);
await page.click('#play-btn');

console.log('\n▶ オシレーター品質（エイリアスノイズ）を測定…');
const workletFile = (await readdir(join(ROOT, 'assets'))).find((f) => /^synth-processor-.*\.js$/.test(f));
if (!workletFile) throw new Error('ビルド済みの synth-processor が見つかりません');
const oscResult = await page.evaluate(async (url) => {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, sr * 1, sr);
  await ctx.audioWorklet.addModule(url);
  const patch = window.__mssBasePatch();
  patch.osc1.wave = 'sawtooth';
  patch.osc1.level = 1;
  patch.osc2.level = 0;
  patch.oscMix = 0;
  patch.sub.level = 0;
  patch.noise.level = 0;
  patch.filter = { ...patch.filter, model: 'svf', type: 'lowpass', slope: 12, cutoff: 20000, resonance: 0, drive: 0, envAmount: 0, keyTrack: 0, velAmount: 0 };
  patch.ampEnv = { attack: 0.002, decay: 0.05, sustain: 1, release: 0.05 };
  patch.fx = { drive: 0, chorus: 0, delay: 0, reverb: 0 };
  patch.volume = 0.8;
  patch.velSens = 0;
  const node = new AudioWorkletNode(ctx, 'mss-synth', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { patch, bpm: 120, events: [{ type: 'noteOn', note: 81, velocity: 1, time: 0.01 }] },
  });
  node.connect(ctx.destination);
  const buf = await ctx.startRendering();
  const ch = buf.getChannelData(0);
  // 立ち上がりを避けて 0.2 秒後から取得
  return Array.from(ch.slice(Math.floor(sr * 0.2), Math.floor(sr * 0.2) + 16384));
}, `/assets/${workletFile}`);
let oscRms = 0;
for (const v of oscResult) oscRms += v * v;
oscRms = Math.sqrt(oscRms / oscResult.length);
check('単音レンダリングが無音でない', oscRms > 0.05, `RMS=${oscRms.toFixed(3)}`);
const alias = aliasRatioDb(oscResult, 48000, 880);
check('ノコギリ波のエイリアスが十分小さい (< -35dB)', alias < -35 && Number.isFinite(alias), `${alias.toFixed(1)} dB @880Hz`);

console.log('\n▶ WAV を書き出し…');
await page.getByRole('button', { name: 'WAV書出' }).click();
await page.waitForSelector('.modal');
const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
await page.getByRole('button', { name: '書き出す' }).click();
const download = await downloadPromise;
const path = await download.path();
const wav = await readFile(path);
check('WAV がダウンロードされる', wav.length > 1000, `${(wav.length / 1024).toFixed(0)} KB`);

const a = analyzeWav(wav);
console.log('\n  解析結果:', {
  sampleRate: a.sampleRate,
  channels: a.channels,
  bits: a.bits,
  seconds: a.seconds.toFixed(2),
  peak: a.peak.toFixed(4),
  rms: a.rms.toFixed(4),
  dc: a.dc.toExponential(2),
  clippedRatio: a.clippedRatio.toExponential(2),
  silentWindows: `${a.silentWindows}/${a.totalWindows}`,
});

check('NaN / 無限大が含まれない', a.nan === 0, `${a.nan} 個`);
check('無音でない (RMS > 0.01)', a.rms > 0.01, `RMS=${a.rms.toFixed(4)}`);
// リバーブ IR はランダム生成のため実行ごとに多少ぶれる。過度なリミッティング（RMS 0.5 超）だけを弾く
check('リミッターに突っ込みすぎていない (RMS < 0.50)', a.rms < 0.5, `RMS=${a.rms.toFixed(4)} (${(20 * Math.log10(a.rms)).toFixed(1)} dBFS)`);
check('過大入力でない (peak <= 1.0)', a.peak <= 1.0001, `peak=${a.peak.toFixed(4)}`);
check('クリップがほぼ無い (<0.1%)', a.clippedRatio < 0.001, `${(a.clippedRatio * 100).toFixed(3)}%`);
check('DCオフセットが小さい (<0.01)', Math.abs(a.dc) < 0.01, `dc=${a.dc.toExponential(2)}`);
check('曲中に長い無音区間がない', a.silentWindows <= Math.ceil(a.totalWindows * 0.35), `${a.silentWindows}/${a.totalWindows}`);
check('ステレオ 24bit で書き出される', a.channels === 2 && a.bits === 24, `${a.channels}ch / ${a.bits}bit`);

console.log('\n▶ MIDI を書き出し…');
const midiPromise = page.waitForEvent('download', { timeout: 30000 });
await page.getByRole('button', { name: 'MIDI書出' }).click();
const midi = await midiPromise;
const midiData = await readFile(await midi.path());
check('MIDI がダウンロードされる', midiData.length > 40 && midiData.subarray(0, 4).toString() === 'MThd', `${midiData.length} bytes`);

check('コンソールエラーが無い', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' / '));

await browser.close();
server.close();

console.log('');
if (failures.length > 0) {
  console.error(`✗ ${failures.length} 件の検証に失敗しました: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✓ すべての音声検証に合格しました');
