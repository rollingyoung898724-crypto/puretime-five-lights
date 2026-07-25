const CACHE_PREFIX = 'return-system-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/service-worker.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];
const OFFLINE_PAGE_URL = '/index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(
        APP_SHELL.map(url => new Request(url, { cache: 'reload' }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const updatePromise = fetchAndUpdate(event.request);
  event.waitUntil(updatePromise.catch(() => undefined));
  event.respondWith(cacheFirstWithBackgroundUpdate(event.request, updatePromise));
});

async function cacheFirstWithBackgroundUpdate(request, updatePromise) {
  const cached = await caches.match(request, {
    ignoreSearch: request.mode === 'navigate'
  });

  if (cached) return cached;

  if (request.mode === 'navigate') {
    const offlinePage = await caches.match(OFFLINE_PAGE_URL);
    if (offlinePage) return offlinePage;
  }

  try {
    return await updatePromise;
  } catch {
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function fetchAndUpdate(request) {
  const response = await fetch(request, { cache: 'no-cache' });
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
