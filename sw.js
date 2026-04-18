const CACHE_NAME = 'studiofc-v2';
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

// Instala e faz cache dos assets estáticos
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

// Estratégia: cache-first para assets estáticos, network-first para dados
self.addEventListener('fetch', function(e) {
  if (e.request.url.includes('script.google.com')) return;

  var url = e.request.url;
  var isStatic = /\.(webp|png|jpg|gif|js|css|woff2?)$/.test(url) ||
                 url.includes('fonts.g') ||
                 url.includes('cdnjs.cloudflare.com');

  if (isStatic) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
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
