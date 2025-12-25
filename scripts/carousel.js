/* ==================== carousel.js - CACHE-ENHANCED VERSION ==================== */

class HeroCarousel {
  constructor() {
    console.log("🎠 HeroCarousel with Cache Support initializing...");

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

    // Cache tracking
    this.cacheKey = CACHE_CONFIG.KEYS.CAROUSEL;
    this.cacheExpiry = CACHE_CONFIG.EXPIRY.CAROUSEL;

    // Initialize with cache first
    this.initWithCache();
  }

  async initWithCache() {
    console.log("🎠 Initializing carousel with cache...");

    // Show skeleton immediately
    this.showSkeleton();

    // Try to load from cache first
    const cachedData = await this.loadFromCache();

    if (cachedData && cachedData.length > 0) {
      console.log("⚡ Carousel loaded from cache");
      this.slides = cachedData;
      this.setupCarousel();
      this.setupEventListeners();
      this.startAutoPlay();
    }

    // Then fetch fresh data in background
    setTimeout(() => {
      this.loadFreshData();
    }, 100);
  }

  async loadFromCache() {
    try {
      // Check memory cache
      if (
        window.cacheManager &&
        window.cacheManager.memoryCache.has(this.cacheKey)
      ) {
        const cached = window.cacheManager.memoryCache.get(this.cacheKey);
        if (Date.now() - cached.timestamp < cached.expiry) {
          return cached.data;
        }
      }

      // Check localStorage
      const stored = localStorage.getItem(this.cacheKey);
      if (stored) {
        const cached = JSON.parse(stored);
        if (
          Date.now() - cached.timestamp < cached.expiry &&
          cached.version === CACHE_CONFIG.VERSION
        ) {
          // Update memory cache
          if (window.cacheManager) {
            window.cacheManager.memoryCache.set(this.cacheKey, cached);
          }

          return cached.data;
        }
      }
    } catch (error) {
      console.error("Error loading carousel from cache:", error);
    }

    return null;
  }

  async loadFreshData() {
    try {
      console.log("🔄 Fetching fresh carousel data...");

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

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

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
        console.log(`✅ Loaded ${this.slides.length} fresh carousel slides`);
      }

      // Cache the data
      this.saveToCache(this.slides);

      // Update UI if needed
      if (
        this.track.children.length === 0 ||
        this.track.children.length !== this.slides.length
      ) {
        this.setupCarousel();
        this.setupEventListeners();
      }
    } catch (error) {
      console.error("Error loading fresh carousel data:", error);

      // If we have no slides at all, use default
      if (this.slides.length === 0) {
        this.slides = [
          {
            id: "default",
            image: "images/default-bg.jpg",
            alt: "Toke Bakes Artisan Bakery",
          },
        ];
        this.setupCarousel();
      }
    }
  }

  saveToCache(data) {
    try {
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        expiry: this.cacheExpiry,
        version: CACHE_CONFIG.VERSION,
      };

      // Save to localStorage
      localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));

      // Save to memory cache
      if (window.cacheManager) {
        window.cacheManager.memoryCache.set(this.cacheKey, cacheData);
      }

      console.log("✅ Carousel data cached");
    } catch (error) {
      console.error("Error caching carousel data:", error);
    }
  }

  showSkeleton() {
    if (!this.track) return;

    this.track.innerHTML = `
      <div class="carousel-slide skeleton">
        <div class="skeleton-image"></div>
      </div>
    `;

    if (this.dotsContainer) {
      this.dotsContainer.innerHTML = `
        <div class="carousel-dot skeleton"></div>
        <div class="carousel-dot skeleton"></div>
        <div class="carousel-dot skeleton"></div>
      `;
    }
  }

  setupCarousel() {
    if (this.slides.length === 0) return;

    // Clear existing content
    this.track.innerHTML = "";
    this.dotsContainer.innerHTML = "";

    // Create slides
    this.slides.forEach((slide, index) => {
      const slideEl = document.createElement("div");
      slideEl.className = `carousel-slide ${index === 0 ? "active" : ""}`;
      slideEl.dataset.index = index;

      const loading = index === 0 ? "eager" : "lazy";

      slideEl.innerHTML = `
        <img src="${slide.image}"
             alt="${slide.alt || "Toke Bakes"}"
             class="slide-image ${index === 0 ? "loaded" : ""}"
             loading="${loading}"
             onerror="this.onerror=null; this.src='images/default-bg.jpg';"
             ${index === 0 ? "" : 'data-src="' + slide.image + '"'}>
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
    if (this.slides.length > 1 && this.navContainer) {
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

    // Lazy load other images
    this.lazyLoadImages();
  }

  lazyLoadImages() {
    const images = this.track.querySelectorAll("img[data-src]");
    images.forEach((img, index) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const img = entry.target;
              img.src = img.dataset.src;
              img.classList.add("loaded");
              img.removeAttribute("data-src");
              observer.unobserve(img);
            }
          });
        },
        {
          rootMargin: "50px",
        }
      );

      observer.observe(img);
    });
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

    // Listen for cache updates
    window.addEventListener("cacheUpdated", () => {
      console.log("🔄 Carousel cache update received");
      this.refresh();
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
    if (
      this.isTransitioning ||
      index === this.currentIndex ||
      index < 0 ||
      index >= this.slides.length
    )
      return;

    this.isTransitioning = true;

    const currentSlide = this.track.querySelector(".carousel-slide.active");
    const nextSlide = this.track.querySelector(
      `.carousel-slide[data-index="${index}"]`
    );
    const currentDot = this.dotsContainer.querySelector(".carousel-dot.active");
    const nextDot = this.dotsContainer.querySelector(
      `.carousel-dot[data-index="${index}"]`
    );

    if (currentSlide) currentSlide.classList.remove("active");
    if (nextSlide) nextSlide.classList.add("active");
    if (currentDot) currentDot.classList.remove("active");
    if (nextDot) nextDot.classList.add("active");

    if (currentSlide) currentSlide.removeAttribute("aria-current");
    if (nextSlide) nextSlide.setAttribute("aria-current", "true");
    if (currentDot) currentDot.setAttribute("aria-current", "false");
    if (nextDot) nextDot.setAttribute("aria-current", "true");

    this.currentIndex = index;

    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }

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
  }

  stopAutoPlay() {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
      this.autoPlayInterval = null;
    }
  }

  pauseAutoPlay() {
    this.stopAutoPlay();

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
    await this.loadFreshData();

    if (this.autoPlayEnabled) {
      this.startAutoPlay();
    }
  }

  // Cleanup method for SPA
  destroy() {
    console.log("🎠 Cleaning up carousel...");

    this.stopAutoPlay();

    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }

    // Remove all event listeners by cloning
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

    this.container = null;
    this.track = null;
    this.dotsContainer = null;
    this.navContainer = null;
    this.slides = [];
  }
}

// Initialize carousel
function initializeCarousel() {
  if (
    window.location.pathname.includes("admin") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container")
  ) {
    console.log("⏭️ Skipping carousel on admin page");
    return;
  }

  if (
    window.heroCarousel &&
    typeof window.heroCarousel.destroy === "function"
  ) {
    window.heroCarousel.destroy();
  }

  window.heroCarousel = new HeroCarousel();

  // Listen for admin updates
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
