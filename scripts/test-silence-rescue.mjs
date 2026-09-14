/*
 * 「音が出ていない」ことを、アプリ自身が気づけるかを確かめる。
 *
 *   npm run build && node scripts/test-silence-rescue.mjs
 *
 * きっかけは実際の詰みかけ。保存された設定のどれかが原因で無音になり、
 * 画面には何も出ず、利用者は消し方を知らないまま手詰まりになった。
 *
 * それまでの見張りは「音量つまみが 0 か」「音声が止まっていないか」の
 * 2つしか見ておらず、それ以外の理由には気づけなかった。理由を数え上げる
 * やり方には限界がある。そこで出力そのものを測る。
 *
 *   音が出ている   … 何も出さない
 *   音が出ていない … 帯を出し、押したら音の設定を初期値に戻す
 *
 * 無音は、解析ノードが必ず無音を返すようにして作る。原因が何であれ
 * 「出ていない」という一点だけを模す。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = 4324;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

/** 仕掛けのあるアプリと、音を出すために押すもの */
const APPS = [{ id: 'guitar', hit: '.chord-pad, .fb-cell' }];

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
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${!ok && detail ? `  … ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** 一度開いて、鳴らして、状態表示を読む */
async function play(app, { silent }) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();
  if (silent) {
    await page.addInitScript(() => {
      AnalyserNode.prototype.getByteTimeDomainData = function (a) { a.fill(128); };
    });
  }
  await page.goto(`http://localhost:${PORT}/${app.id}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const hit = await page.$(app.hit);
  if (hit) {
    await hit.click({ force: true });
    await page.waitForTimeout(400);
    await hit.click({ force: true });
  }
  await page.waitForTimeout(2600);
  const before = await page.evaluate(() => {
    const el = document.querySelector('.status');
    const box = el?.getBoundingClientRect();
    return {
      text: (el?.textContent || '').trim(),
      fixable: !!el?.classList.contains('fixable'),
      shown: !!box && box.width > 0 && box.height > 0,
      size: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '-',
    };
  });
  let after = null;
  if (before.fixable) {
    await page.click('.status');
    await page.waitForTimeout(700);
    after = await page.evaluate(() => (document.querySelector('.status')?.textContent || '').trim());
  }
  await ctx.close();
  return { before, after };
}

// ヘッダーの音量つまみ。Amp タブの奥にしか無かったので、
// 0 になっていても気づけなかった。いつでも見えて掴めることを確かめる
async function masterKnob(app, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 890 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${app.id}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const seen = await page.evaluate(() => {
    const wrap = document.querySelector('.master-vol');
    const range = document.querySelector('.master-vol-range');
    if (!wrap || !range) return { missing: true };
    const bw = wrap.getBoundingClientRect();
    const br = range.getBoundingClientRect();
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    return {
      shown: bw.width > 0 && bw.height > 0,
      grabbable: br.height >= 20,
      inBar: !bar || bw.right <= bar.right + 1,
      size: `${Math.round(bw.width)}x${Math.round(br.height)}`,
    };
  });
  // 0 にすると、目で分かるか
  let zero = null;
  if (!seen.missing) {
    await page.$eval('.master-vol-range', (el) => {
      el.value = '0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    zero = await page.evaluate(() => ({
      red: !!document.querySelector('.master-vol-range')?.classList.contains('is-zero'),
      status: (document.querySelector('.status')?.textContent || '').trim(),
    }));
  }
  await ctx.close();
  return { seen, zero };
}

console.log('音が出ていないことに、アプリが気づけるか\n');

for (const app of APPS) {
  const ok = await play(app, { silent: false });
  check(`${app.id}: 音が出ているときは、断りを出さない`, !ok.before.fixable, ok.before.text.slice(0, 40));

  const ng = await play(app, { silent: true });
  check(`${app.id}: 音が出ていないと気づく`, ng.before.fixable, '気づいていない');
  check(`${app.id}: その断りがスマホ幅で見えている`, ng.before.shown, ng.before.size);
  check(
    `${app.id}: 押すと設定が初期値に戻る`,
    !!ng.after && ng.after.length > 0 && ng.after !== ng.before.text,
    ng.after ? `「${ng.after.slice(0, 30)}」` : '押せなかった'
  );
}

console.log('');
for (const app of APPS) {
  for (const w of [360, 412, 1280]) {
    const { seen, zero } = await masterKnob(app, w);
    if (seen.missing) {
      check(`${app.id} ${w}px: ヘッダーに音量つまみがある`, false, '見つからない');
      continue;
    }
    check(`${app.id} ${w}px: 音量つまみが見えて、指で掴める`,
      seen.shown && seen.grabbable && seen.inBar, seen.size);
    check(`${app.id} ${w}px: 0 にすると目で分かる`,
      !!zero?.red && zero.status.length > 0, zero ? `赤=${zero.red}` : '');
  }
}

await browser.close();
server.close();
console.log('');
if (failures) {
  console.error(`${failures} 件の不合格。無音のまま詰む恐れがあります`);
  process.exit(1);
}
console.log('無音になっても、利用者が自力で戻せます');
