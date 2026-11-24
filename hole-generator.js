/* ============================================================
 * hole-generator.js — "Slumpa ett hål"
 *
 * Lays out a whole hole (tee, fairway, green, bunkers) from a seed and strict rules.
 * Shape planning is pure geometry (no DOM, no THREE) so it can be tested in bulk;
 * applying a plan uses the same builders as hand-built objects, so everything stays editable.
 *
 * Local plan coordinates: f = forward from the back tee, l = lateral (+l is to the RIGHT of the line as the player faces the green: x forward, y up, z right).
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
        4: { len: [300, 400], fairway: true, greenSide: [1, 3], fwBunkers: [1, 2], doglegChance: 0.5, doubleChance: 0 },
        5: { len: [450, 540], fairway: true, greenSide: [1, 3], fwBunkers: [1, 2], doglegChance: 0.6, doubleChance: 0.35 },
        6: { len: [545, 600], fairway: true, greenSide: [1, 3], fwBunkers: [1, 2], doglegChance: 0.85, doubleChance: 0.6 }
    };
    // Where a good drive comes down (m from the back tee): doglegs bend here and the first fairway bunker guards it
    const DRIVE = [210, 255];
    // A typical drive and lay-up for the approach length (m), and the green radius it gets: GREEN_R.min for an approach of
    // GREEN_R.near m or less, GREEN_R.max from GREEN_R.far m (before the green's stretch and jitter)
    const DRIVE_CARRY = 230;
    // Fairway width range (m) by par (5 = par 5 and 6), and the extra width where the drives land
    const FAIRWAY_W = { 4: [30, 40], 5: [34, 44] };
    const FAIRWAY_BULGE = 6;
    const GREEN_R = { min: 10.5, max: 15, near: 60, far: 190 };
    // Par 3 approach: a short strip of fairway in front of the green (m before the green's front edge, half width as a share of rg)
    const APRON = { len: [18, 30], halfNear: 0.55, halfAtGreen: 0.95 };
    // Where a par 5 / 6 lay-up comes down, counted back from the green (m)
    const LAYUP = [95, 135];
    // Water the line of play crosses (tees, fairway, green and bunkers stay dry): longest carry from the front tee (m)
    const MAX_CARRY = 110;
    // Terrain limits per part: slope = rise/run (0.06 = 6 %), range = highest - lowest point inside the part (m)
    // soft: share of the part allowed to be steeper than `soft` (the rest must stay under `max`)
    const SLOPE = {
        green:   { max: 0.06, range: 1.5 },
        tee:     { max: 0.08, range: 2 },
        bunker:  { max: 0.25, range: 6 },
        fairway: { max: 0.18, soft: 0.10, softShare: 0.15 }
    };
    // What the builders can reshape (blueprint "yellow" sites): green / tee are cut or filled to a plateau at the mean height of
    // the footprint, `cut` = the largest height change in metres; the fairway only gets a slope cap (`cap`, in %) so the hill stays but plays
    const SHAPE = {
        green:   { cut: 3 },
        tee:     { cut: 2.5, lift: 0.5 },   // lift: the tee builder raises the plateau (default 0.5 m)
        fairway: { max: 0.30, soft: 0.18, softShare: 0.25, cap: 10 },
        blendPerMeter: 4, minBlend: 8, maxBlend: 15, teeMinBlend: 4, teeMaxBlend: 15
    };
    const FAIRWAY_START = 80;     // the tee layout spans ~56-80 m forward of the back tee
    // Tee layout: 3 boxes (back / middle / front). Neighbouring boxes must stay TEE_PITCH apart (centre to centre) or editing one
    // box cuts into the next one's plateau (smart-builder buildStandardTeeLayout). On a short par 3 the boxes step sideways so the
    // front tee still plays a real par 3.
    const TEE_PITCH = 28;
    const PAR3_FRONT = { min: 85, share: 0.7 };   // front tee to green at least this far (m) and this share of the length
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
    // bends: [{ s, side, deg }] sorted by s (distance from the back tee along the line); side +1 turns left (+l), -1 right
    function makePath(L, bends) {
        let segs = [], knees = [], a = { f: 0, l: 0 }, dir = { f: 1, l: 0 }, ang = 0, s0 = 0;
        (bends || []).forEach(function (b) {
            let len = b.s - s0;
            let B = { f: a.f + dir.f * len, l: a.l + dir.l * len };
            segs.push({ a: a, b: B, len: len, s0: s0, dir: dir });
            knees.push(B);
            ang += b.side * b.deg * Math.PI / 180;
            dir = { f: Math.cos(ang), l: Math.sin(ang) };
            a = B; s0 = b.s;
        });
        let len = L - s0;
        segs.push({ a: a, b: { f: a.f + dir.f * len, l: a.l + dir.l * len }, len: len, s0: s0, dir: dir });
        return { total: L, segs: segs, knee: knees[0] || null, knees: knees, bends: bends || [] };
    }
    function pathAt(path, s) {
        s = Math.max(0, Math.min(path.total, s));
        let seg = path.segs[0];
        for (let i = 0; i < path.segs.length; i++) { if (s >= path.segs[i].s0) seg = path.segs[i]; }
        let t = s - seg.s0;
        return { f: seg.a.f + seg.dir.f * t, l: seg.a.l + seg.dir.l * t, dir: seg.dir };
    }

    // ---- plan ---------------------------------------------------------------
    // shape (optional, from the blueprint's buttons): { dogleg: 'left' | 'straight' | 'right', len: 'short' | 'mid' | 'long' }.
    // Anything missing stays random. The random numbers are drawn the same way either way, so a seed keeps the rest of its shape.
    // 'left' / 'right' as the player sees it from the tee: +l is to the right of the line of play (x forward, y up, z right).
    function buildPlan(par, rng, shape) {
        par = clampPar(par);
        shape = shape || {};
        let R = RULES[par];
        let third = (R.len[1] - R.len[0]) / 3, lenAt = { short: 0, mid: 1, long: 2 }[shape.len];
        let lo = lenAt === undefined ? R.len[0] : R.len[0] + third * lenAt, hi = lenAt === undefined ? R.len[1] : lo + third;
        let L = range(rng, lo, hi);
        let dogleg = rng() < R.doglegChance;
        let side = rng() < 0.5 ? -1 : 1;
        if (par > 3 && (shape.dogleg === 'left' || shape.dogleg === 'right')) { dogleg = true; side = shape.dogleg === 'right' ? 1 : -1; }
        if (shape.dogleg === 'straight') dogleg = false;
        let bend = range(rng, 15, 38);
        // The bend sits where the tee shot comes down (a par 4 knee at 165 m was driven straight through); par 5 / 6 may bend at
        // the lay-up instead, or twice (S-shape or a long sweep)
        let bends = [];
        if (dogleg) {
            let driveS = Math.min(L - 90, range(rng, DRIVE[0], DRIVE[1]));
            let layupS = L - range(rng, LAYUP[0], LAYUP[1]);
            let double = rng() < (R.doubleChance || 0) && layupS - driveS >= 100;
            if (double) {
                let side2 = rng() < 0.55 ? -side : side;
                let deg1 = range(rng, 14, 28), deg2 = range(rng, 14, 28);
                if (side2 === side) deg2 = Math.min(deg2, 60 - deg1);   // a long sweep, not a hairpin
                bends = [{ s: driveS, side: side, deg: deg1 }, { s: layupS, side: side2, deg: deg2 }];
                bend = deg1;
            } else {
                let atLayup = par >= 5 && rng() < 0.4 && layupS - driveS >= 60;
                bends = [{ s: atLayup ? layupS : driveS, side: side, deg: bend }];
            }
        }
        let path = makePath(L, bends);
        let end = pathAt(path, L);
        let approach = end.dir;
        let approachAngle = Math.atan2(approach.l, approach.f);

        // Green: sized for the shot that comes in. A long par 3 or a long second shot needs a big target, a wedge into a par 5 a small one.
        // Approach = the tee shot on a par 3, what is left after a drive on a par 4, after two shots on a par 5 / 6.
        let approachLen = par === 3 ? L : Math.max(40, L - DRIVE_CARRY * (par === 4 ? 1 : 2));
        let rg = GREEN_R.min + (GREEN_R.max - GREEN_R.min) * smoothstep(GREEN_R.near, GREEN_R.far, approachLen) + range(rng, -1, 1);
        let stretch = range(rng, 1.0, 1.25);
        let green = blob(rng, end.f, end.l, rg, 9, stretch, approachAngle + range(rng, -0.5, 0.5), 0.1);
        let greenReach = rg * stretch * 1.12;

        // Fairway (par 4-5)
        let fairway = null, fwHalf = null, fwS0 = 0, fwS1 = 0;
        if (par === 3) {
            // the approach in front of a par 3 green: a short, slightly widening strip (built with the fairway tool), so the
            // green does not sit straight in the rough
            let s0 = L - greenReach - range(rng, APRON.len[0], APRON.len[1]), s1 = L - rg * 0.4;
            let left = [], right = [], n = 5;
            for (let i = 0; i <= n; i++) {
                let u = i / n, sAt = s0 + (s1 - s0) * u;
                let h = rg * (APRON.halfNear + (APRON.halfAtGreen - APRON.halfNear) * smoothstep(0, 1, u));
                left.push({ f: sAt, l: h + range(rng, -0.8, 0.8) });
                right.push({ f: sAt, l: -h + range(rng, -0.8, 0.8) });
            }
            fairway = [{ f: s0 - rg * 0.35, l: 0 }].concat(left, right.slice().reverse());
        }
        if (R.fairway) {
            fwS0 = FAIRWAY_START;
            fwS1 = L - rg - 4;
            // fairway width (m) before the landing-zone bulge: real fairways are about 25-40 m; a little wider here for the arcade
            let w0 = range(rng, par >= 5 ? FAIRWAY_W[5][0] : FAIRWAY_W[4][0], par >= 5 ? FAIRWAY_W[5][1] : FAIRWAY_W[4][1]);
            let samples = [];
            let n = Math.max(6, Math.round((fwS1 - fwS0) / 25));
            for (let i = 0; i <= n; i++) samples.push(fwS0 + (fwS1 - fwS0) * i / n);
            path.bends.forEach(function (b) {   // make sure every bend gets a sample
                let ks = b.s;
                if (ks > fwS0 + 15 && ks < fwS1 - 15) samples.push(ks);
            });
            samples.sort(function (a, b) { return a - b; });
            let left = [], right = [];
            fwHalf = function () { return 0; };
            let halfAt = [];
            samples.forEach(function (s, i) {
                let u = (s - fwS0) / (fwS1 - fwS0);
                let w = w0 * (1 - 0.3 * smoothstep(0.7, 1, u)) + FAIRWAY_BULGE * Math.exp(-Math.pow((u - 0.5) / 0.16, 2));
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
            let sMin = fwS0 + 40, sMax = fwS1 - 50;
            // Aimed spots first: the drive's landing zone (on a dogleg the inside of the corner, which punishes cutting it),
            // then the lay-up zone on a par 5 / 6 or the far side of the landing zone on a par 4. Anything left is random.
            let zones = [];
            let firstBend = path.bends[0];
            if (firstBend && firstBend.s <= DRIVE[1] + 20) zones.push({ s: firstBend.s - 6, spread: 8, sd: firstBend.side });
            else zones.push({ s: range(rng, DRIVE[0] + 5, DRIVE[1] - 5), spread: 10, sd: rng() < 0.5 ? -1 : 1 });
            if (par >= 5) {
                let lb = path.bends.filter(function (b) { return b.s > DRIVE[1] + 40; })[0];
                zones.push(lb ? { s: lb.s - 6, spread: 8, sd: lb.side } : { s: L - range(rng, LAYUP[0] + 10, LAYUP[1]), spread: 10, sd: -zones[0].sd });
            } else {
                zones.push({ s: zones[0].s + range(rng, 15, 30), spread: 8, sd: -zones[0].sd });
            }
            for (let k = 0; k < nFw; k++) {
                let zone = zones[k];
                for (let tries = 0; tries < 12; tries++) {
                    let aimed = !!zone && tries < 8;
                    let s = aimed ? zone.s + range(rng, -zone.spread, zone.spread) : range(rng, sMin, Math.min(sMax, fwS0 + 40 + (par >= 5 ? 190 : 150)));
                    s = Math.max(sMin, Math.min(sMax, s));
                    if (sMax <= sMin) break;
                    let c = pathAt(path, s);
                    let nrm = { f: -c.dir.l, l: c.dir.f };
                    let sd = aimed ? zone.sd : (rng() < 0.5 ? -1 : 1);
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
            par: par, length: L, dogleg: dogleg, side: side, bend: bend, path: path, bends: path.bends.length,
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
        if (!!plan.fairway !== R.fairway && plan.par !== 3) problems.push('fairway-rule');   // a par 3 has only its short approach
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
    // Where the back / middle / front boxes stand: { f: along the line toward the aim, l: to the left } from the back tee (m).
    // Long holes spread the boxes further (about 13 % of the length); a short par 3 steps them sideways instead, so the front tee
    // keeps at least PAR3_FRONT of the hole while every pair of boxes stays TEE_PITCH apart.
    function teeSlots(plan) {
        let L = plan.length, spread;
        if (plan.par === 3) spread = Math.max(0, Math.min(2 * TEE_PITCH, L - Math.max(PAR3_FRONT.min, PAR3_FRONT.share * L)));
        else spread = Math.max(2 * TEE_PITCH, Math.min(80, 0.13 * L));
        let a = spread / 2;
        let b = a >= TEE_PITCH ? 0 : Math.sqrt(TEE_PITCH * TEE_PITCH - a * a);
        let sd = plan.side || 1;
        return [{ f: 0, l: 0 }, { f: a, l: b * sd }, { f: 2 * a, l: -b * sd }];
    }
    // Footprints of the standard 3-box tee layout (matches buildStandardTeeLayout: 9 x 5 m boxes at teeSlots, toward the aim)
    function teeBoxes(plan, W) {
        let target = plan.aim || plan.greenCenter;
        let dx = target.f - plan.tee.f, dz = target.l - plan.tee.l, len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        let px = -dz, pz = dx, boxes = [], slots = teeSlots(plan);
        for (let slot = 0; slot < 3; slot++) {
            let cf = plan.tee.f + dx * slots[slot].f + px * slots[slot].l, cl = plan.tee.l + dz * slots[slot].f + pz * slots[slot].l;
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
            teeSlots: teeSlots(plan),
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
        let list = wp.green && wp.green.length ? [wp.green] : [];
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
    // (skipLine: only the built parts count, not the centre line between them)
    function anyCovered(wp, edgeStep, fillStep, pred, skipLine) {
        let edge = function (a, b) {
            let k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / edgeStep));
            for (let j = 0; j <= k; j++) if (pred(a.x + (b.x - a.x) * j / k, a.z + (b.z - a.z) * j / k)) return true;
            return false;
        };
        let line = skipLine ? [] : wp.centerline;
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
    // How far the ground must move to make this polygon a flat plateau, at the height the builders use:
    // the mean ground height at the polygon's control points (captureGreenSnapshot / captureTeeSnapshot), plus `lift`
    // (tee boxes are raised). Returns the largest |ground - plateau| over the footprint.
    function cutDepth(poly, step, h, lift) {
        let pts = interior(poly, step).concat(densify(poly, step, true));
        if (!pts.length || !poly.length) return 0;
        let plateau = 0;
        poly.forEach(function (p) { plateau += h(p.x, p.z); });
        plateau = plateau / poly.length + (lift || 0);
        let worst = 0;
        pts.forEach(function (p) { let d = Math.abs(h(p.x, p.z) - plateau); if (d > worst) worst = d; });
        return worst;
    }
    // Is the terrain under this placed hole flat enough? env.heightAt(x, z) gives ground height.
    // Returns { ok, reasons: ['green_slope', ...] } - reasons also tell a future blueprint view why a spot is red.
    function scoreSite(wp, env) {
        let h = env && env.heightAt;
        if (!h) return { ok: true, reasons: [] };
        // only the parts that will be built count (env.parts; default: all)
        let parts = (env && env.parts) || normalizeParts(null);
        let withFairway = !!(wp.fairway && parts.fairway);
        // blueprint sites may be "yellow": too steep for nature as it is, but within what the builders can reshape
        let shape = !!(env && env.allowShaping);
        // cheap first look: the centre line every ~20 m (most hilly spots fail here without any polygon sampling)
        if (withFairway) {
            let lim = shape ? SHAPE.fairway.max : SLOPE.fairway.max;
            for (let i = 0; i < wp.centerline.length; i++) {
                let c = wp.centerline[i];
                // only where the fairway actually lies (the line also runs under the tee and green)
                if (inPoly(c.x, c.z, wp.fairway) && slopeAt(h, c.x, c.z) > lim) return { ok: false, reasons: ['fairway_slope'] };
            }
        }
        let reasons = [], shaped = [], work = {};
        let test = function (name, poly, step, lim) {
            if (reasons.length) return;
            let r = checkArea(poly, step, h, lim);
            // green / tee: the builders cut or fill to a plateau at control-point height + their own offset sliders, so the work is
            // measured even on flat ground (a 4 m elevation offset is 4 m of work whatever the terrain looks like)
            let cut = null;
            if (shape && SHAPE[name] && SHAPE[name].cut) {
                let lift = (env.lift && typeof env.lift[name] === 'number') ? env.lift[name] : SHAPE[name].lift;
                cut = cutDepth(poly, step, h, lift);
                // the green builder adds its tilt and difficulty contours on top of the plateau
                if (name === 'green' && env.greenRelief) {
                    let cx = 0, cz = 0;
                    poly.forEach(function (p) { cx += p.x; cz += p.z; });
                    cx /= poly.length; cz /= poly.length;
                    let reach = 0;
                    poly.forEach(function (p) { reach = Math.max(reach, Math.hypot(p.x - cx, p.z - cz)); });
                    cut += (env.greenRelief.tilt || 0) * reach + (env.greenRelief.amp || 0);
                }
                if (cut > SHAPE[name].cut) { reasons.push(name + '_' + (r || 'range')); return; }
            }
            if (!r) return;
            if (shape && name === 'fairway' && !checkArea(poly, step, h, SHAPE.fairway)) {
                if (shaped.indexOf(name) < 0) shaped.push(name);
                work.fairway = SHAPE.fairway.cap;
                return;
            }
            if (cut !== null) {
                if (shaped.indexOf(name) < 0) shaped.push(name);
                work[name] = Math.max(work[name] || 0, cut);
                return;
            }
            reasons.push(name + '_' + r);
        };
        if (parts.green) test('green', wp.green, 3, SLOPE.green);
        if (parts.tee) (wp.teeBoxes || []).forEach(function (b) { test('tee', b, 3, SLOPE.tee); });
        wp.bunkers.forEach(function (b, i) {
            let kind = wp.bunkerKinds && wp.bunkerKinds[i];
            if ((kind === 'green' && !parts.greenBunkers) || (kind === 'fairway' && !parts.fairwayBunkers)) return;
            test('bunker', b, 4, SLOPE.bunker);
        });
        if (withFairway) test('fairway', wp.fairway, 5, SLOPE.fairway);
        return { ok: reasons.length === 0, reasons: reasons, shaped: shaped, work: work };
    }

    // Why did placement fail? Out-of-bounds tries are cheap and common for long holes anywhere on the map,
    // so "too hilly" is only the answer when steep rejections are the biggest real cause and a visible share of all tries
    function failedBecauseSteep(diag) {
        let d = diag || {}, steep = d.steep || 0;
        return steep > 0 && steep > (d.water || 0) && steep > (d.close || 0) && steep >= 0.05 * (d.bounds || 0);
    }

    // Other holes: loose points (flags, markers) and polygons (kept apart so interiors can be tested)
    // byHole[i] keeps, by reference, the parts neighbourOthers() may soften: the green with the bunkers beside it (and the flag),
    // and the tee boxes (and the tee markers)
    function otherHoles(holes, currentIndex) {
        let points = [], polygons = [], byHole = {};
        (holes || []).forEach(function (h, i) {
            if (!h || i === currentIndex) return;
            let mine = byHole[i] = { green: [], greenPts: [], tees: [], teePts: [], fairways: [], greenAt: null, teeAt: [] };
            let ok = function (o) { return o && o.points && o.points.length >= 3; };
            let addPoly = function (o) { if (ok(o)) polygons.push(o.points); };
            addPoly(h.greenData);
            (h.fairways || []).forEach(function (f) { addPoly(f); if (ok(f)) mine.fairways.push(f.points); });
            (h.teeBoxes || []).forEach(function (t) {
                if (!ok(t)) return;
                let x = 0, z = 0;
                t.points.forEach(function (p) { x += p.x; z += p.z; });
                mine.teeAt.push({ x: x / t.points.length, z: z / t.points.length });
            });
            (h.bunkers || []).forEach(addPoly);
            (h.teeBoxes || []).forEach(function (t) { addPoly(t); if (ok(t)) mine.tees.push(t.points); });
            if (ok(h.greenData)) {
                let g = h.greenData.points, gx = 0, gz = 0;
                g.forEach(function (p) { gx += p.x; gz += p.z; });
                gx /= g.length; gz /= g.length;
                let reach = 0;
                g.forEach(function (p) { reach = Math.max(reach, Math.hypot(p.x - gx, p.z - gz)); });
                mine.greenAt = { x: gx, z: gz, r: reach };
                mine.green.push(g);
                (h.bunkers || []).forEach(function (b) {
                    if (!ok(b)) return;
                    let x = 0, z = 0;
                    b.points.forEach(function (p) { x += p.x; z += p.z; });
                    if (Math.hypot(x / b.points.length - gx, z / b.points.length - gz) < reach + 35) mine.green.push(b.points);
                });
                if (h.flag) mine.greenPts.push(h.flag);
                // the tee builder's aim point sits on the flag on a straight hole: part of the green end too
                if (h.aimPoint && Math.hypot(h.aimPoint.x - gx, h.aimPoint.z - gz) <= reach + 40) mine.greenPts.push(h.aimPoint);
            }
            if (h.flag) points.push(h.flag);
            if (h.tees) for (let k in h.tees) { if (h.tees[k]) { points.push(h.tees[k]); if (mine.tees.length) mine.teePts.push(h.tees[k]); } }   // loose / legacy tee markers
            if (h.aimPoint) points.push(h.aimPoint);
        });
        return { points: points, polygons: polygons, byHole: byHole };
    }
    // The others as seen from hole `idx`: the previous hole's green may lie TEE_NEAR from this hole's tee boxes and the next
    // hole's tee boxes TEE_NEAR from this green (a short walk between holes, as on a real course); everything else keeps CLEARANCE
    function neighbourOthers(others, idx) {
        others = normOthers(others) || { points: [], polygons: [] };
        let by = others.byHole || {}, prev = by[idx - 1], next = by[idx + 1];
        let dropPolys = [], dropPts = [], addPolys = [], soft = (others.soft || []).slice();
        // a neighbour's fairway runs into its green / starts just past its tees: that end is trimmed, as obstaclesSplit does for a plan
        let trim = function (fairways, near) {
            fairways.forEach(function (f) {
                dropPolys.push(f);
                let rest = f.filter(function (c) { return !near(c); });
                if (rest.length >= 3) addPolys.push(rest);
            });
        };
        if (prev && prev.green.length) {
            soft.push({ polygons: prev.green, mine: 'tee' }); dropPolys = dropPolys.concat(prev.green); dropPts = dropPts.concat(prev.greenPts);
            let ga = prev.greenAt;
            if (ga) trim(prev.fairways, function (c) { return Math.hypot(c.x - ga.x, c.z - ga.z) <= ga.r + 50; });
        }
        if (next && next.tees.length) {
            soft.push({ polygons: next.tees, mine: 'green' }); dropPolys = dropPolys.concat(next.tees); dropPts = dropPts.concat(next.teePts);
            trim(next.fairways.filter(function (f) { return dropPolys.indexOf(f) < 0; }), function (c) { return next.teeAt.some(function (t) { return Math.hypot(c.x - t.x, c.z - t.z) <= 50; }); });
        }
        return {
            points: (others.points || []).filter(function (p) { return dropPts.indexOf(p) < 0; }),
            polygons: (others.polygons || []).filter(function (p) { return dropPolys.indexOf(p) < 0; }).concat(addPolys),
            soft: soft, byHole: by
        };
    }

    const CLEARANCE = 55;
    // Between one hole's green and the NEXT hole's tee boxes (a short walk, as on a real course) this is enough
    const TEE_NEAR = 30;
    const BUILD_SLACK = 5;
    // others.soft: [{ polygons, mine: 'tee' | 'green' }] - polygons that only that part of this hole may come TEE_NEAR to
    // (the previous hole's green for my tee boxes, the next hole's tee boxes for my green); the rest of the hole keeps CLEARANCE
    // others.slack (m): taken off both clearances. A hole built from a plan is re-checked against holes that were BUILT from plans,
    // and a built hole is a little bigger than its plan (spline outlines, the flag and aim point off the green's centre), so the
    // build allows a few metres the map did not
    function tooCloseToOthers(wp, others) {
        if (!others) return false;
        let slack = others.slack || 0;
        if (others.soft && others.soft.length) {
            if (tooCloseToOthers(wp, { points: others.points, polygons: others.polygons, slack: slack })) return true;
            for (let k = 0; k < others.soft.length; k++) {
                let g = others.soft[k];
                if (!g.polygons || !g.polygons.length) continue;
                let partOf = function (keepPart) {
                    let o = { green: wp.green, bunkers: [], bunkerKinds: [], teeBoxes: [], fairway: null, centerline: [] };
                    if (keepPart === 'tee') { o.green = []; o.teeBoxes = wp.teeBoxes || []; return o; }
                    if (keepPart === 'green') {
                        wp.bunkers.forEach(function (b, i) { if (wp.bunkerKinds && wp.bunkerKinds[i] === 'green') o.bunkers.push(b); });
                        return o;
                    }
                    // everything except that part (and the bit of centre line that runs under it)
                    o = Object.assign({}, wp);
                    let near = nearPart(wp, g.mine, 15);
                    o.centerline = wp.centerline.filter(function (c) { return !near(c); });
                    o.fairway = trimmedFairway(wp, g.mine);
                    if (g.mine === 'tee') o.teeBoxes = [];
                    else {
                        o.green = []; o.bunkers = []; o.bunkerKinds = [];
                        wp.bunkers.forEach(function (b, i) { if (!(wp.bunkerKinds && wp.bunkerKinds[i] === 'green')) { o.bunkers.push(b); o.bunkerKinds.push(wp.bunkerKinds[i]); } });
                    }
                    return o;
                };
                if (tooCloseWithin(partOf(null), [], g.polygons, CLEARANCE - slack)) return true;
                if (tooCloseWithin(partOf(g.mine), [], g.polygons, TEE_NEAR - slack)) return true;
            }
            return false;
        }
        return tooCloseWithin(wp, others.points || [], others.polygons || [], CLEARANCE - slack);
    }
    function tooCloseWithin(wp, pts, polygons, clearance) {
        if (!pts.length && !polygons.length) return false;
        let mine = coverage(wp, 10, 0);
        if (!mine.length) return false;
        const CLEARANCE = clearance;
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

    // ---- placed objects (trees, rocks, buildings): a hole must not be built through them -------------------
    function distToSegment(px, pz, a, b) {
        let dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        let t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)) : 0;
        return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    }
    function circleTouchesPolygon(c, r, poly) {
        if (inPoly(c.x, c.z, poly)) return true;
        for (let i = 0; i < poly.length; i++) if (distToSegment(c.x, c.z, poly[i], poly[(i + 1) % poly.length]) < r) return true;
        return false;
    }
    // Only the parts that will be built count (parts: see normalizeParts); a par-3 shape has no fairway, so its
    // straight route from tee to green is kept clear instead (a trunk on that line would block every shot)
    function partPolygons(wp, parts) {
        let p = parts || normalizeParts(null), list = [];
        if (p.green) list.push(wp.green);
        if (wp.fairway && p.fairway) list.push(wp.fairway);
        if (p.tee) (wp.teeBoxes || []).forEach(function (t) { list.push(t); });
        wp.bunkers.forEach(function (b, i) {
            let kind = wp.bunkerKinds && wp.bunkerKinds[i];
            if ((kind === 'green' && !p.greenBunkers) || (kind === 'fairway' && !p.fairwayBunkers)) return;
            list.push(b);
        });
        return list;
    }
    // The route only matters when both ends of a fairway-less hole are built
    function needsRoute(wp, parts) {
        let p = parts || normalizeParts(null);
        // a par 3's approach strip covers only the last metres: the shot from the tee still needs its route kept clear
        return (wp.par === 3 || !wp.fairway) && !!p.tee && !!p.green;
    }
    const OBJECT_MARGIN = 2;      // m of clear ground around a trunk, rock or wall
    const ROUTE_HALF_WIDTH = 3;   // m kept clear on each side of a par-3 route
    function objectsBlock(wp, objects, parts) {
        if (!objects || !objects.length) return false;
        let list = partPolygons(wp, parts);
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        footprint(wp).forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
        let corridor = needsRoute(wp, parts);
        for (let k = 0; k < objects.length; k++) {
            let o = objects[k], reach = o.r + OBJECT_MARGIN + (corridor ? ROUTE_HALF_WIDTH : 0);
            if (o.x < x0 - reach || o.x > x1 + reach || o.z < z0 - reach || o.z > z1 + reach) continue;
            for (let q = 0; q < list.length; q++) if (circleTouchesPolygon(o, o.r + OBJECT_MARGIN, list[q])) return true;
            if (corridor) {
                for (let i = 0; i < wp.centerline.length - 1; i++) if (distToSegment(o.x, o.z, wp.centerline[i], wp.centerline[i + 1]) < o.r + ROUTE_HALF_WIDTH) return true;
            }
        }
        return false;
    }

    // Fences, walls, hedges and OB stakes drawn as lines (stored per hole in envObjects[].collisionData)
    function segCross(a, b, c, d) {
        function o(p, q, r) { return (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x); }
        return (o(a, b, c) > 0) !== (o(a, b, d) > 0) && (o(c, d, a) > 0) !== (o(c, d, b) > 0);
    }
    function segSegDist(a, b, c, d) {
        if (segCross(a, b, c, d)) return 0;
        return Math.min(distToSegment(a.x, a.z, c, d), distToSegment(b.x, b.z, c, d), distToSegment(c.x, c.z, a, b), distToSegment(d.x, d.z, a, b));
    }
    const WALL_MARGIN = 1.5;      // m of clear ground beside a fence or wall
    const STAKE_GAP = 30;         // stakes further apart than this are separate markers, not a boundary line
    function collectWalls() {
        let out = [];
        (root.courseHoles || []).forEach(function (h) {
            ((h && h.envObjects) || []).forEach(function (o) {
                let pts = o && o.collisionData;
                if (!pts || pts.length < 2) return;
                for (let i = 0; i < pts.length - 1; i++) {
                    let p = pts[i], q = pts[i + 1];
                    if (typeof p.x !== 'number' || typeof q.x !== 'number') continue;
                    if (o.type === 'OB_STAKES' && Math.hypot(p.x - q.x, p.z - q.z) > STAKE_GAP) continue;
                    out.push({ a: { x: p.x, z: p.z }, b: { x: q.x, z: q.z } });
                }
            });
        });
        return out;
    }
    function wallsBlock(wp, walls, parts) {
        if (!walls || !walls.length) return false;
        let list = partPolygons(wp, parts), corridor = needsRoute(wp, parts);
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        footprint(wp).forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
        let reach = WALL_MARGIN + (corridor ? ROUTE_HALF_WIDTH : 0);
        for (let k = 0; k < walls.length; k++) {
            let w = walls[k];
            if (Math.max(w.a.x, w.b.x) < x0 - reach || Math.min(w.a.x, w.b.x) > x1 + reach || Math.max(w.a.z, w.b.z) < z0 - reach || Math.min(w.a.z, w.b.z) > z1 + reach) continue;
            for (let q = 0; q < list.length; q++) {
                let poly = list[q];
                if (inPoly(w.a.x, w.a.z, poly) || inPoly(w.b.x, w.b.z, poly)) return true;
                for (let i = 0; i < poly.length; i++) if (segSegDist(w.a, w.b, poly[i], poly[(i + 1) % poly.length]) < WALL_MARGIN) return true;
            }
            if (corridor) {
                for (let i = 0; i < wp.centerline.length - 1; i++) if (segSegDist(w.a, w.b, wp.centerline[i], wp.centerline[i + 1]) < ROUTE_HALF_WIDTH) return true;
            }
        }
        return false;
    }

    // Water the line of play crosses. Tees, fairway, green and bunkers are already known to be dry, so wet ground on the centre
    // line can only lie between them: in front of the tees (a par 3 over a pond) or between the tees and the fairway.
    // Returns null when the line stays dry, else { front, back, segs }: the longest carry from the front and the back tee to the
    // far bank (m) and the wet stretches as world segments (for the map).
    function waterCarry(wp, isWater, step) {
        let pts = densify(wp.centerline, step || 2, false);
        let centre = function (box) { let x = 0, z = 0; box.forEach(function (p) { x += p.x; z += p.z; }); return { x: x / box.length, z: z / box.length }; };
        let boxes = wp.teeBoxes || [];
        let back = boxes.length ? centre(boxes[0]) : wp.tee, front = boxes.length ? centre(boxes[boxes.length - 1]) : wp.tee;
        // how far along the line of play the front tee stands: its projection, not its distance (a short par 3 steps the
        // boxes sideways, so the front tee can be far from the back tee yet only a little way up the line)
        let frontS = (wp.teeSlots && wp.teeSlots[2]) ? wp.teeSlots[2].f : Math.hypot(front.x - back.x, front.z - back.z);
        let segs = [], start = -1, s = 0, res = { front: 0, back: 0, segs: segs };
        for (let i = 0; i <= pts.length; i++) {
            if (i > 0 && i < pts.length) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
            let wet = i < pts.length && isWater(pts[i].x, pts[i].z);
            if (wet && start < 0) start = i;
            if (!wet && start >= 0) {
                let a = pts[start], b = pts[i - 1];
                segs.push({ a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } });
                res.back = Math.max(res.back, Math.hypot(b.x - back.x, b.z - back.z));
                // water between the back and the front tee is no carry for the front tee
                if (s > frontS) res.front = Math.max(res.front, Math.hypot(b.x - front.x, b.z - front.z));
                start = -1;
            }
        }
        if (!segs.length) return null;
        res.front = Math.round(res.front); res.back = Math.round(res.back);
        return res;
    }

    // What a placed hole occupies, in the form tooCloseToOthers() takes: outlines plus the route as loose points
    function obstaclesOf(wp) {
        return { polygons: polys(wp), points: densify(wp.centerline, 20, false) };
    }
    // Is world point c "at" this part of the hole (the green end or the tee end)? Used to trim the centre line and the fairway where
    // they run into that part, so a neighbour's softer clearance is not undone by them
    function nearPart(wp, part, extra) {
        if (part === 'green') {
            let r = (wp.greenReach || 15) + extra;
            return function (c) { return Math.hypot(c.x - wp.greenCenter.x, c.z - wp.greenCenter.z) <= r; };
        }
        let r = ((wp.teeSlots && wp.teeSlots[2] && wp.teeSlots[2].f) || 56) + extra;
        return function (c) { return Math.hypot(c.x - wp.tee.x, c.z - wp.tee.z) <= r; };
    }
    // The fairway without its end at that part (a fairway reaches into its green and starts just past the front tee)
    function trimmedFairway(wp, part) {
        if (!wp.fairway) return null;
        let near = nearPart(wp, part, 40);
        let rest = wp.fairway.filter(function (c) { return !near(c); });
        return rest.length >= 3 ? rest : null;
    }
    // The same, split for a neighbour in the round: `part` ('green' or 'tee') goes into soft (only the other hole's tee boxes
    // resp. green may come TEE_NEAR to it), and the centre line is trimmed where it runs under that part
    function obstaclesSplit(wp, part) {
        let soft = [], hard = [];
        let isGreenBunker = function (i) { return wp.bunkerKinds && wp.bunkerKinds[i] === 'green'; };
        if (part === 'green') {
            soft.push(wp.green);
            wp.bunkers.forEach(function (b, i) { (isGreenBunker(i) ? soft : hard).push(b); });
            (wp.teeBoxes || []).forEach(function (t) { hard.push(t); });
        } else {
            (wp.teeBoxes || []).forEach(function (t) { soft.push(t); });
            hard.push(wp.green);
            wp.bunkers.forEach(function (b) { hard.push(b); });
        }
        let fw = trimmedFairway(wp, part);
        if (fw) hard.push(fw);
        let near = nearPart(wp, part, 15);
        let points = densify(wp.centerline, 20, false).filter(function (c) { return !near(c); });
        return { points: points, polygons: hard, soft: soft };
    }
    function normOthers(others) {
        return Array.isArray(others) ? { points: others, polygons: [] } : others;
    }
    // Can this plan stand at origin (its tee) pointing along `heading`? Cheapest checks first.
    // env: { isWater(x,z), others, half, heightAt, parts }. reasons: 'bounds' | 'close' | 'water' | 'carry' | '<part>_slope|range'
    // A good result may carry `carry` (see waterCarry) when the line of play crosses water.
    function evaluateSite(plan, origin, heading, env) {
        let limit = ((env && env.half) || MAP_HALF) - MAP_MARGIN;
        let wp = worldPlan(plan, origin, heading);
        let fail = function (r) { return { ok: false, reasons: [r], world: wp }; };
        if (!footprint(wp).every(function (p) { return Math.abs(p.x) <= limit && Math.abs(p.z) <= limit; })) return fail('bounds');
        if (tooCloseToOthers(wp, normOthers(env && env.others))) return fail('close');
        let carry = null;
        if (env && env.isWater) {
            // coarse pass first (cheap, rejects most wet spots), then a pass at the water grid's resolution
            // so a creek as narrow as one cell cannot slip between samples. Only what is built must be dry:
            // the line of play may cross water as long as the front tee can carry it.
            let ws = env.waterStep || 2;
            if (anyCovered(wp, 6, 12, env.isWater, true) || anyCovered(wp, ws, ws, env.isWater, true)) return fail('water');
            carry = waterCarry(wp, env.isWater, ws);
            if (carry && carry.front > MAX_CARRY) return fail('carry');
        }
        if (env && ((env.objects && objectsBlock(wp, env.objects, env.parts)) || (env.walls && wallsBlock(wp, env.walls, env.parts)))) return fail('object');
        let good = { ok: true, reasons: [], world: wp };
        if (carry) good.carry = carry;
        if (env && env.heightAt) {
            let sc = scoreSite(wp, env);
            if (!sc.ok) return { ok: false, reasons: sc.reasons, world: wp };
            if (sc.shaped && sc.shaped.length) { good.shaped = sc.shaped; good.work = sc.work; }
        }
        return good;
    }

    // Find a seed-determined spot on the map where the whole hole fits.
    function place(plan, rng, env) {
        let limit = ((env && env.half) || MAP_HALF) - MAP_MARGIN;
        let diag = env && env.diag;
        let bump = function (k) { if (diag) diag[k] = (diag[k] || 0) + 1; };
        for (let attempt = 0; attempt < 400; attempt++) {
            let origin = { x: range(rng, -limit, limit), z: range(rng, -limit, limit) };
            let heading = range(rng, 0, Math.PI * 2);
            let ev = evaluateSite(plan, origin, heading, env);
            if (!ev.ok) { bump(/_(slope|range)$/.test(ev.reasons[0]) ? 'steep' : ev.reasons[0]); continue; }
            return { world: ev.world, origin: origin, heading: heading, attempts: attempt + 1 };
        }
        return null;
    }

    // The shape for a seed: same seed, same hole shape (what a blueprint sketch stores)
    function planFor(par, seed, shape) {
        let rng = mulberry32(seed);
        let plan = null;
        for (let k = 0; k < 30; k++) {
            plan = buildPlan(par, rng, shape);
            if (!validatePlan(plan).length) return plan;
        }
        return plan;
    }

    // Closest legal spot to a starting position: rings outward, same heading first, then a few turns.
    // Returns { origin, heading, world } or null (time budget in ms, default 1500)
    function nearestValidSite(plan, origin, heading, env, budget) {
        let t0 = Date.now(), limit = budget || 1500;
        let tryAt = function (x, z, h) {
            let o = { x: x, z: z };
            let ev = evaluateSite(plan, o, h, env);
            return ev.ok ? { origin: o, heading: h, world: ev.world } : null;
        };
        let turns = [0, 0.5, -0.5, 1.0, -1.0];
        for (let ti = 0; ti < turns.length; ti++) {
            let h = heading + turns[ti];
            let step = ti === 0 ? 6 : 12;
            for (let r = 0; r <= 140; r += step) {
                let n = r === 0 ? 1 : Math.max(8, Math.round(r / 5));
                for (let i = 0; i < n; i++) {
                    let ang = (i / n) * Math.PI * 2;
                    let hit = tryAt(origin.x + Math.cos(ang) * r, origin.z + Math.sin(ang) * r, h);
                    if (hit) return hit;
                    if (Date.now() - t0 > limit) return null;
                }
            }
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

    // Footprints of everything placed on the plate (trees, rocks, buildings): { x, z, r } in metres.
    // Radius comes from the asset's physics (what the ball collides with); big things (architecture, rocks,
    // landscape) are never smaller than half their height, so a clubhouse without tuned physics still counts.
    // the asset library's building and terrain-like categories (see the PROPS/architecture filter in arcade.html)
    const BIG_SUBCATS = ['BLOCKS', 'ARCHITECTURE', 'STRUCTURES', 'PROPS', 'ROCKS', 'LANDSCAPE'];
    // Footprint radius (m) of one asset at scale 1, remembered per type: switching asset presets removes the
    // registry entry while the prop stays on the plate, so the first sighting (placement or load) is kept.
    const unitFootprint = {};
    function footprintAtUnitScale(def) {
        let ph = def.physics || {}, r;
        if (ph.type === 'tree') r = Math.max(ph.trunkRadius || 0, 0.4);
        else if (ph.type === 'profile') r = Math.max((ph.trunk && ph.trunk.r) || 0, 0.4);   // fitted to the model: same footprint rule as a tree
        else if (ph.radius) r = ph.radius;
        else r = 2;
        if (BIG_SUBCATS.indexOf(def.subcat) >= 0) r = Math.max(r, 0.5 * (def.targetHeight || 0));
        return r;
    }
    function rememberFootprint(type) {
        let def = root.ASSET_REGISTRY && root.ASSET_REGISTRY[type];
        if (def) unitFootprint[type] = footprintAtUnitScale(def);
    }
    const BLOCK_RADIUS = 2.5;   // the Building Block tool's 3 x 4 x 3 m boxes
    function collectObjects() {
        let list = root.placedTrees || [], out = [];
        list.forEach(function (o) {
            if (!o || typeof o.x !== 'number' || typeof o.z !== 'number') return;
            rememberFootprint(o.type);
            let unit = unitFootprint[o.type];
            let r = (typeof unit === 'number' ? unit : 2) * (o.scale || 1);
            out.push({ x: o.x, z: o.z, r: Math.max(0.4, Math.min(60, r)) });
        });
        (root.buildingBlocks || []).forEach(function (b) {
            // a block hit during a playtest is deactivated and taken out of the scene, but stays in the array
            if (!b || b.active === false || (b.mesh && b.mesh.parent === null)) return;
            let p = b && b.mesh && b.mesh.position;
            if (p && typeof p.x === 'number' && typeof p.z === 'number') out.push({ x: p.x, z: p.z, r: (b.radius || BLOCK_RADIUS) });
        });
        return out;
    }

    // The environment a hole is placed in: terrain water/height, other holes, placed objects, map size
    function siteEnv(parts, o) {
        let env = {
            half: (root.TERRAIN_SIZE || 600) / 2,
            others: otherHoles(root.courseHoles, root.currentHoleIndex),
            waterStep: Math.min(3, (root.TERRAIN_SIZE || 600) / (root.TERRAIN_SEGS || 300)),
            // the terrain lookup already knows painted water and per-cell water levels
            isWater: function (x, z) { let s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null; return !!s && s.type === 'WATER'; },
            heightAt: root.localGetTerrainAt ? surfaceY : null,
            objects: collectObjects(),
            walls: collectWalls(),
            parts: normalizeParts(parts)
        };
        if (o && o.diag) env.diag = {};
        if (o && o.allowShaping) {
            env.allowShaping = true;
            // the plateau is built at ground + the Green Studio elevation / Tee Studio raise height: use what the sliders say now
            let num = function (ids, dflt) {
                for (let i = 0; i < ids.length; i++) {
                    let el = root.document && root.document.getElementById(ids[i]);
                    let v = el ? parseFloat(el.value) : NaN;
                    if (isFinite(v)) return v;
                }
                return dflt;
            };
            env.lift = { green: num(['gs-elev-slider', 'sg-elevation-offset'], 0), tee: num(['st-raise-height'], SHAPE.tee.lift) };
            let amp = { FLAT: 0, EASY: 0.10, MED: 0.26, HARD: 0.33 }[root.greenDifficulty || 'FLAT'];
            env.greenRelief = { tilt: num(['gs-tilt-slider', 'sg-tilt-pct'], 2) / 100, amp: amp == null ? 0 : amp };
        }
        return env;
    }

    // Why the last generate() returned null: { code: 'no_hole' | 'not_empty' | 'no_parts' | 'site' | 'no_spot' | 'steep' | 'error',
    // reasons (site: evaluateSite's reasons), message (error) }, or null after a success. The blueprint's build reports it per hole.
    let lastFailure = null;
    function fail(code, extra) {
        lastFailure = Object.assign({ code: code, hole: root.currentHoleIndex }, extra || {});
        if (typeof console !== 'undefined' && console.warn) console.warn('HoleGenerator.generate failed', JSON.stringify(lastFailure));
        return null;
    }
    function generate(opts) {
        opts = opts || {};
        lastFailure = null;
        let parts = normalizeParts(opts.parts);
        let hole = root.courseHoles && root.courseHoles[root.currentHoleIndex];
        if (!hole) return fail('no_hole');
        if (!holeIsEmpty(hole)) {
            toast(t('hg_not_empty', '⚠️ Hålet har redan delar. Gå till ett tomt hål för att slumpa.'), '#f59e0b');
            return fail('not_empty');
        }
        if (!PART_KEYS.some(function (k) { return parts[k]; })) {
            toast(t('hg_pick_one', '⚠️ Välj minst en del att slumpa.'), '#f59e0b');
            return fail('no_parts');
        }
        hole.plannedGreen = null;   // the hole is empty here; any older plan is stale
        let par = clampPar(opts.par != null ? opts.par : (hole.par || 4));
        // a blueprint sketch may stand on ground that needs reshaping (yellow); random placement stays strict
        let env = siteEnv(parts, { diag: true, allowShaping: !!(opts.placement && opts.seed != null) });
        env.others = neighbourOthers(env.others, root.currentHoleIndex);
        if (opts.placement && opts.seed != null) env.others.slack = BUILD_SLACK;   // a blueprint spot: see tooCloseToOthers
        let res;
        let shaped = null, shapeWork = {}, capMissed = false, cappedFairway = null;
        if (opts.placement && opts.seed != null) {
            // a blueprint sketch: the user already chose the spot, we only re-check it
            let plan = planFor(par, opts.seed, opts.shape);
            let pl = opts.placement;
            let ev = evaluateSite(plan, { x: pl.x, z: pl.z }, pl.heading || 0, env);
            res = ev.ok ? { seed: opts.seed, plan: plan, placed: { world: ev.world, origin: { x: pl.x, z: pl.z }, heading: pl.heading || 0 } } : null;
            if (ev.ok && ev.shaped && ev.shaped.length) { shaped = ev.shaped; shapeWork = ev.work || {}; }
            if (!res) {
                toast(t('bp_site_bad', '⚠️ Platsen fungerar inte längre. Öppna kartan och flytta hålet.'), '#ef4444');
                return fail('site', { reasons: ev.reasons });
            }
        } else {
            res = generatePlan({ par: par, seed: opts.seed }, env);
        }
        if (!res) {
            if (failedBecauseSteep(env.diag)) {
                toast(t('hg_fail_steep', '⚠️ Marken är för kuperad för ett helt hål. Prova en plattare plats eller slumpa färre delar.'), '#ef4444');
                return fail('steep');
            }
            toast(t('hg_fail', '⚠️ Hittade ingen ledig plats för ett helt hål. Försök igen.'), '#ef4444');
            return fail('no_spot');
        }
        let wp = res.placed.world;

        // One undo step for the whole hole: the builders' own undo captures are muted while we build
        // The undo texture patch is sized from the editor's current points, so point it at the whole footprint first
        root.smartGreenPoints = footprint(wp).map(function (p) { return { x: p.x, y: 0, z: p.z }; });
        root.saveUndoState();
        root.smartGreenPoints = [];
        // a par chosen on the blueprint is part of this one undoable action (the snapshot above still holds the old par)
        if (opts.syncPar && hole.par !== par && typeof root.changeHolePar === 'function') root.changeHolePar(par - hole.par);
        let realSave = root.saveUndoState;
        root.saveUndoState = function () { };
        // the blueprint's course style: the fairway and green builders read the mowing pattern from this global while they build
        let prevMow = root._smartMowPattern;
        if (opts.mow) root._smartMowPattern = opts.mow;
        try {
            if (wp.fairway && parts.fairway) {
                // a fairway on a hill gets a slope cap: the hill stays but becomes playable
                let capNow = shaped && shaped.indexOf('fairway') >= 0;
                let prevCap = root._fairwayMaxSlopePct, prevAlong = root._fairwayMaxSlopeAlongPct;
                // built WITHOUT a cap first: the green does not exist yet, so the limiter could not keep its footprint locked.
                // The cap is applied at the end of the build (below), when the green, tees and bunkers are in place.
                root._fairwayMaxSlopePct = 0; root._fairwayMaxSlopeAlongPct = 0;
                try { buildShape('FAIRWAY', wp.fairway, function () { root.executeSmartFairway(); }); }
                finally {
                    // from here the global follows the Fairway Studio control again
                    // (the studio may have synced it to the new fairway while building; otherwise it still shows the old value)
                    let ctl = root.document && root.document.getElementById('sf-max-slope');
                    let shown = ctl ? parseFloat(ctl.value) : NaN;
                    root._fairwayMaxSlopePct = isFinite(shown) ? shown : prevCap;
                    let ctlA = root.document && root.document.getElementById('sf-max-along');
                    let shownA = ctlA ? parseFloat(ctlA.value) : NaN;
                    root._fairwayMaxSlopeAlongPct = isFinite(shownA) ? shownA : prevAlong;
                }
                if (capNow) cappedFairway = hole.fairways && hole.fairways[hole.fairways.length - 1];
            }
            if (parts.green) {
                buildShape('GREEN', wp.green, function () { root.executeSplineSmartGreen(); });
                // cutting a hill needs a wider blend, or the plateau ends in a wall
                if (shaped && shaped.indexOf('green') >= 0 && hole.greenData && typeof root.applyGreenPipeline === 'function') {
                    hole.greenData.blendDistance = Math.min(SHAPE.maxBlend, Math.max(SHAPE.minBlend, (shapeWork.green || 0) * SHAPE.blendPerMeter));
                    root.applyGreenPipeline(hole, false, true);
                }
            }
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
                root.buildStandardTeeLayout(wp.tee.x, wp.tee.z, wp.teeSlots);
                if (shaped && shaped.indexOf('tee') >= 0 && typeof root.applyTeePipeline === 'function') {
                    (hole.teeBoxes || []).forEach(function (tb) {
                        tb.blendRadius = Math.min(SHAPE.teeMaxBlend, Math.max(SHAPE.teeMinBlend, (shapeWork.tee || 0) * SHAPE.blendPerMeter));
                        root.applyTeePipeline(hole, false, false, tb, true);
                    });
                }
            }
            // yellow fairway: now that green / tees / bunkers exist the slope cap can be applied without touching the green zone
            if (cappedFairway && typeof root.applyFairwayPipeline === 'function') {
                cappedFairway.maxSlopePct = SHAPE.fairway.cap;
                root.applyFairwayPipeline(hole, false, false, cappedFairway);
                if (cappedFairway._slopeCapReached === false) capMissed = true;
            }
            // green left out: remember where it was planned so the user can build it there
            hole.plannedGreen = parts.green ? null : { x: wp.greenCenter.x, z: wp.greenCenter.z, r: Math.max(12, wp.greenReach || 15) };
        } catch (e) {
            // keep the single undo step so the user can remove whatever was built before the failure
            root.saveUndoState = realSave;
            if (typeof console !== 'undefined') console.error('Slumpa hål failed', e);
            toast(t('hg_error', '⚠️ Något gick fel när hålet byggdes. Tryck Ångra och försök igen.'), '#ef4444');
            if (typeof root.updateHoleMenu === 'function') root.updateHoleMenu(true);
            return fail('error', { message: String((e && e.stack) || e).slice(0, 600) });
        } finally {
            root.saveUndoState = realSave;
            if (opts.mow) root._smartMowPattern = prevMow;
        }
        if (typeof root.saveLevel === 'function') root.saveLevel();
        if (typeof root.updateHoleMenu === 'function') root.updateHoleMenu(true);
        refreshPlannedGreenMarker();
        focusCamera(wp);
        toast(t('hg_done', '🎲 Hål slumpat! Ändra fritt – Ångra tar bort hela hålet.') + ' (#' + res.seed + ')' + (shaped ? ' ' + t('hg_shaped', '⛰️ Marken formades för att hålet ska gå att spela.') : '') + (capMissed ? ' ' + t('hg_cap_missed', '⚠️ Fairwayns lutningstak nåddes inte helt – höj taket i Fairway Studio.') : ''), capMissed ? '#f59e0b' : '#4ade80');
        return { seed: res.seed, plan: res.plan, world: wp };
    }

    root.HoleGenerator = {
        RULES: RULES, CLEARANCE: CLEARANCE, TEE_NEAR: TEE_NEAR, DRIVE: DRIVE, LAYUP: LAYUP, MAX_CARRY: MAX_CARRY, TEE_PITCH: TEE_PITCH, teeSlots: teeSlots, waterCarry: waterCarry, mulberry32: mulberry32, buildPlan: buildPlan, validatePlan: validatePlan,
        generatePlan: generatePlan, place: place, evaluateSite: evaluateSite, lastFailure: function () { return lastFailure; }, obstaclesOf: obstaclesOf, obstaclesSplit: obstaclesSplit, neighbourOthers: neighbourOthers, objectsBlock: objectsBlock, wallsBlock: wallsBlock, collectObjects: collectObjects, collectWalls: collectWalls, rememberFootprint: rememberFootprint, planFor: planFor, nearestValidSite: nearestValidSite, siteEnv: siteEnv, footprint: footprint, scoreSite: scoreSite, failedBecauseSteep: failedBecauseSteep, slopeAt: slopeAt, SLOPE: SLOPE, SHAPE: SHAPE, cutDepth: cutDepth, otherHoles: otherHoles, tooCloseToOthers: tooCloseToOthers, coverage: coverage, anyCovered: anyCovered, inPoly: inPoly, worldPlan: worldPlan, generate: generate, holeIsEmpty: holeIsEmpty, normalizeParts: normalizeParts, PART_KEYS: PART_KEYS
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
