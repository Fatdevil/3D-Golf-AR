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
window._smartShapeClosed = false;

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

// Snap / pick radii that scale with the size of the shape being drawn. A fixed 4 m snap radius
// made it impossible to place a 4th corner on a small bunker (it closed the shape instead).
function smartShapeExtent(pts) {
    if (!pts || pts.length < 2) return 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let q of pts) {
        if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
        if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
    }
    return Math.max(maxX - minX, maxZ - minZ);
}
// distance to the first point that closes the shape (1.2 m .. 4 m)
window.smartSnapRadius = function(pts) {
    return Math.max(1.2, Math.min(4.0, smartShapeExtent(pts) * 0.15));
};
// distance to an outline segment that inserts a point instead of adding one (0.8 m .. 2.5 m)
window.smartInsertRadius = function(pts) {
    return Math.max(0.8, Math.min(2.5, smartShapeExtent(pts) * 0.10));
};

// Does the polyline / polygon formed by the control points cross itself?
// closed=false: open chain (drawing), closed=true: polygon incl. closing segment.
function polylineSelfIntersects(pts, closed) {
    let n = pts ? pts.length : 0;
    if (n < 4) return false; // a triangle (or less) can not cross itself
    let segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
        let a = pts[i], b = pts[(i + 1) % n];
        for (let j = i + 2; j < segs; j++) {
            if (closed && i === 0 && j === n - 1) continue; // adjacent through the closing segment
            let c = pts[j], d = pts[(j + 1) % n];
            if (segmentsIntersect(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) return true;
        }
    }
    return false;
}
window.polylineSelfIntersects = polylineSelfIntersects;

let _lastCrossWarn = 0;
window.warnSelfCrossing = function() {
    if (Date.now() - _lastCrossWarn < 1200) return;
    _lastCrossWarn = Date.now();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (typeof window.showBuildToast === 'function') {
        window.showBuildToast(isSv ? '⚠️ Formen får inte korsa sig själv' : '⚠️ The shape must not cross itself', '#f59e0b');
    }
};

// Would moving control point idx to (x,z) create a crossing that was not there before?
// (a shape that already crosses is left free to move so the user can fix it)
window.moveWouldCross = function(pts, idx, x, z, closed) {
    if (!pts || !pts[idx]) return false;
    if (polylineSelfIntersects(pts, closed)) return false;
    let test = pts.map(p => ({ x: p.x, z: p.z }));
    test[idx] = { x: x, z: z };
    return polylineSelfIntersects(test, closed);
};

// Would inserting a new control point at (x,z) before index insertIdx create a crossing?
window.insertWouldCross = function(pts, insertIdx, x, z) {
    if (!pts) return false;
    let closed = pts.length >= 3;
    if (polylineSelfIntersects(pts, closed)) return false;
    let test = pts.map(p => ({ x: p.x, z: p.z }));
    test.splice(insertIdx, 0, { x: x, z: z });
    return polylineSelfIntersects(test, closed);
};

// Called by the build buttons: refuse to build a self-crossing outline
window.validateSmartShape = function(pts) {
    if (polylineSelfIntersects(pts, true)) { window.warnSelfCrossing(); return false; }
    return true;
};

// Smart point placement: append point, with magnetic snapping to close the shape
function smartAddPoint(pt) {
    if(window._smartShapeClosed) {
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        if (typeof window.showBuildToast === 'function') {
            window.showBuildToast(isSv ? '🔒 Formen är redan stängd! Klicka på Bygg eller dra i bollarna.' : '🔒 Shape is already closed! Click Build or drag balls.', '#38bdf8');
        }
        return false;
    }

    // Magnet-snap: if >= 3 points and click is within 4.0m of FIRST point -> close shape!
    if(smartGreenPoints.length >= 3) {
        let first = smartGreenPoints[0];
        let dist = Math.hypot(pt.x - first.x, pt.z - first.z);
        if(dist < window.smartSnapRadius(smartGreenPoints)) {
            if (polylineSelfIntersects(smartGreenPoints, true)) { window.warnSelfCrossing(); return false; }
            window._smartShapeClosed = true;
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            if (typeof window.showBuildToast === 'function') {
                window.showBuildToast(isSv ? '🔒 Formen är stängd! Klicka på Bygg för att skapa.' : '🔒 Shape closed! Click Build to create.', '#4ade80');
            }
            if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
            return true;
        }
    }

    // Refuse a point whose new segment would cross the outline drawn so far
    if (smartGreenPoints.length >= 3 && !polylineSelfIntersects(smartGreenPoints, false) &&
        polylineSelfIntersects(smartGreenPoints.concat([pt]), false)) {
        window.warnSelfCrossing();
        return false;
    }

    smartGreenPoints.push(pt);
    return true;
}
window.smartAddPoint = smartAddPoint;

function resortTeesForAimPoint(hole) {
    if (!hole.aimPoint) return;
    if (window.autoAssignTeeColors) window.autoAssignTeeColors(hole);
    let ap = hole.aimPoint;
    let orderedKeys = ['red','yellow','white','black'];
    let colorEmoji = { red: '🔴', yellow: '🟡', white: '⚪', black: '⬛' };
    if (!hole.tees || !hole.teeMeshes) return;
    normalizeTeeOwnership(hole); // old saves may list one colour on several boxes

    // Markers are only swapped inside the tee box that owns their colour, so a marker
    // never jumps into another box. Colours that no box owns (old saves) form one group.
    let owned = {};
    let groups = [];
    (hole.teeBoxes || []).forEach(function(tb) {
        let cols = orderedKeys.filter(function(k) { return (tb.activeTees || []).indexOf(k) >= 0; });
        cols.forEach(function(k) { owned[k] = true; });
        if (cols.length > 0) groups.push(cols);
    });
    let loose = orderedKeys.filter(function(k) { return !owned[k]; });
    if (loose.length > 0) groups.push(loose);

    let touched = [];
    groups.forEach(function(cols) {
        let existingTees = cols.filter(function(k) { return hole.tees[k] && hole.teeMeshes[k]; });
        if (existingTees.length >= 2) {
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
        } else if(existingTees.length === 1) {
            let k = existingTees[0];
            let rot = Math.atan2(ap.x - hole.tees[k].x, ap.z - hole.tees[k].z);
            hole.tees[k].rot = rot;
            hole.teeMeshes[k].rotation.y = rot;
        }
        touched = touched.concat(existingTees);
    });
    if (touched.length >= 2) {
        let distText = orderedKeys.filter(function(k) { return touched.indexOf(k) >= 0; }).map(function(k) {
            let dx = hole.tees[k].x - ap.x;
            let dz = hole.tees[k].z - ap.z;
            return colorEmoji[k] + ' ' + Math.round(Math.sqrt(dx*dx + dz*dz)) + 'm';
        }).join('  ');
        window.showBuildToast('🔄 Tees sorted: ' + distText, '#a855f7');
    }
}

// Auto-sort tees: reassign colors so Red=closest to flag, Black=furthest
function autoSortTees(hole) {
    if (!hole.flag) return;
    if (window.autoAssignTeeColors) window.autoAssignTeeColors(hole);
    // Colours owned by a built tee box are never reshuffled here (boxes are oriented by the aim point);
    // only loose, separately placed markers are sorted by distance to the flag.
    normalizeTeeOwnership(hole);
    let ownedColors = {};
    (hole.teeBoxes || []).forEach(function(tb) {
        if (tb.points && tb.points.length >= 3) (tb.activeTees || []).forEach(function(c) { ownedColors[c] = true; });
    });
    let colorOrder = ['red', 'yellow', 'white', 'black'].filter(function(c) { return !ownedColors[c]; });
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
    let isBunker = (window._smartBuilderType === 'BUNKER');
    let isFairway = (window._smartBuilderType === 'FAIRWAY');
    let isTee = (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM');

    if (isGreen && window.GreenStudio && !window.GreenStudio.group && window._arcadeScene) {
        window.GreenStudio.init(window._arcadeScene);
    }
    if (isBunker && window.BunkerStudio && !window.BunkerStudio.group && window._arcadeScene) {
        window.BunkerStudio.init(window._arcadeScene);
    }
    if (isFairway && window.FairwayStudio && !window.FairwayStudio.group && window._arcadeScene) {
        window.FairwayStudio.init(window._arcadeScene);
    }
    if (isTee && window.TeeStudio && !window.TeeStudio.group && window._arcadeScene) {
        window.TeeStudio.init(window._arcadeScene);
    }

    let ballGeo = new THREE.SphereGeometry(0.85, 24, 24);
    let ballGeoFirst = new THREE.SphereGeometry(1.2, 24, 24);
    let ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.05, depthTest: false });
    let ballMatFirst = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
        metalness: 0.1,
        depthTest: false,
        emissive: (smartGreenPoints.length >= 3 && !window._smartShapeClosed) ? 0x22c55e : 0x000000,
        emissiveIntensity: (smartGreenPoints.length >= 3 && !window._smartShapeClosed) ? 0.4 : 0.0
    });

    let ringColor = isBunker ? 0xfbbf24 : (isFairway ? 0x7db952 : (isTee ? 0x38bdf8 : 0x4ade80));

    smartGreenPoints.forEach((pt, idx) => {
        let isFirst = (idx === 0);
        let s = new THREE.Mesh(isFirst ? ballGeoFirst : ballGeo, isFirst ? ballMatFirst : ballMat);
        let y = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(pt.x, pt.z) : pt.y;
        let yOffset = isFirst ? 1.15 : 0.85;
        s.position.set(pt.x, y + yOffset, pt.z);
        s.renderOrder = 999;
        s.userData = { isSmartGreenBall: true, pointIndex: idx };

        if (isFirst) {
            let ringGeo = new THREE.RingGeometry(1.2, 1.75, 32);
            ringGeo.rotateX(-Math.PI / 2);
            let ringMat = new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
            let ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(0, -1.05, 0);
            ring.renderOrder = 998;
            s.add(ring);
        }

        window._arcadeScene.add(s);
        smartGreenSpheres.push(s);
    });

    if(smartGreenPoints.length > 1) {
        let shouldClose = !!window._smartShapeClosed;
        let v3Pts = smartGreenPoints.map(p => {
            let y = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(p.x, p.z) : p.y;
            return new THREE.Vector3(p.x, y + 0.22, p.z);
        });

        let curve = new THREE.CatmullRomCurve3(v3Pts, shouldClose, 'catmullrom', 0.5);
        let curvePts = curve.getPoints(Math.max(60, 30 * smartGreenPoints.length));
        let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
        let lineColor = isBunker ? (shouldClose ? 0xfbbf24 : 0xfef08a)
            : (isFairway ? (shouldClose ? 0x7db952 : 0xa3e635)
            : (isTee ? (shouldClose ? 0x38bdf8 : 0x93c5fd)
            : (shouldClose ? 0x4ade80 : 0x38bdf8)));
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
    let shouldClose = !!window._smartShapeClosed;
    let v3Pts = smartGreenPoints.map(p => {
        let y = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(p.x, p.z) : (p.y || 0);
        return new THREE.Vector3(p.x, y + 0.22, p.z);
    });
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
    } else if ((window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM') && typeof window.updateSBTeeControls === 'function') {
        window.updateSBTeeControls();
    }
};

window.undoSmartGreenPoint = function() {
    if (smartGreenPoints.length > 0) {
        if (window._smartShapeClosed) {
            // Re-open closed loop
            window._smartShapeClosed = false;
        } else {
            smartGreenPoints.pop();
        }
        updateSmartGreenPreview();
        if (window._smartBuilderType === 'GREEN' && typeof window.updateSBGreenControls === 'function') {
            window.updateSBGreenControls();
        } else if (window._smartBuilderType === 'FAIRWAY' && typeof window.updateSBFairwayControls === 'function') {
            window.updateSBFairwayControls();
        } else if (window._smartBuilderType === 'BUNKER' && typeof window.updateSBBunkerControls === 'function') {
            window.updateSBBunkerControls();
        } else if ((window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM') && typeof window.updateSBTeeControls === 'function') {
            window.updateSBTeeControls();
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
    if (window.BunkerStudio) {
        window.BunkerStudio.sync();
        return;
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

// === SOFT-EDGE AWARE TEXTURE RESTORE (bunker + tee) ===
// A blurred (edgeSharpness < 100) fill spreads a halo outside the outline. Restoring only the
// interior of the outline left that halo behind after move / reshape / delete.
function softEdgeMargin(sharpness) {
    let blurPx = (sharpness !== undefined && sharpness < 100) ? Math.round((100 - sharpness) * 0.06) : 0;
    return 0.6 + blurPx * 3 * (window.TERRAIN_SIZE / 4096);
}

// obj: bunker / tee box (uses obj._paint = { poly, margin } = what was last painted).
// Puts the original pixels back under the whole painted footprint. Returns true when exact.
function restoreSurfaceFootprint(obj, hole, fallbackPoly, snapCanvasKey) {
    if (!obj || !window._arcadePCtx) return false;
    let fp = (obj._paint && obj._paint.poly && obj._paint.poly.length >= 3)
        ? obj._paint : { poly: fallbackPoly, margin: softEdgeMargin(obj.edgeSharpness) };
    if (!fp.poly || fp.poly.length < 3) return false;
    let region = offsetPolygon(fp.poly, fp.margin);
    let ctx = window._arcadePCtx;
    let S = window.TERRAIN_SIZE;
    ctx.save();
    ctx.filter = 'none';
    ctx.beginPath();
    region.forEach((pt, i) => {
        let pxX = ((pt.x + S / 2) / S) * 4096;
        let pxY = ((pt.z + S / 2) / S) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY); else ctx.lineTo(pxX, pxY);
    });
    ctx.closePath();
    let exact = false;
    if (obj.origCanvasPixels && obj.bbox && obj.bbox.pw > 0 && obj.bbox.ph > 0) {
        if (!window[snapCanvasKey]) window[snapCanvasKey] = document.createElement('canvas');
        window[snapCanvasKey].width = obj.bbox.pw;
        window[snapCanvasKey].height = obj.bbox.ph;
        window[snapCanvasKey].getContext('2d').putImageData(obj.origCanvasPixels, 0, 0);
        ctx.clip();
        ctx.drawImage(window[snapCanvasKey], obj.bbox.pxMinX, obj.bbox.pxMinY);
        exact = true;
    } else {
        ctx.fillStyle = getBaseGroundColor(hole);
        ctx.fill();
    }
    ctx.restore();
    obj._footprintRestored = exact;
    return exact;
}

// Repaint every texture layer of the hole in stacking order: fairways, tee boxes, bunkers, green.
// Call after a restore/removal so neighbours that overlapped the restored area are painted back.
window.repaintAllTextures = function(hole, syncBiome) {
    if (!hole || !window._arcadePCtx) return;
    ensureHoleFairways(hole);
    (hole.fairways || []).forEach(fd => paintFairwayTexture(fd));
    window.repaintUpperTextures(hole);
    if (syncBiome !== false) {
        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
        window.invalidateBiomeData(true);
        if (typeof window.debounceRebuildRoughMask === 'function') window.debounceRebuildRoughMask(200);
        else if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    }
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
    if (window._arcadePCtx) {
        try {
            let pix = window._arcadePCtx.getImageData(10, 10, 1, 1).data;
            if (pix[3] === 255) {
                return '#' + ((1 << 24) + (pix[0] << 16) + (pix[1] << 8) + pix[2]).toString(16).slice(1);
            }
        } catch(e) {}
    }
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let curHole = hole || (window.courseHoles && window.courseHoles[window.currentHoleIndex]);
    let surr = (curHole && curHole.surroundConfig) || window.surroundConfig;
    if (surr && (surr.N || surr.E || surr.S || surr.W)) {
        let surrKey = surr.N || surr.E || surr.S || surr.W;
        if (cfg[surrKey]) return cfg[surrKey];
    }
    return cfg.fescueColor || cfg.roughColor || '#4a782b';
}
window.getBaseGroundColor = getBaseGroundColor;


// 1.5. Cleanly erase a bunker's footprint from 2D canvas texture
window.eraseBunkerTexture = function(bd, hole) {
    if (!bd || !bd.points || !window._arcadePCtx) return;
    // exact original pixels were already put back - do not flatten them with the base colour
    if (bd._footprintRestored) { bd._footprintRestored = false; return; }
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
            restoreSurfaceFootprint(bd, hole, densePts || getDenseBunkerPoints(bd.points), '_bunkerSnapCanvas');
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

    // === PAINT PASS === (old footprint incl. soft-edge halo removed, then the whole stack repainted)
    if (updateTexture && window._arcadePCtx) {
        bds.forEach(bd => {
            if (bd && bd.points && bd.points.length >= 3) restoreSurfaceFootprint(bd, hole, getDenseBunkerPoints(bd.points), '_bunkerSnapCanvas');
        });
        window.repaintAllTextures(hole, false);
    }

    bds.forEach(bd => {
        if (!bd || !bd.points || bd.points.length < 3) return;
        let densePts = getDenseBunkerPoints(bd.points);

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

            let cx = 0, cz = 0;
            for(let pt of bd.points) { cx += pt.x; cz += pt.z; }
            cx /= bd.points.length;
            cz /= bd.points.length;

            let maxDist = 0;
            for(let pt of densePts) {
                let d = Math.sqrt((pt.x - cx)**2 + (pt.z - cz)**2);
                if(d > maxDist) maxDist = d;
            }

            // Face direction: lip side (calculated from bd.lipAngle, bd.lipToFlag, or points[0])
            let faceDx, faceDz, faceLen;
            if (bd.lipToFlag && hole.flag) {
                let fx = hole.flag.x !== undefined ? hole.flag.x : (hole.flag.position ? hole.flag.position.x : 0);
                let fz = hole.flag.z !== undefined ? hole.flag.z : (hole.flag.position ? hole.flag.position.z : 0);
                let dx = fx - cx, dz = fz - cz;
                let dLen = Math.sqrt(dx*dx + dz*dz) + 0.001;
                faceDx = dx / dLen;
                faceDz = dz / dLen;
                faceLen = Math.max(3.0, maxDist * 0.75);
            } else if (bd.lipAngle !== undefined) {
                faceDx = Math.sin(bd.lipAngle);
                faceDz = Math.cos(bd.lipAngle);
                faceLen = Math.max(3.0, maxDist * 0.75);
            } else {
                let facePt = bd.points[0];
                faceDx = facePt.x - cx;
                faceDz = facePt.z - cz;
                faceLen = Math.sqrt(faceDx*faceDx + faceDz*faceDz) + 0.001;
                faceDx /= faceLen; faceDz /= faceLen;
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
        if (window._arcadePCtx) window.invalidateBiomeData(true);
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(500);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) window._terrainChunks.syncAll();
    if (window._terrainShells && window._terrainShells.quality !== 'OFF') window._terrainShells.syncHeights();
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

// 3.5. Dedicated Bunker Texture Repainting (2D canvas only - zero geometry or 3D terrain distortion)
window.repaintBunkersTextureOnly = function(hole) {
    if (!hole || !window._arcadePCtx) return;
    if (typeof ensureHoleBunkers === 'function') ensureHoleBunkers(hole);
    let bds = (hole.bunkers && hole.bunkers.length > 0) ? hole.bunkers : (hole.bunkerData ? [hole.bunkerData] : []);
    if (bds.length === 0) return;

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let defaultSand = cfg.bunkerColor || '#e0d8a4';
    let ctx = window._arcadePCtx;

    bds.forEach(bd => {
        if (!bd || !bd.points || bd.points.length < 3) return;
        let densePts = (typeof getDenseBunkerPoints === 'function') ? getDenseBunkerPoints(bd.points) : bd.points;
        if (!densePts || densePts.length < 3) return;

        ctx.save();
        let sharpness = bd.edgeSharpness !== undefined ? bd.edgeSharpness : 100;
        if (sharpness < 100) {
            let blurPx = Math.round((100 - sharpness) * 0.06);
            if (blurPx > 0) ctx.filter = 'blur(' + blurPx + 'px)';
        } else {
            ctx.filter = 'none';
        }

        ctx.beginPath();
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            if (i === 0) ctx.moveTo(pxX, pxY);
            else ctx.lineTo(pxX, pxY);
        });
        ctx.closePath();
        ctx.fillStyle = bd.sandColor || defaultSand;
        ctx.fill();

        ctx.filter = 'none';
        ctx.restore();
        bd._paint = { poly: densePts, margin: softEdgeMargin(sharpness) };
    });
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

    // remember what is currently painted (old sharpness/outline) so the pipeline can remove the old halo
    if (!bd._paint && bd.points && bd.points.length >= 3) bd._paint = { poly: getDenseBunkerPoints(bd.points), margin: softEdgeMargin(bd.edgeSharpness) };

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
    window.repaintAllTextures(hole);

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
    if (window._arcadePCtx) window.invalidateBiomeData(true);
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
    window.repaintAllTextures(hole);

    if (hole.fairways && hole.fairways.length > 0 && typeof window.applyFairwayPipeline === 'function') {
        window.applyFairwayPipeline(hole, false, true);
    }
    if (hole.greenData && typeof window.applyGreenPipeline === 'function') {
        window.applyGreenPipeline(hole, false, true);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.invalidateBiomeData(true);
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
    if (window._arcadePCtx) window.invalidateBiomeData(true);
    if (typeof window.debounceRebuildRoughMask === 'function') {
        window.debounceRebuildRoughMask(50);
    } else if (typeof window.rebuildRoughMask === 'function') {
        window.rebuildRoughMask();
    }
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
    window.repaintAllTextures(hole);

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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
    if (!window.validateSmartShape(smartGreenPoints)) return;
    window._smartShapeClosed = true;
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
    // null means "drawing a new fairway" - never coerce it to 0 (same contract as getActiveBunker)
    if (hole.activeFairwayIndex === null || hole.activeFairwayIndex === undefined) {
        return null;
    }
    return hole.fairways[hole.activeFairwayIndex] || null;
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
    // When FairwayStudio is active, FairwayStudio manages and renders the 3D spline contour
    if (window.FairwayStudio) {
        return;
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
    // The exact original pixels were already put back by restoreFairwayFootprint - erasing with a
    // flat base colour afterwards would only destroy them again.
    if (fd.origCanvasPixels && fd.bbox && fd._footprintRestored) { fd._footprintRestored = false; return; }
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

// Footprint of what the fairway pipeline last PAINTED: outline + ring (semi-rough + rough) width.
// Falls back to the current outline/widths when nothing has been painted yet in this session.
function fairwayFootprint(fd) {
    if (fd._paint && fd._paint.poly && fd._paint.poly.length >= 3) return fd._paint;
    let semi = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
    let rough = (fd.roughEnabled !== false) ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;
    return { poly: getDenseFairwayPoints(fd.points), ring: rough > 0 ? semi + rough : semi };
}

// Put back the ORIGINAL pixels under everything this fairway painted (outline + rough/semi ring).
// Restoring only the inside of the outline left the rings behind as "ghosts" after reshaping,
// moving or narrowing them.
window.restoreFairwayFootprint = function(fd, hole) {
    if (!fd || !fd.points || fd.points.length < 3 || !window._arcadePCtx) return;
    let fp = fairwayFootprint(fd);
    if (!fp.poly || fp.poly.length < 3) return;
    let region = offsetPolygon(fp.poly, fp.ring + 0.6);
    let ctx = window._arcadePCtx;
    let S = window.TERRAIN_SIZE;
    ctx.save();
    ctx.filter = 'none';
    ctx.beginPath();
    region.forEach((pt, i) => {
        let pxX = ((pt.x + S / 2) / S) * 4096;
        let pxY = ((pt.z + S / 2) / S) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY); else ctx.lineTo(pxX, pxY);
    });
    ctx.closePath();
    if (fd.origCanvasPixels && fd.bbox && fd.bbox.pw > 0 && fd.bbox.ph > 0) {
        if (!window._fairwaySnapCanvas) window._fairwaySnapCanvas = document.createElement('canvas');
        window._fairwaySnapCanvas.width = fd.bbox.pw;
        window._fairwaySnapCanvas.height = fd.bbox.ph;
        window._fairwaySnapCanvas.getContext('2d').putImageData(fd.origCanvasPixels, 0, 0);
        ctx.clip();
        ctx.drawImage(window._fairwaySnapCanvas, fd.bbox.pxMinX, fd.bbox.pxMinY);
        fd._footprintRestored = true;
    } else {
        // No snapshot (course reloaded from file): best effort - flat base colour
        ctx.fillStyle = getBaseGroundColor(hole);
        ctx.fill();
    }
    ctx.restore();
};

// 2. Restore pristine baseline ground & texture before applying modified parameters
window.restoreFairwayBase = function(hole, restoreTexture, targetFairway) {
    if (restoreTexture === undefined) restoreTexture = false;
    if (!hole) return;
    ensureHoleFairways(hole);
    let fds = targetFairway ? [targetFairway] : (hole.fairways && hole.fairways.length > 0 ? hole.fairways : (hole.fairwayData ? [hole.fairwayData] : []));
    if (fds.length === 0) return;

    // Green protection: gather green points if hole has a green
    let greenPts = null;
    let greenBlend = 8.0;
    if (hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3) {
        let gd = hole.greenData;
        let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
        greenPts = (gd.densePts && gd.densePts.length >= 3) ? gd.densePts : ((typeof getDenseGreenPoints === 'function') ? getDenseGreenPoints(gd.points, tension) : gd.points);
        greenBlend = (gd.blendDistance !== undefined ? gd.blendDistance : 8.0) + 1.0;
    }

    fds.forEach(fd => {
        if (!fd || !fd.bbox) return;
        // If this fairway is FLAT and was never sculpted, don't restore heights
        let isCurrentlySculpted = fd._isSculpted || (fd.difficulty && fd.difficulty !== 'FLAT');
        if (!isCurrentlySculpted && !restoreTexture) return;

        let densePts = (fd.points && fd.points.length >= 3 && typeof getDenseFairwayPoints === 'function') ? getDenseFairwayPoints(fd.points) : null;
        let semiRoughWidth = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
        let roughWidth = (fd.roughEnabled !== false) ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;
        let maxReach = semiRoughWidth + roughWidth + 12.0;

        // Restore vertex heights across organic fairway zone without rectangular scars
        if (fd.origHeights && window._arcadePlaneGeo && isCurrentlySculpted) {
            let positions = window._arcadePlaneGeo.attributes.position.array;
            let gWidth = fd.bbox.gWidth;

            for(let gz = fd.bbox.gzStart; gz <= fd.bbox.gzEnd; gz++) {
                for(let gx = fd.bbox.gxStart; gx <= fd.bbox.gxEnd; gx++) {
                    let idx = gz * (window.TERRAIN_SEGS+1) + gx;
                    let vx = positions[idx*3];
                    let vz = -positions[idx*3+1];

                    // Never overwrite green hill heights!
                    if (greenPts) {
                        let inG = pointInPolygon(vx, vz, greenPts);
                        if (inG) continue;
                        let dG = distToPolygon(vx, vz, greenPts);
                        if (dG < greenBlend) continue;
                    }

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

        // Restore 2D canvas texture: original pixels under the whole painted footprint (outline + ring)
        if (restoreTexture) {
            window.restoreFairwayFootprint(fd, hole);
        }
    });
};


// Paint one fairway (rough ring, semi-rough ring, fill, mowing pattern) and remember its footprint
function paintFairwayTexture(fd) {
    if (!fd || !fd.points || fd.points.length < 3 || !window._arcadePCtx) return;
    let ctx = window._arcadePCtx;
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let fairwayColor = cfg.fairwayColor || '#7db952';
    let semiRoughColor = cfg.semiColor || '#6b9e3d';
    let roughColor = cfg.roughColor || '#4a782b';
    let densePts = getDenseFairwayPoints(fd.points);
    let S = window.TERRAIN_SIZE;

    ctx.save();
    function traceFairwayPath() {
        ctx.beginPath();
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (S / 2)) / S) * 4096;
            let pxY = ((pt.z + (S / 2)) / S) * 4096;
            if (i === 0) ctx.moveTo(pxX, pxY);
            else ctx.lineTo(pxX, pxY);
        });
        ctx.closePath();
    }

    let semiRoughWidth = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
    let roughEnabled = (fd.roughEnabled !== false);
    let roughWidth = roughEnabled ? (fd.roughWidth !== undefined ? fd.roughWidth : 5.0) : 0;

    if (roughWidth > 0) {
        traceFairwayPath();
        ctx.lineWidth = (semiRoughWidth + roughWidth) * 2 * (4096 / S);
        ctx.strokeStyle = roughColor;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.fillStyle = roughColor;
        ctx.fill();
    }
    if (semiRoughWidth > 0) {
        traceFairwayPath();
        ctx.lineWidth = semiRoughWidth * 2 * (4096 / S);
        ctx.strokeStyle = semiRoughColor;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.fillStyle = semiRoughColor;
        ctx.fill();
    }
    traceFairwayPath();
    ctx.fillStyle = fairwayColor;
    ctx.fill();

    let mowPattern = fd.mowPattern || 'SOLID';
    if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
        paintMowingPattern(ctx, densePts, fairwayColor, mowPattern);
    }
    ctx.filter = 'none';
    ctx.restore();

    fd._paint = { poly: densePts, ring: roughWidth > 0 ? semiRoughWidth + roughWidth : semiRoughWidth };
}
window.paintFairwayTexture = paintFairwayTexture;

// Everything that is stacked ON TOP of the fairways on the 2D canvas, in order.
window.repaintUpperTextures = function(hole) {
    if (!hole) return;
    if (typeof window.repaintTeeTextureOnly === 'function') window.repaintTeeTextureOnly(hole);
    if (typeof window.repaintBunkersTextureOnly === 'function') window.repaintBunkersTextureOnly(hole);
    if (hole.greenData && typeof window.repaintGreenTextureOnly === 'function') window.repaintGreenTextureOnly(hole);
};

// === LAYER ORDER: fairway (base) -> tee / bunker (upper) ===
// Tee plateaus and bunker dig-outs are stored as height edits on top of a captured baseline
// (origHeights). When a sculpted fairway is (re)applied it rewrites the terrain underneath them,
// and their baselines contain the OLD fairway waves. To keep the layers consistent every fairway
// height edit is bracketed by: detach (remove upper-layer edits) -> fairway edit ->
// attach (re-capture baseline from the new terrain, re-apply the upper-layer edits, heights only).
window._upperLayerDepth = 0;
window._upperLayerSince = 0;

window.anyFairwaySculpted = function(hole) {
    return !!(hole && hole.fairways && hole.fairways.some(function(f) {
        return f && (f._isSculpted || (f.difficulty && f.difficulty !== 'FLAT'));
    }));
};

window.detachUpperLayers = function(hole) {
    if (!hole) return;
    // Self-heal if a previous edit threw before attach
    if (window._upperLayerDepth > 0 && Date.now() - window._upperLayerSince > 8000) window._upperLayerDepth = 0;
    window._upperLayerDepth++;
    if (window._upperLayerDepth > 1) return;
    window._upperLayerSince = Date.now();
    ensureHoleBunkers(hole);
    ensureHoleTeeBoxes(hole);
    // Reverse of apply order: bunkers first, then tee boxes
    (hole.bunkers || []).forEach(function(bd) {
        if (bd && bd.origHeights && bd.bbox) window.restoreBunkerBase(hole, false, bd);
    });
    (hole.teeBoxes || []).forEach(function(tb) {
        if (tb && tb.origHeights && tb.bbox && tb.points && tb.points.length >= 3) window.restoreTeeHeightsOnly(tb);
    });
};

window.attachUpperLayers = function(hole) {
    if (!hole || window._upperLayerDepth <= 0) return;
    window._upperLayerDepth--;
    if (window._upperLayerDepth > 0) return;
    try {
        ensureHoleBunkers(hole);
        ensureHoleTeeBoxes(hole);
        (hole.teeBoxes || []).forEach(function(tb) {
            if (!tb || !tb.bbox || !tb.points || tb.points.length < 3) return;
            let snap = window.captureTeeSnapshot(hole, tb.points, tb.bbox.margin || 25);
            tb.bbox = snap.bbox;
            tb.origHeights = snap.origHeights;
            tb.baseElevation = snap.baseElevation;
            window.applyTeePipeline(hole, false, false, tb, true);
        });
        (hole.bunkers || []).forEach(function(bd) {
            if (!bd || !bd.bbox || !bd.points || bd.points.length < 3) return;
            let snap = window.captureBunkerSnapshot(hole, bd.points, bd.bbox.margin || 15);
            bd.bbox = snap.bbox;
            bd.origHeights = snap.origHeights;
            bd.baseElevation = snap.baseElevation;
            window.applyBunkerPipeline(hole, false, false, bd);
        });
    } catch (err) {
        console.error('[SMART BUILDER] attachUpperLayers failed:', err);
    }
};

// Convenience: returns true when layers were detached (pass the result to endUpperLayerEdit)
window.beginUpperLayerEdit = function(hole, force) {
    if (!hole) return false;
    ensureHoleBunkers(hole);
    ensureHoleTeeBoxes(hole);
    let hasUpper = (hole.bunkers && hole.bunkers.length > 0) || (hole.teeBoxes && hole.teeBoxes.length > 0);
    if (!hasUpper) return false;
    if (!force && !window.anyFairwaySculpted(hole)) return false;
    window.detachUpperLayers(hole);
    return true;
};
window.endUpperLayerEdit = function(hole, active) {
    if (active) window.attachUpperLayers(hole);
};

// 3. Apply full fairway pipeline (Painting + Sculpting)
window.applyFairwayPipeline = function(hole, isInitial, updateTexture, targetFairway) {
    if (!hole) return;
    if (window._isApplyingFairwayPipeline) return;
    window._isApplyingFairwayPipeline = true;
    let _layersDetached = false;
    try {
        ensureHoleFairways(hole);
        let fds = targetFairway ? [targetFairway] : (hole.fairways && hole.fairways.length > 0 ? hole.fairways : (hole.fairwayData ? [hole.fairwayData] : []));
        if (fds.length === 0) return;
        if (updateTexture === undefined) updateTexture = true;

        // Lift tee/bunker height edits off the terrain while the fairway rewrites it
        _layersDetached = window.beginUpperLayerEdit(hole);

        // Reset ground vertex heights to pristine baseline for targeted fairway(s)
        window.restoreFairwayBase(hole, false, targetFairway);

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let fairwayColor = cfg.fairwayColor || '#7db952';
    let semiRoughColor = cfg.semiColor || '#6b9e3d';
    let roughColor = cfg.roughColor || '#4a782b';

    // === PAINT PASS ===
    // 1) put the original pixels back under each targeted fairway's previous footprint
    // 2) paint all fairways of the hole in index order (stable stacking where they overlap)
    if (updateTexture && window._arcadePCtx) {
        fds.forEach(fd => { if (fd && fd.points && fd.points.length >= 3) window.restoreFairwayFootprint(fd, hole); });
        let allFds = (hole.fairways && targetFairway && hole.fairways.indexOf(targetFairway) >= 0) ? hole.fairways : fds;
        allFds.forEach(fd => paintFairwayTexture(fd));
    }

    fds.forEach(fd => {
        if (!fd || !fd.points || fd.points.length < 3) return;
        let densePts = getDenseFairwayPoints(fd.points);

        // === SCULPT PASS ===
        let difficulty = fd.difficulty || 'FLAT';
        if (difficulty !== 'FLAT' && fd.bbox && fd.origHeights) {
            // Green protection: gather green points if hole has a green
            let greenPts = null;
            let greenBlend = 8.0;
            if (hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3) {
                let gd = hole.greenData;
                let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
                greenPts = (gd.densePts && gd.densePts.length >= 3) ? gd.densePts : ((typeof getDenseGreenPoints === 'function') ? getDenseGreenPoints(gd.points, tension) : gd.points);
                greenBlend = (gd.blendDistance !== undefined ? gd.blendDistance : 8.0) + 1.0;
            }

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

                    // Never sculpt/undulate green hill heights!
                    if (greenPts) {
                        let inG = pointInPolygon(vx, vz, greenPts);
                        if (inG) continue;
                        let dG = distToPolygon(vx, vz, greenPts);
                        if (dG < greenBlend) continue;
                    }

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

    // Re-render Tee, Bunkers & Smart Green texture on top so they always stay on top of fairway on 2D canvas
    if (updateTexture) window.repaintUpperTextures(hole);

    if (updateTexture && window._arcadeMapTex) {
        window._arcadeMapTex.needsUpdate = true;
        if (window._arcadePCtx) window.invalidateBiomeData(true);
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(500);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }

    // Sync mesh geometry only if difficulty is not FLAT or if fairway was previously sculpted
    let hasNonFlat = fds.some(fd => fd.difficulty && fd.difficulty !== 'FLAT');
    let hadSculpted = fds.some(fd => fd._isSculpted);
    let needsGeometrySync = hasNonFlat || hadSculpted;

    if (needsGeometrySync) {
        if (window._arcadePlaneGeo) {
            window._arcadePlaneGeo.attributes.position.needsUpdate = true;
            if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
            window._arcadePlaneGeo.computeBoundingBox();
            window._arcadePlaneGeo.computeBoundingSphere();
        }
        if (window._terrainChunks) window._terrainChunks.syncAll();
        if (window._terrainShells && window._terrainShells.quality !== 'OFF') window._terrainShells.syncHeights();
        window.snapObjectsToGround();

        if(window.slopeOverlayActive && typeof window.updateSlopeOverlay === 'function') window.updateSlopeOverlay();
        if(window.contourLinesActive && typeof window.updateContourLines === 'function') window.updateContourLines();
        if(window.elevationHeatmapActive && typeof window.updateElevationHeatmap === 'function') window.updateElevationHeatmap();
    }

    fds.forEach(fd => {
        fd._isSculpted = (fd.difficulty && fd.difficulty !== 'FLAT');
    });
    } finally {
        window._isApplyingFairwayPipeline = false;
        window.endUpperLayerEdit(hole, _layersDetached);
    }
};

// 4. Live reactive update triggered from UI sliders or buttons
window.updateLiveFairway = function(property, value) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    if (typeof ensureHoleFairways === 'function') ensureHoleFairways(hole);
    let fd = (typeof getActiveFairway === 'function') ? getActiveFairway(hole) : null;
    if (!fd) return; // drawing a new fairway: slider values are read at build time

    // If loaded from file without in-memory snapshot, capture baseline now
    if (!fd.origHeights && fd.points && typeof window.captureFairwaySnapshot === 'function') {
        let snap = window.captureFairwaySnapshot(hole, fd.points, 35);
        fd.bbox = snap.bbox;
        fd.origHeights = snap.origHeights;
        fd.origCanvasPixels = snap.origCanvasPixels;
        if (fd.baseElevation === undefined) fd.baseElevation = snap.baseElevation;
    }

    // Remember what is CURRENTLY painted (old widths / outline) before the property changes, so the
    // pipeline can remove the old ring instead of leaving it behind (course reloaded from file).
    if (!fd._paint && fd.points && fd.points.length >= 3) fd._paint = fairwayFootprint(fd);

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
                if (window.FairwayStudio) window.FairwayStudio.sync();
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
    let _layers = window.beginUpperLayerEdit(hole);
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

    // Re-apply any remaining fairways & green/bunkers so everything is clean and properly layered
    if (hole.fairways.length > 0) {
        window.applyFairwayPipeline(hole, false, true);
    } else {
        window.repaintUpperTextures(hole);
    }
    window.endUpperLayerEdit(hole, _layers);

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.invalidateBiomeData(true);
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
    }
    if (window._terrainChunks) {
        window._terrainChunks.syncAll();
    }
    if (window._terrainShells && window._terrainShells.quality !== 'OFF') window._terrainShells.syncHeights();
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
    let _layers = window.beginUpperLayerEdit(hole);
    hole.fairways.forEach(fd => {
        window.restoreFairwayBase(hole, true, fd);
        if (typeof window.eraseFairwayTexture === 'function') {
            window.eraseFairwayTexture(fd);
        }
    });

    hole.fairways = [];
    hole.fairwayData = null;
    hole.activeFairwayIndex = null;

    window.endUpperLayerEdit(hole, _layers);

    // 2. Re-apply bunker and green textures on top if they exist
    window.repaintUpperTextures(hole);

    // 3. Sync textures and masks
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.invalidateBiomeData(true);
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    // 4. Sync geometry
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        let baseGroundColor = getBaseGroundColor(hole);
        let baseRgb = hexToRgb(baseGroundColor);

        for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i+1], b = d[i+2];
            let dFw = (r - fwRgb[0])**2 + (g - fwRgb[1])**2 + (b - fwRgb[2])**2;
            let dSemi = (r - semiRgb[0])**2 + (g - semiRgb[1])**2 + (b - semiRgb[2])**2;
            if (dFw < 3200 || dSemi < 3200) {
                d[i] = baseRgb[0];
                d[i+1] = baseRgb[1];
                d[i+2] = baseRgb[2];
            }
        }
        ctx.putImageData(imgData, pxMinX, pxMinY);
    }

    // Re-apply legitimate fairway(s)
    if (hole.fairways && hole.fairways.length > 0) {
        window.applyFairwayPipeline(hole, false, true);
    }
    // Re-apply bunkers and green on top
    window.repaintUpperTextures(hole);

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.invalidateBiomeData(true);
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

    let _layers = window.beginUpperLayerEdit(hole);
    window.restoreFairwayBase(hole, true, targetFd);
    if (typeof window.eraseFairwayTexture === 'function') {
        window.eraseFairwayTexture(targetFd);
    }

    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePCtx) window.invalidateBiomeData(true);
    if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
    if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();

    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
    } else {
        window.repaintUpperTextures(hole);
    }
    window.endUpperLayerEdit(hole, _layers);

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
    let _layers = window.beginUpperLayerEdit(hole);
    window.restoreFairwayBase(hole, true, fd);
    if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    if (window._arcadePlaneGeo) {
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
    window.endUpperLayerEdit(hole, _layers);
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
    let _layers = window.beginUpperLayerEdit(hole);
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
    window.endUpperLayerEdit(hole, _layers);
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
    if (!window.validateSmartShape(smartGreenPoints)) return;
    window._smartShapeClosed = true;
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

    let sharpness = 100; // Hardcoded SHARP system standard

    let margin = semiRoughWidth + (roughEnabled ? roughWidth : 0) + 12;
    // Snapshot the fairway baseline WITHOUT tee/bunker edits (they sit above the fairway)
    let _layers = window.beginUpperLayerEdit(hole, true);
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
    window.endUpperLayerEdit(hole, _layers);
    clearSmartGreen();
    updateActiveFairwayOutline();

    window.saveLevel();
    if (window.FairwayStudio) window.FairwayStudio.sync();
    if (typeof window.updateSBFairwayControls === 'function') window.updateSBFairwayControls();

    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let fwNum = hole.fairways.length;
    window.showBuildToast(isSv ? (`✅ Fairway ${fwNum} byggd!`) : (`✅ Fairway ${fwNum} built!`), '#4ade80');

    window._smartBuildCooldown = true;
    setTimeout(function() { window._smartBuildCooldown = false; }, 500);
};

// === SMART TEE: Multi-Tee Box Studio & Procedural Pipeline ===

function ensureHoleTeeBoxes(hole) {
    if (!hole) return [];
    if (!hole.teeBoxes) {
        hole.teeBoxes = [];
        if (hole.teeData && hole.teeData.points && hole.teeData.points.length >= 3) {
            hole.teeBoxes.push(hole.teeData);
        }
    }
    if (hole.teeBoxes.length > 0) {
        hole.teeData = hole.teeBoxes[0];
        // DO NOT overwrite null! null means "drawing mode for new tee box"
        if (hole.activeTeeBoxIndex === undefined) {
            hole.activeTeeBoxIndex = 0;
        } else if (hole.activeTeeBoxIndex !== null && hole.activeTeeBoxIndex >= hole.teeBoxes.length) {
            hole.activeTeeBoxIndex = hole.teeBoxes.length - 1;
        }
    } else {
        hole.activeTeeBoxIndex = null;
        hole.teeData = null;
    }
    return hole.teeBoxes;
}
window.ensureHoleTeeBoxes = ensureHoleTeeBoxes;

function getActiveTeeBox(hole) {
    if (!hole) return null;
    ensureHoleTeeBoxes(hole);
    if (hole.activeTeeBoxIndex === null || hole.activeTeeBoxIndex === undefined) return null;
    return hole.teeBoxes[hole.activeTeeBoxIndex] || null;
}
window.getActiveTeeBox = getActiveTeeBox;

window.startNewTeeBoxDrawing = function() {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    ensureHoleTeeBoxes(hole);
    hole.activeTeeBoxIndex = null;
    if (typeof window.clearSmartGreen === 'function') window.clearSmartGreen();
    if (window.TeeStudio) window.TeeStudio.sync();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    let nextNum = hole.teeBoxes.length + 1;
    let msg = isSv ? `Klicka ut punkter för Tee Box ${nextNum}` : `Place points for Tee Box ${nextNum}`;
    if (typeof window.showBuildToast === 'function') window.showBuildToast(msg, '#38bdf8');
};

window.captureTeeSnapshot = function(hole, points, margin) {
    margin = Math.max(25, margin || 25);
    let densePts = getDenseGreenPoints(points); // same spline as the studio outline (catmullrom 0.5)
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

// Cleanly erase a tee's footprint from 2D canvas texture
window.eraseTeeTexture = function(tb, hole) {
    if (!tb || !tb.points || !window._arcadePCtx) return;
    if (tb._footprintRestored) { tb._footprintRestored = false; return; }
    let densePts = teeDensePts(tb);
    if (!densePts || densePts.length < 3) return;

    let baseGroundColor = getBaseGroundColor(hole);
    let ctx = window._arcadePCtx;
    ctx.save();
    ctx.filter = 'none';

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

// Heal any orphaned tee grass pixels outside current tee polygon
function healTeeSurroundings(hole, tb, densePts) {
    if (!tb || !tb.bbox || !window._arcadePCtx) return;
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let teeHex = cfg.teeColor || '#7cb54c';
    let baseGroundColor = getBaseGroundColor(hole);

    let [tR, tG, tB] = sbHexToRgb(teeHex);
    let [bR, bG, bB] = sbHexToRgb(baseGroundColor);

    let pxMinX = tb.bbox.pxMinX;
    let pxMinY = tb.bbox.pxMinY;
    let pw = tb.bbox.pw;
    let ph = tb.bbox.ph;
    if (pw <= 0 || ph <= 0) return;

    let liveImg = window._arcadePCtx.getImageData(pxMinX, pxMinY, pw, ph);
    let d = liveImg.data;
    let modified = false;

    for (let py = 0; py < ph; py++) {
        for (let px = 0; px < pw; px++) {
            let canvasX = pxMinX + px;
            let canvasY = pxMinY + py;
            let worldX = (canvasX / 4096) * window.TERRAIN_SIZE - (window.TERRAIN_SIZE / 2);
            let worldZ = (canvasY / 4096) * window.TERRAIN_SIZE - (window.TERRAIN_SIZE / 2);

            if (densePts && pointInPolygon(worldX, worldZ, densePts)) continue;

            let idx = (py * pw + px) * 4;
            let r = d[idx], g = d[idx+1], b = d[idx+2];
            let distTee = (r - tR)**2 + (g - tG)**2 + (b - tB)**2;
            if (distTee < 3000) {
                d[idx]   = bR;
                d[idx+1] = bG;
                d[idx+2] = bB;
                modified = true;
            }
        }
    }

    if (modified) {
        window._arcadePCtx.putImageData(liveImg, pxMinX, pxMinY);
    }
}
window.healTeeSurroundings = healTeeSurroundings;

// Tee edits reach at most polygon + (blend slider max 15 + 2) metres
const TEE_MAX_REACH = 17;

function teeDensePts(tb) {
    if (!tb || !tb.points || tb.points.length < 3) return null;
    // Same spline the Tee Studio draws (catmullrom, tension 0.5) so the painted/sculpted surface
    // follows the outline the user sees. (Default 'centripetal' cut corners differently.)
    return getDenseGreenPoints(tb.points, 0.5);
}

// Restore baseline heights ONLY where this tee box can have changed the terrain
// (polygon + blend reach) - not the whole bbox rectangle, which used to wipe neighbouring
// fairway / bunker edits.
window.restoreTeeHeightsOnly = function(tb, densePts) {
    if (!tb || !tb.origHeights || !tb.bbox || !window._arcadePlaneGeo) return false;
    densePts = densePts || teeDensePts(tb);
    let positions = window._arcadePlaneGeo.attributes.position.array;
    let bb = tb.bbox;
    let reach = Math.max(TEE_MAX_REACH, (tb.blendRadius !== undefined ? tb.blendRadius : 4) + 2);
    for (let gz = bb.gzStart; gz <= bb.gzEnd; gz++) {
        for (let gx = bb.gxStart; gx <= bb.gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS + 1) + gx;
            if (densePts) {
                let vx = positions[idx * 3], vz = -positions[idx * 3 + 1];
                if (!pointInPolygon(vx, vz, densePts) && distToPolygon(vx, vz, densePts) > reach) continue;
            }
            let oi = (gz - bb.gzStart) * bb.gWidth + (gx - bb.gxStart);
            if (oi >= 0 && oi < tb.origHeights.length) positions[idx * 3 + 2] = tb.origHeights[oi];
        }
    }
    return true;
};

window.restoreTeeBase = function(hole, eraseTex, targetTeeBox) {
    if (eraseTex === undefined) eraseTex = true;
    let tb = targetTeeBox || (typeof window.getActiveTeeBox === 'function' ? window.getActiveTeeBox(hole) : null);
    if (!tb) return;

    let densePts = teeDensePts(tb);

    // 1. Restore pristine baseline terrain heights
    if (tb.origHeights && tb.bbox && window._arcadePlaneGeo) {
        window.restoreTeeHeightsOnly(tb, densePts);
        window._arcadePlaneGeo.attributes.position.needsUpdate = true;
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
        window._arcadePlaneGeo.computeBoundingBox();
        window._arcadePlaneGeo.computeBoundingSphere();
        if (window._terrainChunks) window._terrainChunks.syncAll();
        if (typeof window.snapObjectsToGround === 'function') window.snapObjectsToGround();
    }

    // 2. Restore 2D canvas texture: cleanly erase tee footprint or restore clipped snapshot
    if (eraseTex && window._arcadePCtx) {
        restoreSurfaceFootprint(tb, hole, densePts || teeDensePts(tb), '_teeSnapCanvas');

        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
        window.invalidateBiomeData(true);
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(50);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }
};

// Paint one tee box surface (fill + mowing pattern) onto the terrain canvas
function paintTeeTexture(tb) {
    if (!tb || !tb.points || tb.points.length < 3 || !window._arcadePCtx) return;
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let teeColor = cfg.teeColor || '#7cb54c';
    let densePts = teeDensePts(tb);
    let mowPattern = tb.mowPattern || 'SOLID';
    let edgeSharpness = tb.edgeSharpness !== undefined ? tb.edgeSharpness : 100;
    let ctx = window._arcadePCtx;
    ctx.save();
    if (edgeSharpness < 100) {
        let blurPx = Math.round((100 - edgeSharpness) * 0.06);
        if (blurPx > 0) ctx.filter = 'blur(' + blurPx + 'px)';
    }
    ctx.beginPath();
    densePts.forEach((pt, i) => {
        let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
        if (i === 0) ctx.moveTo(pxX, pxY); else ctx.lineTo(pxX, pxY);
    });
    ctx.closePath();
    ctx.fillStyle = teeColor;
    ctx.fill();
    if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
        paintMowingPattern(ctx, densePts, teeColor, mowPattern);
    }
    ctx.filter = 'none';
    ctx.restore();
    tb._paint = { poly: densePts, margin: softEdgeMargin(edgeSharpness) };
}

// Texture only (no geometry): used to keep tee boxes on top of fairway paint
window.repaintTeeTextureOnly = function(hole) {
    if (!hole) return;
    ensureHoleTeeBoxes(hole);
    (hole.teeBoxes || []).forEach(paintTeeTexture);
};

// ---- Automatic tee colours -------------------------------------------------------
// Default for new holes: the system ranks the boxes by distance to the aim point (or flag) and hands
// out colours itself - furthest box = back tee. hole.teeManualColors === true means the player chose
// colours by hand; undefined (old saves) is treated as manual so existing holes are never recoloured.
const TEE_AUTO_PALETTE = {
    1: ['yellow'],
    2: ['yellow', 'red'],
    3: ['white', 'yellow', 'red'],
    4: ['black', 'white', 'yellow', 'red']
};
function isTeeAutoMode(hole) {
    if (hole.teeManualColors === false) return true;
    if (hole.teeManualColors === undefined) {
        return !(hole.teeBoxes || []).some(function(tb) { return tb.points && tb.points.length >= 3; });
    }
    return false;
}
window.isTeeAutoMode = isTeeAutoMode;

window.autoAssignTeeColors = function(hole) {
    if (!hole || hole.teeManualColors !== false) return false;
    ensureHoleTeeBoxes(hole);
    let boxes = (hole.teeBoxes || []).filter(function(tb) { return tb.points && tb.points.length >= 3; });
    if (boxes.length === 0) return false;

    // Rank by distance to the flag (same rule as publish validation); the aim point only stands in until a flag exists
    let tgt = hole.flag || hole.aimPoint;
    let ranked = boxes.map(function(tb, i) {
        let cx = 0, cz = 0;
        tb.points.forEach(function(p) { cx += p.x; cz += p.z; });
        cx /= tb.points.length; cz /= tb.points.length;
        return { tb: tb, i: i, d: tgt ? Math.hypot(cx - tgt.x, cz - tgt.z) : 0 };
    });
    if (tgt) ranked.sort(function(a, b) { return (b.d - a.d) || (a.i - b.i); });   // furthest first
    let pal = TEE_AUTO_PALETTE[Math.min(4, ranked.length)];
    let next = new Map();
    ranked.forEach(function(r, k) { next.set(r.tb, k < pal.length ? [pal[k]] : []); });

    let oldOwner = {};
    boxes.forEach(function(tb) { (tb.activeTees || []).forEach(function(c) { oldOwner[c] = tb; }); });
    let changed = boxes.filter(function(tb) { return (next.get(tb) || []).join() !== (tb.activeTees || []).join(); });
    if (changed.length === 0) return false;

    // A colour that moves to another box gets a fresh marker there
    TEE_COLOR_ORDER.forEach(function(c) {
        let newOwner = boxes.find(function(tb) { return next.get(tb).indexOf(c) >= 0; }) || null;
        if ((oldOwner[c] || null) !== newOwner) removeTeeMarker(hole, c);
    });
    boxes.forEach(function(tb) { tb.activeTees = next.get(tb); });
    changed.forEach(function(tb) { applyTeePipeline(hole, false, false, tb, false, true); });
    if (window.TeeStudio) window.TeeStudio.sync();
    return true;
};

window.setTeeAutoColors = function(auto) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.saveUndoState();
    hole.teeManualColors = !auto;
    if (auto) window.autoAssignTeeColors(hole);
    if (window.TeeStudio) window.TeeStudio.sync();
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
    window.showBuildToast(auto ? (isSv ? '🎨 Färgerna sätts automatiskt efter avstånd' : '🎨 Colours are now set automatically by distance')
                               : (isSv ? '🎨 Du väljer färgerna själv' : '🎨 You choose the colours yourself'), '#38bdf8');
};

// Tee marker colours are unique per hole (hole.tees is keyed by colour), so each colour
// belongs to exactly one tee box. Earlier boxes win when old saves list a colour twice.
const TEE_COLOR_ORDER = ['black', 'white', 'yellow', 'red'];
function normalizeTeeOwnership(hole) {
    let seen = {};
    (hole.teeBoxes || []).forEach(function(tb) {
        let cur = tb.activeTees || TEE_COLOR_ORDER;
        let keep = cur.filter(function(c) { return !seen[c]; });
        keep.forEach(function(c) { seen[c] = true; });
        if (!tb.activeTees || keep.length !== cur.length) tb.activeTees = keep;
    });
}
window.normalizeTeeOwnership = normalizeTeeOwnership;

function freeTeeColors(hole, exceptTb) {
    let taken = {};
    (hole.teeBoxes || []).forEach(function(tb) {
        if (tb !== exceptTb) (tb.activeTees || []).forEach(function(c) { taken[c] = true; });
    });
    return TEE_COLOR_ORDER.filter(function(c) { return !taken[c]; });
}
window.freeTeeColors = freeTeeColors;

function teeBoxOwning(hole, color, exceptTb) {
    return (hole.teeBoxes || []).find(function(tb) { return tb !== exceptTb && (tb.activeTees || []).indexOf(color) >= 0; }) || null;
}

// A marker placed by hand (Hole tool) changes owner: the colour leaves whichever box had it and
// joins the box whose surface it now stands on (or stays loose if it is on no box).
window.assignTeeMarkerOwnership = function(hole, color, x, z) {
    if (TEE_COLOR_ORDER.indexOf(color) < 0) return;
    // Placing a marker by hand is an explicit colour choice: stop recolouring this hole automatically
    if (hole.teeManualColors === false) hole.teeManualColors = true;
    let boxes = hole.teeBoxes || [];
    let target = boxes.find(function(tb) { return tb.points && tb.points.length >= 3 && pointInPolygon(x, z, teeDensePts(tb)); }) || null;
    boxes.forEach(function(tb) {
        if ((tb.activeTees || []).indexOf(color) >= 0 && tb !== target) tb.activeTees = tb.activeTees.filter(function(c) { return c !== color; });
    });
    if (target && (target.activeTees || []).indexOf(color) < 0) target.activeTees = (target.activeTees || []).concat([color]);
};

function removeTeeMarker(hole, color) {
    if (hole.teeMeshes && hole.teeMeshes[color]) window._arcadeScene.remove(hole.teeMeshes[color]);
    if (hole.teeMeshes) hole.teeMeshes[color] = null;
    if (hole.tees) hole.tees[color] = null;
}

window.applyTeePipeline = function(hole, isInitial, updateTexture, targetTeeBox, heightsOnly, markersOnly) {
    let tb = targetTeeBox || (typeof window.getActiveTeeBox === 'function' ? window.getActiveTeeBox(hole) : null);
    if (!tb || !tb.points || tb.points.length < 3) return;

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let teeColor = cfg.teeColor || '#7cb54c';

    let densePts = teeDensePts(tb);

    let raiseHeight = tb.raiseHeight !== undefined ? tb.raiseHeight : 0.5;
    let blendRadius = tb.blendRadius !== undefined ? tb.blendRadius : 4.0;
    let mowPattern = tb.mowPattern || 'SOLID';
    let edgeSharpness = tb.edgeSharpness !== undefined ? tb.edgeSharpness : 100;

    // Auto-capture baseline snapshot if not yet captured
    if (!tb.origHeights && typeof window.captureTeeSnapshot === 'function') {
        let snap = window.captureTeeSnapshot(hole, tb.points, 25);
        tb.bbox = snap.bbox;
        tb.origHeights = snap.origHeights;
        if (!tb.origCanvasPixels) tb.origCanvasPixels = snap.origCanvasPixels;
        if (tb.baseElevation === undefined) tb.baseElevation = snap.baseElevation;
    }

    // 1. Texture painting
    if (updateTexture && !markersOnly && window._arcadePCtx) {
        restoreSurfaceFootprint(tb, hole, teeDensePts(tb), '_teeSnapCanvas');
        window.repaintAllTextures(hole, false);
        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
        window.invalidateBiomeData(true);
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(400);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
    }

    // 2. Terrain Heights: Plateau flattening + smoothstep blend
    let positions = window._arcadePlaneGeo.attributes.position.array;
    let step = window.TERRAIN_SIZE / window.TERRAIN_SEGS;

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

    let baseH = tb.baseElevation;
    if (baseH === undefined) {
        baseH = 0;
        for(let pt of tb.points) {
            let surf = window.localGetTerrainAt ? window.localGetTerrainAt(pt.x, -pt.z) : null;
            baseH += surf ? surf.z : (pt.y || 0);
        }
        baseH /= tb.points.length;
        tb.baseElevation = baseH;
    }

    let plateauH = baseH + raiseHeight;

    if (!markersOnly) {
    // Reset terrain (polygon + blend reach only) back to baseline origHeights before applying new elevation/blend
    if (tb.origHeights && tb.bbox) {
        window.restoreTeeHeightsOnly(tb, densePts);
    }

    let bb = tb.bbox;
    for(let gz = gzStart; gz <= gzEnd; gz++) {
        for(let gx = gxStart; gx <= gxEnd; gx++) {
            let idx = gz * (window.TERRAIN_SEGS+1) + gx;
            let vx = positions[idx*3];
            let vz = -positions[idx*3+1];
            let isInside = pointInPolygon(vx, vz, densePts);
            let distEdge = distToPolygon(vx, vz, densePts);
            if(!isInside && distEdge > margin) continue;

            let oi = (bb && gz >= bb.gzStart && gz <= bb.gzEnd && gx >= bb.gxStart && gx <= bb.gxEnd)
                ? (gz - bb.gzStart) * bb.gWidth + (gx - bb.gxStart)
                : -1;
            let originalH = (oi >= 0 && tb.origHeights && oi < tb.origHeights.length)
                ? tb.origHeights[oi]
                : positions[idx*3+2];

            if(isInside) {
                positions[idx*3+2] = plateauH;
            } else {
                let t = Math.min(1.0, distEdge / Math.max(0.5, blendRadius));
                t = t * t * (3.0 - 2.0 * t);
                positions[idx*3+2] = plateauH + (originalH - plateauH) * t;
            }
        }
    }

    window._arcadePlaneGeo.attributes.position.needsUpdate = true;
    if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
    window._arcadePlaneGeo.computeBoundingBox();
    window._arcadePlaneGeo.computeBoundingSphere();
    if (window._terrainChunks) window._terrainChunks.syncAll();
    if (typeof window.snapObjectsToGround === 'function') window.snapObjectsToGround();
    }

    // Layer re-attach only needs the terrain edit - leave tee markers exactly where they are
    if (heightsOnly) return;

    // 3. Place and orient this box's tee markers facing the aim point.
    // Each colour belongs to one box; a marker that already stands inside this box
    // (e.g. dragged by hand) keeps its place instead of snapping back to the default slot.
    normalizeTeeOwnership(hole);
    let activeTees = tb.activeTees || [];
    let colorMap = { black: 0x111111, white: 0xffffff, yellow: 0xfacc15, red: 0xef4444 };
    let teesToPlace = [];
    for(let col of TEE_COLOR_ORDER) {
        if (activeTees.includes(col)) teesToPlace.push({ type: col, color: colorMap[col] });
    }

    // Remove markers of colours this box no longer has (unless another box owns them)
    TEE_COLOR_ORDER.forEach(tt => {
        if (!activeTees.includes(tt) && hole.tees && hole.tees[tt] && !teeBoxOwning(hole, tt, tb)) {
            if (pointInPolygon(hole.tees[tt].x, hole.tees[tt].z, densePts)) removeTeeMarker(hole, tt);
        }
    });

    if (teesToPlace.length > 0) {
        let cx = 0, cz = 0;
        for(let pt of tb.points) { cx += pt.x; cz += pt.z; }
        cx /= tb.points.length;
        cz /= tb.points.length;

        let targetX = cx, targetZ = cz - 100;
        if (hole.aimPoint) { targetX = hole.aimPoint.x; targetZ = hole.aimPoint.z; }
        else if (hole.flag) { targetX = hole.flag.x; targetZ = hole.flag.z; }

        let dirX = targetX - cx;
        let dirZ = targetZ - cz;
        let dirLen = Math.hypot(dirX, dirZ) + 0.001;
        dirX /= dirLen; dirZ /= dirLen;

        let minProj = Infinity, maxProj = -Infinity;
        for(let pt of tb.points) {
            let dx = pt.x - cx;
            let dz = pt.z - cz;
            let proj = dx * dirX + dz * dirZ;
            if(proj < minProj) minProj = proj;
            if(proj > maxProj) maxProj = proj;
        }
        let totalLen = maxProj - minProj;
        if(totalLen < 2) totalLen = 6;

        let spacing = totalLen / (teesToPlace.length + 1);
        let startX = cx + dirX * minProj;
        let startZ = cz + dirZ * minProj;

        let teeRot = Math.atan2(dirX, dirZ);
        let teePositions = [];
        for(let i = 0; i < teesToPlace.length; i++) {
            let dist = spacing * (i + 1);
            let tx = startX + dirX * dist;
            let tz = startZ + dirZ * dist;
            teePositions.push({ x: tx, y: plateauH, z: tz });
        }

        teePositions.sort((a, b) => {
            let da = (a.x - targetX)**2 + (a.z - targetZ)**2;
            let db = (b.x - targetX)**2 + (b.z - targetZ)**2;
            return db - da; // Furthest from aimPoint first (back tees = black, furthest)
        });

        if (!hole.tees) hole.tees = {};
        if (!hole.teeMeshes) hole.teeMeshes = {};

        for(let i = 0; i < teesToPlace.length; i++) {
            let t = teesToPlace[i];
            let pos = teePositions[i];
            let cur = hole.tees[t.type];
            if (cur && !window._teeResetMarkers && pointInPolygon(cur.x, cur.z, densePts)) {
                pos = { x: cur.x, y: plateauH, z: cur.z };
            }
            if (hole.teeMeshes[t.type]) window._arcadeScene.remove(hole.teeMeshes[t.type]);
            hole.tees[t.type] = { x: pos.x, y: pos.y, z: pos.z, rot: teeRot };
            hole.teeMeshes[t.type] = window.createTeeObject(pos.x, pos.y, pos.z, t.color);
            hole.teeMeshes[t.type].rotation.y = teeRot;
        }
    }
};

window.deleteSmartTeeBox = function(boxIndex) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    ensureHoleTeeBoxes(hole);
    normalizeTeeOwnership(hole); // old saves may list a colour on several boxes
    let idx = (boxIndex !== undefined && boxIndex !== null) ? boxIndex : hole.activeTeeBoxIndex;
    if (idx === null || idx === undefined || !hole.teeBoxes[idx]) return;

    window.saveUndoState();
    let targetTb = hole.teeBoxes[idx];

    (targetTb.activeTees || []).forEach(function(tt) { removeTeeMarker(hole, tt); });
    // Loose markers (placed by hand, owned by no remaining box) standing on the deleted surface go too
    if (targetTb.points && targetTb.points.length >= 3) {
        let gone = teeDensePts(targetTb);
        TEE_COLOR_ORDER.forEach(function(tt) {
            if (hole.tees && hole.tees[tt] && !teeBoxOwning(hole, tt, targetTb) && pointInPolygon(hole.tees[tt].x, hole.tees[tt].z, gone)) {
                removeTeeMarker(hole, tt);
            }
        });
    }

    restoreTeeBase(hole, true, targetTb);

    hole.teeBoxes.splice(idx, 1);
    if (hole.teeBoxes.length > 0) {
        hole.activeTeeBoxIndex = Math.max(0, Math.min(idx, hole.teeBoxes.length - 1));
        hole.teeData = hole.teeBoxes[0];
    } else {
        hole.activeTeeBoxIndex = null;
        hole.teeData = null;
    }
    window.repaintAllTextures(hole);
    window.autoAssignTeeColors(hole);

    if (window.TeeStudio) window.TeeStudio.sync();
    window.saveLevel();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '🗑️ Tee box raderad!' : '🗑️ Tee box deleted!', '#ef4444');
};

window.deleteAllSmartTeeBoxes = function() {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole || !hole.teeBoxes || hole.teeBoxes.length === 0) return;

    window.saveUndoState();
    // Newest first: later boxes' snapshots may contain earlier plateaus
    hole.teeBoxes.slice().reverse().forEach(tb => {
        restoreTeeBase(hole, true, tb);
    });

    ['red','yellow','white','black'].forEach(tt => {
        if (hole.teeMeshes && hole.teeMeshes[tt]) window._arcadeScene.remove(hole.teeMeshes[tt]);
        if (hole.teeMeshes) hole.teeMeshes[tt] = null;
        if (hole.tees) hole.tees[tt] = null;
    });

    hole.teeBoxes = [];
    hole.activeTeeBoxIndex = null;
    hole.teeData = null;
    window.repaintAllTextures(hole);

    if (window.TeeStudio) window.TeeStudio.sync();
    window.saveLevel();
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '🗑️ Alla tee-boxar raderade!' : '🗑️ All tee boxes deleted!', '#ef4444');
};

window.redrawSmartTeeBox = function() {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    window.deleteSmartTeeBox(hole.activeTeeBoxIndex);
    window.startNewTeeBoxDrawing();
};

// Tee colours the user has picked for the next box (only colours no other box uses count)
const TEE_PICK_DEFAULT_ORDER = ['yellow', 'white', 'red', 'black'];
window._teePickColors = null;
window.getTeePickColors = function(hole) {
    let free = freeTeeColors(hole, null);
    let pick = (window._teePickColors || []).filter(function(c) { return free.indexOf(c) >= 0; });
    if (pick.length === 0 && window._teePickColors === null) {
        let first = TEE_PICK_DEFAULT_ORDER.find(function(c) { return free.indexOf(c) >= 0; });
        pick = first ? [first] : [];
    }
    return TEE_COLOR_ORDER.filter(function(c) { return pick.indexOf(c) >= 0; });
};
window.toggleTeePick = function(color) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole || freeTeeColors(hole, null).indexOf(color) < 0) return;
    let pick = window.getTeePickColors(hole);
    window._teePickColors = pick.indexOf(color) >= 0 ? pick.filter(function(c) { return c !== color; }) : pick.concat([color]);
    window.renderTeePickCard();
};

window.renderTeePickCard = function() {
    let host = document.getElementById('st-pick-card');
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!host || !hole) return;
    ensureHoleTeeBoxes(hole);
    normalizeTeeOwnership(hole);
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (isTeeAutoMode(hole)) {
        host.innerHTML =
            '<div style="color:#38bdf8; font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">' + (isSv ? 'Teefärger' : 'Tee colours') + '</div>' +
            '<div style="color:#e2e8f0; font-size:10.5px; line-height:1.4; margin-bottom:8px;">' + (isSv
                ? 'Rita bara teeboxarna. Färgerna sätts automatiskt efter avstånd: längst bort blir bak-tee, närmast blir fram-tee.'
                : 'Just draw the tee boxes. Colours are set automatically by distance: furthest is the back tee, nearest the front tee.') + '</div>' +
            '<button type="button" onclick="window.activateTeeLayoutMode()" style="width:100%; background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.5); padding:7px 8px; border-radius:6px; font-size:10.5px; font-weight:700; cursor:pointer;">✨ ' +
            (isSv ? 'Skapa standardtees (klicka ut bak-tee)' : 'Create standard tees (click the back tee)') + '</button>' +
            '<button type="button" onclick="window.setTeeAutoColors(false)" style="width:100%; margin-top:6px; background:transparent; color:#94a3b8; border:1px solid #334155; padding:5px 8px; border-radius:6px; font-size:9.5px; font-weight:700; cursor:pointer;">' +
            (isSv ? 'Välj färger själv (avancerat)' : 'Choose colours myself (advanced)') + '</button>';
        return;
    }
    let pick = window.getTeePickColors(hole);
    let names = isSv ? { black: 'Svart', white: 'Vit', yellow: 'Gul', red: 'Röd' } : { black: 'Black', white: 'White', yellow: 'Yellow', red: 'Red' };
    let dot = { black: '#111827', white: '#ffffff', yellow: '#facc15', red: '#ef4444' };
    let chips = TEE_COLOR_ORDER.map(function(c) {
        let owner = teeBoxOwning(hole, c, null);
        let on = pick.indexOf(c) >= 0;
        let label = names[c] + (owner ? ' · Box ' + (hole.teeBoxes.indexOf(owner) + 1) : '');
        let st = 'display:flex; align-items:center; gap:5px; padding:5px 8px; border-radius:6px; font-size:10.5px; font-weight:700; border:1px solid ' +
            (owner ? '#334155' : (on ? '#38bdf8' : '#475569')) + '; background:' + (on ? 'rgba(56,189,248,0.18)' : '#0f172a') +
            '; color:' + (owner ? '#64748b' : '#e2e8f0') + '; cursor:' + (owner ? 'not-allowed' : 'pointer') + '; opacity:' + (owner ? '0.6' : '1') + ';';
        return '<button type="button" ' + (owner ? 'disabled ' : '') + 'onclick="window.toggleTeePick(\'' + c + '\')" style="' + st + '">' +
            '<span style="width:10px; height:10px; border-radius:50%; background:' + dot[c] + '; border:1px solid #64748b;"></span>' + label + (on ? ' ✓' : '') + '</button>';
    }).join('');
    let free = freeTeeColors(hole, null);
    let hint = free.length === 0
        ? (isSv ? 'Alla färger används. Kryssa en färg på en befintlig box för att flytta den.' : 'All colours are in use. Tick a colour on an existing box to move it.')
        : (isSv ? 'Välj vilka markörer den nya boxen ska ha. Varje färg får bara finnas på en box.' : 'Choose the markers the new box gets. Each colour can live on one box only.');
    let layoutBtn = free.length > 0
        ? '<button type="button" onclick="window.activateTeeLayoutMode()" style="width:100%; margin-top:8px; background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.5); padding:7px 8px; border-radius:6px; font-size:10.5px; font-weight:700; cursor:pointer;">✨ ' +
          (isSv ? 'Skapa standardtees (klicka ut bak-tee)' : 'Create standard tees (click the back tee)') + '</button>'
        : '';
    layoutBtn += '<button type="button" onclick="window.setTeeAutoColors(true)" style="width:100%; margin-top:6px; background:transparent; color:#94a3b8; border:1px solid #334155; padding:5px 8px; border-radius:6px; font-size:9.5px; font-weight:700; cursor:pointer;">🎨 ' + (isSv ? 'Automatiska färger' : 'Automatic colours') + '</button>';
    host.innerHTML =
        '<div style="color:#38bdf8; font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">' + (isSv ? 'Vilken tee?' : 'Which tee?') + '</div>' +
        '<div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:6px;">' + chips + '</div>' +
        '<div style="color:#94a3b8; font-size:9.5px; line-height:1.35;">' + hint + '</div>' + layoutBtn;
};

// Where the aim point would go if none is set: flag, else the middle of the first fairway. Read-only.
window.deriveTeeAim = function(hole) {
    if (hole.aimPoint) return hole.aimPoint;
    if (hole.flag) {
        let surf = window.localGetTerrainAt ? window.localGetTerrainAt(hole.flag.x, -hole.flag.z) : null;
        return { x: hole.flag.x, y: surf ? surf.z : (hole.flag.y || 0), z: hole.flag.z };
    }
    let fw = (hole.fairways || []).find(function(f) { return f && f.points && f.points.length >= 3; });
    if (!fw) return null;
    let fx = 0, fz = 0;
    fw.points.forEach(function(p) { fx += p.x; fz += p.z; });
    fx /= fw.points.length; fz /= fw.points.length;
    let fs = window.localGetTerrainAt ? window.localGetTerrainAt(fx, -fz) : null;
    return { x: fx, y: fs ? fs.z : 0, z: fz };
};

// Aim point falls back to the flag (or the fairway) so the tee flow never stalls on step one.
// Mutates the hole: call it inside the undo boundary.
window.ensureTeeAimPoint = function(hole) {
    if (hole.aimPoint) return true;
    let aim = window.deriveTeeAim(hole);
    if (!aim) return false;
    hole.aimPoint = { x: aim.x, y: aim.y, z: aim.z };
    if (hole.aimMesh && window._arcadeScene) window._arcadeScene.remove(hole.aimMesh);
    if (typeof window.createAimPointMarker === 'function') {
        hole.aimMesh = window.createAimPointMarker(aim.x, aim.y, aim.z, window.currentHoleIndex + 1);
    }
    return true;
};

// Shared by the single-box build and the standard layout. Caller handles undo/save/UI.
function createTeeBoxFromPoints(hole, points, colors, deferApply) {
    ensureHoleTeeBoxes(hole);
    let autoMode = isTeeAutoMode(hole);
    if (autoMode) { hole.teeManualColors = false; colors = []; }
    let snap = window.captureTeeSnapshot(hole, points, 25);
    let hSlider = document.getElementById('st-raise-height');
    let bSlider = document.getElementById('st-raise-blend');
    let newTeeBox = {
        id: 'tb_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        points: points.map(p => ({ x: p.x, y: p.y, z: p.z })),
        raiseHeight: hSlider ? parseFloat(hSlider.value) : 0.5,
        blendRadius: bSlider ? parseFloat(bSlider.value) : 4.0,
        mowPattern: window._smartMowPattern || 'SOLID',
        edgeSharpness: 100,
        activeTees: colors.slice(),
        baseElevation: snap.baseElevation,
        bbox: snap.bbox,
        origHeights: snap.origHeights,
        origCanvasPixels: snap.origCanvasPixels
    };
    hole.teeBoxes.push(newTeeBox);
    hole.activeTeeBoxIndex = hole.teeBoxes.length - 1;
    hole.teeData = hole.teeBoxes[0];
    if (!deferApply) applyTeePipeline(hole, true, true, newTeeBox);
    if (autoMode) window.autoAssignTeeColors(hole);
    return newTeeBox;
}

window.executeSmartTee = function() {
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (!smartGreenPoints || smartGreenPoints.length < 3) {
        window.showBuildToast(isSv ? '⚠️ Sätt ut minst 3 punkter för att skapa tee-boxen!' : '⚠️ Place at least 3 points to create the tee box!', '#ef4444');
        return;
    }
    if (!window.validateSmartShape(smartGreenPoints)) return;
    window._smartShapeClosed = true;

    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    ensureHoleTeeBoxes(hole);
    normalizeTeeOwnership(hole);

    // Aim point: the flag is used automatically (inside the undo boundary), otherwise ask for one
    let fwAim = (hole.fairways || []).some(function(f) { return f && f.points && f.points.length >= 3; });
    if (!hole.aimPoint && !hole.flag && !fwAim) {
        window.showBuildToast(isSv ? '🎯 Sätt en flagga eller siktpunkt först! Klicka på "Sätt siktpunkt" i Tee-panelen.' : '🎯 Place a flag or set an Aim Point first! Click "Set Aim Point" in the Tee panel.', '#ef4444');
        if (typeof window.activateAimMode === 'function') window.activateAimMode();
        return;
    }

    let colors = window.getTeePickColors(hole);
    if (!isTeeAutoMode(hole) && colors.length === 0 && freeTeeColors(hole, null).length > 0) {
        window.showBuildToast(isSv ? '⚠️ Välj minst en teefärg för boxen.' : '⚠️ Pick at least one tee colour for the box.', '#ef4444');
        return;
    }

    window.saveUndoState();
    window.ensureTeeAimPoint(hole);
    createTeeBoxFromPoints(hole, smartGreenPoints, colors);
    window._teePickColors = null;

    clearSmartGreen();
    window.saveLevel();
    window.autoAdvanceHole();

    if (window.TeeStudio) {
        window.TeeStudio.sync();
    }

    let tbNum = hole.teeBoxes.length;
    window.showBuildToast(isSv ? `🟦 Tee Box ${tbNum} skapad! Dra de vita golfbollarna för att justera formen.` : `🟦 Tee Box ${tbNum} created! Drag white golf balls to adjust shape.`, '#38bdf8');

    window._smartBuildCooldown = true;
    setTimeout(function() { window._smartBuildCooldown = false; }, 500);
};

// Standard layout: back tee (black+white), middle (yellow), front (red) in a row towards the aim point.
// Only colours that are still free are used. The user clicks where the back tee goes.
window.activateTeeLayoutMode = function() {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    if (!hole) return;
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    if (!hole.aimPoint && !hole.flag && !(hole.fairways || []).some(function(f) { return f && f.points && f.points.length >= 3; })) {
        window.showBuildToast(isSv ? '🎯 Sätt en flagga eller siktpunkt först.' : '🎯 Place a flag or set an Aim Point first.', '#ef4444');
        if (typeof window.activateAimMode === 'function') window.activateAimMode();
        return;
    }
    window._placingTeeLayout = true;
    window._placingTeeLayoutHole = window.currentHoleIndex;
    window.showBuildToast(isSv ? '📍 Klicka på kartan där bak-teen ska ligga (Esc avbryter)' : '📍 Click the map where the back tee goes (Esc cancels)', '#38bdf8');
};

window.buildStandardTeeLayout = function(x, z) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let target = hole && (hole.aimPoint || hole.flag || window.deriveTeeAim(hole));   // read-only until placement succeeds
    if (!target) { window._placingTeeLayout = false; return true; }
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    ensureHoleTeeBoxes(hole);
    normalizeTeeOwnership(hole);
    let free = freeTeeColors(hole, null);
    // Each group keeps its own slot (back / middle / front) even when earlier groups are taken
    let groups = isTeeAutoMode(hole)
        ? [0, 1, 2].map(function(slot) { return { slot: slot, colors: [] }; })   // colours come from the ranking
        : [['black', 'white'], ['yellow'], ['red']]
            .map(function(g, slot) { return { slot: slot, colors: g.filter(function(c) { return free.indexOf(c) >= 0; }) }; })
            .filter(function(g) { return g.colors.length > 0; });
    if (groups.length === 0) return true;

    let dx = target.x - x, dz = target.z - z;
    let len = Math.hypot(dx, dz);
    if (len < 5) {
        window.showBuildToast(isSv ? '⚠️ För nära siktpunkten - välj en plats längre bort.' : '⚠️ Too close to the aim point - pick a spot further away.', '#ef4444');
        return false; // stay in placement mode so the next click retries
    }
    dx /= len; dz /= len;
    let px = -dz, pz = dx;           // perpendicular
    // PITCH keeps neighbouring boxes outside each other's terrain restore reach (TEE_MAX_REACH + blend),
    // so editing or deleting one box can never cut away another box's plateau.
    const HALF_W = 4.5, HALF_D = 2.5, PITCH = 28;

    window.saveUndoState();
    window.ensureTeeAimPoint(hole);
    groups.forEach(function(g) {
        let colors = g.colors;
        let cx = x + dx * PITCH * g.slot, cz = z + dz * PITCH * g.slot;
        let pts = [[-HALF_W, -HALF_D], [HALF_W, -HALF_D], [HALF_W, HALF_D], [-HALF_W, HALF_D]].map(function(o) {
            let wx = cx + px * o[0] + dx * o[1], wz = cz + pz * o[0] + dz * o[1];
            let surf = window.localGetTerrainAt ? window.localGetTerrainAt(wx, -wz) : null;
            return { x: wx, y: surf ? surf.z : 0, z: wz };
        });
        // Built in order: a later box snapshots the earlier plateaus, so building it never cuts them away.
        // deleteAllSmartTeeBoxes restores newest-first to undo this.
        createTeeBoxFromPoints(hole, pts, colors);
    });
    window._placingTeeLayout = false;
    hole.activeTeeBoxIndex = hole.teeBoxes.length - groups.length;
    window._teePickColors = null;

    clearSmartGreen();
    window.saveLevel();
    if (window.TeeStudio) window.TeeStudio.sync();
    window.showBuildToast(isSv ? `🟦 ${groups.length} tee-boxar skapade. Justera formen eller flytta markörerna.` : `🟦 ${groups.length} tee boxes created. Adjust the shapes or move the markers.`, '#38bdf8');
    window._smartBuildCooldown = true;
    setTimeout(function() { window._smartBuildCooldown = false; }, 500);
    return true;
};

window.onTeeHeightSlider = function(val) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    tb.raiseHeight = parseFloat(val);
    let valEl = document.getElementById('st-raise-height-val');
    if (valEl) valEl.textContent = (tb.raiseHeight >= 0 ? '+' : '') + tb.raiseHeight.toFixed(1) + 'm';
    applyTeePipeline(hole, false, false, tb);
    if (window.TeeStudio) window.TeeStudio.rebuildHandles(hole, tb);
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
};

window.onTeeBlendSlider = function(val) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    tb.blendRadius = parseFloat(val);
    let valEl = document.getElementById('st-raise-blend-val');
    if (valEl) valEl.textContent = tb.blendRadius.toFixed(1) + 'm';
    applyTeePipeline(hole, false, false, tb);
    if (window.TeeStudio) window.TeeStudio.rebuildHandles(hole, tb);
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
};

window.onTeeColorToggle = function(color, checked) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    if (hole.teeManualColors !== true) {
        hole.teeManualColors = true;
        let isSv0 = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        window.showBuildToast(isSv0 ? '🎨 Du väljer färgerna själv nu. Tryck "Automatiska färger" för att låta systemet välja igen.' : '🎨 You now choose colours yourself. Press "Automatic colours" to let the system choose again.', '#38bdf8');
    }
    let cur = tb.activeTees || [];
    if (checked) {
        // A colour lives on one box only: ticking it here moves it from the box that had it
        let other = teeBoxOwning(hole, color, tb);
        if (other) {
            other.activeTees = other.activeTees.filter(c => c !== color);
            removeTeeMarker(hole, color);
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let n = hole.teeBoxes.indexOf(other) + 1;
            window.showBuildToast(isSv ? `↪ Färgen flyttades från Tee Box ${n}` : `↪ Colour moved from Tee Box ${n}`, '#38bdf8');
        }
        if (!cur.includes(color)) tb.activeTees = cur.concat([color]);
    } else {
        tb.activeTees = cur.filter(c => c !== color);
    }
    applyTeePipeline(hole, false, false, tb);
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
};

window.setTeeMowPattern = function(pattern) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    tb.mowPattern = pattern;
    applyTeePipeline(hole, false, true, tb);
    if (window.TeeStudio) window.TeeStudio.syncUIValues(hole, tb);
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
};

window.onTeeEdgeSharpness = function(val) {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    if (!tb._paint && tb.points && tb.points.length >= 3) tb._paint = { poly: teeDensePts(tb), margin: softEdgeMargin(tb.edgeSharpness) };
    tb.edgeSharpness = parseInt(val);
    let valEl = document.getElementById('st-edge-val');
    if (valEl) valEl.textContent = (tb.edgeSharpness === 100) ? 'Skarp (100%)' : (tb.edgeSharpness === 0 ? 'Mjuk (0%)' : tb.edgeSharpness + '%');
    applyTeePipeline(hole, false, true, tb);
    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
};

window.autoSortTeesForActiveBox = function() {
    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
    let tb = getActiveTeeBox(hole);
    if (!tb) return;
    window._teeResetMarkers = true;
    try { applyTeePipeline(hole, false, false, tb); } finally { window._teeResetMarkers = false; }
    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
    window.showBuildToast(isSv ? '🔄 Teer sorterade och uppriktade mot siktpunkten!' : '🔄 Tees sorted & aligned towards aim point!', '#38bdf8');
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

// 1.4. Heal any accidental rectangular rough stains created around green by legacy bugs.
// Samples the ACTUAL canvas color outside the polygon to detect base terrain type.
// Only runs when base terrain is confirmed to be normal rough (not deep rough, sand, fairway etc.)
function healGreenSurroundings(hole, gd, densePts) {
    if (!gd || !gd.bbox || !window._arcadePCtx) return;
    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let roughHex = cfg.roughColor || '#4a782b';
    let fescueHex = cfg.fescueColor || '#2d4c1a';

    let [targetFescueR, targetFescueG, targetFescueB] = sbHexToRgb(fescueHex);
    let [rR, rG, rB] = sbHexToRgb(roughHex);
    let [tRoughR, tRoughG, tRoughB] = sbHexToRgb(roughHex);

    let pxMinX = gd.bbox.pxMinX;
    let pxMinY = gd.bbox.pxMinY;
    let pw = gd.bbox.pw;
    let ph = gd.bbox.ph;
    if (pw <= 0 || ph <= 0) return;

    // Sample a pixel OUTSIDE the green polygon to detect actual base terrain color.
    // Pick the corner of the bbox (which is always outside the polygon since bbox has margin).
    let samplePx = null;
    try {
        samplePx = window._arcadePCtx.getImageData(pxMinX, pxMinY, 1, 1).data;
    } catch(e) { return; }

    if (!samplePx) return;
    let sr = samplePx[0], sg = samplePx[1], sb = samplePx[2];

    // If the actual terrain at the corner is deep rough (fescue) → do NOT heal.
    // Deep rough is the correct base terrain, so "healing" it to regular rough would create the rectangle bug.
    let distToFescue = (sr - targetFescueR)**2 + (sg - targetFescueG)**2 + (sb - targetFescueB)**2;
    if (distToFescue < 3000) return; // Base terrain IS deep rough → skip entirely

    // Also skip if base terrain is fairway, bunker, semi-rough or any non-rough color.
    // Only proceed if the corner pixel is genuinely close to rough color.
    let distToRough = (sr - tRoughR)**2 + (sg - tRoughG)**2 + (sb - tRoughB)**2;
    if (distToRough > 3500) return; // Corner is not rough either → ambiguous, skip

    // Base terrain confirmed as normal rough. Heal any accidental fescue pixels outside polygon.
    // IMPORTANT: Only fix the live canvas — never mutate origCanvasPixels (the snapshot).
    let liveImg = window._arcadePCtx.getImageData(pxMinX, pxMinY, pw, ph);
    let d = liveImg.data;
    let modified = false;
    for (let py = 0; py < ph; py++) {
        for (let px = 0; px < pw; px++) {
            let canvasX = pxMinX + px;
            let canvasY = pxMinY + py;
            let worldX = (canvasX / 4096) * window.TERRAIN_SIZE - (window.TERRAIN_SIZE / 2);
            let worldZ = (canvasY / 4096) * window.TERRAIN_SIZE - (window.TERRAIN_SIZE / 2);

            // Do not touch inside the green polygon
            if (densePts && pointInPolygon(worldX, worldZ, densePts)) continue;

            let idx = (py * pw + px) * 4;
            let r = d[idx], g = d[idx+1], b = d[idx+2];
            let distFescue = (r - targetFescueR)**2 + (g - targetFescueG)**2 + (b - targetFescueB)**2;
            // If this pixel was accidentally painted as deep rough, restore it to pristine rough
            if (distFescue < 2500) {
                d[idx]   = rR;
                d[idx+1] = rG;
                d[idx+2] = rB;
                modified = true;
            }
        }
    }
    if (modified) {
        window._arcadePCtx.putImageData(liveImg, pxMinX, pxMinY);
        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
    }
}
window.healGreenSurroundings = healGreenSurroundings;


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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        window.invalidateBiomeData(true);
        // Defer rough mask rebuild so it fires AFTER repaintGreenTextureOnly has finished painting.
        // Calling rebuildRoughMask() here immediately (before repaint) would cause 3D-grass to flash
        // over the green area for the duration of the debounce.
        if (typeof window.debounceRebuildRoughMask === 'function') {
            window.debounceRebuildRoughMask(50);
        } else if (typeof window.rebuildRoughMask === 'function') {
            window.rebuildRoughMask();
        }
        if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
    }
};

// 2.5. Dedicated Green Texture Repainting (2D canvas only - zero geometry or 3D terrain distortion)
window.repaintGreenTextureOnly = function(hole) {
    if (!hole || !hole.greenData || !window._arcadePCtx) return;
    let gd = hole.greenData;
    if (!gd.points || gd.points.length < 3) return;

    let cfg = window.CURRENT_BIOME_CONFIG || {};
    let greenColor = cfg.greenColor || '#98ce68';
    let foregreenColor = cfg.foregreenColor || '#8bc45d';

    let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
    let densePts = (gd.densePts && gd.densePts.length >= 3) ? gd.densePts : ((typeof getDenseGreenPoints === 'function') ? getDenseGreenPoints(gd.points, tension) : gd.points);
    if (!densePts || densePts.length < 3) return;
    gd.densePts = densePts;

    let ctx = window._arcadePCtx;
    ctx.save();

    let sharpness = gd.edgeSharpness !== undefined ? gd.edgeSharpness : 100;
    if (sharpness < 100) {
        let blurPx = Math.round((100 - sharpness) * 0.06);
        if (blurPx > 0) ctx.filter = 'blur(' + blurPx + 'px)';
    }

    let fgWidth = gd.foregreenWidth !== undefined ? gd.foregreenWidth : 1.0;

    if (fgWidth > 0.05) {
        // 1. Foregreen fill
        ctx.beginPath();
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            if (i === 0) ctx.moveTo(pxX, pxY);
            else ctx.lineTo(pxX, pxY);
        });
        ctx.closePath();
        ctx.fillStyle = foregreenColor;
        ctx.fill();

        // 2. Inner green fill (putting surface)
        let innerPts = (gd.innerDensePts && gd.innerDensePts.length >= 3) ? gd.innerDensePts : ((typeof insetPolygon === 'function') ? insetPolygon(densePts, fgWidth) : densePts);
        gd.innerDensePts = innerPts;

        ctx.beginPath();
        innerPts.forEach((pt, i) => {
            let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            if (i === 0) ctx.moveTo(pxX, pxY);
            else ctx.lineTo(pxX, pxY);
        });
        ctx.closePath();
        ctx.fillStyle = greenColor;
        ctx.fill();

        // 3. Mowing pattern
        let mowPattern = gd.mowPattern || 'SOLID';
        if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
            paintMowingPattern(ctx, innerPts, greenColor, mowPattern);
        }
    } else {
        gd.innerDensePts = densePts;

        ctx.beginPath();
        densePts.forEach((pt, i) => {
            let pxX = ((pt.x + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            let pxY = ((pt.z + (window.TERRAIN_SIZE / 2)) / window.TERRAIN_SIZE) * 4096;
            if (i === 0) ctx.moveTo(pxX, pxY);
            else ctx.lineTo(pxX, pxY);
        });
        ctx.closePath();
        ctx.fillStyle = greenColor;
        ctx.fill();

        let mowPattern = gd.mowPattern || 'SOLID';
        if (mowPattern !== 'SOLID' && typeof paintMowingPattern === 'function') {
            paintMowingPattern(ctx, densePts, greenColor, mowPattern);
        }
    }

    ctx.filter = 'none';
    ctx.restore();
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

        let tension = (gd.tension !== undefined) ? gd.tension : 0.5;
        let densePts = getDenseGreenPoints(gd.points, tension);
        gd.densePts = densePts;
        // Keep the inner (putting surface) polygon in sync with outline + foregreen width;
        // a stale copy painted the putting surface at the old position/size after move/scale/drag.
        let _fgW = gd.foregreenWidth !== undefined ? gd.foregreenWidth : 1.0;
        gd.innerDensePts = (_fgW > 0.05) ? insetPolygon(densePts, _fgW) : densePts;

    // === PAINT PASS ===
    if (updateTexture && window._arcadePCtx) {
        window.repaintGreenTextureOnly(hole);

        if (window._arcadeMapTex) window._arcadeMapTex.needsUpdate = true;
        window.invalidateBiomeData(true);
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
            // A flag within ~1.5 m of the centroid (the default placement) gives no meaningful
            // direction: before, tilt was 0 (flag exactly at the centroid) or pointed in a random
            // direction that flipped with every centimetre the flag moved.
            if (Math.hypot(tiltDirX, tiltDirZ) < 1.5) { tiltDirX = 0; tiltDirZ = 0; }
        } else if (gd.tiltAngle !== undefined) {
            tiltDirX = Math.sin(gd.tiltAngle);
            tiltDirZ = Math.cos(gd.tiltAngle);
        } else if (gd.tiltAim && hole.aimPoint) {
            tiltDirX = hole.aimPoint.x - polyCentX;
            tiltDirZ = hole.aimPoint.z - polyCentZ;
        }
        // Fallback: slope up towards the back of the green (direction tee -> green), the usual
        // back-to-front slope, so a freshly built green is not perfectly flat.
        if (Math.hypot(tiltDirX, tiltDirZ) < 1e-6) {
            if (gd.tiltAngle !== undefined) {
                tiltDirX = Math.sin(gd.tiltAngle);
                tiltDirZ = Math.cos(gd.tiltAngle);
            } else if (hole.tees) {
                let tee = hole.tees.black || hole.tees.white || hole.tees.yellow || hole.tees.red;
                if (tee) { tiltDirX = polyCentX - tee.x; tiltDirZ = polyCentZ - tee.z; }
            }
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
    if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        // Fairway-first holes: tee colours were ranked against a stand-in aim point, rank them against the new flag
        if (window.autoAssignTeeColors) window.autoAssignTeeColors(hole);
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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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

    // Move flag, its 3D mesh and every pin position together with the green
    // (pins may alias each other or the flag - move each distinct object once)
    let _moved = new Set();
    let _shift = function(o) {
        if (o && !_moved.has(o)) { _moved.add(o); o.x += dx; o.z += dz; }
    };
    _shift(hole.flag);
    if (hole.pins) { for (let k in hole.pins) _shift(hole.pins[k]); }
    if (hole.flagMesh && hole.flag) {
        hole.flagMesh.position.x = hole.flag.x;
        hole.flagMesh.position.z = hole.flag.z;
    }

    // Re-apply pipeline with exact same parameters
    window.applyGreenPipeline(hole, false, true);
    if (window.autoAssignTeeColors) window.autoAssignTeeColors(hole); // flag moved with the green

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
    if (!window.validateSmartShape(smartGreenPoints)) return;
    window._smartShapeClosed = true;
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
        // same spline as the drawing preview (catmullrom, tension 0.5)
        let densePts = getDenseGreenPoints(smartGreenPoints, 0.5);

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

        // Synchronize roughMaskCtx directly for polygon paint
        if (window.roughMaskCtx) {
            let rmCtx = window.roughMaskCtx;
            let maskColor = 'rgb(0, 0, 0)';
            if (surface === 'rough') maskColor = 'rgb(255, 0, 0)';
            else if (surface === 'fescue') maskColor = 'rgb(0, 255, 0)';
            else if (surface === 'bunker') maskColor = 'rgb(0, 128, 0)';
            else if (surface === 'semi') maskColor = 'rgb(0, 0, 255)';
            else if (surface === 'foregreen') maskColor = 'rgb(128, 0, 0)';
            else if (surface === 'custom') {
                let cfg = window.CURRENT_BIOME_CONFIG || {};
                if (color === (cfg.roughColor || '#4a782b')) maskColor = 'rgb(255, 0, 0)';
                else if (color === (cfg.fescueColor || '#2d4c1a')) maskColor = 'rgb(0, 255, 0)';
                else if (color === (cfg.bunkerColor || '#e0d8a4')) maskColor = 'rgb(0, 128, 0)';
                else maskColor = 'rgb(0, 0, 0)';
            }
            rmCtx.save();
            rmCtx.beginPath();
            densePts.forEach((pt, i) => {
                let pxX = ((pt.x + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                let pxY = ((pt.z + (window.TERRAIN_SIZE/2)) / window.TERRAIN_SIZE) * 4096;
                if(i === 0) rmCtx.moveTo(pxX, pxY);
                else rmCtx.lineTo(pxX, pxY);
            });
            rmCtx.closePath();
            rmCtx.fillStyle = maskColor;
            rmCtx.fill();
            rmCtx.restore();
            if (window.roughMaskTex) window.roughMaskTex.needsUpdate = true;
        }

        window.invalidateBiomeData(true);
        if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
        if (typeof window.rebuildGreenMask === 'function') window.rebuildGreenMask();
        if (window._terrainShells) window._terrainShells.refresh();

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
        // same spline as the drawing preview (catmullrom, tension 0.5)
        let densePts = getDenseGreenPoints(smartGreenPoints, 0.5);

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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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
        if (!window._terrainChunks) window._arcadePlaneGeo.computeVertexNormals(); // syncAll() recomputes them
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


// ---- Hålbyggare menu: status marks + "Next" suggestion (guides, never blocks) ----
(function() {
    let skipped = new WeakSet();   // holes where the user chose to skip the fairway (this session)
    let lastSig = '';

    function tr(key, fb) { return (window.t && window.t(key) !== key) ? window.t(key) : fb; }
    function built(hole) {
        let has = function(arr) { return (arr || []).some(function(o) { return o && o.points && o.points.length >= 3; }); };
        return {
            tee: !!(hole.tees && (hole.tees.red || hole.tees.yellow || hole.tees.white || hole.tees.black)),
            green: !!(hole.flag || hole.greenData),
            fairway: has(hole.fairways),
            bunker: has(hole.bunkers)
        };
    }

    window.updateHoleMenu = function(force) {
        let strip = document.getElementById('flyout-holes-strip');
        let card = document.getElementById('hole-next-card');
        if (!strip || !card || !window.courseHoles) return;
        if (!force && strip.style.display === 'none') return;
        let hole = window.courseHoles[window.currentHoleIndex];
        if (!hole) return;
        let b = built(hole), par = hole.par || 4;
        let lang = (window.getGolfLanguage && window.getGolfLanguage()) || 'sv';
        let sk = skipped.has(hole);
        let planned = !!(window.hasPlannedGreen && window.hasPlannedGreen());
        let hp = window._hgParts || {};
        let sig = [lang, window.currentHoleIndex, par, sk, b.tee, b.green, b.fairway, b.bunker, !!hole.aimPoint, planned,
            hp.tee, hp.fairway, hp.green, hp.greenBunkers, hp.fairwayBunkers].join('|');
        if (!force && sig === lastSig) return;
        lastSig = sig;

        // required (tee, green) / recommended (fairway on par 4-5) / optional
        let marks = {
            tee: b.tee ? 'done' : 'need',
            green: b.green ? 'done' : 'need',
            fairway: b.fairway ? 'done' : (par >= 4 && !sk ? 'need' : 'opt'),
            bunker: b.bunker ? 'done' : 'opt'
        };
        let sym = { done: ['✓', '#4ade80'], need: ['●', '#f59e0b'], opt: ['○', '#64748b'] };
        let titles = { done: tr('hm_built', 'Byggd'), need: tr('hm_needed', 'Behövs'), opt: tr('hm_optional', 'Valfri') };
        ['tee', 'green', 'fairway', 'bunker'].forEach(function(k) {
            let el = document.getElementById('hm-mark-' + k);
            if (!el) return;
            el.textContent = sym[marks[k]][0];
            el.style.color = sym[marks[k]][1];
            el.title = titles[marks[k]];
        });

        let name = { tee: 'Tee', green: 'Green', fairway: 'Fairway', bunker: 'Bunker' };
        let next = !b.tee ? 'tee' : (!b.green ? 'green' : ((par >= 4 && !b.fairway && !sk) ? 'fairway' : null));
        let html = '';
        if (!b.tee && !b.green && !b.fairway && !b.bunker && window.HoleGenerator && window.HoleGenerator.holeIsEmpty(hole)) {
            html += '<button type="button" onclick="generateRandomHoleWithProgress()" style="width:100%; margin-bottom:8px; background:linear-gradient(90deg,#a855f7,#6366f1); color:#fff; border:none; border-radius:6px; padding:7px 8px; font-weight:bold; font-size:12px; cursor:pointer;">🎲 ' + tr('hg_button', 'Slumpa ett hål') + ' (Par ' + Math.max(3, Math.min(6, par)) + ')</button>' +
                '<button type="button" onclick="openHoleBlueprint()" style="width:100%; margin-bottom:6px; background:#1e293b; color:#e2e8f0; border:1px solid #6366f1; border-radius:6px; padding:7px 8px; font-weight:bold; font-size:12px; cursor:pointer;">🗺️ ' + tr('bp_button', 'Placera på karta') + '</button>' +
                '<button type="button" onclick="openBackdropMap()" style="width:100%; margin-bottom:6px; background:#1e293b; color:#e2e8f0; border:1px solid #f59e0b; border-radius:6px; padding:7px 8px; font-weight:bold; font-size:12px; cursor:pointer;">' + tr('bd_button', '🏔️ Bakgrund (berg, hav, båtar)') + '</button>' +
                '<div style="color:#64748b; font-size:10px; margin-bottom:6px;">' + tr('hg_hint', 'Appen lägger ut tee, fairway, green och bunkrar – du ändrar sedan som du vill.') + '</div>' +
                hgAdvancedHtml(par);
        }
        if (planned) {
            html += '<div style="color:#38bdf8; font-size:10.5px; margin-bottom:8px; line-height:1.35;">🔵 ' + tr('hg_planned', 'Den blå ringen visar var greenen planerades. Bygg höjd eller vatten först och sedan greenen där.') + '</div>';
        }
        if (next) {
            html += '<div style="color:#94a3b8;">' + tr('hm_next', 'Nästa:') + ' <b style="color:#f1f5f9;">' + name[next] + '</b>' +
                (next === 'fairway' ? ' <span style="color:#64748b;">(' + tr('hm_recommended', 'rekommenderas') + ')</span>' : '') + '</div>' +
                '<div style="display:flex; gap:6px; margin-top:6px;">' +
                '<button type="button" onclick="selectHoleComponent(\'' + next.toUpperCase() + '\')" style="flex:1; background:#38bdf8; color:#0f172a; border:none; border-radius:6px; padding:5px 8px; font-weight:bold; font-size:11px; cursor:pointer;">' + tr('hm_add', 'Bygg') + '</button>' +
                (next === 'fairway' ? '<button type="button" onclick="skipHoleFairway()" style="background:transparent; color:#94a3b8; border:1px solid #475569; border-radius:6px; padding:5px 8px; font-size:11px; cursor:pointer;">' + tr('hm_skip', 'Hoppa över') + '</button>' : '') +
                '</div>';
        } else {
            html += '<div style="color:#4ade80; font-weight:bold;">' + tr('hm_ready', '✓ Hålet är klart – lägg gärna till bunkrar') + '</div>';
        }
        if (par === 3 && !b.fairway) {
            html += '<div style="color:#64748b; margin-top:5px; font-size:10px;">' + tr('hm_par3_note', 'Många par 3 har ingen fairway.') + '</div>';
        }
        card.innerHTML = html;
    };

    // "What should be randomised?" (advanced): everything on by default, dependent parts follow their parent
    function hgAdvancedHtml(par) {
        let P = window.HoleGenerator ? window.HoleGenerator.normalizeParts(window._hgParts) : {};
        let noFw = par <= 3;   // par 3 has no fairway, so neither fairway nor fairway bunkers exist
        let rows = [
            ['tee', 'Tee', 0, false], ['fairway', 'Fairway', 0, noFw], ['green', 'Green', 0, false],
            ['greenBunkers', tr('hg_p_gbunk', 'Greenbunkrar'), 1, !P.green], ['fairwayBunkers', tr('hg_p_fbunk', 'Fairwaybunkrar'), 1, noFw || !P.fairway]
        ];
        let h = '<details ' + (window._hgAdvOpen ? 'open ' : '') + 'ontoggle="window._hgAdvOpen=this.open" style="margin-bottom:8px;">' +
            '<summary style="cursor:pointer; color:#94a3b8; font-size:10px;">⚙️ ' + tr('hg_adv', 'Avancerat – vad ska slumpas?') + '</summary><div style="margin-top:5px;">';
        rows.forEach(function(r) {
            let on = !!P[r[0]] && !r[3];
            h += '<label style="display:flex; align-items:center; gap:6px; padding:2px 0 2px ' + (r[2] ? 16 : 0) + 'px; font-size:11px; color:' + (r[3] ? '#475569' : '#cbd5e1') + ';">' +
                '<input type="checkbox" ' + (on ? 'checked ' : '') + (r[3] ? 'disabled ' : '') + 'onchange="hgTogglePart(\'' + r[0] + '\', this.checked)"> ' + r[1] + '</label>';
        });
        return h + '</div></details>';
    }
    window.hgTogglePart = function(key, on) {
        let P = window.HoleGenerator ? window.HoleGenerator.normalizeParts(window._hgParts) : {};
        P[key] = on;
        // a dependent part is switched on again together with its parent
        if (key === 'green') P.greenBunkers = on;
        if (key === 'fairway') P.fairwayBunkers = on;
        window._hgParts = P;
        window.updateHoleMenu(true);
    };

    window.skipHoleFairway = function() {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (!hole) return;
        skipped.add(hole);
        window.updateHoleMenu(true);
    };

    setInterval(function() { window.updateHoleMenu(false); }, 700);
})();
