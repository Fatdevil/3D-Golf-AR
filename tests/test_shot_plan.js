/**
 * Shot plan (arcade-shot-plan.js): which club and power reaches the aim point, and what wind and terrain do to the shot.
 * Part 1 checks the search logic against a made-up, smoothly growing distance. Part 2 runs it on the real physics (flat, tailwind, headwind, uphill)
 * with the club profiles of the swing engine, the way the game builds a shot preview.
 * Run: node tests/test_shot_plan.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
const SP = require('../arcade-shot-plan.js');
const SE = require('./load_swing_engine.js')();
Math.random = () => 0.5;
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

// ---- part 1: logic with a fake sim: club reach grows with power^1.5
const REACH = { LW: 55, SW: 90, PW: 115, I9: 130, I7: 150, I5: 175, W3: 205, DRIVER: 255 };
const fake = (club, power) => { const t = REACH[club] * Math.pow(power, 1.5); return { carry: t * 0.93, total: t }; };
let r = SP.powerFor(fake, 'I7', 120);
check('powerFor lands on the target (±0.6 m)', r.reachable && Math.abs(r.total - 120) < 0.6, JSON.stringify(r));
check('powerFor: 120 m with a 150 m club needs about (120/150)^(2/3) = 86 %', Math.abs(r.power - Math.pow(120 / 150, 2 / 3)) < 0.02, r.power);
r = SP.powerFor(fake, 'PW', 140);
check('a club that cannot reach says how short it falls', !r.reachable && Math.abs(r.short - 25) < 1e-9 && r.power === 1, JSON.stringify(r));
r = SP.powerFor(fake, 'DRIVER', 20);
check('a target nearer than the lowest swing is "over"', r.over === true && r.power === 0.25, JSON.stringify(r));
check('pickClub: 140 m from I9 steps up to the shortest club that fits (I7)', SP.pickClub(fake, 140, 'I9').club === 'I7');
check('pickClub: 100 m from I7 steps down to PW (needs 92 %)', SP.pickClub(fake, 100, 'I7').club === 'PW');
check('pickClub: picks the shortest club that fits', (() => { const p = SP.pickClub(fake, 100, 'I5'); const shorter = SP.ORDER[SP.ORDER.indexOf(p.club) - 1]; return p.power <= SP.MAX_COMFORT && (!shorter || !(SP.powerFor(fake, shorter, 100).power <= SP.MAX_COMFORT && SP.powerFor(fake, shorter, 100).reachable)); })());
check('pickClub: far beyond the driver gives the driver, not reachable', (() => { const p = SP.pickClub(fake, 300, 'DRIVER'); return p.club === 'DRIVER' && !p.reachable; })());
check('hysteresis: the club suggested before stays while it needs 60-97 %', SP.pickClub(fake, 112, 'PW', 'I7').club === 'I7');
check('hysteresis: it is dropped once it no longer fits (needs >97 %)', SP.pickClub(fake, 148, 'I7', 'PW').club !== 'PW');
check('describe splits the difference into wind and terrain', (() => {
  const sim = (c, p, mode) => { const base = fake(c, p).total; const t = mode === 'real' ? base + 8 + (-5) : mode === 'noWind' ? base - 5 : base; return { carry: t * 0.93, total: t }; };
  const d = SP.describe(sim, { club: 'I7', power: 0.9, reachable: true });
  return Math.abs(d.wind - 8) < 1e-9 && Math.abs(d.terrain + 5) < 1e-9 && Math.abs(d.playsLike - fake('I7', 0.9).total) < 1e-9;
})());

// a cliff in the ground (water short of the target, land beyond it): no power lands near 70 m
const cliff = (club, power) => { const t = power < 0.8 ? 40 * power : 60 + 60 * power; return { carry: t, total: t }; };
r = SP.powerFor(cliff, 'I7', 70);
check('a search that cannot get close says so (converged: false) instead of promising the target', r.reachable && r.converged === false && Math.abs(r.off) > 5, JSON.stringify(r));
check('a club that does not converge does not fit: pickClub moves on', SP.pickClub((c, p) => c === 'I7' ? cliff(c, p) : fake(c, p), 70, 'I7').club !== 'I7');
check('describe passes converged and off on', (() => { const d = SP.describe(cliff, r); return d.converged === false && typeof d.off === 'number'; })());
// the searches can be run a flight at a time (one yield per flight), with the same result
(function () {
  let n = 0; const counted = (c, p, m) => { n++; return fake(c, p, m); };
  const g = SP.planG(counted, 120, { startClub: 'I9' });
  let steps = 0, st = g.next(); while (!st.done) { steps++; st = g.next(); }
  const plain = SP.describe(fake, SP.pickClub(fake, 120, 'I9'));
  check('stepwise: one yield per flight', steps === n, steps + ' vs ' + n);
  check('stepwise gives the same plan as the plain call', st.value.club === plain.club && Math.abs(st.value.power - plain.power) < 1e-9 && Math.abs(st.value.total - plain.total) < 1e-9);
  const mine = SP.planG(fake, 100, { club: 'I7' }); let s2 = mine.next(); while (!s2.done) s2 = mine.next();
  check("stepwise with the player's own club does not change the club", s2.value.club === 'I7');
})();

// a target the starting club already overshoots at minimum power: shorter clubs, never longer ones
r = SP.pickClub(fake, 25, 'W3');
check('too long for the start club at minimum power: steps down, not up to the driver', r.club !== 'DRIVER' && SP.ORDER.indexOf(r.club) < SP.ORDER.indexOf('W3') && r.reachable && Math.abs(r.total - 25) < 1, JSON.stringify(r));
r = SP.pickClub(fake, 5, 'W3');
check('nothing is short enough: the shortest club is kept (over), not the driver', r.club === 'LW' && r.over === true, JSON.stringify(r));
r = SP.pickClub(fake, 5, 'LW');
check('...also when the search starts with the shortest club', r.club === 'LW' && r.over === true, JSON.stringify(r));
// the gentlest swing is the closest result: every harder swing carries a hazard and ends far long
const hazard = (club, power) => { const t = power <= 0.26 ? 69 : 200; return { carry: t, total: t }; };
r = SP.powerFor(hazard, 'I7', 70);
check('the low end of the search is a candidate: the minimum-power swing that lands within tolerance is kept', r.reachable && r.converged && r.power === 0.25 && Math.abs(r.total - 69) < 1e-9, JSON.stringify(r));
// a full swing that ends short (a bunker, a roll back) while a softer one reaches the target: the club is not given up
const dip = (club, power) => { const t = power > 0.9 ? 40 : REACH[club] * Math.pow(power, 1.5); return { carry: t, total: t }; };
r = SP.powerFor(dip, 'I7', 110);
check('a full swing that falls short does not rule the club out when a softer swing reaches', r.reachable && r.power <= 0.85 && Math.abs(r.total - 110) < 2, JSON.stringify(r));
r = SP.powerFor(dip, 'PW', 140);
check('...but a club that cannot reach at any power is still unreachable', r.reachable === false && r.short > 0, JSON.stringify(r));
const dip2 = (club, power) => { const t = power > 0.9 ? 30 : 80 * power; return { carry: t, total: t }; };   // the soft swing goes farther (68 m) than the full one (30 m), both short of 120
r = SP.powerFor(dip2, 'I7', 120);
check('unreachable: the farthest try is reported with its own power (not "full")', r.reachable === false && r.power === 0.85 && Math.abs(r.total - 68) < 1e-9 && Math.abs(r.short - 52) < 1e-9, JSON.stringify(r));
check('the billboard labels the unreachable case from the plan power', /pl\.power >= 0\.995 \? 'full power' : Math\.round\(pl\.power \* 100\) \+ '% power'/.test(require('fs').readFileSync(__dirname + '/../arcade.html', 'utf8')));
check('describe carries lateral and the aim correction (turn the aim against the drift)', (() => { const d = SP.describe((c, p, m) => Object.assign({}, fake(c, p), { lateral: m === 'real' ? 10 : 0 }), { club: 'I7', power: 0.9, reachable: true }); return d.lateral === 10 && d.aimFix < 0; })());

// ---- part 2: the real physics
const MPH = 0.44704;
function realSim(opts) {
  opts = opts || {};
  return function (club, power, mode) {
    const d = SE.mapCircleToPhysics(power, 0, club, 100);
    const windVec = mode === 'real' ? (opts.wind || [0, 0, 0]) : [0, 0, 0];
    const slope = mode === 'flatCalm' ? 0 : (opts.slope || 0);
    const env = { getTerrainAt: (x, y) => ({ z: slope * y, normal: [-0, -slope / Math.hypot(slope, 1), 1 / Math.hypot(slope, 1)], type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: windVec, temperatureC: 15 };
    const log = console.log; console.log = () => {};
    let res;
    try { res = G.simulateFlight({ startPos: [0, 0, 0.3], azimDeg: 0, spinAxisDeg: 0, ballSpeedMph: d.ballSpeedMph, launchAngleDeg: d.launchAngleDeg, totalSpinRpm: d.totalSpinRpm, isLiveData: false, isTeeShot: true }, env); }
    finally { console.log = log; }
    // forward (+y) and sideways (+x = right) displacement, like the game's preview: a crosswind is not distance
    const last = res.path[res.path.length - 1];
    let land = last; for (let i = 1; i < res.path.length; i++) if (res.path[i].phase !== 'flight') { land = res.path[i]; break; }
    return { carry: land.y, total: last.y, lateral: last.x };
  };
}
const calm = realSim();
r = SP.powerFor(calm, 'I7', 120);
check('real physics: 7-iron to 120 m lands within 0.6 m', r.reachable && Math.abs(r.total - 120) < 0.6, JSON.stringify(r));
check('real physics: carry is shorter than total', r.carry < r.total);
const tail = realSim({ wind: [0, 8, 0] }), head = realSim({ wind: [0, -8, 0] });   // 8 m/s along +y, the shot direction
const pc = SP.powerFor(calm, 'I7', 140), pt = SP.powerFor(tail, 'I7', 140), ph = SP.powerFor(head, 'I7', 140);
check('a tailwind needs less power than calm, a headwind more', pt.power < pc.power && ph.power > pc.power, [pt.power, pc.power, ph.power].map(x => x.toFixed(3)).join(' / '));
const dt = SP.describe(tail, pt), dh = SP.describe(head, ph);
check('describe: tailwind helps (wind > 0), headwind hurts (wind < 0)', dt.wind > 1 && dh.wind < -1, dt.wind.toFixed(1) + ' / ' + dh.wind.toFixed(1));
check('describe: a flat, calm shot has no wind and no terrain effect', (() => { const d = SP.describe(calm, pc); return Math.abs(d.wind) < 1e-6 && Math.abs(d.terrain) < 1e-6; })());
check('describe: "plays like" is shorter in a tailwind than the target', dt.playsLike < 140 + 1 && dh.playsLike > 140 - 1 && dt.playsLike !== dh.playsLike, dt.playsLike.toFixed(1) + ' / ' + dh.playsLike.toFixed(1));
const side = realSim({ wind: [8, 0, 0] }), ps = SP.powerFor(side, 'I7', 140), ds = SP.describe(side, ps);
check('a crosswind drifts the ball sideways (right for wind towards +x), measured as lateral', ds.lateral > 5, ds.lateral.toFixed(1));
check('...and does not count as distance: the power is about the calm one', Math.abs(ps.power - pc.power) < 0.03, ps.power.toFixed(3) + ' vs ' + pc.power.toFixed(3));
check('...the aim correction turns the aim against the drift', ds.aimFix < -1, ds.aimFix.toFixed(2));
const up = realSim({ slope: 0.1 });
const du = SP.describe(up, SP.powerFor(up, 'I7', 120));
check('describe: ground that rises towards the target takes distance (terrain < 0)', du.terrain < -1, du.terrain.toFixed(1));
const pk = SP.pickClub(calm, 150, 'I7');
check('real physics: pickClub 150 m gives a club that fits 60-97 %', pk.reachable && pk.power <= SP.MAX_COMFORT && pk.power >= 0.5, JSON.stringify(pk));
check('real physics: the next shorter club does not fit', (() => { const i = SP.ORDER.indexOf(pk.club); if (i === 0) return true; const s = SP.powerFor(calm, SP.ORDER[i - 1], 150); return !(s.reachable && s.power <= SP.MAX_COMFORT); })());
let sims = 0; const counted = (c, p, m) => { sims++; return calm(c, p, m); };
SP.pickClub(counted, 150, 'I7');
check('a search costs at most ~30 simulations', sims <= 30, sims);

// ---- part 3: the page uses it
const html = require('fs').readFileSync(__dirname + '/../arcade.html', 'utf8');
check('arcade.html loads arcade-shot-plan.js', /<script src="arcade-shot-plan\.js/.test(html));
check('the plan is updated every frame, also while the aim point is off screen', /window\.updateShotPlan\) window\.updateShotPlan\(\);/.test(html) && !/pos\.z < 1\) \{[^}]*updateShotPlan/.test(html));
check('the preview uses the physics of the shot: real terrain, no trees, calm and flat variants', /getTerrainAt: mode === 'flatCalm'[\s\S]{0,160}physicsTerrainAt/.test(html) && /wind: mode === 'real' \? ctx\.wind : \[0, 0, 0\]/.test(html));
check('a preview does not roll the flyer dice or log the flight', /Math\.random = function \(\) \{ return 0\.5; \}/.test(html) && /console\.log = function \(\) \{\};/.test(html));
check('a new shot ends the club pick (SwingEngine.newShot on landing)', /SwingEngine\.newShot\(\)/.test(html));
check('even the first slice runs from a timer, not the render callback', /setTimeout\(function \(\) \{ pump\(first\); \}, 0\)/.test(html) && !/\n\s+pump\(job\);/.test(html));
check('the search runs in short timer slices, not inside one frame', /j\.gen\.next\(\)/.test(html) && /setTimeout\(function \(\) \{ pump\(j\); \}, 0\)/.test(html) && /JOB_BUDGET_MS/.test(html) && !/SP\.pickClub\(|SP\.powerFor\(|SP\.describe\(/.test(html));
check('the preview measures along the aim line and reports sideways drift', /fwd\(last\)/.test(html) && /lateral: \(last\.x/.test(html));
check('a short aim off the green still suggests the putter', /if \(!manual\) SE\.suggestClub\('PUTT'\)/.test(html));
check('the plan is recomputed when the green settings change, and the preview uses the stimp the shot will use', /matchSettings\.greenStimp : 10, window\.matchSettings \? window\.matchSettings\.greenFirmness/.test(html) && /window\.GREEN_STIMP = ctx\.stimp/.test(html) && /window\.GREEN_STIMP = stimp/.test(html));
check('a job uses one green firmness too (the physics reads it from matchSettings), restored after each flight', /window\.matchSettings\.greenFirmness = ctx\.firm/.test(html) && /window\.matchSettings\.greenFirmness = firm;/.test(html));
check('a job uses one wind (a copy taken when it starts), not the live wind that changes every 500 ms', /wind: \(window\.currentWindVec \|\| \[0, 0, 0\]\)\.slice\(\)/.test(html) && /wind: mode === 'real' \? ctx\.wind/.test(html) && !/wind: mode === 'real' \? window\.currentWindVec/.test(html));
check('club hysteresis only within the same shot and only after an automatic pick', /prev\.ctxKey === ctxKey/.test(html) && /!prev\.manual/.test(html) && /plan\.ctxKey = job\.ctxKey/.test(html));
check('the flat, calm run keeps the surface under the ball', /type: ctx\.startType/.test(html));

console.log(failed ? '\n' + failed + ' failed' : '\nall shot-plan checks passed');
process.exit(failed ? 1 : 0);
