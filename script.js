/* ================== script.js (UPDATED) ================== */

/* Utility: safe current page name */
const currentPage = (() => {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
})();

/* ================== PERFORMANCE / HELPERS ================== */

/* Cached selectors where useful (updated on DOM ready if needed) */
let navList;
let toggleBtn;

/* Cart storage key */
const CART_KEY = "toke_bakes_cart_v1";

/* Business contact info (used for WhatsApp). Update if you want another number. */
const BUSINESS_PHONE_E164 = "+2348001234567"; // used for display
const BUSINESS_PHONE_WAME = "2348001234567"; // used in wa.me (no plus, no spaces)
const BUSINESS_EMAIL = "tokebakes@gmail.com";

/* Small safe wrappers */
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
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[
        m
      ])
  );
}

/* ================== LOADER FADE (NO CHANGES) ================== */
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

/* ================== CART BADGE / COUNT ================== */
/* Updates the small cart count badge. Hides badge if zero (fixes "always showing" glitch) */
function refreshCartCount() {
  const countEls = document.querySelectorAll("#cart-count");
  const cart = readCart();
  const totalItems = cart.reduce((s, it) => s + (it.quantity || 1), 0);
  countEls.forEach((el) => {
    el.textContent = totalItems;
    el.setAttribute("data-count", String(totalItems));
    // visually hide when 0, via CSS rule targeting [data-count="0"]
  });
}

/* Initialize cart count on page load */
document.addEventListener("DOMContentLoaded", () => {
  // cache some selectors used later
  navList = document.querySelector(".navbar ul");
  toggleBtn = document.getElementById("navbarToggle");

  refreshCartCount();
  // render cart if on order page
  if (currentPage === "order.html") {
    renderCartOnOrderPage();
  }

  // inject bottom-sheet UI once
  injectOrderBottomSheet();

  // wire up ripple effect for interactive elements
  initRipple(
    ".btn, .add-cart, .order-now, .qty-controls button, .order-option-btn, .remove-item"
  );

  // mobile nav toggle defensive wiring
  if (toggleBtn && navList) {
    toggleBtn.addEventListener("click", () => {
      navList.classList.toggle("show");
    });
  }
});

/* ================== MENU INTERACTIONS (unchanged behavior, cleaned) ================== */
/* Close popups when clicking outside */
document.addEventListener(
  "click",
  (e) => {
    if (!e.target.closest(".menu-item")) {
      document
        .querySelectorAll(".menu-item.show-popup")
        .forEach((el) => el.classList.remove("show-popup"));
    }
  },
  { passive: true }
);

/* Toggle popup when clicking a menu-item (not on the buttons within) */
document.querySelectorAll(".menu-item").forEach((item) => {
  item.addEventListener("click", (ev) => {
    if (ev.target.closest(".add-cart") || ev.target.closest(".order-now"))
      return;
    const isShown = item.classList.contains("show-popup");
    document
      .querySelectorAll(".menu-item")
      .forEach((i) => i.classList.remove("show-popup"));
    if (!isShown) item.classList.add("show-popup");
  });
});

/* Add to Cart button handler (delegated) */
document.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".add-cart");
  if (!addBtn) return;
  e.stopPropagation();
  const menuItem = addBtn.closest(".menu-item");
  const name =
    menuItem.dataset.item || menuItem.querySelector("h3")?.textContent?.trim();
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

  // micro-feedback
  const prevText = addBtn.textContent;
  addBtn.textContent = "Added ✓";
  setTimeout(() => (addBtn.textContent = prevText), 900);
});

/* ================== ORDER BUTTONS: show 2-option bottom sheet (Gmail/WhatsApp) ================== */

/* When a single-item "Order Now" is clicked on menu items */
document.addEventListener("click", (e) => {
  const orderNow = e.target.closest(".order-now");
  if (!orderNow) return;
  e.preventDefault();
  e.stopPropagation();

  const menuItem = orderNow.closest(".menu-item");
  const name =
    menuItem.dataset.item || menuItem.querySelector("h3")?.textContent?.trim();
  const price = menuItem.dataset.price || "";

  const orderData = {
    type: "single",
    items: [{ name, price: price ? Number(price) : 0, qty: 1 }],
    subject: `Order Inquiry: ${name}`,
  };

  showOrderOptions(orderData);
});

/* When "Proceed to Order" on order page is clicked, show same bottom sheet */
document.addEventListener("click", (e) => {
  if (!(e.target && e.target.id === "proceed-order")) return;

  const cart = readCart();
  if (!cart || cart.length === 0) {
    // show a subtle in-page message instead of alert (no alerts anywhere)
    let cartMessage = document.getElementById("cart-message");
    if (!cartMessage) {
      cartMessage = document.createElement("div");
      cartMessage.id = "cart-message";
      cartMessage.className = "cart-message show";
      const orderSection = document.querySelector(".order-section");
      if (orderSection)
        orderSection.insertBefore(cartMessage, orderSection.firstChild);
    }
    cartMessage.textContent =
      "Your cart is empty. Visit the menu to add items.";
    setTimeout(() => cartMessage.classList.remove("show"), 3000);
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

/* When the bottom-sheet buttons are clicked, they handle Gmail or WhatsApp actions.
   The actual compose URLs are generated here. */
function showOrderOptions(orderData) {
  const sheet = document.getElementById("order-bottom-sheet");
  if (!sheet) return;
  // populate summary inside sheet
  const summaryEl = sheet.querySelector(".order-summary");
  if (summaryEl) {
    summaryEl.innerHTML = ""; // clear
    const list = document.createElement("div");
    orderData.items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<div class="s-left">${escapeHtml(
        it.name
      )}</div><div class="s-right">${it.qty > 1 ? it.qty + "× " : ""}${
        it.price ? "NGN " + formatPrice(it.price * it.qty) : ""
      }</div>`;
      list.appendChild(row);
    });
    summaryEl.appendChild(list);
    // total
    const total = orderData.items.reduce(
      (s, it) => s + (it.price || 0) * (it.qty || 1),
      0
    );
    const totalRow = document.createElement("div");
    totalRow.className = "summary-total";
    totalRow.textContent = `Order total: NGN ${formatPrice(total)}`;
    summaryEl.appendChild(totalRow);
  }

  // attach dataset to sheet for the action handlers
  sheet.dataset.order = JSON.stringify(orderData);

  // show
  sheet.classList.add("visible");
  // trap focus lightly (bring into view)
  sheet.querySelector(".sheet-actions button")?.focus();
}

/* Close sheet when tapping backdrop or close */
document.addEventListener("click", (e) => {
  const sheet = document.getElementById("order-bottom-sheet");
  if (!sheet) return;
  if (
    e.target.closest(".sheet-close") ||
    e.target.classList.contains("sheet-backdrop")
  ) {
    sheet.classList.remove("visible");
  }
});

/* Handlers for sheet action buttons (Gmail / WhatsApp) */
document.addEventListener("click", (e) => {
  const gmailBtn = e.target.closest("#order-via-gmail");
  const waBtn = e.target.closest("#order-via-whatsapp");
  const sheet = document.getElementById("order-bottom-sheet");

  if (!sheet) return;
  const orderData = sheet.dataset.order
    ? JSON.parse(sheet.dataset.order)
    : null;
  if (!orderData) return;

  if (gmailBtn) {
    // build gmail body similar to previous behavior
    const lines = [];
    lines.push("Hello Toke Bakes,");
    lines.push("");
    if (orderData.type === "cart" || orderData.items.length > 0) {
      lines.push("I would like to place the following order:");
      lines.push("");
      orderData.items.forEach((it) => {
        lines.push(
          `- ${it.name} x ${it.qty} ${
            it.price ? `(NGN ${formatPrice(it.price)} each)` : ""
          }`
        );
      });
      lines.push("");
      const total = orderData.items.reduce(
        (s, it) => s + (it.price || 0) * (it.qty || 1),
        0
      );
      lines.push(`Order total: NGN ${formatPrice(total)}`);
      lines.push("");
    }

    lines.push("Name: ");
    lines.push("Phone: ");
    lines.push("Delivery address: ");
    lines.push("");
    lines.push("Please confirm availability and payment method.");
    lines.push("");
    lines.push("Thank you!");

    const subject = encodeURIComponent(
      orderData.subject || "Order from website"
    );
    const body = encodeURIComponent(lines.join("\n"));
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      BUSINESS_EMAIL
    )}&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");
    sheet.classList.remove("visible");
    return;
  }

  if (waBtn) {
    // build WhatsApp message
    const lines = [];
    lines.push("Hello Toke Bakes,");
    lines.push("");
    if (orderData.items.length > 0) {
      lines.push("I would like to place the following order:");
      orderData.items.forEach((it) => {
        lines.push(
          `- ${it.name} x ${it.qty} ${
            it.price ? `(NGN ${formatPrice(it.price)} each)` : ""
          }`
        );
      });
      const total = orderData.items.reduce(
        (s, it) => s + (it.price || 0) * (it.qty || 1),
        0
      );
      lines.push("");
      lines.push(`Order total: NGN ${formatPrice(total)}`);
      lines.push("");
    }
    lines.push("Name:");
    lines.push("Phone:");
    lines.push("Delivery address:");
    lines.push("");
    lines.push("Please confirm availability and payment method.");
    const waText = encodeURIComponent(lines.join("\n"));
    // use wa.me link
    const waUrl = `https://wa.me/${BUSINESS_PHONE_WAME}?text=${waText}`;
    window.open(waUrl, "_blank");
    sheet.classList.remove("visible");
    return;
  }
});

/* Accessibility: escape key closes sheet */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const sheet = document.getElementById("order-bottom-sheet");
    if (sheet) sheet.classList.remove("visible");
  }
});

/* ================== ORDER PAGE CART RENDERING (clean + safe) ================== */
function renderCartOnOrderPage() {
  const cartContainer = document.getElementById("cart-container");
  if (!cartContainer) return;
  let cart = readCart();
  cartContainer.innerHTML = "";
  if (cart.length === 0) {
    cartContainer.innerHTML =
      '<p>Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';
    return;
  }

  // create a fragment to avoid multiple reflows
  const frag = document.createDocumentFragment();

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
    frag.appendChild(row);
  });

  cartContainer.appendChild(frag);

  // attach event handlers (delegated approach could be used too)
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

/* Clear cart (no alert, clears instantly) */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clear-cart") {
    saveCart([]);
    renderCartOnOrderPage();
  }
});

/* ================== BOTTOM SHEET INJECTION (single injection across pages) ================== */
function injectOrderBottomSheet() {
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
}

/* ================== RIPPLE EFFECT (tasteful & performant) ================== */
function initRipple(selector) {
  document.addEventListener(
    "click",
    function (e) {
      const el = e.target.closest(selector);
      if (!el) return;

      // create ripple element
      const rect = el.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-effect";
      // calculate size and position
      const size = Math.max(rect.width, rect.height) * 1.2;
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";

      // insert and remove
      el.style.position = el.style.position || "relative";
      el.appendChild(ripple);
      setTimeout(() => {
        ripple.remove();
      }, 600);
    },
    { passive: true }
  );
}

/* ================== SAFETY: remove any accidental alerts (just ensure none run) ================== */
/* (no-op) intentionally left blank — ensures no alert calls are present in this file */
