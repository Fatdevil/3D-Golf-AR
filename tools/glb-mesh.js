// Reads the triangles of a .glb in the frame the game sees them (node transforms applied), for tools and tests.
// Float POSITION with plain or Draco-free storage only; returns null positions with a reason when the file stores them another way.
const GlbCheck = require('../glb-check.js');

function mul(a, b) {   // column-major 4x4, a * b
    const o = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k]; o[j * 4 + i] = s; }
    return o;
}
function local(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [
        (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
        (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
        (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1
    ];
}
function apply(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

function readAccessor(json, bin, ai) {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const stride = v.byteStride || comps * size, base = (v.byteOffset || 0) + (a.byteOffset || 0);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), out = new Array(a.count * comps);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
        const o = base + i * stride + c * size;
        out[i * comps + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true)
            : a.componentType === 5123 ? dv.getUint16(o, true) : a.componentType === 5121 ? dv.getUint8(o) : a.componentType === 5122 ? dv.getInt16(o, true) : dv.getInt8(o);
    }
    return out;
}

// returns { positions, indices, bbox } (bbox: the box three.js makes from the geometry boxes, which is what the game normalises with)
function glbMesh(buffer) {
    const { json, bin } = GlbCheck.parseGlb(buffer);
    if (!bin) throw new Error('GLB utan binärdel.');
    const positions = [], indices = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const scene = (json.scenes || [])[json.scene || 0];
    if (!scene) throw new Error('GLB utan standardscen.');
    function visit(ni, parent) {
        const n = json.nodes[ni], m = mul(parent, local(n));
        if (n.mesh !== undefined) {
            json.meshes[n.mesh].primitives.forEach(function (p) {
                if (p.mode !== undefined && p.mode !== 4) return;
                if (p.extensions && p.extensions.KHR_draco_mesh_compression) throw new Error('Draco-komprimerad modell: hörnen går inte att läsa här.');
                const pa = json.accessors[p.attributes.POSITION];
                if (pa.componentType !== 5126) throw new Error('POSITION lagras inte som flyttal.');
                const raw = readAccessor(json, bin, p.attributes.POSITION), base = positions.length / 3;
                for (let i = 0; i < pa.count; i++) { const w = apply(m, [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]); positions.push(w[0], w[1], w[2]); }
                if (pa.min && pa.max) {
                    for (let c = 0; c < 8; c++) {
                        const w = apply(m, [c & 1 ? pa.max[0] : pa.min[0], c & 2 ? pa.max[1] : pa.min[1], c & 4 ? pa.max[2] : pa.min[2]]);
                        for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
                    }
                }
                if (p.indices !== undefined) { const ix = readAccessor(json, bin, p.indices); for (let i = 0; i < ix.length; i++) indices.push(ix[i] + base); }
                else for (let i = 0; i < pa.count; i++) indices.push(base + i);
            });
        }
        (n.children || []).forEach(function (c) { visit(c, m); });
    }
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    scene.nodes.forEach(function (n) { visit(n, I); });
    return { positions: positions, indices: indices, bbox: isFinite(min[0]) ? { min: min, max: max } : null };
}

module.exports = { glbMesh };
