/* ================== admin.js ================== */
/* Toke Bakes Admin Panel - COMPLETE FIXED VERSION WITH PASSWORD SYNC */

// Current admin state with improved security
let currentAdmin = null;
let isEditing = false;
let currentEditId = null;
let sessionTimeout = null;
const SESSION_TIMEOUT_MINUTES = 30;

// Store for temporary image data with memory management
let tempImageCache = new Map(); // Using Map for better memory management
let cacheCleanupInterval = null;

/* ================== ENHANCED SECURITY FUNCTIONS ================== */

// Generate secure session token
function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

// Secure storage for session data
const secureStorage = {
  setItem: (key, value) => {
    try {
      sessionStorage.setItem(`secure_${key}`, btoa(JSON.stringify(value)));
    } catch (e) {
      console.warn("Secure storage failed:", e);
    }
  },
  getItem: (key) => {
    try {
      const item = sessionStorage.getItem(`secure_${key}`);
      return item ? JSON.parse(atob(item)) : null;
    } catch (e) {
      console.warn("Secure storage retrieval failed:", e);
      return null;
    }
  },
  removeItem: (key) => {
    try {
      sessionStorage.removeItem(`secure_${key}`);
    } catch (e) {
      console.warn("Secure storage removal failed:", e);
    }
  },
};

// Input sanitization
function sanitizeInput(input) {
  if (typeof input !== "string") return input;
  return input
    .replace(/[<>]/g, "") // Remove < and >
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim();
}

/* ================== ENHANCED SECURITY FUNCTIONS ================== */

// Enhanced password hashing with PBKDF2
async function hashPassword(password, salt = "toke_bakes_salt_v2") {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const key = await crypto.subtle.importKey(
      "raw",
      data,
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derivedKey = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      key,
      256
    );
    return Array.from(new Uint8Array(derivedKey))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    console.error("Password hashing failed:", error);
    // Fallback to SHA-256 if PBKDF2 fails
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

/* ================== PASSWORD SYNC FUNCTIONS ================== */

// 1. VERIFY PASSWORD AGAINST DATABASE
async function verifyPasswordAgainstDatabase(username, password) {
  try {
    // Hash the password first
    const hashedPassword = await hashPassword(password);

    // Get stored hash from database
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.${username}&select=password_hash`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error("Database fetch error:", response.status);
      return false;
    }

    const data = await response.json();

    if (data.length === 0) {
      console.error("User not found in database");
      return false;
    }

    // Compare hashes
    const databaseHash = data[0].password_hash;
    const isMatch = hashedPassword === databaseHash;

    if (isMatch) {
      console.log("✅ Password verified against database");
      // Update local hash to match database
      ADMIN_CREDENTIALS.passwordHash = databaseHash;
    }

    return isMatch;
  } catch (error) {
    console.error("Password verification error:", error);
    return false;
  }
}

// 2. UPDATE PASSWORD IN DATABASE (FULL FUNCTION)
async function updatePasswordInDatabase(username, newHash) {
  try {
    console.log("Updating password in database for user:", username);

    // Use direct PATCH request to update the password
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.${username}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          password_hash: newHash,
          last_login: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Password update failed:", errorText);

      return {
        success: false,
        message: `Database update failed: ${response.status}`,
      };
    }

    const result = await response.json();

    if (result && result.length > 0) {
      console.log("✅ Password updated in database successfully");
      return {
        success: true,
        message: "Password updated in database",
        data: result[0],
      };
    } else {
      return {
        success: false,
        message: "No rows were updated",
      };
    }
  } catch (error) {
    console.error("Update password error:", error);
    return {
      success: false,
      message: `Network error: ${error.message}`,
    };
  }
}

// 3. SIMPLER FIX: Update password using direct SQL UPDATE
async function updatePasswordInDatabaseSimple(username, newPasswordHash) {
  try {
    const session = secureStorage.getItem("session");
    if (!session || !session.token) {
      return {
        success: false,
        message: "Session expired. Please login again.",
      };
    }

    // Use direct SQL UPDATE instead of RPC function
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.${username}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          Prefer: "return=representation",
          "X-Session-Token": session.token,
        },
        body: JSON.stringify({
          password_hash: newPasswordHash,
          last_login: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Password update failed:", errorText);

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: "Permission denied. Check RLS policies.",
        };
      }

      return {
        success: false,
        message: `Update failed: ${response.status}`,
      };
    }

    const result = await response.json();

    // Check if any rows were updated
    if (Array.isArray(result) && result.length > 0) {
      console.log(`✅ Password updated for: ${username}`);
      return {
        success: true,
        message: "Password updated successfully",
      };
    }

    return {
      success: false,
      message: "No rows were updated",
    };
  } catch (error) {
    console.error("Password update error:", error);
    return {
      success: false,
      message: "Network error. Cannot connect to database.",
    };
  }
}

// 4. LOAD PASSWORD FROM DATABASE ON STARTUP
async function loadPasswordFromDatabase() {
  try {
    console.log("Loading admin password from database...");

    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.admin&select=password_hash`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0 && data[0].password_hash) {
        const dbHash = data[0].password_hash;
        ADMIN_CREDENTIALS.passwordHash = dbHash;
        console.log(
          "✅ Loaded password hash from database:",
          dbHash.substring(0, 20) + "..."
        );
        return true;
      }
    }
    console.log("⚠️ Using local password hash");
    return false;
  } catch (error) {
    console.error("Failed to load password from database:", error);
    return false;
  }
}

// 5. CHECK DATABASE PASSWORD SYNC
async function checkPasswordSync() {
  try {
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.admin&select=password_hash`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        const dbHash = data[0].password_hash;
        const localHash = ADMIN_CREDENTIALS.passwordHash;

        const isSynced = dbHash === localHash;

        if (!isSynced) {
          console.warn("⚠️ Password NOT synced!");
          console.log("Database hash:", dbHash.substring(0, 20) + "...");
          console.log("Local hash:", localHash.substring(0, 20) + "...");

          // Ask user to sync
          const shouldSync = confirm(
            "Your local password doesn't match the database.\n" +
              "Do you want to sync by using the database password?"
          );

          if (shouldSync) {
            ADMIN_CREDENTIALS.passwordHash = dbHash;
            showNotification("✅ Password synced with database", "success");
          }
        } else {
          console.log("✅ Passwords are synced");
        }

        return isSynced;
      }
    }
    return false;
  } catch (error) {
    console.error("Password sync check error:", error);
    return false;
  }
}

// 6. CREATE ADMIN USER IN DATABASE (if doesn't exist)
async function createAdminUserInDatabase() {
  try {
    const response = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/admin_users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_CONFIG.ANON_KEY,
        Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        username: "admin",
        password_hash: ADMIN_CREDENTIALS.passwordHash,
        is_active: true,
      }),
    });

    if (response.ok) {
      console.log("✅ Admin user created in database");
      return true;
    } else {
      const errorText = await response.text();
      console.error("Failed to create admin user:", errorText);
      return false;
    }
  } catch (error) {
    console.error("Create admin user error:", error);
    return false;
  }
}

// 7. INITIALIZE ADMIN CREDENTIALS FROM DATABASE
async function initializeAdminCredentials() {
  try {
    // Try to load from database first
    const loaded = await loadPasswordFromDatabase();

    if (!loaded) {
      // If database loading fails, check if database has admin user
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.admin`,
        {
          method: "GET",
          headers: {
            apikey: SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.length === 0) {
          // No admin user in database, create one with current hash
          console.log("Creating admin user in database...");
          await createAdminUserInDatabase();
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Failed to initialize admin credentials:", error);
    return false;
  }
}

/* ================== ENHANCED UTILITY FUNCTIONS ================== */

// Image compression with better error handling and WebP support
async function compressImage(file, maxSizeKB = 300) {
  return new Promise((resolve, reject) => {
    // Validate file type
    if (!file.type.startsWith("image/")) {
      reject(new Error("File is not an image"));
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Image must be less than 5MB"));
      return;
    }

    const reader = new FileReader();

    reader.onload = function (event) {
      const img = new Image();
      img.onload = function () {
        try {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions while maintaining aspect ratio
          const maxDimension = 800; // 800px for bakery image quality
          if (width > height && width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");

          // Improve image quality for bakery items
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, width, height);

          // Try WebP first (better compression for photos)
          let quality = 0.75;
          let format = "image/webp";
          let base64 = canvas.toDataURL(format, quality);

          // Check size and reduce quality if needed
          while (base64.length > maxSizeKB * 1024 * 0.75 && quality > 0.4) {
            quality -= 0.05;
            base64 = canvas.toDataURL(format, quality);
          }

          // If still too large or WebP not supported, fallback to JPEG
          if (base64.length > maxSizeKB * 1024 * 0.75) {
            quality = 0.7;
            format = "image/jpeg";
            base64 = canvas.toDataURL(format, quality);

            while (base64.length > maxSizeKB * 1024 * 0.75 && quality > 0.3) {
              quality -= 0.1;
              base64 = canvas.toDataURL(format, quality);
            }
          }

          const result = {
            data: base64,
            format: format.includes("webp") ? "webp" : "jpeg",
            size: base64.length,
            dimensions: { width, height },
            originalSize: file.size,
          };

          // Show compression info to user
          const originalKB = (file.size / 1024).toFixed(1);
          const compressedKB = (base64.length / 1024).toFixed(1);
          const savings = ((1 - base64.length / file.size) * 100).toFixed(1);

          showNotification(
            `Image compressed: ${originalKB}KB → ${compressedKB}KB (${savings}% saved, ${format
              .split("/")[1]
              .toUpperCase()})`,
            "info"
          );

          resolve(result);
        } catch (error) {
          reject(new Error(`Image processing failed: ${error.message}`));
        }
      };

      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = event.target.result;
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Enhanced notification system with queue
const notificationQueue = [];
let isShowingNotification = false;

function showNotification(message, type = "success") {
  const notification = {
    id: Date.now(),
    message,
    type,
    timestamp: new Date(),
  };

  notificationQueue.push(notification);

  if (!isShowingNotification) {
    processNextNotification();
  }
}

function processNextNotification() {
  if (notificationQueue.length === 0) {
    isShowingNotification = false;
    return;
  }

  isShowingNotification = true;
  const notification = notificationQueue.shift();

  // Remove existing notification
  const existing = document.getElementById("admin-notification");
  if (existing) existing.remove();

  const notificationEl = document.createElement("div");
  notificationEl.id = "admin-notification";
  notificationEl.className = `admin-notification admin-notification-${notification.type}`;
  notificationEl.textContent = notification.message;
  notificationEl.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${
      notification.type === "success"
        ? "#4caf50"
        : notification.type === "info"
        ? "#2196f3"
        : notification.type === "warning"
        ? "#ff9800"
        : "#e64a4a"
    };
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 9999;
    animation: slideInRight 0.3s ease-out;
    max-width: 300px;
    cursor: pointer;
  `;

  notificationEl.addEventListener("click", () => {
    notificationEl.style.animation = "slideOutRight 0.3s ease-out forwards";
    setTimeout(() => {
      notificationEl.remove();
      processNextNotification();
    }, 300);
  });

  document.body.appendChild(notificationEl);

  setTimeout(() => {
    if (document.body.contains(notificationEl)) {
      notificationEl.style.animation = "slideOutRight 0.3s ease-out forwards";
      setTimeout(() => {
        notificationEl.remove();
        processNextNotification();
      }, 300);
    }
  }, 3000);
}

/* ================== FIXED SECURE API FUNCTIONS ================== */

// FIXED: Enhanced API request with proper Supabase headers
async function secureRequest(
  endpoint,
  method = "GET",
  data = null,
  options = {}
) {
  const { retries = 3, timeout = 10000 } = options;

  // Check if Supabase is configured
  if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
    throw new Error("Supabase configuration missing. Check config.js");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // FIXED: Proper Supabase headers (these are REQUIRED)
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_CONFIG.ANON_KEY, // REQUIRED: Supabase needs this
    Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`, // REQUIRED: Supabase needs this
    Prefer: "return=representation", // Get data back after insert/update
  };

  // Remove custom headers that Supabase doesn't need
  delete headers["X-Requested-With"];
  delete headers["x-admin-secret"];

  // Add session token if available (for our custom auth)
  const session = secureStorage.getItem("session");
  if (session && session.token) {
    headers["X-Session-Token"] = session.token;
  }

  const config = {
    method: method,
    headers: headers,
    signal: controller.signal,
  };

  if (data && (method === "POST" || method === "PATCH" || method === "PUT")) {
    config.body = JSON.stringify(data);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `API request ${method} ${endpoint} (attempt ${attempt}/${retries})`
      );

      const response = await fetch(`${SUPABASE_CONFIG.URL}${endpoint}`, config);
      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") || 1;
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.text();

        // Handle specific error cases
        if (response.status === 401) {
          showNotification(
            "Authentication failed. Please login again.",
            "error"
          );
          logoutAdmin();
          throw new Error("Authentication failed");
        }

        if (response.status === 403) {
          showNotification(
            "Permission denied. Please contact administrator.",
            "error"
          );
          throw new Error("Permission denied");
        }

        if (response.status === 413) {
          showNotification(
            "Image file is too large. Please use a smaller image.",
            "error"
          );
          throw new Error("File too large");
        }

        throw new Error(
          `HTTP ${response.status}: ${errorData.substring(0, 200)}`
        );
      }

      // For DELETE requests that return 204 No Content
      if (method === "DELETE" && response.status === 204) {
        return { success: true, message: "Item deleted successfully" };
      }

      // For successful requests with content
      if (response.status !== 204) {
        const result = await response.json();

        // Cache image data for faster editing (with size limit)
        if (Array.isArray(result)) {
          result.forEach((item) => {
            if (item.image && item.id && tempImageCache.size < 50) {
              tempImageCache.set(item.id, item.image);
            }
          });
        } else if (result.image && result.id && tempImageCache.size < 50) {
          tempImageCache.set(result.id, result.image);
        }

        return result;
      }

      return { success: true };
    } catch (error) {
      clearTimeout(timeoutId);

      if (attempt === retries) {
        console.error("API request failed after retries:", error);

        // User-friendly error messages
        if (error.name === "AbortError") {
          showNotification("Request timeout. Please try again.", "error");
        } else if (error.message.includes("Failed to fetch")) {
          showNotification(
            "Network error. Please check your connection.",
            "error"
          );
        } else if (error.message.includes("CORS")) {
          showNotification(
            "Cross-origin request blocked. Please check configuration.",
            "error"
          );
        } else {
          showNotification(`Operation failed: ${error.message}`, "error");
        }

        throw error;
      }

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
}

// Load data with caching
const dataCache = new Map();
const CACHE_TTL = 60000; // 1 minute

async function loadDataFromSupabase(endpoint, id = null, forceRefresh = false) {
  const cacheKey = id ? `${endpoint}_${id}` : endpoint;

  // Check cache if not forcing refresh
  if (!forceRefresh && dataCache.has(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  try {
    const url = id
      ? `${endpoint}?id=eq.${id}&select=*`
      : `${endpoint}?select=*&order=created_at.desc`;

    const result = await secureRequest(url, "GET");

    // FIXED: Handle Supabase response format
    let data;
    if (id) {
      // For single item queries, result is an array
      data = Array.isArray(result) && result.length > 0 ? result[0] : null;
    } else {
      // For list queries, result is the array
      data = result || [];
    }

    // Cache the result
    dataCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  } catch (error) {
    console.error(`Error loading from ${endpoint}:`, error);

    // Return cached data if available (even if stale)
    if (dataCache.has(cacheKey)) {
      showNotification(
        "Using cached data. Some information may be outdated.",
        "warning"
      );
      return dataCache.get(cacheKey).data;
    }

    showNotification("Failed to load data from cloud", "error");
    return id ? null : [];
  }
}

// Clear cache function
function clearDataCache() {
  dataCache.clear();
  tempImageCache.clear();
}

/* ================== ENHANCED AUTHENTICATION ================== */

// Store hashed password - This will be synced with database
const ADMIN_CREDENTIALS = {
  username: "admin",
  passwordHash:
    "62b616a835024308e7aa515ad2acf3589b29f45f94229316fe00f40f9c3c064a",
};

// Enhanced login with rate limiting
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

async function checkLogin(username, password) {
  try {
    // Rate limiting check
    const ipKey = "login_attempts";
    const attempts = loginAttempts.get(ipKey) || {
      count: 0,
      timestamp: Date.now(),
    };

    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      const timeSinceFirstAttempt = Date.now() - attempts.timestamp;
      if (timeSinceFirstAttempt < LOCKOUT_TIME) {
        const remainingMinutes = Math.ceil(
          (LOCKOUT_TIME - timeSinceFirstAttempt) / 60000
        );
        showNotification(
          `Too many login attempts. Try again in ${remainingMinutes} minutes.`,
          "error"
        );
        return false;
      } else {
        // Reset after lockout period
        loginAttempts.delete(ipKey);
      }
    }

    // Validate username
    if (username !== ADMIN_CREDENTIALS.username) {
      attempts.count++;
      attempts.timestamp =
        attempts.count === 1 ? Date.now() : attempts.timestamp;
      loginAttempts.set(ipKey, attempts);
      return false;
    }

    // Hash password and compare
    const hashedPassword = await hashPassword(password);
    const isValid = hashedPassword === ADMIN_CREDENTIALS.passwordHash;

    if (isValid) {
      // Clear login attempts on success
      loginAttempts.delete(ipKey);

      // Create secure session
      const session = {
        token: generateSessionToken(),
        username: username,
        loginTime: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + SESSION_TIMEOUT_MINUTES * 60 * 1000
        ).toISOString(),
      };

      secureStorage.setItem("session", session);
      startSessionTimeout();
      setupActivityMonitoring();

      return true;
    } else {
      // Increment failed attempts
      attempts.count++;
      attempts.timestamp =
        attempts.count === 1 ? Date.now() : attempts.timestamp;
      loginAttempts.set(ipKey, attempts);
      return false;
    }
  } catch (error) {
    console.error("Login error:", error);
    return false;
  }
}

// Session timeout functions
function startSessionTimeout() {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
  }

  sessionTimeout = setTimeout(() => {
    showNotification("Session expired. Please log in again.", "warning");
    logoutAdmin();
  }, SESSION_TIMEOUT_MINUTES * 60 * 1000);
}

function clearSessionTimeout() {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
    sessionTimeout = null;
  }
}

function setupActivityMonitoring() {
  const resetSessionTimer = () => {
    if (sessionTimeout) {
      clearTimeout(sessionTimeout);
      startSessionTimeout();
    }
  };

  ["click", "keypress", "mousemove", "scroll"].forEach((event) => {
    document.addEventListener(event, resetSessionTimer, { passive: true });
  });
}

// Enhanced logout
function logoutAdmin() {
  // Clear all sensitive data
  currentAdmin = null;
  isEditing = false;
  currentEditId = null;
  clearSessionTimeout();
  clearDataCache();
  secureStorage.removeItem("session");

  // Clear all timeouts and intervals
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval);
    cacheCleanupInterval = null;
  }

  // Reset UI
  document.getElementById("login-screen").style.display = "block";
  document.getElementById("admin-dashboard").style.display = "none";

  // Clear forms
  resetFeaturedForm();
  resetMenuForm();
  resetGalleryForm();

  showNotification("Logged out successfully");
}

// FIXED: Password change with enhanced validation and database sync
async function changePassword(currentPass, newPass, confirmPass) {
  try {
    // Step 1: Validate current password
    showNotification("Verifying current password...", "info");

    // First check locally
    const hashedCurrent = await hashPassword(currentPass);
    const localIsValid = hashedCurrent === ADMIN_CREDENTIALS.passwordHash;

    // Then verify against database
    const dbIsValid = await verifyPasswordAgainstDatabase(
      ADMIN_CREDENTIALS.username,
      currentPass
    );

    if (!localIsValid && !dbIsValid) {
      return { success: false, message: "Current password is incorrect" };
    }

    // If local and database don't match, sync them
    if (localIsValid !== dbIsValid) {
      console.warn("Local and database passwords don't match, syncing...");
      await checkPasswordSync();
    }

    // Step 2: Validate new password
    if (newPass !== confirmPass) {
      return { success: false, message: "New passwords do not match" };
    }

    if (newPass.length < 8) {
      return {
        success: false,
        message: "Password must be at least 8 characters",
      };
    }

    // Check for common passwords
    const commonPasswords = [
      "password",
      "12345678",
      "qwerty",
      "admin123",
      "tokebakes",
      "toke123",
      "password123",
      "adminadmin",
    ];
    if (commonPasswords.includes(newPass.toLowerCase())) {
      return {
        success: false,
        message: "Password is too common. Please choose a stronger password.",
      };
    }

    // Check for password complexity
    const hasUpperCase = /[A-Z]/.test(newPass);
    const hasLowerCase = /[a-z]/.test(newPass);
    const hasNumbers = /\d/.test(newPass);
    const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(newPass);

    if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
      return {
        success: false,
        message:
          "Password must include uppercase, lowercase letters, and numbers",
      };
    }

    // Step 3: Generate new hash
    showNotification("Generating secure hash...", "info");
    const newHash = await hashPassword(newPass);

    // Step 4: Update database FIRST (before local)
    showNotification("Updating password in database...", "info");
    const dbResult = await updatePasswordInDatabase(
      ADMIN_CREDENTIALS.username,
      newHash
    );

    if (!dbResult.success) {
      // Try the simple method as fallback
      console.log("Trying alternative update method...");
      const simpleResult = await updatePasswordInDatabaseSimple(
        ADMIN_CREDENTIALS.username,
        newHash
      );

      if (!simpleResult.success) {
        console.error("All update methods failed");

        // Ask user if they want to continue with local update only
        const continueLocal = confirm(
          `Failed to update database: ${dbResult.message}\n\n` +
            "Do you want to update the password locally only?\n" +
            "You will need to manually update the database later."
        );

        if (!continueLocal) {
          return { success: false, message: "Password change cancelled" };
        }

        // Update local only
        ADMIN_CREDENTIALS.passwordHash = newHash;

        // Show manual update instructions
        console.log("📋 MANUAL DATABASE UPDATE REQUIRED:");
        console.log("Run this in Supabase SQL Editor:");
        console.log("----------------------------------------");
        console.log(
          `UPDATE admin_users SET password_hash = '${newHash}' WHERE username = 'admin';`
        );
        console.log("----------------------------------------");

        showNotification(
          "✅ Password updated locally only. Manual database update required.",
          "warning"
        );

        return {
          success: true,
          message:
            "Password updated locally only. Manual database update required.",
          requiresManualUpdate: true,
        };
      }
    }

    // Step 5: Update local credentials AFTER successful database update
    ADMIN_CREDENTIALS.passwordHash = newHash;

    // Step 6: Update session
    const session = secureStorage.getItem("session");
    if (session) {
      session.passwordUpdated = new Date().toISOString();
      secureStorage.setItem("session", session);
    }

    // Step 7: Verify sync
    await checkPasswordSync();

    // Step 8: Log success
    console.log(
      `🔒 Password changed successfully at ${new Date().toISOString()}`
    );

    showNotification(
      "✅ Password updated successfully! Changes are saved to database.",
      "success"
    );

    return {
      success: true,
      message: "Password updated successfully in both local and database",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Password change error:", error);

    let userMessage = "Error changing password";
    if (error.message.includes("Failed to fetch")) {
      userMessage = "Network error. Cannot connect to database.";
    } else if (error.message.includes("crypto.subtle")) {
      userMessage = "Browser security error. Try using a modern browser.";
    }

    showNotification(userMessage, "error");
    return { success: false, message: userMessage };
  }
}

/* ================== ENHANCED CONTENT MANAGEMENT ================== */

// Common save function with validation
async function saveItem(itemType, formData) {
  try {
    const endpoints = {
      featured: API_ENDPOINTS.FEATURED,
      menu: API_ENDPOINTS.MENU,
      gallery: API_ENDPOINTS.GALLERY,
    };

    const endpoint = endpoints[itemType];
    if (!endpoint) {
      throw new Error(`Invalid item type: ${itemType}`);
    }

    // Validate required fields
    const requiredFields = {
      featured: ["title", "description", "image"],
      menu: ["title", "description", "price", "image"],
      gallery: ["alt", "image"],
    };

    const missingFields = requiredFields[itemType].filter(
      (field) => !formData[field]
    );
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    // Sanitize text fields
    Object.keys(formData).forEach((key) => {
      if (typeof formData[key] === "string") {
        formData[key] = sanitizeInput(formData[key]);
      }
    });

    // Send to API
    if (isEditing && currentEditId) {
      await secureRequest(
        `${endpoint}?id=eq.${currentEditId}`,
        "PATCH",
        formData
      );
      showNotification(`${itemType} item updated successfully!`);
    } else {
      await secureRequest(endpoint, "POST", formData);
      showNotification(`${itemType} item added successfully!`);
    }

    // Clear cache for this endpoint
    dataCache.forEach((value, key) => {
      if (key.startsWith(endpoint)) {
        dataCache.delete(key);
      }
    });

    return true;
  } catch (error) {
    console.error(`Error saving ${itemType} item:`, error);
    showNotification(
      `Failed to save ${itemType} item: ${error.message}`,
      "error"
    );
    return false;
  }
}

// Enhanced render functions with pagination support
let currentPage = {
  featured: 1,
  menu: 1,
  gallery: 1,
};
const ITEMS_PER_PAGE = 12;

async function renderPaginatedItems(containerId, endpoint, renderFunction) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const items = await loadDataFromSupabase(endpoint);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-${
            endpoint.includes("featured")
              ? "star"
              : endpoint.includes("menu")
              ? "utensils"
              : "images"
          }"></i>
          <p>No items yet. Add your first one!</p>
        </div>
      `;
      return;
    }

    // Add pagination controls if needed
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const currentPageKey = endpoint.split("/").pop();
    const page = currentPage[currentPageKey] || 1;
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const paginatedItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    // Render items
    container.innerHTML = renderFunction(paginatedItems);

    // Add pagination if multiple pages
    if (totalPages > 1) {
      const paginationHTML = `
        <div class="pagination">
          <button class="pagination-btn ${page === 1 ? "disabled" : ""}"
                  onclick="changePage('${currentPageKey}', ${page - 1})"
                  ${page === 1 ? "disabled" : ""}>
            <i class="fas fa-chevron-left"></i> Previous
          </button>
          <span class="page-info">Page ${page} of ${totalPages}</span>
          <button class="pagination-btn ${
            page === totalPages ? "disabled" : ""
          }"
                  onclick="changePage('${currentPageKey}', ${page + 1})"
                  ${page === totalPages ? "disabled" : ""}>
            Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      `;
      container.insertAdjacentHTML("beforeend", paginationHTML);
    }
  } catch (error) {
    console.error(`Error rendering items for ${containerId}:`, error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load items. Please check your connection.</p>
      </div>
    `;
  }
}

// Page change function
window.changePage = function (type, page) {
  currentPage[type] = page;
  switch (type) {
    case "featured":
      renderFeaturedItems();
      break;
    case "menu":
      renderMenuItems();
      break;
    case "gallery":
      renderGalleryItems();
      break;
  }
};

/* ================== SPECIFIC CONTENT MANAGEMENT FUNCTIONS ================== */

// Featured Items Management
async function renderFeaturedItems() {
  await renderPaginatedItems(
    "featured-items-list",
    API_ENDPOINTS.FEATURED,
    (items) => {
      return items
        .map(
          (item) => `
      <div class="item-card" data-id="${item.id}">
        <img src="${item.image}" alt="${item.title}" class="item-card-img" loading="lazy">
        <div class="item-card-content">
          <h3 class="item-card-title">${item.title}</h3>
          <p class="item-card-desc">${item.description}</p>
          <div class="item-card-actions">
            <button class="btn-edit" onclick="editFeaturedItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteFeaturedItem('${item.id}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `
        )
        .join("");
    }
  );
}

async function saveFeaturedItem(e) {
  e.preventDefault();

  const title = document.getElementById("featured-title").value.trim();
  const description = document
    .getElementById("featured-description")
    .value.trim();
  const imageFile = document.getElementById("featured-image").files[0];
  const itemId = document.getElementById("featured-id").value;

  try {
    let imageBase64 = "";

    if (imageFile) {
      showNotification("Processing image...", "info");
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showNotification("Please select an image", "error");
      return;
    }

    const formData = {
      title,
      description,
      image: imageBase64,
    };

    const success = await saveItem("featured", formData);

    if (success) {
      resetFeaturedForm();
      await renderFeaturedItems();
      await updateItemCounts();
    }
  } catch (error) {
    console.error("Error saving featured item:", error);
    showNotification("Failed to save item", "error");
  }
}

async function deleteFeaturedItem(id) {
  if (
    !confirm(
      "Are you sure you want to delete this featured item?\nThis action cannot be undone."
    )
  ) {
    return;
  }

  try {
    await secureRequest(`${API_ENDPOINTS.FEATURED}?id=eq.${id}`, "DELETE");
    showNotification("Featured item deleted!");

    // Clear from cache
    tempImageCache.delete(id);
    clearDataCache();

    await renderFeaturedItems();
    await updateItemCounts();
  } catch (error) {
    console.error("Error deleting featured item:", error);
    showNotification("Failed to delete item", "error");
  }
}

async function editFeaturedItem(id) {
  try {
    const item = await loadDataFromSupabase(API_ENDPOINTS.FEATURED, id);

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

    document
      .getElementById("featured-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading featured item for edit:", error);
    showNotification("Failed to load item for editing", "error");
  }
}

// Menu Items Management - COMPLETE IMPLEMENTATION
async function renderMenuItems() {
  await renderPaginatedItems("menu-items-list", API_ENDPOINTS.MENU, (items) => {
    return items
      .map(
        (item) => `
      <div class="item-card" data-id="${item.id}">
        <img src="${item.image}" alt="${
          item.title
        }" class="item-card-img" loading="lazy">
        <div class="item-card-content">
          <h3 class="item-card-title">${item.title}</h3>
          <p class="item-card-desc">${item.description}</p>
          <div class="item-card-price">₦${Number(
            item.price
          ).toLocaleString()}</div>
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
  });
}

async function saveMenuItem(e) {
  e.preventDefault();

  const title = document.getElementById("menu-title").value.trim();
  const description = document.getElementById("menu-description").value.trim();
  const price = document.getElementById("menu-price").value;
  const imageFile = document.getElementById("menu-image").files[0];
  const itemId = document.getElementById("menu-id").value;

  // Validation
  if (price < 0) {
    showNotification("Price must be a positive number", "error");
    return;
  }

  try {
    let imageBase64 = "";

    if (imageFile) {
      showNotification("Processing image...", "info");
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showNotification("Please select an image", "error");
      return;
    }

    const formData = {
      title,
      description,
      price: Number(price),
      image: imageBase64,
    };

    const success = await saveItem("menu", formData);

    if (success) {
      resetMenuForm();
      await renderMenuItems();
      await updateItemCounts();
    }
  } catch (error) {
    console.error("Error saving menu item:", error);
    showNotification("Failed to save menu item", "error");
  }
}

async function editMenuItem(id) {
  try {
    const item = await loadDataFromSupabase(API_ENDPOINTS.MENU, id);

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

    document
      .getElementById("menu-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading menu item for edit:", error);
    showNotification("Failed to load menu item for editing", "error");
  }
}

async function deleteMenuItem(id) {
  if (
    !confirm(
      "Are you sure you want to delete this menu item?\nThis action cannot be undone."
    )
  ) {
    return;
  }

  try {
    await secureRequest(`${API_ENDPOINTS.MENU}?id=eq.${id}`, "DELETE");
    showNotification("Menu item deleted!");

    // Clear from cache
    tempImageCache.delete(id);
    clearDataCache();

    await renderMenuItems();
    await updateItemCounts();
  } catch (error) {
    console.error("Error deleting menu item:", error);
    showNotification("Failed to delete menu item", "error");
  }
}

// Gallery Management - COMPLETE IMPLEMENTATION
async function renderGalleryItems() {
  await renderPaginatedItems(
    "gallery-admin-grid",
    API_ENDPOINTS.GALLERY,
    (items) => {
      return items
        .map(
          (item) => `
      <div class="gallery-admin-item" data-id="${item.id}">
        <img src="${item.image}" alt="${item.alt}" loading="lazy">
        <div class="gallery-admin-overlay">
          <p><strong>Alt Text:</strong> ${item.alt}</p>
          <p><small>Added: ${new Date(
            item.created_at
          ).toLocaleDateString()}</small></p>
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
    }
  );
}

async function saveGalleryItem(e) {
  e.preventDefault();

  const alt = document.getElementById("gallery-alt").value.trim();
  const imageFile = document.getElementById("gallery-image").files[0];
  const itemId = document.getElementById("gallery-id").value;

  try {
    let imageBase64 = "";

    if (imageFile) {
      showNotification("Processing image...", "info");
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showNotification("Please select an image", "error");
      return;
    }

    const formData = {
      alt,
      image: imageBase64,
    };

    const success = await saveItem("gallery", formData);

    if (success) {
      resetGalleryForm();
      await renderGalleryItems();
      await updateItemCounts();
    }
  } catch (error) {
    console.error("Error saving gallery item:", error);
    showNotification("Failed to save gallery item", "error");
  }
}

async function editGalleryItem(id) {
  try {
    const item = await loadDataFromSupabase(API_ENDPOINTS.GALLERY, id);

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

    document
      .getElementById("gallery-form-container")
      .scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    console.error("Error loading gallery item for edit:", error);
    showNotification("Failed to load gallery item for editing", "error");
  }
}

async function deleteGalleryItem(id) {
  if (
    !confirm(
      "Are you sure you want to delete this gallery image?\nThis action cannot be undone."
    )
  ) {
    return;
  }

  try {
    await secureRequest(`${API_ENDPOINTS.GALLERY}?id=eq.${id}`, "DELETE");
    showNotification("Gallery image deleted!");

    // Clear from cache
    tempImageCache.delete(id);
    clearDataCache();

    await renderGalleryItems();
    await updateItemCounts();
  } catch (error) {
    console.error("Error deleting gallery item:", error);
    showNotification("Failed to delete gallery item", "error");
  }
}

/* ================== ENHANCED STORAGE MANAGEMENT ================== */

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
        // Base64 size calculation
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

    // Update UI
    document.getElementById("storage-used").textContent = mbUsed;
    document.getElementById("storage-fill").style.width = `${percentage}%`;
    document.getElementById(
      "storage-info"
    ).textContent = `${mbUsed} MB / 500 MB`;

    // Add warnings
    if (mbUsed > 450) {
      showNotification("CRITICAL: Storage usage is at 90%+!", "error");
    } else if (mbUsed > 400) {
      showNotification(
        `Warning: Storage usage is high (${mbUsed}MB).`,
        "warning"
      );
    }

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

    document.getElementById("count-featured").textContent =
      featured.length || 0;
    document.getElementById("count-menu").textContent = menu.length || 0;
    document.getElementById("count-gallery").textContent = gallery.length || 0;

    await updateStorageUsage();
  } catch (error) {
    console.error("Error updating counts:", error);
  }
}

/* ================== ENHANCED DATA BACKUP/RESTORE ================== */

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
      itemCount: {
        featured: featured.length,
        menu: menu.length,
        gallery: gallery.length,
      },
    };

    // Create and download file
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

    showNotification("Data exported successfully!");
  } catch (error) {
    console.error("Error exporting data:", error);
    showNotification("Failed to export data", "error");
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate backup file
    if (!data.featured || !data.menu || !data.gallery) {
      showNotification("Invalid backup file format", "error");
      return;
    }

    if (
      !confirm(
        "WARNING: This will replace ALL current data. This action cannot be undone. Continue?"
      )
    ) {
      return;
    }

    showNotification("Starting import...", "info");

    // Clear existing data with progress indication
    await Promise.all([
      secureRequest(`${API_ENDPOINTS.FEATURED}?id=gt.0`, "DELETE"),
      secureRequest(`${API_ENDPOINTS.MENU}?id=gt.0`, "DELETE"),
      secureRequest(`${API_ENDPOINTS.GALLERY}?id=gt.0`, "DELETE"),
    ]);

    // Import new data
    const totalItems =
      data.featured.length + data.menu.length + data.gallery.length;
    let imported = 0;

    // Show progress
    const progressEl = document.createElement("div");
    progressEl.id = "import-progress";
    progressEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 10000;
    `;
    progressEl.innerHTML = `
      <h3>Importing Data</h3>
      <p>Processing ${totalItems} items...</p>
      <div class="progress-bar" style="width: 100%; height: 20px; background: #eee; border-radius: 10px; overflow: hidden;">
        <div id="import-progress-fill" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s;"></div>
      </div>
      <p id="import-status">Starting...</p>
    `;
    document.body.appendChild(progressEl);

    // Import batches
    const importBatch = async (items, endpoint) => {
      for (const item of items) {
        await secureRequest(endpoint, "POST", item);
        imported++;

        // Update progress
        const percentage = Math.round((imported / totalItems) * 100);
        document.getElementById(
          "import-progress-fill"
        ).style.width = `${percentage}%`;
        document.getElementById(
          "import-status"
        ).textContent = `Imported ${imported} of ${totalItems} items (${percentage}%)`;

        // Small delay to prevent rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    await importBatch(data.featured, API_ENDPOINTS.FEATURED);
    await importBatch(data.menu, API_ENDPOINTS.MENU);
    await importBatch(data.gallery, API_ENDPOINTS.GALLERY);

    // Cleanup
    progressEl.remove();
    clearDataCache();

    showNotification(`Successfully imported ${imported} items!`, "success");

    // Refresh displays
    await Promise.all([
      renderFeaturedItems(),
      renderMenuItems(),
      renderGalleryItems(),
    ]);
    await updateItemCounts();
  } catch (error) {
    console.error("Error importing data:", error);
    showNotification("Failed to import data", "error");
  }
}

/* ================== RESET FORM FUNCTIONS ================== */

function resetFeaturedForm() {
  const form = document.getElementById("featured-form");
  if (form) form.reset();
  document.getElementById("featured-id").value = "";
  document.getElementById("featured-image-preview").innerHTML = "";
  document.getElementById("featured-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetMenuForm() {
  const form = document.getElementById("menu-form");
  if (form) form.reset();
  document.getElementById("menu-id").value = "";
  document.getElementById("menu-image-preview").innerHTML = "";
  document.getElementById("menu-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

function resetGalleryForm() {
  const form = document.getElementById("gallery-form");
  if (form) form.reset();
  document.getElementById("gallery-id").value = "";
  document.getElementById("gallery-image-preview").innerHTML = "";
  document.getElementById("gallery-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

/* ================== INITIALIZATION ================== */

async function initAdminPanel() {
  console.log("Initializing Admin Panel v2.0...");

  // 🔒 NEW: Initialize admin credentials from database
  try {
    await initializeAdminCredentials();

    // Check password sync status
    setTimeout(async () => {
      const isSynced = await checkPasswordSync();
      if (
        !isSynced &&
        confirm(
          "Password not synced with database. Would you like to sync now?"
        )
      ) {
        await checkPasswordSync();
      }
    }, 1000);
  } catch (error) {
    console.error("Failed to initialize credentials:", error);
  }

  // Check session
  const session = secureStorage.getItem("session");
  if (session && session.token) {
    // Check if session is still valid
    const expiresAt = new Date(session.expiresAt);
    if (expiresAt > new Date()) {
      // Valid session, show dashboard
      currentAdmin = session.username;
      document.getElementById("login-screen").style.display = "none";
      document.getElementById("admin-dashboard").style.display = "block";
      startSessionTimeout();
      setupActivityMonitoring();
    } else {
      // Session expired
      secureStorage.removeItem("session");
    }
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

  // Setup periodic cache cleanup
  cacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    dataCache.forEach((value, key) => {
      if (now - value.timestamp > CACHE_TTL * 2) {
        dataCache.delete(key);
      }
    });

    // Clear old temp images
    if (tempImageCache.size > 50) {
      const keys = Array.from(tempImageCache.keys()).slice(
        0,
        tempImageCache.size - 50
      );
      keys.forEach((key) => tempImageCache.delete(key));
    }
  }, 60000); // Cleanup every minute

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
      showNotification("Failed to load initial data", "error");
    }
  }

  // Setup event listeners
  setupEventListeners();
}

function setupEventListeners() {
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

        // Refresh storage analysis when settings tab is opened
        if (tabId === "settings") {
          updateItemCounts();
        }
      }

      // Reset any open forms
      resetFeaturedForm();
      resetMenuForm();
      resetGalleryForm();
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
        showNotification(`Welcome back, ${username}!`);

        // Load data after successful login
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
  document
    .getElementById("featured-form")
    ?.addEventListener("submit", saveFeaturedItem);
  document
    .getElementById("menu-form")
    ?.addEventListener("submit", saveMenuItem);
  document
    .getElementById("gallery-form")
    ?.addEventListener("submit", saveGalleryItem);

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
        showNotification(result.message);
        passwordForm.reset();
      } else {
        showNotification(result.message, "error");
      }
    });
  }

  // Add buttons
  document.getElementById("add-featured-btn")?.addEventListener("click", () => {
    resetFeaturedForm();
    document.getElementById("featured-form-container").style.display = "block";
    document
      .getElementById("featured-form-container")
      .scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("add-menu-btn")?.addEventListener("click", () => {
    resetMenuForm();
    document.getElementById("menu-form-container").style.display = "block";
    document
      .getElementById("menu-form-container")
      .scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("add-gallery-btn")?.addEventListener("click", () => {
    resetGalleryForm();
    document.getElementById("gallery-form-container").style.display = "block";
    document
      .getElementById("gallery-form-container")
      .scrollIntoView({ behavior: "smooth" });
  });

  // Cancel buttons
  document
    .getElementById("cancel-featured")
    ?.addEventListener("click", resetFeaturedForm);
  document
    .getElementById("cancel-menu")
    ?.addEventListener("click", resetMenuForm);
  document
    .getElementById("cancel-gallery")
    ?.addEventListener("click", resetGalleryForm);

  // Data management buttons
  document.getElementById("export-data")?.addEventListener("click", exportData);
  document.getElementById("import-data")?.addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file);
    }
    e.target.value = ""; // Reset file input
  });

  document.getElementById("reset-data")?.addEventListener("click", async () => {
    if (
      !confirm(
        "DANGER: This will PERMANENTLY delete ALL data. This action cannot be undone!\n\nType 'DELETE ALL' to confirm:"
      )
    ) {
      return;
    }

    const confirmation = prompt("Type 'DELETE ALL' to confirm deletion:");
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

      clearDataCache();
      showNotification("All data has been reset!", "success");

      await Promise.all([
        renderFeaturedItems(),
        renderMenuItems(),
        renderGalleryItems(),
      ]);
      await updateItemCounts();
    } catch (error) {
      console.error("Error resetting data:", error);
      showNotification("Failed to reset data", "error");
    }
  });
}

// Make functions available globally
window.editFeaturedItem = editFeaturedItem;
window.deleteFeaturedItem = deleteFeaturedItem;
window.editMenuItem = editMenuItem;
window.deleteMenuItem = deleteMenuItem;
window.editGalleryItem = editGalleryItem;
window.deleteGalleryItem = deleteGalleryItem;
window.changePage = changePage;

// Initialize when DOM is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminPanel);
} else {
  initAdminPanel();
}

/* ================== FINAL OPTIONAL OPTIMIZATIONS ================== */

// 1. Expose for diagnostic tool (optional)
window.ADMIN_CREDENTIALS = ADMIN_CREDENTIALS;

// 2. Add auto-sync check every hour
setInterval(async () => {
  if (currentAdmin) {
    try {
      await checkPasswordSync();
    } catch (error) {
      console.log("Auto-sync check skipped:", error.message);
    }
  }
}, 60 * 60 * 1000); // Every hour

// 3. Add connection status indicator
function setupConnectionMonitor() {
  window.addEventListener("online", () => {
    showNotification("✅ Back online - Sync active", "success");
  });

  window.addEventListener("offline", () => {
    showNotification("⚠️ Offline - Working locally", "warning");
  });
}

// 4. Add to initAdminPanel
setupConnectionMonitor();

// 5. Add performance logging
const originalChangePassword = changePassword;
changePassword = async function (...args) {
  const startTime = Date.now();
  const result = await originalChangePassword.apply(this, args);
  const duration = Date.now() - startTime;
  console.log(`Password change completed in ${duration}ms`);
  return result;
};

console.log("✅ Toke Bakes Admin Panel v2.0 - Fully Optimized & Synced");
