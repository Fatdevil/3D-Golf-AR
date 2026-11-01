/**
 * The range session's maths (arcade-range-session.js): the range frame, per-club averages and spread, the dispersion of landing
 * points and the CSV export. Run: node tests/test_range_session.js
 */
const R = require('../arcade-range-session.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

// the range frame: along the tee's heading (sin rot, cos rot), right of it is positive
const east = { x: 10, y: 0, z: 5, rot: Math.PI / 2 };   // pointing along +X
let f = R.rangeFrame(east, 110, 5);
check('range along +X: 100 m down the range, on the line', near(f.along, 100) && near(f.across, 0), JSON.stringify(f));
f = R.rangeFrame(east, 110, 12);
check('range along +X: +Z is to the right', near(f.across, 7), JSON.stringify(f));
const north = { x: 0, y: 0, z: 0, rot: Math.PI };       // pointing along -Z (the builder's default)
f = R.rangeFrame(north, 3, -50);
check('range along -Z: +X is to the right', near(f.along, 50) && near(f.across, 3), JSON.stringify(f));
const back = R.fromRangeFrame(east, 37, -4), again = R.rangeFrame(east, back.x, back.z);
check('fromRangeFrame undoes rangeFrame', near(again.along, 37) && near(again.across, -4), JSON.stringify(again));

// statistics
check('sd of one value is 0', R.sd([5]) === 0);
check('sample sd', near(R.sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935, 1e-6));
const shots = [
    { club: '7i', carry: 140, total: 150, offline: 2, ballSpeed: 110 },
    { club: '7i', carry: 150, total: 158, offline: -4, ballSpeed: 114 },
    { club: 'Dr', carry: 220, total: 245, offline: 10 },
    { club: null, carry: 100, total: 110, offline: 0 },
    { club: '7i', carry: 145, total: 152, offline: 5 }
];
const st = R.clubStats(shots);
check('clubs in bag order, unknown last', st.map(r => r.club).join() === 'Dr,7i,?', st.map(r => r.club).join());
const i7 = st.find(r => r.club === '7i');
check('7i: count and averages', i7.n === 3 && near(i7.carry, 145) && near(i7.total, 460 / 3) && near(i7.offline, 1), JSON.stringify(i7));
check('7i: spread of carry and offline', near(i7.carrySd, 5) && near(i7.offlineSd, Math.sqrt(21)), JSON.stringify(i7));
check('7i: ball speed from the shots that have it', near(i7.ballSpeed, 112) && i7.longest === 150, JSON.stringify(i7));

// dispersion of landing points in the range frame
const land = [{ landX: 110, landZ: 5 }, { landX: 120, landZ: 9 }, { landX: 130, landZ: 1 }];
const d = R.dispersion(land, east);
check('dispersion: middle down the range and across', near(d.along, 110) && near(d.across, 0) && near(d.sdAlong, 10) && near(d.sdAcross, 4), JSON.stringify(d));
check('dispersion needs three landings', R.dispersion(land.slice(0, 2), east) === null);

// CSV
const csvM = R.toCSV(shots.slice(0, 1), true).trim().split('\n');
check('CSV: header and one row in metres', csvM.length === 2 && /carry_m/.test(csvM[0]) && csvM[1].split(',')[4] === '140.0', csvM.join(' | '));
const csvY = R.toCSV(shots.slice(0, 1), false).trim().split('\n');
check('CSV: yards when the player uses yards', /carry_yd/.test(csvY[0]) && csvY[1].split(',')[4] === (140 * 1.09361).toFixed(1), csvY[1]);
check('CSV: an empty session is just the header', R.toCSV([], true).split('\n').filter(Boolean).length === 1);

const mixed = [{ club: 'PW', carry: 110 }, { club: 'PW', carry: 55, practice: { dist: 60 } }, { club: 'PW', carry: 112 }];
check('approach practice shots are left out of the club averages (part swings)', R.fullSwings(mixed).length === 2 && Math.round(R.clubStats(R.fullSwings(mixed))[0].carry) === 111);

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll range session checks passed');
