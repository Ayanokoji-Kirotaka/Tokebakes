/* ================== chat-widget.js ================== */
(function initTbChatWidget(global) {
  if (!global || global.__TB_CHAT_WIDGET_BOOTSTRAPPED__) return;
  global.__TB_CHAT_WIDGET_BOOTSTRAPPED__ = true;

  const DEFAULT_CONFIG = {
    whatsappPhoneNumber: "2347063466822",
    storeName: "Toke Bakes",
    replyTimeText: "Typically replies within 10 minutes",
    welcomeMessage: "Hi there. Tell us what you'd like to order.",
    avatarUrl: "images/logo.webp",
    defaultPrefillTemplate:
      "Hello Toke Bakes, I would like to place an order. Please assist.",
  };

  const state = {
    root: null,
    input: null,
    panel: null,
    toggle: null,
    closeBtn: null,
    sendBtn: null,
    isOpen: false,
    escapeHandler: null,
    prevFocus: null,
  };

  const toSafeString = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  };

  const sanitizePhone = (value) => toSafeString(value).replace(/[^\d]/g, "");

  const config = {
    ...DEFAULT_CONFIG,
    ...(global.TB_CHAT_WIDGET_CONFIG || {}),
  };
  config.whatsappPhoneNumber = sanitizePhone(config.whatsappPhoneNumber);

  function ensureStyles() {
    if (document.getElementById("tb-chat-widget-style")) return;
    const style = document.createElement("style");
    style.id = "tb-chat-widget-style";
    style.textContent = `
      .tb-chat-widget-root {
        --tb-chat-bg: var(--background, #ffffff);
        --tb-chat-surface: var(--surface, #f8f6f3);
        --tb-chat-text: var(--text, #222222);
        --tb-chat-muted: var(--text-light, #666666);
        --tb-chat-border: var(--border, rgba(0, 0, 0, 0.08));
        --tb-chat-primary: var(--primary, #1ebe5b);
        --tb-chat-shadow: 0 20px 46px rgba(20, 20, 20, 0.2);
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        z-index: 13000;
        pointer-events: none;
      }
      .tb-chat-widget-button {
        pointer-events: auto;
        width: 3.35rem;
        height: 3.35rem;
        border: none;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #25d366, #11b453);
        color: #fff;
        box-shadow: var(--tb-chat-shadow);
        cursor: pointer;
        transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
      }
      .tb-chat-widget-button:hover {
        transform: translateY(-2px) scale(1.02);
      }
      .tb-chat-widget-button:active {
        transform: translateY(0) scale(0.98);
      }
      .tb-chat-widget-icon {
        width: 1.45rem;
        height: 1.45rem;
      }
      .tb-chat-widget-panel {
        pointer-events: none;
        position: absolute;
        right: 0;
        bottom: 4rem;
        width: min(360px, calc(100vw - 1.5rem));
        max-height: min(74vh, 520px);
        background: var(--tb-chat-bg);
        color: var(--tb-chat-text);
        border-radius: 16px;
        border: 1px solid var(--tb-chat-border);
        box-shadow: var(--tb-chat-shadow);
        overflow: hidden;
        opacity: 0;
        transform: translate3d(0, 10px, 0) scale(0.98);
        transition: transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 180ms ease;
      }
      .tb-chat-widget-root.is-open .tb-chat-widget-panel {
        pointer-events: auto;
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
      }
      .tb-chat-widget-head {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.65rem;
        padding: 0.82rem;
        background: color-mix(in srgb, var(--tb-chat-surface) 88%, white);
        border-bottom: 1px solid var(--tb-chat-border);
      }
      .tb-chat-widget-avatar {
        width: 2.2rem;
        height: 2.2rem;
        border-radius: 999px;
        object-fit: cover;
        border: 1px solid var(--tb-chat-border);
      }
      .tb-chat-widget-title {
        font-size: 0.96rem;
        line-height: 1.2;
        font-weight: 700;
      }
      .tb-chat-widget-reply {
        margin-top: 0.1rem;
        color: var(--tb-chat-muted);
        font-size: 0.74rem;
      }
      .tb-chat-widget-close {
        width: 1.9rem;
        height: 1.9rem;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--tb-chat-muted);
        font-size: 1rem;
        cursor: pointer;
      }
      .tb-chat-widget-close:hover {
        color: var(--tb-chat-text);
        background: color-mix(in srgb, var(--tb-chat-primary) 10%, transparent);
      }
      .tb-chat-widget-body {
        padding: 0.95rem 0.82rem 0.7rem;
      }
      .tb-chat-widget-bubble {
        display: inline-block;
        max-width: 88%;
        border-radius: 12px 12px 12px 2px;
        padding: 0.62rem 0.7rem;
        font-size: 0.86rem;
        line-height: 1.4;
        background: var(--tb-chat-surface);
        color: var(--tb-chat-text);
        border: 1px solid var(--tb-chat-border);
      }
      .tb-chat-widget-compose {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.5rem;
        padding: 0.72rem 0.82rem 0.82rem;
      }
      .tb-chat-widget-input {
        width: 100%;
        border: 1px solid var(--tb-chat-border);
        border-radius: 12px;
        background: var(--tb-chat-surface);
        color: var(--tb-chat-text);
        padding: 0.62rem 0.72rem;
        font: inherit;
      }
      .tb-chat-widget-send {
        border: none;
        border-radius: 12px;
        min-width: 3rem;
        padding: 0 0.85rem;
        font-size: 0.84rem;
        font-weight: 700;
        background: var(--tb-chat-primary);
        color: #fff;
        cursor: pointer;
      }
      .tb-chat-widget-send:disabled {
        opacity: 0.7;
        cursor: wait;
      }
      .tb-chat-widget-root.is-open .tb-chat-widget-button {
        opacity: 0;
        pointer-events: none;
      }
      @media (max-width: 640px) {
        .tb-chat-widget-root {
          right: 0.75rem;
          bottom: 0.75rem;
        }
        .tb-chat-widget-panel {
          bottom: 3.8rem;
          width: min(360px, calc(100vw - 1rem));
          max-height: min(76vh, 560px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tb-chat-widget-button,
        .tb-chat-widget-panel {
          transition: none;
          transform: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildWidgetMarkup() {
    const root = document.createElement("section");
    root.id = "tb-chat-widget-root";
    root.className = "tb-chat-widget-root";
    root.setAttribute("aria-label", "Customer chat widget");

    root.innerHTML = `
      <button type="button" class="tb-chat-widget-button" aria-label="Open WhatsApp chat">
        <svg viewBox="0 0 32 32" class="tb-chat-widget-icon" aria-hidden="true">
          <path fill="currentColor" d="M19.11 17.21c-.28-.14-1.65-.82-1.9-.91-.25-.09-.43-.14-.61.14-.18.28-.7.91-.86 1.1-.16.19-.31.21-.58.07-.28-.14-1.17-.43-2.24-1.37-.83-.74-1.39-1.66-1.56-1.94-.16-.28-.02-.43.12-.57.12-.12.28-.31.42-.46.14-.16.19-.28.28-.46.09-.19.05-.35-.02-.49-.07-.14-.61-1.47-.84-2.01-.22-.53-.44-.46-.61-.47h-.52c-.19 0-.49.07-.75.35-.26.28-.98.96-.98 2.34 0 1.38 1 2.72 1.14 2.91.14.19 1.97 3 4.78 4.21.67.29 1.2.46 1.61.58.68.22 1.3.19 1.79.12.55-.08 1.65-.67 1.88-1.32.23-.65.23-1.2.16-1.32-.07-.12-.25-.19-.53-.33z"></path>
          <path fill="currentColor" d="M16 3C8.82 3 3 8.72 3 15.78c0 2.27.6 4.48 1.74 6.43L3 29l6.98-1.8A13.08 13.08 0 0 0 16 28.56c7.18 0 13-5.72 13-12.78S23.18 3 16 3zm0 23.2a10.6 10.6 0 0 1-5.39-1.47l-.39-.23-4.14 1.07 1.1-4.02-.25-.41A10.3 10.3 0 0 1 5.4 15.8C5.4 10.02 10.11 5.33 16 5.33s10.6 4.69 10.6 10.47c0 5.77-4.71 10.4-10.6 10.4z"></path>
        </svg>
      </button>
      <div class="tb-chat-widget-panel" role="dialog" aria-modal="false" aria-label="Chat with ${toSafeString(
        config.storeName
      )}" aria-hidden="true">
        <header class="tb-chat-widget-head">
          <img src="${toSafeString(config.avatarUrl)}" class="tb-chat-widget-avatar" alt="${toSafeString(
            config.storeName
          )} logo" />
          <div>
            <div class="tb-chat-widget-title">${toSafeString(config.storeName)}</div>
            <p class="tb-chat-widget-reply">${toSafeString(config.replyTimeText)}</p>
          </div>
          <button type="button" class="tb-chat-widget-close" aria-label="Close chat">x</button>
        </header>
        <div class="tb-chat-widget-body">
          <p class="tb-chat-widget-bubble">${toSafeString(config.welcomeMessage)}</p>
        </div>
        <div class="tb-chat-widget-compose">
          <input type="text" class="tb-chat-widget-input" maxlength="320" placeholder="Type your message..." aria-label="Type your message" />
          <button type="button" class="tb-chat-widget-send" aria-label="Send message">Send</button>
        </div>
      </div>
    `;

    return root;
  }

  function getFocusableElements() {
    if (!state.panel) return [];
    return Array.from(
      state.panel.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
      )
    );
  }

  function closePanel() {
    if (!state.root || !state.panel || !state.isOpen) return;
    state.isOpen = false;
    state.root.classList.remove("is-open");
    state.panel.setAttribute("aria-hidden", "true");
    if (state.escapeHandler) {
      document.removeEventListener("keydown", state.escapeHandler);
      state.escapeHandler = null;
    }
    if (state.prevFocus && typeof state.prevFocus.focus === "function") {
      try {
        state.prevFocus.focus({ preventScroll: true });
      } catch {}
    }
  }

  function openPanel() {
    if (!state.root || !state.panel || state.isOpen) return;
    state.isOpen = true;
    state.prevFocus = document.activeElement;
    state.root.classList.add("is-open");
    state.panel.setAttribute("aria-hidden", "false");
    if (state.input) {
      setTimeout(() => {
        try {
          state.input.focus({ preventScroll: true });
          state.input.select();
        } catch {}
      }, 60);
    }

    state.escapeHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab" || !state.isOpen) return;
      const focusable = getFocusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", state.escapeHandler);
  }

  function sendToWhatsApp() {
    if (!config.whatsappPhoneNumber) return;
    const typedText = toSafeString(state.input?.value);
    const messageText = typedText || toSafeString(config.defaultPrefillTemplate);
    const encoded = encodeURIComponent(messageText || config.defaultPrefillTemplate);
    const url = `https://wa.me/${config.whatsappPhoneNumber}?text=${encoded}`;
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    if (popup) {
      try {
        popup.opener = null;
        popup.location.replace(url);
      } catch {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    if (state.input) state.input.value = "";
    closePanel();
  }

  function mountWidget() {
    if (state.root || document.getElementById("tb-chat-widget-root")) return;
    ensureStyles();
    state.root = buildWidgetMarkup();
    state.panel = state.root.querySelector(".tb-chat-widget-panel");
    state.toggle = state.root.querySelector(".tb-chat-widget-button");
    state.closeBtn = state.root.querySelector(".tb-chat-widget-close");
    state.sendBtn = state.root.querySelector(".tb-chat-widget-send");
    state.input = state.root.querySelector(".tb-chat-widget-input");

    if (!state.toggle || !state.panel || !state.input || !state.sendBtn) return;

    state.toggle.addEventListener("click", () => openPanel());
    state.closeBtn?.addEventListener("click", () => closePanel());
    state.sendBtn.addEventListener("click", () => sendToWhatsApp());
    state.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendToWhatsApp();
      }
    });

    document.body.appendChild(state.root);
  }

  function init(customConfig = {}) {
    Object.assign(config, customConfig || {});
    config.whatsappPhoneNumber = sanitizePhone(config.whatsappPhoneNumber);
    if (global.__TB_CHAT_WIDGET_INIT__) return;
    global.__TB_CHAT_WIDGET_INIT__ = true;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountWidget, { once: true });
      return;
    }
    mountWidget();
  }

  global.TBChatWidget = {
    init,
    open: openPanel,
    close: closePanel,
    getConfig: () => ({ ...config }),
  };

  init();
})(window);
