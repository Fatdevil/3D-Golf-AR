// test_green_math.js
// Automated verification test for green gradient, terrain normals, and downhill flow direction.

const assert = require('assert');

// Test planes configuration
const testCases = [
    {
        name: "1. Flat plane (0% slope)",
        fn: (x, z) => 10.0,
        expectedDhdx: 0.0,
        expectedDhdz: 0.0,
        expectedSlopePct: 0.0,
        expectedDownhillX: 0.0,
        expectedDownhillZ: 0.0,
        expectedNormal: [0.0, 1.0, 0.0] // Three.js: (X, Y=up, Z)
    },
    {
        name: "2. Uphill to East (+X, 2% slope)",
        fn: (x, z) => 0.02 * x,
        expectedDhdx: 0.02,
        expectedDhdz: 0.0,
        expectedSlopePct: 2.0,
        expectedDownhillX: -1.0, // Water/ball flows West (-X)
        expectedDownhillZ: 0.0,
        expectedNormalSign: { x: -1, y: 1, z: 0 } // Normal leans away from uphill
    },
    {
        name: "3. Uphill to West (-X, 2% slope)",
        fn: (x, z) => -0.02 * x,
        expectedDhdx: -0.02,
        expectedDhdz: 0.0,
        expectedSlopePct: 2.0,
        expectedDownhillX: 1.0, // Water/ball flows East (+X)
        expectedDownhillZ: 0.0,
        expectedNormalSign: { x: 1, y: 1, z: 0 }
    },
    {
        name: "4. Uphill to South (+Z, 2% slope)",
        fn: (x, z) => 0.02 * z,
        expectedDhdx: 0.0,
        expectedDhdz: 0.02,
        expectedSlopePct: 2.0,
        expectedDownhillX: 0.0,
        expectedDownhillZ: -1.0, // Water/ball flows North (-Z)
        expectedNormalSign: { x: 0, y: 1, z: -1 }
    },
    {
        name: "5. Uphill to North (-Z, 2% slope)",
        fn: (x, z) => -0.02 * z,
        expectedDhdx: 0.0,
        expectedDhdz: -0.02,
        expectedSlopePct: 2.0,
        expectedDownhillX: 0.0,
        expectedDownhillZ: 1.0, // Water/ball flows South (+Z)
        expectedNormalSign: { x: 0, y: 1, z: 1 }
    }
];

// Reference implementation of sampleGreenGradient
function sampleGreenGradientRef(heightFn, wx, wz, sampleRadius = 0.20) {
    const d = sampleRadius;
    const hCenter = heightFn(wx, wz);
    const hR = heightFn(wx + d, wz);
    const hL = heightFn(wx - d, wz);
    const hU = heightFn(wx, wz + d);
    const hD = heightFn(wx, wz - d);
    
    const dhdx = (hR - hL) / (2 * d);
    const dhdz = (hU - hD) / (2 * d);
    
    const slopeMagnitude = Math.hypot(dhdx, dhdz);
    const slopePercent = slopeMagnitude * 100.0;
    
    const downhillX = slopeMagnitude > 1e-6 ? (-dhdx / slopeMagnitude) : 0;
    const downhillZ = slopeMagnitude > 1e-6 ? (-dhdz / slopeMagnitude) : 0;
    
    const len = Math.sqrt(dhdx * dhdx + dhdz * dhdz + 1.0);
    const normal = [-dhdx / len, 1.0 / len, -dhdz / len];
    
    return { height: hCenter, dhdx, dhdz, slopePercent, slopeMagnitude, downhillX, downhillZ, normal };
}

// Function to simulate arcade.html localGetTerrainAt on a synthetic heightfield
function simulateLocalGetTerrainAt(heightFn, TERRAIN_SIZE, TERRAIN_SEGS, px, py, isFixed = false) {
    const threeX = px;
    const threeZ = -py;
    const step = TERRAIN_SIZE / TERRAIN_SEGS;
    
    const gx = Math.round((threeX + (TERRAIN_SIZE / 2)) / step);
    const gz = Math.round((threeZ + (TERRAIN_SIZE / 2)) / step);
    
    const height = heightFn(threeX, threeZ);
    const gxRight = Math.min(TERRAIN_SEGS, gx + 1);
    const hR = heightFn(threeX + step, threeZ);
    const dx_phys = (hR - height) / step;
    
    let dy_phys;
    if (!isFixed) {
        // BUGGY CODE in arcade.html: gzDown = gz - 1
        const hD = heightFn(threeX, threeZ - step);
        dy_phys = (hD - height) / step; // approx -dh/dz
    } else {
        // FIXED CODE: symmetric or forward sample along +threeZ
        const hU = heightFn(threeX, threeZ + step);
        const hD = heightFn(threeX, threeZ - step);
        dy_phys = (hU - hD) / (2 * step); // approx +dh/dz
    }
    
    const len = Math.sqrt(dx_phys * dx_phys + dy_phys * dy_phys + 1.0);
    // In arcade.html: normal = [-dx_phys/len, -dy_phys/len, 1.0/len];
    const normal = [-dx_phys / len, -dy_phys / len, 1.0 / len];
    
    return {
        z: height,
        normal: normal,
        dx_phys,
        dy_phys
    };
}

console.log("==================================================");
console.log("TESTING sampleGreenGradientRef AGAINST SYNTHETIC PLANES");
console.log("==================================================");

let allPassed = true;
for (const tc of testCases) {
    const res = sampleGreenGradientRef(tc.fn, 5.0, 5.0);
    const dhdxOk = Math.abs(res.dhdx - tc.expectedDhdx) < 1e-5;
    const dhdzOk = Math.abs(res.dhdz - tc.expectedDhdz) < 1e-5;
    const slopeOk = Math.abs(res.slopePercent - tc.expectedSlopePct) < 1e-4;
    const flowXOk = Math.abs(res.downhillX - tc.expectedDownhillX) < 1e-5;
    const flowZOk = Math.abs(res.downhillZ - tc.expectedDownhillZ) < 1e-5;
    
    let normalOk = true;
    if (tc.expectedNormalSign) {
        if (tc.expectedNormalSign.x !== 0 && Math.sign(res.normal[0]) !== tc.expectedNormalSign.x) normalOk = false;
        if (tc.expectedNormalSign.z !== 0 && Math.sign(res.normal[2]) !== tc.expectedNormalSign.z) normalOk = false;
    }
    
    const passed = dhdxOk && dhdzOk && slopeOk && flowXOk && flowZOk && normalOk;
    console.log(`${passed ? "✅" : "❌"} ${tc.name}: slope=${res.slopePercent.toFixed(1)}%, flow=(${res.downhillX.toFixed(2)}, ${res.downhillZ.toFixed(2)}), norm=(${res.normal[0].toFixed(2)}, ${res.normal[1].toFixed(2)}, ${res.normal[2].toFixed(2)})`);
    if (!passed) allPassed = false;
}

console.log("\n==================================================");
console.log("DEMONSTRATING OLD localGetTerrainAt Z-SIGN BUG");
console.log("==================================================");

const southCase = testCases[3]; // Uphill +Z
const oldRes = simulateLocalGetTerrainAt(southCase.fn, 1000, 1000, 5.0, -5.0, false);
console.log(`Old localGetTerrainAt for Uphill +Z:`);
console.log(`  dx_phys: ${oldRes.dx_phys.toFixed(3)}, dy_phys: ${oldRes.dy_phys.toFixed(3)}`);
console.log(`  normal: [${oldRes.normal[0].toFixed(3)}, ${oldRes.normal[1].toFixed(3)}, ${oldRes.normal[2].toFixed(3)}]`);
console.log(`  Notice normal[1] (=Z normal) is POSITIVE (+${oldRes.normal[1].toFixed(3)}) when it should be NEGATIVE!`);

console.log("\n==================================================");
console.log("DEMONSTRATING FIXED localGetTerrainAt");
console.log("==================================================");

const fixedRes = simulateLocalGetTerrainAt(southCase.fn, 1000, 1000, 5.0, -5.0, true);
console.log(`Fixed localGetTerrainAt for Uphill +Z:`);
console.log(`  dx_phys: ${fixedRes.dx_phys.toFixed(3)}, dy_phys: ${fixedRes.dy_phys.toFixed(3)}`);
console.log(`  normal: [${fixedRes.normal[0].toFixed(3)}, ${fixedRes.normal[1].toFixed(3)}, ${fixedRes.normal[2].toFixed(3)}]`);
console.log(`  Fixed normal[1] (=Z normal) is correctly NEGATIVE (${fixedRes.normal[1].toFixed(3)})!`);

if (!allPassed) {
    console.error("\n❌ TESTS FAILED!");
    process.exit(1);
} else {
    console.log("\n🎉 ALL GRADIENT & FLOW DIRECTION TESTS PASSED!");
}
