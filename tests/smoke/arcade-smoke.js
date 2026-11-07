// Browser smoke test for arcade.html. Guards the big inline script against accidental changes while it is being split up.
//   npm --prefix tests install && npm --prefix tests run setup    (once: libraries, then Chromium)
//   npm run smoke                     compare with the saved baseline
//   npm run smoke -- --update         rewrite the baseline (only when a change is intended)
// Needs a Chromium: set CHROMIUM_PATH, or it uses /opt/pw-browsers/chromium-*/chrome-linux/chrome, or Playwright's own.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'baseline.json');
const UPDATE = process.argv.includes('--update');

function need(mod) {
  try { return require(path.join(TESTS, 'node_modules', mod)); }
  catch (e) { console.error('Missing "' + mod + '". Run: npm --prefix tests install'); process.exit(2); }
}
const { chromium } = need('playwright-core');
const NM = path.join(TESTS, 'node_modules') + '/';
const CDN = {
  'three.min.js': NM + 'three/build/three.min.js',
  'OrbitControls.js': NM + 'three/examples/js/controls/OrbitControls.js',
  'GLTFLoader.js': NM + 'three/examples/js/loaders/GLTFLoader.js',
  'DRACOLoader.js': NM + 'three/examples/js/loaders/DRACOLoader.js',
  'pako.min.js': NM + 'pako/dist/pako.min.js',
};
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary' };

function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const base = '/opt/pw-browsers';
    const d = fs.readdirSync(base).filter(function (n) { return /^chromium-\d+$/.test(n); }).sort().pop();
    if (d) return path.join(base, d, 'chrome-linux', 'chrome');
  } catch (e) { /* none */ }
  return undefined;
}

function serve() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? 'hub.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', function () { resolve(srv); });
  });
}

(async function () {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  let browser;
  try { browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.error('Could not start Chromium: ' + e.message.split('\n')[0] + '\nRun: npm --prefix tests run setup   (or set CHROMIUM_PATH)'); srv.close(); process.exit(2); }
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
  // a recogniser the test can talk to: the real one needs a microphone
  await ctx.addInitScript(function () {
    window.__sr = [];
    function FakeSR() { this.started = 0; this.aborted = false; window.__sr.push(this); }
    FakeSR.prototype.start = function () { this.started++; };
    FakeSR.prototype.abort = function () { this.aborted = true; };
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
    const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
    if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort();
  });
  await ctx.route(/^https:\/\/(?!cdn)/, function (r) { r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  const missing = [];
  page.on('pageerror', function (e) { errors.push(e.message.slice(0, 120)); });
  page.on('response', function (r) { const u = new URL(r.url()); if (u.origin === base && r.status() >= 400 && !u.pathname.startsWith('/api/')) missing.push(r.status() + ' ' + u.pathname); });
  await page.goto(base + '/arcade.html?autorun=new_build&mode=range', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(7000);

  // keys the browser itself puts on window: taken from a blank page so the baseline holds only what arcade.html adds
  const blank = await ctx.newPage();
  await blank.goto(base + '/robots.txt'); // same origin so secure-context-only browser APIs (sharedStorage, showOpenFilePicker...) are counted as built in
  const builtin = await blank.evaluate(function () { return Object.keys(window); });
  await blank.close();

  const snap = await page.evaluate(function (builtin) {
    const lex = ['scene', 'camera', 'renderer', 'controls', 'courseHoles', 'playState', 'playingHoleIndex', 'appMode', 'currentTool', 'planeGeo', 'TERRAIN_SIZE', 'MAX_HOLES', 'currentHoleIndex'];
    const lexical = {};
    lex.forEach(function (n) { try { lexical[n] = typeof (0, eval)(n); } catch (e) { lexical[n] = 'missing'; } });
    const skip = {}; builtin.forEach(function (k) { skip[k] = 1; });
    const keys = Object.keys(window).filter(function (k) { return !skip[k] && !/^(webkit|on[a-z]|__|\d)/.test(k) && !/^_?debug/i.test(k); }).sort();
    return { windowKeys: keys.map(function (k) { return k + ':' + typeof window[k]; }), lexical: lexical };
  }, builtin);

  let checks;
  try { checks = await page.evaluate(async function () {
    const out = [];
    function check(name, ok, detail) { out.push({ name: name, ok: !!ok, detail: detail || '' }); }
    window.confirm = function () { return true; };
    setMode('TEST'); window.GREEN_STIMP = 10;
    // placed props are drawn per 128 m square: a square outside the view is skipped (frustum culling on, a sphere around its own props),
    // and a ray still picks the prop it hits (the square's instanceId is mapped back to the prop's index)
    (function () {
      const g = new THREE.Group(), leaves = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 12, 4), new THREE.MeshLambertMaterial({ color: 0x2f7a2f }));
      leaves.position.y = 7; g.add(leaves);
      window.customModels = window.customModels || {}; window.customModels.zz_chunk = g; window.ASSET_REGISTRY.zz_chunk = { subcat: 'TREES' };
      const n0 = window.placedTrees.length;
      for (let i = 0; i < 40; i++) window.placedTrees.push({ type: 'zz_chunk', x: -380 + (i % 8) * 100, z: -380 + Math.floor(i / 8) * 180, y: 0, scale: 1, rot: 0 });
      window.rebuildInstancePool('zz_chunk');
      const meshes = window._propMeshes.filter(function (m) { return m.propType === 'zz_chunk'; });
      const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 2000); cam.position.set(-380, 30, -300); cam.lookAt(-380, 0, -500); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const seen = meshes.filter(function (m) { return fr.intersectsObject(m); }).length;
      const rc = new THREE.Raycaster(); let picked = 0;
      [0, 13, 27, 39].forEach(function (k) {
        const t = window.placedTrees[n0 + k]; rc.set(new THREE.Vector3(t.x, 60, t.z), new THREE.Vector3(0, -1, 0));
        const h = rc.intersectObjects(window._propMeshes);
        if (h.length && window.getGlobalPropIndex(h[0].object.propType, h[0].instanceId, h[0].object) === n0 + k) picked++;
      });
      const all = meshes.every(function (m) { return m.frustumCulled === true; });
      check('props are drawn per square: frustum culling on, a square out of view is skipped, a ray picks the prop it hits',
            meshes.length > 4 && all && seen >= 1 && seen < meshes.length && picked === 4, 'squares ' + meshes.length + ', in view ' + seen + ', picked ' + picked + '/4');
      // far squares draw cards (play and test mode): models near the camera, cards far away, the minimap draws the models, a click on a far
      // tree still picks it (the hidden model is what a ray tests)
      const savedMode = appMode, savedCam = camera.position.clone();
      appMode = 'TEST'; camera.position.set(-380, 2, -380); camera.updateMatrixWorld();
      window.updatePropLod();
      const pool = window.instancePools.zz_chunk, chs = Array.from(pool.chunks.values());
      const farC = chs.filter(function (c) { return c.far; }), nearC = chs.filter(function (c) { return !c.far; });
      const lodOk = !!pool.impostor && farC.length > 0 && nearC.length > 0 &&
        farC.every(function (c) { return c.impostorMesh.visible && c.meshes.every(function (m) { return !m.visible; }); }) &&
        nearC.every(function (c) { return !c.impostorMesh.visible && c.meshes.every(function (m) { return m.visible; }); });
      let fullOk = false;
      window.withFullProps(function () { fullOk = chs.every(function (c) { return !c.impostorMesh.visible && c.meshes.every(function (m) { return m.visible; }); }); });
      const backOk = farC.every(function (c) { return c.impostorMesh.visible; });
      const ft = window.placedTrees[n0 + 39]; rc.set(new THREE.Vector3(ft.x, 60, ft.z), new THREE.Vector3(0, -1, 0));
      const fh = rc.intersectObjects(window._propMeshes);
      const farPick = fh.length > 0 && window.getGlobalPropIndex(fh[0].object.propType, fh[0].instanceId, fh[0].object) === n0 + 39;
      appMode = savedMode; camera.position.copy(savedCam); camera.updateMatrixWorld(); window.updatePropLod();
      check('far squares of trees draw cards in play: models near, cards far, the minimap draws the models, a far tree is still picked',
            lodOk && fullOk && backOk && farPick, 'far ' + farC.length + ', near ' + nearC.length + ', minimap ' + fullOk + ', back ' + backOk + ', pick ' + farPick);
      window.placedTrees.length = n0; destroyInstancePool('zz_chunk'); delete window.customModels.zz_chunk; delete window.ASSET_REGISTRY.zz_chunk;
    })();
    // a tree type photographed again after the wind sway has patched its materials (undo, a cleared course): the card is not empty.
    // The wind code for instanced meshes read instanceMatrix without a guard, so the plain model failed to compile and the card was blank.
    await (async function () {
      const g = new THREE.Group(), leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), new THREE.MeshLambertMaterial({ color: 0x2f7a2f }));
      leaves.position.y = 6; g.add(leaves);
      window.customModels.zz_wind = g; window.ASSET_REGISTRY.zz_wind = { subcat: 'TREES' };
      const n0 = window.placedTrees.length;
      window.placedTrees.push({ type: 'zz_wind', x: 30, z: -60, y: 0, scale: 1, rot: 0 });
      const opaque = function () {
        const rt = window.instancePools.zz_wind.impostor.rt, px = new Uint8Array(rt.width * rt.height * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
        let c = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) c++; return c;
      };
      window.rebuildInstancePool('zz_wind');
      const first = opaque();
      await new Promise(function (r) { setTimeout(r, 800); });   // the wind sway patches the materials in a frame
      const patched = /uWindTime/.test(String(leaves.material.onBeforeCompile));
      destroyInstancePool('zz_wind'); window.rebuildInstancePool('zz_wind');
      const second = opaque();
      window.placedTrees.length = n0; destroyInstancePool('zz_wind'); delete window.customModels.zz_wind; delete window.ASSET_REGISTRY.zz_wind;
      check('a tree card photographed again after the wind sway patched the materials is not empty', first > 1000 && second > 1000, 'first ' + first + ', second ' + second + ', patched ' + patched);
    })();
    // a GLTF model's colour textures are used as they are written (the game draws without colour-space conversion): before, three.js decoded
    // them from sRGB and an oak's crown came out almost black
    await (async function () {
      window.ASSET_REGISTRY.zz_oak = { file: 'Oaktree.glb', subcat: 'TREES', targetHeight: 12 };
      const ok = await new Promise(function (r) { window.loadAsset('zz_oak', r); setTimeout(function () { r(false); }, 20000); });
      const encs = [];
      if (ok) window.customModels.zz_oak.traverse(function (o) { (Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])).forEach(function (m) { if (m.map) encs.push(m.map.encoding); }); });
      delete window.customModels.zz_oak; delete window.ASSET_REGISTRY.zz_oak;
      check('a GLTF model\'s colour textures are used as written (linear, like the rest of the game)', ok && encs.length > 0 && encs.every(function (e) { return e === THREE.LinearEncoding; }), 'loaded ' + ok + ', maps ' + JSON.stringify(encs));
    })();
    // light and colour (arcade-post.js): each level draws a picture (not black), OFF draws as before; the level is restored after
    (function () {
      const gl = renderer.getContext(), was = window.PostFX.level(), px = new Uint8Array(4), seen = {};
      ['OFF', 'LOW', 'HIGH'].forEach(function (l) {
        window.PostFX.setLevel(l);
        if (l === 'OFF') renderer.render(scene, camera); else window.PostFX.render(renderer, scene, camera);
        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight * 0.8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        seen[l] = { active: window.PostFX.active(), px: Array.from(px) };
      });
      window.PostFX.setLevel(was);
      const lit = function (p) { return p[0] + p[1] + p[2] > 30; };
      check('light and colour: off draws as before, colour and colour + glow draw the picture through the grade (not black)',
            !seen.OFF.active && seen.LOW.active && seen.HIGH.active && lit(seen.OFF.px) && lit(seen.LOW.px) && lit(seen.HIGH.px) && JSON.stringify(seen.LOW.px) !== JSON.stringify(seen.OFF.px),
            JSON.stringify(seen));
    })();
    // light and colour with a textured sky (which does not force three.js to clear): the scene's picture is cleared each frame, so a box
    // that is gone does not leave its depth behind and hide the ground (the sky showed where the box had been)
    (function () {
      const gl = renderer.getContext(), px = new Uint8Array(4), was = window.PostFX.level(), prevBg = scene.background;
      const camWas = { p: camera.position.clone(), q: camera.quaternion.clone() };
      const cv = document.createElement('canvas'); cv.width = cv.height = 4; const cx = cv.getContext('2d'); cx.fillStyle = '#88ccee'; cx.fillRect(0, 0, 4, 4);
      scene.background = new THREE.CanvasTexture(cv);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x884400 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(camera.position.x, camera.position.y - 9.5, camera.position.z - 20); scene.add(ground);
      camera.lookAt(camera.position.x, camera.position.y - 10, camera.position.z - 20); camera.updateMatrixWorld();
      const read = function () { gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px).slice(0, 3); };
      const frame = function () { renderer.setRenderTarget(null); renderer.clear(); window.PostFX.render(renderer, scene, camera); return read(); };
      window.PostFX.setLevel('LOW');
      const before = frame();
      const box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir); box.position.copy(camera.position).addScaledVector(dir, 3); scene.add(box);
      const withBox = frame();
      scene.remove(box);
      const after = frame();
      scene.remove(ground); scene.background = prevBg; camera.position.copy(camWas.p); camera.quaternion.copy(camWas.q); camera.updateMatrixWorld();
      window.PostFX.setLevel(was);
      check('light and colour with a textured sky: what moves away does not leave its depth behind (the ground shows again, not the sky)',
            JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(withBox) !== JSON.stringify(before), JSON.stringify({ before: before, withBox: withBox, after: after }));
    })();
    // the shader programs are compiled ahead (the start, a round, a hole change, a prop rebuild): the ball's dot exists, hidden, and a second
    // call has nothing left to compile
    (function () {
      const first = window.precompileShaders(), again = window.precompileShaders(), b = window._ballBeacon;
      check('shader programs are compiled ahead: the ball\'s dot is made (hidden) and a second pass compiles nothing new',
            typeof first === 'number' && again === 0 && !!b && b.visible === false && b.parent === scene, 'first ' + first + ', again ' + again);
    })();
    // the whole map is putting green, in the green of the active palette (not a fixed colour: the palette changes)
    const gc = window.CURRENT_BIOME_CONFIG.greenColor, gr = parseInt(gc.slice(1, 3), 16), gg = parseInt(gc.slice(3, 5), 16), gb = parseInt(gc.slice(5, 7), 16);
    const d = window.terrainBiomeData; for (let i = 0; i < d.length; i += 4) { d[i] = gr; d[i + 1] = gg; d[i + 2] = gb; }
    const pos = planeGeo.attributes.position.array; for (let i = 0; i < planeGeo.attributes.position.count; i++) pos[i * 3 + 2] = 0;
    const h = courseHoles[0]; h.flag = { x: 0, z: -8 };
    if (!h.flagMesh) { h.flagMesh = new THREE.Object3D(); scene.add(h.flagMesh); }
    h.flagMesh.position.set(0, 0, -8);
    window.ballMesh.position.set(0, 0.022, 0); playingHoleIndex = 0;

    // putt line: on a flat green the physics line must drop in
    const pts = window.puttBreakPath(0, 0, h), info = window._breakLineInfo || {};
    check('puttBreakPath returns a line', pts && pts.length >= 6);
    check('puttBreakPath line holes out on a flat green', info.holed === true, JSON.stringify(info));
    // aim line: a putt along the bearing the planned line aims at ends in the cup; aimed 10 degrees off it does not
    const aimOn = window.puttPathForAim(0, 0, h, info.aimOffsetDeg, 160), aimOff = window.puttPathForAim(0, 0, h, info.aimOffsetDeg + 10, 160);
    const endD = function (a) { return a ? Math.hypot(a[a.length - 3] - 0, a[a.length - 1] + 8) : 99; };
    check('aim line along the planned aim ends in the cup', aimOn && aimOn.length <= 480 && endD(aimOn) < 0.1, 'ends ' + endD(aimOn).toFixed(2) + ' m from the cup');
    check('aim line 10 degrees off the aim misses the cup', aimOff && endD(aimOff) > 0.5, 'ends ' + endD(aimOff).toFixed(2) + ' m from the cup');
    // putt assist: Full builds the planned line, Slope only and None do not; None also switches the slope view off
    const savedMode = appMode, savedState = playState;
    appMode = 'PLAY'; window.ballPos = window.ballPos || window.ballMesh.position.clone(); window.ballPos.copy(window.ballMesh.position); playState = 'ROUND_IDLE';
    window.setPuttAssist('FULL'); const gFull = !!window.breakGuideMesh;
    window.setPuttAssist('SLOPE'); const gSlope = !!window.breakGuideMesh;
    window.cycleGreenSlopeMode('GRID'); const slopeKept = window._greenSlopeMode === 'GRID';
    window.setPuttAssist('OFF'); const gOff = !!window.breakGuideMesh, offMode = window._greenSlopeMode;
    window.cycleGreenSlopeMode('GRID'); const stillOff = window._greenSlopeMode === 'OFF';
    window.setPuttAssist('FULL'); window.clearBreakLine(); appMode = savedMode; playState = savedState; window.matchSettings.puttAssist = 'FULL';
    check('putt assist: Full draws the planned line, Slope only and None do not', gFull && !gSlope && !gOff);
    check('putt assist: Slope only keeps the slope view, None switches it off and keeps it off', slopeKept && offMode === 'OFF' && stillOff);
    // placing a prop: a cloud asset's saved brightness is the admin page's boost (0.1), not a multiplier (that made new trees nearly black)
    window.ASSET_REGISTRY._T_CLOUD = { isCloud: true, subcat: 'TREES', brightness: 0.1, yOffset: 0 };
    window.ASSET_REGISTRY._T_POLY = { subcat: 'TREES', brightness: 0.6, yOffset: 0 };
    const bCloud = window.getPlacementParams('_T_CLOUD').brightness, bPoly = window.getPlacementParams('_T_POLY').brightness;
    window.ASSET_REGISTRY._T_CLOUD.placeBrightness = 1.4;
    const bSaved = window.getPlacementParams('_T_CLOUD').brightness;
    delete window.ASSET_REGISTRY._T_CLOUD; delete window.ASSET_REGISTRY._T_POLY;
    check('new cloud prop is placed at 1x, not at the admin boost', bCloud === 1, String(bCloud));
    check('other assets keep their saved brightness; a default saved from the edit panel wins', bPoly === 0.6 && bSaved === 1.4, bPoly + ' ' + bSaved);
    // a collision profile fitted to a model, in the real shot physics: a low shot into the trunk of such a tree stops short, past it flies on
    window.ASSET_REGISTRY._T_PROFILE = { subcat: 'TREES', physics: { type: 'profile', height: 10, reach: 3, crownY: 5, trunk: { r: 0.5, cx: 0, cz: 0, h: 5, guessed: false }, slices: [{ y0: 0, y1: 5, r: 0.5, cx: 0, cz: 0 }, { y0: 5, y1: 10, r: 3, cx: 0, cz: 0 }] } };
    const shoot = function (treeX) {
      const tree = { type: '_T_PROFILE', x: treeX, z: -10, scale: 1, rot: 0 };
      const env = { getTerrainAt: function () { return { z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }; }, wind: [0, 0, 0], checkCollisionCallback: function (x, y, zz) { return window.propHitAt(tree, x, -y, zz); } };
      const quiet = console.log; console.log = function () {};
      try { const r = window.GolfPhysics.simulateFlight({ startPos: [0, 0, 0.1], ballSpeedMph: 70, launchAngleDeg: 3, totalSpinRpm: 0, spinAxisDeg: 0, azimDeg: 0, isLiveData: false, isTeeShot: false }, env); const e = r.path[r.path.length - 1]; return e.y; }
      finally { console.log = quiet; }
    };
    const stopped = shoot(0), clear = shoot(30);
    delete window.ASSET_REGISTRY._T_PROFILE;
    check('profile tree: a low shot into its trunk is stopped, the same shot past it flies on', stopped < 12 && clear > 25, 'into the trunk ended at ' + stopped.toFixed(1) + ' m, past it at ' + clear.toFixed(1) + ' m');
    // power: a putt aimed for 6 m rolls 6 m (±5 %)
    const cfg = { startPos: [0, 0, 0.022], ballSpeedMph: 5, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0, isLiveData: false, isTeeShot: false };
    const v = window.calibratePuttSpeed(cfg, 6, 22);
    const lg = console.log; console.log = function () {};
    const r = window.GolfPhysics.simulateFlight(Object.assign({}, cfg, { ballSpeedMph: v }), { getTerrainAt: function () { return { z: 0, normal: [0, 0, 1], type: 'GREEN' }; }, wind: [0, 0, 0] });
    console.log = lg;
    const f = r.path[r.path.length - 1], rolled = Math.hypot(f.x, f.y);
    check('calibratePuttSpeed(6 m) rolls 6 m ±5 %', Math.abs(rolled - 6) <= 0.3, rolled.toFixed(2) + ' m');
    // tour pro odds
    const o3 = window.tourProPuttOdds(3), o10 = window.tourProPuttOdds(10), o60 = window.tourProPuttOdds(60);
    check('tourProPuttOdds follows the tour table', o3.p1 > 90 && o10.p1 > 35 && o10.p1 < 45 && o60.p1 < 5 && o60.p3 > 8, JSON.stringify([o3, o10, o60]));
    // saving: the whole course serialises to JSON, and the pieces moved out of the big script are in place
    let ser = null;
    try { ser = JSON.stringify(window.serializeHolesFull()); } catch (e) { ser = null; }
    check('serializeHolesFull gives JSON for the course', ser && ser.length > 100, ser ? ser.length + ' chars' : 'failed');
    check('load, leaderboard and rules functions are defined', ['loadLevel', 'importCourseHash', 'showLeaderboard', 'submitRoundResult', 'takeMulligan', 'startLateralDrop', 'buildGreenGrid', 'setWaterType', 'closeLibrary'].every(function (n) { return typeof (0, eval)('typeof ' + n + " === 'undefined' ? undefined : " + n) === 'function'; }));

    // sculpt re-anchor: a hill raised under a green and a tee box must be flattened again at the new height, the hill must survive around them
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hh = courseHoles[1] || courseHoles[0];
      const ring = function (cx, cz, rx, rz) { const a = []; for (let k = 0; k < 8; k++) a.push({ x: cx + rx * Math.cos(k / 8 * 6.283), y: 0, z: cz + rz * Math.sin(k / 8 * 6.283) }); return a; };
      const gp = ring(60, 40, 12, 9);
      const gs = window.captureGreenSnapshot(hh, gp, 25);
      hh.greenData = { points: gp, baseElevation: gs.baseElevation, bbox: gs.bbox, origHeights: gs.origHeights, origCanvasPixels: gs.origCanvasPixels, difficulty: 'FLAT', elevationOffset: 0, blendDistance: 8, tiltPct: 0, tiltAim: false, tiltToFlag: false, stimp: 10, firmness: 'NORMAL', tension: 0.5, mowPattern: 'SOLID', foregreenWidth: 1, edgeSharpness: 100, seedOffsetX: 0, seedOffsetZ: 0 };
      window.applyGreenPipeline(hh, false, false);
      const tp = ring(-60, 40, 5, 4);
      const ts = window.captureTeeSnapshot(hh, tp, 25);
      hh.teeBoxes = [{ id: 'tb_t', points: tp, raiseHeight: 0.5, blendRadius: 4, mowPattern: 'SOLID', edgeSharpness: 100, activeTees: [], baseElevation: ts.baseElevation, bbox: ts.bbox, origHeights: ts.origHeights, origCanvasPixels: ts.origCanvasPixels }];
      hh.teeData = hh.teeBoxes[0];
      window.applyTeePipeline(hh, false, false, hh.teeBoxes[0], true);
      const spread = function (cx, cz, rx, rz) { let lo = 1e9, hi = -1e9; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) { if (a * a + b * b > 9) continue; const y = window.getTerrainHeight(cx + a * rx / 5, cz + b * rz / 5); lo = Math.min(lo, y); hi = Math.max(hi, y); } return hi - lo; };
      const pre = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 3 * Math.exp(-((x - 62) * (x - 62) + (z - 38) * (z - 38)) / 392) + 2 * Math.exp(-((x + 58) * (x + 58) + (z - 40) * (z - 40)) / 98); }
      const bumpy = spread(60, 40, 12, 9);
      const fixed = window.reanchorStudiosAfterSculpt(pre);
      check('sculpt under green and tee: both re-flattened', fixed === 2, 'fixed ' + fixed);
      check('green is flat again after sculpt (was ' + bumpy.toFixed(2) + ' m)', bumpy > 0.5 && spread(60, 40, 12, 9) < 0.08, spread(60, 40, 12, 9).toFixed(3) + ' m');
      check('tee is flat again after sculpt', spread(-60, 40, 5, 4) < 0.03, spread(-60, 40, 5, 4).toFixed(3) + ' m');
      check('green follows the raised ground', hh.greenData.baseElevation > 2, hh.greenData.baseElevation.toFixed(2) + ' m');
      check('hill outside the green is kept', Math.abs(window.getTerrainHeight(90, 40) - 3 * Math.exp(-((90 - 62) ** 2 + 4) / 392)) < 0.05);
      check('old baseline array is left alone (undo)', gs.origHeights.every(function (v) { return Math.abs(v) < 1e-6; }));
      // a mound 20 m from the green edge: out of reach now, but must be kept in the baseline for a later bigger blend
      (function () {
        const g = hh.greenData, pre2 = new Float32Array(p);
        for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 2 * Math.exp(-((x - 92) * (x - 92) + (z - 40) * (z - 40)) / 8); }
        const ref = g.origHeights, base0 = g.baseElevation;
        const r = window.reanchorStudiosAfterSculpt(pre2);
        const bb = g.bbox, gx = Math.round((92 + window.TERRAIN_SIZE / 2) / (window.TERRAIN_SIZE / window.TERRAIN_SEGS)), gz = Math.round((40 + window.TERRAIN_SIZE / 2) / (window.TERRAIN_SIZE / window.TERRAIN_SEGS));
        const oi = (gz - bb.gzStart) * bb.gWidth + (gx - bb.gxStart);
        check('far mound is baked into the green baseline without re-flattening', r === 0 && g.origHeights !== ref && g.origHeights[oi] - ref[oi] > 1.5 && g.baseElevation === base0, 'r=' + r + ' d=' + (g.origHeights[oi] - ref[oi]).toFixed(2));
      })();
      check('no change means no work', window.reanchorStudiosAfterSculpt(new Float32Array(p)) === 0);
    })();

    // separate slope caps along (uphill / downhill) and across (side slope) the fairway
    (function () {
      // 1. the limiter alone, on tilted planes (axis of play = +x)
      const N = 80, mk = function (sx, sz, bump) { const h = new Float32Array(N * N), w = new Float32Array(N * N).fill(1), tx = new Float32Array(N * N).fill(1), tz = new Float32Array(N * N);
        for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) h[z * N + x] = sx * x + sz * z + (bump ? bump * Math.sin(x * 0.4) * Math.cos(z * 0.3) : 0);
        return { h: h, w: w, tx: tx, tz: tz }; };
      const slopeAlong = function (h) { let t = 0, n = 0; for (let z = 20; z < 60; z++) for (let x = 20; x < 59; x++) { t += Math.abs(h[z * N + x + 1] - h[z * N + x]); n++; } return t / n; };
      const slopeAcross = function (h) { let t = 0, n = 0; for (let z = 20; z < 59; z++) for (let x = 20; x < 60; x++) { t += Math.abs(h[(z + 1) * N + x] - h[z * N + x]); n++; } return t / n; };
      const run = function (f, along, across) { const h0 = Float32Array.from(f.h); const r = window.limitHeightSlope(f.h, f.w, N, N, along, 1, 3000, 4000, { across: across, tx: f.tx, tz: f.tz }); return { r: r, h0: h0 }; };
      const a = mk(0.12, 0, 0), ra = run(a, 0.15, 0.06);
      let moved = 0; for (let i = 0; i < a.h.length; i++) moved = Math.max(moved, Math.abs(a.h[i] - ra.h0[i]));
      check('limiter: a 12 % uphill along the fairway is left alone under a 15 % along cap', moved < 1e-4 && ra.r.converged, 'moved ' + moved);
      const b = mk(0, 0.12, 0), rb = run(b, 0.15, 0.06);
      check('limiter: a 12 % side slope is cut to the 6 % across cap (not flattened)', rb.r.converged && slopeAcross(b.h) > 0.05 && slopeAcross(b.h) < 0.0645, 'across ' + (slopeAcross(b.h) * 100).toFixed(2) + ' %');
      const c = mk(0.20, 0, 0), rc = run(c, 0.15, 0.06);
      check('limiter: a 20 % uphill is cut down to the 15 % along cap (the sweeps overshoot a little, as for the single cap)', rc.r.converged && slopeAlong(c.h) > 0.12 && slopeAlong(c.h) < 0.1575, 'along ' + (slopeAlong(c.h) * 100).toFixed(2) + ' %');
      const d = mk(0.12, 0.12, 0), rd = run(d, 0.15, 0.06);
      const ar = slopeAlong(d.h), ac = slopeAcross(d.h), ell = Math.sqrt(Math.pow(ar / 0.15, 2) + Math.pow(ac / 0.06, 2));
      check('limiter: a diagonal slope ends on the cap ellipse', rd.r.converged && ell > 0.75 && ell < 1.07, 'along ' + (ar * 100).toFixed(1) + ' % across ' + (ac * 100).toFixed(1) + ' % ellipse ' + ell.toFixed(3));
      // equal caps give exactly the old single cap
      const e1 = mk(0.1, 0.07, 1.2), e2 = mk(0.1, 0.07, 1.2);
      window.limitHeightSlope(e1.h, e1.w, N, N, 0.08, 1, 3000, 4000, { across: 0.08, tx: e1.tx, tz: e1.tz });
      window.limitHeightSlope(e2.h, e2.w, N, N, 0.08, 1, 3000, 4000);
      let same = 0; for (let i = 0; i < e1.h.length; i++) same = Math.max(same, Math.abs(e1.h[i] - e2.h[i]));
      check('limiter: equal along / across caps behave exactly like the single cap', same < 1e-4, 'max diff ' + same);

      // one direction without a cap keeps its slope: 20 % along under a 15 % along cap, across uncapped (50 %)
      const u = mk(0.20, 0.50, 0), ru = run(u, 0.15, 0);
      check('limiter: with the across cap off, limiting the along slope leaves the across slope alone', ru.r.converged && slopeAlong(u.h) < 0.1575 && slopeAcross(u.h) > 0.47 && slopeAcross(u.h) < 0.53, 'along ' + (slopeAlong(u.h) * 100).toFixed(1) + ' % across ' + (slopeAcross(u.h) * 100).toFixed(1) + ' %');
      const u2 = mk(0.50, 0.09, 0), ru2 = run(u2, 0, 0.06);
      check('limiter: with the along cap off, limiting the across slope leaves the along slope alone', ru2.r.converged && slopeAcross(u2.h) < 0.0645 && slopeAlong(u2.h) > 0.47 && slopeAlong(u2.h) < 0.53, 'along ' + (slopeAlong(u2.h) * 100).toFixed(1) + ' % across ' + (slopeAcross(u2.h) * 100).toFixed(3) + ' %');
      // the reported slope is the real gradient of the worst cell, also when along and across caps differ
      const g = mk(0.40, 0, 0), rg = window.limitHeightSlope(g.h, g.w, N, N, 0.15, 1, 1, 4000, { across: 0.06, tx: g.tx, tz: g.tz });
      let realMax = 0; for (let z = 0; z < N - 1; z++) for (let x = 0; x < N - 1; x++) realMax = Math.max(realMax, Math.hypot(g.h[z * N + x + 1] - g.h[z * N + x], g.h[(z + 1) * N + x] - g.h[z * N + x]));
      check('limiter: a non-converged run with split caps reports the real remaining slope', !rg.converged && rg.maxSlope > 0.15 && Math.abs(rg.maxSlope - realMax) < 0.03, 'reported ' + (rg.maxSlope * 100).toFixed(1) + ' % real ' + (realMax * 100).toFixed(1) + ' %');

      // 2. the direction of play
      const A1 = window.fairwayAxisField({ tees: { red: { x: 0, z: 100 } }, flag: { x: 0, z: -100 } }, { points: [] })(5, 0);
      const f2 = window.fairwayAxisField({ tees: { red: { x: 0, z: 100 } }, aimPoint: { x: 0, z: 0 }, flag: { x: 100, z: 0 } }, { points: [] });
      const A2 = f2(0, 60), A3 = f2(70, 0), A4 = f2(0, 3);
      const A5 = window.fairwayAxisField({}, { points: [{ x: -40, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 10 }, { x: -40, z: 10 }] })(0, 5);
      check('direction of play: straight hole, dogleg (turns with the line, blended at the bend) and the outline fallback',
        Math.abs(A1[1]) > 0.99 && Math.abs(A2[1]) > 0.98 && Math.abs(A3[0]) > 0.98 && Math.abs(A4[0]) > 0.1 && Math.abs(A4[1]) > 0.1 && Math.abs(A5[0]) > 0.99, JSON.stringify([A1, A2, A3, A4, A5]));

      // 3. through the fairway pipeline, on ridges that are steep in only ONE direction (a uniform tilt cannot be levelled: the
      //    outline is pinned to the ground around it). Hole line runs along z.
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      const hh = courseHoles[2] || courseHoles[0];
      const keep = { fairways: hh.fairways, fairwayData: hh.fairwayData, active: hh.activeFairwayIndex, tees: hh.tees, flag: hh.flag, aim: hh.aimPoint, green: hh.greenData };
      const pts = [{ x: -14, y: 0, z: 100 }, { x: 14, y: 0, z: 100 }, { x: 14, y: 0, z: 200 }, { x: -14, y: 0, z: 200 }];
      hh.greenData = null; hh.aimPoint = null; hh.tees = { red: { x: 0, y: 0, z: 40 } }; hh.flag = { x: 0, z: 260 };
      const centreH = function () { return window.getTerrainHeight(0, 150); };
      const res = {};
      // steep along z (sigma 8), gentle across (sigma 60: 3 %) / steep across x, gentle along z
      [['alongSteep', function (x, z) { return 3 * Math.exp(-(x * x / (2 * 60 * 60) + (z - 150) * (z - 150) / (2 * 8 * 8))); }],
       ['acrossSteep', function (x, z) { return 3 * Math.exp(-(x * x / (2 * 8 * 8) + (z - 150) * (z - 150) / (2 * 60 * 60))); }]].forEach(function (cs) {
        for (let i = 0; i < n; i++) p[i * 3 + 2] = cs[1](p[i * 3], -p[i * 3 + 1]);
        const snap = window.captureFairwaySnapshot(hh, pts, 35);
        const fd = { id: 'fw_ax', points: pts, baseElevation: snap.baseElevation, bbox: snap.bbox, origHeights: snap.origHeights, origCanvasPixels: snap.origCanvasPixels, difficulty: 'FLAT', semiRoughWidth: 2, roughWidth: 5, roughEnabled: true, mowPattern: 'SOLID', edgeSharpness: 100, maxSlopePct: 6, maxSlopeAlongPct: 0, seedOffsetX: 0, seedOffsetZ: 0 };
        hh.fairways = [fd]; hh.fairwayData = fd; hh.activeFairwayIndex = 0;
        window.applyFairwayPipeline(hh, false, false, fd); const single = centreH();
        fd.maxSlopeAlongPct = 15; window.applyFairwayPipeline(hh, false, false, fd); const split = centreH();
        fd.maxSlopePct = 0; fd.maxSlopeAlongPct = 0; window.applyFairwayPipeline(hh, false, false, fd); const natural = centreH();
        res[cs[0]] = { natural: +natural.toFixed(2), single6: +single.toFixed(2), split6_15: +split.toFixed(2) };
      });
      check('fairway 6 % across / 15 % along: a ridge steep ALONG the fairway is levelled much less than with one 6 % cap', res.alongSteep.natural > 2.9 && res.alongSteep.split6_15 > res.alongSteep.single6 + 0.4, JSON.stringify(res.alongSteep));
      check('fairway 6 % across / 15 % along: a ridge steep ACROSS the fairway is levelled as with the 6 % cap', res.acrossSteep.natural > 2.9 && Math.abs(res.acrossSteep.split6_15 - res.acrossSteep.single6) < 0.25, JSON.stringify(res.acrossSteep));
      hh.fairways = keep.fairways; hh.fairwayData = keep.fairwayData; hh.activeFairwayIndex = keep.active; hh.tees = keep.tees; hh.flag = keep.flag; hh.aimPoint = keep.aim; hh.greenData = keep.green;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    })();

    // sculpt re-anchor for bunkers: a hill raised over a bunker keeps the dig-out and survives a later bunker edit
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hh = courseHoles[3] || courseHoles[0];
      const pts = []; for (let k = 0; k < 8; k++) pts.push({ x: -60 + 6 * Math.cos(k / 8 * 6.283), y: 0, z: -140 + 5 * Math.sin(k / 8 * 6.283) });
      const snap = window.captureBunkerSnapshot(hh, pts, 15);
      const bd = { id: 'bk_t', points: pts, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: snap.baseElevation, bbox: snap.bbox, origHeights: snap.origHeights, origCanvasPixels: snap.origCanvasPixels };
      hh.bunkers = [bd]; hh.bunkerData = bd; hh.activeBunkerIndex = 0;
      window.applyBunkerPipeline(hh, false, false, bd);
      const dip = function () { return window.getTerrainHeight(-60, -140) - window.getTerrainHeight(-60 + 14, -140); };
      const dip0 = dip();
      const pre = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 4 * Math.exp(-((x + 60) * (x + 60) + (z + 140) * (z + 140)) / 200); }
      const old = bd.origHeights;
      window.reanchorStudiosAfterSculpt(pre);
      const hill = 4 * Math.exp(-(14 * 14) / 200);
      check('hill over a bunker: bunker baseline gets the hill (old array untouched for undo)', bd.origHeights !== old && old.every(function (v) { return Math.abs(v) < 1e-6; }) && Math.max.apply(null, Array.from(bd.origHeights)) > 3.5);
      check('hill over a bunker: the bunker is still dug into the hill', dip0 < -0.3 && window.getTerrainHeight(-60, -140) > 3 && window.getTerrainHeight(-60 + 14, -140) - hill > -0.15, 'dip0 ' + dip0.toFixed(2) + ' centre ' + window.getTerrainHeight(-60, -140).toFixed(2));
      bd.depth = 1.2; window.applyBunkerPipeline(hh, false, false, bd);
      check('editing the bunker later does not flatten the hill', Math.abs(window.getTerrainHeight(-60 + 14, -140) - hill) < 0.3 && window.getTerrainHeight(-60, -140) > 2.5, 'rim ' + window.getTerrainHeight(-60 + 14, -140).toFixed(2) + ' want ' + hill.toFixed(2));
      // bake-only (mountain / water tools) keeps the baseline in step without touching the ground
      const pre2 = new Float32Array(p), h2 = window.getTerrainHeight(-60 + 3, -140);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 1 * Math.exp(-((x + 57) * (x + 57) + (z + 140) * (z + 140)) / 8); }
      const h2b = window.getTerrainHeight(-60 + 3, -140);
      window.reanchorStudiosAfterSculpt(pre2, { bakeFairwaysOnly: true });
      bd.depth = 1.2; window.applyBunkerPipeline(hh, false, false, bd);
      check('bake-only tools are baked into the bunker baseline too', h2b > h2 + 0.5 && Math.abs(window.getTerrainHeight(-60 + 3, -140) - h2b) < 0.25, h2b.toFixed(2) + ' -> ' + window.getTerrainHeight(-60 + 3, -140).toFixed(2));
      hh.bunkers = []; hh.bunkerData = null; hh.activeBunkerIndex = null;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    })();

    // two overlapping bunkers (the second was captured with the first already dug): a hill over them keeps both dips, dug once
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hh = courseHoles[3] || courseHoles[0];
      const mk = function (id, cx, cz, r) { const pts = []; for (let k = 0; k < 8; k++) pts.push({ x: cx + r * Math.cos(k / 8 * 6.283), y: 0, z: cz + r * Math.sin(k / 8 * 6.283) }); const sn = window.captureBunkerSnapshot(hh, pts, 15); return { id: id, points: pts, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: sn.baseElevation, bbox: sn.bbox, origHeights: sn.origHeights, origCanvasPixels: sn.origCanvasPixels }; };
      const A = mk('bk_a', -60, -140, 6);
      hh.bunkers = [A]; hh.bunkerData = A; window.applyBunkerPipeline(hh, false, false, A);
      const B = mk('bk_b', -53, -140, 5); // captured with A already dug
      hh.bunkers = [A, B]; hh.activeBunkerIndex = 1; window.applyBunkerPipeline(hh, false, false, B);
      const pts = [[-64, -140], [-57, -140], [-50, -140], [-56, -144]];
      const before = pts.map(function (q) { return window.getTerrainHeight(q[0], q[1]); });
      const pre = new Float32Array(p);
      const hill = function (x, z) { return 4 * Math.exp(-((x + 56) * (x + 56) + (z + 140) * (z + 140)) / 200); };
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += hill(x, z); }
      window.reanchorStudiosAfterSculpt(pre);
      const worst = Math.max.apply(null, pts.map(function (q, i) { return Math.abs(window.getTerrainHeight(q[0], q[1]) - hill(q[0], q[1]) - before[i]); }));
      check('stacked bunkers under a hill keep their dips (each dug once)', worst < 0.2, 'worst ' + worst.toFixed(2) + ' before ' + before.map(function (v) { return v.toFixed(2); }).join(','));
      hh.bunkers = []; hh.bunkerData = null; hh.activeBunkerIndex = null;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    })();

    // overlapping bunkers on two holes: the older one sits on the higher hole index; layer order follows the creation time in the id
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hOld = courseHoles[3] || courseHoles[1], hNew = courseHoles[0];
      const mk = function (h, id, cx, cz, r) { const pts = []; for (let k = 0; k < 8; k++) pts.push({ x: cx + r * Math.cos(k / 8 * 6.283), y: 0, z: cz + r * Math.sin(k / 8 * 6.283) }); const sn = window.captureBunkerSnapshot(h, pts, 15); return { id: id, points: pts, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: sn.baseElevation, bbox: sn.bbox, origHeights: sn.origHeights, origCanvasPixels: sn.origCanvasPixels }; };
      const A = mk(hOld, 'bk_1000_aaaa', -60, -140, 6);
      hOld.bunkers = [A]; hOld.bunkerData = A; hOld.activeBunkerIndex = 0; window.applyBunkerPipeline(hOld, false, false, A);
      const B = mk(hNew, 'bk_2000_bbbb', -53, -140, 5); // captured with A already dug
      hNew.bunkers = [B]; hNew.bunkerData = B; hNew.activeBunkerIndex = 0; window.applyBunkerPipeline(hNew, false, false, B);
      const pts = [[-64, -140], [-57, -140], [-50, -140], [-56, -144]];
      const before = pts.map(function (q) { return window.getTerrainHeight(q[0], q[1]); });
      const pre = new Float32Array(p);
      const hill = function (x, z) { return 4 * Math.exp(-((x + 56) * (x + 56) + (z + 140) * (z + 140)) / 200); };
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += hill(x, z); }
      window.reanchorStudiosAfterSculpt(pre);
      const worst = Math.max.apply(null, pts.map(function (q, i) { return Math.abs(window.getTerrainHeight(q[0], q[1]) - hill(q[0], q[1]) - before[i]); }));
      check('stacked bunkers on different holes keep their dips (layer order by creation time)', worst < 0.2, 'worst ' + worst.toFixed(2));
      [hOld, hNew].forEach(function (h) { h.bunkers = []; h.bunkerData = null; h.activeBunkerIndex = null; });
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    })();

    // an older bunker moved on top of a newer one is re-captured and becomes the top layer: lifting follows the capture order, not the id
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hh = courseHoles[3] || courseHoles[0];
      const ptsAt = function (cx, cz, r) { const a = []; for (let k = 0; k < 8; k++) a.push({ x: cx + r * Math.cos(k / 8 * 6.283), y: 0, z: cz + r * Math.sin(k / 8 * 6.283) }); return a; };
      const mk = function (id, cx, cz, r) { const pts = ptsAt(cx, cz, r); const sn = window.captureBunkerSnapshot(hh, pts, 15); return { id: id, points: pts, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: sn.baseElevation, bbox: sn.bbox, origHeights: sn.origHeights, origCanvasPixels: sn.origCanvasPixels }; };
      const A = mk('bk_1000_aaaa', -120, -140, 6), B = mk('bk_2000_bbbb', -53, -140, 5);
      hh.bunkers = [A, B]; hh.bunkerData = A; hh.activeBunkerIndex = 0;
      window.applyBunkerPipeline(hh, false, false, A); window.applyBunkerPipeline(hh, false, false, B);
      // move A (the older id) onto B: lift, re-capture, dig again
      window.restoreBunkerBase(hh, false, A);
      A.points = ptsAt(-60, -140, 6);
      const snap = window.captureBunkerSnapshot(hh, A.points, 15);
      A.bbox = snap.bbox; A.origHeights = snap.origHeights; A.origCanvasPixels = snap.origCanvasPixels;
      window.applyBunkerPipeline(hh, false, false, A);
      const pts = [[-64, -140], [-57, -140], [-50, -140], [-56, -144]];
      const before = pts.map(function (q) { return window.getTerrainHeight(q[0], q[1]); });
      const pre = new Float32Array(p);
      const hill = function (x, z) { return 4 * Math.exp(-((x + 56) * (x + 56) + (z + 140) * (z + 140)) / 200); };
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += hill(x, z); }
      window.reanchorStudiosAfterSculpt(pre);
      const worst = Math.max.apply(null, pts.map(function (q, i) { return Math.abs(window.getTerrainHeight(q[0], q[1]) - hill(q[0], q[1]) - before[i]); }));
      check('a moved (re-captured) bunker is the top layer: dips survive a hill, dug once', worst < 0.2, 'worst ' + worst.toFixed(2));
      hh.bunkers = []; hh.bunkerData = null; hh.activeBunkerIndex = null;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    })();

    // a bunker beside the green that the stroke never touches is dug again after the green re-runs (its dip must not be erased)
    [false, true].forEach(function (cross) { // the bunker belongs to the green's hole, or to a neighbouring hole (terrain is shared)
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hh = courseHoles[1] || courseHoles[0];
      const ring = function (cx, cz, rx, rz) { const a = []; for (let k = 0; k < 8; k++) a.push({ x: cx + rx * Math.cos(k / 8 * 6.283), y: 0, z: cz + rz * Math.sin(k / 8 * 6.283) }); return a; };
      const gp = ring(60, 40, 12, 9);
      const gs = window.captureGreenSnapshot(hh, gp, 25);
      hh.greenData = { points: gp, baseElevation: gs.baseElevation, bbox: gs.bbox, origHeights: gs.origHeights, origCanvasPixels: gs.origCanvasPixels, difficulty: 'FLAT', elevationOffset: 0, blendDistance: 8, tiltPct: 0, tiltAim: false, tiltToFlag: false, stimp: 10, firmness: 'NORMAL', tension: 0.5, mowPattern: 'SOLID', foregreenWidth: 1, edgeSharpness: 100, seedOffsetX: 0, seedOffsetZ: 0 };
      window.applyGreenPipeline(hh, false, false);
      const bh = cross ? (courseHoles[0] === hh ? courseHoles[2] : courseHoles[0]) : hh;
      const bp = ring(38, 40, 3, 3);
      const bs = window.captureBunkerSnapshot(bh, bp, 15);
      const bd = { id: 'bk_g', points: bp, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: bs.baseElevation, bbox: bs.bbox, origHeights: bs.origHeights, origCanvasPixels: bs.origCanvasPixels };
      bh.bunkers = [bd]; bh.bunkerData = bd; bh.activeBunkerIndex = 0;
      window.applyBunkerPipeline(bh, false, false, bd);
      const dipOf = function () { return window.getTerrainHeight(38, 40) - window.getTerrainHeight(38, 40 + 9); };
      const dip0 = dipOf();
      const pre = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 1.5 * Math.exp(-((x - 68) * (x - 68) + (z - 40) * (z - 40)) / 8); }
      let touched = false; for (let gz = bd.bbox.gzStart; gz <= bd.bbox.gzEnd; gz++) for (let gx = bd.bbox.gxStart; gx <= bd.bbox.gxEnd; gx++) { const i = gz * (window.TERRAIN_SEGS + 1) + gx; if (Math.abs(p[i * 3 + 2] - pre[i * 3 + 2]) > 0.005) touched = true; }
      window.reanchorStudiosAfterSculpt(pre);
      check('stroke on the green does not touch the bunker bbox (test setup)', !touched);
      check('bunker beside a re-run green is dug again' + (cross ? ' (bunker on another hole)' : '') + ' (dip ' + dip0.toFixed(2) + ' -> ' + dipOf().toFixed(2) + ')', dip0 < -0.3 && dipOf() < dip0 + 0.25, 'dip0 ' + dip0.toFixed(2) + ' now ' + dipOf().toFixed(2));
      bh.bunkers = []; bh.bunkerData = null; bh.activeBunkerIndex = null; hh.greenData = null;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    });

    // a stroke on the far side of the green re-flattens it at a new height: the bunker beside it (stroke never touched its bbox)
    // must follow the reshaped ground instead of being dug into the old surface
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
      const hh = courseHoles[1] || courseHoles[0];
      const ring = function (cx, cz, rx, rz) { const a = []; for (let k = 0; k < 8; k++) a.push({ x: cx + rx * Math.cos(k / 8 * 6.283), y: 0, z: cz + rz * Math.sin(k / 8 * 6.283) }); return a; };
      const gp = ring(60, 40, 12, 9);
      const gs = window.captureGreenSnapshot(hh, gp, 25);
      hh.greenData = { points: gp, baseElevation: gs.baseElevation, bbox: gs.bbox, origHeights: gs.origHeights, origCanvasPixels: gs.origCanvasPixels, difficulty: 'FLAT', elevationOffset: 0, blendDistance: 8, tiltPct: 0, tiltAim: false, tiltToFlag: false, stimp: 10, firmness: 'NORMAL', tension: 0.5, mowPattern: 'SOLID', foregreenWidth: 1, edgeSharpness: 100, seedOffsetX: 0, seedOffsetZ: 0 };
      window.applyGreenPipeline(hh, false, false);
      const bp = ring(42, 40, 3, 3);
      const bs = window.captureBunkerSnapshot(hh, bp, 15);
      const bd = { id: 'bk_r', points: bp, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: bs.baseElevation, bbox: bs.bbox, origHeights: bs.origHeights, origCanvasPixels: bs.origCanvasPixels };
      hh.bunkers = [bd]; hh.bunkerData = bd; hh.activeBunkerIndex = 0;
      window.applyBunkerPipeline(hh, false, false, bd);
      const old = bd.origHeights;
      const pre = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 12 * Math.exp(-((x - 72) * (x - 72) + (z - 40) * (z - 40)) / 10); }
      let touched = false; for (let gz = bd.bbox.gzStart; gz <= bd.bbox.gzEnd; gz++) for (let gx = bd.bbox.gxStart; gx <= bd.bbox.gxEnd; gx++) { const i = gz * (window.TERRAIN_SEGS + 1) + gx; if (Math.abs(p[i * 3 + 2] - pre[i * 3 + 2]) > 0.005) touched = true; }
      const base0 = hh.greenData.baseElevation;
      window.reanchorStudiosAfterSculpt(pre);
      const raised = hh.greenData.baseElevation - base0;
      // between the bunker and the green edge: the blend slope must be smooth, not a step up to the new green height
      const step = window.getTerrainHeight(50, 40) - window.getTerrainHeight(47, 40);
      check('far-side stroke raises the green but misses the bunker bbox (test setup)', !touched && raised > 0.2, 'touched ' + touched + ' raised ' + raised.toFixed(2));
      check('bunker follows the reshaped ground (no step at its edge, new baseline)', bd.origHeights !== old && Math.abs(step) < 0.35, 'step ' + step.toFixed(2));
      hh.bunkers = []; hh.bunkerData = null; hh.activeBunkerIndex = null; hh.greenData = null;
      for (let i = 0; i < n; i++) p[i * 3 + 2] = 0;
    })();

    // fairway slope cap: a hill under the fairway is made gentler (not removed) and restored when the cap is turned off
    (function () {
      const p = planeGeo.attributes.position.array, n = planeGeo.attributes.position.count;
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] = 4 * Math.exp(-(x * x + (z - 150) * (z - 150)) / 200); }
      const hh = courseHoles[2] || courseHoles[0];
      const pts = []; for (let k = 0; k < 8; k++) pts.push({ x: 40 * Math.cos(k / 8 * 6.283), y: 0, z: 150 + 12 * Math.sin(k / 8 * 6.283) });
      const snap = window.captureFairwaySnapshot(hh, pts, 35);
      const fd = { id: 'fw_t', points: pts, baseElevation: snap.baseElevation, bbox: snap.bbox, origHeights: snap.origHeights, origCanvasPixels: snap.origCanvasPixels, difficulty: 'FLAT', semiRoughWidth: 2, roughWidth: 5, roughEnabled: true, mowPattern: 'SOLID', edgeSharpness: 100, maxSlopePct: 0, seedOffsetX: 0, seedOffsetZ: 0 };
      hh.fairways = [fd]; hh.fairwayData = fd; hh.activeFairwayIndex = 0;
      // gradient magnitude (diagonals included), not just the per-axis step
      const maxSlope = function () { let m = 0; for (let x = -30; x <= 30; x++) for (let z = 140; z <= 160; z++) { const a = window.getTerrainHeight(x, z); m = Math.max(m, Math.hypot(window.getTerrainHeight(x + 1, z) - a, window.getTerrainHeight(x, z + 1) - a)); } return m; };
      const centre = function () { return window.getTerrainHeight(0, 150); };
      window.applyFairwayPipeline(hh, false, false, fd);
      const natural = maxSlope(), c0 = centre();
      fd.maxSlopePct = 8; window.applyFairwayPipeline(hh, false, false, fd);
      const capped = maxSlope(), c1 = centre();
      check('fairway slope cap: natural hill is steep (' + natural.toFixed(2) + ')', natural > 0.2 && Math.abs(c0 - 4) < 0.05, 'centre ' + c0.toFixed(2));
      check('fairway slope cap 8 %: slope within limit', capped <= 0.10, 'max ' + (capped * 100).toFixed(1) + ' %');
      check('fairway slope cap keeps a gentler hill', c1 > 0.3 && c1 < c0 - 0.3, 'centre ' + c1.toFixed(2));
      // a sculpt stroke on top is baked into the baseline and the cap still holds
      // (a bunker on another hole just outside the fairway, untouched by the stroke, must be dug again after the fairway re-runs)
      const bh = courseHoles[0] === hh ? courseHoles[1] : courseHoles[0];
      const bpts = []; for (let k = 0; k < 8; k++) bpts.push({ x: -46 + 3 * Math.cos(k / 8 * 6.283), y: 0, z: 150 + 3 * Math.sin(k / 8 * 6.283) });
      const bsn = window.captureBunkerSnapshot(bh, bpts, 15);
      const bkd = { id: 'bk_f', points: bpts, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: bsn.baseElevation, bbox: bsn.bbox, origHeights: bsn.origHeights, origCanvasPixels: bsn.origCanvasPixels };
      bh.bunkers = [bkd]; bh.bunkerData = bkd; bh.activeBunkerIndex = 0;
      window.applyBunkerPipeline(bh, false, false, bkd);
      const bDip = function () { return window.getTerrainHeight(-46, 150) - window.getTerrainHeight(-46, 159); };
      const bDip0 = bDip();
      // and one on the fairway's own hole: the fairway edit re-attaches it itself, it must not be dug a second time on top
      const bpts2 = []; for (let k = 0; k < 8; k++) bpts2.push({ x: -46 + 3 * Math.cos(k / 8 * 6.283), y: 0, z: 138 + 3 * Math.sin(k / 8 * 6.283) });
      const bsn2 = window.captureBunkerSnapshot(hh, bpts2, 15);
      const bkd2 = { id: 'bk_f2', points: bpts2, depth: 0.8, lipHeight: 0, shape: 'FLAT', sandColor: '#e0d8a4', edgeSharpness: 100, baseElevation: bsn2.baseElevation, bbox: bsn2.bbox, origHeights: bsn2.origHeights, origCanvasPixels: bsn2.origCanvasPixels };
      hh.bunkers = [bkd2]; hh.bunkerData = bkd2; hh.activeBunkerIndex = 0;
      window.applyBunkerPipeline(hh, false, false, bkd2);
      const bDip2 = function () { return window.getTerrainHeight(-46, 138) - window.getTerrainHeight(-46, 129); };
      const bDip20 = bDip2();
      const pre = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 2 * Math.exp(-((x - 15) * (x - 15) + (z - 150) * (z - 150)) / 18); }
      const redone = window.reanchorStudiosAfterSculpt(pre);
      check('fairway re-run after sculpt keeps the cap', redone >= 1 && maxSlope() <= 0.10, 'redone ' + redone + ' max ' + (maxSlope() * 100).toFixed(1) + ' %');
      check('bunker on another hole beside a re-run fairway is dug again (dip ' + bDip0.toFixed(2) + ' -> ' + bDip().toFixed(2) + ')', bDip0 < -0.3 && bDip() < bDip0 + 0.25, 'dip0 ' + bDip0.toFixed(2) + ' now ' + bDip().toFixed(2));
      check('bunker on the fairway\'s own hole is dug once, not twice (dip ' + bDip20.toFixed(2) + ' -> ' + bDip2().toFixed(2) + ')', bDip20 < -0.3 && Math.abs(bDip2() - bDip20) < 0.2, 'dip0 ' + bDip20.toFixed(2) + ' now ' + bDip2().toFixed(2));
      hh.bunkers = []; hh.bunkerData = null; hh.activeBunkerIndex = null;
      bh.bunkers = []; bh.bunkerData = null; bh.activeBunkerIndex = null;
      // cap off: stroke baked, ground follows the sculpt (no stale restore)
      fd.maxSlopePct = 0; window.applyFairwayPipeline(hh, false, false, fd);
      check('cap off restores the natural hill incl. the sculpt', Math.abs(centre() - c0) < 0.1 && window.getTerrainHeight(15, 150) > 2, 'centre ' + centre().toFixed(2));
      // water tool: bake-only into the fairway baseline, no re-run
      fd.maxSlopePct = 8; window.applyFairwayPipeline(hh, false, false, fd);
      const preW = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] -= 1.5 * Math.exp(-((x - 25) * (x - 25) + (z - 150) * (z - 150)) / 8); }
      const wBefore = window.getTerrainHeight(25, 150), oiW = (Math.round(150 + 300) - fd.bbox.gzStart) * fd.bbox.gWidth + (Math.round(25 + 300) - fd.bbox.gxStart), origW = fd.origHeights[oiW];
      const rW = window.reanchorStudiosAfterSculpt(preW, { bakeFairwaysOnly: true });
      check('water dug in a capped fairway is baked into its baseline', rW === 0 && fd.origHeights[oiW] < origW - 1 && Math.abs(window.getTerrainHeight(25, 150) - wBefore) < 1e-6, 'd=' + (fd.origHeights[oiW] - origW).toFixed(2));
      const lim = (function () { const N = 128, hh2 = new Float32Array(N * N), ww = new Float32Array(N * N); for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { const X = x - 64, Z = z - 64; hh2[z * N + x] = 8 * Math.exp(-(X * X + Z * Z) / 392); ww[z * N + x] = (x > 5 && x < N - 5 && z > 5 && z < N - 5) ? 1 : 0; } return window.limitHeightSlope(hh2, ww, N, N, 0.08, 1, 3000, 2000); })();
      const lim2 = (function () { const N = 60, hh2 = new Float32Array(N * N), ww = new Float32Array(N * N); for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { hh2[z * N + x] = x < 10 ? x * 3 : 0; ww[z * N + x] = (x >= 20 && x < 50 && z > 5 && z < 55) ? 1 : 0; } return window.limitHeightSlope(hh2, ww, N, N, 0.08, 1, 3000, 2000); })();
      check('steep locked padding does not count as non-convergence', lim2.converged && lim2.iters <= 3, JSON.stringify(lim2));
      // reported maxSlope must be the real maximum over the weighted grid (direct scan, all four cells per vertex)
      const direct = (function () { const N = 128, hh2 = new Float32Array(N * N), ww = new Float32Array(N * N); for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { const X = x - 64, Z = z - 64; hh2[z * N + x] = 8 * Math.exp(-(X * X + Z * Z) / 392); ww[z * N + x] = (x > 5 && x < N - 5 && z > 5 && z < N - 5) ? ((x < 12 || x > N - 13) ? 0.5 : 1) : 0; } const r = window.limitHeightSlope(hh2, ww, N, N, 0.08, 1, 3000, 3000); let m = 0; for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) for (const sx of [-1, 1]) for (const tz of [-1, 1]) { const i = z * N + x, jx = z * N + x + sx, jz = (z + tz) * N + x; if (ww[i] + ww[jx] + ww[jz] <= 0) continue; m = Math.max(m, Math.hypot(hh2[i] - hh2[jx], hh2[i] - hh2[jz])); } return { r: r, m: m }; })();
      check('limiter reports the true maximum gradient', direct.r.converged && direct.m <= 0.08 * 1.051 && Math.abs(direct.r.maxSlope - direct.m) < 0.002, 'scan ' + (direct.m * 100).toFixed(2) + ' % reported ' + (direct.r.maxSlope * 100).toFixed(2) + ' %');
      check('slope limiter converges on a broad 8 m hill and reports it', lim.converged && lim.maxSlope < 0.085, JSON.stringify(lim));
      // a loaded course has no _isSculpted flag: switching the cap off must still restore the natural ground
      delete fd._isSculpted; window.syncFairwaySculptFlag(fd);
      fd.maxSlopePct = 0; window.applyFairwayPipeline(hh, false, false, fd);
      check('switching off a loaded cap restores the baseline', window.getTerrainHeight(0, 150) > 3.9, 'centre ' + window.getTerrainHeight(0, 150).toFixed(2));
      // terrain stamp / mountain tools are wrapped: a hill added inside the fairway is baked into its baseline
      check('mountain and stamp tools bake into fairway baselines', ['applyTerrainStamp', 'executeRidgeMountain', 'executeSplineMountain'].every(function (nme) { return typeof window[nme] === 'function' && window[nme]._fairwayBaking === true; }));
      const pre3 = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 1 * Math.exp(-((x + 20) * (x + 20) + (z - 150) * (z - 150)) / 18); }
      const h3 = window.getTerrainHeight(-20, 150);
      check('plain fairway: stroke is baked without re-running', window.reanchorStudiosAfterSculpt(pre3) === 0 && Math.abs(window.getTerrainHeight(-20, 150) - h3) < 1e-6);
    })();

    // blueprint "yellow" sites: strict planner says no, shaping mode says yes (with how much ground moves); a cliff stays red
    (function () {
      const HG = window.HoleGenerator;
      const plan = HG.planFor(4, 12345), origin = { x: -150, z: 150 }, heading = 0.3;
      const wp0 = HG.worldPlan(plan, origin, heading), gc = wp0.greenCenter;
      const flatEnv = function (hillH) { return { half: 300, others: { points: [], polygons: [] }, parts: HG.normalizeParts(null), heightAt: function (x, z) { return hillH * Math.exp(-((x - gc.x) * (x - gc.x) + (z - gc.z) * (z - gc.z)) / (2 * 7 * 7)); } }; };
      const strict = HG.evaluateSite(plan, origin, heading, flatEnv(2.2));
      const e2 = flatEnv(2.2); e2.allowShaping = true;
      const yellow = HG.evaluateSite(plan, origin, heading, e2);
      const e3 = flatEnv(12); e3.allowShaping = true;
      const cliff = HG.evaluateSite(plan, origin, heading, e3);
      const e4 = flatEnv(0); e4.allowShaping = true;
      const flat = HG.evaluateSite(plan, origin, heading, e4);
      check('hill under the green: strict planner rejects', !strict.ok && /green_/.test(strict.reasons[0]), JSON.stringify(strict.reasons));
      check('hill under the green: shaping mode accepts it as yellow with a cut depth', yellow.ok && yellow.shaped && yellow.shaped.indexOf('green') >= 0 && yellow.work.green > 0.3 && yellow.work.green <= 3, JSON.stringify([yellow.shaped, yellow.work]));
      // a bowl with a high rim: the plateau is built at the rim's height, so the real cut is deeper than the footprint's own mean suggests
      const bowl = flatEnv(0); bowl.allowShaping = true; bowl.heightAt = function (x, z) { return 4 * (1 - Math.exp(-((x - gc.x) * (x - gc.x) + (z - gc.z) * (z - gc.z)) / 72)); };
      const bowlEv = HG.evaluateSite(plan, origin, heading, bowl);
      check('bowl with a high rim is measured against the built plateau (red)', !bowlEv.ok, JSON.stringify([bowlEv.reasons, bowlEv.work]));
      // the builders' sliders count: a raised green plateau moves the ground further than the planner's default assumes
      const lifted = flatEnv(2.2); lifted.allowShaping = true; lifted.lift = { green: 3, tee: 0.5 };
      const liftedEv = HG.evaluateSite(plan, origin, heading, lifted);
      check('Green Studio elevation offset is included in the shaping work (red when it adds too much)', !liftedEv.ok, JSON.stringify([liftedEv.reasons, liftedEv.work]));
      const sliderEnv = HG.siteEnv(null, { allowShaping: true });
      check('siteEnv reads the builders\' sliders for the plateau offsets', sliderEnv.lift && typeof sliderEnv.lift.green === 'number' && typeof sliderEnv.lift.tee === 'number', JSON.stringify(sliderEnv.lift));
      // flat ground does not excuse a big elevation offset: the builder still cuts/fills that much
      const flatLifted = flatEnv(0); flatLifted.allowShaping = true; flatLifted.lift = { green: 4, tee: 0.5 };
      const flatLiftedEv = HG.evaluateSite(plan, origin, heading, flatLifted);
      check('flat ground with a 4 m green elevation offset is red', !flatLiftedEv.ok, JSON.stringify(flatLiftedEv.reasons));
      const flatTee = flatEnv(0); flatTee.allowShaping = true; flatTee.lift = { green: 0, tee: 4 };
      check('flat ground with a 4 m tee raise is red', !HG.evaluateSite(plan, origin, heading, flatTee).ok);
      // tilt and difficulty relief are built on top of the plateau: a site just under the limit goes over it
      const nearEnv = flatEnv(3.6); nearEnv.allowShaping = true;
      const nearEv = HG.evaluateSite(plan, origin, heading, nearEnv);
      const reliefEnv = flatEnv(3.6); reliefEnv.allowShaping = true; reliefEnv.greenRelief = { tilt: 0.02, amp: 0.33 };
      const reliefEv = HG.evaluateSite(plan, origin, heading, reliefEnv);
      check('green tilt + difficulty relief counts towards the shaping limit', nearEv.ok && nearEv.work.green > 2.4 && !reliefEv.ok, JSON.stringify([nearEv.work, reliefEv.reasons]));
      check('a 12 m cliff stays red even when shaping is allowed', !cliff.ok, JSON.stringify(cliff.reasons));
      // full build from a yellow blueprint site: green flat, fairway capped
      (function () {
        const p2 = planeGeo.attributes.position.array, n2 = planeGeo.attributes.position.count;
        const mid = wp0.centerline[Math.floor(wp0.centerline.length / 2)];
        for (let i = 0; i < n2; i++) { const x = p2[i * 3], z = -p2[i * 3 + 1]; p2[i * 3 + 2] = 2.2 * Math.exp(-((x - gc.x) ** 2 + (z - gc.z) ** 2) / 98) + 4 * Math.exp(-((x - mid.x) ** 2 + (z - mid.z) ** 2) / 200); }
        planeGeo.attributes.position.needsUpdate = true; planeGeo.computeVertexNormals(); if (window._terrainChunks) window._terrainChunks.syncAll();
        // earlier checks used the first holes: clear the last one so the generator sees an empty hole
        const idx = courseHoles.length - 1, eh = courseHoles[idx];
        eh.greenData = null; eh.fairways = []; eh.fairwayData = null; eh.bunkers = []; eh.bunkerData = null; eh.teeBoxes = []; eh.teeData = null; eh.flag = null; eh.aimPoint = null; eh.plannedGreen = null;
        if (!HG.holeIsEmpty(eh)) { check('yellow site builds (needs an empty hole)', false, 'hole not empty'); return; }
        window.changeHoleTo(idx);
        const hole = courseHoles[idx];
        const built = HG.generate({ par: 4, seed: 12345, placement: { x: origin.x, z: origin.z, heading: heading } });
        let lo = 1e9, hi = -1e9;
        for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const x = gc.x + a * 2, z = gc.z + b * 2; if (HG.inPoly(x, z, wp0.green)) { const y = window.getTerrainHeight(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); } }
        check('yellow site builds: green is flat, fairway has the slope cap', !!built && hole.greenData && hi - lo < 0.05 && hole.fairways[0] && hole.fairways[0].maxSlopePct === 10, 'spread ' + (hi - lo).toFixed(3) + ' cap ' + (hole.fairways[0] && hole.fairways[0].maxSlopePct));
        // a second, unshaped job must not inherit a leftover cap
      (function () {
        const p3 = planeGeo.attributes.position.array, n3 = planeGeo.attributes.position.count;
        for (let i = 0; i < n3; i++) p3[i * 3 + 2] = 0;
        planeGeo.attributes.position.needsUpdate = true; planeGeo.computeVertexNormals(); if (window._terrainChunks) window._terrainChunks.syncAll();
        const idx2 = courseHoles.length - 2, eh2 = courseHoles[idx2];
        eh2.greenData = null; eh2.fairways = []; eh2.fairwayData = null; eh2.bunkers = []; eh2.bunkerData = null; eh2.teeBoxes = []; eh2.teeData = null; eh2.flag = null; eh2.aimPoint = null; eh2.plannedGreen = null;
        window.changeHoleTo(idx2);
        window._fairwayMaxSlopePct = 10;
        const plan2 = HG.planFor(4, 777), env2 = HG.siteEnv(null, { allowShaping: true });
        let spot = null;
        for (let hd = 0; hd < 6.3 && !spot; hd += 0.5) for (let ox = -240; ox <= 240 && !spot; ox += 40) for (let oz = -240; oz <= 240 && !spot; oz += 40) { const e2 = HG.evaluateSite(plan2, { x: ox, z: oz }, hd, env2); if (e2.ok) spot = { x: ox, z: oz, heading: hd }; }
        const b2 = spot ? HG.generate({ par: 4, seed: 777, placement: spot }) : null;
        check('an unshaped blueprint job does not inherit a leftover fairway cap', !!b2 && eh2.fairways[0] && !(eh2.fairways[0].maxSlopePct > 0), 'cap ' + (eh2.fairways[0] && eh2.fairways[0].maxSlopePct));
        window._fairwayMaxSlopePct = 0;
        // a fairway built by hand while the controls still hold an old cap starts with the cap off
        eh2.fairways = []; eh2.fairwayData = null;
        window._fairwayMaxSlopePct = 10; window._fairwayMaxSlopeAlongPct = 15;
        smartGreenPoints = [{ x: -60, y: 0, z: -60 }, { x: -40, y: 0, z: -60 }, { x: -40, y: 0, z: -20 }, { x: -60, y: 0, z: -20 }];
        window.executeSmartFairway();
        const fwNew = eh2.fairways[0];
        check('a new fairway starts with the slope cap off, even if the controls held one', !!fwNew && !(fwNew.maxSlopePct > 0) && !(fwNew.maxSlopeAlongPct > 0) && window._fairwayMaxSlopePct === 0 && window._fairwayMaxSlopeAlongPct === 0, 'cap ' + (fwNew && fwNew.maxSlopePct) + '/' + (fwNew && fwNew.maxSlopeAlongPct));
      })();
      // full-screen dialogs inside #ui-layer (pointer-events: none) must take clicks themselves: the water-hazard buttons were dead
      (function () {
        const reach = function (modalId, btnId, show, hide) {
          show(); const m = document.getElementById(modalId), b = document.getElementById(btnId), r = b.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const ok = top === b || b.contains(top);
          hide(); return ok;
        };
        const pm = document.getElementById('penalty-decision-modal');
        const okPen = reach('penalty-decision-modal', 'penalty-btn-drop', function () { window.showPenaltyDecision('WATER'); }, function () { pm.style.display = 'none'; });
        const gm = document.getElementById('gallery-modal');
        const okGal = reach('gallery-modal', 'btn-gallery-publish', function () { gm.style.display = 'flex'; }, function () { gm.style.display = 'none'; });
        check('the water-hazard dialog buttons receive clicks', okPen);
        check('the publish gallery dialog buttons receive clicks', okGal);
      })();
      check('the fairway editor panel exists exactly once (a duplicate steals getElementById)', document.querySelectorAll('#sf-panel-built').length === 1 && document.querySelectorAll('#sf-max-along').length === 1 && document.querySelectorAll('#sf-max-slope').length === 1 && document.querySelectorAll('#gs-content-klippning').length === 1);
      const ctl = document.getElementById('sf-max-slope');
        check('after a yellow build the fairway control and the global cap agree', ctl && Number(ctl.value) === window._fairwayMaxSlopePct, 'control ' + (ctl && ctl.value) + ' global ' + window._fairwayMaxSlopePct);
      })();
      check('flat ground stays plain green (no shaping)', flat.ok && !(flat.shaped && flat.shaped.length));
    })();

    // blueprint overlay: the page must not move when the status changes between green, yellow and red while dragging
    await (async function () {
      const BP = window.HoleBlueprint;
      const eh3 = courseHoles[courseHoles.length - 3];
      eh3.greenData = null; eh3.fairways = []; eh3.fairwayData = null; eh3.bunkers = []; eh3.bunkerData = null; eh3.teeBoxes = []; eh3.teeData = null; eh3.flag = null; eh3.aimPoint = null; eh3.plannedGreen = null;
      window.changeHoleTo(courseHoles.length - 3);
      const p4 = planeGeo.attributes.position.array, n4 = planeGeo.attributes.position.count;
      for (let i = 0; i < n4; i++) { const x = p4[i * 3]; p4[i * 3 + 2] = 5 * Math.exp(-((x - 40) * (x - 40)) / 1250) + 3 * Math.exp(-((x + 90) * (x + 90) + (-p4[i * 3 + 1] - 60) * (-p4[i * 3 + 1] - 60)) / 450); }
      planeGeo.attributes.position.needsUpdate = true;
      BP.open();
      const S = BP.state();
      // open() starts an asynchronous search for a good spot (status "searching", detail row cleared): wait until it is done
      for (let w = 0; w < 80 && S.busy; w++) await new Promise(function (r) { setTimeout(r, 100); });
      // on a slow runner that search can run out of time and leave "no free spot" up; that note stays until the player touches the map
      // (as here, where the test moves the hole itself), so clear it as a touch does: the checks below are about the status of each spot
      S.note = null; S.noteBad = false;
      const sk = S.sketches[0], seen = {}, tops = [];
      sk.seed = 4242; sk.plan = window.HoleGenerator.planFor(sk.par, sk.seed); // the planner starts from a random seed: pin it so the test sees the same hole every run
      for (let hd = 0; hd < 6.3; hd += Math.PI / 4) for (let ox = -240; ox <= 240; ox += 40) for (let oz = -240; oz <= 240; oz += 40) {
        sk.origin = { x: ox, z: oz }; sk.heading = hd; BP.evaluate(0);
        const e = sk.ev, kind = !e.ok ? 'red' : ((e.shaped && e.shaped.length) ? 'yellow' : 'green');
        if (!seen[kind]) { seen[kind] = { status: S.dom.status.textContent, detail: S.dom.detail.textContent }; tops.push(Math.round(S.canvas.getBoundingClientRect().top) + '/' + Math.round(S.dom.status.getBoundingClientRect().height)); }
      }
      const all3 = !S.busy && seen.red && seen.yellow && seen.green;
      check('blueprint layout is identical for green, yellow and red status', all3 && tops.every(function (t) { return t === tops[0]; }), JSON.stringify([seen, tops, S.busy]));
      check('the yellow status shows what happens to the ground; green leaves the detail row empty; red only repeats a cut-off message', all3 && seen.yellow.detail.length > 3 && seen.green.detail === '' && (seen.red.detail === '' || seen.red.detail === seen.red.status) && /utplaning|reshaping/i.test(seen.yellow.status), JSON.stringify(seen));
      // a status that does not fit (short phones) must still be readable: the detail row carries the whole message
      sk.origin = { x: 4000, z: 4000 }; BP.evaluate(0);   // far outside the map: red, 'Utanför banan'
      S.dom.status.style.maxWidth = '36px';
      BP.evaluate(0);
      const narrow = { status: S.dom.status.textContent, detail: S.dom.detail.textContent };
      S.dom.status.style.maxWidth = '';
      check('a cut-off status is repeated in full in the detail row (touch screens)', narrow.status.length > 4 && narrow.detail === narrow.status, JSON.stringify(narrow));
      BP.close(false);
    })();

    // fairway sliders: dragging only moves the thumb and the label; the fairway is rebuilt once, when the slider is released
    await (async function () {
      const idxS = courseHoles.length - 2, hS = courseHoles[idxS];
      window.changeHoleTo(idxS);
      const fdS = hS.fairways && hS.fairways[0];
      if (!fdS || !window.FairwayStudio || typeof window.FairwayStudio.syncUIValues !== 'function') { check('fairway sliders rebuild on release only (needs a fairway)', false, 'no fairway on the test hole'); return; }
      hS.activeFairwayIndex = 0;
      const frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); };
      const orig = window.applyFairwayPipeline; let runs = 0;
      window.applyFairwayPipeline = function () { runs++; return orig.apply(this, arguments); };
      const results = [];
      for (const mode of ['change', 'cancel']) {
      for (const spec of [['sf-semirough-width', 'sf-semirough-val', 'semiRoughWidth', 3.5], ['sf-rough-width', 'sf-rough-val', 'roughWidth', 9], ['sf-max-slope', 'sf-max-slope-val', 'maxSlopePct', 7]]) {
        const el = document.getElementById(spec[0]), lab = document.getElementById(spec[1]);
        if (!el || !lab) { results.push(spec[0] + ' missing'); continue; }
        const before = fdS[spec[2]];
        runs = 0;
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        for (let v = Number(el.min) + 1; v <= spec[3]; v += Number(el.step)) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); window.FairwayStudio.syncUIValues(hS, fdS); }
        el.value = spec[3]; el.dispatchEvent(new Event('input', { bubbles: true })); window.FairwayStudio.syncUIValues(hS, fdS);
        await frame();
        const during = { runs: runs, prop: fdS[spec[2]], thumb: Number(el.value), label: lab.textContent };
        if (mode === 'change') { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }
        else el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })); // an interrupted touch: no change event follows
        await frame();
        const after = { runs: runs, prop: fdS[spec[2]] };
        if (!(during.runs === 0 && during.prop === before && during.thumb === spec[3] && /\d/.test(during.label) && after.runs === 1 && after.prop === spec[3])) results.push(mode + ' ' + spec[0] + ' ' + JSON.stringify({ before: before, during: during, after: after }));
        fdS[spec[2]] = before;
      }
      }
      window.applyFairwayPipeline = orig;
      check('fairway sliders (semi-rough, rough, max slope) do not rebuild while dragging, once on release or when the pointer is cancelled', results.length === 0, results.join(' | '));
    })();

    // mountain outline: open line while drawing, magnet closes it, never crosses itself (like green and fairway)
    await (async function () {
      if (appMode !== 'BUILD') { check('mountain outline checks need build mode', false, 'appMode ' + appMode); return; }
      window.setTool('MTN'); window._mtnToolMode = 'SPLINE'; window.clearSpline();
      camera.position.set(0, 420, 0.01); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); controls.update(); camera.updateMatrixWorld(true);
      const cv = renderer.domElement, rect = cv.getBoundingClientRect();
      const click = function (x, z) {
        const v = new THREE.Vector3(x, 0, z).project(camera);
        const o = { bubbles: true, button: 0, buttons: 1, clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width, clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height, pointerId: 1, pointerType: 'mouse' };
        cv.dispatchEvent(new PointerEvent('pointerdown', o));
        window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
      };
      const n = function () { return window.splinePoints.length; };
      [[-60, -60], [60, -60], [60, 60], [-60, 60]].forEach(function (c) { click(c[0], c[1]); });
      const open = { n: n(), closed: !!window._mtnClosed };
      click(0, -100);  // the segment from the 4th dot would cross the first one
      const afterCross = n();
      click(-57, -57); // near the first ball: the magnet closes the shape
      const closed = { n: n(), closed: !!window._mtnClosed };
      click(0, 0);     // a closed shape takes no more dots
      const afterClosed = n();
      check('mountain outline: open while drawing, a crossing dot is refused, the magnet closes it, a closed shape takes no more dots',
        open.n === 4 && !open.closed && afterCross === 4 && closed.n === 4 && closed.closed && afterClosed === 4, JSON.stringify([open, afterCross, closed, afterClosed]));
      check('mountain outline: dragging a ball across the outline is refused', window.moveWouldCross(window.splinePoints, 0, 0, 100, true) === true && window.moveWouldCross(window.splinePoints, 0, -50, -50, true) === false);
      // an OPEN hill is built closed: dragging a ball so that only the implicit closing edge would cross is refused too
      {
        window._mtnToolMode = 'SPLINE'; window.clearSpline();
        [[-60, -60], [60, -60], [60, 60], [-60, 60]].forEach(function (c) { click(c[0], c[1]); });
        const at2 = function (x, z) { const v = new THREE.Vector3(x, 0, z).project(camera); return { clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width, clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height }; };
        const startPos = { x: window.splinePoints[1].x, z: window.splinePoints[1].z };
        const dn = Object.assign({ bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' }, at2(60, -60));
        cv.dispatchEvent(new PointerEvent('pointerdown', dn));
        cv.dispatchEvent(new PointerEvent('pointermove', Object.assign({ bubbles: true, buttons: 1, pointerId: 1, pointerType: 'mouse' }, at2(-100, 0))));
        const moved = { x: window.splinePoints[1].x - startPos.x, z: window.splinePoints[1].z - startPos.z, closed: !!window._mtnClosed, n: n() };
        window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, dn, { buttons: 0 })));
        check('open hill: dragging a ball so that the closing edge would cross is refused', moved.x === 0 && moved.z === 0 && !moved.closed && moved.n === 4, JSON.stringify(moved));
        // back to the closed square used by the checks below
        window.clearSpline();
        [[-60, -60], [60, -60], [60, 60], [-60, 60]].forEach(function (c) { click(c[0], c[1]); });
        click(-57, -57);
      }
      // right-clicking a ball (or empty ground) removes a point and opens the closed outline again
      const rclick = function (x, z) {
        const v = new THREE.Vector3(x, 0, z).project(camera);
        cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width, clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height, pointerId: 1, pointerType: 'mouse' }));
      };
      rclick(-60, 60);
      const reopened = { n: n(), closed: !!window._mtnClosed };
      check('mountain outline: removing a ball (right-click on it) opens a closed outline again', reopened.n === 3 && reopened.closed === false, JSON.stringify(reopened));
      // the 3D preview of the hill: a see-through surface with the exact heights, redrawn when height / jaggedness change
      {
        const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const prevMesh = function () { return scene.children.find(function (o) { return o.isMesh && o.renderOrder === 996; }); };
        const topY = function (m) { const a = m.geometry.attributes.position.array; let t = -1e9; for (let i = 1; i < a.length; i += 3) t = Math.max(t, a[i]); return t; };
        const sig = function (m) { const a = m.geometry.attributes.position.array; let t = 0; for (let i = 1; i < a.length; i += 3) t += a[i]; return t; };
        // the coarse preview comes at once and the fine one a moment later: wait for the fine one (a slow runner can take well over the 180 ms)
        const fine = async function () { for (let k = 0; k < 100; k++) { const m = prevMesh(); if (m && m.userData.hillFinal) return m; await wait(50); } return prevMesh(); };
        const hs = document.getElementById('mtn-spline-height'), js = document.getElementById('mtn-spline-jagged');
        hs.value = 25; js.value = 0; js.dispatchEvent(new Event('input', { bubbles: true }));
        const m0 = await fine();
        const fld = window.mtnHillField(window.splinePoints, 25, 0);
        let fmax = -1e9; fld.inside.forEach(function (v) { fmax = Math.max(fmax, v.newH); });
        const ok0 = !!m0 && Math.abs(topY(m0) - (fmax + 0.15)) < 0.05;
        const sig0 = m0 ? sig(m0) : 0;
        js.value = 100; js.dispatchEvent(new Event('input', { bubbles: true }));
        const m1 = await fine();
        const ok1 = !!m1 && Math.abs(sig(m1) - sig0) > 1;
        // the preview replaces itself: exactly one mesh, none after the outline is cleared
        const count1 = scene.children.filter(function (o) { return o.isMesh && o.renderOrder === 996; }).length;
        js.value = 50; js.dispatchEvent(new Event('input', { bubbles: true }));
        check('hill preview: a 3D surface with the exact peak height, redrawn by the jaggedness slider, one mesh at a time', ok0 && ok1 && count1 === 1, JSON.stringify([ok0, ok1, count1, m0 && topY(m0), fmax + 0.15]));
      }
      // the preview does a bounded amount of work however detailed the outline is (samples x outline segments), also for extreme outlines
      {
        const wait2 = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const origField = window.mtnHillField, calls = [];
        window.mtnHillField = function () { const t = performance.now(); const f = origField.apply(this, arguments); calls.push({ stride: f.stride, inside: f.inside.length, work: f.work, ms: performance.now() - t, segs: Math.max(150, arguments[0].length * 30) }); return f; };
        const keep = window.splinePoints.map(function (p) { return p.clone(); }), keepClosed = window._mtnClosed;
        const res = [];
        for (const nPts of [80, 400, 1500]) {
          calls.length = 0;
          window.splinePoints.length = 0;
          for (let i = 0; i < nPts; i++) { const t = i / nPts * Math.PI * 2, rr = 140 * (0.8 + 0.2 * Math.sin(i * 2.3)); window.splinePoints.push(new THREE.Vector3(Math.cos(t) * rr, 0, Math.sin(t) * rr)); }
          window._mtnClosed = true;
          const t0 = performance.now(); window.refreshSplinePreview(); const syncMs = performance.now() - t0;
          await wait2(600);
          const draftC = calls[0], fullC = calls[calls.length - 1];
          const draftWork = draftC ? draftC.inside * draftC.segs : 1e12, fullWork = fullC ? fullC.inside * fullC.segs : 1e12;
          const slow = Math.max.apply(null, calls.map(function (c) { return c.ms; }));
          res.push({ n: nPts, calls: calls.length, draftWork: draftWork, fullWork: fullWork, syncMs: Math.round(syncMs), slowestFieldMs: Math.round(slow), ok: calls.length >= 2 && draftWork <= 1.2e6 && fullWork <= 9.6e6 && syncMs < 600 && slow < 600 });
        }
        // a thin, concave crescent: a big bounding box with very few vertices inside (the outside polygon tests must count too)
        {
          calls.length = 0;
          window.splinePoints.length = 0;
          const nC = 60;
          for (let i = 0; i <= nC / 2; i++) { const t = -2.3 + (i / (nC / 2)) * 4.6; window.splinePoints.push(new THREE.Vector3(Math.cos(t) * 150, 0, Math.sin(t) * 150)); }
          for (let i = nC / 2; i >= 0; i--) { const t = -2.3 + (i / (nC / 2)) * 4.6; window.splinePoints.push(new THREE.Vector3(Math.cos(t) * 143, 0, Math.sin(t) * 143)); }
          window._mtnClosed = true;
          window.refreshSplinePreview();
          await wait2(600);
          const workOf = function (c) { return c ? c.work : 1e12; };
          const dW = workOf(calls[0]), fW = workOf(calls[calls.length - 1]);
          res.push({ n: 'crescent', calls: calls.length, draftWork: dW, fullWork: fW, ok: calls.length >= 2 && dW <= 2.0e6 && fW <= 12e6 });
        }
        window.mtnHillField = origField;
        check('hill preview work is bounded by outline detail (80, 400, 1500 control balls and a thin crescent): draft and final stay within budget', res.every(function (r) { return r.ok; }), JSON.stringify(res));
        window.splinePoints.length = 0; keep.forEach(function (p) { window.splinePoints.push(p); }); window._mtnClosed = keepClosed; window.refreshSplinePreview();
      }
      // a coarse preview uses the build's scale: the heights of the vertices it samples equal the full-resolution ones
      {
        const full = window.mtnHillField(window.splinePoints, 25, 1, { stride: 1 }), coarse = window.mtnHillField(window.splinePoints, 25, 1, { stride: 4 });
        const byIdx = new Map(); full.inside.forEach(function (v) { byIdx.set(v.idx, v.newH); });
        let worstC = 0, nC = 0; coarse.inside.forEach(function (v) { nC++; worstC = Math.max(worstC, Math.abs(v.newH - byIdx.get(v.idx))); });
        check('a coarse preview (stride 4) has exactly the heights of the build at the vertices it samples', nC > 200 && Math.abs(full.maxD - coarse.maxD) < 1e-9 && worstC < 1e-6, 'n ' + nC + ' maxD ' + full.maxD + '/' + coarse.maxD + ' worst ' + worstC);
      }
      // build: a bow-tie is refused, the plain square is built
      const h0 = window.getTerrainHeight(0, 0);
      window.splinePoints.length = 0;
      [[-60, -60], [60, 60], [60, -60], [-60, 60]].forEach(function (c) { window.splinePoints.push(new THREE.Vector3(c[0], 0, c[1])); });
      window.executeSplineMountain();
      const afterBowtie = window.getTerrainHeight(0, 0);
      window.splinePoints.length = 0;
      [[-60, -60], [60, -60], [60, 60], [-60, 60]].forEach(function (c) { window.splinePoints.push(new THREE.Vector3(c[0], 0, c[1])); });
      const hv = parseFloat(document.getElementById('mtn-spline-height').value) || 25, jv = (parseFloat(document.getElementById('mtn-spline-jagged').value) || 0) / 50;
      const expected = window.mtnHillField(window.splinePoints, hv, jv);
      const dsc0 = window.debounceSaveCourse, savedAgain = { n: 0 };
      window.debounceSaveCourse = function () { savedAgain.n++; };
      window.executeSplineMountain();
      window.debounceSaveCourse = dsc0;
      check('mountain build saves again after its baselines were updated', savedAgain.n >= 1, 'n ' + savedAgain.n);
      const posA = planeGeo.attributes.position.array; let worst = 0;
      expected.inside.forEach(function (v) { worst = Math.max(worst, Math.abs(posA[v.idx * 3 + 2] - v.newH)); });
      check('what the preview computes is what the build writes (every vertex)', expected.inside.length > 1000 && worst < 1e-4, 'n ' + expected.inside.length + ' worst ' + worst);
      const afterSquare = window.getTerrainHeight(0, 0);
      check('mountain build refuses a crossing outline and builds a plain one', Math.abs(afterBowtie - h0) < 0.01 && afterSquare > h0 + 1, JSON.stringify([h0, afterBowtie, afterSquare]));
      // the hill-only preview controls (colour legend, mesh toggle) show for hills and are hidden for ridges
      const ctl = document.getElementById('mtn-hill-preview-ctl');
      window.setMtnMode('RIDGE'); const hiddenInRidge = ctl.style.display === 'none';
      window.setMtnMode('SPLINE'); const shownInHill = ctl.style.display !== 'none';
      check('hill preview controls are hidden in ridge mode and shown for hills', hiddenInRidge && shownInHill, JSON.stringify([hiddenInRidge, shownInHill]));
      window.setTool('MTN');
      // ridge: an open line, a dot that would cross it is refused
      window._mtnToolMode = 'RIDGE'; window.clearSpline();
      [[-60, -60], [60, -60], [60, 60]].forEach(function (c) { click(c[0], c[1]); });
      click(0, -100);
      check('ridge line: a dot that would cross the line is refused', n() === 3, 'n ' + n());
      window.clearSpline();
      // control balls without crossing, but the smoothed curve between sharp turns loops over itself: refused at build as well
      {
        const V = function (c) { return new THREE.Vector3(c[0], 0, c[1]); };
        const sumH = function () { let t = 0; for (let x = -150; x <= 150; x += 15) for (let z = -150; z <= 150; z += 15) t += window.getTerrainHeight(x, z); return t; };
        const ridge = [[-76, 77], [-3, 55], [-15, -8], [46, 56], [25, 99], [-21, 71], [23, 35]];
        window.splinePoints.length = 0; ridge.forEach(function (c) { window.splinePoints.push(V(c)); });
        const ridgeCtl = window.polylineSelfIntersects(window.splinePoints, false), ridgeSmooth = window.mtnOutlineCrosses(window.splinePoints, false);
        const hb = sumH(); window.executeRidgeMountain(); const ha = sumH();
        // a hill outline of the same kind (found with a fixed pseudo-random search)
        let seed = 12345, rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, hill = null;
        for (let k = 0; k < 4000 && !hill; k++) {
          const pts = []; for (let i = 0; i < 7; i++) pts.push([Math.round(rnd() * 160 - 80), Math.round(rnd() * 160 - 80)]);
          const ps = pts.map(V);
          if (!window.polylineSelfIntersects(ps, true) && window.mtnOutlineCrosses(ps, true)) hill = pts;
        }
        let hillOk = false, hillDetail = 'no sample found';
        if (hill) {
          window.splinePoints.length = 0; hill.forEach(function (c) { window.splinePoints.push(V(c)); });
          const b2 = sumH(); window.executeSplineMountain(); const a2 = sumH();
          hillOk = Math.abs(a2 - b2) < 0.01; hillDetail = JSON.stringify([hill, b2, a2]);
        }
        check('build refuses a ridge and a hill whose control balls are fine but whose smoothed curve loops over itself',
          !ridgeCtl && ridgeSmooth && Math.abs(ha - hb) < 0.01 && hillOk, JSON.stringify([ridgeCtl, ridgeSmooth, hb, ha, hillDetail]));
        window.clearSpline();
      }
      // freehand ridge stroke (drag): a loop in the stroke is refused, the line never crosses itself
      {
        const at = function (x, z) { const v = new THREE.Vector3(x, 0, z).project(camera); return { clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width, clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height }; };
        const o0 = Object.assign({ bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' }, at(-60, -60));
        cv.dispatchEvent(new PointerEvent('pointerdown', o0));
        const path = [[-60, -60], [60, -60], [60, 60], [-20, 60], [-20, -100]];
        let crossed = false, maxN = 0;
        for (let k = 1; k < path.length; k++) {
          const a0 = path[k - 1], b0 = path[k], steps = Math.ceil(Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) / 4);
          for (let t = 1; t <= steps; t++) {
            const x = a0[0] + (b0[0] - a0[0]) * t / steps, z = a0[1] + (b0[1] - a0[1]) * t / steps;
            cv.dispatchEvent(new PointerEvent('pointermove', Object.assign({ bubbles: true, buttons: 1, pointerId: 1, pointerType: 'mouse' }, at(x, z))));
            if (window.splinePoints.length >= 3 && window.polylineSelfIntersects(window.splinePoints, false)) crossed = true;
            maxN = Math.max(maxN, window.splinePoints.length);
          }
        }
        window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o0, { buttons: 0 })));
        check('ridge freehand stroke: the line never crosses itself (a loop is refused)', !crossed && maxN >= 3, 'crossed ' + crossed + ' maxN ' + maxN);
        window.clearSpline();
      }
    })();
    return out;
  }); } catch (e) { checks = [{ name: 'behaviour checks ran', ok: false, detail: String(e.message).split('\n')[0].slice(0, 160) }]; }
  // voice commands: say a phrase to the recogniser and the builder does what the button does
  try {
    const vc = await page.evaluate(async function () {
      const out = [];
      function check(name, ok, detail) { out.push({ name: name, ok: !!ok, detail: detail || '' }); }
      function say(text, final) { const r = window.__sr[window.__sr.length - 1]; const alt = [{ transcript: text }]; alt.isFinal = final !== false; r.onresult({ resultIndex: 0, results: [alt] }); }
      check('voice: the microphone button is mounted', !!document.getElementById('voice-btn') && !!window.VoiceCommands);
      setMode('BUILD'); await new Promise(function (r) { setTimeout(r, 1000); });
      const ctl = document.getElementById('voice-ctl');
      check('voice: the button shows in build mode', getComputedStyle(ctl).display !== 'none', getComputedStyle(ctl).display);
      document.getElementById('voice-lang').click(); const l1 = localStorage.getItem('golf_voice_lang');
      document.getElementById('voice-lang').click(); const l2 = localStorage.getItem('golf_voice_lang');
      check('voice: the language chip switches between English and Swedish', l1 !== l2 && (l1 === 'en' || l1 === 'sv'), l1 + ' ' + l2);
      if (l2 === 'en') document.getElementById('voice-lang').click(); // Swedish
      document.getElementById('voice-btn').click();
      const r0 = window.__sr[window.__sr.length - 1];
      check('voice: tapping the button starts listening in Swedish', r0 && r0.started === 1 && r0.lang === 'sv-SE' && document.getElementById('voice-btn').getAttribute('aria-pressed') === 'true', r0 && r0.lang);
      say('ändra green');
      check('voice: "ändra green" opens the green builder', window._smartBuilderType === 'GREEN' && window.currentTool === 'SMART_BUILDER', window._smartBuilderType + ' ' + window.currentTool);
      say('bunker'); check('voice: "bunker" switches the hole builder to bunker', window._smartBuilderType === 'BUNKER', window._smartBuilderType);
      say('change fairway'); check('voice: English phrases work while listening in Swedish', window._smartBuilderType === 'FAIRWAY', window._smartBuilderType);
      say('forma'); check('voice: "forma" selects the sculpt tool', window.currentTool === 'SCULPT', window.currentTool);
      say('måla', false); check('voice: a phrase that is not finished does nothing yet', window.currentTool === 'SCULPT', window.currentTool);
      say('måla'); check('voice: "måla" selects the paint tool', window.currentTool === 'PAINT', window.currentTool);
      const before = window.currentTool; say('jag tror att det blir regn'); check('voice: ordinary talk does nothing', window.currentTool === before);
      // the browser ends a session after a pause: a new one is started while the button is on
      const n = window.__sr.length; r0.onend(); await new Promise(function (r) { setTimeout(r, 500); });
      check('voice: listening restarts after the browser ends a session', window.__sr.length === n + 1 && window.__sr[n].started === 1);
      document.getElementById('voice-lang').click();
      const r2 = window.__sr[window.__sr.length - 1];
      check('voice: changing language restarts listening in English', r2.lang === 'en-US' && r2.started === 1 && document.getElementById('voice-btn').getAttribute('aria-pressed') === 'true', r2.lang);
      say('change green'); check('voice: "change green" opens the green builder', window._smartBuilderType === 'GREEN' && window.currentTool === 'SMART_BUILDER');
      window.__sr[window.__sr.length - 1].onerror({ error: 'not-allowed' });
      check('voice: a blocked microphone turns listening off', document.getElementById('voice-btn').getAttribute('aria-pressed') === 'false');
      // a failed microphone (not a pause) turns listening off for good instead of restarting
      document.getElementById('voice-btn').click();
      const rf = window.__sr[window.__sr.length - 1], nf = window.__sr.length;
      rf.onerror({ error: 'audio-capture' }); rf.onend && rf.onend(); await new Promise(function (r) { setTimeout(r, 600); });
      check('voice: a fatal recognition error turns listening off and does not restart', document.getElementById('voice-btn').getAttribute('aria-pressed') === 'false' && window.__sr.length === nf, document.getElementById('voice-btn').getAttribute('aria-pressed') + ' ' + (window.__sr.length - nf));
      document.getElementById('voice-btn').click();
      const rp = window.__sr[window.__sr.length - 1]; rp.onerror({ error: 'no-speech' });
      check('voice: a pause without speech keeps listening', document.getElementById('voice-btn').getAttribute('aria-pressed') === 'true');
      // hole navigation: an unfinished hole keeps its own "Finish hole" message, a finished one moves on (a course's rule: this page is a
      // range, where the holes only hold greens and the next one always opens, so the check runs as on a course)
      const wasRange = window._isRangeMode; window._isRangeMode = false;
      const h0 = courseHoles[0], keep = { tees: h0.tees, flag: h0.flag, aim: h0.aimPoint }, idx0 = window.currentHoleIndex;
      window.changeHoleTo(0); h0.tees = {}; h0.flag = null; h0.aimPoint = null;
      say('next hole'); await new Promise(function (r) { setTimeout(r, 100); });
      const tBlocked = (document.getElementById('build-toast') || {}).textContent || '';
      const stayed = window.currentHoleIndex === 0;
      h0.tees = { yellow: { x: 0, z: 0 } }; h0.flag = { x: 0, z: -8 }; h0.aimPoint = { x: 0, z: -4 };
      say('next hole'); await new Promise(function (r) { setTimeout(r, 100); });
      const moved = window.currentHoleIndex === 1, tMoved = (document.getElementById('build-toast') || {}).textContent || '';
      window.changeHoleTo(0); h0.tees = keep.tees; h0.flag = keep.flag; h0.aimPoint = keep.aim;
      window._isRangeMode = wasRange;
      check('voice: "next hole" keeps the Finish-hole message when the hole is unfinished and announces only a real move', stayed && /Finish Hole/.test(tBlocked) && moved && /Next hole|Nästa hål/.test(tMoved), JSON.stringify([stayed, tBlocked, moved, tMoved]));
      // "spara" says saved only when the write happened
      const sq = window.saveQuickDraft; const toastText = function () { const t = document.getElementById('build-toast'); return t ? t.textContent : ''; };
      window.saveQuickDraft = function () { return Promise.resolve({ ok: 1 }); }; say('spara'); await new Promise(function (r) { setTimeout(r, 100); }); const tOk = toastText();
      window.saveQuickDraft = function () { return Promise.resolve(null); }; say('spara'); await new Promise(function (r) { setTimeout(r, 100); }); const tNull = toastText();
      window.saveQuickDraft = function () { return Promise.reject(new Error('disk')); }; say('spara'); await new Promise(function (r) { setTimeout(r, 100); }); const tRej = toastText();
      window.saveQuickDraft = sq;
      check('voice: "spara" says saved only after a successful write', /Sparat|Saved/.test(tOk) && /Kunde inte spara|Could not save/.test(tNull) && /Kunde inte spara|Could not save/.test(tRej), JSON.stringify([tOk, tNull, tRej]));
      document.getElementById('voice-btn').click(); // off
      document.getElementById('voice-lang').click(); // back to what it was
      setMode('TEST'); await new Promise(function (r) { setTimeout(r, 1000); });
      check('voice: the button is hidden outside build mode', getComputedStyle(document.getElementById('voice-ctl')).display === 'none');
      return out;
    });
    checks = checks.concat(vc);
  } catch (e) { checks.push({ name: 'voice checks ran', ok: false, detail: String(e.message).split('\n')[0].slice(0, 160) }); }

  // The quick draft ("Snabbutkast") reopened while the page is still starting (slow device-id / network call before loadLevel):
  // saves that run during start-up must not overwrite the stored course with the empty default before it is read.
  let reopenStep = 'start';
  try {
    await page.close(); // the first page is done; its render loop would slow the two below
    await browser.close(); // and the pages below get a browser of their own (a clean profile: the stored draft is theirs alone)
    browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    await ctx2.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
      const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
      if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort();
    });
    await ctx2.route(/^https:\/\/(?!cdn)/, function (r) { r.abort(); });
    reopenStep = 'seed page'; const seed = await ctx2.newPage();
    await seed.goto(base + '/arcade.html?autorun=edit_build', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await seed.waitForFunction(function () { return window._courseLoading !== true; }, null, { timeout: 120000 });
    await seed.waitForTimeout(9000);
    const seeded = await seed.evaluate(async function () {
      courseHoles[0].flag = { x: 5, y: 0, z: 90 };
      await window.saveLevel(true, true);
      return !!(await window.ArcadeStorage.loadFullDraft('quick_draft')).holes[0].flag;
    });
    await seed.close();
    reopenStep = 'slow page'; const slow = await ctx2.newPage();
    // like production: the biome / asset lists answer quickly and the page applies them (which saves), the device-id call that
    // loadLevel waits for is slow
    await slow.route(base + '/api/**', async function (r) {
      const quick = /biome|asset/.test(r.request().url());
      await new Promise(function (res) { setTimeout(res, quick ? 300 : 3000); });
      r.fulfill({ status: 200, contentType: 'application/json', body: quick ? '[]' : '{}' });
    });
    await slow.goto(base + '/arcade.html?autorun=edit_build', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await slow.waitForFunction(function () { return window._courseLoading !== true; }, null, { timeout: 120000 });
    await slow.waitForTimeout(9000); // the delayed calls (3 s) and the load itself are done by now
    const reopened = await slow.evaluate(async function () { const d = await window.ArcadeStorage.loadFullDraft('quick_draft'); return { flag: !!courseHoles[0].flag, stored: !!(d && d.holes && d.holes[0].flag) }; });
    await slow.close();
    checks.push({ name: 'quick draft reopened while the page starts slowly keeps the course (start-up saves do not overwrite it)', ok: seeded && reopened.flag && reopened.stored, detail: JSON.stringify([seeded, reopened]) });
    // the device-id call never answers: the course is still read after a few seconds (the builder opens) and nothing overwrote it before that
    reopenStep = 'hung page'; const hung = await ctx2.newPage();
    await hung.route(base + '/api/auth/register', function () { /* never answered */ });
    await hung.goto(base + '/arcade.html?autorun=edit_build', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await hung.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
    await hung.waitForTimeout(3000);
    const hungState = await hung.evaluate(async function () { const d = await window.ArcadeStorage.loadFullDraft('quick_draft'); return { flag: !!courseHoles[0].flag, stored: !!(d && d.holes && d.holes[0].flag) }; });
    await hung.close();
    checks.push({ name: 'quick draft opens even when the device-id call hangs, and keeps the course', ok: hungState.flag && hungState.stored, detail: JSON.stringify(hungState) });
    reopenStep = 'prop picking page';
  // a prop buried under the ground (or a huge one behind it) is not under the pointer: it used to be picked through the terrain,
  // so the edit panel opened and closed on its own while the object was being changed
    // a page opened like the builder is (the range page used above handles clicks differently)
    const pp = await ctx2.newPage();
    await pp.goto(base + '/arcade.html?autorun=new_build&template=blank&biome=GLOBAL', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await pp.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
    await pp.waitForTimeout(4000);
    await pp.evaluate(function () { setMode('BUILD'); setTool('INSPECT'); });
    await pp.waitForTimeout(500);
    const setup = await pp.evaluate(function () {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const g = raycaster.intersectObject(plane);
      if (!g.length) return { ok: false };
      const p0 = g[0].point;
      const mk = function (type, y, h) {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(400, h, 400), new THREE.MeshBasicMaterial(), 1);
        mesh.propType = type; mesh.frustumCulled = false;
        mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(p0.x, y, p0.z)); mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh); mesh.updateMatrixWorld(true);
        window._propMeshes = (window._propMeshes || []).concat([mesh]);
        window.placedTrees.push({ type: type, x: p0.x, z: p0.z, y: 0, scale: 1, rot: 0 });
        return mesh;
      };
      window.__t = { n0: window.placedTrees.length, buried: mk('zz_buried', p0.y - 31, 60) };
      window.__pd = 0; renderer.domElement.addEventListener('pointerdown', function () { window.__pd++; }, true);
      const r = renderer.domElement.getBoundingClientRect(); // p0 is the point under the middle of the canvas
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      return { ok: isFinite(cx) && isFinite(cy), y: p0.y, cx: cx, cy: cy };
    });
    await pp.mouse.move(640, 380); await pp.waitForTimeout(100);
    await pp.mouse.move(500, 350); await pp.waitForTimeout(100);
    await pp.mouse.move(Math.round(await pp.evaluate(function () { return innerWidth / 2; })), Math.round(await pp.evaluate(function () { return innerHeight / 2; }))); await pp.waitForTimeout(200);
    const buried = await pp.evaluate(function () {
      const h = window._hoveredPropIndex;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); const raw = raycaster.intersectObjects(window._propMeshes).length; return { hover: h, raw: raw, direct: window.pickPropIndex ? window.pickPropIndex(raycaster, [plane, window.surroundPlane]) : 'none' };
    });
    await pp.mouse.move(setup.cx, setup.cy); await pp.waitForTimeout(150); await pp.mouse.click(setup.cx, setup.cy); await pp.waitForTimeout(300);
    const afterClick = await pp.evaluate(function () { return { sel: window.selectedPropIndex, panel: getComputedStyle(document.getElementById('prop-editor-panel')).display, pointerdowns: window.__pd }; });
    // a small prop buried deep (its geometry cannot be hit by the ray at all): a click next to its base must not pick it either; at ground level it is picked
    await pp.evaluate(function () {
      const t = window.__t; scene.remove(t.buried); window._propMeshes = window._propMeshes.filter(function (mm) { return mm !== t.buried; }); window.placedTrees.length = t.n0;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); const q = raycaster.intersectObject(plane)[0].point;
      window.placedTrees.push({ type: 'zz_small', x: q.x, z: q.z, y: q.y, yOffset: -45, scale: 1, rot: 0 });
      window.deselectProp();
    });
    await pp.mouse.click(setup.cx, setup.cy); await pp.waitForTimeout(300);
    const smallBuried = await pp.evaluate(function () { return { sel: window.selectedPropIndex, hidden: window.propIsHidden(window.placedTrees[window.placedTrees.length - 1]) }; });
    await pp.evaluate(function () { window.placedTrees[window.placedTrees.length - 1].yOffset = 0; window.deselectProp(); });
    await pp.mouse.click(setup.cx, setup.cy); await pp.waitForTimeout(300);
    const smallVisible = await pp.evaluate(function () { return { sel: window.selectedPropIndex, expect: window.placedTrees.length - 1 }; });
    checks.push({ name: 'a small prop buried deep is not picked by a click next to its base; at ground level it is', ok: smallBuried.hidden === true && smallBuried.sel == null && smallVisible.sel === smallVisible.expect, detail: JSON.stringify([smallBuried, smallVisible]) });
    // the same prop standing on the ground is picked
    const above = await pp.evaluate(function () {
      const t = window.__t; scene.remove(t.buried); window._propMeshes = window._propMeshes.filter(function (m) { return m !== t.buried; }); window.placedTrees.length = t.n0;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const p0 = raycaster.intersectObject(plane)[0].point;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 30, 6), new THREE.MeshBasicMaterial(), 1);
      mesh.propType = 'zz_above'; mesh.frustumCulled = false;
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(p0.x, p0.y + 8, p0.z)); mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh); mesh.updateMatrixWorld(true);
      window._propMeshes.push(mesh); window.placedTrees.push({ type: 'zz_above', x: p0.x, z: p0.z, y: 0, scale: 1, rot: 0 }); window.__t.above = mesh;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      return { idx: window.pickPropIndex ? window.pickPropIndex(raycaster, [plane, window.surroundPlane]) : -2, expect: window.placedTrees.length - 1 };
    });
    await pp.evaluate(function () { const t = window.__t; scene.remove(t.above); window._propMeshes = window._propMeshes.filter(function (m) { return m !== t.above; }); window.placedTrees.length = t.n0; window.deselectProp(); });
    // the brush mode of the props tool paints over props: a prop under the pointer does not swallow the click (single mode picks it)
    const modes = await pp.evaluate(function () {
      const n0 = window.placedTrees.length;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); const q = raycaster.intersectObject(plane)[0].point;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 40, 8), new THREE.MeshBasicMaterial(), 1);
      mesh.propType = 'zz_mode'; mesh.frustumCulled = false;
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(q.x, q.y + 10, q.z)); mesh.instanceMatrix.needsUpdate = true; scene.add(mesh); mesh.updateMatrixWorld(true);
      window._propMeshes.push(mesh); window.placedTrees.push({ type: 'zz_mode', x: q.x + 30, z: q.z, y: q.y, scale: 1, rot: 0 }); // anchor far from the click: only the ray can pick it
      window.__mode = { n0: n0, mesh: mesh, tool: window.currentTool, pm: window._propsToolMode };
      window.deselectProp(); window._propsToolMode = 'BRUSH'; setTool('PROPS');
      return n0;
    });
    await pp.mouse.click(setup.cx, setup.cy); await pp.waitForTimeout(300);
    const inBrush = await pp.evaluate(function () { return window.selectedPropIndex; });
    await pp.evaluate(function () { window.deselectProp(); window._propsToolMode = 'SINGLE'; });
    await pp.mouse.click(setup.cx, setup.cy); await pp.waitForTimeout(300);
    const inSingle = await pp.evaluate(function () { const r = { sel: window.selectedPropIndex, last: window.placedTrees.length - 1 }; const t = window.__mode; scene.remove(t.mesh); window._propMeshes = window._propMeshes.filter(function (mm) { return mm !== t.mesh; }); window.placedTrees.length = t.n0; window.deselectProp(); window._propsToolMode = t.pm; setTool('INSPECT'); return r; });
    checks.push({ name: 'a prop under the pointer is picked in single mode but does not swallow a click in the brush mode', ok: inBrush == null && inSingle.sel === inSingle.last, detail: JSON.stringify([modes, inBrush, inSingle]) });
    checks.push({ name: 'a prop buried under the ground is not hovered, and a click does not open the edit panel', ok: setup.ok && buried.raw > 0 && buried.hover == null && buried.direct === -1 && afterClick.pointerdowns === 1 && afterClick.sel == null && afterClick.panel === 'none', detail: JSON.stringify([setup, buried, afterClick]) });
    checks.push({ name: 'a prop standing on the ground is still picked', ok: above.idx === above.expect, detail: JSON.stringify(above) });
    // the 3D grass shells compile (a shader that does not compile draws no grass at all, without any page error) and the semi-rough has grass of its own
    const grass = await pp.evaluate(async function () {
      const errs = []; const oe = console.error; console.error = function () { errs.push(String(arguments[0]).slice(0, 160) + ' ' + String(arguments[arguments.length - 1]).slice(0, 200)); oe.apply(console, arguments); };
      window.setGrassQuality('MED');
      await new Promise(function (r) { setTimeout(r, 1500); });
      console.error = oe;
      const sh = window._terrainShells;
      // wind: the shells follow the game's wind (downwind = sin/-cos of the direction), a breeze when calm, none with Wind Sway off
      const m0 = window.currentWindMph, d0 = window.currentWindDir, u0 = sh.shells[0].mat.uniforms;
      window.currentWindMph = 0; sh.update(1, camera); const calm = u0.uWindStr.value;
      window.currentWindMph = 35; window.currentWindDir = 90; sh.update(2, camera);
      const wind = { calm: calm, storm: u0.uWindStr.value, dir: [u0.uWindDir.value.x, u0.uWindDir.value.y], time: u0.uTime.value };
      if (window.WindSway) { window.WindSway.setEnabled(false); sh.update(3, camera); wind.swayOff = u0.uWindStr.value; window.WindSway.setEnabled(true); }
      window.currentWindMph = m0; window.currentWindDir = d0;
      const nt = u0.uNoiseTex.value, nd = nt && nt.image.data;
      let nMin = 255, nMax = 0; if (nd) for (let i = 0; i < nd.length; i++) { nMin = Math.min(nMin, nd[i]); nMax = Math.max(nMax, nd[i]); }
      const noise = { w: nt && nt.image.width, min: nMin, max: nMax, shared: sh.shells.every(function (q) { return q.mat.uniforms.uNoiseTex.value === nt; }), touch: typeof window.isTouchDevice === 'function' && window.isTouchDevice() === false };
      return { errs: errs.filter(function (e) { return /shader|WebGLProgram/i.test(e); }), shells: sh.shells.length, semi: sh.semiHeight, rough: sh.roughHeight, deep: sh.deepHeight, u: sh.shells[0] && sh.shells[0].mat.uniforms.uSemiH.value, wind: wind, noise: noise };
    });
    // the closeness-to-border map the edge-weighted shells use: 1 at a fairway edge, 0 well inside the grass, and the switch reaches the shaders
    const edge = await pp.evaluate(async function () {
      const sh = window._terrainShells, px = function (x) { return Math.round((x / 600 + 0.5) * 4096); };
      window.pCtx.fillStyle = '#4a782b'; window.pCtx.fillRect(0, 0, 4096, 4096);
      window.pCtx.fillStyle = '#7db952'; window.pCtx.fillRect(px(-300), 0, px(0) - px(-300), 4096); // fairway on the left half
      window.terrainBiomeData = window.pCtx.getImageData(0, 0, 4096, 4096).data;
      window._roughMaskDirty = false; window.rebuildRoughMask();
      // with both edge features off (the default) the map is not built; switching one on builds it
      const lazy = { stale: sh._edgeStale === true, w: sh._edgeTex.image.width };
      const off = sh.shells[0].mat.uniforms.uEdgeOn.value; sh.setEdgeWeighted(true);
      lazy.built = sh._edgeTex.image.width === 1024;
      const t = sh._edgeTex, n = t.image.width, at = function (x) { return t.image.data[512 * n + Math.round((x / 600 + 0.5) * n)]; };
      const on = sh.shells[0].mat.uniforms.uEdgeOn.value;
      // the upper shells only have geometry in the border strip; the lowest one keeps the whole grid
      const full = sh.customGeo.index.count / 3, strip = sh.shells.filter(function (q) { return q.mesh.geometry !== sh.customGeo; });
      const g = strip[0] && strip[0].mesh.geometry, ix = g ? g.index.array : [], pos = sh.customGeo.attributes.position.array;
      let maxAbsX = 0; for (let i = 0; i < ix.length; i++) maxAbsX = Math.max(maxAbsX, Math.abs(pos[ix[i] * 3]));   // plane x = world x
      // every biome (rough and deep) has an interior shell as its canopy, within a shell step below its height, whatever the sliders say
      const canopy = []; for (const hs of [[0.30, 0.60], [0.20, 0.50], [0.45, 0.45], [0.35, 0.50]]) {
        sh.setHeights(hs[0], hs[1]); const mh = Math.max(hs[0], hs[1], sh.semiHeight);
        for (const h of [hs[0], hs[1]]) canopy.push(sh.shells.some(function (q) { const hh = q.layer / q.mat.uniforms.uLayers.value * mh; return q.mat.uniforms.uInterior.value > 0.5 && hh <= h * 1.0001 && hh >= h * 0.6; }));
      }
      sh.setHeights(0.30, 0.60);
      const stripInfo = { canopy: canopy, full: full, strip: g ? g.index.count / 3 : -1, upper: strip.length, shells: sh.shells.length, lowestFull: sh.shells[0].mesh.geometry === sh.customGeo, maxAbsX: maxAbsX, sharesVerts: !!g && g.attributes.position === sh.customGeo.attributes.position };
      // the terrain is sculpted: the strip's culling bounds follow the shared vertices (else the upper shells vanish on a new mountain)
      let boundsFollow = false;
      if (g && sh.masterGeo) {
        const mp = sh.masterGeo.attributes.position, before = g.boundingSphere ? g.boundingSphere.center.z : null, saved = mp.array.slice();
        for (let i = 2; i < mp.array.length; i += 3) mp.array[i] += 80;   // plane local z is the height
        sh.syncHeights();
        boundsFollow = g.boundingSphere && Math.abs(g.boundingSphere.center.z - sh.customGeo.boundingSphere.center.z) < 1e-6 && (before === null || g.boundingSphere.center.z > before + 40);
        mp.array.set(saved); sh.syncHeights();
      }
      stripInfo.boundsFollow = boundsFollow;
      sh.setEdgeWeighted(false); const back = sh.shells.every(function (q) { return q.mesh.geometry === sh.customGeo; });
      return { lazy: lazy, stripInfo: stripInfo, back: back, size: n, nextToEdge: at(0.3), mid: at(1.5), far: at(20), onFairway: at(-10), off: off, on: on, defaultOff: sh.edgeWeighted === false };
    });
    checks.push({ name: 'edge map: 1 next to a fairway edge, 0 far inside the grass; the edge switch reaches the shaders', ok: edge.lazy.stale && edge.lazy.w === 1 && edge.lazy.built && edge.size === 1024 && edge.nextToEdge > 150 && edge.mid > 40 && edge.mid < edge.nextToEdge && edge.far === 0 && edge.onFairway === 255 && edge.off === 0 && edge.on === 1 && edge.defaultOff, detail: JSON.stringify(edge) });
    const si = edge.stripInfo;
    checks.push({ name: 'edge strip: the upper shells only draw the border strip (few triangles, same vertices), the lowest one the whole grid; switching off restores all', ok: si.canopy.every(Boolean) && si.upper > 0 && si.upper < si.shells && si.lowestFull && si.sharesVerts && si.strip > 0 && si.strip < si.full * 0.15 && si.maxAbsX < 16 && si.boundsFollow && edge.back, detail: JSON.stringify(edge.stripInfo) });
    // edge blades: off by default; on, they stand along all four sides of a fairway rectangle (both axes), at the border
    const bl = await pp.evaluate(async function () {
      const sh = window._terrainShells, px = function (x) { return Math.round((x / 600 + 0.5) * 4096); }, pz = function (z) { return Math.round((z / 600 + 0.5) * 4096); };
      const defaultOff = sh.bladesOn === false && sh.blades.length === 0;
      window.pCtx.fillStyle = '#4a782b'; window.pCtx.fillRect(0, 0, 4096, 4096);
      window.pCtx.fillStyle = '#7db952'; window.pCtx.fillRect(px(-20), pz(-60), px(20) - px(-20), pz(-8) - pz(-60));
      window.terrainBiomeData = window.pCtx.getImageData(0, 0, 4096, 4096).data;
      window._roughMaskDirty = false; window.rebuildRoughMask();
      sh.setBlades(true);
      let n = 0, outside = 0, worst = 0, deepest = 0; const sides = { left: 0, right: 0, near: 0, far: 0 };
      for (const b of sh.blades) {
        const a = b.mesh.geometry.attributes.iBase.array;
        for (let i = 0; i < b.count; i++) {
          const x = a[i * 3], z = a[i * 3 + 2];
          const dx = Math.max(-20 - x, 0, x - 20), dz = Math.max(-60 - z, 0, z + 8), dist = Math.hypot(dx, dz);
          const depth = dist > 0 ? 0 : Math.min(x + 20, 20 - x, z + 60, -8 - z);   // how far inside the fairway rectangle
          n++; if (dist > 0) outside++; worst = Math.max(worst, dist); deepest = Math.max(deepest, depth);
          if (dist < 1.5 && x > -20.5 && x < 20.5 && z > -60.5 && z < -7.5 || dist < 1.5) {
            if (dx > 0 && x < 0) sides.left++; else if (dx > 0) sides.right++; else if (dz > 0 && z > -30) sides.near++; else if (dz > 0) sides.far++;
          }
        }
      }
      // the height sliders reach the blades that are already built
      const maxPer = function () { const m = [0, 0, 0]; for (const b of sh.blades) { const P = b.mesh.geometry.attributes.iParam.array, C = b.mesh.geometry.attributes.iClass.array; for (let i = 0; i < b.count; i++) m[C[i]] = Math.max(m[C[i]], P[i * 4]); } return m; };
      const h0 = [sh.roughHeight, sh.deepHeight], m0 = maxPer();
      sh.setHeights(h0[0] * 1.5, h0[1] * 0.5); const m1 = maxPer(); sh.setHeights(h0[0], h0[1]);
      const heightRatio = m0.map(function (v, i) { return v ? +(m1[i] / v).toFixed(2) : -1; });
      // the terrain was raised: the roots move up and so does the culling sphere (else the blades vanish on a new hill)
      const realH = window.getTerrainHeight, y0 = sh.blades[0].mesh.geometry.boundingSphere.center.y;
      window.getTerrainHeight = function () { return 50; };
      sh._scheduleBladeHeights(); await new Promise(function (r) { setTimeout(r, 500); });
      window.getTerrainHeight = realH;
      const y1 = sh.blades[0].mesh.geometry.boundingSphere.center.y;
      const edgeFormat = sh._edgeTex.format === THREE.LuminanceFormat;   // WebGL1 has no RED texture format
      // the blades see the water map like the shells do (no grass in water)
      const fakeWater = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat), keepWater = sh.waterTex;
      sh.waterTex = fakeWater; sh._updateBlades(null, 0, 1, 0, 1, 1, 1, 0.5, 0.5, 0.5); const waterWired = sh._bladeMat.uniforms.uWaterMap.value === fakeWater && sh._bladeMat.uniforms.uWorld.value > 0;
      sh.waterTex = keepWater;
      // a mask repaint followed by a shell refresh (what every load / undo / paint does) builds the blades once, not twice
      let builds = 0; const ob = sh._buildBlades; sh._buildBlades = function () { builds++; return ob.apply(this, arguments); };
      window._roughMaskDirty = false; window.rebuildRoughMask(); sh.refresh(); await new Promise(function (r) { setTimeout(r, 100); });
      sh._buildBlades = ob;
      const rebuiltBlades = sh.blades.length;
      const chunks = sh.blades.length, vis = sh.blades.filter(function (b) { return b.mesh.visible; }).length;
      sh.setBlades(false); const cleared = sh.blades.length === 0;
      return { defaultOff: defaultOff, n: n, outsideShare: n ? outside / n : 0, worst: +worst.toFixed(2), deepest: +deepest.toFixed(2), sides: sides, chunks: chunks, cleared: cleared, heightRatio: heightRatio, y0: +y0.toFixed(1), y1: +y1.toFixed(1), edgeFormat: edgeFormat, builds: builds, rebuiltBlades: rebuiltBlades, waterWired: waterWired };
    });
    checks.push({ name: 'edge blades: off by default; on, they stand at the border along all four fairway sides, not out on the fairway', ok: bl.defaultOff && bl.n > 500 && bl.worst < 1.5 && bl.deepest < 0.45 && bl.sides.left > 50 && bl.sides.right > 50 && bl.sides.near > 50 && bl.sides.far > 50 && bl.cleared && bl.heightRatio[0] === 1.5 && bl.y1 > bl.y0 + 40 && bl.edgeFormat && bl.builds === 1 && bl.waterWired && bl.rebuiltBlades > 0, detail: JSON.stringify(bl) });
    // the blade texture on the deep rough: off by default, loads when switched on and reaches every shell; no shader errors
    const gt = await pp.evaluate(async function () {
      const sh = window._terrainShells, errs = []; const oe = console.error; console.error = function () { errs.push(String(arguments[0]).slice(0, 160)); oe.apply(console, arguments); };
      const defaultOff = sh.grassTexOn === false && sh.shells.every(function (q) { return q.mat.uniforms.uTexOn.value === 0; });
      sh.setGrassTex(true);
      for (let i = 0; i < 50 && !sh._grassTexReady; i++) await new Promise(function (r) { setTimeout(r, 100); });
      await new Promise(function (r) { setTimeout(r, 600); });
      const on = sh._grassTexReady && sh.shells.every(function (q) { return q.mat.uniforms.uTexOn.value === 1 && q.mat.uniforms.uGrassTex.value === sh._grassTex; });
      const w = sh._grassTex && sh._grassTex.image && sh._grassTex.image.width;
      // the second tile: loads on its own and replaces the first on the shells
      const firstTex = sh._grassTex; sh.setGrassTex(true, 2);
      for (let i = 0; i < 50 && !sh._grassTexReady; i++) await new Promise(function (r) { setTimeout(r, 100); });
      const second = sh._grassTexReady && sh._grassTex !== firstTex && sh._grassTex.image.width === 1024 && sh.shells.every(function (q) { return q.mat.uniforms.uGrassTex.value === sh._grassTex; });
      sh.setGrassTex(true, 1);
      const backToFirst = sh._grassTex === firstTex;
      // the brightness slider: a live uniform on every shell, kept over a rebuild, back to 1 afterwards
      sh.setGrassTexLift(1.4);
      const liftLive = sh.shells.every(function (q) { return q.mat.uniforms.uTexLift.value === 1.4; });
      sh.refresh();
      const liftKept = sh.shells.length > 0 && sh.shells.every(function (q) { return q.mat.uniforms.uTexLift.value === 1.4; });
      sh.setGrassTexLift(1.0);
      sh.setGrassTex(false); sh.refresh();   // a rebuild after switching off must not bring the texture back
      const off = sh.shells.length > 0 && sh.shells.every(function (q) { return q.mat.uniforms.uTexOn.value === 0; });
      console.error = oe;
      return { liftLive: liftLive, liftKept: liftKept, second: second, backToFirst: backToFirst, defaultOff: defaultOff, on: on, off: off, w: w, errs: errs.filter(function (e) { return /shader|WebGLProgram/i.test(e); }) };
    });
    // sculpting: the 3D grass follows the ground while the stroke is going on, not only on release (else it sinks into a rising hill)
    const live = await pp.evaluate(async function () {
      const sh = window._terrainShells, mp = sh.masterGeo.attributes.position.array, cp = sh.customGeo.attributes.position.array, saved = mp.slice();
      const shellH = function (x, z) { const segs = sh.customGeo.parameters.widthSegments, size = window.TERRAIN_SIZE || 600, st = size / segs; const j = Math.round((x + size / 2) / st), i = Math.round((size / 2 + z) / st); return cp[(i * (segs + 1) + j) * 3 + 2]; };
      const before = shellH(40, -40);
      for (let i = 0; i < mp.length; i += 3) { const d = Math.hypot(mp[i] - 40, -mp[i + 1] + 40); if (d < 25) mp[i + 2] += 3 * Math.pow(Math.cos(d / 25 * Math.PI / 2), 2); }
      sh.masterGeo.attributes.position.needsUpdate = true;
      sh.queueRegionSync(40, -40, 25);
      await new Promise(function (r) { setTimeout(r, 300); });
      const during = shellH(40, -40), ground = window.getTerrainHeight(40, -40);
      // a fast drag: only the far end of the corridor is queued as a box, both ends must follow
      const farBefore = shellH(40, -64);
      for (let i = 0; i < mp.length; i += 3) { if (Math.abs(mp[i] - 40) < 4 && Math.abs(-mp[i + 1] + 64) < 4) mp[i + 2] += 2; }
      sh.queueRegionBounds(36, 44, -68, -36);
      await new Promise(function (r) { setTimeout(r, 300); });
      const farAfter = shellH(40, -64);
      mp.set(saved); sh.syncHeights();
      return { before: +before.toFixed(2), during: +during.toFixed(2), ground: +ground.toFixed(2), farRise: +(farAfter - farBefore).toFixed(2) };
    });
    checks.push({ name: 'sculpt: the 3D grass follows the ground during the stroke (not only on release)', ok: live.during > live.before + 2.5 && Math.abs(live.during - live.ground) < 0.3 && live.farRise > 1, detail: JSON.stringify(live) });
    checks.push({ name: 'grass texture on the deep rough: off by default, loads and reaches all shells when switched on, switches off again', ok: gt.defaultOff && gt.on && gt.second && gt.backToFirst && gt.liftLive && gt.liftKept && gt.off && gt.w === 1024 && gt.errs.length === 0, detail: JSON.stringify(gt) });
    // rebuilding the edge strip must not make the renderer delete the vertex buffers it shares with the full-grid shells
    // (the grass then stopped following the sculpted ground after a page reload)
    const sd = await pp.evaluate(async function () {
      const sh = window._terrainShells; sh.setEdgeWeighted(true);
      const old = sh._stripGeo; if (!old) return { hadStrip: false };
      let attrsAtDispose = -1; old.addEventListener('dispose', function () { attrsAtDispose = Object.keys(old.attributes).length; });
      sh._buildStrip();
      return { hadStrip: true, attrsAtDispose: attrsAtDispose, replaced: sh._stripGeo !== old, newStripOk: !!sh._stripGeo && sh._stripGeo.attributes.position === sh.customGeo.attributes.position };
    });
    checks.push({ name: 'edge strip: rebuilding it does not dispose the vertex buffers shared with the full-grid shells', ok: sd.hadStrip && sd.attrsAtDispose === 0 && sd.replaced && sd.newStripOk, detail: JSON.stringify(sd) });
    // 2D grass cards: off by default; on, chunks of tufts stand on the grass (the right half, the left is fairway) around the camera,
    // the shader compiles, dropping a chunk keeps the shared template buffers, and the menu buttons switch and remember them
    const cards = await pp.evaluate(async function () {
      const sh = window._terrainShells, errs = [], oe = console.error;
      console.error = function () { errs.push(String(arguments[0]).slice(0, 160)); oe.apply(console, arguments); };
      const out = { defaultOff: sh.cardsOn === false && sh.cards.size === 0 };
      if (sh.quality === 'OFF') window.setGrassQuality('MED');
      const px = function (x) { return Math.round((x / 600 + 0.5) * 4096); };
      window.pCtx.fillStyle = '#4a782b'; window.pCtx.fillRect(0, 0, 4096, 4096);
      window.pCtx.fillStyle = '#7db952'; window.pCtx.fillRect(px(-300), 0, px(0) - px(-300), 4096); // fairway on the left half
      window.terrainBiomeData = window.pCtx.getImageData(0, 0, 4096, 4096).data;
      window._roughMaskDirty = false; window.rebuildRoughMask();
      const cam = new THREE.PerspectiveCamera(55, 1.5, 0.05, 2000); cam.position.set(6, 2, 0); cam.lookAt(12, 0, -6); cam.updateMatrixWorld(true);
      window.setGrassExtra('cards', '1');
      for (let i = 0; i < 80; i++) sh.update(i / 30, cam);
      let n = 0, onFairway = 0, far = 0, badClass = 0;
      const reach = sh._cardPreset().radius + 16 * 1.42;
      for (const c of sh.cards.values()) {
        if (!c.mesh) continue;
        const g = c.mesh.geometry, b = g.attributes.iBase.array, k = g.attributes.iClass.array;
        for (let i = 0; i < c.count; i++) {
          n++;
          if (b[i * 3] < -0.6) onFairway++;
          if (Math.hypot(b[i * 3] - 6, b[i * 3 + 2]) > reach) far++;
          if (!(k[i] === 0 || k[i] === 1 || k[i] === 2)) badClass++;
        }
      }
      Object.assign(out, { n: n, chunks: sh.cards.size, onFairway: onFairway, far: far, badClass: badClass });
      renderer.render(scene, cam);
      // dropping a chunk frees only its own data: the shared template attributes are taken off before dispose
      const first = Array.from(sh.cards.values()).find(function (c) { return c.mesh; });
      let attrsAtDispose = -1;
      if (first) { const g = first.mesh.geometry, d = g.dispose.bind(g); g.dispose = function () { attrsAtDispose = ('position' in g.attributes) || ('uv' in g.attributes) ? 1 : 0; d(); }; }
      sh._clearCards();
      out.attrsAtDispose = attrsAtDispose; out.tplKept = !!sh._cardTpl && sh._cardTpl.pos.array.length === 24;
      for (let i = 0; i < 80; i++) sh.update(i / 30, cam);
      out.rebuilt = sh.cards.size === out.chunks;
      const btn = document.getElementById('grass-x-cards-1');
      out.shown = !!btn && btn.style.background.replace(/\s/g, '') === 'rgb(74,222,128)';
      out.stored = localStorage.getItem('golf_grass_cards') === '1';
      window.setGrassExtra('cards', '0');
      out.off = sh.cardsOn === false && sh.cards.size === 0 && localStorage.getItem('golf_grass_cards') === '0';
      console.error = oe;
      out.errs = errs.filter(function (e) { return /shader|WebGLProgram/i.test(e); });
      return out;
    });
    checks.push({ name: '2D grass cards: off by default; on, tufts stand on the grass around the camera (not on the fairway), compile, keep the shared template on a drop, and the buttons switch and remember them', ok: cards.defaultOff && cards.n > 500 && cards.onFairway === 0 && cards.far === 0 && cards.badClass === 0 && cards.attrsAtDispose === 0 && cards.tplKept && cards.rebuilt && cards.shown && cards.stored && cards.off && cards.errs.length === 0, detail: JSON.stringify(cards) });
    // the 2D grass's own sliders, per class: shown while it is on; rough and deep rough each their amount (0-600 %, rebuilt on release)
    // and height (a live uniform per class, nothing rebuilt), semi-rough on / off (then as the rough); clamped and remembered.
    // A class map with three 10 m bands (rough, deep rough, semi-rough) makes each class countable on its own.
    const ct = await pp.evaluate(async function () {
      const sh = window._terrainShells, out = {};
      const cam = new THREE.PerspectiveCamera(55, 1.5, 0.05, 2000); cam.position.set(6, 2, 0); cam.lookAt(12, 0, -6); cam.updateMatrixWorld(true);
      const perClass = function () { const n = [0, 0, 0]; for (const c of sh.cards.values()) { if (!c.mesh) continue; const k = c.mesh.geometry.attributes.iClass.array; for (let i = 0; i < c.count; i++) n[k[i]]++; } return n; };
      const build = function () { for (let i = 0; i < 80; i++) sh.update(i / 30, cam); return perClass(); };
      const tune = document.getElementById('grass-cards-tuning');
      window.setGrassExtra('cards', '0');
      out.hiddenOff = !!tune && tune.style.display === 'none';
      window.setGrassExtra('cards', '1');
      out.shownOn = tune.style.display === 'block';
      const clsWas = sh._cls, cls = new Uint8Array(1024 * 1024);
      for (let cx = 0; cx < 1024; cx++) { const x = (cx + 0.5) / 1024 * 600 - 300, c = x >= 0 && x < 10 ? 1 : (x >= 10 && x < 20 ? 2 : (x >= 20 && x < 30 ? 3 : 0)); if (c) for (let cz = 0; cz < 1024; cz++) cls[cz * 1024 + cx] = c; }
      sh._cls = cls; sh._clearCards();
      const n1 = build();
      window.setGrassCardTuning('deep', 'amount', '6', false);
      out.labelOnly = sh.cardTune.deep.amount === 1 && document.getElementById('grass-cards-deep-amount-val').textContent === '600%';
      window.setGrassCardTuning('deep', 'amount', '6', true);
      out.dropped = sh.cards.size === 0;
      window.setGrassCardTuning('rough', 'amount', '0.5', true);
      window.setGrassCardSemi(false);
      const n2 = build();
      out.ratios = n1.map(function (v, i) { return v ? +(n2[i] / v).toFixed(2) : null; });
      window.setGrassCardTuning('rough', 'height', '0.6', true);
      window.setGrassCardTuning('deep', 'height', '2.4', true);
      sh.update(3, cam);
      const u = sh._cardMat && sh._cardMat.uniforms.uCardH.value;
      out.uniform = !!u && Math.abs(u.x - 0.6) < 1e-9 && Math.abs(u.y - 2.4) < 1e-9 && Math.abs(u.z - 0.6) < 1e-9;
      out.noRebuild = JSON.stringify(perClass()) === JSON.stringify(n2);
      out.stored = localStorage.getItem('golf_grass_cards_deep_amount') === '6' && localStorage.getItem('golf_grass_cards_rough_amount') === '0.5' && localStorage.getItem('golf_grass_cards_deep_height') === '2.4' && localStorage.getItem('golf_grass_cards_semi') === '0';
      sh.setCardTuning('deep', 'amount', 10); sh.setCardTuning('rough', 'height', 0.1); sh.setCardTuning('rough', 'amount', -1);
      out.clamped = sh.cardTune.deep.amount === 6 && sh.cardTune.rough.height === 0.25 && sh.cardTune.rough.amount === 0;
      window.syncGrassExtraUI();
      out.synced = document.getElementById('grass-cards-deep-amount').value === '6' && document.getElementById('grass-cards-rough-height-val').textContent === '25%' &&
        document.getElementById('grass-cards-semi-0').style.background.replace(/\s/g, '') === 'rgb(74,222,128)';
      renderer.render(scene, cam);
      ['rough', 'deep'].forEach(function (c) { sh.setCardTuning(c, 'amount', 1); sh.setCardTuning(c, 'height', 1); ['amount', 'height'].forEach(function (k) { localStorage.removeItem('golf_grass_cards_' + c + '_' + k); }); });
      sh.setCardSemi(true); localStorage.removeItem('golf_grass_cards_semi');
      sh._cls = clsWas; sh._clearCards();
      window.setGrassExtra('cards', '0');
      Object.assign(out, { n1: n1, n2: n2 });
      return out;
    });
    checks.push({ name: '2D grass sliders per class: shown while it is on; rough 50 % halves the rough tufts, deep rough 600 % gives six times the deep tufts, semi-rough off leaves none there (applied on release); heights are a live uniform per class (nothing rebuilt); clamped and remembered', ok: ct.hiddenOff && ct.shownOn && ct.n1[0] > 300 && ct.n1[1] > 300 && ct.n1[2] > 300 && ct.labelOnly && ct.dropped && ct.ratios[0] > 0.4 && ct.ratios[0] < 0.6 && ct.ratios[1] > 5.4 && ct.ratios[1] < 6.6 && ct.n2[2] === 0 && ct.uniform && ct.noRebuild && ct.stored && ct.clamped && ct.synced, detail: JSON.stringify(ct) });
    // the 2D grass runs without the 3D grass: its own level (AUTO = the 3D grass's, MED while that is off), the class map is built for
    // it with the 3D grass off, and its menu section shows while the 3D grass controls are hidden
    const dc = await pp.evaluate(async function () {
      const sh = window._terrainShells, out = {};
      const cam = new THREE.PerspectiveCamera(55, 1.5, 0.05, 2000); cam.position.set(6, 2, 0); cam.lookAt(12, 0, -6); cam.updateMatrixWorld(true);
      const count = function () { let n = 0; for (const c of sh.cards.values()) n += c.count; return n; };
      const qWas = sh.quality;
      window.setGrassQuality('OFF');
      sh._cls = null;   // as on a page that never had the 3D grass on
      window.setGrassExtra('cards', '1');
      out.shells = sh.shells.length;
      out.classMap = !!sh._cls;
      for (let i = 0; i < 80; i++) sh.update(i / 30, cam);
      out.autoLevel = sh.cardLevel();
      out.nOff = count();
      // (the Environment panel itself is closed here: the section is outside the 3D grass controls, which are hidden, and not hidden itself)
      const sec = document.getElementById('grass-cards-section'), hc = document.getElementById('grass-height-controls');
      out.section = !!sec && sec.style.display !== 'none' && !hc.contains(sec) && hc.style.display === 'none' && document.getElementById('grass-cards-tuning').style.display === 'block';
      window.setGrassCardQuality('LOW');
      out.dropped = sh.cards.size === 0;
      for (let i = 0; i < 80; i++) sh.update(i / 30, cam);
      out.lowLevel = sh.cardLevel(); out.nLow = count();
      out.stored = localStorage.getItem('golf_grass_cards_q') === 'LOW';
      out.btn = document.getElementById('grass-cq-LOW').style.background.replace(/\s/g, '') === 'rgb(74,222,128)';
      // sculpting with the 3D grass off: the stroke's syncHeights rebuilds the tufts from the new ground
      // (the chunks are dropped 300 ms after the last change; the page's own render loop builds them again around its camera at once, so
      // the drop is watched, not an empty map: wait for it, at most 3 s on a slow machine)
      let drops = 0; const clr = sh._clearCards; sh._clearCards = function () { drops++; return clr.apply(this, arguments); };
      sh.syncHeights();
      for (let w = 0; w < 30 && !drops; w++) await new Promise(function (r) { setTimeout(r, 100); });
      sh._clearCards = clr;
      out.sculptRebuild = drops > 0;
      // repainted while both grass modes were off: switching the 2D grass on again rebuilds the class map from the fresh mask
      window.setGrassExtra('cards', '0');
      let rebuilt = 0; const rb = window.rebuildRoughMask; window.rebuildRoughMask = function () { rebuilt++; return rb.apply(this, arguments); };
      window._roughMaskDirty = true;
      window.setGrassExtra('cards', '1');
      window.rebuildRoughMask = rb;
      out.repaintRebuild = rebuilt === 1 && window._roughMaskDirty === false;
      window.setGrassCardQuality('AUTO'); window.setGrassQuality('HIGH');
      out.followsHigh = sh.cardLevel() === 'HIGH';
      renderer.render(scene, cam);
      window.setGrassExtra('cards', '0'); localStorage.removeItem('golf_grass_cards_q');
      window.setGrassQuality(qWas);
      return out;
    });
    checks.push({ name: '2D grass without the 3D grass: tufts are built from a class map made for it, its level follows the 3D grass (MED while off) or its own (LOW: fewer tufts, remembered), it follows a sculpt and a repaint made while it was off, and its menu section shows', ok: dc.shells === 0 && dc.classMap && dc.autoLevel === 'MED' && dc.nOff > 500 && dc.section && dc.dropped && dc.lowLevel === 'LOW' && dc.nLow > 0 && dc.nLow < dc.nOff && dc.stored && dc.btn && dc.sculptRebuild && dc.repaintRebuild && dc.followsHigh, detail: JSON.stringify(dc) });
    // the three extra grass modes have buttons in Environment > 3D Grass, which switch the mode, show it and remember it
    const gx = await pp.evaluate(async function () {
      const sh = window._terrainShells, st = function (k, v) { const b = document.getElementById('grass-x-' + k + '-' + v); return !!b && b.style.background.replace(/\s/g, '') === 'rgb(74,222,128)'; };
      const out = { hasButtons: !!document.getElementById('grass-x-edge-1') && !!document.getElementById('grass-x-blades-1') && !!document.getElementById('grass-x-tex-2') };
      // the option labels follow the language
      const prevLang = localStorage.getItem('golf_os_lang') || 'en';
      window.setGolfLanguage('en'); out.en = document.getElementById('grass-x-edge-0').textContent + '/' + document.getElementById('grass-x-edge-1').textContent + '/' + document.getElementById('grass-x-tex-2').textContent;
      window.setGolfLanguage('sv'); out.sv = document.getElementById('grass-x-edge-0').textContent + '/' + document.getElementById('grass-x-edge-1').textContent + '/' + document.getElementById('grass-x-tex-2').textContent;
      window.setGolfLanguage(prevLang);
      window.setGrassExtra('edge', '1'); window.setGrassExtra('blades', '1'); window.setGrassExtra('tex', '2');
      out.on = sh.edgeWeighted === true && sh.bladesOn === true && sh.grassTexOn === true && sh.grassTexVariant === 2;
      out.shown = st('edge', '1') && st('blades', '1') && st('tex', '2') && !st('edge', '0') && !st('tex', '0');
      out.stored = localStorage.getItem('golf_grass_edge') === '1' && localStorage.getItem('golf_grass_blades') === '1' && localStorage.getItem('golf_grass_tex') === '2';
      window.setGrassExtra('edge', '0'); window.setGrassExtra('blades', '0'); window.setGrassExtra('tex', '0');
      out.off = sh.edgeWeighted === false && sh.bladesOn === false && sh.grassTexOn === false && st('edge', '0') && st('blades', '0') && st('tex', '0');
      out.storedOff = localStorage.getItem('golf_grass_edge') === '0' && localStorage.getItem('golf_grass_blades') === '0' && localStorage.getItem('golf_grass_tex') === '0';
      return out;
    });
    checks.push({ name: 'grass menu: buttons for edge layers, edge blades and grass pattern switch the mode, show it and remember it', ok: gx.hasButtons && gx.en === 'Off/On/Pattern 2' && gx.sv === 'Av/På/Mönster 2' && gx.on && gx.shown && gx.stored && gx.off && gx.storedOff, detail: JSON.stringify(gx) });
    // seasons and weather: each season picks its own particles (the desert ones are sand dust, not the leaves or snow the name match found),
    // and overcast is not the same as clear (a little haze, dimmer light)
    const sw = await pp.evaluate(async function () {
      const lg = console.log, said = []; console.log = function () { said.push(String(arguments[0]) + ' ' + String(arguments[1] || '')); lg.apply(console, arguments); };
      const label = function (b) { said.length = 0; window.changeBiome(b); const m = said.filter(function (t) { return /ParticleEngine\] Biome/.test(t); })[0]; return m ? m.replace(/^.*Biome: /, '').replace(/ \|.*$/, '').trim() : 'none'; };
      const seasons = {}; ['AUTUMN', 'WINTER', 'DESERT', 'DESERT_AUTUMN', 'DESERT_WINTER'].forEach(function (b) { seasons[b] = label(b); });
      window.changeBiome('GLOBAL');
      const G = window.G, amb = function () { return G.ambientLight.intensity; };
      window.ParticleEngine.setWeather('CLEAR'); const fogClear = scene.fog.near, ambClear = amb();
      window.ParticleEngine.setWeather('OVERCAST'); const fogOver = scene.fog.near, ambOver = amb();
      const w = window.ParticleEngine.getWeather();
      // the dimming starts from the light of the current hour, not from one remembered from another hour (noon light on a night scene)
      window.setTimeOfDay(12); window.ParticleEngine.setWeather('OVERCAST');
      window.setTimeOfDay(0); window.ParticleEngine.setWeather('CLEAR'); const night = amb();
      window.ParticleEngine.setWeather('OVERCAST'); const nightOver = amb();
      window.setTimeOfDay(12); window.ParticleEngine.setWeather('CLEAR');
      console.log = lg;
      return { seasons: seasons, w: w, nightOk: Math.abs(nightOver - night * 0.85) < 0.01, night: +night.toFixed(3), nightOver: +nightOver.toFixed(3), hazier: fogOver < fogClear, dimmer: ambOver < ambClear, fogClear: +fogClear.toFixed(1), fogOver: +fogOver.toFixed(1), ambClear: +ambClear.toFixed(2), ambOver: +ambOver.toFixed(2) };
    });
    checks.push({ name: 'seasons and weather: the desert seasons get sand dust (not leaves or snow), autumn and winter keep theirs, and overcast is hazier and dimmer than clear, at night too', ok: /Sand/.test(sw.seasons.DESERT) && /Sand/.test(sw.seasons.DESERT_AUTUMN) && /Sand/.test(sw.seasons.DESERT_WINTER) && /Snow/.test(sw.seasons.WINTER) && sw.seasons.AUTUMN === 'none' && sw.w === 'OVERCAST' && sw.hazier && sw.dimmer && sw.nightOk, detail: JSON.stringify(sw) });
    // the daylight is a little yellow in the summer worlds (the greens read fresher), white in winter, and the night keeps its blue light
    const sun = await pp.evaluate(function () {
      const d = window.G.dirLight.color, col = function () { return [+d.r.toFixed(3), +d.g.toFixed(3), +d.b.toFixed(3)]; };
      window.changeBiome('GLOBAL'); window.setTimeOfDay(12); const summer = col();
      window.changeBiome('WINTER'); const winter = col();   // a biome change moves the warmth by itself
      window.changeBiome('GLOBAL'); const back = col();
      window.setTimeOfDay(0); const night = col();
      window.setTimeOfDay(12);
      window.changeBiome('DESERT_AUTUMN'); const autumn = col(); window.changeBiome('DESERT_SUNSET'); const sunset = col();   // the old name of the same biome
      window.changeBiome('GLOBAL');
      return { summer: summer, winter: winter, back: back, night: night, autumn: autumn, sunset: sunset };
    });
    checks.push({ name: 'warm sun: yellow noon light in the summer world, white in winter, back again with the biome, the night light is exactly the night preset, and the old DESERT_SUNSET name warms like DESERT_AUTUMN', ok: sun.summer[0] === 1 && sun.summer[1] < 0.97 && sun.summer[2] < sun.summer[1] - 0.1 && sun.winter.every(function (v) { return v > 0.999; }) && sun.back.join() === sun.summer.join() && sun.night[2] > sun.night[0] + 0.3 && Math.abs(sun.night[0] - 68 / 255) < 0.003 && Math.abs(sun.night[1] - 102 / 255) < 0.003 && Math.abs(sun.night[2] - 170 / 255) < 0.003 && sun.autumn[2] < 1 && sun.sunset.join() === sun.autumn.join(), detail: JSON.stringify(sun) });
    // a database row (saved from the admin page) can lack oceanColor and horizonColor: they come from the built-in palette of the same name,
    // not from the biome that was active before (the horizon of autumn stayed on after going back to summer)
    const rowFill = await pp.evaluate(function () {
      const B = window.CLOUD_BIOMES, orig = B.GLOBAL, cur = function () { return [window.CURRENT_BIOME_CONFIG.horizonColor, window.CURRENT_BIOME_CONFIG.oceanColor]; };
      const row = {}; Object.keys(orig).forEach(function (k) { if (k !== 'oceanColor' && k !== 'horizonColor') row[k] = orig[k]; });
      B.GLOBAL = row;
      window.changeBiome('AUTUMN'); const autumn = cur();
      window.changeBiome('GLOBAL'); const back = cur();
      B.GLOBAL = orig; window.changeBiome('GLOBAL');
      return { autumn: autumn, back: back, builtin: [window.BUILTIN_BIOMES.GLOBAL.horizonColor, window.BUILTIN_BIOMES.GLOBAL.oceanColor], hasCopy: !!window.BUILTIN_BIOMES };
    });
    checks.push({ name: 'biome rows: a database row without ocean and horizon colours gets the built-in ones (summer after autumn is summer again)', ok: rowFill.hasCopy && rowFill.autumn[0] !== rowFill.back[0] && rowFill.back.join() === rowFill.builtin.join(), detail: JSON.stringify(rowFill) });
    checks.push({ name: '3D grass: the turf noise is a baked texture shared by all shells; the wind (and a calm breeze) reaches them, Wind Sway off stills them; a desktop is not a touch device', ok: grass.noise.w === 256 && grass.noise.min < 40 && grass.noise.max > 215 && grass.noise.shared && grass.noise.touch && Math.abs(grass.wind.calm - 0.12) < 1e-6 && Math.abs(grass.wind.storm - 0.8) < 1e-6 && Math.abs(grass.wind.dir[0] - 1) < 1e-6 && Math.abs(grass.wind.dir[1]) < 1e-6 && grass.wind.time === 2 && grass.wind.swayOff === 0, detail: JSON.stringify({ wind: grass.wind, noise: grass.noise }) });
    checks.push({ name: '3D grass shells compile, and semi-rough is lower than rough and deep rough', ok: grass.errs.length === 0 && grass.shells === 5 && grass.semi > 0 && grass.semi < grass.rough && grass.rough < grass.deep && grass.u === grass.semi, detail: JSON.stringify(grass) });
    await pp.close();

  } catch (e) { checks.push({ name: 'quick draft reopen check ran', ok: false, detail: 'step ' + reopenStep + ': ' + String(e.message).split('\n')[0].slice(0, 160) }); }

  // The driving range: the range tee keeps the heading it was turned to, launch-monitor shots during a flight are played next,
  // offline is measured across the aim line, a hand-set aim stays, and a range reopened without "mode=range" in the address is still a range
  let rangeStep = 'start';
  try {
    const ctx3 = await browser.newContext({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    await ctx3.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
      const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
      if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort();
    });
    await ctx3.route(/^https:\/\/(?!cdn)/, function (r) { r.abort(); });
    rangeStep = 'range builder'; const rp = await ctx3.newPage();
    const rangeErrors = []; rp.on('pageerror', function (e) { rangeErrors.push(e.message.slice(0, 120)); });
    await rp.goto(base + '/arcade.html?autorun=new_build&mode=range', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await rp.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
    await rp.waitForTimeout(4000);
    rangeStep = 'range builder tools';
    const rb = await rp.evaluate(async function () {
      setMode('BUILD');
      const vis = function (id) { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
      document.getElementById('tool-hole').click();   // the Range Tee has its own button again
      camera.position.set(0, 60, 40); controls.target.set(0, 0, 0); controls.update(); camera.updateMatrixWorld(true);
      const under = localGetTerrainAt(0, 0);
      const v = new THREE.Vector3(0, 0, 0).project(camera), rect = renderer.domElement.getBoundingClientRect();
      const o = { bubbles: true, button: 0, buttons: 1, clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width, clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height, pointerId: 1, pointerType: 'mouse' };
      renderer.domElement.dispatchEvent(new PointerEvent('pointermove', o));
      renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', o));
      window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
      await new Promise(function (r) { setTimeout(r, 300); });
      const h = courseHoles[currentHoleIndex], placed = !!h.tees.range;
      const from = currentHoleIndex; window.changeHole(1); const to = currentHoleIndex; window.changeHoleTo(from);
      return { tool: currentTool, btn: vis('tool-hole'), flyout: vis('left-flyout-toolbar'), under: under && under.type, placed: placed,
               mat: placed && h.teeMeshes.range.children.some(function (c) { return c.userData && c.userData.rangeMat; }),
               coloured: vis('btn-set-tee-yellow'), par: getComputedStyle(document.getElementById('hole-ui-par').parentElement).display, nextHole: from + '->' + to };
    });
    checks.push({ name: 'range builder: the Range Tee has its own button, goes on any dry ground with its own hitting mat, no par or coloured tees, and the next hole opens (for more greens)',
      ok: rb.tool === 'HOLE' && rb.btn !== 'none' && rb.flyout === 'none' && rb.under !== 'TEE' && rb.placed && rb.mat && rb.coloured === 'none' && rb.par === 'none' && rb.nextHole === '0->1', detail: JSON.stringify(rb) });
    rangeStep = 'turn the tee';
    const turned = await rp.evaluate(function () {
      setMode('BUILD');
      const pos = planeGeo.attributes.position.array; for (let i = 0; i < planeGeo.attributes.position.count; i++) pos[i * 3 + 2] = 0;
      planeGeo.attributes.position.needsUpdate = true; planeGeo.computeBoundingSphere(); planeGeo.computeBoundingBox();
      const h = courseHoles[currentHoleIndex];
      h.tees.range = { x: 0, y: 0, z: 0, rot: Math.PI };
      if (h.teeMeshes.range) scene.remove(h.teeMeshes.range);
      h.teeMeshes.range = new THREE.Group(); scene.add(h.teeMeshes.range);
      camera.position.set(0, 160, 80); camera.lookAt(0, 0, -20); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      const cv = renderer.domElement, rect = cv.getBoundingClientRect(), out = {};
      [170, -150, 60].forEach(function (deg) {
        const th = deg * Math.PI / 180, wp = new THREE.Vector3(Math.sin(th) * 50, 0, Math.cos(th) * 50).project(camera);
        (0, eval)('activeRotatingTee = "range"; lastHitPoint = new THREE.Vector3(0, 0, 0);');
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + (wp.x + 1) / 2 * rect.width, clientY: rect.top + (1 - wp.y) / 2 * rect.height, pointerType: 'mouse' }));
        const r = h.tees.range.rot;
        out[deg] = Math.round(Math.atan2(Math.sin(r - th), Math.cos(r - th)) * 180 / Math.PI);   // heading error, degrees
      });
      (0, eval)('activeRotatingTee = null;');
      return out;
    });
    checks.push({ name: 'range tee: the heading it is turned to is the heading it keeps, also past 90° (it used to point the other way)', ok: Object.keys(turned).every(function (k) { return Math.abs(turned[k]) <= 3; }), detail: JSON.stringify(turned) });
    rangeStep = 'launch monitor shots';
    await rp.evaluate(function () {
      const h = courseHoles[currentHoleIndex];
      h.tees.range.rot = Math.PI / 2;   // the range points along +X: offline is then across X, not along it
      setMode('TEST');
      ArcadeStorage.setHudPrefs(['TOTAL_LENGTH', 'CARRY', 'OFFLINE']); window.renderDynamicHUD();
      window.setAimPoint(150, 0, 0);   // a target of the player's own, straight down the range
      window.camFollowMode = 'AUTO';   // the directed camera, as players have it
      window.RangeSession.setClub(null);
      const chip = document.querySelector('#range-session .rs-club[data-club="7i"]'); if (chip) chip.click();   // the club the launch monitor shots are booked to
      window.triggerRealShot({ ballSpeedMph: 90, launchAngleDeg: 18, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 0, isLiveData: true });
    });
    await rp.waitForTimeout(800);   // the next ball is hit while the first is still in the air
    await rp.evaluate(function () {
      window.triggerRealShot({ ballSpeedMph: 90, launchAngleDeg: 18, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 6, isLiveData: true });
      window.__queued = !!window._pendingLMShot;
    });
    // a headless browser on a CI runner draws a frame or two a second: the flights are skipped as a player would tap, again until each
    // is done (skipFlight ignores the first half second of a flight, which can be a single slow frame there)
    await rp.waitForFunction(function () { window.skipFlight(); return window.players[0].strokes >= 2; }, null, { timeout: 120000, polling: 500 });
    await rp.waitForFunction(function () { window.skipFlight(); return !window.isBallFlying() && playState === 'ROUND_IDLE'; }, null, { timeout: 120000, polling: 500 });
    await rp.waitForTimeout(300);
    const lm = await rp.evaluate(function () {
      const el = document.getElementById('hud-offline'), t = el ? el.innerText : '';
      return { queued: window.__queued, strokes: window.players[0].strokes, offline: t, offM: parseFloat(t), total: parseFloat(document.getElementById('hud-total').innerText),
               aim: [Math.round(window.aimTarget.x), Math.round(window.aimTarget.z)], manual: window.aimManual, keys: window.swingKeysAllowed(),
               session: window.RangeSession.shots().map(function (x) { return { club: x.club, src: x.source, off: Math.round(x.offline * 10) / 10, carry: Math.round(x.carry) }; }),
               panel: getComputedStyle(document.getElementById('range-session')).display, rows: document.querySelectorAll('#range-session tbody tr').length,
               dots: scene.children.filter(function (c) { return c.userData && c.userData.rangeSessionDot; }).length };
    });
    checks.push({ name: 'range: a launch-monitor shot that comes in during a flight is played next, not dropped', ok: lm.queued && lm.strokes === 2, detail: JSON.stringify(lm) });
    checks.push({ name: 'range: offline is measured across the aim line (a range along +X, started 6° right, ends a few metres R)', ok: / R$/.test(lm.offline) && lm.offM > 0.5 && lm.offM < lm.total * 0.3, detail: JSON.stringify(lm) });
    checks.push({ name: 'range: after the shots the camera is back in its aim phase, so the swing keys work again (AUTO camera)', ok: lm.keys === true, detail: JSON.stringify(lm) });
    checks.push({ name: 'range: a hand-set aim stays between shots', ok: lm.manual && lm.aim[0] === 150 && lm.aim[1] === 0, detail: JSON.stringify(lm) });
    checks.push({ name: 'range session: both shots are listed, booked to the club picked in the panel, with a landing dot each', ok: lm.panel !== 'none' && lm.rows === 2 && lm.dots === 2 &&
      lm.session.length === 2 && lm.session.every(function (x) { return x.club === '7i' && x.src === 'LM' && x.carry > 30; }) && lm.session[1].off > 0.5, detail: JSON.stringify(lm) });
    const bagNow = await rp.evaluate(function () {
      const st = JSON.parse(localStorage.getItem('golf_bag_v1') || '{"shots":[]}').shots, sess = window.RangeSession.shots().map(function (x) { return x.t; });
      return { n: st.length, clubs: st.map(function (e) { return e.club; }), same: st.every(function (e) { return sess.indexOf(e.t) >= 0; }) };
    });
    checks.push({ name: 'range: the launch-monitor shots go to the player\'s bag with their club', ok: bagNow.n === 2 && bagNow.clubs.every(function (c) { return c === '7i'; }) && bagNow.same, detail: JSON.stringify(bagNow) });
    checks.push({ name: 'range: shots raise no page errors (the course turn logic used to run and read the missing flag)', ok: rangeErrors.length === 0, detail: JSON.stringify(rangeErrors) });
    rangeStep = 'distance unit';
    const units = await rp.evaluate(function () {
      const h = courseHoles.find(function (x) { return x && x.tees && x.tees.range; });
      const signs = function () { return h.teeMeshes.range.children.filter(function (c) { return c.isSprite; }).length; };
      window.setDistanceUnit(true);
      const m = { marks: h.teeMeshes.range.userData.rangeMarkers, signs: signs(), stored: localStorage.getItem('golfos_units'), btn: (document.querySelector('.unit-btn.selected') || {}).dataset };
      window.setDistanceUnit(false);
      const yd = { marks: h.teeMeshes.range.userData.rangeMarkers, stored: localStorage.getItem('golfos_units'), btn: (document.querySelector('.unit-btn.selected') || {}).dataset };
      return { m: m.marks && m.marks.useMeters === true, mStored: m.stored, mBtn: m.btn && m.btn.unit, signs: m.signs,
               yd: yd.marks && yd.marks.useMeters === false, ydStored: yd.stored, ydBtn: yd.btn && yd.btn.unit };
    });
    checks.push({ name: 'range: the distance marks follow the player\'s unit (one setting, remembered, shown in the menu), a sign at each end of every 50', ok: units.m && units.yd &&
      units.mStored === 'm' && units.ydStored === 'yd' && units.mBtn === 'm' && units.ydBtn === 'yd' && units.signs === 12, detail: JSON.stringify(units) });
    rangeStep = 'approach practice';
    const pr = await rp.evaluate(async function () {
      const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      const rh = courseHoles.find(function (x) { return x && x.tees && x.tees.range; }), ri = courseHoles.indexOf(rh), t = rh.tees.range;
      const gi = ri === 1 ? 2 : 1, dir = t.rot || 0;   // a green with a flag 120 m down the range, on another hole
      const pin = { x: t.x + Math.sin(dir) * 120, y: t.y, z: t.z + Math.cos(dir) * 120 };
      courseHoles[gi].flag = pin; courseHoles[gi].flagMesh = createFlagObject(pin.x, pin.y, pin.z);
      window.RangePractice.refresh();
      await wait(200);
      document.querySelector('#range-practice .rp-open').click();
      await wait(200);
      document.querySelector('#range-practice [data-preset="75"]').click();
      await wait(400);
      const b = window.ballMesh.position, unitM = window.useMeters ? 1 : 0.9144;
      const on = { toPin: Math.hypot(b.x - pin.x, b.z - pin.z), want: 75 * unitM, hole: playingHoleIndex === gi, aimAtPin: Math.hypot(window.aimTarget.x - pin.x, window.aimTarget.z - pin.z) < 0.5,
                   marksHidden: rh.teeMeshes.range.children.filter(function (c) { return c.userData.rangeDistance; }).every(function (c) { return !c.visible; }),
                   mat: rh.teeMeshes.range.children.some(function (c) { return c.userData.rangeMat && c.visible; }), lie: document.getElementById('lie-text').innerText };
      // the club from the player's bag for this distance: three SW shots about as long, then taken out again (the course step has its own bag)
      const bagT = [9e12 + 1, 9e12 + 2, 9e12 + 3];
      bagT.forEach(function (t, i) { window.PlayerBag.book({ t: t, source: 'LM', club: 'SW', carry: on.want - 3 + i, total: on.want + i }); });
      window.RangePractice.render();
      on.bag = (document.querySelector('#range-practice .rp-bag') || {}).textContent || '';
      bagT.forEach(function (t) { window.PlayerBag.book({ t: t, source: 'SIM' }); });   // a shot that no longer counts leaves the bag
      window.RangePractice.render();
      on.bagGone = !/SW/.test((document.querySelector('#range-practice .rp-bag') || {}).textContent || '');
      document.querySelector('#range-practice [data-lie="ground"]').click();
      await wait(400);
      on.groundLie = document.getElementById('lie-text').innerText;
      document.querySelector('#range-practice [data-lie="mat"]').click();
      await wait(200);
      window.triggerRealShot({ ballSpeedMph: 80, launchAngleDeg: 24, totalSpinRpm: 8000, spinAxisDeg: 0, azimDeg: 0, isLiveData: true });
      await wait(100);
      on.flying = playState === 'ROUND_FLYING';
      document.querySelector('#range-practice [data-preset="100"]').click();   // picked while the ball flies: from the next shot
      on.spotKept = Math.abs(window.RangePractice.spot().dist - on.want) < 0.01;
      on.note = (document.querySelector('#range-practice .rp-note') || {}).innerText || '';
      return { on: on, gi: gi, ri: ri, pin: pin };
    });
    await rp.waitForFunction(function () { window.skipFlight(); return !window.isBallFlying() && playState === 'ROUND_IDLE'; }, null, { timeout: 120000, polling: 500 });
    await rp.waitForTimeout(400);
    const prShot = await rp.evaluate(function (ctx) {
      const s = window.RangeSession.shots().slice(-1)[0], b = window.ballMesh.position;
      const r = { popup: document.getElementById('score-popup').innerText, practice: s.practice, back: Math.hypot(b.x - ctx.pin.x, b.z - ctx.pin.z), tab: !!document.querySelector('#range-session [data-tab="approach"]'),
                  next: window.RangePractice.spot() && window.RangePractice.spot().dist,
                  inBag: ((JSON.parse(localStorage.getItem('golf_bag_v1') || '{}') || {}).shots || []).some(function (e) { return e.t === s.t; }) };
      document.querySelector('#range-practice .rp-close').click();
      const t = courseHoles[ctx.ri].tees.range;
      r.off = { atTee: Math.hypot(b.x - t.x, b.z - t.z) < 0.5, hole: playingHoleIndex === ctx.ri, arcs: courseHoles[ctx.ri].teeMeshes.range.children.filter(function (c) { return c.userData.rangeDistance && !c.isSprite && c.geometry && c.geometry.type === 'BufferGeometry'; }).every(function (c) { return c.visible; }) };
      scene.remove(courseHoles[ctx.gi].flagMesh); courseHoles[ctx.gi].flag = null; courseHoles[ctx.gi].flagMesh = null;   // the rest of the checks have no green
      window.RangePractice.refresh();
      return r;
    }, pr);
    checks.push({ name: 'range approach: the ball is put at the chosen distance from the pin, aimed at it, its hole\'s cup counts, the distance marks hide (the mat stays), the lie is the mat or the ground, and the club from the player\'s bag for the distance shows', ok:
      Math.abs(pr.on.toPin - pr.on.want) < 0.6 && /^🎒 SW · /.test(pr.on.bag) && pr.on.bagGone && pr.on.hole && pr.on.aimAtPin && pr.on.marksHidden && pr.on.mat && pr.on.lie === 'TEE' && pr.on.groundLie !== 'TEE', detail: JSON.stringify(pr.on) });
    checks.push({ name: 'range approach: each shot is scored against the pin it was hit at, with the distance it was hit from (a change during the flight waits for the next shot, the ball then goes there); an approach is not booked to the player\'s bag (a part swing); closing puts it back on the tee', ok:
      prShot.practice && Math.abs(prShot.practice.dist - pr.on.want) < 0.01 && prShot.practice.prox > 0 && /pinnen|the pin|I hål|In the hole/.test(prShot.popup) && prShot.tab &&
      prShot.inBag === false && pr.on.flying && pr.on.spotKept && pr.on.note.length > 0 && Math.abs(prShot.next - pr.on.want / 75 * 100) < 0.01 && Math.abs(prShot.back - pr.on.want / 75 * 100) < 0.6 &&
      prShot.off.atTee && prShot.off.hole && prShot.off.arcs, detail: JSON.stringify(prShot) });
    rangeStep = 'approach test';
    const tsetup = await rp.evaluate(async function () {
      const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      const rh = courseHoles.find(function (x) { return x && x.tees && x.tees.range; }), ri = courseHoles.indexOf(rh), t = rh.tees.range;
      const gi = ri === 1 ? 2 : 1, dir = t.rot || 0;
      const pin = { x: t.x + Math.sin(dir) * 120, y: t.y, z: t.z + Math.cos(dir) * 120 };
      courseHoles[gi].flag = pin; courseHoles[gi].flagMesh = createFlagObject(pin.x, pin.y, pin.z);
      window.RangeSession.setClub(null);   // test shots of all lengths: not booked to the 7i in the player's bag
      window.RangePractice.refresh();
      await wait(200);
      // voice at the mat (what the recogniser writes is handed in as it would be): a distance opens practice there, the lie, a test locks
      // the distance until it is cancelled
      const V = window.VoiceCommands, unitM = window.useMeters ? 1 : 0.9144, voice = {};
      voice.dist = V.handle(['90 meter']) && Math.abs(window.RangePractice.spot().dist - 90) < 0.01 && window.RangePractice.getState().on;
      voice.words = V.handle(['sjuttiofem']) && Math.abs(window.RangePractice.spot().dist - 75 * unitM) < 0.01;   // in the player's unit
      voice.lie = V.handle(['som marken']) && window.RangePractice.getState().lie === 'ground' && V.handle(['matta']) && window.RangePractice.getState().lie === 'mat';
      voice.test = V.handle(['starta test']) && window.RangePractice.test().phase === 'run';
      const locked = window.RangePractice.spot().dist;
      voice.locked = V.handle(['120 meter']) === false && window.RangePractice.spot().dist === locked;
      voice.cancel = V.handle(['avbryt']) && window.RangePractice.test() === null;
      voice.talk = V.handle(['jag slog 150 i går']) === false;
      voice.rangeClass = document.body.classList.contains('voice-range') || !V.supported;   // set by the voice module's check (every 0.7 s)
      document.querySelector('#range-practice [data-act="test"]').click();
      const setup = { shots: document.querySelectorAll('#range-practice [data-tn]').length, bands: document.querySelectorAll('#range-practice [data-tb]').length,
                      start: !!document.querySelector('#range-practice [data-act="start"]') };
      window.RangePractice.startTest(3, [50, 150], [60, 90, 120]);   // three shots at known distances (the player's unit)
      await wait(300);
      const b = window.ballMesh.position;
      setup.first = Math.abs(Math.hypot(b.x - pin.x, b.z - pin.z) - 60 * unitM) < 0.6;
      setup.locked = !document.querySelector('#range-practice .rp-value') && document.querySelector('#range-practice .rp-green').disabled;
      setup.label = (document.querySelector('#range-practice .rp-label') || {}).innerText || '';
      return { setup: setup, gi: gi, pin: pin, unitM: unitM, voice: voice };
    });
    const tshots = [];
    for (let i = 0; i < 3; i++) {
      await rp.evaluate(function (i) { window.triggerRealShot({ ballSpeedMph: 60 + i * 12, launchAngleDeg: 26, totalSpinRpm: 8000, spinAxisDeg: 0, azimDeg: i - 1, isLiveData: true }); }, i);
      await rp.waitForFunction(function () { window.skipFlight(); return !window.isBallFlying() && playState === 'ROUND_IDLE'; }, null, { timeout: 120000, polling: 500 });
      await rp.waitForTimeout(300);
      tshots.push(await rp.evaluate(function (ctx) {
        const s = window.RangeSession.shots().slice(-1)[0], b = window.ballMesh.position;
        return { popup: document.getElementById('score-popup').innerText, points: s.practice && s.practice.points, test: s.practice && s.practice.test, dist: s.practice && s.practice.dist,
                 at: Math.round(Math.hypot(b.x - ctx.pin.x, b.z - ctx.pin.z) / ctx.unitM) };
      }, tsetup));
    }
    const tdone = await rp.evaluate(function (ctx) {
      const tt = window.RangePractice.test();
      const r = { phase: tt.phase, score: tt.score, record: tt.record, avg: Math.round(tt.shots.reduce(function (a, s) { return a + s.points; }, 0) / tt.shots.length),
                  summary: !!document.querySelector('#range-practice .rp-summary svg'), plotDots: document.querySelectorAll('#range-practice .rp-summary .rp-shot').length,
                  dots: scene.children.filter(function (c) { return c.userData && c.userData.rangePracticeDot; }).length,
                  ellipse: scene.children.some(function (c) { return c.userData && c.userData.rangePracticeSpread; }),
                  sessionDotsHidden: scene.children.filter(function (c) { return c.userData && c.userData.rangeSessionDot; }).every(function (c) { return !c.visible; }) };
      // each dot where its ball stopped (booked with the shot)
      const rests = window.RangeSession.shots().slice(-3).map(function (s) { return s.practice; });
      r.dotsAtRest = scene.children.filter(function (c) { return c.userData && c.userData.rangePracticeDot; }).every(function (c, i) {
        return rests[i] && Math.hypot(c.position.x - rests[i].x, c.position.z - rests[i].z) < 0.01;
      });
      // the finished test is kept: the session panel's Approach tab shows its score over time
      const trs = window.RangePractice.trends();
      document.querySelector('#range-session [data-tab="approach"]').click();
      r.history = { tests: trs.length, n: trs[0] && trs[0].trend.n, last: trs[0] && trs[0].trend.last, rows: document.querySelectorAll('#range-session .rs-test').length,
                    dots: document.querySelectorAll('#range-session .rs-test .rp-spark-dot').length };
      // same test again, also after the unit was switched (the band stays in the unit the test was played in: the same test, the same board)
      const metersBefore = window.RangePractice.test().meters;
      window.setDistanceUnit(!window.useMeters);
      document.querySelector('#range-practice [data-act="again"]').click();
      r.again = window.RangePractice.test().phase === 'run' && window.RangePractice.test().i === 0 && window.RangePractice.test().meters === metersBefore;
      window.setDistanceUnit(metersBefore);
      document.querySelector('#range-practice .rp-close').click();
      r.after = { dots: scene.children.filter(function (c) { return c.userData && c.userData.rangePracticeDot; }).length,
                  sessionDots: scene.children.filter(function (c) { return c.userData && c.userData.rangeSessionDot; }).some(function (c) { return c.visible; }) };
      scene.remove(courseHoles[ctx.gi].flagMesh); courseHoles[ctx.gi].flag = null; courseHoles[ctx.gi].flagMesh = null;
      window.RangePractice.refresh();
      window.RangeSession.setClub('7i');   // as the steps after expect
      return r;
    }, tsetup);
    checks.push({ name: 'range voice: at the mat a spoken distance (digits or words, in the player\'s unit unless said), the lie and the test work; the distance is locked during a test; talk is no command', ok:
      Object.keys(tsetup.voice).every(function (k) { return tsetup.voice[k] === true; }), detail: JSON.stringify(tsetup.voice) });
    checks.push({ name: 'range approach test: picks shots and band, then plays its distances in turn (the controls locked), each shot worth up to 100 points, booked as a test shot', ok:
      tsetup.setup.shots === 2 && tsetup.setup.bands === 3 && tsetup.setup.start && tsetup.setup.first && tsetup.setup.locked && /1\/3/.test(tsetup.setup.label) &&
      tshots.every(function (s) { return typeof s.points === 'number' && s.points >= 0 && s.points <= 100 && s.test === true && /\+\d+ (p|pts)/.test(s.popup); }) &&
      Math.abs(tshots[0].dist - 60 * tsetup.unitM) < 0.01 && tshots[0].at === 90 && tshots[1].at === 120, detail: JSON.stringify({ setup: tsetup.setup, shots: tshots }) });
    checks.push({ name: 'range approach test: the result is the average of the points, the first is a best, with the spread drawn small and on the green where the balls stopped (the landing dots hidden); kept in the test history in the panel; again is the same test even after a unit switch; closing clears it', ok:
      tdone.phase === 'done' && tdone.score === tdone.avg && tdone.record === true && tdone.summary && tdone.plotDots === 3 && tdone.dots === 3 && tdone.dotsAtRest && tdone.ellipse && tdone.sessionDotsHidden &&
      tdone.again && tdone.after.dots === 0 && tdone.after.sessionDots &&
      tdone.history.tests === 1 && tdone.history.n === 1 && tdone.history.last === tdone.score && tdone.history.rows === 1 && tdone.history.dots === 1, detail: JSON.stringify(tdone) });
    rangeStep = 'aim billboard and signs';
    await rp.evaluate(function () {   // the player's view from behind the tee, down the range
      const t = courseHoles.find(function (x) { return x && x.tees && x.tees.range; }).tees.range, dir = t.rot || 0;
      window.camFollowMode = 'FREE'; controls.enabled = true;
      camera.position.set(t.x - Math.sin(dir) * 12, t.y + 3, t.z - Math.cos(dir) * 12);
      controls.target.set(t.x + Math.sin(dir) * 30, t.y, t.z + Math.cos(dir) * 30); controls.update();
      window.setAimPoint(t.x + Math.sin(dir) * 120, t.y, t.z + Math.cos(dir) * 120);
    });
    await rp.waitForTimeout(1500);
    const aimSigns = await rp.evaluate(function () {
      const g = courseHoles.find(function (x) { return x && x.tees && x.tees.range; }).teeMeshes.range;
      const bySide = {};
      g.children.filter(function (c) { return c.userData && c.userData.rangeSign; }).forEach(function (c) { const k = c.userData.rangeSign.side; (bySide[k] = bySide[k] || []).push(c.visible ? 1 : 0); });
      return { club: document.getElementById('aim-bb-club').innerText, reach: document.getElementById('aim-bb-reach').innerText, fx: document.getElementById('aim-bb-fx').innerText, sides: bySide };
    });
    // shown signs run on without a gap; the nearest may be hidden because the edge of the view cuts it off
    const runOn = function (a) { return a && a.join('').replace(/^0+/, '').indexOf('01') < 0; };
    checks.push({ name: 'range: the aim billboard shows the club picked in the panel and the player\'s own average with it, not a suggestion', ok: /^7i · /.test(aimSigns.club) && /^Carry /.test(aimSigns.reach) && aimSigns.fx.length > 0, detail: JSON.stringify(aimSigns) });
    checks.push({ name: 'range signs: from the tee the crowded far signs hide, the ones shown run on without a gap, and some are shown', ok: runOn(aimSigns.sides['-1']) && runOn(aimSigns.sides['1']) &&
      aimSigns.sides['-1'].concat(aimSigns.sides['1']).some(Boolean) && !aimSigns.sides['-1'].concat(aimSigns.sides['1']).every(Boolean), detail: JSON.stringify(aimSigns.sides) });
    rangeStep = 'signs at the edge of the view';
    const cutOff = function () {   // visible signs that the edge of the view cuts off (same size maths as declutter)
      return rp.evaluate(function () {
        const g = courseHoles.find(function (x) { return x && x.tees && x.tees.range; }).teeMeshes.range;
        const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight, tanHalf = Math.tan(camera.fov * Math.PI / 360), out = [];
        g.children.filter(function (c) { return c.userData && c.userData.rangeSign && c.visible && c.material.opacity > 0.5; }).forEach(function (c) {
          const wp = c.getWorldPosition(new THREE.Vector3()), d = camera.position.distanceTo(wp), p = wp.clone().project(camera);
          const h = c.scale.y / (2 * d * tanHalf) * H, w = h * c.scale.x / c.scale.y, x = (p.x + 1) / 2 * W, y = (1 - p.y) / 2 * H;
          if (x - w / 2 < -1 || x + w / 2 > W + 1 || y - h / 2 < -1 || y + h / 2 > H + 1) out.push(Math.round(x) + ',' + Math.round(y));
        });
        return out;
      });
    };
    const cutAtTee = await cutOff();
    await rp.evaluate(function () {   // turn the view so that signs on one side straddle the edge
      const t = courseHoles.find(function (x) { return x && x.tees && x.tees.range; }).tees.range, dir = t.rot || 0;
      controls.target.set(t.x + Math.sin(dir) * 30 + Math.cos(dir) * 14, t.y, t.z + Math.cos(dir) * 30 - Math.sin(dir) * 14); controls.update();
    });
    await rp.waitForTimeout(1500);
    const cutTurned = await cutOff();
    checks.push({ name: 'range signs: no sign is left showing cut off by the edge of the view', ok: cutAtTee.length === 0 && cutTurned.length === 0, detail: JSON.stringify({ tee: cutAtTee, turned: cutTurned }) });
    rangeStep = 'save the range';
    const built = await rp.evaluate(async function () {
      setMode('BUILD'); await window.saveLevel(true, true);
      return { panel: getComputedStyle(document.getElementById('range-session')).display, dots: scene.children.filter(function (c) { return c.userData && c.userData.rangeSessionDot; }).length };
    });
    checks.push({ name: 'range session: the panel and the landing dots go away in the builder', ok: built.panel === 'none' && built.dots === 0, detail: JSON.stringify(built) });
    await rp.close();
    rangeStep = 'reopen without mode=range';
    const rp2 = await ctx3.newPage();
    await rp2.goto(base + '/arcade.html?autorun=edit_build', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await rp2.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
    await rp2.waitForTimeout(2000);
    const reopenedRange = await rp2.evaluate(function () {
      const b = document.getElementById('btn-set-range-tee');
      return { range: window._isRangeMode === true, url: new URLSearchParams(location.search).get('mode'), teeBtn: b ? getComputedStyle(b).display : 'missing', hasTee: !!courseHoles.find(function (h) { return h && h.tees && h.tees.range; }) };
    });
    await rp2.close();
    rangeStep = 'practice range';
    // the ready practice range from the hub: three real greens with their flags, played at once, and the player's own draft (the range
    // saved above) is left as it was, also when the builder is asked for
    const draftBefore = await ctx3.newPage().then(async function (pg) { await pg.goto(base + '/robots.txt'); const d = await pg.evaluate(function () { return localStorage.getItem('arcade_custom_level'); }); await pg.close(); return d; });
    const pr2 = await ctx3.newPage();
    await pr2.goto(base + '/arcade.html?autorun=new_build&mode=range&template=flat&practice=1&play=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await pr2.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
    await pr2.waitForTimeout(3000);
    const practiceRange = await pr2.evaluate(function (before) {
      const t = courseHoles[0].tees.range, flags = courseHoles.filter(function (h) { return h && h.flag; }).map(function (h) { return h.flag; });
      setMode('BUILD');
      return { mode: appMode, tee: !!t, flags: flags.map(function (f) { return { d: Math.round(Math.hypot(f.x - t.x, f.z - t.z)), surf: (localGetTerrainAt(f.x, -f.z) || {}).type }; }),
               draftKept: localStorage.getItem('arcade_custom_level') === before, bar: !!document.querySelector('#range-practice .rp-open, #range-practice .rp-green') };
    }, draftBefore);
    await pr2.close();
    checks.push({ name: 'practice range: played straight from the hub with a Range Tee and three real greens (60, 100, 140 m, flags on the green), the player\'s own draft untouched, no builder', ok:
      practiceRange.mode === 'TEST' && practiceRange.tee && practiceRange.flags.length === 3 && practiceRange.flags.every(function (f) { return f.surf === 'GREEN'; }) &&
      practiceRange.flags.map(function (f) { return Math.round(f.d / 20); }).join() === '3,5,7' && practiceRange.draftKept && practiceRange.bar, detail: JSON.stringify(practiceRange) });
    rangeStep = 'bag on a course';
    const cp = await ctx3.newPage();
    await cp.goto(base + '/arcade.html?autorun=new_build&template=blank&biome=GLOBAL', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await cp.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
    await cp.waitForTimeout(3000);
    await cp.evaluate(function () {
      // the bag already has the two 7i shots from the range above; a few more so that two clubs are known
      [[143, 150], [146, 153], [140, 147]].forEach(function (x, i) { window.PlayerBag.book({ t: 900 + i, source: 'LM', club: '7i', carry: x[0], total: x[1] }); });
      [[112, 118], [115, 121], [109, 116]].forEach(function (x, i) { window.PlayerBag.book({ t: 910 + i, source: 'LM', club: 'PW', carry: x[0], total: x[1] }); });
      const pos = planeGeo.attributes.position.array; for (let i = 0; i < planeGeo.attributes.position.count; i++) pos[i * 3 + 2] = 0;
      planeGeo.attributes.position.needsUpdate = true;
      setMode('BUILD');
      courseHoles[0].tees.yellow = { x: 0, y: 0, z: 0, rot: 0 }; courseHoles[0].flag = { x: 0, y: 0, z: -110 };
      setMode('TEST');
      window.SwingEngine.setInputMode('LM');
      window.setAimPoint(0, 0, -110);
    });
    await cp.waitForFunction(function () { return /^🎒 /.test(document.getElementById('aim-bb-club').innerText); }, null, { timeout: 60000, polling: 500 });
    const bagCourse = await cp.evaluate(function () { return { club: document.getElementById('aim-bb-club').innerText, reach: document.getElementById('aim-bb-reach').innerText, fx: document.getElementById('aim-bb-fx').innerText }; });
    const courseBuild = await cp.evaluate(function () {
      setMode('BUILD');
      const vis = function (id) { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
      courseHoles[1].flag = null;
      window.changeHoleTo(1); window.changeHole(1);   // hole 2 has no tee, flag or aim point: a course still waits for it
      const r = { btn: vis('tool-hole'), yellow: vis('btn-set-tee-yellow'), hole: currentHoleIndex };
      window.changeHoleTo(0); setMode('TEST'); window.setAimPoint(0, 0, -110);
      return r;
    });
    checks.push({ name: 'course builder: no Range Tee button, coloured tees shown, and the next hole still waits for the hole to be finished', ok: courseBuild.btn === 'none' && courseBuild.yellow !== 'none' && courseBuild.hole === 1, detail: JSON.stringify(courseBuild) });
    // what the camera does not need is not drawn every frame: the minimap is a picture of its own, drawn when something on it changes
    // (the aim) and about once a second otherwise; the shadow follows the ball and its map is drawn only when something can have moved
    const budget = await cp.evaluate(function () {
      const raf2 = function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); };
      return raf2().then(function () {
        const mm = window._mmCache, out = { cache: !!mm && !!mm.rt, autoUpdate: renderer.shadowMap.autoUpdate };
        if (!mm) return out;
        const r0 = mm.renders, f0 = window._frameNo;
        return new Promise(function (res) { setTimeout(res, 2500); }).then(function () {
          out.idleFrames = window._frameNo - f0; out.idleRenders = mm.renders - r0;
          const r1 = mm.renders, a = window.aimTarget; window.setAimPoint(a.x + 12, a.y, a.z);
          return raf2().then(function () {
            out.aimRender = mm.renders - r1;
            window.setAimPoint(a.x - 12, a.y, a.z);
            const b = window.ballMesh.position, t = dirLight.target.position;
            out.shadowToBall = +Math.hypot(t.x - b.x, t.z - b.z).toFixed(1);
            out.sunKept = dirLight.position.clone().sub(t).distanceTo(dirLight.userData.sunDir) < 1e-6;
            return out;
          });
        });
      });
    });
    checks.push({ name: 'render budget: the minimap is drawn into a picture of its own when something changes (the aim at once, else about once a second, not every frame); the shadow follows the ball with the sun\'s direction kept, its map not drawn on every render', ok: budget.cache && budget.autoUpdate === false && budget.idleRenders <= 4 && (budget.idleFrames <= 4 || budget.idleRenders < budget.idleFrames) && budget.aimRender >= 1 && budget.shadowToBall <= 30 && budget.sunKept, detail: JSON.stringify(budget) });
    await cp.evaluate(function () { window.SwingEngine.setInputMode('SWING'); });
    // with the swing the game's own suggestion comes back once the shot plan is worked out again (the plan row is hidden meanwhile)
    await cp.waitForFunction(function () { return getComputedStyle(document.getElementById('aim-bb-plan')).display === 'block' && !/^🎒/.test(document.getElementById('aim-bb-club').innerText); }, null, { timeout: 60000, polling: 500 }).catch(function () {});
    const swingClub = await cp.evaluate(function () { return document.getElementById('aim-bb-club').innerText; });
    // a shot that comes in after the ball has stopped but before the next turn is up (a launch monitor, the swing keys) is not played:
    // it would be played by the wrong player, or wipe a holed-out score
    const lock = await cp.evaluate(function () {
      const shot = function () { window.triggerRealShot({ ballSpeedMph: 70, launchAngleDeg: 20, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 0, isLiveData: true }); };
      return new Promise(function (res) {
        shot();
        setTimeout(function () { if (window.skipFlight) window.skipFlight(); }, 600);
        const t = setInterval(function () {
          if (window.isBallFlying() || playState !== 'ROUND_IDLE') return;
          clearInterval(t);
          const atStop = { strokes: window.players[0].strokes, locked: !!window.ballLocked, keys: window.swingKeysAllowed() };
          shot();
          const second = { strokes: window.players[0].strokes, flying: window.isBallFlying() };
          const u = setInterval(function () {
            if (window.ballLocked) return;
            clearInterval(u);
            res({ atStop: atStop, second: second, after: { keys: window.swingKeysAllowed() } });
          }, 50);
        }, 5);
      });
    });
    checks.push({ name: 'course: a shot that comes in after the ball has stopped and before the next turn is up is not played (the ball is locked, the swing keys are off), and the turn change unlocks it',
      ok: lock.atStop.locked && !lock.atStop.keys && lock.second.strokes === lock.atStop.strokes && !lock.second.flying && lock.after.keys, detail: JSON.stringify(lock) });
    // Rehit whose penalty reaches the Auto Concede limit picks the hole up: the ball stays locked until the next turn (a shot then would wipe it)
    const rehitConcede = await cp.evaluate(function () {
      window.matchSettings = Object.assign({}, window.matchSettings || {}, { autoConcede: 2 });
      courseHoles[playingHoleIndex].par = 4;
      const p = window.players[0], here = { x: window.ballMesh.position.x, y: window.ballMesh.position.y, z: window.ballMesh.position.z };
      p.strokes = 5; p.penaltyStrokes = 0; p.prevPos = here; p.prevStrokes = 4; p.prevPenalty = 0; p.holedOut = false; p.penaltyResolved = false;
      window.lastShotPlayerIndex = 0; playState = 'ROUND_IDLE'; window.ballLocked = false;
      window.takeRehit();
      const after = { total: p.strokes + p.penaltyStrokes, holedOut: p.holedOut, locked: !!window.ballLocked };
      window.triggerRealShot({ ballSpeedMph: 70, launchAngleDeg: 20, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 0, isLiveData: true });
      return { after: after, shot: { total: p.strokes + p.penaltyStrokes, holedOut: p.holedOut, flying: window.isBallFlying() } };
    });
    checks.push({ name: 'course: a Rehit that reaches the Auto Concede limit (5 on a par 4, limit 6) picks the hole up at 6 and keeps the ball locked: a shot right after is not played',
      ok: rehitConcede.after.total === 6 && rehitConcede.after.holedOut && rehitConcede.after.locked && rehitConcede.shot.total === 6 && rehitConcede.shot.holedOut && !rehitConcede.shot.flying, detail: JSON.stringify(rehitConcede) });
    // the Drop button (unplayable) is not for a player who has holed out: it would put a penalty on a finished hole
    const holedDrop = await cp.evaluate(function () {
      return new Promise(function (res) {
        appMode = 'PLAY'; window.matchSettings = Object.assign({}, window.matchSettings || {}, { mulligans: true, autoConcede: 99 });
        const p = window.players[0];
        p.holedOut = true; p.prevPos = { x: window.ballMesh.position.x, y: window.ballMesh.position.y, z: window.ballMesh.position.z };
        window.lastShotPlayerIndex = 0; playState = 'ROUND_IDLE';
        setTimeout(function () {
          const pen = p.penaltyStrokes; window.takePenaltyDrop();
          res({ drop: document.getElementById('btn-drop').style.display, mulligan: document.getElementById('btn-mulligan').style.display, penAdded: p.penaltyStrokes - pen, dropping: !!window._pendingDrop });
        }, 700);
      });
    });
    checks.push({ name: 'course: no Drop for a player who has holed out (the button is hidden, a call adds no penalty), the mulligan is still there', ok: holedDrop.drop === 'none' && holedDrop.mulligan === 'block' && holedDrop.penAdded === 0 && !holedDrop.dropping, detail: JSON.stringify(holedDrop) });
    // a mulligan while a drop is being placed calls the drop off: Anna hit last, Bo (up) declares his ball unplayable, Anna takes a mulligan
    const mullDrop = await cp.evaluate(function () {
      return new Promise(function (res) {
        const here = { x: window.ballMesh.position.x, y: window.ballMesh.position.y, z: window.ballMesh.position.z };
        const A = window.players[0];
        A.holedOut = false; A.strokes = 3; A.penaltyStrokes = 0; A.prevStrokes = 2; A.prevPenalty = 0; A.prevPos = here; A.penaltyResolved = false;
        const B = { name: 'Bo', strokes: 2, penaltyStrokes: 0, holedOut: false, scores: [], scoreVsPar: [], lie: { x: here.x + 3, y: here.y, z: here.z - 20 }, teePosition: A.teePosition };
        window.players = [A, B]; window.lastShotPlayerIndex = 0; window.activePlayerIndex = 1; window.ballLocked = false; playState = 'ROUND_IDLE';
        window.takePenaltyDrop();
        setTimeout(function () {
          const during = { boPen: B.penaltyStrokes, confirm: !!document.getElementById('btn-confirm-drop'), rehit: document.getElementById('btn-rehit').style.display };
          window.takeMulligan();
          res({ during: during, after: { boPen: B.penaltyStrokes, anna: A.strokes + A.penaltyStrokes, active: window.activePlayerIndex, confirm: !!document.getElementById('btn-confirm-drop'), circle: !!window._dropZoneCircle, pending: !!window._pendingDrop, cam: window.camFollowMode } });
        }, 700);
      });
    });
    checks.push({ name: 'course: a mulligan while a drop is being placed calls the drop off (no circle, no confirm button, the camera back to AUTO) and gives the dropping player his penalty back; no Rehit during the drop',
      ok: mullDrop.during.boPen === 1 && mullDrop.during.confirm && mullDrop.during.rehit === 'none' && mullDrop.after.boPen === 0 && mullDrop.after.anna === 2 && mullDrop.after.active === 0 && !mullDrop.after.confirm && !mullDrop.after.circle && !mullDrop.after.pending && mullDrop.after.cam === 'AUTO', detail: JSON.stringify(mullDrop) });
    await cp.close();
    checks.push({ name: 'course: with a launch monitor the aim billboard suggests the club from the player\'s bag (PW for 110), not with the swing', ok: /PW/.test(bagCourse.club) && /^Carry /.test(bagCourse.reach) && /plays/.test(bagCourse.fx) && !/^🎒/.test(swingClub), detail: JSON.stringify([bagCourse, swingClub]) });
    checks.push({ name: 'range: the quick draft of a range reopens as a range even without mode=range in the address', ok: reopenedRange.range && reopenedRange.url === 'range' && reopenedRange.teeBtn !== 'none' && reopenedRange.hasTee, detail: JSON.stringify(reopenedRange) });
    await ctx3.close();
  } catch (e) { checks.push({ name: 'range checks ran', ok: false, detail: 'step ' + rangeStep + ': ' + String(e.message).split('\n')[0].slice(0, 160) }); }

  await browser.close();
  srv.close();

  const result = { errors: Array.from(new Set(errors)).sort(), windowKeys: snap.windowKeys, lexical: snap.lexical };
  if (UPDATE) {
    fs.writeFileSync(BASELINE, JSON.stringify(result, null, 1) + '\n');
    console.log('Baseline written: ' + result.windowKeys.length + ' window keys, ' + result.errors.length + ' known errors');
  }
  const base0 = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
  let failed = 0;
  function report(ok, msg) { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) failed++; }
  checks.forEach(function (c) { report(c.ok, c.name + (c.detail ? '  ' + c.detail : '')); });
  report(missing.length === 0, 'every local file loads' + (missing.length ? ': ' + missing.join(', ') : ''));
  if (!base0) { report(false, 'no baseline (run with --update)'); }
  else {
    const newErr = result.errors.filter(function (e) { return base0.errors.indexOf(e) < 0; });
    report(newErr.length === 0, 'no new page errors' + (newErr.length ? ': ' + JSON.stringify(newErr) : ' (' + result.errors.length + ' known)'));
    const lost = base0.windowKeys.filter(function (k) { return result.windowKeys.indexOf(k) < 0; });
    const added = result.windowKeys.filter(function (k) { return base0.windowKeys.indexOf(k) < 0; });
    report(lost.length === 0, 'no window global lost' + (lost.length ? ': ' + lost.slice(0, 20).join(', ') : ''));
    if (added.length) console.log('NOTE  new window globals: ' + added.slice(0, 20).join(', '));
    const lexBad = Object.keys(base0.lexical).filter(function (k) { return base0.lexical[k] !== result.lexical[k]; });
    report(lexBad.length === 0, 'shared top-level variables unchanged' + (lexBad.length ? ': ' + lexBad.map(function (k) { return k + ' ' + base0.lexical[k] + '->' + result.lexical[k]; }).join(', ') : ''));
  }
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nSmoke test passed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
