// config.js - WORKING VERSION (FIXED)
const SUPABASE_CONFIG = {
  URL: "https://lmqoflcikfcxoeyinjus.supabase.co",
  ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtcW9mbGNpa2ZjeG9leWluanVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMzAyOTQsImV4cCI6MjA4MDgwNjI5NH0.eiKT9S_HHtNUO0yXHHDE-rfL8BhZXj5p90mT4FKdpWo",
};

const API_ENDPOINTS = {
  GALLERY: "/rest/v1/gallery",
  FEATURED: "/rest/v1/featured_items",
  MENU: "/rest/v1/menu_items",
  MENU_OPTION_GROUPS: "/rest/v1/product_option_groups",
  MENU_OPTION_VALUES: "/rest/v1/product_option_values",
  THEMES: "/rest/v1/website_themes",
  CAROUSEL: "/rest/v1/hero_carousel",
};

window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.API_ENDPOINTS = API_ENDPOINTS;
