const CACHE_NAME = "html-manager-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./modules/context.js",
  "./modules/core-module.js",
  "./modules/github-module.js",
  "./modules/auth-module.js",
  "./modules/view-module.js",
  "./modules/content-module.js",
  "./modules/events-module.js",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS.map(async (url) => {
          try {
            const resp = await fetch(url, { cache: "no-cache" });
            if (resp.ok) {
              await cache.put(url, resp);
            }
          } catch {
            // Ignore individual cache failures to avoid blocking install.
          }
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
