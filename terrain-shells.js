// ================================================================
//  TERRAIN SHELL MANAGER — Volumetric grass for rough/deep rough
//
//  Renders terrain chunks multiple times at increasing heights
//  with a procedural grass pattern. Biome texture determines where
//  grass appears (rough/deep rough colors).
//
//  Quality presets control layer count and max distance.
//  Wind animation syncs with game wind system.
// ================================================================
(function() {
    'use strict';

    const QUALITY = {
        OFF:  { layers: 0, maxDist: 0 },
        LOW:  { layers: 2, maxDist: 60 },
        MED:  { layers: 4, maxDist: 120 },
        HIGH: { layers: 6, maxDist: 250 }
    };

    // ─── GLSL Shaders ───────────────────────────────────────────

    const VERT = `
        uniform float uLayer;
        uniform float uLayers;
        uniform float uMaxHeight;
        uniform vec2  uWindDir;
        uniform float uWindStr;
        uniform float uTime;

        varying vec2 vUv;
        varying float vL; // layer ratio 0..1
        varying vec3 vWorldPos;

        void main() {
            vUv = uv;
            vL  = uLayer / max(uLayers, 1.0);

            vec3 p = position + normal * vL * uMaxHeight;

            // Wind: quadratic with height, two overlapping waves
            float w = vL * vL * uWindStr * 0.4;
            float w1 = sin(uTime * 1.5 + p.x * 0.08 + p.y * 0.06);
            float w2 = sin(uTime * 2.3 + p.y * 0.10 + p.x * 0.04);
            float wave = w1 * 0.6 + w2 * 0.4;
            p.x += uWindDir.x * w * wave;
            p.y -= uWindDir.y * w * wave;

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

        // Two different hash functions for variety
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float hash2(vec2 p) {
            return fract(sin(dot(p, vec2(269.5, 183.3))) * 29758.1731);
        }

        void main() {
            // Sample biome color
            vec3 bio = texture2D(uBiome, vUv).rgb;

            // --- Biome detection (sRGB space in ShaderMaterial) ---
            // Check distance to rough and deep rough colors
            // Use per-channel comparison for robustness
            vec3 diffR = abs(bio - uRoughCol);
            vec3 diffD = abs(bio - uDeepCol);
            float dR = max(diffR.r, max(diffR.g, diffR.b)); // max-channel distance
            float dD = max(diffD.r, max(diffD.g, diffD.b));

            float isRough = 1.0 - smoothstep(0.03, 0.08, dR);
            float isDeep  = 1.0 - smoothstep(0.03, 0.08, dD);
            float any     = max(isRough, isDeep);

            // Hard discard for non-rough areas
            if (any < 0.1) discard;

            // Scale layer: deep rough grows taller than rough
            float targetH = isDeep > 0.5 ? uDeepH : uRoughH;
            float effectiveL = vL * (uMaxHeight / max(targetH, 0.01));
            if (effectiveL > 1.05) discard;

            // --- Procedural grass pattern ---
            // Use WORLD position for consistent scale regardless of UV mapping
            // 1 cell ≈ 0.5m world space → realistic grass blade density
            vec2 worldXZ = vWorldPos.xz;
            float grassScale = 2.0; // cells per meter
            vec2 cell = floor(worldXZ * grassScale);
            float h1 = hash(cell);
            float h2 = hash2(cell);

            // Multi-octave density: finer noise layered on top
            vec2 fineCell = floor(worldXZ * grassScale * 3.0);
            float h3 = hash(fineCell);

            // Base density: 85% coverage at ground, thinning to ~5% at tips
            float density = mix(0.85, 0.05, effectiveL * effectiveL);
            float bladeRand = h1 * 0.6 + h3 * 0.4;
            if (bladeRand > density) discard;

            // --- Color ---
            vec3 baseCol = isDeep > 0.5 ? uDeepCol : uRoughCol;

            // Height-based coloring: slightly darker base, brighter tips
            float brightness = mix(0.7, 1.15, effectiveL);
            vec3 col = baseCol * brightness;

            // Per-blade color variation (subtle)
            col *= 0.88 + 0.24 * h2;

            // Warm tip highlight on top layers
            col += vec3(0.015, 0.02, 0.0) * effectiveL;

            gl_FragColor = vec4(col, 1.0);
        }
    `;

    // ─── Manager Class ──────────────────────────────────────────

    class TerrainShellManager {
        /**
         * @param {TerrainChunkManager} chunkMgr
         * @param {THREE.Scene} scene
         * @param {THREE.Texture} biomeTex — canvas terrain texture
         */
        constructor(chunkMgr, scene, biomeTex) {
            this.chunkMgr = chunkMgr;
            this.scene = scene;
            this.biomeTex = biomeTex;
            this.quality = 'OFF';
            this.shells = [];       // { chunkIdx, layer, mesh, mat }
            this._frame = 0;

            // Heights (meters)
            this.roughHeight = 0.08;   // 8cm
            this.deepHeight  = 0.22;   // 22cm

            this._roughCol = new THREE.Vector3();
            this._deepCol  = new THREE.Vector3();
            this._updateColors();
        }

        // ── Public API ──────────────────────────────────────────

        setQuality(q) {
            if (this.quality === q) return;
            this.quality = q;
            this._rebuild();
            console.log('[Shells] Quality:', q,
                q !== 'OFF' ? '(' + QUALITY[q].layers + ' layers, ' + QUALITY[q].maxDist + 'm)' : '');
        }

        /** Call every frame */
        update(time, camera) {
            if (this.shells.length === 0) return;

            // Update time uniform (every frame for smooth wind)
            for (let s of this.shells) s.mat.uniforms.uTime.value = time;

            // Distance visibility (throttled)
            if (++this._frame % 20 !== 0) return;
            if (!camera) return;

            let preset = QUALITY[this.quality];
            if (!preset || preset.layers === 0) return;

            let size = window.TERRAIN_SIZE, segs = window.TERRAIN_SEGS;
            let half = size / 2, step = size / segs;
            let chunks = this.chunkMgr.chunks;

            for (let s of this.shells) {
                let c = chunks[s.chunkIdx];
                if (!c) { s.mesh.visible = false; continue; }

                // Chunk center
                let cx = -half + ((c.gxStart + c.gxEnd) * 0.5) * step;
                let cz = -half + ((c.gzStart + c.gzEnd) * 0.5) * step;
                let dx = camera.position.x - cx, dz = camera.position.z - cz;
                let dist = Math.sqrt(dx * dx + dz * dz);

                s.mesh.visible = dist < preset.maxDist;

                // Re-link geometry if chunk was rebuilt (LOD change)
                if (s.mesh.geometry !== c.geo) s.mesh.geometry = c.geo;
            }

            // Sync wind from game
            let ws = (window.windSpeed || 0) / 30;   // normalize 0-1
            let wa = (window.windAngle || 0) * Math.PI / 180;
            let wdx = Math.cos(wa), wdy = Math.sin(wa);
            for (let s of this.shells) {
                s.mat.uniforms.uWindStr.value = ws;
                s.mat.uniforms.uWindDir.value.set(wdx, wdy);
            }
        }

        /** Rebuild after biome paint changes */
        refresh() { this._rebuild(); }

        /** Get current extra tris from shells */
        getStats() {
            let visible = 0, total = 0;
            for (let s of this.shells) {
                total++;
                if (s.mesh.visible) visible++;
            }
            let chunks = this.chunkMgr.chunks;
            let tris = 0;
            for (let s of this.shells) {
                if (s.mesh.visible) {
                    let c = chunks[s.chunkIdx];
                    if (c) tris += c.lodSegs * c.lodSegs * 2;
                }
            }
            return { total, visible, extraTris: tris };
        }

        // ── Internal ────────────────────────────────────────────

        _rebuild() {
            // Remove old
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
                for (let layer = 1; layer <= preset.layers; layer++) {
                    let mat = this._makeMat(layer, preset.layers, maxH);
                    let mesh = new THREE.Mesh(chunks[ci].geo, mat);
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.frustumCulled = true;
                    mesh.visible = false;
                    mesh.renderOrder = 100 + layer;
                    this.scene.add(mesh);
                    this.shells.push({ chunkIdx: ci, layer, mesh, mat });
                }
            }

            console.log('[Shells] Built', this.shells.length, 'shell meshes');
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
                side: THREE.FrontSide,
                depthWrite: false,
                depthTest: true,
                polygonOffset: true,
                polygonOffsetFactor: -layer * 2,
                polygonOffsetUnits: -layer * 2
            });
        }

        _updateColors() {
            let cfg = window.CURRENT_BIOME_CONFIG || {};
            let rh = cfg.roughColor || '#4a782b';
            let dh = cfg.fescueColor || '#2d4c1a';
            this._hexToVec(rh, this._roughCol);
            this._hexToVec(dh, this._deepCol);
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
