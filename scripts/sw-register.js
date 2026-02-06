(() => {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!isSecure) return;

    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // Silent fail for non-critical caching
    });
  });
})();
