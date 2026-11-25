// The scorecard of a whole collection (collections-core.js courseCard, GET /api/collections/:id/card) and the builder side of a plate built
// for a place in a collection (collection-build.js): the par mix it aims at and the place it gets.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../collections-core.js');

let failed = 0;
function check(name, ok, detail) { console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }

const hole = function (par, len, tee) { const t = {}; t[tee || 'yellow'] = { x: 0, z: 0 }; return { par: par, tees: t, flag: { x: len, z: 0 } }; };

console.log('1. Scorekortet');
{
  const card = C.courseCard('18', [
    { plate_code: 'a', name: 'Första', holes: [hole(4, 350), hole(3, 150), hole(5, 480)], theme_data: { biomeId: 'GLOBAL' } },
    { plate_code: 'B', name: 'Andra', holes: JSON.stringify([hole(4, 300), hole(4, 320, 'black'), {}]), theme_data: JSON.stringify({ biomeId: 'DESERT_SUNSET' }) }
  ]);
  check('hål i plattornas ordning, tre per platta, numrerade 1..6', card.holes.map(function (h) { return h.no + ':' + h.plate; }).join() === '1:0,2:0,3:0,4:1,5:1,6:1', card.holes);
  check('par och längd per hål; ett hål utan tee eller flagga har par 4 och längd 0', card.holes.map(function (h) { return h.par + '/' + h.length; }).join() === '4/350,3/150,5/480,4/300,4/320,4/0', card.holes);
  check('18 hål: ut (1-9) och in (10-18) och total över de hål som finns', card.front.holes === 6 && card.back.holes === 0 && card.total.par === 24 && card.total.length === 1600, [card.front, card.back, card.total]);
  check('plats och fyllnad: 6 platser, 2 fyllda', card.room === 6 && card.filled === 2);
  check('plattornas koder i versaler och deras miljöer (öken av alla slag är öken)', card.plates.map(function (p) { return p.code + ':' + p.world; }).join() === 'A:grass,B:desert' && card.worlds.join() === 'grass,desert', card.plates);
  const nine = C.courseCard('9', [{ plate_code: 'A', holes: [hole(4, 300), hole(4, 300), hole(4, 300)] }]);
  check('9 hål: inget ut/in, bara total; utan tema är det gräs', nine.front === null && nine.back === null && nine.total.par === 12 && nine.worlds.join() === 'grass', nine);
  const over = C.courseCard('6', [{ plate_code: 'A' }, { plate_code: 'B' }, { plate_code: 'C' }]);
  check('fler plattor än det finns plats för: de som får plats', over.filled === 2 && over.holes.length === 6, over.filled);
  check('månen är en egen miljö', C.worldOf({ biomeId: 'MOON' }) === 'moon' && C.worldOf(null) === 'grass' && C.worldOf('{"biome":"desert"}') === 'desert');
}

console.log('\n2. Parmixen för hela banan');
{
  const t18 = C.parTargets(18), t9 = C.parTargets(9), t6 = C.parTargets(6), t3 = C.parTargets(3);
  check('18 hål: 4 par 3, 10 par 4, 4 par 5 (par 72)', t18[3] === 4 && t18[4] === 10 && t18[5] === 4 && 3 * t18[3] + 4 * t18[4] + 5 * t18[5] === 72, t18);
  check('9 hål: 2, 5, 2 (par 36); 6 hål: 1, 4, 1 (par 24)', t9[3] === 2 && t9[4] === 5 && t9[5] === 2 && t6[3] === 1 && t6[4] === 4 && t6[5] === 1, [t9, t6]);
  check('målen räknar alltid till antalet hål', [3, 6, 9, 12, 15, 18].every(function (n) { const t = C.parTargets(n); return t[3] + t[4] + t[5] === n; }) && t3[3] + t3[4] + t3[5] === 3);
}

console.log('\n3. Buildern (collection-build.js)');
{
  const win = { location: { search: '' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'collection-build.js'), 'utf8'), { window: win, globalThis: win, URLSearchParams: URLSearchParams, setTimeout: setTimeout });
  const CB = win.CollectionBuild;
  check('samma parmål som servern för 3..18 hål', [3, 6, 9, 12, 15, 18].every(function (n) { return JSON.stringify(CB.parTargets(n)) === JSON.stringify(C.parTargets(n)); }));
  const card = { room: 6, filled: 3, plates: [{ code: 'A' }, { code: 'B' }, { code: 'C' }] };
  check('en platta som redan ligger i samlingen behåller sin plats', CB.placeIn(card, 5, 'B') === 1);
  check('en ny platta hamnar direkt efter de plattor som finns (listan har inga luckor), vilken plats den än bad om', CB.placeIn(card, 1, 'X') === 3 && CB.placeIn(card, 5, '') === 3);
  // a working copy continued without ?edit= in the address: the code arcade-load.js restored into currentEditCode finds the plate's own place
  const win2 = { location: { search: '?autorun=edit_build' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'collection-build.js'), 'utf8'), { window: win2, globalThis: win2, URLSearchParams: URLSearchParams, setTimeout: function () {}, currentEditCode: 'b' });
  global.resumed = win2.CollectionBuild.start('col9', 0, { card: { name: 'Full', type: '9', room: 3, filled: 3, plates: card.plates, holes: [] }, quiet: true })
    .then(function (ctx) { return { slot: ctx && ctx.slot, offset: win2._holeNumberOffset }; });
  check('full samling: ingen plats', CB.placeIn({ room: 2, filled: 2, plates: [{ code: 'A' }, { code: 'B' }] }, 0, 'X') === -1);
}
{
  // a context with a given card (no builder page): the numbers and what the other plates bring
  const win = { location: { search: '' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'collection-build.js'), 'utf8'), { window: win, globalThis: win, URLSearchParams: URLSearchParams, setTimeout: setTimeout });
  const CB = win.CollectionBuild;
  const card = Object.assign({ name: 'Sjöbanan' }, C.courseCard('18', [
    { plate_code: 'A', holes: [hole(4, 350), hole(3, 150), hole(5, 480)] },
    { plate_code: 'B', holes: [hole(4, 300), hole(4, 320), hole(4, 400)] },
    { plate_code: 'C', holes: [hole(4, 360), hole(3, 160), hole(4, 380)] },
    { plate_code: 'D', holes: [hole(5, 500), hole(4, 340), hole(3, 170)] }
  ]));
  global.resumed.then(function (r) {
    check('en fortsatt arbetskopia (koden bara i currentEditCode, inte i adressen) behåller sin plats, även i en full samling', r.slot === 1 && r.offset === 3, r);
    return CB.start('col1', 2, { card: card, quiet: true });
  }).then(function (ctx) {
    const o = CB.others();
    check('en ny platta som ber om plats 3 när 4 plattor redan finns får plats 5 (hål 13–15)', ctx.slot === 4 && win._holeNumberOffset === 12, [ctx.slot, win._holeNumberOffset]);
    check('de andra plattorna: alla 12 hål före, inga efter', o.before.holes === 12 && o.before.from === 1 && o.before.to === 12 && o.after.holes === 0 && o.size === 18 && o.name === 'Sjöbanan', o);
    check('och deras par räknas med i parmixen', o.pars.length === 12 && o.pars.filter(function (p) { return p === 3; }).length === 3, o.pars);
    check('det som sparas med plattan', JSON.stringify(CB.themeData()) === JSON.stringify({ id: 'COL1', slot: 4 }), CB.themeData());
    CB.clear();
    check('utan samling: inga nummer, inget sparat', win._holeNumberOffset === 0 && CB.others() === null && CB.themeData() === undefined);
    console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll collection card checks passed');
    process.exit(failed ? 1 : 0);
  });
}
