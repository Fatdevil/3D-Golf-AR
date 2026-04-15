/**
 * GolfBallPhysicsEngine V1
 * En hög-presterande, SI-baserad aerodynamisk simulator
 * Använder numerisk Runge-Kutta 4 (RK4) integration i lokala 3D-kordinater.
 */

window.GolfPhysics = (function() {
    
    // Konstanter (SI Enheter: kg, m, s, rad)
    const RHO = 1.225; // Luftdensitet (Sea level, 15°C) kg/m^3
    const GRAVITY = -9.81; // m/s^2
    const MASS = 0.04593; // 45.93 gram (Golfboll standard)
    const RADIUS = 0.021335; // 42.67mm diameter
    const AREA = Math.PI * RADIUS * RADIUS;

    const GROUND = {
        restitution: 0.45,
        bounceFriction: 0.18,
        rollingDecel: 0.8,
        spinDampingPerBounce: 0.75,
        minBounceVerticalSpeed: 0.5,
        stopSpeed: 0.1
    };

    // Hjälpfunktioner för Vektorer
    function vecAdd(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
    function vecSub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    function vecScale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
    function vecCross(a, b) {
        return [
            a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0]
        ];
    }
    function vecMag(v) { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }
    function vecNorm(v) {
        let m = vecMag(v);
        return m === 0 ? [0,0,0] : [v[0]/m, v[1]/m, v[2]/m];
    }

    // Aerodynamiska koefficient-kurvor
    function getDragCoefficient(vMag, spinParam) {
        // En solid grund-approach
        const baseCd = 0.22; 
        const spinEffect = spinParam * 0.4;
        let cd = baseCd + spinEffect;
        if (vMag < 20) {
            // Ökat motstånd vid låga hastigheter innan turbulent lager byggs upp helt
            cd += 0.1 * ((20 - vMag) / 20); 
        }
        return cd;
    }

    function getLiftCoefficient(vMag, spinParam) {
        // Lift drivs primärt av spin parameter (Dimensionless)
        return 0.15 + (spinParam * 0.8);
    }

    function evaluateState(state, dt, dv) {
        let currentV = vecAdd(state.vel, vecScale(dv, dt));
        
        // Stäng av aerodynamik under rullfasen (drivs bara av markens rullmotstånd)
        if (state.phase === "roll") {
            let vXY = [currentV[0], currentV[1], 0];
            let speedXY = vecMag(vXY);
            if (speedXY < 0.05) {
                return { dp: currentV, dv: [0, 0, 0] };
            }
            let dirXY = [vXY[0]/speedXY, vXY[1]/speedXY, 0];
            let accel = vecScale(dirXY, -GROUND.rollingDecel);
            return { dp: currentV, dv: accel };
        }

        let vRel = vecSub(currentV, state.wind); // Relativ hastighet mot luften
        let vRelMag = vecMag(vRel);

        // Vid stillastående verkar bara gravitationen
        if (vRelMag < 0.1) {
            return { dp: currentV, dv: [0, 0, GRAVITY] };
        }

        let spinRate = vecMag(state.spin);
        let spinParam = (RADIUS * spinRate) / Math.max(vRelMag, 1.0); // Förhindra Magnus-singularitet vid låg fart under studsar
        let Cd = getDragCoefficient(vRelMag, spinParam);
        let Cl = getLiftCoefficient(vRelMag, spinParam);

        // Drag Force (F_D)
        let fDragMag = 0.5 * RHO * AREA * Cd * vRelMag * vRelMag;
        let vRelNorm = vecNorm(vRel);
        let fDrag = vecScale(vRelNorm, -fDragMag);

        // Magnus Force (Lift) (F_L)
        let magnusDir = vecNorm(vecCross(state.spin, vRel));
        let fLiftMag = 0.5 * RHO * AREA * Cl * vRelMag * vRelMag;
        let fLift = vecScale(magnusDir, fLiftMag);

        // Totalkraft
        let fGravity = [0, 0, MASS * GRAVITY];
        let fTotal = vecAdd(fDrag, vecAdd(fLift, fGravity));

        // Acceleration = F / m
        let accel = vecScale(fTotal, 1/MASS);

        return {
            dp: currentV,
            dv: accel
        };
    }

    function stepRK4(state, dt) {
        let a = evaluateState(state, 0, [0,0,0]);
        let b = evaluateState(state, dt*0.5, a.dv);
        let c = evaluateState(state, dt*0.5, b.dv);
        let d = evaluateState(state, dt, c.dv);

        let dp = vecScale(vecAdd(a.dp, vecAdd(vecScale(b.dp, 2), vecAdd(vecScale(c.dp, 2), d.dp))), 1.0/6.0);
        let dv = vecScale(vecAdd(a.dv, vecAdd(vecScale(b.dv, 2), vecAdd(vecScale(c.dv, 2), d.dv))), 1.0/6.0);

        state.pos = vecAdd(state.pos, vecScale(dp, dt));
        state.vel = vecAdd(state.vel, vecScale(dv, dt));
        
        // Luften dämpar spinnen över tid
        state.spin = vecScale(state.spin, 0.999); 
    }

    /**
     * Konverterar mänsklig input (Simulatordata) till matematisk 3D flight path
     * @param {Object} input - { ballSpeedMph, launchAngleDeg, totalSpinRpm, spinAxisDeg, azimDeg }
     */
    function simulateFlight(input) {
        // Initiera state variabler
        let speedMS = input.ballSpeedMph * 0.44704; // mph -> m/s
        let launchRads = input.launchAngleDeg * Math.PI / 180;
        let azimRads = (input.azimDeg || 0) * Math.PI / 180;
        
        // Start hastighetsvektor
        // Y: framåt, X: höger, Z: upp
        let vX = speedMS * Math.cos(launchRads) * Math.sin(azimRads);
        let vY = speedMS * Math.cos(launchRads) * Math.cos(azimRads);
        let vZ = speedMS * Math.sin(launchRads);
        let vel = [vX, vY, vZ];

        // Start spinnvektor
        let wRads = input.totalSpinRpm * 2 * Math.PI / 60; // rpm -> rad/s
        let spinAxisRads = input.spinAxisDeg * Math.PI / 180;
        
        // Om spinAxis = 0 -> rent backspin -> snurrar kring X-axeln.
        // Positiv spinAxis -> tiltar åt höger -> Z-komponent blir negativ -> resulterar i Fade/Slice.
        let sX = wRads * Math.cos(spinAxisRads);
        let sY = 0;
        let sZ = -wRads * Math.sin(spinAxisRads);
        let spin = [sX, sY, sZ];

        let state = {
            phase: "flight",
            pos: [0, 0, 0], // Start i origo (0,0,0)
            vel: vel,
            spin: spin,
            wind: [0, 0, 0] // Enkelt tills vidare (utan extern vind)
        };

        const dt = 0.005; // Intern tick-rate 5ms
        const sampleRate = 0.1; // Output sparar var 100ms
        
        let path = [];
        path.push({ x: 0, y: 0, z: 0, time: 0 });
        
        let metrics = {
            carryMeters: 0,
            totalMeters: 0,
            apexMeters: 0,
            flightTime: 0,
            totalTime: 0,
            bounceCount: 0
        };

        let t = 0;
        let lastSampleTime = 0;

        // Simulator-loop
        while (state.phase !== "stopped" && t < 25.0) { // Safety break efter max 25 sek in-miljö
            stepRK4(state, dt);
            t += dt;
            
            // Evaluera Apex
            if (state.pos[2] > metrics.apexMeters) metrics.apexMeters = state.pos[2];

            // Markkontakt och Fysik-övergång
            if (state.pos[2] <= 0 && state.phase !== "stopped") {
                state.pos[2] = 0; // Kläm mot marknivån Z=0
                
                if (state.phase === "flight" || state.phase === "bounce") {
                    if (state.phase === "flight") {
                        metrics.carryMeters = Math.sqrt(state.pos[0]*state.pos[0] + state.pos[1]*state.pos[1]);
                        metrics.flightTime = t;
                    }
                    
                    if (Math.abs(state.vel[2]) > GROUND.minBounceVerticalSpeed) {
                        state.phase = "bounce";
                        metrics.bounceCount++;
                        
                        state.vel[2] = Math.abs(state.vel[2]) * GROUND.restitution;
                        
                        // Fysiskt korrekt spin-bite på gräset.
                        const GRIP = 0.85; // Betydligt högre grepp (Receptiv Tour-Green!)

                        // Hastighet för bollens nedre kontaktpunkt relativt marken
                        // Backspin (sX > 0) gör att undersidan rör sig FRAMÅT (+Y) => Friction drar bakåt.
                        // Sidespin (sZ < 0) ger rotering runt Z-axeln, men spinAxis tiltar X/Z.
                        // Spin kring Y (-sZ pga orientering) ger rullning VÄNSTER (-X) => Friction drar höger.
                        let vContactY = state.vel[1] + (state.spin[0] * RADIUS);
                        let vContactX = state.vel[0] - (state.spin[1] * RADIUS);
                        
                        // Imperfekt slippning reducerar farten baserat på kontakthastigheten:
                        let deltaVY = -(vContactY) / 3.5 * GRIP;
                        let deltaVX = -(vContactX) / 3.5 * GRIP;

                        // Applicera impulsen på bollens färdhastighet (Det som ger Wedge-Check!)
                        state.vel[1] += deltaVY;
                        state.vel[0] += deltaVX;

                        // Motsvarande impuls suger ut spinnen ur bollen
                        state.spin[0] += (2.5 * deltaVY / RADIUS);
                        state.spin[1] -= (2.5 * deltaVX / RADIUS); 

                        // Klassisk bounceFriction för att dämpa ytterligare vid hårda stötar
                        state.vel[0] *= (1 - GROUND.bounceFriction);
                        state.vel[1] *= (1 - GROUND.bounceFriction);
                        
                        state.spin = vecScale(state.spin, GROUND.spinDampingPerBounce);
                    } else {
                        state.phase = "roll";
                        state.vel[2] = 0; // Införlivas nu i rull-algoritmen
                    }
                }

                if (state.phase === "roll") {
                    let speedXY = Math.sqrt(state.vel[0]*state.vel[0] + state.vel[1]*state.vel[1]);
                    if (speedXY < GROUND.stopSpeed) {
                        state.phase = "stopped";
                        state.vel = [0, 0, 0];
                    }
                }
            }

            if ((t - lastSampleTime >= sampleRate) || state.phase === "stopped") {
                path.push({ x: state.pos[0], y: state.pos[1], z: state.pos[2], time: t });
                lastSampleTime = t;
            }
        }
        
        metrics.totalMeters = Math.sqrt(state.pos[0]*state.pos[0] + state.pos[1]*state.pos[1]);
        metrics.totalTime = t;

        return { path: path, metrics: metrics };
    }

    return {
        simulateFlight: simulateFlight
    };
})();
