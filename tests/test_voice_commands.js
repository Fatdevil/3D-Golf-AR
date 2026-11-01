// Voice commands: what the recogniser writes (Swedish and English, with the usual slips) turns into the right builder command.
const { parse } = require('../voice-commands.js');

let failed = 0;
function expectCmd(text, action, value) {
  const c = parse(text);
  const ok = c && c.action === action && (value === undefined || c.value === value);
  console.log((ok ? '✅ ' : '❌ ') + JSON.stringify(text) + ' -> ' + JSON.stringify(c) + (ok ? '' : '   expected ' + action + (value !== undefined ? ' ' + value : '')));
  if (!ok) failed++;
}
function expectNone(text) {
  const c = parse(text);
  console.log((c === null ? '✅ ' : '❌ ') + JSON.stringify(text) + ' -> ' + JSON.stringify(c) + (c === null ? '' : '   expected no command'));
  if (c !== null) failed++;
}

// the parts of a hole, both languages, with the verbs people use
[['change green', 'GREEN'], ['Ändra green', 'GREEN'], ['öppna greenen', 'GREEN'], ['open the green', 'GREEN'], ['green', 'GREEN'],
 ['ändra fairway', 'FAIRWAY'], ['change fairway', 'FAIRWAY'], ['fairwayen', 'FAIRWAY'],
 ['bunker', 'BUNKER'], ['lägg en bunker', 'BUNKER'], ['ändra bunkern', 'BUNKER'], ['open bunkers', 'BUNKER'],
 ['tee', 'TEE'], ['ändra teebox', 'TEE'], ['change tee box', 'TEE'], ['utslagsplats', 'TEE']
].forEach(function (p) { expectCmd(p[0], 'component', p[1]); });

// the toolbar
[['forma', 'SCULPT'], ['sculpt', 'SCULPT'], ['terräng', 'SCULPT'], ['måla', 'PAINT'], ['paint', 'PAINT'], ['vatten', 'WATER'], ['water', 'WATER'],
 ['objekt', 'PROPS'], ['objects', 'PROPS'], ['träd', 'PROPS'], ['miljö', 'ENV'], ['environment', 'ENV'], ['markera', 'INSPECT'], ['inspect', 'INSPECT'],
 ['smart builder', 'SMART_BUILDER'], ['bygg hål', 'SMART_BUILDER'], ['hole tool', 'SMART_BUILDER']
].forEach(function (p) { expectCmd(p[0], 'tool', p[1]); });

expectCmd('ångra', 'undo'); expectCmd('undo', 'undo'); expectCmd('gör om', 'redo'); expectCmd('redo', 'redo');
expectCmd('nästa hål', 'hole', 1); expectCmd('next hole', 'hole', 1); expectCmd('föregående hål', 'hole', -1); expectCmd('previous hole', 'hole', -1);
expectCmd('spara', 'save'); expectCmd('save', 'save'); expectCmd('save the course', 'save');
expectCmd('hjälp', 'help'); expectCmd('help', 'help'); expectCmd('sluta lyssna', 'stop'); expectCmd('stop listening', 'stop');

// leaving the builder takes the whole phrase
expectCmd('spara och spela', 'saveplay'); expectCmd('save and play', 'saveplay'); expectCmd('testa banan', 'saveplay'); expectCmd('play the course', 'saveplay');
expectNone('spela'); expectNone('play'); expectNone('let us play golf tomorrow');

// ordinary talk holds no command
expectNone(''); expectNone('hello there'); expectNone('jag tror att det blir regn'); expectNone(null);

// the range: approach practice (parseRange), what a launch monitor player says at the mat
const { parseRange } = require('../voice-commands.js');
function expectRange(text, want) {
  const c = parseRange(text), ok = JSON.stringify(c) === JSON.stringify(want);
  console.log((ok ? '✅ ' : '❌ ') + 'range ' + JSON.stringify(text) + ' -> ' + JSON.stringify(c) + (ok ? '' : '   expected ' + JSON.stringify(want)));
  if (!ok) failed++;
}
expectRange('75 meter', { action: 'dist', value: 75, unit: 'm' });
expectRange('75 m', { action: 'dist', value: 75, unit: 'm' });
expectRange('120 yards', { action: 'dist', value: 120, unit: 'yd' });
expectRange('avstånd 90', { action: 'dist', value: 90, unit: null });
expectRange('150', { action: 'dist', value: 150, unit: null });
expectRange('sjuttiofem meter', { action: 'dist', value: 75, unit: 'm' });
expectRange('sjuttiofem', { action: 'dist', value: 75, unit: null });   // ends in m, but no metre
expectRange('75m', { action: 'dist', value: 75, unit: 'm' });
expectRange('130yd', { action: 'dist', value: 130, unit: 'yd' });
expectRange('etthundrafemtio', { action: 'dist', value: 150, unit: null });
expectRange('hundratjugofem meter', { action: 'dist', value: 125, unit: 'm' });
expectRange('a hundred and fifty yards', { action: 'dist', value: 150, unit: 'yd' });
expectRange('sixty five', { action: 'dist', value: 65, unit: null });
expectRange('green två', { action: 'green', value: 2 });
expectRange('Green 3', { action: 'green', value: 3 });
expectRange('green two', { action: 'green', value: 2 });
expectRange('green to', { action: 'green', value: 2 });
expectRange('matta', { action: 'lie', value: 'mat' });
expectRange('the mat', { action: 'lie', value: 'mat' });
expectRange('som marken', { action: 'lie', value: 'ground' });
expectRange('as it lies', { action: 'lie', value: 'ground' });
expectRange('starta test', { action: 'test' });
expectRange('start the test', { action: 'test' });
expectRange('kör igen', { action: 'again' });
expectRange('go again', { action: 'again' });
expectRange('avbryt', { action: 'cancel' });
expectRange('stäng', { action: 'close' });
expectRange('back to the range', { action: 'close' });
expectRange('inspel', { action: 'open' });
expectRange('hjälp', { action: 'help' });
// talk at the mat: a number inside a sentence, a club number, a distance too short or too long is no command
expectRange('jag slog 150 i går', null);
expectRange('sju', null);
expectRange('7', null);
expectRange('900 meter', null);
expectRange('vilket bra slag', null);
// the builder's words are not range commands
expectRange('ändra fairway', null);

console.log(failed ? '\n' + failed + ' voice command check(s) failed' : '\nVoice commands: all checks passed');
process.exit(failed ? 1 : 0);
