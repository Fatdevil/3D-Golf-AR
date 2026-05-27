// ================================================================
//  TERRAIN SHELL MANAGER v5 — 3D grass + distant tint layer
//
//  Near:  Full 3D shell layers with FBM silhouettes (discard-based)
//  Far:   Single flat tint layer darkens rough areas (alpha blend)
//  Result: Rough looks different at ALL distances, 3D up close
// ================================================================
(function() {
    'use strict';

    const QUALITY = {
        OFF:  { layers: 0, maxDist: 0 },
        LOW:  { layers: 3, maxDist: 60 },
        MED:  { layers: 5, maxDist: 120 },
        HIGH: { layers: 8, maxDist: 250 }
    };

    // Far tint extends 4× beyond shell range
    const TINT_MULTIPLIER = 4.0;

    // ─── GLSL: 3D Shell Shader ──────────────────────────────────

    const VERT = `
        uniform float uLayer;
        uniform float uLayers;
        uniform float uMaxHeight;
        uniform vec2  uWindDir;
        uniform float uWindStr;
        uniform float uTime;

        varying vec2 vUv;
        varying float vL;
        varying vec3 vWorldPos;

        void main() {
            vUv = uv;
            vL  = uLayer / max(uLayers, 1.0);

            // Detect skirt vertices: their normals point downward/sideways
            // (terrain surface normals point up: z > 0.5 in local space)
            float isSkirt = step(normal.z, 0.3);
            float effectiveLayer = vL * (1.0 - isSkirt);

            vec3 p = position + normal * effectiveLayer * uMaxHeight;

            // Wind sway (skip for skirt)
            float sway = effectiveLayer * effectiveLayer * uWindStr * 0.6;
            float w1 = sin(uTime * 1.4 + p.x * 0.06 + p.y * 0.04);
            float w2 = sin(uTime * 2.1 + p.y * 0.09 + p.x * 0.03);
            p.x += uWindDir.x * sway * (w1 * 0.6 + w2 * 0.4);
            p.y -= uWindDir.y * sway * (w1 * 0.6 + w2 * 0.4);

            vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `;

    const FRAG = `
        uniform sampler2D uBiome;
        uniform vec3  uRoughCol;
        uniform vec3  uDeepCol;
        uniform float uRoughH;
        uniform float uDeepH;
        uniform float uMaxHeight;

        varying vec2  vUv;
        varying float vL;
        varying vec3  vWorldPos;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash(i), hash(i + vec2(1,0)), f.x),
                mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
                f.y
            );
        }
        float fbm(vec2 p) {
            return 0.45 * vnoise(p) +
                   0.30 * vnoise(p * 2.5) +
                   0.15 * vnoise(p * 6.0) +
                   0.10 * vnoise(p * 13.0);
        }

        void main() {
            vec3 bio = texture2D(uBiome, vUv).rgb;
            vec3 dR = abs(bio - uRoughCol);
            vec3 dD = abs(bio - uDeepCol);
            float distR = max(dR.r, max(dR.g, dR.b));
            float distD = max(dD.r, max(dD.g, dD.b));

            float isRough = 1.0 - smoothstep(0.02, 0.07, distR);
            float isDeep  = 1.0 - smoothstep(0.02, 0.07, distD);
            float roughness = max(isRough, isDeep);
            if (roughness < 0.1) discard;

            float targetH = isDeep > 0.5 ? uDeepH : uRoughH;
            float eL = vL * (uMaxHeight / max(targetH, 0.001));
            if (eL > 1.0) discard;

            vec2 wXZ = vWorldPos.xz;
            float clump = fbm(wXZ * 0.8);
            float tuft = fbm(wXZ * 4.0 + 50.0);
            float blade = vnoise(wXZ * 15.0 + 100.0);
            float grass = clump * 0.3 + tuft * 0.4 + blade * 0.3;

            float threshold = eL * eL * 0.65;
            if (grass < threshold) discard;

            float edgeThreshold = threshold + (1.0 - roughness) * 0.3;
            if (grass < edgeThreshold) discard;

            vec3 baseCol = isDeep > 0.5 ? uDeepCol : uRoughCol;
            float ao = mix(0.55, 1.0, eL);
            vec3 col = baseCol * ao;
            col += vec3(0.04, 0.05, 0.01) * eL;

            // Subtle color variation via UV (chunk-independent, no tile artifacts)
            float colorVar = vnoise(vUv * 80.0 + 33.0);
            col *= 0.95 + 0.10 * colorVar;

            gl_FragColor = vec4(col, 1.0);
        }
    `;

    // ─── GLSL: Distant Tint Shader (flat, transparent) ──────────

    const TINT_VERT = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const TINT_FRAG = `
        uniform sampler2D uBiome;
        uniform vec3  uRoughCol;
        uniform vec3  uDeepCol;

        varying vec2 vUv;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash(i), hash(i + vec2(1,0)), f.x),
                mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
                f.y
            );
        }

        void main() {
            vec3 bio = texture2D(uBiome, vUv).rgb;
            vec3 dR = abs(bio - uRoughCol);
            vec3 dD = abs(bio - uDeepCol);
            float distR = max(dR.r, max(dR.g, dR.b));
            float distD = max(dD.r, max(dD.g, dD.b));

            float isRough = 1.0 - smoothstep(0.02, 0.07, distR);
            float isDeep  = 1.0 - smoothstep(0.02, 0.07, distD);
            float roughness = max(isRough, isDeep);
            if (roughness < 0.1) discard;

            vec3 baseCol = isDeep > 0.5 ? uDeepCol : uRoughCol;

            // Subtle darkening + slight noise variation
            float n = vnoise(vUv * 200.0);
            vec3 col = baseCol * (0.60 + 0.15 * n);

            // Deep rough even darker
            if (isDeep > 0.5) col *= 0.85;

            gl_FragColor = vec4(col, 0.35 * roughness);
        }
    `;

    // ─── Manager ─────────────────────────────────────────────────

    class TerrainShellManager {
        constructor(chunkMgr, scene, biomeTex) {
            this.chunkMgr = chunkMgr;
            this.scene = scene;
            this.biomeTex = biomeTex;
            this.quality = 'OFF';
            this.shells = [];   // { chunkIdx, layer, mesh, mat, isTint }
            this._frame = 0;

            this.roughHeight = 0.30;
            this.deepHeight  = 0.60;

            this._roughCol = new THREE.Vector3();
            this._deepCol  = new THREE.Vector3();
            this._updateColors();
        }

        setQuality(q) {
            if (this.quality === q) return;
            this.quality = q;
            this._rebuild();
            console.log('[Shells] Quality:', q,
                q !== 'OFF' ? '(' + QUALITY[q].layers + ' layers, ' + QUALITY[q].maxDist + 'm)' : '');
        }

        update(time, camera) {
            if (this.shells.length === 0) return;

            // Don't show shells when chunks are disabled
            if (!window._chunksEnabled) {
                for (let s of this.shells) s.mesh.visible = false;
                return;
            }

            // Animate wind (skip tint layers — no wind uniform)
            for (let s of this.shells) {
                if (!s.isTint) s.mat.uniforms.uTime.value = time;
            }

            if (++this._frame % 20 !== 0) return;
            if (!camera) return;

            let preset = QUALITY[this.quality];
            if (!preset || preset.layers === 0) return;

            let size = window.TERRAIN_SIZE, segs = window.TERRAIN_SEGS;
            let half = size / 2, step = size / segs;
            let chunks = this.chunkMgr.chunks;
            let tintMax = preset.maxDist * TINT_MULTIPLIER;

            for (let s of this.shells) {
                let c = chunks[s.chunkIdx];
                if (!c) { s.mesh.visible = false; continue; }

                let cx = -half + ((c.gxStart + c.gxEnd) * 0.5) * step;
                let cz = -half + ((c.gzStart + c.gzEnd) * 0.5) * step;
                let dx = camera.position.x - cx, dz = camera.position.z - cz;
                let dist = Math.sqrt(dx * dx + dz * dz);

                if (s.isTint) {
                    // Tint: visible BEYOND shell range, up to tintMax
                    s.mesh.visible = dist > preset.maxDist * 0.7 && dist < tintMax;
                } else {
                    // 3D shells: visible within shell range
                    s.mesh.visible = dist < preset.maxDist;
                }

                if (s.mesh.geometry !== c.geo) s.mesh.geometry = c.geo;
            }

            // Sync wind (3D shells only)
            let ws = (window.windSpeed || 0) / 30;
            let wa = (window.windAngle || 0) * Math.PI / 180;
            for (let s of this.shells) {
                if (!s.isTint) {
                    s.mat.uniforms.uWindStr.value = ws;
                    s.mat.uniforms.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
                }
            }
        }

        refresh() { this._rebuild(); }

        getStats() {
            let visible = 0, total = 0, tris = 0;
            let chunks = this.chunkMgr.chunks;
            for (let s of this.shells) {
                total++;
                if (s.mesh.visible) {
                    visible++;
                    let c = chunks[s.chunkIdx];
                    if (c) tris += c.lodSegs * c.lodSegs * 2;
                }
            }
            return { total, visible, extraTris: tris };
        }

        // ── Internal ────────────────────────────────────────────

        _rebuild() {
            for (let s of this.shells) {
                if (s.mesh.parent) this.scene.remove(s.mesh);
                s.mat.dispose();
            }
            this.shells = [];

            let preset = QUALITY[this.quality];
            if (!preset || preset.layers === 0) return;

            this._updateColors();
            let maxH = Math.max(this.roughHeight, this.deepHeight);
            let chunks = this.chunkMgr.chunks;

            for (let ci = 0; ci < chunks.length; ci++) {
                // ── Tint layer (flat, transparent, far range) ──
                let tintMat = this._makeTintMat();
                let tintMesh = new THREE.Mesh(chunks[ci].geo, tintMat);
                tintMesh.rotation.x = -Math.PI / 2;
                tintMesh.frustumCulled = true;
                tintMesh.visible = false;
                tintMesh.renderOrder = 99;
                this.scene.add(tintMesh);
                this.shells.push({ chunkIdx: ci, layer: 0, mesh: tintMesh, mat: tintMat, isTint: true });

                // ── 3D shell layers (opaque, discard, near range) ──
                for (let layer = 1; layer <= preset.layers; layer++) {
                    let mat = this._makeMat(layer, preset.layers, maxH);
                    let mesh = new THREE.Mesh(chunks[ci].geo, mat);
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.frustumCulled = true;
                    mesh.visible = false;
                    mesh.renderOrder = 100 + layer;
                    this.scene.add(mesh);
                    this.shells.push({ chunkIdx: ci, layer, mesh, mat, isTint: false });
                }
            }
            console.log('[Shells] Built', this.shells.length, 'meshes (' +
                chunks.length + ' tint + ' + (this.shells.length - chunks.length) + ' 3D)');
        }

        _makeMat(layer, total, maxH) {
            return new THREE.ShaderMaterial({
                uniforms: {
                    uLayer:    { value: layer },
                    uLayers:   { value: total },
                    uMaxHeight:{ value: maxH },
                    uRoughH:   { value: this.roughHeight },
                    uDeepH:    { value: this.deepHeight },
                    uWindDir:  { value: new THREE.Vector2(1, 0) },
                    uWindStr:  { value: 0.3 },
                    uTime:     { value: 0 },
                    uBiome:    { value: this.biomeTex },
                    uRoughCol: { value: this._roughCol.clone() },
                    uDeepCol:  { value: this._deepCol.clone() }
                },
                vertexShader: VERT,
                fragmentShader: FRAG,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: true
            });
        }

        _makeTintMat() {
            return new THREE.ShaderMaterial({
                uniforms: {
                    uBiome:    { value: this.biomeTex },
                    uRoughCol: { value: this._roughCol.clone() },
                    uDeepCol:  { value: this._deepCol.clone() }
                },
                vertexShader: TINT_VERT,
                fragmentShader: TINT_FRAG,
                side: THREE.FrontSide,
                transparent: true,
                depthWrite: false,
                depthTest: true,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4
            });
        }

        _updateColors() {
            let cfg = window.CURRENT_BIOME_CONFIG || {};
            this._hexToVec(cfg.roughColor || '#4a782b', this._roughCol);
            this._hexToVec(cfg.fescueColor || '#2d4c1a', this._deepCol);
        }

        _hexToVec(hex, v) {
            v.set(
                parseInt(hex.slice(1,3), 16) / 255,
                parseInt(hex.slice(3,5), 16) / 255,
                parseInt(hex.slice(5,7), 16) / 255
            );
        }
    }

    window.TerrainShellManager = TerrainShellManager;
})();
