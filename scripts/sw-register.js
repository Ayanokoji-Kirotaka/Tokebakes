(() => {
  if (window.__tokeSwRegisterInitialized) return;
  window.__tokeSwRegisterInitialized = true;

  if (!("serviceWorker" in navigator)) return;

  const isSecureContext =
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (!isSecureContext) return;

  let isRefreshing = false;
  let registrationRef = null;
  let updateTimer = null;
  const SW_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

  const reloadOnce = () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);

  const checkForSwUpdates = () => {
    if (!registrationRef) return;
    if (document.hidden) return;
    registrationRef.update().catch(() => {});
  };

  const scheduleUpdateChecks = () => {
    if (updateTimer) {
      clearInterval(updateTimer);
    }

    updateTimer = setInterval(() => {
      checkForSwUpdates();
    }, SW_UPDATE_CHECK_INTERVAL_MS);

    window.addEventListener("online", checkForSwUpdates);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        checkForSwUpdates();
      }
    });
  };

  const registerWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "service-worker.js"
      );
      registrationRef = registration;

      const promptWorkerActivation = (worker) => {
        if (!worker) return;
        try {
          worker.postMessage({ type: "SKIP_WAITING" });
        } catch {}
      };

      if (registration.waiting) {
        promptWorkerActivation(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            promptWorkerActivation(newWorker);
          }
        });
      });

      scheduleUpdateChecks();
      checkForSwUpdates();
    } catch {
      // Silent fail for non-critical offline caching.
    }
  };

  window.addEventListener("load", registerWorker);
})();
