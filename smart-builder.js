// ============================================================
// smart-builder.js — Smart Builder Module for Golf OS Arcade
// Extracted from arcade.html for maintainability
// All shared state accessed via window.* namespace
// ============================================================

// === SMART GREEN SPLINE STATE ===
// Using var for global accessibility from arcade.html event handlers
var smartGreenPoints = [];
var smartGreenSpheres = [];
var smartGreenLineMesh = null;
window.smartGreenPoints = smartGreenPoints;
window.smartGreenSpheres = smartGreenSpheres;

// === MOWING PATTERN PAINTER ===
// Paints stripe/checker/diamond patterns inside a polygon on the terrain canvas
// Called after the solid base fill for both greens and fairways
function paintMowingPattern(ctx, densePts, baseColor, patternType, stripeAngle) {
    if (!patternType || patternType === 'SOLID') return;

    var TS = window.TERRAIN_SIZE;
    var scale = 4096 / TS;

    // Parse base color → HSL for lighter/darker stripes
    var tempCanvas = document.createElement('canvas');
    tempCanvas.width = 1; tempCanvas.height = 1;
    var tc = tempCanvas.getContext('2d');
    tc.fillStyle = baseColor;
    tc.fillRect(0, 0, 1, 1);
    var px = tc.getImageData(0, 0, 1, 1).data;
    var r = px[0], g = px[1], b = px[2];

    // Lighter stripe color (+12 brightness, slight saturation shift)
    var lightR = Math.min(255, r + 14);
    var lightG = Math.min(255, g + 16);
    var lightB = Math.min(255, b + 8);
    var lightColor = 'rgb(' + lightR + ',' + lightG + ',' + lightB + ')';
    // Darker stripe color (base is already painted, so we only paint light stripes)

    // Bounding box of polygon in world coords
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < densePts.length; i++) {
        if (densePts[i].x < minX) minX = densePts[i].x;
        if (densePts[i].x > maxX) maxX = densePts[i].x;
        if (densePts[i].z < minZ) minZ = densePts[i].z;
        if (densePts[i].z > maxZ) maxZ = densePts[i].z;
    }

    // Stripe width in world meters
    var stripeW = (patternType === 'CHECKERBOARD' || patternType === 'DIAMOND') ? 2.5 : 3.0;
    var stripeWpx = stripeW * scale;

    // Clip to polygon shape
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i < densePts.length; i++) {
        var pxX = ((densePts[i].x + TS / 2) / TS) * 4096;
        var pxY = ((densePts[i].z + TS / 2) / TS) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY);
        else ctx.lineTo(pxX, pxY);
    }
    ctx.closePath();
    ctx.clip();

    // Compute rotation center in pixels
    var cx = ((minX + maxX) / 2 + TS / 2) / TS * 4096;
    var cz = ((minZ + maxZ) / 2 + TS / 2) / TS * 4096;

    // Auto-detect principal axis (longest direction) via 2D PCA
    // Compute centroid
    var centX = 0, centZ = 0;
    for (var i = 0; i < densePts.length; i++) { centX += densePts[i].x; centZ += densePts[i].z; }
    centX /= densePts.length; centZ /= densePts.length;
    // Covariance matrix [cxx, cxz; cxz, czz]
    var cxx = 0, cxz = 0, czz = 0;
    for (var i = 0; i < densePts.length; i++) {
        var dx = densePts[i].x - centX;
        var dz = densePts[i].z - centZ;
        cxx += dx * dx; cxz += dx * dz; czz += dz * dz;
    }
    // Principal eigenvector angle (largest eigenvalue direction)
    var angle = 0.5 * Math.atan2(2 * cxz, cxx - czz);
    if (patternType === 'DIAGONAL') angle += Math.PI / 4;
    if (patternType === 'DIAMOND') angle += Math.PI / 4;

    ctx.translate(cx, cz);
    ctx.rotate(angle);
    ctx.translate(-cx, -cz);

    // Draw range (expanded for rotation)
    var diagLen = Math.sqrt((maxX - minX) * (maxX - minX) + (maxZ - minZ) * (maxZ - minZ));
    var halfDiag = (diagLen / 2 + stripeW * 2) * scale;
    var startX = cx - halfDiag;
    var endX = cx + halfDiag;
    var startZ = cz - halfDiag;
    var endZ = cz + halfDiag;

    ctx.fillStyle = lightColor;

    if (patternType === 'STRIPES' || patternType === 'DIAGONAL') {
        // Alternating horizontal bands (every other stripe)
        ctx.fillStyle = lightColor;
        for (var z = startZ; z < endZ; z += stripeWpx * 2) {
            ctx.fillRect(startX, z, (endX - startX), stripeWpx);
        }
    } else if (patternType === 'CHECKERBOARD' || patternType === 'DIAMOND') {
        // Darker stripe color
        var darkR = Math.max(0, r - 12);
        var darkG = Math.max(0, g - 14);
        var darkB = Math.max(0, b - 6);
        var darkColor = 'rgb(' + darkR + ',' + darkG + ',' + darkB + ')';

        // Realistic cross-mow: one dark pass, one light pass
        // Pass 1: horizontal stripes (dark)
        ctx.fillStyle = darkColor;
        ctx.globalAlpha = 0.5;
        for (var z = startZ; z < endZ; z += stripeWpx * 2) {
            ctx.fillRect(startX, z, (endX - startX), stripeWpx);
        }
        // Pass 2: vertical stripes (light), creates true woven checkerboard
        ctx.fillStyle = lightColor;
        ctx.globalAlpha = 0.5;
        for (var x = startX; x < endX; x += stripeWpx * 2) {
            ctx.fillRect(x, startZ, stripeWpx, (endZ - startZ));
        }
        ctx.globalAlpha = 1.0;
    }

    ctx.restore(); // Removes clip + rotation
}
// === Anti-crossing utilities for Smart Builder ===
// Line segment intersection test (2D, using x/z)
function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
    let det = (bx-ax)*(dz-cz) - (bz-az)*(dx-cx);
    if(Math.abs(det) < 0.0001) return false; // parallel
    let t = ((cx-ax)*(dz-cz) - (cz-az)*(dx-cx)) / det;
    let u = ((cx-ax)*(bz-az) - (cz-az)*(bx-ax)) / det;
    return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

// Check if adding newPt at a specific index would cause self-intersection
function wouldCauseCrossing(pts, newPt, insertIdx) {
    if(pts.length < 2) return false;
    let testPts = pts.slice();
    testPts.splice(insertIdx, 0, newPt);
    // Check all pairs of non-adjacent segments
    let n = testPts.length;
    for(let i = 0; i < n; i++) {
        let a = testPts[i], b = testPts[(i+1) % n];
        for(let j = i+2; j < n; j++) {
            if(i === 0 && j === n-1) continue; // adjacent (closing segment)
            let cc = testPts[j], d = testPts[(j+1) % n];
            if(segmentsIntersect(a.x, a.z, b.x, b.z, cc.x, cc.z, d.x, d.z)) {
                return true;
            }
        }
    }
    return false;
}

// Find the nearest edge index to insert a point (returns index to splice at)
function findNearestEdge(pts, pt) {
    let bestDist = Infinity;
    let bestIdx = pts.length; // default: append
    for(let i = 0; i < pts.length; i++) {
        let a = pts[i];
        let b = pts[(i+1) % pts.length];
        // Project pt onto segment a→b
        let dx = b.x - a.x, dz = b.z - a.z;
        let len2 = dx*dx + dz*dz;
        if(len2 < 0.001) continue;
        let t = Math.max(0, Math.min(1, ((pt.x-a.x)*dx + (pt.z-a.z)*dz) / len2));
        let projX = a.x + t*dx, projZ = a.z + t*dz;
        let dist = Math.sqrt((pt.x-projX)**2 + (pt.z-projZ)**2);
        if(dist < bestDist) {
            bestDist = dist;
            bestIdx = i + 1; // insert AFTER point i
        }
    }
    return bestIdx;
}

// Smart point placement: append point, shape auto-closes dynamically at >= 3 points
function smartAddPoint(pt) {
    smartGreenPoints.push(pt);
    return true;
}
window.smartAddPoint = smartAddPoint;

function resortTeesForAimPoint(hole) {
    if (!hole.aimPoint) return;
    let ap = hole.aimPoint;
    let orderedKeys = ['red','yellow','white','black'];
    let existingTees = [];
    for(let k of orderedKeys) {
        if(hole.tees[k] && hole.teeMeshes[k]) existingTees.push(k);
    }
    if(existingTees.length >= 2) {
        let positions = existingTees.map(k => ({x: hole.tees[k].x, y: hole.tees[k].y, z: hole.tees[k].z}));
        positions.sort(function(a, b) {
            let da = (a.x-ap.x)*(a.x-ap.x) + (a.z-ap.z)*(a.z-ap.z);
            let db = (b.x-ap.x)*(b.x-ap.x) + (b.z-ap.z)*(b.z-ap.z);
            return da - db;
        });
        for(let i = 0; i < existingTees.length; i++) {
            let k = existingTees[i];
            let pos = positions[i];
            let rot = Math.atan2(ap.x - pos.x, ap.z - pos.z);
            hole.tees[k].x = pos.x; hole.tees[k].y = pos.y; hole.tees[k].z = pos.z;
            hole.tees[k].rot = rot;
            hole.teeMeshes[k].position.set(pos.x, pos.y, pos.z);
            hole.teeMeshes[k].rotation.y = rot;
        }
        let colorEmoji = { red: '🔴', yellow: '🟡', white: '⚪', black: '⬛' };
        let distText = existingTees.map(function(k) {
            let dx = hole.tees[k].x - ap.x;
            let dz = hole.tees[k].z - ap.z;
            return colorEmoji[k] + ' ' + Math.round(Math.sqrt(dx*dx + dz*dz)) + 'm';
        }).join('  ');
        window.showBuildToast('🔄 Tees sorted: ' + distText, '#a855f7');
    } else if(existingTees.length === 1) {
        let k = existingTees[0];
        let rot = Math.atan2(ap.x - hole.tees[k].x, ap.z - hole.tees[k].z);
        hole.tees[k].rot = rot;
        hole.teeMeshes[k].rotation.y = rot;
    }
}

// Auto-sort tees: reassign colors so Red=closest to flag, Black=furthest
function autoSortTees(hole) {
    if (!hole.flag) return;
    
    let colorOrder = ['red', 'yellow', 'white', 'black'];
    let colorHex = { red: 0xef4444, yellow: 0xfacc15, white: 0xffffff, black: 0x111111 };
    let colorEmoji = { red: '🔴', yellow: '🟡', white: '⚪', black: '⬛' };
    
    // Collect all placed tees (not range) with their positions + distances
    let placedTees = [];
    colorOrder.forEach(c => {
        if (hole.tees[c]) {
            let dx = hole.tees[c].x - hole.flag.x;
            let dz = hole.tees[c].z - hole.flag.z;
            let dist = Math.sqrt(dx*dx + dz*dz);
            placedTees.push({ 
                pos: { ...hole.tees[c] },  // Clone position
                dist: dist
            });
        }
    });
    
    if (placedTees.length < 2) return; // Nothing to sort with 0-1 tees
    
    // Sort by distance: closest first
    placedTees.sort((a, b) => a.dist - b.dist);
    
    // Check if already in correct order
    let alreadyCorrect = true;
    let existingColors = colorOrder.filter(c => hole.tees[c]);
    for (let i = 0; i < placedTees.length; i++) {
        let expectedColor = existingColors[i];
        if (!hole.tees[expectedColor]) continue;
        let dx = hole.tees[expectedColor].x - placedTees[i].pos.x;
        let dz = hole.tees[expectedColor].z - placedTees[i].pos.z;
        if (Math.sqrt(dx*dx + dz*dz) > 0.1) { alreadyCorrect = false; break; }
    }
    
    if (alreadyCorrect) {
        // Show distances anyway
        let distText = placedTees.map((t, i) => colorEmoji[existingColors[i]] + ' ' + Math.round(t.dist) + 'm').join('  ');
        window.showBuildToast('✅ Tees OK: ' + distText, '#22c55e');
        return;
    }
    
    // Reassign: closest position → first available color, etc.
    let assignedColors = colorOrder.filter(c => hole.tees[c]); // Only colors that were placed
    
    // Remove all existing tee meshes
    assignedColors.forEach(c => {
        if (hole.teeMeshes[c]) window._arcadeScene.remove(hole.teeMeshes[c]);
        hole.tees[c] = null;
        hole.teeMeshes[c] = null;
    });
    
    // Reassign positions to colors in order (closest = first color in order)
    for (let i = 0; i < placedTees.length; i++) {
        let color = assignedColors[i];
        hole.tees[color] = placedTees[i].pos;
        hole.teeMeshes[color] = window.createTeeObject(
            placedTees[i].pos.x, placedTees[i].pos.y, placedTees[i].pos.z, 
            colorHex[color]
        );
        // Restore rotation if it was saved
        if (placedTees[i].pos.rot) {
            hole.teeMeshes[color].rotation.y = placedTees[i].pos.rot;
        }
    }
    
    // Show result
    let distText = placedTees.map((t, i) => colorEmoji[assignedColors[i]] + ' ' + Math.round(t.dist) + 'm').join('  ');
    window.showBuildToast('🔄 Tees auto-sorted! ' + distText, '#a855f7');
}

// === SMART GREEN SPLINE PREVIEW (separate from regular SPLINE) ===
function updateSmartGreenPreview() {
    smartGreenSpheres.forEach(s => window._arcadeScene.remove(s));
    smartGreenSpheres = [];
    window.smartGreenSpheres = smartGreenSpheres;
    window.smartGreenPoints = smartGreenPoints;

    if(smartGreenLineMesh) { window._arcadeScene.remove(smartGreenLineMesh); smartGreenLineMesh = null; }

    let isGreen = (window._smartBuilderType === 'GREEN');
    if (isGreen && window.GreenStudio && !window.GreenStudio.group && window._arcadeScene) {
        window.GreenStudio.init(window._arcadeScene);
    }

    let sMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false });
    let sMatFirst = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false }); // Blue = start point
    let sGeo = new THREE.SphereGeometry(0.4, 8, 8);
    let sGeoFirst = new THREE.SphereGeometry(0.6, 8, 8);

    let ballGeo = (isGreen && window.GreenStudio && window.GreenStudio.geometries && window.GreenStudio.geometries.ball)
        ? window.GreenStudio.geometries.ball
        : new THREE.SphereGeometry(0.85, 24, 24);
    let ballMat = (isGreen && window.GreenStudio && window.GreenStudio.materials && window.GreenStudio.materials.ball)
        ? window.GreenStudio.materials.ball
        : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.05, depthTest: false });

    smartGreenPoints.forEach((pt, idx) => {
        let s;
        if (isGreen) {
            s = new THREE.Mesh(ballGeo, ballMat);
            let y = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(pt.x, pt.z) : pt.y;
            s.position.set(pt.x, y + 0.85, pt.z);
            s.renderOrder = 999;
            s.userData = { isSmartGreenBall: true, pointIndex: idx };

            if (idx === 0) {
                let ringGeo = new THREE.RingGeometry(1.0, 1.45, 32);
                ringGeo.rotateX(-Math.PI / 2);
                let ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.85 });
                let ring = new THREE.Mesh(ringGeo, ringMat);
                ring.position.set(0, -0.78, 0);
                ring.renderOrder = 998;
                s.add(ring);
            }
        } else {
            s = new THREE.Mesh(idx === 0 ? sGeoFirst : sGeo, idx === 0 ? sMatFirst : sMat);
            s.position.copy(pt);
            s.position.y += 1.5;
            s.renderOrder = 999;
            s.userData = { isSmartGreenBall: true, pointIndex: idx };
        }
        window._arcadeScene.add(s);
        smartGreenSpheres.push(s);
    });

    if(smartGreenPoints.length > 1) {
        let shouldClose = (smartGreenPoints.length >= 3);
        let v3Pts;
        if (isGreen) {
            v3Pts = smartGreenPoints.map(p => {
                let y = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(p.x, p.z) : p.y;
                return new THREE.Vector3(p.x, y + 0.18, p.z);
            });
        } else {
            v3Pts = smartGreenPoints.map(p => {
                let v = p.clone();
                v.y += 1.5;
                return v;
            });
        }
        let curve = new THREE.CatmullRomCurve3(v3Pts, shouldClose, 'catmullrom', 0.5);
        let curvePts = curve.getPoints(Math.max(60, 30 * smartGreenPoints.length));
        let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
        let lineColor = shouldClose ? (isGreen ? 0x4ade80 : 0xfbbf24) : (isGreen ? 0x38bdf8 : 0x4ade80);
        let lineMat = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 3, depthTest: false });
        smartGreenLineMesh = new THREE.Line(lineGeo, lineMat);
        smartGreenLineMesh.renderOrder = 997;
        window._arcadeScene.add(smartGreenLineMesh);
    }

    let pnl = document.getElementById('smart-green-action-panel');
    let buildBtn = document.getElementById('sb-build-btn');
    let isSB = (window.currentTool === 'SMART_BUILDER' || (typeof currentTool !== 'undefined' && currentTool === 'SMART_BUILDER'));
    if(pnl) {
        if(isSB) pnl.style.display = 'flex';
        else pnl.style.display = 'none';
    }
    // Ensure build button is always clickable (build functions check point count internally)
    if(buildBtn) {
        buildBtn.disabled = false;
        buildBtn.style.opacity = '1';
        buildBtn.style.cursor = 'pointer';
    }
    if (window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
        window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
    }

    updateSmartGreenHUD();
}

// === LIVE MEASUREMENTS & HUD UPDATE ===
function updateSmartGreenHUD() {
    let measEl = document.getElementById('sb-measure-hud');
    let buildBtn = document.getElementById('sb-build-btn');
    if(!measEl) return;

    if(smartGreenPoints.length >= 2) {
        let pts = smartGreenPoints;
        // Bounding box (width × length)
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for(let p of pts) {
            if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
            if(p.z < minZ) minZ = p.z; if(p.z > maxZ) maxZ = p.z;
        }
        let w = maxX - minX;
        let h = maxZ - minZ;
        // Perimeter (sum of segment lengths along spline)
        let perim = 0;
        for(let i = 0; i < pts.length; i++) {
            let next = (i + 1) % pts.length;
            let dx = pts[next].x - pts[i].x;
            let dz = pts[next].z - pts[i].z;
            perim += Math.sqrt(dx*dx + dz*dz);
        }
        // Area (Shoelace formula)
        let area = 0;
        for(let i = 0; i < pts.length; i++) {
            let next = (i + 1) % pts.length;
            area += pts[i].x * pts[next].z;
            area -= pts[next].x * pts[i].z;
        }
        area = Math.abs(area) / 2;
        // Last segment length
        let lastSeg = 0;
        if(pts.length >= 2) {
            let a = pts[pts.length-2], b = pts[pts.length-1];
            lastSeg = Math.sqrt((b.x-a.x)*(b.x-a.x) + (b.z-a.z)*(b.z-a.z));
        }
        measEl.style.display = 'block';
        measEl.innerHTML = '<span style="color:#fbbf24">📐 ' + Math.round(w) + 'm × ' + Math.round(h) + 'm</span>' +
            '<span style="color:#94a3b8; margin-left:6px">Area: ~' + Math.round(area) + 'm²</span>' +
            '<br><span style="color:#64748b; font-size:9px">Perimeter: ' + Math.round(perim) + 'm · Last: ' + lastSeg.toFixed(1) + 'm · Points: ' + pts.length + '</span>';

        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        let gsBuildBtn = document.getElementById('gs-build-green-btn');
        if (gsBuildBtn && window._smartBuilderType === 'GREEN') {
            let areaText = (pts.length >= 3 && area > 0) ? (' (~' + Math.round(area) + ' m²)') : '';
            gsBuildBtn.innerHTML = '⛳ ' + (isSv ? 'Skapa green' : 'Create Green') + areaText;
            if (pts.length >= 3) {
                gsBuildBtn.style.opacity = '1';
                gsBuildBtn.style.cursor = 'pointer';
                gsBuildBtn.classList.add('pulse-green-btn');
            } else {
                gsBuildBtn.style.opacity = '0.5';
                gsBuildBtn.style.cursor = 'not-allowed';
                gsBuildBtn.classList.remove('pulse-green-btn');
            }
        }
        if (buildBtn && window._smartBuilderType === 'GREEN') {
            buildBtn.textContent = (isSv ? '⛳ Bygg Green (~' : '⛳ Build Green (~') + Math.round(area) + ' m²)';
            buildBtn.classList.add('pulse-green-btn');
        } else if (buildBtn && window._smartBuilderType === 'FAIRWAY') {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let fwCount = (hole && hole.fairways) ? hole.fairways.length : (hole && hole.fairwayData ? 1 : 0);
            let nextNum = fwCount + 1;
            let fwLabel = (nextNum > 1) ? (' ' + nextNum) : '';
            buildBtn.textContent = (isSv ? ('🏌️ Bygg Fairway' + fwLabel + ' (~') : ('🏌️ Build Fairway' + fwLabel + ' (~')) + Math.round(area) + ' m²)';
            buildBtn.classList.add('pulse-green-btn');
        } else if (buildBtn && window._smartBuilderType === 'BUNKER') {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let bkCount = (hole && hole.bunkers) ? hole.bunkers.length : (hole && hole.bunkerData ? 1 : 0);
            let nextNum = bkCount + 1;
            let bkLabel = (nextNum > 1) ? (' ' + nextNum) : '';
            buildBtn.textContent = (isSv ? ('🏖️ Bygg Bunker' + bkLabel + ' (~') : ('🏖️ Build Bunker' + bkLabel + ' (~')) + Math.round(area) + ' m²)';
            buildBtn.classList.add('pulse-green-btn');
        }
        let dg = document.getElementById('sg-drawing-guide');
        if (dg && window._smartBuilderType === 'GREEN') dg.style.display = 'none';
        let fdg = document.getElementById('sf-drawing-guide');
        if (fdg && window._smartBuilderType === 'FAIRWAY') fdg.style.display = 'none';
        let bkd = document.getElementById('sbk-drawing-guide');
        if (bkd && window._smartBuilderType === 'BUNKER') bkd.style.display = 'none';
    } else {
        measEl.style.display = 'none';
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        let gsBuildBtn = document.getElementById('gs-build-green-btn');
        if (gsBuildBtn && window._smartBuilderType === 'GREEN') {
            gsBuildBtn.innerHTML = '⛳ ' + (isSv ? 'Skapa green' : 'Create Green');
            gsBuildBtn.classList.remove('pulse-green-btn');
            gsBuildBtn.style.opacity = '0.5';
            gsBuildBtn.style.cursor = 'not-allowed';
        }
        if (buildBtn && window._smartBuilderType === 'GREEN') {
            buildBtn.textContent = isSv ? '⛳ Bygg Green' : '⛳ Build Green';
            buildBtn.classList.remove('pulse-green-btn');
        } else if (buildBtn && window._smartBuilderType === 'FAIRWAY') {
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let fwCount = (hole && hole.fairways) ? hole.fairways.length : (hole && hole.fairwayData ? 1 : 0);
            let nextNum = fwCount + 1;
            let fwLabel = (nextNum > 1) ? (' ' + nextNum) : '';
            buildBtn.textContent = isSv ? ('🏌️ Bygg Fairway' + fwLabel) : ('🏌️ Build Fairway' + fwLabel);
            buildBtn.classList.remove('pulse-green-btn');
        } else if (buildBtn && window._smartBuilderType === 'BUNKER') {
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let bkCount = (hole && hole.bunkers) ? hole.bunkers.length : (hole && hole.bunkerData ? 1 : 0);
            let nextNum = bkCount + 1;
            let bkLabel = (nextNum > 1) ? (' ' + nextNum) : '';
            buildBtn.textContent = isSv ? ('🏖️ Bygg Bunker' + bkLabel) : ('🏖️ Build Bunker' + bkLabel);
            buildBtn.classList.remove('pulse-green-btn');
        }
        let dg = document.getElementById('sg-drawing-guide');
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (dg && window._smartBuilderType === 'GREEN' && (!hole || !hole.greenData)) dg.style.display = 'block';
        let fdg = document.getElementById('sf-drawing-guide');
        let hasActiveFw = hole && (hole.activeFairwayIndex !== null && hole.activeFairwayIndex !== undefined) && (hole.fairways && hole.fairways[hole.activeFairwayIndex]);
        if (fdg && window._smartBuilderType === 'FAIRWAY' && !hasActiveFw) fdg.style.display = 'block';
        let bkd = document.getElementById('sbk-drawing-guide');
        let hasActiveBk = hole && (hole.activeBunkerIndex !== null && hole.activeBunkerIndex !== undefined) && (hole.bunkers && hole.bunkers[hole.activeBunkerIndex]);
        if (bkd && window._smartBuilderType === 'BUNKER' && !hasActiveBk) bkd.style.display = 'block';
    }
}
window.updateSmartGreenHUD = updateSmartGreenHUD;

// Fast 60 FPS spline deformation during dragging
window.updateSmartGreenSplineOnly = function() {
    if(!smartGreenLineMesh || smartGreenPoints.length < 2) return;
    let isGreen = (window._smartBuilderType === 'GREEN');
    let shouldClose = (smartGreenPoints.length >= 3);
    let v3Pts;
    if (isGreen) {
        v3Pts = smartGreenPoints.map(p => {
            let y = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(p.x, p.z) : p.y;
            return new THREE.Vector3(p.x, y + 0.18, p.z);
        });
    } else {
        v3Pts = smartGreenPoints.map(p => {
            let v = p.clone();
            v.y += 1.5;
            return v;
        });
    }
    let curve = new THREE.CatmullRomCurve3(v3Pts, shouldClose, 'catmullrom', 0.5);
    let curvePts = curve.getPoints(Math.max(60, 30 * smartGreenPoints.length));
    smartGreenLineMesh.geometry.setFromPoints(curvePts);
    smartGreenLineMesh.geometry.attributes.position.needsUpdate = true;
    updateSmartGreenHUD();
};

window.clearSmartGreen = function() {
    smartGreenPoints = [];
    window._smartShapeClosed = false; // Reset magnet-snap state
    let measEl = document.getElementById('sb-measure-hud');
    if(measEl) measEl.style.display = 'none';
    updateSmartGreenPreview();
    if (window._smartBuilderType === 'GREEN' && typeof window.updateSBGreenControls === 'function') {
        window.updateSBGreenControls();
    } else if (window._smartBuilderType === 'FAIRWAY' && typeof window.updateSBFairwayControls === 'function') {
        window.updateSBFairwayControls();
    } else if (window._smartBuilderType === 'BUNKER' && typeof window.updateSBBunkerControls === 'function') {
        window.updateSBBunkerControls();
    }
};

window.undoSmartGreenPoint = function() {
    if (smartGreenPoints.length > 0) {
        smartGreenPoints.pop();
        window._smartShapeClosed = false;
        updateSmartGreenPreview();
        if (window._smartBuilderType === 'GREEN' && typeof window.updateSBGreenControls === 'function') {
            window.updateSBGreenControls();
        } else if (window._smartBuilderType === 'FAIRWAY' && typeof window.updateSBFairwayControls === 'function') {
            window.updateSBFairwayControls();
        } else if (window._smartBuilderType === 'BUNKER' && typeof window.updateSBBunkerControls === 'function') {
            window.updateSBBunkerControls();
        }
    }
};

// === SHARED: Uniform polygon offset using edge normals ===
// Produces a polygon expanded by 'dist' meters with uniform border width
function offsetPolygon(densePts, dist) {
    let n = densePts.length;
    let result = [];
    for(let i = 0; i < n; i++) {
        // Adjacent edges
        let prev = (i - 1 + n) % n;
        let next = (i + 1) % n;
        // Edge vectors
        let e1x = densePts[i].x - densePts[prev].x;
        let e1z = densePts[i].z - densePts[prev].z;
        let e2x = densePts[next].x - densePts[i].x;
        let e2z = densePts[next].z - densePts[i].z;
        // Outward normals (perpendicular, pointing outward for CW winding)
        let len1 = Math.sqrt(e1x*e1x + e1z*e1z) + 0.0001;
        let n1x = -e1z / len1, n1z = e1x / len1;
        let len2 = Math.sqrt(e2x*e2x + e2z*e2z) + 0.0001;
        let n2x = -e2z / len2, n2z = e2x / len2;
        // Average normal at vertex
        let nx = n1x + n2x, nz = n1z + n2z;
        let nLen = Math.sqrt(nx*nx + nz*nz) + 0.0001;
        nx /= nLen; nz /= nLen;
        // Miter length to maintain uniform width at corners
        let dot = nx * n1x + nz * n1z;
        let miter = dot > 0.25 ? dist / dot : dist * 1.2; // Tight clamp at sharp corners
        result.push({ x: densePts[i].x + nx * miter, z: densePts[i].z + nz * miter });
    }
    // Check winding: if the offset went INWARD instead of outward, flip
    // Simple test: compare area of original vs offset
    let areaOrig = 0, areaOff = 0;
    for(let i = 0; i < n; i++) {
        let j = (i + 1) % n;
        areaOrig += densePts[i].x * densePts[j].z - densePts[j].x * densePts[i].z;
        areaOff += result[i].x * result[j].z - result[j].x * result[i].z;
    }
    if(Math.abs(areaOff) < Math.abs(areaOrig)) {
        // Offset went inward — flip direction
        result = [];
        for(let i = 0; i < n; i++) {
            let prev = (i - 1 + n) % n;
            let next = (i + 1) % n;
            let e1x = densePts[i].x - densePts[prev].x;
            let e1z = densePts[i].z - densePts[prev].z;
            let e2x = densePts[next].x - densePts[i].x;
            let e2z = densePts[next].z - densePts[i].z;
            let len1 = Math.sqrt(e1x*e1x + e1z*e1z) + 0.0001;
            let n1x = e1z / len1, n1z = -e1x / len1;
            let len2 = Math.sqrt(e2x*e2x + e2z*e2z) + 0.0001;
            let n2x = e2z / len2, n2z = -e2x / len2;
            let nx = n1x + n2x, nz = n1z + n2z;
            let nLen = Math.sqrt(nx*nx + nz*nz) + 0.0001;
            nx /= nLen; nz /= nLen;
            let dot = nx * n1x + nz * n1z;
            let miter = dot > 0.25 ? dist / dot : dist * 1.2;
            result.push({ x: densePts[i].x + nx * miter, z: densePts[i].z + nz * miter });
        }
    }
    return result;
}

// Inset polygon inward by dist meters (shrinks shape inward towards centroid)
function insetPolygon(densePts, dist) {
    if (!densePts || densePts.length < 3 || dist <= 0) return densePts;
    let n = densePts.length;
    let result = [];
    
    // Centroid for safety bounds
    let cx = 0, cz = 0;
    for (let p of densePts) { cx += p.x; cz += p.z; }
    cx /= n; cz /= n;

    for (let i = 0; i < n; i++) {
        let prev = (i - 1 + n) % n;
        let next = (i + 1) % n;
        let e1x = densePts[i].x - densePts[prev].x;
        let e1z = densePts[i].z - densePts[prev].z;
        let e2x = densePts[next].x - densePts[i].x;
        let e2z = densePts[next].z - densePts[i].z;
        let len1 = Math.hypot(e1x, e1z) || 1e-4;
        let n1x = -e1z / len1, n1z = e1x / len1;
        let len2 = Math.hypot(e2x, e2z) || 1e-4;
        let n2x = -e2z / len2, n2z = e2x / len2;
        let nx = n1x + n2x, nz = n1z + n2z;
        let nLen = Math.hypot(nx, nz) || 1e-4;
        nx /= nLen; nz /= nLen;
        let dot = nx * n1x + nz * n1z;
        let miter = dot > 0.25 ? (dist / dot) : (dist * 1.2);
        miter = Math.min(miter, dist * 1.5);
        result.push({ x: densePts[i].x + nx * miter, z: densePts[i].z + nz * miter });
    }

    // Check area: we want inset to be SMALLER than original
    let areaOrig = 0, areaOff = 0;
    for (let i = 0; i < n; i++) {
        let j = (i + 1) % n;
        areaOrig += densePts[i].x * densePts[j].z - densePts[j].x * densePts[i].z;
        areaOff += result[i].x * result[j].z - result[j].x * result[i].z;
    }

    // If offset went outward (larger area), flip direction so it goes inward
    let flip = Math.abs(areaOff) > Math.abs(areaOrig);
    let finalPts = [];
    for (let i = 0; i < n; i++) {
        let pt = densePts[i];
        let prev = (i - 1 + n) % n;
        let next = (i + 1) % n;
        let e1x = pt.x - densePts[prev].x;
        let e1z = pt.z - densePts[prev].z;
        let e2x = densePts[next].x - pt.x;
        let e2z = densePts[next].z - pt.z;
        let len1 = Math.hypot(e1x, e1z) || 1e-4;
        let n1x = -e1z / len1, n1z = e1x / len1;
        let len2 = Math.hypot(e2x, e2z) || 1e-4;
        let n2x = -e2z / len2, n2z = e2x / len2;
        let nx = n1x + n2x, nz = n1z + n2z;
        let nLen = Math.hypot(nx, nz) || 1e-4;
        nx /= nLen; nz /= nLen;
        let dot = nx * n1x + nz * n1z;
        let miter = dot > 0.25 ? (dist / dot) : (dist * 1.2);
        miter = Math.min(miter, dist * 1.5);

        let sign = flip ? -1 : 1;
        let dirX = nx * sign;
        let dirZ = nz * sign;

        // Safety clamp: don't let vertex cross over 70% toward centroid
        let dToCent = Math.hypot(pt.x - cx, pt.z - cz);
        let maxStep = Math.max(0.2, dToCent * 0.70);
        let actualStep = Math.min(miter, maxStep);

        finalPts.push({ x: pt.x + dirX * actualStep, z: pt.z + dirZ * actualStep });
    }
    return finalPts;
}
window.insetPolygon = insetPolygon;

// === SMART BUNKER LIVE STUDIO: Multi-Bunker Instances + Parametric Sand + Dig Down + Lip ===

// Helper: Ensure hole has bunkers array with backward compatibility
function ensureHoleBunkers(hole) {
    if (!hole) return [];
    if (!hole.bunkers) {
        hole.bunkers = [];
        if (hole.bunkerData && hole.bunkerData.points && hole.bunkerData.points.length >= 3) {
            hole.bunkers.push(hole.bunkerData);
        }
    }
    if (hole.bunkers.length === 0 && hole.bunkerData && hole.bunkerData.points && hole.bunkerData.points.length >= 3) {
        hole.bunkers.push(hole.bunkerData);
    }
    if (hole.bunkers.length > 0) {
        hole.bunkerData = hole.bunkers[0];
        // DO NOT overwrite null! null means "drawing mode for new bunker"
        if (hole.activeBunkerIndex === undefined) {
            hole.activeBunkerIndex = 0;
        } else if (hole.activeBunkerIndex !== null && hole.activeBunkerIndex >= hole.bunkers.length) {
            hole.activeBunkerIndex = hole.bunkers.length - 1;
        }
    } else {
        hole.bunkerData = null;
        hole.activeBunkerIndex = null;
    }
    return hole.bunkers;
}
window.ensureHoleBunkers = ensureHoleBunkers;

function getActiveBunker(hole) {
    if (!hole) return null;
    ensureHoleBunkers(hole);
    if (hole.activeBunkerIndex === null || hole.activeBunkerIndex === undefined) {
        return null;
    }
    return hole.bunkers[hole.activeBunkerIndex] || null;
}
window.getActiveBunker = getActiveBunker;

// Helper: Generate dense smooth curve points from control points for Bunker
function getDenseBunkerPoints(points) {
    if (typeof getDenseGreenPoints === 'function') {
        return getDenseGreenPoints(points);
    }
    let pts3 = points.map(p => new THREE.Vector3(p.x, p.y || 0, p.z));
    let curve = new THREE.CatmullRomCurve3(pts3, true);
    let numSamples = Math.max(200, points.length * 40);
    return curve.getPoints(numSamples);
}
window.getDenseBunkerPoints = getDenseBunkerPoints;

// 3D Outline Mesh for Selected Bunker (Amber/Gold 0xfbbf24)
let activeBunkerOutlineMesh = null;
function updateActiveBunkerOutline() {
    let hadMesh = !!activeBunkerOutlineMesh;
    if (activeBunkerOutlineMesh && window._arcadeScene) {
        window._arcadeScene.remove(activeBunkerOutlineMesh);
        if (activeBunkerOutlineMesh.geometry) activeBunkerOutlineMesh.geometry.dispose();
        if (activeBunkerOutlineMesh.material) activeBunkerOutlineMesh.material.dispose();
        activeBunkerOutlineMesh = null;
    }
    if ((window.appMode && window.appMode !== 'BUILD') || 
        (window.currentTool && window.currentTool !== 'SMART_BUILDER') || 
        window._smartBuilderType !== 'BUNKER' || 
        window._showBunkerOutline === false) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole || hole.activeBunkerIndex === null || hole.activeBunkerIndex === undefined) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }
    if (!hole.bunkers || !hole.bunkers[hole.activeBunkerIndex]) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }

    let bd = hole.bunkers[hole.activeBunkerIndex];
    if (!bd.points || bd.points.length < 3) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }

    let densePts = getDenseBunkerPoints(bd.points);
    let linePts = densePts.map(p => {
        let y = (typeof window.getTerrainHeight === 'function') 
            ? window.getTerrainHeight(p.x, p.z) 
            : (p.y || 0);
        return new THREE.Vector3(p.x, y + 0.25, p.z);
    });
    if (linePts.length > 0) {
        linePts.push(linePts[0].clone());
    }

    let geo = new THREE.BufferGeometry().setFromPoints(linePts);
    let mat = new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 3, depthTest: false });
    activeBunkerOutlineMesh = new THREE.Line(geo, mat);
    activeBunkerOutlineMesh.renderOrder = 998;
    if (window._arcadeScene) window._arcadeScene.add(activeBunkerOutlineMesh);
    if (window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
        window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
    }
}
window.updateActiveBunkerOutline = updateActiveBunkerOutline;

window.toggleBunkerOutline = function() {
    if (window._showBunkerOutline === undefined) window._showBunkerOutline = true;
    window._showBunkerOutline = !window._showBunkerOutline;
    updateActiveBunkerOutline();
    if (typeof window.updateSBBunkerControls === 'function') {
        window.updateSBBunkerControls();
    }
};

// Center Camera on Selected Bunker
window.centerCameraOnBunker = function(holeIndex, bunkerIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (bunkerIndex === undefined) bunkerIndex = hole.activeBunkerIndex;
    let bd = (hole.bunkers && bunkerIndex !== null && bunkerIndex !== undefined) ? hole.bunkers[bunkerIndex] : null;
    if (!bd || !bd.points || bd.points.length === 0) return;

    let cx = 0, cz = 0;
    for (let p of bd.points) { cx += p.x; cz += p.z; }
    cx /= bd.points.length;
    cz /= bd.points.length;
    let cy = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(cx, cz) : 0;

    if (window._arcadeCamera && window.controls) {
        window.controls.target.set(cx, cy, cz);
        window._arcadeCamera.position.set(cx, cy + 40, cz + 45);
        window.controls.update();
        if (window._arcadeRenderer && window._arcadeScene) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
    }
    updateActiveBunkerOutline();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let bkNum = (bunkerIndex !== null && bunkerIndex !== undefined) ? (bunkerIndex + 1) : '';
    window.showBuildToast(isSv ? `🔍 Centrerad på Bunker ${bkNum}` : `🔍 Centered on Bunker ${bkNum}`, '#fbbf24');
};

window.selectActiveBunker = function(holeIndex, bunkerIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (bunkerIndex >= 0 && bunkerIndex < hole.bunkers.length) {
        hole.activeBunkerIndex = bunkerIndex;
        if (typeof window.clearSmartGreen === 'function') window.clearSmartGreen();
    }
    updateActiveBunkerOutline();
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();
};

window.startNewBunkerDrawing = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (hole) {
        ensureHoleBunkers(hole);
        hole.activeBunkerIndex = null;
    }
    if (typeof window.clearSmartGreen === 'function') window.clearSmartGreen();
    updateActiveBunkerOutline();
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let bkCount = (hole && hole.bunkers) ? hole.bunkers.length : 0;
    let nextNum = bkCount + 1;
    window.showBuildToast(isSv ? `✏️ Klicka på marken för att rita Bunker ${nextNum} (minst 3 punkter)` : `✏️ Click on ground to shape Bunker ${nextNum} (min 3 points)`, '#fbbf24');
};

// 1. Capture baseline snapshot of natural terrain & canvas before bunker is built
window.captureBunkerSnapshot = function(hole, points, margin) {
    margin = Math.max(15, margin || 15);
    let densePts = getDenseBunkerPoints(points);
    let pathMinX = Infinity, pathMaxX = -Infinity, pathMinZ = Infinity, pathMaxZ = -Infinity;
    for(let pt of densePts) {
        if(pt.x < pathMinX) pathMinX = pt.x;
        if(pt.x > pathMaxX) pathMaxX = pt.x;
        if(pt.z < pathMinZ) pathMinZ = pt.z;
        if(pt.z > pathMaxZ) pathMaxZ = pt.z;
    }

    let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;
    let gxStart = Math.max(0, Math.floor((pathMinX - margin + window.TERRAIN_SIZE/2) / step));
    let gxEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxX + margin + window.TERRAIN_SIZE/2) / step));
    let gzStart = Math.max(0, Math.floor((pathMinZ - margin + window.TERRAIN_SIZE/2) / step));
    let gzEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxZ + margin + window.TERRAIN_SIZE/2) / step));
    let gWidth = gxEnd - gxStart + 1;
    let gHeight = gzEnd - gzStart + 1;

    let texMargin = margin + 4;
    let pxMinX = Math.max(0, Math.floor(((pathMinX - texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxX = Math.min(4096, Math.ceil(((pathMaxX + texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMinY = Math.max(0, Math.floor(((pathMinZ - texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxY = Math.min(4096, Math.ceil(((pathMaxZ + texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pw = Math.max(1, pxMaxX - pxMinX);
    let ph = Math.max(1, pxMaxY - pxMinY);

    let positions = window._arcadePlaneGeo.attributes.position.array;
    let origHeights = new Float32Array(gWidth * gHeight);
    for(let gz = gzStart; gz <= gzEnd; gz++) {
        for(let gx = gxStart; gx <= gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS+1) + gx;
            let oi = (gz - gzStart) * gWidth + (gx - gxStart);
            origHeights[oi] = positions[idx*3+2];
        }
    }

    let origCanvasPixels = null;
    if (window._arcadePCtx) {
        origCanvasPixels = window._arcadePCtx.getImageData(pxMinX, pxMinY, pw, ph);
    }

    let baseH = 0;
    for(let pt of points) {
        let h = (typeof window.getTerrainHeight === 'function')
            ? window.getTerrainHeight(pt.x, pt.z)
            : (window.localGetTerrainAt ? (window.localGetTerrainAt(pt.x, -pt.z) || {}).z || 0 : 0);
        baseH += h;
    }
    baseH /= Math.max(1, points.length);

    return {
        baseElevation: baseH,
        bbox: {
            gxStart, gxEnd, gzStart, gzEnd,
            gWidth, gHeight,
            pxMinX, pxMaxX, pxMinY, pxMaxY,
            pw, ph, margin
        },
        origHeights: origHeights,
        origCanvasPixels: origCanvasPixels
    };
};

function sbHexToRgb(h) {
    if (!h) return [74, 120, 43];
    let hex = h.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    let num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getBaseGroundColor(hole) {
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let curHole = hole || (window.courseHoles && window.courseHoles[window.currentHoleIndex]);
    let surr = (curHole && curHole.surroundConfig) || window.surroundConfig || {};
    let surrKey = surr.N || surr.E || surr.S || surr.W || 'roughColor';
    return cfg[surrKey] || cfg.roughColor || '#4a782b';
}

// 1.5. Cleanly erase a bunker's footprint from 2D canvas texture
window.eraseBunkerTexture = function(bd, hole) {
    if (!bd || !bd.points || !window._arcadePCtx) return;
    let densePts = (typeof getDenseBunkerPoints === 'function') ? getDenseBunkerPoints(bd.points) : bd.points;
    if (!densePts || densePts.length < 3) return;

    let baseGroundColor = getBaseGroundColor(hole);
    let ctx = window._arcadePCtx;
    ctx.save();
    ctx.filter = 'none';

    let expandedPts = (typeof offsetPolygon === 'function') ? offsetPolygon(densePts, 0.3) : densePts;
    ctx.beginPath();
    expandedPts.forEach((pt, i) => {
        let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY);
        else ctx.lineTo(pxX, pxY);
    });
    ctx.closePath();
    ctx.fillStyle = baseGroundColor;
    ctx.fill();

    ctx.restore();
};

// 2. Restore pristine baseline ground & texture before applying modified parameters
window.restoreBunkerBase = function(hole, restoreTexture, targetBunker) {
    if (restoreTexture === undefined) restoreTexture = false;
    if (!hole) return;
    ensureHoleBunkers(hole);
    let bds = targetBunker ? [targetBunker] : (hole.bunkers && hole.bunkers.length > 0 ? hole.bunkers : (hole.bunkerData ? [hole.bunkerData] : []));
    if (bds.length === 0) return;

    bds.forEach(bd => {
        if (!bd || !bd.bbox) return;
        let densePts = (bd.points && bd.points.length >= 3 && typeof getDenseBunkerPoints === 'function') ? getDenseBunkerPoints(bd.points) : null;
        let maxReach = 4.5; // Bunkers sculpt inside and smooth up to ~3.5m out

        if (bd.origHeights && window._arcadePlaneGeo) {
            let positions = window._arcadePlaneGeo.attributes.position.array;
            let gWidth = bd.bbox.gWidth;

            for(let gz = bd.bbox.gzStart; gz <= bd.bbox.gzEnd; gz++) {
                for(let gx = bd.bbox.gxStart; gx <= bd.bbox.gxEnd; gx++) {
                    let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+1];

                    let isInside = densePts ? pointInPolygon(vx, vz, densePts) : false;
                    let distEdge = isInside ? 0 : (densePts ? distToPolygon(vx, vz, densePts) : 0);
                    if (densePts && distEdge > maxReach) continue;

                    let oi = (gz - bd.bbox.gzStart) * gWidth + (gx - bd.bbox.gxStart);
                    if (oi >= 0 && oi < bd.origHeights.length) {
                        positions[idx*3+2] = bd.origHeights[oi];
                    }
                }
            }
        }

        if (restoreTexture) {
            if (bd.origCanvasPixels && densePts && window._arcadePCtx && bd.bbox.pw > 0 && bd.bbox.ph > 0) {
                let ctx = window._arcadePCtx;
                if (!window._bunkerSnapCanvas) window._bunkerSnapCanvas = document.createElement('canvas');
                window._bunkerSnapCanvas.width = bd.bbox.pw;
                window._bunkerSnapCanvas.height = bd.bbox.ph;
                let bCtx = window._bunkerSnapCanvas.getContext('2d');
                bCtx.putImageData(bd.origCanvasPixels, 0, 0);

                ctx.save();
                ctx.beginPath();
                densePts.forEach((pt, i) => {
                    let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                    let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                    if (i === 0) ctx.moveTo(pxX, pxY);
                    else ctx.lineTo(pxX, pxY);
                });
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(window._bunkerSnapCanvas, bd.bbox.pxMinX, bd.bbox.pxMinY);
                ctx.restore();
            } else if (typeof window.eraseBunkerTexture === 'function') {
                window.eraseBunkerTexture(bd, hole);
            }
        }
    });
};

// 3. Apply full bunker pipeline (Painting + Sculpting + Smoothing)
window.applyBunkerPipeline = function(hole, isInitial, updateTexture, targetBunker) {
    if (!hole) return;
    if (window._isApplyingBunkerPipeline) return;
    window._isApplyingBunkerPipeline = true;
    try {
        ensureHoleBunkers(hole);
        let bds = targetBunker ? [targetBunker] : (hole.bunkers && hole.bunkers.length > 0 ? hole.bunkers : (hole.bunkerData ? [hole.bunkerData] : []));
        if (bds.length === 0) return;
        if (updateTexture === undefined) updateTexture = true;

        // Reset ground vertex heights to pristine baseline for targeted bunker(s)
        window.restoreBunkerBase(hole, false, targetBunker);

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let sandColor = cfg.bunkerColor || '#e0d8a4';

    let waterGeo = window._arcadeWaterGeo;
    let wPosArray = waterGeo ? waterGeo.attributes.position.array : null;

    let positions = window._arcadePlaneGeo ? window._arcadePlaneGeo.attributes.position.array : null;
    let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;

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

    bds.forEach(bd => {
        if (!bd || !bd.points || bd.points.length < 3) return;
        let densePts = getDenseBunkerPoints(bd.points);

        // === PAINT PASS ===
        if (updateTexture && window._arcadePCtx) {
            window._arcadePCtx.save();

            let sharpness = bd.edgeSharpness !== undefined ? bd.edgeSharpness : 100;
            if (sharpness < 100) {
                let blurPx = Math.round((100 - sharpness) * 0.06);
                if (blurPx > 0) window._arcadePCtx.filter = 'blur(' + blurPx + 'px)';
            }

            window._arcadePCtx.beginPath();
            densePts.forEach((pt, i) => {
                let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                if (i === 0) window._arcadePCtx.moveTo(pxX, pxY);
                else window._arcadePCtx.lineTo(pxX, pxY);
            });
            window._arcadePCtx.closePath();
            window._arcadePCtx.fillStyle = sandColor;
            window._arcadePCtx.fill();

            window._arcadePCtx.filter = 'none';
            window._arcadePCtx.restore();
        }

        // === SCULPT PASS ===
        if (positions) {
            let depth = bd.depth !== undefined ? bd.depth : 0.8;
            let lipHeight = bd.lipHeight !== undefined ? bd.lipHeight : 0.3;
            let shape = bd.shape || 'BOWL';

            // Bounding box
            let pathMinX = Infinity, pathMaxX = -Infinity, pathMinZ = Infinity, pathMaxZ = -Infinity;
            for(let pt of densePts) {
                if(pt.x < pathMinX) pathMinX = pt.x;
                if(pt.x > pathMaxX) pathMaxX = pt.x;
                if(pt.z < pathMinZ) pathMinZ = pt.z;
                if(pt.z > pathMaxZ) pathMaxZ = pt.z;
            }

            let gxStart = Math.max(0, Math.floor((pathMinX - 1 + window.TERRAIN_SIZE/2) / step));
            let gxEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxX + 1 + window.TERRAIN_SIZE/2) / step));
            let gzStart = Math.max(0, Math.floor((pathMinZ - 1 + window.TERRAIN_SIZE/2) / step));
            let gzEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxZ + 1 + window.TERRAIN_SIZE/2) / step));

            // Face direction: first point = face (lip side)
            let facePt = bd.points[0];
            let cx = 0, cz = 0;
            for(let pt of bd.points) { cx += pt.x; cz += pt.z; }
            cx /= bd.points.length;
            cz /= bd.points.length;
            let faceDx = facePt.x - cx;
            let faceDz = facePt.z - cz;
            let faceLen = Math.sqrt(faceDx*faceDx + faceDz*faceDz) + 0.001;
            faceDx /= faceLen; faceDz /= faceLen;

            let maxDist = 0;
            for(let pt of densePts) {
                let d = Math.sqrt((pt.x - cx)**2 + (pt.z - cz)**2);
                if(d > maxDist) maxDist = d;
            }

            // Pass 1: Digging + Lip
            for(let gz = gzStart; gz <= gzEnd; gz++) {
                for(let gx = gxStart; gx <= gxEnd; gx++) {
                    let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+1];

                    let isInside = pointInPolygon(vx, vz, densePts);
                    if(!isInside) continue;

                    // Remove water inside bunker
                    if (wPosArray) {
                        wPosArray[idx*3 + 2] = -99.0;
                        if (window.waterBaseZ) window.waterBaseZ[idx] = -99.0;
                    }

                    let distEdge = distToPolygon(vx, vz, densePts);
                    let currentH = positions[idx*3+2];

                    let digDepth = depth;
                    if (shape === 'BOWL') {
                        let distCenter = Math.sqrt((vx - cx)**2 + (vz - cz)**2);
                        let normalizedDist = distCenter / (maxDist + 0.001);
                        let bowlFactor = 1.0 - Math.min(1.0, normalizedDist * normalizedDist);
                        digDepth = depth * (0.4 + 0.6 * bowlFactor);
                    }

                    let targetHeight = currentH - digDepth;

                    let relX = vx - cx;
                    let relZ = vz - cz;
                    let faceDot = relX * faceDx + relZ * faceDz;
                    let distCenter = Math.sqrt(relX*relX + relZ*relZ);
                    let cosTheta = distCenter > 0 ? (faceDot / distCenter) : 0;
                    let t = (cosTheta + 1.0) / 2.0;

                    let blendDist = 2.5 + (5.0 - 2.5) * t;
                    let edgeBlend = Math.min(1.0, distEdge / blendDist);
                    edgeBlend = edgeBlend * edgeBlend * (3.0 - 2.0 * edgeBlend);

                    let blendedDig = currentH + (targetHeight - currentH) * edgeBlend;

                    if (lipHeight > 0) {
                        let normalized = faceDot / (faceLen + 0.001);
                        let edgeProximity = 1.0 - Math.min(1.0, distEdge / 5.0);
                        if (normalized > 0 && edgeProximity > 0) {
                            let lipInfluence = edgeProximity * edgeProximity * Math.min(1.0, normalized);
                            let lipAdd = lipHeight * lipInfluence;
                            blendedDig += lipAdd;
                        }
                    }

                    positions[idx*3+2] = blendedDig;
                }
            }

            // Pass 2: Auto-smooth edges (Laplacian)
            let _smoothStride = window.TERRAIN_SEGS + 1;
            let smGxStart = Math.max(0, gxStart - 3);
            let smGxEnd = Math.min(window.TERRAIN_SEGS, gxEnd + 3);
            let smGzStart = Math.max(0, gzStart - 3);
            let smGzEnd = Math.min(window.TERRAIN_SEGS, gzEnd + 3);

            for(let smPass = 0; smPass < 5; smPass++) {
                let tempHeights = new Float32Array(positions.length / 3);
                for (let i = 0; i < tempHeights.length; i++) {
                    tempHeights[i] = positions[i*3 + 2];
                }

                for(let gz = smGzStart; gz <= smGzEnd; gz++) {
                    for(let gx = smGxStart; gx <= smGxEnd; gx++) {
                        let idx = gz * _smoothStride + gx;
                        let vx = positions[idx*3];
                        let vz = -positions[idx*3+1];

                        let isInside = pointInPolygon(vx, vz, densePts);
                        let distEdge = distToPolygon(vx, vz, densePts);

                        if (isInside || distEdge < 2.5) {
                            let nCount = 0;
                            let nSum = 0;
                            if (gz > 0) { nSum += tempHeights[(gz-1)*_smoothStride + gx]; nCount++; }
                            if (gz < window.TERRAIN_SEGS) { nSum += tempHeights[(gz+1)*_smoothStride + gx]; nCount++; }
                            if (gx > 0) { nSum += tempHeights[gz*_smoothStride + gx-1]; nCount++; }
                            if (gx < window.TERRAIN_SEGS) { nSum += tempHeights[gz*_smoothStride + gx+1]; nCount++; }

                            if (nCount > 0) {
                                let localAvg = nSum / nCount;
                                let smoothStrength = 0.6;
                                if (isInside && distEdge > 2.0) smoothStrength = 0.15;
                                if (!isInside && distEdge > 1.5) smoothStrength = 0.25;

                                positions[idx*3 + 2] += (localAvg - tempHeights[idx]) * smoothStrength;
                            }
                        }
                    }
                }
            }
        }
    });

    if (updateTexture && window._arcadeMapTex) {
        window._arcadeMapTex.needsUpdate = true;
        if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(500);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();
    window.snapObjectsToGround();

    if (wPosArray && window.rebuildWaterMask) {
        waterGeo.attributes.position.needsUpdate = true;
        window.rebuildWaterMask(false);
    }

    if(window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if(window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if(window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();
    } finally {
        window._isApplyingBunkerPipeline = false;
    }
};

// 4. Live reactive update triggered from UI sliders or buttons
window.updateLiveBunker = function(property, value) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    let bd = getActiveBunker(hole);
    if (!bd) return;

    if (!bd.origHeights && bd.points && typeof window.captureBunkerSnapshot === 'function') {
        let snap = window.captureBunkerSnapshot(hole, bd.points, 15);
        bd.bbox = snap.bbox;
        bd.origHeights = snap.origHeights;
        bd.origCanvasPixels = snap.origCanvasPixels;
        if (bd.baseElevation === undefined) bd.baseElevation = snap.baseElevation;
    }

    bd[property] = value;

    let needsRepaint = (property === 'edgeSharpness');

    if (window._bunkerRebakePending) return;
    window._bunkerRebakePending = true;
    requestAnimationFrame(function() {
        window._bunkerRebakePending = false;
        let curHole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (curHole) {
            let activeBd = getActiveBunker(curHole);
            if (activeBd) {
                window.applyBunkerPipeline(curHole, false, needsRepaint, activeBd);
            }
        }
    });
};

// 5. Delete active bunker and restore 100% untouched natural ground
window.deleteSmartBunker = function(holeIndex, bunkerIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (bunkerIndex === undefined) bunkerIndex = hole.activeBunkerIndex;
    if (bunkerIndex === null || bunkerIndex === undefined || !hole.bunkers[bunkerIndex]) return;

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let bkNum = bunkerIndex + 1;
    let msg = isSv 
        ? ('Vill du ta bort Bunker ' + bkNum + ' och återställa marken till 100% orörd natur?') 
        : ('Delete Bunker ' + bkNum + ' and restore terrain to 100% natural condition?');
    if (!confirm(msg)) return;

    window.saveUndoState();

    let targetBd = hole.bunkers[bunkerIndex];
    window.restoreBunkerBase(hole, true, targetBd);
    if (typeof window.eraseBunkerTexture === 'function') {
        window.eraseBunkerTexture(targetBd);
    }

    hole.bunkers.splice(bunkerIndex, 1);
    if (hole.bunkers.length > 0) {
        hole.activeBunkerIndex = Math.max(0, Math.min(bunkerIndex, hole.bunkers.length - 1));
        hole.bunkerData = hole.bunkers[0];
    } else {
        hole.activeBunkerIndex = null;
        hole.bunkerData = null;
    }

    // Re-apply remaining elements so everything is cleanly layered
    if (hole.fairways && hole.fairways.length > 0 && typeof window.applyFairwayPipeline === 'function') {
        window.applyFairwayPipeline(hole, false, true);
    }
    if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }
    if (hole.bunkers.length > 0) {
        window.applyBunkerPipeline(hole, false, true);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();
    window.snapObjectsToGround();

    if (window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if (window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if (window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();

    updateActiveBunkerOutline();
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();
    window.saveLevel();
    window.showBuildToast(isSv ? ('🗑️ Bunker ' + bkNum + ' raderad!') : ('🗑️ Bunker ' + bkNum + ' deleted!'), '#ef4444');
};

// 5.5. Delete ALL bunkers on current hole and restore 100% untouched natural ground
window.deleteAllSmartBunkers = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (!hole.bunkers || hole.bunkers.length === 0) return;

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let count = hole.bunkers.length;
    let msg = isSv 
        ? ('Vill du radera ALLA (' + count + ') bunkrar på detta hål och återställa marken till 100% orörd natur?') 
        : ('Delete ALL (' + count + ') bunkers on this hole and restore terrain to 100% natural condition?');
    if (!confirm(msg)) return;

    window.saveUndoState();

    hole.bunkers.forEach(bd => {
        window.restoreBunkerBase(hole, true, bd);
        if (typeof window.eraseBunkerTexture === 'function') {
            window.eraseBunkerTexture(bd);
        }
    });

    hole.bunkers = [];
    hole.bunkerData = null;
    hole.activeBunkerIndex = null;

    if (hole.fairways && hole.fairways.length > 0 && typeof window.applyFairwayPipeline === 'function') {
        window.applyFairwayPipeline(hole, false, true);
    }
    if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();
    window.snapObjectsToGround();

    if (window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if (window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if (window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();

    updateActiveBunkerOutline();
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();
    window.saveLevel();
    window.showBuildToast(isSv ? ('🗑️ Alla bunkrar raderade — marken återställd!') : ('🗑️ All bunkers deleted — terrain restored!'), '#ef4444');
};

// 6. Redraw shape: restores ground and puts points back in interactive drawing mode
window.redrawSmartBunker = function(holeIndex, bunkerIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (bunkerIndex === undefined) bunkerIndex = hole.activeBunkerIndex;
    if (bunkerIndex === null || bunkerIndex === undefined || !hole.bunkers[bunkerIndex]) return;

    window.saveUndoState();

    let targetBd = hole.bunkers[bunkerIndex];
    let savedPoints = targetBd.points.map(p => ({ x: p.x, y: p.y, z: p.z }));

    window.restoreBunkerBase(hole, true, targetBd);
    if (typeof window.eraseBunkerTexture === 'function') {
        window.eraseBunkerTexture(targetBd);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();

    hole.bunkers.splice(bunkerIndex, 1);
    if (hole.bunkers.length > 0) {
        hole.bunkerData = hole.bunkers[0];
    } else {
        hole.bunkerData = null;
    }
    hole.activeBunkerIndex = null;

    if (hole.fairways && hole.fairways.length > 0 && typeof window.applyFairwayPipeline === 'function') {
        window.applyFairwayPipeline(hole, false, true);
    }
    if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }
    if (hole.bunkers.length > 0) {
        window.applyBunkerPipeline(hole, false, true);
    }

    smartGreenPoints = savedPoints.map(p => new THREE.Vector3(p.x, p.y || 0, p.z));
    window._smartShapeClosed = false;
    updateSmartGreenPreview();

    updateActiveBunkerOutline();
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '🔄 Justera form: Dra i punkterna eller lägg till nya' : '🔄 Adjust shape: Drag points or add new ones', '#fbbf24');
};

// 7. Scale entire bunker up or down symmetrically around its centroid
window.scaleSmartBunker = function(holeIndex, factor, bunkerIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (bunkerIndex === undefined) bunkerIndex = hole.activeBunkerIndex;
    if (bunkerIndex === null || bunkerIndex === undefined || !hole.bunkers[bunkerIndex]) return;

    let bd = hole.bunkers[bunkerIndex];
    if (!bd.points || bd.points.length < 3) return;

    window.saveUndoState();

    let cx = 0, cz = 0;
    for(let pt of bd.points) { cx += pt.x; cz += pt.z; }
    cx /= bd.points.length;
    cz /= bd.points.length;

    let maxDist = 0;
    for(let pt of bd.points) {
        let d = Math.sqrt((pt.x - cx)**2 + (pt.z - cz)**2);
        if (d > maxDist) maxDist = d;
    }
    let newMaxDist = maxDist * factor;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (newMaxDist < 2.0) {
        window.showBuildToast(isSv ? '⚠️ Bunkern kan inte minskas mer' : '⚠️ Bunker cannot be scaled smaller', '#f59e0b');
        return;
    }
    if (newMaxDist > 100.0) {
        window.showBuildToast(isSv ? '⚠️ Bunkern har nått maxstorlek' : '⚠️ Bunker has reached max size', '#f59e0b');
        return;
    }

    // 1. Restore pristine ground before modifying points
    window.restoreBunkerBase(hole, true, bd);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();

    // 2. Scale all control points outward or inward from centroid
    for(let pt of bd.points) {
        pt.x = cx + (pt.x - cx) * factor;
        pt.z = cz + (pt.z - cz) * factor;
    }

    // 3. Capture clean snapshot for new scaled bounding box
    let snap = window.captureBunkerSnapshot(hole, bd.points, 15);
    bd.baseElevation = snap.baseElevation;
    bd.bbox = snap.bbox;
    bd.origHeights = snap.origHeights;
    bd.origCanvasPixels = snap.origCanvasPixels;

    // 4. Re-apply pipeline
    window.applyBunkerPipeline(hole, false, true, bd);
    updateActiveBunkerOutline();

    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();

    let area = 0;
    if (bd.points && bd.points.length >= 3) {
        for (let i = 0, j = bd.points.length - 1; i < bd.points.length; j = i++) {
            area += (bd.points[j].x + bd.points[i].x) * (bd.points[j].z - bd.points[i].z);
        }
        area = Math.round(Math.abs(area / 2));
    }
    let bkNum = bunkerIndex + 1;
    let toastMsg = factor > 1
        ? (isSv ? `➕ Bunker ${bkNum} utökad till ~${area} m²` : `➕ Bunker ${bkNum} scaled up to ~${area} m²`)
        : (isSv ? `➖ Bunker ${bkNum} minskad till ~${area} m²` : `➖ Bunker ${bkNum} scaled down to ~${area} m²`);
    window.showBuildToast(toastMsg, '#4ade80');
};

// 8. Move entire bunker to new center coordinates
window.moveSmartBunker = function(holeIndex, newCenterX, newCenterZ, bunkerIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);
    if (bunkerIndex === undefined) bunkerIndex = hole.activeBunkerIndex;
    if (bunkerIndex === null || bunkerIndex === undefined || !hole.bunkers[bunkerIndex]) return;

    let bd = hole.bunkers[bunkerIndex];
    if (!bd.points || bd.points.length < 3) return;

    window.saveUndoState();

    let oldCx = 0, oldCz = 0;
    for(let pt of bd.points) { oldCx += pt.x; oldCz += pt.z; }
    oldCx /= bd.points.length;
    oldCz /= bd.points.length;

    let dx = newCenterX - oldCx;
    let dz = newCenterZ - oldCz;

    // Restore old ground 100% clean
    window.restoreBunkerBase(hole, true, bd);

    // Shift all points
    for(let pt of bd.points) {
        pt.x += dx;
        pt.z += dz;
    }

    // Capture new snapshot
    let snap = window.captureBunkerSnapshot(hole, bd.points, 15);
    bd.baseElevation = snap.baseElevation;
    bd.bbox = snap.bbox;
    bd.origHeights = snap.origHeights;
    bd.origCanvasPixels = snap.origCanvasPixels;

    window.applyBunkerPipeline(hole, false, true, bd);
    updateActiveBunkerOutline();

    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let bkNum = bunkerIndex + 1;
    window.showBuildToast(isSv ? `✥ Bunker ${bkNum} flyttad!` : `✥ Bunker ${bkNum} moved!`, '#4ade80');
};

// 9. Activate "Move Bunker" picking mode
window.activateMoveBunkerMode = function() {
    window._movingBunkerMode = true;
    window._movingFairwayMode = false;
    window._movingGreenMode = false;
    window._movingFlagMode = false;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let bkNum = (hole && hole.activeBunkerIndex !== null && hole.activeBunkerIndex !== undefined) ? (hole.activeBunkerIndex + 1) : '';
    let msg = isSv 
        ? (`📍 Klicka på kartan där Bunker ${bkNum} ska placeras (Esc för att avbryta)`) 
        : (`📍 Click on map to place Bunker ${bkNum} (Esc to cancel)`);
    window.showBuildToast(msg, '#f59e0b');
};

// 10. Initial Bunker Build triggered from UI button
window.executeSmartBunker = function() {
    if(smartGreenPoints.length < 3) {
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        window.showBuildToast(isSv ? '⚠️ Rita minst 3 punkter för att bygga bunker!' : '⚠️ Draw at least 3 points to build bunker!', '#ef4444');
        return;
    }
    window.saveUndoState();

    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    ensureHoleBunkers(hole);

    // Read sliders
    let depthSlider = document.getElementById('sb-bunker-depth');
    let lipSlider = document.getElementById('sb-bunker-lip');
    let depth = depthSlider ? parseFloat(depthSlider.value) : 0.8;
    let lipHeight = lipSlider ? parseFloat(lipSlider.value) : 0.3;
    let shape = window._smartBunkerShape || 'BOWL';

    let sharpSlider = document.getElementById('sg-edge-sharpness');
    let sharpness = sharpSlider ? parseInt(sharpSlider.value) : 100;

    let snap = window.captureBunkerSnapshot(hole, smartGreenPoints, 15);

    let newBunker = {
        id: 'bk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        points: smartGreenPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
        baseElevation: snap.baseElevation,
        bbox: snap.bbox,
        origHeights: snap.origHeights,
        origCanvasPixels: snap.origCanvasPixels,

        shape: shape,
        depth: depth,
        lipHeight: lipHeight,
        edgeSharpness: sharpness
    };

    hole.bunkers.push(newBunker);
    hole.activeBunkerIndex = hole.bunkers.length - 1;
    hole.bunkerData = hole.bunkers[0]; // Mirror primary for backward compatibility

    window.applyBunkerPipeline(hole, true, true, newBunker);
    clearSmartGreen();
    updateActiveBunkerOutline();

    window.saveLevel();
    if (typeof window.updateSBBunkerControls === 'function') window.updateSBBunkerControls();

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let bkNum = hole.bunkers.length;
    window.showBuildToast(isSv ? (`✅ Bunker ${bkNum} byggd!`) : (`✅ Bunker ${bkNum} built!`), '#4ade80');

    window._smartBuildCooldown = true;
    setTimeout(function() { window._smartBuildCooldown = false; }, 500);
};

// === SMART FAIRWAY LIVE STUDIO: Parametric Fairway + Rough + Rolling Terrain ===

// Helper: Ensure hole has fairways array with backward compatibility
function ensureHoleFairways(hole) {
    if (!hole) return [];
    if (!hole.fairways) {
        hole.fairways = [];
        if (hole.fairwayData && hole.fairwayData.points && hole.fairwayData.points.length >= 3) {
            hole.fairways.push(hole.fairwayData);
        }
    }
    if (hole.fairways.length === 0 && hole.fairwayData && hole.fairwayData.points && hole.fairwayData.points.length >= 3) {
        hole.fairways.push(hole.fairwayData);
    }
    if (hole.fairways.length > 0) {
        hole.fairwayData = hole.fairways[0];
        // DO NOT overwrite null! null means "drawing mode for new fairway"
        if (hole.activeFairwayIndex === undefined) {
            hole.activeFairwayIndex = 0;
        } else if (hole.activeFairwayIndex !== null && hole.activeFairwayIndex >= hole.fairways.length) {
            hole.activeFairwayIndex = hole.fairways.length - 1;
        }
    } else {
        hole.fairwayData = null;
        hole.activeFairwayIndex = null;
    }
    return hole.fairways;
}
window.ensureHoleFairways = ensureHoleFairways;

function getActiveFairway(hole) {
    if (!hole) return null;
    ensureHoleFairways(hole);
    if (hole.activeFairwayIndex === null || hole.activeFairwayIndex === undefined) {
        if (hole.fairways && hole.fairways.length > 0) {
            hole.activeFairwayIndex = 0;
            return hole.fairways[0];
        }
        return null;
    }
    return hole.fairways[hole.activeFairwayIndex] || (hole.fairways && hole.fairways.length > 0 ? hole.fairways[0] : null);
}
window.getActiveFairway = getActiveFairway;

// 3D Outline Mesh for Selected Fairway
let activeFairwayOutlineMesh = null;
function updateActiveFairwayOutline() {
    let hadMesh = !!activeFairwayOutlineMesh;
    if (activeFairwayOutlineMesh && window._arcadeScene) {
        window._arcadeScene.remove(activeFairwayOutlineMesh);
        if (activeFairwayOutlineMesh.geometry) activeFairwayOutlineMesh.geometry.dispose();
        if (activeFairwayOutlineMesh.material) activeFairwayOutlineMesh.material.dispose();
        activeFairwayOutlineMesh = null;
    }
    if ((window.appMode && window.appMode !== 'BUILD') || 
        (window.currentTool && window.currentTool !== 'SMART_BUILDER') || 
        window._smartBuilderType !== 'FAIRWAY' || 
        window._showFairwayOutline === false) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole || hole.activeFairwayIndex === null || hole.activeFairwayIndex === undefined) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }
    if (!hole.fairways || !hole.fairways[hole.activeFairwayIndex]) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }

    let fd = hole.fairways[hole.activeFairwayIndex];
    if (!fd.points || fd.points.length < 3) {
        if (hadMesh && window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
        return;
    }

    let densePts = getDenseFairwayPoints(fd.points);
    let linePts = densePts.map(p => {
        let y = (typeof window.getTerrainHeight === 'function') 
            ? window.getTerrainHeight(p.x, p.z) 
            : (p.y || 0);
        return new THREE.Vector3(p.x, y + 0.35, p.z);
    });
    if (linePts.length > 0) {
        linePts.push(linePts[0].clone());
    }

    let geo = new THREE.BufferGeometry().setFromPoints(linePts);
    let mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3, depthTest: false });
    activeFairwayOutlineMesh = new THREE.Line(geo, mat);
    activeFairwayOutlineMesh.renderOrder = 998;
    if (window._arcadeScene) window._arcadeScene.add(activeFairwayOutlineMesh);
    if (window._arcadeRenderer && window._arcadeScene && window._arcadeCamera) {
        window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
    }
}
window.updateActiveFairwayOutline = updateActiveFairwayOutline;

window.toggleFairwayOutline = function() {
    if (window._showFairwayOutline === undefined) window._showFairwayOutline = true;
    window._showFairwayOutline = !window._showFairwayOutline;
    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') {
        window.updateSBFairwayControls();
    }
};

// Center Camera on Selected Fairway
window.centerCameraOnFairway = function(holeIndex, fairwayIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (fairwayIndex === undefined) fairwayIndex = hole.activeFairwayIndex;
    let fd = (hole.fairways && fairwayIndex !== null && fairwayIndex !== undefined) ? hole.fairways[fairwayIndex] : null;
    if (!fd || !fd.points || fd.points.length === 0) return;

    let cx = 0, cz = 0;
    for (let p of fd.points) { cx += p.x; cz += p.z; }
    cx /= fd.points.length;
    cz /= fd.points.length;
    let cy = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(cx, cz) : 0;

    if (window._arcadeCamera && window.controls) {
        window.controls.target.set(cx, cy, cz);
        window._arcadeCamera.position.set(cx, cy + 50, cz + 60);
        window.controls.update();
        if (window._arcadeRenderer && window._arcadeScene) {
            window._arcadeRenderer.render(window._arcadeScene, window._arcadeCamera);
        }
    }
    updateActiveFairwayOutline();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let fwNum = (fairwayIndex !== null && fairwayIndex !== undefined) ? (fairwayIndex + 1) : '';
    window.showBuildToast(isSv ? `🔍 Centrerad på Fairway ${fwNum}` : `🔍 Centered on Fairway ${fwNum}`, '#fbbf24');
};

window.selectActiveFairway = function(holeIndex, fairwayIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (fairwayIndex >= 0 && fairwayIndex < hole.fairways.length) {
        hole.activeFairwayIndex = fairwayIndex;
        if (typeof window.clearSmartGreen === 'function') window.clearSmartGreen();
        let activeFd = hole.fairways[fairwayIndex];
        if (activeFd && typeof window.applyFairwayPipeline === 'function') {
            window.applyFairwayPipeline(hole, false, true, activeFd);
        }
    }
    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();
};

window.startNewFairwayDrawing = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (hole) {
        ensureHoleFairways(hole);
        hole.activeFairwayIndex = null;
    }
    if (typeof window.clearSmartGreen === 'function') window.clearSmartGreen();
    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let fwCount = (hole && hole.fairways) ? hole.fairways.length : 0;
    let nextNum = fwCount + 1;
    window.showBuildToast(isSv ? `✏️ Klicka på marken för att rita Fairway ${nextNum} (minst 3 punkter)` : `✏️ Click on ground to shape Fairway ${nextNum} (min 3 points)`, '#38bdf8');
};

// Helper: Generate dense smooth curve points from control points for Fairway
function getDenseFairwayPoints(points) {
    if (typeof getDenseGreenPoints === 'function') {
        return getDenseGreenPoints(points);
    }
    let pts3 = points.map(p => new THREE.Vector3(p.x, p.y || 0, p.z));
    let curve = new THREE.CatmullRomCurve3(pts3, true);
    let numSamples = Math.max(200, points.length * 40);
    return curve.getPoints(numSamples);
}

// 1. Capture baseline snapshot of natural terrain & canvas before fairway is built
window.captureFairwaySnapshot = function(hole, points, margin) {
    margin = Math.max(30, margin || 30);
    let densePts = getDenseFairwayPoints(points);
    let pathMinX = Infinity, pathMaxX = -Infinity, pathMinZ = Infinity, pathMaxZ = -Infinity;
    for(let pt of densePts) {
        if(pt.x < pathMinX) pathMinX = pt.x;
        if(pt.x > pathMaxX) pathMaxX = pt.x;
        if(pt.z < pathMinZ) pathMinZ = pt.z;
        if(pt.z > pathMaxZ) pathMaxZ = pt.z;
    }

    let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;
    let gxStart = Math.max(0, Math.floor((pathMinX - margin + window.TERRAIN_SIZE/2) / step));
    let gxEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxX + margin + window.TERRAIN_SIZE/2) / step));
    let gzStart = Math.max(0, Math.floor((pathMinZ - margin + window.TERRAIN_SIZE/2) / step));
    let gzEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxZ + margin + window.TERRAIN_SIZE/2) / step));
    let gWidth = gxEnd - gxStart + 1;
    let gHeight = gzEnd - gzStart + 1;

    // Texture snapshot with margin for rough ring + blur
    let texMargin = margin + 4;
    let pxMinX = Math.max(0, Math.floor(((pathMinX - texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxX = Math.min(4096, Math.ceil(((pathMaxX + texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMinY = Math.max(0, Math.floor(((pathMinZ - texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxY = Math.min(4096, Math.ceil(((pathMaxZ + texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pw = Math.max(1, pxMaxX - pxMinX);
    let ph = Math.max(1, pxMaxY - pxMinY);

    let positions = window._arcadePlaneGeo.attributes.position.array;
    let origHeights = new Float32Array(gWidth * gHeight);
    for(let gz = gzStart; gz <= gzEnd; gz++) {
        for(let gx = gxStart; gx <= gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS+1) + gx;
            let oi = (gz - gzStart) * gWidth + (gx - gxStart);
            origHeights[oi] = positions[idx*3+2];
        }
    }

    let origCanvasPixels = null;
    if (window._arcadePCtx) {
        origCanvasPixels = window._arcadePCtx.getImageData(pxMinX, pxMinY, pw, ph);
    }

    let baseH = 0;
    for(let pt of points) {
        let h = (typeof window.getTerrainHeight === 'function')
            ? window.getTerrainHeight(pt.x, pt.z)
            : (window.localGetTerrainAt ? (window.localGetTerrainAt(pt.x, -pt.z) || {}).z || 0 : 0);
        baseH += h;
    }
    baseH /= Math.max(1, points.length);

    return {
        baseElevation: baseH,
        bbox: {
            gxStart, gxEnd, gzStart, gzEnd,
            gWidth, gHeight,
            pxMinX, pxMaxX, pxMinY, pxMaxY,
            pw, ph, margin
        },
        origHeights: origHeights,
        origCanvasPixels: origCanvasPixels
    };
};

// 1.5. Cleanly erase a fairway's footprint
window.eraseFairwayTexture = function(fd, hole) {
    if (!fd || !fd.points || !window._arcadePCtx) return;
    let densePts = (typeof getDenseFairwayPoints === 'function') ? getDenseFairwayPoints(fd.points) : fd.points;
    if (!densePts || densePts.length < 3) return;

    let baseGroundColor = getBaseGroundColor(hole);
    let semiRoughWidth = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
    let roughWidth = (fd.roughEnabled !== false) ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;
    let eraseMargin = semiRoughWidth + roughWidth + 0.3;

    let ctx = window._arcadePCtx;
    ctx.save();
    ctx.filter = 'none';

    let expandedPts = (typeof offsetPolygon === 'function') ? offsetPolygon(densePts, eraseMargin) : densePts;
    ctx.beginPath();
    expandedPts.forEach((pt, i) => {
        let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY);
        else ctx.lineTo(pxX, pxY);
    });
    ctx.closePath();
    ctx.fillStyle = baseGroundColor;
    ctx.fill();

    ctx.restore();
};

// 2. Restore pristine baseline ground & texture before applying modified parameters
window.restoreFairwayBase = function(hole, restoreTexture, targetFairway) {
    if (restoreTexture === undefined) restoreTexture = false;
    if (!hole) return;
    ensureHoleFairways(hole);
    let fds = targetFairway ? [targetFairway] : (hole.fairways && hole.fairways.length > 0 ? hole.fairways : (hole.fairwayData ? [hole.fairwayData] : []));
    if (fds.length === 0) return;

    fds.forEach(fd => {
        if (!fd || !fd.bbox) return;
        let densePts = (fd.points && fd.points.length >= 3 && typeof getDenseFairwayPoints === 'function') ? getDenseFairwayPoints(fd.points) : null;
        let semiRoughWidth = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
        let roughWidth = (fd.roughEnabled !== false) ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;
        let maxReach = semiRoughWidth + roughWidth + 12.0;

        // Restore vertex heights across organic fairway zone without rectangular scars
        if (fd.origHeights && window._arcadePlaneGeo) {
            let positions = window._arcadePlaneGeo.attributes.position.array;
            let gWidth = fd.bbox.gWidth;

            for(let gz = fd.bbox.gzStart; gz <= fd.bbox.gzEnd; gz++) {
                for(let gx = fd.bbox.gxStart; gx <= fd.bbox.gxEnd; gx++) {
                    let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+1];

                    let isInside = densePts ? pointInPolygon(vx, vz, densePts) : false;
                    let distEdge = isInside ? 0 : (densePts ? distToPolygon(vx, vz, densePts) : 0);
                    if (densePts && distEdge > maxReach) continue;

                    let oi = (gz - fd.bbox.gzStart) * gWidth + (gx - fd.bbox.gxStart);
                    if (oi >= 0 && oi < fd.origHeights.length) {
                        positions[idx*3+2] = fd.origHeights[oi];
                    }
                }
            }
        }

        // Restore 2D canvas texture: restore clipped pixels or paint base ground color
        if (restoreTexture) {
            if (fd.origCanvasPixels && densePts && window._arcadePCtx && fd.bbox.pw > 0 && fd.bbox.ph > 0) {
                let ctx = window._arcadePCtx;
                if (!window._fairwaySnapCanvas) window._fairwaySnapCanvas = document.createElement('canvas');
                window._fairwaySnapCanvas.width = fd.bbox.pw;
                window._fairwaySnapCanvas.height = fd.bbox.ph;
                let fCtx = window._fairwaySnapCanvas.getContext('2d');
                fCtx.putImageData(fd.origCanvasPixels, 0, 0);

                ctx.save();
                ctx.beginPath();
                densePts.forEach((pt, i) => {
                    let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                    let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                    if (i === 0) ctx.moveTo(pxX, pxY);
                    else ctx.lineTo(pxX, pxY);
                });
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(window._fairwaySnapCanvas, fd.bbox.pxMinX, fd.bbox.pxMinY);
                ctx.restore();
            } else if (typeof window.eraseFairwayTexture === 'function') {
                window.eraseFairwayTexture(fd, hole);
            }
        }
    });
};

// 3. Apply full fairway pipeline (Painting + Sculpting)
window.applyFairwayPipeline = function(hole, isInitial, updateTexture, targetFairway) {
    if (!hole) return;
    if (window._isApplyingFairwayPipeline) return;
    window._isApplyingFairwayPipeline = true;
    try {
        ensureHoleFairways(hole);
        let fds = targetFairway ? [targetFairway] : (hole.fairways && hole.fairways.length > 0 ? hole.fairways : (hole.fairwayData ? [hole.fairwayData] : []));
        if (fds.length === 0) return;
        if (updateTexture === undefined) updateTexture = true;

        // Reset ground vertex heights to pristine baseline for targeted fairway(s)
        window.restoreFairwayBase(hole, false, targetFairway);

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let fairwayColor = cfg.fairwayColor || '#7db952';
    let semiRoughColor = cfg.semiColor || '#6b9e3d';
    let roughColor = cfg.roughColor || '#4a782b';

    fds.forEach(fd => {
        if (!fd || !fd.points || fd.points.length < 3) return;
        let densePts = getDenseFairwayPoints(fd.points);

        // === PAINT PASS ===
        if (updateTexture && window._arcadePCtx) {
            window._arcadePCtx.save();

            let sharpness = fd.edgeSharpness !== undefined ? fd.edgeSharpness : 100;
            if (sharpness < 100) {
                let blurPx = Math.round((100 - sharpness) * 0.06);
                if (blurPx > 0) window._arcadePCtx.filter = 'blur(' + blurPx + 'px)';
            }

            function traceFairwayPath() {
                window._arcadePCtx.beginPath();
                densePts.forEach((pt, i) => {
                    let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                    let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                    if (i === 0) window._arcadePCtx.moveTo(pxX, pxY);
                    else window._arcadePCtx.lineTo(pxX, pxY);
                });
                window._arcadePCtx.closePath();
            }

            let semiRoughWidth = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
            let roughEnabled = (fd.roughEnabled !== false);
            let roughWidth = roughEnabled ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;

            // Draw rough ring (outermost)
            if (roughWidth > 0) {
                traceFairwayPath();
                window._arcadePCtx.lineWidth = (semiRoughWidth + roughWidth) * 2 * (4096 / window.TERRAIN_SIZE);
                window._arcadePCtx.strokeStyle = roughColor;
                window._arcadePCtx.lineJoin = 'round';
                window._arcadePCtx.stroke();
                window._arcadePCtx.fillStyle = roughColor;
                window._arcadePCtx.fill();
            }

            // Draw semi-rough ring
            if (semiRoughWidth > 0) {
                traceFairwayPath();
                window._arcadePCtx.lineWidth = semiRoughWidth * 2 * (4096 / window.TERRAIN_SIZE);
                window._arcadePCtx.strokeStyle = semiRoughColor;
                window._arcadePCtx.lineJoin = 'round';
                window._arcadePCtx.stroke();
                window._arcadePCtx.fillStyle = semiRoughColor;
                window._arcadePCtx.fill();
            }

            // Draw fairway fill
            traceFairwayPath();
            window._arcadePCtx.fillStyle = fairwayColor;
            window._arcadePCtx.fill();

            // Mowing pattern overlay
            let mowPattern = fd.mowPattern || 'SOLID';
            if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
                paintMowingPattern(window._arcadePCtx, densePts, fairwayColor, mowPattern);
            }

            window._arcadePCtx.filter = 'none';
            window._arcadePCtx.restore();
        }

        // === SCULPT PASS ===
        let difficulty = fd.difficulty || 'FLAT';
        if (difficulty !== 'FLAT' && fd.bbox && fd.origHeights) {
            let positions = window._arcadePlaneGeo.attributes.position.array;
            let baseH = fd.baseElevation || 0;
            let seedX = fd.seedOffsetX || 0;
            let seedZ = fd.seedOffsetZ || 0;
            let semiRoughWidth = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
            let roughWidth = (fd.roughEnabled !== false) ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;
            let margin = semiRoughWidth + roughWidth + 8.0;

            let gxStart = fd.bbox.gxStart;
            let gxEnd = fd.bbox.gxEnd;
            let gzStart = fd.bbox.gzStart;
            let gzEnd = fd.bbox.gzEnd;
            let gWidth = fd.bbox.gWidth;
            let origHeights = fd.origHeights;

            for(let gz = gzStart; gz <= gzEnd; gz++) {
                for(let gx = gxStart; gx <= gxEnd; gx++) {
                    let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+1];

                    let isInside = pointInPolygon(vx, vz, densePts);
                    let distEdge = distToPolygon(vx, vz, densePts);

                    if(!isInside && distEdge > margin) continue;

                    let oi = (gz - gzStart) * gWidth + (gx - gxStart);
                    if (oi < 0 || oi >= origHeights.length) continue;
                    let originalH = origHeights[oi];

                    let sx = vx + seedX;
                    let sz = vz + seedZ;
                    let targetHeight = originalH;

                    if(difficulty === 'EASY') {
                        targetHeight += Math.sin(sx * 0.08) * Math.cos(sz * 0.09) * 0.40;
                    } else if(difficulty === 'MED') {
                        targetHeight += Math.sin(sx * 0.09) * Math.cos(sz * 0.10) * 0.65;
                        targetHeight += Math.sin(sx * 0.05 + sz * 0.07) * 0.30;
                    } else if(difficulty === 'HARD') {
                        targetHeight += Math.sin(sx * 0.10) * Math.cos(sz * 0.11) * 0.85;
                        targetHeight += Math.sin(sx * 0.06 + sz * 0.08) * 0.45;
                        targetHeight += Math.cos(sx * 0.14) * Math.sin(sz * 0.12) * 0.25;
                    }

                    let influence;
                    if(isInside) {
                        influence = 1.0;
                    } else {
                        influence = 1.0 - (distEdge / margin);
                        influence = Math.max(0, influence * influence * (3 - 2 * influence));
                    }

                    positions[idx*3+2] = originalH + (targetHeight - originalH) * influence;
                }
            }
        }
    });

    if (updateTexture && window._arcadeMapTex) {
        window._arcadeMapTex.needsUpdate = true;
        if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(500);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }

    // Sync mesh geometry
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();
    window.snapObjectsToGround();

    // Re-render Smart Green on top so green always stays on top (only if not already applying green)
    if (!window._isApplyingGreenPipeline && hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, updateTexture);
    }

    if(window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if(window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if(window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();
    } finally {
        window._isApplyingFairwayPipeline = false;
    }
};

// 4. Live reactive update triggered from UI sliders or buttons
window.updateLiveFairway = function(property, value) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    if (typeof ensureHoleFairways === 'function') ensureHoleFairways(hole);
    let fd = (typeof getActiveFairway === 'function') ? getActiveFairway(hole) : null;
    if (!fd && hole.fairways && hole.fairways.length > 0) {
        hole.activeFairwayIndex = 0;
        fd = hole.fairways[0];
    }
    if (!fd) return;

    // If loaded from file without in-memory snapshot, capture baseline now
    if (!fd.origHeights && fd.points && typeof window.captureFairwaySnapshot === 'function') {
        let snap = window.captureFairwaySnapshot(hole, fd.points, 35);
        fd.bbox = snap.bbox;
        fd.origHeights = snap.origHeights;
        fd.origCanvasPixels = snap.origCanvasPixels;
        if (fd.baseElevation === undefined) fd.baseElevation = snap.baseElevation;
    }

    fd[property] = value;

    let needsRepaint = (property === 'semiRoughWidth' || property === 'roughWidth' || property === 'roughEnabled' || property === 'edgeSharpness' || property === 'mowPattern');

    if (window._fairwayRebakePending) return;
    window._fairwayRebakePending = true;
    requestAnimationFrame(function() {
        window._fairwayRebakePending = false;
        let curHole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (curHole) {
            let activeFd = getActiveFairway(curHole);
            if (activeFd) {
                window.applyFairwayPipeline(curHole, false, needsRepaint, activeFd);
            }
        }
    });
};

// 5. Delete active fairway and restore 100% untouched natural ground
window.deleteSmartFairway = function(holeIndex, fairwayIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (fairwayIndex === undefined) fairwayIndex = hole.activeFairwayIndex;
    if (fairwayIndex === null || fairwayIndex === undefined || !hole.fairways[fairwayIndex]) return;

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let fwNum = fairwayIndex + 1;
    let msg = isSv 
        ? ('Vill du ta bort Fairway ' + fwNum + ' och återställa marken till 100% orörd natur?') 
        : ('Delete Fairway ' + fwNum + ' and restore terrain to 100% natural condition?');
    if (!confirm(msg)) return;

    window.saveUndoState();

    let targetFd = hole.fairways[fairwayIndex];
    window.restoreFairwayBase(hole, true, targetFd);
    if (typeof window.eraseFairwayTexture === 'function') {
        window.eraseFairwayTexture(targetFd);
    }

    // Remove from fairways array
    hole.fairways.splice(fairwayIndex, 1);
    if (hole.fairways.length > 0) {
        hole.activeFairwayIndex = Math.max(0, Math.min(fairwayIndex, hole.fairways.length - 1));
        hole.fairwayData = hole.fairways[0];
    } else {
        hole.activeFairwayIndex = null;
        hole.fairwayData = null;
    }

    // Re-apply any remaining fairways & green so everything is clean and properly layered
    if (hole.fairways.length > 0) {
        window.applyFairwayPipeline(hole, false, true);
    } else if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
    }
    window.snapObjectsToGround();

    if (window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if (window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if (window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();

    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();
    window.saveLevel();
    window.showBuildToast(isSv ? ('🗑️ Fairway ' + fwNum + ' raderad!') : ('🗑️ Fairway ' + fwNum + ' deleted!'), '#ef4444');
};

// 5.5. Delete ALL fairways on current hole and restore 100% untouched natural ground
window.deleteAllSmartFairways = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (!hole.fairways || hole.fairways.length === 0) return;

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let count = hole.fairways.length;
    let msg = isSv 
        ? ('Vill du radera ALLA (' + count + ') fairways på detta hål och återställa marken till 100% orörd natur?') 
        : ('Delete ALL (' + count + ') fairways on this hole and restore terrain to 100% natural condition?');
    if (!confirm(msg)) return;

    window.saveUndoState();

    // 1. Restore heights and erase texture for all fairways
    hole.fairways.forEach(fd => {
        window.restoreFairwayBase(hole, true, fd);
        if (typeof window.eraseFairwayTexture === 'function') {
            window.eraseFairwayTexture(fd);
        }
    });

    hole.fairways = [];
    hole.fairwayData = null;
    hole.activeFairwayIndex = null;

    // 2. Re-apply green on top if exists
    if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }

    // 3. Sync textures and masks
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    // 4. Sync geometry
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
    }
    window.snapObjectsToGround();

    if (window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if (window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if (window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();

    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();
    window.saveLevel();
    window.showBuildToast(isSv ? ('🗑️ Alla fairways raderade — marken återställd!') : ('🗑️ All fairways deleted — terrain restored!'), '#ef4444');
};

// 5.8. Clean any ghost fairway pixels in the hole corridor and restore clean natural ground
window.cleanGhostFairways = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole || !window._arcadePCtx) return;

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let msg = isSv 
        ? 'Vill du rensa eventuella spök-fairways och återställa hålets mark till 100% ren ruff?' 
        : 'Do you want to clean ghost fairways and restore hole terrain to 100% natural rough?';
    if (!confirm(msg)) return;

    window.saveUndoState();

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let roughColor = cfg.roughColor || '#4a782b';

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    function includePt(x, z) {
        if (typeof x === 'number' && !isNaN(x) && typeof z === 'number' && !isNaN(z)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
    }

    if (hole.tees) {
        ['red','yellow','white','black','range'].forEach(t => {
            if (hole.tees[t]) includePt(hole.tees[t].x, hole.tees[t].z);
        });
    }
    if (hole.aimPoint) includePt(hole.aimPoint.x, hole.aimPoint.z);
    if (hole.flag) includePt(hole.flag.x, hole.flag.z);
    if (hole.greenData && hole.greenData.points) {
        hole.greenData.points.forEach(p => includePt(p.x, p.z));
    }
    ensureHoleFairways(hole);
    if (hole.fairways) {
        hole.fairways.forEach(fw => {
            if (fw.points) fw.points.forEach(p => includePt(p.x, p.z));
        });
    }

    if (minX === Infinity) { minX = -150; maxX = 150; minZ = -150; maxZ = 150; }

    let margin = 70;
    minX = Math.max(-window.TERRAIN_SIZE/2, minX - margin);
    maxX = Math.min(window.TERRAIN_SIZE/2, maxX + margin);
    minZ = Math.max(-window.TERRAIN_SIZE/2, minZ - margin);
    maxZ = Math.min(window.TERRAIN_SIZE/2, maxZ + margin);

    let pxMinX = Math.max(0, Math.floor(((minX + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxX = Math.min(4096, Math.ceil(((maxX + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMinY = Math.max(0, Math.floor(((minZ + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxY = Math.min(4096, Math.ceil(((maxZ + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pw = pxMaxX - pxMinX;
    let ph = pxMaxY - pxMinY;

    if (pw > 0 && ph > 0) {
        let ctx = window._arcadePCtx;
        let imgData = ctx.getImageData(pxMinX, pxMinY, pw, ph);
        let d = imgData.data;

        function hexToRgb(h) {
            if (!h) return [74, 120, 43];
            h = h.replace('#', '');
            return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
        }
        let fwRgb = hexToRgb(cfg.fairwayColor || '#7db952');
        let semiRgb = hexToRgb(cfg.semiColor || '#6b9e3d');
        let roughRgb = hexToRgb(roughColor);

        for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i+1], b = d[i+2];
            let dFw = (r - fwRgb[0])**2 + (g - fwRgb[1])**2 + (b - fwRgb[2])**2;
            let dSemi = (r - semiRgb[0])**2 + (g - semiRgb[1])**2 + (b - semiRgb[2])**2;
            if (dFw < 3200 || dSemi < 3200) {
                d[i] = roughRgb[0];
                d[i+1] = roughRgb[1];
                d[i+2] = roughRgb[2];
            }
        }
        ctx.putImageData(imgData, pxMinX, pxMinY);
    }

    // Re-apply legitimate fairway(s)
    if (hole.fairways && hole.fairways.length > 0) {
        window.applyFairwayPipeline(hole, false, true);
    }
    // Re-apply green on top
    if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();
    window.saveLevel();
    window.showBuildToast(isSv ? '🧹 Hålets mark har rensats och återställts!' : '🧹 Hole terrain cleaned & restored!', '#4ade80');
};

// 6. Redraw shape: restores ground and puts points back in interactive drawing mode
window.redrawSmartFairway = function(holeIndex, fairwayIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (fairwayIndex === undefined) fairwayIndex = hole.activeFairwayIndex;
    if (fairwayIndex === null || fairwayIndex === undefined || !hole.fairways[fairwayIndex]) return;

    window.saveUndoState();

    let targetFd = hole.fairways[fairwayIndex];
    let savedPoints = targetFd.points.map(p => ({ x: p.x, y: p.y, z: p.z }));

    window.restoreFairwayBase(hole, true, targetFd);
    if (typeof window.eraseFairwayTexture === 'function') {
        window.eraseFairwayTexture(targetFd);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
    }

    // Remove from array and enter drawing mode with its points
    hole.fairways.splice(fairwayIndex, 1);
    if (hole.fairways.length > 0) {
        hole.fairwayData = hole.fairways[0];
    } else {
        hole.fairwayData = null;
    }
    hole.activeFairwayIndex = null;

    if (hole.fairways.length > 0) {
        window.applyFairwayPipeline(hole, false, true);
    } else if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }

    smartGreenPoints = savedPoints.map(p => new THREE.Vector3(p.x, p.y || 0, p.z));
    window._smartShapeClosed = false;
    updateSmartGreenPreview();

    updateActiveFairwayOutline();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '🔄 Justera form: Dra i punkterna eller lägg till nya' : '🔄 Adjust shape: Drag points or add new ones', '#38bdf8');
};

// 7. Scale entire fairway up or down symmetrically around its centroid
window.scaleSmartFairway = function(holeIndex, factor, fairwayIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (fairwayIndex === undefined) fairwayIndex = hole.activeFairwayIndex;
    if (fairwayIndex === null || fairwayIndex === undefined || !hole.fairways[fairwayIndex]) return;

    let fd = hole.fairways[fairwayIndex];
    if (!fd.points || fd.points.length < 3) return;

    window.saveUndoState();

    let cx = 0, cz = 0;
    for(let pt of fd.points) { cx += pt.x; cz += pt.z; }
    cx /= fd.points.length;
    cz /= fd.points.length;

    let maxDist = 0;
    for(let pt of fd.points) {
        let d = Math.sqrt((pt.x - cx)**2 + (pt.z - cz)**2);
        if (d > maxDist) maxDist = d;
    }
    let newMaxDist = maxDist * factor;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (newMaxDist < 8.0) {
        window.showBuildToast(isSv ? '⚠️ Fairwayen kan inte minskas mer' : '⚠️ Fairway cannot be scaled smaller', '#f59e0b');
        return;
    }
    if (newMaxDist > 300.0) {
        window.showBuildToast(isSv ? '⚠️ Fairwayen har nått maxstorlek' : '⚠️ Fairway has reached max size', '#f59e0b');
        return;
    }

    // 1. Restore pristine ground before modifying points
    window.restoreFairwayBase(hole, true, fd);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
    }

    // 2. Scale all control points outward or inward from centroid
    for(let pt of fd.points) {
        pt.x = cx + (pt.x - cx) * factor;
        pt.z = cz + (pt.z - cz) * factor;
    }

    // 3. Capture clean snapshot for new scaled bounding box
    let margin = (fd.semiRoughWidth || 2.0) + (fd.roughEnabled !== false ? (fd.roughWidth || 5.0) : 0) + 12;
    let snap = window.captureFairwaySnapshot(hole, fd.points, margin);
    fd.baseElevation = snap.baseElevation;
    fd.bbox = snap.bbox;
    fd.origHeights = snap.origHeights;
    fd.origCanvasPixels = snap.origCanvasPixels;

    // 4. Re-apply pipeline with exact same parameters
    window.applyFairwayPipeline(hole, false, true, fd);
    updateActiveFairwayOutline();

    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();

    let area = 0;
    if (fd.points && fd.points.length >= 3) {
        for (let i = 0, j = fd.points.length - 1; i < fd.points.length; j = i++) {
            area += (fd.points[j].x + fd.points[i].x) * (fd.points[j].z - fd.points[i].z);
        }
        area = Math.round(Math.abs(area / 2));
    }
    let fwNum = fairwayIndex + 1;
    let toastMsg = factor > 1
        ? (isSv ? `➕ Fairway ${fwNum} utökad till ~${area} m²` : `➕ Fairway ${fwNum} scaled up to ~${area} m²`)
        : (isSv ? `➖ Fairway ${fwNum} minskad till ~${area} m²` : `➖ Fairway ${fwNum} scaled down to ~${area} m²`);
    window.showBuildToast(toastMsg, '#4ade80');
};

// 8. Move entire fairway to new center coordinates
window.moveSmartFairway = function(holeIndex, newCenterX, newCenterZ, fairwayIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole) return;
    ensureHoleFairways(hole);
    if (fairwayIndex === undefined) fairwayIndex = hole.activeFairwayIndex;
    if (fairwayIndex === null || fairwayIndex === undefined || !hole.fairways[fairwayIndex]) return;

    let fd = hole.fairways[fairwayIndex];
    if (!fd.points || fd.points.length < 3) return;

    window.saveUndoState();

    let oldCx = 0, oldCz = 0;
    for(let pt of fd.points) { oldCx += pt.x; oldCz += pt.z; }
    oldCx /= fd.points.length;
    oldCz /= fd.points.length;

    let dx = newCenterX - oldCx;
    let dz = newCenterZ - oldCz;

    // Restore old ground 100% clean
    window.restoreFairwayBase(hole, true, fd);

    // Shift all points
    for(let pt of fd.points) {
        pt.x += dx;
        pt.z += dz;
    }

    // Capture new snapshot
    let margin = (fd.semiRoughWidth || 2.0) + (fd.roughEnabled !== false ? (fd.roughWidth || 5.0) : 0) + 12;
    let snap = window.captureFairwaySnapshot(hole, fd.points, margin);
    fd.baseElevation = snap.baseElevation;
    fd.bbox = snap.bbox;
    fd.origHeights = snap.origHeights;
    fd.origCanvasPixels = snap.origCanvasPixels;

    window.applyFairwayPipeline(hole, false, true, fd);
    updateActiveFairwayOutline();

    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let fwNum = fairwayIndex + 1;
    window.showBuildToast(isSv ? `✥ Fairway ${fwNum} flyttad!` : `✥ Fairway ${fwNum} moved!`, '#4ade80');
};

// 9. Activate "Move Fairway" picking mode
window.activateMoveFairwayMode = function() {
    window._movingFairwayMode = true;
    window._movingGreenMode = false;
    window._movingFlagMode = false;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let fwNum = (hole && hole.activeFairwayIndex !== null && hole.activeFairwayIndex !== undefined) ? (hole.activeFairwayIndex + 1) : '';
    let msg = isSv 
        ? (`📍 Klicka på kartan där Fairway ${fwNum} ska placeras (Esc för att avbryta)`) 
        : (`📍 Click on map to place Fairway ${fwNum} (Esc to cancel)`);
    window.showBuildToast(msg, '#f59e0b');
};

// 10. Initial Fairway Build triggered from UI button
window.executeSmartFairway = function() {
    if(smartGreenPoints.length < 3) {
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        window.showBuildToast(isSv ? '⚠️ Rita minst 3 punkter för att bygga fairway!' : '⚠️ Draw at least 3 points to build fairway!', '#ef4444');
        return;
    }
    window.saveUndoState();

    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    ensureHoleFairways(hole);

    let difficulty = window._fairwayDifficulty || 'FLAT';
    let mowPattern = window._smartMowPattern || 'SOLID';

    let srSlider = document.getElementById('sf-semirough-width');
    let semiRoughWidth = srSlider ? parseFloat(srSlider.value) : 2.0;

    let roughCb = document.getElementById('sf-rough-cb');
    let roughEnabled = roughCb ? roughCb.checked : true;
    let roughSlider = document.getElementById('sf-rough-width');
    let roughWidth = (roughEnabled && roughSlider) ? parseFloat(roughSlider.value) : 0.0;

    let sharpSlider = document.getElementById('sg-edge-sharpness');
    let sharpness = sharpSlider ? parseInt(sharpSlider.value) : 100;

    let margin = semiRoughWidth + (roughEnabled ? roughWidth : 0) + 12;
    let snap = window.captureFairwaySnapshot(hole, smartGreenPoints, margin);

    let newFairway = {
        id: 'fw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        points: smartGreenPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
        baseElevation: snap.baseElevation,
        bbox: snap.bbox,
        origHeights: snap.origHeights,
        origCanvasPixels: snap.origCanvasPixels,

        difficulty: difficulty,
        semiRoughWidth: semiRoughWidth,
        roughWidth: roughWidth,
        roughEnabled: roughEnabled,
        mowPattern: mowPattern,
        edgeSharpness: sharpness,
        seedOffsetX: (Math.random() - 0.5) * 200,
        seedOffsetZ: (Math.random() - 0.5) * 200
    };

    hole.fairways.push(newFairway);
    hole.activeFairwayIndex = hole.fairways.length - 1;
    hole.fairwayData = hole.fairways[0]; // Mirror primary for backward compatibility

    window.applyFairwayPipeline(hole, true, true, newFairway);
    clearSmartGreen();
    updateActiveFairwayOutline();

    window.saveLevel();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let fwNum = hole.fairways.length;
    window.showBuildToast(isSv ? (`✅ Fairway ${fwNum} byggd!`) : (`✅ Fairway ${fwNum} built!`), '#4ade80');

    window._smartBuildCooldown = true;
    setTimeout(function() { window._smartBuildCooldown = false; }, 500);
};

// === SMART TEE: Flat Tee Box + Auto-Place Markers ===
window.executeSmartTee = function() {
    if(smartGreenPoints.length < 3) return;

    // GATE: Require AimPoint before ANY tee work (paint + markers)
    let _hole = window.courseHoles[window.currentHoleIndex];
    if(!_hole.aimPoint) {
        let curLang = (typeof getLang === 'function') ? getLang() : (window.currentLang || 'sv');
        let msg = (curLang === 'en') ? '🎯 Set Aim Point first! Click "Set Aim Point" in the Tee panel.' : '🎯 Sätt siktpunkt först! Klicka på "Sätt siktpunkt" i Tee-panelen.';
        window.showBuildToast(msg, '#ef4444');
        if (typeof activateAimMode === 'function') {
            activateAimMode();
        }
        return; // Don't clear points — user can retry after setting aim
    }

    window.saveUndoState();

    let cfg = window.CURRENT_BIOME_CONFIG;
    let teeColor = cfg.teeColor || '#7cb54c';

    // Build closed curve
    let curve = new THREE.CatmullRomCurve3(smartGreenPoints, true);
    let numSamples = Math.max(200, smartGreenPoints.length * 40);
    let densePts = curve.getPoints(numSamples);

    // === 1. PAINT: Tee box color ===
    window._arcadePCtx.save();
    let sharpSlider = document.getElementById('sg-edge-sharpness');
    let sharpness = sharpSlider ? parseInt(sharpSlider.value) : 100;
    if(sharpness < 100) {
        let blurPx = Math.round((100 - sharpness) * 0.06);
        if(blurPx > 0) window._arcadePCtx.filter = 'blur(' + blurPx + 'px)';
    }

    window._arcadePCtx.beginPath();
    densePts.forEach((pt, i) => {
        let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
        let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
        if(i === 0) window._arcadePCtx.moveTo(pxX, pxY);
        else window._arcadePCtx.lineTo(pxX, pxY);
    });
    window._arcadePCtx.closePath();
    window._arcadePCtx.fillStyle = teeColor;
    window._arcadePCtx.fill();

    // === MOWING PATTERN OVERLAY (Tee) ===
    let mowPattern = window._smartMowPattern || 'SOLID';
    if (mowPattern !== 'SOLID') {
        paintMowingPattern(window._arcadePCtx, densePts, teeColor, mowPattern);
    }

    window._arcadePCtx.filter = 'none';
    window._arcadePCtx.restore();
    window._arcadeMapTex.needsUpdate = true;
    window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();

    // === 2. TERRAIN: Flat plateau (optionally raised) ===
    let positions = window._arcadePlaneGeo.attributes.position.array;
    let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;

    // Raised Tee settings
    let raiseHeight = 0;
    let blendRadius = 6;
    if (window._raisedTeeActive) {
        let hSlider = document.getElementById('st-raise-height');
        raiseHeight = hSlider ? parseFloat(hSlider.value) : 0.5;
        let bSlider = document.getElementById('st-raise-blend');
        blendRadius = bSlider ? parseFloat(bSlider.value) : 4;
    }

    let pathMinX = Infinity, pathMaxX = -Infinity, pathMinZ = Infinity, pathMaxZ = -Infinity;
    for(let pt of densePts) {
        if(pt.x < pathMinX) pathMinX = pt.x;
        if(pt.x > pathMaxX) pathMaxX = pt.x;
        if(pt.z < pathMinZ) pathMinZ = pt.z;
        if(pt.z > pathMaxZ) pathMaxZ = pt.z;
    }
    let margin = Math.max(6, blendRadius + 2);

    let gxStart = Math.max(0, Math.floor((pathMinX - margin + window.TERRAIN_SIZE/2) / step));
    let gxEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxX + margin + window.TERRAIN_SIZE/2) / step));
    let gzStart = Math.max(0, Math.floor((pathMinZ - margin + window.TERRAIN_SIZE/2) / step));
    let gzEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxZ + margin + window.TERRAIN_SIZE/2) / step));

    let baseH = 0;
    for(let pt of smartGreenPoints) {
        let surf = window.localGetTerrainAt(pt.x, -pt.z);
        baseH += surf ? surf.z : 0;
    }
    baseH /= smartGreenPoints.length;

    // Target height = baseH + raise
    let plateauH = baseH + raiseHeight;

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

    // Single pass: flatten inside polygon to plateauH, blend outside
    for(let gz = gzStart; gz <= gzEnd; gz++) {
        for(let gx = gxStart; gx <= gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS+1) + gx;
            let vx = positions[idx*3];
            let vz = -positions[idx*3+1];
            let isInside = pointInPolygon(vx, vz, densePts);
            let distEdge = distToPolygon(vx, vz, densePts);
            if(!isInside && distEdge > margin) continue;
            let currentH = positions[idx*3+2];

            if(isInside) {
                // Inside polygon: flat plateau at raised height
                positions[idx*3+2] = plateauH;
            } else {
                // Outside: blend from plateau back to natural terrain
                let t = Math.min(1.0, distEdge / blendRadius);
                // Smoothstep for natural hillside
                t = t * t * (3.0 - 2.0 * t);
                // At t=0 (edge): plateauH, at t=1 (far): currentH
                positions[idx*3+2] = plateauH + (currentH - plateauH) * t;
            }
        }
    }

    window._arcadePlaneGeo.attributes.position.needsUpdate = true;
    window._arcadePlaneGeo.computeVertexNormals();
    window._arcadePlaneGeo.computeBoundingBox();
    window._arcadePlaneGeo.computeBoundingSphere();
    if (window._terrainChunks) window._terrainChunks.syncAll();
    window.snapObjectsToGround();

    // === 3. AUTO-PLACE TEE MARKERS ===
    // Determine which tees to place
    let teesToPlace = [];
    // Order: back to front = black, white, yellow, red
    if(document.getElementById('st-tee-black') && document.getElementById('st-tee-black').checked) teesToPlace.push({type: 'black', color: 0x111111});
    if(document.getElementById('st-tee-white') && document.getElementById('st-tee-white').checked) teesToPlace.push({type: 'white', color: 0xffffff});
    if(document.getElementById('st-tee-yellow') && document.getElementById('st-tee-yellow').checked) teesToPlace.push({type: 'yellow', color: 0xfacc15});
    if(document.getElementById('st-tee-red') && document.getElementById('st-tee-red').checked) teesToPlace.push({type: 'red', color: 0xef4444});

    let hole = window.courseHoles[window.currentHoleIndex];

    // AimPoint already verified at top of function

    // Clear unchecked tees ONLY if they are INSIDE this tee box polygon
    // (preserves tees on other tee boxes for multi-stage building)
    let placingTypes = teesToPlace.map(t => t.type);
    ['red','yellow','white','black'].forEach(function(tt) {
        if(!placingTypes.includes(tt) && hole.tees[tt]) {
            let isInsideThisTeeBox = pointInPolygon(hole.tees[tt].x, hole.tees[tt].z, densePts);
            if(isInsideThisTeeBox) {
                if(hole.teeMeshes[tt]) window._arcadeScene.remove(hole.teeMeshes[tt]);
                hole.teeMeshes[tt] = null;
                hole.tees[tt] = null;
            }
        }
    });

    if(teesToPlace.length > 0) {
        // Polygon centroid
        let cx = 0, cz = 0;
        for(let pt of smartGreenPoints) { cx += pt.x; cz += pt.z; }
        cx /= smartGreenPoints.length;
        cz /= smartGreenPoints.length;

        // Direction: always use aimPoint (required above)
        let dirX = hole.aimPoint.x - cx;
        let dirZ = hole.aimPoint.z - cz;
        let dirLen = Math.sqrt(dirX*dirX + dirZ*dirZ) + 0.001;
        dirX /= dirLen; dirZ /= dirLen;

        // Project all points onto aim direction to find extent
        let minProj = Infinity, maxProj = -Infinity;
        for(let pt of smartGreenPoints) {
            let dx = pt.x - cx;
            let dz = pt.z - cz;
            let proj = dx * dirX + dz * dirZ;
            if(proj < minProj) minProj = proj;
            if(proj > maxProj) maxProj = proj;
        }
        let totalLen = maxProj - minProj;
        if(totalLen < 2) totalLen = dirLen * 2;

        let spacing = totalLen / (teesToPlace.length + 1);
        let startX = cx + dirX * minProj;
        let startZ = cz + dirZ * minProj;

        // PRE-FLIGHT CHECK: Would all markers fit inside the polygon?
        let outsideCount = 0;
        for(let i = 0; i < teesToPlace.length; i++) {
            let dist = spacing * (i + 1);
            let tx = startX + dirX * dist;
            let tz = startZ + dirZ * dist;
            if(!pointInPolygon(tx, tz, densePts)) outsideCount++;
        }

        if(outsideCount > 0) {
            window.showBuildToast('⚠️ Tee box too small for ' + teesToPlace.length + ' markers! Make it bigger or uncheck some tees.', '#ef4444');
            return; // Abort — keep points so user can adjust
        }

        // All markers fit — calculate all positions first
        let teeRot = Math.atan2(dirX, dirZ);
        let teePositions = [];
        for(let i = 0; i < teesToPlace.length; i++) {
            let dist = spacing * (i + 1);
            let tx = startX + dirX * dist;
            let tz = startZ + dirZ * dist;
            let ty = plateauH;
            teePositions.push({x: tx, y: ty, z: tz});
        }

        // Sort positions: FURTHEST from aim/flag FIRST (back of tee box)
        // teesToPlace is already in back-to-front order: [black, white, yellow, red]
        // So position[0] (furthest) → teesToPlace[0] (black), etc.
        let targetX = cx, targetZ = cz;
        if(hole.aimPoint) { targetX = hole.aimPoint.x; targetZ = hole.aimPoint.z; }
        else if(hole.flag) { targetX = hole.flag.x; targetZ = hole.flag.z; }
        teePositions.sort(function(a, b) {
            let da = (a.x-targetX)*(a.x-targetX) + (a.z-targetZ)*(a.z-targetZ);
            let db = (b.x-targetX)*(b.x-targetX) + (b.z-targetZ)*(b.z-targetZ);
            return db - da; // FURTHEST first
        });

        // Direct 1:1 mapping — works with any subset of tees (1, 2, 3, or 4)
        for(let i = 0; i < teesToPlace.length; i++) {
            let t = teesToPlace[i];
            let pos = teePositions[i];

            if(hole.teeMeshes[t.type]) window._arcadeScene.remove(hole.teeMeshes[t.type]);

            hole.tees[t.type] = { x: pos.x, y: pos.y, z: pos.z, rot: teeRot };
            hole.teeMeshes[t.type] = window.createTeeObject(pos.x, pos.y, pos.z, t.color);
            hole.teeMeshes[t.type].rotation.y = teeRot;
        }
    }

    if(window.slopeOverlayActive) window.updateSlopeOverlay();
    if(window.contourLinesActive) window.updateContourLines();
    if(window.elevationHeatmapActive) window.updateElevationHeatmap();

    clearSmartGreen();
    window.saveLevel();

    // Auto-switch to AIM mode so user can set/adjust aim point for tee orientation
    if(!hole.aimPoint) {
        setTimeout(function() {
            setSmartBuilderType('AIM');
            window.showBuildToast('🎯 Click to set Aim Point — tees will auto-sort', '#f59e0b');
        }, 300);
    } else {
        // AimPoint exists — re-sort tees relative to it
        resortTeesForAimPoint(hole);
        window.autoAdvanceHole();
    }
};

window.buildFenceMesh = function(pathType, splinePoints) {
    let curve = new THREE.CatmullRomCurve3(splinePoints);
    let len = curve.getLength();
    
    let spacing = pathType === 'WOOD_FENCE' ? 3.0 : (pathType === 'STONE_WALL' ? 2.0 : 5.0);
    let count = Math.max(2, Math.floor(len / spacing));
    let pts = curve.getSpacedPoints(count);
    
    let pMesh = new THREE.Group();
    let bigSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), 99999);
    
    if (pathType === 'OB_STAKES') {
        let geo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8);
        geo.translate(0, 0.6, 0); // Origin at bottom
        let mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        let instMesh = new THREE.InstancedMesh(geo, mat, pts.length);
        instMesh.castShadow = true;
        instMesh.receiveShadow = true;
        instMesh.boundingSphere = bigSphere;
        
        let dummy = new THREE.Object3D();
        for(let i=0; i<pts.length; i++) {
            let pt = pts[i];
            let surf = window.localGetTerrainAt(pt.x, -pt.z);
            pt.y = surf ? surf.z : 0;
            
            dummy.position.copy(pt);
            dummy.rotation.set(0,0,0);
            dummy.scale.set(1,1,1);
            dummy.updateMatrix();
            instMesh.setMatrixAt(i, dummy.matrix);
        }
        instMesh.instanceMatrix.needsUpdate = true;
        pMesh.add(instMesh);
        
    } else if (pathType === 'WOOD_FENCE') {
        let postGeo = new THREE.BoxGeometry(0.12, 1.2, 0.12);
        postGeo.translate(0, 0.6, 0);
        let woodMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
        let postMesh = new THREE.InstancedMesh(postGeo, woodMat, pts.length);
        postMesh.castShadow = true;
        postMesh.receiveShadow = true;
        postMesh.boundingSphere = bigSphere;
        
        let beamGeo = new THREE.BoxGeometry(0.05, 0.12, 1.0); // 1.0 length on Z axis
        let beamMesh = new THREE.InstancedMesh(beamGeo, woodMat, pts.length - 1);
        beamMesh.castShadow = true;
        beamMesh.receiveShadow = true;
        beamMesh.boundingSphere = bigSphere;
        
        let dummy = new THREE.Object3D();
        for(let i=0; i<pts.length; i++) {
            let pt = pts[i].clone(); // clone so we don't modify the curve points array
            let surf = window.localGetTerrainAt(pt.x, -pt.z);
            pt.y = surf ? surf.z : 0;
            
            dummy.position.copy(pt);
            dummy.rotation.set(0,0,0);
            dummy.scale.set(1,1,1);
            dummy.updateMatrix();
            postMesh.setMatrixAt(i, dummy.matrix);
            
            if (i < pts.length - 1) {
                let nextPt = pts[i+1].clone();
                let nextSurf = window.localGetTerrainAt(nextPt.x, -nextPt.z);
                nextPt.y = nextSurf ? nextSurf.z : 0;
                
                let midPt = pt.clone().lerp(nextPt, 0.5);
                let dist = pt.distanceTo(nextPt);
                
                dummy.position.copy(midPt);
                dummy.position.y += 0.85; // Beam height
                
                // LookAt aligns local Z axis towards target
                dummy.lookAt(nextPt.x, nextPt.y + 0.85, nextPt.z);
                dummy.scale.set(1, 1, dist); // Stretch beam to fill the gap exactly
                dummy.updateMatrix();
                beamMesh.setMatrixAt(i, dummy.matrix);
            }
        }
        postMesh.instanceMatrix.needsUpdate = true;
        beamMesh.instanceMatrix.needsUpdate = true;
        pMesh.add(postMesh);
        pMesh.add(beamMesh);
    } else if (pathType === 'STONE_WALL') {
        // Build procedural neat cut-stone wall
        let stoneGeo = new THREE.BoxGeometry(1, 1, 1); 
        let stoneMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa }); 
        
        // Calculate total stones needed
        let totalStones = 0;
        let segmentData = [];
        for(let i=0; i<pts.length - 1; i++) {
            let pt = pts[i].clone();
            let nextPt = pts[i+1].clone();
            
            let surf = window.localGetTerrainAt(pt.x, -pt.z);
            pt.y = surf ? surf.z : 0;
            let nextSurf = window.localGetTerrainAt(nextPt.x, -nextPt.z);
            nextPt.y = nextSurf ? nextSurf.z : 0;
            
            let dist = pt.distanceTo(nextPt);
            
            let layers = 4; // 3 base layers + 1 cap layer
            let stoneLength = 0.6;
            let stonesPerLayer = Math.max(1, Math.floor(dist / stoneLength));
            
            totalStones += layers * stonesPerLayer;
            segmentData.push({ pt, nextPt, dist, layers, stonesPerLayer });
        }
        
        let stoneMesh = new THREE.InstancedMesh(stoneGeo, stoneMat, totalStones);
        stoneMesh.castShadow = true;
        stoneMesh.receiveShadow = true;
        stoneMesh.boundingSphere = bigSphere;
        
        let dummy = new THREE.Object3D();
        let colorDummy = new THREE.Color();
        let stoneIdx = 0;
        
        for(let segIdx=0; segIdx<segmentData.length; segIdx++) {
            let seg = segmentData[segIdx];
            let dir = seg.nextPt.clone().sub(seg.pt).normalize();
            
            // --- Stones ---
            for(let L=0; L<seg.layers; L++) {
                let isCapLayer = (L === seg.layers - 1);
                
                // Base stones: 0.21 high. Cap stone: 0.15 high
                let stoneH = isCapLayer ? 0.15 : 0.21;
                
                let yOffset = (L * 0.21) + (stoneH / 2); // Stack perfectly on top
                
                // Offset every other base layer by half a stone for running bond pattern
                let layerOffsetRatio = (!isCapLayer && L % 2 === 1) ? 0.5 : 0;
                
                for(let s=0; s<seg.stonesPerLayer; s++) {
                    let progress = (s + layerOffsetRatio) / seg.stonesPerLayer;
                    if(progress >= 1.0) progress -= 1.0;
                    
                    let pos = seg.pt.clone().lerp(seg.nextPt, progress);
                    let surf = window.localGetTerrainAt(pos.x, -pos.z);
                    pos.y = (surf ? surf.z : pos.y) + yOffset;
                    
                    // Very subtle rotations to simulate imperfect hand-carved blocks
                    let rotY = (Math.random() - 0.5) * 0.05;
                    let rotX = (Math.random() - 0.5) * 0.02;
                    let rotZ = (Math.random() - 0.5) * 0.02;
                    
                    // Cap layer is slightly wider than base layers
                    let baseWidth = isCapLayer ? 0.45 : 0.35;
                    
                    let scaleX = baseWidth + (Math.random() - 0.5) * 0.02; // width
                    let scaleY = stoneH + (Math.random() - 0.5) * 0.01; // height
                    
                    dummy.position.copy(pos);
                    dummy.lookAt(pos.clone().add(dir));
                    dummy.rotateX(rotX);
                    dummy.rotateY(rotY);
                    dummy.rotateZ(rotZ);
                    
                    // Stretch Z to fill the segment, but leave a 2% gap for crevice shadows
                    let exactZ = seg.dist / seg.stonesPerLayer;
                    let scaleZ = exactZ * 0.98;
                    
                    dummy.scale.set(scaleX, scaleY, scaleZ);
                    
                    dummy.updateMatrix();
                    stoneMesh.setMatrixAt(stoneIdx, dummy.matrix);
                    
                    // Lighter, warmer classic stone colors
                    let shade = 0.65 + Math.random() * 0.2; 
                    let r = shade;
                    let g = shade * 0.95; // slightly less green
                    let b = shade * 0.9;  // less blue for warm tone
                    colorDummy.setRGB(r, g, b);
                    stoneMesh.setColorAt(stoneIdx, colorDummy);
                    
                    stoneIdx++;
                }
            }
        }
        stoneMesh.instanceMatrix.needsUpdate = true;
        if (stoneMesh.instanceColor) stoneMesh.instanceColor.needsUpdate = true;
        pMesh.add(stoneMesh);
    } else if (pathType === 'HEDGE') {
        let bushGeo = new THREE.SphereGeometry(0.7, 8, 8);
        bushGeo.scale(1.2, 0.9, 1.0);
        let mat = new THREE.MeshLambertMaterial({ color: 0x1e5631 });
        let hedgeSpacing = 1.0;
        let countH = Math.max(2, Math.floor(len / hedgeSpacing));
        let ptsH = curve.getSpacedPoints(countH);
        
        let instMesh = new THREE.InstancedMesh(bushGeo, mat, ptsH.length);
        instMesh.castShadow = true;
        instMesh.receiveShadow = true;
        instMesh.boundingSphere = bigSphere;
        
        let dummy = new THREE.Object3D();
        for (let i = 0; i < ptsH.length; i++) {
            let pt = ptsH[i].clone();
            let surf = window.localGetTerrainAt(pt.x, -pt.z);
            pt.y = (surf ? surf.z : 0) + 0.45;
            
            dummy.position.copy(pt);
            dummy.rotation.set((Math.random()-0.5)*0.2, Math.random()*Math.PI*2, (Math.random()-0.5)*0.2);
            let s = 0.85 + Math.random() * 0.3;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            instMesh.setMatrixAt(i, dummy.matrix);
        }
        instMesh.instanceMatrix.needsUpdate = true;
        pMesh.add(instMesh);
    }
    
    pMesh.userData.collisionPts = pts.map(p => ({x:p.x, y:p.y, z:p.z}));
    return pMesh;
};

window.executeSplinePath = function(pathType) {
    if(splinePoints.length < 2) return;
    window.saveUndoState();
    
    let pMesh = window.buildFenceMesh(pathType, splinePoints);
    
    let rObj = {
        id: Math.random().toString(36).substr(2, 9),
        type: pathType,
        mesh: pMesh,
        splineData: splinePoints.map(p => ({x:p.x, y:p.y, z:p.z})),
        collisionData: pMesh.userData.collisionPts || []
    };
    window._arcadeScene.add(pMesh);
    if (!window.courseHoles[window.currentHoleIndex].envObjects) window.courseHoles[window.currentHoleIndex].envObjects = [];
    window.courseHoles[window.currentHoleIndex].envObjects.push(rObj);
    
    let labels = { 'WOOD_FENCE': 'Wood Fence', 'STONE_WALL': 'Stone Wall', 'OB_STAKES': 'O.B. Stakes', 'HEDGE': 'Leaf Hedge' };
    let name = labels[pathType] || 'Fence/Wall';
    if(typeof window.showBuildToast === 'function') window.showBuildToast('🚧 ' + name + ' placed!', '#38bdf8');
    
    window.clearSpline();
};

// === PARAMETRIC LIVE GREEN ENGINE ===

// Helper: Point-in-polygon test (ray casting)
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
window.pointInPolygon = pointInPolygon;

// Helper: Distance from point to nearest polygon edge
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
window.distToPolygon = distToPolygon;

// Helper: Generate dense smooth curve points from control points
function getDenseGreenPoints(points, tension) {
    let pts3 = points.map(p => new THREE.Vector3(p.x, p.y || 0, p.z));
    let curTension = (tension !== undefined) ? tension : 0.5;
    let curve = new THREE.CatmullRomCurve3(pts3, true, 'catmullrom', curTension);
    let numSamples = Math.max(200, points.length * 40);
    return curve.getPoints(numSamples);
}
window.getDenseGreenPoints = getDenseGreenPoints;

// Capture baseline snapshot of natural terrain & canvas before green is built
window.captureGreenSnapshot = function(hole, points, margin) {
    margin = Math.max(25, margin || 25);
    let densePts = getDenseGreenPoints(points);
    let pathMinX = Infinity, pathMaxX = -Infinity, pathMinZ = Infinity, pathMaxZ = -Infinity;
    for(let pt of densePts) {
        if(pt.x < pathMinX) pathMinX = pt.x;
        if(pt.x > pathMaxX) pathMaxX = pt.x;
        if(pt.z < pathMinZ) pathMinZ = pt.z;
        if(pt.z > pathMaxZ) pathMaxZ = pt.z;
    }

    let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;
    let gxStart = Math.max(0, Math.floor((pathMinX - margin + window.TERRAIN_SIZE/2) / step));
    let gxEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxX + margin + window.TERRAIN_SIZE/2) / step));
    let gzStart = Math.max(0, Math.floor((pathMinZ - margin + window.TERRAIN_SIZE/2) / step));
    let gzEnd = Math.min(window.TERRAIN_SEGS, Math.ceil((pathMaxZ + margin + window.TERRAIN_SIZE/2) / step));
    let gWidth = gxEnd - gxStart + 1;
    let gHeight = gzEnd - gzStart + 1;

    // Texture snapshot covers enough margin for foregreen ring (max 5m) + blur, avoiding surrounding terrain overwrites
    let texMargin = 8.0;
    let pxMinX = Math.max(0, Math.floor(((pathMinX - texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxX = Math.min(4096, Math.ceil(((pathMaxX + texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMinY = Math.max(0, Math.floor(((pathMinZ - texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pxMaxY = Math.min(4096, Math.ceil(((pathMaxZ + texMargin + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096));
    let pw = Math.max(1, pxMaxX - pxMinX);
    let ph = Math.max(1, pxMaxY - pxMinY);

    let positions = window._arcadePlaneGeo.attributes.position.array;
    let origHeights = new Float32Array(gWidth * gHeight);
    for(let gz = gzStart; gz <= gzEnd; gz++) {
        for(let gx = gxStart; gx <= gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS+1) + gx;
            let oi = (gz - gzStart) * gWidth + (gx - gxStart);
            origHeights[oi] = positions[idx*3+2];
        }
    }

    let origCanvasPixels = null;
    if (window._arcadePCtx) {
        origCanvasPixels = window._arcadePCtx.getImageData(pxMinX, pxMinY, pw, ph);
    }

    let baseH = 0;
    for(let pt of points) {
        let h = (typeof window.getTerrainHeight === 'function')
            ? window.getTerrainHeight(pt.x, pt.z)
            : (window.localGetTerrainAt ? (window.localGetTerrainAt(pt.x, -pt.z) || {}).z || 0 : 0);
        baseH += h;
    }
    baseH /= Math.max(1, points.length);

    return {
        baseElevation: baseH,
        bbox: {
            gxStart, gxEnd, gzStart, gzEnd,
            gWidth, gHeight,
            pxMinX, pxMaxX, pxMinY, pxMaxY,
            pw, ph, margin
        },
        origHeights: origHeights,
        origCanvasPixels: origCanvasPixels
    };
};

// 1.4. Repair any legacy Deep Rough stain left around green by old bugs
function repairStainedDeepRough(hole, gd, densePts) {
    if (!gd || !gd.bbox || !window._arcadePCtx) return;
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let roughHex = cfg.roughColor || '#4a782b';
    let fescueHex = cfg.fescueColor || '#2d4c1a';

    let [targetR, targetG, targetB] = sbHexToRgb(roughHex);
    let [fR, fG, fB] = sbHexToRgb(fescueHex);

    let pxMinX = gd.bbox.pxMinX;
    let pxMinY = gd.bbox.pxMinY;
    let pw = gd.bbox.pw;
    let ph = gd.bbox.ph;
    if (pw <= 0 || ph <= 0) return;

    function fixImageData(imgData) {
        let d = imgData.data;
        let modified = false;
        for (let py = 0; py < ph; py++) {
            for (let px = 0; px < pw; px++) {
                let canvasX = pxMinX + px;
                let canvasY = pxMinY + py;
                let worldX = (canvasX / 4096) * window.TERRAIN_SIZE - (window.TERRAIN_SIZE / 2);
                let worldZ = (canvasY / 4096) * window.TERRAIN_SIZE - (window.TERRAIN_SIZE / 2);

                // Only repair outside the green complex (densePts)
                if (pointInPolygon(worldX, worldZ, densePts)) continue;

                let idx = (py * pw + px) * 4;
                let r = d[idx], g = d[idx+1], b = d[idx+2];
                let distFescue = (r - fR)**2 + (g - fG)**2 + (b - fB)**2;
                if (distFescue < 3000) {
                    d[idx]   = targetR;
                    d[idx+1] = targetG;
                    d[idx+2] = targetB;
                    modified = true;
                }
            }
        }
        return modified;
    }

    if (gd.origCanvasPixels) {
        fixImageData(gd.origCanvasPixels);
    }
    let liveImg = window._arcadePCtx.getImageData(pxMinX, pxMinY, pw, ph);
    if (fixImageData(liveImg)) {
        window._arcadePCtx.putImageData(liveImg, pxMinX, pxMinY);
    }
}

// 1.5. Cleanly erase a green's footprint from 2D canvas texture
window.eraseGreenTexture = function(gd, hole) {
    if (!gd || !gd.points || !window._arcadePCtx) return;
    let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
    let densePts = (typeof getDenseGreenPoints === 'function') ? getDenseGreenPoints(gd.points, tension) : gd.points;
    if (!densePts || densePts.length < 3) return;

    let baseGroundColor = getBaseGroundColor(hole);
    let ctx = window._arcadePCtx;
    ctx.save();
    ctx.filter = 'none';

    // Foregreen is inside densePts, so erase only inside densePts without expanding outward
    ctx.beginPath();
    densePts.forEach((pt, i) => {
        let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY);
        else ctx.lineTo(pxX, pxY);
    });
    ctx.closePath();
    ctx.fillStyle = baseGroundColor;
    ctx.fill();

    ctx.restore();
};

// 2. Restore pristine baseline ground & texture before applying modified parameters
window.restoreGreenBase = function(hole, restoreTexture, targetGd, isDeleting) {
    if (restoreTexture === undefined) restoreTexture = true;
    if (!hole || !hole.greenData) return;
    let gd = targetGd || hole.greenData;
    if (!gd || !gd.bbox) return;

    let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
    let densePts = (gd.densePts && gd.densePts.length >= 3) ? gd.densePts : ((gd.points && gd.points.length >= 3 && typeof getDenseGreenPoints === 'function') ? getDenseGreenPoints(gd.points, tension) : null);
    let curBlend = (gd.blendDistance !== undefined) ? gd.blendDistance : 8.0;
    let maxReach = Math.max(curBlend, (gd._maxBlendDistance || 0)) + 3.0;

    // 1. Restore vertex heights across organic green influence zone without leaving plateau gaps or rectangular scars
    if (gd.origHeights && window._arcadePlaneGeo) {
        let positions = window._arcadePlaneGeo.attributes.position.array;
        let gWidth = gd.bbox.gWidth;

        for(let gz = gd.bbox.gzStart; gz <= gd.bbox.gzEnd; gz++) {
            for(let gx = gd.bbox.gxStart; gx <= gd.bbox.gxEnd; gx++) {
                let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                let vx = positions[idx*3];
                let vz = -positions[idx*3+1];

                let isInside = densePts ? pointInPolygon(vx, vz, densePts) : false;
                let distEdge = isInside ? 0 : (densePts ? distToPolygon(vx, vz, densePts) : 0);

                // Organic mask: Only restore vertices within the green's actual influence radius!
                if (densePts && distEdge > maxReach) continue;

                let oi = (gz - gd.bbox.gzStart) * gWidth + (gx - gd.bbox.gxStart);
                if (oi >= 0 && oi < gd.origHeights.length) {
                    // Water-awareness: If this vertex is currently water and outside the putting green,
                    // do NOT stomp it back to dry-land snapshot height! Preserve the lake bed.
                    if (window.waterData && window.waterData[idx] > -90 && !isInside) {
                        // Keep submerged bed intact
                    } else {
                        positions[idx*3+2] = gd.origHeights[oi];
                    }
                }
            }
        }

        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
        if (window._terrainChunks) {
            window._terrainChunks.syncAll();
        }
    }

    // 2. Restore 2D canvas texture: cleanly erase green footprint or restore clipped snapshot
    if (restoreTexture && window._arcadePCtx) {
        if (gd.origCanvasPixels && densePts && densePts.length >= 3 && gd.bbox.pw > 0 && gd.bbox.ph > 0) {
            let ctx = window._arcadePCtx;
            if (!window._greenSnapCanvas) {
                window._greenSnapCanvas = document.createElement('canvas');
            }
            window._greenSnapCanvas.width = gd.bbox.pw;
            window._greenSnapCanvas.height = gd.bbox.ph;
            let sCtx = window._greenSnapCanvas.getContext('2d');
            sCtx.putImageData(gd.origCanvasPixels, 0, 0);

            ctx.save();
            ctx.beginPath();
            densePts.forEach((pt, i) => {
                let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
                if (i === 0) ctx.moveTo(pxX, pxY);
                else ctx.lineTo(pxX, pxY);
            });
            ctx.closePath();
            ctx.clip(); // ONLY restore pixels INSIDE the green polygon!
            ctx.drawImage(window._greenSnapCanvas, gd.bbox.pxMinX, gd.bbox.pxMinY);
            ctx.restore();
        } else if (typeof window.eraseGreenTexture === 'function') {
            window.eraseGreenTexture(gd, hole);
        }

        // Re-layer underlying fairway and bunker ONLY when green is explicitly deleted or redrawn (isDeleting === true)
        if (isDeleting && !window._isApplyingGreenPipeline) {
            if (hole.fairways && hole.fairways.length > 0 && typeof window.applyFairwayPipeline === 'function') {
                window.applyFairwayPipeline(hole, false, true);
            }
            if (hole.bunkers && hole.bunkers.length > 0 && typeof window.applyBunkerPipeline === 'function') {
                window.applyBunkerPipeline(hole, false, true);
            }
        }

        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
        window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
        if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
        if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
    }
};

// Apply full green pipeline (Painting + Sculpting + Flag update)
window.applyGreenPipeline = function(hole, isInitial, updateTexture) {
    if (!hole || !hole.greenData) return;
    if (window._isApplyingGreenPipeline) return;
    window._isApplyingGreenPipeline = true;
    try {
        let gd = hole.greenData;
        if (updateTexture === undefined) updateTexture = true;

        // 1. Reset ground vertex heights to pristine baseline (and erase old canvas footprint if updating texture)
        window.restoreGreenBase(hole, updateTexture, undefined, false);

        let cfg = window.CURRENT_BIOME_CONFIG || {};
        let greenColor = cfg.greenColor || '#98ce68';
        let foregreenColor = cfg.foregreenColor || '#8bc45d';

        let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
        let densePts = getDenseGreenPoints(gd.points, tension);
        gd.densePts = densePts;

        // 1.5. Repair any legacy Deep Rough stain outside green
        if (updateTexture && window._arcadePCtx) {
            repairStainedDeepRough(hole, gd, densePts);
        }

    // === PAINT PASS ===
    if (updateTexture && window._arcadePCtx) {
        window._arcadePCtx.save();

        let sharpness = gd.edgeSharpness !== undefined ? gd.edgeSharpness : 100;
        if (sharpness < 100) {
            let blurPx = Math.round((100 - sharpness) * 0.06);
            if (blurPx > 0) window._arcadePCtx.filter = 'blur(' + blurPx + 'px)';
        }

        // Foregreen och green skapas FRÅN BOLLARNA OCH INÅT.
        // Utanför bollarna rör man ej underlaget!
        let fgWidth = gd.foregreenWidth !== undefined ? gd.foregreenWidth : 1.0;

        if (fgWidth > 0.05) {
            // 1. Fyll hela ytan innanför bollarna (densePts) med FOREGREEN
            window._arcadePCtx.beginPath();
            densePts.forEach((pt, i) => {
                let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                if (i === 0) window._arcadePCtx.moveTo(pxX, pxY);
                else window._arcadePCtx.lineTo(pxX, pxY);
            });
            window._arcadePCtx.closePath();
            window._arcadePCtx.fillStyle = foregreenColor;
            window._arcadePCtx.fill();

            // 2. Fyll den inre ytan (krymt inåt med fgWidth) med GREEN (puttyta)
            let innerPts = insetPolygon(densePts, fgWidth);
            gd.innerDensePts = innerPts;

            window._arcadePCtx.beginPath();
            innerPts.forEach((pt, i) => {
                let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                if (i === 0) window._arcadePCtx.moveTo(pxX, pxY);
                else window._arcadePCtx.lineTo(pxX, pxY);
            });
            window._arcadePCtx.closePath();
            window._arcadePCtx.fillStyle = greenColor;
            window._arcadePCtx.fill();

            // 3. Mowing pattern overlay på den inre greenen
            let mowPattern = gd.mowPattern || 'SOLID';
            if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
                paintMowingPattern(window._arcadePCtx, innerPts, greenColor, mowPattern);
            }
        } else {
            // Inget foregreen: hela ytan innanför bollarna är GREEN
            gd.innerDensePts = densePts;

            window._arcadePCtx.beginPath();
            densePts.forEach((pt, i) => {
                let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                if (i === 0) window._arcadePCtx.moveTo(pxX, pxY);
                else window._arcadePCtx.lineTo(pxX, pxY);
            });
            window._arcadePCtx.closePath();
            window._arcadePCtx.fillStyle = greenColor;
            window._arcadePCtx.fill();

            let mowPattern = gd.mowPattern || 'SOLID';
            if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
                paintMowingPattern(window._arcadePCtx, densePts, greenColor, mowPattern);
            }
        }

        window._arcadePCtx.filter = 'none';
        window._arcadePCtx.restore();

        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
        window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(500);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }

    // === SCULPT PASS ===
    let positions = window._arcadePlaneGeo.attributes.position.array;
    let baseH = gd.baseElevation;
    let elevationOffset = gd.elevationOffset || 0.0;
    let blendDistance = gd.blendDistance !== undefined ? gd.blendDistance : 8.0;
    gd._maxBlendDistance = Math.max(gd._maxBlendDistance || 0, blendDistance);
    let fgWidth = gd.foregreenWidth !== undefined ? gd.foregreenWidth : 1.0;

    let polyCentX = 0, polyCentZ = 0;
    for (let p of densePts) { polyCentX += p.x; polyCentZ += p.z; }
    polyCentX /= densePts.length; polyCentZ /= densePts.length;

    // Tilt calculation
    let tiltDirX = 0, tiltDirZ = 0, tiltMaxDist = 1;
    let tiltEnabled = (gd.tiltPct !== undefined && gd.tiltPct > 0);
    if (tiltEnabled) {
        if (gd.tiltToFlag !== false && hole.flag) {
            let fx = hole.flag.x !== undefined ? hole.flag.x : hole.flag.position.x;
            let fz = hole.flag.z !== undefined ? hole.flag.z : hole.flag.position.z;
            tiltDirX = fx - polyCentX;
            tiltDirZ = fz - polyCentZ;
        } else if (gd.tiltAngle !== undefined) {
            tiltDirX = Math.sin(gd.tiltAngle);
            tiltDirZ = Math.cos(gd.tiltAngle);
        } else if (gd.tiltAim && hole.aimPoint) {
            tiltDirX = hole.aimPoint.x - polyCentX;
            tiltDirZ = hole.aimPoint.z - polyCentZ;
        }
        let len = Math.sqrt(tiltDirX * tiltDirX + tiltDirZ * tiltDirZ);
        if (len > 0) { tiltDirX /= len; tiltDirZ /= len; }
        tiltMaxDist = 0;
        for (let p of densePts) {
            let d = (p.x - polyCentX) * tiltDirX + (p.z - polyCentZ) * tiltDirZ;
            if (Math.abs(d) > tiltMaxDist) tiltMaxDist = Math.abs(d);
        }
        if (tiltMaxDist < 1) tiltMaxDist = 1;
    }

    let gxStart = gd.bbox.gxStart;
    let gxEnd = gd.bbox.gxEnd;
    let gzStart = gd.bbox.gzStart;
    let gzEnd = gd.bbox.gzEnd;
    let gWidth = gd.bbox.gWidth;
    let origHeights = gd.origHeights;

    // PASS 1: Plateau Flattening / Elevation
    for(let gz = gzStart; gz <= gzEnd; gz++) {
        for(let gx = gxStart; gx <= gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS+1) + gx;
            let vx = positions[idx*3];
            let vz = -positions[idx*3+1];

            let isInside = pointInPolygon(vx, vz, densePts);
            let distEdge = distToPolygon(vx, vz, densePts);
            let signedDist = isInside ? -distEdge : distEdge;

            if (signedDist > blendDistance) continue;

            let tiltVal = 0;
            if (tiltEnabled) {
                let proj = (vx - polyCentX) * tiltDirX + (vz - polyCentZ) * tiltDirZ;
                tiltVal = (proj / tiltMaxDist) * tiltMaxDist * (gd.tiltPct || 0.02);
            }
            let targetH = baseH + elevationOffset + tiltVal;

            let oi = (gz - gzStart) * gWidth + (gx - gxStart);
            let originalH = origHeights[oi];

            // Water-awareness: If vertex is part of a water body and outside the putting green,
            // blend down into the lake bed instead of dry land above water
            if (window.waterData && window.waterData[idx] > -90 && !isInside) {
                let waterLevel = window.waterData[idx];
                let currentBed = positions[idx*3+2];
                let bedH = (currentBed < waterLevel) ? currentBed : (waterLevel - 2.5);
                originalH = Math.min(originalH, bedH);
            }

            let influence = 0;
            if (signedDist <= 0) {
                influence = 1.0;
            } else if (signedDist <= blendDistance) {
                let t = signedDist / blendDistance;
                influence = 1.0 - t;
                influence = influence * influence * (3.0 - 2.0 * influence); // cubic smoothstep
            }

            if (influence > 0) {
                positions[idx*3+2] = originalH + (targetH - originalH) * influence;
            }
        }
    }

    // PASS 2: Laplacian Edge Smoothing
    let _smoothStride = window.TERRAIN_SEGS + 1;
    let smGxStart = Math.max(0, gxStart - 2);
    let smGxEnd = Math.min(window.TERRAIN_SEGS, gxEnd + 2);
    let smGzStart = Math.max(0, gzStart - 2);
    let smGzEnd = Math.min(window.TERRAIN_SEGS, gzEnd + 2);

    for(let smPass = 0; smPass < 5; smPass++) {
        let tempHeights = new Float32Array(positions.length / 3);
        for (let i = 0; i < tempHeights.length; i++) tempHeights[i] = positions[i*3 + 2];

        for(let gz = smGzStart; gz <= smGzEnd; gz++) {
            for(let gx = smGxStart; gx <= smGxEnd; gx++) {
                let idx = gz * _smoothStride + gx;
                let vx = positions[idx*3];
                let vz = -positions[idx*3+1];

                let isInside = pointInPolygon(vx, vz, densePts);
                let distEdge = distToPolygon(vx, vz, densePts);
                let signedDist = isInside ? -distEdge : distEdge;

                if (signedDist > -2.0 && signedDist < blendDistance + 2.0) {
                    let nCount = 0;
                    let nSum = 0;
                    if (gz > 0) { nSum += tempHeights[(gz-1)*_smoothStride + gx]; nCount++; }
                    if (gz < window.TERRAIN_SEGS) { nSum += tempHeights[(gz+1)*_smoothStride + gx]; nCount++; }
                    if (gx > 0) { nSum += tempHeights[gz*_smoothStride + gx-1]; nCount++; }
                    if (gx < window.TERRAIN_SEGS) { nSum += tempHeights[gz*_smoothStride + gx+1]; nCount++; }
                    
                    if (nCount > 0) {
                        let localAvg = nSum / nCount;
                        let smoothStrength = 0.5;
                        positions[idx*3 + 2] += (localAvg - tempHeights[idx]) * smoothStrength;
                    }
                }
            }
        }
    }

    // PASS 3: Difficulty Contours
    let difficulty = gd.difficulty || 'FLAT';
    if (difficulty !== 'FLAT') {
        let sOffX = gd.seedOffsetX || 0;
        let sOffZ = gd.seedOffsetZ || 0;
        for(let gz = gzStart; gz <= gzEnd; gz++) {
            for(let gx = gxStart; gx <= gxEnd; gx++) {
                let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                let vx = positions[idx*3];
                let vz = -positions[idx*3+1];

                let isInside = pointInPolygon(vx, vz, densePts);
                if (!isInside) continue;

                let undulation = 0;
                let seedX = vx + sOffX;
                let seedZ = vz + sOffZ;

                if(difficulty === 'EASY') {
                    undulation += Math.sin(seedX * 0.1) * Math.cos(seedZ * 0.1) * 0.10;
                } else if(difficulty === 'MED') {
                    undulation += Math.sin(seedX * 0.12) * Math.cos(seedZ * 0.12) * 0.18;
                    undulation += Math.sin(seedX * 0.07 + seedZ * 0.05) * 0.08;
                } else if(difficulty === 'HARD') {
                    undulation += Math.sin(seedX * 0.15) * Math.cos(seedZ * 0.12) * 0.22
                                + Math.sin(seedZ * 0.25 + seedX * 0.08) * 0.06
                                + Math.cos(seedX * 0.20) * Math.sin(seedZ * 0.18) * 0.05;
                }

                let distEdge = distToPolygon(vx, vz, densePts);
                let blendWidth = 2.5; 
                if (distEdge < blendWidth) {
                    let t = distEdge / blendWidth;
                    let smoothT = t * t * (3 - 2 * t);
                    positions[idx*3+2] += undulation * smoothT;
                } else {
                    positions[idx*3+2] += undulation;
                }
            }
        }
    }

    // Sync mesh geometry
    window._arcadePlaneGeo.attributes.position.needsUpdate = true;
    window._arcadePlaneGeo.computeVertexNormals();
    window._arcadePlaneGeo.computeBoundingBox();
    window._arcadePlaneGeo.computeBoundingSphere();
    if (window._terrainChunks) window._terrainChunks.syncAll();
    setTimeout(function() { if (window._terrainChunks) window._terrainChunks.refreshGreenDetection(); }, 150);
    window.snapObjectsToGround();
    if (typeof window.rebuildWaterMask === 'function') window.rebuildWaterMask(false);
    if (window.syncWaterVisual) window.syncWaterVisual();

    // === FLAG PLACEMENT & HEIGHT SYNC ===
    if (isInitial || !hole.flag) {
        let cx = polyCentX, cz = polyCentZ;
        let flagX = cx, flagZ = cz;

        if (!pointInPolygon(cx, cz, densePts) || distToPolygon(cx, cz, densePts) < 2.5) {
            let candidates = [];
            if (pointInPolygon(cx, cz, densePts)) candidates.push({ x: cx, z: cz });

            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (let pt of densePts) {
                if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
                if (pt.z < minZ) minZ = pt.z; if (pt.z > maxZ) maxZ = pt.z;
            }
            let steps = 15;
            for (let ix = 0; ix <= steps; ix++) {
                let px = minX + (maxX - minX) * (ix / steps);
                for (let iz = 0; iz <= steps; iz++) {
                    let pz = minZ + (maxZ - minZ) * (iz / steps);
                    if (pointInPolygon(px, pz, densePts)) candidates.push({ x: px, z: pz });
                }
            }
            for (let pt of gd.points) {
                let mx = (cx + pt.x) / 2, mz = (cz + pt.z) / 2;
                if (pointInPolygon(mx, mz, densePts)) candidates.push({ x: mx, z: mz });
            }

            let bestCandidate = null, maxDist = -1;
            for (let cand of candidates) {
                let d = distToPolygon(cand.x, cand.z, densePts);
                if (d > maxDist) { maxDist = d; bestCandidate = cand; }
            }
            if (bestCandidate) { flagX = bestCandidate.x; flagZ = bestCandidate.z; }
        }

        let cy = (typeof window.getTerrainHeight === 'function')
            ? window.getTerrainHeight(flagX, flagZ)
            : (window.localGetTerrainAt ? (window.localGetTerrainAt(flagX, -flagZ) || {}).z || (baseH + elevationOffset) : (baseH + elevationOffset));

        if (hole.flagMesh && window._arcadeScene) window._arcadeScene.remove(hole.flagMesh);
        hole.flag = { x: flagX, y: cy, z: flagZ };
        hole.flagMesh = window.createFlagObject(flagX, cy, flagZ);
        if (!hole.pins) hole.pins = {};
        hole.pins.easy = { ...hole.flag };
        hole.pins.medium = { ...hole.flag };
        hole.pins.hard = { ...hole.flag };
    } else {
        let cy = (typeof window.getTerrainHeight === 'function')
            ? window.getTerrainHeight(hole.flag.x, hole.flag.z)
            : (window.localGetTerrainAt ? (window.localGetTerrainAt(hole.flag.x, -hole.flag.z) || {}).z || (baseH + elevationOffset) : (baseH + elevationOffset));
        hole.flag.y = cy;
        if (hole.flagMesh) hole.flagMesh.position.y = cy;
        if (hole.pins) {
            for (let p in hole.pins) {
                if (hole.pins[p]) {
                    let psurf = (typeof window.getTerrainHeight === 'function')
                        ? window.getTerrainHeight(hole.pins[p].x, hole.pins[p].z)
                        : (window.localGetTerrainAt ? (window.localGetTerrainAt(hole.pins[p].x, -hole.pins[p].z) || {}).z || cy : cy);
                    hole.pins[p].y = psurf;
                }
            }
        }
    }

    // Remember last built points so next edit erases the exact footprint
    gd.lastBuiltPoints = gd.points.map(p => ({ x: p.x, y: p.y, z: p.z }));

    // Refresh overlays
    if(window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if(window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if(window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();

    // Increment terrain revision for caching invalidation
    window._terrainRevision = (window._terrainRevision || 0) + 1;

    // Rebuild 3D Green Grid if in Green Studio Steg 2 (Lutning och höjd) or if Global Slope is active
    let isStudioLutning = !!(window.GreenStudio && window.GreenStudio.isOpen && window.GreenStudio.activeTab === 'lutning');
    let isGlobalSlope = !!window._globalGreenGridEnabled;
    if (isStudioLutning || isGlobalSlope) {
        if (window._studioShowGrid !== false && typeof window.buildGreenGrid === 'function') {
            window.buildGreenGrid(hole, window.currentHoleIndex, true);
            if (window.greenGridMesh) window.greenGridMesh.visible = true;
        }
        if (typeof window.clearGreenBeads === 'function') {
            window.clearGreenBeads();
        }
    }
    } finally {
        window._isApplyingGreenPipeline = false;
    }
};

// Live reactive update triggered from UI sliders or buttons
window.updateLiveGreen = function(property, value) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole || !hole.greenData) return;

    // If loaded from file without in-memory snapshot, capture baseline now
    if (!hole.greenData.origHeights && hole.greenData.points && typeof window.captureGreenSnapshot === 'function') {
        let snap = window.captureGreenSnapshot(hole, hole.greenData.points, 25);
        hole.greenData.bbox = snap.bbox;
        hole.greenData.origHeights = snap.origHeights;
        hole.greenData.origCanvasPixels = snap.origCanvasPixels;
        if (hole.greenData.baseElevation === undefined) hole.greenData.baseElevation = snap.baseElevation;
    }

    hole.greenData[property] = value;

    let needsRepaint = (property === 'foregreenWidth' || property === 'edgeSharpness' || property === 'mowPattern');

    if (window._greenRebakePending) return;
    window._greenRebakePending = true;
    requestAnimationFrame(function() {
        window._greenRebakePending = false;
        let curHole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (curHole && curHole.greenData) {
            window.applyGreenPipeline(curHole, false, needsRepaint);
        }
    });
};

// Delete active green and restore 100% untouched natural ground
window.deleteSmartGreen = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole || !hole.greenData) return;

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let msg = isSv ? 'Vill du ta bort greenen och återställa marken till 100% orörd natur?' : 'Delete green and restore terrain to 100% natural condition?';
    if (!confirm(msg)) return;

    window.saveUndoState();

    let oldGd = { ...hole.greenData, points: (hole.greenData.lastBuiltPoints || hole.greenData.points) };
    window.restoreGreenBase(hole, true, oldGd, true);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
        setTimeout(function() { if (window._terrainChunks) window._terrainChunks.refreshGreenDetection(); }, 150);
    }
    window.snapObjectsToGround();

    // Remove flag
    if (hole.flagMesh && window._arcadeScene) {
        window._arcadeScene.remove(hole.flagMesh);
        hole.flagMesh = null;
    }
    hole.flag = null;
    if (hole.pins) hole.pins = {};

    hole.greenData = null;

    if(window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
    if(window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
    if(window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();

    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
    window.saveLevel();
    window.showBuildToast(isSv ? '🗑️ Green raderad — marken återställd till orörd natur!' : '🗑️ Green deleted — terrain restored to natural state!', '#ef4444');
};

// Redraw shape: restores ground and puts points back in interactive drawing mode
window.redrawSmartGreen = function(holeIndex) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole || !hole.greenData) return;

    window.saveUndoState();

    let savedPoints = hole.greenData.points.map(p => ({ x: p.x, y: p.y, z: p.z }));
    let oldGd = { ...hole.greenData, points: (hole.greenData.lastBuiltPoints || hole.greenData.points) };

    window.restoreGreenBase(hole, true, oldGd, true);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
        setTimeout(function() { if (window._terrainChunks) window._terrainChunks.refreshGreenDetection(); }, 150);
    }

    if (hole.flagMesh && window._arcadeScene) {
        window._arcadeScene.remove(hole.flagMesh);
        hole.flagMesh = null;
    }
    hole.flag = null;
    hole.greenData = null;

    smartGreenPoints = savedPoints.map(p => new THREE.Vector3(p.x, p.y || 0, p.z));
    window._smartShapeClosed = false;
    updateSmartGreenPreview();

    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '🔄 Justera form: Dra i punkterna eller lägg till nya' : '🔄 Adjust shape: Drag points or add new ones', '#38bdf8');
};

// Scale entire green up or down symmetrically around its centroid
window.scaleSmartGreen = function(holeIndex, factor) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole || !hole.greenData || !hole.greenData.points || hole.greenData.points.length < 3) return;

    window.saveUndoState();

    let gd = hole.greenData;
    let cx = 0, cz = 0;
    for(let pt of gd.points) { cx += pt.x; cz += pt.z; }
    cx /= gd.points.length;
    cz /= gd.points.length;

    // Safety checks for minimum / maximum green radius
    let maxDist = 0;
    for(let pt of gd.points) {
        let d = Math.sqrt((pt.x - cx)**2 + (pt.z - cz)**2);
        if (d > maxDist) maxDist = d;
    }
    let newMaxDist = maxDist * factor;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (newMaxDist < 4.0) {
        window.showBuildToast(isSv ? '⚠️ Greenen kan inte minskas mer' : '⚠️ Green cannot be scaled smaller', '#f59e0b');
        return;
    }
    if (newMaxDist > 45.0) {
        window.showBuildToast(isSv ? '⚠️ Greenen har nått maxstorlek' : '⚠️ Green has reached max size', '#f59e0b');
        return;
    }

    // 1. Restore pristine ground before modifying points
    let oldGd = { ...gd, points: (gd.lastBuiltPoints || gd.points) };
    window.restoreGreenBase(hole, true, oldGd);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
        setTimeout(function() { if (window._terrainChunks) window._terrainChunks.refreshGreenDetection(); }, 150);
    }

    // 2. Scale all control points outward or inward from centroid
    for(let pt of gd.points) {
        pt.x = cx + (pt.x - cx) * factor;
        pt.z = cz + (pt.z - cz) * factor;
    }

    // 3. Capture clean snapshot for new scaled bounding box
    let snap = window.captureGreenSnapshot(hole, gd.points, 25);
    gd.baseElevation = snap.baseElevation;
    gd.bbox = snap.bbox;
    gd.origHeights = snap.origHeights;
    gd.origCanvasPixels = snap.origCanvasPixels;

    // 4. Re-apply pipeline with exact same height, slope, contour, mow pattern
    window.applyGreenPipeline(hole, false, true);

    if (window.GreenStudio) window.GreenStudio.sync();
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();

    let area = 0;
    if (gd.points && gd.points.length >= 3) {
        for (let i = 0, j = gd.points.length - 1; i < gd.points.length; j = i++) {
            area += (gd.points[j].x + gd.points[i].x) * (gd.points[j].z - gd.points[i].z);
        }
        area = Math.round(Math.abs(area / 2));
    }
    let toastMsg = factor > 1
        ? (isSv ? `➕ Green utökad till ~${area} m²` : `➕ Green scaled up to ~${area} m²`)
        : (isSv ? `➖ Green minskad till ~${area} m²` : `➖ Green scaled down to ~${area} m²`);
    window.showBuildToast(toastMsg, '#4ade80');
};

// Move entire green to new center coordinates
window.moveSmartGreen = function(holeIndex, newCenterX, newCenterZ) {
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole || !hole.greenData) return;

    window.saveUndoState();

    let gd = hole.greenData;
    let oldCx = 0, oldCz = 0;
    for(let pt of gd.points) { oldCx += pt.x; oldCz += pt.z; }
    oldCx /= gd.points.length;
    oldCz /= gd.points.length;

    let dx = newCenterX - oldCx;
    let dz = newCenterZ - oldCz;

    // Restore old ground 100% clean
    let oldGd = { ...gd, points: (gd.lastBuiltPoints || gd.points) };
    window.restoreGreenBase(hole, true, oldGd);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
        setTimeout(function() { if (window._terrainChunks) window._terrainChunks.refreshGreenDetection(); }, 150);
    }

    // Shift all points to new location
    for(let pt of gd.points) {
        pt.x += dx;
        pt.z += dz;
    }

    // Take snapshot at new location
    let snap = window.captureGreenSnapshot(hole, gd.points, 25);
    gd.baseElevation = snap.baseElevation;
    gd.bbox = snap.bbox;
    gd.origHeights = snap.origHeights;
    gd.origCanvasPixels = snap.origCanvasPixels;

    if (hole.flag) {
        hole.flag.x += dx;
        hole.flag.z += dz;
    }

    // Re-apply pipeline with exact same parameters
    window.applyGreenPipeline(hole, false, true);

    if (window.GreenStudio) window.GreenStudio.sync();
    window.saveLevel();
    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '✥ Green flyttad till ny plats!' : '✥ Green moved to new location!', '#4ade80');
};

// Activate "Move Green" picking mode
window.activateMoveGreenMode = function() {
    window._movingGreenMode = true;
    window._movingFlagMode = false;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '📍 Klicka på kartan där greenens mitt ska placeras (Esc för att avbryta)' : '📍 Click on map to place green center (Esc to cancel)', '#f59e0b');
};

// Activate "Move Flag" picking mode
window.activateMoveFlagMode = function() {
    window._movingFlagMode = true;
    window._movingGreenMode = false;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '⛳ Klicka på greenen där flaggan ska stå (Esc för att avbryta)' : '⛳ Click on green where flag should stand (Esc to cancel)', '#f59e0b');
};

// Adopt pre-existing green (from older saves with flag but no greenData) into Live Studio
window.adoptExistingGreen = function(holeIndex, immediateSave) {
    if (immediateSave === undefined) immediateSave = true;
    if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
    let hole = window.courseHoles && window.courseHoles[holeIndex];
    if (!hole || !hole.flag) return false;
    if (hole.greenData) return true; // Already adopted

    window.saveUndoState();

    let fx = hole.flag.x;
    let fz = hole.flag.z;
    let fy = hole.flag.y;

    // Detect approximate green radius from 4K canvas around flag, default ~11.5m (~415 m²)
    let radius = 11.5;
    if (window._arcadePCtx) {
        try {
            let step = 1;
            let maxDist = 25;
            let detectedR = 0;
            let count = 0;
            let dirs = [{dx:1,dz:0}, {dx:-1,dz:0}, {dx:0,dz:1}, {dx:0,dz:-1}];
            for(let d of dirs) {
                for(let dist = 4; dist <= maxDist; dist += step) {
                    let testX = fx + d.dx * dist;
                    let testZ = fz + d.dz * dist;
                    let pxX = Math.round(((testX + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096);
                    let pxY = Math.round(((testZ + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096);
                    let pix = window._arcadePCtx.getImageData(pxX, pxY, 1, 1).data;
                    let isGreen = (pix[1] > pix[0] + 12 && pix[1] > pix[2]);
                    if (!isGreen) {
                        detectedR += dist;
                        count++;
                        break;
                    }
                }
            }
            if (count > 0) {
                let avgR = detectedR / count;
                if (avgR >= 5 && avgR <= 25) radius = avgR;
            }
        } catch(e) {
            console.warn('[SMART BUILDER] adoptExistingGreen scan:', e);
        }
    }

    // Create 12 smooth organic points around flag
    let numPts = 12;
    let pts = [];
    for(let i = 0; i < numPts; i++) {
        let angle = (i / numPts) * Math.PI * 2;
        let rVar = radius * (1 + 0.1 * Math.sin(angle * 3));
        pts.push({
            x: fx + Math.cos(angle) * rVar,
            y: fy,
            z: fz + Math.sin(angle) * rVar
        });
    }

    let snap = window.captureGreenSnapshot(hole, pts, 25);
    let elSlider = document.getElementById('sg-elevation-offset');
    let curElev = elSlider ? parseFloat(elSlider.value) : 0.0;
    let blSlider = document.getElementById('sg-blend-dist');
    let curBlend = blSlider ? parseFloat(blSlider.value) : 8.0;
    let fgSlider = document.getElementById('sg-foregreen-width');
    let curFg = fgSlider ? parseFloat(fgSlider.value) : 1.0;
    let sharpSlider = document.getElementById('sg-edge-sharpness');
    let curSharp = sharpSlider ? parseInt(sharpSlider.value) : 100;
    let tiltSlider = document.getElementById('sg-tilt-pct');
    let curTilt = tiltSlider ? parseFloat(tiltSlider.value) / 100 : 0.02;
    let tiltCb = document.getElementById('sg-tilt-aim-cb');
    let curTiltAim = tiltCb ? tiltCb.checked : true;

    hole.greenData = {
        points: pts,
        baseElevation: snap.baseElevation,
        bbox: snap.bbox,
        origHeights: snap.origHeights,
        origCanvasPixels: snap.origCanvasPixels,
        difficulty: window.greenDifficulty || 'FLAT',
        elevationOffset: curElev,
        blendDistance: curBlend,
        tiltPct: curTilt,
        tiltAim: curTiltAim,
        tiltToFlag: true,
        stimp: 10.0,
        firmness: 'NORMAL',
        tension: 0.5,
        showContours: false,
        showBallPath: true,
        mowPattern: window._smartMowPattern || 'SOLID',
        foregreenWidth: curFg,
        edgeSharpness: 100,
        seedOffsetX: (Math.random() - 0.5) * 200,
        seedOffsetZ: (Math.random() - 0.5) * 200
    };

    window.applyGreenPipeline(hole, false, false);
    if (immediateSave) {
        window.saveLevel();
    } else {
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    }
    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '✨ Befintlig green är nu aktiv i Live Studio!' : '✨ Existing green is now active in Live Studio!', '#4ade80');
    return true;
};

// Initial Green Build triggered from UI button
window.executeSplineSmartGreen = function() {
    if(smartGreenPoints.length < 3) {
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        if (typeof window.showBuildToast === 'function') {
            window.showBuildToast(isSv ? '⚠️ Sätt ut minst 3 punkter för att skapa greenen!' : '⚠️ Place at least 3 points to create the green!', '#ef4444');
        }
        return;
    }
    window.saveUndoState();

    let hole = window.courseHoles[window.currentHoleIndex];
    if (!hole) return;

    let difficulty = window.greenDifficulty || 'FLAT';
    let mowPattern = window._smartMowPattern || 'SOLID';

    let fgSlider = document.getElementById('gs-foregreen-slider') || document.getElementById('sg-foregreen-width');
    let foregreenWidth = fgSlider ? parseFloat(fgSlider.value) : 1.0;

    let elevSlider = document.getElementById('gs-elev-slider') || document.getElementById('sg-elevation-offset');
    let elevationOffset = elevSlider ? parseFloat(elevSlider.value) : 0.0;

    let blendSlider = document.getElementById('gs-blend-slider') || document.getElementById('sg-blend-dist');
    let blendDist = blendSlider ? parseFloat(blendSlider.value) : 8.0;

    let tiltSlider = document.getElementById('gs-tilt-slider') || document.getElementById('sg-tilt-pct');
    let tiltPct = tiltSlider ? parseFloat(tiltSlider.value) / 100 : 0.02;

    let tiltAim = true;
    let tiltCb = document.getElementById('gs-tilt-to-flag-cb') || document.getElementById('sg-tilt-aim-cb');
    if (tiltCb) tiltAim = tiltCb.checked;

    // Capture pristine terrain & canvas snapshot before any modification
    let snap = window.captureGreenSnapshot(hole, smartGreenPoints, 25);

    hole.greenData = {
        points: smartGreenPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
        baseElevation: snap.baseElevation,
        bbox: snap.bbox,
        origHeights: snap.origHeights,
        origCanvasPixels: snap.origCanvasPixels,

        difficulty: difficulty,
        elevationOffset: elevationOffset,
        blendDistance: blendDist,
        tiltPct: tiltPct,
        tiltAim: tiltAim,
        tiltToFlag: true,
        stimp: 10.0,
        firmness: 'NORMAL',
        tension: 0.5,
        showContours: false,
        showBallPath: true,
        mowPattern: mowPattern,
        foregreenWidth: foregreenWidth,
        edgeSharpness: 100,
        seedOffsetX: (Math.random() - 0.5) * 200,
        seedOffsetZ: (Math.random() - 0.5) * 200
    };

    // Apply painting, sculpting, and place flag
    window.applyGreenPipeline(hole, true);

    // Clear the active drawn spline points from the view
    clearSmartGreen();

    window.saveLevel();
    window.autoAdvanceHole();
    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
    if (window.GreenStudio) {
        window.GreenStudio.sync();
    }
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (typeof window.showBuildToast === 'function') {
        window.showBuildToast(isSv ? '⛳ Green skapad! Dra golfbollarna för att justera formen.' : '⛳ Green created! Drag golf balls to adjust shape.', '#4ade80');
    }

    // Prevent double-click from starting a new shape immediately
    window._smartBuildCooldown = true;
    setTimeout(function() { window._smartBuildCooldown = false; }, 500);
};

    window.updateSBHoleDisplay = function() {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (!hole) return;
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        let hasTee = hole.tees && (hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black);
        let hasFlag = hole.flag;
        let hasAim = hole.aimPoint;
        let status = '○'; // empty
        if(hasTee && hasFlag && hasAim) status = '✅'; // complete
        else if(hasTee || hasFlag) status = '⚠️'; // partial
        let el = document.getElementById('sb-hole-display');
        if(el) el.textContent = (isSv ? 'Hål ' : 'Hole ') + (window.currentHoleIndex + 1) + ' (Par ' + hole.par + ') ' + status;
        // Also sync HOLE tool display and topbar
        let holeNum = document.getElementById('hole-ui-num');
        if(holeNum) holeNum.innerText = (isSv ? 'Hål ' : 'Hole ') + (window.currentHoleIndex + 1);
        let holePar = document.getElementById('hole-ui-par');
        if(holePar) holePar.innerText = 'Par ' + hole.par;
        let sbPar = document.getElementById('sb-par-display');
        if(sbPar) sbPar.innerText = 'Par ' + hole.par;
        let tbNum = document.getElementById('topbar-hole-num');
        if(tbNum) tbNum.innerText = (isSv ? 'HÅL ' : 'HOLE ') + (window.currentHoleIndex + 1);
        let tbPar = document.getElementById('topbar-hole-par');
        if(tbPar) tbPar.innerText = 'Par ' + hole.par;
        
        let aimDelBtn = document.getElementById('sb-aim-clear-btn');
        if(aimDelBtn) {
            let curHole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            if(curHole && curHole.aimPoint) {
                aimDelBtn.style.display = 'block';
                aimDelBtn.innerHTML = '🗑️ Ta bort Aim Point (Hål ' + (window.currentHoleIndex + 1) + ')';
            } else {
                let otherIdx = -1;
                for(let i = 0; i < window.MAX_HOLES; i++) {
                    if(window.courseHoles && window.courseHoles[i] && window.courseHoles[i].aimPoint) { otherIdx = i; break; }
                }
                if(otherIdx >= 0) {
                    aimDelBtn.style.display = 'block';
                    aimDelBtn.innerHTML = '🗑️ Ta bort Aim Point (Hål ' + (otherIdx + 1) + ')';
                } else {
                    aimDelBtn.style.display = 'none';
                }
            }
        }
        if (typeof window.updateSBAimCard === 'function') {
            window.updateSBAimCard();
        }
        if (typeof window.updateSBGreenControls === 'function') {
            window.updateSBGreenControls();
        }
        if (typeof window.updateSBFairwayControls === 'function') {
            window.updateSBFairwayControls();
        }
    };

    // Check hole completion status (notifies user without forcefully switching holes)
    window.autoAdvanceHole = function() {
        let hole = window.courseHoles[window.currentHoleIndex];
        let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
        let hasFlag = hole.flag;
        let hasAim = hole.aimPoint;
        if(hasTee && hasFlag && hasAim) {
            // Find next incomplete hole
            let nextIdx = -1;
            for(let i = window.currentHoleIndex + 1; i < window.MAX_HOLES; i++) {
                let h = window.courseHoles[i];
                let ht = h.tees.yellow || h.tees.red || h.tees.white || h.tees.black;
                if(!ht || !h.flag || !h.aimPoint) { nextIdx = i; break; }
            }
            if(nextIdx >= 0) {
                window.showBuildToast('✅ Hål ' + (window.currentHoleIndex+1) + ' är klart! Klicka [>] för att bygga Hål ' + (nextIdx+1), '#4ade80');
            } else {
                window.showBuildToast('🏆 Alla hål är färdigbyggda!', '#fbbf24');
            }
        }
        updateSBHoleDisplay();
    };

    function executeSmartBuilder() {
        if(window._smartBuildCooldown) return;
        if(window._smartBuilderType === 'BUNKER') {
            if (typeof window.executeSmartBunker === 'function') window.executeSmartBunker();
            else if (typeof executeSmartBunker === 'function') executeSmartBunker();
        } else if(window._smartBuilderType === 'FAIRWAY') {
            if (typeof window.executeSmartFairway === 'function') window.executeSmartFairway();
            else if (typeof executeSmartFairway === 'function') executeSmartFairway();
        } else if(window._smartBuilderType === 'TEE') {
            if (typeof window.executeSmartTee === 'function') window.executeSmartTee();
            else if (typeof executeSmartTee === 'function') executeSmartTee();
        } else if(window._smartBuilderType === 'PAINT') {
            if (typeof window.executeSmartPaint === 'function') window.executeSmartPaint();
        } else {
            if (typeof window.executeSplineSmartGreen === 'function') window.executeSplineSmartGreen();
            else if (typeof executeSplineSmartGreen === 'function') executeSplineSmartGreen();
        }
    }
    window.executeSmartBuilder = executeSmartBuilder;

    // === SMART PAINT: Precision polygon surface painting ===
    window.executeSmartPaint = function() {
        if(smartGreenPoints.length < 3) return;
        window.saveUndoState();

        // Re-read color from CURRENT biome config to prevent stale colors
        // This is the core fix: always derive color from active biome + selected surface
        let surface = window._smartPaintSurface || 'foregreen';
        let cfg = window.CURRENT_BIOME_CONFIG;
        var liveColorMap = {
            foregreen: cfg.foregreenColor || '#8bc45d',
            fairway: cfg.fairwayColor || '#7db952',
            semi: cfg.semiColor || '#6b9e3d',
            rough: cfg.roughColor || '#4a782b',
            fescue: cfg.fescueColor || '#2d4c1a',
            green: cfg.greenColor || '#98ce68',
            bunker: cfg.bunkerColor || '#e0d8a4',
            waste: cfg.wasteColor || '#c2af7c',
            water: cfg.waterColor || '#38bdf8',
            ob: cfg.obColor || '#ef4444'
        };
        let color;
        if (surface === 'custom') {
            let customEl = document.getElementById('sp-custom-color');
            color = customEl ? customEl.value : (window._smartPaintColor || '#8bc45d');
        } else {
            color = liveColorMap[surface] || window._smartPaintColor || '#8bc45d';
        }

        // Build closed curve from points
        let curve = new THREE.CatmullRomCurve3(smartGreenPoints, true);
        let numSamples = Math.max(200, smartGreenPoints.length * 40);
        let densePts = curve.getPoints(numSamples);

        // Paint onto terrain canvas
        window._arcadePCtx.save();

        // Edge sharpness support (shared slider with GREEN/FAIRWAY)
        let sharpSlider = document.getElementById('sg-edge-sharpness');
        let sharpness = sharpSlider ? parseInt(sharpSlider.value) : 100;
        if(sharpness < 100) {
            let blurPx = Math.round((100 - sharpness) * 0.06);
            if(blurPx > 0) window._arcadePCtx.filter = 'blur(' + blurPx + 'px)';
        }

        window._arcadePCtx.beginPath();
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
            if(i === 0) window._arcadePCtx.moveTo(pxX, pxY);
            else window._arcadePCtx.lineTo(pxX, pxY);
        });
        window._arcadePCtx.closePath();
        window._arcadePCtx.fillStyle = color;
        window._arcadePCtx.fill();

        // No mowing pattern for PAINT — patterns are exclusive to GREEN/FAIRWAY

        window._arcadePCtx.filter = 'none';
        window._arcadePCtx.restore();
        window._arcadeMapTex.needsUpdate = true;
        window.terrainBiomeData = window._arcadePCtx.getImageData(0, 0, 4096, 4096).data;
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();

        // Show feedback toast
        let nameMap = {foregreen:'Foregreen', fairway:'Fairway', semi:'Semi-rough', rough:'Rough', fescue:'Deep Rough', green:'Green', bunker:'Sand', waste:'Waste', water:'Water', ob:'OB', custom:'Custom'};
        if (window.showBuildToast) window.showBuildToast('🎨 Painted ' + (nameMap[surface] || surface), '#a78bfa');

        // Clear spline
        clearSmartGreen();
    };

    // === PROPS POLYGON FILL: Fill a defined polygon with props ===
    window.executePropsPolygon = function() {
        if(typeof smartGreenPoints === 'undefined' || smartGreenPoints.length < 3) return;
        if(!window.currentNatureType) {
            if (window.showBuildToast) window.showBuildToast('⚠️ Select an asset first!', '#f59e0b');
            return;
        }
        
        window.saveUndoState();

        // Build closed curve from points
        let curve = new THREE.CatmullRomCurve3(smartGreenPoints, true);
        let numSamples = Math.max(200, smartGreenPoints.length * 40);
        let densePts = curve.getPoints(numSamples);

        // Find bounding box
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        densePts.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });

        // Determine spacing: manual override > model-based auto > category defaults
        let spacing = 3.5;
        if (window._polySpacingOverride) {
            spacing = window._polySpacingOverride;
        } else {
            // Auto-calculate from model bounding box
            let model = window.customModels && window.customModels[window.currentNatureType];
            if (model && model.isObject3D) {
                let box = new THREE.Box3().setFromObject(model);
                let size = box.getSize(new THREE.Vector3());
                let maxWidth = Math.max(size.x, size.z);
                // Params scale affects final size
                let params = window.getPlacementParams(window.currentNatureType);
                let s = params ? params.scale : 1.0;
                spacing = Math.max(maxWidth * s * 1.2, 1.5);  // 1.2x width for slight gaps
            } else {
                // Fallback: category-based
                let isDense = false;
                if (document.getElementById('cat-btn-ROCKS') && document.getElementById('cat-btn-ROCKS').classList.contains('active')) isDense = true;
                if (document.getElementById('cat-btn-PLANTS') && document.getElementById('cat-btn-PLANTS').classList.contains('active')) isDense = true;
                if (isDense) spacing = 1.5;
            }
        }

        // Point in polygon test
        function pointInPoly(px, pz, polyPts) {
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

        let estimatedCount = 0;
        let validPoints = [];
        for (let z = minZ; z <= maxZ; z += spacing) {
            for (let x = minX; x <= maxX; x += spacing) {
                let randX = x + (Math.random() - 0.5) * spacing * 0.8;
                let randZ = z + (Math.random() - 0.5) * spacing * 0.8;

                if (pointInPoly(randX, randZ, densePts)) {
                    // Check biomes if respect biomes is checked
                    let canPlace = true;
                    if (window.forestRespectBiomes && window.terrainBiomeData) {
                        let pxX = Math.floor(((randX + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096);
                        let pxZ = Math.floor(((randZ + window.TERRAIN_SIZE/2) / window.TERRAIN_SIZE) * 4096);
                        pxX = Math.max(0, Math.min(4095, pxX));
                        pxZ = Math.max(0, Math.min(4095, pxZ));
                        let idx4 = (pxZ * 4096 + pxX) * 4;
                        let r = window.terrainBiomeData[idx4];
                        let g = window.terrainBiomeData[idx4+1];
                        if(g > 150 && r < 180) canPlace = false; // Green/Fairway/Tee biomes
                        if(r > 190 && g > 180) canPlace = false; // Bunker/Sand biomes
                    }
                    
                    // Check water
                    if (canPlace) {
                        let surf = window.localGetTerrainAt(randX, -randZ);
                        if (surf) {
                            let waterH = window.getWaterHeightAt ? window.getWaterHeightAt(randX, -randZ) : -99;
                            if (waterH > surf.z) canPlace = false;
                        }
                    }

                    if (canPlace) {
                        validPoints.push({x: randX, z: randZ});
                        estimatedCount++;
                    }
                }
            }
        }

        if (estimatedCount > 300) {
            let proceed = window.confirm(`⚠️ WARNING: You are about to place ${estimatedCount} props at once!\n\nThis may cause severe lag or freeze the browser depending on the 3D model complexity.\n\nDo you want to proceed?`);
            if (!proceed) {
                if (window.showBuildToast) window.showBuildToast('❌ Polygon fill cancelled.', '#ef4444');
                return; // Cancel placement
            }
        }

        let placedCount = 0;
        let placedTypes = new Set();
        for (let i = 0; i < validPoints.length; i++) {
            let p = validPoints[i];
            let randX = p.x;
            let randZ = p.z;
            let params = window.getPlacementParams(window.currentNatureType);
            if (params && params.type) {
                if (typeof window.createTree === 'function') {
                    window.createTree(params.type, randX, randZ, params.scale, params.rot, '#ffffff', '#ffffff', params.yOffset, params.brightness, true);
                    placedTypes.add(params.type);
                    placedCount++;
                }
            } else if (placedCount === 0 && !window._warnedPolyProps) {
                // No valid placement params — warn once
                if (window.showBuildToast) window.showBuildToast('⚠️ Asset not loaded yet — try again!', '#f59e0b');
                window._warnedPolyProps = true;
                setTimeout(() => window._warnedPolyProps = false, 3000);
            }
        }

        // Rebuild visual pools once after all props are placed
        placedTypes.forEach(type => {
            if (typeof window.rebuildInstancePool === 'function') {
                window.rebuildInstancePool(type);
            }
        });

        if (window.showBuildToast) window.showBuildToast('🌳 Filled ' + placedCount + ' props (spacing: ' + spacing.toFixed(1) + 'm)', '#4ade80');
        
        // Clear polygon
        if (typeof clearSmartGreen === 'function') clearSmartGreen();
    };

// ================================================================
//  TERRAIN STAMP SYSTEM
//  Capture terrain heightmaps and stamp them elsewhere.
//  Storage: localStorage (admin will later save to DB)
// ================================================================

(function() {
    // Load stamp library from localStorage
    window._stampLibrary = [];
    try {
        let saved = localStorage.getItem('terrainStamps');
        if (saved) window._stampLibrary = JSON.parse(saved);
    } catch(e) { console.warn('Could not load stamps:', e); }

    // Active stamp index for placement
    window._activeStampIndex = -1;
    window._stampScale = 1.0;
    window._stampRotation = 0;
    window._stampAmplitude = 1.0;

    // === CAPTURE: Save terrain heightmap within radius ===
    window.captureTerrainStamp = function(centerX, centerZ, captureRadius, stampName) {
        let positions = window._arcadePlaneGeo.attributes.position.array;
        let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;
        let stride = window.TERRAIN_SEGS + 1;

        // Grid radius in vertex units
        let gridRadius = Math.ceil(captureRadius / step);
        let gridSize = gridRadius * 2 + 1;

        // Center vertex indices
        let cGx = Math.round((centerX + window.TERRAIN_SIZE / 2) / step);
        let cGz = Math.round((centerZ + window.TERRAIN_SIZE / 2) / step);

        // Calculate base height from edge ring (MINIMUM to prevent negative deltas on slopes)
        let edgeMin = Infinity, edgeCount = 0;
        for (let dz = -gridRadius; dz <= gridRadius; dz++) {
            for (let dx = -gridRadius; dx <= gridRadius; dx++) {
                let dist = Math.sqrt(dx * dx + dz * dz) * step;
                if (dist > captureRadius * 0.85 && dist <= captureRadius) {
                    let gx = cGx + dx, gz = cGz + dz;
                    if (gx >= 0 && gx < stride && gz >= 0 && gz < stride) {
                        let h = positions[(gz * stride + gx) * 3 + 2];
                        if (h < edgeMin) edgeMin = h;
                        edgeCount++;
                    }
                }
            }
        }
        let baseHeight = edgeCount > 0 ? edgeMin : 0;

        // Capture height deltas
        let heights = new Array(gridSize * gridSize);
        let hasData = false;
        for (let dz = -gridRadius; dz <= gridRadius; dz++) {
            for (let dx = -gridRadius; dx <= gridRadius; dx++) {
                let dist = Math.sqrt(dx * dx + dz * dz) * step;
                let gx = cGx + dx, gz = cGz + dz;
                let arrIdx = (dz + gridRadius) * gridSize + (dx + gridRadius);

                if (dist <= captureRadius && gx >= 0 && gx < stride && gz >= 0 && gz < stride) {
                    let h = positions[(gz * stride + gx) * 3 + 2] - baseHeight;
                    // No edge-fade here — apply-side falloff handles it (prevents double-fade)
                    heights[arrIdx] = Math.round(h * 100) / 100; // 1cm precision
                    if (Math.abs(h) > 0.1) hasData = true;
                } else {
                    heights[arrIdx] = null;
                }
            }
        }

        if (!hasData) {
            if (window.showBuildToast) window.showBuildToast('⚠️ No terrain variation to capture!', '#ef4444');
            return null;
        }

        // Generate thumbnail (64x64 heightmap visualization)
        let thumbSize = 64;
        let thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = thumbSize;
        thumbCanvas.height = thumbSize;
        let tCtx = thumbCanvas.getContext('2d');
        tCtx.fillStyle = '#1e293b';
        tCtx.fillRect(0, 0, thumbSize, thumbSize);

        // Find height range for color mapping
        let minH = Infinity, maxH = -Infinity;
        for (let i = 0; i < heights.length; i++) {
            if (heights[i] != null) {
                if (heights[i] < minH) minH = heights[i];
                if (heights[i] > maxH) maxH = heights[i];
            }
        }
        let hRange = Math.max(0.1, maxH - minH);

        for (let py = 0; py < thumbSize; py++) {
            for (let px = 0; px < thumbSize; px++) {
                let sx = Math.floor((px / thumbSize) * gridSize);
                let sy = Math.floor((py / thumbSize) * gridSize);
                let h = heights[sy * gridSize + sx];
                if (h != null) {
                    let norm = (h - minH) / hRange;
                    let r = Math.floor(40 + norm * 120);
                    let g = Math.floor(80 + norm * 160);
                    let b = Math.floor(40 + norm * 60);
                    tCtx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
                    tCtx.fillRect(px, py, 1, 1);
                }
            }
        }

        let stamp = {
            name: stampName || ('Stamp ' + (window._stampLibrary.length + 1)),
            radius: captureRadius,
            gridSize: gridSize,
            step: step,
            heights: heights,
            thumbnail: thumbCanvas.toDataURL('image/png', 0.8),
            createdAt: new Date().toISOString()
        };

        window._stampLibrary.push(stamp);
        _saveStampLibrary();

        if (window.showBuildToast) window.showBuildToast('📷 Captured "' + stamp.name + '" (' + gridSize + 'x' + gridSize + ')', '#4ade80');
        window.renderStampLibrary();
        return stamp;
    };

    // === APPLY: Stamp terrain at target position ===
    window.applyTerrainStamp = function(stampIndex, centerX, centerZ) {
        let stamp = window._stampLibrary[stampIndex];
        if (!stamp) return;

        window.saveUndoState();

        let positions = window._arcadePlaneGeo.attributes.position.array;
        let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;
        let stride = window.TERRAIN_SEGS + 1;

        let scale = window._stampScale || 1.0;
        let rotation = (window._stampRotation || 0) * Math.PI / 180; // degrees to radians
        let amplitude = window._stampAmplitude || 1.0;

        let cGx = Math.round((centerX + window.TERRAIN_SIZE / 2) / step);
        let cGz = Math.round((centerZ + window.TERRAIN_SIZE / 2) / step);

        let scaledRadius = Math.ceil((stamp.radius * scale) / step) + 1;
        let halfGrid = Math.floor(stamp.gridSize / 2);
        let cosR = Math.cos(-rotation);
        let sinR = Math.sin(-rotation);

        for (let dz = -scaledRadius; dz <= scaledRadius; dz++) {
            for (let dx = -scaledRadius; dx <= scaledRadius; dx++) {
                let gx = cGx + dx, gz = cGz + dz;
                if (gx < 0 || gx >= stride || gz < 0 || gz >= stride) continue;

                // Rotate + scale to find sample position in stamp space
                let sx = (dx * cosR + dz * sinR) / scale + halfGrid;
                let sz = (-dx * sinR + dz * cosR) / scale + halfGrid;

                // Bilinear interpolation for smooth sampling
                let ix = Math.floor(sx), iz = Math.floor(sz);
                let fx = sx - ix, fz = sz - iz;

                if (ix < 0 || ix >= stamp.gridSize - 1 || iz < 0 || iz >= stamp.gridSize - 1) continue;

                let h00 = stamp.heights[iz * stamp.gridSize + ix];
                let h10 = stamp.heights[iz * stamp.gridSize + ix + 1];
                let h01 = stamp.heights[(iz + 1) * stamp.gridSize + ix];
                let h11 = stamp.heights[(iz + 1) * stamp.gridSize + ix + 1];

                // Skip if any corner is outside capture area
                if (h00 == null || h10 == null || h01 == null || h11 == null) continue;

                let h = (h00 * (1 - fx) * (1 - fz)) + (h10 * fx * (1 - fz)) +
                        (h01 * (1 - fx) * fz) + (h11 * fx * fz);

                // Soft edge falloff (last 30% of radius fades out)
                let worldDist = Math.sqrt(dx * dx + dz * dz) * step;
                let maxDist = stamp.radius * scale;
                let falloff = 1.0;
                if (worldDist > maxDist * 0.7) {
                    falloff = 1.0 - ((worldDist - maxDist * 0.7) / (maxDist * 0.3));
                    falloff = Math.max(0, Math.min(1, falloff));
                    falloff = falloff * falloff * (3 - 2 * falloff); // Smoothstep
                }

                let idx = gz * stride + gx;
                positions[idx * 3 + 2] += h * amplitude * falloff;
            }
        }

        // Update terrain
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    if (window._terrainChunks) window._terrainChunks.syncAll();
        if (window.snapObjectsToGround) window.snapObjectsToGround();
        if (window.slopeOverlayActive) window.updateSlopeOverlay();
        if (window.contourLinesActive) window.updateContourLines();
        if (window.elevationHeatmapActive) window.updateElevationHeatmap();

        if (window.showBuildToast) window.showBuildToast('🔨 Stamped "' + stamp.name + '"', '#38bdf8');
    };

    // === DELETE: Remove stamp from library ===
    window.deleteTerrainStamp = function(index) {
        if (index >= 0 && index < window._stampLibrary.length) {
            let name = window._stampLibrary[index].name;
            window._stampLibrary.splice(index, 1);
            _saveStampLibrary();
            if (window._activeStampIndex >= window._stampLibrary.length) {
                window._activeStampIndex = window._stampLibrary.length - 1;
            }
            window.renderStampLibrary();
            if (window.showBuildToast) window.showBuildToast('🗑️ Deleted "' + name + '"', '#ef4444');
        }
    };

    // === RENDER: Build stamp library HTML ===
    window.renderStampLibrary = function() {
        let container = document.getElementById('stamp-library-list');
        if (!container) return;

        if (window._stampLibrary.length === 0) {
            container.innerHTML = '<div style="color:#475569; font-size:9px; text-align:center; padding:8px;">No stamps yet. Sculpt terrain, then capture!</div>';
            return;
        }

        let html = '';
        for (let i = 0; i < window._stampLibrary.length; i++) {
            let s = window._stampLibrary[i];
            let isActive = (i === window._activeStampIndex);
            let border = isActive ? '2px solid #4ade80' : '1px solid #334155';
            let bg = isActive ? '#1e3a5f' : '#0f172a';
            html += '<div onclick="window._activeStampIndex=' + i + '; window.renderStampLibrary();" style="display:flex; align-items:center; gap:6px; padding:5px; border-radius:5px; cursor:pointer; border:' + border + '; background:' + bg + '; margin-bottom:3px;">';
            html += '<img src="' + s.thumbnail + '" style="width:36px; height:36px; border-radius:4px; image-rendering:pixelated;">';
            html += '<div style="flex:1; min-width:0;">';
            html += '<div style="color:#e2e8f0; font-size:10px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + s.name + '</div>';
            html += '<div style="color:#64748b; font-size:8px;">' + Math.round(s.radius) + 'm radius</div>';
            html += '</div>';
            html += '<button onclick="event.stopPropagation(); window.deleteTerrainStamp(' + i + ');" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:12px; padding:2px 4px;" title="Delete">✕</button>';
            html += '</div>';
        }
        container.innerHTML = html;
    };

    function _saveStampLibrary() {
        try {
            localStorage.setItem('terrainStamps', JSON.stringify(window._stampLibrary));
        } catch (e) {
            console.warn('Could not save stamps (storage full?):', e);
            if (window.showBuildToast) window.showBuildToast('⚠️ Storage full! Delete some stamps.', '#ef4444');
        }
    }

    
window.executeRidgeMountain = function() {
    if (!window.splinePoints || window.splinePoints.length < 2) {
        if (window.showBuildToast) window.showBuildToast('Requires at least 2 points', '#ef4444');
        return;
    }
    
    window.saveUndoState();
    if (window.showBuildToast) window.showBuildToast('Building mountain ridge...', '#38bdf8');
    
    // Read height from the MTN spline height slider (shared with Plateau mode)
    let targetHeight = parseFloat(document.getElementById('mtn-spline-height').value) || 25.0;
    
    // Read jaggedness from the MTN jagged slider
    let jaggedMultiplier = 1.0;
    let jaggedSlider = document.getElementById('mtn-spline-jagged');
    if (jaggedSlider) {
        jaggedMultiplier = parseFloat(jaggedSlider.value) / 50.0;
    }
    
    // Auto width: slope ratio 1:1.2 for steep ridge profile
    let ridgeWidth = Math.abs(targetHeight) * 1.2;
    if (ridgeWidth < 8) ridgeWidth = 8;
    
    // Use correct terrain geometry reference
    const positions = window._arcadePlaneGeo.attributes.position.array;
    let segs = window.TERRAIN_SEGS;
    let size = window.TERRAIN_SIZE;
    let step = size / segs;
    let stride = segs + 1;
    let modified = false;
    
    // FBM noise function (from arcade-perlin.js)
    let fbm = window.fbm || function(x, y) { return 0; };
    
    function distToSegment(px, pz, v, w) {
        const l2 = (v.x - w.x)**2 + (v.z - w.z)**2;
        if (l2 == 0) return Math.sqrt((px - v.x)**2 + (pz - v.z)**2);
        let t = ((px - v.x) * (w.x - v.x) + (pz - v.z) * (w.z - v.z)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = v.x + t * (w.x - v.x);
        const projZ = v.z + t * (w.z - v.z);
        return Math.sqrt((px - projX)**2 + (pz - projZ)**2);
    }
    
    // Find bounding box of spline to limit vertex iteration
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    window.splinePoints.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
    });
    // Expand by ridgeWidth + margin
    let gxMin = Math.max(0, Math.floor((minX - ridgeWidth - 5 + size / 2) / step));
    let gxMax = Math.min(segs, Math.ceil((maxX + ridgeWidth + 5 + size / 2) / step));
    let gzMin = Math.max(0, Math.floor((minZ - ridgeWidth - 5 + size / 2) / step));
    let gzMax = Math.min(segs, Math.ceil((maxZ + ridgeWidth + 5 + size / 2) / step));
    
    // Correct axis mapping: PlaneGeometry rotated -90° on X
    // positions[idx*3]   = X (world X)
    // positions[idx*3+1] = Y (world -Z)
    // positions[idx*3+2] = Z (world Y = height!)
    for (let gz = gzMin; gz <= gzMax; gz++) {
        for (let gx = gxMin; gx <= gxMax; gx++) {
            let idx = gz * stride + gx;
            let vx = positions[idx * 3];       // world X
            let vz = -positions[idx * 3 + 1];  // world Z = -localY
            let origH = positions[idx * 3 + 2]; // height = localZ
            
            // Find minimum distance to any spline segment
            let minDist = Infinity;
            for (let j = 0; j < window.splinePoints.length - 1; j++) {
                let d = distToSegment(vx, vz, window.splinePoints[j], window.splinePoints[j + 1]);
                if (d < minDist) minDist = d;
            }
            
            if (minDist < ridgeWidth) {
                let nDist = minDist / ridgeWidth;
                let baseFalloff = (Math.cos(nDist * Math.PI) + 1) * 0.5; // Cosine falloff 1→0
                
                // FBM noise for natural variation, scaled by jaggedness
                let noiseVal = fbm(vx * 0.08, vz * 0.08, 3, 2.0, 0.5) * 0.6;
                noiseVal += fbm(vx * 0.2, vz * 0.2, 2, 2.0, 0.5) * 0.3;
                
                // Taper noise at edges, apply jagged multiplier
                let noiseMod = noiseVal * targetHeight * 0.25 * baseFalloff * jaggedMultiplier;
                let newH = origH + (targetHeight * baseFalloff) + noiseMod;
                
                positions[idx * 3 + 2] = newH; // Write to height (localZ)
                modified = true;
            }
        }
    }
    
    if (modified) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    if (window._terrainChunks) window._terrainChunks.syncAll();
        if (typeof window.snapObjectsToGround === 'function') window.snapObjectsToGround();
        if (typeof window.rebuildWaterMask === 'function') window.rebuildWaterMask(true);
        if (window.syncWaterVisual) window.syncWaterVisual();
        if (window.slopeOverlayActive) window.updateSlopeOverlay();
        if (window.contourLinesActive) window.updateContourLines();
        if (window.elevationHeatmapActive) window.updateElevationHeatmap();
    }
    
    // Clear spline points (not smartGreen!)
    if (typeof window.clearSpline === 'function') {
        window.clearSpline();
    }
    
    if (window.showBuildToast) window.showBuildToast('🏔️ Ridge built!', '#38bdf8');
    if (typeof window.saveLevel === 'function') window.saveLevel();
};

window.executeSplineMountain = function() {
        if (!window.splinePoints || window.splinePoints.length < 3) {
            if (window.showBuildToast) {
                window.showBuildToast('⚠️ Draw at least 3 points to create a mountain!', '#f59e0b');
            } else {
                alert('Draw at least 3 points to create a mountain!');
            }
            return;
        }

        // Spara undo-tillstånd
        if (typeof window.saveUndoState === 'function') {
            window.saveUndoState();
        }

        let mtnHeight = parseFloat(document.getElementById('mtn-spline-height').value) || 25;

        // Skapa en stängd kurva och sampla tätt
        let curve = new THREE.CatmullRomCurve3(window.splinePoints, true);
        let numSamples = Math.max(150, window.splinePoints.length * 30);
        let densePts = curve.getPoints(numSamples);

        // Hitta 2D bounding box
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        densePts.forEach(pt => {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.z < minZ) minZ = pt.z;
            if (pt.z > maxZ) maxZ = pt.z;
        });

        let segs = window.TERRAIN_SEGS;
        let size = window.TERRAIN_SIZE;
        let step = size / segs;
        let gxMin = Math.max(0, Math.floor((minX + (size / 2)) / step) - 2);
        let gxMax = Math.min(segs, Math.ceil((maxX + (size / 2)) / step) + 2);
        let gzMin = Math.max(0, Math.floor((minZ + (size / 2)) / step) - 2);
        let gzMax = Math.min(segs, Math.ceil((maxZ + (size / 2)) / step) + 2);

        // Hjälpfunktioner för point-in-polygon och avstånd
        function pointInPolygon(x, z, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                let xi = polygon[i].x, zi = polygon[i].z;
                let xj = polygon[j].x, zj = polygon[j].z;
                let intersect = ((zi > z) !== (zj > z))
                    && (x < (xj - xi) * (z - zi) / (zj - zi + 0.00001) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function distanceToSegmentSq(px, pz, ax, az, bx, bz) {
            let dx = bx - ax;
            let dz = bz - az;
            let l2 = dx * dx + dz * dz;
            if (l2 === 0) return (px - ax) * (px - ax) + (pz - az) * (pz - az);
            let t = ((px - ax) * dx + (pz - az) * dz) / l2;
            t = Math.max(0, Math.min(1, t));
            let projX = ax + t * dx;
            let projZ = az + t * dz;
            let rx = px - projX;
            let rz = pz - projZ;
            return rx * rx + rz * rz;
        }

        function minDistanceToPolygon(x, z, polygon) {
            let minDistSq = Infinity;
            for (let i = 0; i < polygon.length; i++) {
                let next = (i + 1) % polygon.length;
                let dSq = distanceToSegmentSq(x, z, polygon[i].x, polygon[i].z, polygon[next].x, polygon[next].z);
                if (dSq < minDistSq) minDistSq = dSq;
            }
            return Math.sqrt(minDistSq);
        }

        // Samla vertexer inuti
        let insideVertices = [];
        let maxD = 0;
        let positions = window._arcadePlaneGeo.attributes.position.array;
        let stride = segs + 1;

        for (let gz = gzMin; gz <= gzMax; gz++) {
            for (let gx = gxMin; gx <= gxMax; gx++) {
                let idx = gz * stride + gx;
                let vx = positions[idx * 3];
                let vz = -positions[idx * 3 + 1];
                let origH = positions[idx * 3 + 2];

                if (pointInPolygon(vx, vz, densePts)) {
                    let d = minDistanceToPolygon(vx, vz, densePts);
                    if (d > maxD) maxD = d;
                    insideVertices.push({ idx: idx, x: vx, z: vz, origH: origH, d: d });
                }
            }
        }

        if (insideVertices.length === 0 || maxD === 0) {
            if (window.showBuildToast) window.showBuildToast('⚠️ No terrain found inside the shape!', '#f59e0b');
            return;
        }

        let fbm = window.fbm || function(x, y) { return 0; };

        let jaggedMultiplier = 1.0;
        let jaggedSlider = document.getElementById('mtn-spline-jagged');
        if (jaggedSlider) {
            jaggedMultiplier = parseFloat(jaggedSlider.value) / 50.0;
        }

        // Höj terrängen inuti formen
        insideVertices.forEach(v => {
            let t = v.d / maxD;
            // Smoothstep falloff
            let falloff = t * t * (3 - 2 * t);
            
            // FBM noise med frekvens och dämpning, skalat med jaggedMultiplier
            let noiseVal = fbm(v.x * 0.1, v.z * 0.1, 3, 2.0, 0.5) * (mtnHeight * 0.15) * jaggedMultiplier;
            
            // Slutlig höjdändring
            let targetH = v.origH + (mtnHeight + noiseVal) * falloff;
            positions[v.idx * 3 + 2] = targetH;
        });

        // Uppdatera geometri
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        window._arcadePlaneGeo.computeVertexNormals();
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    if (window._terrainChunks) window._terrainChunks.syncAll();

        // Uppdatera skuggor/snäppning/vatten
        if (typeof window.snapObjectsToGround === 'function') window.snapObjectsToGround();
        if (typeof window.rebuildWaterMask === 'function') window.rebuildWaterMask(true);

        // Rensa spline-punkter
        if (typeof window.clearSpline === 'function') {
            window.clearSpline();
        }

        if (window.showBuildToast) window.showBuildToast('⛰️ Mountain built!', '#38bdf8');
        if (typeof window.saveLevel === 'function') window.saveLevel();
    };
})();
