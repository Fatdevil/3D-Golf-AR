// Re-anchor green, tee boxes and fairways after a terrain sculpt stroke.
//
// A green/tee is stored as "pristine terrain (origHeights) + flattening on top". A sculpt stroke edits the
// finished surface, so before this file a hill raised under a green made the green bumpy, and simply
// re-running the pipeline would have restored the old origHeights and thrown the sculpt away.
//
// After a stroke we (1) add the height change of the stroke to the pristine baseline and move the
// baseElevation by the average change under the footprint, then (2) re-run the pipeline. The green/tee is
// therefore flat again, at the height of the new ground, and the sculpt survives around it.
// origHeights is replaced by a NEW array (never edited in place) because undo states keep a reference
// to the old one.
(function () {
    'use strict';

    var EPS = 0.005;        // ignore height changes below 5 mm
    var TEE_REACH = 17;     // matches TEE_MAX_REACH in smart-builder.js
    var BUNKER_REACH = 6;   // restoreBunkerBase resets 4.5 m around the bunker; a little more for the smoothing pass

    function ptInPoly(x, z, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
            if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
        }
        return inside;
    }

    function distToPoly(x, z, poly) {
        var best = Infinity;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var ax = poly[j].x, az = poly[j].z, bx = poly[i].x, bz = poly[i].z;
            var dx = bx - ax, dz = bz - az;
            var l2 = dx * dx + dz * dz;
            var t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
            var ex = x - (ax + t * dx), ez = z - (az + t * dz);
            var d = Math.sqrt(ex * ex + ez * ez);
            if (d < best) best = d;
        }
        return best;
    }

    // Studios this module manages: one green and any number of tee boxes per hole
    function studiosOf(hole) {
        var out = [];
        var gd = hole && hole.greenData;
        if (gd && gd.bbox && gd.origHeights && gd.points && gd.points.length >= 3) {
            var gDense = (gd.densePts && gd.densePts.length >= 3) ? gd.densePts
                : (typeof getDenseGreenPoints === 'function' ? getDenseGreenPoints(gd.points, gd.tension !== undefined ? gd.tension : 0.5) : null);
            var blend = gd.blendDistance !== undefined ? gd.blendDistance : 8;
            if (gDense) out.push({ kind: 'green', sd: gd, dense: gDense, reach: Math.max(blend, gd._maxBlendDistance || 0) + 3 });
        }
        // Fairways: the stroke is always baked into the baseline (so a later wave / slope-cap setting does not restore stale ground);
        // the pipeline only re-runs for fairways that actually edit heights
        var fws = (hole && hole.fairways && hole.fairways.length) ? hole.fairways : (hole && hole.fairwayData ? [hole.fairwayData] : []);
        fws.forEach(function (fd) {
            if (!fd || !fd.bbox || !fd.origHeights || !fd.points || fd.points.length < 3 || typeof getDenseFairwayPoints !== 'function') return;
            var fDense = getDenseFairwayPoints(fd.points);
            if (!fDense) return;
            var sr = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2;
            var rw = (fd.roughEnabled !== false) ? (fd.roughWidth !== undefined ? fd.roughWidth : 5) : 0;
            out.push({ kind: 'fairway', sd: fd, dense: fDense, reach: sr + rw + 12 });
        });
        var tees = (hole && hole.teeBoxes && hole.teeBoxes.length) ? hole.teeBoxes : (hole && hole.teeData ? [hole.teeData] : []);
        tees.forEach(function (tb) {
            if (!tb || !tb.bbox || !tb.origHeights || !tb.points || tb.points.length < 3) return;
            var tDense = typeof teeDensePts === 'function' ? teeDensePts(tb)
                : (typeof getDenseGreenPoints === 'function' ? getDenseGreenPoints(tb.points, 0.5) : null);
            if (!tDense) return;
            var br = tb.blendRadius !== undefined ? tb.blendRadius : 4;
            out.push({ kind: 'tee', sd: tb, dense: tDense, reach: Math.max(TEE_REACH, br + 2) });
        });
        // Bunkers: stored as "pristine terrain + dig-out". Without this, a hill raised under or around a bunker was undone
        // the next time the bunker (or the green next to it) re-ran, because the old baseline was written back over the hill.
        var bks = (hole && hole.bunkers && hole.bunkers.length) ? hole.bunkers : (hole && hole.bunkerData ? [hole.bunkerData] : []);
        bks.forEach(function (bd) {
            if (!bd || !bd.bbox || !bd.origHeights || !bd.points || bd.points.length < 3 || typeof getDenseBunkerPoints !== 'function') return;
            var bDense = getDenseBunkerPoints(bd.points);
            if (bDense && bDense.length >= 3) out.push({ kind: 'bunker', sd: bd, dense: bDense, reach: BUNKER_REACH });
        });
        return out;
    }

    // pre: Float32Array of the terrain (position attribute array) from BEFORE the stroke.
    // Returns the number of green/tee boxes that were re-flattened.
    // opts.bakeFairwaysOnly: only add the stroke to the fairway and bunker baselines (no re-run, green and tee untouched) - used for the water tool
    //   (bake-only is always consistent: terrain = baseline + dig-out + stroke, and the baseline gets the stroke too)
    window.reanchorStudiosAfterSculpt = function (pre, opts) {
        opts = opts || {};
        var geo = window._arcadePlaneGeo;
        var holes = window.courseHoles;
        if (!geo || !holes || !pre) return 0;
        var pos = geo.attributes.position.array;
        if (pre.length !== pos.length) return 0;
        var stride = window.TERRAIN_SEGS + 1;

        // Phase 1: read all deltas BEFORE any pipeline touches the terrain
        var jobs = [];
        holes.forEach(function (hole) {
            studiosOf(hole).forEach(function (st) {
                if (opts.bakeFairwaysOnly && st.kind !== 'fairway' && st.kind !== 'bunker') return;
                var bb = st.sd.bbox, dense = st.dense;
                var delta = null, relevant = false;
                // cheap scan first: most strokes touch no green/tee at all
                for (var gz = bb.gzStart; gz <= bb.gzEnd; gz++) {
                    for (var gx = bb.gxStart; gx <= bb.gxEnd; gx++) {
                        var idx = gz * stride + gx;
                        var d = pos[idx * 3 + 2] - pre[idx * 3 + 2];
                        if (Math.abs(d) > EPS) {
                            if (!delta) delta = new Map();
                            delta.set((gz - bb.gzStart) * bb.gWidth + (gx - bb.gxStart), d);
                        }
                    }
                }
                if (!delta) return;
                var sumIn = 0, nIn = 0;
                for (var gz2 = bb.gzStart; gz2 <= bb.gzEnd; gz2++) {
                    for (var gx2 = bb.gxStart; gx2 <= bb.gxEnd; gx2++) {
                        var idx2 = gz2 * stride + gx2;
                        var vx = pos[idx2 * 3], vz = -pos[idx2 * 3 + 1];
                        var oi = (gz2 - bb.gzStart) * bb.gWidth + (gx2 - bb.gxStart);
                        var dd = delta.get(oi);
                        if (st.kind === 'fairway' && dd === undefined) continue; // fairways need no average, only the changed vertices
                        var inside = ptInPoly(vx, vz, dense);
                        if (inside) { sumIn += (dd || 0); nIn++; }
                        else if (dd !== undefined && !relevant && distToPoly(vx, vz, dense) <= st.reach) relevant = true;
                        if (inside && dd !== undefined) relevant = true;
                    }
                }
                // A stroke inside the saved snapshot but out of reach is still baked into the baseline (no re-flatten),
                // so a later bigger blend radius does not restore stale ground over it
                jobs.push({ hole: hole, st: st, delta: delta, rerun: relevant, meanIn: relevant && nIn > 0 ? sumIn / nIn : 0 });
            });
        });
        if (!jobs.length) return 0;

        // Phase 2: bake the stroke into the baseline (copy-on-write), then flatten again
        jobs.forEach(function (j) {
            var sd = j.st.sd;
            var fresh = new Float32Array(sd.origHeights);
            j.delta.forEach(function (d, oi) { if (oi >= 0 && oi < fresh.length) fresh[oi] += d; });
            sd.origHeights = fresh;
            if (j.st.kind === 'green' || j.st.kind === 'tee') sd.baseElevation = (sd.baseElevation || 0) + j.meanIn;
        });
        var done = 0;
        // fairway is the base layer: re-run it before the green and tees that sit on top of it
        var rank = { fairway: 0, tee: 1, green: 2, bunker: 3 };
        jobs.sort(function (a, b) { return rank[a.st.kind] - rank[b.st.kind]; });
        var reruns = opts.bakeFairwaysOnly ? [] : jobs.filter(function (j) {
            if (!j.rerun || j.st.kind === 'bunker') return false;
            if (j.st.kind === 'fairway') return !!(window.fairwayEditsHeights && window.fairwayEditsHeights(j.st.sd) && typeof window.applyFairwayPipeline === 'function');
            return typeof (j.st.kind === 'green' ? window.applyGreenPipeline : window.applyTeePipeline) === 'function';
        });

        // Bunkers sit on top of the other layers. Those the stroke hit, and those next to a green/tee/fairway that is about to re-run
        // (its restore pass resets the ground around it, bunker dips included), are lifted off first, and dug again on the finished
        // ground once the others are done. Terrain is shared, so every hole's bunkers are looked at, not just the re-run hole's.
        var lifted = [];
        if (!opts.bakeFairwaysOnly && typeof window.applyBunkerPipeline === 'function' && typeof window.restoreBunkerBase === 'function' && typeof window.captureBunkerSnapshot === 'function') {
            var hit = new Set();
            jobs.forEach(function (j) { if (j.st.kind === 'bunker' && j.rerun) hit.add(j.st.sd); });
            holes.forEach(function (hole) {
                var bks = (hole.bunkers && hole.bunkers.length) ? hole.bunkers : (hole.bunkerData ? [hole.bunkerData] : []);
                bks.forEach(function (bd) {
                    if (!bd || !bd.bbox || !bd.origHeights || !bd.points || bd.points.length < 3 || typeof getDenseBunkerPoints !== 'function') return;
                    var near = hit.has(bd);
                    if (!near && reruns.length) {
                        var bDense = getDenseBunkerPoints(bd.points);
                        near = !!bDense && reruns.some(function (j) {
                            return bDense.some(function (q) { return ptInPoly(q.x, q.z, j.st.dense) || distToPoly(q.x, q.z, j.st.dense) <= j.st.reach + BUNKER_REACH; });
                        });
                    }
                    if (near) lifted.push({ hole: hole, bd: bd, ref: null });
                });
            });
            lifted.forEach(function (l) { try { window.restoreBunkerBase(l.hole, false, l.bd); l.ref = l.bd.origHeights; } catch (err) { console.error('[reanchor] bunker lift failed:', err); } });
        }

        reruns.forEach(function (j) {
            try {
                if (j.st.kind === 'fairway') window.applyFairwayPipeline(j.hole, false, false, j.st.sd);
                else if (j.st.kind === 'green') window.applyGreenPipeline(j.hole, false, false);
                else window.applyTeePipeline(j.hole, false, false, j.st.sd, true);
                done++;
            } catch (err) {
                console.error('[reanchor] pipeline failed:', err);
            }
            // A fairway edit brackets its own hole's bunkers (attachUpperLayers: new baseline from the clean fairway surface, dug again).
            // Those are lifted once more so they stay off the ground for the studios that follow; their baseline is already the clean surface.
            lifted.forEach(function (l) {
                if (l.bd.origHeights === l.ref) return;
                try { window.restoreBunkerBase(l.hole, false, l.bd); l.ref = l.bd.origHeights; } catch (err) { console.error('[reanchor] bunker lift failed:', err); }
            });
        });

        // The re-run may have raised / lowered the ground under a bunker: its baseline is taken from the finished ground (heights only,
        // the saved texture pixels and bbox stay as they are; a new array so undo states keep the old one)
        lifted.forEach(function (l) {
            try {
                var snap = window.captureBunkerSnapshot(l.hole, l.bd.points, l.bd.bbox.margin || 15);
                if (snap && snap.origHeights && snap.origHeights.length === l.bd.origHeights.length) l.bd.origHeights = snap.origHeights;
                window.applyBunkerPipeline(l.hole, false, false, l.bd);
            } catch (err) { console.error('[reanchor] bunker pipeline failed:', err); }
        });
        return done;
    };

    // Terrain tools that do not go through the sculpt stroke (mountain spline / ridge, terrain stamp): whatever they change inside a
    // fairway must be baked into its baseline, otherwise a later slope-cap / wave edit restores the ground from before the tool.
    // Green and tee are left to their own handling (bake only, no re-run).
    ['applyTerrainStamp', 'executeRidgeMountain', 'executeSplineMountain'].forEach(function (name) {
        var orig = window[name];
        if (typeof orig !== 'function' || orig._fairwayBaking) return;
        var wrapped = function () {
            var geo = window._arcadePlaneGeo;
            var pre = geo ? new Float32Array(geo.attributes.position.array) : null;
            var result = orig.apply(this, arguments);
            if (pre) {
                try { window.reanchorStudiosAfterSculpt(pre, { bakeFairwaysOnly: true }); } catch (err) { console.error('[reanchor]', name, err); }
                // the builders save before returning, i.e. before the baselines above were updated: save again
                if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
            }
            return result;
        };
        wrapped._fairwayBaking = true;
        window[name] = wrapped;
    });
})();
