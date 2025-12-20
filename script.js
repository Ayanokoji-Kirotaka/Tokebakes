/* ================== EMERGENCY PATCH - PREVENT ERRORS ================== */
// These functions were removed but might still be called
if (typeof initFooterTheme === 'undefined') {
  window.initFooterTheme = function() { /* Function removed */ };
}

if (typeof updateFooterTheme === 'undefined') {
  window.updateFooterTheme = function() { /* Function removed */ };
}

if (typeof initThemeToggle === 'undefined') {
  window.initThemeToggle = function() { /* Function removed - handled by theme-manager.js */ };
}
/* ================== END PATCH ================== */
/* ================== script.js - TOKE BAKES WEBSITE ================== */

/* ================== ENHANCED AUTO-UPDATE SYSTEM ================== */
class WebsiteAutoUpdater {
  constructor() {
    this.lastUpdateKey = "toke_bakes_last_update";
    this.broadcastChannel = null;
    this.pollingInterval = null;
    this.init();
  }

  init() {
    console.log("🔧 Initializing Enhanced WebsiteAutoUpdater...");

    // 1. Setup BroadcastChannel for instant sync (same browser tabs)
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel("toke_bakes_data_updates");
      this.broadcastChannel.onmessage = (event) => {
        if (event.data.type === "DATA_UPDATED") {
          console.log("📡 BroadcastChannel update received!", event.data);
          this.refreshDataWithUI();
        }
      };
      console.log("✅ BroadcastChannel ready for instant sync");
    }

    // 2. Check for updates every 25 seconds
    this.startPolling(25000); // 25 seconds

    // 3. Check when user returns to tab
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        console.log("👁️ Tab became visible, checking for updates...");
        this.checkForUpdates();
      }
    });

    // 4. Initial check on page load
    setTimeout(() => this.checkForUpdates(), 3000);
  }

  startPolling(interval = 25000) {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => {
      this.checkForUpdates();
    }, interval);
    console.log(`✅ Polling started (every ${interval / 1000}s)`);
  }

  async checkForUpdates() {
    const lastUpdate = localStorage.getItem(this.lastUpdateKey);
    const myLastCheck = localStorage.getItem("my_last_check") || "0";

    if (lastUpdate && lastUpdate > myLastCheck) {
      console.log("🔄 Update detected via localStorage/timestamp");
      localStorage.setItem("my_last_check", lastUpdate);
      await this.refreshDataWithUI();
      return true;
    }
    return false;
  }

  async refreshDataWithUI() {
    // Show syncing indicator
    this.showSyncIndicator("syncing");

    try {
      console.log("🔄 Refreshing website data...");

      // Clear ALL caches aggressively
      if (window.cachedMenuItems) {
        window.cachedMenuItems = null;
        window.cacheTimestamp = null;
      }

      // Clear dataCache if it exists (from admin.js)
      if (window.dataCache && window.dataCache.clear) {
        window.dataCache.clear();
      }

      // Reload content based on current page
      if (typeof loadDynamicContent === "function") {
        await loadDynamicContent();
        console.log("✅ Dynamic content reloaded");
      }

      // Also refresh cart if on order page
      if (
        window.location.pathname.includes("order") &&
        typeof renderCartOnOrderPage === "function"
      ) {
        await renderCartOnOrderPage(true);
        console.log("✅ Cart refreshed");
      }

      // Show success indicator
      this.showSyncIndicator("updated");

      // Show notification
      this.showUpdateNotification();

      // Hide indicator after 2 seconds
      setTimeout(() => {
        this.hideSyncIndicator();
      }, 2000);
    } catch (error) {
      console.error("❌ Sync refresh failed:", error);
      this.hideSyncIndicator();

      // Show error state briefly
      this.showSyncIndicator("error");
      setTimeout(() => this.hideSyncIndicator(), 3000);
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

    // Reset classes
    indicator.className = "";

    // Set state
    if (state === "syncing") {
      indicator.classList.add("syncing");
      indicator.innerHTML = "⟳";
      indicator.title = "Updating content...";
    } else if (state === "updated") {
      indicator.classList.add("updated");
      indicator.innerHTML = "✓";
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
    const indicator = document.getElementById("sync-status-indicator");
    if (indicator) {
      indicator.style.display = "none";
      indicator.className = "";
    }
  }

  showUpdateNotification() {
    // Optional: You can enable this for visual toast
    // For now, just log to console
    console.log("✅ Website content updated successfully!");

    // If you want a toast notification later, uncomment:
    /*
    showNotification('Content updated! New items are available.', 'success');
    */
  }
}

// ================== DATA SOURCE CONFIGURATION ==================

const useSupabase = true; // Always use Supabase

// ================== DATA LOADING FUNCTIONS ==================

// Cache for menu items to reduce API calls
let cachedMenuItems = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load from Supabase
async function loadFromSupabase(endpoint) {
  try {
    // Check if Supabase config is available
    if (
      !window.SUPABASE_CONFIG ||
      !window.SUPABASE_CONFIG.URL ||
      !window.SUPABASE_CONFIG.ANON_KEY
    ) {
      console.error("Supabase configuration not found in script.js");
      return [];
    }

    const response = await fetch(
      `${SUPABASE_CONFIG.URL}${endpoint}?select=*&order=created_at.desc`,
      {
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          "Content-Type": "application/json",
        },
        cache: "no-cache",
      }
    );

    if (!response.ok) {
      console.warn(`Failed to load from ${endpoint}:`, response.status);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Error loading from Supabase ${endpoint}:`, error);
    return [];
  }
}

// Get menu items with caching
async function getMenuItems() {
  const now = Date.now();

  if (
    cachedMenuItems &&
    cacheTimestamp &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    return cachedMenuItems;
  }

  cachedMenuItems = await loadFromSupabase(API_ENDPOINTS.MENU);
  cacheTimestamp = now;
  return cachedMenuItems;
}

// ================== LOAD FEATURED ITEMS - IMPROVED VERSION ==================
async function loadFeaturedItems() {
  const container = document.getElementById("featured-container");
  if (!container) return;

  // Show loading state immediately
  container.innerHTML = `
    <div class="loading-message">
      <div class="loading-spinner"></div>
      <p>Loading featured creations...</p>
    </div>
  `;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.FEATURED);

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

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <article class="featured-item">
            <img src="${item.image}" alt="${item.title}" loading="lazy"
                 onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg==';">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.description)}</p>
          </article>
        `
      )
      .join("");
  } catch (error) {
    console.error("Error loading featured items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load featured items.</p>
        <p class="small">Please check your connection</p>
      </div>
    `;
  }
}

// ================== LOAD MENU ITEMS - IMPROVED VERSION ==================
async function loadMenuItems() {
  const container = document.getElementById("menu-container");
  if (!container) return;

  // Show loading state immediately
  container.innerHTML = `
    <div class="loading-message">
      <div class="loading-spinner"></div>
      <p>Loading menu items...</p>
    </div>
  `;

  try {
    const items = await getMenuItems();

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

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <div class="menu-item" data-item="${escapeHtml(
            item.title
          )}" data-price="${item.price}" data-id="${item.id || ""}">
            <img src="${item.image}" alt="${
          item.title
        }" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lbnUgSXRlbTwvdGV4dD48L3N2Zz4='">
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
  } catch (error) {
    console.error("Error loading menu items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load menu.</p>
        <p class="small">Please try again later</p>
      </div>
    `;
  }
}

// ================== LOAD GALLERY IMAGES - IMPROVED VERSION ==================
async function loadGalleryImages() {
  const container = document.getElementById("gallery-container");
  if (!container) return;

  // Show loading state immediately
  container.innerHTML = `
    <div class="loading-message">
      <div class="loading-spinner"></div>
      <p>Loading gallery images...</p>
    </div>
  `;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.GALLERY);

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

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <img src="${item.image}" alt="${item.alt}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkdhbGxlcnk8L3RleHQ+PC9zdmc+='">
        `
      )
      .join("");
  } catch (error) {
    console.error("Error loading gallery images:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load gallery.</p>
        <p class="small">Please check your connection</p>
      </div>
    `;
  }
}

// ================== LOAD DYNAMIC CONTENT - IMPROVED VERSION ==================
async function loadDynamicContent(forceReload = false) {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  console.log("📱 Loading content for page:", currentPage);

  // Clear any existing loading states FIRST
  clearLoadingStates();

  // Check if Supabase config exists
  if (!window.SUPABASE_CONFIG || !window.API_ENDPOINTS) {
    console.error("Supabase configuration not loaded");
    showConfigError();
    return;
  }

  if (
    currentPage.includes("index") ||
    currentPage === "" ||
    currentPage === "/" ||
    currentPage === "index.html"
  ) {
    console.log("🔍 Loading featured items for homepage");
    await loadFeaturedItems();
  } else if (currentPage.includes("menu")) {
    console.log("🔍 Loading menu items");
    await loadMenuItems();
  } else if (currentPage.includes("gallery")) {
    console.log("🔍 Loading gallery images");
    await loadGalleryImages();
  }

  console.log("✅ Content loading complete for:", currentPage);
}

// ================== HELPER FUNCTIONS ==================
function clearLoadingStates() {
  console.log("🧹 Clearing loading states");

  const containers = [
    "featured-container",
    "menu-container",
    "gallery-container",
  ];

  containers.forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      // Only clear if it exists on this page
      console.log(`Found container: ${containerId}`);
    }
  });
}

function showConfigError() {
  const containers = document.querySelectorAll(
    "#featured-container, #menu-container, #gallery-container"
  );
  containers.forEach((container) => {
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

// ================== ORIGINAL TOKE BAKES CODE ==================

const currentPage = (() => {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
})();

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
}

function formatPrice(num) {
  return Number(num).toLocaleString("en-NG");
}

// Escape HTML for security (already defined in admin.js, but defined here too)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ================== CART VALIDATION FUNCTIONS ================== */

// NEW: Validate cart items against current menu
async function validateCartItems() {
  try {
    const cart = readCart();
    if (cart.length === 0) return { valid: true, items: [] };

    // Load current menu items using cache
    const currentMenu = await getMenuItems();

    const validationResults = [];
    let hasChanges = false;
    let hasRemovals = false;

    // Check each item in cart
    cart.forEach((cartItem, index) => {
      const currentItem = currentMenu.find(
        (item) => item.title === cartItem.name || item.id === cartItem.id
      );

      if (!currentItem) {
        // Item no longer exists in menu
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
      } else if (currentItem.price !== cartItem.price) {
        // Price has changed
        validationResults.push({
          index,
          name: cartItem.name,
          status: "price_changed",
          message: `Price updated from ₦${formatPrice(
            cartItem.price
          )} to ₦${formatPrice(currentItem.price)}`,
          oldPrice: cartItem.price,
          newPrice: currentItem.price,
        });
        hasChanges = true;
      } else if (currentItem.image !== cartItem.image) {
        // Image has changed (optional check)
        validationResults.push({
          index,
          name: cartItem.name,
          status: "updated",
          message: "This item has been updated",
          oldPrice: cartItem.price,
          newPrice: currentItem.price,
        });
        hasChanges = true;
      } else {
        // Item is still valid
        validationResults.push({
          index,
          name: cartItem.name,
          status: "valid",
          message: null,
          oldPrice: cartItem.price,
          newPrice: currentItem.price,
        });
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

// NEW: Update cart with validated prices
function updateCartWithValidation(validationResults) {
  const cart = readCart();
  let updatedCart = [...cart];
  let changesMade = false;

  validationResults.forEach((result) => {
    if (result.status === "price_changed" && result.newPrice !== null) {
      // Update price in cart
      updatedCart[result.index].price = result.newPrice;
      changesMade = true;
    } else if (result.status === "removed") {
      // Mark item as unavailable (we'll handle display separately)
      updatedCart[result.index].unavailable = true;
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

/* ================== Old LOADER ================== */
// window.addEventListener("load", () => {
//   const loader = document.getElementById("loader");
//   if (loader) {
//     setTimeout(() => {
//       loader.style.opacity = "0";
//       setTimeout(() => (loader.style.display = "none"), 600);
//     }, 600);
//   }
// });

/* ================== ENHANCED SESSION AWARE LOADER ================== */
(function () {
  const loader = document.getElementById("loader");
  if (!loader) return;

  const isHomePage =
    window.location.pathname.endsWith("/") ||
    window.location.pathname.endsWith("/index.html") ||
    window.location.pathname === "";

  if (!isHomePage) {
    loader.style.display = "none";
    return;
  }

  // Session tracking (more intelligent than daily)
  const SESSION_KEY = "toke_bakes_session";
  const sessionData = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
  const now = Date.now();
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  // Check if user is in an active "session"
  const hasActiveSession =
    sessionData.timestamp && now - sessionData.timestamp < SESSION_TIMEOUT;

  if (hasActiveSession) {
    // User is in active session (visited within 30 minutes)
    loader.style.display = "none";
    console.log("🔁 Active session - seamless experience");
  } else {
    // New session or session expired
    sessionData.timestamp = now;
    sessionData.visitCount = (sessionData.visitCount || 0) + 1;
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));

    // Show loader on first 2 visits, then never again
    if (sessionData.visitCount <= 2) {
      window.addEventListener("load", () => {
        // Shorter loader on second visit
        const duration = sessionData.visitCount === 1 ? 1200 : 600;

        setTimeout(() => {
          loader.style.opacity = "0";
          setTimeout(() => (loader.style.display = "none"), 800);
        }, duration);
      });
    } else {
      // Experienced user - no loader at all
      loader.style.display = "none";
    }
  }

  // Update session timestamp on user activity
  ["click", "scroll", "mousemove", "keypress"].forEach((event) => {
    document.addEventListener(
      event,
      () => {
        const updatedData = JSON.parse(
          localStorage.getItem(SESSION_KEY) || "{}"
        );
        updatedData.timestamp = Date.now();
        localStorage.setItem(SESSION_KEY, JSON.stringify(updatedData)); // ✅ FIXED
      },
      { passive: true }
    );
  });
})();

/* ================== BULLETPROOF NAV HIGHLIGHT ================== */
(function highlightNav() {
  // Skip navigation highlighting on admin pages
  if (
    window.location.pathname.includes("admin") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container")
  ) {
    console.log("⏭️ Skipping nav highlight on admin page");
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

  console.log(
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
      console.log(`✓ Link ${index} (${href}) activated as HOME`);
      return;
    }

    // 2. Direct match
    if (linkPage === currentPage && linkPage !== "index") {
      link.classList.add("active");
      console.log(`✓ Link ${index} (${href}) activated as DIRECT MATCH`);
      return;
    }

    // 3. For online (Netlify) - check if current path contains page name
    if (!isLocal && loc.pathname.includes(linkPage) && linkPage !== "index") {
      link.classList.add("active");
      console.log(`✓ Link ${index} (${href}) activated as PATH CONTAINS`);
      return;
    }

    // 4. For local - check full path
    if (isLocal && loc.href.endsWith(href)) {
      link.classList.add("active");
      console.log(`✓ Link ${index} (${href}) activated as LOCAL MATCH`);
      return;
    }

    console.log(`✗ Link ${index} (${href}) NOT activated`);
  });

  console.log("--- Navigation Highlight Complete ---");
})(); // ← MAKE SURE THIS CLOSING LINE EXISTS

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

/* ================== MOBILE MENU ================== */
function initMobileMenu() {
  const toggleBtn = document.getElementById("navbarToggle");
  const navList = document.querySelector(".navbar ul");

  if (toggleBtn && navList) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navList.classList.toggle("show");
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (
        navList.classList.contains("show") &&
        !e.target.closest(".navbar") &&
        !e.target.closest("#navbarToggle")
      ) {
        navList.classList.remove("show");
      }
    });

    // Close when clicking links
    document.querySelectorAll(".navbar a").forEach((link) => {
      link.addEventListener("click", () => {
        navList.classList.remove("show");
      });
    });
  }
}

/* ================== FIXED MENU INTERACTIONS ================== */
function initMenuInteractions() {
  // Close popups when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-item")) {
      document.querySelectorAll(".menu-item.show-popup").forEach((el) => {
        el.classList.remove("show-popup");
      });
    }
  });

  // Menu item click handling
  document.addEventListener("click", (e) => {
    const menuItem = e.target.closest(".menu-item");
    if (!menuItem) return;

    if (e.target.closest(".add-cart") || e.target.closest(".order-now")) return;

    const isShown = menuItem.classList.contains("show-popup");
    document
      .querySelectorAll(".menu-item")
      .forEach((i) => i.classList.remove("show-popup"));
    if (!isShown) menuItem.classList.add("show-popup");
  });

  // Add to cart functionality - NOW WITH ITEM ID
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".add-cart");
    if (!addBtn) return;
    e.stopPropagation();

    const menuItem = addBtn.closest(".menu-item");
    const name =
      menuItem.dataset.item ||
      menuItem.querySelector("h3")?.textContent?.trim();
    const price = Number(menuItem.dataset.price || 0);
    const image = menuItem.querySelector("img")?.getAttribute("src") || "";
    const id = menuItem.dataset.id || null;

    if (!name) return;

    const cart = readCart();
    const existing = cart.find((it) => it.name === name);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
      existing.id = id; // Update ID if it exists
    } else {
      cart.push({ name, price, quantity: 1, image, id });
    }
    saveCart(cart);

    const prevText = addBtn.textContent;
    addBtn.textContent = "Added ✓";
    setTimeout(() => (addBtn.textContent = prevText), 900);
  });
}

/* ================== ORDER FUNCTIONALITY ================== */
function initOrderFunctionality() {
  // Order now buttons
  document.addEventListener("click", (e) => {
    const orderNow = e.target.closest(".order-now");
    if (!orderNow) return;
    e.preventDefault();
    e.stopPropagation();

    const menuItem = orderNow.closest(".menu-item");
    const name =
      menuItem.dataset.item ||
      menuItem.querySelector("h3")?.textContent?.trim();
    const price = menuItem.dataset.price || "";

    const orderData = {
      type: "single",
      items: [{ name, price: price ? Number(price) : 0, qty: 1 }],
      subject: `Order Inquiry: ${name}`,
    };

    showOrderOptions(orderData);
  });

  // Proceed to order button - NOW WITH CART VALIDATION
  document.addEventListener("click", async (e) => {
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

    // Validate cart before proceeding
    const validation = await validateCartItems();
    if (validation.hasChanges) {
      // Show warning about changes
      const continueOrder = confirm(
        "Some items in your cart have changed. Please review your cart before proceeding.\n\nClick OK to review changes, or Cancel to continue anyway."
      );

      if (continueOrder) {
        // User wants to review changes, don't proceed to order
        return;
      }
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
  });
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
          <div class="s-right">${it.qty}× NGN ${formatPrice(it.price)}</div>
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
        <button class="sheet-close" aria-label="Close">✕</button>
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

/* ================== FIXED CART QUANTITY FUNCTION ================== */
async function renderCartOnOrderPage(shouldValidate = true) {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  let validation = null;
  let cart = readCart();

  // Only validate on initial load
  if (shouldValidate) {
    validation = await validateCartItems();
    cart = updateCartWithValidation(validation.results);
  }

  cartContainer.innerHTML = "";

  if (cart.length === 0) {
    cartContainer.innerHTML =
      '<p class="empty-cart">Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';

    const clearCartBtn = document.getElementById("clear-cart");
    if (clearCartBtn) clearCartBtn.style.display = "none";
    return;
  }

  // Show clear cart button
  const clearCartBtn = document.getElementById("clear-cart");
  if (clearCartBtn) {
    clearCartBtn.style.display = "block";
    clearCartBtn.onclick = (e) => {
      e.preventDefault();
      saveCart([]);
      renderCartOnOrderPage(false);
      showNotification("Cart cleared successfully", "success");
    };
  }

  // Show validation warnings if needed
  if (shouldValidate && validation && validation.hasChanges) {
    const warningDiv = document.createElement("div");
    warningDiv.className = "cart-validation-warning";
    warningDiv.style.cssText = `
      background: linear-gradient(135deg, #fff3cd, #ffeaa7);
      color: #856404;
      padding: 1rem;
      border-radius: 10px;
      margin-bottom: 1.5rem;
      border-left: 4px solid #ffc107;
      box-shadow: 0 4px 12px rgba(255, 193, 7, 0.15);
    `;

    let warningMessage = "⚠️ Some items in your cart have changed:";
    validation.results.forEach((result) => {
      if (result.status === "removed") {
        warningMessage += `<br>• <strong>${escapeHtml(result.name)}</strong>: ${
          result.message
        }`;
      } else if (result.status === "price_changed") {
        warningMessage += `<br>• <strong>${escapeHtml(result.name)}</strong>: ${
          result.message
        }`;
      }
    });
    warningMessage +=
      "<br><br><em>Please review your cart before proceeding.</em>";
    warningDiv.innerHTML = warningMessage;
    cartContainer.appendChild(warningDiv);
  }

  // Render cart items with PROPER event handling
  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-row";
    row.dataset.index = index; // Store index on the row itself

    // Check if item is unavailable
    const isUnavailable = item.unavailable;
    const validationResult =
      validation && validation.results.find((r) => r.index === index);
    const isPriceChanged =
      validationResult && validationResult.status === "price_changed";

    if (isUnavailable) {
      row.style.cssText = `
        opacity: 0.6;
        background: linear-gradient(135deg, #f8d7da, #f5c6cb);
        border-left: 4px solid #dc3545;
      `;
    } else if (isPriceChanged) {
      row.style.cssText = `
        background: linear-gradient(135deg, #fff3cd, #ffeaa7);
        border-left: 4px solid #ffc107;
      `;
    }

    row.innerHTML = `
      <img src="${
        item.image ||
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmZTVjYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiMzMzMiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5DYXJ0PC90ZXh0Pjwvc3ZnPg=="
      }"
           alt="${escapeHtml(item.name)}" loading="lazy" />
      <div class="item-info">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${escapeHtml(item.name)}</strong>
          ${
            isUnavailable
              ? '<span style="color:#dc3545;font-weight:bold;font-size:0.9rem;">UNAVAILABLE</span>'
              : ""
          }
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
        ${
          isPriceChanged
            ? `
          <div style="color:#856404;font-size:0.9rem;margin-top:4px;margin-bottom:8px;">
            <i class="fas fa-info-circle"></i> Price updated
          </div>
        `
            : ""
        }
        <div class="qty-controls">
          <button class="qty-btn decrease" ${
            isUnavailable
              ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
              : ""
          }>-</button>
          <span class="qty-display">${item.quantity}</span>
          <button class="qty-btn increase" ${
            isUnavailable
              ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
              : ""
          }>+</button>
          <div style="margin-left:auto;font-weight:700;">NGN ${formatPrice(
            (item.price || 0) * (item.quantity || 1)
          )}</div>
        </div>
      </div>
    `;

    cartContainer.appendChild(row);
  });

  // Add event listeners AFTER rendering
  setupCartEventListeners();
}

/* ================== FIXED CART EVENT HANDLING ================== */
function setupCartEventListeners() {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  // Remove old listeners to prevent duplicates
  cartContainer.replaceWith(cartContainer.cloneNode(true));
  const freshContainer = document.getElementById("cart-container");

  // Add fresh event listener
  freshContainer.addEventListener("click", function (e) {
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
        // Only decrease if quantity is greater than 1
        if (cart[index].quantity > 1) {
          cart[index].quantity = cart[index].quantity - 1;
        }
        // If quantity is 1, do nothing (don't decrease to 0)
      }

      saveCart(cart);
      renderCartOnOrderPage(false); // Don't validate on button clicks
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

/* ================== RIPPLE EFFECT ================== */
function initRipple(selector) {
  document.addEventListener(
    "click",
    function (e) {
      const el = e.target.closest(selector);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-effect";
      const size = Math.max(rect.width, rect.height) * 1.2;
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";

      el.style.position = el.style.position || "relative";
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { passive: true }
  );
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initializing Toke Bakes with Enhanced Sync...");
  // Load cart first to prevent flash
  refreshCartCount();

  // STEP 2: Initialize sync system FIRST (IMPORTANT!)
  window.websiteUpdater = new WebsiteAutoUpdater();

  // STEP 3: Tiny delay for sync to initialize (using requestAnimationFrame - faster)
  await new Promise((resolve) => requestAnimationFrame(resolve));

  // STEP 4: NOW load cart (after sync is ready)
  refreshCartCount();

  // STEP 5: Load dynamic content
  try {
    await loadDynamicContent();
  } catch (error) {
    console.error("Failed to load initial content:", error);
  }

  // STEP 6: Initialize everything else
  initMobileMenu();initMenuInteractions();
  initOrderFunctionality();
  initBottomSheet();
  initRipple(
    ".btn, .add-cart, .order-now, .qty-controls button, .order-option-btn, .remove-item .theme-toggle"
  );

  if (currentPage.includes("order")) {
    await renderCartOnOrderPage(true);
  }

  // Update copyright year
  const yearElement = document.getElementById("current-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  console.log("✅ Toke Bakes fully initialized with enhanced sync");
});

// Global event listener for clear cart button (fallback)
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clear-cart") {
    e.preventDefault();
    saveCart([]);
    renderCartOnOrderPage(false);
    showNotification("Cart cleared successfully", "success");
  }
});



