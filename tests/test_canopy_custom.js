/**
 * Kronan saktar ner bollen för alla träd, inte bara typen 'TREE': ett eget trädobjekt (t.ex. OAK_2) som svarar part 'CANOPY'
 * ska fånga bollen precis som det inbyggda trädet. Utan krona (null) flyger bollen igenom.
 * Run: node tests/test_canopy_custom.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
const SE = require('./load_swing_engine.js')();
let failed = 0;
function check(name, ok, detail) { console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; }

function carry(canopyType) {
  Math.random = function () { return 0; };   // the canopy always catches when the ball is inside it
  const d = SE.mapCircleToPhysics(1, 0, 'PW', 0);
  const env = {
    getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }),
    checkCollisionCallback: (x, y, z) => (canopyType && Math.hypot(x, y) > 30 && Math.hypot(x, y) < 60 && z > 0.1 && z < 60 ? { type: canopyType, height: 60, part: 'CANOPY' } : null),
    wind: [0, 0, 0], temperatureC: 15
  };
  const log = console.log; console.log = function () {};
  try {
    const r = G.simulateFlight(Object.assign({}, d, { startPos: [0, 0, 0], isLiveData: false, isTeeShot: true }), env);
    return r.metrics.carryMeters;
  } finally { console.log = log; }
}
const free = carry(null), tree = carry('TREE'), custom = carry('OAK_2');
check('no canopy: the ball flies on past the trees', free > 100, free.toFixed(1) + ' m');
check('built-in TREE canopy catches the ball', tree < free - 20, tree.toFixed(1) + ' m');
check('custom asset (OAK_2) canopy catches the ball the same way', custom < free - 20 && Math.abs(custom - tree) < 1, custom.toFixed(1) + ' m');
if (failed) { console.log('\n' + failed + ' check(s) failed'); process.exit(1); }
console.log('\nAll canopy checks passed');
