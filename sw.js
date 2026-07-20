const CACHE_NAME = 'omfs-case-tutor-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(()=> self.clients.claim())
  );
});

// Cache-first for the app shell. Everything else (in particular
// api.anthropic.com) always goes to the network — never cached,
// since it's the live case-generation call.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin){
    return; // let API calls and any cross-origin request pass straight through
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});