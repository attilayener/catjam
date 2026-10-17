// Cat Jam service worker — tamamen yerel önbellekleme (uygulama çevrimdışı da çalışsın)
const VERSION = 'v1';
const STATIC_CACHE = `catjam-static-${VERSION}`;
const RUNTIME_CACHE = `catjam-runtime-${VERSION}`;

const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/cat-192.png', '/icons/cat-512.png', '/icons/cat-512-maskable.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE.map((p) => cache.add(new Request(p, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      if (k !== STATIC_CACHE && k !== RUNTIME_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // dış kaynaklara dokunma
  if (url.pathname.startsWith('/transformers/')) return;  // modeller kendi önbelleğinde (çift saklama olmasın)

  // sayfa gezinmesi: önce ağ → düşerse önbellekten index (offline açılış)
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put('/index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/')) || new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // statik varlıklar: önce önbellek, arka planda tazele
  e.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => undefined);
    if (cached) {
      void net; // arka plan tazeliği
      return cached;
    }
    const fresh = await net;
    return fresh || new Response('offline', { status: 503, statusText: 'offline' });
  })());
});
