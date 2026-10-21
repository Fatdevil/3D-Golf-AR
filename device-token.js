// ================================================================
//  DEVICE TOKEN — a secret that stays on this device
//  The device id (x-user-id) is not secret: it is the key to the account, so on its own it must not be enough to write. This adds a random
//  secret (x-user-token) to every request that carries an id. The server remembers only a hash of it, the first time it sees one.
//  Loaded before arcade-auth.js and before any other script that calls the API.
// ================================================================
(function () {
    var KEY = 'golf_os_device_token';
    function token() {
        var t = null;
        try { t = localStorage.getItem(KEY); } catch (e) { return null; }
        if (t && /^[0-9a-f]{64}$/.test(t)) return t;
        var bytes = new Uint8Array(32);
        if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
        else for (var i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
        t = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        // a token another tab stored first is the one that counts: read it back so that every tab sends the same one
        try {
            var other = localStorage.getItem(KEY);
            if (other && /^[0-9a-f]{64}$/.test(other)) return other;
            localStorage.setItem(KEY, t);
            var stored = localStorage.getItem(KEY);
            return stored && /^[0-9a-f]{64}$/.test(stored) ? stored : null;
        } catch (e) { return null; }
    }
    window.GolfDeviceToken = { get: token };
    if (typeof window.fetch !== 'function') return;
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
        try {
            var h = new Headers((init && init.headers) || (input && typeof input === 'object' && input.headers) || undefined);
            var id = h.get('x-user-id');
            if (id && !h.has('x-user-token')) {
                var t = token();
                if (t) {
                    h.set('x-user-token', t);
                    init = Object.assign({}, init || {}, { headers: h });
                }
            }
        } catch (e) { /* send the request as it was */ }
        return orig(input, init);
    };
})();
