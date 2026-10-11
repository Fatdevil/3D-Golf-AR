/**
 * Putthjälp (Full / Bara lutning / Ingen) i rundinställningarna.
 * 1. getPuttAssist: utanför en runda (bygge, Green Studio, tester) gäller alltid Full; i en runda gäller valet, okänt värde blir Full.
 * 2. Nivån styr linjerna: planerade linjen byggs bara på Full; Ingen släcker lutningsvyn, Bara lutning lämnar den.
 * 3. arcade.html: valet finns före rundan och i rundmenyn, sparas i matchSettings (Full som standard), och både lutningsknappen
 *    och sikteslinjen respekterar nivån.
 * Run: node tests/test_putt_assist.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

// ---- arcade-green-viz.js i en stubbad miljö ----
const els = { 'set-putt-assist': { value: 'FULL' }, 'ir-putt-assist': { value: 'FULL' } };
let holeReads = 0, clears = 0, cycles = [], syncs = 0;
const win = {
  matchSettings: { puttAssist: 'FULL' },
  document: null,
};
const ctx = vm.createContext({
  window: win, console: { log() {}, warn() {}, error() {} },
  document: { getElementById(id) { return els[id] || null; } },
  appMode: 'PLAY', playState: 'ROUND_IDLE', playingHoleIndex: 0,
  scene: { remove() {}, add() {} },
});
Object.defineProperty(ctx, 'courseHoles', { get() { holeReads++; return []; } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-green-viz.js'), 'utf8'), ctx);
win.cycleGreenSlopeMode = function (m) { cycles.push(m); win._greenSlopeMode = m; };
win.syncGreenSlopeUI = function () { syncs++; };
const realClear = win.clearBreakLine;
win.clearBreakLine = function () { clears++; realClear(); };

function level(l, mode) { win.matchSettings = l === undefined ? undefined : { puttAssist: l }; ctx.appMode = mode || 'PLAY'; return win.getPuttAssist(); }
check('i en runda gäller valet', level('FULL') === 'FULL' && level('SLOPE') === 'SLOPE' && level('OFF') === 'OFF');
check('okänt värde och saknad inställning blir Full', level('nonsense') === 'FULL' && level(undefined) === 'FULL');
check('utanför en runda (bygge, test) är allt tillgängligt', level('OFF', 'EDIT') === 'FULL' && level('SLOPE', 'TEST') === 'FULL');

// planerade linjen
ctx.appMode = 'PLAY';
win.matchSettings = { puttAssist: 'FULL' }; holeReads = 0; win.buildBreakLine();
check('Full: planerade linjen byggs (banan läses)', holeReads > 0);
for (const l of ['SLOPE', 'OFF']) {
  win.matchSettings = { puttAssist: l }; holeReads = 0; win.breakGuideMesh = null; win.buildBreakLine();
  check(l + ': ingen planerad linje', holeReads === 0 && !win.breakGuideMesh);
}

// setPuttAssist / applyPuttAssist
win.matchSettings = { puttAssist: 'FULL' }; win._greenSlopeMode = 'GRID'; cycles = []; clears = 0;
win.setPuttAssist('OFF');
check('Ingen sparas, väljarna följer och lutningsvyn släcks', win.matchSettings.puttAssist === 'OFF' && els['set-putt-assist'].value === 'OFF' && els['ir-putt-assist'].value === 'OFF' && cycles.join() === 'OFF' && clears > 0);
win._greenSlopeMode = 'GRID'; cycles = [];
win.setPuttAssist('SLOPE');
check('Bara lutning lämnar lutningsvyn kvar', win.matchSettings.puttAssist === 'SLOPE' && cycles.length === 0 && win._greenSlopeMode === 'GRID');
win.setPuttAssist('bogus');
check('okänd nivå blir Full', win.matchSettings.puttAssist === 'FULL');

// ---- arcade.html ----
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const sel = html.match(/<select id="set-putt-assist"[\s\S]*?<\/select>/);
check('rundinställningarna har valet med tre nivåer', sel && ['FULL', 'SLOPE', 'OFF'].every(function (v) { return sel[0].indexOf('value="' + v + '"') >= 0; }));
check('Full är förvald', sel && /value="FULL" selected/.test(sel[0]));
check('rundmenyn har valet', /<select id="ir-putt-assist"[^>]*setPuttAssist\(this\.value\)/.test(html));
check('matchSettings har Full som standard', /puttAssist: 'FULL'/.test(html));
check('start av runden läser valet', /matchSettings\.puttAssist = document\.getElementById\('set-putt-assist'\)\.value/.test(html));
check('lutningsknappen respekterar Ingen', /cycleGreenSlopeMode = function\(targetMode\) \{\s*if \(window\.getPuttAssist && window\.getPuttAssist\(\) === 'OFF'\) targetMode = 'OFF'/.test(html));
check('sikteslinjen ritas bara på Full', /window\.isPuttingMode && window\.ballMesh && controls && playState === 'ROUND_IDLE' && window\.getPuttAssist\(\) === 'FULL'/.test(html));

console.log(failed ? '\n❌ ' + failed + ' misslyckades' : '\n✅ putthjälpen ok');
process.exit(failed ? 1 : 0);
