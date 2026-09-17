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

/* 音量つまみは 7 本すべてに付けた。奥に隠れていると、0 のまま詰む */
const KNOB_APPS = ['synthesizer', 'piano', 'drums', 'guitar', 'bass', 'vocal', 'sampler'];

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

  // 先に音を起こしておく。起こしていないと、あとで帯を押したときに
  // 初期化のほうが走り、その後始末が帯を消してしまう。それでは
  // 「押したから消えた」のか「初期化のついでに消えた」のか区別できない
  await page.mouse.click(5, 5);
  await page.waitForTimeout(1400);

  /*
   * 畳んだ形（.is-compact）のアプリでは、溝はアイコンを押すと下に出る。
   * 上に並べる物が増えて、溝の 86px が隣の音色名を押し出したため。
   * 畳んであっても「見えて、掴める」ことは変わらないので、押してから測る。
   */
  await page.evaluate(() => {
    const toggle = document.querySelector('.mv-wrap.is-compact .mv-toggle');
    if (toggle) toggle.click();
  });
  await page.waitForTimeout(200);

  const seen = await page.evaluate(() => {
    const wrap = document.querySelector('.mv-wrap');
    const range = document.querySelector('.mv-range');
    if (!wrap || !range) return { missing: true };
    const compact = wrap.classList.contains('is-compact');
    // 畳んだ形では、上に出ているのはアイコン。そこが指で押せる大きさか
    const hit = compact
      ? wrap.querySelector('.mv-toggle')?.getBoundingClientRect()
      : null;
    const bw = wrap.getBoundingClientRect();
    const br = range.getBoundingClientRect();
    const bar = document.querySelector('.topbar, .app-header, header')?.getBoundingClientRect();
    return {
      shown: bw.width > 0 && bw.height > 0,
      grabbable: br.height >= 20 && (!compact || (hit && hit.height >= 34)),
      inBar: !bar || bw.right <= bar.right + 1,
      // 狭い画面では見出しが横に流れるものがある。開いた時点で
      // 画面の中にいなければ、探さないと届かないのと同じ
      inView: bw.left >= -1 && bw.right <= window.innerWidth + 1,
      // 見出しの一行目にあること。二行目三行目に積まれると、
      // 画面には入っていても、他の部品に埋もれて目に入らない
      firstRow: !bar || bw.top <= bar.top + bw.height + 8,
      size: `${Math.round(bw.width)}x${Math.round(br.height)}`,
    };
  });
  // 0 にすると、目で分かるか
  let zero = null;
  if (!seen.missing) {
    await page.$eval('.mv-range', (el) => {
      el.value = '0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    zero = await page.evaluate(() => {
      const band = document.querySelector('.status.alert')?.getBoundingClientRect();
      const knob = document.querySelector('.mv-wrap')?.getBoundingClientRect();
      // 帯は画面の上に貼り付く。つまみに重なっていると、音が出ない理由に
      // いちばん近い道具が、いちばん要るときに隠れてしまう
      const covered = !!band && !!knob
        && !(knob.right <= band.left || knob.left >= band.right
             || knob.bottom <= band.top || knob.top >= band.bottom);
      // 畳んだ形では、赤くなるのはアイコンを囲う枠のほう
      return {
        red: !!document.querySelector('.mv-range')?.classList.contains('is-zero')
          && !!document.querySelector('.mv-wrap')?.classList.contains('is-zero'),
        status: (document.querySelector('.status')?.textContent || '').trim(),
        band: !!band,
        covered,
        where: band ? `帯 ${Math.round(band.top)}-${Math.round(band.bottom)} / つまみ ${Math.round(knob.top)}-${Math.round(knob.bottom)}` : '帯なし',
      };
    });
  }
  // 出した断りが、押したら消えるか。消せない帯が貼り付いたままだと、
  // 直せないうえに邪魔になる（実機でそう言われた）
  let dismissed = null;
  if (zero?.band) {
    const box = await page.evaluate(() => {
      const b = document.querySelector('.status.alert')?.getBoundingClientRect();
      return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
    });
    if (box) {
      await page.mouse.click(box.x, box.y);
      await page.waitForTimeout(600);
      dismissed = await page.evaluate(() => !document.querySelector('.status.alert'));
    }
  }

  await ctx.close();
  return { seen, zero, dismissed };
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
for (const id of KNOB_APPS) {
  for (const w of [360, 412, 1280]) {
    const { seen, zero, dismissed } = await masterKnob({ id }, w);
    if (seen.missing) {
      check(`${id} ${w}px: ヘッダーに音量つまみがある`, false, '見つからない');
      continue;
    }
    check(`${id} ${w}px: 音量つまみが見えて、指で掴める`,
      seen.shown && seen.grabbable && seen.inBar && seen.inView && seen.firstRow,
      `${seen.size}${seen.inView ? '' : ' / 画面の外'}${seen.firstRow ? '' : ' / 一行目にない'}`);
    check(`${id} ${w}px: 0 にすると目で分かる`, !!zero?.red, zero ? `赤=${zero.red}` : '');
    // 帯を出すアプリだけ見る。出さないアプリに重なりようはない
    if (zero?.band) {
      check(`${id} ${w}px: 断りの帯が音量つまみを隠していない`, !zero.covered, zero.where);
      check(`${id} ${w}px: 帯を押すと消える`, dismissed === true,
        dismissed === true ? '' : '押しても消えない');
    }
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
