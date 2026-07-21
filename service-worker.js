const CACHE="wondercraft-wc-6-4-0";
const FILES=[
  "./",
  "./index.html",
  "./style.css?v=6.4.0",
  "./config.js?v=6.4.0",
  "./app.js?v=6.4.0",
  "./manifest.json",
  "./offline.html",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-1024.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request).then(cached=>cached||caches.match("./offline.html")))
  );
});
