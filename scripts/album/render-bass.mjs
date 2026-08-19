/**
 * Album "Tenmon" — bass stem renderer.
 *
 * Starts a Vite dev server, opens album/harness-bass.html for each of the
 * 10 tracks in headless Chromium, renders the bass part offline (all 6
 * instruments are later mixed into one file per song — this script only
 * produces the bass stem), and writes one WAV per track under
 *   <scratchpad>/album-stems/tenmon-NN/bass.wav
 *
 * Does not touch bass/src. Run from the repo root:
 *   node scripts/album/render-bass.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORT = 5302;
const OUT_ROOT =
  '/tmp/claude-0/-home-user-music/805a8a77-5c19-5b35-97cf-ece722cd1a0c/scratchpad/album-stems';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

const TRACK_IDS = Array.from({ length: 10 }, (_, i) => `tenmon-${String(i + 1).padStart(2, '0')}`);

// Locked spec (album-render-spec.md) — target total duration per track, seconds.
const TARGET_DURATION_SEC = {
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

const DURATION_TOLERANCE_SEC = 1.0;
const MIN_RMS = 0.01;
const MAX_PEAK = 1.0;

// --------------------------------------------------------------- WAV parsing
// Adapted from scripts/audio-smoke.mjs's analyzeWav().
function analyzeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (String.fromCharCode(...buffer.subarray(0, 4)) !== 'RIFF') throw new Error('missing RIFF header');
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
  if (dataOffset < 0) throw new Error('missing data chunk');

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataSize / (bytesPerSample * channels));
  let peak = 0;
  let sum = 0;
  let sumSq = 0;
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
    nan,
  };
}

// ------------------------------------------------------------- dev server
function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((ok, fail) => {
    const tryOnce = () => {
      fetch(url)
        .then((res) => {
          if (res.ok || res.status === 404) ok();
          else retry();
        })
        .catch(retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) fail(new Error(`vite dev server did not come up at ${url}`));
      else setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}

async function main() {
  console.log('Starting vite dev server...');
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let viteOutput = '';
  vite.stdout.on('data', (d) => (viteOutput += d.toString()));
  vite.stderr.on('data', (d) => (viteOutput += d.toString()));

  let exitCode = 0;
  const cleanup = () => {
    if (!vite.killed) vite.kill('SIGTERM');
  };

  try {
    await waitForServer(`http://localhost:${PORT}/album/harness-bass.html`);
    console.log('vite dev server is up.\n');

    const executablePath = CHROMIUM_PATH;
    const browser = await chromium.launch({
      executablePath,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });
    const context = await browser.newContext();

    const results = [];

    for (const id of TRACK_IDS) {
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(String(err)));

      console.log(`Rendering ${id}...`);
      await page.goto(`http://localhost:${PORT}/album/harness-bass.html?track=${id}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => window.__wavDone === true, { timeout: 180000 });

      const error = await page.evaluate(() => window.__wavError ?? null);
      if (error) {
        throw new Error(`${id}: harness reported error: ${error}\nconsole: ${consoleErrors.join(' | ')}`);
      }

      const base64 = await page.evaluate(() => window.__wavBase64);
      const buf = Buffer.from(base64, 'base64');

      const outDir = resolve(OUT_ROOT, id);
      const outFile = resolve(outDir, 'bass.wav');
      await mkdir(dirname(outFile), { recursive: true });
      await writeFile(outFile, buf);

      const analysis = analyzeWav(buf);
      results.push({ id, outFile, analysis, consoleErrors });
      console.log(
        `  -> ${outFile} (${(buf.length / 1024 / 1024).toFixed(2)} MB, ${analysis.seconds.toFixed(2)}s)`
      );
      if (consoleErrors.length > 0) {
        console.log(`  console errors for ${id}:`);
        for (const e of consoleErrors) console.log(`    ${e}`);
      }
      await page.close();
    }

    await browser.close();

    // --------------------------------------------------------- report
    console.log('\n=== Bass stem render summary ===\n');
    const header = [
      'track',
      'sr',
      'ch',
      'bit',
      'duration(s)',
      'target(s)',
      'delta(s)',
      'peak',
      'rms',
      'nan',
      'status',
    ];
    const rows = [];
    const failures = [];

    for (const r of results) {
      const { id, analysis } = r;
      const target = TARGET_DURATION_SEC[id];
      const delta = analysis.seconds - target;
      const problems = [];
      if (Math.abs(delta) > DURATION_TOLERANCE_SEC) problems.push('duration off');
      if (analysis.rms < MIN_RMS) problems.push('rms too low');
      if (analysis.peak > MAX_PEAK) problems.push('peak clipping');
      if (analysis.nan > 0) problems.push('NaN present');
      if (r.consoleErrors.length > 0) problems.push('console errors');
      const status = problems.length === 0 ? 'PASS' : `FAIL (${problems.join(', ')})`;
      if (problems.length > 0) failures.push(`${id}: ${problems.join(', ')}`);

      rows.push([
        id,
        String(analysis.sampleRate),
        String(analysis.channels),
        String(analysis.bits),
        analysis.seconds.toFixed(2),
        target.toFixed(1),
        (delta >= 0 ? '+' : '') + delta.toFixed(2),
        analysis.peak.toFixed(4),
        analysis.rms.toFixed(4),
        String(analysis.nan),
        status,
      ]);
    }

    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const fmt = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
    console.log(fmt(header));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const row of rows) console.log(fmt(row));

    if (failures.length > 0) {
      console.log(`\n${failures.length} track(s) FAILED verification:`);
      for (const f of failures) console.log(`  - ${f}`);
      exitCode = 1;
    } else {
      console.log('\nAll 10 tracks passed verification.');
    }
  } catch (err) {
    console.error('\nFATAL:', err);
    console.error('\n--- vite output ---\n' + viteOutput);
    exitCode = 1;
  } finally {
    cleanup();
  }

  process.exit(exitCode);
}

main();
