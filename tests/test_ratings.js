/**
 * Ratings (ratings.js): the five stars drawn for an average (full, half, empty to the nearest half) and the words beside them.
 * Run: node tests/test_ratings.js
 */
const R = require('../ratings.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

check('4.3 rounds to 4.5: four full stars and a half', R.fill(4.3).join() === 'full,full,full,full,half', R.fill(4.3).join());
check('4.2 rounds to 4: four full, one empty', R.fill(4.2).join() === 'full,full,full,full,empty', R.fill(4.2).join());
check('5 is five full, 1 is one full', R.fill(5).every(f => f === 'full') && R.fill(1).join() === 'full,empty,empty,empty,empty');
check('no average (null) and out of range are drawn empty or full, never broken', R.fill(null).every(f => f === 'empty') && R.fill(9).every(f => f === 'full') && R.fill(-2).every(f => f === 'empty'));
check('the label: one decimal and the count', R.label(4.25, 12, true) === '4.3 (12)' && R.label(5, 1, false) === '5.0 (1)', R.label(4.25, 12, true));
check('the label without ratings, in either language', R.label(null, 0, true) === 'Inga betyg än' && R.label(null, 0, false) === 'No ratings yet');

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll ratings checks passed');
