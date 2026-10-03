const fs = require('fs');

global.window = {};
global.console = console;

const physicsCode = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');
eval(physicsCode);

const launchConfig = {
    ballSpeedMph: 130,
    launchAngleDeg: 18,
    azimDeg: 0,
    totalSpinRpm: 2500,
    spinAxisDeg: 0,
    isLiveData: true
};

const result = window.GolfPhysics.simulateFlight(launchConfig, {});
console.log("Path length:", result.path.length);
console.log("Last point:", result.path[result.path.length - 1]);
console.log("Metrics:", result.metrics);

let foundCurve = false;
for(let p of result.path) {
    if (Math.abs(p.x) > 5) {
        foundCurve = true;
        break;
    }
}
console.log("Curved away from center? ", foundCurve);
