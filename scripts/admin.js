/* ================== admin.js ================== */
/* Toke Bakes Admin Panel - MODERN CONFIRMATION DIALOG VERSION */
/* UPDATED WITH CAROUSEL FUNCTIONALITY */

/* ================== AUTO-UPDATE SYSTEM ================== */
class DataSyncManager {
  constructor() {
    this.syncBus = null;
    this.destroyBound = false;
    this.refreshUnsubscribe = null;
    this.init();
  }

  init() {
    if (window.TokeUpdateSync) {
      this.syncBus = window.TokeUpdateSync;
    }

    if (
      this.syncBus &&
      typeof this.syncBus.registerRefreshHandler === "function" &&
      !this.refreshUnsubscribe
    ) {
      this.refreshUnsubscribe = this.syncBus.registerRefreshHandler(
        async (payload) => {
          const normalizedType = normalizeChangeType(
            payload?.changeType || payload?.lastChangeType || payload?.itemType || "all"
          );
          await refreshAdminUiFromSync(normalizedType, payload || {});
          return true;
        },
        {
          id: "admin-content-refresh",
          showIndicator: false,
          priority: 65,
          changeTypes: ["all", "menu", "featured", "specials", "carousel", "theme"],
        }
      );
    }

    if (!this.destroyBound) {
      this.destroyBound = true;
      window.addEventListener(
        "beforeunload",
        () => {
          this.destroy();
        },
        { once: true }
      );
    }
  }

  notifyDataChanged(operationType, itemType, extra = {}) {
    if (typeof queueStatsPanelRefresh === "function") {
      queueStatsPanelRefresh(700);
    }
    const normalizedType = normalizeChangeType(itemType || "all");

    if (this.syncBus && typeof this.syncBus.publishDataUpdate === "function") {
      this.syncBus.publishDataUpdate(operationType, normalizedType, {
        source: "admin",
        lastChangeType: normalizedType,
        ...(extra || {}),
      });

      if (typeof this.syncBus.requestServerCheck === "function") {
        Promise.resolve(
          this.syncBus.requestServerCheck("admin-write", true)
        ).catch(() => {});
      }
      return;
    }
    debugWarn("TokeUpdateSync unavailable; update notification skipped.");
  }

  destroy() {
    if (this.refreshUnsubscribe) {
      try {
        this.refreshUnsubscribe();
      } catch {}
      this.refreshUnsubscribe = null;
    }
    this.syncBus = null;
  }
}

const dataSync = new DataSyncManager();

// Debug logger (disabled for production)
const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
const debugWarn = (...args) => {
  if (DEBUG) console.warn(...args);
};

function syncAutoYearBadges() {
  const currentYear = String(new Date().getFullYear());
  document
    .querySelectorAll("#admin-year, #current-year, [data-auto-year]")
    .forEach((node) => {
      node.textContent = currentYear;
    });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncAutoYearBadges, {
      once: true,
    });
  } else {
    syncAutoYearBadges();
  }
}

// Current admin state
let currentAdmin = null;
let isEditing = false;
let currentEditId = null;
let sessionTimeout = null;
let activityMonitoringAttached = false;
const SESSION_TIMEOUT_MINUTES = 30;

// Store for temporary image data
let tempImageCache = new Map();

function normalizeTempImageCacheKey(id) {
  return toSafeString(id).trim();
}

function cacheTempImageForItem(id, imageUrl) {
  const key = normalizeTempImageCacheKey(id);
  const safeUrl = toSafeString(imageUrl).trim();
  if (!key || !safeUrl) return;
  tempImageCache.set(key, safeUrl);
}

function getExistingImageUrlForItem(itemType, id) {
  const key = normalizeTempImageCacheKey(id);
  if (!key) return "";

  let cachedUrl = toSafeString(tempImageCache.get(key)).trim();
  if (cachedUrl) return cachedUrl;

  // Legacy fallback for older numeric keys that may still exist in memory.
  for (const [entryKey, entryUrl] of tempImageCache.entries()) {
    if (normalizeTempImageCacheKey(entryKey) === key) {
      cachedUrl = toSafeString(entryUrl).trim();
      if (cachedUrl) {
        tempImageCache.set(key, cachedUrl);
        return cachedUrl;
      }
    }
  }

  const record = getCachedItemForType(itemType, key);
  const resolved = toSafeString(resolveRecordImage(record)).trim();
  if (resolved) {
    tempImageCache.set(key, resolved);
    return resolved;
  }

  return "";
}

// Storage buckets aligned with Supabase SQL
const STORAGE_BUCKETS = {
  featured: "featured-items",
  menu: "menu-items",
  specials: "specials",
  carousel: "hero-carousel",
};

const STORAGE_LIMITS_KB = {
  featured: 2000,
  menu: 2000,
  specials: 5000,
  carousel: 5000,
};

const ITEM_TYPES = ["featured", "menu", "specials", "carousel"];
const DISPLAY_ORDER_MANAGED_TYPES = new Set(["featured", "menu", "specials", "carousel"]);
const itemStateCache = ITEM_TYPES.reduce((acc, type) => {
  acc[type] = new Map();
  return acc;
}, {});
const loadedAdminTabs = new Set();
const PRODUCT_OPTION_ENDPOINTS = {
  groups:
    window.API_ENDPOINTS?.MENU_OPTION_GROUPS || "/rest/v1/product_option_groups",
  values:
    window.API_ENDPOINTS?.MENU_OPTION_VALUES || "/rest/v1/product_option_values",
};
const SPECIALS_ENDPOINT =
  window.API_ENDPOINTS?.SPECIALS || "/rest/v1/specials";
const STATS_ENDPOINTS = {
  counts: "/rest/v1/rpc/get_site_stats_counts",
  daily: "/rest/v1/rpc/get_site_stats_daily",
};
const statsPanelState = {
  refreshing: false,
  lastLoadedDays: 30,
  lastRefreshAt: 0,
  refreshTimer: null,
};
const menuOptionManagerState = {
  menuItemId: "",
  menuItemTitle: "",
  groups: [],
  open: false,
  loading: false,
};
const CONTENT_VERSION_STORAGE_KEY = "toke_bakes_content_version";
const LAST_CHANGE_TYPE_STORAGE_KEY = "toke_bakes_last_change_type";
const LAST_SYNC_CHECK_STORAGE_KEY = "toke_bakes_last_sync_check_at";
const SW_LAST_UPDATE_KEY = "toke_bakes_sw_last_update_detected_at";
const ADMIN_ERROR_LOG_LIMIT = 30;
const ADMIN_TOAST_DEDUP_WINDOW_MS = 600;
const ADMIN_POPUP_QUEUE = [];
const adminDiagnosticsState = {
  errors: [],
  lastCachePurgeAt: 0,
};
let adminPopupActive = false;
const adminToastLastShownAt = new Map();
const adminActionLocks = new Set();
const adminControlState = new WeakMap();
const adminCrudProgressState = {
  root: null,
  fill: null,
  value: null,
  title: null,
  status: null,
  timer: null,
  progress: 0,
};

function parseContentVersion(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
  }
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    return parseContentVersion(raw[0]);
  }
  if (raw && typeof raw === "object") {
    return parseContentVersion(
      raw.get_content_version ?? raw.content_version ?? raw.value ?? raw.version ?? null
    );
  }
  return null;
}

function normalizeChangeType(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (
    value === "menu_options" ||
    value === "menu-options" ||
    value === "menuoptions" ||
    value === "option" ||
    value === "options"
  ) {
    return "menu";
  }
  if (["menu", "featured", "specials", "carousel", "theme", "all"].includes(value)) {
    return value;
  }
  return "all";
}

function parseUpdateSignalPayload(raw) {
  const row = Array.isArray(raw) ? raw[0] : raw;
  const version = parseContentVersion(row || raw);
  if (!Number.isFinite(version)) return null;
  const updatedAtRaw =
    row && typeof row === "object" ? row.updated_at || row.updatedAt : null;
  const parsedTs = updatedAtRaw ? Date.parse(updatedAtRaw) : NaN;
  return {
    contentVersion: version,
    lastChangeType: normalizeChangeType(
      row?.last_change_type || row?.change_type || row?.item_type || "all"
    ),
    updatedAtTs: Number.isNaN(parsedTs) ? 0 : Math.trunc(parsedTs),
  };
}

function getStoredContentVersion() {
  try {
    return parseContentVersion(localStorage.getItem(CONTENT_VERSION_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setStoredContentVersion(version) {
  const normalized = parseContentVersion(version);
  if (!Number.isFinite(normalized)) return;
  try {
    localStorage.setItem(CONTENT_VERSION_STORAGE_KEY, String(normalized));
  } catch {}
}

function getStoredLastChangeType() {
  try {
    return normalizeChangeType(
      localStorage.getItem(LAST_CHANGE_TYPE_STORAGE_KEY) || "all"
    );
  } catch {
    return "all";
  }
}

function setStoredLastChangeType(changeType) {
  try {
    localStorage.setItem(
      LAST_CHANGE_TYPE_STORAGE_KEY,
      normalizeChangeType(changeType)
    );
  } catch {}
}

function recordAdminError(type, message, details = null) {
  const entry = {
    ts: Date.now(),
    type: toSafeString(type, "error"),
    message: toSafeString(message, "Unknown error"),
    details:
      details && typeof details === "object"
        ? JSON.stringify(details).slice(0, 500)
        : toSafeString(details).slice(0, 500),
  };
  adminDiagnosticsState.errors.unshift(entry);
  if (adminDiagnosticsState.errors.length > ADMIN_ERROR_LOG_LIMIT) {
    adminDiagnosticsState.errors.length = ADMIN_ERROR_LOG_LIMIT;
  }
}

function setControlsBusy(controls = [], isBusy = false) {
  controls
    .filter(Boolean)
    .forEach((control) => {
      if (!control || typeof control !== "object") return;
      if (isBusy) {
        if (!adminControlState.has(control)) {
          adminControlState.set(control, {
            disabled: Boolean(control.disabled),
            ariaBusy: control.getAttribute("aria-busy"),
          });
        }
        control.disabled = true;
        control.setAttribute("aria-busy", "true");
        control.classList.add("is-busy");
        return;
      }

      const previous = adminControlState.get(control);
      control.disabled = previous ? previous.disabled : false;
      if (!previous || previous.ariaBusy === null) {
        control.removeAttribute("aria-busy");
      } else {
        control.setAttribute("aria-busy", previous.ariaBusy);
      }
      control.classList.remove("is-busy");
      adminControlState.delete(control);
    });
}

function beginAdminAction(actionKey, controls = []) {
  if (!actionKey) return false;
  if (adminActionLocks.has(actionKey)) return false;
  adminActionLocks.add(actionKey);
  setControlsBusy(controls, true);
  return true;
}

function endAdminAction(actionKey, controls = []) {
  if (actionKey) {
    adminActionLocks.delete(actionKey);
  }
  setControlsBusy(controls, false);
}

function ensureAdminCrudProgressUi() {
  if (!document.getElementById("tb-admin-progress-style")) {
    const style = document.createElement("style");
    style.id = "tb-admin-progress-style";
    style.textContent = `
      .tb-admin-progress {
        position: fixed;
        top: 1rem;
        left: 50%;
        transform: translate3d(-50%, -18px, 0);
        opacity: 0;
        width: min(420px, calc(100vw - 1.5rem));
        z-index: 14000;
        pointer-events: none;
        transition: transform 200ms ease, opacity 180ms ease;
      }
      .tb-admin-progress.is-visible {
        opacity: 1;
        transform: translate3d(-50%, 0, 0);
      }
      .tb-admin-progress-card {
        background: color-mix(in srgb, var(--surface, #faf7f5) 94%, #fff);
        border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
        border-radius: 12px;
        box-shadow: 0 18px 38px rgba(0, 0, 0, 0.18);
        padding: 0.68rem 0.78rem;
      }
      [data-theme="dark"] .tb-admin-progress-card {
        background: color-mix(in srgb, var(--surface, #2d2d2d) 90%, #111);
      }
      .tb-admin-progress-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .tb-admin-progress-title {
        font-size: 0.86rem;
        font-weight: 700;
        color: var(--text, #222);
      }
      .tb-admin-progress-value {
        font-size: 0.8rem;
        font-weight: 700;
        color: var(--text-light, #666);
      }
      .tb-admin-progress-track {
        position: relative;
        height: 8px;
        margin-top: 0.45rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--text-light, #777) 18%, transparent);
        overflow: hidden;
      }
      .tb-admin-progress-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--primary, #e67a00), #32b26a);
        transition: width 180ms ease;
      }
      .tb-admin-progress-status {
        margin-top: 0.35rem;
        font-size: 0.78rem;
        color: var(--text-light, #666);
      }
      .tb-admin-progress.is-success .tb-admin-progress-fill {
        background: linear-gradient(90deg, #2fa66a, #1d9458);
      }
      .tb-admin-progress.is-error .tb-admin-progress-fill {
        background: linear-gradient(90deg, #da4a4a, #bf3030);
      }
      .tb-field-invalid {
        border-color: #d64545 !important;
        box-shadow: 0 0 0 2px rgba(214, 69, 69, 0.16) !important;
      }
      .tb-field-error {
        margin-top: 0.3rem;
        font-size: 0.76rem;
        color: #c83535;
      }
      @media (prefers-reduced-motion: reduce) {
        .tb-admin-progress {
          transition: none;
          transform: translate3d(-50%, 0, 0);
        }
        .tb-admin-progress-fill {
          transition: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  if (adminCrudProgressState.root) return adminCrudProgressState;

  const root = document.createElement("section");
  root.className = "tb-admin-progress";
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="tb-admin-progress-card">
      <div class="tb-admin-progress-head">
        <div class="tb-admin-progress-title">Saving changes</div>
        <div class="tb-admin-progress-value">0%</div>
      </div>
      <div class="tb-admin-progress-track">
        <div class="tb-admin-progress-fill"></div>
      </div>
      <p class="tb-admin-progress-status">Preparing request...</p>
    </div>
  `;
  document.body.appendChild(root);

  adminCrudProgressState.root = root;
  adminCrudProgressState.fill = root.querySelector(".tb-admin-progress-fill");
  adminCrudProgressState.value = root.querySelector(".tb-admin-progress-value");
  adminCrudProgressState.title = root.querySelector(".tb-admin-progress-title");
  adminCrudProgressState.status = root.querySelector(".tb-admin-progress-status");
  adminCrudProgressState.progress = 0;
  return adminCrudProgressState;
}

function setAdminCrudProgress(nextValue, statusText = "") {
  const ui = ensureAdminCrudProgressUi();
  const safe = Math.max(0, Math.min(100, Math.round(Number(nextValue) || 0)));
  ui.progress = safe;
  if (ui.fill) ui.fill.style.width = `${safe}%`;
  if (ui.value) ui.value.textContent = `${safe}%`;
  if (statusText && ui.status) ui.status.textContent = statusText;
}

function startAdminCrudProgress(titleText, statusText = "Preparing request...") {
  const ui = ensureAdminCrudProgressUi();
  if (ui.timer) {
    clearInterval(ui.timer);
    ui.timer = null;
  }
  ui.root.classList.remove("is-success", "is-error");
  ui.root.classList.add("is-visible");
  if (ui.title) ui.title.textContent = titleText || "Saving changes";
  if (ui.status) ui.status.textContent = statusText;
  setAdminCrudProgress(0, statusText);

  ui.timer = setInterval(() => {
    if (ui.progress >= 90) return;
    const step = ui.progress < 45 ? 7 : ui.progress < 70 ? 4 : 2;
    setAdminCrudProgress(ui.progress + step, "Syncing changes...");
  }, 140);

  return {
    complete(doneText = "Done") {
      if (ui.timer) {
        clearInterval(ui.timer);
        ui.timer = null;
      }
      ui.root.classList.remove("is-error");
      ui.root.classList.add("is-success");
      setAdminCrudProgress(100, doneText);
      setTimeout(() => {
        ui.root.classList.remove("is-visible", "is-success");
        setAdminCrudProgress(0, "Preparing request...");
      }, 900);
    },
    fail(errorText = "Request failed") {
      if (ui.timer) {
        clearInterval(ui.timer);
        ui.timer = null;
      }
      ui.root.classList.remove("is-success");
      ui.root.classList.add("is-error", "is-visible");
      setAdminCrudProgress(Math.max(ui.progress, 25), errorText);
    },
  };
}

function clearFieldError(field) {
  if (!field) return;
  field.classList.remove("tb-field-invalid");
  const messageEl = field.parentElement?.querySelector(
    `[data-field-error-for="${field.id}"]`
  );
  if (messageEl) {
    messageEl.remove();
  }
}

function setFieldError(field, message) {
  if (!field || !field.id) return;
  clearFieldError(field);
  field.classList.add("tb-field-invalid");
  const messageEl = document.createElement("p");
  messageEl.className = "tb-field-error";
  messageEl.setAttribute("data-field-error-for", field.id);
  messageEl.textContent = toSafeString(message);
  field.parentElement?.appendChild(messageEl);
}

function clearFormFieldErrors(form) {
  if (!form) return;
  form.querySelectorAll(".tb-field-invalid").forEach((field) => {
    field.classList.remove("tb-field-invalid");
  });
  form.querySelectorAll(".tb-field-error").forEach((msg) => msg.remove());
}

async function runAdminAction({
  actionKey,
  controls = [],
  progressTitle = "Saving changes",
  progressText = "Preparing request...",
  task,
}) {
  if (typeof task !== "function") {
    throw new Error("runAdminAction requires a task function");
  }

  if (!beginAdminAction(actionKey, controls)) {
    showNotification("Please wait for the current action to finish.", "info");
    return { ok: false, skipped: true, error: null, value: null };
  }

  const progress = startAdminCrudProgress(progressTitle, progressText);
  try {
    const value = await task(progress);
    return { ok: true, skipped: false, error: null, value, progress };
  } catch (error) {
    progress.fail(error?.message || "Request failed");
    return { ok: false, skipped: false, error, value: null, progress };
  } finally {
    endAdminAction(actionKey, controls);
  }
}

function requestAdminDynamicCacheClear() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const notify = (worker) => {
    if (!worker) return;
    try {
      worker.postMessage({ type: "CLEAR_DYNAMIC_CACHES" });
    } catch {}
  };

  if (navigator.serviceWorker.controller) {
    notify(navigator.serviceWorker.controller);
    return;
  }

  navigator.serviceWorker
    .getRegistration()
    .then((registration) => {
      notify(
        registration?.active || registration?.waiting || registration?.installing
      );
    })
    .catch(() => {});
}

function requestServiceWorkerMessage(type) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(false);
  }

  const send = async (worker) => {
    if (!worker) return false;
    try {
      worker.postMessage({ type });
      return true;
    } catch {
      return false;
    }
  };

  if (navigator.serviceWorker.controller) {
    return send(navigator.serviceWorker.controller);
  }

  return navigator.serviceWorker
    .getRegistration()
    .then((registration) =>
      send(registration?.active || registration?.waiting || registration?.installing)
    )
    .catch(() => false);
}

async function clearThemeCachesSafely() {
  try {
    await requestServiceWorkerMessage("CLEAR_THEME_CACHE");
    if (typeof caches !== "undefined") {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const entries = await cache.keys();
        for (const request of entries) {
          const url = request.url || "";
          if (
            /\/styles\/style\.css/i.test(url) ||
            /\/styles\/theme-[a-z0-9-]+\.css/i.test(url)
          ) {
            await cache.delete(request);
          }
        }
      }
    }
    adminDiagnosticsState.lastCachePurgeAt = Date.now();
    return true;
  } catch (error) {
    recordAdminError("cache", "Failed to clear theme caches", {
      message: error?.message || "",
    });
    return false;
  }
}

async function clearAppCachesSafely() {
  try {
    await requestServiceWorkerMessage("CLEAR_DYNAMIC_CACHES");
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      for (const name of names) {
        if (name.startsWith("toke-bakes")) {
          await caches.delete(name);
        }
      }
    }
    markPublicContentCacheDirty();
    clearDataCache();
    adminDiagnosticsState.lastCachePurgeAt = Date.now();
    return true;
  } catch (error) {
    recordAdminError("cache", "Failed to clear app caches", {
      message: error?.message || "",
    });
    return false;
  }
}

async function fetchServerUpdateSignal() {
  try {
    const result = await secureRequest(
      "/rest/v1/rpc/get_update_signal",
      "POST",
      {},
      {
        authRequired: true,
        retries: 2,
        timeout: 9000,
        suppressNotifications: true,
      }
    );
    const parsed = parseUpdateSignalPayload(result);
    if (parsed && Number.isFinite(parsed.contentVersion)) {
      setStoredContentVersion(parsed.contentVersion);
      setStoredLastChangeType(parsed.lastChangeType);
      return parsed;
    }
  } catch {}

  try {
    const legacyResult = await secureRequest(
      "/rest/v1/rpc/get_content_version",
      "POST",
      {},
      {
        authRequired: true,
        retries: 2,
        timeout: 9000,
        suppressNotifications: true,
      }
    );
    const parsedVersion = parseContentVersion(legacyResult);
    if (Number.isFinite(parsedVersion) && parsedVersion >= 0) {
      setStoredContentVersion(parsedVersion);
      return {
        contentVersion: parsedVersion,
        lastChangeType: getStoredLastChangeType(),
        updatedAtTs: 0,
      };
    }
  } catch {}

  return {
    contentVersion: getStoredContentVersion(),
    lastChangeType: getStoredLastChangeType(),
    updatedAtTs: 0,
  };
}

async function bumpServerUpdateSignal(changeType = "all") {
  const normalizedType = normalizeChangeType(changeType);
  try {
    const result = await secureRequest(
      "/rest/v1/rpc/bump_update_signal",
      "POST",
      { p_change_type: normalizedType },
      {
        authRequired: true,
        retries: 2,
        timeout: 10000,
        suppressNotifications: true,
      }
    );
    const parsed = parseContentVersion(result);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setStoredContentVersion(parsed);
      setStoredLastChangeType(normalizedType);
      return parsed;
    }
  } catch {}

  try {
    const legacyBump = await secureRequest(
      "/rest/v1/rpc/bump_content_version",
      "POST",
      {},
      {
        authRequired: true,
        retries: 1,
        timeout: 9000,
        suppressNotifications: true,
      }
    );
    const parsedLegacy = parseContentVersion(legacyBump);
    if (Number.isFinite(parsedLegacy) && parsedLegacy >= 0) {
      setStoredContentVersion(parsedLegacy);
      setStoredLastChangeType(normalizedType);
      return parsedLegacy;
    }
  } catch {}

  const current = getStoredContentVersion();
  const fallback = current + 1;

  try {
    await secureRequest(
      "/rest/v1/site_metadata?on_conflict=key",
      "POST",
      {
        key: "content_version",
        value: String(fallback),
        version: fallback,
        last_change_type: normalizedType,
        updated_at: new Date().toISOString(),
      },
      {
        authRequired: true,
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        suppressNotifications: true,
      }
    );
  } catch {}

  setStoredContentVersion(fallback);
  setStoredLastChangeType(normalizedType);
  return fallback;
}

async function ensureContentVersionAfterWrite(
  previousVersion = null,
  changeType = "all",
  forceIncrement = false
) {
  const before =
    Number.isFinite(previousVersion) && previousVersion >= 0
      ? previousVersion
      : (await fetchServerUpdateSignal()).contentVersion;

  const currentSignal = await fetchServerUpdateSignal();
  const current = currentSignal.contentVersion;
  if (!forceIncrement && Number.isFinite(current) && current > before) {
    return current;
  }

  const bumped = await bumpServerUpdateSignal(changeType);
  if (Number.isFinite(bumped) && bumped >= 0) {
    return bumped;
  }

  const fallback = Math.max(before || 0, getStoredContentVersion() || 0) + 1;
  setStoredContentVersion(fallback);
  setStoredLastChangeType(changeType);
  return fallback;
}

function cacheItemsForType(itemType, items) {
  const map = itemStateCache[itemType];
  if (!map) return;
  map.clear();

  if (!Array.isArray(items)) return;
  items.forEach((item) => {
    if (item && item.id !== undefined && item.id !== null) {
      map.set(String(item.id), item);
    }
  });
}

function getCachedItemForType(itemType, id) {
  const map = itemStateCache[itemType];
  if (!map) return null;
  return map.get(String(id)) || null;
}

function removeCachedItemForType(itemType, id) {
  const map = itemStateCache[itemType];
  if (!map) return;
  map.delete(String(id));
}

function clearAllItemStateCache() {
  Object.values(itemStateCache).forEach((map) => map.clear());
}

function resetLoadedTabs() {
  loadedAdminTabs.clear();
}

function getEndpointForType(itemType) {
  const endpoints = {
    featured: API_ENDPOINTS.FEATURED,
    menu: API_ENDPOINTS.MENU,
    specials: SPECIALS_ENDPOINT,
    carousel: API_ENDPOINTS.CAROUSEL,
  };
  return endpoints[itemType] || null;
}

function getBucketForType(itemType) {
  const buckets = {
    featured: STORAGE_BUCKETS.featured,
    menu: STORAGE_BUCKETS.menu,
    specials: STORAGE_BUCKETS.specials,
    carousel: STORAGE_BUCKETS.carousel,
  };
  return buckets[itemType] || null;
}

function invalidateEndpointCache(endpoint) {
  if (!endpoint) return;
  dataCache.forEach((_value, key) => {
    if (key.startsWith(endpoint)) {
      dataCache.delete(key);
    }
  });
}

function buildItemDetailsFromRecord(itemType, item) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title || item.alt || "Item",
    description: item.description || item.subtitle || "",
    price: item.price || null,
    created: item.created_at || null,
    type: itemType,
    image: resolveRecordImage(item) || null,
  };
}

async function getEditableItem(itemType, id) {
  const cached = getCachedItemForType(itemType, id);
  if (cached) return cached;

  const endpoint = getEndpointForType(itemType);
  if (!endpoint) return null;
  return loadDataFromSupabase(endpoint, id);
}

async function loadAdminTabData(tabId, force = false) {
  if (!force && loadedAdminTabs.has(tabId)) return;

  if (tabId === "featured") {
    await Promise.all([renderFeaturedItems(), populateFeaturedMenuSelect()]);
    loadedAdminTabs.add(tabId);
    return;
  }

  if (tabId === "menu") {
    await renderMenuItems();
    loadedAdminTabs.add(tabId);
    return;
  }

  if (tabId === "specials") {
    await renderSpecialsItems();
    loadedAdminTabs.add(tabId);
    return;
  }

  if (tabId === "carousel") {
    await renderCarouselItems();
    loadedAdminTabs.add(tabId);
    return;
  }

  if (tabId === "stats") {
    await loadStatsPanel(force);
    return;
  }

  if (tabId === "settings") {
    await updateItemCounts();
    return;
  }
}

function preloadAdminTabsInBackground() {
  const run = () => {
    Promise.allSettled([
      loadAdminTabData("menu"),
      loadAdminTabData("specials"),
      loadAdminTabData("carousel"),
    ]).catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 350);
  }
}

function getSelectedStatsDays() {
  const daysInput = document.getElementById("stats-days");
  const parsed = Number(daysInput?.value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(Math.floor(parsed), 3650));
}

function formatStatsCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return Math.max(0, Math.floor(num)).toLocaleString("en-US");
}

function formatStatsMoney(value) {
  const amount = toMoney(value, 0);
  return `NGN ${amount.toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function setStatsStatus(message, isError = false) {
  const statusEl = document.getElementById("stats-status");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#c62828" : "var(--text-light)";
}

function setStatsLastUpdated(dateLike = Date.now()) {
  const label = document.getElementById("stats-last-updated");
  if (!label) return;
  const value = new Date(dateLike);
  if (Number.isNaN(value.getTime())) {
    label.textContent = "Not refreshed yet";
    return;
  }
  label.textContent = `Last updated: ${value.toLocaleString()}`;
}

function renderStatsCountsRow(row = {}) {
  const mapping = {
    "stat-menu-items-total": "menu_items_total",
    "stat-menu-items-active": "menu_items_active",
    "stat-featured-items-total": "featured_items_total",
    "stat-specials-items-total": "specials_items_total",
    "stat-carousel-items-total": "carousel_items_total",
    "stat-option-groups-total": "option_groups_total",
    "stat-option-values-total": "option_values_total",
    "stat-unread-messages": "unread_messages",
    "stat-total-events": "total_events",
    "stat-page-views": "page_views",
    "stat-menu-views": "menu_views",
    "stat-add-to-cart": "add_to_cart",
    "stat-order-now-clicks": "order_now_clicks",
    "stat-orders-submitted": "orders_submitted",
    "stat-unique-sessions": "unique_sessions",
  };

  Object.entries(mapping).forEach(([elementId, key]) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = formatStatsCount(row[key] || 0);
  });

  const revenueEl = document.getElementById("stat-submitted-revenue");
  if (revenueEl) {
    revenueEl.textContent = formatStatsMoney(row.submitted_revenue || 0);
  }
}

function renderStatsDailyRows(rows) {
  const body = document.getElementById("stats-daily-body");
  if (!body) return;

  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    body.innerHTML = '<tr><td colspan="6">No activity recorded yet.</td></tr>';
    return;
  }

  body.innerHTML = safeRows
    .slice(0, 45)
    .map((row) => {
      const dayValue = row?.day ? new Date(`${row.day}T00:00:00`) : null;
      const dayLabel =
        dayValue && !Number.isNaN(dayValue.getTime())
          ? dayValue.toLocaleDateString()
          : "-";

      return `
        <tr>
          <td>${escapeHtml(dayLabel)}</td>
          <td>${escapeHtml(formatStatsCount(row?.total_events || 0))}</td>
          <td>${escapeHtml(formatStatsCount(row?.page_views || 0))}</td>
          <td>${escapeHtml(formatStatsCount(row?.add_to_cart || 0))}</td>
          <td>${escapeHtml(formatStatsCount(row?.orders_submitted || 0))}</td>
          <td>${escapeHtml(formatStatsMoney(row?.submitted_revenue || 0))}</td>
        </tr>
      `;
    })
    .join("");
}

function queueStatsPanelRefresh(delayMs = 900) {
  if (statsPanelState.refreshTimer) {
    clearTimeout(statsPanelState.refreshTimer);
  }

  statsPanelState.refreshTimer = setTimeout(() => {
    statsPanelState.refreshTimer = null;
    const statsTab = document.getElementById("stats-tab");
    if (statsTab?.classList.contains("active")) {
      Promise.resolve(loadStatsPanel(true)).catch((error) => {
        console.error("Stats auto-refresh failed:", error);
      });
    } else {
      loadedAdminTabs.delete("stats");
    }
  }, delayMs);
}

async function loadStatsPanel(force = false) {
  const statsTab = document.getElementById("stats-tab");
  if (!statsTab) return;

  const days = getSelectedStatsDays();
  if (
    !force &&
    loadedAdminTabs.has("stats") &&
    statsPanelState.lastLoadedDays === days
  ) {
    return;
  }

  if (statsPanelState.refreshing) return;
  statsPanelState.refreshing = true;

  const refreshBtn = document.getElementById("refresh-stats-btn");
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.setAttribute("aria-busy", "true");
  }

  setStatsStatus("Loading analytics...");

  try {
    const [countsResult, dailyResult] = await Promise.all([
      secureRequest(
        STATS_ENDPOINTS.counts,
        "POST",
        { p_days: days },
        {
          authRequired: true,
          suppressNotifications: true,
          timeout: 22000,
        }
      ),
      secureRequest(
        STATS_ENDPOINTS.daily,
        "POST",
        { p_days: days },
        {
          authRequired: true,
          suppressNotifications: true,
          timeout: 22000,
        }
      ),
    ]);

    const countsRows = Array.isArray(countsResult)
      ? countsResult
      : countsResult
        ? [countsResult]
        : [];
    const countsRow = countsRows[0] || {};

    renderStatsCountsRow(countsRow);
    renderStatsDailyRows(Array.isArray(dailyResult) ? dailyResult : []);
    await loadDebugStatePanel(countsRow);

    statsPanelState.lastLoadedDays = days;
    statsPanelState.lastRefreshAt = Date.now();
    loadedAdminTabs.add("stats");

    setStatsLastUpdated(statsPanelState.lastRefreshAt);
    setStatsStatus(`Showing stats for last ${days} day(s).`);
  } catch (error) {
    console.error("Failed to load stats panel:", error);
    setStatsStatus(
      "Unable to load stats. Confirm supabase-stats.sql has been applied.",
      true
    );
  } finally {
    statsPanelState.refreshing = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.removeAttribute("aria-busy");
    }
  }
}

function getActiveAdminTabId() {
  return (
    document.querySelector(".admin-tab.active")?.dataset?.tab ||
    "featured"
  );
}

async function refreshAdminUiFromSync(changeType = "all", payload = {}) {
  if (!currentAdmin) return false;
  const dashboard = document.getElementById("admin-dashboard");
  if (!dashboard || dashboard.style.display === "none") {
    return false;
  }

  const normalizedType = normalizeChangeType(changeType || "all");
  const activeTab = getActiveAdminTabId();

  clearDataCache();
  resetLoadedTabs();
  queueStatsPanelRefresh(320);

  const tasks = [];

  if (normalizedType === "all") {
    tasks.push(loadAdminTabData(activeTab, true));
    tasks.push(updateItemCounts());
    tasks.push(loadStatsPanel(true));
  } else {
    if (normalizedType === "featured" && activeTab === "featured") {
      tasks.push(renderFeaturedItems(true));
    }
    if (normalizedType === "menu") {
      if (activeTab === "menu") tasks.push(renderMenuItems(true));
      tasks.push(populateFeaturedMenuSelect(null, true));
    }
    if (normalizedType === "specials" && activeTab === "specials") {
      tasks.push(renderSpecialsItems(true));
    }
    if (normalizedType === "carousel" && activeTab === "carousel") {
      tasks.push(renderCarouselItems(true));
    }
    if (normalizedType === "theme") {
      tasks.push(
        Promise.resolve(
          window.ThemeManager &&
            typeof window.ThemeManager.checkForThemeUpdates === "function"
            ? window.ThemeManager.checkForThemeUpdates(true)
            : null
        )
      );
    }
    tasks.push(updateItemCounts());
    if (activeTab === "stats") tasks.push(loadStatsPanel(true));
  }

  if (tasks.length) {
    await Promise.allSettled(tasks);
  }

  if (normalizedType === "all") {
    showNotification("Global refresh applied. Sync complete.", "success");
  } else {
    showNotification("Admin synced latest changes.", "info");
  }
  return true;
}

async function runGlobalRefreshFromStats() {
  const globalRefreshBtn = document.getElementById("global-refresh-btn");
  const actionResult = await runAdminAction({
    actionKey: "global-refresh",
    controls: [globalRefreshBtn].filter(Boolean),
    progressTitle: "Publishing global refresh",
    progressText: "Preparing global sync signal...",
    task: async (progress) => {
      setStatsStatus("Publishing global refresh signal...");

      const baselineSignal = await fetchServerUpdateSignal();
      const baselineVersion = Number(baselineSignal?.contentVersion || 0) || 0;

      setAdminCrudProgress(20, "Clearing local caches...");
      await Promise.allSettled([clearThemeCachesSafely(), clearAppCachesSafely()]);

      setAdminCrudProgress(46, "Bumping global content version...");
      let contentVersion = await ensureContentVersionAfterWrite(
        baselineVersion,
        "all",
        true
      );
      const verifiedSignal = await fetchServerUpdateSignal();
      if (
        Number.isFinite(verifiedSignal?.contentVersion) &&
        verifiedSignal.contentVersion > contentVersion
      ) {
        contentVersion = verifiedSignal.contentVersion;
      }

      setAdminCrudProgress(68, "Broadcasting update across clients...");
      dataSync.notifyDataChanged("sync", "all", {
        source: "admin-global-refresh",
        forcedGlobalRefresh: true,
        contentVersion,
      });

      if (
        window.TokeUpdateSync &&
        typeof window.TokeUpdateSync.requestServerCheck === "function"
      ) {
        await window.TokeUpdateSync.requestServerCheck(
          "admin-global-refresh",
          true
        );
      }

      setAdminCrudProgress(82, "Refreshing admin snapshots...");
      clearDataCache();
      markPublicContentCacheDirty();
      resetLoadedTabs();
      await Promise.allSettled([updateItemCounts(), loadStatsPanel(true)]);

      progress.complete("Global refresh published");
      return contentVersion;
    },
  });

  if (actionResult.ok) {
    const versionLabel = Number.isFinite(actionResult.value)
      ? `v${actionResult.value}`
      : "latest version";
    setStatsStatus(
      `Global refresh published (${versionLabel}). Active devices will sync automatically.`
    );
    showNotification(
      `Global refresh sent (${versionLabel}).`,
      "success"
    );
    return;
  }

  if (actionResult.skipped) return;

  recordAdminError("sync", "Global refresh action failed", {
    message: actionResult.error?.message || "",
  });
  setStatsStatus("Global refresh failed. Check diagnostics.", true);
  showNotification("Global refresh failed.", "error");
}

function formatDebugDate(value) {
  if (!value) return "-";
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function setDebugValue(elementId, value) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = toSafeString(value, "-");
}

function setDebugStatusLine(message, isError = false) {
  const el = document.getElementById("debug-status-line");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#c62828" : "var(--text-light)";
}

async function sendMessageToServiceWorker(worker, message, timeoutMs = 1500) {
  if (!worker || typeof MessageChannel === "undefined") return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      finish(event?.data || null);
    };
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function getServiceWorkerDebugSnapshot() {
  const snapshot = {
    supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    registered: false,
    controlling: false,
    version: "-",
    cacheNames: [],
    lastUpdateDetectedAt: 0,
  };
  if (!snapshot.supported) return snapshot;

  try {
    snapshot.controlling = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.getRegistration();
    snapshot.registered = Boolean(registration);
    const worker =
      navigator.serviceWorker.controller ||
      registration?.active ||
      registration?.waiting ||
      registration?.installing ||
      null;

    const statusResp = await sendMessageToServiceWorker(worker, {
      type: "GET_SW_STATUS",
    });
    if (statusResp?.ok) {
      snapshot.version = statusResp.version || "-";
      snapshot.cacheNames = Array.isArray(statusResp.cacheNames)
        ? statusResp.cacheNames
        : [];
    }
  } catch (error) {
    recordAdminError("sw", "Failed to inspect service worker", {
      message: error?.message || "",
    });
  }

  try {
    snapshot.lastUpdateDetectedAt =
      Number(localStorage.getItem(SW_LAST_UPDATE_KEY) || "0") || 0;
  } catch {}

  return snapshot;
}

async function getCacheHealthSnapshot() {
  const snapshot = {
    names: [],
    totalEntries: 0,
    counts: [],
  };
  if (typeof caches === "undefined") return snapshot;
  try {
    const names = await caches.keys();
    snapshot.names = names;
    for (const name of names) {
      const cache = await caches.open(name);
      const entries = await cache.keys();
      snapshot.counts.push({ name, count: entries.length });
      snapshot.totalEntries += entries.length;
    }
  } catch (error) {
    recordAdminError("cache", "Failed to inspect cache storage", {
      message: error?.message || "",
    });
  }
  return snapshot;
}

async function fetchAdminUpdateSignal() {
  try {
    const result = await secureRequest(
      "/rest/v1/rpc/get_update_signal",
      "POST",
      {},
      { authRequired: true, suppressNotifications: true }
    );
    return parseUpdateSignalPayload(result);
  } catch {
    return {
      contentVersion: getStoredContentVersion(),
      lastChangeType: getStoredLastChangeType(),
      updatedAtTs: 0,
    };
  }
}

async function fetchAdminStateSnapshot() {
  try {
    return await secureRequest(
      "/rest/v1/rpc/get_site_state_snapshot",
      "POST",
      {},
      { authRequired: true, suppressNotifications: true }
    );
  } catch {
    return null;
  }
}

function renderDebugErrorLog() {
  const body = document.getElementById("debug-errors-body");
  if (!body) return;
  const rows = adminDiagnosticsState.errors.slice(0, ADMIN_ERROR_LOG_LIMIT);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3">No recent errors.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(formatDebugDate(entry.ts))}</td>
          <td>${escapeHtml(entry.type)}</td>
          <td>${escapeHtml(entry.message)}</td>
        </tr>
      `
    )
    .join("");
}

function renderDebugMetricsRows(rows = []) {
  const body = document.getElementById("debug-metrics-body");
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="2">No diagnostics yet.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(toSafeString(row.label))}</td>
          <td>${escapeHtml(toSafeString(row.value))}</td>
        </tr>
      `
    )
    .join("");
}

async function loadDebugStatePanel(countsRow = {}) {
  setDebugStatusLine("Collecting diagnostics...");
  try {
    const [signal, rawStateSnapshot, swSnapshot, cacheSnapshot, dbTheme] =
      await Promise.all([
        fetchAdminUpdateSignal(),
        fetchAdminStateSnapshot(),
        getServiceWorkerDebugSnapshot(),
        getCacheHealthSnapshot(),
        window.ThemeManager &&
        typeof window.ThemeManager.fetchActiveThemeFromDatabase === "function"
          ? window.ThemeManager.fetchActiveThemeFromDatabase(true).catch(() => null)
          : Promise.resolve(null),
      ]);
    const stateSnapshot = Array.isArray(rawStateSnapshot)
      ? rawStateSnapshot[0] || null
      : rawStateSnapshot;

    const syncStatus =
      window.TokeUpdateSync && typeof window.TokeUpdateSync.getStatus === "function"
        ? window.TokeUpdateSync.getStatus()
        : null;
    const localVersion = getStoredContentVersion();
    const localChangeType = getStoredLastChangeType();
    const lastSyncCheck =
      Number(localStorage.getItem(LAST_SYNC_CHECK_STORAGE_KEY) || "0") || 0;
    const lastAppliedThemeTs = Math.max(
      Number(localStorage.getItem("toke_bakes_global_theme_updated_at") || "0") || 0,
      Number(localStorage.getItem("toke_bakes_theme_last_update") || "0") || 0
    );

    const localThemePath =
      window.ThemeManager?.currentTheme ||
      localStorage.getItem("toke_bakes_global_theme_css") ||
      localStorage.getItem("toke_bakes_css_theme") ||
      "styles/style.css";
    const themePath = dbTheme?.css_file || localThemePath;
    const themeLabel =
      dbTheme?.theme_name ||
      window.ThemeManager?.getThemeName?.(themePath) ||
      themePath;

    setDebugValue("debug-active-theme", themeLabel);
    setDebugValue("debug-theme-path", themePath);
    setDebugValue("debug-content-version", String(signal?.contentVersion || 0));
    setDebugValue("debug-last-change-type", signal?.lastChangeType || "all");
    setDebugValue(
      "debug-sync-mode",
      syncStatus ? `${syncStatus.mode} (${syncStatus.status})` : "fallback"
    );
    setDebugValue(
      "debug-poll-interval",
      syncStatus?.pollIntervalMs ? `${syncStatus.pollIntervalMs}ms` : "-"
    );
    setDebugValue("debug-last-sync-check", formatDebugDate(lastSyncCheck));
    setDebugValue(
      "debug-sw-status",
      swSnapshot.supported
        ? `${swSnapshot.registered ? "registered" : "not-registered"} / ${
            swSnapshot.controlling ? "controlling" : "not-controlling"
          }`
        : "unsupported"
    );
    setDebugValue(
      "debug-sw-version",
      `${swSnapshot.version} | ${swSnapshot.cacheNames.length} caches`
    );
    setDebugValue(
      "debug-sw-update-time",
      formatDebugDate(swSnapshot.lastUpdateDetectedAt)
    );
    setDebugValue("debug-local-version", `${localVersion} (${localChangeType})`);

    const mismatchFlags = [];
    if (localVersion !== Number(signal?.contentVersion || 0)) {
      mismatchFlags.push("version");
    }
    if (normalizeChangeType(localChangeType) !== normalizeChangeType(signal?.lastChangeType)) {
      mismatchFlags.push("change-type");
    }
    if (dbTheme?.css_file && localThemePath && dbTheme.css_file !== localThemePath) {
      mismatchFlags.push("theme");
    }
    setDebugValue(
      "debug-mismatch-flags",
      mismatchFlags.length ? mismatchFlags.join(", ") : "None"
    );

    const cacheBreakdown = cacheSnapshot.counts.length
      ? cacheSnapshot.counts
          .map((entry) => `${entry.name}: ${entry.count}`)
          .join(" | ")
      : "None";
    const signalUpdatedAt =
      signal?.updatedAtTs && Number(signal.updatedAtTs) > 0
        ? formatDebugDate(signal.updatedAtTs)
        : "-";
    const snapshotLastUpdated =
      stateSnapshot?.last_updated_at ||
      stateSnapshot?.site_last_updated_at ||
      signalUpdatedAt;
    const metricsRows = [
      {
        label: "Menu/Specials/Carousel totals",
        value: `${countsRow?.menu_items_total || 0} / ${countsRow?.specials_items_total || 0} / ${
          countsRow?.carousel_items_total || 0
        }`,
      },
      {
        label: "Signal updated at",
        value: signalUpdatedAt,
      },
      {
        label: "Last table update (snapshot)",
        value: snapshotLastUpdated,
      },
      {
        label: "Menu/Featured table updated",
        value: `${formatDebugDate(stateSnapshot?.menu_last_updated_at)} / ${formatDebugDate(
          stateSnapshot?.featured_last_updated_at
        )}`,
      },
      {
        label: "Specials/Carousel updated",
        value: `${formatDebugDate(stateSnapshot?.specials_last_updated_at)} / ${formatDebugDate(
          stateSnapshot?.carousel_last_updated_at
        )}`,
      },
      {
        label: "Theme/Options updated",
        value: `${formatDebugDate(stateSnapshot?.themes_last_updated_at)} / ${formatDebugDate(
          stateSnapshot?.options_last_updated_at
        )}`,
      },
      {
        label: "Sync bus leader",
        value: syncStatus ? String(Boolean(syncStatus.isLeader)) : "-",
      },
      {
        label: "Sync bus last successful check",
        value: syncStatus?.lastServerCheckOkAt
          ? formatDebugDate(syncStatus.lastServerCheckOkAt)
          : "-",
      },
      {
        label: "Cache names",
        value: cacheSnapshot.names.length
          ? cacheSnapshot.names.join(", ")
          : "None",
      },
      {
        label: "Cache entry breakdown",
        value: cacheBreakdown,
      },
      {
        label: "Approx cache entries",
        value: `${cacheSnapshot.totalEntries}`,
      },
      {
        label: "Last applied theme snapshot",
        value: formatDebugDate(lastAppliedThemeTs),
      },
      {
        label: "Last cache purge",
        value: formatDebugDate(adminDiagnosticsState.lastCachePurgeAt),
      },
    ];
    renderDebugMetricsRows(metricsRows);
    renderDebugErrorLog();
    setDebugStatusLine(`Diagnostics refreshed at ${new Date().toLocaleTimeString()}.`);
  } catch (error) {
    recordAdminError("debug", "Failed to load diagnostics panel", {
      message: error?.message || "",
    });
    renderDebugErrorLog();
    setDebugStatusLine("Failed to load diagnostics.", true);
  }
}

/* ================== MODERN CONFIRMATION DIALOG SYSTEM ================== */

class ModernConfirmationDialog {
  constructor() {
    this.dialogId = "modern-confirmation-dialog";
    this.init();
  }

  init() {
    if (!document.getElementById(this.dialogId)) {
      this.createDialog();
    }
  }

  createDialog() {
    const dialogHTML = `
      <div id="${this.dialogId}" class="confirmation-dialog" aria-hidden="true">
        <div class="confirmation-content" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
          <div class="confirmation-header">
            <i class="fas fa-exclamation-triangle"></i>
            <h3 id="confirmation-title">Confirm Deletion</h3>
            <p>Are you sure you want to delete this item?</p>
          </div>
          <div class="confirmation-body">
            <div id="confirmation-details"></div>
          </div>
          <div class="confirmation-actions">
            <button id="confirm-cancel" class="btn-confirm-cancel">
              <i class="fas fa-times"></i> Cancel
            </button>
            <button id="confirm-delete" class="btn-confirm-delete">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", dialogHTML);
  }

  show(itemDetails) {
    return new Promise((resolve) => {
      const dialog = document.getElementById(this.dialogId);
      const detailsEl = document.getElementById("confirmation-details");
      const cancelBtn = document.getElementById("confirm-cancel");
      const deleteBtn = document.getElementById("confirm-delete");
      const titleEl = document.getElementById("confirmation-title");

      // Set dialog content based on item type
      let itemType = "Item";
      if (itemDetails.type === "featured") itemType = "Featured Item";
      if (itemDetails.type === "menu") itemType = "Menu Item";
      if (itemDetails.type === "specials") itemType = "Special";
      if (itemDetails.type === "carousel") itemType = "Carousel Image"; // Added

      titleEl.textContent = `Delete ${itemType}`;

      const detailsHTML = `
        <p>This action cannot be undone. The following ${itemType.toLowerCase()} will be permanently deleted:</p>
        <div class="confirmation-item">
          <h4>${escapeHtml(itemDetails.title)}</h4>
          ${
            itemDetails.description
              ? `<p>${escapeHtml(itemDetails.description)}</p>`
              : ""
          }
          ${
            itemDetails.price
              ? `<p><strong>Price:</strong> \u20A6${formatPrice(
                  itemDetails.price
                )}</p>`
              : ""
          }
          ${
            itemDetails.created
              ? `<p><small>Created: ${new Date(
                  itemDetails.created
                ).toLocaleDateString()}</small></p>`
              : ""
          }
        </div>
        <p><strong>Warning:</strong> This will permanently remove this item from your database.</p>
      `;

      detailsEl.innerHTML = detailsHTML;

      // Show dialog
      dialog.classList.add("active");
      dialog.setAttribute("aria-hidden", "false");
      deleteBtn.focus();

      // Handle escape key
      const handleEscape = (e) => {
        if (e.key === "Escape") {
          dialog.classList.remove("active");
          dialog.setAttribute("aria-hidden", "true");
          resolve(false);
          document.removeEventListener("keydown", handleEscape);
        }
      };

      document.addEventListener("keydown", handleEscape);

      // Button event handlers
      const handleCancel = () => {
        dialog.classList.remove("active");
        dialog.setAttribute("aria-hidden", "true");
        resolve(false);
        cleanup();
      };

      const handleDelete = () => {
        dialog.classList.remove("active");
        dialog.setAttribute("aria-hidden", "true");
        resolve(true);
        cleanup();
      };

      const cleanup = () => {
        cancelBtn.removeEventListener("click", handleCancel);
        deleteBtn.removeEventListener("click", handleDelete);
        document.removeEventListener("keydown", handleEscape);
      };

      cancelBtn.addEventListener("click", handleCancel, { once: true });
      deleteBtn.addEventListener("click", handleDelete, { once: true });
    });
  }
}

// Initialize the modern confirmation dialog system
const confirmationDialog = new ModernConfirmationDialog();

// Helper function to get item details
async function getItemDetails(itemId, itemType) {
  const cachedItem = getCachedItemForType(itemType, itemId);
  if (cachedItem) {
    return buildItemDetailsFromRecord(itemType, cachedItem);
  }

  try {
    const endpoint = getEndpointForType(itemType) || API_ENDPOINTS.FEATURED;
    const item = await loadDataFromSupabase(endpoint, itemId, true);

    if (item) {
      return buildItemDetailsFromRecord(itemType, item);
    }
  } catch (error) {
    console.error("Error fetching item details:", error);
  }

  return {
    id: itemId,
    title: itemType === "carousel" ? "Carousel Image" : "Unknown Item",
    description: "",
    type: itemType,
  };
}

// Price formatting function
function formatPrice(num) {
  const amount = Number(num);
  const safe = Number.isFinite(amount) ? amount : 0;
  const normalized = Math.round((safe + Number.EPSILON) * 100) / 100;
  return normalized.toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function toMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionType(value) {
  const raw = String(value || "single").trim().toLowerCase();
  return raw === "multiple" ? "multiple" : "single";
}

function normalizeOptionGroupRecord(record = {}) {
  return {
    id: String(record.id || "").trim(),
    product_id: String(record.product_id || "").trim(),
    name: toSafeString(record.name, "Options"),
    type: normalizeOptionType(record.type),
    required: Boolean(record.required),
    max_selections:
      record.max_selections === null || record.max_selections === undefined
        ? null
        : Math.max(1, parseInt(record.max_selections, 10) || 1),
    created_at: record.created_at || null,
    values: [],
  };
}

function normalizeOptionValueRecord(record = {}) {
  return {
    id: String(record.id || "").trim(),
    group_id: String(record.group_id || "").trim(),
    name: toSafeString(record.name, "Option"),
    price_adjustment: toMoney(record.price_adjustment || 0, 0),
  };
}

function formatOptionAdjustmentLabel(value) {
  const amount = toMoney(value || 0, 0);
  if (amount === 0) return "No extra charge";
  const prefix = amount > 0 ? "+" : "-";
  return `${prefix}NGN ${formatPrice(Math.abs(amount))}`;
}

function parseDisplayOrderValue(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  const safeFallback = Number.parseInt(fallback, 10);
  return Number.isFinite(safeFallback) && safeFallback >= 0 ? safeFallback : 0;
}

function parseRecordBoolean(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function compareRecordsByDisplayOrder(a, b) {
  const aOrder = parseDisplayOrderValue(a?.display_order, 0);
  const bOrder = parseDisplayOrderValue(b?.display_order, 0);
  if (aOrder !== bOrder) return aOrder - bOrder;

  const aCreated = Date.parse(a?.created_at || "") || 0;
  const bCreated = Date.parse(b?.created_at || "") || 0;
  if (aCreated !== bCreated) return bCreated - aCreated;

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

async function withPreservedScroll(task) {
  if (typeof task !== "function") return null;
  const x = window.scrollX || 0;
  const y = window.scrollY || 0;
  const result = await task();
  try {
    window.scrollTo({ left: x, top: y, behavior: "auto" });
  } catch {
    window.scrollTo(x, y);
  }
  return result;
}

function getAdminListContainer(itemType) {
  const selectors = {
    featured: "featured-items-list",
    menu: "menu-items-list",
    specials: "specials-admin-grid",
    carousel: "carousel-admin-grid",
  };
  return document.getElementById(selectors[itemType] || "");
}

function buildMenuAdminCardElement(item = {}) {
  const id = toSafeString(item.id).trim();
  if (!id) return null;
  const imgSrc = resolveImageForDisplay(
    resolveRecordImage(item),
    ADMIN_IMAGE_PLACEHOLDERS.menu
  );
  const title = toSafeString(item.title, "Menu Item");
  const description = toSafeString(item.description);
  const orderValue = parseDisplayOrderValue(item.display_order, 0);
  const priceValue = toMoney(item.price, 0);
  const escapedId = escapeHtml(id);

  const card = document.createElement("div");
  card.className = "item-card";
  card.dataset.id = id;
  card.dataset.order = String(orderValue);
  card.dataset.item = title;
  card.dataset.price = String(priceValue);
  card.innerHTML = `
    <img src="${imgSrc}" alt="${escapeHtml(title)}" class="item-card-img" loading="lazy" decoding="async"
         onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.menu}';">
    <div class="item-card-content">
      <h3 class="item-card-title">${escapeHtml(title)}</h3>
      <p class="item-card-desc">${escapeHtml(description)}</p>
      <div class="item-card-actions">
        <button class="btn-edit" onclick="editMenuItem('${escapedId}')">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn-options" onclick="openMenuOptionsManager('${escapedId}')">
          <i class="fas fa-sliders-h"></i> Options
        </button>
        <button class="btn-delete" onclick="deleteMenuItem('${escapedId}')">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;

  return card;
}

function buildSpecialsAdminCardElement(item = {}, badgeOrder = null) {
  const id = toSafeString(item.id).trim();
  if (!id) return null;
  const imgSrc = resolveImageForDisplay(
    resolveRecordImage(item),
    ADMIN_IMAGE_PLACEHOLDERS.specials
  );
  const title = toSafeString(item.title || item.alt, "Special Offer");
  const price = toMoney(item.price, 0);
  const originalPrice =
    item.original_price === null || item.original_price === undefined
      ? null
      : toMoney(item.original_price, 0);
  const isActive = parseRecordBoolean(item.is_active, true);
  const isSpecialBadge = parseRecordBoolean(item.is_special, false);
  const orderValue = parseDisplayOrderValue(item.display_order, 0);
  const badgeValue =
    Number.isFinite(Number(badgeOrder)) && Number(badgeOrder) > 0
      ? Math.trunc(Number(badgeOrder))
      : orderValue + 1;
  const escapedId = escapeHtml(id);

  const card = document.createElement("div");
  card.className = "specials-admin-item";
  card.dataset.id = id;
  card.dataset.order = String(orderValue);
  card.innerHTML = `
    <img src="${imgSrc}" alt="${escapeHtml(title)}" loading="lazy" decoding="async"
         onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.specials}';">
    <div class="specials-admin-overlay">
      <p><strong>Title:</strong> ${escapeHtml(title)}</p>
      <p><strong>Price:</strong> \u20A6${escapeHtml(formatPrice(price))}${
        Number.isFinite(originalPrice) && originalPrice > price
          ? ` <span style="text-decoration:line-through;opacity:.75;">(Was \u20A6${escapeHtml(
              formatPrice(originalPrice)
            )})</span>`
          : ""
      }</p>
      <p><strong>Status:</strong> ${isActive ? "Active" : "Inactive"}${
        isSpecialBadge ? " | Badge On" : ""
      }</p>
      <p><strong>Order:</strong> <span data-order-label="true">${badgeValue}</span></p>
      <div class="specials-admin-actions">
        <button class="btn-edit" onclick="editSpecialsItem('${escapedId}')">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn-delete" onclick="deleteSpecialsItem('${escapedId}')">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;

  return card;
}

function buildCarouselAdminCardElement(item = {}, badgeOrder = null) {
  const id = toSafeString(item.id).trim();
  if (!id) return null;
  const alt = toSafeString(item.alt, "Carousel image");
  const orderValue = parseDisplayOrderValue(item.display_order, 0);
  const badgeValue =
    Number.isFinite(Number(badgeOrder)) && Number(badgeOrder) > 0
      ? Math.trunc(Number(badgeOrder))
      : orderValue + 1;
  const isActive = parseRecordBoolean(item.is_active, true);
  const escapedId = escapeHtml(id);

  const card = document.createElement("div");
  card.className = "carousel-admin-item";
  card.dataset.id = id;
  card.dataset.order = String(orderValue);
  card.innerHTML = `
    <div class="carousel-slide-badge ${isActive ? "active" : "inactive"}">
      <i class="fas fa-${isActive ? "check-circle" : "pause-circle"}"></i>
      ${isActive ? "Active" : "Inactive"}
    </div>
    <div class="carousel-slide-number" data-order-badge="true">${badgeValue}</div>
    <img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.carousel)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"
         onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.carousel}';">
    <div class="carousel-admin-overlay">
      <p><strong>Alt Text:</strong> ${escapeHtml(alt)}</p>
      <p><strong>Order:</strong> <span data-order-label="true">${badgeValue}</span></p>
      <div class="carousel-admin-actions">
        <button class="btn-edit" onclick="editCarouselItem('${escapedId}')">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn-delete" onclick="deleteCarouselItem('${escapedId}')">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;

  return card;
}

function buildAdminCardElement(itemType, item, badgeOrder = null) {
  if (itemType === "menu") return buildMenuAdminCardElement(item);
  if (itemType === "specials") return buildSpecialsAdminCardElement(item, badgeOrder);
  if (itemType === "carousel") return buildCarouselAdminCardElement(item, badgeOrder);
  return null;
}

function refreshOrderBadges(itemType) {
  const container = getAdminListContainer(itemType);
  if (!container) return;
  const cards = Array.from(container.children).filter(
    (child) => child && child.dataset && child.dataset.id
  );
  cards.forEach((card, index) => {
    const badgeValue = String(index + 1);
    const badge = card.querySelector("[data-order-badge='true']");
    if (badge) badge.textContent = badgeValue;
    const label = card.querySelector("[data-order-label='true']");
    if (label) label.textContent = badgeValue;
  });
}

function syncCachedListAfterUpsert(itemType, item) {
  if (!item || item.id === undefined || item.id === null) return;
  const id = String(item.id);
  const endpoint = getEndpointForType(itemType);
  const map = itemStateCache[itemType];
  if (map) {
    map.set(id, item);
  }
  cacheTempImageForItem(id, resolveRecordImage(item));

  if (!endpoint) return;
  const listCache = dataCache.get(endpoint);
  if (listCache && Array.isArray(listCache.data)) {
    const nextList = listCache.data.slice();
    const existingIndex = nextList.findIndex(
      (entry) => String(entry?.id || "") === id
    );
    if (existingIndex >= 0) {
      nextList[existingIndex] = item;
    } else {
      nextList.push(item);
    }
    nextList.sort(compareRecordsByDisplayOrder);
    dataCache.set(endpoint, {
      data: nextList,
      timestamp: Date.now(),
    });
  }

  dataCache.set(`${endpoint}_${id}`, {
    data: item,
    timestamp: Date.now(),
  });
}

function upsertItemCardInUi(itemType, item) {
  if (!item || item.id === undefined || item.id === null) return false;
  const container = getAdminListContainer(itemType);
  const nextCard = buildAdminCardElement(itemType, item);
  if (!container || !nextCard) return false;

  const emptyState = container.querySelector(".empty-state");
  if (emptyState && container.children.length === 1) {
    container.innerHTML = "";
  }

  const safeId = String(item.id).replace(/"/g, '\\"');
  const existing = container.querySelector(`[data-id="${safeId}"]`);
  if (existing) {
    existing.replaceWith(nextCard);
  } else {
    container.appendChild(nextCard);
  }

  const cards = Array.from(container.children).filter(
    (child) => child && child.dataset && child.dataset.id
  );
  if (cards.length > 1) {
    cards.sort((a, b) => {
      const aOrder = parseDisplayOrderValue(a.dataset.order, 0);
      const bOrder = parseDisplayOrderValue(b.dataset.order, 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.dataset.id || "").localeCompare(String(b.dataset.id || ""));
    });
    const fragment = document.createDocumentFragment();
    cards.forEach((card) => fragment.appendChild(card));
    container.appendChild(fragment);
  }

  refreshOrderBadges(itemType);

  syncCachedListAfterUpsert(itemType, item);
  return true;
}

async function normalizeDisplayOrderConflicts(itemType, itemId, desiredOrder) {
  if (!DISPLAY_ORDER_MANAGED_TYPES.has(itemType)) {
    return { normalized: false, changedCount: 0 };
  }

  const endpoint = getEndpointForType(itemType);
  const id = String(itemId || "").trim();
  const orderValue = parseDisplayOrderValue(desiredOrder, 0);
  if (!endpoint || !id) {
    return { normalized: false, changedCount: 0 };
  }

  try {
    const encodedId = encodeURIComponent(id);
    const conflictRows = await secureRequest(
      `${endpoint}?select=id&display_order=eq.${orderValue}&id=neq.${encodedId}&limit=1`,
      "GET",
      null,
      {
        authRequired: true,
        retries: 1,
        timeout: 9000,
        suppressNotifications: true,
      }
    );

    if (!Array.isArray(conflictRows) || conflictRows.length === 0) {
      return { normalized: false, changedCount: 0 };
    }

    const rows = await secureRequest(
      `${endpoint}?select=id,display_order,created_at&order=display_order.asc,created_at.desc`,
      "GET",
      null,
      {
        authRequired: true,
        retries: 1,
        timeout: 12000,
        suppressNotifications: true,
      }
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return { normalized: false, changedCount: 0 };
    }

    const orderedIds = rows
      .map((row) => String(row?.id || "").trim())
      .filter(Boolean)
      .filter((rowId) => rowId !== id);

    const insertIndex = Math.min(orderValue, orderedIds.length);
    orderedIds.splice(insertIndex, 0, id);

    const currentById = new Map(
      rows.map((row) => [
        String(row?.id || "").trim(),
        parseDisplayOrderValue(row?.display_order, 0),
      ])
    );

    const changedRows = orderedIds
      .map((rowId, idx) => ({
        id: rowId,
        display_order: idx,
      }))
      .filter(
        (row) =>
          currentById.has(row.id) &&
          currentById.get(row.id) !== row.display_order
      );

    if (!changedRows.length) {
      return { normalized: false, changedCount: 0 };
    }

    await Promise.all(
      changedRows.map((row) =>
        secureRequest(
          `${endpoint}?id=eq.${encodeURIComponent(row.id)}`,
          "PATCH",
          { display_order: row.display_order },
          {
            authRequired: true,
            retries: 1,
            timeout: 12000,
            suppressNotifications: true,
          }
        )
      )
    );

    invalidateEndpointCache(endpoint);
    dataCache.delete(endpoint);
    changedRows.forEach((row) => {
      dataCache.delete(`${endpoint}_${row.id}`);
    });

    return { normalized: true, changedCount: changedRows.length };
  } catch (error) {
    console.error(`Display order normalization failed (${itemType}):`, error);
    return { normalized: false, changedCount: 0, error };
  }
}

function removeItemFromUi(itemType, id) {
  if (!id) return;
  const selectorMap = {
    featured: `#featured-items-list [data-id="${id}"]`,
    menu: `#menu-items-list [data-id="${id}"]`,
    specials: `#specials-admin-grid [data-id="${id}"]`,
    carousel: `#carousel-admin-grid [data-id="${id}"]`,
  };
  const target = document.querySelector(selectorMap[itemType]);
  if (!target) return;
  target.classList.add("removing");
  setTimeout(() => {
    if (target && target.parentElement) {
      target.remove();
    }
  }, 160);
}

function refreshListAfterDelete(itemType, forceRefresh = false) {
  try {
    if (itemType === "featured") {
      return renderFeaturedItems(forceRefresh);
    }
    if (itemType === "menu") {
      return Promise.all([
        renderMenuItems(forceRefresh),
        populateFeaturedMenuSelect(null, forceRefresh),
      ]);
    }
    if (itemType === "specials") {
      return renderSpecialsItems(forceRefresh);
    }
    if (itemType === "carousel") {
      return renderCarouselItems(forceRefresh);
    }
  } catch (error) {
    console.error(`Refresh after delete failed for ${itemType}:`, error);
  }
  return Promise.resolve();
}

// Modified delete functions with modern confirmation dialog
async function deleteItemByType(id, itemType) {
  const endpoint = getEndpointForType(itemType);
  const bucket = getBucketForType(itemType);
  if (!endpoint || !bucket) {
    showNotification("Unknown item type", "error");
    return;
  }

  const labels = {
    featured: "Featured item",
    menu: "Menu item",
    specials: "Special",
    carousel: "Carousel image",
  };
  const label = labels[itemType] || "Item";

  try {
    const cached = getCachedItemForType(itemType, id);
    const itemDetails =
      buildItemDetailsFromRecord(itemType, cached) ||
      (await getItemDetails(id, itemType));

    const confirmed = await confirmationDialog.show(itemDetails);

    if (!confirmed) {
      showNotification("Deletion cancelled", "info");
      return;
    }
    const actionResult = await runAdminAction({
      actionKey: `delete-${itemType}-${id}`,
      progressTitle: `Deleting ${label.toLowerCase()}`,
      progressText: "Removing item...",
      task: async (progress) => {
        const baselineVersion = (await fetchServerUpdateSignal()).contentVersion;
        await secureRequest(`${endpoint}?id=eq.${id}`, "DELETE", null, {
          authRequired: true,
        });

        const storagePath = extractStoragePath(itemDetails.image, bucket);
        try {
          await deleteFromStorage(bucket, storagePath);
        } catch (storageError) {
          console.error("Storage cleanup failed after DB delete:", storageError);
        }

        tempImageCache.delete(id);
        removeCachedItemForType(itemType, id);
        invalidateEndpointCache(endpoint);
        markPublicContentCacheDirty();
        removeItemFromUi(itemType, id);
        if (
          itemType === "menu" &&
          menuOptionManagerState.menuItemId === String(id)
        ) {
          closeMenuOptionsManager();
        }

        const contentVersion = await ensureContentVersionAfterWrite(
          baselineVersion,
          itemType
        );

        const refreshPromise = refreshListAfterDelete(itemType, true);
        refreshPromise.catch((error) =>
          console.error(`Background refresh failed (${itemType}):`, error)
        );
        Promise.resolve(updateItemCounts()).catch((error) =>
          console.error("Update counts failed:", error)
        );

        dataSync.notifyDataChanged("delete", itemType, { contentVersion });
        progress.complete(`${label} deleted`);
      },
    });

    if (!actionResult.ok) {
      if (!actionResult.skipped) {
        throw actionResult.error || new Error(`Failed to delete ${label}`);
      }
      return;
    }

    showNotification(`${label} deleted!`, "success");
  } catch (error) {
    console.error(`Error deleting ${itemType} item:`, error);
    showNotification(`Failed to delete ${label.toLowerCase()}`, "error");
  }
}

async function deleteFeaturedItem(id) {
  return deleteItemByType(id, "featured");
}

async function deleteMenuItem(id) {
  return deleteItemByType(id, "menu");
}

async function deleteSpecialsItem(id) {
  return deleteItemByType(id, "specials");
}

/* ================== CAROUSEL DELETE FUNCTION ================== */
async function deleteCarouselItem(id) {
  return deleteItemByType(id, "carousel");
}

/* ================== ENHANCED SECURITY FUNCTIONS ================== */

// Generate secure session token
function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

// Secure storage for session data
const secureStorage = {
  setItem: (key, value) => {
    try {
      sessionStorage.setItem(`secure_${key}`, btoa(JSON.stringify(value)));
    } catch (e) {
      debugWarn("Secure storage failed:", e);
      // Fallback to memory storage
      window.tempStorage = window.tempStorage || {};
      window.tempStorage[`secure_${key}`] = value;
    }
  },
  getItem: (key) => {
    try {
      const item = sessionStorage.getItem(`secure_${key}`);
      return item ? JSON.parse(atob(item)) : null;
    } catch (e) {
      debugWarn("Secure storage retrieval failed:", e);
      // Check memory storage
      return window.tempStorage ? window.tempStorage[`secure_${key}`] : null;
    }
  },
  removeItem: (key) => {
    try {
      sessionStorage.removeItem(`secure_${key}`);
    } catch (e) {
      debugWarn("Secure storage removal failed:", e);
    }
    // Also remove from memory storage
    if (window.tempStorage) {
      delete window.tempStorage[`secure_${key}`];
    }
  },
};

// Input sanitization
function sanitizeInput(input) {
  if (typeof input !== "string") return input;
  return input
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .trim();
}

const UUID_FORMAT_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value) {
  return UUID_FORMAT_REGEX.test(toSafeString(value));
}

function readJwtPayload(token) {
  const rawToken = toSafeString(token);
  if (!rawToken) return null;
  const parts = rawToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isSessionTokenUsable(session) {
  if (!session || typeof session !== "object") return false;
  const accessToken = toSafeString(session.access_token);
  if (!accessToken) return false;
  const payload = readJwtPayload(accessToken);
  if (!payload || typeof payload !== "object") return false;
  const subject = toSafeString(payload.sub || session.user?.id);
  return isUuidLike(subject);
}

// Escape HTML for safety
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function toSafeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\u0000/g, "").trim();
  return text || fallback;
}

function normalizeAssetPath(value) {
  const raw = toSafeString(value);
  if (!raw) return "";
  return raw.replace(/\s+\.(?=[a-z0-9]+($|\?))/gi, ".");
}

function resolveRecordImage(record) {
  if (!record) return "";
  return normalizeAssetPath(
    record.image ||
      record.image_url ||
      record.imageUrl ||
      record.src ||
      record.url
  );
}

const ADMIN_IMAGE_PLACEHOLDERS = {
  featured:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg==",
  menu: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lbnUgSXRlbTwvdGV4dD48L3N2Zz4=",
  specials:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkdhbGxlcnk8L3RleHQ+PC9zdmc+=",
  carousel:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNhcm91c2VsPC90ZXh0Pjwvc3ZnPg==",
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
  // Accept path-like values (e.g., storage paths) so we don't break older rows.
  return raw.includes("/");
}

function getAdminAssetVersionToken() {
  try {
    const contentVersion =
      parseContentVersion(localStorage.getItem(CONTENT_VERSION_STORAGE_KEY)) || 0;
    const themeUpdateTs =
      Number(localStorage.getItem("toke_bakes_theme_last_update") || "0") || 0;
    if (contentVersion <= 0 && themeUpdateTs <= 0) return "";
    return `${contentVersion}-${themeUpdateTs}`;
  } catch {
    return "";
  }
}

function appendAdminAssetVersion(src) {
  const raw = toSafeString(src);
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("blob:")) {
    return raw;
  }

  const version = getAdminAssetVersionToken();
  if (!version) return raw;

  try {
    const parsed = new URL(raw, window.location.origin);
    parsed.searchParams.set("cv", version);

    if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) {
      return parsed.toString();
    }

    const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return relative || raw;
  } catch {
    const encodedVersion = encodeURIComponent(version);
    if (raw.includes("cv=")) {
      return raw.replace(/([?&])cv=[^&#]*/i, `$1cv=${encodedVersion}`);
    }
    return `${raw}${raw.includes("?") ? "&" : "?"}cv=${encodedVersion}`;
  }
}

function resolveImageForDisplay(rawValue, placeholderDataUri) {
  const normalized = normalizeAssetPath(rawValue);
  if (!normalized) return placeholderDataUri;
  const lower = normalized.toLowerCase();
  if (lower.startsWith("placeholder-")) {
    return placeholderDataUri;
  }
  if (!looksLikeImageSrc(normalized)) return placeholderDataUri;
  return appendAdminAssetVersion(normalized);
}

/* ================== CUSTOM POPUP SYSTEM ================== */

function showPopup(options) {
  return new Promise((resolve) => {
    ADMIN_POPUP_QUEUE.push({ options, resolve });
    pumpAdminPopupQueue();
  });
}

function pumpAdminPopupQueue() {
  if (adminPopupActive) return;
  const next = ADMIN_POPUP_QUEUE.shift();
  if (!next) return;

  adminPopupActive = true;
  showPopupInternal(next.options)
    .then((result) => {
      next.resolve(result);
    })
    .catch(() => {
      next.resolve(false);
    })
    .finally(() => {
      adminPopupActive = false;
      pumpAdminPopupQueue();
    });
}

// Custom popup system to replace alert/confirm
function showPopupInternal(options) {
  return new Promise((resolve) => {
    // Remove existing popup if any
    const existingPopup = document.getElementById("custom-popup-overlay");
    if (existingPopup) {
      existingPopup.remove();
    }

    const {
      title = "Notification",
      message,
      type = "info",
      showCancel = false,
      showInput = false,
      inputPlaceholder = "",
      inputValue = "",
      cancelText = "Cancel",
      confirmText = "OK",
      onConfirm = () => {},
      onCancel = () => {},
    } = options;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.id = "custom-popup-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
      backdrop-filter: blur(4px);
      animation: fadeIn 0.3s ease;
    `;

    // Create popup
    const popup = document.createElement("div");
    popup.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 0;
      min-width: 320px;
      max-width: 450px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      animation: slideIn 0.3s ease;
      overflow: hidden;
      font-family: 'Poppins', sans-serif;
    `;

    // Header with type-based color
    const typeColors = {
      info: "#2196F3",
      success: "#4CAF50",
      warning: "#FF9800",
      error: "#F44336",
      question: "#9C27B0",
    };

    const header = document.createElement("div");
    header.style.cssText = `
      background: ${typeColors[type] || typeColors.info};
      color: white;
      padding: 1.5rem;
      text-align: center;
    `;

    const titleEl = document.createElement("h3");
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0;
      font-size: 1.4rem;
      font-weight: 600;
    `;

    header.appendChild(titleEl);
    popup.appendChild(header);

    // Message
    const messageEl = document.createElement("div");
    messageEl.style.cssText = `
      padding: 2rem;
      color: #333;
      line-height: 1.6;
      text-align: center;
      font-size: 1rem;
    `;
    const messageText = document.createElement("p");
    messageText.style.margin = "0";
    messageText.textContent = toSafeString(message, "");
    messageEl.appendChild(messageText);

    let inputEl = null;
    if (showInput) {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.value = toSafeString(inputValue);
      inputEl.placeholder = toSafeString(inputPlaceholder);
      inputEl.autocomplete = "off";
      inputEl.style.cssText = `
        width: 100%;
        margin-top: 1rem;
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 0.72rem 0.8rem;
        font-size: 0.95rem;
        font-family: 'Poppins', sans-serif;
      `;
      messageEl.appendChild(inputEl);
    }
    popup.appendChild(messageEl);

    // Buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 0 2rem 2rem;
      justify-content: ${showCancel ? "space-between" : "center"};
    `;

    let settled = false;
    const closeWithValue = (value, onAction) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      try {
        onAction();
      } catch {}
      resolve(value);
    };

    // Cancel button
    if (showCancel) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = cancelText;
      cancelBtn.style.cssText = `
        flex: 1;
        padding: 12px 24px;
        background: #f5f5f5;
        color: #666;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: 'Poppins', sans-serif;
      `;

      cancelBtn.addEventListener("mouseenter", () => {
        cancelBtn.style.background = "#e0e0e0";
      });

      cancelBtn.addEventListener("mouseleave", () => {
        cancelBtn.style.background = "#f5f5f5";
      });

      cancelBtn.addEventListener("click", () => {
        closeWithValue(false, onCancel);
      });

      buttonsContainer.appendChild(cancelBtn);
    }

    // Confirm button
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      flex: 1;
      padding: 12px 24px;
      background: ${typeColors[type] || typeColors.info};
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: 'Poppins', sans-serif;
    `;

    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.opacity = "0.9";
      confirmBtn.style.transform = "translateY(-2px)";
    });

    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.opacity = "1";
      confirmBtn.style.transform = "translateY(0)";
    });

    confirmBtn.addEventListener("click", () => {
      const value = showInput ? toSafeString(inputEl?.value).trim() : true;
      closeWithValue(value, onConfirm);
    });

    buttonsContainer.appendChild(confirmBtn);
    popup.appendChild(buttonsContainer);
    overlay.appendChild(popup);
    const mountRoot = document.body || document.documentElement;
    if (!mountRoot) {
      resolve(false);
      return;
    }
    mountRoot.appendChild(overlay);

    // Add animations
    if (!document.querySelector("#popup-animations")) {
      const style = document.createElement("style");
      style.id = "popup-animations";
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        #custom-popup-overlay button:active {
          transform: scale(0.98);
        }

        @media (max-width: 480px) {
          #custom-popup-overlay > div {
            width: 90%;
            min-width: auto;
            margin: 20px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Close on overlay click (outside popup)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        if (showCancel) {
          closeWithValue(false, onCancel);
        }
      }
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && showCancel) {
        event.preventDefault();
        closeWithValue(false, onCancel);
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const value = showInput ? toSafeString(inputEl?.value).trim() : true;
        closeWithValue(value, onConfirm);
      }
    });

    if (showInput && inputEl) {
      setTimeout(() => {
        try {
          inputEl.focus({ preventScroll: true });
          inputEl.select();
        } catch {}
      }, 40);
    } else {
      setTimeout(() => {
        try {
          confirmBtn.focus({ preventScroll: true });
        } catch {}
      }, 40);
    }
  });
}

/* ================== ENHANCED UTILITY FUNCTIONS ================== */

/**
 * ULTRA-OPTIMIZED IMAGE COMPRESSION WITH POPUP NOTIFICATIONS
 * Features:
 * - WebP-first compression (25-35% smaller than JPEG)
 * - User-friendly popup errors and progress
 * - Smart quality adjustment for food images
 * - Performance-optimized processing
 * - Fallback to JPEG for old browsers
 */

// ================== IMAGE COMPRESSION ==================

async function compressImage(file, maxSizeKB = 300) {
  return new Promise((resolve, reject) => {
    // 1. VALIDATION WITH USER-FRIENDLY ERRORS
    if (!file.type.startsWith("image/")) {
      showNotification(
        "Please select an image file (JPEG, PNG, WebP, etc.).",
        "error"
      );
      reject(new Error("File is not an image"));
      return;
    }

    // Check for unsupported formats
    const unsupportedFormats = [
      "image/heic",
      "image/heif",
      "image/raw",
      "image/tiff",
    ];
    if (unsupportedFormats.includes(file.type.toLowerCase())) {
      showNotification(
        "Please convert HEIC/TIFF/RAW images to JPEG or PNG first.",
        "error"
      );
      reject(new Error("Unsupported image format"));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      // Increased to 10MB for food photography
      showNotification("Image is too large. Maximum size is 10MB.", "error");
      reject(new Error("Image must be less than 10MB"));
      return;
    }

    // Show compression started notification
    showNotification("Optimizing image...", "info");

    const reader = new FileReader();

    reader.onload = function (event) {
      const img = new Image();

      img.onload = function () {
        // Use requestAnimationFrame for smoother UI
        requestAnimationFrame(() => {
          try {
            // 2. SMART DIMENSION CALCULATION FOR FOOD IMAGES
            const canvas = document.createElement("canvas");
            const maxDimension = 1200; // Higher for food detail

            // Preserve aspect ratio with food-optimized sizing
            let width = img.width;
            let height = img.height;
            const aspectRatio = width / height;

            if (width > height && width > maxDimension) {
              width = maxDimension;
              height = Math.round(maxDimension / aspectRatio);
            } else if (height > maxDimension) {
              height = maxDimension;
              width = Math.round(maxDimension * aspectRatio);
            }

            // Ensure minimum size for food detail
            if (width < 500) width = 500;
            if (height < 500) height = 500;

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { alpha: false }); // Disable alpha for speed

            // Optimized drawing settings
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium"; // Balance of quality and speed
            ctx.drawImage(img, 0, 0, width, height);

            // 3. WEBP-OPTIMIZED COMPRESSION WITH SMART QUALITY ADJUSTMENT
            showNotification(
              "Adjusting quality for optimal file size...",
              "info"
            );

            const compressionResult = optimizeImage(canvas, maxSizeKB);

            // 4. SUCCESS NOTIFICATION WITH DETAILED STATS
            const originalKB = (file.size / 1024).toFixed(1);
            const compressedKB = (compressionResult.data.length / 1024).toFixed(
              1
            );
            const savings = (
              (1 - compressionResult.data.length / file.size) *
              100
            ).toFixed(1);

            let successMessage;
            if (savings > 75) {
              successMessage = `Excellent compression: ${originalKB}KB -> ${compressedKB}KB (${savings}% saved)`;
            } else if (savings > 50) {
              successMessage = `Great optimization: ${originalKB}KB -> ${compressedKB}KB`;
            } else if (savings > 20) {
              successMessage = `Image optimized to ${compressedKB}KB`;
            } else {
              successMessage = `Image ready at ${compressedKB}KB (high quality preserved)`;
            }

            // Add format info
            successMessage += ` | ${compressionResult.format.toUpperCase()}`;

            showNotification(successMessage, "success");

            // 5. RETURN COMPRESSED DATA
            const result = {
              data: compressionResult.data,
              format: compressionResult.format,
              size: compressionResult.data.length,
              dimensions: { width, height },
              originalSize: file.size,
              qualityUsed: compressionResult.quality,
            };

            debugLog(
              `Food image compressed: ${originalKB}KB -> ${compressedKB}KB (${savings}% saved) ` +
                `as ${compressionResult.format.toUpperCase()} at ${(
                  compressionResult.quality * 100
                ).toFixed(0)}% quality`
            );

            resolve(result);
          } catch (error) {
            // 6. PROCESSING ERROR WITH HELPFUL GUIDANCE
            showNotification(
              "Failed to process image. Try a different format or smaller size.",
              "error"
            );
            console.error("Image processing failed:", error);
            reject(new Error(`Image processing failed: ${error.message}`));
          }
        });
      };

      img.onerror = () => {
        showNotification(
          "Could not load image. The file may be corrupted.",
          "error"
        );
        reject(new Error("Failed to load image"));
      };

      img.src = event.target.result;
    };

    reader.onerror = () => {
      showNotification(
        "Error reading file. Please try selecting the image again.",
        "error"
      );
      reject(new Error("Failed to read file"));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Optimize image to target size with WebP priority
 */
function optimizeImage(canvas, maxSizeKB) {
  const TARGET_SIZE = maxSizeKB * 1024;
  let quality = 0.85; // Start high for food quality
  let base64;
  let format = "webp";

  try {
    // Primary: Try WebP (95% of users)
    base64 = canvas.toDataURL("image/webp", quality);

    // Smart size optimization (fewer iterations = faster)
    if (base64.length > TARGET_SIZE) {
      // Calculate needed reduction
      const oversizeRatio = base64.length / TARGET_SIZE;

      if (oversizeRatio > 2) {
        // Very oversized - bigger quality drop
        quality = 0.7;
        base64 = canvas.toDataURL("image/webp", quality);
      } else if (oversizeRatio > 1.3) {
        // Moderately oversized
        quality = 0.78;
        base64 = canvas.toDataURL("image/webp", quality);
      }

      // One final check
      if (base64.length > TARGET_SIZE * 1.1 && quality > 0.65) {
        quality = 0.65;
        base64 = canvas.toDataURL("image/webp", quality);
      }
    }

    // If still too large after optimization
    if (base64.length > TARGET_SIZE * 1.2) {
      debugWarn("Food image remains large - prioritizing quality over size");
    }
  } catch (error) {
    // Secondary: WebP failed, use JPEG fallback (5% of users)
    showNotification(
      "Using standard format for maximum compatibility.",
      "info"
    );
    quality = 0.82;
    base64 = canvas.toDataURL("image/jpeg", quality);
    format = "jpeg";

    // JPEG size adjustment
    if (base64.length > TARGET_SIZE && quality > 0.7) {
      quality = 0.75;
      base64 = canvas.toDataURL("image/jpeg", quality);
    }
  }

  return { data: base64, format, quality };
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/webp";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 50);
}

function buildStoragePath(itemType, originalName, format) {
  const safeName = slugify(originalName || itemType || "image");
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}-${safeName}.${format}`;
}

async function prepareImageForUpload(file, itemType) {
  const maxSizeKB = STORAGE_LIMITS_KB[itemType] || 2000;
  const compressed = await compressImage(file, maxSizeKB);
  const blob = dataUrlToBlob(compressed.data);
  return {
    blob,
    format: compressed.format,
    width: compressed.dimensions?.width,
    height: compressed.dimensions?.height,
    size: blob.size,
  };
}

async function uploadToStorage(bucket, path, blob) {
  const session = await ensureValidSession();
  if (!session?.access_token) {
    throw new Error("Authentication required to upload");
  }

  const response = await fetch(
    `${SUPABASE_CONFIG.URL}/storage/v1/object/${bucket}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_CONFIG.ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": blob.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: blob,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Upload failed");
  }

  return `${SUPABASE_CONFIG.URL}/storage/v1/object/public/${bucket}/${path}`;
}

function extractStoragePath(url, bucket) {
  if (!url || !bucket) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return url.substring(index + marker.length);
}

async function deleteFromStorage(bucket, path) {
  if (!bucket || !path) return;
  const session = await ensureValidSession();
  if (!session?.access_token) return;

  await fetch(`${SUPABASE_CONFIG.URL}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_CONFIG.ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}

function parseTags(rawTags) {
  if (!rawTags) return [];
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function getNextDisplayOrder(endpoint) {
  const result = await secureRequest(
    `${endpoint}?select=display_order&order=display_order.desc&limit=1`,
    "GET",
    null,
    { authRequired: true }
  );

  const maxValue =
    Array.isArray(result) && result[0] && result[0].display_order !== null
      ? Number(result[0].display_order)
      : -1;

  return Number.isFinite(maxValue) ? maxValue + 1 : 0;
}

async function prefillNextDisplayOrder(itemType, fieldId) {
  if (!DISPLAY_ORDER_MANAGED_TYPES.has(itemType)) return;
  const input = document.getElementById(fieldId);
  if (!input) return;

  const current = toSafeString(input.value).trim();
  if (current !== "") return;

  const endpoint = getEndpointForType(itemType);
  if (!endpoint) return;

  input.placeholder = "Auto";
  input.setAttribute("data-auto-order-loading", "true");
  try {
    const nextValue = await getNextDisplayOrder(endpoint);
    if (toSafeString(input.value).trim() === "") {
      input.value = String(Math.max(0, Number(nextValue) || 0));
    }
  } catch (error) {
    debugWarn(`Failed to prefill display order for ${itemType}:`, error);
  } finally {
    input.removeAttribute("data-auto-order-loading");
  }
}

async function processImageUpload(itemType, imageFile, existingUrl) {
  const bucket = STORAGE_BUCKETS[itemType];
  if (!bucket) {
    throw new Error("Invalid storage bucket");
  }

  if (!imageFile && existingUrl) {
    return {
      url: existingUrl,
      meta: null,
      bucket,
      uploadedPath: null,
      previousPath: null,
    };
  }

  if (!imageFile) {
    throw new Error("Please select an image");
  }

  const prepared = await prepareImageForUpload(imageFile, itemType);
  const path = buildStoragePath(itemType, imageFile.name, prepared.format);
  const url = await uploadToStorage(bucket, path, prepared.blob);
  const previousPath = extractStoragePath(existingUrl, bucket);

  return {
    url,
    bucket,
    uploadedPath: path,
    previousPath: previousPath || null,
    meta: {
      width: prepared.width,
      height: prepared.height,
      size: prepared.size,
    },
  };
}

async function rollbackUploadedImage(uploadResult) {
  if (!uploadResult || !uploadResult.bucket || !uploadResult.uploadedPath) {
    return;
  }

  try {
    await deleteFromStorage(uploadResult.bucket, uploadResult.uploadedPath);
  } catch (error) {
    console.error("Failed to rollback uploaded image:", error);
  }
}

async function finalizeImageReplacement(uploadResult) {
  if (
    !uploadResult ||
    !uploadResult.bucket ||
    !uploadResult.previousPath ||
    !uploadResult.uploadedPath
  ) {
    return;
  }

  if (uploadResult.previousPath === uploadResult.uploadedPath) {
    return;
  }

  try {
    await deleteFromStorage(uploadResult.bucket, uploadResult.previousPath);
  } catch (error) {
    console.error("Failed to delete previous image:", error);
  }
}

function ensureToastUi() {
  if (!document.getElementById("tb-toast-style")) {
    const style = document.createElement("style");
    style.id = "tb-toast-style";
    style.textContent = `
      .tb-toast-wrap {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 14500;
        display: grid;
        gap: 0.55rem;
        width: min(360px, calc(100vw - 1.5rem));
        pointer-events: none;
      }
      .tb-toast {
        --tb-toast-accent: #2fa66a;
        pointer-events: auto;
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.62rem;
        padding: 0.72rem 0.8rem;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--tb-toast-accent) 28%, transparent);
        background: color-mix(in srgb, var(--surface, #faf7f5) 94%, #fff);
        color: var(--text, #222);
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.16);
        transform: translate3d(0, -8px, 0);
        opacity: 0;
        transition: transform 180ms ease, opacity 180ms ease;
      }
      [data-theme="dark"] .tb-toast {
        background: color-mix(in srgb, var(--surface, #2d2d2d) 90%, #121212);
      }
      .tb-toast.is-visible {
        transform: translate3d(0, 0, 0);
        opacity: 1;
      }
      .tb-toast-icon {
        width: 1.35rem;
        height: 1.35rem;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.74rem;
        font-weight: 700;
        color: var(--tb-toast-accent);
        background: color-mix(in srgb, var(--tb-toast-accent) 14%, transparent);
      }
      .tb-toast-body {
        font-size: 0.88rem;
        line-height: 1.35;
      }
      .tb-toast-close {
        border: none;
        width: 1.55rem;
        height: 1.55rem;
        border-radius: 999px;
        background: transparent;
        color: var(--text-light, #666);
        cursor: pointer;
        font-size: 1rem;
      }
      .tb-toast-close:hover {
        background: color-mix(in srgb, var(--tb-toast-accent) 10%, transparent);
        color: var(--text, #222);
      }
      .tb-toast-success { --tb-toast-accent: #2fa66a; }
      .tb-toast-error { --tb-toast-accent: #d84343; }
      .tb-toast-info { --tb-toast-accent: #2f7ae0; }
      .tb-toast-warning { --tb-toast-accent: #e58a13; }
      @media (max-width: 640px) {
        .tb-toast-wrap {
          top: 0.82rem;
          left: 0.75rem;
          right: 0.75rem;
          width: auto;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tb-toast {
          transition: none;
          transform: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  let wrap = document.getElementById("tb-toast-wrap");
  if (!wrap) {
    const mountRoot = document.body || document.documentElement;
    if (!mountRoot) return null;
    wrap = document.createElement("div");
    wrap.id = "tb-toast-wrap";
    wrap.className = "tb-toast-wrap";
    wrap.setAttribute("aria-live", "polite");
    wrap.setAttribute("aria-atomic", "false");
    mountRoot.appendChild(wrap);
  }
  return wrap;
}

function showAdminPopup(message, type = "success") {
  const wrap = ensureToastUi();
  if (!wrap) return;
  const normalizedType = ["success", "error", "info", "warning"].includes(type)
    ? type
    : "info";
  const safeMessage = toSafeString(message, "Action completed.");
  const dedupeKey = `${normalizedType}|${safeMessage}`;
  const now = Date.now();
  const lastShown = adminToastLastShownAt.get(dedupeKey) || 0;
  if (now - lastShown < ADMIN_TOAST_DEDUP_WINDOW_MS) return;
  adminToastLastShownAt.set(dedupeKey, now);

  const iconMap = {
    success: "ok",
    error: "!",
    info: "i",
    warning: "!",
  };

  const toast = document.createElement("article");
  toast.className = `tb-toast tb-toast-${normalizedType}`;
  toast.setAttribute("role", normalizedType === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "tb-toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconMap[normalizedType];

  const body = document.createElement("div");
  body.className = "tb-toast-body";
  body.textContent = safeMessage;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tb-toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "x";

  toast.appendChild(icon);
  toast.appendChild(body);
  toast.appendChild(closeBtn);
  wrap.appendChild(toast);

  const dismiss = () => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 200);
  };

  closeBtn.addEventListener("click", dismiss, { once: true });
  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  const timeoutByType = {
    success: 2600,
    info: 3200,
    warning: 3600,
    error: 5000,
  };
  setTimeout(dismiss, timeoutByType[normalizedType] || 3200);
}

function showNotification(message, type = "success") {
  showAdminPopup(message, type);
}

/* ================== SECURE API FUNCTIONS ================== */

const SESSION_SKEW_SECONDS = 60;

function getStoredSession() {
  return secureStorage.getItem("session");
}

function storeSession(session) {
  secureStorage.setItem("session", session);
}

function clearSession() {
  secureStorage.removeItem("session");
}

async function refreshSessionIfNeeded(session) {
  if (!session || !session.refresh_token) return session;

  const now = Math.floor(Date.now() / 1000);
  if (
    session.expires_at &&
    session.expires_at - now > SESSION_SKEW_SECONDS
  ) {
    return session;
  }

  try {
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_CONFIG.ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      }
    );

    if (!response.ok) {
      return session;
    }

    const refreshed = await response.json();
    const refreshedSession = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || session.refresh_token,
      expires_at:
        refreshed.expires_at ||
        Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600),
      user: refreshed.user || session.user,
      email: (refreshed.user && refreshed.user.email) || session.email,
    };

    storeSession(refreshedSession);
    return refreshedSession;
  } catch (error) {
    debugWarn("Session refresh failed:", error);
    return session;
  }
}

async function ensureValidSession() {
  const session = getStoredSession();
  if (!isSessionTokenUsable(session)) {
    clearSession();
    return null;
  }

  const refreshed = await refreshSessionIfNeeded(session);
  if (!isSessionTokenUsable(refreshed)) {
    clearSession();
    return null;
  }

  return refreshed;
}

async function secureRequest(
  endpoint,
  method = "GET",
  data = null,
  options = {}
) {
  const normalizedMethod = toSafeString(method, "GET").toUpperCase();
  const {
    retries = 3,
    timeout = normalizedMethod === "GET" ? 22000 : 15000,
    authRequired = false,
    headers: extraHeaders = {},
    suppressNotifications = false,
  } = options;
  const requestTimeout =
    Number.isFinite(Number(timeout)) && Number(timeout) > 0
      ? Number(timeout)
      : normalizedMethod === "GET"
        ? 22000
        : 15000;

  if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
    throw new Error("Supabase configuration missing. Check config.js");
  }

  const safeEndpoint = toSafeString(endpoint).replace(/\u0000/g, "");
  if (!safeEndpoint.startsWith("/")) {
    throw new Error("Invalid API endpoint");
  }

  const session = await ensureValidSession();
  if (authRequired && !session?.access_token) {
    throw new Error("Authentication required");
  }

  const baseHeaders = {
    apikey: SUPABASE_CONFIG.ANON_KEY,
    Authorization: `Bearer ${
      session?.access_token || SUPABASE_CONFIG.ANON_KEY
    }`,
    Prefer: "return=representation",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    ...extraHeaders,
  };

  if (
    data &&
    (normalizedMethod === "POST" ||
      normalizedMethod === "PATCH" ||
      normalizedMethod === "PUT")
  ) {
    baseHeaders["Content-Type"] = "application/json";
  }

  const isRetryableStatus = (status) => {
    const code = Number(status) || 0;
    return (
      code === 408 ||
      code === 425 ||
      code === 429 ||
      code === 502 ||
      code === 503 ||
      code === 504 ||
      code >= 500
    );
  };

  const isTransientNetworkError = (error) => {
    const message = toSafeString(error?.message).toLowerCase();
    return (
      error?.name === "AbortError" ||
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed") ||
      message.includes("load failed") ||
      message.includes("timeout")
    );
  };

  const getRetryDelayMs = (attempt, retryAfterSeconds = 0) => {
    if (retryAfterSeconds > 0) {
      return Math.min(10000, Math.max(300, retryAfterSeconds * 1000));
    }
    return Math.min(
      10000,
      Math.pow(2, attempt) * 700 + Math.floor(Math.random() * 250)
    );
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), requestTimeout)
      : null;

    const config = {
      method: normalizedMethod,
      headers: baseHeaders,
      signal: controller ? controller.signal : undefined,
      cache: "no-store",
    };

    if (
      data &&
      (normalizedMethod === "POST" ||
        normalizedMethod === "PATCH" ||
        normalizedMethod === "PUT")
    ) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${SUPABASE_CONFIG.URL}${safeEndpoint}`, config);
      if (timeoutId) clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") || 1) || 1;
        if (attempt < retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, getRetryDelayMs(attempt, retryAfter))
          );
          continue;
        }
      }

      if (!response.ok) {
        const errorData = await response.text();
        recordAdminError("fetch", `HTTP ${response.status} ${safeEndpoint}`, {
          method: normalizedMethod,
          status: response.status,
        });

        if (response.status === 401) {
          if (!suppressNotifications) {
            showNotification(
              "Authentication failed. Please login again.",
              "error"
            );
          }
          logoutAdmin();
          const authError = new Error("Authentication failed");
          authError.status = response.status;
          throw authError;
        }

        if (response.status === 403) {
          if (!suppressNotifications) {
            showNotification(
              "Permission denied. Please contact administrator.",
              "error"
            );
          }
          const permissionError = new Error("Permission denied");
          permissionError.status = response.status;
          throw permissionError;
        }

        if (response.status === 413) {
          if (!suppressNotifications) {
            showNotification(
              "Image file is too large. Please use a smaller image.",
              "error"
            );
          }
          const sizeError = new Error("File too large");
          sizeError.status = response.status;
          throw sizeError;
        }

        const httpError = new Error(
          `HTTP ${response.status}: ${errorData.substring(0, 200)}`
        );
        httpError.status = response.status;
        httpError.responseBody = errorData;

        if (attempt < retries && isRetryableStatus(response.status)) {
          await new Promise((resolve) =>
            setTimeout(resolve, getRetryDelayMs(attempt))
          );
          continue;
        }
        throw httpError;
      }

      if (normalizedMethod === "DELETE" && response.status === 204) {
        return { success: true, message: "Item deleted successfully" };
      }

      if (response.status !== 204) {
        const result = await response.json();

        if (Array.isArray(result)) {
          result.forEach((item) => {
            const img = resolveRecordImage(item);
            if (img && item.id && tempImageCache.size < 50) {
              cacheTempImageForItem(item.id, img);
            }
          });
        } else {
          const img = resolveRecordImage(result);
          if (img && result.id && tempImageCache.size < 50) {
            cacheTempImageForItem(result.id, img);
          }
        }

        return result;
      }

      return { success: true };
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      const statusCode = Number(error?.status) || 0;
      const canRetry =
        attempt < retries &&
        (isRetryableStatus(statusCode) || isTransientNetworkError(error));

      if (canRetry) {
        await new Promise((resolve) =>
          setTimeout(resolve, getRetryDelayMs(attempt))
        );
        continue;
      }

      if (!suppressNotifications) {
        console.error("API request failed after retries:", error);
      } else {
        debugWarn("API request failed after retries:", safeEndpoint, error?.message);
      }
      recordAdminError("fetch", `Request failed: ${safeEndpoint}`, {
        method: normalizedMethod,
        status: statusCode || undefined,
        message: error?.message || "Unknown error",
      });

      if (!suppressNotifications) {
        if (error?.name === "AbortError") {
          showNotification(
            "Request timed out while contacting the server. Please try again.",
            "error"
          );
        } else if (
          toSafeString(error?.message).toLowerCase().includes("failed to fetch")
        ) {
          showNotification(
            "Network error. Please check your connection.",
            "error"
          );
        } else if (
          toSafeString(error?.message).toLowerCase().includes("cors")
        ) {
          showNotification(
            "Cross-origin request blocked. Please check configuration.",
            "error"
          );
        } else {
          showNotification(`Operation failed: ${error.message}`, "error");
        }
      }

      throw error;
    }
  }
}

// Load data with caching
const dataCache = new Map();
const CACHE_TTL = 60000; // 1 minute
const ORDERING_MAP = {
  [API_ENDPOINTS.FEATURED]: "display_order.asc,created_at.desc",
  [API_ENDPOINTS.MENU]: "display_order.asc,created_at.desc",
  [SPECIALS_ENDPOINT]: "display_order.asc,created_at.desc",
  [API_ENDPOINTS.CAROUSEL]: "display_order.asc,created_at.desc",
  [API_ENDPOINTS.THEMES]: "is_active.desc,updated_at.desc,created_at.desc",
};

async function loadDataFromSupabase(endpoint, id = null, forceRefresh = false) {
  const cacheKey = id ? `${endpoint}_${id}` : endpoint;

  // Check cache if not forcing refresh
  if (!forceRefresh && dataCache.has(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  try {
    const orderBy = ORDERING_MAP[endpoint] || "created_at.desc";
    const url = id
      ? `${endpoint}?id=eq.${id}&select=*`
      : `${endpoint}?select=*&order=${orderBy}`;

    const result = await secureRequest(url, "GET", null, {
      authRequired: true,
      suppressNotifications: true,
      timeout: 24000,
      retries: 4,
    });

    // Handle Supabase response format
    let data;
    if (id) {
      // For single item queries, result is an array
      data = Array.isArray(result) && result.length > 0 ? result[0] : null;
    } else {
      // For list queries, result is the array
      data = result || [];
    }

    // Cache the result
    dataCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  } catch (error) {
    const errorMessage = toSafeString(error?.message);
    const lowerMessage = errorMessage.toLowerCase();
    const isTransientFailure =
      error?.name === "AbortError" ||
      lowerMessage.includes("failed to fetch") ||
      lowerMessage.includes("http 503") ||
      lowerMessage.includes("http 502") ||
      lowerMessage.includes("http 504");

    if (!isTransientFailure) {
      console.error(`Error loading from ${endpoint}:`, error);
    } else {
      debugWarn(`Transient fetch issue on ${endpoint}:`, errorMessage);
    }

    // Return cached data if available (even if stale)
    if (dataCache.has(cacheKey)) {
      debugLog("Using cached data. Some information may be outdated.");
      return dataCache.get(cacheKey).data;
    }

    if (!isTransientFailure) {
      console.error("Failed to load data from cloud");
    }
    return id ? null : [];
  }
}

// Clear cache function
function clearDataCache() {
  dataCache.clear();
  tempImageCache.clear();
  clearAllItemStateCache();
}

function markPublicContentCacheDirty() {
  const ts = Date.now();
  try {
    localStorage.setItem("toke_bakes_content_cache_version", `admin_${ts}`);
    if (window.API_ENDPOINTS?.FEATURED) {
      localStorage.removeItem(`${window.API_ENDPOINTS.FEATURED}_data`);
    }
    if (SPECIALS_ENDPOINT) {
      localStorage.removeItem(`${SPECIALS_ENDPOINT}_data`);
    }
    localStorage.removeItem("toke_bakes_menu_cache_v2");
    localStorage.removeItem("toke_bakes_menu_options_cache_v1");
    localStorage.removeItem("hero_carousel_data");
  } catch {}

  requestAdminDynamicCacheClear();
}

function ensureChatWidgetScriptLoaded() {
  if (window.TBChatWidget && typeof window.TBChatWidget.init === "function") {
    window.TBChatWidget.init();
    return;
  }

  if (window.__TB_CHAT_WIDGET_SCRIPT_REQUESTED__) return;
  window.__TB_CHAT_WIDGET_SCRIPT_REQUESTED__ = true;

  if (document.querySelector("script[data-tb-chat-widget-script='true']")) {
    return;
  }

  const script = document.createElement("script");
  script.src = "scripts/chat-widget.js";
  script.defer = true;
  script.dataset.tbChatWidgetScript = "true";
  script.addEventListener("load", () => {
    try {
      if (window.TBChatWidget && typeof window.TBChatWidget.init === "function") {
        window.TBChatWidget.init();
      }
    } catch {}
  });
  script.addEventListener("error", () => {
    window.__TB_CHAT_WIDGET_SCRIPT_REQUESTED__ = false;
  });
  document.head.appendChild(script);
}

/* ================== FIXED AUTHENTICATION - KEY CHANGES ================== */

// Fixed login attempts storage
let loginAttempts = {
  count: 0,
  timestamp: Date.now(),
  ipKey: "login_attempts",
};

// Enhanced login with rate limiting
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

async function requestAuthSession(email, password) {
  const response = await fetch(
    `${SUPABASE_CONFIG.URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_CONFIG.ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return {
      success: false,
      message: errorText || "Authentication failed",
    };
  }

  const result = await response.json();
  const session = {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at:
      result.expires_at ||
      Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
    user: result.user,
    email: (result.user && result.user.email) || email,
  };

  return { success: true, session };
}

async function checkIsAdmin() {
  const result = await secureRequest(
    "/rest/v1/rpc/is_admin",
    "POST",
    null,
    { authRequired: true }
  );

  if (Array.isArray(result)) {
    return Boolean(result[0]);
  }
  return Boolean(result);
}

async function checkLogin(email, password) {
  try {
    debugLog("Login attempt for:", email);

    const storedAttempts = JSON.parse(
      sessionStorage.getItem("login_attempts") || '{"count":0,"timestamp":0}'
    );

    if (storedAttempts.count >= MAX_LOGIN_ATTEMPTS) {
      const timeSinceFirstAttempt = Date.now() - storedAttempts.timestamp;
      if (timeSinceFirstAttempt < LOCKOUT_TIME) {
        const remainingMinutes = Math.ceil(
          (LOCKOUT_TIME - timeSinceFirstAttempt) / 60000
        );
        showNotification(
          `Too many login attempts. Try again in ${remainingMinutes} minutes.`,
          "error"
        );
        return false;
      } else {
        sessionStorage.removeItem("login_attempts");
      }
    }

    const sanitizedEmail = sanitizeInput(email);
    if (!sanitizedEmail || !sanitizedEmail.includes("@")) {
      showNotification("Please enter a valid admin email.", "error");
      return false;
    }

    const authResult = await requestAuthSession(sanitizedEmail, password);
    if (!authResult.success) {
      storedAttempts.count++;
      storedAttempts.timestamp =
        storedAttempts.count === 1 ? Date.now() : storedAttempts.timestamp;
      sessionStorage.setItem("login_attempts", JSON.stringify(storedAttempts));
      return false;
    }

    if (!isSessionTokenUsable(authResult.session)) {
      clearSession();
      showNotification("Invalid session returned. Please try logging in again.", "error");
      return false;
    }

    storeSession(authResult.session);

    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      clearSession();
      showNotification(
        "Access denied. Your account is not an admin.",
        "error"
      );
      return false;
    }

    sessionStorage.removeItem("login_attempts");
    startSessionTimeout();
    setupActivityMonitoring();
    debugLog("Login successful.");
    return true;
  } catch (error) {
    console.error("Login error:", error);
    return false;
  }
}

// Session timeout functions
function startSessionTimeout() {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
  }

  sessionTimeout = setTimeout(() => {
    showNotification("Session expired. Please log in again.", "warning");
    logoutAdmin();
  }, SESSION_TIMEOUT_MINUTES * 60 * 1000);
}

function clearSessionTimeout() {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
    sessionTimeout = null;
  }
}

function setupActivityMonitoring() {
  if (activityMonitoringAttached) return;

  const resetSessionTimer = () => {
    if (sessionTimeout) {
      clearTimeout(sessionTimeout);
      startSessionTimeout();
    }
  };

  ["click", "keypress", "mousemove", "scroll"].forEach((event) => {
    document.addEventListener(event, resetSessionTimer, { passive: true });
  });

  activityMonitoringAttached = true;
}

async function signOutAdmin() {
  const session = getStoredSession();
  if (!session?.access_token) return;

  try {
    await fetch(`${SUPABASE_CONFIG.URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_CONFIG.ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  } catch (error) {
    debugWarn("Supabase logout failed:", error);
  }
}

// Enhanced logout
function logoutAdmin() {
  debugLog("Logging out admin...");

  // Clear all sensitive data
  currentAdmin = null;
  isEditing = false;
  currentEditId = null;
  clearSessionTimeout();
  clearDataCache();
  resetLoadedTabs();
  signOutAdmin();
  clearSession();

  // Reset UI
  const loginScreen = document.getElementById("login-screen");
  const adminDashboard = document.getElementById("admin-dashboard");

  if (loginScreen) loginScreen.style.display = "block";
  if (adminDashboard) adminDashboard.style.display = "none";

  // Clear forms
  resetFeaturedForm();
  resetMenuForm();
  resetSpecialsForm();
  resetCarouselForm(); // Added
  closeMenuOptionsManager();

  debugLog("Logged out successfully.");
}

// Updated password change for Supabase Auth
async function changePassword(currentPass, newPass, confirmPass) {
  try {
    if (newPass !== confirmPass) {
      return { success: false, message: "New passwords do not match" };
    }

    if (newPass.length < 8) {
      return {
        success: false,
        message: "Password must be at least 8 characters",
      };
    }

    const session = await ensureValidSession();
    const email = session?.email || session?.user?.email;
    if (!email) {
      return { success: false, message: "Please log in again to continue." };
    }

    const verify = await requestAuthSession(email, currentPass);
    if (!verify.success) {
      return { success: false, message: "Current password is incorrect" };
    }

    const response = await fetch(`${SUPABASE_CONFIG.URL}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_CONFIG.ANON_KEY,
        Authorization: `Bearer ${verify.session.access_token}`,
      },
      body: JSON.stringify({ password: newPass }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: errorText || "Failed to update password.",
      };
    }

    const refreshed = await requestAuthSession(email, newPass);
    if (refreshed.success) {
      storeSession(refreshed.session);
    }

    return {
      success: true,
      message: "Password updated successfully.",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Password change error:", error);
    return { success: false, message: "Error changing password" };
  }
}

/* ================== ENHANCED CONTENT MANAGEMENT ================== */

// Common save function with validation - UPDATED WITH CAROUSEL
async function saveItem(itemType, formData, options = {}) {
  try {
    const endpoints = {
      featured: API_ENDPOINTS.FEATURED,
      menu: API_ENDPOINTS.MENU,
      specials: SPECIALS_ENDPOINT,
      carousel: API_ENDPOINTS.CAROUSEL, // Added
    };

    const endpoint = endpoints[itemType];
    if (!endpoint) {
      throw new Error(`Invalid item type: ${itemType}`);
    }

    // Validate required fields - UPDATED WITH CAROUSEL
    const requiredFields = {
      featured: ["title", "description", "image"],
      menu: ["title", "description", "price", "image"],
      specials: ["title", "image", "price"],
      carousel: ["alt", "image"], // Added
    };

    const missingFields = requiredFields[itemType].filter((field) => {
      const value = formData[field];
      return value === undefined || value === null || value === "";
    });
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    const payload = { ...formData };

    // Sanitize text fields
    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === "string") {
        payload[key] = sanitizeInput(payload[key]);
      }
    });

    const editingId = toSafeString(options.itemId || currentEditId).trim();
    const isUpdate = Boolean(editingId);
    const baselineVersion = (await fetchServerUpdateSignal()).contentVersion;

    let writeResult = null;
    if (isUpdate) {
      writeResult = await secureRequest(
        `${endpoint}?id=eq.${editingId}`,
        "PATCH",
        payload,
        { authRequired: true, retries: 2, timeout: 15000 }
      );
      debugLog(`${itemType} item updated successfully!`);
    } else {
      // Use a single create attempt to prevent duplicate inserts after network timeouts.
      writeResult = await secureRequest(endpoint, "POST", payload, {
        authRequired: true,
        retries: 1,
        timeout: 20000,
      });
      debugLog(`${itemType} item added successfully!`);
    }

    const savedRecord = Array.isArray(writeResult)
      ? writeResult[0] || null
      : writeResult && typeof writeResult === "object"
      ? writeResult
      : null;

    const contentVersion = await ensureContentVersionAfterWrite(
      baselineVersion,
      itemType
    );

    // Clear cache for this endpoint
    dataCache.forEach((value, key) => {
      if (key.startsWith(endpoint)) {
        dataCache.delete(key);
      }
    });
    markPublicContentCacheDirty();
    return {
      success: true,
      operation: isUpdate ? "update" : "create",
      contentVersion,
      record: savedRecord,
    };
  } catch (error) {
    console.error(`Error saving ${itemType} item:`, error);
    return {
      success: false,
      message: error?.message || `Failed to save ${itemType} item`,
      error,
    };
  }
}

/* ================== SPECIFIC CONTENT MANAGEMENT FUNCTIONS ================== */

// Featured Items Management
async function renderFeaturedItems(forceRefresh = false) {
  const container = document.getElementById("featured-items-list");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(
      API_ENDPOINTS.FEATURED,
      null,
      forceRefresh
    );

    if (!items || items.length === 0) {
      cacheItemsForType("featured", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-star"></i>
          <p>No featured items yet. Add your first item!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map((item) => {
        const imgSrc = resolveImageForDisplay(
          resolveRecordImage(item),
          ADMIN_IMAGE_PLACEHOLDERS.featured
        );
        return `
      <div class="item-card" data-id="${item.id}">
        <img src="${imgSrc}" alt="${item.title}" class="item-card-img" loading="lazy" decoding="async"
             onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.featured}';">
        <div class="item-card-content">
          <h3 class="item-card-title">${item.title}</h3>
          <p class="item-card-desc">${item.description}</p>
          <div class="item-card-actions">
            <button class="btn-edit" onclick="editFeaturedItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteFeaturedItem('${item.id}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `;
      })
      .join("");
    cacheItemsForType("featured", items);
  } catch (error) {
    console.error(`Error rendering featured items:`, error);
    cacheItemsForType("featured", []);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load featured items. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveFeaturedItem(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById("featured-form");
  const submitBtn =
    e.submitter || form?.querySelector('button[type="submit"], .btn-admin');

  const titleField = document.getElementById("featured-title");
  const descriptionField = document.getElementById("featured-description");
  const menuItemField = document.getElementById("featured-menu-item");
  const displayOrderField = document.getElementById("featured-display-order");
  const activeField = document.getElementById("featured-active");
  const startDateField = document.getElementById("featured-start-date");
  const endDateField = document.getElementById("featured-end-date");
  const imageField = document.getElementById("featured-image");
  const idField = document.getElementById("featured-id");

  clearFormFieldErrors(form);

  const title = toSafeString(titleField?.value).trim();
  const description = toSafeString(descriptionField?.value).trim();
  const menuItemIdRaw = toSafeString(menuItemField?.value).trim();
  const displayOrderInput = toSafeString(displayOrderField?.value).trim();
  const isActive = activeField?.value === "true";
  const startDate = toSafeString(startDateField?.value).trim();
  const endDate = toSafeString(endDateField?.value).trim();
  const imageFile = imageField?.files?.[0] || null;
  const itemId = toSafeString(idField?.value).trim();
  const isUpdate = Boolean(itemId);
  const existingUrl = isUpdate
    ? getExistingImageUrlForItem("featured", itemId)
    : "";

  if (!title || title.length > 100) {
    setFieldError(titleField, "Title must be 1-100 characters.");
    showNotification("Title must be 1-100 characters", "error");
    return;
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    setFieldError(endDateField, "End date must be after start date.");
    showNotification("End date must be after start date", "error");
    return;
  }

  if (!imageFile && !existingUrl) {
    setFieldError(imageField, "Please choose an image file.");
    showNotification("Please choose an image file", "error");
    return;
  }

  const actionResult = await runAdminAction({
    actionKey: isUpdate ? `featured-update-${itemId}` : "featured-create",
    controls: [submitBtn],
    progressTitle: isUpdate ? "Updating featured item" : "Creating featured item",
    progressText: "Preparing featured data...",
    task: async (progress) => {
      let displayOrder;
      if (displayOrderInput === "" && !isUpdate) {
        displayOrder = await getNextDisplayOrder(API_ENDPOINTS.FEATURED);
      } else {
        displayOrder = parseInt(displayOrderInput || "0", 10);
      }

      if (!Number.isFinite(displayOrder) || displayOrder < 0) {
        setFieldError(displayOrderField, "Display order must be 0 or higher.");
        throw new Error("Display order must be 0 or higher");
      }

      const upload = await processImageUpload("featured", imageFile, existingUrl);

      const formData = {
        title,
        description,
        image: upload.url,
        menu_item_id: menuItemIdRaw || null,
        display_order: displayOrder,
        is_active: isActive,
        start_date: startDate || null,
        end_date: endDate || null,
      };

      const result = await saveItem("featured", formData, { itemId });

      if (!result.success) {
        await rollbackUploadedImage(upload);
        throw new Error(result.message || "Failed to save featured item");
      }

      const recordCandidate =
        result.record && typeof result.record === "object" ? result.record : null;
      const savedRecord = {
        ...(recordCandidate || {}),
        ...formData,
        id: recordCandidate?.id || itemId || null,
      };
      const savedId = toSafeString(savedRecord.id).trim();
      const normalization = await normalizeDisplayOrderConflicts(
        "featured",
        savedId,
        displayOrder
      );

      await finalizeImageReplacement(upload);
      resetFeaturedForm();
      await withPreservedScroll(() => renderFeaturedItems(true));
      await updateItemCounts();
      progress.complete("Featured item saved");
      if (normalization.normalized) {
        showNotification(
          "Featured item saved and display order normalized successfully.",
          "success"
        );
      } else {
        showNotification("Featured item saved successfully!", "success");
      }
      dataSync.notifyDataChanged(result.operation, "featured", {
        contentVersion: result.contentVersion,
      });
      return result;
    },
  });

  if (!actionResult.ok && !actionResult.skipped) {
    console.error("Error saving featured item:", actionResult.error);
    showNotification(
      actionResult.error?.message || "Failed to save featured item",
      "error"
    );
  }
}

async function editFeaturedItem(id) {
  try {
    const item = await getEditableItem("featured", id);

    if (!item) {
      showNotification("Item not found", "error");
      return;
    }

    await populateFeaturedMenuSelect(item.menu_item_id);

    document.getElementById("featured-id").value = item.id;
    document.getElementById("featured-title").value = item.title;
    document.getElementById("featured-description").value = item.description;
    document.getElementById("featured-menu-item").value =
      item.menu_item_id || "";
    document.getElementById("featured-display-order").value =
      item.display_order ?? 0;
    document.getElementById("featured-active").value = item.is_active
      ? "true"
      : "false";
    document.getElementById("featured-start-date").value =
      item.start_date || "";
    document.getElementById("featured-end-date").value = item.end_date || "";
    const imageField = document.getElementById("featured-image");
    if (imageField) {
      imageField.required = false;
    }
    cacheTempImageForItem(item.id, resolveRecordImage(item));

    const preview = document.getElementById("featured-image-preview");
    preview.innerHTML = `<img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.featured)}" alt="Current image" style="max-height: 150px; border-radius: 8px;" decoding="async"
      onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.featured}';">`;

    document.getElementById("featured-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    document
      .getElementById("featured-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading featured item for edit:", error);
    showNotification("Failed to load item for editing", "error");
  }
}

// Menu Items Management - FIXED: Price removed from visible display
async function renderMenuItems(forceRefresh = false) {
  const container = document.getElementById("menu-items-list");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(
      API_ENDPOINTS.MENU,
      null,
      forceRefresh
    );
    const sortedItems = Array.isArray(items)
      ? items.slice().sort(compareRecordsByDisplayOrder)
      : [];

    if (sortedItems.length === 0) {
      cacheItemsForType("menu", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>No menu items yet. Add your first item!</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    sortedItems.forEach((item) => {
      const card = buildMenuAdminCardElement(item);
      if (card) fragment.appendChild(card);
    });

    if (!fragment.childNodes.length) {
      cacheItemsForType("menu", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>No menu items yet. Add your first item!</p>
        </div>
      `;
      return;
    }

    container.replaceChildren(fragment);
    cacheItemsForType("menu", sortedItems);
  } catch (error) {
    console.error(`Error rendering menu items:`, error);
    cacheItemsForType("menu", []);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load menu items. Please check your connection.</p>
      </div>
    `;
  }
}

async function populateFeaturedMenuSelect(selectedId = null, forceRefresh = false) {
  const select = document.getElementById("featured-menu-item");
  if (!select) return;

  try {
    const items = await loadDataFromSupabase(
      API_ENDPOINTS.MENU,
      null,
      forceRefresh
    );
    const currentValue = selectedId ?? select.value;

    select.innerHTML = `<option value="">None</option>${items
      .map(
        (item) =>
          `<option value="${item.id}">${escapeHtml(item.title)}</option>`
      )
      .join("")}`;

    if (currentValue) {
      select.value = String(currentValue);
    }
  } catch (error) {
    console.error("Failed to populate menu selector:", error);
  }
}

async function saveMenuItem(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById("menu-form");
  const submitBtn =
    e.submitter || form?.querySelector('button[type="submit"], .btn-admin');

  const titleField = document.getElementById("menu-title");
  const descriptionField = document.getElementById("menu-description");
  const priceField = document.getElementById("menu-price");
  const categoryField = document.getElementById("menu-category");
  const tagsField = document.getElementById("menu-tags");
  const availableField = document.getElementById("menu-available");
  const displayOrderField = document.getElementById("menu-display-order");
  const caloriesField = document.getElementById("menu-calories");
  const imageField = document.getElementById("menu-image");
  const idField = document.getElementById("menu-id");

  clearFormFieldErrors(form);

  const title = toSafeString(titleField?.value).trim();
  const description = toSafeString(descriptionField?.value).trim();
  const rawPriceValue = Number(priceField?.value);
  const priceValue = toMoney(rawPriceValue, 0);
  const category = toSafeString(categoryField?.value, "pastries").trim() || "pastries";
  const tagsRaw = toSafeString(tagsField?.value);
  const isAvailable = availableField?.value === "true";
  const displayOrderInput = toSafeString(displayOrderField?.value).trim();
  const caloriesInput = toSafeString(caloriesField?.value).trim();
  const imageFile = imageField?.files?.[0] || null;
  const itemId = toSafeString(idField?.value).trim();
  const isUpdate = Boolean(itemId);
  const existingUrl = isUpdate ? getExistingImageUrlForItem("menu", itemId) : "";

  if (!title || title.length > 100) {
    setFieldError(titleField, "Title must be 1-100 characters.");
    showNotification("Title must be 1-100 characters", "error");
    return;
  }

  if (category.length > 50) {
    setFieldError(categoryField, "Category must be 50 characters or fewer.");
    showNotification("Category must be 50 characters or fewer", "error");
    return;
  }

  if (!Number.isFinite(rawPriceValue) || rawPriceValue < 0) {
    setFieldError(priceField, "Price must be 0 or higher.");
    showNotification("Price must be 0 or higher", "error");
    return;
  }

  if (!imageFile && !existingUrl) {
    setFieldError(imageField, "Please choose an image file.");
    showNotification("Please choose an image file", "error");
    return;
  }

  const actionResult = await runAdminAction({
    actionKey: isUpdate ? `menu-update-${itemId}` : "menu-create",
    controls: [submitBtn],
    progressTitle: isUpdate ? "Updating menu item" : "Creating menu item",
    progressText: "Preparing menu data...",
    task: async (progress) => {
      let displayOrder;
      if (displayOrderInput === "" && !isUpdate) {
        displayOrder = await getNextDisplayOrder(API_ENDPOINTS.MENU);
      } else {
        displayOrder = parseInt(displayOrderInput || "0", 10);
      }

      if (!Number.isFinite(displayOrder) || displayOrder < 0) {
        setFieldError(displayOrderField, "Display order must be 0 or higher.");
        throw new Error("Display order must be 0 or higher");
      }

      const calories = caloriesInput === "" ? null : parseInt(caloriesInput, 10);
      if (calories !== null && (!Number.isFinite(calories) || calories < 0)) {
        setFieldError(caloriesField, "Calories must be a positive number.");
        throw new Error("Calories must be a positive number");
      }

      const upload = await processImageUpload("menu", imageFile, existingUrl);

      const formData = {
        title,
        description,
        price: toMoney(priceValue, 0),
        image: upload.url,
        category,
        tags: parseTags(tagsRaw),
        is_available: isAvailable,
        display_order: displayOrder,
        calories,
      };

      const result = await saveItem("menu", formData, { itemId });

      if (!result.success) {
        await rollbackUploadedImage(upload);
        throw new Error(result.message || "Failed to save menu item");
      }

      const recordCandidate =
        result.record && typeof result.record === "object" ? result.record : null;
      const savedRecord = {
        ...(recordCandidate || {}),
        ...formData,
        id: recordCandidate?.id || itemId || null,
      };
      const savedId = toSafeString(savedRecord.id).trim();
      const normalization = await normalizeDisplayOrderConflicts(
        "menu",
        savedId,
        displayOrder
      );

      await finalizeImageReplacement(upload);
      resetMenuForm();
      const updatedInPlace = savedId ? upsertItemCardInUi("menu", savedRecord) : false;
      if (normalization.normalized || !updatedInPlace) {
        await withPreservedScroll(() => renderMenuItems(true));
      }
      await Promise.all([populateFeaturedMenuSelect(null, true), updateItemCounts()]);
      progress.complete("Menu item saved");
      if (normalization.normalized) {
        showNotification(
          "Menu item saved and display order normalized successfully.",
          "success"
        );
      } else {
        showNotification("Menu item saved successfully!", "success");
      }
      dataSync.notifyDataChanged(result.operation, "menu", {
        contentVersion: result.contentVersion,
      });
      return result;
    },
  });

  if (!actionResult.ok && !actionResult.skipped) {
    console.error("Error saving menu item:", actionResult.error);
    showNotification(
      actionResult.error?.message || "Failed to save menu item",
      "error"
    );
  }
}

async function editMenuItem(id) {
  try {
    const item = await getEditableItem("menu", id);

    if (!item) {
      showNotification("Menu item not found", "error");
      return;
    }

    document.getElementById("menu-id").value = item.id;
    document.getElementById("menu-title").value = item.title;
    document.getElementById("menu-description").value = item.description;
    document.getElementById("menu-price").value = item.price;
    document.getElementById("menu-category").value =
      item.category || "pastries";
    document.getElementById("menu-tags").value = Array.isArray(item.tags)
      ? item.tags.join(", ")
      : "";
    document.getElementById("menu-available").value = item.is_available
      ? "true"
      : "false";
    document.getElementById("menu-display-order").value =
      item.display_order ?? 0;
    document.getElementById("menu-calories").value =
      item.calories !== null && item.calories !== undefined
        ? item.calories
        : "";
    const imageField = document.getElementById("menu-image");
    if (imageField) {
      imageField.required = false;
    }
    cacheTempImageForItem(item.id, resolveRecordImage(item));

    const preview = document.getElementById("menu-image-preview");
    preview.innerHTML = `<img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.menu)}" alt="Current image" style="max-height: 150px; border-radius: 8px;" decoding="async"
      onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.menu}';">`;

    document.getElementById("menu-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    document
      .getElementById("menu-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading menu item for edit:", error);
    showNotification("Failed to load menu item for editing", "error");
  }
}

function getMenuOptionManagerElements() {
  return {
    modal: document.getElementById("menu-options-modal"),
    panel: document.querySelector(".menu-options-panel"),
    productLabel: document.getElementById("menu-options-product-label"),
    groupForm: document.getElementById("option-group-form"),
    groupId: document.getElementById("option-group-id"),
    groupName: document.getElementById("option-group-name"),
    groupType: document.getElementById("option-group-type"),
    groupRequired: document.getElementById("option-group-required"),
    groupMax: document.getElementById("option-group-max"),
    valuesEditor: document.getElementById("option-values-editor"),
    addValueRowBtn: document.getElementById("add-option-value-row"),
    resetGroupBtn: document.getElementById("reset-option-group"),
    saveGroupBtn: document.getElementById("save-option-group"),
    groupsStatus: document.getElementById("option-groups-status"),
    groupsList: document.getElementById("option-groups-list"),
  };
}

function buildOptionValueRow(value = {}) {
  const valueId = escapeHtml(String(value.id || ""));
  const valueName = escapeHtml(toSafeString(value.name));
  const priceAdjustment = toMoney(value.price_adjustment || 0, 0);
  return `
    <div class="option-value-row" data-value-id="${valueId}">
      <input
        type="text"
        class="option-value-name"
        placeholder="e.g., Chocolate"
        value="${valueName}"
        required
      />
      <input
        type="number"
        class="option-value-price"
        step="0.01"
        placeholder="0"
        value="${priceAdjustment}"
      />
      <button type="button" class="btn btn-danger remove-option-value-row" aria-label="Remove value">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `;
}

function syncOptionGroupTypeUi() {
  const els = getMenuOptionManagerElements();
  if (!els.groupType || !els.groupMax) return;
  const isSingle = els.groupType.value === "single";
  if (isSingle) {
    els.groupMax.value = "";
    els.groupMax.disabled = true;
    return;
  }
  els.groupMax.disabled = false;
}

function resetOptionGroupForm() {
  const els = getMenuOptionManagerElements();
  if (!els.groupForm) return;

  els.groupForm.reset();
  if (els.groupId) els.groupId.value = "";
  if (els.groupType) els.groupType.value = "single";
  if (els.groupRequired) els.groupRequired.value = "false";
  if (els.groupMax) els.groupMax.value = "";
  syncOptionGroupTypeUi();

  if (els.valuesEditor) {
    els.valuesEditor.innerHTML = buildOptionValueRow();
  }
}

function setMenuOptionLoading(isLoading, message = "") {
  menuOptionManagerState.loading = Boolean(isLoading);
  const els = getMenuOptionManagerElements();
  if (!els.groupsStatus || !els.saveGroupBtn) return;
  els.groupsStatus.textContent = message;
  els.saveGroupBtn.disabled = Boolean(isLoading);
}

function renderMenuOptionGroupsList() {
  const els = getMenuOptionManagerElements();
  if (!els.groupsList) return;

  const groups = menuOptionManagerState.groups;
  if (!groups.length) {
    els.groupsList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-sliders-h"></i>
        <p>No option groups yet. Add one above.</p>
      </div>
    `;
    return;
  }

  els.groupsList.innerHTML = groups
    .map((group) => {
      const pills = [
        group.type === "single" ? "Single" : "Multiple",
        group.required ? "Required" : "Optional",
      ];
      if (group.type === "multiple" && group.max_selections) {
        pills.push(`Max ${group.max_selections}`);
      }

      const valuesHtml = group.values
        .map(
          (value) =>
            `<li>${escapeHtml(value.name)} <strong>${formatOptionAdjustmentLabel(
              value.price_adjustment
            )}</strong></li>`
        )
        .join("");

      return `
        <article class="option-group-card" data-group-id="${escapeHtml(group.id)}">
          <h4>${escapeHtml(group.name)}</h4>
          <div class="option-group-meta">
            ${pills
              .map((pill) => `<span class="option-meta-pill">${escapeHtml(pill)}</span>`)
              .join("")}
          </div>
          <ul class="option-group-values">${valuesHtml}</ul>
          <div class="option-group-actions">
            <button type="button" class="btn btn-secondary edit-option-group" data-group-id="${escapeHtml(
              group.id
            )}">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button type="button" class="btn btn-danger delete-option-group" data-group-id="${escapeHtml(
              group.id
            )}">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadMenuOptionGroups(forceRefresh = false) {
  if (!menuOptionManagerState.menuItemId) return;
  const els = getMenuOptionManagerElements();
  setMenuOptionLoading(true, "Loading option groups...");

  try {
    const productId = String(menuOptionManagerState.menuItemId).trim();
    const groups = await secureRequest(
      `${PRODUCT_OPTION_ENDPOINTS.groups}?select=*&product_id=eq.${encodeURIComponent(
        productId
      )}&order=created_at.asc`,
      "GET",
      null,
      { authRequired: true }
    );

    const normalizedGroups = Array.isArray(groups)
      ? groups.map((group) => normalizeOptionGroupRecord(group))
      : [];
    const groupIds = normalizedGroups
      .map((group) => group.id)
      .filter((id) => id.length > 0);

    let values = [];
    if (groupIds.length > 0) {
      values = await secureRequest(
        `${PRODUCT_OPTION_ENDPOINTS.values}?select=*&group_id=in.(${groupIds
          .map((id) => encodeURIComponent(id))
          .join(",")})&order=created_at.asc`,
        "GET",
        null,
        { authRequired: true }
      );
    }

    const valuesByGroup = new Map();
    toArray(values).forEach((record) => {
      const value = normalizeOptionValueRecord(record);
      if (!valuesByGroup.has(value.group_id)) {
        valuesByGroup.set(value.group_id, []);
      }
      valuesByGroup.get(value.group_id).push(value);
    });

    menuOptionManagerState.groups = normalizedGroups.map((group) => ({
      ...group,
      values: (valuesByGroup.get(group.id) || []).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));
    renderMenuOptionGroupsList();

    if (els.groupsStatus) {
      els.groupsStatus.textContent = menuOptionManagerState.groups.length
        ? ""
        : "No option groups created yet.";
    }
  } catch (error) {
    console.error("Failed to load product options:", error);
    menuOptionManagerState.groups = [];
    renderMenuOptionGroupsList();
    if (els.groupsStatus) {
      els.groupsStatus.textContent = "Failed to load option groups.";
    }
  } finally {
    setMenuOptionLoading(false);
  }
}

function fillOptionGroupForm(group) {
  const els = getMenuOptionManagerElements();
  if (!els.groupForm || !group) return;

  els.groupId.value = group.id;
  els.groupName.value = group.name;
  els.groupType.value = normalizeOptionType(group.type);
  els.groupRequired.value = group.required ? "true" : "false";
  els.groupMax.value =
    group.max_selections !== null && group.max_selections !== undefined
      ? String(group.max_selections)
      : "";
  syncOptionGroupTypeUi();

  const values = group.values && group.values.length ? group.values : [{}];
  els.valuesEditor.innerHTML = values.map((value) => buildOptionValueRow(value)).join("");
  if (els.groupsStatus) {
    els.groupsStatus.textContent = `Editing "${group.name}"`;
  }
}

function collectOptionValueRows() {
  const els = getMenuOptionManagerElements();
  const rows = Array.from(
    els.valuesEditor.querySelectorAll(".option-value-row")
  );
  const values = [];

  rows.forEach((row) => {
    const nameInput = row.querySelector(".option-value-name");
    const priceInput = row.querySelector(".option-value-price");
    const id = String(row.dataset.valueId || "").trim();
    const name = toSafeString(nameInput?.value);
    const rawPrice = Number(priceInput?.value || 0);

    if (!name) return;

    if (!Number.isFinite(rawPrice)) {
      throw new Error("Each option value must have a valid price adjustment.");
    }

    values.push({
      id: id || null,
      name,
      price_adjustment: toMoney(rawPrice, 0),
    });
  });

  if (values.length === 0) {
    throw new Error("Add at least one option value.");
  }

  return values;
}

async function saveOptionGroup(e) {
  e.preventDefault();

  if (!menuOptionManagerState.menuItemId) {
    showNotification("Choose a menu item first.", "error");
    return;
  }

  const els = getMenuOptionManagerElements();
  const groupId = String(els.groupId.value || "").trim();
  const name = toSafeString(els.groupName.value);
  const type = normalizeOptionType(els.groupType.value);
  const required = els.groupRequired.value === "true";
  const maxInput = String(els.groupMax.value || "").trim();
  const maxSelections =
    type === "multiple" && maxInput
      ? Math.max(1, parseInt(maxInput, 10) || 1)
      : null;

  if (!name) {
    showNotification("Option group name is required.", "error");
    return;
  }

  let values = [];
  try {
    values = collectOptionValueRows();
  } catch (error) {
    showNotification(error.message || "Invalid option values.", "error");
    return;
  }

  const actionResult = await runAdminAction({
    actionKey: groupId
      ? `option-group-update-${groupId}`
      : `option-group-create-${menuOptionManagerState.menuItemId}`,
    controls: [els.saveGroupBtn],
    progressTitle: groupId ? "Updating option group" : "Creating option group",
    progressText: "Saving options...",
      task: async (progress) => {
        setMenuOptionLoading(true, "Saving option group...");
        try {
          const baselineVersion = (await fetchServerUpdateSignal()).contentVersion;
        const groupPayload = {
          product_id: menuOptionManagerState.menuItemId,
          name,
          type,
          required,
          max_selections: maxSelections,
        };

        let savedGroupId = groupId;
        if (savedGroupId) {
          await secureRequest(
            `${PRODUCT_OPTION_ENDPOINTS.groups}?id=eq.${encodeURIComponent(
              savedGroupId
            )}`,
            "PATCH",
            groupPayload,
            { authRequired: true }
          );
        } else {
          const created = await secureRequest(
            PRODUCT_OPTION_ENDPOINTS.groups,
            "POST",
            groupPayload,
            {
              authRequired: true,
              headers: {
                Prefer: "return=representation",
              },
            }
          );
          savedGroupId = Array.isArray(created) ? created[0]?.id : created?.id;
          savedGroupId = String(savedGroupId || "").trim();
          if (!savedGroupId) {
            throw new Error("Failed to create option group.");
          }
        }

        const existingValues = await secureRequest(
          `${PRODUCT_OPTION_ENDPOINTS.values}?select=id&group_id=eq.${encodeURIComponent(
            savedGroupId
          )}`,
          "GET",
          null,
          { authRequired: true }
        );
        const existingIds = new Set(
          toArray(existingValues).map((record) => String(record.id || "").trim())
        );
        const incomingIds = new Set();

        for (const value of values) {
          const payload = {
            group_id: savedGroupId,
            name: value.name,
            price_adjustment: toMoney(value.price_adjustment || 0, 0),
          };
          if (value.id) {
            incomingIds.add(String(value.id));
            await secureRequest(
              `${PRODUCT_OPTION_ENDPOINTS.values}?id=eq.${encodeURIComponent(
                value.id
              )}`,
              "PATCH",
              payload,
              { authRequired: true }
            );
          } else {
            const createdValue = await secureRequest(
              PRODUCT_OPTION_ENDPOINTS.values,
              "POST",
              payload,
              {
                authRequired: true,
                headers: {
                  Prefer: "return=representation",
                },
              }
            );
            const createdId = Array.isArray(createdValue)
              ? createdValue[0]?.id
              : createdValue?.id;
            if (createdId) incomingIds.add(String(createdId));
          }
        }

        const deleteIds = Array.from(existingIds).filter(
          (id) => !incomingIds.has(id)
        );
        for (const id of deleteIds) {
          await secureRequest(
            `${PRODUCT_OPTION_ENDPOINTS.values}?id=eq.${encodeURIComponent(id)}`,
            "DELETE",
            null,
            { authRequired: true }
          );
        }

        invalidateEndpointCache(PRODUCT_OPTION_ENDPOINTS.groups);
        invalidateEndpointCache(PRODUCT_OPTION_ENDPOINTS.values);
        markPublicContentCacheDirty();
        const contentVersion = await ensureContentVersionAfterWrite(
          baselineVersion,
          "menu"
        );
        dataSync.notifyDataChanged(groupId ? "update" : "create", "menu", {
          contentVersion,
        });
        showNotification("Option group saved successfully!", "success");

        resetOptionGroupForm();
        await loadMenuOptionGroups(true);
        progress.complete("Option group saved");
      } finally {
        setMenuOptionLoading(false);
      }
    },
  });

  if (!actionResult.ok && !actionResult.skipped) {
    console.error("Failed to save option group:", actionResult.error);
    showNotification("Failed to save option group. Data reloaded.", "error");
    await loadMenuOptionGroups(true);
  }
}

async function deleteOptionGroup(groupId) {
  const id = String(groupId || "").trim();
  if (!id) return;

  const group = menuOptionManagerState.groups.find((item) => item.id === id);
  const confirmed = await showPopup({
    title: "Delete Option Group",
    message: `Delete "${group?.name || "this group"}" and all its option values?`,
    type: "warning",
    showCancel: true,
    cancelText: "Cancel",
    confirmText: "Delete",
  });

  if (!confirmed) return;

  const els = getMenuOptionManagerElements();
  const actionResult = await runAdminAction({
    actionKey: `option-group-delete-${id}`,
    controls: [els.saveGroupBtn],
    progressTitle: "Deleting option group",
    progressText: "Removing option group...",
    task: async (progress) => {
      setMenuOptionLoading(true, "Deleting option group...");
      try {
        const baselineVersion = (await fetchServerUpdateSignal()).contentVersion;
        await secureRequest(
          `${PRODUCT_OPTION_ENDPOINTS.groups}?id=eq.${encodeURIComponent(id)}`,
          "DELETE",
          null,
          { authRequired: true }
        );

        invalidateEndpointCache(PRODUCT_OPTION_ENDPOINTS.groups);
        invalidateEndpointCache(PRODUCT_OPTION_ENDPOINTS.values);
        markPublicContentCacheDirty();
        const contentVersion = await ensureContentVersionAfterWrite(
          baselineVersion,
          "menu"
        );
        dataSync.notifyDataChanged("delete", "menu", { contentVersion });
        showNotification("Option group deleted.", "success");

        if (getMenuOptionManagerElements().groupId.value === id) {
          resetOptionGroupForm();
        }
        await loadMenuOptionGroups(true);
        progress.complete("Option group deleted");
      } finally {
        setMenuOptionLoading(false);
      }
    },
  });

  if (!actionResult.ok && !actionResult.skipped) {
    console.error("Failed to delete option group:", actionResult.error);
    showNotification("Failed to delete option group.", "error");
  }
}

function editOptionGroup(groupId) {
  const id = String(groupId || "").trim();
  const group = menuOptionManagerState.groups.find((item) => item.id === id);
  if (!group) {
    showNotification("Option group not found.", "error");
    return;
  }
  fillOptionGroupForm(group);
}

function closeMenuOptionsManager() {
  const els = getMenuOptionManagerElements();
  if (!els.modal) return;
  menuOptionManagerState.open = false;
  menuOptionManagerState.menuItemId = "";
  menuOptionManagerState.menuItemTitle = "";
  menuOptionManagerState.groups = [];
  els.modal.classList.remove("active");
  els.modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("menu-options-open");
  resetOptionGroupForm();
  if (els.groupsStatus) els.groupsStatus.textContent = "";
  if (els.groupsList) els.groupsList.innerHTML = "";
}

async function openMenuOptionsManager(menuItemId) {
  const id = String(menuItemId || "").trim();
  if (!id) {
    showNotification("Invalid menu item.", "error");
    return;
  }

  const els = getMenuOptionManagerElements();
  if (!els.modal) return;

  const menuItem =
    getCachedItemForType("menu", id) || (await getEditableItem("menu", id));
  if (!menuItem) {
    showNotification("Menu item not found.", "error");
    return;
  }

  menuOptionManagerState.menuItemId = id;
  menuOptionManagerState.menuItemTitle = toSafeString(menuItem.title, "Menu Item");
  menuOptionManagerState.open = true;
  menuOptionManagerState.groups = [];

  els.modal.classList.add("active");
  els.modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("menu-options-open");
  els.productLabel.textContent = `Editing options for: ${menuOptionManagerState.menuItemTitle}`;
  resetOptionGroupForm();

  await loadMenuOptionGroups(true);
}

// Specials Management
async function renderSpecialsItems(forceRefresh = false) {
  const container = document.getElementById("specials-admin-grid");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(SPECIALS_ENDPOINT, null, forceRefresh);
    const sortedItems = Array.isArray(items)
      ? items.slice().sort(compareRecordsByDisplayOrder)
      : [];

    if (sortedItems.length === 0) {
      cacheItemsForType("specials", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-tag"></i>
          <p>No specials yet. Add your first special!</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    sortedItems.forEach((item, index) => {
      const card = buildSpecialsAdminCardElement(item, index + 1);
      if (card) fragment.appendChild(card);
    });

    if (!fragment.childNodes.length) {
      cacheItemsForType("specials", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-tag"></i>
          <p>No specials yet. Add your first special!</p>
        </div>
      `;
      return;
    }

    container.replaceChildren(fragment);
    refreshOrderBadges("specials");
    cacheItemsForType("specials", sortedItems);
  } catch (error) {
    console.error(`Error rendering specials:`, error);
    cacheItemsForType("specials", []);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load specials. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveSpecialsItem(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById("specials-form");
  const submitBtn =
    e.submitter || form?.querySelector('button[type="submit"], .btn-admin');

  const titleField = document.getElementById("specials-title");
  const priceField = document.getElementById("specials-price");
  const originalPriceField = document.getElementById("specials-original-price");
  const specialFlagField = document.getElementById("specials-special-flag");
  const badgeTextField = document.getElementById("specials-badge-right-text");
  const badgeIconField = document.getElementById("specials-badge-right-icon");
  const ctaLabelField = document.getElementById("specials-cta-label");
  const activeField = document.getElementById("specials-active");
  const displayOrderField = document.getElementById("specials-display-order");
  const imageField = document.getElementById("specials-image");
  const idField = document.getElementById("specials-id");

  clearFormFieldErrors(form);

  const title = toSafeString(titleField?.value).trim();
  const priceValue = toMoney(priceField?.value, 0);
  const originalPriceRaw = toSafeString(originalPriceField?.value).trim();
  const originalPrice =
    originalPriceRaw === "" ? null : toMoney(parseFloat(originalPriceRaw), 0);
  const isSpecial = specialFlagField?.value === "true";
  const badgeText = toSafeString(badgeTextField?.value, "SPECIAL").trim();
  const badgeIcon = toSafeString(badgeIconField?.value, "\uD83D\uDD25").trim();
  const ctaLabel = toSafeString(ctaLabelField?.value, "Order Now").trim();
  const isActive = activeField?.value !== "false";
  const displayOrderInput = toSafeString(displayOrderField?.value).trim();
  const imageFile = imageField?.files?.[0] || null;
  const itemId = toSafeString(idField?.value).trim();
  const isUpdate = Boolean(itemId);
  const existingUrl = isUpdate ? getExistingImageUrlForItem("specials", itemId) : "";

  if (!title || title.length > 120) {
    setFieldError(titleField, "Title must be 1-120 characters.");
    showNotification("Title must be 1-120 characters", "error");
    return;
  }

  if (!Number.isFinite(priceValue) || priceValue < 0) {
    setFieldError(priceField, "Price must be 0 or higher.");
    showNotification("Price must be 0 or higher", "error");
    return;
  }

  if (originalPriceRaw !== "" && (!Number.isFinite(originalPrice) || originalPrice < 0)) {
    setFieldError(originalPriceField, "Original price must be 0 or higher.");
    showNotification("Original price must be 0 or higher", "error");
    return;
  }

  if (!imageFile && !existingUrl) {
    setFieldError(imageField, "Please choose an image file.");
    showNotification("Please choose an image file", "error");
    return;
  }

  const actionResult = await runAdminAction({
    actionKey: isUpdate ? `specials-update-${itemId}` : "specials-create",
    controls: [submitBtn],
    progressTitle: isUpdate ? "Updating special" : "Creating special",
    progressText: "Preparing specials data...",
    task: async (progress) => {
      let displayOrder;
      if (displayOrderInput === "" && !isUpdate) {
        displayOrder = await getNextDisplayOrder(SPECIALS_ENDPOINT);
      } else {
        displayOrder = parseInt(displayOrderInput || "0", 10);
      }

      if (!Number.isFinite(displayOrder) || displayOrder < 0) {
        setFieldError(displayOrderField, "Display order must be 0 or higher.");
        throw new Error("Display order must be 0 or higher");
      }

      const upload = await processImageUpload("specials", imageFile, existingUrl);

      const formData = {
        title,
        alt: title,
        image: upload.url,
        image_url: upload.url,
        price: priceValue,
        original_price: originalPrice,
        is_special: isSpecial,
        badge_right_text: badgeText || "SPECIAL",
        badge_right_icon: badgeIcon || "\uD83D\uDD25",
        cta_label: ctaLabel || "Order Now",
        is_active: isActive,
        display_order: displayOrder,
      };

      if (upload.meta) {
        formData.width = upload.meta.width || null;
        formData.height = upload.meta.height || null;
        formData.file_size = upload.meta.size || null;
      }

      const result = await saveItem("specials", formData, { itemId });

      if (!result.success) {
        await rollbackUploadedImage(upload);
        throw new Error(result.message || "Failed to save special");
      }

      const recordCandidate =
        result.record && typeof result.record === "object" ? result.record : null;
      const savedRecord = {
        ...(recordCandidate || {}),
        ...formData,
        id: recordCandidate?.id || itemId || null,
      };
      const savedId = toSafeString(savedRecord.id).trim();
      const normalization = await normalizeDisplayOrderConflicts(
        "specials",
        savedId,
        displayOrder
      );

      await finalizeImageReplacement(upload);
      resetSpecialsForm();
      const updatedInPlace = savedId ? upsertItemCardInUi("specials", savedRecord) : false;
      if (normalization.normalized || !updatedInPlace) {
        await withPreservedScroll(() => renderSpecialsItems(true));
      }
      await updateItemCounts();
      progress.complete("Special saved");
      if (normalization.normalized) {
        showNotification(
          "Special saved and display order normalized successfully.",
          "success"
        );
      } else {
        showNotification("Special saved successfully!", "success");
      }
      dataSync.notifyDataChanged(result.operation, "specials", {
        contentVersion: result.contentVersion,
      });
      return result;
    },
  });

  if (!actionResult.ok && !actionResult.skipped) {
    console.error("Error saving special:", actionResult.error);
    showNotification(
      actionResult.error?.message || "Failed to save special",
      "error"
    );
  }
}

async function editSpecialsItem(id) {
  try {
    const item = await getEditableItem("specials", id);

    if (!item) {
      showNotification("Special not found", "error");
      return;
    }

    document.getElementById("specials-id").value = item.id;
    document.getElementById("specials-title").value = toSafeString(
      item.title || item.alt
    );
    document.getElementById("specials-price").value = toMoney(item.price, 0);
    document.getElementById("specials-original-price").value =
      item.original_price === null || item.original_price === undefined
        ? ""
        : toMoney(item.original_price, 0);
    document.getElementById("specials-special-flag").value = parseRecordBoolean(
      item.is_special,
      false
    )
      ? "true"
      : "false";
    document.getElementById("specials-badge-right-text").value = toSafeString(
      item.badge_right_text,
      "SPECIAL"
    );
    document.getElementById("specials-badge-right-icon").value = toSafeString(
      item.badge_right_icon,
      "\uD83D\uDD25"
    );
    document.getElementById("specials-cta-label").value = toSafeString(
      item.cta_label,
      "Order Now"
    );
    document.getElementById("specials-active").value = parseRecordBoolean(
      item.is_active,
      true
    )
      ? "true"
      : "false";
    document.getElementById("specials-display-order").value =
      item.display_order ?? 0;

    const imageField = document.getElementById("specials-image");
    if (imageField) {
      imageField.required = false;
    }
    cacheTempImageForItem(item.id, resolveRecordImage(item));

    const preview = document.getElementById("specials-image-preview");
    preview.innerHTML = `<img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.specials)}" alt="Current image" style="max-height: 150px; border-radius: 8px;" decoding="async"
      onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.specials}';">`;

    document.getElementById("specials-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    document
      .getElementById("specials-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading special for edit:", error);
    showNotification("Failed to load special for editing", "error");
  }
}

/* ================== CAROUSEL MANAGEMENT FUNCTIONS ================== */

async function renderCarouselItems(forceRefresh = false) {
  const container = document.getElementById("carousel-admin-grid");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(
      API_ENDPOINTS.CAROUSEL,
      null,
      forceRefresh
    );
    const sortedItems = Array.isArray(items)
      ? items.slice().sort(compareRecordsByDisplayOrder)
      : [];

    if (sortedItems.length === 0) {
      cacheItemsForType("carousel", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>No carousel images yet. Add your first background image!</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    sortedItems.forEach((item, index) => {
      const card = buildCarouselAdminCardElement(item, index + 1);
      if (card) fragment.appendChild(card);
    });

    if (!fragment.childNodes.length) {
      cacheItemsForType("carousel", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>No carousel images yet. Add your first background image!</p>
        </div>
      `;
      return;
    }

    container.replaceChildren(fragment);
    refreshOrderBadges("carousel");
    cacheItemsForType("carousel", sortedItems);
  } catch (error) {
    console.error(`Error rendering carousel items:`, error);
    cacheItemsForType("carousel", []);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load carousel items. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveCarouselItem(e) {
  e.preventDefault();
  const form = e.currentTarget || document.getElementById("carousel-form");
  const submitBtn =
    e.submitter || form?.querySelector('button[type="submit"], .btn-admin');

  const altField = document.getElementById("carousel-alt");
  const titleField = document.getElementById("carousel-title");
  const subtitleField = document.getElementById("carousel-subtitle");
  const ctaTextField = document.getElementById("carousel-cta-text");
  const ctaLinkField = document.getElementById("carousel-cta-link");
  const displayOrderField = document.getElementById("carousel-display-order");
  const activeField = document.getElementById("carousel-active");
  const imageField = document.getElementById("carousel-image");
  const idField = document.getElementById("carousel-id");

  clearFormFieldErrors(form);

  const alt = toSafeString(altField?.value).trim();
  const title = toSafeString(titleField?.value).trim();
  const subtitle = toSafeString(subtitleField?.value).trim();
  const ctaText = toSafeString(ctaTextField?.value).trim();
  const ctaLink = toSafeString(ctaLinkField?.value).trim();
  const displayOrderInput = toSafeString(displayOrderField?.value).trim();
  const isActive = activeField?.value === "true";
  const imageFile = imageField?.files?.[0] || null;
  const itemId = toSafeString(idField?.value).trim();
  const isUpdate = Boolean(itemId);
  const existingUrl = isUpdate ? getExistingImageUrlForItem("carousel", itemId) : "";

  if (!alt || alt.length > 255) {
    setFieldError(altField, "Alt text must be 1-255 characters.");
    showNotification("Alt text must be 1-255 characters", "error");
    return;
  }

  if (title && title.length > 100) {
    setFieldError(titleField, "Title must be 100 characters or fewer.");
    showNotification("Title must be 100 characters or fewer", "error");
    return;
  }

  if (ctaText && ctaText.length > 50) {
    setFieldError(ctaTextField, "CTA text must be 50 characters or fewer.");
    showNotification("CTA text must be 50 characters or fewer", "error");
    return;
  }

  if (ctaLink && ctaLink.length > 255) {
    setFieldError(ctaLinkField, "CTA link must be 255 characters or fewer.");
    showNotification("CTA link must be 255 characters or fewer", "error");
    return;
  }

  if (!imageFile && !existingUrl) {
    setFieldError(imageField, "Please choose an image file.");
    showNotification("Please choose an image file", "error");
    return;
  }

  const actionResult = await runAdminAction({
    actionKey: isUpdate ? `carousel-update-${itemId}` : "carousel-create",
    controls: [submitBtn],
    progressTitle: isUpdate ? "Updating carousel slide" : "Creating carousel slide",
    progressText: "Preparing carousel data...",
    task: async (progress) => {
      let displayOrder;
      if (displayOrderInput === "" && !isUpdate) {
        displayOrder = await getNextDisplayOrder(API_ENDPOINTS.CAROUSEL);
      } else {
        displayOrder = parseInt(displayOrderInput || "0", 10);
      }

      if (!Number.isFinite(displayOrder) || displayOrder < 0) {
        setFieldError(displayOrderField, "Display order must be 0 or higher.");
        throw new Error("Display order must be 0 or higher");
      }

      if (ctaLink) {
        try {
          new URL(ctaLink, window.location.origin);
        } catch {
          setFieldError(ctaLinkField, "CTA link must be a valid URL or path.");
          throw new Error("CTA link must be a valid URL or path");
        }
      }

      const upload = await processImageUpload("carousel", imageFile, existingUrl);

      const formData = {
        alt,
        title: title || null,
        subtitle: subtitle || null,
        cta_text: ctaText || null,
        cta_link: ctaLink || null,
        display_order: displayOrder,
        is_active: isActive,
        image: upload.url,
      };

      const result = await saveItem("carousel", formData, { itemId });

      if (!result.success) {
        await rollbackUploadedImage(upload);
        throw new Error(result.message || "Failed to save carousel image");
      }

      const recordCandidate =
        result.record && typeof result.record === "object" ? result.record : null;
      const savedRecord = {
        ...(recordCandidate || {}),
        ...formData,
        id: recordCandidate?.id || itemId || null,
      };
      const savedId = toSafeString(savedRecord.id).trim();
      const normalization = await normalizeDisplayOrderConflicts(
        "carousel",
        savedId,
        displayOrder
      );

      await finalizeImageReplacement(upload);
      resetCarouselForm();
      const updatedInPlace = savedId
        ? upsertItemCardInUi("carousel", savedRecord)
        : false;
      if (normalization.normalized || !updatedInPlace) {
        await withPreservedScroll(() => renderCarouselItems(true));
      }
      await updateItemCounts();
      progress.complete("Carousel image saved");
      if (normalization.normalized) {
        showNotification(
          "Carousel image saved and display order normalized successfully.",
          "success"
        );
      } else {
        showNotification("Carousel image saved successfully!", "success");
      }
      dataSync.notifyDataChanged(result.operation, "carousel", {
        contentVersion: result.contentVersion,
      });
      return result;
    },
  });

  if (!actionResult.ok && !actionResult.skipped) {
    console.error("Error saving carousel item:", actionResult.error);
    showNotification(
      actionResult.error?.message || "Failed to save carousel item",
      "error"
    );
  }
}

async function editCarouselItem(id) {
  try {
    const item = await getEditableItem("carousel", id);

    if (!item) {
      showNotification("Carousel item not found", "error");
      return;
    }

    document.getElementById("carousel-id").value = item.id;
    document.getElementById("carousel-alt").value = item.alt;
    document.getElementById("carousel-title").value = item.title || "";
    document.getElementById("carousel-subtitle").value = item.subtitle || "";
    document.getElementById("carousel-cta-text").value = item.cta_text || "";
    document.getElementById("carousel-cta-link").value = item.cta_link || "";
    document.getElementById("carousel-display-order").value =
      item.display_order || 0;
    document.getElementById("carousel-active").value = item.is_active
      ? "true"
      : "false";
    const imageField = document.getElementById("carousel-image");
    if (imageField) {
      imageField.required = false;
    }
    cacheTempImageForItem(item.id, resolveRecordImage(item));

    const preview = document.getElementById("carousel-image-preview");
    preview.innerHTML = `<img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.carousel)}" alt="Current image" style="max-height: 150px; border-radius: 8px;" decoding="async"
      onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.carousel}';">`;

    document.getElementById("carousel-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    document
      .getElementById("carousel-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading carousel item for edit:", error);
    showNotification("Failed to load carousel item for editing", "error");
  }
}

/* ================== ENHANCED STORAGE MANAGEMENT ================== */

async function updateStorageUsage() {
  try {
    const [featured, menu, specials, carousel] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(SPECIALS_ENDPOINT),
      loadDataFromSupabase(API_ENDPOINTS.CAROUSEL), // Added carousel
    ]);

    const allItems = [...featured, ...menu, ...specials, ...carousel];
    let totalBytes = 0;
    let hasUnknown = false;

    allItems.forEach((item) => {
      if (Number.isFinite(item.file_size)) {
        totalBytes += Number(item.file_size);
      } else if (resolveRecordImage(item)) {
        hasUnknown = true;
      }
    });

    const mbUsed = (totalBytes / (1024 * 1024)).toFixed(2);
    const percentage = Math.min((mbUsed / 500) * 100, 100).toFixed(1);

    // Update UI
    const storageUsedEl = document.getElementById("storage-used");
    const storageFillEl = document.getElementById("storage-fill");
    const storageInfoEl = document.getElementById("storage-info");

    if (storageUsedEl) storageUsedEl.textContent = mbUsed;
    if (storageFillEl) storageFillEl.style.width = `${percentage}%`;
    if (storageInfoEl) {
      storageInfoEl.textContent = hasUnknown
        ? `${mbUsed} MB / 500 MB (approx)`
        : `${mbUsed} MB / 500 MB`;
    }

    // Add warnings
    if (mbUsed > 450) {
      showNotification("CRITICAL: Storage usage is at 90%+!", "error");
    } else if (mbUsed > 400) {
      showNotification(
        `Warning: Storage usage is high (${mbUsed}MB).`,
        "warning"
      );
    }

    return { mbUsed, itemCount: allItems.length };
  } catch (error) {
    console.error("Error updating storage usage:", error);
    return { mbUsed: 0, itemCount: 0 };
  }
}

async function updateItemCounts() {
  try {
    const [featured, menu, specials, carousel] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(SPECIALS_ENDPOINT),
      loadDataFromSupabase(API_ENDPOINTS.CAROUSEL), // Added carousel
    ]);

    const countFeatured = document.getElementById("count-featured");
    const countMenu = document.getElementById("count-menu");
    const countSpecials = document.getElementById("count-specials");
    const countCarousel = document.getElementById("count-carousel");

    if (countFeatured) countFeatured.textContent = featured.length || 0;
    if (countMenu) countMenu.textContent = menu.length || 0;
    if (countSpecials) countSpecials.textContent = specials.length || 0;
    if (countCarousel) countCarousel.textContent = carousel.length || 0;

    await updateStorageUsage();
  } catch (error) {
    console.error("Error updating counts:", error);
  }
}

/* ================== ENHANCED DATA BACKUP/RESTORE ================== */

async function exportData() {
  try {
    showNotification("Preparing export...", "info");

    const [featured, menu, specials, carousel] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(SPECIALS_ENDPOINT),
      loadDataFromSupabase(API_ENDPOINTS.CAROUSEL), // Added carousel
    ]);

    const data = {
      featured,
      menu,
      specials,
      carousel, // Added carousel
      exportDate: new Date().toISOString(),
      version: "2.2.0",
      source: "Toke Bakes CMS",
      itemCount: {
        featured: featured.length,
        menu: menu.length,
        specials: specials.length,
        carousel: carousel.length, // Added carousel
      },
    };

    // Create and download file
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `toke-bakes-backup-${
      new Date().toISOString().split("T")[0]
    }.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification("Data exported successfully!", "success");
  } catch (error) {
    console.error("Error exporting data:", error);
    showNotification("Failed to export data", "error");
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate backup file - UPDATED WITH CAROUSEL
    if (
      !Array.isArray(data.featured) ||
      !Array.isArray(data.menu) ||
      !Array.isArray(data.specials) ||
      !Array.isArray(data.carousel)
    ) {
      showNotification("Invalid backup file format", "error");
      return;
    }

    const confirmed = await showPopup({
      title: "Import Data",
      message:
        "WARNING: This will replace ALL current data. This action cannot be undone.\n\nAre you sure you want to continue?",
      type: "warning",
      showCancel: true,
      cancelText: "Cancel",
      confirmText: "Import",
    });

    if (!confirmed) {
      return;
    }

    const importDataBtn = document.getElementById("import-data");
    const actionResult = await runAdminAction({
      actionKey: "import-data",
      controls: [importDataBtn],
      progressTitle: "Importing data",
      progressText: "Uploading backup payload...",
      task: async (progress) => {
        const baselineVersion = (await fetchServerUpdateSignal()).contentVersion;

        await Promise.all([
          secureRequest(`${API_ENDPOINTS.FEATURED}?id=not.is.null`, "DELETE", null, {
            authRequired: true,
            suppressNotifications: true,
            timeout: 26000,
          }),
          secureRequest(`${API_ENDPOINTS.MENU}?id=not.is.null`, "DELETE", null, {
            authRequired: true,
            suppressNotifications: true,
            timeout: 26000,
          }),
          secureRequest(`${SPECIALS_ENDPOINT}?id=not.is.null`, "DELETE", null, {
            authRequired: true,
            suppressNotifications: true,
            timeout: 26000,
          }),
          secureRequest(`${API_ENDPOINTS.CAROUSEL}?id=not.is.null`, "DELETE", null, {
            authRequired: true,
            suppressNotifications: true,
            timeout: 26000,
          }),
        ]);
        setAdminCrudProgress(28, "Importing records...");

        const totalItems =
          data.featured.length +
          data.menu.length +
          data.specials.length +
          data.carousel.length;
        let imported = 0;

        const importBatch = async (items, endpoint) => {
          for (const item of items) {
            await secureRequest(endpoint, "POST", item, { authRequired: true });
            imported++;
            const ratio = totalItems > 0 ? imported / totalItems : 1;
            const nextProgress = Math.min(90, Math.round(28 + ratio * 62));
            setAdminCrudProgress(nextProgress, `Imported ${imported}/${totalItems}`);
            await new Promise((resolve) => setTimeout(resolve, 70));
          }
        };

        await importBatch(data.featured, API_ENDPOINTS.FEATURED);
        await importBatch(data.menu, API_ENDPOINTS.MENU);
        await importBatch(data.specials, SPECIALS_ENDPOINT);
        await importBatch(data.carousel, API_ENDPOINTS.CAROUSEL);

        clearDataCache();
        markPublicContentCacheDirty();
        const contentVersion = await ensureContentVersionAfterWrite(
          baselineVersion,
          "all"
        );

        await Promise.all([
          renderFeaturedItems(true),
          renderMenuItems(true),
          renderSpecialsItems(true),
          renderCarouselItems(true),
        ]);
        await populateFeaturedMenuSelect(null, true);
        await updateItemCounts();

        dataSync.notifyDataChanged("import", "all", { contentVersion });
        progress.complete("Import complete");
        showNotification(`Successfully imported ${imported} items!`, "success");
      },
    });

    if (!actionResult.ok && !actionResult.skipped) {
      throw actionResult.error || new Error("Import failed");
    }
  } catch (error) {
    console.error("Error importing data:", error);
    showNotification("Failed to import data", "error");
  }
}

/* ================== RESET FORM FUNCTIONS ================== */

function resetFeaturedForm() {
  const form = document.getElementById("featured-form");
  if (form) form.reset();
  document.getElementById("featured-id").value = "";
  const imageField = document.getElementById("featured-image");
  if (imageField) {
    imageField.required = true;
  }
  document.getElementById("featured-image-preview").innerHTML = "";
  document.getElementById("featured-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetMenuForm() {
  const form = document.getElementById("menu-form");
  if (form) form.reset();
  document.getElementById("menu-id").value = "";
  const imageField = document.getElementById("menu-image");
  if (imageField) {
    imageField.required = true;
  }
  document.getElementById("menu-image-preview").innerHTML = "";
  document.getElementById("menu-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetSpecialsForm() {
  const form = document.getElementById("specials-form");
  if (form) form.reset();
  const idField = document.getElementById("specials-id");
  if (idField) idField.value = "";
  const imageField = document.getElementById("specials-image");
  if (imageField) {
    imageField.required = true;
  }
  const preview = document.getElementById("specials-image-preview");
  if (preview) preview.innerHTML = "";
  const formContainer = document.getElementById("specials-form-container");
  if (formContainer) formContainer.style.display = "none";

  const specialFlagField = document.getElementById("specials-special-flag");
  if (specialFlagField) specialFlagField.value = "false";

  const badgeTextField = document.getElementById("specials-badge-right-text");
  if (badgeTextField) badgeTextField.value = "SPECIAL";

  const badgeIconField = document.getElementById("specials-badge-right-icon");
  if (badgeIconField) badgeIconField.value = "\uD83D\uDD25";

  const ctaField = document.getElementById("specials-cta-label");
  if (ctaField) ctaField.value = "Order Now";

  const activeField = document.getElementById("specials-active");
  if (activeField) activeField.value = "true";

  isEditing = false;
  currentEditId = null;
}

function resetCarouselForm() {
  const form = document.getElementById("carousel-form");
  if (form) form.reset();
  document.getElementById("carousel-id").value = "";
  document.getElementById("carousel-display-order").value = "";
  document.getElementById("carousel-active").value = "true";
  const imageField = document.getElementById("carousel-image");
  if (imageField) {
    imageField.required = true;
  }
  document.getElementById("carousel-image-preview").innerHTML = "";
  document.getElementById("carousel-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

/* ================== FIXED INITIALIZATION ================== */

async function initAdminPanel() {
  debugLog("Initializing Admin Panel v2.1 (with carousel)...");

  // Admin session will be validated after login

  // Check session
  const session = await ensureValidSession();
  debugLog("Session check:", session);

  if (session?.access_token) {
    const isAdmin = await checkIsAdmin();
    if (isAdmin) {
      currentAdmin = session.email || session.user?.email;
      document.getElementById("login-screen").style.display = "none";
      document.getElementById("admin-dashboard").style.display = "block";
      startSessionTimeout();
      setupActivityMonitoring();
      debugLog("Restored existing session.");
    } else {
      clearSession();
      debugLog("Session is not authorized.");
    }
  }

  // Check Supabase configuration
  if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
    const warning = document.createElement("div");
    warning.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #ff6b6b;
      color: white;
      padding: 10px;
      text-align: center;
      z-index: 10000;
      font-weight: bold;
    `;
    warning.textContent =
      "WARNING: Supabase not configured. Please check config.js";
    document.body.appendChild(warning);
    return;
  }

  // Set current year
  syncAutoYearBadges();

  // Setup event listeners
  setupEventListeners();
  ensureChatWidgetScriptLoaded();

  // Load initial data if logged in
  if (currentAdmin) {
    try {
      await loadAdminTabData("featured", true);
      await updateItemCounts();
      preloadAdminTabsInBackground();
    } catch (error) {
      console.error("Error loading initial data:", error);
    }
  }
}

let adminEventListenersBound = false;
function setupEventListeners() {
  if (adminEventListenersBound) return;
  adminEventListenersBound = true;
  debugLog("Setting up event listeners...");

  setupPasswordVisibilityToggle("admin-password", "admin-password-toggle");

  // Tab switching - UPDATED TO RESET CAROUSEL FORM
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", async function () {
      const tabId = this.dataset.tab;

      // Update active tab
      document
        .querySelectorAll(".admin-tab")
        .forEach((t) => t.classList.remove("active"));
      this.classList.add("active");

      // Show corresponding content
      document
        .querySelectorAll(".tab-pane")
        .forEach((pane) => pane.classList.remove("active"));
      const targetTab = document.getElementById(`${tabId}-tab`);
      if (targetTab) {
        targetTab.classList.add("active");
        await loadAdminTabData(tabId);
      }

      // Reset any open forms - ADDED CAROUSEL
      resetFeaturedForm();
      resetMenuForm();
      resetSpecialsForm();
      resetCarouselForm();
      closeMenuOptionsManager();
    });
  });

  const statsDaysSelect = document.getElementById("stats-days");
  if (statsDaysSelect) {
    statsDaysSelect.addEventListener("change", () => {
      loadedAdminTabs.delete("stats");
      Promise.resolve(loadStatsPanel(true)).catch((error) => {
        console.error("Failed to reload stats on range change:", error);
      });
    });
  }

  const refreshStatsBtn = document.getElementById("refresh-stats-btn");
  if (refreshStatsBtn) {
    refreshStatsBtn.addEventListener("click", () => {
      Promise.resolve(loadStatsPanel(true)).catch((error) => {
        console.error("Failed to refresh stats manually:", error);
      });
    });
  }

  const globalRefreshBtn = document.getElementById("global-refresh-btn");
  if (globalRefreshBtn) {
    globalRefreshBtn.addEventListener("click", () => {
      Promise.resolve(runGlobalRefreshFromStats()).catch((error) => {
        console.error("Failed to publish global refresh:", error);
      });
    });
  }

  const debugForceCheckBtn = document.getElementById("debug-force-check-btn");
  if (debugForceCheckBtn) {
    debugForceCheckBtn.addEventListener("click", async () => {
      try {
        if (
          window.TokeUpdateSync &&
          typeof window.TokeUpdateSync.requestServerCheck === "function"
        ) {
          await window.TokeUpdateSync.requestServerCheck("admin-debug-force", true);
        }
        await loadStatsPanel(true);
        showNotification("Version recheck completed.", "success");
      } catch (error) {
        recordAdminError("sync", "Force version recheck failed", {
          message: error?.message || "",
        });
        showNotification("Version recheck failed.", "error");
      }
    });
  }

  const debugForceRefetchBtn = document.getElementById("debug-force-refetch-btn");
  if (debugForceRefetchBtn) {
    debugForceRefetchBtn.addEventListener("click", async () => {
      try {
        clearDataCache();
        markPublicContentCacheDirty();
        await Promise.all([
          renderFeaturedItems(true),
          renderMenuItems(true),
          renderSpecialsItems(true),
          renderCarouselItems(true),
          updateItemCounts(),
        ]);
        await loadStatsPanel(true);
        showNotification("Content refetched successfully.", "success");
      } catch (error) {
        recordAdminError("sync", "Force refetch failed", {
          message: error?.message || "",
        });
        showNotification("Content refetch failed.", "error");
      }
    });
  }

  const debugClearThemeCacheBtn = document.getElementById("debug-clear-theme-cache-btn");
  if (debugClearThemeCacheBtn) {
    debugClearThemeCacheBtn.addEventListener("click", async () => {
      const ok = await clearThemeCachesSafely();
      await loadStatsPanel(true);
      showNotification(
        ok ? "Theme cache cleared." : "Theme cache clear failed.",
        ok ? "success" : "error"
      );
    });
  }

  const debugClearAppCacheBtn = document.getElementById("debug-clear-app-cache-btn");
  if (debugClearAppCacheBtn) {
    debugClearAppCacheBtn.addEventListener("click", async () => {
      const ok = await clearAppCachesSafely();
      await loadStatsPanel(true);
      showNotification(
        ok ? "App caches cleared." : "App cache clear failed.",
        ok ? "success" : "error"
      );
    });
  }

  const debugSoftReloadBtn = document.getElementById("debug-soft-reload-btn");
  if (debugSoftReloadBtn) {
    debugSoftReloadBtn.addEventListener("click", () => {
      window.location.reload();
    });
  }

  // Login form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      debugLog("Login form submitted");

      const email = sanitizeInput(
        document.getElementById("admin-email").value
      );
      const password = document.getElementById("admin-password").value;
      const submitBtn = loginForm.querySelector("button[type='submit']");

      debugLog("Attempting login with:", email);

      const actionResult = await runAdminAction({
        actionKey: `login-${email || "attempt"}`,
        controls: submitBtn ? [submitBtn] : [],
        progressTitle: "Logging in...",
        progressText: "Checking credentials...",
        task: async (progress) => {
          const isValid = await checkLogin(email, password);
          if (!isValid) {
            progress.fail("Login failed");
            return false;
          }
          progress.complete("Login successful");
          return true;
        },
      });

      if (!actionResult.ok || !actionResult.value) {
        showNotification("Invalid email or password", "error");
        return;
      }

      if (actionResult.value) {
        currentAdmin = email;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("admin-dashboard").style.display = "block";
        showNotification(`Welcome back, ${email}!`, "success");

        resetLoadedTabs();
        await loadAdminTabData("featured", true);
        await updateItemCounts();
        preloadAdminTabsInBackground();
      }
    });
  }

  // Logout
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (e) {
      e.preventDefault();
      logoutAdmin();
    });
  }

  // Form submissions - ADDED CAROUSEL
  const featuredForm = document.getElementById("featured-form");
  const menuForm = document.getElementById("menu-form");
  const specialsForm = document.getElementById("specials-form");
  const carouselForm = document.getElementById("carousel-form"); // Added
  const optionGroupForm = document.getElementById("option-group-form");
  const optionTypeSelect = document.getElementById("option-group-type");
  const addOptionValueRowBtn = document.getElementById("add-option-value-row");
  const resetOptionGroupBtn = document.getElementById("reset-option-group");
  const optionValuesEditor = document.getElementById("option-values-editor");
  const optionGroupsList = document.getElementById("option-groups-list");
  const optionModal = document.getElementById("menu-options-modal");

  if (featuredForm) {
    featuredForm.addEventListener("submit", saveFeaturedItem);
  }
  if (menuForm) {
    menuForm.addEventListener("submit", saveMenuItem);
  }
  if (specialsForm) {
    specialsForm.addEventListener("submit", saveSpecialsItem);
  }
  if (carouselForm) {
    // Added
    carouselForm.addEventListener("submit", saveCarouselItem);
  }
  if (optionGroupForm) {
    optionGroupForm.addEventListener("submit", saveOptionGroup);
  }
  if (optionTypeSelect) {
    optionTypeSelect.addEventListener("change", syncOptionGroupTypeUi);
  }
  if (addOptionValueRowBtn && optionValuesEditor) {
    addOptionValueRowBtn.addEventListener("click", () => {
      optionValuesEditor.insertAdjacentHTML("beforeend", buildOptionValueRow());
    });
  }
  if (resetOptionGroupBtn) {
    resetOptionGroupBtn.addEventListener("click", resetOptionGroupForm);
  }
  if (optionValuesEditor) {
    optionValuesEditor.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".remove-option-value-row");
      if (!removeBtn) return;
      const row = removeBtn.closest(".option-value-row");
      if (row && row.parentElement.children.length > 1) {
        row.remove();
      } else if (row) {
        const nameInput = row.querySelector(".option-value-name");
        const priceInput = row.querySelector(".option-value-price");
        if (nameInput) nameInput.value = "";
        if (priceInput) priceInput.value = "0";
        row.dataset.valueId = "";
      }
    });
  }
  if (optionGroupsList) {
    optionGroupsList.addEventListener("click", (event) => {
      const editBtn = event.target.closest(".edit-option-group");
      const deleteBtn = event.target.closest(".delete-option-group");
      if (editBtn) {
        editOptionGroup(editBtn.dataset.groupId);
      }
      if (deleteBtn) {
        deleteOptionGroup(deleteBtn.dataset.groupId);
      }
    });
  }
  if (optionModal) {
    optionModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-options-close='true']")) {
        closeMenuOptionsManager();
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOptionManagerState.open) {
      closeMenuOptionsManager();
    }
  });

  // Change password form
  const passwordForm = document.getElementById("change-password-form");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const currentPass = document.getElementById("current-password").value;
      const newPass = document.getElementById("new-password").value;
      const confirmPass = document.getElementById("confirm-password").value;

      const result = await changePassword(currentPass, newPass, confirmPass);
      if (result.success) {
        showNotification(result.message, "success");
        passwordForm.reset();
      } else {
        showNotification(result.message, "error");
      }
    });
  }

  // Add admin access form
  const addAdminForm = document.getElementById("add-admin-form");
  if (addAdminForm) {
    addAdminForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const rawUserId = document.getElementById("admin-user-id").value.trim();
      const userId = rawUserId.replace(/\u0000/g, "");

      if (!userId || !isUuidLike(userId)) {
        showNotification("Please enter a valid Auth User ID.", "error");
        return;
      }

      try {
        await secureRequest(
          "/rest/v1/app_admins",
          "POST",
          { user_id: userId },
          { authRequired: true }
        );
        showNotification("Admin access granted.", "success");
        addAdminForm.reset();
      } catch (error) {
        console.error("Failed to add admin:", error);
        showNotification("Failed to grant admin access.", "error");
      }
    });
  }

  // Add buttons - ADDED CAROUSEL
  const addFeaturedBtn = document.getElementById("add-featured-btn");
  const addMenuBtn = document.getElementById("add-menu-btn");
  const addSpecialsBtn = document.getElementById("add-specials-btn");
  const addCarouselBtn = document.getElementById("add-carousel-btn"); // Added

  if (addFeaturedBtn) {
    addFeaturedBtn.addEventListener("click", () => {
      resetFeaturedForm();
      document.getElementById("featured-form-container").style.display =
        "block";
      document
        .getElementById("featured-form-container")
        .scrollIntoView({ behavior: "smooth" });
      Promise.resolve(
        prefillNextDisplayOrder("featured", "featured-display-order")
      ).catch(() => {});
    });
  }

  if (addMenuBtn) {
    addMenuBtn.addEventListener("click", () => {
      resetMenuForm();
      document.getElementById("menu-form-container").style.display = "block";
      document
        .getElementById("menu-form-container")
        .scrollIntoView({ behavior: "smooth" });
      Promise.resolve(prefillNextDisplayOrder("menu", "menu-display-order")).catch(
        () => {}
      );
    });
  }

  if (addSpecialsBtn) {
    addSpecialsBtn.addEventListener("click", () => {
      resetSpecialsForm();
      const formContainer = document.getElementById("specials-form-container");
      if (formContainer) {
        formContainer.style.display = "block";
        formContainer.scrollIntoView({ behavior: "smooth" });
      }
      Promise.resolve(
        prefillNextDisplayOrder("specials", "specials-display-order")
      ).catch(() => {});
    });
  }

  if (addCarouselBtn) {
    // Added
    addCarouselBtn.addEventListener("click", () => {
      resetCarouselForm();
      document.getElementById("carousel-form-container").style.display =
        "block";
      document
        .getElementById("carousel-form-container")
        .scrollIntoView({ behavior: "smooth" });
      Promise.resolve(
        prefillNextDisplayOrder("carousel", "carousel-display-order")
      ).catch(() => {});
    });
  }

  // Cancel buttons - ADDED CAROUSEL
  const cancelFeatured = document.getElementById("cancel-featured");
  const cancelMenu = document.getElementById("cancel-menu");
  const cancelSpecials = document.getElementById("cancel-specials");
  const cancelCarousel = document.getElementById("cancel-carousel"); // Added

  if (cancelFeatured) {
    cancelFeatured.addEventListener("click", resetFeaturedForm);
  }
  if (cancelMenu) {
    cancelMenu.addEventListener("click", resetMenuForm);
  }
  if (cancelSpecials) {
    cancelSpecials.addEventListener("click", resetSpecialsForm);
  }
  if (cancelCarousel) {
    // Added
    cancelCarousel.addEventListener("click", resetCarouselForm);
  }

  // Data management buttons
  const exportDataBtn = document.getElementById("export-data");
  const importDataBtn = document.getElementById("import-data");
  const resetDataBtn = document.getElementById("reset-data");
  const importFileInput = document.getElementById("import-file");

  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", exportData);
  }

  if (importDataBtn) {
    importDataBtn.addEventListener("click", () => {
      if (importFileInput) importFileInput.click();
    });
  }

  if (importFileInput) {
    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importData(file);
      }
      e.target.value = ""; // Reset file input
    });
  }

  if (resetDataBtn) {
    resetDataBtn.addEventListener("click", async () => {
      const confirmed = await showPopup({
        title: "Danger: Delete All Data",
        message:
          'This will PERMANENTLY delete ALL data. This action cannot be undone!\n\nTo confirm, please type "DELETE ALL" in the box below:',
        type: "error",
        showCancel: true,
        cancelText: "Cancel",
        confirmText: "Continue",
      });

      if (!confirmed) {
        return;
      }

      const confirmation = await showPopup({
        title: "Type Confirmation",
        message: 'Please type "DELETE ALL" to confirm deletion:',
        type: "warning",
        showInput: true,
        inputPlaceholder: "Type DELETE ALL here",
        showCancel: true,
        cancelText: "Cancel",
        confirmText: "Delete All",
      });

      if (confirmation !== "DELETE ALL") {
        showNotification("Deletion cancelled", "info");
        return;
      }

      try {
        const actionResult = await runAdminAction({
          actionKey: "reset-all-data",
          controls: [resetDataBtn],
          progressTitle: "Resetting all data",
          progressText: "Deleting existing records...",
          task: async (progress) => {
            const baselineVersion = (await fetchServerUpdateSignal()).contentVersion;
            await Promise.all([
              secureRequest(`${API_ENDPOINTS.FEATURED}?id=not.is.null`, "DELETE", null, {
                authRequired: true,
                suppressNotifications: true,
                timeout: 26000,
              }),
              secureRequest(`${API_ENDPOINTS.MENU}?id=not.is.null`, "DELETE", null, {
                authRequired: true,
                suppressNotifications: true,
                timeout: 26000,
              }),
              secureRequest(`${SPECIALS_ENDPOINT}?id=not.is.null`, "DELETE", null, {
                authRequired: true,
                suppressNotifications: true,
                timeout: 26000,
              }),
              secureRequest(`${API_ENDPOINTS.CAROUSEL}?id=not.is.null`, "DELETE", null, {
                authRequired: true,
                suppressNotifications: true,
                timeout: 26000,
              }),
            ]);

            setAdminCrudProgress(80, "Refreshing dashboard...");
            clearDataCache();
            markPublicContentCacheDirty();
            const contentVersion = await ensureContentVersionAfterWrite(
              baselineVersion,
              "all",
              true
            );

            await Promise.all([
              renderFeaturedItems(true),
              renderMenuItems(true),
              renderSpecialsItems(true),
              renderCarouselItems(true),
            ]);
            await populateFeaturedMenuSelect(null, true);
            await updateItemCounts();

            dataSync.notifyDataChanged("reset", "all", {
              contentVersion,
              forcedGlobalRefresh: true,
            });
            progress.complete("Reset complete");
            showNotification("All data has been reset!", "success");
          },
        });

        if (!actionResult.ok && !actionResult.skipped) {
          throw actionResult.error || new Error("Failed to reset data");
        }
      } catch (error) {
        console.error("Error resetting data:", error);
        showNotification("Failed to reset data", "error");
      }
    });
  }

  if (optionGroupForm) {
    resetOptionGroupForm();
  }
}

function setupPasswordVisibilityToggle(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;

  const icon = toggle.querySelector("i");

  const updateUi = () => {
    const isVisible = input.type === "text";
    toggle.setAttribute("aria-pressed", isVisible ? "true" : "false");
    toggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
    if (!icon) return;
    icon.classList.toggle("fa-eye", !isVisible);
    icon.classList.toggle("fa-eye-slash", isVisible);
  };

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    input.type = input.type === "password" ? "text" : "password";
    updateUi();
    try {
      input.focus({ preventScroll: true });
      const cursorPos = input.value.length;
      input.setSelectionRange(cursorPos, cursorPos);
    } catch {}
  });

  updateUi();
}

// Make functions available globally - ADDED CAROUSEL
window.AdminSession = {
  getSession: () => getStoredSession(),
  getAccessToken: async () => {
    const session = await ensureValidSession();
    return session?.access_token || null;
  },
  secureRequest,
};

window.editFeaturedItem = editFeaturedItem;
window.deleteFeaturedItem = deleteFeaturedItem;
window.editMenuItem = editMenuItem;
window.deleteMenuItem = deleteMenuItem;
window.openMenuOptionsManager = openMenuOptionsManager;
window.editOptionGroup = editOptionGroup;
window.deleteOptionGroup = deleteOptionGroup;
window.editSpecialsItem = editSpecialsItem;
window.deleteSpecialsItem = deleteSpecialsItem;
window.editCarouselItem = editCarouselItem; // Added
window.deleteCarouselItem = deleteCarouselItem; // Added

// Initialize when DOM is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminPanel);
} else {
  initAdminPanel();
}

/* ================== FINAL OPTIMIZATIONS ================== */

// Add connection status indicator
let connectionMonitorBound = false;
function setupConnectionMonitor() {
  if (connectionMonitorBound) return;
  connectionMonitorBound = true;

  window.addEventListener("online", () => {
    showNotification("Back online - sync active", "success");
  });

  window.addEventListener("offline", () => {
    showNotification("Offline - working locally", "warning");
  });
}

let adminErrorMonitorBound = false;
function setupAdminErrorMonitor() {
  if (adminErrorMonitorBound) return;
  adminErrorMonitorBound = true;

  window.addEventListener("error", (event) => {
    recordAdminError("window", event?.message || "Unhandled error", {
      file: event?.filename || "",
      line: event?.lineno || 0,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    recordAdminError(
      "promise",
      reason?.message || String(reason || "Unhandled promise rejection")
    );
  });
}

// Add to initAdminPanel
setupConnectionMonitor();
setupAdminErrorMonitor();

debugLog("Toke Bakes Admin Panel v2.1 - WITH CAROUSEL SUCCESS");


