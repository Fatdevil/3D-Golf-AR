/**
 * Fade/draw på green: sidospinn ger kick i sidled vid studsen och rullar sedan vidare efter greenens lutning (physics.js only).
 * Konvention: spinAxisDeg positiv = fade (höger för högerhänt), negativ = draw (vänster).
 * Run: node tests/test_green_sidespin.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const G = global.window.GolfPhysics;
const SWING = require('./load_swing_engine.js')();

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
// slopeX: stigning per meter åt höger, slopeY: stigning per meter framåt
function greenEnv(slopeX, slopeY) {
  const len = Math.hypot(slopeX, slopeY, 1);
  const normal = [-slopeX / len, -slopeY / len, 1 / len];
  return { getTerrainAt: (x, y) => ({ z: slopeX * x + slopeY * y, normal, type: 'GREEN' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
}
function pitch(club, axis, firmness, slopeX, slopeY) {
  window.matchSettings.greenFirmness = firmness || 'NORMAL';
  const d = Object.assign({}, SWING.mapCircleToPhysics(1.0, 0, club, 0), { startPos: [0, 0, 0], spinAxisDeg: axis });
  const r = sim(d, greenEnv(slopeX || 0, slopeY || 0));
  const land = r.path.find(p => p.phase !== 'flight');
  const end = r.path[r.path.length - 1];
  return { landX: land.x, landY: land.y, endX: end.x, endY: end.y, phase: end.phase };
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

console.log('Plan green: fade kickar höger, draw vänster, båda checkar bakåt');
for (const firm of ['SOFT', 'NORMAL', 'FIRM']) {
  for (const club of ['LW', 'SW']) {
    const fade = pitch(club, 20, firm), draw = pitch(club, -20, firm), straight = pitch(club, 0, firm);
    const kickF = fade.endX - fade.landX, kickD = draw.endX - draw.landX;
    check(club + ' ' + firm + ' fade: kick åt höger efter landning', kickF > 0.3, '(' + kickF.toFixed(2) + ' m)');
    check(club + ' ' + firm + ' draw: kick åt vänster efter landning', kickD < -0.3, '(' + kickD.toFixed(2) + ' m)');
    check(club + ' ' + firm + ' fade/draw är spegelbilder', Math.abs(kickF + kickD) < 0.05 && Math.abs(fade.endY - draw.endY) < 0.05);
    check(club + ' ' + firm + ' rak spinaxel ger ingen sidokick', Math.abs(straight.endX) < 0.02, '(' + straight.endX.toFixed(3) + ' m)');
    if (firm !== 'FIRM') { // på hård green rullar bollen framåt trots spinn, men sidokicken gäller fortfarande
      check(club + ' ' + firm + ' fade spinner bakåt och höger samtidigt', fade.endY < fade.landY - 0.3 && fade.endX > fade.landX, '(back ' + (fade.landY - fade.endY).toFixed(1) + ' m)');
    }
    check(club + ' ' + firm + ' fade stannar', fade.phase === 'stopped');
  }
}

console.log('\nMer sidospinn ger större kick');
{
  const k = a => { const r = pitch('SW', a); return r.endX - r.landX; };
  check('SW: kick växer med spinaxeln (10° < 20° < 30°)', k(10) < k(20) && k(20) < k(30), '(' + [10, 20, 30].map(k).map(v => v.toFixed(2)).join(' < ') + ' m)');
}

console.log('\nLutande green: kicken rullar vidare efter lutningen');
{
  const flat = pitch('SW', 0, 'NORMAL', 0, 0);
  const tiltR = pitch('SW', 0, 'NORMAL', -0.03, 0), tiltL = pitch('SW', 0, 'NORMAL', 0.03, 0);
  check('Rak boll på sidolutning rullar nedför (höger-sluttning -> höger)', tiltR.endX > flat.endX + 0.3 && tiltL.endX < flat.endX - 0.3,
        '(' + tiltL.endX.toFixed(2) + ' / ' + flat.endX.toFixed(2) + ' / ' + tiltR.endX.toFixed(2) + ' m)');
  const fadeDown = pitch('SW', 20, 'NORMAL', -0.03, 0), fadeUp = pitch('SW', 20, 'NORMAL', 0.03, 0), fadeFlat = pitch('SW', 20, 'NORMAL', 0, 0);
  check('Fade nedför höger-sluttning går längre åt höger än på plan', fadeDown.endX > fadeFlat.endX, '(' + fadeDown.endX.toFixed(2) + ' vs ' + fadeFlat.endX.toFixed(2) + ' m)');
  check('Fade uppför höger-sluttning stannar tidigare åt höger än på plan', fadeUp.endX < fadeFlat.endX, '(' + fadeUp.endX.toFixed(2) + ' vs ' + fadeFlat.endX.toFixed(2) + ' m)');
  const back = pitch('SW', 0, 'NORMAL', 0, -0.03), front = pitch('SW', 0, 'NORMAL', 0, 0.03);
  check('Sluttning framåt/bakåt påverkar utrullningen i längdled', back.endY - back.landY > front.endY - front.landY);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
