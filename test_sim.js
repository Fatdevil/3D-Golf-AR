const fs = require('fs');

// Fake env för att ladda physics.js
global.window = {};
global.console = console;

// Läs in physics.js och evalutera den
const physicsCode = fs.readFileSync('physics.js', 'utf8');
eval(physicsCode);

const launchConfig = {
    vMag: 67, // 150 mph
    vLa: 12,
    vHla: 0,
    spinTotal: 2500,
    spinAxis: 0,
    isLiveData: true
};

const result = window.GolfPhysics.simulateFlight(launchConfig, {});
console.log("Path length:", result.path.length);
console.log("First point:", result.path[0]);
console.log("Last point:", result.path[result.path.length - 1]);
