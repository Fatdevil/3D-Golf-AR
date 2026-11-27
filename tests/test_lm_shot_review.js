/**
 * A range shot from a launch monitor before it goes into the bag (lm-shot-review.js): the raw message kept as it came, carry and total in
 * standard conditions, mishits, misreads and a shot that looks like another club of the player's own bag; and how the bag and the range
 * session leave such a shot out until the player counts it. Run: node tests/test_lm_shot_review.js
 */
global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
const R = require('../lm-shot-review.js');
global.window.LMShotReview = R;
const B = require('../arcade-bag.js');
const RS = require('../arcade-range-session.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

console.log('1. Rådata');
const msg = { ballSpeedMph: 123, launchAngleDeg: 16.1, totalSpinRpm: null, spinAxisDeg: null, azimDeg: 1.2, clubSpeedMph: 88, clubPathDeg: null,
              faceToPathDeg: null, clubAoADeg: null, measured: ['ballSpeedMph', 'launchAngleDeg', 'azimDeg', 'clubSpeedMph'], deviceId: 'R10', shotNumber: 7,
              isLiveData: true, quality: { x: 1 } };
const raw = R.rawOf(msg);
check('rådatan är meddelandet som det kom: null förblir null, mätlistan och enheten följer med, spelets egna fält gör det inte',
  raw.totalSpinRpm === null && raw.ballSpeedMph === 123 && raw.deviceId === 'R10' && raw.shotNumber === 7 && raw.measured.length === 4 && !('isLiveData' in raw) && !('quality' in raw), raw);
msg.measured.push('x');
check('rådatan är en kopia (ändras inte när meddelandet ändras)', raw.measured.length === 4, raw.measured);
check('inget meddelande ger ingen rådata', R.rawOf(null) === null);

console.log('\n2. Standardförhållanden');
const shot7 = { source: 'LM', club: '7i', ballSpeed: 123, launch: 16.1, spin: 7124, spinAxis: 0, hla: 0 };
const st = R.standard(G, shot7);
check('carry och total räknas i vindstilla vid havsnivå och 15 °C (TrackMans 7-järn: drygt 150 m carry)', st && st.carry > 145 && st.carry < 165 && st.total >= st.carry, st);
check('samma slag ger samma standardcarry (oberoende av rangens vind och väder)', near(R.standard(G, shot7).carry, st.carry, 1e-9));
const right = R.standard(G, Object.assign({}, shot7, { hla: 5 })), left = R.standard(G, Object.assign({}, shot7, { hla: -5 })), slice = R.standard(G, Object.assign({}, shot7, { spinAxis: 15 }));
check('sidled där bollen landar i standardförhållanden: rakt nära 0, höger start eller slice åt höger, vänster start åt vänster', Math.abs(st.side) < 0.5 && right.side > 5 && left.side < -5 && slice.side > 5 && near(right.side, -left.side, 0.5), [st.side, right.side, left.side, slice.side]);
check('utan fysik eller spinn går det inte att räkna', R.standard(null, shot7) === null && R.standard(G, Object.assign({}, shot7, { spin: null })) === null);

console.log('\n3. Felträffar och felmätningar');
const flags = function (s, own) { return R.review(Object.assign({ source: 'LM', club: '7i', ballSpeed: 120, launch: 17, clubSpeed: 87, hla: 1 }, s), own); };
check('ett rent 7-järn har inga anmärkningar', flags({}).flags.length === 0 && !flags({}).mishit, flags({}));
check('en toppad boll (utgångsvinkel 2° med 7-järn) är en felträff', flags({ launch: 2 }).flags.indexOf('topped') >= 0 && flags({ launch: 2 }).mishit);
check('en tunn träff (smash factor 1,05 med 7-järn) är en felträff', flags({ ballSpeed: 92, clubSpeed: 88 }).flags.indexOf('thin') >= 0 && flags({ ballSpeed: 92, clubSpeed: 88 }).mishit);
check('en smash factor som ingen klubba ger (1,7) är en felmätning, inte en felträff', flags({ ballSpeed: 150, clubSpeed: 88 }).misread && !flags({ ballSpeed: 150, clubSpeed: 88 }).mishit);
check('en startriktning 20° ut är en shank', flags({ hla: -20 }).flags.indexOf('offline_start') >= 0 && flags({ hla: -20 }).mishit);
check('en driver med 10° utgångsvinkel och smash 1,48 är ren', flags({ club: 'Dr', ballSpeed: 155, clubSpeed: 105, launch: 10 }).flags.length === 0);
check('en lob wedge med 30° och smash 1,1 är ren (wedgar har lägre smash factor)', flags({ club: 'LW', ballSpeed: 66, clubSpeed: 60, launch: 30 }).flags.length === 0);
check('utan klubbfart bedöms ingen smash factor', flags({ clubSpeed: null, ballSpeed: 60 }).flags.length === 0);
check('en putt eller chip (under 25 mph) granskas inte', flags({ ballSpeed: 12, launch: 1 }).flags.length === 0);
check('slag från svingmätaren granskas inte (de mäter spelets klubbor)', flags({ source: 'SIM', launch: 1 }).flags.length === 0);
check('utan vald klubba bedöms bara startriktningen', flags({ club: null, launch: 1 }).flags.length === 0 && flags({ club: null, hla: 25 }).flags[0] === 'offline_start');

console.log('\n4. Fel klubba och spelarens egna farter');
const bagOf = function (club, speeds, t0) { return speeds.map(function (v, i) { return { t: t0 + i, club: club, carry: 100, total: 105, ballSpeed: v }; }); };
const entries = bagOf('7i', [118, 120, 121, 119, 122, 120], 100).concat(bagOf('5i', [131, 133, 132, 134, 130], 200)).concat(bagOf('PW', [98, 100, 99, 101, 97], 300));
const own = R.ownSpeeds(entries);
check('spelarens egna bollfarter per klubba: median och spridning', own['7i'].n === 6 && near(own['7i'].median, 120, 1e-9) && own['7i'].spread > 0 && own['7i'].spread < 4, own['7i']);
const wrong = flags({ ballSpeed: 132, clubSpeed: 92, launch: 13 }, own);
check('ett slag med 132 mph med "7-järn" ser ut som spelarens 5-järn', wrong.looksLike === '5i' && wrong.flags.indexOf('wrong_club') >= 0 && !wrong.mishit, wrong);
check('ett slag som passar den valda klubban får ingen klubbvarning', flags({ ballSpeed: 121 }, own).looksLike === null);
const short = flags({ ballSpeed: 85, clubSpeed: 70 }, own);
check('en bollfart långt under spelarens egen (85 mot 120 mph) är en kort träff, även med godkänd smash', short.flags.indexOf('short') >= 0 && short.mishit && short.looksLike === null, short);
check('med färre än 5 egna slag med klubban används inte spelarens snitt', flags({ ballSpeed: 132, clubSpeed: null }, R.ownSpeeds(bagOf('7i', [120, 121], 1).concat(bagOf('5i', [132, 133, 131, 134, 132], 9)))).flags.length === 0);
const between = flags({ ballSpeed: 109 }, own);
check('ett slag mitt emellan två klubbor (varken 7-järn eller PW) får ingen gissad klubba', between.looksLike === null, between);
check('en udda felträff bland spelarens slag drar inte iväg medianen', near(R.ownSpeeds(bagOf('7i', [120, 120, 121, 119, 60], 1))['7i'].median, 120, 1e-9));

console.log('\n5. Bagen');
let bag = [];
bag = B.upsert(bag, { t: 1, source: 'LM', club: '7i', carry: 140, total: 148, carryStd: 150, totalStd: 158, ballSpeed: 120 });
check('bagen sparar standardcarry och -total när de finns, och bollfarten', bag[0].carry === 150 && bag[0].total === 158 && bag[0].ballSpeed === 120, bag);
bag = B.upsert(bag, { t: 2, source: 'LM', club: '7i', carry: 90, total: 110, review: { flags: ['topped'], mishit: true, misread: false, looksLike: null } });
check('en felträff kommer inte in i bagen', bag.length === 1, bag);
bag = B.upsert(bag, { t: 2, source: 'LM', club: '7i', carry: 90, total: 110, review: { flags: ['topped'], mishit: true, misread: false, looksLike: null }, accepted: true });
check('men gör det när spelaren räknar den ändå', bag.length === 2, bag);
bag = B.upsert(bag, { t: 3, source: 'LM', club: '7i', carry: 170, total: 180, review: { flags: ['wrong_club'], mishit: false, misread: false, looksLike: '5i' } });
bag = B.upsert(bag, { t: 4, source: 'LM', club: '7i', carry: 140, total: 150, review: { flags: ['smash_impossible'], mishit: false, misread: true, looksLike: null } });
check('ett slag som ser ut som en annan klubba eller är en felmätning kommer inte in i bagen', bag.length === 2, bag);

console.log('\n6. Rangesessionen');
const rec = RS.prepare({ t: 50, source: 'LM', club: '7i', carry: 140, total: 147, ballSpeed: 132, launch: 13, spin: 5500, spinAxis: 0, hla: 0, clubSpeed: 92 }, G, entries);
check('ett slag förbereds med standarddistanser och en granskning mot spelarens bag', rec.carryStd > 0 && rec.totalStd >= rec.carryStd && rec.review.looksLike === '5i', rec);
check('ett flaggat slag räknas inte i klubbsnittet, men ett ändå räknat gör det', RS.fullSwings([rec]).length === 0 && RS.fullSwings([Object.assign({}, rec, { accepted: true })]).length === 1);
const sim = RS.prepare({ t: 51, source: 'SIM', club: '7i', carry: 140, ballSpeed: 132, launch: 13, spin: 5500 }, G, entries);
check('svingmätarens slag förbereds inte (ingen granskning, ingen standardcarry)', sim.review === undefined && sim.carryStd === undefined, sim);
const csv = RS.toCSV([Object.assign({}, rec, { raw: { ballSpeedMph: 132, totalSpinRpm: null } })], true).split('\n');
const head = csv[0].split(','), row = csv[1];
check('CSV:n får standardcarry, anmärkningar, om slaget räknas och rådatan, efter de gamla kolumnerna',
  head.slice(-5).join(',') === 'carry_std_m,total_std_m,flags,counted,raw' && head.indexOf('carry_from') === head.length - 6 && /wrong_club:5i,no,"\{""ballSpeedMph"":132,""totalSpinRpm"":null\}"$/.test(row), row);
check('rubriken på standardcarry följer spelarens enhet', RS.toCSV([rec], false).split('\n')[0].indexOf('carry_std_yd') >= 0);

console.log('\n7. Orden');
check('anmärkningarna skrivs ut på svenska och engelska, med klubban', /ser ut som 5i/.test(R.describe(rec.review, true)) && /looks like 5i/.test(R.describe(rec.review, false)));
check('ett rent slag har ingen text', R.describe({ flags: [] }, true) === '');

console.log(failed ? '\n' + failed + ' failed' : '\nAll shot review checks passed');
process.exit(failed ? 1 : 0);
