const fs = require('fs');

global.window = {};
global.console = console;

const physicsCode = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');
eval(physicsCode);

let bs = 2000;
let ss = 800;
let totalSpin = Math.sqrt(bs*bs + ss*ss);
let spinAxis = Math.atan2(ss, bs) * (180 / Math.PI);

const launchConfig = {
    ballSpeedMph: 130,
    launchAngleDeg: 14,
    azimDeg: 0,
    totalSpinRpm: totalSpin,
    spinAxisDeg: spinAxis,
    isLiveData: true,
    clubSpeedMph: 0,
    clubPathDeg: 0,
    faceToPathDeg: 0,
    clubAoADeg: 0,
};

const result = window.GolfPhysics.simulateFlight(launchConfig, {});

console.log("=== THE DIAGNOSTIC TABLE VERIFICATION ===");
// In physics.js coords:
// X = Side (Right positive)
// Y = Forward
// Z = Up

let lp = result.path[result.path.length-1];

let carryMeters = result.metrics.carryMeters;
let carryYards = carryMeters * 1.09361;

// X is right/left deviation. The simulator uses p.x.
// Wait, we need to find the point where it crossed z=0 (landed), because the test simulation runs for the entire 25 seconds if it doesn't stop.
// Let's find first bounce.
let landPoint = null;
let apexMeters = 0;
for (let p of result.path) {
    if (p.z > apexMeters) apexMeters = p.z;
    if (p.z <= 0.02 && p.time > 0.5 && !landPoint) {
        landPoint = p;
    }
}
if (!landPoint) landPoint = lp; // fallback

let sideYards = landPoint.x * 1.09361;
let apexFeet = apexMeters * 3.28084;

console.log(`Carry: ${carryYards.toFixed(1)} yds (Target: ~215 ±5)`);
console.log(`Side Offset: ${sideYards.toFixed(1)} yds ${sideYards > 0 ? "RIGHT" : "LEFT"} (Target: +25-35 yds RIGHT)`);
console.log(`Apex: ${apexFeet.toFixed(1)} feet (Target: 85-95 feet)`);

