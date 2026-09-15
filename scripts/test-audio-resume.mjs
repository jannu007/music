/*
 * 止まった音が、画面を叩いて戻せるかを確かめる。
 *
 *   npm run build && node scripts/test-audio-resume.mjs
 *
 * きっかけは Xperia での報告。画面にはこう出ていた。
 *
 *   Sound is paused. Tap the screen once to bring it back.
 *
 * ところが叩いても戻らない。調べると、音を起こす受け手が
 * addEventListener(..., { once: true }) で張られていて、最初の一回で
 * 外れていた。止まるのは最初の一回だけではない（電話、他アプリの音、
 * 画面ロック）。二度目からは、画面に出した案内のほうが嘘になっていた。
 *
 * Galaxy では一度も止まらなかったので、その端末では出会わなかった。
 * 端末ごとの差ではなく、止まったあとに戻せるかどうかの問題。
 *
 * ここでは原因を数えず、次の一点だけを見る。
 *
 *   止まっている → 演奏用でないところを叩く → 戻っている
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = 4327;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

/** 音を出すために押すもの。ここを押すと AudioContext ができる */
const APPS = [
  { id: 'synthesizer', hit: '#play-btn' },
  { id: 'piano', hit: '.pkey.white' },
  { id: 'drums', hit: '.play-btn' },
  { id: 'guitar', hit: '.chord-pad, .fb-cell' },
  { id: 'bass', hit: '.fret-canvas', canvas: true },
  { id: 'vocal', hit: '.primary' },
  { id: 'sampler', hit: '.key.white.mapped' },
];

if (!existsSync(DIST)) {
  console.error('dist がありません。先に npm run build を実行してください');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    let file = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(PORT, r));

const launch = { args: ['--autoplay-policy=no-user-gesture-required'] };
const pre = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(pre)) launch.executablePath = pre;
const browser = await chromium.launch(launch);

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  const mark = ok ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${label}${detail ? `  … ${detail}` : ''}`);
}

async function run(app) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();

  // できた AudioContext を捕まえておく。あとから止めて、戻るかを見るため
  await page.addInitScript(() => {
    window.__ctxs = [];
    for (const key of ['AudioContext', 'webkitAudioContext']) {
      const Original = window[key];
      if (!Original) continue;
      window[key] = class extends Original {
        constructor(...args) {
          super(...args);
          window.__ctxs.push(this);
        }
      };
    }
  });

  await page.goto(`http://localhost:${PORT}/${app.id}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // まず鳴らして、AudioContext を作らせる
  const target = page.locator(app.hit).first();
  const box = await target.boundingBox().catch(() => null);
  if (!box) { await ctx.close(); return { missing: app.hit }; }
  if (app.canvas) await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
  else await target.click({ force: true });
  await page.waitForTimeout(900);

  const started = await page.evaluate(() => window.__ctxs.map((c) => c.state));
  if (!started.includes('running')) { await ctx.close(); return { notStarted: started.join(',') || 'なし' }; }

  // 電話や他アプリの音、画面ロックで止められた状態を作る
  await page.evaluate(async () => {
    for (const c of window.__ctxs) if (c.state === 'running') await c.suspend();
  });
  await page.waitForTimeout(700);
  const paused = await page.evaluate(() => window.__ctxs.every((c) => c.state !== 'running'));

  // 案内どおり「画面を叩く」。ただし演奏用の部品は避ける。
  // 帯が出ていればそこを、無ければ画面上端の何もないところを叩く
  const spot = await page.evaluate(() => {
    const band = document.querySelector('.status.alert');
    if (band) {
      const b = band.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) {
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, what: '帯' };
      }
    }
    return { x: window.innerWidth / 2, y: 3, what: '画面上端' };
  });
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(1200);

  const back = await page.evaluate(() => window.__ctxs.some((c) => c.state === 'running'));
  await ctx.close();
  return { paused, back, what: spot.what };
}

console.log('止まった音を、画面を叩いて戻せるか\n');

for (const app of APPS) {
  const r = await run(app);
  if (r.missing) { check(`${app.id}: 鳴らすところがある`, false, r.missing); continue; }
  if (r.notStarted) { check(`${app.id}: まず音が出る`, false, `state=${r.notStarted}`); continue; }
  check(`${app.id}: 止められた状態を作れた`, r.paused);
  check(`${app.id}: ${r.what}を叩くと音が戻る`, r.back, r.back ? '' : '戻らない（案内どおりに叩いても無音のまま）');
}

await browser.close();
server.close();
console.log('');
if (failures) {
  console.log(`${failures} 件の不合格。止まったら戻せません`);
  process.exit(1);
}
console.log('止まっても、画面を叩けば戻ります');
