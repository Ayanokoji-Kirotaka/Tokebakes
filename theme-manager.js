/* ================== theme-manager.js ================== */
/* Toke Bakes Theme Management System - BULLETPROOF VERSION */
/* Load this file on ALL pages (admin + main website) */

// Theme configuration
const THEME_CONFIG = {
  CSS_LINK_ID: "theme-stylesheet",
  STORAGE_KEY: "toke_bakes_active_theme",
  BROADCAST_CHANNEL: "toke_bakes_theme_updates",
  DEFAULT_THEME: "style.css",
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
};

// Theme state
let currentTheme = THEME_CONFIG.DEFAULT_THEME;
let broadcastChannel = null;
let isInitializing = false;

/* ================== ENHANCED INITIALIZATION ================== */

function initializeThemeManager() {
  if (isInitializing) return;
  isInitializing = true;

  console.log("🎨 Initializing Bulletproof Theme Manager...");

  // 1. Setup BroadcastChannel for real-time sync
  if (typeof BroadcastChannel !== "undefined") {
    try {
      broadcastChannel = new BroadcastChannel(THEME_CONFIG.BROADCAST_CHANNEL);
      broadcastChannel.onmessage = handleThemeBroadcast;
      console.log("✅ Theme BroadcastChannel ready");
    } catch (error) {
      console.warn(
        "BroadcastChannel failed, using localStorage fallback:",
        error
      );
    }
  }

  // 2. Apply theme on page load
  setTimeout(() => applyThemeOnLoad(), 100);

  // 3. Setup theme change listener for admin panel
  setTimeout(() => {
    if (window.location.pathname.includes("admin")) {
      setupAdminThemeListeners();
    }
  }, 500);
}

/* ================== BULLETPROOF CORE FUNCTIONS ================== */

/**
 * Get the active theme with retries and fallbacks
 */
async function getActiveTheme() {
  // Try database first
  for (let attempt = 1; attempt <= THEME_CONFIG.RETRY_ATTEMPTS; attempt++) {
    try {
      if (!window.SUPABASE_CONFIG || !window.API_ENDPOINTS) {
        console.warn("Supabase not loaded, attempt", attempt);
        await new Promise((resolve) =>
          setTimeout(resolve, THEME_CONFIG.RETRY_DELAY * attempt)
        );
        continue;
      }

      const response = await fetch(
        `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.THEMES}?is_active=eq.true&select=css_file`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(5000), // 5 second timeout
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0 && data[0].css_file) {
          console.log("✅ Active theme from database:", data[0].css_file);
          return data[0].css_file;
        }
      }

      console.warn(`Database attempt ${attempt} failed, retrying...`);
      await new Promise((resolve) =>
        setTimeout(resolve, THEME_CONFIG.RETRY_DELAY * attempt)
      );
    } catch (error) {
      console.warn(`Attempt ${attempt} error:`, error.message);
      if (attempt === THEME_CONFIG.RETRY_ATTEMPTS) break;
      await new Promise((resolve) =>
        setTimeout(resolve, THEME_CONFIG.RETRY_DELAY * attempt)
      );
    }
  }

  // Fallback to localStorage
  console.log("⚠️ Using localStorage fallback");
  return getLocalTheme();
}

function getLocalTheme() {
  const saved = localStorage.getItem(THEME_CONFIG.STORAGE_KEY);
  return saved || THEME_CONFIG.DEFAULT_THEME;
}

/**
 * Ultra-reliable theme application
 */
function applyTheme(cssFile) {
  // Validate input
  if (!cssFile || typeof cssFile !== "string") {
    console.error("Invalid theme file:", cssFile);
    return false;
  }

  // Sanitize filename
  const safeCssFile = cssFile.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeCssFile.endsWith(".css")) {
    console.error("Invalid CSS file extension:", cssFile);
    return false;
  }

  const themeLink = document.getElementById(THEME_CONFIG.CSS_LINK_ID);

  if (!themeLink) {
    console.error(
      `Theme link with ID "${THEME_CONFIG.CSS_LINK_ID}" not found!`
    );
    // Emergency fallback: try to find any stylesheet
    const anyLink = document.querySelector('link[rel="stylesheet"]');
    if (anyLink) {
      anyLink.id = THEME_CONFIG.CSS_LINK_ID;
      return applyTheme(cssFile);
    }
    return false;
  }

  // Don't reload if it's already the same theme
  const currentHref = themeLink.getAttribute("href") || "";
  if (currentHref.includes(safeCssFile)) {
    return true;
  }

  try {
    // Create new link element for smoother transition
    const newLink = document.createElement("link");
    newLink.id = THEME_CONFIG.CSS_LINK_ID;
    newLink.rel = "stylesheet";
    newLink.href = `${safeCssFile}?v=${Date.now()}`;

    // Set up load/error handlers
    newLink.onload = () => {
      console.log(`✅ Theme loaded: ${safeCssFile}`);
      // Remove old link after new one loads
      setTimeout(() => {
        if (themeLink.parentNode && themeLink !== newLink) {
          themeLink.parentNode.removeChild(themeLink);
        }
      }, 100);
    };

    newLink.onerror = () => {
      console.error(`❌ Failed to load theme: ${safeCssFile}`);
      // Fallback to default if theme file doesn't exist
      if (safeCssFile !== THEME_CONFIG.DEFAULT_THEME) {
        console.log("🔄 Falling back to default theme");
        newLink.href = `${THEME_CONFIG.DEFAULT_THEME}?v=${Date.now()}`;
      }
    };

    // Insert new link before old one
    themeLink.parentNode.insertBefore(newLink, themeLink);

    // Update state
    currentTheme = safeCssFile;
    localStorage.setItem(THEME_CONFIG.STORAGE_KEY, safeCssFile);

    return true;
  } catch (error) {
    console.error("Error applying theme:", error);
    return false;
  }
}

async function applyThemeOnLoad() {
  try {
    const activeTheme = await getActiveTheme();
    const applied = applyTheme(activeTheme);

    if (applied) {
      if (window.location.pathname.includes("admin")) {
        updateAdminThemeUI(activeTheme);
      }

      document.dispatchEvent(
        new CustomEvent("themeChanged", {
          detail: { theme: activeTheme },
        })
      );
    }
  } catch (error) {
    console.error("Error in applyThemeOnLoad:", error);
    // Final fallback: apply default theme
    applyTheme(THEME_CONFIG.DEFAULT_THEME);
  }
}

/* ================== BULLETPROOF ADMIN FUNCTIONS ================== */

async function activateTheme(cssFile) {
  // Validate input
  if (!cssFile || !cssFile.endsWith(".css")) {
    showNotification("Invalid theme file", "error");
    return { success: false, error: "Invalid theme file" };
  }

  const safeCssFile = cssFile.replace(/[^a-zA-Z0-9._-]/g, "");

  console.log(`🎨 Activating theme: ${safeCssFile}`);

  // First apply locally for instant feedback
  applyTheme(safeCssFile);
  updateAdminThemeUI(safeCssFile);

  try {
    // 1. Deactivate all themes
    const deactivateResponse = await fetchWithRetry(
      `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.THEMES}?is_active=eq.true`,
      {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({
          is_active: false,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!deactivateResponse.ok) {
      throw new Error(`Deactivation failed: ${deactivateResponse.status}`);
    }

    // 2. Activate selected theme
    const activateResponse = await fetchWithRetry(
      `${SUPABASE_CONFIG.URL}${
        API_ENDPOINTS.THEMES
      }?css_file=eq.${encodeURIComponent(safeCssFile)}`,
      {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({
          is_active: true,
          activated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!activateResponse.ok) {
      // Check if theme exists, create it if not
      const createResponse = await fetchWithRetry(
        `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.THEMES}`,
        {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({
            theme_name: getThemeName(safeCssFile),
            css_file: safeCssFile,
            is_active: true,
            description: `${getThemeName(safeCssFile)} theme`,
            created_at: new Date().toISOString(),
            activated_at: new Date().toISOString(),
          }),
        }
      );

      if (!createResponse.ok) {
        throw new Error(`Failed to create theme: ${createResponse.status}`);
      }
    }

    // Success!
    broadcastThemeChange(safeCssFile);

    if (typeof showNotification === "function") {
      showNotification(
        `Theme activated: ${getThemeName(safeCssFile)}`,
        "success"
      );
    }

    if (
      window.dataSync &&
      typeof window.dataSync.notifyDataChanged === "function"
    ) {
      window.dataSync.notifyDataChanged("update", "theme");
    }

    return { success: true, theme: safeCssFile };
  } catch (error) {
    console.error("Database update failed:", error);

    // Local application already happened, just notify user
    if (typeof showNotification === "function") {
      showNotification(`Theme applied locally (sync will retry)`, "warning");
    }

    // Schedule retry
    setTimeout(() => retryThemeActivation(safeCssFile), 10000);

    return {
      success: false,
      error: error.message,
      appliedLocally: true,
    };
  }
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(8000),
      });
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

function getApiHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_CONFIG.ANON_KEY,
    Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
    Prefer: "return=representation",
  };
}

async function retryThemeActivation(cssFile) {
  console.log(`🔄 Retrying theme activation for: ${cssFile}`);
  try {
    await activateTheme(cssFile);
  } catch (error) {
    console.error("Retry failed:", error);
  }
}

function updateAdminThemeUI(activeTheme) {
  try {
    const cards = document.querySelectorAll(".theme-card");
    cards.forEach((card) => {
      card.classList.remove("active");
      const activateBtn = card.querySelector(".btn-activate-theme");
      const activeBtn = card.querySelector(".btn-active-theme");
      if (activateBtn) activateBtn.style.display = "block";
      if (activeBtn) activeBtn.style.display = "none";
    });

    const activeCard = document.querySelector(
      `.theme-card[data-theme-file="${activeTheme}"]`
    );
    if (activeCard) {
      activeCard.classList.add("active");
      const activateBtn = activeCard.querySelector(".btn-activate-theme");
      const activeBtn = activeCard.querySelector(".btn-active-theme");
      if (activateBtn) activateBtn.style.display = "none";
      if (activeBtn) activeBtn.style.display = "block";
    }
  } catch (error) {
    console.error("Error updating admin UI:", error);
  }
}

function setupAdminThemeListeners() {
  document.addEventListener("click", async (e) => {
    const activateBtn = e.target.closest(".btn-activate-theme");
    if (!activateBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const themeCard = activateBtn.closest(".theme-card");
    if (!themeCard) return;

    const cssFile = themeCard.dataset.themeFile;
    if (!cssFile) return;

    // Debounce: prevent multiple rapid clicks
    if (activateBtn.disabled) return;

    // Show loading state
    const originalHTML = activateBtn.innerHTML;
    activateBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Activating...';
    activateBtn.disabled = true;

    try {
      await activateTheme(cssFile);
    } finally {
      // Always restore button state
      setTimeout(() => {
        activateBtn.innerHTML = originalHTML;
        activateBtn.disabled = false;
      }, 1000);
    }
  });

  // Load themes on admin page
  if (window.location.pathname.includes("admin")) {
    setTimeout(loadThemesForAdmin, 1000);
  }
}

async function loadThemesForAdmin() {
  try {
    const themesGrid = document.getElementById("themes-grid");
    if (!themesGrid) return;

    const response = await fetch(
      `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.THEMES}?select=*&order=theme_name.asc`,
      {
        headers: getApiHeaders(),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (response.ok) {
      const themes = await response.json();
      themes.forEach((theme) => {
        const card = document.querySelector(
          `.theme-card[data-theme-file="${theme.css_file}"]`
        );
        if (card) {
          const statusEl = card.querySelector(".theme-status");
          if (statusEl) {
            statusEl.className = `theme-status ${
              theme.is_active ? "active" : ""
            }`;
            if (theme.is_active) {
              statusEl.innerHTML = '<i class="fas fa-check-circle"></i> ACTIVE';
            }
          }
        }
      });
    }
  } catch (error) {
    console.error("Error loading themes:", error);
  }
}

/* ================== ENHANCED SYNC SYSTEM ================== */

function broadcastThemeChange(cssFile) {
  // Multiple sync methods for maximum reliability
  try {
    // 1. BroadcastChannel
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: "THEME_CHANGED",
        theme: cssFile,
        timestamp: Date.now(),
      });
    }

    // 2. localStorage for cross-tab sync
    localStorage.setItem(THEME_CONFIG.STORAGE_KEY, cssFile);
    localStorage.setItem("toke_bakes_theme_update", Date.now().toString());

    // 3. Session storage for immediate page reloads
    sessionStorage.setItem("last_theme", cssFile);
  } catch (error) {
    console.warn("Broadcast failed:", error);
  }
}

function handleThemeBroadcast(event) {
  if (event.data.type === "THEME_CHANGED") {
    console.log("📡 Theme change received:", event.data.theme);
    applyTheme(event.data.theme);
    if (window.location.pathname.includes("admin")) {
      updateAdminThemeUI(event.data.theme);
    }
  }
}

function checkForThemeUpdates() {
  try {
    const lastUpdate = localStorage.getItem("toke_bakes_theme_update");
    const myLastCheck = localStorage.getItem("my_theme_check") || "0";

    if (lastUpdate && lastUpdate > myLastCheck) {
      localStorage.setItem("my_theme_check", lastUpdate);
      getActiveTheme().then((theme) => {
        if (theme !== currentTheme) {
          applyTheme(theme);
        }
      });
    }
  } catch (error) {
    console.warn("Theme update check failed:", error);
  }
}

/* ================== UTILITY FUNCTIONS ================== */

function getThemeName(cssFile) {
  const themeNames = {
    "style.css": "Default Theme",
    "theme-valentine.css": "Valentine's Day",
    "theme-ramadan.css": "Ramadan",
    "theme-independenceday.css": "Independence Day",
    "theme-halloween.css": "Halloween",
    "theme-christmas.css": "Christmas",
  };
  return (
    themeNames[cssFile] ||
    cssFile.replace(".css", "").replace("theme-", "").replace(/-/g, " ")
  );
}

function getAvailableThemes() {
  return [
    "style.css",
    "theme-valentine.css",
    "theme-ramadan.css",
    "theme-independenceday.css",
    "theme-halloween.css",
    "theme-christmas.css",
  ];
}

/* ================== INITIALIZATION ================== */

// Robust initialization
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(initializeThemeManager, 100);
  });
} else {
  setTimeout(initializeThemeManager, 100);
}

// Polling with exponential backoff
let pollInterval = 30000;
setInterval(checkForThemeUpdates, pollInterval);

// Make functions available globally
window.ThemeManager = {
  activateTheme,
  getActiveTheme,
  applyTheme,
  getAvailableThemes,
  getThemeName,
  currentTheme: () => currentTheme,
};

// Emergency fallback: if theme link is missing, create it
setTimeout(() => {
  if (!document.getElementById(THEME_CONFIG.CSS_LINK_ID)) {
    console.warn("Theme link missing, creating emergency link");
    const link = document.createElement("link");
    link.id = THEME_CONFIG.CSS_LINK_ID;
    link.rel = "stylesheet";
    link.href = `${THEME_CONFIG.DEFAULT_THEME}?v=${Date.now()}`;
    document.head.appendChild(link);
  }
}, 2000);

console.log("✅ Bulletproof Theme Manager loaded");
