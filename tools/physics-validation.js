// The physics validation report: every row of the reference bank (physics-validation/references) through physics.js, errors per club
// group and ball speed, the goals, and whether anything got worse than the baseline.
//   node tools/physics-validation.js                    print the report
//   node tools/physics-validation.js --write            also write docs/physics-validation-report.md
//   node tools/physics-validation.js --update-baseline  store today's results as the baseline (after a deliberate physics change)
// Read-only for the physics: it only calls physics.js.
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('../physics-validation/validate.js');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'physics-validation', 'baseline.json');
const REPORT = path.join(ROOT, 'docs', 'physics-validation-report.md');
const args = process.argv.slice(2);

// The report as text (also used by tests/test_physics_validation.js, which checks that the committed report is up to date)
function buildReport() {
const bank = V.loadBank();
const results = V.evaluate(bank);
const f1 = function (x) { return x === null || x === undefined ? '–' : x.toFixed(1); };
const sg = function (x) { return x === null || x === undefined ? '–' : (x > 0 ? '+' : '') + x.toFixed(1); };
const L = [];
L.push('# Bollfysiken mot referensbanken');
L.push('');
L.push('Genererad av `node tools/physics-validation.js --write` ur `physics-validation/` (inga datum: rapporten ändras bara när fysiken eller banken ändras).');
L.push('Varje rad körs genom `physics.js` i vindstilla på plan fairway i radens förhållanden. Fel = motorn minus referensen.');
L.push('');
L.push('## Referensbanken');
L.push('');
L.push('| Källa | Typ | Kontrollerad | Rader |');
L.push('|---|---|---|---|');
bank.tables.forEach(function (t) { L.push('| ' + t.title + ' | ' + (t.kind === 'average' ? 'tour-snitt' : t.kind) + ' | ' + (t.verified !== false ? 'ja' : '**nej**') + ' | ' + t.rows.length + ' |'); });
bank.files.forEach(function (f) { L.push('| ' + f.name + (f.source ? ' (' + f.source + ')' : '') + ' | slagpar | ja | ' + f.rows.length + (f.skipped.length ? ' (' + f.skipped.length + ' överhoppade)' : '') + (f.refused ? ' **avvisad: ' + f.refused + '**' : '') + ' |'); });
if (!bank.files.length) {
  L.push('');
  L.push('**Inga slagpar ännu.** Tour-snitten räcker inte för att avgöra hur fel motorn är (snittslagets carry är inte snittets carry). Lägg CSV-exporter från launch monitorernas appar i `physics-validation/references/shots/` (se README där).');
}
L.push('');
L.push('## Rad för rad');
L.push('');
L.push('| Rad | Typ | Mängd | Klubba | mph / ° / rpm | Carry yd (ref) | Fel | Topp yd (ref) | Fel | Landning ° (ref) | Fel |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|');
results.forEach(function (r) {
  L.push('| ' + r.id + (r.verified ? '' : ' (okontrollerad)') + ' | ' + r.kind + ' | ' + r.set + ' | ' + r.club + ' | ' + f1(r.input.ballSpeedMph) + ' / ' + f1(r.input.launchDeg) + ' / ' + Math.round(r.input.spinRpm) +
    ' | ' + f1(r.engine.carryYd) + ' (' + f1(r.target.carryYd) + ') | ' + sg(r.err.carryYd) + ' | ' + f1(r.engine.apexYd) + ' (' + f1(r.target.apexYd) + ') | ' + sg(r.err.apexYd) +
    ' | ' + f1(r.engine.landingDeg) + ' (' + f1(r.target.landingDeg) + ') | ' + sg(r.err.landingDeg) + ' |');
});
const table = function (title, groups) {
  L.push('');
  L.push('## ' + title);
  L.push('');
  L.push('| Grupp | n | Carry: medianfel yd | bias | p90 | Landning: medianfel ° | bias |');
  L.push('|---|---|---|---|---|---|---|');
  Object.keys(groups).forEach(function (k) { const g = groups[k]; L.push('| ' + k + ' | ' + g.n + ' | ' + f1(g.carryYd.medianAbs) + ' | ' + sg(g.carryYd.bias) + ' | ' + f1(g.carryYd.p90Abs) + ' | ' + f1(g.landingDeg.medianAbs) + ' | ' + sg(g.landingDeg.bias) + ' |'); });
};
const verified = results.filter(function (r) { return r.verified; });
table('Per klubbgrupp (kontrollerade rader)', V.by(verified, 'group'));
table('Per bollfart (kontrollerade rader)', V.by(verified, 'band'));
L.push('');
L.push('## Målen');
L.push('');
L.push('Målen gäller kontrollerade slagpar i testmängden. Tour-snitt räknas inte. Det är ambitioner, inte garantier.');
L.push('');
L.push('| Mål | n | Medianfel | Gräns | Status |');
L.push('|---|---|---|---|---|');
V.targetStatus(results).forEach(function (t) { L.push('| ' + t.title + ' | ' + t.n + ' | ' + f1(t.medianAbs) + ' ' + t.unit + ' | ' + f1(t.limit) + ' ' + t.unit + ' | ' + (t.met === null ? 'inga slagpar ännu' : (t.met ? 'uppnått' : 'inte uppnått')) + ' |'); });

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const reg = baseline ? V.regressions(results, baseline) : [];
L.push('');
L.push('## Mot baslinjen');
L.push('');
L.push(baseline ? (reg.length ? '**Sämre än baslinjen:** ' + reg.map(function (x) { return x.id + ' ' + x.measure + ' ' + x.was + ' → ' + x.now; }).join(', ') : 'Ingen rad är sämre än baslinjen (marginal ' + V.SLACK.carryYd + ' yd / ' + V.SLACK.landingDeg + '°).') : 'Ingen baslinje (kör med --update-baseline).');

return { text: L.join('\n') + '\n', results: results, regressions: reg };
}
module.exports = { buildReport: buildReport, REPORT: REPORT };
if (require.main !== module) return;

// a new baseline first, so the report written next is measured against it (and not against the one it replaces)
if (args.indexOf('--update-baseline') >= 0) {
  fs.writeFileSync(BASELINE, JSON.stringify(V.baselineOf(V.evaluate(V.loadBank())), null, 2) + '\n');
  console.log('Wrote ' + path.relative(ROOT, BASELINE));
}
const built = buildReport(), text = built.text, reg = built.regressions;
console.log(text);
if (args.indexOf('--write') >= 0) { fs.writeFileSync(REPORT, text); console.log('Wrote ' + path.relative(ROOT, REPORT)); }
process.exit(reg.length ? 1 : 0);
