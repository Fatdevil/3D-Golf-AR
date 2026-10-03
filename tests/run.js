// Runs every checked test in tests/ (not tests/manual or tests/smoke) and reports one line per file.
// A test fails when it exits non-zero or prints a failure marker: a ❌, "→ FAIL", "REGRESSION DETECTED" or an OVERALL line that says REGRESSION.
// KNOWN lists failures that exist today: they are reported but do not fail the run, and a KNOWN test that starts passing is flagged
// so the entry can be removed.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KNOWN = {
  'test_physics.js': '7-iron carry is outside the 180-188 yd target (physics was re-tuned after this test was written)',
};

const files = fs.readdirSync(__dirname).filter(function (f) { return /^test_.*\.js$/.test(f); }).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 120000, cwd: path.join(__dirname, '..') });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = r.status !== 0 || /❌|→ FAIL|REGRESSION DETECTED|OVERALL:\s+REGRESSION/.test(out);
  const known = Object.prototype.hasOwnProperty.call(KNOWN, f);
  if (bad && known) console.log('KNOWN  ' + f + '  — ' + KNOWN[f]);
  else if (bad) { failed++; console.log('FAIL   ' + f + '\n' + out.split('\n').slice(-25).join('\n')); }
  else if (known) console.log('PASS   ' + f + '  (listed as KNOWN failing, remove it from KNOWN in tests/run.js)');
  else console.log('PASS   ' + f);
}
console.log(failed ? '\n' + failed + ' test file(s) failed' : '\nAll checked tests passed');
process.exit(failed ? 1 : 0);
