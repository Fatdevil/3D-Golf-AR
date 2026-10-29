// ================================================================
//  RANGE MARKERS — what a driving range shows down its length, in the player's unit (window.useMeters):
//  distance arcs (true distance from the tee, not straight cross lines: a ball 40 m wide of the "150" line is further than 150),
//  a target flag with a coloured ring on the centre line at every 50, a dashed centre line, and signs on posts at both ends of each arc.
//  The lines lie on the ground (draped over the terrain), so they show on a hilly range too.
//
//  RangeMarkers.build(opts) returns a THREE.Group placed at the tee and turned to its heading (+Z of the group is down the range);
//  RangeMarkers.dispose(group) frees its geometries, materials and textures. The distance maths has no THREE in it and is tested in
//  tests/test_range_markers.js.
// ================================================================
(function (root) {
    const YD = 0.9144;
    const MAJOR_COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#38bdf8', '#a78bfa'];   // 50, 100 ... 300: one colour per target

    // The marks down the range in the player's unit: every 25 (major every 50, with a flag and signs) out to 300
    function marks(useMeters) {
        const out = [];
        for (let d = 25; d <= 300; d += 25) {
            const major = d % 50 === 0;
            out.push({ value: d, metres: useMeters ? d : d * YD, major: major, color: major ? MAJOR_COLORS[d / 50 - 1] : null, label: String(d) });
        }
        return out;
    }
    // How big a sign is: grows with the distance so that the far ones still read from the tee (1.17 at 50 m, 3.25 at 300 m)
    function signScale(metres) { return 0.75 + metres / 120; }
    // Which signs to show: rects {x, y, w, h, side} in screen pixels (centre and size), nearest first; null for a sign that is not
    // wholly in view. A sign that would overlap one already shown (with a few pixels to spare) is hidden, and so is every further sign
    // on the same side of the range after it, so the far signs that crowd together at the horizon do not pile up and the ones shown
    // run on without a gap (50, 100, 150, not 50, 100, 250).
    function pickVisible(rects, pad) {
        pad = pad === undefined ? 4 : pad;
        const shown = [], closed = {};
        return rects.map(function (r) {
            if (!r) return false;
            const key = r.side === undefined ? null : String(r.side);
            if (key !== null && closed[key]) return false;
            const hit = shown.some(function (o) { return Math.abs(r.x - o.x) * 2 < r.w + o.w + pad * 2 && Math.abs(r.y - o.y) * 2 < r.h + o.h + pad * 2; });
            if (hit) { if (key !== null) closed[key] = true; return false; }
            shown.push(r);
            return true;
        });
    }
    // Half the angle an arc spans: about 45 m of arc each side of the centre line, never more than ±40°
    function arcHalfAngle(r) { return Math.min(0.7, 45 / Math.max(r, 1)); }
    // A point given in the range's own frame (across to the right, along down the range) in scene x/z. Same turn as THREE's rotation.y:
    // local +Z goes to (sin rot, cos rot), local +X to (cos rot, -sin rot)
    function toWorld(tee, lx, lz) {
        const c = Math.cos(tee.rot || 0), s = Math.sin(tee.rot || 0);
        return { x: tee.x + lx * c + lz * s, z: tee.z - lx * s + lz * c };
    }

    const api = { YD: YD, MAJOR_COLORS: MAJOR_COLORS, marks: marks, arcHalfAngle: arcHalfAngle, signScale: signScale, pickVisible: pickVisible, toWorld: toWorld };

    if (typeof document !== 'undefined') {
        const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

        function roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        // A sign: dark slab, the target's colour as a bar on the left, the distance large and the unit small beside it
        function signTexture(THREE, value, unit, color) {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 224;
            const ctx = c.getContext('2d');
            roundRect(ctx, 8, 8, 496, 208, 44);
            ctx.fillStyle = 'rgba(9, 14, 26, 0.88)';
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
            ctx.stroke();
            ctx.save();
            roundRect(ctx, 8, 8, 496, 208, 44);
            ctx.clip();
            ctx.fillStyle = color;
            ctx.fillRect(8, 8, 26, 208);
            ctx.restore();
            ctx.textBaseline = 'alphabetic';
            ctx.font = '800 124px ' + FONT;
            const wNum = ctx.measureText(value).width;
            ctx.font = '800 64px ' + FONT;
            const wUnit = ctx.measureText(unit).width;
            const gap = 12, x0 = 272 - (wNum + gap + wUnit) / 2, base = 158;
            ctx.font = '800 124px ' + FONT;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(value, x0, base);
            ctx.font = '800 64px ' + FONT;
            ctx.fillStyle = color;
            ctx.fillText(unit, x0 + wNum + gap, base);
            const tex = new THREE.CanvasTexture(c);
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = 4;
            return tex;
        }

        // The hitting mat under the Range Tee: artificial turf with mown stripes and a light edge
        function matTexture(THREE) {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 160;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#23592f';
            ctx.fillRect(0, 0, 256, 160);
            ctx.fillStyle = '#2b6838';
            for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 16, 160);
            roundRect(ctx, 5, 5, 246, 150, 14);
            ctx.lineWidth = 6;
            ctx.strokeStyle = 'rgba(241, 245, 249, 0.7)';
            ctx.stroke();
            const tex = new THREE.CanvasTexture(c);
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.anisotropy = 4;
            return tex;
        }

        // A strip lying on the ground: pts are [lx, lz] pairs along its middle; width in metres. Heights follow the terrain.
        function groundStrip(THREE, tee, pts, width, groundAt, lift) {
            const pos = [], idx = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
                let dx = b[0] - a[0], dz = b[1] - a[1];
                const len = Math.hypot(dx, dz) || 1;
                const nx = -dz / len * width / 2, nz = dx / len * width / 2;   // sideways in the local frame
                [[pts[i][0] + nx, pts[i][1] + nz], [pts[i][0] - nx, pts[i][1] - nz]].forEach(function (p) {
                    const w = toWorld(tee, p[0], p[1]), h = groundAt(w.x, w.z);
                    pos.push(p[0], (h === null ? tee.y : h) - tee.y + lift, p[1]);
                });
                if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            return g;
        }
        function mergeStrips(THREE, list) {
            const pos = [], idx = [];
            list.forEach(function (g) {
                const off = pos.length / 3, p = g.attributes.position.array, ix = g.index.array;
                for (let i = 0; i < p.length; i++) pos.push(p[i]);
                for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
                g.dispose();
            });
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            return g;
        }
        function lineMat(THREE, color, opacity) {
            return new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false, side: THREE.DoubleSide,
                                                 polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        }

        // opts: { THREE, x, y, z, rot, useMeters, groundAt(x, z) -> height or null, teeGeo (the tee marker ball) }
        api.build = function (opts) {
            const THREE = opts.THREE, tee = { x: opts.x, y: opts.y, z: opts.z, rot: opts.rot || 0 };
            const groundAt = opts.groundAt || function () { return null; };
            const localY = function (lx, lz, lift) { const w = toWorld(tee, lx, lz), h = groundAt(w.x, w.z); return (h === null ? tee.y : h) - tee.y + (lift || 0); };
            const unit = opts.useMeters ? 'M' : 'YDS';
            const list = marks(!!opts.useMeters), far = list[list.length - 1].metres;
            const group = new THREE.Group();
            group.userData.rangeMarkers = { useMeters: !!opts.useMeters };

            // the hitting mat: every ball on the range is hit from here (a tee lie, whatever the ground under it), lying on the ground
            const matGeo = new THREE.PlaneGeometry(5.6, 3.6, 8, 6);
            matGeo.rotateX(-Math.PI / 2);
            const mp = matGeo.attributes.position;
            for (let i = 0; i < mp.count; i++) { const lz = mp.getZ(i) - 0.6; mp.setZ(i, lz); mp.setY(i, localY(mp.getX(i), lz, 0.05)); }
            matGeo.computeVertexNormals();
            const mat = new THREE.Mesh(matGeo, new THREE.MeshLambertMaterial({ map: matTexture(THREE), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
            mat.receiveShadow = true;
            mat.userData.rangeMat = true;
            group.add(mat);

            // the tee markers (as on every tee, in range yellow)
            if (opts.teeGeo) {
                const tMat = new THREE.MeshLambertMaterial({ color: 0xeab308 });
                [-2.5, 2.5].forEach(function (sx) { const m = new THREE.Mesh(opts.teeGeo, tMat); m.position.set(sx, 0.35, 0); m.castShadow = true; m.userData.sharedGeometry = true; group.add(m); });
            }

            // dashed centre line: 3 m dashes, 3 m apart, from just in front of the tee to the last arc
            const dashes = [];
            for (let z0 = 6; z0 + 3 <= far; z0 += 6) dashes.push(groundStrip(THREE, tee, [[0, z0], [0, z0 + 1.5], [0, z0 + 3]], 0.22, groundAt, 0.06));
            group.add(new THREE.Mesh(mergeStrips(THREE, dashes), lineMat(THREE, 0xffffff, 0.38)));

            // the arcs: majors white and clear, the 25s faint
            const minor = [], major = [];
            list.forEach(function (m) {
                const half = arcHalfAngle(m.metres), n = 40, pts = [];
                for (let i = 0; i <= n; i++) { const a = -half + 2 * half * i / n; pts.push([m.metres * Math.sin(a), m.metres * Math.cos(a)]); }
                (m.major ? major : minor).push(groundStrip(THREE, tee, pts, m.major ? 0.45 : 0.2, groundAt, 0.07));
            });
            group.add(new THREE.Mesh(mergeStrips(THREE, major), lineMat(THREE, 0xffffff, 0.55)));
            group.add(new THREE.Mesh(mergeStrips(THREE, minor), lineMat(THREE, 0xffffff, 0.18)));

            // per 50: a target (ring + flag) on the centre line and a sign on a post at each end of the arc
            const poleGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.6, 8);
            const poleMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
            const pennant = new THREE.Shape(); pennant.moveTo(0, 0); pennant.lineTo(1.25, -0.38); pennant.lineTo(0, -0.76); pennant.closePath();
            const pennantGeo = new THREE.ShapeGeometry(pennant);
            const ringGeo = new THREE.RingGeometry(3.2, 3.7, 48), discGeo = new THREE.CircleGeometry(3.2, 48);
            const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 8);
            const postMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1 });
            list.filter(function (m) { return m.major; }).forEach(function (m) {
                const color = new THREE.Color(m.color), gy = localY(0, m.metres, 0);
                const ring = new THREE.Mesh(ringGeo, lineMat(THREE, color, 0.85)); ring.rotation.x = -Math.PI / 2; ring.position.set(0, gy + 0.09, m.metres); group.add(ring);
                const disc = new THREE.Mesh(discGeo, lineMat(THREE, color, 0.14)); disc.rotation.x = -Math.PI / 2; disc.position.set(0, gy + 0.08, m.metres); group.add(disc);
                const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(0, gy + 1.3, m.metres); pole.castShadow = true; group.add(pole);
                const flag = new THREE.Mesh(pennantGeo, new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
                flag.position.set(0, gy + 2.55, m.metres); group.add(flag);   // flies across the range, its face to the tee

                const tex = signTexture(THREE, m.label, unit, m.color), half = arcHalfAngle(m.metres);
                [-1, 1].forEach(function (side) {
                    const a = side * (half + 4 / m.metres);   // a few metres past the end of the arc
                    const lx = m.metres * Math.sin(a), lz = m.metres * Math.cos(a), sy = localY(lx, lz, 0);
                    // further signs are bigger, so that every one reads about the same size from the tee
                    const k = signScale(m.metres), postH = 1.6 * k;
                    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
                    sprite.scale.set(6.4 * k, 2.8 * k, 1);
                    sprite.position.set(lx, sy + postH + 1.4 * k, lz);
                    sprite.renderOrder = 4;
                    group.add(sprite);
                    const post = new THREE.Mesh(postGeo, postMat); post.scale.set(k, postH, k); post.position.set(lx, sy + postH / 2, lz); group.add(post);
                    sprite.userData.rangeSign = { post: post, side: side };
                });
            });

            group.position.set(tee.x, tee.y, tee.z);
            group.rotation.y = tee.rot;
            return group;
        };

        // Called before each frame is drawn: signs that would overlap a nearer one on the screen fade out (about 0.2 s), and come back when
        // the view opens up again. viewW / viewH are the size of the view in pixels.
        const _wp = { v: null };
        api.declutter = function (group, camera, viewW, viewH) {
            if (!group || !camera || !root.THREE) return;
            const signs = [];
            group.children.forEach(function (c) { if (c.userData && c.userData.rangeSign) signs.push(c); });
            if (!signs.length) return;
            if (!_wp.v) _wp.v = new root.THREE.Vector3();
            const now = performance.now(), last = group.userData.declutterAt || now;
            group.userData.declutterAt = now;
            const step = Math.min(1, (now - last) / 200);
            const tanHalf = Math.tan((camera.fov || 60) * Math.PI / 360);
            const items = signs.map(function (sp) {
                sp.getWorldPosition(_wp.v);
                const d = camera.position.distanceTo(_wp.v);
                const p = _wp.v.clone().project(camera);
                if (p.z > 1 || p.z < -1 || d < 0.01) return { sp: sp, d: d, rect: null };
                const h = sp.scale.y / (2 * d * tanHalf) * viewH, w = h * sp.scale.x / sp.scale.y;
                const x = (p.x + 1) / 2 * viewW, y = (1 - p.y) / 2 * viewH;
                // a sign cut off by the edge of the view reads as broken: hidden (it does not hide the ones behind it)
                if (x - w / 2 < 0 || x + w / 2 > viewW || y - h / 2 < 0 || y + h / 2 > viewH) return { sp: sp, d: d, rect: null };
                return { sp: sp, d: d, rect: { x: x, y: y, w: w, h: h, side: sp.userData.rangeSign.side } };
            }).sort(function (a, b) { return a.d - b.d; });
            const vis = pickVisible(items.map(function (it) { return it.rect; }));
            items.forEach(function (it, i) {
                const target = vis[i] ? 1 : 0, m = it.sp.material;   // a sign without a rect (cut off by the edge, or behind the camera) fades out too
                m.opacity += (target - m.opacity) * step;
                if (Math.abs(target - m.opacity) < 0.02) m.opacity = target;
                it.sp.visible = m.opacity > 0.01;
                it.sp.userData.rangeSign.post.visible = m.opacity > 0.3;
            });
        };

        // Draws with every sign shown (the minimap looks straight down, where nothing crowds), then puts back what declutter chose
        api.withAllSigns = function (groups, draw) {
            const saved = [];
            groups.forEach(function (g) {
                if (!g) return;
                g.children.forEach(function (c) {
                    if (!c.userData || !c.userData.rangeSign) return;
                    const post = c.userData.rangeSign.post;
                    saved.push([c, c.visible, c.material.opacity, post.visible]);
                    c.visible = true; c.material.opacity = 1; post.visible = true;
                });
            });
            try { draw(); } finally {
                saved.forEach(function (x) { x[0].visible = x[1]; x[0].material.opacity = x[2]; x[0].userData.rangeSign.post.visible = x[3]; });
            }
        };

        // Frees what build() made (the tee ball geometry is shared with the other tees and stays)
        api.dispose = function (group) {
            if (!group) return;
            const seen = new Set();
            group.traverse(function (o) {
                if (o.geometry && !(o.userData && o.userData.sharedGeometry) && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
                const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
                mats.forEach(function (m) { if (seen.has(m)) return; seen.add(m); if (m.map && !seen.has(m.map)) { seen.add(m.map); m.map.dispose(); } m.dispose(); });
            });
        };
    }

    root.RangeMarkers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
