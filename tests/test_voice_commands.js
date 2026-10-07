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

console.log(failed ? '\n' + failed + ' voice command check(s) failed' : '\nVoice commands: all checks passed');
process.exit(failed ? 1 : 0);
