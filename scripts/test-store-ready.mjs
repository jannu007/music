/*
 * Google Play へ出す前の、最後の見直し。
 *
 *   node scripts/test-store-ready.mjs
 *
 * 動くかどうか（機能）は test-apps.mjs が、
 * 端末に入る形になっているかは test-android-prep.mjs が見ている。
 * ここが見るのは「ストアの審査で撥ねられないか」だけ。
 *
 *   ・掲載文が Play の字数に収まっているか（名前30 / 簡単80 / 詳しい4000）
 *   ・7本の掲載文が、互いに使い回しになっていないか
 *     （似た文が並ぶと「1本を7回出した」と見なされ、スパム扱いになる）
 *   ・画像が Play の規格どおりか（アイコン512角 / 帯1024x500 /
 *     スクショは 320〜3840px かつ 16:9 か 9:16）
 *   ・プライバシーポリシーの頁が、手引きに書いた URL のとおり在るか
 *   ・パッケージ名が7本とも違うか（同じだと後から直せない）
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NATIVE_APPS } from './build-native.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ASSETS = join(ROOT, 'store-assets');

const LIMITS = { title: 30, short: 80, full: 4000 };

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok     ${label}${detail ? `  … ${detail}` : ''}`);
  else {
    console.log(` FAIL  ${label}${detail ? `  … ${detail}` : ''}`);
    failures += 1;
  }
}

/** Play は文字数で数えるので、絵文字も1つとして数える */
const len = (s) => Array.from(s).length;

/**
 * STORE.md / STORE.en.md から、アプリごとの3つの欄を取り出す。
 *
 * 体裁は「## 番号. 名前」→「**見出し**」→ ``` で囲った本文、の繰り返し。
 * 見出しの表記が日本語版と英語版で違うので、両方を受ける。
 */
function parseListing(md) {
  const out = [];
  const sections = md.split(/^## \d+\. /m).slice(1);
  for (const section of sections) {
    const name = section.split('\n', 1)[0].trim();
    const fields = {};
    const re = /\*\*([^*]+)\*\*[^\n]*\n+```\n([\s\S]*?)\n```/g;
    let m;
    while ((m = re.exec(section)) !== null) {
      const head = m[1].trim();
      const body = m[2].trim();
      if (/アプリ名|Title/.test(head)) fields.title = body;
      else if (/簡単|Short/.test(head)) fields.short = body;
      else if (/詳しい|Full/.test(head)) fields.full = body;
    }
    out.push({ name, ...fields });
  }
  return out;
}

/** PNG の IHDR から幅と高さを読む（画像全体を展開しなくて済む） */
async function pngSize(path) {
  const buf = await readFile(path);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error(`PNG ではありません: ${path}`);
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** 語をならして、掲載文どうしの重なりを測る */
function shingles(text) {
  const words = text
    .toLowerCase()
    .replace(/[\s・■、。,.]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i + 2 < words.length; i += 1) set.add(words.slice(i, i + 3).join(' '));
  return set;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const s of a) if (b.has(s)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

console.log('掲載文');
console.log('アプリ                        名前  簡単  詳しい');
console.log('------------------------------------------------------');

const listings = {};
for (const [lang, file] of [['ja', 'STORE.md'], ['en', 'STORE.en.md']]) {
  const md = await readFile(join(ROOT, file), 'utf8');
  const parsed = parseListing(md);
  listings[lang] = parsed;
  check(`${file} に7本ぶん載っている`, parsed.length === NATIVE_APPS.length, `${parsed.length}本`);
  for (const item of parsed) {
    const t = item.title ? len(item.title) : 0;
    const s = item.short ? len(item.short) : 0;
    const f = item.full ? len(item.full) : 0;
    console.log(
      `${(`${item.name} (${lang})`).padEnd(30)}${String(t).padStart(4)}${String(s).padStart(6)}${String(f).padStart(8)}`,
    );
    check(`${item.name} (${lang}): 3つの欄がそろっている`, t > 0 && s > 0 && f > 0);
    check(`${item.name} (${lang}): 名前が ${LIMITS.title} 字以内`, t > 0 && t <= LIMITS.title, `${t}字`);
    check(`${item.name} (${lang}): 簡単な説明が ${LIMITS.short} 字以内`, s > 0 && s <= LIMITS.short, `${s}字`);
    check(`${item.name} (${lang}): 詳しい説明が ${LIMITS.full} 字以内`, f > 0 && f <= LIMITS.full, `${f}字`);
  }
}

// 使い回しの検査。同じ言語の中で、詳しい説明どうしを突き合わせる
console.log('\n掲載文の重なり（使い回しに見えないか）');
for (const lang of ['ja', 'en']) {
  const items = listings[lang].filter((i) => i.full);
  const sets = items.map((i) => shingles(i.full));
  let worst = { pair: '', ratio: 0 };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const r = overlap(sets[i], sets[j]);
      if (r > worst.ratio) worst = { pair: `${items[i].name} と ${items[j].name}`, ratio: r };
    }
  }
  const pct = (worst.ratio * 100).toFixed(0);
  check(`${lang}: いちばん似た2本でも重なりは半分未満`, worst.ratio < 0.5, `${worst.pair} が ${pct}%`);
}

// 掲載画像は作り直せるものなので、リポジトリには置いていない
// （.gitignore 済み。撮り直すたびに数十MBが履歴に積もるため）。
// 無いときは黙って飛ばさず、見ていないことを最後にはっきり書く。
const assetsThere = existsSync(ASSETS);

console.log('\n掲載画像');
if (assetsThere) {
  console.log('アプリ         アイコン    帯         スマホ  7型  10型');
  console.log('---------------------------------------------------------');
} else {
  console.log('  store-assets/ がありません。画像はここでは見ていません。');
  console.log('  `node scripts/store-assets.mjs` か store-assets ワークフローで作られます。');
}

for (const app of assetsThere ? NATIVE_APPS : []) {
  const dir = join(ASSETS, app.id);
  if (!existsSync(dir)) {
    check(`${app.id}: 掲載画像がある`, false, `${dir} がありません`);
    continue;
  }
  const files = await readdir(dir);

  const icon = await pngSize(join(dir, 'icon-512.png')).catch(() => null);
  const feature = {};
  for (const lang of ['ja', 'en']) {
    feature[lang] = await pngSize(join(dir, `feature-${lang}.png`)).catch(() => null);
  }

  const shots = files.filter((f) => /^(phone|tablet7|tablet10)-(ja|en)-\d+\.png$/.test(f));
  const sizes = [];
  for (const f of shots) sizes.push([f, await pngSize(join(dir, f))]);

  const phoneJa = shots.filter((f) => f.startsWith('phone-ja-')).length;
  const phoneEn = shots.filter((f) => f.startsWith('phone-en-')).length;
  const t7 = shots.filter((f) => f.startsWith('tablet7-')).length;
  const t10 = shots.filter((f) => f.startsWith('tablet10-')).length;

  console.log(
    `${app.id.padEnd(14)}${icon ? `${icon.w}x${icon.h}` : '無し'}`.padEnd(26) +
      `${feature.ja ? `${feature.ja.w}x${feature.ja.h}` : '無し'}`.padEnd(11) +
      `${phoneJa}/${phoneEn}`.padStart(6) +
      String(t7).padStart(5) +
      String(t10).padStart(5),
  );

  check(`${app.id}: アイコンが 512x512`, !!icon && icon.w === 512 && icon.h === 512);
  for (const lang of ['ja', 'en']) {
    const g = feature[lang];
    check(`${app.id}: ${lang} の帯が 1024x500`, !!g && g.w === 1024 && g.h === 500);
  }
  check(`${app.id}: スマホの画面が日本語で2枚以上`, phoneJa >= 2, `${phoneJa}枚`);
  check(`${app.id}: スマホの画面が英語で2枚以上`, phoneEn >= 2, `${phoneEn}枚`);

  const bad = sizes.filter(([, s]) => {
    const inRange = s.w >= 320 && s.h >= 320 && s.w <= 3840 && s.h <= 3840;
    const ratio = s.w / s.h;
    const ok169 = Math.abs(ratio - 16 / 9) < 0.02;
    const ok916 = Math.abs(ratio - 9 / 16) < 0.02;
    return !(inRange && (ok169 || ok916));
  });
  check(
    `${app.id}: スクショが 320〜3840px で 16:9 か 9:16`,
    bad.length === 0,
    bad.length ? bad.map(([f, s]) => `${f} ${s.w}x${s.h}`).join(' ') : `${sizes.length}枚`,
  );
}

console.log('\nプライバシーポリシー');
const play = await readFile(join(ROOT, 'PLAY.md'), 'utf8');
for (const app of NATIVE_APPS) {
  const page = join(ROOT, 'public', app.id, 'privacy.html');
  const there = existsSync(page);
  check(`${app.id}: 頁がある`, there, there ? `public/${app.id}/privacy.html` : '');
  if (there) {
    const html = await readFile(page, 'utf8');
    check(`${app.id}: 頁が空でない`, html.length > 400, `${html.length}字`);
  }
  const url = `https://jannu007.github.io/music/${app.id}/privacy.html`;
  check(`${app.id}: 手引きに URL が載っている`, play.includes(url));
}

console.log('\nパッケージ名');
const ids = NATIVE_APPS.map((a) => a.appId);
check('7本とも違う名前になっている', new Set(ids).size === ids.length, ids.join(' '));
for (const app of NATIVE_APPS) {
  check(`${app.id}: 逆ドメイン形式`, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(app.appId), app.appId);
}

console.log('');
if (failures) {
  console.log(`${failures} 件、このままでは出せません`);
  process.exit(1);
}
if (assetsThere) {
  console.log('Google Play に出せる状態です（掲載文・画像・ポリシー・パッケージ名）');
} else {
  console.log('掲載文・ポリシー・パッケージ名は出せる状態です');
  console.log('※ 掲載画像だけは、まだ確認していません');
}
