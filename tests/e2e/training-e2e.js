// End-to-end test of Training Lab · Club Intelligence: the real server.js against a real Postgres, training.html in Chromium, two devices.
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/training-e2e.js
// Covers: known shots give the known numbers on the page (carry, spread, mishit rate, ball speed, spin, shots); shots hit offline are not
// in the numbers until sent, then are, once; sending the same shots again counts nothing twice; too few shots are flagged; the periods;
// a second device joined to the bank shows exactly the same; the API answers only the player's own device. Only rows of its own.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  training e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
function need(root, mod) { try { return require(path.join(root, 'node_modules', mod)); } catch (e) { console.error('Missing "' + mod + '". Run: npm install && npm --prefix tests install'); process.exit(2); } }
const { chromium } = need(TESTS, 'playwright-core');
const { Pool } = need(ROOT, 'pg');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'physics-validation', 'physics-version.json'), 'utf8')).version;
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
  try {
    for (let i = 0; i < 60; i++) { try { await new Promise((res, rej) => { http.get(BASE + '/api/health', r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => { (/"db_connected":true/.test(b) && /"schema_ready":true/.test(b)) ? res() : rej(); }); }).on('error', rej); }); break; } catch (e) { await wait(500); if (i === 59) throw new Error('server did not start'); } }
    browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
    async function device() {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
      await ctx.route(/^https:\/\//, r => r.abort());
      const page = await ctx.newPage();
      page.on('dialog', d => d.accept());
      await page.goto(BASE + '/training.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.TrainingLab && window.GolfAuth && window.GolfAuth.isReady && window.ShotSync, null, { timeout: 60000 });
      const id = await page.evaluate(() => localStorage.getItem('golf_os_device_id'));
      ids.push(id);
      return { ctx, page, id };
    }
    const DAY = 86400000, now = Date.now(), S1 = 'sessOLD' + crypto.randomBytes(3).toString('hex'), S2 = 'sessNEW' + crypto.randomBytes(3).toString('hex');
    let k = 0;
    const shot = o => Object.assign({ cid: 'tl' + crypto.randomBytes(6).toString('hex') + (++k), t: now - 2 * DAY + k * 1000, source: 'LM', club: '7i', ballSpeed: 120, launch: 16, spin: 7000, clubSpeed: 89,
                                      carry: 150, total: 158, carryStd: 150, totalStd: 158, offlineStd: 0, physics: VERSION, session: S2 }, o);
    // the known shots: 15 clean 7-irons now (carry 140..154, side -7..+7, ball speed 118..122), 5 more hit offline (carry 155..159, side ±8, ±9),
    // 5 clean 7-irons 40 days ago (carry 130..134), 2 mishits and a wrong-club shot now, 3 PW shots, a swing-meter shot
    const now15 = Array.from({ length: 15 }, (_, i) => shot({ carryStd: 140 + i, offlineStd: -7 + i, ballSpeed: 118 + (i % 5) }));
    const offline5 = [155, 156, 157, 158, 159].map((c, i) => shot({ carryStd: c, offlineStd: [8, -8, 9, -9, 0][i], ballSpeed: 120 }));
    const old5 = Array.from({ length: 5 }, (_, i) => shot({ t: now - 40 * DAY + i * 1000, carryStd: 130 + i, offlineStd: i % 2 ? 10 : -10, ballSpeed: 116, session: S1 }));
    const odd = [shot({ carryStd: 60, ballSpeed: 70, review: { flags: ['topped'], mishit: true, misread: false, looksLike: null } }),
                 shot({ carryStd: 90, ballSpeed: 90, review: { flags: ['thin'], mishit: true, misread: false, looksLike: null } }),
                 shot({ carryStd: 175, ballSpeed: 133, review: { flags: ['wrong_club'], mishit: false, misread: false, looksLike: '5i' } }),
                 shot({ club: 'PW', carryStd: 110 }), shot({ club: 'PW', carryStd: 112 }), shot({ club: 'PW', carryStd: 111 }), shot({ source: 'SIM', carryStd: 160 })];

    console.log('1. Kända slag på sidan');
    const A = await device();
    await A.page.evaluate(list => { list.forEach(s => window.ShotSync.enqueue(s)); }, now15.concat(old5, odd));
    await A.page.waitForFunction(() => window.ShotSync.pending() === 0, null, { timeout: 60000 });
    // offlineStd: five more shots wait; the page shows the numbers without them, and says so
    await A.ctx.setOffline(true);
    await A.page.evaluate(list => { list.forEach(s => window.ShotSync.enqueue(s)); }, offline5);
    await A.ctx.setOffline(false);
    await A.ctx.setOffline(true);
    await A.page.evaluate(() => window.TrainingLab.load());
    const offText = await A.page.evaluate(() => document.getElementById('tl-main').textContent);
    check('offlineStd: sidan säger att servern inte nås och att 5 slag väntar', /5 slag väntar/.test(offText) && /Servern går inte att nå/.test(offText), offText.slice(0, 200));
    await A.ctx.setOffline(false);
    await A.page.evaluate(() => window.TrainingLab.load());
    await A.page.waitForFunction(() => window.TrainingLab.data() && window.ShotSync.pending() === 0, null, { timeout: 60000 });
    const d = await A.page.evaluate(() => window.TrainingLab.data());
    const c7 = d.clubs.filter(c => c.club === '7i')[0];
    // 20 clean shots now: carry 140..159 -> median 149.5; mishits 2 of 22 reviewed (the wrong-club shot does not count)
    check('7-järnet: 22 granskade slag, 20 giltiga, felträffar 2 av 22 (fel klubba räknas inte)', c7.now.shots === 22 && c7.now.valid === 20 && Math.abs(c7.now.mishitRate - 2 / 22) < 1e-9, JSON.stringify(c7.now));
    check('carry: median 149,5 m av de 20 giltiga slagen; offlineslagen är med efter synk', c7.now.carry.n === 20 && c7.now.carry.median === 149.5, JSON.stringify(c7.now.carry));
    check('förändring mot de 30 dagarna före: +17,5 m (medianen 132 då)', Math.abs(c7.change.carry - 17.5) < 1e-6, JSON.stringify(c7.change));
    const kpis = await A.page.evaluate(() => Array.from(document.querySelectorAll('.tl-kpi')).map(e => e.dataset.kpi + ':' + e.querySelector('.tl-kpi-value').textContent));
    check('sidan visar 7-järnets nyckeltal: 149,5 m carry, 9 % felträffar, 20 giltiga av 22', kpis.indexOf('carry:149,5 m') >= 0 && kpis.indexOf('mishit:9 %') >= 0 && kpis.some(x => /^shots:20 giltiga av 22/.test(x)), JSON.stringify(kpis));
    const notes = await A.page.evaluate(() => document.querySelector('.tl-notes').textContent);
    check('sidan säger vad som är uppmätt och vad som är bollflykt (med version), och vad som inte räknas', notes.indexOf(window_version()) >= 0 && /1 svingmätarslag/.test(notes), notes);
    function window_version() { return VERSION; }

    console.log('\n2. Dubbletter och för få slag');
    await A.page.evaluate(list => { list.forEach(s => window.ShotSync.enqueue(Object.assign({}, s))); }, now15.concat(offline5));
    await A.page.waitForFunction(() => window.ShotSync.pending() === 0, null, { timeout: 60000 });
    await A.page.evaluate(() => window.TrainingLab.load());
    await A.page.waitForFunction(() => window.TrainingLab.data(), null, { timeout: 30000 });
    const d2 = await A.page.evaluate(() => window.TrainingLab.data());
    check('samma slag skickade igen räknas inte två gånger', JSON.stringify(d2.clubs) === JSON.stringify(d.clubs), JSON.stringify(d2.clubs[0].now));
    await A.page.click('.tl-clubs [data-club="PW"]');
    const pw = await A.page.evaluate(() => ({ warn: Array.from(document.querySelectorAll('.tl-kpi .tl-warn')).map(e => e.textContent), change: document.querySelectorAll('.tl-kpi-change').length }));
    check('PW med 3 slag: varning "För få slag (3)" och ingen förändring visas', pw.warn.some(w => /För få slag \(3\)/.test(w)) && pw.change === 0, JSON.stringify(pw));

    console.log('\n3. Perioder');
    await A.page.click('.tl-periods [data-period="all"]');
    await A.page.waitForFunction(() => window.TrainingLab.data() && window.TrainingLab.data().period === 'all', null, { timeout: 30000 });
    let p = await A.page.evaluate(() => window.TrainingLab.data().clubs.filter(c => c.club === '7i')[0]);
    check('hela historiken: 25 giltiga 7-järn, ingen jämförelse', p.now.valid === 25 && p.change === null, JSON.stringify(p.now));
    await A.page.click('.tl-periods [data-period="session"]');
    await A.page.waitForFunction(() => window.TrainingLab.data() && window.TrainingLab.data().period === 'session', null, { timeout: 30000 });
    p = await A.page.evaluate(() => window.TrainingLab.data().clubs.filter(c => c.club === '7i')[0]);
    check('senaste passet jämförs med passet före (pass-id från slagbanken)', p.session === S2 && p.now.valid === 20 && p.before && p.before.valid === 5 && Math.abs(p.change.carry - 17.5) < 1e-6, JSON.stringify([p.session, p.now.valid, p.before && p.before.valid]));
    // a slow answer for one period must never show under another: 30 days is answered late, "all" is picked meanwhile
    await A.page.route(/\/api\/training\/clubs\?period=30d/, async r => { await wait(3000); try { await r.continue(); } catch (e) { /* page moved on */ } });
    await A.page.click('.tl-periods [data-period="30d"]');
    await wait(300);
    await A.page.click('.tl-periods [data-period="all"]');
    await wait(4500);
    const shown = await A.page.evaluate(() => ({ period: window.TrainingLab.data() && window.TrainingLab.data().period, pressed: document.querySelector('.tl-periods [aria-pressed="true"]').dataset.period }));
    check('ett sent svar för en tidigare vald period ersätter aldrig den valda', shown.period === 'all' && shown.pressed === 'all', JSON.stringify(shown));
    await A.page.unroute(/\/api\/training\/clubs\?period=30d/);
    await A.page.click('.tl-periods [data-period="30d"]');
    await A.page.waitForFunction(() => window.TrainingLab.data() && window.TrainingLab.data().period === '30d', null, { timeout: 30000 });
    await A.page.click('.tl-clubs [data-club="7i"]');
    await A.page.screenshot({ path: path.join(require('os').tmpdir(), 'training-e2e.png'), fullPage: true }).catch(() => {});

    console.log('\n4. En andra enhet');
    const B = await device();
    const code = (await A.page.evaluate(() => window.ShotSync.linkCode())).code;
    await B.page.evaluate(c => window.ShotSync.link(c), code);
    await B.page.evaluate(() => { localStorage.setItem('golf_training_period', '30d'); localStorage.setItem('golf_training_club', '7i'); });
    await B.page.reload({ waitUntil: 'domcontentloaded' });
    await B.page.waitForFunction(() => window.TrainingLab && window.TrainingLab.data(), null, { timeout: 60000 });
    const dB = await B.page.evaluate(() => window.TrainingLab.data());
    check('enhet B visar samma statistik som A', JSON.stringify(dB.clubs) === JSON.stringify(d.clubs), JSON.stringify(dB.clubs[0] && dB.clubs[0].now));
    const kpisB = await B.page.evaluate(() => Array.from(document.querySelectorAll('.tl-kpi')).map(e => e.dataset.kpi + ':' + e.querySelector('.tl-kpi-value').textContent));
    const kpisA = await A.page.evaluate(() => Array.from(document.querySelectorAll('.tl-kpi')).map(e => e.dataset.kpi + ':' + e.querySelector('.tl-kpi-value').textContent));
    check('och samma nyckeltal på sidan', JSON.stringify(kpisA) === JSON.stringify(kpisB), JSON.stringify([kpisA, kpisB]));

    console.log('\n5. Bara spelarens egen enhet');
    const r1 = await fetch(BASE + '/api/training/clubs');
    const r2 = await fetch(BASE + '/api/training/clubs', { headers: { 'x-user-id': A.id, 'x-user-token': crypto.randomBytes(32).toString('hex') } });
    check('utan spelare, eller med A:s id utan A:s nyckel: 401', r1.status === 401 && r2.status === 401, JSON.stringify([r1.status, r2.status]));
    const C = await device();
    await C.page.waitForFunction(() => window.TrainingLab.data() || window.TrainingLab.state().error, null, { timeout: 60000 });
    const dC = await C.page.evaluate(() => window.TrainingLab.data());
    const emptyText = await C.page.evaluate(() => document.getElementById('tl-main').textContent);
    check('en annan spelare ser inga av A:s slag, och sidan säger hur slag kommer hit', dC && dC.clubs.length === 0 && dC.total === 0 && /Slå några slag/.test(emptyText), JSON.stringify([dC && dC.clubs.length, emptyText.slice(0, 120)]));
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' failed' : '\nAll training e2e checks passed');
  process.exit(failed ? 1 : 0);
})();
