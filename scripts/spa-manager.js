/* Fixed SPA Manager with proper reinitialization of all components */

const SPA_DEBUG = false;
const spaDebugLog = (...args) => {
  if (SPA_DEBUG) console.log(...args);
};
const spaDebugWarn = (...args) => {
  if (SPA_DEBUG) console.warn(...args);
};

class SPAManager {
  constructor() {
    this.currentPage = this.normalizeUrl(
      `${window.location.pathname}${window.location.search || ""}`
    ).key;
    this.isTransitioning = false;
    this.pageTransitionMs = 260;
    this.progressEl = null;
    this.pageCache = new Map();
    this.pageCacheMaxAgeMs = 2 * 60 * 1000;
    this.scriptLoadPromises = new Map();
    this.prefetchInFlight = new Map();
    this.mobileMenuOutsideClickHandler = null;
    this.init();
  }

  init() {
    spaDebugLog("Initializing Enhanced SPA Manager...");

    // Setup link interception
    this.setupLinkInterception();
    this.preloadNavLinks();

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      if (!this.isTransitioning) {
        this.loadPage(
          `${window.location.pathname}${window.location.search || ""}`
        );
      }
    });
  }

  setupLinkInterception() {
    const maybePrefetch = (e) => {
      const targetEl =
        e.target instanceof Element ? e.target : e.target?.parentElement;
      const link = targetEl ? targetEl.closest("a[href]") : null;
      if (!link) return;
      if (!this.shouldHandleLink(link)) return;
      const href = link.getAttribute("href");
      this.prefetchPage(href);
    };

    document.addEventListener("mouseover", maybePrefetch, { passive: true });
    document.addEventListener("focusin", maybePrefetch, { passive: true });
    document.addEventListener("touchstart", maybePrefetch, { passive: true });

    document.addEventListener("click", (e) => {
      if (this.isTransitioning) return;

      const targetEl =
        e.target instanceof Element ? e.target : e.target?.parentElement;
      const link = targetEl ? targetEl.closest("a[href]") : null;
      if (!link) return;

      if (!this.shouldHandleLink(link)) return;
      const href = link.getAttribute("href");

      e.preventDefault();
      this.navigateTo(href);
    });
  }

  startTransition() {
    document.body.classList.add("spa-navigating");
    this.showProgress();
  }

  endTransition() {
    this.hideProgress();
    document.body.classList.remove("spa-navigating");
  }

  showProgress() {
    if (!this.progressEl) {
      this.progressEl = document.querySelector(".spa-progress");
      if (!this.progressEl) {
        this.progressEl = document.createElement("div");
        this.progressEl.className = "spa-progress";
        document.body.appendChild(this.progressEl);
      }
    }
    this.progressEl.classList.add("active");
  }

  hideProgress() {
    if (this.progressEl) {
      this.progressEl.classList.remove("active");
    }
  }

  loadScriptOnce(src) {
    if (this.scriptLoadPromises.has(src)) {
      return this.scriptLoadPromises.get(src);
    }

    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        // If it already exists in DOM, treat as loaded to avoid hanging on
        // scripts whose load event already fired before this call.
        existing.dataset.loaded = "true";
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "true";
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${src}`)),
        { once: true }
      );
      document.body.appendChild(script);
    });

    this.scriptLoadPromises.set(src, promise);
    return promise;
  }

  normalizeUrl(url) {
    try {
      const resolved = new URL(url, window.location.href);
      const key = `${resolved.pathname}${resolved.search || ""}`;
      return {
        key,
        fetchUrl: `${resolved.pathname}${resolved.search || ""}`,
        pushUrl: `${resolved.pathname}${resolved.search || ""}`,
      };
    } catch {
      return { key: url, fetchUrl: url, pushUrl: url };
    }
  }

  parseHtmlToContent(html) {
    const parser = new DOMParser();
    const newDoc = parser.parseFromString(html, "text/html");
    return {
      header: newDoc.getElementById("site-header")?.innerHTML,
      main: newDoc.getElementById("main-content")?.innerHTML,
      footer: newDoc.getElementById("site-footer")?.innerHTML,
      title: newDoc.querySelector("title")?.textContent,
    };
  }

  primeCmsLoadingState() {
    try {
      ["featured-container", "menu-container", "gallery-container"].forEach(
        (id) => {
          const el = document.getElementById(id);
          if (!el) return;
          if (el.querySelector(".loading-message")) {
            el.setAttribute("data-loading", "true");
          }
        }
      );
    } catch {}
  }

  shouldHandleLink(link) {
    const href = link.getAttribute("href");
    if (!href) return false;

    // Skip external links
    try {
      const resolved = new URL(href, window.location.href);
      if (resolved.origin !== window.location.origin) return false;
    } catch {}

    if (
      href.startsWith("#") ||
      href.includes("admin") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      link.target === "_blank" ||
      link.hasAttribute("download")
    ) {
      return false;
    }
    return true;
  }

  preloadNavLinks() {
    if (!this.shouldPrefetch()) return;

    const run = () => {
      const links = document.querySelectorAll(".navbar a[href]");
      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (!href) return;
        this.prefetchPage(href);
      });
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 400);
    }
  }

  shouldPrefetch() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return true;
    if (conn.saveData) return false;
    const effectiveType = String(conn.effectiveType || "").toLowerCase();
    if (effectiveType === "slow-2g" || effectiveType === "2g") return false;
    return true;
  }

  getCachedPage(key) {
    const cached = this.pageCache.get(key);
    if (!cached) return null;
    if (Date.now() - Number(cached.ts || 0) > this.pageCacheMaxAgeMs) {
      this.pageCache.delete(key);
      return null;
    }
    return cached.content || null;
  }

  setCachedPage(key, content) {
    if (!key || !content) return;
    this.pageCache.set(key, { content, ts: Date.now() });
    if (this.pageCache.size > 6) {
      const firstKey = this.pageCache.keys().next().value;
      this.pageCache.delete(firstKey);
    }
  }

  async prefetchPage(url) {
    if (!this.shouldPrefetch()) return;

    const normalized = this.normalizeUrl(url);
    if (this.getCachedPage(normalized.key)) return;
    if (this.prefetchInFlight.has(normalized.key)) {
      return this.prefetchInFlight.get(normalized.key);
    }

    const prefetchPromise = (async () => {
      try {
        const response = await fetch(normalized.fetchUrl, {
          cache: "no-cache",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const html = await response.text();
        const content = this.parseHtmlToContent(html);
        if (!content.main) return;

        this.setCachedPage(normalized.key, content);
      } catch {
        // Ignore prefetch errors silently
      } finally {
        this.prefetchInFlight.delete(normalized.key);
      }
    })();

    this.prefetchInFlight.set(normalized.key, prefetchPromise);

    try {
      await prefetchPromise;
    } catch {
      // Intentional no-op for prefetch
    }
  }

  async navigateTo(url, options = {}) {
    const normalized = this.normalizeUrl(url);
    const { updateHistory = true } = options || {};
    if (this.isTransitioning || normalized.key === this.currentPage) return;

    this.isTransitioning = true;
    this.startTransition();

    const mainEl = document.getElementById("main-content");
    if (!mainEl) {
      this.isTransitioning = false;
      this.endTransition();
      window.location.href = normalized.pushUrl || normalized.fetchUrl || url;
      return;
    }

    mainEl.classList.add("spa-fade-out");
    const fadePromise = new Promise((resolve) =>
      setTimeout(resolve, this.pageTransitionMs)
    );
    spaDebugLog(`SPA navigating to: ${normalized.pushUrl}`);

    try {
      const contentPromise = (async () => {
        let newContent = this.getCachedPage(normalized.key);

        if (!newContent) {
          const staleFallback = this.pageCache.get(normalized.key)?.content || null;
          try {
            const response = await fetch(normalized.fetchUrl, {
              cache: "no-cache",
              credentials: "same-origin",
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const html = await response.text();
            newContent = this.parseHtmlToContent(html);
            this.setCachedPage(normalized.key, newContent);
          } catch (error) {
            if (staleFallback && staleFallback.main) {
              newContent = staleFallback;
            } else {
              throw error;
            }
          }
        }

        if (!newContent.main) throw new Error("No main content found");
        return newContent;
      })();

      const [newContent] = await Promise.all([contentPromise, fadePromise]);

      // Update page
      await this.updatePage(newContent, true);

      // Update URL
      if (updateHistory) {
        window.history.pushState({}, "", normalized.pushUrl);
      }
      this.currentPage = normalized.key;

      if (newContent.title) {
        document.title = newContent.title;
      }

      window.dispatchEvent(
        new CustomEvent("spa:navigated", { detail: { path: normalized.key } })
      );

      // REINITIALIZE EVERYTHING - CRITICAL FIX
      this.reinitializePage();

      // Keep cache warm (stale-while-revalidate)
      this.prefetchPage(normalized.fetchUrl);

      spaDebugLog(`SPA navigation complete: ${normalized.pushUrl}`);
    } catch (error) {
      console.error("SPA navigation failed:", error);
      // Fallback to full page load
      window.location.href = normalized.pushUrl || normalized.fetchUrl || url;
      return;
    } finally {
      this.isTransitioning = false;
      this.endTransition();
    }
  }

  async updatePage(content, skipFadeOut = false) {
    const mainEl = document.getElementById("main-content");
    if (!mainEl) return;

    if (!skipFadeOut) {
      // 1. Fade out
      mainEl.classList.add("spa-fade-out");

      // Wait for fade out
      await new Promise((resolve) => setTimeout(resolve, this.pageTransitionMs));
    }

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

    // Prime CMS containers immediately to avoid a brief unmasked flash
    this.primeCmsLoadingState();

    // Ensure new page starts at the top with smooth motion unless user prefers reduced motion.
    try {
      const prefersReducedMotion =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    } catch {
      window.scrollTo(0, 0);
    }

    // 3. Fade in
    mainEl.classList.remove("spa-fade-out");
    mainEl.classList.add("spa-fade-in");

    // Remove fade-in class after animation
    setTimeout(() => {
      mainEl.classList.remove("spa-fade-in");
    }, this.pageTransitionMs + 60);
  }

  reinitializePage() {
    spaDebugLog("Reinitializing page components after SPA navigation...");

    const run = async () => {
      try {
        // Reset initialization flags to allow re-initialization on new pages
        window.menuInteractionsInitialized = false;
        window.orderFunctionalityInitialized = false;

        // 1. Reinitialize carousel if on homepage
        await this.reinitCarousel();

        // 2. Reinitialize mobile menu
        this.reinitMobileMenu();

        // 3. Reinitialize cart functionality
        if (typeof refreshCartCount === "function") {
          refreshCartCount();
        }

        // 4. Reinitialize CMS content for the new page
        if (typeof loadDynamicContent === "function") {
          Promise.resolve(loadDynamicContent()).catch((e) =>
            spaDebugWarn("Dynamic content reload failed:", e)
          );
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
          Promise.resolve(renderCartOnOrderPage(true)).catch((e) =>
            spaDebugWarn("Cart render failed:", e)
          );
        }

        window.dispatchEvent(new CustomEvent("spa:reinitialized"));
        spaDebugLog("All components reinitialized successfully");
      } catch (error) {
        spaDebugWarn("Some components failed to reinitialize:", error);
      }
    };

    requestAnimationFrame(() => {
      Promise.resolve(run()).catch((error) =>
        spaDebugWarn("Reinitialization task failed:", error)
      );
    });
  }

  // NEW: Reinitialize carousel
  reinitCarousel() {
    const run = async () => {
      const carouselContainer = document.querySelector(".hero-carousel");
      if (!carouselContainer) {
        if (window.heroCarousel && typeof window.heroCarousel.destroy === "function") {
          window.heroCarousel.destroy();
        }
        window.heroCarousel = null;
        spaDebugLog("No carousel on this page");
        return;
      }

      spaDebugLog("Reinitializing carousel...");

      if (
        typeof window.initializeCarousel !== "function" &&
        typeof window.HeroCarousel !== "function"
      ) {
        await this.loadScriptOnce("scripts/carousel.js");
      }

      if (window.heroCarousel && typeof window.heroCarousel.destroy === "function") {
        window.heroCarousel.destroy();
      } else if (window.heroCarousel && typeof window.heroCarousel.stopAutoPlay === "function") {
        window.heroCarousel.stopAutoPlay();
        window.heroCarousel = null;
      }

      if (typeof window.initializeCarousel === "function") {
        window.initializeCarousel();
      } else if (typeof window.HeroCarousel === "function") {
        window.heroCarousel = new window.HeroCarousel();
      }
    };

    return Promise.resolve(run()).catch((error) => {
      spaDebugWarn("Carousel reinitialization failed:", error);
    });
  }

  // NEW: Reinitialize mobile menu
  reinitMobileMenu() {
    if (typeof initMobileMenu === "function") {
      initMobileMenu();
      return;
    }

    spaDebugLog("Reinitializing mobile menu...");

    const toggleBtn = document.getElementById("navbarToggle");
    const navList = document.querySelector(".navbar ul");

    if (!toggleBtn || !navList) {
      spaDebugLog("No mobile menu found on this page");
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

      const isMobileNow =
        window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
      const pageName = window.location.pathname.split("/").pop() || "index.html";
      const isHomePage =
        pageName === "" ||
        pageName === "/" ||
        pageName === "index.html" ||
        pageName === "index";

      if (isMobileNow && isHomePage) {
        freshNavList.classList.add("show");
      } else {
        freshNavList.classList.remove("show");
      }

      if (this.mobileMenuOutsideClickHandler) {
        document.removeEventListener("click", this.mobileMenuOutsideClickHandler);
      }

      this.mobileMenuOutsideClickHandler = (e) => {
        const targetEl =
          e.target instanceof Element ? e.target : e.target?.parentElement;
        if (
          freshNavList.classList.contains("show") &&
          !(targetEl && targetEl.closest(".navbar")) &&
          !(targetEl && targetEl.closest("#navbarToggle"))
        ) {
          freshNavList.classList.remove("show");
        }
      };
      document.addEventListener("click", this.mobileMenuOutsideClickHandler);

      document.querySelectorAll(".navbar a").forEach((link) => {
        link.addEventListener("click", () => {
          freshNavList.classList.remove("show");
        });
      });
    }
  }

  // NEW: Reinitialize theme toggle
  reinitThemeToggle() {
    spaDebugLog("Reinitializing theme toggle...");

    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) {
      spaDebugLog("No theme toggle found on this page");
      return;
    }

    // Clone and replace to remove old event listeners
    const newToggle = themeToggle.cloneNode(true);
    themeToggle.parentNode.replaceChild(newToggle, themeToggle);

    // Get fresh reference
    const freshToggle = document.getElementById("themeToggle");

    // Check if ThemeManager exists
    if (
      window.ThemeManager &&
      typeof window.ThemeManager.setupModeToggle === "function"
    ) {
      window.ThemeManager.setupModeToggle();
    } else {
      // Fallback manual initialization
      this.initThemeToggleFallback(freshToggle);
    }
  }

  // Fallback theme toggle initialization
  initThemeToggleFallback(themeToggle) {
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
      document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    updateIcons(currentTheme);

    // Click handler
    themeToggle.addEventListener("click", (e) => {
      e.preventDefault();

      const current =
        document.documentElement.getAttribute("data-theme") || "light";
      const newTheme = current === "dark" ? "light" : "dark";

      // Update document attribute
      document.documentElement.setAttribute("data-theme", newTheme);

      // Update icons
      updateIcons(newTheme);

      // Save to localStorage
      localStorage.setItem("toke_bakes_theme_mode", newTheme);

      // Update footer theme
      this.updateFooterTheme(newTheme);

      spaDebugLog(`Theme mode changed to ${newTheme}`);
    });
  }

  // Update footer theme (separate from ThemeManager)
  updateFooterTheme(theme) {
    const footer = document.querySelector(".bakes-footer");
    if (!footer) {
      spaDebugLog("No .bakes-footer element found");
      return;
    }

    if (theme === "dark") {
      footer.classList.remove("light-theme");
      footer.classList.add("dark-theme");
    } else {
      footer.classList.remove("dark-theme");
      footer.classList.add("light-theme");
    }

    spaDebugLog(`Footer theme updated to ${theme}`);
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

      // Check for home page
      if (
        (linkPage === "index" ||
          linkPage === "" ||
          linkPage === "index.html") &&
        (currentPage === "index" ||
          currentPage === "" ||
          currentPage === "index.html")
      ) {
        link.classList.add("active");
      }
      // Check for other pages
      else if (
        linkPage.replace(".html", "") === currentPage.replace(".html", "")
      ) {
        link.classList.add("active");
      }
    });
  }

  // Load a specific page (for popstate)
  async loadPage(path) {
    if (this.isTransitioning) return;
    this.navigateTo(path, { updateHistory: false });
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


