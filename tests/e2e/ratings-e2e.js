// End-to-end test of the published lists and ratings: the real server.js against a real Postgres, over HTTP, no browser.
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/ratings-e2e.js
// Covers: everyone sees every published course and range (not drafts, not hidden ones), searching, sorting and paging the lists, and the
// ratings: 1 to 5 stars, one per player (a new one replaces theirs), not one's own course, not a draft or a hidden one, a wrong number refused;
// the average, the count and the caller's own stars come with each row of the lists.
// It only touches rows of its own: courses tagged 'E2R<random>...', their ratings and the users made here.
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  ratings e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
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
  // share codes are at most 20 characters
  const tag = 'E2R' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
  const owner = 'e2r-owner-' + tag, p1 = 'e2r-p1-' + tag, p2 = 'e2r-p2-' + tag, p3 = 'e2r-p3-' + tag;
  async function api(method, url, body, user) {
    const res = await fetch(BASE + url, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, user ? { 'x-user-id': user } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch (e) { /* none */ }
    return { status: res.status, json: json === null ? {} : json };
  }
  async function cleanup() {
    try { await pool.query('DELETE FROM course_ratings WHERE share_code LIKE $1', [tag + '%']); } catch (e) { /* none */ }
    try { await pool.query('DELETE FROM courses WHERE share_code LIKE $1', [tag + '%']); } catch (e) { /* none */ }
    try { await pool.query('DELETE FROM users WHERE id LIKE $1', ['e2r-%-' + tag]); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + '/api/health'); up = (await r.json()).db_connected === true; } catch (e) { /* not yet */ } if (!up) await new Promise(function (r) { setTimeout(r, 500); }); }
    if (!up) { console.error('server did not come up with a database'); await cleanup(); process.exit(2); }

    // the ratings table is made when the server starts
    for (let i = 0; i < 20; i++) { const t = await pool.query("SELECT to_regclass('course_ratings') AS t"); if (t.rows[0].t) break; await new Promise(function (r) { setTimeout(r, 250); }); }

    const mk = function (suffix, o) {
      return pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, is_range, is_hidden, owner_id, hole_count, total_par, play_count, updated_at) VALUES ($1,$2,$3,'[]'::jsonb,$4,$5,$6,$7,3,12,$8, NOW() - ($9 || ' minutes')::interval)",
        [tag + suffix, o.name || ('Bana ' + tag + ' ' + suffix), o.author || 'Testaren', !!o.draft, !!o.range, !!o.hidden, owner, o.plays || 0, String(o.age || 0)]);
    };
    await mk('A', { name: 'Ängen ' + tag, plays: 5, age: 3 });
    await mk('B', { name: 'Berget ' + tag, plays: 50, age: 2 });
    await mk('C', { name: 'Kusten ' + tag, plays: 1, age: 1 });
    await mk('D', { draft: true });
    await mk('H', { hidden: true });
    await mk('R1', { range: true, name: 'Rangen ' + tag });
    await mk('R2', { range: true, hidden: true, name: 'Dold range ' + tag });
    await mk('R3', { range: true, draft: true, name: 'Utkast range ' + tag });

    // everyone can pick every published course and range: search for this test's own rows
    let r = await api('GET', '/api/courses?q=' + tag);
    let codes = r.json.map ? r.json.map(x => x.share_code) : [];
    check('the course list holds the published courses, not drafts, hidden ones or ranges', r.status === 200 && codes.length === 3 && codes.indexOf(tag + 'D') < 0 && codes.indexOf(tag + 'H') < 0 && codes.indexOf(tag + 'R1') < 0, JSON.stringify(codes));
    r = await api('GET', '/api/ranges?q=' + tag);
    codes = r.json.map ? r.json.map(x => x.share_code) : [];
    check('the range list holds the published ranges, not a hidden one or a draft', r.status === 200 && codes.length === 1 && codes[0] === tag + 'R1', JSON.stringify(codes));
    check('no owner id goes out in the list', r.json[0] && r.json[0].owner_id === undefined && typeof r.json[0].owner_ref === 'string', JSON.stringify(r.json[0]));
    r = await api('GET', '/api/courses?q=' + encodeURIComponent('berget ' + tag.toLowerCase()));
    check('search matches the name whatever the case', r.json.length === 1 && r.json[0].share_code === tag + 'B', JSON.stringify(r.json));
    r = await api('GET', '/api/courses?q=' + (tag + 'b').toLowerCase());
    check('search matches the share code too (players pass codes around)', r.json.length === 1 && r.json[0].share_code === tag + 'B', JSON.stringify(r.json.map(x => x.share_code)));
    r = await api('GET', '/api/courses?q=' + encodeURIComponent('%'));
    check('a % in the search is a character, not a wildcard', r.status === 200 && Array.isArray(r.json) && r.json.every(x => /%/.test(x.name + x.author)), JSON.stringify(r.json.slice(0, 2)));
    r = await api('GET', '/api/courses?q=' + tag + '&sort=popular');
    check('sort=popular: the most played first', r.json.map(x => x.share_code).join() === [tag + 'B', tag + 'A', tag + 'C'].join(), JSON.stringify(r.json.map(x => x.share_code)));
    r = await api('GET', '/api/courses?q=' + tag);
    check('the default order is the newest first', r.json.map(x => x.share_code).join() === [tag + 'C', tag + 'B', tag + 'A'].join(), JSON.stringify(r.json.map(x => x.share_code)));
    r = await api('GET', '/api/courses?q=' + tag + '&offset=2');
    check('offset gives the next page', r.json.length === 1 && r.json[0].share_code === tag + 'A', JSON.stringify(r.json));
    check('a course nobody rated has no average and a count of 0', r.json[0].rating_avg === null && r.json[0].rating_count === 0 && r.json[0].my_rating === null, JSON.stringify(r.json[0]));

    // rating
    r = await api('POST', '/api/courses/' + tag + 'A/rating', { stars: 4 });
    check('rating needs a player (401 without one)', r.status === 401, JSON.stringify(r));
    r = await api('POST', '/api/courses/' + tag + 'A/rating', { stars: 4 }, owner);
    check('one\'s own course cannot be rated (403)', r.status === 403, JSON.stringify(r));
    for (const bad of [0, 6, 3.5, 'fem', null]) {
      r = await api('POST', '/api/courses/' + tag + 'A/rating', { stars: bad }, p1);
      if (r.status !== 400) break;
    }
    check('stars outside 1 to 5, or not whole, are refused (400)', r.status === 400, JSON.stringify(r));
    r = await api('POST', '/api/courses/' + tag + 'D/rating', { stars: 5 }, p1);
    const rh = await api('POST', '/api/courses/' + tag + 'H/rating', { stars: 5 }, p1);
    const rn = await api('POST', '/api/courses/' + tag + 'NOPE/rating', { stars: 5 }, p1);
    check('a draft, a hidden course and one that does not exist cannot be rated (404)', r.status === 404 && rh.status === 404 && rn.status === 404, JSON.stringify([r.status, rh.status, rn.status]));

    r = await api('POST', '/api/courses/' + tag + 'A/rating', { stars: 4 }, p1);
    check('a player rates a course: the answer has the average, the count and their stars', r.status === 200 && r.json.rating_avg === 4 && r.json.rating_count === 1 && r.json.my_rating === 4, JSON.stringify(r.json));
    r = await api('POST', '/api/courses/' + tag + 'A/rating', { stars: 2 }, p1);
    check('rating again replaces the player\'s rating (still one)', r.status === 200 && r.json.rating_avg === 2 && r.json.rating_count === 1 && r.json.my_rating === 2, JSON.stringify(r.json));
    await api('POST', '/api/courses/' + tag + 'A/rating', { stars: 5 }, p2);
    r = await api('POST', '/api/courses/' + tag + 'A/rating', { stars: 4 }, p3);
    check('three players: the average of their stars, rounded to a tenth', r.json.rating_avg === 3.7 && r.json.rating_count === 3, JSON.stringify(r.json));
    r = await api('POST', '/api/courses/' + tag + 'R1/rating', { stars: 5 }, p1);
    check('a range is rated the same way', r.status === 200 && r.json.rating_avg === 5 && r.json.rating_count === 1, JSON.stringify(r.json));

    r = await api('GET', '/api/courses/' + tag + 'A/rating', undefined, p2);
    check('a course\'s rating with the caller\'s own stars', r.status === 200 && r.json.rating_avg === 3.7 && r.json.rating_count === 3 && r.json.my_rating === 5 && r.json.is_mine === false, JSON.stringify(r.json));
    r = await api('GET', '/api/courses/' + tag + 'A/rating', undefined, owner);
    check('the owner sees it is their own (and has no stars of their own)', r.json.is_mine === true && r.json.my_rating === null, JSON.stringify(r.json));
    r = await api('GET', '/api/courses/' + tag + 'A/rating');
    check('without a player: the average and count only', r.json.rating_count === 3 && r.json.my_rating === null && r.json.is_mine === false, JSON.stringify(r.json));

    r = await api('GET', '/api/courses?q=' + tag, undefined, p2);
    const rowA = r.json.find(x => x.share_code === tag + 'A');
    check('the list carries each row\'s average, count and the caller\'s own stars', rowA && rowA.rating_avg === 3.7 && rowA.rating_count === 3 && rowA.my_rating === 5, JSON.stringify(rowA));
    // B: one 5 (a single vote); C: many 4s and 5s
    await api('POST', '/api/courses/' + tag + 'B/rating', { stars: 5 }, p1);
    for (const u of [p1, p2, p3]) await api('POST', '/api/courses/' + tag + 'C/rating', { stars: 5 }, u);
    r = await api('GET', '/api/courses?q=' + tag + '&sort=top');
    check('sort=top: three 5s before a single 5, before a 3.7', r.json.map(x => x.share_code).join() === [tag + 'C', tag + 'B', tag + 'A'].join(), JSON.stringify(r.json.map(x => [x.share_code, x.rating_avg, x.rating_count])));
    r = await api('GET', '/api/ranges?q=' + tag, undefined, p1);
    check('the range list carries the rating too', r.json[0] && r.json[0].rating_avg === 5 && r.json[0].my_rating === 5, JSON.stringify(r.json[0]));

    // deleting a course takes its ratings with it
    r = await api('DELETE', '/api/courses/' + tag + 'A', undefined, owner);
    const left = (await pool.query('SELECT COUNT(*)::int AS n FROM course_ratings WHERE share_code = $1', [tag + 'A'])).rows[0].n;
    check('a deleted course\'s ratings go with it', r.status === 200 && left === 0, JSON.stringify([r.status, left]));
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nRatings e2e: all checks passed');
  process.exit(failed ? 1 : 0);
})();
