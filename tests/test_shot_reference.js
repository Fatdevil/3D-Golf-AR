/**
 * Reference values of a launch monitor (shot-reference.js): a reference from the bridge (its own carry) is kept with its unit and in metres,
 * missing values stay null, a CSV export from a launch monitor app is read with mixed units and left/right sides, a file whose distance unit
 * is unknown is refused (never guessed), and a row is matched to a shot only when it fits exactly one shot and no other row fits that shot.
 * Run: node tests/test_shot_reference.js
 */
const R = require('../shot-reference.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const near = (a, b, e) => typeof a === 'number' && Math.abs(a - b) <= (e || 0.01);

console.log('1. En referens från bryggan');
let n = R.normalizeRef({ source: 'gspro-openconnect', quality: 'lm_calculated', carry: { value: 150, unit: 'yd' } });
check('carry i yards sparas som den kom och i meter', n.ok && near(n.ref.carry_m, 137.16) && n.ref.orig.carry.value === 150 && n.ref.orig.carry.unit === 'yd', n);
check('saknad total och sidled förblir null, aldrig 0', n.ok && n.ref.total_m === null && n.ref.side_m === null && !n.ref.orig.total, n);
n = R.normalizeRef({ source: 'x', quality: 'measured_landing', carry: { value: 100, unit: 'm' }, side: { value: -4.5, unit: 'm' } });
check('uppmätt landning med sidled åt vänster', n.ok && n.ref.quality === 'measured_landing' && n.ref.side_m === -4.5, n);
check('okänd kvalitet avvisas', !R.normalizeRef({ source: 'x', quality: 'guess', carry: { value: 100, unit: 'm' } }).ok);
check('okänd enhet avvisas (ingen gissning)', R.normalizeRef({ source: 'x', quality: 'lm_calculated', carry: { value: 100, unit: 'ft' } }).reason === 'bad_carry');
check('orimlig carry avvisas', R.normalizeRef({ source: 'x', quality: 'lm_calculated', carry: { value: 900, unit: 'm' } }).reason === 'bad_carry');
check('en referens utan något värde avvisas', R.normalizeRef({ source: 'x', quality: 'lm_calculated' }).reason === 'no_value');
check('källa med otillåtna tecken avvisas', R.normalizeRef({ source: '<script>', quality: 'lm_calculated', carry: { value: 100, unit: 'm' } }).reason === 'bad_source');

console.log('\n2. CSV från launch monitorns app');
const csvYd = 'Shot,Club,Ball Speed (mph),Launch Angle,Spin Rate,Launch Direction,Carry Distance (yds),Total Distance (yds),Carry Deviation (yds)\n' +
  '1,7 Iron,120.0,16.0,7000,1.0,165.0,175.0,4.2 R\n' +
  '2,7 Iron,118.5,17.1,7200,-2.0,160.0,170.0,6.1 L\n';
let p = R.parseImport(csvYd, {});
check('två rader lästa, slagnummer med', !p.refused && p.rows.length === 2 && p.rows[0].shotNumber === 1 && p.rows[1].shotNumber === 2, p);
check('enheter ur rubrikerna: carry, total och sidled i yards', p.units.carry === 'yd' && p.units.total === 'yd' && p.units.side === 'yd', p.units);
check('"4.2 R" är +4,2 och "6.1 L" är -6,1 (höger positiv)', p.rows[0].side.value === 4.2 && p.rows[1].side.value === -6.1, p.rows.map(r => r.side));
check('total med', p.rows[0].total.value === 175 && p.rows[0].total.unit === 'yd');
// blandade enheter: bollfart i m/s, carry i meter, sidled i yards
const mixed = 'Ball Speed (m/s);Launch Angle;Spin Rate;Carry (m);Offline (yds)\n53,6;16,0;7000;150,5;-3,0\n';
p = R.parseImport(mixed, { sideSign: 'right_positive' });
check('blandade enheter: m/s blir mph, carry i meter och sidled i yards behålls var för sig', !p.refused && near(p.rows[0].ballSpeedMph, 53.6 * 2.23694, 0.01) &&
  p.rows[0].carry.unit === 'm' && p.rows[0].carry.value === 150.5 && p.rows[0].side.unit === 'yd' && p.rows[0].side.value === -3, p);
check('...och i meter blir de rätt', (function () {
  const x = R.normalizeRef({ source: 's', quality: 'lm_calculated', carry: p.rows[0].carry, side: p.rows[0].side });
  return x.ok && near(x.ref.carry_m, 150.5) && near(x.ref.side_m, -3 / 1.09361);
})());
const noUnit = 'Ball Speed,Launch Angle,Spin Rate,Carry\n120,16,7000,150\n';
check('carry utan enhet i filen och utan angiven enhet: filen avvisas, ingen gissning', R.parseImport(noUnit, {}).refused === 'unknown_distance_unit');
p = R.parseImport(noUnit, { distanceUnit: 'm' });
check('...med angiven enhet läses den', !p.refused && p.rows[0].carry.unit === 'm');
const plain = 'Ball Speed,Launch Angle,Spin Rate,Carry (m),Side (m)\n120,16,7000,150,5\n';
check('en sidled utan L/R följer den angivna konventionen', R.parseImport(plain, { sideSign: 'right_positive' }).rows[0].side.value === 5 &&
  R.parseImport(plain, { sideSign: 'left_positive' }).rows[0].side.value === -5);
check('ett uttryckligt L/R gäller oavsett konvention', R.parseImport(csvYd, { sideSign: 'left_positive' }).rows[0].side.value === 4.2);
check('en export från spelets egen rangesession avvisas (carry från spelets fysik)', R.parseImport('#,carry_m,ball_speed_mph,launch_deg,spin_rpm,carry_from\n1,150,120,16,7000,physics\n', {}).refused === 'game_export');
check('en fil utan bollfart eller carry avvisas', R.parseImport('Foo,Bar\n1,2\n', {}).refused === 'no_columns');
check('en tom fil avvisas', R.parseImport('', {}).refused === 'empty_file');
p = R.parseImport('Ball Speed,Launch Angle,Spin Rate,Carry (m)\n120,16,,150\n121,16,7000,151\n', {});
check('rader utan spinn hoppas över med skäl, de andra läses', p.rows.length === 1 && p.skipped.length === 1 && /spin/.test(p.skipped[0].reason), p);

console.log('\n3. Matchning mot slagbankens slag');
const shot = (cid, bs, la, spin, o) => Object.assign({ cid: cid, source: 'LM', ballSpeed: bs, launch: la, spin: spin, hla: 1, raw: { measured: [] } }, o || {});
const row = (line, bs, la, spin, o) => Object.assign({ line: line, ballSpeedMph: bs, launchDeg: la, spinRpm: spin, hlaDeg: null, shotNumber: null }, o || {});
let m = R.match([row(2, 120.0, 16.0, 7000)], [shot('a', 120.04, 16.02, 7003), shot('b', 110, 18, 7500)]);
check('en rad som passar exakt ett slag matchas', m.matched.length === 1 && m.matched[0].cid === 'a' && !m.unmatched.length, m);
m = R.match([row(2, 120.0, 16.0, 7000)], [shot('a', 120.1, 16.0, 7000), shot('b', 119.9, 16.1, 7010)]);
check('två slag med samma värden: tvetydig, matchas inte', !m.matched.length && m.unmatched[0].reason === 'ambiguous' && m.unmatched[0].candidates === 2, m);
m = R.match([row(2, 120.0, 16.0, 7000), row(3, 120.1, 16.1, 7010)], [shot('a', 120.05, 16.05, 7005)]);
check('två rader som passar samma slag: ingen av dem matchas', !m.matched.length && m.unmatched.every(u => u.reason === 'shared'), m);
m = R.match([row(2, 150, 12, 3000)], [shot('a', 120, 16, 7000)]);
check('inget slag med dessa värden: omatchad', !m.matched.length && m.unmatched[0].reason === 'no_candidate', m);
m = R.match([row(2, 120, 16, 7000)], [shot('a', 120, 16, 7600)]);
check('spinn som skiljer mer än 2 %: inte samma slag', !m.matched.length, m);
m = R.match([row(2, 120, 16, 7000, { shotNumber: 7 })], [shot('a', 120, 16, 7000, { raw: { shotNumber: 7 } }), shot('b', 120, 16, 7000, { raw: { shotNumber: 8 } })]);
check('slagnumret skiljer två slag med samma värden åt', m.matched.length === 1 && m.matched[0].cid === 'a', m);
m = R.match([row(2, 120, 16, 7000, { shotNumber: 9 })], [shot('a', 120, 16, 7000, { raw: { shotNumber: 8 } })]);
check('olika slagnummer: inte samma slag', !m.matched.length && m.unmatched[0].reason === 'no_candidate', m);
m = R.match([row(2, 120, 16, 7000)], [shot('a', 120, 16, 7000, { source: 'SIM' })]);
check('svingmätarslag matchas aldrig', !m.matched.length);
m = R.match([row(2, 120, 16, 7000, { hlaDeg: 5 })], [shot('a', 120, 16, 7000, { hla: 1 })]);
check('startriktning som skiljer mer än 1°: inte samma slag', !m.matched.length);
m = R.match([row(2, 120, 16, 7000)], [shot('a', 120, 16, 4000, { estimated: ['totalSpinRpm'] })]);
check('ett uppskattat spinn i slagbanken jämförs inte (matchning på bollfart och vinkel)', m.matched.length === 1);

console.log(failed ? '\n❌ ' + failed + ' check(s) failed' : '\nAll shot reference checks passed');
process.exit(failed ? 1 : 0);
