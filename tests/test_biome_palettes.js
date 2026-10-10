// The built-in palettes (arcade-biomes.js) and the admin page's theme editor must agree: every colour the game uses has a picker, the pickers start
// at the GLOBAL palette, the theme list has the ids the game uses, and BUILTIN_BIOMES is a copy a database row can be filled in from.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const win = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'arcade-biomes.js'), 'utf8'), { window: win });
const admin = fs.readFileSync(path.join(root, 'admin_assets.html'), 'utf8');

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

const B = win.CLOUD_BIOMES, G = B.GLOBAL, keys = Object.keys(G);
check('GLOBAL has the 14 colours the game reads', keys.length === 14 && keys.includes('oceanColor') && keys.includes('horizonColor'), keys.join(','));

const missing = Object.keys(B).filter(function (id) { return keys.some(function (k) { return !B[id][k]; }); });
check('every built-in biome has every colour', missing.length === 0, 'lacking: ' + missing.join(','));

check('BUILTIN_BIOMES is a copy of every built-in palette',
  !!win.BUILTIN_BIOMES && Object.keys(B).every(function (id) { return win.BUILTIN_BIOMES[id] && win.BUILTIN_BIOMES[id] !== B[id] && JSON.stringify(win.BUILTIN_BIOMES[id]) === JSON.stringify(B[id]); }), '');

// the admin page: one picker per colour, starting at GLOBAL
const pickerId = function (k) { return 'theme-' + k.replace(/Color$/, ''); };
const wrong = [];
keys.forEach(function (k) {
  const m = admin.match(new RegExp('id="' + pickerId(k) + '" value="(#[0-9a-fA-F]{6})"'));
  if (!m) wrong.push(k + ' (no picker)'); else if (m[1].toLowerCase() !== G[k].toLowerCase()) wrong.push(k + ' ' + m[1] + ' != ' + G[k]);
});
check('the admin theme editor has a picker for every colour, starting at GLOBAL', wrong.length === 0, wrong.join('; '));

const saved = (admin.match(/async function saveThemeToCloud[\s\S]*?body: JSON\.stringify/) || [''])[0];
check('saving a theme sends every colour', keys.every(function (k) { return saved.indexOf(k + ':') >= 0; }), keys.filter(function (k) { return saved.indexOf(k + ':') < 0; }).join(','));

const options = (admin.match(/<select id="theme-selector"[\s\S]*?<\/select>/) || [''])[0];
const ids = ['GLOBAL', 'AUTUMN', 'WINTER', 'DESERT', 'DESERT_AUTUMN', 'DESERT_WINTER', 'MOON'];
check('the admin theme list has the ids the game and the new-course page use', ids.every(function (id) { return options.indexOf('value="' + id + '"') >= 0; }), ids.filter(function (id) { return options.indexOf('value="' + id + '"') < 0; }).join(','));

process.exit(failed ? 1 : 0);
