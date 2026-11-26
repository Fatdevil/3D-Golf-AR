// ================================================================
//  LAUNCH MONITOR SHOT QUALITY (window.LMShotQuality) — what a launch-monitor shot really measured, before the physics flies it.
//
//  A missing value is never a zero: a shot without spin is not a knuckleball, a shot without a spin axis is not dead straight. Each
//  value of a live shot is one of
//    measured   sent by the launch monitor and plausible
//    estimated  not sent (or sent as an impossible zero by an older bridge): the ball still flies, with a stated assumption
//    missing    not sent and not needed to fly the ball (club data): left empty, never zero
//  and a shot whose ball speed or launch angle is missing, or whose values are outside what a golf ball can do, is refused.
//
//  The bridge (gspro-bridge/protocol.js) sends `measured`, the fields the message really had. An older bridge sends no such list and
//  puts 0 where a value was missing: then a zero that cannot be real (no spin at full speed, a club speed of 0) counts as missing.
//  Shots with an estimated value are flown but kept out of the player's bag (arcade-bag.js): their carry rests on a guess.
//  No DOM; tested in tests/test_lm_shot_quality.js.
// ================================================================
(function (root) {
    'use strict';

    // what a golf shot can be (mph, degrees, rpm); outside these the launch monitor misread the ball
    const LIMITS = {
        ballSpeedMph: [3, 235], launchAngleDeg: [-20, 80], totalSpinRpm: [0, 15000], spinAxisDeg: [-90, 90], azimDeg: [-60, 60],
        clubSpeedMph: [3, 160], clubPathDeg: [-30, 30], faceToPathDeg: [-30, 30], clubAoADeg: [-20, 20]
    };
    const BALL = ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm', 'spinAxisDeg', 'azimDeg'];
    const CLUB = ['clubSpeedMph', 'clubPathDeg', 'faceToPathDeg', 'clubAoADeg'];
    // A spin to fly a shot whose spin was not measured, from its launch angle: the TrackMan tour averages (driver 10° / 2 600 rpm,
    // 7-iron 16° / 7 000, PW 24° / 9 300) joined by straight lines. A guess, marked as one.
    const SPIN_BY_LAUNCH = [[-20, 2000], [0, 2000], [10, 2600], [12, 4500], [16, 7000], [20, 8600], [24, 9300], [30, 9800], [80, 10000]];
    // below this ball speed a putt or a chip may really have next to no spin; above it a spin of 0 is an unread value
    const SPIN_ZERO_REAL_BELOW_MPH = 25;

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
    function spinFromLaunch(vla) {
        const t = SPIN_BY_LAUNCH;
        if (vla <= t[0][0]) return t[0][1];
        for (let i = 1; i < t.length; i++) {
            if (vla <= t[i][0]) { const a = t[i - 1], b = t[i]; return Math.round(a[1] + (b[1] - a[1]) * (vla - a[0]) / (b[0] - a[0])); }
        }
        return t[t.length - 1][1];
    }
    function within(field, v) { const l = LIMITS[field]; return v >= l[0] && v <= l[1]; }

    // check(shot): { ok, reason, field, shot, measured, estimated, missing }. shot is a copy ready for the physics (estimates filled in,
    // missing club values null). reason when not ok: 'no_ball_speed' | 'no_launch_angle' | 'out_of_range' (field names which).
    function check(input) {
        const s = Object.assign({}, input || {});
        const sent = Array.isArray(s.measured) ? s.measured : null;   // the fields the bridge says the message had (newer bridges)
        const has = function (f) { return num(s[f]) !== null && (!sent || sent.indexOf(f) >= 0); };
        const measured = [], estimated = [], missing = [];
        const out = function (reason, field) { return { ok: false, reason: reason, field: field || null, shot: s, measured: measured, estimated: estimated, missing: missing }; };

        // ball speed and launch angle: without them there is no shot to fly
        if (!has('ballSpeedMph') || s.ballSpeedMph <= 0) return out('no_ball_speed', 'ballSpeedMph');
        if (!has('launchAngleDeg')) return out('no_launch_angle', 'launchAngleDeg');
        for (const f of BALL) if (has(f) && !within(f, s[f])) return out('out_of_range', f);
        measured.push('ballSpeedMph', 'launchAngleDeg');

        // spin: an older bridge sends 0 for "not read"; at full speed that cannot be real
        const spinUnread = !has('totalSpinRpm') || (!sent && s.totalSpinRpm === 0 && s.ballSpeedMph >= SPIN_ZERO_REAL_BELOW_MPH);
        if (spinUnread) { s.totalSpinRpm = spinFromLaunch(s.launchAngleDeg); estimated.push('totalSpinRpm'); } else measured.push('totalSpinRpm');
        // the spin axis and the start line: straight when not sent (an older bridge's 0 cannot be told from a measured 0)
        if (has('spinAxisDeg')) measured.push('spinAxisDeg'); else { s.spinAxisDeg = 0; estimated.push('spinAxisDeg'); }
        if (has('azimDeg')) measured.push('azimDeg'); else { s.azimDeg = 0; estimated.push('azimDeg'); }

        // club data: not needed to fly the ball, so empty when not sent (a club speed of 0 from an older bridge means "no club data")
        const noClub = !sent && (num(s.clubSpeedMph) === null || s.clubSpeedMph === 0);
        for (const f of CLUB) {
            if (has(f) && !noClub && within(f, s[f])) measured.push(f);
            else { s[f] = null; missing.push(f); }
        }
        return { ok: true, reason: null, field: null, shot: s, measured: measured, estimated: estimated, missing: missing };
    }

    // the words for a refused shot (the toast)
    function refusedText(res, sv) {
        if (!res || res.ok) return '';
        if (res.reason === 'no_ball_speed') return sv ? '📡 Slaget från launch monitorn saknade bollfart och spelades inte' : '📡 The launch monitor shot had no ball speed and was not played';
        if (res.reason === 'no_launch_angle') return sv ? '📡 Slaget från launch monitorn saknade utgångsvinkel och spelades inte' : '📡 The launch monitor shot had no launch angle and was not played';
        return (sv ? '📡 Orimligt värde från launch monitorn (' : '📡 Impossible value from the launch monitor (') + res.field + ')' + (sv ? ': slaget spelades inte' : ': the shot was not played');
    }

    const api = { check: check, spinFromLaunch: spinFromLaunch, refusedText: refusedText, LIMITS: LIMITS };
    root.LMShotQuality = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
