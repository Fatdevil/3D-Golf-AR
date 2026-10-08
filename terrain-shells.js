// ================================================================
//  TERRAIN SHELL MANAGER v7 — Mask-texture based (no color matching)
//
//  Near:  Full 3D shell layers with FBM silhouettes (discard-based)
//  Far:   Single flat tint layer darkens rough areas (alpha blend)
//  Result: Rough looks different at ALL distances, 3D up close
//
//  v7: Uses separate rough mask texture instead of fragile color
//      matching. Immune to noise, blending, and texture filtering.
//      Shells render on the MASTER terrain mesh directly.
// ================================================================
(function() {
    'use strict';

    const _isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);

    const QUALITY = {
        OFF:  { layers: 0, maxDist: 0 },
        // interior: how many shells are drawn well inside the grass (the edges, where the height shows, get all of them)
        LOW:  { layers: 3, maxDist: 60,  interior: 1 },
        MED:  { layers: 5, maxDist: 120, interior: 2 },
        HIGH: { layers: 8, maxDist: 250, interior: 2 }
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
        varying vec3 vWorldNormal;
        varying float vSlope;
        varying float vCamDist;

        void main() {
            vUv = uv;
            vL  = uLayer / max(uLayers, 1.0);
            vSlope = 1.0 - abs(normal.z);
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

            // Natural slope scaling: grass compresses smoothly on steep slopes (>30°-60°)
            // so layers stay tightly packed along surface normal without slicing gaps,
            // while remaining seamless, lush ground cover (no hard culling or blotches).
            float slopeHeightScale = mix(0.35, 1.0, 1.0 - smoothstep(0.18, 0.55, vSlope));

            vec3 up = vec3(0.0, 0.0, 1.0);
            vec3 trueN = normalize(normal);
            vec3 dir = mix(up, trueN, smoothstep(0.08, 0.30, vSlope));
            
            float slopeBias = smoothstep(0.08, 0.30, vSlope) * 0.035;
            float layerDisp = max(vL * uMaxHeight * slopeHeightScale, slopeBias);
            vec3 p = position + dir * layerDisp;

            // Wind sway (disabled for visual stability and performance)
            /*
            float sway = vL * vL * uWindStr * 0.6;
            float w1 = sin(uTime * 1.4 + p.x * 0.06 + p.y * 0.04);
            float w2 = sin(uTime * 2.1 + p.y * 0.09 + p.x * 0.03);
            p.x += uWindDir.x * sway * (w1 * 0.6 + w2 * 0.4);
            p.y -= uWindDir.y * sway * (w1 * 0.6 + w2 * 0.4);
            */

            vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
            vCamDist = distance(vWorldPos, cameraPosition);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `;

    const FRAG = `
        uniform sampler2D uRoughMask;
        uniform sampler2D uWaterMap;
        uniform vec3  uRoughCol;
        uniform vec3  uDeepCol;
        uniform vec3  uSemiCol;
        uniform vec3  uForeCol;
        uniform vec3  uSandCol;
        uniform float uRoughH;
        uniform float uDeepH;
        uniform float uSemiH;
        uniform float uLayers;
        uniform float uLayer;
        uniform sampler2D uEdgeMap;
        uniform float uInteriorLayers;
        uniform float uEdgeOn;
        uniform float uMaxHeight;
        uniform float uMaxDist;
        uniform vec2  uWindDir;

        // Dynamic light uniforms synced with scene
        uniform vec3  uLightDir;
        uniform vec3  uDirColor;
        uniform vec3  uAmbColor;

        uniform float uGridMode;
        uniform float uShowRings;
        uniform vec2  uTeePos;

        float evalTerrainGridLine(vec2 p, float size, float halfWidth) {
            vec2 coord = p / size;
            vec2 fw = max(fwidth(coord), vec2(0.00005));
            vec2 gridDist = abs(fract(coord - 0.5) - 0.5);
            vec2 line = smoothstep(fw * halfWidth, vec2(0.0), gridDist);
            return max(line.x, line.y);
        }

        varying vec2  vUv;
        varying float vL;
        varying vec3  vWorldPos;
        varying vec3  vWorldNormal;
        varying float vSlope;
        varying float vCamDist;

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
            // Distance check & dither fade
            if (vCamDist > uMaxDist) discard;
            float distFade = 1.0 - smoothstep(uMaxDist * 0.75, uMaxDist, vCamDist);
            if (hash(vWorldPos.xz * 37.0) > distFade) discard;

            // Edge-weighted shells: the height of the grass shows at its borders (against fairway, green and sand), where the
            // silhouette is seen from the side. Well inside the grass only every stride-th shell is drawn: the same total height
            // with fewer layers. uEdgeMap is 1 at a border and fades to 0 a few metres in; a dither makes the change gradual.
            // This comes before the texture reads and the noise below, so the skipped shells cost almost nothing.
            if (uEdgeOn > 0.5) {
                float stride = max(1.0, floor(uLayers / max(uInteriorLayers, 1.0)));
                if (mod(uLayer, stride) > 0.5) {
                    float nearEdge = smoothstep(0.0, 0.35, texture2D(uEdgeMap, vUv).r);
                    if (hash(vWorldPos.xz * 53.0) > nearEdge) discard;
                }
            }


            // ── Water exclusion: no 3D grass inside water bodies or on submerged banks ──
            float waterMask = texture2D(uWaterMap, vUv).r;
            if (waterMask > 0.05) discard;
            float shoreFade = 1.0 - smoothstep(0.005, 0.04, waterMask);
            if (shoreFade < 0.05) discard;

            // ── Biome mask: R=rough, G=deep, B=semi-rough ──
            vec3 mask = texture2D(uRoughMask, vUv).rgb;
            float isRough = step(0.75, mask.r);                    // R=1.0
            float isDeep  = step(0.75, mask.g);                    // G=1.0
            float isSemi  = step(0.75, mask.b);                    // B=1.0
            float roughness = max(max(isRough, isDeep), isSemi);
            if (roughness < 0.1) discard;

            // Pick color and height based on dominant biome channel (pure canvas colors)
            vec3 baseCol;
            float targetH;
            if (isDeep > 0.5) {
                baseCol = uDeepCol;
                targetH = uDeepH;
            } else if (isRough > 0.5) {
                baseCol = uRoughCol;
                targetH = uRoughH;
            } else {
                baseCol = uSemiCol;
                targetH = uSemiH;
            }
            // a short grass is never thinner than the first shell (low quality has few, tall layers)
            targetH = max(targetH, uMaxHeight / max(uLayers, 1.0));

            // Height-proportional layer culling with soft fade
            float eL = vL * (uMaxHeight / max(targetH, 0.001));
            float heightFade = 1.0 - smoothstep(0.85, 1.05, eL);
            if (heightFade < 0.05) discard;

            vec2 wXZ = vWorldPos.xz;

            // Dense, fine-grained turf structure (uniform coverage without coarse blotchy clumps)
            float tuft = fbm(wXZ * 5.0 + 50.0);
            float blade = vnoise(wXZ * 20.0 + 100.0);
            float grass = tuft * 0.5 + blade * 0.5;

            // Gentle threshold: bottom layers keep ~90% pixels, top ~60%
            // On slopes: bottom layers are fully solid to prevent terrain showing through
            float slopeCompensation = smoothstep(0.10, 0.40, vSlope);
            float baseThreshold = eL * eL * 0.40;
            float threshold = baseThreshold * (1.0 - slopeCompensation * (1.0 - eL));
            if (grass < threshold) discard;

            // Softer edge fade at biome boundaries
            float edgeThreshold = threshold + (1.0 - roughness) * 0.15;
            if (grass < edgeThreshold) discard;

            // Pure uniform color matching canvas 1:1 at tips, with deep vertical cavity shadow (AO) at roots
            // Natural root-to-tip ambient occlusion (0.72 at root to 1.0 at tip) reveals 3D tuft volume without horizontal blotches
            float normH = clamp(eL, 0.0, 1.0);
            float aoBase = mix(0.72, 0.82, slopeCompensation);
            float ao = mix(aoBase, 1.0, normH);
            vec3 col = baseCol * ao;

            // Apply dynamic diffuse lighting matching the terrain plane
            vec3 N = normalize(vWorldNormal);
            vec3 L = uLightDir;
            // Foliage diffuse wrap: softens harsh shadow cutoff on steep cuts and banks
            float wrap = smoothstep(0.10, 0.40, vSlope) * 0.20;
            float dotNL = max(0.0, (dot(N, L) + wrap) / (1.0 + wrap));
            vec3 lightColor = uAmbColor + uDirColor * dotNL;
            col *= lightColor;

            // Builder spatial measurement grid & range rings on 3D grass
            if (uGridMode > 0.5) {
                float gridVal = 0.0;
                vec3 gridCol = vec3(0.35, 0.85, 1.0);
                if (uGridMode < 1.5) {
                    float majLine = evalTerrainGridLine(wXZ, 100.0, 1.6);
                    float minLine = evalTerrainGridLine(wXZ, 25.0, 1.1);
                    gridVal = max(majLine * 0.50, minLine * 0.22);
                } else if (uGridMode < 2.5) {
                    gridVal = evalTerrainGridLine(wXZ, 50.0, 1.3) * 0.40;
                } else {
                    gridVal = evalTerrainGridLine(wXZ, 100.0, 1.6) * 0.50;
                }
                float originX = smoothstep(max(fwidth(wXZ.x) * 2.0, 0.2), 0.0, abs(wXZ.x));
                float originZ = smoothstep(max(fwidth(wXZ.y) * 2.0, 0.2), 0.0, abs(wXZ.y));
                gridVal = max(gridVal, max(originX, originZ) * 0.4);
                col = mix(col, gridCol, gridVal);
            }
            if (uShowRings > 0.5) {
                float distTee = distance(wXZ, uTeePos);
                if (distTee >= 75.0 && distTee <= 325.0) {
                    float ringMod = abs(fract((distTee - 25.0) / 50.0) - 0.5) * 50.0;
                    float fwR = max(fwidth(distTee), 0.05);
                    float ringLine = smoothstep(fwR * 1.5, 0.0, ringMod);
                    vec3 ringCol = vec3(0.98, 0.75, 0.14);
                    col = mix(col, ringCol, ringLine * 0.65);
                }
            }

            gl_FragColor = vec4(col, 1.0);
        }
    `;

    // ─── Edge blades: real tapered blades along the borders of the grass ─────────────
    // Where the grass meets fairway, green or sand the height shows in the silhouette. A thin strip of blades there
    // (a few thousand, only near the camera) gives what the shells cannot: separate, pointed blades.
    const BLADE_VERT = `
        attribute vec3 iBase;     // blade root (world)
        attribute vec4 iParam;    // height, yaw, lean, shade
        attribute float iClass;   // 0 rough, 1 deep rough, 2 semi-rough
        uniform float uWidth;
        uniform vec3 uRoughCol;
        uniform vec3 uDeepCol;
        uniform vec3 uSemiCol;
        varying vec3 vCol;
        varying float vDist;
        void main() {
            float t = position.y;                                   // 0 at the root, 1 at the tip
            float w = position.x * uWidth * (1.0 - 0.9 * t);        // tapers to a point
            vec3 l = vec3(w, t * iParam.x, iParam.z * t * t * iParam.x);   // bends over towards its lean
            float c = cos(iParam.y), s = sin(iParam.y);
            vec3 wp = iBase + vec3(l.x * c + l.z * s, l.y, -l.x * s + l.z * c);
            vec3 base = iClass < 0.5 ? uRoughCol : (iClass < 1.5 ? uDeepCol : uSemiCol);
            vCol = base * mix(0.55, 1.12, t) * iParam.w;            // darker at the root, lighter at the tip
            vDist = distance(wp, cameraPosition);
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
    `;
    const BLADE_FRAG = `
        uniform float uMaxDist;
        uniform vec3 uLightDir;
        uniform vec3 uDirColor;
        uniform vec3 uAmbColor;
        varying vec3 vCol;
        varying float vDist;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
            if (vDist > uMaxDist) discard;
            float fade = 1.0 - smoothstep(uMaxDist * 0.7, uMaxDist, vDist);
            if (hash2(gl_FragCoord.xy) > fade) discard;
            vec3 light = uAmbColor + uDirColor * max(0.0, uLightDir.y * 0.8 + 0.2);
            gl_FragColor = vec4(vCol * light, 1.0);
        }
    `;
    // blades per boundary cell and how far away they are drawn, per quality
    const BLADES = {
        LOW:  { perCell: 3,  maxDist: 40 },
        MED:  { perCell: 6,  maxDist: 70 },
        HIGH: { perCell: 10, maxDist: 120 }
    };
    const BLADE_CHUNK = 48;      // metres: blades are grouped in chunks that are culled and hidden by distance
    const BLADE_WIDTH = 0.025;   // metres at the root (stylised: a real blade is a few millimetres)

    // ─── Manager ─────────────────────────────────────────────────

    class TerrainShellManager {
        constructor(masterGeo, masterMesh, scene, biomeTex, roughMaskTex, waterTex) {
            this.masterGeo = masterGeo;
            this.masterMesh = masterMesh;
            this.scene = scene;
            this.biomeTex = biomeTex;
            this.roughMaskTex = roughMaskTex || null;
            this.waterTex = waterTex || (typeof window !== 'undefined' ? window.waterTex : null) || null;
            this.quality = 'OFF';
            this.shells = [];   // { layer, mesh, mat }
            // Draw all shells only near borders (see the fragment shader). Off by default until it has been tried on a phone:
            // ?grassedge=1 in the address turns it on (and remembers it), ?grassedge=0 turns it off again.
            let edgeFlag = null;
            try {
                const q = new URLSearchParams(window.location.search).get('grassedge');
                if (q !== null) localStorage.setItem('golf_grass_edge', q === '1' ? '1' : '0');
                edgeFlag = localStorage.getItem('golf_grass_edge');
            } catch (e) { /* storage blocked: stays off */ }
            this.edgeWeighted = edgeFlag === '1';
            this.edgeWidth = 4.0;       // metres from a border where all shells are drawn
            // Edge blades: also off by default; ?grassblades=1 turns them on (and remembers it), ?grassblades=0 turns them off.
            let bladeFlag = null;
            try {
                const bq = new URLSearchParams(window.location.search).get('grassblades');
                if (bq !== null) localStorage.setItem('golf_grass_blades', bq === '1' ? '1' : '0');
                bladeFlag = localStorage.getItem('golf_grass_blades');
            } catch (e) { /* storage blocked: stays off */ }
            this.bladesOn = bladeFlag === '1';
            this.blades = [];        // { mesh, count, cx, cz, r }
            this._bladeMat = null;
            this._cls = null;        // 1024x1024 grass class per cell: 0 none, 1 rough, 2 deep, 3 semi
            this._edgeTex = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
            this._edgeTex.needsUpdate = true;   // 1x1 'everything is an edge' until the mask has been built
            this._frame = 0;

            // 1x1 black dummy texture fallback so shader never fails if waterTex is null
            let blackPixel = new Uint8Array([0, 0, 0, 255]);
            this._dummyWaterTex = new THREE.DataTexture(blackPixel, 1, 1, THREE.RGBAFormat);
            this._dummyWaterTex.needsUpdate = true;

            // fairway is the cut surface (no shells); semi-rough, rough and deep rough stand above it (metres).
            // The heights are exaggerated on purpose: with real heights (4-8 cm) the shells cannot be seen at game distances.
            this.semiHeight  = 0.12;
            this.roughHeight = 0.30;
            this.deepHeight  = 0.60;

            this._roughCol = new THREE.Vector3();
            this._deepCol  = new THREE.Vector3();
            this._semiCol  = new THREE.Vector3();
            this._foreCol  = new THREE.Vector3();
            this._sandCol  = new THREE.Vector3();
            this._updateColors();

            // Track hex colors to auto-update on biome change
            let cfg = window.CURRENT_BIOME_CONFIG || {};
            this._lastRoughHex = cfg.roughColor || '#4a782b';
            this._lastDeepHex = cfg.fescueColor || '#2d4c1a';
            this._lastSemiHex = cfg.semiColor || '#6b9e3d';
            this._lastForeHex = cfg.foregreenColor || '#8bc45d';
            this._lastSandHex = cfg.bunkerColor || '#e0d8a4';
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

            // Track and update colors if CURRENT_BIOME_CONFIG changed (for Autumn, Winter, custom color picker)
            let cfg = window.CURRENT_BIOME_CONFIG || {};
            let rHex = cfg.roughColor || '#4a782b';
            let dHex = cfg.fescueColor || '#2d4c1a';
            let sHex = cfg.semiColor || '#6b9e3d';
            let fHex = cfg.foregreenColor || '#8bc45d';
            let bHex = cfg.bunkerColor || '#e0d8a4';
            if (rHex !== this._lastRoughHex || dHex !== this._lastDeepHex || sHex !== this._lastSemiHex || fHex !== this._lastForeHex || bHex !== this._lastSandHex) {
                this._lastRoughHex = rHex;
                this._lastDeepHex = dHex;
                this._lastSemiHex = sHex;
                this._lastForeHex = fHex;
                this._lastSandHex = bHex;
                this.updateColors();
            }

            // Sync dynamic scene lighting
            let G = window.G || {};
            let al = G.ambientLight;
            let dl = G.dirLight;

            let ambR = 0.5, ambG = 0.5, ambB = 0.5;
            if (al) {
                let ai = al.intensity;
                ambR = al.color.r * ai;
                ambG = al.color.g * ai;
                ambB = al.color.b * ai;
            }

            let dirR = 1.0, dirG = 1.0, dirB = 1.0;
            let lx = 50.0, ly = 100.0, lz = 50.0;
            if (dl) {
                let di = dl.intensity;
                dirR = dl.color.r * di;
                dirG = dl.color.g * di;
                dirB = dl.color.b * di;
                lx = dl.position.x;
                ly = dl.position.y;
                lz = dl.position.z;
            }

            // Normalize light direction
            let len = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1.0;
            lx /= len; ly /= len; lz /= len;

            this._updateBlades(camera, lx, ly, lz, dirR, dirG, dirB, ambR, ambG, ambB);

            let curWaterTex = this.waterTex || (typeof window !== 'undefined' ? window.waterTex : null) || this._dummyWaterTex;

            for (let s of this.shells) {
                s.mat.uniforms.uTime.value = time;
                s.mat.uniforms.uLightDir.value.set(lx, ly, lz);
                s.mat.uniforms.uDirColor.value.set(dirR, dirG, dirB);
                s.mat.uniforms.uAmbColor.value.set(ambR, ambG, ambB);

                if (s.mat.uniforms.uWaterMap && s.mat.uniforms.uWaterMap.value !== curWaterTex) {
                    s.mat.uniforms.uWaterMap.value = curWaterTex;
                }

                if (window.terrainShaderUniforms) {
                    if (s.mat.uniforms.uGridMode) s.mat.uniforms.uGridMode.value = window.terrainShaderUniforms.uGridMode.value;
                    if (s.mat.uniforms.uShowRings) s.mat.uniforms.uShowRings.value = window.terrainShaderUniforms.uShowRings.value;
                    if (s.mat.uniforms.uTeePos) s.mat.uniforms.uTeePos.value.copy(window.terrainShaderUniforms.uTeePos.value);
                }

                // Dynamic maxDist: desktop build=unlimited, mobile play=reduced
                let isPlayMode = window.terrainShaderUniforms && window.terrainShaderUniforms.uPlayMode.value > 0.5;
                let preset = QUALITY[this.quality];
                if (!preset) continue;
                if (_isMobile && isPlayMode) {
                    s.mat.uniforms.uMaxDist.value = preset.maxDist * 0.6;
                } else if (!_isMobile && !isPlayMode) {
                    // CODEX M2 FIX: Desktop build scales comfortably (LOW=100m, MED=200m, HIGH=9999m)
                    s.mat.uniforms.uMaxDist.value = this.quality === 'HIGH' ? 9999 : preset.maxDist * 1.6;
                } else {
                    s.mat.uniforms.uMaxDist.value = preset.maxDist;
                }
            }
        }

        updateColors() {
            this._updateColors();
            for (let s of this.shells) {
                s.mat.uniforms.uRoughCol.value.copy(this._roughCol);
                s.mat.uniforms.uDeepCol.value.copy(this._deepCol);
                s.mat.uniforms.uSemiCol.value.copy(this._semiCol);
                s.mat.uniforms.uForeCol.value.copy(this._foreCol);
                s.mat.uniforms.uSandCol.value.copy(this._sandCol);
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
            this._scheduleBladeHeights();
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
                // CODEX M5 FIX: Allow gx/gz to reach mSegs so the outer edge boundary is sampled with fx/fz = 1.0
                gx = Math.max(0, Math.min(mSegs, gx));
                gz = Math.max(0, Math.min(mSegs, gz));
                let ix = Math.min(mSegs - 1, Math.floor(gx));
                let iz = Math.min(mSegs - 1, Math.floor(gz));
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

        // CODEX M1 FIX: Smooth 60 FPS live shader uniforms update without rebuilding geometry or meshes
        setHeights(roughH, deepH) {
            this.roughHeight = roughH;
            this.deepHeight = deepH;
            this.semiHeight = Math.max(0.03, roughH * 0.4); // semi-rough follows the rough slider at 40 % of its height
            let maxH = Math.max(roughH, deepH, this.semiHeight);
            for (let s of this.shells) {
                if (s.mat && s.mat.uniforms) {
                    s.mat.uniforms.uRoughH.value = roughH;
                    s.mat.uniforms.uDeepH.value = deepH;
                    s.mat.uniforms.uSemiH.value = this.semiHeight;
                    s.mat.uniforms.uMaxHeight.value = maxH;
                }
            }
        }

        refresh() { this._rebuild(); }

        setEdgeWeighted(on) {
            this.edgeWeighted = !!on;
            for (let s of this.shells) if (s.mat && s.mat.uniforms.uEdgeOn) s.mat.uniforms.uEdgeOn.value = this.edgeWeighted ? 1 : 0;
        }

        setBlades(on) {
            this.bladesOn = !!on;
            this._buildBlades();
        }

        _clearBlades() {
            for (let b of this.blades) { if (b.mesh.parent) this.scene.remove(b.mesh); b.mesh.geometry.dispose(); }
            this.blades = [];
        }

        // Blades along every border between shell grass and anything else, from the class map built with the edge map.
        _buildBlades() {
            this._clearBlades();
            const preset = BLADES[this.quality];
            if (!this.bladesOn || !preset || !this._cls) return;
            const n = 1024, cls = this._cls, world = window.TERRAIN_SIZE || 600, cell = world / n, half = world / 2;
            const heights = [0, this.roughHeight, this.deepHeight, this.semiHeight];
            const gh = typeof window.getTerrainHeight === 'function' ? window.getTerrainHeight : null;
            const per = preset.perCell, perAxis = Math.ceil(world / BLADE_CHUNK);
            const chunks = new Map();
            // a deterministic random number per cell and blade: the blades keep their place when the mask is rebuilt
            const rnd = function (cellIdx, k) { let h = Math.imul(cellIdx + 1, 374761393) ^ Math.imul(k + 1, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    const c = cls[y * n + x];
                    if (!c) continue;
                    let dx = 0, dz = 0;   // towards the neighbouring non-grass cells
                    if (x > 0 && !cls[y * n + x - 1]) dx -= 1;
                    if (x < n - 1 && !cls[y * n + x + 1]) dx += 1;
                    if (y > 0 && !cls[(y - 1) * n + x]) dz -= 1;
                    if (y < n - 1 && !cls[(y + 1) * n + x]) dz += 1;
                    if (!dx && !dz) continue;
                    const ci = y * n + x;
                    for (let k = 0; k < per; k++) {
                        // anywhere inside the border cell (the cell is the grass next to the border, so the roots sit at the edge)
                        const wx = (x + 0.5 + (rnd(ci, k * 5) - 0.5)) * cell - half;
                        const wz = (y + 0.5 + (rnd(ci, k * 5 + 1) - 0.5)) * cell - half;
                        const key = Math.min(perAxis - 1, Math.max(0, Math.floor((wx + half) / BLADE_CHUNK))) * perAxis + Math.min(perAxis - 1, Math.max(0, Math.floor((wz + half) / BLADE_CHUNK)));
                        let ch = chunks.get(key);
                        if (!ch) { ch = []; chunks.set(key, ch); }
                        ch.push(wx, gh ? gh(wx, wz) : 0, wz,
                            heights[c] * (0.75 + rnd(ci, k * 5 + 2) * 0.5), rnd(ci, k * 5 + 3) * Math.PI * 2, 0.1 + rnd(ci, k * 5 + 4) * 0.3, 0.85 + rnd(ci, k * 5 + 2) * 0.25,
                            c - 1 === 0 ? 0 : (c === 2 ? 1 : 2));
                    }
                }
            }
            if (!this._bladeMat) {
                this._bladeMat = new THREE.ShaderMaterial({
                    uniforms: {
                        uWidth: { value: BLADE_WIDTH }, uMaxDist: { value: preset.maxDist },
                        uRoughCol: { value: this._roughCol.clone() }, uDeepCol: { value: this._deepCol.clone() }, uSemiCol: { value: this._semiCol.clone() },
                        uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uDirColor: { value: new THREE.Vector3(1, 1, 1) }, uAmbColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) }
                    },
                    vertexShader: BLADE_VERT, fragmentShader: BLADE_FRAG, side: THREE.DoubleSide
                });
            }
            this._bladeMat.uniforms.uMaxDist.value = preset.maxDist;
            // one blade: 7 vertices, 5 triangles (x = across, y = 0 root .. 1 tip)
            const tpl = new Float32Array([-0.5,0,0, 0.5,0,0, -0.5,0.4,0, 0.5,0.4,0, -0.5,0.75,0, 0.5,0.75,0, 0,1,0]);
            const idx = [0,1,2, 1,3,2, 2,3,4, 3,5,4, 4,5,6];
            chunks.forEach(function (arr, key) {
                const count = arr.length / 8, base = new Float32Array(count * 3), param = new Float32Array(count * 4), klass = new Float32Array(count);
                let minY = 1e9, maxY = -1e9, maxH = 0;
                for (let i = 0; i < count; i++) {
                    const o = i * 8;
                    base[i * 3] = arr[o]; base[i * 3 + 1] = arr[o + 1]; base[i * 3 + 2] = arr[o + 2];
                    param[i * 4] = arr[o + 3]; param[i * 4 + 1] = arr[o + 4]; param[i * 4 + 2] = arr[o + 5]; param[i * 4 + 3] = arr[o + 6];
                    klass[i] = arr[o + 7];
                    minY = Math.min(minY, arr[o + 1]); maxY = Math.max(maxY, arr[o + 1]); maxH = Math.max(maxH, arr[o + 3]);
                }
                const geo = new THREE.InstancedBufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(tpl, 3));
                geo.setIndex(idx);
                geo.setAttribute('iBase', new THREE.InstancedBufferAttribute(base, 3));
                geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(param, 4));
                geo.setAttribute('iClass', new THREE.InstancedBufferAttribute(klass, 1));
                geo.instanceCount = count;
                const cx = (Math.floor(key / perAxis) + 0.5) * BLADE_CHUNK - half, cz = ((key % perAxis) + 0.5) * BLADE_CHUNK - half;
                const r = BLADE_CHUNK * 0.71 + (maxY - minY) + maxH + 2;
                geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), r);
                const mesh = new THREE.Mesh(geo, this._bladeMat);
                mesh.frustumCulled = true;
                mesh.renderOrder = 120;
                this.scene.add(mesh);
                this.blades.push({ mesh: mesh, count: count, cx: cx, cz: cz, r: r });
            }, this);
            console.log('[Shells] Edge blades:', this.blades.reduce(function (a, b) { return a + b.count; }, 0), 'in', this.blades.length, 'chunks');
        }

        // the terrain was reshaped: the blade roots follow it (a moment after the last change)
        _scheduleBladeHeights() {
            if (!this.blades.length || typeof window.getTerrainHeight !== 'function') return;
            clearTimeout(this._bladeTimer);
            this._bladeTimer = setTimeout(() => {
                for (let b of this.blades) {
                    const a = b.mesh.geometry.attributes.iBase, arr = a.array;
                    for (let i = 0; i < b.count; i++) arr[i * 3 + 1] = window.getTerrainHeight(arr[i * 3], arr[i * 3 + 2]);
                    a.needsUpdate = true;
                }
            }, 300);
        }

        _updateBlades(camera, lx, ly, lz, dirR, dirG, dirB, ambR, ambG, ambB) {
            if (!this.blades.length || !this._bladeMat) return;
            const u = this._bladeMat.uniforms, maxD = u.uMaxDist.value;
            u.uLightDir.value.set(lx, ly, lz); u.uDirColor.value.set(dirR, dirG, dirB); u.uAmbColor.value.set(ambR, ambG, ambB);
            u.uRoughCol.value.copy(this._roughCol); u.uDeepCol.value.copy(this._deepCol); u.uSemiCol.value.copy(this._semiCol);
            if (!camera) return;
            const cp = camera.position;
            for (let b of this.blades) b.mesh.visible = Math.hypot(cp.x - b.cx, cp.z - b.cz) - b.r < maxD;
        }

        // maskRGBA: the rough mask (srcSize x srcSize, R=rough G=deep B=semi). Builds a coarse "closeness to a border" map:
        // 1 on and next to a border with anything that is not shell grass (fairway, green, sand), fading to 0 over edgeWidth.
        setEdgeMapFromMask(maskRGBA, srcSize) {
            const n = 1024, step = Math.max(1, Math.floor(srcSize / n)), half = step >> 1;
            const worldSize = window.TERRAIN_SIZE || 600;
            const width = Math.max(1.5, this.edgeWidth / (worldSize / n));   // in cells
            const d = new Float32Array(n * n), INF = 1e9;
            const cls = new Uint8Array(n * n);
            for (let y = 0; y < n; y++) {
                const row = (y * step + half) * srcSize;
                for (let x = 0; x < n; x++) {
                    const i = (row + x * step + half) * 4;
                    const c = maskRGBA[i] === 255 ? 1 : (maskRGBA[i + 1] === 255 ? 2 : (maskRGBA[i + 2] === 255 ? 3 : 0));
                    cls[y * n + x] = c;
                    d[y * n + x] = c ? INF : 0;
                }
            }
            this._cls = cls;
            for (let y = 0; y < n; y++) {            // distance to the nearest non-grass cell (two-pass chamfer)
                for (let x = 0; x < n; x++) {
                    let v = d[y * n + x];
                    if (x > 0) v = Math.min(v, d[y * n + x - 1] + 1);
                    if (y > 0) {
                        v = Math.min(v, d[(y - 1) * n + x] + 1);
                        if (x > 0) v = Math.min(v, d[(y - 1) * n + x - 1] + 1.414);
                        if (x < n - 1) v = Math.min(v, d[(y - 1) * n + x + 1] + 1.414);
                    }
                    d[y * n + x] = v;
                }
            }
            const out = new Uint8Array(n * n);
            for (let y = n - 1; y >= 0; y--) {
                for (let x = n - 1; x >= 0; x--) {
                    let v = d[y * n + x];
                    if (x < n - 1) v = Math.min(v, d[y * n + x + 1] + 1);
                    if (y < n - 1) {
                        v = Math.min(v, d[(y + 1) * n + x] + 1);
                        if (x < n - 1) v = Math.min(v, d[(y + 1) * n + x + 1] + 1.414);
                        if (x > 0) v = Math.min(v, d[(y + 1) * n + x - 1] + 1.414);
                    }
                    d[y * n + x] = v;
                    // a DataTexture has row 0 at v=0, the canvas-based mask has it at v=1: rows are stored flipped
                    out[(n - 1 - y) * n + x] = Math.round(255 * (1 - Math.min(v / width, 1)));
                }
            }
            const old = this._edgeTex;
            const tex = new THREE.DataTexture(out, n, n, THREE.RedFormat, THREE.UnsignedByteType);
            tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.needsUpdate = true;
            this._edgeTex = tex;
            for (let s of this.shells) if (s.mat && s.mat.uniforms.uEdgeMap) s.mat.uniforms.uEdgeMap.value = tex;
            if (old && old.dispose) old.dispose();
            this._buildBlades();
        }

        getStats() {
            let visible = 0, tris = 0;
            // CODEX L1 FIX: Use actual shell segments instead of TERRAIN_SEGS
            let segs = (this.customGeo && this.customGeo.parameters && this.customGeo.parameters.widthSegments) ? this.customGeo.parameters.widthSegments : 200;
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

            this._buildBlades();   // the number of blades follows the quality
            let preset = QUALITY[this.quality];
            // CODEX L2 FIX: Free customGeo vertex buffer from memory when quality is OFF
            if (!preset || preset.layers === 0) {
                if (this.customGeo) {
                    this.customGeo.dispose();
                    this.customGeo = null;
                }
                return;
            }

            this._updateColors();
            let maxH = Math.max(this.roughHeight, this.deepHeight, this.semiHeight);
            
            // Decouple from Green Grid! Cap 3D grass resolution at max 200.
            let shellSegs = Math.min(window._terrainGridSegs || 200, 200);
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
            let preset = QUALITY[this.quality] || { maxDist: 250 };
            let maxDist = preset.maxDist || 250;
            return new THREE.ShaderMaterial({
                extensions: { derivatives: true },
                uniforms: {
                    uLayer:    { value: layer },
                    uLayers:   { value: total },
                    uMaxHeight:{ value: maxH },
                    uRoughH:   { value: this.roughHeight },
                    uDeepH:    { value: this.deepHeight },
                    uSemiH:    { value: this.semiHeight },
                    uEdgeMap:  { value: this._edgeTex },
                    uInteriorLayers: { value: preset.interior || 2 },
                    uEdgeOn:   { value: this.edgeWeighted ? 1 : 0 },
                    uWindDir:  { value: new THREE.Vector2(1, 0) },
                    uWindStr:  { value: 0.3 },
                    uTime:     { value: 0 },
                    uRoughMask:{ value: this.roughMaskTex },
                    uWaterMap: { value: this.waterTex || (typeof window !== 'undefined' ? window.waterTex : null) || this._dummyWaterTex },
                    uRoughCol: { value: this._roughCol.clone() },
                    uDeepCol:  { value: this._deepCol.clone() },
                    uSemiCol:  { value: this._semiCol.clone() },
                    uForeCol:  { value: this._foreCol.clone() },
                    uSandCol:  { value: this._sandCol.clone() },
                    uMaxDist:  { value: maxDist },
                    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
                    uDirColor: { value: new THREE.Vector3(1, 1, 1) },
                    uAmbColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
                    uGridMode: { value: (window.terrainShaderUniforms && window.terrainShaderUniforms.uGridMode) ? window.terrainShaderUniforms.uGridMode.value : 0.0 },
                    uShowRings: { value: (window.terrainShaderUniforms && window.terrainShaderUniforms.uShowRings) ? window.terrainShaderUniforms.uShowRings.value : 0.0 },
                    uTeePos: { value: (window.terrainShaderUniforms && window.terrainShaderUniforms.uTeePos) ? window.terrainShaderUniforms.uTeePos.value.clone() : new THREE.Vector2(0, 0) }
                },
                vertexShader: VERT,
                fragmentShader: FRAG,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: true,
                polygonOffset: true,
                polygonOffsetFactor: -(1 + layer * 0.5),
                polygonOffsetUnits: -(4 + layer * 2)
            });
        }

        _updateColors() {
            let cfg = window.CURRENT_BIOME_CONFIG || {};
            this._hexToVec(cfg.roughColor || '#4a782b', this._roughCol);
            this._hexToVec(cfg.fescueColor || '#2d4c1a', this._deepCol);
            this._hexToVec(cfg.semiColor || '#6b9e3d', this._semiCol);
            this._hexToVec(cfg.foregreenColor || '#8bc45d', this._foreCol);
            this._hexToVec(cfg.bunkerColor || '#e0d8a4', this._sandCol);
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
