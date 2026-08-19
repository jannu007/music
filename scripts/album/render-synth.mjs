/**
 * 天問 (Tenmon) アルバム — シンセ・パート（ジャズコンボ：ドラム／ベース／
 * コンピング／リード）WAV 書き出しスクリプト
 *
 * synthesizer アプリの Demo UI とは完全に独立した /album/harness-synth.html を
 * ヘッドレス Chromium で開き、tenmon-01..tenmon-10 の10曲ぶんのシンセ・
 * パートをオフラインレンダリングして WAV として書き出す。
 *
 *   node scripts/album/render-synth.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const PORT = 5306;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = '/tmp/claude-0/-home-user-music/805a8a77-5c19-5b35-97cf-ece722cd1a0c/scratchpad/album-stems';

// /scratchpad/album-render-spec.md の「ロック済み構造」表（合計時間・秒）
const SPEC = {
  'tenmon-01': 180.0,
  'tenmon-02': 180.0,
  'tenmon-03': 180.0,
  'tenmon-04': 174.5,
  'tenmon-05': 182.9,
  'tenmon-06': 174.5,
  'tenmon-07': 180.9,
  'tenmon-08': 176.0,
  'tenmon-09': 182.4,
  'tenmon-10': 165.5,
};

const TRACK_IDS = Object.keys(SPEC);

function analyzeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (String.fromCharCode(...buffer.subarray(0, 4)) !== 'RIFF') throw new Error('RIFF ヘッダがありません');
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);

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
  let sumSq = 0;
  let nan = 0;

  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const p = dataOffset + (i * channels + ch) * bytesPerSample;
      let v;
      if (bits === 16) {
        v = view.getInt16(p, true) / 32768;
      } else {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getInt8(p + 2);
        v = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      }
      if (!Number.isFinite(v)) nan++;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
    }
  }

  const total = frames * channels;
  return {
    sampleRate,
    channels,
    bits,
    seconds: frames / sampleRate,
    peak,
    rms: Math.sqrt(sumSq / Math.max(1, total)),
    nan,
  };
}

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((ok, fail) => {
    const tryOnce = () => {
      fetch(url)
        .then(() => ok())
        .catch(() => {
          if (Date.now() - start > timeoutMs) fail(new Error(`vite dev server が ${timeoutMs}ms 以内に起動しませんでした`));
          else setTimeout(tryOnce, 300);
        });
    };
    tryOnce();
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`▶ vite dev server を起動… (port ${PORT})`);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let viteOutput = '';
  vite.stdout.on('data', (d) => { viteOutput += d.toString(); });
  vite.stderr.on('data', (d) => { viteOutput += d.toString(); });
  vite.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`vite dev server が終了しました (code=${code})\n${viteOutput}`);
    }
  });

  let browser;
  const results = [];
  const failures = [];

  try {
    await waitForServer(BASE_URL);
    console.log('  vite dev server 起動完了');

    const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
    browser = await chromium.launch({
      ...(existsSync(executablePath) ? { executablePath } : {}),
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });

    for (const id of TRACK_IDS) {
      console.log(`\n▶ ${id} をレンダリング中…`);
      const context = await browser.newContext();
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      page.on('pageerror', (err) => consoleErrors.push(String(err)));

      await page.goto(`${BASE_URL}/album/harness-synth.html?track=${id}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => window.__wavDone === true || typeof window.__wavError === 'string',
        undefined,
        { timeout: 240000 }
      );

      const error = await page.evaluate(() => window.__wavError ?? null);
      if (error) {
        throw new Error(`${id}: harness がエラーを報告しました:\n${error}\nconsole: ${consoleErrors.join(' / ')}`);
      }

      const base64 = await page.evaluate(() => window.__wavBase64);
      if (!base64) throw new Error(`${id}: __wavBase64 が空です`);
      const wavBuffer = Buffer.from(base64, 'base64');

      const trackDir = resolve(OUT_DIR, id);
      await mkdir(trackDir, { recursive: true });
      const outPath = resolve(trackDir, 'synth.wav');
      await writeFile(outPath, wavBuffer);

      const a = analyzeWav(wavBuffer);
      const target = SPEC[id];
      const delta = a.seconds - target;
      results.push({ id, path: outPath, target, ...a, delta });

      console.log(
        `  書き出し完了: ${outPath}\n` +
        `  seconds=${a.seconds.toFixed(3)} target=${target.toFixed(1)} delta=${delta >= 0 ? '+' : ''}${delta.toFixed(3)} ` +
        `rms=${a.rms.toFixed(4)} peak=${a.peak.toFixed(4)} sr=${a.sampleRate} ch=${a.channels} bits=${a.bits} nan=${a.nan}`
      );
      if (consoleErrors.length > 0) {
        console.log(`  (console警告/エラー: ${consoleErrors.slice(0, 3).join(' / ')})`);
      }

      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    vite.kill();
  }

  // --- 検証 ---
  for (const r of results) {
    if (Math.abs(r.delta) > 1.0) failures.push(`${r.id}: duration差分が大きい (${r.delta.toFixed(3)}s)`);
    if (r.rms < 0.01) failures.push(`${r.id}: ほぼ無音 (RMS=${r.rms.toFixed(4)})`);
    if (r.peak > 1.0) failures.push(`${r.id}: クリッピング (peak=${r.peak.toFixed(4)})`);
    if (!Number.isFinite(r.peak) || !Number.isFinite(r.rms) || r.nan > 0) failures.push(`${r.id}: NaN/非有限値を含む`);
  }

  console.log('\n=== 天問 シンセ・パート 書き出しサマリ ===');
  console.log(
    'track'.padEnd(12) +
    'seconds'.padStart(10) +
    'target'.padStart(10) +
    'delta'.padStart(10) +
    'rms'.padStart(10) +
    'peak'.padStart(10)
  );
  for (const r of results) {
    console.log(
      r.id.padEnd(12) +
      r.seconds.toFixed(3).padStart(10) +
      r.target.toFixed(1).padStart(10) +
      (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3).padStart(r.delta >= 0 ? 9 : 10) +
      r.rms.toFixed(4).padStart(10) +
      r.peak.toFixed(4).padStart(10)
    );
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} 件の検証に失敗しました:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('✓ 全10トラックが検証に合格しました');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
