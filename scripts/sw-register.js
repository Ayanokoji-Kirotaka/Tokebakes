(() => {
  if (window.__tokeSwRegisterInitialized) return;
  window.__tokeSwRegisterInitialized = true;

  if (!("serviceWorker" in navigator)) return;

  const isSecureContext =
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!isSecureContext) return;

  const SW_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const SW_LAST_UPDATE_KEY = "toke_bakes_sw_last_update_detected_at";

  let controllerChangeNotified = false;
  let registrationRef = null;
  let updateTimer = null;
  let visibilityHandlerBound = false;
  let onlineHandlerBound = false;

  let storedUpdateTs = 0;
  try {
    storedUpdateTs = Number(localStorage.getItem(SW_LAST_UPDATE_KEY) || "0") || 0;
  } catch {}

  const swStatus = {
    registered: false,
    controlling: Boolean(navigator.serviceWorker.controller),
    lastUpdateDetectedAt: storedUpdateTs,
    lastControllerChangeAt: 0,
  };
  window.__tbSwStatus = swStatus;

  const emitSwStatus = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("tb:sw-status", { detail: { ...swStatus } })
      );
    } catch {}
  };

  const updateSwStatus = (patch = {}) => {
    Object.assign(swStatus, patch);
    window.__tbSwStatus = swStatus;
    emitSwStatus();
  };

  const promptWorkerActivation = (worker) => {
    if (!worker) return;
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
    } catch {}
  };

  const handleControllerChange = () => {
    const now = Date.now();
    const wasControlling = Boolean(swStatus.controlling);
    updateSwStatus({
      controlling: true,
      lastControllerChangeAt: now,
    });

    // Avoid forced reloads (they feel random on desktop). Instead, nudge users
    // to refresh when convenient after an update takes control.
    if (wasControlling && !controllerChangeNotified) {
      controllerChangeNotified = true;
      const message = "Update available — refresh to get the latest version.";
      try {
        if (typeof window.showNotification === "function") {
          window.showNotification(message, "info");
        } else {
          console.info(message);
        }
      } catch {}
    }
  };

  navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

  const checkForSwUpdates = () => {
    if (!registrationRef) return;
    if (document.hidden) return;
    registrationRef.update().catch(() => {});
  };

  const scheduleUpdateChecks = () => {
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(checkForSwUpdates, SW_UPDATE_CHECK_INTERVAL_MS);

    if (!onlineHandlerBound) {
      onlineHandlerBound = true;
      window.addEventListener("online", checkForSwUpdates);
    }

    if (!visibilityHandlerBound) {
      visibilityHandlerBound = true;
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkForSwUpdates();
      });
    }
  };

  const bindRegistrationState = (registration) => {
    if (!registration) return;
    registrationRef = registration;
    updateSwStatus({
      registered: true,
      controlling: Boolean(navigator.serviceWorker.controller),
    });

    if (registration.waiting) {
      promptWorkerActivation(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          const now = Date.now();
          try {
            localStorage.setItem(SW_LAST_UPDATE_KEY, String(now));
          } catch {}
          updateSwStatus({ lastUpdateDetectedAt: now });
          promptWorkerActivation(installing);
        }
      });
    });
  };

  const registerWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register("service-worker.js");
      bindRegistrationState(registration);
      scheduleUpdateChecks();
      checkForSwUpdates();
    } catch (error) {
      console.warn("Service worker registration failed:", error);
    }
  };

  if (document.readyState === "complete") {
    registerWorker();
  } else {
    window.addEventListener("load", registerWorker, { once: true });
  }
})();
