/**
 * scripts/album/render-guitar.mjs
 *
 * アルバム「天問」(Tenmon) のギター・パートを、標準アプリの UI/Demo 機能を
 * 一切経由せず、単体の Vite ページ (album/harness-guitar.html) を
 * ヘッドレス Chromium で開いて WAV に書き出す。
 *
 *   node scripts/album/render-guitar.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const PORT = 5303;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_ROOT =
  '/tmp/claude-0/-home-user-music/805a8a77-5c19-5b35-97cf-ece722cd1a0c/scratchpad/album-stems';

const TRACK_IDS = Array.from({ length: 10 }, (_, i) => `tenmon-${String(i + 1).padStart(2, '0')}`);

// album-render-spec.md の「Total duration」列（秒）。実測との許容誤差 1.0s。
const EXPECTED_DURATION_SEC = {
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

// --------------------------------------------------------------------
// WAV 解析（scripts/audio-smoke.mjs の analyzeWav() を Node の Buffer 向けに
// そのまま移植したもの。24bit/16bit PCM の両方に対応）。
// --------------------------------------------------------------------
function analyzeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('RIFF ヘッダがありません');
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);

  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
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
  };
}

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((ok, fail) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status === 404) return ok();
      } catch {
        /* まだ起動していない */
      }
      if (Date.now() - started > timeoutMs) return fail(new Error(`vite dev server did not come up within ${timeoutMs}ms`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });

  console.log('▶ vite dev server を起動…');
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let viteOutput = '';
  vite.stdout.on('data', (d) => (viteOutput += d.toString()));
  vite.stderr.on('data', (d) => (viteOutput += d.toString()));
  const killVite = () => {
    if (!vite.killed) vite.kill('SIGTERM');
  };
  process.on('exit', killVite);

  try {
    await waitForServer(`${BASE_URL}/album/harness-guitar.html`);
    console.log('  vite dev server ready.');

    const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
    const browser = await chromium.launch({
      ...(existsSync(executablePath) ? { executablePath } : {}),
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });

    const results = [];
    try {
      for (const id of TRACK_IDS) {
        console.log(`\n▶ ${id} をレンダー中…`);
        const page = await browser.newPage();
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => consoleErrors.push(String(err)));

        await page.goto(`${BASE_URL}/album/harness-guitar.html?track=${id}`, {
          waitUntil: 'networkidle',
        });

        await page.waitForFunction(() => window.__wavDone === true, { timeout: 180000 });

        const error = await page.evaluate(() => window.__wavError ?? null);
        if (error) throw new Error(`harness reported error for ${id}: ${error}`);

        const base64 = await page.evaluate(() => window.__wavBase64);
        if (!base64) throw new Error(`no __wavBase64 produced for ${id}`);
        const wavBuffer = Buffer.from(base64, 'base64');

        const trackDir = resolve(OUT_ROOT, id);
        await mkdir(trackDir, { recursive: true });
        const outPath = resolve(trackDir, 'guitar.wav');
        await writeFile(outPath, wavBuffer);

        const stats = analyzeWav(wavBuffer);
        results.push({ id, outPath, stats, consoleErrors });

        await page.close();
        console.log(
          `  ok  ${id}: ${stats.seconds.toFixed(2)}s  ${stats.sampleRate}Hz  ${stats.channels}ch  ${stats.bits}bit  peak=${stats.peak.toFixed(3)}  rms=${stats.rms.toFixed(4)}`
        );
        if (consoleErrors.length) {
          console.log(`  ⚠ console errors for ${id}: ${consoleErrors.join(' | ')}`);
        }
      }
    } finally {
      await browser.close();
    }

    // ------------------------------------------------------------ サマリー
    console.log('\n=== 天問 ギター・パート レンダー結果 ===');
    console.log(
      [
        'track'.padEnd(11),
        'dur(s)'.padStart(8),
        'target(s)'.padStart(10),
        'diff'.padStart(7),
        'sr'.padStart(7),
        'ch'.padStart(3),
        'bit'.padStart(4),
        'peak'.padStart(7),
        'rms'.padStart(8),
        'nan'.padStart(5),
        'status',
      ].join(' ')
    );

    let anyFail = false;
    for (const r of results) {
      const target = EXPECTED_DURATION_SEC[r.id];
      const diff = r.stats.seconds - target;
      const problems = [];
      if (Math.abs(diff) > 1.0) problems.push(`duration off by ${diff.toFixed(2)}s`);
      if (r.stats.rms < 0.01) problems.push(`rms too low (${r.stats.rms.toFixed(4)})`);
      if (r.stats.peak > 1.0) problems.push(`peak clipping (${r.stats.peak.toFixed(3)})`);
      if (r.stats.nan > 0) problems.push(`${r.stats.nan} NaN samples`);
      if (r.consoleErrors.length) problems.push(`${r.consoleErrors.length} console error(s)`);

      const status = problems.length ? `FAIL: ${problems.join('; ')}` : 'ok';
      if (problems.length) anyFail = true;

      console.log(
        [
          r.id.padEnd(11),
          r.stats.seconds.toFixed(2).padStart(8),
          target.toFixed(1).padStart(10),
          (diff >= 0 ? '+' : '') + diff.toFixed(2).padStart(6),
          String(r.stats.sampleRate).padStart(7),
          String(r.stats.channels).padStart(3),
          String(r.stats.bits).padStart(4),
          r.stats.peak.toFixed(3).padStart(7),
          r.stats.rms.toFixed(4).padStart(8),
          String(r.stats.nan).padStart(5),
          status,
        ].join(' ')
      );
    }

    if (results.length !== TRACK_IDS.length) {
      anyFail = true;
      console.log(`\nFAIL: only rendered ${results.length}/${TRACK_IDS.length} tracks`);
    }

    console.log(`\nOutput dir: ${OUT_ROOT}/<track-id>/guitar.wav`);

    if (anyFail) {
      console.log('\n✗ One or more tracks failed verification.');
      process.exitCode = 1;
    } else {
      console.log('\n✓ All 10 tracks passed verification.');
    }
  } catch (err) {
    console.error('\nFATAL:', err);
    console.error('\n--- vite output ---\n' + viteOutput);
    process.exitCode = 1;
  } finally {
    killVite();
  }
}

main();
