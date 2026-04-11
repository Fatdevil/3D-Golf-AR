/* ============================================
   GreenRead AR — 3D Laser Fairway Engine
   Drivs av Three.js & Lantmäteriets LiDAR data
   ============================================ */

let scene, camera, renderer, labelRenderer, terrainMesh;
let fairwayData = null;
let flyProgress = 0;
let isFlying = false;

const startPoint = new THREE.Vector3();
const endPoint = new THREE.Vector3();

// Start
init();

async function init() {
    const container = document.getElementById('fairwayContainer');
    
    scene = new THREE.Scene();
    
    // Återställ till the classic Blue Sky (eftersom Threejs-servern stoppade vår hotlinking)
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // CSS2DRenderer för AR-skyltar
    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none'; // Sjukt viktigt så knappar går att klicka
    container.appendChild(labelRenderer.domElement);

    // Ljus
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(200, 300, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    // Ladda fairway & träd data parallellt
    try {
        const [resFairway, resTrees] = await Promise.all([
            fetch('data/fairway_hole1.json'),
            fetch('data/trees_hole1.json').catch(() => null)
        ]);
        
        if (!resFairway.ok) throw new Error("HTTP fel för Fairway");
        fairwayData = await resFairway.json();
        
        buildLaserFairway(fairwayData);

        if (resTrees && resTrees.ok) {
            const treeData = await resTrees.json();
            buildTrees(treeData); 
        }
    } catch (e) {
        console.error("Kunde ladda data", e);
    }

    window.addEventListener('resize', onWindowResize);
    animate();
}

function smoothstep(min, max, value) {
    let x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
}

function createARLabel(title, distance, drop, position) {
    const div = document.createElement('div');
    div.className = 'ar-label';
    
    // Färglägg pilen och texten för drop röd eller grön beroende på lutning
    const dropColor = drop > 0 ? '#4ade80' : '#f87171'; // Grön för uppför, röd för nedför 
    const dropIcon = drop > 0 ? '↑' : '↓';
    const dropStr = drop === 0 ? '-' : `${dropIcon} ${Math.abs(drop).toFixed(1)}m`;

    div.innerHTML = `
        <div class="ar-label-title">${title}</div>
        <div class="ar-label-dist">${distance}</div>
        <div class="ar-label-drop" style="color: ${dropColor};">${dropStr}</div>
    `;

    const label = new THREE.CSS2DObject(div);
    label.position.copy(position);
    return label;
}

function buildLaserFairway(data) {
    const w = data.metadata.width;
    const d = data.metadata.depth;
    const res = data.metadata.resolution;
    const heights = data.points;

    const geometry = new THREE.PlaneGeometry(w, d, res, res);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    
    for (let i = 0; i < positions.count; i++) {
        const vx = positions.getX(i);
        const vz = positions.getY(i); 
        
        const ix = Math.round((vx + w / 2) / w * res);
        const iz = Math.round((vz + d / 2) / d * res);
        
        const ixC = Math.max(0, Math.min(res, ix));
        const izC = Math.max(0, Math.min(res, iz));
        
        const h = heights[izC] && heights[izC][ixC] ? heights[izC][ixC] : 0;
        positions.setZ(i, h);

        const heightRatio = Math.max(0, Math.min(1, h / 15.0)); 
        
        // 1. GOLFLOGIX FAIRWAY PENSEL (Splat Mapping mathematics)
        const distFromCenter = Math.abs(vx);
        
        // 20 till 28 meter från centrum blandar Fairway -> Rough
        const roughFactor = smoothstep(16, 26, distFromCenter);
        const fairwayFactor = 1.0 - roughFactor;

        // Färg för the Fairway (Livlig Grön)
        let fR = 0.20 + heightRatio * 0.15;
        let fG = 0.45 + heightRatio * 0.2;
        let fB = 0.20 + heightRatio * 0.15;

        // Färg för the Rough (Torr, sandig gräs/link-karaktär)
        let rR = 0.58 + heightRatio * 0.1;
        let rG = 0.55 + heightRatio * 0.1;
        let rB = 0.45 + heightRatio * 0.1;

        // The Blend
        colors[i * 3] = fR * fairwayFactor + rR * roughFactor;
        colors[i * 3 + 1] = fG * fairwayFactor + rG * roughFactor;
        colors[i * 3 + 2] = fB * fairwayFactor + rB * roughFactor;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2); 

    // Procedurisk The Rough/Fairway Noise Texture
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 0, 1024, 1024);
    
    // Gräsklippar-ränder (Stripes)
    ctx.fillStyle = 'rgba(0,0,0, 0.04)'; 
    for (let i = 0; i < 1024; i += 64) {
        ctx.fillRect(i, 0, 32, 1024); 
    }
    
    // Organisk smuts/jord noise
    for(let i=0; i<8000; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(Math.random()*1024, Math.random()*1024, 2, 2);
    }

    const grassTex = new THREE.CanvasTexture(canvas);
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(w / 10, d / 10); 

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: grassTex,
        roughness: 1.0,
        metalness: 0.0,
        wireframe: false
    });

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    scene.add(terrainMesh);

    // Konfigurera mätpunkter (EXAKTA fysiska GPS-koordinater!)
    startPoint.set(36, 0, -167);  // Tee (Söderut, till höger om center)
    endPoint.set(-37, 0, 166);    // Green (Norrut, till vänster om center)

    const teeHeight = getHeightAt(startPoint.x, startPoint.z);
    const greenHeight = getHeightAt(endPoint.x, endPoint.z);
    
    startPoint.y = teeHeight + 15; 
    endPoint.y = greenHeight + 5;        

    // --- AR SKYLTAR (GolfLogix Klon) ---
    // Skylt 1: Driver Landing Zone (Dogenleg)
    // Sätt landningszon exakt mellan Tee och Green
    const driverLzX = startPoint.x + (endPoint.x - startPoint.x) * 0.6;
    const driverLzZ = startPoint.z + (endPoint.z - startPoint.z) * 0.6;
    const bunkerH = getHeightAt(driverLzX, driverLzZ);
    const dropTeeToBunker = bunkerH - teeHeight;
    
    const arLabel1 = createARLabel('Driver', 220, dropTeeToBunker, new THREE.Vector3(driverLzX, bunkerH + 3, driverLzZ));
    scene.add(arLabel1);

    // Skylt 2: Green Target
    const dropTeeToGreen = greenHeight - teeHeight;
    // Pytagoras total distance
    const distTeeGreen = Math.sqrt(Math.pow(endPoint.x-startPoint.x,2) + Math.pow(endPoint.z-startPoint.z,2));
    const arLabel2 = createARLabel('Green', Math.round(distTeeGreen), dropTeeToGreen, new THREE.Vector3(endPoint.x, greenHeight + 5, endPoint.z));
    scene.add(arLabel2);

    // Lägg till markör på The Green
    const pinGeom = new THREE.CylinderGeometry(0.5, 0.5, 10, 8);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pin = new THREE.Mesh(pinGeom, pinMat);
    pin.position.copy(endPoint);
    pin.position.y += 2.5; 
    scene.add(pin);
    
    // Vita spår-linjen (Arccos/Trackman tracer route)
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(startPoint.x, teeHeight + 1, startPoint.z),
        new THREE.Vector3(driverLzX, bunkerH + 1, driverLzZ),
        new THREE.Vector3(endPoint.x, greenHeight + 1, endPoint.z)
    ]);
    const lineMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 2, linewidth: 2 });
    const line = new THREE.Line(lineGeom, lineMat);
    line.computeLineDistances(); 
    scene.add(line);

    // Initial kamera (Bakom Tee, tittar mot LZ)
    camera.position.set(startPoint.x + 5, teeHeight + 25, startPoint.z - 20);
    camera.lookAt(driverLzX, bunkerH, driverLzZ);

    setTimeout(() => {
        isFlying = true;
    }, 1500);
}

function buildTrees(treeData) {
    const validTrees = treeData.filter(t => t.h > 2); // Skippa buskar
    const numTrees = validTrees.length;
    console.log(`Planterar ${numTrees} organiska LiDAR trees via GPU instancing...`);
    
    // Bas-geometrier The Pines
    const trunkGeom = new THREE.CylinderGeometry(0.5, 0.7, 1.0, 5); 
    const leavesGeom = new THREE.ConeGeometry(2.5, 5.0, 6);
    
    trunkGeom.translate(0, 0.5, 0);
    leavesGeom.translate(0, 2.5, 0); 

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4d3c, roughness: 1.0 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1f4d29, roughness: 0.9, flatShading: true }); 

    const trunkMesh = new THREE.InstancedMesh(trunkGeom, trunkMat, numTrees);
    const leavesMesh = new THREE.InstancedMesh(leavesGeom, leavesMat, numTrees);
    trunkMesh.castShadow = true;
    leavesMesh.castShadow = true;

    const dummy = new THREE.Object3D();

    validTrees.forEach((t, i) => {
        const groundH = getHeightAt(t.x, t.z);
        
        // --- Jitter Scale & Rotation ---
        const rotY = Math.random() * Math.PI * 2;
        const scaleJitter = 1.0 + (Math.random() * 0.4 - 0.2); // +/- 20% volym
        
        // --- The Trunk ---
        dummy.position.set(t.x, groundH, t.z);
        dummy.rotation.set(0, rotY, 0);
        const trunkH = Math.max(1, t.h * 0.2) * scaleJitter; 
        dummy.scale.set(scaleJitter, trunkH, scaleJitter);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);

        // --- The Canopy (Leaves) ---
        dummy.position.set(t.x, groundH + trunkH - 0.5, t.z);
        dummy.rotation.set(0, rotY, 0);
        const leavesH = t.h * 0.8 * scaleJitter;
        const widthScale = Math.max(0.6, t.h / 18) * scaleJitter; 
        dummy.scale.set(widthScale, leavesH / 5.0, widthScale); 
        dummy.updateMatrix();
        leavesMesh.setMatrixAt(i, dummy.matrix);
    });

    trunkMesh.instanceMatrix.needsUpdate = true;
    leavesMesh.instanceMatrix.needsUpdate = true;
    scene.add(trunkMesh);
    scene.add(leavesMesh);
}

function getHeightAt(wx, wz) {
    if (!fairwayData) return 0;
    const res = fairwayData.metadata.resolution;
    const ix = Math.floor((wx + fairwayData.metadata.width / 2) / fairwayData.metadata.width * res);
    const iz = Math.floor((wz + fairwayData.metadata.depth / 2) / fairwayData.metadata.depth * res); 
    if (ix < 0 || ix > res || iz < 0 || iz > res) return 0;
    return (fairwayData.points[iz] && fairwayData.points[iz][ix]) ? fairwayData.points[iz][ix] : 0;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    if (isFlying && fairwayData) {
        flyProgress += 0.0015; // Slow cinematic glide
        
        if (flyProgress <= 1.0) {
            // Nu när vi går från Negativ Z (Tee) till Positiv Z (Green), betyder Z-minus "bakom" punkten.
            camera.position.lerpVectors(
                new THREE.Vector3(startPoint.x, startPoint.y + 10, startPoint.z - 30), // 30m bakom Tee
                new THREE.Vector3(endPoint.x, endPoint.y + 30, endPoint.z - 70), // Stannar högt 70m innan Green
                flyProgress
            );
            
            const aimPoint = new THREE.Vector3();
            // Driver Landing Zone ligger "framåt i banans riktning" jämfört med det statiska -220
            const lzX = startPoint.x + (endPoint.x - startPoint.x) * 0.6;
            const lzZ = startPoint.z + (endPoint.z - startPoint.z) * 0.6;
            
            aimPoint.lerpVectors(
                new THREE.Vector3(lzX, getHeightAt(lzX, lzZ), lzZ), 
                endPoint,
                flyProgress * 1.5 
            );
            camera.lookAt(aimPoint);
            
        } else {
            isFlying = false;
        }
    }

    renderer.render(scene, camera);
    if(labelRenderer) labelRenderer.render(scene, camera); // Rendera HTML-skyltarna
}
