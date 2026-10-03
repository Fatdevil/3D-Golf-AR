// Golf OS service worker.
// - Pages, scripts and styles: network first, so a deploy is picked up at once; the cached copy is used only offline.
// - Images, models, fonts and the CDN libraries: cache first (big, rarely changing); refreshed in the background.
// - API calls (any origin) and everything that is not a GET: never touched.
const VERSION = 'golfos-v2';
const PAGES = ['/', '/hub.html', '/arcade_hub.html', '/arcade_mobile_hub.html', '/arcade_mobile.html', '/arcade.html', '/build.html', '/courses.html', '/new_course.html'];
const EXTRA = ['/manifest.json', '/pwa/icon-192.png', '/pwa/icon-512.png'];
const HEAVY = /\.(png|jpe?g|webp|gif|svg|glb|gltf|hdr|mp3|ogg|wav|woff2?|ttf)$/i;
// the only other origins whose files are cached: the libraries and fonts the pages load
const CDN = /^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|cdn\.tailwindcss\.com|code\.jquery\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

function cacheable(res) {
  // opaque = a cross-origin <script> without CORS (the CDN libraries): the status is hidden, so it is kept as it comes
  return res && ((res.ok && (res.type === 'basic' || res.type === 'cors')) || res.type === 'opaque');
}

// Every script and stylesheet a page names, so the game can start offline the first time it is installed
function dependenciesOf(html, pageUrl) {
  const out = new Set();
  const re = /<(script|link)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const attr = /^<script/i.test(tag) ? /\bsrc=["']([^"']+)["']/i : (/rel=["']stylesheet["']/i.test(tag) ? /\bhref=["']([^"']+)["']/i : null);
    const a = attr && attr.exec(tag);
    if (!a) continue;
    try {
      const u = new URL(a[1], pageUrl);
      if (u.origin === self.location.origin || CDN.test(u.hostname)) out.add(u.href);
    } catch (e) { /* not a URL */ }
  }
  return out;
}

function precache(cache, url) {
  const same = new URL(url, self.location.href).origin === self.location.origin;
  return fetch(new Request(url, same ? {} : { mode: 'no-cors' })).then(function (res) {
    return cacheable(res) ? cache.put(url, res.clone()).then(function () { return res; }) : res;
  }).catch(function () { return null; });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (cache) {
    const deps = new Set(EXTRA);
    // one missing file must not break the install
    return Promise.all(PAGES.map(function (p) {
      return precache(cache, p).then(function (res) {
        if (!res || !res.ok) return;
        return res.text().then(function (html) { dependenciesOf(html, new URL(p, self.location.href)).forEach(function (d) { deps.add(d); }); });
      });
    })).then(function () {
      return Promise.all(Array.from(deps).map(function (d) { return precache(cache, d); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// fetches, keeps a copy, and hands back the response; the cache write is part of the event so the worker is not stopped before it ends
function fetchAndStore(e, req) {
  return fetch(req).then(function (res) {
    if (cacheable(res)) {
      const copy = res.clone();
      e.waitUntil(caches.open(VERSION).then(function (c) { return c.put(req, copy); }));
    }
    return res;
  });
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return;
  if (url.pathname.startsWith('/api/')) return;      // live data on any origin (local dev talks to the production API), never cached
  if (req.headers.has('range')) return;              // media streaming

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN.test(url.hostname)) return;

  if (!sameOrigin || HEAVY.test(url.pathname)) {
    // cache first; the CDN libraries are versioned URLs, so this is safe
    e.respondWith(caches.match(req).then(function (hit) {
      const fresh = fetchAndStore(e, req).catch(function () { return hit; });
      if (hit) { e.waitUntil(fresh); return hit; }
      return fresh;
    }));
    return;
  }

  e.respondWith(fetchAndStore(e, req).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || caches.match(req, { ignoreSearch: true });
    }).then(function (hit) {
      if (hit) return hit;
      // only a page may be replaced by another page; a missing script or style is a plain failure
      return req.mode === 'navigate' ? caches.match('/arcade_hub.html') : Response.error();
    });
  }));
});
