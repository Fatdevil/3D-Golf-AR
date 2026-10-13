/**
 * Club choice in the swing engine (arcade-swing-engine.js): the player's own pick must stay.
 * It used to be undone at once: selectClub() called updateSwingInfoBar(), which put the suggested club back, so no club but the suggested one
 * could be chosen. Now a pick stays until the next shot (newShot), and the suggestion follows the aim point instead of the flag.
 * Run: node tests/test_club_pick.js
 */
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

class V3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
const ball = { x: 0, y: 0, z: 0, distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); } };
const win = { ballMesh: { position: ball }, courseHoles: [{ flag: { x: 0, y: 0, z: -120 } }], playingHoleIndex: 0, aimTarget: { x: 0, y: 0, z: -120 } };
const labels = { 'si-club-name': { textContent: '' }, 'si-dist-label': { textContent: '' } };   // the info bar is only worked out while its elements exist
const SE = require('./load_swing_engine.js')({ window: win, globals: { THREE: { Vector3: V3 } }, document: { getElementById: (id) => labels[id] || null } });

SE.updateSwingInfoBar();
check('no pick: the suggestion follows the distance (120 m = 9-iron)', SE.getClub() === 'I9', SE.getClub());
SE.selectClub('DRIVER');
check('the player picks the driver and it stays (was undone at once)', SE.getClub() === 'DRIVER' && SE.isManualClub(), SE.getClub());
SE.updateSwingInfoBar();
check('updating the info bar does not undo the pick', SE.getClub() === 'DRIVER', SE.getClub());
SE.suggestClub('PW');
check('a suggestion does not override the pick', SE.getClub() === 'DRIVER');
SE.newShot();
check('the next shot ends the pick: the suggestion applies again', !SE.isManualClub() && SE.getClub() === 'I9', SE.getClub());
SE.suggestClub('I5');
check('without a pick a suggestion is applied (the shot plan uses this)', SE.getClub() === 'I5' && !SE.isManualClub());
win.aimTarget.z = -60;   // (the engine holds a copy of the window object, so the aim point is changed in place)
SE.updateSwingInfoBar();
check('the suggestion follows the aim point, not the flag (60 m = sand wedge)', SE.getClub() === 'SW', SE.getClub());
SE.selectClub('I7');
win.aimTarget.z = -200;
SE.updateSwingInfoBar();
check('moving the aim does not change the picked club either', SE.getClub() === 'I7');

console.log(failed ? '\n' + failed + ' failed' : '\nall club-pick checks passed');
process.exit(failed ? 1 : 0);
