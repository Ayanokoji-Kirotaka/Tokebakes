/* ==================== theme-manager.js - UPDATED WITH CACHE INTEGRATION ==================== */
const ThemeManager = {
  currentTheme: "styles/style.css",
  currentMode: "light",
  lastThemeUpdate: 0,

  /* ================== INITIALIZATION ================== */
  init() {
    console.log("🎨 Theme Manager Initialized with Cache Support");

    // Load saved preferences with cache fallback
    this.loadThemeWithCache();

    // Apply dark/light mode
    document.documentElement.setAttribute("data-theme", this.currentMode);

    // Setup admin panel
    if (this.isAdminPanel()) {
      this.setupAdminListeners();
      this.updateAdminUI(this.currentTheme);
    }

    // Setup dark/light toggle
    this.setupModeToggle();

    // Initialize footer with saved mode
    this.updateFooterTheme(this.currentMode);

    // Setup theme auto-update detection
    this.setupThemeAutoUpdate();
  },

  /* ================== CACHE-ENHANCED THEME LOADING ================== */
  loadThemeWithCache() {
    // Try to get from cache first
    const cachedThemes = this.loadThemesFromCache();

    if (cachedThemes && cachedThemes.length > 0) {
      console.log("🎨 Themes loaded from cache");
    }

    // Load user preference
    const savedTheme =
      localStorage.getItem("toke_bakes_css_theme") || "styles/style.css";
    const savedMode = localStorage.getItem("toke_bakes_theme_mode") || "light";

    this.currentTheme = this.fixLegacyThemePath(savedTheme);
    this.currentMode = savedMode;

    // Apply theme immediately
    this.applyTheme(this.currentTheme, false, false);

    // Fetch fresh themes in background
    setTimeout(() => this.loadFreshThemes(), 100);
  },

  loadThemesFromCache() {
    try {
      const stored = localStorage.getItem(CACHE_CONFIG.KEYS.THEMES);
      if (stored) {
        const cached = JSON.parse(stored);
        if (
          Date.now() - cached.timestamp < cached.expiry &&
          cached.version === CACHE_CONFIG.VERSION
        ) {
          return cached.data;
        }
      }
    } catch (error) {
      console.error("Error loading themes from cache:", error);
    }
    return null;
  },

  async loadFreshThemes() {
    try {
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.THEMES}?select=*`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const themes = await response.json();

        // Cache the themes
        const cacheData = {
          data: themes,
          timestamp: Date.now(),
          expiry: CACHE_CONFIG.EXPIRY.THEMES,
          version: CACHE_CONFIG.VERSION,
        };
        localStorage.setItem(
          CACHE_CONFIG.KEYS.THEMES,
          JSON.stringify(cacheData)
        );

        console.log("✅ Themes cached successfully");

        // Update admin UI if needed
        if (this.isAdminPanel()) {
          this.updateAdminUI(this.currentTheme);
        }
      }
    } catch (error) {
      console.error("Error loading fresh themes:", error);
    }
  },

  /* ================== THEME AUTO-UPDATE SYSTEM ================== */
  setupThemeAutoUpdate() {
    // Check for theme updates every 30 seconds
    setInterval(() => this.checkForThemeUpdates(), 30000);

    // Also check when page becomes visible
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.checkForThemeUpdates();
      }
    });

    // Listen for broadcast channel messages about theme changes
    if (typeof BroadcastChannel !== "undefined") {
      this.themeChannel = new BroadcastChannel("toke_bakes_theme_updates");
      this.themeChannel.onmessage = (event) => {
        if (event.data.type === "THEME_CHANGED") {
          console.log("📡 Theme update received via BroadcastChannel");
          this.applyTheme(event.data.themeFile, false);
        }
      };
    }

    // Check localStorage for theme updates
    this.checkForThemeUpdates();
  },

  checkForThemeUpdates() {
    const lastUpdate = localStorage.getItem("toke_bakes_theme_last_update");
    const myLastCheck = localStorage.getItem("my_theme_check") || "0";

    if (lastUpdate && lastUpdate > myLastCheck) {
      console.log("🔄 Theme update detected!");

      const newTheme =
        localStorage.getItem("toke_bakes_css_theme") || "styles/style.css";
      localStorage.setItem("my_theme_check", lastUpdate);

      if (newTheme !== this.currentTheme) {
        this.applyTheme(newTheme, false);
      }
      return true;
    }
    return false;
  },

  /* ================== APPLY THEME FUNCTION ================== */
  applyTheme(cssFile, saveToDB = true, isAdminChange = false) {
    console.log("🎨 Applying theme:", cssFile, "isAdminChange:", isAdminChange);

    this.currentTheme = cssFile;

    if (saveToDB) {
      localStorage.setItem("toke_bakes_css_theme", cssFile);

      const timestamp = Date.now().toString();
      localStorage.setItem("toke_bakes_theme_last_update", timestamp);

      if (isAdminChange && this.themeChannel) {
        this.themeChannel.postMessage({
          type: "THEME_CHANGED",
          themeFile: cssFile,
          themeName: this.getThemeName(cssFile),
          timestamp: timestamp,
        });
      }
    }

    try {
      const link = document.getElementById("theme-stylesheet");
      if (link) {
        link.href = cssFile + "?v=" + Date.now();
        console.log("✅ Theme CSS updated to:", cssFile);
      }
    } catch (error) {
      console.error("❌ Error applying theme:", error);
    }

    this.updateFooterTheme(this.currentMode);

    if (this.isAdminPanel()) {
      this.updateAdminUI(cssFile);
    }

    if (
      typeof showNotification === "function" &&
      cssFile !== "styles/style.css" &&
      isAdminChange
    ) {
      showNotification(
        `${this.getThemeName(
          cssFile
        )} theme activated! Visitors will see this change automatically.`,
        "success"
      );
    }

    return true;
  },

  /* ================== FIXED: ADMIN THEME ACTIVATION ================== */
  setupAdminListeners() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-activate-theme");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();

        const card = btn.closest(".theme-card");
        if (card && card.dataset.themeFile) {
          const themeFile = card.dataset.themeFile;
          console.log("Admin theme activation:", themeFile);
          this.applyTheme(themeFile, true, true);
        }
      }
    });
  },

  /* ================== OTHER FUNCTIONS ================== */
  updateFooterTheme(theme) {
    const footer = document.querySelector(".bakes-footer");
    if (!footer) {
      console.log("ℹ️ No .bakes-footer element found");
      return;
    }

    if (!theme) {
      theme = this.currentMode;
    }

    if (theme === "dark") {
      footer.classList.remove("light-theme");
      footer.classList.add("dark-theme");
    } else {
      footer.classList.remove("dark-theme");
      footer.classList.add("light-theme");
    }
  },

  toggleMode() {
    const newMode = this.currentMode === "light" ? "dark" : "light";
    this.currentMode = newMode;

    document.documentElement.setAttribute("data-theme", newMode);
    localStorage.setItem("toke_bakes_theme_mode", newMode);

    this.updateModeToggleUI();
    this.updateFooterTheme(newMode);

    console.log(`🌓 Mode changed to ${newMode}`);

    return true;
  },

  updateModeToggleUI() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    const sun = toggle.querySelector(".sun");
    const moon = toggle.querySelector(".moon");

    if (this.currentMode === "dark") {
      if (sun) sun.style.display = "none";
      if (moon) moon.style.display = "inline-block";
      toggle.classList.add("dark");
    } else {
      if (sun) sun.style.display = "inline-block";
      if (moon) moon.style.display = "none";
      toggle.classList.remove("dark");
    }
  },

  setupModeToggle() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      this.toggleMode();
    });

    this.updateModeToggleUI();
  },

  isAdminPanel() {
    return document.querySelector(".theme-card") !== null;
  },

  updateAdminUI(cssFile) {
    console.log("🔄 Updating admin UI for theme:", cssFile);

    const themeCards = document.querySelectorAll(".theme-card");
    if (themeCards.length === 0) return;

    themeCards.forEach((card) => {
      const file = card.dataset.themeFile;
      card.classList.remove("active");

      const status = card.querySelector(".theme-status");
      if (status) {
        status.classList.remove("active");
        if (file === "styles/style.css") {
          status.innerHTML = '<i class="fas fa-palette"></i> DEFAULT';
        } else if (file === "styles/theme-christmas.css") {
          status.innerHTML = '<i class="fas fa-tree"></i> CHRISTMAS';
        } else if (file === "styles/theme-valentine.css") {
          status.innerHTML = '<i class="fas fa-heart"></i> VALENTINE';
        } else if (file === "styles/theme-ramadan.css") {
          status.innerHTML = '<i class="fas fa-moon"></i> RAMADAN';
        } else if (file === "styles/theme-halloween.css") {
          status.innerHTML = '<i class="fas fa-ghost"></i> HALLOWEEN';
        } else if (file === "styles/theme-independenceday.css") {
          status.innerHTML = '<i class="fas fa-flag"></i> INDEPENDENCE';
        }
      }
    });

    const activeCard = document.querySelector(`[data-theme-file="${cssFile}"]`);
    if (activeCard) {
      activeCard.classList.add("active");

      const status = activeCard.querySelector(".theme-status");
      if (status) {
        status.classList.add("active");
        status.innerHTML = '<i class="fas fa-check-circle"></i> ACTIVE';
      }
    }
  },

  getThemeName(cssFile) {
    const themeNames = {
      "styles/style.css": "Default Theme",
      "styles/theme-christmas.css": "Christmas",
      "styles/theme-valentine.css": "Valentine's Day",
      "styles/theme-ramadan.css": "Ramadan",
      "styles/theme-independenceday.css": "Independence Day",
      "styles/theme-halloween.css": "Halloween",
    };
    return themeNames[cssFile] || cssFile;
  },

  getCurrentThemeName() {
    return this.getThemeName(this.currentTheme);
  },

  resetToDefault() {
    this.applyTheme("styles/style.css", true, true);
  },

  fixLegacyThemePath(cssFile) {
    if (cssFile === "style.css") return "styles/style.css";
    if (cssFile === "theme-christmas.css") return "styles/theme-christmas.css";
    if (cssFile === "theme-valentine.css") return "styles/theme-valentine.css";
    if (cssFile === "theme-ramadan.css") return "styles/theme-ramadan.css";
    if (cssFile === "theme-halloween.css") return "styles/theme-halloween.css";
    if (cssFile === "theme-independenceday.css")
      return "styles/theme-independenceday.css";

    return cssFile;
  },
};

// Make globally accessible
window.ThemeManager = ThemeManager;

// Auto-initialize with legacy path fix
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem("toke_bakes_css_theme");
    if (savedTheme && !savedTheme.includes("styles/")) {
      const fixedTheme = ThemeManager.fixLegacyThemePath(savedTheme);
      if (fixedTheme !== savedTheme) {
        console.log("🔄 Fixed legacy theme path:", savedTheme, "→", fixedTheme);
        localStorage.setItem("toke_bakes_css_theme", fixedTheme);
      }
    }
    ThemeManager.init();
  });
} else {
  const savedTheme = localStorage.getItem("toke_bakes_css_theme");
  if (savedTheme && !savedTheme.includes("styles/")) {
    const fixedTheme = ThemeManager.fixLegacyThemePath(savedTheme);
    if (fixedTheme !== savedTheme) {
      console.log("🔄 Fixed legacy theme path:", savedTheme, "→", fixedTheme);
      localStorage.setItem("toke_bakes_css_theme", fixedTheme);
    }
  }
  ThemeManager.init();
}

console.log("✅ Theme Manager loaded with Cache Support!");
