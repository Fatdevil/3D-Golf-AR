/**
 * The ball flight's version (physics.js VERSION): fixed shots flown now must give the carries recorded for the version
 * (physics-validation/physics-version.json). A change to the flight that moves a shot fails here until the version is raised and the
 * fingerprint recorded again (node tests/test_physics_version.js --update), so the shot bank never mixes distances of two flights under one version.
 * Run: node tests/test_physics_version.js
 */
const fs = require('fs');
const path = require('path');
const V = require('../physics-validation/validate.js');
const FILE = path.join(__dirname, '..', 'physics-validation', 'physics-version.json');
const SHOTS = [[171, 10.4, 2545], [123, 16.1, 7124], [104, 23.7, 9316], [88, 25.2, 8465], [60, 28, 7000], [30, 30, 4000], [143, 12.6, 2506, 6], [110, 14, 5000, -4]];
global.window = global.window || { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const G = global.window.GolfPhysics;
const fingerprint = SHOTS.map(function (s) {
  const f = V.fly({ ballSpeedMph: s[0], launchDeg: s[1], spinRpm: s[2], spinAxisDeg: s[3] || 0 }, { temperatureC: 15, altitudeFeet: 0 });
  return Math.round(f.carryM * 100) / 100;
});
if (process.argv.indexOf('--update') >= 0) {
  fs.writeFileSync(FILE, JSON.stringify({ version: G.VERSION, shots: SHOTS, carryM: fingerprint }, null, 2) + '\n');
  console.log('Wrote ' + FILE + ' for ' + G.VERSION);
  process.exit(0);
}
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const rec = JSON.parse(fs.readFileSync(FILE, 'utf8'));
check('fysiken har en version', typeof G.VERSION === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(G.VERSION), G.VERSION);
const same = rec.carryM.length === fingerprint.length && rec.carryM.every(function (c, i) { return Math.abs(c - fingerprint[i]) < 0.011; });
check('samma version ger samma flykt (ändras flykten: höj VERSION i physics.js och kör med --update)', rec.version === G.VERSION ? same : !same,
  { recorded: rec.version, now: G.VERSION, carryRecorded: rec.carryM, carryNow: fingerprint });
check('och en ny version är en ny flykt (inte bara ett nytt namn)', rec.version === G.VERSION || !same, rec.version);
console.log(failed ? '\n' + failed + ' failed' : '\nAll physics version checks passed');
process.exit(failed ? 1 : 0);
