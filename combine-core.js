// ================================================================
//  GOLF COMBINE 9 (window.CombineCore) — a standard test of nine fixed targets, scored 0-100, comparable over time within one level.
//
//  Used by the server (server.js: it scores a finished test from the shots in the shot bank, with its own ball flight) and by the range
//  panel (arcade-range-session.js: the targets, a preliminary score per shot, the result card). No DOM; tested in tests/test_combine.js.
//
//  The test: one shot at each of nine targets, shortest first, at one of three levels; distances in metres (yards are only shown).
//  A shot's score: e = the distance from the target where the ball came down in standard conditions (carry off by along the line, side
//  across it), R = max(6, 0.20 D), score = round(100 max(0, 1 - e / R)). The test's score: the mean of the nine.
//  Rules that make a score trustworthy:
//    - no free retakes: a topped, thin or sliced shot is part of the test and scores what it scores, also 0
//    - a shot may only be retaken when it was not a measurement: a misread (a smash factor no club gives) or a launch monitor that did
//      not send a value the score needs; the reason is kept with the voided shot
//    - official needs measured values: ball speed, launch, spin, spin axis and start direction all from the launch monitor. A shot with
//      any of them estimated (lm-shot-quality.js fills a missing spin axis or start line with 0 to fly the ball) can be played, but the
//      test then counts as practice, never as an official result
//    - the server works out where each shot came down from the shot's launch values with its own ball flight, and ignores any carry the
//      device sent; a result keeps the flight's version
// ================================================================
(function (root) {
    'use strict';
    const LEVELS = {
        beginner: [20, 30, 40, 50, 60, 70, 80, 90, 100],
        standard: [30, 50, 70, 90, 110, 130, 150, 170, 190],
        advanced: [50, 75, 100, 125, 150, 175, 200, 225, 250]
    };
    // what an official score needs measured (the names lm-shot-quality.js uses for what it estimated)
    const NEEDED = ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm', 'spinAxisDeg', 'azimDeg'];
    const ESTIMABLE = ['totalSpinRpm', 'spinAxisDeg', 'azimDeg'];
    const VOID_REASONS = ['misread', 'missing_value'];

    function num(v) { return typeof v === 'number' && isFinite(v); }
    function radius(D) { return Math.max(6, 0.20 * D); }
    // score of one shot at target D from where it came down (carry and side in standard conditions, metres)
    function shotScore(D, carry, side) {
        if (!num(D) || !num(carry) || !num(side)) return null;
        const e = Math.hypot(carry - D, side);
        return { score: Math.round(100 * Math.max(0, 1 - e / radius(D))), error: e, long: carry - D, side: side };
    }
    // Whether a shot's launch values were all measured: the bridge's own list of what the launch monitor sent (raw.measured, kept as it
    // came) has every needed value, nothing was estimated, and the numbers are there. Without that list nothing proves a value was measured
    // (an older bridge sends none): such a shot can be played, never official
    function measured(shot) {
        if (!shot || shot.source !== 'LM') return false;
        const est = Array.isArray(shot.estimated) ? shot.estimated : [];
        if (est.some(function (f) { return ESTIMABLE.indexOf(f) >= 0; })) return false;
        if (!num(shot.ballSpeed) || !num(shot.launch) || !num(shot.spin) || !num(shot.spinAxis) || !num(shot.hla)) return false;
        const m = shot.raw && Array.isArray(shot.raw.measured) ? shot.raw.measured : null;
        return !!m && NEEDED.every(function (f) { return m.indexOf(f) >= 0; });
    }
    // Why a shot may be retaken, or null: only when it was not a measurement. misread(shot) says whether it was a misread; the server passes
    // its own check (the smash factor from the ball and club speed, server-physics.js), never the device's review; the panel uses the review
    function voidReason(shot, misread) {
        if (!shot) return null;
        if (misread ? misread(shot) : !!(shot.review && shot.review.misread)) return 'misread';
        if (!measured(shot) && shot.source === 'LM') return 'missing_value';
        return null;
    }

    // A shot set aside for a retake: marked void by the device, and the reason holds for the shot itself (a misread, or a value not measured).
    // A void mark on a shot that was a real measurement does not hold: the shot counts (no free retakes)
    function voided(s, misread) { return !!(s && s.combine && s.combine.void && voidReason(s, misread)); }
    // The shot that counts for each target: the first one at that index that is not (rightly) voided; any later shot there is ignored
    function pick(shots, misread) {
        const by = [];
        (shots || []).slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (s) {
            const c = s.combine;
            if (!c || !(c.index >= 0 && c.index < 9) || by[c.index]) return;
            if (voided(s, misread)) return;
            by[c.index] = s;
        });
        return by;
    }

    // score(shots, level, landing, opts): the test from its shots. landing(shot) -> { carry, side } in standard conditions (on the server: its
    // own flight; in the panel: the shot's own preliminary values); opts.misread: the misread check (see voidReason).
    // { complete, official, total, shots: [...], worst: [three indexes], missing }
    function score(shots, level, landing, opts) {
        const targets = LEVELS[level];
        if (!targets) return null;
        const by = pick(shots, opts && opts.misread), out = [];
        let sum = 0, n = 0, official = true;
        const missing = [];
        targets.forEach(function (D, i) {
            const s = by[i];
            if (!s) { missing.push(i); out.push({ index: i, target: D, shot: null }); return; }
            const land = landing(s), sc = land ? shotScore(D, land.carry, land.side) : null;
            const ok = measured(s);
            if (!ok) official = false;
            if (!sc) { missing.push(i); out.push({ index: i, target: D, shot: s.cid, measured: ok, score: null }); return; }
            sum += sc.score; n++;
            out.push({ index: i, target: D, shot: s.cid, measured: ok, score: sc.score, error: sc.error, long: sc.long, side: sc.side, club: s.club || null });
        });
        const complete = missing.length === 0;
        const worst = out.filter(function (x) { return num(x.score); }).slice().sort(function (a, b) { return a.score - b.score || a.index - b.index; }).slice(0, 3).map(function (x) { return x.index; });
        return { level: level, complete: complete, official: complete && official, total: complete ? Math.round(10 * sum / n) / 10 : null, shots: out, worst: worst, missing: missing };
    }

    // The history of finished tests at one level and one ball flight: the latest, the best (official only), and the last five (oldest first).
    // Results of another flight version are never compared with these (a new flight moves where shots come down, and so the scores)
    function history(results, level, physics) {
        const mine = (results || []).filter(function (r) { return r.level === level && r.official && (!physics || r.physics === physics); }).sort(function (a, b) { return a.finished - b.finished; });
        if (!mine.length) return { latest: null, best: null, last5: [], count: 0 };
        let best = mine[0];
        mine.forEach(function (r) { if (r.total > best.total) best = r; });
        return { latest: mine[mine.length - 1], best: best, last5: mine.slice(-5), count: mine.length };
    }

    const api = { LEVELS: LEVELS, NEEDED: NEEDED, VOID_REASONS: VOID_REASONS, radius: radius, shotScore: shotScore, measured: measured, voidReason: voidReason, voided: voided, pick: pick, score: score, history: history };
    root.CombineCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
