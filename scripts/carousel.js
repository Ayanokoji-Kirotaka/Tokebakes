/* ================== carousel.js - SPA-ENHANCED VERSION ================== */

const CAROUSEL_DEBUG = false;
const CAROUSEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CAROUSEL_READY_TIMEOUT_MS = 450;
const CAROUSEL_FALLBACK_IMAGE = "images/logo.webp";
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

class HeroCarousel {
  constructor() {
    carouselDebugLog("ðŸŽ  HeroCarousel constructor called");

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
    this.autoPlayDelay = 5000;
    this.autoPlayEnabled = true;
    this.resumeTimeout = null;
    this.resumeDelay = 3500;
    this.isHovered = false;

    // State management
    this.isTransitioning = false;
    this.transitionTimeout = null;
    this.transitionDuration = 600;

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
      await this.waitForFirstSlideReady();
      this.hideLoadingState();
      this.setupEventListeners();
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
    return [
      {
        id: "default",
        image: CAROUSEL_FALLBACK_IMAGE,
        alt: "Toke Bakes Artisan Bakery",
      },
    ];
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

      const requestUrl = `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.CAROUSEL}?order=display_order.asc,created_at.desc&select=*${
        forceRefresh ? `&_=${Date.now()}` : ""
      }`;

      const response = await fetch(requestUrl, {
          cache: forceRefresh ? "no-store" : "default",
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
          },
        });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
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
        this.slides = this.getFallbackSlides();
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

      return { fromCache: false, isFresh: true };
    } catch (error) {
      console.error("Error loading carousel data:", error);
      if (!Array.isArray(this.slides) || this.slides.length === 0) {
        this.slides = this.getFallbackSlides();
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

  setupCarousel() {
    if (this.slides.length === 0) return;

    // Clear existing content
    this.track.innerHTML = "";
    this.dotsContainer.innerHTML = "";
    this.navContainer.innerHTML = "";

    // Create slides
    this.slides.forEach((slide, index) => {
      // Create slide element
      const slideEl = document.createElement("div");
      slideEl.className = `carousel-slide ${index === 0 ? "active" : ""}`;
      slideEl.dataset.index = index;

      // Use eager loading for first image, lazy for others
      const loading = index === 0 ? "eager" : "lazy";

      slideEl.innerHTML = `
        <img src="${slide.image}"
             alt="${slide.alt || "Toke Bakes"}"
             class="slide-image"
             loading="${loading}"
             decoding="async"
             fetchpriority="${index === 0 ? "high" : "auto"}"
             onerror="this.onerror=null; this.src='${CAROUSEL_FALLBACK_IMAGE}';">
      `;

      this.track.appendChild(slideEl);

      // Create dot
      const dot = document.createElement("button");
      dot.className = `carousel-dot ${index === 0 ? "active" : ""}`;
      dot.dataset.index = index;
      dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
      dot.setAttribute("aria-current", index === 0 ? "true" : "false");
      this.dotsContainer.appendChild(dot);
    });

    // Create navigation arrows if we have more than 1 slide
    if (this.slides.length > 1) {
      this.navContainer.innerHTML = `
        <button class="carousel-prev" aria-label="Previous slide">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <button class="carousel-next" aria-label="Next slide">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      `;
    }

    // Sync hero content with the first slide
    this.updateHeroContent(this.slides[0]);
  }

  updateHeroContent(slide) {
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
  }

  setupEventListeners() {
    this.teardownEventListeners();
    if (this.slides.length <= 1) return;

    // Dots navigation
    this.boundHandlers.dotsClick = (e) => {
      const dot = e.target.closest(".carousel-dot");
      if (!dot || this.isTransitioning) return;

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

        if (this.isTransitioning) return;

        const prevBtn = e.target.closest(".carousel-prev");
        const nextBtn = e.target.closest(".carousel-next");

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
        this.isTransitioning ||
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
  }

  handleSwipe() {
    if (this.slides.length <= 1 || this.isTransitioning) return;

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
    // Prevent multiple transitions at once
    if (
      this.isTransitioning ||
      index === this.currentIndex ||
      index < 0 ||
      index >= this.slides.length
    )
      return;

    // Set transitioning state
    this.isTransitioning = true;

    // Get current and next elements
    const currentSlide = this.track.querySelector(".carousel-slide.active");
    const nextSlide = this.track.querySelector(
      `.carousel-slide[data-index="${index}"]`
    );
    const currentDot = this.dotsContainer.querySelector(".carousel-dot.active");
    const nextDot = this.dotsContainer.querySelector(
      `.carousel-dot[data-index="${index}"]`
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
    this.currentIndex = index;

    // Sync hero content with current slide
    this.updateHeroContent(this.slides[index]);

    // Clear any existing timeout
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }

    // Reset transitioning state after animation
    this.transitionTimeout = setTimeout(() => {
      this.isTransitioning = false;
      this.transitionTimeout = null;
    }, this.transitionDuration);
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
    if (this.slides.length <= 1 || !this.autoPlayEnabled || this.isHovered)
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

    this.setupCarousel();
    await this.waitForFirstSlideReady();
    this.setupEventListeners();

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


