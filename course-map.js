/*
 * Course map: what the blueprint map (blueprint.js) and the backdrop map (backdrop.js) both draw, so the two look the same.
 * A topographic picture of the plate, the course-guide look of turf, sand and tees, mowing patterns, flags, tee markers, the
 * holes already built (from the hole data, each in its own mowing pattern and direction), a scale bar and a north arrow.
 * Drawing goes through a projection P = { x(worldX) -> canvas px, z(worldZ) -> canvas px, m: px per metre }, so each map keeps
 * its own scale and centre. Pure canvas drawing: no state of its own, no DOM besides offscreen canvases.
 */
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;

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

    // ---- the course-guide look ----------------------------------------------------------------------------
    const TURF = { rough: '#3d7034', fairway: '#7bbf55', fringe: '#6aae47', green: '#a3dd7a', sand: '#ecdca6', sandLip: 'rgba(120,88,36,0.5)' };
    const TEE_COLORS = ['#111827', '#facc15', '#ef4444'];   // the back / middle / front box (black-white, yellow, red groups)
    const MOW_PATTERNS = ['SOLID', 'STRIPES', 'CHECKERBOARD', 'DIAMOND'];   // what both the fairway and the green builders can paint

    function polyPath(ctx, P, pts) {
        ctx.beginPath();
        pts.forEach(function (p, i) { if (i) ctx.lineTo(P.x(p.x), P.z(p.z)); else ctx.moveTo(P.x(p.x), P.z(p.z)); });
        ctx.closePath();
    }
    // Mowing pattern inside the current clip: bands along the line of play (angle, canvas radians), as the builders paint them,
    // drawn wider than on the course (bandM) so they read at map scale
    function paintMow(ctx, P, pts, pattern, angle, bandM, alpha) {
        if (!pattern || pattern === 'SOLID') return;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        pts.forEach(function (p) { const x = P.x(p.x), y = P.z(p.z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
        const R = Math.hypot(x1 - x0, y1 - y0) / 2 + 2, band = Math.max(3, bandM * P.m);
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
    // Fill a polygon with turf and its mowing pattern
    function turf(ctx, P, pts, color, pattern, angle, bandM, alpha) {
        polyPath(ctx, P, pts); ctx.fillStyle = color; ctx.fill();
        if (pattern && pattern !== 'SOLID') { ctx.save(); polyPath(ctx, P, pts); ctx.clip(); paintMow(ctx, P, pts, pattern, angle, bandM, alpha); ctx.restore(); }
    }
    // Sand, darker on the lip that faces away from the light
    function sand(ctx, P, pts) {
        polyPath(ctx, P, pts); ctx.fillStyle = TURF.sand; ctx.fill();
        ctx.save(); polyPath(ctx, P, pts); ctx.clip();
        ctx.translate(1.6, 1.6); polyPath(ctx, P, pts); ctx.strokeStyle = TURF.sandLip; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
        polyPath(ctx, P, pts); ctx.strokeStyle = 'rgba(60,45,20,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
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
    // A hole number on a round tee marker; ring: the ring colour (sky blue when selected, white otherwise)
    function teeMarker(ctx, pt, label, r, ring, ringW) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y + 1.5, r, 0, 7); ctx.fillStyle = 'rgba(15,23,42,0.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, 7); ctx.fillStyle = '#0f172a'; ctx.fill();
        ctx.lineWidth = ringW || 2; ctx.strokeStyle = ring || '#f8fafc'; ctx.stroke();
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold ' + Math.round(r * 0.95) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, pt.x, pt.y + 1);
    }

    // ---- holes already built -------------------------------------------------------------------------------
    function ok(o) { return o && o.points && o.points.length >= 3; }
    function centroid(pts) { let x = 0, z = 0; pts.forEach(function (p) { x += p.x; z += p.z; }); return { x: x / pts.length, z: z / pts.length }; }
    // Which way the hole plays (canvas radians): from its back tee box to the flag (or the green), for the mowing bands
    function holeAngle(P, h) {
        const tee = (h.teeBoxes || []).filter(ok)[0];
        const end = (h.flag && typeof h.flag.x === 'number') ? h.flag : (ok(h.greenData) ? centroid(h.greenData.points) : null);
        if (!tee || !end) return 0;
        const t = centroid(tee.points);
        return Math.atan2(P.z(end.z) - P.z(t.z), P.x(end.x) - P.x(t.x));
    }
    // One built hole from its data: rough edge, fairway and green in their own mowing patterns, sand, tee boxes in the tee colours,
    // the flag, and its number on a tee marker at the back tee. opts: { alpha, number (shown label), small (a far-out map) }
    function drawBuiltHole(ctx, P, h, opts) {
        opts = opts || {};
        const angle = holeAngle(P, h), small = !!opts.small;
        ctx.save();
        ctx.globalAlpha = opts.alpha == null ? 0.85 : opts.alpha;
        ctx.lineJoin = 'round';
        (h.fairways || []).filter(ok).forEach(function (f) {
            if (!small) { polyPath(ctx, P, f.points); ctx.strokeStyle = TURF.rough; ctx.lineWidth = Math.max(2, 5 * P.m); ctx.stroke(); }
            turf(ctx, P, f.points, TURF.fairway, small ? 'SOLID' : f.mowPattern, angle, 9, 0.13);
        });
        if (ok(h.greenData)) {
            if (!small) { polyPath(ctx, P, h.greenData.points); ctx.strokeStyle = TURF.fringe; ctx.lineWidth = Math.max(2, 3 * P.m); ctx.stroke(); }
            turf(ctx, P, h.greenData.points, TURF.green, small ? 'SOLID' : h.greenData.mowPattern, angle, 3.5, 0.16);
        }
        (h.bunkers || []).filter(ok).forEach(function (b) { if (small) { polyPath(ctx, P, b.points); ctx.fillStyle = TURF.sand; ctx.fill(); } else sand(ctx, P, b.points); });
        (h.teeBoxes || []).filter(ok).forEach(function (t, k) {
            polyPath(ctx, P, t.points); ctx.fillStyle = TURF.fairway; ctx.fill();
            if (!small) { ctx.strokeStyle = TEE_COLORS[k] || '#f8fafc'; ctx.lineWidth = 2; ctx.stroke(); }
        });
        ctx.restore();
        const flag = (h.flag && typeof h.flag.x === 'number') ? h.flag : (ok(h.greenData) ? centroid(h.greenData.points) : null);
        if (flag && !small) drawFlag(ctx, { x: P.x(flag.x), y: P.z(flag.z) }, 11, '#ef4444');
        const tee = (h.teeBoxes || []).filter(ok)[0];
        if (opts.number != null && (tee || flag)) {
            const at = tee ? centroid(tee.points) : flag;
            teeMarker(ctx, { x: P.x(at.x), y: P.z(at.z) }, String(opts.number), small ? 7 : 10, 'rgba(248,250,252,0.9)', 1.5);
        }
    }
    // Every built hole except those in `skip` (indexes), numbered as the game numbers them (window.holeNumber)
    function drawBuiltHoles(ctx, P, opts) {
        opts = opts || {};
        const skip = opts.skip || [];
        (root.courseHoles || []).forEach(function (h, i) {
            if (!h || skip.indexOf(i) >= 0) return;
            const built = ok(h.greenData) || (h.fairways || []).some(ok) || (h.teeBoxes || []).some(ok) || (h.bunkers || []).some(ok);
            if (!built) return;
            const no = typeof root.holeNumber === 'function' ? root.holeNumber(i) : i + 1;
            drawBuiltHole(ctx, P, h, { alpha: opts.alpha, small: opts.small, number: no });
        });
    }

    // ---- map furniture ---------------------------------------------------------------------------------------
    // A scale bar of lenM metres (bottom left) and a north arrow (top right): -z is north on the plate, up on the map
    function drawFurniture(ctx, P, C, lenM) {
        const w = lenM * P.m, x = 12, y = C - 14;
        ctx.save();
        ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fillRect(x - 6, y - 16, w + 50, 24);
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(x, y - 2, w / 2, 4); ctx.fillStyle = '#0f172a'; ctx.fillRect(x + w / 2, y - 2, w / 2, 4);
        ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 2, w, 4);
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(lenM >= 1000 ? (lenM / 1000) + ' km' : lenM + ' m', x + w + 6, y);
        const nx = C - 20, ny = 22;
        ctx.beginPath(); ctx.arc(nx, ny, 13, 0, 7); ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx + 5, ny + 2); ctx.lineTo(nx, ny - 1); ctx.lineTo(nx - 5, ny + 2); ctx.closePath(); ctx.fill();
        ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 7);
        ctx.restore();
    }

    root.CourseMap = {
        TURF: TURF, TEE_COLORS: TEE_COLORS, MOW_PATTERNS: MOW_PATTERNS,
        renderTerrain: renderTerrain, polyPath: polyPath, paintMow: paintMow, turf: turf, sand: sand,
        drawFlag: drawFlag, teeMarker: teeMarker, holeAngle: holeAngle, drawBuiltHole: drawBuiltHole, drawBuiltHoles: drawBuiltHoles,
        drawFurniture: drawFurniture
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CourseMap;
})(typeof window !== 'undefined' ? window : globalThis);
