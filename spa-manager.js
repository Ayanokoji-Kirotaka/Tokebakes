/* ================== spa-manager.js ================== */
/* CSS-Free SPA Manager for Toke Bakes */

class SPAManager {
  constructor() {
    this.currentPage = window.location.pathname;
    this.isTransitioning = false;
    this.init();
  }

  init() {
    console.log("🚀 Initializing CSS-Free SPA Manager...");

    // Safe delayed start
    setTimeout(() => this.setupLinkInterception(), 500);

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      if (!this.isTransitioning) {
        this.loadPage(window.location.pathname);
      }
    });

    console.log("✅ SPA Manager ready (CSS-free)");
  }

  setupLinkInterception() {
    document.addEventListener("click", (e) => {
      if (this.isTransitioning) return;

      const link = e.target.closest("a[href]");
      if (!link) return;

      const href = link.getAttribute("href");
      const url = new URL(href, window.location.origin);

      // Skip conditions
      const skip = [
        url.origin !== window.location.origin, // External
        href.startsWith("#"), // Anchors
        href.includes("admin"), // Admin
        href.startsWith("mailto:"), // Email
        href.startsWith("tel:"), // Phone
        link.target === "_blank", // New tab
        link.hasAttribute("download"), // Downloads
      ].some(Boolean);

      if (skip) return;

      e.preventDefault();
      this.navigateTo(href);
    });
  }

  async navigateTo(url) {
    if (this.isTransitioning || url === this.currentPage) return;

    this.isTransitioning = true;
    console.log(`🔀 SPA navigating: ${url}`);

    // Add CSS class for transition
    document.body.classList.add("spa-navigating");

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(html, "text/html");

      // Extract content using your IDs
      const newContent = {
        header: newDoc.getElementById("site-header")?.innerHTML,
        main: newDoc.getElementById("main-content")?.innerHTML,
        footer: newDoc.getElementById("site-footer")?.innerHTML,
        title: newDoc.querySelector("title")?.textContent,
      };

      if (!newContent.main) throw new Error("No main content found");

      // Update page
      this.updatePage(newContent);

      // Update URL and history
      window.history.pushState({}, "", url);
      this.currentPage = url;

      if (newContent.title) {
        document.title = newContent.title;
      }

      // Reinitialize your functions
      this.reinitializePage();
    } catch (error) {
      console.error("SPA failed, falling back:", error);
      window.location.href = url;
      return;
    } finally {
      this.isTransitioning = false;
      document.body.classList.remove("spa-navigating");
    }
  }

  updatePage(content) {
    // Add fade-out class (defined in your CSS)
    const mainEl = document.getElementById("main-content");
    if (mainEl) mainEl.classList.add("spa-fade-out");

    // Brief delay for fade-out
    return new Promise((resolve) => {
      setTimeout(() => {
        // Update content
        if (content.header) {
          const headerEl = document.getElementById("site-header");
          if (headerEl) headerEl.innerHTML = content.header;
        }

        if (content.main && mainEl) {
          mainEl.innerHTML = content.main;
        }

        if (content.footer) {
          const footerEl = document.getElementById("site-footer");
          if (footerEl) footerEl.innerHTML = content.footer;
        }

        // Add fade-in class
        if (mainEl) {
          mainEl.classList.remove("spa-fade-out");
          mainEl.classList.add("spa-fade-in");

          // Remove fade-in after animation
          setTimeout(() => {
            mainEl.classList.remove("spa-fade-in");
          }, 300);
        }

        resolve();
      }, 150);
    });
  }

  reinitializePage() {
    // Small delay for DOM to update
    setTimeout(() => {
      try {
        // Re-run your essential functions
        const functions = [
          "highlightNav",
          "loadDynamicContent",
          "refreshCartCount",
          "initMenuInteractions",
          "initMobileMenu",
          "initOrderFunctionality",
        ];

        functions.forEach((funcName) => {
          if (typeof window[funcName] === "function") {
            window[funcName]();
            console.log(`✅ Re-ran ${funcName}()`);
          }
        });

        // Check theme sync
        if (window.ThemeManager?.getActiveTheme) {
          ThemeManager.getActiveTheme().then((current) => {
            if (current !== ThemeManager.currentTheme()) {
              ThemeManager.applyTheme(current);
            }
          });
        }
      } catch (error) {
        console.warn("Some reinitializations failed:", error);
      }
    }, 100);
  }
}

// Initialize when ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      window.spaManager = new SPAManager();
    }, 1000);
  });
} else {
  setTimeout(() => {
    window.spaManager = new SPAManager();
  }, 1000);
}
