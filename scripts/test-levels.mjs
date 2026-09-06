/*
 * 7本の音量が、そろっているかを見る。
 *
 * 1本だけ小さいと、アプリを行き来したときに「壊れている」と感じる。
 * 実際、ギターだけ山が 3〜8dB 低く、そう言われた。
 * 耳で気づく前に数字で気づけるよう、ここで見張る。
 *
 * 測り方は「ふつうに数音弾く」。0.6秒おきに6音を鳴らし、その間の
 * いちばん強い山（peak）を取る。1音だけの比較では、弦1本のギターと
 * 3本ユニゾンのピアノのように、楽器の作りの差がそのまま出てしまう。
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
const PORT = 4210;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 鳴らし方。指で触って音が出るものを1つずつ。
 *
 * ドラム・シンセ・ボーカルは打ち込みを鳴らす作りで、1音ずつ弾く楽器とは
 * 比べようがないので、ここでは弾く4本だけを見る。
 */
const APPS = [
  { id: 'piano', hit: '.pkey.white', pick: (i) => i },
  { id: 'guitar', hit: '.fb-cell', pick: (i) => 20 + i * 7 },
  { id: 'bass', hit: '.fret-canvas', at: { x: 0.42, y: 0.5 } },
  { id: 'sampler', hit: '.key.white.mapped', pick: (i) => i },
];

/** この幅から外れたら、他とちぐはぐに聞こえる */
const MIN_PEAK = 0.25;
const MAX_PEAK = 0.85;
/**
 * いちばん大きいものと小さいものの差。
 *
 * 4dB にしてあるのは、直す前のギターを捕まえられる値だから。
 * あのときの差は 5.3dB で、6dB では素通りしてしまった。
 * いまは 1.8dB なので、まだ十分な余裕がある。
 */
const MAX_SPREAD_DB = 4;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) {
    console.log(` FAIL  ${name}${detail ? `  … ${detail}` : ''}`);
    failures++;
  }
}

if (!existsSync(join(ROOT, 'guitar', 'index.html'))) {
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

const launch = {};
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launch.executablePath = preinstalled;
const browser = await chromium.launch(launch);

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const measured = [];

console.log('アプリ         peak     rms      dBFS(peak)');
console.log('---------------------------------------------');

for (const app of APPS) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 890 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.6,
  });
  await ctx.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    window.__probes = [];
    AudioNode.prototype.connect = function (dest, ...rest) {
      try {
        if (dest && dest.context && dest === dest.context.destination) {
          const c = dest.context;
          if (!c.__probe) {
            const an = c.createAnalyser();
            an.fftSize = 2048;
            c.__probe = an;
            window.__probes.push(an);
          }
          connect.call(this, c.__probe);
        }
      } catch {
        /* 測れなくても本体は妨げない */
      }
      return connect.call(this, dest, ...rest);
    };
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${app.id}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);

  const items = page.locator(app.hit);
  const count = await items.count();
  if (count === 0) {
    check(`${app.id}: 弾くところがある`, false, app.hit);
    await ctx.close();
    continue;
  }

  // 測りながら弾く
  const listening = page.evaluate(async () => {
    let hi = 0;
    let acc = 0;
    let n = 0;
    for (let i = 0; i < 180; i++) {
      const an = window.__probes?.[0];
      if (an) {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        for (const s of buf) {
          hi = Math.max(hi, Math.abs(s));
          acc += s * s;
          n++;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return { hi, rms: n ? Math.sqrt(acc / n) : 0 };
  });

  for (let i = 0; i < 6; i++) {
    const index = app.pick ? app.pick(i) % count : 0;
    const box = await items.nth(index).boundingBox().catch(() => null);
    if (box) {
      if (app.at) await page.mouse.click(box.x + box.width * app.at.x, box.y + box.height * app.at.y);
      else await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.75);
    }
    await page.waitForTimeout(600);
  }

  const r = await listening;
  console.log(
    app.id.padEnd(14),
    r.hi.toFixed(4).padEnd(8),
    r.rms.toFixed(4).padEnd(8),
    `${db(r.hi).toFixed(1)} dB`
  );
  measured.push({ id: app.id, peak: r.hi });
  check(`${app.id}: 小さすぎない`, r.hi >= MIN_PEAK, `peak=${r.hi.toFixed(3)}`);
  check(`${app.id}: 大きすぎない`, r.hi <= MAX_PEAK, `peak=${r.hi.toFixed(3)}`);
  await ctx.close();
}

if (measured.length >= 2) {
  const loud = measured.reduce((a, b) => (a.peak > b.peak ? a : b));
  const soft = measured.reduce((a, b) => (a.peak < b.peak ? a : b));
  const spread = db(loud.peak) - db(soft.peak);
  console.log(`\nいちばん大きい ${loud.id} と、小さい ${soft.id} の差: ${spread.toFixed(1)} dB`);
  check(
    `アプリ同士の音量差が ${MAX_SPREAD_DB}dB 以内`,
    spread <= MAX_SPREAD_DB,
    `${loud.id} と ${soft.id} で ${spread.toFixed(1)}dB`
  );
}

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\n弾く4本の音量は、そろっています');
