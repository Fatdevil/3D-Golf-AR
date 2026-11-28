/**
 * Golf Combine 9 (combine-core.js) with known values: the targets of each level, a shot's score (e, R = max(6, 0.2 D)), the test's score,
 * what makes it official (every launch value measured), which shots count (the first at each target; a retake only after a shot that was
 * not a measurement), the three costliest targets and the history (latest, best, last five, official only). Run: node tests/test_combine.js
 */
const C = require('../combine-core.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }

console.log('1. Mål och poäng');
check('tre nivåer med nio mål vardera, kortast först, i meter', ['beginner', 'standard', 'advanced'].every(l => C.LEVELS[l].length === 9 && C.LEVELS[l].every((d, i, a) => i === 0 || d > a[i - 1])) &&
  C.LEVELS.beginner.join() === '20,30,40,50,60,70,80,90,100' && C.LEVELS.standard[8] === 190 && C.LEVELS.advanced[8] === 250);
check('poängradien: 6 m som minst, annars 20 % av målet', C.radius(20) === 6 && C.radius(30) === 6 && C.radius(100) === 20 && C.radius(250) === 50);
check('100 m: perfekt 100, 5 m fel 75, 10 m 50, 20 m eller mer 0', C.shotScore(100, 100, 0).score === 100 && C.shotScore(100, 95, 0).score === 75 && C.shotScore(100, 100, 10).score === 50 &&
  C.shotScore(100, 120, 0).score === 0 && C.shotScore(100, 40, 0).score === 0);
check('felet är sträckan till målet: 6 m kort och 8 m höger är 10 m fel', Math.abs(C.shotScore(100, 94, 8).error - 10) < 1e-9 && C.shotScore(100, 94, 8).score === 50);
check('korta mål: 20 m med 3 m fel ger 50 (radien 6 m)', C.shotScore(20, 23, 0).score === 50);
check('utan landning ingen poäng', C.shotScore(100, null, 0) === null);

console.log('\n2. Uppmätt eller uppskattat');
const good = { source: 'LM', ballSpeed: 120, launch: 16, spin: 7000, spinAxis: 2, hla: -1, estimated: [], raw: { measured: C.NEEDED.slice() } };
check('ett slag med allt uppmätt duger för ett officiellt resultat', C.measured(good));
check('uppskattad spinnaxel eller startriktning (en launch monitor som inte skickade dem) duger inte', !C.measured(Object.assign({}, good, { estimated: ['spinAxisDeg'] })) && !C.measured(Object.assign({}, good, { estimated: ['azimDeg'] })));
check('ett värde som inte finns i bryggans lista över uppmätta duger inte', !C.measured(Object.assign({}, good, { raw: { measured: ['ballSpeedMph', 'launchAngleDeg', 'totalSpinRpm'] } })));
check('utan bryggans lista över uppmätta värden (en äldre brygga) bevisar inget att värdena mättes: inte officiellt', !C.measured(Object.assign({}, good, { raw: undefined })) && !C.measured(Object.assign({}, good, { raw: {} })));
check('svingmätarslag är aldrig officiella', !C.measured(Object.assign({}, good, { source: 'SIM' })));

console.log('\n3. Vilka slag räknas');
const at = (i, o) => Object.assign({}, good, { cid: 'c' + i + (o && o.tag || ''), t: 1000 + i * 10 + ((o && o.dt) || 0), combine: Object.assign({ test: 'test0001', level: 'standard', index: i }, (o && o.combine) || {}) }, (o && o.shot) || {});
const land = s => ({ carry: s.carry, side: s.side });
const nine = C.LEVELS.standard.map((D, i) => at(i, { shot: { carry: D, side: 0 } }));
let r = C.score(nine, 'standard', land);
check('nio perfekta slag: 100 poäng, komplett och officiellt', r.complete && r.official && r.total === 100, r);
const topped = nine.slice(); topped[2] = at(2, { shot: { carry: 20, side: 0, review: { flags: ['topped'], mishit: true } } });
r = C.score(topped, 'standard', land);
check('en toppning ger sin poäng (0): inga gratis omslag, totalen 88,9', r.shots[2].score === 0 && r.total === 88.9, r.shots[2]);
const retakeTopped = topped.concat([at(2, { tag: 'b', dt: 5, shot: { carry: 70, side: 0 } })]);
r = C.score(retakeTopped, 'standard', land);
check('ett nytt slag efter en toppning räknas inte (det första slaget vid målet gäller)', r.shots[2].score === 0 && r.shots[2].shot === 'c2', r.shots[2]);
const fakeVoid = topped.slice(); fakeVoid[2] = at(2, { combine: { void: 'misread' }, shot: { carry: 20, side: 0, review: { flags: ['topped'], mishit: true } } });
r = C.score(fakeVoid.concat([at(2, { tag: 'b', dt: 5, shot: { carry: 70, side: 0 } })]), 'standard', land);
check('ett omslag märkt "felmätning" på ett slag som var en riktig mätning håller inte: toppningen räknas', r.shots[2].score === 0 && r.shots[2].shot === 'c2', r.shots[2]);
const misread = nine.slice(); misread[4] = at(4, { combine: { void: 'misread' }, shot: { carry: 300, side: 0, review: { flags: ['smash_impossible'], misread: true } } });
r = C.score(misread.concat([at(4, { tag: 'b', dt: 5, shot: { carry: 110, side: 0 } })]), 'standard', land);
check('en felmätning (orimlig smash factor) får slås om, med orsaken kvar på slaget', r.shots[4].score === 100 && r.shots[4].shot === 'c4b' && r.total === 100, r.shots[4]);
// the server's own misread check, not the device's review: a shot the device calls a misread but whose smash factor was fine is not one
const claimed = nine.slice(); claimed[4] = at(4, { combine: { void: 'misread' }, shot: { carry: 60, side: 0, review: { flags: ['smash_impossible'], misread: true } } });
const serverSays = s => s.ballSpeed / s.clubSpeed > 1.5;
const withClubSpeed = claimed.map(x => Object.assign({}, x, { clubSpeed: 90 })).concat([Object.assign(at(4, { tag: 'b', dt: 5, shot: { carry: 110, side: 0 } }), { clubSpeed: 90 })]);
r = C.score(withClubSpeed, 'standard', land, { misread: serverSays });
check('servern avgör felmätning själv: en "felmätning" som enheten påstår men där smash factor var rimlig får inte slås om', r.shots[4].shot === 'c4' && r.shots[4].score < 100, r.shots[4]);
const realMis = withClubSpeed.map(x => x.cid === 'c4' ? Object.assign({}, x, { ballSpeed: 180 }) : x);
r = C.score(realMis, 'standard', land, { misread: serverSays });
check('och en verklig felmätning (180 mph på 90 mph klubbfart) får slås om', r.shots[4].shot === 'c4b', r.shots[4]);
const noAxis = nine.slice(); noAxis[6] = at(6, { combine: { void: 'missing_value' }, shot: { carry: 150, side: 0, estimated: ['spinAxisDeg'] } });
r = C.score(noAxis.concat([at(6, { tag: 'b', dt: 5, shot: { carry: 150, side: 0 } })]), 'standard', land);
check('ett slag där ett mätvärde saknades får slås om', r.shots[6].shot === 'c6b' && r.official);
const est = nine.slice(); est[1] = at(1, { shot: { carry: 50, side: 0, estimated: ['azimDeg'] } });
r = C.score(est, 'standard', land);
check('spelat utan omslag med ett uppskattat värde: komplett men bara träning, aldrig officiellt', r.complete && !r.official && r.total === 100 && r.shots[1].measured === false, r);
r = C.score(nine.slice(0, 8), 'standard', land);
check('ett mål utan slag: inte komplett, ingen total', !r.complete && r.total === null && r.missing.join() === '8');
const mixed = C.LEVELS.standard.map((D, i) => at(i, { shot: { carry: D - [0, 2, 9, 1, 12, 3, 0, 15, 4][i], side: 0 } }));
r = C.score(mixed, 'standard', land);
// 70 m 9 m short (radius 14): 36; 110 m 12 short (22): 45; 170 m 15 short (34): 56; the rest 80 and more
check('de tre mål som kostade mest, sämst först: 70 m (36), 110 m (45), 170 m (56)', r.worst.join() === '2,4,7' && r.shots[2].score === 36 && r.shots[4].score === 45 && r.shots[7].score === 56, [r.worst, r.shots.map(x => x.score)]);

console.log('\n4. Historik');
const res = [{ level: 'standard', official: true, total: 60, finished: 1 }, { level: 'standard', official: true, total: 72, finished: 2 }, { level: 'standard', official: false, total: 95, finished: 3 },
  { level: 'advanced', official: true, total: 80, finished: 4 }, { level: 'standard', official: true, total: 65, finished: 5 }, { level: 'standard', official: true, total: 66, finished: 6 },
  { level: 'standard', official: true, total: 67, finished: 7 }, { level: 'standard', official: true, total: 70, finished: 8 }];
const h = C.history(res, 'standard');
check('senaste, bästa och de fem senaste, bara officiella och bara samma nivå', h.latest.total === 70 && h.best.total === 72 && h.last5.map(x => x.total).join() === '72,65,66,67,70' && h.count === 6, h);
check('en nivå utan resultat', C.history(res, 'beginner').latest === null);
const two = [{ level: 'standard', official: true, total: 80, finished: 1, physics: 'flight-2024.1' }, { level: 'standard', official: true, total: 60, finished: 2, physics: 'flight-2027.1' }];
check('fysikversioner blandas inte: personbästa och historik bara för samma bollflykt', C.history(two, 'standard', 'flight-2027.1').best.total === 60 && C.history(two, 'standard', 'flight-2027.1').count === 1 &&
  C.history(two, 'standard', 'flight-2024.1').best.total === 80);

console.log(failed ? '\n' + failed + ' failed' : '\nAll combine checks passed');
process.exit(failed ? 1 : 0);
