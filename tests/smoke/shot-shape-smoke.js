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

// flat test courses served for /api/courses/<code>
//   TESTCOURSE: hole 1 par 4, tee 150 m south of the origin, the flag 100 m to the right and 100 m north (21.8 degrees off the north line);
//               hole 2 par 3, tee at (50, 100), flag 40 m north of it
//   PUTTCOURSE: one par 3 hole, a 3 m putt straight north
const COURSES = {
  TESTCOURSE: { share_code: 'TESTCOURSE', holes: [
    { par: 4, tees: { yellow: { x: 0, y: 0, z: 150 } }, flag: { x: 100, y: 0, z: -100 } },
    { par: 3, tees: { yellow: { x: 50, y: 0, z: 100 } }, flag: { x: 50, y: 0, z: 60 } }
  ] },
  // a course with its own palette (theme_data comes as a JSON string): its greens are magenta
  PALETTECOURSE: { share_code: 'PALETTECOURSE', theme_data: JSON.stringify({ config: { greenColor: '#ff00ff' } }), holes: [{ par: 3, tees: { yellow: { x: 0, y: 0, z: 3 } }, flag: { x: 0, y: 0, z: 0 } }] },
  PUTTCOURSE: { share_code: 'PUTTCOURSE', holes: [{ par: 3, tees: { yellow: { x: 0, y: 0, z: 3 } }, flag: { x: 0, y: 0, z: 0 } }] }
};

function serve() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/api/courses') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([
        { share_code: 'TESTCOURSE', name: 'Test <b id="xss">Course</b>', author: 'Anna', hole_count: 2, total_par: 7 },
        { share_code: 'PUTTCOURSE', name: 'Putt Green', author: null, hole_count: 1, total_par: 3 }
      ])); }
      if (p.indexOf('/api/courses/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(COURSES[p.slice('/api/courses/'.length)] || {})); }
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
    // no new swing while the ball is still on its way: the page's own flight state (isFlying) answers through isBallFlying
    const tap = await page.evaluate(async function () {
      const active = function () { return document.getElementById('swing-overlay').classList.contains('active'); };
      const hasHook = typeof window.isBallFlying === 'function';
      isFlying = true;
      const hookWhileFlying = window.isBallFlying();
      SwingEngine.onTap(); const duringFlight = active();
      isFlying = false;
      SwingEngine.onTap(); const afterLanding = active();
      return { hasHook: hasHook, hookWhileFlying: hookWhileFlying, duringFlight: duringFlight, afterLanding: afterLanding };
    });
    check('a tap while the ball is flying does not start a swing; once it has landed it does (on arcade.html too)', tap.hasHook && tap.hookWhileFlying && tap.duringFlight === false && tap.afterLanding === true, JSON.stringify(tap));
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

  // ---- the rules on the mobile page: holed, water, out of bounds, gimme, the next hole, the scorecard ----
  console.log('\narcade_mobile.html (rules)');
  {
    const o = await open('/arcade_mobile.html?course=TESTCOURSE', { width: 390, height: 844 });
    const page = o.page;
    // a controlled shot: the physics is replaced by a flight to (x, z) in the scene's coordinates, with the metrics the test names
    await page.evaluate(function () {
      const sim = GolfPhysics.simulateFlight;
      GolfPhysics.simulateFlight = function (inp, env) {
        if (!window.__fake) return sim.call(this, inp, env);
        const f = window.__fake; window.__fake = null;
        const sx = inp.startPos[0], sy = inp.startPos[1], N = 12, path = [];
        for (let i = 0; i <= N; i++) path.push({ x: sx + (f.x - sx) * i / N, y: sy + (-f.z - sy) * i / N, z: i === 0 || i === N ? 0 : 3, phase: i === N ? 'roll' : (i < 4 ? 'flight' : 'bounce'), time: i * 0.1 });
        return { path: path, metrics: { holed: !!f.holed, finalTerrainType: f.terrain || 'FAIRWAY', totalMeters: 10, carryMeters: 8 } };
      };
    });
    const hit = async function (fake) {
      await page.evaluate(function (f) { window.__fake = f; window.triggerRealShot({ ballSpeedMph: 80, launchAngleDeg: 20, totalSpinRpm: 5000, spinAxisDeg: 0, azimDeg: 0, isLiveData: false }); }, fake);
      await page.waitForFunction(function () { return !window.isBallFlying(); }, null, { timeout: 30000 });
      await page.waitForTimeout(150);
    };
    const snap = function () {
      return page.evaluate(function () {
        const p = GolfEngine.getActivePlayer(), c = window.__ctl, look = [c.target.x - c.object.position.x, c.target.z - c.object.position.z];
        const h = courseHoles[playingHoleIndex];
        const toHole = [h.flag.x - ballMesh.position.x, h.flag.z - ballMesh.position.z];
        const popup = document.getElementById('popup-result');
        return { strokes: p.strokes, penalty: p.penaltyStrokes, holedOut: p.holedOut, scores: p.scores.slice(), hole: playingHoleIndex,
                 ball: [+ballMesh.position.x.toFixed(1), +ballMesh.position.z.toFixed(1)],
                 viewDeg: +(Math.atan2(look[0], -look[1]) * 180 / Math.PI).toFixed(1), holeDeg: +(Math.atan2(toHole[0], -toHole[1]) * 180 / Math.PI).toFixed(1),
                 popup: popup.style.display === 'flex' ? document.getElementById('popup-title').innerText : null, btn: document.getElementById('popup-btn').innerText,
                 score: document.getElementById('ui-player-score').innerText, holeText: document.getElementById('ui-hole').innerText, par: document.getElementById('ui-par').innerText };
      });
    };
    let st = await snap();
    check('hole 1 of 2 is up: par 4, nothing played', st.holeText === 'Hole 1/2' && /^Par 4/.test(st.par) && st.strokes === 0 && st.hole === 0, JSON.stringify(st));

    await hit({ x: 10, z: 40, terrain: 'FAIRWAY' });
    st = await snap();
    check('a normal shot: one stroke counted once, the ball lies where it stopped, no popup', st.strokes === 1 && st.penalty === 0 && !st.holedOut && Math.abs(st.ball[0] - 10) < 0.5 && Math.abs(st.ball[1] - 40) < 0.5 && st.popup === null && st.score === '1', JSON.stringify(st));
    check('after the stop the camera sits behind the ball, aimed at the hole', Math.abs(st.viewDeg - st.holeDeg) < 0.5, JSON.stringify({ view: st.viewDeg, hole: st.holeDeg }));
    check('the distance to the pin in the header follows the ball', /\| 1(8\d|9\d)yd$/.test(st.par) || /yd$/.test(st.par) && st.par !== 'Par 4 | 420m', st.par);

    await hit({ x: 100, z: -100, holed: true, terrain: 'GREEN' });
    st = await snap();
    check('holed: the hole is done with 2 strokes on the card, a popup (eagle on a par 4) with Next hole', st.holedOut && st.scores[0] === 2 && st.popup === 'EAGLE' && st.btn === 'Next hole', JSON.stringify(st));
    await page.click('#popup-btn');
    await page.waitForTimeout(500);
    st = await snap();
    check('Next hole: hole 2 of 2 is up, par 3, the ball on its tee, strokes back to 0', st.hole === 1 && st.holeText === 'Hole 2/2' && /^Par 3/.test(st.par) && st.strokes === 0 && st.penalty === 0 && !st.holedOut && Math.abs(st.ball[0] - 50) < 0.5 && Math.abs(st.ball[1] - 100) < 0.5 && st.score === '0' && st.popup === null, JSON.stringify(st));
    check('the new hole is aimed at as well', Math.abs(st.viewDeg - st.holeDeg) < 0.5, JSON.stringify({ view: st.viewDeg, hole: st.holeDeg }));

    // water: the ball goes in beyond z = 80, drops where it crossed the line
    await page.evaluate(function () { window._terrainTypeAt = function (x, y) { return -y < 80 ? 'WATER' : 'FAIRWAY'; }; });
    await hit({ x: 50, z: 70, terrain: 'WATER' });
    st = await snap();
    check('water: a penalty stroke, the ball dropped where it went in (z about 80), a popup', st.penalty === 1 && st.strokes === 1 && !st.holedOut && st.popup === 'WATER!' && Math.abs(st.ball[1] - 80) < 4 && st.score === '2', JSON.stringify(st));
    await page.click('#popup-btn');
    await page.waitForTimeout(500);
    const dropped = (await snap()).ball;

    // out of bounds: back to where the shot was played from
    await hit({ x: 70, z: 75, terrain: 'OB' });
    st = await snap();
    check('out of bounds: a penalty stroke, the ball back where the shot was played from', st.penalty === 2 && st.popup === 'OUT OF BOUNDS' && Math.abs(st.ball[0] - dropped[0]) < 0.5 && Math.abs(st.ball[1] - dropped[1]) < 0.5, JSON.stringify({ ball: st.ball, from: dropped, penalty: st.penalty }));
    await page.click('#popup-btn');
    await page.waitForTimeout(500);

    // gimme: within 10 ft of the flag on the green
    await page.evaluate(function () { window._terrainTypeAt = function () { return 'GREEN'; }; });
    await hit({ x: 50, z: 61.5, terrain: 'FAIRWAY' });   // the physics keeps the surface it landed on; the ball rolled onto the green
    st = await snap();
    check('gimme from the resting surface (landed on fairway, rolled onto the green): the putt is added, the hole done (3 strokes + 1 putt + 2 penalty = 6), the last hole offers Finish round', st.holedOut && st.scores[1] === 6 && st.btn === 'Finish round', JSON.stringify(st));
    await page.click('#popup-btn');
    await page.waitForTimeout(600);
    const end = await page.evaluate(function () {
      const popup = document.getElementById('popup-result');
      return { title: popup.style.display === 'flex' ? document.getElementById('popup-title').innerText : null, rows: document.querySelectorAll('#popup-desc .sc-table tr').length, text: document.getElementById('popup-desc').innerText.replace(/\s+/g, ' '), btn: document.getElementById('popup-btn').innerText };
    });
    check('the round is complete: a scorecard with both holes and the total 8 (2 + 6), Back to menu', end.title === 'ROUND COMPLETE' && end.rows === 4 && /Total 8/.test(end.text) && end.btn === 'Back to menu', JSON.stringify(end));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // the scorecard can be opened during the round, and a real putt (the real physics) can drop
  {
    const o = await open('/arcade_mobile.html?course=PUTTCOURSE', { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () { window._terrainTypeAt = function () { return 'GREEN'; }; });
    await page.click('.player-info');
    await page.waitForTimeout(400);
    const card = await page.evaluate(function () { return { title: document.getElementById('popup-title').innerText, rows: document.querySelectorAll('#popup-desc .sc-table tr').length }; });
    check('tapping the score opens the scorecard (one hole)', card.title === 'SCORECARD' && card.rows === 3, JSON.stringify(card));
    await page.click('#popup-btn');
    await page.waitForTimeout(500);
    await page.evaluate(function () { window.triggerRealShot({ ballSpeedMph: 4.5, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0, isLiveData: false }); });
    await page.waitForFunction(function () { return !window.isBallFlying(); }, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    const holed = await page.evaluate(function () {
      const popup = document.getElementById('popup-result');
      return { holedOut: GolfEngine.getActivePlayer().holedOut, strokes: GolfEngine.getActivePlayer().strokes, title: popup.style.display === 'flex' ? document.getElementById('popup-title').innerText : null, btn: document.getElementById('popup-btn').innerText };
    });
    check('a real 3 m putt on the real physics drops: the cup is wired to the physics (before, a ball could never be holed)', holed.holedOut && holed.strokes === 1 && holed.title === 'HOLE IN ONE!' && holed.btn === 'Finish round', JSON.stringify(holed));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- the surfaces: the course's own palette decides what the ball lies on ----
  console.log('\narcade_mobile.html (surfaces)');
  for (const c of [{ code: 'TESTCOURSE', label: 'standard palette', green: '#8acf72', notGreen: null }, { code: 'PALETTECOURSE', label: "the course's own palette (green is #ff00ff)", green: '#ff00ff', notGreen: '#8acf72' }]) {
    const o = await open('/arcade_mobile.html?course=' + c.code, { width: 390, height: 844 });
    const page = o.page;
    const r = await page.evaluate(function (cfg) {
      const data = new Uint8ClampedArray(4096 * 4096 * 4);
      window.biomeDataCache = data;
      const hex = function (h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
      const probe = function (x, color) {   // paint the pixel under (x, y = -10) and read it back through the game's own lookup
        const y = -10, ix = Math.floor((x + 450) / 900 * 4096), iy = Math.floor((-y + 450) / 900 * 4096), i = (iy * 4096 + ix) * 4, c = hex(color);
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
        return window._terrainTypeAt(x, y);
      };
      const out = { green: probe(0, cfg.green), ob: probe(3, '#ef4444'), water: probe(6, '#38bdf8'), sand: probe(9, '#e0d8a4'), fairway: probe(12, '#79b84f'), rough: probe(15, '#4c7d32') };
      if (cfg.notGreen) out.stdGreen = probe(18, cfg.notGreen);
      window.biomeDataCache = null;
      return out;
    }, c);
    check(c.label + ': green is GREEN, the painted OB is OB (it used to read as fairway), water, sand, fairway and rough are told apart',
          r.green === 'GREEN' && r.ob === 'OB' && r.water === 'WATER' && r.sand === 'SAND' && r.fairway === 'FAIRWAY' && r.rough === 'ROUGH', JSON.stringify(r));
    if (c.notGreen) check("the standard green colour is not a green on a course with another palette", r.stdGreen !== 'GREEN', r.stdGreen);
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // ---- the mobile menu: the real, published courses ----
  console.log('\narcade_mobile_hub.html (courses)');
  {
    const o = await open('/arcade_mobile_hub.html', { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () { navTo('view-courses'); });
    await page.waitForSelector('.course-card', { timeout: 10000 });
    const list = await page.evaluate(function () {
      return { names: Array.from(document.querySelectorAll('.course-name')).map(function (n) { return n.textContent; }), meta: document.querySelector('.course-card').innerText.replace(/\s+/g, ' '),
               injected: !!document.getElementById('xss'), mock: document.body.innerText.indexOf('Pine Valley') >= 0 };
    });
    check('the course list comes from the server (GET /api/courses), not from a made-up list', list.names.length === 2 && list.names[1] === 'Putt Green' && !list.mock, JSON.stringify(list.names));
    check('a course name with HTML in it is shown as text, not run', list.names[0] === 'Test <b id="xss">Course</b>' && !list.injected, JSON.stringify(list.names[0]));
    check('a card shows holes, par and the author', /2 Holes/.test(list.meta) && /Par 7/.test(list.meta) && /Anna/.test(list.meta), list.meta);
    const nextDisabled = await page.evaluate(function () { return document.getElementById('main-action-btn').disabled; });
    await page.click('.course-card:nth-child(2)');
    const picked = await page.evaluate(function () { return { code: matchState.courseCode, selected: document.querySelectorAll('.course-card.selected').length, disabled: document.getElementById('main-action-btn').disabled }; });
    check('picking a course selects it by its share code and enables Continue', nextDisabled === true && picked.code === 'PUTTCOURSE' && picked.selected === 1 && picked.disabled === false, JSON.stringify(picked));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }
  {
    const o = await open('/arcade_mobile_hub.html', { width: 390, height: 844 });
    const page = o.page;
    await page.route('**/api/courses', function (r) { r.fulfill({ status: 500, body: '{}' }); });
    await page.evaluate(function () { navTo('view-courses'); });
    await page.waitForFunction(function () { return /Could not load/.test(document.getElementById('course-list-container').innerText); }, null, { timeout: 10000 });
    const msg = await page.evaluate(function () { return document.getElementById('course-list-container').innerText.replace(/\s+/g, ' '); });
    const retryVisible = await page.evaluate(function () { const b = document.querySelector('#course-list-container .retry-btn'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    check('the server is down: a message and a visible way to try again (no made-up courses)', /Could not load the courses/.test(msg) && /Try again/.test(msg) && retryVisible, msg);
    await o.ctx.close();
  }

  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nShape smoke test FAILED: ' + failed + ' check(s)' : '\nShape smoke test passed');
  process.exit(failed ? 1 : 0);
})();
