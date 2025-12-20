/* ================== theme-manager.js ================== */
/* SIMPLE Theme System */

const ThemeManager = {
  init() {
    console.log("🎨 Initializing Simple Theme Manager");

    // Load saved theme
    const savedTheme =
      localStorage.getItem("toke_bakes_css_theme") || "style.css";
    this.applyTheme(savedTheme, false);

    // Setup admin listeners
    if (window.location.pathname.includes("admin")) {
      this.setupAdminListeners();
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
    // Update theme cards
    document.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.remove("active");
    });

    const activeCard = document.querySelector(
      `.theme-card[data-theme-file="${cssFile}"]`
    );
    if (activeCard) {
      activeCard.classList.add("active");
    }
  },

  setupAdminListeners() {
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
