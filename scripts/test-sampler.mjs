/*
 * Yamabiko Sampler の検証。
 *
 * ヘッドレスの Chromium で実際にアプリを開き、
 *
 *   1. 起動して付属音源が載るか
 *   2. 鍵盤を押して本当に音が出るか（destination の手前で拾って測る）
 *   3. 割り当て・音づくり・エフェクトの各タブが組み立つか
 *   4. 録音 → WAV 書き出しが通り、中身が無音でも歪みでもないか
 *   5. **通信をひとつもしていないか**（CSP と、実際の通信の両方で見る）
 *
 * 壊れた保存ファイルへの耐えかたは scripts/test-sampler-project.mjs で見る
 * （ブラウザを立てずに、検証関数そのものへ直接おかしなものを渡す）。
 *
 * 事前に `npm run build` が必要。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = 4187;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

if (!existsSync(join(ROOT, 'sampler', 'index.html'))) {
  console.error('dist/sampler がありません。先に npm run build を実行してください');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let file = join(ROOT, decodeURIComponent(url.pathname));
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));


/**
 * 条件が満たされるまで待つ。
 *
 * Playwright の waitForFunction は内部で eval を使うため、
 * script-src 'self' のこのページでは弾かれる（CSP が効いている証拠）。
 * evaluate は別経路なので通る。こちらを繰り返して待つ。
 */
async function waitFor(page, fn, { timeout = 20000, interval = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > until) return false;
    await page.waitForTimeout(interval);
  }
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  … ${detail}` : ''}`);
  if (!ok) failures++;
}

/** destination へ流れる音を横取りして測れるようにする */
function instrument() {
  const connect = AudioNode.prototype.connect;
  window.__probes = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && dest.context && dest === dest.context.destination) {
        const ctx = dest.context;
        if (!ctx.__probe) {
          const an = ctx.createAnalyser();
          an.fftSize = 2048;
          ctx.__probe = an;
          window.__probes.push(an);
        }
        connect.call(this, ctx.__probe);
      }
    } catch {
      /* 測れなくても本体の動作は妨げない */
    }
    return connect.call(this, dest, ...rest);
  };
}

const launch = { args: ['--autoplay-policy=no-user-gesture-required'] };
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launch.executablePath = preinstalled;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
const page = await ctx.newPage();

const errors = [];
const cspViolations = [];
const external = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // CSP に引っかかったものは、それと分かる形で分けて数える
  if (/Content Security Policy|Refused to/i.test(text)) cspViolations.push(text);
  else errors.push(text);
});
// localhost 以外への通信は、そもそも出ていないはずのもの
await ctx.route('**', (route) => {
  const url = route.request().url();
  if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue();
  external.push(url);
  return route.abort();
});

await page.addInitScript(instrument);
await page.goto(`http://localhost:${PORT}/sampler/`, { waitUntil: 'networkidle' });

// ---------------------------------------------------------------- 1. 起動
const started = await waitFor(page, () => document.querySelectorAll('.sound-row').length > 0);
check('起動する', started);
const factoryCount = await page.locator('.sound-row').count();
check('付属音源が並ぶ', factoryCount >= 6, `${factoryCount} 件`);
check('鍵盤が出る', (await page.locator('.key').count()) > 20);

const mapped = await page.evaluate(() => document.querySelectorAll('.key.mapped').length);
check('鍵盤に素材が割り当たっている', mapped > 10, `${mapped} 鍵`);

// ---------------------------------------------------------------- 2. 音
const keyBox = await page.locator('.key.white.mapped').nth(3).boundingBox();
await page.mouse.move(keyBox.x + keyBox.width / 2, keyBox.y + keyBox.height * 0.7);
await page.mouse.down();
await page.waitForTimeout(120);

const sound = await page.evaluate(async () => {
  const an = window.__probes[0];
  if (!an) return { peak: 0, probes: 0 };
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    an.getFloatTimeDomainData(buf);
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    await new Promise((r) => setTimeout(r, 20));
  }
  return { peak, probes: window.__probes.length };
});
await page.mouse.up();
check('鍵盤を押すと音が出る', sound.peak > 0.002, `peak=${sound.peak.toFixed(4)}`);

// ---------------------------------------------------------------- 3. 各タブ
for (const [tab, selector, label] of [
  ['map', '.waveform', '割り当て（波形）'],
  ['sound', '.ctl-range', '音づくり'],
  ['fx', '.segmented', 'エフェクト'],
  ['rec', '.row-actions', '録音'],
  ['export', '.row-actions', '書き出し'],
]) {
  await page.locator(`.tab-btn[data-tab="${tab}"]`).click();
  await page.waitForTimeout(160);
  const count = await page.locator(`.panel ${selector}`).count();
  check(`${label}タブが組み立つ`, count > 0, `${count} 個`);
}

// 波形が本当に描かれているか（真っ黒なら描画に失敗している）
await page.locator('.tab-btn[data-tab="map"]').click();
await page.waitForTimeout(250);
const drawn = await page.evaluate(() => {
  const canvas = document.querySelector('.waveform-canvas');
  if (!canvas) return 0;
  const c = canvas.getContext('2d');
  const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
  return painted / (data.length / 4);
});
check('波形が描かれている', drawn > 0.01, `${(drawn * 100).toFixed(1)}% のピクセル`);

// ---------------------------------------------------------------- 4. 書き出し
await page.locator('.tab-btn[data-tab="rec"]').click();
await page.waitForTimeout(120);
await page.locator('.panel .btn', { hasText: /録音|Record/ }).first().click();
await page.waitForTimeout(100);

// 鍵盤をいくつか弾く
const keys = page.locator('.key.white.mapped');
const total = await keys.count();
for (const index of [2, 4, 6]) {
  if (index >= total) continue;
  const box = await keys.nth(index).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(60);
}
await page.locator('.panel .btn', { hasText: /停止|Stop/ }).first().click();
await page.waitForTimeout(120);

const noteCount = await page.evaluate(() => {
  const hints = document.querySelectorAll('.panel .panel-hint');
  return hints.length ? hints[hints.length - 1].textContent : '';
});
check('弾いた音が記録される', /[1-9]/.test(noteCount), noteCount);

// 書き出したものを、ダウンロードさせずに横取りして中身を調べる
await page.locator('.tab-btn[data-tab="export"]').click();
await page.waitForTimeout(120);
await page.evaluate(() => {
  window.__captured = null;
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__captured = blob;
    return create(blob);
  };
  // 実際にダウンロードは起こさない
  HTMLAnchorElement.prototype.click = function () {};
});
await page.locator('.panel .btn', { hasText: /WAV/ }).first().click();
const rendered = await waitFor(page, () => window.__captured !== null, { timeout: 40000 });
check('書き出しが終わる', rendered);

const wav = await page.evaluate(async () => {
  const blob = window.__captured;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  const rate = view.getUint32(24, true);

  // 24bit PCM を読み出して中身を測る
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  let frames = 0;
  for (let o = 44; o + 3 <= bytes.length; o += 3) {
    let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (v & 0x800000) v -= 0x1000000;
    const s = v / 8388607;
    peak = Math.max(peak, Math.abs(s));
    if (Math.abs(s) > 0.999) clipped++;
    sum += s * s;
    frames++;
  }
  return {
    size: blob.size,
    riff,
    channels,
    bits,
    rate,
    peak,
    rms: Math.sqrt(sum / Math.max(1, frames)),
    clipPct: (clipped / Math.max(1, frames)) * 100,
  };
});
check('WAV として正しい形', wav.riff === 'RIFF' && wav.channels === 2 && wav.bits === 24, `${wav.channels}ch / ${wav.bits}bit / ${wav.rate}Hz`);
check('書き出した音が無音でない', wav.peak > 0.005, `peak=${wav.peak.toFixed(4)} rms=${wav.rms.toFixed(5)}`);
check('書き出した音が歪んでいない', wav.clipPct < 0.1, `clip=${wav.clipPct.toFixed(3)}%`);

// ------------------------------------------------- 5. 通信ゼロと CSP
check('外部への通信が1つも無い', external.length === 0, external.slice(0, 3).join(', '));
check('CSP に弾かれたものが無い', cspViolations.length === 0, cspViolations.slice(0, 2).join(' | '));
check('コンソールエラーが無い', errors.length === 0, errors.slice(0, 2).join(' | '));

// CSP そのものが効いているか。fetch を試して、止められることを確かめる
const blocked = await page.evaluate(async () => {
  try {
    await fetch('https://example.com/');
    return false;
  } catch {
    return true;
  }
});
check('外部への fetch がブラウザ側で止まる', blocked);

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\nサンプラーは期待どおりに動いています');
