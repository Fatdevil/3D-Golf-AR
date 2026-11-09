/**
 * The automatic graphics level (arcade-auto-quality.js), without a browser:
 * 1. decide(): slow frames step down at once; three smooth windows step up; a step up that is slow at once blocks that level for a while
 *    (longer each time); hitches are left out; too few frames decide nothing.
 * 2. The levers: a level sets light & colour, ground detail, the pixel cap and the 2D trees' share; an option the player has stored is
 *    left as it is; turning it on again gives the levers back.
 * 3. The start: 1 on a computer, 2 on a phone, else the stored level; off stays off.
 * 4. arcade.html: the script, the start, the pixel cap and the panel.
 * Run: node tests/test_auto_quality.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}
const src = fs.readFileSync(path.join(__dirname, '..', 'arcade-auto-quality.js'), 'utf8');
function load(store) {
  const ls = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
  const calls = { post: [], detail: [], veg: [] };
  let post = 'LOW';
  const win = {
    PostFX: { level: function () { return post; }, setLevel: function (q) { post = q; calls.post.push(q); } },
    setGroundDetail: function (on) { calls.detail.push(on); },
    SurroundVeg: { setAutoScale: function (f) { calls.veg.push(f); } },
    getAppMode: function () { return 'PLAY'; }
  };
  new Function('window', 'globalThis', 'localStorage', src)(win, win, ls);
  return { win: win, A: win.AutoQuality, calls: calls, store: store };
}
const frames = function (ms, n) { const a = []; for (let i = 0; i < (n || 180); i++) a.push(ms); return a; };

console.log('1. Beslutet');
{
  const { A } = load({});
  const st0 = { level: 1, smooth: 0, blocked: {}, upAt: null };
  let r = A.decide(st0, A.stats(frames(30)), 10000);
  check('trögt (33 fps): ett steg ner direkt', r.level === 2 && r.changed);
  r = A.decide({ level: 4, smooth: 0, blocked: {}, upAt: null }, A.stats(frames(30)), 10000);
  check('redan lägst: stannar', r.level === 4 && !r.changed);
  let s = st0, t = 0;
  for (let i = 0; i < 2; i++) { s = A.decide(s, A.stats(frames(16.7)), t += 3000); }
  check('två mjuka fönster: inget än', s.level === 1 && s.smooth === 2);
  s = A.decide(s, A.stats(frames(16.7)), t += 3000);
  check('tre mjuka fönster: ett steg upp', s.level === 0 && s.changed && s.upAt && s.upAt.to === 0);
  const failedUp = A.decide(s, A.stats(frames(28)), t + 3000);
  check('steget upp höll inte: tillbaka ner och nivån spärras en minut', failedUp.level === 1 && failedUp.blocked[0] && failedUp.blocked[0].until === t + 3000 + 60000 && failedUp.blocked[0].tries === 1, JSON.stringify(failedUp.blocked));
  let s2 = Object.assign({}, failedUp, { smooth: 2 });
  s2 = A.decide(s2, A.stats(frames(16.7)), t + 30000);
  check('spärrad nivå: inget steg upp förrän spärren gått ut', s2.level === 1);
  s2 = A.decide(Object.assign({}, s2, { smooth: 2 }), A.stats(frames(16.7)), t + 3000 + 60001);
  check('efter spärren: försöker igen', s2.level === 0);
  const again = A.decide(s2, A.stats(frames(28)), t + 3000 + 63000);
  check('misslyckas igen: spärren dubblas', again.blocked[0].tries === 2 && again.blocked[0].until === t + 3000 + 63000 + 120000);
  const hitchy = frames(16.7, 170).concat(frames(900, 10));
  check('hack (över 250 ms) räknas inte', A.stats(hitchy).n === 170 && Math.abs(A.stats(hitchy).mean - 16.7) < 0.01);
  check('för få bilder: inget beslut', !A.decide(st0, A.stats(frames(40, 10)), 1).changed);
  check('ojämnt (snitt ok, men var tionde bild långsam): räknas inte som mjukt', A.decide(st0, A.stats(frames(15, 160).concat(frames(30, 20))), 1).smooth === 0);
}

console.log('\n2. Spakarna');
{
  const { A, win, calls, store } = load({});
  win.getCapPixelRatio = function () { return 1; };
  A.setLevel(5);
  check('nivå 5: ljus & färg av, markdetalj av, pixeltak 1, 2D-träd 40 %', calls.post.slice(-1)[0] === 'OFF' && calls.detail.slice(-1)[0] === false && win._autoPixelCap === 1 && calls.veg.slice(-1)[0] === 0.4 && store.golf_auto_q === '5');
  A.setLevel(1);
  check('nivå 1: allt på igen', calls.post.slice(-1)[0] === 'LOW' && calls.detail.slice(-1)[0] === true && win._autoPixelCap === Infinity && calls.veg.slice(-1)[0] === 1);
  store.golf_post_q = 'HIGH'; store.golf_ground_detail = '1';
  const n = calls.post.length, m = calls.detail.length;
  A.setLevel(5);
  check('spelarens egna val rörs inte (bloom kvar, markdetalj kvar), resten följer', calls.post.length === n && calls.detail.length === m && win._autoPixelCap === 1);
  A.setOn(false);
  check('av: sparas', store.golf_auto_q_on === '0' && !A.on());
  A.setOn(true);
  check('på igen: spelarens val glöms och nivån gäller', store.golf_post_q === undefined && store.golf_ground_detail === undefined && store.golf_auto_q_on === undefined && calls.post.slice(-1)[0] === 'OFF');
}

console.log('\n3. Starten');
{
  let x = load({}); x.A.start(false);
  check('dator: nivå 1', x.A.level() === 1);
  x = load({}); x.A.start(true);
  check('telefon: nivå 2', x.A.level() === 2);
  x = load({ golf_auto_q: '4' }); x.A.start(false);
  check('sparad nivå: den', x.A.level() === 4);
  x = load({ golf_auto_q: '9' }); x.A.start(true);
  check('felaktig sparad nivå: standard', x.A.level() === 2);
  x = load({ golf_auto_q_on: '0' }); x.A.start(false);
  const before = x.A.level();
  for (let i = 0; i < 400; i++) x.A.feed(40, 2000 + i * 40);
  check('av: rör sig inte hur trögt det än går', !x.A.on() && x.A.level() === before);
  x = load({}); x.A.start(false);
  for (let i = 0; i < 100; i++) x.A.feed(40, 2000 + i * 40);
  check('på: trögt i ett fönster sänker en nivå', x.A.level() === 2);
  for (let i = 0; i < 40; i++) x.A.feed(40, 6100 + i * 40);
  check('efter en ändring räknas inte de närmaste 1,5 s', x.A.level() === 2);
}

console.log('\n4. arcade.html');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
  check('skriptet laddas, startas efter ljus & färg, sänker pixeltaket, panelen finns',
        /<script src="arcade-auto-quality\.js\?v=\d+"><\/script>/.test(html) && /PostFX\.initLevel\(isMobileDevice\);[\s\S]{0,300}AutoQuality\.start\(isMobileDevice\)/.test(html) &&
        /window\._autoPixelCap \|\| Infinity/.test(html) && /id="auto-q-1"/.test(html) && /id="auto-q-status"/.test(html));
  const veg = fs.readFileSync(path.join(__dirname, '..', 'arcade-surround-veg.js'), 'utf8');
  check('2D-trädens andel tunnar både bältet och OB-skogen', (veg.match(/\* autoScale\)/g) || []).length === 2 && /setAutoScale:/.test(veg));
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
