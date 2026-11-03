/**
 * Fysiklabbet (slagsättet NUMBERS i arcade-swing-engine.js): exakta inskrivna slag för att testa bollfysiken, inte ett sätt att spela.
 * 1. Brytaren: ?lab=1 slår på (sparas), ?lab=0 slår av; utan brytare går labbet inte att välja.
 * 2. Labbet bara i testläge och på rangen (applyInputMode({ lab: true })), aldrig i en runda på en bana; dess val sparas för sig
 *    (golfos_lab_input) och följer aldrig med in i en runda. Swing är standard överallt; ett gammalt sparat NUMBERS gäller inte.
 * 3. Topplistan: en labbrunda (MANUAL) skickas aldrig (arcade-round-result.js) och servern avvisar den (server.js).
 * 4. Menyn och rutorna: knappen heter Fysiklabb och syns bara med body.lab-allowed; rutorna har etiketter och en LABB-märkning.
 * Run: node tests/test_physics_lab.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}

function page(stored, search) {
  const store = Object.assign({}, stored || {});
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const classes = new Set();
  const stub = () => ({ tagName: 'DIV', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, getAttribute() { return null; }, setAttribute() {}, addEventListener() {} });
  const els = new Proxy({}, { get: (o, id) => (o[id] = o[id] || stub()) });
  const body = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => { if (on === undefined) on = !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; } } };
  const win = { localStorage: localStorage, location: { search: search || '' }, G: {} };
  const SE = require('./load_swing_engine.js')({ window: win, globals: { performance: performance }, document: { body: body, getElementById: (id) => els[id] } });
  return { SE: SE, store: store, classes: classes, win: win };
}

console.log('1. Brytaren');
{
  let p = page();
  check('utan brytare: av', p.SE.isLabEnabled() === false);
  p.SE.applyInputMode({ lab: true });
  p.SE.setInputMode('NUMBERS');
  check('utan brytare går labbet inte att välja, inte ens i testläget', p.SE.getInputMode() === 'SWING' && !p.classes.has('lab-allowed') && !('golfos_lab_input' in p.store), JSON.stringify(p.store));
  p = page({}, '?lab=1');
  check('?lab=1 slår på och sparas', p.SE.isLabEnabled() === true && p.store.golfos_lab === '1');
  p = page({ golfos_lab: '1' });
  check('sparad brytare utan ?lab: på', p.SE.isLabEnabled() === true);
  p = page({ golfos_lab: '1' }, '?course=X&lab=0');
  check('?lab=0 slår av och tar bort den sparade', p.SE.isLabEnabled() === false && !('golfos_lab' in p.store));
  const blocked = require('./load_swing_engine.js')({ window: { get localStorage() { throw new Error('blocked'); }, location: { search: '' } }, globals: { performance: performance } });
  check('blockerad lagring: av, inget fel', blocked.isLabEnabled() === false);
}

console.log('\n2. Bara i labbet');
{
  const p = page({ golfos_lab: '1' });
  p.SE.applyInputMode({ lab: true });
  check('testläge/range med brytare, inget val: swing är standard', p.SE.getInputMode() === 'SWING' && p.classes.has('lab-allowed'));
  p.SE.setInputMode('NUMBERS');
  check('labbet valt: NUMBERS, MANUAL i topplistans fält, sparat för sig', p.SE.getInputMode() === 'NUMBERS' && p.win.G.inputMode === 'MANUAL' && p.store.golfos_lab_input === '1' && !('golfos_input_mode' in p.store), JSON.stringify(p.store));
  p.SE.applyInputMode({ lab: false });
  check('en runda på en bana: labbet gäller inte (swing), knappen döljs', p.SE.getInputMode() === 'SWING' && !p.classes.has('lab-allowed') && p.win.G.inputMode === 'SWING_METER');
  p.SE.setInputMode('NUMBERS');
  check('i en runda går labbet inte att välja', p.SE.getInputMode() === 'SWING');
  p.SE.applyInputMode({ lab: true });
  check('tillbaka i testläget: labbet igen (valet på sidan)', p.SE.getInputMode() === 'NUMBERS');
  p.SE.setInputMode('LM');
  check('launch monitor i labbet: lämnar labbet, sparat som vanligt val', p.SE.getInputMode() === 'LM' && p.store.golfos_input_mode === 'LM' && !('golfos_lab_input' in p.store), JSON.stringify(p.store));
}
{
  const p = page({ golfos_lab: '1', golfos_lab_input: '1', golfos_input_mode: 'LM' });
  p.SE.applyInputMode({ lab: true });
  check('ny sida i labbet: labbet som var på', p.SE.getInputMode() === 'NUMBERS');
  const q = page({ golfos_lab: '1', golfos_lab_input: '1', golfos_input_mode: 'LM' });
  q.SE.applyInputMode({ lab: false });
  check('ny sida, runda på en bana: det vanliga valet (LM), aldrig labbet', q.SE.getInputMode() === 'LM');
  const r = page({ golfos_lab_input: '1' });
  r.SE.applyInputMode({ lab: true });
  check('labbvalet kvar men brytaren av: swing', r.SE.getInputMode() === 'SWING');
}
{
  const p = page({ golfos_input_mode: 'NUMBERS' });
  p.SE.applyInputMode({ lab: true });
  check('ett gammalt sparat NUMBERS (före brytaren) gäller inte: swing', p.SE.getInputMode() === 'SWING');
  const q = page({ golfos_input_mode: 'NUMBERS', golfos_lab: '1' });
  q.SE.applyInputMode({ lab: true });
  check('... inte heller med brytaren på (labbet väljs på nytt)', q.SE.getInputMode() === 'SWING');
}

console.log('\n3. Topplistan');
const rr = fs.readFileSync(path.join(__dirname, '..', 'arcade-round-result.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('klienten skickar aldrig en labbrunda', /if \(window\.G && window\.G\.inputMode === 'MANUAL'\) \{[\s\S]{0,700}?return;\s*\}/.test(rr) && rr.indexOf("window.G.inputMode === 'MANUAL'") < rr.indexOf('ArcadeAPI.submitResult'));
check('servern avvisar en labbrunda innan något sparas', /if \(input_mode === 'MANUAL'\) return res\.status\(400\)/.test(server) && server.indexOf("input_mode === 'MANUAL'") < server.indexOf('INSERT INTO course_records'));

console.log('\n4. Menyn och rutorna');
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'arcade.css'), 'utf8');
check('knappen heter Fysiklabb', /data-input="NUMBERS"[^>]*>Fysiklabb<\/button>/.test(html));
check('knappen syns bara med lab-allowed', css.indexOf('body:not(.lab-allowed) #hb-input-mode .input-btn[data-input="NUMBERS"] { display: none; }') >= 0);
const mt = html.slice(html.indexOf('<div id="manual-tools"'), html.indexOf('</div>', html.indexOf('<div id="manual-tools"')));
check('LABB-märkning', /<span class="lab-badge"/.test(mt));
check('varje ruta har en etikett', ['in-speed', 'in-la', 'in-hla', 'in-backspin', 'in-sidespin'].every(function (id) { return new RegExp('<label class="mt-field"><span>[^<]+</span><input type="number" id="' + id + '"').test(mt); }));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
