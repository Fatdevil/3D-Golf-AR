/**
 * GolfBallPhysicsEngine V1
 * En hög-presterande, SI-baserad aerodynamisk simulator
 * Använder numerisk Runge-Kutta 4 (RK4) integration i lokala 3D-kordinater.
 */

window.GolfPhysics = (function() {
    
    // Konstanter (SI Enheter: kg, m, s, rad)
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

    // Hjälpfunktioner för miljö och vektorer
    function calculateAirDensity(altFeet, tempC) {
        // Trackman gillar Referens: 0 fot, 25°C -> RHO ≈ 1.184
        let hMeters = altFeet * 0.3048;
        let tempK = tempC + 273.15;
        let p = 101325 * Math.pow(1 - 2.25577e-5 * hMeters, 5.25588);
        return p / (287.05 * tempK);
    }
    
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

    // Helper för linjär interpolering
    function lerp(a, b, t) {
        return a + (b - a) * Math.max(0, Math.min(1, t));
    }

    // Aerodynamiska koefficient-kurvor (Trackman Data)
    function getDragCoefficient(vMag, spinRateRpm) {
        let vMph = vMag * 2.23694;
        let cd = 0.22;
        
        // Drag Crisis Re-kurva (Värden från referenstabell)
        if (vMph <= 45) {
            cd = lerp(0.50, 0.45, vMph / 45.0); // Laminärt, högt motstånd
        } else if (vMph <= 78) {
            cd = lerp(0.45, 0.25, (vMph - 45.0) / 33.0); // Drag Crisis! Massivt drop
        } else if (vMph <= 112) {
            cd = lerp(0.25, 0.22, (vMph - 78.0) / 34.0); // Går in i turbulent
        } else if (vMph <= 145) {
            cd = lerp(0.22, 0.215, (vMph - 112.0) / 33.0); // Optimalt slip
        } else {
            cd = lerp(0.215, 0.23, (vMph - 145.0) / 55.0); // Ökar svagt vid extrema farter
        }
        
        // Spin straff (Trackman: +0.03 vid ~3000 RPM)
        let spinPenalty = (spinRateRpm / 3000.0) * 0.035;
        
        return cd + spinPenalty;
    }

    function getLiftCoefficient(vMag, spinParam, spinRateRpm) {
        // Världsnyhet: Reverse Magnus Effect
        // Inträffar vid v < 20 m/s och backspin < 2250 rpm
        if (vMag < 20.0 && spinRateRpm > 0 && spinRateRpm <= 2250) {
            // Skapar upp till -0.10 negativt lyft
            let intensity = lerp(1.0, 0.0, spinRateRpm / 2250.0);
            return -0.10 * intensity;
        }
        
        // Trackmans Spin Factor kurva (S = r*w/v)
        if (spinParam <= 0.08) return lerp(0.00, 0.10, spinParam / 0.08);
        if (spinParam <= 0.13) return lerp(0.10, 0.14, (spinParam - 0.08) / 0.05);
        if (spinParam <= 0.20) return lerp(0.14, 0.20, (spinParam - 0.13) / 0.07);
        if (spinParam <= 0.32) return lerp(0.20, 0.23, (spinParam - 0.20) / 0.12);
        if (spinParam <= 0.45) return lerp(0.23, 0.25, (spinParam - 0.32) / 0.13);
        
        // Maxar ut runt 0.26 vid extremt spin (Full Wedge)
        return 0.26;
    }

    function evaluateState(state, dt, dv) {
        let currentV = vecAdd(state.vel, vecScale(dv, dt));
        
        // Stäng av aerodynamik under glid/rullfasen (drivs bara av markens rullmotstånd & lutning)
        if (state.phase === "roll" || state.phase === "skid") {
            let N = state.terrainNormal || [0,0,1];
            let G = [0, 0, GRAVITY];
            let gDotN = G[0]*N[0] + G[1]*N[1] + G[2]*N[2]; // Negativt värde typiskt (-9.81)
            
            // Acceleration down the slope due to gravity component
            let gParallel = [
                G[0] - gDotN * N[0],
                G[1] - gDotN * N[1],
                G[2] - gDotN * N[2]
            ];
            
            let vSpeed = vecMag(currentV);
            let normalForceMag = Math.abs(gDotN); // m/s^2 trycket mot marken
            
            // Rullfriktion härleds antingen från statisk kod (Fairway/Rough) eller dynamisk Stimp (Green)
            let mu = 0.5; // Standard/Fallback
            if (state.terrainType === 'GREEN' && typeof window !== 'undefined' && window.GREEN_STIMP) {
                // Werner & Greig empirisk ekvation (Validerad mot Trackman data)
                // Stimp 10 ≈ μ_roll 0.065
                let stimp = window.GREEN_STIMP;
                if (stimp < 6) stimp = 6; if (stimp > 14) stimp = 14;
                mu = 0.065 * (10.0 / stimp); 
            } else {
                // Omvandla den inkodade rullbromsen (rollingDecel) tillbaka till ett mu-värde för kompatibilitet.
                let currentDecel = state.rollingDecel !== undefined ? state.rollingDecel : GROUND.rollingDecel;
                mu = currentDecel / 9.81;
            }

            // Kinetisk glidfas ("Skid") har ungefär 50-80% högre friktion än rullfriktion
            if (state.phase === "skid") {
                mu *= 1.7; 
            }
            
            let frictionAccelMag = mu * normalForceMag;
            
            // Friktion verkar rakt mot rörelseriktningen parallellt med marken
            let dir = vSpeed > 0.001 ? vecScale(currentV, 1/vSpeed) : [0,0,0];
            let frictionAccel = vecScale(dir, -frictionAccelMag);
            
            let totalAccel = vecAdd(gParallel, frictionAccel);
            
            if (vSpeed < 0.05 && vecMag(gParallel) < frictionAccelMag) {
                // Farten är nära noll och gravitationssluttningen är för svag för att övervinna friktionen => STILLA
                return { dp: currentV, dv: vecScale(currentV, -1 / dt) }; // Tvingar hastighet till exakt 0
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
        let spinRateRpm = (spinRate * 60) / (2 * Math.PI); // rad/s till rpm

        let Cd = getDragCoefficient(vRelMag, spinRateRpm);
        let Cl = getLiftCoefficient(vRelMag, spinParam, spinRateRpm);

        let activeRho = state.rho || 1.184;

        // Drag Force (F_D)
        let fDragMag = 0.5 * activeRho * AREA * Cd * vRelMag * vRelMag;
        let vRelNorm = vecNorm(vRel);
        let fDrag = vecScale(vRelNorm, -fDragMag);

        // Magnus Force (Lift) (F_L)
        let magnusDir = vecNorm(vecCross(state.spin, vRel));
        let fLiftMag = 0.5 * activeRho * AREA * Cl * vRelMag * vRelMag;
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
        
        // Luften dämpar spinnen över tid i exponentiell kurva 
        // Trackman-fakta: k ≈ 0.04 s^-1
        state.spin = vecScale(state.spin, Math.exp(-0.04 * dt)); 
    }

    /**
     * Konverterar mänsklig input (Simulatordata) till matematisk 3D flight path
     * @param {Object} input - { ballSpeedMph, launchAngleDeg, totalSpinRpm, spinAxisDeg, azimDeg }
     * @param {Object} envCtx - { checkCollisionCallback }
     */
    function simulateFlight(input, envCtx) {
        let startPosXZY = input.startPos || [0, 0, 0];
        let baseSpeedMph = input.ballSpeedMph;
        let baseSpinRpm = input.totalSpinRpm || 2500;
        let vla = input.launchAngleDeg;
        
        let lieType = 'FAIRWAY';
        if (envCtx) {
            if (envCtx.getTerrainAt) {
                let li = envCtx.getTerrainAt(startPosXZY[0], startPosXZY[1]);
                if (li && li.type) lieType = li.type;
            } else if (envCtx.checkCollisionCallback) {
                let li = envCtx.checkCollisionCallback(0, 0, 0); // Check precisely at origin
                if (li && li.type) lieType = li.type;
            }
        }
        
        let speedMult = 1.0;
        let spinMult = 1.0;
        
        if (lieType === 'ROUGH') {
            let vlaFactor = Math.max(0, Math.min(1, (vla - 10) / 35)); 
            if (Math.random() < 0.15 && vla > 15) {
                speedMult = 1.05; spinMult = 0.35;
                console.log("💥 TRACKMAN FLYER-LIE DETECTED! Zero spin, hot velocity.");
            } else {
                speedMult = 1.0 - (0.50 - (0.45 * vlaFactor)); 
                spinMult = 1.0 - (0.65 - (0.50 * vlaFactor));
            }
        } else if (lieType === 'SEMI-ROUGH') {
            speedMult = 0.95; spinMult = 0.93; 
        } else if (lieType === 'DEEP ROUGH') {
            let vlaFactor = Math.max(0, Math.min(1, (vla - 10) / 35)); 
            if (Math.random() < 0.25 && vla > 20) {
                speedMult = 1.05; spinMult = 0.20;
                console.log("💥 TRACKMAN FLYER-LIE DETECTED (DEEP ROUGH)! Zero spin, hot velocity.");
            } else {
                speedMult = 1.0 - (0.80 - (0.45 * vlaFactor));
                spinMult = 1.0 - (0.85 - (0.50 * vlaFactor));
            }
        } else if (lieType === 'SAND') {
            let vlaFactor = Math.max(0, Math.min(1, (vla - 20) / 30)); 
            speedMult = 1.0 - (0.40 - (0.25 * vlaFactor));
            spinMult = 1.0 - (0.45 - (0.25 * vlaFactor));
        }
        
        let speedMS = (baseSpeedMph * speedMult) * 0.44704; // mph -> m/s
        let spinFinal = baseSpinRpm * spinMult;
        
        let launchRads = input.launchAngleDeg * Math.PI / 180;
        let azimRads = (input.azimDeg || 0) * Math.PI / 180;
        
        // Start hastighetsvektor
        // Y: framåt, X: höger, Z: upp
        let vX = speedMS * Math.cos(launchRads) * Math.sin(azimRads);
        let vY = speedMS * Math.cos(launchRads) * Math.cos(azimRads);
        let vZ = speedMS * Math.sin(launchRads);
        let vel = [vX, vY, vZ];

        // Start spinnvektor
        let wRads = spinFinal * 2 * Math.PI / 60; // rpm -> rad/s
        let spinAxisRads = input.spinAxisDeg * Math.PI / 180;
        
        // Om spinAxis = 0 -> rent backspin -> snurrar kring X-axeln.
        // Positiv spinAxis -> tiltar åt höger -> Z-komponent blir negativ -> resulterar i Fade/Slice.
        let sX = wRads * Math.cos(spinAxisRads);
        let sY = 0;
        let sZ = -wRads * Math.sin(spinAxisRads);
        let spin = [sX, sY, sZ];


        let startPosXZY = input.startPos || [0, 0, 0];
        
        let altFt = (envCtx && envCtx.altitudeFeet !== undefined) ? envCtx.altitudeFeet : 0;
        let tCelsius = (envCtx && envCtx.temperatureC !== undefined) ? envCtx.temperatureC : 25;
        let windVec = (envCtx && envCtx.wind) ? envCtx.wind : [0, 0, 0];
        
        let state = {
            phase: "flight",
            pos: [startPosXZY[0], startPosXZY[1], startPosXZY[2]], 
            vel: vel,
            spin: spin,
            wind: windVec,
            rho: calculateAirDensity(altFt, tCelsius)
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
                if (terrain) {
                    if (terrain.type === 'ROCK' || terrain.type === 'CACTUS') {
                        // Solid krock!
                        console.log(`🏌️‍♂️🪨 KROCK! Bollen träffade ett solitt objekt (${terrain.type})`);
                        // Minska framåtfart, studsa marginellt bakåt
                        state.vel[0] *= -0.2; 
                        state.vel[1] *= -0.2; 
                        state.vel[2] = -2.0; // Fall ner till gräset
                        state.spin = [0,0,0];
                    } else if (terrain.type === 'BUSH') {
                        // Segt buskage, käkar fart
                        let speedXZ = Math.sqrt(state.vel[0]*state.vel[0] + state.vel[1]*state.vel[1]);
                        if (speedXZ > 2.0 && Math.random() < 0.6) {
                            console.log(`🏌️‍♂️🌿 Bollen rasslade rakt in i en tjock buske!`);
                            state.vel[0] *= 0.4;
                            state.vel[1] *= 0.4;
                            state.vel[2] *= 0.5;
                        }
                    } else if (terrain.type === 'TREE') {
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
                
                if (metrics.bounceCount === 0 && state.phase === 'flight') {
                    metrics.carryMeters = Math.sqrt(state.pos[0]*state.pos[0] + state.pos[1]*state.pos[1]);
                }
                
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
                    // GSPro / Trackman Greens: e ~ 0.5 for realistic bounces, låg rullfriktion (via Stimp i evaluateState)
                    cRestitution = 0.50; cFriction = 0.35; cRollingDecel = 0.5;
                } else if (impactTerrainType === 'TEE' || impactTerrainType === 'FAIRWAY') {
                    cRestitution = 0.55; cFriction = 0.55; cRollingDecel = 0.78; // roll_mu 0.08
                } else if (impactTerrainType === 'SEMI-ROUGH') {
                    cRestitution = 0.50; cFriction = 0.60; cRollingDecel = 0.98; // roll_mu 0.10
                } else if (impactTerrainType === 'ROUGH') {
                    cRestitution = 0.45; cFriction = 0.70; cRollingDecel = 1.47; // roll_mu 0.15
                } else if (impactTerrainType === 'DEEP ROUGH') {
                    cRestitution = 0.40; cFriction = 0.80; cRollingDecel = 2.45; // roll_mu 0.25
                } else if (impactTerrainType === 'SAND') {
                    cRestitution = 0.45; cFriction = 0.75; cRollingDecel = 3.92; // roll_mu 0.40
                } else if (impactTerrainType === 'WASTE') {
                    cRestitution = 0.65; cFriction = 0.50; cRollingDecel = 0.49; // roll_mu 0.05 (Hård yta)
                } else if (impactTerrainType === 'WATER') {
                    // WATER SKIMMING TRACKMAN MACKA!
                    let vZ = state.vel[2];
                    let vXY = Math.sqrt(state.vel[0]*state.vel[0] + state.vel[1]*state.vel[1]);
                    // Bollen måste sjunka för att landAngle ska räknas
                    let landAngleRad = vZ < 0 ? Math.atan2(Math.abs(vZ), vXY) : 1.0; 
                    let landAngleDeg = landAngleRad * 180 / Math.PI;
                    let vMagImpact = Math.sqrt(vXY*vXY + vZ*vZ);
                    
                    // Om inkommande vinkel är extremt låg (<15°) och farten är hög (>18 m/s), skimmar vi på vattnet
                    if (landAngleDeg < 15.0 && vMagImpact > 18.0 && state.phase === "flight") {
                        console.log(`💦 VATTENSKIMMING! Vinkel in: ${landAngleDeg.toFixed(1)}°. Fart: ${vMagImpact.toFixed(1)} m/s`);
                        // Deflektera hårt (massive energiförlust)
                        cRestitution = 0.15; 
                        cFriction = 0.90; // Vattnet greppar bollen och dödar all spinn omedelbart
                        cRollingDecel = 30.0;
                    } else {
                        state.phase = "stopped";
                        metrics.finalTerrainType = 'WATER';
                        continue; // Plask!
                    }
                } else if (impactTerrainType === 'OB') {
                    state.phase = "stopped";
                    metrics.finalTerrainType = 'OB';
                    continue; // Död (Utanför banan)!
                }
                
                state.rollingDecel = cRollingDecel;
                metrics.finalTerrainType = impactTerrainType;
                state.terrainType = impactTerrainType; // Spara ner det i staten
                
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

                    // Fysiskt korrekt spin-bite på lutningar inspirerat av Penner
                    const GRIP = impactTerrainType === 'GREEN' ? 0.98 : 0.85; 
                    let vContactY = V[1] + (state.spin[0] * RADIUS);
                    let vContactX = V[0] - (state.spin[1] * RADIUS);
                    
                    // Energi överförs mellan translation (spinoff) och rotation (bite)
                    let deltaVY = -(vContactY) / 3.5 * GRIP;
                    let deltaVX = -(vContactX) / 3.5 * GRIP;

                    bounceVel[1] += deltaVY;
                    bounceVel[0] += deltaVX;

                    state.spin[0] += (2.5 * deltaVY / RADIUS);
                    state.spin[1] -= (2.5 * deltaVX / RADIUS); 

                    state.vel = bounceVel;
                    state.spin = vecScale(state.spin, GROUND.spinDampingPerBounce);
                    
                    // Är studsen för mjuk uppåt längs ytan? => Rullfas
                    let bounceZMag = vecMag(vecScale(vPerp, -cRestitution));
                    if (bounceZMag < GROUND.minBounceVerticalSpeed || impactTerrainType === 'SAND') {
                        // Greener genererar mer skid eftersom kinetisk gräsfriktion måste överkommas först
                        if (impactTerrainType === 'GREEN') {
                            state.phase = "skid"; 
                        } else {
                            state.phase = "roll";
                        }
                        
                        // Tvinga hastigheten att vara helt parallell med ytan (nolla vDotN lokalt)
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

                if (state.phase === "skid" || state.phase === "roll") {
                    let speedXY = vecMag(state.vel);
                    
                    // Övergång Skid -> Roll
                    if (state.phase === "skid") {
                        // Så länge forward speed skiljer sig drastiskt från spinn-speed, sladdar vi!
                        let spinSpeed = Math.sqrt(state.spin[0]*state.spin[0] + state.spin[1]*state.spin[1]) * RADIUS;
                        // Ren approximationsgräns. I snitt ca 10-20% av en putt.
                        if (Math.abs(speedXY - spinSpeed) < 1.0 || speedXY < 2.0) {
                            state.phase = "roll"; // Hjulet har fått fäste!
                        }
                    }

                    if (speedXY < GROUND.stopSpeed) {
                        state.phase = "stopped";
                        state.vel = [0, 0, 0];
                    }
                }
            }

                }
            }

            // --- KOLLA HÅLET (CUP INTERACTION) ---
            if (envCtx && envCtx.cupPositionLocal && (state.phase === 'roll' || state.phase === 'skid' || state.phase === 'flight')) {
                // Endast om bollen är på marken, eller hoppar lågt över hålet
                if (state.pos[2] <= (currentTerrainZ + 0.08)) {
                    let dX = state.pos[0] - envCtx.cupPositionLocal[0];
                    let dY = state.pos[1] - envCtx.cupPositionLocal[1];
                    let distToCenter = Math.sqrt(dX*dX + dY*dY);
                    
                    if (distToCenter < 0.055) { // 108mm diameter hål (≈ 54mm radie). 55mm ink marginal.
                        let speedXY = Math.sqrt(state.vel[0]*state.vel[0] + state.vel[1]*state.vel[1]);
                        let offsetFactor = distToCenter / 0.054; // 0.0 = exakt mitt, 1.0 = bollen precis på läppen
                        
                        // Fysikalisk Capture-Threshold (Trackman / Pelz)
                        // Om bollen går under 1.0 m/s ramlar den i även på kanten!
                        // Om bollen går upp mot 1.63 m/s ramlar den bara i om den ligger dead-center.
                        let captureThreshold = 1.63 - (offsetFactor * 0.7); 
                        
                        if (speedXY <= captureThreshold) {
                            state.phase = "holed";
                            state.vel = [0, 0, -2.0]; // Dra ner bollen
                            state.pos[0] = envCtx.cupPositionLocal[0];
                            state.pos[1] = envCtx.cupPositionLocal[1];
                            metrics.holed = true;
                            console.log("⛳ HÅLAD! Fart: " + speedXY.toFixed(2) + " m/s");
                        } else if (speedXY > captureThreshold && speedXY <= 2.2 && offsetFactor > 0.3) {
                            // LIP OUT! Bollen slår i bortre kanten men har för mycket fart/fel vinkel för att droppa. 
                            console.log("😥 LIP OUT! Fart: " + speedXY.toFixed(2) + " m/s, Offset: " + offsetFactor.toFixed(2));
                            // Deflektera 
                            state.vel[0] = state.vel[0] * 0.4 + (dX * 18.0); 
                            state.vel[1] = state.vel[1] * 0.4 + (dY * 18.0);
                            state.vel[2] = 0.5; // Litet hopp
                            // Flytta ut från radien så den inte lips out 100 ggr per sekund
                            state.pos[0] += (dX / distToCenter) * 0.02;
                            state.pos[1] += (dY / distToCenter) * 0.02;
                            state.phase = "bounce"; // Return to air temporarily to escape hole radius
                        } else if (speedXY > 2.2) {
                            // Går extremt fort, skippar hålet obemärkt
                        }
                    }
                }
            }

            if ((t - lastSampleTime >= sampleRate) || state.phase === "stopped" || state.phase === "holed") {
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
