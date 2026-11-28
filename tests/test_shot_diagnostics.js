/**
 * The validation report (shot-diagnostics.js) with the server's own ball flight (server-physics.js): per shot what was measured and where the
 * flight puts it; the carry compared radial against radial and the side at landing against side, in metres, the game minus the reference;
 * estimated, unproven and misread shots never compared; the two kinds of reference summarised apart, per band of carry; a Golf Combine test
 * worked out again with its retakes, rejected retake marks and extra shots; repeatability over tests of one flight version; the CSV export.
 * Run: node tests/test_shot_diagnostics.js
 */
const D = require('../shot-diagnostics.js');
const SP = require('../server-physics.js');
const C = require('../combine-core.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const near = (a, b, e) => typeof a === 'number' && Math.abs(a - b) <= (e === undefined ? 0.01 : e);
const flight = { standard: SP.standard, landing: SP.landing, misread: SP.misread, version: SP.version };
const NOW = SP.version();

let k = 0;
const shot = o => Object.assign({ cid: 'c' + (++k), t: 1700000000000 + k * 1000, source: 'LM', club: '7i', ballSpeed: 120, launch: 16, spin: 7000, spinAxis: 4, hla: 2,
  clubSpeed: 87, estimated: [], raw: { measured: C.NEEDED.slice(), shotNumber: k }, physics: NOW }, o || {});
const ref = (o) => Object.assign({ source: 'Garmin R10', origin: 'import', quality: 'lm_calculated', carry_m: 140, total_m: null, side_m: null, orig: { carry: { value: 140, unit: 'm' } } }, o || {});

console.log('1. Ett slag');
const s1 = shot();
const st = SP.standard(s1);
let d = D.shotDiag(s1, [ref({ carry_m: 140, side_m: 3, total_m: 150 })], flight);
check('servern räknar själv: radiell carry, längs mållinjen, sidled och total', d.ours && near(d.ours.carry, st.carry) && near(d.ours.along, st.along) && near(d.ours.side, st.side) && near(d.ours.total, st.total), d.ours);
check('ett slag med sidled har längs mållinjen kortare än radiell carry (de är olika storheter)', d.ours.along < d.ours.carry && near(Math.hypot(d.ours.along, d.ours.side), d.ours.carry, 0.05), d.ours);
check('carry jämförs radiell mot radiell: spelets carry minus referensens', near(d.refs[0].delta.carry, d.ours.carry - 140), d.refs[0]);
check('sidled jämförs med sidled vid landning', near(d.refs[0].delta.side, d.ours.side - 3), d.refs[0]);
check('total visas för sig', near(d.refs[0].delta.total, d.ours.total - 150));
check('alla fem värdena uppmätta: jämförbart', d.status === 'measured' && d.comparable && !d.notMeasured.length, d);
check('fysikversionen följer med: slagets och serverns', d.physics.shot === NOW && d.physics.now === NOW && d.physics.same);
check('smash factor ur boll- och klubbfart', near(d.smash, 120 / 87));
d = D.shotDiag(shot({ physics: 'flight-2023.0' }), [], flight);
check('ett slag från en äldre bollflykt: markerat, räknat med dagens', !d.physics.same && d.physics.shot === 'flight-2023.0' && d.ours !== null);
d = D.shotDiag(shot({ estimated: ['spinAxisDeg'] }), [ref()], flight);
check('uppskattad spinnaxel: inte jämförbart, och det står vilket värde', d.status === 'estimated' && !d.comparable && d.notMeasured.indexOf('spinAxisDeg') >= 0, d);
d = D.shotDiag(shot({ raw: undefined }), [ref()], flight);
check('utan bryggans lista (äldre brygga): obevisat, inte jämförbart', d.status === 'unproven' && !d.comparable);
d = D.shotDiag(shot({ raw: { measured: ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm', 'spinAxisDeg'] } }), [ref()], flight);
check('startriktning saknas i listan: inte jämförbart, azimDeg utpekat', d.status === 'estimated' && d.notMeasured.join() === 'azimDeg', d);
d = D.shotDiag(shot({ clubSpeed: 70 }), [ref()], flight);
check('felmätning (smash 1,71 med järn): inte jämförbart', d.misread && !d.comparable);
d = D.shotDiag(shot({ carryStd: 150 }), [], flight);
check('enhetens egen carry visas bredvid serverns, aldrig använd', d.device.carryStd === 150 && near(d.device.carryDiff, 150 - d.ours.carry));
d = D.shotDiag(shot(), [ref({ carry_m: null, side_m: 2, orig: { side: { value: 2, unit: 'm' } } })], flight);
check('en referens utan carry: ingen carryjämförelse, sidled jämförs', d.refs[0].delta.carry === null && d.refs[0].delta.side !== null);

console.log('\n2. Sammanfattning per band och kvalitet');
// shots at four distances, each with a reference: the game's carry plus a known offset
const at = function (bs, la, spin, off, quality, o) {
  const s = shot(Object.assign({ ballSpeed: bs, launch: la, spin: spin, spinAxis: 0, hla: 0, clubSpeed: bs / 1.35 }, o || {}));
  const c = SP.standard(s).carry;
  return D.shotDiag(s, [ref({ carry_m: c - off, side_m: 0, quality: quality || 'lm_calculated' })], flight);
};
const list = [at(55, 30, 7500, 1.0), at(56, 30, 7500, 3.0), at(72, 26, 8000, -2.0), at(118, 16, 7000, 4.0), at(140, 14, 5500, 5.0, 'measured_landing'),
  at(120, 16, 7000, 2, 'lm_calculated', { estimated: ['totalSpinRpm'] }), D.shotDiag(shot(), [], flight)];
const sum = D.summary(list, [], NOW);
const lm = sum.references.lm_calculated, ml = sum.references.measured_landing;
check('LM-beräknad och uppmätt landning sammanfattas var för sig', lm && ml && ml.length === 1 && ml[0].carry.n === 1 && near(ml[0].carry.mean, 5), sum.references);
const band = lm.filter(b => b.carry.n === 2)[0];
check('två slag i samma band: medel, median och spridning av carryfelet', band && near(band.carry.mean, 2) && near(band.carry.sd, Math.SQRT2, 0.01) && near(band.carry.meanAbs, 2), lm);
check('banden har sina gränser i meter', lm.every(b => typeof b.from === 'number') && lm.map(b => b.band).every((b, i, a) => a.indexOf(b) === i), lm.map(b => b.band));
check('uppskattade slag och slag utan referens räknas inte, men räknas upp', sum.excluded.estimated === 1 && sum.excluded.noReference === 1 && sum.compared === 5, sum.excluded);
check('ett band per referenskarry: 30 m, 50 m, 100 m och 150 m hamnar i olika band', D.bandLabel(D.BANDS[0]) === '0–40 m' && D.bandLabel(D.BANDS[6]) === '250+ m');
// a live and an imported reference of the same kind for one shot: counted once (the live one)
const two = shot();
const c2 = SP.standard(two).carry;
const sum2 = D.summary([D.shotDiag(two, [ref({ origin: 'import', carry_m: c2 - 9 }), ref({ origin: 'live', source: 'gspro-openconnect', carry_m: c2 - 1 })], flight)], [], NOW);
check('två referenser av samma slag räknas en gång (den som kom med slaget)', sum2.references.lm_calculated[0].carry.n === 1 && near(sum2.references.lm_calculated[0].carry.mean, 1), sum2.references);

console.log('\n3. Ett Combine-test');
const T = 'test0001aa';
const SPEED = { 30: 50, 50: 66, 70: 80, 90: 92, 110: 103, 130: 113, 150: 124, 170: 136, 190: 150 };
const cb = (i, o) => shot(Object.assign({ ballSpeed: SPEED[C.LEVELS.standard[i]], launch: 18, spin: 6500, spinAxis: 0, hla: 0, clubSpeed: SPEED[C.LEVELS.standard[i]] / 1.35,
  combine: { test: T, level: 'standard', index: i } }, o || {}));
const shots = [];
for (let i = 0; i < 9; i++) shots.push(cb(i));
// target 2: a misread first (rightly voided), then the retake; target 4: a void mark on a real measurement (rejected), then a second shot (ignored)
shots.splice(2, 0, cb(2, { clubSpeed: 40, combine: { test: T, level: 'standard', index: 2, void: 'misread' }, t: shots[2].t - 500 }));
const real4 = shots.find(s => s.combine.index === 4);
real4.combine = { test: T, level: 'standard', index: 4, void: 'misread' };
shots.push(cb(4, { t: real4.t + 300 }));
const res = C.score(shots, 'standard', SP.landing, { misread: SP.misread });
const td = D.testDiag(T, shots, 'standard', { total: res.total, official: res.official, physics: NOW, finished: 1 }, flight);
check('testet räknas om med serverns bollflykt och stämmer med det sparade', td.complete && td.total === res.total && td.stored.sameTotal && td.stored.samePhysics, td.stored);
check('omslag efter felmätning: ett giltigt omslag', td.retakes === 1 && td.targets[2].shots[0].role === 'voided' && td.targets[2].shots[0].reason === 'misread', td.targets[2]);
check('omslagsmärkning på en riktig mätning gäller inte', td.rejectedVoids === 1 && td.targets[4].shots[0].role === 'counted' && !td.targets[4].shots[0].voidHolds, td.targets[4]);
check('ett andra slag vid samma mål räknas inte (inga gratis omslag)', td.extras === 1 && td.targets[4].shots[1].role === 'extra_ignored', td.targets[4]);
check('alla värden uppmätta: officiellt, inga träningsskäl', td.official && !td.practiceReasons.length);
const est = shots.map(s => s.combine.index === 6 ? Object.assign({}, s, { estimated: ['azimDeg'] }) : s);
const td2 = D.testDiag(T, est, 'standard', null, flight);
check('ett uppskattat värde: träning, och skälet pekar ut mål och värde', !td2.official && td2.practiceReasons.length === 1 && td2.practiceReasons[0].index === 6 && td2.practiceReasons[0].notMeasured.join() === 'azimDeg' && td2.stored === null, td2.practiceReasons);
const td3 = D.testDiag(T, shots.filter(s => s.combine.index !== 8), 'standard', null, flight);
check('ett saknat slag: inte komplett, målet utpekat', !td3.complete && td3.missing.join() === '8');
const td4 = D.testDiag(T, shots, 'standard', { total: res.total - 3, official: true, physics: 'flight-2023.0', finished: 1 }, flight);
check('sparat med en äldre bollflykt: olika version och total markeras', !td4.stored.samePhysics && !td4.stored.sameTotal);

console.log('\n4. Upprepbarhet');
const mk = (total, errs, physics) => ({ level: 'standard', official: true, physics: physics || NOW, total: total, shots: errs.map((e, i) => ({ index: i, error: e, score: 100 - e })) });
const rep = D.summary([], [mk(70, [2, 3, 4, 5, 6, 7, 8, 9, 10]), mk(74, [4, 3, 4, 5, 6, 7, 8, 9, 10]), mk(78, [6, 3, 4, 5, 6, 7, 8, 9, 10]), mk(10, [1, 1, 1, 1, 1, 1, 1, 1, 1], 'flight-2023.0'),
  Object.assign(mk(99, [0, 0, 0, 0, 0, 0, 0, 0, 0]), { official: false })], NOW).repeatability.standard;
check('tre officiella test med samma bollflykt: medel och spridning av totalen', rep && rep.tests === 3 && near(rep.total.mean, 74) && near(rep.total.sd, 4) && rep.total.min === 70 && rep.total.max === 78, rep);
check('per mål: spridningen av felet (mål 1 varierar, mål 2 inte)', near(rep.targets[0].error.sd, 2) && near(rep.targets[1].error.sd, 0) && rep.targets[0].n === 3, rep.targets.slice(0, 2));
check('träningsresultat och äldre bollflykt räknas inte', rep.tests === 3);

console.log('\n5. CSV');
const csv = D.toCsv([D.shotDiag(shot({ club: '7i' }), [ref({ source: '=HYPERLINK("x")', side_m: -2, orig: { carry: { value: 153.1, unit: 'yd' }, side: { value: -2, unit: 'm' } } })], flight), D.shotDiag(shot(), [], flight)]);
const lines = csv.trim().split('\n');
check('en rubrikrad och en rad per slag och referens', lines.length === 3 && lines[0] === D.CSV_HEAD.join(','), lines.length);
const head = lines[0].split(','), row1 = lines[1];
check('enheterna står i rubrikerna, höger positiv för sidled', head.indexOf('game_carry_m') >= 0 && head.indexOf('ref_side_m_R') >= 0 && head.indexOf('delta_carry_m') >= 0);
check('värdet som det kom (153.1 yd) och i meter', row1.indexOf('153.1 yd') >= 0);
check('en källa som börjar med = blir aldrig en formel i ett kalkylblad', row1.indexOf('"\'=HYPERLINK(""x"")"') >= 0, row1);
check('ett slag utan referens: tomma referenskolumner', lines[2].split(',').slice(-12).every(c => c === ''), lines[2]);
check('cellen för minus ser till att negativa tal förblir tal', D.cell(-2) === '-2' && D.cell('-2') === "'-2" && D.cell(null) === '' && D.cell(true) === 'yes');

console.log(failed ? '\n❌ ' + failed + ' check(s) failed' : '\nAll shot diagnostics checks passed');
process.exit(failed ? 1 : 0);
