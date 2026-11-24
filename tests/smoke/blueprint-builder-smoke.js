// Browser smoke test for the blueprint map in the ordinary course builder (arcade.html?autorun=new_build, as build.html opens it).
// The main smoke test runs the builder in range mode (mode=range), where the 3D scene is light: in the course builder the scene
// behind the map used to take the time the spot search needs, every hole stayed red ("no free spot") and nothing could be built.
//   npm --prefix tests install && npm --prefix tests run setup    (once; or set CHROMIUM_PATH)
//   npm run smoke:builder
// Checks: the course builder (no range tee), the 3D scene pauses while the map is open, three holes get good spots in time with a
// par mix (4, 3, 5) and short walks between them, the map's rows keep their height, every hole is built (the par 3 with its
// approach strip) and the scene runs again after the map closes. Set SHOTS=<dir> to also save screenshots.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS;

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
    if (d) {
      const p = ['chrome-linux', 'chrome-linux64'].map(function (sub) { return path.join(base, d, sub, 'chrome'); }).filter(fs.existsSync)[0];
      if (p) return p;
    }
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

const results = [];
function check(name, ok, detail) { results.push(!!ok); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : '')); }

(async function () {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  let browser;
  try { browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.error('Could not start Chromium: ' + e.message.split('\n')[0] + '\nRun: npm --prefix tests run setup   (or set CHROMIUM_PATH)'); srv.close(); process.exit(2); }
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, serviceWorkers: 'block' });
  // the automatic graphics level off (the software renderer is slow: it would change the picture under the checks)
  await ctx.addInitScript(function () { try { localStorage.setItem('golf_auto_q_on', '0'); } catch (e) { /* storage blocked */ } });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
    const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
    if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort();
  });
  await ctx.route(/^https:\/\/(?!cdn)/, function (r) { r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message.slice(0, 160) + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' | ').slice(0, 220)); });
  await page.goto(base + '/arcade.html?autorun=new_build', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(7000);

  // 1. the course builder, not the range builder
  const mode = await page.evaluate(function () {
    const rangeTee = Array.prototype.some.call(document.querySelectorAll('button, div'), function (e) {
      return e.children.length < 3 && e.offsetParent !== null && /RANGE TEE/i.test(e.textContent || '');
    });
    return { range: !!window._isRangeMode, rangeTee: rangeTee, mapApi: typeof window.HoleBlueprint === 'object' };
  });
  check('the course builder: not range mode, no Range Tee tool, the blueprint map is there', !mode.range && !mode.rangeTee && mode.mapApi, JSON.stringify(mode));

  // 2. plan three holes on the map: each search has to end with a good spot in time
  const plan = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const settle = async function () { const t0 = Date.now(); for (let w = 0; w < 300 && S.busy; w++) await wait(100); return Date.now() - t0; };
    window.changeHoleTo(0);
    window.HoleBlueprint.open();
    const S = window.HoleBlueprint.state();
    const paused = window._pause3D === true;
    const frame0 = window._frameNo || 0;
    const times = [await settle()];
    for (let k = 0; k < 2; k++) { window.HoleBlueprint.addHole(); times.push(await settle()); }
    await wait(300);
    const framesWhileOpen = (window._frameNo || 0) - frame0;   // the frame counter keeps going (only the scene is skipped)
    const walks = S.sketches.map(function (s, i) {
      if (!i) return null;
      const g = S.sketches[i - 1].ev.world.greenCenter;
      return Math.round(Math.hypot(s.origin.x - g.x, s.origin.z - g.z));
    });
    const sum = S.dom.summary;
    return {
      paused: paused, framesWhileOpen: framesWhileOpen, times: times,
      ok: S.sketches.map(function (s) { return !!(s.ev && s.ev.ok); }), pars: S.sketches.map(function (s) { return s.par; }), walks: walks,
      buildEnabled: !S.dom.build.disabled, summary: sum.textContent, summaryHeight: sum.getBoundingClientRect().height,
      overlayScrolls: S.dom.overlay.scrollHeight >= S.dom.overlay.clientHeight
    };
  });
  check('the 3D scene pauses while the map is open (the frame counter keeps running)', plan.paused && plan.framesWhileOpen > 0, JSON.stringify({ paused: plan.paused, frames: plan.framesWhileOpen }));
  // the search near the previous green has 7 s: a search that runs into that limit was starved (the old bug; on a slow phone
  // it ended with every hole red), so each must finish well inside it
  check('three holes get good spots, each search finishing well inside its 7 s budget', plan.ok.every(Boolean) && plan.times.every(function (t) { return t < 6000; }) && plan.buildEnabled, JSON.stringify({ ok: plan.ok, ms: plan.times }));
  check('a new course gets a par mix: 4, 3, 5', plan.pars.join() === '4,3,5', plan.pars.join());
  // a crowded plate can now and then leave no room near a green; well past the map's long-walk warning (150 m) is a regression
  check('the walks from green to tee stay short', plan.walks.slice(1).every(function (w) { return w <= 260; }), JSON.stringify(plan.walks));
  check('the summary row keeps its height (the page scrolls instead of squeezing it)', plan.summaryHeight >= 17 && /Par 12/.test(plan.summary), JSON.stringify({ h: plan.summaryHeight, text: plan.summary }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'blueprint-builder-map.png') });

  // 3. build: every hole, the par 3 with its approach strip, and the scene runs again
  const built = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    window._bpLastBuild = null;
    window.HoleBlueprint.build();
    const paused = window._pause3D;
    for (let w = 0; w < 600 && !window._bpLastBuild; w++) await wait(200);
    await wait(500);
    return {
      pausedAfterClose: paused, last: window._bpLastBuild, overlay: !!document.getElementById('bp-overlay'),
      holes: [0, 1, 2].map(function (i) {
        const h = courseHoles[i];
        return { par: h.par, green: !!h.greenData, tees: (h.teeBoxes || []).length, fairways: (h.fairways || []).length };
      })
    };
  });
  check('closing the map lets the scene run again', built.pausedAfterClose === false, String(built.pausedAfterClose));
  check('every hole is built', !!built.last && built.last.jobs === 3 && built.last.failed.length === 0 && built.holes.every(function (h) { return h.green && h.tees === 3; }), JSON.stringify({ last: built.last, holes: built.holes }));
  check('the holes take the planned par; the par 3 has its approach strip, the others their fairway', built.holes.map(function (h) { return h.par; }).join() === '4,3,5' && built.holes.every(function (h) { return h.fairways === 1; }), JSON.stringify(built.holes));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'blueprint-builder-built.png') });

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nBlueprint builder smoke test FAILED: ' + failed + ' check(s)' : '\nBlueprint builder smoke test passed');
  process.exit(failed ? 1 : 0);
})();
