const STATIC_CACHE = "toke-bakes-static-v2";
const RUNTIME_CACHE = "toke-bakes-runtime-v2";

const PRECACHE_URLS = [
  "index.html",
  "menu.html",
  "gallery.html",
  "order.html",
  "admin-panel.html",
  "privacy.html",
  "terms-of-use.html",
  "manifest.json",
  "styles/style.css",
  "styles/theme-christmas.css",
  "styles/theme-halloween.css",
  "styles/theme-independenceday.css",
  "styles/theme-ramadan.css",
  "styles/theme-valentine.css",
  "scripts/config.js",
  "scripts/theme-manager.js",
  "scripts/carousel.js",
  "scripts/spa-manager.js",
  "scripts/script.js",
  "scripts/admin.js",
  "images/logo.webp",
  "images/valantine-logo.webp",
  "images/ramadan-logo.webp",
  "images/halloween-logo.webp",
  "images/independence-day-logo.webp",
  "images/christmas-logo.webp",
  "images/favicon.webp",
  "images/icon-192.png",
  "images/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (![STATIC_CACHE, RUNTIME_CACHE].includes(key)) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
      return response;
    });
  });
}

function networkFirst(request, fallbackUrl = "index.html") {
  return fetch(request)
    .then((response) => {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
      return response;
    })
    .catch(() => caches.match(request).then((cached) => cached || caches.match(fallbackUrl)));
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const fetchPromise = fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => cached);
    return cached || fetchPromise;
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  const isSupabase =
    url.hostname.includes("supabase.co") ||
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/");

  if (isSupabase) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.includes("/storage/v1/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "index.html"));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
