
/* ================== update-sync.js ================== */
(function initTokeUpdateSync(global) {
  if (!global || global.TokeUpdateSync) return;

  const DEFAULT_CHANNEL = "toke_bakes_data_updates";
  const DEFAULT_EVENT = "toke:data-updated";
  const LEGACY_LAST_UPDATE_KEY = "toke_bakes_last_update";
  const LAST_UPDATE_PAYLOAD_KEY = "toke_bakes_last_update_payload";
  const CONTENT_VERSION_KEY = "toke_bakes_content_version";
  const LAST_CHANGE_TYPE_KEY = "toke_bakes_last_change_type";
  const SERVER_LOCK_KEY = "toke_bakes_sync_server_lock";

  const DEFAULT_SERVER_POLL_INTERVAL_MS = 35000;
  const MIN_SERVER_POLL_INTERVAL_MS = 30000;
  const MAX_SERVER_POLL_INTERVAL_MS = 45000;
  const DEFAULT_SERVER_MIN_GAP_MS = 9000;
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

  const clampPollInterval = (value, fallback = DEFAULT_SERVER_POLL_INTERVAL_MS) => {
    const parsed = toPositiveInt(value, fallback);
    return Math.min(MAX_SERVER_POLL_INTERVAL_MS, Math.max(MIN_SERVER_POLL_INTERVAL_MS, parsed));
  };

  const createSourceId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `tab_${crypto.randomUUID()}`;
    }
    return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  };

  const extractContentVersion = (raw) => {
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
    }

    if (typeof raw === "string") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
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

  const normalizeChangeType = (raw) => {
    const value = String(raw || "")
      .trim()
      .toLowerCase();
    if (!value) return "all";

    if (
      value === "menu_options" ||
      value === "menu-options" ||
      value === "menuoptions" ||
      value === "option" ||
      value === "options"
    ) {
      return "menu";
    }

    if (value === "site" || value === "settings") return "all";

    if (
      value === "all" ||
      value === "menu" ||
      value === "featured" ||
      value === "specials" ||
      value === "carousel" ||
      value === "theme"
    ) {
      return value;
    }

    return "all";
  };

  const parseUpdateSignal = (raw) => {
    if (!raw) return null;
    const first = Array.isArray(raw) ? raw[0] : raw;

    if (!first || typeof first !== "object") {
      const fallbackVersion = extractContentVersion(raw);
      if (!Number.isFinite(fallbackVersion)) return null;
      return {
        version: fallbackVersion,
        changeType: "all",
        updatedAtTs: 0,
      };
    }

    const version = extractContentVersion(
      first.content_version ??
        first.version ??
        first.get_content_version ??
        first.value ??
        null
    );
    if (!Number.isFinite(version)) return null;

    const updatedAtRaw = first.updated_at ?? first.updatedAt ?? null;
    const parsedDate = updatedAtRaw ? Date.parse(updatedAtRaw) : NaN;

    return {
      version,
      changeType: normalizeChangeType(
        first.last_change_type ?? first.change_type ?? first.item_type ?? "all"
      ),
      updatedAtTs: Number.isNaN(parsedDate) ? 0 : Math.trunc(parsedDate),
    };
  };

  class UpdateSyncBus {
    constructor(options = {}) {
      this.channelName = options.channelName || DEFAULT_CHANNEL;
      this.eventName = options.eventName || DEFAULT_EVENT;
      this.lastUpdateKey = options.lastUpdateKey || LEGACY_LAST_UPDATE_KEY;
      this.lastPayloadKey = options.lastPayloadKey || LAST_UPDATE_PAYLOAD_KEY;
      this.contentVersionKey = options.contentVersionKey || CONTENT_VERSION_KEY;
      this.lastChangeTypeKey = options.lastChangeTypeKey || LAST_CHANGE_TYPE_KEY;
      this.serverLockKey = options.serverLockKey || SERVER_LOCK_KEY;
      this.sourceId = options.sourceId || createSourceId();

      this.seenEvents = new Map();
      this.seenEventTtlMs = toPositiveInt(
        options.seenEventTtlMs,
        DEFAULT_SEEN_EVENT_TTL_MS
      );

      this.serverSyncEnabled = options.serverSyncEnabled !== false;
      this.serverPollIntervalMs = clampPollInterval(
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
      this.refreshHandlers = new Map();
      this.nextRefreshHandlerId = 0;
      this.channel = null;

      this.serverPollTimer = null;
      this.serverLockTimer = null;
      this.serverCheckInFlight = null;
      this.lastServerCheckAt = 0;
      this.lastServerCheckOkAt = 0;
      this.lastServerCheckReason = "";

      this.isServerLeader = false;
      this.syncMode = "polling";
      this.syncStatus = "active";
      this.initialized = false;

      this.boundStorageHandler = null;
      this.boundCustomHandler = null;
      this.boundVisibilityHandler = null;
      this.boundFocusHandler = null;
      this.boundOnlineHandler = null;

      this.realtimeClient = null;
      this.realtimeChannel = null;
      this.realtimeEnabled = false;

      this.appliedVersion = this.getStoredContentVersion();
      this.appliedChangeType = this.getStoredLastChangeType();
      this.pendingPayload = null;
      this.applyInFlight = null;
      this.indicatorHideTimer = null;
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
              sourceId: "legacy-storage",
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

      this.boundFocusHandler = () => {
        this.requestServerCheck("focus", true);
      };
      window.addEventListener("focus", this.boundFocusHandler);

      this.boundOnlineHandler = () => {
        this.requestServerCheck("online", true);
      };
      window.addEventListener("online", this.boundOnlineHandler);

      this.startServerSync();
      this.setupRealtimeSubscription();
      this.requestServerCheck("init", true);
    }
    createPayload(payload = {}) {
      const timestamp = Number(payload.timestamp) || Date.now();
      const type = payload.type || "DATA_UPDATED";
      const sourceId = payload.sourceId || this.sourceId;
      const operation = payload.operation || "notify";
      const itemType = normalizeChangeType(
        payload.itemType ?? payload.lastChangeType ?? payload.changeType ?? "all"
      );
      const lastChangeType = normalizeChangeType(
        payload.lastChangeType ?? itemType
      );

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
        lastChangeType,
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
        payload.lastChangeType || "",
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
      if (!Number.isFinite(normalized)) return;
      try {
        localStorage.setItem(this.contentVersionKey, String(normalized));
      } catch {}
    }

    getStoredLastChangeType() {
      try {
        return normalizeChangeType(localStorage.getItem(this.lastChangeTypeKey) || "all");
      } catch {
        return "all";
      }
    }

    setStoredLastChangeType(changeType) {
      try {
        localStorage.setItem(this.lastChangeTypeKey, normalizeChangeType(changeType));
      } catch {}
    }

    updateAppliedState(version, changeType = "all") {
      const normalizedVersion = extractContentVersion(version);
      if (!Number.isFinite(normalizedVersion)) return;

      this.appliedVersion = Math.max(this.appliedVersion || 0, normalizedVersion);
      this.appliedChangeType = normalizeChangeType(changeType);
      this.setStoredContentVersion(this.appliedVersion);
      this.setStoredLastChangeType(this.appliedChangeType);
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
      if (payload.lastChangeType) {
        this.setStoredLastChangeType(payload.lastChangeType);
      }
    }

    getStatus() {
      return {
        mode: this.syncMode,
        status: this.syncStatus,
        isLeader: this.isServerLeader,
        realtimeEnabled: this.realtimeEnabled,
        pollIntervalMs: this.serverPollIntervalMs,
        minGapMs: this.serverMinGapMs,
        lastServerCheckAt: this.lastServerCheckAt || 0,
        lastServerCheckOkAt: this.lastServerCheckOkAt || 0,
        lastServerCheckReason: this.lastServerCheckReason || "",
        contentVersion: this.getStoredContentVersion(),
        appliedVersion: this.appliedVersion || 0,
        lastChangeType: this.getStoredLastChangeType(),
        applying: Boolean(this.applyInFlight),
        pendingVersion: this.pendingPayload?.version || 0,
        refreshHandlerCount: this.refreshHandlers.size,
      };
    }

    notifyListeners(payload) {
      this.listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch {}
      });
    }

    async handleIncoming(rawPayload, transport = "unknown") {
      const payload = this.createPayload(rawPayload || {});
      payload.transport = payload.transport || transport;

      if (!this.shouldEmit(payload)) return;
      this.markSeen(payload);
      this.persistPayload(payload);
      this.notifyListeners(payload);

      if (payload.type === "DATA_UPDATED") {
        await this.handleVersionedUpdatePayload(payload);
      }
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

    registerRefreshHandler(handler, options = {}) {
      if (typeof handler !== "function") {
        return () => {};
      }

      const providedId = String(options.id || "").trim();
      const handlerId =
        providedId || `refresh_handler_${(this.nextRefreshHandlerId += 1)}`;
      const priority = Number(options.priority) || 0;
      const showIndicator = options.showIndicator !== false;

      const normalizedTypes = Array.isArray(options.changeTypes)
        ? new Set(options.changeTypes.map((type) => normalizeChangeType(type)))
        : null;

      this.refreshHandlers.set(handlerId, {
        id: handlerId,
        fn: handler,
        priority,
        showIndicator,
        changeTypes: normalizedTypes,
      });

      this.requestServerCheck("handler-registered", true);

      return () => {
        this.refreshHandlers.delete(handlerId);
      };
    }

    registerUpdateHandler(handler, options = {}) {
      return this.registerRefreshHandler(handler, options);
    }
    shouldRenderIndicator() {
      if (!this.refreshHandlers.size) return false;
      for (const entry of this.refreshHandlers.values()) {
        if (entry.showIndicator !== false) return true;
      }
      return false;
    }

    ensureIndicatorElement() {
      if (!this.shouldRenderIndicator()) return null;

      let indicator = document.getElementById("sync-status-indicator");
      if (!indicator && document.body) {
        indicator = document.createElement("div");
        indicator.id = "sync-status-indicator";
        indicator.setAttribute("aria-live", "polite");
        indicator.style.display = "none";
        document.body.appendChild(indicator);
      }
      return indicator;
    }

    clearIndicatorTimers() {
      if (this.indicatorHideTimer) {
        clearTimeout(this.indicatorHideTimer);
        this.indicatorHideTimer = null;
      }
    }

    showIndicator(state) {
      const indicator = this.ensureIndicatorElement();
      if (!indicator) return;

      this.clearIndicatorTimers();
      indicator.style.display = "";
      indicator.className = "";
      indicator.classList.add("is-visible");

      if (state === "syncing") {
        indicator.classList.add("syncing");
        indicator.textContent = "\u27F3";
        indicator.title = "Updating content...";
        return;
      }

      if (state === "error") {
        indicator.classList.add("error");
        indicator.textContent = "!";
        indicator.title = "Update failed";
        this.indicatorHideTimer = setTimeout(() => this.hideIndicator(), 2500);
      }
    }

    hideIndicator() {
      this.clearIndicatorTimers();
      const indicator = document.getElementById("sync-status-indicator");
      if (!indicator) return;
      indicator.style.display = "none";
      indicator.className = "";
      indicator.textContent = "";
      indicator.title = "";
    }

    shouldRunHandlerForChangeType(handlerEntry, changeType) {
      if (!handlerEntry?.changeTypes || handlerEntry.changeTypes.size === 0) {
        return true;
      }
      const normalized = normalizeChangeType(changeType);
      if (handlerEntry.changeTypes.has("all")) return true;
      if (normalized === "all") return true;
      return handlerEntry.changeTypes.has(normalized);
    }

    async runRefreshHandlers(payload) {
      if (!this.refreshHandlers.size) return;

      const sortedHandlers = Array.from(this.refreshHandlers.values()).sort(
        (a, b) => b.priority - a.priority
      );

      for (const entry of sortedHandlers) {
        if (!this.shouldRunHandlerForChangeType(entry, payload.changeType)) {
          continue;
        }
        await Promise.resolve(entry.fn(payload));
      }
    }

    queuePendingPayload(payload, version) {
      const nextVersion = extractContentVersion(version);
      if (!Number.isFinite(nextVersion)) return;

      if (!this.pendingPayload || nextVersion > this.pendingPayload.version) {
        this.pendingPayload = { payload, version: nextVersion };
        return;
      }

      if (nextVersion === this.pendingPayload.version) {
        const pendingTs = Number(this.pendingPayload.payload?.timestamp || 0);
        const incomingTs = Number(payload?.timestamp || 0);
        if (incomingTs > pendingTs) {
          this.pendingPayload = { payload, version: nextVersion };
        }
      }
    }

    async applyVersionedPayload(payload, version, changeType) {
      const normalizedVersion = extractContentVersion(version);
      if (!Number.isFinite(normalizedVersion)) return false;

      if (normalizedVersion <= this.appliedVersion) {
        return false;
      }

      if (this.applyInFlight) {
        this.queuePendingPayload(payload, normalizedVersion);
        return false;
      }

      const normalizedChangeType = normalizeChangeType(changeType || "all");
      const applyPayload = {
        ...payload,
        contentVersion: normalizedVersion,
        changeType: normalizedChangeType,
      };

      this.applyInFlight = (async () => {
        try {
          try {
            window.dispatchEvent(
              new CustomEvent("tb:update-syncing", {
                detail: {
                  contentVersion: normalizedVersion,
                  changeType: normalizedChangeType,
                  payload: applyPayload,
                },
              })
            );
          } catch {}
          if (this.shouldRenderIndicator()) {
            this.showIndicator("syncing");
          }

          await this.runRefreshHandlers(applyPayload);
          this.updateAppliedState(normalizedVersion, normalizedChangeType);
          this.hideIndicator();

          try {
            window.dispatchEvent(
              new CustomEvent("tb:update-applied", {
                detail: {
                  contentVersion: normalizedVersion,
                  changeType: normalizedChangeType,
                  payload: applyPayload,
                },
              })
            );
          } catch {}

          return true;
        } catch {
          if (this.shouldRenderIndicator()) {
            this.showIndicator("error");
          }
          try {
            window.dispatchEvent(
              new CustomEvent("tb:update-failed", {
                detail: {
                  contentVersion: normalizedVersion,
                  changeType: normalizedChangeType,
                  payload: applyPayload,
                },
              })
            );
          } catch {}
          return false;
        } finally {
          this.applyInFlight = null;

          const queued = this.pendingPayload;
          this.pendingPayload = null;
          if (queued && queued.version > this.appliedVersion) {
            this.applyVersionedPayload(
              queued.payload,
              queued.version,
              queued.payload?.lastChangeType || queued.payload?.itemType || "all"
            );
          }
        }
      })();

      return this.applyInFlight;
    }

    async handleVersionedUpdatePayload(payload) {
      const remoteVersion = extractContentVersion(
        payload.contentVersion ?? payload.version
      );
      const remoteChangeType = normalizeChangeType(
        payload.lastChangeType ?? payload.itemType ?? "all"
      );

      if (!Number.isFinite(remoteVersion)) {
        this.requestServerCheck("payload-missing-version", true);
        return false;
      }

      if (remoteVersion <= this.appliedVersion) {
        this.setStoredLastChangeType(remoteChangeType);
        return false;
      }

      return this.applyVersionedPayload(payload, remoteVersion, remoteChangeType);
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
      this.serverPollIntervalMs = clampPollInterval(
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
      this.syncStatus = isLeader ? "active" : "standby";
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

      this.syncMode = this.realtimeEnabled ? "realtime+polling" : "polling";
      this.syncStatus = "starting";

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
      this.syncStatus = "disabled";
    }

    setupRealtimeSubscription() {
      if (this.realtimeEnabled) return true;

      const supabaseGlobal =
        global.supabase ||
        global.Supabase ||
        global.supabaseJs ||
        null;
      const createClient = supabaseGlobal?.createClient;
      if (typeof createClient !== "function") {
        return false;
      }

      if (!global.SUPABASE_CONFIG?.URL || !global.SUPABASE_CONFIG?.ANON_KEY) {
        return false;
      }

      try {
        this.realtimeClient = createClient(
          global.SUPABASE_CONFIG.URL,
          global.SUPABASE_CONFIG.ANON_KEY,
          {
            auth: { persistSession: false, autoRefreshToken: false },
          }
        );

        const channel = this.realtimeClient
          .channel("tb-content-version")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "site_metadata",
              filter: "key=eq.content_version",
            },
            (payload) => {
              try {
                const next = payload?.new || payload?.record || null;
                const version = extractContentVersion(
                  next?.version ?? next?.value ?? null
                );
                if (!Number.isFinite(version)) return;
                const changeType = normalizeChangeType(
                  next?.last_change_type ?? next?.change_type ?? "all"
                );
                const updatedAtRaw = next?.updated_at || null;
                const parsedUpdatedAt = updatedAtRaw ? Date.parse(updatedAtRaw) : NaN;

                this.publishDataUpdate("sync", changeType, {
                  source: "realtime",
                  serverDriven: true,
                  contentVersion: version,
                  lastChangeType: changeType,
                  timestamp: Number.isNaN(parsedUpdatedAt)
                    ? Date.now()
                    : Math.trunc(parsedUpdatedAt),
                });
              } catch {}
            }
          )
          .subscribe();

        this.realtimeChannel = channel;
        this.realtimeEnabled = true;
        this.syncMode = "realtime+polling";
        return true;
      } catch {
        this.realtimeClient = null;
        this.realtimeChannel = null;
        this.realtimeEnabled = false;
        return false;
      }
    }

    teardownRealtimeSubscription() {
      if (this.realtimeClient && this.realtimeChannel) {
        try {
          this.realtimeClient.removeChannel(this.realtimeChannel);
        } catch {}
      }
      this.realtimeChannel = null;
      this.realtimeClient = null;
      this.realtimeEnabled = false;
    }
    async fetchServerUpdateSignal() {
      if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
        return null;
      }

      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), 10000)
        : null;

      try {
        const response = await fetch(
          `${window.SUPABASE_CONFIG.URL}/rest/v1/rpc/get_update_signal`,
          {
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
          }
        );

        if (!response.ok) {
          const legacyResponse = await fetch(
            `${window.SUPABASE_CONFIG.URL}/rest/v1/rpc/get_content_version`,
            {
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
            }
          );
          if (!legacyResponse.ok) {
            return null;
          }
          const legacyData = await legacyResponse.json().catch(() => null);
          const legacyVersion = extractContentVersion(legacyData);
          if (!Number.isFinite(legacyVersion)) {
            return null;
          }
          return {
            version: legacyVersion,
            changeType: "all",
            updatedAtTs: 0,
          };
        }

        const data = await response.json().catch(() => null);
        const parsed = parseUpdateSignal(data);
        if (!parsed || !Number.isFinite(parsed.version)) {
          return null;
        }
        return parsed;
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
      this.lastServerCheckReason = String(reason || "");

      this.serverCheckInFlight = (async () => {
        const signal = await this.fetchServerUpdateSignal();
        if (!signal || !Number.isFinite(signal.version)) return false;

        const version = Math.max(0, Math.trunc(signal.version));
        const changeType = normalizeChangeType(signal.changeType || "all");
        const signalTimestamp =
          Number.isFinite(signal.updatedAtTs) && signal.updatedAtTs > 0
            ? Math.trunc(signal.updatedAtTs)
            : Date.now();

        this.lastServerCheckOkAt = Date.now();

        if (version <= this.appliedVersion) {
          this.setStoredContentVersion(Math.max(version, this.appliedVersion));
          this.setStoredLastChangeType(changeType);
          return false;
        }

        this.publishDataUpdate("sync", changeType, {
          source: "server",
          syncReason: reason,
          contentVersion: version,
          lastChangeType: changeType,
          serverDriven: true,
          timestamp: signalTimestamp,
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
      this.teardownRealtimeSubscription();

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
      if (this.boundFocusHandler) {
        window.removeEventListener("focus", this.boundFocusHandler);
        this.boundFocusHandler = null;
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

      this.clearIndicatorTimers();
      this.listeners.clear();
      this.refreshHandlers.clear();
      this.seenEvents.clear();
      this.pendingPayload = null;
      this.applyInFlight = null;
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
