/* ================== theme-manager.js ================== */
/* Fixed version with proper loading states */

const ThemeManager = {
  isLoading: false,

  init() {
    console.log("🎨 Initializing Fixed Theme Manager");

    // Load saved theme
    const savedTheme =
      localStorage.getItem("toke_bakes_css_theme") || "style.css";
    this.applyTheme(savedTheme, false);

    // Setup admin listeners
    if (window.location.pathname.includes("admin")) {
      this.setupAdminListeners();
      // FIX: Hide loading state immediately since we're using local data
      this.hideThemeLoading();
    }
  },

  applyTheme(cssFile, saveToDB = true) {
    const themeLink = document.getElementById("theme-stylesheet");
    if (!themeLink) return;

    // Only change if different
    const currentHref = themeLink.getAttribute("href") || "";
    if (currentHref.includes(cssFile)) return;

    // Apply theme
    themeLink.href = `${cssFile}?v=${Date.now()}`;

    // Save to localStorage
    localStorage.setItem("toke_bakes_css_theme", cssFile);

    // Update admin UI
    if (window.location.pathname.includes("admin")) {
      this.updateAdminUI(cssFile);
    }

    console.log(`✅ Theme applied: ${cssFile}`);
  },

  updateAdminUI(cssFile) {
    // Hide loading states first
    this.hideThemeLoading();

    // Update theme cards
    document.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.remove("active");

      // Make sure all buttons are visible correctly
      const activateBtn = card.querySelector(".btn-activate-theme");
      const activeBtn = card.querySelector(".btn-active-theme");

      if (activateBtn) activateBtn.style.display = "block";
      if (activeBtn) activeBtn.style.display = "none";
    });

    const activeCard = document.querySelector(
      `.theme-card[data-theme-file="${cssFile}"]`
    );
    if (activeCard) {
      activeCard.classList.add("active");
      const activateBtn = activeCard.querySelector(".btn-activate-theme");
      const activeBtn = activeCard.querySelector(".btn-active-theme");
      if (activateBtn) activateBtn.style.display = "none";
      if (activeBtn) activeBtn.style.display = "block";
    }
  },

  setupAdminListeners() {
    // FIX: Hide loading immediately
    this.hideThemeLoading();

    document.addEventListener("click", async (e) => {
      const activateBtn = e.target.closest(".btn-activate-theme");
      if (!activateBtn) return;

      const themeCard = activateBtn.closest(".theme-card");
      if (!themeCard) return;

      const cssFile = themeCard.dataset.themeFile;
      if (!cssFile) return;

      // Apply theme immediately
      this.applyTheme(cssFile, true);

      // Show notification
      if (typeof showNotification === "function") {
        showNotification(
          `Theme activated: ${this.getThemeName(cssFile)}`,
          "success"
        );
      }
    });
  },

  // NEW: Function to hide loading states
  hideThemeLoading() {
    const loadingEl = document.getElementById("themes-loading");
    const emptyStateEl = document.getElementById("themes-empty-state");
    const themesGridEl = document.getElementById("themes-grid");

    if (loadingEl) {
      loadingEl.style.display = "none";
    }

    if (emptyStateEl) {
      emptyStateEl.style.display = "none";
    }

    if (themesGridEl) {
      themesGridEl.style.display = "grid"; // Ensure grid is visible
    }
  },

  getThemeName(cssFile) {
    const names = {
      "style.css": "Default Theme",
      "theme-valentine.css": "Valentine's Day",
      "theme-ramadan.css": "Ramadan",
      "theme-independenceday.css": "Independence Day",
      "theme-halloween.css": "Halloween",
      "theme-christmas.css": "Christmas",
    };
    return names[cssFile] || cssFile.replace(".css", "");
  },
};

// Initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    ThemeManager.init();
  });
} else {
  ThemeManager.init();
}
