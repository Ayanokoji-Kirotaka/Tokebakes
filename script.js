/* ================== script.js (updated) ================== */

/* --------- CONFIG --------- */
// change this number any time
const WHATSAPP_NUMBER = "+2347063466822";
// email used by Gmail compose links
const BUSINESS_EMAIL = "tokebakes@gmail.com";
// localStorage key for cart and theme
const CART_KEY = "toke_bakes_cart_v1";
const THEME_KEY = "toke_bakes_theme_v1";

/* Utility: safe current page name */
const currentPage = (() => {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
})();

/* --- Loader fade --- */
window.addEventListener("load", () => {
  const loader = document.getElementById("loader");
  if (loader) {
    setTimeout(() => {
      loader.style.opacity = "0";
      setTimeout(() => loader.remove(), 600);
    }, 600);
  }
});

/* --- Inject theme toggle button & bottom-sheet markup (so all pages get them) --- */
function injectUI() {
  // Theme toggle (only one)
  if (!document.getElementById("themeToggle")) {
    const t = document.createElement("button");
    t.id = "themeToggle";
    t.title = "Toggle theme";
    t.innerHTML = `<i class="fa-solid fa-moon"></i>`;
    document.body.appendChild(t);
  }

  // bottom-sheet/backdrop
  if (!document.getElementById("bottomSheetBackdrop")) {
    const bs = document.createElement("div");
    bs.id = "bottomSheetBackdrop";
    bs.className = "bottom-sheet-backdrop";
    bs.innerHTML = `
      <div class="bottom-sheet" id="bottomSheet">
        <div class="handle"></div>
        <div class="sheet-title">How would you like to order?</div>
        <div class="sheet-actions">
          <button class="sheet-btn whatsapp" id="sheetWhats"> <i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
          <button class="sheet-btn gmail" id="sheetGmail"> <i class="fa-solid fa-envelope"></i> Gmail</button>
        </div>
      </div>
    `;
    document.body.appendChild(bs);
  }
}
injectUI();

/* --- Theme system --- */
function setTheme(theme) {
  if (theme === "dark") document.documentElement.classList.add("dark-theme");
  else document.documentElement.classList.remove("dark-theme");
  localStorage.setItem(THEME_KEY, theme);
  updateThemeIcon();
}
function updateThemeIcon() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const isDark = document.documentElement.classList.contains("dark-theme");
  btn.innerHTML = isDark ? `<i class="fa-solid fa-sun"></i>` : `<i class="fa-solid fa-moon"></i>`;
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) setTheme(saved);
  else {
    // prefer system dark if available
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }
}
initTheme();
document.body.addEventListener("click", (e) => {
  const t = e.target.closest("#themeToggle");
  if (!t) return;
  const nowDark = document.documentElement.classList.contains("dark-theme");
  setTheme(nowDark ? "light" : "dark");
});

/* --- Nav active highlighting --- */
(function highlightNav() {
  const navLinks = document.querySelectorAll("nav a");
  navLinks.forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    if ((href === "index.html" && currentPage === "index.html") || href === currentPage) {
      a.classList.add("active");
    }
  });
})();

/* --------- CART (localStorage) --------- */
function readCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  refreshCartCount();
}
function refreshCartCount() {
  const els = document.querySelectorAll("#cart-count");
  const cart = readCart();
  const total = cart.reduce((s, it) => s + (it.quantity || 1), 0);
  els.forEach((el) => (el.textContent = total));
}
document.addEventListener("DOMContentLoaded", refreshCartCount);

/* --- MENU interactions (popup + add to cart) --- */
document.addEventListener("click", (e) => {
  // close popups when clicking outside menu-item
  if (!e.target.closest(".menu-item")) {
    document.querySelectorAll(".menu-item.show-popup").forEach((el) => el.classList.remove("show-popup"));
  }
});

// toggle item popup
document.querySelectorAll(".menu-item").forEach((item) => {
  item.addEventListener("click", (ev) => {
    if (ev.target.closest(".add-cart") || ev.target.closest(".order-now")) return;
    const wasOpen = item.classList.contains("show-popup");
    document.querySelectorAll(".menu-item").forEach((i) => i.classList.remove("show-popup"));
    if (!wasOpen) item.classList.add("show-popup");
  });
});

// add to cart
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".add-cart");
  if (!btn) return;
  e.stopPropagation();
  const item = btn.closest(".menu-item");
  const name = item.dataset.item || item.querySelector("h3")?.textContent?.trim();
  const price = Number(item.dataset.price || 0);
  const image = item.querySelector("img")?.src || "";

  if (!name) return;
  const cart = readCart();
  const existing = cart.find((c) => c.name === name);
  if (existing) existing.quantity = (existing.quantity || 1) + 1;
  else cart.push({ name, price, quantity: 1, image });
  saveCart(cart);
  btn.textContent = "Added ✓";
  setTimeout(() => (btn.textContent = "Add to Cart"), 900);
});

/* --- Bottom-sheet ordering flow --- */
const backdrop = document.getElementById("bottomSheetBackdrop");
const bottomSheet = document.getElementById("bottomSheet");
let currentOrderItem = null;

function openBottomSheetFor(menuItemElement) {
  // store item info
  const name = menuItemElement.dataset.item || menuItemElement.querySelector("h3")?.textContent?.trim();
  const price = menuItemElement.dataset.price || "";
  currentOrderItem = { name, price };
  if (backdrop) backdrop.style.display = "flex";
  // small delay to trigger translate animation
  setTimeout(() => bottomSheet.classList.add("show"), 10);
}

// close sheet
function closeBottomSheet() {
  if (!bottomSheet) return;
  bottomSheet.classList.remove("show");
  setTimeout(() => {
    if (backdrop) backdrop.style.display = "none";
    currentOrderItem = null;
  }, 300);
}

// clicking outside sheet closes it
document.addEventListener("click", (e) => {
  if (backdrop && e.target === backdrop) closeBottomSheet();
});

// hook the Order Now buttons to show the sheet (Option 3 behavior)
document.addEventListener("click", (e) => {
  const ord = e.target.closest(".order-now");
  if (!ord) return;
  e.preventDefault();
  e.stopPropagation();
  const menuItem = ord.closest(".menu-item");
  if (!menuItem) return;
  openBottomSheetFor(menuItem);
});

/* bottom-sheet action buttons */
document.getElementById("sheetWhats").addEventListener("click", (ev) => {
  ev.preventDefault();
  if (!currentOrderItem) return;
  // build WhatsApp message
  const lines = [
    `Hello Toke Bakes,`,
    ``,
    `I would like to order:`,
    `- ${currentOrderItem.name}${currentOrderItem.price ? ` (₦${currentOrderItem.price})` : ""}`,
    ``,
    `Please provide delivery details and payment instructions.`,
    ``,
    `Name: `,
    `Phone: `,
    `Delivery address: `,
    ``,
    `Thanks!`
  ];
  const text = encodeURIComponent(lines.join("\n"));
  // use the universal api link
  const phone = WHATSAPP_NUMBER.replace(/\D/g, ""); // only digits
  const waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${text}`;
  window.open(waUrl, "_blank");
  closeBottomSheet();
});

document.getElementById("sheetGmail").addEventListener("click", (ev) => {
  ev.preventDefault();
  if (!currentOrderItem) return;
  const subject = encodeURIComponent(`Order Inquiry: ${currentOrderItem.name}`);
  const bodyLines = [
    `Hello Toke Bakes,`,
    ``,
    `I would like to order:`,
    `- ${currentOrderItem.name}${currentOrderItem.price ? ` (₦${currentOrderItem.price})` : ""}`,
    ``,
    `Please provide delivery details and payment instructions.`,
    ``,
    `Name: `,
    `Phone: `,
    `Delivery address: `,
    ``,
    `Thank you!`
  ];
  const body = encodeURIComponent(bodyLines.join("\n"));
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(BUSINESS_EMAIL)}&su=${subject}&body=${body}`;
  window.open(gmailUrl, "_blank");
  closeBottomSheet();
});

/* --- Order page render functions (same as before) --- */
function renderCartOnOrderPage() {
  const container = document.getElementById("cart-container");
  if (!container) return;
  let cart = readCart();
  container.innerHTML = "";
  if (cart.length === 0) {
    container.innerHTML = '<p>Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';
    return;
  }
  cart.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "cart-row";
    row.innerHTML = `
      <img src="${it.image || 'images/logo.jpg'}" alt="${escapeHtml(it.name)}" />
      <div class="item-info">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${escapeHtml(it.name)}</strong>
          <button class="remove-item" data-index="${idx}">Remove</button>
        </div>
        <div class="qty-controls" data-index="${idx}">
          <button class="qty-decrease" data-index="${idx}">-</button>
          <span class="qty" data-index="${idx}">${it.quantity}</span>
          <button class="qty-increase" data-index="${idx}">+</button>
          <div style="margin-left:auto;font-weight:700;">NGN ${formatPrice((it.price||0)*(it.quantity||1))}</div>
        </div>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".remove-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      let cart = readCart();
      cart.splice(Number(btn.dataset.index), 1);
      saveCart(cart);
      renderCartOnOrderPage();
    });
  });

  container.querySelectorAll(".qty-increase").forEach((btn) => {
    btn.addEventListener("click", () => {
      let cart = readCart();
      cart[Number(btn.dataset.index)].quantity++;
      saveCart(cart);
      renderCartOnOrderPage();
    });
  });

  container.querySelectorAll(".qty-decrease").forEach((btn) => {
    btn.addEventListener("click", () => {
      let cart = readCart();
      cart[Number(btn.dataset.index)].quantity--;
      if (cart[Number(btn.dataset.index)].quantity < 1) cart.splice(Number(btn.dataset.index), 1);
      saveCart(cart);
      renderCartOnOrderPage();
    });
  });
}

/* Clear cart button handler (order page) */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clear-cart") {
    saveCart([]);
    renderCartOnOrderPage();
  }
});

/* Proceed to order: opens Gmail with full cart summary */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "proceed-order") {
    const cart = readCart();
    if (!cart || cart.length === 0) return;
    const lines = ["Hello Toke Bakes,", "", "I would like to place the following order:", ""];
    let total = 0;
    cart.forEach((it) => {
      const qty = it.quantity || 1;
      const price = Number(it.price || 0);
      total += price * qty;
      lines.push(`- ${it.name} x ${qty} (NGN ${price} each)`);
    });
    lines.push("", `Order total: NGN ${formatPrice(total)}`, "", "Name:", "Phone:", "Delivery address:", "", "Please confirm availability and payment method.", "", "Thank you!");
    const subject = encodeURIComponent("New Order from Website");
    const body = encodeURIComponent(lines.join("\n"));
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(BUSINESS_EMAIL)}&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");
  }
});

/* When pages load, render order page if present */
document.addEventListener("DOMContentLoaded", () => {
  refreshCartCount();
  injectUI(); // ensure UI exists even on pages loaded later
  if (currentPage === "order.html") renderCartOnOrderPage();
});

/* helpers */
function formatPrice(n) { return Number(n).toLocaleString("en-NG"); }
function escapeHtml(t = "") { return (t + "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

/* Mobile navbar toggle */
const toggleBtn = document.getElementById("navbarToggle");
const navList = document.querySelector(".navbar ul");
if (toggleBtn) toggleBtn.addEventListener("click", () => navList.classList.toggle("show"));

/* Optional: auto-hide header on scroll for mobile (keeps UX neat) */
let lastY = window.scrollY;
const header = document.querySelector("header");
window.addEventListener("scroll", () => {
  if (!header) return;
  if (window.scrollY > lastY && window.scrollY > 80) header.style.transform = "translateY(-100%)";
  else header.style.transform = "translateY(0)";
  lastY = window.scrollY;
});
