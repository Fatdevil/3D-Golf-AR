#!/usr/bin/env node
// Usage: node tools/check-glb.js [--kind tree|plant|rock|landscape|prop] [--instances N] [--json] <file.glb|folder> ...
// Exit code 1 if any model gets a FAIL, so it can sit in a batch script after Meshy exports.
const fs = require('fs');
const path = require('path');
const GlbCheck = require('../glb-check.js');

const args = process.argv.slice(2);
const opts = {};
let json = false;
const targets = [];
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--kind') opts.kind = args[++i];
    else if (a === '--instances') opts.instances = parseInt(args[++i], 10);
    else if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 3).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
    else targets.push(a);
}
if (opts.kind && !GlbCheck.PROFILES[opts.kind]) { console.error('Unknown kind: ' + opts.kind + ' (' + Object.keys(GlbCheck.PROFILES).join(', ') + ')'); process.exit(2); }
if (!targets.length) { console.error('Give at least one .glb file or folder.'); process.exit(2); }

const files = [];
for (const t of targets) {
    if (fs.existsSync(t) && fs.statSync(t).isDirectory()) fs.readdirSync(t).filter(f => /\.glb$/i.test(f)).sort().forEach(f => files.push(path.join(t, f)));
    else files.push(t);
}

(async () => {
    const out = [];
    let failed = 0, totalMB = 0;
    for (const f of files) {
        let r;
        try {
            const buf = fs.readFileSync(f);
            totalMB += buf.length / 1048576;
            r = await GlbCheck.check(buf, opts);
        } catch (e) {
            r = { verdict: 'fail', checks: [{ id: 'read', level: 'fail', message: e.message }] };
        }
        if (r.verdict === 'fail') failed++;
        out.push({ file: f, result: r });
        if (!json) {
            const tag = { ok: 'OK  ', warn: 'VARNING', fail: 'FEL ' }[r.verdict];
            console.log('\n' + tag + ' ' + f + (r.kind ? '  (' + r.kind + ')' : ''));
            console.log(GlbCheck.formatReport(r, { colour: process.stdout.isTTY }));
        }
    }
    if (json) console.log(JSON.stringify(out, null, 2));
    else if (files.length > 1) console.log('\n' + files.length + ' filer, ' + failed + ' med fel, totalt ' + totalMB.toFixed(1) + ' MB (budget ' + GlbCheck.TOTAL_BUDGET_MB + ' MB per biom)');
    process.exit(failed ? 1 : 0);
})();
