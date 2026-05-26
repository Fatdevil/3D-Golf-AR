const fs = require('fs');
global.window = {};
global.console = console;

const physicsCode = fs.readFileSync('physics.js', 'utf8');
eval(physicsCode);

const launchConfig = {
    ballSpeedMph: 130,
    launchAngleDeg: 14,
    azimDeg: 0,
    totalSpinRpm: Math.sqrt(2000*2000 + 800*800),
    spinAxisDeg: Math.atan2(-800, 2000) * (180 / Math.PI),
    isLiveData: true
};

console.log("SpinAxis Deg:", launchConfig.spinAxisDeg);

const result = window.GolfPhysics.simulateFlight(launchConfig, {});
for (let i = 0; i < result.path.length; i += 200) { // every 1 sec
    let p = result.path[i];
    console.log(`t: ${p.time.toFixed(1)}, x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}, vx: ${p.vx.toFixed(2)}`);
}
