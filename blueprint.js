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

    const COLORS = { ok: '#4ade80', warn: '#fbbf24', bad: '#f87171' };
    const WALK_LONG = 150;                      // m from a green to the next tee: longer is flagged on the map
    const NEAR_RINGS = [35, 50, 65, 80, 100, 125, 155, 190, 220];
    const AHEAD_RINGS = [35, 55, 80, 110];   // m from a candidate green where the next hole's tee is tried (look-ahead)
    const NO_NEXT_ROOM = 400;                // score penalty for a spot that leaves the next hole no room near this green   // m from the previous green where a new hole's tee is looked for first
    let S = null;   // open map state

    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function toast(msg, color) { if (typeof root.showBuildToast === 'function') root.showBuildToast(msg, color || '#38bdf8'); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // ---- terrain picture (rendered once when the map opens) ---------------------------------------------
    // A topographic map: soft hill shading, contour lines (a heavier one every fifth), water with a light shore line.
    // Drawn once at TERRAIN_PX so the lines stay crisp when the map is scaled to the screen.
    const TERRAIN_PX = 900;
    function niceStep(v) {
        const steps = [0.5, 1, 2, 2.5, 5, 10, 20];
        for (let k = 0; k < steps.length; k++) if (steps[k] >= v) return steps[k];
        return 50;
    }
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
        const base = document.createElement('canvas');
        base.width = N; base.height = N;
        const bctx = base.getContext('2d');
        const img = bctx.createImageData(N, N);
        const isWet = function (i, j) { return i >= 0 && j >= 0 && i < N && j < N && wet[j * N + i]; };
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const k = j * N + i, p = k * 4;
            if (wet[k]) {
                // shore: a wet cell next to dry ground is lighter
                const shore = !isWet(i - 1, j) || !isWet(i + 1, j) || !isWet(i, j - 1) || !isWet(i, j + 1);
                img.data[p] = shore ? 120 : 46; img.data[p + 1] = shore ? 184 : 118; img.data[p + 2] = shore ? 232 : 206; img.data[p + 3] = 255;
                continue;
            }
            const hl = hgt[j * N + Math.max(0, i - 1)], hr = hgt[j * N + Math.min(N - 1, i + 1)];
            const hu = hgt[Math.max(0, j - 1) * N + i], hd = hgt[Math.min(N - 1, j + 1) * N + i];
            // light from the upper left
            const shade = clamp(1 + ((hl - hr) + (hu - hd)) / cell * 1.4, 0.78, 1.22);
            const t = clamp((hgt[k] - med) / span, -1, 1);
            const up = Math.max(0, t), down = Math.max(0, -t);
            const r = (74 + 30 * up - 12 * down) * shade, g = (124 + 10 * up - 20 * down) * shade, b = (66 + 6 * up - 6 * down) * shade;
            img.data[p] = clamp(r, 0, 255); img.data[p + 1] = clamp(g, 0, 255); img.data[p + 2] = clamp(b, 0, 255); img.data[p + 3] = 255;
        }
        bctx.putImageData(img, 0, 0);
        const off = document.createElement('canvas');
        off.width = TERRAIN_PX; off.height = TERRAIN_PX;
        const octx = off.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.drawImage(base, 0, 0, TERRAIN_PX, TERRAIN_PX);
        // contour lines by marching squares over the height grid (dry cells only)
        const range = hi - lo;
        if (range >= 0.6) {
            const step = niceStep(range / 12), f = TERRAIN_PX / N;
            const px = function (i) { return (i + 0.5) * f; };
            for (let level = Math.ceil(lo / step) * step; level <= hi; level += step) {
                const major = Math.abs(Math.round(level / step) % 5) === 0;
                octx.beginPath();
                for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
                    const k = j * N + i;
                    if (wet[k] || wet[k + 1] || wet[k + N] || wet[k + N + 1]) continue;
                    const a = hgt[k], b = hgt[k + 1], c = hgt[k + N + 1], d = hgt[k + N];
                    const pts = [];
                    const edge = function (h1, h2, x1, y1, x2, y2) {
                        if ((h1 < level) === (h2 < level)) return;
                        const t = (level - h1) / (h2 - h1);
                        pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
                    };
                    edge(a, b, px(i), px(j), px(i + 1), px(j));
                    edge(b, c, px(i + 1), px(j), px(i + 1), px(j + 1));
                    edge(c, d, px(i + 1), px(j + 1), px(i), px(j + 1));
                    edge(d, a, px(i), px(j + 1), px(i), px(j));
                    for (let q = 0; q + 1 < pts.length; q += 2) { octx.moveTo(pts[q][0], pts[q][1]); octx.lineTo(pts[q + 1][0], pts[q + 1][1]); }
                }
                octx.strokeStyle = major ? 'rgba(28,52,22,0.42)' : 'rgba(28,52,22,0.2)';
                octx.lineWidth = major ? 1.6 : 1;
                octx.stroke();
            }
        }
        return off;
    }

    // ---- sketches ----------------------------------------------------------------------------------------
    function cur() { return S.sketches[S.sel]; }
    function holeNo(i) { return S.holes[i] + 1; }
    // The base environment plus every OTHER sketch as an obstacle.
    // Neighbours in the round (by hole number, built or sketched) are softer: the previous hole's green may lie
    // HoleGenerator.TEE_NEAR (not CLEARANCE) from this hole's tee boxes, and the next hole's tee boxes that close to this green,
    // so the walk between them can be short
    function envFor(i) {
        const HG = root.HoleGenerator, base = S.baseEnv, idx = S.holes[i];
        const others = HG.neighbourOthers(base.others, idx);
        others.points = others.points.slice(); others.polygons = others.polygons.slice();
        S.sketches.forEach(function (s, j) {
            if (j === i || !s.ev) return;
            const nb = S.holes[j] === idx - 1 ? 'green' : (S.holes[j] === idx + 1 ? 'tee' : null);
            const o = nb ? HG.obstaclesSplit(s.ev.world, nb) : HG.obstaclesOf(s.ev.world);
            o.points.forEach(function (p) { others.points.push(p); });
            o.polygons.forEach(function (p) { others.polygons.push(p); });
            if (nb) others.soft.push({ polygons: o.soft, mine: nb === 'green' ? 'tee' : 'green' });
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
        // shape: what the player asked for with the bend / length buttons (null = random), see HoleGenerator.buildPlan
        return { par: par, seed: seed, shape: { dogleg: null, len: null }, plan: root.HoleGenerator.planFor(par, seed), origin: { x: 0, z: 0 }, heading: 0, ev: null };
    }

    // Where the player walks from to reach sketch i's tee: the green of the hole numbered just before it, a sketch or a built hole.
    // null when there is none.
    function prevGreen(i) {
        const j = S.holes.indexOf(S.holes[i] - 1);
        if (j >= 0 && j < S.sketches.length) { const ev = S.sketches[j].ev; return ev ? ev.world.greenCenter : null; }
        if (j >= 0) return null;   // an empty hole without a sketch: no green to walk from
        const h = root.courseHoles && root.courseHoles[S.holes[i] - 1];
        if (!h) return null;
        if (h.flag && typeof h.flag.x === 'number') return { x: h.flag.x, z: h.flag.z };
        const g = h.greenData && h.greenData.points;
        if (g && g.length >= 3) {
            let x = 0, z = 0;
            g.forEach(function (p) { x += p.x; z += p.z; });
            return { x: x / g.length, z: z / g.length };
        }
        return null;
    }
    function walkOf(i) {
        const g = prevGreen(i), o = S.sketches[i].origin;
        return g && S.sketches[i].ev ? Math.round(Math.hypot(o.x - g.x, o.z - g.z)) : null;
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
    // ---- the course-map look ------------------------------------------------------------------------------
    const TURF = { rough: '#3d7034', fairway: '#7bbf55', fringe: '#6aae47', green: '#a3dd7a', sand: '#ecdca6', sandLip: 'rgba(120,88,36,0.5)' };
    const TEE_COLORS = ['#111827', '#facc15', '#ef4444'];   // the back / middle / front box (black-white, yellow, red groups)
    const MOW_PATTERNS = ['SOLID', 'STRIPES', 'CHECKERBOARD', 'DIAMOND'];   // what both the fairway and the green builders can paint
    function pxPerM() { return S.C / S.size; }
    // Mowing pattern inside the current path (clipped by the caller): bands along the line of play (angle), as the builders paint
    // them, drawn wider than on the course (bandM) so they read at map scale
    function paintMow(ctx, pts, pattern, angle, bandM, alpha) {
        if (!pattern || pattern === 'SOLID') return;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        pts.forEach(function (p) { const x = cx(p.x), y = cz(p.z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
        const R = Math.hypot(x1 - x0, y1 - y0) / 2 + 2, band = Math.max(3, bandM * pxPerM());
        ctx.save();
        ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
        ctx.rotate(angle + (pattern === 'DIAMOND' ? Math.PI / 4 : 0));
        ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
        const n = Math.ceil(R / band);
        for (let a = -n; a < n; a++) {
            if (pattern === 'STRIPES') { if (a % 2 === 0) ctx.fillRect(-R, a * band, 2 * R, band); continue; }
            for (let b = -n; b < n; b++) if ((a + b) % 2 === 0) ctx.fillRect(b * band, a * band, band, band);
        }
        ctx.restore();
    }
    // A pin with a pennant at canvas point g; size in px
    function drawFlag(ctx, g, size, color) {
        ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = Math.max(1.5, size * 0.12); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(g.x, g.y - size); ctx.stroke();
        ctx.fillStyle = color || '#ef4444';
        ctx.beginPath(); ctx.moveTo(g.x, g.y - size); ctx.lineTo(g.x + size * 0.7, g.y - size * 0.78); ctx.lineTo(g.x, g.y - size * 0.56); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(15,23,42,0.55)';
        ctx.beginPath(); ctx.ellipse(g.x, g.y, size * 0.22, size * 0.1, 0, 0, 7); ctx.fill();
        ctx.lineCap = 'butt';
    }
    // The hole number on a round tee marker (the tee handle); the selected hole's marker is larger and ringed in sky blue
    function teeMarker(ctx, pt, label, r, selected, statusCol) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y + 1.5, r, 0, 7); ctx.fillStyle = 'rgba(15,23,42,0.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, 7); ctx.fillStyle = '#0f172a'; ctx.fill();
        ctx.lineWidth = selected ? 3 : 2; ctx.strokeStyle = statusCol || (selected ? '#38bdf8' : '#f8fafc'); ctx.stroke();
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold ' + Math.round(r * 0.95) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, pt.x, pt.y + 1);
    }
    // The handle that turns the hole: the flag on a light disc
    function flagHandle(ctx, pt) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y + 1.5, 15, 0, 7); ctx.fillStyle = 'rgba(15,23,42,0.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 15, 0, 7); ctx.fillStyle = 'rgba(248,250,252,0.95)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#38bdf8'; ctx.stroke();
        drawFlag(ctx, { x: pt.x - 3, y: pt.y + 8 }, 16, '#ef4444');
    }
    // One planned hole as on a course guide: rough edge, mown fairway, sand with a lip, green with its fringe, coloured tee boxes,
    // the flag. Its status shows as an outline (amber: needs reshaping, red: does not fit) and a red wash when it does not fit.
    function drawSketch(ctx, sk, i, selected) {
        const ev = sk.ev, wp = ev && ev.world;
        if (!wp) return;
        const warn = !!(ev.ok && ev.shaped && ev.shaped.length);
        const statusCol = ev.ok ? (warn ? COLORS.warn : null) : COLORS.bad;
        const m = pxPerM(), angle = sk.heading, mow = S.mow;
        ctx.save();
        ctx.globalAlpha = selected ? 1 : 0.82;
        ctx.lineJoin = 'round';
        // the line of play under everything, faint
        ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
        wp.centerline.forEach(function (p, k) { if (k) ctx.lineTo(cx(p.x), cz(p.z)); else ctx.moveTo(cx(p.x), cz(p.z)); });
        ctx.stroke(); ctx.setLineDash([]);
        if (wp.fairway) {
            polyPath(ctx, wp.fairway); ctx.strokeStyle = TURF.rough; ctx.lineWidth = Math.max(3, 5 * m); ctx.stroke();   // semi-rough edge
            polyPath(ctx, wp.fairway); ctx.fillStyle = TURF.fairway; ctx.fill();
            ctx.save(); polyPath(ctx, wp.fairway); ctx.clip(); paintMow(ctx, wp.fairway, mow, angle, 9, 0.13); ctx.restore();
        }
        // water the shot has to carry
        if (ev.ok && ev.carry) {
            ctx.strokeStyle = '#bae6fd'; ctx.lineWidth = selected ? 3.5 : 2.5;
            ev.carry.segs.forEach(function (sg) { ctx.beginPath(); ctx.moveTo(cx(sg.a.x), cz(sg.a.z)); ctx.lineTo(cx(sg.b.x), cz(sg.b.z)); ctx.stroke(); });
        }
        // green with its fringe
        polyPath(ctx, wp.green); ctx.strokeStyle = TURF.fringe; ctx.lineWidth = Math.max(2.5, 3 * m); ctx.stroke();
        polyPath(ctx, wp.green); ctx.fillStyle = TURF.green; ctx.fill();
        ctx.save(); polyPath(ctx, wp.green); ctx.clip(); paintMow(ctx, wp.green, mow, angle, 3.5, 0.16); ctx.restore();
        // sand, darker on the lip that faces the light's far side
        wp.bunkers.forEach(function (b) {
            polyPath(ctx, b); ctx.fillStyle = TURF.sand; ctx.fill();
            ctx.save(); polyPath(ctx, b); ctx.clip();
            ctx.translate(1.6, 1.6); polyPath(ctx, b); ctx.strokeStyle = TURF.sandLip; ctx.lineWidth = 3; ctx.stroke();
            ctx.restore();
            polyPath(ctx, b); ctx.strokeStyle = 'rgba(60,45,20,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
        });
        (wp.teeBoxes || []).forEach(function (b, k) {
            polyPath(ctx, b); ctx.fillStyle = TURF.fairway; ctx.fill();
            ctx.strokeStyle = TEE_COLORS[k] || '#f8fafc'; ctx.lineWidth = 2; ctx.stroke();
        });
        // what is wrong with the spot: an outline, and a red wash when it does not fit
        if (statusCol) {
            const parts = [wp.green].concat(wp.fairway ? [wp.fairway] : [], wp.bunkers, wp.teeBoxes || []);
            if (!ev.ok) { ctx.fillStyle = 'rgba(239,68,68,0.38)'; parts.forEach(function (q) { polyPath(ctx, q); ctx.fill(); }); }
            ctx.strokeStyle = statusCol; ctx.lineWidth = selected ? 2.5 : 1.8;
            parts.forEach(function (q) { polyPath(ctx, q); ctx.stroke(); });
        }
        ctx.restore();
        const tee = { x: cx(sk.origin.x), y: cz(sk.origin.z) }, gc = { x: cx(wp.greenCenter.x), y: cz(wp.greenCenter.z) };
        if (selected) {
            // the tee marker carries the hole number (drag to move), the flag turns the hole
            teeMarker(ctx, tee, String(holeNo(i)), 15, true, statusCol);
            flagHandle(ctx, gc);
            S.handles = { tee: tee, green: gc };
        } else {
            drawFlag(ctx, gc, 13, '#ef4444');
            teeMarker(ctx, tee, String(holeNo(i)), 12, false, statusCol);
        }
    }
    // Holes already built on the plate, in the same muted course colours (from the hole data, so each part keeps its kind)
    function drawBuiltHoles(ctx) {
        const all = root.courseHoles || [], ok = function (o) { return o && o.points && o.points.length >= 3; };
        ctx.save(); ctx.globalAlpha = 0.7;
        all.forEach(function (h, i) {
            if (!h || S.holes.indexOf(i) >= 0) return;
            (h.fairways || []).filter(ok).forEach(function (f) { polyPath(ctx, f.points); ctx.fillStyle = TURF.fairway; ctx.fill(); });
            (h.bunkers || []).filter(ok).forEach(function (b) { polyPath(ctx, b.points); ctx.fillStyle = TURF.sand; ctx.fill(); });
            if (ok(h.greenData)) { polyPath(ctx, h.greenData.points); ctx.fillStyle = TURF.green; ctx.fill(); }
            (h.teeBoxes || []).filter(ok).forEach(function (t) { polyPath(ctx, t.points); ctx.fillStyle = '#e2e8f0'; ctx.fill(); });
            if (h.flag && typeof h.flag.x === 'number') {
                const g = { x: cx(h.flag.x), y: cz(h.flag.z) };
                drawFlag(ctx, g, 11, '#f8fafc');
                ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText(String(i + 1), g.x + 9, g.y - 8);
            }
        });
        ctx.restore();
    }
    // A scale bar (bottom left) and a north arrow (top right): -z is north on the plate, up on the map
    function drawMapFurniture(ctx, C) {
        const m = pxPerM(), len = S.size > 900 ? 200 : 100, w = len * m, x = 12, y = C - 14;
        ctx.save();
        ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fillRect(x - 6, y - 16, w + 46, 24);
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(x, y - 2, w / 2, 4); ctx.fillStyle = '#0f172a'; ctx.fillRect(x + w / 2, y - 2, w / 2, 4);
        ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 2, w, 4);
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(len + ' m', x + w + 6, y);
        const nx = C - 20, ny = 22;
        ctx.beginPath(); ctx.arc(nx, ny, 13, 0, 7); ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx + 5, ny + 2); ctx.lineTo(nx, ny - 1); ctx.lineTo(nx - 5, ny + 2); ctx.closePath(); ctx.fill();
        ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 7);
        ctx.restore();
    }
    function draw() {
        if (!S) return;
        const ctx = S.ctx, C = S.C;
        ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(S.terrain, 0, 0, C, C);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        // a line every 100 m (200 m on a big plate), centred on the plate, whatever its size
        const step = S.size > 900 ? 200 : 100, g0 = -Math.floor((S.half - 1) / step) * step;
        for (let g = g0; g < S.half; g += step) {
            ctx.beginPath(); ctx.moveTo(cx(g), 0); ctx.lineTo(cx(g), C); ctx.moveTo(0, cz(g)); ctx.lineTo(C, cz(g)); ctx.stroke();
        }
        drawBuiltHoles(ctx);
        // trees, rocks and buildings on the plate (holes keep clear of them): a canopy or a stone with its shadow
        (S.baseEnv.objects || []).forEach(function (o) {
            const big = o.r >= 4, rr = Math.max(2, o.r / S.size * C), x = cx(o.x), y = cz(o.z);
            ctx.beginPath(); ctx.ellipse(x + rr * 0.35, y + rr * 0.45, rr, rr * 0.85, 0, 0, 7); ctx.fillStyle = 'rgba(15,23,42,0.28)'; ctx.fill();
            ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fillStyle = big ? '#8a837c' : '#2f6b3a'; ctx.fill();
            ctx.beginPath(); ctx.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.45, 0, 7); ctx.fillStyle = big ? 'rgba(255,255,255,0.18)' : 'rgba(163,230,53,0.25)'; ctx.fill();
        });
        // fences, walls and OB lines
        ctx.strokeStyle = 'rgba(146,64,14,0.95)'; ctx.lineWidth = 2.5;
        (S.baseEnv.walls || []).forEach(function (w) { ctx.beginPath(); ctx.moveTo(cx(w.a.x), cz(w.a.z)); ctx.lineTo(cx(w.b.x), cz(w.b.z)); ctx.stroke(); });
        // the walk from each green to the next tee, with its length (red when it is a long walk)
        ctx.lineWidth = 2;
        const labels = [];
        for (let i = 0; i < S.sketches.length; i++) {
            const g = prevGreen(i), d = walkOf(i);
            if (!g || d === null) continue;
            const o = S.sketches[i].origin, long = d > WALK_LONG;
            ctx.setLineDash([2, 6]); ctx.lineCap = 'round'; ctx.strokeStyle = long ? 'rgba(248,113,113,0.95)' : 'rgba(254,243,199,0.9)';
            ctx.beginPath(); ctx.moveTo(cx(g.x), cz(g.z)); ctx.lineTo(cx(o.x), cz(o.z)); ctx.stroke(); ctx.lineCap = 'butt';
            // the label sits a third of the way from the green and a little to the side, clear of the tee marker at the far end
            const gx = cx(g.x), gy = cz(g.z), tx = cx(o.x), ty = cz(o.z), seg = Math.hypot(tx - gx, ty - gy) || 1;
            const nx = -(ty - gy) / seg, ny = (tx - gx) / seg;
            labels.push({ x: gx + (tx - gx) * 0.35 + nx * 14, y: gy + (ty - gy) * 0.35 + ny * 14, text: '🚶 ' + d + ' m', long: long });
        }
        ctx.setLineDash([]);
        S.sketches.forEach(function (sk, i) { if (i !== S.sel) drawSketch(ctx, sk, i, false); });
        drawSketch(ctx, cur(), S.sel, true);
        // walk labels on top, so a hole drawn over the line cannot hide them
        ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        labels.forEach(function (l) {
            const w = ctx.measureText(l.text).width + 12;
            ctx.fillStyle = l.long ? 'rgba(127,29,29,0.92)' : 'rgba(15,23,42,0.82)';
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(l.x - w / 2, l.y - 9, w, 18, 9); else ctx.rect(l.x - w / 2, l.y - 9, w, 18); ctx.fill();
            ctx.fillStyle = l.long ? '#fecaca' : '#fef3c7';
            ctx.fillText(l.text, l.x, l.y + 1);
        });
        drawMapFurniture(ctx, C);
    }

    // ---- status chip & buttons ---------------------------------------------------------------------------
    function reasonText(r) {
        if (r === 'bounds') return tr('bp_r_bounds', 'Utanför banan');
        if (r === 'close') return tr('bp_r_close', 'För nära ett annat hål');
        if (r === 'water') return tr('bp_r_water', 'Vatten i vägen');
        if (r === 'carry') return tr('bp_r_carry', 'För långt över vattnet från främre tee');
        if (r === 'object') return tr('bp_r_object', 'Träd eller byggnad i vägen');
        if (/_range$/.test(r)) return tr('bp_r_range', 'För ojämn mark');
        return tr('bp_r_slope', 'För brant');
    }
    // What the builders will do to the ground on a yellow site, e.g. "green ~1.8 m, fairway mjukas (max 10 %)"
    function shapeBits(ev) {
        const w = ev.work || {}, bits = [];
        const m = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
        if (ev.shaped.indexOf('green') >= 0) bits.push(tr('bp_shape_green', 'green ~{m} m').replace('{m}', m(w.green || 0)));
        if (ev.shaped.indexOf('tee') >= 0) bits.push(tr('bp_shape_tee', 'tee ~{m} m').replace('{m}', m(w.tee || 0)));
        if (ev.shaped.indexOf('fairway') >= 0) bits.push(tr('bp_shape_fairway', 'fairway mjukas (max {p} %)').replace('{p}', String(w.fairway || 10)));
        return bits.join(', ');
    }
    // "💧 Över vatten: 85 m från främre tee, 141 m från bakre"
    function carryText(ev) {
        return tr('bp_carry', '💧 Över vatten: {f} m från främre tee, {b} m från bakre').replace('{f}', ev.carry.front).replace('{b}', ev.carry.back);
    }
    // Total par and length of the planned holes, and the longest walk between them
    function summaryText() {
        let par = 0, len = 0, walk = 0;
        S.sketches.forEach(function (sk, i) { par += sk.par; len += sk.plan.length; const d = walkOf(i); if (d !== null) walk = Math.max(walk, d); });
        let t = 'Par ' + par + ' · ' + Math.round(len) + ' m';
        if (walk) t += ' · ' + (walk > WALK_LONG ? '⚠️ ' + tr('bp_walk_long', 'lång promenad') + ' ' : '🚶 ' + tr('bp_walk_max', 'max') + ' ') + walk + ' m';
        return t;
    }
    function setStatus(text, ok) {
        const el = S.dom.status;
        el.textContent = text;
        el.title = text;
        el.style.background = ok === true ? 'rgba(34,197,94,0.18)' : (ok === 'warn' ? 'rgba(251,191,36,0.18)' : (ok === false ? 'rgba(239,68,68,0.18)' : 'rgba(148,163,184,0.18)'));
        el.style.color = ok === true ? '#86efac' : (ok === 'warn' ? '#fde68a' : (ok === false ? '#fca5a5' : '#cbd5e1'));
    }
    function enable(btn, on) {
        btn.disabled = !on;
        btn.style.opacity = on ? '1' : '0.4';
        btn.style.cursor = on ? 'pointer' : 'not-allowed';
    }
    // The scorecard: one column per planned hole (tap to select it) with par, length and the walk to its tee, and the totals.
    // A hole that does not fit is marked ⛔, one that needs reshaping ⚠️, a long walk in red.
    function buildScorecard() {
        const box = S.dom.card;
        box.textContent = '';
        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse; table-layout:fixed; font-size:12px; font-variant-numeric:tabular-nums;';
        table.title = summaryText();
        const cell = function (row, text, opts) {
            const c = document.createElement(opts && opts.head ? 'th' : 'td');
            c.textContent = text;
            c.style.cssText = 'padding:4px 2px; text-align:center; border-left:1px solid ' + (opts && opts.head ? 'rgba(255,255,255,0.15)' : '#ddd5bd') + ';' + (opts && opts.style || '');
            row.appendChild(c);
            return c;
        };
        const select = function (i) { if (!S.busy) { S.sel = i; S.note = null; S.noteBad = false; refreshUi(); } };
        const rows = [
            { label: tr('bp_card_hole', 'Hål'), head: true },
            { label: 'Par' }, { label: tr('bp_card_len', 'Meter') }, { label: '🚶 ' + tr('bp_card_walk', 'Gång') }
        ];
        let par = 0, len = 0, walk = 0;
        rows.forEach(function (r, ri) {
            const tr_ = document.createElement('tr');
            if (r.head) tr_.style.background = '#14532d';
            const lab = cell(tr_, r.label, { head: r.head, style: 'text-align:left; padding-left:8px; width:64px; border-left:none; font-weight:bold;' + (r.head ? 'color:#f8fafc;' : 'color:#3f4d3a;') });
            lab.scope = r.head ? 'col' : 'row';
            S.sketches.forEach(function (sk, i) {
                const on = i === S.sel, bad = sk.ev && !sk.ev.ok, warnHole = !!(sk.ev && sk.ev.ok && sk.ev.shaped && sk.ev.shaped.length);
                const d = walkOf(i);
                let text = '', style = on ? 'background:' + (r.head ? '#166534' : '#fde68a') + ';' : '';
                if (r.head) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.textContent = (bad ? '⛔ ' : (warnHole ? '⚠️ ' : '')) + holeNo(i);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                    b.setAttribute('aria-label', tr('bp_hole', 'Hål') + ' ' + holeNo(i));
                    b.style.cssText = 'all:unset; display:block; width:100%; min-height:28px; cursor:pointer; color:#f8fafc; font-weight:bold; font-size:14px;' + (on ? 'box-shadow:inset 0 -3px 0 #fde68a;' : '');
                    b.onclick = function () { select(i); };
                    const th = cell(tr_, '', { head: true, style: style + 'padding:0;' });
                    th.appendChild(b);
                    return;
                }
                if (ri === 1) { text = String(sk.par); par += sk.par; }
                else if (ri === 2) { const m = Math.round(sk.plan.length); text = String(m); len += m; }   // the total adds the numbers shown
                else { text = d === null ? '–' : String(d); if (d !== null) { walk += d; if (d > WALK_LONG) style += 'color:#b91c1c; font-weight:bold;'; } }
                const td = cell(tr_, text, { style: style + 'cursor:pointer; color:' + (style.indexOf('color:#b91c1c') >= 0 ? '#b91c1c' : '#1f2d1f') + ';' });
                td.onclick = function () { select(i); };
            });
            const tot = r.head ? tr('bp_card_total', 'Tot') : (ri === 1 ? String(par) : (ri === 2 ? String(Math.round(len)) : (walk ? String(walk) : '–')));
            cell(tr_, tot, { head: r.head, style: 'width:56px; font-weight:bold;' + (r.head ? 'color:#f8fafc;' : 'background:#ece5cf; color:#1f2d1f;') });
            table.appendChild(tr_);
        });
        box.appendChild(table);
    }
    function refreshUi() {
        if (!S) return;
        const ev = cur().ev;
        if (S.busy) setStatus(tr('bp_searching', '⏳ Letar bra plats…'), null);
        else if (S.note) setStatus(S.noteBad ? '⛔ ' + S.note : S.note, !S.noteBad);
        else if (ev && ev.ok && ev.shaped && ev.shaped.length) setStatus('⚠️ ' + tr('bp_shape', 'Kräver utplaning'), 'warn');
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
        const sh = cur().shape || {};
        S.dom.shapeBtns.forEach(function (b) {
            const isBend = b.dataset.shapeKey === 'dogleg';
            b.style.display = (isBend && cur().par === 3) ? 'none' : '';   // a par 3 never bends
            const on = sh[b.dataset.shapeKey] === b.dataset.shapeVal;
            b.style.background = on ? '#38bdf8' : '#1e293b';
            b.style.color = on ? '#0f172a' : '#e2e8f0';
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.disabled = !!S.busy;
        });
        enable(S.dom.add, S.sketches.length < S.holes.length && !S.busy);
        S.dom.add.title = S.sketches.length < S.holes.length ? '' : tr('bp_no_more', 'Inga fler tomma hål');
        enable(S.dom.remove, S.sketches.length > 1 && !S.busy);
        enable(S.dom.earlier, S.sel > 0 && !S.busy);
        enable(S.dom.later, S.sel < S.sketches.length - 1 && !S.busy);
        // The detail row is reserved space (no layout jump) for what the one-line status cannot say: what a yellow site changes,
        // and the whole message whenever the status had to be cut off (narrow phones, where a tooltip is not reachable).
        const shapedNow = !S.busy && !S.note && ev && ev.ok && ev.shaped && ev.shaped.length;
        const carryNow = !S.busy && ev && ev.ok && ev.carry;
        const stEl = S.dom.status, cutOff = stEl.scrollWidth > stEl.clientWidth + 1;
        let detailText = '';
        if (shapedNow) detailText = (cutOff ? stEl.textContent + ': ' : '') + shapeBits(ev);
        else if (cutOff) detailText = stEl.textContent;
        if (carryNow) detailText = (detailText ? detailText + ' · ' : '') + carryText(ev);
        S.dom.detail.textContent = detailText;
        S.dom.detail.style.color = shapedNow ? '#fde68a' : (carryNow ? '#7dd3fc' : (ev && !ev.ok && !S.busy ? '#fca5a5' : '#cbd5e1'));
        S.dom.detail.title = detailText;
        buildScorecard();
        S.dom.mowBtns.forEach(function (b) {
            const on = b.dataset.mow === S.mow;
            b.style.borderColor = on ? '#38bdf8' : '#334155';
            b.style.background = on ? '#0c4a6e' : '#1e293b';
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
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
        s.plan = root.HoleGenerator.planFor(s.par, s.seed, s.shape);
        settle(S.sel);
    }
    // Bend (left / straight / right) and length (short / mid / long) buttons: tapping the active one goes back to random
    function setShape(key, val) {
        const s = cur();
        s.shape[key] = s.shape[key] === val ? null : val;
        newShape();
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
    // The par a new sketch for hole idx starts with. A par the player set on the hole (anything but the default 4) is kept;
    // otherwise the course gets a mix: the par of 4, 3 and 5 used least on the plate so far (built holes and sketches), not the
    // same as the hole before it when that ties, preferring 4, then 3, then 5. holes / sketches: the map's lists.
    function suggestPar(idx, holes, sketches) {
        const HG = root.HoleGenerator, all = root.courseHoles || [], h = all[idx];
        if (h && h.par && h.par !== 4) return clamp(h.par, 3, 6);
        const count = { 3: 0, 4: 0, 5: 0 }, parOf = {};
        const total = Math.min(root.MAX_HOLES || all.length, all.length);
        for (let i = 0; i < total; i++) {
            const k = holes.indexOf(i);
            if (k >= 0 && k < sketches.length) parOf[i] = sketches[k].par;
            else if (i !== idx && all[i] && !HG.holeIsEmpty(all[i])) parOf[i] = all[i].par;
        }
        Object.keys(parOf).forEach(function (i) { if (count[parOf[i]] !== undefined) count[parOf[i]]++; });
        const prev = parOf[idx - 1], pref = [4, 3, 5];
        return pref.slice().sort(function (a, b) {
            return (count[a] - count[b]) || ((a === prev ? 1 : 0) - (b === prev ? 1 : 0)) || (pref.indexOf(a) - pref.indexOf(b));
        })[0];
    }
    // What comes after sketch i in the round: { plan } when the next hole is empty and not sketched yet, { tee } when the next
    // hole is built (its back tee), else null. The next hole's shape is drawn now (S.pending) and kept for when it is added, so
    // the look-ahead tests the very shape that will have to fit.
    function lookAhead(i) {
        const HG = root.HoleGenerator, next = S.holes[i] + 1, k = S.holes.indexOf(next);
        if (k >= 0) {
            if (k < S.sketches.length) return null;   // already sketched: its own placement takes care of the walk
            const par = suggestPar(next, S.holes, S.sketches);
            S.pending = S.pending || {};
            if (!S.pending[next] || S.pending[next].par !== par) {
                const seed = Math.floor(Math.random() * 1e9);
                S.pending[next] = { par: par, seed: seed, plan: HG.planFor(par, seed) };
            }
            return { plan: S.pending[next].plan };
        }
        const h = root.courseHoles && root.courseHoles[next];
        const tb = h && (h.teeBoxes || []).filter(function (t) { return t && t.points && t.points.length >= 3; })[0];
        if (!tb) return null;
        let x = 0, z = 0;
        tb.points.forEach(function (p) { x += p.x; z += p.z; });
        return { tee: { x: x / tb.points.length, z: z / tb.points.length } };
    }
    // Does `plan` (the next hole's shape) fit with its tee near the green of `world` (this hole, placed)? Returns the spot it fits
    // at ({ origin, heading }), or null. env is this hole's environment: its soft neighbours become hard again, and this hole's
    // green is soft for the next tee. The spot is handed on to the next hole's search (S.pending[..].spot -> sketch.hint), which
    // samples other points around the green and could otherwise miss the very spot that was promised here.
    function nextFits(plan, world, env) {
        const HG = root.HoleGenerator, split = HG.obstaclesSplit(world, 'green');
        const hard = env.others.polygons.concat(split.polygons);
        (env.others.soft || []).forEach(function (g) { g.polygons.forEach(function (p) { hard.push(p); }); });
        const env2 = Object.assign({}, env, { others: { points: env.others.points.concat(split.points), polygons: hard, soft: [{ polygons: split.soft, mine: 'tee' }] } });
        const g = world.greenCenter;
        for (let r = 0; r < AHEAD_RINGS.length; r++) for (let a = 0; a < 12; a++) {
            const ang = a / 12 * Math.PI * 2, o = { x: g.x + Math.cos(ang) * AHEAD_RINGS[r], z: g.z + Math.sin(ang) * AHEAD_RINGS[r] };
            for (let t = 0; t < 6; t++) {
                const h = ang + (t - 2.5) * 0.5;
                if (HG.evaluateSite(plan, o, h, env2).ok) return { origin: o, heading: h };
            }
        }
        return null;
    }
    // Find a good starting spot for sketch i: random tries first, then the closest legal spot around a few
    // anchor points, and finally another shape (a crowded map may only have room for a smaller one).
    // Each step runs in its own timer tick (the page stays responsive and the map can be closed) and the
    // whole search shares one deadline (the open-map fallback gets a few seconds of its own).
    // The search starts next to the previous green: rings outward, and from the first ring with room plus the one after it the best
    // spot wins (short walk, no reshaping, and a green that ends away from the map edge, so the NEXT hole also finds room near it).
    // Look-ahead: when the next hole is still to be planned, a spot only counts as good if a typical hole of the next par still
    // fits near ITS green (otherwise the next hole is pushed far away and the walk gets long); when the next hole is already built,
    // the walk from this green to its tee counts too.
    // A shape that has no room there is swapped for another of the same par a few times (a shorter or straighter one often fits)
    // before the search falls back to the open map.
    function suggest(i) {
        const HG = root.HoleGenerator, s = S.sketches[i];
        const lim = S.half * 0.55, anchors = [[0, 0], [-lim, -lim], [lim, -lim], [-lim, lim], [lim, lim]];
        let deadline = Date.now() + 7000;
        const token = ++S.findToken;
        // the first hole of an empty course starts at the edge of the map, as from a clubhouse, so the round loops around the
        // plate instead of the first hole taking the middle and leaving no room near its green for the next one
        const edge = S.half * 0.78, starts = [[-edge, 0], [edge, 0], [0, -edge], [0, edge]][Math.floor(Math.random() * 4)];
        const pg = prevGreen(i) || (S.holes[i] === 0 ? { x: starts[0], z: starts[1] } : null);
        let round = 0, step = pg ? -2 : -1;
        let ring = 0, cand = 0, best = null, lastRing = NEAR_RINGS.length - 1, nearShapes = 0, aheadShapes = 0;
        const ahead = lookAhead(i);
        const score = function (r, ev, env) {
            const g = ev.world.greenCenter, room = Math.min(150, S.half - Math.max(Math.abs(g.x), Math.abs(g.z)));
            let sc = r + ((ev.shaped && ev.shaped.length) ? 60 : 0) - 0.6 * room;
            if (ahead && ahead.tee) sc += Math.hypot(g.x - ahead.tee.x, g.z - ahead.tee.z);
            // the look-ahead is the expensive part: only for a spot that could still beat the best one found so far
            if (best && sc >= best.score) return { score: sc + NO_NEXT_ROOM, good: false };
            const fit = (ahead && ahead.plan) ? nextFits(ahead.plan, ev.world, env) : null;
            const good = !(ahead && ahead.plan) || !!fit;
            return { score: sc + (good ? 0 : NO_NEXT_ROOM), good: good, fit: fit };
        };
        // the spot the previous hole's placement found for this shape (see nextFits): tried first, the rings may still beat it
        let hint = s.hint && pg ? s.hint : null;
        s.hint = null;
        const ANGLES = 16, TURNS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.6, -2.6, Math.PI];   // away from the green first
        S.busy = true; refreshUi();
        const finish = function (spot) {
            S.busy = false;
            if (spot) { s.origin = spot.origin; s.heading = spot.heading; }
            else { s.origin = { x: -s.plan.length / 2, z: 0 }; s.heading = 0; }
            // hand the next hole the spot its shape was found to fit at, next to this green
            const nextPend = S.pending && S.pending[S.holes[i] + 1];
            if (nextPend) nextPend.spot = (spot && spot.fit && ahead && ahead.plan === nextPend.plan) ? spot.fit : null;
            evaluate(i);
            revalidateOthers(i);
            if (!spot) flashNote(tr('bp_none', 'Ingen ledig plats här – flytta hålet'), true);
            refreshUi();
        };
        const tick = function () {
            if (!S || token !== S.findToken) return;
            const env = envFor(i);
            let spot = null;
            if (step === -2 && hint) {
                const h0 = hint; hint = null;
                const ev0 = HG.evaluateSite(s.plan, h0.origin, h0.heading, env);
                if (ev0.ok) {
                    const r0 = Math.hypot(h0.origin.x - pg.x, h0.origin.z - pg.z), sc0 = score(r0, ev0, env);
                    best = { origin: h0.origin, heading: h0.heading, score: sc0.score, good: sc0.good, fit: sc0.fit };
                    if (sc0.good) {
                        let k = 0;
                        while (k < NEAR_RINGS.length - 1 && NEAR_RINGS[k] < r0 - 1) k++;
                        lastRing = Math.min(lastRing, k + 1);
                    }
                }
            }
            if (step === -2) {
                // next to the previous green: a slice of the current ring per tick
                const r = NEAR_RINGS[ring], total = ANGLES * TURNS.length, t0 = Date.now();
                while (cand < total && Date.now() - t0 < 25) {
                    const a = Math.floor(cand / TURNS.length) / ANGLES * Math.PI * 2, turn = TURNS[cand % TURNS.length];
                    cand++;
                    const o = { x: pg.x + Math.cos(a) * r, z: pg.z + Math.sin(a) * r };
                    const h = a + turn;   // play away from the green just finished
                    const ev = HG.evaluateSite(s.plan, o, h, env);
                    if (!ev.ok) continue;
                    const sc = score(r, ev, env);
                    // the ring search ends one ring after the first spot that leaves room for the next hole
                    if (sc.good && !(best && best.good)) lastRing = Math.min(lastRing, ring + 1);
                    if (!best || sc.score < best.score) best = { origin: o, heading: h, score: sc.score, good: sc.good, fit: sc.fit };
                }
                if (cand < total && Date.now() <= deadline) { setTimeout(tick, 0); return; }
                ring++; cand = 0;
                // every spot found leaves the next hole's shape no room near this green: draw the next hole another shape and look
                // again (a crowded plate fits a shorter or differently bent hole), a few times, before settling for a long walk
                // (only in the first seconds of the search: the map must not keep the player waiting for a nicer walk)
                if (best && !best.good && ring >= NEAR_RINGS.length && ahead && ahead.plan && aheadShapes < 3 && Date.now() < deadline - 3000) {
                    aheadShapes++;
                    const nextIdx = S.holes[i] + 1, pend = S.pending && S.pending[nextIdx];
                    if (pend) {
                        pend.seed = Math.floor(Math.random() * 1e9);
                        pend.plan = HG.planFor(pend.par, pend.seed);
                        pend.spot = null;
                        ahead.plan = pend.plan;
                        // keep the spot found so far (it may be the only legal one, e.g. the hint), scored against the new shape
                        const keep = best;
                        best = null; ring = 0; lastRing = NEAR_RINGS.length - 1;
                        const evK = HG.evaluateSite(s.plan, keep.origin, keep.heading, env);
                        if (evK.ok) {
                            const rK = Math.hypot(keep.origin.x - pg.x, keep.origin.z - pg.z), scK = score(rK, evK, env);
                            best = { origin: keep.origin, heading: keep.heading, score: scK.score, good: scK.good, fit: scK.fit };
                            if (scK.good) {
                                let k = 0;
                                while (k < NEAR_RINGS.length - 1 && NEAR_RINGS[k] < rK - 1) k++;
                                lastRing = Math.min(lastRing, k + 1);
                            }
                        }
                        setTimeout(tick, 0);
                        return;
                    }
                }
                if (best && (ring > lastRing || Date.now() > deadline)) return finish(best);
                if (ring >= NEAR_RINGS.length) {
                    ring = 0;
                    if (++nearShapes < 5 && Date.now() < deadline) {
                        s.seed = Math.floor(Math.random() * 1e9);
                        s.plan = HG.planFor(s.par, s.seed, s.shape);
                    } else step = -1;
                }
                if (Date.now() > deadline) step = -1;
                // the open-map search gets time of its own: a slow device must not end with no spot at all
                if (step === -1) deadline = Math.max(deadline, Date.now() + 4000);
                setTimeout(tick, 0);
                return;
            }
            if (step === -1) {
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
                step = -1;   // the ring search near the previous green is not repeated: a new shape rarely changes the answer there
                s.seed = Math.floor(Math.random() * 1e9);
                s.plan = HG.planFor(s.par, s.seed, s.shape);
            }
            setTimeout(tick, 0);
        };
        setTimeout(tick, 40);
    }
    function addHole() {
        if (S.busy || S.sketches.length >= S.holes.length) return;
        // the par: see suggestPar (building syncs the hole to its sketch's par)
        const idx = S.holes[S.sketches.length];
        const par = suggestPar(idx, S.holes, S.sketches), sk = makeSketch(par);
        // the shape the previous hole's placement already made room for
        const pend = S.pending && S.pending[idx];
        if (pend && pend.par === par) { sk.seed = pend.seed; sk.plan = pend.plan; sk.hint = pend.spot || null; }
        if (S.pending) delete S.pending[idx];
        S.sketches.push(sk);
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
        // new neighbours: a tee that sat close to the old previous green may now be too close to a hole that is not its neighbour
        S.sketches.forEach(function (s, k) { evaluate(k); });
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
            return { idx: S.holes[i], par: s.par, seed: s.seed, shape: s.shape, mow: S.mow, placement: { x: s.origin.x, z: s.origin.z, heading: s.heading } };
        });
        const parts = root._hgParts || null;
        close(true);
        runJobs(jobs, parts, 0, []);
    }
    // One hole at a time, with a pause in between so the progress message can paint
    // Why a hole could not be built, in words: the blueprint's own reasons for a spot that no longer works, else the kind of failure
    function failText(f) {
        if (!f) return tr('bp_fail_unknown', 'okänt fel');
        if (f.code === 'site' && f.reasons && f.reasons.length) return reasonText(f.reasons[0]);
        if (f.code === 'error') return tr('bp_fail_error', 'fel i byggaren');
        if (f.code === 'not_empty') return tr('bp_fail_not_empty', 'hålet har redan delar');
        return tr('bp_fail_unknown', 'okänt fel');
    }
    // failed: [{ no: hole number, why: text }]
    function runJobs(jobs, parts, k, failed) {
        const HG = root.HoleGenerator;
        failed = failed || [];
        if (k >= jobs.length) {
            root._bpLastBuild = { jobs: jobs.length, failed: failed };   // read by the smoke test and when debugging a report
            if (jobs.length > 1 || failed.length) {
                if (typeof root.changeHoleTo === 'function') root.changeHoleTo((failed.length ? jobs.filter(function (j) { return j.idx + 1 === failed[0].no; })[0] : jobs[0]).idx);
                if (failed.length) {
                    const list = failed.map(function (f) { return tr('bp_hole', 'Hål') + ' ' + f.no + ': ' + f.why; }).join(' · ');
                    toast(tr('bp_done_some', '⚠️ Några hål kunde inte byggas. Öppna kartan och försök igen.') + ' (' + list + ')', '#f59e0b');
                } else toast(tr('bp_done_all', '🗺️ Alla hål byggda! Ångra tar bort ett hål i taget.'), '#4ade80');
            }
            return;
        }
        const job = jobs[k];
        toast(jobs.length > 1 ? tr('bp_busy_n', '⏳ Bygger hål {i} av {n}…').replace('{i}', k + 1).replace('{n}', jobs.length) : tr('hg_busy', '⏳ Bygger hålet…'), '#a855f7');
        setTimeout(function () {
            if (typeof root.changeHoleTo === 'function') root.changeHoleTo(job.idx);
            const r = HG.generate({ par: job.par, seed: job.seed, shape: job.shape, mow: job.mow, parts: parts, placement: job.placement, syncPar: true });
            if (!r) failed.push({ no: job.idx + 1, why: failText(HG.lastFailure && HG.lastFailure()), detail: HG.lastFailure && HG.lastFailure() });
            runJobs(jobs, parts, k + 1, failed);
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
        root._pause3D = false;
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
        const par = suggestPar(holes[0], holes, []);
        // the map plus its 2 px border on each side (+4) fits the screen with the 8 px page padding on each side (+16)
        const C = Math.max(240, Math.floor(Math.min(window.innerWidth - 20, window.innerHeight - 380, 760)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);

        const overlay = document.createElement('div');
        overlay.id = 'bp-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:#020617; display:flex; flex-direction:column; align-items:center; gap:8px; padding:8px; box-sizing:border-box; overflow-y:auto; transition:opacity .35s, transform .35s; touch-action:pan-y; user-select:none; -webkit-user-select:none;';
        const head = document.createElement('div');
        head.style.cssText = 'margin-top:auto; width:' + C + 'px; display:flex; align-items:center; justify-content:space-between; gap:8px; color:#f1f5f9;';
        head.innerHTML = '<b style="font-size:16px;">🗺️ ' + tr('bp_title', 'Planera hålen') + '</b>';
        const status = document.createElement('div');
        // one fixed-height line: a longer message used to wrap, grow the header and make the whole centred page jump while dragging
        status.style.cssText = 'flex:1; min-width:0; height:32px; line-height:20px; box-sizing:border-box; text-align:center; padding:6px 8px; border-radius:8px; font-size:13px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
        head.appendChild(status);
        const x = btn('✕', function () { close(true); }, 'min-width:44px; min-height:44px;');
        x.title = tr('bp_cancel', 'Avbryt');
        head.appendChild(x);
        const help = document.createElement('div');
        help.style.cssText = 'width:' + C + 'px; color:#94a3b8; font-size:12px; line-height:1.35;';
        help.textContent = tr('bp_help', 'Dra hålet dit du vill ha det. Dra i flaggan för att vrida. Tryck på kartan för att flytta teen dit.');
        // what the builders will do on a yellow site; the height is reserved so the page does not move when it appears
        const detail = document.createElement('div');
        detail.style.cssText = 'width:' + C + 'px; height:32px; box-sizing:border-box; overflow:hidden; color:#fde68a; font-size:12px; line-height:16px;';
        // the scorecard (hole / par / metres / walk) in a cream card, like the one in a golfer's pocket
        const card = document.createElement('div');
        card.style.cssText = 'width:' + C + 'px; box-sizing:border-box; border-radius:10px; overflow:hidden; background:#f7f2e3; border:1px solid #d6cfb8; box-shadow:0 2px 0 rgba(0,0,0,0.25);';
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
        // the shape of the selected hole: bend and length (random until a button is chosen)
        const rowShape = document.createElement('div');
        rowShape.style.cssText = 'width:' + C + 'px; display:flex; gap:4px; align-items:center; justify-content:center;';
        // a phone has no room for the words on the bend buttons: the arrows alone, the words stay in the tooltip / screen-reader name
        const compact = C < 440;
        const bendLabel = function (arrow, key, fb) { return compact ? arrow : arrow + ' ' + tr(key, fb); };
        const shapeBtns = [
            ['dogleg', 'left', bendLabel('↰', 'bp_dl_left', 'Vänster'), tr('bp_dl_left_t', 'Kurva åt vänster')],
            ['dogleg', 'straight', bendLabel('⬆', 'bp_dl_straight', 'Rak'), tr('bp_dl_straight_t', 'Rakt hål')],
            ['dogleg', 'right', bendLabel('↱', 'bp_dl_right', 'Höger'), tr('bp_dl_right_t', 'Kurva åt höger')],
            ['len', 'short', tr('bp_len_short', 'Kort'), tr('bp_len_short_t', 'Kort för sitt par')],
            ['len', 'mid', tr('bp_len_mid', 'Mellan'), tr('bp_len_mid_t', 'Mellanlångt för sitt par')],
            ['len', 'long', tr('bp_len_long', 'Lång'), tr('bp_len_long_t', 'Långt för sitt par')]
        ].map(function (d, k) {
            const b = btn(d[2], function () { if (!S.busy) setShape(d[0], d[1]); }, 'flex:1; padding:0 4px; font-size:12px;' + (k === 3 ? ' margin-left:8px;' : ''));
            b.dataset.shapeKey = d[0]; b.dataset.shapeVal = d[1];
            b.title = d[3] + ' · ' + tr('bp_shape_again', 'tryck igen för slump');
            b.setAttribute('aria-label', d[3]);
            if (compact && d[0] === 'dogleg') b.style.fontSize = '16px';
            b.setAttribute('aria-pressed', 'false');
            rowShape.appendChild(b);
            return b;
        });
        const row2 = document.createElement('div');
        row2.style.cssText = 'width:' + C + 'px; display:flex; flex-wrap:wrap; gap:4px; align-items:center; justify-content:center;';
        const add = btn('➕ ' + tr('bp_add', 'Hål'), addHole);
        // on a phone the row has no room for the words: the die alone, the words stay in the tooltip / screen-reader name
        const reroll = btn(compact ? '🎲' : '🎲 ' + tr('bp_reroll', 'Annan form'), function () { if (!S.busy) newShape(); }, 'flex:1;' + (compact ? ' font-size:18px;' : ''));
        reroll.title = tr('bp_reroll', 'Annan form');
        reroll.setAttribute('aria-label', tr('bp_reroll', 'Annan form'));
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
        // the course style: one mowing pattern for every fairway and green the map builds (the studios change single holes later)
        const rowMow = document.createElement('div');
        rowMow.style.cssText = 'width:' + C + 'px; display:flex; gap:4px; align-items:center;';
        const mowLabel = document.createElement('span');
        mowLabel.textContent = tr('bp_mow', 'Klippning');
        mowLabel.style.cssText = 'color:#94a3b8; font-size:12px; font-weight:bold; margin-right:4px; white-space:nowrap;';
        rowMow.appendChild(mowLabel);
        const mowNames = { SOLID: tr('bp_mow_solid', 'Slät'), STRIPES: tr('bp_mow_stripes', 'Ränder'), CHECKERBOARD: tr('bp_mow_checker', 'Rutor'), DIAMOND: tr('bp_mow_diamond', 'Romber') };
        const mowBtns = MOW_PATTERNS.map(function (pat) {
            const b = btn('', function () { if (S && !S.busy) { S.mow = pat; root._bpMow = pat; refreshUi(); } }, 'flex:1; display:flex; align-items:center; justify-content:center; gap:6px; border:2px solid #334155; padding:0 4px;');
            b.dataset.mow = pat;
            b.title = mowNames[pat];
            b.setAttribute('aria-label', tr('bp_mow', 'Klippning') + ': ' + mowNames[pat]);
            // a swatch of the pattern
            const sw = document.createElement('canvas');
            sw.width = 44; sw.height = 28;
            sw.style.cssText = 'width:22px !important; height:14px !important; position:static !important; border-radius:3px; flex:none;';
            const sctx = sw.getContext('2d');
            sctx.fillStyle = TURF.fairway; sctx.fillRect(0, 0, 44, 28);
            sctx.fillStyle = 'rgba(255,255,255,0.28)';
            if (pat === 'STRIPES') for (let k = 0; k < 44; k += 16) sctx.fillRect(k, 0, 8, 28);
            if (pat === 'CHECKERBOARD') for (let a = 0; a < 4; a++) for (let c = 0; c < 6; c++) if ((a + c) % 2 === 0) sctx.fillRect(c * 8, a * 8, 8, 8);
            if (pat === 'DIAMOND') { sctx.save(); sctx.translate(22, 14); sctx.rotate(Math.PI / 4); for (let a = -5; a < 5; a++) for (let c = -5; c < 5; c++) if ((a + c) % 2 === 0) sctx.fillRect(c * 8, a * 8, 8, 8); sctx.restore(); }
            b.appendChild(sw);
            if (!compact) { const t = document.createElement('span'); t.textContent = mowNames[pat]; t.style.fontSize = '12px'; b.appendChild(t); }
            rowMow.appendChild(b);
            return b;
        });
        [head, help, detail, card, canvas, row1, rowShape, rowMow, row2, build_].forEach(function (el) { overlay.appendChild(el); });
        // every overlay row keeps its height: a page taller than the screen scrolls instead of squeezing the status and summary lines
        Array.prototype.forEach.call(overlay.children, function (el) { el.style.flexShrink = '0'; });
        document.body.appendChild(overlay);
        // the map covers the whole screen: the 3D scene behind it stops drawing, so the search for good spots gets the time
        root._pause3D = true;

        S = {
            dom: { overlay: overlay, status: status, detail: detail, card: card, mowBtns: mowBtns, shapeBtns: shapeBtns, build: build_, parBtns: parBtns, add: add, remove: remove, earlier: earlier, later: later },
            canvas: canvas, ctx: canvas.getContext('2d'), C: C, dpr: dpr, half: half, size: half * 2, mPerPx: half * 2 / C,
            baseEnv: null, holes: holes, sketches: [makeSketch(par)], sel: 0,
            mow: MOW_PATTERNS.indexOf(root._bpMow) >= 0 ? root._bpMow : 'STRIPES',
            drag: null, busy: false, snapToken: 0, findToken: 0, raf: 0, note: null, noteBad: false, handles: null
        };
        const env = HG.siteEnv(root._hgParts || null, { allowShaping: true });
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
    root.HoleBlueprint = { envFor: function (i) { return envFor(i); }, renderTerrain: renderTerrain, open: open, close: close, state: function () { return S; }, build: build, addHole: addHole, evaluate: function (i) { evaluate(i); refreshUi(); } };
})(typeof window !== 'undefined' ? window : globalThis);
