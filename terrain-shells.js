// ================================================================
//  TERRAIN SHELL MANAGER v3 — Volumetric grass for rough/deep rough
//
//  Uses alpha-blended shell layers instead of discard for smooth,
//  natural-looking grass. World-space multi-octave noise creates
//  organic density variation without blocky artifacts.
// ================================================================
(function() {
    'use strict';

    const QUALITY = {
        OFF:  { layers: 0, maxDist: 0 },
        LOW:  { layers: 3, maxDist: 60 },
        MED:  { layers: 5, maxDist: 120 },
        HIGH: { layers: 8, maxDist: 250 }
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
        varying float vL;
        varying vec3 vWorldPos;

        void main() {
            vUv = uv;
            vL  = uLayer / max(uLayers, 1.0);

            vec3 p = position + normal * vL * uMaxHeight;

            // Wind: quadratic sway, two overlapping sine waves
            float w = vL * vL * uWindStr * 0.35;
            float w1 = sin(uTime * 1.5 + p.x * 0.07 + p.y * 0.05);
            float w2 = sin(uTime * 2.1 + p.y * 0.09 + p.x * 0.03);
            float wave = w1 * 0.65 + w2 * 0.35;
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
        uniform float uLayer;

        varying vec2  vUv;
        varying float vL;
        varying vec3  vWorldPos;

        // Smooth hash for organic noise
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // Smooth value noise (interpolated)
        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f); // smoothstep

            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));

            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        // Multi-octave smooth noise
        float fbm(vec2 p) {
            float v = 0.0;
            v += 0.50 * vnoise(p * 1.0);
            v += 0.25 * vnoise(p * 2.3);
            v += 0.15 * vnoise(p * 5.7);
            v += 0.10 * vnoise(p * 11.0);
            return v;
        }

        void main() {
            // --- Sample biome ---
            vec3 bio = texture2D(uBiome, vUv).rgb;

            // Biome detection: max-channel distance
            vec3 diffR = abs(bio - uRoughCol);
            vec3 diffD = abs(bio - uDeepCol);
            float dR = max(diffR.r, max(diffR.g, diffR.b));
            float dD = max(diffD.r, max(diffD.g, diffD.b));

            float isRough = 1.0 - smoothstep(0.02, 0.07, dR);
            float isDeep  = 1.0 - smoothstep(0.02, 0.07, dD);
            float roughness = max(isRough, isDeep);

            // Hard discard where definitely not rough
            if (roughness < 0.01) discard;

            // Height scaling per biome type
            float targetH = isDeep > 0.5 ? uDeepH : uRoughH;
            float eL = vL * (uMaxHeight / max(targetH, 0.001));
            if (eL > 1.0) discard;

            // --- Organic grass density via smooth noise ---
            vec2 wXZ = vWorldPos.xz;

            // Multi-scale noise for natural clumping
            float density = fbm(wXZ * 1.5);              // large clumps ~2m
            float detail  = vnoise(wXZ * 8.0);            // fine variation ~12cm
            float micro   = vnoise(wXZ * 25.0 + 73.0);   // micro texture ~4cm

            float grassDensity = density * 0.5 + detail * 0.3 + micro * 0.2;

            // Layer-based opacity: dense base → transparent tips
            float layerFade = 1.0 - eL * eL;  // quadratic falloff

            // Final alpha: smooth and organic
            float alpha = layerFade * (0.3 + 0.7 * grassDensity) * roughness;

            // Bottom layers more opaque for ground coverage
            if (uLayer <= 1.0) alpha = roughness * 0.6;

            // --- Color ---
            vec3 baseCol = isDeep > 0.5 ? uDeepCol : uRoughCol;

            // Height gradient: slightly darker base (AO), warmer/brighter tips
            float brightness = mix(0.80, 1.15, eL);
            vec3 col = baseCol * brightness;

            // Subtle per-area color variation
            float colorVar = vnoise(wXZ * 0.5 + 200.0);
            col *= 0.90 + 0.20 * colorVar;

            // Warm yellow-green tips in sunlight
            col += vec3(0.015, 0.02, -0.005) * eL;

            // Edge softening: fade near biome boundaries
            float edgeFade = smoothstep(0.01, 0.06, roughness);
            alpha *= edgeFade;

            // Clamp
            alpha = clamp(alpha, 0.0, 0.95);

            gl_FragColor = vec4(col, alpha);
        }
    `;

    // ─── Manager Class ──────────────────────────────────────────

    class TerrainShellManager {
        constructor(chunkMgr, scene, biomeTex) {
            this.chunkMgr = chunkMgr;
            this.scene = scene;
            this.biomeTex = biomeTex;
            this.quality = 'OFF';
            this.shells = [];
            this._frame = 0;

            this.roughHeight = 0.08;   // 8cm
            this.deepHeight  = 0.22;   // 22cm

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

            // Animate wind every frame
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

                let cx = -half + ((c.gxStart + c.gxEnd) * 0.5) * step;
                let cz = -half + ((c.gzStart + c.gzEnd) * 0.5) * step;
                let dx = camera.position.x - cx, dz = camera.position.z - cz;
                let dist = Math.sqrt(dx * dx + dz * dz);

                s.mesh.visible = dist < preset.maxDist;

                if (s.mesh.geometry !== c.geo) s.mesh.geometry = c.geo;
            }

            // Sync wind
            let ws = (window.windSpeed || 0) / 30;
            let wa = (window.windAngle || 0) * Math.PI / 180;
            for (let s of this.shells) {
                s.mat.uniforms.uWindStr.value = ws;
                s.mat.uniforms.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
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
                for (let layer = 0; layer < preset.layers; layer++) {
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
                transparent: true,
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
