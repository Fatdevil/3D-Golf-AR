// Shot plan for game mode (no THREE, no DOM): which club and how much power reaches the aim point, and what wind and terrain do to the shot.
// It only holds the search logic. The caller supplies sim(club, power, mode) -> { carry, total } in metres, where mode is
//   'real'      the conditions of the shot (wind, terrain, altitude, temperature)
//   'noWind'    the same terrain without wind
//   'flatCalm'  flat ground and no wind
// so the plan can say "plays like X" and how much of the difference comes from the wind and how much from the terrain.
(function (root) {
    const ORDER = ['LW', 'SW', 'PW', 'I9', 'I7', 'I5', 'W3', 'DRIVER'];   // shortest to longest
    const MIN_POWER = 0.25;      // below this a swing is not a swing: a target nearer than this is "over" (the club is too long for it)
    const MAX_COMFORT = 0.97;    // a club that needs more than this is too short, the next one up is picked (swing quality is best near 90 %)
    const KEEP_MIN = 0.6;        // the club that was suggested before stays while it still needs 60-97 % (no jumping between clubs on a metre)
    const STEPS = 8;             // most flights in the search; it stops early once the ball is within TOLERANCE
    const TOLERANCE = 0.5;       // metres

    // The power at which this club ends up at targetTotal metres (total = carry + roll); the distance grows with power.
    function powerFor(sim, club, targetTotal) {
        const full = sim(club, 1, 'real');
        if (full.total < targetTotal) return { club: club, power: 1, carry: full.carry, total: full.total, reachable: false, short: targetTotal - full.total, over: false };
        const low = sim(club, MIN_POWER, 'real');
        if (low.total >= targetTotal) return { club: club, power: MIN_POWER, carry: low.carry, total: low.total, reachable: true, short: 0, over: true };
        // regula falsi (distance grows smoothly with power, so the secant lands within a few flights); the bracket keeps it safe
        let lo = MIN_POWER, hi = 1, tLo = low.total, tHi = full.total, best = { power: 1, r: full };
        for (let i = 0; i < STEPS; i++) {
            let p = lo + (targetTotal - tLo) * (hi - lo) / (tHi - tLo);
            p = Math.min(hi - 0.02 * (hi - lo), Math.max(lo + 0.02 * (hi - lo), p));
            const r = sim(club, p, 'real');
            if (Math.abs(r.total - targetTotal) < Math.abs(best.r.total - targetTotal)) best = { power: p, r: r };
            if (Math.abs(r.total - targetTotal) <= TOLERANCE) break;
            if (r.total < targetTotal) { lo = p; tLo = r.total; } else { hi = p; tHi = r.total; }
        }
        return { club: club, power: best.power, carry: best.r.carry, total: best.r.total, reachable: true, short: 0, over: false };
    }

    const fits = (r) => r.reachable && !r.over && r.power <= MAX_COMFORT;

    // The shortest club that does the shot at a comfortable power. startClub is where the search starts (the old distance rule),
    // prevClub is the club suggested last time: it is kept while it still fits.
    function pickClub(sim, targetTotal, startClub, prevClub) {
        if (prevClub && ORDER.indexOf(prevClub) >= 0) {
            const r = powerFor(sim, prevClub, targetTotal);
            if (fits(r) && r.power >= KEEP_MIN) return r;
        }
        let idx = Math.max(0, ORDER.indexOf(startClub));
        let res = powerFor(sim, ORDER[idx], targetTotal);
        if (!fits(res)) {
            while (idx < ORDER.length - 1 && !fits(res)) { idx++; res = powerFor(sim, ORDER[idx], targetTotal); }
        } else {
            while (idx > 0) {
                const shorter = powerFor(sim, ORDER[idx - 1], targetTotal);
                if (!fits(shorter)) break;
                idx--; res = shorter;
            }
        }
        return res;
    }

    // The plan for one club at the power it needs: carry, total, what the wind did, what the terrain did (both + = helps), and "plays like".
    function describe(sim, res) {
        const real = sim(res.club, res.power, 'real');
        const noWind = sim(res.club, res.power, 'noWind');
        const flat = sim(res.club, res.power, 'flatCalm');
        return {
            club: res.club, power: res.power, reachable: res.reachable, over: res.over, short: res.short,
            carry: real.carry, total: real.total,
            wind: real.total - noWind.total,        // metres the wind adds (+) or takes (-)
            terrain: noWind.total - flat.total,     // metres the slope and lie add (+) or take (-)
            playsLike: flat.total                   // the flat, calm distance this swing is worth
        };
    }

    const ShotPlan = { ORDER: ORDER, MAX_COMFORT: MAX_COMFORT, KEEP_MIN: KEEP_MIN, powerFor: powerFor, pickClub: pickClub, describe: describe };
    root.ShotPlan = ShotPlan;
    if (typeof module !== 'undefined' && module.exports) module.exports = ShotPlan;
})(typeof window !== 'undefined' ? window : globalThis);
