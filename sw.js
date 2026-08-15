// sw.js — cache the app shell so Pettagam opens instantly & offline.
const CACHE = 'pettagam-v1';
const SHELL = [
  './', 'index.html', 'manifest.json',
  'css/tokens.css', 'css/app.css',
  'js/app.js', 'js/views.js', 'js/db.js', 'js/schemas.js',
  'js/ai.js', 'js/reminders.js', 'js/backup.js', 'js/ui.js',
  'schemas/registry.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never cache AI API calls
  if (url.origin !== location.origin) return;
  // registry: network-first so schema updates arrive
  if (url.pathname.endsWith('registry.json')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // shell: cache-first
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
