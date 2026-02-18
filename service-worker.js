const SW_VERSION = "v6";
const CACHE_PREFIX = "toke-bakes";
const CACHE_NAMES = {
  precache: `${CACHE_PREFIX}-precache-${SW_VERSION}`,
  pages: `${CACHE_PREFIX}-pages-${SW_VERSION}`,
  assets: `${CACHE_PREFIX}-assets-${SW_VERSION}`,
  images: `${CACHE_PREFIX}-images-${SW_VERSION}`,
  api: `${CACHE_PREFIX}-api-${SW_VERSION}`,
  meta: `${CACHE_PREFIX}-meta-${SW_VERSION}`,
};

const OFFLINE_FALLBACK_URL = "index.html";
const SUPABASE_HOST_FRAGMENT = "supabase.co";
const PRUNE_DEBOUNCE_MS = 15000;
const META_KEY_PREFIX = `${self.location.origin}/__sw_meta__/`;

const CACHE_LIMITS = {
  [CACHE_NAMES.pages]: { maxEntries: 25, maxAgeMs: 24 * 60 * 60 * 1000 },
  [CACHE_NAMES.assets]: { maxEntries: 120, maxAgeMs: 14 * 24 * 60 * 60 * 1000 },
  [CACHE_NAMES.images]: { maxEntries: 280, maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
  [CACHE_NAMES.api]: { maxEntries: 60, maxAgeMs: 5 * 60 * 1000 },
};

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

const inFlightFetches = new Map();
const lastPruneAt = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAMES.precache);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })().catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const validCaches = new Set(Object.values(CACHE_NAMES));
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (!validCaches.has(key) && key.startsWith(CACHE_PREFIX)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );

      await self.clients.claim();
      await pruneAllCaches();
    })()
  );
});

self.addEventListener("message", (event) => {
  const message = event && event.data ? event.data : {};
  if (message.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (message.type === "PRUNE_CACHES") {
    event.waitUntil(pruneAllCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!isHttpRequest(request)) return;

  event.respondWith(routeRequest(request, event));
});

function isHttpRequest(request) {
  return (
    request.url.startsWith("http://") || request.url.startsWith("https://")
  );
}

function isSupabaseRequest(url) {
  return (
    url.hostname.includes(SUPABASE_HOST_FRAGMENT) ||
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/") ||
    url.pathname.includes("/storage/v1/")
  );
}

function isNavigationRequest(request) {
  const accept = request.headers.get("accept") || "";
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    accept.includes("text/html")
  );
}

function isScriptOrStyleRequest(request, url) {
  if (request.destination === "script" || request.destination === "style") {
    return true;
  }
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
}

function isFontRequest(request, url) {
  if (request.destination === "font") return true;
  return /\.(woff2?|ttf|otf)$/i.test(url.pathname);
}

function isImageRequest(request, url) {
  if (request.destination === "image") return true;
  return /\.(png|jpe?g|webp|gif|svg|avif|ico)$/i.test(url.pathname);
}

function isDataAssetRequest(url) {
  return url.pathname.endsWith(".json") || url.pathname.endsWith(".xml");
}

function isCacheableResponse(response, allowOpaque = false) {
  if (!response) return false;
  if (response.ok) return true;
  return allowOpaque && response.type === "opaque";
}

function canStoreRequest(request) {
  try {
    const url = new URL(request.url);
    return !url.searchParams.has("_");
  } catch {
    return true;
  }
}

function buildMetaKey(cacheName, requestUrl) {
  return `${META_KEY_PREFIX}${encodeURIComponent(
    cacheName
  )}/${encodeURIComponent(requestUrl)}`;
}

async function setCacheTimestamp(cacheName, requestUrl, timestamp = Date.now()) {
  const metaCache = await caches.open(CACHE_NAMES.meta);
  await metaCache.put(
    buildMetaKey(cacheName, requestUrl),
    new Response(String(timestamp), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  );
}

async function getCacheTimestamp(cacheName, requestUrl) {
  const metaCache = await caches.open(CACHE_NAMES.meta);
  const response = await metaCache.match(buildMetaKey(cacheName, requestUrl));
  if (!response) return 0;
  const value = Number(await response.text());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function deleteCacheTimestamp(cacheName, requestUrl) {
  const metaCache = await caches.open(CACHE_NAMES.meta);
  await metaCache.delete(buildMetaKey(cacheName, requestUrl));
}

async function fetchWithTimeout(request, options = {}, timeoutMs = 10000) {
  if (typeof AbortController === "undefined") {
    return fetch(request, options);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function dedupedFetch(request, options = {}, timeoutMs = 10000) {
  const cacheMode = options.cache || "default";
  const key = `${request.url}|${cacheMode}`;

  if (inFlightFetches.has(key)) {
    return inFlightFetches.get(key).then((response) => response.clone());
  }

  const networkPromise = fetchWithTimeout(request, options, timeoutMs).finally(
    () => {
      inFlightFetches.delete(key);
    }
  );
  inFlightFetches.set(key, networkPromise);

  return networkPromise.then((response) => response.clone());
}

async function cachePut(cacheName, request, response) {
  if (!canStoreRequest(request)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  await setCacheTimestamp(cacheName, request.url, Date.now());
}

function maybeSchedulePrune(cacheName, event) {
  const now = Date.now();
  const last = lastPruneAt.get(cacheName) || 0;
  if (now - last < PRUNE_DEBOUNCE_MS) return;
  lastPruneAt.set(cacheName, now);

  const task = pruneCache(cacheName).catch(() => {});
  if (event) {
    event.waitUntil(task);
  }
}

async function pruneCache(cacheName) {
  const limits = CACHE_LIMITS[cacheName];
  if (!limits) return;

  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  const now = Date.now();
  const entries = [];

  for (const request of requests) {
    const timestamp = await getCacheTimestamp(cacheName, request.url);
    if (limits.maxAgeMs && timestamp && now - timestamp > limits.maxAgeMs) {
      await cache.delete(request);
      await deleteCacheTimestamp(cacheName, request.url);
      continue;
    }
    entries.push({ request, timestamp: timestamp || 0 });
  }

  if (!limits.maxEntries || entries.length <= limits.maxEntries) return;

  entries.sort((a, b) => a.timestamp - b.timestamp);
  const removeCount = entries.length - limits.maxEntries;

  for (let i = 0; i < removeCount; i++) {
    const entry = entries[i];
    await cache.delete(entry.request);
    await deleteCacheTimestamp(cacheName, entry.request.url);
  }
}

async function pruneAllCaches() {
  await Promise.all([
    pruneCache(CACHE_NAMES.pages),
    pruneCache(CACHE_NAMES.assets),
    pruneCache(CACHE_NAMES.images),
    pruneCache(CACHE_NAMES.api),
  ]);
}

async function networkFirst(request, options = {}, event) {
  const {
    cacheName,
    timeoutMs = 10000,
    fetchOptions = {},
    fallbackUrl = null,
    allowOpaque = false,
  } = options;

  try {
    const networkResponse = await dedupedFetch(request, fetchOptions, timeoutMs);

    if (isCacheableResponse(networkResponse, allowOpaque)) {
      const writeTask = cachePut(cacheName, request, networkResponse.clone())
        .then(() => pruneCache(cacheName))
        .catch(() => {});
      if (event) {
        event.waitUntil(writeTask);
      }
    }

    return networkResponse;
  } catch {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return Response.error();
  }
}

async function staleWhileRevalidate(request, options = {}, event) {
  const {
    cacheName,
    timeoutMs = 12000,
    fetchOptions = {},
    allowOpaque = true,
  } = options;

  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const revalidateTask = dedupedFetch(request, fetchOptions, timeoutMs)
    .then(async (networkResponse) => {
      if (isCacheableResponse(networkResponse, allowOpaque)) {
        await cachePut(cacheName, request, networkResponse.clone());
        maybeSchedulePrune(cacheName, event);
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cached) {
    if (event) {
      event.waitUntil(revalidateTask);
    }
    return cached;
  }

  const fresh = await revalidateTask;
  return fresh || Response.error();
}

async function cacheFirst(request, options = {}, event) {
  const {
    cacheName,
    timeoutMs = 12000,
    fetchOptions = {},
    allowOpaque = true,
  } = options;

  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const limits = CACHE_LIMITS[cacheName];

  if (cached) {
    const timestamp = await getCacheTimestamp(cacheName, request.url);
    const expired =
      limits && limits.maxAgeMs && timestamp
        ? Date.now() - timestamp > limits.maxAgeMs
        : false;

    if (!expired) {
      return cached;
    }

    const refreshTask = dedupedFetch(request, fetchOptions, timeoutMs)
      .then(async (networkResponse) => {
        if (isCacheableResponse(networkResponse, allowOpaque)) {
          await cachePut(cacheName, request, networkResponse.clone());
          maybeSchedulePrune(cacheName, event);
        }
      })
      .catch(() => {});

    if (event) {
      event.waitUntil(refreshTask);
    }
    return cached;
  }

  try {
    const networkResponse = await dedupedFetch(request, fetchOptions, timeoutMs);
    if (isCacheableResponse(networkResponse, allowOpaque)) {
      const writeTask = cachePut(cacheName, request, networkResponse.clone())
        .then(() => pruneCache(cacheName))
        .catch(() => {});
      if (event) {
        event.waitUntil(writeTask);
      }
    }
    return networkResponse;
  } catch {
    return Response.error();
  }
}

async function routeRequest(request, event) {
  const url = new URL(request.url);

  if (isSupabaseRequest(url)) {
    return networkFirst(
      request,
      {
        cacheName: CACHE_NAMES.api,
        timeoutMs: 10000,
        fetchOptions: { cache: "no-store" },
        allowOpaque: false,
      },
      event
    );
  }

  if (isNavigationRequest(request)) {
    return networkFirst(
      request,
      {
        cacheName: CACHE_NAMES.pages,
        timeoutMs: 9000,
        fetchOptions: { cache: "no-store" },
        fallbackUrl: OFFLINE_FALLBACK_URL,
        allowOpaque: false,
      },
      event
    );
  }

  if (
    isScriptOrStyleRequest(request, url) ||
    isFontRequest(request, url) ||
    isDataAssetRequest(url)
  ) {
    return staleWhileRevalidate(
      request,
      {
        cacheName: CACHE_NAMES.assets,
        timeoutMs: 12000,
        fetchOptions: { cache: "no-cache" },
        allowOpaque: true,
      },
      event
    );
  }

  if (isImageRequest(request, url)) {
    return cacheFirst(
      request,
      {
        cacheName: CACHE_NAMES.images,
        timeoutMs: 12000,
        fetchOptions: { cache: "no-cache" },
        allowOpaque: true,
      },
      event
    );
  }

  return networkFirst(
    request,
    {
      cacheName: CACHE_NAMES.assets,
      timeoutMs: 12000,
      fetchOptions: { cache: "no-cache" },
      allowOpaque: true,
    },
    event
  );
}
