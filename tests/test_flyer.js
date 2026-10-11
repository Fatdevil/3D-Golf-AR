/**
 * Flyer-lie från rough (physics.js + swing-motorns slag, ingen webbläsare).
 * En flyer ska ge en märkbart längre carry än från fairway, inte en helt annan sorts slag.
 * Math.random styrs: under chansgränsen blir det en flyer, över den ett vanligt rough-slag.
 * Run: node tests/test_flyer.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const G = global.window.GolfPhysics;
const SE = require('./load_swing_engine.js')();
const YD = 1.09361;

function carry(club, power, terrain, rnd, extra, wind) {
  Math.random = function () { return rnd; };
  const d = SE.mapCircleToPhysics(power, 0, club, 0);
  const env = { getTerrainAt: () => ({ z: 0, normal: [0, 0, 1], type: terrain }), checkCollisionCallback: () => null, wind: wind || [0, 0, 0], temperatureC: 15 };
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(Object.assign({}, d, { startPos: [0, 0, 0], isLiveData: false, isTeeShot: false }, extra || {}), env).metrics.carryMeters * YD; }
  finally { console.log = log; }
}
const pct = (a, b) => (a / b - 1) * 100;
const f0 = x => (x >= 0 ? '+' : '') + x.toFixed(0) + ' %';

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

console.log('Vanligt rough-slag (ingen flyer) är kortare än fairway');
for (const c of ['I5', 'I7', 'I9', 'PW', 'SW', 'LW']) {
  const fw = carry(c, 1, 'FAIRWAY', 0.5), rn = carry(c, 1, 'ROUGH', 0.5);
  check(c + ': rough 3-16 % kortare', pct(rn, fw) < -3 && pct(rn, fw) > -16, '(' + f0(pct(rn, fw)) + ')');
}

console.log('\nFlyer från rough på full kraft: längre än fairway, men bara några procent upp till ca 15');
for (const c of ['I5', 'I7', 'I9', 'PW', 'SW', 'LW']) {
  const fw = carry(c, 1, 'FAIRWAY', 0.5), fl = carry(c, 1, 'ROUGH', 0.0), rn = carry(c, 1, 'ROUGH', 0.5);
  check(c + ': flyer +2..+16 % mot fairway och längre än vanligt rough-slag', pct(fl, fw) > 2 && pct(fl, fw) < 16 && fl > rn, '(' + f0(pct(fl, fw)) + ' mot fairway, ' + fl.toFixed(0) + ' yd)');
}
for (const [c, p] of [['PW', 0.7], ['I9', 0.85]]) {
  const fw = carry(c, p, 'FAIRWAY', 0.5), fl = carry(c, p, 'ROUGH', 0.0);
  check(c + ' ' + p * 100 + ' %: flyer +2..+20 % mot fairway', pct(fl, fw) > 2 && pct(fl, fw) < 20, '(' + f0(pct(fl, fw)) + ')');
}

console.log('\nFlyer från deep rough: kraftigare än rough men ändå rimlig');
for (const c of ['I9', 'PW', 'SW', 'LW']) {
  const fw = carry(c, 1, 'FAIRWAY', 0.5), fl = carry(c, 1, 'DEEP ROUGH', 0.0), dn = carry(c, 1, 'DEEP ROUGH', 0.5), rfl = carry(c, 1, 'ROUGH', 0.0);
  check(c + ': deep-flyer +2..+20 % mot fairway, längre än vanligt deep-slag', pct(fl, fw) > 2 && pct(fl, fw) < 20 && fl > dn, '(' + f0(pct(fl, fw)) + ', rough-flyer ' + f0(pct(rfl, fw)) + ')');
}

console.log('\nHela kraftskalan: en flyer är aldrig kortare än fairway-slaget och aldrig kortare än ett vanligt rough-slag');
{
  const POWERS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0];
  let n = 0, worstLo = 1e9, worstHi = -1e9, badLo = [], badHi = [], notLonger = [], gated = 0;
  for (const c of ['I5', 'I7', 'I9', 'PW', 'SW', 'LW']) {
    for (const p of POWERS) {
      const la = SE.mapCircleToPhysics(p, 0, c, 0).launchAngleDeg;
      const fw = carry(c, p, 'FAIRWAY', 0.5), rn = carry(c, p, 'ROUGH', 0.5), fl = carry(c, p, 'ROUGH', 0.0);
      if (la <= 15) { gated++; if (Math.abs(fl - rn) > 0.5) notLonger.push(c + ' ' + p * 100 + ' % ska inte få flyer'); continue; }
      n++;
      const g = pct(fl, fw);
      if (g < worstLo) worstLo = g; if (g > worstHi) worstHi = g;
      if (g < 0) badLo.push(c + ' ' + p * 100 + ' % ' + f0(g));
      if (g > 17) badHi.push(c + ' ' + p * 100 + ' % ' + f0(g));
      if (fl <= rn) notLonger.push(c + ' ' + p * 100 + ' % flyer ' + fl.toFixed(0) + ' <= rough ' + rn.toFixed(0));
    }
  }
  check(n + ' flyer-slag (rough): aldrig kortare än fairway', badLo.length === 0, badLo.length ? '(' + badLo.slice(0, 3).join('; ') + ')' : '(lägst ' + f0(worstLo) + ')');
  check(n + ' flyer-slag (rough): aldrig mer än +17 % mot fairway', badHi.length === 0, badHi.length ? '(' + badHi.slice(0, 3).join('; ') + ')' : '(högst ' + f0(worstHi) + ')');
  check('flyer är alltid längre än vanligt rough-slag (och slag under 15° utgångsvinkel får ingen)', notLonger.length === 0, notLonger.length ? '(' + notLonger.slice(0, 3).join('; ') + ')' : '(' + gated + ' slag under gränsen)');
  let nd = 0, dLo = [], dHi = [], dWorstLo = 1e9, dWorstHi = -1e9;
  for (const c of ['I9', 'PW', 'SW', 'LW']) for (const p of POWERS) {
    const la = SE.mapCircleToPhysics(p, 0, c, 0).launchAngleDeg; if (la <= 20) continue;
    const fw = carry(c, p, 'FAIRWAY', 0.5), fl = carry(c, p, 'DEEP ROUGH', 0.0), rfl = carry(c, p, 'ROUGH', 0.0);
    nd++; const g = pct(fl, fw);
    if (g < dWorstLo) dWorstLo = g; if (g > dWorstHi) dWorstHi = g;
    if (g < 0) dLo.push(c + ' ' + p * 100 + ' % ' + f0(g)); if (g > 20) dHi.push(c + ' ' + p * 100 + ' % ' + f0(g));
    if (fl < rfl - 0.5) dLo.push(c + ' ' + p * 100 + ' % deep-flyer kortare än rough-flyer');
  }
  check(nd + ' flyer-slag (deep rough): 0..+20 % mot fairway och minst som rough-flyer', dLo.length === 0 && dHi.length === 0, (dLo.concat(dHi)).length ? '(' + dLo.concat(dHi).slice(0, 3).join('; ') + ')' : '(' + f0(dWorstLo) + ' till ' + f0(dWorstHi) + ')');
}

console.log('\nVind: en flyer är inte kortare än fairway-slaget i stiltje till måttlig vind (motvind upp till 11 mph, medvind och sidvind 15 mph)');
{
  const MS = 0.44704, POWERS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.85, 1.0];
  const WINDS = [['motvind 5 mph', [0, -5 * MS, 0]], ['motvind 11 mph', [0, -11 * MS, 0]], ['medvind 15 mph', [0, 15 * MS, 0]], ['sidvind 15 mph', [15 * MS, 0, 0]]];
  for (const [name, w] of WINDS) {
    let n = 0, lo = 1e9, bad = [];
    for (const c of ['I7', 'I9', 'PW', 'SW', 'LW']) for (const p of POWERS) {
      if (SE.mapCircleToPhysics(p, 0, c, 0).launchAngleDeg <= 15) continue;
      const fw = carry(c, p, 'FAIRWAY', 0.5, null, w), rn = carry(c, p, 'ROUGH', 0.5, null, w), fl = carry(c, p, 'ROUGH', 0.0, null, w);
      n++; const g = pct(fl, fw); if (g < lo) lo = g;
      if (g < -1.5 || fl <= rn) bad.push(c + ' ' + p * 100 + ' % ' + f0(g));
    }
    check(name + ': ' + n + ' flyer-slag, aldrig mer än 1,5 % under fairway och alltid över vanligt rough-slag', bad.length === 0, bad.length ? '(' + bad.slice(0, 3).join('; ') + ')' : '(lägst ' + lo.toFixed(1) + ' %)');
  }
  console.log('     (kraftigare motvind än ca 10 mph tar flyerns fördel: ca -4 % i 20 mph och upp till ca -8 % i 30 mph för långa järn; dokumenterat i physics.js)');
}

console.log('\nChans och spärrar');
{
  const fw = carry('PW', 1, 'ROUGH', 0.5);
  check('ROUGH: slumptal 0,14 ger flyer, 0,16 ger vanligt slag', carry('PW', 1, 'ROUGH', 0.14) > fw * 1.05 && Math.abs(carry('PW', 1, 'ROUGH', 0.16) - fw) < 0.5);
  const dn = carry('PW', 1, 'DEEP ROUGH', 0.5);
  check('DEEP ROUGH: slumptal 0,24 ger flyer, 0,26 ger vanligt slag', carry('PW', 1, 'DEEP ROUGH', 0.24) > dn * 1.1 && Math.abs(carry('PW', 1, 'DEEP ROUGH', 0.26) - dn) < 0.5);
  for (const c of ['DRIVER', 'W3']) check(c + ' får ingen flyer från rough (lägsta utgångsvinkel 15°)', Math.abs(carry(c, 1, 'ROUGH', 0.0) - carry(c, 1, 'ROUGH', 0.5)) < 0.5);
  for (const c of ['I5', 'I7']) check(c + ' får ingen flyer från deep rough (lägsta utgångsvinkel 20°)', Math.abs(carry(c, 1, 'DEEP ROUGH', 0.0) - carry(c, 1, 'DEEP ROUGH', 0.5)) < 0.5);
}

console.log('\nAndra lägen påverkas inte av slumptalet');
{
  check('fairway: samma slag oavsett slumptal', Math.abs(carry('PW', 1, 'FAIRWAY', 0.0) - carry('PW', 1, 'FAIRWAY', 0.5)) < 0.01);
  check('utslag (isTeeShot) från rough räknas som fairway', Math.abs(carry('PW', 1, 'ROUGH', 0.0, { isTeeShot: true }) - carry('PW', 1, 'FAIRWAY', 0.5)) < 0.01);
  check('live-data (launch monitor) får ingen lie-effekt', Math.abs(carry('PW', 1, 'ROUGH', 0.0, { isLiveData: true }) - carry('PW', 1, 'FAIRWAY', 0.5)) < 0.01);
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
