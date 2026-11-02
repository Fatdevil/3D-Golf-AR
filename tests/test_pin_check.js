/**
 * Varning för flaggplacering: lutningen inom 1 m från hålet, med bollens lutning.
 * 1. pinSlopeCheck: plant -> OK, över 3 % -> brant, från fysikens "stannar inte"-gräns vid aktuell stimp -> stannar inte. Lutningen
 *    ringarna (0,5 och 1 m) ser räknas, en kulle längre bort inte.
 * 2. pinSlopeText: raderna på svenska och engelska.
 * 3. Kopplingen: Green Studio visar raden efter varje ändring, och en flagga som sätts eller flyttas till en brant plats ger en varning.
 * Run: node tests/test_pin_check.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

global.window = { GREEN_STIMP: 10, matchSettings: {} };
require('../physics.js');
const P = global.window.GolfPhysics;

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

const toasts = [];
const win = { GolfPhysics: P, matchSettings: { greenStimp: 10 }, getGolfLanguage: function () { return 'sv'; }, showBuildToast: function (t, c) { toasts.push([t, c]); } };
const ctx = vm.createContext({ window: win, console: { log() {}, warn() {}, error() {} }, document: { getElementById() { return null; } }, scene: { add() {}, remove() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), ctx);
function slope(fn) { win.terrainSlopeAt = function (x, z) { const g = fn(x, z); return { dhdx: g[0], dhdz: g[1] }; }; }
const hole = { flag: { x: 10, z: -4 } };

console.log('1. Kontrollen');
slope(function () { return [0.012, 0.005]; });
let c = win.pinSlopeCheck(hole);
check('1,3 % överallt: OK', c.level === 'OK' && Math.abs(c.maxPct - 1.3) < 1e-9, JSON.stringify(c));
slope(function () { return [0.04, 0]; });
check('4 %: brant', win.pinSlopeCheck(hole).level === 'STEEP');
slope(function () { return [0.09, 0]; });
c = win.pinSlopeCheck(hole);
check('9 % vid stimp 10: bollen stannar inte (gränsen 7,8 %)', c.level === 'NO_REST' && Math.abs(c.limitPct - P.restSlopeLimitPct('GREEN', 10)) < 1e-12, JSON.stringify(c));
slope(function () { return [0.07, 0]; });
check('7 % vid stimp 10: brant', win.pinSlopeCheck(hole).level === 'STEEP');
win.matchSettings.greenStimp = 13;
check('7 % vid stimp 13: bollen stannar inte (gränsen 6,0 %)', win.pinSlopeCheck(hole).level === 'NO_REST');
check('stimp kan ges direkt', win.pinSlopeCheck(hole, 10).level === 'STEEP');
win.matchSettings.greenStimp = 10;
// flat, except a steep patch 0.9-1.1 m east of the flag: the 1 m ring sees it
slope(function (x, z) { const d = Math.hypot(x - 10, z + 4); return (d > 0.9 && d < 1.1 && x > 10.5) ? [0.05, 0] : [0, 0]; });
c = win.pinSlopeCheck(hole);
check('en brant fläck 1 m från hålet räknas', c.level === 'STEEP' && c.centerPct === 0, JSON.stringify(c));
// the same patch 2 m away: outside what is checked
slope(function (x, z) { const d = Math.hypot(x - 10, z + 4); return (d > 1.9 && d < 2.1) ? [0.05, 0] : [0, 0]; });
check('en brant fläck 2 m bort räknas inte', win.pinSlopeCheck(hole).level === 'OK');
check('ingen flagga: ingen kontroll', win.pinSlopeCheck({}) === null && win.pinSlopeCheck(null) === null);

console.log('\n2. Texterna');
const ok = win.pinSlopeText({ level: 'OK', maxPct: 2.14, limitPct: 7.84, stimp: 10 }, true);
const st = win.pinSlopeText({ level: 'STEEP', maxPct: 4.26, limitPct: 7.84, stimp: 10 }, true);
const nr = win.pinSlopeText({ level: 'NO_REST', maxPct: 8.33, limitPct: 7.84, stimp: 10 }, true);
const nrEn = win.pinSlopeText({ level: 'NO_REST', maxPct: 8.33, limitPct: 7.84, stimp: 10 }, false);
check('OK', ok.text === '⛳ Flaggan: 2.1 % ✓' && ok.color === '#4ade80', ok.text);
check('brant', st.text === '⚠️ Brant flaggplacering: 4.3 % inom 1 m (över 3 %)' && st.color === '#fbbf24', st.text);
check('stannar inte', nr.text === '⛔ Bollen stannar inte vid flaggan: 8.3 % (gräns 7.8 % vid stimp 10)' && nr.color === '#f87171', nr.text);
check('på engelska', nrEn.text === "⛔ The ball won't stop at the flag: 8.3 % (limit 7.8 % at stimp 10)", nrEn.text);

console.log('\n3. Varningen och kopplingen');
toasts.length = 0;
slope(function () { return [0.01, 0]; });
win.warnPinSlope(hole);
check('en rättvis flagga ger ingen varning', toasts.length === 0);
slope(function () { return [0.05, 0]; });
win.warnPinSlope(hole);
check('en brant flagga ger en gul varning', toasts.length === 1 && toasts[0][1] === '#fbbf24' && /Brant flaggplacering/.test(toasts[0][0]), JSON.stringify(toasts));
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const gs = fs.readFileSync(path.join(__dirname, '..', 'green-studio.js'), 'utf8');
check('Green Studio har raden ovanför flikarna', /<div id="gs-panel-built"[^>]*>\s*<!--[^>]*-->\s*<div id="gs-pin-check"/.test(html));
check('Green Studio fyller raden efter varje ändring (syncUIValues)', /syncUIValues\(hole\) \{[\s\S]{0,400}window\.pinSlopeCheck\(hole\)/.test(gs));
check('flytta flaggan i Smart Builder varnar', /Flagga flyttad![\s\S]{0,200}window\.warnPinSlope\(hole\)/.test(html));
check('hålverktygets flagga varnar', /hole\.flagMesh = createFlagObject\(hole\.flag\.x, hole\.flag\.y, hole\.flag\.z\);\s*if \(typeof window\.warnPinSlope === 'function'\) window\.warnPinSlope\(hole\);/.test(html));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
