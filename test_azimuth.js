/**
 * Azimuth Regression Test
 * Verifies that carry distance is rotation-invariant (Magnus lift works at all azimuth angles).
 */

// Mock window for physics.js
global.window = { GREEN_STIMP: 10.0, matchSettings: { greenFirmness: 'NORMAL' } };

// Load physics engine
require('./physics.js');
const { simulateFlight } = window.GolfPhysics;

// Flat terrain callback (z=0 everywhere, FAIRWAY)
const flatEnv = {
    getTerrainAt: (x, y, z) => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }),
    checkCollisionCallback: (x, y, z) => null,
    wind: [0, 0, 0],
    altitudeFeet: 0,
    temperatureC: 25
};

const baseInput = {
    ballSpeedMph: 130,
    launchAngleDeg: 14,
    totalSpinRpm: 2500,
    spinAxisDeg: 0,
    startPos: [0, 0, 0],
    isLiveData: true,
    isTeeShot: true
};

const azimuthTests = [0, 30, 45, 60, 90, -45, -90, -135, 180];

console.log("=== AZIMUTH REGRESSION TEST ===");
console.log("Input: 130 mph / 14° / 2500 rpm backspin / Flat terrain / No wind\n");
console.log("Azim°   Carry(m)   Carry(yds)  Apex(m)   Time(s)   PASS?");
console.log("─────   ────────   ──────────  ──────    ──────    ─────");

let refCarry = null;
let allPass = true;

for (const azim of azimuthTests) {
    const input = { ...baseInput, azimDeg: azim };
    const result = simulateFlight(input, flatEnv);
    
    const carryM = result.metrics.carryMeters;
    const carryYds = (carryM * 1.09361).toFixed(1);
    const apex = result.metrics.apexMeters.toFixed(1);
    const time = result.metrics.flightTime.toFixed(2);
    
    if (refCarry === null) refCarry = carryM;
    
    const deviation = Math.abs(carryM - refCarry) / refCarry * 100;
    const pass = deviation < 2.0;
    if (!pass) allPass = false;
    
    console.log(
        `${String(azim).padStart(5)}°   ${carryM.toFixed(1).padStart(7)}    ${carryYds.padStart(9)}   ${apex.padStart(5)}    ${time.padStart(5)}    ${pass ? '✅' : '❌ ' + deviation.toFixed(1) + '%'}`
    );
}

console.log("\n─────────────────────────────────────────────────────────");
console.log(`Reference carry (azim=0°): ${refCarry.toFixed(1)} m = ${(refCarry * 1.09361).toFixed(1)} yds`);
console.log(`Target: ~195 m (213 yds) ±10%`);
console.log(`\nOverall: ${allPass ? '✅ ALL PASS — Magnus lift is rotation-invariant!' : '❌ FAIL — carry varies with azimuth'}`);

// === SIDESPIN DIRECTION TEST ===
console.log("\n\n=== SIDESPIN DIRECTION TEST ===");
console.log("Input: 130 mph / 14° / 2500 rpm total / spinAxis=15° (slice)\n");

const sliceInput = { ...baseInput, spinAxisDeg: 15 };

for (const azim of [0, -90]) {
    const input = { ...sliceInput, azimDeg: azim };
    const result = simulateFlight(input, flatEnv);
    const final = result.path[result.path.length - 1];
    
    // At azim=0, flight is along +Y. Slice = +X (right).
    // At azim=-90, flight is along -X. Slice = -Y (right relative to flight).
    const lateralDev = azim === 0 
        ? final.x  // X-displacement at azim=0
        : -final.y; // -Y-displacement at azim=-90
    
    const dir = lateralDev > 0 ? 'RIGHT (slice) ✅' : 'LEFT (draw) ❌';
    console.log(`Azim ${String(azim).padStart(4)}°: Lateral dev = ${lateralDev.toFixed(1)}m → ${dir}`);
}
