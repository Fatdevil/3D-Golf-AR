// GLB asset check: reads a .glb (no dependencies) and says whether the game can take it and what it will cost.
// Runs in Node (tools/check-glb.js) and in the browser (the admin page). What it measures follows what arcade.html does with a model:
//  - the model is scaled so its HEIGHT is the asset's targetHeight, centred in x/z, with the base on the ground (so the size and the pivot
//    of the file do not matter, but a flat or very wide model gets absurd sizes);
//  - every mesh in the model becomes one InstancedMesh (one draw call per mesh and tree type), with frustumCulled = false: every placed
//    instance is always drawn, so triangles x placed instances is the real cost;
//  - TREES, PLANTS, ROCKS and LANDSCAPE get a fragment shader that re-colours by the biome: texels that are brown or grey count as
//    "trunk", near-white as "snow" (left alone), everything else (green, but also pink, blue ...) as "foliage";
//  - metalness and roughness maps are thrown away (metalness 0, roughness 1), the loader is GLTFLoader r128 with Draco but without the
//    Meshopt and KTX2 decoders.
// The budgets in PROFILES are suggestions, not limits in the code: change them here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GlbCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MB = 1024 * 1024;

  // suggested budgets per kind: triangles, file size, texture size (longest side), texture memory on the GPU, draw calls (meshes), materials,
  // widest-to-height ratio (the game scales by height) and how many instances to count the scene cost for
  var PROFILES = {
    tree:      { tris: [2000, 5000],  fileMB: [1.5, 5], tex: [1024, 2048], gpuMB: [8, 24], meshes: [3, 8], materials: [3, 6], aspect: 2.5, instances: 300 },
    plant:     { tris: [800, 2500],   fileMB: [1, 3],   tex: [1024, 2048], gpuMB: [6, 16], meshes: [2, 6], materials: [2, 4], aspect: 4,   instances: 500 },
    rock:      { tris: [1000, 3000],  fileMB: [1, 3],   tex: [1024, 2048], gpuMB: [6, 16], meshes: [2, 6], materials: [2, 4], aspect: 4,   instances: 150 },
    landscape: { tris: [5000, 15000], fileMB: [3, 8],   tex: [2048, 4096], gpuMB: [16, 48], meshes: [4, 10], materials: [4, 8], aspect: 0,  instances: 20 },
    prop:      { tris: [2000, 8000],  fileMB: [2, 6],   tex: [1024, 2048], gpuMB: [8, 24], meshes: [4, 10], materials: [4, 8], aspect: 0,   instances: 50 }
  };
  // the cost of the whole scene for the instances above (triangles): above the first value is a warning, above the second a failure
  var SCENE_TRIS = [600000, 1500000];
  // the admin page's subcategory -> a kind
  var KIND_OF_SUBCAT = { TREES: 'tree', PLANTS: 'plant', ROCKS: 'rock', LANDSCAPE: 'landscape', BLOCKS: 'prop' };
  var TOTAL_BUDGET_MB = 40;   // arcade.html: MAX_ASSET_BUDGET_MB (all assets of a biome)
  var TOTAL_GPU_BUDGET_MB = 128;   // a suggestion, not measured on a device: the decoded textures of all assets of a biome (global + the biome) on a mid-range phone

  // glTF extensions the game's loader handles: GLTFLoader r128 plus the Draco decoder. Meshopt and KTX2 need decoders the game does not set.
  var SUPPORTED_EXT = ['KHR_draco_mesh_compression', 'KHR_lights_punctual', 'KHR_materials_clearcoat', 'KHR_materials_pbrSpecularGlossiness',
    'KHR_materials_transmission', 'KHR_materials_unlit', 'KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp'];
  var UNSUPPORTED_EXT = { EXT_meshopt_compression: 'Meshopt-komprimering (spelet har ingen Meshopt-avkodare)', KHR_texture_basisu: 'KTX2-texturer (spelet har ingen KTX2-avkodare)' };

  // ---------------------------------------------------------------- reading the file
  function toBytes(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf && buf.buffer instanceof ArrayBuffer && typeof buf.byteLength === 'number') return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new Uint8Array(buf);
  }
  function utf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  function parseGlb(buf) {
    var bytes = toBytes(buf), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 20) throw new Error('Filen är för liten för att vara en GLB.');
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Inte en GLB-fil (saknar "glTF" i början). Är det en .gltf eller en annan filtyp?');
    var version = dv.getUint32(4, true), total = dv.getUint32(8, true);
    if (version !== 2) throw new Error('GLB version ' + version + ' stöds inte (bara 2).');
    if (total < 20 || total > bytes.byteLength) throw new Error('GLB-filen är trasig (rubriken säger ' + total + ' byte men filen har ' + bytes.byteLength + ').');
    var off = 12, json = null, bin = null;
    while (off + 8 <= total) {
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), start = off + 8;
      if (start + len > bytes.byteLength) throw new Error('GLB-filen är trasig (en bit är längre än filen).');
      if (type === 0x4E4F534A && !json) json = JSON.parse(utf8(bytes.subarray(start, start + len)));
      else if (type === 0x004E4942 && !bin) bin = bytes.subarray(start, start + len);
      off = start + len + ((4 - (len % 4)) % 4);
    }
    if (!json) throw new Error('GLB-filen har ingen JSON-del.');
    if (!json.asset || String(json.asset.version || '0')[0] < '2') throw new Error('glTF-versionen i JSON-delen saknas eller är under 2.0 (spelets laddare avvisar den).');
    return { json: json, bin: bin, bytes: bytes, declaredLength: total };
  }

  // ---------------------------------------------------------------- transforms
  function mul(a, b) {   // column-major 4x4: a * b
    var o = new Array(16), i, j, k;
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) { var s = 0; for (k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k]; o[j * 4 + i] = s; }
    return o;
  }
  function localMatrix(n) {
    if (n.matrix && n.matrix.length === 16) return n.matrix.slice();
    var t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    var x = q[0], y = q[1], z = q[2], w = q[3];
    return [
      (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
      (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
      (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
      t[0], t[1], t[2], 1];
  }
  function applyPoint(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }

  // ---------------------------------------------------------------- images: size from the header, no decoding
  function imageInfo(bytes, mime) {
    function u32be(o) { return ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0; }
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return { width: u32be(16), height: u32be(20), type: 'png', alpha: bytes[25] === 4 || bytes[25] === 6 };
    }
    if (bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {   // JPEG: find a start-of-frame marker
      var o = 2;
      while (o + 9 < bytes.length) {
        if (bytes[o] !== 0xFF) { o++; continue; }
        var m = bytes[o + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { width: (bytes[o + 7] << 8) | bytes[o + 8], height: (bytes[o + 5] << 8) | bytes[o + 6], type: 'jpeg', alpha: false };
        o += 2 + ((bytes[o + 2] << 8) | bytes[o + 3]);
      }
    }
    if (bytes.length > 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {   // WebP
      var fmt = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (fmt === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)), type: 'webp', alpha: !!(bytes[20] & 0x10) };
      if (fmt === 'VP8 ') return { width: (bytes[26] | (bytes[27] << 8)) & 0x3FFF, height: (bytes[28] | (bytes[29] << 8)) & 0x3FFF, type: 'webp', alpha: false };
      if (fmt === 'VP8L') { var b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]; return { width: 1 + (((b1 & 0x3F) << 8) | b0), height: 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)), type: 'webp', alpha: true }; }
    }
    return { width: 0, height: 0, type: mime || '?', alpha: false };
  }

  // the numbers below come from the JSON; make sure the binary part really holds what the JSON says (GLTFLoader fails on a short buffer)
  function validateBinary(j, bin, out) {
    var buffers = j.buffers || [], views = j.bufferViews || [], accessors = j.accessors || [];
    var CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, TN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    function bad(msg) { if (out.length < 5) out.push(msg); else if (out.length === 5) out.push('...'); }
    var real = buffers.map(function (b) { return b.byteLength; });   // bytes each buffer really holds
    buffers.forEach(function (b, i) {
      if (typeof b.uri === 'string' && b.uri.indexOf('data:') === 0) {
        var comma = b.uri.indexOf(','), payload = comma < 0 ? '' : b.uri.slice(comma + 1);
        if (comma < 0 || b.uri.slice(0, comma).indexOf(';base64') < 0) { bad('buffer ' + i + ' har en data-URI som inte är base64'); return; }
        var p64 = payload.length % 4 === 0 ? payload.replace(/={1,2}$/, '') : payload;   // atob: padding only on a full group
        if (!/^[A-Za-z0-9+\/]*$/.test(p64) || p64.length % 4 === 1) { bad('buffer ' + i + ' har ogiltig base64 i sin data-URI'); return; }
        real[i] = Math.floor(p64.length * 3 / 4);
        if (real[i] < b.byteLength) bad('buffer ' + i + ' är ' + b.byteLength + ' byte enligt JSON men data-URI:n har ' + real[i]);
      }
      if (b.uri === undefined && i > 0) bad('buffer ' + i + ' saknar uri och en GLB kan bara ha sin första buffer i BIN-delen');
      if (typeof b.uri === 'string' && b.uri.indexOf('data:') !== 0) bad('buffer ' + i + ' ligger i en extern fil (' + b.uri.slice(0, 40) + ')');
      if (b.uri === undefined && i === 0 && (!bin || bin.length < b.byteLength)) bad('buffer ' + i + ' är ' + b.byteLength + ' byte enligt JSON men binärdelen har ' + (bin ? bin.length : 0));
    });
    views.forEach(function (v, i) {
      var b = buffers[v.buffer];
      if (!b) bad('bufferView ' + i + ' pekar på en buffer som inte finns');
      else if ((v.byteOffset || 0) + v.byteLength > Math.min(b.byteLength, real[v.buffer])) bad('bufferView ' + i + ' går utanför sin buffer');
    });
    accessors.forEach(function (a, i) {
      if (!CS[a.componentType] || !TN[a.type]) return bad('accessor ' + i + ' har en okänd componentType eller type');
      if (a.bufferView === undefined) return;
      var v = views[a.bufferView];
      if (!v) return bad('accessor ' + i + ' pekar på en bufferView som inte finns');
      var elem = CS[a.componentType] * TN[a.type], stride = v.byteStride || elem;
      if (a.count > 0 && (a.byteOffset || 0) + (a.count - 1) * stride + elem > v.byteLength) bad('accessor ' + i + ' läser utanför sin bufferView');
    });
  }

  // ---------------------------------------------------------------- the measurements
  function measure(parsed) {
    var j = parsed.json, bin = parsed.bin, bytes = parsed.bytes;
    var accessors = j.accessors || [], meshes = j.meshes || [], nodes = j.nodes || [], mats = j.materials || [], texs = j.textures || [], imgs = j.images || [], views = j.bufferViews || [];
    var f = { fileBytes: bytes.byteLength, nodes: nodes.length, meshNodes: 0, primitives: 0, triangles: 0, vertices: 0, nonTriangle: 0, noNormals: 0, vertexColors: false,
      skins: (j.skins || []).length, animations: (j.animations || []).length, cameras: (j.cameras || []).length, bounds: null, usedMaterials: [], images: [], materials: [],
      extensionsUsed: j.extensionsUsed || [], extensionsRequired: j.extensionsRequired || [], draco: false, externalUris: 0, lights: false, invalid: [] };
    validateBinary(j, bin, f.invalid);
    if (f.extensionsUsed.indexOf('KHR_lights_punctual') >= 0) f.lights = true;

    // walk the default scene like the game does (every primitive of every mesh node is one sub-mesh, a mesh used by two nodes counts twice)
    // GLTFLoader gives gltf.scene = scenes[json.scene || 0]; without that scene the game has nothing to place
    var sceneIdx = j.scene || 0, theScene = j.scenes && j.scenes[sceneIdx], roots = (theScene && theScene.nodes) || [];
    if (!theScene) f.invalid.push('modellen har ingen standardscen (scenes saknas eller scene pekar utanför listan)');
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], boundsKnown = true, usedMat = {};

    function visit(idx, parentM) {
      var n = nodes[idx]; if (!n) return;
      var m = mul(parentM, localMatrix(n));
      if (n.mesh !== undefined && meshes[n.mesh]) {
        meshes[n.mesh].primitives.forEach(function (p) {
          f.primitives++;
          f.meshNodes++;   // GLTFLoader makes one Mesh per primitive and the game one InstancedMesh per Mesh
          var attrs = p.attributes || {}, pos = accessors[attrs.POSITION], mode = p.mode === undefined ? 4 : p.mode;
          if (!pos && !(p.extensions && p.extensions.KHR_draco_mesh_compression)) f.invalid.push('en primitive saknar giltig POSITION');
          var vcount = pos ? pos.count : 0, icount = p.indices !== undefined && accessors[p.indices] ? accessors[p.indices].count : vcount;
          if (mode === 4) f.triangles += Math.floor(icount / 3); else if (mode === 5 || mode === 6) f.triangles += Math.max(0, icount - 2); else f.nonTriangle++;
          f.vertices += vcount;
          if (attrs.NORMAL === undefined) f.noNormals++;
          if (attrs.COLOR_0 !== undefined) f.vertexColors = true;
          if (p.extensions && p.extensions.KHR_draco_mesh_compression) f.draco = true;
          if (p.material !== undefined && !mats[p.material]) f.invalid.push('en primitive pekar på material ' + p.material + ' som inte finns');
          usedMat[p.material === undefined ? -1 : p.material] = true;
          if (pos && pos.min && pos.max && (pos.componentType === 5126 || !pos.normalized)) {
            for (var c = 0; c < 8; c++) {
              var q = applyPoint(m, [c & 1 ? pos.max[0] : pos.min[0], c & 2 ? pos.max[1] : pos.min[1], c & 4 ? pos.max[2] : pos.min[2]]);
              for (var a = 0; a < 3; a++) { if (q[a] < lo[a]) lo[a] = q[a]; if (q[a] > hi[a]) hi[a] = q[a]; }
            }
          } else boundsKnown = false;
        });
      }
      (n.children || []).forEach(function (c) { visit(c, m); });
    }
    var identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    roots.forEach(function (r) { visit(r, identity); });
    if (boundsKnown && isFinite(lo[0])) f.bounds = { min: lo, max: hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
    f.usedMaterials = Object.keys(usedMat).map(Number).filter(function (k) { return k >= 0; });

    function bufferBytes(i) {   // buffer 0 without uri is the BIN chunk; a base64 data URI is decoded; anything else is not available
      var b = (j.buffers || [])[i];
      if (!b) return null;
      if (b.uri === undefined) return i === 0 ? bin : null;
      if (typeof b.uri === 'string' && b.uri.indexOf('data:') === 0 && b.uri.indexOf(';base64,') > 0) {
        try {
          var raw = b.uri.slice(b.uri.indexOf(',') + 1);
          return typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(raw, 'base64')) : Uint8Array.from(atob(raw), function (ch) { return ch.charCodeAt(0); });
        } catch (e) { return null; }
      }
      return null;
    }

    // materials, and which texture does what
    var role = {};   // image index -> { base, normal, mr, occlusion, emissive }
    var texObjs = {};   // image index -> the texture indices that use it (outside the dropped metal/rough maps): GLTFLoader makes one texture object, and one GPU upload, per index
    var useSeq = 0;
    function useTex(ti, what, info) {
      if (ti === undefined || ti === null) return;
      if (!texs[ti]) { f.invalid.push('ett material pekar på textur ' + ti + ' som inte finns'); return; }
      var t = texs[ti], src = t.source;
      var webp = t.extensions && t.extensions.EXT_texture_webp, basis = t.extensions && t.extensions.KHR_texture_basisu;
      if (webp && webp.source !== undefined) src = webp.source;   // a WebP-capable browser makes GLTFLoader use the extension's image, not the fallback
      else if (src === undefined && basis) src = basis.source;
      if (src === undefined || !imgs[src]) { f.invalid.push('textur ' + ti + ' saknar en giltig bild'); return; }
      (role[src] = role[src] || {})[what] = true;
      // GLTFLoader clones the texture for every use that carries KHR_texture_transform; plain uses share the one object of their texture index
      var transformed = info && info.extensions && info.extensions.KHR_texture_transform;
      if (what !== 'mr') (texObjs[src] = texObjs[src] || {})[transformed ? ti + '#' + (useSeq++) : ti] = true;
    }
    (usedMat[-1] ? f.usedMaterials.concat([-1]) : f.usedMaterials).forEach(function (mi) {   // -1: GLTFLoader's shared default material
      var mt = mats[mi] || {}, pbr = mt.pbrMetallicRoughness || {};
      f.materials.push({ index: mi, name: mt.name || '', baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1], baseColorTexture: !!pbr.baseColorTexture, normalTexture: !!mt.normalTexture,
        metallicRoughnessTexture: !!pbr.metallicRoughnessTexture, occlusionTexture: !!mt.occlusionTexture, emissiveTexture: !!mt.emissiveTexture,
        alphaMode: mt.alphaMode || 'OPAQUE', doubleSided: !!mt.doubleSided, extensions: Object.keys(mt.extensions || {}) });
      if (pbr.baseColorTexture) useTex(pbr.baseColorTexture.index, 'base', pbr.baseColorTexture);
      if (mt.normalTexture) useTex(mt.normalTexture.index, 'normal', mt.normalTexture);
      if (pbr.metallicRoughnessTexture) useTex(pbr.metallicRoughnessTexture.index, 'mr', pbr.metallicRoughnessTexture);
      if (mt.occlusionTexture) useTex(mt.occlusionTexture.index, 'occlusion', mt.occlusionTexture);
      if (mt.emissiveTexture) useTex(mt.emissiveTexture.index, 'emissive', mt.emissiveTexture);
      Object.keys(mt.extensions || {}).forEach(function (en) {   // maps of the supported material extensions (clearcoat, transmission, ...) are uploaded too
        var ext = mt.extensions[en] || {};
        Object.keys(ext).forEach(function (key) { if (/Texture$/.test(key) && ext[key] && typeof ext[key].index === 'number') useTex(ext[key].index, 'ext', ext[key]); });
      });
    });

    imgs.forEach(function (im, i) {
      var data = null, size = 0;
      var vw = im.bufferView !== undefined ? views[im.bufferView] : null, src0 = vw ? bufferBytes(vw.buffer) : null;   // the image lives in the buffer its view names
      if (vw && src0) {
        var v = vw; size = v.byteLength; data = src0.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
      } else if (typeof im.uri === 'string' && im.uri.indexOf('data:') === 0) {
        var comma = im.uri.indexOf(','), b64 = im.uri.slice(comma + 1);
        data = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(b64, 'base64')) : Uint8Array.from(atob(b64), function (ch) { return ch.charCodeAt(0); });
        size = data.length;
      } else if (typeof im.uri === 'string') f.externalUris++;
      var info = data ? imageInfo(data, im.mimeType) : { width: 0, height: 0, type: im.mimeType || '?', alpha: false };
      f.images.push({ index: i, bytes: size, mime: im.mimeType || '', width: info.width, height: info.height, alpha: info.alpha, roles: Object.keys(role[i] || {}), data: data, used: !!role[i], textureObjects: Math.max(1, Object.keys(texObjs[i] || {}).length) });
    });
    return f;
  }

  // ---------------------------------------------------------------- colour classes: the same rule as the game's fragment shader
  function classify(r, g, b) {   // 0..1
    var greenish = g > r + 0.01;
    var brown = !greenish && (r > g + 0.01) && (g + 0.05 >= b) && (r < 0.8);
    var grey = !greenish && Math.abs(r - g) < 0.1 && Math.abs(g - b) < 0.1 && r < 0.6;
    var snow = r > 0.85 && g > 0.85 && b > 0.85 && Math.abs(r - g) < 0.04 && Math.abs(g - b) < 0.04;
    if (snow) return 'snow';
    if (brown || grey) return 'trunk';
    return greenish ? 'green' : 'other';
  }
  function colourShares(samples) {   // samples: [{ width, height, data: RGBA bytes }] -> shares of the opaque texels
    var n = { green: 0, other: 0, trunk: 0, snow: 0 }, total = 0;
    samples.forEach(function (s) {
      for (var i = 0; i < s.data.length; i += 4) {
        if (s.data[i + 3] < 128) continue;
        n[classify(s.data[i] / 255, s.data[i + 1] / 255, s.data[i + 2] / 255)]++; total++;
      }
    });
    if (!total) return null;
    return { green: n.green / total, other: n.other / total, trunk: n.trunk / total, snow: n.snow / total, texels: total };
  }

  // ---------------------------------------------------------------- the verdicts
  function fmtN(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function fmtMB(b) { return (b / MB).toFixed(2) + ' MB'; }
  function pct(x) { return Math.round(x * 100) + ' %'; }

  function judge(f, profile, opts, colours) {
    var checks = [];
    function add(id, level, message) { checks.push({ id: id, level: level, message: message }); }
    function range(id, value, limits, what, unit, hint) {
      var text = what + ': ' + value + (unit || '') + ' (varna över ' + limits[0] + ', fel över ' + limits[1] + ')';
      if (value > limits[1]) add(id, 'fail', text + (hint ? '. ' + hint : ''));
      else if (value > limits[0]) add(id, 'warn', text + (hint ? '. ' + hint : ''));
      else add(id, 'ok', what + ': ' + value + (unit || ''));
    }

    // can the game load it at all?
    var required = f.extensionsRequired, used = f.extensionsUsed, loadable = true;
    required.forEach(function (e) {
      if (UNSUPPORTED_EXT[e]) { add('ext-' + e, 'fail', 'Kräver ' + UNSUPPORTED_EXT[e] + ': spelet kan inte ladda modellen. Exportera om med Draco eller utan komprimering.'); loadable = false; }
      else if (SUPPORTED_EXT.indexOf(e) < 0) { add('ext-' + e, 'fail', 'Kräver tillägget ' + e + ' som spelets laddare inte känner till.'); loadable = false; }
    });
    used.forEach(function (e) {
      if (required.indexOf(e) >= 0) return;
      if (UNSUPPORTED_EXT[e]) add('ext-' + e, 'warn', 'Använder ' + UNSUPPORTED_EXT[e] + ' som inte är krav men kan ge fel.');
      else if (SUPPORTED_EXT.indexOf(e) < 0) add('ext-' + e, 'info', 'Tillägget ' + e + ' ignoreras av spelet.');
    });
    if (f.draco) add('draco', 'info', 'Draco-komprimerad: laddas med avkodaren från Google (kräver nätverk första gången).');
    if (f.externalUris) { add('external', 'fail', f.externalUris + ' extern(a) bildfil(er) i modellen: en GLB ska vara en enda fil med allt inbakat.'); loadable = false; }
    if (f.nonTriangle) { add('prim', 'fail', f.nonTriangle + ' delar är linjer eller punkter, inte trianglar: de ritas inte som en yta.'); }
    if (f.invalid.length) { add('binary', 'fail', 'Filen är trasig: ' + f.invalid.join('; ') + '. Spelets laddare klarar inte den.'); loadable = false; }
    if (f.meshNodes === 0) { add('empty', 'fail', 'Modellen har ingen geometri i sin scen.'); loadable = false; }

    // cost
    range('tris', f.triangles, profile.tris, 'Trianglar', '', 'Färre trianglar ger billigare banor, spelet ritar alla utplacerade exemplar hela tiden.');
    var inst = (opts && opts.instances) || profile.instances, scene = f.triangles * inst;
    if (scene > SCENE_TRIS[1]) add('scene', 'fail', 'Banans kostnad: ' + f.triangles + ' trianglar x ' + inst + ' exemplar = ' + fmtN(scene) + ' trianglar (fel över ' + fmtN(SCENE_TRIS[1]) + ')');
    else if (scene > SCENE_TRIS[0]) add('scene', 'warn', 'Banans kostnad: ' + f.triangles + ' trianglar x ' + inst + ' exemplar = ' + fmtN(scene) + ' trianglar (varna över ' + fmtN(SCENE_TRIS[0]) + ')');
    else add('scene', 'ok', 'Banans kostnad: ' + f.triangles + ' x ' + inst + ' exemplar = ' + fmtN(scene) + ' trianglar');
    range('meshes', f.meshNodes, profile.meshes, 'Delar (en draw call per del och modelltyp)', '', 'Slå ihop delar som har samma material.');
    range('materials', f.materials.length, profile.materials, 'Material', '');
    range('file', +(f.fileBytes / MB).toFixed(2), profile.fileMB, 'Filstorlek', ' MB', 'Totalbudgeten är ' + TOTAL_BUDGET_MB + ' MB per biom.');

    // textures
    var maxDim = 0, gpu = 0, dead = 0, unusedBytes = 0;
    f.images.forEach(function (im) {
      maxDim = Math.max(maxDim, im.width, im.height);
      var isDead = im.used && im.roles.length && im.roles.every(function (r) { return r === 'mr'; });
      if (im.used && !isDead) gpu += im.width * im.height * 4 * 1.34 * im.textureObjects;   // the game drops metal/rough maps, unused images are never uploaded; one upload per texture object
      if (!im.used) unusedBytes += im.bytes;
      else if (isDead) dead += im.bytes;
    });
    if (f.images.length) {
      if (maxDim) range('texsize', maxDim, profile.tex, 'Största textur', ' px', 'Spelet visar modellerna små: 512-1024 px räcker oftast.');
      else add('texsize', 'info', f.images.length + ' textur(er) men storleken kunde inte läsas.');
      if (gpu) range('gpu', +(gpu / MB).toFixed(1), profile.gpuMB, 'Texturminne på grafikkortet', ' MB');
      if (dead > 0) add('deadmaps', 'warn', 'Metall/råhets-textur (' + fmtMB(dead) + ') kastas bort av spelet (allt blir matt): ta bort den vid exporten.');
      if (unusedBytes > 0) add('unusedimg', 'warn', 'Bilder som inget material använder (' + fmtMB(unusedBytes) + '): ta bort dem.');
      var normal = f.images.filter(function (im) { return im.roles.indexOf('normal') >= 0; }).length;
      if (normal) add('normalmap', 'info', normal + ' normalkarta(or) används. I en facetterad tecknad stil behövs de sällan och de ökar filen.');
    } else add('textures', 'ok', 'Inga texturer (färger i materialen)');

    // materials the game cannot sort or animate
    f.materials.forEach(function (m) {
      if (m.alphaMode === 'BLEND') add('blend-' + m.index, 'warn', 'Material "' + (m.name || m.index) + '" är genomskinligt (BLEND): utplacerade exemplar sorteras inte och kan blinka. Använd MASK (klippt alfa).');
    });
    if (f.skins || f.animations) add('anim', 'warn', 'Modellen har ' + (f.skins ? 'skelett' : '') + (f.skins && f.animations ? ' och ' : '') + (f.animations ? 'animationer' : '') + ': spelets instansering animerar dem inte, de ökar bara filen.');
    if (f.cameras || f.lights) add('extras', 'info', 'Kameror eller ljus i filen ignoreras.');
    if (f.vertexColors) add('vcolor', 'info', 'Har hörnfärger: de multipliceras med texturen och biomens färg.');
    if (f.noNormals) add('normals', 'info', f.noNormals + ' del(ar) saknar normaler: de ritas med platt skuggning.');
    if (f.triangles) {
      var ratio = f.vertices / f.triangles;
      add('shading', 'info', ratio >= 2.5 ? 'Facetterad (ihopsvetsade hörn saknas, ' + ratio.toFixed(1) + ' hörn per triangel): passar en lågpoly-stil.' : 'Mjuk skuggning (' + ratio.toFixed(1) + ' hörn per triangel).');
    }

    // shape: the game scales by height
    var b = f.bounds;
    if (b) {
      var h = b.size[1], w = Math.max(b.size[0], b.size[2]);
      if (!(h > 1e-6)) add('shape', 'fail', 'Modellen har ingen höjd (platt): spelet skalar efter höjd och får oändlig skala.');
      else {
        var asp = w / h;
        if (profile.aspect && asp > profile.aspect) add('shape', 'warn', 'Modellen är ' + asp.toFixed(1) + ' gånger bredare än hög (höjd ' + h.toFixed(2) + ', bredd ' + w.toFixed(2) + '). Spelet skalar efter höjd, så den blir mycket bredare än en ' + profile.name + ' bör vara. Är det rätt typ?');
        else add('shape', 'ok', 'Form: höjd ' + h.toFixed(2) + ', bredd ' + w.toFixed(2) + ' (spelet skalar och centrerar själv, pivoten spelar ingen roll)');
      }
    } else add('shape', 'info', 'Måtten kunde inte läsas ur filen.');

    // colour classes for the biome re-colouring
    if (colours) {
      var greenish = colours.green, other = colours.other, trunk = colours.trunk;
      var line = 'Färger (bland synliga pixlar): grönt ' + pct(greenish) + ', brunt/grått ' + pct(trunk) + (colours.snow >= 0.01 ? ', nästan vitt ' + pct(colours.snow) : '') + (other >= 0.01 ? ', annat ' + pct(other) : '');
      if (profile.name === 'tree' && (greenish + other < 0.05 || trunk < 0.03)) add('colours', 'warn', line + '. Ett träd bör ha både lövverk (grönt) och stam (brunt/grått), annars färgas det fel av årstiderna.');
      else if (profile.name === 'rock' && greenish + other > 0.3) add('colours', 'warn', line + '. Pixlar som inte är bruna/gråa räknas som lövverk och färgas om av höst/vinter: en sten bör vara grå/brun.');
      else if (other > 0.25 && profile.name !== 'prop') add('colours', 'warn', line + '. Pixlar som varken är gröna, bruna eller grå (t.ex. rosa, blå, gul) räknas som lövverk och färgas om av höst/vinter.');
      else add('colours', 'ok', line);
    } else if (opts && opts.colourSkipped) add('colours', 'info', 'Färgkontrollen hoppades över (' + opts.colourSkipped + ').');

    var order = { fail: 0, warn: 1, ok: 2, info: 3 };
    checks.sort(function (a, c) { return order[a.level] - order[c.level]; });
    var verdict = checks.some(function (c) { return c.level === 'fail'; }) ? 'fail' : (checks.some(function (c) { return c.level === 'warn'; }) ? 'warn' : 'ok');
    return { checks: checks, verdict: verdict, loadable: loadable, gpuBytes: gpu };
  }

  // ---------------------------------------------------------------- the public entry
  // opts: { kind, instances, sampleImage(bytes, mime) -> Promise<{width, height, data}> }
  function check(buffer, opts) {
    opts = opts || {};
    var profile, kind = opts.kind && PROFILES[opts.kind] ? opts.kind : 'tree';
    profile = Object.assign({ name: kind }, PROFILES[kind]);
    var parsed;
    try { parsed = parseGlb(buffer); } catch (e) {
      return Promise.resolve({ kind: kind, verdict: 'fail', loadable: false, facts: null, checks: [{ id: 'format', level: 'fail', message: e.message }] });
    }
    var f;
    try { f = measure(parsed); } catch (e) {
      return Promise.resolve({ kind: kind, verdict: 'fail', loadable: false, facts: null, checks: [{ id: 'format', level: 'fail', message: 'Filens JSON är felaktigt uppbyggd (' + e.message + ').' }] });
    }
    var usedImages = f.images.filter(function (im) { return im.used && im.data; });   // every one is decoded: the loader decodes them all
    var imagesToSample = usedImages.filter(function (im) { return im.roles.indexOf('base') >= 0; });   // only these count for the colour shares
    var colourPromise, decodeFailures = 0;
    if (opts.sampleImage && usedImages.length) {
      colourPromise = Promise.all(usedImages.map(function (im) { return Promise.resolve(opts.sampleImage(im.data, im.mime)).then(function (px) { return imagesToSample.indexOf(im) >= 0 ? px : null; }).catch(function () { decodeFailures++; return null; }); }))
        .then(function (list) { list = list.filter(Boolean); return list.length ? colourShares(list) : null; });
    } else if (!f.images.length) {
      // no texture: the colour is the material's own
      var samples = f.materials.map(function (m) { var c = m.baseColorFactor; return { width: 1, height: 1, data: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), 255] }; });
      colourPromise = Promise.resolve(samples.length ? colourShares(samples) : null);
    } else colourPromise = Promise.resolve(null);
    var skipped = (!opts.sampleImage && imagesToSample.length) ? 'ingen bildavkodare här' : null;
    return colourPromise.then(function (colours) {
      var res = judge(f, profile, Object.assign({}, opts, { colourSkipped: colours ? null : skipped }), colours);
      if (decodeFailures) {   // the loader decodes the same image and rejects the model if it cannot
        res.checks.unshift({ id: 'decode', level: 'fail', message: decodeFailures + ' textur(er) kunde inte avkodas av webbläsaren: spelets laddare klarar dem inte heller.' });
        res.verdict = 'fail'; res.loadable = false;
      }
      var facts = { gpuMB: +(res.gpuBytes / MB).toFixed(2), fileBytes: f.fileBytes, triangles: f.triangles, vertices: f.vertices, meshes: f.meshNodes, materials: f.materials.length, textures: f.images.length,
        maxTexture: Math.max.apply(null, [0].concat(f.images.map(function (im) { return Math.max(im.width, im.height); }))), bounds: f.bounds, colours: colours, draco: f.draco,
        extensionsUsed: f.extensionsUsed, extensionsRequired: f.extensionsRequired };
      return { kind: kind, verdict: res.verdict, loadable: res.loadable, facts: facts, checks: res.checks };
    });
  }

  function formatReport(result, opts) {
    var useColour = !!(opts && opts.colour), mark = { fail: '✗', warn: '!', ok: '✓', info: '·' };
    var paint = function (level, s) { if (!useColour) return s; var c = { fail: 31, warn: 33, ok: 32, info: 90 }[level]; return '\u001b[' + c + 'm' + s + '\u001b[0m'; };
    var lines = [];
    result.checks.forEach(function (c) { lines.push('  ' + paint(c.level, mark[c.level]) + ' ' + c.message); });
    return lines.join('\n');
  }

  return { check: check, parseGlb: parseGlb, formatReport: formatReport, classify: classify, PROFILES: PROFILES, KIND_OF_SUBCAT: KIND_OF_SUBCAT, SCENE_TRIS: SCENE_TRIS,
    TOTAL_BUDGET_MB: TOTAL_BUDGET_MB, TOTAL_GPU_BUDGET_MB: TOTAL_GPU_BUDGET_MB, SUPPORTED_EXT: SUPPORTED_EXT };
});
