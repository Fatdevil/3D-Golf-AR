// Ball tracer (arcade-tracer-engine.js, no browser): the fade after landing follows wall-clock time, and the Phantom style dims toward its tail.
// Run: node tests/test_tracer.js
const fs = require('fs'), path = require('path'), vm = require('vm');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

let now = 1000;
const win = { tracerMat: { opacity: 0.9, color: { set() {} }, needsUpdate: false }, glowTracerMat: { opacity: 0.3 } };
const ctx = { window: win, performance: { now: function () { return now; } }, document: { querySelectorAll: function () { return []; }, getElementById: function () { return null; } }, THREE: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-tracer-engine.js'), 'utf8'), ctx);

console.log('Fade after landing is wall-clock time');
win.tracerFadeMode = 'FADE'; win.startTracerFade();
now += 1500; win.updateTracerFade();   // one frame, 1.5 s later: halfway
check('halfway after 1.5 s even though only one frame ran', Math.abs(win.tracerMat.opacity - 0.45) < 0.01, String(win.tracerMat.opacity));
for (let i = 0; i < 200; i++) win.updateTracerFade();   // many frames at the same instant do not speed it up
check('more frames at the same time change nothing', Math.abs(win.tracerMat.opacity - 0.45) < 0.01, String(win.tracerMat.opacity));
now += 1500; win.updateTracerFade();
check('gone after 3 s', win.tracerMat.opacity === 0 && win._tracerFadeTimer === -1, win.tracerMat.opacity + ' ' + win._tracerFadeTimer);
win.tracerFadeMode = 'SOLID'; win.tracerMat.opacity = 0.9; win._tracerFadeTimer = -1; win.startTracerFade(); now += 5000; win.updateTracerFade();
check('SOLID never fades', win.tracerMat.opacity === 0.9, String(win.tracerMat.opacity));

console.log('\nPhantom dims toward the tail');
const col = new Float32Array(4 * 1000);
const vc = win.getTracerVertexColor('fade', 0, 1000);
check('the fade style returns an rgba colour', vc.length === 4 && vc[3] === 1, JSON.stringify(vc));
win.applyTracerTailFade(col, 1000);
check('the newest vertex is fully opaque', col[999 * 4 + 3] === 1, String(col[999 * 4 + 3]));
check('the alpha falls with age', col[900 * 4 + 3] < col[999 * 4 + 3] && col[500 * 4 + 3] < col[900 * 4 + 3], [col[900 * 4 + 3], col[500 * 4 + 3]].join(' '));
check('the oldest keeps a faint ghost, not zero', col[3] > 0.05 && col[3] < 0.2, String(col[3]));
check('other styles keep their colours', win.getTracerVertexColor('fire', 10, 100).length === 3 && win.getTracerVertexColor(null, 1, 2) === null);

if (failed) { console.log('\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)'); process.exit(1); }
console.log('\nOVERALL:  ✅ ALL PASS');
