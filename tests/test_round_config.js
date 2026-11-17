// The round configuration (arcade-round-config.js): one checked object for how a round is played. Only version 1 is read, every value
// is checked and clamped, the tournament limits come from the data, and it goes to and from the game's settings and sessionStorage.
const RC = require('../arcade-round-config.js');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '✅ ' : '❌ ') + name + (ok || detail === undefined ? '' : '   ' + JSON.stringify(detail)));
  if (!ok) failed++;
}

const ms = { tournamentMode: false, gimmeDist: 10, autoPutt: 'TOUR_PRO', puttAssist: 'FULL', mulligans: true, autoConcede: 99,
             windStrength: 0, greenStimp: 10, greenFirmness: 'NORMAL', altitude: 0, temperatureC: 15 };
const players = [{ name: 'Anna', tee: 'white', hcp: 12.34 }, { name: 'Bo', tee: 'red', hcp: null }];

// 1. read only what is understood
check('not an object, or another version: null', RC.normalize(null) === null && RC.normalize('x') === null && RC.normalize({ v: 2 }) === null && RC.normalize({}) === null);
const empty = RC.normalize({ v: 1 });
check('version 1 with nothing in it: the defaults, one player', empty && empty.ruleset === 'standard' && empty.rules.gimmeDist === 10 && empty.rules.mulligans === true &&
  empty.conditions.greenStimp === 10 && empty.players.length === 1 && empty.players[0].tee === 'yellow' && empty.course.code === null && empty.course.collection === null, empty);
const odd = RC.normalize({ v: 1, extra: 1, rules: { gimmeDist: 99, autoPutt: 'MAGIC', puttAssist: 'SLOPE', mulligans: 'yes', autoConcede: 7 },
  conditions: { windStrength: -3, greenStimp: '12.3', greenFirmness: 'ICE', altitude: 1e9, temperatureC: 'hot' } });
check('values out of range are clamped, unknown ones fall back, unknown keys are dropped', odd && !('extra' in odd) &&
  odd.rules.gimmeDist === 20 && odd.rules.autoPutt === 'TOUR_PRO' && odd.rules.puttAssist === 'SLOPE' && odd.rules.mulligans === true && odd.rules.autoConcede === 99 &&
  odd.conditions.windStrength === 0 && odd.conditions.greenStimp === 12.5 && odd.conditions.greenFirmness === 'NORMAL' && odd.conditions.altitude === 5000 && odd.conditions.temperatureC === 15, odd);
const many = RC.normalize({ v: 1, players: [{}, { name: '  ', tee: 'pink', hcp: 80 }, { hcp: '7.26' }, {}, { name: 'Five' }] });
check('players: at most four, a name, a known tee, a handicap of 0-54 to one decimal or none', many.players.length === 4 &&
  many.players[0].name === 'Player 1' && many.players[1].name === 'Player 2' && many.players[1].tee === 'yellow' && many.players[1].hcp === 54 && many.players[2].hcp === 7.3 && many.players[3].hcp === null, many.players);

// 2. the tournament's limits come from the data
const tour = RC.normalize({ v: 1, ruleset: 'tournament', rules: { gimmeDist: 18, mulligans: true } });
check('tournament: gimme at most 12 ft, no mulligans, whatever the rules say', tour.rules.gimmeDist === 12 && tour.rules.mulligans === false);
check('tournament: a shorter gimme stays as it is', RC.normalize({ v: 1, ruleset: 'tournament', rules: { gimmeDist: 6 } }).rules.gimmeDist === 6);
check('an unknown ruleset is the standard one', RC.normalize({ v: 1, ruleset: 'pro' }).ruleset === 'standard');

// 3. to and from the game's settings
const cfg = RC.fromMatchSettings(Object.assign({}, ms, { tournamentMode: true, gimmeDist: 15, mulligans: true, greenStimp: 11.5, windStrength: 3 }), players,
  { code: 'abc123', collection: { id: 'col7', plates: [{ code: 'P1', version: 2 }, { code: 'P2', version: null }, { version: 1 }] } });
check('from the settings: tournament limits applied, the course and the plates kept', cfg.ruleset === 'tournament' && cfg.rules.gimmeDist === 12 && cfg.rules.mulligans === false &&
  cfg.conditions.greenStimp === 11.5 && cfg.conditions.windStrength === 3 && cfg.course.code === 'ABC123' && cfg.course.collection.id === 'col7' &&
  JSON.stringify(cfg.course.collection.plates) === JSON.stringify([{ code: 'P1', version: 2 }, { code: 'P2', version: null }]) &&
  cfg.players[0].hcp === 12.3 && cfg.players[1].slot === 1, cfg);
const back = RC.toMatchSettings(cfg);
check('to the settings: every field the game has', Object.keys(ms).every(function (k) { return k in back; }) && back.tournamentMode === true && back.gimmeDist === 12 && back.mulligans === false && back.greenStimp === 11.5);
const round = RC.toMatchSettings(RC.fromMatchSettings(ms, players, null));
check('a standard round goes there and back unchanged', Object.keys(ms).every(function (k) { return round[k] === ms[k]; }), round);

// 4. sessionStorage
const store = {}, ss = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } };
const key = RC.collectionKey('col7');
check('the collection key is the round key style (upper case)', key === 'collection_config_COL7');
RC.save(ss, key, cfg);
const loaded = RC.load(ss, key);
check('saved and loaded: the same configuration', JSON.stringify(loaded) === JSON.stringify(cfg));
store[key] = '{broken';
check('a broken entry loads as null', RC.load(ss, key) === null);
store[key] = JSON.stringify({ v: 1, ruleset: 'tournament', rules: { mulligans: true } });
check('a stored tournament cannot bring mulligans back', RC.load(ss, key).rules.mulligans === false);
check('nothing stored: null', RC.load(ss, 'nothing') === null);
const throwing = { getItem: function () { throw new Error('blocked'); }, setItem: function () { throw new Error('blocked'); } };
check('blocked storage: load gives null, save gives false', RC.load(throwing, key) === null && RC.save(throwing, key, cfg) === false);

if (failed) { console.log('\n❌ ' + failed + ' check(s) failed'); process.exit(1); }
console.log('\nAll round configuration checks passed');
