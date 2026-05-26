






        function toggleMenu() {
            let m = document.getElementById('dropdown-menu');
            m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
        }
        window.useMeters = false;
        window.formatDistStr = function(meters, dec=1) { return window.useMeters ? (meters).toFixed(dec) + ' m' : (meters * 1.09361).toFixed(dec) + ' yds'; };
        window.formatDistRaw = function(meters, dec=0) { return window.useMeters ? (meters).toFixed(dec) : (meters * 1.09361).toFixed(dec); };
    

    // --- HUD & HAMBURGER MENU LOGIC ---
    window.toggleHamburgerMenu = function() {
        let menu = document.getElementById('hamburger-menu');
        if (menu) {
            menu.classList.toggle('open');
            // Show scorecard button only during active match
            let scBtn = document.getElementById('hb-scorecard-btn');
            if (scBtn) {
                let isMatch = (typeof playState !== 'undefined' && playState !== 'BUILDING' && playState !== 'SETUP' && window.players && window.players.length > 0);
                scBtn.style.display = isMatch ? 'block' : 'none';
            }
        }
    };
    
    window.openMatchSettings = function() {
        // Match is active if we're in ROUND_IDLE or ROUND_FLYING
        let isMatchActive = (typeof playState !== 'undefined' && 
            (playState === 'ROUND_IDLE' || playState === 'ROUND_FLYING'));
        
        if (isMatchActive) {
            // ACTIVE MATCH: Show safe in-round settings only
            let modal = document.getElementById('inround-settings-modal');
            if (modal) {
                // Sync current values to in-round controls
                if (window.matchSettings) {
                    let irWind = document.getElementById('ir-wind');
                    if (irWind) irWind.value = window.matchSettings.windStrength || 0;
                    let irStimp = document.getElementById('ir-stimp');
                    if (irStimp) { irStimp.value = window.matchSettings.greenStimp || 10; document.getElementById('ir-stimp-val').innerText = irStimp.value; }
                    let irFirm = document.getElementById('ir-firmness');
                    if (irFirm) irFirm.value = window.matchSettings.greenFirmness || 'NORMAL';
                }
                modal.style.display = 'flex';
            }
        } else {
            // PRE-MATCH or POST-MATCH: Show full setup modal
            document.getElementById('settings-modal').style.display = 'flex';
        }
    };
    
    window.renderDynamicHUD = function() {
        let container = document.getElementById('dynamic-hud');
        if (!container) return;
        
        let prefs = JSON.parse(localStorage.getItem('golf_os_hud_prefs') || '["TOTAL_LENGTH", "CARRY", "BALL_SPEED", "CLUB_SPEED"]');
        let html = '';
        
        let labels = {
            'TOTAL_LENGTH': 'Total',
            'CARRY': 'Carry',
            'BALL_SPEED': 'Ball Speed',
            'CLUB_SPEED': 'Club Speed',
            'BACKSPIN': 'Backspin',
            'SIDESPIN': 'Side Spin',
            'LAUNCH_ANGLE': 'Launch (VLA)',
            'CLUB_PATH': 'Club Path',
            'FACE_TO_PATH': 'Face to Path',
            'HLA': 'Offline (HLA)'
        };
        
        let idMap = {
            'TOTAL_LENGTH': 'hud-total',
            'CARRY': 'hud-carry',
            'BALL_SPEED': 'hud-bs',
            'CLUB_SPEED': 'hud-cs',
            'BACKSPIN': 'hud-backspin',
            'SIDESPIN': 'hud-ss',
            'LAUNCH_ANGLE': 'hud-vla',
            'CLUB_PATH': 'hud-cp',
            'FACE_TO_PATH': 'hud-ftp',
            'HLA': 'hud-hla'
        };
        
        prefs.forEach(tileKey => {
            let isHighlight = (tileKey === 'TOTAL_LENGTH' || tileKey === 'CARRY');
            html += `<div class="dh-tile">
                <span class="dh-label">${labels[tileKey]}</span>
                <span class="dh-val ${isHighlight ? 'highlight' : ''}" id="${idMap[tileKey]}">---</span>
            </div>`;
        });
        
        container.innerHTML = html;
        
        // Synka toggles i menyn
        document.querySelectorAll('.hb-toggle input').forEach(chk => {
            chk.checked = prefs.includes(chk.getAttribute('data-tile'));
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        // Initiera dynamisk HUD
        window.renderDynamicHUD();
        
        // Lyssna på klick i menyn
        document.querySelectorAll('.hb-toggle input').forEach(chk => {
            chk.addEventListener('change', () => {
                let prefs = [];
                document.querySelectorAll('.hb-toggle input').forEach(c => {
                    if (c.checked) prefs.push(c.getAttribute('data-tile'));
                });
                localStorage.setItem('golf_os_hud_prefs', JSON.stringify(prefs));
                
                // Rädda tidigare värden ifall HUD:en är aktiv
                let oldVals = {};
                document.querySelectorAll('.dh-val').forEach(el => { oldVals[el.id] = el.innerText; });
                
                window.renderDynamicHUD();
                
                // Återställ gamla värden (om tillämpligt)
                Object.keys(oldVals).forEach(id => {
                    let newEl = document.getElementById(id);
                    if (newEl) newEl.innerText = oldVals[id];
                });
            });
        });
    });

    // 1. THREE.JS INITIALIZATION
    let currentEditCode = null;
    
    window.takeMulligan = function() {
        if (typeof appMode === 'undefined' || (appMode !== 'PLAY' && appMode !== 'TEST')) return;
        if (appMode === 'PLAY' && (!window.matchSettings || !window.matchSettings.mulligans)) return;
        if (playState !== 'ROUND_IDLE') return;

        let lastIdx = window.lastShotPlayerIndex !== undefined ? window.lastShotPlayerIndex : window.activePlayerIndex;
        let p = window.players[lastIdx];
        
        if (p && p.prevPos) {
            if (window.nextTurnTimeout) clearTimeout(window.nextTurnTimeout);
            
            if (window.activePlayerIndex !== lastIdx) {
                window.activePlayerIndex = lastIdx;
            }
            
            p.holedOut = false;
            if (p.scores) p.scores[playingHoleIndex] = null;
            if (p.scoreVsPar) p.scoreVsPar[playingHoleIndex] = null;

            window.ballMesh.position.set(p.prevPos.x, p.prevPos.y, p.prevPos.z);
            p.strokes = (p.prevStrokes !== undefined) ? p.prevStrokes : p.strokes;
            p.penaltyStrokes = (p.prevPenalty !== undefined) ? p.prevPenalty : p.penaltyStrokes;
            
            p.prevPos = null;
            window.lastShotPlayerIndex = undefined;

            document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
            
            camera.position.set(window.ballMesh.position.x, window.ballMesh.position.y + 4, window.ballMesh.position.z + 10);
            controls.target.copy(window.ballMesh.position);
            controls.update();

            let pop = document.getElementById('score-popup');
            if(pop) {
                pop.innerText = "MULLIGAN!";
                pop.style.color = "#ef4444";
                pop.style.opacity = '1';
                setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 2000);
            }

            let mBtn = document.getElementById('btn-mulligan');
            if (mBtn) mBtn.style.display = 'none';
            
            if (window.resetAimTarget) window.resetAimTarget();
        }
    };

    window.takePenaltyDrop = function() {
        if (typeof appMode === 'undefined' || (appMode !== 'PLAY' && appMode !== 'TEST')) return;
        if (playState !== 'ROUND_IDLE') return;

        let p = window.players[window.activePlayerIndex];
        if (p) {
            if (window.nextTurnTimeout) clearTimeout(window.nextTurnTimeout);
            
            p.penaltyStrokes++;
            document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();

            let pop = document.getElementById('score-popup');
            if(pop) {
                pop.innerText = "PENALTY DROP (+1)";
                pop.style.color = "#ef4444";
                pop.style.opacity = '1';
                pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
                setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 2500);
            }
            
            window.camFollowMode = 'FREE';
            let btnCam = document.getElementById('btn-cam-mode');
            if(btnCam) {
                btnCam.innerText = '🎥 FREE CAM';
                btnCam.style.background = '#ec4899';
            }
            controls.enabled = true;
            controls.update();
            
            let tools = document.getElementById('play-tools');
            let confirmBtn = document.getElementById('btn-confirm-drop');
            if (!confirmBtn) {
                confirmBtn = document.createElement('button');
                confirmBtn.id = 'btn-confirm-drop';
                confirmBtn.innerText = '✅ CONFIRM DROP HERE';
                confirmBtn.style.background = '#10b981';
                confirmBtn.style.color = '#fff';
                confirmBtn.style.padding = '8px 15px';
                confirmBtn.style.fontWeight = 'bold';
                confirmBtn.style.border = 'none';
                confirmBtn.style.borderRadius = '6px';
                confirmBtn.style.cursor = 'pointer';
                confirmBtn.onclick = function() {
                    let dropX = controls.target.x;
                    let dropZ = controls.target.z;
                    let h = 0.3;
                    if(typeof localGetTerrainAt === 'function') {
                        let surf = localGetTerrainAt(dropX, -dropZ);
                        if(surf) h = surf.h + 0.1;
                    }
                    window.ballMesh.position.set(dropX, h, dropZ);
                    window.ballMesh.velocity.set(0,0,0);
                    window.ballMesh.angularVelocity.set(0,0,0);
                    
                    p.lie = {x: dropX, y: h, z: dropZ};
                    p.prevPos = {x: dropX, y: h, z: dropZ}; 
                    
                    if(window.resetAimTarget) window.resetAimTarget();
                    
                    window.camFollowMode = 'BROADCAST';
                    if(btnCam) {
                        btnCam.innerText = '🎥 BROADCAST';
                        btnCam.style.background = '#4f46e5';
                    }
                    camera.position.set(dropX, h + 4, dropZ + 10);
                    controls.target.copy(window.ballMesh.position);
                    controls.update();
                    
                    this.remove();
                };
                tools.insertBefore(confirmBtn, tools.firstChild);
            }
        }
    };
    
    setInterval(() => {
        let mBtn = document.getElementById('btn-mulligan');
        if (mBtn) {
            if (typeof appMode !== 'undefined' && appMode === 'PLAY' && typeof playState !== 'undefined' && playState === 'ROUND_IDLE' && window.matchSettings && window.matchSettings.mulligans) {
                let lastIdx = window.lastShotPlayerIndex !== undefined ? window.lastShotPlayerIndex : window.activePlayerIndex;
                let p = window.players ? window.players[lastIdx] : null;
                if (p && p.prevPos) {
                    mBtn.style.display = 'block';
                    return;
                }
            }
            mBtn.style.display = 'none';
        }
    }, 500);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky (overridden by TimeOfDay engine)
    scene.fog = new THREE.Fog(0x87CEEB, 300, 2500); // Fog (overridden by TimeOfDay engine)

    // ============================================================
    // DYNAMIC TIME OF DAY ENGINE (Fas 1+2)
    // ============================================================
    window.currentTimeOfDay = 12;
    window.currentWeather = 'CLEAR';

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

    // Sky gradient canvas (2x256 vertical gradient)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2; skyCanvas.height = 256;
    const skyCtx = skyCanvas.getContext('2d');
    const skyTexture = new THREE.CanvasTexture(skyCanvas);

    function lerpVal(a, b, t) { return a + (b - a) * t; }
    function lerpArr(a, b, t) { return a.map((v, i) => lerpVal(v, b[i], t)); }

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
            sunColor: A.sunColor && B.sunColor ? lerpArr(A.sunColor, B.sunColor, t) : (B.sunColor || A.sunColor),
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

    window.setTimeOfDay = function(hour) {
        window.currentTimeOfDay = hour;
        let p = getInterpolatedPreset(hour);

        // 1. Sky gradient
        let grad = skyCtx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, `rgb(${p.skyTop[0]|0},${p.skyTop[1]|0},${p.skyTop[2]|0})`);
        grad.addColorStop(1, `rgb(${p.skyBot[0]|0},${p.skyBot[1]|0},${p.skyBot[2]|0})`);
        skyCtx.fillStyle = grad;
        skyCtx.fillRect(0, 0, 2, 256);
        skyTexture.needsUpdate = true;
        scene.background = skyTexture;

        // 2. Fog
        scene.fog.color.setRGB(p.fogColor[0]/255, p.fogColor[1]/255, p.fogColor[2]/255);
        scene.fog.near = p.fogNear;
        scene.fog.far = p.fogFar;

        // 3. Ambient light
        if (typeof ambientLight !== 'undefined') {
            ambientLight.intensity = p.ambient;
            ambientLight.color.setRGB(p.ambColor[0]/255, p.ambColor[1]/255, p.ambColor[2]/255);
        }

        // 4. Directional light (sun)
        if (typeof dirLight !== 'undefined') {
            dirLight.intensity = p.dirInt;
            dirLight.color.setRGB(p.dirColor[0]/255, p.dirColor[1]/255, p.dirColor[2]/255);
            // Sun orbit
            let angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
            dirLight.position.set(Math.cos(angle) * 100, Math.max(10, p.sunY), Math.sin(angle) * 100);
        }

        // 5. Sun mesh visual
        if (typeof sunMesh !== 'undefined') {
            let angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
            sunMesh.position.set(Math.cos(angle) * 400, p.sunY, Math.sin(angle) * 400);
            if (p.sunColor) {
                sunMesh.material.color.setRGB(p.sunColor[0]/255, p.sunColor[1]/255, p.sunColor[2]/255);
                sunMesh.visible = true;
            } else {
                sunMesh.visible = false; // Midnight: no sun
            }
        }

        // 6. Glow assets (Fas 2)
        updateGlowAssets(p.glowBoost);

        // 6b. Tracer glow sync with time
        updateTracerForTimeOfDay(hour);

        // 6c. Stars fade in/out with time
        updateStarsForTimeOfDay(hour);

        // 7. Update UI label
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

    // === ENVIRONMENT PREVIEW CONTROLS ===
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
        if (lbl) lbl.innerText = dirs[idx] + ' (' + val + '°)';
    };

    // ============================================================
    // STAR FIELD — Night Sky
    // ============================================================
    const STAR_COUNT = 600;
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starSizes = new Float32Array(STAR_COUNT);
    const starPhases = new Float32Array(STAR_COUNT); // Random phase for twinkle
    const starBaseSizes = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
        // Distribute on upper hemisphere (y > 0)
        let theta = Math.random() * Math.PI * 2;
        let phi = Math.acos(Math.random() * 0.85 + 0.15); // 0.15-1.0 = above horizon
        let r = 800;
        starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = r * Math.cos(phi); // Always positive (upper hemisphere)
        starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        starBaseSizes[i] = 1.0 + Math.random() * 2.5; // 1.0 - 3.5
        starSizes[i] = starBaseSizes[i];
        starPhases[i] = Math.random() * Math.PI * 2;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

    const starMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    window._starOpacity = 0;

    function updateStarsForTimeOfDay(hour) {
        let opacity = 0;
        if (hour < 5 || hour > 21) { opacity = 1.0; }
        else if (hour >= 5 && hour < 7) { opacity = 1.0 - (hour - 5) / 2; } // Dawn fade
        else if (hour >= 18 && hour <= 21) { opacity = (hour - 18) / 3; }  // Dusk emerge
        else { opacity = 0; }
        window._starOpacity = opacity;
        starMat.opacity = opacity;
        starField.visible = opacity > 0.01;
    }

    // Twinkle animation (called from render loop)
    function animateStars() {
        if (window._starOpacity < 0.01) return;
        let t = performance.now() * 0.001;
        for (let i = 0; i < STAR_COUNT; i++) {
            let twinkle = 0.7 + 0.3 * Math.sin(t * (1.5 + (starPhases[i] % 1.0) * 2.0) + starPhases[i]);
            starSizes[i] = starBaseSizes[i] * twinkle;
        }
        starGeo.attributes.size.needsUpdate = true;
    }

    // FAS 2: Glow-tree night mode
    const MAX_GLOW_LIGHTS = 20;
    let activeGlowLights = [];

    function updateGlowAssets(glowBoost) {
        if (!window.placedTrees) return;
        let glowTrees = window.placedTrees.filter(obj => obj.type === 'R_GLOW');

        // Sort by distance to camera, closest first
        if (typeof camera !== 'undefined') {
            glowTrees.sort((a, b) => {
                let dA = (a.x - camera.position.x) ** 2 + (a.z - camera.position.z) ** 2;
                let dB = (b.x - camera.position.x) ** 2 + (b.z - camera.position.z) ** 2;
                return dA - dB;
            });
        }

        // Remove all existing glow lights
        activeGlowLights.forEach(l => scene.remove(l));
        activeGlowLights = [];

        glowTrees.forEach((obj, idx) => {
            // Update emissive via instance pool materials (shared = all glow trees update at once)
            let pool = window.instancePools && window.instancePools['R_GLOW'];
            if (pool && idx === 0) { // Only update materials once (shared across all instances)
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

            // Add PointLight for nearby glow trees (max 20)
            if (glowBoost > 0.3 && idx < MAX_GLOW_LIGHTS) {
                let light = new THREE.PointLight(
                    new THREE.Color(0.3, 1.0, 0.5), // Green-ish glow
                    glowBoost * 2.5,
                    30, // distance
                    2   // decay
                );
                light.position.set(obj.x, 8, obj.z);
                scene.add(light);
                activeGlowLights.push(light);
            }
        });
    }

    // ============================================================
    // TRACER STYLES & GLOW BALL ENGINE
    // ============================================================
    window.currentTracerStyle = 'CLASSIC';

    const TRACER_STYLES = {
        'CLASSIC':    { core: '#ffffff', glow: null,      glowInt: 0,   ballEmissive: null,      ballLight: false, vertexFn: null,      dashed: false, label: '⚪ Classic' },
        'NEON_GREEN': { core: '#00ff88', glow: '#00ff44', glowInt: 1.5, ballEmissive: '#00ff88', ballLight: true,  vertexFn: null,      dashed: false, label: '💚 Neon' },
        'NEON_PINK':  { core: '#ff00ff', glow: '#ff44ff', glowInt: 1.5, ballEmissive: '#ff44ff', ballLight: true,  vertexFn: null,      dashed: false, label: '💜 Pink' },
        'FIRE':       { core: '#ff8800', glow: '#ff4400', glowInt: 1.2, ballEmissive: '#ff6600', ballLight: true,  vertexFn: 'fire',    dashed: false, label: '🔥 Fire' },
        'ICE':        { core: '#44aaff', glow: '#2266ff', glowInt: 1.0, ballEmissive: '#4488ff', ballLight: true,  vertexFn: 'ice',     dashed: false, label: '❄️ Ice' },
        'RAINBOW':    { core: '#ffffff', glow: '#ffffff', glowInt: 0.8, ballEmissive: '#ffffff', ballLight: true,  vertexFn: 'rainbow', dashed: false, label: '🌈 Rainbow' },
        'PHANTOM':    { core: '#8888cc', glow: null,      glowInt: 0,   ballEmissive: null,      ballLight: false, vertexFn: 'fade',    dashed: false, label: '👻 Phantom' },
        'PRO_DOT':    { core: '#fbbf24', glow: null,      glowInt: 0,   ballEmissive: null,      ballLight: false, vertexFn: null,      dashed: true,  label: '📍 Pro Dot' }
    };

    function hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) { r = g = b = l; } else {
            let hue2rgb = (p, q, t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
            let q = l < 0.5 ? l*(1+s) : l+s-l*s; let p = 2*l-q;
            r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
        }
        return [r, g, b];
    }

    function getTracerVertexColor(vertexFn, index, total) {
        let t = index / Math.max(total, 1);
        switch(vertexFn) {
            case 'fire': return [1.0, Math.max(0, 1.0 - t * 1.5), 0];
            case 'ice':  return [0.2 + t * 0.8, 0.5 + t * 0.5, 1.0];
            case 'rainbow': {
                let hue = ((t * 360 + performance.now() * 0.05) % 360) / 360;
                return hslToRgb(hue, 1.0, 0.5);
            }
            case 'fade': return [0.53, 0.53, 0.8];
            default: return null;
        }
    }

    window.setTracerStyle = function(styleName) {
        let style = TRACER_STYLES[styleName];
        if (!style) return;
        window.currentTracerStyle = styleName;

        // Core line
        if (typeof tracerMat !== 'undefined') {
            tracerMat.color.set(style.core);
            tracerMat.vertexColors = !!style.vertexFn;
            tracerMat.needsUpdate = true;
        }

        // Glow overlay
        if (typeof glowTracer !== 'undefined') {
            if (style.glow) {
                glowTracerMat.color.set(style.glow);
                glowTracer.visible = true;
                glowTracerMat.opacity = 0.3;
            } else {
                glowTracer.visible = false;
            }
            glowTracerMat.needsUpdate = true;
        }

        // PRO_DOT dashed
        if (typeof tracerMat !== 'undefined') {
            if (style.dashed && !(tracerMat instanceof THREE.LineDashedMaterial)) {
                tracerMat.color.set(style.core);
            }
        }

        // Ball skin
        applyBallSkin(style);

        // Update UI buttons
        document.querySelectorAll('.tracer-btn').forEach(b => b.style.outline = 'none');
        let activeBtn = document.getElementById('tracer-btn-' + styleName);
        if (activeBtn) activeBtn.style.outline = '2px solid #fff';

        // Sync with current TimeOfDay
        updateTracerForTimeOfDay(window.currentTimeOfDay || 12);
    };

    function applyBallSkin(style) {
        if (!window.ballMesh || !window.ballMesh.material) return;
        let mat = window.ballMesh.material;
        if (style.ballEmissive) {
            mat.emissive = new THREE.Color(style.ballEmissive);
            let nightFactor = (window.currentTimeOfDay < 6 || window.currentTimeOfDay > 19) ? 1.5 : 0.2;
            mat.emissiveIntensity = nightFactor;
        } else {
            mat.emissive = new THREE.Color(0x000000);
            mat.emissiveIntensity = 0;
        }
        mat.needsUpdate = true;
    }

    function updateTracerForTimeOfDay(hour) {
        let nightFactor = 0;
        if (hour < 5 || hour > 20) nightFactor = 1.0;
        else if (hour < 7) nightFactor = 1.0 - (hour - 5) / 2;
        else if (hour > 18) nightFactor = (hour - 18) / 2;

        let style = TRACER_STYLES[window.currentTracerStyle || 'CLASSIC'];

        // Glow overlay
        if (typeof glowTracer !== 'undefined' && typeof glowTracerMat !== 'undefined' && style.glow) {
            glowTracerMat.opacity = 0.15 + nightFactor * 0.5;
            glowTracerMat.needsUpdate = true;
        }

        // Ball glow light
        if (window.ballGlowLight) {
            window.ballGlowLight.intensity = nightFactor * (style.glowInt || 0) * 2.0;
            if (style.ballEmissive) window.ballGlowLight.color.set(style.ballEmissive);
        }

        // Ball emissive
        if (window.ballMesh && window.ballMesh.material && style.ballEmissive) {
            window.ballMesh.material.emissiveIntensity = 0.1 + nightFactor * 1.5;
            window.ballMesh.material.needsUpdate = true;
        }
    }

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000); // Rendering up to 4000m
    // Camera just behind and above ball
    camera.position.set(0, 2, 5); 

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.autoClear = false; // Required for Picture-in-Picture (Minimap)
    document.body.appendChild(renderer.domElement);
    // -- GOLF BALL FOR TESTING --
    window.ballPos = new THREE.Vector3(0,0,0);
    window.ballVelocity = new THREE.Vector3(0,0,0);
    let ballGeo = new THREE.SphereGeometry(0.0427, 32, 32);
    let ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 });
    window.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    window.ballMesh.castShadow = true;
    window.ballMesh.visible = false;
    scene.add(window.ballMesh);
    window.ball = window.ballMesh; // Add this alias to fix legacy code expecting 'ball' object
    
    // -- CUSTOM 3D MODELS INJECTION & ASSET REGISTRY --
    window.customModels = {};
    window.ASSET_REGISTRY = {
        'TREE':   { subcat: 'TREES', icon: '🌳', cat: 'nature', physics: { type: 'tree', trunkRadius: 0.5, height: 15.0, canopyRadius: 3.5 } },
        'OAK':    { subcat: 'TREES', icon: '🌳', cat: 'nature', file: 'Oaktree.glb?v=1', targetHeight: 18.0, brightness: 0.10, yOffset: -0.5, physics: { type: 'tree', trunkRadius: 1.5, height: 18.0, canopyRadius: 6.0 } },
        'OAK2':   { subcat: 'TREES', icon: '🍂', cat: 'nature', file: 'Oaktree_1.glb?v=1', targetHeight: 18.0, brightness: 0.10, yOffset: -0.5, physics: { type: 'tree', trunkRadius: 1.5, height: 18.0, canopyRadius: 6.0 } },
        'PALM':   { subcat: 'TREES', icon: '🌴', cat: 'nature', file: 'palm3.glb?v=2', targetHeight: 12.0, brightness: 0.20, physics: { type: 'tree', trunkRadius: 0.5, height: 15.0, canopyRadius: 3.0 } },
        'PINE':   { subcat: 'TREES', icon: '🌲', cat: 'nature', physics: { type: 'tree', trunkRadius: 0.5, height: 18.0, canopyRadius: 2.5 } },
        'BUSH':   { subcat: 'PLANTS', icon: '🪴', cat: 'nature', physics: { type: 'sphere', radius: 2.0 } },
        'ROCK':   { subcat: 'ROCKS', icon: '🪨', cat: 'nature', physics: { type: 'sphere', radius: 1.5 } },
        'CACTUS': { subcat: 'PLANTS', icon: '🌵', cat: 'nature', file: 'cactus_1.glb?v=1', targetHeight: 5.0, brightness: 0.20, physics: { type: 'cylinder', radius: 0.6, height: 6.0 } },
        'R_BUSH': { subcat: 'PLANTS', icon: '🟩', cat: 'nature', file: 'robloxstyle/bush_1.glb', targetHeight: 3.0, brightness: 0.10, physics: { type: 'sphere', radius: 2.0 } },
        'R_CACTUS': { subcat: 'PLANTS', icon: '🟩', cat: 'nature', file: 'robloxstyle/cactus_1.glb', targetHeight: 5.0, brightness: 0.10, physics: { type: 'cylinder', radius: 0.6, height: 6.0 } },
        'R_PALM1': { subcat: 'TREES', icon: '🟩', cat: 'nature', file: 'robloxstyle/Palm_1.glb', targetHeight: 12.0, brightness: 0.10, physics: { type: 'tree', trunkRadius: 0.5, height: 15.0, canopyRadius: 3.0 } },
        'R_TREE1': { subcat: 'TREES', icon: '🟩', cat: 'nature', file: 'robloxstyle/Tree_1.glb', targetHeight: 15.0, brightness: 0.10, physics: { type: 'tree', trunkRadius: 1.0, height: 15.0, canopyRadius: 5.0 } },
        'R_TREE2': { subcat: 'TREES', icon: '🟩', cat: 'nature', file: 'robloxstyle/Tree_2.glb', targetHeight: 15.0, brightness: 0.10, physics: { type: 'tree', trunkRadius: 1.0, height: 15.0, canopyRadius: 5.0 } },
        'R_SANDST': { subcat: 'ROCKS', icon: '🟩', cat: 'nature', file: 'robloxstyle/sandstone_1.glb', targetHeight: 4.0, brightness: 0.10, physics: { type: 'sphere', radius: 2.0 } },
        'R_STONE': { subcat: 'ROCKS', icon: '🟩', cat: 'nature', file: 'robloxstyle/ston_1.glb', targetHeight: 3.0, brightness: 0.10, physics: { type: 'sphere', radius: 1.5 } },
        'R_GLOW': { subcat: 'TREES', icon: '✨', cat: 'nature', file: 'robloxstyle/tree_glow.glb', targetHeight: 15.0, brightness: 0.10, physics: { type: 'tree', trunkRadius: 1.0, height: 15.0, canopyRadius: 5.0 } },
        'R_3DAI': { subcat: 'TREES', icon: '🤖', cat: 'nature', file: 'robloxstyle/tree_3dai.glb', targetHeight: 15.0, brightness: 0.10, physics: { type: 'tree', trunkRadius: 1.0, height: 15.0, canopyRadius: 5.0 } },
        'R_PALM3D': { subcat: 'TREES', icon: '🌴', cat: 'nature', file: 'robloxstyle/palm_3dai.glb', targetHeight: 15.0, brightness: 0.10, physics: { type: 'tree', trunkRadius: 0.8, height: 15.0, canopyRadius: 4.0 } }
    };
    
    // -- DYNAMIC UI GENERATION --
    window.currentNatureCategory = 'TREES';
    window.setNatureCategory = function(cat) {
        window.currentNatureCategory = cat;
        document.getElementById('cat-btn-TREES').className = cat === 'TREES' ? 'sys-btn active' : 'sys-btn';
        document.getElementById('cat-btn-ROCKS').className = cat === 'ROCKS' ? 'sys-btn active' : 'sys-btn';
        document.getElementById('cat-btn-PLANTS').className = cat === 'PLANTS' ? 'sys-btn active' : 'sys-btn';
        window.buildNatureUI();
    };

    window.CLOUD_BIOMES = {};
    window.CURRENT_BIOME_CONFIG = {
        skyColor: '#87ceeb',
        obColor: '#ef4444',
        bunkerColor: '#e0d8a4',
        wasteColor: '#c2af7c',
        teeColor: '#7cb54c',
        greenColor: '#98ce68',
        foregreenColor: '#8bc45d',
        fairwayColor: '#7db952',
        semiColor: '#6b9e3d',
        roughColor: '#4a782b',
        fescueColor: '#2d4c1a',
        waterColor: '#38bdf8'
    };

    window.openColorPicker = function(materialKey) {
        let picker = document.createElement('input');
        picker.type = 'color';
        picker.value = window.CURRENT_BIOME_CONFIG[materialKey + 'Color'];
        
        picker.oninput = function() {
            let oldConfig = Object.assign({}, window.CURRENT_BIOME_CONFIG);
            window.CURRENT_BIOME_CONFIG[materialKey + 'Color'] = picker.value;
            
            // Uppdatera knappens färg
            let btn = document.getElementById('pal-' + materialKey);
            if(btn) btn.style.background = picker.value;
            
            // Byt pixlar på marken
            if (window.recolorTerrain) {
                window.recolorTerrain(oldConfig, window.CURRENT_BIOME_CONFIG);
            }
            
            // Uppdatera penseln om knappen redan var aktiv
            if (btn && btn.classList.contains('active')) {
                if (window.setPaletteColor) {
                    window.setPaletteColor(materialKey, btn);
                }
            }
            
            // Ändra Dropdown till CUSTOM
            let select = document.getElementById('biome-select');
            if(select && select.value !== 'CUSTOM') {
                select.value = 'CUSTOM';
                window.ACTIVE_BIOME = 'CUSTOM';
            }
            // Spara den nya mixen i CUSTOM minnet
            window.CLOUD_BIOMES['CUSTOM'] = Object.assign({}, window.CURRENT_BIOME_CONFIG);
        };
        
        picker.click();
    };

    function hexToRgb(hex) {
        let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function colorMatch(r1, g1, b1, r2, g2, b2) {
        return Math.abs(r1 - r2) < 5 && Math.abs(g1 - g2) < 5 && Math.abs(b1 - b2) < 5;
    }

    window.recolorTerrain = function(oldConfig, newConfig) {
        if (!window.pCtx || !window.mapTex) return;
        let imgData = window.pCtx.getImageData(0, 0, 4096, 4096);
        let data = imgData.data;
        
        let keys = ['ob', 'bunker', 'waste', 'tee', 'green', 'foregreen', 'fairway', 'semi', 'rough', 'fescue'];
        let colorMap = [];
        keys.forEach(k => {
            let oldHex = oldConfig[k + 'Color'];
            let newHex = newConfig[k + 'Color'];
            if (oldHex && newHex && oldHex !== newHex) {
                let oldRgb = hexToRgb(oldHex);
                let newRgb = hexToRgb(newHex);
                if (oldRgb && newRgb) {
                    colorMap.push({ old: oldRgb, new: newRgb });
                }
            }
        });
        
        if (colorMap.length === 0) return; // Inget att byta ut
        
        for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i+1], b = data[i+2];
            for (let j = 0; j < colorMap.length; j++) {
                if (colorMatch(r, g, b, colorMap[j].old.r, colorMap[j].old.g, colorMap[j].old.b)) {
                    data[i] = colorMap[j].new.r;
                    data[i+1] = colorMap[j].new.g;
                    data[i+2] = colorMap[j].new.b;
                    break;
                }
            }
        }
        window.pCtx.putImageData(imgData, 0, 0);
        window.mapTex.needsUpdate = true;
        window.terrainBiomeData = window.pCtx.getImageData(0, 0, 4096, 4096).data;
        if(window.rebuildGreenMask) window.rebuildGreenMask();
    };

    window.ACTIVE_BIOME = 'ALL';
    window.changeBiome = function(val) {
        window.ACTIVE_BIOME = val;
        window.buildNatureUI();
        
        // Applicera färgerna från valt tema, eller Global som fallback
        let targetBiome = (val === 'ALL') ? 'GLOBAL' : val;
        let config = window.CLOUD_BIOMES[targetBiome];
        
        // Spara den gamla konfigurationen för att kunna byta ut pixlar
        let oldConfig = Object.assign({}, window.CURRENT_BIOME_CONFIG);
        
        // Om inget specifikt tema finns ännu, hämta global eller behåll nuvarande
        if(!config && targetBiome !== 'GLOBAL') {
            config = window.CLOUD_BIOMES['GLOBAL'] || window.CURRENT_BIOME_CONFIG;
        } else if (!config) {
            config = window.CURRENT_BIOME_CONFIG;
        }
        
        if (config) {
            window.CURRENT_BIOME_CONFIG = {
                skyColor: config.skyColor || window.CURRENT_BIOME_CONFIG.skyColor,
                obColor: config.obColor || window.CURRENT_BIOME_CONFIG.obColor,
                bunkerColor: config.bunkerColor || window.CURRENT_BIOME_CONFIG.bunkerColor,
                wasteColor: config.wasteColor || window.CURRENT_BIOME_CONFIG.wasteColor,
                teeColor: config.teeColor || window.CURRENT_BIOME_CONFIG.teeColor,
                greenColor: config.greenColor || window.CURRENT_BIOME_CONFIG.greenColor,
                foregreenColor: config.foregreenColor || window.CURRENT_BIOME_CONFIG.foregreenColor,
                fairwayColor: config.fairwayColor || window.CURRENT_BIOME_CONFIG.fairwayColor,
                semiColor: config.semiColor || window.CURRENT_BIOME_CONFIG.semiColor,
                roughColor: config.roughColor || window.CURRENT_BIOME_CONFIG.roughColor,
                fescueColor: config.fescueColor || window.CURRENT_BIOME_CONFIG.fescueColor,
                waterColor: config.waterColor || window.CURRENT_BIOME_CONFIG.waterColor
            };
            
            // Uppdatera 3D-scenen
            if (typeof scene !== 'undefined' && scene) {
                scene.background = new THREE.Color(window.CURRENT_BIOME_CONFIG.skyColor);
                if (scene.fog) scene.fog.color.setHex(parseInt(window.CURRENT_BIOME_CONFIG.skyColor.replace('#','0x')));
            }
            
            // Uppdatera terrängens canvas pixlar i realtid
            if(window.recolorTerrain) {
                window.recolorTerrain(oldConfig, window.CURRENT_BIOME_CONFIG);
            }
            
            // Uppdatera vatten
            if (typeof waterMaterial !== 'undefined' && waterMaterial) {
                waterMaterial.color.setHex(parseInt(window.CURRENT_BIOME_CONFIG.waterColor.replace('#','0x')));
            }
            
            // Uppdatera HTML-paletten
            let keys = ['ob', 'bunker', 'waste', 'tee', 'green', 'foregreen', 'fairway', 'semi', 'rough', 'fescue'];
            keys.forEach(k => {
                let el = document.getElementById('pal-' + k);
                if(el) {
                    el.style.background = window.CURRENT_BIOME_CONFIG[k + 'Color'];
                }
            });
            
            // Visa eller dölj färg-kugghjulen beroende på om vi är i CUSTOM-läget
            let gearIcons = document.querySelectorAll('.color-edit-icon');
            let isCustom = (window.ACTIVE_BIOME === 'CUSTOM');
            gearIcons.forEach(icon => {
                icon.style.display = isCustom ? 'inline-block' : 'none';
            });
            
            // Uppdatera ghost block färg
            let activePal = document.querySelector('.palette-btn.active');
            if (activePal && activePal.id && activePal.id.startsWith('pal-')) {
                let type = activePal.id.split('-')[1];
                setPaletteColor(type, activePal);
            }
        }
    };

    window.buildNatureUI = function() {
        const natureGroup = document.getElementById('nature-assets-grid');
        if (!natureGroup) return;
        natureGroup.innerHTML = '<div class="palette-btn active" style="background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px;" onclick="setNatureType(\'RANDOM\', this)" title="Random Mix">❓</div>';
        for (let key in window.ASSET_REGISTRY) {
            let asset = window.ASSET_REGISTRY[key];
            if (asset.cat === 'nature' && asset.subcat === window.currentNatureCategory) {
                let biomes = asset.biomes || ['GLOBAL'];
                if (window.ACTIVE_BIOME === 'ALL' || biomes.includes('GLOBAL') || biomes.includes(window.ACTIVE_BIOME)) {
                    natureGroup.innerHTML += `<div class="palette-btn" style="background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px;" onclick="setNatureType('${key}', this)" title="${key}">${asset.icon}</div>`;
                }
            }
        }
        
        // Auto-select "Random Mix" whenever category changes to prevent placing wrong category items
        window.currentNatureType = 'RANDOM';
    };
    window.buildNatureUI();
    
    window.fetchCloudAssets = async function() {
        try {
            let res = await fetch('/api/assets');
            let assets = await res.json();
            assets.forEach(a => {
                let conf = a.config || {};
                window.ASSET_REGISTRY[a.id] = {
                    icon: a.icon || '📦',
                    cat: a.category || 'nature',
                    subcat: a.subcategory || 'TREES',
                    isCloud: true,
                    cloudId: a.id,
                    targetHeight: conf.targetHeight || 10.0,
                    yOffset: conf.yOffset || 0.0,
                    brightness: conf.brightness !== undefined ? conf.brightness : 0.0,
                    physics: conf.physics || { type: 'sphere', radius: 1.0 },
                    biomes: conf.biomes || ['GLOBAL'],
                    fileSizeMB: conf.fileSizeMB || 0.5
                };
            });
            window.buildNatureUI(); // Rebuild UI with cloud assets
        } catch(e) {
            console.error("Failed to load cloud assets", e);
        }
    };

    window.fetchCloudBiomes = async function() {
        try {
            let res = await fetch('/api/biomes');
            if(res.ok) {
                let data = await res.json();
                let select = document.getElementById('biome-select');
                if(select) {
                    select.innerHTML = '<option value="ALL">All Assets (Global)</option>';
                }
                data.forEach(t => {
                    window.CLOUD_BIOMES[t.id] = t.config;
                    if(t.id !== 'GLOBAL' && select) {
                        select.innerHTML += `<option value="${t.id}">${t.name}</option>`;
                    }
                });
                if(select) {
                    select.innerHTML += '<option value="CUSTOM">⚙️ CUSTOM COLORS</option>';
                }
                
                // Applicera "ALL" / "GLOBAL" som start-tema om det finns
                window.changeBiome('ALL');
            }
        } catch(e) {
            console.error("Failed to fetch biomes", e);
        }
    };

    window.fetchCloudAssets();
    window.fetchCloudBiomes();
    
    const dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');
    const gltfLoader = new THREE.GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
    
    // Nya extremt nerskalade palmen (250 KB)
    window.loadAsset = function(type, callback) {
        if (!window.ASSET_REGISTRY[type]) {
            if(callback) callback(false);
            return;
        }
        if (!window.ASSET_REGISTRY[type].file && !window.ASSET_REGISTRY[type].isCloud) {
            if(callback) callback(false);
            return;
        }
        if (window.customModels[type] && window.customModels[type] !== 'LOADING') {
            if(callback) callback(true);
            return;
        }
        if (window.customModels[type] === 'LOADING') return;
        
        window.customModels[type] = 'LOADING';

        const performGLTFLoad = (url) => {
            gltfLoader.load(url, function(gltf) {
            try {
                let model = gltf.scene;
                let box = new THREE.Box3().setFromObject(model);
                let center = box.getCenter(new THREE.Vector3());
                let size = box.getSize(new THREE.Vector3());
                
                let targetHeight = window.ASSET_REGISTRY[type].targetHeight || 12.0; 
                let scaleFixed = (size.y > 0.001) ? (targetHeight / size.y) : 1.0;
                if (!isFinite(scaleFixed)) scaleFixed = 1.0;
                
                let cx = isFinite(center.x) ? center.x : 0;
                let cymin = isFinite(box.min.y) ? box.min.y : 0;
                let cz = isFinite(center.z) ? center.z : 0;
                
                let yOffset = window.ASSET_REGISTRY[type].yOffset !== undefined ? window.ASSET_REGISTRY[type].yOffset : 0;

                model.scale.set(scaleFixed, scaleFixed, scaleFixed);
                model.position.set(-cx * scaleFixed, (-cymin * scaleFixed) + yOffset, -cz * scaleFixed);
                
                let container = new THREE.Group();
                container.add(model);
                
                container.traverse(function(node) {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                        if (node.material) {
                            let mats = Array.isArray(node.material) ? node.material : [node.material];
                            mats.forEach(mat => {
                                // Fix "dark GLTF models" and make matte
                                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                                    mat.metalness = 0.0; 
                                    mat.roughness = 1.0; // 1.0 = Fully matte surface
                                    mat.roughnessMap = null; // Remove baked gloss textures
                                    mat.metalnessMap = null;
                                    
                                    // Read brightness from registry (default 0.15)
                                    let boost = window.ASSET_REGISTRY[type].brightness !== undefined ? window.ASSET_REGISTRY[type].brightness : 0.15;
                                    
                                    // Simulate ambient light
                                    if (mat.color) {
                                        if (type.startsWith('R_')) {
                                            let hsl = {};
                                            mat.color.getHSL(hsl);
                                            mat.color.setHSL(hsl.h, Math.min(1.0, hsl.s * 1.6), Math.min(1.0, hsl.l * 1.2));
                                        }
                                        if (boost > 0) {
                                            mat.emissive = mat.color.clone().multiplyScalar(boost);
                                        }
                                    }

                                    let isTree = window.ASSET_REGISTRY[type] && window.ASSET_REGISTRY[type].subcat === 'TREES';
                                    if (isTree) {
                                        mat.onBeforeCompile = (shader) => {
                                            shader.vertexShader = shader.vertexShader.replace(
                                                '#include <color_pars_vertex>',
                                                '#include <color_pars_vertex>\n#ifdef USE_INSTANCING\nattribute vec3 instanceTrunkColor;\n#endif\nvarying vec3 vInstanceTrunkColor;'
                                            );
                                            shader.vertexShader = shader.vertexShader.replace(
                                                '#include <color_vertex>',
                                                '#include <color_vertex>\n#ifdef USE_INSTANCING\nvInstanceTrunkColor = instanceTrunkColor;\n#else\nvInstanceTrunkColor = vec3(1.0);\n#endif'
                                            );
                                            shader.fragmentShader = shader.fragmentShader.replace(
                                                '#include <color_pars_fragment>',
                                                '#include <color_pars_fragment>\nvarying vec3 vInstanceTrunkColor;'
                                            );
                                            shader.fragmentShader = shader.fragmentShader.replace(
                                                '#include <color_fragment>',
                                                `
#if defined( USE_COLOR_ALPHA )
    vec3 texC = diffuseColor.rgb;
    bool isBrown = (texC.r > texC.g + 0.01) && (texC.g + 0.05 >= texC.b) && (texC.r < 0.8);
    bool isGrey = abs(texC.r - texC.g) < 0.1 && abs(texC.g - texC.b) < 0.1 && texC.r < 0.6;
    vec3 targetColor = (!isBrown && !isGrey) ? vColor.rgb : vInstanceTrunkColor;
    float tintStr = distance(targetColor, vec3(1.0, 1.0, 1.0));
    if (tintStr > 0.02) {
        float lum = dot(texC, vec3(0.299, 0.587, 0.114));
        vec3 tinted = targetColor * (lum * 1.8);
        diffuseColor.rgb = mix(texC, tinted, 0.95);
    }
    diffuseColor.a *= vColor.a;
#elif defined( USE_COLOR )
    vec3 texC = diffuseColor.rgb;
    bool isBrown = (texC.r > texC.g + 0.01) && (texC.g + 0.05 >= texC.b) && (texC.r < 0.8);
    bool isGrey = abs(texC.r - texC.g) < 0.1 && abs(texC.g - texC.b) < 0.1 && texC.r < 0.6;
    vec3 targetColor = (!isBrown && !isGrey) ? vColor : vInstanceTrunkColor;
    float tintStr = distance(targetColor, vec3(1.0, 1.0, 1.0));
    if (tintStr > 0.02) {
        float lum = dot(texC, vec3(0.299, 0.587, 0.114));
        vec3 tinted = targetColor * (lum * 1.8);
        diffuseColor.rgb = mix(texC, tinted, 0.95);
    }
#endif
                                                `
                                            );
                                        };
                                    }
                                    mat.needsUpdate = true;
                                }
                            });
                        }
                    }
                });
                window.customModels[type] = container;
                console.log(type + " loaded successfully!");
                
                window.updateMemoryBudget(); // Uppdatera mätaren!
                
                // Rebuild instance pool now that GLTF is loaded
                if (window.placedTrees && window.placedTrees.some(t => t.type === type)) {
                    buildInstancePool(type);
                    rebuildInstancePool(type);
                }
                if(callback) callback(true);
            } catch(err) {
                console.error(type + " processing error:", err);
                window.customModels[type] = null;
                if(callback) callback(false);
            }
        }, undefined, function(error) {
            console.error(type + " load error:", error);
            window.customModels[type] = null;
            if(callback) callback(false);
        });
        };

        if (window.ASSET_REGISTRY[type].isCloud) {
            fetch('/api/assets/' + window.ASSET_REGISTRY[type].cloudId + '/download')
            .then(res => res.json())
            .then(data => {
                if(data.file_data) {
                    performGLTFLoad(data.file_data);
                } else {
                    window.customModels[type] = null;
                    if(callback) callback(false);
                }
            })
            .catch(e => {
                console.error("Cloud Asset Download failed", e);
                window.customModels[type] = null;
                if(callback) callback(false);
            });
        } else {
            performGLTFLoad(window.ASSET_REGISTRY[type].file);
        }
    };
    
    // --- MEMORY BUDGET LOGIC ---
    window.MAX_ASSET_BUDGET_MB = 40.0;
    window.updateMemoryBudget = function() {
        // Obsolete: Admin handles budget per biome.
    };
    
    // Preload models
    window.loadAsset('PALM');
    window.loadAsset('OAK');
    window.loadAsset('OAK2');
    window.loadAsset('R_BUSH');
    window.loadAsset('R_CACTUS');
    window.loadAsset('R_PALM1');
    window.loadAsset('R_TREE1');
    window.loadAsset('R_TREE2');
    window.loadAsset('R_SANDST');
    window.loadAsset('R_STONE');
    window.loadAsset('R_GLOW');
    window.loadAsset('R_3DAI');
    window.loadAsset('R_PALM3D');
    
    // --- GSPRO AIM SYSTEM & MINIMAP CAMERA ---
    window.aimTarget = new THREE.Vector3(0, 0, -20);
    window.aimTracerGeo = new THREE.BufferGeometry();
    window.aimTracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    window.aimTracerLine = new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.6 });
    const aimLineMesh = new THREE.Line(window.aimTracerGeo, window.aimTracerLine);
    aimLineMesh.computeLineDistances();
    scene.add(aimLineMesh);
    
    // Orthographic Camera for Minimap
    const mapSize = 150; 
    const minimapCamera = new THREE.OrthographicCamera(-mapSize, mapSize, mapSize, -mapSize, 0.1, 1000);
    minimapCamera.position.set(0, 300, 0); 
    minimapCamera.lookAt(0, 0, 0);
    minimapCamera.up.set(0, 0, -1); 

    // Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048; 
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    scene.add(dirLight);
    
    // Create sun sphere
    const sunGeo = new THREE.SphereGeometry(15, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe600 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(200, 150, -400); 
    scene.add(sunMesh);

    // Initialize TimeOfDay engine to default (midday)
    setTimeout(() => { if(window.setTimeOfDay) window.setTimeOfDay(12); }, 100);

    // 2. CREATE FLOOR
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 16; tCanvas.height = 16; 
    const tCtx = tCanvas.getContext('2d');
    tCtx.clearRect(0,0,16,16); 
    tCtx.fillStyle = 'rgba(0,0,0,0.1)'; 
    tCtx.fillRect(0,0,8,8); tCtx.fillRect(8,8,8,8); 
    
    const gridTex = new THREE.CanvasTexture(tCanvas);
    gridTex.wrapS = THREE.RepeatWrapping;
    gridTex.wrapT = THREE.RepeatWrapping;
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = 4096; paintCanvas.height = 4096;
    const pCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
    window.pCtx = pCtx;
    
    pCtx.fillStyle = '#4a782b';
    pCtx.fillRect(0, 0, 4096, 4096);
    
    const mapTex = new THREE.CanvasTexture(paintCanvas);
    mapTex.magFilter = THREE.LinearFilter;
    window.mapTex = mapTex;
    
    window.greenMaskCanvas = document.createElement('canvas');
    window.greenMaskCanvas.width = 4096; window.greenMaskCanvas.height = 4096;
    window.greenCtx = window.greenMaskCanvas.getContext('2d', { willReadFrequently: true });
    window.greenCtx.fillStyle = '#000000'; 
    window.greenCtx.fillRect(0, 0, 4096, 4096);
    window.greenMaskTex = new THREE.CanvasTexture(window.greenMaskCanvas);
    window.greenMaskTex.magFilter = THREE.LinearFilter;
    
    window.rebuildGreenMask = function() {
        if (!window.terrainBiomeData) return;
        let gData = window.greenCtx.createImageData(4096, 4096);
        let tData = window.terrainBiomeData;
        for(let i=0; i < tData.length; i+=4) {
            let r = tData[i], g = tData[i+1], b = tData[i+2];
            let dGreen = (r-152)*(r-152) + (g-206)*(g-206) + (b-104)*(b-104);
            if (dGreen < 2000) {
                gData.data[i] = 255; gData.data[i+1] = 255; gData.data[i+2] = 255; gData.data[i+3] = 255;
            } else {
                gData.data[i] = 0; gData.data[i+1] = 0; gData.data[i+2] = 0; gData.data[i+3] = 255;
            }
        }
        window.greenCtx.putImageData(gData, 0, 0);
        window.greenMaskTex.needsUpdate = true;
    };

    const waterCanvas = document.createElement('canvas');
    waterCanvas.width = 4096; waterCanvas.height = 4096;
    const wCtx = waterCanvas.getContext('2d');
    wCtx.fillStyle = '#000000'; 
    wCtx.fillRect(0, 0, 4096, 4096);
    const waterTex = new THREE.CanvasTexture(waterCanvas);
    waterTex.magFilter = THREE.LinearFilter;
    
    const TERRAIN_SIZE = 900; 
    const TERRAIN_SEGS = 600; 
    const planeGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
    planeGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    
    const planeMat = new THREE.MeshLambertMaterial({ map: mapTex, vertexColors: false });
    
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);
    
    window.minimapMat = planeMat.clone();
    window.minimapMat.extensions = { derivatives: true };
    window.heatmapShaderRef = null;
    
    window.minimapMat.onBeforeCompile = function(shader) {
        shader.uniforms.uFlagHeight = { value: 0.0 };
        shader.uniforms.tGreenMask = { value: window.greenMaskTex };
        window.heatmapShaderRef = shader;
        
        shader.vertexShader = shader.vertexShader.replace(
            'void main() {',
            'varying float vWorldY;\n varying vec2 vCustomUv;\n void main() {\n vCustomUv = uv;\n'
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n vWorldY = (modelMatrix * vec4(position, 1.0)).y;\n'
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            'void main() {',
            'varying float vWorldY;\n varying vec2 vCustomUv;\n uniform float uFlagHeight;\n uniform sampler2D tGreenMask;\n void main() {\n'
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            
            vec4 greenMask = texture2D(tGreenMask, vCustomUv);
            float diff = vWorldY - uFlagHeight;
            float contourInterval = 0.25;
            
            float slope = length(vec2(dFdx(vWorldY), dFdy(vWorldY)));
            float distToContour = abs(fract(vWorldY / contourInterval + 0.5) - 0.5) * contourInterval;
            float lineThicknessWorld = slope * 1.5; 
            
            bool isLine = (slope > 0.002) && (distToContour < lineThicknessWorld);
            
            vec3 hmColor = vec3(0.0);
            if (diff >= 1.0) hmColor = vec3(0.8, 0.0, 0.0);
            else if (diff > 0.3) hmColor = mix(vec3(0.5, 0.8, 0.0), vec3(0.8, 0.0, 0.0), (diff - 0.3)/0.7);
            else if (diff > -0.3) hmColor = mix(vec3(0.2, 0.7, 0.2), vec3(0.5, 0.8, 0.0), (diff + 0.3)/0.6);
            else if (diff > -1.0) hmColor = mix(vec3(0.0, 0.5, 0.8), vec3(0.2, 0.7, 0.2), (diff + 1.0)/0.7);
            else hmColor = vec3(0.0, 0.0, 0.6);
            
            float heatAlpha = greenMask.r * 0.85; 
            
            vec3 mapColor = mix(gl_FragColor.rgb, hmColor, heatAlpha);
            if (isLine) mapColor = vec3(0.05); 
            
            gl_FragColor = vec4(mapColor, gl_FragColor.a);
            `
        );
    };
    
    const waterGeo = planeGeo.clone(); 
    waterGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    let wPos = waterGeo.attributes.position.array;
    window.waterBaseZ = new Float32Array(waterGeo.attributes.position.count);
    for(let i=0; i<waterGeo.attributes.position.count; i++) {
        wPos[i*3 + 2] = -99.0;
        window.waterBaseZ[i] = -99.0;
    }
    
    const waterMat = new THREE.MeshLambertMaterial({ 
        color: 0x38bdf8, 
        transparent: true, 
        opacity: 0.95, 
        alphaMap: waterTex, 
        alphaTest: 0.01, 
        depthWrite: true 
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);

    // Regenerate water alpha mask from heightmap data
    // Called after loading water heights to ensure visibility
    function rebuildWaterMask() {
        if (typeof wCtx === 'undefined' || typeof waterGeo === 'undefined') return;
        wCtx.fillStyle = '#000000';
        wCtx.fillRect(0, 0, 4096, 4096);
        let wPosArr = waterGeo.attributes.position.array;
        let count = waterGeo.attributes.position.count;
        let segs = TERRAIN_SEGS;
        let pixPerSeg = 4096 / segs;
        wCtx.fillStyle = '#ffffff';
        for (let i = 0; i < count; i++) {
            let z = wPosArr[i * 3 + 2];
            if (z > -90) {
                let gx = i % (segs + 1);
                let gz = Math.floor(i / (segs + 1));
                let px = gx * pixPerSeg;
                let py = gz * pixPerSeg;
                wCtx.fillRect(px - pixPerSeg, py - pixPerSeg, pixPerSeg * 3, pixPerSeg * 3);
            }
        }
        waterTex.needsUpdate = true;
    }
    
    const gridMat = new THREE.MeshBasicMaterial({ 
        map: gridTex, 
        transparent: true, 
        polygonOffset: true, 
        polygonOffsetFactor: -1, 
        polygonOffsetUnits: -1 
    });
    const gridPlane = new THREE.Mesh(planeGeo, gridMat);
    gridPlane.rotation.x = -Math.PI / 2;
    scene.add(gridPlane);

    window.resetAimTarget = function() {
        let hole = courseHoles[playingHoleIndex];
        if (hole && hole.flag) {
            window.aimTarget = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        }
    };

    window.localGetTerrainAt = function(px, py) {
        if (!window.terrainBiomeData) {
            return { z: 0, normal: [0, 0, 1], type: 'FAIRWAY' };
        }
        
        let threeX = px;
        let threeZ = -py;
        
        let gx = Math.round((threeX + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
        let gz = Math.round((threeZ + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
        
        if(gx < 0) gx = 0; if(gx > TERRAIN_SEGS) gx = TERRAIN_SEGS;
        if(gz < 0) gz = 0; if(gz > TERRAIN_SEGS) gz = TERRAIN_SEGS;
        
        let idx = gz * (TERRAIN_SEGS+1) + gx;
        let positions = planeGeo.attributes.position.array;
        let height = positions[idx * 3 + 2]; 
        
        let gxRight = Math.min(TERRAIN_SEGS, gx + 1);
        let gzDown = Math.max(0, gz - 1); 

        let hR = positions[(gz * (TERRAIN_SEGS+1) + gxRight) * 3 + 2];
        let hD = positions[(gzDown * (TERRAIN_SEGS+1) + gx) * 3 + 2];
        
        let step = TERRAIN_SIZE/TERRAIN_SEGS;
        let dx_phys = (hR - height) / step;
        let dy_phys = (hD - height) / step; 
        
        let len = Math.sqrt(dx_phys*dx_phys + dy_phys*dy_phys + 1.0);
        let normal = [-dx_phys/len, -dy_phys/len, 1.0/len];
        
        let cX = Math.floor(((threeX + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096);
        let cZ = Math.floor(((threeZ + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096);
        if (cX < 0) cX = 0; if (cX >= 4096) cX = 4095;
        if (cZ < 0) cZ = 0; if (cZ >= 4096) cZ = 4095;
        
        let pIdx = (cZ * 4096 + cX) * 4;
        let r = window.terrainBiomeData[pIdx];
        let g = window.terrainBiomeData[pIdx+1];
        let b = window.terrainBiomeData[pIdx+2];
        
        let biomeType = 'ROUGH'; 
        function cDist(r1, g1, b1, r2, g2, b2) { return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2; }
        
        let dOB = cDist(r,g,b, 239,68,68);
        let dSand = cDist(r,g,b, 224,216,164);
        let dWaste = cDist(r,g,b, 194,175,124);
        let dFairway = cDist(r,g,b, 125,185,82);
        let dSemiRough = cDist(r,g,b, 107,158,61);
        let dRough = cDist(r,g,b, 74,120,43);
        let dDeepRough = cDist(r,g,b, 45,76,26);
        let dGreen = cDist(r,g,b, 152,206,104);
        let dWater = cDist(r,g,b, 56,189,248);
        
        let minD = Math.min(dOB, dSand, dWaste, dFairway, dSemiRough, dRough, dDeepRough, dGreen, dWater);
        
        if (minD === dSand) biomeType = 'SAND';
        else if (minD === dWaste) biomeType = 'WASTE';
        else if (minD === dGreen) biomeType = 'GREEN';
        else if (minD === dOB) biomeType = 'OB';
        else if (minD === dWater) biomeType = 'WATER';
        else if (minD === dFairway) biomeType = 'FAIRWAY';
        else if (minD === dSemiRough) biomeType = 'SEMI-ROUGH';
        else if (minD === dDeepRough) biomeType = 'DEEP ROUGH';
        else biomeType = 'ROUGH';
        
        let waterHeight = -99;
        if (typeof waterGeo !== 'undefined' && waterGeo) {
            waterHeight = waterGeo.attributes.position.array[idx * 3 + 2];
        }
        if (waterHeight > -90 && height < waterHeight + 0.1) {
            biomeType = 'WATER';
            height = waterHeight; 
        }
        return { z: height, normal: normal, type: biomeType };
    };

    const greenBeadsGroup = new THREE.Group();
    scene.add(greenBeadsGroup);
    window.greenBeads = [];
    const beadGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 });
    
    window.greenBeadsEnabled = true;  // Toggle from hamburger menu
    window.greenGridEnabled = false;  // Toggle from hamburger menu
    window.greenGridMesh = null;      // Grid line mesh on green surface
    const BEAD_ACTIVATION_DISTANCE = 45; // meters (~50 yards) from flag
    window.breakLineMesh = null;
    
    const brushGeo = new THREE.RingGeometry(3.5, 4.0, 32);
    const brushMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide });
    const sculptBrushCursor = new THREE.Mesh(brushGeo, brushMat);
    sculptBrushCursor.rotation.x = -Math.PI / 2;
    sculptBrushCursor.visible = false;
    scene.add(sculptBrushCursor);

    const measureGeo = new THREE.BufferGeometry();
    const measurePos = new Float32Array(5 * 3); 
    measureGeo.setAttribute('position', new THREE.BufferAttribute(measurePos, 3));
    const measureMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false, linewidth: 3 });
    const measureLines = new THREE.Line(measureGeo, measureMat);
    measureLines.renderOrder = 999; 
    measureLines.visible = false;
    scene.add(measureLines);
    let measureStartPoint = null;

    const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4033 });
    const treeLeavesMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 }); 
    const bushLeavesMat = new THREE.MeshLambertMaterial({ color: 0x4d7c0f }); 

    const rockMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

    const oakLeavesMat = new THREE.MeshLambertMaterial({ color: 0x3f6b2b }); 

    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 6); 
    const oakTrunkGeo = new THREE.CylinderGeometry(1.2, 1.8, 6, 8); 
    const leafGeo = new THREE.IcosahedronGeometry(3.5, 1); 
    const oakLeafGeo = new THREE.IcosahedronGeometry(6.0, 1); 
    const bushGeo = new THREE.IcosahedronGeometry(2.0, 1); 
    const pineGeo = new THREE.ConeGeometry(2.5, 8, 6); 
    const spineGeo = new THREE.CylinderGeometry(0.3, 0.6, 8, 6); 
    const rockGeo = new THREE.DodecahedronGeometry(1.5, 0); 

    window.placedTrees = [];
    const treesGroup = new THREE.Group(); // Legacy fallback container
    scene.add(treesGroup);

    // ============================================================
    // INSTANCEDMESH POOL ENGINE
    // ============================================================
    const INSTANCE_MAX = 2000; // Max instances per type
    window.instancePools = {};
    const _iMatrix = new THREE.Matrix4();
    const _iPos = new THREE.Vector3();
    const _iQuat = new THREE.Quaternion();
    const _iScale = new THREE.Vector3();
    const _yAxis = new THREE.Vector3(0, 1, 0);

    // Procedural asset sub-mesh definitions (for TREE/PINE/BUSH/ROCK)
    const PROCEDURAL_SUBMESHES = {
        'TREE': [
            { geometry: trunkGeo, material: treeTrunkMat, offsetY: 2.0 },
            { geometry: leafGeo, material: treeLeavesMat, offsetY: 5.0, scaleY: 0.8 }
        ],
        'PINE': [
            { geometry: trunkGeo, material: treeTrunkMat, offsetY: 2.0 },
            { geometry: pineGeo, material: treeLeavesMat, offsetY: 6.0 }
        ],
        'BUSH': [
            { geometry: bushGeo, material: bushLeavesMat, offsetY: 0.5 }
        ],
        'ROCK': [
            { geometry: rockGeo, material: rockMat, offsetY: 0.5 }
        ]
    };

    function extractSubMeshes(type) {
        // Procedural assets
        if (PROCEDURAL_SUBMESHES[type]) {
            return PROCEDURAL_SUBMESHES[type].map(def => ({
                geometry: def.geometry,
                material: def.material,
                offsetY: def.offsetY || 0,
                scaleY: def.scaleY || 1.0
            }));
        }
        // GLTF models — use WORLD transforms (includes parent container scale)
        let model = window.customModels[type];
        if (!model || model === 'LOADING') return null;
        model.updateWorldMatrix(true, true); // Force full hierarchy matrix update
        let subs = [];
        let isTree = window.ASSET_REGISTRY[type] && window.ASSET_REGISTRY[type].subcat === 'TREES';

        model.traverse(child => {
            if (child.isMesh) {
                let worldPos = new THREE.Vector3();
                let worldScale = new THREE.Vector3();
                child.getWorldPosition(worldPos);
                child.getWorldScale(worldScale);
                
                let isColorable = true;
                if (isTree) {
                    let name = (child.name || "").toLowerCase();
                    let matName = (child.material && child.material.name) ? child.material.name.toLowerCase() : "";
                    
                    if (name.includes('trunk') || name.includes('wood') || name.includes('bark') || name.includes('stem') || name.includes('branch') || name.includes('rock') || name.includes('stone')) {
                        isColorable = false;
                    }
                    if (matName.includes('trunk') || matName.includes('wood') || matName.includes('bark') || matName.includes('stem') || matName.includes('branch') || matName.includes('rock') || matName.includes('stone')) {
                        isColorable = false;
                    }
                    
                    if (isColorable && child.material && child.material.color) {
                        let c = child.material.color;
                        let isBrown = (c.r > c.g) && (c.g >= c.b) && (c.r < 0.7);
                        let isGrey = Math.abs(c.r - c.g) < 0.05 && Math.abs(c.g - c.b) < 0.05 && c.r < 0.6;
                        if (isBrown || isGrey) {
                            isColorable = false;
                        }
                    }
                }

                subs.push({
                    geometry: child.geometry,
                    material: child.material,
                    offsetY: worldPos.y,
                    offsetX: worldPos.x,
                    offsetZ: worldPos.z,
                    childScale: worldScale,
                    isColorable: isColorable
                });
            }
        });
        return subs.length > 0 ? subs : null;
    }

    function buildInstancePool(type) {
        // Destroy existing pool first
        destroyInstancePool(type);
        let subs = extractSubMeshes(type);
        if (!subs) return null;

        let pool = { meshes: [], subOffsets: [], activeCount: 0 };
        subs.forEach(sub => {
            let iMesh = new THREE.InstancedMesh(sub.geometry, sub.material, INSTANCE_MAX);
            iMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(INSTANCE_MAX * 3), 3);
            iMesh.geometry.setAttribute('instanceTrunkColor', new THREE.InstancedBufferAttribute(new Float32Array(INSTANCE_MAX * 3), 3));
            iMesh.count = 0;
            iMesh.castShadow = true;
            iMesh.receiveShadow = true;
            iMesh.frustumCulled = false;
            scene.add(iMesh);
            pool.meshes.push(iMesh);
            pool.subOffsets.push({
                x: sub.offsetX || 0,
                y: sub.offsetY || 0,
                z: sub.offsetZ || 0,
                sy: sub.scaleY || 1.0,
                cs: sub.childScale || null,
                isColorable: sub.isColorable !== false
            });
        });
        window.instancePools[type] = pool;
        return pool;
    }

    function rebuildInstancePool(type) {
        let pool = window.instancePools[type];
        if (!pool) pool = buildInstancePool(type);
        if (!pool) return;

        let trees = window.placedTrees.filter(t => t.type === type);
        pool.activeCount = trees.length;

        trees.forEach((t, i) => {
            pool.meshes.forEach((iMesh, mi) => {
                let off = pool.subOffsets[mi];
                _iPos.set(t.x + (off.x * t.scale), (t.y || 0) + (off.y * t.scale), t.z + (off.z * t.scale));
                _iQuat.setFromAxisAngle(_yAxis, t.rot || 0);
                let sy = t.scale * (off.sy || 1.0);
                if (off.cs) {
                    _iScale.set(t.scale * off.cs.x, sy * off.cs.y, t.scale * off.cs.z);
                } else {
                    _iScale.set(t.scale, sy, t.scale);
                }
                _iMatrix.compose(_iPos, _iQuat, _iScale);
                iMesh.setMatrixAt(i, _iMatrix);
                
                if (t.color && off.isColorable) {
                    iMesh.setColorAt(i, new THREE.Color(t.color));
                } else {
                    iMesh.setColorAt(i, new THREE.Color(0xffffff));
                }
                let tCol = t.trunkColor ? new THREE.Color(t.trunkColor) : new THREE.Color(0xffffff);
                iMesh.geometry.attributes.instanceTrunkColor.setXYZ(i, tCol.r, tCol.g, tCol.b);
            });
        });

        pool.meshes.forEach(iMesh => {
            iMesh.count = pool.activeCount;
            iMesh.instanceMatrix.needsUpdate = true;
            if (iMesh.instanceColor) iMesh.instanceColor.needsUpdate = true;
            if (iMesh.geometry.attributes.instanceTrunkColor) iMesh.geometry.attributes.instanceTrunkColor.needsUpdate = true;
        });
    }

    function destroyInstancePool(type) {
        let pool = window.instancePools[type];
        if (!pool) return;
        pool.meshes.forEach(iMesh => {
            scene.remove(iMesh);
            // Don't dispose shared geometry/material
        });
        delete window.instancePools[type];
    }

    function rebuildAllPools() {
        let types = new Set(window.placedTrees.map(t => t.type));
        // Also rebuild existing pools that may now be empty
        Object.keys(window.instancePools).forEach(t => types.add(t));
        types.forEach(type => rebuildInstancePool(type));
    }

    function destroyAllPools() {
        Object.keys(window.instancePools).forEach(type => destroyInstancePool(type));
    }

    function createTree(type, x, z, scale, rot, color) {
        // Raycast for ground Y
        let groundY = 0;
        let downRay = new THREE.Raycaster(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
        let hits = downRay.intersectObject(plane);
        if(hits.length > 0) groundY = hits[0].point.y;

        // Push data
        window.placedTrees.push({ type: type, x: x, z: z, y: groundY, scale: scale, rot: rot, color: color });

        // Ensure asset is loading
        if (window.ASSET_REGISTRY[type] && window.ASSET_REGISTRY[type].file && !window.customModels[type]) {
            window.loadAsset(type);
        }

        // Rebuild visual pool for this type
        rebuildInstancePool(type);
    }


    const MAX_TRACER_POINTS = 6000;
    const tracerPositions = new Float32Array(MAX_TRACER_POINTS * 3);
    const tracerColors = new Float32Array(MAX_TRACER_POINTS * 3); // Per-vertex colors
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3));
    tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerColors, 3));
    tracerGeo.setDrawRange(0, 0);
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, linewidth: 3, vertexColors: false });
    const flightTracer = new THREE.Line(tracerGeo, tracerMat);
    scene.add(flightTracer);

    // Glow overlay (same geometry, additive blending)
    const glowTracerMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glowTracer = new THREE.Line(tracerGeo, glowTracerMat);
    glowTracer.visible = false;
    scene.add(glowTracer);

    // Ball glow PointLight (follows ball during flight)
    window.ballGlowLight = new THREE.PointLight(0x00ff88, 0, 15, 2);
    scene.add(window.ballGlowLight);

    let tracerPointsCount = 0;

    const targets = [];
    
    let courseHoles = [];
    for(let i=0; i<18; i++) {
        courseHoles.push({ 
            par: 4, 
            tees: { red: null, yellow: null, white: null, black: null },
            teeMeshes: { red: null, yellow: null, white: null, black: null },
            flag: null, 
            flagMesh: null 
        });
    }
    let currentHoleIndex = 0;
    let currentHoleAction = 'TEE_YELLOW';
    
    const teeGeo = new THREE.SphereGeometry(0.35, 16, 16); 
    const teeMat = new THREE.MeshLambertMaterial({ color: 0x38bdf8 });
    const flagPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 6, 8);
    const flagPoleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const flagClothGeo = new THREE.PlaneGeometry(1.5, 1.0);
    const flagClothMat = new THREE.MeshLambertMaterial({ color: 0xef4444, side: THREE.DoubleSide });

    function createTeeObject(x, y, z, colorHex=0xfacc15) {
        let group = new THREE.Group();
        let tMat = new THREE.MeshLambertMaterial({ color: colorHex });
        
        let meshLeft = new THREE.Mesh(teeGeo, tMat);
        meshLeft.position.set(-1.8, 0.35, 0);
        meshLeft.castShadow = true;
        
        let meshRight = new THREE.Mesh(teeGeo, tMat);
        meshRight.position.set(1.8, 0.35, 0);
        meshRight.castShadow = true;
        
        group.add(meshLeft);
        group.add(meshRight);
        
        group.position.set(x, y, z);
        scene.add(group);
        return group;
    }

    function createFlagObject(x, y, z) {
        let group = new THREE.Group();
        
        let holeGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16);
        let holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        let phole = new THREE.Mesh(holeGeo, holeMat);
        phole.position.set(0, 0.03, 0); 
        group.add(phole);
        
        let pole = new THREE.Mesh(flagPoleGeo, flagPoleMat);
        pole.position.set(0, 3.0, 0);
        pole.castShadow = true;
        let pflag = new THREE.Mesh(flagClothGeo, flagClothMat);
        pflag.position.set(0.75, 5.5, 0); 
        pflag.castShadow = true;
        group.add(pole);
        group.add(pflag);
        
        group.position.set(x, y, z);
        scene.add(group);
        return group;
    }

    function createTargetObject(x, y, z) {
        let group = new THREE.Group();
        
        let ringGeo1 = new THREE.RingGeometry(0.5, 2.0, 32);
        let ringMat1 = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
        let ring1 = new THREE.Mesh(ringGeo1, ringMat1);
        ring1.rotation.x = -Math.PI / 2;
        ring1.position.set(0, 0.05, 0);
        group.add(ring1);
        
        let ringGeo2 = new THREE.RingGeometry(2.0, 4.0, 32);
        let ringMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        let ring2 = new THREE.Mesh(ringGeo2, ringMat2);
        ring2.rotation.x = -Math.PI / 2;
        ring2.position.set(0, 0.04, 0);
        group.add(ring2);

        let ringGeo3 = new THREE.RingGeometry(4.0, 6.0, 32);
        let ringMat3 = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
        let ring3 = new THREE.Mesh(ringGeo3, ringMat3);
        ring3.rotation.x = -Math.PI / 2;
        ring3.position.set(0, 0.03, 0);
        group.add(ring3);
        
        group.position.set(x, y, z);
        scene.add(group);
        return group;
    }

    window.rangeLinesGroup = new THREE.Group();
    
    window.drawRangeLines = function() {
        let hole = courseHoles[currentHoleIndex];
        if(!hole.tees.yellow || !hole.flag) {
            alert("Placera Yellow Tee och Siktpunkt/Flagga först för att rita linjer!");
            return;
        }
        hole.rangeLinesEnabled = true;
        renderRangeLines();
        saveLevel();
    };

    window.renderRangeLines = function() {
        scene.remove(window.rangeLinesGroup);
        window.rangeLinesGroup = new THREE.Group();
        scene.add(window.rangeLinesGroup);
        
        for(let h=0; h<courseHoles.length; h++) {
            let hole = courseHoles[h];
            if(hole.rangeLinesEnabled && hole.tees.yellow && hole.flag) {
                let tx = hole.tees.yellow.x;
                let tz = hole.tees.yellow.z;
                let fx = hole.flag.x;
                let fz = hole.flag.z;
                
                let dx = fx - tx;
                let dz = fz - tz;
                let totalDist = Math.hypot(dx, dz);
                let angle = Math.atan2(dz, dx);
                
                let stepMeters = window.useMeters ? 50 : 50 / 1.09361; // 50 yards in meters
                
                for(let dist = stepMeters; dist < totalDist; dist += stepMeters) {
                    let lx = tx + Math.cos(angle) * dist;
                    let lz = tz + Math.sin(angle) * dist;
                    
                    let px = Math.floor(lx + TERRAIN_SIZE/2);
                    let pz = Math.floor(lz + TERRAIN_SIZE/2);
                    if(px >= 0 && px < TERRAIN_SEGS && pz >= 0 && pz < TERRAIN_SEGS) {
                        let idx = pz * (TERRAIN_SEGS + 1) + px;
                        let height = planeGeo.attributes.position.array[idx * 3 + 1];
                        
                        let lineGeo = new THREE.PlaneGeometry(10, 0.5); 
                        let lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
                        let lineMesh = new THREE.Mesh(lineGeo, lineMat);
                        
                        lineMesh.position.set(lx, height + 0.1, lz);
                        lineMesh.rotation.y = -angle + Math.PI/2;
                        lineMesh.rotation.x = -Math.PI / 2;
                        window.rangeLinesGroup.add(lineMesh);
                        
                        // Add distance text or simple marker on the side
                        let sideX = lx + Math.cos(angle + Math.PI/2) * 6;
                        let sideZ = lz + Math.sin(angle + Math.PI/2) * 6;
                        let sHeight = height;
                        let spx = Math.floor(sideX + TERRAIN_SIZE/2);
                        let spz = Math.floor(sideZ + TERRAIN_SIZE/2);
                        if(spx >= 0 && spx < TERRAIN_SEGS && spz >= 0 && spz < TERRAIN_SEGS) {
                            sHeight = planeGeo.attributes.position.array[(spz * (TERRAIN_SEGS + 1) + spx) * 3 + 1];
                        }
                        
                        let signGeo = new THREE.BoxGeometry(1, 0.1, 1);
                        let signMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                        let signMesh = new THREE.Mesh(signGeo, signMat);
                        signMesh.position.set(sideX, sHeight + 0.1, sideZ);
                        signMesh.rotation.y = -angle + Math.PI/2;
                        window.rangeLinesGroup.add(signMesh);
                    }
                }
            }
        }
    };

    window.changeHole = function(dir) {
        currentHoleIndex += dir;
        if(currentHoleIndex < 0) currentHoleIndex = 17;
        if(currentHoleIndex > 17) currentHoleIndex = 0;
        document.getElementById('hole-ui-num').innerText = "Hole " + (currentHoleIndex + 1);
        document.getElementById('hole-ui-par').innerText = "Par " + courseHoles[currentHoleIndex].par;
    };
    
    window.changeHolePar = function(dir) {
        let p = courseHoles[currentHoleIndex].par + dir;
        if(p < 3) p = 3; if(p > 6) p = 6;
        courseHoles[currentHoleIndex].par = p;
        document.getElementById('hole-ui-par').innerText = "Par " + p;
    };
    
    window.setHoleItem = function(action) {
        currentHoleAction = action;
        var btns = document.getElementsByClassName('hole-item-btn');
        for(let b of btns) { 
            b.style.background = '#1e293b'; 
            b.classList.remove('active');
            if(b.id === 'btn-set-tee-red') b.style.color = '#ef4444';
            else if(b.id === 'btn-set-tee-yellow') b.style.color = '#facc15';
            else if(b.id === 'btn-set-tee-white') b.style.color = '#fff';
            else if(b.id === 'btn-set-tee-black') b.style.color = '#94a3b8';
            else b.style.color = '#94a3b8'; 
        }
        
        let activeBtn;
        if(action === 'TEE_RED') { activeBtn = document.getElementById('btn-set-tee-red'); activeBtn.style.background = '#ef4444'; activeBtn.style.color = '#000'; }
        else if(action === 'TEE_YELLOW') { activeBtn = document.getElementById('btn-set-tee-yellow'); activeBtn.style.background = '#facc15'; activeBtn.style.color = '#000'; }
        else if(action === 'TEE_WHITE') { activeBtn = document.getElementById('btn-set-tee-white'); activeBtn.style.background = '#fff'; activeBtn.style.color = '#000'; }
        else if(action === 'TEE_BLACK') { activeBtn = document.getElementById('btn-set-tee-black'); activeBtn.style.background = '#000'; activeBtn.style.color = '#fff'; }
        else if(action === 'TARGET') { activeBtn = document.getElementById('btn-set-target'); activeBtn.style.background = '#fbbf24'; activeBtn.style.color = '#000'; }
        else { activeBtn = document.getElementById('btn-set-flag'); activeBtn.style.background = '#38bdf8'; activeBtn.style.color = '#0f172a'; }
        
        if(activeBtn) activeBtn.classList.add('active');
    };
    
    window.showScorecard = function() {
        let tbody = document.getElementById('scorecard-tbody');
        tbody.innerHTML = "";
        
        let outPar = 0;
        let outLen = 0;
        let inPar = 0;
        let inLen = 0;
        
        let cHtml = "<tr style='border-bottom:1px solid #334155;'><td style='color:#94a3b8; font-weight:normal; padding:10px;'>PAR</td>";
        let cBlack = "<tr><td style='color:#fff; background:#111; padding:5px; border-right:1px solid #334155;'>BLACK</td>";
        let cWhite = "<tr><td style='color:#0f172a; background:#e2e8f0; padding:5px; border-right:1px solid #334155;'>WHITE</td>";
        let cYellow = "<tr><td style='color:#0f172a; background:#facc15; padding:5px; border-right:1px solid #334155;'>YELLOW</td>";
        let cRed = "<tr><td style='color:#fff; background:#ef4444; padding:5px; border-right:1px solid #334155;'>RED</td>";
        
        let sumBlack=0, sumWhite=0, sumYellow=0, sumRed=0;
        
        for(let i=0; i<9; i++) {
            let h = courseHoles[i];
            outPar += h.par;
            cHtml += "<td style='padding:10px; color:#fff; border-right:1px solid #334155;'>" + h.par + "</td>";
            
            let blk='-', wht='-', yel='-', red='-';
            if(h.flag) {
                if(h.tees.black) { blk = Math.round(Math.hypot(h.flag.x-h.tees.black.x, h.flag.z-h.tees.black.z)); sumBlack+=blk; }
                if(h.tees.white) { wht = Math.round(Math.hypot(h.flag.x-h.tees.white.x, h.flag.z-h.tees.white.z)); sumWhite+=wht; }
                if(h.tees.yellow) { yel = Math.round(Math.hypot(h.flag.x-h.tees.yellow.x, h.flag.z-h.tees.yellow.z)); sumYellow+=yel; }
                if(h.tees.red) { red = Math.round(Math.hypot(h.flag.x-h.tees.red.x, h.flag.z-h.tees.red.z)); sumRed+=red; }
            }
            cBlack += "<td style='border-right:1px solid #334155;'>"+blk+"</td>"; 
            cWhite += "<td style='border-right:1px solid #334155;'>"+wht+"</td>"; 
            cYellow += "<td style='border-right:1px solid #334155;'>"+yel+"</td>"; 
            cRed += "<td style='border-right:1px solid #334155;'>"+red+"</td>";
        }
        
        cHtml += "<td style='padding:10px; color:#fbbf24;'>" + outPar + "</td></tr>";
        cBlack += "<td style='color:#fbbf24;'>"+sumBlack+"</td></tr>";
        cWhite += "<td style='color:#fbbf24;'>"+sumWhite+"</td></tr>";
        cYellow += "<td style='color:#fbbf24;'>"+sumYellow+"</td></tr>";
        cRed += "<td style='color:#fbbf24;'>"+sumRed+"</td></tr>";
        
        tbody.innerHTML += cHtml + cBlack + cWhite + cYellow + cRed;
        // Mid-round scorecard view: show close, hide end-round buttons
        let endBtns = document.getElementById('scorecard-endround-btns');
        if (endBtns) endBtns.style.display = 'none';
        let closeBtn = document.getElementById('scorecard-footer');
        if (closeBtn) closeBtn.style.display = 'flex';
        document.getElementById('scorecard-modal').style.display = 'flex';
    };
    
    window.hasUnsavedChanges = false;
    window.addEventListener('beforeunload', function (e) {
        if (appMode === 'BUILD' && window.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    function updateMemoryBudget() {
        if (appMode !== 'BUILD') return;
        
        let dumpTargets = targets.map(t => ({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor }));
        let dumpHoles = courseHoles.map(h => ({ par: h.par, tees: h.tees, flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z, isTarget: h.flag.isTarget} : null, rangeLinesEnabled: h.rangeLinesEnabled }));
        let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({type: t.type, x: t.x, z: t.z, s: t.scale, r: t.rot, c: t.color, tc: t.trunkColor})) : [];
        let hm = Array.from(planeGeo.attributes.position.array).filter((v, i) => i % 3 === 2); 
        let w_hm = typeof waterGeo !== 'undefined' ? Array.from(waterGeo.attributes.position.array).filter((v, i) => i % 3 === 2) : [];
        
        let baseStr = JSON.stringify({ targets: dumpTargets, holes: dumpHoles, trees: dumpTrees, terrain_heightmap: { ground: hm, water: w_hm } });
        let byteSize = new Blob([baseStr]).size;
        let totalMB = (byteSize / (1024 * 1024)) + 2.5; // +2.5MB uppskattning för texturer (biome map + water mask)
        
        let memCur = document.getElementById('mem-current');
        let memBar = document.getElementById('mem-bar');
        
        if(memCur) memCur.innerText = totalMB.toFixed(2);
        if(memBar) {
            let pct = (totalMB / 20.0) * 100;
            memBar.style.width = Math.min(100, pct) + "%";
            if (pct > 90) { memBar.style.background = "#ef4444"; memCur.style.color = "#ef4444"; }
            else if (pct > 75) { memBar.style.background = "#fbbf24"; memCur.style.color = "#fbbf24"; }
            else { memBar.style.background = "#4ade80"; memCur.style.color = "#4ade80"; }
        }
    }
    setInterval(updateMemoryBudget, 2000);

    function saveLevel() {
        let dumpTargets = targets.map(t => ({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor }));
        let dumpHoles = courseHoles.map(h => ({
            par: h.par, 
            tees: h.tees,
            flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z} : null
        }));
        
        localStorage.setItem('arcade_custom_level', JSON.stringify({ targets: dumpTargets, holes: dumpHoles }));
        if (appMode === 'BUILD') window.hasUnsavedChanges = true;
    }
    
    window.publishCourse = async function(options = { isDraft: false, overwrite: false }) {
        let name = document.getElementById('course-name-input').value;
        let author = document.getElementById('author-name-input').value;
        let stat = document.getElementById('publish-status');
        stat.innerText = "Processing...";

        function showError(msg) {
            stat.style.color = '#ef4444';
            stat.innerText = "❌ " + msg;
        }

        if(!name && !options.isDraft) { showError("Please enter a course name!"); return; }
        
        if (!options.isDraft) {
            let h1HasTee = courseHoles[0].tees && (courseHoles[0].tees.red || courseHoles[0].tees.yellow || courseHoles[0].tees.white || courseHoles[0].tees.black);
            if(!h1HasTee || !courseHoles[0].flag) {
                showError("Validation Error: You must build at least Hole 1 with a Tee and a Flag.");
                return;
            }
        }
        
        let dumpTargets = targets.map(t => ({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor }));
        let dumpHoles = courseHoles.map(h => ({
            par: h.par, tees: h.tees, flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z} : null
        }));
        let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({type: t.type, x: t.x, z: t.z, s: t.scale, r: t.rot, c: t.color, tc: t.trunkColor})) : [];
        
        let hm = Array.from(planeGeo.attributes.position.array).filter((v, i) => i % 3 === 2); 
        let w_hm = typeof waterGeo !== 'undefined' ? Array.from(waterGeo.attributes.position.array).filter((v, i) => i % 3 === 2) : [];
        let biome = pCtx.canvas.toDataURL('image/jpeg', 0.8);
        let w_mask = (typeof wCtx !== 'undefined') ? wCtx.canvas.toDataURL('image/jpeg', 0.8) : null;

        try {
            let payload = {
                name: name || "Draft",
                author: author || "Builder",
                holes: dumpHoles,
                targets: dumpTargets,
                trees: dumpTrees,
                terrain_heightmap: JSON.stringify({ground: hm, water: w_hm}),
                terrain_biomemap: biome,
                terrain_watermask: w_mask,
                is_draft: options.isDraft,
                theme_data: { biomeId: window.ACTIVE_BIOME, config: window.CURRENT_BIOME_CONFIG }
            };
            
            if (options.overwrite && currentEditCode) {
                payload.edit_code = currentEditCode;
            }
            
            let res = await fetch('/api/courses', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            let data = await res.json();
            if(data.success) {
                currentEditCode = data.share_code;
                window.hasUnsavedChanges = false;
                
                if (options.isDraft) {
                    let drafts = JSON.parse(localStorage.getItem('golf_os_my_drafts') || "[]");
                    let draftObj = drafts.find(d => d.code === data.share_code);
                    if (!draftObj) {
                        drafts.push({ code: data.share_code, name: payload.name, date: new Date().toISOString() });
                    } else {
                        draftObj.name = payload.name;
                        draftObj.date = new Date().toISOString();
                    }
                    localStorage.setItem('golf_os_my_drafts', JSON.stringify(drafts));
                }
                
                let href = window.location.origin + window.location.pathname + (options.isDraft ? "?edit=" : "?course=") + data.share_code;
                
                window.history.pushState({}, '', href);
                
                stat.style.color = '#4ade80';
                stat.innerHTML = "Saved! Your link:<br><a href='"+href+"' style='color:#38bdf8; word-break: break-all;'>" + href + "</a>";
            } else {
                showError("Failed: " + data.error);
            }
        } catch(e) {
            showError("Error connecting to server.");
        }
    };

    // ============================================================
    // COURSE SHARING VIA URL (Offline — no server needed)
    // ============================================================
    window.exportCourseURL = function() {
        let statusEl = document.getElementById('share-link-status');
        try {
            // Gather course data (same format as saveLevel)
            let dumpTargets = targets.map(t => ({x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor}));
            let dumpHoles = courseHoles.map(h => ({
                par: h.par, tees: h.tees, flag: h.flag ? {x:h.flag.x, y:h.flag.y, z:h.flag.z} : null
            }));
            let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({t:t.type, x:Math.round(t.x*10)/10, z:Math.round(t.z*10)/10, s:Math.round(t.scale*100)/100, r:Math.round((t.rot||0)*100)/100, c:t.color})) : [];

            // Compact terrain heightmap (only Y values, rounded to 2 decimals)
            let heights = [];
            let pos = planeGeo.attributes.position.array;
            for (let i = 2; i < pos.length; i += 3) {
                heights.push(Math.round(pos[i] * 100) / 100);
            }

            // Water heightmap
            let waterHeights = [];
            if (typeof waterGeo !== 'undefined' && waterGeo) {
                let wPos = waterGeo.attributes.position.array;
                for (let i = 2; i < wPos.length; i += 3) {
                    waterHeights.push(Math.round(wPos[i] * 100) / 100);
                }
            }

            let payload = {
                v: 1, // Version for future compat
                h: dumpHoles,
                t: dumpTargets,
                r: dumpTrees,
                m: heights,
                w: waterHeights.length > 0 ? waterHeights : undefined
            };

            let json = JSON.stringify(payload);
            
            // Compress with pako
            if (typeof pako === 'undefined') {
                if (statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = '❌ Compression library not loaded'; }
                return;
            }
            let compressed = pako.deflate(json);
            
            // Convert to base64url
            let binary = '';
            for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
            let base64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            
            let url = window.location.origin + window.location.pathname + '#share=' + base64;
            
            // Copy to clipboard
            navigator.clipboard.writeText(url).then(() => {
                if (statusEl) {
                    statusEl.style.color = '#4ade80';
                    statusEl.innerHTML = '✅ Link copied! (' + Math.round(base64.length/1024) + 'KB)<br><span style="color:#64748b;font-size:10px;word-break:break-all;">' + url.substring(0, 80) + '...</span>';
                }
            }).catch(() => {
                // Fallback: show URL for manual copy
                if (statusEl) {
                    statusEl.style.color = '#fbbf24';
                    statusEl.innerHTML = '📋 Copy this URL:<br><input type="text" value="' + url + '" style="width:100%;padding:4px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:4px;font-size:10px;" onclick="this.select();" readonly>';
                }
            });

            console.log('Share URL generated: ' + Math.round(json.length/1024) + 'KB JSON → ' + Math.round(base64.length/1024) + 'KB compressed');
            
        } catch(e) {
            console.error('Export error:', e);
            if (statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = '❌ Export failed: ' + e.message; }
        }
    };

    function importCourseHash() {
        try {
            let hash = window.location.hash;
            if (!hash || !hash.startsWith('#share=')) return null;
            
            let base64 = hash.substring(7); // Remove '#share='
            // Restore base64 from base64url
            base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            
            let binary = atob(base64);
            let bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            
            let json = pako.inflate(bytes, { to: 'string' });
            let data = JSON.parse(json);
            
            if (data.v !== 1) { console.warn('Unknown share format version:', data.v); }
            
            // Convert compact format back to loadLevel format
            let result = {
                targets: data.t || [],
                holes: data.h || [],
                trees: (data.r || []).map(t => ({type: t.t, x: t.x, z: t.z, s: t.s, r: t.r}))
            };
            
            // Restore terrain heightmap
            if (data.m && data.m.length > 0) {
                let pos = planeGeo.attributes.position.array;
                let idx = 0;
                for (let i = 2; i < pos.length && idx < data.m.length; i += 3) {
                    pos[i] = data.m[idx++];
                }
                planeGeo.attributes.position.needsUpdate = true;
                planeGeo.computeVertexNormals();
            }

            // Restore water heightmap
            if (data.w && data.w.length > 0 && typeof waterGeo !== 'undefined' && waterGeo) {
                let wPos = waterGeo.attributes.position.array;
                let wIdx = 0;
                for (let i = 2; i < wPos.length && wIdx < data.w.length; i += 3) {
                    wPos[i] = data.w[wIdx++];
                    window.waterBaseZ[(i-2)/3] = wPos[i];
                }
                waterGeo.attributes.position.needsUpdate = true;
                // Rebuild water alpha mask from loaded heightmap
                rebuildWaterMask();
            }
            
            console.log('Imported shared course: ' + (result.trees ? result.trees.length : 0) + ' trees, ' + (result.holes ? result.holes.length : 0) + ' holes');
            return result;
            
        } catch(e) {
            console.error('Import error:', e);
            return null;
        }
    }

    async function loadLevel() {
        let params = new URLSearchParams(window.location.search);
        let courseCode = params.get('course');
        let editCode = params.get('edit');
        let autoRun = params.get('autorun');
        
        let savedStr = null;
        let isCloud = false;
        
        if (autoRun === 'new_build') {
            if (typeof executeClear === 'function') executeClear();
            else localStorage.removeItem('arcade_custom_level');
            setMode('BUILD');
            return;
        }

        // Check for offline shared course in URL hash
        if (window.location.hash && window.location.hash.startsWith('#share=')) {
            let imported = importCourseHash();
            if (imported) {
                savedStr = imported;
                isCloud = false;
                console.log('Loaded shared course from URL hash!');
            }
        }

        let targetCode = courseCode || editCode;

        if (targetCode) {
            try {
                let res = await fetch('/api/courses/' + targetCode);
                let data = await res.json();
                if(data.share_code) {
                    savedStr = data;
                    isCloud = true;
                    if (editCode) {
                        currentEditCode = data.share_code; 
                        if(document.getElementById('course-name-input')) document.getElementById('course-name-input').value = data.name;
                        if(document.getElementById('author-name-input')) document.getElementById('author-name-input').value = data.author;
                        if (document.getElementById('btn-save-draft')) document.getElementById('btn-save-draft').style.display = 'block';
                    }
                    if(typeof savedStr.holes === 'string') savedStr.holes = JSON.parse(savedStr.holes);
                    if(typeof savedStr.targets === 'string') savedStr.targets = JSON.parse(savedStr.targets);
                    if(typeof savedStr.trees === 'string') savedStr.trees = JSON.parse(savedStr.trees);
                    if(typeof savedStr.theme_data === 'string') savedStr.theme_data = JSON.parse(savedStr.theme_data);
                } else {
                    console.error("Course not found!");
                }
            } catch(e) { console.error("Cloud fetch fail:", e); }
        }
        
        if (!isCloud) {
            let ls = localStorage.getItem('arcade_custom_level');
            if(ls) savedStr = JSON.parse(ls);
        }

        if(savedStr) {
            targets.forEach(t => scene.remove(t.mesh));
            targets.length = 0;
            
            for(let i=0; i<18; i++) {
                let h = courseHoles[i];
                for(let key in h.tees) {
                    if(h.teeMeshes[key]) { scene.remove(h.teeMeshes[key]); h.teeMeshes[key]=null; }
                }
                if(h.flagMesh) { scene.remove(h.flagMesh); h.flagMesh=null; }
                h.tees={red:null,yellow:null,white:null,black:null}; h.flag=null;
            }
            
            try {
                var arr = savedStr;
                
                // Ladda tema och färger
                if (arr.theme_data && typeof arr.theme_data === 'object' && Object.keys(arr.theme_data).length > 0) {
                    let td = arr.theme_data;
                    if (td.config) {
                        window.CURRENT_BIOME_CONFIG = td.config;
                        if(td.biomeId) {
                            window.ACTIVE_BIOME = td.biomeId;
                            let select = document.getElementById('biome-select');
                            if(select) select.value = td.biomeId;
                        }
                        
                        // Uppdatera sky och vatten
                        if (typeof scene !== 'undefined' && scene) {
                            scene.background = new THREE.Color(window.CURRENT_BIOME_CONFIG.skyColor);
                            if (scene.fog) scene.fog.color.setHex(parseInt(window.CURRENT_BIOME_CONFIG.skyColor.replace('#','0x')));
                        }
                        if (typeof waterMaterial !== 'undefined' && waterMaterial) {
                            waterMaterial.color.setHex(parseInt(window.CURRENT_BIOME_CONFIG.waterColor.replace('#','0x')));
                        }
                        
                        // Uppdatera material palettens UI
                        let keys = ['ob', 'bunker', 'waste', 'tee', 'green', 'foregreen', 'fairway', 'semi', 'rough', 'fescue'];
                        keys.forEach(k => {
                            let el = document.getElementById('pal-' + k);
                            if(el) {
                                el.style.background = window.CURRENT_BIOME_CONFIG[k + 'Color'];
                            }
                        });
                        
                        // Toggle gear icons
                        let gearIcons = document.querySelectorAll('.color-edit-icon');
                        let isCustom = (window.ACTIVE_BIOME === 'CUSTOM');
                        gearIcons.forEach(icon => {
                            icon.style.display = isCustom ? 'inline-block' : 'none';
                        });
                        
                        if(isCustom) {
                            window.CLOUD_BIOMES['CUSTOM'] = Object.assign({}, window.CURRENT_BIOME_CONFIG);
                        }
                    }
                }

                if (arr.targets && Array.isArray(arr.targets)) {
                    arr.targets.forEach(function(a) {
                        if(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)) {
                            createTargetAbsolute(a.x, a.y, a.z, a.c);
                        }
                    });
                }
                
                if (arr.holes && Array.isArray(arr.holes)) {
                    for(let i=0; i<18 && i<arr.holes.length; i++) {
                        let hSync = arr.holes[i];
                        let h = courseHoles[i];
                        h.par = hSync.par || 4;
                        if(hSync.tee) { h.tees.yellow = {x: hSync.tee.x, y: hSync.tee.y, z: hSync.tee.z}; }
                        if(hSync.tees) {
                            for(let tType in hSync.tees) {
                                if(hSync.tees[tType]) h.tees[tType] = hSync.tees[tType];
                            }
                        }
                        if(h.tees.red) { h.teeMeshes.red = createTeeObject(h.tees.red.x, h.tees.red.y, h.tees.red.z, 0xef4444); if(h.tees.red.rot) h.teeMeshes.red.rotation.y = h.tees.red.rot; }
                        if(h.tees.yellow) { h.teeMeshes.yellow = createTeeObject(h.tees.yellow.x, h.tees.yellow.y, h.tees.yellow.z, 0xfacc15); if(h.tees.yellow.rot) h.teeMeshes.yellow.rotation.y = h.tees.yellow.rot; }
                        if(h.tees.white) { h.teeMeshes.white = createTeeObject(h.tees.white.x, h.tees.white.y, h.tees.white.z, 0xffffff); if(h.tees.white.rot) h.teeMeshes.white.rotation.y = h.tees.white.rot; }
                        if(h.tees.black) { h.teeMeshes.black = createTeeObject(h.tees.black.x, h.tees.black.y, h.tees.black.z, 0x111111); if(h.tees.black.rot) h.teeMeshes.black.rotation.y = h.tees.black.rot; }
                        
                        if(hSync.flag) {
                            h.flag = hSync.flag;
                            if (h.flag.isTarget) h.flagMesh = createTargetObject(h.flag.x, h.flag.y, h.flag.z);
                            else h.flagMesh = createFlagObject(h.flag.x, h.flag.y, h.flag.z);
                        }
                        if(hSync.rangeLinesEnabled) h.rangeLinesEnabled = true;
                    }
                    if(document.getElementById('hole-ui-par')) { document.getElementById('hole-ui-par').innerText = "Par " + courseHoles[currentHoleIndex].par; }
                }

                if (isCloud && arr.terrain_heightmap) {
                    let mapData = JSON.parse(arr.terrain_heightmap);
                    let pos = planeGeo.attributes.position;
                    let wPos = typeof waterGeo !== 'undefined' ? waterGeo.attributes.position : null;
                    
                    let groundArr = Array.isArray(mapData) ? mapData : mapData.ground;
                    let waterArr = Array.isArray(mapData) ? null : mapData.water;

                    if(groundArr) {
                        for(let i=0; i<groundArr.length; i++) pos.setZ(i, groundArr[i]);
                    }
                    if(waterArr && wPos) {
                        for(let i=0; i<waterArr.length; i++) {
                            wPos.setZ(i, waterArr[i]);
                            window.waterBaseZ[i] = waterArr[i];
                        }
                    }

                    pos.needsUpdate = true;
                    if(wPos) wPos.needsUpdate = true;
                    planeGeo.computeVertexNormals();

                    // Rebuild water alpha mask from loaded heightmap
                    if (waterArr && waterArr.some(v => v > -90)) {
                        rebuildWaterMask();
                    }

                    if(arr.terrain_biomemap) {
                        let img = new Image();
                        img.onload = () => {
                            pCtx.drawImage(img, 0, 0);
                            if(typeof mapTex !== 'undefined') mapTex.needsUpdate = true;
                        };
                        img.src = arr.terrain_biomemap;
                    }
                    
                    if(arr.terrain_watermask) {
                        let wImg = new Image();
                        wImg.onload = () => {
                            if (typeof wCtx !== 'undefined') wCtx.drawImage(wImg, 0, 0);
                            if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
                        };
                        wImg.src = arr.terrain_watermask;
                    }

                    if(arr.trees && Array.isArray(arr.trees)) {
                        arr.trees.forEach(t => createTree(t.type || t.t, t.x, t.z, t.s, t.r, t.c, t.tc));
                    }
                }
            } catch(e) {
                console.error("Parse error", e);
            }
        }
        if(typeof window.renderRangeLines === 'function') window.renderRangeLines();
        
        if (autoRun === 'setup') {
            setMode('PLAY');
            if (typeof startRound === 'function') setTimeout(startRound, 500);
        } else if (autoRun === 'edit_build' || autoRun === 'build') {
            setMode('BUILD');
        } else if (courseCode) {
            setMode('PLAY');
            if (typeof startRound === 'function') setTimeout(startRound, 500);
        } else if (!autoRun && !courseCode && !editCode) {
            setMode('TEST');
        }
        
        setTimeout(() => {
            if (typeof pCtx !== 'undefined') window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
            let loader = document.getElementById('global-loader');
            if (loader) loader.classList.add('hidden');
        }, 800);
    }
    
    let isFlying = false;
    let flightData = null;
    let flightTick = 0;
    
    // === UNIFIED CAMERA SYSTEM ===
    const CAM = {
        AIM_HEIGHT: 2.0,           // Normal aim: höjd ovan boll
        AIM_DISTANCE: 5.0,         // Normal aim: meter bakom boll
        PUTT_HEIGHT: 0.4,          // Putt aim: låg för att läsa green
        PUTT_DISTANCE: 2.5,        // Putt aim: tight bakom boll
        PUTT_THRESHOLD: 25,        // Meter till flagga för auto-putt-kamera
        FLIGHT_LERP: 0.08,         // Mjukhet vid följning i luft
        FLIGHT_HEIGHT_MIN: 3.0,    // Min kamerahöjd under flight
        FLIGHT_BEHIND: 12.0,       // Meter bakom boll under flight
        LANDING_LERP: 0.06,        // Mjukhet vid landning
        LANDING_HEIGHT: 3.0,       // Kamerahöjd vid landning
        LANDING_BEHIND: 10.0,      // Meter bakom landningspunkt
        AIM_LERP: 0.08,            // Mjukhet vid aim-transition
        SETTLE_DURATION: 45,       // Frames att vänta innan aim-transition
    };
    let gameCamPhase = 'IDLE_AIM';  // TEE_AIM | PUTT_AIM | FLIGHT_FOLLOW | LANDING_SETTLE | IDLE_AIM | HOLE_FLYOVER
    let landingSettleTimer = 0;
    let flyoverProgress = 0;
    let flyoverStart = new THREE.Vector3();
    let flyoverEnd = new THREE.Vector3();
    let flyoverDuration = 120; // frames (~2s at 60fps)
    
    let playState = 'IDLE'; 
    let playingHoleIndex = 0;
    
    // BUG-07 FIX: Initialize wind variables at boot to prevent NaN
    window.currentWindMph = 0;
    window.currentWindDir = 0;
    window.currentWindVec = [0, 0, 0];
    
    window.playerScores = Array(18).fill(null);
    window.matchSettings = {
        tournamentMode: false,
        gimmeDist: 10,
        autoPutt: 'TOUR_PRO',
        mulligans: true,
        autoConcede: 99,
        windStrength: 0,
        greenStimp: 10,
        greenFirmness: 'NORMAL',
        altitude: 0
    };

    function updateWindEngine() {
        if (playState !== 'ROUND_IDLE' && playState !== 'ROUND_FLYING') return;
        
        let matchWindLevel = window.matchSettings ? window.matchSettings.windStrength : 0;
        let windMph = 0;
        if (matchWindLevel === 1) windMph = 5 + Math.random() * 5; 
        else if (matchWindLevel === 2) windMph = 10 + Math.random() * 8; 
        else if (matchWindLevel === 3) windMph = 18 + Math.random() * 7; 
        else if (matchWindLevel === 4) windMph = 25 + Math.random() * 10; 
        else if (matchWindLevel === 0) windMph = Math.random() * 2; 
        
        window.currentWindMph += (windMph - window.currentWindMph) * 0.1;
        
        let windMs = window.currentWindMph * 0.44704;
        
        let holeWindDir = (playingHoleIndex * 137.5) % 360; 
        
        if (!window._targetGust) window._targetGust = 0;
        if (Math.random() < 0.2) window._targetGust = (Math.random() - 0.5) * 30; 
        window.currentWindDir += (window._targetGust - (window.currentWindDir - holeWindDir)) * 0.05;
        
        let finalDirRad = window.currentWindDir * Math.PI / 180;
        
        window.currentWindVec = [Math.sin(finalDirRad) * windMs, -Math.cos(finalDirRad) * windMs, 0];
        
        let wSpd = document.getElementById('minimap-wind-spd');
        let wArr = document.getElementById('minimap-wind-arr');
        if(wSpd && wArr && window.aimTarget && window.ballMesh && window.ballMesh.visible) {
            wSpd.innerText = Math.round(window.currentWindMph) + " MPH";
            
            let dX = window.aimTarget.x - window.ballMesh.position.x;
            let dZ = window.aimTarget.z - window.ballMesh.position.z;
            let aimAngleRad = Math.atan2(dX, -dZ); 
            
            let relWindRad = aimAngleRad - finalDirRad;
            let relWindDeg = relWindRad * 180 / Math.PI;
            
            wArr.style.transform = `rotate(${relWindDeg}deg)`;
        }
    }
    setInterval(updateWindEngine, 500);

    window.toggleTournamentMode = function(isActive) {
        window.matchSettings.tournamentMode = isActive;
        let gimmeInp = document.getElementById('set-gimme-dist');
        let mulliganInp = document.getElementById('set-mulligans');
        if(isActive) {
            gimmeInp.max = 12;
            if(parseInt(gimmeInp.value) > 12) {
                gimmeInp.value = 12;
                document.getElementById('gimme-val').innerText = '12 ft (Max)';
            }
            mulliganInp.checked = false;
            mulliganInp.disabled = true;
            document.getElementById('set-tournament-mode').parentElement.style.background = '#ef4444';
            document.getElementById('set-tournament-mode').parentElement.style.color = '#fff';
        } else {
            gimmeInp.max = 20;
            mulliganInp.disabled = false;
            document.getElementById('set-tournament-mode').parentElement.style.background = 'transparent';
            document.getElementById('set-tournament-mode').parentElement.style.color = '#ef4444';
        }
    };

    window.setupPlayers = [{ name: 'Player 1', tee: 'yellow' }];
    
    window.renderPlayerRoster = function() {
        const list = document.getElementById('roster-list');
        if (!list) return;
        list.innerHTML = '';
        
        let firstPlayableHole = 0;
        for (let i = 0; i < 18; i++) {
            let hole = courseHoles[i];
            if (hole && hole.tees && (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black) && hole.flag) {
                firstPlayableHole = i;
                break;
            }
        }
        const hole1 = courseHoles[firstPlayableHole] || {};
        const tees = hole1.tees || {};
        
        const tOpts = [];
        if(tees.red) tOpts.push('<option value="red">🔴 Red</option>');
        if(tees.yellow) tOpts.push('<option value="yellow">🟡 Yellow</option>');
        if(tees.white) tOpts.push('<option value="white">⚪ White</option>');
        if(tees.black) tOpts.push('<option value="black">⚫ Black</option>');
        if(tOpts.length === 0) tOpts.push('<option value="yellow">🟡 Yellow</option>');
        
        window.setupPlayers.forEach((p, idx) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; gap:10px; align-items:center; background:#0f172a; padding:10px; border-radius:8px; border:1px solid #475569;';
            
            row.innerHTML = `
                <input type="text" value="${p.name}" onchange="window.setupPlayers[${idx}].name=this.value" placeholder="Player Name" style="flex:1; padding:8px; background:#1e293b; color:#fff; border:1px solid #475569; border-radius:6px; font-weight:bold;">
                <select onchange="window.setupPlayers[${idx}].tee=this.value" style="padding:8px; background:#1e293b; color:#fff; border:1px solid #475569; border-radius:6px; font-weight:bold;">
                    ${tOpts.join('')}
                </select>
                <button onclick="window.removePlayerFromRoster(${idx})" style="background:transparent; color:#ef4444; border:none; font-weight:bold; cursor:pointer; font-size:16px;" title="Remove Player">✖</button>
            `;
            const sel = row.querySelector('select');
            if (sel) sel.value = p.tee;
            list.appendChild(row);
        });
    };
    
    window.addPlayerToRoster = function() {
        if(window.setupPlayers.length >= 4) {
            alert("Maximum 4 players supported.");
            return;
        }
        let tee = window.setupPlayers.length > 0 ? window.setupPlayers[0].tee : 'yellow';
        window.setupPlayers.push({ name: `Player ${window.setupPlayers.length + 1}`, tee: tee });
        window.renderPlayerRoster();
    };
    
    window.removePlayerFromRoster = function(idx) {
        if(window.setupPlayers.length <= 1) return;
        window.setupPlayers.splice(idx, 1);
        window.renderPlayerRoster();
    };

    window.commitSettingsAndStart = function() {
        if (window.setupPlayers.length === 0) return;
        
        const inputs = document.getElementById('roster-list').querySelectorAll('input[type="text"]');
        inputs.forEach((inp, idx) => {
            if (window.setupPlayers[idx]) window.setupPlayers[idx].name = inp.value;
        });

        window.matchSettings.gimmeDist = parseInt(document.getElementById('set-gimme-dist').value);
        window.matchSettings.autoPutt = document.getElementById('set-autoputt-mode').value;
        window.matchSettings.mulligans = document.getElementById('set-mulligans').checked;
        window.matchSettings.autoConcede = parseInt(document.getElementById('set-concede').value);
        window.matchSettings.windStrength = parseInt(document.getElementById('set-wind').value);
        window.matchSettings.greenStimp = parseFloat(document.getElementById('set-green-stimp').value);
        window.matchSettings.greenFirmness = document.getElementById('set-green-firmness').value;
        window.matchSettings.altitude = parseInt(document.getElementById('set-altitude').value);
        
        window.GREEN_STIMP = window.matchSettings.greenStimp; 
        
        document.getElementById('settings-modal').style.display = 'none';
        actuallyStartRound();
    };

    window.startRound = function() {
        if(appMode !== 'PLAY') return;

        let firstPlayableHole = -1;
        for (let i = 0; i < 18; i++) {
            let hole = courseHoles[i];
            let hasTee = hole && hole.tees && (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black);
            if (hole && hasTee && hole.flag) {
                firstPlayableHole = i;
                break;
            }
        }

        if(firstPlayableHole === -1) {
            alert("Banan saknar spelbara hål! (Kräver Tee och Flagga)");
            return;
        }
        
        let holeStart = courseHoles[firstPlayableHole];
        let firstAvailableTee = holeStart.tees.yellow ? 'yellow' : (holeStart.tees.white ? 'white' : (holeStart.tees.red ? 'red' : 'black'));
        window.setupPlayers.forEach(p => {
            if (!holeStart.tees[p.tee]) p.tee = firstAvailableTee;
        });
        
        window.renderPlayerRoster();
        document.getElementById('settings-modal').style.display = 'flex';
    };

    function getTeeOrder() {
        let players = window.players;
        let pIndices = players.map((p,i) => i);
        if (playingHoleIndex === 0) {
            return pIndices; 
        }
        
        let prevHole = playingHoleIndex - 1;
        
        pIndices.sort((a,b) => {
            let aScore = players[a].scoreVsPar[prevHole] || 0;
            let bScore = players[b].scoreVsPar[prevHole] || 0;
            if (aScore !== bScore) return aScore - bScore; 
            return a - b; 
        });
        return pIndices;
    }
    
    function getNextPlayerIndex() {
        let players = window.players;
        let notHoledOut = players.map((p,i) => i).filter(i => !players[i].holedOut);
        if (notHoledOut.length === 0) return -1; 
        
        let allOnTee = notHoledOut.every(i => players[i].strokes === 0 && players[i].penaltyStrokes === 0);
        if (allOnTee) {
            let teeOrder = getTeeOrder();
            let nextId = teeOrder.find(id => notHoledOut.includes(id) && players[id].strokes === 0);
            if(nextId !== undefined) return nextId;
        }
        
        let hole = courseHoles[playingHoleIndex];
        let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        notHoledOut.sort((a,b) => {
            let pA = players[a]; let pB = players[b];
            let dA = new THREE.Vector3(pA.lie.x, pA.lie.y, pA.lie.z).distanceTo(fv);
            let dB = new THREE.Vector3(pB.lie.x, pB.lie.y, pB.lie.z).distanceTo(fv);
            return dB - dA; 
        });
        return notHoledOut[0];
    }
    
    function teleportToHole(index) {
        let hole = courseHoles[index];
        let anyTee = hole ? (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black) : null;
        if(!hole || !anyTee || !hole.flag) {
            alert("Hole " + (index+1) + " is not fully built!");
            return;
        }
        
        // BUG-06 FIX: Set pinMesh when teleporting to a new hole
        if (hole.flagMesh) {
            window.pinMesh = hole.flagMesh;
        }

        window.players.forEach((p, idx) => {
            p.holedOut = false;
            p.strokes = 0;
            p.penaltyStrokes = 0;
            
            let activeT = hole.tees[p.tee] || hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black;
            let lieY = activeT.y + 0.3;
            if (typeof localGetTerrainAt === 'function') {
                let surf = localGetTerrainAt(activeT.x, -activeT.z);
                if (surf && surf.z !== undefined) lieY = surf.z + 0.0213;
            }
            p.teePosition = { x: activeT.x, y: lieY, z: activeT.z };
            p.lie = { x: activeT.x, y: lieY, z: activeT.z }; 
        });

        let startPlayerIdx = getNextPlayerIndex();
        switchTurnTo(startPlayerIdx);
    }
    
    function switchTurnTo(idx) {
        if(idx === -1) {
            nextHole(); 
            return;
        }
        
        window.activePlayerIndex = idx;
        let p = window.players[idx];
        
        window.ballLocked = false;
        // BUG-P02 FIX: Reset isPuttingMode to prevent state leak between players
        window.isPuttingMode = false;
        playState = 'ROUND_IDLE'; 
        
        window.ballMesh.visible = true;
        window.ballMesh.position.set(p.lie.x, p.lie.y, p.lie.z);
        
        // Uppdatera banner EFTER bollen flyttats!
        updatePlayerBanner();
        
        window.ballMesh.velocity = new THREE.Vector3(0,0,0);
        window.ballMesh.angularVelocity = new THREE.Vector3(0,0,0);
        
        let hole = courseHoles[playingHoleIndex];
        let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        window.aimTarget = fv.clone();
        
        let dir = new THREE.Vector3().subVectors(fv, window.ballMesh.position).normalize();
        
        // BUG-P09 FIX: Detect green lie and use putt-camera if on green
        let lieSurf = localGetTerrainAt(window.ballMesh.position.x, -window.ballMesh.position.z);
        let distToPin = new THREE.Vector3(window.ballMesh.position.x, window.ballMesh.position.y, window.ballMesh.position.z).distanceTo(fv);
        let isOnGreen = lieSurf && (lieSurf.type === 'GREEN' || ((lieSurf.type === 'SEMI-ROUGH' || lieSurf.type === 'FAIRWAY') && distToPin < 5.0));
        
        if (isOnGreen) {
            // Putt-kamera: låg vinkel, nära bollen
            let camDist = 2.5; let camHeight = 0.4;
            camera.position.copy(window.ballMesh.position).add(new THREE.Vector3(-dir.x * camDist, camHeight, -dir.z * camDist)); 
            controls.target.copy(fv);
            
            // Set putting mode for this player
            let mode = window.matchSettings ? window.matchSettings.autoPutt : 'TOUR_PRO';
            if (mode === 'OFF') {
                window.isPuttingMode = true;
            }
            
            // Set putter-appropriate defaults in manual input fields
            if(document.getElementById('in-speed')) document.getElementById('in-speed').value = '6';
            if(document.getElementById('in-la')) document.getElementById('in-la').value = '1.5';
            if(document.getElementById('in-backspin')) document.getElementById('in-backspin').value = '30';
            if(document.getElementById('in-sidespin')) document.getElementById('in-sidespin').value = '0';
        } else {
            let camDist = 5; let camHeight = 3;
            camera.position.copy(window.ballMesh.position).add(new THREE.Vector3(-dir.x * camDist, camHeight, -dir.z * camDist)); 
            controls.target.copy(window.ballMesh.position).add(new THREE.Vector3(dir.x * 20, 0, dir.z * 20)); 
        }
        controls.enabled = true;
        controls.update();

        let trck = document.getElementById('ball-tracker');
        if (trck) trck.style.display = 'none';

        let pop = document.getElementById('score-popup');
        pop.innerText = p.name.toUpperCase() + "'S TURN";
        pop.style.color = "#38bdf8";
        pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
        pop.style.opacity = '1';
        setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 1500);
    }
    
    window.evaluateNextTurn = function() {
        let p = window.players[window.activePlayerIndex];
        let hole = courseHoles[playingHoleIndex];
        let maxConcede = window.matchSettings ? window.matchSettings.autoConcede : 99;
        let maxScore = hole ? (hole.par || 4) + maxConcede : 99;
        
        p.lie = {x: window.ballMesh.position.x, y: window.ballMesh.position.y, z: window.ballMesh.position.z};

        if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();

        if (p.strokes + p.penaltyStrokes >= maxScore && maxConcede !== 99 && !p.holedOut) {
            p.holedOut = true;
            p.strokes = maxScore - p.penaltyStrokes;
            
            let pop = document.getElementById('score-popup');
            pop.innerText = "AUTO CONCEDE (" + maxScore + ")";
            pop.style.color = "#ef4444";
            pop.style.opacity = '1';
            setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 3000);
        }
        
        if (p.holedOut) {
            let total = p.strokes + p.penaltyStrokes;
            p.scores[playingHoleIndex] = total;
            p.scoreVsPar[playingHoleIndex] = total - (hole.par || 4);
            
            let flash = document.getElementById('pb-flash');
            if(flash) {
                let diff = total - (hole.par || 4);
                flash.innerText = logHoleScoreText(total, hole.par || 4);
                if(diff < 0) flash.style.color = '#4ade80';
                else if(diff > 0) flash.style.color = '#f87171';
                else flash.style.color = '#e2e8f0';
                flash.style.opacity = '1';
                setTimeout(() => { flash.style.opacity = '0'; }, 3000);
            }
        }
        
        let nextPlayer = getNextPlayerIndex();
        if(nextPlayer === -1) {
            window.nextTurnTimeout = setTimeout(nextHole, 1500);
        } else {
            window.nextTurnTimeout = setTimeout(() => {
                switchTurnTo(nextPlayer);
            }, p.holedOut ? 1000 : 200);
        }
    }

    window.actuallyStartRound = function() {
        if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
        
        document.getElementById('settings-modal').style.display = 'none';

        playState = 'ROUND_IDLE';
        let firstPlayableHole = 0;
        for (let i = 0; i < 18; i++) {
            let hole = courseHoles[i];
            let hasTee = hole && hole.tees && (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black);
            if (hole && hasTee && hole.flag) {
                firstPlayableHole = i;
                break;
            }
        }
        playingHoleIndex = firstPlayableHole;
        
        window.players = window.setupPlayers.map(sp => ({
            id: sp.name + "_" + Math.random().toString(36).substring(7),
            name: sp.name,
            tee: sp.tee,
            strokes: 0,
            penaltyStrokes: 0,
            scores: Array(18).fill(null),
            scoreVsPar: Array(18).fill(null),
            lie: null,
            teePosition: null,
            holedOut: false,
            honours: false
        }));
        
        window.activePlayerIndex = 0;
        
        document.getElementById('play-tools').style.display = 'flex';
        document.getElementById('btn-start-round').style.display = 'none';
        document.getElementById('playing-hud').style.display = 'none'; 
        document.getElementById('player-banner').style.display = 'block'; 
        document.getElementById('player-banner').querySelector('#pb-name').style.display = 'inline-block'; 
        
        teleportToHole(playingHoleIndex);
    };

    window.updatePlayerBanner = function() {
        let hole = courseHoles[playingHoleIndex];
        if(!hole || !window.players) return;
        
        let p = window.players[window.activePlayerIndex];
        if(!p) return;

        let totalVsPar = p.scoreVsPar.reduce((sum, s) => s !== null ? sum + s : sum, 0);
        
        let totalDisplay = "E";
        if (totalVsPar > 0) totalDisplay = "+" + totalVsPar;
        else if (totalVsPar < 0) totalDisplay = totalVsPar.toString();
        
        document.getElementById('pb-name').innerText = p.name;
        document.getElementById('pb-score').innerHTML = totalDisplay;
        
        let totalStrokes = p.strokes + p.penaltyStrokes;
        document.getElementById('pb-shot').innerText = "Shot " + (totalStrokes + 1);
        
        if (hole.flag && window.ballMesh && window.ballMesh.visible) {
            let dist = window.ballMesh.position.distanceTo(new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z));
            document.getElementById('pb-dist').innerText = window.formatDistStr(dist, 1);
        }
    };
    
    function logHoleScoreText(strokes, par) {
        let diff = strokes - par;
        if(strokes === 1) return "HOLE IN ONE!";
        if(diff <= -3) return "ALBATROSS";
        if(diff === -2) return "EAGLE";
        if(diff === -1) return "BIRDIE";
        if(diff === 0) return "PAR";
        if(diff === 1) return "BOGEY";
        if(diff === 2) return "DOUBLE BOGEY";
        return diff >= 3 ? "+" + diff : "";
    }
    
    function nextHole() {
        startNextHole();
    }
    
    function startNextHole() {
        let nextPlayableHole = -1;
        for (let i = playingHoleIndex + 1; i < 18; i++) {
            let hole = courseHoles[i];
            let hasTee = hole && hole.tees && (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black);
            if (hole && hasTee && hole.flag) {
                nextPlayableHole = i;
                break;
            }
        }
        if(nextPlayableHole === -1) {
            let pop = document.getElementById('score-popup');
            pop.innerText = "ROUND COMPLETE!";
            pop.style.opacity = '1';
            pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
            setTimeout(() => { pop.style.opacity = '0'; }, 3000);
            
            playState = 'ROUND_COMPLETE';
            document.getElementById('player-banner').style.display = 'none';
            document.getElementById('play-tools').style.display = 'none';
            document.getElementById('btn-start-round').style.display = 'none';
            
            // Hide minimap and lie HUD
            let mapCont = document.getElementById('minimap-container');
            if (mapCont) mapCont.style.display = 'none';
            let lieHud = document.getElementById('lie-conditions-hud');
            if (lieHud) lieHud.style.display = 'none';
            
            renderScorecard();
            // Show end-round action buttons, hide close button
            let endBtns = document.getElementById('scorecard-endround-btns');
            if (endBtns) endBtns.style.display = 'flex';
            let closeBtn = document.getElementById('scorecard-footer');
            if (closeBtn) closeBtn.style.display = 'none';
            document.getElementById('scorecard-modal').style.display = 'flex';
            return;
        }
        
        playingHoleIndex = nextPlayableHole;
        teleportToHole(playingHoleIndex);
    }
    function renderScorecard() {
        let tbody = document.getElementById('scorecard-tbody');
        if(!tbody) return;
        
        let maxHoles = 18; 
        if (!courseHoles[9] || !courseHoles[9].flag) maxHoles = 9; 
        
        let htmlMode = '';
        
        // HEADER ROW: Hole numbers
        let trHeader = `<tr style="color:#94a3b8; font-size:11px;"><td></td>`;
        for(let i=0; i<maxHoles; i++) trHeader += `<td>${i+1}</td>`;
        if(maxHoles >= 9) trHeader += `<td>OUT</td>`;
        if(maxHoles > 9) trHeader += `<td>IN</td><td>TOT</td>`;
        trHeader += `</tr>`;
        htmlMode += trHeader;
        
        // PAR ROW
        let trPar = `<tr style="color:#fbbf24; border-bottom:1px solid #334155;"><td>PAR</td>`;
        let parOut = 0, parIn = 0;
        for(let i=0; i<maxHoles; i++) {
            let par = courseHoles[i] ? (courseHoles[i].par || 4) : '-';
            if(par !== '-') { if(i < 9) parOut += par; else parIn += par; }
            trPar += `<td>${par}</td>`;
        }
        if(maxHoles >= 9) trPar += `<td style="color:#fbbf24">${parOut || '-'}</td>`;
        if(maxHoles > 9) trPar += `<td style="color:#fbbf24">${parIn || '-'}</td><td style="color:#fbbf24">${(parOut+parIn) || '-'}</td>`;
        trPar += `</tr>`;
        htmlMode += trPar;
        
        // BUG-P04+P05 FIX: Score rows per player using correct data source
        let players = window.players || [];
        for(let pi=0; pi<players.length; pi++) {
            let pl = players[pi];
            let scoreOut = 0, scoreIn = 0, hasOut = false, hasIn = false;
            let trScore = `<tr style="color:#fff; border-bottom:1px solid #1e293b;"><td style="color:${pl.color || '#fff'}">${pl.name || 'P'+(pi+1)}</td>`;
            for(let i=0; i<maxHoles; i++) {
                let s = (pl.scores && pl.scores[i] !== null && pl.scores[i] !== undefined) ? pl.scores[i] : null;
                let par = courseHoles[i] ? (courseHoles[i].par || 4) : 4;
                let cellColor = '#fff';
                if(s !== null) {
                    let diff = s - par;
                    if(diff < 0) cellColor = '#4ade80'; // Under par
                    else if(diff > 0) cellColor = '#f87171'; // Over par
                    if(i < 9) { scoreOut += s; hasOut = true; }
                    else { scoreIn += s; hasIn = true; }
                }
                trScore += `<td style="color:${cellColor}">${s !== null ? s : '-'}</td>`;
            }
            if(maxHoles >= 9) trScore += `<td style="color:#fbbf24">${hasOut ? scoreOut : '-'}</td>`;
            if(maxHoles > 9) trScore += `<td style="color:#fbbf24">${hasIn ? scoreIn : '-'}</td><td style="color:#fbbf24; font-weight:900">${(hasOut||hasIn) ? (scoreOut+scoreIn) : '-'}</td>`;
            trScore += `</tr>`;
            htmlMode += trScore;
        }
        
        tbody.innerHTML = htmlMode;
    }
    
    window.camFollowMode = 'AUTO'; 
    window.toggleCamMode = function() {
        let btn = document.getElementById('btn-cam-mode');
        if (window.camFollowMode === 'AUTO') {
            window.camFollowMode = 'FREE';
            btn.innerText = '🎥 FREE CAM';
            btn.style.background = '#ec4899'; 
        } else {
            window.camFollowMode = 'AUTO';
            btn.innerText = '🎥 AUTO';
            btn.style.background = '#4f46e5'; 
        }
    };

    window.startFlyover = function() {
        if (playState !== 'ROUND_IDLE' || isFlying) return;
        let hole = courseHoles[playingHoleIndex];
        if (!hole || !hole.flag) return;
        
        // Start: ovanför bollen
        flyoverStart.copy(window.ballMesh.position).add(new THREE.Vector3(0, 15, 5));
        // Slut: ovanför flaggan
        flyoverEnd.set(hole.flag.x, hole.flag.y + 8, hole.flag.z + 5);
        flyoverProgress = 0;
        
        // Beräkna duration baserat på avstånd (längre hål = längre flyover)
        let dist = flyoverStart.distanceTo(flyoverEnd);
        flyoverDuration = Math.max(90, Math.min(240, Math.round(dist * 0.8))); // 1.5-4s
        
        gameCamPhase = 'HOLE_FLYOVER';
        controls.enabled = false;
    };

    function fireShot() {
        if(isFlying) return; 
        
        var vSpeed = parseFloat(document.getElementById('in-speed').value) || 130;
        var vLa = parseFloat(document.getElementById('in-la').value) || 14;
        var vHla = parseFloat(document.getElementById('in-hla').value) || 0;
        
        let bs = parseFloat(document.getElementById('in-backspin').value) || 2500;
        let ss = parseFloat(document.getElementById('in-sidespin').value) || 0;
        
        let totalSpin = Math.sqrt(bs*bs + ss*ss);
        let spinAxis = Math.atan2(-ss, bs) * (180 / Math.PI);
        
        var launchData = {
            ballSpeedMph: vSpeed,
            launchAngleDeg: vLa,
            azimDeg: vHla,
            totalSpinRpm: totalSpin,
            spinAxisDeg: spinAxis,
            isLiveData: false,
            
            clubSpeedMph: 0,
            clubPathDeg: 0,
            faceToPathDeg: 0,
            clubAoADeg: 0
        };
        
        triggerRealShot(launchData);
    }
    
    function triggerRealShot(data) {
        if(isFlying) return;
        
        if(document.getElementById('hud-cp')) document.getElementById('hud-cp').innerText = typeof data.clubPathDeg === 'number' ? data.clubPathDeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-ftp')) document.getElementById('hud-ftp').innerText = typeof data.faceToPathDeg === 'number' ? data.faceToPathDeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-aoa')) document.getElementById('hud-aoa').innerText = typeof data.clubAoADeg === 'number' ? data.clubAoADeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-cs')) document.getElementById('hud-cs').innerText = typeof data.clubSpeedMph === 'number' ? data.clubSpeedMph.toFixed(1) + ' mph' : '---';
        if(document.getElementById('hud-hla')) document.getElementById('hud-hla').innerText = typeof data.azimDeg === 'number' ? data.azimDeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-bs')) document.getElementById('hud-bs').innerText = typeof data.ballSpeedMph === 'number' ? data.ballSpeedMph.toFixed(1) + ' mph' : '---';
        if(document.getElementById('hud-vla')) document.getElementById('hud-vla').innerText = typeof data.launchAngleDeg === 'number' ? data.launchAngleDeg.toFixed(1) + '°' : '---';
        
        let sSpin = (data.totalSpinRpm * Math.sin((data.spinAxisDeg||0) * Math.PI/180)) || 0;
        let bSpin = (data.totalSpinRpm * Math.cos((data.spinAxisDeg||0) * Math.PI/180)) || data.totalSpinRpm;
        if(document.getElementById('hud-ss')) document.getElementById('hud-ss').innerText = sSpin.toFixed(0);
        if(document.getElementById('hud-backspin')) document.getElementById('hud-backspin').innerText = bSpin.toFixed(0);
        if(document.getElementById('hud-sa')) document.getElementById('hud-sa').innerText = typeof data.spinAxisDeg === 'number' ? data.spinAxisDeg.toFixed(1) + '°' : '---';
        
        if(document.getElementById('in-speed')) document.getElementById('in-speed').value = (data.ballSpeedMph || 0).toFixed(1);
        if(document.getElementById('in-la')) document.getElementById('in-la').value = (data.launchAngleDeg || 0).toFixed(1);
        if(document.getElementById('in-hla')) document.getElementById('in-hla').value = (data.azimDeg || 0).toFixed(1);

        executeArcadeShot(data);
    }

    window.shotStartPos = null;

    function executeArcadeShot(data) {
        if (window.camFollowMode === 'AUTO') {
            controls.enabled = false;
            gameCamPhase = 'FLIGHT_FOLLOW';
        } else {
            controls.enabled = true;
        }
        
        let startPos = [0, 0.3, 0];
        
        if (playState === 'ROUND_IDLE' || playState === 'IDLE') {
            playState = 'ROUND_FLYING';
            if (document.getElementById('play-tools')) document.getElementById('play-tools').style.display = 'none';
            let p = window.players[window.activePlayerIndex];
            
            if (p && p.holedOut) {
                // Reset hole for testing/mulligan if holed out
                p.strokes = 0;
                p.penaltyStrokes = 0;
                p.holedOut = false;
                if (p.teePosition) {
                    window.ballMesh.position.set(p.teePosition.x, p.teePosition.y, p.teePosition.z);
                } else if (typeof window.ballPos !== 'undefined') {
                    window.ballMesh.position.set(window.ballPos.x, window.ballPos.y, window.ballPos.z);
                }
            }
            
            p.prevPos = { x: window.ballMesh.position.x, y: window.ballMesh.position.y, z: window.ballMesh.position.z };
            p.prevStrokes = p.strokes;
            p.prevPenalty = p.penaltyStrokes;
            
            window.lastShotPlayerIndex = window.activePlayerIndex;
            
            p.strokes++;
            document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
            
            startPos = [window.ballMesh.position.x, -window.ballMesh.position.z, window.ballMesh.position.y]; 
        } else {
            // Failsafe for rogue shots
            startPos = [window.ballMesh.position.x, -window.ballMesh.position.z, window.ballMesh.position.y];
        }
        
        // Failsafe: Ensure the ball is never launched from UNDER ground (e.g. buried tees)
        if (typeof window.localGetTerrainAt === 'function') {
            let t = window.localGetTerrainAt(startPos[0], startPos[1]);
            if (t && startPos[2] < t.z) {
                console.warn(`[Physics] Failsafe: Ball started underground (Z=${startPos[2].toFixed(3)}), snapping to terrain (Z=${t.z.toFixed(3)})`);
                startPos[2] = t.z + 0.022; // 22mm (slightly above terrain to prevent instant clipping)
            }
        }
        
        window.shotStartPos = new THREE.Vector3(startPos[0], startPos[2], -startPos[1]);

        var vStimpEl = document.getElementById('in-stimp');
        window.GREEN_STIMP = vStimpEl ? (parseFloat(vStimpEl.value) || 10.0) : 10.0;
        
        let aimOffsetDeg = 0;
        if ((appMode === 'PLAY' || appMode === 'TEST') && window.aimTarget) {
            let dX = window.aimTarget.x - window.ballMesh.position.x;
            let dZ = window.aimTarget.z - window.ballMesh.position.z;
            aimOffsetDeg = Math.atan2(dX, -dZ) * 180 / Math.PI;
        }

        var launchConfig = {
            startPos: startPos,
            ballSpeedMph: data.ballSpeedMph,
            launchAngleDeg: data.launchAngleDeg,
            totalSpinRpm: data.totalSpinRpm,
            spinAxisDeg: data.spinAxisDeg || 0,
            azimDeg: (data.azimDeg || 0) + aimOffsetDeg, 
            isLiveData: data.isLiveData || false,
            isTeeShot: (window.players && window.players[window.activePlayerIndex] && window.players[window.activePlayerIndex].strokes === 1) // Just updated from 0 to 1 in this function
        };
        // BUG-06 FIX: Use actual flag data from courseHoles instead of dead window.pinMesh
        var cupPosLocal = null;
        let activeHoleIdx = (playState === 'ROUND_IDLE' || playState === 'ROUND_FLYING') ? playingHoleIndex : currentHoleIndex;
        let activeHole = courseHoles[activeHoleIdx];
        if (activeHole && activeHole.flag && activeHole.flagMesh) {
            cupPosLocal = [activeHole.flagMesh.position.x, -activeHole.flagMesh.position.z, activeHole.flagMesh.position.y];
        }
        
        let envAlt = window.matchSettings ? window.matchSettings.altitude : 0;
        
        let windVecStr = JSON.stringify(window.currentWindVec);
        console.log("WIND INJECTED TO PHYSICS:", windVecStr, "SPEED:", window.currentWindMph, "DIR:", window.currentWindDir);

        var envCtx = {
            wind: window.currentWindVec,
            altitudeFeet: envAlt,
            temperatureC: 25,
            cupPositionLocal: cupPosLocal,
            greenFirmness: window.matchSettings ? window.matchSettings.greenFirmness : 'NORMAL',
            checkCollisionCallback: function(x, y, z) { 
                if (!window.placedTrees) return null;
                let threeX = x;
                let threeZ = -y;
                
                for(let i=0; i<window.placedTrees.length; i++) {
                    let obj = window.placedTrees[i];
                    
                    let dx = obj.x - threeX;
                    let dz = obj.z - threeZ;
                    let distSq = dx*dx + dz*dz;
                    let dist = Math.sqrt(distSq) || 0.001;

                    let nxThree = -dx / dist; 
                    let nzThree = -dz / dist;
                    let nxPhys = nxThree;
                    let nyPhys = -nzThree;
                    
                    let assetDef = window.ASSET_REGISTRY && window.ASSET_REGISTRY[obj.type] ? window.ASSET_REGISTRY[obj.type] : null;
                    if (assetDef && assetDef.physics) {
                        let phys = assetDef.physics;
                        
                        if (phys.type === 'sphere') {
                            let rad = phys.radius * obj.scale;
                            if (distSq < rad*rad && z < rad) {
                                let sX = obj.x + nxThree * (rad + 0.05);
                                let sZ = obj.z + nzThree * (rad + 0.05);
                                return { type: obj.type, height: rad, n: [nxPhys, nyPhys, 0], safePos: [sX, -sZ] };
                            }
                        } else if (phys.type === 'cylinder') {
                            let rad = phys.radius * obj.scale;
                            let h = phys.height * obj.scale;
                            if (distSq < rad*rad && z < h) {
                                let sX = obj.x + nxThree * (rad + 0.05);
                                let sZ = obj.z + nzThree * (rad + 0.05);
                                return { type: obj.type, height: h, n: [nxPhys, nyPhys, 0], safePos: [sX, -sZ] };
                            }
                        } else if (phys.type === 'tree') {
                            let trunkRadius = phys.trunkRadius * obj.scale;
                            let treeHeight = phys.height * obj.scale;
                            let canopyRadius = phys.canopyRadius * obj.scale;
                            
                            if (distSq < canopyRadius*canopyRadius) {
                                if (distSq < trunkRadius*trunkRadius && z < treeHeight*0.4) {
                                    let sX = obj.x + nxThree * (trunkRadius + 0.05);
                                    let sZ = obj.z + nzThree * (trunkRadius + 0.05);
                                    return { type: obj.type, height: treeHeight, part: 'TRUNK', n: [nxPhys, nyPhys, 0], safePos: [sX, -sZ] };
                                } else if (z > treeHeight*0.3 && z < treeHeight) {
                                    return { type: obj.type, height: treeHeight, part: 'CANOPY' };
                                }
                            }
                        }
                    }
                }
                return null; 
            },
            hasTreeCollision: function(x, y, z) { return false; },
            getTerrainAt: function(px, py) {
                let threeX = px;
                let threeZ = -py;
                
                let gx = Math.round((threeX + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
                let gz = Math.round((threeZ + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
                
                if(gx < 0) gx = 0; if(gx > TERRAIN_SEGS) gx = TERRAIN_SEGS;
                if(gz < 0) gz = 0; if(gz > TERRAIN_SEGS) gz = TERRAIN_SEGS;
                
                let idx = gz * (TERRAIN_SEGS+1) + gx;
                let positions = planeGeo.attributes.position.array;
                let height = positions[idx * 3 + 2]; 
                
                let gxRight = Math.min(TERRAIN_SEGS, gx + 1);
                let gzDown = Math.max(0, gz - 1); 

                let hR = positions[(gz * (TERRAIN_SEGS+1) + gxRight) * 3 + 2];
                let hD = positions[(gzDown * (TERRAIN_SEGS+1) + gx) * 3 + 2];
                
                let step = TERRAIN_SIZE/TERRAIN_SEGS;
                let dx_phys = (hR - height) / step;
                let dy_phys = (hD - height) / step; 
                
                let len = Math.sqrt(dx_phys*dx_phys + dy_phys*dy_phys + 1.0);
                let normal = [-dx_phys/len, -dy_phys/len, 1.0/len];
                
                let cX = Math.floor(((threeX + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096);
                let cZ = Math.floor(((threeZ + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096);
                if (cX < 0) cX = 0; if (cX >= 4096) cX = 4095;
                if (cZ < 0) cZ = 0; if (cZ >= 4096) cZ = 4095;
                
                let r, g, b;
                if (window.terrainBiomeData) {
                    let pIdx = (cZ * 4096 + cX) * 4;
                    r = window.terrainBiomeData[pIdx];
                    g = window.terrainBiomeData[pIdx+1];
                    b = window.terrainBiomeData[pIdx+2];
                } else {
                    r = 74; g = 222; b = 128; 
                }
                
                let biomeType = 'ROUGH'; 
                function cDist(r1, g1, b1, r2, g2, b2) { return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2; }
                
                let dOB = cDist(r,g,b, 239,68,68);
                let dSand = cDist(r,g,b, 224,216,164);
                let dWaste = cDist(r,g,b, 194,175,124);
                let dFairway = cDist(r,g,b, 125,185,82);
                let dSemiRough = cDist(r,g,b, 107,158,61);
                let dRough = cDist(r,g,b, 74,120,43);
                let dDeepRough = cDist(r,g,b, 45,76,26);
                let dGreen = cDist(r,g,b, 152,206,104);
                let dWater = cDist(r,g,b, 56,189,248);
                
                let minD = Math.min(dOB, dSand, dWaste, dFairway, dSemiRough, dRough, dDeepRough, dGreen, dWater);
                
                if (minD === dSand) biomeType = 'SAND';
                else if (minD === dWaste) biomeType = 'WASTE';
                else if (minD === dGreen) biomeType = 'GREEN';
                else if (minD === dOB) biomeType = 'OB';
                else if (minD === dWater) biomeType = 'WATER';
                else if (minD === dFairway) biomeType = 'FAIRWAY';
                else if (minD === dSemiRough) biomeType = 'SEMI-ROUGH';
                else if (minD === dDeepRough) biomeType = 'DEEP ROUGH';
                else biomeType = 'ROUGH';
                let waterHeight = -99;
                if (typeof waterGeo !== 'undefined' && waterGeo) {
                    waterHeight = waterGeo.attributes.position.array[idx * 3 + 2];
                }
                
                if (waterHeight > -90 && height < waterHeight + 0.1) {
                    biomeType = 'WATER';
                    height = waterHeight; 
                }
                return {
                    z: height,
                    normal: normal, 
                    type: biomeType
                };
            }
        };
        
        if (!window.terrainBiomeData) {
            window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
        }
        
        // === DEBUG: Diagnose 40-yard flight bug ===
        let dbgTerrain = envCtx.getTerrainAt(launchConfig.startPos[0], launchConfig.startPos[1]);
        console.log("🔍 LAUNCH DEBUG:", JSON.stringify({
            ballSpeedMph: launchConfig.ballSpeedMph,
            launchAngleDeg: launchConfig.launchAngleDeg,
            totalSpinRpm: launchConfig.totalSpinRpm,
            azimDeg: launchConfig.azimDeg,
            isTeeShot: launchConfig.isTeeShot,
            isLiveData: launchConfig.isLiveData,
            startPos: launchConfig.startPos,
            terrainAtStart: dbgTerrain ? dbgTerrain.type : 'UNKNOWN',
            terrainZ: dbgTerrain ? dbgTerrain.z : 'N/A',
            hasBiomeData: !!window.terrainBiomeData
        }, null, 2));
        
        let result = window.GolfPhysics.simulateFlight(launchConfig, envCtx);
        if (!result) return;
        
        // === DEBUG: Flight result ===
        let dbgFinal = result.path[result.path.length - 1];
        console.log("🔍 FLIGHT RESULT:", JSON.stringify({
            pathLength: result.path.length,
            finalPos: { x: dbgFinal.x.toFixed(2), y: dbgFinal.y.toFixed(2), z: dbgFinal.z.toFixed(2) },
            carryMeters: result.metrics.carryMeters.toFixed(1),
            carryYards: (result.metrics.carryMeters * 1.09361).toFixed(1),
            totalMeters: Math.sqrt(dbgFinal.x*dbgFinal.x + dbgFinal.y*dbgFinal.y).toFixed(1),
            totalYards: (Math.sqrt(dbgFinal.x*dbgFinal.x + dbgFinal.y*dbgFinal.y) * 1.09361).toFixed(1),
            apex: result.metrics.apexMeters.toFixed(1),
            bounces: result.metrics.bounceCount,
            finalTerrain: result.metrics.finalTerrainType
        }, null, 2));
        
        flightData = result; 
        flightTick = 0;
        window._flightStartTime = null; // Reset delta-time tracker
        window._lastProcessedTick = 0;
        window._rollStartTick = null; // Reset roll acceleration tracker
        window._flightAccumMs = 0;
        isFlying = true;
        
        tracerPointsCount = 0;
        flightTracer.geometry.setDrawRange(0, 0);
        // Glow tracer shares geometry - ensure visibility matches style
        let tStyle = TRACER_STYLES[window.currentTracerStyle || 'CLASSIC'];
        if (typeof glowTracer !== 'undefined') glowTracer.visible = !!(tStyle && tStyle.glow);
        isFlying = true;
    }

    let appMode = 'PLAY'; 
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.zoomSpeed = 0.3;
    controls.panSpeed = 0.5;
    controls.target.set(0, 0, -20);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let currentBuildColor = 0xef4444; 
    
    const ghostGeo = new THREE.BoxGeometry(3, 4, 3);
    const ghostMat = new THREE.MeshBasicMaterial({ color: currentBuildColor, opacity: 0.5, transparent: true, wireframe: false });
    const ghostBlock = new THREE.Mesh(ghostGeo, ghostMat);
    ghostBlock.visible = false;
    scene.add(ghostBlock);

    const ghostTree = new THREE.Mesh(bushGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, wireframe: true, transparent:true, opacity: 0.7 }));
    ghostTree.visible = false;
    scene.add(ghostTree);
    
    let isSculpting = false;
    let sculptDirection = 1;
    let currentTool = 'SCULPT'; 
    let currentBrushSize = 6.0;

    let splinePoints = [];
    let splineSpheres = [];
    let splineLineMesh = null;
    let splinePreviewMesh = null;

    let brushMultiplier = 1;
    window.ipadSculptDir = 1;
    window.toggleIpadSculpt = function() {
        window.ipadSculptDir = window.ipadSculptDir === 1 ? -1 : 1;
        let btn = document.getElementById('ipad-sculpt-btn');
        if (window.ipadSculptDir === 1) {
            btn.innerText = "⬆️ RAISE";
            btn.style.background = "#4ade80"; 
            btn.style.color = "#0f172a";
        } else {
            btn.innerText = "⬇️ LOWER";
            btn.style.background = "#ef4444"; 
            btn.style.color = "#fff";
        }
    };
    window.setBrushMultiplier = function(mult, btn) {
        brushMultiplier = mult;
        document.querySelectorAll('.brush-mult-btn').forEach(b => {
             b.style.background = '#334155';
             b.style.color = '#94a3b8';
        });
        if (btn) {
             btn.style.background = '#38bdf8';
             btn.style.color = '#0f172a';
        }
        updateBrushSize();
    };

    window.updateBrushSize = function() {
        let val = document.getElementById('brush-slider') ? document.getElementById('brush-slider').value : 6;
        currentBrushSize = parseFloat(val) * brushMultiplier;
        if(sculptBrushCursor) {
            sculptBrushCursor.geometry.dispose();
            sculptBrushCursor.geometry = new THREE.RingGeometry(currentBrushSize - 0.5, currentBrushSize, 32);
        }
    };
    
    window.currentBrushHardness = 1.0;
    window.updateBrushHardness = function() {
        let val = document.getElementById('hardness-slider') ? document.getElementById('hardness-slider').value : 100;
        window.currentBrushHardness = parseInt(val) / 100;
    };
    
    window.toggleRetroFilter = function() {
        let isRetro = document.getElementById('retro-filter-cb') ? document.getElementById('retro-filter-cb').checked : false;
        if (typeof mapTex !== 'undefined') {
            mapTex.magFilter = isRetro ? THREE.NearestFilter : THREE.LinearFilter;
            mapTex.minFilter = isRetro ? THREE.NearestFilter : THREE.LinearFilter;
            mapTex.needsUpdate = true;
        }
    };

    const undoStack = [];
    window.performUndo = function() {
        if (undoStack.length === 0) return;
        let state = undoStack.pop();
        
        let posArr = planeGeo.attributes.position.array;
        for(let i=0; i<posArr.length; i++) posArr[i] = state.heights[i];
        planeGeo.attributes.position.needsUpdate = true;
        planeGeo.computeVertexNormals();
        
        if (state.wHeights && typeof waterGeo !== 'undefined' && waterGeo) {
            let wPosArr = waterGeo.attributes.position.array;
            for(let i=0; i<wPosArr.length; i++) {
                wPosArr[i] = state.wHeights[i];
            }
            for(let i=2; i<wPosArr.length; i+=3) {
                window.waterBaseZ[(i-2)/3] = wPosArr[i];
            }
            waterGeo.attributes.position.needsUpdate = true;
        }
        
        pCtx.clearRect(0,0,4096,4096);
        pCtx.drawImage(state.colorCanvas, 0, 0);
        mapTex.needsUpdate = true;
        
        if (state.waterColorCanvas && typeof wCtx !== 'undefined') {
            wCtx.clearRect(0,0,4096,4096);
            wCtx.drawImage(state.waterColorCanvas, 0, 0);
            if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
        }
        
        targets.forEach(t => scene.remove(t.mesh));
        targets.length = 0;
        if (state.blocks) {
            state.blocks.forEach(b => createTargetAbsolute(b.x, b.y, b.z, b.color));
        }
        
        window.placedTrees.length = 0;
        destroyAllPools();
        if (state.trees) {
            state.trees.forEach(t => createTree(t.type, t.x, t.z, t.scale, t.rot));
        }
        
        if(state.holes) {
            for(let i=0; i<courseHoles.length; i++) {
                let hState = state.holes[i];
                if(!hState) continue;
                let h = courseHoles[i];
                
                for(let key in h.teeMeshes) {
                    if(h.teeMeshes[key]) scene.remove(h.teeMeshes[key]);
                }
                if(h.flagMesh) scene.remove(h.flagMesh);
                
                h.tees = JSON.parse(JSON.stringify(hState.tees));
                h.teeMeshes = {};
                for(let key in h.tees) {
                    let col = 0xffffff;
                    if(key === 'red') col = 0xef4444;
                    if(key === 'yellow') col = 0xfacc15;
                    if(key === 'black') col = 0x111111;
                    h.teeMeshes[key] = createTeeObject(h.tees[key].x, h.tees[key].y, h.tees[key].z, col);
                    if(h.tees[key].rot) h.teeMeshes[key].rotation.y = h.tees[key].rot;
                }
                
                h.flag = hState.flag ? JSON.parse(JSON.stringify(hState.flag)) : null;
                if(h.flag) {
                    if (h.flag.isTarget) h.flagMesh = createTargetObject(h.flag.x, h.flag.y, h.flag.z);
                    else h.flagMesh = createFlagObject(h.flag.x, h.flag.y, h.flag.z);
                } else {
                    h.flagMesh = null;
                }
            }
        }
    };
    
    function saveUndoState() {
        if (undoStack.length >= 15) undoStack.shift();
        
        let posCopy = new Float32Array(planeGeo.attributes.position.array);
        let cCopy = document.createElement('canvas');
        cCopy.width = 4096; cCopy.height = 4096;
        cCopy.getContext('2d', {willReadFrequently:true}).drawImage(paintCanvas, 0, 0);
        
        let wPosCopy = typeof waterGeo !== 'undefined' && waterGeo ? new Float32Array(waterGeo.attributes.position.array) : null;
        let wCanvasCopy = document.createElement('canvas');
        wCanvasCopy.width = 4096; wCanvasCopy.height = 4096;
        if(typeof waterCanvas !== 'undefined') wCanvasCopy.getContext('2d', {willReadFrequently:true}).drawImage(waterCanvas, 0, 0);
        
        let blocksCopy = targets.map(b => ({x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z, color: b.defColor || 0xffffff}));
        let treesCopy = window.placedTrees.map(t => ({type: t.type, x: t.x, z: t.z, scale: t.scale, rot: t.rot}));
        
        let holesCopy = courseHoles.map(h => ({
            tees: JSON.parse(JSON.stringify(h.tees)),
            flag: h.flag ? JSON.parse(JSON.stringify(h.flag)) : null
        }));
        
        undoStack.push({ 
            heights: posCopy, 
            wHeights: wPosCopy, 
            colorCanvas: cCopy, 
            waterColorCanvas: wCanvasCopy, 
            blocks: blocksCopy, 
            trees: treesCopy,
            holes: holesCopy
        });
    }

    window.addEventListener('pointermove', onMouseMove, false);
    
    let moveDir = null;
    window.startMove = function(dir) { moveDir = dir; };
    window.stopMove = function() { moveDir = null; };
    
    window.addEventListener('keydown', e => {
        if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        let key = e.key.toUpperCase();
        if(['W','A','S','D'].includes(key)) {
            moveDir = key;
        } else if (e.code === 'KeyZ' && e.ctrlKey) {
            performUndo();
        }
    });
    window.addEventListener('keyup', e => {
        let key = e.key.toUpperCase();
        if(key === moveDir) moveDir = null;
    });
    
    let waterLevelTarget = 0;
    // === TEST MODE: Double-click to place ball ===
    renderer.domElement.addEventListener('dblclick', e => {
        if (appMode !== 'TEST' || isFlying || playState !== 'ROUND_IDLE') return;
        
        // Raycast to terrain
        let rect = renderer.domElement.getBoundingClientRect();
        let mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        let my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        let rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(mx, my), camera);
        let hits = rc.intersectObject(plane);
        if (hits.length === 0) return;
        
        let pt = hits[0].point;
        window.ballPos.x = pt.x;
        window.ballPos.y = pt.y + 0.1;
        window.ballPos.z = pt.z;
        window.ballMesh.position.set(pt.x, pt.y + 0.1, pt.z);
        window.ballMesh.visible = true;
        
        // Auto-detect putting distance
        let hole = courseHoles[currentHoleIndex] || courseHoles[0];
        if (hole && hole.flag) {
            let distToFlag = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z).distanceTo(pt);
            let isPutt = distToFlag < CAM.PUTT_THRESHOLD;
            window.isPuttingMode = isPutt;
            gameCamPhase = isPutt ? 'PUTT_AIM' : 'IDLE_AIM';
            
            if (window.aimTarget) window.aimTarget.set(hole.flag.x, hole.flag.y, hole.flag.z);
            window.pinMesh = hole.flagMesh;
        }
        
        // Set appropriate shot defaults based on distance
        if (window.isPuttingMode) {
            if(document.getElementById('in-speed')) document.getElementById('in-speed').value = '6';
            if(document.getElementById('in-la')) document.getElementById('in-la').value = '1.5';
            if(document.getElementById('in-backspin')) document.getElementById('in-backspin').value = '30';
        } else {
            if(document.getElementById('in-speed')) document.getElementById('in-speed').value = '130';
            if(document.getElementById('in-la')) document.getElementById('in-la').value = '14';
            if(document.getElementById('in-backspin')) document.getElementById('in-backspin').value = '2500';
        }
        if(document.getElementById('in-sidespin')) document.getElementById('in-sidespin').value = '0';
        if(document.getElementById('in-hla')) document.getElementById('in-hla').value = '0';
        
        // Toast feedback
        let toast = document.createElement('div');
        toast.innerText = window.isPuttingMode ? '⛳ Boll placerad på green!' : '🏌️ Boll placerad!';
        toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:10px 20px;border-radius:10px;font-weight:bold;font-size:14px;z-index:9999;pointer-events:none;';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; }, 1500);
        setTimeout(() => toast.remove(), 2000);
    });

    renderer.domElement.addEventListener('pointerdown', e => {
        if(appMode !== 'BUILD') return;
        if(currentTool === 'INSPECT') return;
        
        // === ERASER TOOL ===
        if (currentTool === 'ERASER' && e.button === 0 && lastHitPoint) {
            saveUndoState();
            
            // 1. Try removing a nature object (tree/rock/plant)
            let closest = null; let minDist = 3.5;
            for (let i = 0; i < window.placedTrees.length; i++) {
                let t = window.placedTrees[i];
                let d = Math.sqrt((t.x - lastHitPoint.x)**2 + (t.z - lastHitPoint.z)**2);
                if (d < minDist) { minDist = d; closest = i; }
            }
            if (closest !== null) {
                let removedType = window.placedTrees[closest].type;
                window.placedTrees.splice(closest, 1);
                rebuildInstancePool(removedType);
                return;
            }
            
            // 2. Try removing a block
            let hit = getIntersect();
            if (hit && hit.object !== plane) {
                scene.remove(hit.object);
                let idx = targets.findIndex(t => t.mesh === hit.object);
                if (idx !== -1) targets.splice(idx, 1);
                saveLevel();
                return;
            }
            return;
        }

        // === COLORIZE TOOL ===
        if (currentTool === 'COLORIZE' && e.button === 0 && lastHitPoint) {
            saveUndoState();
            let closest = null; let minDist = 3.5;
            for (let i = 0; i < window.placedTrees.length; i++) {
                let t = window.placedTrees[i];
                let d = Math.sqrt((t.x - lastHitPoint.x)**2 + (t.z - lastHitPoint.z)**2);
                if (d < minDist) { minDist = d; closest = i; }
            }
            if (closest !== null) {
                let col = window.activeColorizeColor || '#ffffff';
                let tCol = window.activeTrunkColor || '#ffffff';
                if (window.placedTrees[closest].color !== col || window.placedTrees[closest].trunkColor !== tCol) {
                    window.placedTrees[closest].color = col;
                    window.placedTrees[closest].trunkColor = tCol;
                    rebuildInstancePool(window.placedTrees[closest].type);
                }
            }
            return;
        }
        
        let isModifyingClick = e.button === 0 || e.button === 2;
        if(currentTool !== 'PAINT' && currentTool !== 'MEASURE' || isModifyingClick) { 
             if (currentTool !== 'MEASURE' && currentTool !== 'SPLINE') saveUndoState(); 
        }

        if(currentTool === 'MEASURE') {
            if(e.button === 0 && lastHitPoint) {
                measureStartPoint = lastHitPoint.clone();
                measureLines.visible = false; 
                document.getElementById('measure-hud').style.display = 'block';
                controls.enabled = false;
                isMeasuring = true;
            } else if (e.button === 2) {
                measureLines.visible = false;
                document.getElementById('measure-hud').style.display = 'none';
                measureStartPoint = null;
            }
        } else if(currentTool === 'SPLINE') {
            if(e.button === 0 && lastHitPoint) {
                splinePoints.push(lastHitPoint.clone());
                updateSplinePreview();
            } else if (e.button === 2 && splinePoints.length > 0) {
                splinePoints.pop();
                updateSplinePreview();
            }
            controls.enabled = false;
        } else if(currentTool === 'TEST_PUTT') {
            // Legacy handler — no longer reachable from UI
        } else if(currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP') {
            isSculpting = true;
            controls.enabled = false; 
            sculptDirection = (e.button === 2 || e.shiftKey || window.ipadSculptDir === -1) ? -1 : 1; 
            
            if (currentTool === 'RAMP' && lastHitPoint) {
                window.rampStartPt = lastHitPoint.clone();
                window.rampSnapshotHeights = new Float32Array(planeGeo.attributes.position.array);
            }
            
            if (currentTool === 'WATER' && lastHitPoint) {
                let gx = Math.round((lastHitPoint.x + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
                let gz = Math.round((lastHitPoint.z + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
                if(gx < 0) gx = 0; if(gx > TERRAIN_SEGS) gx = TERRAIN_SEGS;
                if(gz < 0) gz = 0; if(gz > TERRAIN_SEGS) gz = TERRAIN_SEGS;
                let idx = gz * (TERRAIN_SEGS+1) + gx;
                
                let existingWater = typeof waterGeo !== 'undefined' ? waterGeo.attributes.position.array[idx*3 + 2] : -99;
                
                if (existingWater > -90) {
                    waterLevelTarget = existingWater; 
                } else {
                    waterLevelTarget = lastHitPoint.y - 0.5; 
                }
            }
        } else {
            if(e.button === 0) onMouseClick(e);
            else if(e.button === 2) onRightClick(e);
        }
    }, false);

    let isMeasuring = false;

    renderer.domElement.addEventListener('pointerup', e => {
        if(typeof activeRotatingTee !== 'undefined' && activeRotatingTee) {
            activeRotatingTee = null;
            controls.enabled = true;
            saveLevel();
            return;
        }
        if(currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP' || currentTool === 'SPLINE') {
            isSculpting = false;
            controls.enabled = true; 
            if(currentTool !== 'PAINT') {
                planeGeo.computeVertexNormals(); 
                planeGeo.computeBoundingBox();
                planeGeo.computeBoundingSphere();
                snapObjectsToGround(); 
            }
        } else if(currentTool === 'MEASURE' && isMeasuring) {
            isMeasuring = false;
            controls.enabled = true; 
        }
    }, false);
    
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault(), false);
    
    function setMode(mode) {
        if ((appMode === 'BUILD' || appMode === 'ARCHITECT') && (mode === 'PLAY' || mode === 'TEST')) {
            if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
        }
        appMode = mode;
        let btnBuild = document.getElementById('btn-mode-build');
        let btnPlay = document.getElementById('btn-mode-play');

        if(btnBuild) {
            btnBuild.style.display = mode === 'TEST' ? 'block' : 'none';
            btnBuild.style.background = '#0f172a';
            btnBuild.style.color = '#38bdf8';
        }
        
        if (btnPlay) {
            btnPlay.style.display = (mode === 'TEST' || mode === 'PLAY') ? 'none' : 'block';
            btnPlay.innerHTML = '🔥 TESTA BANAN';
            btnPlay.onclick = () => setMode('TEST');
            btnPlay.style.background = '#0f172a';
            btnPlay.style.color = '#ef4444';
            btnPlay.style.borderColor = '#ef4444';
        }
        
        let lt = document.getElementById('left-toolbar'); if(lt) lt.style.display = mode === 'BUILD' ? 'grid' : 'none';
        let rt = document.getElementById('right-toolbar'); if(rt) rt.style.display = mode === 'BUILD' ? 'flex' : 'none';
        
        let tb = document.getElementById('top-bar'); if(tb) tb.style.display = mode === 'PLAY' ? 'none' : 'flex';
        
        // Unified Top Bar: Toggle build-only elements
        let assetBudget = document.getElementById('memory-budget-container');
        if(assetBudget) assetBudget.style.display = mode === 'BUILD' ? 'flex' : 'none';
        let biomeSelector = document.getElementById('biome-selector-container');
        if(biomeSelector) biomeSelector.style.display = mode === 'BUILD' ? 'flex' : 'none';

        
        let playControls = document.getElementById('play-controls');
        if (playControls) playControls.style.display = (mode === 'PLAY' || mode === 'TEST') ? 'flex' : 'none';
        
        let startBtn = document.getElementById('btn-start-round');
        if (startBtn) startBtn.style.display = mode === 'PLAY' ? 'block' : 'none';


        let dataBtn = document.getElementById('btn-toggle-data');
        if(dataBtn) dataBtn.style.display = mode === 'BUILD' ? 'none' : 'block';
        
        let manualTools = document.getElementById('manual-tools');
        if(manualTools) manualTools.style.display = 'flex';
        
        let dynHud = document.getElementById('dynamic-hud');
        if(dynHud) dynHud.style.display = mode === 'BUILD' ? 'none' : 'flex';
        
        let hamBtn = document.getElementById('hamburger-btn');
        if(hamBtn) hamBtn.style.display = mode === 'BUILD' ? 'none' : 'block';
        
        let toolHints = document.getElementById('tool-hints');
        if(toolHints) toolHints.style.display = mode === 'BUILD' ? 'block' : 'none';
        
        let hamburgerBtn = document.getElementById('btn-hamburger');
        if (hamburgerBtn) hamburgerBtn.style.display = mode === 'PLAY' ? 'none' : 'block';
        
        let pb = document.getElementById('player-banner');
        if (pb) pb.style.top = mode === 'PLAY' ? '20px' : '70px';
        
        if (mode === 'BUILD') {
            playState = 'BUILDING'; // Nollställ playState från tidigare test-rundor
            window.aimTarget = null; // Rensa eventuella gamla sikten
            
            controls.enabled = true;
            // Move camera up to look down a bit
            camera.position.set(0, 15, 10);
            controls.target.set(0, 0, -30);
            controls.update();
        } else if (mode === 'TEST') {
            // === COURSE VALIDATION GATE ===
            let validHole = courseHoles.find(h => h && h.flag && h.tees && (h.tees.yellow || h.tees.white || h.tees.red || h.tees.black));
            if (!validHole) {
                // Show inline toast instead of alert
                let toast = document.createElement('div');
                toast.innerHTML = '⚠️ Lägg till minst <b>1 hål</b> med <b>Tee</b> och <b>Flagga</b> för att testa!';
                toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:14px 28px;border-radius:12px;font-weight:bold;font-size:16px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);animation:fadeInUp 0.3s ease;';
                document.body.appendChild(toast);
                setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; }, 2500);
                setTimeout(() => toast.remove(), 3000);
                return; // Stay in BUILD mode
            }
            
            controls.enabled = true;
            ghostBlock.visible = false;
            playState = 'ROUND_IDLE';
            window.activePlayerId = 'tester';
            window.activePlayerIndex = 0; // BUG-08 FIX: Set activePlayerIndex
            window.players = [ { id: 'tester', name: 'TEST', color: '#ef4444', scoreOffset:0, holeScores:[], strokes:0, penaltyStrokes:0, isActive:true, scores: Array(18).fill(null), scoreVsPar: Array(18).fill(null), holedOut: false, prevPos: null } ];
            
            // BUG-06 FIX: Set pinMesh from current hole's flag
            let testHole = courseHoles[currentHoleIndex] || courseHoles[0];
            if (testHole && testHole.flagMesh) {
                window.pinMesh = testHole.flagMesh;
            }
            
            let tee = (courseHoles[0] && courseHoles[0].tees) ? (courseHoles[0].tees.yellow || courseHoles[0].tees.red) : null;
            if(tee) {
                window.ballPos.x = tee.x; window.ballPos.y = tee.y + 0.2; window.ballPos.z = tee.z;
                window.ballMesh.position.set(window.ballPos.x, window.ballPos.y, window.ballPos.z);
                window.ballMesh.visible = true;
                camera.position.set(window.ballPos.x, window.ballPos.y + 2, window.ballPos.z + 10);
                controls.target.set(window.ballPos.x, window.ballPos.y, window.ballPos.z - 20);
                controls.update();
            }
        } else {
            // PLAY MODE
            controls.enabled = true; // Tillåt zoom och rotering!
            ghostBlock.visible = false;
            
            // Default vy från tee mot banan
            camera.position.set(0, 4, 10); 
            controls.target.set(0, 0, -20);
            controls.update();
        }
    }
    
    function snapObjectsToGround() {
        let downRay = new THREE.Raycaster();
        let downDir = new THREE.Vector3(0, -1, 0);
        
        function getH(x, z) {
            downRay.set(new THREE.Vector3(x, 200, z), downDir);
            let hits = downRay.intersectObject(plane);
            return hits.length > 0 ? hits[0].point.y : 0;
        }

        if(window.placedTrees) {
            let poolsDirty = new Set();
            for(let t of window.placedTrees) {
                let newY = getH(t.x, t.z);
                if (Math.abs((t.y||0) - newY) > 0.01) { t.y = newY; poolsDirty.add(t.type); }
            }
            poolsDirty.forEach(type => rebuildInstancePool(type));
        }
        for(let h of courseHoles) {
            for(let key in h.tees) {
                if(h.teeMeshes[key] && h.tees[key]) {
                    h.tees[key].y = getH(h.tees[key].x, h.tees[key].z);
                    h.teeMeshes[key].position.y = h.tees[key].y; 
                }
            }
            if(h.flagMesh && h.flag) {
                h.flag.y = getH(h.flag.x, h.flag.z);
                h.flagMesh.position.y = h.flag.y;
            }
        }
    }

    window.greenDifficulty = 'FLAT';
    function setGreenDiff(diff) {
        window.greenDifficulty = diff;
        document.getElementById('green-btn-flat').style.background = diff === 'FLAT' ? '#fbbf24' : '#334155';
        document.getElementById('green-btn-flat').style.color = diff === 'FLAT' ? '#0f172a' : '#94a3b8';
        document.getElementById('green-btn-easy').style.background = diff === 'EASY' ? '#fbbf24' : '#334155';
        document.getElementById('green-btn-easy').style.color = diff === 'EASY' ? '#0f172a' : '#94a3b8';
        document.getElementById('green-btn-med').style.background = diff === 'MED' ? '#fbbf24' : '#334155';
        document.getElementById('green-btn-med').style.color = diff === 'MED' ? '#0f172a' : '#94a3b8';
        // BUG-02 FIX: green-btn-hard safely handled (element may not exist)
        let hardBtn = document.getElementById('green-btn-hard');
        if (hardBtn) {
            hardBtn.style.background = diff === 'HARD' ? '#fbbf24' : '#334155';
            hardBtn.style.color = diff === 'HARD' ? '#0f172a' : '#94a3b8';
        }
    }

    function setTool(toolName) {
        currentTool = toolName;
        
        let tools = ['inspect', 'sculpt', 'smooth', 'flatten', 'ramp', 'noise', 'water', 'spline', 'paint', 'smartgreen', 'testputt', 'ridge', 'nature', 'forest', 'block', 'hole', 'measure', 'eraser', 'colorize'];
        
        tools.forEach(t => {
            let btn = document.getElementById('tool-' + t);
            if(btn) {
                if(t === 'testputt') btn.className = 'sys-btn'; // Bevara top-bar styling
                else btn.className = '';
            }
        });
        
        let activeBtn = document.getElementById('tool-' + toolName.toLowerCase().replace('_',''));
        if (activeBtn) {
            if (toolName === 'SMART_GREEN') activeBtn.className = 'active-green';
            else if (toolName === 'MEASURE') activeBtn.className = 'active-yellow';
            else if (toolName === 'TEST_PUTT') activeBtn.className = 'sys-btn active';
            else if (toolName === 'ERASER') activeBtn.className = 'active-red';
            else activeBtn.className = 'active';
        }
        
        document.getElementById('color-picker-group').style.display = (toolName === 'BLOCK' || toolName === 'PAINT') ? 'flex' : 'none';
        document.getElementById('nature-picker-group').style.display = (toolName === 'NATURE') ? 'flex' : 'none';
        document.getElementById('hole-picker-group').style.display = (toolName === 'HOLE') ? 'flex' : 'none';
        document.getElementById('colorize-picker-group').style.display = (toolName === 'COLORIZE') ? 'flex' : 'none';
        document.getElementById('putt-settings-group').style.display = (toolName === 'TEST_PUTT') ? 'flex' : 'none';
        document.getElementById('sculpt-settings-group').style.display = (toolName === 'SCULPT' || toolName === 'SMOOTH' || toolName === 'FLATTEN' || toolName === 'PAINT' || toolName === 'WATER' || toolName === 'SMART_GREEN' || toolName === 'RIDGE') ? 'flex' : 'none';
        document.getElementById('green-diff-group').style.display = (toolName === 'SMART_GREEN') ? 'flex' : 'none';
        
        let ipadBtn = document.getElementById('ipad-sculpt-btn');
        if (ipadBtn) {
            ipadBtn.style.display = (toolName === 'SCULPT' || toolName === 'RIDGE') ? 'block' : 'none';
        }
        
        // Uppdatera markörens färg beroende på verktyg bygger på samma basfärger
        if(toolName === 'SMOOTH') {
            sculptBrushCursor.material.color.setHex(0xa855f7); // Lila
        } else if(toolName === 'FLATTEN') {
            sculptBrushCursor.material.color.setHex(0xffffff); // Vit
        } else if(toolName === 'SCULPT') {
            sculptBrushCursor.material.color.setHex(0x38bdf8); // Blå
        } else if(toolName === 'SMART_GREEN') {
            sculptBrushCursor.material.color.setHex(0xffffff); // Stark Vit för max kontrast på grönt gräs
        } else if(toolName === 'RIDGE') {
            sculptBrushCursor.material.color.setHex(0xfbbf24); // Guld
        } else if(toolName === 'PAINT') {
            sculptBrushCursor.material.color.setHex(currentBuildColor);
        } else if(toolName === 'WATER') {
            sculptBrushCursor.material.color.setHex(0x38bdf8); // Blå
        } else if(toolName === 'RAMP') {
            sculptBrushCursor.material.color.setHex(0x38bdf8); // Light Blue for Ramp
        } else if(toolName === 'SPLINE') {
            sculptBrushCursor.material.color.setHex(0xec4899); // Rosa för Spline
        } else if(toolName === 'COLORIZE') {
            let hex = (window.activeColorizeColor || '#ffffff').replace('#', '0x');
            sculptBrushCursor.material.color.setHex(parseInt(hex));
        }
        
        let hintHtml = "";
        if (toolName === 'INSPECT') hintHtml = "<b>Safe Mode</b>: Look around without modifying terrain";
        else if (toolName === 'BLOCK') hintHtml = "Left Click: <b>Build Block</b><br>Right Click: <b>Remove</b>";
        else if (toolName === 'NATURE') hintHtml = "Left Click: <b>Plant Nature</b><br>Right Click: <b>Remove Tree</b>";
        else if (toolName === 'SCULPT') hintHtml = "Hold Left: <b>Raise Ground</b><br>Hold Right: <b>Lower Ground</b>";
        else if (toolName === 'SMOOTH') hintHtml = "Hold Mouse: <b>Smooth Terrain</b>";
        else if (toolName === 'FLATTEN') hintHtml = "Hold Mouse: <b>Flatten Surface</b>";
        else if (toolName === 'PAINT') hintHtml = "Hold Mouse: <b>Paint Biome</b>";
        else if (toolName === 'WATER') hintHtml = "Hold Mouse: <b>Dig Water</b>";
        else if (toolName === 'SMART_GREEN') hintHtml = "Hold Mouse: <b>Paint Green & Flatten to safe plateau</b>";
        else if (toolName === 'TEST_PUTT') hintHtml = "Left Click: <b>Drop Ball & Test Putt</b>";
        else if (toolName === 'RIDGE') hintHtml = "Hold Mouse: <b>Draw a Tier/Ridge line across the green</b>";
        else if (toolName === 'MEASURE') hintHtml = "Left Drag: <b>Measure Box</b><br>Right Click: <b>Clear Box</b>";
        else if (toolName === 'ERASER') hintHtml = "Left Click: <b>Remove any object</b> (trees, rocks, blocks)";
        else if (toolName === 'COLORIZE') hintHtml = "Left Click/Drag: <b>Paint object with selected color</b>";
        else if (toolName === 'HOLE') hintHtml = "Left Click: <b>Place Selected Marker</b>";
        
        document.getElementById('tool-hints').innerHTML = hintHtml;
        
        ghostBlock.visible = false;
        sculptBrushCursor.visible = false;
        ghostTree.visible = false;
        if(toolName !== 'MEASURE') {
            document.getElementById('measure-hud').style.display = 'none';
            if(typeof measureLines !== 'undefined') measureLines.visible = false;
        }
        if(toolName !== 'SPLINE') {
            let pnl = document.getElementById('spline-action-panel');
            if(pnl) pnl.style.display = 'none';
            if(typeof window.clearSpline === 'function') window.clearSpline();
        }
    }

    // Anropas när Stimp-reglaget i TEST_PUTT ändras
    function updateStimp(val) {
        document.getElementById('stimp-val').innerText = parseFloat(val).toFixed(1);
        window.GREEN_STIMP = parseFloat(val);
        if(typeof window.greenBeads !== 'undefined') {
            if(typeof greenBeadsGroup !== 'undefined') {
                window.greenBeads.forEach(b => greenBeadsGroup.remove(b));
            }
            window.greenBeads = [];
        }
    }

    window.setPaletteColor = function(type, btnEl) {
        let hexStr = window.CURRENT_BIOME_CONFIG[type + 'Color'] || '#ffffff';
        let hexCol = parseInt(hexStr.replace('#', '0x'));
        setBlockColor(hexCol, btnEl);
    };

    function setBlockColor(hexCol, btnEl) {
        currentBuildColor = hexCol;
        ghostBlock.material.color.setHex(hexCol);
        if(currentTool === 'PAINT') {
            sculptBrushCursor.material.color.setHex(hexCol);
        }
        
        // Update UI
        var btns = document.querySelectorAll('.palette-btn');
        btns.forEach(b => b.classList.remove('active'));
        if(btnEl) btnEl.classList.add('active');
    }

    let currentNatureType = 'RANDOM';
    
    window.setNatureType = function(type, btnEl) {
        currentNatureType = type;
        var btns = document.getElementById('nature-picker-group').querySelectorAll('.palette-btn');
        btns.forEach(b => b.classList.remove('active'));
        if(btnEl) btnEl.classList.add('active');
    };

    function clearMyBlocks() {
        document.getElementById('confirm-modal').style.display = 'flex';
    }
    
    function closeConfirmModal() {
        document.getElementById('confirm-modal').style.display = 'none';
    }
    
    function executeClear() {
        targets.forEach(t => scene.remove(t.mesh));
        targets.length = 0;
        
        if(window.placedTrees) {
            window.placedTrees.length = 0;
            destroyAllPools();
        }
        
        // BUG-05 FIX: Use modern teeMeshes/tees structure
        for(let i=0; i<18; i++) {
            let h = courseHoles[i];
            for(let key in h.teeMeshes) {
                if(h.teeMeshes[key]) { scene.remove(h.teeMeshes[key]); h.teeMeshes[key] = null; }
            }
            if(h.flagMesh) { scene.remove(h.flagMesh); h.flagMesh = null; }
            h.tees = { red: null, yellow: null, white: null, black: null };
            h.flag = null;
        }
        
        let pos = planeGeo.attributes.position;
        for(let i=0; i<pos.count; i++) { pos.setZ(i, 0); }
        pos.needsUpdate = true;
        planeGeo.computeVertexNormals();
        
        let wPos = waterGeo.attributes.position;
        for(let i=0; i<wPos.count; i++) { wPos.setZ(i, -2); }
        wPos.needsUpdate = true;
        
        pCtx.fillStyle = '#4a782b';
        pCtx.fillRect(0,0,4096,4096);
        mapTex.needsUpdate = true;
        
        wCtx.fillStyle = '#000000';
        wCtx.fillRect(0,0,4096,4096);
        waterTex.needsUpdate = true;
        
        saveLevel();
        closeConfirmModal();
    }
    
    function getIntersect() {
        raycaster.setFromCamera(mouse, camera);
        // Filtrera ut eventuella trasiga meshes
        let interactables = [plane];
        for(let i=0; i<targets.length; i++) {
            if(targets[i].mesh && targets[i].mesh.geometry) {
                interactables.push(targets[i].mesh);
            }
        }
        try {
            let intersects = raycaster.intersectObjects(interactables);
            return intersects.length > 0 ? intersects[0] : null;
        } catch(e) {
            console.error("Raycaster error", e);
            return null;
        }
    }
    
    let lastHitPoint = null;
    let activeRotatingTee = null;
    function onMouseMove(event) {
        if(appMode !== 'BUILD') return;
        event.preventDefault();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        if (activeRotatingTee && lastHitPoint) {
            let hole = courseHoles[currentHoleIndex];
            let teeGroup = hole.teeMeshes[activeRotatingTee];
            let teeData = hole.tees[activeRotatingTee];
            if(teeGroup && teeData) {
                raycaster.setFromCamera(mouse, camera);
                let intersects = raycaster.intersectObject(plane);
                if(intersects.length > 0) {
                    let p = intersects[0].point;
                    let dist = Math.hypot(p.x - teeData.x, p.z - teeData.z);
                    if(dist > 0.1) {
                        lastHitPoint = p;
                        teeGroup.lookAt(p.x, teeGroup.position.y, p.z);
                        teeData.rot = teeGroup.rotation.y;
                    }
                }
            }
            return;
        }
        
        if (currentTool === 'INSPECT') {
            ghostBlock.visible = false;
            ghostTree.visible = false;
            if (sculptBrushCursor) sculptBrushCursor.visible = false;
            if (typeof measureLines !== 'undefined') measureLines.visible = false;
            return;
        }

        if (currentTool === 'BLOCK') {
            sculptBrushCursor.visible = false;
            let hit = getIntersect();
            if(hit) {
                ghostBlock.visible = true;
                let rawX = hit.point.x;
                let rawZ = hit.point.z;
                let snapX = Math.round(rawX / 3) * 3;
                let snapZ = Math.round(rawZ / 3) * 3;
                if (hit.object === plane) {
                    ghostBlock.position.set(snapX, hit.point.y + 2, snapZ);
                } else {
                    ghostBlock.position.copy(hit.object.position);
                    ghostBlock.position.y += 4;
                }
            } else {
                ghostBlock.visible = false;
            }
        } else if (currentTool === 'NATURE') {
            ghostBlock.visible = false;
            sculptBrushCursor.visible = false;
            raycaster.setFromCamera(mouse, camera);
            let intersects = raycaster.intersectObject(plane);
            if (intersects.length > 0) {
                ghostTree.visible = true;
                ghostTree.position.copy(intersects[0].point);
                ghostTree.position.y += 1.0;
                lastHitPoint = intersects[0].point;
            } else {
                ghostTree.visible = false;
                lastHitPoint = null;
            }
        } else if (currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'MEASURE' || currentTool === 'HOLE' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP' || currentTool === 'SPLINE' || currentTool === 'COLORIZE') {
            ghostBlock.visible = false;
            ghostTree.visible = false;
            raycaster.setFromCamera(mouse, camera);
            let intersects = raycaster.intersectObject(plane);
            if(intersects.length > 0) {
                lastHitPoint = intersects[0].point;
                
                if (currentTool === 'COLORIZE' && event.buttons === 1) {
                    let closest = null; let minDist = 3.5;
                    for (let i = 0; i < window.placedTrees.length; i++) {
                        let t = window.placedTrees[i];
                        let d = Math.sqrt((t.x - lastHitPoint.x)**2 + (t.z - lastHitPoint.z)**2);
                        if (d < minDist) { minDist = d; closest = i; }
                    }
                    if (closest !== null) {
                        let col = window.activeColorizeColor || '#ffffff';
                        let tCol = window.activeTrunkColor || '#ffffff';
                        if (window.placedTrees[closest].color !== col || window.placedTrees[closest].trunkColor !== tCol) {
                            window.placedTrees[closest].color = col;
                            window.placedTrees[closest].trunkColor = tCol;
                            rebuildInstancePool(window.placedTrees[closest].type);
                        }
                    }
                }
                
                if(currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP' || currentTool === 'SPLINE' || currentTool === 'COLORIZE') {
                    sculptBrushCursor.visible = true;
                    sculptBrushCursor.position.copy(lastHitPoint);
                    sculptBrushCursor.position.y += 0.5;
                } else {
                    sculptBrushCursor.visible = false;
                    
                    if(currentTool === 'MEASURE' && isMeasuring && measureStartPoint) {
                        let p1 = measureStartPoint;
                        let p2 = lastHitPoint;
                        let w = Math.abs(p2.x - p1.x);
                        let l = Math.abs(p2.z - p1.z);
                        
                        document.getElementById('measure-hud').innerText = w.toFixed(1) + "m x " + l.toFixed(1) + "m";
                        
                        // Uppdatera mesh
                        let mPos = measureLines.geometry.attributes.position.array;
                        let y = Math.max(p1.y, p2.y) + 1.0; // Flyt lite ovanför
                        mPos[0] = p1.x; mPos[1] = y; mPos[2] = p1.z;
                        mPos[3] = p2.x; mPos[4] = y; mPos[5] = p1.z;
                        mPos[6] = p2.x; mPos[7] = y; mPos[8] = p2.z;
                        mPos[9] = p1.x; mPos[10]= y; mPos[11]= p2.z;
                        mPos[12]= p1.x; mPos[13]= y; mPos[14]= p1.z;
                        
                        measureLines.geometry.attributes.position.needsUpdate = true;
                        measureLines.visible = true;
                    }
                }
            } else {
                sculptBrushCursor.visible = false;
                lastHitPoint = null;
            }
        }
    }
    
    function onMouseClick(event) {
        if(appMode !== 'BUILD') return;
        
        if (currentTool === 'HOLE' && lastHitPoint) {
            let hole = courseHoles[currentHoleIndex];
            if (currentHoleAction.startsWith('TEE_')) {
                let teeType = currentHoleAction.replace('TEE_', '').toLowerCase();
                if (hole.teeMeshes[teeType]) scene.remove(hole.teeMeshes[teeType]);
                hole.tees[teeType] = { x: lastHitPoint.x, y: lastHitPoint.y, z: lastHitPoint.z, rot: 0 };
                
                let col = 0xffffff;
                if(teeType === 'red') col = 0xef4444;
                if(teeType === 'yellow') col = 0xfacc15;
                if(teeType === 'black') col = 0x111111;
                
                hole.teeMeshes[teeType] = createTeeObject(hole.tees[teeType].x, hole.tees[teeType].y, hole.tees[teeType].z, col);
                
                activeRotatingTee = teeType;
                controls.enabled = false;
                return;
            } else if (currentHoleAction === 'FLAG') {
                if (hole.flagMesh) scene.remove(hole.flagMesh);
                hole.flag = { x: lastHitPoint.x, y: lastHitPoint.y, z: lastHitPoint.z };
                hole.flagMesh = createFlagObject(hole.flag.x, hole.flag.y, hole.flag.z);
            } else if (currentHoleAction === 'TARGET') {
                if (hole.flagMesh) scene.remove(hole.flagMesh);
                hole.flag = { x: lastHitPoint.x, y: lastHitPoint.y, z: lastHitPoint.z, isTarget: true };
                hole.flagMesh = createTargetObject(hole.flag.x, hole.flag.y, hole.flag.z);
            }
            saveLevel();
            return;
        }
        
        if (currentTool === 'NATURE' && lastHitPoint) {
            let selectedType = currentNatureType;
            if (currentNatureType === 'RANDOM') {
                let types = ['TREE', 'BUSH', 'PALM', 'OAK', 'OAK2', 'PINE', 'ROCK', 'CACTUS'];
                selectedType = types[Math.floor(Math.random() * types.length)];
            }
            let s = 1.0 + (Math.random() * 0.4 - 0.2); // 0.8 till 1.2 x storlek
            
            // Extrema storleksvariationer baserat på typ!
            if (selectedType === 'OAK' || selectedType === 'OAK2') s *= 1.8; // Ek-träd blir jättelika
            else if (selectedType === 'ROCK') s *= (0.3 + Math.random() * 1.5); // Små stenar till stora flyttblock
            else if (selectedType === 'BUSH') s *= (0.4 + Math.random() * 1.5); // Småbuskar och enorma buskar
            else if (selectedType === 'CACTUS') s *= (0.6 + Math.random() * 0.8);

            let r = Math.random() * Math.PI * 2;
            createTree(selectedType, lastHitPoint.x, lastHitPoint.z, s, r);
            return;
        }

        if(currentTool === 'BLOCK' && ghostBlock.visible) {
            createTargetAbsolute(ghostBlock.position.x, ghostBlock.position.y, ghostBlock.position.z, currentBuildColor);
        }
    }
    
    function onRightClick(event) {
        if(appMode !== 'BUILD') return;
        event.preventDefault(); // Stoppa webbläsarens högerklicksmeny!
        
        if (currentTool === 'NATURE' && lastHitPoint) {
            let closest = null; let minDist = 3.5; 
            for(let i=0; i<window.placedTrees.length; i++) {
                let t = window.placedTrees[i];
                let d = Math.sqrt((t.x - lastHitPoint.x)**2 + (t.z - lastHitPoint.z)**2);
                if (d < minDist) { minDist = d; closest = i; }
            }
            if (closest !== null) {
                let removedType = window.placedTrees[closest].type;
                window.placedTrees.splice(closest, 1);
                rebuildInstancePool(removedType);
            }
            return;
        }

        let hit = getIntersect();
        if(hit && hit.object !== plane) {
            scene.remove(hit.object);
            let idx = targets.findIndex(t => t.mesh === hit.object);
            if(idx !== -1) targets.splice(idx, 1);
            saveLevel();
            ghostBlock.visible = false;
        }
    }
    
    // --- WASD NAVIGERING FÖR BUILD-LÄGET & UNDO (Ctrl+Z) ---
    window.addEventListener('keydown', (e) => {
        if(appMode !== 'BUILD') return;
        
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            performUndo();
            return;
        }

        const panSpeed = 2.0;
        
        // Hämta kamerans riktningsvektor (framåt på X/Z)
        let dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0; // Vi låser den till markplanet
        dir.normalize();

        if (e.code === 'Space') {
            camera.position.set(camera.position.x, 250, camera.position.z);
            controls.target.set(camera.position.x, 0, camera.position.z - 1);
            controls.update();
            return;
        }

        if (e.key.toLowerCase() === 'w') {
            camera.position.addScaledVector(dir, panSpeed);
            controls.target.addScaledVector(dir, panSpeed);
        }
        if (e.key.toLowerCase() === 's') {
            camera.position.addScaledVector(dir, -panSpeed);
            controls.target.addScaledVector(dir, -panSpeed);
        }
        if (e.key.toLowerCase() === 'a') {
            let orbitSpeed = 0.05;
            let offset = new THREE.Vector3().subVectors(controls.target, camera.position);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbitSpeed);
            controls.target.copy(camera.position).add(offset);
        }
        if (e.key.toLowerCase() === 'd') {
            let orbitSpeed = 0.05;
            let offset = new THREE.Vector3().subVectors(controls.target, camera.position);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -orbitSpeed);
            controls.target.copy(camera.position).add(offset);
        }
        
        controls.update();
    });
    
    // --- MINIMAP CLICK TO AIM ---
    document.addEventListener('DOMContentLoaded', () => {
        const mmc = document.getElementById('minimap-container');
        if(mmc) {
            mmc.addEventListener('mousedown', (e) => {
                if ((appMode !== 'PLAY' && appMode !== 'TEST') || playState !== 'ROUND_IDLE') return;
                
                let rect = mmc.getBoundingClientRect();
                let x = e.clientX - rect.left;
                let y = e.clientY - rect.top;
                
                let nx = (x / rect.width) * 2 - 1;
                let ny = -(y / rect.height) * 2 + 1;
                
                let raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(new THREE.Vector2(nx, ny), minimapCamera);
                let hits = raycaster.intersectObject(plane);
                
                if (hits.length > 0) {
                    window.aimTarget.copy(hits[0].point);
                    // Rota kameran mot nya siktet
                    let aimDir = new THREE.Vector3().subVectors(window.aimTarget, window.ballMesh.position).normalize();
                    if (window.isPuttingMode) {
                        camera.position.copy(window.ballMesh.position).add(new THREE.Vector3(-aimDir.x * 2.5, 0.4, -aimDir.z * 2.5));
                    } else {
                        camera.position.copy(window.ballMesh.position).add(new THREE.Vector3(-aimDir.x * 5, 2, -aimDir.z * 5));
                    }
                    controls.target.copy(window.aimTarget);
                    controls.update();
                }
            });
        }
    });

    const targetPaintColor = new THREE.Color();
    let previousFrameHitPoint = null;
    
    // BUG-03 FIX: REMOVED the stripped duplicate of localGetTerrainAt that was
    // overwriting the full version (rad 1222-1297) which returns {z, normal, type}.
    // The full version at line 1222 is now the only active one, enabling
    // break-lines and green beads to work correctly.

    function updateSplinePreview() {
        // Rensa gamla sfärer och mesh
        splineSpheres.forEach(s => scene.remove(s));
        splineSpheres = [];
        if(splineLineMesh) { scene.remove(splineLineMesh); splineLineMesh = null; }

        let sMat = new THREE.MeshBasicMaterial({ color: 0xec4899 });
        let sGeo = new THREE.SphereGeometry(1.0, 8, 8);
        splinePoints.forEach(pt => {
            let s = new THREE.Mesh(sGeo, sMat);
            s.position.copy(pt);
            s.position.y += 0.5;
            scene.add(s);
            splineSpheres.push(s);
        });

        if(splinePoints.length > 1) {
            let pts = [...splinePoints];
            // Stänger INTE loopen grafiskt längre, så att öppna vägar ser korrekta ut i previewn!
            
            let curve = new THREE.CatmullRomCurve3(pts);
            let curvePts = curve.getPoints(50 * pts.length);
            let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
            let lineMat = new THREE.LineBasicMaterial({ color: 0xec4899, linewidth: 3 });
            splineLineMesh = new THREE.Line(lineGeo, lineMat);
            splineLineMesh.position.y += 0.5;
            scene.add(splineLineMesh);
        }

        let pnl = document.getElementById('spline-action-panel');
        if(pnl) pnl.style.display = splinePoints.length > 2 ? 'block' : 'none';
        renderer.render(scene, camera); // Force draw
    }

    window.clearSpline = function() {
        splinePoints = [];
        updateSplinePreview();
    };

    window.executeSplineBoundary = function(layerType) {
        if(splinePoints.length < 3) return;
        saveUndoState();
        
        pCtx.save();
        pCtx.beginPath();
        
        let curve = new THREE.CatmullRomCurve3([...splinePoints, splinePoints[0].clone()]);
        let densePts = curve.getPoints(splinePoints.length * 10);
        
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            if (i === 0) pCtx.moveTo(pxX, pxY);
            else pCtx.lineTo(pxX, pxY);
        });
        
        pCtx.closePath();
        
        if(layerType === 'GREEN') pCtx.fillStyle = '#98ce68';
        else if(layerType === 'FAIRWAY') pCtx.fillStyle = '#659c35';
        else if(layerType === 'BUNKER') pCtx.fillStyle = '#dcb871';
        
        pCtx.fill();
        pCtx.restore();
        
        mapTex.needsUpdate = true;
        clearSpline();
    };

    window.executeSplinePath = function(pathType) {
        if(splinePoints.length < 2) return;
        saveUndoState();
        
        let curve = new THREE.CatmullRomCurve3(splinePoints);
        let objType = pathType === 'TUBE' ? 'TUBE' : 'ROAD'; // ROAD = Flat
        let pMesh;
        
        if (pathType === 'TUBE') {
            // Skapa 3D Tube längs kurvan
            let densePts = curve.getPoints(splinePoints.length * 10);
            for(let pt of densePts) {
                let t = localGetTerrainAt(pt.x, -pt.z);
                if(t) pt.y = t.z + 1.0; // Lyft upp centrum något över marken
            }
            let groundCurve = new THREE.CatmullRomCurve3(densePts);
            let tubeGeo = new THREE.TubeGeometry(groundCurve, densePts.length, 1.5, 8, false);
            
            let color = new THREE.Color(0.2, 0.6, 0.8); // By default nice blue pipeline
            let tubeMat = new THREE.MeshLambertMaterial({ color: color });
            pMesh = new THREE.Mesh(tubeGeo, tubeMat);
            pMesh.castShadow = true;
            pMesh.receiveShadow = true;
            
        } else {
            // PLAT VÄG
            let densePts = curve.getPoints(splinePoints.length * 10);
            for(let pt of densePts) {
                let t = localGetTerrainAt(pt.x, -pt.z);
                if(t) pt.y = t.z + 0.15; // Snappa kurvan mot marken med offset
            }
            let groundCurve = new THREE.CatmullRomCurve3(densePts);
            
            let tubeGeo = new THREE.TubeGeometry(groundCurve, densePts.length, 2.5, 8, false);
            let roadMat = new THREE.MeshLambertMaterial({ color: 0x475569, side: THREE.DoubleSide });
            pMesh = new THREE.Mesh(tubeGeo, roadMat);
            
            // Platta till Mesh Y-skalan (skapar plat asfältsform istället för tub)
            pMesh.scale.y = 0.05; 
            pMesh.updateMatrix();
            pMesh.geometry.applyMatrix4(pMesh.matrix);
            pMesh.scale.set(1,1,1);
            pMesh.updateMatrix();
            pMesh.geometry.computeBoundingBox();
            pMesh.geometry.computeVertexNormals();
            pMesh.receiveShadow = true;
        }
        
        let rObj = {
            id: Math.random().toString(36).substr(2, 9),
            type: objType,
            mesh: pMesh,
            splineData: splinePoints.map(p => ({x:p.x, y:p.y, z:p.z}))
        };
        scene.add(pMesh);
        courseHoles[currentHoleIndex].envObjects.push(rObj);
        
        clearSpline();
    };

    function applySculpting() {
        if (!isSculpting || !lastHitPoint) {
            previousFrameHitPoint = null;
            return;
        }
        if (currentTool !== 'SCULPT' && currentTool !== 'SMOOTH' && currentTool !== 'FLATTEN' && currentTool !== 'PAINT' && currentTool !== 'WATER' && currentTool !== 'SMART_GREEN' && currentTool !== 'RIDGE' && currentTool !== 'NOISE' && currentTool !== 'FOREST' && currentTool !== 'RAMP') return;
        
        let positions = planeGeo.attributes.position.array;
        let count = planeGeo.attributes.position.count;
        let p1 = previousFrameHitPoint ? previousFrameHitPoint : lastHitPoint;
        let p2 = lastHitPoint;
        
        if (!previousFrameHitPoint) {
            window.sculptAnchorY = p2.y;
        }
        previousFrameHitPoint = lastHitPoint.clone();

        // -------------------------------------------------------------
        // RAMP-VERKTYGET (Spikrak sluttning mellan Start och Target)
        // -------------------------------------------------------------
        if (currentTool === 'RAMP') {
            if (!window.rampStartPt || !window.rampSnapshotHeights) return;
            let A = window.rampStartPt;
            let B = p2;
            let R = currentBrushSize;
            
            // Beräkna en rimlig Bounding Box för att spara FPS
            let minX = Math.min(A.x, B.x) - R;
            let maxX = Math.max(A.x, B.x) + R;
            let minZ = Math.min(A.z, B.z) - R;
            let maxZ = Math.max(A.z, B.z) + R;
            
            let gxMin = Math.max(0, Math.floor((minX + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS)));
            let gxMax = Math.min(TERRAIN_SEGS, Math.ceil((maxX + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS)));
            let gzMin = Math.max(0, Math.floor((minZ + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS)));
            let gzMax = Math.min(TERRAIN_SEGS, Math.ceil((maxZ + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS)));
            
            let updatePos = false;
            let l2 = (A.x - B.x)*(A.x - B.x) + (A.z - B.z)*(A.z - B.z);
            
            for (let z = gzMin; z <= gzMax; z++) {
                for (let x = gxMin; x <= gxMax; x++) {
                    let idx = z * (TERRAIN_SEGS+1) + x;
                    
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+2]; // VIKTIGT: Z är negativ i position array jämfört med world.
                    // Wait, in previous code: vz = -positions[i*3 + 1] ? NO.
                    // Let's look at smooth tool: let vz = -positions[i*3 + 1]; BUT IT IS A ROTATED PLANE.
                    // Actually, let's use the local plane coordinates.
                    // Local plane X maps to world X. Local plane Y maps to world Z (because it's rotated -90 on X).
                    let lx = positions[idx*3];
                    let ly = positions[idx*3+1]; // Local Y is World Z length-wise. But it's negative? 
                    // Let's use the standard distance calculation matched by other tools
                    let wX = lx;
                    let wZ = -ly; // Because rotation.x = -PI/2
                    
                    let t = 0;
                    if (l2 !== 0) {
                        t = ((wX - A.x) * (B.x - A.x) + (wZ - A.z) * (B.z - A.z)) / l2;
                        t = Math.max(0, Math.min(1, t));
                    }
                    
                    let projX = A.x + t * (B.x - A.x);
                    let projZ = A.z + t * (B.z - A.z);
                    
                    let dist = Math.sqrt((wX - projX)*(wX - projX) + (wZ - projZ)*(wZ - projZ));
                    
                    if (dist < R) {
                        let targetY = A.y + t * (B.y - A.y);
                        
                        // Smoothstep falloff för runda kanter mot originalterrängen
                        let norm = dist / R;
                        let falloff = 1.0 - norm;
                        falloff = Math.max(0, falloff * falloff * (3 - 2 * falloff)); // Smoothstep
                        
                        let origY = window.rampSnapshotHeights[idx*3+2]; // Original World Y is in local Z position (idx*3+2)
                        
                        positions[idx*3+2] = origY + (targetY - origY) * falloff;
                        updatePos = true;
                    }
                }
            }
            if (updatePos) planeGeo.attributes.position.needsUpdate = true;
            return; // RAMP gör allt den behöver här, skippa vanliga borr-loopen.
        }
        // -------------------------------------------------------------

        let radius = currentTool === 'FLATTEN' ? currentBrushSize * 1.5 : currentBrushSize;
        let strength = 0.02 * sculptDirection; 
        
        let updatePos = false;
        
        if (currentTool === 'PAINT') targetPaintColor.setHex(currentBuildColor);
        
        // Omdirigera ritandet direkt till Canvas för skarp grafik
        // Omdirigera ritandet direkt till Canvas för skarp grafik (TILLÄGG: Water ritar inte längre på pCtx)
        if (currentTool === 'PAINT' || currentTool === 'SMART_GREEN') {
            let pCtx1X = ((p1.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pCtx1Z = ((p1.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pCtx2X = ((p2.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pCtx2Z = ((p2.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let cRad = (radius / TERRAIN_SIZE) * 4096;
            
            pCtx.globalCompositeOperation = 'source-over'; 
            pCtx.lineCap = 'round';
            pCtx.lineJoin = 'round';
            
            if (currentTool === 'SMART_GREEN') {
                // Steg 1: Skippar automatiskt Foregreen (användare kan måla det manuellt med Paint -> Fairway färg)
                
                
                // Steg 2: Putting Green Yta i mitten
                pCtx.strokeStyle = '#98ce68';
                pCtx.fillStyle = '#98ce68';
                pCtx.lineWidth = cRad * 2;
                pCtx.beginPath();
                if (p1.distanceTo(p2) < 0.1) {
                    pCtx.arc(pCtx2X, pCtx2Z, cRad, 0, Math.PI*2);
                    pCtx.fill();
                } else {
                    pCtx.moveTo(pCtx1X, pCtx1Z);
                    pCtx.lineTo(pCtx2X, pCtx2Z);
                    pCtx.stroke();
                }
            } else {
                let brushColor = '#' + targetPaintColor.getHexString();
                let hardness = window.currentBrushHardness !== undefined ? window.currentBrushHardness : 1.0;
                
                if (hardness < 1.0) {
                    pCtx.shadowBlur = cRad * (1.0 - hardness) * 2;
                    pCtx.shadowColor = brushColor;
                } else {
                    pCtx.shadowBlur = 0;
                }
                
                pCtx.strokeStyle = brushColor;
                pCtx.fillStyle = brushColor;
                pCtx.lineWidth = cRad * 2;
                
                pCtx.beginPath();
                if (p1.distanceTo(p2) < 0.1) {
                    pCtx.arc(pCtx2X, pCtx2Z, cRad, 0, Math.PI*2);
                    pCtx.fill();
                } else {
                    pCtx.moveTo(pCtx1X, pCtx1Z);
                    pCtx.lineTo(pCtx2X, pCtx2Z);
                    pCtx.stroke();
                }
                pCtx.shadowBlur = 0; // Reset
            }
            if(mapTex) mapTex.needsUpdate = true;
        }
        // ALPHA MASK FOR WATER 
        if (currentTool === 'WATER') {
            let pCtx1X = ((p1.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pCtx1Z = ((p1.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pCtx2X = ((p2.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pCtx2Z = ((p2.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let cRad = (radius / TERRAIN_SIZE) * 4096;

            wCtx.globalCompositeOperation = 'source-over';
            wCtx.strokeStyle = '#ffffff';
            wCtx.fillStyle = '#ffffff';
            wCtx.lineWidth = cRad * 2;
            wCtx.lineCap = 'round';
            wCtx.lineJoin = 'round';
            wCtx.beginPath();
            if (p1.distanceTo(p2) < 0.1) {
                wCtx.arc(pCtx2X, pCtx2Z, cRad, 0, Math.PI*2);
                wCtx.fill();
            } else {
                wCtx.moveTo(pCtx1X, pCtx1Z);
                wCtx.lineTo(pCtx2X, pCtx2Z);
                wCtx.stroke();
            }
            if(waterTex) waterTex.needsUpdate = true;
        }
        
        if (currentTool === 'PAINT') return; // Vi skulpterar inga höjder vid ren målning!
        
        let l2 = (p1.x - p2.x)*(p1.x - p2.x) + (p1.z - p2.z)*(p1.z - p2.z);
        
        let wPosArray = waterGeo ? waterGeo.attributes.position.array : null;

        let smoothAvg = 0;
        let smoothCount = 0;
        if (currentTool === 'SMOOTH') {
            for(let i = 0; i < count; i++) {
                let vx = positions[i*3];
                let vz = -positions[i*3 + 1]; 
                let d = 0;
                if (l2 === 0) {
                    d = Math.sqrt((vx - p1.x)*(vx - p1.x) + (vz - p1.z)*(vz - p1.z));
                } else {
                    let t = Math.max(0, Math.min(1, ((vx - p1.x) * (p2.x - p1.x) + (vz - p1.z) * (p2.z - p1.z)) / l2));
                    let pX = p1.x + t * (p2.x - p1.x);
                    let pZ = p1.z + t * (p2.z - p1.z);
                    d = Math.sqrt((vx - pX)*(vx - pX) + (vz - pZ)*(vz - pZ));
                }
                if (d < radius) {
                    smoothAvg += positions[i*3 + 2];
                    smoothCount++;
                }
            }
            if (smoothCount > 0) smoothAvg /= smoothCount;
        }

        for(let i = 0; i < count; i++) {
            let vx = positions[i*3];
            let vz = -positions[i*3 + 1]; 
            
            let dist = 0;
            if (l2 === 0) {
                dist = Math.sqrt((vx - p1.x)*(vx - p1.x) + (vz - p1.z)*(vz - p1.z));
            } else {
                let t = Math.max(0, Math.min(1, ((vx - p1.x) * (p2.x - p1.x) + (vz - p1.z) * (p2.z - p1.z)) / l2));
                let projX = p1.x + t * (p2.x - p1.x);
                let projZ = p1.z + t * (p2.z - p1.z);
                dist = Math.sqrt((vx - projX)*(vx - projX) + (vz - projZ)*(vz - projZ));
            }
            
            if (dist < radius) {
                let falloff = Math.cos((dist/radius) * (Math.PI/2));
                
                if (currentTool === 'SCULPT') {
                    positions[i*3 + 2] += strength * falloff;
                    updatePos = true;
                } else if (currentTool === 'SMOOTH') {
                    positions[i*3 + 2] += (smoothAvg - positions[i*3 + 2]) * 0.15 * brushMultiplier * falloff;
                    updatePos = true;
                } else if (currentTool === 'NOISE') {
                    // Genererar en organisk procedur-baserad vågform som agerar links/dune-bumpy terrain
                    let noise = Math.sin(vx * 1.5) * Math.cos(vz * 1.5) * 0.5 + Math.sin(vx * 0.4 + vz * 0.8) * 0.8;
                    // Kombinera en grundlyft/sänkning med starkt noise
                    let targetH = positions[i*3 + 2] + (strength * 0.8) + (noise * 0.3 * Math.sign(strength));
                    positions[i*3 + 2] += (targetH - positions[i*3 + 2]) * 0.1 * falloff;
                    updatePos = true;
                } else if (currentTool === 'FOREST') {
                    if (!window.lastForestDropTime) window.lastForestDropTime = 0;
                    let now = performance.now();
                    // Släpp var X millisekund baserat på hur liten brushen är
                    let dropRate = 80; 
                    if (now - window.lastForestDropTime > dropRate) {
                        window.lastForestDropTime = now;
                        let angle = Math.random() * Math.PI * 2;
                        let rad = Math.random() * radius * 0.8;
                        let randX = p2.x + Math.cos(angle) * rad;
                        let randZ = p2.z + Math.sin(angle) * rad;
                        
                        let types = ['TREE', 'PINE', 'OAK', 'OAK2', 'BUSH', 'ROCK'];
                        let type = types[Math.floor(Math.random() * types.length)];
                        
                        let s = 1.0 + (Math.random() * 0.4 - 0.2); 
                        if (type === 'OAK') s *= 1.8;
                        else if (type === 'ROCK') s *= (0.3 + Math.random() * 1.5);
                        else if (type === 'BUSH') s *= (0.4 + Math.random() * 1.5);
                        
                        let rRot = Math.random() * Math.PI * 2;
                        createTree(type, randX, randZ, s, rRot);
                    }
                } else if (currentTool === 'FLATTEN') {
                    // Mjukutjämning mot just den höjden man klickade på! Perfekt för platåer och upphöjda greener.
                    positions[i*3 + 2] += (p1.y - positions[i*3 + 2]) * 0.2 * falloff;
                    updatePos = true;
                } else if (currentTool === 'SMART_GREEN') {
                    // Starta från absolut mark-ankare för kontinuerlig procedur-målning
                    let baseH = (typeof window.sculptAnchorY !== 'undefined' && window.sculptAnchorY !== null) ? window.sculptAnchorY : p1.y;
                    let targetHeight = baseH;
                    
                    if (window.greenDifficulty === 'EASY') {
                        targetHeight += Math.sin(vx * 0.1) * Math.cos(vz * 0.1) * 0.15;
                    } else if (window.greenDifficulty === 'MED') {
                        targetHeight += Math.sin(vx * 0.15) * Math.cos(vz * 0.15) * 0.3;
                        targetHeight += (vx * 0.015); // Svagt makro-sluttning
                    } else if (window.greenDifficulty === 'HARD') {
                        targetHeight += Math.sin(vx * 0.2) * Math.cos(vz * 0.15) * 0.45 
                                      + Math.sin(vz * 0.4) * 0.15;
                    }

                    // Tvinga proceduren till säker maxlutning lokalt ifall terrängen var stökig
                    let hDiff = positions[i*3 + 2] - targetHeight; 
                    let maxSlope = dist * 0.04; // Något högre ~4% säkerhetsmarginal för contour Greens
                    let clampedHeight = targetHeight + Math.sign(hDiff) * Math.min(Math.abs(hDiff), maxSlope);
                    
                    // Applicera en blending under brushen mot den processuella platån
                    positions[i*3 + 2] += (clampedHeight - positions[i*3 + 2]) * 0.3 * falloff;
                    updatePos = true;
                } else if (currentTool === 'RIDGE') {
                    // Vektor-kalkyl tvärs över mus-dragriktningen p1 -> p2
                    let dX = p2.x - p1.x;
                    let dZ = p2.z - p1.z;
                    let len = Math.sqrt(dX*dX + dZ*dZ + 1e-6);
                    if (len > 0.001) {
                        let nX = -dZ / len;
                        let nZ = dX / len;
                        
                        // Dot Product för avstånd till centrumlinje med tecken (+/-) avgör vilken sida
                        let dotDiff = (vx - p2.x)*nX + (vz - p2.z)*nZ;
                        let side = Math.sign(dotDiff);
                        let distToLine = Math.abs(dotDiff);
                        
                        // Bygg en skarp spine/ridge
                        // Maximal höjdeffekt en bit bort från centrum (distToLine / 1.5)
                        let ridgeProfile = Math.min(distToLine / 1.5, 1.0);
                        
                        // Pusha upp ena sidan, ner andra + sculptDirection ger möjlighet att byta håll
                        positions[i*3 + 2] += side * (0.05 * sculptDirection) * ridgeProfile * falloff;
                        updatePos = true;
                    }
                } else if (currentTool === 'WATER') {
                    // Botten faller successivt men vattnet står spikrakt!
                    let bottomTarget = waterLevelTarget - 0.7; // Gräv en grop 0.7 under vattenytan
                    
                    // Skulptera terrängen (Mjuka slänter in i sjön)
                    positions[i*3 + 2] += (bottomTarget - positions[i*3 + 2]) * 0.2 * falloff;
                    
                    // Skulptera WATER-MESHEN till EXAKT vattenLevelTarget
                    if (wPosArray) {
                        wPosArray[i*3 + 2] = waterLevelTarget; 
                        window.waterBaseZ[i] = waterLevelTarget;
                        waterGeo.attributes.position.needsUpdate = true;
                    }
                    
                    updatePos = true;
                }
            }
        }
        if (updatePos) planeGeo.attributes.position.needsUpdate = true;
    }

    // --- ANIMATION LOOP ---
    function animate() {
        requestAnimationFrame(animate);
        animateStars(); // Star twinkle
        
        // Panning movement (WASD)
        if(moveDir) {
            // Farten justeras magiskt efter höjden! (Mer höjd = Snabbare kamera)
            let altOffset = Math.max(0, camera.position.y - 10); // Ingen boost under 10m
            let speed = 0.4 + (altOffset * 0.03); // Max speed limit
            if (speed > 15.0) speed = 15.0; // Sätt gräns så man inte flyger ut i oändligheten
            
            let forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            forward.y = 0;
            if(forward.lengthSq() > 0) forward.normalize();
            else forward.set(0,0,-1); // Fallback
            
            let right = new THREE.Vector3();
            right.crossVectors(forward, camera.up).normalize();
            
            let shift = new THREE.Vector3();
            if(moveDir === 'W') shift.copy(forward).multiplyScalar(speed);
            else if(moveDir === 'S') shift.copy(forward).multiplyScalar(-speed);
            else if(moveDir === 'A') shift.copy(right).multiplyScalar(-speed);
            else if(moveDir === 'D') shift.copy(right).multiplyScalar(speed);
            
            controls.target.add(shift);
            camera.position.add(shift);
        }
        
        controls.update();

        // --- GREEN BEADS + GRID VISUALIZATION (Trackman/GSPro style) ---
        // Activate when ball is within 50 yards of flag (not just putting mode)
        let showGreenViz = false;
        let vizHole = courseHoles[playingHoleIndex];
        if (vizHole && vizHole.flag && playState === 'ROUND_IDLE' && window.ballPos) {
            let dx = window.ballPos.x - vizHole.flag.x;
            let dz = window.ballPos.z - vizHole.flag.z;
            let distToFlag = Math.sqrt(dx*dx + dz*dz);
            showGreenViz = distToFlag < BEAD_ACTIVATION_DISTANCE;
        }
        
        if (showGreenViz) {
            let hole = vizHole;
            
            // --- BEADS (toggle: window.greenBeadsEnabled) ---
            if (window.greenBeadsEnabled) {
                if (window.greenBeads.length === 0) {
                    for(let x=-40; x<=40; x+=2.5) {
                        for(let z=-40; z<=40; z+=2.5) {
                            let bead = new THREE.Mesh(beadGeo, beadMat);
                            bead.startX = hole.flag.x + x;
                            bead.startZ = hole.flag.z + z;
                            bead.position.set(bead.startX, 0, bead.startZ);
                            bead.distOffset = Math.random(); 
                            greenBeadsGroup.add(bead);
                            window.greenBeads.push(bead);
                        }
                    }
                }
                
                let stimp = window.GREEN_STIMP || 10.0;
                let dt = 0.016; 
                
                for(let i=0; i<window.greenBeads.length; i++) {
                    let bead = window.greenBeads[i];
                    let surf = localGetTerrainAt(bead.position.x, -bead.position.z);
                    
                    if (surf && surf.type === 'GREEN') {
                        bead.visible = true;
                        bead.position.y = surf.z + 0.05; 
                        
                        let fallX = -surf.normal.x;
                        let fallZ = -surf.normal.z;
                        let slopeMag = Math.sqrt(fallX*fallX + fallZ*fallZ);
                        
                        if (slopeMag > 0.001) {
                            let dirX = fallX / slopeMag;
                            let dirZ = fallZ / slopeMag;
                            let speed = slopeMag * stimp * 2.0; 
                            
                            let sx = Math.sin(bead.position.x * 0.3 + bead.position.z * 0.2);
                            let sz = Math.cos(bead.position.z * 0.3 - bead.position.x * 0.2); 
                            let currentStimp = window.GREEN_STIMP || 10.0;
                            let grainScale = 0.03 * (10.0 / currentStimp);
                            let gl = Math.sqrt(sx*sx + sz*sz + 1e-6);
                            
                            bead.position.x += (dirX * speed + (sx/gl) * grainScale * 25.0) * dt;
                            bead.position.z += (dirZ * speed + (sz/gl) * grainScale * 25.0) * dt;
                        } else {
                            let sx = Math.sin(bead.position.x * 0.3 + bead.position.z * 0.2);
                            let sz = Math.cos(bead.position.z * 0.3 - bead.position.x * 0.2); 
                            let currentStimp = window.GREEN_STIMP || 10.0;
                            let grainScale = 0.03 * (10.0 / currentStimp);
                            let gl = Math.sqrt(sx*sx + sz*sz + 1e-6);
                            bead.position.x += (sx / gl) * grainScale * 15.0 * dt;
                            bead.position.z += (sz / gl) * grainScale * 15.0 * dt;
                        }
                    } else {
                        bead.visible = false;
                    }
                    
                    let dX = bead.position.x - bead.startX;
                    let dZ = bead.position.z - bead.startZ;
                    let traveled = Math.sqrt(dX*dX + dZ*dZ);
                    if (traveled > (2.0 + bead.distOffset * 1.0)) {
                        bead.position.x = bead.startX;
                        bead.position.z = bead.startZ;
                    }
                }
            } else if (window.greenBeads.length > 0) {
                window.greenBeads.forEach(b => greenBeadsGroup.remove(b));
                window.greenBeads = [];
            }
            
            // --- GREEN GRID (toggle: window.greenGridEnabled) ---
            if (window.greenGridEnabled && !window.greenGridMesh) {
                let gridPoints = [];
                let gridStep = 1.0;  // 1 meter spacing
                let gridRange = 25;
                let sampleStep = 0.5;
                
                // Horizontal grid lines (X direction)
                for (let z = -gridRange; z <= gridRange; z += gridStep) {
                    let lineStart = null;
                    for (let x = -gridRange; x <= gridRange; x += sampleStep) {
                        let wx = hole.flag.x + x;
                        let wz = hole.flag.z + z;
                        let surf = localGetTerrainAt(wx, -wz);
                        if (surf && surf.type === 'GREEN') {
                            let pt = new THREE.Vector3(wx, surf.z + 0.03, wz);
                            if (lineStart) {
                                gridPoints.push(lineStart.x, lineStart.y, lineStart.z);
                                gridPoints.push(pt.x, pt.y, pt.z);
                            }
                            lineStart = pt;
                        } else {
                            lineStart = null;
                        }
                    }
                }
                
                // Vertical grid lines (Z direction)
                for (let x = -gridRange; x <= gridRange; x += gridStep) {
                    let lineStart = null;
                    for (let z = -gridRange; z <= gridRange; z += sampleStep) {
                        let wx = hole.flag.x + x;
                        let wz = hole.flag.z + z;
                        let surf = localGetTerrainAt(wx, -wz);
                        if (surf && surf.type === 'GREEN') {
                            let pt = new THREE.Vector3(wx, surf.z + 0.03, wz);
                            if (lineStart) {
                                gridPoints.push(lineStart.x, lineStart.y, lineStart.z);
                                gridPoints.push(pt.x, pt.y, pt.z);
                            }
                            lineStart = pt;
                        } else {
                            lineStart = null;
                        }
                    }
                }
                
                if (gridPoints.length > 0) {
                    let gridGeo = new THREE.BufferGeometry();
                    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
                    let gridMat = new THREE.LineBasicMaterial({ 
                        color: 0xffffff, transparent: true, opacity: 0.18, 
                        depthTest: true, depthWrite: false 
                    });
                    window.greenGridMesh = new THREE.LineSegments(gridGeo, gridMat);
                    scene.add(window.greenGridMesh);
                }
            } else if (!window.greenGridEnabled && window.greenGridMesh) {
                scene.remove(window.greenGridMesh);
                window.greenGridMesh = null;
            }

            // --- GSPro Break Line Indicator (only in putting mode) ---
            if (window.breakLineMesh) {
                scene.remove(window.breakLineMesh);
                window.breakLineMesh = null;
            }
            if (window.isPuttingMode) {
                let aimDir = new THREE.Vector3().subVectors(controls.target, camera.position);
                aimDir.y = 0; aimDir.normalize();
                
                let bPoints = [new THREE.Vector3(window.ballMesh.position.x, window.ballMesh.position.y, window.ballMesh.position.z)];
                let bCur = { x: window.ballMesh.position.x, z: window.ballMesh.position.z };
                let bDir = aimDir.clone();
                for(let i=0; i<150; i++) {
                    let surf = localGetTerrainAt(bCur.x, -bCur.z);
                    if (!surf || surf.type !== 'GREEN') break;
                    let slopeForce = new THREE.Vector3(-surf.normal.x, 0, -surf.normal.z);
                    bDir.add(slopeForce.multiplyScalar(0.15));
                    
                    let sx = Math.sin(bCur.x * 0.3 + bCur.z * 0.2);
                    let sz = Math.cos(bCur.z * 0.3 - bCur.x * 0.2);
                    let currentStimp = window.GREEN_STIMP || 10.0;
                    let grainScale = 0.03 * (10.0 / currentStimp);
                    let gl = Math.sqrt(sx*sx + sz*sz + 1e-6);
                    bDir.add(new THREE.Vector3(sx/gl, 0, sz/gl).multiplyScalar(grainScale * 0.8));
                    bDir.normalize();
                    
                    bCur.x += bDir.x * 0.1;
                    bCur.z += bDir.z * 0.1;
                    bPoints.push(new THREE.Vector3(bCur.x, surf.z + 0.02, bCur.z));
                }
                let lineGeo = new THREE.BufferGeometry().setFromPoints(bPoints);
                let lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
                window.breakLineMesh = new THREE.Line(lineGeo, lineMat);
                scene.add(window.breakLineMesh);
            }

            // --- ELEVATION PROFILE (Tour de France style cross-section) ---
            let epContainer = document.getElementById('elevation-profile-container');
            let epCanvas = document.getElementById('elevation-canvas');
            if (epContainer && epCanvas && window.ballPos && hole && hole.flag) {
                epContainer.style.display = 'block';
                let ctx = epCanvas.getContext('2d');
                let W = 220, H = 80;
                
                // Sample terrain heights from ball to flag + 3m overshoot
                let bx = window.ballPos.x, bz = window.ballPos.z;
                let fx = hole.flag.x, fz = hole.flag.z;
                let totalDist = Math.sqrt((fx-bx)*(fx-bx) + (fz-bz)*(fz-bz));
                let overshoot = 3.0; // Show 3m past the flag
                let sampleDist = totalDist + overshoot;
                if (sampleDist < 1) sampleDist = 1;
                let dirX = (fx - bx) / (totalDist || 1);
                let dirZ = (fz - bz) / (totalDist || 1);
                
                let samples = [];
                let sampleStep = 0.25; // every 25cm
                let numSamples = Math.ceil(sampleDist / sampleStep);
                if (numSamples > 400) numSamples = 400;
                
                let minH = Infinity, maxH = -Infinity;
                for (let i = 0; i <= numSamples; i++) {
                    let d = i * sampleStep;
                    let sx = bx + dirX * d;
                    let sz = bz + dirZ * d;
                    let surf = localGetTerrainAt(sx, -sz);
                    let h = surf ? surf.z : 0;
                    samples.push({ d: d, h: h, isGreen: surf && surf.type === 'GREEN' });
                    if (h < minH) minH = h;
                    if (h > maxH) maxH = h;
                }
                
                // Exaggerate vertical range for visibility (min 0.05m range)
                let hRange = maxH - minH;
                if (hRange < 0.05) { hRange = 0.05; minH = (minH + maxH) / 2 - 0.025; maxH = minH + 0.05; }
                let padding = hRange * 0.15;
                minH -= padding;
                maxH += padding;
                hRange = maxH - minH;
                
                // Clear and draw
                ctx.clearRect(0, 0, W, H);
                
                // Draw filled gradient terrain profile
                let topMargin = 16; // Space for title
                let botMargin = 14; // Space for distance labels
                let drawH = H - topMargin - botMargin;
                
                let gradient = ctx.createLinearGradient(0, topMargin, 0, H - botMargin);
                gradient.addColorStop(0, 'rgba(76, 175, 80, 0.7)');  // Brighter green top
                gradient.addColorStop(1, 'rgba(27, 94, 32, 0.9)');   // Dark green bottom
                
                ctx.beginPath();
                ctx.moveTo(0, H - botMargin); // Bottom left
                for (let i = 0; i < samples.length; i++) {
                    let x = (samples[i].d / sampleDist) * W;
                    let y = topMargin + drawH * (1 - (samples[i].h - minH) / hRange);
                    if (i === 0) ctx.lineTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.lineTo(W, H - botMargin); // Bottom right
                ctx.closePath();
                ctx.fillStyle = gradient;
                ctx.fill();
                
                // Draw terrain outline
                ctx.beginPath();
                for (let i = 0; i < samples.length; i++) {
                    let x = (samples[i].d / sampleDist) * W;
                    let y = topMargin + drawH * (1 - (samples[i].h - minH) / hRange);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                
                // Flag position marker (vertical dashed line)
                let flagX = (totalDist / sampleDist) * W;
                let flagSurf = localGetTerrainAt(fx, -fz);
                let flagH = flagSurf ? flagSurf.z : 0;
                let flagY = topMargin + drawH * (1 - (flagH - minH) / hRange);
                
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.moveTo(flagX, topMargin);
                ctx.lineTo(flagX, H - botMargin);
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Flag icon
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(flagX - 1, flagY - 10, 2, 10);
                ctx.beginPath();
                ctx.moveTo(flagX + 1, flagY - 10);
                ctx.lineTo(flagX + 8, flagY - 7);
                ctx.lineTo(flagX + 1, flagY - 4);
                ctx.fillStyle = '#ef4444';
                ctx.fill();
                
                // Ball position dot
                let ballSurf = localGetTerrainAt(bx, -bz);
                let ballH = ballSurf ? ballSurf.z : 0;
                let ballY = topMargin + drawH * (1 - (ballH - minH) / hRange);
                ctx.beginPath();
                ctx.arc(0, ballY, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                // Height difference annotation
                let heightDiff = flagH - ballH;
                let diffText = (heightDiff >= 0 ? '▲' : '▼') + ' ' + Math.abs(heightDiff).toFixed(2) + 'm';
                let diffColor = heightDiff >= 0 ? '#f87171' : '#60a5fa';
                ctx.font = 'bold 9px Inter, sans-serif';
                ctx.fillStyle = diffColor;
                ctx.textAlign = 'center';
                ctx.fillText(diffText, flagX, topMargin + 10);
                
                // Distance label at bottom
                ctx.fillStyle = '#94a3b8';
                ctx.font = '8px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('Ball', 2, H - 3);
                ctx.textAlign = 'center';
                ctx.fillText(totalDist.toFixed(1) + 'm', flagX, H - 3);
                ctx.textAlign = 'right';
                ctx.fillText('+' + overshoot.toFixed(0) + 'm', W - 2, H - 3);
            }

        } else {
            // Outside activation distance — cleanup all green viz
            if (window.greenBeads && window.greenBeads.length > 0) {
                window.greenBeads.forEach(b => greenBeadsGroup.remove(b));
                window.greenBeads = [];
            }
            if (window.breakLineMesh) {
                scene.remove(window.breakLineMesh);
                window.breakLineMesh = null;
            }
            if (window.greenGridMesh) {
                scene.remove(window.greenGridMesh);
                window.greenGridMesh = null;
            }
            let epContainer = document.getElementById('elevation-profile-container');
            if (epContainer) epContainer.style.display = 'none';
        }

        applySculpting();

        // Om bollen flyger, hämta nästa punkt i trajectory
        if (isFlying && flightData && flightData.path && flightTick < flightData.path.length) {
            
            var now = performance.now();
            if (!window._flightStartTime) {
                window._flightStartTime = now;
                window._lastProcessedTick = 0;
                window._flightAccumMs = 0;
                window._lastFrameTime = now;
            }
            
            var frameDeltaMs = Math.min(now - (window._lastFrameTime || now), 50); // cap at 50ms
            window._lastFrameTime = now;
            
            // Determine playback speed based on ball phase
            // Flight + Bounce: 1x real-time (realistic), Roll: ramp up after 1.5s
            var speedMultiplier = 1.0;
            if (flightData.path[flightTick]) {
                let curPhase = flightData.path[flightTick].phase;
                if (curPhase === 'roll' || curPhase === 'skid') {
                    if (!window._rollStartTick) window._rollStartTick = flightTick;
                    // How long we've been rolling (in real playback ms)
                    let rollDurationMs = (flightTick - window._rollStartTick) * 5.0;
                    // Stay at 1x for first 3s, then skip to 3x
                    if (rollDurationMs > 3000) {
                        speedMultiplier = 3.0;
                    }
                }
            }
            
            window._flightAccumMs += frameDeltaMs * speedMultiplier;
            
            // Physics dt = 0.005s = 5ms per tick
            var newTick = Math.floor(window._flightAccumMs / 5.0);
            
            if (newTick >= flightData.path.length - 1) {
                newTick = flightData.path.length - 1;
                var pt = flightData.path[newTick];
                window.ballMesh.position.set(pt.x, pt.z + 0.0213, -pt.y);
            } else {
                var exactTick = window._flightAccumMs / 5.0;
                var t = exactTick - newTick; // Lerp factor 0.0 -> 1.0
                var p1 = flightData.path[newTick];
                var p2 = flightData.path[newTick + 1];
                
                var lerpX = p1.x + (p2.x - p1.x) * t;
                var lerpY = p1.y + (p2.y - p1.y) * t;
                var lerpZ = p1.z + (p2.z - p1.z) * t;
                
                window.ballMesh.position.set(lerpX, lerpZ + 0.0213, -lerpY);
            }
            
            for (let k = window._lastProcessedTick; k <= newTick; k++) {
                if (tracerPointsCount < MAX_TRACER_POINTS) {
                    let p = flightData.path[k];
                    tracerPositions[tracerPointsCount * 3] = p.x;
                    tracerPositions[tracerPointsCount * 3 + 1] = p.z + 0.0213;
                    tracerPositions[tracerPointsCount * 3 + 2] = -p.y;
                    
                    // Per-vertex color for gradient tracers
                    let style = TRACER_STYLES[window.currentTracerStyle || 'CLASSIC'];
                    if (style && style.vertexFn) {
                        let vc = getTracerVertexColor(style.vertexFn, tracerPointsCount, flightData.path.length);
                        if (vc) {
                            tracerColors[tracerPointsCount * 3] = vc[0];
                            tracerColors[tracerPointsCount * 3 + 1] = vc[1];
                            tracerColors[tracerPointsCount * 3 + 2] = vc[2];
                        }
                    }
                    tracerPointsCount++;
                }
            }
            window._lastProcessedTick = newTick + 1;
            
            flightTracer.geometry.attributes.position.needsUpdate = true;
            if (flightTracer.geometry.attributes.color) flightTracer.geometry.attributes.color.needsUpdate = true;
            flightTracer.geometry.setDrawRange(0, tracerPointsCount);
            
            // Ball glow light follows ball position
            if (window.ballGlowLight) {
                window.ballGlowLight.position.copy(window.ballMesh.position);
            }
            
            // === UNIFIED FLIGHT CAMERA ===
            if (window.camFollowMode === 'FREE') {
                // Free cam: user controls via OrbitControls
            } else if (gameCamPhase === 'FLIGHT_FOLLOW') {
                let shotDir = new THREE.Vector3(0, 0, -1);
                if (window.aimTarget && window.shotStartPos) {
                    shotDir.subVectors(window.aimTarget, window.shotStartPos);
                    shotDir.y = 0;
                    if (shotDir.lengthSq() > 0.01) shotDir.normalize();
                }
                
                let targetCamPos = window.ballMesh.position.clone().sub(shotDir.multiplyScalar(CAM.FLIGHT_BEHIND));
                targetCamPos.y = Math.max(CAM.FLIGHT_HEIGHT_MIN, window.ballMesh.position.y + 3);
                
                camera.position.x += (targetCamPos.x - camera.position.x) * 0.9;
                camera.position.y += (targetCamPos.y - camera.position.y) * 0.9;
                camera.position.z += (targetCamPos.z - camera.position.z) * 0.9;
                camera.lookAt(window.ballMesh.position);
            }
            
            // --- REAL-TIME HUD UPDATE ---
            if (window.shotStartPos && flightData.path[newTick]) {
                let curP = flightData.path[newTick];
                // shotStartPos is THREE.Vector3(physX, physHeight, -physY)
                // curP is physics: {x: physX, y: physY, z: physHeight}
                // Distance in XY plane (ground): dX = physX diff, dY = physY diff
                let dX = curP.x - window.shotStartPos.x;
                let dY = curP.y - (-window.shotStartPos.z); // physY_start = -shotStartPos.z
                let totalM = Math.sqrt(dX*dX + dY*dY);
                
                let elTotal = document.getElementById('hud-total');
                if (elTotal) elTotal.innerText = window.formatDistStr(totalM);
                
                let elCarry = document.getElementById('hud-carry');
                // Om bollen fortfarande flyger, uppdatera Carry. Annars stannar den på det värde den landade på!
                if (elCarry && curP.phase === 'flight') {
                    elCarry.innerText = window.formatDistStr(totalM);
                }
            }
            
            // COLLISION DETECTION! Krockar bollen med ett block?
            for(let i=0; i<targets.length; i++) {
                let t = targets[i];
                if(t.active) {
                    let d = window.ballMesh.position.distanceTo(t.mesh.position);
                    if(d < t.radius) {
                        t.active = false;
                        scene.remove(t.mesh); // PANG! Block försvinner.
                        
                        points += 500;
                        
                        // Popp-effekt
                        let pop = document.getElementById('score-popup');
                        pop.style.opacity = '1';
                        pop.style.transform = 'translate(-50%, -50%) scale(1)';
                    }
                }
            }
            
            flightTick = newTick;
            
            if (flightTick === flightData.path.length - 1) {
                isFlying = false; // Bollen har stannat
                
                // --- UPPDATERA CARRY/TOTAL I HUD ---
                if (window.shotStartPos) {
                    let finalPhys = flightData.path[flightData.path.length-1];
                    // shotStartPos is THREE.Vector3(physX, physHeight, -physY)
                    // finalPhys is physics: {x: physX, y: physY, z: physHeight}
                    let dX = finalPhys.x - window.shotStartPos.x;
                    let dY = finalPhys.y - (-window.shotStartPos.z); // physY_start = -shotStartPos.z
                    
                    let totalM = Math.sqrt(dX*dX + dY*dY);
                    let carryM = (flightData.metrics.carryMeters || 0);
                    
                    // Sanity: total should never be less than carry
                    if (totalM < carryM) totalM = carryM;
                    
                    if (document.getElementById('hud-carry')) {
                        document.getElementById('hud-carry').innerText = window.formatDistStr(carryM);
                        if (document.getElementById('hud-carryraw')) document.getElementById('hud-carryraw').innerText = window.formatDistStr(carryM);
                        if (document.getElementById('hud-total')) document.getElementById('hud-total').innerText = window.formatDistStr(totalM); 
                        
                        let offPath = Math.abs(finalPhys.x - window.shotStartPos.x);
                        if (document.getElementById('hud-offline')) document.getElementById('hud-offline').innerText = window.formatDistStr(offPath);
                    }
                }
                
                if (playState === 'ROUND_FLYING') {
                    playState = 'ROUND_IDLE';
                    // Sync ballPos with ball mesh position after landing
                    window.ballPos.x = window.ballMesh.position.x;
                    window.ballPos.y = window.ballMesh.position.y;
                    window.ballPos.z = window.ballMesh.position.z;
                    if (document.getElementById('play-tools')) document.getElementById('play-tools').style.display = 'flex';
                    let hole = courseHoles[playingHoleIndex];
                    let distToPin = 999;
                    if(hole && hole.flag) {
                        distToPin = window.ballMesh.position.distanceTo(new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z));
                        
                        // --- SMART AUTO-AIM EFTER SLAG ---
                        if (window.aimTarget) {
                            window.aimTarget.set(hole.flag.x, hole.flag.y, hole.flag.z);
                        }
                        
                        // Transition camera to aim phase
                        if (window.camFollowMode === 'AUTO') {
                            let isPutt = distToPin < CAM.PUTT_THRESHOLD;
                            gameCamPhase = isPutt ? 'PUTT_AIM' : 'IDLE_AIM';
                            window.isPuttingMode = isPutt;
                            landingSettleTimer = CAM.SETTLE_DURATION; // Smooth transition delay
                        }
                    }
                    
                    // BUG-P01 FIX: Check physics holed result FIRST (hole-in-one, chip-in, sunk putt)
                    if (flightData.metrics && flightData.metrics.holed && playState === 'ROUND_IDLE') {
                        let p = window.players[window.activePlayerIndex];
                        if (p && !p.holedOut) {
                            p.holedOut = true;
                            let pop = document.getElementById('score-popup');
                            let total = p.strokes + p.penaltyStrokes;
                            let par = hole ? (hole.par || 4) : 4;
                            let scoreText = logHoleScoreText(total, par);
                            
                            // Special celebration for chip-in / hole-in-one
                            if (total === 1) {
                                pop.innerText = '🏆 HOLE IN ONE!';
                                pop.style.color = '#fbbf24';
                            } else if (distToPin > 5) {
                                pop.innerText = '⛳ HOLED FROM ' + window.formatDistStr(distToPin) + '! ' + scoreText;
                                pop.style.color = '#4ade80';
                            } else {
                                pop.innerText = '⛳ HOLED! ' + scoreText;
                                pop.style.color = '#4ade80';
                            }
                            pop.style.opacity = '1';
                            pop.style.transform = 'translate(-50%, -60%) scale(1.2)';
                            console.log('⛳ HOLED! Total: ' + total + ', Par: ' + par + ' -> ' + scoreText);
                            window.nextTurnTimeout = setTimeout(() => { pop.style.opacity = '0'; pop.style.transform = 'translate(-50%, -60%) scale(1.0)'; evaluateNextTurn(); }, 1500);
                            return; // Skip gimme/auto-putt — ball is in the hole!
                        }
                    }
                    
                    setTimeout(() => {
                        let pop = document.getElementById('score-popup');
                        pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
                        
                        let lieSurface = localGetTerrainAt(window.ballMesh.position.x, -window.ballMesh.position.z);
                        let isGreen = lieSurface && lieSurface.type === 'GREEN';
                        let distFt = distToPin * 3.28084;
                        let gimmeMax = window.matchSettings ? window.matchSettings.gimmeDist : 10;
                        
                        let p = window.players[window.activePlayerIndex];
                        // Kolla Auto Concede först
                        let maxConcede = window.matchSettings ? window.matchSettings.autoConcede : 99;
                        let maxScore = hole ? (hole.par || 4) + maxConcede : 99;
                        
                        let shouldConcede = (p.strokes + p.penaltyStrokes) >= maxScore && maxConcede !== 99;

                        let mode = window.matchSettings ? window.matchSettings.autoPutt : 'TOUR_PRO';
                        
                        // Gimme check
                        if (shouldConcede) {
                            // Auto-concede handled by evaluateNextTurn
                            evaluateNextTurn();
                        } else if (!shouldConcede && distFt <= gimmeMax) {
                            p.strokes += 1;
                            p.holedOut = true;
                            pop.innerText = `GIMME! (${distFt.toFixed(1)} ft) - 1 Putt`;
                            pop.style.opacity = '1';
                            window.nextTurnTimeout = setTimeout(() => { pop.style.opacity = '0'; evaluateNextTurn(); }, 1500);
                        } else if (!shouldConcede && (isGreen || (lieSurface && (lieSurface.type === 'FAIRWAY' || lieSurface.type === 'SEMI-ROUGH') && distToPin < 5.0)) && mode !== 'OFF') {
                            // BUG-P03 FIX: Auto-putt only from GREEN or close fringe (within 5m), not from rough/sand at 20m
                            let putts = 2;
                            if (mode === 'TOUR_PRO') {
                                // Tour Pro Probability Math (BUG-P08 FIX: realistic 3-putt)
                                let p1 = Math.max(0, 100 - (distFt * 6.2)); // 10ft = ~38% chance
                                let p3 = distFt > 30 ? (distFt - 30) * 0.15 : 0; // BUG-P08: Realistic ~5% at 60ft
                                let rand = Math.random() * 100;
                                if (rand < p1) putts = 1;
                                else if (rand > (100 - p3)) putts = 3;
                                else putts = 2;
                                
                                console.log(`TOUR PRO AUTO-PUTT: Dist ${distFt.toFixed(1)} ft. Probs: 1P(${p1.toFixed(1)}%) 3P(${p3.toFixed(1)}%). Rolled: ${rand.toFixed(1)} -> ${putts} Putts`);
                            } else {
                                // GSPro FIXED Interval
                                putts = distFt < 10 ? 1 : (distFt < 40 ? 2 : 3);
                            }
                            
                            p.strokes += putts;
                            p.holedOut = true;
                            pop.innerText = `AUTO-PUTT (${distFt.toFixed(1)} ft): ${putts} Putts`;
                            pop.style.opacity = '1';
                            window.nextTurnTimeout = setTimeout(() => { pop.style.opacity = '0'; evaluateNextTurn(); }, 1500);
                        } else {
                            // Vi är inte klara. Nytt slag ELLER Manuell Putt!
                            if (isGreen && mode === 'OFF') {
                                window.isPuttingMode = true;
                                console.log("MANUAL PUTTING ACTIVATED!");
                            } else {
                                window.isPuttingMode = false;
                            }
                            
                            if (window.camFollowMode !== 'FREE' && appMode === 'PLAY') {
                                controls.enabled = true;
                            }
                            
                            // Reset Aim mot nästa slag (Flaggan eller Fairway)
                            window.resetAimTarget();
                            
                            // Evaluate who plays next (this player is not done)
                            evaluateNextTurn();
                        }
                    }, 200);
                } else {
                    // ARCADE MODE: Klassisk reset efter 2 sekunder
                    setTimeout(() => {
                        controls.enabled = true; // Lås upp igen!
                        camera.position.set(0, 4, 10);
                        controls.target.set(0, 0, -20);
                        controls.update();
                    }, 500);
                }
            }
        }

        // === UNIFIED AIM CAMERA (runs when NOT flying) ===
        if (!isFlying && window.camFollowMode === 'AUTO' && (gameCamPhase === 'IDLE_AIM' || gameCamPhase === 'PUTT_AIM') && playState === 'ROUND_IDLE' && window.aimTarget) {
            if (landingSettleTimer > 0) {
                landingSettleTimer--;
                // During settle: smooth lerp to aim position
            }
            let isPutt = gameCamPhase === 'PUTT_AIM';
            let camH = isPutt ? CAM.PUTT_HEIGHT : CAM.AIM_HEIGHT;
            let camD = isPutt ? CAM.PUTT_DISTANCE : CAM.AIM_DISTANCE;
            
            let aimDir = new THREE.Vector3().subVectors(window.aimTarget, window.ballMesh.position).normalize();
            if (aimDir.lengthSq() < 0.01) aimDir.set(0, 0, -1);
            
            let targetPos = window.ballMesh.position.clone().add(
                new THREE.Vector3(-aimDir.x * camD, camH, -aimDir.z * camD)
            );
            
            camera.position.x += (targetPos.x - camera.position.x) * CAM.AIM_LERP;
            camera.position.y += (targetPos.y - camera.position.y) * CAM.AIM_LERP;
            camera.position.z += (targetPos.z - camera.position.z) * CAM.AIM_LERP;
            controls.target.copy(window.aimTarget);
            controls.enabled = true;
        }

        // === HOLE FLYOVER CAMERA ===
        if (gameCamPhase === 'HOLE_FLYOVER') {
            flyoverProgress++;
            let t = Math.min(flyoverProgress / flyoverDuration, 1.0);
            // Smooth ease-in-out
            let ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            
            // Interpolera position
            camera.position.lerpVectors(flyoverStart, flyoverEnd, ease);
            
            // Titta framåt mot flaggan under hela flyget
            let hole = courseHoles[playingHoleIndex];
            if (hole && hole.flag) {
                camera.lookAt(hole.flag.x, hole.flag.y, hole.flag.z);
            }
            
            // Klar? Återgå till aim
            if (t >= 1.0) {
                gameCamPhase = 'IDLE_AIM';
                controls.enabled = true;
            }
        }

        // === WIND-DRIVEN WATER WAVES ===
        {
            let wArr = waterGeo.attributes.position.array;
            let windMph = window.currentWindMph || 0;
            let windRad = (window.currentWindDir || 0) * Math.PI / 180;
            let amp = Math.min(windMph * 0.004, 0.15);  // Wave height from wind (capped)
            let t = performance.now() * 0.001;
            
            if (amp > 0.001) {
                let wdx = Math.cos(windRad);
                let wdy = Math.sin(windRad);
                for (let i = 0; i < wArr.length; i += 3) {
                    let baseZ = window.waterBaseZ[i / 3];
                    if (baseZ > -90) { // Only animate visible water
                        let phase = wArr[i] * wdx + wArr[i + 1] * wdy;
                        wArr[i + 2] = baseZ + Math.sin(t * 2.5 + phase * 0.3) * amp;
                    }
                }
                waterGeo.attributes.position.needsUpdate = true;
            }
        }

        renderer.clear();
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
        renderer.setScissorTest(true);
        renderer.render(scene, camera);
        
        // --- GSPRO AIM BILLBOARD PROJECTION ---
        let bb = document.getElementById('aim-billboard');
        if ((appMode === 'PLAY' || appMode === 'TEST') && playState === 'ROUND_IDLE' && window.aimTarget) {
            bb.style.display = 'block';
            let pos = window.aimTarget.clone();
            pos.project(camera);
            
            // Endast om framför kameran
            if (pos.z < 1) {
                let x = (pos.x * .5 + .5) * window.innerWidth;
                let y = (pos.y * -.5 + .5) * window.innerHeight;
                bb.style.left = x + 'px';
                bb.style.top = (y - 30) + 'px'; // Sväva strax ovanför
                
                // Uppdatera info
                let hole = courseHoles[playingHoleIndex];
                let dist = window.ballMesh.position.distanceTo(window.aimTarget);
                let elevDiff = window.aimTarget.y - window.ballMesh.position.y;
                document.getElementById('aim-bb-dist').innerText = (dist * 1.09361).toFixed(0); 
                document.getElementById('aim-bb-elev').innerText = Math.abs(elevDiff * 1.09361).toFixed(1) + 'y';
                document.getElementById('aim-bb-arrow').innerText = elevDiff > 0 ? '▲' : '▼';
                document.getElementById('aim-bb-arrow').style.color = elevDiff > 0 ? '#4ade80' : '#f87171'; // Grön upp, Röd ner
            } else {
                bb.style.display = 'none';
            }
        } else {
            if(bb) bb.style.display = 'none';
        }
        
        // --- LIE & CONDITIONS HUD ---
        let lieHud = document.getElementById('lie-conditions-hud');
        if ((appMode === 'PLAY' || appMode === 'TEST') && playState === 'ROUND_IDLE') {
            try {
                if(lieHud) lieHud.style.display = 'block';
                if (typeof localGetTerrainAt === 'function') {
                    let surf = localGetTerrainAt(window.ballMesh.position.x, -window.ballMesh.position.z);
                    let isTee = (window.players && window.players[window.activePlayerIndex] && window.players[window.activePlayerIndex].strokes === 0);
                    
                    let lType = isTee ? 'FAIRWAY' : (surf ? (surf.type || 'FAIRWAY') : 'FAIRWAY');
                    
                    if (document.getElementById('lie-text')) {
                        document.getElementById('lie-text').innerText = isTee ? 'TEE' : lType;
                    }
                    
                    let iconCol = '#16a34a'; // Fairway
                    if (lType === 'WATER') iconCol = '#38bdf8';
                    else if (lType === 'SAND' || lType === 'WASTE') iconCol = '#fcd34d';
                    else if (lType === 'DEEP ROUGH') iconCol = '#14532d';
                    else if (lType === 'ROUGH') iconCol = '#15803d';
                    else if (lType === 'SEMI-ROUGH') iconCol = '#22c55e';
                    else if (lType === 'OB') iconCol = '#ef4444';
                    else iconCol = '#4ade80'; // Tee / Green
                    
                    if (document.getElementById('lie-icon')) {
                        document.getElementById('lie-icon').style.background = iconCol;
                    }
                    
                    let powStr = "100%"; let spinStr = "100%"; let powCol = "#4ade80";
                    if (!isTee) {
                        if (lType === 'ROUGH') { powStr = "85 - 95%"; spinStr = "60 - 70%"; powCol = "#fbbf24"; }
                        else if (lType === 'DEEP ROUGH') { powStr = "75 - 90%"; spinStr = "40 - 60%"; powCol = "#f87171"; }
                        else if (lType === 'SEMI-ROUGH') { powStr = "95 - 98%"; spinStr = "85 - 95%"; }
                        else if (lType === 'SAND' || lType === 'WASTE') { powStr = "80 - 95%"; spinStr = "40 - 60%"; powCol = "#fbbf24"; }
                    }
                    
                    if (document.getElementById('lie-power')) document.getElementById('lie-power').innerText = powStr;
                    if (document.getElementById('lie-power')) document.getElementById('lie-power').style.color = powCol;
                    if (document.getElementById('lie-spin')) document.getElementById('lie-spin').innerText = spinStr;
                    let spinCol = powCol;
                    if (document.getElementById('lie-spin')) document.getElementById('lie-spin').style.color = spinCol;
                }
                
                if (window.aimTarget && document.getElementById('lie-distance')) {
                    let dX = window.aimTarget.x - window.ballMesh.position.x;
                    let dZ = window.aimTarget.z - window.ballMesh.position.z;
                    let distYds = Math.sqrt(dX*dX + dZ*dZ) * 1.09361;
                    document.getElementById('lie-distance').innerText = distYds.toFixed(1) + " yds";
                    
                    let elevDistM = window.aimTarget.y - window.ballMesh.position.y;
                    let sign = elevDistM > 0 ? "+" : (elevDistM < 0 ? "-" : "");
                    document.getElementById('lie-elevation').innerText = sign + Math.abs(elevDistM).toFixed(1) + "m";
                }
            } catch (e) {
                console.error("[Lie HUD Error]:", e);
            }
        } else {
            if(lieHud) lieHud.style.display = 'none';
        }

        // --- THE GSPRO MINIMAP PASS ---
        let mapCont = document.getElementById('minimap-container');
        if ((appMode === 'PLAY' || appMode === 'TEST') && (playState === 'ROUND_IDLE' || playState === 'ROUND_FLYING')) {
            if (mapCont) mapCont.style.display = 'block';
            let mapW = 220; let mapH = 340;
            // GSPro karta i nedre högra hörnet = window.innerWidth - mapW - 20
            let mX = window.innerWidth - mapW - 20; 
            let mY = 20; 
            
            renderer.setViewport(mX, mY, mapW, mapH);
            renderer.setScissor(mX, mY, mapW, mapH);
            // Eftersom vi satt scissorTest = true förut, rensar detta bart minikartan!
            let oldClearColor = renderer.getClearColor(new THREE.Color());
            renderer.setClearColor(0x0f172a, 1.0); // Mörkblå bakgrund
            renderer.clear(true, true, false);
            
            let hole = courseHoles[playingHoleIndex];
            if (hole && hole.flag) {
                let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
                
                // Gör kameran responsiv mot layouten (Ball till Flagga)
                minimapCamera.position.set((window.ballMesh.position.x + fv.x)/2, 300, (window.ballMesh.position.z + fv.z)/2);
                
                let dist = window.ballMesh.position.distanceTo(fv);
                
                // Låt "Uppåt" i kartan peka mot flaggan! (Vi räknar ut detta först för offset)
                let dir = new THREE.Vector3().subVectors(fv, window.ballMesh.position);
                dir.y = 0; dir.normalize();
                
                // SKIFTA MINIMAP-KAMERANS CENTRUM
                // Genom att backa kameran minskar vi problemet att UI täcker bollen
                let offsetDist = dist * 0.15 + 15; // Backa ~15% plus 15 meter
                minimapCamera.position.sub(dir.clone().multiplyScalar(offsetDist));
                
                // Dynamisk Scale beroende på hålets längd
                let pad = 20 + offsetDist; // Öka padding proportionerligt
                minimapCamera.left = -(dist/2 + pad); 
                minimapCamera.right = (dist/2 + pad);
                // Behåll aspect ratio 220x340 = 0.64
                minimapCamera.top = (dist/2 + pad) / 0.64;
                minimapCamera.bottom = -(dist/2 + pad) / 0.64;
                minimapCamera.updateProjectionMatrix();

                minimapCamera.up.set(dir.x, 0, dir.z);
                minimapCamera.lookAt(minimapCamera.position.x, 0, minimapCamera.position.z);
                
                // --- KARTA UI (Yards & Grader) ---
                if (window.aimTarget) {
                    let dX = window.aimTarget.x - window.ballMesh.position.x;
                    let dZ = window.aimTarget.z - window.ballMesh.position.z;
                    let flatD = Math.sqrt(dX*dX + dZ*dZ);
                    let dY = window.aimTarget.y - window.ballMesh.position.y;
                    
                    let degUp = (Math.atan2(dY, flatD) * 180 / Math.PI).toFixed(1);
                    document.getElementById('minimap-updown').innerText = Math.abs(degUp) + (degUp >= 0 ? "° UP" : "° DN");
                    
                    // Left/Right? Eftersom kameran följer Siktet är vi alltid 0.0°!
                    document.getElementById('minimap-leftright').innerText = "0.0° RIGHT";
                    
                    if (typeof localGetTerrainAt === 'function') {
                        let surf = localGetTerrainAt(window.aimTarget.x, -window.aimTarget.z);
                        if (surf) document.getElementById('minimap-lie-text').innerText = surf.type || 'Fairway';
                    }
                }
            }
            let oldMat = plane.material;
            
            if (window.minimapMat && window.heatmapShaderRef) {
                window.heatmapShaderRef.uniforms.uFlagHeight.value = (hole && hole.flag) ? hole.flag.y : 0.0;
                
                // Måste se till att maskreferensen lever
                if (window.heatmapShaderRef.uniforms.tGreenMask.value !== window.greenMaskTex) {
                    window.heatmapShaderRef.uniforms.tGreenMask.value = window.greenMaskTex;
                }
                
                plane.material = window.minimapMat;
            }
            
            // Ritning av Line Overlay (Ball -> Target -> Flag)
            if (window.aimTarget && hole && hole.flag && document.getElementById('mm-line-1')) {
                let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
                let pB = window.ballMesh.position.clone().project(minimapCamera);
                let pA = window.aimTarget.clone().project(minimapCamera);
                let pF = fv.clone().project(minimapCamera);
                
                // Transformera från NDS [-1, 1] till Pixel Coordinates [0, 220] & [0, 340]
                let toX = (v) => (v.x * 0.5 + 0.5) * 220;
                let toY = (v) => (-v.y * 0.5 + 0.5) * 340;
                
                let bx = toX(pB), by = toY(pB);
                let ax = toX(pA), ay = toY(pA);
                let fx = toX(pF), fy = toY(pF);
                
                document.getElementById('mm-line-1').setAttribute('x1', bx);
                document.getElementById('mm-line-1').setAttribute('y1', by);
                document.getElementById('mm-line-1').setAttribute('x2', ax);
                document.getElementById('mm-line-1').setAttribute('y2', ay);
                document.getElementById('mm-line-2').setAttribute('x1', ax);
                document.getElementById('mm-line-2').setAttribute('y1', ay);
                document.getElementById('mm-line-2').setAttribute('x2', fx);
                document.getElementById('mm-line-2').setAttribute('y2', fy);
                document.getElementById('mm-dot-target').setAttribute('cx', ax);
                document.getElementById('mm-dot-target').setAttribute('cy', ay);
                
                let dT = document.getElementById('mm-dist-target');
                let dF = document.getElementById('mm-dist-flag');
                dT.style.display = 'block';
                dF.style.display = 'block';
                
                dT.innerText = window.formatDistStr(window.ballMesh.position.distanceTo(window.aimTarget), 0);
                dF.innerText = window.formatDistStr(window.aimTarget.distanceTo(fv), 0);
                
                dT.style.left = ((bx+ax)/2 + 20) + 'px';
                dT.style.top = ((by+ay)/2) + 'px';
                dF.style.left = ((ax+fx)/2 + 20) + 'px';
                dF.style.top = ((ay+fy)/2) + 'px';
            }
            
            // depth är redan rensat via clear() ovan
            renderer.render(scene, minimapCamera);
            
            plane.material = oldMat; // Återställ markens material
            renderer.setClearColor(oldClearColor, 1.0); // Återställ clear color ifall den används på andra ställen
        } else {
            if (mapCont) mapCont.style.display = 'none';
        }
    }
    
    // --- LM BRIDGE STATUS ---
    function initLaunchMonitorBridge() {
        var ws = new WebSocket('ws://localhost:8081');
        var dot = document.getElementById('lm-status-dot');
        var txt = document.getElementById('lm-status-text');

        ws.onopen = function() {
            if(txt) txt.textContent = "LM Brygga Redo";
            if(dot) dot.style.background = "#eab308";
        };
        ws.onmessage = function(event) {
            try {
                var msg = JSON.parse(event.data);
                if (msg.type === 'status') {
                    if(txt) txt.textContent = msg.data.message;
                    if(dot) dot.style.background = msg.data.color;
                } else if (msg.type === 'shot') {
                    if(dot) {
                        dot.style.background = "#38bdf8";
                        setTimeout(() => dot.style.background = "#4ade80", 500);
                    }
                    msg.data.isLiveData = true; // Markera som LM-data så physics.js skippar virtuella lie-straff!
                    triggerRealShot(msg.data);
                }
            } catch(e) {}
        };
        ws.onclose = function() {
            if(txt) txt.textContent = "LM Brygga Nere";
            if(dot) dot.style.background = "#ef4444";
            setTimeout(initLaunchMonitorBridge, 5000);
        };
    }
    
    // Boot:
    initLaunchMonitorBridge();
    
    // Load custom world on boot!
    loadLevel();
    
    
    // Resize resulterar..
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
