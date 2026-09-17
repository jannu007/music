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
  // 横向きは指板だけにしてある。上の帯も操作もアイコンも畳むので、
  // 下の並びを押す確かめ方はここでは成り立たない（別に見る）
  { w: 780, h: 360, label: '横 780', bare: true },
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
      // 「弦」だけは上に出したので、下の並びは 7 個。
      // 上の 1 個と合わせて、絵のあるボタンが 8 個あることを見る。
      //
      // 数えるのは見えているものだけ。querySelectorAll は畳んだもの
      // （display: none）も返すので、そのまま数えると横向きでも
      // 8 個あることになってしまう
      tabCount: [...document.querySelectorAll('.tabs .tab, .topbar .tab-top')]
        .filter((e) => e.getBoundingClientRect().height > 0).length,
      iconCount: [...document.querySelectorAll('.tabs .tab .tab-icon, .topbar .tab-top .tab-icon')]
        .filter((e) => e.getBoundingClientRect().height > 0).length,
      open: !!document.querySelector('.panel.is-open'),
      // 閉じているシートが場所を取っていないか
      panelVisible: (() => {
        const p = document.querySelector('.panel');
        if (!p) return null;
        return p.getBoundingClientRect().height > 1;
      })(),
    };
  });

  // アイコンを押す → 出る、もう一度押す → 引っ込む。
  // 横向きは畳んであるので、ここでは見ない（bareMode で別に見る）
  let opened = null;
  let closed = null;
  if (!screen.bare) {
    const first = page.locator('.tabs .tab').first();
    await first.click();
    await page.waitForTimeout(400);
    opened = await page.evaluate(() => !!document.querySelector('.panel.is-open'));
    await first.click();
    await page.waitForTimeout(400);
    closed = await page.evaluate(() => !document.querySelector('.panel.is-open'));
  }

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

/*
 * 24 フレットまで、指で送って本当に届くか。
 *
 * 出すだけでは届かなかった。指板には touch-action: none が掛かっていて
 * ブラウザ側の送りが殺されており、横になぞる動きはスライド（グリッサンド）
 * という演奏機能に使われていた。つまり画面には 24 まであるのに、
 * そこへ行く手立てが無かった。
 *
 * 弦の上は演奏に譲り、フレット番号の帯を送り専用にした。実物で手を
 * 持ち替えるのと同じ動きにあたる。ここでは実際に指でなぞって確かめる。
 */
async function reach() {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 890 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(page);

  /*
   * なぞる前に、指板の頭を画面の左に合わせておく。
   *
   * 前は scrollLeft = 0 に戻していたが、ヘッドを実物の比率で描くように
   * なってからは、そこはヘッドの面で、指は弦に触れていなかった。
   * ヘッドの面は触りを通すので、当然ネックごと動く（実物でもヘッドを
   * 掴んで引けば楽器は動く）。見たいのは「弦の上をなぞったとき」なので、
   * 弦が画面に出ている所から始め、そこからの動いた量を測る。
   */
  const swipe = async (selector) => {
    const start = await page.evaluate(() => {
      const sc = document.querySelector('.board-scroll');
      const fb = document.querySelector('.fretboard');
      sc.scrollLeft = fb ? fb.offsetLeft : 0;
      return Math.round(sc.scrollLeft);
    });
    const box = await page.locator(selector).first().boundingBox();
    if (!box) return null;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
    for (let x = 330; x >= 60; x -= 30) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
    return page.evaluate((from) => {
      const sc = document.querySelector('.board-scroll');
      return Math.abs(Math.round(sc.scrollLeft) - from);
    }, start);
  };

  const byStrip = await swipe('.fb-markers');
  const byString = await swipe('.fb-row');

  const touch = await page.evaluate(() => ({
    board: getComputedStyle(document.querySelector('.fretboard')).touchAction,
    row: getComputedStyle(document.querySelector('.fb-row')).touchAction,
    strip: getComputedStyle(document.querySelector('.fb-markers')).touchAction,
  }));

  /*
   * 指板の終わりまで送ったとき、24 フレットが画面の中に入るか。
   *
   * 前は「いちばん右まで送る」で見ていたが、ヘッドとボディを実物の
   * 比率で描くようになってから、いちばん右はブリッジになった。
   * 実物でも、最後のフレットの先には胴がある。見たいのは
   * 「24 フレットまで指が届くか」なので、指板の右端を画面の右端に
   * 合わせたところで確かめる。
   */
  const visible = await page.evaluate(() => {
    const sc = document.querySelector('.board-scroll');
    const fb = document.querySelector('.fretboard');
    if (!fb) return false;
    const want = fb.offsetLeft + fb.offsetWidth - sc.clientWidth;
    sc.scrollLeft = Math.min(sc.scrollWidth, Math.max(0, want));
    const last = document.querySelector('.fb-cell[data-fret="24"]');
    if (!last) return false;
    const r = last.getBoundingClientRect();
    return r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 1;
  });

  await ctx.close();
  return { byStrip, byString, touch, visible };
}

/*
 * 揺れる弦（波形）が、演奏の邪魔をせずに残っているか。
 *
 * 置き場所は二度変えている。はじめは画面の上に大きく、次は指板へ高さを
 * 譲ってかき鳴らす帯の中、いまは指板のすぐ上の帯。いちばん下では
 * 演奏中に目の端にしか入らなかったため。
 *
 * その帯は、掴んで左右になぞるとネックが動く場所も兼ねている。
 * 見るのは3つ。描く面が帯を埋めていること、弾いたときに本当に
 * 動くこと（置いてあるだけでは意味がない）、そして掴んで送れること。
 */
async function waveform() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const geo = await page.evaluate(() => {
    const c = document.querySelector('.wave-canvas');
    const bar = document.querySelector('.wave-strip');
    const board = document.querySelector('.board-scroll');
    if (!c || !bar || !board) return null;
    const r = c.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    return {
      fills: r.width > br.width - 6 && r.height > br.height - 6,
      passes: getComputedStyle(c).pointerEvents === 'none',
      // 指板の上にあること。下に戻ると、演奏中は目の端にしか入らない
      above: br.bottom <= board.getBoundingClientRect().top + 1,
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    };
  });

  const brightness = () => page.evaluate(() => {
    const c = document.querySelector('.wave-canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  });

  await page.mouse.click(5, 5);
  await page.waitForTimeout(600);
  const quiet = await brightness();
  await page.locator('.fb-cell').nth(40).click({ force: true });
  await page.waitForTimeout(160);
  const ringing = await brightness();

  // 波形の帯を掴んで、ネックが動くか
  const from = await page.evaluate(() => {
    const sc = document.querySelector('.board-scroll');
    const fb = document.querySelector('.fretboard');
    sc.scrollLeft = fb.offsetLeft;
    return Math.round(sc.scrollLeft);
  });
  const box = await page.locator('.wave-strip').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 30, y);
  await page.mouse.down();
  for (let x = box.x + box.width - 30; x >= box.x + 30; x -= 30) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await page.evaluate((start) => {
    const sc = document.querySelector('.board-scroll');
    return Math.round(sc.scrollLeft) - start;
  }, from);

  await ctx.close();
  return { geo, moved: ringing !== quiet, quiet, ringing, dragged };
}

/*
 * 「弦」だけを上に出したこと、そして音色ごとに見た目が変わることを見る。
 *
 * 音は 19 種類あるのに指板はずっと同じ木だった。ジャズのアーチトップを
 * 選んでもファズのハイゲインを選んでも同じでは、何を持っているのか
 * 分からない。実物の系統ごとに見立てを割り当てた（guitar/src/ui/looks.ts）。
 *
 * 印が付け替わるだけでは足りない。CSS が当たっていなければ見た目は
 * 変わらないので、実際に描かれている色が変わるところまで確かめる。
 */
async function looks() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // 上に出した「弦」を押すと、その設定が出るか
  const top = page.locator('.topbar .tab-top');
  const topCount = await top.count();
  if (topCount > 0) await top.click();
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => ({
    open: !!document.querySelector('.panel.is-open'),
    title: document.querySelector('.sheet-title')?.textContent ?? '',
    stillBelow: document.querySelectorAll('.tabs .tab[data-tab="string"]').length,
  }));

  // 音色を変えると、指板と地の色が実際に変わるか
  const seen = [];
  for (const id of ['steel', 'clean', 'metal', 'jazz', 'nylon']) {
    await page.selectOption('.preset-select', id);
    await page.waitForTimeout(450);
    seen.push(await page.evaluate(() => {
      const app = document.querySelector('.guitar-app');
      const fb = document.querySelector('.fretboard');
      return {
        look: app?.dataset.look ?? null,
        wood: getComputedStyle(fb).backgroundImage,
        body: getComputedStyle(app).backgroundImage,
      };
    }));
  }

  await ctx.close();
  return { topCount, opened, seen };
}

/*
 * 横に倒したときは指板だけにする。ただし戻る道は塞がない。
 *
 * 音量も設定もそこにあるので、畳みきってしまうと何もできなくなる。
 * 隅の小さなボタンひとつで戻せることを、実際に押して確かめる。
 * 「畳めた」だけを見て合格にすると、詰む作りを通してしまう。
 */
async function bareMode() {
  const ctx = await browser.newContext({ viewport: { width: 780, height: 360 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/guitar/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const measure = () => page.evaluate(() => {
    const h = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().height) : 0;
    };
    return {
      vh: window.innerHeight,
      topbar: h('.topbar'), play: h('.play-bar'), tabs: h('.tabs'),
      board: h('.board-area'), toggle: h('.chrome-toggle'),
    };
  });

  const bare = await measure();
  // 波形は畳んだ状態で見る。操作を戻したあとに見ると、戻ったものを
  // 「消えていない」と数えてしまう（一度それで落とした）
  const waveShown = await page.evaluate(() => {
    const c = document.querySelector('.wave-strip');
    return c ? c.getBoundingClientRect().height > 1 : false;
  });
  const hasToggle = (await page.locator('.chrome-toggle').count()) > 0 && bare.toggle > 0;
  if (hasToggle) await page.locator('.chrome-toggle').click();
  await page.waitForTimeout(400);
  const back = await measure();

  // ネックらしく見えるための部品が、実際に描かれているか
  const neck = await page.evaluate(() => {
    const fb = document.querySelector('.fretboard');
    const side = document.querySelector('.fb-side');
    const tex = document.querySelector('.fb-texture');

    /*
     * 木目が「縞」になっていないか。
     *
     * CSS のグラデーションで引くと等間隔の縞にしかならず、木ではなく
     * 布の柄に見える。縞なら、どの行を取っても並びが同じになる。
     * 本物の木目は行ごとに違うので、2本取って一致率を見る。
     */
    let rowMatch = 1;
    if (tex && tex.width > 8 && tex.height > 8) {
      const g = tex.getContext('2d');
      const W = tex.width;
      const H = tex.height;
      const d = g.getImageData(0, 0, W, H).data;
      const rowAt = (y) => {
        const o = [];
        for (let x = 0; x < W; x += 3) o.push(d[(y * W + x) * 4]);
        return o;
      };
      const a = rowAt(Math.round(H * 0.3));
      const b = rowAt(Math.round(H * 0.7));
      let same = 0;
      for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same += 1;
      rowMatch = same / a.length;
    }

    return {
      // ナット側を細く見せるための削り
      tapered: getComputedStyle(fb).clipPath !== 'none',
      /*
       * 送りの左端が、そのままナットであること。
       * 前はここにヘッドの面があり、開いたときに指板まで送り直していた。
       */
      startsAtNut: (() => {
        const sc = document.querySelector('.board-scroll');
        const open = document.querySelector('.fb-cell.open');
        if (!sc || !open) return false;
        sc.scrollLeft = 0;
        const r = open.getBoundingClientRect();
        return r.left >= sc.getBoundingClientRect().left - 1 && r.width > 4;
      })(),
      // 側面の目印
      sideDots: document.querySelectorAll('.fb-side-cell.single, .fb-side-cell.double').length,
      sideShown: side ? side.getBoundingClientRect().height > 2 : false,
      hasTexture: !!tex && tex.width > 8,
      rowMatch,

    };
  });

  await ctx.close();
  return { bare, back, hasToggle, neck, waveShown };
}

console.log('ギターが、実物のように弾ける形になっているか\n');

for (const screen of SCREENS) {
  const r = await look(screen);
  const share = r.board ? r.board.height / r.vh : 0;

  if (screen.bare) {
    // 横に倒したときは弦だけ。上の帯も操作もアイコンも畳んである
    check(`${screen.label}: 指板だけになっている`,
      r.rows === 0 && r.tabCount === 0, `上 ${r.rows}列 / アイコン ${r.tabCount}個`);
  } else {
    check(`${screen.label}: 画面上部が1列`, r.rows === 1, `${r.rows}列`);
  }
  check(`${screen.label}: 指板が画面の大半を占める`,
    share >= MIN_BOARD_SHARE, `${Math.round(share * 100)}%`);
  check(`${screen.label}: 弦が指で押さえられる間隔`,
    (r.row?.height ?? 0) >= MIN_ROW, `${Math.round(r.row?.height ?? 0)}px`);
  check(`${screen.label}: ふだんは弦だけが見えている`,
    r.open === false && r.panelVisible === false, r.open ? 'シートが出たまま' : '');
  if (!screen.bare) {
    check(`${screen.label}: 小さなアイコンが並んでいる`,
      r.tabCount >= 8 && r.iconCount === r.tabCount, `${r.iconCount}/${r.tabCount} 個`);
    check(`${screen.label}: 押すと出て、もう一度押すと引っ込む`,
      r.opened && r.closed, `出る=${r.opened} 引っ込む=${r.closed}`);
  }
  check(`${screen.label}: 24 フレットまで弾ける`,
    r.fret.max === 24, `最終フレット ${r.fret.max}`);
  check(`${screen.label}: いちばん狭いフレットも指で押さえられる`,
    r.fret.narrowest >= MIN_FRET, `${Math.round(r.fret.narrowest)}px`);
  check(`${screen.label}: 横に送れば端まで届く`,
    r.fret.scrollW > r.fret.clientW,
    `指板 ${r.fret.scrollW}px / 画面 ${r.fret.clientW}px`);
  console.log('');
}

const r = await reach();
check('フレット番号の帯を指でなぞると、ネックを移動できる',
  (r.byStrip ?? 0) > 100, `scrollLeft ${r.byStrip}px`);
check('弦の上をなぞっても移動しない（演奏の手が残っている）',
  r.byString === 0, `scrollLeft ${r.byString}px`);
check('触りの割り当てが正しい',
  r.touch.row === 'none' && r.touch.strip.includes('pan-x'),
  `弦=${r.touch.row} 帯=${r.touch.strip}`);
check('端まで送ると 24 フレットが画面に入る', r.visible === true);
console.log('');

const bm = await bareMode();
check('横向きでは、上も操作もアイコンも畳まれている',
  bm.bare.topbar === 0 && bm.bare.play === 0 && bm.bare.tabs === 0,
  `上${bm.bare.topbar} 操作${bm.bare.play} アイコン${bm.bare.tabs}`);
check('そのぶん指板が画面をほぼ埋める',
  bm.bare.board / bm.bare.vh >= 0.95, `${Math.round(bm.bare.board / bm.bare.vh * 100)}%`);
check('戻すボタンが出ている', bm.hasToggle, `${bm.bare.toggle}px`);
check('押すと操作が戻る',
  bm.back.topbar > 0 && bm.back.play > 0 && bm.back.tabs > 0,
  `上${bm.back.topbar} 操作${bm.back.play} アイコン${bm.back.tabs}`);
check('ネックがナット側で細くなっている', bm.neck.tapered);
check('側面に目印が並んでいる',
  bm.neck.sideShown && bm.neck.sideDots >= 10, `${bm.neck.sideDots} 個`);
check('木目が描かれている', bm.neck.hasTexture);
check('木目が縞になっていない（行ごとに違う）',
  bm.neck.rowMatch < 0.2, `行の一致率 ${(bm.neck.rowMatch * 100).toFixed(1)}%`);
check('横向きでは波形を出さない', bm.waveShown === false);
/*
 * ヘッドとボディを見る検査は外した。
 *
 * 一時期、指板の左右に糸巻きとブリッジを描いた面を並べていた。実物の
 * 寸法と遠近で組んだが、指板が「指で押さえられる大きさ」で決まっている
 * 以上、同じ画の中のヘッドやボディは 1mm ＝ 12px の接写になる。その
 * 大きさで見られる絵を用意できず、何度描き直しても作り物のままだった
 * ので、面ごと外してある。いまは左端がナット、右端が 24 フレット。
 */
check('指板の左端がナットで始まっている',
  bm.neck.startsAtNut === true);
console.log('');

const lk = await looks();
check('「弦」が画面上部にある', lk.topCount === 1, `${lk.topCount} 個`);
check('上の「弦」を押すと、その設定が出る',
  lk.opened.open && /String|弦/.test(lk.opened.title), `見出し=${lk.opened.title}`);
check('「弦」は下の並びから外れている', lk.opened.stillBelow === 0, `${lk.opened.stillBelow} 個`);
check('音色ごとに見立てが変わる',
  new Set(lk.seen.map((x) => x.look)).size === lk.seen.length,
  lk.seen.map((x) => x.look).join(' / '));
check('指板の木が実際に描き分けられている',
  new Set(lk.seen.map((x) => x.wood)).size === lk.seen.length,
  `${new Set(lk.seen.map((x) => x.wood)).size} 通り`);
check('画面の地も音色で変わる',
  new Set(lk.seen.map((x) => x.body)).size === lk.seen.length,
  `${new Set(lk.seen.map((x) => x.body)).size} 通り`);
console.log('');

const wave = await waveform();
check('揺れる弦の帯が、指板の上にある', wave.geo?.above === true);
check('その帯を面が埋めている', wave.geo?.fills === true, wave.geo?.size ?? 'なし');
check('その面が演奏の触りを奪っていない', wave.geo?.passes === true,
  wave.geo?.passes ? '' : 'pointer-events が none でない');
check('弾くと弦が動く', wave.moved === true, `${wave.quiet} → ${wave.ringing}`);
check('波形の帯をなぞると、ネックが動く',
  (wave.dragged ?? 0) > 100, `scrollLeft +${wave.dragged}px`);
console.log('');

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
