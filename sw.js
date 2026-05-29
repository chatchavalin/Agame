// Bump CACHE_NAME whenever ANY asset changes to force update.
const CACHE_NAME = 'amath-v141-blankprompt';
const ASSETS = [
  '/Agame/',
  '/Agame/lobby.html',
  '/Agame/lobby.css',
  '/Agame/scan.html',
  '/Agame/js/scan.js',
  '/Agame/js/scan-camera.js',
  '/Agame/js/scan-ai.js',
  '/Agame/js/board-import.js',
  '/Agame/calculator.html',
  '/Agame/js/calculator.js',
  '/Agame/js/bingo-solver.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();  // activate immediately, don't wait for tabs to close
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // NEVER cache puzzle.html or any JS files — always fetch fresh.
  // This is critical so puzzle updates ship immediately.
  if (url.pathname.endsWith('puzzle.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('styles.css')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }
  // Other assets: network first, fall back to cache (offline-friendly)
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Allow page to send a message to clear all caches and unregister
self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_AND_UNREGISTER') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => self.registration.unregister())
    );
  }
});
