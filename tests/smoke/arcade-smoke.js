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
  await blank.goto('about:blank');
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
        const hs = document.getElementById('mtn-spline-height'), js = document.getElementById('mtn-spline-jagged');
        hs.value = 25; js.value = 0; js.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(350);
        const m0 = prevMesh();
        const fld = window.mtnHillField(window.splinePoints, 25, 0);
        let fmax = -1e9; fld.inside.forEach(function (v) { fmax = Math.max(fmax, v.newH); });
        const ok0 = !!m0 && Math.abs(topY(m0) - (fmax + 0.15)) < 0.05;
        const sig0 = m0 ? sig(m0) : 0;
        js.value = 100; js.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(350);
        const m1 = prevMesh();
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
      // hole navigation: an unfinished hole keeps its own "Finish hole" message, a finished one moves on
      const h0 = courseHoles[0], keep = { tees: h0.tees, flag: h0.flag, aim: h0.aimPoint }, idx0 = window.currentHoleIndex;
      window.changeHoleTo(0); h0.tees = {}; h0.flag = null; h0.aimPoint = null;
      say('next hole'); await new Promise(function (r) { setTimeout(r, 100); });
      const tBlocked = (document.getElementById('build-toast') || {}).textContent || '';
      const stayed = window.currentHoleIndex === 0;
      h0.tees = { yellow: { x: 0, z: 0 } }; h0.flag = { x: 0, z: -8 }; h0.aimPoint = { x: 0, z: -4 };
      say('next hole'); await new Promise(function (r) { setTimeout(r, 100); });
      const moved = window.currentHoleIndex === 1, tMoved = (document.getElementById('build-toast') || {}).textContent || '';
      window.changeHoleTo(0); h0.tees = keep.tees; h0.flag = keep.flag; h0.aimPoint = keep.aim;
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
      return { errs: errs.filter(function (e) { return /shader|WebGLProgram/i.test(e); }), shells: sh.shells.length, semi: sh.semiHeight, rough: sh.roughHeight, deep: sh.deepHeight, u: sh.shells[0] && sh.shells[0].mat.uniforms.uSemiH.value };
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
    checks.push({ name: '3D grass shells compile, and semi-rough is lower than rough and deep rough', ok: grass.errs.length === 0 && grass.shells === 5 && grass.semi > 0 && grass.semi < grass.rough && grass.rough < grass.deep && grass.u === grass.semi, detail: JSON.stringify(grass) });
    await pp.close();

  } catch (e) { checks.push({ name: 'quick draft reopen check ran', ok: false, detail: 'step ' + reopenStep + ': ' + String(e.message).split('\n')[0].slice(0, 160) }); }

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
