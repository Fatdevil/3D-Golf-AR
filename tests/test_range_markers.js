/**
 * The range marks (arcade-range-markers.js): every 25 out to 300 in the player's unit, majors every 50 with a colour each,
 * arcs that stay about 45 m wide each side, and the tee frame matching THREE's rotation.y. Run: node tests/test_range_markers.js
 */
const M = require('../arcade-range-markers.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

const yd = M.marks(false), m = M.marks(true);
check('12 marks, every 25 out to 300', yd.length === 12 && yd[0].value === 25 && yd[11].value === 300, yd.map(x => x.value).join());
check('majors every 50, each with its own colour', yd.filter(x => x.major).map(x => x.value).join() === '50,100,150,200,250,300' &&
      new Set(yd.filter(x => x.major).map(x => x.color)).size === 6 && yd.filter(x => !x.major).every(x => x.color === null));
check('yards: 150 yd stands at 137.16 m', near(yd.find(x => x.value === 150).metres, 137.16, 1e-9), yd.find(x => x.value === 150).metres);
check('metres: 150 m stands at 150 m', m.find(x => x.value === 150).metres === 150);
check('the arc reaches about 45 m each side', near(150 * M.arcHalfAngle(150), 45, 1e-9) && near(300 * M.arcHalfAngle(300), 45, 1e-9));
check('close arcs never open wider than 0.7 rad', M.arcHalfAngle(22.86) === 0.7);

check('far signs are bigger, the 50 stays modest', M.signScale(300) > 3 && M.signScale(50) < 1.2 && M.signScale(50) < M.signScale(150));

// signs that would overlap on the screen: the nearer one stays, the further one hides; one behind the camera (null) is not shown
const v = M.pickVisible([{ x: 100, y: 100, w: 80, h: 30 }, { x: 150, y: 105, w: 60, h: 24 }, { x: 400, y: 100, w: 60, h: 24 }, null, { x: 100, y: 200, w: 80, h: 30 }]);
check('pickVisible: an overlapping further sign hides, separate ones stay', v.join() === 'true,false,true,false,true', v.join());
const chain = M.pickVisible([{ x: 0, y: 0, w: 100, h: 40, side: 1 }, { x: 60, y: 0, w: 60, h: 24, side: 1 }, { x: 400, y: 0, w: 40, h: 16, side: 1 }, { x: 400, y: 300, w: 40, h: 16, side: -1 }]);
check('pickVisible: once a sign on a side hides, the further ones on that side hide too (no gap), the other side goes on', chain.join() === 'true,false,false,true', chain.join());
check('pickVisible: without a side a hidden sign does not block the ones after it', M.pickVisible([{ x: 0, y: 0, w: 100, h: 40 }, { x: 90, y: 0, w: 100, h: 40 }, { x: 180, y: 0, w: 100, h: 40 }]).join() === 'true,false,true');

// THREE's rotation.y turns local +Z to (sin r, cos r) and local +X to (cos r, -sin r)
const tee = { x: 10, z: -5, rot: Math.PI };
let w = M.toWorld(tee, 0, 100);
check('down the range from a tee facing -Z', near(w.x, 10, 1e-9) && near(w.z, -105, 1e-9), JSON.stringify(w));
w = M.toWorld({ x: 0, z: 0, rot: Math.PI / 2 }, 2, 50);
check('a range along +X: local +X turns with the group (to -Z)', near(w.x, 50, 1e-9) && near(w.z, -2, 1e-9), JSON.stringify(w));

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll range marker checks passed');
