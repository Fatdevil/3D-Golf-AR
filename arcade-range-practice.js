// ================================================================
//  RANGE PRACTICE — approach shots on the range: hit from a chosen distance to the pin of one of the range's greens.
//  The ball is put on the line from the pin back towards the Range Tee, at the chosen distance (moved around the pin when that spot
//  is in water or out of bounds), and goes back there after every shot. Each shot is scored against the pin: on the green or not,
//  how far from the pin, short or long, left or right. The lie is the Range Tee's mat, or the ground where the ball lies.
//
//  window.RangePractice: the maths (targets, spot, result, per-distance stats) has no DOM and is tested in tests/test_range_practice.js;
//  in the page it also draws the bar at the top of the range (target green, distance, lie) and keeps the choice per range on this device.
//  arcade.html starts it with the range (start), stops it in the builder (stop), and does the game side through onRangePracticeChange
//  (where the ball goes, the camera, the aim, which hole's cup counts).
// ================================================================
(function (root) {
    const PRESETS = [50, 75, 100, 125, 150];   // in the player's unit
    const MIN = 10, MAX = 300;

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

    // The range's greens: every hole with a flag (the Range Tee's own hole too), in hole order, with how far the pin is from the tee
    function targetsFrom(holes, tee) {
        const out = [];
        (holes || []).forEach(function (h, i) {
            if (!h || !h.flag || num(h.flag.x) === null || num(h.flag.z) === null) return;
            out.push({ hole: i, n: out.length + 1, x: h.flag.x, y: num(h.flag.y) !== null ? h.flag.y : 0, z: h.flag.z,
                       fromTee: tee ? Math.hypot(h.flag.x - tee.x, h.flag.z - tee.z) : null });
        });
        return out;
    }

    // Where to hit from: `dist` metres from the pin, on the line from the pin towards the tee, turned `angleDeg` around the pin
    // (+ turns it to the right as seen from the spot looking at the pin)
    function spotFor(pin, tee, dist, angleDeg) {
        let ux = tee.x - pin.x, uz = tee.z - pin.z, len = Math.hypot(ux, uz);
        if (len < 0.5) { const r = tee.rot || 0; ux = -Math.sin(r); uz = -Math.cos(r); len = 1; }   // the pin on the tee: straight back down the range
        ux /= len; uz /= len;
        const a = (angleDeg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const rx = ux * c - uz * s, rz = ux * s + uz * c;
        return { x: pin.x + rx * dist, z: pin.z + rz * dist };
    }

    // The spot, or the nearest one around the pin at the same distance that is not blocked (water, out of bounds): a few degrees either way,
    // all the way round the pin if need be (blocked: nowhere at this distance)
    function playableSpot(pin, tee, dist, blocked) {
        for (let k = 0; k <= 60; k++) {
            const tries = k === 0 ? [0] : (k === 60 ? [180] : [3 * k, -3 * k]);
            for (let j = 0; j < tries.length; j++) {
                const p = spotFor(pin, tee, dist, tries[j]);
                if (!blocked || !blocked(p.x, p.z)) return { x: p.x, z: p.z, angle: tries[j], moved: tries[j] !== 0 };
            }
        }
        const p = spotFor(pin, tee, dist, 0);
        return { x: p.x, z: p.z, angle: 0, moved: false, blocked: true };
    }

    // A shot against the pin: rest is where the ball stopped. along: past (+) or short (-) of the pin, along the line from the spot;
    // across: right (+) or left (-) of it; prox: metres from the pin
    function result(rest, pin, spot, onGreen) {
        const dx = rest.x - pin.x, dz = rest.z - pin.z;
        let ux = pin.x - spot.x, uz = pin.z - spot.z;
        const len = Math.hypot(ux, uz) || 1; ux /= len; uz /= len;
        return { prox: Math.hypot(dx, dz), along: dx * ux + dz * uz, across: dx * -uz + dz * ux, onGreen: !!onGreen };
    }

    // Per practised distance (the distance chosen, in metres): shots, greens hit, average distance from the pin
    function byDistance(shots) {
        const by = {};
        shots.forEach(function (s) {
            const p = s.practice;
            if (!p || num(p.dist) === null || num(p.prox) === null) return;
            const k = Math.round(p.dist);
            const b = by[k] || (by[k] = { dist: k, n: 0, greens: 0, proxSum: 0, best: null });
            b.n++; if (p.onGreen) b.greens++; b.proxSum += p.prox;
            if (b.best === null || p.prox < b.best) b.best = p.prox;
        });
        return Object.keys(by).map(function (k) { const b = by[k]; return { dist: b.dist, n: b.n, greens: b.greens, prox: b.proxSum / b.n, best: b.best }; })
            .sort(function (a, b) { return a.dist - b.dist; });
    }

    // The distance the player picks, in metres, from a value in their unit; held between MIN and MAX (in their unit)
    function toMetres(value, useMeters) { const v = Math.max(MIN, Math.min(MAX, Math.round(value))); return useMeters ? v : v * 0.9144; }
    function inUnit(metres, useMeters) { return Math.round(useMeters ? metres : metres / 0.9144); }

    const api = { PRESETS: PRESETS, MIN: MIN, MAX: MAX, targetsFrom: targetsFrom, spotFor: spotFor, playableSpot: playableSpot, result: result,
                  byDistance: byDistance, toMetres: toMetres, inUnit: inUnit };

    if (typeof document !== 'undefined') {
        const TXT = {
            sv: { open: '🎯 Inspel mot green', green: 'Green', mat: 'Matta', ground: 'Som marken', lie: 'Läge', close: 'Tillbaka till rangen',
                  none: 'Bygg en green med flagga för att öva inspel', onGreen: 'På green', miss: 'Miss', fromPin: 'från pinnen', short: 'kort', long: 'långt',
                  left: 'vänster', right: 'höger', holed: 'I hål!', moved: 'Flyttad åt sidan (vatten eller utanför banan)',
                  blocked: 'Inget spelbart läge på det avståndet (vatten eller utanför banan) – välj ett annat', later: 'Gäller från nästa slag' },
            en: { open: '🎯 Approach to a green', green: 'Green', mat: 'Mat', ground: 'As it lies', lie: 'Lie', close: 'Back to the range',
                  none: 'Build a green with a flag to practise approaches', onGreen: 'On the green', miss: 'Missed', fromPin: 'from the pin', short: 'short', long: 'long',
                  left: 'left', right: 'right', holed: 'In the hole!', moved: 'Moved aside (water or out of bounds)',
                  blocked: 'Nowhere playable at that distance (water or out of bounds) – pick another', later: 'From the next shot' }
        };
        const t = function (k) { return ((root.getGolfLanguage && root.getGolfLanguage() === 'sv') ? TXT.sv : TXT.en)[k]; };
        const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
        const unit = function () { return root.useMeters ? 'm' : 'yd'; };
        const fmt = function (m, d) { return (root.useMeters ? m : m * 1.09361).toFixed(d === undefined ? 0 : d); };

        let ctx = null;   // { key, tee, holes() }
        let state = { on: false, hole: null, dist: 100, lie: 'mat' };   // dist in metres
        let bar = null, spot = null;
        let pending = false, noSpot = false;   // a change made while the ball flies (it waits for the shot to be scored); no playable spot

        function storageKey() { return 'golf_range_practice_' + ctx.key; }
        function load() {
            try { const s = JSON.parse(localStorage.getItem(storageKey()) || 'null'); if (s) state = { on: !!s.on, hole: s.hole, dist: num(s.dist) || 100, lie: s.lie === 'ground' ? 'ground' : 'mat' }; }
            catch (e) { /* keep the default */ }
        }
        function save() { try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* this page only */ } }
        function targets() { return ctx ? targetsFrom(ctx.holes(), ctx.tee) : []; }
        function current() {
            const list = targets();
            return list.find(function (g) { return g.hole === state.hole; }) || list[0] || null;
        }

        // Works out the spot for the chosen green and distance and tells the game (arcade.html) where the ball goes now
        // (while the ball flies the shot keeps the spot it was hit from: the change waits, settle() makes it once the shot is scored)
        function apply() {
            if (root.rangeShotBusy && root.rangeShotBusy()) { pending = true; render(); return; }
            pending = false; noSpot = false;
            const g = state.on ? current() : null;
            if (!g) { spot = null; if (root.onRangePracticeChange) root.onRangePracticeChange(null); render(); return; }
            state.hole = g.hole;
            const blocked = function (x, z) { const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null; return !!(s && (s.type === 'WATER' || s.type === 'OB')); };
            const p = playableSpot(g, ctx.tee, state.dist, blocked);
            if (p.blocked) { noSpot = true; spot = null; if (root.onRangePracticeChange) root.onRangePracticeChange(null); render(); return; }   // back to the tee
            const s = root.localGetTerrainAt ? root.localGetTerrainAt(p.x, -p.z) : null;
            spot = { x: p.x, z: p.z, y: (s && num(s.z) !== null) ? s.z : g.y, moved: p.moved, pin: { x: g.x, y: g.y, z: g.z }, hole: g.hole, dist: state.dist, lie: state.lie };
            if (root.onRangePracticeChange) root.onRangePracticeChange(spot);
            render();
        }

        function ensureBar() {
            if (bar) return bar;
            bar = document.createElement('div');
            bar.id = 'range-practice';
            bar.addEventListener('click', onClick);
            bar.addEventListener('change', onChange);
            ['pointerdown', 'pointerup', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) { bar.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
            document.body.appendChild(bar);
            return bar;
        }
        function render() {
            if (!bar || !ctx) return;
            const list = targets();
            let h = '';
            if (!list.length) h = '<div class="rp-hint">' + esc(t('none')) + '</div>';
            else if (!state.on) h = '<button class="rp-open" data-act="open">' + esc(t('open')) + '</button>';
            else {
                const g = current(), d = inUnit(state.dist, !!root.useMeters);
                h += '<select class="rp-green" aria-label="' + esc(t('green')) + '">' + list.map(function (x) {
                    return '<option value="' + x.hole + '"' + (x.hole === g.hole ? ' selected' : '') + '>' + esc(t('green')) + ' ' + x.n + (x.fromTee !== null ? ' · ' + fmt(x.fromTee) + ' ' + unit() : '') + '</option>';
                }).join('') + '</select>';
                h += '<div class="rp-dist"><button data-step="-5" aria-label="−5">−5</button><button data-step="-1" aria-label="−1">−1</button>' +
                     '<input type="number" class="rp-value" min="' + MIN + '" max="' + MAX + '" value="' + d + '" aria-label="' + esc(unit()) + '"><span class="rp-unit">' + unit() + '</span>' +
                     '<button data-step="1" aria-label="+1">+1</button><button data-step="5" aria-label="+5">+5</button></div>';
                h += '<div class="rp-presets">' + PRESETS.map(function (p) { return '<button data-preset="' + p + '" class="' + (p === d ? 'selected' : '') + '">' + p + '</button>'; }).join('') + '</div>';
                h += '<div class="rp-lie" role="group" aria-label="' + esc(t('lie')) + '"><button data-lie="mat" class="' + (state.lie === 'mat' ? 'selected' : '') + '">' + esc(t('mat')) + '</button>' +
                     '<button data-lie="ground" class="' + (state.lie === 'ground' ? 'selected' : '') + '">' + esc(t('ground')) + '</button></div>';
                h += '<button class="rp-close" data-act="close" title="' + esc(t('close')) + '" aria-label="' + esc(t('close')) + '">✕</button>';
                if (noSpot) h += '<div class="rp-note">' + esc(t('blocked')) + '</div>';
                else if (pending) h += '<div class="rp-note">' + esc(t('later')) + '</div>';
                else if (spot && spot.moved) h += '<div class="rp-note">' + esc(t('moved')) + '</div>';
            }
            bar.innerHTML = h;
            bar.classList.toggle('on', !!state.on && list.length > 0);
        }
        function setDist(metres) { state.dist = Math.max(toMetres(MIN, true), Math.min(MAX, metres)); save(); apply(); }
        function onClick(e) {
            const b = e.target.closest('button');
            if (!b) return;
            const unitM = root.useMeters ? 1 : 0.9144;
            if (b.dataset.act === 'open') {
                const g = current();
                state.on = true;
                if (g && (state.hole === null || state.hole === undefined)) state.hole = g.hole;
                save(); apply();
            } else if (b.dataset.act === 'close') { state.on = false; save(); apply(); }
            else if (b.dataset.step) setDist(toMetres(inUnit(state.dist, !!root.useMeters) + Number(b.dataset.step), !!root.useMeters));
            else if (b.dataset.preset) setDist(Number(b.dataset.preset) * unitM);
            else if (b.dataset.lie) { state.lie = b.dataset.lie; save(); apply(); }
        }
        function onChange(e) {
            const el = e.target;
            if (el.classList.contains('rp-green')) { state.hole = Number(el.value); save(); apply(); }
            else if (el.classList.contains('rp-value')) { const v = Number(el.value); if (isFinite(v)) setDist(toMetres(v, !!root.useMeters)); }
        }

        api.start = function (opts) {
            if (!opts || !opts.tee) return;
            ctx = { key: String(opts.key || 'draft'), tee: { x: opts.tee.x, y: opts.tee.y, z: opts.tee.z, rot: opts.tee.rot || 0 }, holes: opts.holes || function () { return []; } };
            load();
            ensureBar().style.display = '';
            apply();
        };
        api.stop = function () {
            if (bar) bar.style.display = 'none';
            if (spot && root.onRangePracticeChange) root.onRangePracticeChange(null);
            spot = null; ctx = null; pending = false; noSpot = false;
        };
        api.active = function () { return !!spot; };
        api.spot = function () { return spot; };
        // The shot that just came to rest at `rest` (scene x/z), on the green or not: scored against the pin, with the text to show
        api.score = function (rest, onGreen, holed) {
            if (!spot) return null;
            const r = result(rest, spot.pin, spot, onGreen || holed);
            r.dist = spot.dist; r.holed = !!holed;
            const u = ' ' + unit();
            if (holed) r.text = '🎯 ' + t('holed');
            else {
                const where = [];
                if (Math.abs(r.along) >= 1) where.push(fmt(Math.abs(r.along)) + u + ' ' + (r.along < 0 ? t('short') : t('long')));
                if (Math.abs(r.across) >= 1) where.push(fmt(Math.abs(r.across)) + u + ' ' + (r.across < 0 ? t('left') : t('right')));
                r.text = (r.onGreen ? '✅ ' + t('onGreen') : '❌ ' + t('miss')) + ' · ' + fmt(r.prox, 1) + u + ' ' + t('fromPin') + (r.onGreen || !where.length ? '' : ' · ' + where.join(', '));
            }
            return r;
        };
        api.settle = function () { if (pending && ctx) apply(); };   // the shot is scored: a change made during it now
        api.render = render;   // after a language or unit change
        api.refresh = function () { if (ctx) apply(); };   // the greens may have changed
        api.getState = function () { return Object.assign({}, state); };
        api.set = function (s) { if (!ctx) return; Object.assign(state, s || {}); save(); apply(); };   // for tests and voice commands
    }

    root.RangePractice = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
