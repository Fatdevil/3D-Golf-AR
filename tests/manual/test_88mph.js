const fs = require('fs');

// Mock window
global.window = {};

// Load physics engine and patch the bug in memory!
let physicsCode = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');
physicsCode = physicsCode.replace("let impactTerrainType = 'FAIRWAY';", "let impactTerrainType = tInfo.type || 'FAIRWAY';");
eval(physicsCode);
const simulateFlight = window.GolfPhysics.simulateFlight;

// Mock environment context
const envCtx = {
    getTerrainAt: (x, y) => ({ z: 0, normal: [0, 0, 1], type: 'ROUGH' }),
    checkCollisionCallback: () => null,
    temperatureC: 15,
    altitudeFeet: 0,
    wind: [0, 0, 0]
};

const input = {
    ballSpeedMph: 88,
    launchAngleDeg: 14,
    totalSpinRpm: 2500,
    spinAxisDeg: 0,
    azimDeg: 0,
    isTeeShot: true, // From Tee
    isLiveData: false
};

const result = simulateFlight(input, envCtx);

console.log(`=== SIMULATION WITH BUGFIX (Terrain = ROUGH) ===`);
console.log(`Carry: ${(result.metrics.carryMeters * 1.09361).toFixed(1)} yards`);
console.log(`Total: ${(result.metrics.totalMeters * 1.09361).toFixed(1)} yards`);
console.log(`Roll: ${((result.metrics.totalMeters - result.metrics.carryMeters) * 1.09361).toFixed(1)} yards`);
console.log(`Final Terrain: ${result.metrics.finalTerrainType}`);
