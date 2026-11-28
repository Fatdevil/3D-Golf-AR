// Browser smoke test for the Unified Left Studio Dock (PR 1: layout, collapse/reopen, no click bleed,
// Builder -> Test -> Builder transitions, Range Tee visibility, and tablet/mobile responsive layouts).
//   npm run smoke:dock
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(__dirname, '..');

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
function check(name, ok, detail) {
  results.push(!!ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''));
}

async function setupContext(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport, serviceWorkers: 'block' });
  await ctx.addInitScript(function () {
    try { localStorage.setItem('golf_auto_q_on', '0'); } catch (e) {}
  });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) {
    const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); });
    if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort();
  });
  await ctx.route(/^https:\/\/(?!cdn)/, function (r) { r.abort(); });
  return ctx;
}

(async function () {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  let browser;
  try {
    const launchArgs = ['--no-sandbox', '--ignore-gpu-blocklist'];
    if (process.platform === 'linux') launchArgs.push('--use-gl=swiftshader', '--enable-unsafe-swiftshader');
    browser = await chromium.launch({
      executablePath: chromePath(),
      args: launchArgs
    });
  } catch (e) {
    console.error('Could not start Chromium: ' + e.message.split('\n')[0]);
    srv.close();
    process.exit(2);
  }

  const errors = [];
  let currentStep = 'desktop-init';

  // ---- 1. Desktop (1280x800): Unified Left Dock, Collapse/Reopen, No Click Bleed, Free Right Viewport ----
  const ctxDesk = await setupContext(browser, { width: 1280, height: 800 });
  const page = await ctxDesk.newPage();
  page.on('pageerror', function (e) { errors.push('[' + currentStep + '] ' + e.message.slice(0, 140) + ' @ ' + String(e.stack || '').split('\n').slice(1, 2).join('').slice(0, 120)); });
  await page.goto(base + '/arcade.html?autorun=new_build&template=blank&biome=GLOBAL', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  currentStep = 'desktop-tools';
  // Measure every primary tool: rail + drawer stay <= 362px from left, nothing covers the right half of the course
  const toolMetrics = await page.evaluate(function () {
    const tools = ['SMART_BUILDER', 'SCULPT', 'PAINT', 'WATER', 'PROPS', 'ENV'];
    const out = {};
    tools.forEach(function (t) {
      setTool(t);
      const rail = document.getElementById('left-toolbar').getBoundingClientRect();
      const drawer = document.getElementById('builder-dock-drawer').getBoundingClientRect();
      const rightTb = document.getElementById('right-toolbar').getBoundingClientRect();
      const flyout = document.getElementById('left-flyout-toolbar');
      const flyVis = getComputedStyle(flyout).display !== 'none';
      const flyRect = flyVis ? flyout.getBoundingClientRect() : null;
      out[t] = {
        railRight: Math.round(rail.right),
        drawerLeft: Math.round(drawer.left),
        drawerRight: Math.round(drawer.right),
        rightTbRight: Math.round(rightTb.right),
        flyRight: flyRect ? Math.round(flyRect.right) : 0,
        collapsed: document.body.classList.contains('dock-collapsed')
      };
    });
    return out;
  });
  const allInsideLeft = Object.keys(toolMetrics).every(function (k) {
    const m = toolMetrics[k];
    return !m.collapsed && m.railRight <= 74 && m.drawerRight <= 362 && m.rightTbRight <= 362 && m.flyRight <= 362;
  });
  check('desktop (1280x800): all builder tools stay docked on the left (<= 360px) with right 3D viewport 100% free', allInsideLeft, JSON.stringify(toolMetrics));

  currentStep = 'desktop-click-guard';
  // Verify clicking inside the open dock panel NEVER places a point on the 3D terrain
  await page.evaluate(function () {
    setTool('SMART_BUILDER');
    if (typeof selectHoleComponent === 'function') selectHoleComponent('GREEN');
    if (typeof clearSmartGreen === 'function') clearSmartGreen();
    camera.position.set(0, 90, 90);
    controls.target.set(0, 0, 0);
    controls.update();
  });
  const beforePanelClick = await page.evaluate(function () { return (window.smartGreenPoints || []).length; });
  await page.mouse.click(210, 320); // well inside the 72..360px left dock drawer
  await page.waitForTimeout(250);
  const afterPanelClick = await page.evaluate(function () { return (window.smartGreenPoints || []).length; });
  check('clicking inside the open left dock panel never places a drawing point on the 3D course', beforePanelClick === 0 && afterPanelClick === 0, beforePanelClick + ' -> ' + afterPanelClick);

  currentStep = 'desktop-collapse';
  // Verify collapse via header button, inert state, drawing near the dock edge (x=120px) after collapse, and reopen via rail button
  await page.click('#builder-dock-collapse-btn');
  await page.waitForTimeout(300);
  const collapsedState = await page.evaluate(function () {
    const drawer = document.getElementById('builder-dock-drawer');
    const railToggle = document.getElementById('btn-dock-toggle');
    const hit = document.elementFromPoint(120, 400);
    return {
      collapsed: document.body.classList.contains('dock-collapsed'),
      inert: !!drawer.inert,
      ariaHidden: drawer.getAttribute('aria-hidden'),
      railToggleRect: railToggle.getBoundingClientRect().toJSON(),
      railToggleText: railToggle.textContent.trim(),
      elementAt120: hit ? hit.tagName : null
    };
  });
  // Place a point right near the dock edge (x=130, y=420) while drawer is collapsed!
  await page.mouse.click(130, 420);
  await page.waitForTimeout(300);
  const ptsAfterNearEdgeClick = await page.evaluate(function () { return (window.smartGreenPoints || []).length; });
  // Reopen via the rail toggle button
  await page.click('#btn-dock-toggle');
  await page.waitForTimeout(300);
  const reopenedState = await page.evaluate(function () {
    const drawer = document.getElementById('builder-dock-drawer');
    return { collapsed: document.body.classList.contains('dock-collapsed'), inert: !!drawer.inert };
  });
  check('collapsing dock makes drawer inert, exposes 3D canvas near rail (x=120px) for drawing, and rail button reopens it',
    collapsedState.collapsed && collapsedState.inert && collapsedState.ariaHidden === 'true' &&
    collapsedState.railToggleRect.width >= 40 && collapsedState.railToggleRect.left >= 0 &&
    collapsedState.elementAt120 === 'CANVAS' && ptsAfterNearEdgeClick === 1 &&
    !reopenedState.collapsed && !reopenedState.inert,
    JSON.stringify({ collapsedState, ptsAfterNearEdgeClick, reopenedState }));

  currentStep = 'desktop-mode-transition';
  // Verify Builder -> Test -> Builder transition hides dock cleanly in TEST and restores it cleanly in BUILD
  const modeTransition = await page.evaluate(function () {
    courseHoles[0].tees.yellow = { x: 0, y: 0, z: 0, rot: 0 };
    courseHoles[0].flag = { x: 0, y: 0, z: -120 };
    setTool('SMART_BUILDER');
    setMode('TEST');
    const inTest = {
      rail: getComputedStyle(document.getElementById('left-toolbar')).display,
      drawer: getComputedStyle(document.getElementById('builder-dock-drawer')).display,
      playUi: document.body.classList.contains('play-ui')
    };
    setMode('BUILD');
    const backBuild = {
      rail: getComputedStyle(document.getElementById('left-toolbar')).display,
      drawer: getComputedStyle(document.getElementById('builder-dock-drawer')).display,
      flyout: getComputedStyle(document.getElementById('left-flyout-toolbar')).display,
      collapsed: document.body.classList.contains('dock-collapsed'),
      playUi: document.body.classList.contains('play-ui')
    };
    return { inTest, backBuild };
  });
  check('Builder -> Test -> Builder hides dock in TEST and cleanly restores rail, drawer, and active sub-tool strip in BUILD',
    modeTransition.inTest.rail === 'none' && modeTransition.inTest.drawer === 'none' && modeTransition.inTest.playUi &&
    modeTransition.backBuild.rail === 'flex' && modeTransition.backBuild.drawer === 'flex' &&
    modeTransition.backBuild.flyout === 'flex' && !modeTransition.backBuild.collapsed && !modeTransition.backBuild.playUi,
    JSON.stringify(modeTransition));

  currentStep = 'polygon-draft-preservation';
  // Regression check: returning to BUILD (from TEST or rejected playtest validation) must preserve PAINT & PROPS polygon drafts
  await page.evaluate(function () {
    setTool('PAINT');
    if (typeof setPaintMode === 'function') setPaintMode('POLYGON');
    camera.position.set(0, 90, 90);
    controls.target.set(0, 0, 0);
    controls.update();
  });
  await page.mouse.click(760, 360);
  await page.mouse.click(860, 420);
  await page.waitForTimeout(200);
  const paintDraftCheck = await page.evaluate(function () {
    const before = (window.smartGreenPoints || []).length;
    setMode('TEST');
    setMode('BUILD');
    const after = (window.smartGreenPoints || []).length;
    return {
      before,
      after,
      paintPanel: getComputedStyle(document.getElementById('paint-tool-panel')).display,
      flyout: getComputedStyle(document.getElementById('left-flyout-toolbar')).display
    };
  });
  await page.evaluate(function () {
    // Also verify PROPS polygon draft survives validation-rejected setMode('TEST') bounce back to BUILD
    courseHoles[0].tees.yellow = null;
    courseHoles[0].flag = null;
    setTool('PROPS');
    if (typeof setPropsMode === 'function') setPropsMode('POLYGON');
    camera.position.set(0, 90, 90);
    controls.target.set(0, 0, 0);
    controls.update();
  });
  await page.mouse.click(760, 360);
  await page.mouse.click(860, 420);
  await page.waitForTimeout(200);
  const propsDraftCheck = await page.evaluate(function () {
    const before = (window.smartGreenPoints || []).length;
    setMode('TEST'); // rejected by validation gate -> immediately calls setMode('BUILD')
    const after = (window.smartGreenPoints || []).length;
    return {
      before,
      after,
      mode: window.getAppMode ? window.getAppMode() : null,
      flyout: getComputedStyle(document.getElementById('left-flyout-toolbar')).display,
      objStrip: getComputedStyle(document.getElementById('flyout-objects-strip')).display
    };
  });
  check('PAINT and PROPS polygon drafts survive BUILD -> TEST -> BUILD and rejected playtest validation while restoring dock/strips',
    paintDraftCheck.before === 2 && paintDraftCheck.after === 2 && paintDraftCheck.paintPanel === 'flex' && paintDraftCheck.flyout === 'none' &&
    propsDraftCheck.before === 2 && propsDraftCheck.after === 2 && propsDraftCheck.mode === 'BUILD' &&
    propsDraftCheck.flyout === 'flex' && propsDraftCheck.objStrip === 'flex',
    JSON.stringify({ paintDraftCheck, propsDraftCheck }));

  currentStep = 'ipad-portrait';
  // Verify iPad portrait (768x1024) narrows dock to <= 320px leaving >= 448px free viewport
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(300);
  const ipadMetrics = await page.evaluate(function () {
    const rail = document.getElementById('left-toolbar').getBoundingClientRect();
    const drawer = document.getElementById('builder-dock-drawer').getBoundingClientRect();
    return { railW: Math.round(rail.width), drawerRight: Math.round(drawer.right), freeWidth: Math.round(window.innerWidth - drawer.right) };
  });
  check('iPad portrait (768x1024): dock narrows to <= 320px leaving >= 440px free 3D viewport',
    ipadMetrics.railW <= 66 && ipadMetrics.drawerRight <= 322 && ipadMetrics.freeWidth >= 440,
    JSON.stringify(ipadMetrics));

  currentStep = 'mobile-390';
  // Verify Mobile (390x844): drawer docks as scrollable bottom sheet (<= 45vh) leaving upper 3D view open for placing points
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const mobMetrics = await page.evaluate(function () {
    setTool('SMART_BUILDER');
    if (typeof selectHoleComponent === 'function') selectHoleComponent('GREEN');
    if (typeof clearSmartGreen === 'function') clearSmartGreen();
    camera.position.set(0, 90, 90);
    controls.target.set(0, 0, 0);
    controls.update();
    const rail = document.getElementById('left-toolbar').getBoundingClientRect();
    const drawer = document.getElementById('builder-dock-drawer').getBoundingClientRect();
    const scrollEl = document.getElementById('builder-dock-scroll');
    const topCanvasHit = document.elementFromPoint(220, 220);
    return {
      railWidth: Math.round(rail.width),
      drawerTop: Math.round(drawer.top),
      drawerHeight: Math.round(drawer.height),
      freeViewportHeight: Math.round(drawer.top - 50),
      scrollable: scrollEl.scrollHeight >= scrollEl.clientHeight,
      topCanvasHit: topCanvasHit ? topCanvasHit.tagName : null
    };
  });
  await page.mouse.click(220, 220); // tap in upper free 3D viewport to place point
  await page.waitForTimeout(250);
  const mobPts = await page.evaluate(function () { return (window.smartGreenPoints || []).length; });
  check('mobile (390x844): drawer docks as scrollable bottom sheet (<= 45vh) leaving upper 3D view open for placing points',
    mobMetrics.railWidth <= 60 && mobMetrics.drawerTop >= 440 && mobMetrics.freeViewportHeight >= 380 &&
    mobMetrics.topCanvasHit === 'CANVAS' && mobPts === 1,
    JSON.stringify({ mobMetrics, mobPts }));

  await page.evaluate(function () { window._pause3D = true; });
  await page.waitForTimeout(100);
  await page.close();
  await ctxDesk.close();

  currentStep = 'range-mode';
  // ---- 2. Range Mode: Range Tee panel open in left dock while #left-flyout-toolbar stays display:none ----
  const ctxRange = await setupContext(browser, { width: 1200, height: 750 });
  const rpage = await ctxRange.newPage();
  rpage.on('pageerror', function (e) { errors.push('[' + currentStep + '] ' + e.message.slice(0, 140) + ' @ ' + String(e.stack || '').split('\n').slice(1, 2).join('').slice(0, 120)); });
  await rpage.goto(base + '/arcade.html?autorun=new_build&mode=range', { waitUntil: 'load', timeout: 120000 });
  await rpage.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
  await rpage.waitForTimeout(1200);
  const rangeCheck = await rpage.evaluate(function () {
    setMode('BUILD');
    document.getElementById('tool-hole').click();
    const drawer = document.getElementById('builder-dock-drawer').getBoundingClientRect();
    const holePanel = document.getElementById('hole-picker-group').getBoundingClientRect();
    return {
      tool: currentTool,
      flyout: getComputedStyle(document.getElementById('left-flyout-toolbar')).display,
      holePanelDisplay: getComputedStyle(document.getElementById('hole-picker-group')).display,
      drawerRight: Math.round(drawer.right),
      holePanelRight: Math.round(holePanel.right),
      collapsed: document.body.classList.contains('dock-collapsed')
    };
  });
  check('Range Tee opens #hole-picker-group in left dock while #left-flyout-toolbar stays display:none',
    rangeCheck.tool === 'HOLE' && rangeCheck.flyout === 'none' && rangeCheck.holePanelDisplay === 'flex' &&
    !rangeCheck.collapsed && rangeCheck.drawerRight <= 362 && rangeCheck.holePanelRight <= 362,
    JSON.stringify(rangeCheck));
  await rpage.evaluate(function () { window._pause3D = true; });
  await rpage.waitForTimeout(100);
  await rpage.close();
  await ctxRange.close();

  check('no page errors across desktop, iPad, mobile, and range dock checks', errors.length === 0, errors.join(' | '));

  await browser.close();
  srv.close();
  const failed = results.filter(function (x) { return !x; }).length;
  console.log(failed ? '\nBuilder dock smoke test FAILED: ' + failed + ' check(s)' : '\nBuilder dock smoke test passed');
  process.exit(failed ? 1 : 0);
})();
