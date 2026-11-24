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

    // ---- colours from the course's own palette ------------------------------------------------------------
    // The maps take their colours from the active biome (CURRENT_BIOME_CONFIG, the palette the 3D view paints with), so a desert
    // course reads as desert on the map too. Each map colour is a palette colour nudged for the small picture (greens a little
    // lighter, the fringe and the fairway edge a little darker so they show); the summer palette gives the old hand-picked colours.
    const SUMMER = { roughColor: '#4C7D32', semiColor: '#659A3F', fairwayColor: '#79B84F', foregreenColor: '#9ACB67', greenColor: '#8ACF72',
        bunkerColor: '#E0D8A4', wasteColor: '#C2AF7C', teeColor: '#7cb54c', obColor: '#ef4444', fescueColor: '#315B2B' };
    function rgbOf(hex, fb) {
        const h = String(hex || fb || '').replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return fb ? rgbOf(fb) : [76, 125, 50];
        const n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function palRgb(key) { const c = root.CURRENT_BIOME_CONFIG || {}; return rgbOf(c[key], SUMMER[key]); }
    // t > 0 towards white, t < 0 towards black
    function shadeRgb(c, t) { return c.map(function (v) { return Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)); }); }
    function hexOf(c) { return '#' + c.map(function (v) { return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2); }).join(''); }
    const TURF_FROM = { rough: ['semiColor', -0.35], fairway: ['fairwayColor', 0.02], fringe: ['foregreenColor', -0.25], green: ['greenColor', 0.15], sand: ['bunkerColor', 0.25] };
    let turfMemo = { cfg: null, sig: '', out: {} };
    function turfColour(name) {
        const cfg = root.CURRENT_BIOME_CONFIG || null;
        const sig = cfg ? [cfg.semiColor, cfg.fairwayColor, cfg.foregreenColor, cfg.greenColor, cfg.bunkerColor].join() : '';
        if (turfMemo.cfg !== cfg || turfMemo.sig !== sig) turfMemo = { cfg: cfg, sig: sig, out: {} };
        if (!turfMemo.out[name]) { const f = TURF_FROM[name]; turfMemo.out[name] = hexOf(shadeRgb(palRgb(f[0]), f[1])); }
        return turfMemo.out[name];
    }
    // The ground under the holes on the terrain picture: the painted surface, in its palette colour. Rough, semi and deep rough all
    // read as rough (the plain ground of a grass plate); a desert plate starts as waste and reads as waste. OB is rough with a red cast.
    const GROUND_KEY = { 'SAND': 'bunkerColor', 'WASTE': 'wasteColor', 'GREEN': 'greenColor', 'TEE': 'teeColor', 'FOREGREEN': 'foregreenColor',
        'FAIRWAY': 'fairwayColor', 'SEMI-ROUGH': 'roughColor', 'DEEP ROUGH': 'roughColor', 'ROUGH': 'roughColor' };
    function groundRgb(type) {
        if (type === 'OB') { const r = palRgb('roughColor'), o = palRgb('obColor'); return [r[0] * 0.6 + o[0] * 0.4, r[1] * 0.6 + o[1] * 0.4, r[2] * 0.6 + o[2] * 0.4]; }
        return palRgb(GROUND_KEY[type] || 'roughColor');
    }

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
        const hgt = new Float32Array(N * N), wet = new Uint8Array(N * N), kind = new Array(N * N);
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
            const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null;
            const h = s && typeof s.z === 'number' ? s.z : 0;
            hgt[j * N + i] = h;
            kind[j * N + i] = s && s.type;
            if (s && s.type === 'WATER') wet[j * N + i] = 1;
            else { if (h < lo) lo = h; if (h > hi) hi = h; }
        }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        // colour: the painted ground in its palette colour, then by height relative to the typical land level (hills lighter, dips darker)
        const groundOf = {};
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
            const ty = kind[k] || 'ROUGH', c = groundOf[ty] || (groundOf[ty] = groundRgb(ty));
            const lift = 0.2 * up, sink = 0.16 * down;
            const r = (c[0] + (255 - c[0]) * lift - c[0] * sink) * shade, g = (c[1] + (255 - c[1]) * lift - c[1] * sink) * shade, b = (c[2] + (255 - c[2]) * lift - c[2] * sink) * shade;
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
            const ink = shadeRgb(palRgb('roughColor'), -0.65);   // the lines in a dark shade of the ground (dark green on grass, dark clay in the desert)
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
                octx.strokeStyle = 'rgba(' + ink.join(',') + ',' + (major ? 0.42 : 0.2) + ')';
                octx.lineWidth = major ? 1.6 : 1;
                octx.stroke();
            }
        }
        return off;
    }

    // ---- the course-guide look ----------------------------------------------------------------------------
    // read through getters: always the active biome's colours (see turfColour above)
    const TURF = { sandLip: 'rgba(120,88,36,0.5)' };
    Object.keys(TURF_FROM).forEach(function (name) { Object.defineProperty(TURF, name, { enumerable: true, get: function () { return turfColour(name); } }); });
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

    // ---- a built hole under a finger ---------------------------------------------------------------------------
    function isBuilt(h) { return !!h && (ok(h.greenData) || (h.fairways || []).some(ok) || (h.teeBoxes || []).some(ok) || (h.bunkers || []).some(ok)); }
    function inside(x, z, pts) {
        let c = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i], b = pts[j];
            if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
        }
        return c;
    }
    function segDist(px, pz, a, b) {
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)) : 0;
        return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    }
    // Where a built hole starts and ends: its back tee (the first tee box) and its flag, or the middle of its green
    function holeEnds(h) {
        const tee = (h.teeBoxes || []).filter(ok)[0];
        const end = (h.flag && typeof h.flag.x === 'number') ? { x: h.flag.x, z: h.flag.z } : (ok(h.greenData) ? centroid(h.greenData.points) : null);
        return { tee: tee ? centroid(tee.points) : null, green: end };
    }
    // The built hole at world (x, z): inside one of its parts, or within tolM metres of the line from its tee to its flag.
    // Returns its index in courseHoles, or -1. opts.skip: indices to leave out (holes being planned).
    function builtHoleAt(x, z, tolM, opts) {
        const skip = (opts && opts.skip) || [], holes = root.courseHoles || [];
        let best = -1, bestD = Infinity;
        for (let i = 0; i < holes.length; i++) {
            const h = holes[i];
            if (skip.indexOf(i) >= 0 || !isBuilt(h)) continue;
            const parts = [h.greenData].concat(h.fairways || [], h.teeBoxes || [], h.bunkers || []).filter(ok);
            if (parts.some(function (p) { return inside(x, z, p.points); })) return i;
            const e = holeEnds(h);
            if (e.tee && e.green) {
                const d = segDist(x, z, e.tee, e.green);
                if (d < tolM && d < bestD) { best = i; bestD = d; }
            }
        }
        return best;
    }
    // { par, length (m, back tee to flag; 0 when unknown), number } of a built hole
    function holeSummary(i) {
        const h = (root.courseHoles || [])[i];
        if (!h) return null;
        const e = holeEnds(h);
        return { par: h.par || 4, length: e.tee && e.green ? Math.round(Math.hypot(e.green.x - e.tee.x, e.green.z - e.tee.z)) : 0,
            number: typeof root.holeNumber === 'function' ? root.holeNumber(i) : i + 1, tee: e.tee, green: e.green };
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

    // ---- zoom and pan -----------------------------------------------------------------------------------------
    // A map's view: world point (ox, oz) in the middle of the canvas, magnified `zoom` times over the whole extent (half on each
    // side). Pinch and two-finger drag on a touch screen, the wheel with a mouse, and +, - and "show all" buttons. One finger (or a
    // mouse button) stays the map's own: it still moves holes and figures. opts: { half, C, max (zoom, default 5), onChange }
    function makeZoom(opts) {
        const half = opts.half, size = half * 2, C = opts.C, max = opts.max || 5;
        const z = { zoom: 1, ox: 0, oz: 0 };
        const pts = {};          // active touch pointers in canvas px
        let pinch = null, suppress = false;
        z.px = function (x) { return ((x - z.ox) * z.zoom + half) / size * C; };
        z.pz = function (wz) { return ((wz - z.oz) * z.zoom + half) / size * C; };
        z.m = function () { return C / size * z.zoom; };
        z.toWorld = function (px, py) { return { x: (px / C * size - half) / z.zoom + z.ox, z: (py / C * size - half) / z.zoom + z.oz }; };
        function clampView() {
            z.zoom = clamp(z.zoom, 1, max);
            const lim = half - half / z.zoom;
            z.ox = clamp(z.ox, -lim, lim); z.oz = clamp(z.oz, -lim, lim);
        }
        function changed() { clampView(); if (opts.onChange) opts.onChange(z); }
        // zoom by factor f keeping the world point under canvas px (px, py) where it is
        z.zoomAt = function (f, px, py) {
            const w = z.toWorld(px, py);
            z.zoom = clamp(z.zoom * f, 1, max);
            z.ox = w.x - (px / C * size - half) / z.zoom;
            z.oz = w.z - (py / C * size - half) / z.zoom;
            changed();
        };
        z.zoomBy = function (f) { z.zoomAt(f, C / 2, C / 2); };
        z.reset = function () { z.zoom = 1; z.ox = 0; z.oz = 0; changed(); };
        z.isZoomed = function () { return z.zoom > 1.001; };
        z.wheel = function (e, rect) {
            e.preventDefault();
            const px = (e.clientX - rect.left) * (C / rect.width), py = (e.clientY - rect.top) * (C / rect.height);
            z.zoomAt(Math.exp(-e.deltaY * 0.0015), px, py);
        };
        function canvasPt(e, rect) { return { x: (e.clientX - rect.left) * (C / rect.width), y: (e.clientY - rect.top) * (C / rect.height) }; }
        function startPinch() {
            const ids = Object.keys(pts), a = pts[ids[0]], b = pts[ids[1]];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom: z.zoom, world: z.toWorld(mid.x, mid.y) };
        }
        // Returns true when the event belongs to a two-finger gesture (or to its fingers' lifting): the map then leaves it alone
        z.pointerDown = function (e, rect) {
            if (e.pointerType !== 'touch') return false;
            pts[e.pointerId] = canvasPt(e, rect);
            if (Object.keys(pts).length >= 2) { startPinch(); suppress = true; return true; }
            return suppress;
        };
        z.pointerMove = function (e, rect) {
            if (!(e.pointerId in pts)) return suppress;
            pts[e.pointerId] = canvasPt(e, rect);
            if (!pinch || Object.keys(pts).length < 2) return suppress;
            const ids = Object.keys(pts), a = pts[ids[0]], b = pts[ids[1]];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            z.zoom = clamp(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist, 1, max);
            // the world point that was under the fingers' midpoint stays under it (pinch and two-finger drag in one)
            z.ox = pinch.world.x - (mid.x / C * size - half) / z.zoom;
            z.oz = pinch.world.z - (mid.y / C * size - half) / z.zoom;
            changed();
            return true;
        };
        z.pointerUp = function (e) {
            const had = e.pointerId in pts;
            delete pts[e.pointerId];
            const n = Object.keys(pts).length;
            if (n < 2) pinch = null;
            const eaten = suppress;
            if (n === 0) suppress = false;       // the gesture ends when every finger is up
            return had && eaten;
        };
        return z;
    }
    // +, - and "show all" buttons for a map, laid over its top-left corner (inside `wrap`, which must be position:relative)
    function zoomButtons(wrap, z) {
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute; left:8px; top:8px; display:flex; flex-direction:column; gap:4px; z-index:2;';
        const mk = function (label, title, fn) {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
            b.style.cssText = 'width:36px; height:36px; border:none; border-radius:9px; background:rgba(15,23,42,0.82); color:#f8fafc; font-size:18px; font-weight:bold; cursor:pointer; line-height:1;';
            b.onclick = function (e) { e.stopPropagation(); fn(); };
            box.appendChild(b);
            return b;
        };
        const plus = mk('+', tr('cm_zoom_in', 'Zooma in'), function () { z.zoomBy(1.6); });
        const minus = mk('−', tr('cm_zoom_out', 'Zooma ut'), function () { z.zoomBy(1 / 1.6); });
        const all = mk('⤢', tr('cm_zoom_all', 'Visa hela kartan'), function () { z.reset(); });
        wrap.appendChild(box);
        // dim what does nothing at the current zoom
        const sync = function () {
            minus.style.opacity = z.isZoomed() ? '1' : '0.4';
            all.style.opacity = z.isZoomed() ? '1' : '0.4';
        };
        sync();
        return { el: box, sync: sync, plus: plus, minus: minus, all: all };
    }

    // ---- the tabs that join the two maps: Hål (blueprint.js) | Omgivning (backdrop.js) ------------------------
    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    // The first empty hole on the plate (the current one first), or -1: the blueprint plans empty holes only
    function firstEmptyHole() {
        const HG = root.HoleGenerator, holes = root.courseHoles || [];
        if (!HG) return -1;
        const total = Math.min(root.MAX_HOLES || 3, holes.length);
        if (holes[root.currentHoleIndex] && root.currentHoleIndex < total && HG.holeIsEmpty(holes[root.currentHoleIndex])) return root.currentHoleIndex;
        for (let i = 0; i < total; i++) if (HG.holeIsEmpty(holes[i])) return i;
        return -1;
    }
    // Switch to a tab. The map that is open closes first (the blueprint keeps a plan that is not built yet, see blueprint.js)
    function openTab(name) {
        if (name === 'holes') {
            // the map plans the empty holes and shows the built ones (blueprint.js picks the holes itself)
            if (root.Backdrop && root.Backdrop.close) root.Backdrop.close();
            if (typeof root.openHoleBlueprint === 'function') root.openHoleBlueprint();
            return true;
        }
        if (root.HoleBlueprint && root.HoleBlueprint.state && root.HoleBlueprint.state()) root.HoleBlueprint.close(false, true, true);
        if (typeof root.openBackdropMap === 'function') root.openBackdropMap();
        return true;
    }
    // A two-button tab strip for a map's header; active: 'holes' | 'surround'. The Hål tab always opens: with every hole built it
    // shows the course to look at, and a tap on a hole takes it to the builder.
    function mapTabs(active) {
        const box = document.createElement('div');
        box.setAttribute('role', 'tablist');
        box.style.cssText = 'display:flex; gap:2px; padding:3px; border-radius:12px; background:#0f172a; border:1px solid #1e293b; flex:1; min-width:0;';
        [['holes', '🗺️ ' + tr('cm_tab_holes', 'Hål')], ['surround', '🏔️ ' + tr('cm_tab_surround', 'Omgivning')]].forEach(function (t) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = t[1];
            b.dataset.tab = t[0];
            const on = t[0] === active, off = false;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.style.cssText = 'flex:1; min-height:38px; border:none; border-radius:9px; font-weight:bold; font-size:14px; white-space:nowrap; cursor:' + (on || off ? 'default' : 'pointer') + ';' +
                'background:' + (on ? '#14532d' : 'transparent') + '; color:' + (on ? '#f8fafc' : (off ? '#475569' : '#cbd5e1')) + ';';
            if (!on && !off) b.onclick = function () { openTab(t[0]); };
            box.appendChild(b);
        });
        return box;
    }

    root.CourseMap = {
        TURF: TURF, TEE_COLORS: TEE_COLORS, MOW_PATTERNS: MOW_PATTERNS,
        renderTerrain: renderTerrain, polyPath: polyPath, paintMow: paintMow, turf: turf, sand: sand,
        drawFlag: drawFlag, teeMarker: teeMarker, holeAngle: holeAngle, drawBuiltHole: drawBuiltHole, drawBuiltHoles: drawBuiltHoles,
        drawFurniture: drawFurniture, makeZoom: makeZoom, zoomButtons: zoomButtons, mapTabs: mapTabs, openTab: openTab, firstEmptyHole: firstEmptyHole,
        isBuilt: isBuilt, builtHoleAt: builtHoleAt, holeSummary: holeSummary
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CourseMap;
})(typeof window !== 'undefined' ? window : globalThis);
