/**
 * "Bollen stannar inte": lutningsvyn färgar det som är brantare än en rullande boll kan bli liggande på, och gränsen följer stimp.
 * 1. GolfPhysics.restSlopeLimitPct: mu / (5/7) i procent (green: mu ur stimp; foregreen: rullbromsen), och det är fysikens egen gräns:
 *    en putt uppför en lutning strax under gränsen blir liggande uppe, strax över rullar den tillbaka förbi startpunkten.
 * 2. Färgen: slopePercentToColor, rutnätet och heatmapens shader ger magenta från gränsen (green och foregreen var för sig), annars
 *    som förut; gränsen följer stimp och ingår i cache-nycklarna.
 * 3. Förklaringen: röda bandet slutar vid gränsen och "Stannar inte ≥ X %" visar den, på svenska och engelska.
 * Run: node tests/test_rest_slope.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const P = global.window.GolfPhysics, MPH = 0.44704;
Math.random = () => 0.5;

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

// ---- 1. physics ----
console.log('1. Gränsen i fysiken');
check('green vid stimp 10: 7,84 %', Math.abs(P.restSlopeLimitPct('GREEN', 10) - 7.84) < 0.01, P.restSlopeLimitPct('GREEN', 10).toFixed(3));
check('green vid stimp 13: 6,03 % (snabbare green, lägre gräns)', Math.abs(P.restSlopeLimitPct('GREEN', 13) - 6.03) < 0.01, P.restSlopeLimitPct('GREEN', 13).toFixed(3));
check('foregreen: rullbromsen 0,88 m/s², oberoende av stimp', Math.abs(P.restSlopeLimitPct('FOREGREEN', 10) - 100 * 0.88 / 9.81 * 1.4) < 1e-9 && P.restSlopeLimitPct('FOREGREEN', 13) === P.restSlopeLimitPct('FOREGREEN', 10));

// a putt straight up a plane of the given slope (%): where it comes to rest along the slope (m, + is uphill)
function restUphill(slopePct, stimp) {
  global.window.GREEN_STIMP = stimp;
  const sy = slopePct / 100, nl = Math.hypot(sy, 1), N = [0, -sy / nl, 1 / nl];
  const env = { getTerrainAt: (x, y) => ({ z: sy * y, normal: N, type: 'GREEN' }), checkCollisionCallback: () => null, wind: [0, 0, 0], temperatureC: 15 };
  const log = console.log; console.log = () => {};
  try {
    const r = P.simulateFlight({ startPos: [0, 0, 0], azimDeg: 0, spinAxisDeg: 0, ballSpeedMph: 1.2 / MPH, launchAngleDeg: 0, totalSpinRpm: 0, isLiveData: true }, env);
    return r.path[r.path.length - 1].y;
  } finally { console.log = log; }
}
for (const stimp of [10, 13]) {
  const lim = P.restSlopeLimitPct('GREEN', stimp);
  const below = restUphill(lim - 0.6, stimp), above = restUphill(lim + 0.6, stimp);
  check('stimp ' + stimp + ': strax under gränsen (' + (lim - 0.6).toFixed(1) + ' %) blir putten liggande uppe', below > 0.1, 'vilar ' + below.toFixed(2) + ' m uppför');
  check('stimp ' + stimp + ': strax över gränsen (' + (lim + 0.6).toFixed(1) + ' %) rullar den tillbaka förbi start', above < 0, 'vilar ' + above.toFixed(2) + ' m');
}
global.window.GREEN_STIMP = 10;

// ---- 2. colours ----
console.log('\n2. Färgen');
const win = { GolfPhysics: P, matchSettings: { greenStimp: 10 } };
let gradPct = 0;
win.sampleGreenGradient = function () { return { slopePercent: gradPct }; };
const ctx = vm.createContext({ window: win, console: { log() {}, warn() {}, error() {} }, document: { getElementById() { return null; } }, scene: { add() {}, remove() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), ctx);
const MAG = [0.85, 0.20, 1.00];
const same = function (a, b) { return a.every(function (v, i) { return Math.abs(v - b[i]) < 1e-9; }); };
const lim10 = win.restSlopeLimits();
check('gränserna kommer från fysiken (green och foregreen)', Math.abs(lim10.green - P.restSlopeLimitPct('GREEN', 10)) < 1e-12 && Math.abs(lim10.foregreen - P.restSlopeLimitPct('FOREGREEN', 10)) < 1e-12);
check('under gränsen: samma färg som förut (röda bandet)', same(win.slopePercentToColor(7.5, false, lim10.green), win.slopePercentToColor(7.5)));
check('från gränsen: magenta', same(win.slopePercentToColor(lim10.green, false, lim10.green), MAG) && same(win.slopePercentToColor(12, false, lim10.green), MAG));
check('utan gräns: ingen magenta (som förut)', !same(win.slopePercentToColor(12), MAG));
gradPct = 9;
check('greenen: 9 % är magenta vid stimp 10', same(win.getGreenSlopeColor(0, 0, false), MAG));
check('foregreenen: 9 % är inte magenta (gränsen där är ' + lim10.foregreen.toFixed(1) + ' %)', !same(win.getGreenSlopeColor(0, 0, true), MAG.map(function (c) { return c * 0.65; })));
gradPct = 7;
check('stimp 10: 7 % är inte magenta', !same(win.getGreenSlopeColor(0, 0, false), MAG));
win.matchSettings.greenStimp = 13;
check('stimp 13: samma 7 % är magenta (gränsen 6,0 %)', same(win.getGreenSlopeColor(0, 0, false), MAG));
win.matchSettings.greenStimp = 10;
// the shader picks the limit per green/foregreen and uses the same magenta
const viz = fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8');
const hm = viz.slice(viz.indexOf('window.buildGreenHeatmapMesh'), viz.indexOf('window.resetGreenGrid'));
check('heatmapens shader: gränsen som uniform, green och foregreen var för sig',
  /uNoRest: \{ value: limits\.green \}, uNoRestFg: \{ value: limits\.foregreen \}/.test(hm) && /vSlope >= \(fg \? uNoRestFg : uNoRest\) \? ' \+ glslVec\(NO_REST_COLOR\)/.test(hm));
check('rutnät och heatmap byggs om när stimp ändras (stimp i cache-nyckeln)', (viz.match(/_\$\{stimpKey\(\)\}`;/g) || []).length === 2);

// ---- 3. legend ----
console.log('\n3. Förklaringen');
const sv10 = win.slopeLegendTexts(true), en10 = win.slopeLegendTexts(false);
check('stimp 10: röda bandet 3,8–7,8 %, "Stannar inte ≥ 7,8 %"', sv10.severe === '3.8–7.8%' && sv10.noRest === 'Stannar inte ≥ 7.8%', JSON.stringify(sv10));
check('på engelska', en10.noRest === "Won't stop ≥ 7.8%", en10.noRest);
win.matchSettings.greenStimp = 13;
check('stimp 13: gränsen 6,0 %', win.slopeLegendTexts(true).noRest === 'Stannar inte ≥ 6.0%' && win.slopeLegendTexts(true).severe === '3.8–6.0%');
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
check('förklaringen har magenta-raden och uppdateras från slopeLegendTexts', /id="slope-legend-norest"/.test(html) && /id="slope-legend-severe"/.test(html) && /window\.slopeLegendTexts\(isSv\)/.test(html));
check('förklaringen radbryts på smal skärm och får hela bredden (inte bara halva)', /id="green-slope-hud-legend"[^>]*left:12px; right:12px; margin:0 auto; width:fit-content[^>]*flex-wrap:wrap/.test(html));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
