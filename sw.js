const CACHE_NAME = 'studiofc-v12';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/logo.webp',
  '/logo.png',
  '/fe.webp',
  '/fe.jpg',
  '/icons/icon-192.webp',
  '/icons/icon-512.webp',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];

// Instala e faz cache dos assets estÃ¡ticos
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Ativa e remove caches antigos
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// EstratÃ©gia: cache-first para assets estÃ¡ticos, network-first para dados
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  // Do not persist client images from Drive in the service worker cache.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  if (e.request.url.includes('script.google.com')) return;
  if (e.request.url.includes('/trivor')) return;
  if (e.request.url.includes('/api/')) return;

  var url = e.request.url;
  var isStatic = /\.(webp|png|jpg|gif|js|css|woff2?)$/.test(url) ||
                 url.includes('fonts.g') ||
                 url.includes('cdnjs.cloudflare.com');

  if (isStatic) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
          if (!response.ok) return response;
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
          return response;
        });
      })
    );
  } else {
    e.respondWith(
      fetch(e.request)
        .then(function(response) {
          if (!response.ok) return response;
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
          return response;
        })
        .catch(function() {
          return caches.match(e.request);
        })
    );
  }
});
