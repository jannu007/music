/* Yamabiko Sampler — オフライン用サービスワーカー（スコープ: /sampler/） */
const CACHE = 'yamabiko-sampler-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先・失敗したらキャッシュ（オフラインでも演奏できるようにする）。
// アセット（JS/CSS/worklet）をキャッシュ優先にすると、新しいビルドを配信しても
// 既存の訪問者にはいつまでも古いコードが配られ続けてしまうため、HTML と同じく
// 常にネットワークを優先し、オフライン時のみキャッシュへフォールバックする。
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    // ページ本体(HTML)はブラウザのHTTPキャッシュを迂回して必ず最新を取得する。
    // （HTMLさえ最新なら、参照するJS/CSSはハッシュ付きなので自動的に最新になる）
    fetch(event.request, event.request.mode === 'navigate' ? { cache: 'reload' } : undefined)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
