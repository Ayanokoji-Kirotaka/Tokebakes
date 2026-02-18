/* ================== update-sync.js ================== */
(function initTokeUpdateSync(global) {
  if (!global || global.TokeUpdateSync) return;

  const DEFAULT_CHANNEL = "toke_bakes_data_updates";
  const DEFAULT_EVENT = "toke:data-updated";
  const LEGACY_LAST_UPDATE_KEY = "toke_bakes_last_update";
  const LAST_UPDATE_PAYLOAD_KEY = "toke_bakes_last_update_payload";
  const CONTENT_VERSION_KEY = "toke_bakes_content_version";
  const SERVER_LOCK_KEY = "toke_bakes_sync_server_lock";
  const DEFAULT_SERVER_POLL_INTERVAL_MS = 12000;
  const DEFAULT_SERVER_MIN_GAP_MS = 3000;
  const DEFAULT_SERVER_LOCK_LEASE_MS = 25000;
  const DEFAULT_SEEN_EVENT_TTL_MS = 2 * 60 * 1000;

  const safeJsonParse = (value) => {
    if (typeof value !== "string" || !value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const toPositiveInt = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.trunc(num);
  };

  const createSourceId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `tab_${crypto.randomUUID()}`;
    }
    return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  };

  const extractContentVersion = (raw) => {
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? Math.trunc(raw) : null;
    }

    if (typeof raw === "string") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }

    if (Array.isArray(raw)) {
      if (!raw.length) return null;
      return extractContentVersion(raw[0]);
    }

    if (raw && typeof raw === "object") {
      const known =
        raw.get_content_version ??
        raw.content_version ??
        raw.value ??
        raw.version ??
        null;
      return extractContentVersion(known);
    }

    return null;
  };

  class UpdateSyncBus {
    constructor(options = {}) {
      this.channelName = options.channelName || DEFAULT_CHANNEL;
      this.eventName = options.eventName || DEFAULT_EVENT;
      this.lastUpdateKey = options.lastUpdateKey || LEGACY_LAST_UPDATE_KEY;
      this.lastPayloadKey = options.lastPayloadKey || LAST_UPDATE_PAYLOAD_KEY;
      this.contentVersionKey = options.contentVersionKey || CONTENT_VERSION_KEY;
      this.serverLockKey = options.serverLockKey || SERVER_LOCK_KEY;
      this.sourceId = options.sourceId || createSourceId();

      this.seenEvents = new Map();
      this.seenEventTtlMs = toPositiveInt(
        options.seenEventTtlMs,
        DEFAULT_SEEN_EVENT_TTL_MS
      );

      this.serverSyncEnabled = options.serverSyncEnabled !== false;
      this.serverPollIntervalMs = toPositiveInt(
        options.serverPollIntervalMs,
        DEFAULT_SERVER_POLL_INTERVAL_MS
      );
      this.serverMinGapMs = toPositiveInt(
        options.serverMinGapMs,
        DEFAULT_SERVER_MIN_GAP_MS
      );
      this.serverLockLeaseMs = toPositiveInt(
        options.serverLockLeaseMs,
        DEFAULT_SERVER_LOCK_LEASE_MS
      );

      this.listeners = new Set();
      this.channel = null;
      this.serverPollTimer = null;
      this.serverLockTimer = null;
      this.serverCheckInFlight = null;
      this.lastServerCheckAt = 0;
      this.isServerLeader = false;
      this.initialized = false;

      this.boundStorageHandler = null;
      this.boundCustomHandler = null;
      this.boundVisibilityHandler = null;
      this.boundOnlineHandler = null;
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
        if (!event || !event.key) return;

        if (event.key === this.lastPayloadKey && event.newValue) {
          this.handleIncoming(safeJsonParse(event.newValue), "storage");
          return;
        }

        if (event.key === this.lastUpdateKey && event.newValue) {
          this.handleIncoming(
            {
              type: "DATA_UPDATED",
              operation: "sync",
              itemType: "all",
              timestamp: Number(event.newValue) || Date.now(),
              sourceId: "legacy",
            },
            "storage"
          );
          return;
        }

        if (event.key === this.contentVersionKey && event.newValue) {
          const version = extractContentVersion(event.newValue);
          if (!Number.isFinite(version)) return;
          this.handleIncoming(
            {
              type: "DATA_UPDATED",
              operation: "sync",
              itemType: "all",
              timestamp: Date.now(),
              sourceId: "storage-content-version",
              contentVersion: version,
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

      this.boundVisibilityHandler = () => {
        if (document.hidden) return;
        this.requestServerCheck("visible", true);
      };
      document.addEventListener("visibilitychange", this.boundVisibilityHandler);

      this.boundOnlineHandler = () => {
        this.requestServerCheck("online", true);
      };
      window.addEventListener("online", this.boundOnlineHandler);

      this.startServerSync();
      this.requestServerCheck("init", true);
    }

    createPayload(payload = {}) {
      const timestamp = Number(payload.timestamp) || Date.now();
      const type = payload.type || "DATA_UPDATED";
      const sourceId = payload.sourceId || this.sourceId;
      const operation = payload.operation || "notify";
      const itemType = payload.itemType || "all";

      const contentVersion = extractContentVersion(
        payload.contentVersion ?? payload.version
      );

      const id =
        payload.id ||
        `${type}_${timestamp}_${itemType}_${operation}_${sourceId}_${
          Number.isFinite(contentVersion) ? contentVersion : "na"
        }`;

      return {
        ...payload,
        id,
        type,
        timestamp,
        sourceId,
        operation,
        itemType,
        contentVersion: Number.isFinite(contentVersion) ? contentVersion : undefined,
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
        payload.contentVersion || "",
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
      if (this.seenEvents.size > 180) {
        this.pruneSeenEvents();
      }
    }

    getStoredContentVersion() {
      try {
        return extractContentVersion(localStorage.getItem(this.contentVersionKey)) || 0;
      } catch {
        return 0;
      }
    }

    setStoredContentVersion(version) {
      const normalized = extractContentVersion(version);
      if (!Number.isFinite(normalized) || normalized < 0) return;
      try {
        localStorage.setItem(this.contentVersionKey, String(normalized));
      } catch {}
    }

    persistPayload(payload) {
      try {
        localStorage.setItem(this.lastUpdateKey, String(payload.timestamp));
      } catch {}

      try {
        localStorage.setItem(this.lastPayloadKey, JSON.stringify(payload));
      } catch {}

      if (Number.isFinite(payload.contentVersion)) {
        this.setStoredContentVersion(payload.contentVersion);
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
      this.persistPayload(payload);
      this.notifyListeners(payload);
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

    isServerSyncEnabled() {
      return this.serverSyncEnabled;
    }

    setServerSyncEnabled(enabled) {
      const nextState = Boolean(enabled);
      if (this.serverSyncEnabled === nextState) return;
      this.serverSyncEnabled = nextState;
      if (nextState) {
        this.startServerSync();
        this.requestServerCheck("enabled", true);
      } else {
        this.stopServerSync();
      }
    }

    setServerPollInterval(intervalMs) {
      this.serverPollIntervalMs = toPositiveInt(
        intervalMs,
        DEFAULT_SERVER_POLL_INTERVAL_MS
      );
      if (this.serverPollTimer) {
        this.stopServerPolling();
        this.startServerPolling();
      }
    }

    readServerLock() {
      try {
        return safeJsonParse(localStorage.getItem(this.serverLockKey));
      } catch {
        return null;
      }
    }

    writeServerLock(expiresAt) {
      const lock = {
        sourceId: this.sourceId,
        expiresAt: Number(expiresAt) || Date.now() + this.serverLockLeaseMs,
      };
      try {
        localStorage.setItem(this.serverLockKey, JSON.stringify(lock));
      } catch {}
      return lock;
    }

    updateLeaderState(isLeader) {
      if (this.isServerLeader === isLeader) return;
      this.isServerLeader = isLeader;
      if (isLeader) {
        this.startServerPolling();
      } else {
        this.stopServerPolling();
      }
    }

    acquireServerLock(force = false) {
      if (!this.serverSyncEnabled) {
        this.updateLeaderState(false);
        return false;
      }

      let lock = this.readServerLock();
      const now = Date.now();
      const isExpired =
        !lock ||
        !Number.isFinite(Number(lock.expiresAt)) ||
        Number(lock.expiresAt) <= now;
      const isMine = lock && lock.sourceId === this.sourceId;

      if (force || isMine || isExpired) {
        lock = this.writeServerLock(now + this.serverLockLeaseMs);
      }

      const haveLock = lock && lock.sourceId === this.sourceId;
      this.updateLeaderState(Boolean(haveLock));
      return Boolean(haveLock);
    }

    renewServerLock() {
      if (!this.isServerLeader) return;
      this.writeServerLock(Date.now() + this.serverLockLeaseMs);
    }

    releaseServerLock() {
      if (!this.isServerLeader) return;
      try {
        const lock = this.readServerLock();
        if (lock && lock.sourceId === this.sourceId) {
          localStorage.removeItem(this.serverLockKey);
        }
      } catch {}
      this.updateLeaderState(false);
    }

    startServerPolling() {
      if (this.serverPollTimer) {
        clearInterval(this.serverPollTimer);
      }
      this.serverPollTimer = setInterval(() => {
        this.requestServerCheck("interval");
      }, this.serverPollIntervalMs);
    }

    stopServerPolling() {
      if (this.serverPollTimer) {
        clearInterval(this.serverPollTimer);
        this.serverPollTimer = null;
      }
    }

    startServerSync() {
      if (!this.serverSyncEnabled) return;

      this.acquireServerLock(true);

      if (this.serverLockTimer) {
        clearInterval(this.serverLockTimer);
      }

      this.serverLockTimer = setInterval(() => {
        this.acquireServerLock();
        if (this.isServerLeader) {
          this.renewServerLock();
        }
      }, Math.max(3500, Math.floor(this.serverLockLeaseMs / 3)));
    }

    stopServerSync() {
      this.stopServerPolling();
      if (this.serverLockTimer) {
        clearInterval(this.serverLockTimer);
        this.serverLockTimer = null;
      }
      this.releaseServerLock();
    }

    async fetchServerContentVersion() {
      if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
        return null;
      }

      const url = `${window.SUPABASE_CONFIG.URL}/rest/v1/rpc/get_content_version`;
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), 10000)
        : null;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            apikey: window.SUPABASE_CONFIG.ANON_KEY,
            Authorization: `Bearer ${window.SUPABASE_CONFIG.ANON_KEY}`,
            "Content-Type": "application/json",
            Pragma: "no-cache",
            "Cache-Control": "no-store",
          },
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json().catch(() => null);
        const version = extractContentVersion(data);
        return Number.isFinite(version) && version >= 0 ? version : null;
      } catch {
        return null;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    async requestServerCheck(reason = "manual", force = false) {
      if (!this.serverSyncEnabled) return false;
      if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
        if (!force) return false;
      }

      if (!force) {
        if (!this.isServerLeader) return false;
        const now = Date.now();
        if (now - this.lastServerCheckAt < this.serverMinGapMs) return false;
      }

      if (this.serverCheckInFlight) {
        return this.serverCheckInFlight;
      }

      this.lastServerCheckAt = Date.now();
      this.serverCheckInFlight = (async () => {
        const version = await this.fetchServerContentVersion();
        if (!Number.isFinite(version)) return false;

        const previous = this.getStoredContentVersion();
        if (version <= previous) return false;

        this.setStoredContentVersion(version);
        this.publishDataUpdate("sync", "all", {
          source: "server",
          syncReason: reason,
          contentVersion: version,
          serverDriven: true,
          timestamp: Date.now(),
        });
        return true;
      })()
        .catch(() => false)
        .finally(() => {
          this.serverCheckInFlight = null;
        });

      return this.serverCheckInFlight;
    }

    close() {
      this.stopServerSync();

      if (this.boundStorageHandler) {
        window.removeEventListener("storage", this.boundStorageHandler);
        this.boundStorageHandler = null;
      }
      if (this.boundCustomHandler) {
        window.removeEventListener(this.eventName, this.boundCustomHandler);
        this.boundCustomHandler = null;
      }
      if (this.boundVisibilityHandler) {
        document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
        this.boundVisibilityHandler = null;
      }
      if (this.boundOnlineHandler) {
        window.removeEventListener("online", this.boundOnlineHandler);
        this.boundOnlineHandler = null;
      }
      if (this.channel) {
        try {
          this.channel.close();
        } catch {}
        this.channel = null;
      }

      this.listeners.clear();
      this.seenEvents.clear();
      this.initialized = false;
    }
  }

  const syncBus = new UpdateSyncBus();
  syncBus.init();

  if (typeof window !== "undefined") {
    window.addEventListener(
      "beforeunload",
      () => {
        try {
          syncBus.close();
        } catch {}
      },
      { once: true }
    );
  }

  global.TokeUpdateSync = syncBus;
})(window);
