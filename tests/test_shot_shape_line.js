/**
 * Avsiktlig fade/draw: startlinjen förskjuts så att en rätt träffad boll landar på siktlinjen (physics.js + arcade-swing-engine.js).
 * Fade startar till vänster om siktet och kurvar tillbaka, draw tvärtom. Slumpbruset i startlinjen stängs av (Math.random = 0,5).
 * Run: node tests/test_shot_shape_line.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const G = global.window.GolfPhysics;
const SE = require('./load_swing_engine.js')();
Math.random = () => 0.5;

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
const env = { getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
function fly(club, power, shape) {
  const d = Object.assign({}, SE.mapCircleToPhysics(power, 0, club, 0, shape), { startPos: [0, 0, 0] });
  const r = sim(d, env);
  const land = r.path.find(p => p.phase !== 'flight');
  const early = r.path.find(p => p.y > 0.15 * land.y);   // tidigt i flykten, innan kurvan hunnit ta ut sig
  return { d, landX: land.x, carry: land.y, earlyX: early.x };
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const clubs = Object.keys(SE.CLUB_PROFILES).filter(c => c !== 'PUTT');

console.log('Startlinjen: fade startar vänster, draw höger, rak oförändrad');
for (const c of clubs) {
  const f = SE.mapCircleToPhysics(0.85, 0, c, 0, 1), dr = SE.mapCircleToPhysics(0.85, 0, c, 0, -1), s = SE.mapCircleToPhysics(0.85, 0, c, 0);
  check(c + ': fade azimut < rak < draw azimut', f.azimDeg < s.azimDeg && dr.azimDeg > s.azimDeg && Math.abs((s.azimDeg - f.azimDeg) - (dr.azimDeg - s.azimDeg)) < 1e-9,
        '(' + f.azimDeg.toFixed(2) + ' / ' + s.azimDeg.toFixed(2) + ' / ' + dr.azimDeg.toFixed(2) + '°)');
  check(c + ': spinaxeln påverkas inte av startlinjen', f.spinAxisDeg === SE.shapeAxisDeg(c, 1) + s.spinAxisDeg);
}
{
  check('putter: ingen förskjutning', SE.shapeStartDeg('PUTT', 1, 1.0) === 0 && SE.shapeStartDeg('SW', 0, 1.0) === 0);
}

console.log('\nFörskjutningen växer med kraften');
for (const c of clubs) {
  let prev = -1, mono = true;
  for (const p of [0.1, 0.3, 0.5, 0.7, 0.85, 1.0]) { const v = Math.abs(SE.shapeStartDeg(c, 1, p)); if (v < prev) mono = false; prev = v; }
  check(c + ': startlinjens vinkel växer med kraften', mono);
}

console.log('\nRätt träffad fade/draw landar nära siktlinjen (50-100 % kraft)');
for (const c of clubs) {
  for (const p of [0.5, 0.7, 0.85, 1.0]) {
    const fade = fly(c, p, 1), draw = fly(c, p, -1), noOffset = fly(c, p, 0);
    const tol = Math.max(0.6, 0.015 * fade.carry);   // 1,5 % av carry (minst 0,6 m)
    check(c + ' ' + p * 100 + ' %: fade och draw landar inom ' + tol.toFixed(1) + ' m från siktlinjen',
          Math.abs(fade.landX) < tol && Math.abs(draw.landX) < tol,
          '(fade ' + fade.landX.toFixed(2) + ', draw ' + draw.landX.toFixed(2) + ' m av ' + fade.carry.toFixed(0) + ' m)');
    check(c + ' ' + p * 100 + ' %: fade börjar vänster och draw höger om siktlinjen', fade.earlyX < noOffset.earlyX && draw.earlyX > noOffset.earlyX);
  }
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
