/**
 * Spellägen (body.phase-*): en kontroll syns bara medan den kan användas.
 * 1. Renderloopen: läget ur playState och isPuttingMode (sikta / putt / flygning), klassen byts bara när läget byts, och en
 *    utfälld klubbrad fälls ihop vid nästa byte.
 * 2. Klubbraden i puttläge: ett tryck på den valda klubban fäller ut raden, ett val fäller ihop den.
 * 3. arcade.css: under flygning döljs klubbrad, slagform, SWING, klubbpiller, sifferinmatning, lägespanel, flyover/lutning och
 *    sikte; vid putt döljs slagformen och raden visar bara klubban i handen. Slagdata, karta och meny rörs inte.
 * Run: node tests/test_play_phases.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'arcade.css'), 'utf8');

console.log('1. Läget');
const a = html.indexOf('// --- PLAY PHASE (body.phase-*)');
const blockSrc = html.slice(html.indexOf('{', a), html.indexOf('// --- GSPRO AIM BILLBOARD PROJECTION ---', a));
check('blocket finns i renderloopen, före siktskylten', a > 0 && blockSrc.length > 0);
// run the block against stubs: which class the body gets in each state
function phaseFor(state) {
  const classes = new Set(['play-ui']), cs = { removed: 0, classList: { remove: function () { cs.removed++; } } };
  const win = Object.assign({ _playPhase: state.prev }, { isPuttingMode: state.putting });
  const doc = { body: { classList: { toggle: function (c, on) { if (on) classes.add(c); else classes.delete(c); } } }, getElementById: function () { return cs; } };
  new Function('window', 'document', 'appMode', 'playState', 'isFlying', blockSrc)(win, doc, state.mode, state.playState, !!state.flying);
  return { phase: win._playPhase, classes: Array.from(classes).filter(function (c) { return /^phase-/.test(c); }), folded: cs.removed };
}
const aim = phaseFor({ mode: 'PLAY', playState: 'ROUND_IDLE', putting: false });
check('spel, väntar på slag, inte putt: sikta', aim.phase === 'aim' && aim.classes.join() === 'phase-aim', JSON.stringify(aim));
check('spel, väntar på slag, putt: putt', phaseFor({ mode: 'TEST', playState: 'ROUND_IDLE', putting: true }).phase === 'putt');
check('bollen i luften: flygning', phaseFor({ mode: 'PLAY', playState: 'ROUND_FLYING', putting: true }).classes.join() === 'phase-flight');
check('bollen rullar fortfarande (isFlying) fast läget är tillbaka: flygning', phaseFor({ mode: 'PLAY', playState: 'ROUND_IDLE', flying: true }).phase === 'flight');
const build = phaseFor({ mode: 'BUILD', playState: 'ROUND_IDLE', prev: 'aim' });
check('byggläget: inget läge, klasserna tas bort', build.phase === '' && build.classes.length === 0, JSON.stringify(build));
check('rundan klar: inget läge', phaseFor({ mode: 'PLAY', playState: 'ROUND_COMPLETE' }).phase === '');
check('samma läge igen: ingenting rörs', phaseFor({ mode: 'PLAY', playState: 'ROUND_IDLE', putting: true, prev: 'putt' }).folded === 0);
check('byte av läge fäller ihop en utfälld klubbrad', phaseFor({ mode: 'PLAY', playState: 'ROUND_IDLE', putting: true, prev: 'flight' }).folded === 1);

console.log('\n2. Klubbraden vid putt');
const cs = html.match(/<div id="club-selector" onclick="([^"]+)">/);
check('klubbraden har klickhanteraren', !!cs);
if (cs) {
  const handler = new Function('event', cs[1].replace(/&quot;/g, '"'));
  function run(open, btnSelected, putting) {
    const list = new Set(open ? ['clubs-open'] : []);
    const btn = { classList: { contains: function (c) { return c === 'selected' && btnSelected; } } };
    const self = { classList: { contains: function (c) { return list.has(c); }, add: function (c) { list.add(c); }, remove: function (c) { list.delete(c); } } };
    const g = global.document; global.document = { body: { classList: { contains: function (c) { return c === 'phase-putt' && putting; } } } };
    try { handler.call(self, { target: { closest: function () { return btn; } }, stopPropagation: function () {} }); } finally { global.document = g; }
    return list.has('clubs-open');
  }
  check('putt: tryck på klubban i handen fäller ut raden', run(false, true, true) === true);
  check('putt: val av en annan klubba fäller ihop den', run(true, false, true) === false);
  check('putt: tryck på den valda igen i utfälld rad fäller ihop den', run(true, true, true) === false);
  check('inte putt: raden rörs inte', run(false, true, false) === false);
}

console.log('\n3. CSS');
const blk = css.slice(css.indexOf('PLAY PHASES'));
const flightHidden = ['#club-selector', '#shape-selector', '#swing-launch-btn', '#swing-info', '#manual-tools', '#lie-conditions-hud', '#green-read-panel', '#aim-controls'];
const flightRule = blk.slice(0, blk.indexOf('{ display: none !important; }'));
check('flygning döljer allt som inte kan användas', flightHidden.every(function (id) { return flightRule.indexOf('body.phase-flight ' + id) >= 0; }));
check('flygning rör inte slagdata, karta eller meny', !/phase-flight #(dynamic-hud|minimap-container|hamburger-btn)/.test(blk));
check('putt döljer slagformen', /body\.phase-putt #shape-selector \{ display: none !important; \}/.test(blk));
check('putt visar bara klubban i handen tills raden fälls ut', /body\.phase-putt #club-selector:not\(\.clubs-open\) \.club-btn:not\(\.selected\) \{ display: none; \}/.test(blk));
check('blocket gäller alla skärmar (ingen media query)', !/@media/.test(blk));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
