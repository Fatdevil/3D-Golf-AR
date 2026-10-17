/**
 * Sand: det som underlaget tar av slaget, texten i lie-rutan och puttar från sand (physics.js only, ingen webbläsare).
 *   - lie-rutans text kommer från fysiken (GolfPhysics.lieEffectText), och fysiken använder samma faktorer (lieMultipliers) som texten visar
 *   - waste har inget straff; en launch monitor-boll får inget straff (texten säger 100 % då)
 *   - en putt som startar i sand rullar som i rough (8,5 m vid full puttfart, förut 5 m); en boll som landar i sand gräver ner sig och stannar
 *   - en boll som rullar från fairway in i sand bromsas av sanden
 * Run: node tests/test_sand.js
 */
const fs = require('fs');
const path = require('path');
global.window = { GREEN_STIMP: 10, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const G = global.window.GolfPhysics;

function sim(input, env) {
  const log = console.log; console.log = function () {};
  try { return G.simulateFlight(input, env); } finally { console.log = log; }
}
// platt mark: underlaget `lie` inom en meter från startpunkten, annars `rest`; `sandFrom`: sand från den y-koordinaten och framåt
function world(lie, rest, sandFrom) {
  return { getTerrainAt: (x, y) => ({ z: 0, normal: [0, 0, 1], type: sandFrom !== undefined && y >= sandFrom ? 'SAND' : (Math.hypot(x, y) < 1 ? lie : rest) }), wind: [0, 0, 0], temperatureC: 15 };
}
function shot(input, env) {
  const r = sim(Object.assign({ startPos: [0, 0, 0.022], spinAxisDeg: 0, azimDeg: 0, isLiveData: false }, input), env);
  const e = r.path[r.path.length - 1];
  return { total: Math.hypot(e.x, e.y), carry: r.metrics.carryMeters, bounces: r.metrics.bounceCount };
}
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

// --- texten i lie-rutan ---
const expected = {
  FAIRWAY: ['100%', '100%', 'ok'], GREEN: ['100%', '100%', 'ok'], WASTE: ['100%', '100%', 'ok'],
  'SEMI-ROUGH': ['98%', '95%', 'ok'], ROUGH: ['85 - 95%', '60 - 90%', 'warn'], FESCUE: ['80 - 90%', '35 - 80%', 'warn'],
  'DEEP ROUGH': ['75 - 90%', '40 - 80%', 'bad'], SAND: ['80 - 95%', '70 - 90%', 'warn']
};
Object.keys(expected).forEach(function (lie) {
  const t = G.lieEffectText(lie), e = expected[lie];
  check('lie-rutan för ' + lie + ': kraft ' + e[0] + ', spinn ' + e[1], t.power === e[0] && t.spin === e[1] && t.level === e[2], JSON.stringify(t));
});
const sandR = G.lieRange('SAND');
check('sand tar 5-20 % av farten och 10-30 % av spinnet (80-95 % och 70-90 % blir kvar)', Math.abs(sandR.speed[0] - 0.80) < 1e-9 && Math.abs(sandR.speed[1] - 0.95) < 1e-9 && Math.abs(sandR.spin[0] - 0.70) < 1e-9 && Math.abs(sandR.spin[1] - 0.90) < 1e-9, JSON.stringify(sandR));

// --- fysiken räknar med samma faktorer som texten visar ---
// slaget från underlaget X ska bli exakt samma som samma slag från fairway med farten och spinnet gånger faktorerna
const realRandom = Math.random;
Math.random = function () { return 0.99; };   // ingen flyer
try {
  ['SAND', 'ROUGH', 'SEMI-ROUGH', 'FESCUE', 'DEEP ROUGH', 'WASTE'].forEach(function (lie) {
    let same = true, detail = '';
    [[14, 70], [22, 100], [30, 60], [45, 40]].forEach(function (c) {
      const vla = c[0], mph = c[1];
      const lm = G.lieMultipliers(lie, vla, null);
      const a = shot({ launchAngleDeg: vla, ballSpeedMph: mph, totalSpinRpm: 4000 }, world(lie, 'FAIRWAY'));
      const b = shot({ launchAngleDeg: vla, ballSpeedMph: mph * lm.speed, totalSpinRpm: 4000 * lm.spin }, world('FAIRWAY', 'FAIRWAY'));
      if (Math.abs(a.total - b.total) > 1e-6 || Math.abs(a.carry - b.carry) > 1e-6) { same = false; detail += ' vla' + vla + ':' + a.total.toFixed(2) + '≠' + b.total.toFixed(2); }
    });
    check('slag från ' + lie + ' = samma slag från fairway med faktorerna ur lieMultipliers (som texten visar)', same, detail);
  });
} finally { Math.random = realRandom; }
const live = shot({ launchAngleDeg: 22, ballSpeedMph: 100, totalSpinRpm: 4000, isLiveData: true }, world('SAND', 'FAIRWAY'));
const liveFair = shot({ launchAngleDeg: 22, ballSpeedMph: 100, totalSpinRpm: 4000, isLiveData: true }, world('FAIRWAY', 'FAIRWAY'));
check('en launch monitor-boll får inget straff från sand (lie-rutan visar 100 % då)', Math.abs(live.total - liveFair.total) < 1e-6, live.total.toFixed(2) + ' mot ' + liveFair.total.toFixed(2));

// --- puttar från sand ---
const putt = (mph, lie) => shot({ launchAngleDeg: 1.5, ballSpeedMph: mph, totalSpinRpm: 300 }, world(lie, lie)).total;
const sandFull = putt(22, 'SAND'), roughFull = putt(22, 'ROUGH'), fairFull = putt(22, 'FAIRWAY');
check('en putt med full puttfart (22 mph) från sand når över 7 m (förut 5 m)', sandFull > 7, sandFull.toFixed(2) + ' m');
check('och är lite kortare än från rough (sandens lie-straff är större), men inte mycket', sandFull < roughFull && sandFull > roughFull * 0.8, 'sand ' + sandFull.toFixed(2) + ' m, rough ' + roughFull.toFixed(2) + ' m');
check('och mycket kortare än från fairway', sandFull < fairFull * 0.3, 'fairway ' + fairFull.toFixed(2) + ' m');
const sandSoft = putt(8, 'SAND');
check('en mjuk putt från sand rullar ut utan att dö på en decimeter (8 mph över 1 m)', sandSoft > 1.0, sandSoft.toFixed(2) + ' m');

// --- en boll som landar i sand gräver ner sig ---
const into = shot({ launchAngleDeg: 28, ballSpeedMph: 80, totalSpinRpm: 5500 }, { getTerrainAt: (x, y) => ({ z: 0, normal: [0, 0, 1], type: y >= 60 ? 'SAND' : 'FAIRWAY' }), wind: [0, 0, 0], temperatureC: 15 });
const intoFair = shot({ launchAngleDeg: 28, ballSpeedMph: 80, totalSpinRpm: 5500 }, world('FAIRWAY', 'FAIRWAY'));
check('en boll som landar i sand studsar inte och rullar mindre än en halv meter', into.bounces === 0 && into.total - into.carry < 0.5, 'rullning ' + (into.total - into.carry).toFixed(2) + ' m, ' + into.bounces + ' studsar (fairway: ' + (intoFair.total - intoFair.carry).toFixed(1) + ' m)');

// --- en boll som rullar in i sand bromsas av sanden ---
// 14 mph rullar 17 m på fairway; in i sand efter 2 m: sandens 6,38 stoppar den efter ca 2,7 m till (rough-bromsen hade låtit den rulla ca 9 m)
const rollIn = shot({ launchAngleDeg: 1.5, ballSpeedMph: 14, totalSpinRpm: 300 }, { getTerrainAt: (x, y) => ({ z: 0, normal: [0, 0, 1], type: y >= 2 ? 'SAND' : 'FAIRWAY' }), wind: [0, 0, 0], temperatureC: 15 });
check('en putt som rullar från fairway in i sand stannar efter några meter (sandens rullbroms, inte puttens)', rollIn.total > 3.5 && rollIn.total < 5.5, rollIn.total.toFixed(2) + ' m');

// --- lie-rutan i spelet läser fysiken ---
const arcade = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
check('lie-rutan i arcade.html läser GolfPhysics.lieEffectText och har inga egna procenttal för sand', /GolfPhysics\.lieEffectText\(lType\)/.test(arcade) && !/lType === 'SAND' \|\| lType === 'WASTE'\) \{ powStr/.test(arcade) && !/"40 - 60%"/.test(arcade));
check('lie-rutan visar 100 % för en launch monitor', /window\.G\.inputMode === 'LAUNCH_MONITOR'/.test(arcade));

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
