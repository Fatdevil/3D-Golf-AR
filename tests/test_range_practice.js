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

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll range practice checks passed');
