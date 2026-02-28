/* ==================== THEME MANAGER - UPDATED FOR AUTO-UPDATE ==================== */
const THEME_DEBUG = false;
const themeDebugLog = (...args) => {
  if (THEME_DEBUG) console.log(...args);
};
const themeDebugWarn = (...args) => {
  if (THEME_DEBUG) console.warn(...args);
};
const THEME_STORAGE_KEYS = {
  legacyCss: "toke_bakes_css_theme",
  legacyLogo: "toke_bakes_theme_logo",
  legacyUpdated: "toke_bakes_theme_last_update",
  globalCss: "toke_bakes_global_theme_css",
  globalLogo: "toke_bakes_global_theme_logo",
  globalUpdated: "toke_bakes_global_theme_updated_at",
  localCheck: "my_theme_check",
};
const ThemeManager = {
  currentTheme: "styles/style.css",
  currentMode: "light",
  currentLogo: "images/logo.webp",
  lastThemeUpdate: 0,
  lastDbCheck: 0,
  dbCheckInterval: 60000,
  spaHooksBound: false,
  themeSyncUnsubscribe: null,
  themeLoadingTimer: null,
  systemModeMedia: null,
  systemModeHandler: null,

  /* ================== INITIALIZATION ================== */
  init() {
    themeDebugLog("?? Theme Manager Initialized - FIXED VERSION");

    // Load saved preferences
    const savedThemeRaw =
      localStorage.getItem(THEME_STORAGE_KEYS.globalCss) ||
      localStorage.getItem(THEME_STORAGE_KEYS.legacyCss) ||
      "styles/style.css";
    const savedTheme = this.fixLegacyThemePath(
      this.normalizeAssetPath(savedThemeRaw) || "styles/style.css"
    );
    const savedModeRaw = localStorage.getItem("toke_bakes_theme_mode");
    if (
      savedModeRaw &&
      savedModeRaw !== "light" &&
      savedModeRaw !== "dark"
    ) {
      try {
        localStorage.removeItem("toke_bakes_theme_mode");
      } catch {}
    }
    const savedMode = this.resolveMode(savedModeRaw);
    if (savedThemeRaw !== savedTheme) {
      localStorage.setItem(THEME_STORAGE_KEYS.legacyCss, savedTheme);
      localStorage.setItem(THEME_STORAGE_KEYS.globalCss, savedTheme);
    }
    const savedLogo =
      localStorage.getItem(THEME_STORAGE_KEYS.globalLogo) ||
      localStorage.getItem(THEME_STORAGE_KEYS.legacyLogo) ||
      this.getLogoForTheme(savedTheme);

    this.currentTheme = savedTheme;
    this.currentMode = savedMode;
    this.currentLogo = savedLogo;

    // Apply dark/light mode
    document.documentElement.setAttribute("data-theme", savedMode);
    try {
      document.documentElement.style.colorScheme = savedMode;
    } catch {}

    // Follow device theme when user hasn't explicitly chosen a mode.
    this.bindSystemModeListener();

    // Apply saved theme WITHOUT modifying the path
    this.applyTheme(savedTheme, false, false, { logoFile: savedLogo });

    // Setup admin panel
    if (this.isAdminPanel()) {
      this.setupAdminListeners();
      this.updateAdminUI(savedTheme);
    }

    // Setup dark/light toggle
    this.setupModeToggle();

    // Initialize footer with saved mode
    this.updateFooterTheme(savedMode);

    // Setup theme auto-update detection
    this.setupThemeAutoUpdate();

    // Keep themed assets (logo/footer/toggle) in sync after SPA DOM swaps
    this.bindSpaReapplyHooks();

    // Sync with database active theme on startup
    this.fetchActiveThemeFromDatabase(true).then((dbTheme) => {
      const dbCandidate = this.buildThemeCandidateFromRecord(dbTheme);
      if (dbCandidate && this.shouldApplyDbCandidate(dbCandidate)) {
        this.applyTheme(dbCandidate.cssFile, false, false, {
          logoFile: dbCandidate.logoFile,
          persist: true,
          timestampOverride: dbCandidate.timestamp,
          updatedAt: dbTheme.updated_at,
        });
      }
    });
  },

  /* ================== NEW: THEME AUTO-UPDATE SYSTEM ================== */
  setupThemeAutoUpdate() {
    // Check for theme updates periodically without over-polling low-end devices.
    setInterval(() => this.checkForThemeUpdates(), 15000);

    // Also check when page becomes visible
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.checkForThemeUpdates();
      }
    });

    // Listen for theme updates via shared sync bus
    if (
      window.TokeUpdateSync &&
      typeof window.TokeUpdateSync.subscribe === "function"
    ) {
      if (this.themeSyncUnsubscribe) {
        try {
          this.themeSyncUnsubscribe();
        } catch {}
        this.themeSyncUnsubscribe = null;
      }

      this.themeSyncUnsubscribe = window.TokeUpdateSync.subscribe((payload) => {
        // Direct theme change broadcast
        if (payload?.type === "THEME_CHANGED") {
          if (payload.sourceId === window.TokeUpdateSync.sourceId) return;
          themeDebugLog("?? Theme update received via shared sync bus");
          this.applyTheme(payload.themeFile, false, false, {
            logoFile: payload.logoFile || null,
            persist: true,
            timestampOverride: payload.timestamp,
          });
          return;
        }

        // Fallback: react to generic data-updated events for theme
        if (payload?.type === "DATA_UPDATED" && payload?.itemType === "theme") {
          const ts = Number(payload.timestamp) || Date.now();
          themeDebugLog("?? Theme data update received", payload);
          // Force a DB + local re-check so other devices update immediately
          localStorage.setItem(THEME_STORAGE_KEYS.legacyUpdated, String(ts));
          localStorage.setItem(THEME_STORAGE_KEYS.globalUpdated, String(ts));
          localStorage.setItem(THEME_STORAGE_KEYS.localCheck, "0");
          this.checkForThemeUpdates(true);
        }
      });
    } else if (typeof BroadcastChannel !== "undefined") {
      // Legacy BroadcastChannel fallback
      try {
        this.themeChannel = new BroadcastChannel("toke_bakes_theme_updates");
        this.themeChannel.onmessage = (event) => {
          if (event?.data?.type === "THEME_CHANGED") {
            themeDebugLog("?? Theme update received via BroadcastChannel");
            this.applyTheme(event.data.themeFile, false, false, {
              logoFile: event.data.logoFile || null,
              persist: true,
              timestampOverride: event.data.timestamp,
            });
          }
        };
      } catch (error) {
        themeDebugWarn("Theme BroadcastChannel unavailable:", error);
        this.themeChannel = null;
      }
    }

    // Check localStorage + database for theme updates
    this.checkForThemeUpdates();
  },

  async checkForThemeUpdates(force = false) {
    if (!force && document.hidden) return false;

    // DB remains the source of truth for active theme.
    const dbTheme = await this.fetchActiveThemeFromDatabase(force);
    const dbCandidate = this.buildThemeCandidateFromRecord(dbTheme);
    if (dbCandidate) {
      if (this.shouldApplyDbCandidate(dbCandidate)) {
        this.applyTheme(dbCandidate.cssFile, false, false, {
          logoFile: dbCandidate.logoFile,
          persist: true,
          timestampOverride: dbCandidate.timestamp,
          updatedAt: dbTheme.updated_at,
        });
        return true;
      }
      this.syncThemeSnapshotStorage(
        dbCandidate.cssFile,
        dbCandidate.logoFile,
        dbCandidate.timestamp
      );
    }

    // Local fallback for in-tab/broadcast updates while offline.
    const lastUpdate = Math.max(
      Number(localStorage.getItem(THEME_STORAGE_KEYS.globalUpdated) || "0"),
      Number(localStorage.getItem(THEME_STORAGE_KEYS.legacyUpdated) || "0")
    );
    const myLastCheck = Number(
      localStorage.getItem(THEME_STORAGE_KEYS.localCheck) || "0"
    );

    if (lastUpdate > myLastCheck) {
      themeDebugLog("?? Theme snapshot update detected!");
      const newTheme = this.fixLegacyThemePath(
        this.normalizeAssetPath(
          localStorage.getItem(THEME_STORAGE_KEYS.globalCss) ||
            localStorage.getItem(THEME_STORAGE_KEYS.legacyCss) ||
            "styles/style.css"
        ) || "styles/style.css"
      );
      const newLogo =
        this.normalizeAssetPath(
          localStorage.getItem(THEME_STORAGE_KEYS.globalLogo) ||
            localStorage.getItem(THEME_STORAGE_KEYS.legacyLogo)
        ) || this.getLogoForTheme(newTheme);

      localStorage.setItem(THEME_STORAGE_KEYS.localCheck, String(lastUpdate));

      if (newTheme !== this.currentTheme || newLogo !== this.currentLogo) {
        this.applyTheme(newTheme, false, false, {
          logoFile: newLogo,
          persist: true,
          timestampOverride: lastUpdate,
        });
        return true;
      }
    }

    return false;
  },

  /* ================== FIXED: APPLY THEME FUNCTION ================== */
  applyTheme(cssFile, saveToStorage = true, isAdminChange = false, options = {}) {
    themeDebugLog("?? Applying theme:", cssFile, "isAdminChange:", isAdminChange);

    const {
      logoFile = null,
      persist = false,
      updatedAt = null,
      timestampOverride = null,
    } = options || {};
    const normalizedCssFile = this.fixLegacyThemePath(
      this.normalizeAssetPath(cssFile) || "styles/style.css"
    );
    const resolvedLogo = this.resolveLogoFile(normalizedCssFile, logoFile);

    // ?? CRITICAL FIX: DO NOT modify the cssFile path here!
    this.currentTheme = normalizedCssFile;
    this.currentLogo = resolvedLogo;

    // Save to localStorage (exact path)
    let timestamp = localStorage.getItem(THEME_STORAGE_KEYS.globalUpdated) || "";
    const shouldPersist = saveToStorage || persist;
    if (shouldPersist) {
      localStorage.setItem(THEME_STORAGE_KEYS.legacyCss, normalizedCssFile);
      localStorage.setItem(THEME_STORAGE_KEYS.globalCss, normalizedCssFile);
      localStorage.setItem(THEME_STORAGE_KEYS.legacyLogo, resolvedLogo);
      localStorage.setItem(THEME_STORAGE_KEYS.globalLogo, resolvedLogo);

      const parsedTimestamp = Number(timestampOverride);
      const parsed = updatedAt ? Date.parse(updatedAt) : NaN;
      const existingTs = this.getStoredThemeTimestamp();
      let candidateTs = 0;
      if (Number.isFinite(parsedTimestamp) && parsedTimestamp > 0) {
        candidateTs = Math.trunc(parsedTimestamp);
      } else if (!Number.isNaN(parsed) && parsed > 0) {
        candidateTs = Math.trunc(parsed);
      } else {
        candidateTs = Date.now();
      }
      timestamp = `${Math.max(existingTs, candidateTs)}`;
      localStorage.setItem(THEME_STORAGE_KEYS.legacyUpdated, timestamp);
      localStorage.setItem(THEME_STORAGE_KEYS.globalUpdated, timestamp);
      localStorage.setItem(THEME_STORAGE_KEYS.localCheck, timestamp);

      // Broadcast to other tabs if admin is making the change
      if (isAdminChange) {
        const tsNumber = Number(timestamp) || Date.now();
        const themeName = this.getThemeName(normalizedCssFile);

        if (
          window.TokeUpdateSync &&
          typeof window.TokeUpdateSync.publish === "function"
        ) {
          window.TokeUpdateSync.publish({
            type: "THEME_CHANGED",
            themeFile: normalizedCssFile,
            logoFile: resolvedLogo,
            themeName,
            timestamp: tsNumber,
            source: "admin-theme",
          });
        } else if (this.themeChannel) {
          this.themeChannel.postMessage({
            type: "THEME_CHANGED",
            themeFile: normalizedCssFile,
            logoFile: resolvedLogo,
            themeName,
            timestamp: tsNumber,
          });
        }
      }
    }

    // Apply theme CSS - Use exact path without modification
    try {
      const link = document.getElementById("theme-stylesheet");
      if (link) {
        const cacheSuffix = timestamp ? `?v=${timestamp}` : "";
        const nextHref = `${normalizedCssFile}${cacheSuffix}`;

        if (link.getAttribute("href") !== nextHref) {
          document.documentElement.classList.add("theme-loading");
          link.dataset.loaded = "false";

          const onLoad = () => {
            if (this.themeLoadingTimer) {
              clearTimeout(this.themeLoadingTimer);
              this.themeLoadingTimer = null;
            }
            link.dataset.loaded = "true";
            document.documentElement.classList.remove("theme-loading");
            window.dispatchEvent(new CustomEvent("theme:ready"));
          };
          const onError = () => {
            if (this.themeLoadingTimer) {
              clearTimeout(this.themeLoadingTimer);
              this.themeLoadingTimer = null;
            }
            link.dataset.loaded = "true";
            document.documentElement.classList.remove("theme-loading");
            window.dispatchEvent(new CustomEvent("theme:ready"));
          };

          link.addEventListener("load", onLoad, { once: true });
          link.addEventListener("error", onError, { once: true });
          link.href = nextHref;

          if (this.themeLoadingTimer) {
            clearTimeout(this.themeLoadingTimer);
          }
          this.themeLoadingTimer = setTimeout(() => {
            document.documentElement.classList.remove("theme-loading");
            this.themeLoadingTimer = null;
          }, 4000);
          themeDebugLog("Theme CSS updated to:", nextHref);
        } else {
          if (this.themeLoadingTimer) {
            clearTimeout(this.themeLoadingTimer);
            this.themeLoadingTimer = null;
          }
          link.dataset.loaded = "true";
          document.documentElement.classList.remove("theme-loading");
          window.dispatchEvent(new CustomEvent("theme:ready"));
        }
      }
    } catch (error) {
      console.error("Error applying theme:", error);
    }

    // Update theme logo
    this.updateThemeLogo(resolvedLogo);

    // Update footer to match current mode
    this.updateFooterTheme(this.currentMode);

    // Update admin UI
    if (this.isAdminPanel()) {
      this.updateAdminUI(normalizedCssFile);
    }

    // Persist theme choice to database when admin activates a theme
    if (isAdminChange) {
      this.persistThemeToDatabase(normalizedCssFile, resolvedLogo).catch((error) => {
        themeDebugWarn("Theme database update failed:", error);
      });
    }

    // Show notification ONLY for admin theme changes (not dark/light toggle)
    if (
      typeof showNotification === "function" &&
      normalizedCssFile !== "styles/style.css" &&
      isAdminChange
    ) {
      showNotification(
        `${this.getThemeName(
          normalizedCssFile
        )} theme activated! Visitors will see this change automatically.`,
        "success"
      );
    }

    return true;
  },

  getStoredThemeTimestamp() {
    const stored = Math.max(
      Number(localStorage.getItem(THEME_STORAGE_KEYS.globalUpdated) || "0"),
      Number(localStorage.getItem(THEME_STORAGE_KEYS.legacyUpdated) || "0")
    );
    return Number.isFinite(stored) && stored > 0 ? Math.trunc(stored) : 0;
  },

  getRecordTimestamp(updatedAt) {
    const parsed = Date.parse(updatedAt || "");
    return Number.isNaN(parsed) || parsed <= 0 ? 0 : Math.trunc(parsed);
  },

  buildThemeCandidateFromRecord(record) {
    if (!record || !record.css_file) return null;
    const cssFile = this.fixLegacyThemePath(
      this.normalizeAssetPath(record.css_file) || "styles/style.css"
    );
    const logoFile = this.resolveLogoFile(cssFile, record.logo_file);
    const timestamp = this.getRecordTimestamp(record.updated_at);
    return { cssFile, logoFile, timestamp };
  },

  shouldApplyDbCandidate(candidate) {
    if (!candidate) return false;
    const differs =
      candidate.cssFile !== this.currentTheme || candidate.logoFile !== this.currentLogo;
    if (differs) return true;
    const localTs = this.getStoredThemeTimestamp();
    return candidate.timestamp > localTs;
  },

  syncThemeSnapshotStorage(cssFile, logoFile, timestamp = 0) {
    const normalizedCss = this.fixLegacyThemePath(
      this.normalizeAssetPath(cssFile) || "styles/style.css"
    );
    const normalizedLogo = this.resolveLogoFile(normalizedCss, logoFile);
    const ts = Number(timestamp);
    const timestampString =
      Number.isFinite(ts) && ts > 0
        ? String(Math.trunc(ts))
        : String(this.getStoredThemeTimestamp());

    try {
      localStorage.setItem(THEME_STORAGE_KEYS.legacyCss, normalizedCss);
      localStorage.setItem(THEME_STORAGE_KEYS.globalCss, normalizedCss);
      localStorage.setItem(THEME_STORAGE_KEYS.legacyLogo, normalizedLogo);
      localStorage.setItem(THEME_STORAGE_KEYS.globalLogo, normalizedLogo);
      if (timestampString && Number(timestampString) > 0) {
        localStorage.setItem(THEME_STORAGE_KEYS.legacyUpdated, timestampString);
        localStorage.setItem(THEME_STORAGE_KEYS.globalUpdated, timestampString);
        localStorage.setItem(THEME_STORAGE_KEYS.localCheck, timestampString);
      }
    } catch {}
  },

  /* ================== FIXED: ADMIN THEME ACTIVATION ================== */
  setupAdminListeners() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-activate-theme");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();

        const card = btn.closest(".theme-card");
        if (card && card.dataset.themeFile) {
          // ?? CRITICAL: Use the exact theme file from data attribute
          // Admin panel cards MUST have correct paths like "styles/style.css"
          const themeFile = card.dataset.themeFile;
          const logoFile =
            card.dataset.themeLogo || this.getLogoForTheme(themeFile);
          themeDebugLog("Admin theme activation:", themeFile);
          this.applyTheme(themeFile, true, true, { logoFile });
        }
      }
    });
  },

  /* ================== THEME LOGOS + DB SYNC ================== */
  getLogoForTheme(cssFile) {
    const logos = {
      "styles/style.css": "images/logo.webp",
      "styles/theme-valentine.css": "images/valantine-logo.webp",
      "styles/theme-ramadan.css": "images/ramadan-logo.webp",
      "styles/theme-halloween.css": "images/halloween-logo.webp",
      "styles/theme-independenceday.css": "images/independence-day-logo.webp",
      "styles/theme-christmas.css": "images/christmas-logo.webp",
    };
    return logos[cssFile] || "images/logo.webp";
  },

  normalizeAssetPath(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .trim()
      .replace(/\s+\.(?=[a-z0-9]+($|\?))/gi, ".");
  },

  getSystemMode() {
    try {
      if (
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark";
      }
    } catch {}
    return "light";
  },

  resolveMode(value) {
    const mode = (value || "").toString().trim().toLowerCase();
    if (mode === "dark" || mode === "light") {
      return mode;
    }
    return this.getSystemMode();
  },

  bindSystemModeListener() {
    if (this.systemModeMedia || this.systemModeHandler) return;
    if (typeof window === "undefined" || !window.matchMedia) return;

    let media = null;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      media = null;
    }
    if (!media) return;

    this.systemModeMedia = media;
    this.systemModeHandler = () => {
      let stored = null;
      try {
        stored = localStorage.getItem("toke_bakes_theme_mode");
      } catch {}
      if (stored === "dark" || stored === "light") {
        return;
      }

      const next = media.matches ? "dark" : "light";
      if (next === this.currentMode) return;

      this.currentMode = next;
      document.documentElement.setAttribute("data-theme", next);
      try {
        document.documentElement.style.colorScheme = next;
      } catch {}
      this.updateModeToggleUI();
      this.updateFooterTheme(next);
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", this.systemModeHandler);
    } else if (typeof media.addListener === "function") {
      media.addListener(this.systemModeHandler);
    }
  },

  resolveLogoFile(cssFile, logoFile) {
    const cleanedLogo = this.normalizeAssetPath(logoFile);
    if (cleanedLogo) {
      return cleanedLogo;
    }
    return this.getLogoForTheme(cssFile);
  },

  updateThemeLogo(logoFile) {
    const normalizedLogo = this.normalizeAssetPath(logoFile);
    if (!normalizedLogo) return;
    const logoTargets = document.querySelectorAll(
      "[data-theme-logo], img.logo-sm, img.hero-logo, img.admin-logo, #loader img, .brand img"
    );
    logoTargets.forEach((img) => {
      if (img && img.getAttribute("src") !== normalizedLogo) {
        img.setAttribute("src", normalizedLogo);
      }
    });
  },

  bindSpaReapplyHooks() {
    if (this.spaHooksBound) return;
    this.spaHooksBound = true;

    const reapply = () => {
      this.updateThemeLogo(this.currentLogo);
      this.updateFooterTheme(this.currentMode);
      this.setupModeToggle();
    };

    window.addEventListener("spa:navigated", () => {
      requestAnimationFrame(reapply);
    });
    window.addEventListener("spa:reinitialized", () => {
      requestAnimationFrame(reapply);
    });
  },

  getThemeRecordName(cssFile) {
    const themeKeys = {
      "styles/style.css": "Default",
      "styles/theme-valentine.css": "Valentine",
      "styles/theme-ramadan.css": "Ramadan",
      "styles/theme-halloween.css": "Halloween",
      "styles/theme-independenceday.css": "Independence Day",
      "styles/theme-christmas.css": "Christmas",
    };
    return themeKeys[cssFile] || null;
  },

  async getAdminAccessToken() {
    if (window.AdminSession && window.AdminSession.getAccessToken) {
      return window.AdminSession.getAccessToken();
    }

    // Fallback: read Supabase auth session from localStorage (mobile browsers)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("supabase") && key.endsWith("auth-token")) {
          const raw = localStorage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : null;
          const accessToken =
            parsed?.currentSession?.access_token ||
            parsed?.access_token ||
            parsed?.currentSession?.accessToken;
          if (accessToken) return accessToken;
        }
        if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
          const raw = localStorage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : null;
          const accessToken =
            parsed?.currentSession?.access_token ||
            parsed?.access_token ||
            parsed?.currentSession?.accessToken;
          if (accessToken) return accessToken;
        }
      }
    } catch (error) {
      themeDebugWarn("Supabase localStorage token lookup failed:", error);
    }

    try {
      const raw = sessionStorage.getItem("secure_session");
      if (raw) {
        const parsed = JSON.parse(atob(raw));
        return parsed && parsed.access_token ? parsed.access_token : null;
      }
    } catch (error) {
      themeDebugWarn("Admin token read failed:", error);
    }

    return null;
  },

  async persistThemeToDatabase(cssFile, logoFile) {
    if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
      return false;
    }

    const accessToken = await this.getAdminAccessToken();
    if (!accessToken) {
      themeDebugWarn("No admin access token available for theme update.");
      return false;
    }

    const themeName = this.getThemeRecordName(cssFile);
    if (!themeName) {
      themeDebugWarn("Unknown theme name for:", cssFile);
      return false;
    }

    const baseHeaders = {
      apikey: SUPABASE_CONFIG.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const deactivateUrl = `${SUPABASE_CONFIG.URL}/rest/v1/website_themes`;
    // Force all themes inactive first (avoids unique is_active index conflicts)
    await fetch(`${deactivateUrl}?is_active=eq.true`, {
      method: "PATCH",
      headers: { ...baseHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ is_active: false }),
    });

    const upsertBody = {
      theme_name: themeName,
      css_file: cssFile,
      logo_file: logoFile || this.getLogoForTheme(cssFile),
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const upsertUrl = `${SUPABASE_CONFIG.URL}/rest/v1/website_themes`;
    const doUpsert = async () =>
      fetch(upsertUrl, {
        method: "POST",
        headers: {
          ...baseHeaders,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(upsertBody),
      });

    let resp = await doUpsert();

    // If unique constraint (409) still happens, hard-reset actives then retry once.
    if (resp.status === 409) {
      await fetch(`${deactivateUrl}?is_active=eq.true`, {
        method: "PATCH",
        headers: { ...baseHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ is_active: false }),
      });
      resp = await doUpsert();
    }

    if (!resp.ok) {
      throw new Error(`Theme upsert failed (${resp.status})`);
    }

    return true;
  },

  async fetchActiveThemeFromDatabase(force = false) {
    if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
      return null;
    }

    const now = Date.now();
    if (!force && now - this.lastDbCheck < this.dbCheckInterval) {
      return null;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return null;
    }

    this.lastDbCheck = now;

    try {
      const url = `${SUPABASE_CONFIG.URL}/rest/v1/website_themes?is_active=eq.true&select=css_file,logo_file,theme_name,updated_at&order=updated_at.desc&limit=1`;
      const response = await fetch(url, {
        headers: {
          apikey: SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
          Pragma: "no-cache",
          "Cache-Control": "no-store",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return this.fetchActiveThemeViaRpc();
        }
        return null;
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length) {
        return data[0];
      }
      return this.fetchActiveThemeViaRpc();
    } catch (error) {
      themeDebugWarn("Theme DB fetch failed:", error);
      return this.fetchActiveThemeViaRpc();
    }
  },

  async fetchActiveThemeViaRpc() {
    if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
      return null;
    }

    const rpcCandidates = [
      "get_active_theme",
      "get_active_theme_public",
      "get_public_active_theme",
    ];
    for (const rpcName of rpcCandidates) {
      try {
        const response = await fetch(
          `${SUPABASE_CONFIG.URL}/rest/v1/rpc/${rpcName}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_CONFIG.ANON_KEY,
              Authorization: `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
              "Content-Type": "application/json",
              Pragma: "no-cache",
              "Cache-Control": "no-store",
            },
            body: "{}",
            cache: "no-store",
          }
        );

        if (!response.ok) {
          if (response.status === 404 || response.status === 400) {
            continue;
          }
          continue;
        }

        const payload = await response.json();
        const row = Array.isArray(payload) ? payload[0] : payload;
        if (row && row.css_file) {
          return row;
        }
      } catch (error) {
        themeDebugWarn(`Theme RPC fetch failed (${rpcName}):`, error);
      }
    }

    return null;
  },

  /* ================== NEW: SPA REINITIALIZATION SUPPORT ================== */
  // Add this method to your ThemeManager object:
  setupModeToggle() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) {
      themeDebugLog(
        "?? No theme toggle found - will retry on next SPA navigation"
      );
      return;
    }

    // Clone to remove old listeners
    const newToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(newToggle, toggle);

    // Get fresh reference
    const freshToggle = document.getElementById("themeToggle");

    // Set up click handler
    freshToggle.addEventListener("click", (e) => {
      e.preventDefault();
      this.toggleMode();
    });

    this.updateModeToggleUI();
    themeDebugLog("? Theme toggle initialized");
  },

  /* ================== OTHER FUNCTIONS ================== */
  updateFooterTheme(theme) {
    const footer = document.querySelector(".bakes-footer");
    if (!footer) {
      themeDebugLog("?? No .bakes-footer element found");
      return;
    }

    if (!theme) {
      theme = this.currentMode;
    }

    if (theme === "dark") {
      footer.classList.remove("light-theme");
      footer.classList.add("dark-theme");
    } else {
      footer.classList.remove("dark-theme");
      footer.classList.add("light-theme");
    }
  },

  toggleMode() {
    const newMode = this.currentMode === "light" ? "dark" : "light";
    this.currentMode = newMode;

    // Apply the mode change
    document.documentElement.setAttribute("data-theme", newMode);
    try {
      document.documentElement.style.colorScheme = newMode;
    } catch {}
    localStorage.setItem("toke_bakes_theme_mode", newMode);

    // Update UI elements
    this.updateModeToggleUI();
    this.updateFooterTheme(newMode);

    themeDebugLog(`?? Mode changed to ${newMode}`);

    return true;
  },

  updateModeToggleUI() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    const sun = toggle.querySelector(".sun");
    const moon = toggle.querySelector(".moon");

    if (this.currentMode === "dark") {
      if (sun) sun.style.display = "none";
      if (moon) moon.style.display = "inline-block";
      toggle.classList.add("dark");
    } else {
      if (sun) sun.style.display = "inline-block";
      if (moon) moon.style.display = "none";
      toggle.classList.remove("dark");
    }
  },

  isAdminPanel() {
    return document.querySelector(".theme-card") !== null;
  },

  updateAdminUI(cssFile) {
    themeDebugLog("?? Updating admin UI for theme:", cssFile);

    const themeCards = document.querySelectorAll(".theme-card");
    if (themeCards.length === 0) return;

    // Reset ALL cards
    themeCards.forEach((card) => {
      const file = card.dataset.themeFile;
      card.classList.remove("active");

      const status = card.querySelector(".theme-status");
      if (status) {
        status.classList.remove("active");
        // Set default icons based on file name
        if (file === "styles/style.css") {
          status.innerHTML = '<i class="fas fa-palette"></i> DEFAULT';
        } else if (file === "styles/theme-christmas.css") {
          status.innerHTML = '<i class="fas fa-tree"></i> CHRISTMAS';
        } else if (file === "styles/theme-valentine.css") {
          status.innerHTML = '<i class="fas fa-heart"></i> VALENTINE';
        } else if (file === "styles/theme-ramadan.css") {
          status.innerHTML = '<i class="fas fa-moon"></i> RAMADAN';
        } else if (file === "styles/theme-halloween.css") {
          status.innerHTML = '<i class="fas fa-ghost"></i> HALLOWEEN';
        } else if (file === "styles/theme-independenceday.css") {
          status.innerHTML = '<i class="fas fa-flag"></i> INDEPENDENCE';
        }
      }
    });

    // Activate current theme card - use exact match
    const activeCard = document.querySelector(`[data-theme-file="${cssFile}"]`);
    if (activeCard) {
      activeCard.classList.add("active");

      const status = activeCard.querySelector(".theme-status");
      if (status) {
        status.classList.add("active");
        status.innerHTML = '<i class="fas fa-check-circle"></i> ACTIVE';
      }
    }
  },

  getThemeName(cssFile) {
    const themeNames = {
      "styles/style.css": "Default",
      "styles/theme-christmas.css": "Christmas",
      "styles/theme-valentine.css": "Valentine",
      "styles/theme-ramadan.css": "Ramadan",
      "styles/theme-independenceday.css": "Independence Day",
      "styles/theme-halloween.css": "Halloween",
    };
    return themeNames[cssFile] || cssFile;
  },

  getCurrentThemeName() {
    return this.getThemeName(this.currentTheme);
  },

  resetToDefault() {
    this.applyTheme("styles/style.css", true, true);
  },

  /* ================== NEW: PATH FIXER FOR LEGACY SUPPORT ================== */
  // This ensures old saved themes get updated to new paths
  fixLegacyThemePath(cssFile) {
    // If it's an old path without 'styles/', fix it
    if (cssFile === "style.css") return "styles/style.css";
    if (cssFile === "theme-christmas.css") return "styles/theme-christmas.css";
    if (cssFile === "theme-valentine.css") return "styles/theme-valentine.css";
    if (cssFile === "theme-ramadan.css") return "styles/theme-ramadan.css";
    if (cssFile === "theme-halloween.css") return "styles/theme-halloween.css";
    if (cssFile === "theme-independenceday.css")
      return "styles/theme-independenceday.css";
    if (cssFile === "theme-independence-day.css")
      return "styles/theme-independenceday.css";

    // Otherwise return as-is
    return cssFile;
  },
};

// Make globally accessible
window.ThemeManager = ThemeManager;

// Auto-initialize with legacy path fix
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    // Fix any legacy saved theme paths before initialization
    const savedTheme =
      localStorage.getItem(THEME_STORAGE_KEYS.globalCss) ||
      localStorage.getItem(THEME_STORAGE_KEYS.legacyCss);
    if (savedTheme && !savedTheme.includes("styles/")) {
      const fixedTheme = ThemeManager.fixLegacyThemePath(savedTheme);
      if (fixedTheme !== savedTheme) {
        themeDebugLog("?? Fixed legacy theme path:", savedTheme, "?", fixedTheme);
        localStorage.setItem(THEME_STORAGE_KEYS.legacyCss, fixedTheme);
        localStorage.setItem(THEME_STORAGE_KEYS.globalCss, fixedTheme);
      }
    }
    ThemeManager.init();
  });
} else {
  // Fix legacy paths immediately
  const savedTheme =
    localStorage.getItem(THEME_STORAGE_KEYS.globalCss) ||
    localStorage.getItem(THEME_STORAGE_KEYS.legacyCss);
  if (savedTheme && !savedTheme.includes("styles/")) {
    const fixedTheme = ThemeManager.fixLegacyThemePath(savedTheme);
    if (fixedTheme !== savedTheme) {
      themeDebugLog("?? Fixed legacy theme path:", savedTheme, "?", fixedTheme);
      localStorage.setItem(THEME_STORAGE_KEYS.legacyCss, fixedTheme);
      localStorage.setItem(THEME_STORAGE_KEYS.globalCss, fixedTheme);
    }
  }
  ThemeManager.init();
}

themeDebugLog("? Theme Manager FIXED VERSION loaded!");


