// Hitbox fit: turns the triangles of a model into the collision profile the ball is tested against, and tests a point against it.
// Runs in Node (tests, tools) and in the browser (admin page, game).
//
// The profile ("type": "profile") is the model sliced into height bands. Each band is the smallest circle that holds the model in that band
// (radius r around the point cx, cz), so a cone, an umbrella, or a crown that hangs to one side is followed, which one trunk radius and one
// crown radius cannot do. On top of that comes the trunk: a hard cylinder the ball bounces off.
//
// All lengths are in metres for the model at scale 1, in the frame the game places a model in: scaled so its height is targetHeight, centred
// in x and z on the middle of its bounding box, base on the ground, +y up. A placed object is that frame times its scale, turned around y by
// its rotation. Tilt and roll are not followed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HitboxFit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SLICES = 12;
  var THIN = 0.4;            // a band narrower than this share of the widest band is stem, not crown
  var STEM_MAX = 0.6;        // the stem never reaches higher than this share of the height
  var FLARE_MAX = 2;         // up to this many wide bands (roots, a flared foot) may come before the stem

  function round3(v) { return Math.round(v * 1000) / 1000; }

  // ---- the smallest circle around a set of points (Welzl, iterative, points shuffled with a fixed seed so the result is repeatable)
  function circle2(a, b) { return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 }; }
  function circle3(a, b, c) {
    var bx = b[0] - a[0], bz = b[1] - a[1], cx = c[0] - a[0], cz = c[1] - a[1];
    var d = 2 * (bx * cz - bz * cx);
    if (Math.abs(d) < 1e-12) {   // on a line: the circle of the two furthest apart
      var best = circle2(a, b), c2 = circle2(a, c), c3 = circle2(b, c);
      if (c2.r > best.r) best = c2; if (c3.r > best.r) best = c3;
      return best;
    }
    var ux = (cz * (bx * bx + bz * bz) - bz * (cx * cx + cz * cz)) / d, uz = (bx * (cx * cx + cz * cz) - cx * (bx * bx + bz * bz)) / d;
    return { x: a[0] + ux, z: a[1] + uz, r: Math.hypot(ux, uz) };
  }
  function inside(c, p) { return Math.hypot(p[0] - c.x, p[1] - c.z) <= c.r * (1 + 1e-9) + 1e-9; }
  function enclosingCircle(pts) {
    var n = pts.length;
    if (!n) return null;
    var p = pts.slice(), seed = 12345;
    for (var i = n - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; var j = seed % (i + 1), t = p[i]; p[i] = p[j]; p[j] = t; }
    var c = { x: p[0][0], z: p[0][1], r: 0 };
    for (i = 1; i < n; i++) {
      if (inside(c, p[i])) continue;
      c = { x: p[i][0], z: p[i][1], r: 0 };
      for (j = 0; j < i; j++) {
        if (inside(c, p[j])) continue;
        c = circle2(p[i], p[j]);
        for (var k = 0; k < j; k++) { if (!inside(c, p[k])) c = circle3(p[i], p[j], p[k]); }
      }
    }
    return c;
  }
  function hull(pts) {   // Andrew's monotone chain: far fewer points for the circle
    if (pts.length < 4) return pts;
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], i;
    for (i = 0; i < p.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop(); lo.push(p[i]); }
    var up = [];
    for (i = p.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop(); up.push(p[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  // ---- slicing: every triangle is clipped to every height band it passes through, so a big flat facet still counts in each band
  function clipToBand(poly, y0, y1) {
    function clip(inp, keep, lim) {   // keep: +1 keeps y >= lim, -1 keeps y <= lim
      var out = [];
      for (var i = 0; i < inp.length; i++) {
        var a = inp[i], b = inp[(i + 1) % inp.length];
        var ain = keep > 0 ? a[1] >= lim : a[1] <= lim, bin = keep > 0 ? b[1] >= lim : b[1] <= lim;
        if (ain) out.push(a);
        if (ain !== bin) { var t = (lim - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, lim, a[2] + (b[2] - a[2]) * t]); }
      }
      return out;
    }
    return clip(clip(poly, 1, y0), -1, y1);
  }

  // mesh: { positions: [x,y,z, ...], indices?: [i, ...] } (no indices: every three positions are a triangle), in the model's own units
  // opts: { targetHeight, bbox?: { min: [x,y,z], max: [x,y,z] }, slices? }. bbox is what the game normalises with (three.js Box3 of the model).
  function fit(mesh, opts) {
    opts = opts || {};
    var pos = mesh.positions, idx = mesh.indices, nv = Math.floor(pos.length / 3);
    if (nv < 3) throw new Error('Modellen har inga trianglar att anpassa efter.');
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], i, k;
    if (opts.bbox) { min = opts.bbox.min.slice(); max = opts.bbox.max.slice(); }
    else for (i = 0; i < nv; i++) for (k = 0; k < 3; k++) { var v = pos[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    var sizeY = max[1] - min[1];
    if (!(sizeY > 1e-9)) throw new Error('Modellen har ingen höjd.');
    var H = opts.targetHeight > 0 ? opts.targetHeight : 1, s = H / sizeY, cx0 = (min[0] + max[0]) / 2, cz0 = (min[2] + max[2]) / 2;
    var N = opts.slices || SLICES, dy = H / N;
    function P(i) { return [(pos[i * 3] - cx0) * s, (pos[i * 3 + 1] - min[1]) * s, (pos[i * 3 + 2] - cz0) * s]; }

    var bands = []; for (i = 0; i < N; i++) bands.push([]);
    var tris = idx ? Math.floor(idx.length / 3) : Math.floor(nv / 3), used = 0;
    for (var t = 0; t < tris; t++) {
      var a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (a >= nv || b >= nv || c >= nv) continue;
      var A = P(a), B = P(b), C = P(c), lo = Math.min(A[1], B[1], C[1]), hi = Math.max(A[1], B[1], C[1]);
      var k0 = Math.max(0, Math.floor(lo / dy)), k1 = Math.min(N - 1, Math.floor(hi / dy));
      used++;
      for (k = k0; k <= k1; k++) {
        var poly = (k0 === k1) ? [A, B, C] : clipToBand([A, B, C], k * dy, (k + 1) * dy);
        for (var q = 0; q < poly.length; q++) bands[k].push([poly[q][0], poly[q][2]]);
      }
    }

    var slices = [], rMax = 0;
    for (k = 0; k < N; k++) {
      var circ = bands[k].length ? enclosingCircle(hull(bands[k])) : null;
      if (!circ) { slices.push(null); continue; }
      slices.push({ y0: k * dy, y1: (k + 1) * dy, r: circ.r, cx: circ.x, cz: circ.z });
      if (circ.r > rMax) rMax = circ.r;
    }
    for (k = 0; k < N; k++) {   // a band the model does not touch (a floating crown): nothing there to hit
      if (!slices[k]) slices[k] = { y0: k * dy, y1: (k + 1) * dy, r: 0, cx: 0, cz: 0 };
    }

    // the stem: the thin bands from the ground up. A cone or a bush has none, then the trunk is a thin pole in the middle.
    // roots or a flared foot may make the first one or two bands wide: the stem is the first run of thin bands, starting no later than the third band
    var stemStart = 0;
    while (stemStart < FLARE_MAX && stemStart < N && slices[stemStart].r > THIN * rMax) stemStart++;
    var stemEnd = stemStart;
    while (stemEnd < N && slices[stemEnd].r <= THIN * rMax && slices[stemEnd].y1 <= STEM_MAX * H + 1e-9) stemEnd++;
    if (stemEnd === stemStart) stemEnd = 0;   // no thin band at the bottom: a cone or a bush
    var trunk;
    if (stemEnd >= 1) {
      var rs = [], tx = 0, tz = 0;
      for (k = stemStart; k < stemEnd; k++) { rs.push(slices[k].r); tx += slices[k].cx; tz += slices[k].cz; }
      var nStem = stemEnd - stemStart;
      rs.sort(function (p, q) { return p - q; });   // the middle one: a flared foot or the first branches must not make the whole stem fat
      var tr = rs.length % 2 ? rs[(rs.length - 1) / 2] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2;
      trunk = { r: tr, cx: tx / nStem, cz: tz / nStem, h: slices[stemEnd - 1].y1, guessed: false };
    } else {
      trunk = { r: Math.max(0.12 * rMax, 0.05), cx: slices[0].cx, cz: slices[0].cz, h: 0.4 * H, guessed: true };
    }
    var crownY = stemEnd >= 1 ? slices[stemEnd - 1].y1 : 0;

    var reach = Math.hypot(trunk.cx, trunk.cz) + trunk.r;
    var out = [];
    for (k = 0; k < N; k++) {
      var sl = slices[k];
      reach = Math.max(reach, Math.hypot(sl.cx, sl.cz) + sl.r);
      out.push({ y0: round3(sl.y0), y1: round3(sl.y1), r: round3(sl.r), cx: round3(sl.cx), cz: round3(sl.cz) });
    }
    return {
      type: 'profile', height: round3(H), reach: round3(reach), crownY: round3(crownY),
      trunk: { r: round3(trunk.r), cx: round3(trunk.cx), cz: round3(trunk.cz), h: round3(trunk.h), guessed: trunk.guessed },
      slices: out, triangles: used
    };
  }

  // the profile for another model height: every length follows
  function scale(p, k) {
    var o = JSON.parse(JSON.stringify(p));
    o.height = round3(p.height * k); o.reach = round3(p.reach * k); o.crownY = round3(p.crownY * k);
    ['r', 'cx', 'cz', 'h'].forEach(function (f) { o.trunk[f] = round3(p.trunk[f] * k); });
    o.slices.forEach(function (sl, i) { ['y0', 'y1', 'r', 'cx', 'cz'].forEach(function (f) { sl[f] = round3(p.slices[i][f] * k); }); });
    return o;
  }

  // Is the ball at (bx, bz) (three.js x and z) at height zb above the ground inside a placed object? The object is at (ox, oz), scale s, turned rot
  // around y. Returns null, or { part: 'TRUNK', nx, nz, sx, sz } (outward normal and a safe position on the trunk's surface, three.js x and z)
  // or { part: 'CANOPY' }. Same parts the tree collision already uses.
  function hit(p, s, rot, ox, oz, bx, bz, zb) {
    if (!p || zb < 0 || zb > p.height * s) return null;
    var dx = bx - ox, dz = bz - oz, reach = p.reach * s + 0.05;
    if (dx * dx + dz * dz > reach * reach) return null;
    var cs = Math.cos(rot), sn = Math.sin(rot);
    function at(cx, cz) { return [ox + (cx * cs + cz * sn) * s, oz + (-cx * sn + cz * cs) * s]; }
    var tr = p.trunk;
    if (tr && zb < tr.h * s) {
      var tp = at(tr.cx, tr.cz), tdx = bx - tp[0], tdz = bz - tp[1], td = Math.hypot(tdx, tdz);
      if (td < tr.r * s) {
        var nx = td > 1e-9 ? tdx / td : 1, nz = td > 1e-9 ? tdz / td : 0, rr = tr.r * s + 0.05;   // exactly on the axis: any outward direction will do
        return { part: 'TRUNK', nx: nx, nz: nz, sx: tp[0] + nx * rr, sz: tp[1] + nz * rr };
      }
    }
    var zu = zb / s;
    if (zu >= p.crownY) {
      for (var i = 0; i < p.slices.length; i++) {
        var sl = p.slices[i];
        if (zu >= sl.y0 && (zu < sl.y1 || i === p.slices.length - 1)) {
          var cp = at(sl.cx, sl.cz);
          if (Math.hypot(bx - cp[0], bz - cp[1]) < sl.r * s) return { part: 'CANOPY' };
          break;
        }
      }
    }
    return null;
  }

  // one line for the admin page
  function describe(p) {
    var wide = 0, i;
    for (i = 0; i < p.slices.length; i++) if (p.slices[i].r > wide) wide = p.slices[i].r;
    return p.slices.length + ' skikt, krona upp till radie ' + wide.toFixed(2) + ' m från ' + p.crownY.toFixed(1) + ' m höjd, stam radie ' + p.trunk.r.toFixed(2) +
      ' m upp till ' + p.trunk.h.toFixed(1) + ' m' + (p.trunk.guessed ? ' (stammen är gissad: modellen har ingen tydlig stam)' : '');
  }

  return { fit: fit, scale: scale, hit: hit, describe: describe, enclosingCircle: enclosingCircle, SLICES: SLICES };
});
