// Aktiekompassen – service worker. Nätet först, cache som reserv, så att appen öppnar även offline.
// API-anrop cachas aldrig.
const CACHE = 'aktiekompassen-v2';
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.indexOf('/api/') !== -1) return;
  if (url.origin !== self.location.origin && url.hostname.indexOf('fonts.') !== 0) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then(m => m || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
  );
});
