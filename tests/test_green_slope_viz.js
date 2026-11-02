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

// ---- 5 och 6: heatmapen slutar vid greenens kant, rutnätet ligger på den ritade marken ----
let REAL_THREE = null;
try { REAL_THREE = require(path.join(__dirname, 'node_modules', 'three')); } catch (e) { /* CI's unit job has no browser libraries */ }
{
  // getTerrainSurfaceHeight: the height on the drawn triangles
  const a = html.indexOf('window.getTerrainSurfaceHeight = function');
  const src = html.slice(a, html.indexOf('\n    };', a) + 7);
  const SEGS = 6, SIZE = 6, stride = SEGS + 1;
  const heights = []; for (let i = 0; i < stride * stride; i++) heights.push(Math.sin(i * 1.7) * 0.3 + (i % 5) * 0.05);
  const arr = new Float32Array(stride * stride * 3);
  for (let i = 0; i < stride * stride; i++) arr[i * 3 + 2] = heights[i];
  const w = { TERRAIN_SEGS: SEGS, _arcadePlaneGeo: { attributes: { position: { array: arr } } } };
  vm.runInContext(src, vm.createContext({ window: w, TERRAIN_SIZE: SIZE }));
  // the triangles as three.js PlaneGeometry cuts them (the real one when it is installed, else its r128 index rule)
  let tris = [];
  if (REAL_THREE) {
    const g = new REAL_THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS), idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2]]);
  } else {
    for (let iy = 0; iy < SEGS; iy++) for (let ix = 0; ix < SEGS; ix++) {
      const A = ix + stride * iy, B = ix + stride * (iy + 1), C = ix + 1 + stride * (iy + 1), D = ix + 1 + stride * iy;
      tris.push([A, B, D], [B, C, D]);
    }
  }
  // vertex i of PlaneGeometry: column i % stride, row floor(i / stride); row r is world z = -SIZE/2 + r (see getTerrainHeight)
  const vx = function (i) { return -SIZE / 2 + (i % stride); }, vz = function (i) { return -SIZE / 2 + Math.floor(i / stride); };
  function onTriangles(x, z) {
    for (const t of tris) {
      const [p, q, r] = t;
      const d = (vz(q) - vz(r)) * (vx(p) - vx(r)) + (vx(r) - vx(q)) * (vz(p) - vz(r));
      const l1 = ((vz(q) - vz(r)) * (x - vx(r)) + (vx(r) - vx(q)) * (z - vz(r))) / d;
      const l2 = ((vz(r) - vz(p)) * (x - vx(r)) + (vx(p) - vx(r)) * (z - vz(r))) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * heights[p] + l2 * heights[q] + l3 * heights[r];
    }
    return NaN;
  }
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const x = -SIZE / 2 + ((k * 0.6180339) % 1) * SIZE, z = -SIZE / 2 + ((k * 0.4142135) % 1) * SIZE;
    worst = Math.max(worst, Math.abs(w.getTerrainSurfaceHeight(x, z) - onTriangles(x, z)));
  }
  check('rutnätets höjd ligger på terrängens trianglar (' + (REAL_THREE ? 'riktiga three.js PlaneGeometry' : 'PlaneGeometrys indexregel') + ')', worst < 1e-5, 'största fel ' + worst.toExponential(2) + ' m');
}
{
  // the line depth bias reaches the shader (polygonOffset does nothing on lines)
  const mat = win._addLineDepthBias({});
  const vs = REAL_THREE ? REAL_THREE.ShaderLib.basic.vertexShader : 'void main() {\n\t#include <project_vertex>\n}';
  const shader = { vertexShader: vs };
  mat.onBeforeCompile(shader);
  check('rutnätets linjer får en djupförskjutning i shadern' + (REAL_THREE ? ' (three r' + REAL_THREE.REVISION + ')' : ''),
    /#include <project_vertex>\n\tgl_Position\.z -= [0-9.e-]+ \* gl_Position\.w;/.test(shader.vertexShader) && typeof mat.customProgramCacheKey === 'function');
  const viz = fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8');
  const gridMat = viz.slice(viz.indexOf('let gridMat ='), viz.indexOf('window.greenGridMesh = new THREE.LineSegments'));
  check('rutnätets material använder den, inte polygonOffset', /addLineDepthBias\(/.test(gridMat) && !/polygonOffset/.test(gridMat));
}
{
  // nearest point on an outline
  const sq = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
  const q1 = win._nearestOnPolygon(6, 1, sq), q2 = win._nearestOnPolygon(-1, -1, sq);
  check('närmaste punkt på konturen', Math.abs(q1.x - 4) < 1e-9 && Math.abs(q1.z - 1) < 1e-9 && Math.abs(q2.x) < 1e-9 && Math.abs(q2.z) < 1e-9);
}
if (REAL_THREE) {
  // the heatmap of a round green: every corner inside the green or on its outline
  const R = 7.3, circle = []; for (let i = 0; i < 120; i++) circle.push({ x: 1.1 + R * Math.cos(i / 120 * 2 * Math.PI), z: -0.7 + R * Math.sin(i / 120 * 2 * Math.PI) });
  const pip = function (px, pz, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i], pj = poly[j];
      if (((pi.z > pz) !== (pj.z > pz)) && (px < (pj.x - pi.x) * (pz - pi.z) / (pj.z - pi.z + 1e-12) + pi.x)) inside = !inside;
    }
    return inside;
  };
  const hw = { pointInPolygon: pip, getActiveGreenPolygon: function () { return circle; }, getTerrainSurfaceHeight: function () { return 0; },
               sampleGreenGradient: function () { return { slopePercent: 0 }; } };
  const added = [];
  const hctx = vm.createContext({ window: hw, THREE: REAL_THREE, console: { log() {}, warn() {}, error() {} },
    document: { getElementById() { return null; } }, scene: { add(m) { added.push(m); }, remove() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), hctx);
  hw.buildGreenHeatmapMesh({ greenData: { points: [1, 2, 3], foregreenWidth: 0 } }, 0, true);
  const mesh = hw.greenHeatmapMesh, pos = mesh && mesh.geometry.attributes.position.array;
  let outside = 0, worstOut = 0;
  for (let i = 0; pos && i < pos.length; i += 3) {
    const r = Math.hypot(pos[i] - 1.1, pos[i + 2] + 0.7);
    if (r > R + 1e-4) { outside++; worstOut = Math.max(worstOut, r - R); }
  }
  check('heatmapen sticker inte ut utanför greenen', !!pos && outside === 0, pos ? (outside + ' hörn utanför, längst ' + worstOut.toFixed(3) + ' m') : 'ingen heatmap');
  // and it still covers the green: the area of its triangles is close to the circle's
  let area = 0; const idx = mesh.geometry.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const A = idx[i] * 3, B = idx[i + 1] * 3, C = idx[i + 2] * 3;
    area += Math.abs((pos[B] - pos[A]) * (pos[C + 2] - pos[A + 2]) - (pos[C] - pos[A]) * (pos[B + 2] - pos[A + 2])) / 2;
  }
  const circleArea = Math.PI * R * R;
  check('heatmapen täcker hela greenen (yta inom 2 %)', Math.abs(area - circleArea) / circleArea < 0.02, 'yta ' + area.toFixed(1) + ' mot ' + circleArea.toFixed(1) + ' m²');
  // the foregreen boundary: each corner carries its signed distance to the putting surface's edge, so the boundary (where it crosses
  // 0) follows the outline instead of 50 cm steps
  {
    const Rin = R - 1.5, inner = []; for (let i = 0; i < 240; i++) inner.push({ x: 1.1 + Rin * Math.cos(i / 240 * 2 * Math.PI), z: -0.7 + Rin * Math.sin(i / 240 * 2 * Math.PI) });
    hw.getActiveGreenPolygon = function (h, cov) { return cov === 'GREEN_ONLY' ? inner : circle; };
    hw.buildGreenHeatmapMesh({ greenData: { points: [1, 2, 3, 4], foregreenWidth: 1.5 } }, 0, true);
    const g2 = hw.greenHeatmapMesh.geometry, p2 = g2.attributes.position.array, fd = g2.attributes.aFg.array;
    let worstD = 0, signs = { in: 0, out: 0 };
    for (let i = 0; i < fd.length; i++) {
      const r = Math.hypot(p2[i * 3] - 1.1, p2[i * 3 + 2] + 0.7);
      worstD = Math.max(worstD, Math.abs(fd[i] - (r - Rin)));
      if (fd[i] < 0) signs.in++; else signs.out++;
    }
    check('foregreen: varje hörn bär sitt avstånd till puttytans kant (negativt innanför)', worstD < 0.01 && signs.in > 0 && signs.out > 0, 'största fel ' + (worstD * 100).toFixed(2) + ' cm');
    check('shadern dämpar där avståndet är över 0, inte vid en 0/1-flagga', /bool fg = vFg > 0\.0;/.test(hw.greenHeatmapMesh.material.fragmentShader));
  }
} else {
  console.log('  (heatmapens kant provas bara med three.js installerat: npm --prefix tests install)');
}

// ---- 7. de mindre felen ----
{
  // the colour table gives the same colours as the old hand-written mapping
  function oldColor(p, fg) {
    let r, g, b;
    if (p < 1.0) { const t = Math.max(0, Math.min(1, p)); r = 0.05 + t * 0.10; g = 0.88 + t * 0.07; b = 1.0; }
    else if (p < 2.2) { const t = (p - 1.0) / 1.2; r = 1.0; g = 0.90 + t * 0.05; b = 0.10 + (1.0 - t) * 0.20; }
    else if (p < 3.8) { const t = (p - 2.2) / 1.6; r = 1.0; g = 0.90 - t * 0.35; b = 0.05; }
    else { const t = Math.min(1, (p - 3.8) / 2.5); r = 1.0; g = 0.55 - t * 0.35; b = 0.15; }
    return fg ? [r * 0.65, g * 0.65, b * 0.65] : [r, g, b];
  }
  let worst = 0;
  for (let p = 0; p <= 9; p += 0.05) for (const fg of [false, true]) {
    const a = win.slopePercentToColor(p, fg), o = oldColor(p, fg);
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(a[i] - o[i]));
  }
  check('färgtabellen ger samma färger som förut (0-9 %, green och foregreen)', worst < 1e-9, 'största skillnad ' + worst.toExponential(1));
  // the shader's colours are written out from the same table: evaluate the GLSL as JS and compare
  const glsl = win._slopeColorGLSL;
  const js = glsl.replace('vec3 slopeColor(float s)', 'function slopeColor(s)');
  const vec3 = function () { return Array.from(arguments); };
  const mix = function (a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); };
  const clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  const slopeColor = new Function('vec3', 'mix', 'clamp', js + '\nreturn slopeColor;')(vec3, mix, clamp);
  let worstG = 0;
  for (let p = 0; p <= 9; p += 0.05) { const a = slopeColor(p), b = win.slopePercentToColor(p); for (let i = 0; i < 3; i++) worstG = Math.max(worstG, Math.abs(a[i] - b[i])); }
  check('heatmapens shader har samma färger som rutnätet och förklaringen', worstG < 1e-9, 'största skillnad ' + worstG.toExponential(1));
  // cache key: the outline's shape and the foregreen width count, not only the number of points
  const gd = { points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }], foregreenWidth: 1 };
  const k0 = win.greenShapeKey(gd);
  const moved = JSON.parse(JSON.stringify(gd)); moved.points[1].x = 5.3;
  const wider = JSON.parse(JSON.stringify(gd)); wider.foregreenWidth = 1.5;
  check('cache-nyckeln ändras när en punkt flyttas eller foregreenen ändras, inte annars',
    win.greenShapeKey(moved) !== k0 && win.greenShapeKey(wider) !== k0 && win.greenShapeKey(JSON.parse(JSON.stringify(gd))) === k0);
  const viz = fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8');
  check('rutnät och heatmap har formens nyckel i sin cache-nyckel', (viz.match(/let shapeKey = window\.greenShapeKey\(hole\.greenData\);/g) || []).length === 2 && !/ptsCount/.test(viz));
  check('lutningsbollarna har formens nyckel i sin nyckel', /currentHoleKey = [^\n]*window\.greenShapeKey\(hole\.greenData\)/.test(html));
  // the break line's speed is the speed of the line it shows
  check('brytlinjens tempo är den valda linjens', /speedMph: best\.v/.test(viz) && /return \{ az: azOff, v: v,/.test(viz));
  // beads: the slope is taken once per bead, not every frame
  const beadLoop = html.slice(html.indexOf('let beadCount = '), html.indexOf('window.greenBeadsMesh.instanceMatrix.needsUpdate = true;'));
  check('lutningsbollarna räknar inte om lutningen varje bildruta', beadLoop.length > 0 && !/sampleGreenGradient/.test(beadLoop) && /let grad = bead;/.test(beadLoop));
  check('heatmapen räknar inte normaler den inte använder', !/computeVertexNormals/.test(viz.slice(viz.indexOf('window.buildGreenHeatmapMesh'), viz.indexOf('window.resetGreenGrid'))));
}
if (REAL_THREE) {
  // the heatmap carries the slope per corner, not a colour
  const hw = { pointInPolygon: function () { return true; }, getActiveGreenPolygon: function () { return [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }]; },
               getTerrainSurfaceHeight: function () { return 0; }, sampleGreenGradient: function (x) { return { slopePercent: x }; } };
  const hctx = vm.createContext({ window: hw, THREE: REAL_THREE, console: { log() {}, warn() {}, error() {} },
    document: { getElementById() { return null; } }, scene: { add() {}, remove() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), hctx);
  hw.buildGreenHeatmapMesh({ greenData: { points: [1, 2, 3], foregreenWidth: 0 } }, 0, true);
  const g = hw.greenHeatmapMesh && hw.greenHeatmapMesh.geometry;
  check('heatmapen bär lutningen per hörn, färgen räknas i shadern', !!g && !!g.attributes.aSlope && !!g.attributes.aFg && !g.attributes.color &&
    /slopeColor\(vSlope\)/.test(hw.greenHeatmapMesh.material.fragmentShader));
}

console.log(failed ? '\n' + failed + ' failed' : '\nAll green slope view checks passed');
process.exit(failed ? 1 : 0);
