/**
 * The fitting tool for the ball's aerodynamics (tools/physics-fit.js): today's form with today's values is exactly physics.js, the
 * cross-validation folds hold out every row once, the minimiser minimises, and a table written from memory is never fitted to.
 * Fast: no fit is run here (a cross-validation takes minutes). Run: node tests/test_physics_fit.js
 */
const P = require('../tools/physics-fit.js');
const V = require('../physics-validation/validate.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }

const today = P.build('A', P.FORMS.A.today);
const shots = P.rows().concat([{ id: 'chip', ballSpeedMph: 25, launchDeg: 30, spinRpm: 1500 }, { id: 'slow', ballSpeedMph: 45, launchDeg: 20, spinRpm: 2000 }, { id: 'fast', ballSpeedMph: 190, launchDeg: 9, spinRpm: 2000 }]);
let worst = 0;
shots.forEach(function (r) {
  const a = P.fly(today, r, r.conditions), b = V.fly({ ballSpeedMph: r.ballSpeedMph, launchDeg: r.launchDeg, spinRpm: r.spinRpm }, r.conditions || {});
  worst = Math.max(worst, Math.abs(a.carryYd - b.carryM * V.YD), Math.abs(a.apexYd - b.apexM * V.YD), Math.abs(a.landingDeg - b.landingDeg));
});
check('form A med dagens värden är exakt physics.js (verktyget mäter samma fysik som spelet)', worst < 1e-9, worst);

const rows = P.rows();
check('inpassningen använder bara kontrollerade tabeller (LPGA-raden ur minnet är inte med)', rows.length >= 12 && rows.every(function (r) { return r.id.indexOf('lpga') < 0; }), rows.map(function (r) { return r.id; }));
const f = P.folds(rows.length), seen = [].concat.apply([], f).sort(function (a, b) { return a - b; });
check('varje rad hålls utanför i exakt en vikning, två rader per vikning, en lång och en kort klubba', seen.length === rows.length && seen.every(function (v, i) { return v === i; }) && f.every(function (x) { return x.length === 2 && x[1] - x[0] === Math.ceil(rows.length / 2); }), f);

const nm = P.nelderMead(function (x) { return (x[0] - 3) * (x[0] - 3) + 2 * (x[1] + 1) * (x[1] + 1); }, [0, 0], [1, 1], 200);
check('Nelder-Mead hittar minimum av en enkel kvadratisk funktion', Math.abs(nm.x[0] - 3) < 1e-3 && Math.abs(nm.x[1] + 1) < 1e-3, nm);

['B', 'C'].forEach(function (id) {
  const p = P.FORMS[id].start, G = P.build(id, p), e = P.fly(G, { ballSpeedMph: 123, launchDeg: 16.1, spinRpm: 7124 });
  check('form ' + id + ' bygger en fysik som flyger ett 7-järn rimligt (120-200 yd)', e.carryYd > 120 && e.carryYd < 200 && e.landingDeg > 30, e);
});
check('ett värde vid en gräns rapporteras (formen tänjs i stället för att passa)', P.atBounds('B', [0.2, 0.05, 0.499, -0.5, 0.35, 0.15, 0.04]).join() === 'cdSpin,cdSpin2', P.atBounds('B', [0.2, 0.05, 0.499, -0.5, 0.35, 0.15, 0.04]));
const s = P.summary([{ carry: -3, apex: 1, landing: 2 }, { carry: 5, apex: -1, landing: -1 }, { carry: 1, apex: 0, landing: 0 }]);
check('sammanfattningen tar medianen och största felet i absolutbelopp', s.carryMedian === 3 && s.carryMax === 5 && s.landingMedian === 1 && s.landingMax === 2, s);

console.log(failed ? '\n' + failed + ' failed' : '\nAll physics fit checks passed');
process.exit(failed ? 1 : 0);
