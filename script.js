/* ================== script.js (final) ================== */
/* --------- CONFIG --------- */
const WHATSAPP_NUMBER = "+2347063466822";
const BUSINESS_EMAIL = "tokebakes@gmail.com";
const CART_KEY = "toke_bakes_cart_v1";
const THEME_KEY = "toke_bakes_theme_v1";

/* small helpers */
function qs(sel, root = document) {
  return root.querySelector(sel);
}
function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}
function formatPrice(n) {
  return Number(n).toLocaleString("en-NG");
}
function escapeHtml(t = "") {
  return (t + "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[
        m
      ])
  );
}

/* safe current page */
const currentPage = (() => {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
})();

/* Loader + page-ready */
window.addEventListener("load", () => {
  const loader = qs("#loader");
  if (loader) {
    loader.style.opacity = "0";
    setTimeout(() => loader.remove(), 450);
  }
  document.body.classList.add("ready");
});

/* ---------- THEME & UI injection (bottom sheet + theme toggle + back-to-top) ---------- */
function injectUI() {
  if (!qs("#themeToggle")) {
    const btn = document.createElement("button");
    btn.id = "themeToggle";
    btn.title = "Toggle theme";
    btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    document.body.appendChild(btn);
  }

  if (!qs("#bottomSheetBackdrop")) {
    const bs = document.createElement("div");
    bs.id = "bottomSheetBackdrop";
    bs.className = "bottom-sheet-backdrop";
    bs.innerHTML = `
      <div class="bottom-sheet" id="bottomSheet">
        <div class="handle"></div>
        <div class="sheet-title" style="text-align:center;font-weight:800;margin-bottom:10px;">How would you like to order?</div>
        <div class="sheet-actions">
          <button id="sheetWhats" class="sheet-btn whatsapp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
          <button id="sheetGmail" class="sheet-btn gmail"><i class="fa-solid fa-envelope"></i> Gmail</button>
        </div>
      </div>`;
    document.body.appendChild(bs);
  }

  if (!qs("#backToTop")) {
    const up = document.createElement("button");
    up.id = "backToTop";
    up.title = "Back to top";
    up.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    document.body.appendChild(up);
    up.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );
  }
}
injectUI();

/* Theme management */
function updateThemeIcon() {
  const btn = qs("#themeToggle");
  if (!btn) return;
  const isDark = document.documentElement.classList.contains("dark-theme");
  btn.innerHTML = isDark
    ? '<i class="fa-solid fa-sun"></i>'
    : '<i class="fa-solid fa-moon"></i>';
}
function setTheme(t) {
  if (t === "dark") document.documentElement.classList.add("dark-theme");
  else document.documentElement.classList.remove("dark-theme");
  localStorage.setItem(THEME_KEY, t);
  updateThemeIcon();
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) setTheme(saved);
  else {
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }
}
initTheme();

/* toggle click */
document.body.addEventListener("click", (e) => {
  if (e.target.closest("#themeToggle")) {
    const nowDark = document.documentElement.classList.contains("dark-theme");
    setTheme(nowDark ? "light" : "dark");
  }
});

/* ---------- NAV: active link + hamburger toggle + scroll-shrink ---------- */
(function highlightNav() {
  qsa("nav a").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    if (
      (href === "index.html" && currentPage === "index.html") ||
      href === currentPage
    )
      a.classList.add("active");
  });
})();

/* hamburger toggle */
const toggleBtn = qs("#navbarToggle");
const navList = qs(".navbar ul");
if (toggleBtn)
  toggleBtn.addEventListener("click", () => navList.classList.toggle("show"));

/* ensure hamburger hidden on desktop (class-level safety) */
function ensureNavDisplay() {
  if (window.innerWidth >= 769) navList && navList.classList.remove("show");
}
window.addEventListener("resize", ensureNavDisplay);
ensureNavDisplay();

/* scroll-shrink header + back-to-top show */
let lastY = window.scrollY;
const header = qs("header");
const backBtn = qs("#backToTop");
window.addEventListener("scroll", () => {
  // shrink header
  if (!header) return;
  const y = window.scrollY;
  if (y > 70) header.classList.add("shrink");
  else header.classList.remove("shrink");

  // back-to-top
  if (backBtn) {
    if (y > 300) backBtn.classList.add("show");
    else backBtn.classList.remove("show");
  }
  lastY = y;
});

/* ---------- CART (localStorage) ---------- */
function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}
function saveCart(c) {
  localStorage.setItem(CART_KEY, JSON.stringify(c));
  refreshCartCount();
}
function refreshCartCount() {
  const els = qsa("#cart-count");
  const cart = readCart();
  const total = cart.reduce((s, i) => s + (i.quantity || 1), 0);
  els.forEach((el) => (el.textContent = total));
}
document.addEventListener("DOMContentLoaded", refreshCartCount);

/* ---------- MENU interactions (popup + add to cart + Order Now bottom sheet) ---------- */
document.addEventListener("click", (e) => {
  // close popups when clicking outside .menu-item
  if (!e.target.closest(".menu-item"))
    qsa(".menu-item.show-popup").forEach((el) =>
      el.classList.remove("show-popup")
    );
});

/* toggle popup on item click (unless clicking buttons inside) */
qsa(".menu-item").forEach((item) => {
  item.addEventListener("click", (ev) => {
    if (ev.target.closest(".add-cart") || ev.target.closest(".order-now"))
      return;
    const open = item.classList.contains("show-popup");
    qsa(".menu-item").forEach((i) => i.classList.remove("show-popup"));
    if (!open) item.classList.add("show-popup");
  });
});

/* add to cart */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".add-cart");
  if (!btn) return;
  e.stopPropagation();
  const item = btn.closest(".menu-item");
  const name =
    item.dataset.item || item.querySelector("h3")?.textContent?.trim();
  const price = Number(item.dataset.price || 0);
  const image =
    item.querySelector("img")?.getAttribute("src") || "images/logo.jpg";
  if (!name) return;
  const cart = readCart();
  const found = cart.find((c) => c.name === name);
  if (found) found.quantity = (found.quantity || 1) + 1;
  else cart.push({ name, price, quantity: 1, image });
  saveCart(cart);
  btn.textContent = "Added ✓";
  setTimeout(() => (btn.textContent = "Add to Cart"), 900);
});

/* ---------- Bottom-sheet order flow ---------- */
const bottomBackdrop = qs("#bottomSheetBackdrop");
const bottomSheet = qs("#bottomSheet");
let currentOrderItem = null;

function openBottomSheetFor(menuItemElement) {
  const name =
    menuItemElement.dataset.item ||
    menuItemElement.querySelector("h3")?.textContent?.trim();
  const price = menuItemElement.dataset.price || "";
  currentOrderItem = { name, price };
  if (bottomBackdrop) bottomBackdrop.style.display = "flex";
  setTimeout(() => bottomSheet && bottomSheet.classList.add("show"), 20);
}
function closeBottomSheet() {
  if (!bottomSheet) return;
  bottomSheet.classList.remove("show");
  setTimeout(() => {
    if (bottomBackdrop) bottomBackdrop.style.display = "none";
    currentOrderItem = null;
  }, 280);
}
document.addEventListener("click", (e) => {
  if (e.target === bottomBackdrop) closeBottomSheet();
});

/* hook Order Now buttons on menu to open sheet */
document.addEventListener("click", (e) => {
  const ord = e.target.closest(".order-now");
  if (!ord) return;
  e.preventDefault();
  e.stopPropagation();
  const menuItem = ord.closest(".menu-item");
  if (!menuItem) return;
  openBottomSheetFor(menuItem);
});

/* bottom sheet actions */
document.addEventListener("click", (e) => {
  if (e.target.closest("#sheetWhats")) {
    if (!currentOrderItem) return;
    const lines = [
      `Hello Toke Bakes,`,
      ``,
      `I would like to order:`,
      `- ${currentOrderItem.name}${
        currentOrderItem.price ? ` (₦${currentOrderItem.price})` : ""
      }`,
      ``,
      `Please provide delivery details and payment instructions.`,
      ``,
      `Name: `,
      `Phone: `,
      `Delivery address: `,
      ``,
      `Thanks!`,
    ];
    const text = encodeURIComponent(lines.join("\n"));
    const phone = WHATSAPP_NUMBER.replace(/\D/g, "");
    const waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${text}`;
    window.open(waUrl, "_blank");
    closeBottomSheet();
  }
  if (e.target.closest("#sheetGmail")) {
    if (!currentOrderItem) return;
    const subject = encodeURIComponent(
      `Order Inquiry: ${currentOrderItem.name}`
    );
    const bodyLines = [
      `Hello Toke Bakes,`,
      ``,
      `I would like to order:`,
      `- ${currentOrderItem.name}${
        currentOrderItem.price ? ` (₦${currentOrderItem.price})` : ""
      }`,
      ``,
      `Please provide delivery details and payment instructions.`,
      ``,
      `Name: `,
      `Phone: `,
      `Delivery address: `,
      ``,
      `Thank you!`,
    ];
    const body = encodeURIComponent(bodyLines.join("\n"));
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      BUSINESS_EMAIL
    )}&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");
    closeBottomSheet();
  }
});

/* ---------- ORDER PAGE: render cart, qty changes, remove, proceed (shows bottom sheet option) ---------- */
function renderCartOnOrderPage() {
  const container = qs("#cart-container");
  if (!container) return;
  const cart = readCart();
  container.innerHTML = "";
  if (!cart || cart.length === 0) {
    container.innerHTML =
      '<p class="small-muted">Your cart is empty. Visit the <a href="menu.html">menu</a> to add items.</p>';
    return;
  }
  cart.forEach((it, idx) => {
    const div = document.createElement("div");
    div.className = "cart-row";
    div.innerHTML = `
      <img src="${escapeHtml(it.image || "images/logo.jpg")}" alt="${escapeHtml(
      it.name
    )}">
      <div class="item-info" style="flex:1;">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${escapeHtml(it.name)}</strong>
          <button class="remove-item" data-index="${idx}" style="background:transparent;border:0;color:#e55;font-weight:800;cursor:pointer">Remove</button>
        </div>
        <div class="qty-controls" style="margin-top:10px;display:flex;align-items:center;gap:12px;">
          <button class="qty-decrease" data-index="${idx}">-</button>
          <span class="qty">${it.quantity}</span>
          <button class="qty-increase" data-index="${idx}">+</button>
          <div style="margin-left:auto;font-weight:800">NGN ${formatPrice(
            (it.price || 0) * (it.quantity || 1)
          )}</div>
        </div>
      </div>
    `;
    container.appendChild(div);
  });

  qsa(".remove-item", container).forEach((btn) =>
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const cart = readCart();
      cart.splice(idx, 1);
      saveCart(cart);
      renderCartOnOrderPage();
    })
  );

  qsa(".qty-increase", container).forEach((btn) =>
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const cart = readCart();
      cart[idx].quantity = (cart[idx].quantity || 1) + 1;
      saveCart(cart);
      renderCartOnOrderPage();
    })
  );
  qsa(".qty-decrease", container).forEach((btn) =>
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const cart = readCart();
      cart[idx].quantity = (cart[idx].quantity || 1) - 1;
      if (cart[idx].quantity < 1) cart.splice(idx, 1);
      saveCart(cart);
      renderCartOnOrderPage();
    })
  );
}

/* clear cart */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clear-cart") {
    saveCart([]);
    renderCartOnOrderPage();
  }
});

/* proceed -> open bottom sheet (so user chooses WhatsApp or Gmail) */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "proceed-order") {
    const cart = readCart();
    if (!cart || cart.length === 0) return;
    // create order summary into currentOrderItem so sheet can use it
    const lines = cart.map(
      (it) => `- ${it.name} x ${it.quantity} (NGN ${it.price})`
    );
    const total = cart.reduce(
      (s, it) => s + Number(it.price || 0) * (it.quantity || 1),
      0
    );
    currentOrderItem = {
      name: `Order (${cart.length} items)`,
      price: total,
      items: lines,
    };
    // open sheet
    if (bottomBackdrop) bottomBackdrop.style.display = "flex";
    setTimeout(() => bottomSheet && bottomSheet.classList.add("show"), 20);
    // When sheet actions use currentOrderItem, the handlers above will include name+price
  }
});

/* When Gmail/WhatsApp from sheet is clicked for multi-item order, build full body */
document.addEventListener("click", (e) => {
  if (!currentOrderItem) return;
  // when sheetWhats clicked (we handle earlier) - override to include cart breakdown
  if (e.target.closest("#sheetWhats")) {
    const cart = readCart();
    const lines = [
      `Hello Toke Bakes,`,
      ``,
      `I would like to place the following order:`,
      ``,
      ...cart.map(
        (it) => `- ${it.name} x ${it.quantity} (NGN ${it.price} each)`
      ),
      ``,
      `Order total: NGN ${formatPrice(
        cart.reduce(
          (s, it) => s + Number(it.price || 0) * (it.quantity || 1),
          0
        )
      )}`,
      ``,
      `Name: `,
      `Phone: `,
      `Delivery address: `,
      ``,
      `Thanks!`,
    ];
    const text = encodeURIComponent(lines.join("\n"));
    const phone = WHATSAPP_NUMBER.replace(/\D/g, "");
    const waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${text}`;
    window.open(waUrl, "_blank");
    closeBottomSheet();
  }
  if (e.target.closest("#sheetGmail")) {
    const cart = readCart();
    const lines = [
      `Hello Toke Bakes,`,
      ``,
      `I would like to place the following order:`,
      ``,
      ...cart.map(
        (it) => `- ${it.name} x ${it.quantity} (NGN ${it.price} each)`
      ),
      ``,
      `Order total: NGN ${formatPrice(
        cart.reduce(
          (s, it) => s + Number(it.price || 0) * (it.quantity || 1),
          0
        )
      )}`,
      ``,
      `Name: `,
      `Phone: `,
      `Delivery address: `,
      ``,
      `Thank you!`,
    ];
    const subject = encodeURIComponent("New Order from Website");
    const body = encodeURIComponent(lines.join("\n"));
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      BUSINESS_EMAIL
    )}&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");
    closeBottomSheet();
  }
});

/* ---------- On DOMContentLoaded: run init tasks ---------- */
document.addEventListener("DOMContentLoaded", () => {
  refreshCartCount();
  injectUI();
  initTheme();
  updateThemeIcon();
  // render order page if present
  if (currentPage === "order.html") renderCartOnOrderPage();

  // lazy-load images (native)
  qsa("img").forEach((img) => {
    if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");
  });
});
