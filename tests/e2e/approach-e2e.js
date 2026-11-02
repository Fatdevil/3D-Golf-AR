// End-to-end test of the approach test leaderboards: the real server.js against a real Postgres, over HTTP, no browser.
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/approach-e2e.js
// Covers: a finished test goes in only on a published range (or the ready practice range), only as one of the game's tests and with
// shots that make it; the score is the server's own, worked out from the shots (not what the page says); the board is each player's
// best, the best first, with where the caller stands. It only touches rows of its own (tag E2A...).
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  approach e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
let Pool;
try { Pool = require(path.join(ROOT, 'node_modules', 'pg')).Pool; } catch (e) { console.error('Missing "pg". Run: npm install'); process.exit(2); }

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) failed++; }

(async function () {
  const pool = new Pool({ connectionString: URL_DB });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const BASE = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: URL_DB, RATE_LIMIT_WRITES: '100000', RATE_LIMIT_REGISTER: '100000' }), stdio: 'ignore' });
  const tag = 'E2A' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
  const owner = 'e2a-owner-' + tag, p1 = 'e2a-p1-' + tag, p2 = 'e2a-p2-' + tag, p3 = 'e2a-p3-' + tag;
  const R = tag + 'R', KEY = '9|50-150|m';
  async function api(method, url, body, user) {
    const res = await fetch(BASE + url, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, user ? { 'x-user-id': user } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, json: json === null ? {} : json };
  }
  // nine shots in the band, each `prox` metres from the pin (100 m shots: 10 m away is 50 points)
  const shots = (prox, o) => Array.from({ length: (o && o.n) || 9 }, (_, i) => ({ dist: (o && o.dist) || 100, prox: Array.isArray(prox) ? prox[i] : prox, onGreen: prox < 8, holed: false }));
  async function cleanup() {
    try { await pool.query('DELETE FROM approach_results WHERE range_code LIKE $1 OR user_id LIKE $2', [tag + '%', 'e2a-%-' + tag]); } catch (e) { /* none */ }
    try { await pool.query('DELETE FROM courses WHERE share_code LIKE $1', [tag + '%']); } catch (e) { /* none */ }
    try { await pool.query('DELETE FROM users WHERE id LIKE $1', ['e2a-%-' + tag]); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + '/api/health'); up = (await r.json()).db_connected === true; } catch (e) { /* not yet */ } if (!up) await new Promise(function (r) { setTimeout(r, 500); }); }
    if (!up) { console.error('server did not come up with a database'); await cleanup(); process.exit(2); }
    for (let i = 0; i < 20; i++) { const t = await pool.query("SELECT to_regclass('approach_results') AS t"); if (t.rows[0].t) break; await new Promise(function (r) { setTimeout(r, 250); }); }

    const mk = (code, o) => pool.query("INSERT INTO courses (share_code, name, author, holes, is_range, is_draft, owner_id) VALUES ($1,'Rangen','t','[]'::jsonb,$2,$3,$4)", [code, o.range !== false, !!o.draft, owner]);
    await mk(R, {}); await mk(tag + 'D', { draft: true }); await mk(tag + 'C', { range: false });

    let r = await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(10) });
    check('a result needs a player (401 without one)', r.status === 401, JSON.stringify(r));
    r = await api('POST', '/api/ranges/' + R + '/approach', { test_key: '7|50-150|m', shots: shots(10, { n: 7 }) }, p1);
    const r2 = await api('POST', '/api/ranges/' + R + '/approach', { test_key: '9|40-90|m', shots: shots(10) }, p1);
    check('only the game\'s tests (9 or 18 shots, its three bands) go in (400)', r.status === 400 && r2.status === 400, JSON.stringify([r.status, r2.status]));
    r = await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(10, { n: 8 }) }, p1);
    const r3 = await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(10, { dist: 200 }) }, p1);
    const r4 = await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(-3) }, p1);
    check('shots that do not make the test are refused: too few, outside the band, a distance from the pin that is not one (400)', r.status === 400 && r3.status === 400 && r4.status === 400, JSON.stringify([r.status, r3.status, r4.status]));
    r = await api('POST', '/api/ranges/' + tag + 'D/approach', { test_key: KEY, shots: shots(10) }, p1);
    const r5 = await api('POST', '/api/ranges/' + tag + 'C/approach', { test_key: KEY, shots: shots(10) }, p1);
    const r6 = await api('POST', '/api/ranges/' + tag + 'NOPE/approach', { test_key: KEY, shots: shots(10) }, p1);
    check('only a published range takes results: not a draft, a course or one that does not exist (404)', r.status === 404 && r5.status === 404 && r6.status === 404, JSON.stringify([r.status, r5.status, r6.status]));

    r = await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(10), score: 100, player_name: 'Ettan' }, p1);
    check('the score is worked out from the shots (10 m from 100 m is 50), not taken from the page', r.status === 200 && r.json.score === 50, JSON.stringify(r.json));
    check('the answer has the board and where the player stands', r.json.players === 1 && r.json.me && r.json.me.rank === 1 && r.json.me.best === 50 && r.json.top.length === 1 && r.json.top[0].is_me === true, JSON.stringify(r.json));
    await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(5), player_name: 'Tvåan' }, p2);       // 75
    await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(15), player_name: 'Trean' }, p3);      // 25
    r = await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(2), player_name: 'Ettan' }, p1);   // 90: p1's best now
    await api('POST', '/api/ranges/' + R + '/approach', { test_key: KEY, shots: shots(18), player_name: 'Ettan' }, p1);      // 10: not their best
    r = await api('GET', '/api/ranges/' + R + '/approach?test=' + encodeURIComponent(KEY), undefined, p3);
    check('the board is each player\'s best, the best first, a player once', r.status === 200 && r.json.top.map(x => x.player_name + ':' + x.score).join() === 'Ettan:90,Tvåan:75,Trean:25' && r.json.players === 3, JSON.stringify(r.json.top));
    check('where the caller stands (3rd of 3, best 25), no ids out', r.json.me && r.json.me.rank === 3 && r.json.me.best === 25 && r.json.top.every(x => x.player_id === undefined && typeof x.player_ref === 'string') && r.json.top[2].is_me === true, JSON.stringify(r.json));
    r = await api('GET', '/api/ranges/' + R + '/approach?test=' + encodeURIComponent('18|50-150|m'));
    check('another test has its own board (empty here)', r.json.players === 0 && r.json.top.length === 0 && r.json.me === null, JSON.stringify(r.json));
    r = await api('GET', '/api/ranges/' + R + '/approach?test=nope');
    check('an unknown test is refused (400)', r.status === 400, JSON.stringify(r));

    // the ready practice range has a board of its own, under its fixed code
    r = await api('POST', '/api/ranges/GOLFOS-PRACTICE/approach', { test_key: '9|30-80|yd', shots: shots(3, { dist: 50 }), player_name: 'Övaren' }, p1);
    check('the practice range takes results under its own code (yards: the band in yards)', r.status === 200 && r.json.score === 70 && r.json.me.rank >= 1, JSON.stringify(r.json));
    // deleting the range takes its results with it
    await api('DELETE', '/api/courses/' + R, undefined, owner);
    const left = (await pool.query('SELECT COUNT(*)::int AS n FROM approach_results WHERE range_code = $1', [R])).rows[0].n;
    check('a deleted range\'s results go with it', left === 0, String(left));
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nApproach e2e: all checks passed');
  process.exit(failed ? 1 : 0);
})();
