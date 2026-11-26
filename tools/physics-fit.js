// Fitting the ball's aerodynamics (physics.js AERO and its coefficient functions) to the reference bank, and checking whether a fit is
// any good on shots it never saw. Read-only for the game: physics.js is loaded, its coefficient section replaced in memory, never written.
//
//   node tools/physics-fit.js show  [--form A|B|C] [--params '[...]']   errors per PGA row (today's physics: form A with today's values)
//   node tools/physics-fit.js fit   [--form B] [--iters 200]           fit on all rows of the verified tables, print the values and errors
//   node tools/physics-fit.js cv    [--form B] [--iters 200]           cross-validation: 6 folds, each with 2 rows held out (slow: ~10 min)
//   node tools/physics-fit.js sweep  --form B --params '[...]'          today vs a fit across the whole range: chips, juniors, amateurs, long hitters
//
// Forms (each: the drag Cd(v, S) and lift Cl(S), S = the spin factor R w / v, and the spin decay):
//   A  today's form: Cd = cd0 + cdV (Reynolds, per 25 m/s from 50) + cdSpin S;  Cl = clA S^clB, at most clMax;  decay constant
//   B  Cd = cd0 + cdV (Reynolds) + cdSpin S + cdSpin2 S^2;  Cl = clMax (1 - e^(-S / clK)) (a lift that levels off smoothly);  decay constant
//   C  B, and the spin decaying faster with a faster ball (decay = spinDecay + spinDecayV v / 50)
// All forms keep the slow-ball parts of today's physics as they are: Cd rising to 0.40 under 20 m/s, and the reverse Magnus effect
// of a slow ball with little spin.
//
// Why cross-validation and not the bank's fixed split: the table has 12 rows, and the fixed split (physics-validation/validate.js) puts
// one of them in the test set. A form that fits 11 rows well can still be wrong on the twelfth. Each fold fits on 10 rows and is
// measured on the 2 it never saw.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const YD = 1.09361;
const SRC = fs.readFileSync(path.join(ROOT, 'physics.js'), 'utf8');
const START = SRC.indexOf('    const AERO = {'), END = SRC.indexOf('    function evaluateState(');
if (START < 0 || END < START) throw new Error('physics.js: the AERO section was not found (it starts at "const AERO = {" and ends before evaluateState)');

// the slow-ball parts every form keeps: the reverse Magnus effect of a slow ball with little spin, the drag of a slow ball
const SLOW = `
    function getLiftCoefficient(vMag, spinParam, spinRateRpm) {
        const cl = liftCurve(spinParam);
        if (!(spinRateRpm > 0)) return cl;
        const wSpeed = Math.max(0, Math.min(1, (22.0 - vMag) / 4.0));
        const wSpin = Math.max(0, 1 - spinRateRpm / 2250.0);
        const w = wSpeed * wSpin;
        return w > 0 ? cl + (-0.10 - cl) * w : cl;
    }`;
const baseCd = `const cdHigh = AERO.cd0 + AERO.cdV * (50 - Math.max(30, Math.min(75, vMag))) / 25;
        const cd = vMag > 30 ? cdHigh : (vMag > 20 ? lerp(AERO.cdLow, AERO.cd0 + AERO.cdV * 0.8, (vMag - 20) / 10) : AERO.cdLow);`;

const FORMS = {
  A: {
    names: ['cd0', 'cdV', 'cdSpin', 'clA', 'clB', 'clMax', 'spinDecay'],
    today: [0.2380, 0.0478, 0.1722, 0.6045, 0.5344, 0.3187, 0.040],
    steps: [0.02, 0.01, 0.03, 0.05, 0.05, 0.03, 0.01],
    bounds: [[0.15, 0.35], [0, 0.12], [0, 0.4], [0.2, 1.2], [0.2, 1.2], [0.2, 0.5], [0.005, 0.08]],
    code: p => `    const AERO = { cd0: ${p[0]}, cdV: ${p[1]}, cdSpin: ${p[2]}, cdLow: 0.40, clA: ${p[3]}, clB: ${p[4]}, clMax: ${p[5]}, spinDecay: ${p[6]} };
    function getDragCoefficient(vMag, spinRateRpm) {
        const S = (spinRateRpm * 2 * Math.PI / 60) * RADIUS / Math.max(vMag, 0.1);
        ${baseCd}
        return Math.min(cd + AERO.cdSpin * S, 0.65);
    }${SLOW}
    function liftCurve(spinParam) { return Math.min(AERO.clMax, AERO.clA * Math.pow(Math.max(0, spinParam), AERO.clB)); }
`
  },
  B: {
    names: ['cd0', 'cdV', 'cdSpin', 'cdSpin2', 'clMax', 'clK', 'spinDecay'],
    start: [0.23, 0.05, 0.15, 0.0, 0.33, 0.15, 0.04],
    steps: [0.02, 0.01, 0.05, 0.1, 0.04, 0.04, 0.01],
    bounds: [[0.15, 0.35], [0, 0.12], [-0.2, 0.5], [-0.5, 1], [0.2, 0.6], [0.03, 0.6], [0.005, 0.08]],
    code: p => `    const AERO = { cd0: ${p[0]}, cdV: ${p[1]}, cdSpin: ${p[2]}, cdSpin2: ${p[3]}, cdLow: 0.40, clMax: ${p[4]}, clK: ${p[5]}, spinDecay: ${p[6]}, spinDecayV: ${p[7] || 0} };
    function getDragCoefficient(vMag, spinRateRpm) {
        const S = (spinRateRpm * 2 * Math.PI / 60) * RADIUS / Math.max(vMag, 0.1);
        ${baseCd}
        return Math.min(cd + AERO.cdSpin * S + AERO.cdSpin2 * S * S, 0.65);
    }${SLOW}
    function liftCurve(spinParam) { return AERO.clMax * (1 - Math.exp(-Math.max(0, spinParam) / AERO.clK)); }
`
  }
};
FORMS.C = Object.assign({}, FORMS.B, {
  names: FORMS.B.names.concat(['spinDecayV']),
  start: FORMS.B.start.concat([0]),
  steps: FORMS.B.steps.concat([0.01]),
  bounds: FORMS.B.bounds.concat([[-0.03, 0.08]]),
  patch: src => src.replace('let decayRate = AERO.spinDecay;', 'let decayRate = AERO.spinDecay + AERO.spinDecayV * vecMag(state.vel) / 50;')
});

// physics.js with a form's coefficients in place of today's (in memory)
function build(formId, p) {
  const form = FORMS[formId];
  let src = SRC.slice(0, START) + form.code(p) + '\n' + SRC.slice(END);
  if (form.patch) {
    const patched = form.patch(src);
    if (patched === src) throw new Error('physics.js: the spin decay line was not found for form ' + formId);
    src = patched;
  }
  const quiet = function () {};
  const ctx = { window: { GREEN_STIMP: 10, matchSettings: {} }, console: { log: quiet, warn: quiet, error: quiet }, Math: Math, Object: Object, Array: Array, JSON: JSON, isFinite: isFinite, Number: Number };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.GolfPhysics;
}

// a shot through a physics: carry and apex (yd), landing angle (°). No wind, a flat fairway, the given conditions
function fly(G, shot, conditions) {
  const c = conditions || {};
  const env = { getTerrainAt: function () { return { z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }; }, checkCollisionCallback: function () { return null; },
    wind: [0, 0, 0], temperatureC: c.temperatureC === undefined ? 15 : c.temperatureC, altitudeFeet: c.altitudeFeet || 0 };
  const r = G.simulateFlight({ startPos: [0, 0, 0], azimDeg: 0, spinAxisDeg: 0, ballSpeedMph: shot.ballSpeedMph, launchAngleDeg: shot.launchDeg,
    totalSpinRpm: shot.spinRpm, isLiveData: true, isTeeShot: false }, env);
  const pth = r.path;
  let i = 1;
  while (i < pth.length && pth[i].phase === 'flight') i++;
  const q = pth[i - 1];
  return { carryYd: r.metrics.carryMeters * YD, apexYd: r.metrics.apexMeters * YD, landingDeg: Math.atan2(-q.vz, Math.hypot(q.vx, q.vy)) * 180 / Math.PI };
}

// the rows a fit uses: every row of the verified tables, with the table's conditions
function rows() {
  const dir = path.join(ROOT, 'physics-validation', 'references');
  const out = [];
  fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort().forEach(function (f) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (t.verified === false) return;   // a table written from memory never decides anything
    t.rows.forEach(function (r) { out.push(Object.assign({ conditions: t.conditions || {} }, r)); });
  });
  return out;
}

function errors(G, list) {
  return list.map(function (r) {
    const e = fly(G, r, r.conditions);
    return { id: r.id, carry: e.carryYd - r.carryYd, apex: e.apexYd - r.apexYd, landing: e.landingDeg - r.landingDeg };
  });
}
// what a fit minimises: squared errors, carry and apex in yd, landing in ° weighted twice (a degree is worth more than a yard)
function cost(errs) { return errs.reduce(function (s, e) { return s + e.carry * e.carry + e.apex * e.apex + 2 * e.landing * e.landing; }, 0); }

// Nelder-Mead
function nelderMead(f, x0, steps, iters) {
  const n = x0.length;
  let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const y = x0.slice(); y[i] += steps[i]; S.push(y); }
  let fv = S.map(f);
  for (let it = 0; it < iters; it++) {
    const ix = fv.map(function (v, i) { return i; }).sort(function (a, b) { return fv[a] - fv[b]; });
    S = ix.map(function (i) { return S[i]; }); fv = ix.map(function (i) { return fv[i]; });
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const pt = function (t) { return c.map(function (v, j) { return v + t * (S[n][j] - v); }); };
    const xr = pt(-1), fr = f(xr);
    if (fr < fv[0]) { const xe = pt(-2), fe = f(xe); if (fe < fr) { S[n] = xe; fv[n] = fe; } else { S[n] = xr; fv[n] = fr; } }
    else if (fr < fv[n - 1]) { S[n] = xr; fv[n] = fr; }
    else {
      const xc = pt(0.5), fc = f(xc);
      if (fc < fv[n]) { S[n] = xc; fv[n] = fc; }
      else for (let i = 1; i <= n; i++) { S[i] = S[i].map(function (v, j) { return S[0][j] + 0.5 * (v - S[0][j]); }); fv[i] = f(S[i]); }
    }
  }
  const b = fv.indexOf(Math.min.apply(null, fv));
  return { x: S[b], f: fv[b] };
}

function outside(formId, p) { return FORMS[formId].bounds.some(function (b, i) { return !(p[i] >= b[0] && p[i] <= b[1]); }); }
// the values at (within 2 % of the range from) a bound: the form is being stretched to fit, not fitting
function atBounds(formId, p) {
  return FORMS[formId].bounds.map(function (b, i) { return Math.min(p[i] - b[0], b[1] - p[i]) < 0.02 * (b[1] - b[0]) ? FORMS[formId].names[i] : null; }).filter(Boolean);
}
function fit(formId, list, x0, iters) {
  const form = FORMS[formId];
  return nelderMead(function (p) { return outside(formId, p) ? 1e9 : cost(errors(build(formId, p), list)); }, x0 || form.start || form.today, form.steps, iters || 200);
}
// 6 folds: row i held out with row i + half (the table is ordered driver to PW, so each fold holds out a long and a short club)
function folds(n) {
  const half = Math.ceil(n / 2), out = [];
  for (let k = 0; k < half; k++) out.push([k, k + half].filter(function (i) { return i < n; }));
  return out;
}
function crossValidate(formId, iters, log) {
  const list = rows(), all = fit(formId, list, null, iters), held = [];
  folds(list.length).forEach(function (out, k) {
    const train = list.filter(function (r, i) { return out.indexOf(i) < 0; });
    const res = fit(formId, train, all.x, iters);
    errors(build(formId, res.x), out.map(function (i) { return list[i]; })).forEach(function (e) { held.push(e); });
    if (log) log('fold ' + (k + 1) + ' of ' + folds(list.length).length);
  });
  return { x: all.x, fit: errors(build(formId, all.x), list), held: held };
}

function median(a) { const s = a.map(Math.abs).sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; }
function summary(errs) {
  const pick = function (k) { return errs.map(function (e) { return e[k]; }); };
  return { carryMedian: median(pick('carry')), carryMax: Math.max.apply(null, pick('carry').map(Math.abs)), landingMedian: median(pick('landing')),
           landingMax: Math.max.apply(null, pick('landing').map(Math.abs)), apexMedian: median(pick('apex')) };
}

// shots across the whole range, none of them in the bank (15 °C, sea level): what a change does where there is no reference
const SWEEP = [
  ['chip 20 mph', 20, 25, 3000], ['chip 30 mph', 30, 30, 4000], ['pitch 45 mph', 45, 30, 6000], ['wedge 60 mph', 60, 28, 7000], ['wedge 75 mph', 75, 26, 7500],
  ['junior driver 90 mph', 90, 14, 3000], ['driver 110 mph', 110, 13, 2800], ['driver 130 mph', 130, 12, 2900], ['7-iron 100 mph', 100, 18, 6500],
  ['5-iron 110 mph', 110, 14, 5000], ['driver 171 mph', 171, 10.4, 2545], ['driver 185 mph', 185, 11, 2300], ['PW 104 mph', 104, 23.7, 9316]
];
function sweep(formId, p) {
  const today = build('A', FORMS.A.today), G = build(formId, p);
  const shots = SWEEP.map(function (s) {
    const shot = { ballSpeedMph: s[1], launchDeg: s[2], spinRpm: s[3] };
    const a = fly(today, shot).carryYd / YD, b = fly(G, shot).carryYd / YD;
    return { label: s[0], todayM: a, newM: b, diffPct: (b - a) / a * 100 };
  });
  // carry must grow with ball speed, at every launch and spin
  const falls = [];
  [5, 12, 20, 30].forEach(function (la) {
    [1500, 3000, 6000, 9000].forEach(function (sp) {
      let prev = 0;
      for (let v = 15; v <= 190; v += 5) { const c = fly(G, { ballSpeedMph: v, launchDeg: la, spinRpm: sp }).carryYd; if (c < prev - 0.05) falls.push({ launch: la, spin: sp, mph: v }); prev = c; }
    });
  });
  return { shots: shots, falls: falls };
}

module.exports = { FORMS: FORMS, build: build, fly: fly, rows: rows, errors: errors, cost: cost, nelderMead: nelderMead, fit: fit, folds: folds, crossValidate: crossValidate,
                   summary: summary, atBounds: atBounds, sweep: sweep, SWEEP: SWEEP };
if (require.main !== module) return;

// ---- command line ----
const args = process.argv.slice(2), cmd = args[0] || 'show';
const opt = function (k, d) { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const formId = opt('form', cmd === 'show' ? 'A' : 'B');
if (!FORMS[formId]) { console.error('Unknown form ' + formId + ' (A, B or C)'); process.exit(2); }
const params = opt('params') ? JSON.parse(opt('params')) : (FORMS[formId].today || null);
const iters = +opt('iters', 200);
const sg = function (x) { return (x >= 0 ? '+' : '') + x.toFixed(1); };
const table = function (errs) { errs.forEach(function (e) { console.log(e.id.padEnd(14) + ' carry ' + sg(e.carry).padStart(6) + ' yd   apex ' + sg(e.apex).padStart(5) + ' yd   landing ' + sg(e.landing).padStart(5) + '°'); }); };
const sum = function (title, s) { console.log(title + ': carry median ' + s.carryMedian.toFixed(1) + ' yd (max ' + s.carryMax.toFixed(1) + '), landing median ' + s.landingMedian.toFixed(1) + '° (max ' + s.landingMax.toFixed(1) + '°)'); };

if (cmd === 'show') {
  if (!params) { console.error('Form ' + formId + ' needs --params'); process.exit(2); }
  const e = errors(build(formId, params), rows()); table(e); sum('All rows', summary(e));
} else if (cmd === 'fit') {
  const r = fit(formId, rows(), null, iters), e = errors(build(formId, r.x), rows());
  console.log('Form ' + formId + ': ' + JSON.stringify(r.x.map(function (v) { return +v.toFixed(4); })));
  const ab = atBounds(formId, r.x); if (ab.length) console.log('At a bound (the form is stretched): ' + ab.join(', '));
  table(e); sum('Fitted rows', summary(e));
} else if (cmd === 'cv') {
  const r = crossValidate(formId, iters, function (m) { console.error(m); });
  console.log('Form ' + formId + ' on all rows: ' + JSON.stringify(r.x.map(function (v) { return +v.toFixed(4); })));
  sum('Fitted rows', summary(r.fit));
  console.log('Held out (each row fitted without it):'); table(r.held); sum('Held out', summary(r.held));
  const today = summary(errors(build('A', FORMS.A.today), rows())); sum('Today', today);
} else if (cmd === 'sweep') {
  if (!params) { console.error('sweep needs --params'); process.exit(2); }
  const r = sweep(formId, params);
  r.shots.forEach(function (s) { console.log(s.label.padEnd(22) + ' today ' + s.todayM.toFixed(1).padStart(6) + ' m   new ' + s.newM.toFixed(1).padStart(6) + ' m   ' + sg(s.diffPct) + ' %'); });
  console.log(r.falls.length ? 'Carry falls with ball speed at: ' + JSON.stringify(r.falls) : 'Carry grows with ball speed everywhere');
} else { console.error('Unknown command ' + cmd); process.exit(2); }
