/* PJ RGHS Daily Sheet - offline cache for the mobile app */
const CACHE = 'pj-rghs-4.0.0';
const FILES = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icons/icon192.png', './icons/icon512.png',
  '../lib/xlsx.full.min.js', '../shared.js', '../engine.js', '../sheet.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// network first (so updates arrive), cache when offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r && r.ok && new URL(e.request.url).origin === location.origin) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
