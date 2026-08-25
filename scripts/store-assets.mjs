/*
 * Google Play の掲載に要る画像を、まとめて作る。
 *
 *   npm run build && node scripts/store-assets.mjs          # 7本ぶん
 *   node scripts/store-assets.mjs sampler                   # 1つだけ
 *
 * 出るもの（アプリごと・日本語と英語で1組ずつ）
 *
 *   icon-512.png           アプリアイコン        512 x 512
 *   feature-<言語>.png     フィーチャーグラフィック 1024 x 500
 *   phone-<言語>-N.png     スマホ                1080 x 1920
 *   tablet7-<言語>-N.png   7インチ               1280 x 720
 *   tablet10-<言語>-N.png  10インチ              1920 x 1080
 *
 * 大きさは Play の要件（縦横 320〜3840px、縦横比 16:9 か 9:16）に合わせてある。
 * 端末の実物ではなく Chromium で撮っているが、中身は同じ画面なので
 * 「実際の画面と違う」ことにはならない。
 *
 * 事前に `npm run build` が必要。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'store-assets');
const PORT = 4207;

/**
 * アプリごとの、撮る画面と見せ文句。
 *
 * tabs は「上から何番目の見出しを開くか」。名前ではなく番号で指すのは、
 * 日本語と英語で表示が変わるため。
 *
 * langKey は、そのアプリが表示言語を覚えている場所。
 * 既定は英語なので、日本語の画面を撮るにはここへ先に書いておく。
 */
const APPS = [
  {
    id: 'synthesizer',
    langKey: 'akatsuki-synth-lang',
    name: 'Akatsuki Synth',
    accent: '#c9a4ff',
    tabs: [0, 2, 1],
    ja: { tagline: '回路を計算でつくるシンセ', chips: ['録音素材なし', 'オフライン', '広告なし'] },
    en: { tagline: 'A synth that computes its circuits', chips: ['No samples', 'Offline', 'No ads'] },
  },
  {
    id: 'piano',
    langKey: 'aozora-piano-lang',
    name: 'Aozora Grand Piano',
    accent: '#e8c98a',
    tabs: [0, 2, 4],
    ja: { tagline: '弦の振動から鳴らすピアノ', chips: ['88鍵', '3本ペダル', 'オフライン'] },
    en: { tagline: 'A piano modelled string by string', chips: ['88 keys', '3 pedals', 'Offline'] },
  },
  {
    id: 'drums',
    langKey: 'hibiki-drums-lang',
    name: 'Hibiki Drum Machine',
    accent: '#f0a860',
    tabs: [0, 1, 4, 5],
    ja: { tagline: '打楽器をすべて合成でつくる', chips: ['16ステップ', '14トラック', 'オフライン'] },
    en: { tagline: 'Every drum synthesised on the spot', chips: ['16 steps', '14 tracks', 'Offline'] },
  },
  {
    id: 'guitar',
    langKey: 'takibi-guitar-lang',
    name: 'Takibi Guitar',
    accent: '#e09a5a',
    tabs: [0, 3, 4, 5],
    ja: { tagline: '弦をはじく物理を計算する', chips: ['コード', 'アンプ', 'オフライン'] },
    en: { tagline: 'Plucked strings, solved as physics', chips: ['Chords', 'Amps', 'Offline'] },
  },
  {
    id: 'bass',
    langKey: 'kurogane-bass-lang',
    name: 'Kurogane Bass',
    accent: '#7fb2e5',
    tabs: [0, 1, 2, 5],
    ja: { tagline: '指で弾く力まで含めて計算する', chips: ['指弾き／スラップ', 'アンプ', 'オフライン'] },
    en: { tagline: 'Down to how hard the finger pulls', chips: ['Finger / slap', 'Amps', 'Offline'] },
  },
  {
    id: 'vocal',
    langKey: 'hoshizora-vocal-lang',
    name: 'Hoshizora Vocal',
    accent: '#b9c6ff',
    tabs: [5, 0, 1, 3],
    ja: { tagline: '誰の声も録らずに歌わせる', chips: ['歌詞入力', '声質調整', 'オフライン'] },
    en: { tagline: 'A voice that belongs to no one', chips: ['Type lyrics', 'Shape the voice', 'Offline'] },
  },
  {
    id: 'sampler',
    langKey: 'yamabiko-sampler-lang',
    name: 'Yamabiko Sampler',
    accent: '#6fc7cd',
    tabs: [0, 1, 2, 3],
    ja: { tagline: '自分で録った音を、そのまま楽器に', chips: ['ゾーン割り当て', '16パッド', 'オフライン'] },
    en: { tagline: 'Turn the sounds you record into an instrument', chips: ['Zones', '16 pads', 'Offline'] },
  },
];

/** 撮る大きさ。Play の要件（16:9 か 9:16）ちょうどに合わせる */
const SHOTS = [
  { kind: 'phone', width: 360, height: 640, scale: 3, count: 4 },
  { kind: 'tablet7', width: 640, height: 360, scale: 2, count: 2 },
  { kind: 'tablet10', width: 960, height: 540, scale: 2, count: 2 },
];

/** badge は、画面の切り替えボタンに出る表記（日本語は JP と出す） */
const LANGS = [
  { id: 'ja', locale: 'ja-JP', badge: 'jp' },
  { id: 'en', locale: 'en-US', badge: 'en' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/** 見出しは言語で名前が変わるので、位置で指す */
const TAB_SELECTOR = '.tab, [role=tab], .tab-btn, nav button';

/**
 * ストア用のアイコン。
 *
 * 全面塗りの方（マスカブル）を使う。Play は角を自分で丸めるので、
 * こちらで角を落としておくと、丸めた外側に透明が残って白く見える。
 * 念のため透明も潰しておく。
 */
async function storeIcon(app) {
  const image = decodePng(await readFile(join(ROOT, 'public', app, 'icon-512-maskable.png')));
  const data = Buffer.from(image.data);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return encodePng(image.width, image.height, data);
}

/** フィーチャーグラフィックの中身。1024 x 500 ちょうどで描く */
function featureHtml(app, lang, iconDataUri) {
  const text = app[lang];
  const chips = text.chips.map((c) => `<span>${c}</span>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1024px; height: 500px; overflow: hidden;
    /*
     * 欧文と和文で別の書体に落とす。IPAGothic を先頭に置くと、
     * 英字まで等幅になって端末の画面らしくない。
     */
    font-family: 'Liberation Sans', 'DejaVu Sans', system-ui, 'IPAPGothic', 'IPAGothic',
      'Noto Sans CJK JP', sans-serif;
    color: #f2f6f8;
    background:
      radial-gradient(120% 140% at 14% 26%, ${app.accent}38, transparent 62%),
      radial-gradient(90% 120% at 92% 88%, ${app.accent}1f, transparent 60%),
      linear-gradient(126deg, #0a1014 0%, #0d1519 52%, #070c0f 100%);
  }
  .wrap { display: flex; align-items: center; gap: 56px; height: 100%; padding: 0 72px; }
  .icon { width: 268px; height: 268px; flex: 0 0 auto; border-radius: 58px;
    box-shadow: 0 26px 60px rgba(0,0,0,.55), 0 0 0 1px ${app.accent}33; }
  .name { font-size: 60px; font-weight: 700; letter-spacing: .01em; line-height: 1.1; }
  .tagline { margin-top: 18px; font-size: 27px; line-height: 1.45; color: #c3d2d8; }
  .chips { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; }
  .chips span { font-size: 20px; padding: 9px 20px; border-radius: 999px;
    border: 1px solid ${app.accent}4d; color: ${app.accent}; background: ${app.accent}12; }
  /* 右下の細い線。地の色との境目をつくって、のっぺりさせない */
  .edge { position: absolute; right: 0; top: 0; bottom: 0; width: 3px;
    background: linear-gradient(180deg, transparent, ${app.accent}66, transparent); }
</style></head><body>
  <div class="wrap">
    <img class="icon" src="${iconDataUri}" alt="">
    <div>
      <div class="name">${app.name}</div>
      <div class="tagline">${text.tagline}</div>
      <div class="chips">${chips}</div>
    </div>
  </div>
  <div class="edge"></div>
</body></html>`;
}

/** 起動の合図が要るアプリは、押してから撮る */
async function startIfNeeded(page) {
  const start = page.locator('.start-btn, button.start, button:has-text("Start")').first();
  if ((await start.count()) > 0) {
    await start.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(2200);
  }
}

async function main() {
  const only = process.argv[2];
  const targets = only ? APPS.filter((a) => a.id === only) : APPS;
  if (targets.length === 0) {
    console.error(`不明なアプリ: ${only}`);
    process.exit(1);
  }
  if (!existsSync(join(DIST, 'sampler', 'index.html'))) {
    console.error('dist がありません。先に npm run build を実行してください');
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let file = join(DIST, decodeURIComponent(url.pathname));
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

  const launch = { args: ['--autoplay-policy=no-user-gesture-required'] };
  const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  if (existsSync(preinstalled)) launch.executablePath = preinstalled;
  const browser = await chromium.launch(launch);

  let count = 0;
  for (const app of targets) {
    const dir = join(OUT, app.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const before = count;
    const icon = await storeIcon(app.id);
    await writeFile(join(dir, 'icon-512.png'), icon);
    count++;
    const iconUri = `data:image/png;base64,${icon.toString('base64')}`;

    for (const lang of LANGS) {
      // フィーチャーグラフィック
      const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
      await page.setContent(featureHtml(app, lang.id, iconUri), { waitUntil: 'load' });
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(dir, `feature-${lang.id}.png`) });
      await page.close();
      count++;

      // 画面
      for (const shot of SHOTS) {
        const ctx = await browser.newContext({
          viewport: { width: shot.width, height: shot.height },
          deviceScaleFactor: shot.scale,
          locale: lang.locale,
        });
        // 表示言語は、起動する前に決めておく。
        // あとから切り替えると、切り替え前の画面が混ざることがある
        await ctx.addInitScript(
          ([key, value]) => {
            try {
              localStorage.setItem(key, value);
            } catch {
              /* 保存できなければ既定の英語のまま */
            }
          },
          [app.langKey, lang.id]
        );
        const p = await ctx.newPage();
        await p.goto(`http://localhost:${PORT}/${app.id}/`, { waitUntil: 'networkidle' });
        await p.waitForTimeout(1600);
        await startIfNeeded(p);

        // 本当にその言語で出ているか。ボタンにはいまの言語が出ている
        const badge = p.locator('.lang-btn').first();
        if ((await badge.count()) > 0) {
          const shown = ((await badge.textContent()) ?? '').trim().toLowerCase();
          if (shown !== lang.badge) {
            throw new Error(`${app.id}: ${lang.id} で撮るはずが ${shown} で出ています`);
          }
        }

        const tabs = p.locator(TAB_SELECTOR);
        const available = await tabs.count();
        // 見出しの数だけ撮る。足りないぶんを繰り返して埋めると、
        // 同じ絵が 2 枚並ぶことになる（ストアでは水増しに見える）
        const take = Math.min(shot.count, app.tabs.length);
        for (let i = 0; i < take; i++) {
          const wanted = app.tabs[i];
          if (wanted < available) {
            await tabs.nth(wanted).click({ timeout: 2000 }).catch(() => {});
            await p.waitForTimeout(700);
          }
          await p.screenshot({ path: join(dir, `${shot.kind}-${lang.id}-${i + 1}.png`) });
          count++;
        }
        await ctx.close();
      }
    }
    console.log(`  ${app.id.padEnd(12)} 日本語・英語ぶん  (${count - before} 枚)`);
  }

  await browser.close();
  server.close();
  await writeFile(join(OUT, 'README.txt'), guide());
  console.log(`\n${count} 枚を store-assets/ に出しました`);
  console.log('Play Console のどこに貼るかは store-assets/README.txt に書いてあります');
}

function guide() {
  return `Google Play Console のどこに貼るか
====================================

アプリごとのフォルダに入っています。日本語と英語で1組ずつあります。

  icon-512.png        「アプリのアイコン」        512 x 512
  feature-ja.png      「フィーチャーグラフィック」 1024 x 500（日本語の掲載情報）
  feature-en.png      同上（英語の掲載情報）
  phone-ja-1..4.png   「スマートフォン」のスクリーンショット 1080 x 1920
  phone-en-1..4.png   同上（英語）
  tablet7-*-1..2.png  「7 インチ タブレット」    1280 x 720
  tablet10-*-1..2.png 「10 インチ タブレット」   1920 x 1080

貼る場所は
  Play Console → 対象のアプリ → 「表示」→「ストアの設定」→「メインのストアの掲載情報」

言語ごとに別々の画面があります。日本語の掲載情報には -ja を、
英語（アメリカ）の掲載情報には -en を貼ってください。

スクリーンショットはスマホぶんだけでも公開できます（2枚以上あれば足ります）。
タブレットぶんも入れると、タブレット利用者にも見つけてもらいやすくなります。

この画像は npm run build のあと
  node scripts/store-assets.mjs
で作り直せます。画面を変えたら撮り直してください。
`;
}

await main();
