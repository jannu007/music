const CACHE_NAME = 'akatsuki-synth-cache-v7';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      // 新しいSWを即座に有効化して、次の読み込みを待たずに最新版を配れるようにする
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    // ページ本体(HTML)はブラウザのHTTPキャッシュを迂回して必ず最新を取得する。
    // （HTMLさえ最新なら、参照するJS/CSSはハッシュ付きなので自動的に最新になる）
    fetch(event.request, event.request.mode === 'navigate' ? { cache: 'reload' } : undefined)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
