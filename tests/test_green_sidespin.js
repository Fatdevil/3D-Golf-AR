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
// slopeX: stigning per meter åt höger, slopeY: stigning per meter framåt. Lutningen gäller bara landningsområdet (y >= SLOPE_FROM_Y);
// utgångsläget är plant så att lutningen inte ändrar utslagets spinaxel/riktning (simulateFlight korrigerar för lutning vid
// utgångsläget): bara bollens studs och rull påverkas.
const SLOPE_FROM_Y = 40;
function greenEnv(slopeX, slopeY) {
  const len = Math.hypot(slopeX, slopeY, 1);
  const tilted = [-slopeX / len, -slopeY / len, 1 / len], flat = [0, 0, 1];
  return { getTerrainAt: (x, y) => y >= SLOPE_FROM_Y ? { z: slopeX * x + slopeY * (y - SLOPE_FROM_Y), normal: tilted, type: 'GREEN' } : { z: 0, normal: flat, type: 'GREEN' },
           checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
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

console.log('\nLutande green: efter landningen rullar kicken vidare efter lutningen');
{
  const roll = r => r.endX - r.landX;                // förflyttning i sidled efter första markkontakten
  const flat = pitch('SW', 0, 'NORMAL', 0, 0);
  const tiltR = pitch('SW', 0, 'NORMAL', -0.03, 0), tiltL = pitch('SW', 0, 'NORMAL', 0.03, 0);
  check('landningen påverkas inte av lutningen (den börjar först vid landningsområdet)',
        Math.abs(tiltR.landX - flat.landX) < 0.1 && Math.abs(tiltL.landX - flat.landX) < 0.1,
        '(' + tiltL.landX.toFixed(2) + ' / ' + flat.landX.toFixed(2) + ' / ' + tiltR.landX.toFixed(2) + ' m)');
  check('Rak boll på sidolutning rullar nedför efter landning (höger-sluttning -> höger)', roll(tiltR) > roll(flat) + 0.3 && roll(tiltL) < roll(flat) - 0.3,
        '(' + roll(tiltL).toFixed(2) + ' / ' + roll(flat).toFixed(2) + ' / ' + roll(tiltR).toFixed(2) + ' m)');
  const fadeDown = pitch('SW', 20, 'NORMAL', -0.03, 0), fadeUp = pitch('SW', 20, 'NORMAL', 0.03, 0), fadeFlat = pitch('SW', 20, 'NORMAL', 0, 0);
  check('Fade nedför höger-sluttning rullar längre åt höger efter landning än på plan', roll(fadeDown) > roll(fadeFlat) + 0.3, '(' + roll(fadeDown).toFixed(2) + ' vs ' + roll(fadeFlat).toFixed(2) + ' m)');
  check('Fade uppför höger-sluttning rullar kortare åt höger efter landning än på plan', roll(fadeUp) < roll(fadeFlat) - 0.3, '(' + roll(fadeUp).toFixed(2) + ' vs ' + roll(fadeFlat).toFixed(2) + ' m)');
  const back = pitch('SW', 0, 'NORMAL', 0, -0.03), front = pitch('SW', 0, 'NORMAL', 0, 0.03);
  check('Sluttning framåt/bakåt påverkar utrullningen i längdled efter landning', back.endY - back.landY > front.endY - front.landY + 0.3,
        '(' + (back.endY - back.landY).toFixed(2) + ' vs ' + (front.endY - front.landY).toFixed(2) + ' m)');
}

console.log('\nSpelets formval: SwingEngine.mapCircleToPhysics(..., shape) ger avsiktlig fade/draw');
{
  const ax = (club, shape) => SWING.mapCircleToPhysics(1.0, 0, club, 0, shape).spinAxisDeg;
  check('utan formval är axeln oförändrad (0 vid rak arm)', ax('SW') === 0 && ax('SW', 0) === 0);
  check('fade ger positiv och draw negativ axel på pitch', ax('SW', 1) > 0 && ax('SW', -1) < 0 && ax('SW', 1) === -ax('SW', -1), '(' + ax('SW', 1) + '°)');
  check('putter påverkas inte', ax('PUTT', 1) === 0);
  check('driver får mindre axel än wedge', Math.abs(ax('DRIVER', 1)) < Math.abs(ax('LW', 1)));
  window.matchSettings.greenFirmness = 'NORMAL';
  const kick = shape => { const d = Object.assign(SWING.mapCircleToPhysics(1.0, 0, 'SW', 0, shape), { startPos: [0, 0, 0] });
    const r = sim(d, greenEnv(0, 0)); const l = r.path.find(p => p.phase !== 'flight'); return r.path[r.path.length - 1].x - l.x; };
  const kf = kick(1), kd = kick(-1);
  check('vald fade kickar höger på green, vald draw vänster', kf > 0.3 && kd < -0.3, '(' + kf.toFixed(2) + ' / ' + kd.toFixed(2) + ' m)');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
