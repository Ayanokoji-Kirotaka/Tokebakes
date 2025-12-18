/* ================== admin.js - COMPLETE FIXED VERSION ================== */
/* Toke Bakes Admin Panel - NO DUPLICATE DECLARATIONS */

// Initialize global variables
let currentAdmin = null;
let isEditing = false;
let currentEditId = null;
let sessionTimeout = null;
const SESSION_TIMEOUT_MINUTES = 30;

// Store for temporary image data
let tempImageCache = new Map();

// Admin credentials
const ADMIN_CREDENTIALS = {
  username: "admin",
  passwordHash:
    "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
};

// Available themes - MOVED TO TOP LEVEL TO AVOID REDECLARATION
const AVAILABLE_THEMES = [
  {
    name: "Default Theme",
    file: "style.css",
    icon: "🍊",
    description: "Orange bakery theme",
  },
  {
    name: "Valentine's Day",
    file: "theme-valentine.css",
    icon: "❤️",
    description: "Romantic pink & red theme",
  },
  {
    name: "Ramadan",
    file: "theme-ramadan.css",
    icon: "🌙",
    description: "Green & gold theme",
  },
  {
    name: "Independence Day",
    file: "theme-independenceday.css",
    icon: "🇳🇬",
    description: "Green & white Nigerian theme",
  },
  {
    name: "Halloween",
    file: "theme-halloween.css",
    icon: "🎃",
    description: "Spooky orange & purple theme",
  },
  {
    name: "Christmas",
    file: "theme-christmas.css",
    icon: "🎄",
    description: "Festive red & green theme",
  },
];

/* ================== AUTO-UPDATE SYSTEM ================== */
class DataSyncManager {
  constructor() {
    this.lastUpdateKey = "toke_bakes_last_update";
    this.broadcastChannel = null;
    this.init();
  }

  init() {
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel("toke_bakes_data_updates");
      console.log("✅ DataSyncManager initialized");
    }
  }

  notifyDataChanged(operationType, itemType, data = null) {
    const timestamp = Date.now().toString();
    localStorage.setItem(this.lastUpdateKey, timestamp);

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: "DATA_UPDATED",
        timestamp: timestamp,
        operation: operationType,
        itemType: itemType,
        data: data,
      });
    }

    console.log(`📡 Data changed: ${operationType} ${itemType}`);
  }
}

// Initialize sync manager
const dataSync = new DataSyncManager();

/* ================== CUSTOM POPUP SYSTEM ================== */
function showPopup(options) {
  return new Promise((resolve) => {
    // Remove existing popup
    const existingPopup = document.getElementById("custom-popup-overlay");
    if (existingPopup) existingPopup.remove();

    const {
      title = "Notification",
      message,
      type = "info",
      showCancel = false,
      cancelText = "Cancel",
      confirmText = "OK",
    } = options;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.id = "custom-popup-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
      backdrop-filter: blur(4px);
    `;

    // Create popup
    const popup = document.createElement("div");
    popup.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 0;
      min-width: 320px;
      max-width: 450px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      overflow: hidden;
      font-family: 'Poppins', sans-serif;
    `;

    // Header
    const typeColors = {
      info: "#2196F3",
      success: "#4CAF50",
      warning: "#FF9800",
      error: "#F44336",
      question: "#9C27B0",
    };

    const header = document.createElement("div");
    header.style.cssText = `
      background: ${typeColors[type] || typeColors.info};
      color: white;
      padding: 1.5rem;
      text-align: center;
    `;

    const titleEl = document.createElement("h3");
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0;
      font-size: 1.4rem;
      font-weight: 600;
    `;
    header.appendChild(titleEl);
    popup.appendChild(header);

    // Message
    const messageEl = document.createElement("div");
    messageEl.style.cssText = `
      padding: 2rem;
      color: #333;
      line-height: 1.6;
      text-align: center;
      font-size: 1rem;
    `;
    messageEl.textContent = message;
    popup.appendChild(messageEl);

    // Buttons
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 0 2rem 2rem;
      justify-content: ${showCancel ? "space-between" : "center"};
    `;

    // Cancel button
    if (showCancel) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = cancelText;
      cancelBtn.style.cssText = `
        flex: 1;
        padding: 12px 24px;
        background: #f5f5f5;
        color: #666;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: 'Poppins', sans-serif;
      `;

      cancelBtn.addEventListener("click", () => {
        overlay.remove();
        resolve(false);
      });
      buttonsContainer.appendChild(cancelBtn);
    }

    // Confirm button
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      flex: 1;
      padding: 12px 24px;
      background: ${typeColors[type] || typeColors.info};
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: 'Poppins', sans-serif;
    `;

    confirmBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    buttonsContainer.appendChild(confirmBtn);
    popup.appendChild(buttonsContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

/* ================== NOTIFICATION SYSTEM ================== */
function showNotification(message, type = "success") {
  // Remove existing notification
  const existing = document.getElementById("admin-notification");
  if (existing) existing.remove();

  const themes = {
    success: { background: "#4CAF50", icon: "✅" },
    error: { background: "#F44336", icon: "❌" },
    warning: { background: "#FF9800", icon: "⚠️" },
    info: { background: "#2196F3", icon: "ℹ️" },
  };

  const theme = themes[type] || themes.success;

  const notification = document.createElement("div");
  notification.id = "admin-notification";
  notification.className = `admin-notification admin-notification-${type}`;
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="font-size: 1.2rem;">${theme.icon}</div>
      <div style="flex: 1; font-family: 'Poppins', sans-serif; font-size: 0.95rem;">${message}</div>
      <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: white; font-size: 1.2rem; cursor: pointer; padding: 4px;">×</button>
    </div>
  `;

  notification.style.cssText = `
    position: fixed;
    top: 25px;
    right: 25px;
    background: ${theme.background};
    color: white;
    padding: 1.2rem 1.5rem;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    max-width: 380px;
    min-width: 300px;
    font-family: 'Poppins', sans-serif;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(notification);

  // Auto remove after 3 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.style.animation = "slideOut 0.3s ease-out forwards";
      setTimeout(() => notification.remove(), 300);
    }
  }, 3000);
}

// Add CSS animations (only once)
if (!document.querySelector("#notification-animations")) {
  const style = document.createElement("style");
  style.id = "notification-animations";
  style.textContent = `
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    @keyframes slideOut {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }
  `;
  document.head.appendChild(style);
}

/* ================== SECURITY FUNCTIONS ================== */
function sanitizeInput(input) {
  if (typeof input !== "string") return input;
  return input
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .trim();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function hashPassword(password) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.error("Password hashing failed:", error);
    return password;
  }
}

/* ================== API FUNCTIONS ================== */
async function secureRequest(endpoint, method = "GET", data = null) {
  try {
    if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
      throw new Error("Supabase configuration missing");
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_CONFIG.ANON_KEY,
      Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
      Prefer: "return=representation",
    };

    const config = {
      method: method,
      headers: headers,
    };

    if (data && (method === "POST" || method === "PATCH" || method === "PUT")) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(`${SUPABASE_CONFIG.URL}${endpoint}`, config);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP ${response.status}: ${errorText.substring(0, 200)}`
      );
    }

    if (method === "DELETE" && response.status === 204) {
      return { success: true };
    }

    if (response.status !== 204) {
      return await response.json();
    }

    return { success: true };
  } catch (error) {
    console.error("API request failed:", error);
    throw error;
  }
}

async function loadDataFromSupabase(endpoint) {
  try {
    const result = await secureRequest(
      `${endpoint}?select=*&order=created_at.desc`
    );
    return result || [];
  } catch (error) {
    console.error(`Error loading from ${endpoint}:`, error);
    return [];
  }
}

/* ================== IMAGE COMPRESSION ================== */
async function compressImage(file, maxSizeKB = 300) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      showNotification("❌ Please select an image file", "error");
      reject(new Error("File is not an image"));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showNotification("❌ Image is too large! Maximum size is 10MB", "error");
      reject(new Error("Image must be less than 10MB"));
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement("canvas");
        const maxDimension = 1200;
        let width = img.width;
        let height = img.height;
        const aspectRatio = width / height;

        if (width > height && width > maxDimension) {
          width = maxDimension;
          height = Math.round(maxDimension / aspectRatio);
        } else if (height > maxDimension) {
          height = maxDimension;
          width = Math.round(maxDimension * aspectRatio);
        }

        if (width < 500) width = 500;
        if (height < 500) height = 500;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first, fallback to JPEG
        let quality = 0.85;
        let base64;
        let format = "webp";

        try {
          base64 = canvas.toDataURL("image/webp", quality);
        } catch (error) {
          base64 = canvas.toDataURL("image/jpeg", quality);
          format = "jpeg";
        }

        const result = {
          data: base64,
          format: format,
          size: base64.length,
          dimensions: { width, height },
          originalSize: file.size,
          qualityUsed: quality,
        };

        const originalKB = (file.size / 1024).toFixed(1);
        const compressedKB = (result.data.length / 1024).toFixed(1);
        showNotification(`✅ Image optimized to ${compressedKB}KB`, "success");

        resolve(result);
      };
      img.onerror = () => {
        showNotification("❌ Could not load image", "error");
        reject(new Error("Failed to load image"));
      };
      img.src = event.target.result;
    };
    reader.onerror = () => {
      showNotification("❌ Error reading file", "error");
      reject(new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });
}

/* ================== AUTHENTICATION ================== */
async function checkLogin(username, password) {
  try {
    // First try to check against database
    try {
      const response = await secureRequest(
        `/rest/v1/admin_users?username=eq.${username}&select=password_hash`
      );

      if (response && response.length > 0) {
        const dbHash = response[0].password_hash;
        const hashedPassword = await hashPassword(password);

        if (hashedPassword === dbHash) {
          createSession(username);
          return true;
        }
      }
    } catch (dbError) {
      console.log("Database check failed, using local credentials");
    }

    // Fallback to local credentials
    const sanitizedUsername = sanitizeInput(username);
    if (sanitizedUsername !== ADMIN_CREDENTIALS.username) {
      return false;
    }

    const hashedPassword = await hashPassword(password);
    if (hashedPassword === ADMIN_CREDENTIALS.passwordHash) {
      createSession(username);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Login error:", error);
    return false;
  }
}

function createSession(username) {
  const session = {
    username: username,
    loginTime: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + SESSION_TIMEOUT_MINUTES * 60 * 1000
    ).toISOString(),
  };

  sessionStorage.setItem("admin_session", JSON.stringify(session));
  startSessionTimeout();
}

function checkSession() {
  const sessionData = sessionStorage.getItem("admin_session");
  if (!sessionData) return false;

  const session = JSON.parse(sessionData);
  const expiresAt = new Date(session.expiresAt);

  if (expiresAt > new Date()) {
    currentAdmin = session.username;
    startSessionTimeout();
    return true;
  }

  sessionStorage.removeItem("admin_session");
  return false;
}

function startSessionTimeout() {
  if (sessionTimeout) clearTimeout(sessionTimeout);

  sessionTimeout = setTimeout(() => {
    showNotification("Session expired. Please log in again.", "warning");
    logoutAdmin();
  }, SESSION_TIMEOUT_MINUTES * 60 * 1000);
}

function logoutAdmin() {
  currentAdmin = null;
  isEditing = false;
  currentEditId = null;

  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
    sessionTimeout = null;
  }

  sessionStorage.removeItem("admin_session");

  document.getElementById("login-screen").style.display = "block";
  document.getElementById("admin-dashboard").style.display = "none";

  resetAllForms();
  showNotification("Logged out successfully", "success");
}

/* ================== HOLIDAY THEME MANAGEMENT ================== */
// Update theme UI
function updateThemeUI(activeThemeFile) {
  const themeCards = document.querySelectorAll(".theme-card");

  themeCards.forEach((card) => {
    const isActive = card.dataset.themeFile === activeThemeFile;

    // Update active class
    card.classList.toggle("active", isActive);

    // Update status badge
    const statusBadge = card.querySelector(".theme-status");
    if (statusBadge) {
      if (isActive) {
        statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> ACTIVE';
        statusBadge.classList.add("active");
      } else {
        // Restore original status
        const themeFile = card.dataset.themeFile;
        const themeInfo = AVAILABLE_THEMES.find((t) => t.file === themeFile);
        if (themeInfo) {
          const icon = themeInfo.icon;
          const name = themeInfo.name.split(" ")[0];
          statusBadge.innerHTML = `${icon} ${name}`;
        }
        statusBadge.classList.remove("active");
      }
    }

    // Update button
    const actionButton = card.querySelector(".theme-actions button");
    if (actionButton) {
      if (isActive) {
        actionButton.innerHTML = '<i class="fas fa-check"></i> Active';
        actionButton.classList.remove("btn-activate-theme");
        actionButton.classList.add("btn-active-theme");
        actionButton.disabled = true;
      } else {
        actionButton.innerHTML = '<i class="fas fa-play"></i> Activate';
        actionButton.classList.remove("btn-active-theme");
        actionButton.classList.add("btn-activate-theme");
        actionButton.disabled = false;
      }
    }
  });
}

// Load current theme from database
async function loadCurrentTheme() {
  try {
    const themesLoading = document.getElementById("themes-loading");
    const themesEmptyState = document.getElementById("themes-empty-state");
    const themesGrid = document.getElementById("themes-grid");

    // Show loading
    if (themesLoading) themesLoading.style.display = "block";
    if (themesGrid) themesGrid.style.display = "none";

    // Try database first
    try {
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/website_themes?is_active=eq.true&select=css_file&limit=1`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          },
        }
      );

      if (response.ok) {
        const [theme] = await response.json();
        if (theme?.css_file) {
          updateThemeUI(theme.css_file);

          // Hide loading, show grid
          if (themesLoading) themesLoading.style.display = "none";
          if (themesGrid) themesGrid.style.display = "grid";

          console.log("✅ Current theme loaded from database:", theme.css_file);
          return theme.css_file;
        }
      }
    } catch (dbError) {
      console.log("Database theme load failed:", dbError.message);
    }

    // Fallback: Default theme
    updateThemeUI("style.css");

    // Hide loading, show grid
    if (themesLoading) themesLoading.style.display = "none";
    if (themesGrid) themesGrid.style.display = "grid";

    console.log("✅ Using default theme");
    return "style.css";
  } catch (error) {
    console.error("Error loading current theme:", error);

    // Show error state
    const themesLoading = document.getElementById("themes-loading");
    const themesEmptyState = document.getElementById("themes-empty-state");
    const themesGrid = document.getElementById("themes-grid");

    if (themesLoading) themesLoading.style.display = "none";
    if (themesEmptyState) {
      themesEmptyState.style.display = "block";
      themesEmptyState.innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <p>Couldn't load themes. Using default.</p>
        <button class="btn-admin" onclick="location.reload()">
          <i class="fas fa-redo"></i> Retry
        </button>
      `;
    }
    if (themesGrid) themesGrid.style.display = "grid";

    return "style.css";
  }
}

// Activate holiday theme
async function activateTheme(themeFile) {
  try {
    showNotification("🔄 Activating theme...", "info");

    const themeName =
      AVAILABLE_THEMES.find((t) => t.file === themeFile)?.name || themeFile;

    const confirmed = await showPopup({
      title: "Activate Theme",
      message: `Are you sure you want to activate "${themeName}"?\n\nThis will change the appearance of your website for ALL visitors.`,
      type: "question",
      showCancel: true,
      cancelText: "Cancel",
      confirmText: "Activate Now",
    });

    if (!confirmed) {
      showNotification("Theme activation cancelled", "info");
      return false;
    }

    // Check if table exists
    try {
      const testResponse = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/website_themes?limit=1`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          },
        }
      );

      if (!testResponse.ok) {
        throw new Error("Theme table not accessible");
      }
    } catch (error) {
      console.error("Theme system error:", error);
      showNotification(
        "Theme system not set up. Please check database.",
        "error"
      );
      return false;
    }

    // 1. Deactivate all themes
    await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/website_themes`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_CONFIG.ANON_KEY,
        Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        is_active: false,
        updated_at: new Date().toISOString(),
      }),
    });

    // 2. Activate selected theme
    const activateResponse = await fetch(
      `${
        SUPABASE_CONFIG.URL
      }/rest/v1/website_themes?css_file=eq.${encodeURIComponent(themeFile)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          is_active: true,
          activated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!activateResponse.ok) {
      // Theme might not exist in database yet
      console.log("Theme not found, inserting...");

      const insertResponse = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/website_themes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            css_file: themeFile,
            theme_name: themeName,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            activated_at: new Date().toISOString(),
          }),
        }
      );

      if (!insertResponse.ok) {
        throw new Error(
          `Failed to insert theme: HTTP ${insertResponse.status}`
        );
      }
    }

    // 3. Update UI immediately
    updateThemeUI(themeFile);

    // 4. Notify all website instances
    dataSync.notifyDataChanged("theme_activated", "website_theme", {
      css_file: themeFile,
      theme_name: themeName,
      timestamp: Date.now(),
    });

    // 5. Show success notification
    showNotification(
      `🎨 "${themeName}" theme activated for all visitors!`,
      "success"
    );

    console.log(`✅ Theme "${themeName}" activated successfully`);
    return true;
  } catch (error) {
    console.error("Theme activation failed:", error);
    showNotification("Failed to activate theme: " + error.message, "error");
    return false;
  }
}

/* ================== CONTENT MANAGEMENT ================== */
// Featured Items
async function renderFeaturedItems() {
  const container = document.getElementById("featured-items-list");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(API_ENDPOINTS.FEATURED);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-star"></i>
          <p>No featured items yet. Add your first item!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map(
        (item) => `
      <div class="item-card" data-id="${item.id}">
        <img src="${item.image}" alt="${
          item.title
        }" class="item-card-img" loading="lazy">
        <div class="item-card-content">
          <h3 class="item-card-title">${escapeHtml(item.title)}</h3>
          <p class="item-card-desc">${escapeHtml(item.description)}</p>
          <div class="item-card-actions">
            <button class="btn-edit" onclick="editFeaturedItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteFeaturedItem('${
              item.id
            }')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Error rendering featured items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load featured items. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveFeaturedItem(e) {
  e.preventDefault();

  const title = document.getElementById("featured-title").value.trim();
  const description = document
    .getElementById("featured-description")
    .value.trim();
  const imageFile = document.getElementById("featured-image").files[0];
  const itemId = document.getElementById("featured-id").value;

  if (!title || !description) {
    showNotification("Please fill in all required fields", "error");
    return;
  }

  try {
    let imageBase64 = "";

    if (imageFile) {
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showNotification("Please select an image", "error");
      return;
    }

    const formData = {
      title: sanitizeInput(title),
      description: sanitizeInput(description),
      image: imageBase64,
    };

    if (isEditing && itemId) {
      await secureRequest(
        `${API_ENDPOINTS.FEATURED}?id=eq.${itemId}`,
        "PATCH",
        formData
      );
      showNotification("Featured item updated!", "success");
      dataSync.notifyDataChanged("update", "featured");
    } else {
      await secureRequest(API_ENDPOINTS.FEATURED, "POST", formData);
      showNotification("Featured item added!", "success");
      dataSync.notifyDataChanged("create", "featured");
    }

    resetFeaturedForm();
    await renderFeaturedItems();
    await updateItemCounts();
  } catch (error) {
    console.error("Error saving featured item:", error);
    showNotification("Failed to save item", "error");
  }
}

async function editFeaturedItem(id) {
  try {
    const items = await loadDataFromSupabase(API_ENDPOINTS.FEATURED);
    const item = items.find((i) => i.id === id);

    if (!item) {
      showNotification("Item not found", "error");
      return;
    }

    document.getElementById("featured-id").value = item.id;
    document.getElementById("featured-title").value = item.title;
    document.getElementById("featured-description").value = item.description;

    const preview = document.getElementById("featured-image-preview");
    preview.innerHTML = `<img src="${item.image}" alt="Current image" style="max-height: 150px; border-radius: 8px;">`;

    document.getElementById("featured-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    // Cache image
    tempImageCache.set(id, item.image);

    document
      .getElementById("featured-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading featured item for edit:", error);
    showNotification("Failed to load item for editing", "error");
  }
}

async function deleteFeaturedItem(id) {
  const confirmed = await showPopup({
    title: "Delete Featured Item",
    message:
      "Are you sure you want to delete this featured item? This action cannot be undone.",
    type: "warning",
    showCancel: true,
    cancelText: "Cancel",
    confirmText: "Delete",
  });

  if (!confirmed) {
    showNotification("Deletion cancelled", "info");
    return;
  }

  try {
    await secureRequest(`${API_ENDPOINTS.FEATURED}?id=eq.${id}`, "DELETE");
    showNotification("Featured item deleted!", "success");

    tempImageCache.delete(id);
    await renderFeaturedItems();
    await updateItemCounts();
    dataSync.notifyDataChanged("delete", "featured");
  } catch (error) {
    console.error("Error deleting featured item:", error);
    showNotification("Failed to delete item", "error");
  }
}

// Menu Items
async function renderMenuItems() {
  const container = document.getElementById("menu-items-list");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(API_ENDPOINTS.MENU);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>No menu items yet. Add your first item!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map(
        (item) => `
      <div class="item-card" data-id="${item.id}" data-item="${escapeHtml(
          item.title
        )}" data-price="${item.price}">
        <img src="${item.image}" alt="${
          item.title
        }" class="item-card-img" loading="lazy">
        <div class="item-card-content">
          <h3 class="item-card-title">${escapeHtml(item.title)}</h3>
          <p class="item-card-desc">${escapeHtml(item.description)}</p>
          <div class="item-card-actions">
            <button class="btn-edit" onclick="editMenuItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteMenuItem('${item.id}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Error rendering menu items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load menu items. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveMenuItem(e) {
  e.preventDefault();

  const title = document.getElementById("menu-title").value.trim();
  const description = document.getElementById("menu-description").value.trim();
  const price = document.getElementById("menu-price").value;
  const imageFile = document.getElementById("menu-image").files[0];
  const itemId = document.getElementById("menu-id").value;

  if (!title || !description || !price) {
    showNotification("Please fill in all required fields", "error");
    return;
  }

  if (price < 0) {
    showNotification("Price must be a positive number", "error");
    return;
  }

  try {
    let imageBase64 = "";

    if (imageFile) {
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showNotification("Please select an image", "error");
      return;
    }

    const formData = {
      title: sanitizeInput(title),
      description: sanitizeInput(description),
      price: Number(price),
      image: imageBase64,
    };

    if (isEditing && itemId) {
      await secureRequest(
        `${API_ENDPOINTS.MENU}?id=eq.${itemId}`,
        "PATCH",
        formData
      );
      showNotification("Menu item updated!", "success");
      dataSync.notifyDataChanged("update", "menu");
    } else {
      await secureRequest(API_ENDPOINTS.MENU, "POST", formData);
      showNotification("Menu item added!", "success");
      dataSync.notifyDataChanged("create", "menu");
    }

    resetMenuForm();
    await renderMenuItems();
    await updateItemCounts();
  } catch (error) {
    console.error("Error saving menu item:", error);
    showNotification("Failed to save menu item", "error");
  }
}

async function editMenuItem(id) {
  try {
    const items = await loadDataFromSupabase(API_ENDPOINTS.MENU);
    const item = items.find((i) => i.id === id);

    if (!item) {
      showNotification("Menu item not found", "error");
      return;
    }

    document.getElementById("menu-id").value = item.id;
    document.getElementById("menu-title").value = item.title;
    document.getElementById("menu-description").value = item.description;
    document.getElementById("menu-price").value = item.price;

    const preview = document.getElementById("menu-image-preview");
    preview.innerHTML = `<img src="${item.image}" alt="Current image" style="max-height: 150px; border-radius: 8px;">`;

    document.getElementById("menu-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    tempImageCache.set(id, item.image);

    document
      .getElementById("menu-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading menu item for edit:", error);
    showNotification("Failed to load menu item for editing", "error");
  }
}

async function deleteMenuItem(id) {
  const confirmed = await showPopup({
    title: "Delete Menu Item",
    message:
      "Are you sure you want to delete this menu item? This action cannot be undone.",
    type: "warning",
    showCancel: true,
    cancelText: "Cancel",
    confirmText: "Delete",
  });

  if (!confirmed) {
    showNotification("Deletion cancelled", "info");
    return;
  }

  try {
    await secureRequest(`${API_ENDPOINTS.MENU}?id=eq.${id}`, "DELETE");
    showNotification("Menu item deleted!", "success");

    tempImageCache.delete(id);
    await renderMenuItems();
    await updateItemCounts();
    dataSync.notifyDataChanged("delete", "menu");
  } catch (error) {
    console.error("Error deleting menu item:", error);
    showNotification("Failed to delete menu item", "error");
  }
}

// Gallery Items
async function renderGalleryItems() {
  const container = document.getElementById("gallery-admin-grid");
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(API_ENDPOINTS.GALLERY);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>No gallery images yet. Add your first image!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map(
        (item) => `
      <div class="gallery-admin-item" data-id="${item.id}">
        <img src="${item.image}" alt="${item.alt}" loading="lazy">
        <div class="gallery-admin-overlay">
          <p><strong>Alt Text:</strong> ${escapeHtml(item.alt)}</p>
          <div class="gallery-admin-actions">
            <button class="btn-edit" onclick="editGalleryItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteGalleryItem('${
              item.id
            }')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Error rendering gallery items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load gallery items. Please check your connection.</p>
      </div>
    `;
  }
}

async function saveGalleryItem(e) {
  e.preventDefault();

  const alt = document.getElementById("gallery-alt").value.trim();
  const imageFile = document.getElementById("gallery-image").files[0];
  const itemId = document.getElementById("gallery-id").value;

  if (!alt) {
    showNotification("Please enter alt text", "error");
    return;
  }

  try {
    let imageBase64 = "";

    if (imageFile) {
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showNotification("Please select an image", "error");
      return;
    }

    const formData = {
      alt: sanitizeInput(alt),
      image: imageBase64,
    };

    if (isEditing && itemId) {
      await secureRequest(
        `${API_ENDPOINTS.GALLERY}?id=eq.${itemId}`,
        "PATCH",
        formData
      );
      showNotification("Gallery image updated!", "success");
      dataSync.notifyDataChanged("update", "gallery");
    } else {
      await secureRequest(API_ENDPOINTS.GALLERY, "POST", formData);
      showNotification("Gallery image added!", "success");
      dataSync.notifyDataChanged("create", "gallery");
    }

    resetGalleryForm();
    await renderGalleryItems();
    await updateItemCounts();
  } catch (error) {
    console.error("Error saving gallery item:", error);
    showNotification("Failed to save gallery item", "error");
  }
}

async function editGalleryItem(id) {
  try {
    const items = await loadDataFromSupabase(API_ENDPOINTS.GALLERY);
    const item = items.find((i) => i.id === id);

    if (!item) {
      showNotification("Gallery item not found", "error");
      return;
    }

    document.getElementById("gallery-id").value = item.id;
    document.getElementById("gallery-alt").value = item.alt;

    const preview = document.getElementById("gallery-image-preview");
    preview.innerHTML = `<img src="${item.image}" alt="Current image" style="max-height: 150px; border-radius: 8px;">`;

    document.getElementById("gallery-form-container").style.display = "block";
    isEditing = true;
    currentEditId = id;

    tempImageCache.set(id, item.image);

    document
      .getElementById("gallery-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading gallery item for edit:", error);
    showNotification("Failed to load gallery item for editing", "error");
  }
}

async function deleteGalleryItem(id) {
  const confirmed = await showPopup({
    title: "Delete Gallery Image",
    message:
      "Are you sure you want to delete this gallery image? This action cannot be undone.",
    type: "warning",
    showCancel: true,
    cancelText: "Cancel",
    confirmText: "Delete",
  });

  if (!confirmed) {
    showNotification("Deletion cancelled", "info");
    return;
  }

  try {
    await secureRequest(`${API_ENDPOINTS.GALLERY}?id=eq.${id}`, "DELETE");
    showNotification("Gallery image deleted!", "success");

    tempImageCache.delete(id);
    await renderGalleryItems();
    await updateItemCounts();
    dataSync.notifyDataChanged("delete", "gallery");
  } catch (error) {
    console.error("Error deleting gallery item:", error);
    showNotification("Failed to delete gallery item", "error");
  }
}

/* ================== FORM FUNCTIONS ================== */
function resetFeaturedForm() {
  document.getElementById("featured-form").reset();
  document.getElementById("featured-id").value = "";
  document.getElementById("featured-image-preview").innerHTML = "";
  document.getElementById("featured-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetMenuForm() {
  document.getElementById("menu-form").reset();
  document.getElementById("menu-id").value = "";
  document.getElementById("menu-image-preview").innerHTML = "";
  document.getElementById("menu-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetGalleryForm() {
  document.getElementById("gallery-form").reset();
  document.getElementById("gallery-id").value = "";
  document.getElementById("gallery-image-preview").innerHTML = "";
  document.getElementById("gallery-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetAllForms() {
  resetFeaturedForm();
  resetMenuForm();
  resetGalleryForm();
}

/* ================== STORAGE & COUNTS ================== */
async function updateStorageUsage() {
  try {
    const [featured, menu, gallery] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(API_ENDPOINTS.GALLERY),
    ]);

    const allItems = [...featured, ...menu, ...gallery];
    let totalBytes = 0;

    allItems.forEach((item) => {
      if (item.image) {
        const base64Length = item.image.length;
        const padding = item.image.endsWith("==")
          ? 2
          : item.image.endsWith("=")
          ? 1
          : 0;
        totalBytes += (base64Length * 3) / 4 - padding;
      }
    });

    const mbUsed = (totalBytes / (1024 * 1024)).toFixed(2);
    const percentage = Math.min((mbUsed / 500) * 100, 100).toFixed(1);

    const storageUsedEl = document.getElementById("storage-used");
    const storageFillEl = document.getElementById("storage-fill");
    const storageInfoEl = document.getElementById("storage-info");

    if (storageUsedEl) storageUsedEl.textContent = mbUsed;
    if (storageFillEl) storageFillEl.style.width = `${percentage}%`;
    if (storageInfoEl) storageInfoEl.textContent = `${mbUsed} MB / 500 MB`;

    return { mbUsed, itemCount: allItems.length };
  } catch (error) {
    console.error("Error updating storage usage:", error);
    return { mbUsed: 0, itemCount: 0 };
  }
}

async function updateItemCounts() {
  try {
    const [featured, menu, gallery] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(API_ENDPOINTS.GALLERY),
    ]);

    const countFeatured = document.getElementById("count-featured");
    const countMenu = document.getElementById("count-menu");
    const countGallery = document.getElementById("count-gallery");

    if (countFeatured) countFeatured.textContent = featured.length || 0;
    if (countMenu) countMenu.textContent = menu.length || 0;
    if (countGallery) countGallery.textContent = gallery.length || 0;

    await updateStorageUsage();
  } catch (error) {
    console.error("Error updating counts:", error);
  }
}

/* ================== PASSWORD CHANGE ================== */
async function changePassword(currentPass, newPass, confirmPass) {
  try {
    // Verify current password
    const currentValid = await checkLogin("admin", currentPass);
    if (!currentValid) {
      return { success: false, message: "Current password is incorrect" };
    }

    if (newPass !== confirmPass) {
      return { success: false, message: "New passwords do not match" };
    }

    if (newPass.length < 8) {
      return {
        success: false,
        message: "Password must be at least 8 characters",
      };
    }

    // Generate new hash
    const newHash = await hashPassword(newPass);

    // Update database
    try {
      await secureRequest(`/rest/v1/admin_users?username=eq.admin`, "PATCH", {
        password_hash: newHash,
        last_login: new Date().toISOString(),
      });

      // Update local credentials
      ADMIN_CREDENTIALS.passwordHash = newHash;

      return {
        success: true,
        message: "Password updated successfully",
      };
    } catch (dbError) {
      // Update local only if database fails
      ADMIN_CREDENTIALS.passwordHash = newHash;

      return {
        success: true,
        message: "Password updated locally. Database update failed.",
        requiresManualUpdate: true,
      };
    }
  } catch (error) {
    console.error("Password change error:", error);
    return { success: false, message: "Error changing password" };
  }
}

/* ================== DATA EXPORT/IMPORT ================== */
async function exportData() {
  try {
    showNotification("Preparing export...", "info");

    const [featured, menu, gallery] = await Promise.all([
      loadDataFromSupabase(API_ENDPOINTS.FEATURED),
      loadDataFromSupabase(API_ENDPOINTS.MENU),
      loadDataFromSupabase(API_ENDPOINTS.GALLERY),
    ]);

    const data = {
      featured,
      menu,
      gallery,
      exportDate: new Date().toISOString(),
      version: "2.0.0",
      source: "Toke Bakes CMS",
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `toke-bakes-backup-${
      new Date().toISOString().split("T")[0]
    }.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification("Data exported successfully!", "success");
  } catch (error) {
    console.error("Error exporting data:", error);
    showNotification("Failed to export data", "error");
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.featured || !data.menu || !data.gallery) {
      showNotification("Invalid backup file format", "error");
      return;
    }

    const confirmed = await showPopup({
      title: "Import Data",
      message:
        "WARNING: This will replace ALL current data. This action cannot be undone.\n\nAre you sure you want to continue?",
      type: "warning",
      showCancel: true,
      cancelText: "Cancel",
      confirmText: "Import",
    });

    if (!confirmed) return;

    showNotification("Starting import...", "info");

    // Clear existing data
    await Promise.all([
      secureRequest(`${API_ENDPOINTS.FEATURED}?id=gt.0`, "DELETE"),
      secureRequest(`${API_ENDPOINTS.MENU}?id=gt.0`, "DELETE"),
      secureRequest(`${API_ENDPOINTS.GALLERY}?id=gt.0`, "DELETE"),
    ]);

    // Import new data
    let imported = 0;

    const importBatch = async (items, endpoint) => {
      for (const item of items) {
        await secureRequest(endpoint, "POST", item);
        imported++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    await importBatch(data.featured, API_ENDPOINTS.FEATURED);
    await importBatch(data.menu, API_ENDPOINTS.MENU);
    await importBatch(data.gallery, API_ENDPOINTS.GALLERY);

    showNotification(`Successfully imported ${imported} items!`, "success");

    await Promise.all([
      renderFeaturedItems(),
      renderMenuItems(),
      renderGalleryItems(),
    ]);
    await updateItemCounts();
    dataSync.notifyDataChanged("import", "all");
  } catch (error) {
    console.error("Error importing data:", error);
    showNotification("Failed to import data", "error");
  }
}

/* ================== EVENT LISTENERS ================== */
function setupEventListeners() {
  console.log("Setting up event listeners...");

  // Tab switching
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      const tabId = this.dataset.tab;

      // Update active tab
      document
        .querySelectorAll(".admin-tab")
        .forEach((t) => t.classList.remove("active"));
      this.classList.add("active");

      // Show corresponding content
      document
        .querySelectorAll(".tab-pane")
        .forEach((pane) => pane.classList.remove("active"));
      const targetTab = document.getElementById(`${tabId}-tab`);
      if (targetTab) {
        targetTab.classList.add("active");

        // Load themes when themes tab is opened
        if (tabId === "themes") {
          loadCurrentTheme();
        }

        // Refresh counts when settings tab is opened
        if (tabId === "settings") {
          updateItemCounts();
        }
      }

      // Reset any open forms
      resetAllForms();
    });
  });

  // Login form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const username = sanitizeInput(
        document.getElementById("admin-username").value
      );
      const password = document.getElementById("admin-password").value;

      const isValid = await checkLogin(username, password);
      if (isValid) {
        currentAdmin = username;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("admin-dashboard").style.display = "block";
        showNotification(`Welcome back, ${username}!`, "success");

        await Promise.all([
          renderFeaturedItems(),
          renderMenuItems(),
          renderGalleryItems(),
        ]);
        await updateItemCounts();
      } else {
        showNotification("Invalid username or password", "error");
      }
    });
  }

  // Logout
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (e) {
      e.preventDefault();
      logoutAdmin();
    });
  }

  // Form submissions
  const featuredForm = document.getElementById("featured-form");
  const menuForm = document.getElementById("menu-form");
  const galleryForm = document.getElementById("gallery-form");

  if (featuredForm) featuredForm.addEventListener("submit", saveFeaturedItem);
  if (menuForm) menuForm.addEventListener("submit", saveMenuItem);
  if (galleryForm) galleryForm.addEventListener("submit", saveGalleryItem);

  // Change password form
  const passwordForm = document.getElementById("change-password-form");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const currentPass = document.getElementById("current-password").value;
      const newPass = document.getElementById("new-password").value;
      const confirmPass = document.getElementById("confirm-password").value;

      const result = await changePassword(currentPass, newPass, confirmPass);
      if (result.success) {
        showNotification(result.message, "success");
        passwordForm.reset();
      } else {
        showNotification(result.message, "error");
      }
    });
  }

  // Add buttons
  const addFeaturedBtn = document.getElementById("add-featured-btn");
  const addMenuBtn = document.getElementById("add-menu-btn");
  const addGalleryBtn = document.getElementById("add-gallery-btn");

  if (addFeaturedBtn) {
    addFeaturedBtn.addEventListener("click", () => {
      resetFeaturedForm();
      document.getElementById("featured-form-container").style.display =
        "block";
      document
        .getElementById("featured-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });
  }

  if (addMenuBtn) {
    addMenuBtn.addEventListener("click", () => {
      resetMenuForm();
      document.getElementById("menu-form-container").style.display = "block";
      document
        .getElementById("menu-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });
  }

  if (addGalleryBtn) {
    addGalleryBtn.addEventListener("click", () => {
      resetGalleryForm();
      document.getElementById("gallery-form-container").style.display = "block";
      document
        .getElementById("gallery-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });
  }

  // Cancel buttons
  const cancelFeatured = document.getElementById("cancel-featured");
  const cancelMenu = document.getElementById("cancel-menu");
  const cancelGallery = document.getElementById("cancel-gallery");

  if (cancelFeatured)
    cancelFeatured.addEventListener("click", resetFeaturedForm);
  if (cancelMenu) cancelMenu.addEventListener("click", resetMenuForm);
  if (cancelGallery) cancelGallery.addEventListener("click", resetGalleryForm);

  // Data management buttons
  const exportDataBtn = document.getElementById("export-data");
  const importDataBtn = document.getElementById("import-data");
  const resetDataBtn = document.getElementById("reset-data");
  const importFileInput = document.getElementById("import-file");

  if (exportDataBtn) exportDataBtn.addEventListener("click", exportData);

  if (importDataBtn) {
    importDataBtn.addEventListener("click", () => {
      if (importFileInput) importFileInput.click();
    });
  }

  if (importFileInput) {
    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importData(file);
      e.target.value = "";
    });
  }

  if (resetDataBtn) {
    resetDataBtn.addEventListener("click", async () => {
      const confirmed = await showPopup({
        title: "Danger: Delete All Data",
        message:
          'This will PERMANENTLY delete ALL data. This action cannot be undone!\n\nTo confirm, please type "DELETE ALL" in the box below:',
        type: "error",
        showCancel: true,
        cancelText: "Cancel",
        confirmText: "Continue",
      });

      if (!confirmed) return;

      const confirmation = await showPopup({
        title: "Type Confirmation",
        message: 'Please type "DELETE ALL" to confirm deletion:',
        type: "warning",
        showCancel: true,
        cancelText: "Cancel",
        confirmText: "Delete All",
      });

      if (confirmation !== "DELETE ALL") {
        showNotification("Deletion cancelled", "info");
        return;
      }

      try {
        showNotification("Resetting data...", "info");

        await Promise.all([
          secureRequest(`${API_ENDPOINTS.FEATURED}?id=gt.0`, "DELETE"),
          secureRequest(`${API_ENDPOINTS.MENU}?id=gt.0`, "DELETE"),
          secureRequest(`${API_ENDPOINTS.GALLERY}?id=gt.0`, "DELETE"),
        ]);

        showNotification("All data has been reset!", "success");

        await Promise.all([
          renderFeaturedItems(),
          renderMenuItems(),
          renderGalleryItems(),
        ]);
        await updateItemCounts();
        dataSync.notifyDataChanged("reset", "all");
      } catch (error) {
        console.error("Error resetting data:", error);
        showNotification("Failed to reset data", "error");
      }
    });
  }

  // Theme activation buttons (event delegation)
  document.addEventListener("click", (e) => {
    const themeBtn = e.target.closest(".btn-activate-theme");
    if (themeBtn) {
      e.preventDefault();
      e.stopPropagation();

      const themeCard = themeBtn.closest(".theme-card");
      const themeFile = themeCard?.dataset.themeFile;
      const isActive = themeCard?.classList.contains("active");

      if (themeFile && !isActive) {
        activateTheme(themeFile);
      }
    }
  });

  // Dark/light theme toggle (user preference)
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const newTheme = current === "dark" ? "light" : "dark";

      document.documentElement.setAttribute("data-theme", newTheme);

      // Update icons
      const sunIcon = themeToggle.querySelector(".sun");
      const moonIcon = themeToggle.querySelector(".moon");

      if (newTheme === "dark") {
        if (sunIcon) sunIcon.style.display = "none";
        if (moonIcon) moonIcon.style.display = "inline-block";
        themeToggle.classList.add("dark");
      } else {
        if (sunIcon) sunIcon.style.display = "inline-block";
        if (moonIcon) moonIcon.style.display = "none";
        themeToggle.classList.remove("dark");
      }

      localStorage.setItem("toke_bakes_theme", newTheme);
      updateFooterTheme(newTheme);
    });
  }
}

/* ================== INITIALIZATION ================== */
async function initAdminPanel() {
  console.log("🔧 Initializing Admin Panel v2.0");

  // Apply dark/light theme immediately
  const savedTheme = localStorage.getItem("toke_bakes_theme");
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
      const sunIcon = themeToggle.querySelector(".sun");
      const moonIcon = themeToggle.querySelector(".moon");

      if (savedTheme === "dark") {
        if (sunIcon) sunIcon.style.display = "none";
        if (moonIcon) moonIcon.style.display = "inline-block";
        themeToggle.classList.add("dark");
      } else {
        if (sunIcon) sunIcon.style.display = "inline-block";
        if (moonIcon) moonIcon.style.display = "none";
        themeToggle.classList.remove("dark");
      }
    }
  }

  // Check session
  if (checkSession()) {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("admin-dashboard").style.display = "block";
    console.log("✅ Restored existing session");
  }

  // Check Supabase configuration
  if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
    const warning = document.createElement("div");
    warning.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #ff6b6b;
      color: white;
      padding: 10px;
      text-align: center;
      z-index: 10000;
      font-weight: bold;
    `;
    warning.textContent =
      "WARNING: Supabase not configured. Please check config.js";
    document.body.appendChild(warning);
    return;
  }

  // Set current year
  const yearElement = document.getElementById("admin-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Load initial data if logged in
  if (currentAdmin) {
    try {
      await Promise.all([
        renderFeaturedItems(),
        renderMenuItems(),
        renderGalleryItems(),
      ]);
      await updateItemCounts();
    } catch (error) {
      console.error("Error loading initial data:", error);
    }
  }

  // Setup event listeners
  setupEventListeners();

  console.log("✅ Admin Panel initialized");
}

// Make functions available globally
window.editFeaturedItem = editFeaturedItem;
window.deleteFeaturedItem = deleteFeaturedItem;
window.editMenuItem = editMenuItem;
window.deleteMenuItem = deleteMenuItem;
window.editGalleryItem = editGalleryItem;
window.deleteGalleryItem = deleteGalleryItem;

// Initialize when DOM is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminPanel);
} else {
  initAdminPanel();
}

console.log("✅ Toke Bakes Admin Panel v2.0 - NO DUPLICATE DECLARATIONS");
