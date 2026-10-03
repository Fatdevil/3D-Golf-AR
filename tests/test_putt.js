/**
 * Putt roll regression test (physics.js only, no browser).
 * A putt on a flat or sloped GREEN must roll roughly the distances below, further downhill and shorter uphill,
 * and a faster putt must always roll further. Distances are the engine's current behaviour at stimp 10, within 10 %.
 * Run: node tests/test_putt.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;

function roll(mph, slope) {                  // slope: rise per metre along the putt direction (+y)
  const len = Math.hypot(slope, 1);
  const normal = [0, -slope / len, 1 / len];
  const env = { getTerrainAt: (x, y) => ({ z: slope * y, normal, type: 'GREEN' }), wind: [0, 0, 0] };
  const log = console.log; console.log = function () {};
  const r = G.simulateFlight({ startPos: [0, 0, 0.022], ballSpeedMph: mph, launchAngleDeg: 1.5, totalSpinRpm: 300,
                               spinAxisDeg: 0, azimDeg: 0, isLiveData: false, isTeeShot: false }, env);
  console.log = log;
  const f = r.path[r.path.length - 1];
  return Math.hypot(f.x, f.y);
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
function near(name, got, want, tol) {
  check(name, Math.abs(got - want) <= tol * want, '(' + got.toFixed(2) + ' m, expected ' + want + ' m ±' + Math.round(tol * 100) + ' %)');
}

console.log('Putt roll distances, stimp 10');
near('4 mph flat', roll(4, 0), 3.18, 0.10);
near('6 mph flat', roll(6, 0), 6.90, 0.10);
near('8 mph flat', roll(8, 0), 11.86, 0.10);
near('6 mph uphill 3 %', roll(6, 0.03), 4.53, 0.10);
near('6 mph downhill 3 %', roll(6, -0.03), 14.14, 0.10);

let prev = 0, mono = true;
for (const mph of [1, 2, 3, 4, 6, 8, 12]) { const d = roll(mph, 0); if (d <= prev) mono = false; prev = d; }
check('faster putt always rolls further', mono);
check('uphill < flat < downhill at 4 mph', roll(4, 0.03) < roll(4, 0) && roll(4, 0) < roll(4, -0.03));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
