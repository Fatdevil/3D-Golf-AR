/**
 * Flight camera (arcade-flight-cam.js): a camera plan made from the finished flight (real physics paths, flat ground).
 * Checks the shape of the camera work and measures how good it looks: it must hold still until the apex, fly an arc to a landing view that it
 * reaches before touch-down, keep the ball on screen, stay smooth (angular speed), stay above the ground, look the same at 30 and 144 fps,
 * and slow the ball down around the landing of a full shot only.
 * Run: node tests/test_flight_cam.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
const FC = require('../arcade-flight-cam.js');
const SE = require('./load_swing_engine.js')();
Math.random = () => 0.5;
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

// ---- real flights on flat ground, hit towards -Z (physics +y is -Z in THREE space, so the shot runs along physics +y)
function flight(club, power) {
  const d = SE.mapCircleToPhysics(power, 0, club, 100);
  const env = { getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
  const log = console.log; console.log = () => {};
  try { return G.simulateFlight({ startPos: [0, 0, 0.3], azimDeg: 0, spinAxisDeg: 0, ballSpeedMph: d.ballSpeedMph, launchAngleDeg: d.launchAngleDeg, totalSpinRpm: d.totalSpinRpm, isLiveData: false, isTeeShot: true }, env); }
  finally { console.log = log; }
}
const FLIGHTS = { driver: flight('DRIVER', 1), iron7: flight('I7', 0.9), wedge: flight('PW', 0.8), chip: flight('SW', 0.3), putt: flight('PUTT', 0.5) };

// ball position along the path at path time t (interpolated, THREE space)
function ballAt(path, t) {
  const k = t / 0.005, i = Math.min(path.length - 2, Math.max(0, Math.floor(k))), f = Math.min(1, Math.max(0, k - i)), a = path[i], b = path[i + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.z + (b.z - a.z) * f, z: -(a.y + (b.y - a.y) * f) };
}
const addGround = (g) => g || (() => 0);

// plays a flight through the rig like the game does: real dt per frame, path time advances by dt * speed
function play(name, fps, opts) {
  opts = opts || {};
  const path = FLIGHTS[name].path, an = FC.analyze(path);
  const camStart = { x: 0, y: 2, z: 5 };   // 5 m behind the ball (the aim camera), 2 m up
  const rig = FC.create(path, camStart, { ground: opts.ground, fov: 60 });
  if (!rig) return { rig: null, an: an };
  const frames = []; let t = 0, real = 0, prev = null;
  const dt = 1 / fps;
  while (t < an.tLand + 3 && t < an.tEnd) {
    const sp = FC.speedAt(rig.plan, t);
    t += Math.min(dt, 0.05) * sp; real += dt;
    const ball = ballAt(path, Math.min(t, an.tEnd));
    const st = FC.step(rig, dt, t, ball);
    frames.push({ t: t, real: real, st: st, ball: ball, sp: sp });
  }
  return { rig: rig, an: an, frames: frames, plan: rig.plan };
}
const angSpeed = (f0, f1, dt) => {
  const dir = (s) => { const v = { x: s.look.x - s.pos.x, y: s.look.y - s.pos.y, z: s.look.z - s.pos.z }, l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const a = dir(f0.st), b = dir(f1.st);
  return Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))) / dt;
};

// ---- classification
const prof = {}; for (const k of Object.keys(FLIGHTS)) prof[k] = FC.profile(FC.analyze(FLIGHTS[k].path));
console.log('profiles', JSON.stringify(prof));
check('driver, 7-iron and wedge are full shots', prof.driver === 'full' && prof.iron7 === 'full' && prof.wedge === 'full', JSON.stringify(prof));
check('a chip is a short shot', prof.chip === 'short', prof.chip);
check('a putt keeps the old chase camera (ground)', prof.putt === 'ground' && FC.create(FLIGHTS.putt.path, { x: 0, y: 1, z: 3 }) === null, prof.putt);

// ---- shape of the camera work (driver)
const D60 = play('driver', 60), pl = D60.plan, an = D60.an;
console.log('driver: carry ' + an.carry.toFixed(0) + ' m, apex ' + an.apexH.toFixed(1) + ' m at ' + an.tApex.toFixed(2) + ' s, lands ' + an.tLand.toFixed(2) + ' s; handover ' + pl.tHandStart.toFixed(2) + '-' + pl.tHandEnd.toFixed(2) + ' s, landing view ' + pl.L.x.toFixed(0) + ',' + pl.L.y.toFixed(0) + ',' + pl.L.z.toFixed(0));
check('the camera holds still until the apex (tee cam)', D60.frames.filter(f => f.t < pl.tHandStart).every(f => Math.abs(f.st.pos.x - pl.H.x) < 1e-9 && Math.abs(f.st.pos.z - pl.H.z) < 1e-9 && Math.abs(f.st.pos.y - pl.H.y) < 1e-9));
check('the hand-over starts at the apex (not before)', Math.abs(pl.tHandStart - Math.min(an.tApex, an.tLand * 0.6)) < 1e-9 && pl.tHandStart >= an.tApex - 1e-9);
check('the camera has arrived at the landing view before the ball lands', pl.tHandEnd < an.tLand - 0.1 && (() => { const f = D60.frames.find(f => f.t >= pl.tHandEnd); return Math.hypot(f.st.pos.x - pl.L.x, f.st.pos.y - pl.L.y, f.st.pos.z - pl.L.z) < 1.5; })());
const toL = Math.hypot(pl.L.x - pl.H.x, pl.L.z - pl.H.z);
check('the landing view is before the landing point, above and a little to the side', (() => { const dx = an.land.x - pl.L.x, dz = an.land.z - pl.L.z; const along = dx * an.dir.x + dz * an.dir.z; const lat = Math.abs(dx * pl.side.x + dz * pl.side.z); return along > 10 && pl.L.y > an.land.y + 3 && lat > 1; })());
check('the path of the camera is an arc (it leaves the straight line between start and landing view)', (() => { const mid = D60.frames.find(f => f.t >= (pl.tHandStart + pl.tHandEnd) / 2).st.pos; return Math.hypot(mid.x - (pl.H.x + pl.L.x) / 2, mid.y - (pl.H.y + pl.L.y) / 2, mid.z - (pl.H.z + pl.L.z) / 2) > 3; })());

// ---- the ball stays on screen
function visibility(res, aspect, tMax) {
  let n = 0, ok = 0, central = 0, minPx = 1e9;
  for (const f of res.frames) {
    if (f.t > tMax) break;
    const q = FC.project(f.st, f.ball, aspect); n++;
    if (q.z > 0 && Math.abs(q.x) < 0.95 && Math.abs(q.y) < 0.95) ok++;
    if (q.z > 0 && Math.abs(q.x) < 0.6 && Math.abs(q.y) < 0.6) central++;
    minPx = Math.min(minPx, 0.0427 / q.z / (2 * Math.tan(f.st.fov * Math.PI / 360)) * 1080);
  }
  return { n: n, ok: ok / n, central: central / n, minPx: minPx };
}
const vis = {}; for (const k of ['driver', 'iron7', 'wedge', 'chip']) { const r = play(k, 60); vis[k] = { land: visibility(r, 16 / 9, r.an.tLand + 0.5), portrait: visibility(r, 9 / 16, r.an.tLand + 0.5) }; }
console.log('visibility (landscape/portrait): ' + JSON.stringify(vis, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
for (const k of Object.keys(vis)) {
  check(k + ': the ball is on screen in 98 % of the frames up to touch-down (landscape)', vis[k].land.ok >= 0.98, vis[k].land.ok);
  check(k + ': ...and in the central part of the picture in 90 % of them', vis[k].land.central >= 0.9, vis[k].land.central);
  check(k + ': ...also in portrait (95 %)', vis[k].portrait.ok >= 0.95, vis[k].portrait.ok);
}

// ---- smooth
const SMOOTH = {};
for (const k of ['driver', 'iron7', 'wedge', 'chip']) {
  const r = play(k, 60); let maxAng = 0, maxSpeed = 0;
  for (let i = 1; i < r.frames.length; i++) {
    const dtR = r.frames[i].real - r.frames[i - 1].real;
    maxAng = Math.max(maxAng, angSpeed(r.frames[i - 1], r.frames[i], dtR));
    const a = r.frames[i - 1].st.pos, b = r.frames[i].st.pos; maxSpeed = Math.max(maxSpeed, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / dtR);
  }
  SMOOTH[k] = { maxAng: +maxAng.toFixed(2), maxSpeed: +maxSpeed.toFixed(0) };
}
console.log('smoothness (rad/s, m/s): ' + JSON.stringify(SMOOTH));
for (const k of Object.keys(SMOOTH)) check(k + ': the camera never turns faster than 3 rad/s (no whip)', SMOOTH[k].maxAng <= 3.0, SMOOTH[k].maxAng);
check('no teleport: the camera never moves faster than 250 m/s', Object.values(SMOOTH).every(s => s.maxSpeed <= 250), JSON.stringify(SMOOTH));

// ---- the same at every frame rate
const at = (res, t) => res.frames.reduce((b, f) => Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b, res.frames[0]);
const R30 = play('driver', 30), R144 = play('driver', 144);
const tCheck = [an.tApex + 0.3, (pl.tHandStart + pl.tHandEnd) / 2, pl.tHandEnd + 0.1];
check('the camera is in the same place at 30, 60 and 144 fps (within 6 m)', tCheck.every(t => { const a = at(D60, t).st.pos, b = at(R30, t).st.pos, c = at(R144, t).st.pos; return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 6 && Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) < 6; }),
  tCheck.map(t => [at(D60, t).st.pos, at(R30, t).st.pos, at(R144, t).st.pos].map(p => p.x.toFixed(0) + ',' + p.y.toFixed(0) + ',' + p.z.toFixed(0)).join(' | ')).join('  //  '));
check('the zoom is the same at 30 and 144 fps (within 3°)', tCheck.every(t => Math.abs(at(R30, t).st.fov - at(R144, t).st.fov) < 3), tCheck.map(t => at(R30, t).st.fov.toFixed(1) + '/' + at(R144, t).st.fov.toFixed(1)).join(' '));

// ---- zoom
const fovs = D60.frames.map(f => f.st.fov);
check('tee cam: it zooms in as the ball flies away (narrower than the starting 60°)', Math.min(...D60.frames.filter(f => f.t < pl.tHandStart).map(f => f.st.fov)) < 40, Math.min(...fovs).toFixed(1));
check('the zoom never goes narrower than 17° (the ball must not whip about)', Math.min(...fovs) >= 17, Math.min(...fovs).toFixed(1));
check('after the hand-over the picture is wider again (about 0.72 of the lens)', Math.abs(D60.frames[D60.frames.length - 1].st.fov - 60 * 0.72) < 2, D60.frames[D60.frames.length - 1].st.fov.toFixed(1));

// ---- slow motion
const sp = (name) => { const r = play(name, 60); return Math.min(...r.frames.map(f => f.sp)); };
check('slow motion around the landing of a full shot (down to 0.4)', Math.abs(sp('driver') - 0.4) < 0.02 && Math.abs(sp('iron7') - 0.4) < 0.02, sp('driver') + ' ' + sp('iron7'));
check('no slow motion for a chip', sp('chip') === 1, sp('chip'));
check('real time everywhere else (before the window, and long after)', FC.speedAt(pl, 0) === 1 && FC.speedAt(pl, an.tApex) === 1 && FC.speedAt(pl, an.tLand + 2) === 1);
check('slow motion eases in and out (no jump in speed)', (() => { let prev = 1, worst = 0; for (let t = an.tLand - 1; t < an.tLand + 1; t += 0.01) { const s = FC.speedAt(pl, t); worst = Math.max(worst, Math.abs(s - prev)); prev = s; } return worst < 0.05; })());
check('slow motion adds about half a second to the flight at most', (() => { let extra = 0; for (let t = 0; t < an.tLand + 2; t += 0.005) extra += (1 / FC.speedAt(pl, t) - 1) * 0.005; return extra > 0.3 && extra < 1.2; })());

// ---- ground
const hill = (x, z) => Math.max(0, 14 - Math.hypot(x - (pl.L.x - 5), z - (pl.L.z + 5)) * 0.4) + 0;   // a mound where the landing view would be
const HR = play('driver', 60, { ground: hill });
check('the camera stays above the ground (at least 1.6 m) even over a mound', HR.frames.every(f => f.st.pos.y >= hill(f.st.pos.x, f.st.pos.z) + 1.6 - 1e-9));

// ---- short shots
const C = play('chip', 60);
check('a chip hands over earlier and closer: the landing view is within 20 m of the landing point', Math.hypot(C.plan.L.x - C.an.land.x, C.plan.L.z - C.an.land.z) <= 20, '');
check('a chip has a hand-over start no later than its apex', C.plan.tHandStart <= C.an.tApex + 1e-9 || C.plan.tHandStart <= C.an.tLand * 0.6 + 1e-9);

console.log(failed ? '\n' + failed + ' failed' : '\nall flight-camera checks passed');
process.exit(failed ? 1 : 0);
