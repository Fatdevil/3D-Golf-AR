// glb-check.js: synthetic GLBs for each verdict, plus the real models in the repo root.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const G = require(path.join(root, 'glb-check.js'));

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }

// a GLB with a grid of `n` triangles (n+2 vertices strip), height `h`, width `w`, optional extras
function makeGlb(o) {
    o = Object.assign({ tris: 1000, h: 1, w: 0.8, material: { pbrMetallicRoughness: { baseColorFactor: [0.2, 0.7, 0.2, 1] } }, json: {} }, o);
    const nv = o.tris + 2, pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { pos[i * 3] = (i % 2) * o.w; pos[i * 3 + 1] = (i / (nv - 1)) * o.h; pos[i * 3 + 2] = ((i >> 1) % 2) * o.w; }
    const idx = new Uint32Array(o.tris * 3);
    for (let t = 0; t < o.tris; t++) { idx[t * 3] = t; idx[t * 3 + 1] = t + 1; idx[t * 3 + 2] = t + 2; }
    const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
    const json = Object.assign({
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [o.material],
        accessors: [{ bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
        buffers: [{ byteLength: bin.length }]
    }, o.json);
    let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
    const b = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
    const head = Buffer.alloc(12), c1 = Buffer.alloc(8), c2 = Buffer.alloc(8);
    head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + b.length, 8);
    c1.writeUInt32LE(js.length, 0); c1.write('JSON', 4); c2.writeUInt32LE(b.length, 0); c2.write('BIN\0', 4);
    return Buffer.concat([head, c1, js, c2, b]);
}

(async () => {
    const run = (o, opts) => G.check(makeGlb(o), opts || { kind: 'tree' });
    const has = (r, id, level) => r.checks.some(c => c.id === id && (!level || c.level === level));

    let r = await run({ tris: 600 }, { kind: 'plant' });
    check('small plant is ok', r.verdict === 'ok' && r.facts.triangles === 600, r.verdict + ' ' + JSON.stringify(r.checks.filter(c => c.level !== 'ok')));

    r = await run({ tris: 3500 });
    check('tris between the limits warn', r.verdict === 'warn' && has(r, 'tris', 'warn'), r.verdict);

    r = await run({ tris: 30000 });
    check('too many triangles fail', r.verdict === 'fail' && has(r, 'tris', 'fail'), r.verdict);

    r = await run({ tris: 1500, h: 0.1, w: 1 });
    check('flat, wide tree is flagged', has(r, 'shape') && r.checks.find(c => c.id === 'shape').level !== 'ok', JSON.stringify(r.checks.map(c => c.id + ':' + c.level)));

    r = await run({ tris: 1500, json: { extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'] } });
    check('required meshopt fails (game has no decoder)', r.verdict === 'fail' && !r.loadable, r.verdict);

    r = await run({ tris: 1500 }, { kind: 'rock' });
    check('kind rock uses the rock profile', r.kind === 'rock' && r.verdict !== 'fail', r.verdict);

    r = await G.check(Buffer.from('not a glb at all, really not'), {});
    check('garbage is a fail, not a crash', r.verdict === 'fail' && !r.loadable, r.verdict);

    r = await run({ tris: 600, json: { buffers: [{ byteLength: 99999999 }] } }, { kind: 'plant' });
    check('JSON promising more binary than the file has is not loadable', r.verdict === 'fail' && !r.loadable && has(r, 'binary', 'fail'), r.verdict);

    r = await run({ tris: 600, json: { accessors: [{ bufferView: 0, componentType: 5126, count: 99999, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }, { bufferView: 1, componentType: 5125, count: 1800, type: 'SCALAR' }] } }, { kind: 'plant' });
    check('accessor reading outside its bufferView is not loadable', r.verdict === 'fail' && has(r, 'binary', 'fail'), r.verdict);

    r = await run({ tris: 600, json: { meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }, { attributes: { POSITION: 0 }, indices: 1, material: 0 }, { attributes: { POSITION: 0 }, indices: 1, material: 0 }] }] } }, { kind: 'plant' });
    check('each primitive counts as a draw call', r.facts.meshes === 3, String(r.facts.meshes));

    r = await run({ tris: 600, json: { buffers: [{ byteLength: 12, uri: 'foo.bin' }] } }, { kind: 'plant' });
    check('external buffer file is not loadable', r.verdict === 'fail' && !r.loadable, r.verdict);

    const lie = makeGlb({ tris: 600 }); lie.writeUInt32LE(lie.length + 1000, 8);
    r = await G.check(lie, { kind: 'plant' });
    check('header length beyond the file fails', r.verdict === 'fail' && !r.loadable, r.verdict);

    r = await run({ tris: 600, json: { asset: { version: '1.0' } } }, { kind: 'plant' });
    check('glTF 1.0 JSON fails', r.verdict === 'fail' && !r.loadable, r.verdict);

    r = await run({ tris: 600, json: { meshes: [{}] } }, { kind: 'plant' });
    check('malformed JSON structure is a fail, not an exception', r.verdict === 'fail' && !r.loadable, r.verdict);

    r = await run({ tris: 600, json: { scenes: [] } }, { kind: 'plant' });
    check('no default scene is not loadable', r.verdict === 'fail' && !r.loadable, r.verdict);
    r = await run({ tris: 600, json: { scene: 5 } }, { kind: 'plant' });
    check('scene index outside the list is not loadable', r.verdict === 'fail' && !r.loadable, r.verdict);

    r = await G.check(makeGlb({ tris: 600, material: {} }), { kind: 'plant' });
    check('default material counts as a material', r.facts.materials === 1, String(r.facts.materials));

    r = await G.check(makeGlb({ tris: 600, json: { images: [{ bufferView: 0, mimeType: 'image/png' }], textures: [{ source: 0 }] }, material: { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } }),
        { kind: 'plant', sampleImage: () => Promise.reject(new Error('bad image')) });
    check('texture that cannot be decoded is not loadable', r.verdict === 'fail' && !r.loadable && has(r, 'decode', 'fail'), r.verdict);

    r = await G.check(makeGlb({ tris: 100 }).subarray(0, 40), {});
    check('truncated file is a fail, not a crash', r.verdict === 'fail', r.verdict);

    // the models that are in the repo
    for (const f of ['Oaktree.glb', 'cactus_1.glb', 'palm3.glb']) {
        const p = path.join(root, f);
        if (!fs.existsSync(p)) continue;
        const res = await G.check(fs.readFileSync(p), { kind: 'tree' });
        check(f + ' parses and has numbers', res.loadable && res.facts.triangles > 0 && res.facts.fileBytes === fs.statSync(p).size, JSON.stringify(res.facts));
    }

    const rep = G.formatReport(await run({ tris: 1500 }), { colour: false });
    check('report is text', typeof rep === 'string' && rep.length > 20, rep);

    if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
})();
