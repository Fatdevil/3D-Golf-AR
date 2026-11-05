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
function greenEnv(slopeX, fromY) {
  if (fromY === undefined) fromY = SLOPE_FROM_Y;
  const len = Math.hypot(slopeX, 1);
  const tilted = [-slopeX / len, 0, 1 / len], flat = [0, 0, 1];
  return { getTerrainAt: (x, y) => y >= fromY ? { z: slopeX * x, normal: tilted, type: 'GREEN' } : { z: 0, normal: flat, type: 'GREEN' },
           checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
}
// Ett lob wedge-slag (70 mph, 36°, 10 500 rpm) som GSPro skickar det (yards/mph, rpm); ball = BallData-fält
function gsproShot(ball, launch) {
  return { DeviceID: 'X', Units: 'Yards', ShotNumber: 1, APIversion: '1',
    BallData: Object.assign(launch || { Speed: 70, VLA: 36, HLA: 0 }, ball),
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, IsHeartBeat: false } };
}
function lmShot(ball, slopeX, fromY, shot) {
  const norm = P.normalizeShot(gsproShot(ball, shot));
  const input = Object.assign({}, norm, { isLiveData: true, startPos: [0, 0, 0] });
  const r = sim(input, greenEnv(slopeX || 0, fromY));
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
  // (med Penners studs, ca 0,3 m hög i stället för 2-4 m, är kicken mindre än förut: 0,30 m här)
  check('fade kickar åt höger efter landning', kf > 0.2, '(' + kf.toFixed(2) + ' m)');
  check('draw kickar åt vänster efter landning', kd < -0.2, '(' + kd.toFixed(2) + ' m)');
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

console.log('\nLutande green, studsen: första nedslaget på en lutande yta ändrar fade-kicken');
{
  const shotOn = slope => lmShot({ BackSpin: 10500, SideSpin: 1500 }, slope);
  const flat = shotOn(0), down = shotOn(-0.03), up = shotOn(0.03);
  const kick = r => r.endX - r.landX;   // förflyttning i sidled efter första markkontakten
  check('landningen påverkas inte av lutningen (den börjar först vid landningsområdet)',
        Math.abs(down.landX - flat.landX) < 0.1 && Math.abs(up.landX - flat.landX) < 0.1,
        '(' + down.landX.toFixed(2) + ' / ' + flat.landX.toFixed(2) + ' / ' + up.landX.toFixed(2) + ' m)');
  check('fade nedför höger-sluttning kickar längre åt höger än på plan', kick(down) > kick(flat) + 0.15,
        '(' + kick(down).toFixed(2) + ' vs ' + kick(flat).toFixed(2) + ' m)');
  check('fade uppför höger-sluttning kickar kortare åt höger än på plan', kick(up) < kick(flat) - 0.1,
        '(' + kick(up).toFixed(2) + ' vs ' + kick(flat).toFixed(2) + ' m)');
}

console.log('\nLutande green, rullen: bump-and-run från monitorn rullar nedför en sluttning som börjar efter landningen');
{
  // Låg bana (40 mph, 10°, 2 000 rpm + lite fade) som landar och rullar långt. Lutningen börjar 1 m efter landningen, så nedslaget
  // är plant och det som drar bollen i sidled är bara lutningens acceleration under rullen (gParallel i evaluateState).
  const LAUNCH = { Speed: 40, VLA: 10, HLA: 0 }, BALL = { BackSpin: 2000, SideSpin: 300 };
  const flat = lmShot(BALL, 0, 1e9, LAUNCH);
  const fromY = flat.landY + 1;
  const down = lmShot(BALL, -0.03, fromY, LAUNCH), up = lmShot(BALL, 0.03, fromY, LAUNCH);
  check('landningen är plan och lika i alla fall', Math.abs(down.landX - flat.landX) < 0.05 && Math.abs(up.landX - flat.landX) < 0.05);
  check('rullar nedför höger-sluttning (åt höger) mer än 3 m från plan bana', down.endX > flat.endX + 3,
        '(' + down.endX.toFixed(2) + ' vs ' + flat.endX.toFixed(2) + ' m)');
  check('rullar nedför vänster-sluttning (åt vänster) mer än 3 m från plan bana', up.endX < flat.endX - 3,
        '(' + up.endX.toFixed(2) + ' vs ' + flat.endX.toFixed(2) + ' m)');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
