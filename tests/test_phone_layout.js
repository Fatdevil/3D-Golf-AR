/**
 * Telefonlayouten under en runda på en bana (steg 1) och på rangen (steg 2): nederkanten tillhör slaget, resten ovanför eller ihopfällt.
 * 1. arcade.html: setMode sätter body.play-ui (spel/test) och body.range-ui (rangen), och tar bort mm-open utanför spel.
 * 2. Minikartan ritas i containerns ruta (minimapBox), inte i fasta 220 x 340: viewport, inramning och linjerna ovanpå.
 * 3. ⤢ öppnar/stänger kartan; på telefon öppnar ett tryck på den lilla rutan den i stället för att sikta.
 * 4. arcade.css: blocket för telefon (max 520 px, play-ui) med raderna för varje panel; flyover/lutning bara på en bana.
 * 4b. Rangen: inspel mot green uppe till vänster, sessionspanelen en remsa under, ihopfälld som standard på telefon.
 * 4c. Slagraden: klubban i handen med ◀ ▶ (SwingEngine.stepClub), ett tryck fäller ut raden; slagformen en knapp bredvid. Klubbraden
 *     centreras med .club-row:s marginaler (en centrerad rullruta klippte bort drivern). Klubbpillret bara med avståndet till flaggan.
 * 5. minimapBox räknar rätt: innanför ramen, y nerifrån, och samma ruta som förut på en dator.
 * Run: node tests/test_phone_layout.js
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
const load = fs.readFileSync(path.join(__dirname, '..', 'arcade-load.js'), 'utf8');

console.log('1. Klasserna');
const sm = html.slice(html.indexOf('function setMode(mode) {'), html.indexOf('function setMode(mode) {') + 9000);
check('setMode: play-ui i spel och test', /document\.body\.classList\.toggle\('play-ui', mode === 'TEST' \|\| mode === 'PLAY'\)/.test(sm));
check('setMode: range-ui på rangen', /document\.body\.classList\.toggle\('range-ui', !!window\._isRangeMode\)/.test(sm));
check('rangens laddning sätter range-ui', (load.match(/window\._isRangeMode = true; document\.body\.classList\.add\('range-ui'\)/g) || []).length === 2);

console.log('\n2. Minikartan följer sin ruta');
const pass = html.slice(html.indexOf('// --- THE GSPRO MINIMAP PASS ---'), html.indexOf('// --- THE GSPRO MINIMAP PASS ---') + 9000);
check('viewporten från minimapBox', /let mmBox = window\.minimapBox\(\);[\s\S]{0,120}let mapW = mmBox\.w, mapH = mmBox\.h;/.test(pass) && /renderer\.setViewport\(mX, mY, mapW, mapH\)/.test(pass));
check('inga fasta 220 / 340 kvar i kartans pass', !/let mapW = 220|220 \/ 340;|\* 220;|\* 340;|\/ 0\.64;/.test(pass.replace(/\/\/[^\n]*/g, '')));
check('inramning och linjer i kartans egna mått', /let aspect = mapW \/ mapH;/.test(pass) && /\* mapH \/ mapW;/.test(pass) && /let toX = \(v\) => \(v\.x \* 0\.5 \+ 0\.5\) \* mapW;/.test(pass) && /let toY = \(v\) => \(-v\.y \* 0\.5 \+ 0\.5\) \* mapH;/.test(pass));

console.log('\n3. Öppna och stänga');
const click = html.slice(html.indexOf('// --- MINIMAP CLICK TO AIM ---'), html.indexOf('// --- MINIMAP CLICK TO AIM ---') + 900);
check('⤢ öppnar/stänger kartan', /e\.target\.id === 'minimap-expand'\) \{ window\.toggleMinimap\(\);/.test(click));
check('på telefon öppnar ett tryck den lilla rutan i stället för att sikta', /if \(window\.isPhonePlayLayout\(\) && !document\.body\.classList\.contains\('mm-open'\)\) \{ window\.toggleMinimap\(true\);/.test(click));
check('ett tryck på slagrutorna visar alla (telefon)', /dh\.classList\.toggle\('dh-open'\)/.test(html));
check('slagrutorna får has-data när ett slag har värden', /dynHud\.classList\.add\('has-data'\)/.test(html));

console.log('\n4. CSS-blocket');
const blk = css.slice(css.indexOf('PHONE PLAY LAYOUT'), css.indexOf('PLAY PHASES') > 0 ? css.indexOf('PLAY PHASES') : undefined);
check('ett block för max 520 px och för en telefon på sidan (högst 500 px hög, liggande)', blk.indexOf('@media (max-width: 520px), (max-height: 500px) and (orientation: landscape) {') >= 0);
[
  ['slagrutorna: en rad, dolda utan värden, två tills de öppnas', ['#dynamic-hud { top: 122px', '#dynamic-hud:not(.has-data) { display: none !important; }', '#dynamic-hud:not(.dh-open) .dh-tile:nth-child(n+3) { display: none; }']],
  ['lägespanelen: en rad ovanför slagraden, utan etiketter', ['#lie-conditions-hud { bottom: 172px !important;', '#lie-conditions-hud .lie-lbl { display: none; }']],
  ['minikartan: liten ruta uppe till höger, full storlek öppen', ['#minimap-container { top: 122px !important; bottom: auto !important; right: 8px !important; width: 88px !important; height: 136px !important;']],
  ['flyover/lutning under den lilla kartan', ['#green-read-panel { top: 266px !important;']],
  ['LM-status bara med launch monitor', [':not(.input-lm) #lm-status { display: none !important; }']]
].forEach(function (c) { check(c[0], c[1].every(function (s) { return blk.indexOf(s) >= 0; })); });
check('rader för öppen karta: full storlek, höjdprofil under, paneler som skulle täcka den dolda',
  blk.indexOf('body.play-ui.mm-open #minimap-container { width: 220px !important; height: 340px !important;') >= 0 &&
  blk.indexOf('body.play-ui:not(.mm-open) #elevation-profile-container { display: none !important; }') >= 0 &&
  /body\.play-ui\.mm-open:not\(\.range-ui\) #green-read-panel,\s*body\.play-ui\.mm-open #dynamic-hud \{ display: none !important; \}/.test(blk));
const rules = blk.split('\n').filter(function (l) { return /^\s+body/.test(l); });
check('allt i blocket gäller en runda (play-ui), bana som range', rules.length > 20 && rules.every(function (l) { return /^\s+body\.play-ui/.test(l); }));
check('flyover/lutning bara på en bana', rules.filter(function (l) { return l.indexOf('#green-read-panel') >= 0; }).every(function (l) { return l.indexOf(':not(.range-ui)') >= 0; }));
check('slagrutor, lägespanel och karta gäller rangen också (ingen :not(.range-ui))', rules.filter(function (l) { return /#(dynamic-hud|lie-|minimap-container|mm-dist|elevation-profile|lm-status)/.test(l) && !/range-ui[:.]/.test(l.replace(':not(.range-ui)', '')); }).every(function (l) { return l.indexOf('range-ui') < 0; }));
check('isPhonePlayLayout: smal skärm eller telefon på sidan, och play-ui, rangen med', /window\.isPhonePlayLayout = function \(\) \{\s*const b = document\.body;\s*return !!\(window\.matchMedia && window\.matchMedia\('\(max-width: 520px\), \(max-height: 500px\) and \(orientation: landscape\)'\)\.matches && b\.classList\.contains\('play-ui'\)\);/.test(html));

console.log('\n4d. Liggande läge (telefon på sidan)');
{
  const land = css.slice(css.indexOf('PHONE LANDSCAPE'), css.indexOf('PLAY PHASES'));
  check('ett eget block för högst 500 px höjd i liggande läge, efter telefonblocket', css.indexOf('PHONE LANDSCAPE') > css.indexOf('PHONE PLAY LAYOUT') && land.indexOf('@media (max-height: 500px) and (orientation: landscape) {') >= 0);
  [
    ['SWING nere till höger', 'body.play-ui #swing-launch-btn { bottom: 12px; left: auto; right: 12px; transform: none;'],
    ['klubban i handen längs nederkanten', 'body.play-ui #club-selector { bottom: 12px; }'],
    ['klubban centrerad till vänster om slagformen och SWING (inte över formknappen på en liten telefon)', 'body.play-ui #club-selector:not(.clubs-open) { padding-right: 270px; }'],
    ['slagformen till vänster om SWING', 'body.play-ui #shape-selector:not(.shapes-open) { bottom: 16px; right: 168px; }'],
    ['lägesraden strax ovanför slaget', 'body.play-ui #lie-conditions-hud { bottom: 66px !important; }'],
    ['liten karta uppe till höger, under menyknappen', 'body.play-ui #minimap-container { top: 70px !important; width: 100px !important; height: 112px !important; }'],
    ['öppen karta: vänster om menyknappen, ner till strax ovanför slaget, utan höjdprofil', 'body.play-ui.mm-open #minimap-container { top: 8px !important; right: 72px !important; width: 230px !important; height: calc(100vh - 80px) !important; }'],
    ['rangen: sessionen under inspelsraden när den är öppen', 'body.play-ui.range-ui:has(#range-practice.on) #range-session { top: 112px !important;']
  ].forEach(function (c) { check(c[0], land.indexOf(c[1]) >= 0); });
  check('höjdprofilen döljs med öppen karta (ingen plats bredvid)', land.indexOf('body.play-ui.mm-open #elevation-profile-container { display: none !important; }') >= 0);
  const lr = land.split('\n').filter(function (l) { return /^\s+body/.test(l); });
  check('allt i blocket gäller en runda (play-ui)', lr.length > 10 && lr.every(function (l) { return /^\s+body\.play-ui/.test(l); }));
}

console.log('\n4b. Rangen');
[
  ['inspel mot green uppe till vänster (menyknappen uppe till höger)', 'body.play-ui.range-ui #range-practice { top: 20px !important; left: 8px !important; right: 62px; transform: none !important;'],
  ['svingpillret döljs medan inspel är öppet (samma plats)', 'body.play-ui.range-ui:has(#range-practice.on) #swing-info { display: none !important; }'],
  ['sessionspanelen under, till vänster om kartan, ovanför slaget', 'body.play-ui.range-ui #range-session { top: 156px !important; bottom: auto !important; left: 8px; right: 108px !important; width: auto !important; max-height: calc(100vh - 156px - 260px) !important; }'],
  ['ihopfälld: bara rubriken', 'body.play-ui.range-ui #range-session.collapsed { right: auto !important; }'],
  ['med inspel öppet flyttas panelen och kartan ner', 'body.play-ui.range-ui:has(#range-practice.on) #range-session { top: 236px !important;'],
  ['(kartan döljs inte: en dold ruta ritas på datorns plats)', 'body.play-ui.range-ui:not(.mm-open):has(#range-practice.on) #minimap-container { top: 236px !important; }'],
  ['kort telefon: hela panelen rullar', 'body.play-ui.range-ui #range-session { overflow-y: auto !important; }\n      body.play-ui.range-ui #range-session .rs-body { flex: none; overflow: visible; }'],
  ['öppen karta: rangens paneler viker undan', 'body.play-ui.range-ui.mm-open #range-session,\n      body.play-ui.range-ui.mm-open #range-practice { display: none !important; }'],
  ['öppen session: siktet väntar', 'body.play-ui.range-ui:has(#range-session:not(.collapsed)) #aim-controls,\n      body.play-ui.range-ui:has(#range-session:not(.collapsed)) #aim-billboard { display: none !important; }']
].forEach(function (c) { check(c[0], blk.indexOf(c[1]) >= 0); });
{
  const rs = fs.readFileSync(path.join(__dirname, '..', 'arcade-range-session.js'), 'utf8');
  const line = rs.match(/try \{ const v = localStorage\.getItem\('golf_range_session_open'\);[^\n]+/);
  check('sessionspanelens öppna läge läses', !!line);
  if (line) {
    const open = function (phone, stored, throws) {
      const state = {};
      const win = { matchMedia: function () { return { matches: phone }; } };
      const ls = { getItem: function () { if (throws) throw new Error('blocked'); return stored; } };
      new Function('window', 'localStorage', 'state', "const phone = !!(window.matchMedia && window.matchMedia('(max-width: 520px), (max-height: 500px) and (orientation: landscape)').matches);\n" + line[0])(win, ls, state);
      return state.open;
    };
    check('telefon, inget sparat: ihopfälld', open(true, null) === false);
    check('dator, inget sparat: öppen', open(false, null) === true);
    check('spelarens val vinner (öppen på telefon, stängd på dator)', open(true, '1') === true && open(false, '0') === false);
    check('blockerad lagring: telefon ihopfälld, dator öppen', open(true, null, true) === false && open(false, null, true) === true);
    check('telefonfrågan står före raden', /const phone = !!\(window\.matchMedia && window\.matchMedia\('\(max-width: 520px\), \(max-height: 500px\) and \(orientation: landscape\)'\)\.matches\);\s*try \{ const v = localStorage/.test(rs));
  }
}

console.log('\n4c. Slagraden');
[
  ['klubbraden: bara klubban i handen tills den fälls ut', 'body.play-ui #club-selector:not(.clubs-open) .club-btn:not(.selected) { display: none; }'],
  ['◀ ▶ bredvid klubban, inte vid putt', 'body.play-ui:not(.phase-putt) #club-selector:not(.clubs-open) .club-step { display: flex; }'],
  ['den ihopfällda radens ruta tar inga tryck (formknappen bredvid går att trycka på)', 'body.play-ui #club-selector:not(.clubs-open) > * { pointer-events: auto; }'],
  ['slagformen: en knapp till höger om klubban', 'body.play-ui #shape-selector:not(.shapes-open) { bottom: 110px; left: auto; right: 8px; transform: none; }'],
  ['slagformen: bara formen i bruk tills den fälls ut', 'body.play-ui #shape-selector:not(.shapes-open) .shape-btn:not(.selected) { display: none; }'],
  ['rak är grå (draw/fade lyser)', 'body.play-ui #shape-selector:not(.shapes-open) .shape-btn.selected[data-shape="0"] { background: rgba(15,23,42,0.85);'],
  ['öppen form: lägesraden viker undan', 'body.play-ui:has(#shape-selector.shapes-open) #lie-conditions-hud { visibility: hidden; }'],
  ['öppen klubbrad: formknappen viker undan', 'body.play-ui:has(#club-selector.clubs-open) #shape-selector:not(.shapes-open) { display: none; }']
].forEach(function (c) { check(c[0], blk.indexOf(c[1]) >= 0); });
{
  const all = css.slice(0, css.indexOf('PHONE PLAY LAYOUT'));
  check('klubbraden centreras med .club-row:s marginaler, inte rullrutan (drivern klipptes bort)', /#club-selector \{[^}]*justify-content: flex-start;/.test(all) && all.indexOf('#club-selector .club-row { display: flex; flex: 0 0 auto; margin: 0 auto; }') >= 0);
  const row = html.slice(html.indexOf('<div id="club-selector"'), html.indexOf('<!-- Main swing launch button -->'));
  check('raden: ◀, knapparna i .club-row, ▶', /onclick="SwingEngine\.stepClub\(-1\)"[^>]*>◀<\/button>\s*<div class="club-row">/.test(row) && /<\/div>\s*<button class="club-step" data-step="1" onclick="SwingEngine\.stepClub\(1\)"/.test(row) && (row.match(/class="club-btn/g) || []).length === 9);
  const cl = css.slice(css.indexOf('PLAY CLEAN-UP'));
  check('klubbpillret bara med avståndet till flaggan (klubban står i raden)', cl.indexOf('body.play-ui #swing-info:has(#si-dist-label:empty) { display: none !important; }') >= 0);
  check('lägesbyte fäller ihop formen också', /if \(ss\) ss\.classList\.remove\('shapes-open'\);/.test(html));
}
// the handlers: on a phone a tap on the club / shape in use opens the row, a pick folds it
function tapRow(id, cls, open, selected, phone) {
  const m = html.match(new RegExp('<div id="' + id + '" onclick="([^"]+)">'));
  if (!m) return 'no handler';
  const list = new Set(open ? [cls + '-open'] : []);
  const self = { classList: { contains: function (c) { return list.has(c); }, add: function (c) { list.add(c); }, remove: function (c) { list.delete(c); } } };
  const btn = { classList: { contains: function (c) { return c === 'selected' && selected; } } };
  const g = global.document, gp = global.isPhonePlayLayout;
  global.document = { body: { classList: { contains: function () { return false; } } } };
  global.isPhonePlayLayout = function () { return phone; };
  try { new Function('event', m[1]).call(self, { target: { closest: function () { return btn; } }, stopPropagation: function () {} }); } finally { global.document = g; global.isPhonePlayLayout = gp; }
  return list.has(cls + '-open');
}
check('telefon: tryck på klubban i handen fäller ut raden, ett val fäller ihop den', tapRow('club-selector', 'clubs', false, true, true) === true && tapRow('club-selector', 'clubs', true, false, true) === false);
check('telefon: tryck på formen i bruk fäller ut formerna, ett val fäller ihop dem', tapRow('shape-selector', 'shapes', false, true, true) === true && tapRow('shape-selector', 'shapes', true, false, true) === false);
check('dator: raderna rörs inte', tapRow('club-selector', 'clubs', false, true, false) === false && tapRow('shape-selector', 'shapes', false, true, false) === false);

console.log('\n5. minimapBox');
const fnSrc = html.slice(html.indexOf('window.minimapBox = function () {'), html.indexOf('\n    };', html.indexOf('window.minimapBox = function () {')) + 7);
function box(el, canvasRect, cw) {
  const win = {}, doc = { getElementById: function () { return el; } };
  const renderer = { domElement: { clientWidth: cw, getBoundingClientRect: function () { return canvasRect; } } };
  new Function('window', 'document', 'renderer', fnSrc)(win, doc, renderer);
  return win.minimapBox();
}
// a computer, 1000 x 700: the container (220 x 340 inside a 2 px border) 20 px from the bottom right corner
const desk = box({ clientWidth: 220, clientHeight: 340, clientLeft: 2, clientTop: 2, getBoundingClientRect: function () { return { left: 756, top: 336 }; } }, { left: 0, bottom: 700 }, 1000);
check('dator: 220 x 340 innanför ramen, 22 px från nedre kanten', desk.x === 758 && desk.y === 22 && desk.w === 220 && desk.h === 340, JSON.stringify(desk));
// a phone, 390 x 844: the small box top right
const ph = box({ clientWidth: 88, clientHeight: 136, clientLeft: 2, clientTop: 2, getBoundingClientRect: function () { return { left: 290, top: 122 }; } }, { left: 0, bottom: 844 }, 390);
check('telefon: 88 x 136, y nerifrån (844 - 122 - 2 - 136)', ph.x === 292 && ph.y === 584 && ph.w === 88 && ph.h === 136, JSON.stringify(ph));
check('dold container: de gamla 220 x 340 nere till höger', JSON.stringify(box({ clientWidth: 0, clientHeight: 0 }, { left: 0, bottom: 700 }, 1000)) === JSON.stringify({ x: 760, y: 20, w: 220, h: 340 }));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
