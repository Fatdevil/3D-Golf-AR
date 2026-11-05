/**
 * Sidospinn / spinaxel (physics.js only, no browser).
 * Konvention (Trackman): spinAxisDeg positiv = högerkurva (fade/slice för högerhänt), negativ = vänsterkurva.
 * Sidospinnet ligger runt lodrät axel, så kurvan är en riktig kurva och inte ett nästan utraderat par krafter.
 * Run: node tests/test_sidespin.js
 */
const fs = require('fs');
const path = require('path');
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
Math.random = function () { return 0.5; };
const YD = 1.09361;

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
function flat() { return { getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 }; }
function shot(mph, la, rpm, axis, az) {
  return { startPos: [0, 0, 0], ballSpeedMph: mph, launchAngleDeg: la, totalSpinRpm: rpm, spinAxisDeg: axis, azimDeg: az || 0, isLiveData: true, isTeeShot: true };
}
// avvikelse i sidled (yd, positiv = höger om riktningen) vid första markkontakten
function curve(mph, la, rpm, axis, az, env) {
  const r = sim(shot(mph, la, rpm, axis, az), env || flat());
  const p = r.path.find((q, k) => k > 0 && q.phase !== 'flight');
  const a = (az || 0) * Math.PI / 180;
  return { side: (p.x * Math.cos(a) - p.y * Math.sin(a)) * YD, carry: r.metrics.carryMeters * YD };
}
const DRIVER = [167, 10.5, 2500], I7 = [128, 18.5, 7100], PW = [103, 26, 9300];

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const f1 = x => (x >= 0 ? '+' : '') + x.toFixed(1);

console.log('Riktning: positiv spinaxel kurvar åt höger, negativ åt vänster');
for (const [n, c] of [['driver', DRIVER], ['7-järn', I7], ['PW', PW]]) {
  const r = curve(c[0], c[1], c[2], 10), l = curve(c[0], c[1], c[2], -10);
  check(n + ': +10° höger, −10° vänster', r.side > 0 && l.side < 0, '(' + f1(r.side) + ' / ' + f1(l.side) + ' yd)');
  check(n + ': ±10° är spegelbilder (inom 0,5 yd)', Math.abs(r.side + l.side) < 0.5);
}

console.log('\nStorlek: i nivå med vad en launch monitor visar för 10° spinaxel (ungefärliga spann)');
{
  const d = curve(...DRIVER, 10), i = curve(...I7, 10), p = curve(...PW, 10);
  // Sidokurvan är lyftet gånger sin(axeln), och lyftet är inpassat mot TrackMans topphöjd och landningsvinkel (physics.js AERO). Spannen
  // följer därför den modellen: förut 25-40 / 8-13 / 0,5-3 yd, vilket krävde mer lyft på drivern och mindre på järnen än TrackMan-höjderna ger.
  check('driver 10° ger 14-24 yd', d.side > 14 && d.side < 24, '(' + f1(d.side) + ' yd)');
  check('7-järn 10° ger 12-22 yd', i.side > 12 && i.side < 22, '(' + f1(i.side) + ' yd)');
  check('PW 10° ger 5-13 yd', p.side > 5 && p.side < 13, '(' + f1(p.side) + ' yd)');
  const small = curve(...DRIVER, 5), big = curve(...DRIVER, 15);
  check('större axel ger mer kurva (5° < 10° < 15°)', small.side < d.side && d.side < big.side, '(' + f1(small.side) + ' < ' + f1(d.side) + ' < ' + f1(big.side) + ')');
}

console.log('\nCarry påverkas knappt av lutningen i axeln');
{
  const c0 = curve(...I7, 0).carry, c15 = curve(...I7, 15).carry, cm15 = curve(...I7, -15).carry;
  check('7-järn ±15° ändrar carry mindre än 2 %', Math.abs(c15 / c0 - 1) < 0.02 && Math.abs(cm15 / c0 - 1) < 0.02, '(' + c0.toFixed(1) + ' → ' + c15.toFixed(1) + ' / ' + cm15.toFixed(1) + ' yd)');
}

console.log('\nRiktning relativt skottet: samma kurva oavsett azimut');
{
  const base = curve(...I7, 10, 0).side;
  for (const az of [-60, -20, 20, 60, 135]) {
    const c = curve(...I7, 10, az).side;
    check('azimut ' + az + '°: kurva ' + f1(c) + ' yd mot ' + f1(base) + ' yd rakt fram', Math.abs(c - base) < 1.0);
  }
}

console.log('\nSido-lutning: boll över fötterna ger draw (vänster), under fötterna fade (höger)');
{
  function sideSlope(k) {                  // k = stigning i x-led (höjd per meter åt höger)
    const len = Math.hypot(k, 1), normal = [-k / len, 0, 1 / len];
    return { getTerrainAt: (x) => ({ z: k * x, normal: normal, type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
  }
  const flatSide = curve(...I7, 0).side;
  const above = curve(...I7, 0, 0, sideSlope(0.1)).side, below = curve(...I7, 0, 0, sideSlope(-0.1)).side;
  check('marken stiger åt höger (bollen över fötterna): kurvar åt vänster', above < flatSide - 1, '(' + f1(above) + ' yd mot ' + f1(flatSide) + ' rakt)');
  check('marken sjunker åt höger (bollen under fötterna): kurvar åt höger', below > flatSide + 1, '(' + f1(below) + ' yd mot ' + f1(flatSide) + ' rakt)');
}

console.log('\nIngångarna: positiv sidospinn (slice) ger positiv axel');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
  check('arcade.html räknar axeln med atan2(ss, bs) på båda ställena', (html.match(/Math\.atan2\(ss, bs\)/g) || []).length === 2);
  check('arcade.html har ingen kvarvarande atan2(-ss, …) som kompenserade för den gamla fysiken', !/Math\.atan2\(-ss, bs\)/.test(html));
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
