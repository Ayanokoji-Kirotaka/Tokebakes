/* ==================== service-worker-manager.js ==================== */

class ServiceWorkerManager {
  constructor() {
    this.isSupported = "serviceWorker" in navigator;
    this.isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    this.init();
  }

  async init() {
    if (!this.isSupported) {
      console.log("⚠️ Service Worker not supported in this browser");
      return;
    }

    if (this.isLocalhost) {
      console.log("⚠️ Service Worker disabled on localhost for development");
      return;
    }

    try {
      await this.registerServiceWorker();
      this.setupUpdateChecking();
      console.log("✅ Service Worker Manager initialized");
    } catch (error) {
      console.error("❌ Service Worker initialization failed:", error);
    }
  }

  async registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register(
        "service-worker.js",
        {
          scope: "/",
          updateViaCache: "none",
        }
      );

      console.log("✅ Service Worker registered:", registration);

      // Check for updates
      if (registration.waiting) {
        this.showUpdateReady(registration.waiting);
      }

      // Listen for updates
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        console.log("🔄 New Service Worker installing...");

        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            this.showUpdateReady(newWorker);
          }
        });
      });

      // Track registration
      this.registration = registration;
    } catch (error) {
      console.error("❌ Service Worker registration failed:", error);
      throw error;
    }
  }

  setupUpdateChecking() {
    // Check for updates every hour
    setInterval(() => {
      if (this.registration) {
        this.registration.update();
      }
    }, 60 * 60 * 1000);

    // Also check on page focus
    window.addEventListener("focus", () => {
      if (this.registration) {
        this.registration.update();
      }
    });
  }

  showUpdateReady(worker) {
    // Create update notification
    const notification = document.createElement("div");
    notification.className = "service-worker-update";
    notification.innerHTML = `
      <div class="update-content">
        <p><strong>New version available!</strong></p>
        <p>Refresh to update the application.</p>
        <div class="update-actions">
          <button class="update-refresh">Refresh Now</button>
          <button class="update-later">Later</button>
        </div>
      </div>
    `;

    document.body.appendChild(notification);

    // Add styles
    if (!document.querySelector("#update-notification-styles")) {
      const style = document.createElement("style");
      style.id = "update-notification-styles";
      style.textContent = `
        .service-worker-update {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1.5rem;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          z-index: 10000;
          max-width: 300px;
          animation: slideInUp 0.3s ease-out;
        }

        .update-content p {
          margin: 0 0 10px 0;
          line-height: 1.4;
        }

        .update-actions {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }

        .update-refresh, .update-later {
          flex: 1;
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .update-refresh {
          background: white;
          color: #667eea;
        }

        .update-refresh:hover {
          background: #f8f9fa;
          transform: translateY(-2px);
        }

        .update-later {
          background: rgba(255,255,255,0.2);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
        }

        .update-later:hover {
          background: rgba(255,255,255,0.3);
        }

        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 480px) {
          .service-worker-update {
            left: 20px;
            right: 20px;
            max-width: none;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Event listeners
    notification
      .querySelector(".update-refresh")
      .addEventListener("click", () => {
        worker.postMessage({ type: "SKIP_WAITING" });
        window.location.reload();
      });

    notification
      .querySelector(".update-later")
      .addEventListener("click", () => {
        notification.style.animation = "slideInUp 0.3s ease-out reverse";
        setTimeout(() => notification.remove(), 300);
      });

    // Auto-remove after 30 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = "slideInUp 0.3s ease-out reverse";
        setTimeout(() => notification.remove(), 300);
      }
    }, 30000);
  }

  async clearCache() {
    if (!this.isSupported) return;

    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );

      console.log("✅ All caches cleared");
      return true;
    } catch (error) {
      console.error("❌ Failed to clear cache:", error);
      return false;
    }
  }

  async getCacheSize() {
    if (!this.isSupported) return 0;

    try {
      const cacheNames = await caches.keys();
      let totalSize = 0;

      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();

        for (const request of requests) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error("Error calculating cache size:", error);
      return 0;
    }
  }
}

// Initialize Service Worker Manager
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.serviceWorkerManager = new ServiceWorkerManager();
  });
} else {
  window.serviceWorkerManager = new ServiceWorkerManager();
}
