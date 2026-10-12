/**
 * Putt break and lip-outs (physics.js only, no browser).
 * - A rolling ball gets 5/7 of the slope's pull (a solid ball spins as it rolls): the break at 10-ft pace must match an independent integration of a
 *   rolling sphere (constant rolling deceleration, 5/7 g down the slope), not a sliding point mass (which breaks 40-70 % more).
 * - A ball that clips the rim deflects past the hole and keeps most of its speed; it is not thrown sideways and left lying at the rim.
 * Run: node tests/test_putt_break.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics, MPH = 0.44704;
Math.random = () => 0.5;
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

function putt(v, o) {
  o = o || {};
  const sx = o.slopeX || 0, sy = o.slopeY || 0, nl = Math.hypot(sx, sy, 1), N = [-sx / nl, -sy / nl, 1 / nl];
  const env = { getTerrainAt: (x, y) => ({ z: sx * x + sy * y, normal: N, type: 'GREEN' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15, cupPositionLocal: o.cup || null };
  const log = console.log; console.log = () => {};
  try { return G.simulateFlight({ startPos: [0, 0, 0], azimDeg: o.azim || 0, spinAxisDeg: 0, ballSpeedMph: v / MPH, launchAngleDeg: 0, totalSpinRpm: 0, isLiveData: true }, env); }
  finally { console.log = log; }
}
function ref(v0, sx, sy, k) {   // rolling sphere, rolling deceleration 0.056 g, slope pull k g sin
  const a = 0.056 * 9.81; let x = 0, y = 0, vx = 0, vy = v0, t = 0; const dt = 0.0005, nl = Math.hypot(sx, sy, 1);
  const gx = k * 9.81 * (-sx) / (nl * nl), gy = k * 9.81 * (-sy) / (nl * nl);
  while (t < 20) { const v = Math.hypot(vx, vy); if (v < 0.02 && Math.hypot(gx, gy) < a) break; const fx = v > 0 ? -a * vx / v : 0, fy = v > 0 ? -a * vy / v : 0; vx += (gx + fx) * dt; vy += (gy + fy) * dt; x += vx * dt; y += vy * dt; t += dt; }
  return { x: x, y: y };
}
function end(r) { return r.path[r.path.length - 1]; }

console.log('Break at 10-ft pace (1.83 m/s), stimp 10, against a rolling sphere');
for (const sl of [0.01, 0.02, 0.03]) {
  const g = end(putt(1.83, { slopeX: sl })), rr = ref(1.83, sl, 0, 5 / 7), pm = ref(1.83, sl, 0, 1);
  check((sl * 100) + ' % cross slope: break within 15 % of the rolling sphere', Math.abs(g.x - rr.x) <= 0.15 * Math.abs(rr.x), 'game ' + g.x.toFixed(3) + ' rolling ' + rr.x.toFixed(3) + ' point mass ' + pm.x.toFixed(3));
}
{
  const g = end(putt(1.83, { slopeY: -0.02 })), rr = ref(1.83, 0, -0.02, 5 / 7);
  check('2 % downhill: within 12 % of the rolling sphere', Math.abs(g.y - rr.y) <= 0.12 * rr.y, 'game ' + g.y.toFixed(2) + ' rolling ' + rr.y.toFixed(2));
}

console.log('\nRim contact (cup 3.0 m ahead, ball arrives ~1.4 m/s on a line 4 cm from the centre)');
{
  const r = putt(2.3, { cup: [0, 3.0], azim: -Math.atan2(0.04, 3.0) * 180 / Math.PI }), p = end(r);
  check('the ball is not holed', !(r.metrics && r.metrics.holed), JSON.stringify(p));
  check('it carries on past the hole (not left lying in front of it)', p.y > 3.3, 'rest y ' + p.y.toFixed(2));
  check('it is deflected, less than a metre off the line', Math.abs(p.x) > 0.05 && Math.abs(p.x) < 1.0, 'rest x ' + p.x.toFixed(2));
}
console.log('\nCapture is unchanged');
{
  const r = putt(1.9, { cup: [0, 3.0] });   // arrives ~0.9 m/s dead centre
  check('a slow ball on the centre line drops', !!(r.metrics && r.metrics.holed), JSON.stringify(end(r)));
  const f = putt(3.2, { cup: [0, 3.0] });   // arrives ~2.7 m/s
  check('a fast ball on the centre line runs over the hole', !(f.metrics && f.metrics.holed) && end(f).y > 4, JSON.stringify(end(f)));
}
if (failed) { console.log('\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)'); process.exit(1); }
console.log('\nOVERALL:  ✅ ALL PASS');
