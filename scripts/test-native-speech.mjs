/*
 * 同梱アプリ（Android）で、音声認識が無効になっていることを確かめる。
 *
 *   node scripts/build-native.mjs vocal && node scripts/test-native-speech.mjs
 *
 * vocal の「言葉を聞き取る」は、ブラウザ内蔵の Web Speech API を使う。
 * これは端末内で完結せず、多くのブラウザが認識サーバーへ音声を送る。
 * 7本とも「ネットワークへ一切つながらない」ことを売りにしており、
 * Play のデータセーフティでも「収集も共有もしていない」と申告しているので、
 * 条件付きでも外へ音声が出る経路があると、その申告が偽りになる。
 *
 * そこで同梱版では機能を塞いでいる（vocal/src/audio/speech.ts）。
 * ここでは、塞げていることを画面の文言で確かめる。
 *
 *   Capacitor あり（＝同梱アプリ） … 「対応していません」と出る
 *   Capacitor なし（＝Web版）      … 「音声認識を使います」と出る
 *
 * 両方を見るのは、片方だけだと「そもそも Chromium が非対応なだけ」と
 * 区別が付かないため。後者が通ることで、塞いでいるのが確かに
 * この仕掛けだと言える。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = join(ROOT, 'dist-native', 'vocal');
const PORT = 4322;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

if (!existsSync(DIR)) {
  console.error('dist-native/vocal がありません。先に build-native を実行してください');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    let file = join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

// 端末の言語で日本語にも英語にもなるので、両方を見る
const SUPPORTED = [
  'ブラウザの音声認識を使います',
  "Uses your browser's speech recognition",
];
const UNSUPPORTED = [
  '音声認識に対応していません',
  'does not support speech recognition',
];
const has = (text, list) => list.some((s) => text.includes(s));

/** 画面のどこかに出ている、歌詞の付け方の説明を拾う */
// 開発コンテナでは所定の場所にある。無い環境では Playwright のものを使う
const launchOptions = { args: ['--autoplay-policy=no-user-gesture-required'] };
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launchOptions.executablePath = preinstalled;

async function hintFor({ native }) {
  const browser = await chromium.launch(launchOptions);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();
  if (native) {
    // 実機では Capacitor が WebView に橋渡しの層を差し込む。それを模す
    await page.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true, platform: 'android' };
    });
  }
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // 歌詞の付け方は「録音」の画面にある
  const tab = page.locator('button', { hasText: /^(録音|Record)$/ }).first();
  await tab.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.body.innerText);
  const speechCtor = await page.evaluate(
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
  await browser.close();
  return { text, speechCtor };
}

let failures = 0;
function check(label, ok, detail = '') {
  // 但し書きは落ちたときだけ。通ったときに出すと、成否が読み取りにくい
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${!ok && detail ? `  … ${detail}` : ''}`);
  if (!ok) failures += 1;
}

console.log('同梱アプリで、音声認識が塞がれているか\n');

const web = await hintFor({ native: false });
const app = await hintFor({ native: true });

// 前提。Chromium が最初から非対応なら、この検査は何も言えていない
check(
  'この Chromium は Web Speech API を持っている（検査の前提）',
  web.speechCtor,
  '持っていない。この前提が崩れると、下の2つは何も言えていない'
);

check(
  'Web版では、音声認識を使うと表示される',
  has(web.text, SUPPORTED),
  has(web.text, UNSUPPORTED) ? '「対応していません」と出ている' : '歌詞の付け方の説明が見つからない'
);

check(
  '同梱アプリでは、対応していないと表示される',
  has(app.text, UNSUPPORTED) && !has(app.text, SUPPORTED),
  has(app.text, SUPPORTED) ? '音声認識が使える状態のままです' : '歌詞の付け方の説明が見つからない'
);

server.close();
console.log('');
if (failures) {
  console.error(`${failures} 件の不合格。同梱アプリから音声が外へ出る恐れがあります`);
  process.exit(1);
}
console.log('同梱アプリからは、音声が外へ出ません');
