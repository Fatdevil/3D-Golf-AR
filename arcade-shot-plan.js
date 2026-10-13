// Shot plan for game mode (no THREE, no DOM): which club and how much power reaches the aim point, and what wind and terrain do to the shot.
// It only holds the search logic. The caller supplies sim(club, power, mode) -> { carry, total } in metres, where mode is
//   'real'      the conditions of the shot (wind, terrain, altitude, temperature)
//   'noWind'    the same terrain without wind
//   'flatCalm'  flat ground and no wind
// carry and total are measured along the aim line (forward progress), lateral is the sideways drift, so a crosswind does not pass for distance.
// so the plan can say "plays like X" and how much of the difference comes from the wind and how much from the terrain.
(function (root) {
    const ORDER = ['LW', 'SW', 'PW', 'I9', 'I7', 'I5', 'W3', 'DRIVER'];   // shortest to longest
    const MIN_POWER = 0.25;      // below this a swing is not a swing: a target nearer than this is "over" (the club is too long for it)
    const MAX_COMFORT = 0.97;    // a club that needs more than this is too short, the next one up is picked (swing quality is best near 90 %)
    const KEEP_MIN = 0.6;        // the club that was suggested before stays while it still needs 60-97 % (no jumping between clubs on a metre)
    const STEPS = 8;             // most flights in the search; it stops early once the ball is within TOLERANCE
    const TOLERANCE = 0.5;       // metres
    const PROBE_POWER = 0.85;    // the softer swing tried when a full swing falls short
    const CONVERGED_M = 2, CONVERGED_REL = 0.03;   // a result this close (2 m or 3 % of the distance, the larger) counts as hitting the target

    // The searches are generators that yield after every flight, so the game can run a few flights per frame instead of all at once
    // (xxxG); the plain versions run one to the end. sim() itself is synchronous.
    function drain(g) { let n = g.next(); while (!n.done) n = g.next(); return n.value; }
    function* flight(sim, club, power, mode) { const r = sim(club, power, mode); yield; return r; }

    // The power at which this club ends up at targetTotal metres (total = carry + roll); the distance grows with power.
    // converged is false when no flight got close (a cliff in the ground: water, a ridge): the best try is then not what the plan promises.
    function* powerForG(sim, club, targetTotal) {
        let full = yield* flight(sim, club, 1, 'real');
        let topPower = 1;
        if (full.total < targetTotal) {
            // distance does not always grow with power (a full swing can end in a bunker or roll back down a slope): before giving the club up, try a softer swing
            const soft = yield* flight(sim, club, PROBE_POWER, 'real');
            if (soft.total < targetTotal) {
                const far = soft.total > full.total ? { p: PROBE_POWER, r: soft } : { p: 1, r: full };
                return { club: club, power: far.p, carry: far.r.carry, total: far.r.total, reachable: false, converged: true, short: targetTotal - far.r.total, over: false, off: far.r.total - targetTotal };
            }
            full = soft; topPower = PROBE_POWER;
        }
        const low = yield* flight(sim, club, MIN_POWER, 'real');
        if (low.total >= targetTotal) return { club: club, power: MIN_POWER, carry: low.carry, total: low.total, reachable: true, converged: true, short: 0, over: true, off: low.total - targetTotal };
        // regula falsi (distance grows smoothly with power, so the secant lands within a few flights); the bracket keeps it safe
        let lo = MIN_POWER, hi = topPower, tLo = low.total, tHi = full.total, best = { power: topPower, r: full };
        for (let i = 0; i < STEPS; i++) {
            let p = lo + (targetTotal - tLo) * (hi - lo) / (tHi - tLo);
            p = Math.min(hi - 0.02 * (hi - lo), Math.max(lo + 0.02 * (hi - lo), p));
            const r = yield* flight(sim, club, p, 'real');
            if (Math.abs(r.total - targetTotal) < Math.abs(best.r.total - targetTotal)) best = { power: p, r: r };
            if (Math.abs(r.total - targetTotal) <= TOLERANCE) break;
            if (r.total < targetTotal) { lo = p; tLo = r.total; } else { hi = p; tHi = r.total; }
        }
        const off = best.r.total - targetTotal;
        return { club: club, power: best.power, carry: best.r.carry, total: best.r.total, reachable: true, converged: Math.abs(off) <= Math.max(CONVERGED_M, CONVERGED_REL * targetTotal), short: 0, over: false, off: off };
    }

    const fits = (r) => r.reachable && r.converged && !r.over && r.power <= MAX_COMFORT;

    // The shortest club that does the shot at a comfortable power. startClub is where the search starts (the old distance rule),
    // prevClub is the club suggested last time: it is kept while it still fits.
    function* pickClubG(sim, targetTotal, startClub, prevClub) {
        if (prevClub && ORDER.indexOf(prevClub) >= 0) {
            const r = yield* powerForG(sim, prevClub, targetTotal);
            if (fits(r) && r.power >= KEEP_MIN) return r;
        }
        let idx = Math.max(0, ORDER.indexOf(startClub));
        let res = yield* powerForG(sim, ORDER[idx], targetTotal);
        if (!fits(res)) {
            while (idx < ORDER.length - 1 && !fits(res)) { idx++; res = yield* powerForG(sim, ORDER[idx], targetTotal); }
        } else {
            while (idx > 0) {
                const shorter = yield* powerForG(sim, ORDER[idx - 1], targetTotal);
                if (!fits(shorter)) break;
                idx--; res = shorter;
            }
        }
        return res;
    }

    // The plan for one club at the power it needs: carry, total, what the wind did, what the terrain did (both + = helps), and "plays like".
    function* describeG(sim, res) {
        const real = yield* flight(sim, res.club, res.power, 'real');
        const noWind = yield* flight(sim, res.club, res.power, 'noWind');
        const flat = yield* flight(sim, res.club, res.power, 'flatCalm');
        return {
            club: res.club, power: res.power, reachable: res.reachable, converged: res.converged, over: res.over, short: res.short, off: res.off,
            carry: real.carry, total: real.total,
            lateral: real.lateral || 0,             // metres the ball ends right (+) or left (-) of the aim line
            aimFix: real.total > 1 ? -Math.atan2(real.lateral || 0, real.total) * 180 / Math.PI : 0,   // degrees to turn the aim (+ right) to bring it back
            wind: real.total - noWind.total,        // metres the wind adds (+) or takes (-)
            terrain: noWind.total - flat.total,     // metres the slope and lie add (+) or take (-)
            playsLike: flat.total                   // the flat, calm distance this swing is worth
        };
    }

    // the whole plan as one generator: the club (picked, or the player's own) at the power it needs, described
    function* planG(sim, targetTotal, opts) {
        opts = opts || {};
        const res = opts.club ? yield* powerForG(sim, opts.club, targetTotal) : yield* pickClubG(sim, targetTotal, opts.startClub, opts.prevClub);
        return yield* describeG(sim, res);
    }

    const ShotPlan = {
        ORDER: ORDER, MAX_COMFORT: MAX_COMFORT, KEEP_MIN: KEEP_MIN,
        powerForG: powerForG, pickClubG: pickClubG, describeG: describeG, planG: planG,
        powerFor: function (sim, club, t) { return drain(powerForG(sim, club, t)); },
        pickClub: function (sim, t, start, prev) { return drain(pickClubG(sim, t, start, prev)); },
        describe: function (sim, res) { return drain(describeG(sim, res)); }
    };
    root.ShotPlan = ShotPlan;
    if (typeof module !== 'undefined' && module.exports) module.exports = ShotPlan;
})(typeof window !== 'undefined' ? window : globalThis);
