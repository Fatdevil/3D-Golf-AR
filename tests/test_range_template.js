/**
 * The ready practice range (arcade-range-template.js): where the tee and the greens go, and the greens' outlines.
 * Run: node tests/test_range_template.js
 */
const T = require('../arcade-range-template.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

const L = T.layout();
check('three greens (a course holds three holes)', L.greens.length === 3, L.greens.length);
const along = g => (g.x - L.tee.x) * Math.sin(L.tee.rot) + (g.z - L.tee.z) * Math.cos(L.tee.rot);
const across = g => -(g.x - L.tee.x) * Math.cos(L.tee.rot) + (g.z - L.tee.z) * Math.sin(L.tee.rot);
check('the greens are 60, 100 and 140 m down the range from the tee', L.greens.map(g => Math.round(along(g))).join() === '60,100,140', L.greens.map(along).join());
check('they sit a little to either side, not in one line', L.greens.some(g => across(g) < -3) && L.greens.some(g => across(g) > 3), L.greens.map(across).join());
check('the further green is the bigger one', L.greens[0].rx < L.greens[1].rx && L.greens[1].rx < L.greens[2].rx);
check('everything is well inside the 600 m terrain', [L.tee].concat(L.greens).every(p => Math.abs(p.x) < 250 && Math.abs(p.z) < 250), JSON.stringify(L));

const o = T.outline(10, -20, 9, 8, 14);
const r = o.map(p => Math.hypot((p.x - 10) / 9, (p.z + 20) / 8));
check('an outline: 14 points round the ellipse, a little in and out (not stamped)', o.length === 14 && r.every(v => v > 0.85 && v < 1.15) && Math.max.apply(null, r) - Math.min.apply(null, r) > 0.05, r.map(v => v.toFixed(2)).join());

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll range template checks passed');
