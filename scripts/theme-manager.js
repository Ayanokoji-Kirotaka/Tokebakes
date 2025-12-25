/* ==================== THEME MANAGER - UPDATED FOR AUTO-UPDATE ==================== */
const ThemeManager = {
  currentTheme: "styles/style.css",
  currentMode: "light",
  lastThemeUpdate: 0,

  /* ================== INITIALIZATION ================== */
  init() {
    console.log("🎨 Theme Manager Initialized - FIXED VERSION");

    // Load saved preferences
    const savedTheme =
      localStorage.getItem("toke_bakes_css_theme") || "styles/style.css";
    const savedMode = localStorage.getItem("toke_bakes_theme_mode") || "light";

    this.currentTheme = savedTheme;
    this.currentMode = savedMode;

    // Apply dark/light mode
    document.documentElement.setAttribute("data-theme", savedMode);

    // Apply saved theme WITHOUT modifying the path
    this.applyTheme(savedTheme, false);

    // Setup admin panel
    if (this.isAdminPanel()) {
      this.setupAdminListeners();
      this.updateAdminUI(savedTheme);
    }

    // Setup dark/light toggle
    this.setupModeToggle();

    // Initialize footer with saved mode
    this.updateFooterTheme(savedMode);

    // Setup theme auto-update detection
    this.setupThemeAutoUpdate();
  },

  /* ================== NEW: THEME AUTO-UPDATE SYSTEM ================== */
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
    // Get the last theme update timestamp from localStorage
    const lastUpdate = localStorage.getItem("toke_bakes_theme_last_update");
    const myLastCheck = localStorage.getItem("my_theme_check") || "0";

    if (lastUpdate && lastUpdate > myLastCheck) {
      console.log("🔄 Theme update detected!");

      // Get the new theme
      const newTheme =
        localStorage.getItem("toke_bakes_css_theme") || "styles/style.css";

      // Update my last check timestamp
      localStorage.setItem("my_theme_check", lastUpdate);

      // Apply the new theme
      if (newTheme !== this.currentTheme) {
        this.applyTheme(newTheme, false);
      }
      return true;
    }
    return false;
  },

  /* ================== FIXED: APPLY THEME FUNCTION ================== */
  applyTheme(cssFile, saveToDB = true, isAdminChange = false) {
    console.log("🎨 Applying theme:", cssFile, "isAdminChange:", isAdminChange);

    // ⚠️ CRITICAL FIX: DO NOT modify the cssFile path here!
    // The path should already be correct (e.g., "styles/style.css")
    // Your HTML files already point to the correct location

    // Store the exact path as provided
    this.currentTheme = cssFile;

    // Save to localStorage (exact path)
    if (saveToDB) {
      localStorage.setItem("toke_bakes_css_theme", cssFile);

      // Set update timestamp for auto-update system
      const timestamp = Date.now().toString();
      localStorage.setItem("toke_bakes_theme_last_update", timestamp);

      // Broadcast to other tabs if admin is making the change
      if (isAdminChange && this.themeChannel) {
        this.themeChannel.postMessage({
          type: "THEME_CHANGED",
          themeFile: cssFile,
          themeName: this.getThemeName(cssFile),
          timestamp: timestamp,
        });
      }
    }

    // Apply theme CSS - Use exact path without modification
    try {
      const link = document.getElementById("theme-stylesheet");
      if (link) {
        // Add cache-busting parameter but keep the path as-is
        link.href = cssFile + "?v=" + Date.now();
        console.log("✅ Theme CSS updated to:", cssFile);
      }
    } catch (error) {
      console.error("❌ Error applying theme:", error);
    }

    // Update footer to match current mode
    this.updateFooterTheme(this.currentMode);

    // Update admin UI
    if (this.isAdminPanel()) {
      this.updateAdminUI(cssFile);
    }

    // Show notification ONLY for admin theme changes (not dark/light toggle)
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
          // ⚠️ CRITICAL: Use the exact theme file from data attribute
          // Admin panel cards MUST have correct paths like "styles/style.css"
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

    // Apply the mode change
    document.documentElement.setAttribute("data-theme", newMode);
    localStorage.setItem("toke_bakes_theme_mode", newMode);

    // Update UI elements
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

    // Reset ALL cards
    themeCards.forEach((card) => {
      const file = card.dataset.themeFile;
      card.classList.remove("active");

      const status = card.querySelector(".theme-status");
      if (status) {
        status.classList.remove("active");
        // Set default icons based on file name
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

    // Activate current theme card - use exact match
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

  /* ================== NEW: PATH FIXER FOR LEGACY SUPPORT ================== */
  // This ensures old saved themes get updated to new paths
  fixLegacyThemePath(cssFile) {
    // If it's an old path without 'styles/', fix it
    if (cssFile === "style.css") return "styles/style.css";
    if (cssFile === "theme-christmas.css") return "styles/theme-christmas.css";
    if (cssFile === "theme-valentine.css") return "styles/theme-valentine.css";
    if (cssFile === "theme-ramadan.css") return "styles/theme-ramadan.css";
    if (cssFile === "theme-halloween.css") return "styles/theme-halloween.css";
    if (cssFile === "theme-independenceday.css")
      return "styles/theme-independenceday.css";

    // Otherwise return as-is
    return cssFile;
  },
};

// Make globally accessible
window.ThemeManager = ThemeManager;

// Auto-initialize with legacy path fix
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    // Fix any legacy saved theme paths before initialization
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
  // Fix legacy paths immediately
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

console.log("✅ Theme Manager FIXED VERSION loaded!");
