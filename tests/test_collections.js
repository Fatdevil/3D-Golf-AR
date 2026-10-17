/**
 * Banor av flera plattor (6, 9 eller 18 hål): reglerna för plattlistan och de ställen i sidorna som måste hålla ihop med dem.
 *   - collections-core.js: hur många plattor som ryms, att ingen används två gånger, att varje platta finns, är publicerad och är en bana
 *   - hålnumren: på platta 2 visas första hålet som hål 4 (inte hål 1)
 *   - resultatet: varje platta skickas när den är spelad och knyts till samlingen, också innan sidan går vidare till nästa platta
 * Run: node tests/test_collections.js
 */
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const core = require('../collections-core');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

// --- plattlistan ---
let r = core.checkPlateList('6', [{ plate_code: 'abc123', plate_name: 'A' }, 'def456']);
check('två plattor ryms i en 6-hålsbana (kod i versaler, äldre rader med bara koden går an)', !r.error && r.plates.length === 2 && r.plates[0].plate_code === 'ABC123' && r.plates[1].plate_code === 'DEF456', JSON.stringify(r));
check('en tom lista är en samling som inte är färdig, inget fel', !core.checkPlateList('9', []).error && !core.checkPlateList('9', undefined).error);
r = core.checkPlateList('6', [{ plate_code: 'A1' }, { plate_code: 'B2' }, { plate_code: 'C3' }]);
check('tre plattor ryms inte i en 6-hålsbana', !!r.error, r.error);
check('nio plattor ryms inte i en 18-hålsbana, sex gör det', !!core.checkPlateList('18', new Array(7).fill(0).map((_, i) => ({ plate_code: 'P' + i }))).error && !core.checkPlateList('18', new Array(6).fill(0).map((_, i) => ({ plate_code: 'P' + i }))).error);
r = core.checkPlateList('9', [{ plate_code: 'A1' }, { plate_code: 'a1' }]);
check('samma platta två gånger avvisas (även med olika versaler)', !!r.error && /twice/.test(r.error), r.error);
check('en post utan kod, med konstig kod eller utan innehåll avvisas', !!core.checkPlateList('9', [{ plate_name: 'x' }]).error && !!core.checkPlateList('9', [{ plate_code: 'A B;' }]).error && !!core.checkPlateList('9', [null]).error && !!core.checkPlateList('9', [42]).error);
check('plates som inte är en lista avvisas', !!core.checkPlateList('9', 'ABC').error && !!core.checkPlateList('9', { plate_code: 'A1' }).error);

// --- plattorna finns i databasen ---
const plates = [{ plate_code: 'A1', plate_name: 'x' }, { plate_code: 'B2', plate_name: '' }];
const row = (code, o) => Object.assign({ share_code: code, name: 'Bana ' + code, total_par: 11, hole_count: 3, is_draft: false, is_range: false }, o || {});
r = core.checkPlatesExist(plates, [row('A1'), row('B2', { total_par: null, hole_count: 3 })]);
check('publicerade banor godtas, totalpar räknas från banorna (total_par, annars 4 per hål)', !r.error && r.totalPar === 11 + 12, JSON.stringify(r));
check('namnet kommer från banan, inte från sidan', r.plates[0].plate_name === 'Bana A1');
check('en platta som inte finns avvisas', /does not exist/.test(core.checkPlatesExist(plates, [row('A1')]).error || ''));
check('ett utkast avvisas', /not published/.test(core.checkPlatesExist(plates, [row('A1'), row('B2', { is_draft: true })]).error || ''));


check('en bana med 1 eller 2 hål är ingen platta (4 hål inte heller)', [1, 2, 4].every(n => /holes, a plate has 3/.test(core.checkPlatesExist(plates, [row('A1'), row('B2', { hole_count: n })]).error || '')));
check('en bana utan hole_count (gammal rad) räknas som 3 hål', !core.checkPlatesExist(plates, [row('A1'), row('B2', { hole_count: null })]).error);

// --- samlingens hål som en bana (slagindex och betyg) ---
const six = core.combineHoles([[{ n: 1 }, { n: 2 }, { n: 3 }], JSON.stringify([{ n: 4 }, { n: 5 }, { n: 6 }])]);
check('plattornas hål blir en lista, tre per platta i plattornas ordning (text eller lista)', six.length === 6 && six.map(h => h.n).join('') === '123456');
const padded = core.combineHoles([[{ n: 1 }], [{ n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }], 'trasig text', null]);
check('en platta med färre hål fylls ut till tre, en med fler kapas, trasiga data blir tomma hål (hål n i samlingen är alltid hål n % 3 på platta n / 3)', padded.length === 12 && padded[0].n === 1 && padded[1].n === undefined && padded[3].n === 2 && padded[5].n === 4 && padded[6].n === undefined && padded[11].n === undefined);

// --- hålnumren ---
const arcade = read('arcade.html'), builder = read('smart-builder.js'), load = read('arcade-load.js');
check('arcade.html har holeNumber() som lägger till plattans förskjutning', /window\.holeNumber\s*=\s*function\s*\(index\)\s*\{\s*return \(window\._holeNumberOffset \|\| 0\) \+ index \+ 1;/.test(arcade));
check('förskjutningen sätts när samlingen laddas (plattnummer × hål per platta)', /_holeNumberOffset\s*=\s*plateIndex\s*\*\s*MAX_HOLES/.test(load));
check('rubriken, toppraden och flygningens stora hålnummer använder holeNumber()', /innerText = "Hole " \+ window\.holeNumber\(currentHoleIndex\)/.test(arcade) && /flyover-hole-big'\)\.innerText = window\.holeNumber\(playingHoleIndex\)/.test(arcade));
check('byggarens sidopanel och topprad använder holeNumber() också', (builder.match(/window\.holeNumber \? window\.holeNumber\(window\.currentHoleIndex\)/g) || []).length === 3);
check('samlingens slagliste och "hål spelade" räknar med MAX_HOLES, inte ett hårdkodat 3', !/pIdx\s*\*\s*3|plateIndex\s*\*\s*3|i<3 && \(offset/.test(arcade));

// --- resultatet ---
const result = read('arcade-round-result.js');
check('resultatet knyts till samlingen: collection_id, collection_round_id och plate_index', /collection_id:\s*col\.id/.test(result) && /collection_round_id:\s*collRound/.test(result) && /plate_index:/.test(result));
check('varje spelare och platta får ett eget round_id (ett nytt försök fördubblar inget)', /round_id:\s*collStats\.collection_round_id \+ '-p' \+ collStats\.plate_index \+ '-' \+ seat/.test(result));
check('alla spelare skickas samtidigt, med keepalive så att sidbytet inte avbryter, och med platsen i listan (player_slot)', /Promise\.all\(players\.map/.test(result) && /keepalive: true/.test(result) && /player_slot: seat/.test(result) && /keepalive: !!\(opts && opts\.keepalive\)/.test(read('arcade-api-service.js')));
check('en bana utan samling skickar ingen stats (som förut)', /stats:\s*collStats\s*\?/.test(result) && /let collStats = null/.test(result));
const nonFinal = arcade.slice(arcade.indexOf('if (hasNextPlate) {'), arcade.indexOf('// === COLLECTION: Final plate'));
check('en platta som inte är sista skickas innan sidan går vidare (och sidan väntar högst 3 s på svaret)', /submitRoundResult\(\{ silent: true \}\)/.test(nonFinal) && /Promise\.race\(\[plateSent, new Promise\(r => setTimeout\(r, 3000\)\)\]\)/.test(nonFinal));
check('samlingens runda-id rensas när sista plattan är skickad och när en ny omgång startas', /removeItem\('collection_round_' \+ col\.id\)/.test(arcade) && /removeItem\('collection_round_' \+ collectionId\)/.test(read('build.html')));

// --- spelarna följer med mellan plattorna ---
check('spelarna sparas när sidan går vidare och läggs tillbaka på nästa platta (namn, tee, hcp och plats)', /collection_roster_' \+ col\.id, JSON\.stringify\(players\.map/.test(arcade) && /getItem\('collection_roster_' \+ collectionId\)/.test(load) && /plateIndex > 0 && Array\.isArray\(roster\)/.test(load));
check('varje spelare har en plats (slot) som följer hela rundan, och resultatet använder den', /slot: sp\.slot/.test(arcade) && /let seat = pl\.slot !== undefined \? pl\.slot : pi/.test(result) && /player_slot: seat/.test(result));
check('samlingens slaglista summerar per plats, inte per plats i den här sidans lista', /slotOf\(/.test(arcade) && (arcade.match(/slotOf\(/g) || []).length >= 4);
check('spelarlistan rensas när sista plattan är klar och när en ny omgång startas', /removeItem\('collection_roster_' \+ col\.id\)/.test(arcade) && /removeItem\('collection_roster_' \+ collectionId\)/.test(read('build.html')));

check('platta 1 av en samling börjar alltid om: gamla poäng, rundtoken och spelare rensas, vilken sida man än startade från', /if \(plateIndex === 0\) \{\s*try \{ \['collection_scores_', 'collection_round_', 'collection_roster_'\]\.forEach/.test(load) && load.indexOf("if (plateIndex === 0) {") < load.indexOf("window._collectionScores = JSON.parse"));

// --- katalogen ---
const catalog = read('courses.html');
check('katalogens samlingskort hämtar samlingens topplista (/api/collections/<id>/leaderboard), vanliga banor sin egen', /course\._isCollection\s*\?\s*`\$\{API_BASE\}\/api\/collections\/\$\{encodeURIComponent\(course\._collectionId\)\}\/leaderboard`/.test(catalog) && /api\/courses\/\$\{encodeURIComponent\(course\.share_code\)\}\/leaderboard/.test(catalog));
check('katalogen läser svaret { leaderboard: [...] } (inte en lista) och skriver spelarnamn escapade', /data\.leaderboard/.test(catalog) && /name: esc\(r\.player_name/.test(catalog));

// --- servern ---
const server = read('server.js');
check('plattväljaren erbjuder bara banor med 3 hål', /!c\.hole_count \|\| c\.hole_count === 3/.test(read('build.html')));
check('topplistan räknar bara rundor på plattornas nuvarande version', /JOIN courses c ON c\.share_code = r\.course_code AND r\.course_version = COALESCE\(c\.version, 1\)/.test(server));
check('topplistan skiljer spelare på plats (player_slot), inte på namn', /COALESCE\(r\.stats->>'player_slot', r\.player_name\)/.test(server));
check('servern kontrollerar plattorna vid sparande och räknar totalpar själv', /checkPlateList\(type, plates\)/.test(server) && /checkPlatesExist\(cleanPlates, found\.rows\)/.test(server) && !/total_par\s*\}\s*=\s*req\.body/.test(server.slice(server.indexOf("app.post('/api/collections'"), server.indexOf("app.get('/api/collections/:id/leaderboard'"))));
check('servern lagrar samlingens slagindex och betyg, räknar om dem i samma transaktion som banan när en platta publiceras igen och låter en samlingsrunda ge en differential', /ADD COLUMN IF NOT EXISTS stroke_index JSONB/.test(server) && /await txdb\.query\('BEGIN'\);[\s\S]{0,2500}refreshCollectionsOf\(txdb, updateResult\.rows\[0\]\.share_code\);\s*await txdb\.query\('COMMIT'\)/.test(server) && /collDifferential/.test(server));
check('handikapphistoriken visar en samlingsrunda ur den ögonblicksbild servern skrev när rundan slutfördes (collection_go), inte ur föränderliga data, och en klient kan inte skicka in en egen', /stats \|\| jsonb_build_object\('collection_go'/.test(server) && /const go = r\.stats && r\.stats\.collection_go/.test(server) && /delete storedStats\.collection_go/.test(server));
check('betyg som saknas på en äldre samling räknas fram när de behövs (när samlingen läses och när ett resultat kommer in)', /async function ensureCollectionRatings/.test(server) && /coll = await ensureCollectionRatings\(pool, cr\.rows\[0\]\)/.test(server) && /res\.json\(await ensureCollectionRatings\(pool, result\.rows\[0\]\)\)/.test(server));
check('servern har en topplista för samlingen', /app\.get\('\/api\/collections\/:id\/leaderboard'/.test(server));

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
