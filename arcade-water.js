    // --- OPTIMIZED WATER VISUAL (100x100 = 20,000 tris, smooth fit without depth sag) ---
    const WATER_SEGS = 100;
    let waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, WATER_SEGS, WATER_SEGS);
    window._arcadeWaterGeo = waterGeo;
    waterGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    let wVisPos = waterGeo.attributes.position.array;
    for (let i = 2; i < wVisPos.length; i += 3) wVisPos[i] = -99.0;
    
    // --- WATER DATA ARRAY (terrain-res, for physics/painting/saving) ---
    let terrainVertCount = (window.TERRAIN_SEGS + 1) * (window.TERRAIN_SEGS + 1);
    window.waterData = new Float32Array(terrainVertCount).fill(-99);
    window.waterBaseZ = new Float32Array(terrainVertCount).fill(-99);
    
    // Sync waterData -> low-res visual mesh
    window.syncWaterVisual = function() {
        let vPos = waterGeo.attributes.position.array;
        let wSegs = WATER_SEGS;
        let tSegs = window.TERRAIN_SEGS;
        let half = TERRAIN_SIZE / 2;
        let wStep = TERRAIN_SIZE / wSegs;
        let tStep = TERRAIN_SIZE / tSegs;
        
        // Find the first painted water height to use as a local fallback,
        // otherwise use the global waterTableLevel.
        let defaultWaterLevel = (window.waterTableLevel != null) ? window.waterTableLevel : -0.5;
        if (window.waterData) {
            for (let i = 0; i < window.waterData.length; i++) {
                if (window.waterData[i] > -90) {
                    defaultWaterLevel = window.waterData[i];
                    break;
                }
            }
        }

        for (let wz = 0; wz <= wSegs; wz++) {
            for (let wx = 0; wx <= wSegs; wx++) {
                let worldX = -half + wx * wStep;
                let worldZ = -half + wz * wStep;
                let tx = Math.min(tSegs, Math.max(0, Math.round((worldX + half) / tStep)));
                let tz = Math.min(tSegs, Math.max(0, Math.round((worldZ + half) / tStep)));
                let tIdx = tz * (tSegs + 1) + tx;
                
                let val = window.waterData[tIdx];
                if (val <= -90) {
                    val = defaultWaterLevel;
                }
                
                let vIdx = (wz * (wSegs + 1) + wx) * 3 + 2;
                vPos[vIdx] = val;
            }
        }
        waterGeo.attributes.position.needsUpdate = true;
    };
    
    window.waterMat = new THREE.MeshLambertMaterial({ 
        color: 0x38bdf8, 
        transparent: true, 
        opacity: 1.0, 
        alphaMap: waterTex, 
        depthWrite: true,
        alphaTest: 0.05
    });
    const waterMesh = new THREE.Mesh(waterGeo, window.waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);
    window.waterMesh = waterMesh;

    // === WATER SHADER UNIFORMS & REFLECTION SYSTEM ===
    const _dummyReflectTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    _dummyReflectTex.needsUpdate = true;

    window.waterShaderUniforms = {
        uWaterQuality: { value: 1.0 }, // 0.0 = OFF, 1.0 = MED, 2.0 = HIGH
        uTime: { value: 0.0 },
        uWindDir: { value: new THREE.Vector2(1.0, 0.0) },
        uWindSpeed: { value: 0.0 },
        uSkyColor: { value: new THREE.Color(0x7dd3fc) },
        uHorizonColor: { value: new THREE.Color(0xbfe0f7) },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfffbeb) },
        uReflectorTex: { value: _dummyReflectTex },
        uTextureMatrix: { value: new THREE.Matrix4() },
        uHasReflector: { value: 0.0 }
    };

    window.waterMat.onBeforeCompile = (shader) => {
        shader.uniforms.uWaterQuality = window.waterShaderUniforms.uWaterQuality;
        shader.uniforms.uTime = window.waterShaderUniforms.uTime;
        shader.uniforms.uWindDir = window.waterShaderUniforms.uWindDir;
        shader.uniforms.uWindSpeed = window.waterShaderUniforms.uWindSpeed;
        shader.uniforms.uSkyColor = window.waterShaderUniforms.uSkyColor;
        shader.uniforms.uHorizonColor = window.waterShaderUniforms.uHorizonColor;
        shader.uniforms.uSunDir = window.waterShaderUniforms.uSunDir;
        shader.uniforms.uSunColor = window.waterShaderUniforms.uSunColor;
        shader.uniforms.uReflectorTex = window.waterShaderUniforms.uReflectorTex;
        shader.uniforms.uTextureMatrix = window.waterShaderUniforms.uTextureMatrix;
        shader.uniforms.uHasReflector = window.waterShaderUniforms.uHasReflector;

        shader.vertexShader = `
            varying vec3 vWaterWorldPos;
            varying vec4 vReflectCoord;
            uniform mat4 uTextureMatrix;
            uniform float uHasReflector;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            `#include <worldpos_vertex>`,
            `
            #include <worldpos_vertex>
            vWaterWorldPos = worldPosition.xyz;
            if (uHasReflector > 0.5) {
                vReflectCoord = uTextureMatrix * vec4(worldPosition.xyz, 1.0);
            } else {
                vReflectCoord = vec4(0.0);
            }
            `
        );

        shader.fragmentShader = `
            varying vec3 vWaterWorldPos;
            varying vec4 vReflectCoord;

            uniform float uWaterQuality;
            uniform float uTime;
            uniform vec2 uWindDir;
            uniform float uWindSpeed;
            uniform vec3 uSkyColor;
            uniform vec3 uHorizonColor;
            uniform vec3 uSunDir;
            uniform vec3 uSunColor;
            uniform sampler2D uReflectorTex;
            uniform float uHasReflector;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            `#include <dithering_fragment>`,
            `
            #include <dithering_fragment>

            if (uWaterQuality > 0.5) {
                vec3 V = normalize(cameraPosition - vWaterWorldPos);
                
                // Wind-driven wave ripples
                // At 0 MPH: waveAmp = 0.0 -> perfectly flat glass-like surface (spegelblankt)
                // At >0 MPH: gentle silky ripples scaling smoothly with wind speed
                float windFactor = clamp(uWindSpeed / 25.0, 0.0, 1.0);
                float waveAmp = windFactor * 0.045;

                vec3 rippleN = vec3(0.0, 1.0, 0.0);
                if (waveAmp > 0.0002) {
                    vec2 waveUv = vWaterWorldPos.xz * 0.12;
                    float wSpeed = uWindSpeed * 0.12;
                    vec2 flow = uWindDir * (uTime * wSpeed * 0.07);

                    float wave1 = sin(waveUv.x * 3.5 + flow.x * 2.0 + waveUv.y * 1.5);
                    float wave2 = cos(waveUv.y * 4.0 + flow.y * 2.5 - waveUv.x * 1.8);
                    float wave3 = sin((waveUv.x + waveUv.y) * 4.0 + uTime * wSpeed * 0.35);

                    rippleN = normalize(vec3(
                        (wave1 - wave2) * waveAmp,
                        1.0,
                        (wave2 + wave3) * waveAmp
                    ));
                }

                // Physically-based Fresnel for clean water surface
                float dotNV = clamp(dot(rippleN, V), 0.0, 1.0);
                float fresnel = 0.04 + 0.94 * pow(1.0 - dotNV, 4.0);

                // Natural sky reflection without synthetic white blotches
                vec3 R = reflect(-V, rippleN);
                float skyFactor = clamp(R.y, 0.0, 1.0);
                // Soft horizon sky tint derived from skyColor - never chalk white
                vec3 horizonSky = mix(uSkyColor, vec3(0.72, 0.86, 0.96), 0.25);
                vec3 skyReflect = mix(horizonSky, uSkyColor, pow(skyFactor, 0.55));

                // Sun specular glint (tight and crisp, only glitters in direction of sun)
                vec3 H = normalize(V + uSunDir);
                float dotNH = max(0.0, dot(rippleN, H));
                float sunSpec = pow(dotNH, 160.0) * 3.5;
                vec3 sunGlint = uSunColor * sunSpec;

                vec3 reflectColor = skyReflect;
                if (uWaterQuality > 1.5 && uHasReflector > 0.5) {
                    vec4 projCoords = vReflectCoord;
                    // Mirror ripples only when wind is blowing; at 0 MPH distortion is 0 (pure mirror)
                    projCoords.xy += rippleN.xz * (0.5 * waveAmp * projCoords.w);
                    vec2 mirrorUv = projCoords.xy / max(0.0001, projCoords.w);
                    mirrorUv = clamp(mirrorUv, 0.001, 0.999);
                    vec4 mirrorSample = texture2D(uReflectorTex, mirrorUv);
                    reflectColor = mirrorSample.rgb;
                }

                vec3 baseCol = gl_FragColor.rgb;
                vec3 finalCol = mix(baseCol, reflectColor, fresnel);
                finalCol += sunGlint * (0.35 + 0.65 * fresnel);
                gl_FragColor.rgb = finalCol;
            }
            `
        );
    };

    // === PLANAR WATER REFLECTOR (SMART-CULLED REAL-TIME MIRROR) ===
    class PlanarWaterReflector {
        constructor(renderer, scene) {
            this.renderer = renderer;
            this.scene = scene;
            this.enabled = false;
            
            this.renderTarget = new THREE.WebGLRenderTarget(512, 512, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                generateMipmaps: false
            });
            
            this.virtualCamera = new THREE.PerspectiveCamera();
            this.textureMatrix = new THREE.Matrix4();
            this.reflectorPlane = new THREE.Plane();
            this.normal = new THREE.Vector3(0, 1, 0);
            this.clipPlane = new THREE.Vector4();
            this.q = new THREE.Vector4();
            this.reflectorWorldPos = new THREE.Vector3();
            this.view = new THREE.Vector3();
            this.target = new THREE.Vector3();
            this.lookAtPos = new THREE.Vector3();
        }
        
        update(cam) {
            if (!this.enabled || !cam) return;
            let waterY = (window.waterTableLevel != null) ? window.waterTableLevel : -2.0;
            if (cam.position.y <= waterY + 0.1) return; // Underwater / touching water
            
            this.reflectorWorldPos.set(0, waterY, 0);
            this.normal.set(0, 1, 0);
            
            this.view.subVectors(this.reflectorWorldPos, cam.position);
            if (this.view.dot(this.normal) > 0) return; // Facing away
            
            this.view.reflect(this.normal).negate();
            this.view.add(this.reflectorWorldPos);
            
            this.lookAtPos.set(0, 0, -1);
            this.lookAtPos.applyQuaternion(cam.quaternion);
            this.lookAtPos.add(cam.position);
            
            this.target.subVectors(this.reflectorWorldPos, this.lookAtPos);
            this.target.reflect(this.normal).negate();
            this.target.add(this.reflectorWorldPos);
            
            this.virtualCamera.position.copy(this.view);
            this.virtualCamera.up.set(0, 1, 0);
            this.virtualCamera.up.applyQuaternion(cam.quaternion);
            this.virtualCamera.up.reflect(this.normal);
            this.virtualCamera.lookAt(this.target);
            
            this.virtualCamera.fov = cam.fov;
            this.virtualCamera.aspect = cam.aspect;
            this.virtualCamera.near = cam.near;
            this.virtualCamera.far = cam.far;
            
            this.virtualCamera.updateMatrixWorld();
            this.virtualCamera.matrixWorldInverse.copy(this.virtualCamera.matrixWorld).invert();
            this.virtualCamera.updateProjectionMatrix();
            
            // Oblique clipping plane
            this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPos);
            this.reflectorPlane.applyMatrix4(this.virtualCamera.matrixWorldInverse);
            this.clipPlane.set(this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant);
            
            let proj = this.virtualCamera.projectionMatrix;
            this.q.x = (Math.sign(this.clipPlane.x) + proj.elements[8]) / proj.elements[0];
            this.q.y = (Math.sign(this.clipPlane.y) + proj.elements[9]) / proj.elements[5];
            this.q.z = -1.0;
            this.q.w = (1.0 + proj.elements[10]) / proj.elements[14];
            
            let c = this.clipPlane.clone().multiplyScalar(2.0 / this.clipPlane.dot(this.q));
            proj.elements[2] = c.x;
            proj.elements[6] = c.y;
            proj.elements[10] = c.z + 1.0;
            proj.elements[14] = c.w;
            
            // Update texture matrix
            this.textureMatrix.set(
                0.5, 0.0, 0.0, 0.5,
                0.0, 0.5, 0.0, 0.5,
                0.0, 0.0, 0.5, 0.5,
                0.0, 0.0, 0.0, 1.0
            );
            this.textureMatrix.multiply(this.virtualCamera.projectionMatrix);
            this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse);
            
            // SMART CULLING: Exclude waterMesh, 3D grass shells and particle engine
            let waterVis = (typeof waterMesh !== 'undefined') ? waterMesh.visible : false;
            if (typeof waterMesh !== 'undefined') waterMesh.visible = false;
            
            let savedShellVis = [];
            if (window._terrainShells && Array.isArray(window._terrainShells.shells)) {
                for (let i = 0; i < window._terrainShells.shells.length; i++) {
                    let s = window._terrainShells.shells[i];
                    if (s && s.mesh) {
                        savedShellVis.push({ s: s, vis: s.mesh.visible });
                        s.mesh.visible = false;
                    }
                }
            }
            let particleVis = false;
            if (window.ParticleEngine && window.ParticleEngine.group) {
                particleVis = window.ParticleEngine.group.visible;
                window.ParticleEngine.group.visible = false;
            }
            
            let curRT = this.renderer.getRenderTarget();
            this.renderer.setRenderTarget(this.renderTarget);
            this.renderer.clear();
            this.renderer.render(this.scene, this.virtualCamera);
            this.renderer.setRenderTarget(curRT);
            
            // Restore visibility
            if (typeof waterMesh !== 'undefined') waterMesh.visible = waterVis;
            if (savedShellVis.length > 0) {
                for (let i = 0; i < savedShellVis.length; i++) {
                    let item = savedShellVis[i];
                    if (item.s && item.s.mesh) item.s.mesh.visible = item.vis;
                }
            }
            if (window.ParticleEngine && window.ParticleEngine.group) {
                window.ParticleEngine.group.visible = particleVis;
            }
        }
    }

    // === WATER QUALITY & SHORELINE CONTROLLER FUNCTIONS ===
    window.waterQuality = 'MED'; // Default: MED (Sky + Glint, 0% FPS loss)
    window.currentShoreStyle = 'SAND'; // Default: Sand #c2b082

    window.setWaterQuality = function(quality) {
        window.waterQuality = quality;
        let qVal = (quality === 'HIGH') ? 2.0 : (quality === 'OFF' ? 0.0 : 1.0);
        
        if (window.waterShaderUniforms) {
            window.waterShaderUniforms.uWaterQuality.value = qVal;
            if (quality === 'HIGH') {
                if (!window._planarWaterReflector) {
                    window._planarWaterReflector = new PlanarWaterReflector(renderer, scene);
                }
                window._planarWaterReflector.enabled = true;
                window.waterShaderUniforms.uHasReflector.value = 1.0;
                window.waterShaderUniforms.uReflectorTex.value = window._planarWaterReflector.renderTarget.texture;
                window.waterShaderUniforms.uTextureMatrix.value = window._planarWaterReflector.textureMatrix;
            } else {
                if (window._planarWaterReflector) window._planarWaterReflector.enabled = false;
                window.waterShaderUniforms.uHasReflector.value = 0.0;
            }
        }
        
        // Sync UI badges & buttons
        let badgeText = (quality === 'HIGH') ? 'HIGH (Spegel)' : (quality === 'OFF' ? 'Av' : 'MED (Himmel)');
        ['water-refl-badge', 'env-refl-badge'].forEach(id => {
            let el = document.getElementById(id);
            if (el) el.textContent = badgeText;
        });
        
        ['water-refl-btn-', 'env-refl-btn-'].forEach(prefix => {
            ['off', 'med', 'high'].forEach(key => {
                let btn = document.getElementById(prefix + key);
                if (!btn) return;
                if (key.toUpperCase() === quality) {
                    btn.style.background = '#38bdf8';
                    btn.style.color = '#0f172a';
                    btn.style.borderColor = '#38bdf8';
                    btn.style.fontWeight = 'bold';
                } else {
                    btn.style.background = '#1e293b';
                    btn.style.color = '#94a3b8';
                    btn.style.borderColor = '#334155';
                    btn.style.fontWeight = 'normal';
                }
            });
        });
    };

    window.setShoreStyle = function(style) {
        window.currentShoreStyle = style;
        if (window.terrainShaderUniforms) {
            if (style === 'OFF') {
                window.terrainShaderUniforms.uShoreBlend.value = 0.0;
            } else if (style === 'MUD') {
                window.terrainShaderUniforms.uShoreBlend.value = 1.0;
                window.terrainShaderUniforms.uShoreColor.value.setHex(0x5a4833);
            } else if (style === 'STONE') {
                window.terrainShaderUniforms.uShoreBlend.value = 1.0;
                window.terrainShaderUniforms.uShoreColor.value.setHex(0x737068);
            } else { // 'SAND' (default)
                window.terrainShaderUniforms.uShoreBlend.value = 1.0;
                window.terrainShaderUniforms.uShoreColor.value.setHex(0xc2b082);
            }
        }
        
        ['water-shore-btn-', 'env-shore-btn-'].forEach(prefix => {
            ['sand', 'mud', 'stone', 'off'].forEach(key => {
                let btn = document.getElementById(prefix + key);
                if (!btn) return;
                if (key.toUpperCase() === style) {
                    btn.style.background = '#38bdf8';
                    btn.style.color = '#0f172a';
                    btn.style.borderColor = '#38bdf8';
                    btn.style.fontWeight = 'bold';
                } else {
                    btn.style.background = '#1e293b';
                    btn.style.color = '#94a3b8';
                    btn.style.borderColor = '#334155';
                    btn.style.fontWeight = 'normal';
                }
            });
        });
    };

    // === GLOBAL WATER TABLE ===
    window.waterTableLevel = -2.0; // Default: 2m below surface
    window.currentWaterType = 'LAKE';
    
    window.setWaterType = function(type) {
        window.currentWaterType = type;
        let lakeBtn = document.getElementById('water-type-lake-btn');
        let oceanBtn = document.getElementById('water-type-ocean-btn');
        if (type === 'OCEAN') {
            // Use biome ocean color (darker, deeper look)
            let oceanHex = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.oceanColor) || '#1e3a5f';
            window.waterMat.color.setHex(parseInt(oceanHex.replace('#', '0x')));
            window.waterMat.opacity = 1.0;
            if (oceanBtn) { oceanBtn.style.background = '#1e3a5f'; oceanBtn.style.color = '#e2e8f0'; oceanBtn.style.border = '2px solid #38bdf8'; }
            if (lakeBtn) { lakeBtn.style.background = '#1e293b'; lakeBtn.style.color = '#94a3b8'; lakeBtn.style.border = '1px solid #334155'; }
        } else {
            // Standard lake color (bright blue)
            window.waterMat.color.setHex(0x38bdf8);
            window.waterMat.opacity = 1.0;
            if (lakeBtn) { lakeBtn.style.background = '#38bdf8'; lakeBtn.style.color = '#0f172a'; lakeBtn.style.border = 'none'; }
            if (oceanBtn) { oceanBtn.style.background = '#1e293b'; oceanBtn.style.color = '#94a3b8'; oceanBtn.style.border = '1px solid #334155'; }
        }
    };

    // Initialize default water quality and shoreline style
    setTimeout(() => {
        window.setWaterQuality('MED');
        window.setShoreStyle('SAND');
    }, 100);

    // Regenerate water alpha mask from heightmap data
    // Called after loading water heights to ensure visibility
    // Only shows water where terrain is BELOW water level (no floating shelves)
    // visualOnly=true: only update alpha texture, don't reset water mesh vertices
    //   (used during active sculpting to avoid destroying the flat water plane)
    // visualOnly=false (default): full rebuild including vertex cleanup
    //   (used on pointerup and after loading)
    function rebuildWaterMask(visualOnly) {
        window.rebuildWaterMask = rebuildWaterMask;
        if (typeof wCtx === 'undefined' || typeof waterGeo === 'undefined') return;
        
        let tPosArr = planeGeo.attributes.position.array;
        let count = (window.TERRAIN_SEGS + 1) * (window.TERRAIN_SEGS + 1);
        let segs = window.TERRAIN_SEGS;
        
        // === SMOOTH EDGES: Draw mask at low resolution, then upscale with bilinear interpolation ===
        // This eliminates staircase artifacts by letting the browser's image scaling smooth the edges.
        let LR = 1024; // Low-res canvas size
        if (!window._waterLowResCanvas) {
            window._waterLowResCanvas = document.createElement('canvas');
            window._waterLowResCanvas.width = LR;
            window._waterLowResCanvas.height = LR;
        }
        let lrCtx = window._waterLowResCanvas.getContext('2d');
        let lrPPS = LR / segs; // ~1.7 pixels per segment at 1024/600
        let halfPPS = lrPPS * 0.5;
        let diam = lrPPS * 2;
        
        let imgData = new ImageData(LR, LR);
        let data = imgData.data;
        
        // Pre-fill with black (alpha 255)
        for (let j = 0; j < data.length; j += 4) {
            data[j+3] = 255; // Alpha
            // RGB defaults to 0
        }
        
        for (let i = 0; i < count; i++) {
            let wz = window.waterData[i];
            if (wz > -90) {
                let terrainZ = tPosArr[i * 3 + 2];
                if (terrainZ < wz + 0.1) {
                    let gx = i % (segs + 1);
                    let gz = Math.floor(i / (segs + 1));
                    let px = gx * lrPPS;
                    let py = gz * lrPPS;
                    
                    let startX = Math.floor(px - halfPPS);
                    let startY = Math.floor(py - halfPPS);
                    let endX = Math.ceil(px - halfPPS + diam);
                    let endY = Math.ceil(py - halfPPS + diam);
                    
                    // Clamp to canvas bounds
                    startX = Math.max(0, startX);
                    startY = Math.max(0, startY);
                    endX = Math.min(LR, endX);
                    endY = Math.min(LR, endY);
                    
                    for (let y = startY; y < endY; y++) {
                        let rowOffset = y * LR * 4;
                        for (let x = startX; x < endX; x++) {
                            let idx = rowOffset + x * 4;
                            data[idx] = 255;     // R
                            data[idx+1] = 255;   // G
                            data[idx+2] = 255;   // B
                        }
                    }
                } else if (!visualOnly) {
                    window.waterData[i] = -99;
                    if (window.waterBaseZ) window.waterBaseZ[i] = -99;
                }
            }
        }
        lrCtx.putImageData(imgData, 0, 0);
        
        // Scale up to 4096 with smooth bilinear interpolation — this is where the magic happens!
        // The browser naturally blends the low-res pixels into smooth gradients at edges.
        wCtx.clearRect(0, 0, 4096, 4096);
        wCtx.imageSmoothingEnabled = true;
        wCtx.imageSmoothingQuality = 'high';
        wCtx.drawImage(window._waterLowResCanvas, 0, 0, 4096, 4096);
        
        if (!visualOnly && window.syncWaterVisual) window.syncWaterVisual();
        waterTex.needsUpdate = true;
        window._waterMaskDirty = true;
    }
