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

  const reloadOnce = () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);

  const registerWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "service-worker.js"
      );

      const promptWorkerActivation = (worker) => {
        if (!worker) return;
        worker.postMessage({ type: "SKIP_WAITING" });
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

      // Check in the background for new SW versions.
      setInterval(() => {
        registration.update().catch(() => {});
      }, 10 * 60 * 1000);
    } catch {
      // Silent fail for non-critical offline caching.
    }
  };

  window.addEventListener("load", registerWorker);
})();
