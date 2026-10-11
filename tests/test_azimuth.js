/**
 * Azimuth & Sidespin Regression Test
 * 1. Carry must be identical (±2%) at all azimuth angles (Magnus lift invariance)
 * 2. Sidespin lateral offset must be identical (±0.5m) at all azimuth angles
 */

global.window = { GREEN_STIMP: 10.0, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const { simulateFlight } = window.GolfPhysics;

const flatEnv = {
    getTerrainAt: (x, y, z) => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }),
    checkCollisionCallback: (x, y, z) => null,
    wind: [0, 0, 0],
    altitudeFeet: 0,
    temperatureC: 25
};

// ═══════════════════════════════════════════════════════════════
// TEST 1: CARRY AZIMUTH INVARIANCE (backspin lift)
// ═══════════════════════════════════════════════════════════════
console.log("=== CARRY AZIMUTH REGRESSION ===");
console.log("Input: 130 mph / 14° / 2500 rpm backspin / No wind\n");

const baseInput = {
    ballSpeedMph: 130, launchAngleDeg: 14, totalSpinRpm: 2500,
    spinAxisDeg: 0, startPos: [0, 0, 0], isLiveData: true, isTeeShot: true
};

const azimuths = [0, 30, 45, 60, 90, -45, -90, -135, 180];
let refCarry = null;
let carryAllPass = true;

console.log("Azim°   Carry(m)   Carry(yds)  Apex(m)   Time(s)   PASS?");
console.log("─────   ────────   ──────────  ──────    ──────    ─────");

for (const azim of azimuths) {
    const result = simulateFlight({ ...baseInput, azimDeg: azim }, flatEnv);
    const c = result.metrics.carryMeters;
    const yds = (c * 1.09361).toFixed(1);
    const apex = result.metrics.apexMeters.toFixed(1);
    const time = result.metrics.flightTime.toFixed(2);
    if (refCarry === null) refCarry = c;
    const dev = Math.abs(c - refCarry) / refCarry * 100;
    const pass = dev < 2.0;
    if (!pass) carryAllPass = false;
    console.log(`${String(azim).padStart(5)}°   ${c.toFixed(1).padStart(7)}    ${yds.padStart(9)}   ${apex.padStart(5)}    ${time.padStart(5)}    ${pass ? '✅' : '❌ ' + dev.toFixed(1) + '%'}`);
}

console.log(`\nRef carry: ${refCarry.toFixed(1)} m = ${(refCarry * 1.09361).toFixed(1)} yds`);
console.log(`Target: 195–200 m (213–219 yds)`);
console.log(`Carry test: ${carryAllPass ? '✅ ALL PASS' : '❌ FAIL'}\n`);

// ═══════════════════════════════════════════════════════════════
// TEST 2: SIDESPIN AZIMUTH INVARIANCE (lateral curve)
// ═══════════════════════════════════════════════════════════════
console.log("=== SIDESPIN AZIMUTH REGRESSION ===");
console.log("Input: 130 mph / 14° / +800 sidespin (slice) / No wind\n");

const backspin = 2500;
const sidespin = 800; // positive = slice
const totalSpin = Math.sqrt(backspin * backspin + sidespin * sidespin);
const spinAxisDeg = Math.atan2(sidespin, backspin) * (180 / Math.PI);   // positive sidespin = slice = positive axis (right)

const sliceInput = {
    ballSpeedMph: 130, launchAngleDeg: 14,
    totalSpinRpm: totalSpin, spinAxisDeg: spinAxisDeg,
    startPos: [0, 0, 0], isLiveData: true, isTeeShot: true
};

const ssAzimuths = [0, -45, -90, -135, 180];
const ssResults = [];

console.log("Azim°   Lateral(m)   Direction");
console.log("─────   ──────────   ─────────");

for (const azim of ssAzimuths) {
    const result = simulateFlight({ ...sliceInput, azimDeg: azim }, flatEnv);
    const last = result.path[result.path.length - 1];
    
    // Project final position onto axis perpendicular to flight direction
    // Flight direction unit vector: [sin(azim), cos(azim)]
    // Right-perpendicular: [cos(azim), -sin(azim)]
    const azimRad = azim * Math.PI / 180;
    const perpX = Math.cos(azimRad);
    const perpY = -Math.sin(azimRad);
    
    // Lateral offset = dot(final_pos_XY, perp_direction)
    const lateralOffset = last.x * perpX + last.y * perpY;
    
    ssResults.push(lateralOffset);
    const dir = lateralOffset > 0 ? 'RIGHT (slice)' : 'LEFT (draw)';
    console.log(`${String(azim).padStart(5)}°   ${lateralOffset.toFixed(2).padStart(10)}   ${dir}`);
}

const refLateral = ssResults[0];
const ssAllPass = ssResults.every(v => Math.abs(v - refLateral) < 0.5);
console.log(`\nRef lateral: ${refLateral.toFixed(2)} m`);
console.log(`Max deviation: ${Math.max(...ssResults.map(v => Math.abs(v - refLateral))).toFixed(2)} m (tol: 0.5m)`);
console.log(`Sidespin test: ${ssAllPass ? '✅ ALL PASS — azimuth-invariant' : '❌ FAIL — varies with azimuth'}\n`);

// ═══════════════════════════════════════════════════════════════
// OVERALL
// ═══════════════════════════════════════════════════════════════
console.log("═════════════════════════════════════");
console.log(`CARRY:    ${carryAllPass ? '✅' : '❌'}`);
console.log(`SIDESPIN: ${ssAllPass ? '✅' : '❌'}`);
console.log(`OVERALL:  ${(carryAllPass && ssAllPass) ? '✅ ALL PASS' : '❌ REGRESSION DETECTED'}`);
console.log("═════════════════════════════════════");
