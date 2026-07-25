// config.js - WORKING VERSION (FIXED)
const SUPABASE_CONFIG = {
  URL: "https://pxegqpnugoygqccpvdqf.supabase.co",
  ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4ZWdxcG51Z295Z3FjY3B2ZHFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MjI5NzgsImV4cCI6MjEwMDQ5ODk3OH0.yAQ4jDh1HoyFAbHck66H2vD2U7JEv-cEKzd6XB3gOCc",
};

const API_ENDPOINTS = {
  SPECIALS: "/rest/v1/specials",
  FEATURED: "/rest/v1/featured_items",
  MENU: "/rest/v1/menu_items",
  MENU_OPTION_GROUPS: "/rest/v1/product_option_groups",
  MENU_OPTION_VALUES: "/rest/v1/product_option_values",
  THEMES: "/rest/v1/website_themes",
  CAROUSEL: "/rest/v1/hero_carousel",
};

window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.API_ENDPOINTS = API_ENDPOINTS;
