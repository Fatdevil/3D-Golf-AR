/* ============================================================
 * hole-generator.js — "Slumpa ett hål"
 *
 * Lays out a whole hole (tee, fairway, green, bunkers) from a seed and strict rules.
 * Shape planning is pure geometry (no DOM, no THREE) so it can be tested in bulk;
 * applying a plan uses the same builders as hand-built objects, so everything stays editable.
 *
 * Local plan coordinates: f = forward from the back tee, l = lateral (left of the line).
 * ============================================================ */
(function (root) {
    'use strict';

    // ---- seeded random ------------------------------------------------------
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function range(rng, lo, hi) { return lo + (hi - lo) * rng(); }
    function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
    function smoothstep(a, b, x) { let t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    // ---- rules --------------------------------------------------------------
    const RULES = {
        3: { len: [105, 175], fairway: false, greenSide: [2, 3], fwBunkers: [0, 0], doglegChance: 0 },
        4: { len: [300, 400], fairway: true, greenSide: [1, 3], fwBunkers: [0, 2], doglegChance: 0.5 },
        5: { len: [450, 540], fairway: true, greenSide: [1, 3], fwBunkers: [0, 2], doglegChance: 0.6 },
        6: { len: [545, 600], fairway: true, greenSide: [1, 3], fwBunkers: [1, 2], doglegChance: 0.85 }
    };
    // Terrain limits per part: slope = rise/run (0.06 = 6 %), range = highest - lowest point inside the part (m)
    // soft: share of the part allowed to be steeper than `soft` (the rest must stay under `max`)
    const SLOPE = {
        green:   { max: 0.06, range: 1.5 },
        tee:     { max: 0.08, range: 2 },
        bunker:  { max: 0.25, range: 6 },
        fairway: { max: 0.18, soft: 0.10, softShare: 0.15 }
    };
    const FAIRWAY_START = 80;     // the tee layout spans ~56 m forward of the back tee
    const MAP_HALF = 300;
    const MAP_MARGIN = 25;

    function clampPar(par) { return par <= 3 ? 3 : (par >= 6 ? 6 : par); }

    // ---- polygon helpers ----------------------------------------------------
    function segsCross(a, b, c, d) {
        function o(p, q, r) { return (q.f - p.f) * (r.l - p.l) - (q.l - p.l) * (r.f - p.f); }
        let o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
        return (o1 * o2 < 0) && (o3 * o4 < 0);
    }
    function polygonSimple(pts) {
        let n = pts.length;
        if (n < 3) return false;
        for (let i = 0; i < n; i++) {
            let a = pts[i], b = pts[(i + 1) % n];
            for (let j = i + 1; j < n; j++) {
                if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
                let c = pts[j], d = pts[(j + 1) % n];
                if (segsCross(a, b, c, d)) return false;
            }
        }
        return true;
    }
    function dist(a, b) { return Math.hypot(a.f - b.f, a.l - b.l); }

    // Closed, slightly irregular blob around (cf, cl); ax/al stretch along/across angle rot
    function blob(rng, cf, cl, r, n, stretch, rot, jitter) {
        let pts = [];
        let a0 = range(rng, 0, Math.PI * 2);
        for (let i = 0; i < n; i++) {
            let a = a0 + (Math.PI * 2 * i) / n + range(rng, -0.12, 0.12);
            let rr = r * range(rng, 1 - jitter, 1 + jitter);
            let x = Math.cos(a) * rr * stretch, y = Math.sin(a) * rr;
            pts.push({ f: cf + x * Math.cos(rot) - y * Math.sin(rot), l: cl + x * Math.sin(rot) + y * Math.cos(rot) });
        }
        return pts;
    }

    // ---- centre line --------------------------------------------------------
    function makePath(L, dogleg, side, bendDeg, kneeFrac) {
        if (!dogleg) {
            return { total: L, segs: [{ a: { f: 0, l: 0 }, b: { f: L, l: 0 }, len: L, s0: 0, dir: { f: 1, l: 0 } }], knee: null };
        }
        let L1 = L * kneeFrac, L2 = L - L1, phi = bendDeg * Math.PI / 180;
        let K = { f: L1, l: 0 };
        let d2 = { f: Math.cos(phi), l: side * Math.sin(phi) };
        let E = { f: K.f + d2.f * L2, l: K.l + d2.l * L2 };
        return {
            total: L, knee: K,
            segs: [
                { a: { f: 0, l: 0 }, b: K, len: L1, s0: 0, dir: { f: 1, l: 0 } },
                { a: K, b: E, len: L2, s0: L1, dir: d2 }
            ]
        };
    }
    function pathAt(path, s) {
        s = Math.max(0, Math.min(path.total, s));
        let seg = path.segs[0];
        for (let i = 0; i < path.segs.length; i++) { if (s >= path.segs[i].s0) seg = path.segs[i]; }
        let t = s - seg.s0;
        return { f: seg.a.f + seg.dir.f * t, l: seg.a.l + seg.dir.l * t, dir: seg.dir };
    }

    // ---- plan ---------------------------------------------------------------
    function buildPlan(par, rng) {
        par = clampPar(par);
        let R = RULES[par];
        let L = range(rng, R.len[0], R.len[1]);
        let dogleg = rng() < R.doglegChance;
        let side = rng() < 0.5 ? -1 : 1;
        let bend = range(rng, 15, 38);
        let kneeFrac = range(rng, 0.55, 0.7);
        let path = makePath(L, dogleg, side, bend, kneeFrac);
        let end = pathAt(path, L);
        let approach = end.dir;
        let approachAngle = Math.atan2(approach.l, approach.f);

        // Green
        let rg = range(rng, 11, 15);
        let stretch = range(rng, 1.0, 1.25);
        let green = blob(rng, end.f, end.l, rg, 9, stretch, approachAngle + range(rng, -0.5, 0.5), 0.1);
        let greenReach = rg * stretch * 1.12;

        // Fairway (par 4-5)
        let fairway = null, fwHalf = null, fwS0 = 0, fwS1 = 0;
        if (R.fairway) {
            fwS0 = FAIRWAY_START;
            fwS1 = L - rg - 4;
            let w0 = range(rng, par >= 5 ? 38 : 34, par >= 5 ? 50 : 46);
            let samples = [];
            let n = Math.max(6, Math.round((fwS1 - fwS0) / 25));
            for (let i = 0; i <= n; i++) samples.push(fwS0 + (fwS1 - fwS0) * i / n);
            if (path.knee) {   // make sure the bend gets a sample
                let ks = path.segs[0].len;
                if (ks > fwS0 + 15 && ks < fwS1 - 15) {
                    samples.push(ks);
                    samples.sort(function (a, b) { return a - b; });
                }
            }
            let left = [], right = [];
            fwHalf = function () { return 0; };
            let halfAt = [];
            samples.forEach(function (s, i) {
                let u = (s - fwS0) / (fwS1 - fwS0);
                let w = w0 * (1 - 0.3 * smoothstep(0.7, 1, u)) + 8 * Math.exp(-Math.pow((u - 0.5) / 0.16, 2));
                if (i === 0 || i === samples.length - 1) w *= 0.6;
                halfAt.push({ s: s, h: w / 2 });
            });
            samples.forEach(function (s, i) {
                let c = pathAt(path, s);
                // miter-averaged normal at a bend
                let dirPrev = pathAt(path, s - 0.5).dir, dirNext = pathAt(path, s + 0.5).dir;
                let dAvg = { f: dirPrev.f + dirNext.f, l: dirPrev.l + dirNext.l };
                let m = Math.hypot(dAvg.f, dAvg.l) || 1;
                dAvg.f /= m; dAvg.l /= m;
                let nrm = { f: -dAvg.l, l: dAvg.f };
                let cosHalf = Math.max(0.6, dAvg.f * dirNext.f + dAvg.l * dirNext.l);
                let h = halfAt[i].h;
                let hl = (h + range(rng, -2.5, 2.5)) / cosHalf, hr = (h + range(rng, -2.5, 2.5)) / cosHalf;
                left.push({ f: c.f + nrm.f * hl, l: c.l + nrm.l * hl });
                right.push({ f: c.f - nrm.f * hr, l: c.l - nrm.l * hr });
            });
            let c0 = pathAt(path, fwS0 - 12), c1 = pathAt(path, Math.min(L, fwS1 + 14));
            fairway = [{ f: c0.f, l: c0.l }].concat(left, [{ f: c1.f, l: c1.l }], right.slice().reverse());
            fwHalf = function (s) {
                let best = halfAt[0];
                halfAt.forEach(function (e) { if (Math.abs(e.s - s) < Math.abs(best.s - s)) best = e; });
                return best.h;
            };
        }

        // Bunkers
        let bunkers = [];
        let nGreen = Math.round(range(rng, R.greenSide[0] - 0.49, R.greenSide[1] + 0.49));
        let angles = [-2.4, -1.5, -0.8, 0.8, 1.5, 2.4, Math.PI];   // around the approach axis (0 = in front of the green)
        let usedAngles = [];
        for (let k = 0; k < nGreen; k++) {
            for (let tries = 0; tries < 12; tries++) {
                let ang = pick(rng, angles) + range(rng, -0.25, 0.25);
                if (usedAngles.some(function (u) { return Math.abs(u - ang) < 0.7; })) continue;
                let rb = range(rng, 4, 7);
                let world = approachAngle + Math.PI + ang;   // measured from the direction pointing back toward the tee
                let d = greenReach + rb + range(rng, 2.5, 5);
                let cf = end.f + Math.cos(world) * d, cl = end.l + Math.sin(world) * d;
                let poly = blob(rng, cf, cl, rb, 7, range(rng, 1.0, 1.5), world + Math.PI / 2, 0.15);
                if (!polygonSimple(poly)) continue;
                if (bunkers.some(function (b) { return dist(b.center, { f: cf, l: cl }) < b.r + rb + 3; })) continue;
                usedAngles.push(ang);
                bunkers.push({ pts: poly, center: { f: cf, l: cl }, r: rb * 1.5, kind: 'green' });
                break;
            }
        }
        if (R.fairway) {
            let nFw = Math.round(range(rng, R.fwBunkers[0] - 0.49, R.fwBunkers[1] + 0.49));
            for (let k = 0; k < nFw; k++) {
                for (let tries = 0; tries < 12; tries++) {
                    let s = range(rng, fwS0 + 40, Math.min(fwS1 - 70, fwS0 + 40 + (par >= 5 ? 190 : 150)));
                    if (s <= fwS0 + 40) continue;
                    let c = pathAt(path, s);
                    let nrm = { f: -c.dir.l, l: c.dir.f };
                    let sd = rng() < 0.5 ? -1 : 1;
                    let rb = range(rng, 4.5, 7.5);
                    let off = fwHalf(s) + rb * 0.4;
                    let cf = c.f + nrm.f * off * sd, cl = c.l + nrm.l * off * sd;
                    let poly = blob(rng, cf, cl, rb, 7, range(rng, 1.1, 1.7), Math.atan2(c.dir.l, c.dir.f), 0.15);
                    if (!polygonSimple(poly)) continue;
                    if (bunkers.some(function (b) { return dist(b.center, { f: cf, l: cl }) < b.r + rb * 1.5 + 4; })) continue;
                    bunkers.push({ pts: poly, center: { f: cf, l: cl }, r: rb * 1.5, kind: 'fairway' });
                    break;
                }
            }
        }

        return {
            par: par, length: L, dogleg: dogleg, side: side, bend: bend, path: path,
            tee: { f: 0, l: 0 }, green: green, greenCenter: { f: end.f, l: end.l }, greenReach: greenReach,
            fairway: fairway, bunkers: bunkers,
            aim: path.knee ? { f: path.knee.f, l: path.knee.l } : null
        };
    }

    // The rules every plan must satisfy (also used by the bulk test)
    function validatePlan(plan) {
        let problems = [];
        let R = RULES[plan.par];
        if (plan.length < R.len[0] - 0.01 || plan.length > R.len[1] + 0.01) problems.push('length');
        if (!polygonSimple(plan.green)) problems.push('green-crossing');
        if (plan.fairway && !polygonSimple(plan.fairway)) problems.push('fairway-crossing');
        if (!!plan.fairway !== R.fairway) problems.push('fairway-rule');
        plan.bunkers.forEach(function (b) {
            if (!polygonSimple(b.pts)) problems.push('bunker-crossing');
            let minD = Infinity;
            b.pts.forEach(function (p) {
                plan.green.forEach(function (g) { minD = Math.min(minD, dist(p, g)); });
            });
            if (dist(b.center, plan.greenCenter) < plan.greenReach * 0.9) problems.push('bunker-on-green');
            if (minD < 1.5) problems.push('bunker-touches-green');
            if (dist(b.center, plan.tee) < 70) problems.push('bunker-at-tee');
        });
        let counts = { green: 0, fairway: 0 };
        plan.bunkers.forEach(function (b) { counts[b.kind]++; });
        if (counts.green < 1 && plan.par !== 3) problems.push('no-greenside-bunker');
        return problems;
    }

    // ---- placing a plan on the map -----------------------------------------
    function toWorld(pt, origin, heading) {
        let c = Math.cos(heading), s = Math.sin(heading);
        return { x: origin.x + pt.f * c - pt.l * s, z: origin.z + pt.f * s + pt.l * c };
    }
    // Footprints of the standard 3-box tee layout (matches buildStandardTeeLayout: 9 x 5 m boxes, 28 m apart, toward the aim)
    function teeBoxes(plan, W) {
        let target = plan.aim || plan.greenCenter;
        let dx = target.f - plan.tee.f, dz = target.l - plan.tee.l, len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        let px = -dz, pz = dx, boxes = [];
        for (let slot = 0; slot < 3; slot++) {
            let cf = plan.tee.f + dx * 28 * slot, cl = plan.tee.l + dz * 28 * slot;
            boxes.push([[-4.5, -2.5], [4.5, -2.5], [4.5, 2.5], [-4.5, 2.5]].map(function (o) {
                return W({ f: cf + px * o[0] + dx * o[1], l: cl + pz * o[0] + dz * o[1] });
            }));
        }
        return boxes;
    }
    function worldPlan(plan, origin, heading) {
        let W = function (p) { return toWorld(p, origin, heading); };
        return {
            par: plan.par, length: plan.length, dogleg: plan.dogleg,
            tee: W(plan.tee), green: plan.green.map(W), greenCenter: W(plan.greenCenter),
            fairway: plan.fairway ? plan.fairway.map(W) : null,
            bunkers: plan.bunkers.map(function (b) { return b.pts.map(W); }),
            bunkerKinds: plan.bunkers.map(function (b) { return b.kind; }),
            greenReach: plan.greenReach,
            aim: plan.aim ? W(plan.aim) : null,
            teeBoxes: teeBoxes(plan, W),
            centerline: (function () {
                let pts = [];
                for (let s = 0; s <= plan.length; s += 20) pts.push(W(pathAt(plan.path, s)));
                pts.push(W(pathAt(plan.path, plan.length)));
                return pts;
            })()
        };
    }
    function footprint(wp) {
        let all = wp.green.concat(wp.centerline);
        if (wp.fairway) all = all.concat(wp.fairway);
        wp.bunkers.forEach(function (b) { all = all.concat(b); });
        (wp.teeBoxes || []).forEach(function (t) { all = all.concat(t); });
        return all;
    }

    // ---- dense sampling (world x/z) so thin hazards and sparse polygons cannot slip between vertices
    function densify(pts, step, closed) {
        let out = [];
        let n = pts.length;
        for (let i = 0; i < (closed ? n : n - 1); i++) {
            let a = pts[i], b = pts[(i + 1) % n];
            let len = Math.hypot(b.x - a.x, b.z - a.z);
            let k = Math.max(1, Math.ceil(len / step));
            for (let j = 0; j < k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k });
        }
        if (!closed && n) out.push({ x: pts[n - 1].x, z: pts[n - 1].z });
        return out;
    }
    function inPoly(x, z, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            let xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
            if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
        }
        return inside;
    }
    function interior(poly, step) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        poly.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
        let out = [];
        for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (inPoly(x, z, poly)) out.push({ x: x, z: z });
        return out;
    }
    function polys(wp) {
        let list = [wp.green];
        if (wp.fairway) list.push(wp.fairway);
        wp.bunkers.forEach(function (b) { list.push(b); });
        (wp.teeBoxes || []).forEach(function (t) { list.push(t); });
        return list;
    }
    // Everything the hole covers: centre line, outlines and interiors
    function coverage(wp, edgeStep, fillStep) {
        let out = densify(wp.centerline, edgeStep, false);
        polys(wp).forEach(function (poly) {
            out = out.concat(densify(poly, edgeStep, true));
            if (fillStep) out = out.concat(interior(poly, fillStep));
        });
        return out;
    }

    // Lazy version of coverage(): stops at the first point where pred() is true, nothing is materialised
    function anyCovered(wp, edgeStep, fillStep, pred) {
        let edge = function (a, b) {
            let k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / edgeStep));
            for (let j = 0; j <= k; j++) if (pred(a.x + (b.x - a.x) * j / k, a.z + (b.z - a.z) * j / k)) return true;
            return false;
        };
        let line = wp.centerline;
        for (let i = 0; i < line.length - 1; i++) if (edge(line[i], line[i + 1])) return true;
        let list = polys(wp);
        for (let q = 0; q < list.length; q++) {
            let poly = list[q];
            for (let i = 0; i < poly.length; i++) if (edge(poly[i], poly[(i + 1) % poly.length])) return true;
            if (fillStep) {
                let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
                poly.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
                for (let x = x0 + fillStep / 2; x < x1; x += fillStep)
                    for (let z = z0 + fillStep / 2; z < z1; z += fillStep)
                        if (inPoly(x, z, poly) && pred(x, z)) return true;
            }
        }
        return false;
    }

    // ---- terrain slope ------------------------------------------------------
    function slopeAt(h, x, z) {
        let d = 3;
        let gx = (h(x + d, z) - h(x - d, z)) / (2 * d), gz = (h(x, z + d) - h(x, z - d)) / (2 * d);
        return Math.hypot(gx, gz);
    }
    // Measure one polygon: returns null when it is within `lim`, else a short reason
    function checkArea(poly, step, h, lim) {
        let pts = interior(poly, step).concat(densify(poly, step, true));
        let hi = -Infinity, lo = Infinity, steep = 0;
        for (let i = 0; i < pts.length; i++) {
            let y = h(pts[i].x, pts[i].z), sl = slopeAt(h, pts[i].x, pts[i].z);
            if (y > hi) hi = y;
            if (y < lo) lo = y;
            if (sl > lim.max) return 'slope';
            if (lim.soft && sl > lim.soft) steep++;
        }
        if (lim.range && hi - lo > lim.range) return 'range';
        if (lim.soft && pts.length && steep / pts.length > lim.softShare) return 'slope';
        return null;
    }
    // Is the terrain under this placed hole flat enough? env.heightAt(x, z) gives ground height.
    // Returns { ok, reasons: ['green_slope', ...] } - reasons also tell a future blueprint view why a spot is red.
    function scoreSite(wp, env) {
        let h = env && env.heightAt;
        if (!h) return { ok: true, reasons: [] };
        // only the parts that will be built count (env.parts; default: all)
        let parts = (env && env.parts) || normalizeParts(null);
        let withFairway = !!(wp.fairway && parts.fairway);
        // cheap first look: the centre line every ~20 m (most hilly spots fail here without any polygon sampling)
        if (withFairway) {
            for (let i = 0; i < wp.centerline.length; i++) {
                let c = wp.centerline[i];
                // only where the fairway actually lies (the line also runs under the tee and green)
                if (inPoly(c.x, c.z, wp.fairway) && slopeAt(h, c.x, c.z) > SLOPE.fairway.max) return { ok: false, reasons: ['fairway_slope'] };
            }
        }
        let reasons = [];
        let test = function (name, poly, step, lim) { if (!reasons.length) { let r = checkArea(poly, step, h, lim); if (r) reasons.push(name + '_' + r); } };
        if (parts.green) test('green', wp.green, 3, SLOPE.green);
        if (parts.tee) (wp.teeBoxes || []).forEach(function (b) { test('tee', b, 3, SLOPE.tee); });
        wp.bunkers.forEach(function (b, i) {
            let kind = wp.bunkerKinds && wp.bunkerKinds[i];
            if ((kind === 'green' && !parts.greenBunkers) || (kind === 'fairway' && !parts.fairwayBunkers)) return;
            test('bunker', b, 4, SLOPE.bunker);
        });
        if (withFairway) test('fairway', wp.fairway, 5, SLOPE.fairway);
        return { ok: reasons.length === 0, reasons: reasons };
    }

    // Why did placement fail? Out-of-bounds tries are cheap and common for long holes anywhere on the map,
    // so "too hilly" is only the answer when steep rejections are the biggest real cause and a visible share of all tries
    function failedBecauseSteep(diag) {
        let d = diag || {}, steep = d.steep || 0;
        return steep > 0 && steep > (d.water || 0) && steep > (d.close || 0) && steep >= 0.05 * (d.bounds || 0);
    }

    // Other holes: loose points (flags, markers) and polygons (kept apart so interiors can be tested)
    function otherHoles(holes, currentIndex) {
        let points = [], polygons = [];
        (holes || []).forEach(function (h, i) {
            if (!h || i === currentIndex) return;
            let addPoly = function (o) { if (o && o.points && o.points.length >= 3) polygons.push(o.points); };
            addPoly(h.greenData);
            (h.fairways || []).forEach(addPoly);
            (h.bunkers || []).forEach(addPoly);
            (h.teeBoxes || []).forEach(addPoly);
            if (h.flag) points.push(h.flag);
            if (h.tees) for (let k in h.tees) { if (h.tees[k]) points.push(h.tees[k]); }   // loose / legacy tee markers
            if (h.aimPoint) points.push(h.aimPoint);
        });
        return { points: points, polygons: polygons };
    }

    const CLEARANCE = 55;
    function tooCloseToOthers(wp, others) {
        if (!others) return false;
        let pts = others.points || [], polygons = others.polygons || [];
        if (!pts.length && !polygons.length) return false;
        let mine = coverage(wp, 10, 0);
        let c2 = CLEARANCE * CLEARANCE;
        // bounding box of this hole, grown by the clearance, to skip distant polygons quickly
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        mine.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
        x0 -= CLEARANCE; x1 += CLEARANCE; z0 -= CLEARANCE; z1 += CLEARANCE;
        let near = function (q) { return q.x >= x0 && q.x <= x1 && q.z >= z0 && q.z <= z1; };
        let hitPoint = function (q) { return mine.some(function (p) { let dx = p.x - q.x, dz = p.z - q.z; return dx * dx + dz * dz < c2; }); };
        if (pts.filter(near).some(hitPoint)) return true;
        for (let k = 0; k < polygons.length; k++) {
            let poly = polygons[k];
            if (!poly.some(near)) {
                // no vertex nearby, but a long edge may still cross: test the polygon's own edges too
                let xs = poly.map(function (q) { return q.x; }), zs = poly.map(function (q) { return q.z; });
                if (Math.max.apply(null, xs) < x0 || Math.min.apply(null, xs) > x1 || Math.max.apply(null, zs) < z0 || Math.min.apply(null, zs) > z1) continue;
            }
            if (densify(poly, 10, true).some(hitPoint)) return true;
            if (mine.some(function (p) { return inPoly(p.x, p.z, poly); })) return true;
        }
        return false;
    }

    // Find a seed-determined spot on the map where the whole hole fits.
    // env: { isWater(x,z), others: {points, polygons} (or a flat [{x,z}] list), half }
    function place(plan, rng, env) {
        let half = (env && env.half) || MAP_HALF;
        let limit = half - MAP_MARGIN;
        let others = env && env.others;
        if (Array.isArray(others)) others = { points: others, polygons: [] };
        let diag = env && env.diag;
        let bump = function (k) { if (diag) diag[k] = (diag[k] || 0) + 1; };
        for (let attempt = 0; attempt < 400; attempt++) {
            let origin = { x: range(rng, -limit, limit), z: range(rng, -limit, limit) };
            let heading = range(rng, 0, Math.PI * 2);
            let wp = worldPlan(plan, origin, heading);
            let ok = footprint(wp).every(function (p) { return Math.abs(p.x) <= limit && Math.abs(p.z) <= limit; });
            if (!ok) { bump('bounds'); continue; }
            if (tooCloseToOthers(wp, others)) { bump('close'); continue; }
            if (env && env.isWater) {
                // coarse pass first (cheap, rejects most wet spots), then a pass at the water grid's resolution
                // so a creek as narrow as one cell cannot slip between samples
                let ws = env.waterStep || 2;
                if (anyCovered(wp, 6, 12, env.isWater)) { bump('water'); continue; }
                if (anyCovered(wp, ws, ws, env.isWater)) { bump('water'); continue; }
            }
            if (env && env.heightAt && !scoreSite(wp, env).ok) { bump('steep'); continue; }
            return { world: wp, origin: origin, heading: heading, attempts: attempt + 1 };
        }
        return null;
    }

    // Plan + place, retrying with new shapes if a shape never fits
    function generatePlan(opts, env) {
        let seed = (opts.seed != null) ? opts.seed : Math.floor(Math.random() * 1e9);
        let rng = mulberry32(seed);
        for (let k = 0; k < 8; k++) {
            let plan = buildPlan(opts.par, rng);
            if (validatePlan(plan).length) continue;
            let placed = place(plan, rng, env);
            if (placed) return { seed: seed, plan: plan, placed: placed };
        }
        return null;
    }

    // ---- apply to the open hole (browser only) ------------------------------
    function holeIsEmpty(hole) {
        let has = function (arr) { return (arr || []).some(function (o) { return o && o.points && o.points.length >= 3; }); };
        return !(hole.tees && (hole.tees.red || hole.tees.yellow || hole.tees.white || hole.tees.black)) &&
            !hole.flag && !hole.aimPoint && !hole.greenData && !has(hole.fairways) && !has(hole.bunkers) && !has(hole.teeBoxes);
    }

    function surfaceY(x, z) {
        let s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null;
        return s && typeof s.z === 'number' ? s.z : 0;
    }
    function toVec(pts) { return pts.map(function (p) { return new THREE.Vector3(p.x, surfaceY(p.x, p.z), p.z); }); }

    function t(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function toast(msg, color) { if (typeof root.showBuildToast === 'function') root.showBuildToast(msg, color || '#38bdf8'); }

    function buildShape(type, pts, exec) {
        if (typeof root.setSmartBuilderType === 'function') root.setSmartBuilderType(type);
        if (typeof root.clearSmartGreen === 'function') root.clearSmartGreen();
        root.smartGreenPoints = toVec(pts);
        root._smartShapeClosed = false;
        exec();
        if (typeof root.clearSmartGreen === 'function') root.clearSmartGreen();
    }

    function focusCamera(wp) {
        try {
            let cam = (typeof camera !== 'undefined') ? camera : null;
            let ctl = (typeof controls !== 'undefined') ? controls : null;
            if (!cam || !ctl) return;
            let mx = (wp.tee.x + wp.greenCenter.x) / 2, mz = (wp.tee.z + wp.greenCenter.z) / 2;
            let dx = wp.greenCenter.x - wp.tee.x, dz = wp.greenCenter.z - wp.tee.z;
            let len = Math.hypot(dx, dz) || 1;
            ctl.target.set(mx, 0, mz);
            cam.position.set(mx - dx / len * len * 0.55, Math.max(120, len * 0.9), mz - dz / len * len * 0.55);
            ctl.update();
        } catch (e) { /* camera is a nicety */ }
    }

    // Which parts to build. Anything missing counts as wanted; dependent parts follow their parent.
    const PART_KEYS = ['tee', 'fairway', 'green', 'greenBunkers', 'fairwayBunkers'];
    function normalizeParts(parts) {
        let p = {};
        PART_KEYS.forEach(function (k) { p[k] = !parts || parts[k] !== false; });
        if (!p.green) p.greenBunkers = false;
        if (!p.fairway) p.fairwayBunkers = false;
        return p;
    }

    // ---- "planned green" ring: shows where the green was planned when the user left it out ----
    function ringMesh() {
        if (root._plannedGreenMarker) return root._plannedGreenMarker;
        if (typeof THREE === 'undefined' || !root._arcadeScene) return null;
        let g = new THREE.Group();
        let ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 56), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
        let fill = new THREE.Mesh(new THREE.CircleGeometry(0.88, 56), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthTest: false }));
        [ring, fill].forEach(function (m) { m.rotation.x = -Math.PI / 2; m.renderOrder = 998; m.raycast = function () { }; g.add(m); });
        g.raycast = function () { };
        g.visible = false;
        root._arcadeScene.add(g);
        root._plannedGreenMarker = g;
        return g;
    }
    function builtSomething(hole) {
        let has = function (arr) { return (arr || []).some(function (o) { return o && o.points && o.points.length >= 3; }); };
        return has(hole.fairways) || has(hole.bunkers) || has(hole.teeBoxes);
    }
    function refreshPlannedGreenMarker() {
        let hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        // an emptied hole (e.g. after Undo) forgets where its green was planned
        if (hole && hole.plannedGreen && !hole.greenData && !hole.flag && !builtSomething(hole)) hole.plannedGreen = null;
        let show = !!(hole && hole.plannedGreen && !hole.greenData && !hole.flag && builtSomething(hole));
        if (!show) { if (root._plannedGreenMarker) root._plannedGreenMarker.visible = false; return false; }
        let m = ringMesh();
        if (!m) return false;
        let pg = hole.plannedGreen;
        m.position.set(pg.x, surfaceY(pg.x, pg.z) + 0.6, pg.z);
        m.scale.set(pg.r, pg.r, pg.r);
        m.visible = true;
        return true;
    }
    root.hasPlannedGreen = function () {
        let hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        return !!(hole && hole.plannedGreen && !hole.greenData && !hole.flag && builtSomething(hole));
    };
    if (typeof setInterval === 'function' && typeof window !== 'undefined') setInterval(refreshPlannedGreenMarker, 700);

    function generate(opts) {
        opts = opts || {};
        let parts = normalizeParts(opts.parts);
        let hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        if (!hole) return null;
        if (!holeIsEmpty(hole)) {
            toast(t('hg_not_empty', '⚠️ Hålet har redan delar. Gå till ett tomt hål för att slumpa.'), '#f59e0b');
            return null;
        }
        if (!PART_KEYS.some(function (k) { return parts[k]; })) {
            toast(t('hg_pick_one', '⚠️ Välj minst en del att slumpa.'), '#f59e0b');
            return null;
        }
        hole.plannedGreen = null;   // the hole is empty here; any older plan is stale
        let par = clampPar(opts.par != null ? opts.par : (hole.par || 4));
        let half = (root.TERRAIN_SIZE || 600) / 2;
        let env = {
            half: half,
            others: otherHoles(root.courseHoles, root.currentHoleIndex),
            waterStep: Math.min(3, (root.TERRAIN_SIZE || 600) / (root.TERRAIN_SEGS || 300)),
            // the terrain lookup already knows painted water and per-cell water levels
            isWater: function (x, z) { let s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null; return !!s && s.type === 'WATER'; },
            heightAt: root.localGetTerrainAt ? surfaceY : null,
            parts: parts,
            diag: {}
        };
        let res = generatePlan({ par: par, seed: opts.seed }, env);
        if (!res) {
            if (failedBecauseSteep(env.diag)) {
                toast(t('hg_fail_steep', '⚠️ Marken är för kuperad för ett helt hål. Prova en plattare plats eller slumpa färre delar.'), '#ef4444');
                return null;
            }
            toast(t('hg_fail', '⚠️ Hittade ingen ledig plats för ett helt hål. Försök igen.'), '#ef4444');
            return null;
        }
        let wp = res.placed.world;

        // One undo step for the whole hole: the builders' own undo captures are muted while we build
        // The undo texture patch is sized from the editor's current points, so point it at the whole footprint first
        root.smartGreenPoints = footprint(wp).map(function (p) { return { x: p.x, y: 0, z: p.z }; });
        root.saveUndoState();
        root.smartGreenPoints = [];
        let realSave = root.saveUndoState;
        root.saveUndoState = function () { };
        try {
            if (wp.fairway && parts.fairway) buildShape('FAIRWAY', wp.fairway, function () { root.executeSmartFairway(); });
            if (parts.green) buildShape('GREEN', wp.green, function () { root.executeSplineSmartGreen(); });
            wp.bunkers.forEach(function (b, i) {
                let kind = wp.bunkerKinds[i];
                if ((kind === 'green' && !parts.greenBunkers) || (kind === 'fairway' && !parts.fairwayBunkers)) return;
                buildShape('BUNKER', b, function () { root.executeSmartBunker(); });
            });
            if (parts.tee) {
                // aim: the knee on doglegs; without a green or a fairway to derive it from, the planned green
                let aim = wp.aim || ((!parts.green && !(parts.fairway && wp.fairway)) ? wp.greenCenter : null);
                if (aim) {
                    let ay = surfaceY(aim.x, aim.z);
                    hole.aimPoint = { x: aim.x, y: ay, z: aim.z };
                    if (hole.aimMesh && root._arcadeScene) root._arcadeScene.remove(hole.aimMesh);
                    if (typeof root.createAimPointMarker === 'function') {
                        hole.aimMesh = root.createAimPointMarker(aim.x, ay, aim.z, root.currentHoleIndex + 1);
                    }
                }
                if (typeof root.setSmartBuilderType === 'function') root.setSmartBuilderType('TEE');
                root.buildStandardTeeLayout(wp.tee.x, wp.tee.z);
            }
            // green left out: remember where it was planned so the user can build it there
            hole.plannedGreen = parts.green ? null : { x: wp.greenCenter.x, z: wp.greenCenter.z, r: Math.max(12, wp.greenReach || 15) };
        } catch (e) {
            // keep the single undo step so the user can remove whatever was built before the failure
            root.saveUndoState = realSave;
            if (typeof console !== 'undefined') console.error('Slumpa hål failed', e);
            toast(t('hg_error', '⚠️ Något gick fel när hålet byggdes. Tryck Ångra och försök igen.'), '#ef4444');
            if (typeof root.updateHoleMenu === 'function') root.updateHoleMenu(true);
            return null;
        } finally {
            root.saveUndoState = realSave;
        }
        if (typeof root.saveLevel === 'function') root.saveLevel();
        if (typeof root.updateHoleMenu === 'function') root.updateHoleMenu(true);
        refreshPlannedGreenMarker();
        focusCamera(wp);
        toast(t('hg_done', '🎲 Hål slumpat! Ändra fritt – Ångra tar bort hela hålet.') + ' (#' + res.seed + ')', '#4ade80');
        return { seed: res.seed, plan: res.plan, world: wp };
    }

    root.HoleGenerator = {
        RULES: RULES, mulberry32: mulberry32, buildPlan: buildPlan, validatePlan: validatePlan,
        generatePlan: generatePlan, place: place, scoreSite: scoreSite, failedBecauseSteep: failedBecauseSteep, slopeAt: slopeAt, SLOPE: SLOPE, otherHoles: otherHoles, tooCloseToOthers: tooCloseToOthers, coverage: coverage, anyCovered: anyCovered, inPoly: inPoly, worldPlan: worldPlan, generate: generate, holeIsEmpty: holeIsEmpty, normalizeParts: normalizeParts, PART_KEYS: PART_KEYS
    };
    root.generateRandomHole = function (opts) { return generate(opts); };
    // Button entry: show a progress toast first (building is synchronous and can take a few seconds)
    root.generateRandomHoleWithProgress = function () {
        toast(t('hg_busy', '⏳ Bygger hålet…'), '#a855f7');
        let parts = root._hgParts || null;
        setTimeout(function () { generate({ parts: parts }); }, 80);
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.HoleGenerator;
})(typeof window !== 'undefined' ? window : globalThis);
