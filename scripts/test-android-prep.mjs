/*
 * `scripts/prepare-android.mjs` の検査。
 *
 * ここで見ているのは、実機でしか気づけない類の抜けを、実機なしで捕まえること。
 *
 *   - アイコンが Capacitor のロゴのまま出ていないか
 *   - マイクを使うアプリに RECORD_AUDIO が入っているか
 *     （宣言が無いと、Android は実行時の許可要求を問い合わせもせず拒否する。
 *       画面には何も出ず、録音だけが静かに動かない）
 *   - 版番号が当たっているか
 *   - 二度かけても署名の設定が二重にならないか
 *
 * Capacitor の雛形をそのまま持ってくるとネットワークが要るので、
 * 同じ形をした最小の木をその場で組み立てて試す。
 * 本物の雛形に対しては、ワークフロー側でも同じ点を確かめている。
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${name}${detail ? `  … ${detail}` : ''}`);
  if (!ok) failures++;
}

/** 中身は何でもよい PNG。大きさだけ合っていればよい */
function dummyPng(width, height) {
  const data = Buffer.alloc(width * height * 4, 0x40);
  return encodePng(width, height, data);
}

/** Capacitor の雛形と同じ形をした、最小の Android プロジェクト */
async function fakeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'android-prep-'));
  const res = join(dir, 'app', 'src', 'main', 'res');
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    await mkdir(join(res, `mipmap-${d}`), { recursive: true });
    await writeFile(join(res, `mipmap-${d}`, 'ic_launcher.png'), dummyPng(8, 8));
  }
  await mkdir(join(res, 'drawable'), { recursive: true });
  await mkdir(join(res, 'drawable-v24'), { recursive: true });
  await mkdir(join(res, 'drawable-port-mdpi'), { recursive: true });
  await mkdir(join(res, 'drawable-land-mdpi'), { recursive: true });
  await mkdir(join(res, 'values'), { recursive: true });
  await writeFile(join(res, 'drawable', 'splash.png'), dummyPng(480, 320));
  await writeFile(join(res, 'drawable-port-mdpi', 'splash.png'), dummyPng(320, 480));
  await writeFile(join(res, 'drawable-land-mdpi', 'splash.png'), dummyPng(480, 320));
  // Capacitor のロゴ（消えるべきもの）
  await writeFile(join(res, 'drawable', 'ic_launcher_background.xml'), '<vector/>');
  await writeFile(join(res, 'drawable-v24', 'ic_launcher_foreground.xml'), '<vector/>');

  await writeFile(
    join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" />
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`
  );
  await writeFile(
    join(dir, 'app', 'build.gradle'),
    `apply plugin: 'com.android.application'

android {
    namespace "shop.youkoku.test"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
`
  );
  return dir;
}

function run(app, dir, extra = []) {
  return execFileSync(
    process.execPath,
    [join(ROOT, 'scripts', 'prepare-android.mjs'), app, '--dir', dir, ...extra],
    { encoding: 'utf8' }
  );
}

console.log('Android プロジェクトの整備');

// ---------------------------------------------------- マイクを使うアプリ
{
  const dir = await fakeProject();
  run('vocal', dir, ['--version-code', '7', '--version-name', '2.1.0']);
  const res = join(dir, 'app', 'src', 'main', 'res');
  const manifest = await readFile(join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const gradle = await readFile(join(dir, 'app', 'build.gradle'), 'utf8');

  check('録音の権限が入る', manifest.includes('android.permission.RECORD_AUDIO'));
  check('音声設定の権限が入る', manifest.includes('android.permission.MODIFY_AUDIO_SETTINGS'));
  check(
    'マイクの無い端末でも入れられる',
    /uses-feature android:name="android.hardware.microphone" android:required="false"/.test(manifest)
  );
  check('もとの権限は消えない', manifest.includes('android.permission.INTERNET'));
  check('版番号が当たる', /versionCode 7/.test(gradle) && /versionName "2\.1\.0"/.test(gradle));

  // アイコン。大きさが密度どおりか
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  let ok = true;
  const wrong = [];
  for (const [d, size] of Object.entries(sizes)) {
    for (const [name, expect] of [
      ['ic_launcher.png', size],
      ['ic_launcher_round.png', size],
      ['ic_launcher_foreground.png', Math.round(size * 2.25)],
    ]) {
      const image = decodePng(await readFile(join(res, `mipmap-${d}`, name)));
      if (image.width !== expect || image.height !== expect) {
        ok = false;
        wrong.push(`${d}/${name}=${image.width}`);
      }
    }
  }
  check('アイコンの大きさが密度どおり', ok, wrong.join(' '));

  // 丸アイコン。四隅が抜けていて、真ん中は残っている
  const round = decodePng(await readFile(join(res, 'mipmap-xxxhdpi', 'ic_launcher_round.png')));
  const at = (x, y) => round.data[(y * round.width + x) * 4 + 3];
  check(
    '丸アイコンの角が抜けている',
    at(1, 1) === 0 && at(round.width - 2, 1) === 0,
    `左上=${at(1, 1)}`
  );
  check('丸アイコンの中身は残っている', at(round.width >> 1, round.height >> 1) === 255);

  // アダプティブの前景。縁まで色があること（透明だと四角い輪郭が出る）
  const fg = decodePng(await readFile(join(res, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png')));
  let clear = 0;
  for (let i = 3; i < fg.data.length; i += 4) if (fg.data[i] === 0) clear++;
  check('前景に透明な隙間が無い', clear === 0, `${clear} 画素`);

  // 起動画面。大きさは元のまま、地の色で塗られている
  const splash = decodePng(await readFile(join(res, 'drawable-port-mdpi', 'splash.png')));
  check('起動画面の大きさは変えない', splash.width === 320 && splash.height === 480);
  const corner = [splash.data[0], splash.data[1], splash.data[2]];
  const color = await readFile(join(res, 'values', 'ic_launcher_background.xml'), 'utf8');
  const hex = /#([0-9a-f]{6})/i.exec(color)?.[1] ?? '';
  const want = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  check(
    '起動画面が地の色で塗られている',
    corner.every((v, i) => Math.abs(v - want[i]) <= 1),
    `${corner} と #${hex}`
  );
  check('起動画面が不透明', splash.data[3] === 255);

  check(
    'Capacitor のロゴが消えている',
    !existsSync(join(res, 'drawable', 'ic_launcher_background.xml')) &&
      !existsSync(join(res, 'drawable-v24', 'ic_launcher_foreground.xml'))
  );
}

// ------------------------------------------ マイクを使わないアプリ
{
  const dir = await fakeProject();
  run('piano', dir, ['--version-code', '2', '--version-name', '2.0.1']);
  const manifest = await readFile(join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  check('使わない権限は足さない', !manifest.includes('RECORD_AUDIO'));
  const res = join(dir, 'app', 'src', 'main', 'res');
  const icon = decodePng(await readFile(join(res, 'mipmap-xxxhdpi', 'ic_launcher.png')));
  check('アイコンは差し替わっている', icon.width === 192);
}

// -------------------------------------------------------- 署名の設定
{
  const dir = await fakeProject();
  await writeFile(join(dir, 'app', 'upload.jks'), 'not a real key');
  run('drums', dir, ['--version-code', '2', '--version-name', '2.0.1']);
  let gradle = await readFile(join(dir, 'app', 'build.gradle'), 'utf8');
  check('鍵があれば署名の設定が入る', gradle.includes('signingConfigs'));
  check('release に署名がつく', /release\s*\{\s*\n\s*signingConfig signingConfigs\.release/.test(gradle));

  // 同じプロジェクトへ二度かけても増えない
  run('drums', dir, ['--version-code', '3', '--version-name', '2.0.2']);
  gradle = await readFile(join(dir, 'app', 'build.gradle'), 'utf8');
  check('二度かけても二重にならない', gradle.split('signingConfigs {').length - 1 === 1);
  check('二度目の版番号も当たる', /versionCode 3/.test(gradle));
}

// ------------------------------------------------------ 7本ぶん通る
{
  const apps = ['synthesizer', 'piano', 'drums', 'guitar', 'bass', 'vocal', 'sampler'];
  const mic = [];
  for (const app of apps) {
    const dir = await fakeProject();
    run(app, dir);
    const res = join(dir, 'app', 'src', 'main', 'res');
    const found = (await readdir(join(res, 'mipmap-xxxhdpi'))).length;
    if (found !== 3) check(`${app}: アイコンが 3 枚`, false, `${found} 枚`);
    const manifest = await readFile(join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    if (manifest.includes('RECORD_AUDIO')) mic.push(app);
  }
  check('7本とも整備できる', true);
  check('マイクを求めるのは vocal と sampler だけ', mic.join(',') === 'vocal,sampler', mic.join(','));
}

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\nAndroid プロジェクトの整備は期待どおりです');
