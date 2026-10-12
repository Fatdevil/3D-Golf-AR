/**
 * Aim maths for game mode (arcade-aim.js): signed offset from the flag, rotating the aim around the ball, when a hand-set aim is kept, tap vs drag.
 * The bearing must match executeArcadeShot (atan2(dX, -dZ)) so that "aim 3° right" in the HUD is the azimuth the shot gets.
 * Run: node tests/test_aim.js
 */
const A = require('../arcade-aim.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

const ball = { x: 0, z: 0 }, flag = { x: 0, z: -150 };
check('straight at the flag: bearing 0 (matches executeArcadeShot)', near(A.bearingDeg(ball, flag), 0), A.bearingDeg(ball, flag));
check('+X is to the right: bearing +90', near(A.bearingDeg(ball, { x: 10, z: 0 }), 90));
check('aim on the flag: offset 0', near(A.offsetFromFlagDeg(ball, flag, flag), 0));

const right = A.rotateAim(ball, { x: 0, z: -100 }, 3);
check('rotate 3° right: now right of the flag line', right.x > 0 && near(A.offsetFromFlagDeg(ball, right, flag), 3, 1e-9), JSON.stringify(right));
check('rotating keeps the ground distance', near(Math.hypot(right.x, right.z), 100, 1e-9));
const left = A.rotateAim(ball, { x: 0, z: -100 }, -2.5);
check('rotate 2.5° left: offset -2.5', left.x < 0 && near(A.offsetFromFlagDeg(ball, left, flag), -2.5, 1e-9));
check('rotate there and back is the identity', (() => { const p = A.rotateAim(ball, A.rotateAim(ball, { x: 12, z: -80 }, 7), -7); return near(p.x, 12) && near(p.z, -80); })());
check('works from a ball that is not at the origin', (() => { const b = { x: 40, z: 30 }, f = { x: 40, z: -120 }; const p = A.rotateAim(b, f, 1); return near(A.offsetFromFlagDeg(b, p, f), 1, 1e-9); })());
check('aim behind the ball is ~180° from a flag ahead', Math.abs(Math.abs(A.offsetFromFlagDeg(ball, { x: 0, z: 50 }, flag)) - 180) < 1e-9);

check('keep: layup target 90 m ahead, flag further on', A.keepManualAim({ x: 0, z: -20 }, { x: 0, z: -110 }, flag));
check('drop: ball is now within 10 m of the target', !A.keepManualAim({ x: 0, z: -105 }, { x: 0, z: -110 }, flag));
check('drop: ball has passed the target', !A.keepManualAim({ x: 0, z: -130 }, { x: 0, z: -110 }, flag));
check('keep: a target to the side of the line is still ahead', A.keepManualAim(ball, { x: 30, z: -60 }, flag));

check('tap: still and quick', A.isTap({ x: 100, y: 100, t: 0 }, { x: 102, y: 99, t: 180 }));
check('drag: moved 40 px', !A.isTap({ x: 100, y: 100, t: 0 }, { x: 140, y: 100, t: 180 }));
check('hold: 800 ms is not a tap', !A.isTap({ x: 100, y: 100, t: 0 }, { x: 100, y: 100, t: 800 }));

check('format right', A.formatOffset(2.04) === '2.0° R', A.formatOffset(2.04));
check('format left', A.formatOffset(-0.5) === '0.5° L');
check('format zero has no side', A.formatOffset(0.01) === '0.0°');

// the page uses it: loaded, the minimap readout is real, the after-shot reset keeps a hand-set aim, the shot still takes its bearing from ball -> aimTarget
const html = require('fs').readFileSync(__dirname + '/../arcade.html', 'utf8');
check('arcade.html loads arcade-aim.js', /<script src="arcade-aim\.js/.test(html));
check('minimap left/right readout is no longer a fixed "0.0° RIGHT"', !/innerText = "0\.0° RIGHT"/.test(html));
check('after a shot the aim reset keeps a hand-set aim', /resetAimTarget\(true\)/.test(html));
check('shot bearing is still atan2(dX, -dZ) of ball -> aimTarget', /aimOffsetDeg = Math\.atan2\(dX, -dZ\)/.test(html));
check('minimap click and tap go through setAimPoint', /window\.setAimPoint\(hits\[0\]\.point\.x/.test(html) && /window\.setAimPoint\(pt\.x/.test(html));

check('a kept aim is tied to the player and hole it was set for', /aimManualOwner\.player === window\.activePlayerIndex && window\.aimManualOwner\.hole === playingHoleIndex/.test(html));
check('landing and next-turn setup both go through resetAimTarget(true)', (html.match(/resetAimTarget\(true\)/g) || []).length >= 3 && !/SMART AUTO-AIM EFTER SLAG ---\s*if \(window\.aimTarget\) \{\s*window\.aimTarget\.set/.test(html));
check('readouts measure against aimReference (flag or range direction)', (html.match(/window\.aimReference\(\)/g) || []).length >= 3);

console.log(failed ? '\n' + failed + ' failed' : '\nall aim checks passed');
process.exit(failed ? 1 : 0);
