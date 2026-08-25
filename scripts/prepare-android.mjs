/*
 * `npx cap add android` が作った Android プロジェクトを、店に出せる形に整える。
 *
 *   node scripts/prepare-android.mjs sampler --dir native/sampler/android \
 *     --version-code 3 --version-name 2.1.0
 *
 * Capacitor が作る雛形は、あくまで雛形。そのまま `.aab` にすると
 *
 *   1. アイコンが 7 本とも Capacitor のロゴになる（別のアプリに見えない）
 *   2. 起動画面も Capacitor のロゴが出る
 *   3. AndroidManifest に INTERNET しか書かれておらず、**マイクが使えない**
 *
 * という状態で出てしまう。3 は特に厄介で、Capacitor 自身は録音の許可を
 * 実行時に求める作りになっているのに、マニフェストに宣言が無いと
 * Android はその要求を**問い合わせもせず即座に拒否**する。
 * 画面には何も出ないまま、録音だけが動かないアプリができあがる。
 *
 * ここでその 3 つと、版番号・署名の設定をまとめて当てる。
 * 中身は public/<アプリ>/ にある 512px のアイコンから作るので、
 * 絵を描き直せばアプリのアイコンも起動画面も一緒に変わる。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng, resize } from './lib/png.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * マイクを使うアプリ。
 *
 * vocal は歌の音程を読み取るため、sampler は音を録って楽器にするため。
 * 残りは合成だけなので、要らない権限は宣言しない
 * （使わない権限が並んでいると、審査でも利用者にも不審に見える）。
 */
const MIC_APPS = new Set(['vocal', 'sampler']);

/** ランチャーアイコンの大きさ（密度ごと）。Capacitor の雛形と同じ */
const DENSITIES = [
  { dir: 'mdpi', launcher: 48, foreground: 108 },
  { dir: 'hdpi', launcher: 72, foreground: 162 },
  { dir: 'xhdpi', launcher: 96, foreground: 216 },
  { dir: 'xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'xxxhdpi', launcher: 192, foreground: 432 },
];

/**
 * アダプティブアイコンの前景に、絵をどれくらいの大きさで置くか。
 *
 * Android は 108dp の板のうち、真ん中の 72dp（66.6%）しか見せない。
 * 一方 web のマスカブル用アイコンは「内側 80% の円までは切られない」
 * という約束で描いてある。その 80% の円が 66.6% に収まるようにすると
 *
 *   66.6 / 80 = 0.8325
 *
 * 端末のマスクが円でも角丸でも、絵が欠けない。
 */
const FOREGROUND_SCALE = 0.8325;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** 円で抜く。境目は 1 画素ぶんぼかして、輪郭のギザギザを消す */
function circleMask(image) {
  const { width, height, data } = image;
  const out = Buffer.from(data);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const k = Math.max(0, Math.min(1, r - d + 0.5));
      const o = (y * width + x) * 4;
      out[o + 3] = Math.round(out[o + 3] * k);
    }
  }
  return { width, height, data: out };
}

/**
 * 板の真ん中に絵を置き、余った縁は絵の端の色で埋める。
 *
 * 余りを透明のまま残すと、下地の一色との境目に**四角い輪郭が出る**。
 * アイコンの地は隅へ向かって色が変わっているので、一色ではどうしても
 * 合わないため。端の画素をそのまま外へ伸ばせば、続きとして繋がる。
 */
function centre(image, size, scale) {
  const inner = Math.round(size * scale);
  const art = resize(image, inner, inner);
  const out = Buffer.alloc(size * size * 4);
  const offset = Math.round((size - inner) / 2);
  const clamp = (v) => Math.max(0, Math.min(inner - 1, v));
  for (let y = 0; y < size; y++) {
    const ay = clamp(y - offset);
    for (let x = 0; x < size; x++) {
      const ax = clamp(x - offset);
      art.data.copy(out, (y * size + x) * 4, (ay * inner + ax) * 4, (ay * inner + ax) * 4 + 4);
    }
  }
  return { width: size, height: size, data: out };
}

/** 一色で塗った板の真ん中に絵を置く（起動画面用） */
function onColor(image, width, height, color, scale) {
  const inner = Math.round(Math.min(width, height) * scale);
  const art = resize(image, inner, inner);
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = color[0];
    out[i * 4 + 1] = color[1];
    out[i * 4 + 2] = color[2];
    out[i * 4 + 3] = 255;
  }
  const ox = Math.round((width - inner) / 2);
  const oy = Math.round((height - inner) / 2);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4;
      const a = art.data[s + 3] / 255;
      if (a <= 0) continue;
      const d = ((y + oy) * width + (x + ox)) * 4;
      for (let c = 0; c < 3; c++) {
        out[d + c] = Math.round(out[d + c] * (1 - a) + art.data[s + c] * a);
      }
    }
  }
  return { width, height, data: out };
}

/** #rrggbb を [r,g,b] に */
function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * そのアプリの地の色。
 *
 * web のマニフェストに書いてある background_color を第一とする
 * （画面の地の色と起動画面がそろう）。無ければアイコンの隅の色を使う。
 */
async function baseColor(app, maskable) {
  const manifest = join(ROOT, 'public', app, 'manifest.webmanifest');
  if (existsSync(manifest)) {
    const json = JSON.parse(await readFile(manifest, 'utf8'));
    const c = parseHex(json.background_color ?? json.theme_color ?? '');
    if (c) return c;
  }
  return [maskable.data[0], maskable.data[1], maskable.data[2]];
}

/** アイコン一式を作る。Android プロジェクトが無くても動くので、試験から呼べる */
export async function buildIcons(app) {
  const dir = join(ROOT, 'public', app);
  const square = decodePng(await readFile(join(dir, 'icon-512.png')));
  const maskable = decodePng(await readFile(join(dir, 'icon-512-maskable.png')));
  const color = await baseColor(app, maskable);

  const files = [];
  for (const d of DENSITIES) {
    files.push([
      `mipmap-${d.dir}/ic_launcher.png`,
      encodePng(d.launcher, d.launcher, resize(square, d.launcher, d.launcher).data),
    ]);
    const round = circleMask(resize(maskable, d.launcher, d.launcher));
    files.push([`mipmap-${d.dir}/ic_launcher_round.png`, encodePng(d.launcher, d.launcher, round.data)]);
    const fg = centre(maskable, d.foreground, FOREGROUND_SCALE);
    files.push([
      `mipmap-${d.dir}/ic_launcher_foreground.png`,
      encodePng(d.foreground, d.foreground, fg.data),
    ]);
  }
  return { files, color, square, maskable };
}

/**
 * 起動画面。
 *
 * Capacitor の雛形は密度ごと・縦横ごとに splash.png を持っている。
 * 元と同じ大きさで作り直す（大きさを変えると引き伸ばされる）。
 */
async function writeSplashes(res, square, color) {
  const written = [];
  for (const name of await readdir(res)) {
    if (!name.startsWith('drawable')) continue;
    const file = join(res, name, 'splash.png');
    if (!existsSync(file)) continue;
    const old = decodePng(await readFile(file));
    // 起動画面のアイコンは小さめに。画面いっぱいに広げると安っぽく見える。
    // 角の丸い方（icon-512.png）を使う。全面塗りのマスカブル版を置くと、
    // 地の上に四角い板が乗っているだけに見えてしまう
    const image = onColor(square, old.width, old.height, color, 0.34);
    await writeFile(file, encodePng(image.width, image.height, image.data));
    written.push(`${name}/splash.png`);
  }
  return written;
}

/** マニフェストに権限を足す。すでにあるものは足さない */
function addPermissions(xml, permissions, features) {
  let out = xml;
  const lines = [];
  for (const p of permissions) {
    if (!out.includes(`android:name="${p}"`)) {
      lines.push(`    <uses-permission android:name="${p}" />`);
    }
  }
  for (const f of features) {
    if (!out.includes(`android:name="${f}"`)) {
      // required=false … マイクの無い端末でも入れられるようにする
      lines.push(`    <uses-feature android:name="${f}" android:required="false" />`);
    }
  }
  if (lines.length === 0) return out;
  out = out.replace('</manifest>', `${lines.join('\n')}\n</manifest>`);
  return out;
}

async function main() {
  const app = process.argv[2];
  if (!app) {
    console.error('使い方: node scripts/prepare-android.mjs <アプリ> [--dir <android>] ...');
    process.exit(1);
  }
  const dir = resolve(ROOT, arg('dir', 'android'));
  const versionCode = arg('version-code');
  const versionName = arg('version-name');
  if (!existsSync(dir)) throw new Error(`${dir} がありません。先に npx cap add android を実行してください`);

  const res = join(dir, 'app', 'src', 'main', 'res');
  const { files, color, square } = await buildIcons(app);

  // 1. アイコン
  for (const [name, data] of files) {
    const target = join(res, name);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, data);
  }
  // 雛形に入っている Capacitor のロゴ（ベクタ）は使わないので消す。
  // 残しておくと、使っていないのに .aab の中に相手のロゴが入ったままになる
  for (const leftover of ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']) {
    await rm(join(res, leftover), { force: true });
  }
  // アダプティブアイコンの下地は、アプリの地の色で塗る
  await mkdir(join(res, 'values'), { recursive: true });
  await writeFile(
    join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${toHex(color)}</color>\n</resources>\n`
  );

  // 2. 起動画面
  const splashes = await writeSplashes(res, square, color);

  // 3. 権限
  const manifestPath = join(dir, 'app', 'src', 'main', 'AndroidManifest.xml');
  let manifest = await readFile(manifestPath, 'utf8');
  if (MIC_APPS.has(app)) {
    manifest = addPermissions(
      manifest,
      ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
      ['android.hardware.microphone']
    );
  }
  await writeFile(manifestPath, manifest);

  // 4. 版番号
  const gradlePath = join(dir, 'app', 'build.gradle');
  let gradle = await readFile(gradlePath, 'utf8');
  if (versionCode) gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  if (versionName) gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);

  // 5. 署名。鍵が置かれているときだけ設定を足す
  const hasKey = existsSync(join(dir, 'app', 'upload.jks'));
  if (hasKey && !gradle.includes('signingConfigs')) {
    gradle = gradle.replace(
      /(android\s*\{)/,
      `$1
    signingConfigs {
        release {
            storeFile file('upload.jks')
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias System.getenv('KEY_ALIAS')
            keyPassword System.getenv('KEY_PASSWORD')
        }
    }
`
    );
    gradle = gradle.replace(
      /(buildTypes\s*\{\s*release\s*\{)/,
      '$1\n            signingConfig signingConfigs.release'
    );
  }
  await writeFile(gradlePath, gradle);

  console.log(`${app} の Android プロジェクトを整えました`);
  console.log(`  アイコン    ${files.length} 枚（地の色 ${toHex(color)}）`);
  console.log(`  起動画面    ${splashes.length} 枚`);
  console.log(`  マイク権限  ${MIC_APPS.has(app) ? 'あり' : '不要'}`);
  console.log(`  版          ${versionCode ?? '据え置き'} / ${versionName ?? '据え置き'}`);
  console.log(`  署名        ${hasKey ? '設定しました' : '鍵が無いので未署名'}`);
}

if (basename(process.argv[1] ?? '') === 'prepare-android.mjs') {
  await main();
}
