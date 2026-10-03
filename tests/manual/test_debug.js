const fs = require('fs');

global.window = {};
global.console = console;

const physicsCode = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');
eval(physicsCode);

const launchConfig = {
    vMag: 67, // 150 mph
    vLa: 12,
    vHla: 0,
    spinTotal: 2500,
    spinAxis: 0,
    isLiveData: true
};

let oldStep = window.GolfPhysics.stepRK4;
window.GolfPhysics.stepRK4 = function(state, dt) {
    if (isNaN(state.vel[0]) || isNaN(state.spin[0])) {
        // Find which iteration breaks
        console.log("NaN detected BEFORE step");
    }
    let prevVel = [...state.vel];
    let prevSpin = [...state.spin];
    oldStep(state, dt);
    if (isNaN(state.vel[0]) || isNaN(state.spin[0])) {
        console.log("NaN detected AFTER step");
        console.log("Prev Vel", prevVel);
        console.log("Prev Spin", prevSpin);
        console.log("Calculated speedMs:", Math.sqrt(prevVel[0]*prevVel[0] + prevVel[1]*prevVel[1] + prevVel[2]*prevVel[2]));
        process.exit(1);
    }
}

const result = window.GolfPhysics.simulateFlight(launchConfig, {});
