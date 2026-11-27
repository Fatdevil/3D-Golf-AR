// ================================================================
//  TRAINING STATS (Training Lab · Club Intelligence) — what the shot bank says about each club, and how it changes.
//
//  One function, compute(shots, opts), used by the server (/api/training/clubs: every device of the player gets the same numbers) and
//  tested with known values (tests/test_training_stats.js). Its rules:
//    - only launch-monitor shots with a club, outside approach practice, say anything about the player's clubs; swing-meter shots are
//      counted apart (they measure the game, not the player)
//    - a shot that looks like another club (wrong_club) or was misread is left out of the club entirely: it is not a shot with that club,
//      or not a measurement
//    - a mishit counts in the club's mishit rate, but not in its carry, ball speed or spread (unless the player counted it anyway)
//    - a measured value and an estimated one are never mixed: a spin the game estimated (no spin from the launch monitor) is left out of
//      the spin, and the carry of such a shot (it flew on the estimate) out of the carry
//    - distances worked out by the ball flight (carry, spread across the line) are only taken from shots of one flight version (the
//      current one); shots of another or of no recorded version are counted apart, never averaged in. Ball speed, launch and spin are the
//      launch monitor's own and do not depend on the flight
//    - every number comes with the shots it rests on, and a reliability: under 5 shots none, under 20 low, else good
//  Periods: the latest session (with the club), the last 30 or 90 days, or all; the change is against the session before, or the period
//  of the same length before.
// ================================================================
(function (root) {
    'use strict';
    const CLUBS = ['Dr', '3W', '5W', 'Hy', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];
    const DAY = 86400000;
    const PERIODS = { session: null, '30d': 30 * DAY, '90d': 90 * DAY, all: Infinity };
    const MIN_ANY = 5, MIN_GOOD = 20;

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
    function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
    function median(a) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    function sd(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1)); }
    function reliability(n) { return n >= MIN_GOOD ? 'good' : (n >= MIN_ANY ? 'low' : 'none'); }

    // What one shot is, for the statistics
    function classify(s, version) {
        const r = s.review || null, flags = (r && r.flags) || [];
        const est = Array.isArray(s.estimated) ? s.estimated : [];
        return {
            lm: s.source === 'LM', sim: s.source === 'SIM', practice: !!s.practice,
            wrongClub: !!(r && r.looksLike), misread: !!(r && r.misread), mishit: !!(r && r.mishit),
            counted: !(r && (r.mishit || r.misread || r.looksLike)) || !!s.accepted,
            spinMeasured: est.indexOf('totalSpinRpm') < 0, guessed: est.length > 0,
            sameFlight: !!version && s.physics === version, flags: flags
        };
    }

    // The numbers of one club over a set of its shots (all of them launch-monitor shots with this club, outside practice)
    function clubNumbers(shots, version) {
        const reviewed = [], valid = [];
        let mishits = 0, otherFlight = 0;
        shots.forEach(function (s) {
            const c = classify(s, version);
            if (c.wrongClub || c.misread) return;
            reviewed.push(s);
            if (c.mishit) mishits++;
            if (c.counted) valid.push({ s: s, c: c });
        });
        const pick = function (f, ok) { return valid.filter(function (v) { return ok(v); }).map(function (v) { return f(v.s); }).filter(function (x) { return num(x) !== null; }); };
        // distances of the current flight only, and not of a shot that flew on an estimated value
        const flight = function (v) { return v.c.sameFlight && !v.c.guessed; };
        valid.forEach(function (v) { if (!v.c.sameFlight) otherFlight++; });
        const carry = pick(function (s) { return num(s.carryStd) !== null ? s.carryStd : s.carry; }, flight);
        const offline = pick(function (s) { return s.offline; }, flight);
        const ball = pick(function (s) { return s.ballSpeed; }, function () { return true; });
        const spin = pick(function (s) { return s.spin; }, function (v) { return v.c.spinMeasured; });
        const launch = pick(function (s) { return s.launch; }, function () { return true; });
        return {
            shots: reviewed.length, valid: valid.length, mishits: mishits,
            mishitRate: reviewed.length ? mishits / reviewed.length : null,
            carry: { n: carry.length, median: median(carry), mean: mean(carry), sd: sd(carry), reliability: reliability(carry.length) },
            side: { n: offline.length, sd: sd(offline), mean: mean(offline), reliability: reliability(offline.length) },
            ballSpeed: { n: ball.length, mean: mean(ball), sd: sd(ball), reliability: reliability(ball.length) },
            spin: { n: spin.length, mean: mean(spin), reliability: reliability(spin.length) },
            launch: { n: launch.length, mean: mean(launch) },
            otherFlight: otherFlight
        };
    }
    function delta(a, b, f) { const x = f(a), y = f(b); return x === null || y === null || x === undefined || y === undefined ? null : x - y; }

    // compute(shots, { period: 'session'|'30d'|'90d'|'all', now, version }) -> { period, version, clubs: [...], sim, legacy, total }
    function compute(shots, opts) {
        opts = opts || {};
        const period = PERIODS.hasOwnProperty(opts.period) ? opts.period : '30d';
        const now = num(opts.now) !== null ? opts.now : Date.now(), version = opts.version || null;
        const mine = shots.filter(function (s) { return s && s.source === 'LM' && s.club && !s.practice && typeof s.t === 'number'; });
        const by = {};
        mine.forEach(function (s) { (by[s.club] = by[s.club] || []).push(s); });
        const order = CLUBS.concat(Object.keys(by).filter(function (c) { return CLUBS.indexOf(c) < 0; }).sort());
        const clubs = order.filter(function (c) { return by[c]; }).map(function (club) {
            const list = by[club].slice().sort(function (a, b) { return a.t - b.t; });
            let cur, prev, label;
            if (period === 'session') {
                // the latest session with this club, and the one before it (shots without a session are not a session)
                const sessions = [];
                list.forEach(function (s) { if (s.session && sessions.indexOf(s.session) < 0) sessions.push(s.session); });
                const last = sessions[sessions.length - 1], before = sessions[sessions.length - 2];
                cur = last ? list.filter(function (s) { return s.session === last; }) : [];
                prev = before ? list.filter(function (s) { return s.session === before; }) : [];
                label = last || null;
            } else {
                const len = PERIODS[period];
                cur = len === Infinity ? list : list.filter(function (s) { return s.t > now - len && s.t <= now; });
                prev = len === Infinity ? [] : list.filter(function (s) { return s.t > now - 2 * len && s.t <= now - len; });
            }
            const a = clubNumbers(cur, version), b = prev.length ? clubNumbers(prev, version) : null;
            // the trend: the carry (current flight) week by week, over the period's shots
            const weeks = {};
            cur.forEach(function (s) {
                const c = classify(s, version);
                if (c.wrongClub || c.misread || !c.counted || !c.sameFlight || c.guessed) return;
                const v = num(s.carryStd) !== null ? s.carryStd : s.carry;
                if (num(v) === null) return;
                const w = weekStart(s.t);
                (weeks[w] = weeks[w] || []).push(v);
            });
            const trend = Object.keys(weeks).map(Number).sort(function (x, y) { return x - y; }).map(function (w) { return { week: w, n: weeks[w].length, carry: median(weeks[w]) }; });
            return {
                club: club, session: label, now: a, before: b, trend: trend,
                change: b ? {
                    carry: a.carry.n >= MIN_ANY && b.carry.n >= MIN_ANY ? delta(a, b, function (x) { return x.carry.median; }) : null,
                    side: a.side.n >= MIN_ANY && b.side.n >= MIN_ANY ? delta(a, b, function (x) { return x.side.sd; }) : null,
                    ballSpeed: a.ballSpeed.n >= MIN_ANY && b.ballSpeed.n >= MIN_ANY ? delta(a, b, function (x) { return x.ballSpeed.mean; }) : null,
                    mishitRate: a.shots >= MIN_ANY && b.shots >= MIN_ANY ? delta(a, b, function (x) { return x.mishitRate; }) : null
                } : null
            };
        }).filter(function (c) { return c.now.shots > 0 || (c.before && c.before.shots > 0); });
        const inPeriod = function (s) { return period === 'all' || period === 'session' || s.t > now - PERIODS[period]; };
        return {
            period: period, version: version, now: now, clubs: clubs,
            sim: shots.filter(function (s) { return s && s.source === 'SIM' && inPeriod(s); }).length,
            practice: shots.filter(function (s) { return s && s.practice && inPeriod(s); }).length,
            noClub: shots.filter(function (s) { return s && s.source === 'LM' && !s.club && inPeriod(s); }).length,
            limits: { any: MIN_ANY, good: MIN_GOOD }
        };
    }
    // the Monday 00:00 UTC of a time's week
    function weekStart(t) { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); }

    const api = { compute: compute, clubNumbers: clubNumbers, classify: classify, weekStart: weekStart, reliability: reliability, PERIODS: PERIODS, MIN_ANY: MIN_ANY, MIN_GOOD: MIN_GOOD };
    root.TrainingStats = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
