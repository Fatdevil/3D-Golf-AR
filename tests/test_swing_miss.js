/**
 * Swing-motorns missar (arcade-swing-engine.js + physics.js, ingen webbläsare).
 * En miss har ett startlinjefel (azimut) och en lutning på spinaxeln som ger en fade/draw åt samma håll. Efter att sidospinnet
 * rättades (kurvan blev 3-6 gånger större) ska missarna inte växa mer än ca 20 % mot ren startlinje.
 * Run: node tests/test_swing_miss.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
const SE = require('./load_swing_engine.js')();
const YD = 1.09361;
Math.random = function () { return 0.5; };

const env = { getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
function shot(club, power, armDeg, axisOverride) {
  const d = SE.mapCircleToPhysics(power, armDeg, club, 0);
  const inp = Object.assign({}, d, { startPos: [0, 0, 0], isLiveData: true, isTeeShot: true });
  if (axisOverride !== undefined) inp.spinAxisDeg = axisOverride;
  const log = console.log; console.log = function () {};
  try {
    const r = G.simulateFlight(inp, env);
    const p = r.path.find((q, i) => i > 0 && q.phase !== 'flight');
    return { side: p.x * YD, azim: d.azimDeg, axis: d.spinAxisDeg };
  } finally { console.log = log; }
}
const OFFS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];     // träffpunkt 0..1 (arm = träffpunkt * 90 grader)
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log('Missens form: startlinje och spinaxel åt samma håll');
for (const club of ['DRIVER', 'I7', 'PW']) {
  const right = shot(club, 0.9, 0.5 * 90), left = shot(club, 0.9, -0.5 * 90);
  check(club + ': miss åt höger ger positiv azimut och positiv axel (push-fade)', right.azim > 0 && right.axis > 0 && right.side > 0, '(azimut ' + right.azim.toFixed(1) + '°, axel ' + right.axis.toFixed(1) + '°, ' + right.side.toFixed(1) + ' yd)');
  check(club + ': miss åt vänster är spegelbilden (pull-draw)', left.azim < 0 && left.axis < 0 && Math.abs(left.side + right.side) < 1.0, '(' + left.side.toFixed(1) + ' yd)');
  check(club + ': axeln är mindre än startlinjefelet (en lätt kurva, inte en krok)', Math.abs(right.axis) < Math.abs(right.azim) && Math.abs(right.axis) > 0);
}

console.log('\nMissens storlek: snittet över träffpunkterna 0,1-0,9 (90 % kraft) mot ren startlinje utan kurva');
for (const [club, maxGrowth] of [['DRIVER', 1.25], ['I7', 1.15], ['PW', 1.10]]) {
  const withCurve = OFFS.map(o => shot(club, 0.9, o * 90).side), line = OFFS.map(o => shot(club, 0.9, o * 90, 0).side);
  const a = avg(withCurve), b = avg(line);
  check(club + ': snittmiss ' + a.toFixed(1) + ' yd är högst ' + Math.round((maxGrowth - 1) * 100) + ' % över ren startlinje (' + b.toFixed(1) + ' yd)', a <= b * maxGrowth && a >= b, '(+' + ((a / b - 1) * 100).toFixed(0) + ' %)');
  check(club + ': kurvan förstärker missen i samma riktning vid varje träffpunkt', withCurve.every((x, i) => x >= line[i] - 0.3));
}
{
  const worst = Math.max.apply(null, OFFS.map(o => shot('DRIVER', 0.9, o * 90).side));
  check('störst driver-miss på 90 % kraft är under 30 yd', worst < 30, '(' + worst.toFixed(0) + ' yd)');
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
