// ================================================================
//  SCENE ENGINE — Time of Day, Stars, Glow Assets
//  Depends on window.G (scene, camera, ambientLight, dirLight, sunMesh)
//
//  Exposes:
//  - window.currentTimeOfDay, window.currentWeather
//  - window.setTimeOfDay(hour)
//  - window.updateFogDensity(val)
//  - window.updateSunPreview(val)
//  - window.updateWindPreview(val)
//  - window.updateWindDirPreview(val)
//  - window.animateStars() — call from render loop
// ================================================================
(function() {
    function init() {
        const G = window.G;
        if (!G || !G.scene) { setTimeout(init, 100); return; }

        const scene = G.scene;

        // --- STATE ---
        window.currentTimeOfDay = 12;
        window.currentWeather = 'CLEAR';

        // --- TIME PRESETS ---
        const TIME_KEYS = [0, 5, 7, 12, 17, 19, 24];
        const TIME_PRESETS = {
            0:  { skyTop:[10,10,26],    skyBot:[26,26,46],    sunColor:null,           sunY:-50,  ambient:0.05, ambColor:[68,102,170],  dirInt:0.05, dirColor:[68,102,170],  fogNear:30,  fogFar:200,  fogColor:[10,10,26],    glowBoost:3.0 },
            5:  { skyTop:[26,26,46],    skyBot:[233,69,96],   sunColor:[255,107,53],   sunY:20,   ambient:0.15, ambColor:[255,170,130], dirInt:0.3,  dirColor:[255,136,85],  fogNear:80,  fogFar:600,  fogColor:[233,69,96],   glowBoost:1.5 },
            7:  { skyTop:[255,154,86],  skyBot:[255,215,0],   sunColor:[255,170,0],    sunY:40,   ambient:0.3,  ambColor:[255,220,170], dirInt:0.5,  dirColor:[255,204,119], fogNear:150, fogFar:1200, fogColor:[255,215,0],   glowBoost:0.5 },
            12: { skyTop:[74,144,217],  skyBot:[135,206,235],  sunColor:[255,255,255], sunY:150,  ambient:0.4,  ambColor:[255,255,255], dirInt:0.8,  dirColor:[255,255,255], fogNear:300, fogFar:2500, fogColor:[135,206,235], glowBoost:0.0 },
            17: { skyTop:[255,107,53],  skyBot:[255,217,61],  sunColor:[255,140,0],    sunY:35,   ambient:0.35, ambColor:[255,200,150], dirInt:0.6,  dirColor:[255,170,68],  fogNear:120, fogFar:900,  fogColor:[255,217,61],  glowBoost:0.3 },
            19: { skyTop:[45,27,105],   skyBot:[233,69,96],   sunColor:[255,69,0],     sunY:10,   ambient:0.2,  ambColor:[200,130,170], dirInt:0.3,  dirColor:[255,102,68],  fogNear:80,  fogFar:500,  fogColor:[233,69,96],   glowBoost:1.0 },
            24: { skyTop:[10,10,26],    skyBot:[26,26,46],    sunColor:null,           sunY:-50,  ambient:0.05, ambColor:[68,102,170],  dirInt:0.05, dirColor:[68,102,170],  fogNear:30,  fogFar:200,  fogColor:[10,10,26],    glowBoost:3.0 }
        };

        // --- SKY GRADIENT ---
        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 2; skyCanvas.height = 256;
        const skyCtx = skyCanvas.getContext('2d');
        const skyTexture = new THREE.CanvasTexture(skyCanvas);

        function lerpVal(a, b, t) { return a + (b - a) * t; }
        function lerpArr(a, b, t) { return a.map((v, i) => lerpVal(v, b[i], t)); }

        // --- WARM SUN ---
        // The daylight is a little yellow in the summer worlds: the same palette then reads fresher and more lime (the colours are not
        // changed, so the surface detection and the grass masks are not touched). It follows the strength of the sun (none at night),
        // and the winter and moon worlds keep their cold or white light.
        const SUN_TINT = { dir: [255, 238, 200], amb: [255, 249, 232] };
        const BIOME_WARMTH = { GLOBAL: 1, ALL: 1, AUTUMN: 0.5, DESERT: 0.5, DESERT_AUTUMN: 0.3 };   // not listed: 0
        window.getSunWarmth = function () {
            let w = BIOME_WARMTH[window.ACTIVE_BIOME || 'GLOBAL'];
            return w === undefined ? 0 : w;
        };
        function warmLight(col, tint, w) { return col.map((v, i) => v * (1 - w * (1 - tint[i] / 255))); }

        function getInterpolatedPreset(hour) {
            let h = ((hour % 24) + 24) % 24;
            let lo = 0, hi = 24;
            for (let i = 0; i < TIME_KEYS.length - 1; i++) {
                if (h >= TIME_KEYS[i] && h <= TIME_KEYS[i + 1]) {
                    lo = TIME_KEYS[i]; hi = TIME_KEYS[i + 1]; break;
                }
            }
            let t = hi === lo ? 0 : (h - lo) / (hi - lo);
            let A = TIME_PRESETS[lo], B = TIME_PRESETS[hi];
            return {
                skyTop: lerpArr(A.skyTop, B.skyTop, t),
                skyBot: lerpArr(A.skyBot, B.skyBot, t),
                sunColor: (A.sunColor && B.sunColor) ? lerpArr(A.sunColor, B.sunColor, t) : (A.sunColor && !B.sunColor) ? A.sunColor.map(v => v * (1 - t)) : (!A.sunColor && B.sunColor) ? B.sunColor.map(v => v * t) : null,
                sunY: lerpVal(A.sunY, B.sunY, t),
                ambient: lerpVal(A.ambient, B.ambient, t),
                ambColor: lerpArr(A.ambColor, B.ambColor, t),
                dirInt: lerpVal(A.dirInt, B.dirInt, t),
                dirColor: lerpArr(A.dirColor, B.dirColor, t),
                fogNear: lerpVal(A.fogNear, B.fogNear, t),
                fogFar: lerpVal(A.fogFar, B.fogFar, t),
                fogColor: lerpArr(A.fogColor, B.fogColor, t),
                glowBoost: lerpVal(A.glowBoost, B.glowBoost, t)
            };
        }

        // --- FOG ---
        window.updateFogDensity = function(val) {
            let mult = parseFloat(val);
            if(!window.CURRENT_BIOME_CONFIG) window.CURRENT_BIOME_CONFIG = {};
            window.CURRENT_BIOME_CONFIG.fogDensity = mult;
            if(window.setTimeOfDay) window.setTimeOfDay(window.currentTimeOfDay);
        };

        // the light colours only (a biome change moves the warmth): not the sky, the fog or the intensities
        window.refreshSunLight = function () {
            let p = getInterpolatedPreset(window.currentTimeOfDay);
            let warm = window.getSunWarmth() * Math.min(1, Math.max(0, p.dirInt / 0.8));
            let ambC = warmLight(p.ambColor, SUN_TINT.amb, warm), dirC = warmLight(p.dirColor, SUN_TINT.dir, warm);
            if (G.ambientLight) G.ambientLight.color.setRGB(ambC[0]/255, ambC[1]/255, ambC[2]/255);
            if (G.dirLight) G.dirLight.color.setRGB(dirC[0]/255, dirC[1]/255, dirC[2]/255);
        };

        // --- SET TIME OF DAY ---
        window.setTimeOfDay = function(hour) {
            window.currentTimeOfDay = hour;
            let p = getInterpolatedPreset(hour);

            // 1. Sky gradient
            let grad = skyCtx.createLinearGradient(0, 0, 0, 256);
            grad.addColorStop(0, `rgb(${p.skyTop[0]|0},${p.skyTop[1]|0},${p.skyTop[2]|0})`);
            grad.addColorStop(0.55, `rgb(${p.skyBot[0]|0},${p.skyBot[1]|0},${p.skyBot[2]|0})`);
            grad.addColorStop(1, `rgb(${p.skyBot[0]|0},${p.skyBot[1]|0},${p.skyBot[2]|0})`);
            skyCtx.fillStyle = grad;
            skyCtx.fillRect(0, 0, 2, 256);
            skyTexture.needsUpdate = true;
            scene.background = skyTexture;

            // 2. Fog
            let fogMult = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.fogDensity) ? window.CURRENT_BIOME_CONFIG.fogDensity : 1.0;
            scene.fog.color.setRGB(p.fogColor[0]/255, p.fogColor[1]/255, p.fogColor[2]/255);
            scene.fog.near = p.fogNear / fogMult;
            let baseFogFar = p.fogFar / fogMult;
            let sceneryMaxDist = (typeof window.getSceneryMaxRadius === 'function') ? window.getSceneryMaxRadius() : (window._sceneryMaxRadius || 0);
            scene.fog.far = Math.max(baseFogFar, sceneryMaxDist * 1.3);

            // 3. Ambient light
            let warm = window.getSunWarmth() * Math.min(1, Math.max(0, p.dirInt / 0.8));   // 1 at noon, 0 at night
            let ambC = warmLight(p.ambColor, SUN_TINT.amb, warm), dirC = warmLight(p.dirColor, SUN_TINT.dir, warm);
            let al = G.ambientLight;
            if (al) {
                al.intensity = p.ambient;
                al.color.setRGB(ambC[0]/255, ambC[1]/255, ambC[2]/255);
            }

            // 4. Directional light (sun)
            let dl = G.dirLight;
            if (dl) {
                dl.intensity = p.dirInt;
                dl.color.setRGB(dirC[0]/255, dirC[1]/255, dirC[2]/255);
                let angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
                dl.position.set(Math.cos(angle) * 100, Math.max(10, p.sunY), Math.sin(angle) * 100);
            }

            // 5. Sun mesh visual
            let sm = G.sunMesh;
            if (sm) {
                let angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
                let sunOrbitR = 13000;
                let sunHeight = p.sunY * 32.5;
                sm.position.set(Math.cos(angle) * sunOrbitR, sunHeight, Math.sin(angle) * sunOrbitR);
                if (p.sunColor) {
                    sm.material.color.setRGB(p.sunColor[0]/255, p.sunColor[1]/255, p.sunColor[2]/255);
                    let sunBrightness = (p.sunColor[0] + p.sunColor[1] + p.sunColor[2]) / 765;
                    sm.visible = sunBrightness > 0.01;
                    if (window.sunGlow) {
                        window.sunGlow.position.copy(sm.position);
                        window.sunGlow.material.color.copy(sm.material.color);
                        window.sunGlow.material.opacity = 0.15 * sunBrightness;
                        window.sunGlow.visible = sm.visible;
                    }
                } else {
                    sm.visible = false;
                    if (window.sunGlow) window.sunGlow.visible = false;
                }
            }

            // 6. Glow assets
            updateGlowAssets(p.glowBoost);

            // 6b. Tracer glow sync
            if (typeof window.updateTracerForTimeOfDay === 'function') {
                window.updateTracerForTimeOfDay(hour);
            }

            // 6c. Stars
            updateStarsForTimeOfDay(hour);

            // 7. UI label
            let lbl = document.getElementById('time-label');
            if (lbl) {
                let hh = Math.floor(hour); let mm = Math.round((hour - hh) * 60);
                let names = {0:'Midnight',5:'Dawn',7:'Sunrise',12:'Midday',17:'Golden Hour',19:'Sunset',24:'Midnight'};
                let closest = TIME_KEYS.reduce((a,b) => Math.abs(b-hour) < Math.abs(a-hour) ? b : a);
                lbl.innerText = String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ' \u2014 ' + (names[closest] || '');
            }
            let slider = document.getElementById('set-time');
            if (slider && parseFloat(slider.value) !== hour) slider.value = hour;
        };

        // --- ENVIRONMENT PREVIEW ---
        window.updateSunPreview = function(val) {
            let h = parseFloat(val);
            window.setTimeOfDay(h);
            let hh = Math.floor(h); let mm = Math.round((h - hh) * 60);
            let lbl = document.getElementById('sun-label');
            if (lbl) lbl.innerText = String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
        };

        window.updateWindPreview = function(val) {
            window.currentWindMph = parseFloat(val);
            let lbl = document.getElementById('wind-label');
            if (lbl) lbl.innerText = val + ' mph';
        };

        window.updateWindDirPreview = function(val) {
            window.currentWindDir = parseFloat(val);
            let dirs = ['N','NE','E','SE','S','SW','W','NW'];
            let idx = Math.round(parseFloat(val) / 45) % 8;
            let lbl = document.getElementById('winddir-label');
            if (lbl) lbl.innerText = dirs[idx] + ' (' + val + '\u00b0)';
        };

        // ============================================================
        // STAR FIELD — Night Sky (Round, glowing & twinkling stars)
        // ============================================================
        const STAR_COUNT = 850;
        const starPositions = new Float32Array(STAR_COUNT * 3);
        const starSizes = new Float32Array(STAR_COUNT);
        const starPhases = new Float32Array(STAR_COUNT);
        const starBaseSizes = new Float32Array(STAR_COUNT);
        const starColors = new Float32Array(STAR_COUNT * 3);

        // Procedural circular texture: crisp white round star core with soft realistic celestial aura
        function _createRoundStarTexture() {
            let canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            let ctx = canvas.getContext('2d');
            
            let grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');     // Pure white dense core
            grad.addColorStop(0.18, 'rgba(255, 255, 255, 0.95)');    // Solid circular disc
            grad.addColorStop(0.40, 'rgba(225, 240, 255, 0.55)');    // Natural soft shimmer halo
            grad.addColorStop(0.70, 'rgba(180, 220, 255, 0.15)');    // Atmospheric glow
            grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');            // Fade to transparent edge
            
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            
            let tex = new THREE.CanvasTexture(canvas);
            tex.generateMipmaps = true;
            return tex;
        }

        for (let i = 0; i < STAR_COUNT; i++) {
            let theta = Math.random() * Math.PI * 2;
            let phi = Math.acos(Math.random() * 0.88 + 0.12);
            let r = 14000;
            starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            starPositions[i * 3 + 1] = r * Math.cos(phi);
            starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Natural star size distribution:
            // ~80% delicate pinpoint stars, ~15% medium bright stars, ~5% luminous landmark stars
            let roll = Math.random();
            if (roll > 0.95) {
                starBaseSizes[i] = 24.0 + Math.random() * 10.0; // Major luminous star
            } else if (roll > 0.80) {
                starBaseSizes[i] = 16.0 + Math.random() * 6.0;  // Medium bright star
            } else {
                starBaseSizes[i] = 9.0 + Math.random() * 6.0;   // Pinpoint round star
            }
            starSizes[i] = starBaseSizes[i];
            starPhases[i] = Math.random() * Math.PI * 2;

            // Natural star spectral colors (white, warm gold, electric blue)
            let colRoll = Math.random();
            if (colRoll < 0.70) {
                // Bright white
                starColors[i * 3]     = 1.0;
                starColors[i * 3 + 1] = 1.0;
                starColors[i * 3 + 2] = 1.0;
            } else if (colRoll < 0.85) {
                // Warm golden / amber (like Betelgeuse or Arcturus)
                starColors[i * 3]     = 1.0;
                starColors[i * 3 + 1] = 0.92;
                starColors[i * 3 + 2] = 0.75;
            } else {
                // Electric ice blue (like Sirius or Rigel)
                starColors[i * 3]     = 0.82;
                starColors[i * 3 + 1] = 0.92;
                starColors[i * 3 + 2] = 1.0;
            }
        }

        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starGeo.setAttribute('starSize', new THREE.BufferAttribute(starSizes, 1));
        starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

        const starMat = new THREE.PointsMaterial({
            size: 16.0,
            sizeAttenuation: false,
            map: _createRoundStarTexture(),
            vertexColors: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        // Hook up individual star size attribute in GLSL without colliding with uniform size
        starMat.onBeforeCompile = (shader) => {
            shader.vertexShader = 'attribute float starSize;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                'gl_PointSize = size;',
                'gl_PointSize = starSize;'
            );
        };

        const starField = new THREE.Points(starGeo, starMat);
        scene.add(starField);
        window._starOpacity = 0;

        function updateStarsForTimeOfDay(hour) {
            let opacity = 0;
            if (hour < 5 || hour > 21) { opacity = 1.0; }
            else if (hour >= 5 && hour < 7) { opacity = 1.0 - (hour - 5) / 2; }
            else if (hour >= 18 && hour <= 21) { opacity = (hour - 18) / 3; }
            window._starOpacity = opacity;
            starMat.opacity = opacity;
            starField.visible = opacity > 0.01;
        }

        // Twinkle — called from render loop
        window.animateStars = function() {
            if (window._starOpacity < 0.01) return;
            
            // Keep celestial sphere locked to camera so stars stay at astronomical distance
            if (typeof camera !== 'undefined' && camera) {
                starField.position.copy(camera.position);
            }

            let t = performance.now() * 0.001;
            for (let i = 0; i < STAR_COUNT; i++) {
                let twinkle = 0.75 + 0.25 * Math.sin(t * (1.6 + (starPhases[i] % 1.0) * 2.4) + starPhases[i]);
                starSizes[i] = starBaseSizes[i] * twinkle;
            }
            starGeo.attributes.starSize.needsUpdate = true;
        };

        // ============================================================
        // GLOW ASSETS — Night mode point lights
        // ============================================================
        const MAX_GLOW_LIGHTS = 20;
        let activeGlowLights = [];

        function updateGlowAssets(glowBoost) {
            if (!window.placedTrees) return;
            let glowTrees = window.placedTrees.filter(obj => obj.type === 'R_GLOW');
            let cam = G.camera;
            if (cam) {
                glowTrees.sort((a, b) => {
                    let dA = (a.x - cam.position.x) ** 2 + (a.z - cam.position.z) ** 2;
                    let dB = (b.x - cam.position.x) ** 2 + (b.z - cam.position.z) ** 2;
                    return dA - dB;
                });
            }
            activeGlowLights.forEach(l => scene.remove(l));
            activeGlowLights = [];

            glowTrees.forEach((obj, idx) => {
                let pool = window.instancePools && window.instancePools['R_GLOW'];
                if (pool && idx === 0) {
                    pool.meshes.forEach(iMesh => {
                        if (iMesh.material) {
                            iMesh.material.emissiveIntensity = 0.1 + glowBoost * 0.9;
                            if (glowBoost > 0.5) {
                                iMesh.material.emissive = new THREE.Color(0.2 * glowBoost, 0.8 * glowBoost, 0.3 * glowBoost);
                            }
                            iMesh.material.needsUpdate = true;
                        }
                    });
                }
                if (glowBoost > 0.3 && idx < MAX_GLOW_LIGHTS) {
                    let light = new THREE.PointLight(
                        new THREE.Color(0.3, 1.0, 0.5), glowBoost * 2.5, 30, 2
                    );
                    light.position.set(obj.x, 8, obj.z);
                    scene.add(light);
                    activeGlowLights.push(light);
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
