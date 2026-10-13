/**
 * Launch monitor (GSPro Open Connect) -> fysik: BackSpin/SideSpin från monitorn ger backspinn och sidokick på green (physics.js only).
 * Slaget går samma väg som i spelet: GSPro-meddelande -> normalizeShot -> isLiveData -> simulateFlight.
 * Positiv SideSpin = fade (höger för högerhänt), negativ = draw (vänster).
 * Run: node tests/test_green_lm_spin.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const G = global.window.GolfPhysics;
const P = require('../gspro-bridge/protocol.js');

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
// Lutningen (sidled, stigning per meter åt höger) gäller bara landningsområdet, y >= SLOPE_FROM_Y. Utgångsläget är plant så att
// lutningen inte ändrar utslagets spinaxel/riktning (simulateFlight korrigerar för lutning vid utgångsläget): bara bollens studs och rull påverkas.
const SLOPE_FROM_Y = 40;
function greenEnv(slopeX) {
  const len = Math.hypot(slopeX, 1);
  const tilted = [-slopeX / len, 0, 1 / len], flat = [0, 0, 1];
  return { getTerrainAt: (x, y) => y >= SLOPE_FROM_Y ? { z: slopeX * x, normal: tilted, type: 'GREEN' } : { z: 0, normal: flat, type: 'GREEN' },
           checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
}
// Ett lob wedge-slag (70 mph, 36°, 10 500 rpm) som GSPro skickar det (yards/mph, rpm); ball = BallData-fält
function gsproShot(ball) {
  return { DeviceID: 'X', Units: 'Yards', ShotNumber: 1, APIversion: '1',
    BallData: Object.assign({ Speed: 70, VLA: 36, HLA: 0 }, ball),
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, IsHeartBeat: false } };
}
function lmShot(ball, slopeX) {
  const norm = P.normalizeShot(gsproShot(ball));
  const input = Object.assign({}, norm, { isLiveData: true, startPos: [0, 0, 0] });
  const r = sim(input, greenEnv(slopeX || 0));
  const land = r.path.find(p => p.phase !== 'flight');
  const end = r.path[r.path.length - 1];
  return { norm, landX: land.x, landY: land.y, endX: end.x, endY: end.y, phase: end.phase };
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

console.log('Monitorn skickar BackSpin/SideSpin: fade kickar höger, draw vänster, båda checkar bakåt');
{
  const fade = lmShot({ BackSpin: 10500, SideSpin: 1500 }), draw = lmShot({ BackSpin: 10500, SideSpin: -1500 }), straight = lmShot({ BackSpin: 10500, SideSpin: 0 });
  check('SideSpin blir positiv/negativ spinaxel', fade.norm.spinAxisDeg > 0 && draw.norm.spinAxisDeg < 0 && straight.norm.spinAxisDeg === 0,
        '(' + fade.norm.spinAxisDeg.toFixed(1) + '° / ' + draw.norm.spinAxisDeg.toFixed(1) + '°)');
  const kf = fade.endX - fade.landX, kd = draw.endX - draw.landX;
  check('fade kickar åt höger efter landning', kf > 0.3, '(' + kf.toFixed(2) + ' m)');
  check('draw kickar åt vänster efter landning', kd < -0.3, '(' + kd.toFixed(2) + ' m)');
  check('fade och draw är spegelbilder', Math.abs(kf + kd) < 0.05 && Math.abs(fade.endY - draw.endY) < 0.05);
  check('utan sidospinn ingen sidokick', Math.abs(straight.endX - straight.landX) < 0.02, '(' + (straight.endX - straight.landX).toFixed(3) + ' m)');
  check('backspinnet checkar bollen bakåt', fade.endY < fade.landY - 0.3 && straight.endY < straight.landY - 0.3,
        '(' + (straight.landY - straight.endY).toFixed(1) + ' m)');
  check('fade stannar på greenen', fade.phase === 'stopped');
}

console.log('\nSamma slag som TotalSpin/SpinAxis ger samma resultat som BackSpin/SideSpin');
{
  const a = lmShot({ BackSpin: 10500, SideSpin: 1500 });
  const b = lmShot({ TotalSpin: Math.hypot(10500, 1500), SpinAxis: Math.atan2(1500, 10500) * 180 / Math.PI });
  check('samma landning och stopp', Math.abs(a.endX - b.endX) < 0.01 && Math.abs(a.endY - b.endY) < 0.01,
        '(' + a.endX.toFixed(2) + ' / ' + b.endX.toFixed(2) + ' m)');
}

console.log('\nMer sidospinn från monitorn ger större kick');
{
  const k = s => { const r = lmShot({ BackSpin: 10500, SideSpin: s }); return r.endX - r.landX; };
  check('500 < 1000 < 2000 rpm sidospinn', k(500) < k(1000) && k(1000) < k(2000), '(' + [500, 1000, 2000].map(k).map(v => v.toFixed(2)).join(' < ') + ' m)');
}

console.log('\nLutande green: efter landningen rullar monitorns fade vidare efter lutningen');
{
  const shotOn = slope => lmShot({ BackSpin: 10500, SideSpin: 1500 }, slope);
  const flat = shotOn(0), down = shotOn(-0.03), up = shotOn(0.03);
  const roll = r => r.endX - r.landX;   // förflyttning i sidled efter första markkontakten
  check('landningen påverkas inte av lutningen (den börjar först vid landningsområdet)',
        Math.abs(down.landX - flat.landX) < 0.1 && Math.abs(up.landX - flat.landX) < 0.1,
        '(' + down.landX.toFixed(2) + ' / ' + flat.landX.toFixed(2) + ' / ' + up.landX.toFixed(2) + ' m)');
  check('fade nedför höger-sluttning rullar längre åt höger efter landning än på plan', roll(down) > roll(flat) + 0.3,
        '(' + roll(down).toFixed(2) + ' vs ' + roll(flat).toFixed(2) + ' m)');
  check('fade uppför höger-sluttning rullar kortare åt höger efter landning än på plan', roll(up) < roll(flat) - 0.3,
        '(' + roll(up).toFixed(2) + ' vs ' + roll(flat).toFixed(2) + ' m)');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
