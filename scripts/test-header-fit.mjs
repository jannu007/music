/*
 * ヘッダーの部品が、どれも切れずに収まっているかを確かめる。
 *
 *   npm run build && node scripts/test-header-fit.mjs
 *
 * これまでヘッダーを見る検査は2つあったが、どちらも一部しか見ていなかった。
 *
 *   test-brand-fit.mjs      … アプリ名が切れていないか
 *   test-silence-rescue.mjs … 音量つまみが見えて掴めるか
 *
 * そのため、音量つまみを足してヘッダーが入りきらなくなったとき、
 * どちらも素通りした。実機ではこう見えていた。
 *
 *   ・ロゴが 0 幅に潰れて、その上に選択欄が重なる
 *   ・楽器名が「azz Archtop」と頭を欠く
 *   ・右端の EN・録音・ヘルプが画面の外
 *
 * 部品をひとつずつ見るのをやめ、ヘッダー全体で次の3つを見る。
 *
 *   1. ヘッダーそのものが横にはみ出していないか
 *   2. 部品が枠の外に出ていないか
 *   3. 部品の中身が切れていないか（潰れて 0 幅になったものを含む）
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = 4328;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

const APPS = ['synthesizer', 'piano', 'drums', 'guitar', 'bass', 'vocal', 'sampler'];
/** 手にする端末の幅。いちばん狭いものから、よくある大きさまで */
const WIDTHS = [360, 390, 412, 480];

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

async function look(app, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${app}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const found = await page.evaluate(() => {
    const bar = document.querySelector('.topbar, .app-header, .header');
    if (!bar) return { missing: true };
    const b = bar.getBoundingClientRect();
    const bad = [];

    // 横スクロールする作りのヘッダー（シンセ）は、枠より広くて構わない。
    // 指で流して届くので、はみ出し自体は不具合ではない。
    // ただし潰れや文字切れは、流しても直らないので別途見る
    const scrollable = ['auto', 'scroll'].includes(getComputedStyle(bar).overflowX);

    // ヘッダーそのものが横に溢れていないか
    const overflow = bar.scrollWidth - bar.clientWidth;
    if (!scrollable && overflow > 1) bad.push(`ヘッダーが ${overflow}px はみ出し`);

    const name = (el) => (typeof el.className === 'string' && el.className) || el.tagName.toLowerCase();

    for (const el of bar.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // 中身があるのに 0 幅に潰れている＝押し潰されて消えている。
      // ただし音量メーターの棒のように、中身を持たず幅そのものが表示の
      // 飾りは、音が無いとき 0 幅が正しい姿なので数えない
      const shows = el.textContent.trim() !== '' || el.children.length > 0;
      if (r.width < 1 && el.scrollWidth > 1 && shows) {
        bad.push(`${name(el)} が 0 幅に潰れている（中身 ${el.scrollWidth}px）`);
        continue;
      }
      if (r.width < 1 || r.height < 1) continue;
      // 枠の外に出ていないか
      if (!scrollable && (r.left < b.left - 1 || r.right > b.right + 1)) {
        bad.push(`${name(el)} が枠の外（${Math.round(r.left)}..${Math.round(r.right)} / 枠 ${Math.round(b.left)}..${Math.round(b.right)}）`);
        continue;
      }
      // 中身が切れていないか。select は自前で省略しないので、
      // 入りきらなければそのまま頭や尻が欠ける
      if (el.scrollWidth > el.clientWidth + 1 && el.children.length === 0) {
        bad.push(`${name(el)} の中身が切れている（${el.scrollWidth}>${el.clientWidth}）`);
      }
    }
    return { bad };
  });

  await ctx.close();
  return found;
}

console.log('ヘッダーの部品が、切れずに収まっているか\n');

for (const app of APPS) {
  for (const w of WIDTHS) {
    const r = await look(app, w);
    if (r.missing) {
      failures += 1;
      console.log(` FAIL  ${app} ${w}px: ヘッダーが見つからない`);
      continue;
    }
    if (r.bad.length === 0) {
      console.log(`  ok   ${app} ${w}px`);
    } else {
      failures += r.bad.length;
      for (const why of r.bad) console.log(` FAIL  ${app} ${w}px: ${why}`);
    }
  }
}

await browser.close();
server.close();
console.log('');
if (failures) {
  console.log(`${failures} 件の不合格。スマホでヘッダーが崩れます`);
  process.exit(1);
}
console.log('どの幅でも、ヘッダーは切れずに収まっています');
