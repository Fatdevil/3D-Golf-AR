/**
 * Ospelbar boll: var bollen får släppas (arcade-relief.js, ingen webbläsare) och hur spelet använder det.
 *   - vanlig droppning: inom två klubblängder, inte närmare hålet, inte i vatten eller OB (som förut)
 *   - ospelbar i bunker: +1 och droppen ska ligga kvar i bunkern; +2 och droppen ska ligga utanför bunkern, bakåt på linjen från hålet genom bollen
 * Run: node tests/test_relief.js
 */
const fs = require('fs');
const path = require('path');
const R = require('../arcade-relief.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok || !detail ? '' : '  ' + detail));
  if (!ok) failed++;
}

const ref = { x: 0, z: 0 }, flag = { x: 0, z: -100 };   // hålet ligger åt -z; bakåt på linjen är +z
const lat = (drop, extra) => R.checkDrop(Object.assign({ ref, flag, drop, surface: 'FAIRWAY' }, extra || {}));

// --- vanlig droppning (vatten, ospelbar utanför bunker) ---
check('en droppning 2 m från bollen, åt sidan, är godkänd', lat({ x: 2, z: 0 }) === null, lat({ x: 2, z: 0 }));
check('längre bort än två klubblängder (2,5 m) är inte godkänt', /Too far away/.test(lat({ x: 4, z: 0 }) || ''));
check('närmare hålet än bollen (mer än 0,5 m) är inte godkänt', /closer to the hole/.test(lat({ x: 0, z: -2 }) || ''));
check('i vatten eller OB är inte godkänt', /WATER/.test(lat({ x: 1, z: 0 }, { surface: 'WATER' }) || '') && /OB/.test(lat({ x: 1, z: 0 }, { surface: 'OB' }) || ''));

// --- ospelbar i bunker, +1: kvar i bunkern ---
check('+1 i bunker: en droppning i bunkern är godkänd', lat({ x: 1, z: 1 }, { surface: 'SAND', mustBeIn: 'SAND' }) === null);
check('+1 i bunker: en droppning utanför bunkern är inte godkänd (det kostar två slag)', /bunker/.test(lat({ x: 1, z: 1 }, { surface: 'FAIRWAY', mustBeIn: 'SAND' }) || ''));

// --- ospelbar i bunker, +2: bakåt på linjen, utanför bunkern ---
const line = (drop, surface) => R.checkDrop({ ref, flag, drop, surface: surface || 'FAIRWAY', mode: 'line', mustBeOutOf: 'SAND' });
check('+2: bakåt på linjen, 10 m bakom bollen, utanför bunkern: godkänt', line({ x: 0, z: 10 }) === null, line({ x: 0, z: 10 }));
check('+2: en bit vid sidan om linjen (1 m) är godkänt, 3 m vid sidan är det inte', line({ x: 1, z: 10 }) === null && /on the line/.test(line({ x: 3, z: 10 }) || ''));
check('+2: framför bollen (närmare hålet) är inte godkänt', /behind the ball/.test(line({ x: 0, z: -5 }) || ''));
check('+2: längre bak än 60 m är inte godkänt', /Too far back/.test(line({ x: 0, z: 70 }) || ''));
check('+2: på linjen men i bunkern är inte godkänt', /outside the bunker/.test(line({ x: 0, z: 3 }, 'SAND') || ''));
check('+2: i vatten är inte godkänt', /WATER/.test(line({ x: 0, z: 10 }, 'WATER') || ''));
check('+2 utan hål (ingen linje) ger ett svar i stället för att krascha', /No line/.test(R.checkDrop({ ref, flag: null, drop: { x: 0, z: 5 }, surface: 'FAIRWAY', mode: 'line' }) || ''));

// --- spelet använder det ---
const rules = read('arcade-rules.js'), html = read('arcade.html');
check('arcade.html laddar arcade-relief.js före arcade-rules.js', html.indexOf('arcade-relief.js') > 0 && html.indexOf('arcade-relief.js') < html.indexOf('arcade-rules.js'));
check('droppningens kontroller kommer från ReliefRules.checkDrop (inga egna kopior)', /ReliefRules\.checkDrop\(/.test(rules) && !/Too far away/.test(rules) && !/Cannot drop closer/.test(rules));
check('ospelbar boll i sand frågar och tar +1 (kvar i bunkern) eller +2 (bakåt på linjen, utanför)', /here\.type === 'SAND'/.test(rules) && /mustBeIn: 'SAND'/.test(rules) && /mode: 'line', mustBeOutOf: 'SAND'/.test(rules) && /penalty = 2/.test(rules) && /penaltyStrokes \+= penalty/.test(rules));
check('utanför bunker är det som förut: +1 och en vanlig droppning', /let opts = \{\}, penalty = 1;/.test(rules));

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
