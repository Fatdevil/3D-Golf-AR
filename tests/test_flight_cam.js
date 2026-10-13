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
  const rig = FC.create(path, camStart, { ground: opts.ground, fov: 60, obstacles: opts.obstacles, pin: opts.pin });
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
check('a driver is a long shot, a wedge an approach, a 7-iron one of the two', prof.driver === 'long' && prof.wedge === 'approach' && (prof.iron7 === 'approach' || prof.iron7 === 'long'), JSON.stringify(prof));
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
check('the zoom never goes narrower than the profile allows (17° for a drive: the ball must not whip about)', Math.min(...fovs) >= 17 - 0.5, Math.min(...fovs).toFixed(1));
check('an approach zooms less than a drive (22°) and a chip least (28°)', (() => { const a = play('wedge', 60), c = play('chip', 60); return Math.min(...a.frames.map(f => f.st.fov)) >= 22 - 0.5 && Math.min(...c.frames.map(f => f.st.fov)) >= 28 - 0.5; })());
check('after the hand-over the picture is wider again (about 0.72 of the lens)', Math.abs(D60.frames[D60.frames.length - 1].st.fov - 60 * 0.72) < 2, D60.frames[D60.frames.length - 1].st.fov.toFixed(1));

// ---- slow motion
const sp = (name) => { const r = play(name, 60); return Math.min(...r.frames.map(f => f.sp)); };
check('slow motion around the landing of a full shot, deeper for an approach (0.35) than for a drive (0.45)', Math.abs(sp('driver') - 0.45) < 0.02 && Math.abs(sp('wedge') - 0.35) < 0.02, sp('driver') + ' ' + sp('wedge'));
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

// ---- the page uses it
const html = require('fs').readFileSync(__dirname + '/../arcade.html', 'utf8');
check('arcade.html loads arcade-flight-cam.js', /<script src="arcade-flight-cam\.js/.test(html));
check('the rig is made when the flight starts to play, only in AUTO camera mode', /window\.FlightCam && window\.camFollowMode === 'AUTO' && gameCamPhase === 'FLIGHT_FOLLOW'/.test(html) && /window\._flightRig = window\.FlightCam\.create\(flightData\.path/.test(html));
check('the ball is played back at the slow-motion speed of the plan', /speedMultiplier \*= window\.FlightCam\.speedAt\(window\._flightRig\.plan/.test(html));
check('the camera follows the rig with the real frame time, and the old chase camera stays for putts (no rig)', /window\.FlightCam\.step\(window\._flightRig, frameDeltaMs \/ 1000/.test(html) && /else if \(gameCamPhase === 'FLIGHT_FOLLOW'\) \{\s*let shotDir/.test(html));
check('a glowing dot of fixed screen size marks the ball from the tee, hidden when the flight is over', /_ballBeacon/.test(html) && /sizeAttenuation: false/.test(html) && /!isFlying && window\._ballBeacon && window\._ballBeacon\.visible/.test(html));
check('the lens goes back to its normal width after the flight', /window\._flightBaseFov/.test(html) && /camera\.fov \+= \(window\._flightBaseFov - camera\.fov\)/.test(html));
check('after the flight there is a result beat and the look point glides to the aim point', /_aimHoldUntil = performance\.now\(\) \+ 600/.test(html) && /_aimLookBlend\.lerp\(window\.aimTarget/.test(html));

// ---- trees on the way (obstacles)
const TREES = (() => {   // a row of tall trees across the hand-over arc, one right at the landing view, one at the tee cam's side
  const out = [], a = D60.plan, steps = 24;
  for (let i = 3; i <= steps - 3; i += 4) { const e = i / steps; out.push({ x: a.H.x + (a.L.x - a.H.x) * e, z: a.H.z + (a.L.z - a.H.z) * e, r: 6, top: 28 }); }
  out.push({ x: a.L.x + 1, z: a.L.z - 1, r: 7, top: 34 });
  return out;
})();
const TR = play('driver', 60, { obstacles: TREES });
const clearOK = TR.frames.every(f => TREES.every(o => Math.hypot(f.st.pos.x - o.x, f.st.pos.z - o.z) >= o.r + 1.5 || f.st.pos.y >= o.top + 1.8 - 1e-6));
check('the camera stays above every tree it passes over (top + 1.8 m), also at the landing view', clearOK);
check('...and the lift is smooth: the camera never climbs faster than 120 m/s', (() => { let w = 0; for (let i = 1; i < TR.frames.length; i++) w = Math.max(w, Math.abs(TR.frames[i].st.pos.y - TR.frames[i - 1].st.pos.y) / (TR.frames[i].real - TR.frames[i - 1].real)); return w <= 120; })());
check('...and the ball is still on screen (98 %) and the turning stays smooth (3 rad/s) with the trees', (() => { const v = visibility(TR, 16 / 9, TR.an.tLand + 0.5); let m = 0; for (let i = 1; i < TR.frames.length; i++) m = Math.max(m, angSpeed(TR.frames[i - 1], TR.frames[i], TR.frames[i].real - TR.frames[i - 1].real)); return v.ok >= 0.98 && m <= 3.0; })());
check('without trees nothing changes (no lift)', D60.plan.lift === null && play('driver', 60, { obstacles: [] }).plan.lift === null);

// ---- the pin stays in the picture after an approach
function pinTest(pinOffsetAlong, pinOffsetSide) {
  const w = FLIGHTS.wedge.path, an0 = FC.analyze(w);
  const pin = { x: an0.land.x + an0.dir.x * pinOffsetAlong + (-an0.dir.z) * pinOffsetSide, y: 0, z: an0.land.z + an0.dir.z * pinOffsetAlong + an0.dir.x * pinOffsetSide };
  const base = play('wedge', 60), withPin = play('wedge', 60, { pin: pin });
  const inShot = (res) => { let n = 0, ok = 0; for (const f of res.frames) { if (f.t < res.plan.an.tLand + 0.3) continue; n++; const b = FC.project(f.st, f.ball, 16 / 9), q = FC.project(f.st, pin, 16 / 9); if (b.z > 0 && q.z > 0 && Math.abs(b.x) < 0.95 && Math.abs(b.y) < 0.95 && Math.abs(q.x) < 0.95 && Math.abs(q.y) < 0.95) ok++; } return n ? ok / n : 0; };
  return { without: inShot(base), with: inShot(withPin), near: withPin.plan.pinNear };
}
const pins = [pinTest(30, 15), pinTest(34, 5), pinTest(20, 25), pinTest(10, 30)];   // the last two: a pin well to the side, which the ball alone would not bring into the picture
console.log('pin in picture, ball and pin together, after the landing (without/with): ' + pins.map(x => x.without.toFixed(2) + '/' + x.with.toFixed(2)).join('  '));
check('a pin close to the landing point is picked up (pinNear), a far one is not', pins.every(x => x.near) && !pinTest(80, 0).near);
check('ball and pin are in the picture together in 90 % of the frames after the landing', pins.every(x => x.with >= 0.9), JSON.stringify(pins));
check('...and that is not worse than without the pin framing', pins.every(x => x.with >= x.without - 0.02), JSON.stringify(pins));
check('with a pin well to the side the picture is better with the pin framing than without (0 -> 1)', pins.slice(2).every(x => x.without < 0.5 && x.with >= 0.9), JSON.stringify(pins.slice(2)));

// ---- the page uses the new parts
check('the page gives the rig the trees and the pin', /obstacles: /.test(html) && /pin: /.test(html));
check('a tap or a key skips the flight (after the first half second)', /window\.skipFlight = function/.test(html) && /performance\.now\(\) - window\._flightStartTime < 500/.test(html));

check('a skipped flight still hits the blocks on the rest of its path', /for \(let i = Math\.max\(0, flightTick \| 0\); i < path\.length; i \+= 3\)/.test(html) && /hitTargetBlock\(b\)/.test(html) && /if\(d < t\.radius\) hitTargetBlock\(t\);/.test(html));
check('the block score is declared (hitting a block used to throw: points was never declared)', /\n    let points = 0;/.test(html));
check('the height of a tree for the camera includes the baked model offset', /top: \(o\.y \|\| 0\) \+ h \+ baked \* sc \+ \(o\.yOffset \|\| 0\)/.test(html));

console.log(failed ? '\n' + failed + ' failed' : '\nall flight-camera checks passed');
process.exit(failed ? 1 : 0);
