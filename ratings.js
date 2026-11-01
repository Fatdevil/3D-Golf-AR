// ================================================================
//  RATINGS — stars for published courses and ranges (window.GolfRatings)
//  1 to 5 stars, one rating per player (a new one replaces theirs); one's own course cannot be rated (the server says so too).
//  The lists (/api/courses, /api/ranges) carry each row's average, count and the player's own stars; GET /api/courses/:code/rating gives
//  one course's, and POST the same address rates it.
//  summary(row): the stars as they stand (read only), for cards. widget(code): the stars to rate with, kept in step everywhere it is
//  drawn (a panel that redraws itself draws it again from the same cache). A click on a star never reaches the card under it.
//  The maths (fill, label) has no DOM and is tested in tests/test_ratings.js.
// ================================================================
(function (root) {
    // The five stars for an average: full, half or empty, to the nearest half star
    function fill(avg) {
        const out = [], v = typeof avg === 'number' && isFinite(avg) ? Math.round(Math.max(0, Math.min(5, avg)) * 2) / 2 : 0;
        for (let i = 1; i <= 5; i++) out.push(v >= i ? 'full' : (v >= i - 0.5 ? 'half' : 'empty'));
        return out;
    }
    // "4.3 (12)" or the words for no rating yet
    function label(avg, count, sv) {
        if (!count) return sv ? 'Inga betyg än' : 'No ratings yet';
        return (Math.round(avg * 10) / 10).toFixed(1) + ' (' + count + ')';
    }
    const api = { fill: fill, label: label };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') { root.GolfRatings = api; return; }

    const TXT = {
        sv: { rate: 'Betygsätt', yours: 'Ditt betyg', own: 'Din egen', thanks: 'Tack för ditt betyg!', give: 'Ge {n} av 5 stjärnor', failed: 'Kunde inte spara betyget just nu',
              ownErr: 'Du kan inte betygsätta din egen', gone: 'Den finns inte längre' },
        en: { rate: 'Rate it', yours: 'Your rating', own: 'Your own', thanks: 'Thanks for rating!', give: 'Give {n} of 5 stars', failed: 'Could not save the rating right now',
              ownErr: 'You cannot rate your own', gone: 'It is no longer there' }
    };
    function sv() {
        try { if (root.getGolfLanguage) return root.getGolfLanguage() === 'sv'; } catch (e) { /* the page's own */ }
        try { const l = localStorage.getItem('golf_os_lang'); if (l) return l !== 'en'; } catch (e) { /* none */ }
        return true;
    }
    const t = function (k) { return TXT[sv() ? 'sv' : 'en'][k]; };
    const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
    const cache = {};   // code -> { rating_avg, rating_count, my_rating, is_mine, note }

    function userId() {
        if (root.GolfAuth && root.GolfAuth.userId) return root.GolfAuth.userId;
        try { return localStorage.getItem('golf_os_device_id'); } catch (e) { return null; }
    }
    function headers() { const h = { 'Content-Type': 'application/json' }, id = userId(); if (id) h['x-user-id'] = id; return h; }
    // A first visit straight to a page that does not start the player's identity (the gallery) has no id yet: start it before rating
    // (GolfAuth makes the device id and registers it; without it an id is made here, and the server makes its account on the first write)
    function ensureId() {
        if (userId()) return Promise.resolve();
        if (root.GolfAuth && typeof root.GolfAuth.init === 'function') return Promise.resolve(root.GolfAuth.init()).catch(function () {}).then(function () { if (!userId()) makeId(); });
        makeId(); return Promise.resolve();
    }
    function makeId() {
        try {
            const id = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
            localStorage.setItem('golf_os_device_id', id);
        } catch (e) { /* no storage: the rating cannot be kept */ }
    }

    let styled = false;
    function style() {
        if (styled) return; styled = true;
        const css = document.createElement('style');
        css.textContent =
            '.gr-sum{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap}' +
            '.gr-sum .gr-s{display:inline-flex;letter-spacing:-1px}' +
            '.gr-star{color:#475569}.gr-star.full{color:#facc15}.gr-star.half{background:linear-gradient(90deg,#facc15 50%,#475569 50%);-webkit-background-clip:text;background-clip:text;color:transparent}' +
            '.gr-sum .gr-n{color:inherit;opacity:.85;font-size:.92em}' +
            '.gr-widget{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}' +
            '.gr-pick{display:inline-flex;gap:2px}' +
            '.gr-pick button{background:none;border:none;padding:2px;font-size:22px;line-height:1;cursor:pointer;color:#475569;transition:transform .1s}' +
            '.gr-pick button.on{color:#facc15}.gr-pick button:hover{transform:scale(1.15)}' +
            '.gr-pick:hover button{color:#facc15}.gr-pick button:hover~button{color:#475569}' +
            '.gr-pick button:focus-visible{outline:2px solid #38bdf8;outline-offset:1px;border-radius:4px}' +
            '.gr-cap{font-size:12px;font-weight:700;color:#94a3b8}.gr-note{font-size:12px;font-weight:700;color:#4ade80}.gr-note.err{color:#f87171}' +
            '@media (prefers-reduced-motion:reduce){.gr-pick button{transition:none}.gr-pick button:hover{transform:none}}';
        document.head.appendChild(css);
    }

    // The stars as they stand: for a card. row: { rating_avg, rating_count }
    function summary(row) {
        style();
        const n = row && row.rating_count || 0, avg = row && row.rating_avg;
        const stars = fill(n ? avg : 0).map(function (f) { return '<span class="gr-star ' + f + '">★</span>'; }).join('');
        return '<span class="gr-sum" title="' + esc(label(avg, n, sv())) + '"><span class="gr-s" aria-hidden="true">' + stars + '</span><span class="gr-n">' + esc(label(avg, n, sv())) + '</span></span>';
    }
    function inner(code) {
        const c = cache[code] || {};
        let h = summary(c);
        if (c.is_mine) return h + '<span class="gr-cap">' + esc(t('own')) + '</span>';
        h += '<span class="gr-cap">' + esc(c.my_rating ? t('yours') : t('rate')) + '</span><span class="gr-pick" role="group" aria-label="' + esc(t('rate')) + '">';
        for (let i = 1; i <= 5; i++) {
            h += '<button type="button" data-gr-code="' + esc(code) + '" data-gr-stars="' + i + '" class="' + (c.my_rating && i <= c.my_rating ? 'on' : '') + '" aria-label="' + esc(t('give').replace('{n}', i)) +
                 '" aria-pressed="' + (c.my_rating === i) + '">★</button>';
        }
        h += '</span>';
        if (c.note) h += '<span class="gr-note' + (c.noteErr ? ' err' : '') + '">' + esc(c.note) + '</span>';
        return h;
    }
    // The stars to rate with (a course's or range's share code)
    function widget(code) { style(); return '<div class="gr-widget" data-gr-widget="' + esc(code) + '">' + inner(code) + '</div>'; }
    function refresh(code) {
        document.querySelectorAll('.gr-widget').forEach(function (el) { if (el.getAttribute('data-gr-widget') === code) el.innerHTML = inner(code); });
        if (typeof api.onChange === 'function') { try { api.onChange(code, cache[code]); } catch (e) { /* the page's own */ } }
    }
    // What a list row already says about a course (no request needed)
    function seed(row) {
        if (!row || !row.share_code) return;
        cache[row.share_code] = Object.assign(cache[row.share_code] || {}, { rating_avg: row.rating_avg, rating_count: row.rating_count || 0, my_rating: row.my_rating || null, is_mine: !!row.is_mine });
    }
    function load(code) {
        if (!code) return Promise.resolve(null);
        return fetch((api.base || '') + '/api/courses/' + encodeURIComponent(code) + '/rating', { headers: headers() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { if (j) { cache[code] = Object.assign(cache[code] || {}, j); refresh(code); } return j; })
            .catch(function () { return null; });
    }
    // Rating a course: shown at once, saved one after the other per course (a quick second choice is saved after the first, so the
    // server ends on the last one), and only the answer to the latest choice is shown
    const queue = {}, latest = {}, saved = {};   // per code: the saves in turn, the number of the latest choice, the last rating the server took
    function rate(code, stars) {
        const n = (latest[code] || 0) + 1;
        latest[code] = n;
        if (!saved[code]) saved[code] = Object.assign({}, cache[code] || {});
        cache[code] = Object.assign(cache[code] || {}, { my_rating: stars, note: '', noteErr: false });
        refresh(code);
        const run = function () {
            return ensureId().then(function () {
                return fetch((api.base || '') + '/api/courses/' + encodeURIComponent(code) + '/rating', { method: 'POST', headers: headers(), body: JSON.stringify({ stars: stars }) });
            })
                .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; }); })
                .catch(function () { return { status: 0, json: {} }; })
                .then(function (res) {
                    if (res.status === 200) saved[code] = Object.assign({}, saved[code], res.json);
                    if (n !== latest[code]) return res;   // a newer choice is on its way: its answer is the one to show
                    if (res.status === 200) cache[code] = Object.assign(cache[code], res.json, { note: t('thanks'), noteErr: false });
                    else cache[code] = Object.assign({}, saved[code], { note: res.status === 403 ? t('ownErr') : (res.status === 404 ? t('gone') : t('failed')), noteErr: true,
                                                                          is_mine: res.status === 403 ? true : saved[code].is_mine });
                    delete saved[code];
                    refresh(code);
                    return res;
                });
        };
        queue[code] = (queue[code] || Promise.resolve()).then(run, run);
        return queue[code];
    }

    // a star's click is the rating only: it never opens or plays the card it sits on (caught on the way down)
    document.addEventListener('click', function (e) {
        const b = e.target && e.target.closest && e.target.closest('[data-gr-stars]');
        if (!b) return;
        e.stopPropagation(); e.preventDefault();
        rate(b.getAttribute('data-gr-code'), Number(b.getAttribute('data-gr-stars')));
    }, true);
    ['pointerdown', 'pointerup', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, function (e) { if (e.target && e.target.closest && e.target.closest('.gr-widget')) e.stopPropagation(); }, true);
    });

    Object.assign(api, { summary: summary, widget: widget, seed: seed, load: load, rate: rate, refresh: refresh, cache: cache, base: '' });
    root.GolfRatings = api;
})(typeof window !== 'undefined' ? window : globalThis);
