const CACHE = 'frequency-oasis-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

// Cache-first for the app shell. Everything else (station API calls,
// live audio streams, weather lookups) always goes to the network —
// radio streams must never be cached.
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  const isShellRequest = url.origin === self.location.origin;
  if(!isShellRequest){ return; } // let network handle API/audio/weather

  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
        return res;
      }).catch(()=>caches.match('./index.html'));
    })
  );
});
