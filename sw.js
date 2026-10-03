// Golf OS service worker.
// - Pages, scripts and styles: network first, so a deploy is picked up at once; the cached copy is used only offline.
// - Images, models, fonts: cache first (they are big and rarely change); refreshed in the background.
// - API calls and everything that is not a GET: never touched.
const VERSION = 'golfos-v1';
const SHELL = ['/', '/hub.html', '/arcade_hub.html', '/arcade_mobile_hub.html', '/arcade.html', '/courses.html', '/new_course.html',
               '/manifest.json', '/pwa/icon-192.png', '/pwa/icon-512.png'];
const HEAVY = /\.(png|jpe?g|webp|gif|svg|glb|gltf|hdr|mp3|ogg|wav|woff2?|ttf)$/i;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // one missing file must not break the install
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function store(req, res) {
  // opaque = a cross-origin <script>/<img> without CORS (the CDN libraries): status is hidden, so it is kept as it comes
  if (res && ((res.ok && (res.type === 'basic' || res.type === 'cors')) || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(VERSION).then(function (c) { c.put(req, copy); });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return;
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;   // live data, never cached
  if (req.headers.has('range')) return;                                                   // media streaming

  const sameOrigin = url.origin === self.location.origin;
  if (HEAVY.test(url.pathname) || !sameOrigin) {
    // cache first; the CDN libraries (three.js and friends) are versioned URLs, so this is safe
    e.respondWith(caches.match(req).then(function (hit) {
      const fresh = fetch(req).then(function (res) { return store(req, res); }).catch(function () { return hit; });
      return hit || fresh;
    }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) { return store(req, res); }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || caches.match(req, { ignoreSearch: true });
    }).then(function (hit) {
      return hit || caches.match('/arcade_hub.html');
    });
  }));
});
