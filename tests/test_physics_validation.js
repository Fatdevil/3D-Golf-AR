// The physics validation bank (physics-validation/validate.js): the CSV import of launch monitor shot pairs, the calibration / test
// split, the error statistics, the goals, and the regression guard against physics-validation/baseline.json.
const fs = require('fs');
const path = require('path');
const V = require('../physics-validation/validate.js');

let failed = 0;
function check(name, ok, detail) { console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const near = function (a, b, tol) { return Math.abs(a - b) <= tol; };

console.log('1. CSV från launch monitorernas appar');
{
  const a = V.parseCsv('Club,Ball Speed (mph),Launch Angle (deg),Spin Rate (rpm),Spin Axis,Launch Direction,Carry Distance (yds)\n7 Iron,120.5,16.2,6900,2.1,-1.5,168.4\nPW,98,24,9100,,,128\n', { name: 'a' });
  check('rubriker i klartext med enheter: alla rader lästa', !a.refused && a.rows.length === 2 && a.rows[0].ballSpeedMph === 120.5 && a.rows[0].carryYd === 168.4 && a.rows[0].spinAxisDeg === 2.1 && a.rows[0].hlaDeg === -1.5, a);
  check('id ur filnamn och rad, klubban följer med', a.rows[0].id === 'a:2' && a.rows[0].club === '7 Iron' && a.rows[1].spinAxisDeg === 0, a.rows);
  const m = V.parseCsv('club;ball speed (m/s);vla;total spin;carry (m)\nPW;45,0;24,0;9000;120,5\n', { name: 'm' });
  check('semikolon, decimalkomma, m/s och meter räknas om till mph och yd', m.rows.length === 1 && near(m.rows[0].ballSpeedMph, 100.66, 0.05) && near(m.rows[0].carryYd, 131.78, 0.05), m.rows);
  const u = V.parseCsv('Club,Ball Speed,Launch Angle,Back Spin,Side Spin,Carry\n,[mph],[deg],[rpm],[rpm],[m]\n7i,120,16,6900,-800,150\n', { name: 'u' });
  check('en rad med enheter under rubrikerna, och backspinn/sidospinn till totalspinn och axel', u.rows.length === 1 && near(u.rows[0].spinRpm, Math.hypot(6900, 800), 0.5) && near(u.rows[0].spinAxisDeg, -6.61, 0.05) && near(u.rows[0].carryYd, 150 * V.YD, 0.01), u.rows);
  const s = V.parseCsv('Ball Speed,Launch Angle,Spin Rate,Carry\n120,16,,150\n,16,6000,150\n120,,6000,150\n120,16,6000,\n', { name: 's' });
  check('rader utan spinn, bollfart, utgångsvinkel eller carry hoppas över med anledning', s.rows.length === 0 && s.skipped.map(function (x) { return x.reason; }).join('|') === 'no spin (the physics would fly it on a guess)|no ball speed|no launch angle|no carry', s.skipped);
  const own = V.parseCsv('#,time,club,source,carry_m,total_m,offline_m(+R),apex_m,ball_speed_mph,club_speed_mph,launch_deg,start_line_deg,spin_rpm,spin_axis_deg,club_path_deg,face_to_path_deg,attack_angle_deg,device,estimated,carry_from\n1,,7i,LM,150.0,160.0,1.0,30.0,120.0,,16.0,0.0,7000,0.0,,,,,,physics\n', { name: 'own' });
  check('en export från spelets egen rangesession avvisas (carry från spelets fysik)', own.refused && /physics/.test(own.refused) && own.rows.length === 0, own);
  const none = V.parseCsv('Foo,Bar\n1,2\n', { name: 'x' });
  check('utan kolumner för bollfart, utgångsvinkel eller carry: avvisad med råd om sidofil', none.refused && /sidecar/.test(none.refused), none);
  const side = V.parseCsv('BS,LA,SP,CY\n50,20,8000,60\n', { name: 'side', sidecar: { columns: { ballSpeed: 'BS', launch: 'LA', spin: 'SP', carry: 'CY' }, units: { ballSpeed: 'm/s', carry: 'm' }, conditions: { temperatureC: 20 } } });
  check('en sidofil namnger kolumner, enheter och förhållanden', side.rows.length === 1 && near(side.rows[0].ballSpeedMph, 111.85, 0.05) && near(side.rows[0].carryYd, 65.6, 0.05) && side.rows[0].conditions.temperatureC === 20, side.rows);
  const t = V.parseCsv('Ball Speed,Launch Angle,Spin Rate,Carry,Temperature (°F),Altitude (m)\n120,16,7000,170,77,100\n', { name: 't' });
  check('temperatur i °F och höjd i meter blir °C och fot', t.rows.length === 1 && near(t.rows[0].conditions.temperatureC, 25, 0.01) && near(t.rows[0].conditions.altitudeFeet, 328.08, 0.1), t.rows);
}

  const cm = V.parseCsv('Ball Speed,Launch Angle,Spin Rate,CarryM,AltitudeM\n120,16,7000,150,100\n', { name: 'cm' });
  check('enheten i själva rubriken (CarryM, AltitudeM) läses: meter, inte yards eller fot', cm.rows.length === 1 && near(cm.rows[0].carryYd, 150 * V.YD, 0.01) && near(cm.rows[0].conditions.altitudeFeet, 328.08, 0.1), cm.rows);
  const la = V.parseCsv('Ball Speed,Launch Angle,Spin Rate,Carry (yds),Landing Angle,Apex Height (ft)\n120,16,7000,170,48.5,90\n', { name: 'la' });
  check('uppmätt landningsvinkel och topphöjd följer med som mål (topphöjd i fot blir yards)', la.rows.length === 1 && la.rows[0].landingDeg === 48.5 && near(la.rows[0].apexYd, 30, 0.01), la.rows);
  // shot pairs with landing angles can decide the landing goal
  let lines = 'Club,Ball Speed,Launch Angle,Spin Rate,Carry,Descent Angle\n';
  for (let i = 0; i < 30; i++) lines += '7i,' + (118 + i % 5) + ',16,7000,170,50\n';
  const pairs = V.parseCsv(lines, { name: 'pairs' });
  const pr = V.evaluate({ tables: [], files: [{ name: 'pairs', rows: pairs.rows }] });
  const landingGoal = V.targetStatus(pr).filter(function (t) { return t.id === 'landing'; })[0];
  check('slagpar med landningsvinkel ger ett landningsfel och avgör landningsmålet', pr.every(function (r) { return typeof r.err.landingDeg === 'number'; }) && landingGoal.n > 0 && landingGoal.met !== null, landingGoal);

console.log('\n2. Uppdelning och grupper');
{
  const ids = []; for (let i = 0; i < 2000; i++) ids.push('f:' + i);
  const test = ids.filter(function (id) { return V.splitOf(id) === 'test'; }).length;
  check('ungefär 30 % test, och samma id hamnar alltid i samma mängd', test > 520 && test < 680 && ids.every(function (id) { return V.splitOf(id) === V.splitOf(id); }), test);
  check('klubbgrupper', ['Dr', 'Driver', '3W', '5 Wood', 'Hy', '4H'].every(function (c) { return V.clubGroup(c) === 'woods'; }) && ['5i', '7 Iron', '9i'].every(function (c) { return V.clubGroup(c) === 'irons'; }) &&
    ['PW', 'SW', 'LW', 'GW', 'Sand Wedge', '56°'].every(function (c) { return V.clubGroup(c) === 'wedges'; }) && V.clubGroup('') === 'other', ['Dr', '7 Iron', '56°'].map(V.clubGroup));
  check('fartband', V.speedBand(55) === '<60 mph' && V.speedBand(99) === '60-100 mph' && V.speedBand(120) === '100-140 mph' && V.speedBand(171) === '140+ mph');
  const st = V.stats([{ err: { carryYd: -2 } }, { err: { carryYd: 4 } }, { err: { carryYd: -6 } }], 'carryYd');
  check('statistik: medianfel, bias (median med tecken) och p90', st.n === 3 && st.medianAbs === 4 && st.bias === -2 && st.p90Abs === 6, st);
}

console.log('\n3. Referensbanken');
const bank = V.loadBank();
const results = V.evaluate(bank);
{
  const pga = bank.tables.filter(function (t) { return t.id === 'trackman-pga-2024'; })[0], lpga = bank.tables.filter(function (t) { return t.id === 'lpga-2014'; })[0];
  check('PGA 2024 är kontrollerad, LPGA 2014 är det inte', pga && pga.verified === true && lpga && lpga.verified === false);
  check('varje tabellrad har indata, mål, källa och förhållanden', bank.tables.every(function (t) { return t.source && t.conditions && t.rows.every(function (r) { return r.id && r.ballSpeedMph > 0 && typeof r.launchDeg === 'number' && r.spinRpm > 0 && r.carryYd > 0; }); }));
  // the whole table (driver to PW, 12 clubs) from TrackMan's own screenshot; the driver and PW rows as in the game's club profiles
  const byId = {}; pga.rows.forEach(function (r) { byId[r.id] = r; });
  check('PGA-tabellen har alla tolv klubbor, och drivern och PW stämmer med spelets klubbprofiler', pga.rows.length === 12 && byId['pga24-driver'].ballSpeedMph === 171 && byId['pga24-driver'].launchDeg === 10.4 &&
    byId['pga24-driver'].spinRpm === 2545 && byId['pga24-pw'].spinRpm === 9316 && byId['pga24-3w'].carryYd === 249 && byId['pga24-8i'].launchDeg === 17.8, pga.rows.map(function (r) { return r.id; }));
  const shotsDir = path.join(V.REF_DIR, 'shots');
  const csvs = fs.readdirSync(shotsDir).filter(function (f) { return /\.csv$/i.test(f); });
  check('slagparsfilerna läses utan att någon avvisas', bank.files.every(function (f) { return !f.refused; }) && bank.files.length === csvs.length, bank.files.map(function (f) { return [f.name, f.refused]; }));
  check('varje rad kördes genom fysiken', results.length === bank.tables.reduce(function (n, t) { return n + t.rows.length; }, 0) + bank.files.reduce(function (n, f) { return n + f.rows.length; }, 0) &&
    results.every(function (r) { return r.engine.carryYd > 0; }), results.length);
  const goals = V.targetStatus(results);
  check('målen mäts bara på kontrollerade slagpar i testmängden: utan slagpar är de inte avgjorda', goals.length === 3 && goals.every(function (g) {
    const pairs = results.filter(function (r) { return r.kind === 'shot' && r.verified && r.set === 'test'; }).length;
    return pairs > 0 || g.met === null;
  }), goals);
}

console.log('\n4. Regressionsspärren (baseline.json)');
{
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'physics-validation', 'baseline.json'), 'utf8'));
  const reg = V.regressions(results, baseline);
  check('ingen tabellrad är sämre än baslinjen (' + V.SLACK.carryYd + ' yd / ' + V.SLACK.landingDeg + '° marginal)', reg.length === 0, reg);
  check('baslinjen täcker varje kontrollerad tabellrad och ingen okontrollerad', results.filter(function (r) { return r.kind === 'average'; }).every(function (r) { return r.verified ? !!baseline[r.id] : !baseline[r.id]; }), Object.keys(baseline));
  // a row written from memory never stops a change, even if an older baseline still has it
  const withLpga = Object.assign({}, V.baselineOf(results), { 'lpga14-driver': { absErr: { carryYd: 0, apexYd: 0, landingDeg: 0 } } });
  check('en okontrollerad rad stoppar aldrig en ändring, inte ens om en äldre baslinje har den', V.regressions(results, withLpga).length === 0, V.regressions(results, withLpga));
  // the guard itself, against a baseline of today's results (so it holds whatever the physics gives): a row that got 2 yd worse (away from
  // its target) is caught, one that got better is not
  const today = V.baselineOf(results);
  const worse = results.map(function (r) { return r.id === 'pga24-7i' ? Object.assign({}, r, { err: Object.assign({}, r.err, { carryYd: r.err.carryYd + (r.err.carryYd < 0 ? -2 : 2) }) }) : r; });
  const better = results.map(function (r) { return r.id === 'pga24-driver' ? Object.assign({}, r, { err: Object.assign({}, r.err, { carryYd: 0 }) }) : r; });
  const caught = V.regressions(worse, today);
  check('spärren fångar en rad som blev 2 yd sämre, men inte en som blev bättre', caught.length === 1 && caught[0].id === 'pga24-7i' && caught[0].measure === 'carryYd' && V.regressions(better, today).length === 0, caught);
}

console.log('\n5. Rapporten');
{
  const T = require('../tools/physics-validation.js');
  const committed = fs.readFileSync(T.REPORT, 'utf8');
  check('docs/physics-validation-report.md är aktuell (kör node tools/physics-validation.js --write efter en ändring av fysiken eller banken)', committed === T.buildReport().text);
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll physics validation checks passed');
process.exit(failed ? 1 : 0);
