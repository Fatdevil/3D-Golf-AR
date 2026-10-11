#!/usr/bin/env node
// Usage: node tools/fit-hitbox.js [--height 15] [--json] <file.glb> ...
// Fits the collision profile (hitbox-fit.js) to each model and prints it: the same numbers the admin page's "Fit collision shape" button
// saves. --json prints the physics object that goes into an asset's config. Not for Draco-compressed models (the vertices are not readable).
const fs = require('fs');
const HitboxFit = require('../hitbox-fit.js');
const { glbMesh } = require('./glb-mesh.js');

const args = process.argv.slice(2);
let height = 15, json = false;
const files = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--height') height = parseFloat(args[++i]);
    else if (args[i] === '--json') json = true;
    else files.push(args[i]);
}
if (!files.length || !(height > 0)) { console.error('Give at least one .glb file (and a positive --height).'); process.exit(2); }

let bad = 0;
const all = {};
for (const f of files) {
    try {
        const m = glbMesh(fs.readFileSync(f)), p = HitboxFit.fit(m, { targetHeight: height, bbox: m.bbox });
        all[f] = p;
        if (!json) {
            console.log('\n' + f + '  (höjd ' + height + ' m)');
            console.log('  ' + HitboxFit.describe(p));
            p.slices.forEach(s => console.log('  ' + s.y0.toFixed(1).padStart(5) + '–' + s.y1.toFixed(1).padEnd(5) + ' m  r ' + s.r.toFixed(2).padStart(5) + '  mitt (' + s.cx.toFixed(2) + ', ' + s.cz.toFixed(2) + ')'));
        }
    } catch (e) { bad++; console.error(f + ': ' + e.message); }
}
if (json) console.log(JSON.stringify(files.length === 1 ? all[files[0]] : all, null, 2));
process.exit(bad ? 1 : 0);
