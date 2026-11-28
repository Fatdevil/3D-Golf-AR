// End-to-end test of the Golf Combine validation: the real server.js against a real Postgres, over HTTP and in training.html (Chromium).
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/validation-e2e.js
// Covers: the launch monitor's own carry that comes with a shot is kept apart (shot_references), in its unit and in metres, written once; a
// malformed one never refuses the shot; a CSV from a launch monitor app is matched only where it is certain (mixed units, L/R sides, shot
// numbers), the rest reported with its reason, and importing it again stores nothing twice; another player's shots are never matched; the
// diagnosis compares radial carry with radial carry and side with side, flags estimated, unproven and older-flight shots, works a Combine test
// out again; it and the import change no shot and no result; the CSV and JSON export; linking devices takes the references along. In the
// page: the validation card, an import from a file, and both downloads.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  validation e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
function need(root, mod) { try { return require(path.join(root, 'node_modules', mod)); } catch (e) { console.error('Missing "' + mod + '". Run: npm install && npm --prefix tests install'); process.exit(2); } }
const { chromium } = need(TESTS, 'playwright-core');
const { Pool } = need(ROOT, 'pg');
const C = require(path.join(ROOT, 'combine-core.js'));
const SP = require(path.join(ROOT, 'server-physics.js'));
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { const b = '/opt/pw-browsers'; const d = fs.readdirSync(b).filter(n => /^chromium-\d+$/.test(n)).sort().pop(); if (d) return path.join(b, d, 'chrome-linux', 'chrome'); } catch (e) { /* none */ }
  return undefined;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, e) => typeof a === 'number' && Math.abs(a - b) <= (e === undefined ? 0.02 : e);
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) failed++; }

(async function () {
  const pool = new Pool({ connectionString: URL_DB });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const BASE = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: URL_DB, RATE_LIMIT_WRITES: '100000', RATE_LIMIT_REGISTER: '100000' }), stdio: 'ignore' });
  const tag = 'E2V' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const ids = [];
  let browser = null;
  async function cleanup() {
    try { if (ids.length) for (const t of ['shots', 'combine_results', 'shot_references']) await pool.query('DELETE FROM ' + t + ' WHERE player_id = ANY($1)', [ids]); await pool.query('DELETE FROM device_links WHERE account_id = ANY($1)', [ids]); await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]); } catch (e) { /* none */ }
    try { if (browser) await browser.close(); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  const device = name => { const d = { id: 'e2v-' + name + '-' + tag, token: crypto.randomBytes(32).toString('hex') }; ids.push(d.id); return d; };
  async function api(method, url, body, dev, raw) {
    const h = { 'Content-Type': 'application/json' };
    if (dev) { h['x-user-id'] = dev.id; h['x-user-token'] = dev.token; }
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (raw) return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
    let json = null; try { json = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, json: json || {} };
  }
  const refsOf = async (player) => (await pool.query('SELECT * FROM shot_references WHERE player_id = $1 ORDER BY shot_client_id, origin', [player])).rows;
  const snapshot = async (player) => JSON.stringify([(await pool.query('SELECT * FROM shots WHERE player_id = $1 ORDER BY id', [player])).rows, (await pool.query('SELECT * FROM combine_results WHERE player_id = $1 ORDER BY id', [player])).rows]);
  const T0 = Date.now() - 2 * 86400000;
  let k = 0;
  const shot = o => Object.assign({ cid: 'va' + tag + String(++k).padStart(4, '0'), t: T0 + k * 60000, source: 'LM', club: '7i', ballSpeed: 120, launch: 16, spin: 7000, spinAxis: 3, hla: 1.5,
    clubSpeed: 88, carryStd: 150, offlineStd: 2, raw: { measured: C.NEEDED.slice(), shotNumber: k }, estimated: [], physics: SP.version(), session: 'sessVA' + tag }, o || {});
  try {
    for (let i = 0; i < 60; i++) { try { await new Promise((res, rej) => { http.get(BASE + '/api/health', r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => { /"schema_ready":true/.test(b) ? res() : rej(); }); }).on('error', rej); }); break; } catch (e) { await wait(500); if (i === 59) throw new Error('server did not start'); } }
    const A = device('a'), B = device('b'), X = device('x');
    for (const d of [A, B, X]) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': d.id, 'x-user-token': d.token }, body: JSON.stringify({ device_id: d.id }) });

    console.log('1. Launch monitorns egen carry med slaget');
    const live = shot({ ref: { source: 'gspro-openconnect', quality: 'lm_calculated', carry: { value: 165.0, unit: 'yd' } } });
    const badRef = shot({ ballSpeed: 100, ref: { source: 'gspro-openconnect', quality: 'lm_calculated', carry: { value: 9999, unit: 'yd' } } });
    const plain = shot({ ballSpeed: 90, launch: 22, spin: 8000 });
    let r = await api('POST', '/api/shots/sync', { shots: [live, badRef, plain] }, A);
    check('slagen sparas, också det med en orimlig referens', r.status === 200 && r.json.stored.length === 3 && !r.json.refused.length, JSON.stringify(r.json));
    let refs = await refsOf(A.id);
    check('en referens: carry i meter och som den kom (165 yd), LM-beräknad, från bryggan', refs.length === 1 && refs[0].shot_client_id === live.cid && near(refs[0].carry_m, 165 / 1.09361) &&
      refs[0].orig.carry.value === 165 && refs[0].orig.carry.unit === 'yd' && refs[0].origin === 'live' && refs[0].quality === 'lm_calculated', JSON.stringify(refs));
    check('saknad total och sidled förblir null', refs[0].total_m === null && refs[0].side_m === null);
    r = await api('POST', '/api/shots/sync', { shots: [Object.assign({}, live, { edited: live.t + 5000, ref: { source: 'gspro-openconnect', quality: 'lm_calculated', carry: { value: 120, unit: 'yd' } } })] }, A);
    refs = await refsOf(A.id);
    check('samma slag igen med en annan referens: den första står kvar (skrivs en gång)', refs.length === 1 && refs[0].orig.carry.value === 165, JSON.stringify(refs.map(x => x.orig)));
    const before = (await pool.query('SELECT carry_std FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, live.cid])).rows[0];
    check('referensen ändrar inte slaget (spelets carry står kvar)', before && near(before.carry_std, 150));

    console.log('\n2. Import av CSV från launch monitorns app');
    // three more shots the file has: two with the same launch values (only the shot number tells them apart), and one the file lacks
    const s1 = shot({ ballSpeed: 110.0, launch: 18.0, spin: 7400, hla: -1.0 });
    const s2 = shot({ ballSpeed: 130.0, launch: 14.0, spin: 6100, hla: 2.0, clubSpeed: 96 });
    const s3 = shot({ ballSpeed: 130.0, launch: 14.0, spin: 6100, hla: 2.0, clubSpeed: 96 });
    const s4 = shot({ ballSpeed: 105.0, launch: 19.0, spin: 7800, hla: 0.5 });
    const s5 = shot({ ballSpeed: 105.0, launch: 19.0, spin: 7800, hla: 0.5 });
    const older = shot({ ballSpeed: 101, launch: 20, spin: 8200, raw: undefined, physics: 'flight-2023.0' });
    await api('POST', '/api/shots/sync', { shots: [s1, s2, s3, s4, s5, older] }, A);
    const snapA = await snapshot(A.id);
    // the app's export: ball speed in m/s, carry in metres, side in yards with L/R; rows for s1, for s4/s5 (the same values and no shot number:
    // ambiguous), for s2 by its shot number (s3 has the same values), one the bank does not have, and the older shot (no start line in the file)
    const ms = v => (v / 2.23694).toFixed(2);
    const csv = 'Shot;Club;Ball Speed (m/s);Launch Angle;Spin Rate;Launch Direction;Carry (m);Total (m);Carry Deviation (yds)\n' +
      `${s1.raw.shotNumber};7i;${ms(110)};18,0;7400;-1,0;141,2;150,0;3,5 R\n` +
      `;7i;${ms(105)};19,0;7800;0,5;150,0;160,0;2,0 L\n` +
      `${s2.raw.shotNumber};7i;${ms(130)};14,0;6100;2,0;158,4;169,0;1,0 L\n` +
      `99;7i;${ms(150)};11,0;3000;0,0;190,0;210,0;0\n` +
      `77;7i;${ms(101)};20,0;8200;;120,0;;\n`;
    const body = { csv: csv, source: 'Garmin R10 (app)', quality: 'lm_calculated', sideSign: 'right_positive', from: new Date(T0 - 3600000).toISOString(), to: new Date().toISOString() };
    r = await api('POST', '/api/references/import', body, A);
    check('importen läser fem rader och sparar tre säkra matchningar', r.status === 200 && r.json.rows === 5 && r.json.stored === 3 && r.json.matched === 3, JSON.stringify(r.json));
    const un = (r.json.unmatched || []).map(u => u.line + ':' + u.reason).sort().join(',');
    check('raden utan slagnummer med två möjliga slag och raden slagbanken saknar matchas inte, med skäl', un === '3:ambiguous,5:no_candidate', un);
    refs = (await refsOf(A.id)).filter(x => x.origin === 'import');
    const of = cid => refs.find(x => x.shot_client_id === cid);
    check('blandade enheter: carry i meter rakt av, sidled i yards blir meter, "3,5 R" är höger', of(s1.cid) && near(of(s1.cid).carry_m, 141.2) && near(of(s1.cid).side_m, 3.5 / 1.09361) &&
      of(s1.cid).orig.side.unit === 'yd' && of(s1.cid).orig.carry.unit === 'm' && near(of(s1.cid).total_m, 150), JSON.stringify(of(s1.cid)));
    check('slagnumret skiljer två slag med samma värden: rätt slag får referensen, "1,0 L" är vänster', of(s2.cid) && near(of(s2.cid).carry_m, 158.4) && of(s2.cid).side_m < 0 && !of(s3.cid) && !of(s4.cid) && !of(s5.cid), JSON.stringify(refs.map(x => x.shot_client_id)));
    check('ett äldre slag (utan rådata, äldre bollflykt) får sin referens, också från en numrerad rad', of(older.cid) && near(of(older.cid).carry_m, 120) && of(older.cid).total_m === null);
    r = await api('POST', '/api/references/import', body, A);
    check('samma fil igen: inget sparas två gånger', r.status === 200 && r.json.stored === 0 && r.json.already === 3 && (await refsOf(A.id)).length === 4, JSON.stringify(r.json));
    r = await api('POST', '/api/references/import', Object.assign({}, body, { csv: 'Ball Speed,Launch Angle,Spin Rate,Carry\n120,16,7000,150\n' }), A);
    check('en fil utan avståndsenhet avvisas (422, ingen gissning)', r.status === 422 && r.json.refused === 'unknown_distance_unit', JSON.stringify(r.json));
    r = await api('POST', '/api/references/import', Object.assign({}, body, { quality: 'guess' }), A);
    check('okänd kvalitet: 400', r.status === 400);
    r = await api('POST', '/api/references/import', body, null);
    check('utan enhet: 401', r.status === 401);
    r = await api('POST', '/api/references/import', body, X);
    check('en annan spelares import matchar aldrig dessa slag', r.status === 200 && r.json.stored === 0 && r.json.shots_in_span === 0 && (await refsOf(X.id)).length === 0, JSON.stringify(r.json));
    check('importen ändrade inget slag och inget resultat', (await snapshot(A.id)) === snapA);

    console.log('\n3. Diagnosen');
    // a Golf Combine test in the same bank: nine measured shots, finished
    const SPEED = { 30: 50, 50: 66, 70: 80, 90: 92, 110: 103, 130: 113, 150: 124, 170: 136, 190: 150 };
    const test = 'testVA' + tag;
    const nine = C.LEVELS.standard.map((D, i) => shot({ ballSpeed: SPEED[D], launch: 18, spin: 6500, spinAxis: 0, hla: 0, clubSpeed: SPEED[D] / 1.35, combine: { test: test, level: 'standard', index: i } }));
    await api('POST', '/api/shots/sync', { shots: nine }, A);
    const fin = await api('POST', '/api/combine/finish', { test_id: test, level: 'standard' }, A);
    const snapB = await snapshot(A.id);
    r = await api('GET', '/api/diagnostics', undefined, A);
    const dg = r.json, byCid = {};
    (dg.shots || []).forEach(d => { byCid[d.cid] = d; });
    check('diagnosen har slagen, testen, sammanfattningen, fysikversionen och konventionerna', r.status === 200 && dg.physics === SP.version() && dg.shots.length === 18 && dg.tests.length === 1 &&
      dg.summary && /right positive/.test(dg.conventions.side) && /radial/.test(dg.conventions.carry), JSON.stringify(Object.keys(dg)));
    const d1 = byCid[s1.cid], st1 = SP.standard(s1);
    check('carry jämförs radiell mot radiell: serverns carry minus referensens', d1 && near(d1.ours.carry, st1.carry) && near(d1.refs[0].delta.carry, st1.carry - 141.2, 0.03), JSON.stringify(d1 && d1.refs));
    check('sidled jämförs med sidled vid landning, i meter', d1 && near(d1.refs[0].delta.side, st1.side - 3.5 / 1.09361, 0.03));
    check('längs mållinjen visas för sig (Combine-poängens storhet)', d1 && near(d1.ours.along, st1.along) && d1.ours.along < d1.ours.carry);
    const dl = byCid[live.cid];
    check('referensen från bryggan visas med ursprung och kvalitet', dl && dl.refs.length === 1 && dl.refs[0].origin === 'live' && dl.refs[0].quality === 'lm_calculated');
    const dold = byCid[older.cid];
    check('ett äldre slag: obevisat (ingen mätlista), äldre bollflykt markerad, inte jämfört', dold && dold.status === 'unproven' && !dold.physics.same && !dold.comparable);
    check('ett slag utan referens fungerar (tom lista)', byCid[plain.cid] && byCid[plain.cid].refs.length === 0);
    const sm = dg.summary;
    check('sammanfattningen: LM-beräknad, med carryfel per band, och det som inte jämförs räknat', sm.references.lm_calculated && sm.references.lm_calculated.length >= 1 && sm.excluded.unproven === 1 && sm.compared === 3,
      JSON.stringify(sm.excluded) + ' ' + sm.compared);
    const td = dg.tests[0];
    check('testet räknas om och stämmer med det sparade', fin.status === 200 && td.test === test && td.complete && td.official && td.stored && td.stored.sameTotal && td.stored.samePhysics && td.total === fin.json.total, JSON.stringify(td.stored));
    r = await api('GET', '/api/diagnostics?test=' + test, undefined, A);
    check('ett test för sig: bara dess nio slag', r.status === 200 && r.json.shots.length === 9 && r.json.tests.length === 1);
    check('diagnosen ändrade inget slag och inget resultat', (await snapshot(A.id)) === snapB);
    r = await api('GET', '/api/diagnostics', undefined, X);
    check('en annan spelare ser inga av dessa slag', r.status === 200 && r.json.shots.length === 0);
    r = await api('GET', '/api/diagnostics', undefined, null);
    check('utan enhet: 401', r.status === 401);
    r = await api('GET', '/api/diagnostics?from=2020-01-01&to=2026-01-01T00:00:00Z&x=1', undefined, A);
    check('en tidsperiod längre än 400 dagar avvisas', r.status === 400);

    console.log('\n4. Export');
    const csvOut = await api('GET', '/api/diagnostics?format=csv', undefined, A, true);
    const lines = csvOut.text.trim().split('\n'), head = lines[0].split(',');
    check('CSV: rätt typ, rubrik med enheter och en rad per slag och referens', csvOut.status === 200 && /text\/csv/.test(csvOut.type) && head.indexOf('delta_carry_m') >= 0 && head.indexOf('ref_side_m_R') >= 0 &&
      lines.length === 1 + 18, lines.length + ' ' + csvOut.type);
    const row1 = lines.find(l => l.startsWith(s1.cid + ','));
    check('CSV: referensen som den kom och skillnaden', row1 && row1.indexOf('141.2 m') >= 0 && row1.indexOf('Garmin R10 (app)') >= 0, row1);
    const xcsv = await api('GET', '/api/diagnostics?format=csv', undefined, X, true);
    check('CSV: en annan spelare får bara rubriken', xcsv.text.trim().split('\n').length === 1);

    console.log('\n5. Koppla enheter');
    const b1 = shot({ ballSpeed: 95, launch: 21, spin: 8100, ref: { source: 'gspro-openconnect', quality: 'lm_calculated', carry: { value: 128, unit: 'yd' } } });
    await api('POST', '/api/shots/sync', { shots: [b1] }, B);
    const code = await api('POST', '/api/devices/link-code', {}, A);
    r = await api('POST', '/api/devices/link', { code: code.json.code }, B);
    const moved = await refsOf(A.id);
    check('B går med i A:s konto: B:s referenser följer med', r.status === 200 && moved.some(x => x.shot_client_id === b1.cid) && (await refsOf(B.id)).length === 0, JSON.stringify(r.json));
    r = await api('GET', '/api/diagnostics', undefined, B);
    check('B ser hela kontots diagnos, med sin referens', r.status === 200 && r.json.shots.some(d => d.cid === b1.cid && d.refs.length === 1) && r.json.shots.length === 19);

    console.log('\n6. Training Lab');
    browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route(/^https:\/\//, rt => rt.abort());
    await ctx.addInitScript(d => { try { localStorage.setItem('golf_os_device_id', d.id); localStorage.setItem('golf_os_device_token', d.token); } catch (e) { /* none */ } }, A);
    const page = await ctx.newPage();
    await page.goto(BASE + '/training.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-tl="validation"]'), null, { timeout: 60000 });
    const card = await page.evaluate(() => document.querySelector('[data-tl="validation"]').innerText);
    check('kortet visar jämförelsen mot launch monitorns egen beräkning, och det som inte jämförs', /launch monitorns egen beräkning/.test(card) && /utan bryggans mätlista/.test(card), card.slice(0, 600));
    // the import from a file, in the page: s3's own row (by its shot number) makes it certain
    const file = 'Shot,Ball Speed (mph),Launch Angle,Spin Rate,Carry (yds),Offline (yds)\n' + s3.raw.shotNumber + ',130.0,14.0,6100,172.0,-1.5\n';
    await page.evaluate(() => { document.querySelector('.tl-va-import').open = true; });
    await page.setInputFiles('[data-va="import"] input[type=file]', { name: 'r10.csv', mimeType: 'text/csv', buffer: Buffer.from(file) });
    await page.fill('[data-va="import"] input[name=source]', 'Garmin R10 (webb)');
    await page.fill('[data-va="import"] input[name=from]', new Date(T0 - 86400000).toISOString().slice(0, 10));
    await page.click('[data-va-act="import"]');
    await page.waitForFunction(() => document.querySelector('[data-va="import-result"]'), null, { timeout: 30000 });
    const res = await page.evaluate(() => document.querySelector('[data-va="import-result"]').innerText);
    check('importen på sidan: en rad, en sparad', /1 rader: 1 sparade/.test(res), res);
    const r3 = (await refsOf(A.id)).find(x => x.shot_client_id === s3.cid && x.source === 'Garmin R10 (webb)');
    check('...och den hamnar på rätt slag, i meter', r3 && near(r3.carry_m, 172 / 1.09361) && near(r3.side_m, -1.5 / 1.09361));
    const [dl1] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-diag="csv"]')]);
    const csvFile = fs.readFileSync(await dl1.path(), 'utf8');
    check('nedladdning som CSV', /\.csv$/.test(dl1.suggestedFilename()) && csvFile.split('\n')[0] === require(path.join(ROOT, 'shot-diagnostics.js')).CSV_HEAD.join(','), dl1.suggestedFilename());
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-diag="json"]')]);
    const jsonFile = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
    check('nedladdning som JSON, med slagen och sammanfattningen', /\.json$/.test(dl2.suggestedFilename()) && Array.isArray(jsonFile.shots) && jsonFile.shots.length === 19 && jsonFile.summary, dl2.suggestedFilename());
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    await cleanup();
  }
  console.log(failed ? '\n' + failed + ' failed' : '\nAll validation e2e checks passed');
  process.exit(failed ? 1 : 0);
})();
