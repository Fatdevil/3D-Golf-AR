/**
 * The shot bank's checks (shot-bank-core.js) and the device side (shot-sync.js): what a shot may look like before the server keeps it,
 * the ids of old shots, the outbox (a shot leaves only when the server stored it), the bag from the server with what still waits, and the
 * bag rule shared with the server (arcade-bag.js entryOf / trim). Run: node tests/test_shot_bank.js
 */
const C = require('../shot-bank-core.js');
const S = require('../shot-sync.js');
const B = require('../arcade-bag.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const NOW = Date.UTC(2026, 10, 27, 12);
const good = { cid: 'abcdef123456', t: NOW - 60000, source: 'LM', club: '7i', ballSpeed: 120, launch: 16, spin: 7000, carry: 150, total: 158, carryStd: 152, totalStd: 160,
               estimated: [], review: { flags: ['topped'], mishit: true, misread: false, looksLike: null }, accepted: true, raw: { ballSpeedMph: 120, totalSpinRpm: null, measured: ['ballSpeedMph'] },
               device: 'R10', range: 'ABC123', edited: NOW - 30000, landX: 4, landZ: 5 };

console.log('1. Vad servern tar emot');
let n = C.normalize(good, NOW);
check('ett rangeslag blir en rad: mätvärden, granskning, rådata som kom, spelarens beslut', n.ok && n.shot.client_id === 'abcdef123456' && n.shot.ball_speed === 120 && n.shot.carry_std === 152 &&
  n.shot.review.mishit === true && n.shot.accepted === true && n.shot.raw.totalSpinRpm === null && n.shot.raw.measured[0] === 'ballSpeedMph' && n.shot.lm_device === 'R10' &&
  n.shot.range_key === 'ABC123' && n.shot.edited_at === NOW - 30000 && n.shot.estimated === null && n.shot.shot_at === new Date(NOW - 60000).toISOString(), n);
check('var bollen landade i en banas scen följer inte med (ingen kolumn för det)', n.ok && !('landX' in n.shot) && !('land_x' in n.shot));
const bad = function (patch) { return C.normalize(Object.assign({}, good, patch), NOW); };
check('utan ett eget id eller med ett id som inte är ett id avvisas slaget', !bad({ cid: undefined }).ok && bad({ cid: 'x' }).reason === 'bad_cid' && bad({ cid: "abc'; DROP TABLE shots;--" }).reason === 'bad_cid');
check('en tid före 2020 eller mer än ett dygn fram avvisas', bad({ t: Date.UTC(2019, 0, 1) }).reason === 'bad_time' && bad({ t: NOW + 2 * 86400000 }).reason === 'bad_time');
check('bara launch monitor- eller svingslag, och spelets klubbor', bad({ source: 'X' }).reason === 'bad_source' && bad({ club: 'Putter' }).reason === 'bad_club' && bad({ club: null }).ok);
check('ett omöjligt mätvärde avvisar slaget (det får inte in i banken), ett saknat blir tomt', bad({ ballSpeed: 900 }).reason === 'bad_ballSpeed' && bad({ spin: -5 }).reason === 'bad_spin' &&
  bad({ carry: 'lång' }).reason === 'bad_carry' && bad({ spin: null }).ok && bad({ spin: null }).shot.spin === null);
check('granskningen och det uppskattade får bara ha kända värden', bad({ review: { flags: ['hacked'] } }).reason === 'bad_review' && bad({ estimated: ['x'] }).reason === 'bad_estimated' &&
  bad({ review: { flags: [], looksLike: 'Putter' } }).reason === 'bad_review');
check('rådata: bara platta värden, och inte för lång', bad({ raw: { a: { nested: 1 } } }).shot.raw.a === undefined && bad({ raw: [1] }).reason === 'bad_raw' &&
  bad({ raw: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['k' + i, 'x'.repeat(60)])) }).reason === 'raw_too_long');
check('ett ändrat slag: ändringens tid används om den är rimlig, annars slagets', bad({ edited: undefined }).shot.edited_at === good.t && bad({ edited: good.t - 5 }).shot.edited_at === good.t);
check('ett inspelsslag behåller bara sina kända delar', bad({ practice: { dist: 60, prox: 4.2, onGreen: true, evil: 'x' } }).shot.practice.dist === 60 && bad({ practice: { dist: 60, prox: 4.2, onGreen: true, evil: 'x' } }).shot.practice.evil === undefined);
const back = C.toClient(Object.assign({ shot_at: new Date(good.t), ball_speed: '120', player_id: 'secret', device_id: 'dev' }, n.shot));
check('en rad tillbaka till enheten: samma namn som sessionens slag, inga spelar- eller enhets-id', back.cid === good.cid && back.t === good.t && back.ballSpeed === 120 && back.carryStd === 152 &&
  !('player_id' in back) && !('device_id' in back) && !('playerId' in back), back);
const codes = new Set(); for (let i = 0; i < 50; i++) codes.add(C.makeCode(require('crypto').randomBytes(8)));
check('koderna för en ny enhet: 8 tecken utan 0/O och 1/I/L, och olika', [...codes].every(c => /^[A-HJKMNP-Z2-9]{8}$/.test(c)) && codes.size === 50);
check('en inskriven kod tvättas: små bokstäver och mellanslag går bra', C.cleanCode('abcd efgh') === 'ABCDEFGH' && C.cleanCode(null) === '');

check('träningspassets id och fysikens version följer med slaget', bad({ session: 'sess12345678', physics: 'flight-2024.1' }).shot.training_session_id === 'sess12345678' &&
  bad({ session: 'sess12345678', physics: 'flight-2024.1' }).shot.physics_version === 'flight-2024.1');
check('ett slag utan pass eller version (äldre slag) får inget gissat', n.shot.training_session_id === null && n.shot.physics_version === null);
check('ett felaktigt pass-id eller versionsnamn avvisas', bad({ session: 'x' }).reason === 'bad_session' && bad({ physics: 'a b' }).reason === 'bad_physics');
check('raden tillbaka har pass och version', C.toClient(Object.assign({ shot_at: new Date(good.t) }, bad({ session: 'sess12345678', physics: 'flight-2024.1' }).shot)).session === 'sess12345678');

console.log('\n1b. Träningspass');
const R = require('../arcade-range-session.js');
let k = 0; const mk = () => 'sess' + String(++k).padStart(6, '0');
let sess = R.sessionFor(null, 1000, mk);
check('första slaget startar ett pass', sess.id === 'sess000001' && sess.start === 1000);
sess = R.sessionFor(sess, 1000 + 3 * 3600000, mk);
check('slag inom 4 timmar från förra hör till samma pass', sess.id === 'sess000001' && sess.last === 1000 + 3 * 3600000);
sess = R.sessionFor(sess, sess.last + R.SESSION_GAP_MS + 1, mk);
check('efter ett uppehåll på mer än 4 timmar börjar ett nytt pass', sess.id === 'sess000002');
check('ett slag med en klocka som gått bakåt (mer än en minut) börjar ett nytt pass i stället för att blandas in', R.sessionFor(sess, sess.last - 120000, mk).id === 'sess000003');

console.log('\n2. Gamla lokala slag');
function store(obj) { return { get: k => obj[k] === undefined ? null : obj[k], keys: () => Object.keys(obj) }; }
const dev = 'device-1234';
const local = {
  golf_range_session_open: '1',
  golf_range_session_RNG1: JSON.stringify({ shots: [{ t: 1000, source: 'LM', club: '7i', carry: 140 }, { t: 2000, source: 'SIM', club: 'Dr', carry: 220 }], club: '7i' }),
  golf_range_session_draft: JSON.stringify({ shots: [{ t: 3000, cid: 'newstyle123', source: 'LM', club: 'PW', carry: 100 }] }),
  golf_bag_v1: JSON.stringify({ shots: [{ t: 1000, club: '7i', carry: 141, total: 150 }, { t: 500, club: '5i', carry: 170, total: 180, ballSpeed: 130 }] }),
  golf_range_session_broken: '{nope'
};
const old = S.legacyShots(store(local), dev);
const byT = {}; old.forEach(s => { byT[s.t] = s; });
check('alla sessioners slag följer med, med rangen de slogs på', old.length === 4 && byT[1000].range === 'RNG1' && byT[2000].source === 'SIM' && byT[3000].range === 'draft', old);
check('ett slag som redan har ett id behåller det, de andra får ett id av enheten och tiden', byT[3000].cid === 'newstyle123' && byT[1000].cid === S.legacyCid(dev, 1000) && /^L[0-9a-f]{8}-1000$/.test(byT[1000].cid));
check('samma enhet ger samma id varje gång, en annan enhet ett annat', S.legacyCid(dev, 1000) === S.legacyShots(store(local), dev).filter(s => s.t === 1000)[0].cid && S.legacyCid('other', 1000) !== S.legacyCid(dev, 1000));
check('enhetens id syns inte i slagets id', old.every(s => s.cid.indexOf(dev) < 0));
check('ett bagslag vars session rensats följer med (klubba och carry), ett som finns i en session tas därifrån', byT[500] && byT[500].club === '5i' && byT[500].range === 'bag' && byT[500].ballSpeed === 130 && byT[1000].carry === 140);
check('en trasig session hoppas över utan att stoppa resten', old.length === 4);
check('ids från gamla slag godtas av servern', old.every(s => C.normalize(Object.assign({ t: NOW - 1 }, s, { t: NOW - 1 }), NOW).ok || s.source === undefined));

console.log('\n3. Utkorgen');
let box = [];
box = S.put(box, { cid: 'a1234567', t: 3, edited: 3 }); box = S.put(box, { cid: 'b1234567', t: 1, edited: 1 }); box = S.put(box, { cid: 'a1234567', t: 3, edited: 9, club: '7i' });
check('ett slag finns en gång i utkorgen (den senaste kopian), äldst först', box.length === 2 && box[0].cid === 'b1234567' && box[1].club === '7i', box);
const cur = {}; box.forEach(b => { cur[b.cid] = b; });
let out = S.settle(cur, box.slice(), { stored: ['a1234567'], refused: [] });
check('bara det servern sparade lämnar utkorgen; det som inte besvarades stannar', out.stored.join() === 'a1234567' && out.keep.length === 1 && out.keep[0].cid === 'b1234567' && out.failed.length === 0, out);
out = S.settle(cur, box.slice(), { stored: [], refused: [{ cid: 'b1234567', reason: 'bad_time' }] });
check('ett slag servern avvisar går till felkön med orsaken (inte bort)', out.failed.length === 1 && out.failed[0].shot.cid === 'b1234567' && out.failed[0].reason === 'bad_time' && out.keep.length === 1, out);
const sent = box.slice(); const now2 = Object.assign({}, cur, { a1234567: { cid: 'a1234567', t: 3, edited: 20, club: '6i' } });
out = S.settle(now2, sent, { stored: ['a1234567', 'b1234567'] });
check('ett slag som ändrades medan det skickades stannar, för att gå igen (den nya kopian)', out.stored.join() === 'b1234567' && out.keep.length === 1 && out.keep[0].club === '6i', out);
out = S.settle(cur, box, {});
check('ett svar utan något sparat tar inte bort något (servern nere, ett felaktigt svar)', out.stored.length === 0 && out.failed.length === 0 && out.keep.length === 2);
let big = []; for (let i = 0; i < 6000; i++) big = i % 1000 === 0 || i > 5990 ? S.put(big, { cid: 'c' + String(i).padStart(8, '0'), t: i }) : (big.push({ cid: 'c' + String(i).padStart(8, '0'), t: i }), big);
check('utkorgen har ingen gräns: inget slag tas bort för att ge plats', big.length === 6000 && big[0].t === 0);
const file = JSON.parse(S.exportFile([{ cid: 'p1234567', t: 1 }], [{ shot: { cid: 'f1234567', t: 2 }, reason: 'bad_spin', at: 3 }], Date.UTC(2026, 10, 27)));
check('av två kopior av samma slag gäller den senast ändrade (ett byte av klubba medan lagringen var full)', S.newer({ cid: 'a', t: 1, edited: 1, club: '7i' }, { cid: 'a', t: 1, edited: 5, club: '6i' }).club === '6i' &&
  S.newer({ cid: 'a', t: 1, edited: 9, club: '7i' }, { cid: 'a', t: 1, edited: 5, club: '6i' }).club === '7i' && S.newer(null, { t: 1 }).t === 1 && S.newer({ t: 2 }, undefined).t === 2);
check('exportfilen har alla väntande och avvisade slag med orsak', file.kind === 'golf-shot-export' && file.pending[0].cid === 'p1234567' && file.failed[0].reason === 'bad_spin' && file.exported_at === '2026-11-27T00:00:00.000Z', file);
check('id för nya slag är unika och godtas av servern', S.newCid() !== S.newCid() && C.normalize(Object.assign({}, good, { cid: S.newCid() }), NOW).ok);

console.log('\n4. Bagen');
const server = [{ t: 10, club: '7i', carry: 150, total: 158 }, { t: 11, club: '7i', carry: 151, total: 159 }];
const waiting = [{ cid: 'x', t: 12, source: 'LM', club: '7i', carry: 149, total: 157 }, { cid: 'y', t: 11, source: 'LM', club: '7i', carry: 151, total: 159, accepted: false, review: { flags: ['topped'], mishit: true } }];
const merged = S.mergeBag(server, waiting, B);
check('bagen är serverns med det som väntar: ett väntande slag läggs till, en ändring tar bort serverns post', merged.length === 2 && merged.map(e => e.t).join() === '10,12', merged);
check('servern och enheten räknar bagen med samma regel', B.entryOf({ t: 1, source: 'LM', club: '7i', carry: 150 }).carry === 150 && B.entryOf({ t: 1, source: 'SIM', club: '7i', carry: 150 }) === null &&
  B.entryOf({ t: 1, source: 'LM', club: '7i', carry: 150, carryStd: 155 }).carry === 155 && B.entryOf({ t: 1, source: 'LM', club: '7i', carry: 150, practice: { dist: 60 } }) === null);
check('bagen behåller de 40 senaste per klubba', B.trim(Array.from({ length: 50 }, (_, i) => ({ t: i, club: 'PW', carry: 100 }))).length === 40);

console.log(failed ? '\n' + failed + ' failed' : '\nAll shot bank checks passed');
process.exit(failed ? 1 : 0);
