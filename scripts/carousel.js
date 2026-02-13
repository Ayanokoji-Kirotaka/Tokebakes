/* ================== carousel.js - SPA-ENHANCED VERSION ================== */

const CAROUSEL_DEBUG = false;
const CAROUSEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CAROUSEL_READY_TIMEOUT_MS = 450;
const CAROUSEL_CACHE_VERSION = 2;
const CAROUSEL_CACHE_VERSION_KEY = "hero_carousel_cache_version";
const CAROUSEL_FALLBACK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const carouselDebugLog = (...args) => {
  if (CAROUSEL_DEBUG) console.log(...args);
};
const carouselDebugWarn = (...args) => {
  if (CAROUSEL_DEBUG) console.warn(...args);
};
const isCarouselSlideActive = (value) => {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return true;
};
const normalizeCarouselAsset = (value) =>
  value === null || value === undefined
    ? ""
    : String(value)
        .trim()
        .replace(/\s+\.(?=[a-z0-9]+($|\?))/gi, ".");

function ensureCarouselCacheVersion() {
  try {
    const current = localStorage.getItem(CAROUSEL_CACHE_VERSION_KEY);
    if (String(current) !== String(CAROUSEL_CACHE_VERSION)) {
      localStorage.removeItem("hero_carousel_data");
      localStorage.setItem(
        CAROUSEL_CACHE_VERSION_KEY,
        String(CAROUSEL_CACHE_VERSION)
      );
    }
  } catch {}
}

let carouselEmptyStylesAdded = false;
function ensureCarouselEmptyStyles() {
  if (carouselEmptyStylesAdded) return;
  const style = document.createElement("style");
  style.id = "carousel-empty-state-styles";
  style.textContent = `
    .hero-carousel.is-empty {
      position: relative;
      min-height: 240px;
      background: linear-gradient(135deg, rgba(0,0,0,0.6), rgba(0,0,0,0.35));
    }
    .hero-carousel.is-empty .carousel-overlay,
    .hero-carousel.is-empty .carousel-nav,
    .hero-carousel.is-empty .carousel-dots {
      display: none;
    }
    .carousel-empty-state {
      position: absolute;
      top: 16px;
      right: 16px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(15, 10, 6, 0.82);
      color: #fff;
      font-size: 0.9rem;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      z-index: 12;
    }
    .carousel-empty-state i {
      color: #ffd8ae;
    }
  `;
  document.head.appendChild(style);
  carouselEmptyStylesAdded = true;
}

class HeroCarousel {
  constructor() {
    carouselDebugLog("ðŸŽ  HeroCarousel constructor called");
    ensureCarouselCacheVersion();
    ensureCarouselEmptyStyles();

    this.container = document.querySelector(".hero-carousel");
    if (!this.container) {
      carouselDebugLog("ðŸŽ  No carousel found on this page");
      return;
    }

    this.track = this.container.querySelector(".carousel-track");
    this.dotsContainer = this.container.querySelector(".carousel-dots");
    this.navContainer = this.container.querySelector(".carousel-nav");
    this.slides = [];
    this.currentIndex = 0;

    // Auto-play timers
    this.autoPlayInterval = null;
    this.autoPlayDelay = 8000;
    this.autoPlayEnabled = true;
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.autoPlayEnabled = false;
    }
    this.resumeTimeout = null;
    this.resumeDelay = 3500;
    this.isHovered = false;

    // State management
    this.isTransitioning = false;
    this.transitionTimeout = null;
    this.transitionDuration = 1100;
    this.queuedIndex = null;
    this.emptyStateEl = null;

    // Smart loading helpers
    this.preloadedImages = new Set();

    // Smart autoplay helpers
    this.isInView = true;
    this.intersectionObserver = null;

    // Touch/swipe support
    this.touchStartX = 0;
    this.touchEndX = 0;
    this.boundHandlers = {};

    // Hero content elements
    this.heroContent = {
      title: document.querySelector(".hero-content h2"),
      subtitle: document.querySelector(".hero-content .lead"),
      cta: document.querySelector(".hero-content .btn"),
    };
    this.defaultHero = {
      title: this.heroContent.title ? this.heroContent.title.textContent : "",
      subtitle: this.heroContent.subtitle
        ? this.heroContent.subtitle.textContent
        : "",
      ctaText: this.heroContent.cta ? this.heroContent.cta.textContent : "",
      ctaLink: this.heroContent.cta ? this.heroContent.cta.getAttribute("href") : "",
    };

    if (typeof window !== "undefined") {
      window.__tokeCarouselReady = false;
    }

    // Initialize immediately
    this.init();
  }

  async init() {
    carouselDebugLog("ðŸŽ  Initializing Hero Carousel...");
    try {
      const loadResult = await this.loadCarouselData(false, {
        allowStaleCache: true,
        showLoading: false,
        cacheOnly: true,
      });

      if (!loadResult?.fromCache) {
        this.slides = this.getFallbackSlides();
      }

      this.setupCarousel();
      this.syncTransitionDurationFromCss();
      await this.waitForFirstSlideReady();
      this.hideLoadingState();
      this.setupEventListeners();
      this.setupIntersectionObserver();
      this.startAutoPlay();
      const needsBackgroundRefresh =
        !loadResult?.fromCache || !loadResult?.isFresh;
      if (needsBackgroundRefresh) {
        this.refresh(true, {
          showLoading: false,
          forceRebuild: !loadResult?.fromCache,
        }).catch(() => {});
      }
    } finally {
      this.announceReady();
    }
  }

  syncTransitionDurationFromCss() {
    try {
      const slide =
        this.track && this.track.querySelector(".carousel-slide.active");
      if (!slide) return;

      const style = window.getComputedStyle(slide);
      const durations = String(style.transitionDuration || "")
        .split(",")
        .map((v) => v.trim());
      const delays = String(style.transitionDelay || "")
        .split(",")
        .map((v) => v.trim());
      const props = String(style.transitionProperty || "")
        .split(",")
        .map((v) => v.trim());

      const parseTimeMs = (value) => {
        const text = String(value || "").trim();
        if (!text) return 0;
        if (text.endsWith("ms")) {
          const n = Number.parseFloat(text);
          return Number.isFinite(n) ? n : 0;
        }
        if (text.endsWith("s")) {
          const n = Number.parseFloat(text);
          return Number.isFinite(n) ? n * 1000 : 0;
        }
        const n = Number.parseFloat(text);
        return Number.isFinite(n) ? n : 0;
      };

      const pickIndex = () => {
        const idx = props.findIndex(
          (p) => p === "opacity" || p === "all" || p === ""
        );
        return idx >= 0 ? idx : 0;
      };

      const i = pickIndex();
      const durationMs = parseTimeMs(durations[i] ?? durations[0]);
      const delayMs = parseTimeMs(delays[i] ?? delays[0]);

      const total = Math.max(0, durationMs + delayMs);
      if (total > 0) {
        // Small buffer to avoid early unlock on slow devices.
        this.transitionDuration = Math.round(total + 60);
      }
    } catch {}
  }

  setupIntersectionObserver() {
    if (!this.container || typeof IntersectionObserver === "undefined") return;

    if (this.intersectionObserver) {
      try {
        this.intersectionObserver.disconnect();
      } catch {}
      this.intersectionObserver = null;
    }

    try {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries && entries[0];
          const inView = Boolean(entry && entry.isIntersecting);
          this.isInView = inView;

          if (!this.autoPlayEnabled) return;

          if (!inView) {
            this.stopAutoPlay();
            this.clearResumeTimer();
            return;
          }

          if (!this.isHovered) {
            this.scheduleAutoPlayResume(220);
          }
        },
        { root: null, threshold: 0.15 }
      );

      this.intersectionObserver.observe(this.container);
    } catch (error) {
      carouselDebugWarn("IntersectionObserver setup failed:", error);
      this.intersectionObserver = null;
      this.isInView = true;
    }
  }

  preloadImage(url) {
    const src = normalizeCarouselAsset(url);
    if (!src || this.preloadedImages.has(src)) return;
    this.preloadedImages.add(src);

    try {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      if (typeof img.decode === "function") {
        img.decode().catch(() => {});
      }
    } catch {}
  }

  preloadNeighbors() {
    if (!Array.isArray(this.slides) || this.slides.length <= 1) return;
    const nextIndex = (this.currentIndex + 1) % this.slides.length;
    const nextNextIndex = (this.currentIndex + 2) % this.slides.length;
    this.preloadImage(this.slides[nextIndex]?.image);
    if (this.slides.length > 2) {
      this.preloadImage(this.slides[nextNextIndex]?.image);
    }
  }

  announceReady() {
    if (typeof window === "undefined") return;
    try {
      window.__tokeCarouselReady = true;
      window.dispatchEvent(
        new CustomEvent("carousel:ready", {
          detail: {
            slides: Array.isArray(this.slides) ? this.slides.length : 0,
          },
        })
      );
    } catch {}
  }

  async waitForFirstSlideReady() {
    const firstSlideImage = this.track?.querySelector(".carousel-slide img");
    if (!firstSlideImage) return;
    if (firstSlideImage.complete) return;

    if (typeof firstSlideImage.decode === "function") {
      try {
        await Promise.race([
          firstSlideImage.decode(),
          new Promise((resolve) =>
            setTimeout(resolve, CAROUSEL_READY_TIMEOUT_MS)
          ),
        ]);
        return;
      } catch {}
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        firstSlideImage.removeEventListener("load", finish);
        firstSlideImage.removeEventListener("error", finish);
        resolve();
      };

      firstSlideImage.addEventListener("load", finish, { once: true });
      firstSlideImage.addEventListener("error", finish, { once: true });
      setTimeout(finish, CAROUSEL_READY_TIMEOUT_MS);
    });
  }

  // NEW: Cleanup method for SPA navigation
  destroy() {
    carouselDebugLog("ðŸŽ  Cleaning up carousel...");

    // Stop auto-play
    this.stopAutoPlay();

    // Clear any timeouts
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }
    this.clearResumeTimer();

    // Remove event listeners
    this.teardownEventListeners();

    if (this.intersectionObserver) {
      try {
        this.intersectionObserver.disconnect();
      } catch {}
      this.intersectionObserver = null;
    }

    // Clear references
    this.container = null;
    this.track = null;
    this.dotsContainer = null;
    this.navContainer = null;
    this.slides = [];
    this.boundHandlers = {};

    carouselDebugLog("ðŸŽ  Carousel cleanup complete");
  }

  getFallbackSlides() {
    return [];
  }

  createSlidesSignature(slides = this.slides) {
    if (!Array.isArray(slides) || slides.length === 0) return "";
    return slides
      .map(
        (slide) =>
          JSON.stringify({
            id: slide?.id || "",
            image: slide?.image || "",
            alt: slide?.alt || "",
            title: slide?.title || "",
            subtitle: slide?.subtitle || "",
            cta_text: slide?.cta_text || "",
            cta_link: slide?.cta_link || "",
            display_order: slide?.display_order ?? "",
            is_active: slide?.is_active ?? "",
            updated_at: slide?.updated_at || "",
          })
      )
      .join("||");
  }

  async loadCarouselData(forceRefresh = false, options = {}) {
    const dataCacheKey = "hero_carousel_data";
    const allowStaleCache = options.allowStaleCache !== false;
    const showLoading = options.showLoading !== false;
    const cacheOnly = options.cacheOnly === true;
    // Check if carousel data is cached
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(dataCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          const cachedSlides = Array.isArray(parsed?.data)
            ? parsed.data
                .filter(
                  (item) =>
                    item &&
                    normalizeCarouselAsset(item.image) &&
                    isCarouselSlideActive(item.is_active)
                )
                .map((item) => ({
                  ...item,
                  image: normalizeCarouselAsset(item.image),
                  alt:
                    (item.alt && String(item.alt).trim()) ||
                    (item.title && String(item.title).trim()) ||
                    "Toke Bakes",
                }))
            : [];

          if (cachedSlides.length > 0) {
            const ageMs = Date.now() - Number(parsed.timestamp || 0);
            const isFresh = ageMs >= 0 && ageMs < CAROUSEL_CACHE_TTL_MS;
            if (isFresh || allowStaleCache) {
              this.slides = cachedSlides;
              carouselDebugLog(
              `âœ… Loaded ${this.slides.length} carousel slides from cache`
            );
              return { fromCache: true, isFresh };
            }
          }
        }
      } catch {}
    }

    if (cacheOnly) {
      return { fromCache: false, isFresh: false, cacheOnlyMiss: true };
    }

    if (showLoading) {
      this.showLoadingState();
    }

    try {
      carouselDebugLog("ðŸ”„ Loading carousel data...");

      if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.URL) {
        console.error("Supabase configuration not found");
        this.slides = this.getFallbackSlides();
        return { fromCache: false, isFresh: false, error: true };
      }

      const buildUrl = (simpleOrder = false) => {
        const url = new URL(`${SUPABASE_CONFIG.URL}${API_ENDPOINTS.CAROUSEL}`);
        url.searchParams.set("select", "*");
        // Prefer explicit order; fall back to simple order if requested
        url.searchParams.set(
          "order",
          simpleOrder ? "display_order.asc" : "display_order.asc,created_at.desc"
        );
        return url.toString();
      };

      const doFetch = async (simpleOrder = false) => {
        const requestUrl = buildUrl(simpleOrder);
        const response = await fetch(requestUrl, {
          cache: forceRefresh ? "no-store" : "default",
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          const err = new Error(
            `HTTP ${response.status}${errText ? `: ${errText}` : ""}`
          );
          err.status = response.status;
          throw err;
        }

        return response.json();
      };

      let data;
      try {
        data = await doFetch(false);
      } catch (primaryError) {
        // Retry once with simpler order clause if the first request fails (e.g., Supabase parsing)
        carouselDebugWarn("Primary carousel fetch failed, retrying simple order:", primaryError);
        data = await doFetch(true);
      }
      const slides = Array.isArray(data)
        ? data
            .filter(
              (item) =>
                item &&
                normalizeCarouselAsset(item.image) &&
                isCarouselSlideActive(item.is_active)
            )
            .map((item) => ({
              ...item,
              image: normalizeCarouselAsset(item.image),
              alt:
                (item.alt && String(item.alt).trim()) ||
                (item.title && String(item.title).trim()) ||
                "Toke Bakes",
            }))
        : [];

      if (slides.length === 0) {
        carouselDebugWarn("No active carousel items found");
        this.slides = [];
      } else {
        this.slides = slides;
        carouselDebugLog(`âœ… Loaded ${this.slides.length} carousel slides`);
      }

      try {
        localStorage.setItem(
          dataCacheKey,
          JSON.stringify({ data: this.slides, timestamp: Date.now() })
        );
      } catch {}

      return { fromCache: false, isFresh: true, hasSlides: this.slides.length > 0 };
    } catch (error) {
      console.error("Error loading carousel data:", error);
      if (!Array.isArray(this.slides) || this.slides.length === 0) {
        this.slides = [];
      }
      return { fromCache: false, isFresh: false, error: true };
    }
  }

  showLoadingState() {
    if (!this.container) return;

    // Create loading overlay
    const loadingOverlay = document.createElement("div");
    loadingOverlay.className = "carousel-loading";
    loadingOverlay.innerHTML = `
      <div class="loading-message">
        <div class="loading-spinner"></div>
        <p>Loading carousel...</p>
      </div>
    `;
    loadingOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    `;

    this.container.style.position = "relative";
    this.container.appendChild(loadingOverlay);

    // Remove loading after content loads
    this.container.dataset.loading = "true";
  }

  hideLoadingState() {
    if (!this.container) return;

    const loadingOverlay = this.container.querySelector(".carousel-loading");
    if (loadingOverlay) {
      loadingOverlay.remove();
    }
    delete this.container.dataset.loading;
  }

  renderEmptyState() {
    if (!this.container) return;
    this.clearEmptyState();
    this.container.classList.add("is-empty");
    if (this.track) this.track.innerHTML = "";
    if (this.dotsContainer) this.dotsContainer.innerHTML = "";
    if (this.navContainer) this.navContainer.innerHTML = "";

    const empty = document.createElement("div");
    empty.className = "carousel-empty-state";
    empty.innerHTML = `<i class="fas fa-image"></i><span>Add a hero slide in the Admin panel to display here.</span>`;
    this.emptyStateEl = empty;
    this.container.appendChild(empty);
  }

  clearEmptyState() {
    if (this.emptyStateEl) {
      this.emptyStateEl.remove();
      this.emptyStateEl = null;
    }
    if (this.container) {
      this.container.classList.remove("is-empty");
    }
  }

  setupCarousel(options = {}) {
    this.clearEmptyState();
    if (this.slides.length === 0) {
      this.renderEmptyState();
      return;
    }

    const preferredSlide = options?.preferredSlide || null;
    const preferredId =
      preferredSlide && preferredSlide.id !== undefined && preferredSlide.id !== null
        ? String(preferredSlide.id)
        : "";
    const preferredImage = preferredSlide
      ? normalizeCarouselAsset(preferredSlide.image)
      : "";

    let initialIndex = 0;
    if (Number.isFinite(options?.preferredIndex)) {
      const idx = Math.trunc(Number(options.preferredIndex));
      if (idx >= 0 && idx < this.slides.length) initialIndex = idx;
    } else if (preferredId) {
      const idx = this.slides.findIndex((slide) => String(slide?.id) === preferredId);
      if (idx >= 0) initialIndex = idx;
    } else if (preferredImage) {
      const idx = this.slides.findIndex(
        (slide) => normalizeCarouselAsset(slide?.image) === preferredImage
      );
      if (idx >= 0) initialIndex = idx;
    }

    this.currentIndex = initialIndex;
    this.isTransitioning = false;
    this.queuedIndex = null;

    // Clear existing content
    this.track.innerHTML = "";
    this.dotsContainer.innerHTML = "";
    this.navContainer.innerHTML = "";

    // Create slides
    this.slides.forEach((slide, index) => {
      // Create slide element
      const slideEl = document.createElement("div");
      const isActive = index === this.currentIndex;
      slideEl.className = `carousel-slide ${isActive ? "active" : ""}`;
      slideEl.dataset.index = index;

      // Use eager loading for active image, lazy for others
      const loading = isActive ? "eager" : "lazy";

      slideEl.innerHTML = `
        <img src="${slide.image}"
             alt="${slide.alt || "Toke Bakes"}"
             class="slide-image"
             loading="${loading}"
             decoding="async"
             fetchpriority="${isActive ? "high" : "auto"}"
             onerror="this.onerror=null; this.src='${CAROUSEL_FALLBACK_IMAGE}';">
      `;

      if (isActive) {
        slideEl.setAttribute("aria-current", "true");
      }

      this.track.appendChild(slideEl);

      // Create dot
      const dot = document.createElement("button");
      dot.className = `carousel-dot ${isActive ? "active" : ""}`;
      dot.dataset.index = index;
      dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
      dot.setAttribute("aria-current", isActive ? "true" : "false");
      this.dotsContainer.appendChild(dot);
    });

    // Create navigation arrows if we have more than 1 slide
    if (this.slides.length > 1) {
      this.navContainer.innerHTML = `
        <button class="carousel-prev" type="button" aria-label="Previous slide">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <button class="carousel-next" type="button" aria-label="Next slide">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      `;
    }

    // Sync hero content with the active slide
    this.updateHeroContent(this.slides[this.currentIndex]);
    this.preloadNeighbors();
  }

  updateHeroContent(slide, options = {}) {
    if (!this.heroContent.title && !this.heroContent.subtitle) return;

    const title = slide?.title || this.defaultHero.title;
    const subtitle = slide?.subtitle || this.defaultHero.subtitle;
    const ctaText = slide?.cta_text || this.defaultHero.ctaText;
    const ctaLink = slide?.cta_link || this.defaultHero.ctaLink;

    if (this.heroContent.title) {
      this.heroContent.title.textContent = title;
    }
    if (this.heroContent.subtitle) {
      this.heroContent.subtitle.textContent = subtitle;
    }
    if (this.heroContent.cta) {
      this.heroContent.cta.textContent = ctaText;
      if (ctaLink) {
        this.heroContent.cta.setAttribute("href", ctaLink);
      }
    }

    if (options && options.animate) {
      this.animateHeroContent();
    }
  }

  animateHeroContent() {
    try {
      if (
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
    } catch {}

    const targets = [
      this.heroContent.title,
      this.heroContent.subtitle,
      this.heroContent.cta,
    ].filter(Boolean);

    targets.forEach((el, i) => {
      try {
        if (typeof el.animate !== "function") return;
        el.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 460,
            easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            fill: "both",
            delay: i * 55,
          }
        );
      } catch {}
    });
  }

  setupEventListeners() {
    this.teardownEventListeners();
    if (this.slides.length <= 1) return;

    // Dots navigation
    this.boundHandlers.dotsClick = (e) => {
      const targetEl =
        e.target instanceof Element ? e.target : e.target?.parentElement;
      const dot =
        targetEl && typeof targetEl.closest === "function"
          ? targetEl.closest(".carousel-dot")
          : null;
      if (!dot) return;

      const index = parseInt(dot.dataset.index);
      if (!isNaN(index) && index !== this.currentIndex) {
        this.goToSlide(index);
        this.pauseAutoPlay();
      }
    };
    this.dotsContainer.addEventListener("click", this.boundHandlers.dotsClick);

    // Arrow navigation
    if (this.navContainer) {
      this.boundHandlers.navClick = (e) => {
        e.stopPropagation();
        const targetEl =
          e.target instanceof Element ? e.target : e.target?.parentElement;
        const prevBtn =
          targetEl && typeof targetEl.closest === "function"
            ? targetEl.closest(".carousel-prev")
            : null;
        const nextBtn =
          targetEl && typeof targetEl.closest === "function"
            ? targetEl.closest(".carousel-next")
            : null;

        if (prevBtn) {
          this.prevSlide();
        } else if (nextBtn) {
          this.nextSlide();
        }

        this.pauseAutoPlay();
      };
      this.navContainer.addEventListener("click", this.boundHandlers.navClick);
    }

    // Mouse hover handling
    this.boundHandlers.mouseEnter = () => {
      this.isHovered = true;
      this.stopAutoPlay();
      this.clearResumeTimer();
    };
    this.container.addEventListener("mouseenter", this.boundHandlers.mouseEnter);

    this.boundHandlers.mouseLeave = () => {
      this.isHovered = false;
      this.scheduleAutoPlayResume();
    };
    this.container.addEventListener("mouseleave", this.boundHandlers.mouseLeave);

    // Touch/swipe support
    this.boundHandlers.touchStart = (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
      this.stopAutoPlay();
      this.clearResumeTimer();
    };
    this.track.addEventListener(
      "touchstart",
      this.boundHandlers.touchStart,
      { passive: true }
    );

    this.boundHandlers.touchEnd = (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe();
      this.scheduleAutoPlayResume(this.resumeDelay + 1000);
    };
    this.track.addEventListener(
      "touchend",
      this.boundHandlers.touchEnd,
      { passive: true }
    );

    // Keyboard navigation
    this.boundHandlers.keydown = (e) => {
        if (
        !this.container ||
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA"
      )
        return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.prevSlide();
        this.pauseAutoPlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        this.nextSlide();
        this.pauseAutoPlay();
      }
    };
    document.addEventListener("keydown", this.boundHandlers.keydown);

    // Pause auto-play when tab is not visible (saves CPU + avoids slide jumps).
    this.boundHandlers.visibilityChange = () => {
      if (!this.autoPlayEnabled) return;
      if (document.hidden) {
        this.stopAutoPlay();
        this.clearResumeTimer();
        return;
      }
      if (!this.isHovered) {
        this.scheduleAutoPlayResume(220);
      }
    };
    document.addEventListener(
      "visibilitychange",
      this.boundHandlers.visibilityChange
    );
  }

  teardownEventListeners() {
    if (this.dotsContainer && this.boundHandlers.dotsClick) {
      this.dotsContainer.removeEventListener("click", this.boundHandlers.dotsClick);
    }
    if (this.navContainer && this.boundHandlers.navClick) {
      this.navContainer.removeEventListener("click", this.boundHandlers.navClick);
    }
    if (this.container && this.boundHandlers.mouseEnter) {
      this.container.removeEventListener("mouseenter", this.boundHandlers.mouseEnter);
    }
    if (this.container && this.boundHandlers.mouseLeave) {
      this.container.removeEventListener("mouseleave", this.boundHandlers.mouseLeave);
    }
    if (this.track && this.boundHandlers.touchStart) {
      this.track.removeEventListener("touchstart", this.boundHandlers.touchStart);
    }
    if (this.track && this.boundHandlers.touchEnd) {
      this.track.removeEventListener("touchend", this.boundHandlers.touchEnd);
    }
    if (this.boundHandlers.keydown) {
      document.removeEventListener("keydown", this.boundHandlers.keydown);
    }
    if (this.boundHandlers.visibilityChange) {
      document.removeEventListener(
        "visibilitychange",
        this.boundHandlers.visibilityChange
      );
    }
  }

  handleSwipe() {
    if (this.slides.length <= 1) return;

    const swipeThreshold = 50;
    const diff = this.touchStartX - this.touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        this.nextSlide();
      } else {
        this.prevSlide();
      }
    }
  }

  goToSlide(index) {
    const nextIndex = Number(index);
    if (!Number.isFinite(nextIndex)) return;
    if (nextIndex === this.currentIndex) return;
    if (nextIndex < 0 || nextIndex >= this.slides.length) return;

    if (this.isTransitioning) {
      // Queue the latest request so nav always feels responsive.
      this.queuedIndex = nextIndex;
      return;
    }

    // Set transitioning state
    this.isTransitioning = true;
    this.queuedIndex = null;

    // Get current and next elements
    const currentSlide = this.track.querySelector(".carousel-slide.active");
    const nextSlide = this.track.querySelector(
      `.carousel-slide[data-index="${nextIndex}"]`
    );
    const currentDot = this.dotsContainer.querySelector(".carousel-dot.active");
    const nextDot = this.dotsContainer.querySelector(
      `.carousel-dot[data-index="${nextIndex}"]`
    );

    // Update classes
    if (currentSlide) currentSlide.classList.remove("active");
    if (nextSlide) nextSlide.classList.add("active");
    if (currentDot) currentDot.classList.remove("active");
    if (nextDot) nextDot.classList.add("active");

    // Update ARIA attributes
    if (currentSlide) currentSlide.removeAttribute("aria-current");
    if (nextSlide) nextSlide.setAttribute("aria-current", "true");
    if (currentDot) currentDot.setAttribute("aria-current", "false");
    if (nextDot) nextDot.setAttribute("aria-current", "true");

    // Update current index
    this.currentIndex = nextIndex;

    // Sync hero content with current slide
    this.updateHeroContent(this.slides[nextIndex], { animate: true });
    this.preloadNeighbors();

    const finishTransition = () => {
      if (this.transitionTimeout) {
        clearTimeout(this.transitionTimeout);
        this.transitionTimeout = null;
      }
      if (!this.isTransitioning) return;
      this.isTransitioning = false;

      if (
        this.queuedIndex !== null &&
        this.queuedIndex !== this.currentIndex
      ) {
        const queued = this.queuedIndex;
        this.queuedIndex = null;
        this.goToSlide(queued);
      }
    };

    // Clear any existing timeout
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }

    if (nextSlide) {
      const onEnd = (event) => {
        if (!event) return;
        if (event.target !== nextSlide) return;
        if (event.propertyName && event.propertyName !== "opacity") return;
        finishTransition();
      };
      nextSlide.addEventListener("transitionend", onEnd, { once: true });
    }

    // Fallback in case transitionend doesn't fire.
    this.transitionTimeout = setTimeout(
      finishTransition,
      Math.max(0, Number(this.transitionDuration) || 0)
    );
  }

  nextSlide() {
    if (this.slides.length <= 1) return;
    const nextIndex = (this.currentIndex + 1) % this.slides.length;
    this.goToSlide(nextIndex);
  }

  prevSlide() {
    if (this.slides.length <= 1) return;
    const prevIndex =
      (this.currentIndex - 1 + this.slides.length) % this.slides.length;
    this.goToSlide(prevIndex);
  }

  // Auto-play methods
  startAutoPlay() {
    if (
      this.slides.length <= 1 ||
      !this.autoPlayEnabled ||
      this.isHovered ||
      !this.isInView
    )
      return;

    this.stopAutoPlay();

    this.autoPlayInterval = setInterval(() => {
      if (!this.isTransitioning) {
        this.nextSlide();
      }
    }, this.autoPlayDelay);
  }

  stopAutoPlay() {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
      this.autoPlayInterval = null;
    }
  }

  clearResumeTimer() {
    if (this.resumeTimeout) {
      clearTimeout(this.resumeTimeout);
      this.resumeTimeout = null;
    }
  }

  scheduleAutoPlayResume(delay = this.resumeDelay) {
    if (!this.autoPlayEnabled) return;
    if (!this.isInView) return;
    this.clearResumeTimer();

    this.resumeTimeout = setTimeout(() => {
      this.resumeTimeout = null;
      if (this.autoPlayEnabled && !this.isHovered) {
        this.startAutoPlay();
      }
    }, delay);
  }

  pauseAutoPlay(delay = this.resumeDelay) {
    this.stopAutoPlay();
    this.scheduleAutoPlayResume(delay);
  }

  toggleAutoPlay() {
    this.autoPlayEnabled = !this.autoPlayEnabled;
    if (this.autoPlayEnabled) {
      this.startAutoPlay();
    } else {
      this.stopAutoPlay();
    }
  }

  // Refresh when admin updates data
  async refresh(forceRefresh = false, options = {}) {
    carouselDebugLog("Refreshing carousel...");
    const previousSlide =
      Array.isArray(this.slides) && this.slides.length > 0
        ? this.slides[this.currentIndex]
        : null;
    const previousSignature = this.createSlidesSignature();
    const loadResult = await this.loadCarouselData(forceRefresh, options);
    const nextSignature = this.createSlidesSignature();

    if (
      previousSignature &&
      previousSignature === nextSignature &&
      !options.forceRebuild
    ) {
      this.announceReady();
      return loadResult;
    }

    this.setupCarousel({ preferredSlide: previousSlide });
    this.syncTransitionDurationFromCss();
    await this.waitForFirstSlideReady();
    this.setupEventListeners();
    this.setupIntersectionObserver();

    if (this.autoPlayEnabled) {
      this.startAutoPlay();
    }

    this.announceReady();
    return loadResult;
  }

  // Backward compatibility with older update callers.
  async reload(forceRefresh = false, options = {}) {
    return this.refresh(forceRefresh, options);
  }
}

function refreshCarouselFromSync(payload = {}) {
  if (!window.heroCarousel || typeof window.heroCarousel.refresh !== "function") {
    return;
  }

  if (payload.type !== "DATA_UPDATED") return;
  if (payload.itemType !== "carousel" && payload.itemType !== "all") return;

  carouselDebugLog("Refreshing carousel from sync payload", payload);
  window.heroCarousel.refresh(true, { showLoading: false });
}

function bindCarouselUpdateSync() {
  if (window.carouselUpdateUnsubscribe) {
    try {
      window.carouselUpdateUnsubscribe();
    } catch {}
    window.carouselUpdateUnsubscribe = null;
  }

  if (window.carouselUpdateChannel) {
    try {
      window.carouselUpdateChannel.close();
    } catch {}
    window.carouselUpdateChannel = null;
  }

  if (window.carouselLocalUpdateHandler) {
    window.removeEventListener("toke:data-updated", window.carouselLocalUpdateHandler);
    window.carouselLocalUpdateHandler = null;
  }

  if (
    window.TokeUpdateSync &&
    typeof window.TokeUpdateSync.subscribe === "function"
  ) {
    window.carouselUpdateUnsubscribe = window.TokeUpdateSync.subscribe(
      refreshCarouselFromSync
    );
    return;
  }

  // Legacy fallback path when shared sync bus is unavailable.
  if (typeof BroadcastChannel !== "undefined") {
    if (window.carouselUpdateChannel) {
      try {
        window.carouselUpdateChannel.close();
      } catch {}
    }

    try {
      const channel = new BroadcastChannel("toke_bakes_data_updates");
      window.carouselUpdateChannel = channel;
      channel.onmessage = (event) => {
        refreshCarouselFromSync(event && event.data ? event.data : {});
      };
    } catch (error) {
      carouselDebugWarn("BroadcastChannel unavailable for carousel sync:", error);
      window.carouselUpdateChannel = null;
    }
  }

  window.carouselLocalUpdateHandler = (event) => {
    refreshCarouselFromSync((event && event.detail) || {});
  };
  window.addEventListener("toke:data-updated", window.carouselLocalUpdateHandler);
}

// Initialize carousel - UPDATED FOR SPA
function initializeCarousel() {
  // Don't initialize on admin pages
  if (
    window.location.pathname.includes("admin") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container")
  ) {
    carouselDebugLog("Skipping carousel on admin page");
    return;
  }

  // Clean up existing carousel before creating new one
  if (
    window.heroCarousel &&
    typeof window.heroCarousel.destroy === "function"
  ) {
    window.heroCarousel.destroy();
  }

  // Initialize new carousel
  window.heroCarousel = new HeroCarousel();
  bindCarouselUpdateSync();
}

// Start initialization
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeCarousel);
} else {
  initializeCarousel();
}

// Export for SPA manager
if (typeof window !== "undefined") {
  window.initializeCarousel = initializeCarousel;
  window.HeroCarousel = HeroCarousel;
}


