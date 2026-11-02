    // === TRACKMAN & GSPRO PROFESSIONAL GREEN GRID ENGINE ===
    window._greenGridCoverage = window._greenGridCoverage || 'ALL'; // 'ALL' = Green + Foregreen, 'GREEN_ONLY' = Puttyta
    window._greenGridColorMode = window._greenGridColorMode || 'HEATMAP'; // 'HEATMAP' = TrackMan slope colors, 'WHITE' = Vit

    // The hole the slope view belongs to: the hole being played in a round (PLAY/TEST), otherwise the hole open in the builder.
    // In a round currentHoleIndex stays on the builder's hole while playingHoleIndex moves on, so it must not be used there.
    window.slopeVizHoleIndex = function() {
        const inRound = typeof appMode !== 'undefined' && (appMode === 'PLAY' || appMode === 'TEST') && typeof playingHoleIndex !== 'undefined';
        return inRound ? playingHoleIndex : window.currentHoleIndex;
    };

    window.setGreenGridCoverage = function(cov) {
        window._greenGridCoverage = cov;
        let bAll = document.getElementById('gs-grid-cov-all');
        let bGreen = document.getElementById('gs-grid-cov-green');
        if (bAll) {
            bAll.style.background = (cov === 'ALL') ? 'rgba(56,189,248,0.25)' : '#0f172a';
            bAll.style.color = (cov === 'ALL') ? '#38bdf8' : '#94a3b8';
            bAll.style.borderColor = (cov === 'ALL') ? '#38bdf8' : '#334155';
        }
        if (bGreen) {
            bGreen.style.background = (cov === 'GREEN_ONLY') ? 'rgba(56,189,248,0.25)' : '#0f172a';
            bGreen.style.color = (cov === 'GREEN_ONLY') ? '#38bdf8' : '#94a3b8';
            bGreen.style.borderColor = (cov === 'GREEN_ONLY') ? '#38bdf8' : '#334155';
        }
        let vizIdx = window.slopeVizHoleIndex();
        let hole = window.courseHoles && window.courseHoles[vizIdx];
        if (hole && typeof window.buildGreenGrid === 'function') {
            window.buildGreenGrid(hole, vizIdx, true);
        }
    };

    window.setGreenGridStyle = function(style) {
        window._greenGridColorMode = style;
        let bHm = document.getElementById('gs-grid-style-heatmap');
        let bWh = document.getElementById('gs-grid-style-white');
        if (bHm) {
            bHm.style.background = (style === 'HEATMAP') ? 'rgba(74,222,128,0.25)' : '#0f172a';
            bHm.style.color = (style === 'HEATMAP') ? '#4ade80' : '#94a3b8';
            bHm.style.borderColor = (style === 'HEATMAP') ? '#4ade80' : '#334155';
        }
        if (bWh) {
            bWh.style.background = (style === 'WHITE') ? 'rgba(74,222,128,0.25)' : '#0f172a';
            bWh.style.color = (style === 'WHITE') ? '#4ade80' : '#94a3b8';
            bWh.style.borderColor = (style === 'WHITE') ? '#4ade80' : '#334155';
        }
        let vizIdx = window.slopeVizHoleIndex();
        let hole = window.courseHoles && window.courseHoles[vizIdx];
        if (hole && typeof window.buildGreenGrid === 'function') {
            window.buildGreenGrid(hole, vizIdx, true);
        }
    };

    // Slope colours (TrackMan style), the one table for the grid, the heatmap and the legend's bands: [from %, to %, colour at
    // "from", colour at "to"], linear in between, the last band held above its end. 1 % / 2,2 % / 3,8 % are the legend's limits.
    const SLOPE_BANDS = [
        [0.0, 1.0, [0.05, 0.88, 1.00], [0.15, 0.95, 1.00]],   // flat: electric cyan
        [1.0, 2.2, [1.00, 0.90, 0.30], [1.00, 0.95, 0.10]],   // gentle break (a typical green 1-2 %): neon gold
        [2.2, 3.8, [1.00, 0.90, 0.05], [1.00, 0.55, 0.05]],   // moderate break: amber
        [3.8, 6.3, [1.00, 0.55, 0.15], [1.00, 0.20, 0.15]]    // severe: coral red
    ];
    const FOREGREEN_DIM = 0.65;   // softer on the foregreen so the putting surface stands out
    // "The ball does not stay here": steeper than the physics lets a rolling ball come to rest on (GolfPhysics.restSlopeLimitPct, from
    // the stimp on the green). Magenta, away from the red of the severe band so it reads as its own thing.
    const NO_REST_COLOR = [0.85, 0.20, 1.00];

    // The stimp the slope view is drawn for: the round's (matchSettings), else the one the physics last used, else 10
    window.slopeViewStimp = function() {
        return (window.matchSettings && window.matchSettings.greenStimp) || window.GREEN_STIMP || 10.0;
    };
    // Steepest slope (%) a ball comes to rest on: { green, foregreen }. The same function as the ball's own stop in physics.js.
    window.restSlopeLimits = function(stimp) {
        const st = stimp || window.slopeViewStimp();
        const P = window.GolfPhysics;
        if (P && typeof P.restSlopeLimitPct === 'function') return { green: P.restSlopeLimitPct('GREEN', st), foregreen: P.restSlopeLimitPct('FOREGREEN', st) };
        return { green: 100 * 0.056 * (10 / Math.max(6, Math.min(14, st))) * 1.4, foregreen: 100 * (0.88 / 9.81) * 1.4 };   // same formulas
    };

    // noRestPct: the slope from which the ball does not stay (restSlopeLimits); left out, there is no such colour
    window.slopePercentToColor = function(slopePct, isForegreen = false, noRestPct) {
        const k = isForegreen ? FOREGREEN_DIM : 1;
        if (noRestPct !== undefined && slopePct >= noRestPct) return NO_REST_COLOR.map(function (c) { return c * k; });
        let band = SLOPE_BANDS[SLOPE_BANDS.length - 1];
        for (const bd of SLOPE_BANDS) { if (slopePct < bd[1]) { band = bd; break; } }
        let t = (slopePct - band[0]) / (band[1] - band[0]);
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        return [0, 1, 2].map(function (i) { return (band[2][i] + t * (band[3][i] - band[2][i])) * k; });
    };

    // The same mapping in GLSL, written out from SLOPE_BANDS (so the heatmap shader cannot drift from the grid and the legend)
    function glslNum(v) { const s = String(v); return s.indexOf('.') >= 0 || s.indexOf('e') >= 0 ? s : s + '.0'; }
    function glslVec(c) { return 'vec3(' + c.map(glslNum).join(', ') + ')'; }
    const SLOPE_COLOR_GLSL = 'vec3 slopeColor(float s) {\n' + SLOPE_BANDS.map(function (bd, i) {
        const body = 'return mix(' + glslVec(bd[2]) + ', ' + glslVec(bd[3]) + ', clamp((s - ' + glslNum(bd[0]) + ') / ' + glslNum(bd[1] - bd[0]) + ', 0.0, 1.0));';
        return i < SLOPE_BANDS.length - 1 ? '    if (s < ' + glslNum(bd[1]) + ') ' + body : '    ' + body;
    }).join('\n') + '\n}\n';
    window._slopeColorGLSL = SLOPE_COLOR_GLSL;   // for the tests

    // Global TrackMan Slope Color Mapping (Used by the 3D Grid and the legend's bands)
    window.getGreenSlopeColor = function(wx, wz, isForegreen = false, limits) {
        let grad = (typeof window.sampleGreenGradient === 'function')
            ? window.sampleGreenGradient(wx, wz, 0.25)
            : { slopePercent: 0 };
        const lim = limits || window.restSlopeLimits();
        return window.slopePercentToColor(grad.slopePercent, isForegreen, isForegreen ? lim.foregreen : lim.green);
    };

    // The legend's last two labels at the current stimp: "3.8–7.8%" (red) and "Won't stop ≥ 7.8%" (magenta), one decimal
    window.slopeLegendTexts = function(isSv) {
        const g = window.restSlopeLimits().green;
        const f = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
        const sev = SLOPE_BANDS[SLOPE_BANDS.length - 1][0];
        return {
            severe: g > sev ? f(sev) + '–' + f(g) + '%' : '> ' + f(sev) + '%',
            noRest: (isSv ? 'Stannar inte ≥ ' : "Won't stop ≥ ") + f(g) + '%'
        };
    };

    // Part of the cache keys: the colours depend on the stimp through the no-rest limit
    function stimpKey() { return 's' + window.slopeViewStimp().toFixed(2); }

    // Height of the drawn ground (the terrain triangles); the bilinear height where that is not available
    function surfaceHeight(x, z) {
        if (typeof window.getTerrainSurfaceHeight === 'function') return window.getTerrainSurfaceHeight(x, z);
        return (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(x, z) : 0;
    }

    // The point on the outline of poly nearest to (px, pz)
    function nearestOnPolygon(px, pz, poly) {
        let best = Infinity, bx = px, bz = pz;
        for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
            const ax = poly[j].x, az = poly[j].z, ex = poly[i].x - ax, ez = poly[i].z - az;
            const l2 = ex * ex + ez * ez;
            let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const qx = ax + t * ex, qz = az + t * ez, d = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
            if (d < best) { best = d; bx = qx; bz = qz; }
        }
        return { x: bx, z: bz };
    }
    window._nearestOnPolygon = nearestOnPolygon;   // for the tests

    // Lines have no polygon offset in WebGL (it only applies to filled triangles), so the grid gets its own depth bias: the line is
    // pulled toward the camera by a fixed step in depth-buffer space. In metres that grows with the square of the distance
    // (about 3 mm at 10 m, 7 cm at 50 m, 0.7 m at 150 m), which is what the depth buffer loses with distance and what the coarser
    // far terrain chunks need, while up close it stays far too small to show the grid through a ridge.
    const GRID_DEPTH_BIAS = 3e-6;
    function addLineDepthBias(mat) {
        mat.onBeforeCompile = function (shader) {
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
                '#include <project_vertex>\n\tgl_Position.z -= ' + GRID_DEPTH_BIAS.toExponential() + ' * gl_Position.w;');
        };
        mat.customProgramCacheKey = function () { return 'greenGridDepthBias'; };
        return mat;
    }
    window._addLineDepthBias = addLineDepthBias;   // for the tests

    // A short fingerprint of what a green's slope view is built from: the outline points (where they are, not only how many), its
    // tension and the foregreen width. Moving a point or changing the foregreen then gives a new cache key even without a terrain change.
    window.greenShapeKey = function(gd) {
        if (!gd) return 'none';
        let h = 0;
        const add = function (v) { h = (Math.imul(h, 31) + Math.round(v * 1000)) | 0; };
        for (const p of (gd.points || [])) { add(p.x); add(p.z); }
        add(gd.tension !== undefined ? gd.tension : 0.5);
        add(gd.foregreenWidth !== undefined ? gd.foregreenWidth : 1.0);
        return (gd.points ? gd.points.length : 0) + ':' + (h >>> 0).toString(36);
    };

    window.buildGreenGrid = function(hole, holeIndex, forceRebuild = false) {
        if (!hole) return;
        
        let coverage = window._greenGridCoverage || 'ALL';
        let colorMode = window._greenGridColorMode || 'HEATMAP';
        let shapeKey = window.greenShapeKey(hole.greenData);
        let terrainRev = window._terrainRevision || 0;
        let gridStep = window._greenGridSpacing || 2.0;  // 2.0 meter TrackMan/GSPro standard spacing
        let cacheKey = `${holeIndex}_${terrainRev}_${coverage}_${colorMode}_${shapeKey}_${gridStep}_${stimpKey()}`;
        
        if (!forceRebuild && window._greenGridCacheKey === cacheKey && window.greenGridMesh) {
            return;
        }
        
        // Dispose previous geometry/material
        if (window.greenGridMesh) {
            scene.remove(window.greenGridMesh);
            window.greenGridMesh.geometry.dispose();
            window.greenGridMesh.material.dispose();
            window.greenGridMesh = null;
        }
        if (forceRebuild && typeof window.clearGreenBeads === 'function') {
            window.clearGreenBeads();
        }
        
        let gd = hole.greenData;
        if (!gd) return;
        
        // 1. Resolve High-Definition Spline Polygons via central resolver
        let targetPoly = window.getActiveGreenPolygon(hole, coverage);
        if (!targetPoly || targetPoly.length < 3) return;
        
        let innerPoly = window.getActiveGreenPolygon(hole, 'GREEN_ONLY');
        let outerPoly = window.getActiveGreenPolygon(hole, 'ALL');
        let fgWidth = (gd.foregreenWidth !== undefined) ? gd.foregreenWidth : 1.0;

        // 2. Compute Bounding Box
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let p of targetPoly) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        
        let subStep = 0.25;  // 25 cm height-following resolution
        let isHeatmap = (window._greenGridColorMode !== 'WHITE');
        
        let gridPositions = [];
        let gridColors = [];
        
        // TrackMan Color Mapping Function (High-contrast against green turf)
        const limits = window.restSlopeLimits();
        function getSlopeColor(wx, wz, isForegreen) {
            if (!isHeatmap) {
                return isForegreen ? [0.70, 0.70, 0.70] : [1.0, 1.0, 1.0];
            }
            return window.getGreenSlopeColor(wx, wz, isForegreen, limits);
        }

        // Helper: Check if point is inside inner green
        function isPointInInnerGreen(wx, wz) {
            if (!innerPoly || innerPoly === outerPoly || fgWidth <= 0.05) return true;
            return window.pointInPolygon(wx, wz, innerPoly);
        }

        // Clean single-stroke line 8 mm above the drawn ground (the terrain triangles, see surfaceHeight)
        const lineH = 0.008;

        // --- 1. HORIZONTAL GRID LINES (constant Z, running along X) ---
        let startZ = Math.floor(minZ / gridStep) * gridStep;
        let endZ = Math.ceil(maxZ / gridStep) * gridStep;
        let nPoly = targetPoly.length;
        
        for (let z = startZ; z <= endZ; z += gridStep) {
            // Find all exact X intersections with targetPoly edges
            let xs = [];
            for (let i = 0; i < nPoly; i++) {
                let p1 = targetPoly[i];
                let p2 = targetPoly[(i + 1) % nPoly];
                let z1 = p1.z, z2 = p2.z;
                if ((z1 <= z && z2 > z) || (z2 <= z && z1 > z)) {
                    let t = (z - z1) / (z2 - z1);
                    let xInter = p1.x + t * (p2.x - p1.x);
                    xs.push(xInter);
                }
            }
            xs.sort((a, b) => a - b);
            
            // For each pair of intersections [x1, x2]
            for (let k = 0; k + 1 < xs.length; k += 2) {
                let xStart = xs[k];
                let xEnd = xs[k + 1];
                if (xEnd - xStart < 0.05) continue;
                
                // Sample points along terrain
                let prevX = xStart;
                let prevY = surfaceHeight(prevX, z) + lineH;
                let prevIsFg = !isPointInInnerGreen(prevX, z);
                let prevColor = getSlopeColor(prevX, z, prevIsFg);
                
                let curX = xStart + subStep;
                while (curX < xEnd) {
                    let curY = surfaceHeight(curX, z) + lineH;
                    let curIsFg = !isPointInInnerGreen(curX, z);
                    let curColor = getSlopeColor(curX, z, curIsFg);
                    
                    gridPositions.push(prevX, prevY, z, curX, curY, z);
                    gridColors.push(
                        prevColor[0], prevColor[1], prevColor[2], curColor[0], curColor[1], curColor[2]
                    );
                    
                    prevX = curX;
                    prevY = curY;
                    prevColor = curColor;
                    curX += subStep;
                }
                
                // Final exact endpoint to xEnd
                let endY = surfaceHeight(xEnd, z) + lineH;
                let endIsFg = !isPointInInnerGreen(xEnd, z);
                let endColor = getSlopeColor(xEnd, z, endIsFg);
                
                gridPositions.push(prevX, prevY, z, xEnd, endY, z);
                gridColors.push(
                    prevColor[0], prevColor[1], prevColor[2], endColor[0], endColor[1], endColor[2]
                );
            }
        }

        // --- 2. VERTICAL GRID LINES (constant X, running along Z) ---
        let startX = Math.floor(minX / gridStep) * gridStep;
        let endX = Math.ceil(maxX / gridStep) * gridStep;
        
        for (let x = startX; x <= endX; x += gridStep) {
            let zs = [];
            for (let i = 0; i < nPoly; i++) {
                let p1 = targetPoly[i];
                let p2 = targetPoly[(i + 1) % nPoly];
                let x1 = p1.x, x2 = p2.x;
                if ((x1 <= x && x2 > x) || (x2 <= x && x1 > x)) {
                    let t = (x - x1) / (x2 - x1);
                    let zInter = p1.z + t * (p2.z - p1.z);
                    zs.push(zInter);
                }
            }
            zs.sort((a, b) => a - b);
            
            for (let k = 0; k + 1 < zs.length; k += 2) {
                let zStart = zs[k];
                let zEnd = zs[k + 1];
                if (zEnd - zStart < 0.05) continue;
                
                let prevZ = zStart;
                let prevY = surfaceHeight(x, prevZ) + lineH;
                let prevIsFg = !isPointInInnerGreen(x, prevZ);
                let prevColor = getSlopeColor(x, prevZ, prevIsFg);
                
                let curZ = zStart + subStep;
                while (curZ < zEnd) {
                    let curY = surfaceHeight(x, curZ) + lineH;
                    let curIsFg = !isPointInInnerGreen(x, curZ);
                    let curColor = getSlopeColor(x, curZ, curIsFg);
                    
                    gridPositions.push(x, prevY, prevZ, x, curY, curZ);
                    gridColors.push(
                        prevColor[0], prevColor[1], prevColor[2], curColor[0], curColor[1], curColor[2]
                    );
                    
                    prevZ = curZ;
                    prevY = curY;
                    prevColor = curColor;
                    curZ += subStep;
                }
                
                let endY = surfaceHeight(x, zEnd) + lineH;
                let endIsFg = !isPointInInnerGreen(x, zEnd);
                let endColor = getSlopeColor(x, zEnd, endIsFg);
                
                gridPositions.push(x, prevY, prevZ, x, endY, zEnd);
                gridColors.push(
                    prevColor[0], prevColor[1], prevColor[2], endColor[0], endColor[1], endColor[2]
                );
            }
        }
        
        // --- 3. CREATE THREE.JS LINE MESH ---
        if (gridPositions.length > 0) {
            let gridGeo = new THREE.BufferGeometry();
            gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
            gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(gridColors, 3));
            
            let gridMat = addLineDepthBias(new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.95,
                depthTest: true,
                depthWrite: false
            }));
            window.greenGridMesh = new THREE.LineSegments(gridGeo, gridMat);
            window.greenGridMesh.renderOrder = 998;
            let isStudioLutning = !!(window.GreenStudio && window.GreenStudio.isOpen && window.GreenStudio.activeTab === 'lutning');
            let initialVisible = window._globalGreenGridEnabled
                ? true
                : (isStudioLutning ? (window._studioShowGrid !== false) : (window.greenGridEnabled !== false));
            window.greenGridMesh.visible = initialVisible;
            scene.add(window.greenGridMesh);
            window.greenGridForHoleIndex = holeIndex;
            window._greenGridCacheKey = cacheKey;
            console.log(`📐 TrackMan Green Grid generated: ${gridPositions.length / 6} segments, coverage: ${coverage}, mode: ${window._greenGridColorMode}`);
        }
    };

    // Reset grid & heatmap when moving to a new hole.
    // IMPORTANT: scene.remove() BEFORE dispose() — THREE.js internal refs must
    // be released from the scene graph before GPU resources are freed.
    window.clearGreenHeatmap = function() {
        if (window.greenHeatmapMesh) {
            scene.remove(window.greenHeatmapMesh);
            if (window.greenHeatmapMesh.geometry) window.greenHeatmapMesh.geometry.dispose();
            if (window.greenHeatmapMesh.material) window.greenHeatmapMesh.material.dispose();
            window.greenHeatmapMesh = null;
        }
        window._greenHeatmapCacheKey = null;
        window.greenHeatmapForHoleIndex = -1;
    };

    window.buildGreenHeatmapMesh = function(hole, holeIndex, forceRebuild = false) {
        if (!hole) return;
        
        let coverage = window._greenGridCoverage || 'ALL';
        let shapeKey = window.greenShapeKey(hole.greenData);
        let terrainRev = window._terrainRevision || 0;
        let hmStep = 0.50;  // 50 cm smooth grid resolution
        let cacheKey = `hm_${holeIndex}_${terrainRev}_${coverage}_${shapeKey}_${hmStep}_${stimpKey()}`;
        
        if (!forceRebuild && window._greenHeatmapCacheKey === cacheKey && window.greenHeatmapMesh) {
            return;
        }
        
        window.clearGreenHeatmap();
        
        let gd = hole.greenData;
        if (!gd) return;
        
        let targetPoly = (typeof window.getActiveGreenPolygon === 'function')
            ? window.getActiveGreenPolygon(hole, coverage)
            : (gd.densePts || null);
        if (!targetPoly || targetPoly.length < 3) return;
        
        let innerPoly = (typeof window.getActiveGreenPolygon === 'function')
            ? window.getActiveGreenPolygon(hole, 'GREEN_ONLY')
            : null;
        let fgWidth = (gd.foregreenWidth !== undefined) ? gd.foregreenWidth : 1.0;
        
        // Bounding Box
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let p of targetPoly) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        if (!isFinite(minX)) return;
        
        let startX = Math.floor(minX / hmStep) * hmStep;
        let endX = Math.ceil(maxX / hmStep) * hmStep;
        let startZ = Math.floor(minZ / hmStep) * hmStep;
        let endZ = Math.ceil(maxZ / hmStep) * hmStep;
        
        let cols = Math.round((endX - startX) / hmStep) + 1;
        let rows = Math.round((endZ - startZ) / hmStep) + 1;
        let vertMap = new Int32Array(cols * rows);
        vertMap.fill(-1);
        
        // The slope (not a colour) goes on each corner, and the shader turns it into a colour per pixel: blending the colours of the
        // corners across a band edge (cyan next to gold) gave in-between shades that are not in the legend.
        let positions = [];
        let slopes = [];
        let fgFlags = [];
        let indices = [];
        let vertCount = 0;
        
        // A corner outside the green is moved onto its outline: the cells along the edge are cut back to it, so the heatmap ends at
        // the edge of the green instead of reaching up to a cell (50 cm) out over the bank in steps.
        function getOrCreateVertex(col, row, wx, wz) {
            let mapIdx = row * cols + col;
            if (vertMap[mapIdx] !== -1) {
                return vertMap[mapIdx];
            }
            if (!window.pointInPolygon(wx, wz, targetPoly)) {
                let q = nearestOnPolygon(wx, wz, targetPoly);
                wx = q.x; wz = q.z;
            }
            let curH = surfaceHeight(wx, wz);
            let y = curH + 0.005; // 5 mm elevation above grass to eliminate z-fighting
            
            let isFg = (innerPoly && fgWidth > 0.05) ? !window.pointInPolygon(wx, wz, innerPoly) : false;
            let grad = (typeof window.sampleGreenGradient === 'function') ? window.sampleGreenGradient(wx, wz, 0.25) : { slopePercent: 0 };

            positions.push(wx, y, wz);
            slopes.push(grad.slopePercent);
            fgFlags.push(isFg ? 1 : 0);
            
            let newIdx = vertCount++;
            vertMap[mapIdx] = newIdx;
            return newIdx;
        }
        
        for (let r = 0; r < rows - 1; r++) {
            let wz0 = startZ + r * hmStep;
            let wz1 = wz0 + hmStep;
            for (let c = 0; c < cols - 1; c++) {
                let wx0 = startX + c * hmStep;
                let wx1 = wx0 + hmStep;
                
                // Fast polygon inclusion test: check center, then corners
                let midX = (wx0 + wx1) * 0.5;
                let midZ = (wz0 + wz1) * 0.5;
                let centerIn = window.pointInPolygon(midX, midZ, targetPoly);
                if (!centerIn) {
                    let in00 = window.pointInPolygon(wx0, wz0, targetPoly);
                    let in10 = window.pointInPolygon(wx1, wz0, targetPoly);
                    let in11 = window.pointInPolygon(wx1, wz1, targetPoly);
                    let in01 = window.pointInPolygon(wx0, wz1, targetPoly);
                    if (!in00 && !in10 && !in11 && !in01) {
                        continue;
                    }
                }
                
                let v00 = getOrCreateVertex(c, r, wx0, wz0);
                let v10 = getOrCreateVertex(c + 1, r, wx1, wz0);
                let v11 = getOrCreateVertex(c + 1, r + 1, wx1, wz1);
                let v01 = getOrCreateVertex(c, r + 1, wx0, wz1);
                
                // Quad: two CCW triangles
                indices.push(v00, v10, v11);
                indices.push(v00, v11, v01);
            }
        }
        
        if (indices.length === 0) return;
        
        let geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('aSlope', new THREE.Float32BufferAttribute(slopes, 1));
        geo.setAttribute('aFg', new THREE.Float32BufferAttribute(fgFlags, 1));
        geo.setIndex(indices);
        
        const limits = window.restSlopeLimits();
        let mat = new THREE.ShaderMaterial({
            uniforms: { uOpacity: { value: 0.68 }, uNoRest: { value: limits.green }, uNoRestFg: { value: limits.foregreen } },
            vertexShader: [
                'attribute float aSlope;', 'attribute float aFg;', 'varying float vSlope;', 'varying float vFg;',
                'void main() {', '    vSlope = aSlope; vFg = aFg;',
                '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);', '}'
            ].join('\n'),
            fragmentShader: 'uniform float uOpacity;\nuniform float uNoRest;\nuniform float uNoRestFg;\nvarying float vSlope;\nvarying float vFg;\n' + SLOPE_COLOR_GLSL +
                'void main() {\n    bool fg = vFg > 0.5;\n' +
                '    vec3 c = vSlope >= (fg ? uNoRestFg : uNoRest) ? ' + glslVec(NO_REST_COLOR) + ' : slopeColor(vSlope);\n' +
                '    gl_FragColor = vec4(c * (fg ? ' + glslNum(FOREGREEN_DIM) + ' : 1.0), uOpacity);\n}\n',
            transparent: true,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3.0,
            polygonOffsetUnits: -3.0,
            side: THREE.DoubleSide
        });
        
        let mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 996; // Under grid (998) and break line (997)
        mesh.frustumCulled = false;
        mesh.visible = (window._greenSlopeMode === 'HEATMAP');
        scene.add(mesh);
        
        window.greenHeatmapMesh = mesh;
        window._greenHeatmapCacheKey = cacheKey;
        window.greenHeatmapForHoleIndex = holeIndex;
        console.log(`🌈 Green Slope Heatmap generated: ${indices.length / 3} triangles, ${positions.length / 3} vertices for hole ${holeIndex}`);
    };

    window.resetGreenGrid = function() {
        if (window.greenGridMesh) {
            scene.remove(window.greenGridMesh);           // 1. Remove from scene graph first
            window.greenGridMesh.geometry.dispose();      // 2. Free GPU vertex buffer
            window.greenGridMesh.material.dispose();      // 3. Free GPU shader/texture
            window.greenGridMesh = null;                  // 4. Release JS reference
        }
        window.clearGreenHeatmap();
        if (typeof window.clearBreakLine === 'function') {
            window.clearBreakLine();
        }
        window.greenGridForHoleIndex = -1; // Force rebuild on next green landing
        window._greenGridCacheKey = null;
        let leg = document.getElementById('green-slope-hud-legend');
        if (leg && leg.style.display !== 'none') {
            leg.style.display = 'none';
            if (typeof window.updateBottomHUDLayout === 'function') window.updateBottomHUDLayout();
        }
    };
    
    // === PUTT BREAK LINE ===
    // Simulates a simplified putt path from ball to hole using terrain slope
    // Shows as a curved dashed line on the green surface
    window.buildBreakLine = function() {
        if (typeof window.clearBreakLine === 'function') {
            window.clearBreakLine();
        }
        if (window.getPuttAssist() !== 'FULL') return;   // putt assist: only the full level shows the planned line
        
        let hole = courseHoles[playingHoleIndex];
        if (!hole || !hole.flag) return;
        
        let ballX = window.ballMesh.position.x;
        let ballZ = window.ballMesh.position.z;
        let flagX = hole.flag.x;
        let flagZ = hole.flag.z;
        
        // Only show on green within reasonable distance
        let distToFlag = Math.hypot(ballX - flagX, ballZ - flagZ);
        if (distToFlag > 25 || distToFlag < 0.5) return;
        
        let ballSurf = (typeof localGetTerrainAt === 'function') ? localGetTerrainAt(ballX, -ballZ) : null;
        if (!ballSurf || ballSurf.type !== 'GREEN') return;
        
        // Quick estimate, drawn at once; the physics line replaces it a moment later. Stepping toward the flag while the slope
        // pushes the ball downhill gives a path that sags to the LOW side of the straight line, but a putt that drops has to start
        // out on the HIGH side and fall in. So the sag is mirrored across the straight line ball -> flag: same shape, right side.
        let steps = 60;
        let pts = [];
        let dx = flagX - ballX;
        let dz = flagZ - ballZ;
        let dist = Math.hypot(dx, dz);
        let dirX = dx / dist;
        let dirZ = dz / dist;
        let nX = -dirZ, nZ = dirX;   // unit normal of the straight line
        let simX = ballX;
        let simZ = ballZ;
        let stepSize = dist / steps;
        let slopeInfluence = 0.35; // How much slope affects the line

        for (let i = 0; i <= steps; i++) {
            let off = (simX - ballX) * nX + (simZ - ballZ) * nZ;   // signed distance from the straight line (downhill side)
            let px = simX - 2 * off * nX;
            let pz = simZ - 2 * off * nZ;
            let h = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(px, pz) + 0.04 : 0.04;
            pts.push(px, h, pz);

            if (i < steps) {
                let grad = (typeof window.sampleGreenGradient === 'function')
                    ? window.sampleGreenGradient(simX, simZ, 0.20)
                    : { downhillX: 0, downhillZ: 0, slopeMagnitude: 0 };

                let toFlagX = flagX - simX;
                let toFlagZ = flagZ - simZ;
                let toFlagDist = Math.hypot(toFlagX, toFlagZ);
                let sx = dirX, sz = dirZ;
                if (toFlagDist > 0.01) {
                    sx = toFlagX / toFlagDist;
                    sz = toFlagZ / toFlagDist;
                }

                // Downhill slope deflection
                let deflectX = grad.downhillX * grad.slopeMagnitude * slopeInfluence;
                let deflectZ = grad.downhillZ * grad.slopeMagnitude * slopeInfluence;
                simX += (sx + deflectX) * stepSize;
                simZ += (sz + deflectZ) * stepSize;
            }
        }

        // Build THREE.js line
        let geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        
        let mat = new THREE.LineDashedMaterial({
            color: 0xfbbf24, // Amber/gold
            transparent: true,
            opacity: 0.7,
            dashSize: 0.15,
            gapSize: 0.08,
            depthTest: false
        });
        
        window.breakGuideMesh = new THREE.Line(geo, mat);
        window.breakGuideMesh.computeLineDistances();
        window.breakGuideMesh.name = 'breakLine';
        window.breakGuideMesh.renderOrder = 2;
        scene.add(window.breakGuideMesh);

        // ~100 simulated putts: run after the turn has moved on, and drop the result if the ball or the line has changed meanwhile
        const mesh = window.breakGuideMesh;
        const refine = function () {
            if (window.breakGuideMesh !== mesh || typeof window.puttBreakPath !== 'function') return;
            // a player who has finished the hole (gimme, auto-putt, concede) or a shot already under way: nothing left to plan
            const ap = window.players && window.players[window.activePlayerIndex];
            if ((ap && ap.holedOut) || playState !== 'ROUND_IDLE') return;
            const bp = window.ballMesh.position;
            if (Math.abs(bp.x - ballX) > 0.01 || Math.abs(bp.z - ballZ) > 0.01) return;
            const precise = window.puttBreakPath(ballX, ballZ, hole);
            if (!precise || window.breakGuideMesh !== mesh) return;
            mesh.geometry.dispose();
            mesh.geometry = new THREE.BufferGeometry();
            mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(precise, 3));
            mesh.computeLineDistances();
        };
        // wait out the turn change (200 ms, 1000 ms after a holed player), then do it when the browser is idle
        setTimeout(function () {
            if (typeof requestIdleCallback === 'function') requestIdleCallback(refine, { timeout: 1500 });
            else refine();
        }, 1300);   // past the longest turn change (1000 ms after a holed player)
    };
    
    // The break line is a putt played with the real physics: the pace a player would give a putt to this hole (distance + the
    // usual overroll), aimed so that it is the line that drops in (or, on a very hard break, passes closest). Returns three.js
    // points [x,y,z,...] along the rolling ball, or null when the physics is not available.
    // The putt a player would hit from the ball to this hole: where the cup is, where the ball starts, the bearing straight at the cup,
    // and a launch config for any aim measured from that bearing. Shared by the planned line and the aim line.
    function puttContext(ballX, ballZ, hole) {
        if (!window.GolfPhysics || typeof physicsTerrainAt !== 'function') return null;
        const cupZ = hole.flagMesh ? hole.flagMesh.position.y : (physicsTerrainAt(hole.flag.x, -hole.flag.z).z);
        const cup = [hole.flag.x, -hole.flag.z, cupZ];
        const start = [ballX, -ballZ, physicsTerrainAt(ballX, -ballZ).z + 0.022];
        const dist = Math.hypot(cup[0] - start[0], cup[1] - start[1]);
        const baseAz = Math.atan2(cup[0] - start[0], cup[1] - start[1]) * 180 / Math.PI;
        window.GREEN_STIMP = (window.matchSettings && window.matchSettings.greenStimp) ? window.matchSettings.greenStimp : 10.0;
        const env = { getTerrainAt: physicsTerrainAt, wind: [0, 0, 0], cupPositionLocal: cup };
        const cfgAt = function (azOff) {
            return { startPos: start, ballSpeedMph: 3, launchAngleDeg: 1.5, totalSpinRpm: 300, spinAxisDeg: 0,
                     azimDeg: baseAz + azOff, isLiveData: false, isTeeShot: false };
        };
        return { cup: cup, start: start, dist: dist, baseAz: baseAz, env: env, cfgAt: cfgAt };
    }

    // The aim line: a putt hit along the bearing the player is aiming at (azimDeg, degrees clockwise from -z like a shot), at the pace
    // for this hole, played with the real physics. Unlike the planned line it does not look for the aim that drops in: it shows where
    // this aim ends up, to the cup when it is holed and otherwise to where the ball comes to rest. Returns three.js points, at most
    // maxPts, or null when the physics is not available.
    let pace = null;   // { key, v }: the pace puttPathForAim last sized
    window.puttPathForAim = function (ballX, ballZ, hole, azimDeg, maxPts) {
        const ctx = puttContext(ballX, ballZ, hole);
        if (!ctx) return null;
        const quiet = console.log; console.log = function () {};
        try {
            // the pace is sized once per ball position, straight at the cup, and kept while only the aim moves (the player's stroke does
            // not change when the aim does; sizing it again for every aim would also make a miss roll as far as a hit)
            const paceKey = ctx.start[0].toFixed(2) + '|' + ctx.start[1].toFixed(2) + '|' + ctx.cup[0].toFixed(2) + '|' + ctx.cup[1].toFixed(2) + '|' + window.GREEN_STIMP;
            if (!pace || pace.key !== paceKey) pace = { key: paceKey, v: window.calibratePuttSpeed(ctx.cfgAt(0), ctx.dist + 0.45, 22) };
            const c = ctx.cfgAt(azimDeg - ctx.baseAz);
            c.ballSpeedMph = pace.v;
            const r = window.GolfPhysics.simulateFlight(c, ctx.env);
            const path = r.path, last = path.length - 1;
            const stride = Math.max(1, Math.ceil(last / ((maxPts || 150) - 1)));
            const pts = [];
            for (let i = 0; i < last; i += stride) pts.push(path[i].x, path[i].z + 0.04, -path[i].y);
            pts.push(path[last].x, path[last].z + 0.04, -path[last].y);
            return pts.length >= 6 ? pts : null;
        } catch (e) {
            return null;
        } finally {
            console.log = quiet;
        }
    };

    // The speed that rolls targetDist along the line straight at the cup from this ball: the pace of the aim line, whatever bearing the
    // shot is hit along (on a slope the roll distance depends on the direction). Null when the physics is not available.
    window.puttPaceAlongCup = function (ballX, ballZ, hole, targetDist) {
        const ctx = puttContext(ballX, ballZ, hole);
        if (!ctx) return null;
        const quiet = console.log; console.log = function () {};
        try { return window.calibratePuttSpeed(ctx.cfgAt(0), targetDist, 22); } catch (e) { return null; } finally { console.log = quiet; }
    };

    window.puttBreakPath = function (ballX, ballZ, hole) {
        const ctx = puttContext(ballX, ballZ, hole);
        if (!ctx) return null;
        const cup = ctx.cup, start = ctx.start, dist = ctx.dist, cfgAt = ctx.cfgAt, env = ctx.env;
        const quiet = console.log; console.log = function () {};
        try {
            // pace: for every aim, the speed that takes the ball (distance + overroll) from where it started, as a player
            // sizes up the putt by distance; the last pace is the first guess for the next aim
            let v = window.calibratePuttSpeed(cfgAt(0), dist + 0.45, 22);
            const run = function (azOff) {
                const c = cfgAt(azOff); c.ballSpeedMph = v;
                v = c.ballSpeedMph = window.calibratePuttSpeed(c, dist + 0.45, 22);
                const r = window.GolfPhysics.simulateFlight(c, env);
                let closest = Infinity;
                for (const p of r.path) closest = Math.min(closest, Math.hypot(p.x - cup[0], p.y - cup[1]));
                const last = r.path[r.path.length - 1];
                const holed = !!(r.metrics && r.metrics.holed);
                return { az: azOff, v: v, r: r, closest: closest, holed: !!holed, rest: Math.hypot(last.x - cup[0], last.y - cup[1]) };
            };
            // signed miss at the closest pass: which side of the cup the ball goes, so the aim can be bracketed and bisected
            const side = function (t) {
                let bi = 0, bd = Infinity;
                t.r.path.forEach(function (p, i) { const d = Math.hypot(p.x - cup[0], p.y - cup[1]); if (d < bd) { bd = d; bi = i; } });
                const p = t.r.path[bi];
                const cross = (p.x - start[0]) * (cup[1] - start[1]) - (p.y - start[1]) * (cup[0] - start[0]);
                return cross >= 0 ? 1 : -1;
            };
            let trials = [];
            const probe = function (a) { const t = run(a); t.side = side(t); trials.push(t); return t; };
            for (let a = -30; a <= 30; a += 10) probe(a);
            const better = function (a, b) { return a.closest !== b.closest ? a.closest < b.closest : a.rest < b.rest; };
            let best = trials[0];
            for (const t of trials) if (better(t, best)) best = t;
            // narrow in on the aim where the ball switches from passing on one side to the other
            trials.sort(function (a, b) { return a.az - b.az; });
            let lo = null, hi = null;
            for (let i = 0; i + 1 < trials.length; i++) {
                if (trials[i].side !== trials[i + 1].side && (!lo || Math.abs(trials[i].az + trials[i + 1].az) < Math.abs(lo.az + hi.az))) { lo = trials[i]; hi = trials[i + 1]; }
            }
            if (lo) {
                for (let k = 0; k < 7; k++) {
                    const t = probe((lo.az + hi.az) / 2);
                    if (t.side === lo.side) lo = t; else hi = t;
                    if (better(t, best)) best = t;
                }
            }
            // when several aims drop in, take the middle of them: the line with the most margin
            const holes = trials.filter(function (t) { return t.holed; }).sort(function (a, b) { return a.az - b.az; });
            if (holes.length) best = holes[Math.floor(holes.length / 2)];
            window._breakLineInfo = { aimOffsetDeg: best.az, speedMph: best.v, holed: best.holed, closestM: best.closest, trials: trials.length };
            // the path up to the cup, or to the closest point when it misses
            let pts = [], stride = Math.max(1, Math.floor(best.r.path.length / 120));
            const path = best.r.path;
            // a ball that misses is shown only up to where it passes the cup
            let endI = path.length - 1;
            if (!best.holed) {
                let bd = Infinity;
                path.forEach(function (p, i) { const d = Math.hypot(p.x - cup[0], p.y - cup[1]); if (d < bd) { bd = d; endI = i; } });
            }
            for (let i = 0; i < endI; i += stride) pts.push(path[i].x, path[i].z + 0.04, -path[i].y);
            const l = path[endI]; pts.push(l.x, l.z + 0.04, -l.y);
            return pts.length >= 6 ? pts : null;
        } catch (e) {
            return null;
        } finally {
            console.log = quiet;
        }
    };

    // Putt assist for the round, chosen in the round settings: 'FULL' (planned line, aim line and slope view), 'SLOPE' (slope grid/heatmap
    // only, no lines) or 'OFF' (none of them). Outside a round (build mode, Green Studio, tests) everything is available.
    window.getPuttAssist = function () {
        const m = window.matchSettings, lvl = m && m.puttAssist;
        const inRound = typeof appMode !== 'undefined' && appMode === 'PLAY';
        return inRound && (lvl === 'SLOPE' || lvl === 'OFF') ? lvl : 'FULL';
    };

    // Brings the screen in line with the level: lines drawn or removed, slope view switched off when the level has none
    window.applyPuttAssist = function () {
        const lvl = window.getPuttAssist();
        if (lvl === 'FULL') {
            if (typeof playState !== 'undefined' && playState === 'ROUND_IDLE' && window.ballMesh && typeof courseHoles !== 'undefined') window.buildBreakLine();
        } else {
            window.clearBreakLine();
            if (window.breakLineMesh) window.breakLineMesh.visible = false;
        }
        if (lvl === 'OFF' && window._greenSlopeMode && window._greenSlopeMode !== 'OFF') window.cycleGreenSlopeMode('OFF');
        if (typeof window.syncGreenSlopeUI === 'function') window.syncGreenSlopeUI();
    };

    window.setPuttAssist = function (level) {
        if (level !== 'SLOPE' && level !== 'OFF') level = 'FULL';
        if (window.matchSettings) window.matchSettings.puttAssist = level;
        ['set-putt-assist', 'ir-putt-assist'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el && el.value !== level) el.value = level;
        });
        window.applyPuttAssist();
    };

    window.clearBreakLine = function() {
        if (window.breakGuideMesh) {
            scene.remove(window.breakGuideMesh);
            window.breakGuideMesh.geometry.dispose();
            window.breakGuideMesh.material.dispose();
            window.breakGuideMesh = null;
        }
        if (window.breakLineMesh) {
            scene.remove(window.breakLineMesh);
        }
        if (window._breakLineGeo) {
            window._breakLineGeo.dispose();
            window._breakLineGeo = null;
        }
        if (window._breakLineMat) {
            window._breakLineMat.dispose();
            window._breakLineMat = null;
        }
        if (window.breakLineMesh) {
            if (window.breakLineMesh.geometry && window.breakLineMesh.geometry !== window._breakLineGeo) {
                window.breakLineMesh.geometry.dispose();
            }
            if (window.breakLineMesh.material && window.breakLineMesh.material !== window._breakLineMat) {
                window.breakLineMesh.material.dispose();
            }
            window.breakLineMesh = null;
        }
        window._breakLinePositions = null;
        window._breakLinePosAttr = null;
        window._aimLineKey = null;   // the aim line is redrawn into the new buffer
    };
