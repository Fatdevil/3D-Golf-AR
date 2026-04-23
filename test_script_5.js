
    // 1. THREE.JS INITIALIZATION
    let currentEditCode = null;
    
    window.takeMulligan = function() {
        if (typeof appMode === 'undefined' || appMode !== 'PLAY' || !window.matchSettings || !window.matchSettings.mulligans) return;
        if (playState !== 'ROUND_IDLE') return;

        let p = window.players[window.activePlayerIndex];
        if (p && p.prevPos) {
            ball.position.set(p.prevPos.x, p.prevPos.y, p.prevPos.z);
            p.strokes = (p.prevStrokes !== undefined) ? p.prevStrokes : p.strokes;
            p.penaltyStrokes = (p.prevPenalty !== undefined) ? p.prevPenalty : p.penaltyStrokes;
            
            p.prevPos = null;

            document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
            
            camera.position.set(ball.position.x, ball.position.y + 4, ball.position.z + 10);
            controls.target.copy(ball.position);
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
    
    setInterval(() => {
        let mBtn = document.getElementById('btn-mulligan');
        if (mBtn) {
            if (typeof appMode !== 'undefined' && appMode === 'PLAY' && typeof playState !== 'undefined' && playState === 'ROUND_IDLE' && window.matchSettings && window.matchSettings.mulligans) {
                let p = window.players ? window.players[window.activePlayerIndex] : null;
                if (p && p.prevPos) {
                    mBtn.style.display = 'block';
                    return;
                }
            }
            mBtn.style.display = 'none';
        }
    }, 500);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Himmel
    scene.fog = new THREE.Fog(0x87CEEB, 300, 2500); // Kraftigt ökat synavstånd

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000); // Rendering upp till 4000m
    // Kamera strax bakom och över bollen
    camera.position.set(0, 2, 5); 

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.autoClear = false; // Krävs för Picture-in-Picture (Minimap)
    document.body.appendChild(renderer.domElement);
    
    // -- CUSTOM 3D MODELS INJECTION --
    window.customModels = {};
    const gltfLoader = new THREE.GLTFLoader();
    
    // Nya extremt nerskalade palmen (250 KB)
    gltfLoader.load('palm3.glb', function(gltf) {
        let model = gltf.scene;
        let box = new THREE.Box3().setFromObject(model);
        let center = box.getCenter(new THREE.Vector3());
        let size = box.getSize(new THREE.Vector3());
        
        let targetHeight = 12.0; 
        let scaleFixed = (size.y > 0.001) ? (targetHeight / size.y) : 1.0;
        if (!isFinite(scaleFixed)) scaleFixed = 1.0;
        
        // Prevent NaN matrix corruption
        let cx = isFinite(center.x) ? center.x : 0;
        let cymin = isFinite(box.min.y) ? box.min.y : 0;
        let cz = isFinite(center.z) ? center.z : 0;
        
        model.scale.set(scaleFixed, scaleFixed, scaleFixed);
        model.position.set(-cx * scaleFixed, -cymin * scaleFixed, -cz * scaleFixed);
        
        let container = new THREE.Group();
        container.add(model);
        
        container.traverse(function(node) {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
                if (node.material) {
                    if (node.material.isMeshStandardMaterial || node.material.isMeshPhysicalMaterial) {
                        node.material.metalness = 0.0;
                        node.material.roughness = 0.9;
                        
                        let boost = window.ASSET_REGISTRY['PALM'].brightness !== undefined ? window.ASSET_REGISTRY['PALM'].brightness : 0.15;
                        
                        if (node.material.color && boost > 0) {
                            node.material.emissive = node.material.color.clone().multiplyScalar(boost);
                        }
                        node.material.needsUpdate = true;
                    }
                }
            }
        });
        window.customModels['PALM'] = container;
        console.log("Palm 3 (250kb) Laddad!", container);
        
        // --- RETROFIT EXISTING PALMS ---
        if (window.placedTrees) {
            window.placedTrees.forEach(t => {
                if (t.type === 'PALM') {
                    while(t.mesh.children.length > 0) { 
                        t.mesh.remove(t.mesh.children[0]); 
                    }
                    t.mesh.add(window.customModels['PALM'].clone());
                }
            });
        }
    });
    
    // --- GSPRO AIM SYSTEM & MINIMAP CAMERA ---
    window.aimTarget = new THREE.Vector3(0, 0, -20);
    window.aimTracerGeo = new THREE.BufferGeometry();
    window.aimTracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    window.aimTracerLine = new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.6 });
    const aimLineMesh = new THREE.Line(window.aimTracerGeo, window.aimTracerLine);
    aimLineMesh.computeLineDistances();
    scene.add(aimLineMesh);
    
    // Orthographic Camera för Minimappen
    const mapSize = 150; // Hur stor markyta minikartan visar by default (radie)
    const minimapCamera = new THREE.OrthographicCamera(-mapSize, mapSize, mapSize, -mapSize, 0.1, 1000);
    minimapCamera.position.set(0, 300, 0); // Högt över banan
    minimapCamera.lookAt(0, 0, 0);
    minimapCamera.up.set(0, 0, -1); // För orienteringens skull

    // Ljus
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048; // Skarpare skuggor
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    scene.add(dirLight);
    
    // SKAPA EN MINECRAFT-SOL (Blockig)
    const sunGeo = new THREE.BoxGeometry(20, 20, 20);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe600 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(200, 150, -400); // Långt bort på himlen!
    scene.add(sunMesh);

    // 2. SKAPA GOLV (Byter från Vertex Colors till en High-Res 2048px Målar-Duk!)
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 16; tCanvas.height = 16; 
    const tCtx = tCanvas.getContext('2d');
    tCtx.clearRect(0,0,16,16); // Genomskinlig bas!!
    tCtx.fillStyle = 'rgba(0,0,0,0.1)'; // Svagt svart grid-mönster
    tCtx.fillRect(0,0,8,8); tCtx.fillRect(8,8,8,8); 
    
    const gridTex = new THREE.CanvasTexture(tCanvas);
    gridTex.wrapS = THREE.RepeatWrapping;
    gridTex.wrapT = THREE.RepeatWrapping;
    // Skapa Textur-canvasen (Visuella)
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = 4096; paintCanvas.height = 4096;
    const pCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
    
    // Fyll med grundfärg (Rough)
    pCtx.fillStyle = '#4a782b';
    pCtx.fillRect(0, 0, 4096, 4096);
    
    const mapTex = new THREE.CanvasTexture(paintCanvas);
    mapTex.magFilter = THREE.LinearFilter; // Mjuka suddiga Golf Clash kanter!
    
    // EXPLICIT GREEN MASK (För Minimap Topography)
    window.greenMaskCanvas = document.createElement('canvas');
    window.greenMaskCanvas.width = 4096; window.greenMaskCanvas.height = 4096;
    window.greenCtx = window.greenMaskCanvas.getContext('2d', { willReadFrequently: true });
    window.greenCtx.fillStyle = '#000000'; // Svart = Inte Green
    window.greenCtx.fillRect(0, 0, 4096, 4096);
    window.greenMaskTex = new THREE.CanvasTexture(window.greenMaskCanvas);
    window.greenMaskTex.magFilter = THREE.LinearFilter;
    
    window.rebuildGreenMask = function() {
        if (!window.terrainBiomeData) return;
        let gData = window.greenCtx.createImageData(4096, 4096);
        let tData = window.terrainBiomeData;
        for(let i=0; i < tData.length; i+=4) {
            let r = tData[i], g = tData[i+1], b = tData[i+2];
            // Enkel C-dist check mot Green: rgb(152, 206, 104) som körs asynkront PÅ CPU:n. Håller shadern 100% ren!
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

    // SKAPA VATTEN-ALPHAMASK (Styr osynlighet för vatten-lagret)
    const waterCanvas = document.createElement('canvas');
    waterCanvas.width = 4096; waterCanvas.height = 4096;
    const wCtx = waterCanvas.getContext('2d');
    wCtx.fillStyle = '#000000'; // Allt svart = Osynligt!
    wCtx.fillRect(0, 0, 4096, 4096);
    const waterTex = new THREE.CanvasTexture(waterCanvas);
    waterTex.magFilter = THREE.LinearFilter;
    
    // UTÖKAD BANA TILL 1200 METER! (1.4 km2)
    const TERRAIN_SIZE = 900; // Kompaktare 900m yta (nästan 1 kvadratkilometer)
    const TERRAIN_SEGS = 600; // Galet hög detaljrikedom, 1.5m mellan varje vertex!
    const planeGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
    planeGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    
    const planeMat = new THREE.MeshLambertMaterial({ map: mapTex, vertexColors: false });
    
    // THE STRIPED FAIRWAY SHADER INJECTION
    // (Mower stripes removed to fix visual artifacts)

    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);
    
    // THE TOPOGRAPHY HEATMAP SHADER (For Minimap)
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
            
            // Beräkna lutning via skärmderivator för att anpassa linjetjocklek matematiskt
            float slope = length(vec2(dFdx(vWorldY), dFdy(vWorldY)));
            float distToContour = abs(fract(vWorldY / contourInterval + 0.5) - 0.5) * contourInterval;
            float lineThicknessWorld = slope * 1.5; // Linjen blir 1.5 pixlar bred oavsett geometri
            
            // Rita bara linjer där det lutar (slope > 0.002). Annars blir platta fairways dolda av tjock svart contour.
            bool isLine = (slope > 0.002) && (distToContour < lineThicknessWorld);
            
            vec3 hmColor = vec3(0.0);
            if (diff >= 1.0) hmColor = vec3(0.8, 0.0, 0.0);
            else if (diff > 0.3) hmColor = mix(vec3(0.5, 0.8, 0.0), vec3(0.8, 0.0, 0.0), (diff - 0.3)/0.7);
            else if (diff > -0.3) hmColor = mix(vec3(0.2, 0.7, 0.2), vec3(0.5, 0.8, 0.0), (diff + 0.3)/0.6);
            else if (diff > -1.0) hmColor = mix(vec3(0.0, 0.5, 0.8), vec3(0.2, 0.7, 0.2), (diff + 1.0)/0.7);
            else hmColor = vec3(0.0, 0.0, 0.6);
            
            float heatAlpha = greenMask.r * 0.85; 
            
            // Mixa Heatmap på det belysta (Lambert) materialet så sand och fairway ser ut exakt som i spelet!
            vec3 mapColor = mix(gl_FragColor.rgb, hmColor, heatAlpha);
            if (isLine) mapColor = vec3(0.05); // Svart Contour line
            
            gl_FragColor = vec4(mapColor, gl_FragColor.a);
            `
        );
    };
    
    // THE PHYSICAL WATER LAYER
    const waterGeo = planeGeo.clone(); // Exakt samma nät!
    waterGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    // Skjut ner allt vatten djupt initialt så inget glappar
    let wPos = waterGeo.attributes.position.array;
    for(let i=0; i<waterGeo.attributes.position.count; i++) wPos[i*3 + 2] = -99.0;
    
    const waterMat = new THREE.MeshLambertMaterial({ 
        color: 0x38bdf8, 
        transparent: true, 
        opacity: 0.85, 
        alphaMap: waterTex, 
        alphaTest: 0.5, // Klipper kanterna magiskt skarpt!
        depthWrite: false 
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);
    
    // Grid-nätet läggs som en transparent hinna över (då slipper vi baka in det i canvas och undviker överlappningar)
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
        
        let biomeType = 'ROUGH'; // Default
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

    // GSPRO PUTTING VISUALIZATION (Beads & Break Line)
    const greenBeadsGroup = new THREE.Group();
    scene.add(greenBeadsGroup);
    window.greenBeads = [];
    const beadGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    
    window.breakLineMesh = null;

    
    // SKULPTER-PENSEL (Visuell cirkel)
    const brushGeo = new THREE.RingGeometry(3.5, 4.0, 32);
    const brushMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide });
    const sculptBrushCursor = new THREE.Mesh(brushGeo, brushMat);
    sculptBrushCursor.rotation.x = -Math.PI / 2;
    sculptBrushCursor.visible = false;
    scene.add(sculptBrushCursor);

    // MÄTVERKTYG (Gula linjer för drag-rektangel)
    const measureGeo = new THREE.BufferGeometry();
    const measurePos = new Float32Array(5 * 3); // 4 linjer = 5 noder
    measureGeo.setAttribute('position', new THREE.BufferAttribute(measurePos, 3));
    const measureMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false, linewidth: 3 });
    const measureLines = new THREE.Line(measureGeo, measureMat);
    measureLines.renderOrder = 999; // Rita ovanpå terrängen
    measureLines.visible = false;
    scene.add(measureLines);
    let measureStartPoint = null;

    // TRÄD & NATUR
    const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4033 });
    const treeLeavesMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 }); 
    const bushLeavesMat = new THREE.MeshLambertMaterial({ color: 0x4d7c0f }); 
    const palmTrunkMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    const palmLeavesMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

    const oakLeavesMat = new THREE.MeshLambertMaterial({ color: 0x3f6b2b }); // Mörk oliv/ek

    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 6); 
    const oakTrunkGeo = new THREE.CylinderGeometry(1.2, 1.8, 6, 8); 
    const leafGeo = new THREE.IcosahedronGeometry(3.5, 1); // Bulligt
    const oakLeafGeo = new THREE.IcosahedronGeometry(6.0, 1); // Gigantiskt
    const bushGeo = new THREE.IcosahedronGeometry(2.0, 1); 
    const pineGeo = new THREE.ConeGeometry(2.5, 8, 6); // Tall
    const spineGeo = new THREE.CylinderGeometry(0.3, 0.6, 8, 6); 
    const rockGeo = new THREE.DodecahedronGeometry(1.5, 0); // Klippa

    const palmFrondGeo = new THREE.ConeGeometry(0.5, 5, 4); 
    palmFrondGeo.translate(0, 2.5, 0);

    window.placedTrees = [];
    const treesGroup = new THREE.Group();
    scene.add(treesGroup);

    function createTree(type, x, z, scale, rot) {
        let group = new THREE.Group();
        group.position.set(x, 0, z);
        
        let groundY = 0;
        let downRay = new THREE.Raycaster(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
        let hits = downRay.intersectObject(plane);
        if(hits.length > 0) groundY = hits[0].point.y;
        group.position.y = groundY;

        if (window.customModels && window.customModels[type] && window.customModels[type] !== 'LOADING') {
            let clone = window.customModels[type].clone();
            group.add(clone);
        } else {
            // Procedural Fallbacks for legacy nature, or generic block for new assets
            if (type === 'BUSH') {
                let bMesh = new THREE.Mesh(bushGeo, bushLeavesMat);
                bMesh.position.y = 0.5; bMesh.castShadow = true; bMesh.receiveShadow = true;
                group.add(bMesh);
            } else if (type === 'TREE') {
                let tMesh = new THREE.Mesh(trunkGeo, treeTrunkMat);
                tMesh.position.y = 2.0; tMesh.castShadow = true;
                let lMesh = new THREE.Mesh(leafGeo, treeLeavesMat);
                lMesh.position.y = 5.0; lMesh.scale.set(1, 0.8, 1);
                lMesh.castShadow = true; lMesh.receiveShadow = true;
                group.add(tMesh); group.add(lMesh);
            } else if (type === 'PALM') {
                let pMesh = new THREE.Mesh(spineGeo, palmTrunkMat);
                pMesh.position.y = 4.0; pMesh.rotation.z = Math.PI/32; pMesh.castShadow = true;
                group.add(pMesh);
                for(let i=0; i<6; i++) {
                    let frond = new THREE.Mesh(palmFrondGeo, palmLeavesMat);
                    frond.position.y = 4.0; 
                    frond.rotation.z = Math.PI/2 - 0.5; frond.rotation.y = (Math.PI*2/6) * i;
                    frond.castShadow = true; frond.receiveShadow = true;
                    pMesh.add(frond);
                }
            } else if (type === 'ROCK') {
                let rMesh = new THREE.Mesh(rockGeo, rockMat);
                rMesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
                rMesh.scale.set(1 + Math.random(), 0.5 + Math.random(), 1 + Math.random());
                rMesh.position.y = 0.5; rMesh.castShadow = true; rMesh.receiveShadow = true;
                group.add(rMesh);

            } else if (type === 'OAK') {
                let tMesh = new THREE.Mesh(oakTrunkGeo, treeTrunkMat);
                tMesh.position.y = 3.0; tMesh.castShadow = true;
                let lMesh = new THREE.Mesh(oakLeafGeo, oakLeavesMat);
                lMesh.position.y = 7.0; lMesh.scale.set(1, 0.8, 1);
                lMesh.castShadow = true; lMesh.receiveShadow = true;
                group.add(tMesh); group.add(lMesh);
            } else if (type === 'PINE') {
                let tMesh = new THREE.Mesh(trunkGeo, treeTrunkMat);
                tMesh.position.y = 2.0; tMesh.castShadow = true;
                let lMesh = new THREE.Mesh(pineGeo, treeLeavesMat);
                lMesh.position.y = 6.0; 
                lMesh.castShadow = true; lMesh.receiveShadow = true;
                group.add(tMesh); group.add(lMesh);
            } else {
                // Generic Fallback Container for any new asset while loading
                let tempGeo = new THREE.BoxGeometry(2, 5, 2);
                let tempMat = new THREE.MeshLambertMaterial({ color: 0x64748b, wireframe: true });
                let tMesh = new THREE.Mesh(tempGeo, tempMat);
                tMesh.position.y = 2.5;
                group.add(tMesh);
                
                // Trigger lazy load if not already loading
                if (window.ASSET_REGISTRY && window.ASSET_REGISTRY[type] && (!window.customModels || !window.customModels[type])) {
                    if (typeof window.loadAsset === 'function') window.loadAsset(type);
                }
            }
        }
        
        group.scale.set(scale, scale, scale); group.rotation.y = rot;
        treesGroup.add(group);
        window.placedTrees.push({ type: type, x: x, z: z, scale: scale, rot: rot, mesh: group });
    }

    // 3. SKAPA BOLLEN
    const ballGeo = new THREE.SphereGeometry(0.0427, 16, 16); // Riktigt Golfboll! (~4.2cm diameter. Visuell proxy för att synas vid puttning)
    const ballMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    ball.position.set(0, 0.0213, 0);
    ball.visible = false;
    scene.add(ball);

    // TRACER LINE FÖR FANTSTISK 3D FYSIK
    const MAX_TRACER_POINTS = 6000;
    const tracerPositions = new Float32Array(MAX_TRACER_POINTS * 3);
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3));
    tracerGeo.setDrawRange(0, 0);
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, linewidth: 3 });
    const flightTracer = new THREE.Line(tracerGeo, tracerMat);
    scene.add(flightTracer);
    let tracerPointsCount = 0;

    // 4. SKAPA MÅLTAVLOR (Targets)
    const targets = [];
    
    // --- BANSYSTEM & SCOREKORT (Holes, Tees, Flags) ---
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
    
    const teeGeo = new THREE.SphereGeometry(0.35, 16, 16); // Teekulor istället för block
    const teeMat = new THREE.MeshLambertMaterial({ color: 0x38bdf8 });
    const flagPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 6, 8);
    const flagPoleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const flagClothGeo = new THREE.PlaneGeometry(1.5, 1.0);
    const flagClothMat = new THREE.MeshLambertMaterial({ color: 0xef4444, side: THREE.DoubleSide });

    function createTeeObject(x, y, z, colorHex=0xfacc15) {
        let group = new THREE.Group();
        let tMat = new THREE.MeshLambertMaterial({ color: colorHex });
        
        // Vänstra Tee-kulan
        let meshLeft = new THREE.Mesh(teeGeo, tMat);
        meshLeft.position.set(-1.8, 0.35, 0);
        meshLeft.castShadow = true;
        
        // Högra Tee-kulan
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
        phole.position.set(0, 0.03, 0); // Precis ovanför gräset
        group.add(phole);
        
        let pole = new THREE.Mesh(flagPoleGeo, flagPoleMat);
        pole.position.set(0, 3.0, 0);
        pole.castShadow = true;
        let pflag = new THREE.Mesh(flagClothGeo, flagClothMat);
        pflag.position.set(0.75, 5.5, 0); // Fäst vid flaggstången
        pflag.castShadow = true;
        group.add(pole);
        group.add(pflag);
        
        group.position.set(x, y, z);
        scene.add(group);
        return group;
    }

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
        
        // outTotals
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
        document.getElementById('scorecard-modal').style.display = 'flex';
    };
    
    function createTargetAbsolute(x, y, z, colStr) {
        let exists = targets.find(t => t.mesh && t.mesh.position.x === x && Math.abs(t.mesh.position.y - y) < 0.1 && t.mesh.position.z === z);
        if(exists) return; // Prevent double placement
        
        const tGeo = new THREE.BoxGeometry(3, 4, 3);
        const tMat = new THREE.MeshLambertMaterial({ color: colStr });
        const target = new THREE.Mesh(tGeo, tMat);
        target.position.set(x, y, z);
        target.castShadow = true;
        scene.add(target);
        
        targets.push({ mesh: target, active: true, radius: 2.5, defColor: colStr });
    }

    function createTarget(x, z) {
        createTargetAbsolute(x, 2, z, new THREE.Color().setHSL(Math.random(), 1.0, 0.5).getHex());
    }

    window.hasUnsavedChanges = false;
    window.addEventListener('beforeunload', function (e) {
        if (appMode === 'BUILD' && window.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

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
        let name = document.getElementById('pub-name').value;
        let author = document.getElementById('pub-author').value;
        let stat = document.getElementById('pub-status');
        stat.style.display = 'none';

        function showError(msg) {
            stat.style.display = 'block';
            stat.style.color = '#ef4444';
            stat.innerHTML = "❌ " + msg;
        }

        if(!name && !options.isDraft) { showError("Please enter a course name!"); return; }
        
        // VALIDERINGSCHECK (Steg 3) - Skip if drafting!
        if (!options.isDraft) {
            let h1HasTee = courseHoles[0].tees && (courseHoles[0].tees.red || courseHoles[0].tees.yellow || courseHoles[0].tees.white || courseHoles[0].tees.black);
            if(!h1HasTee || !courseHoles[0].flag) {
                showError("Validation Error: You must build at least Hole 1 with a Tee and a Flag before publishing.");
                return;
            }
            for (let i=0; i<18; i++) {
                let h = courseHoles[i];
                let hasTee = h.tees && (h.tees.red || h.tees.yellow || h.tees.white || h.tees.black);
                if(hasTee && !h.flag) { showError(`Validation Error: Hole ${i+1} has a tee but no flag! Please fix before publishing.`); return; }
                if(h.flag && !hasTee) { showError(`Validation Error: Hole ${i+1} has a flag but no tee! Please fix before publishing.`); return; }
            }
        }
        
        let dumpTargets = targets.map(t => ({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor }));
        let dumpHoles = courseHoles.map(h => ({
            par: h.par, tees: h.tees, flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z} : null
        }));
        let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({type: t.type, x: t.x, z: t.z, s: t.scale, r: t.rot})) : [];
        
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
                is_draft: options.isDraft
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
                
                // Byt URL utan omladdning
                window.history.pushState({}, '', href);
                
                stat.style.color = '#4ade80';
                stat.innerHTML = "Sparad! Din länk:<br><a href='"+href+"' style='color:#38bdf8; word-break: break-all;'>" + href + "</a>";
                stat.style.display = 'block';
                
                if (options.isDraft && document.getElementById('btn-save-draft')) {
                    document.getElementById('btn-save-draft').style.display = 'block'; // Visar "skriv över"-knappen nu när vi har en EditCode
                }
            } else {
                showError("Failed: " + data.error);
            }
        } catch(e) {
            showError("Error connecting to server. Is the database active?");
        }
    };

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

        let targetCode = courseCode || editCode;

        if (targetCode) {
            try {
                let res = await fetch('/api/courses/' + targetCode);
                let data = await res.json();
                if(data.share_code) {
                    savedStr = data;
                    isCloud = true;
                    if (editCode) {
                        currentEditCode = data.share_code; // Vi LADDADE MÄS från draft url, vi är ägaren!
                        if(document.getElementById('pub-name')) document.getElementById('pub-name').value = data.name;
                        if(document.getElementById('pub-author')) document.getElementById('pub-author').value = data.author;
                        // Synliggör Spara Utkast (Samma Slot) om vi laddade en edit URL
                        if (document.getElementById('btn-save-draft')) document.getElementById('btn-save-draft').style.display = 'block';
                    }
                    if(typeof savedStr.holes === 'string') savedStr.holes = JSON.parse(savedStr.holes);
                    if(typeof savedStr.targets === 'string') savedStr.targets = JSON.parse(savedStr.targets);
                    if(typeof savedStr.trees === 'string') savedStr.trees = JSON.parse(savedStr.trees);
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
                            h.flagMesh = createFlagObject(h.flag.x, h.flag.y, h.flag.z);
                        }
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
                        for(let i=0; i<waterArr.length; i++) wPos.setZ(i, waterArr[i]);
                    }

                    pos.needsUpdate = true;
                    if(wPos) wPos.needsUpdate = true;
                    planeGeo.computeVertexNormals();

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
                        arr.trees.forEach(t => createTree(t.type, t.x, t.z, t.s, t.r));
                    }
                }
            } catch(e) {
                console.error("Fel vid parse av sparad bana", e);
            }
        }
        
        if (autoRun === 'setup') {
            setMode('PLAY');
            if (typeof startRound === 'function') setTimeout(startRound, 500);
        } else if (autoRun === 'edit_build' || autoRun === 'build') {
            setMode('BUILD');
        } else if (courseCode) {
            setMode('PLAY');
            if (typeof startRound === 'function') setTimeout(startRound, 500);
        } else if (!autoRun && !courseCode && !editCode) {
            // Default fallback
            setMode('TEST');
        }
        
        // Initialisera biome-cache the lazy way (for empty manual load triggers mostly)
        setTimeout(() => {
            if (typeof pCtx !== 'undefined') window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
        }, 800);
    }
    
    // SPEL LOGIK
    let isFlying = false;
    let flightData = null;
    let flightTick = 0;
    
    // ARCADE MODE VARS
    let points = 0;

    // PROJECT ASCENSION (ROUND MODE) VARS
    let playState = 'IDLE'; // 'IDLE', 'ROUND_IDLE', 'ROUND_FLYING', 'ROUND_HOLED_OUT'
    let playingHoleIndex = 0;
    let playingStrokes = 0;
    let broadcastCamPhase = 'TEE'; // 'TEE', 'LANDING'
    let landingCamPos = new THREE.Vector3();
    
    // THE GSPRO PLAYER STATE
    window.playerScores = Array(18).fill(null);
    window.totalScore = 0;
    
    // THE WIND ENGINE STATE
    window.currentWindMph = 0;
    window.currentWindDir = 0;
    window.currentWindVec = [0,0,0];

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

    // --- THE GLOBAL WIND ENGINE ---
    function updateWindEngine() {
        if (playState !== 'ROUND_IDLE' && playState !== 'ROUND_FLYING') return;
        
        let matchWindLevel = window.matchSettings ? window.matchSettings.windStrength : 0;
        let windMph = 0;
        if (matchWindLevel === 1) windMph = 5 + Math.random() * 5; // 5-10
        else if (matchWindLevel === 2) windMph = 10 + Math.random() * 8; // 10-18
        else if (matchWindLevel === 3) windMph = 18 + Math.random() * 7; // 18-25
        else if (matchWindLevel === 4) windMph = 25 + Math.random() * 10; // 25-35
        else if (matchWindLevel === 0) windMph = Math.random() * 2; // 0-2 (Calm)
        
        // Mjuka kastvindar: Rör sig långsamt mot en target
        window.currentWindMph += (windMph - window.currentWindMph) * 0.1;
        
        let windMs = window.currentWindMph * 0.44704;
        
        // Pseudo-random bas-vindriktning per hål, The Course Wind!
        let holeWindDir = (playingHoleIndex * 137.5) % 360; 
        
        // Gusts offset
        if (!window._targetGust) window._targetGust = 0;
        if (Math.random() < 0.2) window._targetGust = (Math.random() - 0.5) * 30; // +/- 15 graders kastvind
        window.currentWindDir += (window._targetGust - (window.currentWindDir - holeWindDir)) * 0.05;
        
        let finalDirRad = window.currentWindDir * Math.PI / 180;
        
        // Sätt in i Physics (X = Sida, Y = Framåt/Bakåt i Course Space)
        window.currentWindVec = [Math.sin(finalDirRad) * windMs, -Math.cos(finalDirRad) * windMs, 0];
        
        // Update Minimap Wind UI
        let wSpd = document.getElementById('minimap-wind-spd');
        let wArr = document.getElementById('minimap-wind-arr');
        if(wSpd && wArr && window.aimTarget && typeof ball !== 'undefined' && ball && ball.visible) {
            wSpd.innerText = Math.round(window.currentWindMph) + " MPH";
            
            // Konvertera Absolut Vind-direktion till Kamerans/Siktets referensram!
            let dX = window.aimTarget.x - ball.position.x;
            let dZ = window.aimTarget.z - ball.position.z;
            let aimAngleRad = Math.atan2(dX, -dZ); // Standard 3D Y är Upp, Z är inåt
            
            // finalDirRad är absolut. aimAngleRad är vart vi tittar.
            let relWindRad = aimAngleRad - finalDirRad;
            let relWindDeg = relWindRad * 180 / Math.PI;
            
            // Rotera UPP-pilen baserat på denna vinkel
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

// --- MULTIPLAYER ROSTER SETUP ---
    window.setupPlayers = [{ name: 'Spelaren 1', tee: 'yellow' }];
    
    window.renderPlayerRoster = function() {
        const list = document.getElementById('roster-list');
        if (!list) return;
        list.innerHTML = '';
        
        const hole1 = courseHoles[0] || {};
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
        window.setupPlayers.push({ name: `Spelaren ${window.setupPlayers.length + 1}`, tee: tee });
        window.renderPlayerRoster();
    };
    
    window.removePlayerFromRoster = function(idx) {
        if(window.setupPlayers.length <= 1) return;
        window.setupPlayers.splice(idx, 1);
        window.renderPlayerRoster();
    };

    window.commitSettingsAndStart = function() {
        if (window.setupPlayers.length === 0) return;
        
        // Ensure names are saved if users forgot to unfocus the input (onchange issue)
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
        
        window.GREEN_STIMP = window.matchSettings.greenStimp; // Backwards compatible
        
        document.getElementById('settings-modal').style.display = 'none';
        actuallyStartRound();
    };

    window.startRound = function() {
        if(appMode !== 'PLAY') return;

        let hole1 = courseHoles[0];
        let h1HasTee = hole1 && hole1.tees && (hole1.tees.yellow || hole1.tees.white || hole1.tees.red || hole1.tees.black);
        if(!hole1 || !h1HasTee || !hole1.flag) {
            alert("Hole 1 is missing a tee or a flag! You must build Hole 1 completely to play.");
            return;
        }
        
        // Match player default tee to whatever tee actually exists on hole 1
        let firstAvailableTee = hole1.tees.yellow ? 'yellow' : (hole1.tees.white ? 'white' : (hole1.tees.red ? 'red' : 'black'));
        window.setupPlayers.forEach(p => {
            if (!hole1.tees[p.tee]) p.tee = firstAvailableTee;
        });
        
        window.renderPlayerRoster();
        document.getElementById('settings-modal').style.display = 'flex';
    };

    
    function getTeeOrder() {
        let players = window.players;
        let pIndices = players.map((p,i) => i);
        if (playingHoleIndex === 0) {
            // Hole 1: Distance based from hole for TEE ordering (or list order)
            return pIndices; // List order for hole 1 as per user spec
        }
        
        let prevHole = playingHoleIndex - 1;
        
        // Honours: Lowest scoreVsPar plays FIRST
        pIndices.sort((a,b) => {
            let aScore = players[a].scoreVsPar[prevHole] || 0;
            let bScore = players[b].scoreVsPar[prevHole] || 0;
            if (aScore !== bScore) return aScore - bScore; // Ascending (lägst först)
            return a - b; 
        });
        return pIndices;
    }
    
    function getNextPlayerIndex() {
        let players = window.players;
        let notHoledOut = players.map((p,i) => i).filter(i => !players[i].holedOut);
        if (notHoledOut.length === 0) return -1; // Alla är klara
        
        // Är alla kvar på tee? (Ingen har slagit slag)
        let allOnTee = notHoledOut.every(i => players[i].strokes === 0 && players[i].penaltyStrokes === 0);
        if (allOnTee) {
            let teeOrder = getTeeOrder();
            // Nästa från tee-order som inte slagit!
            let nextId = teeOrder.find(id => notHoledOut.includes(id) && players[id].strokes === 0);
            if(nextId !== undefined) return nextId;
        }
        
        // Ute på banan -> Furthest from hole goes first!
        let hole = courseHoles[playingHoleIndex];
        let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        notHoledOut.sort((a,b) => {
            let pA = players[a]; let pB = players[b];
            let dA = new THREE.Vector3(pA.lie.x, pA.lie.y, pA.lie.z).distanceTo(fv);
            let dB = new THREE.Vector3(pB.lie.x, pB.lie.y, pB.lie.z).distanceTo(fv);
            return dB - dA; // Descending (längst slår först)
        });
        return notHoledOut[0];
    }
    
    function teleportToHole(index) {
        let hole = courseHoles[index];
        let anyTee = hole ? (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black) : null;
        if(!hole || !anyTee || !hole.flag) {
            alert("Hole " + (index+1) + " is not fully built! Needs both a Tee and a Flag.");
            return;
        }

        // Sätt initiala LIES & TEES för alla players
        window.players.forEach((p, idx) => {
            p.holedOut = false;
            p.strokes = 0;
            p.penaltyStrokes = 0;
            
            // Hitta deras valda tee (eller fallback)
            let activeT = hole.tees[p.tee] || hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black;
            p.teePosition = { x: activeT.x, y: activeT.y, z: activeT.z };
            p.lie = { x: activeT.x, y: activeT.y + 0.3, z: activeT.z }; // Startar på peggen!
        });

        let startPlayerIdx = getNextPlayerIndex();
        switchTurnTo(startPlayerIdx);
    }
    
    function switchTurnTo(idx) {
        if(idx === -1) {
            nextHole(); // Hela fältet är klara
            return;
        }
        
        window.activePlayerIndex = idx;
        let p = window.players[idx];
        
        // Visa ställningen för den aktiva spelaren
        updatePlayerBanner();
        
        // Återställ boll-statusen till idle för denna spelare
        window.ballLocked = false;
        if (playState !== 'ROUND_PUTTING') playState = 'ROUND_IDLE'; // eller behåll putting logik  
        
        // Ställ upp bollen på deras nuvarande lie
        ball.visible = true;
        ball.position.set(p.lie.x, p.lie.y, p.lie.z);
        ball.velocity = new THREE.Vector3(0,0,0);
        ball.angularVelocity = new THREE.Vector3(0,0,0);
        
        window.aimTarget = new THREE.Vector3();
        
        // Vänd kameran framåt
        let hole = courseHoles[playingHoleIndex];
        let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        let dir = new THREE.Vector3().subVectors(fv, ball.position).normalize();
        
        let camDist = 5; let camHeight = 3;
        camera.position.copy(ball.position).add(new THREE.Vector3(-dir.x * camDist, camHeight, -dir.z * camDist)); 
        controls.target.copy(ball.position).add(new THREE.Vector3(dir.x * 20, 0, dir.z * 20)); 
        controls.enabled = true;
        controls.update();

        // Uppdatera Trackers
        let trck = document.getElementById('ball-tracker');
        if (trck) trck.style.display = 'none';

        // Flash turn message om vi har slagit slag och byter spelare
        let pop = document.getElementById('score-popup');
        pop.innerText = p.name.toUpperCase() + "'S TURN";
        pop.style.color = "#38bdf8";
        pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
        pop.style.opacity = '1';
        setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 2500);
    }
    
    window.evaluateNextTurn = function() {
        let p = window.players[window.activePlayerIndex];
        let hole = courseHoles[playingHoleIndex];
        let maxConcede = window.matchSettings ? window.matchSettings.autoConcede : 99;
        let maxScore = hole ? (hole.par || 4) + maxConcede : 99;
        
        // Spara deras position eftersom dom precis slagit bollen (vi antar bollen stannat)
        p.lie = {x: ball.position.x, y: ball.position.y, z: ball.position.z};

        // Uppdatera HUD Banner till att visa korrekt avstånd för nästa slag!
        if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();

        if (p.strokes + p.penaltyStrokes >= maxScore && maxConcede !== 99 && !p.holedOut) {
            p.holedOut = true;
            p.strokes = maxScore;
            
            // Pop-up för concede!
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
        
        // Hitta vem som ska slå näst
        let nextPlayer = getNextPlayerIndex();
        if(nextPlayer === -1) {
            setTimeout(nextHole, 2500);
        } else {
            // Om nextPlayer är samma spelare (pga farthest, eller ensam), uppdatera inte kameran direkt för man ser landningen
            // Om de hålade ut måste vi vänta så de ser bollen trilla i
            setTimeout(() => {
                switchTurnTo(nextPlayer);
            }, p.holedOut ? 2500 : 1000);
        }
    }

    window.actuallyStartRound = function() {
        if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
        
        document.getElementById('settings-modal').style.display = 'none';

        playState = 'ROUND_IDLE';
        playingHoleIndex = 0;
        
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
        document.getElementById('player-banner').querySelector('#pb-name').style.display = 'inline-block'; // Visa Namn!
        
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
        
        // Uppdatera Namnet & Score
        document.getElementById('pb-score').innerHTML = totalDisplay + " <span style='font-size:12px; color:#94a3b8;'>| " + p.name + "</span>";
        
        // Uppdatera Shot X
        let totalStrokes = p.strokes + p.penaltyStrokes;
        document.getElementById('pb-shot').innerText = "Shot " + (totalStrokes + 1);
        
        // Uppdatera Distans om vi har the pin
        if (hole.flag && ball && ball.visible) {
            // Använd faktiska bollpositionen för live-kalkyl
            let dist = ball.position.distanceTo(new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z));
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
        playingHoleIndex++;
        let activeT = courseHoles[playingHoleIndex] ? (courseHoles[playingHoleIndex].tees.yellow || courseHoles[playingHoleIndex].tees.white || courseHoles[playingHoleIndex].tees.red || courseHoles[playingHoleIndex].tees.black) : null;
        if(playingHoleIndex > 17 || !activeT) {
            let pop = document.getElementById('score-popup');
            pop.innerText = "ROUND COMPLETE!";
            pop.style.opacity = '1';
            pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
            setTimeout(() => { pop.style.opacity = '0'; }, 3000);
            
            playState = 'IDLE';
            document.getElementById('player-banner').style.display = 'none';
            document.getElementById('play-tools').style.display = 'none';
            document.getElementById('btn-start-round').style.display = 'block';
            
            renderScorecard();
            document.getElementById('scorecard-modal').style.display = 'flex';
            return;
        }
        
        teleportToHole(playingHoleIndex);
    }
    function renderScorecard() {
        let tbody = document.getElementById('scorecard-tbody');
        if(!tbody) return;
        
        let htmlMode = '';
        // Vi måste kunna hantera både 9 hål och 18 hål
        let maxHoles = 18; 
        if (!courseHoles[9] || !courseHoles[9].flag) maxHoles = 9; // Kolla om hål 10 finns
        
        let parOut = 0; let parIn = 0;
        let scoreOut = 0; let scoreIn = 0;
        
        let trPar = `<tr style="color:#fbbf24; border-bottom:1px solid #334155;"><td>PAR</td>`;
        let trScore = `<tr style="color:#fff;"><td>SCORE</td>`;
        
        for(let i=0; i<9; i++) {
            let hole = courseHoles[i];
            let p = hole ? hole.par : '-';
            let s = window.playerScores[i] !== null ? window.playerScores[i] : '-';
            
            if(p !== '-') parOut += p;
            if(s !== '-') scoreOut += s;
            
            trPar += `<td>${p}</td>`;
            trScore += `<td>${s}</td>`;
        }
        trPar += `<td style="color:#fbbf24">${parOut > 0 ? parOut : '-'}</td>`;
        trScore += `<td style="color:#fbbf24">${scoreOut > 0 ? scoreOut : '-'}</td></tr>`;
        
        htmlMode += trPar + trScore;
        tbody.innerHTML = htmlMode;
    }
    
    // Teleport single-player override removed for multiplayer stability.

    // --- CAMERA TOGGLE ---
    window.camFollowMode = 'BROADCAST'; // 'BROADCAST', 'FOLLOW', 'FREE'
    window.toggleCamMode = function() {
        let btn = document.getElementById('btn-cam-mode');
        if (window.camFollowMode === 'BROADCAST') {
            window.camFollowMode = 'FOLLOW';
            btn.innerText = '🎥 FOLLOW';
            btn.style.background = '#64748b'; // slate-500
        } else if (window.camFollowMode === 'FOLLOW') {
            window.camFollowMode = 'FREE';
            btn.innerText = '🎥 FREE CAM';
            btn.style.background = '#ec4899'; // pink-500
        } else {
            window.camFollowMode = 'BROADCAST';
            btn.innerText = '🎥 BROADCAST';
            btn.style.background = '#4f46e5'; // indigo-600
        }
    };

    function fireShot() {
        if(isFlying) return; // Låt bollen landa
        
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
            
            // Obligatoriska defaults för HUD
            clubSpeedMph: 0,
            clubPathDeg: 0,
            faceToPathDeg: 0,
            clubAoADeg: 0
        };
        
        triggerRealShot(launchData);
    }
    
    function triggerRealShot(data) {
        if(isFlying) return;
        
        // --- UPPDATERA GSPro DATA HUD ---
        if(document.getElementById('hud-cp')) document.getElementById('hud-cp').innerText = typeof data.clubPathDeg === 'number' ? data.clubPathDeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-ftp')) document.getElementById('hud-ftp').innerText = typeof data.faceToPathDeg === 'number' ? data.faceToPathDeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-aoa')) document.getElementById('hud-aoa').innerText = typeof data.clubAoADeg === 'number' ? data.clubAoADeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-cs')) document.getElementById('hud-cs').innerText = typeof data.clubSpeedMph === 'number' ? data.clubSpeedMph.toFixed(1) + ' mph' : '---';
        if(document.getElementById('hud-hla')) document.getElementById('hud-hla').innerText = typeof data.azimDeg === 'number' ? data.azimDeg.toFixed(1) + '°' : '---';
        if(document.getElementById('hud-bs')) document.getElementById('hud-bs').innerText = typeof data.ballSpeedMph === 'number' ? data.ballSpeedMph.toFixed(1) + ' mph' : '---';
        if(document.getElementById('hud-vla')) document.getElementById('hud-vla').innerText = typeof data.launchAngleDeg === 'number' ? data.launchAngleDeg.toFixed(1) + '°' : '---';
        
        // Side spin approximation från SpinAxis (Om axis är 10 grader, ca 10% av spinnen blir side spin)
        let sSpin = (data.totalSpinRpm * Math.sin((data.spinAxisDeg||0) * Math.PI/180)) || 0;
        let bSpin = (data.totalSpinRpm * Math.cos((data.spinAxisDeg||0) * Math.PI/180)) || data.totalSpinRpm;
        if(document.getElementById('hud-ss')) document.getElementById('hud-ss').innerText = sSpin.toFixed(0);
        if(document.getElementById('hud-backspin')) document.getElementById('hud-backspin').innerText = bSpin.toFixed(0);
        if(document.getElementById('hud-sa')) document.getElementById('hud-sa').innerText = typeof data.spinAxisDeg === 'number' ? data.spinAxisDeg.toFixed(1) + '°' : '---';
        // Reset carry
        if(document.getElementById('hud-carry')) document.getElementById('hud-carry').innerText = '0 yds';
        if(document.getElementById('hud-carryraw')) document.getElementById('hud-carryraw').innerText = '0 yds';
        if(document.getElementById('hud-total')) document.getElementById('hud-total').innerText = '0 yds';
        
        // Updatera inmatningsfält visuellt 
        if(document.getElementById('in-speed')) document.getElementById('in-speed').value = (data.ballSpeedMph || 0).toFixed(1);
        if(document.getElementById('in-la')) document.getElementById('in-la').value = (data.launchAngleDeg || 0).toFixed(1);
        if(document.getElementById('in-hla')) document.getElementById('in-hla').value = (data.azimDeg || 0).toFixed(1);

        executeArcadeShot(data);
    }

    window.shotStartPos = null;

    function executeArcadeShot(data) {
        // Lås kamerakontroller så vi kan regissera kameran (OM VI INTE KÖR FREE-CAM)
        if (window.camFollowMode !== 'FREE') {
            controls.enabled = false; 
        } else {
            controls.enabled = true;
        }
        
        let startPos = [0, 0.3, 0];
        
        if (playState === 'ROUND_IDLE') {
            playState = 'ROUND_FLYING';
            let p = window.players[window.activePlayerIndex];
            
            p.prevPos = { x: ball.position.x, y: ball.position.y, z: ball.position.z };
            p.prevStrokes = p.strokes;
            p.prevPenalty = p.penaltyStrokes;
            
            p.strokes++;
            document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
            broadcastCamPhase = 'TEE';
            startPos = [ball.position.x, -ball.position.z, ball.position.y]; // Three X,Z,Y -> Phys X,Y,Z
        } else {
            // ARCADE MODE: Lås till (0, 0.3, 0)
            ball.position.set(0, 0.3, 0);
        }
        
        window.shotStartPos = { x: ball.position.x, y: ball.position.y, z: ball.position.z };

        var vStimpEl = document.getElementById('in-stimp');
        window.GREEN_STIMP = vStimpEl ? (parseFloat(vStimpEl.value) || 10.0) : 10.0;
        
        // --- 1. SIKTE- OCH OFFSET-LOGIK ---
        // Användarens grafiska sikte projiceras på fysikens azimut för att flyga dit du siktar.
        let aimOffsetDeg = 0;
        if ((appMode === 'PLAY' || appMode === 'TEST') && window.aimTarget) {
            let dX = window.aimTarget.x - ball.position.x;
            let dZ = window.aimTarget.z - ball.position.z;
            aimOffsetDeg = Math.atan2(dX, -dZ) * 180 / Math.PI;
        }

        var launchConfig = {
            startPos: startPos,
            ballSpeedMph: data.ballSpeedMph,
            launchAngleDeg: data.launchAngleDeg,
            totalSpinRpm: data.totalSpinRpm,
            spinAxisDeg: data.spinAxisDeg || 0,
            azimDeg: (data.azimDeg || 0) + aimOffsetDeg, // Lägg till sikt-vinkeln!
            isLiveData: data.isLiveData || false
        };
        var cupPosLocal = null;
        if (window.pinMesh) {
            // ThreeJS: Y is Up, -Z is forward -> Physics: Z is up, Y is forward
            // pinMesh.position.y is usually the terrain height
            cupPosLocal = [window.pinMesh.position.x, -window.pinMesh.position.z, window.pinMesh.position.y];
        }
        
        // --- ENVIRONMENTAL INJECTION (Wind & Altitude) ---
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
                // Fysik(X,Y,Z) -> ThreeJS(X,-Z,Y)
                let threeX = x;
                let threeZ = -y;
                
                for(let i=0; i<window.placedTrees.length; i++) {
                    let obj = window.placedTrees[i];
                    
                    let dx = obj.x - threeX;
                    let dz = obj.z - threeZ;
                    let distSq = dx*dx + dz*dz;
                    let dist = Math.sqrt(distSq) || 0.001;

                    // Normal som pekar ut från objektet mot bollen
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
                let gzDown = Math.max(0, gz - 1); // gz minskar -> Z ökar -> Y(phys) ökar

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
                    r = 74; g = 222; b = 128; // Fairway fallback
                }
                
                let biomeType = 'ROUGH'; // Default
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
                
                // Då kan du ha snustorra bunkrar på -40m, vattnet triggar bara där du faktiskt grävt vatten!
                if (waterHeight > -90 && height < waterHeight + 0.1) {
                    biomeType = 'WATER';
                    height = waterHeight; // Möt ytan exakt
                }
                return {
                    z: height,
                    normal: normal, 
                    type: biomeType
                };
            }
        };
        
        // --- CACHE PIXELDATA INFÖR SKOTT ---
        window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
        
        // Simulera The Matrix med nya Fysikmotorn
        let result = window.GolfPhysics.simulateFlight(launchConfig, envCtx);
        if (!result) return;
        
        flightData = result; // Path är result.path
        flightTick = 0;
        isFlying = true;
        
        tracerPointsCount = 0;
        flightTracer.geometry.setDrawRange(0, 0);
        isFlying = true;
    }

    // 5. BUILD MODE & RAYCASTING
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
    let currentBuildColor = 0xef4444; // Default Red
    
    // Ghost block (Blueprint)
    const ghostGeo = new THREE.BoxGeometry(3, 4, 3);
    const ghostMat = new THREE.MeshBasicMaterial({ color: currentBuildColor, opacity: 0.5, transparent: true, wireframe: false });
    const ghostBlock = new THREE.Mesh(ghostGeo, ghostMat);
    ghostBlock.visible = false;
    scene.add(ghostBlock);

    // GHOST TREE / BUSH (Indikator när man har Nature verktyget)
    const ghostTree = new THREE.Mesh(bushGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, wireframe: true, transparent:true, opacity: 0.7 }));
    ghostTree.visible = false;
    scene.add(ghostTree);
    
    // The static gridHelper was removed because it clipped through sculpted terrain and water.

    // Skulpterings-variabler
    let isSculpting = false;
    let sculptDirection = 1;
    let currentTool = 'SCULPT'; // 'BLOCK' eller 'SCULPT'
    let currentBrushSize = 6.0;

    // Spline-variabler
    let splinePoints = [];
    let splineSpheres = [];
    let splineLineMesh = null;
    let splinePreviewMesh = null;

    // Pensel multiplikator logik
    let brushMultiplier = 1;
    window.ipadSculptDir = 1;
    window.toggleIpadSculpt = function() {
        window.ipadSculptDir = window.ipadSculptDir === 1 ? -1 : 1;
        let btn = document.getElementById('ipad-sculpt-btn');
        if (window.ipadSculptDir === 1) {
            btn.innerText = "⬆️ RAISE";
            btn.style.background = "#4ade80"; // green
            btn.style.color = "#0f172a";
        } else {
            btn.innerText = "⬇️ LOWER";
            btn.style.background = "#ef4444"; // red
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

    // Funktion för radiesnurran
    window.updateBrushSize = function() {
        let val = document.getElementById('brush-slider') ? document.getElementById('brush-slider').value : 6;
        currentBrushSize = parseFloat(val) * brushMultiplier;
        if(sculptBrushCursor) {
            sculptBrushCursor.geometry.dispose();
            sculptBrushCursor.geometry = new THREE.RingGeometry(currentBrushSize - 0.5, currentBrushSize, 32);
        }
    };

    // Global Undo-Stack
    const undoStack = [];
    window.performUndo = function() {
        if (undoStack.length === 0) return;
        let state = undoStack.pop();
        
        // Återställ höjder
        let posArr = planeGeo.attributes.position.array;
        for(let i=0; i<posArr.length; i++) posArr[i] = state.heights[i];
        planeGeo.attributes.position.needsUpdate = true;
        planeGeo.computeVertexNormals();
        
        if (state.wHeights && typeof waterGeo !== 'undefined' && waterGeo) {
            let wPosArr = waterGeo.attributes.position.array;
            for(let i=0; i<wPosArr.length; i++) wPosArr[i] = state.wHeights[i];
            waterGeo.attributes.position.needsUpdate = true;
        }
        
        // Återställ färg
        pCtx.clearRect(0,0,4096,4096);
        pCtx.drawImage(state.colorCanvas, 0, 0);
        mapTex.needsUpdate = true;
        
        // Återställ vatten alfa
        if (state.waterColorCanvas && typeof wCtx !== 'undefined') {
            wCtx.clearRect(0,0,4096,4096);
            wCtx.drawImage(state.waterColorCanvas, 0, 0);
            if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
        }
        
        // Återställ block
        targets.forEach(t => scene.remove(t.mesh));
        targets.length = 0;
        if (state.blocks) {
            state.blocks.forEach(b => createTargetAbsolute(b.x, b.y, b.z, b.color));
        }
        
        // Återställ natur
        treesGroup.clear();
        window.placedTrees.length = 0;
        if (state.trees) {
            state.trees.forEach(t => createTree(t.type, t.x, t.z, t.scale, t.rot));
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
        
        undoStack.push({ 
            heights: posCopy, 
            wHeights: wPosCopy, 
            colorCanvas: cCopy, 
            waterColorCanvas: wCanvasCopy, 
            blocks: blocksCopy, 
            trees: treesCopy 
        });
    }

    window.addEventListener('pointermove', onMouseMove, false);
    
    // WASD Movement state
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

    // Använd pointerdown / pointerup för att hantera "drag" skulptering
    renderer.domElement.addEventListener('pointerdown', e => {
        if(appMode !== 'BUILD') return;
        if(currentTool === 'INSPECT') return;
        
        // Spara Undo-State precis vid klick! (Bara om de ritar/modifierar något)
        let isModifyingClick = e.button === 0 || e.button === 2;
        if(currentTool !== 'PAINT' && currentTool !== 'MEASURE' || isModifyingClick) { 
             if (currentTool !== 'MEASURE' && currentTool !== 'SPLINE') saveUndoState(); 
        }

        if(currentTool === 'MEASURE') {
            if(e.button === 0 && lastHitPoint) {
                // Börja mäta
                measureStartPoint = lastHitPoint.clone();
                measureLines.visible = false; // Dölj tills vi drar
                document.getElementById('measure-hud').style.display = 'block';
                controls.enabled = false;
                isMeasuring = true;
            } else if (e.button === 2) {
                // Rensa mätning med högerklick
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
        } else if(currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP') {
            isSculpting = true;
            controls.enabled = false; // Lås kameran när vi skulpterar
            // Vänsterklick = Upp. Högerklick ELLER Shift+Vänster = Ner.
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
                    waterLevelTarget = existingWater; // Klick på sjö -> Lås ytan, djupdyk botten utan att ändra ytan!
                } else {
                    waterLevelTarget = lastHitPoint.y - 0.5; // Gräv en platt botten 0.5m lägre än där vi klickade
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
            controls.enabled = true; // Släpp kameran
            if(currentTool !== 'PAINT') {
                planeGeo.computeVertexNormals(); 
                planeGeo.computeBoundingBox();
                planeGeo.computeBoundingSphere();
                snapObjectsToGround(); // Auto-lyft objekt som begravts!
            }
        } else if(currentTool === 'MEASURE' && isMeasuring) {
            isMeasuring = false;
            controls.enabled = true; 
        }
    }, false);
    
    // Blockera webbläsarens högerklick helt i canvas
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault(), false);
    
    function setMode(mode) {
        if ((appMode === 'BUILD' || appMode === 'ARCHITECT') && (mode === 'PLAY' || mode === 'TEST')) {
            // Skapa Green Mask inför minikartan
            if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
        }
        appMode = mode;
        let btnBuild = document.getElementById('btn-mode-build');
        let btnPlay = document.getElementById('btn-mode-play');

        if(btnBuild) {
            btnBuild.style.display = mode === 'PLAY' ? 'none' : 'block';
            btnBuild.style.background = mode === 'BUILD' ? '#38bdf8' : '#0f172a';
            btnBuild.style.color = mode === 'BUILD' ? '#0f172a' : '#38bdf8';
        }
        
        if (btnPlay) {
            btnPlay.style.display = mode === 'PLAY' ? 'none' : 'block';
            if (mode === 'BUILD' || mode === 'TEST') {
                btnPlay.innerHTML = mode === 'TEST' ? '🏌️ TESTA' : '🔥 TESTA BANAN';
                btnPlay.onclick = () => setMode('TEST');
                btnPlay.style.background = mode === 'TEST' ? '#ef4444' : '#0f172a';
                btnPlay.style.color = mode === 'TEST' ? '#fff' : '#ef4444';
                btnPlay.style.borderColor = '#ef4444';
            }
        }
        
        document.getElementById('build-palette').style.display = mode === 'BUILD' ? 'flex' : 'none';
        
        let playControls = document.getElementById('play-controls');
        if (playControls) playControls.style.display = (mode === 'PLAY' || mode === 'TEST') ? 'flex' : 'none';
        
        let startBtn = document.getElementById('btn-start-round');
        if (startBtn) startBtn.style.display = mode === 'PLAY' ? 'block' : 'none';

        let scoreHud = document.querySelector('.score-hud');
        if(scoreHud) scoreHud.style.display = (mode === 'BUILD' || mode === 'TEST') ? 'none' : 'block';
        
        let dataBtn = document.getElementById('btn-toggle-data');
        if(dataBtn) dataBtn.style.display = mode === 'BUILD' ? 'none' : 'block';
        
        let gsProHud = document.getElementById('gspro-hud');
        if(gsProHud && mode === 'BUILD') gsProHud.classList.add('hidden');
        
        if (mode === 'BUILD') {
            playState = 'BUILDING'; // Nollställ playState från tidigare test-rundor
            window.aimTarget = null; // Rensa eventuella gamla sikten
            
            controls.enabled = true;
            // Move camera up to look down a bit
            camera.position.set(0, 15, 10);
            controls.target.set(0, 0, -30);
            controls.update();
        } else if (mode === 'TEST') {
            controls.enabled = true;
            ghostBlock.visible = false;
            playState = 'ROUND_IDLE';
            window.activePlayerId = 'tester';
            window.players = [ { id: 'tester', name: 'TEST', color: '#ef4444', scoreOffset:0, holeScores:[], strokes:0, penaltyStrokes:0, isActive:true } ];
            let tee = (courseHoles[0] && courseHoles[0].tees) ? (courseHoles[0].tees.yellow || courseHoles[0].tees.red) : null;
            if(tee) {
                if(typeof ballPos !== 'undefined') {
                    ballPos.x = tee.x; ballPos.y = tee.y + 0.2; ballPos.z = tee.z;
                    if(typeof ballMesh !== 'undefined') ballMesh.position.set(ballPos.x, ballPos.y, ballPos.z);
                    camera.position.set(ballPos.x, ballPos.y + 2, ballPos.z + 10);
                    controls.target.set(ballPos.x, ballPos.y, ballPos.z - 20);
                    controls.update();
                }
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
            for(let t of window.placedTrees) t.mesh.position.y = getH(t.mesh.position.x, t.mesh.position.z);
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
        document.getElementById('green-btn-hard').style.background = diff === 'HARD' ? '#fbbf24' : '#334155';
        document.getElementById('green-btn-hard').style.color = diff === 'HARD' ? '#0f172a' : '#94a3b8';
    }

    function setTool(toolName) {
        currentTool = toolName;
        document.getElementById('tool-inspect').style.background = toolName === 'INSPECT' ? '#a855f7' : 'transparent';
        document.getElementById('tool-inspect').style.color = toolName === 'INSPECT' ? '#0f172a' : '#94a3b8';
        
        document.getElementById('tool-sculpt').style.background = toolName === 'SCULPT' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-sculpt').style.color = toolName === 'SCULPT' ? '#0f172a' : '#94a3b8';
        
        document.getElementById('tool-smooth').style.background = toolName === 'SMOOTH' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-smooth').style.color = toolName === 'SMOOTH' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-flatten').style.background = toolName === 'FLATTEN' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-flatten').style.color = toolName === 'FLATTEN' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-ramp').style.background = toolName === 'RAMP' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-ramp').style.color = toolName === 'RAMP' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-noise').style.background = toolName === 'NOISE' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-noise').style.color = toolName === 'NOISE' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-spline').style.background = toolName === 'SPLINE' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-spline').style.color = toolName === 'SPLINE' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-water').style.background = toolName === 'WATER' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-water').style.color = toolName === 'WATER' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-paint').style.background = toolName === 'PAINT' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-paint').style.color = toolName === 'PAINT' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-smartgreen').style.background = toolName === 'SMART_GREEN' ? '#98ce68' : 'transparent';
        document.getElementById('tool-smartgreen').style.color = toolName === 'SMART_GREEN' ? '#0f172a' : '#98ce68';

        document.getElementById('tool-ridge').style.background = toolName === 'RIDGE' ? '#fbbf24' : 'transparent';
        document.getElementById('tool-ridge').style.color = toolName === 'RIDGE' ? '#0f172a' : '#fbbf24';

        document.getElementById('tool-nature').style.background = toolName === 'NATURE' ? '#4ade80' : 'transparent';
        document.getElementById('tool-nature').style.color = toolName === 'NATURE' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-forest').style.background = toolName === 'FOREST' ? '#4ade80' : 'transparent';
        document.getElementById('tool-forest').style.color = toolName === 'FOREST' ? '#0f172a' : '#94a3b8';

        document.getElementById('tool-block').style.background = toolName === 'BLOCK' ? '#4ade80' : 'transparent';
        document.getElementById('tool-block').style.color = toolName === 'BLOCK' ? '#0f172a' : '#94a3b8';
        
        document.getElementById('tool-hole').style.background = toolName === 'HOLE' ? '#ef4444' : 'transparent';
        document.getElementById('tool-hole').style.color = toolName === 'HOLE' ? '#0f172a' : '#94a3b8';
        
        document.getElementById('tool-measure').style.background = toolName === 'MEASURE' ? '#fbbf24' : 'transparent';
        document.getElementById('tool-measure').style.color = toolName === 'MEASURE' ? '#0f172a' : '#fbbf24';
        
        document.getElementById('color-picker-group').style.display = (toolName === 'BLOCK' || toolName === 'PAINT') ? 'flex' : 'none';
        document.getElementById('nature-picker-group').style.display = (toolName === 'NATURE') ? 'flex' : 'none';
        document.getElementById('hole-picker-group').style.display = (toolName === 'HOLE') ? 'flex' : 'none';
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
        else if (toolName === 'RIDGE') hintHtml = "Hold Mouse: <b>Draw a Tier/Ridge line across the green</b>";
        else if (toolName === 'MEASURE') hintHtml = "Left Drag: <b>Measure Box</b><br>Right Click: <b>Clear Box</b>";
        else if (toolName === 'HOLE') hintHtml = "Left Click: <b>Place Selected Marker</b>";
        
        document.getElementById('tool-hints').innerHTML = hintHtml;
        
        ghostBlock.visible = false;
        sculptBrushCursor.visible = false;
        ghostTree.visible = false;
        if(toolName !== 'MEASURE') {
            document.getElementById('measure-hud').style.display = 'none';
            if(typeof measureLines !== 'undefined') measureLines.visible = false;
        }
    }

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
            window.placedTrees.forEach(t => scene.remove(t.mesh));
            window.placedTrees.length = 0;
        }
        
        for(let i=0; i<18; i++) {
            if(courseHoles[i].teeMesh) { scene.remove(courseHoles[i].teeMesh); courseHoles[i].teeMesh=null; }
            if(courseHoles[i].flagMesh) { scene.remove(courseHoles[i].flagMesh); courseHoles[i].flagMesh=null; }
            courseHoles[i].tee = null;
            courseHoles[i].flag = null;
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
        } else if (currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'MEASURE' || currentTool === 'HOLE' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP') {
            ghostBlock.visible = false;
            ghostTree.visible = false;
            raycaster.setFromCamera(mouse, camera);
            let intersects = raycaster.intersectObject(plane);
            if(intersects.length > 0) {
                lastHitPoint = intersects[0].point;
                if(currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN' || currentTool === 'PAINT' || currentTool === 'WATER' || currentTool === 'SMART_GREEN' || currentTool === 'RIDGE' || currentTool === 'NOISE' || currentTool === 'FOREST' || currentTool === 'RAMP') {
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
            }
            saveLevel();
            return;
        }
        
        if (currentTool === 'NATURE' && lastHitPoint) {
            let selectedType = currentNatureType;
            if (currentNatureType === 'RANDOM') {
                let types = ['TREE', 'BUSH', 'PALM', 'OAK', 'PINE', 'ROCK', 'CACTUS'];
                selectedType = types[Math.floor(Math.random() * types.length)];
            }
            let s = 1.0 + (Math.random() * 0.4 - 0.2); // 0.8 till 1.2 x storlek
            
            // Extrema storleksvariationer baserat på typ!
            if (selectedType === 'OAK') s *= 1.8; // Ek-träd blir jättelika
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
                treesGroup.remove(window.placedTrees[closest].mesh);
                window.placedTrees.splice(closest, 1);
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
                if (appMode !== 'PLAY' || playState !== 'ROUND_IDLE') return;
                
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
                    let aimDir = new THREE.Vector3().subVectors(window.aimTarget, ball.position).normalize();
                    if (window.isPuttingMode) {
                        camera.position.copy(ball.position).add(new THREE.Vector3(-aimDir.x * 2.5, 0.4, -aimDir.z * 2.5));
                    } else {
                        camera.position.copy(ball.position).add(new THREE.Vector3(-aimDir.x * 5, 2, -aimDir.z * 5));
                    }
                    controls.target.copy(window.aimTarget);
                    controls.update();
                }
            });
        }
    });

    const targetPaintColor = new THREE.Color();
    let previousFrameHitPoint = null;
    
    window.localGetTerrainAt = function(threeX, threeZ) {
        let gx = Math.round((threeX + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
        let gz = Math.round((threeZ + (TERRAIN_SIZE/2)) / (TERRAIN_SIZE/TERRAIN_SEGS));
        if(gx < 0) gx = 0; if(gx > TERRAIN_SEGS) gx = TERRAIN_SEGS;
        if(gz < 0) gz = 0; if(gz > TERRAIN_SEGS) gz = TERRAIN_SEGS;
        let idx = gz * (TERRAIN_SEGS+1) + gx;
        let positions = planeGeo.attributes.position.array;
        let height = positions[idx * 3 + 2];
        return { z: height };
    };

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
                        
                        let types = ['TREE', 'PINE', 'OAK', 'BUSH', 'ROCK'];
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

        // --- GSPRO GREEN BEADS VISUALIZATION ---
        if (window.isPuttingMode && playState === 'ROUND_IDLE') {
            let hole = courseHoles[playingHoleIndex];
            if (hole && hole.flag) {
                if (window.greenBeads.length === 0) {
                    // Generera ett stort grid runt flaggan/bollen
                    for(let x=-8; x<=8; x+=0.6) {
                        for(let z=-8; z<=8; z+=0.6) {
                            let bead = new THREE.Mesh(beadGeo, beadMat);
                            bead.startX = hole.flag.x + x;
                            bead.startZ = hole.flag.z + z;
                            bead.position.set(bead.startX, 0, bead.startZ);
                            // Sprid start-tiden lite så de inte alla "poppar" samtidigt
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
                            // Exponentiell känsla för slope. Mycket slope = jättesnabbt
                            let speed = slopeMag * stimp * 2.0; 
                            
                            // GRAIN-INFUSION
                            let sx = Math.sin(bead.position.x * 0.3 + bead.position.z * 0.2);
                            let sz = Math.cos(bead.position.z * 0.3 - bead.position.x * 0.2); 
                            let currentStimp = window.GREEN_STIMP || 10.0;
                            let grainScale = 0.03 * (10.0 / currentStimp);
                            
                            let gl = Math.sqrt(sx*sx + sz*sz + 1e-6);
                            let grainDirX = (sx / gl);
                            let grainDirZ = (sz / gl);
                            
                            // Grain force (x25 artificiell multiplikator för att det ska synas på pärlorna relativt till speed)
                            bead.position.x += (dirX * speed + grainDirX * grainScale * 25.0) * dt;
                            bead.position.z += (dirZ * speed + grainDirZ * grainScale * 25.0) * dt;
                        } else {
                            // Även en perfekt platt yta drar beads iväg pga grain (om än sakta)
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
                    if (traveled > (0.8 + bead.distOffset * 0.4)) {
                        bead.position.x = bead.startX;
                        bead.position.z = bead.startZ;
                    }
                }

                // --- GSPro Break Line Indicator ---
                if (window.breakLineMesh) {
                    scene.remove(window.breakLineMesh);
                    window.breakLineMesh = null;
                }
                let aimDir = new THREE.Vector3().subVectors(controls.target, camera.position);
                aimDir.y = 0; aimDir.normalize();
                
                let bPoints = [new THREE.Vector3(ball.position.x, ball.position.y, ball.position.z)];
                let bCur = { x: ball.position.x, z: ball.position.z };
                let bDir = aimDir.clone();
                // Förutspå rull 15 meter framåt
                for(let i=0; i<150; i++) {
                    let surf = localGetTerrainAt(bCur.x, -bCur.z);
                    if (!surf || surf.type !== 'GREEN') break;
                    let slopeForce = new THREE.Vector3(-surf.normal.x, 0, -surf.normal.z);
                    // slope påverkar rullriktningen
                    bDir.add(slopeForce.multiplyScalar(0.15));
                    
                    // Grain påverkar rullriktningen
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
        } else if (window.greenBeads && window.greenBeads.length > 0) {
            window.greenBeads.forEach(b => greenBeadsGroup.remove(b));
            window.greenBeads = [];
            if (window.breakLineMesh) {
                scene.remove(window.breakLineMesh);
                window.breakLineMesh = null;
            }
        }

        applySculpting();

        // Om bollen flyger, hämta nästa punkt i trajectory
        if (isFlying && flightData && flightData.path && flightTick < flightData.path.length) {
            
            // Vi spelar p fram 3 ticks per frame för att det ska gå snabbt nog visuellt!
            var step = 3; 
            var newTick = Math.min(flightTick + step, flightData.path.length - 1);
            
            var point = flightData.path[newTick];
            
            // Konvertera Fysik (x: Sida, y: Framåt, z: Höjd) till ThreeJS
            // X = Sida (x)
            // Y = Höjd (z)
            // Z = Framåt (Negativ y)
            ball.position.set(point.x, point.z + 0.0213, -point.y);
            
            for (let k = flightTick; k <= newTick; k++) {
                if (tracerPointsCount < MAX_TRACER_POINTS) {
                    let p = flightData.path[k];
                    tracerPositions[tracerPointsCount * 3] = p.x;
                    tracerPositions[tracerPointsCount * 3 + 1] = p.z + 0.0213;
                    tracerPositions[tracerPointsCount * 3 + 2] = -p.y;
                    tracerPointsCount++;
                }
            }
            flightTracer.geometry.attributes.position.needsUpdate = true;
            flightTracer.geometry.setDrawRange(0, tracerPointsCount);
            
            // --- FLIGHT CAMERA SYSTEM ---
            if (window.camFollowMode === 'FREE') {
                // FREE CAM: Släpp kameran fri. Användaren styr med OrbitControls!
                // Gör ingenting åt kamera-positionen.
            } else if (window.camFollowMode === 'FOLLOW') {
                // GSPRO REACTIVE FOLLOW (Classic Drone)
                let targetCamX = ball.position.x;
                let targetCamY = Math.max(3, ball.position.y + 3);
                let targetCamZ = ball.position.z + 12; // Konstant 12m offset bakom
                
                camera.position.x += (targetCamX - camera.position.x) * 0.1;
                camera.position.y += (targetCamY - camera.position.y) * 0.1;
                camera.position.z += (targetCamZ - camera.position.z) * 0.1;
                camera.lookAt(ball.position);
            } else {
                // TV BROADCAST / PROACTIVE LOOK-AHEAD
                if (playState === 'ROUND_FLYING') {
                    // För ROUND mode använder vi The TV Broadcast Director (Multi-angle)
                    if (broadcastCamPhase === 'TEE') {
                        camera.lookAt(ball.position);
                        if (flightTick > 45 && flightData.path.length > 90) {
                            broadcastCamPhase = 'LANDING';
                            let finalPhys = flightData.path[flightData.path.length-1];
                            landingCamPos.set(finalPhys.x, finalPhys.z + 3, -finalPhys.y - 15);
                            camera.position.copy(landingCamPos);
                        }
                    } else if (broadcastCamPhase === 'LANDING') {
                        camera.lookAt(ball.position);
                    }
                } else {
                    // TRACKMAN PROACTIVE LOOK-AHEAD
                    // Leta upp framtiden (ca 0.5s fram = 100 ticks vid 5ms/tick)
                    let aheadTick = Math.min(flightTick + 100, flightData.path.length - 1);
                    let aheadP = flightData.path[aheadTick];
                    let currP = flightData.path[flightTick];
                    
                    // Eftersom koden ej skickar vx just nu i metrics-pathen, kör vi en vMag approx:
                    let bVel = currP.vMag || 30; // vMag läggs ofta in i simFlight för tracers
                    
                    let zScale = 1.0 + (bVel / 50.0) * 0.8; // Skalar Z-offset från fart
                    
                    let targetCamX = aheadP.x;
                    let targetCamY = Math.max(3, (aheadP.z + 0.0213) + Math.abs(currP.vz || 0) * 0.05); // Y=Höjd i threeJS
                    let targetCamZ = -aheadP.y + (10 * zScale); // Fartskalat bakom The Look-Ahead Point
                    
                    // Mjuk Interpolering mot framtiden
                    camera.position.x += (targetCamX - camera.position.x) * 0.15;
                    camera.position.y += (targetCamY - camera.position.y) * 0.15;
                    camera.position.z += (targetCamZ - camera.position.z) * 0.15;
                    camera.lookAt(ball.position); // Position at future, look at ball today!
                }
            }
            
            // COLLISION DETECTION! Krockar bollen med ett block?
            for(let i=0; i<targets.length; i++) {
                let t = targets[i];
                if(t.active) {
                    let d = ball.position.distanceTo(t.mesh.position);
                    if(d < t.radius) {
                        t.active = false;
                        scene.remove(t.mesh); // PANG! Block försvinner.
                        
                        points += 500;
                        document.getElementById('score-val').textContent = points;
                        
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
                    let dX = finalPhys.x - window.shotStartPos.x;
                    let dZ = finalPhys.z - window.shotStartPos.z;
                    
                    let totalM = Math.sqrt(dX*dX + dZ*dZ);
                    let carryM = (flightData.metrics.carryMeters || 0);
                    
                    if (document.getElementById('hud-carry')) {
                        document.getElementById('hud-carry').innerText = window.formatDistStr(carryM);
                        document.getElementById('hud-carryraw').innerText = window.formatDistStr(carryM);
                        document.getElementById('hud-total').innerText = window.formatDistStr(totalM); 
                        
                        let offPath = Math.abs(finalPhys.x);
                        document.getElementById('hud-offline').innerText = window.formatDistStr(offPath);
                    }
                }
                
                if (playState === 'ROUND_FLYING') {
                    playState = 'ROUND_IDLE';
                    let hole = courseHoles[playingHoleIndex];
                    let distToPin = 999;
                    if(hole && hole.flag) {
                        distToPin = ball.position.distanceTo(new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z));
                        
                        // --- SMART AUTO-AIM EFTER SLAG ---
                        // Standard default-beteende för nästa slag är mot target progression (pin/green center)
                        if (window.aimTarget) {
                            window.aimTarget.set(hole.flag.x, hole.flag.y, hole.flag.z);
                            let aimDir = new THREE.Vector3().subVectors(window.aimTarget, ball.position).normalize();
                            if(aimDir.lengthSq() < 0.01) aimDir.set(0, 0, -1);
                            camera.position.copy(ball.position).add(new THREE.Vector3(-aimDir.x * 5, 2, -aimDir.z * 5));
                            controls.target.copy(window.aimTarget);
                        }
                    }
                    
                    setTimeout(() => {
                        let pop = document.getElementById('score-popup');
                        pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
                        
                        let lieSurface = localGetTerrainAt(ball.position.x, ball.position.z);
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
                        if (!shouldConcede && distFt <= gimmeMax) {
                            p.strokes += 1;
                            p.holedOut = true;
                            pop.innerText = `GIMME! (${distFt.toFixed(1)} ft) - 1 Putt`;
                            pop.style.opacity = '1';
                            setTimeout(() => { pop.style.opacity = '0'; evaluateNextTurn(); }, 4000);
                        } else if (!shouldConcede && (isGreen || distToPin < 20.0) && mode !== 'OFF') {
                            // AUTO-PUTT LOGIC (On Green or very close Fringe)
                            let putts = 2;
                            if (mode === 'TOUR_PRO') {
                                // Tour Pro Probability Math
                                let p1 = Math.max(0, 100 - (distFt * 6.2)); // 10ft = ~38% chance
                                let p3 = distFt > 20 ? (distFt - 20) * 0.8 : 0; // Starts from 20ft, e.g. 40ft = 16% risk
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
                            setTimeout(() => { pop.style.opacity = '0'; evaluateNextTurn(); }, 4000);
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
                    }, 2000);
                } else {
                    // ARCADE MODE: Klassisk reset efter 2 sekunder
                    setTimeout(() => {
                        controls.enabled = true; // Lås upp igen!
                        camera.position.set(0, 4, 10);
                        controls.target.set(0, 0, -20);
                        controls.update();
                    }, 2000);
                }
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
                let dist = ball.position.distanceTo(window.aimTarget);
                let elevDiff = window.aimTarget.y - ball.position.y;
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
                minimapCamera.position.set((ball.position.x + fv.x)/2, 300, (ball.position.z + fv.z)/2);
                
                let dist = ball.position.distanceTo(fv);
                
                // Låt "Uppåt" i kartan peka mot flaggan! (Vi räknar ut detta först för offset)
                let dir = new THREE.Vector3().subVectors(fv, ball.position);
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
                    let dX = window.aimTarget.x - ball.position.x;
                    let dZ = window.aimTarget.z - ball.position.z;
                    let flatD = Math.sqrt(dX*dX + dZ*dZ);
                    let dY = window.aimTarget.y - ball.position.y;
                    
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
                let pB = ball.position.clone().project(minimapCamera);
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
                
                dT.innerText = window.formatDistStr(ball.position.distanceTo(window.aimTarget), 0);
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
