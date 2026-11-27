// End-to-end test of the shot bank from the game's own page: the real server.js against a real Postgres, arcade.html in Chromium, two
// devices (two browser contexts, each with its own storage and device token).
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/shots-browser-e2e.js
// Covers: a device's old local shots (range sessions and bag from before the shot bank) go up once; new range shots go up as they are hit;
// offline they wait in the outbox and go when the device is back online; a new range session clears the list but no shot leaves the bank;
// two tabs and reloads store each shot once; a second device joins with a code typed in the panel, then sees the same bag and its shots
// reach the first device; a device that has another device's id but not its token is refused and stores nothing.
// It only touches rows of its own: the browsers' fresh device ids.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  shots browser e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
function need(root, mod) { try { return require(path.join(root, 'node_modules', mod)); } catch (e) { console.error('Missing "' + mod + '". Run: npm install && npm --prefix tests install'); process.exit(2); } }
const { chromium } = need(TESTS, 'playwright-core');
const { Pool } = need(ROOT, 'pg');
const Sync = require(path.join(ROOT, 'shot-sync.js'));
const NM = path.join(TESTS, 'node_modules') + '/';
const CDN = {
  'three.min.js': NM + 'three/build/three.min.js', 'OrbitControls.js': NM + 'three/examples/js/controls/OrbitControls.js',
  'GLTFLoader.js': NM + 'three/examples/js/loaders/GLTFLoader.js', 'DRACOLoader.js': NM + 'three/examples/js/loaders/DRACOLoader.js', 'pako.min.js': NM + 'pako/dist/pako.min.js',
};
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
  let browser = null;
  const ids = [];
  async function cleanup() {
    try { if (ids.length) { await pool.query('DELETE FROM shots WHERE player_id = ANY($1)', [ids]); await pool.query('DELETE FROM device_links WHERE account_id = ANY($1)', [ids]); await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]); } } catch (e) { /* none */ }
    try { if (browser) await browser.close(); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  const count = async id => (await pool.query('SELECT count(*)::int AS n FROM shots WHERE player_id = $1', [id])).rows[0].n;
  try {
    for (let i = 0; i < 60; i++) { try { await new Promise((res, rej) => { http.get(BASE + '/api/health', r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => { (/"db_connected":true/.test(b) && /"schema_ready":true/.test(b)) ? res() : rej(); }); }).on('error', rej); }); break; } catch (e) { await wait(500); if (i === 59) throw new Error('server did not start'); } }
    browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    async function device(seed) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
      await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, r => { const k = Object.keys(CDN).find(n => r.request().url().endsWith(n)); if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort(); });
      await ctx.route(/^https:\/\/(?!cdn)/, r => r.abort());
      // the storage of a device that played before the shot bank (set once, before the first page)
      if (seed) await ctx.addInitScript(s => { if (!localStorage.getItem('e2e_seeded')) { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); localStorage.setItem('e2e_seeded', '1'); } }, seed);
      return ctx;
    }
    async function open(ctx) {
      const page = await ctx.newPage();
      page.on('dialog', d => d.accept());
      await page.goto(BASE + '/arcade.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => window.ShotSync && window.RangeSession && window.GolfAuth && window.GolfAuth.isReady, null, { timeout: 120000 });
      // the range session as on a range (its tee), without playing: the shots go through the same record() the game calls
      await page.evaluate(() => window.RangeSession.start({ tee: { x: 0, y: 0, z: 0, rot: 0 }, key: 'E2E-RANGE' }));
      return page;
    }
    const outbox = page => page.evaluate(() => window.ShotSync.pending());
    const idle = (page, ms) => page.waitForFunction(() => window.ShotSync.pending() === 0, null, { timeout: ms || 30000 }).then(() => true, () => false);
    const hit = (page, o) => page.evaluate(o => { window.RangeSession.setClub(o.club); window.RangeSession.record(Object.assign({ source: 'LM', carry: 150, total: 158, ballSpeed: 120, launch: 16, spin: 7000, spinAxis: 0, hla: 1, clubSpeed: 88, offline: 1 }, o)); }, o);

    // ---- device A: played before the shot bank ----
    const day = 86400000, t0 = Date.now() - 3 * day;
    const seed = {
      golf_range_session_OLDRANGE: JSON.stringify({ shots: [{ t: t0, source: 'LM', club: '7i', carry: 148, total: 156, ballSpeed: 119 }, { t: t0 + 1000, source: 'LM', club: '7i', carry: 151, total: 160, ballSpeed: 121 }, { t: t0 + 2000, source: 'SIM', club: 'Dr', carry: 220, total: 240 }] }),
      golf_bag_v1: JSON.stringify({ shots: [{ t: t0, club: '7i', carry: 148, total: 156 }, { t: t0 - day, club: '5i', carry: 172, total: 181, ballSpeed: 131 }] })
    };
    const ctxA = await device(seed);
    const pageA = await open(ctxA);
    const idA = await pageA.evaluate(() => localStorage.getItem('golf_os_device_id'));
    ids.push(idA);
    console.log('1. Gamla lokala slag');
    check('enhetens gamla slag (tre i en session, ett bagslag vars session rensats) går upp, och utkorgen töms', await idle(pageA) && (await count(idA)) === 4, String(await count(idA)));
    const legacy = (await pool.query('SELECT client_id, range_key FROM shots WHERE player_id = $1 ORDER BY shot_at', [idA])).rows;
    check('med samma id som enheten själv räknar fram, och den range de slogs på', legacy[0].client_id === Sync.legacyCid(idA, t0 - day) && legacy[0].range_key === 'bag' && legacy[1].client_id === Sync.legacyCid(idA, t0) && legacy[1].range_key === 'OLDRANGE', JSON.stringify(legacy));
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA.waitForFunction(() => window.ShotSync && window.GolfAuth && window.GolfAuth.isReady, null, { timeout: 120000 });
    await pageA.evaluate(() => { localStorage.removeItem('golf_shot_legacy_v1'); window.ShotSync.migrate(); return window.ShotSync.flush(); });
    await idle(pageA);
    check('en omladdning, eller de gamla slagen skickade en gång till, lägger inte till något', (await count(idA)) === 4, String(await count(idA)));
    await pageA.evaluate(() => window.RangeSession.start({ tee: { x: 0, y: 0, z: 0, rot: 0 }, key: 'E2E-RANGE' }));

    console.log('\n2. Nya slag, offline och ny session');
    await hit(pageA, { club: '7i' }); await hit(pageA, { club: '7i', carry: 152 });
    check('nya rangeslag går upp när de slås', await idle(pageA) && (await count(idA)) === 6, String(await count(idA)));
    await ctxA.setOffline(true);
    await hit(pageA, { club: 'PW', carry: 110, total: 114, ballSpeed: 100, launch: 24, spin: 9000 });
    await hit(pageA, { club: 'PW', carry: 108, total: 112, ballSpeed: 99, launch: 24, spin: 9100 });
    await hit(pageA, { club: 'PW', carry: 111, total: 115, ballSpeed: 101, launch: 24, spin: 8900 });
    await wait(1500);
    check('offline: slagen väntar i utkorgen, inget går upp', (await outbox(pageA)) === 3 && (await count(idA)) === 6, JSON.stringify([await outbox(pageA), await count(idA)]));
    await pageA.evaluate(() => { document.querySelector('#range-session [data-act="clear"]').click(); });
    await wait(300);
    const cleared = await pageA.evaluate(() => window.RangeSession.shots().length);
    check('en ny session tömmer listan men inte utkorgen', cleared === 0 && (await outbox(pageA)) === 3, JSON.stringify([cleared, await outbox(pageA)]));
    await ctxA.setOffline(false);
    check('tillbaka online: de väntande slagen går upp av sig själva', await idle(pageA, 45000) && (await count(idA)) === 9, String(await count(idA)));
    check('och den nya sessionen tog inte bort något slag ur slagbanken', (await pool.query("SELECT count(*)::int AS n FROM shots WHERE player_id = $1 AND range_key = 'E2E-RANGE'", [idA])).rows[0].n === 5);

    console.log('\n3. Två flikar');
    const pageA2 = await open(ctxA);
    await ctxA.setOffline(true);
    await hit(pageA, { club: '9i', carry: 128, total: 133, ballSpeed: 108 });
    await hit(pageA2, { club: '9i', carry: 129, total: 134, ballSpeed: 109 });
    await ctxA.setOffline(false);
    await Promise.all([pageA.evaluate(() => window.ShotSync.flush()), pageA2.evaluate(() => window.ShotSync.flush()), pageA.evaluate(() => window.ShotSync.flush())]);
    await idle(pageA); await idle(pageA2);
    const dups = (await pool.query('SELECT client_id, count(*)::int AS n FROM shots WHERE player_id = $1 GROUP BY client_id HAVING count(*) > 1', [idA])).rows;
    check('två flikar som skickar samtidigt: varje slag en gång', (await count(idA)) === 11 && dups.length === 0, JSON.stringify([await count(idA), dups]));
    await pageA2.close();

    console.log('\n4. En andra enhet');
    const ctxB = await device(null);
    const pageB = await open(ctxB);
    const idB = await pageB.evaluate(() => localStorage.getItem('golf_os_device_id'));
    ids.push(idB);
    await hit(pageB, { club: '4i', carry: 180, total: 190, ballSpeed: 136, launch: 12, spin: 4800, clubSpeed: 96 });
    await idle(pageB);
    const code = (await pageA.evaluate(() => window.ShotSync.linkCode())).code;
    await pageB.evaluate(() => { document.querySelector('#range-session [data-act="bank"]').click(); });
    await pageB.waitForSelector('#rs-bank-input', { timeout: 10000 });
    await pageB.fill('#rs-bank-input', code.slice(0, 4).toLowerCase() + ' ' + code.slice(4));
    await pageB.evaluate(() => { document.querySelector('#range-session [data-act="bank-link"]').click(); });
    await pageB.waitForFunction(() => { const m = document.querySelector('#range-session .rs-bank-msg'); return m && /Kopplad|Linked/.test(m.textContent); }, null, { timeout: 15000 }).catch(() => {});
    const msg = await pageB.evaluate(() => (document.querySelector('#range-session .rs-bank-msg') || {}).textContent || '');
    check('B kopplas med koden från A, inskriven i panelen; B:s eget slag följer med', /12/.test(msg) && (await count(idA)) === 12 && (await count(idB)) === 0, JSON.stringify([msg, await count(idA), await count(idB)]));
    const clubsB = await pageB.evaluate(() => window.PlayerBag.clubs().map(r => r.club + ':' + r.n).join());
    check('B:s bag är nu spelarens: A:s 7-järn och PW, B:s 4-järn', /7i:\d/.test(clubsB) && /PW:3/.test(clubsB) && /4i:1/.test(clubsB), clubsB);
    await hit(pageB, { club: 'Dr', carry: 230, total: 250, ballSpeed: 160, launch: 11, spin: 2600, clubSpeed: 108 });
    await idle(pageB);
    await pageA.evaluate(() => window.ShotSync.refreshBag());
    const clubsA = await pageA.evaluate(() => window.PlayerBag.clubs().map(r => r.club + ':' + r.n).join());
    check('ett slag från B syns i A:s bag', /Dr:1/.test(clubsA) && /4i:1/.test(clubsA) && (await count(idA)) === 13, clubsA);
    const reused = await pageB.evaluate(c => fetch('/api/devices/link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': window.GolfAuth.userId }, body: JSON.stringify({ code: c }) }).then(r => r.status), code);
    check('koden går inte att använda igen (404)', reused === 404, String(reused));

    console.log('\n5. Någon annans id');
    const ctxC = await device({ golf_os_device_id: idA });   // A's id, but this browser has its own token
    const pageC = await open(ctxC);
    await hit(pageC, { club: 'SW', carry: 70, total: 72 });
    await wait(2500);
    const st = await pageC.evaluate(() => window.ShotSync.status());
    const read = await pageC.evaluate(() => fetch('/api/shots', { headers: { 'x-user-id': window.GolfAuth.userId } }).then(r => r.status));
    const bagRead = await pageC.evaluate(() => fetch('/api/bag', { headers: { 'x-user-id': window.GolfAuth.userId } }).then(r => r.status));
    check('en enhet med A:s id men utan A:s nyckel: varken skrivs, läses eller ser bagen (401), slaget stannar i dess utkorg', st.blocked === true && st.pending === 1 && read === 401 && bagRead === 401 && (await count(idA)) === 13,
      JSON.stringify([st, read, bagRead, await count(idA)]));
    const clubsC = await pageC.evaluate(() => window.PlayerBag.clubs().map(r => r.club).join());
    check('och får inte A:s bag', clubsC.indexOf('7i') < 0 && clubsC.indexOf('4i') < 0, clubsC);
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' failed' : '\nAll shot bank browser e2e checks passed');
  process.exit(failed ? 1 : 0);
})();
