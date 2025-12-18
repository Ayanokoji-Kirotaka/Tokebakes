// config.js - FIXED VERSION
const SUPABASE_CONFIG = {
  URL: "https://lmqoflcikfcxoeyinjus.supabase.co",
  ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtcW9mbGNpa2ZjeG9leWluanVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMzAyOTQsImV4cCI6MjA4MDgwNjI5NH0.eiKT9S_HHtNUO0yXHHDE-rfL8BhZXj5p90mT4FKdpWo",
};

const API_ENDPOINTS = {
  GALLERY: "/rest/v1/gallery",
  FEATURED: "/rest/v1/featured_items",
  MENU: "/rest/v1/menu_items",
  ADMIN_USERS: "/rest/v1/admin_users",
  WEBSITE_THEMES: "/rest/v1/website_themes",
};

// Make available globally
window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.API_ENDPOINTS = API_ENDPOINTS;

console.log("✅ Config.js loaded");
