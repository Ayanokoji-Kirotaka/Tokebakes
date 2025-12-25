/* ==================== service-worker.js ==================== */

const CACHE_NAME = "toke-bakes-v2";
const OFFLINE_CACHE = "toke-bakes-offline";

// Assets to cache immediately
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/menu.html",
  "/gallery.html",
  "/order.html",
  "/styles/style.css",
  "/scripts/config.js",
  "/scripts/script.js",
  "/scripts/theme-manager.js",
  "/scripts/spa-manager.js",
  "/scripts/carousel.js",
  "/scripts/service-worker-manager.js",
  "/images/logo.webp",
  "/images/default-bg.jpg",
  "/images/favicon.webp",
];

// Install event - precache assets
self.addEventListener("install", (event) => {
  console.log("🔄 Service Worker installing...");

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("📦 Pre-caching assets...");
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log("✅ Pre-caching complete");
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("🔄 Service Worker activating...");

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName !== OFFLINE_CACHE) {
              console.log(`🗑️ Deleting old cache: ${cacheName}`);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log("✅ Service Worker activated");
        return self.clients.claim();
      })
  );
});

// Fetch event - cache-first with network fallback
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip chrome-extension requests
  if (event.request.url.startsWith("chrome-extension://")) return;

  // Skip Supabase API requests (handle separately)
  if (event.request.url.includes("supabase.co")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if available
      if (cachedResponse) {
        // Update cache in background
        event.waitUntil(updateCache(event.request));
        return cachedResponse;
      }

      // Otherwise fetch from network
      return fetch(event.request)
        .then((response) => {
          // Cache the response
          if (response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline fallback for HTML pages
          if (event.request.headers.get("Accept")?.includes("text/html")) {
            return caches.match("/offline.html") || caches.match("/index.html");
          }

          // Offline fallback for other assets
          return new Response(
            "Offline - Please check your internet connection",
            {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            }
          );
        });
    })
  );
});

// Update cache in background
async function updateCache(request) {
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response);
    }
  } catch (error) {
    // Silent fail for background updates
  }
}

// Handle messages from client
self.addEventListener("message", (event) => {
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data.type === "CLEAR_CACHE") {
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            return caches.delete(cacheName);
          })
        );
      })
      .then(() => {
        event.ports[0].postMessage({ success: true });
      });
  }
});

// Background sync for failed requests
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-orders") {
    event.waitUntil(syncOrders());
  }
});

async function syncOrders() {
  // This would sync any pending orders when back online
  console.log("🔄 Syncing pending orders...");
}
