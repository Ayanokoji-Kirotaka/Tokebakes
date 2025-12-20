/* ==================== THEME MANAGER - UPDATED FOR AUTO-UPDATE ==================== */
const ThemeManager = {
  currentTheme: "style.css",
  currentMode: "light",
  lastThemeUpdate: 0,

  /* ================== INITIALIZATION ================== */
  init() {
    console.log("🎨 Theme Manager Initialized");

    // Load saved preferences
    const savedTheme =
      localStorage.getItem("toke_bakes_css_theme") || "style.css";
    const savedMode = localStorage.getItem("toke_bakes_theme_mode") || "light";

    this.currentTheme = savedTheme;
    this.currentMode = savedMode;

    // Apply dark/light mode
    document.documentElement.setAttribute("data-theme", savedMode);

    // Apply saved theme
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

    // ✅ NEW: Setup theme auto-update detection
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
          // No popup notification for theme changes
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
        localStorage.getItem("toke_bakes_css_theme") || "style.css";

      // Update my last check timestamp
      localStorage.setItem("my_theme_check", lastUpdate);

      // Apply the new theme
      if (newTheme !== this.currentTheme) {
        this.applyTheme(newTheme, false);
        // No popup notification for auto-updated themes
      }
      return true;
    }
    return false;
  },

  /* ================== MODIFIED: APPLY THEME (NOW WITH AUTO-UPDATE) ================== */
  applyTheme(cssFile, saveToDB = true, isAdminChange = false) {
    console.log("🎨 Applying theme:", cssFile, "isAdminChange:", isAdminChange);

    // Update current theme
    this.currentTheme = cssFile;

    // Save to localStorage
    if (saveToDB) {
      localStorage.setItem("toke_bakes_css_theme", cssFile);

      // ✅ CRITICAL: Set update timestamp for auto-update system
      const timestamp = Date.now().toString();
      localStorage.setItem("toke_bakes_theme_last_update", timestamp);

      // ✅ Broadcast to other tabs if admin is making the change
      if (isAdminChange && this.themeChannel) {
        this.themeChannel.postMessage({
          type: "THEME_CHANGED",
          themeFile: cssFile,
          themeName: this.getThemeName(cssFile),
          timestamp: timestamp,
        });
      }
    }

    // Apply theme CSS
    try {
      const link = document.getElementById("theme-stylesheet");
      if (link) {
        // Add cache-busting parameter
        link.href = cssFile + "?v=" + Date.now();
        console.log("✅ Theme CSS updated");
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
      cssFile !== "style.css" &&
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

  /* ================== MODIFIED: ADMIN THEME ACTIVATION ================== */
  setupAdminListeners() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-activate-theme");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();

        const card = btn.closest(".theme-card");
        if (card && card.dataset.themeFile) {
          // ✅ IMPORTANT: Pass true for isAdminChange
          this.applyTheme(card.dataset.themeFile, true, true);
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

    // ✅ NO POPUP NOTIFICATION - Just silent update
    console.log(`🌓 Mode changed to ${newMode} (no notification)`);

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

        if (file === "style.css") {
          status.innerHTML = '<i class="fas fa-palette"></i> DEFAULT';
        } else if (file === "theme-christmas.css") {
          status.innerHTML = '<i class="fas fa-tree"></i> CHRISTMAS';
        } else if (file === "theme-valentine.css") {
          status.innerHTML = '<i class="fas fa-heart"></i> VALENTINE';
        } else if (file === "theme-ramadan.css") {
          status.innerHTML = '<i class="fas fa-moon"></i> RAMADAN';
        } else if (file === "theme-halloween.css") {
          status.innerHTML = '<i class="fas fa-ghost"></i> HALLOWEEN';
        } else if (file === "theme-independenceday.css") {
          status.innerHTML = '<i class="fas fa-flag"></i> INDEPENDENCE';
        }
      }
    });

    // Activate current theme card
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
      "style.css": "Default",
      "theme-christmas.css": "Christmas",
      "theme-valentine.css": "Valentine",
      "theme-ramadan.css": "Ramadan",
      "theme-independenceday.css": "Independence Day",
      "theme-halloween.css": "Halloween",
    };
    return themeNames[cssFile] || cssFile;
  },

  getCurrentThemeName() {
    return this.getThemeName(this.currentTheme);
  },

  resetToDefault() {
    this.applyTheme("style.css", true, true);
  },
};

// Make globally accessible
window.ThemeManager = ThemeManager;

// Auto-initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => ThemeManager.init());
} else {
  ThemeManager.init();
}

console.log("✅ Theme Manager with AUTO-UPDATE loaded!");
