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
    this.myLastCheckKey = "toke_bakes_last_check";
    this.dbCheckInterval = 30000;
    this.lastDbCheck = 0;
    this.broadcastChannel = null;
    this.syncBus = null;
    this.unsubscribeSync = null;
    this.boundStorageFallback = null;
    this.boundCustomFallback = null;
    this.pollingInterval = null;
    this.isCheckingUpdates = false;
    this.isRefreshing = false;
    this.pendingRefresh = false;
    this.pendingTriggerTs = 0;
    this.lastRefreshAt = 0;
    this.minRefreshGapMs = 1200;
    this.syncIndicatorTimer = null;
    this.refreshWatchdogTimer = null;
    this.boundVisibilityHandler = null;
    this.boundOnlineHandler = null;
    this.lastRenderedUpdateTs =
      Number(localStorage.getItem(this.dbLastUpdateKey)) ||
      Number(localStorage.getItem(this.lastUpdateKey)) ||
      0;
    this.lastCheckMemory =
      Number(localStorage.getItem(this.myLastCheckKey)) || 0;
    this.init();
  }

  async init() {
    debugLog("Initializing Enhanced WebsiteAutoUpdater...");

    try {
      await this.primeBaselineTimestamp();
    } catch (error) {
      debugWarn("Baseline timestamp prime failed:", error);
    }

    this.setupRealtimeSync();

    // 2. Check for updates every 10 seconds (faster cross-device propagation)
    this.startPolling(10000); // 10 seconds

    // 3. Check when user returns to tab
    this.boundVisibilityHandler = () => {
      if (!document.hidden) {
        debugLog("Tab became visible, checking for updates...");
        this.checkForUpdates();
      }
    };
    document.addEventListener("visibilitychange", this.boundVisibilityHandler);

    // 4. Re-check as soon as connectivity is restored.
    this.boundOnlineHandler = () => {
      this.checkForUpdates();
    };
    window.addEventListener("online", this.boundOnlineHandler);

    // 5. Initial check on page load (faster so recent admin edits appear sooner)
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
        if (payload.itemType === "theme") return;
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
            if (event.data.itemType === "theme") return;
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
            if (parsed?.itemType === "theme") return;
            this.handleExternalUpdate(parsed);
          }
          return;
        } catch {}
      }

      if (event.key === this.lastUpdateKey && event.newValue) {
        this.handleExternalUpdate({
          type: "DATA_UPDATED",
          timestamp: event.newValue,
          itemType: "all",
        });
      }
    };
    window.addEventListener("storage", this.boundStorageFallback);

    this.boundCustomFallback = (event) => {
      const detail = event?.detail || {};
      if (detail.type === "DATA_UPDATED") {
        if (detail.itemType === "theme") return;
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

    if (this.boundVisibilityHandler) {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }

    if (this.boundOnlineHandler) {
      window.removeEventListener("online", this.boundOnlineHandler);
      this.boundOnlineHandler = null;
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

  setMyLastCheck(value) {
    const ts = Number(value) || 0;
    this.lastCheckMemory = Math.max(this.lastCheckMemory || 0, ts);
    try {
      localStorage.setItem(this.myLastCheckKey, String(ts));
    } catch {}
  }

  getMyLastCheck() {
    const stored = Number(localStorage.getItem(this.myLastCheckKey) || "0");
    const effective = Math.max(this.lastCheckMemory || 0, stored || 0);
    this.lastCheckMemory = effective;
    return effective;
  }

  async fetchSiteLastUpdated() {
    if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
      return 0;
    }

    try {
      const response = await fetchWithTimeout(
        `${SUPABASE_CONFIG.URL}/rest/v1/rpc/site_last_updated`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
            Pragma: "no-cache",
            "Cache-Control": "no-store",
          },
          cache: "no-store",
        },
        SUPABASE_FETCH_TIMEOUT_MS
      );

      if (!response.ok) {
        return 0;
      }

      const data = await response.json();
      const value = Array.isArray(data) ? data[0] : data;
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    } catch (error) {
      debugWarn("Baseline update fetch failed:", error);
      return 0;
    }
  }

  async primeBaselineTimestamp() {
    const baseline = await this.fetchSiteLastUpdated();
    if (!baseline) return;

    this.lastRenderedUpdateTs = baseline;
    this.setMyLastCheck(baseline);
    try {
      localStorage.setItem(this.dbLastUpdateKey, String(baseline));
    } catch {}
    try {
      localStorage.setItem(this.lastUpdateKey, String(baseline));
    } catch {}
  }

  handleExternalUpdate(payload = {}) {
    const tsNumber = Number(payload.timestamp) || Date.now();
    const myLastCheck = this.getMyLastCheck();
    if (tsNumber <= myLastCheck) {
      return;
    }

    this.setMyLastCheck(tsNumber);
    this.refreshDataWithUI(tsNumber, true);
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
    let payloadType = "";
    let payloadItemType = "";
    try {
      const payloadRaw = localStorage.getItem(this.lastPayloadKey);
      if (payloadRaw) {
        const parsed = JSON.parse(payloadRaw);
        payloadTs = Number(parsed?.timestamp) || 0;
        payloadType = parsed?.type || "";
        payloadItemType = parsed?.itemType || "";
      }
    } catch {}

    // Ignore non-content events (e.g. theme metadata broadcasts)
    // so we don't trigger the website content sync indicator repeatedly.
    if (payloadTs && payloadType && payloadType !== "DATA_UPDATED") {
      return 0;
    }

    // Theme updates are handled by theme-manager.js and should not trigger
    // a full content refresh loop on the public pages.
    if (payloadTs && payloadItemType === "theme") {
      return localTs === payloadTs ? 0 : localTs;
    }

    return Math.max(localTs, payloadTs);
  }

  async checkForUpdates() {
    if (this.isCheckingUpdates) {
      return false;
    }

    this.isCheckingUpdates = true;
    try {
      const lastUpdate = this.getLatestUpdateTimestamp();
      const myLastCheck = this.getMyLastCheck();

      if (lastUpdate && lastUpdate > myLastCheck) {
        debugLog("Update detected via localStorage/timestamp");
        this.setMyLastCheck(lastUpdate);
        await this.refreshDataWithUI(lastUpdate, true);
        return true;
      }

      const dbUpdated = await this.checkDatabaseForUpdates();
      return dbUpdated;
    } finally {
      this.isCheckingUpdates = false;
    }
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
      const response = await fetchWithTimeout(
        `${SUPABASE_CONFIG.URL}/rest/v1/rpc/site_last_updated`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
            Pragma: "no-cache",
            "Cache-Control": "no-store",
          },
          cache: "no-store",
        },
        SUPABASE_FETCH_TIMEOUT_MS
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const value = Array.isArray(data) ? data[0] : data;
      if (!value) return false;

      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return false;

      const lastKnown = Number(localStorage.getItem(this.dbLastUpdateKey) || "0");
      const comparisonBaseline = Math.max(lastKnown, this.lastRenderedUpdateTs || 0);

      if (parsed > comparisonBaseline) {
        localStorage.setItem(this.dbLastUpdateKey, parsed.toString());
        this.setMyLastCheck(parsed);
        await this.refreshDataWithUI(parsed, true);
        return true;
      }
    } catch (error) {
      debugWarn("Database update check failed:", error);
    }

    return false;
  }

  async refreshDataWithUI(triggerTs = 0, announce = true) {
    const now = Date.now();
    const updateTs = Number(triggerTs) || 0;
    if (this.isRefreshing) {
      this.pendingRefresh = true;
      this.pendingTriggerTs = Math.max(this.pendingTriggerTs || 0, updateTs);
      return;
    }

    const sinceLast = now - this.lastRefreshAt;
    if (sinceLast < this.minRefreshGapMs) {
      if (!this.pendingRefresh) {
        this.pendingRefresh = true;
        this.pendingTriggerTs = Math.max(this.pendingTriggerTs || 0, updateTs);
        setTimeout(() => {
          if (!this.pendingRefresh) return;
          this.pendingRefresh = false;
          const pendingTs = this.pendingTriggerTs || 0;
          this.pendingTriggerTs = 0;
          this.refreshDataWithUI(pendingTs, announce);
        }, this.minRefreshGapMs - sinceLast);
      }
      return;
    }

    const shouldSignal =
      announce && updateTs && updateTs > this.lastRenderedUpdateTs;

    this.isRefreshing = true;
    this.lastRefreshAt = now;

    if (shouldSignal) {
      this.showSyncIndicator("syncing");
      this.clearSyncTimers();
      this.refreshWatchdogTimer = setTimeout(() => {
        if (!this.isRefreshing) return;
        this.isRefreshing = false;
        this.pendingRefresh = false;
        this.showSyncIndicator("error");
        this.syncIndicatorTimer = setTimeout(
          () => this.hideSyncIndicator(),
          3000
        );
      }, 20000);
    }

    try {
      debugLog("Refreshing website data...");

      if (typeof clearContentCaches === "function") {
        clearContentCaches();
      }

      if (typeof loadDynamicContent === "function") {
        await loadDynamicContent(true, true);
        debugLog("Dynamic content reloaded");
      }

      // Always re-check active theme after content refresh (cross-device)
      if (window.ThemeManager && typeof window.ThemeManager.checkForThemeUpdates === "function") {
        await window.ThemeManager.checkForThemeUpdates(true);
      }

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

      if (
        window.location.pathname.includes("order") &&
        typeof renderCartOnOrderPage === "function"
      ) {
        await renderCartOnOrderPage(true);
        debugLog("Cart refreshed");
      }

      if (shouldSignal) {
        this.showSyncIndicator("updated");
        this.showUpdateNotification();
        this.syncIndicatorTimer = setTimeout(
          () => this.hideSyncIndicator(),
          2000
        );
      } else {
        this.hideSyncIndicator();
      }
    } catch (error) {
      console.error("Sync refresh failed:", error);
      this.hideSyncIndicator();

      if (shouldSignal) {
        this.showSyncIndicator("error");
        this.syncIndicatorTimer = setTimeout(
          () => this.hideSyncIndicator(),
          3000
        );
      }
    } finally {
      this.isRefreshing = false;
      if (this.refreshWatchdogTimer) {
        clearTimeout(this.refreshWatchdogTimer);
        this.refreshWatchdogTimer = null;
      }

      this.lastRenderedUpdateTs = Math.max(
        this.lastRenderedUpdateTs,
        updateTs || now
      );
      this.setMyLastCheck(this.lastRenderedUpdateTs);

      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        const pendingTs = this.pendingTriggerTs || 0;
        this.pendingTriggerTs = 0;
        queueMicrotask(() => this.refreshDataWithUI(pendingTs, announce));
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
const CACHE_DURATION = 60 * 1000; // 1 minute

// General cache for all data
const dataCache = new Map();
const inFlightSupabaseRequests = new Map();
const SUPABASE_FETCH_TIMEOUT_MS = 12000;
const CACHE_DURATION_GENERAL = 60 * 1000; // 1 minute
const MENU_CACHE_KEY = "toke_bakes_menu_cache_v2";
const MENU_OPTIONS_CACHE_KEY = "toke_bakes_menu_options_cache_v1";
const MENU_OPTIONS_CACHE_DURATION = 60 * 1000;
const CONTENT_CONTAINER_IDS = [
  "featured-container",
  "menu-container",
  "gallery-container",
];
const CONTENT_CACHE_VERSION_KEY = "toke_bakes_content_cache_version";
const CONTENT_CACHE_VERSION = "4";
let cachedMenuOptionMap = new Map();
let menuOptionsCacheTimestamp = 0;
let inFlightMenuOptionRequest = null;
let renderedMenuItemLookup = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = SUPABASE_FETCH_TIMEOUT_MS) {
  if (typeof AbortController === "undefined") {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

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

function normalizeOptionType(value) {
  const raw = toSafeString(value, "single").toLowerCase();
  return raw === "multiple" ? "multiple" : "single";
}

function normalizeProductOptionGroup(rawGroup = {}, index = 0) {
  const productId = normalizeItemId(rawGroup.product_id);
  if (!productId) return null;

  const type = normalizeOptionType(rawGroup.type);
  const maxSelectionsRaw = parseNumber(rawGroup.max_selections, null);
  const maxSelections =
    type === "multiple" && Number.isFinite(maxSelectionsRaw) && maxSelectionsRaw > 0
      ? Math.floor(maxSelectionsRaw)
      : null;

  return {
    id: normalizeItemId(rawGroup.id) || `group-${index}`,
    product_id: productId,
    name: toSafeString(rawGroup.name, "Options"),
    type,
    required: parseBoolean(rawGroup.required, false),
    max_selections: maxSelections,
    created_at: rawGroup.created_at || rawGroup.createdAt || null,
  };
}

function normalizeProductOptionValue(rawValue = {}, index = 0) {
  const groupId = normalizeItemId(rawValue.group_id);
  if (!groupId) return null;

  return {
    id: normalizeItemId(rawValue.id) || `value-${index}`,
    group_id: groupId,
    name: toSafeString(rawValue.name, "Option"),
    price_adjustment: parseNumber(rawValue.price_adjustment, 0),
    created_at: rawValue.created_at || rawValue.createdAt || null,
  };
}

function getMenuOptionGroupsEndpoint() {
  return (
    window.API_ENDPOINTS?.MENU_OPTION_GROUPS || "/rest/v1/product_option_groups"
  );
}

function getMenuOptionValuesEndpoint() {
  return (
    window.API_ENDPOINTS?.MENU_OPTION_VALUES || "/rest/v1/product_option_values"
  );
}

function buildMenuOptionMap(groups = [], values = []) {
  const valuesByGroup = new Map();
  values.forEach((value, index) => {
    const normalizedValue = normalizeProductOptionValue(value, index);
    if (!normalizedValue) return;
    const list = valuesByGroup.get(normalizedValue.group_id) || [];
    list.push(normalizedValue);
    valuesByGroup.set(normalizedValue.group_id, list);
  });

  const optionMap = new Map();
  groups.forEach((group, index) => {
    const normalizedGroup = normalizeProductOptionGroup(group, index);
    if (!normalizedGroup) return;

    const productKey = normalizeItemId(normalizedGroup.product_id);
    const currentGroups = optionMap.get(productKey) || [];
    const groupValues = (valuesByGroup.get(normalizedGroup.id) || []).sort(
      (a, b) => {
        const aDate = Date.parse(a.created_at || "") || 0;
        const bDate = Date.parse(b.created_at || "") || 0;
        if (aDate !== bDate) return aDate - bDate;
        return a.name.localeCompare(b.name);
      }
    );

    currentGroups.push({
      ...normalizedGroup,
      values: groupValues,
    });
    optionMap.set(productKey, currentGroups);
  });

  optionMap.forEach((groupList, productKey) => {
    const sortedGroups = [...groupList].sort((a, b) => {
      const aDate = Date.parse(a.created_at || "") || 0;
      const bDate = Date.parse(b.created_at || "") || 0;
      if (aDate !== bDate) return aDate - bDate;
      return a.name.localeCompare(b.name);
    });
    optionMap.set(productKey, sortedGroups);
  });

  return optionMap;
}

function cacheMenuOptionsLocally(groups, values) {
  try {
    localStorage.setItem(
      MENU_OPTIONS_CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        groups: toArray(groups),
        values: toArray(values),
      })
    );
  } catch {}
}

function readMenuOptionsFromLocalCache() {
  try {
    const raw = localStorage.getItem(MENU_OPTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.groups) || !Array.isArray(parsed.values)) {
      return null;
    }
    return {
      timestamp: Number(parsed.timestamp) || 0,
      map: buildMenuOptionMap(parsed.groups, parsed.values),
    };
  } catch {
    return null;
  }
}

async function getMenuOptionMap(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    menuOptionsCacheTimestamp &&
    now - menuOptionsCacheTimestamp < MENU_OPTIONS_CACHE_DURATION
  ) {
    return cachedMenuOptionMap;
  }

  if (!forceRefresh && inFlightMenuOptionRequest) {
    return inFlightMenuOptionRequest;
  }

  const requestPromise = (async () => {
    try {
      const groupEndpoint = getMenuOptionGroupsEndpoint();
      const valueEndpoint = getMenuOptionValuesEndpoint();
      const groupsQuery =
        "?select=id,product_id,name,type,required,max_selections,created_at,updated_at&order=created_at.asc";
      const valuesQuery =
        "?select=id,group_id,name,price_adjustment,created_at,updated_at&order=created_at.asc";

      const [groupsRaw, valuesRaw] = await Promise.all([
        loadFromSupabase(groupEndpoint, groupsQuery, { forceRefresh }),
        loadFromSupabase(valueEndpoint, valuesQuery, { forceRefresh }),
      ]);

      const groups = toArray(groupsRaw);
      const values = toArray(valuesRaw);
      const optionMap = buildMenuOptionMap(groups, values);
      cachedMenuOptionMap = optionMap;
      menuOptionsCacheTimestamp = Date.now();
      cacheMenuOptionsLocally(groups, values);
      return optionMap;
    } catch (error) {
      debugWarn("Product option fetch failed; using fallback if available:", error);

      const localCache = readMenuOptionsFromLocalCache();
      if (localCache) {
        cachedMenuOptionMap = localCache.map;
        menuOptionsCacheTimestamp = localCache.timestamp || Date.now();
        return cachedMenuOptionMap;
      }

      if (cachedMenuOptionMap && menuOptionsCacheTimestamp) {
        return cachedMenuOptionMap;
      }

      cachedMenuOptionMap = new Map();
      menuOptionsCacheTimestamp = Date.now();
      return cachedMenuOptionMap;
    }
  })();

  if (!forceRefresh) {
    inFlightMenuOptionRequest = requestPromise;
  }

  try {
    return await requestPromise;
  } finally {
    if (!forceRefresh) {
      inFlightMenuOptionRequest = null;
    }
  }
}

function getOptionsForMenuItem(itemId) {
  const key = normalizeItemId(itemId);
  if (!key) return [];
  return cachedMenuOptionMap.get(key) || [];
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
  if (!forceRefresh && dataCache.has(cacheKey) && CACHE_DURATION_GENERAL > 0) {
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

  if (!forceRefresh && inFlightSupabaseRequests.has(cacheKey)) {
    return inFlightSupabaseRequests.get(cacheKey);
  }

  const requestUrl = forceRefresh
    ? `${SUPABASE_CONFIG.URL}${endpoint}${normalizedQuery}${
        normalizedQuery.includes("?") ? "&" : "?"
      }_=${now}`
    : `${SUPABASE_CONFIG.URL}${endpoint}${normalizedQuery}`;

  const requestPromise = (async () => {
    const response = await fetchWithTimeout(
      requestUrl,
      {
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          "Content-Type": "application/json",
          Pragma: "no-cache",
          "Cache-Control": "no-store",
        },
        cache: "no-store",
      },
      SUPABASE_FETCH_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Supabase request failed (${response.status})${
          errorText ? `: ${errorText.slice(0, 140)}` : ""
        }`
      );
    }

    const data = await response.json();
    const result = Array.isArray(data) ? data : [];

    // Cache the result
    if (CACHE_DURATION_GENERAL > 0) {
      dataCache.set(cacheKey, { data: result, timestamp: now });
      debugLog(`Cached data for ${endpoint}`);
    }

    return result;
  })();

  if (!forceRefresh) {
    inFlightSupabaseRequests.set(cacheKey, requestPromise);
  }

  try {
    return await requestPromise;
  } finally {
    if (!forceRefresh) {
      inFlightSupabaseRequests.delete(cacheKey);
    }
  }
}

// Get menu items with caching
async function getMenuItems(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    cachedMenuItems &&
    cacheTimestamp &&
    CACHE_DURATION > 0 &&
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
      Promise.resolve(getMenuOptionMap(forceReload)).catch(() => {});
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
    const [menuItems] = await Promise.all([
      getMenuItems(forceReload),
      getMenuOptionMap(forceReload),
    ]);
    const allItems = normalizeMenuItems(menuItems);

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
        Promise.resolve(getMenuOptionMap(false)).catch(() => {});
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
  cachedMenuOptionMap = new Map();
  menuOptionsCacheTimestamp = 0;
  inFlightMenuOptionRequest = null;
  renderedMenuItemLookup = new Map();

  if (dataCache && dataCache.clear) {
    dataCache.clear();
  }
  if (inFlightSupabaseRequests && inFlightSupabaseRequests.clear) {
    inFlightSupabaseRequests.clear();
  }

  try {
    localStorage.removeItem(MENU_CACHE_KEY);
    localStorage.removeItem(MENU_OPTIONS_CACHE_KEY);
    if (window.API_ENDPOINTS?.FEATURED) {
      localStorage.removeItem(`${window.API_ENDPOINTS.FEATURED}_data`);
    }
    if (window.API_ENDPOINTS?.GALLERY) {
      localStorage.removeItem(`${window.API_ENDPOINTS.GALLERY}_data`);
    }
    localStorage.removeItem("hero_carousel_data");
  } catch (e) {}
}

function ensureContentCacheVersion() {
  try {
    const stored = localStorage.getItem(CONTENT_CACHE_VERSION_KEY);
    if (stored !== CONTENT_CACHE_VERSION) {
      clearContentCaches();
      localStorage.setItem(CONTENT_CACHE_VERSION_KEY, CONTENT_CACHE_VERSION);
    }
  } catch {}
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
      (item, index) => {
        const isPriority = index === 0;
        return `
          <article class="featured-card" data-ripple="true">
            <div class="featured-card-media">
              <img src="${item.image}" alt="${escapeHtml(
                item.title
              )}" loading="${
                isPriority ? "eager" : "lazy"
              }" decoding="async" fetchpriority="${
                isPriority ? "high" : "auto"
              }" width="800" height="600"
              sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 360px"
                   onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg==';">
              <span class="featured-card-glow" aria-hidden="true"></span>
            </div>
            <div class="featured-card-body">
              <h4>${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.description)}</p>
            </div>
          </article>
        `;
      }
    )
    .join("");

}

function renderMenuItems(container, items) {
  const safeItems = normalizeMenuItems(items).filter(isMenuItemAvailable);
  renderedMenuItemLookup = new Map();
  safeItems.forEach((item) => {
    const itemId = normalizeItemId(item.id);
    if (itemId) {
      renderedMenuItemLookup.set(itemId, item);
    }
  });

  container.innerHTML = safeItems
    .map(
      (item, index) => {
        const isPriority = index === 0;
        const itemId = normalizeItemId(item.id);
        const priceLabel = Number(item.price) > 0 ? formatPrice(item.price) : "0";
        return `
          <div class="menu-item"
               data-ripple="true"
               data-menu-item="true"
               data-item="${escapeHtml(item.title)}"
               data-price="${item.price}"
               data-id="${escapeHtml(itemId)}"
               role="button"
               tabindex="0"
               aria-label="Customize ${escapeHtml(item.title)}">
            <img src="${item.image}" alt="${escapeHtml(
        item.title
      )}" loading="${
        isPriority ? "eager" : "lazy"
      }" decoding="async" fetchpriority="${
        isPriority ? "high" : "auto"
      }" width="800" height="600"
      sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 360px"
      onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lbnUgSXRlbTwvdGV4dD48L3N2Zz4='">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description)}</p>
            <div class="menu-item-meta">
              <span class="price">From NGN ${priceLabel}</span>
              <span class="menu-item-cta">Customize</span>
            </div>
          </div>
        `;
      }
    )
    .join("");

}

function renderGalleryImages(container, items) {
  const safeItems = normalizeGalleryItems(items);
  container.innerHTML = safeItems
    .map(
      (item, index) => {
        const width = Number(item.width) > 0 ? Number(item.width) : 800;
        const height = Number(item.height) > 0 ? Number(item.height) : 600;
        const isPriority = index === 0;
        return `
            <figure class="gallery-card" data-ripple="true">
              <div class="gallery-card-media">
                <img src="${item.image}" alt="${escapeHtml(
                  item.alt || ""
                )}" loading="${
                  isPriority ? "eager" : "lazy"
                }" decoding="async" fetchpriority="${
                  isPriority ? "high" : "auto"
                }" width="${width}" height="${height}"
                sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 360px"
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

function normalizeSelectedOptionGroups(rawOptions) {
  const normalized = toArray(rawOptions)
    .map((rawGroup) => {
      const groupId = normalizeItemId(rawGroup?.group_id || rawGroup?.id);
      const groupName = toSafeString(
        rawGroup?.group_name || rawGroup?.name,
        "Options"
      );
      const groupType = normalizeOptionType(rawGroup?.type);
      const values = toArray(rawGroup?.values)
        .map((rawValue) => {
          const valueId = normalizeItemId(rawValue?.id);
          const valueName = toSafeString(rawValue?.name);
          if (!valueName) return null;
          return {
            id: valueId,
            name: valueName,
            price_adjustment: parseNumber(rawValue?.price_adjustment, 0),
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.name !== b.name) return a.name.localeCompare(b.name);
          return a.id.localeCompare(b.id);
        });

      if (values.length === 0) return null;

      return {
        group_id: groupId,
        group_name: groupName,
        type: groupType,
        values,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.group_name !== b.group_name) {
        return a.group_name.localeCompare(b.group_name);
      }
      return a.group_id.localeCompare(b.group_id);
    });

  return normalized;
}

function getSelectedOptionsAdjustment(selectedOptions) {
  return normalizeSelectedOptionGroups(selectedOptions).reduce((sum, group) => {
    return (
      sum +
      group.values.reduce(
        (valueSum, value) => valueSum + parseNumber(value.price_adjustment, 0),
        0
      )
    );
  }, 0);
}

function buildCartConfigurationKey({
  id,
  name,
  selectedOptions = [],
  customMessage = "",
}) {
  const productToken = normalizeItemId(id) || normalizeItemName(name) || "item";
  const optionsToken = normalizeSelectedOptionGroups(selectedOptions).map((group) => ({
    group_id: group.group_id || "",
    group_name: group.group_name,
    values: group.values.map((value) => ({
      id: value.id || "",
      name: value.name,
      price_adjustment: parseNumber(value.price_adjustment, 0).toFixed(2),
    })),
  }));
  const messageToken = toSafeString(customMessage).trim().toLowerCase();
  return `${productToken}::${JSON.stringify(optionsToken)}::${messageToken}`;
}

function getCartItemBasePrice(item) {
  const explicitBase = Number(item?.base_price);
  if (Number.isFinite(explicitBase)) return explicitBase;

  const unitPrice = Number(item?.unit_price ?? item?.price);
  const adjustment = Number(item?.option_adjustment);
  if (Number.isFinite(unitPrice) && Number.isFinite(adjustment)) {
    return unitPrice - adjustment;
  }

  return Number.isFinite(unitPrice) ? unitPrice : 0;
}

function getCartItemOptionAdjustment(item) {
  const explicit = Number(item?.option_adjustment);
  if (Number.isFinite(explicit)) return explicit;
  return getSelectedOptionsAdjustment(item?.selected_options);
}

function getCartItemUnitPrice(item) {
  const explicit = Number(item?.unit_price ?? item?.price);
  if (Number.isFinite(explicit)) return explicit;
  return getCartItemBasePrice(item) + getCartItemOptionAdjustment(item);
}

function normalizeCartEntry(rawItem = {}) {
  const normalizedOptions = normalizeSelectedOptionGroups(
    rawItem.selected_options || rawItem.selectedOptions
  );
  const optionAdjustment = getSelectedOptionsAdjustment(normalizedOptions);
  const quantity = Math.max(1, Math.floor(parseNumber(rawItem.quantity, 1)));

  const rawBase = Number(rawItem.base_price);
  const basePrice = Number.isFinite(rawBase)
    ? rawBase
    : parseNumber(rawItem.unit_price ?? rawItem.price, 0) - optionAdjustment;
  const unitPrice = parseNumber(
    rawItem.unit_price ?? rawItem.price,
    basePrice + optionAdjustment
  );
  const customMessage = toSafeString(
    rawItem.custom_message ?? rawItem.customMessage
  );

  const normalized = {
    ...rawItem,
    id: normalizeItemId(rawItem.id),
    name: toSafeString(rawItem.name, "Menu Item"),
    image: toSafeString(rawItem.image),
    quantity,
    base_price: basePrice,
    option_adjustment: optionAdjustment,
    unit_price: unitPrice,
    price: unitPrice,
    selected_options: normalizedOptions,
    custom_message: customMessage || null,
  };

  normalized.configuration_key =
    toSafeString(rawItem.configuration_key) ||
    buildCartConfigurationKey({
      id: normalized.id,
      name: normalized.name,
      selectedOptions: normalized.selected_options,
      customMessage: normalized.custom_message || "",
    });

  return normalized;
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    return toArray(parsed).map((item) => normalizeCartEntry(item));
  } catch {
    return [];
  }
}

function saveCart(cart) {
  const normalizedCart = toArray(cart).map((item) => normalizeCartEntry(item));
  localStorage.setItem(CART_KEY, JSON.stringify(normalizedCart));
  refreshCartCount();

  // Let any page (including SPA-swapped pages) react immediately to cart changes
  try {
    window.dispatchEvent(
      new CustomEvent("cart:updated", { detail: { cart: normalizedCart } })
    );
  } catch {}
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
          oldPrice: getCartItemUnitPrice(cartItem),
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
            oldPrice: getCartItemUnitPrice(cartItem),
            newPrice: getCartItemUnitPrice(cartItem),
          });
          hasChanges = true;
          return;
        }

        const currentBasePrice = Number(currentItem.price);
        const cartBasePrice = getCartItemBasePrice(cartItem);
        const optionAdjustment = getCartItemOptionAdjustment(cartItem);
        const currentUnitPrice = currentBasePrice + optionAdjustment;
        const cartUnitPrice = getCartItemUnitPrice(cartItem);

        if (
          !Number.isNaN(currentBasePrice) &&
          !Number.isNaN(cartBasePrice) &&
          currentBasePrice !== cartBasePrice
        ) {
          validationResults.push({
            index,
            name: cartItem.name,
            status: "price_changed",
            message: `Price updated from NGN ${formatPrice(
              cartUnitPrice
            )} to NGN ${formatPrice(currentUnitPrice)}`,
            oldPrice: cartUnitPrice,
            newPrice: currentUnitPrice,
            newBasePrice: currentBasePrice,
          });
          hasChanges = true;
        } else {
          validationResults.push({
            index,
            name: cartItem.name,
            status: "valid",
            message: null,
            oldPrice: cartUnitPrice,
            newPrice: Number.isNaN(currentBasePrice)
              ? cartUnitPrice
              : currentUnitPrice,
            newBasePrice: Number.isNaN(currentBasePrice)
              ? cartBasePrice
              : currentBasePrice,
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
      if (Number.isFinite(Number(result.newBasePrice))) {
        item.base_price = Number(result.newBasePrice);
      }
      item.unit_price = Number(result.newPrice);
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

function formatOptionPriceAdjustment(adjustment) {
  const value = parseNumber(adjustment, 0);
  if (value === 0) return "";
  const prefix = value > 0 ? "+" : "-";
  return ` (${prefix}NGN ${formatPrice(Math.abs(value))})`;
}

function getOrderItemOptionLines(item) {
  const lines = [];
  const selectedOptions = normalizeSelectedOptionGroups(item?.selected_options);

  selectedOptions.forEach((group) => {
    const valueLabel = group.values
      .map(
        (value) =>
          `${value.name}${formatOptionPriceAdjustment(value.price_adjustment)}`
      )
      .join(", ");
    lines.push(`${group.group_name}: ${valueLabel}`);
  });

  const customMessage = toSafeString(item?.custom_message).trim();
  if (customMessage) {
    lines.push(`Custom message: ${customMessage}`);
  }

  return lines;
}

function getOrderItemMessageLines(item) {
  const unitPrice = parseNumber(item?.price, 0);
  const quantity = Math.max(1, parseNumber(item?.qty, 1));
  const baseLine = `- ${item?.name || "Item"} x ${quantity} ${
    unitPrice ? `(NGN ${formatPrice(unitPrice)} each)` : ""
  }`;
  const optionLines = getOrderItemOptionLines(item).map((line) => `  - ${line}`);
  return [baseLine, ...optionLines];
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
    loader.classList.add("fade-out");
    loader.style.opacity = "0";
    loader.style.pointerEvents = "none";
    const finish = () => {
      loader.style.display = "none";
      loader.classList.remove("fade-out");
    };
    loader.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 360);
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
    loader.classList.remove("fade-out");
    loader.style.transitionDuration = "260ms";

    // Fallback in case carousel event never fires
    hideTimer = setTimeout(() => hideLoader(true), 1800);
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

/* ================== PRODUCT CONFIGURATOR ================== */
const productConfiguratorState = {
  isOpen: false,
  activeItem: null,
  groups: [],
  quantity: 1,
  selectedSingle: new Map(),
  selectedMultiple: new Map(),
};
let productConfiguratorDom = null;
let productConfiguratorEscapeHandler = null;

function ensureProductConfiguratorStyles() {
  if (document.getElementById("product-configurator-styles")) return;

  const style = document.createElement("style");
  style.id = "product-configurator-styles";
  style.textContent = `
    .menu-item-meta {
      margin-top: 0.85rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
    }
    .menu-item-cta {
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: var(--primary);
    }
    .product-configurator {
      position: fixed;
      inset: 0;
      z-index: 5000;
      pointer-events: none;
    }
    .product-configurator.visible {
      pointer-events: auto;
    }
    .product-configurator .pc-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(18, 15, 10, 0.56);
      opacity: 0;
      transition: opacity 220ms ease;
    }
    .product-configurator .pc-panel {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      background: var(--background);
      color: var(--text);
      transform: translateY(100%);
      transition: transform 280ms cubic-bezier(0.2, 0.9, 0.3, 1);
      border-radius: 22px 22px 0 0;
      overflow: hidden;
      box-shadow: 0 -22px 44px rgba(0, 0, 0, 0.2);
    }
    .product-configurator.visible .pc-backdrop {
      opacity: 1;
    }
    .product-configurator.visible .pc-panel {
      transform: translateY(0);
    }
    .pc-header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      padding: 0.8rem 1rem 0.2rem;
      background: var(--background);
      border-bottom: 1px solid var(--border);
    }
    .pc-close {
      width: 2.2rem;
      height: 2.2rem;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 1rem;
      cursor: pointer;
    }
    .pc-scroll {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 0 1rem 7.25rem;
    }
    .pc-image-wrap img {
      width: 100%;
      border-radius: 16px;
      object-fit: cover;
      aspect-ratio: 1.2/1;
    }
    .pc-title {
      margin: 0.9rem 0 0.25rem;
      font-size: 1.45rem;
      line-height: 1.15;
    }
    .pc-description {
      margin: 0;
      color: var(--text-light);
    }
    .pc-price-row {
      margin-top: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.8rem;
      font-weight: 700;
    }
    .pc-options {
      margin-top: 1rem;
      display: grid;
      gap: 0.95rem;
    }
    .pc-group {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.8rem;
      background: var(--surface);
    }
    .pc-group-head {
      margin-bottom: 0.6rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .pc-required {
      font-size: 0.74rem;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
    }
    .pc-option-list {
      display: grid;
      gap: 0.45rem;
    }
    .pc-option {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.48rem 0.5rem;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.25);
      cursor: pointer;
    }
    .pc-option input {
      accent-color: var(--primary);
    }
    .pc-option-label {
      flex: 1;
      font-size: 0.92rem;
    }
    .pc-option-price {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-light);
      white-space: nowrap;
    }
    .pc-custom-msg {
      margin-top: 1rem;
      display: grid;
      gap: 0.45rem;
    }
    .pc-custom-msg label {
      font-weight: 600;
      font-size: 0.92rem;
    }
    .pc-custom-msg textarea {
      width: 100%;
      min-height: 88px;
      resize: vertical;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      padding: 0.65rem 0.75rem;
      font: inherit;
    }
    .pc-footer {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--background);
      border-top: 1px solid var(--border);
      padding: 0.7rem 1rem 1rem;
      display: grid;
      gap: 0.62rem;
    }
    .pc-total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      font-weight: 700;
    }
    .pc-qty-wrap {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }
    .pc-qty-btn {
      width: 2rem;
      height: 2rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-weight: 700;
      cursor: pointer;
    }
    .pc-qty-value {
      min-width: 2.1rem;
      text-align: center;
      font-weight: 700;
    }
    .pc-action-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.55rem;
    }
    .pc-action-btn {
      border: none;
      border-radius: 10px;
      padding: 0.72rem 0.75rem;
      font-weight: 700;
      cursor: pointer;
    }
    .pc-action-btn.add {
      background: var(--secondary);
      color: #fff;
    }
    .pc-action-btn.order {
      background: var(--primary);
      color: #fff;
    }
    .pc-error-note {
      min-height: 1.05rem;
      font-size: 0.82rem;
      color: #d9534f;
    }
    body.product-configurator-open {
      overflow: hidden;
    }
    .summary-option {
      margin: 0.15rem 0 0.35rem 0.25rem;
      padding-left: 0.6rem;
      border-left: 2px solid var(--border);
      color: var(--text-light);
      font-size: 0.84rem;
    }
    .cart-option-lines {
      margin: 0.4rem 0 0.5rem;
      padding-left: 0.75rem;
      color: var(--text-light);
      font-size: 0.86rem;
      list-style: disc;
    }
    @media (min-width: 992px) {
      .product-configurator .pc-panel {
        left: auto;
        width: min(560px, 92vw);
        border-radius: 20px 0 0 20px;
        transform: translateX(100%);
        box-shadow: -14px 0 32px rgba(0, 0, 0, 0.24);
      }
      .product-configurator.visible .pc-panel {
        transform: translateX(0);
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureProductConfiguratorDom() {
  ensureProductConfiguratorStyles();

  let root = document.getElementById("product-configurator");
  if (!root) {
    root = document.createElement("div");
    root.id = "product-configurator";
    root.className = "product-configurator";
    root.innerHTML = `
      <div class="pc-backdrop" data-pc-close="true"></div>
      <aside class="pc-panel" role="dialog" aria-modal="true" aria-labelledby="pc-title">
        <div class="pc-header">
          <button type="button" class="pc-close" data-pc-close="true" aria-label="Close configurator">x</button>
        </div>
        <div class="pc-scroll">
          <div class="pc-image-wrap">
            <img id="pc-image" src="" alt="" loading="lazy" decoding="async" />
          </div>
          <h2 id="pc-title" class="pc-title"></h2>
          <p id="pc-description" class="pc-description"></p>
          <div class="pc-price-row">
            <span>Base price</span>
            <strong id="pc-base-price"></strong>
          </div>
          <div id="pc-options" class="pc-options"></div>
          <div class="pc-custom-msg">
            <label for="pc-custom-message">Custom Message (Optional)</label>
            <textarea id="pc-custom-message" maxlength="160" placeholder="Write a custom cake message or instructions"></textarea>
          </div>
        </div>
        <div class="pc-footer">
          <div class="pc-total-row">
            <div class="pc-qty-wrap">
              <button type="button" class="pc-qty-btn" id="pc-qty-minus" aria-label="Decrease quantity">-</button>
              <span class="pc-qty-value" id="pc-qty-value">1</span>
              <button type="button" class="pc-qty-btn" id="pc-qty-plus" aria-label="Increase quantity">+</button>
            </div>
            <div id="pc-total-price">NGN 0</div>
          </div>
          <div id="pc-error-note" class="pc-error-note" aria-live="polite"></div>
          <div class="pc-action-row">
            <button type="button" class="pc-action-btn add" id="pc-add-cart">Add to Cart</button>
            <button type="button" class="pc-action-btn order" id="pc-order-now">Order Now</button>
          </div>
        </div>
      </aside>
    `;
    document.body.appendChild(root);
  }

  if (productConfiguratorDom && productConfiguratorDom.root === root) {
    return productConfiguratorDom;
  }

  productConfiguratorDom = {
    root,
    image: root.querySelector("#pc-image"),
    title: root.querySelector("#pc-title"),
    description: root.querySelector("#pc-description"),
    basePrice: root.querySelector("#pc-base-price"),
    options: root.querySelector("#pc-options"),
    customMessage: root.querySelector("#pc-custom-message"),
    qtyValue: root.querySelector("#pc-qty-value"),
    totalPrice: root.querySelector("#pc-total-price"),
    errorNote: root.querySelector("#pc-error-note"),
    qtyMinus: root.querySelector("#pc-qty-minus"),
    qtyPlus: root.querySelector("#pc-qty-plus"),
    addToCart: root.querySelector("#pc-add-cart"),
    orderNow: root.querySelector("#pc-order-now"),
  };

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-pc-close='true']")) {
      closeProductConfigurator();
    }
  });

  productConfiguratorDom.qtyMinus.addEventListener("click", () => {
    productConfiguratorState.quantity = Math.max(
      1,
      productConfiguratorState.quantity - 1
    );
    renderConfiguratorTotals();
  });

  productConfiguratorDom.qtyPlus.addEventListener("click", () => {
    productConfiguratorState.quantity += 1;
    renderConfiguratorTotals();
  });

  productConfiguratorDom.options.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || !target.name) return;

    const groupId = normalizeItemId(target.dataset.groupId);
    if (!groupId) return;
    const group = productConfiguratorState.groups.find((item) => item.id === groupId);
    if (!group) return;

    if (group.type === "single") {
      productConfiguratorState.selectedSingle.set(groupId, normalizeItemId(target.value));
      renderConfiguratorTotals();
      return;
    }

    const currentSelection =
      productConfiguratorState.selectedMultiple.get(groupId) || new Set();
    const valueId = normalizeItemId(target.value);
    if (target.checked) {
      const maxSelections = parseNumber(group.max_selections, null);
      if (Number.isFinite(maxSelections) && currentSelection.size >= maxSelections) {
        target.checked = false;
        setConfiguratorError(`Maximum ${maxSelections} selections for ${group.name}.`);
        return;
      }
      currentSelection.add(valueId);
    } else {
      currentSelection.delete(valueId);
    }
    productConfiguratorState.selectedMultiple.set(groupId, currentSelection);
    renderConfiguratorTotals();
  });

  productConfiguratorDom.addToCart.addEventListener("click", () => {
    submitConfiguredProduct("cart");
  });

  productConfiguratorDom.orderNow.addEventListener("click", () => {
    submitConfiguredProduct("order");
  });

  return productConfiguratorDom;
}

function setConfiguratorError(message = "") {
  const dom = ensureProductConfiguratorDom();
  dom.errorNote.textContent = toSafeString(message);
}

function resetProductConfiguratorState() {
  productConfiguratorState.activeItem = null;
  productConfiguratorState.groups = [];
  productConfiguratorState.quantity = 1;
  productConfiguratorState.selectedSingle = new Map();
  productConfiguratorState.selectedMultiple = new Map();
}

function initializeConfiguratorSelections(groups) {
  productConfiguratorState.selectedSingle = new Map();
  productConfiguratorState.selectedMultiple = new Map();

  toArray(groups).forEach((group) => {
    if (group.type === "single") {
      if (group.required && group.values[0]) {
        productConfiguratorState.selectedSingle.set(group.id, group.values[0].id);
      }
      return;
    }
    productConfiguratorState.selectedMultiple.set(group.id, new Set());
  });
}

function getConfiguratorSelectedOptions() {
  const selectedGroups = [];
  const missingRequiredGroups = [];
  let adjustmentTotal = 0;

  productConfiguratorState.groups.forEach((group) => {
    if (group.type === "single") {
      const selectedValueId = normalizeItemId(
        productConfiguratorState.selectedSingle.get(group.id)
      );
      const selectedValue = group.values.find(
        (value) => normalizeItemId(value.id) === selectedValueId
      );

      if (!selectedValue) {
        if (group.required) {
          missingRequiredGroups.push(group.name);
        }
        return;
      }

      adjustmentTotal += parseNumber(selectedValue.price_adjustment, 0);
      selectedGroups.push({
        group_id: group.id,
        group_name: group.name,
        type: group.type,
        values: [
          {
            id: selectedValue.id,
            name: selectedValue.name,
            price_adjustment: parseNumber(selectedValue.price_adjustment, 0),
          },
        ],
      });
      return;
    }

    const selectedSet =
      productConfiguratorState.selectedMultiple.get(group.id) || new Set();
    const selectedValues = group.values.filter((value) =>
      selectedSet.has(normalizeItemId(value.id))
    );

    if (group.required && selectedValues.length === 0) {
      missingRequiredGroups.push(group.name);
    }

    if (selectedValues.length === 0) return;

    adjustmentTotal += selectedValues.reduce(
      (sum, value) => sum + parseNumber(value.price_adjustment, 0),
      0
    );
    selectedGroups.push({
      group_id: group.id,
      group_name: group.name,
      type: group.type,
      values: selectedValues.map((value) => ({
        id: value.id,
        name: value.name,
        price_adjustment: parseNumber(value.price_adjustment, 0),
      })),
    });
  });

  return {
    selectedGroups,
    missingRequiredGroups,
    adjustmentTotal,
  };
}

function renderConfiguratorGroupOptions() {
  const dom = ensureProductConfiguratorDom();
  const groups = productConfiguratorState.groups;

  if (!groups.length) {
    dom.options.innerHTML = `
      <div class="pc-group">
        <div class="pc-group-head"><span>Options</span></div>
        <p class="pc-description">No configurable options for this item yet.</p>
      </div>
    `;
    return;
  }

  dom.options.innerHTML = groups
    .map((group) => {
      const hintParts = [];
      if (group.required) hintParts.push("Required");
      if (group.type === "multiple" && group.max_selections) {
        hintParts.push(`Max ${group.max_selections}`);
      }

      const inputs = group.values
        .map((value) => {
          const valueId = normalizeItemId(value.id);
          const inputName = `pc-group-${group.id}`;
          const checked =
            group.type === "single"
              ? normalizeItemId(productConfiguratorState.selectedSingle.get(group.id)) ===
                valueId
              : (
                  productConfiguratorState.selectedMultiple.get(group.id) || new Set()
                ).has(valueId);
          const adjustment = parseNumber(value.price_adjustment, 0);
          const adjustmentLabel =
            adjustment === 0
              ? "No extra"
              : `${adjustment > 0 ? "+" : "-"}NGN ${formatPrice(Math.abs(adjustment))}`;

          return `
            <label class="pc-option">
              <input
                type="${group.type === "single" ? "radio" : "checkbox"}"
                name="${escapeHtml(inputName)}"
                value="${escapeHtml(valueId)}"
                data-group-id="${escapeHtml(group.id)}"
                ${checked ? "checked" : ""}
              />
              <span class="pc-option-label">${escapeHtml(value.name)}</span>
              <span class="pc-option-price">${adjustmentLabel}</span>
            </label>
          `;
        })
        .join("");

      return `
        <section class="pc-group" data-group-id="${escapeHtml(group.id)}">
          <div class="pc-group-head">
            <span>${escapeHtml(group.name)}</span>
            <span class="pc-required">${escapeHtml(hintParts.join(" | "))}</span>
          </div>
          <div class="pc-option-list">${inputs}</div>
        </section>
      `;
    })
    .join("");
}

function renderConfiguratorTotals() {
  const dom = ensureProductConfiguratorDom();
  const item = productConfiguratorState.activeItem;
  if (!item) return;

  const { adjustmentTotal } = getConfiguratorSelectedOptions();
  const basePrice = parseNumber(item.price, 0);
  const unitPrice = Math.max(0, basePrice + adjustmentTotal);
  const quantity = Math.max(1, productConfiguratorState.quantity);
  const totalPrice = unitPrice * quantity;

  dom.qtyValue.textContent = String(quantity);
  dom.totalPrice.textContent = `NGN ${formatPrice(totalPrice)}`;
  setConfiguratorError("");
}

function closeProductConfigurator() {
  if (!productConfiguratorDom) {
    document.body.classList.remove("product-configurator-open");
    resetProductConfiguratorState();
    return;
  }
  productConfiguratorState.isOpen = false;
  resetProductConfiguratorState();
  productConfiguratorDom.root.classList.remove("visible");
  productConfiguratorDom.root.setAttribute("aria-hidden", "true");
  document.body.classList.remove("product-configurator-open");
  if (productConfiguratorEscapeHandler) {
    document.removeEventListener("keydown", productConfiguratorEscapeHandler);
    productConfiguratorEscapeHandler = null;
  }
}

async function openProductConfigurator(item) {
  if (!item) return;

  const dom = ensureProductConfiguratorDom();
  await getMenuOptionMap(false);

  const groups = getOptionsForMenuItem(item.id);
  productConfiguratorState.isOpen = true;
  productConfiguratorState.activeItem = item;
  productConfiguratorState.groups = groups;
  productConfiguratorState.quantity = 1;
  initializeConfiguratorSelections(groups);

  dom.image.src = item.image;
  dom.image.alt = item.title;
  dom.title.textContent = item.title;
  dom.description.textContent = item.description || "";
  dom.basePrice.textContent = `NGN ${formatPrice(item.price || 0)}`;
  dom.customMessage.value = "";

  renderConfiguratorGroupOptions();
  renderConfiguratorTotals();

  dom.root.classList.add("visible");
  dom.root.setAttribute("aria-hidden", "false");
  document.body.classList.add("product-configurator-open");

  if (productConfiguratorEscapeHandler) {
    document.removeEventListener("keydown", productConfiguratorEscapeHandler);
  }
  productConfiguratorEscapeHandler = (event) => {
    if (event.key === "Escape") {
      closeProductConfigurator();
    }
  };
  document.addEventListener("keydown", productConfiguratorEscapeHandler);
}

function buildConfiguredCartItem() {
  const item = productConfiguratorState.activeItem;
  const quantity = Math.max(1, productConfiguratorState.quantity);
  const customMessage = toSafeString(
    productConfiguratorDom?.customMessage?.value
  ).trim();
  const { selectedGroups, adjustmentTotal } = getConfiguratorSelectedOptions();
  const basePrice = parseNumber(item?.price, 0);
  const unitPrice = Math.max(0, basePrice + adjustmentTotal);
  const configurationKey = buildCartConfigurationKey({
    id: item?.id,
    name: item?.title,
    selectedOptions: selectedGroups,
    customMessage,
  });

  return normalizeCartEntry({
    id: item?.id,
    name: item?.title,
    image: item?.image,
    quantity,
    base_price: basePrice,
    option_adjustment: adjustmentTotal,
    unit_price: unitPrice,
    price: unitPrice,
    selected_options: selectedGroups,
    custom_message: customMessage || null,
    configuration_key: configurationKey,
  });
}

function submitConfiguredProduct(mode = "cart") {
  const item = productConfiguratorState.activeItem;
  if (!item) return;

  const { missingRequiredGroups } = getConfiguratorSelectedOptions();
  if (missingRequiredGroups.length > 0) {
    setConfiguratorError(
      `Select required option(s): ${missingRequiredGroups.join(", ")}.`
    );
    return;
  }

  const configuredEntry = buildConfiguredCartItem();

  if (mode === "cart") {
    const cart = readCart();
    const existing = cart.find(
      (entry) => entry.configuration_key === configuredEntry.configuration_key
    );

    if (existing) {
      existing.quantity = (existing.quantity || 1) + configuredEntry.quantity;
      existing.base_price = configuredEntry.base_price;
      existing.option_adjustment = configuredEntry.option_adjustment;
      existing.unit_price = configuredEntry.unit_price;
      existing.price = configuredEntry.price;
      existing.selected_options = configuredEntry.selected_options;
      existing.custom_message = configuredEntry.custom_message;
      existing.image = configuredEntry.image;
      existing.id = configuredEntry.id;
      if (existing.unavailable) delete existing.unavailable;
    } else {
      cart.push(configuredEntry);
    }

    saveCart(cart);
    showNotification("Item added to cart", "success");
    closeProductConfigurator();
    return;
  }

  const orderData = {
    type: "single",
    items: [
      {
        name: configuredEntry.name,
        price: configuredEntry.unit_price,
        qty: configuredEntry.quantity,
        selected_options: configuredEntry.selected_options,
        custom_message: configuredEntry.custom_message,
      },
    ],
    subject: `Order Inquiry: ${configuredEntry.name}`,
  };

  closeProductConfigurator();
  showOrderOptions(orderData);
}

function getMenuItemFromElement(menuItem) {
  if (!menuItem) return null;
  const itemId = normalizeItemId(menuItem.dataset.id);
  if (itemId && renderedMenuItemLookup.has(itemId)) {
    return renderedMenuItemLookup.get(itemId);
  }

  const fallbackTitle = toSafeString(
    menuItem.dataset.item || menuItem.querySelector("h3")?.textContent,
    "Menu Item"
  );
  return {
    id: itemId || null,
    title: fallbackTitle,
    description: toSafeString(menuItem.querySelector("p")?.textContent),
    price: parseNumber(menuItem.dataset.price, 0),
    image: toSafeString(menuItem.querySelector("img")?.getAttribute("src")),
  };
}

/* ================== MENU INTERACTIONS ================== */
function initMenuInteractions() {
  ensureProductConfiguratorDom();

  // Rebind safely to avoid duplicate handlers after SPA navigation
  if (window.menuInteractionsClickHandler) {
    document.removeEventListener("click", window.menuInteractionsClickHandler);
  }
  if (window.menuInteractionsKeyHandler) {
    document.removeEventListener("keydown", window.menuInteractionsKeyHandler);
  }

  const clickHandler = async (event) => {
    const menuItem = event.target.closest(".menu-item[data-menu-item='true']");
    if (!menuItem) return;
    event.preventDefault();
    const item = getMenuItemFromElement(menuItem);
    if (!item) return;
    await openProductConfigurator(item);
  };

  const keyHandler = async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const menuItem = event.target.closest(".menu-item[data-menu-item='true']");
    if (!menuItem) return;
    event.preventDefault();
    const item = getMenuItemFromElement(menuItem);
    if (!item) return;
    await openProductConfigurator(item);
  };

  document.addEventListener("click", clickHandler);
  document.addEventListener("keydown", keyHandler);

  window.menuInteractionsClickHandler = clickHandler;
  window.menuInteractionsKeyHandler = keyHandler;
  window.menuInteractionsInitialized = true;
}

window.addEventListener("spa:navigated", () => {
  closeProductConfigurator();
});

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
        price: getCartItemUnitPrice(it),
        qty: it.quantity || 1,
        selected_options: normalizeSelectedOptionGroups(it.selected_options),
        custom_message: toSafeString(it.custom_message).trim() || null,
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

      const optionLines = getOrderItemOptionLines(it);
      optionLines.forEach((line) => {
        const optionRow = document.createElement("div");
        optionRow.className = "summary-option";
        optionRow.textContent = line;
        list.appendChild(optionRow);
      });

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
          ...orderData.items.flatMap((it) => getOrderItemMessageLines(it)),
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
          ...orderData.items.flatMap((it) => getOrderItemMessageLines(it)),
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
      const unitPrice = getCartItemUnitPrice(item);
      const optionLines = getOrderItemOptionLines(item);
      const optionLinesHtml =
        optionLines.length > 0
          ? `<ul class="cart-option-lines">${optionLines
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}</ul>`
          : "";

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
          ${optionLinesHtml}
          <div class="qty-controls">
            <button class="qty-btn decrease" ${
              isUnavailable || (item.quantity || 1) <= 1 ? "disabled" : ""
            }>-</button>
            <span class="qty-display">${item.quantity}</span>
            <button class="qty-btn increase" ${
              isUnavailable ? "disabled" : ""
            }>+</button>
            <div style="margin-left:auto;font-weight:700;">NGN ${formatPrice(
              unitPrice * (item.quantity || 1)
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
    return (
      window.scrollY ||
      (document.documentElement && document.documentElement.scrollTop) ||
      (document.body && document.body.scrollTop) ||
      0
    );
  };

  const update = () => {
    const scrollTop = getScrollTop();
    const doc =
      document.scrollingElement || document.documentElement || document.body;
    const maxScroll = (doc && doc.scrollHeight - doc.clientHeight) || 0;
    const distanceToBottom = maxScroll - scrollTop;

    // Show when past 220px OR when within 20% of the bottom
    const shouldShow =
      scrollTop > 220 || distanceToBottom <= Math.max(240, maxScroll * 0.2);

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
          const scrollTop = getScrollTop();
          const doc =
            document.scrollingElement ||
            document.documentElement ||
            document.body;
          const maxScroll = (doc && doc.scrollHeight - doc.clientHeight) || 0;
          const distanceToBottom = maxScroll - scrollTop;
          const shouldShow =
            scrollTop > 220 ||
            distanceToBottom <= Math.max(240, maxScroll * 0.2);
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
    document.querySelector(".hero-content"),
    ...Array.from(document.querySelectorAll("#featured-container .featured-card")),
    ...Array.from(document.querySelectorAll("#menu-container .menu-item")),
    ...Array.from(document.querySelectorAll("#gallery-container .gallery-card")),
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

  ensureContentCacheVersion();

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
    ".btn, .qty-btn, .order-option-btn, .remove-item, .theme-toggle, .menu-item, .featured-card, .gallery-card, .carousel-dot, .carousel-prev, .carousel-next, .pc-action-btn, .pc-qty-btn, [data-ripple]"
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

