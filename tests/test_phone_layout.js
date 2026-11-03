/**
 * Telefonlayouten under en runda på en bana (steg 1): nederkanten tillhör slaget, resten ovanför eller ihopfällt.
 * 1. arcade.html: setMode sätter body.play-ui (spel/test) och body.range-ui (rangen), och tar bort mm-open utanför spel.
 * 2. Minikartan ritas i containerns ruta (minimapBox), inte i fasta 220 x 340: viewport, inramning och linjerna ovanpå.
 * 3. ⤢ öppnar/stänger kartan; på telefon öppnar ett tryck på den lilla rutan den i stället för att sikta.
 * 4. arcade.css: blocket för telefon (max 520 px, play-ui utan range-ui) med raderna för varje panel.
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
check('ett block för max 520 px', /@media \(max-width: 520px\)/.test(blk));
const sel = 'body.play-ui:not(.range-ui)';
[
  ['slagrutorna: en rad, dolda utan värden, två tills de öppnas', ['#dynamic-hud { top: 122px', '#dynamic-hud:not(.has-data) { display: none !important; }', '#dynamic-hud:not(.dh-open) .dh-tile:nth-child(n+3) { display: none; }']],
  ['lägespanelen: en rad ovanför slagformen, utan etiketter', ['#lie-conditions-hud { bottom: 222px !important;', '#lie-conditions-hud .lie-lbl { display: none; }']],
  ['minikartan: liten ruta uppe till höger, full storlek öppen', ['#minimap-container { top: 122px !important; bottom: auto !important; right: 8px !important; width: 88px !important; height: 136px !important;']],
  ['flyover/lutning under den lilla kartan', ['#green-read-panel { top: 266px !important;']],
  ['LM-status bara med launch monitor', [':not(.input-lm) #lm-status { display: none !important; }']]
].forEach(function (c) { check(c[0], c[1].every(function (s) { return blk.indexOf(s) >= 0; })); });
check('rader för öppen karta: full storlek, höjdprofil under, paneler som skulle täcka den dolda',
  blk.indexOf('body.play-ui.mm-open:not(.range-ui) #minimap-container { width: 220px !important; height: 340px !important;') >= 0 &&
  blk.indexOf('body.play-ui:not(.mm-open):not(.range-ui) #elevation-profile-container { display: none !important; }') >= 0 &&
  /body\.play-ui\.mm-open:not\(\.range-ui\) #green-read-panel,\s*body\.play-ui\.mm-open:not\(\.range-ui\) #dynamic-hud \{ display: none !important; \}/.test(blk));
check('allt i blocket gäller bara en runda på en bana (play-ui, inte range-ui)', blk.split('\n').filter(function (l) { return /^\s+body/.test(l); }).every(function (l) { return /body\.play-ui(\.mm-open)?(:not\(\.mm-open\))?:not\(\.range-ui\)/.test(l); }));

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
