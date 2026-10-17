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

const wait = ms => new Promise(r => setTimeout(r, ms));
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
    try { await pool.query("DELETE FROM users WHERE id LIKE $1", ['e2c-%-' + tag]); } catch (e) { /* none */ }
    try { await pool.query('ALTER TABLE course_collections DROP CONSTRAINT IF EXISTS e2c_block'); } catch (e) { /* none */ }
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
    // a plate's holes: tee at the origin, the flag `len` metres away (par 4 each)
    const holesOf = lens => JSON.stringify(lens.map(len => ({ par: 4, tees: { yellow: { x: 0, y: 0, z: 0 } }, flag: { x: 0, y: 0, z: -len } })));
    const mk = function (suffix, o) { return pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, is_range, owner_id, hole_count, total_par, course_rating, slope_rating) VALUES ($1,$2,'t',$7::jsonb,$3,$4,$5,3,$6,$8,$9)", [tag + '-' + suffix, 'Platta ' + suffix, !!o.draft, !!o.range, owner, o.par === undefined ? 12 : o.par, o.lens ? holesOf(o.lens) : '[]', o.cr || null, o.sr || null]); };
    await mk('A', { par: 11, lens: [150, 400, 250] }); await mk('B', { par: 12, lens: [300, 100, 500] }); await mk('C', { par: 10 }); await mk('D', { draft: true }); await mk('R', { range: true }); await mk('T', { par: 8 });
    await mk('H1', { par: 12, lens: [300, 300, 300], cr: 12, sr: 113 }); await mk('H2', { par: 12, lens: [300, 300, 300], cr: 12, sr: 113 }); await mk('L1', { par: 12, lens: [200, 200, 200] }); await mk('X1', { par: 12, lens: [300, 300, 300], cr: 10, sr: 113 }); await mk('F1', { par: 12, lens: [200, 200, 200] }); await mk('Z1', { par: 12, lens: [100, 100, 100] }); await mk('Z2', { par: 12, lens: [100, 100, 100] });
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

    // the collection's stroke index and ratings: its six holes as one course (lengths 150 400 250 | 300 100 500: longest = hardest = 1)
    const colRow = (await api('GET', '/api/collections/' + id)).json;
    check('the collection has the stroke index of all six holes together (not 1-3 twice)', JSON.stringify(colRow.stroke_index) === JSON.stringify([5, 2, 4, 3, 6, 1]), JSON.stringify(colRow.stroke_index));
    check('and a course rating and slope for the whole (par 23, 100 m short of 1800: 22.8; slope 110)', parseFloat(colRow.course_rating) === 22.8 && colRow.slope_rating === 110, colRow.course_rating + ' / ' + colRow.slope_rating);

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

    // a plate that is published again (new version) starts over: rounds on its old version no longer count, and cannot be mixed with new ones
    await pool.query('UPDATE courses SET version = COALESCE(version, 1) + 1 WHERE share_code = $1', [B]);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('after plate B is republished, rounds on its old version are gone from the collection\'s leaderboard', r.status === 200 && (r.json.leaderboard || []).length === 0, JSON.stringify(r.json));
    await post(A, 'Lo', 8, 'loround02', 0); await post(B, 'Lo', 9, 'loround02', 1);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('a round on the current versions of both plates counts again (Lo 8 + 9 = 17), and only that', (r.json.leaderboard || []).length === 1 && r.json.leaderboard[0].player_name === 'Lo' && r.json.leaderboard[0].total_score === 17, JSON.stringify(r.json));

    // editing the plates (the build page moves and removes them by saving the whole list): rounds count by plate, not by place
    const siBefore = (await api('GET', '/api/collections/' + id)).json.stroke_index;
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(B), plate(A)] }, owner);
    const swapped = (await api('GET', '/api/collections/' + id)).json;
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('plates swapped: the order and the six-hole stroke index follow, the total par stays, and Lo\'s round (8 + 9 = 17) still counts',
      swapped.plates[0].plate_code === B && swapped.plates[1].plate_code === A && JSON.stringify(swapped.stroke_index) !== JSON.stringify(siBefore) && swapped.total_par === 23 && (r.json.leaderboard || []).length === 1 && r.json.leaderboard[0].total_score === 17, JSON.stringify([swapped.plates, swapped.stroke_index, siBefore, r.json]));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(B)] }, owner);
    const cut = (await api('GET', '/api/collections/' + id)).json;
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('a plate removed: the collection is short again (one plate, par of that plate) and has no results until it is filled',
      cut.plates.length === 1 && cut.total_par === 12 && (r.json.leaderboard || []).length === 0 && r.json.needed === 2, JSON.stringify([cut.plates, cut.total_par, r.json]));
    r = await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(B), plate(A)] }, owner);
    r = await api('GET', '/api/collections/' + id + '/leaderboard');
    check('and when the plate is back, the round on both plates counts again', (r.json.leaderboard || []).length === 1 && r.json.leaderboard[0].total_score === 17, JSON.stringify(r.json));
    // put it back as it was for the rest
    await api('POST', '/api/collections', { id: id, name: 'Sexan', author: 'Test', type: '6', plates: [plate(A), plate(B)] }, owner);

    const gone = await api('POST', '/api/collections', { name: 'Borta', author: 'Test', type: '6', plates: [] }, owner);
    await api('DELETE', '/api/collections/' + gone.json.id, undefined, owner);
    const before = (await pool.query('SELECT COUNT(*)::int AS n FROM course_collections')).rows[0].n;
    r = await api('POST', '/api/collections', { id: gone.json.id, expect_existing: true, name: 'Borta', author: 'Test', type: '6', plates: [plate(A)] }, owner);
    check('saving the edit of a collection that was deleted meanwhile is refused (404) and does not create it again', r.status === 404 && (await pool.query('SELECT COUNT(*)::int AS n FROM course_collections')).rows[0].n === before, JSON.stringify(r));

    r = await api('GET', '/api/collections/NOSUCH/leaderboard');
    check('an unknown collection is a 404', r.status === 404);

    // the handicap: a go through the whole collection is ONE differential, on the collection's rating (not one per plate)
    const hcpUser = 'e2c-Hcp-' + tag, H1 = tag + '-H1', H2 = tag + '-H2';
    r = await api('POST', '/api/collections', { name: 'Handicap', author: 'Test', type: '6', plates: [plate(H1), plate(H2)] }, owner);
    const hid = r.json.id; madeCollections.push(hid);
    const hRow = (await pool.query('SELECT course_rating::float AS cr, slope_rating AS sr FROM course_collections WHERE id = $1', [hid])).rows[0];
    const hpost = function (course, score, round, plateIndex, retryId) {
      return api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', player_name: 'Hcp',
        stats: { collection_id: hid, collection_round_id: round, plate_index: plateIndex, round_id: retryId || (round + '-p' + plateIndex + '-0'), player_slot: 0 } }, hcpUser);
    };
    const diffs = async round => (await pool.query("SELECT course_code, score_differential::float AS d FROM course_records WHERE player_id = $1 AND stats->>'collection_round_id' = $2 ORDER BY id", [hcpUser, round])).rows;
    r = await hpost(H1, 14, 'hcpround01', 0);
    let rows = await diffs('hcpround01');
    check('plate 1 of a go has no differential of its own (it is not a round for the handicap)', rows.length === 1 && rows[0].d === null && r.json.handicap && r.json.handicap.differential === null, JSON.stringify(rows) + JSON.stringify(r.json.handicap));
    r = await hpost(H2, 15, 'hcpround01', 1);
    rows = await diffs('hcpround01');
    const wantD = Math.round((113 / hRow.sr) * (29 - hRow.cr) * 10) / 10;
    check('the last plate carries the differential of the whole go: 14 + 15 = 29 on the collection\'s rating', rows.length === 2 && rows[0].d === null && rows[1].d === wantD && r.json.handicap.differential === wantD, JSON.stringify(rows) + ' want ' + wantD);
    await hpost(H2, 13, 'hcpround01', 1, 'hcpround01-p1-retry');
    rows = await diffs('hcpround01');
    const wantD2 = Math.round((113 / hRow.sr) * (27 - hRow.cr) * 10) / 10;
    check('a plate sent again moves the differential to the newest record: still exactly one for the go (14 + 13 = 27)', rows.filter(x => x.d !== null).length === 1 && rows[rows.length - 1].d === wantD2, JSON.stringify(rows) + ' want ' + wantD2);
    r = await api('POST', '/api/courses/' + H1 + '/results', { total_score: 14, score_vs_par: 2, hole_scores: [5, 5, 4], input_mode: 'SWING_METER', player_name: 'Hcp' }, hcpUser);
    check('a round on a plate played on its own still gets its own differential (113/113 x (14 - 12) = 2.0)', r.json.handicap && r.json.handicap.differential === 2, JSON.stringify(r.json.handicap));

    // several local players under one signed-in account: only the account holder (seat 0) gets a differential, a guest's go does not count for the handicap
    const multiUser = 'e2c-Multi-' + tag;
    for (const seat of [0, 1, 2]) {
      for (const [course, score, pi] of [[H1, 14 + seat, 0], [H2, 15 + seat, 1]]) {
        await api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', player_name: 'Gast' + seat,
          stats: { collection_id: hid, collection_round_id: 'multi01', plate_index: pi, round_id: 'multi01-p' + pi + '-' + seat, player_slot: seat } }, multiUser);
      }
    }
    const multiRows = (await pool.query("SELECT stats->>'player_slot' AS seat, score_differential::float AS d FROM course_records WHERE player_id = $1 AND stats->>'collection_round_id' = 'multi01' AND score_differential IS NOT NULL", [multiUser])).rows;
    check('three local players on one account: only the account holder\'s go (seat 0) carries a differential, 14 + 15 = 29 on the collection\'s rating', multiRows.length === 1 && multiRows[0].seat === '0' && multiRows[0].d === Math.round((113 / hRow.sr) * (29 - hRow.cr) * 10) / 10, JSON.stringify(multiRows));

    // ordinary courses, several local players on one account: only the account holder (seat 0) counts for the handicap, a guest's round does not;
    // a client that does not say which seat it is (an older page, another app) is the account holder, as before
    const ordUser = 'e2c-Ord-' + tag;
    const ord = (seat, score, extra) => api('POST', '/api/courses/' + H1 + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', player_name: 'Spelare' + seat,
      stats: extra === 'noslot' ? undefined : { player_slot: seat } }, ordUser);
    const ordHolder = await ord(0, 14), ordGuest1 = await ord(1, 15), ordGuest2 = await ord(2, 16), ordOld = await ord(0, 13, 'noslot');
    const ordRows = (await pool.query("SELECT player_name, score_differential::float AS d, net_score FROM course_records WHERE player_id = $1 ORDER BY id", [ordUser])).rows;
    check('several local players on one account, ordinary course: only the account holder (seat 0) gets a differential (113/113 x (14 - 12) = 2); guests are on the leaderboard but not in the handicap',
      ordRows.length === 4 && ordRows[0].d === 2 && ordRows[1].d === null && ordRows[2].d === null && ordHolder.json.handicap.differential === 2 && ordGuest1.json.handicap.differential === null && ordGuest2.json.handicap.new === null,
      JSON.stringify(ordRows));
    check('a client that does not say its seat is the account holder: its round still counts (13 => 1)', ordRows[3].d === 1 && ordOld.json.handicap.differential === 1, JSON.stringify(ordRows[3]));
    const ordBoard = (await api('GET', '/api/courses/' + H1 + '/leaderboard')).json.leaderboard || [];
    check('and the guests are on the course\'s leaderboard under their own names', ['Spelare1', 'Spelare2'].every(n => ordBoard.some(x => x.player_name === n)), JSON.stringify(ordBoard.map(x => x.player_name)));

    // a result on a course that is NOT in the collection, with the collection's stats on it, is no part of the go
    const xpost = (course, score, retryId) => api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', player_name: 'Hcp',
      stats: { collection_id: hid, collection_round_id: 'forge01', plate_index: 0, round_id: retryId, player_slot: 0 } }, hcpUser);
    const X1 = tag + '-X1';
    await xpost(X1, 13, 'forge01-px-0');
    r = await xpost(H1, 14, 'forge01-p0-0');
    let fr = (await pool.query("SELECT course_code, score_differential::float AS d FROM course_records WHERE player_id = $1 AND stats->>'collection_round_id' = 'forge01' ORDER BY id", [hcpUser])).rows;
    check('a result on another course with the collection\'s stats does not stand in for a plate: one real plate of two gives no differential, and the other course keeps its own (113/113 x (13 - 10) = 3)', r.json.handicap.differential === null && fr.length === 2 && fr[0].d === 3 && fr[1].d === null, JSON.stringify(fr));
    r = await xpost(H2, 16, 'forge01-p1-0');
    fr = (await pool.query("SELECT course_code, score_differential::float AS d FROM course_records WHERE player_id = $1 AND stats->>'collection_round_id' = 'forge01' ORDER BY id", [hcpUser])).rows;
    const wantF = Math.round((113 / hRow.sr) * (30 - hRow.cr) * 10) / 10;
    check('with both real plates the go is 14 + 16 on the collection\'s rating, the other course is still left out and keeps its own differential', fr.length === 3 && fr[0].d === 3 && fr[1].d === null && fr[2].d === wantF && r.json.handicap.differential === wantF, JSON.stringify(fr) + ' want ' + wantF);

    // a go whose finishing step did not happen (the request stopped after the record was stored): sending the plate again finishes it
    await hpost(H1, 14, 'repair01', 0);
    await hpost(H2, 15, 'repair01', 1);
    const wantR = Math.round((113 / hRow.sr) * (29 - hRow.cr) * 10) / 10;
    await pool.query("UPDATE course_records SET score_differential = NULL WHERE player_id = $1 AND stats->>'collection_round_id' = 'repair01'", [hcpUser]);
    r = await hpost(H2, 15, 'repair01', 1);
    rows = await diffs('repair01');
    check('sending a plate again after its finishing step was lost repairs the go: answered as a duplicate, and the differential is back on the newest record', r.json.duplicate === true && rows.length === 2 && rows[0].d === null && rows[1].d === wantR, JSON.stringify(rows) + ' want ' + wantR + ' ' + JSON.stringify(r.json));

    // a retry of a finished go, after its collection was renamed, does not rewrite what was captured when the go was completed
    await pool.query("INSERT INTO users (id, display_name) VALUES ($1, 'E2C Hcp') ON CONFLICT (id) DO NOTHING", [hcpUser]);
    await pool.query("UPDATE course_collections SET name = 'Omdopt' WHERE id = $1", [hid]);
    r = await hpost(H2, 15, 'repair01', 1);
    const keptRows = await diffs('repair01');
    const keptHist = (await api('GET', '/api/users/' + hcpUser + '/handicap')).json.recent_rounds || [];
    const keptRow = keptHist.find(x => x.collection_id === hid && parseFloat(x.score_differential) === wantR);
    await pool.query("UPDATE course_collections SET name = 'Handicap' WHERE id = $1", [hid]);
    check('a retry of a finished go after the collection was renamed leaves the go as it was captured (the old name, the same differential)', r.json.duplicate === true && keptRows.filter(x => x.d !== null).length === 1 && !!keptRow && keptRow.collection_name === 'Handicap', JSON.stringify(keptRow));

    // the handicap history shows a go through a collection as one round: all its plates' strokes, the collection, and the differential for them
    await pool.query("INSERT INTO users (id, display_name) VALUES ($1, 'E2C Hcp') ON CONFLICT (id) DO NOTHING", [hcpUser]);
    let hist = await api('GET', '/api/users/' + hcpUser + '/handicap');
    const histRow = (hist.json.recent_rounds || []).find(x => x.collection_id === hid && parseFloat(x.score_differential) === wantR);
    check('the handicap history shows a collection round as one round: 14 + 15 = 29 strokes, the collection\'s name and no single plate, next to the differential worked out from 29', !!histRow && histRow.total_score === 29 && histRow.score_vs_par === (14 - 12) + (15 - 12) && histRow.course_code === null && histRow.collection_name === 'Handicap', JSON.stringify(hist.json.recent_rounds));
    const plainRow = (hist.json.recent_rounds || []).find(x => x.course_code === H1 && x.collection_id === undefined);
    check('and a round on a plate played on its own is shown as it was (its own strokes and course)', !!plainRow && plainRow.total_score === 14 && parseFloat(plainRow.score_differential) === 2, JSON.stringify(plainRow));

    // a result on another course that only CLAIMS to belong to a go is an ordinary row: it is not the record that carries the go
    const forgedRow = (hist.json.recent_rounds || []).find(x => x.course_code === X1);
    check('a result on another course with the collection\'s stats stays an ordinary row in the history (its own course and strokes and its own differential)', !!forgedRow && forgedRow.total_score === 13 && forgedRow.collection_id === undefined && parseFloat(forgedRow.score_differential) === 3, JSON.stringify(forgedRow));

    // the plates of a collection are changed after a go: the go is shown as it was
    r = await api('POST', '/api/collections', { name: 'Byte', author: 'Test', type: '6', plates: [plate(H1), plate(H2)] }, owner);
    const swapId = r.json.id; madeCollections.push(swapId);
    for (const [course, score, pi] of [[H1, 14, 0], [H2, 15, 1]]) {
      await api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', player_name: 'Hcp',
        stats: { collection_id: swapId, collection_round_id: 'swap01', plate_index: pi, round_id: 'swap01-p' + pi + '-0', player_slot: 0 } }, hcpUser);
    }
    await api('POST', '/api/collections', { id: swapId, name: 'Byte', author: 'Test', type: '6', plates: [plate(H1)] }, owner);
    hist = await api('GET', '/api/users/' + hcpUser + '/handicap');
    const swapRow = (hist.json.recent_rounds || []).find(x => x.collection_id === swapId);
    check('a go is still shown whole after its collection has had its plates changed (29 strokes, as played)', !!swapRow && swapRow.total_score === 29 && swapRow.score_vs_par === 5 && swapRow.course_code === null, JSON.stringify(swapRow));

    // the snapshot is the server's: one sent in by a client is dropped
    r = await api('POST', '/api/courses/' + H1 + '/results', { total_score: 15, score_vs_par: 3, hole_scores: [5, 5, 5], input_mode: 'SWING_METER', player_name: 'Hcp', stats: { collection_go: { total_score: 999, score_vs_par: 99, collection_id: 'FAKE', collection_name: 'Fake' } } }, hcpUser);
    const sent = (await pool.query("SELECT stats FROM course_records WHERE id = $1", [r.json.record_id])).rows[0];
    hist = await api('GET', '/api/users/' + hcpUser + '/handicap');
    check('a snapshot of a collection round sent in by a client is dropped: nothing stored, and the history shows the plain round', sent.stats.collection_go === undefined && !(hist.json.recent_rounds || []).some(x => x.total_score === 999 || x.collection_id === 'FAKE'), JSON.stringify(sent.stats));

    // a collection from before ratings existed (none stored): they are worked out when needed, so its go still counts for the handicap
    const oldId = 'O' + tag.slice(-5).replace('-', 'X');
    await pool.query("INSERT INTO course_collections (id, name, author, type, plates, owner_id) VALUES ($1, 'Fore betyg', 'Test', '6', $2::jsonb, $3)", [oldId, JSON.stringify([plate(H1), plate(H2)]), owner]);
    madeCollections.push(oldId);
    const oldCol = (await api('GET', '/api/collections/' + oldId)).json;
    check('a collection saved before ratings existed gets its stroke index and ratings when it is read', Array.isArray(oldCol.stroke_index) && oldCol.stroke_index.length === 6 && parseFloat(oldCol.course_rating) === 24, JSON.stringify([oldCol.stroke_index, oldCol.course_rating]));
    await pool.query('UPDATE course_collections SET course_rating = NULL, slope_rating = NULL, stroke_index = NULL WHERE id = $1', [oldId]);
    const opost = (course, score, plateIndex) => api('POST', '/api/courses/' + course + '/results', { total_score: score, score_vs_par: score - 12, hole_scores: [score / 3, score / 3, score / 3], input_mode: 'SWING_METER', player_name: 'Hcp',
      stats: { collection_id: oldId, collection_round_id: 'oldround01', plate_index: plateIndex, round_id: 'oldround01-p' + plateIndex + '-0', player_slot: 0 } }, hcpUser);
    await opost(H1, 14, 0); r = await opost(H2, 15, 1);
    const wantO = Math.round((113 / 113) * (29 - 24) * 10) / 10;
    check('and a go through it, played before the ratings were stored, still gets its differential (the ratings are worked out when the result comes in)', r.json.handicap.differential === wantO, JSON.stringify(r.json.handicap) + ' want ' + wantO);

    // a deleted collection: its rounds are still whole in the handicap history
    await pool.query('DELETE FROM course_collections WHERE id = $1', [oldId]);
    hist = await api('GET', '/api/users/' + hcpUser + '/handicap');
    const goneRow = (hist.json.recent_rounds || []).find(x => x.collection_id === oldId);
    check('a round through a collection that has since been deleted is still shown whole, as it was (29 strokes, no single plate, the collection\'s name)', !!goneRow && goneRow.total_score === 29 && goneRow.course_code === null && goneRow.collection_name === 'Fore betyg' && parseFloat(goneRow.score_differential) === wantO, JSON.stringify(goneRow));

    // a partly built collection (one plate of the two its type has room for) can be played, but its go is no round for the handicap
    r = await api('POST', '/api/collections', { name: 'Halv', author: 'Test', type: '6', plates: [plate(H1)] }, owner);
    const incId = r.json.id; madeCollections.push(incId);
    r = await api('POST', '/api/courses/' + H1 + '/results', { total_score: 14, score_vs_par: 2, hole_scores: [5, 5, 4], input_mode: 'SWING_METER', player_name: 'Hcp',
      stats: { collection_id: incId, collection_round_id: 'incround01', plate_index: 0, round_id: 'incround01-p0-0', player_slot: 0 } }, hcpUser);
    const incRows = (await pool.query("SELECT score_differential FROM course_records WHERE player_id = $1 AND stats->>'collection_round_id' = 'incround01'", [hcpUser])).rows;
    check('the only plate of a collection with room for two gives no differential (a 3-hole result must not count as a collection round)', r.json.success && incRows.length === 1 && incRows[0].score_differential === null && r.json.handicap.differential === null, JSON.stringify(incRows) + JSON.stringify(r.json.handicap));

    // an old collection row lists its plates as bare codes (any case): a plate saved again refreshes it too
    const legacyId = 'L' + tag.slice(-5).replace('-', 'X');
    await pool.query("INSERT INTO course_collections (id, name, author, type, plates, owner_id) VALUES ($1, 'Gammal', 'Test', '6', $2::jsonb, $3)", [legacyId, JSON.stringify([(tag + '-L1').toLowerCase()]), owner]);
    madeCollections.push(legacyId);
    r = await api('POST', '/api/courses', { edit_code: tag + '-L1', name: 'Platta L1', author: 't', holes: JSON.parse(holesOf([100, 300, 200])), is_draft: false, hole_count: 3, total_par: 12 }, owner);
    const legacyRow = (await pool.query('SELECT stroke_index, course_rating::float AS cr FROM course_collections WHERE id = $1', [legacyId])).rows[0];
    check('a collection that lists its plates as bare codes is refreshed when a plate is saved again (lengths 100 300 200 + padding)', r.status === 200 && JSON.stringify(legacyRow.stroke_index.slice(0, 3)) === JSON.stringify([3, 1, 2]) && legacyRow.cr !== null, JSON.stringify(legacyRow));

    // a collection that cannot be brought up to date takes the publish back too (and a malformed collection row does not block publishing)
    r = await api('POST', '/api/collections', { name: 'Fast', author: 'Test', type: '6', plates: [plate(tag + '-F1')] }, owner);
    madeCollections.push(r.json.id);
    await pool.query("INSERT INTO course_collections (id, name, author, type, plates, owner_id) VALUES ($1, 'Trasig', 'Test', '6', '{\"inte\": \"en lista\"}'::jsonb, $2)", ['B' + tag.slice(-5).replace('-', 'X'), owner]);
    madeCollections.push('B' + tag.slice(-5).replace('-', 'X'));
    await pool.query('ALTER TABLE course_collections ADD CONSTRAINT e2c_block CHECK (course_rating IS NULL OR course_rating < 0) NOT VALID');
    const beforeF = (await pool.query('SELECT name, version FROM courses WHERE share_code = $1', [tag + '-F1'])).rows[0];
    r = await api('POST', '/api/courses', { edit_code: tag + '-F1', name: 'Ny F1', author: 't', holes: JSON.parse(holesOf([100, 300, 200])), is_draft: false, hole_count: 3, total_par: 12 }, owner);
    const afterF = (await pool.query('SELECT name, version FROM courses WHERE share_code = $1', [tag + '-F1'])).rows[0];
    check('when its collections cannot be brought up to date the publish fails and changes nothing (not a success with stale collections)', r.status === 500 && afterF.name === beforeF.name && afterF.version === beforeF.version, r.status + ' ' + JSON.stringify([beforeF, afterF]));
    await pool.query('ALTER TABLE course_collections DROP CONSTRAINT e2c_block');
    r = await api('POST', '/api/courses', { edit_code: tag + '-F1', name: 'Ny F1', author: 't', holes: JSON.parse(holesOf([100, 300, 200])), is_draft: false, hole_count: 3, total_par: 12 }, owner);
    const fRow = (await pool.query("SELECT stroke_index FROM course_collections WHERE plates @> $1::jsonb", [JSON.stringify([{ plate_code: tag + '-F1' }])])).rows[0];
    check('and the same publish goes through once it can: the plate and its collection are updated together (a malformed collection row is ignored)', r.status === 200 && fRow && JSON.stringify(fRow.stroke_index.slice(0, 3)) === JSON.stringify([3, 1, 2]), r.status + ' ' + JSON.stringify(fRow));

    // a collection saved while one of its plates is being published again: the save waits for the publish and reads the plate's NEW holes
    // (the publish is held open here by a lock on the plate's row, as a slow publish would hold it)
    const lockPlate = tag + '-F1';
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM courses WHERE share_code = $1 FOR UPDATE', [lockPlate]);
    const racing = api('POST', '/api/collections', { name: 'Kapplopning', author: 'Test', type: '6', plates: [plate(lockPlate)] }, owner);
    await wait(900);   // the save is now waiting for the lock: it has not read the old holes
    await holder.query('UPDATE courses SET holes = $2::jsonb WHERE share_code = $1', [lockPlate, holesOf([500, 100, 300])]);
    await holder.query('COMMIT'); holder.release();
    const raced = await racing;
    if (raced.json.id) madeCollections.push(raced.json.id);
    const racedRow = (await pool.query('SELECT stroke_index FROM course_collections WHERE id = $1', [raced.json.id])).rows[0];
    check('a collection saved while a plate is being published gets the new holes of the plate, not the old (500 100 300 => 1 3 2)', raced.status === 200 && racedRow && JSON.stringify(racedRow.stroke_index.slice(0, 3)) === JSON.stringify([1, 3, 2]), JSON.stringify(raced) + JSON.stringify(racedRow));

    // two plates of one collection published at the same moment take turns: the second reads the first one's new holes (the collection's row is locked
    // first; here another publish is held in its refresh by a lock on the collection's row, and commits its plate while ours waits)
    r = await api('POST', '/api/collections', { name: 'Tva samtidigt', author: 'Test', type: '6', plates: [plate(tag + '-Z1'), plate(tag + '-Z2')] }, owner);
    const zId = r.json.id; madeCollections.push(zId);
    const zHolder = await pool.connect();
    await zHolder.query('BEGIN');
    await zHolder.query('SELECT 1 FROM course_collections WHERE id = $1 FOR UPDATE', [zId]);
    const zPublish = api('POST', '/api/courses', { edit_code: tag + '-Z2', name: 'Platta Z2', author: 't', holes: JSON.parse(holesOf([200, 400, 600])), is_draft: false, hole_count: 3, total_par: 12 }, owner);
    await wait(900);   // Z2 is stored (not yet committed) and its refresh waits for the collection's lock
    await zHolder.query('UPDATE courses SET holes = $2::jsonb WHERE share_code = $1', [tag + '-Z1', holesOf([500, 100, 300])]);
    await zHolder.query('COMMIT'); zHolder.release();
    r = await zPublish;
    const zRow = (await pool.query('SELECT stroke_index FROM course_collections WHERE id = $1', [zId])).rows[0];
    check('two plates of a collection published at the same moment: the collection ends with the new holes of both (500 100 300 | 200 400 600 => 2 6 4 5 3 1), not a mix', r.status === 200 && JSON.stringify(zRow.stroke_index) === JSON.stringify([2, 6, 4, 5, 3, 1]), r.status + ' ' + JSON.stringify(zRow));

    // a plate saved again: the collections it is in get their stroke index and ratings from the plates as they are now (B: 600 100 100)
    r = await api('POST', '/api/courses', { edit_code: B, name: 'Platta B', author: 't', holes: JSON.parse(holesOf([600, 100, 100])), is_draft: false, hole_count: 3, total_par: 12 }, owner);
    const colAfter = (await api('GET', '/api/collections/' + id)).json;
    check('when plate B is published again the collection\'s stroke index follows (lengths 150 400 250 | 600 100 100)', r.status === 200 && JSON.stringify(colAfter.stroke_index) === JSON.stringify([4, 2, 3, 1, 5, 6]), r.status + ' ' + JSON.stringify(colAfter.stroke_index) + JSON.stringify(r.json));

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
