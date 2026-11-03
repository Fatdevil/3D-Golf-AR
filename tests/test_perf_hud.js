/**
 * The frame-time meter (arcade-perf-hud.js): ?fps=1 turns it on and keeps it on, ?fps=0 off; off, nothing is made (PerfHud null).
 * On: the frame numbers (mean, frames per second, slowest), the main picture's numbers handed over after the main render, and the box.
 * Run: node tests/test_perf_hud.js
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}
const code = fs.readFileSync(path.join(__dirname, '..', 'arcade-perf-hud.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');

function load(search, stored) {
  const store = Object.assign({}, stored || {});
  const added = [];
  const doc = { body: { appendChild: function (el) { added.push(el); } }, createElement: function () { return { style: {} }; }, addEventListener: function () {} };
  const win = { location: { search: search } };
  const ctx = vm.createContext({ window: win, document: doc, URLSearchParams: URLSearchParams, requestAnimationFrame: function () {},
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } } });
  vm.runInContext(code, ctx);
  return { win: win, store: store, added: added };
}

console.log('1. Brytaren');
let p = load('');
check('utan ?fps: av, ingen ruta', p.win.PerfHud === null && p.added.length === 0);
p = load('?fps=1');
check('?fps=1: på, sparad, en ruta (fps-meter, inte byggets perf-hud)', !!p.win.PerfHud && p.store.golf_fps === '1' && p.added.length === 1 && p.added[0].id === 'fps-meter');
p = load('', { golf_fps: '1' });
check('sparad utan ?fps: på', !!p.win.PerfHud);
p = load('?course=X&fps=0', { golf_fps: '1' });
check('?fps=0: av och borttagen', p.win.PerfHud === null && !('golf_fps' in p.store));

console.log('\n2. Siffrorna');
p = load('?fps=1');
const st = p.win.PerfHud.stats([16, 17, 16, 50, 17]);
check('medel, bilder per sekund och värsta', Math.abs(st.mean - 23.2) < 1e-9 && Math.abs(st.fps - 1000 / 23.2) < 1e-9 && st.worst === 50, JSON.stringify(st));
check('inga bilder: inget', p.win.PerfHud.stats([]) === null);
p.win.PerfHud.mainPass({ info: { render: { calls: 42, triangles: 123456 } }, domElement: {} });
check('huvudbildens siffror tas emot', p.win._perfRenderer && true);

console.log('\n3. Kopplingen');
check('arcade.html laddar mätaren', /<script src="arcade-perf-hud\.js\?v=\d+"><\/script>/.test(html));
check('huvudbilden lämnar sina siffror direkt efter renderingen', /renderer\.render\(scene, camera\);\s*if \(window\.PerfHud\) window\.PerfHud\.mainPass\(renderer\);/.test(html));

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
