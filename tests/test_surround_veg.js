/**
 * Vegetation in the surroundings (arcade-surround-veg.js), without a browser:
 * 1. AUTO follows the ground of each side (deep rough / rough a forest, a desert biome desert plants, waste palms, mountain horizon a
 *    sparse forest, water and sky nothing); the side of a point is the one with the largest weight (as the surround plane's shader).
 * 2. The pools: a forest is the trees on the course (as many as they are), palms the trees named "palm", desert cacti and shrubs.
 * 3. The settings live on the holes: restore() takes them from the first hole that has them, a bad value falls back to the default.
 * 4. arcade.html: an undo / redo restores the live vegetation from the holes, and the library arriving rebuilds the belt.
 * Run: node tests/test_surround_veg.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'arcade-surround-veg.js'), 'utf8');
function load(win) {
  new Function('window', 'globalThis', 'setTimeout', 'clearTimeout', src)(win, win, function () { return 0; }, function () {});
  return win.SurroundVeg;
}
const REG = {
  oak: { subcat: 'TREES', name: 'Oak tree' }, pine: { subcat: 'TREES', name: 'Pine' }, palm: { subcat: 'TREES', name: 'Coconut Palm' },
  cactus: { subcat: 'PLANTS', name: 'Saguaro cactus' }, fern: { subcat: 'PLANTS', name: 'Fern' }, rock: { subcat: 'ROCKS', name: 'Rock' }
};

console.log('1. Efter marken');
{
  const win = { ASSET_REGISTRY: REG, placedTrees: [], surroundConfig: { N: 'fescueColor', E: 'wasteColor', S: 'oceanColor', W: 'horizonColor' }, courseHoles: [] };
  const V = load(win);
  check('deep rough skog, waste palmer, hav inget, bergshorisont gles skog', ['N', 'E', 'S', 'W'].map(V.vegOf).join(',') === 'FOREST,PALMS,NONE,SPARSE');
  win.surroundConfig = { N: 'roughColor', E: 'skyColor', S: 'waterColor', W: 'NONE' };
  check('rough skog; himmel, sjö och ingen: inget', ['N', 'E', 'S', 'W'].map(V.vegOf).join(',') === 'FOREST,NONE,NONE,NONE');
  win.ACTIVE_BIOME = 'DESERT'; win.surroundConfig.N = 'fescueColor';
  check('ökenbiom: deep rough blir ökenväxtlighet', V.vegOf('N') === 'DESERT');
  check('sidan med störst vikt: -z norr, +x öster, +z söder, -x väster', V.sideAt(0, -500) === 'N' && V.sideAt(500, 0) === 'E' && V.sideAt(0, 500) === 'S' && V.sideAt(-500, 0) === 'W' && V.sideAt(400, -300) === 'E');
}

console.log('\n2. Typerna');
{
  const win = { ASSET_REGISTRY: REG, surroundConfig: {}, courseHoles: [], placedTrees: [{ type: 'pine' }, { type: 'pine' }, { type: 'oak' }, { type: 'palm' }, { type: 'rock' }] };
  const V = load(win);
  const f = V.poolFor('FOREST');
  check('skog: banans träd i samma proportioner (inte palmer eller stenar)', f.length === 2 && f[0].type === 'pine' && f[0].w === 2 && f[1].type === 'oak' && f[1].w === 1, JSON.stringify(f));
  check('palmer: träd med "palm" i namnet', JSON.stringify(V.poolFor('PALMS').map(function (p) { return p.type; })) === '["palm"]');
  const d = V.poolFor('DESERT');
  check('öken: kaktus och lite palm', d.some(function (p) { return p.type === 'cactus'; }) && d.some(function (p) { return p.type === 'palm' && p.w < 1; }) && !d.some(function (p) { return p.type === 'fern'; }), JSON.stringify(d));
  win.placedTrees = [];
  check('ingen skog på banan: bibliotekets träd utom palmer', V.poolFor('FOREST').map(function (p) { return p.type; }).join(',') === 'oak,pine');
  win.ASSET_REGISTRY = {};
  check('tomt bibliotek: tom pool (statusraden säger det)', V.poolFor('PALMS').length === 0 && V.poolFor('FOREST').length === 0);
}

console.log('\n3. Inställningarna på hålen');
{
  const win = { ASSET_REGISTRY: REG, placedTrees: [], surroundConfig: { N: 'roughColor', E: 'roughColor', S: 'roughColor', W: 'roughColor' },
                courseHoles: [{}, { surroundVeg: { sides: { N: 'PALMS', E: 'BOGUS' }, density: 9, depth: 5, custom: ['oak', 3], seed: 42 } }] };
  const V = load(win);
  V.restore();
  const c = V.config();
  check('från första hålet som har dem; felaktiga värden får standard eller kläms', c.sides.N === 'PALMS' && c.sides.E === 'AUTO' && c.density === 3 && c.depth === 40 && JSON.stringify(c.custom) === '["oak"]' && c.seed === 42, JSON.stringify(c));
  win.courseHoles = [{}, {}];
  V.restore();
  check('inga inställningar: alla sidor efter marken', JSON.stringify(V.config().sides) === '{"N":"AUTO","E":"AUTO","S":"AUTO","W":"AUTO"}');
  let saved = 0; win.saveLevel = function () { saved++; };
  V.setSide('W', 'NONE');
  check('ett val sparas på alla hål', win.courseHoles.every(function (h) { return h.surroundVeg && h.surroundVeg.sides.W === 'NONE'; }) && saved === 1);
}

console.log('\n4. arcade.html');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
  const fn = html.slice(html.indexOf('function applyEditorState(state)'), html.indexOf('function applyEditorState(state)') + 12000);
  check('ångra/gör om: vegetationen följer de återställda hålen', /if \(window\.SurroundVeg\) window\.SurroundVeg\.restore\(\);/.test(fn));
  check('biblioteket har kommit: bältet byggs om', /window\.buildNatureUI\(\);\s*\}\s*\/\/[^\n]*\n\s*if \(window\.SurroundVeg\) window\.SurroundVeg\.schedule\(\);/.test(html));
  check('laddning: restoreSurrounding återställer vegetationen', /window\.updateSurroundColors\(\);\s*if \(window\.SurroundVeg\) window\.SurroundVeg\.restore\(\);/.test(html));
  check('sparas, laddas och nollställs med hålen', /surroundVeg: h\.surroundVeg \? JSON\.parse/.test(html) && /h\.surroundVeg = hState\.surroundVeg \|\| null;/.test(html) && /h\.surroundVeg = null;/.test(html) &&
        /surroundVeg: h\.surroundVeg \|\| null,/.test(fs.readFileSync(path.join(__dirname, '..', 'arcade-save.js'), 'utf8')) &&
        /if\(hSync\.surroundVeg\) h\.surroundVeg = hSync\.surroundVeg;/.test(fs.readFileSync(path.join(__dirname, '..', 'arcade-load.js'), 'utf8')));
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
