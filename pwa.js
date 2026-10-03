// Registers the service worker (offline + installable) and keeps the browser's install prompt for the app's own button.
(function () {
  if (!('serviceWorker' in navigator)) return;
  const ok = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!ok) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (e) { console.warn('[pwa] service worker not registered:', e && e.message); });
  });
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    document.dispatchEvent(new CustomEvent('pwa-installable'));
  });
  window.installApp = function () {
    const p = window.deferredInstallPrompt;
    if (!p) return Promise.resolve(false);
    window.deferredInstallPrompt = null;
    p.prompt();
    return p.userChoice.then(function (c) { return c && c.outcome === 'accepted'; });
  };
})();
