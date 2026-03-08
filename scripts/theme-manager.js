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
  dbCheckInterval: 30000,
  spaHooksBound: false,
  themeSyncUnsubscribe: null,
  themeLoadingTimer: null,
  themeAutoUpdateTimer: null,
  themeVisibilityBound: false,
  systemModeMedia: null,
  systemModeHandler: null,
  themeAutoUpdateBound: false,
  themeActivationInFlight: false,
  initialized: false,

  /* ================== INITIALIZATION ================== */
  init() {
    if (this.initialized) return;
    this.initialized = true;
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
    this.fetchActiveThemeFromDatabase(true)
      .then((dbTheme) => {
        const dbCandidate = this.buildThemeCandidateFromRecord(dbTheme);
        if (dbCandidate && this.shouldApplyDbCandidate(dbCandidate)) {
          this.applyTheme(dbCandidate.cssFile, false, false, {
            logoFile: dbCandidate.logoFile,
            persist: true,
            timestampOverride: dbCandidate.timestamp,
            updatedAt: dbTheme.updated_at,
          });
        }
      })
      .catch(() => {});
  },

  /* ================== NEW: THEME AUTO-UPDATE SYSTEM ================== */
  setupThemeAutoUpdate() {
    if (this.themeAutoUpdateBound) return;
    this.themeAutoUpdateBound = true;

    // Theme updates are driven only by update-sync.
    if (
      window.TokeUpdateSync &&
      typeof window.TokeUpdateSync.registerRefreshHandler === "function"
    ) {
      if (this.themeSyncUnsubscribe) {
        try {
          this.themeSyncUnsubscribe();
        } catch {}
        this.themeSyncUnsubscribe = null;
      }

      this.themeSyncUnsubscribe = window.TokeUpdateSync.registerRefreshHandler(
        async (payload) => {
          const changeType = this.normalizeSyncChangeType(
            payload?.changeType || payload?.lastChangeType || payload?.itemType
          );
          if (changeType !== "theme" && changeType !== "all") {
            return false;
          }
          return this.checkForThemeUpdates(true);
        },
        {
          id: "theme-manager-refresh",
          showIndicator: false,
          priority: 50,
          changeTypes: ["theme", "all"],
        }
      );
    }

    // Ensure startup alignment with DB active theme.
    this.checkForThemeUpdates(true).catch(() => {});

    if (!this.themeVisibilityBound && typeof document !== "undefined") {
      this.themeVisibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        this.checkForThemeUpdates(true).catch(() => {});
      });
      window.addEventListener("focus", () => {
        this.checkForThemeUpdates(true).catch(() => {});
      });
    }

    if (this.themeAutoUpdateTimer) {
      clearInterval(this.themeAutoUpdateTimer);
    }
    this.themeAutoUpdateTimer = setInterval(() => {
      this.checkForThemeUpdates(true).catch(() => {});
    }, 45000);
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

    // Local fallback is only allowed when offline.
    const canUseLocalFallback =
      !dbCandidate &&
      typeof navigator !== "undefined" &&
      navigator.onLine === false;

    if (canUseLocalFallback) {
      const lastUpdate = Math.max(
        Number(localStorage.getItem(THEME_STORAGE_KEYS.globalUpdated) || "0"),
        Number(localStorage.getItem(THEME_STORAGE_KEYS.legacyUpdated) || "0")
      );
      const myLastCheck = Number(
        localStorage.getItem(THEME_STORAGE_KEYS.localCheck) || "0"
      );

      if (lastUpdate > myLastCheck) {
        themeDebugLog("?? Theme snapshot update detected (offline fallback)");
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

      // Cross-device propagation is handled by update-sync after content_version bump.
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

  normalizeThemeRecord(record) {
    if (!record || !record.css_file) return null;
    const updatedAt =
      record.updated_at || record.updatedAt || record.created_at || null;
    return {
      ...record,
      updated_at: updatedAt,
    };
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
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-activate-theme");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      if (this.themeActivationInFlight) {
        return;
      }

      const card = btn.closest(".theme-card");
      if (!card || !card.dataset.themeFile) {
        return;
      }

      const themeFile = this.fixLegacyThemePath(
        this.normalizeAssetPath(card.dataset.themeFile) || "styles/style.css"
      );
      const logoFile = this.resolveLogoFile(
        themeFile,
        card.dataset.themeLogo || this.getLogoForTheme(themeFile)
      );
      themeDebugLog("Admin theme activation (strict):", themeFile);
      await this.activateThemeGlobally(themeFile, logoFile);
    });
  },

  setAdminThemeButtonsBusy(isBusy) {
    const buttons = document.querySelectorAll(".btn-activate-theme");
    buttons.forEach((button) => {
      if (!button) return;
      button.disabled = Boolean(isBusy);
      button.setAttribute("aria-busy", isBusy ? "true" : "false");
    });
  },

  async activateThemeGlobally(cssFile, logoFile) {
    const normalizedCssFile = this.fixLegacyThemePath(
      this.normalizeAssetPath(cssFile) || "styles/style.css"
    );
    const resolvedLogo = this.resolveLogoFile(normalizedCssFile, logoFile);

    if (this.themeActivationInFlight) {
      return false;
    }

    this.themeActivationInFlight = true;
    this.setAdminThemeButtonsBusy(true);

    try {
      const persisted = await this.persistThemeToDatabase(
        normalizedCssFile,
        resolvedLogo
      );
      if (!persisted) {
        throw new Error("Theme persistence returned false");
      }

      const verifiedRow = await this.fetchActiveThemeFromDatabase(true);
      const verified = this.buildThemeCandidateFromRecord(verifiedRow);
      const verifiedCss = verified?.cssFile || "";
      const verifiedLogo = this.resolveLogoFile(
        verifiedCss || normalizedCssFile,
        verified?.logoFile || verifiedRow?.logo_file || null
      );
      const cssMatch = verifiedCss === normalizedCssFile;
      const logoMatch = verifiedLogo === resolvedLogo;

      if (!cssMatch || !logoMatch) {
        throw new Error("Theme verification mismatch after database write");
      }

      this.applyTheme(normalizedCssFile, true, false, {
        logoFile: resolvedLogo,
        persist: true,
        timestampOverride: verified.timestamp || Date.now(),
        updatedAt: verifiedRow?.updated_at || null,
      });

      if (typeof showNotification === "function") {
        showNotification(
          `${this.getThemeName(normalizedCssFile)} theme activated globally.`,
          "success"
        );
      }

      return true;
    } catch (error) {
      themeDebugWarn("Global theme activation failed:", error);
      if (typeof showNotification === "function") {
        showNotification(
          "Theme activation failed globally. No cross-device change was published.",
          "error"
        );
      }
      return false;
    } finally {
      this.themeActivationInFlight = false;
      this.setAdminThemeButtonsBusy(false);
      if (this.isAdminPanel()) {
        this.updateAdminUI(this.currentTheme);
      }
    }
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

  normalizeSyncChangeType(raw) {
    const value = this.normalizeAssetPath(raw).toLowerCase();
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
    const fallbackLogo = this.normalizeAssetPath("images/logo.webp") || "images/logo.webp";
    const logoTargets = document.querySelectorAll(
      "[data-theme-logo], img.logo-sm, img.hero-logo, img.admin-logo, #loader img, .brand img"
    );
    logoTargets.forEach((img) => {
      if (!img) return;

      if (!img.dataset.tbLogoFallbackBound) {
        img.dataset.tbLogoFallbackBound = "1";
        img.addEventListener(
          "error",
          () => {
            const current = this.normalizeAssetPath(img.getAttribute("src"));
            if (!current || current === fallbackLogo) return;
            img.setAttribute("src", fallbackLogo);
          },
          { passive: true }
        );
      }

      if (img.getAttribute("src") !== normalizedLogo) {
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
    const baselineVersion = await this.fetchThemeSignalVersion(baseHeaders);

    const deactivateUrl = `${SUPABASE_CONFIG.URL}/rest/v1/website_themes`;
    // Force all themes inactive first (avoids unique is_active index conflicts)
    const deactivateResponse = await fetch(`${deactivateUrl}?is_active=eq.true`, {
      method: "PATCH",
      headers: { ...baseHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ is_active: false }),
    });
    if (!deactivateResponse.ok) {
      throw new Error(`Theme deactivate failed (${deactivateResponse.status})`);
    }

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
      const retryDeactivateResponse = await fetch(
        `${deactivateUrl}?is_active=eq.true`,
        {
          method: "PATCH",
          headers: { ...baseHeaders, Prefer: "return=representation" },
          body: JSON.stringify({ is_active: false }),
        }
      );
      if (!retryDeactivateResponse.ok) {
        throw new Error(
          `Theme retry deactivate failed (${retryDeactivateResponse.status})`
        );
      }
      resp = await doUpsert();
    }

    if (!resp.ok) {
      throw new Error(`Theme upsert failed (${resp.status})`);
    }

    const nowTs = Date.now();
    const observedVersion = await this.fetchThemeSignalVersion(baseHeaders);
    const bumpedVersion =
      observedVersion > baselineVersion
        ? observedVersion
        : await this.bumpThemeUpdateSignal(baseHeaders);

    if (!Number.isFinite(bumpedVersion) || bumpedVersion <= 0) {
      throw new Error("Theme update signal bump failed");
    }

    if (
      window.TokeUpdateSync &&
      typeof window.TokeUpdateSync.publishDataUpdate === "function"
    ) {
      window.TokeUpdateSync.publishDataUpdate("update", "theme", {
        source: "admin-theme",
        timestamp: nowTs,
        contentVersion: bumpedVersion,
        lastChangeType: "theme",
      });
    }

    if (
      window.TokeUpdateSync &&
      typeof window.TokeUpdateSync.requestServerCheck === "function"
    ) {
      Promise.resolve(
        window.TokeUpdateSync.requestServerCheck("theme-write", true)
      ).catch(() => {});
    }

    return true;
  },

  async bumpThemeUpdateSignal(baseHeaders) {
    if (!window.SUPABASE_CONFIG?.URL) return 0;

    const parseVersionPayload = (raw) => {
      if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : 0;
      if (typeof raw === "string") {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
      }
      if (Array.isArray(raw)) {
        if (!raw.length) return 0;
        return parseVersionPayload(raw[0]);
      }
      if (raw && typeof raw === "object") {
        return parseVersionPayload(
          raw.content_version ?? raw.version ?? raw.get_content_version ?? raw.value ?? 0
        );
      }
      return 0;
    };

    const callRpc = async (rpcName, payload = {}) => {
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/rpc/${rpcName}`,
        {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(payload),
          cache: "no-store",
        }
      );
      if (!response.ok) return 0;
      const data = await response.json().catch(() => null);
      const parsed = parseVersionPayload(data);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };

    const bumped =
      (await callRpc("bump_update_signal", { p_change_type: "theme" })) ||
      (await callRpc("bump_content_version", {}));

    return Number.isFinite(bumped) && bumped > 0 ? Math.trunc(bumped) : 0;
  },

  async fetchThemeSignalVersion(baseHeaders) {
    if (!window.SUPABASE_CONFIG?.URL) return 0;

    const parseVersionPayload = (raw) => {
      if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : 0;
      if (typeof raw === "string") {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
      }
      if (Array.isArray(raw)) {
        if (!raw.length) return 0;
        return parseVersionPayload(raw[0]);
      }
      if (raw && typeof raw === "object") {
        return parseVersionPayload(
          raw.content_version ?? raw.version ?? raw.get_content_version ?? raw.value ?? 0
        );
      }
      return 0;
    };

    try {
      const response = await fetch(
        `${SUPABASE_CONFIG.URL}/rest/v1/rpc/get_update_signal`,
        {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Content-Type": "application/json",
          },
          body: "{}",
          cache: "no-store",
        }
      );
      if (!response.ok) return 0;
      const payload = await response.json().catch(() => null);
      const parsed = parseVersionPayload(payload);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
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

    const restCandidates = [
      {
        select: "css_file,logo_file,theme_name,updated_at,created_at",
        order: "updated_at.desc,created_at.desc",
      },
      {
        select: "css_file,logo_file,theme_name,created_at",
        order: "created_at.desc",
      },
      {
        select: "css_file,logo_file,theme_name",
        order: "theme_name.asc",
      },
    ];

    let lastError = null;
    for (const candidate of restCandidates) {
      try {
        const row = await this.fetchActiveThemeViaRest(
          candidate.select,
          candidate.order
        );
        if (row) return row;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      themeDebugWarn("Theme DB fetch failed:", lastError);
    }
    return null;
  },

  async fetchActiveThemeViaRest(
    selectClause = "css_file,logo_file,theme_name,updated_at",
    orderClause = "updated_at.desc,created_at.desc"
  ) {
    if (!window.SUPABASE_CONFIG?.URL || !window.SUPABASE_CONFIG?.ANON_KEY) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("is_active", "eq.true");
    params.set("select", selectClause);
    params.set("order", orderClause);
    params.set("limit", "1");

    const url = `${SUPABASE_CONFIG.URL}/rest/v1/website_themes?${params.toString()}`;
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
      throw new Error(`Theme REST fetch failed (${response.status})`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || !data.length) return null;
    return this.normalizeThemeRecord(data[0]);
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
    return this.activateThemeGlobally(
      "styles/style.css",
      this.getLogoForTheme("styles/style.css")
    );
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

const bootThemeManager = () => {
  if (window.__tbThemeManagerBooted) return;
  window.__tbThemeManagerBooted = true;

  // Fix legacy saved theme paths before initialization.
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
};

// Auto-initialize with legacy path fix
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootThemeManager, { once: true });
} else {
  bootThemeManager();
}

themeDebugLog("? Theme Manager FIXED VERSION loaded!");


