// DualMind Service Worker v1.0
const CACHE = 'dualmind-v1';
const OFFLINE_URLS = [
  '/geomind.html',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(cache){
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  // Network first for API calls, cache first for assets
  if(e.request.url.includes('workers.dev') || e.request.url.includes('api.')){
    return; // Let API calls go through normally
  }
  e.respondWith(
    fetch(e.request).catch(function(){
      return caches.match(e.request).then(function(r){
        return r || caches.match('/geomind.html');
      });
    })
  );
});
