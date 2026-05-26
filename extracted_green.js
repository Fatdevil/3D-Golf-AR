    window.executeSplineSmartGreen = function() {
        if(smartGreenPoints.length < 3) return;
        saveUndoState();

        let cfg = window.CURRENT_BIOME_CONFIG;
        let greenColor = cfg.greenColor || '#98ce68';
        let foregreenColor = cfg.foregreenColor || '#8bc45d';
        let difficulty = window.greenDifficulty || 'FLAT';
        
        // Random seed offset for unique contours per green build
        window._sgSeedOffsetX = (Math.random() - 0.5) * 200;
        window._sgSeedOffsetZ = (Math.random() - 0.5) * 200;

        // Get foregreen width from slider (default 1.0m)
        let fgSlider = document.getElementById('sg-foregreen-width');
        let foregreenWidth = fgSlider ? parseFloat(fgSlider.value) : 1.0;

        // Build closed curve from points using closed=true for smooth loop at first point
        let curve = new THREE.CatmullRomCurve3(smartGreenPoints, true);
        let numSamples = Math.max(200, smartGreenPoints.length * 40);
        let densePts = curve.getPoints(numSamples);

        // === 1. PAINT: Foregreen ring (expanded polygon) + Green fill ===
        pCtx.save();

        // Edge sharpness: 100 = pixel-perfect sharp (default), 0 = soft feathered edge
        let sharpSlider = document.getElementById('sg-edge-sharpness');
        let sharpness = sharpSlider ? parseInt(sharpSlider.value) : 100;
        
        if(sharpness < 100) {
            // Soft edge: subtle blur (max 6px on 4096px canvas = ~0.15% feather)
            let blurPx = Math.round((100 - sharpness) * 0.06); // 0-6px blur range
            if(blurPx > 0) pCtx.filter = 'blur(' + blurPx + 'px)';
        }

        // Draw foregreen ring: uniform-width offset polygon
        if(foregreenWidth > 0) {
            let expandedPts = offsetPolygon(densePts, foregreenWidth);
            pCtx.beginPath();
            expandedPts.forEach((pt, i) => {
                let pxX = ((pt.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
                if(i === 0) pCtx.moveTo(pxX, pxY);
                else pCtx.lineTo(pxX, pxY);
            });
            pCtx.closePath();
            pCtx.fillStyle = foregreenColor;
            pCtx.fill();
        }

        // Draw green fill (inner polygon, on top)
        pCtx.beginPath();
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (TERRAIN_SIZE/2)) / TERRAIN_SIZE) * 4096;
            if(i === 0) pCtx.moveTo(pxX, pxY);
            else pCtx.lineTo(pxX, pxY);
        });
        pCtx.closePath();
        pCtx.fillStyle = greenColor;
        pCtx.fill();
        
        pCtx.filter = 'none'; // Reset filter

        pCtx.restore();
        mapTex.needsUpdate = true;
        window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;

        // === 2. TERRAIN SCULPTING: Flatten + Difficulty Contours ===
        let positions = planeGeo.attributes.position.array;
        let step = TERRAIN_SIZE / TERRAIN_SEGS;

        // Build bounding box for early exit
        let pathMinX = Infinity, pathMaxX = -Infinity, pathMinZ = Infinity, pathMaxZ = -Infinity;
        for(let pt of densePts) {
            if(pt.x < pathMinX) pathMinX = pt.x;
            if(pt.x > pathMaxX) pathMaxX = pt.x;
            if(pt.z < pathMinZ) pathMinZ = pt.z;
            if(pt.z > pathMaxZ) pathMaxZ = pt.z;
        }
        let margin = foregreenWidth + 8; // Extra margin for edge blending

        let gxStart = Math.max(0, Math.floor((pathMinX - margin + TERRAIN_SIZE/2) / step));
        let gxEnd = Math.min(TERRAIN_SEGS, Math.ceil((pathMaxX + margin + TERRAIN_SIZE/2) / step));
        let gzStart = Math.max(0, Math.floor((pathMinZ - margin + TERRAIN_SIZE/2) / step));
        let gzEnd = Math.min(TERRAIN_SEGS, Math.ceil((pathMaxZ + margin + TERRAIN_SIZE/2) / step));

        // Calculate average height of spline points as base plateau height
        let baseH = 0;
        for(let pt of smartGreenPoints) {
            let surf = localGetTerrainAt(pt.x, -pt.z);
            baseH += surf ? surf.z : 0;
        }
        baseH /= smartGreenPoints.length;

        // Point-in-polygon test (ray casting)
        function pointInPolygon(px, pz, polyPts) {
            let inside = false;
            for(let i = 0, j = polyPts.length - 1; i < polyPts.length; j = i++) {
                let xi = polyPts[i].x, zi = polyPts[i].z;
                let xj = polyPts[j].x, zj = polyPts[j].z;
                if(((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        // Distance from point to nearest polygon edge
        function distToPolygon(px, pz, polyPts) {
            let minDist = Infinity;
            for(let i = 0, j = polyPts.length - 1; i < polyPts.length; j = i++) {
                let ax = polyPts[j].x, az = polyPts[j].z;
                let bx = polyPts[i].x, bz = polyPts[i].z;
                let dx = bx - ax, dz = bz - az;
                let len2 = dx*dx + dz*dz;
                let t = len2 > 0 ? Math.max(0, Math.min(1, ((px-ax)*dx + (pz-az)*dz) / len2)) : 0;
                let projX = ax + t*dx, projZ = az + t*dz;
                let d = Math.sqrt((px-projX)**2 + (pz-projZ)**2);
                if(d < minDist) minDist = d;
            }
            return minDist;
        }

        // Multiple passes for smooth convergence
        for(let pass = 0; pass < 4; pass++) {
            for(let gz = gzStart; gz <= gzEnd; gz++) {
                for(let gx = gxStart; gx <= gxEnd; gx++) {
                    let idx = gz * (TERRAIN_SEGS+1) + gx;
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+1];

                    let isInside = pointInPolygon(vx, vz, densePts);
                    let distEdge = distToPolygon(vx, vz, densePts);

                    if(!isInside && distEdge > margin) continue;

                    // Target height with difficulty contours (randomized per build)
                    // Slope targets: EASY 0-2%, MED 2-4%, HARD 4-6% (PGA-realistic)
                    // slope% ≈ amplitude × frequency × 100
                    let targetHeight = baseH;
                    let seedX = vx + window._sgSeedOffsetX;
                    let seedZ = vz + window._sgSeedOffsetZ;
                    if(difficulty === 'EASY') {
                        // Peak ~1.4%, typical ~1%
                        targetHeight += Math.sin(seedX * 0.1) * Math.cos(seedZ * 0.1) * 0.10;
                    } else if(difficulty === 'MED') {
                        // Peak ~3.5%, typical ~2.5%
                        targetHeight += Math.sin(seedX * 0.12) * Math.cos(seedZ * 0.12) * 0.18;
                        targetHeight += Math.sin(seedX * 0.07 + seedZ * 0.05) * 0.08;
                    } else if(difficulty === 'HARD') {
                        // Peak ~5.5%, typical ~4.5% (Augusta-level)
                        targetHeight += Math.sin(seedX * 0.15) * Math.cos(seedZ * 0.12) * 0.22
                                      + Math.sin(seedZ * 0.25 + seedX * 0.08) * 0.06
                                      + Math.cos(seedX * 0.20) * Math.sin(seedZ * 0.18) * 0.05;
                    }

                    let currentH = positions[idx*3+2];
                    let influence;

                    if(isInside) {
                        influence = 1.0;
                    } else {
                        // Standard smooth blend falloff
                        influence = 1.0 - (distEdge / margin);
                        influence = Math.max(0, influence * influence * (3 - 2 * influence));
                    }

                    positions[idx*3+2] = currentH + (targetHeight - currentH) * influence * 0.5;
                }
            }
        }

        planeGeo.attributes.position.needsUpdate = true;
        planeGeo.computeVertexNormals();
        planeGeo.computeBoundingBox();
        planeGeo.computeBoundingSphere();
        snapObjectsToGround();

        // Refresh overlays
        if(window.slopeOverlayActive) window.updateSlopeOverlay();
        if(window.contourLinesActive) window.updateContourLines();
        if(window.elevationHeatmapActive) window.updateElevationHeatmap();

        clearSmartGreen();