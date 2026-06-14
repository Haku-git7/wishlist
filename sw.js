/* ねこ棚 Service Worker
 * 方針:
 *  - 画面（ナビゲーション）= network-first … デプロイした最新HTMLを優先しつつ、オフライン時はキャッシュにフォールバック
 *  - 同一オリジンの静的アセット（PNG/JSON等）= stale-while-revalidate … 即表示＋裏で更新
 *  - フォント / Firebase SDK 配信(CDN) = stale-while-revalidate
 *  - Firebase Auth/Firestore API・OGP取得用CORSプロキシ等は「一切触らない」(respondWith しない=通常のネットワーク)
 * キャッシュを更新したら CACHE のバージョンを上げる。
 */
const CACHE = 'nekodana-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 即表示＋裏で更新（オフライン時はキャッシュ、無ければネットワーク結果）
function staleWhileRevalidate(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

// 最新優先（取得できなければキャッシュ→最後の砦として index.html）
function networkFirst(request) {
  return caches.open(CACHE).then((cache) =>
    fetch(request)
      .then((res) => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      })
      .catch(() => cache.match(request).then((c) => c || cache.match('./index.html')))
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // 書き込み系は触らない

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  // 画面遷移（HTML）= network-first
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 同一オリジンの静的アセットのみ stale-while-revalidate（それ以外の同一オリジンGETは既定動作）
  if (url.origin === self.location.origin) {
    if (/\.(?:png|jpg|jpeg|webp|svg|ico|json|webmanifest|css|js)$/i.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request));
    }
    return;
  }

  // 信頼できるCDN（Googleフォント / Firebase SDK 本体）= stale-while-revalidate
  const host = url.hostname;
  const isFonts = host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com';
  const isFirebaseSdk = host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs');
  if (isFonts || isFirebaseSdk) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // それ以外（Firebase Auth/Firestore API、OGP取得プロキシ等）はSWで触らない
});
