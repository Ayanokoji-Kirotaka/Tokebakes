const STATIC_CACHE = "toke-bakes-static-v4";
const RUNTIME_CACHE = "toke-bakes-runtime-v4";

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
  "scripts/update-sync.js",
  "scripts/theme-manager.js",
  "scripts/carousel.js",
  "scripts/spa-manager.js",
  "scripts/script.js",
  "scripts/admin.js",
  "scripts/sw-register.js",
  "images/logo.webp",
  "images/valantine-logo.webp",
  "images/ramadan-logo.webp",
  "images/halloween-logo.webp",
  "images/independence-day-logo.webp",
  "images/christmas-logo.webp",
  "images/favicon.webp",
  "images/icon-192.png",
  "images/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {})
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
            if (key !== STATIC_CACHE && key !== RUNTIME_CACHE) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldBypassCache(url) {
  return (
    url.hostname.includes("supabase.co") ||
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/") ||
    url.pathname.includes("/storage/v1/")
  );
}

function isPageLikeRequest(request, url) {
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    request.headers.get("accept")?.includes("text/html")
  );
}

function isFreshnessCriticalAsset(url, request) {
  if (request.destination === "script" || request.destination === "style") {
    return true;
  }
  return (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".json")
  );
}

function networkFirst(request, fallbackUrl = null) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() =>
      caches
        .match(request)
        .then((cached) => {
          if (cached) return cached;
          if (fallbackUrl) return caches.match(fallbackUrl);
          return null;
        })
        .then((fallback) => fallback || Response.error())
    );
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const fetchPromise = fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => cached || Response.error());
    return cached || fetchPromise;
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (shouldBypassCache(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isPageLikeRequest(request, url)) {
    event.respondWith(networkFirst(request, "index.html"));
    return;
  }

  if (isFreshnessCriticalAsset(url, request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
