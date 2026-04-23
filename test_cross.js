const fs = require('fs');

const pcode = fs.readFileSync('physics.js', 'utf8');
const modifiedPcode = pcode.replace(
    'let fLift = vecScale(magnusDir, fLiftMag);',
    'let fLift = vecScale(magnusDir, fLiftMag); if (typeof state === "undefined") return; if (state.time === undefined) { state.time = 0; } state.time++; if (state.time === 200) console.log("MAGX:", magnusDir[0], "sZ:", state.spin[2], "sY:", state.spin[1], "vZ:", vRel[2], "vY:", vRel[1]);'
);

global.window = {};
eval(modifiedPcode);

const launchConfig = {
    ballSpeedMph: 130,
    launchAngleDeg: 14,
    azimDeg: 0,
    totalSpinRpm: Math.sqrt(2000*2000 + 800*800),
    spinAxisDeg: Math.atan2(800, 2000) * (180 / Math.PI),
    isLiveData: true
};

let res = window.GolfPhysics.simulateFlight(launchConfig, {});
let lp = res.path[res.path.length-1];
console.log("FINAL x: ", lp.x);
