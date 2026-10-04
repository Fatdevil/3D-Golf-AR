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
    const d = window.terrainBiomeData; for (let i = 0; i < d.length; i += 4) { d[i] = 152; d[i + 1] = 206; d[i + 2] = 104; }
    const pos = planeGeo.attributes.position.array; for (let i = 0; i < planeGeo.attributes.position.count; i++) pos[i * 3 + 2] = 0;
    const h = courseHoles[0]; h.flag = { x: 0, z: -8 };
    if (!h.flagMesh) { h.flagMesh = new THREE.Object3D(); scene.add(h.flagMesh); }
    h.flagMesh.position.set(0, 0, -8);
    window.ballMesh.position.set(0, 0.022, 0); playingHoleIndex = 0;

    // putt line: on a flat green the physics line must drop in
    const pts = window.puttBreakPath(0, 0, h), info = window._breakLineInfo || {};
    check('puttBreakPath returns a line', pts && pts.length >= 6);
    check('puttBreakPath line holes out on a flat green', info.holed === true, JSON.stringify(info));
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
      const pre = new Float32Array(p);
      for (let i = 0; i < n; i++) { const x = p[i * 3], z = -p[i * 3 + 1]; p[i * 3 + 2] += 2 * Math.exp(-((x - 15) * (x - 15) + (z - 150) * (z - 150)) / 18); }
      const redone = window.reanchorStudiosAfterSculpt(pre);
      check('fairway re-run after sculpt keeps the cap', redone >= 1 && maxSlope() <= 0.10, 'redone ' + redone + ' max ' + (maxSlope() * 100).toFixed(1) + ' %');
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
      })();
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
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        await frame();
        const after = { runs: runs, prop: fdS[spec[2]] };
        if (!(during.runs === 0 && during.prop === before && during.thumb === spec[3] && /\d/.test(during.label) && after.runs === 1 && after.prop === spec[3])) results.push(spec[0] + ' ' + JSON.stringify({ before: before, during: during, after: after }));
        fdS[spec[2]] = before;
      }
      window.applyFairwayPipeline = orig;
      check('fairway sliders (semi-rough, rough, max slope) do not rebuild while dragging, once on release', results.length === 0, results.join(' | '));
    })();
    return out;
  }); } catch (e) { checks = [{ name: 'behaviour checks ran', ok: false, detail: String(e.message).split('\n')[0].slice(0, 160) }]; }

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
