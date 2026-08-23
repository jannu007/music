/**
 * ファイルの書き出し。
 *
 * web では従来どおり、blob URL を張った <a download> をクリックさせる。
 * ところが **Android の WebView ではこの方法がまったく効かない**。
 * Capacitor は WebView に DownloadListener を設定しないため、blob: を指した
 * ダウンロードは黙って捨てられる（例外も出ない）。書き出し処理自体は成功し、
 * 「WAV exported (9.7 MB)」と表示されるのにファイルがどこにも無いのは、これが理由。
 *
 * そこで同梱アプリでは、Capacitor が注入するブリッジ（window.Capacitor）越しに
 * Filesystem プラグインで端末へ直接書き、そのあと共有シートを開いて
 * 保存先を選べるようにする。
 *
 * ブリッジは `nativePromise(プラグイン名, メソッド名, 引数)` という低水準の
 * 入口を持っていて、これはネイティブ側に登録済みのプラグインへそのまま届く。
 * つまり @capacitor/* を web のバンドルへ import する必要がない。
 * web 版のバンドルサイズも依存関係も、いっさい増えない。
 */

/** 書き出しの結果。呼び出し側が状態表示に使う */
export type SaveOutcome =
  /** ブラウザのダウンロードに渡した（保存先は利用者のブラウザ任せ） */
  | { kind: 'browser' }
  /** 端末に書き込んだ。path は利用者に見せてよい場所 */
  | { kind: 'file'; path: string };

interface Bridge {
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
  PluginHeaders?: { name: string }[];
}

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  if (!cap || typeof cap.nativePromise !== 'function') return null;
  return cap;
}

/** ネイティブ側にそのプラグインが登録されているか */
function hasPlugin(cap: Bridge, name: string): boolean {
  return Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((h) => h.name === name);
}

function call(cap: Bridge, plugin: string, method: string, options: unknown): Promise<unknown> {
  return cap.nativePromise!(plugin, method, options);
}

/**
 * 書き込み先の候補。上から試して、通ったところに置く。
 *
 * DOCUMENTS … 端末の「ドキュメント」。ファイルアプリからすぐ見つかる。いちばん親切
 * EXTERNAL  … Android/data/<パッケージ>/files。権限が要らず必ず書ける
 * CACHE     … 最後の砦。共有シートには乗せられるので、そこから救い出せる
 */
const DESTINATIONS = [
  { directory: 'DOCUMENTS', label: 'Documents' },
  { directory: 'EXTERNAL', label: 'アプリのフォルダ' },
  { directory: 'CACHE', label: '一時フォルダ' },
] as const;

/**
 * base64 は3バイト単位で4文字になる。分割して書くときは境界を3の倍数に
 * そろえないと、continuation ごとにパディングが混ざって中身が壊れる。
 */
const CHUNK_BYTES = 768 * 1024;

function toBase64(bytes: Uint8Array): string {
  // 一度に渡す引数が多すぎると環境によっては落ちるので、小分けにする
  const STEP = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

async function toBase64Chunks(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) return [''];
  const chunks: string[] = [];
  for (let off = 0; off < bytes.length; off += CHUNK_BYTES) {
    chunks.push(toBase64(bytes.subarray(off, off + CHUNK_BYTES)));
  }
  return chunks;
}

/**
 * 端末へ書く。1回のブリッジ呼び出しに 10 MB の文字列を載せると重いので、
 * 最初の1つを writeFile、残りを appendFile で継ぎ足す。
 */
async function writeToDevice(
  cap: Bridge,
  filename: string,
  chunks: string[]
): Promise<{ uri: string; label: string } | null> {
  for (const dest of DESTINATIONS) {
    try {
      const written = (await call(cap, 'Filesystem', 'writeFile', {
        path: filename,
        data: chunks[0],
        directory: dest.directory,
        recursive: true,
      })) as { uri?: string } | null;

      for (let i = 1; i < chunks.length; i++) {
        await call(cap, 'Filesystem', 'appendFile', {
          path: filename,
          data: chunks[i],
          directory: dest.directory,
        });
      }

      const uri = written?.uri;
      if (!uri) throw new Error('保存先の URI が返りませんでした');
      return { uri, label: dest.label };
    } catch {
      // 書けなかった場所の書きかけを残さない（消せなくても先へ進む）
      await call(cap, 'Filesystem', 'deleteFile', {
        path: filename,
        directory: dest.directory,
      }).catch(() => {});
    }
  }
  return null;
}

/** ブラウザのダウンロード。web 版はこれまでどおり */
function downloadInBrowser(blob: Blob, filename: string): SaveOutcome {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { kind: 'browser' };
}

/**
 * ファイルを保存する。
 *
 * 同梱アプリでは端末に書いたうえで共有シートを開き、利用者が保存先を選べるようにする。
 * 共有シートを閉じても、ファイルはすでに端末に残っている。
 *
 * 保存できなかったときは例外を投げる。呼び出し側の catch で失敗として扱えるようにするため
 * （黙って何も起きないのが、いちばん困る）。
 */
export async function saveBlob(blob: Blob, filename: string): Promise<SaveOutcome> {
  const cap = bridge();
  if (!cap || !hasPlugin(cap, 'Filesystem')) return downloadInBrowser(blob, filename);

  const chunks = await toBase64Chunks(blob);
  const written = await writeToDevice(cap, filename, chunks);
  if (!written) throw new Error('端末にファイルを保存できませんでした');

  // 保存先を選びたい人のために共有シートを出す。
  // 閉じられても・プラグインが無くても、保存自体は済んでいるので無視してよい
  if (hasPlugin(cap, 'Share')) {
    await call(cap, 'Share', 'share', { title: filename, files: [written.uri] }).catch(() => {});
  }

  return { kind: 'file', path: `${written.label}/${filename}` };
}

/** 以前の名前。呼び出し側は結果を待って、保存先を表示できる */
export const downloadBlob = saveBlob;
