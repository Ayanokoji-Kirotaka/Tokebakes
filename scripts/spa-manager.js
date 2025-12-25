/* ==================== spa-manager.js - CACHE-AWARE VERSION ==================== */

class SPAManager {
  constructor() {
    this.currentPage = window.location.pathname;
    this.isTransitioning = false;
    this.cachePreloader = new Set();
    this.init();
  }

  init() {
    console.log("🚀 Initializing Cache-Aware SPA Manager...");

    // Setup link interception
    setTimeout(() => this.setupLinkInterception(), 100);

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      if (!this.isTransitioning) {
        this.loadPage(window.location.pathname);
      }
    });

    // Setup cache preloading
    this.setupCachePreloading();
  }

  setupCachePreloading() {
    // Prefetch likely next pages based on current page
    const preloadMap = {
      "index.html": ["menu.html", "gallery.html"],
      "menu.html": ["order.html", "index.html"],
      "gallery.html": ["index.html", "menu.html"],
      "order.html": ["menu.html", "index.html"],
    };

    const currentPage =
      window.location.pathname.split("/").pop() || "index.html";
    const toPreload = preloadMap[currentPage] || ["index.html", "menu.html"];

    toPreload.forEach((page) => {
      if (!this.cachePreloader.has(page)) {
        this.cachePreloader.add(page);
        this.prefetchPage(page);
      }
    });
  }

  async prefetchPage(url) {
    try {
      // Fetch the page in background
      const response = await fetch(url);
      if (response.ok) {
        const html = await response.text();

        // Parse and extract content
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Cache images from the page
        this.prefetchImages(doc);

        console.log(`📦 Prefetched ${url}`);
      }
    } catch (error) {
      // Silent fail for prefetching
    }
  }

  prefetchImages(doc) {
    const images = doc.querySelectorAll("img[src]");
    images.forEach((img) => {
      const imageUrl = img.src;
      if (imageUrl && !imageUrl.startsWith("data:")) {
        // Create invisible image to cache it
        const preloadImg = new Image();
        preloadImg.src = imageUrl;
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

      // Pre-cache the target page's data
      this.precachePageData(href);

      this.navigateTo(href);
    });
  }

  precachePageData(pageUrl) {
    // Determine what data to precache based on target page
    const page = pageUrl.split("/").pop() || "index.html";

    if (page.includes("menu") && window.cacheManager) {
      // Ensure menu data is fresh
      setTimeout(() => {
        window.cacheManager.fetchAndCache(
          API_ENDPOINTS.MENU,
          CACHE_CONFIG.KEYS.MENU,
          CACHE_CONFIG.EXPIRY.MENU
        );
      }, 100);
    }
  }

  async navigateTo(url) {
    if (this.isTransitioning || url === this.currentPage) return;

    this.isTransitioning = true;
    console.log(`🔀 SPA Navigating to: ${url}`);

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

      // REINITIALIZE EVERYTHING
      this.reinitializePage();

      // Setup new preloading
      this.setupCachePreloading();

      console.log(`✅ SPA navigation complete: ${url}`);
    } catch (error) {
      console.error("SPA navigation failed:", error);
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
    console.log("🔄 Reinitializing page components after SPA navigation...");

    setTimeout(() => {
      try {
        // 1. Reinitialize carousel if on homepage
        this.reinitCarousel();

        // 2. Reinitialize mobile menu
        this.reinitMobileMenu();

        // 3. Reinitialize cart functionality
        if (typeof refreshCartCount === "function") {
          refreshCartCount();
        }

        // 4. Reinitialize CMS content for the new page
        if (typeof loadDynamicContent === "function") {
          loadDynamicContent();
        }

        // 5. Reinitialize menu interactions
        if (typeof initMenuInteractions === "function") {
          initMenuInteractions();
        }

        // 6. Reinitialize order functionality
        if (typeof initOrderFunctionality === "function") {
          initOrderFunctionality();
        }

        // 7. Reinitialize theme toggle
        this.reinitThemeToggle();

        // 8. Re-run navigation highlighting
        this.reinitNavHighlight();

        // 9. Reinitialize cart page if on order page
        if (
          window.location.pathname.includes("order") &&
          typeof renderCartOnOrderPage === "function"
        ) {
          renderCartOnOrderPage(true);
        }

        console.log("✅ All components reinitialized successfully");
      } catch (error) {
        console.warn("Some components failed to reinitialize:", error);
      }
    }, 100);
  }

  // NEW: Reinitialize carousel
  reinitCarousel() {
    const carouselContainer = document.querySelector(".hero-carousel");
    if (!carouselContainer) {
      console.log("ℹ️ No carousel on this page");
      return;
    }

    console.log("🔄 Reinitializing carousel...");

    if (window.heroCarousel) {
      window.heroCarousel.stopAutoPlay();
      window.heroCarousel = null;
    }

    if (typeof HeroCarousel === "function") {
      window.heroCarousel = new HeroCarousel();
    } else if (typeof initializeCarousel === "function") {
      initializeCarousel();
    }
  }

  // NEW: Reinitialize mobile menu
  reinitMobileMenu() {
    console.log("🔄 Reinitializing mobile menu...");

    const toggleBtn = document.getElementById("navbarToggle");
    const navList = document.querySelector(".navbar ul");

    if (!toggleBtn || !navList) {
      console.log("ℹ️ No mobile menu found on this page");
      return;
    }

    const newToggle = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);

    const newNavList = navList.cloneNode(true);
    navList.parentNode.replaceChild(newNavList, navList);

    const freshToggle = document.getElementById("navbarToggle");
    const freshNavList = document.querySelector(".navbar ul");

    if (freshToggle && freshNavList) {
      freshToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        freshNavList.classList.toggle("show");
      });

      document.addEventListener("click", (e) => {
        if (
          freshNavList.classList.contains("show") &&
          !e.target.closest(".navbar") &&
          !e.target.closest("#navbarToggle")
        ) {
          freshNavList.classList.remove("show");
        }
      });

      document.querySelectorAll(".navbar a").forEach((link) => {
        link.addEventListener("click", () => {
          freshNavList.classList.remove("show");
        });
      });
    }
  }

  // NEW: Reinitialize theme toggle
  reinitThemeToggle() {
    console.log("🔄 Reinitializing theme toggle...");

    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) {
      console.log("ℹ️ No theme toggle found on this page");
      return;
    }

    const newToggle = themeToggle.cloneNode(true);
    themeToggle.parentNode.replaceChild(newToggle, themeToggle);

    const freshToggle = document.getElementById("themeToggle");

    if (
      window.ThemeManager &&
      typeof window.ThemeManager.setupModeToggle === "function"
    ) {
      window.ThemeManager.setupModeToggle();
    } else {
      this.initThemeToggleFallback(freshToggle);
    }
  }

  // Fallback theme toggle initialization
  initThemeToggleFallback(themeToggle) {
    if (!themeToggle) return;

    const sunIcon = themeToggle.querySelector(".sun");
    const moonIcon = themeToggle.querySelector(".moon");

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

    const currentTheme =
      localStorage.getItem("toke_bakes_theme_mode") || "light";
    updateIcons(currentTheme);

    themeToggle.addEventListener("click", (e) => {
      e.preventDefault();

      const current =
        document.documentElement.getAttribute("data-theme") || "light";
      const newTheme = current === "dark" ? "light" : "dark";

      document.documentElement.setAttribute("data-theme", newTheme);

      updateIcons(newTheme);

      localStorage.setItem("toke_bakes_theme_mode", newTheme);

      this.updateFooterTheme(newTheme);

      console.log(`🌓 Theme mode changed to ${newTheme}`);
    });
  }

  updateFooterTheme(theme) {
    const footer = document.querySelector(".bakes-footer");
    if (!footer) {
      console.log("ℹ️ No .bakes-footer element found");
      return;
    }

    if (theme === "dark") {
      footer.classList.remove("light-theme");
      footer.classList.add("dark-theme");
    } else {
      footer.classList.remove("dark-theme");
      footer.classList.add("light-theme");
    }

    console.log(`✅ Footer theme updated to ${theme}`);
  }

  reinitNavHighlight() {
    const navLinks = document.querySelectorAll("nav a");
    const currentPath = window.location.pathname;
    const currentPage = currentPath.split("/").pop() || "index";

    navLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const linkPage = href.split("/").pop() || "index";

      link.classList.remove("active");

      if (
        (linkPage === "index" ||
          linkPage === "" ||
          linkPage === "index.html") &&
        (currentPage === "index" ||
          currentPage === "" ||
          currentPage === "index.html")
      ) {
        link.classList.add("active");
      } else if (
        linkPage.replace(".html", "") === currentPage.replace(".html", "")
      ) {
        link.classList.add("active");
      }
    });
  }

  async loadPage(path) {
    if (this.isTransitioning) return;
    this.navigateTo(path);
  }
}

// Initialize SPA Manager
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.spaManager = new SPAManager();
  });
} else {
  window.spaManager = new SPAManager();
}

/* ================== EMERGENCY PATCH ================== */
if (typeof initFooterTheme === "undefined") {
  window.initFooterTheme = function () {
    /* Function removed */
  };
}

if (typeof updateFooterTheme === "undefined") {
  window.updateFooterTheme = function () {
    /* Function removed */
  };
}

if (typeof initThemeToggle === "undefined") {
  window.initThemeToggle = function () {
    /* Function removed - handled by theme-manager.js */
  };
}
