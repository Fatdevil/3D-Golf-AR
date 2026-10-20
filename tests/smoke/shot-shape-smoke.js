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
  LONGCOURSE: { share_code: 'LONGCOURSE', holes: Array.from({ length: 18 }, (_, i) => ({ par: i === 0 ? '<img src=x onerror="window.__xss=1">' : 4, tees: { yellow: { x: 0, y: 0, z: 3 } }, flag: { x: 0, y: 0, z: 0 } })) },
  // a course with a painted map (a 1 px png as a data URL)
  MAPCOURSE: { share_code: 'MAPCOURSE', terrain_biomemap: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', holes: [{ par: 3, tees: { yellow: { x: 0, y: 0, z: 3 } }, flag: { x: 0, y: 0, z: 0 } }] },
  // sloped ground (2 %): EASTSLOPE falls toward the east, NORTHSLOPE falls toward the north; the hole is far away, the ball starts at the origin
  EASTSLOPE: { share_code: 'EASTSLOPE', terrain_heightmap: JSON.stringify({ segs: 400, ground: Array.from({ length: 401 * 401 }, (_, i) => -0.02 * ((i % 401) * 1.5 - 300)) }), holes: [{ par: 4, tees: { yellow: { x: 0, y: 0, z: 0 } }, flag: { x: 0, y: 0, z: -80 } }] },
  NORTHSLOPE: { share_code: 'NORTHSLOPE', terrain_heightmap: JSON.stringify({ segs: 400, ground: Array.from({ length: 401 * 401 }, (_, i) => 0.02 * (Math.floor(i / 401) * 1.5 - 300)) }), holes: [{ par: 4, tees: { yellow: { x: 0, y: 0, z: 0 } }, flag: { x: 0, y: 0, z: -80 } }] },
  PUTTCOURSE: { share_code: 'PUTTCOURSE', holes: [{ par: 3, tees: { yellow: { x: 0, y: 0, z: 3 } }, flag: { x: 0, y: 0, z: 0 } }] }
};

// a collection of two plates (a 6 hole course): the mock holds them in the order they have now; a test can swap them
const COLLECTION = { id: 'COL1', name: 'Mixed <i id="xss2">six</i>', author: 'Kim', type: '6', total_par: 7, stroke_index: null,
  plates: [{ plate_code: 'PUTTCOURSE', plate_name: 'Putt' }, { plate_code: 'TESTCOURSE', plate_name: 'Test' }] };
const POSTED = [];
let RESULT_MODE = 'ok';
let RESULT_DELAY = 0;

function serve() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/api/courses') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([
        { share_code: 'TESTCOURSE', name: 'Test <b id="xss">Course</b>', author: 'Anna', hole_count: 2, total_par: 7 },
        { share_code: 'PUTTCOURSE', name: 'Putt Green', author: null, hole_count: 1, total_par: 3 }
      ])); }
      if (p === '/api/collections') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([COLLECTION])); }
      if (/^\/api\/collections\/col1$/i.test(p)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(COLLECTION)); }
      // the leaderboard: the test reads what was posted and picks the answer
      if (req.method === 'POST' && /^\/api\/courses\/[^/]+\/results$/.test(p)) {
        let body = ''; req.on('data', function (c) { body += c; });
        return req.on('end', function () {
          POSTED.push({ code: p.split('/')[3], body: JSON.parse(body || '{}'), user: req.headers['x-user-id'] || null });
          if (RESULT_MODE === 'fail') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"Server error"}'); }
          setTimeout(function () {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, position: 2, flagged: false, handicap: { previous: 18, new: 17.4, differential: 20 } }));
          }, RESULT_DELAY);
        });
      }
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
    // the lie under the ball and what it takes from the shot: TEE with nothing off on the first shot, and the physics' own figures after
    await page.waitForTimeout(400);
    const lieTee = await page.evaluate(function () { const c = document.getElementById('lie-chip'); return { shown: c.classList.contains('active'), name: document.getElementById('lie-name').textContent, fx: document.getElementById('lie-fx').textContent, vis: getComputedStyle(c).display !== 'none' }; });
    check('mobile: the lie box shows TEE with nothing off on the first shot of the hole', lieTee.shown && lieTee.vis && lieTee.name === 'TEE' && /100%/.test(lieTee.fx), JSON.stringify(lieTee));
    const lieSand = await page.evaluate(async function () {
      const p = window.GolfEngine.getActivePlayer(); p.strokes = 1;
      const was = window._terrainTypeAt; window._terrainTypeAt = function () { return 'SAND'; };
      await new Promise(function (r) { setTimeout(r, 300); });
      const out = { name: document.getElementById('lie-name').textContent, fx: document.getElementById('lie-fx').textContent, want: window.GolfPhysics.lieEffectText('SAND') };
      window._terrainTypeAt = was; p.strokes = 0;
      return out;
    });
    check('mobile: after the first shot, in sand, the box shows SAND and the physics\' own figures (' + lieSand.want.power + ' power, ' + lieSand.want.spin + ' spin)', lieSand.name === 'SAND' && lieSand.fx === 'Kraft ' + lieSand.want.power + ' · Spinn ' + lieSand.want.spin, JSON.stringify(lieSand));
    const teeFlag = await page.evaluate(function () {
      const seen = []; const orig = window.GolfPhysics.simulateFlight;
      window.GolfPhysics.simulateFlight = function (input, env) { seen.push(input.isTeeShot); return orig.call(this, input, env); };
      const p = window.GolfEngine.getActivePlayer(); const was = p.strokes;
      p.strokes = 0; window.triggerRealShot({ ballSpeedMph: 60, launchAngleDeg: 15, totalSpinRpm: 3000, spinAxisDeg: 0, azimDeg: 0, isLiveData: false });
      return new Promise(function (r) { setTimeout(function () { window.GolfPhysics.simulateFlight = orig; r(seen); }, 300); });
    });
    check('mobile: the first stroke of the hole goes to the physics as a tee shot (so the box saying TEE / 100% is true even on painted rough)', teeFlag.length >= 1 && teeFlag[0] === true, JSON.stringify(teeFlag));
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
    // the keyboard works on the desktop page as well: Space starts the swing, ',' picks the draw
    await page.evaluate(function () { const m = document.getElementById('hamburger-menu'); if (m && m.classList.contains('open')) toggleHamburgerMenu(); });   // an open menu owns the keys
    await page.keyboard.press(',');
    await page.keyboard.press('Space');
    const kb = await page.evaluate(function () { return { overlay: document.getElementById('swing-overlay').classList.contains('active'), shape: SwingEngine.getShotShape() }; });
    check('desktop: Space starts the swing and "," has picked the draw', kb.overlay === true && kb.shape === -1, JSON.stringify(kb));
    await page.evaluate(function () { const m = document.getElementById('hamburger-menu'); if (m && !m.classList.contains('open')) toggleHamburgerMenu(); });   // the menu is open again for the picker clicks below
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
  console.log('\nswing keys (desktop browser)');
  {
    const o = await open('/arcade.html?mode=range', { width: 1280, height: 720 }, { touch: false });
    const page = o.page;
    await page.evaluate(function () { localStorage.removeItem('golfos_input_mode'); });
    await page.evaluate(ENTER_TEST);
    await page.evaluate(function () { toggleHamburgerMenu(); });
    await page.click('#hb-input-mode .input-btn[data-input="SWING"]');
    await page.evaluate(function () { toggleHamburgerMenu(); });
    const overlay = function () { return page.evaluate(function () { return document.getElementById('swing-overlay').classList.contains('active'); }); };
    // behind a dialog the keys belong to the dialog
    await page.evaluate(function () { document.getElementById('scorecard-modal').style.display = 'flex'; });
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    const behind = await overlay();
    await page.evaluate(function () { document.getElementById('scorecard-modal').style.display = 'none'; });
    check('desktop: Space / Enter behind the scorecard dialog do not touch the swing', behind === false);
    // a held firing key does not skip the flight
    await page.evaluate(function () { window.__skips = 0; const f = window.skipFlight; window.skipFlight = function () { window.__skips++; return f.apply(this, arguments); }; });
    await page.click('#club-selector .club-btn[data-club="I7"]');   // the focus stays on the clicked club button
    await page.keyboard.press('Space');      // start
    check('desktop: Space starts the swing even when the last thing clicked was a club button (mouse focus is not keyboard focus)', await overlay() === true);
    await page.keyboard.press('Space');      // lock the power
    await page.keyboard.down('Space');       // lock the direction: the shot is fired
    await page.waitForFunction(function () { return window.isBallFlying(); }, null, { timeout: 5000 }).catch(function () {});
    const flying = await page.evaluate(function () { return window.isBallFlying(); });
    for (let i = 0; i < 12; i++) { await page.keyboard.down('Space'); await page.waitForTimeout(100); }   // the key stays down: repeats
    const skips = await page.evaluate(function () { return window.__skips; });
    await page.keyboard.up('Space');
    check('desktop: a shot fired with a held Space is in the air and the held key (and its repeats) does not skip the flight', flying === true && skips === 0, JSON.stringify({ flying: flying, skips: skips }));
    await page.evaluate(function () { window.skipFlight && window.skipFlight(); });
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  console.log('\nswing keys during the hole flyover');
  {
    const o = await open('/arcade.html?mode=range', { width: 1280, height: 720 }, { touch: false });
    const page = o.page;
    await page.evaluate(function () { localStorage.removeItem('golfos_input_mode'); });
    await page.evaluate(ENTER_TEST);
    await page.evaluate(function () { toggleHamburgerMenu(); });
    await page.click('#hb-input-mode .input-btn[data-input="SWING"]');
    await page.evaluate(function () { toggleHamburgerMenu(); });
    const overlayOn = function () { return page.evaluate(function () { return document.getElementById('swing-overlay').classList.contains('active'); }); };
    const menuOpen = function () { return page.evaluate(function () { return document.getElementById('hamburger-menu').classList.contains('open'); }); };
    // the menu is open: its buttons own the keys
    await page.evaluate(function () { toggleHamburgerMenu(); });
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    const withMenu = await overlayOn();
    await page.evaluate(function () { toggleHamburgerMenu(); });
    check('desktop: Space / Enter with the menu open do not touch the swing', withMenu === false);
    // a button the keyboard user has tabbed to keeps Space: it opens the menu, the swing stays idle
    await page.keyboard.press('Shift');
    await page.evaluate(function () { document.getElementById('hamburger-btn').focus(); });
    const focusVisible = await page.evaluate(function () { return document.getElementById('hamburger-btn').matches(':focus-visible'); });
    await page.keyboard.press('Space');
    const opened = await menuOpen();
    const swingOn = await overlayOn();
    check('desktop: Space on a keyboard-focused button activates that button (the menu opens) and does not start a swing', focusVisible === true && opened === true && swingOn === false, JSON.stringify({ focusVisible: focusVisible, opened: opened, swingOn: swingOn }));
    await page.evaluate(function () { toggleHamburgerMenu(); document.activeElement && document.activeElement.blur(); });
    await page.evaluate(function () { window.startFlyover(); });   // the cinematic (5 to 10 s of camera work)
    await page.waitForTimeout(600);
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    const st = await page.evaluate(function () { return { overlay: document.getElementById('swing-overlay').classList.contains('active'), hud: document.getElementById('flyover-hud').style.display, flying: window.isBallFlying() }; });
    check('desktop: Space / Enter during the hole flyover do not start, advance or fire the swing', st.hud === 'block' && st.overlay === false && st.flying === false, JSON.stringify(st));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

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
    RESULT_DELAY = 1500;   // the leaderboard answers slowly: Back to menu must wait for the answer
    await page.click('#popup-btn');
    await page.waitForTimeout(600);
    const whileSaving = await page.evaluate(function () { return { disabled: document.getElementById('popup-btn').disabled, status: document.getElementById('sc-status').textContent }; });
    const end = await page.evaluate(function () {
      const popup = document.getElementById('popup-result');
      return { title: popup.style.display === 'flex' ? document.getElementById('popup-title').innerText : null, rows: document.querySelectorAll('#popup-desc .sc-table tr').length, text: document.getElementById('popup-desc').innerText.replace(/\s+/g, ' '), btn: document.getElementById('popup-btn').innerText };
    });
    check('the round is complete: a scorecard with both holes and the total 8 (2 + 6), Back to menu', end.title === 'ROUND COMPLETE' && end.rows === 4 && /Total 8/.test(end.text) && end.btn === 'Back to menu', JSON.stringify(end));
    // the finished round is filed on the course's leaderboard: scores per hole, the mode the player used, and the answer is shown
    await page.waitForFunction(function () { return /Saved/.test(document.getElementById('sc-status').textContent); }, null, { timeout: 15000 }).catch(function () {});
    const lb = await page.evaluate(function () { return document.getElementById('sc-status').textContent; });
    const afterSaving = await page.evaluate(function () { return document.getElementById('popup-btn').disabled; });
    RESULT_DELAY = 0;
    check('Back to menu waits while the result is being saved, then works', whileSaving.disabled === true && /Saving/.test(whileSaving.status) && afterSaving === false, JSON.stringify({ whileSaving: whileSaving, afterSaving: afterSaving }));
    const sent = POSTED[POSTED.length - 1];
    check('the round is submitted once to the course leaderboard (scores 2 and 6, total 8, +1, swing meter) and the position and handicap are shown',
      POSTED.length === 1 && sent.code === 'TESTCOURSE' && JSON.stringify(sent.body.hole_scores) === '[2,6]' && sent.body.total_score === 8 && sent.body.score_vs_par === 1 && sent.body.input_mode === 'SWING_METER' && /Saved/.test(lb) && /#2/.test(lb) && /17\.4/.test(lb),
      JSON.stringify({ n: POSTED.length, sent: sent, lb: lb }));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // a leaderboard that cannot be reached: a message and a way to try again; typed numbers and a draft course are not filed
  {
    const play = async function (code, setup) {
      const o = await open('/arcade_mobile.html?course=' + code, { width: 390, height: 844 });
      if (setup) await o.page.evaluate(setup);
      // the only hole is finished with a gimme from the green
      await o.page.evaluate(function () { window._terrainTypeAt = function () { return 'GREEN'; }; window.GolfEngine.getActivePlayer().strokes = 1; });
      await o.page.evaluate(function () { window.dispatchEvent(new CustomEvent('GolfEvent_RoundCompleted', { detail: { scorecard: GolfEngine.scorecard(Object.assign(GolfEngine.getActivePlayer(), { scores: [3], totalScore: 3 })) } })); });
      await o.page.waitForTimeout(800);
      return o;
    };
    POSTED.length = 0; RESULT_MODE = 'fail';
    let o = await play('PUTTCOURSE');
    let st = await o.page.evaluate(function () { const el = document.getElementById('sc-status'); return { text: el.textContent, retry: !!el.querySelector('button') }; });
    check('the leaderboard is unreachable: a message and Try again (no silent loss)', /Could not save/.test(st.text) && st.retry && POSTED.length === 1, JSON.stringify({ st: st, n: POSTED.length }));
    RESULT_MODE = 'ok';
    await o.page.click('#sc-status button');
    await o.page.waitForTimeout(800);
    st = await o.page.evaluate(function () { return document.getElementById('sc-status').textContent; });
    check('Try again files the round, named by the same round id as the first try (the server can tell a retry from a new round)',
      /Saved/.test(st) && POSTED.length === 2 && POSTED[1].body.input_mode === 'SWING_METER' && /^[A-Za-z0-9_-]{8,64}$/.test(POSTED[0].body.stats.round_id) && POSTED[0].body.stats.round_id === POSTED[1].body.stats.round_id, JSON.stringify({ st: st, n: POSTED.length, ids: POSTED.map(function (x) { return x.body.stats; }) }));
    await o.ctx.close();

    POSTED.length = 0;
    o = await play('PUTTCOURSE', function () { SwingEngine.setInputMode('NUMBERS'); });
    st = await o.page.evaluate(function () { return document.getElementById('sc-status').textContent; });
    check('a round with typed numbers is not filed', POSTED.length === 0 && /typed numbers/.test(st), JSON.stringify({ st: st, n: POSTED.length }));
    await o.ctx.close();

    o = await play('PUTTCOURSE', function () { SwingEngine.setInputMode('LM'); });
    check('a launch monitor round is filed as LAUNCH_MONITOR', POSTED.length === 1 && POSTED[0].body.input_mode === 'LAUNCH_MONITOR', JSON.stringify(POSTED));
    await o.ctx.close();
  }

  // a collection on the phone: plate 1 is filed as a plate of the collection and the next plate opens; the last plate is filed with the same token
  {
    POSTED.length = 0;
    const o = await open('/arcade_mobile.html?course=PUTTCOURSE&collection=col1&plate=0', { width: 390, height: 844 }, { init: function () {
      if (!localStorage.getItem('golf_os_mobile_match')) localStorage.setItem('golf_os_mobile_match', JSON.stringify({ settings: { gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 }, players: [{ name: 'Sam', color: '#ef4444' }, { name: 'Sam', color: '#3b82f6' }] }));   // two players with the same name
    } });
    const page = o.page;
    const head0 = await page.evaluate(function () { return { hole: document.getElementById('ui-hole').innerText, stored: sessionStorage.getItem('collection_plates_COL1') }; });
    check('collection plate 1: the header counts the holes of the whole course (Hole 1/6) and the plate order is kept for the round (under the collection\'s own id)', head0.hole === 'Hole 1/6' && JSON.parse(head0.stored).map(function (x) { return x.plate_code; }).join() === 'PUTTCOURSE,TESTCOURSE', JSON.stringify(head0));
    COLLECTION.plates = [COLLECTION.plates[1], COLLECTION.plates[0]];   // the collection is edited meanwhile: the round goes on in the order it started with
    const finish = function (scores) {
      return page.evaluate(function (sc) {
        const pls = window.GolfEngine.getState().players;
        // sc: one list of hole scores for everybody (+1 for each seat after the first) or one list per player
        pls.forEach(function (pl, i) { const mine = Array.isArray(sc[0]) ? sc[i] : sc.map(function (v) { return v + i; }); pl.strokes = 1; pl.scores = mine; pl.totalScore = mine.reduce(function (a, b) { return a + b; }, 0); });
        window.dispatchEvent(new CustomEvent('GolfEvent_RoundCompleted', { detail: { scorecard: GolfEngine.scorecard(pls[0]), scorecards: pls.map(function (pl) { return Object.assign({ player: pl }, GolfEngine.scorecard(pl)); }) } }));
      }, scores);
    };
    await finish([[5], [2]]);   // Sam (seat 1) 5, Sam (seat 2) 2
    await page.waitForURL(/plate=1/, { timeout: 15000 }).catch(function () {});
    const url1 = page.url();
    const p0 = POSTED[0] || { body: { stats: {} } };
    check('plate 1 is filed as a plate of the collection (collection id, plate 0, seat 0) and the next page is plate 2 of the order the round started with (TESTCOURSE, not the swapped order)',
      POSTED.length === 1 && POSTED[0].code === 'PUTTCOURSE' && p0.body.stats.collection_id === 'COL1' && p0.body.stats.plate_index === 0 && p0.body.stats.player_slot === 0 && /-p0-0$/.test(p0.body.stats.round_id) && /course=TESTCOURSE&collection=COL1&plate=1/.test(url1),
      JSON.stringify({ n: POSTED.length, stats: p0.body.stats, url: url1 }));
    await page.waitForTimeout(6000);
    const head1 = await page.evaluate(function () { return { hole: document.getElementById('ui-hole').innerText, names: window.GolfEngine.getState().players.map(function (x) { return x.name; }), scores: sessionStorage.getItem('collection_scores_COL1') }; });
    check('plate 2: the header goes on from hole 4 (Hole 4/6) with the same players, and the first plate\'s scores were kept', head1.hole === 'Hole 4/6' && head1.names.join() === 'Sam,Sam' && JSON.parse(head1.scores)[0].plateScores.length === 2, JSON.stringify(head1));
    await finish([[2, 2], [3, 3]]);   // seat 1: 5 + 4 = 9, seat 2: 2 + 6 = 8: seat 2 wins the course although it lost the last plate
    await page.waitForFunction(function () { return /Saved/.test((document.getElementById('sc-status') || {}).textContent || ''); }, null, { timeout: 15000 }).catch(function () {});
    const card = await page.evaluate(function () { return { text: document.getElementById('popup-desc').innerText.replace(/\s+/g, ' '), holes: Array.from(document.querySelectorAll('#popup-desc .sc-table tr')).map(function (r) { return r.cells[0].innerText; }).join(), allRow: Array.from(document.querySelectorAll('#popup-desc .sc-table tr.sc-total:last-child td')).map(function (c) { return c.innerText; }).join(), left: ['collection_scores_COL1', 'collection_round_COL1', 'collection_roster_COL1', 'collection_plates_COL1'].filter(function (k) { return sessionStorage.getItem(k) !== null; }) }; });
    const p1 = POSTED[1] || { body: { stats: {} } };
    check('the last plate is filed with the same round token as plate 1 (plate 1, seat 0), the card numbers the holes 4 and 5 and adds up the whole round, and the round\'s state is cleared',
      POSTED.length === 2 && POSTED[1].code === 'TESTCOURSE' && p1.body.stats.plate_index === 1 && p1.body.stats.collection_round_id === p0.body.stats.collection_round_id && /-p1-0$/.test(p1.body.stats.round_id) && card.holes === 'Hole,4,5,Total,All 5' && card.allRow === 'All 5,,9,8' && /Sam wins with 8/.test(card.text) && card.left.length === 0,
      JSON.stringify({ n: POSTED.length, stats: p1.body.stats, card: card }));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
    COLLECTION.plates = [COLLECTION.plates[1], COLLECTION.plates[0]];
  }

  // two players on one phone: the farthest from the flag plays, the honour on the next tee, one scorecard for both, only player 1 on the board
  {
    const o = await open('/arcade_mobile.html?course=TESTCOURSE', { width: 390, height: 844 }, { init: function () {
      localStorage.setItem('golf_os_mobile_match', JSON.stringify({ settings: { gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 }, players: [{ name: 'Anna', color: '#ef4444' }, { name: 'Bo <b>x</b>', color: '#3b82f6' }] }));
    } });
    const page = o.page;
    POSTED.length = 0;
    await page.evaluate(function () {
      const sim = GolfPhysics.simulateFlight;
      GolfPhysics.simulateFlight = function (inp, env) {
        if (!window.__fake) return sim.call(this, inp, env);
        const f = window.__fake; window.__fake = null;
        const sx = inp.startPos[0], sy = inp.startPos[1], N = 12, path = [];
        for (let i = 0; i <= N; i++) path.push({ x: sx + (f.x - sx) * i / N, y: sy + (-f.z - sy) * i / N, z: i === 0 || i === N ? 0 : 3, phase: i === N ? 'roll' : (i < 4 ? 'flight' : 'bounce'), time: i * 0.1 });
        return { path: path, metrics: { holed: !!f.holed, finalTerrainType: f.terrain || 'FAIRWAY', totalMeters: 10, carryMeters: 8 } };
      };
      window._terrainTypeAt = function () { return 'FAIRWAY'; };
    });
    const hit = async function (fake) {
      await page.evaluate(function (f) { window.__fake = f; window.triggerRealShot({ ballSpeedMph: 80, launchAngleDeg: 20, totalSpinRpm: 5000, spinAxisDeg: 0, azimDeg: 0, isLiveData: false }); }, fake);
      await page.waitForFunction(function () { return !window.isBallFlying(); }, null, { timeout: 30000 });
      await page.waitForTimeout(250);
    };
    const who = function () {
      return page.evaluate(function () {
        const a = GolfEngine.getActivePlayer(), c = window.__ctl, look = [c.target.x - c.object.position.x, c.target.z - c.object.position.z], h = courseHoles[playingHoleIndex];
        const toHole = [h.flag.x - ballMesh.position.x, h.flag.z - ballMesh.position.z];
        return { name: document.getElementById('ui-player-name').textContent, active: a.name, ball: [+ballMesh.position.x.toFixed(1), +ballMesh.position.z.toFixed(1)], toast: document.getElementById('turn-toast').textContent,
                 shown: window.playerMarkers.map(function (m) { return m.visible ? [+m.position.x.toFixed(1), +m.position.z.toFixed(1)] : null; }),
                 aimed: Math.abs(Math.atan2(look[0], -look[1]) - Math.atan2(toHole[0], -toHole[1])) < 0.01, popup: document.getElementById('popup-result').style.display === 'flex' ? document.getElementById('popup-title').innerText : null, btn: document.getElementById('popup-btn').innerText };
      });
    };
    let w = await who();
    check('two players: Anna tees off first (the name in the header and the banner)', w.active === 'Anna' && w.name === 'Anna' && /Anna tees off/.test(w.toast), JSON.stringify(w));
    await hit({ x: 10, z: 40 });
    w = await who();
    check('Anna hit to (10, 40): Bo is on the tee and plays next, the camera behind his ball, Anna\'s ball waits as a marker', w.active === 'Bo <b>x</b>' && w.name === 'Bo <b>x</b>' && Math.abs(w.ball[0]) < 0.5 && Math.abs(w.ball[1] - 150) < 0.5 && w.shown[0] && Math.abs(w.shown[0][0] - 10) < 0.5 && w.shown[1] === null && w.aimed && /Bo <b>x<\/b> tees off/.test(w.toast), JSON.stringify(w));
    await hit({ x: 90, z: -90 });
    w = await who();
    check('Bo hit close (14 m): Anna is farther from the flag and plays, from where she lies', w.active === 'Anna' && Math.abs(w.ball[0] - 10) < 0.5 && Math.abs(w.ball[1] - 40) < 0.5 && w.shown[1] && Math.abs(w.shown[1][0] - 90) < 0.5, JSON.stringify(w));
    await hit({ x: 60, z: -60 });
    w = await who();
    check('Anna hit to 57 m: she is still farther than Bo (14 m) and plays again', w.active === 'Anna' && Math.abs(w.ball[0] - 60) < 0.5, JSON.stringify(w));
    await hit({ x: 95, z: -95 });
    w = await who();
    check('Anna hit to 7 m: now Bo is farther and plays', w.active === 'Bo <b>x</b>' && Math.abs(w.ball[0] - 90) < 0.5, JSON.stringify(w));
    await hit({ x: 100, z: -100, holed: true, terrain: 'GREEN' });
    w = await who();
    check('Bo holed out (2 strokes): a popup for Bo with Next player', /Bo <b>x<\/b>/.test(await page.evaluate(function () { return document.getElementById('popup-desc').textContent; })) && w.btn === 'Next player', JSON.stringify(w));
    await page.click('#popup-btn');
    await page.waitForTimeout(500);
    w = await who();
    check('Next player: Anna, the only one left on the hole, plays from 7 m', w.active === 'Anna' && Math.abs(w.ball[0] - 95) < 0.5 && w.popup === null, JSON.stringify(w));
    await hit({ x: 100, z: -100, holed: true, terrain: 'GREEN' });
    w = await who();
    check('Anna holed out (4 strokes): everyone is done, the popup offers Next hole', w.btn === 'Next hole', JSON.stringify(w));
    await page.click('#popup-btn');
    await page.waitForTimeout(600);
    w = await who();
    check('hole 2: the honour goes to Bo (2 against 4): he tees off, both players are on the tee', w.active === 'Bo <b>x</b>' && /tees off/.test(w.toast) && Math.abs(w.ball[0] - 50) < 0.5 && Math.abs(w.ball[1] - 100) < 0.5, JSON.stringify(w));
    await hit({ x: 50, z: 60, holed: true, terrain: 'GREEN' });
    await page.click('#popup-btn');
    await page.waitForTimeout(500);
    await hit({ x: 50, z: 60, holed: true, terrain: 'GREEN' });
    w = await who();
    check('both holed out on the last hole (1 stroke each): Finish round', w.btn === 'Finish round', JSON.stringify(w));
    await page.click('#popup-btn');
    await page.waitForTimeout(1500);
    const fin = await page.evaluate(function () {
      const d = document.getElementById('popup-desc');
      return { title: document.getElementById('popup-title').innerText, text: d.textContent.replace(/\s+/g, ' '), heads: Array.prototype.map.call(d.querySelectorAll('th'), function (t) { return t.textContent; }), bold: d.querySelectorAll('b').length, rows: d.querySelectorAll('tr').length, totals: Array.prototype.map.call(d.querySelectorAll('tr.sc-total td'), function (t) { return t.textContent; }).join(',') };
    });
    check('round complete: one scorecard with both players (Anna 5, Bo 3), the name shown as text, the winner named',
      fin.title === 'ROUND COMPLETE' && fin.heads.join('|') === 'Hole|Par|Anna|Bo <b>x</b>' && fin.bold === 0 && fin.rows === 4 && fin.totals === 'Total,7,5,3' && /Bo <b>x<\/b> wins with 3 \(-4\)/.test(fin.text), JSON.stringify(fin));
    check('only player 1 (the owner of the phone) is filed on the leaderboard: Anna, 4 + 1 = 5', POSTED.length === 1 && POSTED[0].body.total_score === 5 && JSON.stringify(POSTED[0].body.hole_scores) === '[4,1]', JSON.stringify(POSTED));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // four players with long names: the scorecard fits the screen or scrolls sideways, so every column can be read
  {
    const o = await open('/arcade_mobile.html?course=TESTCOURSE', { width: 360, height: 640 }, { init: function () {
      localStorage.setItem('golf_os_mobile_match', JSON.stringify({ settings: { gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 }, players: ['Alexandra Svensson', 'Bartholomew Jones', 'Christopher Lund', 'Dorothea Nilsson'].map(function (n, i) { return { name: n, color: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'][i] }; }) }));
    } });
    const page = o.page;
    await page.click('.player-info');
    await page.waitForTimeout(500);
    const sc = await page.evaluate(function () {
      const box = document.querySelector('#popup-desc .sc-scroll'), table = box.querySelector('table');
      box.scrollLeft = 10000;
      const cells = table.querySelectorAll('tr:first-child th'), last = cells[cells.length - 1].getBoundingClientRect();
      return { cols: cells.length, overflowX: getComputedStyle(box).overflowX, scrolls: box.scrollWidth > box.clientWidth, lastRight: Math.round(last.right), boxRight: Math.round(box.getBoundingClientRect().right), view: innerWidth,
               names: Array.prototype.map.call(cells, function (c) { return c.getAttribute('title'); }).filter(Boolean).length };
    });
    check('four players with 16-character names on a 360 px screen: the last column can be reached (the card scrolls sideways when it is wider than the screen) and each name is kept as a tooltip',
      sc.cols === 6 && /auto|scroll/.test(sc.overflowX) && sc.lastRight <= sc.boxRight + 1 && sc.boxRight <= sc.view && sc.names === 4, JSON.stringify(sc));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // the keyboard: Space / Enter swing, arrow up / down change the club, , / . pick the shape (a tablet with a keyboard, or a desktop)
  {
    const o = await open('/arcade_mobile.html?course=TESTCOURSE', { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () {
      const sim = GolfPhysics.simulateFlight;
      GolfPhysics.simulateFlight = function (inp, env) {
        if (!window.__fake) return sim.call(this, inp, env);
        const f = window.__fake; window.__fake = null;
        const sx = inp.startPos[0], sy = inp.startPos[1], N = 12, path = [];
        for (let i = 0; i <= N; i++) path.push({ x: sx + (f.x - sx) * i / N, y: sy + (-f.z - sy) * i / N, z: i === 0 || i === N ? 0 : 3, phase: i === N ? 'roll' : (i < 4 ? 'flight' : 'bounce'), time: i * 0.1 });
        return { path: path, metrics: { holed: false, finalTerrainType: 'FAIRWAY', totalMeters: 10, carryMeters: 8 } };
      };
      window.__fake = { x: 10, z: 40 };
    });
    const ui = function () { return page.evaluate(function () { return { club: SwingEngine.getClub(), shape: SwingEngine.getShotShape(), overlay: document.getElementById('swing-overlay').classList.contains('active'), strokes: GolfEngine.getActivePlayer().strokes }; }); };
    await page.evaluate(function () { SwingEngine.selectClub('I7'); SwingEngine.setShotShape(0); });
    await page.keyboard.press('ArrowUp');
    let k = await ui();
    check('Arrow up: a longer club (7 iron to 5 iron)', k.club === 'I5', JSON.stringify(k));
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    k = await ui();
    check('Arrow down three times from the 5 iron: 7 iron, 9 iron, pitching wedge', k.club === 'PW', JSON.stringify(k));
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
    k = await ui();
    check('Arrow up stops at the driver, and does not wrap around', k.club === 'DRIVER', JSON.stringify(k));
    await page.keyboard.press(',');
    const draw = (await ui()).shape;
    await page.keyboard.press('.');
    const fade = (await ui()).shape;
    await page.keyboard.press('/');
    const straight = (await ui()).shape;
    check('"," draw, "." fade, "/" straight', draw === -1 && fade === 1 && straight === 0, JSON.stringify({ draw: draw, fade: fade, straight: straight }));
    await page.keyboard.press('Space');
    k = await ui();
    check('Space starts the swing (the meter is up)', k.overlay === true, JSON.stringify(k));
    await page.keyboard.press('ArrowDown');
    k = await ui();
    check('the club does not change in the middle of a swing', k.club === 'DRIVER', JSON.stringify(k));
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return GolfEngine.getActivePlayer().strokes === 1; }, null, { timeout: 15000 }).catch(function () {});
    k = await ui();
    check('Space, Space and Enter swing the whole shot: one stroke is counted', k.strokes === 1, JSON.stringify(k));
    await page.waitForFunction(function () { return !window.isBallFlying(); }, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    // under a popup the keys do nothing
    await page.evaluate(function () { window.GolfEngine.getActivePlayer().strokes = 0; window.showScorecard(); });
    await page.keyboard.press('Space');
    k = await ui();
    check('under a popup Space does not start a swing', k.overlay === false, JSON.stringify(k));
    await page.evaluate(function () { closePopup(); });
    // a text field keeps its keys
    await page.evaluate(function () { const i = document.createElement('input'); i.id = 'kb-test'; document.body.appendChild(i); i.focus(); });
    await page.waitForTimeout(400);
    await page.keyboard.press('Space');
    k = await ui();
    check('typing in a text field does not swing', k.overlay === false, JSON.stringify(k));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // one ground for both pages: a course made in arcade.html (a terrain 600 m wide) must read the same under the same point on the mobile page.
  // The course has a 5 m plateau and a green patch around the flag at (100, -100); a point the same distance from the middle on the other side
  // is flat fairway. Both pages are asked what lies at the flag and at the points a 600 m and a 900 m terrain would disagree about.
  console.log('\nterrain size (arcade.html and arcade_mobile.html read the same ground)');
  {
    const maker = await browser.newPage();
    const png = await maker.evaluate(function () {
      const c = document.createElement('canvas'); c.width = 4096; c.height = 4096;
      const g = c.getContext('2d');
      g.fillStyle = '#79b84f'; g.fillRect(0, 0, 4096, 4096);                  // fairway
      const px = function (w) { return (w + 300) / 600 * 4096; };             // world metres on a 600 m terrain to map pixels
      g.fillStyle = '#8acf72'; g.fillRect(px(90), px(-110), px(110) - px(90), px(-90) - px(-110));   // green: x 90..110, z -110..-90
      g.fillStyle = '#e0d8a4'; g.fillRect(px(-60), px(40), px(-40) - px(-60), px(60) - px(40));        // sand: x -60..-40, z 40..60
      return c.toDataURL('image/png');
    });
    await maker.close();
    const SEGS = 600, ground = new Array((SEGS + 1) * (SEGS + 1));
    for (let gz = 0; gz <= SEGS; gz++) for (let gx = 0; gx <= SEGS; gx++) {
      const x = gx - 300, z = gz - 300;
      ground[gz * (SEGS + 1) + gx] = (x >= 80 && x <= 120 && z >= -120 && z <= -80) ? 5 : 0;      // a 5 m plateau around the flag
    }
    COURSES.SIZECOURSE = { share_code: 'SIZECOURSE', terrain_heightmap: JSON.stringify({ ground: ground, segs: SEGS }), terrain_biomemap: png,
      holes: [{ par: 4, tees: { yellow: { x: 0, y: 0, z: 150 } }, flag: { x: 100, y: 5, z: -100 } }] };
    // points as the physics asks for them: (x, y) with y = -z
    const pts = { flag: [100, 100], sandPatch: [-50, -50], plateauEdge: [85, 100], farFairway: [-100, -100] };
    const A = await open('/arcade.html?course=SIZECOURSE', { width: 1280, height: 720 }, { touch: false });
    await A.page.waitForFunction(function () { return !!window.terrainBiomeData && typeof window.localGetTerrainAt === 'function'; }, null, { timeout: 60000 }).catch(function () {});
    await A.page.waitForTimeout(3000);
    const ar = await A.page.evaluate(function (pts) { const o = {}; for (const k in pts) { const t = window.localGetTerrainAt(pts[k][0], pts[k][1]); o[k] = { type: t.type, z: +t.z.toFixed(2) }; } return o; }, pts);
    await A.ctx.close();
    const M = await open('/arcade_mobile.html?course=SIZECOURSE', { width: 390, height: 844 });
    await M.page.waitForFunction(function () { return !!window.biomeDataCache; }, null, { timeout: 60000 }).catch(function () {});
    const mo = await M.page.evaluate(function (pts) { const o = {}; for (const k in pts) { o[k] = { type: window._terrainTypeAt(pts[k][0], pts[k][1]), z: +window.getTerrainHeight(pts[k][0], -pts[k][1]).toFixed(2) }; } return o; }, pts);
    await M.ctx.close();
    // a course that names its own size (terrain_heightmap.size) is followed: the same green, painted for a 900 m terrain
    const maker2 = await browser.newPage();
    const png900 = await maker2.evaluate(function () {
      const c = document.createElement('canvas'); c.width = 4096; c.height = 4096;
      const g = c.getContext('2d');
      g.fillStyle = '#79b84f'; g.fillRect(0, 0, 4096, 4096);
      const px = function (w) { return (w + 450) / 900 * 4096; };
      g.fillStyle = '#8acf72'; g.fillRect(px(90), px(-110), px(110) - px(90), px(-90) - px(-110));
      return c.toDataURL('image/png');
    });
    await maker2.close();
    COURSES.SIZE900 = { share_code: 'SIZE900', terrain_heightmap: JSON.stringify({ ground: new Array(401 * 401).fill(0), segs: 400, size: 900 }), terrain_biomemap: png900,
      holes: [{ par: 4, tees: { yellow: { x: 0, y: 0, z: 150 } }, flag: { x: 100, y: 0, z: -100 } }] };
    const M9 = await open('/arcade_mobile.html?course=SIZE900', { width: 390, height: 844 });
    await M9.page.waitForFunction(function () { return !!window.biomeDataCache; }, null, { timeout: 60000 }).catch(function () {});
    const at900 = await M9.page.evaluate(function () { return { flag: window._terrainTypeAt(100, 100), off: window._terrainTypeAt(70, 100) }; });
    await M9.ctx.close();
    check('a course that says its terrain is 900 m wide is read as 900 m (green at the flag, fairway 30 m to the side)', at900.flag === 'GREEN' && at900.off === 'FAIRWAY', JSON.stringify(at900));
    check('arcade.html reads the test course as built: green and 5 m plateau at the flag, sand in the sand patch', ar.flag.type === 'GREEN' && ar.flag.z === 5 && ar.sandPatch.type === 'SAND' && ar.farFairway.z === 0, JSON.stringify(ar));
    check('the mobile page reads the same type and height at every point (same terrain size)', JSON.stringify(ar) === JSON.stringify(mo), JSON.stringify({ arcade: ar, mobile: mo }));
  }

  // the ground's tilt reaches the physics: a putt across a slope breaks downhill (east slope: a putt north breaks east; north slope: a putt east breaks north)
  for (const sl of [{ code: 'EASTSLOPE', az: 0, axis: 'x', label: 'east' }, { code: 'NORTHSLOPE', az: 90, axis: 'y', label: 'north' }]) {
    const o = await open('/arcade_mobile.html?course=' + sl.code, { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () { window._terrainTypeAt = function () { return 'GREEN'; }; });
    const n = await page.evaluate(function () { return window._terrainNormalAt(0, 0); });
    await page.evaluate(function (az) { window.triggerRealShot({ ballSpeedMph: 3, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: az, isLiveData: false }); }, sl.az);
    await page.waitForFunction(function () { return !window.isBallFlying(); }, null, { timeout: 150000 });
    const end = await page.evaluate(function () { return { x: ballMesh.position.x, y: -ballMesh.position.z }; });
    const along = sl.axis === 'x' ? end.y : end.x, across = end[sl.axis];
    check('slope ' + sl.label + ': the normal tilts ' + sl.label + ', the putt travels and breaks ' + sl.label,
      (sl.axis === 'x' ? n[0] > 0.015 && Math.abs(n[1]) < 0.005 : n[1] > 0.015 && Math.abs(n[0]) < 0.005) && along > 1 && across > 0.1, JSON.stringify({ n: n, end: end }));
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  // a shot taken before the painted map is decoded waits for it (the rules read the surface while the shot is resolved)
  {
    // the map image is held back for 8 s
    const o = await open('/arcade_mobile.html?course=MAPCOURSE', { width: 390, height: 844 }, { init: function () {
      const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get: d.get, set: function (v) { const me = this; if (String(v).indexOf('data:image/png') === 0) setTimeout(function () { d.set.call(me, v); }, 8000); else d.set.call(me, v); } });
    } });
    const page = o.page;
    const shot = function () { window.triggerRealShot({ ballSpeedMph: 4.5, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0, azimDeg: 0, isLiveData: false }); };
    await page.evaluate(shot);
    const early = await page.evaluate(function () { return { strokes: GolfEngine.getActivePlayer().strokes, pending: !!window._biomePending, flying: window.isBallFlying() }; });
    await page.waitForFunction(function () { return GolfEngine.getActivePlayer().strokes === 1; }, null, { timeout: 30000 });
    const late = await page.evaluate(function () { return { strokes: GolfEngine.getActivePlayer().strokes, pending: !!window._biomePending, cache: !!window.biomeDataCache }; });
    check('a shot before the painted map is ready waits for it, then goes', early.pending && early.strokes === 0 && !early.flying && late.strokes === 1 && !late.pending && late.cache, JSON.stringify({ early: early, late: late }));
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
    {
      // an 18 hole course whose first par is markup: no markup runs, and the card scrolls inside a short viewport
      const l = await open('/arcade_mobile.html?course=LONGCOURSE', { width: 844, height: 390 });
      await l.page.click('.player-info');
      await l.page.waitForTimeout(400);
      const lc = await l.page.evaluate(function () {
        const sc = document.querySelector('#popup-desc .sc-scroll'), btn = document.getElementById('popup-btn').getBoundingClientRect();
        return { xss: window.__xss === 1, imgs: document.querySelectorAll('#popup-desc img').length, par0: courseHoles[0].par, scrolls: sc.scrollHeight > sc.clientHeight, btnVisible: btn.bottom <= innerHeight && btn.top >= 0 };
      });
      check('scorecard: author markup in par does not run, the 18 hole card scrolls and the button stays on screen', !lc.xss && lc.imgs === 0 && lc.par0 === 4 && lc.scrolls && lc.btnVisible, JSON.stringify(lc));
      await l.ctx.close();
    }
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
        const T = window.TERRAIN_SIZE, y = -10, ix = Math.floor((x + T / 2) / T * 4096), iy = Math.floor((-y + T / 2) / T * 4096), i = (iy * 4096 + ix) * 4, c = hex(color);
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
    check('the course list comes from the server (GET /api/courses), not from a made-up list (and the collection after the courses)', list.names.length === 3 && list.names[1] === 'Putt Green' && !list.mock, JSON.stringify(list.names));
    check('a course name with HTML in it is shown as text, not run', list.names[0] === 'Test <b id="xss">Course</b>' && !list.injected, JSON.stringify(list.names[0]));
    check('a card shows holes, par and the author', /2 Holes/.test(list.meta) && /Par 7/.test(list.meta) && /Anna/.test(list.meta), list.meta);
    const nextDisabled = await page.evaluate(function () { return document.getElementById('main-action-btn').disabled; });
    await page.click('.course-card:nth-child(2)');
    const picked = await page.evaluate(function () { return { code: matchState.courseCode, selected: document.querySelectorAll('.course-card.selected').length, disabled: document.getElementById('main-action-btn').disabled }; });
    check('picking a course selects it by its share code and enables Continue', nextDisabled === true && picked.code === 'PUTTCOURSE' && picked.selected === 1 && picked.disabled === false, JSON.stringify(picked));
    // the collection card: text, plates, and Continue opens the first plate with the collection in the link
    const colCard = await page.evaluate(function () { const c = Array.from(document.querySelectorAll('.course-card'))[2]; return { text: c.innerText.replace(/\s+/g, ' '), injected: !!document.getElementById('xss2') }; });
    check('a collection is listed after the courses: name as text, holes and plates', /Mixed <i id="xss2">six<\/i>/.test(colCard.text) && /6 Holes/.test(colCard.text) && /2 plates/.test(colCard.text) && !colCard.injected, JSON.stringify(colCard));
    await page.click('.course-card:nth-child(3)');
    const pickedCol = await page.evaluate(function () { return { code: matchState.courseCode, col: matchState.collectionId, selected: document.querySelectorAll('.course-card.selected').length }; });
    check('picking a collection selects its first plate and the collection (only that card is highlighted)', pickedCol.code === 'PUTTCOURSE' && pickedCol.col === 'COL1' && pickedCol.selected === 1, JSON.stringify(pickedCol));
    await page.click('.course-card:nth-child(1)');
    const backToCourse = await page.evaluate(function () { return { code: matchState.courseCode, col: matchState.collectionId }; });
    check('picking a course again drops the collection', backToCourse.code === 'TESTCOURSE' && backToCourse.col === null, JSON.stringify(backToCourse));
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

  // the match setup: one to four players with their own names, saved for the game
  {
    const o = await open('/arcade_mobile_hub.html', { width: 390, height: 844 });
    const page = o.page;
    await page.evaluate(function () { navTo('view-settings'); });
    check('one player to begin with: one name field (Player 1, You), no pass-the-phone note', await page.evaluate(function () { return document.querySelectorAll('#players-list input').length === 1 && document.querySelector('#players-list input').value === 'Player 1' && document.getElementById('players-note').style.display === 'none'; }));
    await page.click('#players-ctrl [data-count="3"]');
    await page.fill('#players-list .setting-row:nth-child(2) input', 'Bo');
    await page.fill('#players-list .setting-row:nth-child(1) input', '   ');
    const m = await page.evaluate(function () { return { inputs: document.querySelectorAll('#players-list input').length, note: document.getElementById('players-note').style.display, active: document.querySelector('#players-ctrl .active').dataset.count, players: matchState.players.map(function (p) { return p.name + p.color; }), tags: Array.prototype.map.call(document.querySelectorAll('#players-list .setting-row span'), function (x) { return x.textContent; }).join() }; });
    check('three players: three fields with distinct colours, names kept (blank becomes Player 1), Player 1 is You and the others Guests, the note is shown',
      m.inputs === 3 && m.note === 'block' && m.active === '3' && m.players.join() === 'Player 1#ef4444,Bo#3b82f6,Player 3#10b981' && m.tags === 'You,Guest,Guest', JSON.stringify(m));
    await page.click('#players-ctrl [data-count="2"]');
    const kept = await page.evaluate(function () { return matchState.players.map(function (p) { return p.name; }).join(); });
    check('going down to two players keeps the names that are left', kept === 'Player 1,Bo', kept);
    await page.evaluate(function () { matchState.courseCode = 'TESTCOURSE'; });
    await page.evaluate(function () { setTimeout = function () {}; launchGame(); });
    const saved = await page.evaluate(function () { return JSON.parse(localStorage.getItem('golf_os_mobile_match')).players.map(function (p) { return p.name; }).join(); });
    check('Tee Off saves the players for the game page', saved === 'Player 1,Bo', saved);
    check('no page errors', o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  }

  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nShape smoke test FAILED: ' + failed + ' check(s)' : '\nShape smoke test passed');
  process.exit(failed ? 1 : 0);
})();
