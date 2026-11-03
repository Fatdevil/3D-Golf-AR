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


// TERRAIN_SEGS must say what the terrain geometry is: the height lookups, the physics and the terrain chunks index the geometry with it.
// A phone (and an iPad, which arcade.html also counts as mobile) used to build a 400 x 400 terrain, then initAutoPerformanceLOD set
// TERRAIN_SEGS to 600 without the geometry: the chunks read past the end of it (NaN heights, holes showing the sky) and every lookup
// read the wrong vertex.
{
  const build = arcade.match(/window\.TERRAIN_SEGS = window\.TERRAIN_SEGS \|\| ([^;]+);\s*\n\s*let planeGeo = new THREE\.PlaneGeometry\(TERRAIN_SIZE, TERRAIN_SIZE, window\.TERRAIN_SEGS, window\.TERRAIN_SEGS\)/);
  check('arcade.html bygger terrängen med 600 x 600 på alla enheter (inte 400 på telefon)', !!build && build[1].trim() === '600', build ? build[1] : 'hittades inte');
  const lod = arcade.slice(arcade.indexOf('window.initAutoPerformanceLOD = function'), arcade.indexOf('window.initAutoPerformanceLOD = function') + 2500);
  check('initAutoPerformanceLOD sätter inte TERRAIN_SEGS rakt av när terrängen redan finns', !/\n\s*window\.TERRAIN_SEGS = 600;/.test(lod) && /if \(!window\._arcadePlaneGeo\) window\.TERRAIN_SEGS = 600;/.test(lod));
  check('en terräng med annan storlek samplas om (geometri, bitar och värde tillsammans)', /else if \(window\.TERRAIN_SEGS !== 600 && typeof window\.updateTerrainResolution === 'function'\) window\.updateTerrainResolution\(600\);/.test(lod));
  const upd = arcade.slice(arcade.indexOf('window.updateTerrainResolution = function'), arcade.indexOf('window.updateTerrainResolution = function') + 6000);
  check('updateTerrainResolution byter geometri och TERRAIN_SEGS och bygger om bitarna', /window\._arcadePlaneGeo = newGeo;\s*window\.TERRAIN_SEGS = newSegs;/.test(upd) && /window\._terrainChunks\.rebuild\(newGeo, plane\)/.test(upd));
  check('inget annat ställe sätter TERRAIN_SEGS i arcade.html', (arcade.match(/window\.TERRAIN_SEGS = /g) || []).length === 4, String((arcade.match(/window\.TERRAIN_SEGS = /g) || []).length) + ' ställen');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
