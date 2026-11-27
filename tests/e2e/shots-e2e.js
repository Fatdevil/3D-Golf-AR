// End-to-end test of the shot bank: the real server.js against a real Postgres, over HTTP, no browser.
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/shots-e2e.js
// Covers: only the player's own device (its id and token) reads or writes its shots; a shot sent twice (or twice in one batch) is kept
// once; what was measured is never overwritten, what the player decides follows the latest edit; a bad shot is refused, the rest of the
// batch kept; two devices share one bank after a code (wrong, used and expired codes refused, the joining device's own shots go with it);
// nothing deletes a shot; the bag is the same rule as the device's. It only touches rows of its own (tag E2S...).
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  shots e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
let Pool;
try { Pool = require(path.join(ROOT, 'node_modules', 'pg')).Pool; } catch (e) { console.error('Missing "pg". Run: npm install'); process.exit(2); }
const Bag = require(path.join(ROOT, 'arcade-bag.js'));

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) failed++; }

(async function () {
  const pool = new Pool({ connectionString: URL_DB });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const BASE = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: URL_DB, RATE_LIMIT_WRITES: '100000', RATE_LIMIT_REGISTER: '100000' }), stdio: 'ignore' });
  const tag = 'E2S' + crypto.randomBytes(3).toString('hex').toUpperCase();
  // a device: its id and the secret it keeps (device-token.js)
  const device = name => ({ id: 'e2s-' + name + '-' + tag, token: crypto.randomBytes(32).toString('hex') });
  const A = device('a'), B = device('b'), C = device('c'), D = device('d');
  async function api(method, url, body, dev, token) {
    const h = { 'Content-Type': 'application/json' };
    if (dev) { h['x-user-id'] = dev.id; h['x-user-token'] = token === undefined ? dev.token : token; }
    const res = await fetch(BASE + url, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, json: json === null ? {} : json };
  }
  const T0 = Date.now() - 3600000;
  let k = 0;
  const shot = o => Object.assign({ cid: 'e2s' + tag + String(++k).padStart(4, '0'), t: T0 + k * 1000, source: 'LM', club: '7i', ballSpeed: 120, launch: 16, spin: 7000, carry: 150, total: 158,
                                    raw: { ballSpeedMph: 120, totalSpinRpm: 7000, measured: ['ballSpeedMph', 'totalSpinRpm'] } }, o || {});
  const count = async id => (await pool.query('SELECT count(*)::int AS n FROM shots WHERE player_id = $1', [id])).rows[0].n;
  async function cleanup() {
    try { await pool.query('DELETE FROM shots WHERE player_id LIKE $1', ['e2s-%-' + tag]); } catch (e) { /* none */ }
    try { await pool.query('DELETE FROM device_links WHERE account_id LIKE $1', ['e2s-%-' + tag]); } catch (e) { /* none */ }
    try { await pool.query('DELETE FROM users WHERE id LIKE $1', ['e2s-%-' + tag]); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + '/api/health'); const j = await r.json(); up = j.db_connected === true && j.schema_ready === true; } catch (e) { /* not yet */ } if (!up) await new Promise(r => setTimeout(r, 500)); }
    if (!up) { console.error('server did not come up with a database'); await cleanup(); process.exit(2); }
    // each device registers with its token (the token binds the id to the device)
    for (const d of [A, B, C, D]) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': d.id, 'x-user-token': d.token }, body: JSON.stringify({ device_id: d.id }) });

    console.log('1. Bara spelarens egen enhet');
    let r = await api('POST', '/api/shots/sync', { shots: [shot()] });
    check('utan spelare tas inga slag emot (401)', r.status === 401, JSON.stringify(r));
    r = await api('GET', '/api/shots');
    const rb = await api('GET', '/api/bag');
    check('utan spelare läses inga slag och ingen bag (401)', r.status === 401 && rb.status === 401);
    const a1 = shot(), a2 = shot({ club: 'PW', carry: 110, total: 115 }), a3 = shot({ club: '5i', carry: 170, total: 180, source: 'SIM' });
    r = await api('POST', '/api/shots/sync', { shots: [a1, a2, a3] }, A);
    check('A:s slag sparas', r.status === 200 && r.json.stored.length === 3 && (await count(A.id)) === 3, JSON.stringify(r.json));
    r = await api('GET', '/api/shots', undefined, A, crypto.randomBytes(32).toString('hex'));
    const r2 = await api('POST', '/api/shots/sync', { shots: [shot({ cid: a1.cid, club: 'Dr', edited: Date.now() })] }, A, crypto.randomBytes(32).toString('hex'));
    const r3 = await api('GET', '/api/bag', undefined, A, '');
    check('A:s id utan A:s nyckel varken läser, skriver eller ser bagen (401)', r.status === 401 && r2.status === 401 && r3.status === 401, JSON.stringify([r.status, r2.status, r3.status]));
    r = await api('GET', '/api/shots', undefined, C);
    check('en annan spelare ser inga av A:s slag', r.status === 200 && r.json.total === 0 && r.json.shots.length === 0, JSON.stringify(r.json));
    r = await api('GET', '/api/shots?player=' + encodeURIComponent(A.id) + '&player_id=' + encodeURIComponent(A.id), undefined, C);
    check('inte heller med A:s id i adressen', r.json.total === 0);
    r = await api('POST', '/api/shots/sync', { shots: [Object.assign({}, a1, { club: 'Dr', carry: 300, edited: Date.now() })] }, C);
    const aRow = (await pool.query('SELECT club, carry FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, a1.cid])).rows[0];
    check('C som skickar A:s slags id får ett eget slag, A:s är orört', r.status === 200 && aRow.club === '7i' && aRow.carry === 150 && (await count(C.id)) === 1, JSON.stringify(aRow));
    r = await api('GET', '/api/shots', undefined, A);
    check('svaret har inga spelar- eller enhets-id', r.json.shots.length === 3 && r.json.shots.every(s => !('player_id' in s) && !('device_id' in s)) && JSON.stringify(r.json).indexOf(A.id) < 0);

    console.log('\n2. Dubbletter, mätvärden och ändringar');
    const dup = shot();
    r = await api('POST', '/api/shots/sync', { shots: [dup, dup] }, A);
    await api('POST', '/api/shots/sync', { shots: [dup] }, A);
    const n = (await pool.query('SELECT count(*)::int AS n FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, dup.cid])).rows[0].n;
    check('samma slag två gånger i en sändning och en gång till: en rad', r.status === 200 && n === 1, String(n));
    await api('POST', '/api/shots/sync', { shots: [Object.assign({}, a1, { carry: 999 > 500 ? 155 : 0, ballSpeed: 140, clubSpeed: 90, edited: a1.t })] }, A);
    let row = (await pool.query('SELECT carry, ball_speed, club_speed FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, a1.cid])).rows[0];
    check('det som mättes skrivs inte över av en senare kopia, men det som saknades fylls i', row.carry === 150 && row.ball_speed === 120 && row.club_speed === 90, JSON.stringify(row));
    await api('POST', '/api/shots/sync', { shots: [Object.assign({}, a1, { club: '6i', edited: a1.t + 5000 })] }, A);
    await api('POST', '/api/shots/sync', { shots: [Object.assign({}, a1, { club: '8i', edited: a1.t + 2000 })] }, A);   // older edit, arriving later (another device was offline)
    row = (await pool.query('SELECT club FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, a1.cid])).rows[0];
    check('klubban följer den senast gjorda ändringen, inte den som kom sist', row.club === '6i', JSON.stringify(row));
    const flagged = shot({ review: { flags: ['topped'], mishit: true, misread: false, looksLike: null }, carry: 60 });
    await api('POST', '/api/shots/sync', { shots: [flagged] }, A);
    await api('POST', '/api/shots/sync', { shots: [Object.assign({}, flagged, { accepted: true, edited: flagged.t + 1000 })] }, A);
    row = (await pool.query('SELECT accepted, review FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, flagged.cid])).rows[0];
    check('ett flaggat slag som spelaren räknar ändå sparas som räknat, med sin granskning', row.accepted === true && row.review.mishit === true, JSON.stringify(row));
    r = await api('POST', '/api/shots/sync', { shots: [shot({ ballSpeed: 9999 }), shot({ cid: 'x' }), shot()] }, A);
    check('ett felaktigt slag avvisas med orsak, resten av sändningen sparas', r.status === 200 && r.json.stored.length === 1 && r.json.refused.length === 2 &&
      r.json.refused.map(x => x.reason).sort().join() === 'bad_ballSpeed,bad_cid', JSON.stringify(r.json));
    r = await api('POST', '/api/shots/sync', { shots: Array.from({ length: 201 }, () => shot()) }, A);
    check('högst 200 slag per sändning (400)', r.status === 400);

    console.log('\n3. Inget raderar ett slag');
    const before = await count(A.id);
    r = await api('DELETE', '/api/shots', undefined, A);
    const r4 = await api('DELETE', '/api/shots/' + encodeURIComponent(a1.cid), undefined, A);
    await api('POST', '/api/shots/sync', { shots: [] }, A);   // a device whose session was cleared sends nothing more: nothing goes
    check('det finns inget sätt att radera slag, och en tom sändning tar inte bort något', r.status === 404 && r4.status === 404 && (await count(A.id)) === before, JSON.stringify([r.status, r4.status, before]));

    console.log('\n4. Bagen');
    const bagShots = [shot({ club: 'Dr', carry: 230, total: 250, carryStd: 235, totalStd: 255 }), shot({ club: 'Dr', carry: 228, total: 248, estimated: ['totalSpinRpm'] }),
                      shot({ club: 'Dr', carry: 200, total: 210, practice: { dist: 60, prox: 3 } }), shot({ club: 'Dr', carry: 225, total: 245, source: 'SIM' })];
    await api('POST', '/api/shots/sync', { shots: bagShots }, A);
    r = await api('GET', '/api/bag', undefined, A);
    const all = (await api('GET', '/api/shots?limit=500', undefined, A)).json.shots;
    const local = Bag.trim(all.map(Bag.entryOf).filter(Boolean));
    check('serverns bag följer samma regel som enhetens (arcade-bag.js)', r.status === 200 && JSON.stringify(r.json.shots) === JSON.stringify(local), JSON.stringify([r.json.shots, local]));
    const dr = r.json.shots.filter(e => e.club === 'Dr');
    check('bagen: standardcarry när den finns, inte uppskattade, inspels- eller svingslag', dr.length === 1 && dr[0].carry === 235 && r.json.shots.some(e => e.club === '6i') && !r.json.shots.some(e => e.club === '5i'), JSON.stringify(r.json.shots));

    // a club whose newest shots are all flagged still has its older counted shots in the bag (the rule before the per-club limit)
    const older = Array.from({ length: 5 }, (_, i) => shot({ club: 'GW', carry: 95 + i, total: 98 + i, t: T0 - 86400000 + i * 1000 }));
    const flaggedNewer = Array.from({ length: 45 }, () => shot({ club: 'GW', carry: 50, total: 52, review: { flags: ['thin'], mishit: true, misread: false, looksLike: null } }));
    const guessedNewer = Array.from({ length: 5 }, () => shot({ club: 'GW', carry: 90, total: 92, estimated: ['totalSpinRpm'] }));
    await api('POST', '/api/shots/sync', { shots: older.concat(flaggedNewer, guessedNewer) }, A);
    r = await api('GET', '/api/bag', undefined, A);
    const gw = r.json.shots.filter(e => e.club === 'GW');
    check('en klubba vars senaste slag alla är flaggade eller uppskattade behåller sina äldre räknade slag i bagen', gw.length === 5 && gw.every(e => e.carry >= 95), JSON.stringify(gw));
    const all2 = (await api('GET', '/api/shots?limit=500', undefined, A)).json.shots;
    check('och serverns bag är fortfarande enhetens regel', JSON.stringify(r.json.shots) === JSON.stringify(Bag.trim(all2.map(Bag.entryOf).filter(Boolean))));

    console.log('\n5. Två enheter');
    const bOwn = shot({ club: '9i', carry: 125, total: 130 });
    await api('POST', '/api/shots/sync', { shots: [bOwn, Object.assign({}, a2)] }, B);   // B had a shot of its own, and one with the same id as one of A's
    r = await api('POST', '/api/devices/link', { code: 'ABCD2345' }, B);
    check('en kod som inte finns kopplar inget (404)', r.status === 404);
    r = await api('POST', '/api/devices/link', { code: 'x' }, B);
    check('en kod som inte är en kod (400)', r.status === 400);
    r = await api('POST', '/api/devices/link-code', {}, A);
    const code = r.json.code;
    check('A får en kod på 8 tecken, giltig i 10 minuter', r.status === 200 && /^[A-Z0-9]{8}$/.test(code) && Math.abs(new Date(r.json.expires_at) - Date.now() - 600000) < 60000, JSON.stringify(r.json));
    r = await api('POST', '/api/devices/link', { code: code.toLowerCase().slice(0, 4) + ' ' + code.slice(4) }, B, crypto.randomBytes(32).toString('hex'));
    check('B:s id utan B:s nyckel kan inte använda koden (401)', r.status === 401);
    const aBefore = await count(A.id);
    r = await api('POST', '/api/devices/link', { code: code.toLowerCase().slice(0, 4) + ' ' + code.slice(4) }, B);
    check('B kopplas med koden (små bokstäver och mellanslag går bra), och B:s egna slag följer med', r.status === 200 && r.json.linked === true && (await count(B.id)) === 0 &&
      (await count(A.id)) === aBefore + 1, JSON.stringify([r.json, await count(B.id), await count(A.id), aBefore]));
    row = (await pool.query('SELECT club FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, a2.cid])).rows;
    check('ett slag som fanns hos båda finns en gång, som det var i kontot', row.length === 1 && row[0].club === 'PW', JSON.stringify(row));
    r = await api('POST', '/api/devices/link', { code: code }, C);
    check('en använd kod kopplar inte en till (404)', r.status === 404);
    const bShot = shot({ club: '8i', carry: 135, total: 142 });
    await api('POST', '/api/shots/sync', { shots: [bShot] }, B);
    r = await api('GET', '/api/shots?limit=500', undefined, A);
    const rB = await api('GET', '/api/shots?limit=500', undefined, B);
    check('ett slag från B syns på A, och båda ser samma slagbank', r.json.shots.some(s => s.cid === bShot.cid) && r.json.total === rB.json.total && r.json.total === aBefore + 2, JSON.stringify([r.json.total, rB.json.total]));
    const bagA = await api('GET', '/api/bag', undefined, A), bagB = await api('GET', '/api/bag', undefined, B);
    check('A och B har samma bag, med båda enheternas slag', JSON.stringify(bagA.json) === JSON.stringify(bagB.json) && bagA.json.shots.some(e => e.club === '8i') && bagA.json.shots.some(e => e.club === '9i'));
    await api('POST', '/api/shots/sync', { shots: [Object.assign({}, a1, { club: '7i', edited: Date.now() })] }, B);
    row = (await pool.query('SELECT club FROM shots WHERE player_id = $1 AND client_id = $2', [A.id, a1.cid])).rows[0];
    check('B kan rätta klubban på ett slag A slog (samma spelare)', row.club === '7i');
    // an expired code
    r = await api('POST', '/api/devices/link-code', {}, A);
    await pool.query("UPDATE device_links SET expires_at = now() - interval '1 minute' WHERE account_id = $1 AND used_at IS NULL", [A.id]);
    const r5 = await api('POST', '/api/devices/link', { code: r.json.code }, C);
    check('en kod som gått ut kopplar inget (404), och C ser fortfarande inga av A:s slag', r5.status === 404 && (await api('GET', '/api/shots', undefined, C)).json.total === 1);
    // a device others joined cannot join another account
    r = await api('POST', '/api/devices/link-code', {}, D);
    r = await api('POST', '/api/devices/link', { code: r.json.code }, A);
    check('en enhet som andra kopplat sig till kan inte själv gå med i ett annat konto (409)', r.status === 409, JSON.stringify(r));
    // a code made by a device that then joins another account: it leads to that account, never to the bank the device left
    const E = device('e'), F = device('f'), G = device('g');
    for (const d of [E, F, G]) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': d.id, 'x-user-token': d.token }, body: JSON.stringify({ device_id: d.id }) });
    await api('POST', '/api/shots/sync', { shots: [shot({ club: 'LW', carry: 60, total: 61 })] }, E);
    const eCode = (await api('POST', '/api/devices/link-code', {}, E)).json.code;
    const fCode = (await api('POST', '/api/devices/link-code', {}, F)).json.code;
    r = await api('POST', '/api/devices/link', { code: fCode }, E);   // E joins F's bank
    const rG = await api('POST', '/api/devices/link', { code: eCode }, G);   // G uses the code E made before
    const gShots = await api('GET', '/api/shots', undefined, G), fShots = await api('GET', '/api/shots', undefined, F);
    check('en kod från en enhet som sedan gått med i ett annat konto leder inte till den gamla banken: den är ogiltig (404)', r.status === 200 && rG.status === 404 &&
      gShots.json.total === 0 && fShots.json.total === 1, JSON.stringify([r.status, rG.status, gShots.json.total, fShots.json.total]));
    // and a code still in the table for such a device (made before this rule) is followed to the account it joined
    await pool.query('INSERT INTO device_links (code_hash, account_id, expires_at) VALUES ($1, $2, now() + interval \'5 minutes\')', [crypto.createHash('sha256').update('ZZZZ2222').digest('hex'), E.id]);
    r = await api('POST', '/api/devices/link', { code: 'ZZZZ2222' }, G);
    const gNow = await api('GET', '/api/shots', undefined, G);
    check('en äldre kod till en enhet som bytt konto följs till kontot enheten gått med i', r.status === 200 && gNow.json.total === 1 && (await count(F.id)) === 1 && (await count(E.id)) === 0, JSON.stringify([r.status, gNow.json.total]));

    // leaving
    r = await api('POST', '/api/devices/unlink', {}, B);
    const after = shot({ club: 'SW', carry: 80, total: 82 });
    await api('POST', '/api/shots/sync', { shots: [after] }, B);
    check('B lämnar kontot: slagen B skickat stannar hos spelaren, nya går till B:s egen bank', r.status === 200 && (await count(A.id)) === aBefore + 2 && (await count(B.id)) === 1);

    console.log('\n6. Storlek');
    const huge = await fetch(BASE + '/api/shots/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': A.id, 'x-user-token': A.token }, body: JSON.stringify({ shots: [], pad: 'x'.repeat(1100000) }) });
    check('en sändning över 1 MB tas inte emot (413)', huge.status === 413, String(huge.status));
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' failed' : '\nAll shot bank e2e checks passed');
  process.exit(failed ? 1 : 0);
})();
