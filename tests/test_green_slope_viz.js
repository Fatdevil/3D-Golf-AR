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

console.log(failed ? '\n' + failed + ' failed' : '\nAll green slope view checks passed');
process.exit(failed ? 1 : 0);
