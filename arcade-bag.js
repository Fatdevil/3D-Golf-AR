// ================================================================
//  PLAYER BAG — how far the player really hits each club, from the launch-monitor shots on the range (window.PlayerBag).
//  The range session books every shot here (arcade-range-session.js); on a course the aim billboard picks the club whose average total is
//  nearest to what the shot plays like (the distance to the aim, with what wind and slope add or take, from the shot plan).
//  Only launch-monitor shots count: a swing-meter or typed shot measures the game's clubs, not the player's. The last 40 shots per club
//  are kept, so the bag follows the player's game as it changes; a club needs 3 shots before it is suggested.
//  Kept on this device (localStorage 'golf_bag_v1'). The maths has no DOM and is tested in tests/test_bag.js.
// ================================================================
(function (root) {
    const CLUBS = ['Dr', '3W', '5W', 'Hy', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];
    const PER_CLUB = 40, MIN_SHOTS = 3, KEY = 'golf_bag_v1';

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
    function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
    function sd(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1)); }

    // The bag after a shot is booked, or its club changed: the entry with the same time is replaced (or dropped when the shot no longer
    // counts), and each club keeps its newest PER_CLUB shots. A shot counts when it came from a launch monitor, has a club and a carry.
    function upsert(list, shot, perClub) {
        perClub = perClub || PER_CLUB;
        const out = list.filter(function (e) { return e.t !== shot.t; });
        if (shot.source === 'LM' && shot.club && num(shot.carry) !== null && shot.carry > 0) {
            out.push({ t: shot.t, club: shot.club, carry: shot.carry, total: num(shot.total) !== null ? shot.total : shot.carry });
        }
        out.sort(function (a, b) { return a.t - b.t; });
        const count = {}, keep = [];
        for (let i = out.length - 1; i >= 0; i--) {
            const c = out[i].club;
            count[c] = (count[c] || 0) + 1;
            if (count[c] <= perClub) keep.push(out[i]);
        }
        return keep.reverse();
    }

    // Per club in bag order: shots, average carry and total, spread of carry. known: enough shots to suggest the club
    function stats(list, minShots) {
        minShots = minShots || MIN_SHOTS;
        const by = {};
        list.forEach(function (e) { (by[e.club] = by[e.club] || []).push(e); });
        return CLUBS.concat(Object.keys(by).filter(function (c) { return CLUBS.indexOf(c) < 0; })).filter(function (c) { return by[c]; }).map(function (c) {
            const carry = by[c].map(function (e) { return e.carry; }), total = by[c].map(function (e) { return e.total; });
            return { club: c, n: by[c].length, carry: mean(carry), carrySd: sd(carry), total: mean(total), known: by[c].length >= minShots };
        });
    }

    // The club for a shot that plays like `playsLike` metres: the known club whose average total is nearest. diff is how far past (+) or
    // short (-) of it that club goes on average. null when no club is known yet.
    function suggest(st, playsLike) {
        if (num(playsLike) === null) return null;
        let best = null;
        st.forEach(function (r) {
            if (!r.known) return;
            const diff = r.total - playsLike;
            if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { club: r.club, n: r.n, carry: r.carry, carrySd: r.carrySd, total: r.total, diff: diff };
        });
        return best;
    }

    const api = { CLUBS: CLUBS, PER_CLUB: PER_CLUB, MIN_SHOTS: MIN_SHOTS, upsert: upsert, stats: stats, suggest: suggest };

    if (typeof localStorage !== 'undefined') {
        let cache = null;
        const load = function () {
            if (cache) return cache;
            try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); cache = (s && Array.isArray(s.shots)) ? s.shots : []; } catch (e) { cache = []; }
            return cache;
        };
        api.book = function (shot) {
            if (!shot || !shot.t) return;
            cache = upsert(load(), shot);
            try { localStorage.setItem(KEY, JSON.stringify({ shots: cache })); } catch (e) { /* private mode or full: the bag lives on this page */ }
        };
        api.clubs = function () { return stats(load()); };
        api.suggestFor = function (playsLike) { return suggest(stats(load()), playsLike); };
        api.knownCount = function () { return stats(load()).filter(function (r) { return r.known; }).length; };
    }

    root.PlayerBag = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
