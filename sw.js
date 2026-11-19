// Service worker: houdt de app-bestanden offline beschikbaar.
// Gegevens van personen staan in IndexedDB en worden hier niet aangeraakt.
const CACHE = 'noremi-v12';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './ai.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => { if (!r.ok) throw new Error(u); return c.put(u, r); })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate voor bestanden van dezelfde herkomst; externe API's (Azure, D-ID) gaan ongemoeid door.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (cached) { network.catch(() => {}); return cached; }
      return (await network) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    })
  );
});
