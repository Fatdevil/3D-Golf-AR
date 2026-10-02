/*
 * Next-step guide: one small chip in the builder that always says what to do next and does it with one tap.
 * The steps follow the way a plate is built: place the holes, build the surroundings, add nature, then test and
 * publish. Everything it opens already exists (Placera på karta, Bakgrund, the Props tool); the guide only decides
 * what is worth suggesting now, from the state of the course. A tap on the arrow lists all steps; the cross hides
 * the guide down to a small compass that brings it back.
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
    function writeHidden(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* storage may be blocked */ } }

    // ---- the state of the course -----------------------------------------------------------------------------
    function holeCount() {
        const HG = root.HoleGenerator, holes = root.courseHoles || [];
        const total = Math.min(root.MAX_HOLES || 3, holes.length);
        let built = 0;
        for (let i = 0; i < total; i++) if (HG && holes[i] && !HG.holeIsEmpty(holes[i])) built++;
        return { built: built, total: total };
    }
    function hasSurroundings() {
        if (typeof root.getSceneryMaxRadius === 'function' && root.getSceneryMaxRadius() > 0) return true;
        const c = root.surroundConfig;
        return !!c && ['N', 'E', 'S', 'W'].some(function (k) { return c[k] && c[k] !== 'roughColor'; });
    }
    function natureCount() { return (root.placedTrees || []).length; }

    function steps() {
        const h = holeCount();
        return [
            { id: 'holes', done: h.built >= 1, optionalMore: h.built >= 1 && h.built < h.total,
              label: tr('g_holes', 'Placera hålen'),
              info: h.built ? tr('g_holes_n', '{n} av {m} hål byggda').replace('{n}', h.built).replace('{m}', h.total) : '',
              button: h.built ? tr('g_add_hole', 'Nästa hål') : tr('g_open', 'Öppna'),
              run: placeHole },
            { id: 'surround', done: hasSurroundings(),
              label: tr('g_surround', 'Bygg omgivningen'), info: '', button: tr('g_open', 'Öppna'),
              run: function () { if (typeof root.openBackdropMap === 'function') root.openBackdropMap(); } },
            { id: 'nature', done: natureCount() >= NATURE_COUNT, optional: true,
              label: tr('g_nature', 'Lägg till natur'), info: tr('g_optional', 'valfritt'), button: tr('g_open', 'Öppna'),
              run: function () { if (typeof root.setTool === 'function') root.setTool('PROPS'); } },
            { id: 'play', done: false,
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

    // The first empty hole (the current one if it is empty), then the map for it
    function placeHole() {
        const HG = root.HoleGenerator, holes = root.courseHoles || [];
        if (!HG || typeof root.openHoleBlueprint !== 'function') return;
        const total = Math.min(root.MAX_HOLES || 3, holes.length);
        let idx = -1;
        if (holes[root.currentHoleIndex] && HG.holeIsEmpty(holes[root.currentHoleIndex]) && root.currentHoleIndex < total) idx = root.currentHoleIndex;
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
        host.style.display = (mode === 'BUILD' && !overlay) ? 'block' : 'none';
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
        main.onclick = function () { next.run(); };
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
            go.onclick = function () { s.run(); };
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
