/*
 * ヘッダーのアプリ名が、途中で切れていないかを幅ごとに確かめる。
 *
 *   npm run build && node scripts/test-brand-fit.mjs
 *
 * 名前を長くしたとき（Takibi → Kagari、Aozora → Youkoku Grand Piano）、
 * スマホ幅でヘッダーが溢れて「Kag Guit」のように割れて切れていた。
 * 当てずっぽうで直すと別の幅で同じことが起きるので、実測する。
 *
 * 合格とするのはどちらか。
 *
 *   ・出ていない（狭すぎる幅では、いっそ出さない）
 *   ・出ていて、かつ切れていない（1行に収まり、はみ出していない）
 *
 * 「出ているが切れている」だけを落とす。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = 4323;
const APPS = ['synthesizer', 'piano', 'drums', 'guitar', 'bass', 'vocal', 'sampler'];
// 実機に多い幅と、その境目
const WIDTHS = [360, 390, 412, 480, 560, 640, 768, 1024, 1280];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

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
console.log('ヘッダーのアプリ名が切れていないか\n');
console.log('アプリ         ' + WIDTHS.map((w) => String(w).padStart(6)).join(''));
console.log('-'.repeat(13 + WIDTHS.length * 6));

for (const app of APPS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${app}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const marks = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const el = document.querySelector('.brand-text, .brand-name, .app-title');
      if (!el) return { missing: true };
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && box.width > 0;
      if (!shown) return { hidden: true };
      // 横にはみ出していないか、縦に割れていないか
      const clippedX = el.scrollWidth > el.clientWidth + 1;
      const clippedY = el.scrollHeight > el.clientHeight + 1;
      // 親（ヘッダー）からはみ出していないか
      const parent = el.closest('.topbar, .app-header, header');
      const overflow = parent ? box.right > parent.getBoundingClientRect().right + 1 : false;
      return { shown: true, clippedX, clippedY, overflow, text: el.innerText.trim() };
    }, null);

    if (r.missing) { marks.push('  --  '); continue; }
    if (r.hidden) { marks.push('  隠  '); continue; }
    const bad = r.clippedX || r.clippedY || r.overflow;
    if (bad) { failures += 1; marks.push(' 切れ '); }
    else marks.push('  ok  ');
  }
  console.log(app.padEnd(13) + marks.join(''));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n「隠」＝その幅では出していない（合格）、「切れ」＝出ているのに切れている（不合格）');
if (failures) {
  console.error(`\n${failures} 箇所で、アプリ名が切れています`);
  process.exit(1);
}
console.log('\nどの幅でも、アプリ名は切れていません');
