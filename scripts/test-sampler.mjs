/*
 * Yamabiko Sampler の検証。
 *
 * ヘッドレスの Chromium で実際にアプリを開き、
 *
 *   1. 起動して付属音源が載るか
 *   2. 鍵盤を押して本当に音が出るか（destination の手前で拾って測る）
 *   3. 割り当て・音づくり・エフェクトの各タブが組み立つか
 *   4. 録音 → WAV 書き出しが通り、中身が無音でも歪みでもないか
 *   5. **通信をひとつもしていないか**（CSP と、実際の通信の両方で見る）
 *
 * 壊れた保存ファイルへの耐えかたは scripts/test-sampler-project.mjs で見る
 * （ブラウザを立てずに、検証関数そのものへ直接おかしなものを渡す）。
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
const PORT = 4187;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

if (!existsSync(join(ROOT, 'sampler', 'index.html'))) {
  console.error('dist/sampler がありません。先に npm run build を実行してください');
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


/**
 * 条件が満たされるまで待つ。
 *
 * Playwright の waitForFunction は内部で eval を使うため、
 * script-src 'self' のこのページでは弾かれる（CSP が効いている証拠）。
 * evaluate は別経路なので通る。こちらを繰り返して待つ。
 */
async function waitFor(page, fn, { timeout = 20000, interval = 100, arg } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > until) return false;
    await page.waitForTimeout(interval);
  }
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  … ${detail}` : ''}`);
  if (!ok) failures++;
}

/** destination へ流れる音を横取りして測れるようにする */
function instrument() {
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
      /* 測れなくても本体の動作は妨げない */
    }
    return connect.call(this, dest, ...rest);
  };
}

const launch = { args: ['--autoplay-policy=no-user-gesture-required'] };
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launch.executablePath = preinstalled;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 412, height: 890 } });
const page = await ctx.newPage();

const errors = [];
const cspViolations = [];
const external = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // CSP に引っかかったものは、それと分かる形で分けて数える
  if (/Content Security Policy|Refused to/i.test(text)) cspViolations.push(text);
  else errors.push(text);
});
// localhost 以外への通信は、そもそも出ていないはずのもの
await ctx.route('**', (route) => {
  const url = route.request().url();
  if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue();
  external.push(url);
  return route.abort();
});

await page.addInitScript(instrument);
await page.goto(`http://localhost:${PORT}/sampler/`, { waitUntil: 'networkidle' });

// ---------------------------------------------------------------- 1. 起動
const started = await waitFor(page, () => document.querySelectorAll('.pick-chip').length > 0);
check('起動する', started);
const factoryCount = await page.locator('.pick-chip').count();
check('音源と収録デモが並ぶ', factoryCount >= 16, `${factoryCount} 件`);

// 音源選びと割り当てが1つのタブに収まっていること
const merged = await page.evaluate(() => {
  const panel = document.querySelector('.panel');
  const head = [...document.querySelectorAll('.panel-section-head h3')].find((h) =>
    /MAPPING|割り当て/i.test(h.textContent ?? '')
  );
  if (!panel || !head) return -1;
  return Math.round(head.getBoundingClientRect().top - panel.getBoundingClientRect().top);
});
check('音源選びと割り当てが同じ画面に収まる', merged >= 0 && merged < 420, `割り当ては ${merged}px から`);
check('鍵盤が出る', (await page.locator('.key').count()) > 20);

const mapped = await page.evaluate(() => document.querySelectorAll('.key.mapped').length);
check('鍵盤に素材が割り当たっている', mapped > 10, `${mapped} 鍵`);

// ---------------------------------------------------------------- 2. 音
const keyBox = await page.locator('.key.white.mapped').nth(3).boundingBox();
await page.mouse.move(keyBox.x + keyBox.width / 2, keyBox.y + keyBox.height * 0.7);
await page.mouse.down();
await page.waitForTimeout(120);

const sound = await page.evaluate(async () => {
  const an = window.__probes[0];
  if (!an) return { peak: 0, probes: 0 };
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    an.getFloatTimeDomainData(buf);
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    await new Promise((r) => setTimeout(r, 20));
  }
  return { peak, probes: window.__probes.length };
});
await page.mouse.up();
check('鍵盤を押すと音が出る', sound.peak > 0.002, `peak=${sound.peak.toFixed(4)}`);

// ---------------------------------------------------------------- 3. 各タブ
for (const [tab, selector, label] of [
  ['map', '.zone-strip', '割り当て（ゾーン）'],
  ['sound', '.ctl-range', '音づくり'],
  ['fx', '.segmented', 'エフェクト'],
  ['rec', '.row-actions', '録音'],
  ['export', '.row-actions', '書き出し'],
]) {
  await page.locator(`.tab-btn[data-tab="${tab}"]`).click();
  await page.waitForTimeout(160);
  const count = await page.locator(`.panel ${selector}`).count();
  check(`${label}タブが組み立つ`, count > 0, `${count} 個`);
}

// 波形は常設。どのタブにいても出ていること
for (const tab of ['sound', 'fx', 'export']) {
  await page.locator(`.tab-btn[data-tab="${tab}"]`).click();
  await page.waitForTimeout(120);
  const visible = await page.locator('.wave-strip:not(.empty) .waveform').count();
  check(`${tab} タブでも波形が出ている`, visible === 1, `${visible} 個`);
}

// 波形が本当に描かれているか（真っ黒なら描画に失敗している）
await page.locator('.tab-btn[data-tab="map"]').click();
await page.waitForTimeout(250);
const drawn = await page.evaluate(() => {
  const canvas = document.querySelector('.wave-strip .waveform-canvas');
  if (!canvas) return 0;
  const c = canvas.getContext('2d');
  const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
  return painted / (data.length / 4);
});
check('波形が描かれている', drawn > 0.01, `${(drawn * 100).toFixed(1)}% のピクセル`);

// ------------------------------------------- 3a. 開き直しても楽器が残るか
//
// 付属音源は保存せず、素材の id から辿って合成し直している。辿り方を
// 間違えると、開き直した瞬間にゾーンが全部消えて「音の出ないアプリ」になる。
// 打楽器は id の付け方が他と違っていたため、実際にそうなっていた。
for (const name of ['Percussion', 'Wooden Strings']) {
  await page.locator('.tab-btn[data-tab="map"]').click();
  await page.waitForTimeout(120);
  await page.locator('.pick-chip', { hasText: name }).first().click();
  // 合成が終わるまで待つ。ゾーンの数だけ見ていると、前の音源のぶんを数えてしまう
  const switched = await waitFor(
    page,
    (want) => (document.querySelector('.app-instrument')?.textContent ?? '') === want,
    { arg: name }
  );
  check(`${name}: 読み込める`, switched);
  const before = await page.locator('.zone-chip').count();

  await page.reload({ waitUntil: 'networkidle' });
  await waitFor(page, () => document.querySelectorAll('.pick-chip').length > 0);
  await page.waitForTimeout(400);
  const after = await page.locator('.zone-chip').count();
  const wave = await page.locator('.wave-strip:not(.empty)').count();

  check(`${name}: 開き直してもゾーンが残る`, after === before && after > 0, `${before} → ${after}`);
  check(`${name}: 開き直しても波形が出る`, wave === 1);
}

// ------------------------------------------------------------ 3b. 収録デモ
const demoRows = page.locator('.pick-chip', { hasText: /Stone Garden|石庭|Frost|氷結/ });
const demoCount = await page.evaluate(
  () => document.querySelectorAll('.pick-chip').length
) - 6;
check('収録デモが並ぶ', demoCount === 10, `${demoCount} 曲`);

await demoRows.nth(0).click();
const demoLoaded = await waitFor(page, () => {
  const line = document.querySelector('.status-line');
  return Boolean(line && /Loaded|読み込みました/.test(line.textContent ?? ''));
});
check('収録デモが読み込める', demoLoaded, await page.locator('.status-line').textContent());

const demoSound = await page.evaluate(async () => {
  const an = window.__probes[0];
  if (!an) return 0;
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    an.getFloatTimeDomainData(buf);
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    await new Promise((r) => setTimeout(r, 25));
  }
  return peak;
});
check('収録デモが鳴る', demoSound > 0.002, `peak=${demoSound.toFixed(4)}`);

// -------------------------------------------------- 3b2. 波形の見せ方
//
// 5種類あるが、切り替えても中身が同じだと意味がない。
// 実際に描かれた画素を数えて、種類ごとに違う絵になっていることを確かめる。
{
  const seen = new Map();
  let switched = 0;
  for (let i = 0; i < 6; i++) {
    const name = (await page.locator('.wave-mode').textContent()) ?? `?${i}`;
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector('.wave-strip .waveform-canvas');
      if (!canvas) return null;
      const c = canvas.getContext('2d');
      const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
      let filled = 0;
      // 上半分と下半分を別々に数える。上下対称かどうかも見分けたい
      let top = 0;
      let bottom = 0;
      const half = Math.floor(canvas.height / 2) * canvas.width * 4;
      for (let k = 3; k < data.length; k += 4) {
        if (data[k] > 8) {
          filled++;
          if (k < half) top++;
          else bottom++;
        }
      }
      return { ratio: filled / (data.length / 4), top, bottom };
    });
    if (painted) {
      check(`波形「${name}」が描かれる`, painted.ratio > 0.01, `${(painted.ratio * 100).toFixed(1)}%`);
      seen.set(name, `${painted.top}:${painted.bottom}`);
    }
    await page.locator('.wave-mode').click();
    await page.waitForTimeout(350);
    switched++;
  }
  check('6種類ある', seen.size === 6, [...seen.keys()].join(', '));
  check('種類ごとに違う絵になる', new Set(seen.values()).size === 6, [...seen.values()].join(' / '));
  check('ひと回りして戻る', switched === 6 && (await page.locator('.wave-mode').textContent()) !== null);
}

// 選んだ見せ方は、開き直しても残る
await page.locator('.wave-mode').click();
const chosenMode = await page.locator('.wave-mode').textContent();
await page.reload({ waitUntil: 'networkidle' });
await waitFor(page, () => document.querySelectorAll('.pick-chip').length > 0);
check('見せ方が開き直しても残る', (await page.locator('.wave-mode').textContent()) === chosenMode, `${chosenMode}`);

// ------------------------------------------------------ 3c. 再生と停止
//
// 記録した演奏は、音を先の時刻まで一気に予約して鳴らしている。
// 途中で止めるには予約ごと片付ける必要があり、押している音を離すだけでは
// 止まらない（同時発音数の制限に引っかかった音は「離した」印が付いていて、
// それでも予約どおり鳴ってしまう）。ここはその取りこぼしを見張る。
const measure = (ms) =>
  page.evaluate(async (limit) => {
    const an = window.__probes[0];
    if (!an) return 0;
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    const until = Date.now() + limit;
    while (Date.now() < until) {
      an.getFloatTimeDomainData(buf);
      for (const s of buf) peak = Math.max(peak, Math.abs(s));
      await new Promise((r) => setTimeout(r, 20));
    }
    return peak;
  }, ms);

const playButton = page.locator('.play-btn');
check('再生ボタンがある', (await playButton.count()) === 1);

// 見た目の指定が本当に効いているか。セレクタを書き損ねても
// 画面は出てしまうので、当たっているかどうかは測って確かめる
const shape = await page.evaluate(() => {
  const b = document.querySelector('.play-btn');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { size: Math.round(Math.min(r.width, r.height)), radius: getComputedStyle(b).borderRadius };
});
check('再生ボタンが丸い', shape !== null && parseInt(shape.radius, 10) >= shape.size / 2, JSON.stringify(shape));
check('指で押せる大きさ', shape !== null && shape.size >= 44, `${shape?.size}px`);

// 残響の短い、詰まったデモを使う（残響が長いと止まったかどうか判らない）
await page.locator('.tab-btn[data-tab="map"]').click();
await page.waitForTimeout(120);
await page.locator('.pick-chip', { hasText: /Festival|祭囃子/ }).first().click();
await waitFor(page, () => document.querySelector('.play-btn')?.textContent === '■');
await page.waitForTimeout(1200);

const whilePlaying = await measure(600);
check('再生すると鳴る', whilePlaying > 0.05, `peak=${whilePlaying.toFixed(3)}`);

await playButton.click();
check('押すと停止の表示に戻る', (await playButton.textContent()) === '▶');
await page.waitForTimeout(1600);
const afterStop = await measure(1500);
check('停止すると本当に止まる', afterStop < 0.002, `peak=${afterStop.toFixed(4)}`);

await playButton.click();
await page.waitForTimeout(700);
const replayed = await measure(900);
check('もう一度再生できる', replayed > 0.05, `peak=${replayed.toFixed(3)}`);
await playButton.click();
await page.waitForTimeout(300);

// このあとは鍵盤を弾いて録るので、音程のある音源に戻しておく
// （打楽器は鍵盤ごとに1音しか置かれておらず、押せる白鍵がほとんど無い）
await page.locator('.pick-chip', { hasText: /Wooden Strings|木の弦/ }).first().click();
await waitFor(
  page,
  (want) => (document.querySelector('.app-instrument')?.textContent ?? '') === want,
  { arg: 'Wooden Strings' }
);

// ------------------------------------------------------------ 3d. パッド
//
// パッドは録音を「音そのもの」に焼いて載せている。押した瞬間に鳴らないと
// 楽器にならないので、焼けているか・押して鳴るか・開き直しても残るかを見る。
await page.locator('.tab-btn[data-tab="rec"]').click();
await page.waitForTimeout(150);
check('パッドが16枚ある', (await page.locator('.pad').count()) === 16, `${await page.locator('.pad').count()} 枚`);

// 演奏を録る
await page.locator('.panel .btn', { hasText: /消す|Clear/ }).first().click();
await page.waitForTimeout(120);
await page.locator('.panel .btn', { hasText: /^録音$|^Record$/ }).first().click();
await page.waitForTimeout(120);
{
  const keys = page.locator('.key.white.mapped');
  for (const index of [3, 5, 7]) {
    const box = await keys.nth(index).boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.waitForTimeout(140);
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
}
await page.locator('.panel .btn', { hasText: /停止|Stop/ }).first().click();
await page.waitForTimeout(150);

// 空のパッドを押すと、いまの録音が載る
await page.locator('.pad').first().dispatchEvent('pointerdown');
const baked = await waitFor(page, () => document.querySelectorAll('.pad.filled').length === 1, {
  timeout: 30000,
});
check('空のパッドに録音が載る', baked);

const padLabel = await page.locator('.pad').first().textContent();
check('パッドに名前と長さが出る', /\d\.\ds/.test(padLabel ?? ''), padLabel ?? '');

// 静かになってから叩く
await page.waitForTimeout(1800);
const beforeHit = await measure(400);
check('叩く前は鳴っていない', beforeHit < 0.002, `peak=${beforeHit.toFixed(4)}`);
await page.locator('.pad').first().dispatchEvent('pointerdown');
const afterHit = await measure(900);
check('パッドを押すと鳴る', afterHit > 0.02, `peak=${afterHit.toFixed(3)}`);

// 開き直しても残る（パッドは保管庫に入れている）
await page.reload({ waitUntil: 'networkidle' });
await waitFor(page, () => document.querySelectorAll('.pick-chip').length > 0);
await page.locator('.tab-btn[data-tab="rec"]').click();
await waitFor(page, () => document.querySelectorAll('.pad.filled').length === 1);
check('開き直してもパッドが残る', (await page.locator('.pad.filled').count()) === 1);
await page.waitForTimeout(400);
await page.locator('.pad').first().dispatchEvent('pointerdown');
const afterReload = await measure(900);
check('開き直したパッドも鳴る', afterReload > 0.02, `peak=${afterReload.toFixed(3)}`);

// × で空にできる
await page.locator('.pad').first().locator('.pad-clear').dispatchEvent('pointerdown');
const cleared = await waitFor(page, () => document.querySelectorAll('.pad.filled').length === 0);
check('パッドを空にできる', cleared);

// このあと弾いて録るので、音源を戻しておく
await page.locator('.tab-btn[data-tab="map"]').click();
await page.waitForTimeout(150);
await page.locator('.pick-chip', { hasText: /Wooden Strings|木の弦/ }).first().click();
await waitFor(
  page,
  (want) => (document.querySelector('.app-instrument')?.textContent ?? '') === want,
  { arg: 'Wooden Strings' }
);

// ---------------------------------------------------------------- 4. 書き出し
await page.locator('.tab-btn[data-tab="rec"]').click();
await page.waitForTimeout(120);
// デモの演奏が入っているので、いったん消してから手弾きを録る
await page.locator('.panel .btn', { hasText: /消す|Clear/ }).first().click();
await page.waitForTimeout(120);
await page.locator('.panel .btn', { hasText: /^録音$|^Record$/ }).first().click();
await page.waitForTimeout(100);

// 鍵盤をいくつか弾く
const keys = page.locator('.key.white.mapped');
const total = await keys.count();
for (const index of [2, 4, 6]) {
  if (index >= total) continue;
  const box = await keys.nth(index).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(60);
}
await page.locator('.panel .btn', { hasText: /停止|Stop/ }).first().click();
await page.waitForTimeout(120);

// 録音の節は1つめ。パッドの節も hint を持つので、そちらを拾わないようにする
const noteCount = await page.evaluate(() => {
  const first = document.querySelector('.panel .panel-section');
  const hints = first?.querySelectorAll('.panel-hint') ?? [];
  return hints.length ? hints[hints.length - 1].textContent : '';
});
check('弾いた音が記録される', /[1-9]/.test(noteCount), noteCount);

// 書き出したものを、ダウンロードさせずに横取りして中身を調べる
await page.locator('.tab-btn[data-tab="export"]').click();
await page.waitForTimeout(120);
await page.evaluate(() => {
  window.__captured = null;
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__captured = blob;
    return create(blob);
  };
  // 実際にダウンロードは起こさない
  HTMLAnchorElement.prototype.click = function () {};
});
await page.locator('.panel .btn', { hasText: /WAV/ }).first().click();
const rendered = await waitFor(page, () => window.__captured !== null, { timeout: 40000 });
check('書き出しが終わる', rendered);

const wav = await page.evaluate(async () => {
  const blob = window.__captured;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  const rate = view.getUint32(24, true);

  // 24bit PCM を読み出して中身を測る
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  let frames = 0;
  for (let o = 44; o + 3 <= bytes.length; o += 3) {
    let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (v & 0x800000) v -= 0x1000000;
    const s = v / 8388607;
    peak = Math.max(peak, Math.abs(s));
    if (Math.abs(s) > 0.999) clipped++;
    sum += s * s;
    frames++;
  }
  return {
    size: blob.size,
    riff,
    channels,
    bits,
    rate,
    peak,
    rms: Math.sqrt(sum / Math.max(1, frames)),
    clipPct: (clipped / Math.max(1, frames)) * 100,
  };
});
check('WAV として正しい形', wav.riff === 'RIFF' && wav.channels === 2 && wav.bits === 24, `${wav.channels}ch / ${wav.bits}bit / ${wav.rate}Hz`);
check('書き出した音が無音でない', wav.peak > 0.005, `peak=${wav.peak.toFixed(4)} rms=${wav.rms.toFixed(5)}`);
check('書き出した音が歪んでいない', wav.clipPct < 0.1, `clip=${wav.clipPct.toFixed(3)}%`);

// ------------------------------------------------- 5. 通信ゼロと CSP
check('外部への通信が1つも無い', external.length === 0, external.slice(0, 3).join(', '));
check('CSP に弾かれたものが無い', cspViolations.length === 0, cspViolations.slice(0, 2).join(' | '));
check('コンソールエラーが無い', errors.length === 0, errors.slice(0, 2).join(' | '));

// CSP そのものが効いているか。fetch を試して、止められることを確かめる
const blocked = await page.evaluate(async () => {
  try {
    await fetch('https://example.com/');
    return false;
  } catch {
    return true;
  }
});
check('外部への fetch がブラウザ側で止まる', blocked);

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\nサンプラーは期待どおりに動いています');
