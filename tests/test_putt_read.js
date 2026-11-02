/**
 * Puttläsningen i siktskylten (puttläge): bryt, uppför/nedför, var den bryter mest och (full putthjälp) var fysiklinjen siktar.
 * 1. puttRead: på plan mark ger den lutningen tvärs och längs linjen boll -> hål med rätt tecken, oavsett åt vilket håll man puttar
 *    ("höger" = höger sett från bollen mot hålet), höjdskillnaden, och var sidlutningen är störst.
 * 2. puttAimOffsetM: bara när fysiklinjen räknades för samma boll och hål; + är höger.
 * 3. puttReadLines: texterna på svenska och engelska; siktet bara på full putthjälp.
 * 4. arcade.html: skylten visar läsningen i puttläge, höjden i cm, ingen bagklubba för en putt, och putthjälpen styr.
 * Run: node tests/test_putt_read.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

const win = {};
const ctx = vm.createContext({ window: win, console: { log() {}, warn() {}, error() {} }, document: { getElementById() { return null; } }, scene: { add() {}, remove() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), ctx);
// ground: h(x, z), its slope analytic (the shared slope function is tested in test_green_slope_viz.js)
function ground(h, dh) { win.getTerrainHeight = h; win.terrainSlopeAt = function (x, z) { const g = dh(x, z); return { dhdx: g[0], dhdz: g[1] }; }; }
const near = function (a, b, e) { return Math.abs(a - b) <= (e || 1e-6); };

console.log('1. Läsningen');
// the ground falls 2 % toward +x
ground(function (x) { return -0.02 * x; }, function () { return [-0.02, 0]; });
{
  const r = win.puttRead(0, 0, 0, -5);   // putting toward -z: right is +x, where the ground falls
  check('mot -z: marken faller åt höger, putten bryter höger 2 %, plant längs', near(r.crossPct, 2) && near(r.alongPct, 0) && near(r.riseM, 0) && near(r.distM, 5), JSON.stringify(r));
  const r2 = win.puttRead(0, -5, 0, 0);  // the other way: right is -x, the ground falls to the left
  check('åt andra hållet bryter samma putt vänster', near(r2.crossPct, -2), r2.crossPct.toFixed(3));
  const r3 = win.puttRead(0, 0, 5, 0);   // toward +x: straight down the slope
  check('rakt nedför: nedför 2 %, −10 cm på 5 m, inget bryt', near(r3.alongPct, -2) && near(r3.riseM, -0.10) && near(r3.crossPct, 0), JSON.stringify(r3));
  const r4 = win.puttRead(5, 0, 0, 0);
  check('rakt uppför: uppför 2 %, +10 cm', near(r4.alongPct, 2) && near(r4.riseM, 0.10));
  check('för kort putt (under 5 cm): ingen läsning', win.puttRead(0, 0, 0.01, 0.01) === null);
}
// flat, except a side slope over the last 2 m before a cup at z = -6 (ground falls to +x there)
ground(function () { return 0; }, function (x, z) { return z < -4 ? [-0.03, 0] : [0, 0]; });
{
  const r = win.puttRead(0, 0, 0, -6);
  check('mest bryt där sidlutningen sitter: inom de sista 2 m', r.maxCrossFromCupM <= 2.01 && near(r.maxCrossPct, 3), JSON.stringify(r));
  check('snittet över hela linjen är mindre (en tredjedel av sträckan)', r.crossPct > 0.8 && r.crossPct < 1.2, r.crossPct.toFixed(2));
}

console.log('\n2. Siktet från fysiklinjen');
win._breakLineInfo = { ballX: 1, ballZ: 2, flagX: 1, flagZ: -4, distM: 6, aimOffsetDeg: 2 };
check('samma boll och hål: 6 m * tan(2°) = 21 cm höger', near(win.puttAimOffsetM(1, 2, 1, -4), 6 * Math.tan(2 * Math.PI / 180)));
check('annan boll: inget sikte', win.puttAimOffsetM(1.5, 2, 1, -4) === null);
check('annat hål: inget sikte', win.puttAimOffsetM(1, 2, 3, -4) === null);
win._breakLineInfo = { aimOffsetDeg: 2 };   // an older line without ball and cup
check('en linje utan boll och hål: inget sikte', win.puttAimOffsetM(1, 2, 1, -4) === null);

console.log('\n3. Texterna');
const read = { distM: 6, riseM: 0.12, alongPct: 2.0, crossPct: -2.14, maxCrossPct: -3.0, maxCrossFromCupM: 1.5 };
const sv = win.puttReadLines(read, true, 'FULL', -0.15), en = win.puttReadLines(read, false, 'FULL', -0.15);
check('svenska', sv.head === 'Bryter ← vänster 2.1 %' && sv.along === 'Uppför 2.0 %' && sv.detail === 'Mest bryt 1.5 m före hålet (3.0 %) · Sikta 15 cm vänster', JSON.stringify(sv));
check('engelska', en.head === 'Breaks ← left 2.1 %' && en.along === 'Uphill 2.0 %' && en.detail === 'Most break 1.5 m before the cup (3.0 %) · Aim 15 cm left', JSON.stringify(en));
check('bara lutning: inget sikte', win.puttReadLines(read, true, 'SLOPE', -0.15).detail === 'Mest bryt 1.5 m före hålet (3.0 %)');
check('full men ingen fysiklinje än: inget sikte', win.puttReadLines(read, true, 'FULL', null).detail.indexOf('Sikta') < 0);
const flat = win.puttReadLines({ distM: 3, riseM: 0.004, alongPct: 0.1, crossPct: 0.1, maxCrossPct: 0.2, maxCrossFromCupM: 1 }, true, 'FULL', 0.01);
check('plan putt: "Rak putt", "Plant", sikta på hålet', flat.head === 'Rak putt' && flat.along === 'Plant' && flat.detail === 'Sikta på hålet', JSON.stringify(flat));
const down = win.puttReadLines({ distM: 4, riseM: -0.2, alongPct: -5, crossPct: 1, maxCrossPct: 1.6, maxCrossFromCupM: 0.2 }, true, 'SLOPE', null);
check('nedför, bryter höger, mest bryt vid hålet', down.head === 'Bryter höger → 1.0 %' && down.along === 'Nedför 5.0 %' && down.detail === 'Mest bryt vid hålet (1.6 %)', JSON.stringify(down));

const even = win.puttReadLines({ distM: 6, riseM: 0, alongPct: 0, crossPct: 2.9, maxCrossPct: 3.0, maxCrossFromCupM: 0 }, true, 'SLOPE', null);
check('jämnt lutande green: inget "mest bryt" (det säger ingenting där)', even.detail === '', JSON.stringify(even));

console.log('\n4. arcade.html');
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const bb = html.slice(html.indexOf('// --- GSPRO AIM BILLBOARD PROJECTION ---'), html.indexOf('// --- LIE & CONDITIONS HUD ---'));
check('i puttläge visar skylten läsningen (boll -> hål, puttRead och puttReadLines)', /else if \(planEl && !rangeAim && window\.isPuttingMode\)/.test(bb) && /window\.puttRead\(bpos\.x, bpos\.z, hole\.flag\.x, hole\.flag\.z\)/.test(bb) && /window\.puttReadLines\(/.test(bb));
check('putthjälpen styr: Ingen visar ingen läsning', /if \(level !== 'OFF' && hole && hole\.flag && window\.puttRead\)/.test(bb));
check('höjden i cm i puttläge, mark till mark från bollen till hålet (samma som läsningen)', /puttRise !== null \? Math\.round\(Math\.abs\(elevDiff\) \* 100\) \+ ' cm'/.test(bb) && /window\.getTerrainHeight\(hole\.flag\.x, hole\.flag\.z\) - window\.getTerrainHeight\(window\.ballMesh\.position\.x, window\.ballMesh\.position\.z\)/.test(bb));
check('ingen bagklubba för en putt', /if \(planEl && !rangeAim && !window\.isPuttingMode && !window\._isRangeMode && window\.PlayerBag/.test(bb));
check('fysiklinjen sparar vilken boll och vilket hål den gäller', /window\._breakLineInfo = \{ ballX: ballX, ballZ: ballZ, flagX: hole\.flag\.x, flagZ: hole\.flag\.z, distM: dist,/.test(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8')));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
