/**
 * ファイル保存（shared/download.ts）の検査。
 *
 * Android 実機での挙動はここでは試せないので、Capacitor が注入するブリッジを
 * 偽物に差し替えて、**ネイティブへ渡している内容が正しいか**を確かめる。
 *
 *   1. 分割して送った base64 をつなぎ直すと、元のバイト列と1バイトも違わないか
 *   2. 分割の境界が3の倍数か（base64 は3バイト→4文字。ずれると中身が壊れる）
 *   3. 書けない場所があったら、次の候補へ移るか
 *   4. どこにも書けなければ例外を投げるか（黙って失敗しないこと）
 *   5. Capacitor が居ない web では、これまでどおり <a download> を使うか
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  … ${detail}` : ''}`);
  if (!ok) failures++;
}

/** ネイティブ側のふり。書き込まれた中身を溜めておく */
function fakeBridge({ writable = ['DOCUMENTS'], plugins = ['Filesystem', 'Share'] } = {}) {
  const files = new Map();
  const calls = [];
  return {
    files,
    calls,
    PluginHeaders: plugins.map((name) => ({ name })),
    nativePromise(plugin, method, options) {
      calls.push({ plugin, method, options });
      if (plugin === 'Share') return Promise.resolve({});
      const key = `${options.directory}/${options.path}`;
      if (method === 'deleteFile') {
        files.delete(key);
        return Promise.resolve({});
      }
      if (!writable.includes(options.directory)) {
        return Promise.reject(new Error(`${options.directory} には書けません`));
      }
      const bytes = Buffer.from(options.data, 'base64');
      if (method === 'writeFile') {
        files.set(key, bytes);
        return Promise.resolve({ uri: `file:///fake/${options.directory}/${options.path}` });
      }
      if (method === 'appendFile') {
        files.set(key, Buffer.concat([files.get(key) ?? Buffer.alloc(0), bytes]));
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`未対応: ${method}`));
    },
  };
}

const tmp = await mkdtemp(join(tmpdir(), 'dl-test-'));
try {
  const outfile = join(tmp, 'download.mjs');
  await build({
    entryPoints: [join(ROOT, 'shared/download.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
  });
  const { saveBlob } = await import(pathToFileURL(outfile).href);

  // 分割の境目をまたぐ大きさにする（CHUNK_BYTES = 768KB）
  const size = 768 * 1024 * 2 + 12345;
  const original = Buffer.alloc(size);
  for (let i = 0; i < size; i++) original[i] = (i * 31 + (i >> 7)) & 0xff;
  const blob = new Blob([original]);

  // 1 + 2. 書き込んだ中身が元と一致するか
  {
    const cap = fakeBridge();
    globalThis.window = { Capacitor: cap };
    const outcome = await saveBlob(blob, 'song.wav');
    const written = cap.files.get('DOCUMENTS/song.wav');
    check('保存先を返す', outcome.kind === 'file' && outcome.path === 'Documents/song.wav', outcome.path);
    check('サイズが一致する', written?.length === size, `${written?.length} / ${size}`);
    check('中身が1バイトも違わない', written != null && written.equals(original));

    const writes = cap.calls.filter((c) => c.method === 'writeFile' || c.method === 'appendFile');
    check('分割して送っている', writes.length === 3, `${writes.length} 回`);
    const boundaries = writes
      .slice(0, -1)
      .every((c) => Buffer.from(c.options.data, 'base64').length % 3 === 0);
    check('分割の境界が3の倍数', boundaries);
    check('追記は最初の1回を除く', writes.slice(1).every((c) => c.method === 'appendFile'));

    const share = cap.calls.find((c) => c.plugin === 'Share');
    check('保存したファイルを共有シートに渡す', share?.options.files?.[0] === 'file:///fake/DOCUMENTS/song.wav');
  }

  // 3. 書けない場所は諦めて次へ
  {
    const cap = fakeBridge({ writable: ['EXTERNAL'] });
    globalThis.window = { Capacitor: cap };
    const outcome = await saveBlob(new Blob([Buffer.from('hello')]), 'a.mid');
    check('書けない場所は次の候補へ', outcome.kind === 'file' && outcome.path.startsWith('アプリのフォルダ/'), outcome.path);
    check('移った先に正しく書けている', cap.files.get('EXTERNAL/a.mid')?.toString() === 'hello');
  }

  // 4. どこにも書けなければ、黙って失敗せず例外を投げる
  {
    globalThis.window = { Capacitor: fakeBridge({ writable: [] }) };
    let threw = false;
    await saveBlob(new Blob([Buffer.from('x')]), 'a.wav').catch(() => (threw = true));
    check('保存できなければ例外を投げる', threw);
  }

  // Share が無い端末でも保存は成立する
  {
    const cap = fakeBridge({ plugins: ['Filesystem'] });
    globalThis.window = { Capacitor: cap };
    const outcome = await saveBlob(new Blob([Buffer.from('x')]), 'a.wav');
    check('共有プラグインが無くても保存できる', outcome.kind === 'file');
  }

  // 5. web（Capacitor が居ない）ではブラウザのダウンロードを使う
  {
    const clicked = [];
    const anchor = {
      click() {
        clicked.push({ href: anchor.href, download: anchor.download });
      },
      remove() {},
    };
    globalThis.window = {};
    globalThis.document = { createElement: () => anchor, body: { appendChild() {} } };
    globalThis.URL.createObjectURL = () => 'blob:fake';
    globalThis.URL.revokeObjectURL = () => {};
    const outcome = await saveBlob(new Blob([Buffer.from('x')]), 'web.wav');
    check('web ではブラウザに渡す', outcome.kind === 'browser');
    check('ファイル名を付けてクリックしている', clicked[0]?.download === 'web.wav' && clicked[0]?.href === 'blob:fake');
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\nファイル保存は期待どおりに動いています');
