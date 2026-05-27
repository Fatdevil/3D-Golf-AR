// ================================================================
//  TERRAIN SHELL MANAGER v6 — Master-geometry based (no chunks)
//
//  Near:  Full 3D shell layers with FBM silhouettes (discard-based)
//  Far:   Single flat tint layer darkens rough areas (alpha blend)
//  Result: Rough looks different at ALL distances, 3D up close
//
//  v6: Shells render on the MASTER terrain mesh directly.
//      No dependency on chunk system. Max 9 meshes total.
// ================================================================
(function() {
    'use strict';

    const QUALITY = {
        OFF:  { layers: 0, maxDist: 0 },
        LOW:  { layers: 3, maxDist: 60 },
        MED:  { layers: 5, maxDist: 120 },
        HIGH: { layers: 8, maxDist: 250 }
    };

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

            // Adaptive displacement:
            // Flat → world-up (clean from above)
            // Slopes → follow terrain normal (layers hidden from side)
            // Normal clamped to max ~60° to prevent spikes at bunker edges
            vec3 up = vec3(0.0, 0.0, 1.0);
            vec3 clampedN = normalize(vec3(normal.xy * 0.5, max(normal.z, 0.5)));
            float slope = 1.0 - abs(normal.z); // 0=flat, 1=vertical
            vec3 dir = mix(up, clampedN, smoothstep(0.05, 0.35, slope));
            vec3 p = position + dir * vL * uMaxHeight;

            // Wind sway (increases with height)
            float sway = vL * vL * uWindStr * 0.6;
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

            vec3 baseCol = isDeep > 0.5 ? uDeepCol : uRoughCol;

            // All layers use FBM grass silhouettes (no solid fill)
            float targetH = isDeep > 0.5 ? uDeepH : uRoughH;
            float eL = vL * (uMaxHeight / max(targetH, 0.001));
            if (eL > 1.0) discard;

            vec2 wXZ = vWorldPos.xz;
            float clump = fbm(wXZ * 0.8);
            float tuft = fbm(wXZ * 4.0 + 50.0);
            float blade = vnoise(wXZ * 15.0 + 100.0);
            float grass = clump * 0.3 + tuft * 0.4 + blade * 0.3;

            // Gentle threshold: bottom layers keep ~90% pixels, top ~60%
            float threshold = eL * eL * 0.40;
            if (grass < threshold) discard;

            // Softer edge fade at biome boundaries
            float edgeThreshold = threshold + (1.0 - roughness) * 0.15;
            if (grass < edgeThreshold) discard;

            // Bright AO: warm bottom, vivid tops
            float ao = mix(0.85, 1.10, eL);
            vec3 col = baseCol * ao;
            col += vec3(0.07, 0.09, 0.02) * eL; // Vivid green tips

            float colorVar = vnoise(vUv * 80.0 + 33.0);
            col *= 0.95 + 0.10 * colorVar;

            gl_FragColor = vec4(col, 1.0);
        }
    `;

    // ─── Manager ─────────────────────────────────────────────────

    class TerrainShellManager {
        constructor(masterGeo, masterMesh, scene, biomeTex) {
            this.masterGeo = masterGeo;
            this.masterMesh = masterMesh;
            this.scene = scene;
            this.biomeTex = biomeTex;
            this.quality = 'OFF';
            this.shells = [];   // { layer, mesh, mat }
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
                q !== 'OFF' ? '(' + QUALITY[q].layers + ' layers)' : '');
        }

        update(time, camera) {
            if (this.shells.length === 0) return;

            // Animate wind
            for (let s of this.shells) {
                s.mat.uniforms.uTime.value = time;
            }
        }

        updateColors() {
            this._updateColors();
            for (let s of this.shells) {
                s.mat.uniforms.uRoughCol.value.copy(this._roughCol);
                s.mat.uniforms.uDeepCol.value.copy(this._deepCol);
            }
        }

        updateWind() {
            let ws = (window.windSpeed || 0) / 30;
            let wa = (window.windAngle || 0) * Math.PI / 180;
            for (let s of this.shells) {
                s.mat.uniforms.uWindStr.value = ws;
                s.mat.uniforms.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
            }
        }

        /** Call after updateTerrainResolution to swap in new geometry */
        updateGeometry(newGeo) {
            this.masterGeo = newGeo;
            // Geometry is now decoupled from masterGeo. Rebuild to pick up any slider changes.
            this._rebuild();
        }

        syncHeights() {
            if (this.shells.length === 0) return;
            this._resampleFromMaster();
        }

        _resampleFromMaster() {
            if (!this.masterGeo || !this.customGeo) return;

            let mPos = this.masterGeo.attributes.position.array;
            let mNorm = this.masterGeo.attributes.normal.array;
            let mSegs = window.TERRAIN_SEGS || 600;
            let mStride = mSegs + 1;

            let cPos = this.customGeo.attributes.position.array;
            let cNorm = this.customGeo.attributes.normal.array;

            let size = window.TERRAIN_SIZE || 600;
            let half = size / 2;

            let shellSegs = this.customGeo.parameters.widthSegments;
            let cStride = shellSegs + 1;
            let step = size / shellSegs;

            function sampleAttribs(worldX, worldZ) {
                let oldStep = size / mSegs;
                let gx = (worldX + half) / oldStep;
                let gz = (worldZ + half) / oldStep;
                gx = Math.max(0, Math.min(mSegs - 1, gx));
                gz = Math.max(0, Math.min(mSegs - 1, gz));
                let ix = Math.floor(gx), iz = Math.floor(gz);
                let fx = gx - ix, fz = gz - iz;

                let i00 = (iz * mStride + ix) * 3;
                let i10 = (iz * mStride + (ix + 1)) * 3;
                let i01 = ((iz + 1) * mStride + ix) * 3;
                let i11 = ((iz + 1) * mStride + (ix + 1)) * 3;

                let h00 = mPos[i00 + 2] || 0, h10 = mPos[i10 + 2] || 0;
                let h01 = mPos[i01 + 2] || 0, h11 = mPos[i11 + 2] || 0;
                let z = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;

                let n00x = mNorm[i00] || 0, n00y = mNorm[i00 + 1] || 0, n00z = mNorm[i00 + 2] || 1;
                let n10x = mNorm[i10] || 0, n10y = mNorm[i10 + 1] || 0, n10z = mNorm[i10 + 2] || 1;
                let n01x = mNorm[i01] || 0, n01y = mNorm[i01 + 1] || 0, n01z = mNorm[i01 + 2] || 1;
                let n11x = mNorm[i11] || 0, n11y = mNorm[i11 + 1] || 0, n11z = mNorm[i11 + 2] || 1;

                let nx = n00x * (1 - fx) * (1 - fz) + n10x * fx * (1 - fz) + n01x * (1 - fx) * fz + n11x * fx * fz;
                let ny = n00y * (1 - fx) * (1 - fz) + n10y * fx * (1 - fz) + n01y * (1 - fx) * fz + n11y * fx * fz;
                let nz = n00z * (1 - fx) * (1 - fz) + n10z * fx * (1 - fz) + n01z * (1 - fx) * fz + n11z * fx * fz;

                let len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                return { z, nx: nx / len, ny: ny / len, nz: nz / len };
            }

            for (let i = 0; i <= shellSegs; i++) {
                for (let j = 0; j <= shellSegs; j++) {
                    let localX = -half + j * step;
                    let localY = half - i * step;
                    let worldX = localX;
                    let worldZ = -localY;

                    let idx = (i * cStride + j) * 3;
                    let sample = sampleAttribs(worldX, worldZ);

                    cPos[idx + 2] = sample.z;
                    cNorm[idx] = sample.nx;
                    cNorm[idx + 1] = sample.ny;
                    cNorm[idx + 2] = sample.nz;
                }
            }

            this.customGeo.attributes.position.needsUpdate = true;
            this.customGeo.attributes.normal.needsUpdate = true;
            this.customGeo.computeBoundingBox();
            this.customGeo.computeBoundingSphere();
        }

        refresh() { this._rebuild(); }

        getStats() {
            let visible = 0, tris = 0;
            let segs = window.TERRAIN_SEGS || 100;
            for (let s of this.shells) {
                if (s.mesh.visible) {
                    visible++;
                    tris += segs * segs * 2;
                }
            }
            return { total: this.shells.length, visible, extraTris: tris };
        }

        // ── Internal ────────────────────────────────────────────

        _rebuild() {
            // Dispose old shells
            for (let s of this.shells) {
                if (s.mesh.parent) this.scene.remove(s.mesh);
                s.mat.dispose();
            }
            this.shells = [];

            let preset = QUALITY[this.quality];
            if (!preset || preset.layers === 0) return;

            this._updateColors();
            let maxH = Math.max(this.roughHeight, this.deepHeight);
            
            // Decouple from Green Grid! Use Terrain Grid for 3D grass.
            let shellSegs = window._terrainGridSegs || (window.TERRAIN_SEGS ? Math.min(window.TERRAIN_SEGS, 200) : 200);
            if (this.customGeo) this.customGeo.dispose();
            this.customGeo = new THREE.PlaneGeometry(window.TERRAIN_SIZE || 400, window.TERRAIN_SIZE || 400, shellSegs, shellSegs);
            this.customGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
            this._resampleFromMaster();
            let geo = this.customGeo;

            // ── N 3D shell layers (opaque, discard) ──
            for (let layer = 1; layer <= preset.layers; layer++) {
                let mat = this._makeMat(layer, preset.layers, maxH);
                let mesh = new THREE.Mesh(geo, mat);
                mesh.rotation.x = -Math.PI / 2;
                mesh.frustumCulled = true;
                mesh.visible = true;
                mesh.renderOrder = 100 + layer;
                this.scene.add(mesh);
                this.shells.push({ layer, mesh, mat });
            }
            console.log('[Shells] Built', this.shells.length,
                'meshes (' + preset.layers + ' 3D layers) on master geo');
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
