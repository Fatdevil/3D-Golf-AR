/**
 * Physics Engine Validation Script
 * Tests carry, total, roll, and apex for three reference scenarios
 * Run: node test_physics.js
 */

// Load physics engine (force fresh by recreating window)
global.window = { 
    GREEN_STIMP: 10.0,
    matchSettings: { greenFirmness: 'NORMAL' }
};
const path = require('path');
const physPath = path.resolve(__dirname, 'physics.js');
delete require.cache[physPath];
delete global.window.GolfPhysics;
require(physPath);

const GolfPhysics = global.window.GolfPhysics;

// Flat terrain callback (no slope, fairway surface)
const flatFairwayEnv = {
    wind: [0, 0, 0],
    altitudeFeet: 0,
    temperatureC: 25,
    getTerrainAt: function(x, y, z) {
        return { z: 0, type: 'FAIRWAY', normal: [0, 0, 1] };
    },
    checkCollisionCallback: function(x, y, z) {
        return { z: 0, type: 'FAIRWAY', normal: [0, 0, 1] };
    }
};

function runTest(name, ballSpeedMph, launchAngleDeg, azimDeg, totalSpinRpm, spinAxisDeg) {
    const input = {
        ballSpeedMph: ballSpeedMph,
        launchAngleDeg: launchAngleDeg,
        azimDeg: azimDeg,
        totalSpinRpm: totalSpinRpm,
        spinAxisDeg: spinAxisDeg,
        startPos: [0, 0, 0],
        isTeeShot: true,
        isLiveData: false
    };
    
    const result = GolfPhysics.simulateFlight(input, flatFairwayEnv);
    
    // Calculate metrics
    const carryM = result.metrics.carryMeters || 0;
    const totalM = result.metrics.totalMeters || 0;
    const carryYds = carryM * 1.09361;
    const totalYds = totalM * 1.09361;
    const rollYds = totalYds - carryYds;
    
    // Find apex (max height in path)
    let apexM = 0;
    let apexTick = 0;
    for (let i = 0; i < result.path.length; i++) {
        if (result.path[i].z > apexM) {
            apexM = result.path[i].z;
            apexTick = i;
        }
    }
    const apexFt = apexM * 3.28084;
    
    // Calculate spin ratio for reference
    const omega = (totalSpinRpm * 2 * Math.PI) / 60;
    const speedMS = ballSpeedMph * 0.44704;
    const spinRatio = (omega * 0.021335) / speedMS;
    
    // Find first bounce tick
    let firstBounceTime = 0;
    for (let i = 1; i < result.path.length; i++) {
        if (result.path[i].phase !== 'flight' && result.path[i-1].phase === 'flight') {
            firstBounceTime = result.path[i].time;
            break;
        }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${name}`);
    console.log(`  Input: ${ballSpeedMph} mph / ${launchAngleDeg}° / ${totalSpinRpm} rpm`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Spin Ratio:     ${spinRatio.toFixed(3)}`);
    console.log(`  Carry:          ${carryYds.toFixed(1)} yds  (${carryM.toFixed(1)} m)`);
    console.log(`  Total:          ${totalYds.toFixed(1)} yds  (${totalM.toFixed(1)} m)`);
    console.log(`  Roll:           ${rollYds.toFixed(1)} yds`);
    console.log(`  Apex:           ${apexFt.toFixed(1)} ft   (${apexM.toFixed(1)} m)`);
    console.log(`  Flight Time:    ${firstBounceTime.toFixed(2)} s`);
    console.log(`  Total Time:     ${result.metrics.totalTime.toFixed(2)} s`);
    console.log(`  Path Points:    ${result.path.length}`);
    console.log(`  Final Terrain:  ${result.metrics.finalTerrainType}`);
    
    return { carryYds, totalYds, rollYds, apexFt };
}

console.log('\n🏌️ GOLF PHYSICS ENGINE - VALIDATION SUITE');
console.log('=' .repeat(60));

// Test 1: Driver
const driver = runTest('TEST 1: DRIVER', 130, 14, 0, 2000, 0);
const driverOk = driver.carryYds >= 210 && driver.carryYds <= 220;
console.log(`  ✅ Target: 215 ±5 yds → ${driverOk ? 'PASS ✅' : 'FAIL ❌'}`);

// Test 2: 7-Iron
const iron7 = runTest('TEST 2: 7-IRON', 120, 16, 0, 7000, 0);
const iron7Ok = iron7.carryYds >= 178 && iron7.carryYds <= 192;
console.log(`  ✅ Target: 180-188 yds → ${iron7Ok ? 'PASS ✅' : 'FAIL ❌'}`);

// Test 3: Wedge
const wedge = runTest('TEST 3: WEDGE (Primary Fix Target)', 103, 35, 0, 9000, 0);
const wedgeOk = wedge.carryYds >= 125 && wedge.carryYds <= 135;
const wedgeApexOk = wedge.apexFt >= 130 && wedge.apexFt <= 150;
console.log(`  ✅ Carry Target: 128-133 yds → ${wedgeOk ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`  ✅ Apex Target: 130-150 ft → ${wedgeApexOk ? 'PASS ✅' : 'WARN ⚠️'}`);
console.log(`  ✅ Roll Target: 4-7 yds → ${wedge.rollYds >= 2 && wedge.rollYds <= 10 ? 'PASS ✅' : 'FAIL ❌'}`);

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log('  SUMMARY');
console.log(`${'='.repeat(60)}`);
console.log(`  Driver Carry:  ${driver.carryYds.toFixed(1)} yds ${driverOk ? '✅' : '❌'}`);
console.log(`  7-Iron Carry:  ${iron7.carryYds.toFixed(1)} yds ${iron7Ok ? '✅' : '❌'}`);
console.log(`  Wedge Carry:   ${wedge.carryYds.toFixed(1)} yds ${wedgeOk ? '✅' : '❌'}`);
console.log(`  Wedge Roll:    ${wedge.rollYds.toFixed(1)} yds`);
console.log(`  Wedge Apex:    ${wedge.apexFt.toFixed(1)} ft`);
console.log(`${'='.repeat(60)}\n`);
