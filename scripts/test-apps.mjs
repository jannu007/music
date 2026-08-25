/*
 * 7本ぜんぶを、実際に触って確かめる。
 *
 * これまで端から端まで見ていたのは synthesizer と sampler だけで、
 * piano・drums・guitar・bass・vocal は「画面が崩れないか」しか見ていなかった。
 * 売り物にする以上、どのアプリも同じ深さで確かめておきたい。
 *
 * 1本につき、日本語と英語の両方で次を見る。
 *
 *   起動      … 例外もコンソールエラーも出さずに立ち上がるか
 *   見出し    … すべての見出しが開き、中身が空でないか
 *   翻訳      … 訳のキー（rec.start のような文字列）が生で出ていないか
 *   音        … 演奏すると本当に音が出るか（destination の手前で測る）
 *   書き出し  … WAV が正しい形で、無音でも歪んでもいないか
 *   再読込    … 開き直しても壊れないか
 *   通信      … 外へ1つも出ていないか
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
const PORT = 4209;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/**
 * アプリごとの触り方。
 *
 * lang … 表示言語を覚えている場所（既定は英語なので、日本語で見るには先に書く）
 * sound … 音を出すために押すもの。上から順に試して、最初に見つかったものを押す
 * export … 書き出しの見出しと、押すボタンの文字
 */
const APPS = [
  {
    id: 'synthesizer',
    lang: 'akatsuki-synth-lang',
    panel: '.main',
    // 起動時にデモ曲が入っているので、再生を押せば鳴る
    sound: [{ click: '.transport button, .header button[title*="Play"]' }],
    // 書き出しは面の中ではなく上の帯にあり、押すと設定の窓が開く。
    // 窓の中の「書き出す」を押してはじめてファイルになる
    export: { scope: '.header', button: /^(Export WAV|WAV書出)$/, then: /^(書き出す|Export)$/ },
    midi: { scope: '.header', button: /^(Export MIDI|MIDI書出)$/ },
  },
  {
    id: 'piano',
    lang: 'aozora-piano-lang',
    panel: '.main-area',
    sound: [{ click: '.pkey.white' }],
    record: { tab: /Record|録音/i, play: '.pkey.white' },
    export: { tab: /Record|録音/i, button: /WAV/i },
    midi: { tab: /Record|録音/i, button: /MIDI/i },
  },
  {
    id: 'drums',
    lang: 'hibiki-drums-lang',
    panel: '.work',
    // 打ち込みは空から始まるので、まず収録デモを読み込む。
    // 空のまま鳴らないのは壊れているのではなく、そういう作りのため
    prepare: { tab: /Demo|デモ/i, click: /^(Load|読み込む)$/ },
    // 空のまま書き出そうとしたら、無音のファイルではなく断りが出ること
    refusesEmpty: /ステップがひとつも|No steps have been placed/,
    sound: [{ click: '.transport .play-btn' }],
    export: { tab: /Export|書き出/i, button: /WAV/i },
    midi: { tab: /Export|書き出/i, button: /MIDI/i },
  },
  {
    id: 'guitar',
    lang: 'takibi-guitar-lang',
    panel: '.main-area',
    sound: [{ click: '.chord-pad' }],
    // 録音の面でも指板は下に出たままなので、そこを弾いて記録する
    record: { tab: /Record|録音/i, play: '.fb-cell' },
    export: { tab: /Record|録音/i, button: /WAV/i },
    midi: { tab: /Record|録音/i, button: /MIDI/i },
  },
  {
    id: 'bass',
    lang: 'kurogane-bass-lang',
    panel: '.main-area',
    // 指板は canvas なので、押す場所を座標で指す
    sound: [{ click: '.fret-canvas', at: { x: 0.42, y: 0.5 } }],
    record: { tab: /Record|録音/i, play: '.fret-canvas', at: { x: 0.42, y: 0.5 } },
    export: { tab: /Record|録音/i, button: /WAV/i },
    midi: { tab: /Record|録音/i, button: /MIDI/i },
  },
  {
    id: 'vocal',
    lang: 'hoshizora-vocal-lang',
    panel: '.workspace',
    sound: [{ click: '.transport .primary' }],
    // 歌をマイクで拾って、音量が読めているところまで
    mic: {
      tab: /Record|録音/i,
      start: /録音開始|start recording/i,
      stop: /停止して取り込む|Stop & Import/,
      // 既定でカウントイン（1小節ぶんのクリック）が入るので、
      // そのぶん長めに歌わせる
      seconds: 8,
      // 止めると「録音 3.0 秒 ／ 最大音量 …％」と読み取り結果が出る
      expect: /録音 [\d.]+ 秒|Recording [\d.]+s/,
    },
    // 上の帯の「書き出し」を押すと品目が並ぶので、そこから WAV（ミックス）を選ぶ
    export: { scope: '.topbar', button: /^(Export|書き出し)$/, then: /WAV \(Mix\)|WAV（ミックス）/ },
    midi: { scope: '.topbar', button: /^(Export|書き出し)$/, then: /MIDI/ },
  },
  {
    id: 'sampler',
    lang: 'yamabiko-sampler-lang',
    panel: '.panel',
    sound: [{ click: '.key.white.mapped' }, { click: '.key' }],
    record: { tab: /Record|録音/i, play: '.key.white.mapped' },
    // マイクで録って、素材として並ぶところまで
    mic: {
      tab: /Mapping|割り当て/i,
      start: /Record from mic|マイクで録る/,
      // 同じボタンがもう一度押すと止まる形になる
      stop: /^(Stop|停止)$/,
      seconds: 2.5,
      // 止めたあと「2.5 秒 録音しました」と出て、素材として並ぶところまで
      expect: /秒 録音しました|Recorded [\d.]+ seconds/,
    },
    export: { tab: /Export|書き出/i, button: /WAV/i },
    midi: { tab: /Export|書き出/i, button: /MIDI/i },
  },
];

const LANGS = [
  { id: 'ja', badge: 'JP' },
  { id: 'en', badge: 'EN' },
];

const TAB_SELECTOR = '.tab, [role=tab], .tab-btn, nav button';

/** 見出しではないボタン。見出しが面の中にあるアプリで取り違えないように */
const NOT_TAB = 'button:not(.tab):not(.tab-btn):not([role=tab])';

/** 録音の開始と停止。日本語と英語のどちらの表記でも拾えるように */
const START = /録音開始|start recording|^\s*録音\s*$|^\s*record\s*$/i;
const STOP = /録音停止|stop recording|^\s*停止\s*$|^\s*stop\s*$/i;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) {
    console.log(` FAIL  ${name}${detail ? `  … ${detail}` : ''}`);
    failures++;
  }
  return ok;
}

/** 見出しを名前で開く */
async function openTab(page, name) {
  const tab = page.locator(TAB_SELECTOR).filter({ hasText: name }).first();
  if ((await tab.count()) === 0) return false;
  await tab.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(450);
  return true;
}

/**
 * 押す。canvas は場所で指す必要があるので、割合で受け取る。
 *
 * 押せたかどうかを返す。黙って握りつぶすと、「音が出ない」のか
 * 「そもそも押せていない」のかが分からなくなる
 */
async function press(page, target, at) {
  try {
    if (!at) {
      await target.click({ timeout: 4000 });
      return true;
    }
    const box = await target.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width * at.x, box.y + box.height * at.y);
    return true;
  } catch (err) {
    lastPressError = String(err).split('\n')[0].slice(0, 90);
    return false;
  }
}

let lastPressError = '';

/**
 * 書き出しを1回ぶん実行して、出てきたファイルを返す。
 *
 * 押すと窓や品書きが開くアプリがあるので、そのときは中でもう一度選ぶ。
 */
async function saveFrom(page, app, spec, where) {
  if (!spec) return null;
  if (spec.tab) await openTab(page, spec.tab);
  const scope = spec.scope ?? app.panel;
  const button = page.locator(scope).locator(NOT_TAB).filter({ hasText: spec.button }).first();
  if ((await button.count()) === 0) {
    check(`${where}: 書き出しのボタンがある`, false, String(spec.button));
    return null;
  }
  if (spec.then) {
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  const wait = page.waitForEvent('download', { timeout: 45000 }).catch(() => null);
  const confirm = spec.then
    ? page.locator('button, [role=menuitem], li').filter({ hasText: spec.then }).first()
    : button;
  if ((await confirm.count()) === 0) {
    check(`${where}: 書き出しの確定がある`, false, String(spec.then));
    return null;
  }
  await confirm.click({ timeout: 5000 }).catch(() => {});
  const download = await wait;
  if (!download) return null;
  const path = await download.path();
  if (!path) return null;
  const data = await readFile(path);
  return { size: data.length, head: data.subarray(0, 12).toString('latin1'), data };
}

/** 書き出した WAV の中身を測る。16bit / 24bit のどちらでも読む */
function measure(buf) {
  let at = 12;
  let bits = 16;
  let dataAt = -1;
  let dataLen = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') bits = buf.readUInt16LE(at + 22);
    if (id === 'data') {
      dataAt = at + 8;
      dataLen = Math.min(size, buf.length - dataAt);
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (dataAt < 0) return null;
  const bytes = bits / 8;
  let peak = 0;
  let clipped = 0;
  let n = 0;
  for (let i = dataAt; i + bytes <= dataAt + dataLen; i += bytes) {
    let v;
    if (bytes === 2) v = buf.readInt16LE(i) / 32768;
    else if (bytes === 3) v = ((buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 24 >> 8)) << 8 >> 8) / 8388608;
    else v = buf.readInt32LE(i) / 2147483648;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a > 0.999) clipped++;
    n++;
  }
  return { peak, clip: n ? clipped / n : 0, samples: n };
}

/** destination へ流れる音を横取りして測れるようにする */
function instrument() {
  const connect = AudioNode.prototype.connect;
  window.__probes = [];
  // 中断からの復帰を見るために、作られた context を控えておく
  window.__ctxs = [];
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = class extends Original {
      constructor(...args) {
        super(...args);
        window.__ctxs.push(this);
      }
    };
  }
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

if (!existsSync(join(ROOT, 'sampler', 'index.html'))) {
  console.error('dist がありません。先に npm run build を実行してください');
  process.exit(1);
}

// 1本だけ試したいとき: node scripts/test-apps.mjs piano
const only = process.argv[2];
const TARGETS = only ? APPS.filter((a) => a.id === only) : APPS;
if (TARGETS.length === 0) {
  console.error(`不明なアプリ: ${only}`);
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

// 偽のマイクを繋いで立ち上げる。
// マイクを使う2本（vocal・sampler）が、実際に録れるところまで確かめたい。
// 許可の問い合わせも自動で通す
const launch = {
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
};
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
if (existsSync(preinstalled)) launch.executablePath = preinstalled;
const browser = await chromium.launch(launch);

console.log('アプリ        言語  見出し  訳  音      書き出し');
console.log('------------------------------------------------------------');

for (const app of TARGETS) {
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const external = [];
    await ctx.route('**', (route) => {
      const url = route.request().url();
      if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue();
      external.push(url);
      return route.abort();
    });
    await ctx.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* 保存できなければ既定のまま */
        }
      },
      [app.lang, lang.id]
    );
    await ctx.addInitScript(instrument);

    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('例外: ' + String(e).slice(0, 160)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160));
    });

    const where = `${app.id}(${lang.id})`;
    await page.goto(`http://localhost:${PORT}/${app.id}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const start = page.locator('.start-btn, button.start').first();
    if ((await start.count()) > 0) {
      await start.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(2200);
    }

    // ---------------------------------------------------------- 言語
    const badge = page.locator('.lang-btn').first();
    const shown = (await badge.count()) > 0 ? ((await badge.textContent()) ?? '').trim() : '?';
    check(`${where}: 指定した言語で出る`, shown === lang.badge, `${shown}`);

    // 打ち込みが空のまま書き出すと、以前は無音のファイルが黙って出来上がっていた。
    // 保存して再生してはじめて気づく形なので、断られることを先に確かめる
    if (app.refusesEmpty) {
      const empty = await saveFrom(page, app, app.export, where);
      const said = await page.locator(app.panel).innerText();
      check(`${where}: 空のまま書き出さない`, empty === null, empty ? '無音のまま出てしまった' : '');
      check(`${where}: 空だと理由が出る`, app.refusesEmpty.test(said), said.split('\n').slice(-1)[0]);
    }

    // 中身が空から始まるアプリは、まず収録デモを読み込んでおく
    if (app.prepare) {
      await openTab(page, app.prepare.tab);
      const load = page.locator(app.panel).locator(NOT_TAB).filter({ hasText: app.prepare.click }).first();
      if ((await load.count()) > 0) {
        await load.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }
      check(`${where}: 収録デモを読み込める`, (await load.count()) > 0);
    }

    // ---------------------------------------------------------- 見出し
    const tabs = page.locator(TAB_SELECTOR);
    const tabCount = await tabs.count();
    let emptyTabs = 0;
    let leaked = new Set();
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(420);
      const seen = await page.evaluate((panelSelector) => {
        // 開いている面の中身。空っぽの見出しは、押しても何も出てこない見出し。
        // 文字数では測れない（ピアノロールや指板は canvas で、文字が無い）。
        // 実際に場所を取っている子要素がいくつあるかで見る
        const body = document.querySelector(panelSelector);
        let filled = 0;
        if (body) {
          for (const el of body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) filled++;
          }
        }

        // 訳のキーが生で出ていないか。'rec.start' のような形
        const keyish = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
        const found = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const s = (n.textContent ?? '').trim();
          if (s.length > 3 && s.length < 40 && keyish.test(s)) found.push(s);
        }
        return { filled, found, height: body ? Math.round(body.getBoundingClientRect().height) : 0 };
      }, app.panel);
      if (seen.filled < 3 || seen.height < 40) emptyTabs++;
      for (const k of seen.found) leaked.add(k);
    }
    check(`${where}: すべての見出しに中身がある`, emptyTabs === 0, `空 ${emptyTabs}/${tabCount}`);
    check(`${where}: 訳のキーが生で出ていない`, leaked.size === 0, [...leaked].slice(0, 4).join(' '));

    // ---------------------------------------------------------- 音
    // 見出しをひと通り開いたあとは最後の面が出たままなので、
    // 演奏の操作がある面へ戻ってから鳴らす
    if (app.soundTab) await openTab(page, app.soundTab);
    else await page.locator(TAB_SELECTOR).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);

    let peak = 0;
    let pressed = false;
    lastPressError = '';
    for (const step of app.sound) {
      const target = page.locator(step.click).first();
      if ((await target.count()) === 0) continue;
      pressed = (await press(page, target, step.at)) || pressed;
      peak = await page.evaluate(async () => {
        // 測り口は毎回見に行く。音の仕組みは押したあとに組み立てられるので、
        // 最初に一度つかんだだけだと「まだ無い」で終わってしまう
        let hi = -1;
        for (let i = 0; i < 80; i++) {
          const an = window.__probes?.[0];
          if (an) {
            if (hi < 0) hi = 0;
            const buf = new Float32Array(an.fftSize);
            an.getFloatTimeDomainData(buf);
            for (const s of buf) hi = Math.max(hi, Math.abs(s));
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        return hi;
      });
      if (peak > 0.002) break;
    }
    check(`${where}: 演奏の操作が押せる`, pressed, lastPressError);
    check(`${where}: 触ると音が出る`, peak > 0.002, `peak=${peak.toFixed(4)}`);

    // ---------------------------------------------------- 中断からの復帰
    //
    // 画面をロックしたり、ほかのアプリに切り替えたりすると、ブラウザや OS が
    // AudioContext を止める。止まったままだと、以降どこを押しても音が出ない。
    // 画面はふつうに動くので、壊れていることに気づきにくい——
    // 実際、ピアノ・ドラム・ボーカルの3本がこれで無音になっていた。
    //
    // 止まったあとの音は、解析器では測れない（止まった context でも
    // 最後の中身を返してくるため）。context の状態そのもので見る。
    if (peak > 0.002) {
      await page.evaluate(async () => {
        for (const c of window.__ctxs ?? []) await c.suspend();
      });
      await page.waitForTimeout(400);
      for (const step of app.sound) {
        const target = page.locator(step.click).first();
        if ((await target.count()) === 0) continue;
        // 再生ボタンは「押す＝止める」に変わっているものがあるので、二度まで試す
        for (let i = 0; i < 2; i++) {
          const running = await page.evaluate(() =>
            (window.__ctxs ?? []).some((c) => c.state === 'running')
          );
          if (running) break;
          await press(page, target, step.at);
          await page.waitForTimeout(600);
        }
      }
      const state = await page.evaluate(() =>
        (window.__ctxs ?? []).map((c) => c.state).join(',')
      );
      check(`${where}: 音を止められても、弾けば戻る`, state.includes('running'), state || '(context 無し)');
    }

    // ---------------------------------------------------------- 書き出し
    //
    // 何も録っていないと「まず録音してください」で終わるアプリがあるので、
    // 必要なら先に短い演奏を録ってから書き出す
    if (app.record) {
      await openTab(page, app.record.tab);
      // 面の中だけから探す。上の帯にも「Stop all」があり、
      // 素朴に探すとそちらを押してしまう
      // 見出しそのものは除く。ピアノなどは見出しが面の中にあり、
      // 「Record」という見出しを録音ボタンと取り違える
      const panel = page.locator(app.panel).locator(NOT_TAB);
      const rec = panel.filter({ hasText: START }).first();
      if ((await rec.count()) > 0) {
        await rec.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
        const target = page.locator(app.record.play).first();
        for (let i = 0; i < 3; i++) {
          await press(page, target, app.record.at);
          await page.waitForTimeout(280);
        }
        const stop = panel.filter({ hasText: STOP }).first();
        if ((await stop.count()) > 0) await stop.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        // 「録音済み: 3 音」のような表示を、数まで見る。
        // 数字があるかだけでは、時計の 00:00 で通ってしまう
        const notes = await page.locator(app.panel).innerText();
        const counted =
          /(録音済み|Recorded)[^0-9]*([1-9]\d*)/.exec(notes) ??
          /([1-9]\d*)\s*(個のイベント|events|音|notes)/.exec(notes);
        check(
          `${where}: 弾いた音が記録される`,
          Boolean(counted),
          counted ? counted[0] : (notes.split('\n').find((l) => /録音|Record/.test(l)) ?? '')
        );
      } else {
        check(`${where}: 録音ボタンがある`, false);
      }
    }

    const wav = await saveFrom(page, app, app.export, where);
    const audible = wav ? measure(wav.data) : null;
    check(
      `${where}: WAV が書き出せる`,
      Boolean(wav) && wav.head.startsWith('RIFF') && wav.head.includes('WAVE'),
      wav ? `${(wav.size / 1024).toFixed(0)}KB ${wav.head.slice(0, 4)}` : '書き出せなかった'
    );
    if (audible) {
      check(`${where}: 書き出した音が無音でない`, audible.peak > 0.01, `peak=${audible.peak.toFixed(3)}`);
      check(`${where}: 書き出した音が歪んでいない`, audible.clip < 0.001, `clip=${(audible.clip * 100).toFixed(3)}%`);
    }

    // MIDI も同じところから出る。中身は「MThd」で始まる決まり
    const midi = app.midi ? await saveFrom(page, app, app.midi, where) : null;
    if (app.midi) {
      check(
        `${where}: MIDI が書き出せる`,
        Boolean(midi) && midi.head.startsWith('MThd'),
        midi ? `${midi.size}B ${midi.head.slice(0, 4)}` : '書き出せなかった'
      );
    }

    // ---------------------------------------------------------- 再読込
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const alive = await page.evaluate(() => document.body.innerText.trim().length > 40);
    check(`${where}: 開き直しても壊れない`, alive);

    // ---------------------------------------------------------- マイク
    //
    // Android では、マニフェストに録音の宣言が無いと、実行時の許可要求が
    // 問い合わせもされずに拒否される。ここで確かめられるのは web 側だが、
    // 「押したらマイクが開いて、録れて、結果が出る」までは見ておきたい
    if (app.mic) {
      await openTab(page, app.mic.tab);
      // ボタンは画面のどこにあってもよい。開き直したあとは別の面が
      // 出ていることもあるので、面の中に限らず探す
      const panel = page.locator(NOT_TAB);
      const start = panel.filter({ hasText: app.mic.start }).first();
      if ((await start.count()) > 0) {
        await start.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(app.mic.seconds * 1000);
        if (app.mic.stop) {
          const stop = panel.filter({ hasText: app.mic.stop }).first();
          if ((await stop.count()) > 0) await stop.click({ timeout: 4000 }).catch(() => {});
        }
        await page.waitForTimeout(1200);
        const said = await page.locator('body').innerText();
        check(
          `${where}: マイクで録れる`,
          app.mic.expect.test(said),
          said.split('\n').filter((l) => l.trim()).slice(-2).join(' / ')
        );
      } else {
        check(`${where}: マイクのボタンがある`, false, String(app.mic.start));
      }
    }

    check(`${where}: 外へ通信しない`, external.length === 0, external.slice(0, 2).join(' '));
    check(`${where}: エラーが出ない`, errors.length === 0, errors.slice(0, 2).join(' / '));

    console.log(
      app.id.padEnd(13),
      lang.id.padEnd(5),
      `${tabCount - emptyTabs}/${tabCount}`.padEnd(7),
      (leaked.size === 0 ? 'ok' : `${leaked.size}件`).padEnd(4),
      peak > 0.002 ? peak.toFixed(3).padEnd(7) : '出ない '.padEnd(7),
      wav ? `${(wav.size / 1024).toFixed(0)}KB` : '—',
      audible ? `peak=${audible.peak.toFixed(2)}` : ''
    );

    await ctx.close();
  }
}

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\n7本とも、すべての機能が動いています');
