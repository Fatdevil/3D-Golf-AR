/**
 * A plate built for a place in a collection (window.CollectionBuild). The build page's "Bygg ny" on the next empty place of a 6, 9 or 18
 * hole course opens the new-course page and then the builder with ?collection=<id>&slot=<n>; a plate saved that way carries the same in
 * theme_data.collectionSlot, so opening it in the builder again brings the context back.
 * In the builder (autorun=new_build / edit_build only, never in a round) the context:
 *   - numbers the holes for their place: plate n holds holes 3n+1..3n+3 (window._holeNumberOffset, as when the collection is played)
 *   - gives the blueprint map the other plates (GET /api/collections/<id>/card): its scorecard shows them and the whole course, and its
 *     par suggestion balances the whole course (parTargets: about 4 par 3s, 10 par 4s and 4 par 5s in 18 holes)
 *   - on publish puts the plate in its place in the collection (afterPublish)
 * The place is checked against the collection as it is now: a plate already in it keeps its own place, a new one goes right after the
 * plates there are (the list has no gaps), and a full collection drops the context.
 */
(function (root) {
    'use strict';
    const PER_PLATE = 3;
    let ctx = null;   // { id, slot, card } or null

    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function toast(msg, color) { if (typeof root.showBuildToast === 'function') root.showBuildToast(msg, color || '#38bdf8'); }
    function headers() { return (root.ArcadeAPI && root.ArcadeAPI._headers) ? root.ArcadeAPI._headers() : { 'Content-Type': 'application/json' }; }
    function query() { try { return new URLSearchParams(root.location ? root.location.search : ''); } catch (e) { return new URLSearchParams(''); } }
    function builderMode() { const a = query().get('autorun'); return a === 'new_build' || a === 'edit_build'; }
    function editCode() { return String(query().get('edit') || '').toUpperCase(); }
    function validId(id) { return /^[A-Za-z0-9_-]{1,32}$/.test(String(id || '')); }

    // The usual mix of pars for a course of n holes (the same as collections-core.js parTargets)
    function parTargets(n) {
        const short = Math.round(n * 4 / 18), long = Math.round(n * 4 / 18);
        return { 3: short, 4: Math.max(0, n - short - long), 5: long };
    }

    // the hole numbers on screen follow the place (topbar, hole menu, maps)
    function applyOffset() {
        root._holeNumberOffset = ctx ? ctx.slot * PER_PLATE : 0;
        if (typeof root.changeHoleTo === 'function' && root.courseHoles) {
            try { root.changeHoleTo(root.currentHoleIndex || 0); } catch (e) { /* the page is still loading */ }
        }
    }
    function clear() {
        ctx = null;
        root._buildCollection = null;
        applyOffset();
    }
    async function fetchCard(id) {
        const res = await fetch('/api/collections/' + encodeURIComponent(id) + '/card', { headers: headers() });
        return res.ok ? res.json() : null;
    }
    // The place this plate gets in the collection as it is now (see the header); -1 when it is full
    function placeIn(card, wanted, code) {
        const at = code ? card.plates.findIndex(function (p) { return p.code === code; }) : -1;
        if (at >= 0) return at;
        // the plate list has no gaps (collections-core.js): a new plate goes right after the ones there are, whatever place was asked for
        return card.filled < card.room ? card.filled : -1;
    }
    // opts.card: the collection's scorecard as given (tests); opts.quiet: no toast (opened again from a saved plate)
    async function start(id, slot, opts) {
        opts = opts || {};
        if (!validId(id) || (!builderMode() && !opts.card)) return null;
        ctx = { id: String(id).toUpperCase(), slot: Math.max(0, parseInt(slot, 10) || 0), card: null };
        root._buildCollection = ctx;
        applyOffset();
        let card = opts.card || null;
        if (!card) { try { card = await fetchCard(ctx.id); } catch (e) { card = null; } }
        if (!ctx || ctx.id !== String(id).toUpperCase()) return null;   // another start came first
        if (!card) return ctx;   // no card (offline): the numbers stay, the map plans the plate on its own
        const place = placeIn(card, ctx.slot, editCode());
        if (place < 0) {
            clear();
            toast(tr('cb_full', '⚠️ Samlingen har redan alla sina plattor: den här plattan byggs som en vanlig 3-hålsbana.'), '#f59e0b');
            return null;
        }
        ctx.slot = place;
        ctx.card = card;
        applyOffset();
        if (!opts.quiet) {
            const a = place * PER_PLATE + 1;
            toast(tr('cb_started', '🧩 Platta {p} av {n}: hål {a}–{b}. Publicera så hamnar den på sin plats.')
                .replace('{p}', place + 1).replace('{n}', card.name || '').replace('{a}', a).replace('{b}', a + PER_PLATE - 1), '#38bdf8');
        }
        return ctx;
    }
    // What the other plates bring: their holes before and after this plate, and the size of the whole course; null without a context
    function others() {
        if (!ctx || !ctx.card) return null;
        const first = ctx.slot * PER_PLATE + 1, last = first + PER_PLATE - 1;
        const sum = function (list) {
            return { par: list.reduce(function (a, h) { return a + h.par; }, 0), length: list.reduce(function (a, h) { return a + (h.length || 0); }, 0), holes: list.length,
                from: list.length ? list[0].no : 0, to: list.length ? list[list.length - 1].no : 0 };
        };
        const theirs = ctx.card.holes.filter(function (h) { return h.no < first || h.no > last; });
        return {
            before: sum(theirs.filter(function (h) { return h.no < first; })),
            after: sum(theirs.filter(function (h) { return h.no > last; })),
            pars: theirs.map(function (h) { return h.par; }),
            size: parseInt(ctx.card.type, 10) || 0,
            name: ctx.card.name || ''
        };
    }
    // what a save keeps of the context (theme_data.collectionSlot)
    function themeData() { return ctx ? { id: ctx.id, slot: ctx.slot } : undefined; }

    // After the plate was published: put it in its place in the collection (the server checks the list again)
    async function afterPublish(code, name) {
        if (!ctx || !code) return false;
        code = String(code).toUpperCase();
        try {
            const res = await fetch('/api/collections/' + encodeURIComponent(ctx.id), { headers: headers() });
            if (!res.ok) throw new Error('no collection');
            const col = await res.json();
            let plates = col.plates;
            if (typeof plates === 'string') plates = JSON.parse(plates);
            plates = Array.isArray(plates) ? plates.slice() : [];
            const codes = plates.map(function (p) { return String(typeof p === 'string' ? p : p.plate_code).toUpperCase(); });
            if (codes.indexOf(code) >= 0) return true;   // already there (published again)
            const room = Math.floor(parseInt(col.type, 10) / PER_PLATE);
            if (plates.length >= room) { toast(tr('cb_no_room', '⚠️ Samlingen är redan full: plattan publicerades men lades inte till.'), '#f59e0b'); return false; }
            const at = Math.min(ctx.slot, plates.length);
            plates.splice(at, 0, { plate_code: code, plate_name: name || '' });
            const saved = await fetch('/api/collections', {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ id: col.id, name: col.name, author: col.author, type: col.type, expect_existing: true, cover_image: col.cover_image, plates: plates })
            });
            if (!saved.ok) throw new Error('save refused');
            ctx.slot = at;
            applyOffset();
            toast(tr('cb_added', '🧩 Plattan ligger nu på plats {p} i {n}.').replace('{p}', at + 1).replace('{n}', col.name || ''), '#4ade80');
            return true;
        } catch (e) {
            toast(tr('cb_add_failed', '⚠️ Plattan publicerades men kunde inte läggas till i samlingen. Lägg till den på byggsidan.'), '#f59e0b');
            return false;
        }
    }

    root.CollectionBuild = { start: start, get: function () { return ctx; }, others: others, parTargets: parTargets, themeData: themeData, afterPublish: afterPublish, clear: clear, placeIn: placeIn };

    // a new plate for a place (the new-course page passes it on)
    function fromUrl() {
        const q = query();
        if (builderMode() && q.get('collection')) start(q.get('collection'), q.get('slot'));
    }
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', fromUrl);
    else if (root.document) setTimeout(fromUrl, 0);
})(typeof window !== 'undefined' ? window : globalThis);
