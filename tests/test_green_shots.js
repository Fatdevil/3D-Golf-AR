/**
 * Inspel, chippar och puttar på greenen (physics.js only, no browser).
 * Chipparna har spelets egna ingångsvärden: de kommer från arcade-swing-engine.js (tests/load_swing_engine.js).
 * Run: node tests/test_green_shots.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const G = global.window.GolfPhysics;

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
// slope: stigning per meter längs +y; cup: [x, y, z] eller null
function greenEnv(slope, cup) {
  const len = Math.hypot(slope, 1);
  const normal = [0, -slope / len, 1 / len];
  const env = { getTerrainAt: (x, y) => ({ z: slope * y, normal, type: 'GREEN' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
  if (cup) env.cupPositionLocal = cup;
  return env;
}
// spelets kraft -> slag: swing-motorns egen mappning (rakt mot måls mitt, inget slumpbrus)
const SWING = require('./load_swing_engine.js')();
function gameShot(club, power) {
  const d = SWING.mapCircleToPhysics(power, 0, club, 0);
  return Object.assign({}, d, { startPos: [0, 0, 0] });
}
function chip(club, power, firmness, slope) {
  window.matchSettings.greenFirmness = firmness || 'NORMAL';
  const r = sim(gameShot(club, power), greenEnv(slope || 0));
  const f = r.path[r.path.length - 1];
  return { carry: r.metrics.carryMeters, end: f.y, side: f.x, phase: f.phase, time: f.time };
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

console.log('Chippar (lob/sand/pitch, 10-40 % kraft) på green: bollen rullar aldrig bakåt förbi startpunkten');
for (const firm of ['SOFT', 'NORMAL', 'FIRM']) {
  for (const club of ['LW', 'SW', 'PW']) {
    for (const p of [0.1, 0.15, 0.2, 0.3, 0.4]) {
      const r = chip(club, p, firm);
      check(club + ' ' + p * 100 + ' % ' + firm + ' landar och stannar framför start',
            r.carry > 1 && r.end >= r.carry - 1.0 && r.phase === 'stopped',
            '(carry ' + r.carry.toFixed(1) + ' m, slut ' + r.end.toFixed(1) + ' m)');
    }
  }
}

console.log('\nMer kraft ger längre chip');
for (const firm of ['SOFT', 'NORMAL', 'FIRM']) {
  for (const club of ['LW', 'SW', 'PW']) {
    let prev = -Infinity, mono = true;
    for (const p of [0.1, 0.15, 0.2, 0.3, 0.4, 0.55, 0.7]) { const e = chip(club, p, firm).end; if (e <= prev) mono = false; prev = e; }
    check(club + ' ' + firm + ': slutläget växer med kraften', mono);
  }
}

console.log('\nGreenens hårdhet: hårdare green ger längre utrullning');
{
  const soft = chip('SW', 0.7, 'SOFT'), norm = chip('SW', 0.7, 'NORMAL'), firm = chip('SW', 0.7, 'FIRM');
  const roll = r => r.end - r.carry;
  check('SW 70 %: SOFT < NORMAL < FIRM i utrullning', roll(soft) < roll(norm) && roll(norm) < roll(firm),
        '(' + roll(soft).toFixed(1) + ' < ' + roll(norm).toFixed(1) + ' < ' + roll(firm).toFixed(1) + ' m)');
  check('SW 70 % NORMAL rullar framåt 1-8 m', roll(norm) > 1 && roll(norm) < 8, '(' + roll(norm).toFixed(1) + ' m)');
}

console.log('\nFullslag med mycket spinn: backspinn bromsar, men bara någon meter');
{
  const lw = chip('LW', 1.0, 'NORMAL'), sw = chip('SW', 1.0, 'NORMAL');
  check('LW 100 % NORMAL spinner tillbaka 0,5-5 m', lw.carry - lw.end > 0.5 && lw.carry - lw.end < 5, '(' + (lw.carry - lw.end).toFixed(1) + ' m)');
  check('SW 100 % NORMAL ligger inom -3..+3 m från nedslaget', Math.abs(sw.end - sw.carry) < 3, '(' + (sw.end - sw.carry).toFixed(1) + ' m)');
  check('LW 100 % SOFT spinner mer tillbaka än FIRM', chip('LW', 1.0, 'SOFT').end - chip('LW', 1.0, 'SOFT').carry < chip('LW', 1.0, 'FIRM').end - chip('LW', 1.0, 'FIRM').carry);
}

console.log('\nBump-and-run (låg loft, lite spinn) behåller farten');
{
  window.matchSettings.greenFirmness = 'NORMAL';
  const r = sim({ ballSpeedMph: 14, launchAngleDeg: 8, totalSpinRpm: 2000, spinAxisDeg: 0, azimDeg: 0, startPos: [0, 0, 0], isLiveData: true }, greenEnv(0));
  const f = r.path[r.path.length - 1];
  check('14 mph / 8° / 2000 rpm rullar ut minst 5 m efter nedslaget', f.y - r.metrics.carryMeters > 5, '(' + (f.y - r.metrics.carryMeters).toFixed(1) + ' m)');
}

console.log('\nLutning: bollen blir bara liggande om rullmotståndet håller emot');
function uphillStop(slope) {                        // en putt som inte når toppen: stannar den eller rullar den tillbaka?
  const r = sim({ startPos: [0, 0, 0.022], ballSpeedMph: 1.0 / 0.44704, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0 }, greenEnv(slope));
  const maxY = Math.max.apply(null, r.path.map(q => q.y));
  return { maxY: maxY, end: r.path[r.path.length - 1].y };
}
{
  const mu = G.greenMu(10);                          // 0,056
  const gentle = uphillStop(0.03), steep = uphillStop(0.08);
  check('3 % (flackare än mu ' + mu.toFixed(3) + '): bollen stannar vid toppen', Math.abs(gentle.end - gentle.maxY) < 0.02,
        '(max ' + gentle.maxY.toFixed(2) + ', slut ' + gentle.end.toFixed(2) + ' m)');
  check('8 % (brantare än mu): bollen rullar tillbaka förbi start', steep.end < 0 && steep.end < steep.maxY - 0.5,
        '(max ' + steep.maxY.toFixed(2) + ', slut ' + steep.end.toFixed(2) + ' m)');
}

console.log('\nHålning: fångsttröskeln gäller färdlinjens avstånd till hålets mitt, inte avståndet vid upptäckten');
function putt(arrivalMs, offset) {                   // cup 3 m bort; farten vid hålet blir ca arrivalMs
  const a = G.greenMu(10) * 9.81, v0 = Math.sqrt(arrivalMs * arrivalMs + 2 * a * 3);
  const r = sim({ startPos: [0, 0, 0.022], ballSpeedMph: v0 / 0.44704, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0 }, greenEnv(0, [offset, 3, 0]));
  return !!r.metrics.holed;
}
{
  for (const off of [0, 0.03, 0.05]) check('0,6 m/s hålar, linje ' + (off * 100) + ' cm från mitten', putt(0.6, off));
  check('1,2 m/s dödcentrerat hålar (tröskel 1,63 vid mitten)', putt(1.2, 0));
  check('1,2 m/s 5 cm vid kanten hålar inte (tröskel ca 1,0)', !putt(1.2, 0.05));
  check('2,2 m/s hålar aldrig', !putt(2.2, 0) && !putt(2.2, 0.03));
}

console.log('\nHålning: ingen putt fastnar vid koppen (en boll som passerat mitten fångas inte om på utgångskanten)');
{
  const a = G.greenMu(10) * 9.81;
  let stuck = [], total = 0;
  for (const arrival of [0.8, 1.0, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.0, 2.4]) {
    for (const off of [0, 0.01, 0.02, 0.03, 0.05, 0.07]) {
      const v0 = Math.sqrt(arrival * arrival + 2 * a * 3);
      const r = sim({ startPos: [0, 0, 0.022], ballSpeedMph: v0 / 0.44704, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0 }, greenEnv(0, [off, 3, 0]));
      const f = r.path[r.path.length - 1];
      total++;
      if (f.time >= 24.9 || (f.phase !== 'stopped' && f.phase !== 'holed')) stuck.push(arrival + ' m/s, ' + off * 100 + ' cm (fas ' + f.phase + ', ' + f.time.toFixed(1) + ' s)');
    }
  }
  check('alla ' + total + ' puttar över hålet slutar i stopped/holed före tidsgränsen', stuck.length === 0, stuck.length ? '(fastnade: ' + stuck.join('; ') + ')' : '');
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
