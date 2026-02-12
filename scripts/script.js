/* ================== EMERGENCY PATCH - PREVENT ERRORS ================== */
// These functions were removed but might still be called
if (typeof initFooterTheme === "undefined") {
  window.initFooterTheme = function () {
    /* Function removed */
  };
}

if (typeof updateFooterTheme === "undefined") {
  window.updateFooterTheme = function () {
    /* Function removed */
  };
}

if (typeof initThemeToggle === "undefined") {
  window.initThemeToggle = function () {
    /* Function removed - handled by theme-manager.js */
  };
}
/* ================== END PATCH ================== */
/* ================== script.js - TOKE BAKES WEBSITE ================== */

/* ================== ENHANCED AUTO-UPDATE SYSTEM ================== */
class WebsiteAutoUpdater {
  constructor() {
    this.lastUpdateKey = "toke_bakes_last_update";
    this.lastPayloadKey = "toke_bakes_last_update_payload";
    this.dbLastUpdateKey = "toke_bakes_db_last_updated";
    this.dbCheckInterval = 60000;
    this.lastDbCheck = 0;
    this.broadcastChannel = null;
    this.syncBus = null;
    this.unsubscribeSync = null;
    this.boundStorageFallback = null;
    this.boundCustomFallback = null;
    this.pollingInterval = null;
    this.isRefreshing = false;
    this.pendingRefresh = false;
    this.lastRefreshAt = 0;
    this.minRefreshGapMs = 1200;
    this.syncIndicatorTimer = null;
    this.refreshWatchdogTimer = null;
    this.init();
  }

  init() {
    debugLog("Initializing Enhanced WebsiteAutoUpdater...");

    this.setupRealtimeSync();

    // 2. Check for updates every 25 seconds
    this.startPolling(25000); // 25 seconds

    // 3. Check when user returns to tab
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        debugLog("Tab became visible, checking for updates...");
        this.checkForUpdates();
      }
    });

    // 4. Initial check on page load (faster so recent admin edits appear sooner)
    setTimeout(() => this.checkForUpdates(), 800);

    window.addEventListener(
      "beforeunload",
      () => {
        this.destroy();
      },
      { once: true }
    );
  }

  setupRealtimeSync() {
    if (window.TokeUpdateSync && typeof window.TokeUpdateSync.subscribe === "function") {
      this.syncBus = window.TokeUpdateSync;
      this.unsubscribeSync = this.syncBus.subscribe((payload) => {
        if (!payload || payload.type !== "DATA_UPDATED") return;
        debugLog("Update received via shared sync bus", payload);
        this.handleExternalUpdate(payload);
      });
      return;
    }

    // Legacy fallback path when shared sync bus is not loaded.
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.broadcastChannel = new BroadcastChannel("toke_bakes_data_updates");
        this.broadcastChannel.onmessage = (event) => {
          if (event?.data?.type === "DATA_UPDATED") {
            debugLog("BroadcastChannel update received!", event.data);
            this.handleExternalUpdate(event.data);
          }
        };
        debugLog("BroadcastChannel ready for legacy sync");
      } catch (error) {
        debugWarn("BroadcastChannel unavailable; using fallback sync:", error);
        this.broadcastChannel = null;
      }
    }

    this.boundStorageFallback = (event) => {
      if (event.key === this.lastPayloadKey && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (parsed?.type === "DATA_UPDATED") {
            this.handleExternalUpdate(parsed);
          }
          return;
        } catch {}
      }

      if (event.key === this.lastUpdateKey && event.newValue) {
        this.handleExternalUpdate({
          type: "DATA_UPDATED",
          timestamp: event.newValue,
        });
      }
    };
    window.addEventListener("storage", this.boundStorageFallback);

    this.boundCustomFallback = (event) => {
      const detail = event?.detail || {};
      if (detail.type === "DATA_UPDATED") {
        this.handleExternalUpdate(detail);
      }
    };
    window.addEventListener("toke:data-updated", this.boundCustomFallback);
  }

  destroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }

    if (this.unsubscribeSync) {
      try {
        this.unsubscribeSync();
      } catch {}
      this.unsubscribeSync = null;
    }

    if (this.boundStorageFallback) {
      window.removeEventListener("storage", this.boundStorageFallback);
      this.boundStorageFallback = null;
    }

    if (this.boundCustomFallback) {
      window.removeEventListener("toke:data-updated", this.boundCustomFallback);
      this.boundCustomFallback = null;
    }

    if (this.syncIndicatorTimer) {
      clearTimeout(this.syncIndicatorTimer);
      this.syncIndicatorTimer = null;
    }

    if (this.refreshWatchdogTimer) {
      clearTimeout(this.refreshWatchdogTimer);
      this.refreshWatchdogTimer = null;
    }
  }

  handleExternalUpdate(payload = {}) {
    const tsNumber = Number(payload.timestamp) || Date.now();
    const myLastCheck = Number(localStorage.getItem("my_last_check") || "0");
    if (tsNumber <= myLastCheck) {
      return;
    }

    const ts = String(tsNumber);
    localStorage.setItem("my_last_check", ts);
    this.refreshDataWithUI();
  }

  startPolling(interval = 25000) {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => {
      if (document.hidden) {
        return;
      }
      this.checkForUpdates();
    }, interval);
    debugLog(`Polling started (every ${interval / 1000}s)`);
  }

  getLatestUpdateTimestamp() {
    const localTs = Number(localStorage.getItem(this.lastUpdateKey) || "0");

    let payloadTs = 0;
    try {
      const payloadRaw = localStorage.getItem(this.lastPayloadKey);
      if (payloadRaw) {
        const parsed = JSON.parse(payloadRaw);
        payloadTs = Number(parsed?.timestamp) || 0;
      }
    } catch {}

    return Math.max(localTs, payloadTs);
  }

  async checkForUpdates() {
    const lastUpdate = this.getLatestUpdateTimestamp();
    const myLastCheck = Number(localStorage.getItem("my_last_check") || "0");

    if (lastUpdate && lastUpdate > myLastCheck) {
      debugLog("Update detected via localStorage/timestamp");
      localStorage.setItem("my_last_check", String(lastUpdate));
      await this.refreshDataWithUI();
      return true;
    }

    const dbUpdated = await this.checkDatabaseForUpdates();
    return dbUpdated;
  }

  async checkDatabaseForUpdates() {
    if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastDbCheck < this.dbCheckInterval) {
      return false;
    }
    this.lastDbCheck = now;

    try {
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/rpc/site_last_updated`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const value = Array.isArray(data) ? data[0] : data;
      if (!value) return false;

      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return false;

      const lastKnown = Number(
        localStorage.getItem(this.dbLastUpdateKey) || "0"
      );

      if (parsed > lastKnown) {
        localStorage.setItem(this.dbLastUpdateKey, parsed.toString());
        await this.refreshDataWithUI();
        return true;
      }
    } catch (error) {
      debugWarn("Database update check failed:", error);
    }

    return false;
  }

  async refreshDataWithUI() {
    const now = Date.now();
    if (this.isRefreshing) {
      this.pendingRefresh = true;
      return;
    }

    const sinceLast = now - this.lastRefreshAt;
    if (sinceLast < this.minRefreshGapMs) {
      if (!this.pendingRefresh) {
        this.pendingRefresh = true;
        setTimeout(() => {
          if (!this.pendingRefresh) return;
          this.pendingRefresh = false;
          this.refreshDataWithUI();
        }, this.minRefreshGapMs - sinceLast);
      }
      return;
    }

    this.isRefreshing = true;
    this.lastRefreshAt = now;

    // Show syncing indicator
    this.showSyncIndicator("syncing");
    this.clearSyncTimers();
    this.refreshWatchdogTimer = setTimeout(() => {
      if (!this.isRefreshing) return;
      this.isRefreshing = false;
      this.pendingRefresh = false;
      this.showSyncIndicator("error");
      this.syncIndicatorTimer = setTimeout(() => this.hideSyncIndicator(), 3000);
    }, 20000);

    try {
      debugLog("Refreshing website data...");

      // Keep cached content for smooth refresh

      // Reload content based on current page
      if (typeof loadDynamicContent === "function") {
        await loadDynamicContent(true, true);
        debugLog("Dynamic content reloaded");
      }

      // Reload carousel if present (homepage)
      if (window.heroCarousel) {
        if (typeof window.heroCarousel.refresh === "function") {
          await window.heroCarousel.refresh(true, { showLoading: false });
        } else if (typeof window.heroCarousel.init === "function") {
          await window.heroCarousel.init();
        }
      } else if (
        document.querySelector(".hero-carousel") &&
        typeof window.initializeCarousel === "function"
      ) {
        window.initializeCarousel();
      }

      // Also refresh cart if on order page
      if (
        window.location.pathname.includes("order") &&
        typeof renderCartOnOrderPage === "function"
      ) {
        await renderCartOnOrderPage(true);
        debugLog("Cart refreshed");
      }

      // Show success indicator
      this.showSyncIndicator("updated");

      // Show notification
      this.showUpdateNotification();

      // Hide indicator after 2 seconds
      this.syncIndicatorTimer = setTimeout(() => this.hideSyncIndicator(), 2000);
    } catch (error) {
      console.error("Sync refresh failed:", error);
      this.hideSyncIndicator();

      // Show error state briefly
      this.showSyncIndicator("error");
      this.syncIndicatorTimer = setTimeout(() => this.hideSyncIndicator(), 3000);
    } finally {
      this.isRefreshing = false;
      if (this.refreshWatchdogTimer) {
        clearTimeout(this.refreshWatchdogTimer);
        this.refreshWatchdogTimer = null;
      }

      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        queueMicrotask(() => this.refreshDataWithUI());
      }
    }
  }

  clearSyncTimers() {
    if (this.syncIndicatorTimer) {
      clearTimeout(this.syncIndicatorTimer);
      this.syncIndicatorTimer = null;
    }
    if (this.refreshWatchdogTimer) {
      clearTimeout(this.refreshWatchdogTimer);
      this.refreshWatchdogTimer = null;
    }
  }

  showSyncIndicator(state) {
    let indicator = document.getElementById("sync-status-indicator");

    if (!indicator) {
      // Create indicator if it doesn't exist
      indicator = document.createElement("div");
      indicator.id = "sync-status-indicator";
      document.body.appendChild(indicator);
    }

    indicator.style.display = "";

    // Reset classes
    indicator.className = "";
    if (state !== "error") {
      indicator.style.cssText = "";
    }

    // Set state
    if (state === "syncing") {
      indicator.classList.add("syncing");
      indicator.textContent = "\u27F3";
      indicator.title = "Updating content...";
    } else if (state === "updated") {
      indicator.classList.add("updated");
      indicator.textContent = "\u2713";
      indicator.title = "Content updated!";
    } else if (state === "error") {
      indicator.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        width: 40px; height: 40px; border-radius: 50%;
        background: #dc3545; color: white; display: flex;
        align-items: center; justify-content: center;
        font-size: 1.2rem; z-index: 10000;
      `;
      indicator.innerHTML = "!";
      indicator.title = "Update failed";
    }
  }

  hideSyncIndicator() {
    if (this.syncIndicatorTimer) {
      clearTimeout(this.syncIndicatorTimer);
      this.syncIndicatorTimer = null;
    }
    const indicator = document.getElementById("sync-status-indicator");
    if (indicator) {
      indicator.style.display = "none";
      indicator.className = "";
    }
  }

  showUpdateNotification() {
    // Optional: You can enable this for visual toast
    // For now, just log to console
    debugLog("Website content updated successfully!");

    // If you want a toast notification later, uncomment:
    /*
    showNotification('Content updated! New items are available.', 'success');
    */
  }
}

// ================== DATA SOURCE CONFIGURATION ==================

const useSupabase = true; // Always use Supabase

// Debug logger (disabled for production)
const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
const debugWarn = (...args) => {
  if (DEBUG) console.warn(...args);
};

// ================== DATA LOADING FUNCTIONS ==================

// Cache for menu items to reduce API calls
let cachedMenuItems = null;
let cacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// General cache for all data
const dataCache = new Map();
const CACHE_DURATION_GENERAL = 24 * 60 * 60 * 1000; // 24 hours
const MENU_CACHE_KEY = "toke_bakes_menu_cache_v1";
const CONTENT_CONTAINER_IDS = [
  "featured-container",
  "menu-container",
  "gallery-container",
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toSafeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeAssetPath(value) {
  const raw = toSafeString(value);
  if (!raw) return "";
  return raw.replace(/\s+\.(?=[a-z0-9]+($|\?))/gi, ".");
}

const PUBLIC_IMAGE_PLACEHOLDERS = {
  featured:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg==",
  menu: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lbnUgSXRlbTwvdGV4dD48L3N2Zz4=",
  gallery:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkdhbGxlcnk8L3RleHQ+PC9zdmc+=",
};

function looksLikeImageSrc(value) {
  const raw = toSafeString(value).toLowerCase();
  if (!raw) return false;
  if (raw.startsWith("data:image/")) return true;
  if (raw.startsWith("blob:")) return true;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return true;
  if (raw.startsWith("//")) return true;
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) {
    return true;
  }
  if (raw.startsWith("images/")) return true;
  return raw.includes("/");
}

function resolveImageForDisplay(rawValue, placeholderDataUri) {
  const normalized = normalizeAssetPath(rawValue);
  if (!normalized) return placeholderDataUri;
  const lower = normalized.toLowerCase();
  if (lower.startsWith("placeholder-")) {
    return placeholderDataUri;
  }
  if (!looksLikeImageSrc(normalized)) return placeholderDataUri;
  return normalized;
}

function parseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseBoolean(value, fallback = true) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function normalizeDateOnly(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().split("T")[0];
}

function sortByDisplayAndCreated(items) {
  return [...items].sort((a, b) => {
    const aOrder = parseNumber(a.display_order, 0);
    const bOrder = parseNumber(b.display_order, 0);
    if (aOrder !== bOrder) return aOrder - bOrder;

    const aCreated = Date.parse(a.created_at || "") || 0;
    const bCreated = Date.parse(b.created_at || "") || 0;
    return bCreated - aCreated;
  });
}

function normalizeFeaturedItem(rawItem = {}, index = 0) {
  return {
    id: rawItem.id ?? `featured-${index}`,
    title: toSafeString(rawItem.title || rawItem.name, "Featured Item"),
    description: toSafeString(
      rawItem.description || rawItem.subtitle || rawItem.summary,
      ""
    ),
    image: resolveImageForDisplay(
      rawItem.image || rawItem.image_url || rawItem.src,
      PUBLIC_IMAGE_PLACEHOLDERS.featured
    ),
    display_order: parseNumber(rawItem.display_order, index),
    is_active: parseBoolean(rawItem.is_active ?? rawItem.active, true),
    start_date: normalizeDateOnly(rawItem.start_date || rawItem.startDate),
    end_date: normalizeDateOnly(rawItem.end_date || rawItem.endDate),
    created_at: rawItem.created_at || rawItem.createdAt || null,
  };
}

function normalizeMenuItem(rawItem = {}, index = 0) {
  return {
    id: rawItem.id ?? `menu-${index}`,
    title: toSafeString(rawItem.title || rawItem.name, "Menu Item"),
    description: toSafeString(
      rawItem.description || rawItem.details || rawItem.subtitle,
      ""
    ),
    price: parseNumber(rawItem.price ?? rawItem.amount ?? rawItem.cost, 0),
    image: resolveImageForDisplay(
      rawItem.image || rawItem.image_url || rawItem.src,
      PUBLIC_IMAGE_PLACEHOLDERS.menu
    ),
    is_available: parseBoolean(
      rawItem.is_available ?? rawItem.available ?? rawItem.is_active,
      true
    ),
    display_order: parseNumber(rawItem.display_order, index),
    created_at: rawItem.created_at || rawItem.createdAt || null,
    category: toSafeString(rawItem.category || "pastries", "pastries"),
    tags: Array.isArray(rawItem.tags)
      ? rawItem.tags
      : toSafeString(rawItem.tags)
      ? toSafeString(rawItem.tags)
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
    calories:
      rawItem.calories === null || rawItem.calories === undefined
        ? null
        : parseNumber(rawItem.calories, null),
  };
}

function normalizeGalleryItem(rawItem = {}, index = 0) {
  const width = parseNumber(rawItem.width, null);
  const height = parseNumber(rawItem.height, null);
  return {
    id: rawItem.id ?? `gallery-${index}`,
    alt: toSafeString(rawItem.alt || rawItem.title || rawItem.caption, "Gallery image"),
    image: resolveImageForDisplay(
      rawItem.image || rawItem.image_url || rawItem.src,
      PUBLIC_IMAGE_PLACEHOLDERS.gallery
    ),
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
    display_order: parseNumber(rawItem.display_order, index),
    created_at: rawItem.created_at || rawItem.createdAt || null,
  };
}

function normalizeFeaturedItems(items) {
  const normalized = toArray(items).map((item, index) =>
    normalizeFeaturedItem(item, index)
  );
  return sortByDisplayAndCreated(normalized);
}

function normalizeMenuItems(items) {
  const normalized = toArray(items).map((item, index) =>
    normalizeMenuItem(item, index)
  );
  return sortByDisplayAndCreated(normalized);
}

function normalizeGalleryItems(items) {
  const normalized = toArray(items).map((item, index) =>
    normalizeGalleryItem(item, index)
  );
  return sortByDisplayAndCreated(normalized);
}

function normalizeQuery(query) {
  if (!query) {
    return "?select=*&order=created_at.desc";
  }
  return query.startsWith("?") ? query : `?${query}`;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function buildFeaturedQuery() {
  return `?select=*&order=display_order.asc,created_at.desc`;
}

function buildMenuQuery() {
  return `?select=*&order=display_order.asc,created_at.desc`;
}

function buildGalleryQuery() {
  return `?select=*&order=display_order.asc,created_at.desc`;
}

function isFeaturedActive(item) {
  if (!parseBoolean(item?.is_active, true)) {
    return false;
  }

  const today = todayISO();
  const startDate = normalizeDateOnly(item?.start_date);
  const endDate = normalizeDateOnly(item?.end_date);

  if (startDate && startDate > today) {
    return false;
  }
  if (endDate && endDate < today) {
    return false;
  }

  return true;
}

// Load from Supabase with caching
async function loadFromSupabase(endpoint, query = "", options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const cacheKey = `${endpoint}${normalizedQuery}`;
  const now = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);

  // Check cache
  if (!forceRefresh && dataCache.has(cacheKey)) {
    const { data, timestamp } = dataCache.get(cacheKey);
    if (now - timestamp < CACHE_DURATION_GENERAL) {
      debugLog(`Using cached data for ${endpoint}`);
      return data;
    } else {
      dataCache.delete(cacheKey);
    }
  }

  // Check if Supabase config is available
  if (
    !window.SUPABASE_CONFIG ||
    !window.SUPABASE_CONFIG.URL ||
    !window.SUPABASE_CONFIG.ANON_KEY
  ) {
    throw new Error("Supabase configuration not found");
  }

  const requestUrl = forceRefresh
    ? `${SUPABASE_CONFIG.URL}${endpoint}${normalizedQuery}${
        normalizedQuery.includes("?") ? "&" : "?"
      }_=${now}`
    : `${SUPABASE_CONFIG.URL}${endpoint}${normalizedQuery}`;

  const response = await fetch(requestUrl, {
    headers: {
      apikey: SUPABASE_CONFIG.ANON_KEY,
      Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status})`);
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data : [];

  // Cache the result
  dataCache.set(cacheKey, { data: result, timestamp: now });
  debugLog(`Cached data for ${endpoint}`);

  return result;
}

// Get menu items with caching
async function getMenuItems(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    cachedMenuItems &&
    cacheTimestamp &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    return cachedMenuItems;
  }

  try {
    const freshItems = normalizeMenuItems(
      await loadFromSupabase(API_ENDPOINTS.MENU, buildMenuQuery(), {
        forceRefresh,
      })
    );

    cachedMenuItems = freshItems;
    cacheTimestamp = now;
    return cachedMenuItems;
  } catch (error) {
    debugWarn("Menu fetch failed; using cached data if available:", error);

    let fallbackItems = null;
    let fallbackTs = null;

    // LocalStorage fallback
    try {
      const cached = localStorage.getItem(MENU_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_DURATION_GENERAL) {
          fallbackItems = normalizeMenuItems(parsed?.data);
          fallbackTs = parsed.timestamp || now;
        }
      }
    } catch {}

    // In-memory fallback
    if (fallbackItems === null && cachedMenuItems) {
      fallbackItems = cachedMenuItems;
      fallbackTs = cacheTimestamp || now;
    }

    if (fallbackItems !== null) {
      cachedMenuItems = fallbackItems;
      cacheTimestamp = fallbackTs || now;
    }

    throw error;
  }
}

// ================== LOAD FEATURED ITEMS - FIXED VERSION ==================
async function loadFeaturedItems(forceReload = false, silentRefresh = false) {
  const container = document.getElementById("featured-container");
  if (!container) return;

  // Check if we already have content to prevent flash
  if (
    container.children.length > 0 &&
    !container.querySelector(".loading-message") &&
    !forceReload
  ) {
    debugLog("Featured items already loaded, skipping");
    return;
  }

  // Check cache first - don't show loading if we have cached data
  const dataCacheKey = `${API_ENDPOINTS.FEATURED}_data`;
  let cachedData = null;

  const allowCachedView = !forceReload || silentRefresh;
  if (allowCachedView) {
    const cached = localStorage.getItem(dataCacheKey);
    try {
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_DURATION_GENERAL) {
          cachedData = normalizeFeaturedItems(parsed.data);
          debugLog("Using cached featured items");
        }
      }
    } catch (e) {}
  }

  if (cachedData !== null) {
    const cachedActive = cachedData.filter(isFeaturedActive);
    if (cachedActive.length > 0) {
      renderFeaturedItems(container, cachedActive);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-star"></i>
          <p>No featured items yet. Check back soon!</p>
          <p class="small">Admin can add items in the admin panel</p>
        </div>
      `;
    }
    setContainerLoading(container, false);
    if (!forceReload) return;
  }

  const shouldShowLoading = cachedData === null && !silentRefresh;

  // Only show loading if no cache
  if (shouldShowLoading) {
    setContainerLoading(container, true);
    container.innerHTML = `
      <div class="loading-message">
        <div class="loading-spinner"></div>
        <p>Loading featured creations...</p>
      </div>
    `;
  }

  try {
    // Try to load fresh data
    const freshItems = normalizeFeaturedItems(
      await loadFromSupabase(
      API_ENDPOINTS.FEATURED,
      buildFeaturedQuery(),
      { forceRefresh: forceReload }
      )
    );

    // Cache successful response (even if empty) so stale content doesn't linger.
    try {
      localStorage.setItem(
        dataCacheKey,
        JSON.stringify({ data: freshItems, timestamp: Date.now() })
      );
    } catch (e) {}

    const items = freshItems.filter(isFeaturedActive);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-star"></i>
          <p>No featured items yet. Check back soon!</p>
          <p class="small">Admin can add items in the admin panel</p>
        </div>
      `;
      return;
    }

    renderFeaturedItems(container, items);
  } catch (error) {
    console.error("Error loading featured items:", error);

    // If error but we have cached data, keep showing it (including empty-state).
    if (cachedData !== null) {
      const cachedActive = cachedData.filter(isFeaturedActive);
      if (cachedActive.length > 0) {
        renderFeaturedItems(container, cachedActive);
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-star"></i>
            <p>No featured items yet. Check back soon!</p>
            <p class="small">Admin can add items in the admin panel</p>
          </div>
        `;
      }
    } else {
      container.innerHTML = `
        <div class="empty-state error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Unable to load featured items.</p>
          <p class="small">Please check your connection</p>
        </div>
      `;
    }
  } finally {
    if (shouldShowLoading) {
      setContainerLoading(container, false);
    }
  }
}

// ================== LOAD MENU ITEMS - FIXED VERSION ==================
async function loadMenuItems(forceReload = false, silentRefresh = false) {
  const container = document.getElementById("menu-container");
  if (!container) return;

  // Check if we already have content to prevent flash
  if (
    container.children.length > 0 &&
    !container.querySelector(".loading-message") &&
    !forceReload
  ) {
    debugLog("Menu items already loaded, skipping");
    return;
  }

  // Check cache first
  let cachedData = null;
  const now = Date.now();

  const allowCachedView = !forceReload || silentRefresh;
  if (allowCachedView) {
    if (
      cachedMenuItems &&
      cacheTimestamp &&
      now - cacheTimestamp < CACHE_DURATION
    ) {
      cachedData = cachedMenuItems;
      debugLog("Using cached menu items");
    }

    if (!cachedData) {
      try {
        const cached = localStorage.getItem(MENU_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < CACHE_DURATION_GENERAL) {
            cachedData = normalizeMenuItems(parsed.data);
            debugLog("Using localStorage cached menu items");
          }
        }
      } catch (err) {
        debugLog("Could not read menu cache");
      }
    }
  }

  if (cachedData !== null) {
    const cachedAvailable = cachedData.filter(isMenuItemAvailable);
    if (cachedAvailable.length > 0) {
      renderMenuItems(container, cachedAvailable);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>Our menu is being prepared.</p>
          <p class="small">Delicious items coming soon!</p>
        </div>
      `;
    }
    setContainerLoading(container, false);
    if (!forceReload) return;
  }

  const shouldShowLoading = cachedData === null && !silentRefresh;

  // Only show loading if no cache
  if (shouldShowLoading) {
    setContainerLoading(container, true);
    container.innerHTML = `
      <div class="loading-message">
        <div class="loading-spinner"></div>
        <p>Loading menu items...</p>
      </div>
    `;
  }

  try {
    // Try to load fresh data
    const allItems = normalizeMenuItems(await getMenuItems(forceReload));

    // Update cache (even if empty) so stale content doesn't linger.
    cachedMenuItems = allItems;
    cacheTimestamp = Date.now();
    try {
      localStorage.setItem(
        MENU_CACHE_KEY,
        JSON.stringify({ data: allItems, timestamp: Date.now() })
      );
    } catch {
      debugLog("Could not write menu cache");
    }

    const items = allItems.filter(isMenuItemAvailable);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>Our menu is being prepared.</p>
          <p class="small">Delicious items coming soon!</p>
        </div>
      `;
      return;
    }

    renderMenuItems(container, items);
  } catch (error) {
    console.error("Error loading menu items:", error);

    const fallback =
      cachedData !== null
        ? cachedData
        : cachedMenuItems
          ? cachedMenuItems
          : null;

    // If error but we have cached data, keep showing it (including empty-state).
    if (fallback !== null) {
      const fallbackAvailable = normalizeMenuItems(fallback).filter(
        isMenuItemAvailable
      );
      if (fallbackAvailable.length > 0) {
        renderMenuItems(container, fallbackAvailable);
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-utensils"></i>
            <p>Our menu is being prepared.</p>
            <p class="small">Delicious items coming soon!</p>
          </div>
        `;
      }
    } else {
      container.innerHTML = `
        <div class="empty-state error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Unable to load menu.</p>
          <p class="small">Please try again later</p>
        </div>
      `;
    }
  } finally {
    if (shouldShowLoading) {
      setContainerLoading(container, false);
    }
  }
}

// ================== LOAD GALLERY IMAGES - FIXED VERSION ==================
async function loadGalleryImages(forceReload = false, silentRefresh = false) {
  const container = document.getElementById("gallery-container");
  if (!container) return;

  // Check if we already have content to prevent flash
  if (
    container.children.length > 0 &&
    !container.querySelector(".loading-message") &&
    !forceReload
  ) {
    debugLog("Gallery images already loaded, skipping");
    return;
  }

  // Check cache first
  const dataCacheKey = `${API_ENDPOINTS.GALLERY}_data`;
  let cachedData = null;

  const allowCachedView = !forceReload || silentRefresh;
  if (allowCachedView) {
    try {
      const cached = localStorage.getItem(dataCacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_DURATION_GENERAL) {
          cachedData = normalizeGalleryItems(parsed.data);
          debugLog("Using cached gallery images");
        }
      }
    } catch (e) {}
  }

  if (cachedData !== null) {
    if (cachedData.length > 0) {
      renderGalleryImages(container, cachedData);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>Gallery coming soon!</p>
          <p class="small">Beautiful creations will be here shortly</p>
        </div>
      `;
    }
    setContainerLoading(container, false);
    if (!forceReload) return;
  }

  const shouldShowLoading = cachedData === null && !silentRefresh;

  // Only show loading if no cache
  if (shouldShowLoading) {
    setContainerLoading(container, true);
    container.innerHTML = `
      <div class="loading-message">
        <div class="loading-spinner"></div>
        <p>Loading gallery images...</p>
      </div>
    `;
  }

  try {
    // Try to load fresh data
    const items = normalizeGalleryItems(
      await loadFromSupabase(
      API_ENDPOINTS.GALLERY,
      buildGalleryQuery(),
      { forceRefresh: forceReload }
      )
    );

    // Cache successful response (even if empty) so stale content doesn't linger.
    try {
      localStorage.setItem(
        dataCacheKey,
        JSON.stringify({ data: items, timestamp: Date.now() })
      );
    } catch (e) {}

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>Gallery coming soon!</p>
          <p class="small">Beautiful creations will be here shortly</p>
        </div>
      `;
      return;
    }

    renderGalleryImages(container, items);
  } catch (error) {
    console.error("Error loading gallery images:", error);

    // If error but we have cached data, keep showing it (including empty-state).
    if (cachedData !== null) {
      if (cachedData.length > 0) {
        renderGalleryImages(container, cachedData);
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-images"></i>
            <p>Gallery coming soon!</p>
            <p class="small">Beautiful creations will be here shortly</p>
          </div>
        `;
      }
    } else {
      container.innerHTML = `
        <div class="empty-state error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Unable to load gallery.</p>
          <p class="small">Please check your connection</p>
        </div>
      `;
    }
  } finally {
    if (shouldShowLoading) {
      setContainerLoading(container, false);
    }
  }
}

// ================== LOAD DYNAMIC CONTENT - FIXED VERSION ==================
async function loadDynamicContent(forceReload = false, silentRefresh = false) {
  await waitForThemeReady();
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  debugLog("Loading content for page:", currentPage);

  const showLoading = !silentRefresh;
  if (showLoading) {
    document.body.classList.add("cms-loading");
  }

  try {
    // Clear any existing loading states FIRST
    clearLoadingStates();

    if (forceReload && !silentRefresh) {
      clearContentCaches();
    }

    // Check if Supabase config exists
    if (!window.SUPABASE_CONFIG || !window.API_ENDPOINTS) {
      console.error("Supabase configuration not loaded");
      showConfigError();
      return;
    }

    const pageLoaders = [
      {
        matches: (page) =>
          page.includes("index") ||
          page === "" ||
          page === "/" ||
          page === "index.html",
        label: "featured items for homepage",
        handler: loadFeaturedItems,
      },
      {
        matches: (page) => page.includes("menu"),
        label: "menu items",
        handler: loadMenuItems,
      },
      {
        matches: (page) => page.includes("gallery"),
        label: "gallery images",
        handler: loadGalleryImages,
      },
    ];

    const activeLoader = pageLoaders.find(({ matches }) => matches(currentPage));
    if (activeLoader) {
      debugLog(`Loading ${activeLoader.label}`);
      await activeLoader.handler(forceReload, silentRefresh);
    }

    debugLog("Content loading complete for:", currentPage);
  } finally {
    if (showLoading) {
      document.body.classList.remove("cms-loading");
    }

    // Home-only UI (scroll reveal + scroll-to-top) should refresh after content loads
    refreshHomeEnhancements();
    initModern3DInteractions();
  }
}

// ================== HELPER FUNCTIONS ==================
function setContainerLoading(container, isLoading) {
  if (!container) return;
  if (isLoading) {
    container.setAttribute("data-loading", "true");
  } else {
    container.removeAttribute("data-loading");
  }
}

function clearLoadingStates() {
  debugLog("Clearing loading states");

  CONTENT_CONTAINER_IDS.forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      const existingLoader = container.querySelector(".loading-message");

      // If this container is still on its initial stub loader, keep it masked to prevent flashing.
      const hasOnlyLoader =
        existingLoader && container.children && container.children.length === 1;

      if (hasOnlyLoader) {
        container.setAttribute("data-loading", "true");
        return;
      }

      container.removeAttribute("data-loading");
      if (existingLoader) existingLoader.remove();
    }
  });
}

function waitForThemeReady(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const link = document.getElementById("theme-stylesheet");
    const alreadyReady =
      !document.documentElement.classList.contains("theme-loading") ||
      (link && link.dataset.loaded === "true");

    if (alreadyReady) {
      resolve();
      return;
    }

    const done = () => {
      window.removeEventListener("theme:ready", done);
      resolve();
    };

    window.addEventListener("theme:ready", done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

function clearContentCaches() {
  cachedMenuItems = null;
  cacheTimestamp = null;

  if (dataCache && dataCache.clear) {
    dataCache.clear();
  }

  try {
    localStorage.removeItem(MENU_CACHE_KEY);
    if (window.API_ENDPOINTS?.FEATURED) {
      localStorage.removeItem(`${window.API_ENDPOINTS.FEATURED}_data`);
    }
    if (window.API_ENDPOINTS?.GALLERY) {
      localStorage.removeItem(`${window.API_ENDPOINTS.GALLERY}_data`);
    }
    localStorage.removeItem("hero_carousel_data");
  } catch (e) {}
}

function showConfigError() {
  CONTENT_CONTAINER_IDS.forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div class="empty-state error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Website configuration error.</p>
          <p class="small">Please check config.js file.</p>
        </div>
      `;
    }
  });
}

function renderFeaturedItems(container, items) {
  const safeItems = normalizeFeaturedItems(items).filter(isFeaturedActive);
  container.innerHTML = safeItems
    .map(
      (item) => `
          <article class="featured-card" data-ripple="true">
            <div class="featured-card-media">
              <img src="${item.image}" alt="${escapeHtml(
                item.title
              )}" loading="lazy" decoding="async"
                   onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg==';">
              <span class="featured-card-glow" aria-hidden="true"></span>
            </div>
            <div class="featured-card-body">
              <h4>${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.description)}</p>
            </div>
          </article>
        `
    )
    .join("");

}

function renderMenuItems(container, items) {
  const safeItems = normalizeMenuItems(items).filter(isMenuItemAvailable);
  container.innerHTML = safeItems
    .map(
      (item) => `
          <div class="menu-item" data-ripple="true" data-item="${escapeHtml(
            item.title
          )}" data-price="${item.price}" data-id="${item.id || ""}">
            <img src="${item.image}" alt="${escapeHtml(
        item.title
      )}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lbnUgSXRlbTwvdGV4dD48L3N2Zz4='">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description)}</p>
            <div class="popup">
              <button class="add-cart">Add to Cart</button>
              <a class="order-now" href="#">Order Now</a>
            </div>
          </div>
        `
    )
    .join("");

}

function renderGalleryImages(container, items) {
  const safeItems = normalizeGalleryItems(items);
  container.innerHTML = safeItems
    .map(
      (item) => {
        const widthAttr = item.width ? `width=\"${item.width}\"` : "";
        const heightAttr = item.height ? `height=\"${item.height}\"` : "";
        return `
            <figure class="gallery-card" data-ripple="true">
              <div class="gallery-card-media">
                <img src="${item.image}" alt="${escapeHtml(
                  item.alt || ""
                )}" loading="lazy" decoding="async" ${widthAttr} ${heightAttr}
                     onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkdhbGxlcnk8L3RleHQ+PC9zdmc+='">
              </div>
              <figcaption>${escapeHtml(item.alt || "Gallery image")}</figcaption>
            </figure>
          `;
      }
    )
    .join("");

}

// ================== ORIGINAL TOKE BAKES CODE ==================

function computeCurrentPage() {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
}

let currentPage = computeCurrentPage();

// Keep page detection accurate during SPA navigation (script.js is not reloaded)
window.addEventListener("spa:navigated", () => {
  currentPage = computeCurrentPage();
});
window.addEventListener("popstate", () => {
  currentPage = computeCurrentPage();
});

/* Storage keys */
const CART_KEY = "toke_bakes_cart_v1";
const THEME_KEY = "toke_bakes_theme";

/* Business info */
const BUSINESS_PHONE_E164 = "+234 706 346 6822";
const BUSINESS_PHONE_WAME = "2347063466822";
const BUSINESS_EMAIL = "tokebakes@gmail.com";

/* Utility functions */
function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  refreshCartCount();

  // Let any page (including SPA-swapped pages) react immediately to cart changes
  try {
    window.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
  } catch {}
}

function formatPrice(num) {
  return Number(num).toLocaleString("en-NG");
}

function isMenuItemAvailable(item) {
  return parseBoolean(item?.is_available, true);
}

function decodeHtml(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[&<>"']/.test(text)) return text;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function normalizeItemName(value) {
  return decodeHtml(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeItemId(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// Escape HTML for security (already defined in admin.js, but defined here too)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text === null || text === undefined ? "" : String(text);
  return div.innerHTML;
}

/* ================== FIXED CART VALIDATION FUNCTIONS ================== */

async function validateCartItems() {
  try {
    const cart = readCart();
    if (cart.length === 0) return { valid: true, items: [] };

    const currentMenu = await getMenuItems();

    if (!currentMenu || currentMenu.length === 0) {
      return { valid: true, hasChanges: false, hasRemovals: false, results: [] };
    }

    const validationResults = [];
    let hasChanges = false;
    let hasRemovals = false;

  cart.forEach((cartItem, index) => {
      let currentItem = null;

      const cartName = normalizeItemName(cartItem.name);
      const cartId = normalizeItemId(cartItem.id);

      // Prefer id match (more stable), fallback to normalized name match
      if (cartId) {
        currentItem = currentMenu.find(
          (item) => normalizeItemId(item.id) === cartId
        );
      }

      if (!currentItem && cartName) {
        currentItem = currentMenu.find(
          (item) => normalizeItemName(item.title) === cartName
        );
      }

      if (!currentItem) {
        validationResults.push({
          index,
          name: cartItem.name,
          status: "removed",
          message: "This item is no longer available",
          oldPrice: cartItem.price,
          newPrice: null,
        });
        hasRemovals = true;
        hasChanges = true;
      } else {
        if (!isMenuItemAvailable(currentItem)) {
          validationResults.push({
            index,
            name: cartItem.name,
            status: "unavailable",
            message: "This item is currently unavailable",
            oldPrice: cartItem.price,
            newPrice: cartItem.price,
          });
          hasChanges = true;
          return;
        }

        const currentPrice = Number(currentItem.price);
        const cartPrice = Number(cartItem.price);

        if (
          !Number.isNaN(currentPrice) &&
          !Number.isNaN(cartPrice) &&
          currentPrice !== cartPrice
        ) {
          validationResults.push({
            index,
            name: cartItem.name,
            status: "price_changed",
            message: `Price updated from NGN ${formatPrice(
              cartItem.price
            )} to NGN ${formatPrice(currentItem.price)}`,
            oldPrice: cartItem.price,
            newPrice: currentPrice,
          });
          hasChanges = true;
        } else {
          validationResults.push({
            index,
            name: cartItem.name,
            status: "valid",
            message: null,
            oldPrice: cartItem.price,
            newPrice: Number.isNaN(currentPrice) ? cartItem.price : currentPrice,
          });
        }
      }
    });

    return {
      valid: !hasRemovals,
      hasChanges,
      hasRemovals,
      results: validationResults,
    };
  } catch (error) {
    console.error("Error validating cart:", error);
    return { valid: false, hasChanges: false, hasRemovals: false, results: [] };
  }
}

function updateCartWithValidation(validationResults) {
  const cart = readCart();
  let updatedCart = [...cart];
  let changesMade = false;

  validationResults.forEach((result) => {
    const item = updatedCart[result.index];
    if (!item) return;

    if (result.status === "price_changed" && result.newPrice !== null) {
      item.price = result.newPrice;
      changesMade = true;
    }

    if (result.status === "removed" || result.status === "unavailable") {
      if (!item.unavailable) {
        item.unavailable = true;
        changesMade = true;
      }
      return;
    }

    if (item.unavailable) {
      delete item.unavailable;
      changesMade = true;
    }
  });

  if (changesMade) {
    saveCart(updatedCart);
  }

  return updatedCart;
}

/* ================== NOTIFICATION FUNCTION ================== */
function showNotification(message, type = "success") {
  // Create a simple notification element
  const notification = document.createElement("div");
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 25px;
    right: 25px;
    background: ${type === "success" ? "#4CAF50" : "#F44336"};
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 9999;
    animation: slideInRight 0.3s ease-out;
    font-family: 'Poppins', sans-serif;
    font-weight: 500;
    max-width: 300px;
  `;

  document.body.appendChild(notification);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = "slideOutRight 0.3s ease-out forwards";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add animation keyframes for notifications
if (!document.querySelector("#notification-styles")) {
  const style = document.createElement("style");
  style.id = "notification-styles";
  style.textContent = `
    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes slideOutRight {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }
  `;
  document.head.appendChild(style);
}

/* ================== HOME LOADER (CAROUSEL-READY) ================== */
(function primeLoaderSession() {
  const page = window.location.pathname.split("/").pop() || "";
  const isHomePage = page === "" || page === "index.html" || page === "index";
  if (isHomePage) return;

  try {
    sessionStorage.setItem("toke_bakes_home_loader_seen", "1");
  } catch {}
})();

(function initHomeLoader() {
  const loader = document.getElementById("loader");
  if (!loader) return;

  const LOADER_SESSION_KEY = "toke_bakes_home_loader_seen";
  let hideTimer = null;
  let hidden = false;

  const isHomePage = () => {
    const page = window.location.pathname.split("/").pop() || "";
    return page === "" || page === "index.html" || page === "index";
  };

  const hasSeenLoaderThisSession = () => {
    try {
      return sessionStorage.getItem(LOADER_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  };

  const isCarouselReady = () => window.__tokeCarouselReady === true;

  const markLoaderAsSeen = () => {
    try {
      sessionStorage.setItem(LOADER_SESSION_KEY, "1");
    } catch {}
  };

  const clearHideTimer = () => {
    if (!hideTimer) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const hideLoader = (markSeen = true) => {
    if (hidden) return;
    hidden = true;
    clearHideTimer();
    if (markSeen) {
      markLoaderAsSeen();
    }
    loader.style.opacity = "0";
    loader.style.pointerEvents = "none";
    setTimeout(() => {
      loader.style.display = "none";
    }, 260);
  };

  const showLoader = () => {
    if (!isHomePage()) {
      hideLoader(false);
      return;
    }

    if (hasSeenLoaderThisSession()) {
      hideLoader(false);
      return;
    }

    if (isCarouselReady()) {
      hideLoader(true);
      return;
    }

    markLoaderAsSeen();
    hidden = false;
    clearHideTimer();
    loader.style.display = "flex";
    loader.style.opacity = "1";
    loader.style.pointerEvents = "auto";
    loader.style.transitionDuration = "260ms";

    // Fallback in case carousel event never fires
    hideTimer = setTimeout(() => hideLoader(true), 2200);
  };

  window.addEventListener("carousel:ready", () => {
    window.__tokeCarouselReady = true;
    hideLoader(true);
  });
  window.addEventListener("spa:navigated", () => {
    if (isHomePage()) {
      showLoader();
    } else {
      hideLoader(false);
    }
  });

  if (!isHomePage()) {
    markLoaderAsSeen();
  }

  showLoader();
})();

/* ================== BULLETPROOF NAV HIGHLIGHT ================== */
(function highlightNav() {
  // Skip navigation highlighting on admin pages
  if (
    window.location.pathname.includes("admin") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container")
  ) {
    debugLog("Skipping nav highlight on admin page");
    return;
  }

  const navLinks = document.querySelectorAll("nav a");

  // Get current location info
  const loc = {
    href: window.location.href.toLowerCase(),
    pathname: window.location.pathname.toLowerCase(),
    hostname: window.location.hostname,
  };

  // Determine if we're local or online
  const isLocal =
    loc.hostname === "localhost" || loc.href.startsWith("file://");

  // Parse current page
  let currentPage = loc.pathname.split("/").pop() || "index";
  currentPage = currentPage.replace(/\.(html|htm)$/, "").split("?")[0];
  if (currentPage === "") currentPage = "index";

  debugLog(
    `Nav Debug: Current page="${currentPage}", Path="${loc.pathname}", Local=${isLocal}`
  );

  navLinks.forEach((link, index) => {
    const href = link.getAttribute("href");
    if (!href) return;

    // Parse link page
    let linkPage = href.split("/").pop() || "index";
    linkPage = linkPage.replace(/\.(html|htm)$/, "").split("?")[0];
    if (linkPage === "") linkPage = "index";

    // Reset
    link.classList.remove("active");

    // LOGIC THAT WORKS EVERYWHERE:

    // 1. Home page check
    if (linkPage === "index" && currentPage === "index") {
      link.classList.add("active");
      debugLog(`Link ${index} (${href}) activated as HOME`);
      return;
    }

    // 2. Direct match
    if (linkPage === currentPage && linkPage !== "index") {
      link.classList.add("active");
      debugLog(`Link ${index} (${href}) activated as DIRECT MATCH`);
      return;
    }

    // 3. For online (Netlify) - check if current path contains page name
    if (!isLocal && loc.pathname.includes(linkPage) && linkPage !== "index") {
      link.classList.add("active");
      debugLog(`Link ${index} (${href}) activated as PATH CONTAINS`);
      return;
    }

    // 4. For local - check full path
    if (isLocal && loc.href.endsWith(href)) {
      link.classList.add("active");
      debugLog(`Link ${index} (${href}) activated as LOCAL MATCH`);
      return;
    }

    debugLog(`Link ${index} (${href}) NOT activated`);
  });

  debugLog("--- Navigation Highlight Complete ---");
})();

/* ================== FIXED CART COUNT - NO ZERO FLASH ================== */
function refreshCartCount() {
  const countEls = document.querySelectorAll("#cart-count");
  const cart = readCart();
  const totalItems = cart.reduce((s, it) => s + (it.quantity || 1), 0);

  countEls.forEach((el) => {
    el.textContent = totalItems;
    el.setAttribute("data-count", String(totalItems));

    // FIX: Hide immediately if zero
    if (totalItems === 0) {
      el.style.display = "none";
    } else {
      el.style.display = "inline-block";
    }
  });
}

/* ================== IMPROVED MOBILE MENU ================== */
let mobileMenuOutsideClickHandler = null;

function initMobileMenu() {
  const toggleBtn = document.getElementById("navbarToggle");
  const navList = document.querySelector(".navbar ul");
  const isMobileViewport =
    window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  const shouldDefaultOpen = isMobileViewport && isHomePageRuntime();

  if (toggleBtn && navList) {
    // Remove any existing listeners first
    const newToggle = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);

    const newNavList = navList.cloneNode(true);
    navList.parentNode.replaceChild(newNavList, navList);

    // Get fresh references
    const freshToggle = document.getElementById("navbarToggle");
    const freshNavList = document.querySelector(".navbar ul");

    freshToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      freshNavList.classList.toggle("show");
    });

    // Mobile UX: keep menu open by default on homepage
    if (shouldDefaultOpen) {
      freshNavList.classList.add("show");
    }

    if (!window.mobileMenuResizeListenerBound) {
      window.mobileMenuResizeListenerBound = true;
      window.addEventListener(
        "resize",
        () => {
          const currentNavList = document.querySelector(".navbar ul");
          if (!currentNavList) return;
          const mobileNow =
            window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
          const shouldAutoOpenHomeMenu = mobileNow && isHomePageRuntime();
          if (shouldAutoOpenHomeMenu) {
            currentNavList.classList.add("show");
          }
        },
        { passive: true }
      );
    }

    if (mobileMenuOutsideClickHandler) {
      document.removeEventListener("click", mobileMenuOutsideClickHandler);
    }

    // Close when clicking outside
    mobileMenuOutsideClickHandler = (e) => {
      if (
        freshNavList.classList.contains("show") &&
        !e.target.closest(".navbar") &&
        !e.target.closest("#navbarToggle")
      ) {
        freshNavList.classList.remove("show");
      }
    };
    document.addEventListener("click", mobileMenuOutsideClickHandler);

    // Close when clicking any nav link
    freshNavList.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        freshNavList.classList.remove("show");
      }
    });

    debugLog("Mobile menu initialized");
  }
}

/* ================== FIXED MENU INTERACTIONS ================== */
function initMenuInteractions() {
  // Rebind safely to avoid duplicate handlers after SPA navigation
  if (window.menuInteractionsClickHandler) {
    document.removeEventListener("click", window.menuInteractionsClickHandler);
  }
  if (window.menuInteractionsTouchHandler) {
    document.removeEventListener(
      "touchstart",
      window.menuInteractionsTouchHandler
    );
  }

  // Handle click events for menu items
  const clickHandler = function (e) {
    // Close all popups when clicking outside menu items
    if (!e.target.closest(".menu-item")) {
      document.querySelectorAll(".menu-item.show-popup").forEach((el) => {
        el.classList.remove("show-popup");
      });
      return;
    }

    const menuItem = e.target.closest(".menu-item");
    if (!menuItem) return;

    // Handle add to cart button
    const addBtn = e.target.closest(".add-cart");
    if (addBtn) {
      e.preventDefault(); // Keep this, but remove stopPropagation

      const name = (
        menuItem.dataset.item ||
        menuItem.querySelector("h3")?.textContent?.trim()
      )?.trim();
      const price = Number(menuItem.dataset.price || 0);
      const image = menuItem.querySelector("img")?.getAttribute("src") || "";
      const id = menuItem.dataset.id || null;

      if (!name) return;

      const cart = readCart();
      const normalizedName = normalizeItemName(name);
      const existing = cart.find(
        (it) => normalizeItemName(it.name) === normalizedName
      );
      if (existing) {
        existing.quantity = (existing.quantity || 1) + 1;
        existing.id = id;
        existing.price = price;
        if (existing.unavailable) {
          delete existing.unavailable;
        }
      } else {
        cart.push({ name: name.trim(), price, quantity: 1, image, id });
      }
      saveCart(cart);

      // Visual feedback for adding to cart
      const prevText = addBtn.textContent;
      addBtn.textContent = "Added";
      addBtn.classList.add("is-added");
      addBtn.disabled = true;

      setTimeout(() => {
        addBtn.textContent = prevText;
        addBtn.classList.remove("is-added");
        addBtn.disabled = false;
      }, 900);

      // DON'T RETURN HERE - let the click continue to ripple function
      return;
    }

    // Handle order now button
    const orderNow = e.target.closest(".order-now");
    if (orderNow) {
      e.preventDefault(); // Keep this, but remove stopPropagation

      const name = (
        menuItem.dataset.item ||
        menuItem.querySelector("h3")?.textContent?.trim()
      )?.trim();
      const price = menuItem.dataset.price || "";

      const orderData = {
        type: "single",
        items: [{ name, price: price ? Number(price) : 0, qty: 1 }],
        subject: `Order Inquiry: ${name}`,
      };

      showOrderOptions(orderData);
      // DON'T RETURN HERE - let the click continue to ripple function
      return;
    }

    // Don't toggle popup if clicking on the popup itself
    if (e.target.closest(".popup")) return;

    // Toggle the popup for this menu item
    const isShown = menuItem.classList.contains("show-popup");

    // Close all other popups
    document.querySelectorAll(".menu-item").forEach((item) => {
      if (item !== menuItem) {
        item.classList.remove("show-popup");
      }
    });

    // Toggle current item's popup
    if (isShown) {
      menuItem.classList.remove("show-popup");
    } else {
      menuItem.classList.add("show-popup");
    }
  };

  // Also add touch events for better mobile support
  const touchHandler = function (e) {
      // Close popups when touching outside
      if (!e.target.closest(".menu-item")) {
        document.querySelectorAll(".menu-item.show-popup").forEach((el) => {
          el.classList.remove("show-popup");
        });
      }
    };

  document.addEventListener("click", clickHandler);
  document.addEventListener("touchstart", touchHandler, { passive: true });

  window.menuInteractionsClickHandler = clickHandler;
  window.menuInteractionsTouchHandler = touchHandler;
  window.menuInteractionsInitialized = true;
}

/* ================== ORDER FUNCTIONALITY ================== */
function initOrderFunctionality() {
  // Rebind safely to avoid duplicate handlers after SPA navigation
  if (window.orderFunctionalityHandler) {
    document.removeEventListener("click", window.orderFunctionalityHandler);
  }

  // Proceed to order button
  const handler = async (e) => {
    if (!e.target || e.target.id !== "proceed-order") return;

    const cart = readCart();
    if (!cart || cart.length === 0) {
      const cartContainer = document.getElementById("cart-container");
      if (cartContainer) {
        const existingMessage = cartContainer.querySelector(
          ".empty-cart-message"
        );
        if (!existingMessage) {
          const message = document.createElement("div");
          message.className = "empty-cart-message";
          message.style.cssText =
            "background: #fff3cd; color: #856404; padding: 12px; border-radius: 8px; margin: 15px 0; text-align: center; border: 1px solid #ffeaa7;";
          message.textContent =
            "Your cart is empty. Visit the menu to add items.";
          cartContainer.appendChild(message);
          setTimeout(() => message.remove(), 4000);
        }
      }
      return;
    }

    const orderData = {
      type: "cart",
      items: cart.map((it) => ({
        name: it.name,
        price: Number(it.price || 0),
        qty: it.quantity || 1,
      })),
      subject: "New Order from Website",
    };
    showOrderOptions(orderData);
  };

  document.addEventListener("click", handler);
  window.orderFunctionalityHandler = handler;
  window.orderFunctionalityInitialized = true;
}

function showOrderOptions(orderData) {
  const sheet = document.getElementById("order-bottom-sheet");
  if (!sheet) return;

  const summaryEl = sheet.querySelector(".order-summary");
  if (summaryEl) {
    summaryEl.innerHTML = "";
    const list = document.createElement("div");

    orderData.items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "summary-row";

      if (it.qty > 1) {
        row.innerHTML = `
          <div class="s-left">${escapeHtml(it.name)}</div>
          <div class="s-right">${it.qty}x NGN ${formatPrice(it.price)}</div>
        `;
      } else {
        row.innerHTML = `
          <div class="s-left">${escapeHtml(it.name)}</div>
          <div class="s-right">NGN ${formatPrice(it.price)}</div>
        `;
      }
      list.appendChild(row);

      if (it.qty > 1) {
        const subtotalRow = document.createElement("div");
        subtotalRow.className = "summary-subtotal";
        subtotalRow.innerHTML = `
          <div class="s-left"><em>Subtotal</em></div>
          <div class="s-right"><em>NGN ${formatPrice(
            it.price * it.qty
          )}</em></div>
        `;
        list.appendChild(subtotalRow);
      }
    });

    summaryEl.appendChild(list);

    const total = orderData.items.reduce(
      (s, it) => s + (it.price || 0) * (it.qty || 1),
      0
    );
    const totalRow = document.createElement("div");
    totalRow.className = "summary-total";
    totalRow.innerHTML = `
      <div class="s-left"><strong>Order total:</strong></div>
      <div class="s-right"><strong>NGN ${formatPrice(total)}</strong></div>
    `;
    summaryEl.appendChild(totalRow);
  }

  sheet.dataset.order = JSON.stringify(orderData);
  sheet.classList.add("visible");
}

// Bottom sheet functionality
function initBottomSheet() {
  if (document.getElementById("order-bottom-sheet")) return;

  const html = `
    <div id="order-bottom-sheet" class="order-bottom-sheet" aria-hidden="true">
      <div class="sheet-backdrop"></div>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Choose order method">
        <button class="sheet-close" aria-label="Close">x</button>
        <h3>Place your order</h3>
        <div class="order-summary" aria-live="polite"></div>
        <div class="sheet-actions">
          <button id="order-via-gmail" class="order-option-btn">Order via Gmail</button>
          <button id="order-via-whatsapp" class="order-option-btn">Order via WhatsApp</button>
        </div>
        <small class="sheet-note">We will open your chosen app with the order pre-filled. Please complete your contact details before sending.</small>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  // Sheet event listeners
  document.addEventListener("click", (e) => {
    const sheet = document.getElementById("order-bottom-sheet");
    if (!sheet) return;

    if (
      e.target.closest(".sheet-close") ||
      e.target.classList.contains("sheet-backdrop")
    ) {
      sheet.classList.remove("visible");
    }

    const gmailBtn = e.target.closest("#order-via-gmail");
    const waBtn = e.target.closest("#order-via-whatsapp");

    if (gmailBtn || waBtn) {
      const orderData = sheet.dataset.order
        ? JSON.parse(sheet.dataset.order)
        : null;
      if (!orderData) return;

      if (gmailBtn) {
        const lines = [
          "Hello Toke Bakes,",
          "",
          "I would like to place the following order:",
          "",
          ...orderData.items.map(
            (it) =>
              `- ${it.name} x ${it.qty} ${
                it.price ? `(NGN ${formatPrice(it.price)} each)` : ""
              }`
          ),
          "",
          `Order total: NGN ${formatPrice(
            orderData.items.reduce(
              (s, it) => s + (it.price || 0) * (it.qty || 1),
              0
            )
          )}`,
          "",
          "Name: ",
          "Phone: ",
          "Delivery address: ",
          "",
          "Please confirm availability and payment method.",
          "",
          "Thank you!",
        ];

        const subject = encodeURIComponent(
          orderData.subject || "Order from website"
        );
        const body = encodeURIComponent(lines.join("\n"));
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
          BUSINESS_EMAIL
        )}&su=${subject}&body=${body}`;
        window.open(gmailUrl, "_blank");
      }

      if (waBtn) {
        const lines = [
          "Hello Toke Bakes,",
          "",
          "I would like to place the following order:",
          ...orderData.items.map(
            (it) =>
              `- ${it.name} x ${it.qty} ${
                it.price ? `(NGN ${formatPrice(it.price)} each)` : ""
              }`
          ),
          "",
          `Order total: NGN ${formatPrice(
            orderData.items.reduce(
              (s, it) => s + (it.price || 0) * (it.qty || 1),
              0
            )
          )}`,
          "",
          "Name:",
          "Phone:",
          "Delivery address:",
          "",
          "Please confirm availability and payment method.",
        ];

        const waText = encodeURIComponent(lines.join("\n"));
        const waUrl = `https://wa.me/${BUSINESS_PHONE_WAME}?text=${waText}`;
        window.open(waUrl, "_blank");
      }

      sheet.classList.remove("visible");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const sheet = document.getElementById("order-bottom-sheet");
      if (sheet) sheet.classList.remove("visible");
    }
  });
}

/* ================== FIXED CART RENDERING WITH CLEAR BUTTON ================== */
async function renderCartOnOrderPage(shouldValidate = true) {
  const cartContainer = document.getElementById("cart-container");
  const clearCartBtn = document.getElementById("clear-cart");

  if (!cartContainer) return;

  let cart = readCart();

  const renderCartUI = (currentCart) => {
    // Clear container first
    cartContainer.innerHTML = "";

    if (currentCart.length === 0) {
      cartContainer.innerHTML =
        '<p class="empty-cart">Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';

      // Hide clear cart button if cart is empty
      if (clearCartBtn) {
        clearCartBtn.style.display = "none";
        // Remove any existing event listener
        clearCartBtn.onclick = null;
      }
      return;
    }

    // Show clear cart button only if there are items
    if (clearCartBtn) {
      clearCartBtn.style.display = "block";
      // Remove previous event listener and add new one
      const newClearCartBtn = clearCartBtn.cloneNode(true);
      clearCartBtn.parentNode.replaceChild(newClearCartBtn, clearCartBtn);

      // Get fresh reference
      const freshClearCartBtn = document.getElementById("clear-cart");
      freshClearCartBtn.addEventListener("click", (e) => {
        e.preventDefault();
        saveCart([]);
        renderCartOnOrderPage(false);
        showNotification("Cart cleared", "success");
      });
    }

    // Render cart items
    currentCart.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "cart-row";
      row.dataset.index = index;

      // Check if item is unavailable
      const isUnavailable = item.unavailable;

      row.innerHTML = `
        <img src="${
          item.image ||
          "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmZTVjYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiMzMzMiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5DYXJ0PC90ZXh0Pjwvc3ZnPg=="
        }"
             alt="${escapeHtml(item.name)}" loading="lazy" />
        <div class="item-info">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${escapeHtml(item.name)}</strong>
            <button class="remove-item">Remove</button>
          </div>
          ${
            isUnavailable
              ? `
            <div style="color:#dc3545;font-size:0.9rem;margin-top:4px;margin-bottom:8px;">
              <i class="fas fa-exclamation-circle"></i> This item is no longer available
            </div>
          `
              : ""
          }
          <div class="qty-controls">
            <button class="qty-btn decrease" ${
              isUnavailable || (item.quantity || 1) <= 1 ? "disabled" : ""
            }>-</button>
            <span class="qty-display">${item.quantity}</span>
            <button class="qty-btn increase" ${
              isUnavailable ? "disabled" : ""
            }>+</button>
            <div style="margin-left:auto;font-weight:700;">NGN ${formatPrice(
              (item.price || 0) * (item.quantity || 1)
            )}</div>
          </div>
        </div>
      `;

      cartContainer.appendChild(row);
    });

    // Add event listeners for cart items
    setupCartEventListeners();
  };

  // Render immediately so cart appears without delay
  renderCartUI(cart);

  // Validate in the background, then re-render if needed
  if (shouldValidate && cart.length > 0) {
    const validation = await validateCartItems();
    const validatedCart = updateCartWithValidation(validation.results);
    if (JSON.stringify(validatedCart) !== JSON.stringify(cart)) {
      renderCartUI(validatedCart);
    }
  }
}

/* ================== RIPPLE EFFECT ================== */
function initRipple(selector) {
  document.addEventListener(
    "pointerdown",
    function (e) {
      const el = e.target.closest(selector);
      if (!el) return;
      if (e.button && e.button !== 0) return;

      const rect = el.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-effect";
      const size = Math.max(rect.width, rect.height) * 1.2;
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";

      el.style.position = el.style.position || "relative";
      el.style.overflow = "hidden";
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { passive: true }
  );
}

/* ================== MODERN 3D INTERACTIONS ================== */
const MODERN_3D_SELECTOR = ".feature, .featured-card, .menu-item, .gallery-card";
let modern3DResizeListenerBound = false;

function ensureModern3DStyles() {
  if (document.getElementById("modern-3d-styles")) return;

  const style = document.createElement("style");
  style.id = "modern-3d-styles";
  style.textContent = `
    @media (hover: hover) and (pointer: fine) {
      .feature.interactive-3d,
      .featured-card.interactive-3d,
      .menu-item.interactive-3d,
      .gallery-card.interactive-3d {
        --tilt-x: 0deg;
        --tilt-y: 0deg;
        --lift-3d: -6px;
        transform-style: preserve-3d;
        will-change: transform, box-shadow, filter;
        transition: transform 220ms cubic-bezier(0.22, 0.8, 0.22, 1),
          box-shadow 220ms ease, filter 220ms ease;
        backface-visibility: hidden;
      }

      .featured-card.interactive-3d,
      .gallery-card.interactive-3d {
        --lift-3d: -8px;
      }

      .feature.interactive-3d:hover,
      .feature.interactive-3d.is-interacting,
      .featured-card.interactive-3d:hover,
      .featured-card.interactive-3d.is-interacting,
      .menu-item.interactive-3d:hover,
      .menu-item.interactive-3d.is-interacting,
      .gallery-card.interactive-3d:hover,
      .gallery-card.interactive-3d.is-interacting {
        transform: translateY(var(--lift-3d))
          rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
        box-shadow: 0 20px 42px rgba(20, 14, 10, 0.2);
        filter: saturate(1.04);
      }
    }

    @media (hover: none), (pointer: coarse) {
      .feature:hover,
      .featured-card:hover,
      .menu-item:hover,
      .gallery-card:hover {
        transform: none !important;
      }

      .feature:hover::after,
      .featured-card:hover::before,
      .featured-card:hover .featured-card-glow,
      .menu-item:hover img,
      .gallery-card:hover img {
        transform: none !important;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .interactive-3d,
      .interactive-3d:hover,
      .interactive-3d.is-interacting {
        transform: none !important;
        transition: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function resetModern3DCard(card) {
  card.classList.remove("is-interacting");
  card.style.removeProperty("--tilt-x");
  card.style.removeProperty("--tilt-y");
}

function bindModern3DCard(card) {
  if (!card || card.dataset.modern3dBound === "true") return;
  card.dataset.modern3dBound = "true";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const onPointerMove = (event) => {
    if (!card.classList.contains("interactive-3d")) return;
    if (event.pointerType === "touch") return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const posX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const posY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const tiltY = (posX - 0.5) * 12;
    const tiltX = (0.5 - posY) * 10;

    card.style.setProperty("--tilt-x", `${tiltX.toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${tiltY.toFixed(2)}deg`);
    card.classList.add("is-interacting");
  };

  const onPointerLeave = () => {
    resetModern3DCard(card);
  };

  card.addEventListener("pointermove", onPointerMove, { passive: true });
  card.addEventListener("pointerleave", onPointerLeave, { passive: true });
  card.addEventListener("pointercancel", onPointerLeave, { passive: true });
  card.addEventListener("touchstart", onPointerLeave, { passive: true });
}

function initModern3DInteractions() {
  ensureModern3DStyles();

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canUseFinePointer =
    window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const enable3D = canUseFinePointer && !prefersReducedMotion;

  document.querySelectorAll(MODERN_3D_SELECTOR).forEach((card) => {
    bindModern3DCard(card);

    if (enable3D) {
      card.classList.add("interactive-3d");
      return;
    }

    card.classList.remove("interactive-3d");
    resetModern3DCard(card);
  });

  if (!modern3DResizeListenerBound) {
    modern3DResizeListenerBound = true;
    let resizeTimer = null;
    window.addEventListener(
      "resize",
      () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(initModern3DInteractions, 120);
      },
      { passive: true }
    );
  }
}

/* ================== HOME UX ENHANCEMENTS (HOME ONLY) ================== */
let homeRevealObserver = null;
let homeScrollListenerAttached = false;
let homeScrollTicking = false;

function ensureHomeEnhancementStyles() {
  if (document.getElementById("home-enhancement-styles")) return;

  const style = document.createElement("style");
  style.id = "home-enhancement-styles";
  style.textContent = `
    .reveal {
      opacity: 0;
      transform: translateY(18px);
      filter: blur(6px);
      transition: opacity 700ms ease, transform 700ms cubic-bezier(0.2, 0.9, 0.3, 1), filter 700ms ease;
    }
    .reveal.is-visible {
      opacity: 1;
      transform: translateY(0);
      filter: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .reveal {
        opacity: 1;
        transform: none;
        filter: none;
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function isHomePageRuntime() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  return page === "" || page === "/" || page === "index.html" || page === "index";
}

function ensureScrollTopButton() {
  const existing = document.getElementById("scroll-top-btn");

  let btn = existing;
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "scroll-top-btn";
    btn.type = "button";
    btn.className = "scroll-top-btn";
    btn.setAttribute("aria-label", "Scroll to top");
    btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    document.body.appendChild(btn);
  }

  if (!btn.dataset.bound) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const scrollingElement =
        document.scrollingElement || document.documentElement || document.body;

      const tryScrollToTop = (target) => {
        if (!target) return false;
        try {
          if (typeof target.scrollTo === "function") {
            target.scrollTo({ top: 0, left: 0, behavior: "smooth" });
            return true;
          }
        } catch {}

        try {
          // Fallback for older browsers that don't accept options objects.
          if (typeof target.scrollTo === "function") {
            target.scrollTo(0, 0);
            return true;
          }
        } catch {}

        try {
          if ("scrollTop" in target) {
            target.scrollTop = 0;
            return true;
          }
        } catch {}

        return false;
      };

      // Prefer element scrolling, but always fallback to window as well.
      tryScrollToTop(scrollingElement);
      tryScrollToTop(window);
      try {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      } catch {}
    });
    btn.dataset.bound = "true";
  }

  const getScrollTop = () => {
    const scrollingElement =
      document.scrollingElement || document.documentElement;
    if (scrollingElement && typeof scrollingElement.scrollTop === "number") {
      return scrollingElement.scrollTop;
    }
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  };

  const update = () => {
    const shouldShow = getScrollTop() > 300;
    btn.classList.toggle("show", shouldShow);
    // Inline fallback to avoid browser-specific style overrides
    btn.style.opacity = shouldShow ? "1" : "";
    btn.style.pointerEvents = shouldShow ? "auto" : "";
  };

  update();

  if (!homeScrollListenerAttached) {
    homeScrollListenerAttached = true;
    window.addEventListener(
      "scroll",
      () => {
        if (homeScrollTicking) return;
        homeScrollTicking = true;
        requestAnimationFrame(() => {
          homeScrollTicking = false;
          const el = document.getElementById("scroll-top-btn");
          if (!el) return;
          const shouldShow = getScrollTop() > 300;
          el.classList.toggle("show", shouldShow);
          el.style.opacity = shouldShow ? "1" : "";
          el.style.pointerEvents = shouldShow ? "auto" : "";
        });
      },
      { passive: true }
    );
    window.addEventListener("resize", update, { passive: true });
  }
}

function setupHomeScrollReveal() {
  if (!isHomePageRuntime()) {
    if (homeRevealObserver) {
      homeRevealObserver.disconnect();
      homeRevealObserver = null;
    }
    document.querySelectorAll("[data-reveal='true']").forEach((el) => {
      el.removeAttribute("data-reveal");
      el.classList.remove("reveal", "is-visible");
      el.style.transitionDelay = "";
    });
    return;
  }

  const targets = [
    document.querySelector(".about-preview"),
    ...Array.from(document.querySelectorAll(".about-features .feature")),
    ...Array.from(document.querySelectorAll("#featured-container .featured-card")),
  ].filter(Boolean);

  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  if (!homeRevealObserver) {
    homeRevealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Toggle so animations can replay when scrolling back up/down
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
  }

  targets.forEach((el, idx) => {
    if (el.getAttribute("data-reveal") !== "true") {
      el.setAttribute("data-reveal", "true");
      el.classList.add("reveal");
      el.style.transitionDelay = `${Math.min(idx * 60, 240)}ms`;
    }

    const rect = el.getBoundingClientRect();
    const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
    el.classList.toggle("is-visible", isInViewport);

    homeRevealObserver.observe(el);
  });
}

function refreshHomeEnhancements() {
  ensureHomeEnhancementStyles();
  ensureScrollTopButton();
  setupHomeScrollReveal();
}

// Refresh enhancements after SPA navigation swaps the DOM
window.addEventListener("spa:navigated", () => {
  setTimeout(() => {
    refreshHomeEnhancements();
    initModern3DInteractions();
  }, 0);
});

window.addEventListener("spa:reinitialized", () => {
  setTimeout(() => {
    refreshHomeEnhancements();
    initModern3DInteractions();
  }, 0);
});

/* ================== FIXED CART EVENT HANDLING ================== */
function setupCartEventListeners() {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  if (cartContainer.dataset.listenersAttached === "true") return;
  cartContainer.dataset.listenersAttached = "true";

  // Add fresh event listener
  cartContainer.addEventListener("click", function (e) {
    const target = e.target;
    const row = target.closest(".cart-row");

    if (!row) return;

    const index = parseInt(row.dataset.index);
    let cart = readCart();

    if (isNaN(index) || index < 0 || index >= cart.length) return;

    // Handle quantity buttons
    if (target.classList.contains("qty-btn")) {
      e.preventDefault();
      e.stopPropagation();

      if (target.classList.contains("increase")) {
        cart[index].quantity = (cart[index].quantity || 1) + 1;
      } else if (target.classList.contains("decrease")) {
        // Do not allow quantity to drop below 1
        if (cart[index].quantity > 1) {
          cart[index].quantity = cart[index].quantity - 1;
        } else {
          row.classList.remove("qty-bump");
          // Force reflow so animation retriggers
          void row.offsetWidth;
          row.classList.add("qty-bump");
          return;
        }
      }

      saveCart(cart);
      renderCartOnOrderPage(false);
    }

    // Handle remove button
    if (target.classList.contains("remove-item")) {
      e.preventDefault();
      e.stopPropagation();

      cart.splice(index, 1);
      saveCart(cart);
      renderCartOnOrderPage(false);
      showNotification("Item removed from cart", "success");
    }
  });
}

// Keep cart UI in sync across SPA navigation and immediate cart adds
let cartUpdatedRaf = 0;
window.addEventListener("cart:updated", () => {
  if (cartUpdatedRaf) return;
  cartUpdatedRaf = requestAnimationFrame(() => {
    cartUpdatedRaf = 0;
    if (document.getElementById("cart-container")) {
      Promise.resolve(renderCartOnOrderPage(false)).catch(() => {});
    }
  });
});

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  debugLog("Initializing Toke Bakes with Enhanced Sync...");

  // Initialize cart count immediately to prevent flash
  refreshCartCount();

  // STEP 2: Initialize sync system
  try {
    window.websiteUpdater = new WebsiteAutoUpdater();
  } catch (error) {
    console.error("WebsiteAutoUpdater failed to initialize:", error);
    window.websiteUpdater = null;
  }

  // STEP 3: Initialize everything else
  initMobileMenu();
  initMenuInteractions();
  initOrderFunctionality();
  initBottomSheet();

  // Initialize ripple - EXACT WORKING SELECTOR
  initRipple(
    ".btn, .add-cart, .order-now, .qty-btn, .order-option-btn, .remove-item, .theme-toggle, .menu-item, .featured-card, .gallery-card, .carousel-dot, .carousel-prev, .carousel-next, [data-ripple]"
  );

  // STEP 4: Load dynamic content (this will use cache first)
  try {
    await loadDynamicContent();
  } catch (error) {
    console.error("Failed to load initial content:", error);
  }

  refreshHomeEnhancements();
  initModern3DInteractions();

  // If on order page, render cart
  if (currentPage.includes("order")) {
    await renderCartOnOrderPage(true);
  }

  // Update copyright year
  const yearElement = document.getElementById("current-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  debugLog("Toke Bakes fully initialized");
});

// Ensure scroll-to-top is available even if another initializer throws
document.addEventListener("DOMContentLoaded", () => {
  try {
    ensureScrollTopButton();
  } catch {}
});

