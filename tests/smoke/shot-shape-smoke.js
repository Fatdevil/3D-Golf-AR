// Browser smoke test for the play interface: the shot-shape buttons (draw / straight / fade), the club row, the input mode picker
// (swing / launch monitor / numbers) and the mobile page's shot direction and flight handling.
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

// a flat test course served for /api/courses/<code>: tee 150 m south of the origin, the flag 100 m to the right and 100 m north (21.8 degrees off the north line)
const COURSE = { share_code: 'TESTCOURSE', holes: [{ par: 4, tees: { yellow: { x: 0, y: 0, z: 150 } }, flag: { x: 100, y: 0, z: -100 } }] };

function serve() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p.indexOf('/api/courses/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(COURSE)); }
      const f = path.join(ROOT, p === '/' ? 'hub.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', function () { resolve(srv); });
  });
}

const results = [];
function check(name, ok, detail) { results.push(!!ok); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : '')); }

// test mode only starts on a course with a hole (a tee and a flag): the new empty course gets one first
const ENTER_TEST = function () {
  const h = courseHoles[0];
  h.tees = h.tees || {}; h.tees.yellow = { x: 0, y: 0, z: 0 }; h.flag = { x: 0, y: 0, z: -100 };
  if (!h.flagMesh) { h.flagMesh = new THREE.Object3D(); scene.add(h.flagMesh); }
  window.confirm = function () { return true; };
  setMode('TEST');
  document.getElementById('play-tools').style.display = 'flex';
};

// arcade_mobile.html loads Lucide from unpkg and calls lucide.createIcons() first in its main script: without it the page never boots
const LUCIDE_STUB = 'window.lucide = { createIcons: function () {} };';

(async function () {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  let browser;
  try { browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.error('Could not start Chromium: ' + e.message.split('\n')[0] + '\nRun: npm --prefix tests run setup   (or set CHROMIUM_PATH)'); srv.close(); process.exit(2); }

  // opts.touch false = a desktop browser (mouse, no touch)
  async function open(url, viewport, opts) {
    const touch = !(opts && opts.touch === false);
    const ctx = await browser.newContext({ viewport: viewport, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
    if (opts && opts.init) await ctx.addInitScript(opts.init);
    await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
      const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
      // OrbitControls: keep the instance on window so a test can read the camera azimuth
      const extra = k === 'OrbitControls.js' ? ';(function(){var O=THREE.OrbitControls;THREE.OrbitControls=function(){var c=new O(...arguments);window.__ctl=c;return c};THREE.OrbitControls.prototype=O.prototype;})();' : '';
      if (k) r.fulfill({ body: fs.readFileSync(CDN[k]) + extra, contentType: 'application/javascript' }); else r.abort();
    });
    await ctx.route(/^https:\/\/unpkg\.com\/lucide/, function (r) { r.fulfill({ body: LUCIDE_STUB, contentType: 'application/javascript' }); });
    await ctx.route(/^https:\/\/(?!cdn|unpkg\.com\/lucide)/, function (r) { r.abort(); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', function (e) { errors.push(e.message.slice(0, 160) + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' | ').slice(0, 220)); });
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
    check('the putter ignores the shape (a putt reached the physics, with no shape axis)', putt.club === 'PUTT' && !!putt.shot && Math.abs(putt.shot.spinAxisDeg) < 20, putt.shot ? 'axis ' + putt.shot.spinAxisDeg.toFixed(1) : 'no shot reached the physics');
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- arcade_mobile.html ----
  console.log('\narcade_mobile.html');
  {
    const o = await open('/arcade_mobile.html', { width: 390, height: 844 });
    const page = o.page;
    await shot(page, 'mobile_shape.png');
    const booted = await page.evaluate(function () { return { shot: typeof window.triggerRealShot, hole: window.playingHoleIndex, engine: typeof window.SwingEngine }; });
    check('the page booted (initMobileArcade ran: the shot hook and the hole index exist)', booted.shot === 'function' && booted.hole === 0 && booted.engine === 'object', JSON.stringify(booted));
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

  // ---- arcade_mobile.html on small phones: the SWING button must clear the top bar and the two rows, and the rows must fit ----
  for (const vp of [{ name: 'landscape', width: 568, height: 320 }, { name: 'compact portrait', width: 320, height: 480 }]) {
    console.log('\narcade_mobile.html (' + vp.name + ' ' + vp.width + 'x' + vp.height + ')');
    const o = await open('/arcade_mobile.html', { width: vp.width, height: vp.height });
    const page = o.page;
    await shot(page, 'mobile_' + vp.name.replace(' ', '_') + '.png');
    const g = await page.evaluate(function () {
      const r = function (el) { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      const hit = function (a, b) { return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; };
      const swing = r(document.getElementById('main-swing-btn'));
      const top = r(document.querySelector('.top-bar'));
      const shapes = Array.from(document.querySelectorAll('#ui-shape .shape-btn')).map(function (b) { return { rect: r(b), tap: document.elementFromPoint((r(b).l + r(b).r) / 2, (r(b).t + r(b).b) / 2) === b }; });
      // the club row scrolls sideways and clips its buttons: only the part inside the row is on screen
      const row = r(document.getElementById('ui-clubs'));
      const clubs = Array.from(document.querySelectorAll('#ui-clubs .club-btn')).map(r).map(function (x) { return { l: Math.max(x.l, row.l), r: Math.min(x.r, row.r), t: x.t, b: x.b }; }).filter(function (x) { return x.r > x.l; });
      return { swing: swing, overTop: hit(swing, top), overShape: shapes.some(function (s) { return hit(swing, s.rect); }), overClub: clubs.some(function (c) { return hit(swing, c); }),
               shapesTappable: shapes.every(function (s) { return s.tap; }), shapesOnscreen: shapes.every(function (s) { return s.rect.b <= innerHeight && s.rect.l >= 0 && s.rect.r <= innerWidth; }), swingOnscreen: swing.r <= innerWidth && swing.b <= innerHeight && swing.l >= 0 && swing.t >= 0 };
    });
    check(vp.name + ': the SWING button does not cover the top bar', !g.overTop, JSON.stringify(g.swing));
    check(vp.name + ': the SWING button does not cover the shape or club buttons', !g.overShape && !g.overClub);
    check(vp.name + ': the shape buttons are tappable and everything fits on the screen', g.shapesTappable && g.shapesOnscreen && g.swingOnscreen, JSON.stringify({ tap: g.shapesTappable, shapes: g.shapesOnscreen, swing: g.swingOnscreen }));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- the input mode picker: swing / launch monitor / numbers ----
  console.log('\ninput modes (desktop browser)');
  {
    const o = await open('/arcade.html?mode=range', { width: 1280, height: 720 }, { touch: false });
    const page = o.page;
    const state = function () {
      return page.evaluate(function () {
        const vis = function (sel) { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
        return { mode: SwingEngine.getInputMode(), swing: document.body.classList.contains('swing-mode'), numbers: vis('#manual-tools'), clubs: vis('#club-selector'), shapes: vis('#shape-selector'), pick: vis('#hb-input-mode'), saved: localStorage.getItem('golfos_input_mode') };
      });
    };
    await page.evaluate(function () { localStorage.removeItem('golfos_input_mode'); });
    let st = await state();
    check('build mode: no swing UI and no input picker', !st.swing && !st.pick, JSON.stringify(st));
    await page.evaluate(ENTER_TEST);
    st = await state();
    check('lab (test mode) on a desktop browser: numbers by default, no swing UI', st.mode === 'NUMBERS' && st.numbers && !st.swing && !st.clubs && st.saved === null, JSON.stringify(st));
    await page.evaluate(function () { toggleHamburgerMenu(); });
    st = await state();
    check('the menu shows the input picker outside build mode', st.pick, JSON.stringify(st));
    await page.click('#hb-input-mode .input-btn[data-input="SWING"]');
    st = await state();
    check('Swing: the swing circle UI is on (clubs, shapes) and the numbers are hidden', st.mode === 'SWING' && st.swing && st.clubs && st.shapes && !st.numbers && st.saved === 'SWING', JSON.stringify(st));
    await shot(page, 'desktop_swing.png');
    await page.click('#hb-input-mode .input-btn[data-input="LM"]');
    st = await state();
    check('Launch monitor: no controls on the screen (neither swing UI nor numbers)', st.mode === 'LM' && !st.swing && !st.clubs && !st.numbers && st.saved === 'LM', JSON.stringify(st));
    await page.click('#hb-input-mode .input-btn[data-input="NUMBERS"]');
    st = await state();
    check('Numbers: the typed values are back and the swing UI is off', st.mode === 'NUMBERS' && st.numbers && !st.swing && !st.clubs && st.saved === 'NUMBERS', JSON.stringify(st));
    const sel = await page.evaluate(function () { return Array.from(document.querySelectorAll('#hb-input-mode .input-btn.selected')).map(function (b) { return b.dataset.input; }); });
    check('exactly one picker button is highlighted', sel.length === 1 && sel[0] === 'NUMBERS', JSON.stringify(sel));
    await page.evaluate(function () { SwingEngine.setInputMode('SWING'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(6000);
    await page.evaluate(ENTER_TEST);
    st = await state();
    check('the choice is remembered after a reload', st.mode === 'SWING' && st.swing, JSON.stringify(st));
    // the leaderboard filing follows the picker (arcade-round-result.js reads window.G.inputMode)
    const filing = await page.evaluate(function () {
      const out = {};
      for (const m of ['SWING', 'LM', 'NUMBERS']) { SwingEngine.setInputMode(m); out[m] = window.G.inputMode; }
      return out;
    });
    check('the leaderboard mode follows the picker (swing = swing meter, launch monitor, typed numbers = manual)', filing.SWING === 'SWING_METER' && filing.LM === 'LAUNCH_MONITOR' && filing.NUMBERS === 'MANUAL', JSON.stringify(filing));
    await page.evaluate(function () { setMode('BUILD'); });
    st = await state();
    check('back in build mode the swing UI and the picker are gone', !st.swing && !st.pick, JSON.stringify(st));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- a launch monitor bridge and the input mode ----
  console.log('\nlaunch monitor bridge');
  {
    const o = await open('/arcade.html?mode=range', { width: 1280, height: 720 }, { touch: false, init: 'window._disableLMBridge = true;' });
    const page = o.page;
    await page.evaluate(function () { localStorage.removeItem('golfos_input_mode'); });
    const snap = function () { return page.evaluate(function () { return { mode: SwingEngine.getInputMode(), accepts: SwingEngine.acceptsBridgeShots(), filing: window.G.inputMode }; }); };
    // connects while the builder is open: nothing changes until play or test starts
    const before = await snap();
    await page.evaluate(function () { SwingEngine.setBridgeConnected(true); });
    let st = await snap();
    check('a bridge connecting in build mode changes nothing yet', st.mode === before.mode && st.filing === before.filing, JSON.stringify({ before: before, after: st }));
    await page.evaluate(ENTER_TEST);
    st = await snap();
    check('test / play starts with the launch monitor as input while the bridge is connected', st.mode === 'LM' && st.accepts && st.filing === 'LAUNCH_MONITOR', JSON.stringify(st));
    await page.evaluate(function () { SwingEngine.setInputMode('SWING'); });
    st = await snap();
    check('the player picks Swing: bridge shots are ignored and the round counts as a swing meter round', st.mode === 'SWING' && !st.accepts && st.filing === 'SWING_METER', JSON.stringify(st));
    await page.evaluate(function () { SwingEngine.setBridgeConnected(false); SwingEngine.setBridgeConnected(true); });
    st = await snap();
    check('a reconnecting bridge does not override what the player picked', st.mode === 'SWING' && !st.accepts, JSON.stringify(st));
    await page.evaluate(function () { SwingEngine.setInputMode('LM'); });
    st = await snap();
    check('the player picks the launch monitor: its shots are accepted', st.mode === 'LM' && st.accepts && st.filing === 'LAUNCH_MONITOR', JSON.stringify(st));
    // a bridge that is not there reports 'disconnected' every few seconds: that must not interrupt a swing in progress
    const swing = await page.evaluate(async function () {
      SwingEngine.setInputMode('SWING');
      SwingEngine.onTap();
      const active = function () { return document.getElementById('swing-overlay').classList.contains('active'); };
      const started = active();
      SwingEngine.setBridgeConnected(false); SwingEngine.setBridgeConnected(false); SwingEngine.applyInputMode({ lab: false });
      return { started: started, stillRunning: active() };
    });
    check('redundant "bridge disconnected" reports and re-applying the mode do not interrupt a swing in progress', swing.started && swing.stillRunning, JSON.stringify(swing));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }
  {
    // a bridge that goes away: back to the stored choice or the default
    const o = await open('/arcade.html?mode=range', { width: 1280, height: 720 }, { touch: false, init: 'window._disableLMBridge = true;' });
    const page = o.page;
    await page.evaluate(function () { localStorage.removeItem('golfos_input_mode'); SwingEngine.setBridgeConnected(true); });
    await page.evaluate(ENTER_TEST);
    await page.evaluate(function () { SwingEngine.setBridgeConnected(false); });
    const st = await page.evaluate(function () { return { mode: SwingEngine.getInputMode(), filing: window.G.inputMode }; });
    check('the bridge disconnects: test mode goes back to numbers on a desktop browser', st.mode === 'NUMBERS' && st.filing === 'MANUAL', JSON.stringify(st));
    await o.ctx.close();
  }

  console.log('\ninput modes (phone)');
  {
    const o = await open('/arcade.html?mode=range', { width: 412, height: 800 });
    const page = o.page;
    await page.evaluate(function () { localStorage.removeItem('golfos_input_mode'); });
    await page.evaluate(ENTER_TEST);
    const st = await page.evaluate(function () { return { mode: SwingEngine.getInputMode(), swing: document.body.classList.contains('swing-mode') }; });
    check('on a phone the swing UI is the default, in test mode too', st.mode === 'SWING' && st.swing, JSON.stringify(st));
    // no new swing while the ball is still on its way (a page that animates the flight says so with isBallFlying)
    const tap = await page.evaluate(async function () {
      const active = function () { return document.getElementById('swing-overlay').classList.contains('active'); };
      window.isBallFlying = function () { return true; };
      SwingEngine.onTap(); const duringFlight = active();
      window.isBallFlying = function () { return false; };
      SwingEngine.onTap(); const afterLanding = active();
      return { duringFlight: duringFlight, afterLanding: afterLanding };
    });
    check('a tap while the ball is flying does not start a swing; once it has landed it does', tap.duringFlight === false && tap.afterLanding === true, JSON.stringify(tap));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  console.log('\nstored input mode (phone)');
  {
    const o = await open('/arcade.html?mode=range', { width: 412, height: 800 }, { init: "localStorage.setItem('golfos_input_mode', 'NUMBERS')" });
    const page = o.page;
    await page.evaluate(ENTER_TEST);
    const st = await page.evaluate(function () {
      const vis = function (sel) { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
      return { mode: SwingEngine.getInputMode(), swing: document.body.classList.contains('swing-mode'), clubs: vis('#club-selector'), numbers: vis('#manual-tools') };
    });
    check('a stored Numbers choice is respected on a phone: no swing UI, typed values shown', st.mode === 'NUMBERS' && !st.swing && !st.clubs && st.numbers, JSON.stringify(st));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- arcade_mobile.html: the shot goes where the camera looks, one shot at a time, the shot data never covers the buttons ----
  console.log('\narcade_mobile.html (shots)');
  {
    const o = await open('/arcade_mobile.html?course=TESTCOURSE', { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () {
      const sim = GolfPhysics.simulateFlight; window.__sims = [];
      GolfPhysics.simulateFlight = function (inp, env) {
        const l = console.log; console.log = function () {}; let r; try { r = sim.call(this, inp, env); } finally { console.log = l; }
        window.__sims.push({ inp: JSON.parse(JSON.stringify(inp)), path: r.path.map(function (p) { return [p.x, p.y]; }) }); return r;
      };
    });
    const flightVsView = function () {
      return page.evaluate(function () {
        const c = window.__ctl, look = [c.target.x - c.object.position.x, c.target.z - c.object.position.z];
        window.isBallFlying() === false && window.triggerRealShot({ ballSpeedMph: 100, launchAngleDeg: 25, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 0, isLiveData: false, impactData: { offset: 0.1, direction: 1 } });
        const L = window.__sims[window.__sims.length - 1], p0 = L.path[0], p1 = L.path[L.path.length - 1];
        return { view: Math.atan2(look[0], -look[1]) * 180 / Math.PI, flight: Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI };
      });
    };
    const d = await flightVsView();
    check('an untouched camera aims at the hole: the flight follows the view (the hole is 21.8 deg off the north line)', Math.abs(d.view - 21.8) < 0.5 && Math.abs(d.flight - d.view) < 0.5, JSON.stringify(d));
    const sims = await page.evaluate(function () { return window.__sims.length; });
    await page.waitForTimeout(500);
    await page.evaluate(function () { window.triggerRealShot({ ballSpeedMph: 100, launchAngleDeg: 25, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 0, isLiveData: false }); });
    check('a second shot while the ball is flying is ignored', (await page.evaluate(function () { return window.__sims.length; })) === sims);
    const lm = await page.evaluate(function () {
      return Array.from(document.querySelectorAll('#ui-shape .shape-btn, #ui-clubs .club-btn')).filter(function (b) {
        const r = b.getBoundingClientRect(); if (r.right > innerWidth || r.left < 0) return false;
        const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !(top === b || b.contains(top));
      }).map(function (b) { return b.dataset.shape || b.dataset.club; });
    });
    check('the launch monitor panel (visible after a shot) does not cover the shape or club buttons', lm.length === 0, JSON.stringify(lm));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // the camera turned by dragging: a new page so the ball is back at the tee
  {
    const o = await open('/arcade_mobile.html?course=TESTCOURSE', { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () {
      const sim = GolfPhysics.simulateFlight; window.__sims = [];
      GolfPhysics.simulateFlight = function (inp, env) {
        const l = console.log; console.log = function () {}; let r; try { r = sim.call(this, inp, env); } finally { console.log = l; }
        window.__sims.push({ path: r.path.map(function (p) { return [p.x, p.y]; }) }); return r;
      };
    });
    for (const drag of [120, -120]) {
      await page.mouse.move(195, 300); await page.mouse.down(); await page.mouse.move(195 + drag, 300, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(400);
      const d = await page.evaluate(function () {
        const c = window.__ctl, look = [c.target.x - c.object.position.x, c.target.z - c.object.position.z];
        window.__sims.length = 0; window.triggerRealShot({ ballSpeedMph: 100, launchAngleDeg: 25, totalSpinRpm: 6000, spinAxisDeg: 0, azimDeg: 0, isLiveData: false });
        const L = window.__sims[0], p0 = L.path[0], p1 = L.path[L.path.length - 1];
        return { view: Math.atan2(look[0], -look[1]) * 180 / Math.PI, flight: Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI };
      });
      check('camera dragged ' + (drag > 0 ? 'right' : 'left') + ': the flight follows the view, not its mirror image', Math.abs(d.flight - d.view) < 0.5, JSON.stringify(d));
      await page.evaluate(function () { window.location.reload(); });
      await page.waitForTimeout(6000);
      await page.evaluate(function () {
        const sim = GolfPhysics.simulateFlight; window.__sims = [];
        GolfPhysics.simulateFlight = function (inp, env) {
          const l = console.log; console.log = function () {}; let r; try { r = sim.call(this, inp, env); } finally { console.log = l; }
          window.__sims.push({ path: r.path.map(function (p) { return [p.x, p.y]; }) }); return r;
        };
      });
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
