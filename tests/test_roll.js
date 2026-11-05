/**
 * Roll Distance Regression Test
 * Verifies carry + roll distances for driver, 7-iron, wedge
 */

global.window = { GREEN_STIMP: 10.0, matchSettings: { greenFirmness: 'NORMAL' } };
require('../physics.js');
const { simulateFlight } = window.GolfPhysics;

const flatEnv = {
    getTerrainAt: (x, y, z) => ({ z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }),
    checkCollisionCallback: (x, y, z) => null,
    wind: [0, 0, 0], altitudeFeet: 0, temperatureC: 25
};

function testShot(name, ballSpeed, launch, backspin, sidespin, targets) {
    const totalSpin = Math.sqrt(backspin * backspin + sidespin * sidespin);
    const spinAxis = Math.atan2(sidespin, backspin) * (180 / Math.PI);
    
    const result = simulateFlight({
        ballSpeedMph: ballSpeed, launchAngleDeg: launch,
        totalSpinRpm: totalSpin, spinAxisDeg: spinAxis,
        azimDeg: 0, startPos: [0, 0, 0], isLiveData: true, isTeeShot: true
    }, flatEnv);
    
    const carryM = result.metrics.carryMeters;
    const totalM = result.metrics.totalMeters;
    const rollM = totalM - carryM;
    const carryYds = carryM * 1.09361;
    const totalYds = totalM * 1.09361;
    const rollYds = rollM * 1.09361;
    const apex = result.metrics.apexMeters;
    const bounces = result.metrics.bounceCount;
    
    const carryOk = carryYds >= targets.carryMin && carryYds <= targets.carryMax;
    const rollOk = rollYds >= targets.rollMin && rollYds <= targets.rollMax;
    
    console.log(`\n${name}: ${ballSpeed} mph / ${launch}° / ${backspin} rpm`);
    console.log(`  Carry: ${carryYds.toFixed(1)} yds  [${targets.carryMin}–${targets.carryMax}] ${carryOk ? '✅' : '❌'}`);
    console.log(`  Roll:  ${rollYds.toFixed(1)} yds  [${targets.rollMin}–${targets.rollMax}] ${rollOk ? '✅' : '❌'}`);
    console.log(`  Total: ${totalYds.toFixed(1)} yds`);
    console.log(`  Apex:  ${apex.toFixed(1)} m  |  Bounces: ${bounces}`);
    
    return carryOk && rollOk;
}

console.log("=== ROLL DISTANCE REGRESSION TEST ===");
console.log("Flat FAIRWAY, no wind, sea level, 25°C\n");

const r1 = testShot("DRIVER", 130, 14, 2500, 0,
    { carryMin: 210, carryMax: 220, rollMin: 18, rollMax: 34 });   // (Penners studs: färre energiförluster i höga studsar, 31 yd)

const r2 = testShot("7-IRON", 119, 18, 5500, 0,
    { carryMin: 170, carryMax: 190, rollMin: 8, rollMax: 18 });

const r3 = testShot("WEDGE (PW)", 103, 26, 8000, 0,
    { carryMin: 125, carryMax: 140, rollMin: 4, rollMax: 10 });

const r4 = testShot("LOB WEDGE", 75, 34, 9000, 0,
    { carryMin: 70, carryMax: 85, rollMin: 1, rollMax: 6 });

console.log("\n═════════════════════════════════════");
console.log(`DRIVER:     ${r1 ? '✅' : '❌'}`);
console.log(`7-IRON:     ${r2 ? '✅' : '❌'}`);
console.log(`WEDGE:      ${r3 ? '✅' : '❌'}`);
console.log(`LOB WEDGE:  ${r4 ? '✅' : '❌'}`);
console.log(`OVERALL:    ${(r1 && r2 && r3 && r4) ? '✅ ALL PASS' : '❌ REGRESSION'}`);
console.log("═════════════════════════════════════");
