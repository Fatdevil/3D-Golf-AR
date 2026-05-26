arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Add the anti-crossing utility functions right before the pointerdown handler
# Find a good injection point - right after the smartGreenLineMesh declaration
old_inject = """    let smartGreenPoints = [];
    let smartGreenSpheres = [];
    let smartGreenLineMesh = null;"""

new_inject = """    let smartGreenPoints = [];
    let smartGreenSpheres = [];
    let smartGreenLineMesh = null;

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

    // Smart point placement: try append first, fallback to nearest-edge insert
    function smartAddPoint(pt) {
        let n = smartGreenPoints.length;
        if(n < 3) {
            // Too few points to cross, just append
            smartGreenPoints.push(pt);
            return true;
        }
        // Try appending (normal behavior)
        if(!wouldCauseCrossing(smartGreenPoints, pt, n)) {
            smartGreenPoints.push(pt);
            return true;
        }
        // Append would cross — try inserting at nearest edge
        let insertIdx = findNearestEdge(smartGreenPoints, pt);
        if(!wouldCauseCrossing(smartGreenPoints, pt, insertIdx)) {
            smartGreenPoints.splice(insertIdx, 0, pt);
            return true;
        }
        // Even nearest-edge insertion crosses — reject
        return false;
    }"""

if old_inject in c:
    c = c.replace(old_inject, new_inject)
    print("1. Anti-crossing utility functions added")
else:
    print("1. FAILED - smartGreenPoints declaration not found")

# 2. Replace the simple push with smartAddPoint
old_push = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            if(e.button === 0 && lastHitPoint) {
                smartGreenPoints.push(lastHitPoint.clone());
                updateSmartGreenPreview();"""

new_push = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            if(e.button === 0 && lastHitPoint) {
                if(!smartAddPoint(lastHitPoint.clone())) {
                    showBuildToast('\\u26a0\\ufe0f Shape cannot cross itself!', '#ef4444');
                } else {
                    updateSmartGreenPreview();
                }"""

# Need to handle the else clause properly
# Actually let's look at the full block
old_block = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            if(e.button === 0 && lastHitPoint) {
                smartGreenPoints.push(lastHitPoint.clone());
                updateSmartGreenPreview();
            } else if (e.button === 2 && smartGreenPoints.length > 0) {
                smartGreenPoints.pop();
                updateSmartGreenPreview();
            }
            controls.enabled = false;"""

new_block = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            if(e.button === 0 && lastHitPoint) {
                if(!smartAddPoint(lastHitPoint.clone())) {
                    showBuildToast('\\u26a0\\ufe0f Shape cannot cross itself!', '#ef4444');
                }
                updateSmartGreenPreview();
            } else if (e.button === 2 && smartGreenPoints.length > 0) {
                smartGreenPoints.pop();
                updateSmartGreenPreview();
            }
            controls.enabled = false;"""

if old_block in c:
    c = c.replace(old_block, new_block)
    print("2. smartAddPoint integrated into click handler")
else:
    print("2. FAILED - click handler block not found")

with open(arcade_path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Done!")
