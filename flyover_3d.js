/* ============================================
   GreenRead AR — Production 3D Flyover Engine
   LiDAR terrain + Satellite texture + Real trees
   No external APIs required
   ============================================ */

let scene, camera, renderer;
let terrainMesh;
let flyProgress = 0;
let isFlying = false;
let autoStart = true;

// Terrain height lookup cache
let terrainGrid = null;
let terrainMeta = null;

// Parse URL params
const urlParams = new URLSearchParams(window.location.search);
const holeName = urlParams.get('hole') || '1';
const parValue = urlParams.get('par') || '4';
const courseName = urlParams.get('course') ? decodeURIComponent(urlParams.get('course')) : 'Norrmjöle GK';
const totalDist = parseInt(urlParams.get('dist') || '382');

// Camera path control points
const cameraPath = [];
const FLIGHT_DURATION = 14; // seconds
let flightStartTime = 0;

init();

async function init() {
    const container = document.getElementById('flyover-container');

    // ======== SCENE ========
    scene = new THREE.Scene();

    // Nordic sky — atmospheric gradient
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2;
    skyCanvas.height = 1024;
    const skyCtx = skyCanvas.getContext('2d');
    const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 1024);
    skyGrad.addColorStop(0, '#050d1a');
    skyGrad.addColorStop(0.15, '#0d1f3c');
    skyGrad.addColorStop(0.3, '#1a3d5c');
    skyGrad.addColorStop(0.45, '#2d6a8a');
    skyGrad.addColorStop(0.55, '#4a9abb');
    skyGrad.addColorStop(0.65, '#7cbdd4');
    skyGrad.addColorStop(0.75, '#b5d8e8');
    skyGrad.addColorStop(0.85, '#d4c8a8');
    skyGrad.addColorStop(0.92, '#e8b870');
    skyGrad.addColorStop(1.0, '#c47830');
    skyCtx.fillStyle = skyGrad;
    skyCtx.fillRect(0, 0, 2, 1024);
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTexture;

    // Atmospheric fog
    scene.fog = new THREE.FogExp2(0x6a9abc, 0.0014);

    // ======== CAMERA ========
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 3000);

    // ======== RENDERER ========
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    // ======== LIGHTING — Nordic golden hour ========
    const ambientLight = new THREE.AmbientLight(0x8aadcc, 0.45);
    scene.add(ambientLight);

    // Main sun (low angle, golden)
    const sunLight = new THREE.DirectionalLight(0xffecd0, 1.0);
    sunLight.position.set(-250, 60, -200);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.left = -400;
    sunLight.shadow.camera.right = 400;
    sunLight.shadow.camera.top = 400;
    sunLight.shadow.camera.bottom = -400;
    sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    // Fill light (sky bounce)
    const fillLight = new THREE.DirectionalLight(0x8ec5e8, 0.2);
    fillLight.position.set(100, 300, 100);
    scene.add(fillLight);

    // Back light (rim light for depth)
    const rimLight = new THREE.DirectionalLight(0xffd090, 0.15);
    rimLight.position.set(0, 30, 300);
    scene.add(rimLight);

    // Hemisphere light 
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x2d5a1e, 0.35);
    scene.add(hemiLight);

    // ======== LOAD DATA ========
    let fairwayData = null;
    let treeData = null;
    let satTexture = null;

    // Terrain
    try {
        const res = await fetch(`data/fairway_hole${holeName}.json`);
        fairwayData = await res.json();
        terrainGrid = fairwayData.points;
        terrainMeta = fairwayData.metadata;
    } catch (e) {
        console.warn('No LiDAR terrain data, using procedural');
    }

    // Trees
    try {
        const res = await fetch(`data/trees_hole${holeName}.json`);
        treeData = await res.json();
    } catch (e) {
        console.warn('No tree data');
    }

    // Satellite texture
    try {
        satTexture = await loadSatelliteTexture(holeName);
    } catch (e) {
        console.warn('No satellite texture, using vertex colors');
    }

    // ======== BUILD TERRAIN ========
    if (fairwayData) {
        buildLiDARTerrain(fairwayData, satTexture);
    } else {
        buildProceduralTerrain();
    }

    // ======== BUILD TREES ========
    if (treeData && treeData.length > 0) {
        buildNordicForest(treeData);
    } else {
        buildProceduralForest();
    }

    // ======== BUILD COURSE FEATURES ========
    buildGreen();
    buildBunkers();
    buildFlagstick();
    buildTeeBox();
    buildFairwayStripes();
    buildDistanceMarkers();
    buildElevationBadges();

    // ======== CAMERA PATH ========
    setupCameraPath();

    // ======== HUD ========
    updateHUD();

    // ======== EVENTS ========
    window.addEventListener('resize', onResize);
    document.getElementById('btn-fly')?.addEventListener('click', startFlight);

    // Auto-start
    if (autoStart) {
        setTimeout(() => startFlight(), 1200);
    }

    animate();
}

// ============================================
// SATELLITE TEXTURE LOADER
// ============================================
function loadSatelliteTexture(holeNum) {
    return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(
            `data/sat_hole${holeNum}.jpg`,
            (texture) => {
                texture.encoding = THREE.sRGBEncoding;
                texture.anisotropy = 8;
                resolve(texture);
            },
            undefined,
            () => reject(new Error('Satellite texture not found'))
        );
    });
}

// ============================================
// LiDAR TERRAIN WITH SATELLITE TEXTURE
// ============================================
function buildLiDARTerrain(data, satTexture) {
    const w = data.metadata.width;
    const d = data.metadata.depth;
    const res = data.metadata.resolution;
    const heights = data.points;

    // Extended terrain area
    const extFactor = 2.5;
    const extW = w * extFactor;
    const extD = d * extFactor;
    const extRes = Math.min(res * 2, 400);

    const geometry = new THREE.PlaneGeometry(extW, extD, extRes, extRes);
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
        const vx = positions.getX(i);
        const vz = positions.getY(i);

        // Map to data coordinates
        const dataX = (vx + w / 2) / w * res;
        const dataZ = (vz + d / 2) / d * res;

        const ixC = Math.max(0, Math.min(res, Math.round(dataX)));
        const izC = Math.max(0, Math.min(res, Math.round(dataZ)));

        let h = 0;
        const inBounds = vx >= -w / 2 && vx <= w / 2 && vz >= -d / 2 && vz <= d / 2;

        if (inBounds && heights[izC] && heights[izC][ixC] !== undefined) {
            h = heights[izC][ixC];
        } else {
            // Outside LiDAR data: blend to gentle terrain
            const edgeDist = Math.max(
                Math.max(0, Math.abs(vx) - w / 2),
                Math.max(0, Math.abs(vz) - d / 2)
            );
            const blend = Math.min(1, edgeDist / 100);

            // Get nearest edge height
            const clampedIx = Math.max(0, Math.min(res, Math.round((Math.max(-w/2, Math.min(w/2, vx)) + w / 2) / w * res)));
            const clampedIz = Math.max(0, Math.min(res, Math.round((Math.max(-d/2, Math.min(d/2, vz)) + d / 2) / d * res)));
            const edgeH = (heights[clampedIz] && heights[clampedIz][clampedIx]) || 3;

            const proceduralH = 3.5 + Math.sin(vx * 0.015 + vz * 0.01) * 1.5
                             + Math.cos(vx * 0.025 + vz * 0.018) * 0.8
                             + Math.sin(vx * 0.005) * 2;

            h = edgeH * (1 - blend) + proceduralH * blend;
        }

        positions.setZ(i, h);

        // Remap UVs for satellite texture to only cover LiDAR data area
        if (satTexture) {
            const u = (vx + w / 2) / w;
            const v = (vz + d / 2) / d;
            uvs.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
        }

        // ======== VERTEX COLORS (used as tinting on top of satellite) ========
        const distFromCenter = Math.abs(vx);
        const heightNorm = Math.max(0, Math.min(1, h / 8.0));

        if (inBounds && satTexture) {
            // Neutral tint — let satellite texture show through
            colors[i * 3] = 0.85 + heightNorm * 0.05;
            colors[i * 3 + 1] = 0.90 + heightNorm * 0.05;
            colors[i * 3 + 2] = 0.82 + heightNorm * 0.05;
        } else {
            // Forest floor outside data
            const n = Math.sin(vx * 0.1 + vz * 0.08) * 0.03;
            colors[i * 3] = 0.12 + heightNorm * 0.05 + n;
            colors[i * 3 + 1] = 0.22 + heightNorm * 0.06 + n;
            colors[i * 3 + 2] = 0.09 + heightNorm * 0.04;
        }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);

    // Material
    let material;

    if (satTexture) {
        // Satellite texture with vertex color tinting
        material = new THREE.MeshStandardMaterial({
            map: satTexture,
            vertexColors: true,
            roughness: 0.92,
            metalness: 0.0,
            envMapIntensity: 0.3,
        });
    } else {
        // Procedural grass with vertex colors only
        const grassTex = createGrassTexture();
        material = new THREE.MeshStandardMaterial({
            map: grassTex,
            vertexColors: true,
            roughness: 0.95,
            metalness: 0.0,
        });
    }

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
}

function createGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Base
    ctx.fillStyle = '#3a6b3a';
    ctx.fillRect(0, 0, 1024, 1024);

    // Mowing stripes
    for (let i = 0; i < 1024; i += 48) {
        ctx.fillStyle = i % 96 < 48 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(i, 0, 48, 1024);
    }

    // Noise detail
    for (let i = 0; i < 15000; i++) {
        const c = Math.random() > 0.5 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
        ctx.fillStyle = c;
        ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 1 + Math.random(), 1 + Math.random());
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(40, 40);
    return texture;
}

function buildProceduralTerrain() {
    const w = 500, d = 600, res = 120;
    const geometry = new THREE.PlaneGeometry(w, d, res, res);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
        const vx = positions.getX(i);
        const vz = positions.getY(i);
        let h = 5 + Math.sin(vx * 0.015) * 2 + Math.cos(vz * 0.01) * 3 + Math.sin(vx * 0.04 + vz * 0.03) * 0.5;
        positions.setZ(i, h);

        const dist = Math.abs(vx);
        const fw = dist < 20 ? 1 : dist < 35 ? 0.5 : 0;
        colors[i * 3] = 0.12 + (1 - fw) * 0.15;
        colors[i * 3 + 1] = 0.35 + fw * 0.1;
        colors[i * 3 + 2] = 0.12 + (1 - fw) * 0.1;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    terrainMesh = new THREE.Mesh(geometry, mat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
}

// ============================================
// COURSE FEATURES
// ============================================
function buildGreen() {
    // Multi-layer green for depth
    const layers = [
        { r: 14, color: 0x286838, y: -0.15, roughness: 0.95 },  // Collar
        { r: 12, color: 0x3cb860, y: -0.05, roughness: 0.8 },   // Fringe  
        { r: 10, color: 0x48d070, y: 0, roughness: 0.7 },       // Green surface
    ];

    const gx = -37, gz = 166;
    const gy = getTerrainHeight(gx, gz);

    layers.forEach(layer => {
        const geom = new THREE.CircleGeometry(layer.r, 48);
        const mat = new THREE.MeshStandardMaterial({ color: layer.color, roughness: layer.roughness });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(gx, gy + 0.2 + layer.y, gz);
        mesh.receiveShadow = true;
        scene.add(mesh);
    });
}

function buildBunkers() {
    const bunkerPositions = [
        { x: -50, z: 140, rx: 9, ry: 6 },
        { x: -25, z: 145, rx: 7, ry: 5 },
        { x: -45, z: 175, rx: 8, ry: 6 },
    ];

    bunkerPositions.forEach(bp => {
        const y = getTerrainHeight(bp.x, bp.z);

        // Sand depression
        const sandGeom = new THREE.CircleGeometry(bp.rx * 0.85, 24);
        const sandMat = new THREE.MeshStandardMaterial({
            color: 0xd4b96a,
            roughness: 1.0,
            metalness: 0,
        });
        const sand = new THREE.Mesh(sandGeom, sandMat);
        sand.rotation.x = -Math.PI / 2;
        sand.position.set(bp.x, y - 0.1, bp.z);
        sand.receiveShadow = true;
        scene.add(sand);

        // Grass lip
        const lipGeom = new THREE.RingGeometry(bp.rx * 0.8, bp.rx, 24);
        const lipMat = new THREE.MeshStandardMaterial({
            color: 0x2d7a3a,
            roughness: 0.9,
            side: THREE.DoubleSide,
        });
        const lip = new THREE.Mesh(lipGeom, lipMat);
        lip.rotation.x = -Math.PI / 2;
        lip.position.set(bp.x, y + 0.15, bp.z);
        lip.receiveShadow = true;
        scene.add(lip);
    });
}

function buildFlagstick() {
    const flagX = -37, flagZ = 166;
    const flagY = getTerrainHeight(flagX, flagZ) + 0.2;

    // Pole
    const poleGeom = new THREE.CylinderGeometry(0.06, 0.06, 3.5, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.6 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.set(flagX, flagY + 1.75, flagZ);
    pole.castShadow = true;
    scene.add(pole);

    // Flag (pennant shape)
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.8, 0.3);
    flagShape.lineTo(0, 0.7);
    flagShape.lineTo(0, 0);

    const flagGeom = new THREE.ShapeGeometry(flagShape);
    const flagMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        roughness: 0.5,
    });
    const flag = new THREE.Mesh(flagGeom, flagMat);
    flag.position.set(flagX + 0.06, flagY + 3.0, flagZ);
    flag.castShadow = true;
    scene.add(flag);
}

function buildTeeBox() {
    const tx = 36, tz = -167;
    const ty = getTerrainHeight(tx, tz);

    // Tee surface
    const teeGeom = new THREE.BoxGeometry(5, 0.12, 3.5);
    const teeMat = new THREE.MeshStandardMaterial({ color: 0x2d9a4a, roughness: 0.75 });
    const tee = new THREE.Mesh(teeGeom, teeMat);
    tee.position.set(tx, ty + 0.06, tz);
    tee.receiveShadow = true;
    tee.castShadow = true;
    scene.add(tee);

    // Tee markers
    [-1.2, 1.2].forEach(side => {
        const markerGeom = new THREE.SphereGeometry(0.18, 12, 12);
        const markerMat = new THREE.MeshStandardMaterial({
            color: 0xfacc15,
            roughness: 0.3,
            metalness: 0.2,
        });
        const marker = new THREE.Mesh(markerGeom, markerMat);
        marker.position.set(tx + side * 1.8, ty + 0.3, tz + 1.2);
        marker.castShadow = true;
        scene.add(marker);
    });
}

function buildFairwayStripes() {
    // Subtle fairway stripe overlay for that broadcast-TV look
    const stripeW = 10, stripeD = 350;
    const numStripes = 7;

    for (let s = 0; s < numStripes; s++) {
        const xOff = (s - numStripes / 2) * stripeW;
        const geom = new THREE.PlaneGeometry(stripeW * 0.95, stripeD);
        const shade = s % 2 === 0 ? 0.02 : -0.02;

        const mat = new THREE.MeshStandardMaterial({
            color: shade > 0 ? 0x3a8b4a : 0x2a7a3a,
            transparent: true,
            opacity: 0.12,
            roughness: 0.85,
            depthWrite: false,
        });

        const stripe = new THREE.Mesh(geom, mat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(xOff, getTerrainHeight(xOff, 0) + 0.05, 0);
        scene.add(stripe);
    }
}

// ============================================
// ============================================
// NORDIC FOREST — Textured Billboard Trees
// ============================================
function buildNordicForest(treeData) {
    // Filter: must be tall enough AND not on fairway/green corridor
    const fairwayBuffer = 25;
    const greenX = -36, greenZ = 169, greenR = 50;
    
    const validTrees = treeData.filter(t => {
        if (t.h <= 3) return false;
        if (Math.abs(t.x) < fairwayBuffer && t.z > -200 && t.z < 200) return false;
        const dGreen = Math.sqrt((t.x - greenX) ** 2 + (t.z - greenZ) ** 2);
        if (dGreen < greenR) return false;
        const dTee = Math.sqrt((t.x - 37) ** 2 + (t.z - (-168)) ** 2);
        if (dTee < 20) return false;
        return true;
    });
    const numTrees = validTrees.length;
    if (numTrees === 0) return;

    // Create tree texture atlas with multiple tree types
    const pineTexture = createTreeTexture('pine');
    const spruceTexture = createTreeTexture('spruce');
    const birchTexture = createTreeTexture('birch');
    const textures = [pineTexture, spruceTexture, pineTexture, spruceTexture, birchTexture];

    // Use instanced billboard approach for performance
    const billboardGeom = new THREE.PlaneGeometry(1, 1);

    // Create multiple meshes for variety
    const treeGroups = textures.map(tex => {
        const mat = new THREE.MeshStandardMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.3,
            side: THREE.DoubleSide,
            roughness: 0.9,
            depthWrite: true,
        });
        return { mat, trees: [] };
    });

    // Distribute trees among groups
    validTrees.forEach((t, i) => {
        const groupIdx = i % treeGroups.length;
        treeGroups[groupIdx].trees.push(t);
    });

    // Build instanced meshes per group
    treeGroups.forEach(group => {
        if (group.trees.length === 0) return;
        const mesh = new THREE.InstancedMesh(billboardGeom, group.mat, group.trees.length * 2);
        mesh.castShadow = true;
        const dummy = new THREE.Object3D();

        group.trees.forEach((t, i) => {
            const groundH = getTerrainHeight(t.x, t.z);
            const treeH = Math.max(5, t.h) * (0.8 + Math.random() * 0.4);
            const treeW = treeH * (0.35 + Math.random() * 0.15);

            // Front-facing billboard
            dummy.position.set(t.x, groundH + treeH * 0.5, t.z);
            dummy.rotation.set(0, Math.random() * Math.PI, 0);
            dummy.scale.set(treeW, treeH, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i * 2, dummy.matrix);

            // Cross billboard (90° rotated for 3D effect)
            dummy.rotation.set(0, dummy.rotation.y + Math.PI / 2, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i * 2 + 1, dummy.matrix);
        });

        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
    });
}

function createTreeTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 128, 256);

    if (type === 'pine' || type === 'spruce') {
        // Nordic pine/spruce — triangular silhouette with organic edges
        const trunkW = type === 'pine' ? 6 : 5;
        const trunkH = type === 'pine' ? 70 : 50;

        // Trunk
        ctx.fillStyle = '#3d2e1a';
        ctx.fillRect(64 - trunkW / 2, 256 - trunkH, trunkW, trunkH);

        // Canopy layers (bottom to top, wider to narrower)
        const layers = type === 'pine' 
            ? [{ y: 180, w: 55, h: 35 }, { y: 145, w: 48, h: 40 }, { y: 105, w: 40, h: 45 }, { y: 65, w: 30, h: 45 }, { y: 30, w: 18, h: 40 }]
            : [{ y: 200, w: 58, h: 30 }, { y: 170, w: 52, h: 35 }, { y: 135, w: 45, h: 40 }, { y: 95, w: 36, h: 45 }, { y: 55, w: 25, h: 45 }, { y: 20, w: 12, h: 40 }];

        layers.forEach((layer, li) => {
            // Darker at base, lighter at top
            const shade = type === 'pine'
                ? `rgb(${20 + li * 6}, ${55 + li * 12}, ${25 + li * 5})`
                : `rgb(${15 + li * 5}, ${48 + li * 10}, ${20 + li * 4})`;

            ctx.fillStyle = shade;
            ctx.beginPath();
            ctx.moveTo(64 - layer.w / 2, layer.y + layer.h);
            // Organic jagged edge
            const steps = 12;
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const x = 64 - layer.w / 2 + layer.w * t;
                const jag = (Math.sin(s * 2.7 + li) * 3) + (Math.random() - 0.5) * 4;
                const baseY = layer.y + layer.h * (1 - Math.abs(t - 0.5) * 2);
                const y = baseY - layer.h * (1 - Math.pow(Math.abs(t - 0.5) * 2, 1.5)) + jag;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(64 + layer.w / 2, layer.y + layer.h);
            ctx.closePath();
            ctx.fill();
        });

        // Add subtle highlights
        ctx.fillStyle = 'rgba(120, 200, 100, 0.08)';
        for (let i = 0; i < 80; i++) {
            const x = 30 + Math.random() * 68;
            const y = 20 + Math.random() * 180;
            ctx.fillRect(x, y, 2, 2);
        }
    } else if (type === 'birch') {
        // Birch — white trunk with rounded crown
        // Trunk (white with dark marks)
        ctx.fillStyle = '#d4cfc0';
        ctx.fillRect(60, 130, 8, 126);
        ctx.fillStyle = '#2a2520';
        for (let i = 0; i < 8; i++) {
            ctx.fillRect(60, 140 + i * 14 + Math.random() * 5, 8, 1.5);
        }

        // Crown (rounded, lighter green)
        const crownGrad = ctx.createRadialGradient(64, 80, 5, 64, 80, 55);
        crownGrad.addColorStop(0, 'rgba(85, 160, 60, 0.95)');
        crownGrad.addColorStop(0.5, 'rgba(70, 140, 50, 0.9)');
        crownGrad.addColorStop(0.8, 'rgba(55, 120, 40, 0.7)');
        crownGrad.addColorStop(1, 'rgba(40, 100, 30, 0)');
        ctx.fillStyle = crownGrad;
        ctx.fillRect(10, 20, 108, 130);

        // Leaf clusters
        for (let i = 0; i < 40; i++) {
            const lx = 30 + Math.random() * 68;
            const ly = 30 + Math.random() * 100;
            const lr = 3 + Math.random() * 6;
            ctx.fillStyle = `rgba(${50 + Math.random() * 40}, ${120 + Math.random() * 50}, ${30 + Math.random() * 30}, ${0.3 + Math.random() * 0.3})`;
            ctx.beginPath();
            ctx.arc(lx, ly, lr, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// ============================================
// DISTANCE MARKERS on fairway
// ============================================
function buildDistanceMarkers() {
    const markerDistances = [100, 150, 200, 250, 300, 350];
    const maxDist = totalDist;

    markerDistances.forEach(d => {
        if (d >= maxDist - 20) return; // Skip markers too close to green

        // Position along fairway (linear tee→green mapping)
        const t = d / maxDist;
        const teeZ = -168, greenZ = 169;
        const teeX = 37, greenX = -36;
        const z = teeZ + (greenZ - teeZ) * t;
        const x = teeX + (greenX - teeX) * t;
        const y = getTerrainHeight(x, z);
        const remaining = maxDist - d;

        // Create marker sprite
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Background pill
        ctx.fillStyle = 'rgba(10, 22, 40, 0.85)';
        roundRect(ctx, 4, 4, 120, 56, 12);
        ctx.fill();

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        roundRect(ctx, 4, 4, 120, 56, 12);
        ctx.stroke();

        // Distance number
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${remaining}`, 64, 38);

        // "m" label
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px Arial';
        ctx.fillText('m', 100, 38);

        // Small elevation indicator
        const elev = Math.round(y);
        ctx.fillStyle = '#22c55e';
        ctx.font = '11px Arial';
        ctx.fillText(`↑${elev}m`, 64, 55);

        const markerTexture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ 
            map: markerTexture, 
            transparent: true,
            depthTest: true,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(x, y + 8, z);
        sprite.scale.set(12, 6, 1);
        scene.add(sprite);

        // Ground circle marker
        const circleGeom = new THREE.RingGeometry(1.5, 2, 16);
        const circleMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, 
            transparent: true, 
            opacity: 0.3, 
            side: THREE.DoubleSide 
        });
        const circle = new THREE.Mesh(circleGeom, circleMat);
        circle.rotation.x = -Math.PI / 2;
        circle.position.set(x, y + 0.15, z);
        scene.add(circle);
    });
}

// ============================================
// ELEVATION BADGES
// ============================================
function buildElevationBadges() {
    const badges = [
        { label: 'TEE', x: 37, z: -168, color: '#facc15' },
        { label: 'GREEN', x: -36, z: 169, color: '#22c55e' },
    ];

    badges.forEach(b => {
        const y = getTerrainHeight(b.x, b.z);
        const elev = Math.round(y * 10) / 10;

        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = 'rgba(10, 22, 40, 0.9)';
        roundRect(ctx, 2, 2, 196, 76, 14);
        ctx.fill();

        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        roundRect(ctx, 2, 2, 196, 76, 14);
        ctx.stroke();

        // Label
        ctx.fillStyle = b.color;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(b.label, 100, 28);

        // Elevation
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px Arial';
        ctx.fillText(`${elev}m`, 100, 62);

        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ 
            map: tex, transparent: true, depthTest: true, depthWrite: false 
        }));
        sprite.position.set(b.x, y + 14, b.z);
        sprite.scale.set(16, 6.4, 1);
        scene.add(sprite);
    });
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}


function buildProceduralForest() {
    const numTrees = 400;
    const trunkGeom = new THREE.CylinderGeometry(0.3, 0.5, 1.0, 5);
    trunkGeom.translate(0, 0.5, 0);
    const coneGeom = new THREE.ConeGeometry(2.5, 5.0, 6);
    coneGeom.translate(0, 2.5, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3d2e, roughness: 1.0 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1a4d25, roughness: 0.85, flatShading: true });

    const trunkMesh = new THREE.InstancedMesh(trunkGeom, trunkMat, numTrees);
    const leavesMesh = new THREE.InstancedMesh(coneGeom, leavesMat, numTrees);
    trunkMesh.castShadow = true;
    leavesMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < numTrees * 2 && placed < numTrees; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 35 + Math.random() * 200;
        const x = Math.cos(angle) * dist;
        const z = -250 + Math.random() * 500;

        if (Math.abs(x) < 25 && z > -200 && z < 200) continue;

        const h = 6 + Math.random() * 14;
        const y = getTerrainHeight(x, z);

        dummy.position.set(x, y, z);
        dummy.rotation.y = Math.random() * Math.PI * 2;
        dummy.scale.set(1, h * 0.25, 1);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(placed, dummy.matrix);

        dummy.position.y = y + h * 0.25;
        dummy.scale.set(1, h / 5, 1);
        dummy.updateMatrix();
        leavesMesh.setMatrixAt(placed, dummy.matrix);
        placed++;
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    leavesMesh.instanceMatrix.needsUpdate = true;
    scene.add(trunkMesh);
    scene.add(leavesMesh);
}

// ============================================
// CAMERA PATH — Cinematic drone flight
// ============================================
function setupCameraPath() {
    // GPS-verified, LiDAR centered on fairway midpoint (cx=753708, cy=7069566)
    const teeX = 37, teeZ = -168;
    const greenX = -36, greenZ = 169;

    const teeY = getTerrainHeight(teeX, teeZ);
    const midY = getTerrainHeight(0, 0);
    const greenY = getTerrainHeight(greenX, greenZ);

    cameraPath.push(
        // Behind tee — establishing shot
        { pos: new THREE.Vector3(teeX + 25, teeY + 65, teeZ - 60), look: new THREE.Vector3(0, midY, 60) },
        // Over tee looking down fairway  
        { pos: new THREE.Vector3(teeX + 8, teeY + 55, teeZ + 30), look: new THREE.Vector3(0, midY, 120) },
        // Sweeping along fairway
        { pos: new THREE.Vector3(20, midY + 50, -10), look: new THREE.Vector3(-10, midY + 2, 130) },
        // Mid fairway aerial
        { pos: new THREE.Vector3(0, midY + 45, 60), look: new THREE.Vector3(greenX, greenY, greenZ) },
        // Approach
        { pos: new THREE.Vector3(greenX + 10, midY + 40, greenZ - 30), look: new THREE.Vector3(greenX, greenY, greenZ) },
        // Green overview
        { pos: new THREE.Vector3(greenX, greenY + 55, greenZ + 5), look: new THREE.Vector3(greenX, greenY, greenZ) },
        // Final orbit
        { pos: new THREE.Vector3(greenX + 15, greenY + 50, greenZ + 15), look: new THREE.Vector3(greenX, greenY, greenZ) },
    );
}

function startFlight() {
    flyProgress = 0;
    isFlying = true;
    flightStartTime = performance.now();
    const btn = document.getElementById('btn-fly');
    if (btn) {
        btn.innerHTML = '<span>🚁 Flyger...</span>';
        btn.style.background = 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)';
        btn.style.boxShadow = '0 8px 30px rgba(59, 130, 246, 0.4)';
    }
}

// ============================================
// ANIMATION LOOP
// ============================================
function animate() {
    requestAnimationFrame(animate);

    if (isFlying && cameraPath.length > 1) {
        const elapsed = (performance.now() - flightStartTime) / 1000;
        flyProgress = Math.min(elapsed / FLIGHT_DURATION, 1.0);

        // Extra-smooth easing
        const t = smoothstep(0, 1, flyProgress);

        // Catmull-Rom-style interpolation through waypoints
        const totalSegments = cameraPath.length - 1;
        const segFloat = t * totalSegments;
        const segIdx = Math.min(Math.floor(segFloat), totalSegments - 1);
        const segT = smoothstep(0, 1, segFloat - segIdx);

        const from = cameraPath[segIdx];
        const to = cameraPath[segIdx + 1];

        // Position
        camera.position.lerpVectors(from.pos, to.pos, segT);
        // Gentle sway for organic feel
        camera.position.x += Math.sin(elapsed * 0.8) * 0.3;
        camera.position.y += Math.sin(elapsed * 0.5 + 1) * 0.15;

        // LookAt
        const lookTarget = new THREE.Vector3().lerpVectors(from.look, to.look, segT);
        camera.lookAt(lookTarget);

        // Update HUD elements
        updateFlightHUD(t, elapsed);

        // Progress bar
        const progressFill = document.getElementById('progress-fill');
        if (progressFill) progressFill.style.width = (flyProgress * 100) + '%';

        if (flyProgress >= 1.0) {
            isFlying = false;
            const btn = document.getElementById('btn-fly');
            if (btn) {
                btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg><span>Spela om</span>`;
                btn.style.background = 'linear-gradient(135deg, #10B981 0%, #059669 100%)';
                btn.style.boxShadow = '0 8px 30px rgba(34, 197, 94, 0.4)';
            }
        }
    } else if (!isFlying && cameraPath.length > 0) {
        // Gentle orbit when idle
        const time = performance.now() * 0.00008;
        const lastWp = cameraPath[cameraPath.length - 1];
        camera.position.x = lastWp.pos.x + Math.sin(time) * 20;
        camera.position.z = lastWp.pos.z + Math.cos(time) * 15;
        camera.position.y = lastWp.pos.y + Math.sin(time * 1.5) * 2;
        camera.lookAt(lastWp.look);
    }

    renderer.render(scene, camera);
}

function updateFlightHUD(t, elapsed) {
    const distEl = document.getElementById('hud-dist');
    if (distEl) {
        const remaining = Math.round(totalDist * (1 - t));
        distEl.textContent = `${remaining}m`;
    }

    const altEl = document.getElementById('alt-value');
    const spdEl = document.getElementById('spd-value');
    if (altEl) {
        const alt = Math.round(10 + Math.sin(t * Math.PI) * 15 + Math.sin(elapsed * 0.7) * 2);
        altEl.textContent = alt;
    }
    if (spdEl) {
        const spd = Math.round(30 + t * 20 + Math.sin(elapsed * 1.5) * 5);
        spdEl.textContent = spd;
    }
}

// ============================================
// HELPERS
// ============================================
function smoothstep(min, max, value) {
    const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
}

function getTerrainHeight(wx, wz) {
    // Use real LiDAR data if available
    if (terrainGrid && terrainMeta) {
        const w = terrainMeta.width;
        const d = terrainMeta.depth;
        const res = terrainMeta.resolution;

        const dataX = (wx + w / 2) / w * res;
        const dataZ = (wz + d / 2) / d * res;

        const ix = Math.max(0, Math.min(res, Math.round(dataX)));
        const iz = Math.max(0, Math.min(res, Math.round(dataZ)));

        if (terrainGrid[iz] && terrainGrid[iz][ix] !== undefined) {
            // Heights are already normalized (base_elevation subtracted during processing)
            return terrainGrid[iz][ix];
        }
    }

    // Fallback: procedural
    return 5 + Math.sin(wx * 0.02) * 1.5 + Math.cos(wz * 0.01) * 2;
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateHUD() {
    const nameEl = document.getElementById('hud-hole-name');
    const courseEl = document.getElementById('hud-course-name');
    const parEl = document.getElementById('hud-par');
    const distEl = document.getElementById('hud-dist');

    if (nameEl) nameEl.textContent = `Hål ${holeName}`;
    if (courseEl) courseEl.textContent = courseName;
    if (parEl) parEl.textContent = `PAR ${parValue}`;
    if (distEl) distEl.textContent = `${totalDist}m`;
}
