/* ==================== config.js - Enhanced with Error Handling ==================== */
const SUPABASE_CONFIG = {
  URL: "https://lmqoflcikfcxoeyinjus.supabase.co",
  ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtcW9mbGNpa2ZjeG9leWluanVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMzAyOTQsImV4cCI6MjA4MDgwNjI5NH0.eiKT9S_HHtNUO0yXHHDE-rfL8BhZXj5p90mT4FKdpWo",
};

const API_ENDPOINTS = {
  GALLERY: "/rest/v1/gallery",
  FEATURED: "/rest/v1/featured_items",
  MENU: "/rest/v1/menu_items",
  THEMES: "/rest/v1/website_themes",
  CAROUSEL: "/rest/v1/hero_carousel",
};

/* ==================== CACHE CONFIGURATION ==================== */
const CACHE_CONFIG = {
  VERSION: "v2.1",

  // Cache expiry times (milliseconds)
  EXPIRY: {
    MENU: 5 * 60 * 1000, // 5 minutes
    FEATURED: 10 * 60 * 1000, // 10 minutes
    GALLERY: 60 * 60 * 1000, // 1 hour
    CAROUSEL: 30 * 60 * 1000, // 30 minutes
    THEMES: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Cache keys
  KEYS: {
    MENU: "toke_bakes_cache_menu_v2",
    FEATURED: "toke_bakes_cache_featured_v2",
    GALLERY: "toke_bakes_cache_gallery_v2",
    CAROUSEL: "toke_bakes_cache_carousel_v2",
    THEMES: "toke_bakes_cache_themes_v2",
    TIMESTAMP: "toke_bakes_cache_timestamp_v2",
  },

  // Background update interval
  UPDATE_INTERVAL: 30 * 1000, // 30 seconds

  // Offline fallback
  OFFLINE_TIMEOUT: 3000, // 3 seconds

  // Memory cache size limit
  MAX_MEMORY_ITEMS: 50,
};

// Make globally available
window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.API_ENDPOINTS = API_ENDPOINTS;
window.CACHE_CONFIG = CACHE_CONFIG;

// Check if we're in admin panel and disable cache if needed
(function () {
  const isAdminPage =
    window.location.pathname.includes("admin-panel.html") ||
    document.querySelector(".admin-dashboard") ||
    document.querySelector(".admin-login-container");

  if (isAdminPage) {
    console.log("🔧 Admin panel detected - cache system will be disabled");
    // Cache system will detect this and disable itself
  }
})();

console.log("✅ Enhanced Config loaded with Error Handling");
