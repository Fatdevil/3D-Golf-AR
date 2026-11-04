/**
 * What is drawn every frame (arcade.html):
 * 1. The minimap's box is measured once per frame (window._frameNo), at the start of the frame, not after the page was written to.
 * 2. The minimap is a picture of its own (a render target) drawn when its key changes (size, framing, aim, ball, hole, putting, slope
 *    view), at least once a second and about 20 times a second in the air; every frame the picture is copied into the box.
 * 3. The shadow follows the ball (the camera's look point while building) in steps of 25 m, the light keeps the sun's direction
 *    (userData.sunDir, set by the time of day), and the shadow map is drawn only when something can have moved.
 * Run: node tests/test_render_budget.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '..', 'arcade-scene-engine.js'), 'utf8');
const shells = fs.readFileSync(path.join(__dirname, '..', 'terrain-shells.js'), 'utf8');

console.log('1. Minikartans ruta en gång per bild');
{
  const src = html.slice(html.indexOf('window.minimapBox = function () {'), html.indexOf('\n    };', html.indexOf('window.minimapBox = function () {')) + 7);
  let reads = 0;
  const el = { clientWidth: 88, clientHeight: 136, clientLeft: 2, clientTop: 2, getBoundingClientRect: function () { reads++; return { left: 290, top: 122 }; } };
  const win = { _frameNo: 7 };
  const renderer = { domElement: { clientWidth: 390, getBoundingClientRect: function () { return { left: 0, bottom: 844 }; } } };
  new Function('window', 'document', 'renderer', src)(win, { getElementById: function () { return el; } }, renderer);
  const a = win.minimapBox(), b = win.minimapBox();
  check('två frågor samma bild: en mätning, samma ruta', reads === 1 && a === b && a.w === 88 && a.y === 584, JSON.stringify({ reads: reads, a: a }));
  win._frameNo = 8; win.minimapBox();
  check('nästa bild: mäts igen', reads === 2);
  check('renderloopen räknar bilderna och frågar först, före den skriver till sidan', /function animate\(\) \{\s*requestAnimationFrame\(animate\);[\s\S]{0,200}window\._frameNo = \(window\._frameNo \|\| 0\) \+ 1;\s*if \(\(appMode === 'PLAY' \|\| appMode === 'TEST'\) && window\.minimapBox\) window\.minimapBox\(\);/.test(html));
}

console.log('\n2. Minikartan som egen bild');
{
  const pass = html.slice(html.indexOf('// --- THE GSPRO MINIMAP PASS ---'), html.indexOf('// LM Bridge extracted'));
  check('en render target, 1,5 gånger rutans storlek, byggs om när storleken ändras', /new THREE\.WebGLRenderTarget\(rtW, rtH,/.test(pass) && /MM_SS = 1\.5/.test(pass) && /mmc\.rt\.width !== rtW \|\| mmc\.rt\.height !== rtH/.test(pass));
  check('nyckeln: storlek, inramning, sikte, boll, hål, putt, lutningsvy', /const mmKey = \[rtW, rtH, r3\(minimapCamera\.position\)[\s\S]*r3\(window\.aimTarget\), r3\(window\.ballMesh\.position\), playingHoleIndex, window\.isPuttingMode \? 1 : 0, window\._greenSlopeMode \|\| ''\]/.test(pass));
  check('ritas när nyckeln ändras, annars minst en gång per sekund, 20 gånger per sekund i luften', /if \(mmKey !== mmc\.key \|\| mmNow - mmc\.at > \(mmFlying \? 50 : 1000\)\)/.test(pass));
  check('scenen ritas bara in i bilden (render target), rutan får en kopia varje bild', (pass.match(/renderer\.render\(scene, minimapCamera\)/g) || []).length === 2 && /renderer\.setRenderTarget\(mmc\.rt\);[\s\S]*renderer\.setRenderTarget\(null\);[\s\S]*renderer\.render\(mmc\.quadScene, mmc\.quadCam\);/.test(pass));
  check('kopian: utan djup och utan tonmappning (bilden har redan sina färger)', /new THREE\.MeshBasicMaterial\(\{ map: mmc\.rt\.texture, depthTest: false, depthWrite: false, toneMapped: false \}\)/.test(pass));
}

console.log('\n3. Skuggan följer bollen');
{
  const src = html.slice(html.indexOf('const shadowFocus = {'), html.indexOf('\n    };', html.indexOf('window.updateShadowFocus = function () {')) + 7);
  // a minimal vector, enough for the function
  function V(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  V.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  V.prototype.copy = function (v) { return this.set(v.x, v.y, v.z); };
  V.prototype.add = function (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; };
  V.prototype.equals = function (v) { return v.x === this.x && v.y === this.y && v.z === this.z; };
  V.prototype.distanceToSquared = function (v) { return (v.x - this.x) ** 2 + (v.y - this.y) ** 2 + (v.z - this.z) ** 2; };
  const dirLight = { position: new V(), target: { position: new V(), updateMatrixWorld: function () {} }, userData: { sunDir: new V(50, 100, 50) } };
  const renderer = { shadowMap: { needsUpdate: false } };
  const win = { ballMesh: { position: new V(223, 0, -240) } };
  let t = 1000;
  const env = { appMode: 'PLAY', isFlying: false, controls: { target: new V(0, 0, 0) } };
  const run = new Function('window', 'THREE', 'dirLight', 'renderer', 'getTerrainHeight', 'performance', 'env',
    'var appMode = env.appMode, isFlying = env.isFlying, controls = env.controls; const SHADOW_RECENTRE = 25;\n' + src + '\nreturn function (e) { appMode = e.appMode; isFlying = e.isFlying; return window.updateShadowFocus(); };');
  const step = run(win, { Vector3: V }, dirLight, renderer, function () { return 2; }, { now: function () { return t; } }, env);
  let f = step(env);
  check('i en runda: mitten på bollen (5 m-steg), ljuset med solens riktning', f.cx === 225 && f.cz === -240 && dirLight.target.position.x === 225 && dirLight.target.position.y === 2 && dirLight.position.x === 275 && dirLight.position.y === 102 && renderer.shadowMap.needsUpdate, JSON.stringify(f));
  renderer.shadowMap.needsUpdate = false; t += 100;
  step(env);
  check('inget rör sig: skuggkartan ritas inte', renderer.shadowMap.needsUpdate === false);
  t += 450; step(env);
  check('men minst två gånger per sekund', renderer.shadowMap.needsUpdate === true);
  renderer.shadowMap.needsUpdate = false; t += 10;
  win.ballMesh.position.set(233, 0, -240); step(env);
  check('bollen flyttas 10 m: kartan ritas, mitten står kvar (under 25 m)', renderer.shadowMap.needsUpdate && f.cx === 225);
  win.ballMesh.position.set(260, 0, -240); step(env);
  check('bollen 35 m bort: mitten flyttas', f.cx === 260);
  renderer.shadowMap.needsUpdate = false; t += 10;
  dirLight.userData.sunDir.set(-80, 40, 10); step(env);
  check('solen byter riktning (tid på dygnet): ljuset följer, kartan ritas', dirLight.position.x === 260 - 80 && dirLight.position.y === 2 + 40 && renderer.shadowMap.needsUpdate);
  renderer.shadowMap.needsUpdate = false; t += 10;
  step({ appMode: 'PLAY', isFlying: true });
  check('bollen i luften: kartan ritas varje bild', renderer.shadowMap.needsUpdate);
  renderer.shadowMap.needsUpdate = false; t += 10;
  env.controls.target.set(-300, 0, 100);
  step({ appMode: 'BUILD', isFlying: false });
  check('byggläget: mitten på kamerans blickpunkt, kartan varje bild', f.cx === -300 && f.cz === 100 && renderer.shadowMap.needsUpdate);
  check('skuggkameran ±80 m, ritas inte automatiskt', /const SHADOW_HALF = 80, SHADOW_RECENTRE = 25;/.test(html) && /renderer\.shadowMap\.autoUpdate = false;/.test(html) && /scene\.add\(dirLight\.target\);/.test(html));
  check('renderloopen flyttar skuggan före huvudbilden', /window\.updateShadowFocus\(\);[^\n]*\n\s*renderer\.render\(scene, camera\);/.test(html));
  check('tid på dygnet sätter solens riktning, gräset och vattnet läser den', /dl\.userData\.sunDir\.set\(Math\.cos\(angle\) \* 100/.test(scene) && /const sd = \(dl\.userData && dl\.userData\.sunDir\) \|\| dl\.position;/.test(shells) && /wu\.uSunDir\.value\.copy\(dirLight\.userData\.sunDir \|\| dirLight\.position\)/.test(html));
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
