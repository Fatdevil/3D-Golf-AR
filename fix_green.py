import os

arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

# FIX 1: Replace 4-pass loop with 1-pass (higher influence per pass)
# The old code: influence * 0.5 over 4 passes ≈ converges to ~0.94
# New code: influence * 0.95 in 1 pass = same result, 4x faster
old_loop = """        // Multiple passes for smooth convergence
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
        }"""

new_loop = """        // Single-pass terrain sculpting (optimized from 4-pass)
        for(let gz = gzStart; gz <= gzEnd; gz++) {
            for(let gx = gxStart; gx <= gxEnd; gx++) {
                let idx = gz * (TERRAIN_SEGS+1) + gx;
                let vx = positions[idx*3];
                let vz = -positions[idx*3+1];

                let isInside = pointInPolygon(vx, vz, densePts);
                let distEdge = distToPolygon(vx, vz, densePts);

                if(!isInside && distEdge > margin) continue;

                // Target height with difficulty contours (randomized per build)
                let targetHeight = baseH;
                let seedX = vx + window._sgSeedOffsetX;
                let seedZ = vz + window._sgSeedOffsetZ;
                if(difficulty === 'EASY') {
                    targetHeight += Math.sin(seedX * 0.1) * Math.cos(seedZ * 0.1) * 0.10;
                } else if(difficulty === 'MED') {
                    targetHeight += Math.sin(seedX * 0.12) * Math.cos(seedZ * 0.12) * 0.18;
                    targetHeight += Math.sin(seedX * 0.07 + seedZ * 0.05) * 0.08;
                } else if(difficulty === 'HARD') {
                    targetHeight += Math.sin(seedX * 0.15) * Math.cos(seedZ * 0.12) * 0.22
                                  + Math.sin(seedZ * 0.25 + seedX * 0.08) * 0.06
                                  + Math.cos(seedX * 0.20) * Math.sin(seedZ * 0.18) * 0.05;
                }

                let currentH = positions[idx*3+2];
                let influence;

                if(isInside) {
                    influence = 1.0;
                } else {
                    influence = 1.0 - (distEdge / margin);
                    influence = Math.max(0, influence * influence * (3 - 2 * influence));
                }

                // Single pass with 0.95 influence ≈ same convergence as 4×0.5
                positions[idx*3+2] = currentH + (targetHeight - currentH) * influence * 0.95;
            }
        }"""

if old_loop in c:
    c = c.replace(old_loop, new_loop)
    print("FIX 1: 4-pass -> 1-pass DONE")
else:
    print("FIX 1: Target not found (may already be fixed or whitespace mismatch)")


# FIX 2: Add double-click guard — disable pointer events briefly after build
old_clear = """        clearSmartGreen();

    };

        function executeSmartBuilder() {"""

new_clear = """        clearSmartGreen();
        saveLevel();
        
        // Prevent double-click from starting a new shape immediately
        window._smartBuildCooldown = true;
        setTimeout(function() { window._smartBuildCooldown = false; }, 500);
    };

        function executeSmartBuilder() {
            if(window._smartBuildCooldown) return;"""

if old_clear in c:
    c = c.replace(old_clear, new_clear)
    print("FIX 2: Double-click guard DONE")
else:
    print("FIX 2: Target not found")


with open(arcade_path, 'w', encoding='utf-8') as f:
    f.write(c)

print("All fixes applied!")
