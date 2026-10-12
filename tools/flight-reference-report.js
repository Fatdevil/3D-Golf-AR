// Reproduces the numbers in docs/ball-flight-reference-report.md. Read-only: it only calls physics.js and the swing engine, and changes nothing.
// Run from the repo root: node tools/flight-reference-report.js
const R = require('path').resolve(__dirname, '..');
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require(R + '/physics.js');
const G = global.window.GolfPhysics, YD = 1.09361, FT = 3.28084;
Math.random = () => 0.5;
const SE = require(R + '/tests/load_swing_engine.js')();

function fly(v, la, sp, env) {
  env = env || {};
  const e = { getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: env.t === undefined ? 15 : env.t, altitudeFeet: env.alt || 0 };
  const log = console.log; console.log = () => {};
  const r = G.simulateFlight({ startPos: [0, 0, 0], azimDeg: 0, spinAxisDeg: 0, ballSpeedMph: v, launchAngleDeg: la, totalSpinRpm: sp, isLiveData: true, isTeeShot: false }, e);
  console.log = log;
  const p = r.path; let i = 1; while (i < p.length && p[i].phase === 'flight') i++;
  const q = p[i - 1];
  return { carry: r.metrics.carryMeters * YD, apex: r.metrics.apexMeters * YD, land: Math.atan2(-q.vz, Math.hypot(q.vx, q.vy)) * 180 / Math.PI, hang: q.time, total: r.metrics.totalMeters * YD };
}
const f1 = x => x.toFixed(1), f0 = x => x.toFixed(0);
function solveLaunch(v, sp, carryTarget, env) { let lo = 3, hi = 40; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (fly(v, mid, sp, env).carry < carryTarget) lo = mid; else hi = mid; } return (lo + hi) / 2; }

const TOUR = [  // Golf Monthly's table of Trackman's 2023 PGA Tour averages (see the report for the source)
  { club: 'Driver', clubSpeed: 115, ball: 171, spin: 2545, carry: 282, launch: null },
  { club: '7-iron', clubSpeed: 92, ball: 123, spin: 7124, carry: 176, launch: 16.2 },   // launch: Golf Digest citing Trackman, "a shade over 16 degrees", undated
  { club: 'PW', clubSpeed: 84, ball: 104, spin: 9316, carry: 142, launch: null },
];
const ENVS = [{ n: '15 C, 0 ft (engine default)', t: 15, alt: 0 }, { n: '25 C, 0 ft', t: 25, alt: 0 }, { n: '25 C, 1000 ft', t: 25, alt: 1000 }];

console.log('## A. Sourced Tour inputs run through the engine (no wind, flat, no lie)\n');
console.log('| Club | Ball mph | Spin rpm | Launch used | Env | Engine carry yd | Tour carry yd | Diff |');
console.log('|---|---|---|---|---|---|---|---|');
for (const t of TOUR) if (t.launch) for (const e of ENVS) { const o = fly(t.ball, t.launch, t.spin, e); console.log(`| ${t.club} | ${t.ball} | ${t.spin} | ${t.launch} (sourced) | ${e.n} | ${f1(o.carry)} | ${t.carry} | ${((o.carry / t.carry - 1) * 100).toFixed(1)} % |`); }

console.log('\n## B. Highest carry the engine can reach with the sourced ball speed and spin, over every launch angle 3-40 deg (15 C, 0 ft)\n');
console.log('| Club | Ball mph | Spin rpm | Max engine carry yd | At launch deg | Tour carry yd | Diff at best launch |');
console.log('|---|---|---|---|---|---|---|');
for (const t of TOUR) { let best = { carry: 0, la: 0 }; for (let la = 3; la <= 40; la += 0.5) { const o = fly(t.ball, la, t.spin); if (o.carry > best.carry) best = { carry: o.carry, la: la }; } console.log(`| ${t.club} | ${t.ball} | ${t.spin} | ${f1(best.carry)} | ${best.la} | ${t.carry} | ${((best.carry / t.carry - 1) * 100).toFixed(1)} % |`); }

console.log('\n## C. Launch-angle sensitivity (15 C, 0 ft)\n');
console.log('| Club | Launch | Carry yd | Apex yd | Landing deg | Flight s |');
console.log('|---|---|---|---|---|---|');
for (const [n, v, sp, las] of [['Driver', 171, 2545, [9, 10, 11, 12, 13]], ['7-iron', 123, 7124, [15, 16, 17, 18]], ['PW', 104, 9316, [22, 24, 26, 28]]]) for (const la of las) { const o = fly(v, la, sp); console.log(`| ${n} | ${la} | ${f1(o.carry)} | ${f1(o.apex)} | ${f0(o.land)} | ${o.hang.toFixed(1)} |`); }

console.log('\n## D. What the game feeds the engine (CLUB_PROFILES at full power, arm 0, 15 C) against the yard labels in the UI and the Tour carry\n');
console.log('| Club | Ball mph | Launch | Spin | Engine carry yd | UI label yd | Tour carry yd |');
console.log('|---|---|---|---|---|---|---|');
const UI = { DRIVER: 220, W3: 200, I5: 180, I7: 160, I9: 140, PW: 120, SW: 90, LW: 60 }, TOURC = { DRIVER: 282, I7: 176, PW: 142 };
for (const k of ['DRIVER', 'W3', 'I5', 'I7', 'I9', 'PW', 'SW', 'LW']) { const d = SE.mapCircleToPhysics(1, 0, k, 0), o = fly(d.ballSpeedMph, d.launchAngleDeg, d.totalSpinRpm); console.log(`| ${k} | ${f0(d.ballSpeedMph)} | ${d.launchAngleDeg} | ${f0(d.totalSpinRpm)} | ${f1(o.carry)} | ${UI[k]} | ${TOURC[k] || '-'} |`); }

console.log('\n## E. The inputs of the targets in tests/test_physics.js (not Tour averages)\n');
console.log('| Test | Ball mph | Launch | Spin | Engine carry yd | Test target |');
console.log('|---|---|---|---|---|---|');
for (const [n, v, la, sp, tg] of [['Driver', 130, 14, 2000, '210-220'], ['7-iron', 120, 16, 7000, '178-192 (failing)'], ['Wedge', 103, 35, 9000, '125-135']]) { const o = fly(v, la, sp, { t: 25 }); console.log(`| ${n} | ${v} | ${la} | ${sp} | ${f1(o.carry)} (25 C) | ${tg} |`); }

console.log('\n## F. Integrator step (carry yd at 5 / 2.5 / 1.25 ms) - see the separate run: 282.12 / 282.12 / 282.12 (driver), 155.93 / 155.94 / 155.94 (7i), 114.04 x3 (PW).');

console.log('\n## G. Apex height: Trackman says driver and PW apex differ by only about 3 yd/m (Trackman apex-height article, 2023 averages). The engine, 15 C, plausible launch angles:\n');
console.log('| Case | Driver apex yd | PW apex yd | Difference yd | Sourced difference |');
console.log('|---|---|---|---|---|');
for (const [dl, pl] of [[10, 24], [10.5, 25], [11, 26]]) { const d = fly(171, dl, 2545), p = fly(104, pl, 9316); console.log(`| launch ${dl} / ${pl} deg | ${f1(d.apex)} | ${f1(p.apex)} | ${f1(d.apex - p.apex)} | about 3 |`); }
