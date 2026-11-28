// End-to-end test of Golf Combine 9: the real server.js against a real Postgres, over HTTP and in arcade.html + training.html (Chromium).
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/combine-e2e.js
// Covers: the server scores a test from the shot bank with its own ball flight (a carry the device sent is ignored); a finished test is
// stored once (asking again returns it); a test without all nine shots is not scored; no free retakes (a second shot, or a retake mark on a
// real measurement, does not count), a misread may be hit again; estimated values make a practice result, never official; only the
// player's own device; a second device sees the same results. In the page: the level, the nine targets, a retake after a misread, the
// last shot offline (preliminary card, verified when back online), the result card with the three costliest targets, and Training Lab.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  combine e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
function need(root, mod) { try { return require(path.join(root, 'node_modules', mod)); } catch (e) { console.error('Missing "' + mod + '". Run: npm install && npm --prefix tests install'); process.exit(2); } }
const { chromium } = need(TESTS, 'playwright-core');
const { Pool } = need(ROOT, 'pg');
const C = require(path.join(ROOT, 'combine-core.js'));
const SP = require(path.join(ROOT, 'server-physics.js'));
const NM = path.join(TESTS, 'node_modules') + '/';
const CDN = { 'three.min.js': NM + 'three/build/three.min.js', 'OrbitControls.js': NM + 'three/examples/js/controls/OrbitControls.js', 'GLTFLoader.js': NM + 'three/examples/js/loaders/GLTFLoader.js', 'DRACOLoader.js': NM + 'three/examples/js/loaders/DRACOLoader.js', 'pako.min.js': NM + 'pako/dist/pako.min.js' };
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { const b = '/opt/pw-browsers'; const d = fs.readdirSync(b).filter(n => /^chromium-\d+$/.test(n)).sort().pop(); if (d) return path.join(b, d, 'chrome-linux', 'chrome'); } catch (e) { /* none */ }
  return undefined;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) failed++; }

(async function () {
  const pool = new Pool({ connectionString: URL_DB });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const BASE = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: URL_DB, RATE_LIMIT_WRITES: '100000', RATE_LIMIT_REGISTER: '100000' }), stdio: 'ignore' });
  const tag = 'E2C' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const ids = [];
  let browser = null;
  async function cleanup() {
    try { if (ids.length) for (const t of ['shots', 'combine_results']) await pool.query('DELETE FROM ' + t + ' WHERE player_id = ANY($1)', [ids]); await pool.query('DELETE FROM device_links WHERE account_id = ANY($1)', [ids]); await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]); } catch (e) { /* none */ }
    try { if (browser) await browser.close(); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  const device = name => { const d = { id: 'e2c-' + name + '-' + tag, token: crypto.randomBytes(32).toString('hex') }; ids.push(d.id); return d; };
  async function api(method, url, body, dev, token) {
    const h = { 'Content-Type': 'application/json' };
    if (dev) { h['x-user-id'] = dev.id; h['x-user-token'] = token === undefined ? dev.token : token; }
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, json: json || {} };
  }
  const T0 = Date.now() - 3600000;
  let k = 0;
  // a measured shot at a target: launch values for about the target's carry (the server works the landing out itself)
  const SPEED = { 30: 50, 50: 66, 70: 80, 90: 92, 110: 103, 130: 113, 150: 124, 170: 136, 190: 150 };
  const shotAt = (test, index, o) => Object.assign({ cid: 'cb' + tag + String(++k).padStart(4, '0'), t: T0 + k * 1000, source: 'LM', club: '7i', ballSpeed: SPEED[C.LEVELS.standard[index]], launch: 18, spin: 6500,
    spinAxis: 0, hla: 0, clubSpeed: SPEED[C.LEVELS.standard[index]] / 1.35, carry: 120, carryStd: C.LEVELS.standard[index], offlineStd: 0,
    raw: { measured: C.NEEDED.slice() }, estimated: [], combine: { test: test, level: 'standard', index: index } }, o || {});
  const expected = shots => C.score(shots, 'standard', SP.landing);
  try {
    for (let i = 0; i < 60; i++) { try { await new Promise((res, rej) => { http.get(BASE + '/api/health', r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => { /"schema_ready":true/.test(b) ? res() : rej(); }); }).on('error', rej); }); break; } catch (e) { await wait(500); if (i === 59) throw new Error('server did not start'); } }
    const A = device('a'), B = device('b'), X = device('x');
    for (const d of [A, B, X]) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': d.id, 'x-user-token': d.token }, body: JSON.stringify({ device_id: d.id }) });

    console.log('1. Servern räknar');
    const t1 = 'test1' + tag, nine = C.LEVELS.standard.map((D, i) => shotAt(t1, i));
    await api('POST', '/api/shots/sync', { shots: nine.slice(0, 8) }, A);
    let r = await api('POST', '/api/combine/finish', { test_id: t1, level: 'standard' }, A);
    check('ett test utan alla nio slag räknas inte (409, med målet som saknas)', r.status === 409 && r.json.missing.join() === '8', JSON.stringify(r));
    await api('POST', '/api/shots/sync', { shots: nine.slice(8) }, A);
    r = await api('POST', '/api/combine/finish', { test_id: t1, level: 'standard' }, A);
    const exp = expected(nine);
    check('servern räknar landningen själv ur utgångsvärdena: inte carry som enheten skickade (som var exakt på målet)', r.status === 200 && r.json.total === exp.total && exp.total < 100 &&
      r.json.shots.every((x, i) => x.score === exp.shots[i].score), JSON.stringify([r.json.total, exp.total]));
    check('resultatet är officiellt (allt uppmätt), med fysikens version och de tre dyraste målen', r.json.official === true && r.json.physics === SP.version() && r.json.worst.length === 3, JSON.stringify(r.json));
    const again = await api('POST', '/api/combine/finish', { test_id: t1, level: 'standard' }, A);
    const rows = (await pool.query('SELECT count(*)::int AS n FROM combine_results WHERE player_id = $1 AND test_id = $2', [A.id, t1])).rows[0].n;
    check('att fråga igen ger samma resultat och ingen dubblett', again.status === 200 && again.json.total === r.json.total && rows === 1);

    console.log('\n2. Omslag');
    const t2 = 'test2' + tag;
    let s2 = C.LEVELS.standard.map((D, i) => shotAt(t2, i));
    const topped = shotAt(t2, 2, { launch: 1, spin: 2000, ballSpeed: 60, clubSpeed: 70, review: { flags: ['topped', 'thin'], mishit: true, misread: false, looksLike: null }, t: s2[2].t });
    s2[2] = topped;
    const freeRetake = shotAt(t2, 2, { t: s2[2].t + 500, combine: { test: t2, level: 'standard', index: 2 } });
    const fakeVoid = Object.assign({}, topped, { combine: { test: t2, level: 'standard', index: 2, void: 'misread' }, edited: topped.t + 400 });
    await api('POST', '/api/shots/sync', { shots: s2.concat([freeRetake]) }, A);
    await api('POST', '/api/shots/sync', { shots: [fakeVoid] }, A);
    r = await api('POST', '/api/combine/finish', { test_id: t2, level: 'standard' }, A);
    check('inga gratis omslag: en toppning räknas även med ett nytt slag efteråt och en "felmätning"-märkning som inte håller', r.status === 200 && r.json.shots[2].score === 0 && r.json.shots[2].shot === topped.cid, JSON.stringify(r.json.shots && r.json.shots[2]));
    const t3 = 'test3' + tag;
    let s3 = C.LEVELS.standard.map((D, i) => shotAt(t3, i));
    const misread = shotAt(t3, 4, { ballSpeed: 180, clubSpeed: 90, review: { flags: ['smash_impossible'], mishit: false, misread: true, looksLike: null }, combine: { test: t3, level: 'standard', index: 4, void: 'misread' }, t: s3[4].t });
    const retake = shotAt(t3, 4, { t: s3[4].t + 500 });
    s3[4] = misread;
    await api('POST', '/api/shots/sync', { shots: s3.concat([retake]) }, A);
    r = await api('POST', '/api/combine/finish', { test_id: t3, level: 'standard' }, A);
    const voidRow = (await pool.query('SELECT combine FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, misread.cid])).rows[0];
    check('en felmätning får slås om: omslaget räknas och orsaken finns kvar på det ogiltiga slaget', r.status === 200 && r.json.shots[4].shot === retake.cid && voidRow.combine.void === 'misread', JSON.stringify([r.json.shots && r.json.shots[4], voidRow]));

    // a "misread" the device claims, on a shot whose smash factor was fine: the server checks for itself and the retake does not count
    const t3b = 'test3b' + tag;
    let s3b = C.LEVELS.standard.map((D, i) => shotAt(t3b, i));
    const claimed = shotAt(t3b, 4, { ballSpeed: 60, clubSpeed: 75, review: { flags: ['smash_impossible'], mishit: false, misread: true, looksLike: null }, combine: { test: t3b, level: 'standard', index: 4, void: 'misread' }, t: s3b[4].t });
    const claimedRetake = shotAt(t3b, 4, { t: s3b[4].t + 500 });
    s3b[4] = claimed;
    await api('POST', '/api/shots/sync', { shots: s3b.concat([claimedRetake]) }, A);
    r = await api('POST', '/api/combine/finish', { test_id: t3b, level: 'standard' }, A);
    check('servern avgör felmätning själv: en påstådd felmätning med rimlig smash factor får inte slås om', r.status === 200 && r.json.shots[4].shot === claimed.cid, JSON.stringify(r.json.shots && r.json.shots[4]));

    console.log('\n3. Uppskattat ger träningsresultat');
    const t4 = 'test4' + tag;
    const s4 = C.LEVELS.standard.map((D, i) => shotAt(t4, i, i === 3 ? { estimated: ['spinAxisDeg'] } : {}));
    await api('POST', '/api/shots/sync', { shots: s4 }, A);
    r = await api('POST', '/api/combine/finish', { test_id: t4, level: 'standard' }, A);
    check('ett slag med uppskattad spinnaxel: testet räknas men som träning, aldrig officiellt', r.status === 200 && r.json.official === false, JSON.stringify(r.json.official));
    const t5 = 'test5' + tag;
    await api('POST', '/api/shots/sync', { shots: C.LEVELS.standard.map((D, i) => shotAt(t5, i, { raw: { ballSpeedMph: 100 } })) }, A);
    r = await api('POST', '/api/combine/finish', { test_id: t5, level: 'standard' }, A);
    check('slag utan bryggans lista över uppmätta värden (en äldre brygga): bara träning', r.status === 200 && r.json.official === false, JSON.stringify(r.json.official));
    // a result of an older ball flight stays, but is never compared with this flight's
    await pool.query(`INSERT INTO combine_results (player_id, test_id, level, total, official, physics_version, shots, started_at, finished_at) VALUES ($1, $2, 'standard', 99, true, 'flight-2023.0', '{"shots":[],"worst":[]}', now(), now())`, [A.id, 'old' + tag]);
    r = await api('GET', '/api/combine/results', undefined, A);
    check('historiken: bara officiella på samma nivå och samma bollflykt; äldre bollflykt räknas för sig', r.json.levels.standard.count === 4 && r.json.levels.standard.best.total < 99 &&
      r.json.older['flight-2023.0'] === 1 && r.json.levels.advanced.count === 0, JSON.stringify([r.json.levels.standard.count, r.json.levels.standard.best && r.json.levels.standard.best.total, r.json.older]));

    console.log('\n4. Åtkomst och två enheter');
    const u1 = await api('POST', '/api/combine/finish', { test_id: t1, level: 'standard' });
    const u2 = await api('GET', '/api/combine/results', undefined, A, crypto.randomBytes(32).toString('hex'));
    check('utan spelare, eller A:s id utan A:s nyckel: 401', u1.status === 401 && u2.status === 401);
    r = await api('POST', '/api/combine/finish', { test_id: t1, level: 'standard' }, X);
    const xr = await api('GET', '/api/combine/results', undefined, X);
    check('en annan spelare kan inte räkna eller se A:s test', r.status === 409 && xr.json.results.length === 0, JSON.stringify(r));
    const code = (await api('POST', '/api/devices/link-code', {}, A)).json.code;
    await api('POST', '/api/devices/link', { code }, B);
    const ra = await api('GET', '/api/combine/results', undefined, A), rb = await api('GET', '/api/combine/results', undefined, B);
    check('en kopplad andra enhet ser samma resultat', JSON.stringify(ra.json) === JSON.stringify(rb.json));

    console.log('\n5. På rangen');
    browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, rt => { const n = Object.keys(CDN).find(x => rt.request().url().endsWith(x)); if (n) rt.fulfill({ body: fs.readFileSync(CDN[n]), contentType: 'application/javascript' }); else rt.abort(); });
    await ctx.route(/^https:\/\/(?!cdn)/, rt => rt.abort());
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/arcade.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.ShotSync && window.RangeSession && window.CombinePlay && window.GolfAuth && window.GolfAuth.isReady, null, { timeout: 120000 });
    await page.waitForFunction(() => window._courseLoading === false, null, { timeout: 120000 });
    await wait(500);
    const P = await page.evaluate(() => localStorage.getItem('golf_os_device_id'));
    ids.push(P);
    await page.evaluate(() => { window.RangeSession.start({ tee: { x: 0, y: 0, z: 0, rot: 0 }, key: 'E2C-RANGE' }); });
    const clickIn = sel => page.evaluate(s => { const b = document.querySelector('#range-session ' + s); if (!b) throw new Error('no ' + s); b.click(); }, sel);
    // before the test: what an official result needs; a launch monitor that did not send everything is told before the first shot
    await page.evaluate(() => { window.RangeSession.setClub('7i'); window.RangeSession.record({ club: '7i', source: 'LM', carry: 140, total: 147, ballSpeed: 120, clubSpeed: 88, launch: 16, spin: 7000, spinAxis: 0, hla: 0, estimated: ['spinAxisDeg', 'azimDeg'], raw: { measured: ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm'] } }); });
    await clickIn('[data-tab="combine"]');
    const pre = await page.evaluate(() => ({ needs: (document.querySelector('#range-session [data-cb="needs"]') || {}).textContent || '', cannot: (document.querySelector('#range-session [data-cb="cannot"]') || {}).textContent || '' }));
    check('före testet: vilka fem värden som krävs, och att den här launch monitorn inte skickade spinnaxel och startriktning', /spinnaxel/.test(pre.needs) && /spinnaxel/.test(pre.cannot) && /startriktning/.test(pre.cannot), JSON.stringify(pre));
    await clickIn('[data-cb-level="standard"]');
    await clickIn('[data-cb-act="start"]');
    const target = await page.evaluate(() => document.querySelector('#range-session [data-cb="target"] b').textContent);
    check('nivån standard: första målet 30 m (33 yd i yards)', /^(30 m|33 yd)$/.test(target), target);
    const hit = async (o) => {
      const n = await page.evaluate(o => {
        if (!window.RangeSession.active()) return -1;
        const before = window.RangeSession.shots().length;
        window.RangeSession.setClub('7i');
        // the club as the game passes it (arcade.html: RangeSession.clubFor), so the shot's review knows the club
        window.RangeSession.record(Object.assign({ club: window.RangeSession.clubFor('LM', null), source: 'LM', carry: 100, total: 105, launch: 18, spin: 6500, spinAxis: 0, hla: 0, offline: 0,
          raw: { measured: ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm', 'spinAxisDeg', 'azimDeg', 'clubSpeedMph'] } }, o));
        return window.RangeSession.shots().length - before;
      }, o);
      if (n !== 1) throw new Error('test harness: the range session did not record the shot');
    };
    const speeds = [50, 66, 80, 92, 103, 113, 124, 136, 150];
    for (let i = 0; i < 3; i++) await hit({ ballSpeed: speeds[i], clubSpeed: speeds[i] / 1.35 });
    // a misread at target 4: the retake button, then the shot again
    await hit({ ballSpeed: 180, clubSpeed: 90 });
    const retakeBtn = await page.evaluate(() => !!document.querySelector('#range-session [data-cb-act="retake"]'));
    await clickIn('[data-cb-act="retake"]');
    const back = await page.evaluate(() => window.CombinePlay.state().index);
    check('en felmätning: knappen "Slå om" visas och målet kommer tillbaka', retakeBtn && back === 3, JSON.stringify([retakeBtn, back]));
    for (let i = 3; i < 8; i++) await hit({ ballSpeed: speeds[i], clubSpeed: speeds[i] / 1.35 });
    await ctx.setOffline(true);
    await hit({ ballSpeed: speeds[8], clubSpeed: speeds[8] / 1.35 });
    await page.waitForFunction(() => { const s = window.CombinePlay.state(); return s && s.index === 9 && !s.verifying; }, null, { timeout: 60000 });
    const prelim = await page.evaluate(() => ({ note: (document.querySelector('#range-session [data-cb="prelim"]') || {}).textContent || '', total: (document.querySelector('#range-session [data-cb="total"]') || {}).textContent || '' }));
    check('det nionde slaget offline: resultatkortet är preliminärt, med en total', /Preliminärt|Preliminary/.test(prelim.note) && /\d/.test(prelim.total), JSON.stringify(prelim));
    await ctx.setOffline(false);
    await page.waitForFunction(() => { const s = window.CombinePlay.state(); return s && s.result; }, null, { timeout: 90000 });
    const card = await page.evaluate(() => ({ st: window.CombinePlay.state(), badge: (document.querySelector('#range-session .cb-badge') || {}).textContent || '', costly: (document.querySelector('#range-session [data-cb="costly"]') || {}).textContent || '', worst: document.querySelectorAll('#range-session tr.cb-worst').length }));
    const serverRow = (await pool.query('SELECT total, official FROM combine_results WHERE player_id = $1 AND test_id = $2', [P, card.st.test])).rows[0];
    check('tillbaka online: servern räknar testet och kortet visar det officiella resultatet', serverRow && card.st.result.total === serverRow.total && serverRow.official === true && /Officiellt|Official/.test(card.badge), JSON.stringify([card.st.result && card.st.result.total, serverRow, card.badge]));
    check('resultatkortet visar de tre mål som kostade mest', card.worst === 3 && /Kostade mest|Cost the most/.test(card.costly), JSON.stringify(card));
    await page.locator('#cb-overlay .cb-overlay-box').screenshot({ path: path.join(require('os').tmpdir(), 'combine-card.png') }).catch(() => {});
    const ov = await page.evaluate(() => { const o = document.querySelector('#cb-overlay'); return o ? { total: o.querySelector('[data-cb="total"]').textContent, costly: !!o.querySelector('[data-cb="costly"]') } : null; });
    check('resultatkortet visas över rangen, med totalen och de dyraste målen', ov && ov.total.replace(',', '.') === String(card.st.result.total) && ov.costly, JSON.stringify(ov));
    await page.evaluate(() => document.querySelector('#cb-overlay [data-cb-act="close"]').click());
    check('och går att stänga', await page.evaluate(() => !document.querySelector('#cb-overlay')));
    // a late answer never lands in another test: the next test's finish is held back, a new test is started meanwhile
    const firstTest = card.st.test;
    await page.route('**/api/combine/finish', async rt => { await wait(3000); try { await rt.continue(); } catch (e) { /* page moved on */ } });
    await page.evaluate(() => { const s = window.CombinePlay.state(); return s; });
    await clickIn('[data-cb-act="new"]').catch(() => {});
    await clickIn('[data-tab="combine"]').catch(() => {});
    await clickIn('[data-cb-level="standard"]');
    await clickIn('[data-cb-act="start"]');
    for (let i = 0; i < 9; i++) await hit({ ballSpeed: speeds[i], clubSpeed: speeds[i] / 1.35 });
    const testB = await page.evaluate(() => window.CombinePlay.state().test);
    await page.evaluate(() => document.querySelector('#cb-overlay [data-cb-act="new"]').click());
    await clickIn('[data-cb-level="beginner"]');
    await clickIn('[data-cb-act="start"]');
    const testC = await page.evaluate(() => window.CombinePlay.state().test);
    await wait(4500);
    const after = await page.evaluate(() => window.CombinePlay.state());
    check('ett sent svar för ett test skrivs aldrig in i ett nytt test som startats under tiden', after.test === testC && after.level === 'beginner' && !after.result && after.index === 0 && testB !== testC && firstTest !== testB, JSON.stringify([after.test === testC, after.level, after.result, after.index]));
    await page.unroute('**/api/combine/finish');
    const voidShot = (await pool.query("SELECT combine FROM shots WHERE player_id = $1 AND combine->>'test' = $2 AND (combine->>'void') IS NOT NULL", [P, firstTest])).rows;
    check('felmätningen finns kvar i slagbanken, märkt med orsaken', voidShot.length === 1 && voidShot[0].combine.void === 'misread', JSON.stringify(voidShot));

    const lab = await ctx.newPage();
    await lab.goto(BASE + '/training.html', { waitUntil: 'domcontentloaded' });
    await lab.waitForFunction(() => document.querySelector('[data-tl="combine"] [data-cb="latest"]'), null, { timeout: 60000 });
    const labTxt = await lab.evaluate(() => ({ latest: document.querySelector('[data-tl="combine"] [data-level="standard"] [data-cb="latest"]').textContent, best: document.querySelector('[data-tl="combine"] [data-level="standard"] [data-cb="best"]').textContent, bars: document.querySelectorAll('[data-tl="combine"] .tl-cb-bars span').length }));
    const offRows = (await pool.query("SELECT total FROM combine_results WHERE player_id = $1 AND level = 'standard' AND official ORDER BY finished_at", [P])).rows;
    check('Training Lab visar senaste, personbästa och de fem senaste (de två standardtesten på rangen)', offRows.length === 2 && labTxt.latest.replace(',', '.') === offRows[1].total.toFixed(1) &&
      labTxt.best.replace(',', '.') === Math.max(offRows[0].total, offRows[1].total).toFixed(1) && labTxt.bars === 2, JSON.stringify([labTxt, offRows]));
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' failed' : '\nAll combine e2e checks passed');
  process.exit(failed ? 1 : 0);
})();
