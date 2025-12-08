/* ================== script.js - TOKE BAKES (WITH ADMIN INTEGRATION) ================== */

// ================== DYNAMIC CONTENT LOADING ==================
// Storage keys for Toke Bakes dynamic content
const TB_STORAGE_KEYS = {
  FEATURED: "tokebakes_featured",
  MENU: "tokebakes_menu",
  GALLERY: "tokebakes_gallery",
};

// Load data from localStorage for dynamic content
function tbLoadData(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return null;
  }
}

// Load featured items on homepage
function loadFeaturedItems() {
  const container = document.getElementById("featured-container");
  if (!container) return;

  const items = tbLoadData(TB_STORAGE_KEYS.FEATURED);

  // If no data exists, show default items
  if (!items || items.length === 0) {
    container.innerHTML = `
            <article class="featured-item">
                <img src="images/cake1.jpg" alt="Chocolate Fudge Cake">
                <h4>Chocolate Fudge Cake</h4>
                <p>Rich layers of dark chocolate and silky ganache — a crowd favorite.</p>
            </article>
            <article class="featured-item">
                <img src="images/cupcakes.jpg" alt="Cupcake Assortment">
                <h4>Vanilla Dream Cupcakes</h4>
                <p>Light, fluffy cupcakes topped with creamy frosting and edible pearls.</p>
            </article>
            <article class="featured-item">
                <img src="images/pastry.jpg" alt="Fruit Pastries">
                <h4>Seasonal Fruit Pastries</h4>
                <p>Buttery, flaky pastry filled with fresh fruit and a vanilla cream.</p>
            </article>
        `;
    return;
  }

  // Generate HTML from stored data
  container.innerHTML = items
    .map(
      (item) => `
        <article class="featured-item">
            <img src="${item.image}" alt="${item.title}">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.description)}</p>
        </article>
    `
    )
    .join("");
}

// Load menu items on menu page
function loadMenuItems() {
  const container = document.getElementById("menu-container");
  if (!container) return;

  const items = tbLoadData(TB_STORAGE_KEYS.MENU);

  // If no data exists, show default items
  if (!items || items.length === 0) {
    container.innerHTML = `
            <div class="menu-item" data-item="Chocolate Fudge Cake" data-price="1200">
                <img src="images/cake1.jpg" alt="Chocolate Fudge Cake">
                <h3>Chocolate Fudge Cake</h3>
                <p>Decadent, moist layers finished with rich ganache. Serves 8–10.</p>
                <div class="popup">
                    <button class="add-cart">Add to Cart</button>
                    <a class="order-now" href="#">Order Now</a>
                </div>
            </div>
            <div class="menu-item" data-item="Red Velvet Cake" data-price="1100">
                <img src="images/cake2.jpg" alt="Red Velvet Cake">
                <h3>Red Velvet Cake</h3>
                <p>Velvety red sponge with cream cheese frosting. Elegant & classic.</p>
                <div class="popup">
                    <button class="add-cart">Add to Cart</button>
                    <a class="order-now" href="#">Order Now</a>
                </div>
            </div>
            <div class="menu-item" data-item="Vanilla Dream Cupcakes" data-price="350">
                <img src="images/cupcakes.jpg" alt="Cupcakes">
                <h3>Vanilla Dream Cupcakes (6 pcs)</h3>
                <p>Light vanilla sponge with velvety buttercream and sprinkles.</p>
                <div class="popup">
                    <button class="add-cart">Add to Cart</button>
                    <a class="order-now" href="#">Order Now</a>
                </div>
            </div>
            <div class="menu-item" data-item="Fruit Pastries (box of 4)" data-price="600">
                <img src="images/pastry.jpg" alt="Fruit Pastries">
                <h3>Fruit Pastries</h3>
                <p>Flaky pastry filled with seasonal fruits and vanilla cream.</p>
                <div class="popup">
                    <button class="add-cart">Add to Cart</button>
                    <a class="order-now" href="#">Order Now</a>
                </div>
            </div>
        `;
    return;
  }

  // Generate HTML from stored data
  container.innerHTML = items
    .map(
      (item) => `
        <div class="menu-item" data-item="${escapeHtml(
          item.title
        )}" data-price="${item.price}">
            <img src="${item.image}" alt="${item.title}">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description)}</p>
            <div class="popup">
                <button class="add-cart">Add to Cart</button>
                <a class="order-now" href="#">Order Now</a>
            </div>
        </div>
    `
    )
    .join("");
}

// Load gallery images on gallery page
function loadGalleryImages() {
  const container = document.getElementById("gallery-container");
  if (!container) return;

  const items = tbLoadData(TB_STORAGE_KEYS.GALLERY);

  // If no data exists, show default images
  if (!items || items.length === 0) {
    container.innerHTML = `
            <img src="images/gallery1.jpg" alt="Cake 1">
            <img src="images/gallery2.jpg" alt="Cupcakes">
            <img src="images/gallery3.jpg" alt="Pastries">
            <img src="images/gallery4.jpg" alt="Cookies">
            <img src="images/gallery5.jpg" alt="Wedding Cake">
            <img src="images/gallery6.jpg" alt="Dessert table">
        `;
    return;
  }

  // Generate HTML from stored data
  container.innerHTML = items
    .map(
      (item) => `
        <img src="${item.image}" alt="${item.alt}">
    `
    )
    .join("");
}

// Determine which page we're on and load appropriate content
function loadDynamicContent() {
  const currentPage = window.location.pathname.split("/").pop();

  if (
    currentPage === "index.html" ||
    currentPage === "" ||
    currentPage.includes("index")
  ) {
    loadFeaturedItems();
  } else if (currentPage === "menu.html") {
    loadMenuItems();
  } else if (currentPage === "gallery.html") {
    loadGalleryImages();
  }
}

// ================== ORIGINAL TOKE BAKES CODE (WITH YOUR EXACT FUNCTIONS) ==================

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

function escapeHtml(text) {
  return (text + "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[m])
  );
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
      (href === "index.html" && currentPage === "index.html") ||
      href === currentPage
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

/* ================== FIXED MENU INTERACTIONS (USING EVENT DELEGATION) ================== */
function initMenuInteractions() {
  // Close popups when clicking outside - USING EVENT DELEGATION
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-item")) {
      document.querySelectorAll(".menu-item.show-popup").forEach((el) => {
        el.classList.remove("show-popup");
      });
    }
  });

  // Menu item click handling - USING EVENT DELEGATION
  document.addEventListener("click", (e) => {
    const menuItem = e.target.closest(".menu-item");
    if (!menuItem) return;

    // Don't trigger if clicking on add-cart or order-now buttons
    if (e.target.closest(".add-cart") || e.target.closest(".order-now")) return;

    const isShown = menuItem.classList.contains("show-popup");
    document
      .querySelectorAll(".menu-item")
      .forEach((i) => i.classList.remove("show-popup"));
    if (!isShown) menuItem.classList.add("show-popup");
  });

  // Add to cart functionality - USING EVENT DELEGATION
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

    if (!name) return;

    const cart = readCart();
    const existing = cart.find((it) => it.name === name);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
    } else {
      cart.push({ name, price, quantity: 1, image });
    }
    saveCart(cart);

    const prevText = addBtn.textContent;
    addBtn.textContent = "Added ✓";
    setTimeout(() => (addBtn.textContent = prevText), 900);
  });
}

/* ================== ORDER FUNCTIONALITY ================== */
function initOrderFunctionality() {
  // Order now buttons - USING EVENT DELEGATION
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

  // Proceed to order button - NO ALERTS
  document.addEventListener("click", (e) => {
    if (!e.target || e.target.id !== "proceed-order") return;

    const cart = readCart();
    if (!cart || cart.length === 0) {
      // Show empty cart message in UI instead of alert
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
      // Show item with quantity × unit price
      const row = document.createElement("div");
      row.className = "summary-row";

      // FIXED: Show quantity × unit price, not quantity × total
      if (it.qty > 1) {
        row.innerHTML = `
                    <div class="s-left">${escapeHtml(it.name)}</div>
                    <div class="s-right">${it.qty}× NGN ${formatPrice(
          it.price
        )}</div>
                `;
      } else {
        row.innerHTML = `
                    <div class="s-left">${escapeHtml(it.name)}</div>
                    <div class="s-right">NGN ${formatPrice(it.price)}</div>
                `;
      }
      list.appendChild(row);

      // Show subtotal for items with quantity > 1
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

    // Calculate and show total
    const total = orderData.items.reduce(
      (s, it) => s + (it.price || 0) * (it.qty || 1),
      0
    );
    const totalRow = document.createElement("div");
    totalRow.className = "summary-total";
    totalRow.innerHTML = `
            <div class="s-left"><strong>Order total:</strong></div>
            <div class="s-right"><strong>NGN ${formatPrice(
              total
            )}</strong></div>
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
        // Gmail order logic
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
        // WhatsApp order logic
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

/* ================== CART PAGE ================== */
function renderCartOnOrderPage() {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;

  let cart = readCart();
  cartContainer.innerHTML = "";

  if (cart.length === 0) {
    cartContainer.innerHTML =
      '<p class="empty-cart">Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';
    return;
  }

  cart.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "cart-row";
    row.innerHTML = `
            <img src="${it.image || "images/logo.png"}" alt="${escapeHtml(
      it.name
    )}" />
            <div class="item-info">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong>${escapeHtml(it.name)}</strong>
                    <button class="remove-item" data-index="${idx}">Remove</button>
                </div>
                <div class="qty-controls" data-index="${idx}">
                    <button class="qty-decrease" data-index="${idx}">-</button>
                    <span class="qty" data-index="${idx}">${it.quantity}</span>
                    <button class="qty-increase" data-index="${idx}">+</button>
                    <div style="margin-left:auto;font-weight:700;">NGN ${formatPrice(
                      (it.price || 0) * (it.quantity || 1)
                    )}</div>
                </div>
            </div>
        `;
    cartContainer.appendChild(row);
  });

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
document.addEventListener("DOMContentLoaded", () => {
  console.log("Initializing Toke Bakes...");

  // Load dynamic content based on page
  loadDynamicContent();

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

  if (currentPage === "order.html") {
    renderCartOnOrderPage();
  }

  // Update copyright year
  const yearElement = document.getElementById("current-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }
});
