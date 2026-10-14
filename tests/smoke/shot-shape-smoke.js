// Browser smoke test for the shot-shape buttons (draw / straight / fade) and the mobile club row.
//   npm --prefix tests install && npm --prefix tests run setup    (once; or set CHROMIUM_PATH)
//   npm run smoke:shape
// arcade.html (touch viewport, swing mode) and arcade_mobile.html: the buttons are visible and tappable (nothing on top of them),
// the selection follows the tap in the swing engine, the club buttons pick the club, and a fade / draw reaches the physics as a
// positive / negative spin axis. Set SHOTS=<dir> to also save screenshots.
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

const results = [];
function check(name, ok, detail) { results.push(!!ok); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : '')); }

// the page errors that are caused by this test blocking the network, not by the page
const NETWORK_ERRORS = /lucide is not defined/;

(async function () {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  let browser;
  try { browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.error('Could not start Chromium: ' + e.message.split('\n')[0] + '\nRun: npm --prefix tests run setup   (or set CHROMIUM_PATH)'); srv.close(); process.exit(2); }

  async function open(url, viewport) {
    const ctx = await browser.newContext({ viewport: viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
      const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
      if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort();
    });
    await ctx.route(/^https:\/\/(?!cdn)/, function (r) { r.abort(); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', function (e) { if (!NETWORK_ERRORS.test(e.message)) errors.push(e.message.slice(0, 160) + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' | ').slice(0, 220)); });
    await page.goto(base + url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(6000);
    return { ctx: ctx, page: page, errors: errors };
  }
  const shot = function (page, name) { return SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : null; };

  // ---- the shape row must be visible, tappable and fit on the screen ----
  async function shapeRow(page, selector, minHeight) {
    return page.evaluate(function (a) {
      const out = {};
      document.querySelectorAll(a.selector).forEach(function (b) {
        const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        out[b.dataset.shape] = { h: Math.round(r.height), hit: top === b || b.contains(top), onscreen: r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      });
      return out;
    }, { selector: selector });
  }
  async function selectShape(page, selector, label) {
    for (const shape of [1, -1, 0]) {
      await page.tap(selector + '[data-shape="' + shape + '"]');
      const s = await page.evaluate(function () { return { eng: SwingEngine.getShotShape(), sel: Array.from(document.querySelectorAll('.shape-btn.selected')).map(function (b) { return b.dataset.shape; }) }; });
      check(label + ' ' + { 1: 'fade', '-1': 'draw', 0: 'straight' }[shape] + ': the engine and the highlight follow the tap', s.eng === shape && s.sel.length === 1 && s.sel[0] === String(shape), JSON.stringify(s));
    }
  }

  // ---- arcade.html (touch viewport; the build mode it boots in turns the swing mode off, so it is switched on here) ----
  console.log('\narcade.html');
  {
    const o = await open('/arcade.html?mode=range', { width: 412, height: 800 });
    const page = o.page;
    await page.evaluate(function () {
      document.head.insertAdjacentHTML('beforeend', '<style>#voice-ctl{display:none !important}</style>');   // the build-mode voice button sits over the club row
      if (!document.body.classList.contains('swing-mode')) SwingEngine.enableSwingMode();
    });
    await page.waitForTimeout(500);
    await shot(page, 'arcade_shape.png');
    const row = await shapeRow(page, '#shape-selector .shape-btn');
    check('the three shape buttons are visible, tappable and at least 40 px high', Object.keys(row).length === 3 && Object.values(row).every(function (v) { return v.hit && v.onscreen && v.h >= 40; }), JSON.stringify(row));
    const pos = await page.evaluate(function () { const a = document.getElementById('shape-selector').getBoundingClientRect(), b = document.getElementById('club-selector').getBoundingClientRect(); return { shapeBottom: a.bottom, clubTop: b.top }; });
    check('the shape row sits above the club row', pos.shapeBottom <= pos.clubTop, JSON.stringify(pos));
    await selectShape(page, '#shape-selector .shape-btn', 'arcade');

    // what reaches the physics: a fade gives a positive and a draw a negative spin axis (the swing taps add a little miss of their own)
    await page.evaluate(function () { window.__shots = []; window.triggerRealShot = function (d) { window.__shots.push(d); }; });
    async function swing(club, shape) {
      await page.tap('#shape-selector .shape-btn[data-shape="' + shape + '"]');
      await page.tap('.club-btn[data-club="' + club + '"]');
      await page.evaluate(function () { window.__shots.length = 0; SwingEngine.onTap(); });
      await page.waitForTimeout(900);
      await page.evaluate(function () { SwingEngine.onTap(); }); await page.waitForTimeout(500);
      await page.evaluate(function () { SwingEngine.onTap(); }); await page.waitForTimeout(500);
      return page.evaluate(function () { return { club: SwingEngine.getClub(), shot: window.__shots[0] || null }; });
    }
    for (const club of ['SW', 'I7', 'DRIVER']) {
      const f = await swing(club, 1), d = await swing(club, -1), s = await swing(club, 0);
      const sa = await page.evaluate(function (c) { return SwingEngine.shapeAxisDeg(c, 1); }, club);
      check(club + ': the club button picks the club', f.club === club);
      check(club + ': a fade gives a positive and a draw a negative spin axis (' + sa + ' deg from the shape)',
            !!(f.shot && d.shot && s.shot) && f.shot.spinAxisDeg > 0.4 * sa && d.shot.spinAxisDeg < -0.4 * sa && f.shot.spinAxisDeg > s.shot.spinAxisDeg && d.shot.spinAxisDeg < s.shot.spinAxisDeg,
            f.shot && d.shot && s.shot ? f.shot.spinAxisDeg.toFixed(1) + ' / ' + s.shot.spinAxisDeg.toFixed(1) + ' / ' + d.shot.spinAxisDeg.toFixed(1) : 'no shot reached the physics');
    }
    const putt = await swing('PUTT', 1);
    check('the putter ignores the shape', !putt.shot || Math.abs(putt.shot.spinAxisDeg) < 20, putt.shot ? 'axis ' + putt.shot.spinAxisDeg.toFixed(1) : 'no shot');
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- arcade_mobile.html ----
  console.log('\narcade_mobile.html');
  {
    const o = await open('/arcade_mobile.html', { width: 390, height: 844 });
    const page = o.page;
    await shot(page, 'mobile_shape.png');
    const row = await shapeRow(page, '#ui-shape .shape-btn');
    check('the three shape buttons are visible, tappable (nothing on top, e.g. the SWING button) and at least 44 px high', Object.keys(row).length === 3 && Object.values(row).every(function (v) { return v.hit && v.onscreen && v.h >= 44; }), JSON.stringify(row));
    const clubs = await page.evaluate(function () { return Array.from(document.querySelectorAll('#ui-clubs .club-btn')).map(function (b) { return b.dataset.club; }); });
    check('the club row has nine clubs wired to the engine', clubs.join(',') === 'DRIVER,W3,I5,I7,I9,PW,SW,LW,PUTT', clubs.join(','));
    await selectShape(page, '#ui-shape .shape-btn', 'mobile');
    for (const club of ['LW', 'PW', 'W3']) {
      await page.evaluate(function (c) { document.querySelector('#ui-clubs .club-btn[data-club="' + c + '"]').scrollIntoView({ inline: 'center' }); }, club);
      await page.tap('#ui-clubs .club-btn[data-club="' + club + '"]');
      const cs = await page.evaluate(function () { return { club: SwingEngine.getClub(), sel: Array.from(document.querySelectorAll('#ui-clubs .club-btn.selected')).map(function (b) { return b.dataset.club; }) }; });
      check('mobile: the ' + club + ' button picks the club and is the only one highlighted', cs.club === club && cs.sel.length === 1 && cs.sel[0] === club, JSON.stringify(cs));
    }
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nShape smoke test FAILED: ' + failed + ' check(s)' : '\nShape smoke test passed');
  process.exit(failed ? 1 : 0);
})();
