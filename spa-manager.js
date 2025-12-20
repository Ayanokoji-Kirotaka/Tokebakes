/* ================== spa-manager.js ================== */
/* Fixed version with proper theme toggle reinitialization */

class SPAManager {
  constructor() {
    this.currentPage = window.location.pathname;
    this.isTransitioning = false;
    this.init();
  }

  init() {
    console.log("🚀 Initializing Fixed SPA Manager...");

    // Setup link interception
    setTimeout(() => this.setupLinkInterception(), 500);

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      if (!this.isTransitioning) {
        this.loadPage(window.location.pathname);
      }
    });
  }

  setupLinkInterception() {
    document.addEventListener("click", (e) => {
      if (this.isTransitioning) return;

      const link = e.target.closest("a[href]");
      if (!link) return;

      const href = link.getAttribute("href");

      // Skip conditions
      if (
        href.startsWith("#") ||
        href.includes("admin") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      ) {
        return;
      }

      e.preventDefault();
      this.navigateTo(href);
    });
  }

  async navigateTo(url) {
    if (this.isTransitioning || url === this.currentPage) return;

    this.isTransitioning = true;
    console.log(`🔀 Navigating to: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(html, "text/html");

      const newContent = {
        header: newDoc.getElementById("site-header")?.innerHTML,
        main: newDoc.getElementById("main-content")?.innerHTML,
        footer: newDoc.getElementById("site-footer")?.innerHTML,
        title: newDoc.querySelector("title")?.textContent,
      };

      if (!newContent.main) throw new Error("No main content found");

      // Update page
      await this.updatePage(newContent);

      // Update URL
      window.history.pushState({}, "", url);
      this.currentPage = url;

      if (newContent.title) {
        document.title = newContent.title;
      }

      // Reinitialize - CRITICAL FIX
      this.reinitializePage();
    } catch (error) {
      console.error("SPA failed:", error);
      window.location.href = url;
      return;
    } finally {
      this.isTransitioning = false;
    }
  }

  async updatePage(content) {
    const mainEl = document.getElementById("main-content");

    if (!mainEl) return;

    // 1. Fade out
    mainEl.classList.add("spa-fade-out");

    // Wait for fade out
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 2. Update content
    const headerEl = document.getElementById("site-header");
    const footerEl = document.getElementById("site-footer");

    if (content.header && headerEl) {
      headerEl.innerHTML = content.header;
    }

    if (content.main && mainEl) {
      mainEl.innerHTML = content.main;
    }

    if (content.footer && footerEl) {
      footerEl.innerHTML = content.footer;
    }

    // 3. Fade in
    mainEl.classList.remove("spa-fade-out");
    mainEl.classList.add("spa-fade-in");

    // Remove fade-in class after animation
    setTimeout(() => {
      mainEl.classList.remove("spa-fade-in");
    }, 400);
  }

  reinitializePage() {
    setTimeout(() => {
      try {
        // Re-run essential functions
        if (typeof refreshCartCount === "function") {
          refreshCartCount();
        }

        // CRITICAL: Reload CMS content for the new page
        if (typeof loadDynamicContent === "function") {
          loadDynamicContent();
        }

        if (typeof initMenuInteractions === "function") {
          initMenuInteractions();
        }

        // CRITICAL FIX: Reinitialize theme toggle
        this.reinitThemeToggle();

        // Re-run navigation highlighting
        this.reinitNavHighlight();

        console.log("✅ SPA reinitialized with content reload");
      } catch (error) {
        console.warn("SPA reinit failed:", error);
      }
    }, 100);
  }

  // NEW: Proper theme toggle reinitialization
  reinitThemeToggle() {
    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) return;

    // Clone and replace to remove old event listeners
    const newToggle = themeToggle.cloneNode(true);
    themeToggle.parentNode.replaceChild(newToggle, themeToggle);

    // Reinitialize theme toggle function
    this.initThemeToggleFunction(newToggle);
  }

  initThemeToggleFunction(themeToggle) {
    if (!themeToggle) return;

    const sunIcon = themeToggle.querySelector(".sun");
    const moonIcon = themeToggle.querySelector(".moon");

    // Function to update icons based on theme
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

    // Initial icon setup
    const currentTheme =
      document.documentElement.getAttribute("data-theme") || "light";
    updateIcons(currentTheme);

    // Update footer theme (if function exists)
    if (typeof updateFooterTheme === "function") {
      updateFooterTheme(currentTheme);
    }

    // Click handler
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const newTheme = current === "dark" ? "light" : "dark";

      document.documentElement.setAttribute("data-theme", newTheme);
      updateIcons(newTheme);

      localStorage.setItem("toke_bakes_theme", newTheme);

      if (typeof updateFooterTheme === "function") {
        updateFooterTheme(newTheme);
      }
    });
  }

  reinitNavHighlight() {
    const navLinks = document.querySelectorAll("nav a");
    const currentPage = window.location.pathname.split("/").pop() || "index";

    navLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const linkPage = href.split("/").pop() || "index";

      link.classList.remove("active");

      if (
        (linkPage === "index" && currentPage === "index") ||
        linkPage === currentPage
      ) {
        link.classList.add("active");
      }
    });
  }
}

// Initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.spaManager = new SPAManager();
  });
} else {
  window.spaManager = new SPAManager();
}
