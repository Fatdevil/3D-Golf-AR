// End-to-end test of collections (courses of several plates): the real server.js against a real Postgres, over HTTP, no browser.
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/collections-e2e.js
// Covers: the plate list is checked when a collection is saved (too many, twice, missing, draft, range), the total par is the server's own,
// and the collection's leaderboard adds up a player's rounds on every plate of one go (and nothing less than the whole collection).
// It only touches rows of its own: courses tagged 'E2C-<random>-...', their records, and the collections made here.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  collections e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }
let Pool;
try { Pool = require(path.join(ROOT, 'node_modules', 'pg')).Pool; } catch (e) { console.error('Missing "pg". Run: npm install'); process.exit(2); }

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; }

(async function () {
  const pool = new Pool({ connectionString: URL_DB });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const BASE = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: URL_DB }), stdio: 'ignore' });
  const tag = 'E2C-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
  const owner = 'e2c-owner-' + tag;
  const madeCollections = [];
  async function api(method, url, body, user) {
    const res = await fetch(BASE + url, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, user ? { 'x-user-id': user } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, json: json || {} };
  }
  async function cleanup() {
    try { await pool.query("DELETE FROM course_records WHERE course_code LIKE $1", [tag + '-%']); } catch (e) { /* none */ }
    try { await pool.query("DELETE FROM courses WHERE share_code LIKE $1", [tag + '-%']); } catch (e) { /* none */ }
    try { if (madeCollections.length) await pool.query("DELETE FROM course_collections WHERE id = ANY($1)", [madeCollections]); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + '/api/health'); up = (await r.json()).db_connected === true; } catch (e) { /* not yet */ } if (!up) await new Promise(function (r) { setTimeout(r, 500); }); }
    if (!up) { console.error('server did not come up with a database'); await cleanup(); process.exit(2); }

    // three published plates, one draft, one range
    const mk = function (suffix, o) { return pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, is_range, owner_id, hole_count, total_par) VALUES ($1,$2,'t','[]'::jsonb,$3,$4,$5,3,$6)", [tag + '-' + suffix, 'Platta ' + suffix, !!o.draft, !!o.range, owner, o.par === undefined ? 12 : o.par]); };
    await mk('A', { par: 11 }); await mk('B', { par: 12 }); await mk('C', { par: 10 }); await mk('D', { draft: true }); await mk('R', { range: true }); await mk('T', { par: 8 });
    await pool.query('UPDATE courses SET hole_count = 2 WHERE share_code = $1', [tag + '-T']);
    const A = tag + '-A', B = tag + '-B', C = tag + '-C', D = tag + '-D', R = tag + '-R';
    const plate = function (c) { return { plate_code: c, plate_name: 'whatever the page says' }; };

    let r = await api('POST', '/api/collections', { name: 'Sexan', author: 'Test', type: '6', plates: [] }, owner);
    check('a new, empty collection is saved', r.status === 200 && r.json.success && r.json.id, JSON.stringify(r));
    const id = r.json.id; madeCollections.push(id);

    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A)], total_par: 99 }, owner);
    const row1 = (await pool.query('SELECT plates, total_par FROM course_collections WHERE id = $1', [id])).rows[0];
    check('plate 1 is saved; the total par is the plates\', not the 99 the page sent; the name is the course\'s own', r.status === 200 && row1.total_par === 11 && row1.plates.length === 1 && row1.plates[0].plate_code === A && row1.plates[0].plate_name === 'Platta A', JSON.stringify(row1));

    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(A)] }, owner);
    check('the same plate twice is refused (400)', r.status === 400 && /twice/.test(r.json.error || ''), JSON.stringify(r));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(B), plate(C)] }, owner);
    check('three plates in a 6 hole course are refused (400)', r.status === 400 && /room for 2/.test(r.json.error || ''), JSON.stringify(r));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(tag + '-NOPE')] }, owner);
    check('a plate that does not exist is refused (400)', r.status === 400 && /does not exist/.test(r.json.error || ''), JSON.stringify(r));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(D)] }, owner);
    check('a draft is refused (400)', r.status === 400 && /not published/.test(r.json.error || ''), JSON.stringify(r));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(R)] }, owner);
    check('a range is refused (400)', r.status === 400 && /range/.test(r.json.error || ''), JSON.stringify(r));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(tag + '-T')] }, owner);
    check('a course of two holes is refused as a plate (400)', r.status === 400 && /has 2 holes/.test(r.json.error || ''), JSON.stringify(r));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: 'A' }, owner);
    check('plates that are not a list are refused (400)', r.status === 400, JSON.stringify(r));
    const rowAfter = (await pool.query('SELECT plates, total_par FROM course_collections WHERE id = $1', [id])).rows[0];
    check('none of the refused saves changed the collection', rowAfter.plates.length === 1 && rowAfter.total_par === 11, JSON.stringify(rowAfter));

    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('a collection with room for one more plate has no results yet (needed 2, has 1)', r.status === 200 && r.json.leaderboard.length === 0 && r.json.needed === 2 && r.json.plates === 1, JSON.stringify(r));

    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(B)] }, owner);
    const row2 = (await pool.query('SELECT plates, total_par FROM course_collections WHERE id = $1', [id])).rows[0];
    check('plate 2 is added: total par 11 + 12', r.status === 200 && row2.plates.length === 2 && row2.total_par === 23, JSON.stringify(row2));

    // rounds: Kim plays both plates in one go (round K1), Lo only the first (L1), Kim a second time on plate A only (K2)
    const post = function (course, who, score, collRound, plateIndex, extra) {
      const stats = collRound ? Object.assign({ collection_id: id, collection_round_id: collRound, plate_index: plateIndex, round_id: collRound + '-p' + plateIndex + '-0' }, extra || {}) : undefined;
      return api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', stats: stats, player_name: who }, 'e2c-' + who + '-' + tag);
    };
    r = await post(A, 'Kim', 12, 'kimround1', 0); const okA = r.json.success === true;
    r = await post(B, 'Kim', 15, 'kimround1', 1); const okB = r.json.success === true;
    await post(A, 'Lo', 9, 'loround01', 0);
    await post(A, 'Kim', 30, 'kimround2', 0);
    check('plate results are filed on their own plates', okA && okB && (await pool.query('SELECT COUNT(*)::int AS n FROM course_records WHERE course_code = ANY($1)', [[A, B]])).rows[0].n === 4);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    const lb = r.json.leaderboard || [];
    check('the collection\'s leaderboard has the one whole round only: Kim, 12 + 15 = 27 (Lo stopped after plate 1, Kim\'s second go too)', r.status === 200 && lb.length === 1 && lb[0].player_name === 'Kim' && lb[0].total_score === 27 && lb[0].score_vs_par === (12 - 12) + (15 - 12), JSON.stringify(r.json));

    // a plate sent twice in one round counts once (the latest)
    await post(B, 'Kim', 14, 'kimround1', 1, { round_id: 'kimround1-p1-retry' });
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('a plate sent twice in one round counts once, with its latest result (12 + 14 = 26)', (r.json.leaderboard || []).length === 1 && r.json.leaderboard[0].total_score === 26, JSON.stringify(r.json));

    // two players on one device with the same name (same player id): told apart by their seat in the roster
    const postSlot = function (course, score, slot, plateIndex) {
      return api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: 0, hole_scores: [1, 1, 1], input_mode: 'SWING_METER', player_name: 'Sam',
        stats: { collection_id: id, collection_round_id: 'samround01', plate_index: plateIndex, round_id: 'samround01-p' + plateIndex + '-' + slot, player_slot: slot } }, 'e2c-Sam-' + tag);
    };
    await postSlot(A, 10, 0, 0); await postSlot(B, 11, 0, 1); await postSlot(A, 20, 1, 0); await postSlot(B, 21, 1, 1);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    const sams = (r.json.leaderboard || []).filter(function (x) { return x.player_name === 'Sam'; }).map(function (x) { return x.total_score; }).sort();
    check('two players with the same name on one device are two results (21 and 41), not one mixed up', sams.length === 2 && sams[0] === 21 && sams[1] === 41, JSON.stringify(r.json.leaderboard));

    // Lo finishes: two players, ordered by total
    await post(B, 'Lo', 10, 'loround01', 1);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    const lb2 = r.json.leaderboard || [];
    check('the lower total first (Lo 19, Kim 26)', lb2.length >= 2 && lb2[0].player_name === 'Lo' && lb2[0].total_score === 19 && lb2.filter(function (x) { return x.player_name === 'Kim'; })[0].total_score === 26 && lb2.indexOf(lb2.filter(function (x) { return x.player_name === 'Kim'; })[0]) > 0, JSON.stringify(lb2));

    // a record that names another collection or a plate outside this one does not count
    await post(C, 'Mo', 5, 'moround01', 0); await post(A, 'Mo', 5, 'moround01', 1);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('a round on a plate that is not in the collection does not make a result', (r.json.leaderboard || []).every(function (x) { return x.player_name !== 'Mo'; }), JSON.stringify(r.json));

    r = await api('GET', '/api/collections/NOSUCH/leaderboard');
    check('an unknown collection is a 404', r.status === 404);

    // a collection with another type: 9 holes, three plates
    r = await api('POST', '/api/collections', { name: 'Nian', author: 'Test', type: '9', plates: [plate(A), plate(B), plate(C)] }, owner);
    if (r.json.id) madeCollections.push(r.json.id);
    check('three plates fit a 9 hole course (total par 11 + 12 + 10)', r.status === 200 && (await pool.query('SELECT total_par FROM course_collections WHERE id = $1', [r.json.id])).rows[0].total_par === 33, JSON.stringify(r));
    r = await api('POST', '/api/collections', { name: 'Fel', author: 'Test', type: '7', plates: [] }, owner);
    check('a type other than 3, 6, 9, 18 is still refused', r.status === 400);
  } catch (e) {
    console.error('FAIL  crashed:', e && e.stack || e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
