/*
 * Backdrop map: look down on the course AND the land around it, then put big figures (mountains, boats, a clubhouse)
 * where they belong. The figures are the ordinary placed objects (window.placedTrees), so they save, load and undo
 * like everything else; the map only makes them easy to aim, size and repeat. The ground outside the plate is a flat
 * colour, so a figure there stands at height 0 and the asset's own Y offset (set in Admin) decides how deep it sinks.
 */
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;

    const BACKDROP_MIN = 80;      // m: assets this tall count as backdrop figures (mountains) and push the fog out
    const SHELF_MIN = 20;         // m: the "Big" shelf (boats, clubhouses) starts here
    const VIEW = 1400;            // m from the plate centre to the map edge
    const RING_GAP = 80;          // m of open ground between the plate edge and a figure placed by "All around"
    const RING_COUNT = 8;
    const FOG_LIMIT = 4000;
    let B = null;                 // open map state
    const checkTries = new WeakMap();   // how often a figure's deferred check has had to wait again
    let pendingChecks = [];       // figures to test against the plate once their model has loaded; outlives the map, which may be closed first

    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function toast(msg, color) { if (typeof root.showBuildToast === 'function') root.showBuildToast(msg, color || '#38bdf8'); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function reg(type) { return (root.ASSET_REGISTRY && root.ASSET_REGISTRY[type]) || null; }
    function plateHalf() { return (root.TERRAIN_SIZE || 600) / 2; }
    // Heights are remembered per type: switching asset presets empties the registry, but the figures stay in the course
    const knownHeight = {};
    function remember(type) { const d = reg(type); if (d && d.targetHeight) knownHeight[type] = d.targetHeight; }
    function heightOf(o) {
        remember(o.type);
        const h = knownHeight[o.type];
        return h ? h * (o.scale || 1) : 0;
    }
    function outsidePlate(o) { const half = plateHalf(); return Math.abs(o.x) > half || Math.abs(o.z) > half; }
    // ---- exact footprint ---------------------------------------------------------------------------------
    // A model is scaled uniformly so its HEIGHT equals the asset's targetHeight, and is centred on x/z (arcade.html loadAsset),
    // so its width and depth are whatever the mesh happens to be. We therefore read the loaded mesh itself: the convex hull of
    // every vertex seen from above, in metres at scale 1. A placed figure is that hull * o.scale, turned the way the renderer turns it.
    // fpCache holds a hull per type; a type whose model has not loaded yet gets none, and the old rough circle is used meanwhile.
    const fpCache = {};
    const fpAsked = {};
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    function convexHull(pts) {
        pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        const lo = [], up = [];
        pts.forEach(function (p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
        for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
        lo.pop(); up.pop();
        return lo.concat(up);
    }
    // Mirrors rebuildInstancePool (arcade.html): each sub-mesh sits at the instance position + its world position * scale, UNturned,
    // and only its geometry (stretched by the mesh's signed world scale) is turned by the instance's Euler YXZ rotation and scaled.
    // A vertex therefore lands at  offset + R * (localVertex * worldScale). Every vertex is used, none is sampled away.
    function computeFootprint(type) {
        const model = root.customModels && root.customModels[type];
        if (!model || model === 'LOADING' || !model.isObject3D) return null;
        model.updateWorldMatrix(true, true);
        const meshes = [];
        let total = 0, reach = 0;
        model.traverse(function (m) {
            if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
            const pos = m.geometry.attributes.position, e = m.matrixWorld.elements, n = pos.count;
            // signed like Object3D.getWorldScale, which the renderer uses: a mirrored mesh (negative determinant) flips x
            const det = e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
            const mesh = { pos: pos, n: n, sx: Math.hypot(e[0], e[1], e[2]) * (det < 0 ? -1 : 1), sy: Math.hypot(e[4], e[5], e[6]), sz: Math.hypot(e[8], e[9], e[10]), ox: e[12], oz: e[14] };
            let far = 0;
            for (let i = 0; i < n; i++) { const x = pos.getX(i) * mesh.sx, z = pos.getZ(i) * mesh.sz; far = Math.max(far, x * x + z * z); }
            reach = Math.max(reach, Math.hypot(mesh.ox, mesh.oz) + Math.sqrt(far));   // furthest a vertex gets from the centre, turned about Y
            total += n;
            meshes.push(mesh);
        });
        if (total < 3) return null;
        const fp = { meshes: meshes, model: model, sx: model.scale.x, cache: new Map(), reach: reach };
        const flat = outlineFor(fp, 0, 0, 0);
        fp.w = flat.w; fp.d = flat.d;
        return fp;
    }
    // Outline of a figure at scale 1 relative to its centre, for the given turn/tilt/roll (cached per angle set, least recently used out first).
    // Every vertex is turned and looked at and the outline is exact: a rough hull from the point furthest out in each of SECTORS angular
    // slices is built first, and only the points that fall outside it are added to the final hull.
    const SECTORS = 2048;
    function outlineFor(fp, rot, tilt, roll) {
        const key = rot + '|' + tilt + '|' + roll, hit = fp.cache.get(key);   // exact angles: a rounded key would hand one figure another's outline
        if (hit) { fp.cache.delete(key); fp.cache.set(key, hit); return hit; }   // most recently used goes last
        const cz = Math.cos(roll), sz = Math.sin(roll), cx = Math.cos(tilt), sx = Math.sin(tilt), cy = Math.cos(rot), sy = Math.sin(rot);
        const out = [0, 0];
        function at(m, i) {
            const lx = m.pos.getX(i) * m.sx, ly = m.pos.getY(i) * m.sy, lz = m.pos.getZ(i) * m.sz;
            const x1 = lx * cz - ly * sz, y1 = lx * sz + ly * cz, z2 = y1 * sx + lz * cx;
            out[0] = m.ox + x1 * cy + z2 * sy; out[1] = m.oz - x1 * sy + z2 * cy;
        }
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        fp.meshes.forEach(function (m) { for (let i = 0; i < m.n; i++) { at(m, i); x0 = Math.min(x0, out[0]); x1 = Math.max(x1, out[0]); z0 = Math.min(z0, out[1]); z1 = Math.max(z1, out[1]); } });
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;   // only the origin for the angular slices below, which any point can serve as
        const bestR = new Float64Array(SECTORS).fill(-1), bestX = new Float64Array(SECTORS), bestZ = new Float64Array(SECTORS);
        fp.meshes.forEach(function (m) {
            for (let i = 0; i < m.n; i++) {
                at(m, i);
                const dx = out[0] - mx, dz = out[1] - mz, k = Math.min(SECTORS - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * SECTORS)), r = dx * dx + dz * dz;
                if (r > bestR[k]) { bestR[k] = r; bestX[k] = out[0]; bestZ[k] = out[1]; }
            }
        });
        const kept = [];
        for (let k = 0; k < SECTORS; k++) if (bestR[k] >= 0) kept.push([bestX[k], bestZ[k]]);
        const rough = convexHull(kept);
        // Exact step: a point strictly inside a convex polygon made of real vertices can never be a corner of the true outline, so
        // only the (few) points outside `rough` can add to it. Find each point's wedge of `rough` by angle and test it against that edge.
        let hull = rough;
        if (rough.length >= 3) {
            // the wedges need a point that really is inside `rough`: the mean of a convex polygon's corners always is (the box middle need not be)
            let cxm = 0, czm = 0;
            rough.forEach(function (p) { cxm += p[0]; czm += p[1]; });
            cxm /= rough.length; czm /= rough.length;
            const ring = rough.map(function (p) { return { p: p, a: Math.atan2(p[1] - czm, p[0] - cxm) }; }).sort(function (u, v) { return u.a - v.a; });
            const H = ring.length, ang = ring.map(function (r) { return r.a; });
            const side = function (u, v, x, z) { return (v[0] - u[0]) * (z - u[1]) - (v[1] - u[1]) * (x - u[0]); };
            const extra = [];
            fp.meshes.forEach(function (m) {
                for (let i = 0; i < m.n; i++) {
                    at(m, i);
                    const x = out[0], z = out[1], a = Math.atan2(z - czm, x - cxm);
                    let lo = 0, hi = H - 1, j = H - 1;   // last wedge start at or before a (the wrap-around wedge when a precedes them all)
                    if (a >= ang[0]) { while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ang[mid] <= a) lo = mid; else hi = mid - 1; } j = lo; }
                    const u = ring[j].p, v = ring[(j + 1) % H].p;
                    if (side(u, v, x, z) * side(u, v, cxm, czm) < 0) extra.push([x, z]);
                }
            });
            if (extra.length) hull = convexHull(rough.concat(extra));
        }
        let rad = 0;
        hull.forEach(function (p) { rad = Math.max(rad, Math.hypot(p[0], p[1])); });
        const res = { hull: hull, rad: rad, w: x1 - x0, d: z1 - z0 };
        fp.cache.set(key, res);
        // drop the longest-unused outlines one at a time; never fewer than the orientations placed figures are using right now
        if (fp.cache.size > 400) {
            const keep = Math.max(400, 2 * (root.placedTrees || []).length);
            for (const k of fp.cache.keys()) { if (fp.cache.size <= keep) break; fp.cache.delete(k); }
        }
        return res;
    }
    function footprintOf(type) {
        const hit = fpCache[type], live = root.customModels && root.customModels[type];
        // Saving a prop as the new default rescales the model itself (arcade-library.js savePropAsDefault): measure it again
        if (hit && hit.model === live && hit.sx === live.scale.x) return hit;
        const fp = computeFootprint(type);
        if (fp) { fpCache[type] = fp; return fp; }
        // not loaded yet: ask for it once; the map redraws twice a second and picks it up
        // (a failed download leaves customModels[type] empty again, so ask again after a few seconds rather than never)
        const now = Date.now();
        if ((!fpAsked[type] || now - fpAsked[type] > 4000) && live !== 'LOADING' && typeof root.loadAsset === 'function' && reg(type)) {
            fpAsked[type] = now;
            try { root.loadAsset(type); } catch (err) { /* stays a circle */ }
        }
        return null;
    }
    // Outline of a placed figure at scale 1, relative to its centre, turned the way rebuildInstancePool turns it (Euler YXZ)
    function relativeOutline(o) {
        const fp = footprintOf(o.type);
        return fp ? outlineFor(fp, o.rot || 0, o.tiltX || 0, o.rollZ || 0) : null;
    }
    // The figure's outline on the ground in world metres, or null while its model has not loaded
    function outlineOf(o) {
        const rel = relativeOutline(o);
        if (!rel) return null;
        const s = o.scale || 1;
        return rel.hull.map(function (p) { return [o.x + s * p[0], o.z + s * p[1]]; });
    }
    // Furthest reach of a figure from its centre. Without a loaded model: a rough guess
    function radiusOf(o) { const rel = relativeOutline(o); return rel ? rel.rad * (o.scale || 1) : 0.6 * heightOf(o); }
    function pointInPoly(x, z, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            if (((poly[i][1] > z) !== (poly[j][1] > z)) && (x < (poly[j][0] - poly[i][0]) * (z - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) inside = !inside;
        }
        return inside;
    }
    // Does the figure's base reach over the course plate? Exact and linear in the outline's corners: for a convex outline and a box, if they
    // do not overlap there is a separating line along one of the box's sides or along one of the outline's edges (with the outline behind it)
    function coversPlate(o) {
        const half = plateHalf(), poly = outlineOf(o);
        if (!poly) return Math.hypot(Math.max(0, Math.abs(o.x) - half), Math.max(0, Math.abs(o.z) - half)) < radiusOf(o);
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        poly.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
        if (x0 >= half || x1 <= -half || z0 >= half || z1 <= -half) return false;
        // the hull runs counter-clockwise, so an edge a->b has its outside on the (dz, -dx) side; the plate (centred on 0) lies fully beyond
        // that edge when its smallest value along the normal, -half * (|nx| + |nz|), is at least the edge's own
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], nx = b[1] - a[1], nz = -(b[0] - a[0]);
            if (-half * (Math.abs(nx) + Math.abs(nz)) >= a[0] * nx + a[1] * nz) return false;
        }
        return true;
    }

    // ---- fog: far figures must stay visible at dawn and dusk -------------------------------------------
    // arcade-scene-engine.js reads this when it sets the fog, so the fog ends beyond the farthest big figure.
    // Fog is measured from the camera, which can stand anywhere on the plate: use the farthest plate corner
    function sceneryMaxRadius() {
        const half = plateHalf();
        let far = 0;
        (root.placedTrees || []).forEach(function (o) {
            if (!o) return;
            const h = heightOf(o);
            if (h < SHELF_MIN || !(h >= BACKDROP_MIN || outsidePlate(o))) return;
            far = Math.max(far, Math.hypot(Math.abs(o.x) + half, Math.abs(o.z) + half) + 0.5 * h);
        });
        return Math.min(far, FOG_LIMIT);
    }
    root.getSceneryMaxRadius = sceneryMaxRadius;
    // a big figure (shelf size or more) really stands outside the plate
    root.hasOuterScenery = function () {
        return (root.placedTrees || []).some(function (o) { return o && outsidePlate(o) && heightOf(o) >= SHELF_MIN; });
    };
    let lastFog = 0;
    function refreshFog() {
        const r = Math.round(sceneryMaxRadius());
        if (r === lastFog) return;
        lastFog = r;
        if (typeof root.setTimeOfDay === 'function' && root.currentTimeOfDay != null) root.setTimeOfDay(root.currentTimeOfDay);
    }
    // courses are loaded by several different paths, so look now and then instead of hooking each one
    setInterval(function () { (root.placedTrees || []).forEach(function (o) { if (o) remember(o.type); }); refreshFog(); recheckLoaded(); }, 2000);

    // ---- the picture ---------------------------------------------------------------------------------------
    // The colour a surround choice has in the scene (same lookup as updateSurroundColors)
    const EDGE_CHOICES = ['roughColor', 'fescueColor', 'wasteColor', 'waterColor', 'oceanColor', 'horizonColor', 'skyColor'];
    function edgeRgb(key) {
        const biome = root.CURRENT_BIOME_CONFIG || {};
        if (key === 'NONE') key = 'skyColor';
        let hex = biome[key];
        if (!hex && key === 'oceanColor') hex = biome.waterColor || '#1e3a5f';
        if (!hex && key === 'horizonColor') hex = '#ffffff';
        if (!hex && key === 'skyColor') hex = '#87ceeb';
        if (!hex) hex = '#2d4c1a';
        const n = parseInt(String(hex).replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function edgeLabel(key) { return tr('surr_opt_' + String(key).replace('Color', ''), key); }

    // The same four-way blend the real surround uses, drawn small and stretched
    function surroundPicture() {
        const cfg = root.surroundConfig || { N: 'roughColor', E: 'roughColor', S: 'roughColor', W: 'roughColor' };
        const col = edgeRgb, cN = col(cfg.N), cE = col(cfg.E), cS = col(cfg.S), cW = col(cfg.W);
        const power = root.surroundMat && root.surroundMat.userData && root.surroundMat.userData.blendPower ? root.surroundMat.userData.blendPower.value : 1.5;
        const N = 48, off = document.createElement('canvas');
        off.width = N; off.height = N;
        const octx = off.getContext('2d'), img = octx.createImageData(N, N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const a = Math.atan2(j - N / 2 + 0.5, i - N / 2 + 0.5);
            const wE = Math.pow(Math.max(0, Math.cos(a)), power), wS = Math.pow(Math.max(0, Math.sin(a)), power);
            const wW = Math.pow(Math.max(0, -Math.cos(a)), power), wN = Math.pow(Math.max(0, -Math.sin(a)), power);
            const sum = (wE + wS + wW + wN) || 1, p = (j * N + i) * 4;
            for (let c = 0; c < 3; c++) img.data[p + c] = (cE[c] * wE + cS[c] * wS + cW[c] * wW + cN[c] * wN) / sum;
            img.data[p + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        return off;
    }

    function cx(x) { return (x + VIEW) / (2 * VIEW) * B.C; }
    function cz(z) { return (z + VIEW) / (2 * VIEW) * B.C; }
    function mToPx(m) { return m / (2 * VIEW) * B.C; }

    // Figures shown on the map: big ones, and anything outside the plate (trees and bushes on the plate are too small to draw)
    function mapObjects() {
        return (root.placedTrees || []).filter(function (o) {
            if (!o) return false;
            const h = heightOf(o);
            return h >= SHELF_MIN || (outsidePlate(o) && h > 0);
        });
    }
    function minPickPx() { return 16; }

    function draw() {
        if (!B) return;
        const ctx = B.ctx, C = B.C, half = plateHalf();
        ctx.setTransform(B.dpr, 0, 0, B.dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(B.surround, 0, 0, C, C);
        // distance rings every 500 m
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
        [500, 1000].forEach(function (m) { ctx.beginPath(); ctx.arc(C / 2, C / 2, mToPx(m), 0, 7); ctx.stroke(); });
        // the course plate
        ctx.drawImage(B.plate, cx(-half), cz(-half), mToPx(half * 2), mToPx(half * 2));
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(cx(-half), cz(-half), mToPx(half * 2), mToPx(half * 2));
        // holes already built
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ((B.others && B.others.polygons) || []).forEach(function (poly) {
            ctx.beginPath();
            poly.forEach(function (p, i) { if (i) ctx.lineTo(cx(p.x), cz(p.z)); else ctx.moveTo(cx(p.x), cz(p.z)); });
            ctx.closePath(); ctx.fill(); ctx.stroke();
        });
        // figures: the real outline of the base (same shape, size and turn as the 3D model); a circle until the model has loaded
        mapObjects().forEach(function (o) {
            const big = heightOf(o) >= BACKDROP_MIN, sel = o === B.sel, poly = outlineOf(o);
            const rr = Math.max(heightOf(o) >= SHELF_MIN ? 5 : 3, mToPx(radiusOf(o))), over = big && coversPlate(o);
            ctx.beginPath();
            if (poly) poly.forEach(function (p, i) { if (i) ctx.lineTo(cx(p[0]), cz(p[1])); else ctx.moveTo(cx(p[0]), cz(p[1])); });
            else ctx.arc(cx(o.x), cz(o.z), rr, 0, 7);
            ctx.closePath();
            ctx.fillStyle = over ? 'rgba(239,68,68,0.55)' : (big ? 'rgba(120,113,108,0.65)' : 'rgba(56,189,248,0.7)'); ctx.fill();
            ctx.lineWidth = sel ? 3 : 1.2; ctx.strokeStyle = sel ? '#facc15' : (over ? '#ef4444' : 'rgba(15,23,42,0.8)');
            if (!poly) ctx.setLineDash([4, 3]);
            ctx.stroke(); ctx.setLineDash([]);
            // a figure too small to see as an outline still gets a dot to grab
            if (poly && mToPx(radiusOf(o)) < 5) { ctx.beginPath(); ctx.arc(cx(o.x), cz(o.z), 4, 0, 7); ctx.fillStyle = 'rgba(56,189,248,0.9)'; ctx.fill(); }
            // a notch shows which way the figure faces
            if (sel || big) {
                const a = -(o.rot || 0), nr = Math.max(4, mToPx(radiusOf(o)));
                ctx.beginPath(); ctx.moveTo(cx(o.x), cz(o.z)); ctx.lineTo(cx(o.x) + Math.cos(a) * nr, cz(o.z) + Math.sin(a) * nr);
                ctx.strokeStyle = 'rgba(15,23,42,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
            }
            if (sel) {
                const d = reg(o.type), fp = footprintOf(o.type), sc = o.scale || 1;
                const size = fp ? ' · ' + Math.round(fp.w * sc) + '×' + Math.round(fp.d * sc) + ' m' : '';
                ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                ctx.fillText(((d && d.name) || o.type) + ' · ' + Math.round(heightOf(o)) + ' m h' + size, cx(o.x), cz(o.z) + rr + 3);
            }
        });
        ctx.fillStyle = 'rgba(248,250,252,0.85)'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(tr('bd_plate', 'Banan'), C / 2, C / 2);
    }

    // ---- shelf & buttons -----------------------------------------------------------------------------------
    function shelfAssets() {
        const out = [];
        Object.keys(root.ASSET_REGISTRY || {}).forEach(function (type) {
            const d = root.ASSET_REGISTRY[type];
            if (!d) return;
            const h = d.targetHeight || 0;
            if (B.showAll ? true : h >= SHELF_MIN) out.push({ type: type, def: d, h: h });
        });
        out.sort(function (a, b) { return b.h - a.h; });
        return out;
    }
    function buildShelf() {
        const box = B.dom.shelf;
        box.textContent = '';
        const list = shelfAssets();
        // a figure the active filter hides must not stay selected without anything showing it
        if (B.shelfType && !list.some(function (a) { return a.type === B.shelfType; })) B.shelfType = null;
        if (!list.length) {
            const m = document.createElement('div');
            m.style.cssText = 'color:#94a3b8; font-size:12px; padding:8px; line-height:1.35;';
            m.textContent = tr('bd_empty', 'Inga stora figurer än. Ladda upp en .glb i Admin med Target Height 80 m eller mer.');
            box.appendChild(m);
            return;
        }
        list.forEach(function (a) {
            const b = document.createElement('button');
            b.type = 'button';
            const on = B.shelfType === a.type;
            b.style.cssText = 'flex:none; width:78px; padding:4px; border-radius:10px; cursor:pointer; color:#e2e8f0; font-size:10px; line-height:1.15; border:2px solid ' + (on ? '#facc15' : '#334155') + '; background:' + (on ? '#422006' : '#1e293b') + ';';
            const pic = document.createElement('div');
            pic.style.cssText = 'width:100%; height:44px; border-radius:6px; background:#0f172a center/cover no-repeat; display:flex; align-items:center; justify-content:center; font-size:22px;';
            if (a.def.thumbnail) pic.style.backgroundImage = 'url("' + String(a.def.thumbnail).replace(/"/g, '%22') + '")'; else pic.textContent = a.def.icon || '🏔️';
            const nm = document.createElement('div');
            nm.style.cssText = 'margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            nm.textContent = a.def.name || a.type;
            const hh = document.createElement('div');
            hh.style.cssText = 'color:#94a3b8;';
            hh.textContent = Math.round(a.h) + ' m';
            b.appendChild(pic); b.appendChild(nm); b.appendChild(hh);
            b.onclick = function () { B.shelfType = on ? null : a.type; B.sel = null; B.edge = null; refresh(); };
            box.appendChild(b);
        });
    }
    function enable(btn, on) { btn.disabled = !on; btn.style.opacity = on ? '1' : '0.4'; btn.style.cursor = on ? 'pointer' : 'not-allowed'; }
    function refresh() {
        if (!B) return;
        refreshEdges();
        buildShelf();
        const has = !!B.sel;
        [B.dom.bigger, B.dom.smaller, B.dom.higher, B.dom.lower, B.dom.turnL, B.dom.turnR, B.dom.del].forEach(function (b) { enable(b, has); });
        enable(B.dom.ring, !!(B.shelfType || (B.sel && B.sel.type)));
        B.dom.big.style.background = B.showAll ? '#1e293b' : '#38bdf8'; B.dom.big.style.color = B.showAll ? '#e2e8f0' : '#0f172a';
        B.dom.all.style.background = B.showAll ? '#38bdf8' : '#1e293b'; B.dom.all.style.color = B.showAll ? '#0f172a' : '#e2e8f0';
        draw();
    }
    function say(text) { B.dom.status.textContent = text; }

    // ---- edge buttons: pick what meets the eye on each side of the plate -----------------------------------
    const SIDES = ['N', 'E', 'S', 'W'];
    function sideName(side) { return side === 'W' ? tr('bd_dir_w', 'V') : (side === 'E' ? tr('bd_dir_e', 'Ö') : side); }
    function emojiOf(key) { const m = String(edgeLabel(key)).match(/^\S+/); return m ? m[0] : ''; }
    function refreshEdges() {
        if (!B) return;
        const cfg = root.surroundConfig || {};
        SIDES.forEach(function (side) {
            const chip = B.dom.edge[side], c = edgeRgb(cfg[side]);
            const on = B.edge === side;
            chip.style.background = 'rgb(' + c.map(Math.round).join(',') + ')';
            chip.style.borderColor = on ? '#facc15' : 'rgba(15,23,42,0.85)';
            chip.style.boxShadow = on ? '0 0 0 2px #facc15' : 'none';
            chip.textContent = sideName(side) + ' ' + emojiOf(cfg[side]);
        });
        const box = B.dom.choices;
        box.style.display = B.edge ? 'flex' : 'none';
        box.textContent = '';
        if (!B.edge) return;
        EDGE_CHOICES.forEach(function (key) {
            const b = document.createElement('button');
            b.type = 'button';
            const on = cfg[B.edge] === key, c = edgeRgb(key);
            b.textContent = edgeLabel(key);
            b.style.cssText = 'flex:1 1 30%; min-height:36px; padding:0 6px; border-radius:10px; font-size:12px; font-weight:bold; cursor:pointer; color:#f8fafc; text-shadow:0 1px 2px rgba(0,0,0,0.9); border:2px solid ' + (on ? '#facc15' : 'rgba(15,23,42,0.85)') + '; background:rgb(' + c.map(Math.round).join(',') + ');';
            b.onclick = function () { setEdge(B.edge, key); };
            box.appendChild(b);
        });
    }
    function setEdge(side, key) {
        const sel = document.getElementById('surr-' + side);
        if (!sel || typeof root.updateSurroundColors !== 'function') return;
        undoPoint();
        sel.value = key;
        root._surroundTouched = true;   // the next-step guide counts the surroundings as started
        root._editRev = (root._editRev || 0) + 1;   // the next-step guide: an edit, not a restore
        root.updateSurroundColors();   // reads the four selects, saves on every hole of the plate and recolours the scene
        B.surround = surroundPicture();
        refreshEdges();
        refresh();
    }

    // ---- editing -------------------------------------------------------------------------------------------
    // Undo and redo rebuild every placed object, so a selection can point at one that no longer exists
    function dropStaleSelection() {
        if (B && B.sel && (root.placedTrees || []).indexOf(B.sel) < 0) { B.sel = null; B.drag = null; }
    }
    function undoPoint() { if (typeof root.saveUndoState === 'function') root.saveUndoState(); }
    let saveTimer = 0;
    function persist() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { if (typeof root.saveLevel === 'function') root.saveLevel(); refreshFog(); }, 400);
    }
    function groundAt(x, z) {
        const half = plateHalf();
        if (Math.abs(x) > half || Math.abs(z) > half || !root.localGetTerrainAt) return 0;
        const s = root.localGetTerrainAt(x, -z);
        return s && typeof s.z === 'number' ? s.z : 0;
    }
    function rebuild(type) { if (root.PlacedObjects) root.PlacedObjects.rebuild(type); }
    function create(type, x, z, scale, rot, defer) {
        const d = reg(type), list = root.placedTrees;
        root.PlacedObjects.create(type, x, z, scale, rot, '#ffffff', '#ffffff', d && d.yOffset !== undefined ? d.yOffset : 0, d && d.brightness !== undefined ? d.brightness : 1.0, !!defer, 0, 0);
        return list[list.length - 1];
    }
    function place(x, z) {
        undoPoint();
        const o = create(B.shelfType, x, z, 1, Math.random() * Math.PI * 2, false);
        B.sel = o;
        persist();
        return o;
    }
    function remove(o) {
        const i = root.placedTrees.indexOf(o);
        if (i < 0) return;
        undoPoint();
        root.placedTrees.splice(i, 1);
        rebuild(o.type);
        if (B.sel === o) B.sel = null;
        persist();
    }
    function change(fn) {
        dropStaleSelection();
        if (!B || !B.sel) return;
        undoPoint();
        fn(B.sel);
        rebuild(B.sel.type);
        persist();
        warnIfCovering(B.sel);
        refresh();
    }
    // Place figures evenly around the plate with open ground between plate and figure
    // `job` is only passed by ring's own retries: it pins the figure that was asked for, and B.ringJob lets one request wait at a time
    function ring(job) {
        if (!job && B.ringJob) return;   // already waiting for a model to load: another tap must not queue a second ring
        const type = job ? job.type : (B.shelfType || (B.sel && B.sel.type));
        const d = type && reg(type);
        if (!d) { B.ringJob = null; toast(tr('bd_pick_first', 'Välj först en figur i hyllan.'), '#f59e0b'); return; }
        // the real size is only known once the model has loaded: wait for it (up to ~10 s) rather than lay out a guess
        if (!footprintOf(type) && !(job && job.waited >= 20)) {
            job = job || { type: type, waited: 0 };
            job.waited++;
            B.ringJob = job;
            say(tr('bd_loading', 'Laddar figuren…'));
            const mine = B;
            setTimeout(function () { if (B === mine && B.ringJob === job) ring(job); }, 500);
            return;
        }
        B.ringJob = null;
        undoPoint();
        const H = d.targetHeight || 10, half = plateHalf(), a0 = Math.random() * Math.PI * 2, limit = VIEW * 0.95;
        const fp = footprintOf(type), unitR = fp ? fp.reach : 0.6 * H;   // reach of one figure at scale 1, whatever way it is turned
        // distance from the plate square (not from its centre) to a point at distance t along the direction (ux, uz)
        function gapAt(t, ux, uz) { return Math.hypot(Math.max(0, Math.abs(ux * t) - half), Math.max(0, Math.abs(uz * t) - half)); }
        for (let k = 0; k < RING_COUNT; k++) {
            const ang = a0 + k * 2 * Math.PI / RING_COUNT + (Math.random() - 0.5) * 0.25, ux = Math.cos(ang), uz = Math.sin(ang);
            let sc = 0.8 + Math.random() * 0.4, R = unitR * sc, dist = 0;
            // push the centre out until the figure's whole reach clears the plate by RING_GAP; shrink it if that goes off the map
            for (let tries = 0; tries < 14; tries++) {
                let lo = 0, hi = limit * 2;
                for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (gapAt(mid, ux, uz) >= R + RING_GAP) hi = mid; else lo = mid; }
                dist = hi;
                if (dist + R <= limit || R <= 10) break;
                sc *= 0.85; R = unitR * sc;
            }
            create(type, ux * dist, uz * dist, sc, Math.random() * Math.PI * 2, true);
        }
        rebuild(type);
        B.sel = null;
        persist();
        say(tr('bd_ring_done', '{n} figurer utlagda runt banan. Flytta dem som du vill.').replace('{n}', RING_COUNT));
        refresh();
    }

    // A figure placed before its model has loaded is only checked against a rough guess, so it is checked again once its real outline exists.
    // The queue is not part of the map's state: tapping Done before a slow model arrives must not drop the warning.
    function warnIfCovering(o) {
        if (!o || heightOf(o) < BACKDROP_MIN) return;
        if (!footprintOf(o.type)) {
            const tries = (checkTries.get(o) || 0) + 1;
            checkTries.set(o, tries);
            if (tries <= 30 && pendingChecks.indexOf(o) < 0) pendingChecks.push(o);   // ~1 minute, then the model is taken as unloadable
            return;
        }
        checkTries.delete(o);
        pendingChecks = pendingChecks.filter(function (x) { return x !== o; });
        if (coversPlate(o)) toast(tr('bd_covers', '⚠️ Figurens bas ligger över banan. Flytta den längre ut eller gör den mindre.'), '#ef4444');
    }
    function recheckLoaded() {
        if (!pendingChecks.length) return;
        const waiting = pendingChecks;
        pendingChecks = [];
        waiting.forEach(function (o) {
            if ((root.placedTrees || []).indexOf(o) < 0) return;   // removed or undone meanwhile
            warnIfCovering(o);   // asks again if the model is still not there
        });
    }

    // ---- pointer handling ----------------------------------------------------------------------------------
    function toWorld(e) {
        const r = B.canvas.getBoundingClientRect();
        const px = (e.clientX - r.left) * (B.C / r.width), py = (e.clientY - r.top) * (B.C / r.height);
        return { px: px, py: py, x: px / B.C * 2 * VIEW - VIEW, z: py / B.C * 2 * VIEW - VIEW };
    }
    function hit(p) {
        const list = mapObjects();
        for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i], poly = outlineOf(o);
            // inside the drawn outline, or near the centre (so a thin figure can still be grabbed)
            if (poly ? (pointInPoly(p.x, p.z, poly) || Math.hypot(p.px - cx(o.x), p.py - cz(o.z)) <= minPickPx())
                     : Math.hypot(p.px - cx(o.x), p.py - cz(o.z)) <= Math.max(minPickPx(), mToPx(radiusOf(o)))) return o;
        }
        return null;
    }
    function onDown(e) {
        if (!B) return;
        e.preventDefault();
        dropStaleSelection();
        const p = toWorld(e), o = hit(p);
        if (o) {
            B.sel = o; B.shelfType = null;
            // the undo snapshot waits for the first real movement, so merely selecting a figure keeps the redo history
            B.drag = { dx: o.x - p.x, dz: o.z - p.z, px: p.px, py: p.py, snapped: false };
            say(tr('bd_placed', 'Utlagd. Dra i den för att flytta.'));
        } else if (B.shelfType) {
            const n = place(p.x, p.z);
            B.drag = { dx: n.x - p.x, dz: n.z - p.z, snapped: true };
            say(tr('bd_placed', 'Utlagd. Dra i den för att flytta.'));
        } else {
            B.sel = null;
            say(tr('bd_help', ''));
        }
        try { B.canvas.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        refresh();
    }
    function onMove(e) {
        if (!B || !B.drag || !B.sel) return;
        e.preventDefault();
        const p = toWorld(e), o = B.sel;
        if (!B.drag.snapped) {
            if (B.drag.px !== undefined && Math.hypot(p.px - B.drag.px, p.py - B.drag.py) < 4) return;
            undoPoint();
            B.drag.snapped = true;
        }
        o.x = clamp(p.x + B.drag.dx, -VIEW, VIEW); o.z = clamp(p.z + B.drag.dz, -VIEW, VIEW);
        o.y = groundAt(o.x, o.z);
        if (!B.raf) B.raf = requestAnimationFrame(function () {
            if (!B) return;
            B.raf = 0;
            if (B.sel) rebuild(B.sel.type);
            draw();
        });
    }
    function onUp() {
        if (!B || !B.drag) return;
        const moved = B.drag.snapped;
        B.drag = null;
        if (moved && B.sel) { rebuild(B.sel.type); persist(); }
        warnIfCovering(B.sel);
        refresh();
    }

    // Terrain, holes and surround colours may have changed (undo/redo): take the pictures again
    function resnap() {
        if (!B) return;
        const HG = root.HoleGenerator;
        let others = null;
        try { others = HG && HG.otherHoles ? HG.otherHoles(root.courseHoles, -1) : null; } catch (err) { others = null; }
        B.others = others;
        // undo/redo restore the saved surround on the holes; bring the live setting, the dropdowns and the scene in line
        if (typeof root.restoreSurrounding === 'function') root.restoreSurrounding();
        B.surround = surroundPicture();
        if (root.HoleBlueprint && root.HoleBlueprint.renderTerrain) B.plate = root.HoleBlueprint.renderTerrain(plateHalf());
        dropStaleSelection();
        refresh();
    }

    // ---- open / close --------------------------------------------------------------------------------------
    function btn(label, onclick, extra) {
        const b = document.createElement('button');
        b.type = 'button'; b.innerHTML = label; b.onclick = onclick;
        b.style.cssText = 'min-height:40px; min-width:40px; padding:0 8px; border:none; border-radius:10px; font-weight:bold; font-size:14px; white-space:nowrap; cursor:pointer; background:#1e293b; color:#e2e8f0;' + (extra || '');
        return b;
    }
    function close() {
        if (!B) return;
        const el = B.dom.overlay;
        window.removeEventListener('keydown', B.keyHandler, true);
        cancelAnimationFrame(B.raf); clearInterval(B.timer);
        B = null;
        el.remove();
        refreshFog();
    }
    function open() {
        if (!root.PlacedObjects || !root.ASSET_REGISTRY) return;
        if (B) close();
        if (root.HoleBlueprint && root.HoleBlueprint.close) root.HoleBlueprint.close(false);
        const C = Math.max(240, Math.floor(Math.min(window.innerWidth - 16, window.innerHeight - 330, 760)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);

        const overlay = document.createElement('div');
        overlay.id = 'bd-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:#020617; display:flex; flex-direction:column; align-items:center; gap:8px; padding:8px; box-sizing:border-box; overflow-y:auto; touch-action:pan-y; user-select:none; -webkit-user-select:none;';
        const head = document.createElement('div');
        head.style.cssText = 'margin-top:auto; width:' + C + 'px; display:flex; align-items:center; justify-content:space-between; gap:8px; color:#f1f5f9;';
        head.innerHTML = '<b style="font-size:16px;">🏔️ ' + tr('bd_title', 'Bakgrund') + '</b>';
        const status = document.createElement('div');
        status.style.cssText = 'flex:1; text-align:center; font-size:12px; color:#cbd5e1; line-height:1.3;';
        status.textContent = tr('bd_help', 'Välj en figur nedan och tryck på kartan utanför banan för att lägga den där. Dra i en figur för att flytta den.');
        head.appendChild(status);
        const x = btn('✕', close, 'min-width:44px; min-height:44px;');
        head.appendChild(x);

        const canvas = document.createElement('canvas');
        canvas.width = C * dpr; canvas.height = C * dpr;
        // arcade.css pins every <canvas> to the viewport with !important, so this one must override it
        canvas.style.cssText = 'position:relative !important; top:auto !important; left:auto !important; width:' + C + 'px !important; height:' + C + 'px !important; flex:none; border-radius:12px; border:2px solid #334155; touch-action:none; cursor:crosshair; background:#0f172a !important;';

        const filters = document.createElement('div');
        filters.style.cssText = 'width:' + C + 'px; display:flex; gap:6px; align-items:center;';
        const bigBtn = btn(tr('bd_big', 'Stora'), function () { B.showAll = false; refresh(); }, 'min-height:32px; font-size:12px;');
        const allBtn = btn(tr('bd_all', 'Alla'), function () { B.showAll = true; refresh(); }, 'min-height:32px; font-size:12px;');
        filters.appendChild(bigBtn); filters.appendChild(allBtn);
        const ring_ = btn(tr('bd_ring', '🔁 Runt om hela'), function () { ring(); }, 'flex:1; min-height:32px; font-size:12px; background:#7c2d12; color:#fff;');
        filters.appendChild(ring_);

        const shelf = document.createElement('div');
        shelf.style.cssText = 'width:' + C + 'px; display:flex; gap:6px; overflow-x:auto; padding:2px 0 4px; flex:none; touch-action:pan-x;';

        const row = document.createElement('div');
        row.style.cssText = 'width:' + C + 'px; display:flex; gap:4px; align-items:center; justify-content:center;';
        const smaller = btn('➖', function () { change(function (o) { o.scale = Math.max(0.1, (o.scale || 1) / 1.18); }); });
        const bigger = btn('➕', function () { change(function (o) { o.scale = Math.min(8, (o.scale || 1) * 1.18); }); });
        const turnL = btn('⟲', function () { change(function (o) { o.rot = (o.rot || 0) - Math.PI / 12; }); });
        const turnR = btn('⟳', function () { change(function (o) { o.rot = (o.rot || 0) + Math.PI / 12; }); });
        const lower = btn('⬇', function () { change(function (o) { o.yOffset = (o.yOffset || 0) - Math.max(1, Math.round(heightOf(o) * 0.03)); }); });
        const higher = btn('⬆', function () { change(function (o) { o.yOffset = (o.yOffset || 0) + Math.max(1, Math.round(heightOf(o) * 0.03)); }); });
        const del = btn('🗑️', function () { dropStaleSelection(); if (B.sel) { remove(B.sel); refresh(); } });
        smaller.title = tr('bd_smaller', 'Mindre'); bigger.title = tr('bd_bigger', 'Större');
        turnL.title = tr('bd_turn', 'Vrid'); turnR.title = tr('bd_turn', 'Vrid');
        lower.title = tr('bd_lower', 'Sänk ner i marken'); higher.title = tr('bd_higher', 'Höj');
        del.title = tr('bd_delete', 'Ta bort figuren');
        [smaller, bigger, turnL, turnR, lower, higher, del].forEach(function (b) { row.appendChild(b); });
        const done = btn('✓ ' + tr('bd_done', 'Klar'), close, 'margin-bottom:auto; flex:none; width:' + C + 'px; background:linear-gradient(90deg,#16a34a,#22c55e); color:#fff; font-size:16px; min-height:48px;');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative; width:' + C + 'px; height:' + C + 'px; flex:none;';
        wrap.appendChild(canvas);
        const edgeChips = {};
        const pos = { N: 'top:8px; left:50%; transform:translateX(-50%);', S: 'bottom:8px; left:50%; transform:translateX(-50%);', W: 'left:8px; top:50%; transform:translateY(-50%);', E: 'right:8px; top:50%; transform:translateY(-50%);' };
        SIDES.forEach(function (side) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.style.cssText = 'position:absolute; ' + pos[side] + ' min-width:52px; min-height:34px; padding:0 8px; border-radius:17px; font-size:13px; font-weight:bold; color:#f8fafc; text-shadow:0 1px 2px rgba(0,0,0,0.9); border:2px solid rgba(15,23,42,0.85); cursor:pointer;';
            chip.onclick = function () { B.edge = B.edge === side ? null : side; B.sel = null; B.shelfType = null; refreshEdges(); refresh(); };
            wrap.appendChild(chip);
            edgeChips[side] = chip;
        });
        const choices = document.createElement('div');
        choices.style.cssText = 'width:' + C + 'px; display:none; flex-wrap:wrap; gap:6px; flex:none;';
        [head, wrap, choices, filters, shelf, row, done].forEach(function (el) { overlay.appendChild(el); });
        document.body.appendChild(overlay);

        const HG = root.HoleGenerator;
        let others = null;
        // every hole counts here, the one being edited too (siteEnv leaves the current hole out)
        try { others = HG && HG.otherHoles ? HG.otherHoles(root.courseHoles, -1) : null; } catch (err) { others = null; }
        if (Array.isArray(others)) others = { points: others, polygons: [] };
        B = {
            dom: { edge: edgeChips, choices: choices, overlay: overlay, status: status, shelf: shelf, big: bigBtn, all: allBtn, ring: ring_, bigger: bigger, smaller: smaller, higher: higher, lower: lower, turnL: turnL, turnR: turnR, del: del },
            canvas: canvas, ctx: canvas.getContext('2d'), C: C, dpr: dpr, sel: null, shelfType: null, edge: null, showAll: false, drag: null, raf: 0, others: others
        };
        B.surround = surroundPicture();
        B.plate = (root.HoleBlueprint && root.HoleBlueprint.renderTerrain) ? root.HoleBlueprint.renderTerrain(plateHalf()) : document.createElement('canvas');
        // Ctrl+Z / Ctrl+Y reach the editor's own undo while the map is open; keep the picture in step with it
        B.timer = setInterval(function () { if (!B) return; recheckLoaded(); const had = B.sel; dropStaleSelection(); if (had && !B.sel) refresh(); else draw(); }, 500);
        B.keyHandler = function (e) {
            if (e.ctrlKey || e.metaKey) {
                // undo / redo run here so the map can take a fresh picture of the course afterwards
                if (e.code === 'KeyZ' || e.code === 'KeyY') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    const redo = e.code === 'KeyY' || e.shiftKey, fn = redo ? root.performRedo : root.performUndo;
                    if (typeof fn === 'function') fn();
                    setTimeout(resnap, 500);
                }
                return;
            }
            if (e.altKey) return;
            if (e.key === 'Escape') close();
            e.stopImmediatePropagation();
        };
        window.addEventListener('keydown', B.keyHandler, true);
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
        refreshEdges();
        refresh();
    }

    root.openBackdropMap = open;
    root.Backdrop = { warnIfCovering: warnIfCovering, footprint: footprintOf, outline: outlineOf, coversPlate: coversPlate, open: open, close: close, state: function () { return B; }, ring: ring, refresh: refresh, refreshFog: refreshFog };
})(typeof window !== 'undefined' ? window : globalThis);
