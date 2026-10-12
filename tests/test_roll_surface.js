/**
 * En boll som rullar över på ett annat underlag bromsas av det underlaget (physics.js only, no browser).
 * Förut gällde underlaget från nedslaget hela vägen: en boll som rullade från green in i rough bromsades som på green.
 * Run: node tests/test_roll_surface.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
// slope: stigning per meter längs +y. Underlaget är typ0 för y < edge och typ1 därefter.
function env(type0, type1, edge, slope) {
  const len = Math.hypot(slope || 0, 1);
  const normal = [0, -(slope || 0) / len, 1 / len];
  return { getTerrainAt: (x, y) => ({ z: (slope || 0) * y, normal, type: y < edge ? type0 : type1 }), wind: [0, 0, 0] };
}
function roll(mph, e) {
  const r = sim({ startPos: [0, 0, 0.022], ballSpeedMph: mph, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0, isLiveData: true }, e);
  const f = r.path[r.path.length - 1];
  return { y: f.y, phase: f.phase, time: f.time, maxY: Math.max.apply(null, r.path.map(q => q.y)), finalType: r.metrics.finalTerrainType };
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const m = r => r.y.toFixed(1) + ' m';

console.log('Rullning över en underlagsgräns (6 mph = 2,7 m/s, gränsen vid y = 1 m)');
{
  const fw = roll(6, env('FAIRWAY', 'FAIRWAY', 1)), fwGr = roll(6, env('FAIRWAY', 'GREEN', 1)), gr = roll(6, env('GREEN', 'GREEN', 1));
  check('fairway -> green rullar längre än ren fairway men kortare än ren green', fw.y < fwGr.y && fwGr.y < gr.y, '(' + m(fw) + ' < ' + m(fwGr) + ' < ' + m(gr) + ')');
  const grRough = roll(6, env('GREEN', 'ROUGH', 1)), grFw = roll(6, env('GREEN', 'FAIRWAY', 1));
  check('green -> rough stannar mycket tidigare än ren green', grRough.y < gr.y * 0.4, '(' + m(grRough) + ' mot ' + m(gr) + ')');
  check('green -> fairway ligger mellan rough och green', grRough.y < grFw.y && grFw.y < gr.y, '(' + m(grRough) + ' < ' + m(grFw) + ' < ' + m(gr) + ')');
  check('green -> rough stannar (inte tidsgräns)', grRough.phase === 'stopped' && grRough.time < 24);
}

console.log('\nfinalTerrainType är fortfarande nedslagsunderlaget som spelet läser av');
{
  const r = roll(6, env('GREEN', 'ROUGH', 1));
  check('green -> rough ger finalTerrainType GREEN', r.finalType === 'GREEN', '(' + r.finalType + ')');
}

console.log('\nBrant uppförslutning (12 %, brantare än gränsen för en rullande boll: mu / (5/7) = ca 7,8 %): rough håller bollen, green släpper den');
{
  const gr = roll(3, env('GREEN', 'GREEN', 0.3, 0.12)), rough = roll(3, env('GREEN', 'ROUGH', 0.3, 0.12));
  check('ren green: bollen rullar tillbaka förbi start', gr.y < 0, '(slut ' + m(gr) + ')');
  check('green -> rough: bollen blir liggande i rough', rough.phase === 'stopped' && rough.y > 0.3 && Math.abs(rough.y - rough.maxY) < 0.05 && rough.time < 24,
        '(max ' + rough.maxY.toFixed(2) + ', slut ' + m(rough) + ', ' + rough.phase + ')');
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
