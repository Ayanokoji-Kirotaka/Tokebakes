/* ==================== script.js - TOKE BAKES WITH INTELLIGENT CACHING ==================== */
/* ==================== FIX: ADMIN PANEL DETECTION ==================== */
(function () {
  // Check if we're on admin page
  const isAdminPage =
    window.location.pathname.includes("admin-panel.html") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container");

  // If we're on admin page, disable cache system
  if (isAdminPage) {
    console.log("🔧 Admin panel detected - disabling cache system");

    // Override cache manager to do nothing
    window.cacheManager = {
      init: () => {},
      getCachedData: () => Promise.resolve([]),
      refreshAllCaches: () => Promise.resolve(),
      checkForUpdates: () => Promise.resolve(false),
    };

    // Override content loaders to return empty
    window.loadDynamicContent = () => Promise.resolve();
    window.loadFeaturedItems = () => Promise.resolve();
    window.loadMenuItems = () => Promise.resolve();
    window.loadGalleryImages = () => Promise.resolve();
  }
})();

/* ==================== SMART CACHING SYSTEM ==================== */
class SmartCacheManager {
  constructor() {
    this.memoryCache = new Map();
    this.broadcastChannel = null;
    this.updateInterval = null;
    this.init();
  }

  init() {
    console.log("🔧 Initializing SmartCacheManager...");

    // Setup BroadcastChannel for cross-tab sync
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel("toke_bakes_cache_sync");
      this.broadcastChannel.onmessage = (event) => {
        if (event.data.type === "CACHE_UPDATED") {
          this.handleCacheUpdate(event.data);
        }
      };
    }

    // Start background updates
    this.startBackgroundUpdates();

    // Listen for visibility changes
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.checkForUpdates();
      }
    });

    // Listen for admin updates
    if (typeof BroadcastChannel !== "undefined") {
      const adminChannel = new BroadcastChannel("toke_bakes_data_updates");
      adminChannel.onmessage = (event) => {
        if (event.data.type === "DATA_UPDATED") {
          this.handleAdminUpdate(event.data);
        }
      };
    }
  }

  startBackgroundUpdates() {
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.updateInterval = setInterval(() => {
      this.checkForUpdates();
    }, CACHE_CONFIG.UPDATE_INTERVAL);

    console.log(
      `🔄 Background updates every ${CACHE_CONFIG.UPDATE_INTERVAL / 1000}s`
    );
  }

  async checkForUpdates() {
    const lastUpdate = localStorage.getItem(CACHE_CONFIG.KEYS.TIMESTAMP);
    const now = Date.now();

    if (!lastUpdate || now - parseInt(lastUpdate) > 30000) {
      // 30 seconds
      await this.refreshAllCaches(true); // Silent refresh
    }
  }

  async refreshAllCaches(silent = false) {
    try {
      if (!silent) this.showCacheStatus("syncing");

      // Refresh all cache types
      await Promise.all([
        this.fetchAndCache(
          API_ENDPOINTS.MENU,
          CACHE_CONFIG.KEYS.MENU,
          CACHE_CONFIG.EXPIRY.MENU
        ),
        this.fetchAndCache(
          API_ENDPOINTS.FEATURED,
          CACHE_CONFIG.KEYS.FEATURED,
          CACHE_CONFIG.EXPIRY.FEATURED
        ),
        this.fetchAndCache(
          API_ENDPOINTS.GALLERY,
          CACHE_CONFIG.KEYS.GALLERY,
          CACHE_CONFIG.EXPIRY.GALLERY
        ),
        this.fetchAndCache(
          API_ENDPOINTS.CAROUSEL,
          CACHE_CONFIG.KEYS.CAROUSEL,
          CACHE_CONFIG.EXPIRY.CAROUSEL
        ),
        this.fetchAndCache(
          API_ENDPOINTS.THEMES,
          CACHE_CONFIG.KEYS.THEMES,
          CACHE_CONFIG.EXPIRY.THEMES
        ),
      ]);

      // Update timestamp
      localStorage.setItem(CACHE_CONFIG.KEYS.TIMESTAMP, Date.now().toString());

      // Notify other tabs
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: "CACHE_UPDATED",
          timestamp: Date.now(),
        });
      }

      if (!silent) {
        this.showCacheStatus("updated");
        setTimeout(() => this.hideCacheStatus(), 2000);
      }

      console.log("✅ All caches refreshed successfully");
      return true;
    } catch (error) {
      console.error("❌ Cache refresh failed:", error);
      if (!silent) {
        this.showCacheStatus("error");
        setTimeout(() => this.hideCacheStatus(), 3000);
      }
      return false;
    }
  }

  async fetchAndCache(endpoint, cacheKey, expiry) {
    try {
      console.log(`🔄 Fetching fresh data for ${endpoint}...`);

      const response = await fetch(
        `${SUPABASE_CONFIG.URL}${endpoint}?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(CACHE_CONFIG.OFFLINE_TIMEOUT),
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      // Cache the data
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        expiry: expiry,
        version: CACHE_CONFIG.VERSION,
      };

      // Store in localStorage
      localStorage.setItem(cacheKey, JSON.stringify(cacheData));

      // Store in memory cache
      this.memoryCache.set(cacheKey, cacheData);

      // Enforce memory limit
      if (this.memoryCache.size > CACHE_CONFIG.MAX_MEMORY_ITEMS) {
        const firstKey = this.memoryCache.keys().next().value;
        this.memoryCache.delete(firstKey);
      }

      console.log(`✅ ${endpoint} cached with ${data.length} items`);
      return data;
    } catch (error) {
      console.error(`❌ Failed to fetch ${endpoint}:`, error);
      throw error;
    }
  }

  async getCachedData(cacheKey, endpoint) {
    // 1. Check memory cache first (fastest)
    if (this.memoryCache.has(cacheKey)) {
      const cached = this.memoryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < cached.expiry) {
        console.log(`⚡ ${cacheKey} served from memory cache`);
        return cached.data;
      }
    }

    // 2. Check localStorage (fast)
    const stored = localStorage.getItem(cacheKey);
    if (stored) {
      try {
        const cached = JSON.parse(stored);

        // Validate cache
        if (cached.version !== CACHE_CONFIG.VERSION) {
          console.log(`🔄 Cache version mismatch for ${cacheKey}`);
          localStorage.removeItem(cacheKey);
        } else if (Date.now() - cached.timestamp < cached.expiry) {
          console.log(`💾 ${cacheKey} served from localStorage`);

          // Update memory cache
          this.memoryCache.set(cacheKey, cached);
          return cached.data;
        } else {
          console.log(`🔄 ${cacheKey} cache expired, fetching fresh`);
        }
      } catch (e) {
        console.error(`❌ Corrupted cache for ${cacheKey}:`, e);
        localStorage.removeItem(cacheKey);
      }
    }

    // 3. Fetch fresh data (background)
    setTimeout(() => {
      this.fetchAndCache(
        endpoint,
        cacheKey,
        CACHE_CONFIG.EXPIRY[cacheKey.split("_").pop().toUpperCase()]
      );
    }, 100);

    // 4. Return fallback or empty array
    return [];
  }

  handleCacheUpdate(data) {
    console.log("📡 Cache update received from another tab");
    this.memoryCache.clear(); // Clear memory cache to force fresh load
    this.triggerContentRefresh();
  }

  handleAdminUpdate(data) {
    console.log("👑 Admin update detected:", data);

    // Invalidate specific cache based on update type
    switch (data.itemType) {
      case "menu":
        this.invalidateCache(CACHE_CONFIG.KEYS.MENU);
        break;
      case "featured":
        this.invalidateCache(CACHE_CONFIG.KEYS.FEATURED);
        break;
      case "gallery":
        this.invalidateCache(CACHE_CONFIG.KEYS.GALLERY);
        break;
      case "carousel":
        this.invalidateCache(CACHE_CONFIG.KEYS.CAROUSEL);
        break;
      default:
        this.invalidateAllCaches();
    }

    this.triggerContentRefresh();
  }

  invalidateCache(cacheKey) {
    localStorage.removeItem(cacheKey);
    this.memoryCache.delete(cacheKey);
    console.log(`🗑️ Cache invalidated: ${cacheKey}`);
  }

  invalidateAllCaches() {
    Object.values(CACHE_CONFIG.KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
    this.memoryCache.clear();
    console.log("🗑️ All caches invalidated");
  }

  triggerContentRefresh() {
    // Dispatch custom event for components to refresh
    window.dispatchEvent(new CustomEvent("cacheUpdated"));
  }

  showCacheStatus(status) {
    let indicator = document.getElementById("cache-status-indicator");

    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "cache-status-indicator";
      document.body.appendChild(indicator);
    }

    indicator.className = `cache-status cache-status-${status}`;

    const messages = {
      syncing: "⟳ Updating...",
      updated: "✓ Updated",
      error: "⚠️ Update failed",
    };

    indicator.textContent = messages[status] || "";
    indicator.style.display = "flex";
  }

  hideCacheStatus() {
    const indicator = document.getElementById("cache-status-indicator");
    if (indicator) {
      indicator.style.display = "none";
    }
  }

  clearOldCaches() {
    const now = Date.now();
    Object.values(CACHE_CONFIG.KEYS).forEach((key) => {
      if (key === CACHE_CONFIG.KEYS.TIMESTAMP) return;

      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const cached = JSON.parse(stored);
          if (now - cached.timestamp > cached.expiry * 2) {
            // Double expiry
            localStorage.removeItem(key);
          }
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
    });

    console.log("🧹 Old caches cleaned up");
  }
}

// Initialize cache manager globally
window.cacheManager = new SmartCacheManager();

/* ==================== ENHANCED CONTENT LOADERS ==================== */
async function loadFeaturedItems() {
  const container = document.getElementById("featured-container");
  if (!container) return;

  // Show skeleton immediately
  container.innerHTML = this.createSkeleton("featured", 4);

  try {
    // Get cached data (instant load)
    const items = await window.cacheManager.getCachedData(
      CACHE_CONFIG.KEYS.FEATURED,
      API_ENDPOINTS.FEATURED
    );

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

    // Render with progressive enhancement
    this.renderWithProgressiveImages(container, items, "featured");
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

async function loadMenuItems() {
  const container = document.getElementById("menu-container");
  if (!container) return;

  // Show skeleton immediately
  container.innerHTML = this.createSkeleton("menu", 6);

  try {
    // Get cached data (instant load)
    const items = await window.cacheManager.getCachedData(
      CACHE_CONFIG.KEYS.MENU,
      API_ENDPOINTS.MENU
    );

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

    // Render with progressive enhancement
    this.renderWithProgressiveImages(container, items, "menu");
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

async function loadGalleryImages() {
  const container = document.getElementById("gallery-container");
  if (!container) return;

  // Show skeleton immediately
  container.innerHTML = this.createSkeleton("gallery", 8);

  try {
    // Get cached data (instant load)
    const items = await window.cacheManager.getCachedData(
      CACHE_CONFIG.KEYS.GALLERY,
      API_ENDPOINTS.GALLERY
    );

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

    // Render with progressive enhancement
    this.renderWithProgressiveImages(container, items, "gallery");
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

/* ==================== HELPER FUNCTIONS ==================== */
function createSkeleton(type, count) {
  const skeletons = [];

  for (let i = 0; i < count; i++) {
    if (type === "featured") {
      skeletons.push(`
        <article class="featured-item skeleton">
          <div class="skeleton-image"></div>
          <div class="skeleton-line short"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line medium"></div>
        </article>
      `);
    } else if (type === "menu") {
      skeletons.push(`
        <div class="menu-item skeleton">
          <div class="skeleton-image"></div>
          <div class="skeleton-line short"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line medium"></div>
          <div class="skeleton-buttons"></div>
        </div>
      `);
    } else if (type === "gallery") {
      skeletons.push(`
        <div class="skeleton-gallery-item">
          <div class="skeleton-image"></div>
        </div>
      `);
    }
  }

  return skeletons.join("");
}

function renderWithProgressiveImages(container, items, type) {
  // First pass: render HTML without images
  const html = items
    .map((item, index) => {
      if (type === "featured") {
        return `
        <article class="featured-item" data-index="${index}">
          <div class="image-placeholder" data-src="${
            item.image
          }" data-alt="${escapeHtml(item.title)}"></div>
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.description)}</p>
        </article>
      `;
      } else if (type === "menu") {
        return `
        <div class="menu-item" data-item="${escapeHtml(
          item.title
        )}" data-price="${item.price}" data-id="${
          item.id || ""
        }" data-index="${index}">
          <div class="image-placeholder" data-src="${
            item.image
          }" data-alt="${escapeHtml(item.title)}"></div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
          <div class="popup">
            <button class="add-cart">Add to Cart</button>
            <a class="order-now" href="#">Order Now</a>
          </div>
        </div>
      `;
      } else if (type === "gallery") {
        return `
        <div class="gallery-image-container" data-index="${index}">
          <div class="image-placeholder" data-src="${
            item.image
          }" data-alt="${escapeHtml(item.alt)}"></div>
        </div>
      `;
      }
    })
    .join("");

  container.innerHTML = html;
  container.classList.remove("skeleton-loading");

  // Second pass: load images progressively
  this.loadProgressiveImages(container);
}

function loadProgressiveImages(container) {
  const placeholders = container.querySelectorAll(".image-placeholder");

  placeholders.forEach((placeholder, index) => {
    const img = new Image();
    img.src = placeholder.dataset.src;
    img.alt = placeholder.dataset.alt;
    img.loading = "lazy";

    img.onload = () => {
      // Replace placeholder with actual image
      placeholder.parentNode.replaceChild(img, placeholder);

      // Add loaded class for animation
      img.classList.add("loaded");

      // Trigger custom event
      if (index === 0) {
        container.dispatchEvent(new CustomEvent("firstImageLoaded"));
      }
    };

    img.onerror = () => {
      // Use fallback image
      img.src =
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkRlZmF1bHQgSW1hZ2U8L3RleHQ+PC9zdmc+";
      placeholder.parentNode.replaceChild(img, placeholder);
      img.classList.add("loaded", "fallback");
    };
  });
}

/* ==================== LOAD DYNAMIC CONTENT - CACHE-AWARE ==================== */
async function loadDynamicContent(forceRefresh = false) {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  console.log(`📱 Loading content for ${currentPage} (cache-aware)`);

  // Clear any existing loading states
  clearLoadingStates();

  // Force refresh if requested
  if (forceRefresh) {
    await window.cacheManager.refreshAllCaches();
  }

  // Load content based on page
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

  console.log(`✅ Content loaded for: ${currentPage}`);
}

function clearLoadingStates() {
  const containers = [
    "featured-container",
    "menu-container",
    "gallery-container",
  ];

  containers.forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      container.classList.add("skeleton-loading");
    }
  });
}

/* ==================== ORIGINAL FUNCTIONALITY (UPDATED) ==================== */
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ==================== ENHANCED NOTIFICATION ==================== */
function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-icon">${
      type === "success" ? "✓" : type === "error" ? "⚠" : "ℹ"
    }</div>
    <div class="notification-content">${message}</div>
    <button class="notification-close">&times;</button>
  `;

  document.body.appendChild(notification);

  // Close button
  notification
    .querySelector(".notification-close")
    .addEventListener("click", () => {
      notification.remove();
    });

  // Auto remove
  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.animation = "slideOutRight 0.3s ease-out forwards";
      setTimeout(() => notification.remove(), 300);
    }
  }, 3000);
}

/* ==================== CART VALIDATION ==================== */
async function validateCartItems() {
  try {
    const cart = readCart();
    if (cart.length === 0) return { valid: true, items: [] };

    const currentMenu = await window.cacheManager.getCachedData(
      CACHE_CONFIG.KEYS.MENU,
      API_ENDPOINTS.MENU
    );

    const validationResults = [];
    let hasChanges = false;
    let hasRemovals = false;

    cart.forEach((cartItem, index) => {
      let currentItem = null;

      if (cartItem.id) {
        currentItem = currentMenu.find((item) => item.id === cartItem.id);
      }

      if (!currentItem) {
        currentItem = currentMenu.find((item) => item.title === cartItem.name);
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
      } else if (currentItem.price !== cartItem.price) {
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
      } else {
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

function updateCartWithValidation(validationResults) {
  const cart = readCart();
  let updatedCart = [...cart];
  let changesMade = false;

  validationResults.forEach((result) => {
    if (result.status === "price_changed" && result.newPrice !== null) {
      updatedCart[result.index].price = result.newPrice;
      changesMade = true;
    } else if (result.status === "removed") {
      updatedCart[result.index].unavailable = true;
      changesMade = true;
    }
  });

  if (changesMade) {
    saveCart(updatedCart);
  }

  return updatedCart;
}

/* ==================== SESSION AWARE LOADER ==================== */
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

  // Check if we have cached data - if yes, hide loader immediately
  const hasCachedData =
    localStorage.getItem(CACHE_CONFIG.KEYS.FEATURED) ||
    localStorage.getItem(CACHE_CONFIG.KEYS.MENU) ||
    localStorage.getItem(CACHE_CONFIG.KEYS.GALLERY);

  if (hasCachedData) {
    loader.style.display = "none";
    return;
  }

  // Show loader only on first visit
  const SESSION_KEY = "toke_bakes_visit_count";
  const visitCount = parseInt(localStorage.getItem(SESSION_KEY) || "0");

  if (visitCount < 2) {
    localStorage.setItem(SESSION_KEY, (visitCount + 1).toString());

    window.addEventListener("load", () => {
      const duration = visitCount === 0 ? 1200 : 600;

      setTimeout(() => {
        loader.style.opacity = "0";
        setTimeout(() => (loader.style.display = "none"), 800);
      }, duration);
    });
  } else {
    loader.style.display = "none";
  }
})();

/* ==================== NAV HIGHLIGHT ==================== */
(function highlightNav() {
  if (
    window.location.pathname.includes("admin") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container")
  ) {
    return;
  }

  const navLinks = document.querySelectorAll("nav a");
  const currentPage = window.location.pathname.split("/").pop() || "index";

  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;

    let linkPage = href.split("/").pop() || "index";
    linkPage = linkPage.replace(/\.(html|htm)$/, "").split("?")[0];
    if (linkPage === "") linkPage = "index";

    link.classList.remove("active");

    if (linkPage === "index" && currentPage === "index") {
      link.classList.add("active");
    } else if (linkPage === currentPage.replace(/\.(html|htm)$/, "")) {
      link.classList.add("active");
    } else if (currentPage.includes(linkPage) && linkPage !== "index") {
      link.classList.add("active");
    }
  });
})();

/* ==================== CART COUNT ==================== */
function refreshCartCount() {
  const countEls = document.querySelectorAll("#cart-count");
  const cart = readCart();
  const totalItems = cart.reduce((s, it) => s + (it.quantity || 1), 0);

  countEls.forEach((el) => {
    el.textContent = totalItems;
    el.setAttribute("data-count", String(totalItems));

    if (totalItems === 0) {
      el.style.display = "none";
    } else {
      el.style.display = "inline-block";
    }
  });
}

/* ==================== MOBILE MENU ==================== */
function initMobileMenu() {
  const toggleBtn = document.getElementById("navbarToggle");
  const navList = document.querySelector(".navbar ul");

  if (toggleBtn && navList) {
    const newToggle = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);

    const newNavList = navList.cloneNode(true);
    navList.parentNode.replaceChild(newNavList, navList);

    const freshToggle = document.getElementById("navbarToggle");
    const freshNavList = document.querySelector(".navbar ul");

    freshToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      freshNavList.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (
        freshNavList.classList.contains("show") &&
        !e.target.closest(".navbar") &&
        !e.target.closest("#navbarToggle")
      ) {
        freshNavList.classList.remove("show");
      }
    });

    document.querySelectorAll(".navbar a").forEach((link) => {
      link.addEventListener("click", () => {
        freshNavList.classList.remove("show");
      });
    });
  }
}

/* ==================== MENU INTERACTIONS ==================== */
function initMenuInteractions() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-item")) {
      document.querySelectorAll(".menu-item.show-popup").forEach((el) => {
        el.classList.remove("show-popup");
      });
    }
  });

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
      existing.id = id;
    } else {
      cart.push({ name, price, quantity: 1, image, id });
    }
    saveCart(cart);

    const prevText = addBtn.textContent;
    addBtn.textContent = "Added ✓";
    setTimeout(() => (addBtn.textContent = prevText), 900);
  });
}

/* ==================== ORDER FUNCTIONALITY ==================== */
function initOrderFunctionality() {
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

/* ==================== CART RENDERING ==================== */
async function renderCartOnOrderPage(shouldValidate = true) {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  let validation = null;
  let cart = readCart();

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

  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-row";
    row.dataset.index = index;

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
            isUnavailable ? "disabled" : ""
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

  setupCartEventListeners();
}

function setupCartEventListeners() {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  cartContainer.replaceWith(cartContainer.cloneNode(true));
  const freshContainer = document.getElementById("cart-container");

  freshContainer.addEventListener("click", function (e) {
    const target = e.target;
    const row = target.closest(".cart-row");

    if (!row) return;

    const index = parseInt(row.dataset.index);
    let cart = readCart();

    if (isNaN(index) || index < 0 || index >= cart.length) return;

    if (target.classList.contains("qty-btn")) {
      e.preventDefault();
      e.stopPropagation();

      if (target.classList.contains("increase")) {
        cart[index].quantity = (cart[index].quantity || 1) + 1;
      } else if (target.classList.contains("decrease")) {
        if (cart[index].quantity > 1) {
          cart[index].quantity = cart[index].quantity - 1;
        }
      }

      saveCart(cart);
      renderCartOnOrderPage(false);
    }

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

/* ==================== RIPPLE EFFECT ==================== */
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

/* ==================== INITIALIZATION ==================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initializing Toke Bakes with Intelligent Caching...");

  // Load cart first
  refreshCartCount();

  // Load content with cache
  try {
    await loadDynamicContent();
  } catch (error) {
    console.error("Failed to load initial content:", error);
  }

  // Initialize everything else
  initMobileMenu();
  initMenuInteractions();
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

  // Listen for cache updates
  window.addEventListener("cacheUpdated", () => {
    console.log("🔄 Cache update detected, refreshing content...");
    loadDynamicContent();

    // Refresh cart if on order page
    if (currentPage.includes("order")) {
      renderCartOnOrderPage(true);
    }
  });

  console.log("✅ Toke Bakes fully initialized with intelligent caching");
});

// Global event listener for clear cart button
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clear-cart") {
    e.preventDefault();
    saveCart([]);
    renderCartOnOrderPage(false);
    showNotification("Cart cleared successfully", "success");
  }
});
