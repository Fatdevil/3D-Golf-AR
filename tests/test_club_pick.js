/**
 * Club choice in the swing engine (arcade-swing-engine.js): the player's own pick must stay.
 * It used to be undone at once: selectClub() called updateSwingInfoBar(), which put the suggested club back, so no club but the suggested one
 * could be chosen. Now a pick stays until the next shot (newShot), and the suggestion follows the aim point instead of the flag.
 * Run: node tests/test_club_pick.js
 */
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

let putting = false;
class V3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
const ball = { x: 0, y: 0, z: 0, distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); } };
const win = { ballMesh: { position: ball }, courseHoles: [{ flag: { x: 0, y: 0, z: -120 } }], playingHoleIndex: 0, get isPuttingMode() { return putting; }, aimTarget: { x: 0, y: 0, z: -120 } };
const stub = () => ({ tagName: 'DIV', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, getAttribute() { return null; }, setAttribute() {}, addEventListener() {} });
const labels = new Proxy({}, { get: (o, id) => (o[id] = o[id] || stub()) });   // every element the info bar and the swing overlay touch
const SE = require('./load_swing_engine.js')({ window: win, globals: { THREE: { Vector3: V3 }, performance: performance }, document: { getElementById: (id) => labels[id] || null } });

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

// the putter is calibrated to the aim point, not to a far pin
win.aimTarget.z = -6;
check('the shot distance (the putter power is built on it) is the distance to the aim point, not to the pin', Math.abs(SE.aimDistanceM() - 6) < 1e-9, SE.aimDistanceM());
win.aimTarget.z = -120;
check('aimed at the pin it is the pin distance (as before)', Math.abs(SE.aimDistanceM() - 120) < 1e-9);

// on the green the aim point is only the bearing (the high side of a break): the pace is for the cup, like the aim line
putting = true; win.aimTarget.z = -6; win.aimTarget.x = 3;
check('putting: the pace is for the cup (120 m here) whatever side the aim point is on', Math.abs(SE.aimDistanceM() - 120) < 1e-9, SE.aimDistanceM());
putting = false; win.aimTarget.z = -120; win.aimTarget.x = 0;
check('onTap builds the shot from that distance', /const distToHoleM = aimDistanceM\(\)/.test(require('fs').readFileSync(__dirname + '/../arcade-swing-engine.js', 'utf8')));

// a suggestion that arrives during a swing waits for the swing to be over
(async function () {
  SE.newShot();
  win.aimTarget.z = -120;   // I9
  SE.updateSwingInfoBar();
  const before = SE.getClub();
  SE.enableSwingMode();
  SE.onTap();                 // power phase starts
  SE.suggestClub('PW');       // the shot plan finishes during the swing
  check('a suggestion during the power phase does not change the club', SE.getClub() === before, SE.getClub());
  SE.onTap();                 // power locked, direction phase
  SE.suggestClub('SW');
  check('...nor during the direction phase', SE.getClub() === before);
  SE.onTap();                 // fired
  SE.suggestClub('LW');
  check('...nor right after the shot', SE.getClub() === before);
  await new Promise(r => setTimeout(r, 400));
  check('when the swing is over the last suggestion is applied', SE.getClub() === 'LW', SE.getClub());
  console.log(failed ? '\n' + failed + ' failed' : '\nall club-pick checks passed');
  process.exit(failed ? 1 : 0);
})();
