/* ================== admin.js ================== */
/* Toke Bakes Admin Panel - MODERN CONFIRMATION DIALOG VERSION */
/* UPDATED WITH CAROUSEL FUNCTIONALITY */

/* ================== AUTO-UPDATE SYSTEM ================== */
class DataSyncManager {
  constructor() {
    this.lastUpdateKey = "toke_bakes_last_update";
    this.broadcastChannel = null;
    this.syncBus = null;
    this.destroyBound = false;
    this.init();
  }

  init() {
    if (window.TokeUpdateSync) {
      this.syncBus = window.TokeUpdateSync;
    } else if (typeof BroadcastChannel !== "undefined") {
      try {
        this.broadcastChannel = new BroadcastChannel("toke_bakes_data_updates");
      } catch (error) {
        this.broadcastChannel = null;
      }
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

  notifyDataChanged(operationType, itemType) {
    if (this.syncBus && typeof this.syncBus.publishDataUpdate === "function") {
      this.syncBus.publishDataUpdate(operationType, itemType, {
        source: "admin",
      });
      return;
    }

    const timestamp = Date.now().toString();
    localStorage.setItem(this.lastUpdateKey, timestamp);

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: "DATA_UPDATED",
        timestamp: timestamp,
        operation: operationType,
        itemType: itemType,
      });
    }

    // Same-tab fallback (BroadcastChannel does not fire in the same tab).
    try {
      window.dispatchEvent(
        new CustomEvent("toke:data-updated", {
          detail: {
            type: "DATA_UPDATED",
            timestamp,
            operation: operationType,
            itemType,
          },
        })
      );
    } catch {}
  }

  destroy() {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }
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

// Current admin state
let currentAdmin = null;
let isEditing = false;
let currentEditId = null;
let sessionTimeout = null;
let activityMonitoringAttached = false;
const SESSION_TIMEOUT_MINUTES = 30;

// Store for temporary image data
let tempImageCache = new Map();

// Storage buckets aligned with Supabase SQL
const STORAGE_BUCKETS = {
  featured: "featured-items",
  menu: "menu-items",
  gallery: "gallery",
  carousel: "hero-carousel",
};

const STORAGE_LIMITS_KB = {
  featured: 2000,
  menu: 2000,
  gallery: 5000,
  carousel: 5000,
};

const ITEM_TYPES = ["featured", "menu", "gallery", "carousel"];
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
const menuOptionManagerState = {
  menuItemId: "",
  menuItemTitle: "",
  groups: [],
  open: false,
  loading: false,
};

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
    gallery: API_ENDPOINTS.GALLERY,
    carousel: API_ENDPOINTS.CAROUSEL,
  };
  return endpoints[itemType] || null;
}

function getBucketForType(itemType) {
  const buckets = {
    featured: STORAGE_BUCKETS.featured,
    menu: STORAGE_BUCKETS.menu,
    gallery: STORAGE_BUCKETS.gallery,
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

  if (tabId === "gallery") {
    await renderGalleryItems();
    loadedAdminTabs.add(tabId);
    return;
  }

  if (tabId === "carousel") {
    await renderCarouselItems();
    loadedAdminTabs.add(tabId);
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
      loadAdminTabData("gallery"),
      loadAdminTabData("carousel"),
    ]).catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 350);
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
      if (itemDetails.type === "gallery") itemType = "Gallery Image";
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
              ? `<p><strong>Price:</strong> ₦${formatPrice(
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
  return Number(num).toLocaleString("en-NG");
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
    price_adjustment: Number(record.price_adjustment || 0),
  };
}

function formatOptionAdjustmentLabel(value) {
  const amount = Number(value || 0);
  if (amount === 0) return "No extra charge";
  const prefix = amount > 0 ? "+" : "-";
  return `${prefix}NGN ${formatPrice(Math.abs(amount))}`;
}

function removeItemFromUi(itemType, id) {
  if (!id) return;
  const selectorMap = {
    featured: `#featured-items-list [data-id="${id}"]`,
    menu: `#menu-items-list [data-id="${id}"]`,
    gallery: `#gallery-admin-grid [data-id="${id}"]`,
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
    if (itemType === "gallery") {
      return renderGalleryItems(forceRefresh);
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
    gallery: "Gallery image",
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
    if (itemType === "menu" && menuOptionManagerState.menuItemId === String(id)) {
      closeMenuOptionsManager();
    }

    const refreshPromise = refreshListAfterDelete(itemType, true);
    refreshPromise.catch((error) =>
      console.error(`Background refresh failed (${itemType}):`, error)
    );
    Promise.resolve(updateItemCounts()).catch((error) =>
      console.error("Update counts failed:", error)
    );

    dataSync.notifyDataChanged("delete", itemType);
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

async function deleteGalleryItem(id) {
  return deleteItemByType(id, "gallery");
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

// Escape HTML for safety
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
  gallery:
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

/* ================== CUSTOM POPUP SYSTEM ================== */

// Custom popup system to replace alert/confirm
function showPopup(options) {
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
    messageEl.textContent = message;
    popup.appendChild(messageEl);

    // Buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 0 2rem 2rem;
      justify-content: ${showCancel ? "space-between" : "center"};
    `;

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
        overlay.remove();
        onCancel();
        resolve(false);
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
      overlay.remove();
      onConfirm();
      resolve(true);
    });

    buttonsContainer.appendChild(confirmBtn);
    popup.appendChild(buttonsContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

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
          overlay.remove();
          onCancel();
          resolve(false);
        }
      }
    });
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
        "❌ Please select an image file (JPEG, PNG, WebP, etc.)",
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
        "❌ Please convert HEIC/TIFF/RAW images to JPEG or PNG first",
        "error"
      );
      reject(new Error("Unsupported image format"));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      // Increased to 10MB for food photography
      showNotification("❌ Image is too large! Maximum size is 10MB", "error");
      reject(new Error("Image must be less than 10MB"));
      return;
    }

    // Show compression started notification
    showNotification("🔄 Optimizing your image...", "info");

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
              "🔧 Adjusting quality for optimal file size...",
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
              successMessage = `✅ Amazing compression! ${originalKB}KB → ${compressedKB}KB (${savings}% saved)`;
            } else if (savings > 50) {
              successMessage = `✅ Great optimization! ${originalKB}KB → ${compressedKB}KB`;
            } else if (savings > 20) {
              successMessage = `✅ Image optimized to ${compressedKB}KB`;
            } else {
              successMessage = `✅ Image ready at ${compressedKB}KB (high quality preserved)`;
            }

            // Add format info
            successMessage += ` • ${compressionResult.format.toUpperCase()}`;

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
              `🍰 Food Image Compressed: ${originalKB}KB → ${compressedKB}KB (${savings}% saved) ` +
                `as ${compressionResult.format.toUpperCase()} at ${(
                  compressionResult.quality * 100
                ).toFixed(0)}% quality`
            );

            resolve(result);
          } catch (error) {
            // 6. PROCESSING ERROR WITH HELPFUL GUIDANCE
            showNotification(
              "❌ Failed to process image. Try a different format or smaller size.",
              "error"
            );
            console.error("Image processing failed:", error);
            reject(new Error(`Image processing failed: ${error.message}`));
          }
        });
      };

      img.onerror = () => {
        showNotification(
          "❌ Could not load image. The file may be corrupted.",
          "error"
        );
        reject(new Error("Failed to load image"));
      };

      img.src = event.target.result;
    };

    reader.onerror = () => {
      showNotification(
        "❌ Error reading file. Please try selecting the image again.",
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
      "ℹ️ Using standard format for maximum compatibility",
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

// ================== ENHANCED NOTIFICATION SYSTEM ==================

const notificationQueue = [];
let isShowingNotification = false;
let notificationTimeout = null;

/**
 * Advanced notification system with queuing, theming, and animations
 */
function showNotification(message, type = "success") {
  const notification = {
    id: Date.now() + Math.random(),
    message,
    type,
    timestamp: new Date(),
    priority: getNotificationPriority(type),
  };

  // Add to queue (sorted by priority)
  notificationQueue.push(notification);
  notificationQueue.sort((a, b) => b.priority - a.priority);

  if (!isShowingNotification) {
    processNextNotification();
  }
}

/**
 * Priority system: error > warning > info > success
 */
function getNotificationPriority(type) {
  const priorities = {
    error: 40,
    warning: 30,
    info: 20,
    success: 10,
  };
  return priorities[type] || 10;
}

function processNextNotification() {
  if (notificationQueue.length === 0) {
    isShowingNotification = false;
    return;
  }

  isShowingNotification = true;
  const notification = notificationQueue.shift();

  // Remove existing notification
  const existing = document.getElementById("admin-notification");
  if (existing) {
    existing.style.animation = "slideOutRight 0.3s ease-out forwards";
    setTimeout(() => existing.remove(), 300);

    // Small delay before showing next
    setTimeout(() => createNotification(notification), 350);
  } else {
    createNotification(notification);
  }
}

function createNotification(notification) {
  // Notification styling themes
  const themes = {
    success: {
      background: "linear-gradient(135deg, #4caf50, #2e7d32)",
      icon: "✅",
      border: "2px solid #2e7d32",
      iconBg: "rgba(76, 175, 80, 0.2)",
    },
    error: {
      background: "linear-gradient(135deg, #e64a4a, #c62828)",
      icon: "❌",
      border: "2px solid #c62828",
      iconBg: "rgba(230, 74, 74, 0.2)",
    },
    warning: {
      background: "linear-gradient(135deg, #ff9800, #ef6c00)",
      icon: "⚠️",
      border: "2px solid #ef6c00",
      iconBg: "rgba(255, 152, 0, 0.2)",
    },
    info: {
      background: "linear-gradient(135deg, #2196f3, #1565c0)",
      icon: "ℹ️",
      border: "2px solid #1565c0",
      iconBg: "rgba(33, 150, 243, 0.2)",
    },
  };

  const theme = themes[notification.type] || themes.success;

  // Create notification element
  const notificationEl = document.createElement("div");
  notificationEl.id = "admin-notification";
  notificationEl.className = `admin-notification admin-notification-${notification.type}`;

  // Icon container
  const iconEl = document.createElement("div");
  iconEl.className = "notification-icon";
  iconEl.textContent = theme.icon;
  iconEl.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: ${theme.iconBg};
    font-size: 1.2rem;
    flex-shrink: 0;
  `;

  // Message container
  const messageEl = document.createElement("div");
  messageEl.className = "notification-message";
  messageEl.textContent = notification.message;
  messageEl.style.cssText = `
    flex: 1;
    font-family: 'Poppins', sans-serif;
    font-size: 0.95rem;
    line-height: 1.4;
  `;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "notification-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Close notification");
  closeBtn.style.cssText = `
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: white;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
    margin-left: 10px;
  `;

  // Container
  const container = document.createElement("div");
  container.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  `;

  container.appendChild(iconEl);
  container.appendChild(messageEl);
  container.appendChild(closeBtn);
  notificationEl.appendChild(container);

  // Main notification styles
  notificationEl.style.cssText = `
    position: fixed;
    top: 25px;
    right: 25px;
    background: ${theme.background};
    color: white;
    padding: 1.2rem 1.5rem;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    animation: notificationSlideIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    max-width: 380px;
    min-width: 300px;
    cursor: pointer;
    font-family: 'Poppins', sans-serif;
    border: ${theme.border};
    backdrop-filter: blur(20px);
    transition: all 0.3s ease;
  `;

  // Add hover effect
  notificationEl.addEventListener("mouseenter", () => {
    notificationEl.style.transform = "translateY(-3px)";
    notificationEl.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.25)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.25)";
  });

  notificationEl.addEventListener("mouseleave", () => {
    notificationEl.style.transform = "translateY(0)";
    notificationEl.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.2)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.15)";
  });

  // Close button hover
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.transform = "scale(1.1)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.3)";
  });

  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.transform = "scale(1)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.15)";
  });

  // Close button click
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissNotification(notificationEl);
  });

  // Click anywhere to dismiss
  notificationEl.addEventListener("click", (e) => {
    if (!e.target.closest(".notification-close")) {
      dismissNotification(notificationEl);
    }
  });

  document.body.appendChild(notificationEl);

  // Auto-dismiss based on type
  const dismissTimes = {
    error: 6000, // Longer for errors (users need to read)
    warning: 5000, // Medium for warnings
    info: 4000, // Shorter for info
    success: 3000, // Shortest for success
  };

  notificationTimeout = setTimeout(() => {
    if (document.body.contains(notificationEl)) {
      dismissNotification(notificationEl);
    }
  }, dismissTimes[notification.type] || 3000);
}

function dismissNotification(notificationEl) {
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }

  notificationEl.style.animation =
    "notificationSlideOut 0.3s ease-out forwards";

  setTimeout(() => {
    if (document.body.contains(notificationEl)) {
      notificationEl.remove();
    }
    isShowingNotification = false;
    processNextNotification();
  }, 300);
}

// Add notification animations to the page
if (!document.querySelector("#notification-animations")) {
  const style = document.createElement("style");
  style.id = "notification-animations";
  style.textContent = `
    @keyframes notificationSlideIn {
      from {
        opacity: 0;
        transform: translateX(100%) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(0) translateY(0);
      }
    }

    @keyframes notificationSlideOut {
      from {
        opacity: 1;
        transform: translateX(0) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%) translateY(-20px);
      }
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      #admin-notification {
        top: 15px !important;
        right: 15px !important;
        left: 15px !important;
        max-width: none !important;
        min-width: auto !important;
      }
    }
  `;
  document.head.appendChild(style);
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
  if (!session) return null;
  return refreshSessionIfNeeded(session);
}

async function secureRequest(
  endpoint,
  method = "GET",
  data = null,
  options = {}
) {
  const {
    retries = 3,
    timeout = 10000,
    authRequired = false,
    headers: extraHeaders = {},
  } = options;

  if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
    throw new Error("Supabase configuration missing. Check config.js");
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

  if (data && (method === "POST" || method === "PATCH" || method === "PUT")) {
    baseHeaders["Content-Type"] = "application/json";
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const config = {
      method,
      headers: baseHeaders,
      signal: controller.signal,
      cache: "no-store",
    };

    if (data && (method === "POST" || method === "PATCH" || method === "PUT")) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${SUPABASE_CONFIG.URL}${endpoint}`, config);
      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") || 1;
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.text();

        if (response.status === 401) {
          showNotification(
            "Authentication failed. Please login again.",
            "error"
          );
          logoutAdmin();
          throw new Error("Authentication failed");
        }

        if (response.status === 403) {
          showNotification(
            "Permission denied. Please contact administrator.",
            "error"
          );
          throw new Error("Permission denied");
        }

        if (response.status === 413) {
          showNotification(
            "Image file is too large. Please use a smaller image.",
            "error"
          );
          throw new Error("File too large");
        }

        throw new Error(
          `HTTP ${response.status}: ${errorData.substring(0, 200)}`
        );
      }

      if (method === "DELETE" && response.status === 204) {
        return { success: true, message: "Item deleted successfully" };
      }

      if (response.status !== 204) {
        const result = await response.json();

        if (Array.isArray(result)) {
          result.forEach((item) => {
            const img = resolveRecordImage(item);
            if (img && item.id && tempImageCache.size < 50) {
              tempImageCache.set(item.id, img);
            }
          });
        } else {
          const img = resolveRecordImage(result);
          if (img && result.id && tempImageCache.size < 50) {
            tempImageCache.set(result.id, img);
          }
        }

        return result;
      }

      return { success: true };
    } catch (error) {
      clearTimeout(timeoutId);

      if (attempt === retries) {
        console.error("API request failed after retries:", error);

        if (error.name === "AbortError") {
          showNotification("Request timeout. Please try again.", "error");
        } else if (error.message.includes("Failed to fetch")) {
          showNotification(
            "Network error. Please check your connection.",
            "error"
          );
        } else if (error.message.includes("CORS")) {
          showNotification(
            "Cross-origin request blocked. Please check configuration.",
            "error"
          );
        } else {
          showNotification(`Operation failed: ${error.message}`, "error");
        }

        throw error;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
}

// Load data with caching
const dataCache = new Map();
const CACHE_TTL = 60000; // 1 minute
const ORDERING_MAP = {
  [API_ENDPOINTS.FEATURED]: "display_order.asc,created_at.desc",
  [API_ENDPOINTS.MENU]: "display_order.asc,created_at.desc",
  [API_ENDPOINTS.GALLERY]: "display_order.asc,created_at.desc",
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
    const cacheBuster = forceRefresh ? `&_=${Date.now()}` : "";
    const url = id
      ? `${endpoint}?id=eq.${id}&select=*${cacheBuster}`
      : `${endpoint}?select=*&order=${orderBy}${cacheBuster}`;

    const result = await secureRequest(url, "GET", null, {
      authRequired: true,
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
    console.error(`Error loading from ${endpoint}:`, error);

    // Return cached data if available (even if stale)
    if (dataCache.has(cacheKey)) {
      debugLog("Using cached data. Some information may be outdated.");
      return dataCache.get(cacheKey).data;
    }

    console.error("Failed to load data from cloud");
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
    if (window.API_ENDPOINTS?.GALLERY) {
      localStorage.removeItem(`${window.API_ENDPOINTS.GALLERY}_data`);
    }
    localStorage.removeItem("toke_bakes_menu_cache_v2");
    localStorage.removeItem("toke_bakes_menu_options_cache_v1");
    localStorage.removeItem("hero_carousel_data");
  } catch {}
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
    debugLog("🔐 Login attempt for:", email);

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
    debugLog("✅ Login successful!");
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
  resetGalleryForm();
  resetCarouselForm(); // Added
  closeMenuOptionsManager();

  debugLog("✅ Logged out successfully");
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
async function saveItem(itemType, formData) {
  try {
    const endpoints = {
      featured: API_ENDPOINTS.FEATURED,
      menu: API_ENDPOINTS.MENU,
      gallery: API_ENDPOINTS.GALLERY,
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
      gallery: ["alt", "image"],
      carousel: ["alt", "image"], // Added
    };

    const missingFields = requiredFields[itemType].filter((field) => {
      const value = formData[field];
      return value === undefined || value === null || value === "";
    });
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    // Sanitize text fields
    Object.keys(formData).forEach((key) => {
      if (typeof formData[key] === "string") {
        formData[key] = sanitizeInput(formData[key]);
      }
    });

    // Send to API
    if (isEditing && currentEditId) {
      await secureRequest(
        `${endpoint}?id=eq.${currentEditId}`,
        "PATCH",
        formData,
        { authRequired: true }
      );
      debugLog(`${itemType} item updated successfully!`);
    } else {
      await secureRequest(endpoint, "POST", formData, { authRequired: true });
      debugLog(`${itemType} item added successfully!`);
    }

    // Clear cache for this endpoint
    dataCache.forEach((value, key) => {
      if (key.startsWith(endpoint)) {
        dataCache.delete(key);
      }
    });
    markPublicContentCacheDirty();
    return { success: true };
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

  const title = document.getElementById("featured-title").value.trim();
  const description = document
    .getElementById("featured-description")
    .value.trim();
  const menuItemIdRaw = document.getElementById("featured-menu-item").value;
  const displayOrderInput = document.getElementById(
    "featured-display-order"
  ).value;
  const isActive = document.getElementById("featured-active").value === "true";
  const startDate = document.getElementById("featured-start-date").value;
  const endDate = document.getElementById("featured-end-date").value;
  const imageFile = document.getElementById("featured-image").files[0];
  const itemId = document.getElementById("featured-id").value;
  let upload = null;

  try {
    if (!title || title.length > 100) {
      showNotification("Title must be 1-100 characters", "error");
      return;
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      showNotification("End date must be after start date", "error");
      return;
    }

    let displayOrder;
    if (displayOrderInput === "" && !isEditing) {
      displayOrder = await getNextDisplayOrder(API_ENDPOINTS.FEATURED);
    } else {
      displayOrder = parseInt(displayOrderInput || "0", 10);
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 0) {
      showNotification("Display order must be 0 or higher", "error");
      return;
    }

    const existingUrl = isEditing && itemId ? tempImageCache.get(itemId) : "";
    upload = await processImageUpload(
      "featured",
      imageFile,
      existingUrl
    );

    const menuItemId = menuItemIdRaw ? String(menuItemIdRaw).trim() : "";

    const formData = {
      title,
      description,
      image: upload.url,
      menu_item_id: menuItemId || null,
      display_order: displayOrder,
      is_active: isActive,
      start_date: startDate || null,
      end_date: endDate || null,
    };

    const result = await saveItem("featured", formData);

    if (!result.success) {
      await rollbackUploadedImage(upload);
      showNotification(result.message || "Failed to save item", "error");
      return;
    }

    await finalizeImageReplacement(upload);
    resetFeaturedForm();
    await renderFeaturedItems(true);
    await updateItemCounts();
    showNotification("Featured item saved successfully!", "success");
    dataSync.notifyDataChanged(isEditing ? "update" : "create", "featured");
  } catch (error) {
    await rollbackUploadedImage(upload);
    console.error("Error saving featured item:", error);
    showNotification("Failed to save item", "error");
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

    if (!items || items.length === 0) {
      cacheItemsForType("menu", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>No menu items yet. Add your first item!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map((item) => {
        const imgSrc = resolveImageForDisplay(
          resolveRecordImage(item),
          ADMIN_IMAGE_PLACEHOLDERS.menu
        );
        return `
      <div class="item-card" data-id="${item.id}" data-item="${escapeHtml(
          item.title
        )}" data-price="${item.price}">
        <img src="${imgSrc}" alt="${
          item.title
        }" class="item-card-img" loading="lazy" decoding="async"
             onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.menu}';">
        <div class="item-card-content">
          <h3 class="item-card-title">${item.title}</h3>
          <p class="item-card-desc">${item.description}</p>
          <!-- Price is NOT displayed here, only stored in data attributes -->
          <div class="item-card-actions">
            <button class="btn-edit" onclick="editMenuItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-options" onclick="openMenuOptionsManager('${item.id}')">
              <i class="fas fa-sliders-h"></i> Options
            </button>
            <button class="btn-delete" onclick="deleteMenuItem('${item.id}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `;
      })
      .join("");
    cacheItemsForType("menu", items);
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

  const title = document.getElementById("menu-title").value.trim();
  const description = document.getElementById("menu-description").value.trim();
  const priceValue = Number(document.getElementById("menu-price").value);
  const category =
    document.getElementById("menu-category").value.trim() || "pastries";
  const tagsRaw = document.getElementById("menu-tags").value;
  const isAvailable = document.getElementById("menu-available").value === "true";
  const displayOrderInput = document.getElementById("menu-display-order").value;
  const caloriesInput = document.getElementById("menu-calories").value;
  const imageFile = document.getElementById("menu-image").files[0];
  const itemId = document.getElementById("menu-id").value;
  let upload = null;

  // Validation
  if (!title || title.length > 100) {
    showNotification("Title must be 1-100 characters", "error");
    return;
  }

  if (category.length > 50) {
    showNotification("Category must be 50 characters or fewer", "error");
    return;
  }

  if (
    Number.isNaN(priceValue) ||
    priceValue < 1 ||
    priceValue > 1000000
  ) {
    showNotification("Price must be between 1 and 1,000,000", "error");
    return;
  }

  try {
    let displayOrder;
    if (displayOrderInput === "" && !isEditing) {
      displayOrder = await getNextDisplayOrder(API_ENDPOINTS.MENU);
    } else {
      displayOrder = parseInt(displayOrderInput || "0", 10);
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 0) {
      showNotification("Display order must be 0 or higher", "error");
      return;
    }

    const calories =
      caloriesInput === "" ? null : parseInt(caloriesInput, 10);
    if (calories !== null && (!Number.isFinite(calories) || calories < 0)) {
      showNotification("Calories must be a positive number", "error");
      return;
    }

    const existingUrl = isEditing && itemId ? tempImageCache.get(itemId) : "";
    upload = await processImageUpload("menu", imageFile, existingUrl);

    const formData = {
      title,
      description,
      price: priceValue,
      image: upload.url,
      category,
      tags: parseTags(tagsRaw),
      is_available: isAvailable,
      display_order: displayOrder,
      calories,
    };

    const result = await saveItem("menu", formData);

    if (!result.success) {
      await rollbackUploadedImage(upload);
      showNotification(result.message || "Failed to save menu item", "error");
      return;
    }

    await finalizeImageReplacement(upload);
    resetMenuForm();
    await renderMenuItems(true);
    await populateFeaturedMenuSelect(null, true);
    await updateItemCounts();
    showNotification("Menu item saved successfully!", "success");
    dataSync.notifyDataChanged(isEditing ? "update" : "create", "menu");
  } catch (error) {
    await rollbackUploadedImage(upload);
    console.error("Error saving menu item:", error);
    showNotification("Failed to save menu item", "error");
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
  const priceAdjustment = Number(value.price_adjustment || 0);
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
    const price = Number(priceInput?.value || 0);

    if (!name) return;

    if (!Number.isFinite(price)) {
      throw new Error("Each option value must have a valid price adjustment.");
    }

    values.push({
      id: id || null,
      name,
      price_adjustment: price,
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

  setMenuOptionLoading(true, "Saving option group...");

  try {
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
        `${PRODUCT_OPTION_ENDPOINTS.groups}?id=eq.${encodeURIComponent(savedGroupId)}`,
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
        price_adjustment: Number(value.price_adjustment || 0),
      };
      if (value.id) {
        incomingIds.add(String(value.id));
        await secureRequest(
          `${PRODUCT_OPTION_ENDPOINTS.values}?id=eq.${encodeURIComponent(value.id)}`,
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

    const deleteIds = Array.from(existingIds).filter((id) => !incomingIds.has(id));
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
    dataSync.notifyDataChanged(groupId ? "update" : "create", "menu");
    showNotification("Option group saved successfully!", "success");

    resetOptionGroupForm();
    await loadMenuOptionGroups(true);
  } catch (error) {
    console.error("Failed to save option group:", error);
    showNotification("Failed to save option group. Data reloaded.", "error");
    await loadMenuOptionGroups(true);
  } finally {
    setMenuOptionLoading(false);
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

  try {
    await secureRequest(
      `${PRODUCT_OPTION_ENDPOINTS.groups}?id=eq.${encodeURIComponent(id)}`,
      "DELETE",
      null,
      { authRequired: true }
    );

    invalidateEndpointCache(PRODUCT_OPTION_ENDPOINTS.groups);
    invalidateEndpointCache(PRODUCT_OPTION_ENDPOINTS.values);
    markPublicContentCacheDirty();
    dataSync.notifyDataChanged("delete", "menu");
    showNotification("Option group deleted.", "success");

    if (getMenuOptionManagerElements().groupId.value === id) {
      resetOptionGroupForm();
    }
    await loadMenuOptionGroups(true);
  } catch (error) {
    console.error("Failed to delete option group:", error);
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

// Gallery Management
async function renderGalleryItems(forceRefresh = false) {
  const container = document.getElementById("gallery-admin-grid");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(
      API_ENDPOINTS.GALLERY,
      null,
      forceRefresh
    );

    if (!items || items.length === 0) {
      cacheItemsForType("gallery", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>No gallery images yet. Add your first image!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map((item) => {
        const imgSrc = resolveImageForDisplay(
          resolveRecordImage(item),
          ADMIN_IMAGE_PLACEHOLDERS.gallery
        );
        return `
      <div class="gallery-admin-item" data-id="${item.id}">
        <img src="${imgSrc}" alt="${item.alt}" loading="lazy" decoding="async"
             onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.gallery}';">
        <div class="gallery-admin-overlay">
          <p><strong>Alt Text:</strong> ${item.alt}</p>
          <p><strong>Order:</strong> ${item.display_order ?? 0}</p>
          <div class="gallery-admin-actions">
            <button class="btn-edit" onclick="editGalleryItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteGalleryItem('${item.id}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `;
      })
      .join("");
    cacheItemsForType("gallery", items);
  } catch (error) {
    console.error(`Error rendering gallery items:`, error);
    cacheItemsForType("gallery", []);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load gallery items. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveGalleryItem(e) {
  e.preventDefault();

  const alt = document.getElementById("gallery-alt").value.trim();
  const displayOrderInput = document.getElementById(
    "gallery-display-order"
  ).value;
  const imageFile = document.getElementById("gallery-image").files[0];
  const itemId = document.getElementById("gallery-id").value;
  let upload = null;

  try {
    if (!alt || alt.length > 255) {
      showNotification("Alt text must be 1-255 characters", "error");
      return;
    }

    let displayOrder;
    if (displayOrderInput === "" && !isEditing) {
      displayOrder = await getNextDisplayOrder(API_ENDPOINTS.GALLERY);
    } else {
      displayOrder = parseInt(displayOrderInput || "0", 10);
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 0) {
      showNotification("Display order must be 0 or higher", "error");
      return;
    }

    const existingUrl = isEditing && itemId ? tempImageCache.get(itemId) : "";
    upload = await processImageUpload("gallery", imageFile, existingUrl);

    const formData = {
      alt,
      image: upload.url,
      display_order: displayOrder,
    };

    if (upload.meta) {
      formData.width = upload.meta.width || null;
      formData.height = upload.meta.height || null;
      formData.file_size = upload.meta.size || null;
    }

    const result = await saveItem("gallery", formData);

    if (!result.success) {
      await rollbackUploadedImage(upload);
      showNotification(result.message || "Failed to save gallery image", "error");
      return;
    }

    await finalizeImageReplacement(upload);
    resetGalleryForm();
    await renderGalleryItems(true);
    await updateItemCounts();
    showNotification("Gallery image saved successfully!", "success");
    dataSync.notifyDataChanged(isEditing ? "update" : "create", "gallery");
  } catch (error) {
    await rollbackUploadedImage(upload);
    console.error("Error saving gallery item:", error);
    showNotification("Failed to save gallery item", "error");
  }
}

async function editGalleryItem(id) {
  try {
    const item = await getEditableItem("gallery", id);

    if (!item) {
      showNotification("Gallery item not found", "error");
      return;
    }

    document.getElementById("gallery-id").value = item.id;
    document.getElementById("gallery-alt").value = item.alt;
    document.getElementById("gallery-display-order").value =
      item.display_order ?? 0;

    const preview = document.getElementById("gallery-image-preview");
    preview.innerHTML = `<img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.gallery)}" alt="Current image" style="max-height: 150px; border-radius: 8px;" decoding="async"
      onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.gallery}';">`;

    document.getElementById("gallery-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    document
      .getElementById("gallery-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading gallery item for edit:", error);
    showNotification("Failed to load gallery item for editing", "error");
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

    if (!items || items.length === 0) {
      cacheItemsForType("carousel", []);
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>No carousel images yet. Add your first background image!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map((item, index) => {
        const orderLabel = Number.isFinite(item.display_order)
          ? item.display_order
          : index + 1;

        return `
      <div class="carousel-admin-item" data-id="${item.id}">
        <div class="carousel-slide-badge ${
          item.is_active ? "active" : "inactive"
        }">
          <i class="fas fa-${
            item.is_active ? "check-circle" : "pause-circle"
          }"></i>
          ${item.is_active ? "Active" : "Inactive"}
        </div>
        <div class="carousel-slide-number">${orderLabel}</div>
        <img src="${resolveImageForDisplay(resolveRecordImage(item), ADMIN_IMAGE_PLACEHOLDERS.carousel)}" alt="${item.alt}" loading="lazy" decoding="async"
             onerror="this.onerror=null; this.src='${ADMIN_IMAGE_PLACEHOLDERS.carousel}';">
        <div class="carousel-admin-overlay">
          <p><strong>Alt Text:</strong> ${item.alt}</p>
          <p><strong>Order:</strong> ${item.display_order || 0}</p>
          <div class="carousel-admin-actions">
            <button class="btn-edit" onclick="editCarouselItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteCarouselItem('${
              item.id
            }')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `;
      })
      .join("");
    cacheItemsForType("carousel", items);
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

  const alt = document.getElementById("carousel-alt").value.trim();
  const title = document.getElementById("carousel-title").value.trim();
  const subtitle = document.getElementById("carousel-subtitle").value.trim();
  const ctaText = document.getElementById("carousel-cta-text").value.trim();
  const ctaLink = document.getElementById("carousel-cta-link").value.trim();
  const displayOrderInput = document.getElementById(
    "carousel-display-order"
  ).value;
  const isActive = document.getElementById("carousel-active").value === "true";
  const imageFile = document.getElementById("carousel-image").files[0];
  const itemId = document.getElementById("carousel-id").value;
  let upload = null;

  try {
    if (!alt || alt.length > 255) {
      showNotification("Alt text must be 1-255 characters", "error");
      return;
    }

    if (title && title.length > 100) {
      showNotification("Title must be 100 characters or fewer", "error");
      return;
    }

    if (ctaText && ctaText.length > 50) {
      showNotification("CTA text must be 50 characters or fewer", "error");
      return;
    }

    if (ctaLink && ctaLink.length > 255) {
      showNotification("CTA link must be 255 characters or fewer", "error");
      return;
    }

    let displayOrder;
    if (displayOrderInput === "" && !isEditing) {
      displayOrder = await getNextDisplayOrder(API_ENDPOINTS.CAROUSEL);
    } else {
      displayOrder = parseInt(displayOrderInput || "0", 10);
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 0) {
      showNotification("Display order must be 0 or higher", "error");
      return;
    }

    if (ctaLink) {
      try {
        new URL(ctaLink, window.location.origin);
      } catch (error) {
        showNotification("CTA link must be a valid URL or path", "error");
        return;
      }
    }

    const existingUrl = isEditing && itemId ? tempImageCache.get(itemId) : "";
    upload = await processImageUpload(
      "carousel",
      imageFile,
      existingUrl
    );

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

    const result = await saveItem("carousel", formData);

    if (!result.success) {
      await rollbackUploadedImage(upload);
      showNotification(result.message || "Failed to save carousel image", "error");
      return;
    }

    await finalizeImageReplacement(upload);
    resetCarouselForm();
    await renderCarouselItems(true);
    await updateItemCounts();
    showNotification("Carousel image saved successfully!", "success");
    dataSync.notifyDataChanged(isEditing ? "update" : "create", "carousel");
  } catch (error) {
    await rollbackUploadedImage(upload);
    console.error("Error saving carousel item:", error);
    showNotification("Failed to save carousel item", "error");
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
    const [featured, menu, gallery, carousel] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(API_ENDPOINTS.GALLERY),
      loadDataFromSupabase(API_ENDPOINTS.CAROUSEL), // Added carousel
    ]);

    const allItems = [...featured, ...menu, ...gallery, ...carousel];
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
    const [featured, menu, gallery, carousel] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(API_ENDPOINTS.GALLERY),
      loadDataFromSupabase(API_ENDPOINTS.CAROUSEL), // Added carousel
    ]);

    const countFeatured = document.getElementById("count-featured");
    const countMenu = document.getElementById("count-menu");
    const countGallery = document.getElementById("count-gallery");
    const countCarousel = document.getElementById("count-carousel");

    if (countFeatured) countFeatured.textContent = featured.length || 0;
    if (countMenu) countMenu.textContent = menu.length || 0;
    if (countGallery) countGallery.textContent = gallery.length || 0;
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

    const [featured, menu, gallery, carousel] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(API_ENDPOINTS.GALLERY),
      loadDataFromSupabase(API_ENDPOINTS.CAROUSEL), // Added carousel
    ]);

    const data = {
      featured,
      menu,
      gallery,
      carousel, // Added carousel
      exportDate: new Date().toISOString(),
      version: "2.1.0", // Updated version
      source: "Toke Bakes CMS",
      itemCount: {
        featured: featured.length,
        menu: menu.length,
        gallery: gallery.length,
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
    if (!data.featured || !data.menu || !data.gallery || !data.carousel) {
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

    showNotification("Starting import...", "info");

    // Clear existing data - UPDATED WITH CAROUSEL
    await Promise.all([
      secureRequest(`${API_ENDPOINTS.FEATURED}?id=gt.0`, "DELETE", null, {
        authRequired: true,
      }),
      secureRequest(`${API_ENDPOINTS.MENU}?id=gt.0`, "DELETE", null, {
        authRequired: true,
      }),
      secureRequest(`${API_ENDPOINTS.GALLERY}?id=gt.0`, "DELETE", null, {
        authRequired: true,
      }),
      secureRequest(`${API_ENDPOINTS.CAROUSEL}?id=gt.0`, "DELETE", null, {
        authRequired: true,
      }), // Added carousel
    ]);

    // Import new data
    const totalItems =
      data.featured.length +
      data.menu.length +
      data.gallery.length +
      data.carousel.length; // Added carousel
    let imported = 0;

    // Import batches
    const importBatch = async (items, endpoint) => {
      for (const item of items) {
        await secureRequest(endpoint, "POST", item, { authRequired: true });
        imported++;

        // Small delay to prevent rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    await importBatch(data.featured, API_ENDPOINTS.FEATURED);
    await importBatch(data.menu, API_ENDPOINTS.MENU);
    await importBatch(data.gallery, API_ENDPOINTS.GALLERY);
    await importBatch(data.carousel, API_ENDPOINTS.CAROUSEL); // Added carousel

    // Cleanup
    clearDataCache();
    markPublicContentCacheDirty();

    showNotification(`Successfully imported ${imported} items!`, "success");

    // Refresh displays - UPDATED WITH CAROUSEL
    await Promise.all([
      renderFeaturedItems(true),
      renderMenuItems(true),
      renderGalleryItems(true),
      renderCarouselItems(true), // Added carousel
    ]);
    await populateFeaturedMenuSelect(null, true);
    await updateItemCounts();

    dataSync.notifyDataChanged("import", "all");
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
  document.getElementById("featured-image-preview").innerHTML = "";
  document.getElementById("featured-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetMenuForm() {
  const form = document.getElementById("menu-form");
  if (form) form.reset();
  document.getElementById("menu-id").value = "";
  document.getElementById("menu-image-preview").innerHTML = "";
  document.getElementById("menu-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetGalleryForm() {
  const form = document.getElementById("gallery-form");
  if (form) form.reset();
  document.getElementById("gallery-id").value = "";
  document.getElementById("gallery-image-preview").innerHTML = "";
  document.getElementById("gallery-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetCarouselForm() {
  const form = document.getElementById("carousel-form");
  if (form) form.reset();
  document.getElementById("carousel-id").value = "";
  document.getElementById("carousel-display-order").value = "0";
  document.getElementById("carousel-active").value = "true";
  document.getElementById("carousel-image-preview").innerHTML = "";
  document.getElementById("carousel-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

/* ================== FIXED INITIALIZATION ================== */

async function initAdminPanel() {
  debugLog("🔧 Initializing Admin Panel v2.1 (WITH CAROUSEL)...");

  // 🔒 Admin session will be validated after login

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
      debugLog("✅ Restored existing session");
    } else {
      clearSession();
      debugLog("❌ Session is not authorized");
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
  const yearElement = document.getElementById("admin-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Setup event listeners
  setupEventListeners();

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

function setupEventListeners() {
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
      resetGalleryForm();
      resetCarouselForm();
      closeMenuOptionsManager();
    });
  });

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

      debugLog("Attempting login with:", email);

      const isValid = await checkLogin(email, password);
      if (isValid) {
        currentAdmin = email;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("admin-dashboard").style.display = "block";
        showNotification(`Welcome back, ${email}!`, "success");

        resetLoadedTabs();
        await loadAdminTabData("featured", true);
        await updateItemCounts();
        preloadAdminTabsInBackground();
      } else {
        showNotification("Invalid email or password", "error");
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
  const galleryForm = document.getElementById("gallery-form");
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
  if (galleryForm) {
    galleryForm.addEventListener("submit", saveGalleryItem);
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
      const userId = document.getElementById("admin-user-id").value.trim();

      if (!userId) {
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
  const addGalleryBtn = document.getElementById("add-gallery-btn");
  const addCarouselBtn = document.getElementById("add-carousel-btn"); // Added

  if (addFeaturedBtn) {
    addFeaturedBtn.addEventListener("click", () => {
      resetFeaturedForm();
      document.getElementById("featured-form-container").style.display =
        "block";
      document
        .getElementById("featured-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });
  }

  if (addMenuBtn) {
    addMenuBtn.addEventListener("click", () => {
      resetMenuForm();
      document.getElementById("menu-form-container").style.display = "block";
      document
        .getElementById("menu-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });
  }

  if (addGalleryBtn) {
    addGalleryBtn.addEventListener("click", () => {
      resetGalleryForm();
      document.getElementById("gallery-form-container").style.display = "block";
      document
        .getElementById("gallery-form-container")
        .scrollIntoView({ behavior: "smooth" });
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
    });
  }

  // Cancel buttons - ADDED CAROUSEL
  const cancelFeatured = document.getElementById("cancel-featured");
  const cancelMenu = document.getElementById("cancel-menu");
  const cancelGallery = document.getElementById("cancel-gallery");
  const cancelCarousel = document.getElementById("cancel-carousel"); // Added

  if (cancelFeatured) {
    cancelFeatured.addEventListener("click", resetFeaturedForm);
  }
  if (cancelMenu) {
    cancelMenu.addEventListener("click", resetMenuForm);
  }
  if (cancelGallery) {
    cancelGallery.addEventListener("click", resetGalleryForm);
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
        showNotification("Resetting data...", "info");

        // UPDATED WITH CAROUSEL
        await Promise.all([
          secureRequest(`${API_ENDPOINTS.FEATURED}?id=gt.0`, "DELETE", null, {
            authRequired: true,
          }),
          secureRequest(`${API_ENDPOINTS.MENU}?id=gt.0`, "DELETE", null, {
            authRequired: true,
          }),
          secureRequest(`${API_ENDPOINTS.GALLERY}?id=gt.0`, "DELETE", null, {
            authRequired: true,
          }),
          secureRequest(`${API_ENDPOINTS.CAROUSEL}?id=gt.0`, "DELETE", null, {
            authRequired: true,
          }), // Added carousel
        ]);

        clearDataCache();
        markPublicContentCacheDirty();
        showNotification("All data has been reset!", "success");

        // UPDATED WITH CAROUSEL
        await Promise.all([
          renderFeaturedItems(true),
          renderMenuItems(true),
          renderGalleryItems(true),
          renderCarouselItems(true), // Added carousel
        ]);
        await populateFeaturedMenuSelect(null, true);
        await updateItemCounts();

        dataSync.notifyDataChanged("reset", "all");
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
window.editGalleryItem = editGalleryItem;
window.deleteGalleryItem = deleteGalleryItem;
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
function setupConnectionMonitor() {
  window.addEventListener("online", () => {
    showNotification("✅ Back online - Sync active", "success");
  });

  window.addEventListener("offline", () => {
    showNotification("⚠️ Offline - Working locally", "warning");
  });
}

// Add to initAdminPanel
setupConnectionMonitor();

debugLog("✅ Toke Bakes Admin Panel v2.1 - WITH CAROUSEL SUCCESS");

