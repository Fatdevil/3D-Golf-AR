// Request limits for server.js: a counter per caller and window, in memory, no database. Used by server.js; nothing here knows about express.
'use strict';

// limiter({ windowMs, max }) -> { hit(key, now) -> { ok, retryAfter } }
// A window starts at a caller's first request and ends windowMs later; the request after the max-th inside it is refused until the window ends.
function limiter(opts) {
  const windowMs = opts.windowMs, max = opts.max;
  const seen = new Map();
  let lastSweep = 0;
  return {
    hit(key, now) {
      now = now === undefined ? Date.now() : now;
      if (now - lastSweep > windowMs) {            // callers that left are dropped, so the map cannot grow for ever
        lastSweep = now;
        seen.forEach(function (w, k) { if (now >= w.end) seen.delete(k); });
      }
      let w = seen.get(key);
      if (!w || now >= w.end) { w = { end: now + windowMs, n: 0 }; seen.set(key, w); }
      w.n++;
      if (w.n > max) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.end - now) / 1000)) };
      return { ok: true, retryAfter: 0 };
    },
    size() { return seen.size; }
  };
}

// which limit a request falls under: 'login' (guessing the admin password), 'register' (making accounts), 'write' (any other change), or null (reads)
function classify(method, path) {
  if (path === '/api/admin/login') return 'login';
  if (path === '/api/auth/register') return 'register';
  if (/^\/api\//.test(path) && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') return 'write';
  return null;
}

// the largest JSON body a route takes: only the routes that carry maps, images and models need the large one
function bodyLimit(path) {
  if (/^\/api\/(auth|users|admin)\b/.test(path)) return '100kb';
  if (/^\/api\/courses\/[^/]+\/(like|results|rating)$/.test(path)) return '1mb';
  if (/^\/api\/collections\b/.test(path)) return '1mb';
  return '50mb';
}

module.exports = { limiter, classify, bodyLimit };
