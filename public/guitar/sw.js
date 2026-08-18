/* Takibi Guitar — オフライン用サービスワーカー（スコープ: /guitar/） */
const CACHE = 'takibi-guitar-v2';

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
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
