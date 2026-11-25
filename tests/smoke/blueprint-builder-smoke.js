// Browser smoke test for the blueprint map in the ordinary course builder (arcade.html?autorun=new_build, as build.html opens it).
// The main smoke test runs the builder in range mode (mode=range), where the 3D scene is light: in the course builder the scene
// behind the map used to take the time the spot search needs, every hole stayed red ("no free spot") and nothing could be built.
//   npm --prefix tests install && npm --prefix tests run setup    (once; or set CHROMIUM_PATH)
//   npm run smoke:builder
// Checks: the course builder (no range tee), the 3D scene pauses while the map is open, three holes get good spots in time with a
// par mix (4, 3, 5) and short walks between them, the scorecard shows par and metres per hole at full height, every hole is built
// (the par 3 with its approach strip) with the mowing pattern picked on the map, and the scene runs again after the map closes. Set SHOTS=<dir> to also save screenshots.
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
    const card = S.dom.card, rows = card.querySelectorAll('tr');
    const cellsOf = function (r) { return Array.prototype.map.call(rows[r].children, function (c) { return c.textContent.trim(); }); };
    return {
      paused: paused, framesWhileOpen: framesWhileOpen, times: times,
      ok: S.sketches.map(function (s) { return !!(s.ev && s.ev.ok); }), pars: S.sketches.map(function (s) { return s.par; }), walks: walks,
      buildEnabled: !S.dom.build.disabled, cardRows: rows.length, cardHeight: card.getBoundingClientRect().height,
      parRow: cellsOf(1), lenRow: cellsOf(2), lengths: S.sketches.map(function (s) { return Math.round(s.plan.length); }),
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
  check('the scorecard: a column per hole with par and metres, the totals, at full height (the page scrolls instead of squeezing it)',
    plan.cardRows === 4 && plan.cardHeight >= 90 && plan.parRow.slice(1).join() === '4,3,5,12' &&
    plan.lenRow.slice(1, 4).join() === plan.lengths.join() && Number(plan.lenRow[4]) === plan.lengths.reduce(function (a, b) { return a + b; }, 0),
    JSON.stringify({ rows: plan.cardRows, h: plan.cardHeight, par: plan.parRow, len: plan.lenRow }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'blueprint-builder-map.png') });

  // 2a. zoom and pan: the + button, the wheel and a two-finger pinch zoom the map; a pinch does not move the hole the first finger
  // touched; canvas and world coordinates still agree, and "show all" goes back to the whole plate
  const zoomed = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const S = window.HoleBlueprint.state(), cv = S.canvas, r = cv.getBoundingClientRect();
    const sk = S.sketches[S.sel], origin0 = JSON.stringify(sk.origin);
    S.dom.zoomUi.plus.click();
    const afterPlus = S.zoom.zoom;
    await wait(50);
    // the tee marker is drawn where the hole's tee is: canvas -> world gives the tee back
    const tw = S.zoom.toWorld(S.handles.tee.x, S.handles.tee.y), roundTrip = Math.hypot(tw.x - sk.origin.x, tw.z - sk.origin.z);
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    const afterWheel = S.zoom.zoom;
    S.dom.zoomUi.all.click();
    // a pinch that starts on the selected hole's tee: the first finger would move it, the second makes it a pinch
    const tx = r.left + S.handles.tee.x * r.width / S.C, ty = r.top + S.handles.tee.y * r.height / S.C;
    const pe = function (type, id, x, y) { cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true })); };
    pe('pointerdown', 1, tx, ty);
    pe('pointermove', 1, tx + 20, ty + 10);
    pe('pointerdown', 2, tx + 60, ty);
    pe('pointermove', 2, tx + 160, ty);
    pe('pointermove', 1, tx - 40, ty);
    const afterPinch = S.zoom.zoom;
    pe('pointerup', 2, tx + 160, ty);
    pe('pointerup', 1, tx - 40, ty);
    await wait(300);
    const originAfter = JSON.stringify(S.sketches[S.sel].origin);
    S.dom.zoomUi.all.click();
    await wait(100);
    // the first finger lands on (and drags) a hole that is NOT selected, then a pinch starts: every hole and the selection go back
    S.sel = 0; window.HoleBlueprint.evaluate(0);
    await wait(100);
    const before2 = JSON.stringify(S.sketches.map(function (k) { return [k.origin, k.heading]; }));
    const other = S.sketches[1], ox = r.left + S.zoom.px(other.origin.x) * r.width / S.C, oy = r.top + S.zoom.pz(other.origin.z) * r.height / S.C;
    pe('pointerdown', 3, ox, oy);
    const selDuring = S.sel;
    pe('pointermove', 3, ox + 40, oy + 30);
    await wait(50);
    pe('pointerdown', 4, ox + 80, oy);
    pe('pointermove', 4, ox + 150, oy);
    pe('pointerup', 4, ox + 150, oy);
    pe('pointerup', 3, ox + 40, oy + 30);
    await wait(300);
    const after2 = JSON.stringify(S.sketches.map(function (k) { return [k.origin, k.heading]; }));
    const otherRestored = after2 === before2, selRestored = S.sel === 0, selWasOther = selDuring === 1;
    S.dom.zoomUi.all.click();
    return { afterPlus: afterPlus, roundTrip: roundTrip, afterWheel: afterWheel, afterPinch: afterPinch, moved: originAfter !== origin0, reset: S.zoom.zoom, busy: S.busy,
      otherHole: { grabbed: selWasOther, restored: otherRestored, selection: selRestored } };
  });
  check('zoom and pan: + / wheel / pinch zoom the map, a pinch leaves every hole (also one the first finger grabbed) and the selection as they were, coordinates agree, show-all resets',
    Math.abs(zoomed.afterPlus - 1.6) < 1e-6 && zoomed.roundTrip < 0.5 && zoomed.afterWheel > zoomed.afterPlus && zoomed.afterPinch > 1.5 && !zoomed.moved && zoomed.reset === 1 &&
    zoomed.otherHole.grabbed && zoomed.otherHole.restored && zoomed.otherHole.selection,
    JSON.stringify(zoomed));

  // 2b. the tabs: to Omgivning and back keeps the plan that is not built yet; the Hål tab is the blueprint again
  const tabs = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const before = window.HoleBlueprint.state().sketches.map(function (s) { return [s.par, Math.round(s.origin.x), Math.round(s.origin.z)].join(':'); });
    const tabBtn = function (name) { return document.querySelector('[role=tablist] [data-tab="' + name + '"]'); };
    tabBtn('surround').click();
    await wait(800);
    const onSurround = { backdrop: !!(window.Backdrop && window.Backdrop.state()), blueprint: !!window.HoleBlueprint.state(), paused: window._pause3D === true,
      selected: (tabBtn('surround') || {}).getAttribute && tabBtn('surround').getAttribute('aria-selected') };
    tabBtn('holes').click();
    await wait(800);
    const S = window.HoleBlueprint.state();
    const after = S ? S.sketches.map(function (s) { return [s.par, Math.round(s.origin.x), Math.round(s.origin.z)].join(':'); }) : null;
    return { onSurround: onSurround, backdropAfter: !!(window.Backdrop && window.Backdrop.state()), before: before, after: after, allOk: !!S && S.sketches.every(function (s) { return s.ev && s.ev.ok; }) };
  });
  check('tabs: Omgivning opens the backdrop map in place of the blueprint (the scene stays paused), and Hål brings the unbuilt plan back unchanged',
    tabs.onSurround.backdrop && !tabs.onSurround.blueprint && tabs.onSurround.paused && tabs.onSurround.selected === 'true' &&
    !tabs.backdropAfter && !!tabs.after && tabs.after.join() === tabs.before.join() && tabs.allOk, JSON.stringify(tabs));
  // switching tabs while a hole's spot is still being looked for: the search starts again when the plan comes back
  const midSearch = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const tabBtn = function (name) { return document.querySelector('[role=tablist] [data-tab="' + name + '"]'); };
    let S = window.HoleBlueprint.state();
    S.sel = S.sketches.length - 1;
    S.dom.remove.click();                       // drop the last hole and add it again: its search starts
    window.HoleBlueprint.addHole();
    const busyAtSwitch = window.HoleBlueprint.state().busy;
    tabBtn('surround').click();
    await wait(300);
    tabBtn('holes').click();
    await wait(200);
    S = window.HoleBlueprint.state();
    for (let w = 0; w < 300 && S && S.busy; w++) await wait(100);
    return { busyAtSwitch: busyAtSwitch, n: S && S.sketches.length, ok: S ? S.sketches.map(function (s) { return !!(s.ev && s.ev.ok); }) : null, buildEnabled: S && !S.dom.build.disabled };
  });
  check('tabs: a hole whose spot was still being found when the tab changed gets its search again and a good spot', midSearch.busyAtSwitch && midSearch.n === 3 && midSearch.ok.every(Boolean) && midSearch.buildEnabled, JSON.stringify(midSearch));

  // 3. build: every hole, the par 3 with its approach strip, and the scene runs again
  const built = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    window._bpLastBuild = null;
    const S = window.HoleBlueprint.state();
    const mowBefore = window._smartMowPattern;
    S.dom.mowBtns.filter(function (b) { return b.dataset.mow === 'CHECKERBOARD'; })[0].click();
    const mowPicked = S.mow;
    window.HoleBlueprint.build();
    const paused = window._pause3D;
    for (let w = 0; w < 600 && !window._bpLastBuild; w++) await wait(200);
    await wait(500);
    return {
      pausedAfterClose: paused, last: window._bpLastBuild, overlay: !!document.getElementById('bp-overlay'),
      nextCard: (document.getElementById('bp-next') || {}).textContent || null,
      mowPicked: mowPicked, mowBefore: mowBefore, mowAfter: window._smartMowPattern,
      holes: [0, 1, 2].map(function (i) {
        const h = courseHoles[i];
        return { par: h.par, green: !!h.greenData, tees: (h.teeBoxes || []).length, fairways: (h.fairways || []).length,
          mow: [h.greenData && h.greenData.mowPattern].concat((h.fairways || []).map(function (f) { return f.mowPattern; })) };
      })
    };
  });
  check('closing the map lets the scene run again', built.pausedAfterClose === false, String(built.pausedAfterClose));
  check('every hole is built', !!built.last && built.last.jobs === 3 && built.last.failed.length === 0 && built.holes.every(function (h) { return h.green && h.tees === 3; }), JSON.stringify({ last: built.last, holes: built.holes }));
  check('the holes take the planned par; the par 3 has its approach strip, the others their fairway', built.holes.map(function (h) { return h.par; }).join() === '4,3,5' && built.holes.every(function (h) { return h.fairways === 1; }), JSON.stringify(built.holes));
  check('the course style: the mowing pattern picked on the map is on every built fairway and green, and the global is put back',
    built.mowPicked === 'CHECKERBOARD' && built.holes.every(function (h) { return h.mow.every(function (m) { return m === 'CHECKERBOARD'; }); }) && built.mowAfter === built.mowBefore,
    JSON.stringify({ picked: built.mowPicked, holes: built.holes.map(function (h) { return h.mow; }), before: built.mowBefore, after: built.mowAfter }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'blueprint-builder-built.png') });

  // the card offering the next step leads to the Omgivning tab
  const next = await page.evaluate(async function () {
    const card = document.getElementById('bp-next');
    if (!card) return { card: false };
    const go = card.querySelectorAll('button')[0];
    go.click();
    await new Promise(function (r) { setTimeout(r, 800); });
    const st = window.Backdrop && window.Backdrop.state();
    if (st && window.Backdrop.close) window.Backdrop.close();
    return { card: true, opened: !!st, cardGone: !document.getElementById('bp-next') };
  });
  check('after the build a card offers the next step, and it opens the Omgivning tab', !!built.nextCard && next.card && next.opened && next.cardGone, JSON.stringify([built.nextCard, next]));

  // 4. the backdrop map draws the same course: the shared course map module, the built holes on the plate in course colours
  const backdrop = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (typeof window.openBackdropMap !== 'function' || !window.CourseMap) return { api: false };
    window.openBackdropMap();
    await wait(1200);
    // the map canvas is the largest canvas in the newest full-screen layer
    const cv = Array.prototype.slice.call(document.querySelectorAll('canvas')).filter(function (c) { return c.offsetParent !== null && c.width >= 400 && c.width === c.height; }).pop();
    if (!cv) return { api: true, canvas: false };
    // count fairway-green pixels (the course-map turf colour) inside the plate in the middle of the map
    const ctx = cv.getContext('2d'), w = cv.width, d = ctx.getImageData(Math.round(w * 0.3), Math.round(w * 0.3), Math.round(w * 0.4), Math.round(w * 0.4)).data;
    let turf = 0;
    const f = parseInt(window.CourseMap.TURF.fairway.slice(1), 16), fr = (f >> 16) & 255, fg = (f >> 8) & 255, fb = f & 255;
    for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - fr) < 14 && Math.abs(d[k + 1] - fg) < 14 && Math.abs(d[k + 2] - fb) < 14) turf++;
    return { api: true, canvas: true, turf: turf };
  });
  const bdZoom = await page.evaluate(function () {
    const B = window.Backdrop && window.Backdrop.state();
    if (!B || !B.zoom) return { zoom: false };
    B.dom.zoomUi.plus.click();
    const z = B.zoom.zoom;
    B.dom.zoomUi.all.click();
    return { zoom: true, afterPlus: z, reset: B.zoom.zoom };
  });
  check('the backdrop map zooms too (+ and show all)', bdZoom.zoom && bdZoom.afterPlus > 1.5 && bdZoom.reset === 1, JSON.stringify(bdZoom));
  // the shelf offers only figures tagged for the course's world in Admin; the rest are one tap away
  const shelf = await page.evaluate(function () {
    const B = window.Backdrop && window.Backdrop.state();
    if (!B || !window.assetFitsBiome) return { api: false };
    const R = window.ASSET_REGISTRY = window.ASSET_REGISTRY || {}, saved = {}, biome = window.ACTIVE_BIOME;
    const fake = { _t_cactus: { name: 'T Cactus', targetHeight: 30, biomes: ['DESERT'] }, _t_pine: { name: 'T Pine', targetHeight: 30, biomes: ['AUTUMN'] } };
    // only the test figures on the shelf: the others are moved aside for the check
    Object.keys(R).forEach(function (k) { saved[k] = R[k]; delete R[k]; });
    Object.assign(R, fake);
    const names = function () { return Array.prototype.map.call(B.dom.shelf.querySelectorAll('button'), function (b) { return b.textContent; }); };
    const toggle = function () { return B.dom.shelf.querySelector('.bd-world-toggle'); };
    const out = { api: true };
    try {
      window.ACTIVE_BIOME = 'DESERT_SUNSET';
      window.Backdrop.refresh();
      out.desert = names();
      toggle().click();
      out.all = names();
      toggle().click();
      delete R._t_cactus;
      window.Backdrop.refresh();
      out.emptyText = (B.dom.shelf.querySelector('.bd-shelf-empty') || {}).textContent || '';
      out.emptyToggle = !!toggle();
      delete R._t_pine;
      window.Backdrop.refresh();
      out.noneText = (B.dom.shelf.querySelector('.bd-shelf-empty') || {}).textContent || '';
    } finally {
      Object.keys(fake).forEach(function (k) { delete R[k]; });
      Object.assign(R, saved);
      window.ACTIVE_BIOME = biome;
      B.anyBiome = false;
      window.Backdrop.refresh();
    }
    return out;
  });
  check('the shelf shows the desert figures in a desert world, other worlds behind one chip', shelf.api && shelf.desert.some(function (t) { return /T Cactus/.test(t); }) && !shelf.desert.some(function (t) { return /T Pine/.test(t); })
    && shelf.desert.some(function (t) { return /^\+1 /.test(t); }) && shelf.all.some(function (t) { return /T Pine/.test(t); }), JSON.stringify(shelf));
  check('an empty shelf says why: none for this world (with the chip), or none at all (20 m)', shelf.api && /Admin/.test(shelf.emptyText) && shelf.emptyToggle && /20 m/.test(shelf.noneText), JSON.stringify(shelf));
  check('the backdrop map shows the built holes in the course-map colours (shared course-map.js)', backdrop.api && backdrop.canvas && backdrop.turf > 30, JSON.stringify(backdrop));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'blueprint-builder-backdrop.png') });
  // step 5: the map is the course map. With every hole built the Hål tab opens an overview; a tap on a built hole offers to edit
  // it in the builder (the map closes, the hole is current, the camera flies there)
  const overview = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (!window.Backdrop.state()) { window.openBackdropMap(); await wait(800); }
    const tab = document.querySelector('[role=tablist] [data-tab="holes"]');
    const tabOn = !!tab && !tab.disabled;
    tab.click();
    await wait(600);
    const S = window.HoleBlueprint.state();
    if (!S) return { tabOn: tabOn, opened: false };
    const out = { tabOn: tabOn, opened: true, sketches: S.sketches.length, status: S.dom.status.textContent, buildHidden: S.dom.build.style.visibility === 'hidden', mapBtn: !!document.getElementById('topbar-btn-map') };
    // tap the middle of hole 2's green
    const h = window.courseHoles[1], g = h.greenData.points, c = g.reduce(function (a, p) { return { x: a.x + p.x / g.length, z: a.z + p.z / g.length }; }, { x: 0, z: 0 });
    const r = S.canvas.getBoundingClientRect(), k = r.width / S.C;
    const px = r.left + S.zoom.px(c.x) * k, py = r.top + S.zoom.pz(c.z) * k;
    const pe = function (type) { S.canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true, button: 0 })); };
    pe('pointerdown'); pe('pointerup');
    await wait(100);
    out.builtSel = S.builtSel;
    out.card = S.dom.builtCard.style.display === 'flex' ? S.dom.builtText.textContent : '';
    window.changeHoleTo(0);
    S.dom.builtEdit.click();
    await wait(500);
    out.closed = !window.HoleBlueprint.state();
    out.current = window.currentHoleIndex;
    const t = (typeof controls !== 'undefined' && controls) ? controls.target : null;
    out.camNear = t ? Math.round(Math.hypot(t.x - c.x, t.z - c.z)) : null;
    return out;
  });
  check('every hole built: the Hål tab still opens, as an overview of the course (nothing to plan, no Build button), and the top bar has a map button',
    overview.tabOn && overview.opened && overview.sketches === 0 && overview.buildHidden && overview.mapBtn, JSON.stringify(overview));
  check('a tap on a built hole shows its card; "Ändra i buildern" closes the map on that hole with the camera over it',
    overview.builtSel === 1 && /2 · Par/.test(overview.card) && overview.closed && overview.current === 1 && overview.camNear !== null && overview.camNear < 200, JSON.stringify(overview));

  // undo empties a hole: the map plans it again. The plan is kept when the map closes (✕, "Forma marken här"), its outline shows in
  // the 3D view and the map button has a dot, it comes back where it was, "Börja om" throws it away, and a planned hole built in the
  // builder meanwhile drops out of the plan
  const kp = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const settle = async function (S) { for (let w = 0; w < 300 && S.busy; w++) await wait(100); };
    // where each built hole's fairway is painted, to see that undo takes the paint away too
    const HGx = window.HoleGenerator;
    const fwAt = window.courseHoles.map(function (h) {
      const f = h && (h.fairways || []).filter(function (o) { return o && o.points && o.points.length >= 3; })[0];
      return f ? f.points.reduce(function (a, p) { return { x: a.x + p.x / f.points.length, z: a.z + p.z / f.points.length }; }, { x: 0, z: 0 }) : null;
    });
    const builtBefore = window.courseHoles.filter(function (h) { return h && !HGx.holeIsEmpty(h); }).length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
    await wait(1500);
    const empty = window.CourseMap.firstEmptyHole();
    const builtAfter = window.courseHoles.filter(function (h) { return h && !HGx.holeIsEmpty(h); }).length;
    const c = fwAt[empty];
    const undo = { builtBefore: builtBefore, builtAfter: builtAfter, paintBefore: 'FAIRWAY', paintAfter: c ? window.localGetTerrainAt(c.x, -c.z).type : null };
    window.openHoleBlueprint();
    let S = window.HoleBlueprint.state();
    const out = { undo: undo, empty: empty, holes: S.holes.slice(), sketches: S.sketches.length };
    await settle(S);
    const at = { x: S.sketches[0].origin.x, z: S.sketches[0].origin.z, h: S.sketches[0].heading, ok: !!(S.sketches[0].ev && S.sketches[0].ev.ok) };
    out.at = at;
    // ✕ keeps the plan
    document.querySelector('#bp-overlay button[title]') && Array.prototype.filter.call(document.querySelectorAll('#bp-overlay button'), function (b) { return b.textContent === '✕' && b.style.minHeight === '44px'; })[0].click();
    await wait(800);
    const keep = window.HoleBlueprint.keptPlan();
    out.kept = keep ? keep.sketches.length : 0;
    const m = window.HoleBlueprint.planMarkers();
    out.marker = m ? { visible: m.visible, lines: m.children.length } : null;
    const badge = document.querySelector('#topbar-btn-map .bp-badge');
    out.badge = badge ? badge.style.display !== 'none' : null;
    // the map button brings it back where it was
    document.getElementById('topbar-btn-map').click();
    await wait(400);
    S = window.HoleBlueprint.state();
    out.back = !!S && S.sketches.length === 1 && Math.abs(S.sketches[0].origin.x - at.x) < 1e-6 && Math.abs(S.sketches[0].origin.z - at.z) < 1e-6 && S.sketches[0].heading === at.h;
    out.markerHidden = !window.HoleBlueprint.planMarkers().visible;
    // "Forma marken här": closed, plan kept, the planned hole current, the camera over its spot
    window.changeHoleTo(0);
    S.dom.shapeHere.click();
    await wait(600);
    const wp = window.HoleBlueprint.keptPlan() && window.HoleBlueprint.keptPlan().sketches[0];
    const t = (typeof controls !== 'undefined' && controls) ? controls.target : null;
    // focusCamera aims at the middle of the line from the tee to the green
    const w = wp ? window.HoleGenerator.worldPlan(wp.plan, wp.origin, wp.heading) : null;
    const mid = w ? { x: (w.tee.x + w.greenCenter.x) / 2, z: (w.tee.z + w.greenCenter.z) / 2 } : null;
    out.shape = { closed: !window.HoleBlueprint.state(), kept: !!wp, current: window.currentHoleIndex, camNear: t && mid ? Math.round(Math.hypot(t.x - mid.x, t.z - mid.z)) : null };
    // "Börja om" throws the plan away and suggests anew
    window.openHoleBlueprint();
    await wait(300);
    S = window.HoleBlueprint.state();
    const seed = S.sketches[0].seed;
    S.dom.restart.click();
    await settle(S);
    out.restart = { sketches: S.sketches.length, newSeed: S.sketches[0].seed !== seed, ok: !!(S.sketches[0].ev && S.sketches[0].ev.ok) };
    // a planned hole built in the builder while the map was closed drops out of the plan (here: a tee box put on it by hand)
    window.HoleBlueprint.close(false, true, true);
    const idx = window.HoleBlueprint.keptPlan().holes[0], hole = window.courseHoles[idx];
    const tb = hole.teeBoxes;
    hole.teeBoxes = [{ points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 5 }] }];
    window.openHoleBlueprint();
    await wait(300);
    S = window.HoleBlueprint.state();
    out.dropped = { idx: idx, holes: S.holes.slice(), note: S.dom.detail.textContent };
    window.HoleBlueprint.close(false);
    hole.teeBoxes = tb;
    out.keptAfterClose = window.HoleBlueprint.keptPlan();
    return out;
  });
  check('one Ctrl+Z undoes one hole built from the map, and its fairway leaves the ground too (the step keeps the paint whatever tool is active)',
    kp.undo.builtAfter === kp.undo.builtBefore - 1 && kp.undo.paintAfter !== null && kp.undo.paintAfter !== 'FAIRWAY', JSON.stringify(kp.undo));
  check('undo empties a hole: the map plans it again', kp.empty >= 0 && kp.holes.indexOf(kp.empty) >= 0 && kp.sketches === 1 && kp.at.ok, JSON.stringify(kp));
  check('✕ keeps the plan: its outline shows in the 3D view and the map button has a dot; the map button brings it back where it was (outline hidden while the map is open)',
    kp.kept === 1 && kp.marker && kp.marker.visible && kp.marker.lines >= 3 && kp.badge === true && kp.back && kp.markerHidden, JSON.stringify(kp));
  check('"Forma marken här" closes the map with the plan kept, on the planned hole, the camera over its spot', kp.shape.closed && kp.shape.kept && kp.shape.current === kp.holes[0] && kp.shape.camNear !== null && kp.shape.camNear < 5, JSON.stringify(kp.shape));
  check('"Börja om" suggests a new hole', kp.restart.sketches === 1 && kp.restart.newSeed && kp.restart.ok, JSON.stringify(kp.restart));
  check('a planned hole built in the builder meanwhile drops out of the plan (the map says so)', kp.dropped.holes.indexOf(kp.dropped.idx) < 0 && /^1 /.test(kp.dropped.note) && kp.keptAfterClose === null, JSON.stringify(kp.dropped));
  // a plate built for place 4 of an 18 hole collection (collection-build.js, the card as the server gives it): its holes are numbered 10-12,
  // the map's scorecard shows the other plates as a grey column and the whole course, and the par suggestion balances the whole course
  const col = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const CB = window.CollectionBuild;
    if (!CB) return { api: false };
    const holes = [];
    for (let n = 1; n <= 9; n++) holes.push({ no: n, par: 4, length: 350, plate: Math.floor((n - 1) / 3) });
    const card = { name: 'Testbanan', type: '18', room: 6, filled: 3, plates: [{ code: 'P1' }, { code: 'P2' }, { code: 'P3' }], holes: holes };
    const ctx = await CB.start('TST1', 3, { card: card, quiet: true });
    const out = { api: true, slot: ctx && ctx.slot, num0: window.holeNumber(0), topbar: (document.getElementById('topbar-hole-num') || {}).textContent };
    // the bar between the plates: ← the plate before (3), → waits for this new plate to be published
    const bar = document.getElementById('cb-bar');
    const btn = function (role) { const b = bar && bar.querySelector('[data-role="' + role + '"]'); return b ? { text: b.textContent, on: !b.disabled } : null; };
    out.bar = bar ? { shown: getComputedStyle(bar).display !== 'none', text: bar.textContent, title: (bar.querySelector('span') || {}).title || '', prev: btn('cb-prev'), next: btn('cb-next') } : null;
    window.openHoleBlueprint();
    const S = window.HoleBlueprint.state();
    for (let w = 0; w < 300 && S.busy; w++) await wait(100);
    const rows = S.dom.card.querySelectorAll('tr'), cells = function (r) { return Array.prototype.map.call(rows[r].children, function (c) { return c.textContent.trim(); }); };
    out.head = cells(0); out.par = cells(1);
    out.sketchPar = S.sketches[0].par; out.sketchNo = window.holeNumber(S.holes[0]);
    let platePar = 0;
    for (let i = 0; i < 3; i++) { const k = S.holes.indexOf(i); platePar += k >= 0 && k < S.sketches.length ? S.sketches[k].par : (window.HoleGenerator.holeIsEmpty(window.courseHoles[i]) ? 0 : window.courseHoles[i].par); }
    out.wantCourse = 36 + platePar;
    out.builtPars = [0, 1, 2].map(function (i) { return window.HoleGenerator.holeIsEmpty(window.courseHoles[i]) ? null : window.courseHoles[i].par; });
    window.HoleBlueprint.close(false);
    CB.clear();
    out.after = window.holeNumber(0);
    out.barGone = !document.getElementById('cb-bar');
    return out;
  });
  check('a plate for place 4 of an 18 hole collection: its holes are 10-12 (top bar too), and back to 1-3 without the collection',
    col.api && col.slot === 3 && col.num0 === 10 && /1[0-2]/.test(col.topbar || '') && col.sketchNo >= 10 && col.sketchNo <= 12 && col.after === 1, JSON.stringify(col));
  check('the bar names the collection and the place, ← opens plate 3, → waits until this new plate is published; it goes with the collection',
    col.api && col.bar && col.bar.shown && /Testbanan/.test(col.bar.title + col.bar.text) && /4 av 6|4 of 6|4\/6/.test(col.bar.text) && col.bar.prev.on && /3/.test(col.bar.prev.text) && !col.bar.next.on && col.barGone, JSON.stringify(col.bar));
  check('the map scorecard shows the other plates (1–9) in a grey column and the whole course in a last column',
    col.api && col.head && col.head[1] === '1–9' && col.head[col.head.length - 1] === 'Bana' && col.par[1] === '36' && Number(col.par[col.par.length - 1]) === col.wantCourse, JSON.stringify(col));
  check('the par suggestion balances the whole course: nine par 4s on the other plates, so the new hole is a par 3 or 5', col.api && (col.sketchPar === 3 || col.sketchPar === 5), JSON.stringify(col));

  // the plate's painted ground: OB keeps the planner away, and the maps take the course's palette (a desert course reads as desert)
  const ground = await page.evaluate(function () {
    const HG = window.HoleGenerator, CM = window.CourseMap, data = window.terrainBiomeData;
    if (!HG || !CM || !data || !window.CURRENT_BIOME_CONFIG) return { api: false };
    const N = 4096, size = window.TERRAIN_SIZE || 600, ob = window.CURRENT_BIOME_CONFIG.obColor || '#ef4444';
    const rgb = [parseInt(ob.slice(1, 3), 16), parseInt(ob.slice(3, 5), 16), parseInt(ob.slice(5, 7), 16)];
    // paint OB straight into the surface data over x 150..250, z -250..-150 (the lookup reads it; the paint canvas is left alone)
    const px = function (v) { return Math.floor((v + size / 2) / size * N); };
    const saved = [];
    for (let cz = px(-250); cz < px(-150); cz++) for (let cx = px(150); cx < px(250); cx++) {
      const i = (cz * N + cx) * 4;
      saved.push(data[i], data[i + 1], data[i + 2]);
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
    }
    const out = { api: true };
    try {
      const env = HG.siteEnv(null, {});
      env.others = { points: [], polygons: [] }; env.objects = []; env.walls = [];   // only the paint counts here, not where the holes happen to lie
      out.inside = env.isOB(200, -200); out.outside = env.isOB(-200, 200); out.waterThere = env.isWater(200, -200);
      // a par 3 teeing off at x 40 towards +x ends in the painted patch; turned round it plays away from it
      const plan = HG.planFor(3, 5);
      out.len = plan.length;
      out.across = HG.evaluateSite(plan, { x: 40, z: -200 }, 0, env).reasons;
      out.away = HG.evaluateSite(plan, { x: 40, z: -200 }, Math.PI, env).reasons;
      // the terrain picture: an OB cell has a red cast next to the plain ground
      const pic = CM.renderTerrain(size / 2), c = pic.getContext('2d'), T = pic.width;
      const at = function (x, z) { return Array.prototype.slice.call(c.getImageData(Math.round((x + size / 2) / size * T), Math.round((z + size / 2) / size * T), 1, 1).data, 0, 3); };
      out.obPx = at(200, -200); out.plainPx = at(-280, 280);
    } finally {
      let k = 0;
      for (let cz = px(-250); cz < px(-150); cz++) for (let cx = px(150); cx < px(250); cx++) {
        const i = (cz * N + cx) * 4;
        data[i] = saved[k++]; data[i + 1] = saved[k++]; data[i + 2] = saved[k++];
      }
    }
    // the map colours follow the palette: summer as before, the desert's lime fairway and yellow sand in a desert world
    const cfg = window.CURRENT_BIOME_CONFIG;
    out.summer = { fairway: CM.TURF.fairway, green: CM.TURF.green, sand: CM.TURF.sand };
    window.CURRENT_BIOME_CONFIG = Object.assign({}, cfg, window.BUILTIN_BIOMES.DESERT);
    out.desert = { fairway: CM.TURF.fairway, green: CM.TURF.green, sand: CM.TURF.sand };
    window.CURRENT_BIOME_CONFIG = cfg;
    out.back = CM.TURF.fairway === out.summer.fairway;
    return out;
  });
  const near = function (hex, ref, tol) { const a = parseInt(hex.slice(1), 16), b = parseInt(ref.slice(1), 16); return [16, 8, 0].every(function (sh) { return Math.abs(((a >> sh) & 255) - ((b >> sh) & 255)) <= tol; }); };
  check('painted OB on the plate: the planner sees it (not as water) and will not build or play across it', ground.api && ground.inside === true && ground.outside === false && ground.waterThere === false
    && ground.across[0] === 'ob' && ground.away[0] !== 'ob', JSON.stringify(ground));
  check('the terrain picture shows painted OB with a red cast', ground.api && ground.obPx[0] - ground.obPx[1] > ground.plainPx[0] - ground.plainPx[1] + 25, JSON.stringify([ground.obPx, ground.plainPx]));
  check('the map colours come from the course palette: summer close to the old map colours, the desert lime and yellow', ground.api && near(ground.summer.fairway, '#7bbf55', 14)
    && near(ground.summer.green, '#a3dd7a', 18) && near(ground.desert.fairway, '#a3e635', 14) && /^#f[c-f][d-f][0-9a-f][0-9a-f][0-9a-f]$/.test(ground.desert.sand) && parseInt(ground.desert.sand.slice(5), 16) < 0x90 && ground.back, JSON.stringify([ground.summer, ground.desert]));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nBlueprint builder smoke test FAILED: ' + failed + ' check(s)' : '\nBlueprint builder smoke test passed');
  process.exit(failed ? 1 : 0);
})();
