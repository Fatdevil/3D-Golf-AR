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
        restitution: 0.20,
        bounceFriction: 0.30,
        rollingDecel: 0.8,
        spinDampingPerBounce: 0.75,
        minBounceVerticalSpeed: 1.0,
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
        
        // Stäng av aerodynamik under rullfasen (drivs bara av markens rullmotstånd & lutning)
        if (state.phase === "roll") {
            let N = state.terrainNormal || [0,0,1];
            let G = [0, 0, GRAVITY];
            let gDotN = G[0]*N[0] + G[1]*N[1] + G[2]*N[2];
            // Acceleration down the slope due to gravity component
            let gParallel = [
                G[0] - gDotN * N[0],
                G[1] - gDotN * N[1],
                G[2] - gDotN * N[2]
            ];
            
            let vSpeed = vecMag(currentV);
            let currentDecel = state.rollingDecel !== undefined ? state.rollingDecel : GROUND.rollingDecel;
            
            // Friktion verkar mot rörelseriktningen
            let dir = vSpeed > 0.001 ? vecScale(currentV, 1/vSpeed) : [0,0,0];
            let frictionAccel = vecScale(dir, -currentDecel);
            
            let totalAccel = vecAdd(gParallel, frictionAccel);
            
            if (vSpeed < 0.05 && vecMag(gParallel) < currentDecel) {
                // Helt stilla på en svag lutning
                return { dp: currentV, dv: vecScale(currentV, -1 / dt) }; // Tvingar hastighet till 0
            }
            
            return { dp: currentV, dv: totalAccel };
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
     * @param {Object} envCtx - { checkCollisionCallback }
     */
    function simulateFlight(input, envCtx) {
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

        let startPosXZY = input.startPos || [0, 0, 0];
        let state = {
            phase: "flight",
            pos: [startPosXZY[0], startPosXZY[1], startPosXZY[2]], // Start i definierad pos (X, Fysik-Y, Höjd)
            vel: vel,
            spin: spin,
            wind: [0, 0, 0] // Enkelt tills vidare (utan extern vind)
        };

        const dt = 0.005; // Intern tick-rate 5ms
        const sampleRate = 0.1; // Output sparar var 100ms
        
        let path = [];
        path.push({ 
            x: 0, y: 0, z: 0, 
            vx: vel[0], vy: vel[1], vz: vel[2],
            time: 0 
        });
        
        let metrics = {
            carryMeters: 0,
            totalMeters: 0,
            apexMeters: 0,
            flightTime: 0,
            totalTime: 0,
            bounceCount: 0,
            finalTerrainType: 'FAIRWAY' // Default
        };

        let t = 0;
        let lastSampleTime = 0;

        // Simulator-loop
        while (state.phase !== "stopped" && t < 25.0) { // Safety break efter max 25 sek in-miljö
            
            // Kolla luft-kollisioner (Träd) innan vi flyttar oss
            if (envCtx && envCtx.checkCollisionCallback && state.phase === "flight") {
                let terrain = envCtx.checkCollisionCallback(state.pos[0], state.pos[1], state.pos[2]);
                if (terrain && terrain.type === 'TREE') {
                    let treeHeight = terrain.height || 15.0;
                    
                    if (state.pos[2] < treeHeight && state.pos[2] > 0.1) {
                        // Distans som bollen just färdats (grovt) under denna tick (dt)
                        let speed = vecMag(state.vel);
                        let distTraveled = speed * dt;
                        
                        // Vi skiljer på "stammar" och "Krona/Lövverk"
                        const TRUNK_GAP_HEIGHT = 2.5;
                        let hitProbabilityPerMeter = 0;
                        
                        if (state.pos[2] < TRUNK_GAP_HEIGHT) {
                            // Punch-out läge! Bara 5% risk per meter att träffa en solid stam.
                            hitProbabilityPerMeter = 0.05;
                        } else {
                            // Upp i lövverket! Mycket högre risk (t.ex. 40% risk att fastna per meter).
                            hitProbabilityPerMeter = 0.40;
                        }
                        
                        let currentTickRisk = distTraveled * hitProbabilityPerMeter;
                        
                        if (Math.random() < currentTickRisk) {
                            // KROCK I TRÄDEN!
                            console.log(`🏌️‍♂️🌲 KROCK! Bollen fastnade i skogen på höjd: ${state.pos[2].toFixed(1)}m`);
                            state.vel[0] *= 0.1; // Döda fart framåt x
                            state.vel[1] *= 0.1; // Döda fart framåt y
                            // Fall neråt genom lövverket
                            if (state.pos[2] > TRUNK_GAP_HEIGHT) {
                                state.vel[2] = -2.0; 
                            } else {
                                state.vel[2] = -1.0; // Mjukare bounce mot stam
                            }
                            state.spin = [0,0,0]; // Spin äts upp av träd/grenar
                        }
                    }
                }
            }
            
            // Lägg in en hook för att hämta terränginformation varje tick!
            let tInfo = { z: 0, normal: [0,0,1], type: 'FAIRWAY' };
            if (envCtx && envCtx.getTerrainAt) {
                tInfo = envCtx.getTerrainAt(state.pos[0], state.pos[1]);
            }
            state.terrainNormal = tInfo.normal;
            
            let prevPos = [...state.pos];
            let prevVel = [...state.vel];
            
            stepRK4(state, dt);
            
            if (state.phase === "roll") {
                // Tvinga bollen att "hug the ground" och uppdatera hastighetsvektor så den är parallell!
                let freshT = envCtx && envCtx.getTerrainAt ? envCtx.getTerrainAt(state.pos[0], state.pos[1]) : tInfo;
                state.pos[2] = freshT.z;
                
                let vDotN = state.vel[0]*freshT.normal[0] + state.vel[1]*freshT.normal[1] + state.vel[2]*freshT.normal[2];
                state.vel[0] -= vDotN * freshT.normal[0];
                state.vel[1] -= vDotN * freshT.normal[1];
                state.vel[2] -= vDotN * freshT.normal[2];
            }
            
            t += dt;
            
            // Evaluera Apex
            if (state.pos[2] > metrics.apexMeters) metrics.apexMeters = state.pos[2];

            // Markkontakt och Fysik-övergång via 3D Slopes
            if (state.pos[2] <= tInfo.z && state.phase !== "stopped") {
                
                // 1. Beräkna den exakta tidpunkten då bollen dök igenom z-kartan
                let travelZ = prevPos[2] - state.pos[2];
                let f = travelZ > 0.0001 ? (prevPos[2] - tInfo.z) / travelZ : 0; 
                
                // 2. Interpolera en exakt nerslagspunkt
                let impactPos = [
                    prevPos[0] + (state.pos[0] - prevPos[0]) * f,
                    prevPos[1] + (state.pos[1] - prevPos[1]) * f,
                    tInfo.z
                ];
                let impactVel = [
                    prevVel[0] + (state.vel[0] - prevVel[0]) * f,
                    prevVel[1] + (state.vel[1] - prevVel[1]) * f,
                    prevVel[2] + (state.vel[2] - prevVel[2]) * f
                ];
                
                let rawUncorrectedZ = state.pos[2];

                state.pos = [...impactPos];
                state.vel = [...impactVel];
                
                // Bestäm markens fysikegenskaper
                let impactTerrainType = 'FAIRWAY';
                if (envCtx && envCtx.checkCollisionCallback) {
                    let impactRes = envCtx.checkCollisionCallback(impactPos[0], impactPos[1], 0);
                    if (impactRes && impactRes.type) impactTerrainType = impactRes.type;
                }
                
                let cRestitution = GROUND.restitution;
                let cFriction = GROUND.bounceFriction;
                let cRollingDecel = GROUND.rollingDecel;
                
                if (impactTerrainType === 'GREEN') {
                    cRestitution = 0.15; cFriction = 0.50; cRollingDecel = 0.5;
                } else if (impactTerrainType === 'TEE') {
                    cRestitution = 0.30; cFriction = 0.40; cRollingDecel = 0.8;
                } else if (impactTerrainType === 'ROUGH') {
                    cRestitution = 0.10; cFriction = 0.70; cRollingDecel = 1.8;
                } else if (impactTerrainType === 'SAND') {
                    cRestitution = 0.05; cFriction = 0.90; cRollingDecel = 3.0; // Splatt
                } else if (impactTerrainType === 'WASTE') {
                    cRestitution = 0.12; cFriction = 0.75; cRollingDecel = 2.5; // Hård grussand
                } else if (impactTerrainType === 'WATER') {
                    state.phase = "stopped";
                    metrics.finalTerrainType = 'WATER';
                    continue; // Plask!
                } else if (impactTerrainType === 'OB') {
                    state.phase = "stopped";
                    metrics.finalTerrainType = 'OB';
                    continue; // Död (Utanför banan)!
                }
                
                state.rollingDecel = cRollingDecel;
                metrics.finalTerrainType = impactTerrainType;
                
                if (state.phase === "flight" || state.phase === "bounce") {
                    if (state.phase === "flight") {
                        metrics.carryMeters = Math.sqrt(state.pos[0]*state.pos[0] + state.pos[1]*state.pos[1]);
                        metrics.flightTime = t - dt + f * dt;
                        
                        console.log(`⛳ IMPACT DATA (${impactTerrainType}) ⛳`);
                        console.log("Impact Vel Z: " + state.vel[2].toFixed(2) + " m/s");
                        console.log("Spinn vid impact: " + ((vecMag(state.spin)*60)/(2*Math.PI)).toFixed(0) + " RPM");
                    }
                    
                    // 3D Vektor Reflektion mot lutningen (tInfo.normal)
                    let N = tInfo.normal;
                    let V = [...impactVel];
                    let vDotN = V[0]*N[0] + V[1]*N[1] + V[2]*N[2];
                    
                    let vPerp = vecScale(N, vDotN);  // Vektor rakt in i marken
                    let vTan = vecSub(V, vPerp);     // Hastighet längs ytan
                    
                    // Bounce Physics
                    let bounceVel = vecAdd(
                        vecScale(vPerp, -cRestitution),  // Normal forces push out
                        vecScale(vTan, 1.0 - cFriction)  // Friction kills tangential speed
                    );

                    // Fysiskt korrekt spin-bite på lutningar
                    const GRIP = 0.85; 
                    let vContactY = V[1] + (state.spin[0] * RADIUS);
                    let vContactX = V[0] - (state.spin[1] * RADIUS);
                    
                    let deltaVY = -(vContactY) / 3.5 * GRIP;
                    let deltaVX = -(vContactX) / 3.5 * GRIP;

                    bounceVel[1] += deltaVY;
                    bounceVel[0] += deltaVX;

                    state.spin[0] += (2.5 * deltaVY / RADIUS);
                    state.spin[1] -= (2.5 * deltaVX / RADIUS); 

                    state.vel = bounceVel;
                    state.spin = vecScale(state.spin, GROUND.spinDampingPerBounce);
                    
                    // Är studsen för mjuk uppåt längs ytan? => Rullfas (kolla perpendicular fart)
                    if (vecMag(vecScale(vPerp, -cRestitution)) < GROUND.minBounceVerticalSpeed || impactTerrainType === 'SAND') {
                        state.phase = "roll";
                        // Rull fas, vi tvingar hastigheten att vara helt parallell
                        let newVDotN = state.vel[0]*N[0] + state.vel[1]*N[1] + state.vel[2]*N[2];
                        state.vel = [
                            state.vel[0] - newVDotN * N[0],
                            state.vel[1] - newVDotN * N[1],
                            state.vel[2] - newVDotN * N[2]
                        ];
                    } else {
                        state.phase = "bounce";
                        metrics.bounceCount++;
                    }
                }

                if (state.phase === "roll") {
                    let speedXY = Math.sqrt(state.vel[0]*state.vel[0] + state.vel[1]*state.vel[1]);
                    if (speedXY < GROUND.stopSpeed) {
                        // Kontrollera om backen är så brant att den *drar iväg* bollen istället för att stanna (evalueras bäst i evaluateState)
                        state.phase = "stopped";
                        state.vel = [0, 0, 0];
                    }
                }
            }

            if ((t - lastSampleTime >= sampleRate) || state.phase === "stopped") {
                path.push({ 
                    x: state.pos[0], y: state.pos[1], z: state.pos[2], 
                    vx: state.vel[0], vy: state.vel[1], vz: state.vel[2],
                    time: t 
                });
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
