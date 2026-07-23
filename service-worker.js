const CACHE="wondercraft-wc-7-28-1";
const FILES=[
  "./",
  "./index.html",
  "./style.css?v=7.23.0",
  "./config.js?v=7.28.1",
  "./app.js?v=7.28.1",
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
  if(event.request.method!=="GET") return;

  const isNavigation = event.request.mode === "navigate";

  if(isNavigation){
    event.respondWith(
      fetch(event.request,{cache:"no-store"})
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put("./index.html",copy));
          return response;
        })
        .catch(()=>caches.match("./index.html").then(cached=>cached||caches.match("./offline.html")))
    );
    return;
  }

  event.respondWith(
    fetch(event.request,{cache:"no-store"})
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request).then(cached=>cached||caches.match("./offline.html")))
  );
});


self.addEventListener("message", event => {
  if(event.data && event.data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});
