/**
 * Terrängens bredd: arcade.html bygger och sparar banor på en terräng (TERRAIN_SIZE m bred) och banan sparar bara rutnät och bild, inte storleken.
 * Mobilsidan måste använda samma bredd, annars hamnar underlag, höjd och lutning på fel ställe (1,5 gånger för långt från mitten när
 * mobilsidan räknade med 900 m mot 600 m). Det här testet håller tre ställen överens utan webbläsare:
 *   - arcade.html:         const TERRAIN_SIZE = N
 *   - arcade_mobile.html:  reservvärdet för banor utan egen storlek
 *   - arcade-save.js:      båda sparvägarna skriver size i terrain_heightmap
 * Run: node tests/test_terrain_size.js
 */
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

const arcade = read('arcade.html'), mobile = read('arcade_mobile.html'), save = read('arcade-save.js');

const aSize = (arcade.match(/const TERRAIN_SIZE\s*=\s*(\d+)/) || [])[1];
check('arcade.html har en TERRAIN_SIZE', !!aSize, 'TERRAIN_SIZE = ' + aSize);

// the fallback in the mobile page: "... ? courseHeightmap.size : N;"
const mFallback = (mobile.match(/courseHeightmap\.size\s*:\s*(\d+)\s*;/) || [])[1];
check('mobilsidans reservvärde är samma som arcade.html', !!aSize && mFallback === aSize, 'mobil ' + mFallback + ' mot arcade ' + aSize);
check('mobilsidan har ingen annan hårdkodad terrängbredd (inga const TERRAIN_SIZE = <tal>)', !/const TERRAIN_SIZE\s*=\s*\d+/.test(mobile));
check('mobilsidan läser en banas egen storlek (terrain_heightmap.size) och håller den till rimliga värden', /courseHeightmap\.size\s*>=\s*100\s*&&\s*courseHeightmap\.size\s*<=\s*5000/.test(mobile));
check('båda sparvägarna i arcade-save.js skriver size i terrain_heightmap', (save.match(/size:\s*window\.TERRAIN_SIZE\s*\|\|\s*\d+/g) || []).length === 2, String((save.match(/size:\s*window\.TERRAIN_SIZE/g) || []).length) + ' ställen');

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
