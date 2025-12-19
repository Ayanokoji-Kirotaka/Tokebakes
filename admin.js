/* ================== admin.js ================== */
/* Toke Bakes Admin Panel - MODERN CONFIRMATION DIALOG VERSION */

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
    }
  }

  notifyDataChanged(operationType, itemType) {
    const timestamp = Date.now().toString();
    localStorage.setItem(this.lastUpdateKey, timestamp);

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: "DATA_UPDATED",
        timestamp: timestamp,
        operation: operationType,
        itemType: itemType,
      });
    }
  }
}

const dataSync = new DataSyncManager();

// Admin credentials with SHA-256 hash for "admin123"
const ADMIN_CREDENTIALS = {
  username: "admin",
  passwordHash:
    "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
};

// Current admin state
let currentAdmin = null;
let isEditing = false;
let currentEditId = null;
let sessionTimeout = null;
const SESSION_TIMEOUT_MINUTES = 30;

// Store for temporary image data
let tempImageCache = new Map();

/* ================== MODERN CONFIRMATION DIALOG SYSTEM ================== */

class ModernConfirmationDialog {
  constructor() {
    this.dialogId = "modern-confirmation-dialog";
    this.init();
  }

  init() {
    if (!document.getElementById(this.dialogId)) {
      this.createDialog();
    }
  }

  createDialog() {
    const dialogHTML = `
      <div id="${this.dialogId}" class="confirmation-dialog" aria-hidden="true">
        <div class="confirmation-content" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
          <div class="confirmation-header">
            <i class="fas fa-exclamation-triangle"></i>
            <h3 id="confirmation-title">Confirm Deletion</h3>
            <p>Are you sure you want to delete this item?</p>
          </div>
          <div class="confirmation-body">
            <div id="confirmation-details"></div>
          </div>
          <div class="confirmation-actions">
            <button id="confirm-cancel" class="btn-confirm-cancel">
              <i class="fas fa-times"></i> Cancel
            </button>
            <button id="confirm-delete" class="btn-confirm-delete">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", dialogHTML);
  }

  show(itemDetails) {
    return new Promise((resolve) => {
      const dialog = document.getElementById(this.dialogId);
      const detailsEl = document.getElementById("confirmation-details");
      const cancelBtn = document.getElementById("confirm-cancel");
      const deleteBtn = document.getElementById("confirm-delete");
      const titleEl = document.getElementById("confirmation-title");

      // Set dialog content based on item type
      let itemType = "Item";
      if (itemDetails.type === "featured") itemType = "Featured Item";
      if (itemDetails.type === "menu") itemType = "Menu Item";
      if (itemDetails.type === "gallery") itemType = "Gallery Image";

      titleEl.textContent = `Delete ${itemType}`;

      const detailsHTML = `
        <p>This action cannot be undone. The following ${itemType.toLowerCase()} will be permanently deleted:</p>
        <div class="confirmation-item">
          <h4>${escapeHtml(itemDetails.title)}</h4>
          ${
            itemDetails.description
              ? `<p>${escapeHtml(itemDetails.description)}</p>`
              : ""
          }
          ${
            itemDetails.price
              ? `<p><strong>Price:</strong> ₦${formatPrice(
                  itemDetails.price
                )}</p>`
              : ""
          }
          ${
            itemDetails.created
              ? `<p><small>Created: ${new Date(
                  itemDetails.created
                ).toLocaleDateString()}</small></p>`
              : ""
          }
        </div>
        <p><strong>Warning:</strong> This will permanently remove this item from your database.</p>
      `;

      detailsEl.innerHTML = detailsHTML;

      // Show dialog
      dialog.classList.add("active");
      dialog.setAttribute("aria-hidden", "false");
      deleteBtn.focus();

      // Handle escape key
      const handleEscape = (e) => {
        if (e.key === "Escape") {
          dialog.classList.remove("active");
          dialog.setAttribute("aria-hidden", "true");
          resolve(false);
          document.removeEventListener("keydown", handleEscape);
        }
      };

      document.addEventListener("keydown", handleEscape);

      // Button event handlers
      const handleCancel = () => {
        dialog.classList.remove("active");
        dialog.setAttribute("aria-hidden", "true");
        resolve(false);
        cleanup();
      };

      const handleDelete = () => {
        dialog.classList.remove("active");
        dialog.setAttribute("aria-hidden", "true");
        resolve(true);
        cleanup();
      };

      const cleanup = () => {
        cancelBtn.removeEventListener("click", handleCancel);
        deleteBtn.removeEventListener("click", handleDelete);
        document.removeEventListener("keydown", handleEscape);
      };

      cancelBtn.addEventListener("click", handleCancel, { once: true });
      deleteBtn.addEventListener("click", handleDelete, { once: true });
    });
  }
}

// Initialize the modern confirmation dialog system
const confirmationDialog = new ModernConfirmationDialog();

// Helper function to get item details
async function getItemDetails(itemId, itemType) {
  try {
    const endpoints = {
      featured: API_ENDPOINTS.FEATURED,
      menu: API_ENDPOINTS.MENU,
      gallery: API_ENDPOINTS.GALLERY,
    };

    const endpoint = endpoints[itemType] || API_ENDPOINTS.FEATURED;
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}${endpoint}/${itemId}`,
      {
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      const item = await response.json();
      return {
        id: item.id,
        title: item.title || item.name || "Untitled Item",
        description: item.description || "",
        price: item.price || null,
        created: item.created_at || null,
        type: itemType,
      };
    }
  } catch (error) {
    console.error("Error fetching item details:", error);
  }

  return {
    id: itemId,
    title: "Unknown Item",
    description: "",
    type: itemType,
  };
}

// Price formatting function
function formatPrice(num) {
  return Number(num).toLocaleString("en-NG");
}

// Modified delete functions with modern confirmation dialog
async function deleteFeaturedItem(id) {
  try {
    const itemDetails = await getItemDetails(id, "featured");

    const confirmed = await confirmationDialog.show(itemDetails);

    if (!confirmed) {
      showNotification("Deletion cancelled", "info");
      return;
    }

    await secureRequest(`${API_ENDPOINTS.FEATURED}?id=eq.${id}`, "DELETE");
    showNotification("Featured item deleted!", "success");

    // Clear from cache
    tempImageCache.delete(id);
    clearDataCache();

    await renderFeaturedItems();
    await updateItemCounts();

    dataSync.notifyDataChanged("delete", "featured");
  } catch (error) {
    console.error("Error deleting featured item:", error);
    showNotification("Failed to delete item", "error");
  }
}

async function deleteMenuItem(id) {
  try {
    const itemDetails = await getItemDetails(id, "menu");

    const confirmed = await confirmationDialog.show(itemDetails);

    if (!confirmed) {
      showNotification("Deletion cancelled", "info");
      return;
    }

    await secureRequest(`${API_ENDPOINTS.MENU}?id=eq.${id}`, "DELETE");
    showNotification("Menu item deleted!", "success");

    // Clear from cache
    tempImageCache.delete(id);
    clearDataCache();

    await renderMenuItems();
    await updateItemCounts();

    dataSync.notifyDataChanged("delete", "menu");
  } catch (error) {
    console.error("Error deleting menu item:", error);
    showNotification("Failed to delete menu item", "error");
  }
}

async function deleteGalleryItem(id) {
  try {
    const itemDetails = await getItemDetails(id, "gallery");

    const confirmed = await confirmationDialog.show(itemDetails);

    if (!confirmed) {
      showNotification("Deletion cancelled", "info");
      return;
    }

    await secureRequest(`${API_ENDPOINTS.GALLERY}?id=eq.${id}`, "DELETE");
    showNotification("Gallery image deleted!", "success");

    // Clear from cache
    tempImageCache.delete(id);
    clearDataCache();

    await renderGalleryItems();
    await updateItemCounts();

    dataSync.notifyDataChanged("delete", "gallery");
  } catch (error) {
    console.error("Error deleting gallery item:", error);
    showNotification("Failed to delete gallery item", "error");
  }
}

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
      // Fallback to memory storage
      window.tempStorage = window.tempStorage || {};
      window.tempStorage[`secure_${key}`] = value;
    }
  },
  getItem: (key) => {
    try {
      const item = sessionStorage.getItem(`secure_${key}`);
      return item ? JSON.parse(atob(item)) : null;
    } catch (e) {
      console.warn("Secure storage retrieval failed:", e);
      // Check memory storage
      return window.tempStorage ? window.tempStorage[`secure_${key}`] : null;
    }
  },
  removeItem: (key) => {
    try {
      sessionStorage.removeItem(`secure_${key}`);
    } catch (e) {
      console.warn("Secure storage removal failed:", e);
    }
    // Also remove from memory storage
    if (window.tempStorage) {
      delete window.tempStorage[`secure_${key}`];
    }
  },
};

// Input sanitization
function sanitizeInput(input) {
  if (typeof input !== "string") return input;
  return input
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .trim();
}

// Escape HTML for safety
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ================== CUSTOM POPUP SYSTEM ================== */

// Custom popup system to replace alert/confirm
function showPopup(options) {
  return new Promise((resolve) => {
    // Remove existing popup if any
    const existingPopup = document.getElementById("custom-popup-overlay");
    if (existingPopup) {
      existingPopup.remove();
    }

    const {
      title = "Notification",
      message,
      type = "info",
      showCancel = false,
      cancelText = "Cancel",
      confirmText = "OK",
      onConfirm = () => {},
      onCancel = () => {},
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
      animation: fadeIn 0.3s ease;
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
      animation: slideIn 0.3s ease;
      overflow: hidden;
      font-family: 'Poppins', sans-serif;
    `;

    // Header with type-based color
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

    // Buttons container
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

      cancelBtn.addEventListener("mouseenter", () => {
        cancelBtn.style.background = "#e0e0e0";
      });

      cancelBtn.addEventListener("mouseleave", () => {
        cancelBtn.style.background = "#f5f5f5";
      });

      cancelBtn.addEventListener("click", () => {
        overlay.remove();
        onCancel();
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

    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.opacity = "0.9";
      confirmBtn.style.transform = "translateY(-2px)";
    });

    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.opacity = "1";
      confirmBtn.style.transform = "translateY(0)";
    });

    confirmBtn.addEventListener("click", () => {
      overlay.remove();
      onConfirm();
      resolve(true);
    });

    buttonsContainer.appendChild(confirmBtn);
    popup.appendChild(buttonsContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Add animations
    if (!document.querySelector("#popup-animations")) {
      const style = document.createElement("style");
      style.id = "popup-animations";
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        #custom-popup-overlay button:active {
          transform: scale(0.98);
        }

        @media (max-width: 480px) {
          #custom-popup-overlay > div {
            width: 90%;
            min-width: auto;
            margin: 20px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Close on overlay click (outside popup)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        if (showCancel) {
          overlay.remove();
          onCancel();
          resolve(false);
        }
      }
    });
  });
}

/* ================== PASSWORD HASHING ================== */

// Enhanced password hashing
async function hashPassword(password) {
  try {
    // Use SHA-256 for consistency with your existing hash
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.error("Password hashing failed:", error);
    // Simple fallback for very old browsers
    return password; // This is just a fallback - modern browsers support crypto
  }
}

/* ================== PASSWORD SYNC FUNCTIONS ================== */

// Load password from database on startup
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

        // Update local hash to match database
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

// Check password sync status
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

          // Auto-sync with database
          ADMIN_CREDENTIALS.passwordHash = dbHash;
          console.log("✅ Password synced with database");
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

// Update password in database
async function updatePasswordInDatabase(newHash) {
  try {
    const response = await fetch(
      `${SUPABASE_CONFIG.URL}/rest/v1/admin_users?username=eq.admin`,
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

/* ================== ENHANCED UTILITY FUNCTIONS ================== */

/**
 * ULTRA-OPTIMIZED IMAGE COMPRESSION WITH POPUP NOTIFICATIONS
 * Features:
 * - WebP-first compression (25-35% smaller than JPEG)
 * - User-friendly popup errors and progress
 * - Smart quality adjustment for food images
 * - Performance-optimized processing
 * - Fallback to JPEG for old browsers
 */

// ================== IMAGE COMPRESSION ==================

async function compressImage(file, maxSizeKB = 300) {
  return new Promise((resolve, reject) => {
    // 1. VALIDATION WITH USER-FRIENDLY ERRORS
    if (!file.type.startsWith("image/")) {
      showNotification(
        "❌ Please select an image file (JPEG, PNG, WebP, etc.)",
        "error"
      );
      reject(new Error("File is not an image"));
      return;
    }

    // Check for unsupported formats
    const unsupportedFormats = [
      "image/heic",
      "image/heif",
      "image/raw",
      "image/tiff",
    ];
    if (unsupportedFormats.includes(file.type.toLowerCase())) {
      showNotification(
        "❌ Please convert HEIC/TIFF/RAW images to JPEG or PNG first",
        "error"
      );
      reject(new Error("Unsupported image format"));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      // Increased to 10MB for food photography
      showNotification("❌ Image is too large! Maximum size is 10MB", "error");
      reject(new Error("Image must be less than 10MB"));
      return;
    }

    // Show compression started notification
    showNotification("🔄 Optimizing your image...", "info");

    const reader = new FileReader();

    reader.onload = function (event) {
      const img = new Image();

      img.onload = function () {
        // Use requestAnimationFrame for smoother UI
        requestAnimationFrame(() => {
          try {
            // 2. SMART DIMENSION CALCULATION FOR FOOD IMAGES
            const canvas = document.createElement("canvas");
            const maxDimension = 1200; // Higher for food detail

            // Preserve aspect ratio with food-optimized sizing
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

            // Ensure minimum size for food detail
            if (width < 500) width = 500;
            if (height < 500) height = 500;

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { alpha: false }); // Disable alpha for speed

            // Optimized drawing settings
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium"; // Balance of quality and speed
            ctx.drawImage(img, 0, 0, width, height);

            // 3. WEBP-OPTIMIZED COMPRESSION WITH SMART QUALITY ADJUSTMENT
            showNotification(
              "🔧 Adjusting quality for optimal file size...",
              "info"
            );

            const compressionResult = optimizeImage(canvas, maxSizeKB);

            // 4. SUCCESS NOTIFICATION WITH DETAILED STATS
            const originalKB = (file.size / 1024).toFixed(1);
            const compressedKB = (compressionResult.data.length / 1024).toFixed(
              1
            );
            const savings = (
              (1 - compressionResult.data.length / file.size) *
              100
            ).toFixed(1);

            let successMessage;
            if (savings > 75) {
              successMessage = `✅ Amazing compression! ${originalKB}KB → ${compressedKB}KB (${savings}% saved)`;
            } else if (savings > 50) {
              successMessage = `✅ Great optimization! ${originalKB}KB → ${compressedKB}KB`;
            } else if (savings > 20) {
              successMessage = `✅ Image optimized to ${compressedKB}KB`;
            } else {
              successMessage = `✅ Image ready at ${compressedKB}KB (high quality preserved)`;
            }

            // Add format info
            successMessage += ` • ${compressionResult.format.toUpperCase()}`;

            showNotification(successMessage, "success");

            // 5. RETURN COMPRESSED DATA
            const result = {
              data: compressionResult.data,
              format: compressionResult.format,
              size: compressionResult.data.length,
              dimensions: { width, height },
              originalSize: file.size,
              qualityUsed: compressionResult.quality,
            };

            console.log(
              `🍰 Food Image Compressed: ${originalKB}KB → ${compressedKB}KB (${savings}% saved) ` +
                `as ${compressionResult.format.toUpperCase()} at ${(
                  compressionResult.quality * 100
                ).toFixed(0)}% quality`
            );

            resolve(result);
          } catch (error) {
            // 6. PROCESSING ERROR WITH HELPFUL GUIDANCE
            showNotification(
              "❌ Failed to process image. Try a different format or smaller size.",
              "error"
            );
            console.error("Image processing failed:", error);
            reject(new Error(`Image processing failed: ${error.message}`));
          }
        });
      };

      img.onerror = () => {
        showNotification(
          "❌ Could not load image. The file may be corrupted.",
          "error"
        );
        reject(new Error("Failed to load image"));
      };

      img.src = event.target.result;
    };

    reader.onerror = () => {
      showNotification(
        "❌ Error reading file. Please try selecting the image again.",
        "error"
      );
      reject(new Error("Failed to read file"));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Optimize image to target size with WebP priority
 */
function optimizeImage(canvas, maxSizeKB) {
  const TARGET_SIZE = maxSizeKB * 1024;
  let quality = 0.85; // Start high for food quality
  let base64;
  let format = "webp";

  try {
    // Primary: Try WebP (95% of users)
    base64 = canvas.toDataURL("image/webp", quality);

    // Smart size optimization (fewer iterations = faster)
    if (base64.length > TARGET_SIZE) {
      // Calculate needed reduction
      const oversizeRatio = base64.length / TARGET_SIZE;

      if (oversizeRatio > 2) {
        // Very oversized - bigger quality drop
        quality = 0.7;
        base64 = canvas.toDataURL("image/webp", quality);
      } else if (oversizeRatio > 1.3) {
        // Moderately oversized
        quality = 0.78;
        base64 = canvas.toDataURL("image/webp", quality);
      }

      // One final check
      if (base64.length > TARGET_SIZE * 1.1 && quality > 0.65) {
        quality = 0.65;
        base64 = canvas.toDataURL("image/webp", quality);
      }
    }

    // If still too large after optimization
    if (base64.length > TARGET_SIZE * 1.2) {
      console.warn("Food image remains large - prioritizing quality over size");
    }
  } catch (error) {
    // Secondary: WebP failed, use JPEG fallback (5% of users)
    showNotification(
      "ℹ️ Using standard format for maximum compatibility",
      "info"
    );
    quality = 0.82;
    base64 = canvas.toDataURL("image/jpeg", quality);
    format = "jpeg";

    // JPEG size adjustment
    if (base64.length > TARGET_SIZE && quality > 0.7) {
      quality = 0.75;
      base64 = canvas.toDataURL("image/jpeg", quality);
    }
  }

  return { data: base64, format, quality };
}

// ================== ENHANCED NOTIFICATION SYSTEM ==================

const notificationQueue = [];
let isShowingNotification = false;
let notificationTimeout = null;

/**
 * Advanced notification system with queuing, theming, and animations
 */
function showNotification(message, type = "success") {
  const notification = {
    id: Date.now() + Math.random(),
    message,
    type,
    timestamp: new Date(),
    priority: getNotificationPriority(type),
  };

  // Add to queue (sorted by priority)
  notificationQueue.push(notification);
  notificationQueue.sort((a, b) => b.priority - a.priority);

  if (!isShowingNotification) {
    processNextNotification();
  }
}

/**
 * Priority system: error > warning > info > success
 */
function getNotificationPriority(type) {
  const priorities = {
    error: 40,
    warning: 30,
    info: 20,
    success: 10,
  };
  return priorities[type] || 10;
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
  if (existing) {
    existing.style.animation = "slideOutRight 0.3s ease-out forwards";
    setTimeout(() => existing.remove(), 300);

    // Small delay before showing next
    setTimeout(() => createNotification(notification), 350);
  } else {
    createNotification(notification);
  }
}

function createNotification(notification) {
  // Notification styling themes
  const themes = {
    success: {
      background: "linear-gradient(135deg, #4caf50, #2e7d32)",
      icon: "✅",
      border: "2px solid #2e7d32",
      iconBg: "rgba(76, 175, 80, 0.2)",
    },
    error: {
      background: "linear-gradient(135deg, #e64a4a, #c62828)",
      icon: "❌",
      border: "2px solid #c62828",
      iconBg: "rgba(230, 74, 74, 0.2)",
    },
    warning: {
      background: "linear-gradient(135deg, #ff9800, #ef6c00)",
      icon: "⚠️",
      border: "2px solid #ef6c00",
      iconBg: "rgba(255, 152, 0, 0.2)",
    },
    info: {
      background: "linear-gradient(135deg, #2196f3, #1565c0)",
      icon: "ℹ️",
      border: "2px solid #1565c0",
      iconBg: "rgba(33, 150, 243, 0.2)",
    },
  };

  const theme = themes[notification.type] || themes.success;

  // Create notification element
  const notificationEl = document.createElement("div");
  notificationEl.id = "admin-notification";
  notificationEl.className = `admin-notification admin-notification-${notification.type}`;

  // Icon container
  const iconEl = document.createElement("div");
  iconEl.className = "notification-icon";
  iconEl.textContent = theme.icon;
  iconEl.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: ${theme.iconBg};
    font-size: 1.2rem;
    flex-shrink: 0;
  `;

  // Message container
  const messageEl = document.createElement("div");
  messageEl.className = "notification-message";
  messageEl.textContent = notification.message;
  messageEl.style.cssText = `
    flex: 1;
    font-family: 'Poppins', sans-serif;
    font-size: 0.95rem;
    line-height: 1.4;
  `;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "notification-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Close notification");
  closeBtn.style.cssText = `
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: white;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
    margin-left: 10px;
  `;

  // Container
  const container = document.createElement("div");
  container.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  `;

  container.appendChild(iconEl);
  container.appendChild(messageEl);
  container.appendChild(closeBtn);
  notificationEl.appendChild(container);

  // Main notification styles
  notificationEl.style.cssText = `
    position: fixed;
    top: 25px;
    right: 25px;
    background: ${theme.background};
    color: white;
    padding: 1.2rem 1.5rem;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    animation: notificationSlideIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    max-width: 380px;
    min-width: 300px;
    cursor: pointer;
    font-family: 'Poppins', sans-serif;
    border: ${theme.border};
    backdrop-filter: blur(20px);
    transition: all 0.3s ease;
  `;

  // Add hover effect
  notificationEl.addEventListener("mouseenter", () => {
    notificationEl.style.transform = "translateY(-3px)";
    notificationEl.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.25)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.25)";
  });

  notificationEl.addEventListener("mouseleave", () => {
    notificationEl.style.transform = "translateY(0)";
    notificationEl.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.2)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.15)";
  });

  // Close button hover
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.transform = "scale(1.1)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.3)";
  });

  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.transform = "scale(1)";
    closeBtn.style.background = "rgba(255, 255, 255, 0.15)";
  });

  // Close button click
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissNotification(notificationEl);
  });

  // Click anywhere to dismiss
  notificationEl.addEventListener("click", (e) => {
    if (!e.target.closest(".notification-close")) {
      dismissNotification(notificationEl);
    }
  });

  document.body.appendChild(notificationEl);

  // Auto-dismiss based on type
  const dismissTimes = {
    error: 6000, // Longer for errors (users need to read)
    warning: 5000, // Medium for warnings
    info: 4000, // Shorter for info
    success: 3000, // Shortest for success
  };

  notificationTimeout = setTimeout(() => {
    if (document.body.contains(notificationEl)) {
      dismissNotification(notificationEl);
    }
  }, dismissTimes[notification.type] || 3000);
}

function dismissNotification(notificationEl) {
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }

  notificationEl.style.animation =
    "notificationSlideOut 0.3s ease-out forwards";

  setTimeout(() => {
    if (document.body.contains(notificationEl)) {
      notificationEl.remove();
    }
    isShowingNotification = false;
    processNextNotification();
  }, 300);
}

// Add notification animations to the page
if (!document.querySelector("#notification-animations")) {
  const style = document.createElement("style");
  style.id = "notification-animations";
  style.textContent = `
    @keyframes notificationSlideIn {
      from {
        opacity: 0;
        transform: translateX(100%) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(0) translateY(0);
      }
    }

    @keyframes notificationSlideOut {
      from {
        opacity: 1;
        transform: translateX(0) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%) translateY(-20px);
      }
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      #admin-notification {
        top: 15px !important;
        right: 15px !important;
        left: 15px !important;
        max-width: none !important;
        min-width: auto !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/* ================== FIXED SECURE API FUNCTIONS ================== */

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

  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_CONFIG.ANON_KEY,
    Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
    Prefer: "return=representation",
  };

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

        // Cache image data for faster editing
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

    // Handle Supabase response format
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
      console.log("Using cached data. Some information may be outdated.");
      return dataCache.get(cacheKey).data;
    }

    console.error("Failed to load data from cloud");
    return id ? null : [];
  }
}

// Clear cache function
function clearDataCache() {
  dataCache.clear();
  tempImageCache.clear();
}

/* ================== FIXED AUTHENTICATION - KEY CHANGES ================== */

// Fixed login attempts storage
let loginAttempts = {
  count: 0,
  timestamp: Date.now(),
  ipKey: "login_attempts",
};

// Enhanced login with rate limiting
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

async function checkLogin(username, password) {
  try {
    console.log("🔐 Login attempt for:", username);

    // Check if locked out
    const storedAttempts = JSON.parse(
      sessionStorage.getItem("login_attempts") || '{"count":0,"timestamp":0}'
    );

    if (storedAttempts.count >= MAX_LOGIN_ATTEMPTS) {
      const timeSinceFirstAttempt = Date.now() - storedAttempts.timestamp;
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
        sessionStorage.removeItem("login_attempts");
      }
    }

    // Validate username
    const sanitizedUsername = sanitizeInput(username);
    if (sanitizedUsername !== ADMIN_CREDENTIALS.username) {
      console.log("❌ Username mismatch");
      storedAttempts.count++;
      storedAttempts.timestamp =
        storedAttempts.count === 1 ? Date.now() : storedAttempts.timestamp;
      sessionStorage.setItem("login_attempts", JSON.stringify(storedAttempts));
      return false;
    }

    console.log("✅ Username matches");

    // Hash password and compare
    const hashedPassword = await hashPassword(password);
    console.log("Generated hash:", hashedPassword.substring(0, 20) + "...");
    console.log(
      "Stored hash:",
      ADMIN_CREDENTIALS.passwordHash.substring(0, 20) + "..."
    );

    const isValid = hashedPassword === ADMIN_CREDENTIALS.passwordHash;
    console.log("Hash match?", isValid);

    if (isValid) {
      // Clear login attempts on success
      sessionStorage.removeItem("login_attempts");

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

      console.log("✅ Login successful!");
      return true;
    } else {
      // Increment failed attempts
      storedAttempts.count++;
      storedAttempts.timestamp =
        storedAttempts.count === 1 ? Date.now() : storedAttempts.timestamp;
      sessionStorage.setItem("login_attempts", JSON.stringify(storedAttempts));

      console.log("❌ Password incorrect");
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
  console.log("Logging out admin...");

  // Clear all sensitive data
  currentAdmin = null;
  isEditing = false;
  currentEditId = null;
  clearSessionTimeout();
  clearDataCache();
  secureStorage.removeItem("session");

  // Reset UI
  const loginScreen = document.getElementById("login-screen");
  const adminDashboard = document.getElementById("admin-dashboard");

  if (loginScreen) loginScreen.style.display = "block";
  if (adminDashboard) adminDashboard.style.display = "none";

  // Clear forms
  resetFeaturedForm();
  resetMenuForm();
  resetGalleryForm();

  console.log("✅ Logged out successfully");
}

// FIXED: Password change with enhanced validation
async function changePassword(currentPass, newPass, confirmPass) {
  try {
    // Step 1: Validate current password
    console.log("Verifying current password...");

    // Check current password
    const currentValid = await checkLogin("admin", currentPass);
    if (!currentValid) {
      return { success: false, message: "Current password is incorrect" };
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

    // Step 3: Generate new hash
    console.log("Generating secure hash...");
    const newHash = await hashPassword(newPass);

    // Step 4: Update database
    console.log("Updating password in database...");
    const dbResult = await updatePasswordInDatabase(newHash);

    if (!dbResult.success) {
      console.error("Database update failed:", dbResult.message);

      // Use custom popup instead of confirm
      const continueLocal = await showPopup({
        title: "Database Update Failed",
        message: `Failed to update database: ${dbResult.message}\n\nDo you want to update the password locally only?\nYou will need to manually update the database later.`,
        type: "warning",
        showCancel: true,
        cancelText: "Cancel",
        confirmText: "Update Locally",
      });

      if (!continueLocal) {
        return { success: false, message: "Password change cancelled" };
      }

      // Update local only
      ADMIN_CREDENTIALS.passwordHash = newHash;

      console.log(
        "✅ Password updated locally only. Manual database update required."
      );

      return {
        success: true,
        message:
          "Password updated locally only. Manual database update required.",
        requiresManualUpdate: true,
      };
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
      console.log(`${itemType} item updated successfully!`);
    } else {
      await secureRequest(endpoint, "POST", formData);
      console.log(`${itemType} item added successfully!`);
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
    return false;
  }
}

/* ================== SPECIFIC CONTENT MANAGEMENT FUNCTIONS ================== */

// Featured Items Management
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
  } catch (error) {
    console.error(`Error rendering featured items:`, error);
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

  try {
    let imageBase64 = "";

    if (imageFile) {
      const compressed = await compressImage(imageFile);
      imageBase64 = compressed.data;
    } else if (isEditing && itemId && tempImageCache.has(itemId)) {
      imageBase64 = tempImageCache.get(itemId);
    } else {
      showPopup({
        title: "Image Required",
        message: "Please select an image",
        type: "error",
        confirmText: "OK",
      });
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
      showNotification("Featured item saved successfully!", "success");
      dataSync.notifyDataChanged(isEditing ? "update" : "create", "featured");
    }
  } catch (error) {
    console.error("Error saving featured item:", error);
    showNotification("Failed to save item", "error");
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

// Menu Items Management - FIXED: Price removed from visible display
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
          <h3 class="item-card-title">${item.title}</h3>
          <p class="item-card-desc">${item.description}</p>
          <!-- Price is NOT displayed here, only stored in data attributes -->
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
    console.error(`Error rendering menu items:`, error);
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

  // Validation
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
      showNotification("Menu item saved successfully!", "success");
      dataSync.notifyDataChanged(isEditing ? "update" : "create", "menu");
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

// Gallery Management
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
          <p><strong>Alt Text:</strong> ${item.alt}</p>
          <div class="gallery-admin-actions">
            <button class="btn-edit" onclick="editGalleryItem('${item.id}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-delete" onclick="deleteGalleryItem('${item.id}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error(`Error rendering gallery items:`, error);
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
      alt,
      image: imageBase64,
    };

    const success = await saveItem("gallery", formData);

    if (success) {
      resetGalleryForm();
      await renderGalleryItems();
      await updateItemCounts();
      showNotification("Gallery image saved successfully!", "success");
      dataSync.notifyDataChanged(isEditing ? "update" : "create", "gallery");
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
    const storageUsedEl = document.getElementById("storage-used");
    const storageFillEl = document.getElementById("storage-fill");
    const storageInfoEl = document.getElementById("storage-info");

    if (storageUsedEl) storageUsedEl.textContent = mbUsed;
    if (storageFillEl) storageFillEl.style.width = `${percentage}%`;
    if (storageInfoEl) storageInfoEl.textContent = `${mbUsed} MB / 500 MB`;

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

    // Validate backup file
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

    if (!confirmed) {
      return;
    }

    showNotification("Starting import...", "info");

    // Clear existing data
    await Promise.all([
      secureRequest(`${API_ENDPOINTS.FEATURED}?id=gt.0`, "DELETE"),
      secureRequest(`${API_ENDPOINTS.MENU}?id=gt.0`, "DELETE"),
      secureRequest(`${API_ENDPOINTS.GALLERY}?id=gt.0`, "DELETE"),
    ]);

    // Import new data
    const totalItems =
      data.featured.length + data.menu.length + data.gallery.length;
    let imported = 0;

    // Import batches
    const importBatch = async (items, endpoint) => {
      for (const item of items) {
        await secureRequest(endpoint, "POST", item);
        imported++;

        // Small delay to prevent rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    await importBatch(data.featured, API_ENDPOINTS.FEATURED);
    await importBatch(data.menu, API_ENDPOINTS.MENU);
    await importBatch(data.gallery, API_ENDPOINTS.GALLERY);

    // Cleanup
    clearDataCache();

    showNotification(`Successfully imported ${imported} items!`, "success");

    // Refresh displays
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

/* ================== FIXED INITIALIZATION ================== */

async function initAdminPanel() {
  console.log("🔧 Initializing Admin Panel v2.0 (MODERN CONFIRMATION)...");

  // 🔒 Initialize admin credentials from database
  try {
    await loadPasswordFromDatabase();

    // Check password sync status
    setTimeout(async () => {
      await checkPasswordSync();
    }, 1000);
  } catch (error) {
    console.error("Failed to initialize credentials:", error);
  }

  // Check session
  const session = secureStorage.getItem("session");
  console.log("Session check:", session);

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
      console.log("✅ Restored existing session");
    } else {
      // Session expired
      secureStorage.removeItem("session");
      console.log("❌ Session expired");
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
}

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
      console.log("Login form submitted");

      const username = sanitizeInput(
        document.getElementById("admin-username").value
      );
      const password = document.getElementById("admin-password").value;

      console.log("Attempting login with:", username);

      const isValid = await checkLogin(username, password);
      if (isValid) {
        currentAdmin = username;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("admin-dashboard").style.display = "block";
        showNotification(`Welcome back, ${username}!`, "success");

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
  const featuredForm = document.getElementById("featured-form");
  const menuForm = document.getElementById("menu-form");
  const galleryForm = document.getElementById("gallery-form");

  if (featuredForm) {
    featuredForm.addEventListener("submit", saveFeaturedItem);
  }
  if (menuForm) {
    menuForm.addEventListener("submit", saveMenuItem);
  }
  if (galleryForm) {
    galleryForm.addEventListener("submit", saveGalleryItem);
  }

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

  if (cancelFeatured) {
    cancelFeatured.addEventListener("click", resetFeaturedForm);
  }
  if (cancelMenu) {
    cancelMenu.addEventListener("click", resetMenuForm);
  }
  if (cancelGallery) {
    cancelGallery.addEventListener("click", resetGalleryForm);
  }

  // Data management buttons
  const exportDataBtn = document.getElementById("export-data");
  const importDataBtn = document.getElementById("import-data");
  const resetDataBtn = document.getElementById("reset-data");
  const importFileInput = document.getElementById("import-file");

  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", exportData);
  }

  if (importDataBtn) {
    importDataBtn.addEventListener("click", () => {
      if (importFileInput) importFileInput.click();
    });
  }

  if (importFileInput) {
    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importData(file);
      }
      e.target.value = ""; // Reset file input
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

      if (!confirmed) {
        return;
      }

      const confirmation = await showPopup({
        title: "Type Confirmation",
        message: 'Please type "DELETE ALL" to confirm deletion:',
        type: "warning",
        showInput: true,
        inputPlaceholder: "Type DELETE ALL here",
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

        clearDataCache();
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

/* ================== FINAL OPTIMIZATIONS ================== */

// Add connection status indicator
function setupConnectionMonitor() {
  window.addEventListener("online", () => {
    showNotification("✅ Back online - Sync active", "success");
  });

  window.addEventListener("offline", () => {
    showNotification("⚠️ Offline - Working locally", "warning");
  });
}

// Add to initAdminPanel
setupConnectionMonitor();

console.log("✅ Toke Bakes Admin Panel v2.0 - MODERN CONFIRMATION SYSTEM");
