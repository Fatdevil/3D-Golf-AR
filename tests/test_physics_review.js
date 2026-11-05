/**
 * Fixes from the review of the ball physics (physics.js) and the club row (arcade-swing-engine.js):
 * 1. The wind profile counts the height above the ground, not above z = 0: the same shot in the same wind goes as far wherever the ground is.
 * 2. The apex is the height above the start (it was above z = 0).
 * 3. A slope at the start: uphill takes speed, downhill gives (the sign was the other way round).
 * 4. Sand takes the speed along the ground at any landing angle (a low ball rolled 14-23 m through a bunker); a putt from sand still rolls.
 * 5. The club row's distances and the distance rule of the suggestion come from the physics (full carry per club), not fixed numbers.
 * 6. The reverse Magnus lift is blended in smoothly (18-22 m/s, towards 2 250 rpm): no jump in carry at 20 m/s or 2 250 rpm.
 * 7. The bounce: the COR comes from the speed into the ground (Penner), scaled per surface; a ball going over to the ground with slip
 *    left loses 2/7 of it (it slides until it rolls). First bounces of full shots are about 0.3 m (were 2-4 m), full totals barely move.
 * 8. Half shots with the driver: the turf brakes a fast rolling ball harder (a = mu g + k v^2, not on the green), and a driver or wood keeps
 *    most of its spin on a shorter swing. A half-power drive is about half the distance (it was 66 m carry and 116 m run, 66 % of full).
 * Run: node tests/test_physics_review.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
const quiet = console.log; console.log = function () {};
require('../physics.js');
const P = global.window.GolfPhysics;
let failed = 0;
function check(name, ok, detail) { quiet((ok ? '  ✅ ' : '  ❌ ') + name + (ok || detail === undefined ? '' : '  ' + detail)); if (!ok) failed++; }
const flat = function (z, type, normal) { return { getTerrainAt: function () { return { z: z, normal: normal || [0, 0, 1], type: type || 'FAIRWAY' }; } }; };
const sim = function (inp, env) { return P.simulateFlight(Object.assign({ azimDeg: 0, spinAxisDeg: 0 }, inp), env); };
const iron = { ballSpeedMph: 128, launchAngleDeg: 18.5, totalSpinRpm: 6500 };

quiet('1. Vinden över marken');
const carryAt = function (z, wind) { return sim(Object.assign({ startPos: [0, 0, z] }, iron), Object.assign(flat(z), { wind: wind })).metrics.carryMeters; };
const c0 = carryAt(0, [0, -10, 0]), cUp = carryAt(30, [0, -10, 0]), cDown = carryAt(-30, [0, -10, 0]);
check('samma motvind, marken på z = 0, +30, -30: samma carry', Math.abs(cUp - c0) < 0.05 && Math.abs(cDown - c0) < 0.05, [c0, cUp, cDown].map(function (v) { return v.toFixed(2); }).join(' / '));
check('motvinden tar fortfarande längd (10 m/s: mer än 20 m)', carryAt(0, [0, 0, 0]) - c0 > 20);
// over a valley (30-90 m out, the ball lands beyond it on z = 0) the ball is higher above the ground, so the wind is stronger there than over flat ground at the same world height
const valley = { getTerrainAt: function (x, y) { return { z: y > 30 && y < 90 ? -20 : 0, normal: [0, 0, 1], type: 'FAIRWAY' }; }, wind: [0, -10, 0] };
check('över en dal (marken 20 m lägre) tar motvinden mer', sim(Object.assign({ startPos: [0, 0, 0] }, iron), valley).metrics.carryMeters < c0 - 1);

quiet('\n2. Topphöjden från starten');
const a0 = sim(Object.assign({ startPos: [0, 0, 0] }, iron), flat(0)).metrics.apexMeters, a30 = sim(Object.assign({ startPos: [0, 0, 30] }, iron), flat(30)).metrics.apexMeters,
  am30 = sim(Object.assign({ startPos: [0, 0, -30] }, iron), flat(-30)).metrics.apexMeters;
check('samma slag på z = 0, +30, -30: samma topphöjd (ca 38 m med TrackMan-kurvorna, var 34)', Math.abs(a30 - a0) < 0.01 && Math.abs(am30 - a0) < 0.01 && a0 > 33 && a0 < 43, [a0, a30, am30].map(function (v) { return v.toFixed(2); }).join(' / '));

quiet('\n3. Lutningen vid utslaget');
const v0 = function (n) { const q = sim(Object.assign({ startPos: [0, 0, 0] }, iron), flat(0, 'FAIRWAY', n)).path[0]; return Math.hypot(q.vx, q.vy, q.vz); };
const s = Math.sin(0.1), c = Math.cos(0.1);
const vFlat = v0([0, 0, 1]), vUp = v0([0, -s, c]), vDown = v0([0, s, c]);
check('uppför (10 %): långsammare, nedför: snabbare, ca 1 %', vUp < vFlat && vDown > vFlat && Math.abs(vUp / vFlat - 0.9885) < 0.002 && Math.abs(vDown / vFlat - 1.0115) < 0.002, [vUp / vFlat, vDown / vFlat].map(function (v) { return v.toFixed(4); }).join(' / '));

quiet('\n4. Sand');
[[60, 8, 3000], [80, 12, 3500], [40, 5, 1500]].forEach(function (k) {
  const r = sim({ ballSpeedMph: k[0], launchAngleDeg: k[1], totalSpinRpm: k[2], startPos: [0, 0, 0] }, flat(0, 'SAND')).metrics;
  check(k[0] + ' mph, ' + k[1] + '° in i sand: rullar högst 1,5 m (var 14-23 m)', r.totalMeters - r.carryMeters < 1.5, (r.totalMeters - r.carryMeters).toFixed(2));
});
const sandPutt = sim({ ballSpeedMph: 22, launchAngleDeg: 1.5, totalSpinRpm: 300, startPos: [0, 0, 0] }, flat(0, 'SAND')).metrics.totalMeters;
check('en putt från sanden rullar fortfarande (22 mph: ca 8,5 m, som förut)', sandPutt > 7.5 && sandPutt < 9.5, sandPutt.toFixed(2));
const fairwayLow = sim({ ballSpeedMph: 60, launchAngleDeg: 8, totalSpinRpm: 3000, startPos: [0, 0, 0] }, flat(0, 'FAIRWAY')).metrics;
check('samma låga boll på fairway rullar som förut (mer än 10 m)', fairwayLow.totalMeters - fairwayLow.carryMeters > 10);

quiet('\n5. Klubbornas längder ur fysiken');
const labels = {};
const btns = ['DRIVER', 'W3', 'I5', 'I7', 'I9', 'PW', 'SW', 'LW', 'PUTT'].map(function (k) {
  const el = { textContent: k === 'PUTT' ? '---' : '0y' };
  labels[k] = el;
  return { dataset: { club: k }, querySelector: function () { return el; } };
});
const SE = require('./load_swing_engine.js')({ window: { GolfPhysics: P }, globals: { performance: performance }, document: { querySelectorAll: function (sel) { return sel === '.club-btn[data-club]' ? btns : []; } } });
const fc = SE.fullCarryM();
const order = ['DRIVER', 'W3', 'I5', 'I7', 'I9', 'PW', 'SW', 'LW'];
check('full carry för varje klubba, längre klubba längre', !!fc && order.every(function (k, i) { return fc[k] > 0 && (i === 0 || fc[order[i - 1]] > fc[k]); }), JSON.stringify(fc));
// (med TrackMan-profilerna och -kurvorna; förut 258 m och 67 m)
check('drivern ca 244 m (267 yd), lobwedgen ca 73 m', fc && Math.abs(fc.DRIVER - 244) < 3 && Math.abs(fc.LW - 73) < 3, JSON.stringify(fc));
SE.updateClubLabels();
check('knapparna visar full carry i yards (putterns --- kvar)', labels.DRIVER.textContent === Math.round(fc.DRIVER * 1.09361) + 'y' && labels.I7.textContent === Math.round(fc.I7 * 1.09361) + 'y' && labels.PUTT.textContent === '---', labels.DRIVER.textContent + ' ' + labels.I7.textContent);
const mid = function (a, b) { return (fc[a] + fc[b]) / 2; };
check('förslaget: halvvägs mellan två klubbors carry tar den kortare över', SE.autoSelectClub(mid('W3', 'I5') + 0.5) === 'W3' && SE.autoSelectClub(mid('W3', 'I5') - 0.5) === 'I5');
check('180 m: 5-järn (carry ca 193 m), inte 3-trä som förut (234 m)', SE.autoSelectClub(180) === 'I5', SE.autoSelectClub(180));
check('300 m: driver; 5 m: putter', SE.autoSelectClub(300) === 'DRIVER' && SE.autoSelectClub(5) === 'PUTT');
const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'arcade.html'), 'utf8');
check('arcade.html sätter knapparnas längder vid start och när enheten byts', /window\.SwingEngine\.updateClubLabels\(\);\s*\};\s*\/\/ the club row's distances/.test(html) && /DOMContentLoaded', function \(\) \{ window\.syncUnitButtons\(\); if \(window\.SwingEngine && window\.SwingEngine\.updateClubLabels\) window\.SwingEngine\.updateClubLabels\(\); \}/.test(html));

quiet('\n6. Omvänd Magnus utan hopp');
{
  const chip = function (mph, rpm) { return sim({ ballSpeedMph: mph, launchAngleDeg: 20, totalSpinRpm: rpm, startPos: [0, 0, 0] }, flat(0)).metrics.carryMeters; };
  const a = chip(45, 2200), b = chip(45, 2300);
  check('45 mph: 2 200 och 2 300 rpm flyger nästan lika långt (var 24,2 / 26,2 m)', Math.abs(a - b) / b < 0.02, a.toFixed(2) + ' / ' + b.toFixed(2));
  const steps = []; for (let mph = 40; mph <= 52; mph += 0.5) steps.push(chip(mph, 1500));
  const jumps = steps.slice(1).map(function (v, i) { return v - steps[i]; });
  check('1 500 rpm, 40-52 mph i halva mph: carry växer jämnt (varje steg inom 0,1 m från det förra, inget hopp vid 20 m/s)', jumps.every(function (d, i) { return d > 0 && (i === 0 || Math.abs(d - jumps[i - 1]) < 0.1); }), jumps.map(function (d) { return d.toFixed(2); }).join(' '));
  const low = chip(30, 300), spun = chip(30, 3000);
  check('en långsam boll med nästan inget spinn har fortfarande negativt lyft (kortare än med 3 000 rpm)', low < spun, low.toFixed(2) + ' < ' + spun.toFixed(2));
}

quiet('\n7. Studsen');
{
  const SW = require('./load_swing_engine.js')({ window: { GolfPhysics: P }, globals: { performance: performance } });
  const full = function (club, surf, pw) {
    const d = SW.mapCircleToPhysics(pw || 1.0, 0, club, 200);
    const r = sim({ ballSpeedMph: d.ballSpeedMph, launchAngleDeg: d.launchAngleDeg, totalSpinRpm: d.totalSpinRpm, startPos: [0, 0, 0], isTeeShot: true }, flat(0, surf));
    const p = r.path, i = p.findIndex(function (q) { return q.phase !== 'flight'; });
    let h = 0; for (let j = i + 1; j < p.length && p[j].phase === 'bounce'; j++) { if (j > i + 2 && p[j].z <= 1e-6) break; h = Math.max(h, p[j].z); }
    return { h: h, total: r.metrics.totalMeters, carry: r.metrics.carryMeters };
  };
  const hs = [];
  ['DRIVER', 'I7', 'PW', 'LW'].forEach(function (c) { ['FAIRWAY', 'GREEN'].forEach(function (sf) { hs.push(c + ' ' + sf + ' ' + full(c, sf).h.toFixed(2)); }); });
  check('första studsen efter ett fullt slag: högst 0,5 m (var 1,8-4,2 m)', hs.every(function (t) { return +t.split(' ')[2] <= 0.5; }), hs.join(', '));
  // the full totals on fairway, set with the TrackMan aero fit and club profiles (2026-11; before them: driver 274.0 / 7-iron 165.8 / PW 114.0 / LW 67.0 m)
  const was = { DRIVER: 261.0, I7: 157.5, PW: 119.3, LW: 72.1 };
  const now = {}; Object.keys(was).forEach(function (c) { now[c] = full(c, 'FAIRWAY').total; });
  check('fulla slag på fairway: total inom ±3 m från förut', Object.keys(was).every(function (c) { return Math.abs(now[c] - was[c]) <= 3; }), JSON.stringify(now));
  const half = full('DRIVER', 'FAIRWAY', 0.5);
  check('en låg driver på halv kraft rullar inte längre än förut (var 136 m efter 66 m carry)', half.total - half.carry < 130, (half.total - half.carry).toFixed(1));
}

quiet('\n8. Halvslag med driver');
{
  const SW8 = require('./load_swing_engine.js')({ window: { GolfPhysics: P }, globals: { performance: performance } });
  const shot = function (club, pw, surf) {
    const d = SW8.mapCircleToPhysics(pw, 0, club, 200);
    return sim({ ballSpeedMph: d.ballSpeedMph, launchAngleDeg: d.launchAngleDeg, totalSpinRpm: d.totalSpinRpm, startPos: [0, 0, 0], isTeeShot: club === 'DRIVER' }, flat(0, surf || 'FAIRWAY')).metrics;
  };
  const full = shot('DRIVER', 1.0), half = shot('DRIVER', 0.5);
  check('driver 50 %: 45-58 % av full längd (var 66 %)', half.totalMeters / full.totalMeters > 0.45 && half.totalMeters / full.totalMeters < 0.58, (half.totalMeters / full.totalMeters * 100).toFixed(0) + ' %');
  check('driver 50 %: rullar inte längre än den flyger (var 116 m rull efter 66 m carry)', half.totalMeters - half.carryMeters < half.carryMeters, half.carryMeters.toFixed(0) + ' / ' + (half.totalMeters - half.carryMeters).toFixed(0));
  check('driver 100 %: ca 261 m (TrackMan-kurvorna; var 275)', Math.abs(full.totalMeters - 261) < 4, full.totalMeters.toFixed(1));
  const d50 = SW8.mapCircleToPhysics(0.5, 0, 'DRIVER', 200), sw20 = SW8.mapCircleToPhysics(0.2, 0, 'SW', 20);
  check('drivern behåller det mesta av spinnet (50 %: över 2 000 rpm), en wedgechip följer farten som förut (SW 20 %: ca 3 700 rpm)', d50.totalSpinRpm > 2000 && Math.abs(sw20.totalSpinRpm - 10200 * (0.2 + 0.8 * 0.2)) < 1, d50.totalSpinRpm.toFixed(0) + ' / ' + sw20.totalSpinRpm.toFixed(0));
  const chip = shot('PW', 0.3);
  check('en PW-chip på fairway rullar som förut (30 %: ca 22 m totalt)', Math.abs(chip.totalMeters - 22.4) < 1.0, chip.totalMeters.toFixed(1));
  const putt = sim({ ballSpeedMph: 6.2, launchAngleDeg: 0, totalSpinRpm: 0, startPos: [0, 0, 0] }, flat(0, 'GREEN')).metrics.totalMeters;
  check('en putt på greenen rullar som förut (6,2 mph: ca 7,0 m, greenen har ingen fartbroms)', Math.abs(putt - 7.0) < 0.3, putt.toFixed(2));
}

quiet(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
