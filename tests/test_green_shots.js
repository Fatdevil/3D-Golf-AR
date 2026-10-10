/**
 * Inspel, chippar och puttar på greenen (physics.js only, no browser).
 * Chipparna har spelets egna ingångsvärden (arcade-swing-engine: klubbornas toppfart, loft och spinn skalas med kraften).
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
// spelets kraft -> slag (samma formler som mapCircleToPhysics)
const CLUBS = { LW: [72, 36, 10800], SW: [85, 32, 10200], PW: [103, 26, 9300] };
function gameShot(club, power) {
  const c = CLUBS[club];
  return { ballSpeedMph: Math.max(c[0] * power, 10), launchAngleDeg: c[1] + (Math.abs(power - 0.85) > 0.2 ? -1.5 : 0),
           totalSpinRpm: c[2] * (0.7 + 0.3 * power), spinAxisDeg: 0, azimDeg: 0, startPos: [0, 0, 0], isLiveData: false };
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
  const soft = chip('PW', 0.55, 'SOFT'), norm = chip('PW', 0.55, 'NORMAL'), firm = chip('PW', 0.55, 'FIRM');
  const roll = r => r.end - r.carry;
  check('PW 55 %: SOFT < NORMAL < FIRM i utrullning', roll(soft) < roll(norm) && roll(norm) < roll(firm),
        '(' + roll(soft).toFixed(1) + ' < ' + roll(norm).toFixed(1) + ' < ' + roll(firm).toFixed(1) + ' m)');
  check('PW 55 % NORMAL rullar framåt (1-15 m)', roll(norm) > 1 && roll(norm) < 15);
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

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
