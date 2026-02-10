/* ================== update-sync.js ================== */
(function initTokeUpdateSync(global) {
  if (!global || global.TokeUpdateSync) return;

  const DEFAULT_CHANNEL = "toke_bakes_data_updates";
  const DEFAULT_EVENT = "toke:data-updated";
  const LEGACY_LAST_UPDATE_KEY = "toke_bakes_last_update";
  const LAST_UPDATE_PAYLOAD_KEY = "toke_bakes_last_update_payload";

  const safeJsonParse = (value) => {
    if (typeof value !== "string" || !value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  class UpdateSyncBus {
    constructor(options = {}) {
      this.channelName = options.channelName || DEFAULT_CHANNEL;
      this.eventName = options.eventName || DEFAULT_EVENT;
      this.lastUpdateKey = options.lastUpdateKey || LEGACY_LAST_UPDATE_KEY;
      this.lastPayloadKey = options.lastPayloadKey || LAST_UPDATE_PAYLOAD_KEY;
      this.sourceId =
        options.sourceId ||
        `tab_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
      this.seenEvents = new Map();
      this.seenEventTtlMs = 2 * 60 * 1000;
      this.listeners = new Set();
      this.channel = null;
      this.boundStorageHandler = null;
      this.boundCustomHandler = null;
      this.initialized = false;
    }

    init() {
      if (this.initialized || typeof window === "undefined") return;
      this.initialized = true;

      if (typeof BroadcastChannel !== "undefined") {
        try {
          this.channel = new BroadcastChannel(this.channelName);
          this.channel.onmessage = (event) => {
            this.handleIncoming(event && event.data ? event.data : null, "bc");
          };
        } catch {
          this.channel = null;
        }
      }

      this.boundStorageHandler = (event) => {
        if (!event) return;
        if (event.key === this.lastPayloadKey && event.newValue) {
          this.handleIncoming(safeJsonParse(event.newValue), "storage");
          return;
        }
        if (event.key === this.lastUpdateKey && event.newValue) {
          this.handleIncoming(
            {
              type: "DATA_UPDATED",
              timestamp: Number(event.newValue) || Date.now(),
              sourceId: "legacy",
            },
            "storage"
          );
        }
      };
      window.addEventListener("storage", this.boundStorageHandler);

      this.boundCustomHandler = (event) => {
        const detail = event && event.detail ? event.detail : null;
        if (!detail) return;
        this.handleIncoming(detail, "custom");
      };
      window.addEventListener(this.eventName, this.boundCustomHandler);
    }

    createPayload(payload = {}) {
      const timestamp = Number(payload.timestamp) || Date.now();
      const type = payload.type || "DATA_UPDATED";
      const sourceId = payload.sourceId || this.sourceId;
      const id =
        payload.id ||
        `${type}_${timestamp}_${payload.itemType || "all"}_${
          payload.operation || "notify"
        }_${sourceId}`;

      return {
        ...payload,
        id,
        type,
        timestamp,
        sourceId,
      };
    }

    eventKey(payload) {
      if (!payload) return "";
      if (payload.id) return String(payload.id);
      return [
        payload.type || "",
        payload.timestamp || "",
        payload.itemType || "",
        payload.operation || "",
        payload.sourceId || "",
      ].join("|");
    }

    pruneSeenEvents() {
      const cutoff = Date.now() - this.seenEventTtlMs;
      this.seenEvents.forEach((seenAt, key) => {
        if (seenAt < cutoff) {
          this.seenEvents.delete(key);
        }
      });
    }

    shouldEmit(payload) {
      const key = this.eventKey(payload);
      if (!key) return false;
      if (this.seenEvents.has(key)) return false;
      return true;
    }

    markSeen(payload) {
      const key = this.eventKey(payload);
      if (!key) return;
      this.seenEvents.set(key, Date.now());
      if (this.seenEvents.size > 120) {
        this.pruneSeenEvents();
      }
    }

    notifyListeners(payload) {
      this.listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch {}
      });
    }

    handleIncoming(rawPayload, transport = "unknown") {
      const payload = this.createPayload(rawPayload || {});
      payload.transport = payload.transport || transport;
      if (!this.shouldEmit(payload)) return;
      this.markSeen(payload);
      this.notifyListeners(payload);
    }

    persistPayload(payload) {
      try {
        localStorage.setItem(this.lastUpdateKey, String(payload.timestamp));
      } catch {}

      try {
        localStorage.setItem(this.lastPayloadKey, JSON.stringify(payload));
      } catch {}
    }

    emitCustomEvent(payload) {
      try {
        window.dispatchEvent(
          new CustomEvent(this.eventName, {
            detail: payload,
          })
        );
      } catch {}
    }

    publish(payload = {}) {
      const normalized = this.createPayload(payload);
      this.persistPayload(normalized);

      if (this.channel) {
        try {
          this.channel.postMessage(normalized);
        } catch {}
      }

      this.emitCustomEvent(normalized);
      this.handleIncoming(normalized, "local");
      return normalized;
    }

    publishDataUpdate(operation = "update", itemType = "all", extra = {}) {
      return this.publish({
        type: "DATA_UPDATED",
        operation,
        itemType,
        ...extra,
      });
    }

    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }

    close() {
      if (this.boundStorageHandler) {
        window.removeEventListener("storage", this.boundStorageHandler);
        this.boundStorageHandler = null;
      }
      if (this.boundCustomHandler) {
        window.removeEventListener(this.eventName, this.boundCustomHandler);
        this.boundCustomHandler = null;
      }
      if (this.channel) {
        try {
          this.channel.close();
        } catch {}
        this.channel = null;
      }
      this.listeners.clear();
      this.initialized = false;
    }
  }

  const syncBus = new UpdateSyncBus();
  syncBus.init();
  global.TokeUpdateSync = syncBus;
})(window);
