/*
 * Blueprint map: look down on the whole base plate, drag hole sketches to where you want them, then build them.
 * A sketch is the same shape the random generator would build (HoleGenerator.planFor); the map only decides
 * WHERE it stands. Every position is checked live with HoleGenerator.evaluateSite (water, slope, other holes,
 * other sketches, map edge) and a release on a bad spot glides to the closest good one, so the map is never
 * left invalid. Sketch k belongs to the k-th empty hole from the current one onward.
 */
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;

    const COLORS = { ok: '#4ade80', bad: '#f87171' };
    let S = null;   // open map state

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
        // colour by height relative to the typical land level: flat ground reads green, hills lighter, dips darker
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
            // light from the upper left, kept gentle so hills read as soft shapes
            const shade = clamp(1 + ((hl - hr) + (hu - hd)) / cell * 0.9, 0.82, 1.18);
            const t = clamp((hgt[k] - med) / span, -1, 1);
            const up = Math.max(0, t), down = Math.max(0, -t);
            const r = (86 + 34 * up - 14 * down) * shade, g = (142 + 8 * up - 24 * down) * shade, b = (76 + 6 * up - 8 * down) * shade;
            img.data[p] = clamp(r, 0, 255); img.data[p + 1] = clamp(g, 0, 255); img.data[p + 2] = clamp(b, 0, 255); img.data[p + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        return off;
    }

    // ---- sketches ----------------------------------------------------------------------------------------
    function cur() { return S.sketches[S.sel]; }
    function holeNo(i) { return S.holes[i] + 1; }
    // The base environment plus every OTHER sketch as an obstacle
    function envFor(i) {
        const HG = root.HoleGenerator, base = S.baseEnv;
        const others = { points: (base.others.points || []).slice(), polygons: (base.others.polygons || []).slice() };
        S.sketches.forEach(function (s, j) {
            if (j === i || !s.ev) return;
            const o = HG.obstaclesOf(s.ev.world);
            o.points.forEach(function (p) { others.points.push(p); });
            o.polygons.forEach(function (p) { others.polygons.push(p); });
        });
        return Object.assign({}, base, { others: others });
    }
    function evaluate(i) {
        const s = S.sketches[i];
        s.ev = root.HoleGenerator.evaluateSite(s.plan, s.origin, s.heading, envFor(i));
    }
    // A sketch that moved may have made room for (or taken room from) the others: refresh their cached results
    function revalidateOthers(except) {
        S.sketches.forEach(function (s, j) { if (j !== except && s.ev) evaluate(j); });
    }
    function makeSketch(par) {
        const seed = Math.floor(Math.random() * 1e9);
        return { par: par, seed: seed, plan: root.HoleGenerator.planFor(par, seed), origin: { x: 0, z: 0 }, heading: 0, ev: null };
    }

    // ---- geometry helpers --------------------------------------------------------------------------------
    function distToSegment(px, pz, a, b) {
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        const t = l2 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
        return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    }
    function hitSketch(sk, wx, wz) {
        const wp = sk.ev && sk.ev.world;
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
    function badge(ctx, pt, label, fill, r) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, 7); ctx.fillStyle = fill; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#0f172a'; ctx.stroke();
        ctx.fillStyle = '#0f172a'; ctx.font = 'bold ' + Math.round(r * 0.95) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, pt.x, pt.y + 1);
    }
    function drawSketch(ctx, sk, i, selected) {
        const ev = sk.ev, wp = ev && ev.world;
        if (!wp) return;
        const col = ev.ok ? COLORS.ok : COLORS.bad;
        ctx.globalAlpha = selected ? 1 : 0.6;
        ctx.lineWidth = selected ? 2.5 : 1.5; ctx.strokeStyle = col;
        if (wp.fairway) { polyPath(ctx, wp.fairway); ctx.fillStyle = ev.ok ? 'rgba(74,222,128,0.38)' : 'rgba(248,113,113,0.38)'; ctx.fill(); ctx.stroke(); }
        ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath();
        wp.centerline.forEach(function (p, k) { if (k) ctx.lineTo(cx(p.x), cz(p.z)); else ctx.moveTo(cx(p.x), cz(p.z)); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = col;
        wp.bunkers.forEach(function (b) { polyPath(ctx, b); ctx.fillStyle = 'rgba(253,230,138,0.9)'; ctx.fill(); ctx.stroke(); });
        polyPath(ctx, wp.green); ctx.fillStyle = ev.ok ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.8)'; ctx.fill(); ctx.stroke();
        (wp.teeBoxes || []).forEach(function (b) { polyPath(ctx, b); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); });
        ctx.globalAlpha = 1;
        const tee = { x: cx(sk.origin.x), y: cz(sk.origin.z) };
        if (selected) {
            // T handle carries the hole number (drag to move), G handle turns the hole
            const gc = { x: cx(wp.greenCenter.x), y: cz(wp.greenCenter.z) };
            badge(ctx, tee, String(holeNo(i)), '#f8fafc', 15);
            badge(ctx, gc, 'G', '#38bdf8', 15);
            S.handles = { tee: tee, green: gc };
        } else {
            badge(ctx, tee, String(holeNo(i)), 'rgba(248,250,252,0.85)', 12);
        }
    }
    function draw() {
        if (!S) return;
        const ctx = S.ctx, C = S.C;
        ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(S.terrain, 0, 0, C, C);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
        for (let g = -200; g <= 200; g += 100) {
            ctx.beginPath(); ctx.moveTo(cx(g), 0); ctx.lineTo(cx(g), C); ctx.moveTo(0, cz(g)); ctx.lineTo(C, cz(g)); ctx.stroke();
        }
        // holes already on the course
        const others = S.baseEnv.others || { points: [], polygons: [] };
        ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        (others.polygons || []).forEach(function (poly) { polyPath(ctx, poly); ctx.fill(); ctx.stroke(); });
        (others.points || []).forEach(function (p) { ctx.beginPath(); ctx.arc(cx(p.x), cz(p.z), 3, 0, 7); ctx.fill(); });
        // trees, rocks and buildings on the plate (holes keep clear of them)
        (S.baseEnv.objects || []).forEach(function (o) {
            const big = o.r >= 4, rr = Math.max(2, o.r / S.size * C);
            ctx.beginPath(); ctx.arc(cx(o.x), cz(o.z), rr, 0, 7);
            ctx.fillStyle = big ? 'rgba(120,113,108,0.85)' : 'rgba(21,94,52,0.75)'; ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(15,23,42,0.6)'; ctx.stroke();
        });
        // fences, walls and OB lines
        ctx.strokeStyle = 'rgba(146,64,14,0.95)'; ctx.lineWidth = 2.5;
        (S.baseEnv.walls || []).forEach(function (w) { ctx.beginPath(); ctx.moveTo(cx(w.a.x), cz(w.a.z)); ctx.lineTo(cx(w.b.x), cz(w.b.z)); ctx.stroke(); });
        // the walk from each green to the next tee
        ctx.setLineDash([3, 7]); ctx.strokeStyle = 'rgba(250,204,21,0.85)'; ctx.lineWidth = 2;
        for (let i = 0; i < S.sketches.length - 1; i++) {
            const a = S.sketches[i].ev, b = S.sketches[i + 1].ev;
            if (!a || !b) continue;
            ctx.beginPath(); ctx.moveTo(cx(a.world.greenCenter.x), cz(a.world.greenCenter.z)); ctx.lineTo(cx(S.sketches[i + 1].origin.x), cz(S.sketches[i + 1].origin.z)); ctx.stroke();
        }
        ctx.setLineDash([]);
        S.sketches.forEach(function (sk, i) { if (i !== S.sel) drawSketch(ctx, sk, i, false); });
        drawSketch(ctx, cur(), S.sel, true);
    }

    // ---- status chip & buttons ---------------------------------------------------------------------------
    function reasonText(r) {
        if (r === 'bounds') return tr('bp_r_bounds', 'Utanför banan');
        if (r === 'close') return tr('bp_r_close', 'För nära ett annat hål');
        if (r === 'water') return tr('bp_r_water', 'Vatten i vägen');
        if (r === 'object') return tr('bp_r_object', 'Träd eller byggnad i vägen');
        if (/_range$/.test(r)) return tr('bp_r_range', 'För ojämn mark');
        return tr('bp_r_slope', 'För brant');
    }
    function setStatus(text, ok) {
        const el = S.dom.status;
        el.textContent = text;
        el.style.background = ok === true ? 'rgba(34,197,94,0.18)' : (ok === false ? 'rgba(239,68,68,0.18)' : 'rgba(148,163,184,0.18)');
        el.style.color = ok === true ? '#86efac' : (ok === false ? '#fca5a5' : '#cbd5e1');
    }
    function enable(btn, on) {
        btn.disabled = !on;
        btn.style.opacity = on ? '1' : '0.4';
        btn.style.cursor = on ? 'pointer' : 'not-allowed';
    }
    function buildChips() {
        const box = S.dom.chips;
        box.textContent = '';
        S.sketches.forEach(function (sk, i) {
            const b = document.createElement('button');
            b.type = 'button';
            const bad = sk.ev && !sk.ev.ok;
            b.textContent = (bad ? '⛔ ' : '') + tr('bp_hole', 'Hål') + ' ' + holeNo(i) + ' · Par ' + sk.par;
            const on = i === S.sel;
            b.style.cssText = 'min-height:36px; padding:0 12px; border-radius:18px; font-weight:bold; font-size:13px; cursor:pointer; border:2px solid ' + (on ? '#38bdf8' : '#334155') + '; background:' + (on ? '#0c4a6e' : '#1e293b') + '; color:#f1f5f9;';
            b.onclick = function () { if (!S.busy) { S.sel = i; S.note = null; S.noteBad = false; refreshUi(); } };
            box.appendChild(b);
        });
    }
    function refreshUi() {
        if (!S) return;
        const ev = cur().ev;
        if (S.busy) setStatus(tr('bp_searching', '⏳ Letar bra plats…'), null);
        else if (S.note) setStatus(S.noteBad ? '⛔ ' + S.note : S.note, !S.noteBad);
        else if (ev && ev.ok) setStatus('✓ ' + tr('bp_ok', 'Bra plats!'), true);
        else if (ev) setStatus('⛔ ' + reasonText(ev.reasons[0]), false);
        const allOk = S.sketches.every(function (s) { return s.ev && s.ev.ok; }) && !S.busy;
        const n = S.sketches.length;
        S.dom.build.textContent = '⛳ ' + (n > 1 ? tr('bp_build_n', 'Bygg {n} hål').replace('{n}', n) : tr('bp_build', 'Bygg hålet'));
        enable(S.dom.build, allOk);
        const hasPar6 = S.sketches.some(function (s) { return s.par === 6; });
        S.dom.parBtns.forEach(function (b) {
            if (b.dataset.par === '6') b.style.display = hasPar6 ? '' : 'none';   // par 6 is only offered when a hole already has it
            const on = Number(b.dataset.par) === cur().par;
            b.style.background = on ? '#38bdf8' : '#1e293b';
            b.style.color = on ? '#0f172a' : '#e2e8f0';
        });
        enable(S.dom.add, S.sketches.length < S.holes.length && !S.busy);
        S.dom.add.title = S.sketches.length < S.holes.length ? '' : tr('bp_no_more', 'Inga fler tomma hål');
        enable(S.dom.remove, S.sketches.length > 1 && !S.busy);
        enable(S.dom.earlier, S.sel > 0 && !S.busy);
        enable(S.dom.later, S.sel < S.sketches.length - 1 && !S.busy);
        buildChips();
        draw();
    }

    // ---- state changes -----------------------------------------------------------------------------------
    function flashNote(text, bad) {
        S.note = text; S.noteBad = !!bad;
        clearTimeout(S.noteTimer);
        if (text && !bad) S.noteTimer = setTimeout(function () { if (S) { S.note = null; refreshUi(); } }, 2500);
    }
    // Slide sketch i to the closest legal spot (async so the red state paints first)
    function snapToValid(i, announce) {
        S.busy = true; refreshUi();
        const token = ++S.snapToken;
        setTimeout(function () {
            if (!S || token !== S.snapToken) return;
            const s = S.sketches[i];
            const nv = root.HoleGenerator.nearestValidSite(s.plan, s.origin, s.heading, envFor(i));
            S.busy = false;
            if (nv) {
                s.origin = nv.origin; s.heading = nv.heading;
                evaluate(i);
                if (announce) flashNote(tr('bp_moved', 'Flyttade till närmaste lediga plats'));
            } else {
                evaluate(i);
                flashNote(tr('bp_none', 'Ingen ledig plats här – flytta hålet'), true);
            }
            revalidateOthers(i);
            refreshUi();
        }, 30);
    }
    function settle(i) {
        evaluate(i);
        if (!S.sketches[i].ev.ok) snapToValid(i, true);
        else { revalidateOthers(i); refreshUi(); }
    }
    function newShape() {
        const s = cur();
        s.seed = Math.floor(Math.random() * 1e9);
        s.plan = root.HoleGenerator.planFor(s.par, s.seed);
        settle(S.sel);
    }
    function setPar(par) {
        const s = cur();
        if (par === s.par) return;
        s.par = par;
        newShape();
    }
    function turn(delta) {
        cur().heading += delta;
        settle(S.sel);
    }
    // Find a good starting spot for sketch i: random tries first, then the closest legal spot around a few
    // anchor points, and finally another shape (a crowded map may only have room for a smaller one).
    // Each step runs in its own timer tick (the page stays responsive and the map can be closed) and the
    // whole search shares one deadline.
    function suggest(i) {
        const HG = root.HoleGenerator, s = S.sketches[i];
        const lim = S.half * 0.55, anchors = [[0, 0], [-lim, -lim], [lim, -lim], [-lim, lim], [lim, lim]];
        const deadline = Date.now() + 7000, token = ++S.findToken;
        let round = 0, step = -1;
        S.busy = true; refreshUi();
        const finish = function (spot) {
            S.busy = false;
            if (spot) { s.origin = spot.origin; s.heading = spot.heading; }
            else { s.origin = { x: -s.plan.length / 2, z: 0 }; s.heading = 0; }
            evaluate(i);
            revalidateOthers(i);
            if (!spot) flashNote(tr('bp_none', 'Ingen ledig plats här – flytta hålet'), true);
            refreshUi();
        };
        const tick = function () {
            if (!S || token !== S.findToken) return;
            const env = envFor(i);
            let spot = null;
            if (step < 0) {
                const res = HG.place(s.plan, HG.mulberry32((s.seed ^ 0x5bd1e995) >>> 0), env);
                if (res) spot = { origin: { x: res.origin.x, z: res.origin.z }, heading: res.heading };
            } else {
                const nv = HG.nearestValidSite(s.plan, { x: anchors[step][0], z: anchors[step][1] }, 0, env, clamp(deadline - Date.now(), 50, 500));
                if (nv) spot = { origin: nv.origin, heading: nv.heading };
            }
            if (spot) return finish(spot);
            if (Date.now() > deadline) return finish(null);
            step++;
            if (step >= anchors.length) {
                if (++round >= 3) return finish(null);
                step = -1;
                s.seed = Math.floor(Math.random() * 1e9);
                s.plan = HG.planFor(s.par, s.seed);
            }
            setTimeout(tick, 0);
        };
        setTimeout(tick, 40);
    }
    function addHole() {
        if (S.busy || S.sketches.length >= S.holes.length) return;
        // keep the par the target hole already has (building syncs the hole to its sketch's par)
        const target = root.courseHoles && root.courseHoles[S.holes[S.sketches.length]];
        S.sketches.push(makeSketch(clamp((target && target.par) || 4, 3, 6)));
        S.sel = S.sketches.length - 1;
        S.note = null; S.noteBad = false;
        suggest(S.sel);
    }
    function removeHole() {
        if (S.busy || S.sketches.length < 2) return;
        S.sketches.splice(S.sel, 1);
        S.sel = clamp(S.sel, 0, S.sketches.length - 1);
        S.sketches.forEach(function (s, j) { evaluate(j); });
        refreshUi();
    }
    function moveHole(dir) {
        const j = S.sel + dir;
        if (S.busy || j < 0 || j >= S.sketches.length) return;
        const t = S.sketches[S.sel]; S.sketches[S.sel] = S.sketches[j]; S.sketches[j] = t;
        S.sel = j;
        refreshUi();
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
        let s = cur();
        if (near(S.handles && S.handles.green)) S.drag = { mode: 'rotate' };
        else if (near(S.handles && S.handles.tee) || hitSketch(s, p.x, p.z)) S.drag = { mode: 'move', dx: s.origin.x - p.x, dz: s.origin.z - p.z };
        else {
            // another sketch under the finger? select and move it
            let hit = -1;
            for (let i = S.sketches.length - 1; i >= 0; i--) if (i !== S.sel && hitSketch(S.sketches[i], p.x, p.z)) { hit = i; break; }
            if (hit >= 0) { S.sel = hit; s = cur(); S.drag = { mode: 'move', dx: s.origin.x - p.x, dz: s.origin.z - p.z }; }
            else { S.drag = { mode: 'move', dx: 0, dz: 0 }; s.origin = { x: p.x, z: p.z }; }
        }
        try { S.canvas.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        queueEval();
    }
    function onMove(e) {
        if (!S || !S.drag) return;
        e.preventDefault();
        const p = toWorldPt(e), s = cur();
        if (S.drag.mode === 'move') s.origin = { x: p.x + S.drag.dx, z: p.z + S.drag.dz };
        else {
            const gc = s.plan.greenCenter, phi = Math.atan2(gc.l, gc.f);
            s.heading = Math.atan2(p.z - s.origin.z, p.x - s.origin.x) - phi;
        }
        queueEval();
    }
    function onUp() {
        if (!S || !S.drag) return;
        S.drag = null;
        settle(S.sel);
    }
    function queueEval() {
        if (S.raf) return;
        S.raf = requestAnimationFrame(function () {
            if (!S) return;
            S.raf = 0;
            evaluate(S.sel);
            refreshUi();
        });
    }

    // ---- build -------------------------------------------------------------------------------------------
    function build() {
        if (!S || S.busy || !S.sketches.every(function (s) { return s.ev && s.ev.ok; })) return;
        const jobs = S.sketches.map(function (s, i) {
            return { idx: S.holes[i], par: s.par, seed: s.seed, placement: { x: s.origin.x, z: s.origin.z, heading: s.heading } };
        });
        const parts = root._hgParts || null;
        close(true);
        runJobs(jobs, parts, 0, 0);
    }
    // One hole at a time, with a pause in between so the progress message can paint
    function runJobs(jobs, parts, k, failed) {
        const HG = root.HoleGenerator;
        if (k >= jobs.length) {
            if (jobs.length > 1) {
                if (typeof root.changeHoleTo === 'function') root.changeHoleTo(jobs[0].idx);
                toast(failed ? tr('bp_done_some', '⚠️ Några hål kunde inte byggas. Öppna kartan och försök igen.') : tr('bp_done_all', '🗺️ Alla hål byggda! Ångra tar bort ett hål i taget.'), failed ? '#f59e0b' : '#4ade80');
            }
            return;
        }
        const job = jobs[k];
        toast(jobs.length > 1 ? tr('bp_busy_n', '⏳ Bygger hål {i} av {n}…').replace('{i}', k + 1).replace('{n}', jobs.length) : tr('hg_busy', '⏳ Bygger hålet…'), '#a855f7');
        setTimeout(function () {
            if (typeof root.changeHoleTo === 'function') root.changeHoleTo(job.idx);
            const r = HG.generate({ par: job.par, seed: job.seed, parts: parts, placement: job.placement, syncPar: true });
            runJobs(jobs, parts, k + 1, failed + (r ? 0 : 1));
        }, 80);
    }

    // ---- open / close ------------------------------------------------------------------------------------
    function btn(label, onclick, extra) {
        const b = document.createElement('button');
        b.type = 'button'; b.innerHTML = label; b.onclick = onclick;
        b.style.cssText = 'min-height:40px; min-width:34px; padding:0 7px; border:none; border-radius:10px; font-weight:bold; font-size:13px; white-space:nowrap; cursor:pointer; background:#1e293b; color:#e2e8f0;' + (extra || '');
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
    function emptyHolesFrom(start) {
        const HG = root.HoleGenerator, out = [];
        const total = Math.min(root.MAX_HOLES || 3, (root.courseHoles || []).length);
        for (let i = start; i < total; i++) if (HG.holeIsEmpty(root.courseHoles[i])) out.push(i);
        return out;
    }
    function open() {
        const HG = root.HoleGenerator;
        const hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        if (!HG || !hole) return;
        if (!HG.holeIsEmpty(hole)) { toast(tr('hg_not_empty', '⚠️ Hålet har redan delar. Gå till ett tomt hål för att slumpa.'), '#f59e0b'); return; }
        if (S) close(false);
        const holes = emptyHolesFrom(root.currentHoleIndex);
        const half = (root.TERRAIN_SIZE || 600) / 2;
        const par = clamp(hole.par || 4, 3, 6);
        const C = Math.max(240, Math.floor(Math.min(window.innerWidth - 16, window.innerHeight - 350, 760)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);

        const overlay = document.createElement('div');
        overlay.id = 'bp-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:#020617; display:flex; flex-direction:column; align-items:center; gap:8px; padding:8px; box-sizing:border-box; overflow-y:auto; transition:opacity .35s, transform .35s; touch-action:pan-y; user-select:none; -webkit-user-select:none;';
        const head = document.createElement('div');
        head.style.cssText = 'margin-top:auto; width:' + C + 'px; display:flex; align-items:center; justify-content:space-between; gap:8px; color:#f1f5f9;';
        head.innerHTML = '<b style="font-size:16px;">🗺️ ' + tr('bp_title', 'Planera hålen') + '</b>';
        const status = document.createElement('div');
        status.style.cssText = 'flex:1; text-align:center; padding:6px 8px; border-radius:8px; font-size:13px; font-weight:bold;';
        head.appendChild(status);
        const x = btn('✕', function () { close(true); }, 'min-width:44px; min-height:44px;');
        x.title = tr('bp_cancel', 'Avbryt');
        head.appendChild(x);
        const help = document.createElement('div');
        help.style.cssText = 'width:' + C + 'px; color:#94a3b8; font-size:12px; line-height:1.35;';
        help.textContent = tr('bp_help', 'Dra hålet dit du vill ha det. Dra i den blå pricken (G) för att vrida. Tryck på kartan för att flytta teen dit.');
        const chips = document.createElement('div');
        chips.style.cssText = 'width:' + C + 'px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;';
        const canvas = document.createElement('canvas');
        canvas.width = C * dpr; canvas.height = C * dpr;
        // arcade.css pins every <canvas> to the viewport with !important, so this one must override it
        canvas.style.cssText = 'position:relative !important; top:auto !important; left:auto !important; width:' + C + 'px !important; height:' + C + 'px !important; flex:none; border-radius:12px; border:2px solid #334155; touch-action:none; cursor:grab; background:#0f172a !important;';
        const row1 = document.createElement('div');
        row1.style.cssText = 'width:' + C + 'px; display:flex; gap:6px; align-items:center; justify-content:center;';
        const parBtns = [3, 4, 5, 6].map(function (n) {
            const b = btn('Par ' + n, function () { if (!S.busy) setPar(n); }, 'flex:1;');
            b.dataset.par = n;
            row1.appendChild(b);
            return b;
        });
        const row2 = document.createElement('div');
        row2.style.cssText = 'width:' + C + 'px; display:flex; flex-wrap:wrap; gap:4px; align-items:center; justify-content:center;';
        const add = btn('➕ ' + tr('bp_add', 'Hål'), addHole);
        const reroll = btn('🎲 ' + tr('bp_reroll', 'Annan form'), function () { if (!S.busy) newShape(); }, 'flex:1;');
        const left = btn('⟲', function () { if (!S.busy) turn(-Math.PI / 12); });
        const right = btn('⟳', function () { if (!S.busy) turn(Math.PI / 12); });
        const earlier = btn('◀', function () { moveHole(-1); });
        const later = btn('▶', function () { moveHole(1); });
        const remove = btn('🗑️', removeHole);
        left.title = tr('bp_turn_l', 'Vrid åt vänster'); right.title = tr('bp_turn_r', 'Vrid åt höger');
        earlier.title = tr('bp_earlier', 'Flytta tidigare i banan'); later.title = tr('bp_later', 'Flytta senare i banan');
        remove.title = tr('bp_remove', 'Ta bort hålet från kartan');
        [add, reroll, left, right, earlier, later, remove].forEach(function (b) { row2.appendChild(b); });
        const build_ = btn('', build, 'margin-bottom:auto; flex:none; width:' + C + 'px; background:linear-gradient(90deg,#16a34a,#22c55e); color:#fff; font-size:16px; min-height:52px;');
        build_.dataset.role = 'build';
        [head, help, chips, canvas, row1, row2, build_].forEach(function (el) { overlay.appendChild(el); });
        document.body.appendChild(overlay);

        S = {
            dom: { overlay: overlay, status: status, build: build_, parBtns: parBtns, chips: chips, add: add, remove: remove, earlier: earlier, later: later },
            canvas: canvas, ctx: canvas.getContext('2d'), C: C, dpr: dpr, half: half, size: half * 2, mPerPx: half * 2 / C,
            baseEnv: null, holes: holes, sketches: [makeSketch(par)], sel: 0,
            drag: null, busy: false, snapToken: 0, findToken: 0, raf: 0, note: null, noteBad: false, handles: null
        };
        const env = HG.siteEnv(root._hgParts || null);
        env.others = Array.isArray(env.others) ? { points: env.others, polygons: [] } : (env.others || { points: [], polygons: [] });
        S.baseEnv = env;
        S.terrain = renderTerrain(half);
        S.keyHandler = function (e) { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'Escape') close(true); e.stopImmediatePropagation(); };
        window.addEventListener('keydown', S.keyHandler, true);
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
        refreshUi();
        suggest(0);
    }

    root.openHoleBlueprint = open;
    root.HoleBlueprint = { renderTerrain: renderTerrain, open: open, close: close, state: function () { return S; }, build: build, addHole: addHole, evaluate: function (i) { evaluate(i); refreshUi(); } };
})(typeof window !== 'undefined' ? window : globalThis);
