/*
 * 収録デモの検査。
 *
 * 記譜は文字列なので、書き間違えても型では気づけない。ここでは
 *
 *   1. すべてのトークンが音として読めたか（読み飛ばされた音が無いか）
 *   2. 音数・長さ・音域が、聞ける範囲に収まっているか
 *   3. 指している付属音源が実在するか
 *   4. 実際にオフラインで鳴らして、無音でも歪みでもないか
 *
 * を確かめる。4 はブラウザが要るので、Playwright で走らせる。
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  … ${detail}` : ''}`);
  if (!ok) failures++;
}

const tmp = await mkdtemp(join(tmpdir(), 'demo-test-'));
try {
  // ------------------------------------------------------- 1〜3. 記譜の検査
  const demoOut = join(tmp, 'demos.mjs');
  await build({
    entryPoints: [join(ROOT, 'sampler/src/data/demos.ts')],
    outfile: demoOut,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
  });
  const { DEMO_SONGS, buildDemo } = await import(pathToFileURL(demoOut).href);

  const factoryOut = join(tmp, 'factory.mjs');
  await build({
    entryPoints: [join(ROOT, 'sampler/src/audio/factory.ts')],
    outfile: factoryOut,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
  });
  const { FACTORY_IDS } = await import(pathToFileURL(factoryOut).href);

  check('10曲ある', DEMO_SONGS.length === 10, `${DEMO_SONGS.length} 曲`);
  const ids = new Set(DEMO_SONGS.map((d) => d.id));
  check('id が重複していない', ids.size === DEMO_SONGS.length);

  console.log('\n曲            音源           音数  長さ    音域        使用音源');
  console.log('-------------------------------------------------------------------');
  for (const demo of DEMO_SONGS) {
    const events = buildDemo(demo);
    const notes = events.map((e) => e.note);
    const lo = Math.min(...notes);
    const hi = Math.max(...notes);
    const end = Math.max(...events.map((e) => e.time + (e.duration ?? 0)));
    console.log(
      `${demo.id.padEnd(13)} ${demo.instrument.padEnd(14)} ${String(events.length).padStart(3)}  ${end.toFixed(1)}s`.padEnd(48) +
        `${lo}–${hi}`.padEnd(12) +
        (FACTORY_IDS.includes(demo.instrument) ? 'ok' : '見つからない')
    );

    check(`${demo.id}: 音源が実在する`, FACTORY_IDS.includes(demo.instrument), demo.instrument);
    check(`${demo.id}: 音が入っている`, events.length >= 8, `${events.length} 音`);
    check(`${demo.id}: 長さが妥当`, end > 3 && end < 90, `${end.toFixed(1)}s`);
    check(`${demo.id}: 音域が鍵盤に収まる`, lo >= 12 && hi <= 108, `${lo}–${hi}`);
    check(
      `${demo.id}: 強さが範囲内`,
      events.every((e) => e.velocity >= 1 && e.velocity <= 127)
    );
    check(
      `${demo.id}: 長さが正`,
      events.every((e) => (e.duration ?? 0) > 0)
    );

    // 書き間違いを拾う。読めなかったトークンがあれば、その音は消えている
    const perPass = demo.lanes.reduce((sum, lane) => {
      const tokens = lane.steps.replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
      return sum + tokens.filter((tk) => tk !== '.' && tk !== '-').reduce((n, tk) => n + tk.split('+').length, 0);
    }, 0);
    const written = perPass * Math.max(1, demo.repeats ?? 1);
    check(`${demo.id}: 書いた音がすべて読めた`, written === events.length, `記譜 ${written} / 生成 ${events.length}`);
  }

  // ------------------------------------------------------------ 4. 実際に鳴らす
  const entry = join(tmp, 'render-entry.ts');
  await writeFile(
    entry,
    `
import { DEMO_SONGS, buildDemo } from ${JSON.stringify(join(ROOT, 'sampler/src/data/demos.ts'))};
import { buildFactory } from ${JSON.stringify(join(ROOT, 'sampler/src/audio/factory.ts'))};
import { renderPerformance } from ${JSON.stringify(join(ROOT, 'sampler/src/audio/recorder.ts'))};
import { decodeInstrument } from ${JSON.stringify(join(ROOT, 'sampler/src/audio/project.ts'))};

(window as any).renderDemo = async (id: string) => {
  const demo = DEMO_SONGS.find((d: any) => d.id === id);
  const rate = 48000;
  const [built] = buildFactory(rate, demo.instrument);
  const samples = new Map<string, Float32Array[]>();
  for (const s of built.samples) samples.set(s.meta.id, s.channels);

  // アプリ側と同じ手順で設定を重ねる
  const merged: any = { ...built.instrument, ...(demo.tweak ?? {}) };
  merged.fx = { ...built.instrument.fx, ...(demo.tweak?.fx ?? {}) };
  const instrument = decodeInstrument(merged);
  instrument.zones = built.instrument.zones;

  const events = buildDemo(demo);
  const end = Math.max(...events.map((e: any) => e.time + (e.duration ?? 0)));
  const buffer = await renderPerformance(events, instrument, samples, rate, end + 4);

  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  let peak = 0, sum = 0, bad = 0, clipped = 0, stereo = 0;
  for (let i = 0; i < L.length; i++) {
    const v = L[i];
    if (!Number.isFinite(v)) bad++;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sum += v * v;
    stereo += Math.abs(v - R[i]);
  }
  // 曲の途中に長い無音が無いか（音が出ていない声部の取りこぼしを拾う）
  const win = Math.floor(rate * 0.25);
  let silent = 0, windows = 0;
  for (let i = 0; i + win < L.length - rate * 3; i += win) {
    windows++;
    let m = 0;
    for (let k = i; k < i + win; k++) m = Math.max(m, Math.abs(L[k]));
    if (m < 1e-4) silent++;
  }
  return {
    peak, rms: Math.sqrt(sum / L.length), bad,
    clipPct: (clipped / L.length) * 100,
    stereo: stereo / L.length,
    silent, windows, seconds: buffer.duration,
  };
};
`
  );
  const bundle = join(tmp, 'render.js');
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'iife', target: 'es2020' });

  const opts = { args: ['--autoplay-policy=no-user-gesture-required'] };
  const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  if (existsSync(preinstalled)) opts.executablePath = preinstalled;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundle });

  console.log('\n曲            長さ    ピーク  RMS     NaN クリップ  ステレオ  無音');
  console.log('-------------------------------------------------------------------');
  for (const demo of DEMO_SONGS) {
    const r = await page.evaluate((id) => window.renderDemo(id), demo.id);
    console.log(
      demo.id.padEnd(13),
      `${r.seconds.toFixed(1)}s`.padEnd(7),
      r.peak.toFixed(3).padEnd(7),
      r.rms.toFixed(4).padEnd(7),
      String(r.bad).padEnd(3),
      `${r.clipPct.toFixed(3)}%`.padEnd(9),
      r.stereo.toFixed(4).padEnd(9),
      `${r.silent}/${r.windows}`
    );
    check(`${demo.id}: 鳴る`, r.peak > 0.02, `peak=${r.peak.toFixed(3)}`);
    check(`${demo.id}: 音が壊れていない`, r.bad === 0, `${r.bad} 個の NaN`);
    check(`${demo.id}: 歪んでいない`, r.clipPct < 0.05, `clip=${r.clipPct.toFixed(3)}%`);
    check(`${demo.id}: 小さすぎない`, r.rms > 0.004, `rms=${r.rms.toFixed(4)}`);
    check(`${demo.id}: 途中で途切れない`, r.silent / Math.max(1, r.windows) < 0.25, `${r.silent}/${r.windows}`);
  }
  check('コンソールエラーが無い', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
} finally {
  await rm(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\n収録デモは10曲とも正しく鳴ります');
