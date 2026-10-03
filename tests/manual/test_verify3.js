const fs = require('fs');
global.window = {};
global.console = console;

const physicsCode = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');
eval(physicsCode);

const launchConfig = {
    ballSpeedMph: 130,
    launchAngleDeg: 14,
    azimDeg: 0,
    totalSpinRpm: Math.sqrt(2000*2000 + 800*800),
    spinAxisDeg: Math.atan2(-800, 2000) * (180 / Math.PI),
    isLiveData: true
};

// I will overwrite GolfPhysics.simulateFlight locally to inspect
let origEval = window.GolfPhysics.evaluateState; // Not exported, I can't hook it easily.

// I'll just print input config:
console.log("Config: ", launchConfig);

let result = window.GolfPhysics.simulateFlight(launchConfig, {});
console.log("Step 1 point (tick 200, 1s): ", result.path[200]);

