/**
 * 同梱バンドルがオフラインだけで完結しているかを検証する。
 *
 *   node scripts/build-native.mjs && node scripts/verify-native.mjs
 *
 * 各アプリを localhost から配信したうえで、**localhost 以外への通信をすべて遮断**し、
 *
 *   1. AudioWorklet が読み込めるか（端末内のファイルだけで音源が動くか）
 *   2. 実際に音が出るか
 *   3. 外部へ取りに行ったものが1つも無いか
 *   4. コンソールエラーが無いか
 *
 * を確認する。1つでも外部を参照していれば、それは Play の
 * 「ウェブ表示スパム」に逆戻りするということなので、ここで落とす。
 *
 * なお file:// ではなく http(s) で配るのは、AudioWorklet がセキュアコンテキスト
 * でしか動かないため。実機でも Capacitor が https://localhost から配る。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_APPS } from './build-native.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 4321;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

let serveRoot = '';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let file = join(serveRoot, decodeURIComponent(url.pathname));
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

/** ページ内に仕込む計測。AudioWorklet の成否と、destination への出力を拾う */
function instrument() {
  window.__wl = { ok: 0, fail: [] };
  const addModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function (url, ...rest) {
    return addModule.call(this, url, ...rest).then(
      (v) => {
        window.__wl.ok++;
        return v;
      },
      (e) => {
        window.__wl.fail.push(`${url} :: ${e}`);
        throw e;
      }
    );
  };
  const connect = AudioNode.prototype.connect;
  window.__probes = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && dest.context && dest === dest.context.destination) {
        const ctx = dest.context;
        if (!ctx.__probe) {
          const an = ctx.createAnalyser();
          an.fftSize = 2048;
          ctx.__probe = an;
          window.__probes.push(an);
        }
        connect.call(this, ctx.__probe);
      }
    } catch {
      /* 計測できなくても本体の動作は妨げない */
    }
    return connect.call(this, dest, ...rest);
  };
}

// 開発コンテナでは所定の場所にある。GitHub Actions など無い環境では
// Playwright が自分で入れたものを使わせる
const launchOptions = { args: ['--autoplay-policy=no-user-gesture-required'] };
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launchOptions.executablePath = preinstalled;
const browser = await chromium.launch(launchOptions);

console.log('アプリ         ワークレット  音    外部通信  エラー');
console.log('------------------------------------------------------');
let failures = 0;

const only = process.argv[2];
const targets = only ? NATIVE_APPS.filter((a) => a.id === only) : NATIVE_APPS;
if (targets.length === 0) {
  console.error(`不明なアプリ: ${only}`);
  process.exit(1);
}

for (const app of targets) {
  serveRoot = join(ROOT, 'dist-native', app.id);
  if (!existsSync(serveRoot)) {
    console.log(`${app.id.padEnd(13)} バンドルがありません（先に build-native を実行）`);
    failures++;
    continue;
  }

  const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // localhost 以外への通信は握りつぶす。これで「本当に手元だけで動くか」が分かる
  await ctx.route('**', (route) => {
    const url = route.request().url();
    if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue();
    external.push(url);
    return route.abort();
  });

  await page.addInitScript(instrument);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  // 付属音源を合成してから鳴らせるアプリがあるので、少し待つ
  await page.waitForTimeout(1500);

  // 音を鳴らす。
  //
  // やみくもに何度も叩くと、いちど点けたものを消してしまうアプリがある
  // （ドラムのステップなど）。そこで「1回だけ叩く」に留め、鍵盤があるアプリでは
  // 押しっぱなしにして鳴らす。短く叩くだけだと、離した後の余韻しか測れない。
  const key = await page.$('.key.white, .key, .pkey.white, .pkey, .chord-pad, .fb-cell');
  if (key) {
    const box = await key.boundingBox();
    if (box) {
      // 鍵盤は下へ行くほど強く鳴る作りなので、下寄りを押す
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
      await page.mouse.down();
    }
  } else {
    await page.mouse.click(206, 400);
  }
  // 立ち上がりを逃さないよう、待ちは短くする（撥弦は1秒で -45dB まで落ちる）
  await page.waitForTimeout(250);
  for (const key of ['a', 'z', 'q', '1']) {
    await page.keyboard.press(key).catch(() => {});
    await page.waitForTimeout(120);
  }

  const result = await page.evaluate(async () => {
    const an = window.__probes[0];
    let peak = 0;
    if (an) {
      const buf = new Float32Array(an.fftSize);
      for (let i = 0; i < 30; i++) {
        an.getFloatTimeDomainData(buf);
        for (const s of buf) peak = Math.max(peak, Math.abs(s));
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    return { wl: window.__wl, peak, secure: window.isSecureContext };
  });

  // 使わないと分かっているアプリに、あるはずのないものを求めない
  if (key) await page.mouse.up().catch(() => {});

  const workletOk = app.worklet
    ? result.wl.ok > 0 && result.wl.fail.length === 0
    : result.wl.fail.length === 0;
  const audioOk = result.peak > 0.001;
  const ok = workletOk && audioOk && external.length === 0 && errors.length === 0;
  if (!ok) failures++;

  console.log(
    app.id.padEnd(13),
    (workletOk ? (app.worklet ? `ok(${result.wl.ok})` : '不要') : 'FAIL').padEnd(13),
    (audioOk ? result.peak.toFixed(3) : '無音').padEnd(6),
    String(external.length).padEnd(9),
    errors.length ? errors.slice(0, 1).join(' ') : 'なし'
  );
  if (result.wl.fail.length) console.log('   ワークレット:', result.wl.fail);
  if (external.length) console.log('   外部参照:', [...new Set(external)].slice(0, 5));
  await ctx.close();
}

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} 個のアプリに問題があります`);
  process.exit(1);
}
console.log('\nすべてオフラインで完結し、AudioWorklet も動作しました');
