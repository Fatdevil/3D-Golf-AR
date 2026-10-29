/**
 * The player's bag (arcade-bag.js): only launch-monitor shots with a club count, a corrected club moves the shot, each club keeps its
 * newest shots, a club is known from 3 shots, and the suggestion is the known club whose average total is nearest to the plays-like
 * distance. Run: node tests/test_bag.js
 */
const B = require('../arcade-bag.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

let bag = [];
bag = B.upsert(bag, { t: 1, source: 'LM', club: '7i', carry: 140, total: 148 });
bag = B.upsert(bag, { t: 2, source: 'SIM', club: '7i', carry: 160, total: 170 });   // the swing meter measures the game's clubs
bag = B.upsert(bag, { t: 3, source: 'LM', club: null, carry: 150, total: 158 });    // no club picked yet
bag = B.upsert(bag, { t: 4, source: 'LM', club: '7i', carry: 0, total: 0 });        // a mis-read
check('only launch-monitor shots with a club and a carry count', bag.length === 1 && bag[0].t === 1, JSON.stringify(bag));
bag = B.upsert(bag, { t: 3, source: 'LM', club: '7i', carry: 150, total: 158 });    // the club is picked afterwards in the panel
check('a club picked afterwards books the shot', bag.length === 2, JSON.stringify(bag));
bag = B.upsert(bag, { t: 3, source: 'LM', club: '8i', carry: 150, total: 158 });    // and corrected again
check('a corrected club moves the shot, it is not counted twice', bag.length === 2 && bag.filter(e => e.club === '8i').length === 1 && bag.filter(e => e.club === '7i').length === 1, JSON.stringify(bag));
bag = B.upsert(bag, { t: 3, source: 'LM', club: null, carry: 150, total: 158 });
check('taking the club off a shot takes it out of the bag', bag.length === 1, JSON.stringify(bag));

let many = [];
for (let i = 1; i <= 45; i++) many = B.upsert(many, { t: i, source: 'LM', club: 'PW', carry: 100 + i, total: 105 + i });
check('each club keeps its newest 40 shots', many.length === 40 && many[0].t === 6 && many[39].t === 45, many.length + ' ' + many[0].t);

let b2 = [];
[[140, 148], [146, 153], [143, 151]].forEach((x, i) => { b2 = B.upsert(b2, { t: 10 + i, source: 'LM', club: '7i', carry: x[0], total: x[1] }); });
[[230, 252], [240, 262], [235, 255]].forEach((x, i) => { b2 = B.upsert(b2, { t: 20 + i, source: 'LM', club: 'Dr', carry: x[0], total: x[1] }); });
[[118, 124], [122, 127]].forEach((x, i) => { b2 = B.upsert(b2, { t: 30 + i, source: 'LM', club: 'PW', carry: x[0], total: x[1] }); });
const st = B.stats(b2);
check('stats in bag order with averages', st.map(r => r.club).join() === 'Dr,7i,PW' && near(st[1].carry, 143) && near(st[1].total, 150.6666667, 1e-6), JSON.stringify(st));
check('a club is known from 3 shots', st.find(r => r.club === '7i').known && !st.find(r => r.club === 'PW').known);

let s = B.suggest(st, 150);
check('150 plays like: the 7i (total 150.7, 0.7 long)', s && s.club === '7i' && near(s.diff, 0.6666667, 1e-6), JSON.stringify(s));
s = B.suggest(st, 125);
check('125: the PW is not known yet, so the nearest known club (7i, about 26 long)', s && s.club === '7i' && s.diff > 20, JSON.stringify(s));
s = B.suggest(st, 240);
check('240: the driver', s && s.club === 'Dr', JSON.stringify(s));
check('no known club, no suggestion', B.suggest(B.stats([{ t: 1, club: '7i', carry: 1, total: 1 }]), 100) === null && B.suggest(st, NaN) === null);

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll bag checks passed');
