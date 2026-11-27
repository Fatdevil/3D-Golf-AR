/**
 * Training Lab · Club Intelligence (training-stats.js), with known values: which shots count where, the numbers of a club, the periods and
 * their change, the latest session against the one before, the weekly trend and how reliable each number is. Run: node tests/test_training_stats.js
 */
const S = require('../training-stats.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const near = (a, b, e) => a !== null && Math.abs(a - b) <= (e || 1e-9);
const V = 'flight-2024.1', NOW = Date.UTC(2026, 10, 27, 12), DAY = 86400000;
let k = 0;
const shot = o => Object.assign({ cid: 'c' + (++k), source: 'LM', club: '7i', t: NOW - DAY, physics: V, carry: 140, carryStd: 140, offlineStd: 0, ballSpeed: 120, spin: 7000, launch: 16, session: 'S2' }, o);
const run = (list, o) => S.compute(list, Object.assign({ period: '30d', now: NOW, version: V }, o || {}));

console.log('1. Kända värden');
// 20 clean 7-iron shots: carry 140..159, side -9.5..+9.5 (step 1), ball speed 115..124 twice
const clean = Array.from({ length: 20 }, (_, i) => shot({ carryStd: 140 + i, offlineStd: -9.5 + i, ballSpeed: 115 + (i % 10), spin: 6000 + 100 * i }));
let c = run(clean).clubs[0];
const sdCarry = Math.sqrt(Array.from({ length: 20 }, (_, i) => (140 + i - 149.5) ** 2).reduce((a, b) => a + b) / 19);
check('carry: median 149,5, medel 149,5, standardavvikelse som räknat för hand (5,92)', c.now.carry.n === 20 && near(c.now.carry.median, 149.5) && near(c.now.carry.mean, 149.5) && near(c.now.carry.sd, sdCarry) && near(sdCarry, 5.916, 0.001), c.now.carry);
check('sidledsspridning: standardavvikelsen av offline (samma tal, 5,92)', near(c.now.side.sd, sdCarry) && near(c.now.side.mean, 0), c.now.side);
check('bollfart och spinn: medelvärden 119,5 mph och 6 950 rpm', near(c.now.ballSpeed.mean, 119.5) && near(c.now.spin.mean, 6950), [c.now.ballSpeed, c.now.spin]);
check('20 giltiga slag: god tillförlitlighet; inga felträffar', c.now.carry.reliability === 'good' && c.now.mishitRate === 0 && c.now.shots === 20 && c.now.valid === 20);
check('tillförlitligheten: under 5 slag ingen, under 20 låg', S.reliability(4) === 'none' && S.reliability(5) === 'low' && S.reliability(19) === 'low' && S.reliability(20) === 'good');

console.log('\n2. Vilka slag räknas var');
const mixed = Array.from({ length: 6 }, (_, i) => shot({ carryStd: 150 + i })).concat([
  shot({ carryStd: 60, ballSpeed: 70, review: { flags: ['topped'], mishit: true } }),                      // a mishit: in the rate, not in the carry
  shot({ carryStd: 120, review: { flags: ['thin'], mishit: true }, accepted: true }),                    // counted anyway: in the carry, still a mishit
  shot({ carryStd: 175, review: { flags: ['wrong_club'], looksLike: '5i' } }),                            // another club: left out entirely
  shot({ carryStd: 150, review: { flags: ['smash_impossible'], misread: true } }),                       // a misread: left out entirely
  shot({ carryStd: 149, spin: 2500, estimated: ['totalSpinRpm'] }),                                        // estimated spin: out of spin and carry
  shot({ carryStd: 200, physics: 'flight-2023.9' }), shot({ carryStd: 201, physics: undefined }),          // another / no flight version
  shot({ source: 'SIM', carryStd: 180 }), shot({ practice: { dist: 60 }, carryStd: 58 }), shot({ club: null })
]);
c = run(mixed).clubs[0];
check('felträffsandel: 2 felträffar av 11 granskade slag (fel klubba och felmätning räknas inte)', c.now.shots === 11 && c.now.mishits === 2 && near(c.now.mishitRate, 2 / 11), c.now);
check('carry: bara giltiga slag med dagens flykt och uppmätt indata (de sex rena och det ändå räknade)', c.now.carry.n === 7 && near(c.now.carry.median, 152), c.now.carry);
check('spinnet tar inte med det uppskattade värdet', c.now.spin.n === 9 && c.now.spin.mean === 7000, c.now.spin);
check('slag med en annan eller ingen fysikversion räknas för sig, aldrig in i carry', c.now.otherFlight === 2, c.now.otherFlight);
check('bollfarten (launch monitorns egen) tar med alla giltiga slag, oavsett flykt', c.now.ballSpeed.n === 10, c.now.ballSpeed);
const wind = Array.from({ length: 6 }, (_, i) => shot({ carryStd: 150, offlineStd: i % 2 ? 2 : -2, offline: i % 2 ? 30 : -30 })).concat([shot({ offlineStd: undefined, offline: 50 })]);
c = run(wind).clubs[0];
check('sidledsspridningen är där slagen landade i standardförhållanden, inte var de stannade på rangen (vind, rull); slag utan den räknas inte', c.now.side.n === 6 && near(c.now.side.sd, Math.sqrt(6 * 4 / 5)), c.now.side);
const all = run(mixed);
check('svingmätarens slag, inspelsslag och slag utan klubba räknas för sig', all.sim === 1 && all.practice === 1 && all.noClub === 1, [all.sim, all.practice, all.noClub]);

console.log('\n3. Perioder och förändring');
const periods = Array.from({ length: 6 }, (_, i) => shot({ t: NOW - 5 * DAY, carryStd: 150 + i, offlineStd: i % 2 ? 4 : -4 }))
  .concat(Array.from({ length: 6 }, (_, i) => shot({ t: NOW - 45 * DAY, carryStd: 140 + i, offlineStd: i % 2 ? 8 : -8, session: 'S1', ballSpeed: 118 })))
  .concat(Array.from({ length: 3 }, (_, i) => shot({ t: NOW - 100 * DAY, carryStd: 130 + i, session: 'S0' })));
c = run(periods).clubs[0];
check('30 dagar: bara de senaste 30 dagarnas slag', c.now.carry.n === 6 && near(c.now.carry.median, 152.5), c.now.carry);
check('förändring mot de 30 dagarna före: carry +10 m, spridning lägre, bollfart +2 mph', c.change && near(c.change.carry, 10) && c.change.side < 0 && near(c.change.ballSpeed, 2), c.change);
c = run(periods, { period: '90d' }).clubs[0];
check('90 dagar tar med båda perioderna; förändringen kräver 5 slag i perioden före (bara 3 där)', c.now.carry.n === 12 && c.change.carry === null, c);
c = run(periods, { period: 'all' }).clubs[0];
check('hela historiken: alla slag, ingen förändring', c.now.carry.n === 15 && c.change === null);
c = run(periods, { period: 'session' }).clubs[0];
check('senaste passet jämförs med passet före', c.session === 'S2' && c.now.carry.n === 6 && c.before.carry.n === 6 && near(c.change.carry, 10), c);
const noSess = run([shot({ session: undefined }), shot({ session: undefined })], { period: 'session' }).clubs;
check('slag utan pass (äldre slag) bildar inget pass', noSess.length === 0 || noSess[0].now.shots === 0, noSess);
c = run(Array.from({ length: 4 }, () => shot())).clubs[0];
check('för få slag: siffran visas med "ingen" tillförlitlighet och ingen förändring räknas', c.now.carry.n === 4 && c.now.carry.reliability === 'none' && c.change === null);

console.log('\n4. Trenden vecka för vecka');
const mon = Date.UTC(2026, 10, 23);   // a Monday
check('veckan börjar på måndag (UTC)', S.weekStart(Date.UTC(2026, 10, 27, 23)) === mon && S.weekStart(mon) === mon && S.weekStart(mon - 1) === mon - 7 * DAY);
const tr = run([shot({ t: mon + DAY, carryStd: 140 }), shot({ t: mon + 2 * DAY, carryStd: 144 }), shot({ t: mon - 3 * DAY, carryStd: 130 }), shot({ t: mon + DAY, carryStd: 60, review: { flags: ['topped'], mishit: true } })]).clubs[0].trend;
check('trenden: medianen per vecka av de giltiga slagen, äldst först', tr.length === 2 && tr[0].week === mon - 7 * DAY && tr[0].carry === 130 && tr[1].carry === 142 && tr[1].n === 2, tr);

console.log('\n5. Klubbor');
const order = run([shot({ club: 'PW' }), shot({ club: 'Dr' }), shot({ club: '7i' })]).clubs.map(x => x.club).join();
check('klubborna i bagens ordning', order === 'Dr,7i,PW', order);
check('samma slag ger samma statistik (två enheter som ser samma bank)', JSON.stringify(run(mixed)) === JSON.stringify(run(mixed.slice().reverse())));

console.log(failed ? '\n' + failed + ' failed' : '\nAll training stats checks passed');
process.exit(failed ? 1 : 0);
