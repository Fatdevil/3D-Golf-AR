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
  page.on('pageerror', function (e) { errors.push(e.message.slice(0, 120)); });
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
