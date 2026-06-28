/**
 * FloatTube Service Worker
 * Cache-first for app shell. Pass-through for all external resources.
 * Increment CACHE_NAME whenever any shell file changes.
 */

const CACHE_NAME = 'floattube-v11';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/pip.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/youtube.js',
  '/js/pip.js',
  '/icons/icon.svg',
  '/icons/favicon.svg',
  '/manifest.json',
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        SHELL_FILES.map(url => cache.add(new Request(url, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove stale caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for same-origin shell files; network-only for everything else
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only cache-first for GET requests to our own origin
  if (request.method !== 'GET' || url.origin !== location.origin) {
    return; // fall through to normal network handling
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      // Shell file not in cache yet (shouldn't happen after install,
      // but handle gracefully for navigations during install)
      return fetch(request);
    })
  );
});
