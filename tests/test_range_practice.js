/**
 * Approach practice on the range (arcade-range-practice.js): the range's greens, the spot at a distance from the pin on the line back to
 * the tee (moved around the pin when blocked), the result against the pin (short/long, left/right), stats per practised distance, and
 * the player's unit. Run: node tests/test_range_practice.js
 */
const P = require('../arcade-range-practice.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

const tee = { x: 0, y: 0, z: 0, rot: Math.PI };   // the range points along -Z
const holes = [{ tees: { range: tee } }, { flag: { x: 10, y: 1, z: -150 } }, null, { flag: { x: -5, y: 0, z: -80 } }, { tees: {} }];
const tg = P.targetsFrom(holes, tee);
check('the greens are the holes with a flag, numbered in hole order, with their distance from the tee', tg.length === 2 && tg[0].hole === 1 && tg[0].n === 1 && tg[1].hole === 3 && near(tg[0].fromTee, Math.hypot(10, 150)), JSON.stringify(tg));

const pin = { x: 0, z: -150 };
let s = P.spotFor(pin, tee, 100, 0);
check('the spot is on the line from the pin back to the tee', near(s.x, 0, 1e-9) && near(s.z, -50, 1e-9), JSON.stringify(s));
s = P.spotFor(pin, tee, 100, 90);
check('turned 90° the spot is beside the pin, at the same distance', near(Math.hypot(s.x - pin.x, s.z - pin.z), 100, 1e-9) && near(s.z, -150, 1e-9), JSON.stringify(s));
s = P.spotFor({ x: 0, z: 0 }, tee, 40, 0);
check('a pin on the tee: straight back from the range direction', near(s.z, 40, 1e-9), JSON.stringify(s));

const water = (x, z) => z > -60 && z < -40 && Math.abs(x) < 6;   // a pond across the line
const ps = P.playableSpot(pin, tee, 100, water);
check('a spot in water moves around the pin, same distance', ps.moved && !water(ps.x, ps.z) && near(Math.hypot(ps.x - pin.x, ps.z - pin.z), 100, 1e-9), JSON.stringify(ps));
check('a free spot is not moved', P.playableSpot(pin, tee, 100, () => false).moved === false);
check('everything blocked: the straight spot, marked as blocked', P.playableSpot(pin, tee, 100, () => true).blocked === true);
// the pin near the end of the terrain, the tee just past it: every spot within ±45° is off the terrain, the far side of the pin is not
const nearEnd = P.playableSpot({ x: 0, z: 250 }, { x: 0, z: 270 }, 100, (x, z) => z > 300);
check('blocked on the tee side: found the other side of the pin', !nearEnd.blocked && nearEnd.z <= 300 && Math.abs(Math.hypot(nearEnd.x, nearEnd.z - 250) - 100) < 1e-6);

const spot = { x: 0, z: -50 };   // hitting along -Z towards the pin at z = -150
let r = P.result({ x: 3, z: -146 }, pin, spot, true);
check('result: 4 m short, 3 m right, 5 m from the pin, on the green', near(r.along, -4) && near(r.across, 3) && near(r.prox, 5) && r.onGreen, JSON.stringify(r));
r = P.result({ x: -2, z: -160 }, pin, spot, false);
check('result: 10 m long, 2 m left', near(r.along, 10) && near(r.across, -2) && !r.onGreen, JSON.stringify(r));

const st = P.byDistance([
  { practice: { dist: 100, prox: 4, onGreen: true } }, { practice: { dist: 100.2, prox: 12, onGreen: false } }, { practice: { dist: 75, prox: 2, onGreen: true } },
  { carry: 120 }   // not an approach shot
]);
check('per distance: shots, greens hit, average and best to the pin', st.length === 2 && st[0].dist === 75 && st[1].dist === 100 && st[1].n === 2 && st[1].greens === 1 && near(st[1].prox, 8) && st[1].best === 4, JSON.stringify(st));

check('distance in yards: 100 yd is 91.44 m, back to 100', near(P.toMetres(100, false), 91.44, 1e-9) && P.inUnit(91.44, false) === 100);
check('distance is held between 10 and 300 in the player\'s unit', P.toMetres(5, true) === 10 && P.toMetres(999, true) === 300);

// the test
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const plan = P.testPlan(9, 50, 150, rnd);
const sorted = plan.slice().sort((a, b) => a - b);
check('a test plan: n whole distances inside the band, one from each ninth of it', plan.length === 9 && plan.every(d => Number.isInteger(d) && d >= 50 && d <= 150) &&
  sorted.every((d, i) => d >= Math.floor(50 + 100 * i / 9) && d <= Math.ceil(50 + 100 * (i + 1) / 9)), JSON.stringify(plan));
check('a test plan is shuffled (not in order)', plan.some((d, i) => i > 0 && d < plan[i - 1]), JSON.stringify(plan));
check('points: in the hole 100, from 100 m 5 m away 75, 10 m 50, 20 m or more 0',
  P.points(3, 100, true) === 100 && P.points(5, 100) === 75 && P.points(10, 100) === 50 && P.points(20, 100) === 0 && P.points(35, 100) === 0 && P.points(0, 100) === 100);
check('points scale with the distance: 3 m from 30 m is 50', P.points(3, 30) === 50);

// the spread around the pin
check('spread needs three shots', P.spread([{ along: 1, across: 0 }, { along: 2, across: 1 }]) === null);
const sp = P.spread([{ along: 2, across: -1 }, { along: 4, across: 1 }, { along: 6, across: 0 }]);
check('spread: the middle (long 4, across 0) and the standard deviation each way', near(sp.along, 4) && near(sp.across, 0) && near(sp.sdAlong, 2) && near(sp.sdAcross, 1), JSON.stringify(sp));
const svg = P.plotSVG([{ along: 2, across: -1, onGreen: true }, { along: -8, across: 3 }, { along: 0, across: 0, holed: true }], { label: 'x' });
check('the plot: one dot per shot (gold in the hole, green on it, red off it) and the ellipse with three shots',
  (svg.match(/class="rp-shot"/g) || []).length === 3 && svg.includes('#fbbf24') && svg.includes('#4ade80') && svg.includes('#f87171') && svg.includes('<ellipse'), svg);
check('the plot: past the pin is up, right is right', /cx="(7[1-9]|[89]\d)[^"]*" cy="(7[1-9]|[89]\d|1\d\d)/.test(svg.split('rp-shot')[2]), svg);

// the test history
const k9 = P.testKey(9, [50, 150], true), k18 = P.testKey(18, [30, 80], false);
check('a test is its shots, band and unit', k9 === '9|50-150|m' && k18 === '18|30-80|yd' && P.testKey(9, [50, 150], false) !== k9);
let hist = [];
[40, 55, 48, 62, 58, 70].forEach((v, i) => { hist = P.addResult(hist, { t: i + 1, k: k9, score: v }); });
hist = P.addResult(hist, { t: 10, k: k18, score: 33 });
const tr = P.trend(hist, k9);
check('trend: how many, the latest, the one before, the best, the average of the latest five, oldest first',
  tr.n === 6 && tr.last === 70 && tr.prev === 58 && tr.best === 70 && tr.avg5 === Math.round((55 + 48 + 62 + 58 + 70) / 5) && tr.series.join() === '40,55,48,62,58,70', JSON.stringify(tr));
check('trend: a test never played is null; one played once has no previous', P.trend(hist, '9|30-80|m') === null && P.trend(hist, k18).prev === null);
check('the tests played, the latest played first', P.testsPlayed(hist).join() === [k18, k9].join());
let many = [];
for (let i = 0; i < P.HISTORY_MAX + 5; i++) many = P.addResult(many, { t: i, k: k9, score: 50 });
check('the history keeps the newest ' + P.HISTORY_MAX, many.length === P.HISTORY_MAX && many[0].t === 5);
const spark = P.sparkSVG([40, 70, 55], { tip: (i, v) => 'Test ' + (i + 1) + ': ' + v });
check('the spark line: a dot per test with its score as a tooltip, the line, and the best dashed',
  (spark.match(/class="rp-spark-dot"/g) || []).length === 3 && spark.includes('<polyline') && spark.includes('rp-spark-best') && spark.includes('<title>Test 2: 70</title>'), spark);
const sr = P.sparkRange([55, 58, 61]), sr2 = P.sparkRange([5, 95]);
check('the spark line shows the scores with room, at least 30 points tall, inside 0 to 100', sr[1] - sr[0] === 30 && sr[0] <= 55 && sr[1] >= 61 && sr2[0] === 0 && sr2[1] === 100, JSON.stringify([sr, sr2]));
check('a higher score is drawn higher', (() => { const ys = [...spark.matchAll(/class="rp-spark-dot" cx="[\d.]+" cy="([\d.]+)"/g)].map(m => +m[1]); return ys[1] < ys[2] && ys[2] < ys[0]; })(), spark);

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll range practice checks passed');
