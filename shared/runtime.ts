/**
 * 実行環境の判定。
 *
 * アプリはブラウザ（web 版）と、ビルド済みファイルを丸ごと同梱した
 * ネイティブアプリの両方で動く。同梱版はネットワークをまったく使わないので、
 * Service Worker のようなキャッシュ層は不要（むしろ邪魔）になる。
 */

/**
 * 端末に同梱された状態で動いているか。
 *
 * 同梱バンドルは index.html に <meta name="native-bundle"> を埋め込んでいる。
 * Capacitor の有無に頼らず、ビルド成果物そのものが自分の素性を名乗る形にして
 * あるので、どんなシェルで包んでも判定を間違えない。
 *
 * 印を <script> ではなく <meta> にしているのは、script-src 'self' の CSP を
 * 敷いたページではインラインスクリプトが実行されないため。
 * （以前のバンドルが埋めた __NATIVE_BUNDLE__ も、引き続き見る）
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { Capacitor?: unknown; __NATIVE_BUNDLE__?: boolean };
  if (w.__NATIVE_BUNDLE__ === true) return true;
  if (typeof w.Capacitor !== 'undefined') return true;
  if (location.protocol === 'capacitor:') return true;
  return document.querySelector('meta[name="native-bundle"]') !== null;
}

/**
 * Service Worker を登録する（web 版のみ）。
 * 同梱版ではファイルがすべて端末内にあるため、登録せずに素通りする。
 */
export function registerServiceWorker(url = './sw.js', scope = './'): void {
  if (isNativeShell()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(url, { scope }).catch(() => {
      // オフライン動作は必須ではないため、登録に失敗しても無視する
    });
  });
}
