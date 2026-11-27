// ================================================================
//  LAUNCH MONITOR SHOT REVIEW (window.LMShotReview) — what a range shot from a launch monitor tells about the player, before it goes
//  into the bag. lm-shot-quality.js decides whether a shot can be flown at all; this decides whether it says how far the club goes.
//
//    raw          the launch monitor's message as it came, kept beside the game's reading of it: when the physics gets better, old
//                 shots can be flown again from what was measured, not from what the game made of it
//    standard     carry and total in standard conditions (no wind, 15 °C, sea level, a flat fairway): a shot into the wind on a hill
//                 and one on a calm day at sea level say the same about the club. The bag keeps these, and the course adds wind and
//                 slope on top (the shot plan), so they are not counted twice
//    mishit       a topped or thin shot (very low launch, a smash factor far under what the club gives, a ball speed far under the
//                 player's own with the club) or a shank (a start line far off): shown in the session, kept out of the averages
//    misread      a value the launch monitor cannot have measured right (a smash factor no club can give): the same
//    wrong club   a shot that fits another club of the player's own bag far better than the one picked (the launch monitor does not send
//                 the club; it is picked in the panel and easily left on the last one): shown with the club it looks like, kept out
//  The player can count a flagged shot anyway (accepted), or change its club, which reviews it again.
//
//  The limits are judgement, not measurement: they are wide so that only shots that are clearly not a full swing with the club are
//  flagged. Smash factor: a driver at the legal limit gives about 1.50, irons about 1.38–1.45, wedges 1.20–1.30 on a good strike.
//  No DOM; the physics is passed in (window.GolfPhysics in the page). Tested in tests/test_lm_shot_review.js.
// ================================================================
(function (root) {
    'use strict';

    const KIND = { Dr: 'driver', '3W': 'wood', '5W': 'wood', Hy: 'hybrid', '4i': 'longIron', '5i': 'longIron', '6i': 'longIron', '7i': 'midIron',
                   '8i': 'shortIron', '9i': 'shortIron', PW: 'wedge', GW: 'wedge', SW: 'wedge', LW: 'wedge' };
    // per kind of club: the lowest launch (°) of a struck shot, the smash factor under which the strike was thin, and over which the
    // launch monitor misread a value
    const LIMITS = {
        driver:    { minLaunch: 2, minSmash: 1.30, maxSmash: 1.56 },
        wood:      { minLaunch: 3, minSmash: 1.28, maxSmash: 1.54 },
        hybrid:    { minLaunch: 4, minSmash: 1.25, maxSmash: 1.52 },
        longIron:  { minLaunch: 4, minSmash: 1.22, maxSmash: 1.48 },
        midIron:   { minLaunch: 5, minSmash: 1.20, maxSmash: 1.47 },
        shortIron: { minLaunch: 6, minSmash: 1.15, maxSmash: 1.46 },
        wedge:     { minLaunch: 10, minSmash: 1.00, maxSmash: 1.40 }
    };
    const MAX_START_LINE_DEG = 15;      // a start line further off than this is a shank or a toe shot, not a swing to the target
    const SHORT_STRIKE = 0.8;           // a ball speed under this share of the player's own median with the club: not a full swing
    const MIN_OWN = 5;                  // shots of the player's own with a club before their median is used
    const MIN_BALL_SPEED_MPH = 25;      // under this a shot is a putt or a chip: nothing to review
    // a shot fits a club of the bag when its ball speed is within max(FIT_MPH, FIT_SPREAD x the club's spread) of the club's median
    const FIT_MPH = 4, FIT_SPREAD = 2, MISFIT_MPH = 10, MISFIT_SPREAD = 3;
    // the fields of a launch-monitor message that are kept as it came
    const RAW_FIELDS = ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm', 'spinAxisDeg', 'azimDeg', 'clubSpeedMph', 'clubPathDeg', 'faceToPathDeg',
                        'clubAoADeg', 'BackSpin', 'SideSpin', 'backspin', 'sidespin', 'deviceId', 'shotNumber'];

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
    function median(a) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    // the median absolute deviation, scaled to a standard deviation for a normal spread (robust against the odd mishit among the shots)
    function spread(a) { const m = median(a); return m === null ? null : 1.4826 * median(a.map(function (v) { return Math.abs(v - m); })); }

    // The message as the launch monitor sent it: its own fields, unchanged (null stays null), and what it said it measured
    function rawOf(msg) {
        if (!msg) return null;
        const out = {};
        RAW_FIELDS.forEach(function (k) { if (msg[k] !== undefined) out[k] = msg[k]; });
        if (Array.isArray(msg.measured)) out.measured = msg.measured.slice();
        return out;
    }

    // Carry and total (metres) in standard conditions: no wind, 15 °C, sea level, a flat fairway. null without a physics or launch data.
    function standard(physics, shot) {
        if (!physics || !physics.simulateFlight || !shot || num(shot.ballSpeed) === null || num(shot.launch) === null || num(shot.spin) === null) return null;
        const env = { getTerrainAt: function () { return { z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }; }, checkCollisionCallback: function () { return null; },
                      wind: [0, 0, 0], temperatureC: 15, altitudeFeet: 0 };
        const log = console.log; console.log = function () {};   // the physics logs each flight
        let r;
        try {
            r = physics.simulateFlight({ startPos: [0, 0, 0], azimDeg: shot.hla || 0, spinAxisDeg: shot.spinAxis || 0, ballSpeedMph: shot.ballSpeed,
                launchAngleDeg: shot.launch, totalSpinRpm: shot.spin, isLiveData: true, isTeeShot: false }, env);
        } catch (e) { r = null; } finally { console.log = log; }
        if (!r || !r.metrics || num(r.metrics.carryMeters) === null) return null;
        // where it came down, across the target line (right +): the side the shot went in standard conditions, at its carry (no wind, no roll)
        let side = null;
        if (Array.isArray(r.path)) {
            let i = 1;
            while (i < r.path.length && r.path[i].phase === 'flight') i++;
            const q = r.path[Math.min(i, r.path.length - 1)];
            if (q && num(q.x) !== null) side = q.x;
        }
        return { carry: r.metrics.carryMeters, total: num(r.metrics.totalMeters) !== null ? Math.max(r.metrics.totalMeters, r.metrics.carryMeters) : r.metrics.carryMeters, side: side };
    }

    // The player's own ball speeds per club, from their bag entries ({ club, ballSpeed }): { club: { n, median, spread } }
    function ownSpeeds(entries) {
        const by = {};
        (entries || []).forEach(function (e) { if (e && e.club && num(e.ballSpeed) !== null) (by[e.club] = by[e.club] || []).push(e.ballSpeed); });
        const out = {};
        Object.keys(by).forEach(function (c) { out[c] = { n: by[c].length, median: median(by[c]), spread: spread(by[c]) }; });
        return out;
    }

    // review(shot, own): { flags, mishit, misread, looksLike } for a range shot ({ club, source, ballSpeed, clubSpeed, launch, hla }).
    // own: ownSpeeds() of the player's bag without this shot. flags name each finding: 'topped' (launch too low), 'thin' (smash factor),
    // 'short' (ball speed far under the player's own), 'offline_start' (start line), 'smash_impossible' (misread), 'wrong_club'.
    function review(shot, own) {
        const res = { flags: [], mishit: false, misread: false, looksLike: null };
        if (!shot || shot.source !== 'LM' || num(shot.ballSpeed) === null || shot.ballSpeed < MIN_BALL_SPEED_MPH) return res;
        const kind = KIND[shot.club], lim = kind ? LIMITS[kind] : null;
        const flag = function (f) { res.flags.push(f); };
        if (num(shot.hla) !== null && Math.abs(shot.hla) > MAX_START_LINE_DEG) flag('offline_start');
        if (!lim) return finish(res);
        if (num(shot.launch) !== null && shot.launch < lim.minLaunch) flag('topped');
        if (num(shot.clubSpeed) !== null && shot.clubSpeed > 0) {
            const smash = shot.ballSpeed / shot.clubSpeed;
            if (smash > lim.maxSmash) flag('smash_impossible');
            else if (smash < lim.minSmash) flag('thin');
        }
        own = own || {};
        const mine = own[shot.club];
        const struck = res.flags.indexOf('topped') < 0 && res.flags.indexOf('thin') < 0;
        if (mine && mine.n >= MIN_OWN) {
            const sp = mine.spread || 0;
            if (shot.ballSpeed < SHORT_STRIKE * mine.median) flag('short');
            // far off the picked club, and right on another one: the club was most likely left on the last one picked
            if (struck && Math.abs(shot.ballSpeed - mine.median) > Math.max(MISFIT_MPH, MISFIT_SPREAD * sp)) {
                let best = null;
                Object.keys(own).forEach(function (c) {
                    const o = own[c];
                    if (c === shot.club || o.n < MIN_OWN) return;
                    const d = Math.abs(shot.ballSpeed - o.median);
                    if (d <= Math.max(FIT_MPH, FIT_SPREAD * (o.spread || 0)) && (!best || d < best.d)) best = { club: c, d: d };
                });
                if (best) { flag('wrong_club'); res.looksLike = best.club; }
            }
        }
        return finish(res);
    }
    function finish(res) {
        res.misread = res.flags.indexOf('smash_impossible') >= 0;
        // a ball speed far under the player's own with a club that went up is a short strike; one that fits another club is the wrong club
        if (res.looksLike) res.flags = res.flags.filter(function (f) { return f !== 'short'; });
        res.mishit = ['topped', 'thin', 'short', 'offline_start'].some(function (f) { return res.flags.indexOf(f) >= 0; });
        return res;
    }

    // Whether a reviewed shot says how far its club goes: no finding, or the player counted it anyway
    function counts(shot) {
        const r = shot && shot.review;
        if (!r || shot.accepted) return true;
        return !(r.mishit || r.misread || r.looksLike);
    }

    // The words for a shot's findings (the session list's title, the toast)
    const WORDS = {
        sv: { topped: 'toppad (för låg utgångsvinkel)', thin: 'tunn träff (låg smash factor)', short: 'kort träff (långt under din vanliga bollfart)',
              offline_start: 'startriktningen långt ut (shank eller tå)', smash_impossible: 'orimlig smash factor (felmätning)', wrong_club: 'ser ut som {c}',
              lead: 'Räknas inte i snittet: ', accept: 'Räkna ändå', wrongToast: '🏌️ Slaget ser ut som ditt {c}, inte {p}. Byt klubba i listan om det stämmer.' },
        en: { topped: 'topped (launch too low)', thin: 'thin strike (low smash factor)', short: 'short strike (far under your usual ball speed)',
              offline_start: 'start line far off (shank or toe)', smash_impossible: 'impossible smash factor (misread)', wrong_club: 'looks like {c}',
              lead: 'Not counted in the averages: ', accept: 'Count anyway', wrongToast: '🏌️ That shot looks like your {c}, not {p}. Change the club in the list if so.' }
    };
    function words(sv) { return sv ? WORDS.sv : WORDS.en; }
    function describe(r, sv) {
        if (!r || !r.flags.length) return '';
        const W = words(sv);
        return W.lead + r.flags.map(function (f) { return (W[f] || f).replace('{c}', r.looksLike || ''); }).join(', ');
    }

    const api = { KIND: KIND, LIMITS: LIMITS, MIN_OWN: MIN_OWN, rawOf: rawOf, standard: standard, ownSpeeds: ownSpeeds, review: review, counts: counts,
                  describe: describe, words: words, median: median, spread: spread };
    root.LMShotReview = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
