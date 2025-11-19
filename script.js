/* ================== script.js ================== */

/* Utility: safe current page name */
const currentPage = (() => {
  const p = window.location.pathname.split("/").pop();
  return p === "" ? "index.html" : p;
})();

/* --- Loader fade (auto hide after short delay) --- */
window.addEventListener("load", () => {
  const loader = document.getElementById("loader");
  if (loader) {
    setTimeout(() => {
      loader.style.opacity = "0";
      setTimeout(() => (loader.style.display = "none"), 600);
    }, 600); // small delay so the spinner is visible briefly
  }
});

/* --- Nav active highlighting --- */
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

/* --- CART: uses localStorage to persist items across pages --- */
const CART_KEY = "toke_bakes_cart_v1";

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
function refreshCartCount() {
  const countEls = document.querySelectorAll("#cart-count");
  const cart = readCart();
  const totalItems = cart.reduce((s, it) => s + (it.quantity || 1), 0);
  countEls.forEach((el) => (el.textContent = totalItems));
}

/* Initialize cart count on page load */
document.addEventListener("DOMContentLoaded", refreshCartCount);

/* --- MENU INTERACTIONS: show popup, add to cart, order now --- */
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-item")) {
    document
      .querySelectorAll(".menu-item.show-popup")
      .forEach((el) => el.classList.remove("show-popup"));
  }
});

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

/* Add to Cart button handler */
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

  addBtn.textContent = "Added ✓";
  setTimeout(() => (addBtn.textContent = "Add to Cart"), 900);
});

/* Order Now handler — opens Gmail compose with prefilled to tokebakes@gmail.com */
document.addEventListener("click", (e) => {
  const orderNow = e.target.closest(".order-now");
  if (!orderNow) return;
  e.preventDefault();
  e.stopPropagation();

  const menuItem = orderNow.closest(".menu-item");
  const name =
    menuItem.dataset.item || menuItem.querySelector("h3")?.textContent?.trim();
  const price = menuItem.dataset.price || "";
  const subject = encodeURIComponent(`Order Inquiry: ${name}`);
  const bodyLines = [
    `Hello Toke Bakes,`,
    ``,
    `I would like to order:`,
    `- ${name}${price ? ` (Price: ${price})` : ""}`,
    ``,
    `Please let me know availability, delivery options, and payment instructions.`,
    ``,
    `Name: `,
    `Phone: `,
    `Delivery address: `,
    ``,
    `Thank you!`,
  ];
  const body = encodeURIComponent(bodyLines.join("\n"));
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=tokebakes@gmail.com&su=${subject}&body=${body}`;
  window.open(gmailUrl, "_blank");
});

/* --- ORDER PAGE: render cart, modify quantities, remove, proceed to order --- */
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

/* Proceed to order: opens Gmail with full cart summary (no alert) */
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "proceed-order") {
    const cart = readCart();
    const cartMessage = document.getElementById("cart-message");

    if (!cart || cart.length === 0) {
      if (cartMessage) {
        cartMessage.textContent =
          "Your cart is empty. Visit the menu to add items.";
        cartMessage.classList.add("show");
      }
      return;
    }

    const lines = [
      "Hello Toke Bakes,",
      "",
      "I would like to place the following order:",
      "",
    ];
    let total = 0;
    cart.forEach((it) => {
      const qty = it.quantity || 1;
      const price = Number(it.price || 0);
      total += price * qty;
      lines.push(`- ${it.name} x ${qty} (NGN ${price} each)`);
    });
    lines.push("");
    lines.push(`Order total: NGN ${formatPrice(total)}`);
    lines.push("");
    lines.push("Name: ");
    lines.push("Phone: ");
    lines.push("Delivery address: ");
    lines.push("");
    lines.push("Please confirm availability and payment method.");
    lines.push("");
    lines.push("Thank you!");

    const subject = encodeURIComponent("New Order from Website");
    const body = encodeURIComponent(lines.join("\n"));
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=tokebakes@gmail.com&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");
  }
});

/* When pages load, if in order page, render cart */
document.addEventListener("DOMContentLoaded", () => {
  refreshCartCount();
  if (currentPage === "order.html") {
    renderCartOnOrderPage();
  }
});

/* Helper functions */
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

/* 📱 Mobile navbar toggle */
const toggleBtn = document.getElementById("navbarToggle");
const navList = document.querySelector(".navbar ul");

if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    navList.classList.toggle("show");
  });
}
