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
    for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - 0x7b) < 14 && Math.abs(d[k + 1] - 0xbf) < 14 && Math.abs(d[k + 2] - 0x55) < 14) turf++;
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
  check('the backdrop map shows the built holes in the course-map colours (shared course-map.js)', backdrop.api && backdrop.canvas && backdrop.turf > 30, JSON.stringify(backdrop));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'blueprint-builder-backdrop.png') });
  // undo in the backdrop map empties a hole again: the Hål tab comes back on (it is off while every hole is built)
  const undoTab = await page.evaluate(async function () {
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (!window.Backdrop.state()) { window.openBackdropMap(); await wait(800); }
    const tab = function () { return document.querySelector('#bd-overlay [role=tablist] [data-tab="holes"]') || document.querySelector('[role=tablist] [data-tab="holes"]'); };
    const offBefore = tab().disabled;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
    await wait(1500);
    const t = tab();
    const empty = window.CourseMap.firstEmptyHole();
    if (window.Backdrop.state()) window.Backdrop.close();
    return { offBefore: offBefore, onAfter: !!t && !t.disabled, emptyHole: empty };
  });
  check('undo in the backdrop map turns the Hål tab back on when it empties a hole', undoTab.offBefore === true && undoTab.onAfter && undoTab.emptyHole >= 0, JSON.stringify(undoTab));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nBlueprint builder smoke test FAILED: ' + failed + ' check(s)' : '\nBlueprint builder smoke test passed');
  process.exit(failed ? 1 : 0);
})();
