/* ================== theme-manager.js ================== */
/* HYBRID VERSION - Supports both holiday themes AND dark/light toggle */

const ThemeManager = {
  currentTheme: "style.css",
  currentMode: "light", // 'light' or 'dark'
  isInitialized: false,

  // Initialize both theme and mode
  init() {
    if (this.isInitialized) return;

    console.log("🎨 Initializing Hybrid Theme Manager");

    // Load saved theme AND mode
    const savedTheme =
      localStorage.getItem("toke_bakes_css_theme") || "style.css";
    const savedMode = localStorage.getItem("toke_bakes_theme_mode") || "light";

    // Check if theme file exists
    this.checkThemeFileExists(savedTheme)
      .then((exists) => {
        if (exists && savedTheme) {
          this.currentTheme = savedTheme;
          this.currentMode = savedMode;

          // Apply theme AND mode
          this.applyTheme(savedTheme, false);
          this.setMode(savedMode, false);

          console.log(`✅ Loaded: ${savedTheme} (${savedMode} mode)`);
        } else {
          console.log("✅ Using default theme and light mode");
          this.applyTheme("style.css", false);
          this.setMode("light", false);
        }

        this.isInitialized = true;

        // Setup admin panel if needed
        if (this.isAdminPanel()) {
          this.setupAdminListeners();
          this.updateAdminUI(this.currentTheme);
          this.updateModeToggle(this.currentMode);
        }

        // Setup mode toggle for main site
        this.setupModeToggle();
      })
      .catch(() => {
        console.log("⚠️ Fallback to defaults");
        this.applyTheme("style.css", false);
        this.setMode("light", false);
      });
  },

  // Check if theme file exists
  async checkThemeFileExists(cssFile) {
    if (!cssFile || cssFile === "style.css") return true;

    try {
      const response = await fetch(cssFile, { method: "HEAD" });
      return response.ok;
    } catch (error) {
      console.warn(`⚠️ Theme file check failed: ${error}`);
      return false;
    }
  },

  // Check if we're in admin panel
  isAdminPanel() {
    return (
      window.location.pathname.includes("admin") ||
      document.querySelector(".admin-dashboard") ||
      document.querySelector(".admin-login-container")
    );
  },

  // Apply theme CSS file
  applyTheme(cssFile, saveToDB = true) {
    if (this.currentTheme === cssFile) {
      console.log(`ℹ️ Already using theme: ${cssFile}`);
      return false;
    }

    const themeLink = document.getElementById("theme-stylesheet");
    if (!themeLink) {
      console.error("❌ ERROR: #theme-stylesheet element not found!");
      return false;
    }

    console.log(`🎨 Applying theme file: ${cssFile}`);

    // Add timestamp to prevent caching
    const timestamp = Date.now();
    const newHref = `${cssFile}?v=${timestamp}`;

    // Preload to check if file exists
    const preloadLink = document.createElement("link");
    preloadLink.rel = "preload";
    preloadLink.as = "style";
    preloadLink.href = newHref;

    preloadLink.onload = () => {
      console.log(`✅ Theme file loaded: ${cssFile}`);
      this.swapThemeStylesheet(themeLink, newHref, cssFile, saveToDB);
    };

    preloadLink.onerror = () => {
      console.error(`❌ Theme file NOT FOUND: ${cssFile}`);

      // Fallback to default
      this.swapThemeStylesheet(
        themeLink,
        `style.css?v=${timestamp}`,
        "style.css",
        saveToDB
      );

      if (typeof showNotification === "function") {
        showNotification(
          `Theme "${cssFile}" not found. Using default.`,
          "error"
        );
      }
    };

    document.head.appendChild(preloadLink);
    return true;
  },

  // Set dark/light mode
  setMode(mode, save = true) {
    if (this.currentMode === mode) return;

    console.log(`🌓 Setting mode: ${mode}`);

    // Apply to HTML element
    document.documentElement.setAttribute("data-theme", mode);
    this.currentMode = mode;

    // Update mode toggle button
    this.updateModeToggle(mode);

    // Save to localStorage
    if (save) {
      localStorage.setItem("toke_bakes_theme_mode", mode);
    }

    // Force CSS recalculation
    this.forceStyleRecalc();

    console.log(`✅ Mode set to: ${mode}`);

    // Notify other tabs
    this.notifyModeChange(mode);

    return true;
  },

  // Toggle between dark/light
  toggleMode() {
    const newMode = this.currentMode === "light" ? "dark" : "light";
    return this.setMode(newMode, true);
  },

  // Swap the stylesheet
  swapThemeStylesheet(themeLink, newHref, cssFile, saveToDB) {
    const oldHref = themeLink.href;

    // Apply new theme
    themeLink.href = newHref;
    this.currentTheme = cssFile;

    // Save to localStorage
    localStorage.setItem("toke_bakes_css_theme", cssFile);

    // Force CSS reflow
    this.forceStyleRecalc();

    console.log(`✅ Theme applied: ${cssFile}`);

    // Update admin UI
    if (this.isAdminPanel()) {
      this.updateAdminUI(cssFile);
    }

    // Save to database
    if (saveToDB && cssFile !== "style.css") {
      this.saveToDatabase(cssFile);
    }

    // Notify
    this.notifyThemeChange(cssFile);

    // Show notification
    if (typeof showNotification === "function" && cssFile !== "style.css") {
      const themeName = this.getThemeName(cssFile);
      showNotification(`${themeName} theme activated!`, "success");
    }

    return true;
  },

  // Force style recalculation
  forceStyleRecalc() {
    document.body.style.display = "none";
    document.body.offsetHeight; // Trigger reflow
    document.body.style.display = "";
  },

  // Setup mode toggle button
  setupModeToggle() {
    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) return;

    // Remove any existing listeners by cloning
    const newToggle = themeToggle.cloneNode(true);
    themeToggle.parentNode.replaceChild(newToggle, themeToggle);

    // Get icons
    const sunIcon = newToggle.querySelector(".sun");
    const moonIcon = newToggle.querySelector(".moon");

    // Initial icon setup
    this.updateModeToggleUI(newToggle, sunIcon, moonIcon, this.currentMode);

    // Click handler
    newToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      this.toggleMode();
    });

    // Listen for mode changes from other tabs
    window.addEventListener("storage", (e) => {
      if (e.key === "toke_bakes_theme_mode") {
        const mode = localStorage.getItem("toke_bakes_theme_mode") || "light";
        if (mode !== this.currentMode) {
          this.setMode(mode, false);
          this.updateModeToggleUI(newToggle, sunIcon, moonIcon, mode);
        }
      }
    });
  },

  // Update mode toggle UI
  updateModeToggleUI(toggle, sunIcon, moonIcon, mode) {
    if (!toggle) return;

    if (mode === "dark") {
      if (sunIcon) sunIcon.style.display = "none";
      if (moonIcon) moonIcon.style.display = "inline-block";
      toggle.classList.add("dark");
      toggle.setAttribute("aria-label", "Switch to light mode");
    } else {
      if (sunIcon) sunIcon.style.display = "inline-block";
      if (moonIcon) moonIcon.style.display = "none";
      toggle.classList.remove("dark");
      toggle.setAttribute("aria-label", "Switch to dark mode");
    }
  },

  // Update mode toggle state
  updateModeToggle(mode) {
    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) return;

    const sunIcon = themeToggle.querySelector(".sun");
    const moonIcon = themeToggle.querySelector(".moon");

    this.updateModeToggleUI(themeToggle, sunIcon, moonIcon, mode);
  },

  // Save theme to database
  async saveToDatabase(cssFile) {
    try {
      if (!window.SUPABASE_CONFIG || !window.API_ENDPOINTS) {
        return;
      }

      // Deactivate all themes
      await fetch(`${SUPABASE_CONFIG.URL}${API_ENDPOINTS.THEMES}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        },
        body: JSON.stringify({
          is_active: false,
          updated_at: new Date().toISOString(),
        }),
      });

      // Activate selected theme
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}${
          API_ENDPOINTS.THEMES
        }?css_file=eq.${encodeURIComponent(cssFile)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          },
          body: JSON.stringify({
            is_active: true,
            activated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        }
      );

      if (response.ok) {
        console.log(`✅ Theme saved to database: ${cssFile}`);
      }
    } catch (error) {
      console.error("Database save failed:", error);
    }
  },

  // Update admin panel UI
  updateAdminUI(cssFile) {
    const themeCards = document.querySelectorAll(".theme-card");

    themeCards.forEach((card) => {
      const themeFile = card.dataset.themeFile;
      const activateBtn = card.querySelector(".btn-activate-theme");
      const activeBtn = card.querySelector(".btn-active-theme");
      const statusEl = card.querySelector(".theme-status");

      // Reset
      card.classList.remove("active");

      if (activateBtn) {
        activateBtn.style.display = "block";
        activateBtn.disabled = false;
        activateBtn.innerHTML = '<i class="fas fa-play"></i> Activate';
      }

      if (activeBtn) {
        activeBtn.style.display = "none";
      }

      if (statusEl) {
        statusEl.classList.remove("active");
        statusEl.innerHTML = `<i class="${this.getThemeIcon(
          themeFile
        )}"></i> ${this.getThemeName(themeFile)}`;
      }

      // Mark as active
      if (themeFile === cssFile) {
        card.classList.add("active");

        if (activateBtn) {
          activateBtn.style.display = "none";
        }

        if (activeBtn) {
          activeBtn.style.display = "block";
          activeBtn.innerHTML = '<i class="fas fa-check"></i> Active';
        }

        if (statusEl) {
          statusEl.classList.add("active");
          statusEl.innerHTML = '<i class="fas fa-check-circle"></i> ACTIVE';
        }
      }
    });
  },

  // Setup admin listeners
  setupAdminListeners() {
    // Theme activation
    document.addEventListener("click", (e) => {
      const activateBtn = e.target.closest(".btn-activate-theme");
      if (!activateBtn) return;

      const themeCard = activateBtn.closest(".theme-card");
      if (!themeCard) return;

      const cssFile = themeCard.dataset.themeFile;
      if (!cssFile) return;

      // Apply theme
      activateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      activateBtn.disabled = true;

      setTimeout(() => {
        this.applyTheme(cssFile, true);

        setTimeout(() => {
          activateBtn.innerHTML = '<i class="fas fa-check"></i> Active';
        }, 500);
      }, 300);
    });
  },

  // Get theme icon
  getThemeIcon(cssFile) {
    const icons = {
      "style.css": "fas fa-sun",
      "theme-valentine.css": "fas fa-heart",
      "theme-ramadan.css": "fas fa-moon",
      "theme-independenceday.css": "fas fa-flag",
      "theme-halloween.css": "fas fa-ghost",
      "theme-christmas.css": "fas fa-tree",
    };
    return icons[cssFile] || "fas fa-palette";
  },

  // Get theme name
  getThemeName(cssFile) {
    const names = {
      "style.css": "Default Theme",
      "theme-valentine.css": "Valentine's Day",
      "theme-ramadan.css": "Ramadan",
      "theme-independenceday.css": "Independence Day",
      "theme-halloween.css": "Halloween",
      "theme-christmas.css": "Christmas",
    };
    return (
      names[cssFile] ||
      cssFile.replace("theme-", "").replace(".css", "").replace(/-/g, " ")
    );
  },

  // Notify theme change
  notifyThemeChange(cssFile) {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel("toke_bakes_theme_updates");
        channel.postMessage({
          type: "THEME_CHANGED",
          theme: cssFile,
          timestamp: Date.now(),
        });
      } catch (error) {}
    }

    localStorage.setItem("toke_bakes_last_theme_update", Date.now().toString());
  },

  // Notify mode change
  notifyModeChange(mode) {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel("toke_bakes_mode_updates");
        channel.postMessage({
          type: "MODE_CHANGED",
          mode: mode,
          timestamp: Date.now(),
        });
      } catch (error) {}
    }
  },
};

// Listen for theme/mode changes from other tabs
if (typeof BroadcastChannel !== "undefined") {
  // Theme changes
  const themeChannel = new BroadcastChannel("toke_bakes_theme_updates");
  themeChannel.onmessage = (event) => {
    if (event.data.type === "THEME_CHANGED") {
      ThemeManager.applyTheme(event.data.theme, false);
    }
  };

  // Mode changes
  const modeChannel = new BroadcastChannel("toke_bakes_mode_updates");
  modeChannel.onmessage = (event) => {
    if (event.data.type === "MODE_CHANGED") {
      ThemeManager.setMode(event.data.mode, false);
    }
  };
}

// Storage event listeners
window.addEventListener("storage", (event) => {
  if (event.key === "toke_bakes_last_theme_update") {
    const savedTheme = localStorage.getItem("toke_bakes_css_theme");
    if (savedTheme && savedTheme !== ThemeManager.currentTheme) {
      ThemeManager.applyTheme(savedTheme, false);
    }
  }

  if (event.key === "toke_bakes_theme_mode") {
    const mode = localStorage.getItem("toke_bakes_theme_mode") || "light";
    if (mode !== ThemeManager.currentMode) {
      ThemeManager.setMode(mode, false);
    }
  }
});

// Initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    ThemeManager.init();
  });
} else {
  ThemeManager.init();
}

// Global access for debugging
window.ThemeManager = ThemeManager;

console.log("✅ Hybrid Theme Manager loaded");
