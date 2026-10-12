// arcade.css must pin only the renderer's canvas to the viewport. A bare `canvas` rule once covered the whole screen with the 2D elevation-profile
// canvas (sky-blue background) whenever a putt was lined up. Run: node tests/test_arcade_css.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'arcade.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(root, 'arcade.html'), 'utf8');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) failed++; }

const rules = []; css.replace(/([^{}]+)\{([^{}]*)\}/g, function (m, sel, body) { rules.push({ sel: sel.trim(), body: body }); return m; });
const pinning = rules.filter(function (r) { return /position\s*:\s*fixed/.test(r.body) && /width\s*:\s*100%\s*!important/.test(r.body); });
check('a rule pins a canvas to the viewport', pinning.some(function (r) { return /canvas/.test(r.sel); }));
check('no pinning rule matches every canvas', pinning.every(function (r) { return !/(^|,)\s*canvas\s*(,|$)/.test(r.sel); }), pinning.map(function (r) { return r.sel; }).join(' | '));
check('the renderer canvas is a direct child of body', /document\.body\.appendChild\(renderer\.domElement\)/.test(html));
check('arcade.html loads the css version that has the fix', /arcade\.css\?v=(1[3-9]|[2-9]\d)/.test(html));
if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll arcade.css checks passed');
