/*
 * Next-step guide: one small chip in the builder that always says what to do next and does it with one tap.
 * The steps follow the way a plate is built: place the holes, build the surroundings, add nature, then test and
 * publish. Everything it opens already exists (Placera på karta, Bakgrund, the Props tool); the guide only decides
 * what is worth suggesting now, from the state of the course. A tap on the arrow lists all steps; "Dölj guiden"
 * shrinks it to a small compass that brings it back.
 */
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;

    const NATURE_COUNT = 15;      // placed objects before "add nature" counts as done
    const KEY = 'golfGuideHidden';
    let host = null, listOpen = false, hidden = false, lastSig = '';

    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function click(id) { const b = document.getElementById(id); if (b) b.click(); }
    function readHidden() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
    // A driving range has no holes to place, so the course guide stays out of its way
    function isRange() { return root._isRangeMode || new URLSearchParams(root.location.search).get('mode') === 'range'; }
    function writeHidden(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* storage may be blocked */ } }

    // ---- the state of the course -----------------------------------------------------------------------------
    // The playtest gate in setMode() needs a tee and a flag; publishing also needs the tees in distance order
    // (red closest to the flag, then yellow, white, black). A hole is only "playable" here when both hold.
    const TEE_ORDER = ['red', 'yellow', 'white', 'black'];
    function teesInOrder(h) {
        const d = {};
        TEE_ORDER.forEach(function (k) { if (h.tees[k]) d[k] = Math.hypot(h.tees[k].x - h.flag.x, h.tees[k].z - h.flag.z); });
        const keys = Object.keys(d);
        for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
            if (TEE_ORDER.indexOf(keys[a]) < TEE_ORDER.indexOf(keys[b]) && d[keys[a]] > d[keys[b]]) return false;
        }
        return true;
    }
    function isPlayable(h) {
        const t = h && h.tees;
        return !!(h && h.flag && t && (t.yellow || t.white || t.red || t.black)) && teesInOrder(h);
    }
    function holeCount() {
        const HG = root.HoleGenerator, holes = root.courseHoles || [];
        const total = Math.min(root.MAX_HOLES || 3, holes.length);
        let built = 0, partial = -1;
        for (let i = 0; i < total; i++) {
            if (isPlayable(holes[i])) built++;
            else if (HG && holes[i] && !HG.holeIsEmpty(holes[i]) && partial < 0) partial = i;
        }
        // publishing needs Hole 1 to be playable, so the step is not done before it is
        return { built: built, total: total, partial: partial, first: isPlayable(holes[0]) };
    }
    // Surroundings count as built when a big figure stands outside the plate, an edge was changed on the backdrop
    // map, or an edge uses something other than the two start values (rough, deep rough)
    function hasSurroundings() {
        if (root._surroundTouched) return true;
        if (typeof root.hasOuterScenery === 'function' && root.hasOuterScenery()) return true;
        const c = root.surroundConfig;
        return !!c && ['N', 'E', 'S', 'W'].some(function (k) { return c[k] && c[k] !== 'roughColor' && c[k] !== 'fescueColor'; });
    }
    // objects on the plate itself (figures standing outside it belong to the surroundings step)
    function natureCount() {
        const half = (root.TERRAIN_SIZE || 600) / 2;
        return (root.placedTrees || []).filter(function (o) { return o && Math.abs(o.x) <= half && Math.abs(o.z) <= half; }).length;
    }

    function steps() {
        const h = holeCount();
        return [
            { id: 'holes', done: h.first && h.partial < 0, optionalMore: h.built >= 1 && h.built < h.total,
              label: (h.partial >= 0) ? tr('g_finish_hole', 'Slutför hålet (tee, green och flagga)') : tr('g_holes', 'Placera hålen'),
              info: h.built ? tr('g_holes_n', '{n} av {m} hål byggda').replace('{n}', h.built).replace('{m}', h.total) : '',
              button: (h.partial >= 0) ? tr('g_open', 'Öppna') : (h.built ? tr('g_add_hole', 'Nästa hål') : tr('g_open', 'Öppna')),
              run: (h.partial >= 0) ? function () { finishHole(h.partial); } : placeHole },
            { id: 'surround', done: hasSurroundings(),
              label: tr('g_surround', 'Bygg omgivningen'), info: '', button: tr('g_open', 'Öppna'),
              run: function () { if (typeof root.openBackdropMap === 'function') root.openBackdropMap(); } },
            { id: 'nature', done: natureCount() >= NATURE_COUNT, optional: true,
              label: tr('g_nature', 'Lägg till natur'), info: tr('g_optional', 'valfritt'), button: tr('g_open', 'Öppna'),
              run: function () { if (typeof root.setTool === 'function') root.setTool('PROPS'); } },
            { id: 'play', done: !!root._courseTested && root._courseTested === (root.getCourseSignature && root.getCourseSignature()),
              label: tr('g_test', 'Testspela banan'), info: '', button: tr('g_test_short', 'Testspela'),
              run: function () { click('btn-mode-play'); } },
            { id: 'publish', done: false,
              label: tr('g_publish', 'Publicera'), info: '', button: tr('g_publish', 'Publicera'),
              run: function () { click('btn-publish'); } }
        ];
    }
    // The next thing worth doing: the first unfinished step that is not optional (nature is only ever offered)
    function nextStep(list) {
        for (let i = 0; i < list.length; i++) if (!list[i].done && !list[i].optional) return list[i];
        return list[list.length - 1];
    }

    // A hole that has some parts but no tee and flag yet: go to it with the hole tool
    function finishHole(idx) {
        if (idx !== root.currentHoleIndex && typeof root.changeHoleTo === 'function') root.changeHoleTo(idx);
        if (typeof root.setTool === 'function') root.setTool('SMART_BUILDER');
    }

    // The first empty hole (the current one if it is empty), then the map for it
    function placeHole() {
        const HG = root.HoleGenerator, holes = root.courseHoles || [];
        if (!HG || typeof root.openHoleBlueprint !== 'function') return;
        const total = Math.min(root.MAX_HOLES || 3, holes.length);
        let idx = -1;
        // Hole 1 first: a course cannot be published without it
        if (holes[0] && HG.holeIsEmpty(holes[0])) idx = 0;
        else if (holes[root.currentHoleIndex] && HG.holeIsEmpty(holes[root.currentHoleIndex]) && root.currentHoleIndex < total) idx = root.currentHoleIndex;
        for (let i = 0; idx < 0 && i < total; i++) if (HG.holeIsEmpty(holes[i])) idx = i;
        if (idx < 0) { if (typeof root.showBuildToast === 'function') root.showBuildToast(tr('g_all_holes', '✅ Alla hålen på plattan är byggda.'), '#4ade80'); return; }
        if (idx !== root.currentHoleIndex && typeof root.changeHoleTo === 'function') root.changeHoleTo(idx);
        setTimeout(root.openHoleBlueprint, 80);
    }

    // ---- drawing ---------------------------------------------------------------------------------------------
    function chipStyle(extra) {
        return 'border:none; cursor:pointer; font-weight:bold; color:#f1f5f9; ' + (extra || '');
    }
    function render() {
        if (!host) return;
        const mode = typeof root.getAppMode === 'function' ? root.getAppMode() : 'BUILD';
        const overlay = document.getElementById('bp-overlay') || document.getElementById('bd-overlay');
        host.style.display = (mode === 'BUILD' && !overlay && !isRange()) ? 'block' : 'none';
        if (host.style.display === 'none') return;
        const list = steps(), next = nextStep(list);
        const sig = [hidden, listOpen, next.id, list.map(function (s) { return s.done + s.info; }).join('|'), root.getGolfLanguage ? root.getGolfLanguage() : ''].join('#');
        if (sig === lastSig) return;
        lastSig = sig;
        host.textContent = '';
        if (hidden) {
            const icon = document.createElement('button');
            icon.type = 'button'; icon.textContent = '🧭';
            icon.title = tr('g_title', 'Nästa steg');
            icon.style.cssText = chipStyle('width:36px; height:36px; border-radius:18px; background:rgba(15,23,42,0.92); border:1px solid #475569; font-size:16px;');
            icon.onclick = function () { hidden = false; writeHidden(false); lastSig = ''; render(); };
            host.appendChild(icon);
            return;
        }
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:4px; align-items:stretch;';
        const main = document.createElement('button');
        main.type = 'button';
        main.textContent = '🧭 ' + (next.id === 'holes' && next.done ? tr('g_add_hole', 'Nästa hål') : next.label) + ' ›';
        main.style.cssText = chipStyle('min-height:36px; padding:0 14px; border-radius:18px; font-size:13px; background:linear-gradient(90deg,#0ea5e9,#6366f1); box-shadow:0 2px 10px rgba(0,0,0,0.35); max-width:62vw; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;');
        main.onclick = function () { nextStep(steps()).run(); };   // fresh state, not the one drawn a moment ago
        const more = document.createElement('button');
        more.type = 'button'; more.textContent = listOpen ? '▴' : '▾';
        more.title = tr('g_all_steps', 'Alla steg');
        more.style.cssText = chipStyle('width:36px; border-radius:18px; background:rgba(15,23,42,0.92); border:1px solid #475569; font-size:13px;');
        more.onclick = function () { listOpen = !listOpen; lastSig = ''; render(); };
        row.appendChild(main); row.appendChild(more);
        host.appendChild(row);
        if (!listOpen) return;
        const panel = document.createElement('div');
        panel.style.cssText = 'margin-top:6px; width:250px; max-width:80vw; background:rgba(15,23,42,0.96); border:1px solid #475569; border-radius:14px; padding:8px; box-shadow:0 6px 20px rgba(0,0,0,0.45); display:flex; flex-direction:column; gap:4px;';
        list.forEach(function (s) {
            const r = document.createElement('div');
            const isNext = s === next;
            r.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:10px; ' + (isNext ? 'background:rgba(56,189,248,0.15);' : '');
            const mark = document.createElement('span');
            mark.textContent = s.done ? '✓' : (isNext ? '▶' : '○');
            mark.style.cssText = 'width:16px; text-align:center; font-weight:bold; color:' + (s.done ? '#4ade80' : (isNext ? '#38bdf8' : '#64748b')) + ';';
            const txt = document.createElement('span');
            txt.style.cssText = 'flex:1; font-size:12px; line-height:1.25; color:' + (s.done ? '#94a3b8' : '#e2e8f0') + ';';
            txt.textContent = s.label + (s.info ? ' · ' + s.info : '');
            const go = document.createElement('button');
            go.type = 'button'; go.textContent = s.button;
            go.style.cssText = chipStyle('min-height:28px; padding:0 10px; border-radius:14px; font-size:11px; background:#1e293b; border:1px solid #475569;');
            go.onclick = function () {
                const fresh = steps().filter(function (x) { return x.id === s.id; })[0];
                (fresh || s).run();
            };
            r.appendChild(mark); r.appendChild(txt); r.appendChild(go);
            panel.appendChild(r);
        });
        const hide = document.createElement('button');
        hide.type = 'button'; hide.textContent = tr('g_hide', 'Dölj guiden');
        hide.style.cssText = chipStyle('align-self:flex-end; min-height:26px; padding:0 8px; border-radius:13px; font-size:10px; background:transparent; color:#94a3b8; font-weight:normal;');
        hide.onclick = function () { hidden = true; listOpen = false; writeHidden(true); lastSig = ''; render(); };
        panel.appendChild(hide);
        host.appendChild(panel);
    }

    function start() {
        if (host) return;
        hidden = readHidden();
        host = document.createElement('div');
        host.id = 'next-step-guide';
        // top left, under the toolbar row; above the side panels but below modals and the two maps
        host.style.cssText = 'position:fixed; top:58px; left:10px; z-index:900; display:none; font-family:inherit;';
        document.body.appendChild(host);
        setInterval(render, 1000);
        window.addEventListener('golf_lang_changed', function () { lastSig = ''; render(); });
        render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    root.NextStepGuide = { render: function () { lastSig = ''; render(); }, steps: steps, next: function () { return nextStep(steps()); } };
})(typeof window !== 'undefined' ? window : globalThis);
