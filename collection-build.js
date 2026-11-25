/**
 * A plate built for a place in a collection (window.CollectionBuild). The build page's "Bygg ny" on the next empty place of a 6, 9 or 18
 * hole course opens the new-course page and then the builder with ?collection=<id>&slot=<n>; a plate saved that way carries the same in
 * theme_data.collectionSlot, so opening it in the builder again brings the context back.
 * In the builder (autorun=new_build / edit_build only, never in a round) the context:
 *   - numbers the holes for their place: plate n holds holes 3n+1..3n+3 (window._holeNumberOffset, as when the collection is played)
 *   - gives the blueprint map the other plates (GET /api/collections/<id>/card): its scorecard shows them and the whole course, and its
 *     par suggestion balances the whole course (parTargets: about 4 par 3s, 10 par 4s and 4 par 5s in 18 holes)
 *   - on publish puts the plate in its place in the collection (afterPublish)
 * A bar under the top bar names the collection and the place and goes to the plate before and after it (or builds the next one once
 * this plate is in the collection), so a whole 18 hole course can be built in one go (navTargets, renderBar).
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
    // the course being edited: the address (?edit=) or, when a working copy was continued without one (the build page's quick-draft
    // continuation), the code arcade-load.js restored into arcade.html's currentEditCode
    function editCode() {
        let c = query().get('edit');
        if (!c) { try { c = typeof currentEditCode !== 'undefined' ? currentEditCode : null; } catch (e) { c = null; } }   // eslint-disable-line no-undef
        return String(c || '').toUpperCase();
    }
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
        renderBar();
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
        renderBar();
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
            if (codes.indexOf(code) >= 0) { await refreshCard(); return true; }   // already there (published again)
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
            await refreshCard();   // the bar can now offer the next plate
            toast(tr('cb_added', '🧩 Plattan ligger nu på plats {p} i {n}.').replace('{p}', at + 1).replace('{n}', col.name || ''), '#4ade80');
            return true;
        } catch (e) {
            toast(tr('cb_add_failed', '⚠️ Plattan publicerades men kunde inte läggas till i samlingen. Lägg till den på byggsidan.'), '#f59e0b');
            return false;
        }
    }

    async function refreshCard() {
        if (!ctx) return;
        try { const card = await fetchCard(ctx.id); if (card && ctx) ctx.card = card; } catch (e) { /* the old card stays */ }
        renderBar();
    }

    // ---- moving between the plates of the collection ------------------------------------------------------------------------------
    // Where the bar's buttons go: { prev, next } with { slot, url, kind: 'edit' | 'build' } each, or null; next can also be
    // { slot, kind: 'publish_first' } (the next place is empty and this plate is not in the collection yet: a new plate built now would
    // take this plate's place). A plate is opened in the builder with its place in the address, so the context comes along.
    function navTargets() {
        if (!ctx || !ctx.card) return null;
        const c = ctx.card, at = ctx.slot, code = editCode();
        const inCollection = !!(c.plates[at] && c.plates[at].code === code);
        const edit = function (slot) {
            return { slot: slot, kind: 'edit', url: 'arcade.html?v=' + Date.now() + '&autorun=edit_build&edit=' + encodeURIComponent(c.plates[slot].code) +
                '&collection=' + encodeURIComponent(ctx.id) + '&slot=' + slot };
        };
        const prev = at > 0 && c.plates[at - 1] ? edit(at - 1) : null;
        let next = null;
        if (c.plates[at + 1]) next = edit(at + 1);
        else if (at + 1 < c.room && at + 1 === c.filled && inCollection) {
            const world = c.plates[0] && c.plates[0].world;
            next = { slot: at + 1, kind: 'build', url: 'new_course.html?collection=' + encodeURIComponent(ctx.id) + '&slot=' + (at + 1) + (world ? '&world=' + world : '') };
        } else if (at + 1 < c.room && !inCollection) next = { slot: at + 1, kind: 'publish_first' };
        return { prev: prev, next: next, inCollection: inCollection };
    }
    // Leaving the plate: the builder keeps one working copy on the device, so changes not saved to the server would be lost
    function go(url) {
        if (root.hasUnsavedChanges && typeof root.confirm === 'function' &&
            !root.confirm(tr('cb_leave_unsaved', 'Plattan har ändringar som inte är sparade (Publicera eller Spara utkast). De försvinner om du byter platta. Byta ändå?'))) return;
        root.location.href = url;
    }
    function playing() { const m = typeof root.getAppMode === 'function' ? root.getAppMode() : 'BUILD'; return m === 'PLAY' || m === 'TEST'; }
    // "🧩 Sjöbanan · platta 4 av 6 (hål 10–12)" with ← and → beside it, under the top bar; only in the builder, only with a context
    function renderBar() {
        const doc = root.document;
        if (!doc || !doc.body) return;
        let bar = doc.getElementById('cb-bar');
        const nav = navTargets();
        if (!ctx || !ctx.card || !nav) { if (bar) bar.remove(); return; }
        if (!bar) {
            bar = doc.createElement('div');
            bar.id = 'cb-bar';
            bar.setAttribute('role', 'navigation');
            bar.style.cssText = 'position:fixed; left:50%; transform:translateX(-50%); z-index:900; display:flex; align-items:center; gap:6px; max-width:calc(100vw - 24px); box-sizing:border-box; padding:4px; border-radius:14px; background:rgba(15,23,42,0.92); border:1px solid rgba(56,189,248,0.45); box-shadow:0 4px 14px rgba(0,0,0,0.45); font-family:Inter,system-ui,sans-serif; pointer-events:auto;';
            doc.body.appendChild(bar);
        }
        bar.setAttribute('aria-label', tr('cb_bar_label', 'Plattorna i samlingen'));
        // a phone has the hole tools' pill in the second row on the left: the bar goes below it, without the collection's name
        const narrow = (root.innerWidth || 1000) < 700;
        bar.style.top = narrow ? '100px' : '56px';
        bar.textContent = '';
        const mk = function (label, title, onclick, on) {
            const b = doc.createElement('button');
            b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
            b.disabled = !on;
            b.style.cssText = 'min-height:32px; padding:0 10px; border-radius:10px; border:1px solid #334155; background:' + (on ? '#1e293b' : 'transparent') + '; color:' + (on ? '#e0f2fe' : '#475569') + '; font-size:12px; font-weight:700; white-space:nowrap; cursor:' + (on ? 'pointer' : 'default') + ';';
            if (on) b.onclick = onclick;
            return b;
        };
        const plateHoles = function (slot) { const f = slot * PER_PLATE + 1; return tr('cb_holes', 'hål {a}–{b}').replace('{a}', f).replace('{b}', f + PER_PLATE - 1); };
        const prev = nav.prev
            ? mk('← ' + tr('cb_plate', 'Platta') + ' ' + (nav.prev.slot + 1), tr('cb_open_plate', 'Öppna platta {p} ({h})').replace('{p}', nav.prev.slot + 1).replace('{h}', plateHoles(nav.prev.slot)), function () { go(nav.prev.url); }, true)
            : mk('←', tr('cb_first_plate', 'Det här är den första plattan'), null, false);
        prev.dataset.role = 'cb-prev';
        const mid = doc.createElement('span');
        mid.style.cssText = 'color:#f1f5f9; font-size:12px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; padding:0 4px;';
        const full = '🧩 ' + (ctx.card.name ? ctx.card.name + ' · ' : '') + tr('cb_plate_of', 'platta {p} av {n}').replace('{p}', ctx.slot + 1).replace('{n}', ctx.card.room) + ' (' + plateHoles(ctx.slot) + ')';
        mid.textContent = narrow ? '🧩 ' + (ctx.slot + 1) + '/' + ctx.card.room + ' · ' + plateHoles(ctx.slot) : full;
        mid.title = full;
        let next;
        if (nav.next && nav.next.kind === 'edit') next = mk(tr('cb_plate', 'Platta') + ' ' + (nav.next.slot + 1) + ' →', tr('cb_open_plate', 'Öppna platta {p} ({h})').replace('{p}', nav.next.slot + 1).replace('{h}', plateHoles(nav.next.slot)), function () { go(nav.next.url); }, true);
        else if (nav.next && nav.next.kind === 'build') next = mk('🛠️ ' + tr('cb_build_plate', 'Bygg platta {p}').replace('{p}', nav.next.slot + 1) + ' →', tr('cb_build_plate_t', 'Bygg en ny platta för {h}').replace('{h}', plateHoles(nav.next.slot)), function () { go(nav.next.url); }, true);
        else if (nav.next && nav.next.kind === 'publish_first') next = mk('→', tr('cb_publish_first', 'Publicera den här plattan först: då hamnar den på plats {p} och nästa platta kan byggas').replace('{p}', ctx.slot + 1), null, false);
        else next = mk('→', tr('cb_last_plate', 'Det här är den sista plattan'), null, false);
        next.dataset.role = 'cb-next';
        [prev, mid, next].forEach(function (el) { bar.appendChild(el); });
        bar.style.display = playing() ? 'none' : 'flex';
    }
    // the bar is for the builder: hidden while a round is played or tested
    if (root.addEventListener) root.addEventListener('resize', function () { if (root.document && root.document.getElementById('cb-bar')) renderBar(); });
    if (typeof setInterval === 'function' && root.document) setInterval(function () { const bar = root.document.getElementById('cb-bar'); if (bar) bar.style.display = playing() ? 'none' : 'flex'; }, 800);

    root.CollectionBuild = { start: start, get: function () { return ctx; }, others: others, parTargets: parTargets, themeData: themeData, afterPublish: afterPublish, clear: clear, placeIn: placeIn, navTargets: navTargets, renderBar: renderBar };

    // a new plate for a place (the new-course page passes it on)
    function fromUrl() {
        const q = query();
        if (builderMode() && q.get('collection')) start(q.get('collection'), q.get('slot'));
    }
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', fromUrl);
    else if (root.document) setTimeout(fromUrl, 0);
})(typeof window !== 'undefined' ? window : globalThis);
