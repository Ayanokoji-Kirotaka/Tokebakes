/* ================== carousel.js - SPA-ENHANCED VERSION ================== */

class HeroCarousel {
  constructor() {
    console.log("🎠 HeroCarousel constructor called");

    this.container = document.querySelector(".hero-carousel");
    if (!this.container) {
      console.log("🎠 No carousel found on this page");
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

    // State management
    this.isTransitioning = false;
    this.transitionTimeout = null;
    this.transitionDuration = 600;

    // Touch/swipe support
    this.touchStartX = 0;
    this.touchEndX = 0;

    // Initialize immediately
    this.init();
  }

  async init() {
    console.log("🎠 Initializing Hero Carousel...");
    await this.loadCarouselData();
    this.setupCarousel();
    this.hideLoadingState();
    this.setupEventListeners();
    this.startAutoPlay();
  }

  // NEW: Cleanup method for SPA navigation
  destroy() {
    console.log("🎠 Cleaning up carousel...");

    // Stop auto-play
    this.stopAutoPlay();

    // Clear any timeouts
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }

    // Remove event listeners
    if (this.navContainer) {
      const newNavContainer = this.navContainer.cloneNode(false);
      this.navContainer.parentNode.replaceChild(
        newNavContainer,
        this.navContainer
      );
    }

    if (this.dotsContainer) {
      const newDotsContainer = this.dotsContainer.cloneNode(false);
      this.dotsContainer.parentNode.replaceChild(
        newDotsContainer,
        this.dotsContainer
      );
    }

    // Clear references
    this.container = null;
    this.track = null;
    this.dotsContainer = null;
    this.navContainer = null;
    this.slides = [];

    console.log("🎠 Carousel cleanup complete");
  }

  async loadCarouselData() {
    const cacheKey = "carousel_loaded";
    const isFirstLoad = (() => {
      try {
        return !localStorage.getItem(cacheKey);
      } catch (e) {
        return false;
      }
    })();

    // Check if carousel data is cached
    const dataCacheKey = "hero_carousel_data";
    let hasCachedData = false;
    try {
      const cached = localStorage.getItem(dataCacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          // 24 hours
          hasCachedData = true;
          this.slides = parsed.data;
          console.log(
            `✅ Loaded ${this.slides.length} carousel slides from cache`
          );
          return;
        }
      }
    } catch (e) {}

    if (isFirstLoad || !hasCachedData) {
      // Show loading state only on first visit or when data not cached
      this.showLoadingState();
    }

    const startTime = Date.now();

    try {
      console.log("🔄 Loading carousel data...");

      if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.URL) {
        console.error("Supabase configuration not found");
        return;
      }

      const response = await fetch(
        `${SUPABASE_CONFIG.URL}${API_ENDPOINTS.CAROUSEL}?is_active=eq.true&order=display_order.asc,created_at.desc&select=*`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Cache the data
      try {
        localStorage.setItem(
          dataCacheKey,
          JSON.stringify({ data: data, timestamp: Date.now() })
        );
      } catch (e) {}

      if (isFirstLoad) {
        // Ensure minimum loading time for smooth UX
        const elapsed = Date.now() - startTime;
        const minLoadingTime = 300; // 300ms minimum
        if (elapsed < minLoadingTime) {
          await new Promise((resolve) =>
            setTimeout(resolve, minLoadingTime - elapsed)
          );
        }
      }

      // Mark as loaded
      try {
        localStorage.setItem(cacheKey, "true");
      } catch (e) {}

      if (!data || data.length === 0) {
        console.warn("No active carousel items found");
        this.slides = [
          {
            id: "default",
            image: "images/default-bg.jpg",
            alt: "Toke Bakes Artisan Bakery",
          },
        ];
      } else {
        this.slides = data;
        console.log(`✅ Loaded ${this.slides.length} carousel slides`);
      }
    } catch (error) {
      console.error("Error loading carousel data:", error);
      this.slides = [
        {
          id: "default",
          image: "images/default-bg.jpg",
          alt: "Toke Bakes Artisan Bakery",
        },
      ];
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
             onerror="this.onerror=null; this.src='images/default-bg.jpg';">
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
  }

  setupEventListeners() {
    if (this.slides.length <= 1) return;

    // Dots navigation
    this.dotsContainer.addEventListener("click", (e) => {
      const dot = e.target.closest(".carousel-dot");
      if (!dot || this.isTransitioning) return;

      const index = parseInt(dot.dataset.index);
      if (!isNaN(index) && index !== this.currentIndex) {
        this.goToSlide(index);
        this.pauseAutoPlay();
      }
    });

    // Arrow navigation
    if (this.navContainer) {
      this.navContainer.addEventListener("click", (e) => {
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
      });
    }

    // Mouse hover handling
    this.container.addEventListener("mouseenter", () => {
      this.stopAutoPlay();
    });

    this.container.addEventListener("mouseleave", () => {
      if (this.autoPlayEnabled) {
        this.startAutoPlay();
      }
    });

    // Touch/swipe support
    this.track.addEventListener(
      "touchstart",
      (e) => {
        this.touchStartX = e.changedTouches[0].screenX;
        this.stopAutoPlay();
      },
      { passive: true }
    );

    this.track.addEventListener(
      "touchend",
      (e) => {
        this.touchEndX = e.changedTouches[0].screenX;
        this.handleSwipe();
        this.pauseAutoPlay();
      },
      { passive: true }
    );

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
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
    });
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
    if (this.slides.length <= 1 || !this.autoPlayEnabled) return;

    this.stopAutoPlay();

    this.autoPlayInterval = setInterval(() => {
      if (!this.isTransitioning) {
        this.nextSlide();
      }
    }, this.autoPlayDelay);

    console.log("▶️ Auto-play started");
  }

  stopAutoPlay() {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
      this.autoPlayInterval = null;
      console.log("⏸️ Auto-play stopped");
    }
  }

  pauseAutoPlay() {
    this.stopAutoPlay();

    // Restart after delay if auto-play is enabled
    if (this.autoPlayEnabled) {
      setTimeout(() => {
        if (this.autoPlayEnabled && !this.autoPlayInterval) {
          this.startAutoPlay();
        }
      }, 3000);
    }
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
  async refresh() {
    console.log("🔄 Refreshing carousel...");
    await this.loadCarouselData();
    this.setupCarousel();
    this.setupEventListeners();

    if (this.autoPlayEnabled) {
      this.startAutoPlay();
    }
  }
}

// Initialize carousel - UPDATED FOR SPA
function initializeCarousel() {
  // Don't initialize on admin pages
  if (
    window.location.pathname.includes("admin") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container")
  ) {
    console.log("⏭️ Skipping carousel on admin page");
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

  // Listen for updates from admin panel
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("toke_bakes_data_updates");
    channel.onmessage = (event) => {
      if (
        event.data.type === "DATA_UPDATED" &&
        event.data.itemType === "carousel" &&
        window.heroCarousel
      ) {
        console.log("🔄 Carousel update detected from admin panel");
        window.heroCarousel.refresh();
      }
    };
  }
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
}
