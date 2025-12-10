/* ================== script.js - TOKE BAKES WEBSITE ================== */
/* SUPABASE-ONLY VERSION - FIXED WITH CART VALIDATION */

// ================== DATA SOURCE CONFIGURATION ==================

const useSupabase = true; // Always use Supabase

// ================== DATA LOADING FUNCTIONS ==================

// Load from Supabase
async function loadFromSupabase(endpoint) {
  try {
    // Check if Supabase config is available
    if (
      !window.SUPABASE_CONFIG ||
      !window.SUPABASE_CONFIG.URL ||
      !window.SUPABASE_CONFIG.ANON_KEY
    ) {
      console.error("Supabase configuration not found in script.js");
      return [];
    }

    const response = await fetch(
      `${SUPABASE_CONFIG.URL}${endpoint}?select=*&order=created_at.desc`,
      {
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          "Content-Type": "application/json",
        },
        cache: "no-cache",
      }
    );

    if (!response.ok) {
      console.warn(`Failed to load from ${endpoint}:`, response.status);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Error loading from Supabase ${endpoint}:`, error);
    return [];
  }
}

// Load featured items
async function loadFeaturedItems() {
  const container = document.getElementById("featured-container");
  if (!container) return;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.FEATURED);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-star"></i>
          <p>Featured items coming soon! Check back later.</p>
        </div>
      `;
      return;
    }

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <article class="featured-item">
            <img src="${item.image}" alt="${
          item.title
        }" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkZlYXR1cmVkPC90ZXh0Pjwvc3ZnPg=='">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.description)}</p>
          </article>
        `
      )
      .join("");
  } catch (error) {
    console.error("Error loading featured items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load featured items. Please try again later.</p>
      </div>
    `;
  }
}

// Load menu items - FIXED: Price removed from visible display
async function loadMenuItems() {
  const container = document.getElementById("menu-container");
  if (!container) return;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.MENU);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>Our menu is being updated. Please check back soon!</p>
        </div>
      `;
      return;
    }

    // Generate HTML from data - Price is NOT displayed directly
    container.innerHTML = items
      .map(
        (item) => `
          <div class="menu-item" data-item="${escapeHtml(
            item.title
          )}" data-price="${item.price}" data-id="${item.id || ""}">
            <img src="${item.image}" alt="${
          item.title
        }" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lbnUgSXRlbTwvdGV4dD48L3N2Zz4='">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description)}</p>
            <!-- Price is NOT displayed here - only in data attributes and popup -->
            <div class="popup">
              <button class="add-cart">Add to Cart</button>
              <a class="order-now" href="#">Order Now</a>
            </div>
          </div>
        `
      )
      .join("");
  } catch (error) {
    console.error("Error loading menu items:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load menu items. Please try again later.</p>
      </div>
    `;
  }
}

// Load gallery images
async function loadGalleryImages() {
  const container = document.getElementById("gallery-container");
  if (!container) return;

  try {
    const items = await loadFromSupabase(API_ENDPOINTS.GALLERY);

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-images"></i>
          <p>Gallery coming soon! Check back later.</p>
        </div>
      `;
      return;
    }

    // Generate HTML from data
    container.innerHTML = items
      .map(
        (item) => `
          <img src="${item.image}" alt="${item.alt}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZlNWNjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcrialCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkdhbGxlcnk8L3RleHQ+PC9zdmc+='">
        `
      )
      .join("");
  } catch (error) {
    console.error("Error loading gallery images:", error);
    container.innerHTML = `
      <div class="empty-state error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Unable to load gallery. Please try again later.</p>
      </div>
    `;
  }
}

// Load dynamic content based on page
async function loadDynamicContent() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  console.log("Loading content for page:", currentPage);

  // Check if Supabase config exists
  if (!window.SUPABASE_CONFIG || !window.API_ENDPOINTS) {
    console.error("Supabase configuration not loaded");
    showConfigError();
    return;
  }

  if (
    currentPage.includes("index") ||
    currentPage === "" ||
    currentPage === "/"
  ) {
    await loadFeaturedItems();
  } else if (currentPage.includes("menu")) {
    await loadMenuItems();
  } else if (currentPage.includes("gallery")) {
    await loadGalleryImages();
  }
}

function showConfigError() {
  const containers = document.querySelectorAll(
    "#featured-container, #menu-container, #gallery-container"
  );
  containers.forEach((container) => {
    if (container) {
      container.innerHTML = `
        <div class="empty-state error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Website configuration error. Please check config.js file.</p>
        </div>
      `;
    }
  });
}

// ================== ORIGINAL TOKE BAKES CODE ==================

const currentPage = (() => {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
})();

/* Storage keys */
const CART_KEY = "toke_bakes_cart_v1";
const THEME_KEY = "toke_bakes_theme";

/* Business info */
const BUSINESS_PHONE_E164 = "+234 706 346 6822";
const BUSINESS_PHONE_WAME = "2347063466822";
const BUSINESS_EMAIL = "tokebakes@gmail.com";

/* Utility functions */
function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  refreshCartCount();
}

function formatPrice(num) {
  return Number(num).toLocaleString("en-NG");
}

// Escape HTML for security (already defined in admin.js, but defined here too)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ================== CART VALIDATION FUNCTIONS ================== */

// NEW: Validate cart items against current menu
async function validateCartItems() {
  try {
    const cart = readCart();
    if (cart.length === 0) return { valid: true, items: [] };

    // Load current menu items
    const currentMenu = await loadFromSupabase(API_ENDPOINTS.MENU);

    const validationResults = [];
    let hasChanges = false;
    let hasRemovals = false;

    // Check each item in cart
    cart.forEach((cartItem, index) => {
      const currentItem = currentMenu.find(
        (item) => item.title === cartItem.name || item.id === cartItem.id
      );

      if (!currentItem) {
        // Item no longer exists in menu
        validationResults.push({
          index,
          name: cartItem.name,
          status: "removed",
          message: "This item is no longer available",
          oldPrice: cartItem.price,
          newPrice: null,
        });
        hasRemovals = true;
        hasChanges = true;
      } else if (currentItem.price !== cartItem.price) {
        // Price has changed
        validationResults.push({
          index,
          name: cartItem.name,
          status: "price_changed",
          message: `Price updated from ₦${formatPrice(
            cartItem.price
          )} to ₦${formatPrice(currentItem.price)}`,
          oldPrice: cartItem.price,
          newPrice: currentItem.price,
        });
        hasChanges = true;
      } else if (currentItem.image !== cartItem.image) {
        // Image has changed (optional check)
        validationResults.push({
          index,
          name: cartItem.name,
          status: "updated",
          message: "This item has been updated",
          oldPrice: cartItem.price,
          newPrice: currentItem.price,
        });
        hasChanges = true;
      } else {
        // Item is still valid
        validationResults.push({
          index,
          name: cartItem.name,
          status: "valid",
          message: null,
          oldPrice: cartItem.price,
          newPrice: currentItem.price,
        });
      }
    });

    return {
      valid: !hasRemovals,
      hasChanges,
      hasRemovals,
      results: validationResults,
    };
  } catch (error) {
    console.error("Error validating cart:", error);
    return { valid: false, hasChanges: false, hasRemovals: false, results: [] };
  }
}

// NEW: Update cart with validated prices
function updateCartWithValidation(validationResults) {
  const cart = readCart();
  let updatedCart = [...cart];
  let changesMade = false;

  validationResults.forEach((result) => {
    if (result.status === "price_changed" && result.newPrice !== null) {
      // Update price in cart
      updatedCart[result.index].price = result.newPrice;
      changesMade = true;
    } else if (result.status === "removed") {
      // Mark item as unavailable (we'll handle display separately)
      updatedCart[result.index].unavailable = true;
      changesMade = true;
    }
  });

  if (changesMade) {
    saveCart(updatedCart);
  }

  return updatedCart;
}

/* ================== LOADER ================== */
window.addEventListener("load", () => {
  const loader = document.getElementById("loader");
  if (loader) {
    setTimeout(() => {
      loader.style.opacity = "0";
      setTimeout(() => (loader.style.display = "none"), 600);
    }, 600);
  }
});

/* ================== NAV HIGHLIGHT ================== */
(function highlightNav() {
  const navLinks = document.querySelectorAll("nav a");
  navLinks.forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    if (
      (href === "index.html" &&
        (currentPage === "index.html" || currentPage === "")) ||
      href === currentPage ||
      (href.includes("index") && currentPage.includes("index"))
    ) {
      a.classList.add("active");
    }
  });
})();

/* ================== CART COUNT ================== */
function refreshCartCount() {
  const countEls = document.querySelectorAll("#cart-count");
  const cart = readCart();
  const totalItems = cart.reduce((s, it) => s + (it.quantity || 1), 0);
  countEls.forEach((el) => {
    el.textContent = totalItems;
    el.setAttribute("data-count", String(totalItems));
  });
}

/* ================== MOBILE MENU ================== */
function initMobileMenu() {
  const toggleBtn = document.getElementById("navbarToggle");
  const navList = document.querySelector(".navbar ul");

  if (toggleBtn && navList) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navList.classList.toggle("show");
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (
        navList.classList.contains("show") &&
        !e.target.closest(".navbar") &&
        !e.target.closest("#navbarToggle")
      ) {
        navList.classList.remove("show");
      }
    });

    // Close when clicking links
    document.querySelectorAll(".navbar a").forEach((link) => {
      link.addEventListener("click", () => {
        navList.classList.remove("show");
      });
    });
  }
}

/* ================== FOOTER THEME ================== */
function updateFooterTheme(theme) {
  const footer = document.querySelector(".bakes-footer");
  if (!footer) return;

  if (theme === "dark") {
    footer.classList.add("dark-theme");
    footer.classList.remove("light-theme");
  } else {
    footer.classList.add("light-theme");
    footer.classList.remove("dark-theme");
  }
}

/* ================== THEME TOGGLE ================== */
function initThemeToggle() {
  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;

  const savedTheme =
    localStorage.getItem(THEME_KEY) ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");

  document.documentElement.setAttribute("data-theme", savedTheme);
  themeToggle.classList.toggle("dark", savedTheme === "dark");
  updateFooterTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", newTheme);
    themeToggle.classList.toggle("dark", newTheme === "dark");
    localStorage.setItem(THEME_KEY, newTheme);
    updateFooterTheme(newTheme);
  });
}

function initFooterTheme() {
  const footer = document.querySelector(".bakes-footer");
  if (!footer) return;

  function applyFooterTheme() {
    const currentTheme =
      document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    updateFooterTheme(currentTheme);
  }

  applyFooterTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addListener(applyFooterTheme);
}

/* ================== FIXED MENU INTERACTIONS ================== */
function initMenuInteractions() {
  // Close popups when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-item")) {
      document.querySelectorAll(".menu-item.show-popup").forEach((el) => {
        el.classList.remove("show-popup");
      });
    }
  });

  // Menu item click handling
  document.addEventListener("click", (e) => {
    const menuItem = e.target.closest(".menu-item");
    if (!menuItem) return;

    if (e.target.closest(".add-cart") || e.target.closest(".order-now")) return;

    const isShown = menuItem.classList.contains("show-popup");
    document
      .querySelectorAll(".menu-item")
      .forEach((i) => i.classList.remove("show-popup"));
    if (!isShown) menuItem.classList.add("show-popup");
  });

  // Add to cart functionality - NOW WITH ITEM ID
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".add-cart");
    if (!addBtn) return;
    e.stopPropagation();

    const menuItem = addBtn.closest(".menu-item");
    const name =
      menuItem.dataset.item ||
      menuItem.querySelector("h3")?.textContent?.trim();
    const price = Number(menuItem.dataset.price || 0);
    const image = menuItem.querySelector("img")?.getAttribute("src") || "";
    const id = menuItem.dataset.id || null;

    if (!name) return;

    const cart = readCart();
    const existing = cart.find((it) => it.name === name);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
      existing.id = id; // Update ID if it exists
    } else {
      cart.push({ name, price, quantity: 1, image, id });
    }
    saveCart(cart);

    const prevText = addBtn.textContent;
    addBtn.textContent = "Added ✓";
    setTimeout(() => (addBtn.textContent = prevText), 900);
  });
}

/* ================== ORDER FUNCTIONALITY ================== */
function initOrderFunctionality() {
  // Order now buttons
  document.addEventListener("click", (e) => {
    const orderNow = e.target.closest(".order-now");
    if (!orderNow) return;
    e.preventDefault();
    e.stopPropagation();

    const menuItem = orderNow.closest(".menu-item");
    const name =
      menuItem.dataset.item ||
      menuItem.querySelector("h3")?.textContent?.trim();
    const price = menuItem.dataset.price || "";

    const orderData = {
      type: "single",
      items: [{ name, price: price ? Number(price) : 0, qty: 1 }],
      subject: `Order Inquiry: ${name}`,
    };

    showOrderOptions(orderData);
  });

  // Proceed to order button - NOW WITH CART VALIDATION
  document.addEventListener("click", async (e) => {
    if (!e.target || e.target.id !== "proceed-order") return;

    const cart = readCart();
    if (!cart || cart.length === 0) {
      const cartContainer = document.getElementById("cart-container");
      if (cartContainer) {
        const existingMessage = cartContainer.querySelector(
          ".empty-cart-message"
        );
        if (!existingMessage) {
          const message = document.createElement("div");
          message.className = "empty-cart-message";
          message.style.cssText =
            "background: #fff3cd; color: #856404; padding: 12px; border-radius: 8px; margin: 15px 0; text-align: center; border: 1px solid #ffeaa7;";
          message.textContent =
            "Your cart is empty. Visit the menu to add items.";
          cartContainer.appendChild(message);
          setTimeout(() => message.remove(), 4000);
        }
      }
      return;
    }

    // Validate cart before proceeding
    const validation = await validateCartItems();
    if (validation.hasChanges) {
      // Show warning about changes
      const continueOrder = confirm(
        "Some items in your cart have changed. Please review your cart before proceeding.\n\nClick OK to review changes, or Cancel to continue anyway."
      );

      if (continueOrder) {
        // User wants to review changes, don't proceed to order
        return;
      }
    }

    const orderData = {
      type: "cart",
      items: cart.map((it) => ({
        name: it.name,
        price: Number(it.price || 0),
        qty: it.quantity || 1,
      })),
      subject: "New Order from Website",
    };
    showOrderOptions(orderData);
  });
}

function showOrderOptions(orderData) {
  const sheet = document.getElementById("order-bottom-sheet");
  if (!sheet) return;

  const summaryEl = sheet.querySelector(".order-summary");
  if (summaryEl) {
    summaryEl.innerHTML = "";
    const list = document.createElement("div");

    orderData.items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "summary-row";

      if (it.qty > 1) {
        row.innerHTML = `
          <div class="s-left">${escapeHtml(it.name)}</div>
          <div class="s-right">${it.qty}× NGN ${formatPrice(it.price)}</div>
        `;
      } else {
        row.innerHTML = `
          <div class="s-left">${escapeHtml(it.name)}</div>
          <div class="s-right">NGN ${formatPrice(it.price)}</div>
        `;
      }
      list.appendChild(row);

      if (it.qty > 1) {
        const subtotalRow = document.createElement("div");
        subtotalRow.className = "summary-subtotal";
        subtotalRow.innerHTML = `
          <div class="s-left"><em>Subtotal</em></div>
          <div class="s-right"><em>NGN ${formatPrice(
            it.price * it.qty
          )}</em></div>
        `;
        list.appendChild(subtotalRow);
      }
    });

    summaryEl.appendChild(list);

    const total = orderData.items.reduce(
      (s, it) => s + (it.price || 0) * (it.qty || 1),
      0
    );
    const totalRow = document.createElement("div");
    totalRow.className = "summary-total";
    totalRow.innerHTML = `
      <div class="s-left"><strong>Order total:</strong></div>
      <div class="s-right"><strong>NGN ${formatPrice(total)}</strong></div>
    `;
    summaryEl.appendChild(totalRow);
  }

  sheet.dataset.order = JSON.stringify(orderData);
  sheet.classList.add("visible");
}

// Bottom sheet functionality
function initBottomSheet() {
  if (document.getElementById("order-bottom-sheet")) return;

  const html = `
    <div id="order-bottom-sheet" class="order-bottom-sheet" aria-hidden="true">
      <div class="sheet-backdrop"></div>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Choose order method">
        <button class="sheet-close" aria-label="Close">✕</button>
        <h3>Place your order</h3>
        <div class="order-summary" aria-live="polite"></div>
        <div class="sheet-actions">
          <button id="order-via-gmail" class="order-option-btn">Order via Gmail</button>
          <button id="order-via-whatsapp" class="order-option-btn">Order via WhatsApp</button>
        </div>
        <small class="sheet-note">We will open your chosen app with the order pre-filled. Please complete your contact details before sending.</small>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  // Sheet event listeners
  document.addEventListener("click", (e) => {
    const sheet = document.getElementById("order-bottom-sheet");
    if (!sheet) return;

    if (
      e.target.closest(".sheet-close") ||
      e.target.classList.contains("sheet-backdrop")
    ) {
      sheet.classList.remove("visible");
    }

    const gmailBtn = e.target.closest("#order-via-gmail");
    const waBtn = e.target.closest("#order-via-whatsapp");

    if (gmailBtn || waBtn) {
      const orderData = sheet.dataset.order
        ? JSON.parse(sheet.dataset.order)
        : null;
      if (!orderData) return;

      if (gmailBtn) {
        const lines = [
          "Hello Toke Bakes,",
          "",
          "I would like to place the following order:",
          "",
          ...orderData.items.map(
            (it) =>
              `- ${it.name} x ${it.qty} ${
                it.price ? `(NGN ${formatPrice(it.price)} each)` : ""
              }`
          ),
          "",
          `Order total: NGN ${formatPrice(
            orderData.items.reduce(
              (s, it) => s + (it.price || 0) * (it.qty || 1),
              0
            )
          )}`,
          "",
          "Name: ",
          "Phone: ",
          "Delivery address: ",
          "",
          "Please confirm availability and payment method.",
          "",
          "Thank you!",
        ];

        const subject = encodeURIComponent(
          orderData.subject || "Order from website"
        );
        const body = encodeURIComponent(lines.join("\n"));
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
          BUSINESS_EMAIL
        )}&su=${subject}&body=${body}`;
        window.open(gmailUrl, "_blank");
      }

      if (waBtn) {
        const lines = [
          "Hello Toke Bakes,",
          "",
          "I would like to place the following order:",
          ...orderData.items.map(
            (it) =>
              `- ${it.name} x ${it.qty} ${
                it.price ? `(NGN ${formatPrice(it.price)} each)` : ""
              }`
          ),
          "",
          `Order total: NGN ${formatPrice(
            orderData.items.reduce(
              (s, it) => s + (it.price || 0) * (it.qty || 1),
              0
            )
          )}`,
          "",
          "Name:",
          "Phone:",
          "Delivery address:",
          "",
          "Please confirm availability and payment method.",
        ];

        const waText = encodeURIComponent(lines.join("\n"));
        const waUrl = `https://wa.me/${BUSINESS_PHONE_WAME}?text=${waText}`;
        window.open(waUrl, "_blank");
      }

      sheet.classList.remove("visible");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const sheet = document.getElementById("order-bottom-sheet");
      if (sheet) sheet.classList.remove("visible");
    }
  });
}

/* ================== CART PAGE WITH VALIDATION ================== */
async function renderCartOnOrderPage() {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  // First, validate cart items
  const validation = await validateCartItems();
  const cart = updateCartWithValidation(validation.results);

  cartContainer.innerHTML = "";

  if (cart.length === 0) {
    cartContainer.innerHTML =
      '<p class="empty-cart">Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';
    return;
  }

  // Show validation message if there are changes
  if (validation.hasChanges) {
    const warningDiv = document.createElement("div");
    warningDiv.className = "cart-validation-warning";
    warningDiv.style.cssText = `
      background: linear-gradient(135deg, #fff3cd, #ffeaa7);
      color: #856404;
      padding: 1rem;
      border-radius: 10px;
      margin-bottom: 1.5rem;
      border-left: 4px solid #ffc107;
      box-shadow: 0 4px 12px rgba(255, 193, 7, 0.15);
      animation: slideInDown 0.4s ease-out;
    `;

    let warningMessage = "⚠️ Some items in your cart have changed:";

    validation.results.forEach((result) => {
      if (result.status === "removed") {
        warningMessage += `<br>• <strong>${escapeHtml(result.name)}</strong>: ${
          result.message
        }`;
      } else if (result.status === "price_changed") {
        warningMessage += `<br>• <strong>${escapeHtml(result.name)}</strong>: ${
          result.message
        }`;
      }
    });

    warningMessage +=
      "<br><br><em>Please review your cart before proceeding.</em>";

    warningDiv.innerHTML = warningMessage;
    cartContainer.appendChild(warningDiv);
  }

  // Render cart items with validation highlights
  cart.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "cart-row";

    // Check validation status for this item
    const validationResult = validation.results.find((r) => r.index === idx);
    const isUnavailable =
      it.unavailable ||
      (validationResult && validationResult.status === "removed");
    const isPriceChanged =
      validationResult && validationResult.status === "price_changed";

    // Apply styles based on validation
    if (isUnavailable) {
      row.style.cssText = `
        opacity: 0.6;
        background: linear-gradient(135deg, #f8d7da, #f5c6cb);
        border-left: 4px solid #dc3545;
        position: relative;
      `;
    } else if (isPriceChanged) {
      row.style.cssText = `
        background: linear-gradient(135deg, #fff3cd, #ffeaa7);
        border-left: 4px solid #ffc107;
      `;
    }

    row.innerHTML = `
      <img src="${
        it.image ||
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmZTVjYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiMzMzMiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5DYXJ0PC90ZXh0Pjwvc3ZnPg=="
      }" alt="${escapeHtml(it.name)}" loading="lazy" />
      <div class="item-info">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${escapeHtml(it.name)}</strong>
          ${
            isUnavailable
              ? '<span style="color:#dc3545;font-weight:bold;font-size:0.9rem;">UNAVAILABLE</span>'
              : ""
          }
          <button class="remove-item" data-index="${idx}">Remove</button>
        </div>
        ${
          isUnavailable
            ? `
          <div style="color:#dc3545;font-size:0.9rem;margin-top:4px;margin-bottom:8px;">
            <i class="fas fa-exclamation-circle"></i> This item is no longer available
          </div>
        `
            : ""
        }
        ${
          isPriceChanged
            ? `
          <div style="color:#856404;font-size:0.9rem;margin-top:4px;margin-bottom:8px;">
            <i class="fas fa-info-circle"></i> Price updated
          </div>
        `
            : ""
        }
        <div class="qty-controls" data-index="${idx}">
          <button class="qty-decrease" data-index="${idx}" ${
      isUnavailable ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ""
    }>-</button>
          <span class="qty" data-index="${idx}">${it.quantity}</span>
          <button class="qty-increase" data-index="${idx}" ${
      isUnavailable ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ""
    }>+</button>
          <div style="margin-left:auto;font-weight:700;">NGN ${formatPrice(
            (it.price || 0) * (it.quantity || 1)
          )}</div>
        </div>
      </div>
    `;
    cartContainer.appendChild(row);
  });

  // Add "Remove Unavailable Items" button if needed
  if (validation.hasRemovals) {
    const cleanupDiv = document.createElement("div");
    cleanupDiv.style.cssText = `
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      text-align: center;
    `;

    const cleanupBtn = document.createElement("button");
    cleanupBtn.textContent = "Remove Unavailable Items";
    cleanupBtn.style.cssText = `
      background: linear-gradient(135deg, #dc3545, #c82333);
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.3s ease;
    `;

    cleanupBtn.addEventListener("mouseenter", () => {
      cleanupBtn.style.transform = "translateY(-2px)";
      cleanupBtn.style.boxShadow = "0 4px 12px rgba(220, 53, 69, 0.3)";
    });

    cleanupBtn.addEventListener("mouseleave", () => {
      cleanupBtn.style.transform = "translateY(0)";
      cleanupBtn.style.boxShadow = "none";
    });

    cleanupBtn.addEventListener("click", () => {
      const cart = readCart();
      const updatedCart = cart.filter((item) => !item.unavailable);
      saveCart(updatedCart);
      renderCartOnOrderPage();
      showNotification("Unavailable items removed from cart", "success");
    });

    cleanupDiv.appendChild(cleanupBtn);
    cartContainer.appendChild(cleanupDiv);
  }

  // Cart event listeners
  cartContainer.querySelectorAll(".remove-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      let cart = readCart();
      cart.splice(idx, 1);
      saveCart(cart);
      renderCartOnOrderPage();
    });
  });

  cartContainer.querySelectorAll(".qty-increase").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      let cart = readCart();
      cart[idx].quantity = (cart[idx].quantity || 1) + 1;
      saveCart(cart);
      renderCartOnOrderPage();
    });
  });

  cartContainer.querySelectorAll(".qty-decrease").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      let cart = readCart();
      cart[idx].quantity = (cart[idx].quantity || 1) - 1;
      if (cart[idx].quantity < 1) cart.splice(idx, 1);
      saveCart(cart);
      renderCartOnOrderPage();
    });
  });
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clear-cart") {
    saveCart([]);
    renderCartOnOrderPage();
  }
});

/* ================== RIPPLE EFFECT ================== */
function initRipple(selector) {
  document.addEventListener(
    "click",
    function (e) {
      const el = e.target.closest(selector);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-effect";
      const size = Math.max(rect.width, rect.height) * 1.2;
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";

      el.style.position = el.style.position || "relative";
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { passive: true }
  );
}

/* ================== INITIALIZE EVERYTHING ================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Initializing Toke Bakes with Supabase...");

  // Load dynamic content from Supabase
  await loadDynamicContent();

  // Your existing initialization code
  refreshCartCount();
  initMobileMenu();
  initThemeToggle();
  initFooterTheme();
  initMenuInteractions();
  initOrderFunctionality();
  initBottomSheet();
  initRipple(
    ".btn, .add-cart, .order-now, .qty-controls button, .order-option-btn, .remove-item"
  );

  if (currentPage.includes("order")) {
    await renderCartOnOrderPage();
  }

  // Update copyright year
  const yearElement = document.getElementById("current-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }
});

// Make sure config.js is loaded before script.js
// Add this to your HTML: <script src="config.js"></script> BEFORE <script src="script.js"></script>
