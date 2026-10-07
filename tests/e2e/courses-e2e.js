// End-to-end test of saved and published courses: the real server.js against a real Postgres, driven through the real pages in Chromium.
//   E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test npm run e2e
// Needs a Postgres on localhost (the test refuses any other host) and the browser libraries of the smoke test (npm --prefix tests install).
// It only touches rows of its own: courses owned by the browser's fresh device id and the filler rows tagged 'E2E-<random>-...'.
//
// Covers: save a draft (twice: one record), list it, reopen it with its greens / fairways / bunkers / tee boxes, publish it (the same record,
// not a copy), "My published" next to 60 newer courses of others, reopen the published course in the builder with its definitions, publish a
// new version, builder data for the owner only, the working copy that remembers its course, Save draft never unpublishes, play copies stay out
// of the lists, and deleting a draft.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const URL_DB = process.env.E2E_DATABASE_URL;
if (!URL_DB) { console.log('SKIP  courses e2e: set E2E_DATABASE_URL to a Postgres on localhost'); process.exit(0); }
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_DB)) { console.error('Refusing to run: E2E_DATABASE_URL must point at localhost'); process.exit(2); }

function need(root, mod) { try { return require(path.join(root, 'node_modules', mod)); } catch (e) { console.error('Missing "' + mod + '". Run: npm install && npm --prefix tests install'); process.exit(2); } }
const { chromium } = need(TESTS, 'playwright-core');
const { Pool } = need(ROOT, 'pg');
const NM = path.join(TESTS, 'node_modules') + '/';
const CDN = {
  'three.min.js': NM + 'three/build/three.min.js', 'OrbitControls.js': NM + 'three/examples/js/controls/OrbitControls.js',
  'GLTFLoader.js': NM + 'three/examples/js/loaders/GLTFLoader.js', 'DRACOLoader.js': NM + 'three/examples/js/loaders/DRACOLoader.js', 'pako.min.js': NM + 'pako/dist/pako.min.js',
};
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { const b = '/opt/pw-browsers'; const d = fs.readdirSync(b).filter(function (n) { return /^chromium-\d+$/.test(n); }).sort().pop(); if (d) return path.join(b, d, 'chrome-linux', 'chrome'); } catch (e) { /* none */ }
  return undefined;
}
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; }

(async function () {
  const pool = new Pool({ connectionString: URL_DB });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const BASE = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: URL_DB }), stdio: 'ignore' });
  let deviceId = null, browser = null;
  const tag = 'E2E-' + require('crypto').randomBytes(3).toString('hex').toUpperCase(); // the application's own share codes never contain a hyphen
  async function cleanup() {
    try { if (deviceId) await pool.query('DELETE FROM course_records WHERE course_code IN (SELECT share_code FROM courses WHERE owner_id = $1)', [deviceId]); } catch (e) { /* none */ }
    try { await pool.query("DELETE FROM courses WHERE owner_id = $1 OR share_code LIKE $2", [deviceId || 'none', tag + '-%']); } catch (e) { /* none */ }
    try { if (browser) await browser.close(); } catch (e) { /* none */ }
    server.kill(); await pool.end();
  }
  try {
    for (let i = 0; i < 60; i++) { try { await new Promise(function (res, rej) { http.get(BASE + '/api/health', function (r) { let b = ''; r.on('data', function (c) { b += c; }); r.on('end', function () { /"db_connected":true/.test(b) ? res() : rej(); }); }).on('error', rej); }); break; } catch (e) { await wait(500); if (i === 59) throw new Error('server did not start'); } }

    browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, function (r) { const k = Object.keys(CDN).find(function (n) { return r.request().url().endsWith(n); }); if (k) r.fulfill({ body: fs.readFileSync(CDN[k]), contentType: 'application/javascript' }); else r.abort(); });
    // build.html talks to the production host: send it to the server under test
    await ctx.route('https://3d-golf-ar-production.up.railway.app/**', async function (r) { try { const u = new URL(r.request().url()); await r.fulfill({ response: await r.fetch({ url: BASE + u.pathname + u.search }) }); } catch (e) { r.abort(); } });
    await ctx.route(/^https:\/\/(?!cdn|3d-golf)/, function (r) { r.abort(); });
    const page = await ctx.newPage();
    page.on('dialog', function (d) { d.accept(); });

    const open = async function (q, ms) {
      await page.goto(BASE + '/arcade.html?' + q, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(function () { return window._courseLoading === false; }, null, { timeout: 120000 });
      await wait(ms || 5000);
    };
    const state = function () { return page.evaluate(function () { const h = courseHoles[0]; return { code: currentEditCode, published: !!window._editIsPublished, name: document.getElementById('course-name-input').value, flag: !!h.flag, green: !!h.greenData, fairways: (h.fairways || []).length, bunkers: (h.bunkers || []).length, teeBoxes: (h.teeBoxes || []).length, draftBtn: document.getElementById('btn-save-draft').style.display, search: location.search }; }); };
    const rows = async function () { return (await pool.query("SELECT share_code, name, is_draft, version, theme_data->>'_playCopy' AS copy FROM courses WHERE owner_id = $1 ORDER BY id", [deviceId])).rows; };
    const cards = function (sel) { return page.evaluate(function (s) { return Array.from(document.querySelectorAll(s + ' .card-title')).map(function (e) { return e.textContent; }); }, sel); };
    const listPage = async function () { await page.goto(BASE + '/build.html', { waitUntil: 'domcontentloaded', timeout: 60000 }); await wait(3500); };
    const publish = function () { return page.evaluate(function () { window._bypassCapture = true; return publishCourse({ isDraft: false }); }); };

    // 1. a new course with a built hole, saved as a draft
    await open('autorun=new_build&template=blank&biome=GLOBAL', 4000);
    deviceId = await page.evaluate(function () { return localStorage.getItem('golf_os_device_id'); });
    // a draft saved before anything is built gets its ratings from an empty course; they must follow the holes later
    await page.evaluate(function () { document.getElementById('course-name-input').value = 'E2E Bana'; document.getElementById('author-name-input').value = 'Tester'; return smartSaveDraft(); }); await wait(5000);
    const blankRating = (await pool.query('SELECT course_rating::float AS cr, slope_rating AS sr FROM courses WHERE owner_id = $1', [deviceId])).rows[0];
    await page.evaluate(function () { window.HoleGenerator.generate({ par: 4, seed: 12345 }); });
    await wait(2500);
    await page.evaluate(function () { return smartSaveDraft(); }); await wait(6000);
    let r = await rows();
    check('draft: saved as one draft on the server', r.length === 1 && r[0].is_draft === true && r[0].name === 'E2E Bana', JSON.stringify(r));
    const code = r[0] && r[0].share_code;
    check('draft: the address stays the builder\'s (a reload reopens the builder)', /autorun=edit_build/.test((await state()).search) && (await state()).search.indexOf(code) > 0);
    await page.evaluate(function () { document.getElementById('course-name-input').value = 'E2E Bana v2'; return smartSaveDraft(); }); await wait(5000);
    r = await rows();
    check('draft: saving again updates the same record', r.length === 1 && r[0].name === 'E2E Bana v2', JSON.stringify(r));

    // 2. it is listed, and reopens with everything the builder made
    await listPage();
    const drafts1 = await cards('#drafts-carousel');
    check('list: the draft is under My drafts', drafts1.indexOf('E2E Bana v2') >= 0, JSON.stringify(drafts1));
    await open('autorun=edit_build&edit=' + code, 6000);
    let st = await state();
    check('reopen draft: green, fairway, bunkers and tee boxes are back', st.flag && st.green && st.fairways === 1 && st.bunkers === 2 && st.teeBoxes === 3 && st.name === 'E2E Bana v2', JSON.stringify(st));

    // 3. publish: the draft becomes the published course (and the working copy knows it by the time publishing is reported done)
    const qd = await page.evaluate(async function () { window._bypassCapture = true; await publishCourse({ isDraft: false }); const d = await ArcadeStorage.loadFullDraft('quick_draft'); return { published: d.edit_is_published, code: d.edit_code }; });
    check('publish: the working copy is marked published before success is reported', qd.published === true && qd.code === code, JSON.stringify(qd));
    await wait(1500);
    r = await rows();
    check('publish: the draft became the published course (same record, no copy, version 1)', r.length === 1 && r[0].share_code === code && r[0].is_draft === false && r[0].version === 1, JSON.stringify(r));
    const ratings = (await pool.query('SELECT course_rating::float AS cr, slope_rating AS sr, stroke_index, hole_count FROM courses WHERE owner_id = $1', [deviceId])).rows[0];
    check('publish: ratings follow the built holes, not the empty draft saved first', blankRating && ratings && ratings.cr !== blankRating.cr && ratings.stroke_index && ratings.stroke_index.some(function (n) { return n > 0; }), JSON.stringify([blankRating, ratings]));
    check('publish: the address stays the builder\'s', /autorun=edit_build/.test((await state()).search));
    await listPage();
    const drafts2 = await cards('#drafts-carousel'), pub2 = await cards('#published-carousel');
    check('list: published course is under My published and no longer under My drafts', pub2.indexOf('E2E Bana v2') >= 0 && drafts2.indexOf('E2E Bana v2') < 0, JSON.stringify([drafts2, pub2]));

    const forPicker = await page.evaluate(function (c) { return { mine: myPublishedCourses().map(function (x) { return x.name; }), found: !!findCourseByCode(c) }; }, code);
    check('collections: the plate picker sees my published course', forPicker.mine.indexOf('E2E Bana v2') >= 0 && forPicker.found, JSON.stringify(forPicker));

    // 4. the published course reopens in the builder with its definitions; publishing again is a new version of the same course
    await open('autorun=edit_build&edit=' + code, 6000);
    st = await state();
    check('reopen published: green, fairway, bunkers and tee boxes are back, no Save draft button', st.green && st.fairways === 1 && st.bunkers === 2 && st.teeBoxes === 3 && st.draftBtn === 'none', JSON.stringify(st));
    await pool.query("UPDATE courses SET created_at = now() - interval '10 days' WHERE share_code = $1", [code]); // an old course: published again it must still lead the public list
    await pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, owner_id, created_at) VALUES ($1, 'Newer than mine', 'o', '[]'::jsonb, false, 'someone-else', now() - interval '1 day')", [tag + '-N']);
    await page.evaluate(function () { document.getElementById('course-name-input').value = 'E2E Bana v3'; }); await publish(); await wait(6000);
    r = await rows();
    check('publish again: a new version of the same course (not a second course)', r.length === 1 && r[0].version === 2 && r[0].name === 'E2E Bana v3', JSON.stringify(r));
    const pubList = await page.evaluate(async function () { return (await (await fetch('/api/courses')).json()).map(function (c) { return c.share_code; }); });
    check('public list: an old course that is published again is listed first (ordered by last publish, not by creation)', pubList[0] === code, JSON.stringify(pubList.slice(0, 3)));
    const api = await page.evaluate(async function (c) {
      const get = async function (h) { const j = await (await fetch('/api/courses/' + c, { headers: h })).json(); return { canEdit: j.can_edit, builder: !!j.builder_holes }; };
      return { owner: await get({ 'x-user-id': localStorage.getItem('golf_os_device_id') }), guest: await get({}) };
    }, code);
    check('builder data is for the owner only', api.owner.canEdit && api.owner.builder && !api.guest.canEdit && !api.guest.builder, JSON.stringify(api));

    // 5. My published is not limited to the newest 50 courses of everybody
    await pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, owner_id, created_at) SELECT $1 || '-' || g, 'Other ' || g, 'o', '[]'::jsonb, false, 'someone-else', now() + (g || ' minutes')::interval FROM generate_series(1, 60) g", [tag]);
    await listPage();
    check('list: my published course is still listed with 60 newer courses by others', (await cards('#published-carousel')).indexOf('E2E Bana v3') >= 0);

    // my own list has no cap (the page treats it as the whole list)
    await pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, owner_id) SELECT $1 || '-M' || g, 'Mine ' || g, 'o', '[]'::jsonb, true, $2 FROM generate_series(1, 320) g", [tag, deviceId]);
    const mineCount = await page.evaluate(async function () { return (await (await fetch('/api/my/courses', { headers: { 'x-user-id': localStorage.getItem('golf_os_device_id') } })).json()).length; });
    check('my courses: the list is not capped (321 of mine, all returned)', mineCount === 321, 'n ' + mineCount);
    await pool.query('DELETE FROM courses WHERE share_code LIKE $1', [tag + '-M%']);

    // 6. the working copy remembers its course
    await open('autorun=edit_build', 6000);
    st = await state();
    check('quick draft: remembers the course it belongs to (and its name)', st.code === code && st.published && st.name === 'E2E Bana v3', JSON.stringify(st));
    await publish(); await wait(5000);
    r = await rows();
    check('quick draft: Publish updates that course (version 3, still one course)', r.length === 1 && r[0].version === 3, JSON.stringify(r));

    // 7. a published course is never taken offline by Save draft, and playing it leaves it alone
    await page.evaluate(function () { smartSaveDraft(); }); await wait(3000);
    r = await rows();
    check('Save draft on a published course does not unpublish it', r.length === 1 && r[0].is_draft === false && r[0].version === 3, JSON.stringify(r));
    await page.evaluate(function () { saveAndPlay(); }); await wait(9000);
    r = await rows();
    const orig = r.find(function (x) { return x.share_code === code; }), copy = r.find(function (x) { return x.share_code !== code; });
    check('Save & play: the published course is untouched, the play copy is marked', orig && orig.is_draft === false && orig.version === 3 && copy && copy.copy === 'true', JSON.stringify(r));
    await listPage();
    const drafts3 = await cards('#drafts-carousel');
    check('list: the play copy is not shown among My drafts', drafts3.filter(function (n) { return n !== 'Snabbutkast'; }).length === 0, JSON.stringify(drafts3));

    // an older course whose draft flag is NULL counts as published: publishing it again is a new version
    const legacyCode = tag + '-L';
    await pool.query("INSERT INTO courses (share_code, name, author, holes, is_draft, owner_id, version) VALUES ($1, 'Legacy', 'o', '[]'::jsonb, NULL, $2, 1)", [legacyCode, deviceId]);
    const legacy = await page.evaluate(async function (lc) {
      const res = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': localStorage.getItem('golf_os_device_id') }, body: JSON.stringify({ name: 'Legacy', holes: [], edit_code: lc, is_draft: false }) });
      return res.json();
    }, legacyCode);
    const lv = (await pool.query('SELECT version FROM courses WHERE share_code = $1', [legacyCode])).rows[0];
    check('publish again: a course without a draft flag (older course) counts as published and gets a new version', legacy.success && lv.version === 2, JSON.stringify([legacy, lv]));

    // a stale tab (or another device) cannot take a published course back to a draft
    const stale = await page.evaluate(async function (c) {
      const res = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': localStorage.getItem('golf_os_device_id') }, body: JSON.stringify({ name: 'Stale', holes: [], edit_code: c, is_draft: true }) });
      return { status: res.status, body: await res.json() };
    }, code);
    const still = (await pool.query('SELECT is_draft, name FROM courses WHERE share_code = $1', [code])).rows[0];
    check('a published course cannot be saved back to a draft by a stale tab (409, row untouched)', stale.status === 409 && stale.body.code === 'already_published' && still.is_draft === false && still.name !== 'Stale', JSON.stringify([stale, still]));

    // 8. a draft can be deleted from the list
    await open('autorun=new_build&template=blank&biome=GLOBAL', 4000);
    await page.evaluate(function () { window.HoleGenerator.generate({ par: 4, seed: 99 }); document.getElementById('course-name-input').value = 'Att radera'; smartSaveDraft(); }); await wait(6000);
    await listPage();
    check('delete: the new draft is listed', (await cards('#drafts-carousel')).indexOf('Att radera') >= 0);
    await page.evaluate(function () { window.confirm = function () { return true; }; const c = Array.from(document.querySelectorAll('#drafts-carousel .build-card')).find(function (x) { return /Att radera/.test(x.textContent); }); c.querySelector('.card-btn-delete').click(); });
    await wait(3500);
    const gone = (await pool.query("SELECT count(*)::int AS n FROM courses WHERE name = 'Att radera' AND owner_id = $1", [deviceId])).rows[0].n === 0;
    check('delete: the draft is gone from the list and from the server', gone && (await cards('#drafts-carousel')).indexOf('Att radera') < 0);
    // a local entry whose server row is already gone can still be removed
    await page.evaluate(function () { const l = JSON.parse(localStorage.getItem('golf_os_my_drafts') || '[]'); l.push({ code: 'NOSUCH', name: 'Borta', date: new Date().toISOString() }); localStorage.setItem('golf_os_my_drafts', JSON.stringify(l)); });
    await listPage();
    check('delete: a stale local draft is listed', (await cards('#drafts-carousel')).indexOf('Borta') >= 0);
    await page.evaluate(function () { window.confirm = function () { return true; }; const c = Array.from(document.querySelectorAll('#drafts-carousel .build-card')).find(function (x) { return /Borta/.test(x.textContent); }); c.querySelector('.card-btn-delete').click(); });
    await wait(3000);
    check('delete: a stale local draft (server row already gone) can be removed', (await cards('#drafts-carousel')).indexOf('Borta') < 0 && !/NOSUCH/.test(await page.evaluate(function () { return localStorage.getItem('golf_os_my_drafts'); })));
  } catch (e) {
    console.error(e); failed++;
  }
  await cleanup();
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nCourses e2e passed');
  process.exit(failed ? 1 : 0);
})();
