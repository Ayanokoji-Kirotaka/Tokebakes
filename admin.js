/* ================== admin.js ================== */
/* Toke Bakes Admin Panel JavaScript */

// Storage keys
const STORAGE_KEYS = {
  FEATURED: "tokebakes_featured",
  MENU: "tokebakes_menu",
  GALLERY: "tokebakes_gallery",
  ADMIN: "tokebakes_admin",
};

// Default admin credentials
const DEFAULT_ADMIN = {
  username: "admin",
  password: "password123",
};

// Maximum storage in bytes (20MB)
const MAX_STORAGE = 20 * 1024 * 1024;

// Current admin state
let currentAdmin = null;
let isEditing = false;
let currentEditId = null;

/* ================== UTILITY FUNCTIONS ================== */

// Get storage usage
function getStorageUsage() {
  let total = 0;
  for (let key in STORAGE_KEYS) {
    const data = localStorage.getItem(STORAGE_KEYS[key]);
    if (data) {
      total += new Blob([data]).size;
    }
  }
  return total;
}

// Update storage display
function updateStorageDisplay() {
  const used = getStorageUsage();
  const usedMB = (used / (1024 * 1024)).toFixed(2);
  const percentage = (used / MAX_STORAGE) * 100;

  document.getElementById("storage-used").textContent = usedMB;
  document.getElementById("storage-fill").style.width = `${Math.min(
    percentage,
    100
  )}%`;

  // Update settings tab
  const storageInfo = document.getElementById("storage-info");
  if (storageInfo) {
    storageInfo.textContent = `${usedMB} MB`;
  }

  // Color warning based on usage
  const fill = document.getElementById("storage-fill");
  if (percentage > 90) {
    fill.style.background = "#e64a4a";
  } else if (percentage > 70) {
    fill.style.background = "#ff9800";
  } else {
    fill.style.background = "var(--primary)";
  }
}

// Generate unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Compress image to base64 with max size
function compressImage(file, maxSizeKB = 500) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (event) {
      const img = new Image();
      img.src = event.target.result;
      img.onload = function () {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions while maintaining aspect ratio
        const maxDimension = 1200;
        if (width > height && width > maxDimension) {
          height = (height * maxDimension) / width;
          width = maxDimension;
        } else if (height > maxDimension) {
          width = (width * maxDimension) / height;
          height = maxDimension;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Get base64 data
        let quality = 0.8;
        let base64 = canvas.toDataURL("image/jpeg", quality);

        // Check size and reduce quality if needed
        while (base64.length > maxSizeKB * 1024 * 0.75 && quality > 0.3) {
          quality -= 0.1;
          base64 = canvas.toDataURL("image/jpeg", quality);
        }

        resolve(base64);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// Show notification
function showNotification(message, type = "success") {
  // Remove existing notification
  const existing = document.getElementById("admin-notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.id = "admin-notification";
  notification.className = `admin-notification admin-notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === "success" ? "#4caf50" : "#e64a4a"};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        animation: slideInRight 0.3s ease-out;
        max-width: 300px;
    `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOutRight 0.3s ease-out forwards";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Load data from localStorage
function loadData(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return [];
  }
}

// Save data to localStorage
function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    updateStorageDisplay();
    updateItemCounts();
    return true;
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
    showNotification(
      "Storage limit reached! Please remove some items.",
      "error"
    );
    return false;
  }
}

// Update item counts in settings
function updateItemCounts() {
  const featured = loadData(STORAGE_KEYS.FEATURED);
  const menu = loadData(STORAGE_KEYS.MENU);
  const gallery = loadData(STORAGE_KEYS.GALLERY);

  document.getElementById("count-featured").textContent = featured.length;
  document.getElementById("count-menu").textContent = menu.length;
  document.getElementById("count-gallery").textContent = gallery.length;
}

/* ================== AUTHENTICATION ================== */

// Initialize admin credentials if not exists
function initAdminCredentials() {
  const savedAdmin = localStorage.getItem(STORAGE_KEYS.ADMIN);
  if (!savedAdmin) {
    localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(DEFAULT_ADMIN));
  }
}

// Check login
function checkLogin(username, password) {
  const savedAdmin = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.ADMIN) || "{}"
  );
  return savedAdmin.username === username && savedAdmin.password === password;
}

// Change password
function changePassword(currentPass, newPass, confirmPass) {
  const savedAdmin = JSON.parse(localStorage.getItem(STORAGE_KEYS.ADMIN));

  if (savedAdmin.password !== currentPass) {
    return { success: false, message: "Current password is incorrect" };
  }

  if (newPass !== confirmPass) {
    return { success: false, message: "New passwords do not match" };
  }

  if (newPass.length < 6) {
    return {
      success: false,
      message: "Password must be at least 6 characters",
    };
  }

  savedAdmin.password = newPass;
  localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(savedAdmin));
  return { success: true, message: "Password updated successfully" };
}

/* ================== FEATURED ITEMS MANAGEMENT ================== */

// Render featured items
function renderFeaturedItems() {
  const items = loadData(STORAGE_KEYS.FEATURED);
  const container = document.getElementById("featured-items-list");

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
            <img src="${item.image}" alt="${item.title}" class="item-card-img">
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

// Add/Edit featured item
async function saveFeaturedItem(e) {
  e.preventDefault();

  const title = document.getElementById("featured-title").value.trim();
  const description = document
    .getElementById("featured-description")
    .value.trim();
  const imageFile = document.getElementById("featured-image").files[0];

  if (!title || !description) {
    showNotification("Please fill in all fields", "error");
    return;
  }

  let items = loadData(STORAGE_KEYS.FEATURED);
  let imageBase64 = "";

  // Handle image
  if (imageFile) {
    try {
      imageBase64 = await compressImage(imageFile);
    } catch (error) {
      showNotification("Error processing image", "error");
      return;
    }
  } else if (isEditing && currentEditId) {
    // Keep existing image if editing and no new image
    const existingItem = items.find((item) => item.id === currentEditId);
    if (existingItem) {
      imageBase64 = existingItem.image;
    }
  } else {
    showNotification("Please select an image", "error");
    return;
  }

  if (isEditing && currentEditId) {
    // Update existing item
    const index = items.findIndex((item) => item.id === currentEditId);
    if (index !== -1) {
      items[index] = {
        id: currentEditId,
        title,
        description,
        image: imageBase64,
      };
    }
  } else {
    // Add new item
    items.push({
      id: generateId(),
      title,
      description,
      image: imageBase64,
    });
  }

  if (saveData(STORAGE_KEYS.FEATURED, items)) {
    showNotification(isEditing ? "Item updated!" : "Item added!");
    resetFeaturedForm();
    renderFeaturedItems();
  }
}

// Edit featured item
function editFeaturedItem(id) {
  const items = loadData(STORAGE_KEYS.FEATURED);
  const item = items.find((item) => item.id === id);

  if (!item) return;

  document.getElementById("featured-id").value = item.id;
  document.getElementById("featured-title").value = item.title;
  document.getElementById("featured-description").value = item.description;

  // Show image preview
  const preview = document.getElementById("featured-image-preview");
  preview.innerHTML = `<img src="${item.image}" alt="Current image">`;

  document.getElementById("featured-form-container").style.display = "block";
  isEditing = true;
  currentEditId = id;

  // Scroll to form
  document
    .getElementById("featured-form-container")
    .scrollIntoView({ behavior: "smooth" });
}

// Delete featured item
function deleteFeaturedItem(id) {
  if (!confirm("Are you sure you want to delete this item?")) return;

  let items = loadData(STORAGE_KEYS.FEATURED);
  items = items.filter((item) => item.id !== id);

  if (saveData(STORAGE_KEYS.FEATURED, items)) {
    showNotification("Item deleted!");
    renderFeaturedItems();
  }
}

// Reset featured form
function resetFeaturedForm() {
  document.getElementById("featured-form").reset();
  document.getElementById("featured-id").value = "";
  document.getElementById("featured-image-preview").innerHTML = "";
  document.getElementById("featured-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

/* ================== MENU ITEMS MANAGEMENT ================== */

// Render menu items
function renderMenuItems() {
  const items = loadData(STORAGE_KEYS.MENU);
  const container = document.getElementById("menu-items-list");

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
        <div class="item-card" data-id="${item.id}">
            <img src="${item.image}" alt="${item.title}" class="item-card-img">
            <div class="item-card-content">
                <h3 class="item-card-title">${item.title}</h3>
                <p class="item-card-desc">${item.description}</p>
                <div class="item-card-price">₦${Number(
                  item.price
                ).toLocaleString()}</div>
                <div class="item-card-actions">
                    <button class="btn-edit" onclick="editMenuItem('${
                      item.id
                    }')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-delete" onclick="deleteMenuItem('${
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

// Add/Edit menu item
async function saveMenuItem(e) {
  e.preventDefault();

  const title = document.getElementById("menu-title").value.trim();
  const description = document.getElementById("menu-description").value.trim();
  const price = document.getElementById("menu-price").value;
  const imageFile = document.getElementById("menu-image").files[0];

  if (!title || !description || !price) {
    showNotification("Please fill in all fields", "error");
    return;
  }

  if (price < 0) {
    showNotification("Price must be a positive number", "error");
    return;
  }

  let items = loadData(STORAGE_KEYS.MENU);
  let imageBase64 = "";

  // Handle image
  if (imageFile) {
    try {
      imageBase64 = await compressImage(imageFile);
    } catch (error) {
      showNotification("Error processing image", "error");
      return;
    }
  } else if (isEditing && currentEditId) {
    // Keep existing image if editing and no new image
    const existingItem = items.find((item) => item.id === currentEditId);
    if (existingItem) {
      imageBase64 = existingItem.image;
    }
  } else {
    showNotification("Please select an image", "error");
    return;
  }

  if (isEditing && currentEditId) {
    // Update existing item
    const index = items.findIndex((item) => item.id === currentEditId);
    if (index !== -1) {
      items[index] = {
        id: currentEditId,
        title,
        description,
        price: Number(price),
        image: imageBase64,
      };
    }
  } else {
    // Add new item
    items.push({
      id: generateId(),
      title,
      description,
      price: Number(price),
      image: imageBase64,
    });
  }

  if (saveData(STORAGE_KEYS.MENU, items)) {
    showNotification(isEditing ? "Menu item updated!" : "Menu item added!");
    resetMenuForm();
    renderMenuItems();
  }
}

// Edit menu item
function editMenuItem(id) {
  const items = loadData(STORAGE_KEYS.MENU);
  const item = items.find((item) => item.id === id);

  if (!item) return;

  document.getElementById("menu-id").value = item.id;
  document.getElementById("menu-title").value = item.title;
  document.getElementById("menu-description").value = item.description;
  document.getElementById("menu-price").value = item.price;

  // Show image preview
  const preview = document.getElementById("menu-image-preview");
  preview.innerHTML = `<img src="${item.image}" alt="Current image">`;

  document.getElementById("menu-form-container").style.display = "block";
  isEditing = true;
  currentEditId = id;

  // Scroll to form
  document
    .getElementById("menu-form-container")
    .scrollIntoView({ behavior: "smooth" });
}

// Delete menu item
function deleteMenuItem(id) {
  if (!confirm("Are you sure you want to delete this menu item?")) return;

  let items = loadData(STORAGE_KEYS.MENU);
  items = items.filter((item) => item.id !== id);

  if (saveData(STORAGE_KEYS.MENU, items)) {
    showNotification("Menu item deleted!");
    renderMenuItems();
  }
}

// Reset menu form
function resetMenuForm() {
  document.getElementById("menu-form").reset();
  document.getElementById("menu-id").value = "";
  document.getElementById("menu-image-preview").innerHTML = "";
  document.getElementById("menu-form-container").style.display = "none";
  isEditing = false;
  currentEditId = null;
}

/* ================== GALLERY MANAGEMENT ================== */

// Render gallery items
function renderGalleryItems() {
  const items = loadData(STORAGE_KEYS.GALLERY);
  const container = document.getElementById("gallery-admin-grid");

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
            <img src="${item.image}" alt="${item.alt}">
            <div class="gallery-admin-overlay">
                <p><strong>Alt Text:</strong> ${item.alt}</p>
                <div class="gallery-admin-actions">
                    <button class="btn-delete" onclick="deleteGalleryItem('${item.id}')" style="width:100%;">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        </div>
    `
    )
    .join("");
}

// Add gallery item
async function saveGalleryItem(e) {
  e.preventDefault();

  const alt = document.getElementById("gallery-alt").value.trim();
  const imageFile = document.getElementById("gallery-image").files[0];

  if (!alt || !imageFile) {
    showNotification("Please fill in all fields", "error");
    return;
  }

  let items = loadData(STORAGE_KEYS.GALLERY);
  let imageBase64 = "";

  // Handle image
  if (imageFile) {
    try {
      imageBase64 = await compressImage(imageFile);
    } catch (error) {
      showNotification("Error processing image", "error");
      return;
    }
  }

  // Add new item
  items.push({
    id: generateId(),
    alt,
    image: imageBase64,
  });

  if (saveData(STORAGE_KEYS.GALLERY, items)) {
    showNotification("Gallery image added!");
    resetGalleryForm();
    renderGalleryItems();
  }
}

// Delete gallery item
function deleteGalleryItem(id) {
  if (!confirm("Are you sure you want to delete this image?")) return;

  let items = loadData(STORAGE_KEYS.GALLERY);
  items = items.filter((item) => item.id !== id);

  if (saveData(STORAGE_KEYS.GALLERY, items)) {
    showNotification("Gallery image deleted!");
    renderGalleryItems();
  }
}

// Reset gallery form
function resetGalleryForm() {
  document.getElementById("gallery-form").reset();
  document.getElementById("gallery-id").value = "";
  document.getElementById("gallery-image-preview").innerHTML = "";
  document.getElementById("gallery-form-container").style.display = "none";
}

/* ================== DATA MANAGEMENT ================== */

// Export all data
function exportData() {
  const data = {
    featured: loadData(STORAGE_KEYS.FEATURED),
    menu: loadData(STORAGE_KEYS.MENU),
    gallery: loadData(STORAGE_KEYS.GALLERY),
    admin: JSON.parse(localStorage.getItem(STORAGE_KEYS.ADMIN)),
    exportDate: new Date().toISOString(),
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

  showNotification("Data exported successfully!");
}

// Import data
function importData() {
  const fileInput = document.getElementById("import-file");
  fileInput.click();

  fileInput.onchange = function (e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("Importing will replace ALL current data. Continue?")) {
      fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      try {
        const data = JSON.parse(event.target.result);

        // Validate data structure
        if (!data.featured || !data.menu || !data.gallery || !data.admin) {
          throw new Error("Invalid backup file format");
        }

        // Save data
        saveData(STORAGE_KEYS.FEATURED, data.featured);
        saveData(STORAGE_KEYS.MENU, data.menu);
        saveData(STORAGE_KEYS.GALLERY, data.gallery);
        localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(data.admin));

        // Refresh displays
        renderFeaturedItems();
        renderMenuItems();
        renderGalleryItems();
        updateItemCounts();

        showNotification("Data imported successfully!");
      } catch (error) {
        showNotification("Error importing data: Invalid file", "error");
        console.error("Import error:", error);
      }
      fileInput.value = "";
    };
    reader.readAsText(file);
  };
}

// Reset to defaults
function resetToDefaults() {
  if (
    !confirm(
      "This will reset ALL data to defaults and cannot be undone. Continue?"
    )
  )
    return;

  // Clear all data
  localStorage.removeItem(STORAGE_KEYS.FEATURED);
  localStorage.removeItem(STORAGE_KEYS.MENU);
  localStorage.removeItem(STORAGE_KEYS.GALLERY);

  // Reset admin credentials to default
  localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(DEFAULT_ADMIN));

  // Refresh displays
  renderFeaturedItems();
  renderMenuItems();
  renderGalleryItems();
  updateItemCounts();

  showNotification("Data reset to defaults!");
}

/* ================== INITIALIZATION ================== */

// Initialize admin panel
function initAdminPanel() {
  // Initialize admin credentials
  initAdminCredentials();

  // Set current year
  const yearElement = document.getElementById("admin-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Update storage display
  updateStorageDisplay();
  updateItemCounts();

  // Load initial data
  renderFeaturedItems();
  renderMenuItems();
  renderGalleryItems();

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
      document.getElementById(`${tabId}-tab`).classList.add("active");

      // Reset any open forms
      resetFeaturedForm();
      resetMenuForm();
      resetGalleryForm();
    });
  });

  // Login form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const username = document.getElementById("admin-username").value;
      const password = document.getElementById("admin-password").value;

      if (checkLogin(username, password)) {
        currentAdmin = username;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("admin-dashboard").style.display = "block";
        showNotification(`Welcome, ${username}!`);
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
      currentAdmin = null;
      document.getElementById("login-screen").style.display = "block";
      document.getElementById("admin-dashboard").style.display = "none";
      showNotification("Logged out successfully");
    });
  }

  // Featured items form
  const featuredForm = document.getElementById("featured-form");
  if (featuredForm) {
    featuredForm.addEventListener("submit", saveFeaturedItem);
  }

  // Menu items form
  const menuForm = document.getElementById("menu-form");
  if (menuForm) {
    menuForm.addEventListener("submit", saveMenuItem);
  }

  // Gallery form
  const galleryForm = document.getElementById("gallery-form");
  if (galleryForm) {
    galleryForm.addEventListener("submit", saveGalleryItem);
  }

  // Change password form
  const passwordForm = document.getElementById("change-password-form");
  if (passwordForm) {
    passwordForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const currentPass = document.getElementById("current-password").value;
      const newPass = document.getElementById("new-password").value;
      const confirmPass = document.getElementById("confirm-password").value;

      const result = changePassword(currentPass, newPass, confirmPass);
      if (result.success) {
        showNotification(result.message);
        passwordForm.reset();
      } else {
        showNotification(result.message, "error");
      }
    });
  }

  // Add buttons
  document
    .getElementById("add-featured-btn")
    ?.addEventListener("click", function () {
      resetFeaturedForm();
      document.getElementById("featured-form-container").style.display =
        "block";
      document
        .getElementById("featured-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });

  document
    .getElementById("add-menu-btn")
    ?.addEventListener("click", function () {
      resetMenuForm();
      document.getElementById("menu-form-container").style.display = "block";
      document
        .getElementById("menu-form-container")
        .scrollIntoView({ behavior: "smooth" });
    });

  document
    .getElementById("add-gallery-btn")
    ?.addEventListener("click", function () {
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

  // Image preview handlers
  document
    .getElementById("featured-image")
    ?.addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
          const preview = document.getElementById("featured-image-preview");
          preview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
      }
    });

  document
    .getElementById("menu-image")
    ?.addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
          const preview = document.getElementById("menu-image-preview");
          preview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
      }
    });

  document
    .getElementById("gallery-image")
    ?.addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
          const preview = document.getElementById("gallery-image-preview");
          preview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
      }
    });

  // Data management buttons
  document.getElementById("export-data")?.addEventListener("click", exportData);
  document.getElementById("import-data")?.addEventListener("click", importData);
  document
    .getElementById("reset-data")
    ?.addEventListener("click", resetToDefaults);

  // Loader
  window.addEventListener("load", () => {
    const loader = document.getElementById("loader");
    if (loader) {
      setTimeout(() => {
        loader.style.opacity = "0";
        setTimeout(() => (loader.style.display = "none"), 600);
      }, 600);
    }
  });
}

// Make functions available globally for onclick handlers
window.editFeaturedItem = editFeaturedItem;
window.deleteFeaturedItem = deleteFeaturedItem;
window.editMenuItem = editMenuItem;
window.deleteMenuItem = deleteMenuItem;
window.deleteGalleryItem = deleteGalleryItem;

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", initAdminPanel);
