/*
 * ギターが「実物のように弾ける」形になっているかを確かめる。
 *
 *   npm run build && node scripts/test-guitar-stage.mjs
 *
 * 言われたことは2つだった。
 *
 *   画面上部を2列にしないでください
 *   画面いっぱいに弦を表示して、他のエフェクトなどは
 *   小さいアイコンをタップすると表示されるように
 *
 * この2つは同じことの裏表で、ヘッダーに物を並べたから入りきらなくなり、
 * 折り返して2列になり、そのぶん弦が痩せていた。並べるのをやめ、
 * 主役を指板ひとつに絞った。ここではその結果だけを見る。
 *
 *   1. ヘッダーが1列で収まっている
 *   2. 指板が画面の大半を占めている
 *   3. ふだんシートは閉じていて、弦だけが見えている
 *   4. アイコンを押すとシートが出て、もう一度押すと引っ込む
 *   5. 弦の間隔が、指で押さえられる大きさある
 *   6. 24 フレットまで出ていて、横に送れば端まで届く
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = 4329;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

/** 縦持ち2つと、勧めている横持ち */
const SCREENS = [
  { w: 360, h: 780, label: '縦 360' },
  { w: 412, h: 890, label: '縦 412' },
  { w: 780, h: 360, label: '横 780' },
];

/** 指板が画面に占める割合の下限。これを割ると「いっぱい」とは言えない */
const MIN_BOARD_SHARE = 0.6;
/** 弦の間隔の下限。指の幅はおよそ 10mm なので、それより極端に狭くしない */
const MIN_ROW = 24;
/** いちばん狭いフレットに残す幅。ここを割ると押さえ分けられない */
const MIN_FRET = 20;

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
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  … ${detail}` : ''}`);
}

async function look(screen) {
  const ctx = await browser.newContext({ viewport: { width: screen.w, height: screen.h } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const at_rest = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    const bar = document.querySelector('.topbar');
    // 行数は「縦に重なっているか」で数える。部品ごとに高さが違うので、
    // 上端の値だけを見ると、同じ行でも別行に見えてしまう
    let rows = 0;
    if (bar) {
      const boxes = [...bar.children]
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .sort((a, b) => a.top - b.top);
      let bottom = -Infinity;
      for (const r of boxes) {
        if (r.top >= bottom - 1) { rows += 1; bottom = r.bottom; } else { bottom = Math.max(bottom, r.bottom); }
      }
    }
    return {
      vh: window.innerHeight,
      rows,
      board: box('.board-area'),
      row: box('.fb-row'),
      // 24 フレットまで出ていて、横に送れば届くか。
      // かつては狭い画面で 7 フレットまで減らしていたので、
      // 高い音にそもそも手が届かなかった
      fret: (() => {
        const cells = document.querySelectorAll('.fb-row[data-string="0"] .fb-cell');
        const last = cells[cells.length - 1];
        const scroll = document.querySelector('.board-scroll');
        return {
          max: last ? Number(last.dataset.fret) : -1,
          narrowest: last ? last.getBoundingClientRect().width : 0,
          scrollW: scroll ? scroll.scrollWidth : 0,
          clientW: scroll ? scroll.clientWidth : 0,
        };
      })(),
      tabCount: document.querySelectorAll('.tabs .tab').length,
      iconCount: document.querySelectorAll('.tabs .tab .tab-icon').length,
      open: !!document.querySelector('.panel.is-open'),
      // 閉じているシートが場所を取っていないか
      panelVisible: (() => {
        const p = document.querySelector('.panel');
        if (!p) return null;
        return p.getBoundingClientRect().height > 1;
      })(),
    };
  });

  // アイコンを押す → 出る、もう一度押す → 引っ込む
  const first = page.locator('.tabs .tab').first();
  await first.click();
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => !!document.querySelector('.panel.is-open'));
  await first.click();
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => !document.querySelector('.panel.is-open'));

  await ctx.close();
  return { ...at_rest, opened, closed };
}

/*
 * すでに遊んだことのある端末には、こちらが勝手に押し込んだ 7 という値が
 * 保存されている。そのまま読むと、直したのに高い音へ届かないままになる。
 * 一度だけ引き上げること、そのあとは利用者が選んだ数を尊重することを見る。
 */
async function migration() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();
  // 古い端末の状態を仕込む
  await page.addInitScript(() => {
    localStorage.setItem('kagari-guitar-v1', JSON.stringify({
      ui: { fretCount: 7, presetId: 'clean', labelMode: 'note', progression: [] },
    }));
  });
  await page.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const raised = await page.evaluate(() => {
    const cells = document.querySelectorAll('.fb-row[data-string="0"] .fb-cell');
    return cells.length ? Number(cells[cells.length - 1].dataset.fret) : -1;
  });

  // 利用者が自分で 12 を選んだ状態にする。
  // 同じページを読み直すと仕込みが入り直してしまうので、
  // 仕込みの無い新しいページで見る（保存は文脈ごとに残る）
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('kagari-guitar-v1'));
    d.ui.fretCount = 12;
    localStorage.setItem('kagari-guitar-v1', JSON.stringify(d));
  });
  const page2 = await ctx.newPage();
  await page2.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page2.waitForTimeout(900);
  const kept = await page2.evaluate(() => {
    const cells = document.querySelectorAll('.fb-row[data-string="0"] .fb-cell');
    return cells.length ? Number(cells[cells.length - 1].dataset.fret) : -1;
  });

  await ctx.close();
  return { raised, kept };
}

console.log('ギターが、実物のように弾ける形になっているか\n');

for (const screen of SCREENS) {
  const r = await look(screen);
  const share = r.board ? r.board.height / r.vh : 0;

  check(`${screen.label}: 画面上部が1列`, r.rows === 1, `${r.rows}列`);
  check(`${screen.label}: 指板が画面の大半を占める`,
    share >= MIN_BOARD_SHARE, `${Math.round(share * 100)}%`);
  check(`${screen.label}: 弦が指で押さえられる間隔`,
    (r.row?.height ?? 0) >= MIN_ROW, `${Math.round(r.row?.height ?? 0)}px`);
  check(`${screen.label}: ふだんは弦だけが見えている`,
    r.open === false && r.panelVisible === false, r.open ? 'シートが出たまま' : '');
  check(`${screen.label}: 小さなアイコンが並んでいる`,
    r.tabCount >= 8 && r.iconCount === r.tabCount, `${r.iconCount}/${r.tabCount} 個`);
  check(`${screen.label}: 押すと出て、もう一度押すと引っ込む`,
    r.opened && r.closed, `出る=${r.opened} 引っ込む=${r.closed}`);
  check(`${screen.label}: 24 フレットまで弾ける`,
    r.fret.max === 24, `最終フレット ${r.fret.max}`);
  check(`${screen.label}: いちばん狭いフレットも指で押さえられる`,
    r.fret.narrowest >= MIN_FRET, `${Math.round(r.fret.narrowest)}px`);
  check(`${screen.label}: 横に送れば端まで届く`,
    r.fret.scrollW > r.fret.clientW,
    `指板 ${r.fret.scrollW}px / 画面 ${r.fret.clientW}px`);
  console.log('');
}

const mig = await migration();
check('前から使っている端末でも 24 まで届く', mig.raised === 24, `最終フレット ${mig.raised}`);
check('そのあと自分で選んだ数は尊重される', mig.kept === 12, `最終フレット ${mig.kept}`);

await browser.close();
server.close();
if (failures) {
  console.log(`${failures} 件の不合格。指板が主役になっていません`);
  process.exit(1);
}
console.log('指板が主役で、ほかはアイコンの中にしまわれています');
