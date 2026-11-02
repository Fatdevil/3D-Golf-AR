/**
 * Greenens lutningsvy (rutnät, heatmap, bollar) och den snabba brytlinjen.
 * 1. slopeVizHoleIndex: i en runda (PLAY/TEST) hålet som spelas, annars byggarens hål. currentHoleIndex står kvar på
 *    byggarens hål medan rundan går vidare, så lutningsknappen i rundan visade förut hål 1:s green från hål 2.
 * 2. Den snabba brytlinjen (innan fysiklinjen är klar) böjer ut på den HÖGA sidan, som en putt som går i hål.
 * 3. arcade.html: lutningsknappen och renderloopen använder spelets hål; rutnät och heatmap går genom byggarnas cache-kontroll
 *    varje bildruta (byggs om vid hålbyte, lutningsändring, sculpt, ångra), och sculpt/ångra räknar upp terrängversionen.
 * Run: node tests/test_green_slope_viz.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

// ---- arcade-green-viz.js i en stubbad miljö ----
function Geo() { this.attributes = {}; }
Geo.prototype.setAttribute = function (k, v) { this.attributes[k] = v; };
Geo.prototype.dispose = function () {};
function Line(geo, mat) { this.geometry = geo; this.material = mat; }
Line.prototype.computeLineDistances = function () {};
const THREE = {
  BufferGeometry: Geo,
  Float32BufferAttribute: function (arr) { this.array = arr; },
  LineDashedMaterial: function () { this.dispose = function () {}; },
  Line: Line,
};
const win = { matchSettings: { puttAssist: 'FULL' }, currentHoleIndex: 0 };
const hole = { flag: { x: 0, z: -10 } };
const ctx = vm.createContext({
  window: win, THREE: THREE, console: { log() {}, warn() {}, error() {} },
  document: { getElementById() { return null; } },
  appMode: 'PLAY', playState: 'ROUND_IDLE', playingHoleIndex: 0,
  courseHoles: [hole], scene: { remove() {}, add() {} },
  setTimeout: function () {},   // the physics refinement is not under test
  localGetTerrainAt: function () { return { type: 'GREEN' }; },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), ctx);

// 1. which hole
ctx.appMode = 'PLAY'; ctx.playingHoleIndex = 4; win.currentHoleIndex = 0;
check('i en runda: hålet som spelas', win.slopeVizHoleIndex() === 4);
ctx.appMode = 'TEST'; ctx.playingHoleIndex = 2;
check('testspel: hålet som spelas', win.slopeVizHoleIndex() === 2);
ctx.appMode = 'BUILD'; win.currentHoleIndex = 3;
check('i byggaren: byggarens hål', win.slopeVizHoleIndex() === 3);

// 2. quick break line: ball at (0,0), cup 10 m away along -z, ground falls toward +x (downhill +x) -> high side is -x
ctx.appMode = 'BUILD'; ctx.playingHoleIndex = 0;
win.ballMesh = { position: { x: 0, z: 0 } };
win.getTerrainHeight = function (x) { return -0.02 * x; };
win.sampleGreenGradient = function () { return { downhillX: 1, downhillZ: 0, slopeMagnitude: 0.02, slopePercent: 2 }; };
win.buildBreakLine();
const pts = win.breakGuideMesh && win.breakGuideMesh.geometry.attributes.position.array;
check('snabba brytlinjen ritas', !!pts && pts.length >= 6);
if (pts) {
  const xs = []; for (let i = 0; i < pts.length; i += 3) xs.push(pts[i]);
  const mid = xs[Math.floor(xs.length / 2)];
  check('linjen går ut på höga sidan (uppför, -x)', xs.every(function (x) { return x <= 1e-9; }) && mid < -0.01, 'mitt x = ' + mid.toFixed(3));
  check('linjen börjar vid bollen och slutar nära koppen',
    Math.abs(pts[0]) < 1e-9 && Math.abs(pts[2]) < 1e-9 && Math.hypot(pts[pts.length - 3] - 0, pts[pts.length - 1] + 10) < 0.3);
  check('höjden följer marken där linjen ritas', Math.abs(pts[3 * Math.floor(xs.length / 2) + 1] - (-0.02 * mid + 0.04)) < 1e-9);
}

// ---- arcade.html ----
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const cycle = html.slice(html.indexOf('window.cycleGreenSlopeMode = function'), html.indexOf('window.toggleGlobalSlopeGrid'));
check('lutningsknappen väljer hål med slopeVizHoleIndex', /window\.slopeVizHoleIndex\(\)/.test(cycle) && !/currentHoleIndex/.test(cycle));
const loopStart = html.indexOf('// --- GREEN BEADS + GRID VISUALIZATION');
const loop = html.slice(loopStart, html.indexOf('// --- TRACKMAN SLOPE HUD LEGEND', loopStart));
check('renderloopen: globala lutningsvyn följer spelets hål', /vizHoleIdx = isStudioLutning \? window\.currentHoleIndex : window\.slopeVizHoleIndex\(\)/.test(loop));
check('renderloopen: rutnätet går genom cache-kontrollen varje bildruta', /if \(showGrid\) window\.buildGreenGrid\(hole, vizHoleIdx\);/.test(loop));
check('renderloopen: heatmapen går genom cache-kontrollen varje bildruta', /if \(showHeatmap && typeof window\.buildGreenHeatmapMesh === 'function'\) window\.buildGreenHeatmapMesh\(hole, vizHoleIdx\);/.test(loop));
check('sculpt och ångra/gör om räknar upp terrängversionen',
  (html.match(/window\._terrainRevision = \(window\._terrainRevision \|\| 0\) \+ 1;/g) || []).length >= 2);

// ---- 4. en gemensam lutning: terrainSlopeAt (bollen, läget och lutningsvyn) ----
{
  const a = html.indexOf('window.terrainSlopeAt = function');
  const src = html.slice(a, html.indexOf('\n    };', a) + 7);
  const SEGS = 20, SIZE = 20;   // 1 m cells, -10..10
  function makeWin(heightFn) {
    const stride = SEGS + 1, arr = new Float32Array(stride * stride * 3);
    for (let r = 0; r <= SEGS; r++) for (let c = 0; c <= SEGS; c++) {
      const x = -SIZE / 2 + c, z = -SIZE / 2 + r;   // row r = world z (see getTerrainHeight)
      arr[(r * stride + c) * 3 + 2] = heightFn(x, z);
    }
    const w = { TERRAIN_SEGS: SEGS, _arcadePlaneGeo: { attributes: { position: { array: arr } } } };
    vm.runInContext(src, vm.createContext({ window: w, TERRAIN_SIZE: SIZE }));
    return w;
  }
  // a plane: the exact slope everywhere, also between vertices and at the edge
  const plane = makeWin(function (x, z) { return 0.03 * x - 0.02 * z; });
  const pts = [[0, 0], [0.37, -2.81], [4.5, 4.5], [-9.9, 9.6]];
  check('plan: exakt lutning överallt (mellan hörn och vid kanten)', pts.every(function (p) {
    const s = plane.terrainSlopeAt(p[0], p[1]); return Math.abs(s.dhdx - 0.03) < 1e-6 && Math.abs(s.dhdz + 0.02) < 1e-6;
  }));
  // a crowned green: at a vertex it is the central difference over one cell each way (what the ball felt at its nearest vertex)
  const bowl = function (x, z) { return 0.01 * x * x + 0.005 * x * z; };
  const crown = makeWin(bowl);
  const s0 = crown.terrainSlopeAt(3, 2);
  const cd = (bowl(4, 2) - bowl(2, 2)) / 2, cdz = (bowl(3, 3) - bowl(3, 1)) / 2;
  check('i ett hörn: samma lutning som bollen kände förut (centraldifferens ±1 ruta)', Math.abs(s0.dhdx - cd) < 1e-6 && Math.abs(s0.dhdz - cdz) < 1e-6);
  // no step at a cell edge: walking across x = 3 the slope changes by about as much as the curvature gives, not a jump
  let maxJump = 0, prev = crown.terrainSlopeAt(2.5, 0.3).dhdx;
  for (let x = 2.51; x <= 3.5; x += 0.01) { const v = crown.terrainSlopeAt(x, 0.3).dhdx; maxJump = Math.max(maxJump, Math.abs(v - prev)); prev = v; }
  check('inga hopp i lutningen vid rutkanter', maxJump < 0.001, 'största steg per cm: ' + maxJump.toFixed(5));
  // the ball, the lie and the slope view all take it
  const phys = html.slice(html.indexOf('function physicsTerrainAt'), html.indexOf('window.calibratePuttSpeed'));
  const lie = html.slice(html.indexOf('window.localGetTerrainAt = function'), html.indexOf('const greenBeadsGroup'));
  const grad = html.slice(html.indexOf('window.sampleGreenGradient = function'), html.indexOf('plane.raycast = function'));
  check('bollen (physicsTerrainAt) använder terrainSlopeAt', /window\.terrainSlopeAt\(threeX, threeZ\)/.test(phys));
  check('läget (localGetTerrainAt) använder terrainSlopeAt', /window\.terrainSlopeAt\(threeX, threeZ\)/.test(lie));
  check('lutningsvyn (sampleGreenGradient) använder terrainSlopeAt', /window\.terrainSlopeAt\(wx, wz\)/.test(grad) && !/getTerrainHeight\(wx \+ d/.test(grad));
}

console.log(failed ? '\n' + failed + ' failed' : '\nAll green slope view checks passed');
process.exit(failed ? 1 : 0);
