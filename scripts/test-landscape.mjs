/*
 * 横向きの表示を、7本まとめて検査する。
 *
 * 縦画面向けに書いた指定が、横向きだとそのまま裏目に出ることがある。
 * よくあったのは次の2つで、どちらも画面を見ただけでは気づきにくい。
 *
 *   1. 縦に積んだ帯の合計が画面の高さを超え、**ページ全体がスクロールする**。
 *      固定していたはずの鍵盤が流れていってしまう。
 *   2. 溢れたぶんが「伸びる段」から差し引かれ、操作盤の高さが 0 になる。
 *      ツマミがまるごと消えるのに、エラーは何も出ない。
 *
 * そこで数で見張る。ページが縦横に溢れていないこと、そして
 * 操作する場所が潰れていないことを、実機でありそうな画面の大きさで確かめる。
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
const PORT = 4206;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const APPS = ['synthesizer', 'piano', 'drums', 'guitar', 'bass', 'vocal', 'sampler'];

/** 実機でよくある横向きの大きさ */
const SIZES = [
  [915, 412],
  [854, 384],
  [740, 360],
  [667, 375],
];

/** 操作する場所がこれより低いと、実質なにも触れない */
const MIN_WORK_AREA = 40;

if (!existsSync(join(ROOT, 'sampler', 'index.html'))) {
  console.error('dist がありません。先に npm run build を実行してください');
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

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) {
    console.log(` FAIL  ${name}${detail ? `  … ${detail}` : ''}`);
    failures++;
  }
}

const launch = { args: ['--autoplay-policy=no-user-gesture-required'] };
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launch.executablePath = preinstalled;
const browser = await chromium.launch(launch);

console.log('アプリ        画面      縦はみ出し  横はみ出し  操作できる高さ');
console.log('----------------------------------------------------------------');

for (const app of APPS) {
  for (const [width, height] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/${app}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2100);

    const result = await page.evaluate(() => {
      const de = document.documentElement;
      const b = document.body;
      const overY = Math.max(de.scrollHeight, b.scrollHeight) - window.innerHeight;
      const overX = Math.max(de.scrollWidth, b.scrollWidth) - window.innerWidth;

      // 操作する場所（中身を並べている本体）のうち、いちばん低いもの
      let smallest = null;
      for (const el of b.querySelectorAll('main, .main, .panel, .tab-body, .stage, .work')) {
        const q = el.getBoundingClientRect();
        if (q.width === 0) continue;
        if (smallest === null || q.height < smallest.height) {
          smallest = { name: String(el.className || el.tagName).split(' ')[0], height: Math.round(q.height) };
        }
      }
      return { overY, overX, smallest };
    });

    const area = result.smallest;
    console.log(
      app.padEnd(13),
      `${width}x${height}`.padEnd(9),
      String(result.overY > 0 ? `${result.overY}px` : '-').padEnd(11),
      String(result.overX > 0 ? `${result.overX}px` : '-').padEnd(11),
      area ? `${area.name}=${area.height}px` : '-'
    );

    const where = `${app} ${width}x${height}`;
    check(`${where}: 縦にはみ出さない`, result.overY <= 0, `${result.overY}px`);
    check(`${where}: 横にはみ出さない`, result.overX <= 0, `${result.overX}px`);
    check(
      `${where}: 操作する場所が潰れていない`,
      !area || area.height >= MIN_WORK_AREA,
      area ? `${area.name}=${area.height}px` : ''
    );
    check(`${where}: エラーが出ない`, errors.length === 0, errors.slice(0, 1).join(' '));

    await ctx.close();
  }
}

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\n7本とも、横向きで崩れません');
