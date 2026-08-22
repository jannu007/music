/**
 * ネイティブアプリ同梱用のバンドルを作る。
 *
 *   node scripts/build-native.mjs           # 6アプリぶん
 *   node scripts/build-native.mjs drums     # 1つだけ
 *
 * `npm run build` が出力した dist/ をもとに、アプリごとに
 *
 *   dist-native/<id>/
 *     index.html          … そのアプリだけを開く入口
 *     assets/             … JS / CSS / AudioWorklet
 *     icon-*.png, manifest.webmanifest, privacy.html
 *
 * という自己完結したフォルダを組み立てる。
 * ネットワークを一切参照しないので、Play の「ウェブ表示スパム」に当たらない。
 *
 * Service Worker（sw.js）は同梱しない。端末内にファイルがある以上キャッシュ層は
 * 不要で、あるとかえって更新の邪魔になるため。
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'dist-native');

/** アプリID → ストア表示名とパッケージ名 */
export const NATIVE_APPS = [
  { id: 'synthesizer', appId: 'shop.youkoku.synth', name: 'Akatsuki Synth' },
  { id: 'piano', appId: 'shop.youkoku.piano', name: 'Aozora Grand Piano' },
  { id: 'drums', appId: 'shop.youkoku.drums', name: 'Hibiki Drum Machine' },
  { id: 'guitar', appId: 'shop.youkoku.guitar', name: 'Takibi Guitar' },
  { id: 'bass', appId: 'shop.youkoku.bass', name: 'Kurogane Bass' },
  { id: 'vocal', appId: 'shop.youkoku.vocal', name: 'Hoshizora Vocal' },
];

/** 同梱しないもの（web 配信専用） */
const SKIP = new Set(['sw.js']);

async function buildOne(app) {
  const src = join(DIST, app.id);
  if (!existsSync(src)) {
    throw new Error(`dist/${app.id} がありません。先に npm run build を実行してください`);
  }
  const dest = join(OUT, app.id);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  // アプリ固有のファイル（index.html・アイコン・マニフェスト）
  for (const entry of await readdir(src)) {
    if (SKIP.has(entry)) continue;
    await cp(join(src, entry), join(dest, entry), { recursive: true });
  }

  // 共有チャンクと AudioWorklet。ワークレットは import.meta.url を基準に
  // 自分と同じ階層を参照するので、assets/ ごと持っていけばそのまま動く
  await cp(join(DIST, 'assets'), join(dest, 'assets'), { recursive: true });

  // index.html はもともと dist/<id>/ に置かれる前提で ../assets を指しているため、
  // 1階層上がったぶんを ./assets に直す
  const htmlPath = join(dest, 'index.html');
  let html = await readFile(htmlPath, 'utf8');
  const before = html;
  html = html.replaceAll('"../assets/', '"./assets/').replaceAll("'../assets/", "'./assets/");
  if (html === before && before.includes('../assets/')) {
    throw new Error(`${app.id}: assets の書き換えに失敗しました`);
  }
  // 同梱版であることを本体に知らせる印。これがあると Service Worker を登録しない
  // （sw.js は同梱していないので、登録を試みると 404 になる）
  const marker = '<script>window.__NATIVE_BUNDLE__ = true;</script>';
  if (!html.includes('__NATIVE_BUNDLE__')) {
    if (!html.includes('</head>')) throw new Error(`${app.id}: </head> が見つかりません`);
    html = html.replace('</head>', `  ${marker}\n</head>`);
  }
  await writeFile(htmlPath, html);

  // 参照先がすべて手元にあるか確かめる（取りこぼすと端末で初めて壊れる）
  const missing = [];
  for (const ref of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
    const target = join(dest, decodeURIComponent(ref[1]));
    if (!existsSync(target)) missing.push(ref[1]);
  }
  if (missing.length) throw new Error(`${app.id}: 同梱漏れ ${missing.join(', ')}`);

  // 絶対URLでの外部参照が残っていないか（残っていればオフラインで壊れる）
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  if (external.length) throw new Error(`${app.id}: 外部参照が残っています ${external.join(', ')}`);

  const bytes = await folderSize(dest);
  return { ...app, dir: dest, bytes };
}

async function folderSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? await folderSize(p) : (await stat(p)).size;
  }
  return total;
}

/** Capacitor 用の設定。アプリごとに native/<id>/ を作る */
async function writeCapacitorConfig(app) {
  const dir = join(ROOT, 'native', app.id);
  await mkdir(dir, { recursive: true });
  const config = {
    appId: app.appId,
    appName: app.name,
    // ここを指すことで、ビルド済みファイルがそのまま APK に入る
    webDir: join('..', '..', 'dist-native', app.id).split('\\').join('/'),
    // 端末内のファイルを https://localhost から配る。
    // AudioWorklet はセキュアコンテキストでしか動かないため file:// は使えない
    server: { androidScheme: 'https' },
    android: { allowMixedContent: false },
  };
  await writeFile(join(dir, 'capacitor.config.json'), JSON.stringify(config, null, 2) + '\n');
  return dir;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

async function main() {
  const only = process.argv[2];
  const targets = only ? NATIVE_APPS.filter((a) => a.id === only) : NATIVE_APPS;
  if (targets.length === 0) {
    console.error(`不明なアプリ: ${only}\n指定できるのは ${NATIVE_APPS.map((a) => a.id).join(', ')}`);
    process.exit(1);
  }
  for (const app of targets) {
    const built = await buildOne(app);
    const cfg = await writeCapacitorConfig(app);
    console.log(`  ${app.id.padEnd(12)} ${mb(built.bytes).padStart(8)}  ${app.appId}`);
    console.log(`  ${''.padEnd(12)} bundle: dist-native/${app.id}/   config: ${cfg.replace(ROOT + '/', '')}/`);
  }
  console.log(`\n${targets.length} 個のバンドルを作成しました（ネットワーク参照なし）`);
}

// NATIVE_APPS を他から import しただけでビルドが走らないようにする
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
