/* ================== admin-auth-core.js ================== */
(function initTbAdminAuthCore(global) {
  if (!global || global.TBAdminAuthCore) return;

  const SESSION_SKEW_SECONDS = 60;
  const secureStoragePrefix = "secure_";
  const hooks = {
    notify: null,
    recordError: null,
    cacheResponseData: null,
    onUnauthorized: null,
    debugWarn: null,
  };

  const toSafeString = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    const text = String(value)
      .replace(/\u0000/g, "")
      .trim();
    return text || fallback;
  };

  const safeInvoke = (hookName, ...args) => {
    const hook = hooks[hookName];
    if (typeof hook !== "function") return;
    try {
      return hook(...args);
    } catch {}
  };

  const secureStorage = {
    setItem(key, value) {
      try {
        sessionStorage.setItem(
          `${secureStoragePrefix}${key}`,
          btoa(JSON.stringify(value)),
        );
      } catch (error) {
        safeInvoke("debugWarn", "Secure storage failed:", error);
        global.tempStorage = global.tempStorage || {};
        global.tempStorage[`${secureStoragePrefix}${key}`] = value;
      }
    },
    getItem(key) {
      try {
        const item = sessionStorage.getItem(`${secureStoragePrefix}${key}`);
        return item ? JSON.parse(atob(item)) : null;
      } catch (error) {
        safeInvoke("debugWarn", "Secure storage retrieval failed:", error);
        return global.tempStorage
          ? global.tempStorage[`${secureStoragePrefix}${key}`]
          : null;
      }
    },
    removeItem(key) {
      try {
        sessionStorage.removeItem(`${secureStoragePrefix}${key}`);
      } catch (error) {
        safeInvoke("debugWarn", "Secure storage removal failed:", error);
      }
      if (global.tempStorage) {
        delete global.tempStorage[`${secureStoragePrefix}${key}`];
      }
    },
  };

  const UUID_FORMAT_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const isUuidLike = (value) => UUID_FORMAT_REGEX.test(toSafeString(value));

  function readJwtPayload(token) {
    const rawToken = toSafeString(token);
    if (!rawToken) return null;
    const parts = rawToken.split(".");
    if (parts.length < 2) return null;
    try {
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function isSessionTokenUsable(session) {
    if (!session || typeof session !== "object") return false;
    const accessToken = toSafeString(session.access_token);
    if (!accessToken) return false;
    const payload = readJwtPayload(accessToken);
    if (!payload || typeof payload !== "object") return false;
    const subject = toSafeString(payload.sub || session.user?.id);
    return isUuidLike(subject);
  }

  function getStoredSession() {
    return secureStorage.getItem("session");
  }

  function storeSession(session) {
    secureStorage.setItem("session", session);
  }

  function clearSession() {
    secureStorage.removeItem("session");
  }

  async function refreshSessionIfNeeded(session) {
    if (!session || !session.refresh_token) return session;

    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at - now > SESSION_SKEW_SECONDS) {
      return session;
    }

    try {
      const response = await fetch(
        `${global.SUPABASE_CONFIG.URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: global.SUPABASE_CONFIG.ANON_KEY,
          },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        },
      );

      if (!response.ok) {
        return session;
      }

      const refreshed = await response.json();
      const refreshedSession = {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || session.refresh_token,
        expires_at:
          refreshed.expires_at ||
          Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600),
        user: refreshed.user || session.user,
        email: (refreshed.user && refreshed.user.email) || session.email,
      };

      storeSession(refreshedSession);
      return refreshedSession;
    } catch (error) {
      safeInvoke("debugWarn", "Session refresh failed:", error);
      return session;
    }
  }

  async function ensureValidSession() {
    const session = getStoredSession();
    if (!isSessionTokenUsable(session)) {
      clearSession();
      return null;
    }

    const refreshed = await refreshSessionIfNeeded(session);
    if (!isSessionTokenUsable(refreshed)) {
      clearSession();
      return null;
    }

    return refreshed;
  }

  async function secureRequest(
    endpoint,
    method = "GET",
    data = null,
    options = {},
  ) {
    const normalizedMethod = toSafeString(method, "GET").toUpperCase();
    const {
      retries = 3,
      timeout = normalizedMethod === "GET" ? 22000 : 15000,
      authRequired = false,
      headers: extraHeaders = {},
      suppressNotifications = false,
    } = options;
    const requestTimeout =
      Number.isFinite(Number(timeout)) && Number(timeout) > 0
        ? Number(timeout)
        : normalizedMethod === "GET"
          ? 22000
          : 15000;

    if (
      !global.SUPABASE_CONFIG ||
      !global.SUPABASE_CONFIG.URL ||
      !global.SUPABASE_CONFIG.ANON_KEY
    ) {
      throw new Error("Supabase configuration missing. Check config.js");
    }

    const safeEndpoint = toSafeString(endpoint).replace(/\u0000/g, "");
    if (!safeEndpoint.startsWith("/")) {
      throw new Error("Invalid API endpoint");
    }

    const session = await ensureValidSession();
    if (authRequired && !session?.access_token) {
      throw new Error("Authentication required");
    }

    const baseHeaders = {
      apikey: global.SUPABASE_CONFIG.ANON_KEY,
      Authorization: `Bearer ${
        session?.access_token || global.SUPABASE_CONFIG.ANON_KEY
      }`,
      Prefer: "return=representation",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...extraHeaders,
    };

    if (
      data &&
      (normalizedMethod === "POST" ||
        normalizedMethod === "PATCH" ||
        normalizedMethod === "PUT")
    ) {
      baseHeaders["Content-Type"] = "application/json";
    }

    const isRetryableStatus = (status) => {
      const code = Number(status) || 0;
      return (
        code === 408 ||
        code === 425 ||
        code === 429 ||
        code === 502 ||
        code === 503 ||
        code === 504 ||
        code >= 500
      );
    };

    const isTransientNetworkError = (error) => {
      const message = toSafeString(error?.message).toLowerCase();
      return (
        error?.name === "AbortError" ||
        message.includes("failed to fetch") ||
        message.includes("networkerror") ||
        message.includes("network request failed") ||
        message.includes("load failed") ||
        message.includes("timeout")
      );
    };

    const getRetryDelayMs = (attempt, retryAfterSeconds = 0) => {
      if (retryAfterSeconds > 0) {
        return Math.min(10000, Math.max(300, retryAfterSeconds * 1000));
      }
      return Math.min(
        10000,
        Math.pow(2, attempt) * 700 + Math.floor(Math.random() * 250),
      );
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), requestTimeout)
        : null;

      const config = {
        method: normalizedMethod,
        headers: baseHeaders,
        signal: controller ? controller.signal : undefined,
        cache: "no-store",
      };

      if (
        data &&
        (normalizedMethod === "POST" ||
          normalizedMethod === "PATCH" ||
          normalizedMethod === "PUT")
      ) {
        config.body = JSON.stringify(data);
      }

      try {
        const response = await fetch(
          `${global.SUPABASE_CONFIG.URL}${safeEndpoint}`,
          config,
        );
        if (timeoutId) clearTimeout(timeoutId);

        if (response.status === 429) {
          const retryAfter =
            Number(response.headers.get("Retry-After") || 1) || 1;
          if (attempt < retries) {
            await new Promise((resolve) =>
              setTimeout(resolve, getRetryDelayMs(attempt, retryAfter)),
            );
            continue;
          }
        }

        if (!response.ok) {
          const errorData = await response.text();
          safeInvoke("recordError", "fetch", `HTTP ${response.status} ${safeEndpoint}`, {
            method: normalizedMethod,
            status: response.status,
          });

          if (response.status === 401) {
            clearSession();
            if (!suppressNotifications) {
              safeInvoke(
                "notify",
                "Authentication failed. Please login again.",
                "error",
              );
            }
            safeInvoke("onUnauthorized");
            const authError = new Error("Authentication failed");
            authError.status = response.status;
            throw authError;
          }

          if (response.status === 403) {
            if (!suppressNotifications) {
              safeInvoke(
                "notify",
                "Permission denied. Please contact administrator.",
                "error",
              );
            }
            const permissionError = new Error("Permission denied");
            permissionError.status = response.status;
            throw permissionError;
          }

          if (response.status === 413) {
            if (!suppressNotifications) {
              safeInvoke(
                "notify",
                "Image file is too large. Please use a smaller image.",
                "error",
              );
            }
            const sizeError = new Error("File too large");
            sizeError.status = response.status;
            throw sizeError;
          }

          const httpError = new Error(
            `HTTP ${response.status}: ${errorData.substring(0, 200)}`,
          );
          httpError.status = response.status;
          httpError.responseBody = errorData;

          if (attempt < retries && isRetryableStatus(response.status)) {
            await new Promise((resolve) =>
              setTimeout(resolve, getRetryDelayMs(attempt)),
            );
            continue;
          }
          throw httpError;
        }

        if (normalizedMethod === "DELETE" && response.status === 204) {
          return { success: true, message: "Item deleted successfully" };
        }

        if (response.status !== 204) {
          const result = await response.json();
          safeInvoke("cacheResponseData", result);
          return result;
        }

        return { success: true };
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);

        const statusCode = Number(error?.status) || 0;
        const canRetry =
          attempt < retries &&
          (isRetryableStatus(statusCode) || isTransientNetworkError(error));

        if (canRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, getRetryDelayMs(attempt)),
          );
          continue;
        }

        if (!suppressNotifications) {
          console.error("API request failed after retries:", error);
        } else {
          safeInvoke(
            "debugWarn",
            "API request failed after retries:",
            safeEndpoint,
            error?.message,
          );
        }

        safeInvoke("recordError", "fetch", `Request failed: ${safeEndpoint}`, {
          method: normalizedMethod,
          status: statusCode || undefined,
          message: error?.message || "Unknown error",
        });

        if (!suppressNotifications) {
          if (error?.name === "AbortError") {
            safeInvoke(
              "notify",
              "Request timed out while contacting the server. Please try again.",
              "error",
            );
          } else if (
            toSafeString(error?.message).toLowerCase().includes("failed to fetch")
          ) {
            safeInvoke(
              "notify",
              "Network error. Please check your connection.",
              "error",
            );
          } else if (toSafeString(error?.message).toLowerCase().includes("cors")) {
            safeInvoke(
              "notify",
              "Cross-origin request blocked. Please check configuration.",
              "error",
            );
          } else {
            safeInvoke("notify", `Operation failed: ${error.message}`, "error");
          }
        }

        throw error;
      }
    }
  }

  async function signOutAdmin() {
    const session = getStoredSession();
    if (!session?.access_token) return;

    try {
      await fetch(`${global.SUPABASE_CONFIG.URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: global.SUPABASE_CONFIG.ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch (error) {
      safeInvoke("debugWarn", "Supabase logout failed:", error);
    }
  }

  global.TBAdminAuthCore = {
    setHooks(nextHooks = {}) {
      Object.assign(hooks, nextHooks || {});
    },
    getStoredSession,
    storeSession,
    clearSession,
    ensureValidSession,
    secureRequest,
    signOutAdmin,
    isSessionTokenUsable,
  };
})(window);
