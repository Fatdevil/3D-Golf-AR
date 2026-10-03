const fs = require('fs');
global.window = {};

const pcode = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');
eval(pcode);

// Fake envCtx to mock rough lie calculation inside physics.js
// physics.js uses checkCollisionCallback and others. But rough penalty triggers via state.type in some versions,
// or via envCtx.lieSurface. Let's see what physics.js actually expects.
const pcodeText = fs.readFileSync(require('path').join(__dirname, '..', '..', 'physics.js'), 'utf8');

// The simulation function takes launchData and envCtx
let envCtx = { checkCollisionCallback: function(){return {type:ROUGH};}, 
    lieSurface: {type: 'ROUGH'} // Or whatever physics.js uses
};

// I will run 2 versions
let stateManual = window.GolfPhysics.simulateFlight({
    ballSpeedMph: 130, launchAngleDeg: 14, azimDeg: 0, totalSpinRpm: 2000, spinAxisDeg: 0, isLiveData: false
}, envCtx);

let stateLive = window.GolfPhysics.simulateFlight({
    ballSpeedMph: 130, launchAngleDeg: 14, azimDeg: 0, totalSpinRpm: 2000, spinAxisDeg: 0, isLiveData: true
}, envCtx);

let manY = stateManual.path[stateManual.path.length-1].y * 1.09361;
let liveY = stateLive.path[stateLive.path.length-1].y * 1.09361;

console.log("MANUAL Carry (Should have lie penalty if implemented in physics.js):", manY.toFixed(1));
console.log("LIVE Carry (Should skip lie penalty):", liveY.toFixed(1));

