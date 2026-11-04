/**
 * Spelmotorn (arcade-game-core.js): regler för ett slags resultat, hål och scorekort, utan webbläsare.
 * Run: node tests/test_game_core.js
 */
const events = [];
global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
global.window = { dispatchEvent: function (e) { events.push({ name: e.type, detail: e.detail }); } };
const { GolfEngine: E, GameEvent: G } = require('../arcade-game-core.js');
const out = function (l) { process.stdout.write(l + '\n'); };
console.log = function () {};   // the engine logs every event: the test prints through out()

let failed = 0;
function check(name, ok, detail) {
  out((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const names = () => events.map(e => e.name);
function fresh(settings, holes) {
  events.length = 0;
  E.initPlayers([{ name: 'P1', color: '#fff' }]);
  E.updateSettings(Object.assign({ gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 }, settings || {}));
  E.startRound(holes || [{ par: 4 }, { par: 3 }, { par: 5 }]);
  events.length = 0;
  const p = E.getActivePlayer();
  p.strokes = 1;   // the shot that was just hit (the caller counts it when the ball is struck)
  return p;
}
// handleShotResult(player, distanceToPinFt, isGreen, isFringe, isHoled, holePar, finalTerrain, entryPoint, prevLie)
const shot = (p, o) => E.handleShotResult(p, o.ft === undefined ? 100 : o.ft, !!o.green, !!o.fringe, !!o.holed, E.holePar(), o.terrain || 'FAIRWAY', o.entry, o.prev);

out('Event names exist for every outcome');
check('BALL_STOPPED finns i GameEvent (förut undefined)', G.BALL_STOPPED === 'GolfEvent_BallStopped' && G.HOLE_STARTED && G.ROUND_COMPLETED);

out('\nNormalt stopp');
{
  const p = fresh();
  shot(p, { ft: 150 });
  check('ett vanligt stopp ger bara BALL_STOPPED, inga extra slag', names().join() === G.BALL_STOPPED && p.strokes === 1 && p.penaltyStrokes === 0 && !p.holedOut, names().join());
}

out('\nBollen i hålet');
{
  const p = fresh();
  shot(p, { holed: true, ft: 0 });
  const e = events.find(x => x.name === G.HOLED_OUT);
  check('hål-i-ett: HOLED_OUT, spelaren klar, score 1 på kortet', !!e && p.holedOut && p.scores[0] === 1 && e.detail.isHoleInOne === true && e.detail.total === 1 && e.detail.par === 4, JSON.stringify(e && e.detail.total));
}

out('\nVatten och OB: ett straffslag, inget hål');
for (const t of ['WATER', 'OB']) {
  const p = fresh();
  shot(p, { terrain: t, entry: { x: 1, z: 2 }, prev: { x: 0, z: 0 } });
  const e = events.find(x => x.name === G.PENALTY_APPLIED);
  check(t + ': ett straffslag och PENALTY_APPLIED med föregående läge', p.penaltyStrokes === 1 && !p.holedOut && !!e && e.detail.type === t && e.detail.previousLie.x === 0, JSON.stringify(e && e.detail.type));
  check(t + ': inget BALL_STOPPED, hålet är inte slut', names().indexOf(G.BALL_STOPPED) < 0 && p.scores[0] === undefined);
}
{
  const p = fresh();
  shot(p, { terrain: 'WATER', holed: true, ft: 0 });
  check('bollen i hålet slår vatten (ingen straff om den ändå är i hålet)', p.penaltyStrokes === 0 && p.holedOut);
}

out('\nGimme och auto-putt på green');
{
  const p = fresh({ gimmeDist: 10 });
  shot(p, { green: true, ft: 8 });
  const e = events.find(x => x.name === G.GIMME_AWARDED);
  check('gimme inom 10 ft: ett putt till, hålet klart', !!e && e.detail.type === 'GIMME' && p.strokes === 2 && p.holedOut && p.scores[0] === 2, 'score ' + p.scores[0]);
}
{
  const p = fresh({ gimmeDist: 5, autoPutt: 'OFF' });
  shot(p, { green: true, ft: 8 });
  check('auto-putt av och utanför gimme: bollen blir liggande på greenen (inget putt läggs till)', names().join() === G.BALL_STOPPED && p.strokes === 1 && !p.holedOut, names().join());
}
{
  const p = fresh({ gimmeDist: 5, autoPutt: 'FIXED' });
  shot(p, { green: true, ft: 8 });
  check('auto-putt FIXED 8 ft (under 10): 1 putt', p.strokes === 2 && p.holedOut && events.find(x => x.name === G.GIMME_AWARDED).detail.putts === 1, 'slag ' + p.strokes);
  const m = fresh({ gimmeDist: 5, autoPutt: 'FIXED' });
  shot(m, { green: true, ft: 25 });
  check('auto-putt FIXED 25 ft (10-40): 2 putt', m.strokes === 3 && m.holedOut, 'slag ' + m.strokes);
  const q = fresh({ gimmeDist: 5, autoPutt: 'FIXED' });
  shot(q, { green: true, ft: 50 });
  check('auto-putt FIXED 50 ft: 3 putt', q.strokes === 4, 'slag ' + q.strokes);
  const r = fresh({ gimmeDist: 5, autoPutt: 'TOUR_PRO' });
  shot(r, { green: true, ft: 12 });
  check('auto-putt TOUR_PRO ger 1-3 putt', r.strokes >= 2 && r.strokes <= 4 && r.holedOut, 'slag ' + r.strokes);
  const f = fresh({ gimmeDist: 5, autoPutt: 'FIXED' });
  shot(f, { fringe: true, ft: 20 });
  check('kanten av greenen (fringe) ger också auto-putt', f.holedOut && f.strokes === 3, 'slag ' + f.strokes);
}

out('\nConcede (högsta score på hålet)');
{
  const p = fresh({ autoConcede: 3 });   // par 4 + 3 = 7
  p.strokes = 7;
  shot(p, { ft: 300 });
  check('concede: hålet tas som par + 3 och MATCH_COMPLETED skickas', p.holedOut && p.scores[0] === 7 && names().indexOf(G.MATCH_COMPLETED) >= 0, 'score ' + p.scores[0]);
  const q = fresh({ autoConcede: 99 });
  q.strokes = 20;
  shot(q, { ft: 300 });
  check('autoConcede 99 betyder aldrig', !q.holedOut);
  const r = fresh({ autoConcede: 2, autoPutt: 'FIXED' });   // par 4 + 2 = 6
  r.strokes = 5;
  shot(r, { green: true, ft: 60 });                         // 60 ft: tre puttar skulle ge 8
  check('auto-putt går inte över concede-gränsen: 5 slag + puttar blir 6, inte 8', r.holedOut && r.scores[0] === 6 && names().indexOf(G.MATCH_COMPLETED) >= 0, 'score ' + r.scores[0]);
  const s2 = fresh({ autoConcede: 3, autoPutt: 'FIXED' });  // par 4 + 3 = 7, två puttar ryms
  s2.strokes = 4;
  shot(s2, { green: true, ft: 20 });
  check('auto-putt under gränsen räknas som vanligt (4 + 2 = 6)', s2.holedOut && s2.scores[0] === 6 && names().indexOf(G.GIMME_AWARDED) >= 0, 'score ' + s2.scores[0]);
}

out('\nHål och scorekort');
{
  const p = fresh({}, [{ par: 4 }, { par: 3 }, { par: 5 }]);
  check('första hålet är uppe: par 4, hål 0', E.getState().holeIndex === 0 && E.holePar() === 4);
  shot(p, { holed: true, ft: 0 });         // hole 1 in 1
  check('klart hål: scorekortet har 1 hål spelat, 3 under par', E.scorecard(p).holesPlayed === 1 && E.scorecard(p).score === 1 && E.scorecard(p).vsPar === -3);
  events.length = 0;
  const idx = E.nextHole();
  check('nästa hål: index 1, par 3, slagen nollställda, HOLE_STARTED', idx === 1 && E.holePar() === 3 && p.strokes === 0 && p.penaltyStrokes === 0 && !p.holedOut && names().join() === G.HOLE_STARTED, names().join());
  p.strokes = 2; p.penaltyStrokes = 1;     // 3 incl. a penalty
  shot(p, { holed: true, ft: 0 });
  check('straffslag räknas med i hålets score', p.scores[1] === 3, 'score ' + p.scores[1]);
  E.nextHole();
  p.strokes = 5;
  shot(p, { holed: true, ft: 0 });
  events.length = 0;
  const end = E.nextHole();
  const sc = E.scorecard(p);
  check('efter sista hålet: nextHole ger null och ROUND_COMPLETED med scorekortet', end === null && names().join() === G.ROUND_COMPLETED && events[0].detail.scorecard.holesPlayed === 3, names().join());
  check('totaler: 1 + 3 + 5 = 9 mot par 12 (3 under)', sc.score === 9 && sc.par === 12 && sc.vsPar === -3 && p.totalScore === 9, JSON.stringify({ score: sc.score, par: sc.par }));
  check('scorekortet har en rad per hål med par och score', sc.rows.length === 3 && sc.rows[1].par === 3 && sc.rows[1].score === 3);
}
{
  const p = fresh({}, [{ par: 4 }, { par: 4 }]);
  const sc = E.scorecard(p);
  check('ett hål som inte är spelat har score null och räknas inte i totalen', sc.rows[0].score === null && sc.holesPlayed === 0 && sc.score === 0);
}

out('\nTurordning: alla slår ut innan någon slår sitt andra slag');
{
  E.initPlayers([{ name: 'Anna', color: '#f00' }, { name: 'Bo', color: '#0f0' }]);
  E.updateSettings({ gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 });
  E.startRound([{ par: 4 }]);
  const [A, B] = E.getState().players;
  const dist = { Anna: 400, Bo: 340 };   // Anna på bakre tee, Bo på röd tee
  const d = p => dist[p.name];
  check('olika tees: Anna har hedern och slår först', E.nextPlayer(d) === A);
  A.strokes = 1; dist.Anna = 370;        // kort utslag, fortfarande längre bort än Bos tee
  check('Anna slog kort (370 m) men Bo har inte slagit ut (340 m): Bo slår', E.nextPlayer(d) === B);
  A.strokes = 1; dist.Anna = 410;        // bollen studsade bakåt
  check('Annas boll bakom tee: Bo slår ändå ut först', E.nextPlayer(d) === B);
  B.strokes = 1; dist.Bo = 200;
  check('båda har slagit ut: längst bort (Anna 410 m) slår', E.nextPlayer(d) === A);
}

out('\nFlera spelare: turordning, hederslista, scorekort');
{
  events.length = 0;
  E.initPlayers([{ name: 'Anna', color: '#f00' }, { name: 'Bo', color: '#0f0' }, { name: 'Cia', color: '#00f' }]);
  E.updateSettings({ gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 });
  E.startRound([{ par: 4 }, { par: 3 }]);
  const [A, B, C] = E.getState().players;
  const dist = { Anna: 0, Bo: 0, Cia: 0 };
  const d = p => dist[p.name];
  check('på första tee spelar den som står först i listan (alla lika långt från flaggan)', E.nextPlayer(d) === A && E.getActivePlayer() === A);
  dist.Anna = 150; dist.Bo = 150; dist.Cia = 150;
  check('alla på tee: Anna först (turordningen avgör lika avstånd)', E.nextPlayer(d) === A);
  dist.Anna = 40; dist.Bo = 150; dist.Cia = 150; A.strokes = 1;
  check('längst från hålet spelar: Anna har slagit, nu Bo (Cia efter honom i ordningen)', E.nextPlayer(d) === B);
  dist.Bo = 60; B.strokes = 1;
  check('Bo slog till 60 m: Cia är fortfarande på tee (150 m) och spelar', E.nextPlayer(d) === C);
  dist.Cia = 20; C.strokes = 1;
  check('Cia på 20 m, Bo på 60 m, Anna på 40 m: Bo är längst bort och spelar igen', E.nextPlayer(d) === B);
  events.length = 0;
  B.strokes = 3; shot(B, { holed: true, ft: 0 });
  check('Bo har gått i mål: nästa är Anna (40 m) före Cia (20 m); Bo hoppas över', E.playersLeft().length === 2 && E.nextPlayer(d) === A);
  A.strokes = 2; shot(A, { holed: true, ft: 0 });
  check('Anna i mål: kvar är Cia', E.playersLeft().length === 1 && E.nextPlayer(d) === C);
  C.strokes = 4; shot(C, { holed: true, ft: 0 });
  check('alla i mål: ingen spelare kvar (nextPlayer ger null), hålet är klart', E.playersLeft().length === 0 && E.nextPlayer(d) === null);
  events.length = 0;
  E.nextHole();
  check('hål 2: hederslistan, bästa score slår först (Anna 2, Bo 3, Cia 4)', E.getActivePlayer() === A && E.getState().teeOrder.join() === '0,1,2', E.getState().teeOrder.join());
  // hål 2: Cia gör bäst
  dist.Anna = 100; dist.Bo = 100; dist.Cia = 100;
  A.strokes = 4; shot(A, { holed: true, ft: 0 });
  B.strokes = 3; shot(B, { holed: true, ft: 0 });
  C.strokes = 1; shot(C, { holed: true, ft: 0 });
  events.length = 0;
  const end = E.nextHole();
  const ev = events.find(x => x.name === G.ROUND_COMPLETED);
  check('efter sista hålet: ROUND_COMPLETED med ett scorekort per spelare, "scorecard" är den första spelarens', end === null && !!ev && ev.detail.scorecards.length === 3 && ev.detail.scorecard.score === A.totalScore && ev.detail.scorecards[2].score === 5 && ev.detail.scorecards[2].player.name === 'Cia', JSON.stringify(ev && ev.detail.scorecards.map(x => x.score)));
}
{
  events.length = 0;
  E.initPlayers([{ name: 'Anna' }, { name: 'Bo' }]);
  E.updateSettings({ gimmeDist: 10, autoPutt: 'OFF', autoConcede: 99 });
  E.startRound([{ par: 4 }, { par: 4 }, { par: 4 }]);
  const [A, B] = E.getState().players;
  A.strokes = 5; shot(A, { holed: true, ft: 0 });
  B.strokes = 3; shot(B, { holed: true, ft: 0 });
  E.nextHole();
  check('hederslistan: Bo gjorde bäst på hål 1 och slår först på hål 2', E.getActivePlayer() === B && E.getState().teeOrder.join() === '1,0', E.getState().teeOrder.join());
  A.strokes = 4; shot(A, { holed: true, ft: 0 });
  B.strokes = 4; shot(B, { holed: true, ft: 0 });
  E.nextHole();
  check('lika score på hål 2: ordningen från förra hålet består (Bo före Anna)', E.getActivePlayer() === B && E.getState().teeOrder.join() === '1,0');
}
E.initPlayers([{ name: 'P1', color: '#fff' }]);

out(failed ? '\n' + failed + ' FAILED' : '\nAll passed');
process.exit(failed ? 1 : 0);
