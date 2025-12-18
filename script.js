/* ================== script.js - COMPLETE FIXED VERSION ================== */
/* Toke Bakes Website - SEPARATED THEME SYSTEMS */

/* ================== CRITICAL: PREVENT THEME FLASH ================== */
// This runs IMMEDIATELY when script loads
(function preventThemeFlash() {
  // 1. Dark/Light mode (user preference)
  const savedTheme = localStorage.getItem("toke_bakes_theme");
  let theme = "light";

  if (savedTheme) {
    theme = savedTheme;
  } else {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    theme = prefersDark ? "dark" : "light";
  }

  // Apply dark/light theme immediately
  document.documentElement.setAttribute("data-theme", theme);

  // Disable transitions during initial load
  document.documentElement.style.transition = "none";
  document.body.style.transition = "none";

  // Re-enable transitions after page loads
  window.addEventListener("load", function () {
    setTimeout(function () {
      document.documentElement.style.transition = "";
      document.body.style.transition = "";
    }, 10);
  });
})();

/* ================== ENHANCED AUTO-UPDATE SYSTEM ================== */
class WebsiteAutoUpdater {
  constructor() {
    this.lastUpdateKey = "toke_bakes_last_update";
    this.broadcastChannel = null;
    this.pollingInterval = null;
    this.init();
  }

  init() {
    console.log("🔧 Initializing WebsiteAutoUpdater...");

    // Setup BroadcastChannel for instant sync
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel("toke_bakes_data_updates");
      this.broadcastChannel.onmessage = (event) => {
        if (event.data.type === "DATA_UPDATED") {
          console.log("📡 Update received:", event.data);
          this.refreshDataWithUI();
        }

        // Handle theme updates from admin panel
        if (event.data.type === "theme_activated") {
          console.log("🎨 Theme update received:", event.data.data.css_file);
          this.updateWebsiteTheme(event.data.data.css_file);
        }
      };
      console.log("✅ BroadcastChannel ready");
    }

    // Check for updates every 30 seconds
    this.startPolling(30000);

    // Check when user returns to tab
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        console.log("👁️ Tab visible, checking for updates...");
        this.checkForUpdates();
      }
    });

    // Initial check
    setTimeout(() => this.checkForUpdates(), 3000);
  }

  startPolling(interval = 30000) {
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
      console.log("🔄 Update detected");
      localStorage.setItem("my_last_check", lastUpdate);
      await this.refreshDataWithUI();
      return true;
    }
    return false;
  }

  async refreshDataWithUI() {
    try {
      console.log("🔄 Refreshing website data...");

      // Clear caches
      if (window.cachedMenuItems) {
        window.cachedMenuItems = null;
        window.cacheTimestamp = null;
      }

      // Reload content based on current page
      if (typeof loadDynamicContent === "function") {
        await loadDynamicContent();
      }

      // Refresh cart if on order page
      if (
        window.location.pathname.includes("order") &&
        typeof renderCartOnOrderPage === "function"
      ) {
        await renderCartOnOrderPage(true);
      }

      console.log("✅ Website content updated");
    } catch (error) {
      console.error("❌ Sync refresh failed:", error);
    }
  }

  // Update website theme from admin panel
  async updateWebsiteTheme(themeFile) {
    console.log(`🎨 Updating website theme to: ${themeFile}`);

    // Show notification
    const themeName = themeFile.replace(".css", "").replace("theme-", "");
    showNotification(`Theme changed to ${themeName}`, "info");

    // Load the new theme
    loadActiveTheme();
  }
}

// Initialize website updater
window.websiteUpdater = new WebsiteAutoUpdater();

/* ================== WEBSITE HOLIDAY THEME SYSTEM ================== */
// This handles CSS file swapping for holiday themes

let currentThemeFile = "style.css";

// Function to swap CSS files
function swapWebsiteTheme(newThemeFile) {
  // Don't swap if already using this theme
  if (currentThemeFile === newThemeFile) return;

  console.log(`🔄 Swapping theme: ${currentThemeFile} → ${newThemeFile}`);

  // Store current theme
  currentThemeFile = newThemeFile;

  // Find existing theme link
  let themeLink = document.getElementById("active-theme-css");

  if (!themeLink) {
    // Create new link element
    themeLink = document.createElement("link");
    themeLink.rel = "stylesheet";
    themeLink.id = "active-theme-css";
    document.head.appendChild(themeLink);
  }

  // Set new CSS file with cache busting
  themeLink.href = `${newThemeFile}?v=${Date.now()}`;

  console.log(`✅ Theme swapped to: ${newThemeFile}`);
}

// Load active theme from database
async function loadActiveTheme() {
  try {
    if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.URL) {
      console.log("Supabase not configured, using default theme");
      return "style.css";
    }

    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/website_themes?is_active=eq.true&select=css_file&limit=1`,
      {
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        },
        cache: "no-cache",
      }
    );

    if (response.ok) {
      const [theme] = await response.json();
      const themeFile = theme?.css_file || "style.css";

      // Apply the theme
      swapWebsiteTheme(themeFile);
      return themeFile;
    }
  } catch (error) {
    console.log("Using default theme (error loading from database)");
    swapWebsiteTheme("style.css");
  }

  return "style.css";
}

/* ================== DARK/LIGHT THEME TOGGLE ================== */
// This handles user preference only

function initThemeToggle() {
  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;

  // Get icon elements
  const sunIcon = themeToggle.querySelector(".sun");
  const moonIcon = themeToggle.querySelector(".moon");

  // Function to update icons
  const updateIcons = (theme) => {
    if (theme === "dark") {
      if (sunIcon) sunIcon.style.display = "none";
      if (moonIcon) moonIcon.style.display = "inline-block";
      themeToggle.classList.add("dark");
    } else {
      if (sunIcon) sunIcon.style.display = "inline-block";
      if (moonIcon) moonIcon.style.display = "none";
      themeToggle.classList.remove("dark");
    }
  };

  // Initial setup
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "light";
  updateIcons(currentTheme);
  updateFooterTheme(currentTheme);

  // Click handler
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const newTheme = current === "dark" ? "light" : "dark";

    // Update HTML attribute
    document.documentElement.setAttribute("data-theme", newTheme);

    // Update icons
    updateIcons(newTheme);

    // Save preference
    localStorage.setItem("toke_bakes_theme", newTheme);
    updateFooterTheme(newTheme);

    console.log(`🌓 Dark/Light theme: ${newTheme}`);
  });
}

/* ================== FOOTER THEME ================== */
function updateFooterTheme(theme) {
  const footer = document.querySelector(".bakes-footer");
  if (!footer) return;

  if (!theme) {
    theme = document.documentElement.getAttribute("data-theme") || "light";
  }

  if (theme === "dark") {
    footer.classList.add("dark-theme");
    footer.classList.remove("light-theme");
  } else {
    footer.classList.add("light-theme");
    footer.classList.remove("dark-theme");
  }
}

/* ================== DATA LOADING FUNCTIONS ================== */

// Cache for menu items
let cachedMenuItems = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load from Supabase
async function loadFromSupabase(endpoint) {
  try {
    if (
      !window.SUPABASE_CONFIG ||
      !window.SUPABASE_CONFIG.URL ||
      !window.SUPABASE_CONFIG.ANON_KEY
    ) {
      console.error("Supabase configuration not found");
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

// Load featured items
async function loadFeaturedItems() {
  const container = document.getElementById("featured-container");
  if (!container) return;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.FEATURED);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-star"></i>
          <p>Featured items coming soon! Check back later.</p>
        </div>
      `;
      return;
    }

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <article class="featured-item">
            <img src="${item.image}" alt="${
          item.title
        }" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg=='">
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
        <p>Unable to load featured items. Please try again later.</p>
      </div>
    `;
  }
}

// Load menu items
async function loadMenuItems() {
  const container = document.getElementById("menu-container");
  if (!container) return;

  try {
    const items = await getMenuItems();

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>Our menu is being updated. Please check back soon!</p>
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
        <p>Unable to load menu items. Please try again later.</p>
      </div>
    `;
  }
}

// Load gallery images
async function loadGalleryImages() {
  const container = document.getElementById("gallery-container");
  if (!container) return;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.GALLERY);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>Gallery coming soon! Check back later.</p>
        </div>
      `;
      return;
    }

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <img src="${item.image}" alt="${item.alt}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcrialCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkdhbGxlcnk8L3RleHQ+PC9zdmc+='">
        `
      )
      .join("");
  } catch (error) {
    console.error("Error loading gallery images:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load gallery. Please try again later.</p>
      </div>
    `;
  }
}

// Load dynamic content based on page
async function loadDynamicContent() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  // Check if Supabase config exists
  if (!window.SUPABASE_CONFIG || !window.API_ENDPOINTS) {
    console.error("Supabase configuration not loaded");
    return;
  }

  if (
    currentPage.includes("index") ||
    currentPage === "" ||
    currentPage === "/"
  ) {
    await loadFeaturedItems();
  } else if (currentPage.includes("menu")) {
    await loadMenuItems();
  } else if (currentPage.includes("gallery")) {
    await loadGalleryImages();
  }
}

/* ================== ORIGINAL TOKE BAKES CODE ================== */

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

// Escape HTML for security
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ================== CART VALIDATION FUNCTIONS ================== */

async function validateCartItems() {
  try {
    const cart = readCart();
    if (cart.length === 0) return { valid: true, items: [] };

    const currentMenu = await getMenuItems();
    const validationResults = [];
    let hasChanges = false;
    let hasRemovals = false;

    cart.forEach((cartItem, index) => {
      const currentItem = currentMenu.find(
        (item) => item.title === cartItem.name || item.id === cartItem.id
      );

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

/* ================== NOTIFICATION FUNCTION ================== */
function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 25px;
    right: 25px;
    background: ${
      type === "success"
        ? "#4CAF50"
        : type === "error"
        ? "#F44336"
        : type === "warning"
        ? "#FF9800"
        : "#2196F3"
    };
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

  const SESSION_KEY = "toke_bakes_session";
  const sessionData = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
  const now = Date.now();
  const SESSION_TIMEOUT = 30 * 60 * 1000;

  const hasActiveSession =
    sessionData.timestamp && now - sessionData.timestamp < SESSION_TIMEOUT;

  if (hasActiveSession) {
    loader.style.display = "none";
    console.log("🔁 Active session - seamless experience");
  } else {
    sessionData.timestamp = now;
    sessionData.visitCount = (sessionData.visitCount || 0) + 1;
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));

    if (sessionData.visitCount <= 2) {
      window.addEventListener("load", () => {
        const duration = sessionData.visitCount === 1 ? 1200 : 600;

        setTimeout(() => {
          loader.style.opacity = "0";
          setTimeout(() => (loader.style.display = "none"), 800);
        }, duration);
      });
    } else {
      loader.style.display = "none";
    }
  }

  ["click", "scroll", "mousemove", "keypress"].forEach((event) => {
    document.addEventListener(
      event,
      () => {
        const updatedData = JSON.parse(
          localStorage.getItem(SESSION_KEY) || "{}"
        );
        updatedData.timestamp = Date.now();
        localStorage.setItem(SESSION_KEY, JSON.stringify(updatedData));
      },
      { passive: true }
    );
  });
})();

/* ================== BULLETPROOF NAV HIGHLIGHT ================== */
(function highlightNav() {
  const navLinks = document.querySelectorAll("nav a");

  const loc = {
    href: window.location.href.toLowerCase(),
    pathname: window.location.pathname.toLowerCase(),
    hostname: window.location.hostname,
  };

  const isLocal =
    loc.hostname === "localhost" || loc.href.startsWith("file://");

  let currentPage = loc.pathname.split("/").pop() || "index";
  currentPage = currentPage.replace(/\.(html|htm)$/, "").split("?")[0];
  if (currentPage === "") currentPage = "index";

  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;

    let linkPage = href.split("/").pop() || "index";
    linkPage = linkPage.replace(/\.(html|htm)$/, "").split("?")[0];
    if (linkPage === "") linkPage = "index";

    link.classList.remove("active");

    if (linkPage === "index" && currentPage === "index") {
      link.classList.add("active");
      return;
    }

    if (linkPage === currentPage && linkPage !== "index") {
      link.classList.add("active");
      return;
    }

    if (!isLocal && loc.pathname.includes(linkPage) && linkPage !== "index") {
      link.classList.add("active");
      return;
    }

    if (isLocal && loc.href.endsWith(href)) {
      link.classList.add("active");
      return;
    }
  });
})();

/* ================== FIXED CART COUNT ================== */
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

/* ================== MOBILE MENU ================== */
function initMobileMenu() {
  const toggleBtn = document.getElementById("navbarToggle");
  const navList = document.querySelector(".navbar ul");

  if (toggleBtn && navList) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navList.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (
        navList.classList.contains("show") &&
        !e.target.closest(".navbar") &&
        !e.target.closest("#navbarToggle")
      ) {
        navList.classList.remove("show");
      }
    });

    document.querySelectorAll(".navbar a").forEach((link) => {
      link.addEventListener("click", () => {
        navList.classList.remove("show");
      });
    });
  }
}

/* ================== MENU INTERACTIONS ================== */
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

  // Add to cart functionality
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

  // Proceed to order button
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

    const validation = await validateCartItems();
    if (validation.hasChanges) {
      const continueOrder = confirm(
        "Some items in your cart have changed. Please review your cart before proceeding.\n\nClick OK to review changes, or Cancel to continue anyway."
      );

      if (continueOrder) {
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

/* ================== CART RENDERING ================== */
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

  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-row";
    row.dataset.index = index;

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

  setupCartEventListeners();
}

/* ================== CART EVENT HANDLING ================== */
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

/* ================== INITIALIZATION ================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initializing Toke Bakes Website...");

  // 1. Load holiday theme from database
  await loadActiveTheme();

  // 2. Setup dark/light theme toggle
  initThemeToggle();

  // 3. Initialize other components
  refreshCartCount();
  await loadDynamicContent();
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

  console.log("✅ Toke Bakes Website initialized");
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
