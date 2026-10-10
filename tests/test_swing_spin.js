/**
 * Spinnet följer kraften i swing-motorn (arcade-swing-engine.js, laddad via tests/load_swing_engine.js).
 * Run: node tests/test_swing_spin.js
 */
const SE = require('./load_swing_engine.js')();

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const clubs = Object.keys(SE.CLUB_PROFILES).filter(c => c !== 'PUTT');
const spin = (club, p) => SE.mapCircleToPhysics(p, 0, club, 0).totalSpinRpm;

console.log('Full kraft ger klubbens fulla spinn');
for (const c of clubs) check(c + ' 100 % = ' + SE.CLUB_PROFILES[c].baseSpin + ' rpm', Math.abs(spin(c, 1.0) - SE.CLUB_PROFILES[c].baseSpin) < 1, '(' + spin(c, 1.0).toFixed(0) + ')');

console.log('\nMer kraft ger mer spinn');
for (const c of clubs) {
  let prev = -1, mono = true;
  for (const p of [0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 1.0]) { const v = spin(c, p); if (v <= prev) mono = false; prev = v; }
  check(c + ': spinnet växer med kraften', mono);
}

console.log('\nChippar (10-20 % kraft) får lite spinn, inte wedgespinn');
for (const c of ['LW', 'SW', 'PW']) {
  for (const p of [0.1, 0.2]) {
    const v = spin(c, p), full = SE.CLUB_PROFILES[c].baseSpin;
    check(c + ' ' + p * 100 + ' %: 20-45 % av fullt spinn', v >= 0.2 * full && v <= 0.45 * full, '(' + v.toFixed(0) + ' rpm av ' + full + ')');
  }
}
check('LW 10 % under 4000 rpm (var 7900)', spin('LW', 0.1) < 4000, '(' + spin('LW', 0.1).toFixed(0) + ')');

console.log('\nSpinn per fart: en chip får inte mer spinn per mph än ett fullslag');
for (const c of ['LW', 'SW', 'PW']) {
  const chip = SE.mapCircleToPhysics(0.15, 0, c, 0), full = SE.mapCircleToPhysics(1.0, 0, c, 0);
  const rc = chip.totalSpinRpm / chip.ballSpeedMph, rf = full.totalSpinRpm / full.ballSpeedMph;
  check(c + ': rpm/mph chip <= 2,2 x fullslag', rc <= 2.2 * rf, '(' + rc.toFixed(0) + ' mot ' + rf.toFixed(0) + ' rpm/mph)');
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
