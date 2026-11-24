// The hole generator's shapes (hole-generator.js), checked in bulk: every plan follows the rules, the tee layout fits the hole
// (a short par 3 keeps a real front tee, boxes never closer than the builder allows), doglegs bend where the drive comes down,
// a fairway bunker guards the landing zone, and the line of play may cross water as long as the front tee can carry it.
const HG = require('../hole-generator.js');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '✅ ' : '❌ ') + name + (ok || detail === undefined ? '' : '   ' + JSON.stringify(detail)));
  if (!ok) failed++;
}
const N = 800;
const centre = function (b) { let x = 0, z = 0; b.forEach(function (p) { x += p.x; z += p.z; }); return { x: x / b.length, z: z / b.length }; };

[3, 4, 5, 6].forEach(function (par) {
  let invalid = [], minFront = Infinity, minPitch = Infinity, badBend = [], noFwBunker = 0, driveGuarded = 0, doubles = 0;
  for (let i = 0; i < N; i++) {
    const seed = i * 7919 + 13, p = HG.planFor(par, seed);
    const probs = HG.validatePlan(p);
    if (probs.length) invalid.push([seed, probs]);
    const wp = HG.worldPlan(p, { x: 0, z: 0 }, 0), t = wp.teeBoxes.map(centre);
    minFront = Math.min(minFront, Math.hypot(t[2].x - wp.greenCenter.x, t[2].z - wp.greenCenter.z));
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) minPitch = Math.min(minPitch, Math.hypot(t[a].x - t[b].x, t[a].z - t[b].z));
    if (p.path.bends.length) {
      const first = p.path.bends[0].s;
      // par 4: always at the drive; par 5 / 6: the drive or the lay-up
      const atDrive = first >= HG.DRIVE[0] - 0.01 && first <= HG.DRIVE[1] + 0.01;
      const atLayup = first >= p.length - HG.LAYUP[1] - 0.01 && first <= p.length - HG.LAYUP[0] + 0.01;
      if (!(atDrive || (par >= 5 && atLayup)) && !(par === 4 && Math.abs(first - (p.length - 90)) < 0.01)) badBend.push([seed, Math.round(first)]);
      if (p.path.bends.length === 2) doubles++;
    }
    if (p.fairway) {
      const fw = p.bunkers.filter(function (b) { return b.kind === 'fairway'; });
      if (!fw.length) noFwBunker++;
      if (fw.some(function (b) { const d = Math.hypot(b.center.f, b.center.l); return d >= HG.DRIVE[0] - 25 && d <= HG.DRIVE[1] + 25; })) driveGuarded++;
    }
  }
  check('par ' + par + ': every plan follows the rules', !invalid.length, invalid.slice(0, 3));
  check('par ' + par + ': tee boxes at least ' + HG.TEE_PITCH + ' m apart (' + minPitch.toFixed(1) + ')', minPitch >= HG.TEE_PITCH - 0.01);
  if (par === 3) check('par 3: the front tee plays at least 85 m (' + minFront.toFixed(0) + ')', minFront >= 85);
  else {
    check('par ' + par + ': doglegs bend where the drive (or lay-up) comes down', !badBend.length, badBend.slice(0, 5));
    check('par ' + par + ': every hole has a fairway bunker', noFwBunker === 0, noFwBunker);
    check('par ' + par + ': most holes guard the drive landing zone (' + Math.round(driveGuarded / N * 100) + ' %)', driveGuarded / N > 0.8);
  }
  if (par === 5) check('par 5: some doglegs bend twice (' + doubles + ')', doubles > N * 0.05 && doubles < N * 0.5);
  if (par === 6) check('par 6: many doglegs bend twice (' + doubles + ')', doubles > N * 0.2);
});

// water on the line of play
(function () {
  const plan = HG.planFor(3, 99), o = { x: -50, z: 0 };
  const base = { half: 300, others: { points: [], polygons: [] }, parts: HG.normalizeParts(null) };
  const pond = function (x0, x1) { return Object.assign({}, base, { isWater: function (x, z) { return x > x0 && x < x1 && Math.abs(z) < 60; } }); };
  const dry = HG.evaluateSite(plan, o, 0, base);
  check('dry ground: ok, no carry', dry.ok && !dry.carry);
  // the pond lies between the front tee and the approach strip in front of the green (x = o.x + f at heading 0)
  const apronStart = Math.min.apply(null, plan.fairway.map(function (q) { return q.f; }));
  const over = HG.evaluateSite(plan, o, 0, pond(o.x + 45, o.x + apronStart - 3));
  check('par 3 over a pond: ok, with the carry from both tees', over.ok && over.carry && over.carry.front > 0 && over.carry.back > over.carry.front && over.carry.segs.length === 1, over.carry);
  // a short par 3 steps the front tee sideways: water just ahead of it is still a carry for it
  const p7 = HG.planFor(3, 7), w7 = HG.worldPlan(p7, { x: 0, z: 0 }, 0), f7 = centre(w7.teeBoxes[2]);
  const side = HG.evaluateSite(p7, { x: 0, z: 0 }, 0, Object.assign({}, base, { isWater: function (x, z) { return x > f7.x + 3 && x < f7.x + 8 && Math.abs(z) < 40; } }));
  check('water just ahead of a sideways front tee counts as its carry', side.ok && side.carry && side.carry.front > 0, side.carry && [side.carry.front, side.carry.back]);
  // painted OB (a starter plate's canyon): nothing built on it and the line of play does not cross it, unlike water
  const canyon = function (x0, x1) { return Object.assign({}, base, { isOB: function (x, z) { return x > x0 && x < x1 && Math.abs(z) < 60; } }); };
  const overOB = HG.evaluateSite(plan, o, 0, canyon(o.x + 45, o.x + apronStart - 3));
  check('par 3 over painted OB: refused (ob), where the same pond is a carry', !overOB.ok && overOB.reasons[0] === 'ob', overOB.reasons);
  const thin = HG.evaluateSite(plan, o, 0, Object.assign({}, base, { isOB: function (x, z) { return x > o.x + 60 && x < o.x + 61.5; } }));
  check('a 1.5 m strip of OB across the line of play is found', !thin.ok && thin.reasons[0] === 'ob', thin.reasons);
  const besideOB = HG.evaluateSite(plan, o, 0, Object.assign({}, base, { isOB: function (x, z) { return Math.abs(z) > 120; } }));
  check('OB well off to the side leaves the hole alone', besideOB.ok, besideOB.reasons);
  const wetGreen = HG.evaluateSite(plan, o, 0, pond(plan.length - 60, plan.length - 40));
  check('water under the green is still refused', !wetGreen.ok && wetGreen.reasons[0] === 'water', wetGreen.reasons);
  // A generated par 3 never leaves more than ~110 m from the front tee to the green's front edge, so the limit is a safety net:
  // test it on a par 3 pushed 110 m longer by hand
  const p0 = HG.planFor(3, 99), push = function (q) { return { f: q.f + 110, l: q.l }; };
  const long = Object.assign({}, p0, { length: p0.length + 110, green: p0.green.map(push), greenCenter: push(p0.greenCenter), fairway: p0.fairway && p0.fairway.map(push),
    bunkers: p0.bunkers.map(function (b) { return Object.assign({}, b, { pts: b.pts.map(push), center: push(b.center) }); }),
    path: { total: p0.length + 110, segs: [{ a: { f: 0, l: 0 }, b: { f: p0.length + 110, l: 0 }, len: p0.length + 110, s0: 0, dir: { f: 1, l: 0 } }], knee: null, knees: [], bends: [] } });
  const wp = HG.worldPlan(long, o, 0), front = centre(wp.teeBoxes[2]);
  const longApron = Math.min.apply(null, wp.fairway.map(function (q) { return q.x; }));   // the water stops at the approach strip
  const farEv = HG.evaluateSite(long, o, 0, Object.assign({}, base, { isWater: function (x, z) { return x > front.x + 15 && x < longApron - 1 && Math.abs(z) < 3; } }));
  check('a carry longer than ' + HG.MAX_CARRY + ' m from the front tee is refused', !farEv.ok && farEv.reasons[0] === 'carry', [farEv.reasons, farEv.carry]);
})();

// neighbours in the round: the next tee may stand TEE_NEAR from the previous green, other parts keep CLEARANCE
(function () {
  const base = { half: 300, parts: HG.normalizeParts(null) };
  const a = HG.planFor(4, 11), b = HG.planFor(4, 12);
  const wa = HG.worldPlan(a, { x: -200, z: -200 }, 0);
  // look for a spot for hole b's tee close to hole a's green that only the neighbour rule allows
  const g = wa.greenCenter;
  let found = null;
  for (let r = 30; r <= 60 && !found; r += 2) for (let k = 0; k < 24 && !found; k++) {
    const ang = k / 24 * Math.PI * 2, o = { x: g.x + Math.cos(ang) * r, z: g.z + Math.sin(ang) * r };
    for (let t = 0; t < 12 && !found; t++) {
      const h = t / 12 * Math.PI * 2;
      const hard = HG.evaluateSite(b, o, h, Object.assign({}, base, { others: HG.obstaclesOf(wa) }));
      const split = HG.obstaclesSplit(wa, 'green');
      const soft = HG.evaluateSite(b, o, h, Object.assign({}, base, { others: { points: split.points, polygons: split.polygons, soft: [{ polygons: split.soft, mine: 'tee' }] } }));
      if (!hard.ok && soft.ok) found = { r: r, hard: hard.reasons };
    }
  }
  check('a tee ~' + (found ? found.r : '?') + ' m from the previous green: refused as a stranger, accepted as the next hole', !!found && found.hard[0] === 'close', found);
  // the soft rule only covers the tee boxes: the next hole's green that close is still refused
  const split = HG.obstaclesSplit(wa, 'green');
  let wrongPart = 0;
  for (let k = 0; k < 24; k++) {
    const ang = k / 24 * Math.PI * 2, o = { x: g.x + Math.cos(ang) * 40, z: g.z + Math.sin(ang) * 40 };
    const wb = HG.worldPlan(b, o, ang);
    const shift = { x: g.x - wb.greenCenter.x + Math.cos(ang) * 40, z: g.z - wb.greenCenter.z + Math.sin(ang) * 40 };
    const o2 = { x: o.x + shift.x, z: o.z + shift.z };   // b's GREEN 40 m from a's green
    const ev = HG.evaluateSite(b, o2, ang, Object.assign({}, base, { others: { points: split.points, polygons: split.polygons, soft: [{ polygons: split.soft, mine: 'tee' }] } }));
    if (ev.ok) wrongPart++;
  }
  check('a green 40 m from the previous green is still too close', wrongPart === 0, wrongPart);
})();

// the blueprint's shape buttons: bend left / straight / right and short / mid / long, all valid, the rest of the seed unchanged
(function () {
  [4, 5, 6].forEach(function (par) {
    const R = HG.RULES[par], third = (R.len[1] - R.len[0]) / 3;
    let bad = [];
    ['left', 'straight', 'right'].forEach(function (d) {
      ['short', 'mid', 'long'].forEach(function (l, li) {
        for (let seed = 1; seed <= 60; seed++) {
          const p = HG.planFor(par, seed, { dogleg: d, len: l });
          const g = HG.worldPlan(p, { x: 0, z: 0 }, 0).greenCenter;   // heading 0: +z is to the right of the player
          const sideOk = d === 'straight' ? (!p.dogleg && Math.abs(g.z) < 1e-6) : (p.dogleg && (d === 'right' ? g.z > 0 : g.z < 0));
          const lenOk = p.length >= R.len[0] + third * li - 0.01 && p.length <= R.len[0] + third * (li + 1) + 0.01;
          if (HG.validatePlan(p).length || !sideOk || !lenOk) bad.push([d, l, seed]);
        }
      });
    });
    check('par ' + par + ': every bend / length choice gives a valid hole of that shape', !bad.length, bad.slice(0, 4));
  });
  const p3 = HG.planFor(3, 5, { dogleg: 'left' });
  check('par 3 ignores a bend choice (it never bends)', !p3.dogleg && !HG.validatePlan(p3).length);
  check('no choice is the same as no shape at all', HG.planFor(4, 77, { dogleg: null, len: null }).length === HG.planFor(4, 77).length);
})();

// greens sized for the approach, and a par 3 gets a short approach strip in front of its green
(function () {
  const avgReach = function (par, len) { let n = 0, sum = 0; for (let seed = 1; seed <= 200; seed++) { const p = HG.planFor(par, seed, { len: len }); sum += p.greenReach; n++; } return sum / n; };
  const p3s = avgReach(3, 'short'), p3l = avgReach(3, 'long'), p5 = avgReach(5, 'mid'), p4l = avgReach(4, 'long');
  check('a long par 3 gets a bigger green than a short one (' + p3s.toFixed(1) + ' -> ' + p3l.toFixed(1) + ' m)', p3l > p3s + 2);
  check('a par 5 (a wedge in) gets a smaller green than a long par 4 (' + p5.toFixed(1) + ' < ' + p4l.toFixed(1) + ' m)', p5 < p4l - 1);
  let bad = [];
  for (let seed = 1; seed <= 300; seed++) {
    const p = HG.planFor(3, seed);
    if (!p.fairway) { bad.push([seed, 'none']); continue; }
    const fs = p.fairway.map(function (q) { return q.f; }), start = Math.min.apply(null, fs), end = Math.max.apply(null, fs);
    // in front of the green (ends inside it), well clear of the front tee, not wider than the green
    const front = HG.worldPlan(p, { x: 0, z: 0 }, 0).teeBoxes[2].reduce(function (a, q) { return a + q.x / 4; }, 0);
    const wide = Math.max.apply(null, p.fairway.map(function (q) { return Math.abs(q.l); }));
    if (end > p.greenCenter.f || end < p.greenCenter.f - p.greenReach || start < front + 15 || wide > p.greenReach * 1.1) bad.push([seed, Math.round(start), Math.round(end), Math.round(front)]);
  }
  check('every par 3 has its approach strip in front of the green, clear of the front tee', !bad.length, bad.slice(0, 4));
})();

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll hole generator checks passed');
process.exit(failed ? 1 : 0);
