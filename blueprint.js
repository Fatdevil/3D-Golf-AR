/*
 * Blueprint map: look down on the whole base plate, drag a hole sketch to where you want it, then build it.
 * The sketch is the same shape the random generator would build (HoleGenerator.planFor); the map only decides
 * WHERE it stands. Every position is checked live with HoleGenerator.evaluateSite (water, slope, other holes,
 * map edge) and a release on a bad spot glides to the closest good one, so the map is never left invalid.
 */
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;

    const COLORS = { ok: '#4ade80', bad: '#f87171' };
    let S = null;   // open sketch state

    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function toast(msg, color) { if (typeof root.showBuildToast === 'function') root.showBuildToast(msg, color || '#38bdf8'); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // ---- terrain picture (rendered once when the map opens) ---------------------------------------------
    function renderTerrain(half) {
        const N = 150, size = half * 2, cell = size / N;
        const hgt = new Float32Array(N * N), wet = new Uint8Array(N * N);
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
            const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null;
            const h = s && typeof s.z === 'number' ? s.z : 0;
            hgt[j * N + i] = h;
            if (s && s.type === 'WATER') wet[j * N + i] = 1;
            else { if (h < lo) lo = h; if (h > hi) hi = h; }
        }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        // colour by height relative to the typical land level: flat ground reads green, hills tan, dips dark green
        const land = [];
        for (let k = 0; k < hgt.length; k += 7) if (!wet[k]) land.push(hgt[k]);
        land.sort(function (a, b) { return a - b; });
        const med = land.length ? land[land.length >> 1] : lo;
        const span = Math.max(8, (hi - lo) * 0.5);
        const off = document.createElement('canvas');
        off.width = N; off.height = N;
        const octx = off.getContext('2d');
        const img = octx.createImageData(N, N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const k = j * N + i, p = k * 4;
            if (wet[k]) { img.data[p] = 56; img.data[p + 1] = 130; img.data[p + 2] = 230; img.data[p + 3] = 255; continue; }
            const hl = hgt[j * N + Math.max(0, i - 1)], hr = hgt[j * N + Math.min(N - 1, i + 1)];
            const hu = hgt[Math.max(0, j - 1) * N + i], hd = hgt[Math.min(N - 1, j + 1) * N + i];
            // light from the upper left: slopes facing it are brighter
            const shade = clamp(1 + ((hl - hr) + (hu - hd)) / cell * 2.2, 0.55, 1.45);
            const t = clamp((hgt[k] - med) / span, -1, 1);
            const up = Math.max(0, t), down = Math.max(0, -t);
            const r = (84 + 80 * up - 30 * down) * shade, g = (140 - 15 * up - 30 * down) * shade, b = (74 + 10 * up - 10 * down) * shade;
            img.data[p] = clamp(r, 0, 255); img.data[p + 1] = clamp(g, 0, 255); img.data[p + 2] = clamp(b, 0, 255); img.data[p + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        return off;
    }

    // ---- geometry helpers --------------------------------------------------------------------------------
    function distToSegment(px, pz, a, b) {
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        const t = l2 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
        return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    }
    function onSketch(wx, wz) {
        const wp = S.ev && S.ev.world;
        if (!wp) return false;
        const HG = root.HoleGenerator;
        const polys = [wp.green].concat(wp.fairway ? [wp.fairway] : [], wp.teeBoxes || []);
        if (polys.some(function (p) { return HG.inPoly(wx, wz, p); })) return true;
        for (let i = 0; i < wp.centerline.length - 1; i++) if (distToSegment(wx, wz, wp.centerline[i], wp.centerline[i + 1]) < 14 * S.mPerPx) return true;
        return false;
    }

    // ---- drawing -----------------------------------------------------------------------------------------
    function cx(x) { return (x + S.half) / S.size * S.C; }
    function cz(z) { return (z + S.half) / S.size * S.C; }
    function polyPath(ctx, pts) {
        ctx.beginPath();
        pts.forEach(function (p, i) { if (i) ctx.lineTo(cx(p.x), cz(p.z)); else ctx.moveTo(cx(p.x), cz(p.z)); });
        ctx.closePath();
    }
    function draw() {
        if (!S) return;
        const ctx = S.ctx, C = S.C;
        ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(S.terrain, 0, 0, C, C);
        // 100 m grid
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
        for (let g = -200; g <= 200; g += 100) {
            ctx.beginPath(); ctx.moveTo(cx(g), 0); ctx.lineTo(cx(g), C); ctx.moveTo(0, cz(g)); ctx.lineTo(C, cz(g)); ctx.stroke();
        }
        // holes already on the course
        const others = S.env.others || { points: [], polygons: [] };
        ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        (others.polygons || []).forEach(function (poly) { polyPath(ctx, poly); ctx.fill(); ctx.stroke(); });
        (others.points || []).forEach(function (p) { ctx.beginPath(); ctx.arc(cx(p.x), cz(p.z), 3, 0, 7); ctx.fill(); });

        const ev = S.ev, wp = ev && ev.world;
        if (!wp) return;
        const col = ev.ok ? COLORS.ok : COLORS.bad;
        ctx.lineWidth = 2; ctx.strokeStyle = col;
        // fairway
        if (wp.fairway) { polyPath(ctx, wp.fairway); ctx.fillStyle = ev.ok ? 'rgba(74,222,128,0.38)' : 'rgba(248,113,113,0.38)'; ctx.fill(); ctx.stroke(); }
        // centre line (also shows the route on a par 3)
        ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath();
        wp.centerline.forEach(function (p, i) { if (i) ctx.lineTo(cx(p.x), cz(p.z)); else ctx.moveTo(cx(p.x), cz(p.z)); });
        ctx.stroke(); ctx.setLineDash([]);
        // bunkers, green, tee boxes
        ctx.strokeStyle = col;
        wp.bunkers.forEach(function (b) { polyPath(ctx, b); ctx.fillStyle = 'rgba(253,230,138,0.9)'; ctx.fill(); ctx.stroke(); });
        polyPath(ctx, wp.green); ctx.fillStyle = ev.ok ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.8)'; ctx.fill(); ctx.stroke();
        (wp.teeBoxes || []).forEach(function (b) { polyPath(ctx, b); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); });
        // handles: T = tee (drag to move), G = green (drag to turn)
        const tee = { x: cx(S.origin.x), y: cz(S.origin.z) }, gc = { x: cx(wp.greenCenter.x), y: cz(wp.greenCenter.z) };
        const handle = function (pt, label, fill) {
            ctx.beginPath(); ctx.arc(pt.x, pt.y, 15, 0, 7); ctx.fillStyle = fill; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = '#0f172a'; ctx.stroke();
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, pt.x, pt.y + 1);
        };
        handle(tee, 'T', '#f8fafc');
        handle(gc, 'G', '#38bdf8');
        S.handles = { tee: tee, green: gc };
    }

    // ---- status chip & buttons ---------------------------------------------------------------------------
    function reasonText(r) {
        if (r === 'bounds') return tr('bp_r_bounds', 'Utanför banan');
        if (r === 'close') return tr('bp_r_close', 'För nära ett annat hål');
        if (r === 'water') return tr('bp_r_water', 'Vatten i vägen');
        if (/_range$/.test(r)) return tr('bp_r_range', 'För ojämn mark');
        return tr('bp_r_slope', 'För brant');
    }
    function setStatus(text, ok) {
        const el = S.dom.status;
        el.textContent = text;
        el.style.background = ok === true ? 'rgba(34,197,94,0.18)' : (ok === false ? 'rgba(239,68,68,0.18)' : 'rgba(148,163,184,0.18)');
        el.style.color = ok === true ? '#86efac' : (ok === false ? '#fca5a5' : '#cbd5e1');
    }
    function refreshUi() {
        if (!S) return;
        const ev = S.ev;
        if (S.busy) setStatus(tr('bp_searching', '⏳ Letar bra plats…'), null);
        else if (S.note) setStatus(S.noteBad ? '⛔ ' + S.note : S.note, !S.noteBad);
        else if (ev && ev.ok) setStatus('✓ ' + tr('bp_ok', 'Bra plats!'), true);
        else if (ev) setStatus('⛔ ' + reasonText(ev.reasons[0]), false);
        const can = !!(ev && ev.ok) && !S.busy;
        S.dom.build.disabled = !can;
        S.dom.build.style.opacity = can ? '1' : '0.45';
        S.dom.build.style.cursor = can ? 'pointer' : 'not-allowed';
        S.dom.parBtns.forEach(function (b) {
            const on = Number(b.dataset.par) === S.par;
            b.style.background = on ? '#38bdf8' : '#1e293b';
            b.style.color = on ? '#0f172a' : '#e2e8f0';
        });
        draw();
    }

    // ---- state changes -----------------------------------------------------------------------------------
    function evaluate() {
        S.ev = root.HoleGenerator.evaluateSite(S.plan, S.origin, S.heading, S.env);
    }
    function snapToValid(announce) {
        S.busy = true; refreshUi();
        const token = ++S.snapToken;
        setTimeout(function () {
            if (!S || token !== S.snapToken) return;
            const nv = root.HoleGenerator.nearestValidSite(S.plan, S.origin, S.heading, S.env);
            S.busy = false;
            if (nv) {
                S.origin = nv.origin; S.heading = nv.heading;
                evaluate();
                if (announce) flashNote(tr('bp_moved', 'Flyttade till närmaste lediga plats'));
            } else {
                evaluate();
                flashNote(tr('bp_none', 'Ingen ledig plats här – flytta hålet'), true);
            }
            refreshUi();
        }, 30);
    }
    // A short message in the status chip. bad = nothing fits (stays until the user touches the map)
    function flashNote(text, bad) {
        S.note = text; S.noteBad = !!bad;
        clearTimeout(S.noteTimer);
        if (text && !bad) S.noteTimer = setTimeout(function () { if (S) { S.note = null; refreshUi(); } }, 2500);
    }
    function newShape() {
        S.seed = Math.floor(Math.random() * 1e9);
        S.plan = root.HoleGenerator.planFor(S.par, S.seed);
        evaluate();
        if (!S.ev.ok) snapToValid(true); else refreshUi();
    }
    function setPar(par) {
        if (par === S.par) return;
        S.par = par;
        newShape();
    }
    function turn(delta) {
        S.heading += delta;
        evaluate();
        if (!S.ev.ok) snapToValid(true); else refreshUi();
    }
    function suggest() {
        const HG = root.HoleGenerator;
        S.busy = true; refreshUi();
        setTimeout(function () {
            if (!S) return;
            const rng = HG.mulberry32((S.seed ^ 0x5bd1e995) >>> 0);
            const res = HG.place(S.plan, rng, S.env);
            S.busy = false;
            if (res) { S.origin = { x: res.origin.x, z: res.origin.z }; S.heading = res.heading; }
            else { S.origin = { x: -S.plan.length / 2, z: 0 }; S.heading = 0; }
            evaluate();
            if (!res) flashNote(tr('bp_none', 'Ingen ledig plats här – flytta hålet'), true);
            refreshUi();
        }, 40);
    }

    // ---- pointer handling --------------------------------------------------------------------------------
    function toWorldPt(e) {
        const r = S.canvas.getBoundingClientRect();
        const px = (e.clientX - r.left) * (S.C / r.width), py = (e.clientY - r.top) * (S.C / r.height);
        return { px: px, py: py, x: px / S.C * S.size - S.half, z: py / S.C * S.size - S.half };
    }
    function onDown(e) {
        if (!S || S.busy) return;
        e.preventDefault();
        const p = toWorldPt(e);
        S.snapToken++; S.note = null; S.noteBad = false;
        const near = function (h) { return h && Math.hypot(p.px - h.x, p.py - h.y) < 24; };
        if (near(S.handles && S.handles.green)) S.drag = { mode: 'rotate' };
        else if (near(S.handles && S.handles.tee) || onSketch(p.x, p.z)) S.drag = { mode: 'move', dx: S.origin.x - p.x, dz: S.origin.z - p.z };
        else { S.drag = { mode: 'move', dx: 0, dz: 0 }; S.origin = { x: p.x, z: p.z }; }
        try { S.canvas.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        queueEval();
    }
    function onMove(e) {
        if (!S || !S.drag) return;
        e.preventDefault();
        const p = toWorldPt(e);
        if (S.drag.mode === 'move') S.origin = { x: p.x + S.drag.dx, z: p.z + S.drag.dz };
        else {
            const gc = S.plan.greenCenter, phi = Math.atan2(gc.l, gc.f);
            S.heading = Math.atan2(p.z - S.origin.z, p.x - S.origin.x) - phi;
        }
        queueEval();
    }
    function onUp(e) {
        if (!S || !S.drag) return;
        S.drag = null;
        evaluate();
        if (!S.ev.ok) snapToValid(true); else refreshUi();
    }
    function queueEval() {
        if (S.raf) return;
        S.raf = requestAnimationFrame(function () {
            if (!S) return;
            S.raf = 0;
            evaluate();
            refreshUi();
        });
    }

    // ---- build -------------------------------------------------------------------------------------------
    function build() {
        if (!S || !S.ev || !S.ev.ok || S.busy) return;
        const par = S.par, seed = S.seed, placement = { x: S.origin.x, z: S.origin.z, heading: S.heading };
        const hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        close(true);
        if (hole && hole.par !== par && typeof root.changeHolePar === 'function') root.changeHolePar(par - hole.par);
        toast(tr('hg_busy', '⏳ Bygger hålet…'), '#a855f7');
        const parts = root._hgParts || null;
        setTimeout(function () { root.HoleGenerator.generate({ par: par, seed: seed, parts: parts, placement: placement }); }, 80);
    }

    // ---- open / close ------------------------------------------------------------------------------------
    function btn(label, onclick, extra) {
        const b = document.createElement('button');
        b.type = 'button'; b.innerHTML = label; b.onclick = onclick;
        b.style.cssText = 'min-height:44px; min-width:44px; padding:0 14px; border:none; border-radius:10px; font-weight:bold; font-size:14px; cursor:pointer; background:#1e293b; color:#e2e8f0;' + (extra || '');
        return b;
    }
    function close(fade) {
        if (!S) return;
        const el = S.dom.overlay;
        window.removeEventListener('keydown', S.keyHandler, true);
        cancelAnimationFrame(S.raf); clearTimeout(S.noteTimer);
        S = null;
        if (fade) { el.style.opacity = '0'; el.style.transform = 'scale(1.06)'; setTimeout(function () { el.remove(); }, 380); }
        else el.remove();
    }
    function open() {
        const HG = root.HoleGenerator;
        const hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        if (!HG || !hole) return;
        if (!HG.holeIsEmpty(hole)) { toast(tr('hg_not_empty', '⚠️ Hålet har redan delar. Gå till ett tomt hål för att slumpa.'), '#f59e0b'); return; }
        if (S) close(false);
        const half = (root.TERRAIN_SIZE || 600) / 2;
        const par = clamp(hole.par || 4, 3, 6);
        const seed = Math.floor(Math.random() * 1e9);
        const C = Math.max(240, Math.floor(Math.min(window.innerWidth - 16, window.innerHeight - 290, 760)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);

        const overlay = document.createElement('div');
        overlay.id = 'bp-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:#020617; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:8px; box-sizing:border-box; overflow-y:auto; transition:opacity .35s, transform .35s; touch-action:none; user-select:none; -webkit-user-select:none;';
        const head = document.createElement('div');
        head.style.cssText = 'width:' + C + 'px; display:flex; align-items:center; justify-content:space-between; gap:8px; color:#f1f5f9;';
        head.innerHTML = '<b style="font-size:16px;">🗺️ ' + tr('bp_title', 'Planera hålet') + '</b>';
        const status = document.createElement('div');
        status.style.cssText = 'flex:1; text-align:center; padding:6px 8px; border-radius:8px; font-size:13px; font-weight:bold;';
        head.appendChild(status);
        const x = btn('✕', function () { close(true); }, 'min-width:44px;');
        x.title = tr('bp_cancel', 'Avbryt');
        head.appendChild(x);
        const help = document.createElement('div');
        help.style.cssText = 'width:' + C + 'px; color:#94a3b8; font-size:12px; line-height:1.35;';
        help.textContent = tr('bp_help', 'Dra hålet dit du vill ha det. Dra i den blå pricken (G) för att vrida. Tryck på kartan för att flytta teen dit.');
        const canvas = document.createElement('canvas');
        canvas.width = C * dpr; canvas.height = C * dpr;
        // arcade.css pins every <canvas> to the viewport with !important, so this one must override it
        canvas.style.cssText = 'position:relative !important; top:auto !important; left:auto !important; width:' + C + 'px !important; height:' + C + 'px !important; flex:none; border-radius:12px; border:2px solid #334155; touch-action:none; cursor:grab; background:#0f172a !important;';
        const bar = document.createElement('div');
        bar.style.cssText = 'width:' + C + 'px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; justify-content:center;';
        const parBtns = [3, 4, 5].concat(par === 6 ? [6] : []).map(function (n) {
            const b = btn('Par ' + n, function () { setPar(n); });
            b.dataset.par = n;
            return b;
        });
        parBtns.forEach(function (b) { bar.appendChild(b); });
        const reroll = btn('🎲 ' + tr('bp_reroll', 'Annan form'), function () { if (!S.busy) newShape(); });
        const left = btn('⟲', function () { if (!S.busy) turn(-Math.PI / 12); });
        const right = btn('⟳', function () { if (!S.busy) turn(Math.PI / 12); });
        left.title = tr('bp_turn_l', 'Vrid åt vänster'); right.title = tr('bp_turn_r', 'Vrid åt höger');
        bar.appendChild(reroll); bar.appendChild(left); bar.appendChild(right);
        const build_ = btn('⛳ ' + tr('bp_build', 'Bygg hålet'), build, 'width:' + C + 'px; background:linear-gradient(90deg,#16a34a,#22c55e); color:#fff; font-size:16px; min-height:52px;');
        build_.dataset.role = 'build';
        overlay.appendChild(head); overlay.appendChild(help); overlay.appendChild(canvas); overlay.appendChild(bar); overlay.appendChild(build_);
        document.body.appendChild(overlay);

        const env = HG.siteEnv(root._hgParts || null);
        S = {
            dom: { overlay: overlay, status: status, build: build_, parBtns: parBtns },
            canvas: canvas, ctx: canvas.getContext('2d'), C: C, dpr: dpr, half: half, size: half * 2, mPerPx: half * 2 / C,
            env: env, par: par, seed: seed, plan: HG.planFor(par, seed),
            origin: { x: 0, z: 0 }, heading: 0, ev: null, drag: null, busy: false, snapToken: 0, raf: 0, note: null,
            terrain: renderTerrain(half), handles: null
        };
        S.keyHandler = function (e) { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'Escape') close(true); e.stopImmediatePropagation(); };
        window.addEventListener('keydown', S.keyHandler, true);
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
        draw();
        suggest();
    }

    root.openHoleBlueprint = open;
    root.HoleBlueprint = { open: open, close: close, state: function () { return S; }, build: build };
})(typeof window !== 'undefined' ? window : globalThis);
