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
        spinDampingPerBounce: 0.85, // Ändrad från 0.75. Mindre direkt spin-död, gör att wedgar spinner mer på greenen (GSPro-stil)
        minBounceVerticalSpeed: 1.0,
        stopSpeed: 0.50 // Ökad från 0.25 för att förhindra extremt långsam osynlig rullning i slutet av puttar
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
        // Högre fart => mer turbolens => minskat drag. 
        if (vMag > 65) cd = 0.19;
        else if (vMag > 50) cd = lerp(0.22, 0.19, (vMag - 50) / 15);
        else if (vMag > 20) cd = lerp(0.26, 0.22, (vMag - 20) / 30);
        else cd = 0.26;
        
        // Ökad fart ger snabbare spinn, mer drag (upp till +4%)
        let spinPenalty = (spinRateRpm / 3000.0) * 0.020;
        
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
        
        // Trackmans Spin Factor kurva för lift kalibrering (130 mph, 14 deg = 215 yds carry)
        if (spinParam <= 0.08) return lerp(0.00, 0.20, spinParam / 0.08); // Driver lyft
        if (spinParam <= 0.13) return lerp(0.20, 0.28, (spinParam - 0.08) / 0.05); // Långa/Mellanjärn
        if (spinParam <= 0.20) return lerp(0.28, 0.33, (spinParam - 0.13) / 0.07); // Korta järn
        if (spinParam <= 0.32) return lerp(0.29, 0.32, (spinParam - 0.20) / 0.12); // Pitch
        if (spinParam <= 0.45) return lerp(0.32, 0.35, (spinParam - 0.32) / 0.13); // Wedgar
        
        // Maxar ut runt 0.32 vid extremt spin (GSPro Wedge spin zone)
        return 0.32;
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
                // Werner & Greig empirisk ekvation + USGA Fysik korrektion (a = mu * g)
                // Stimp 10 (feet) kräver acceleration på ~0.55m/s^2, vilket ger mu = 0.056
                let stimp = window.GREEN_STIMP;
                if (stimp < 6) stimp = 6; if (stimp > 14) stimp = 14;
                mu = 0.056 * (10.0 / stimp); // Spot-on Trackman/USGA matematik
            } else {
                // Omvandla den inkodade rullbromsen (rollingDecel) tillbaka till ett mu-värde för kompatibilitet.
                let currentDecel = state.rollingDecel !== undefined ? state.rollingDecel : GROUND.rollingDecel;
                mu = currentDecel / 9.81;
            }

            let spinTractionMag = 0;

            // Kinetisk glidfas ("Skid") har ungefär 50-80% högre friktion än rullfriktion
            if (state.phase === "skid") {
                mu *= 1.7; 
                
                // SPINN-ÖVERFÖRING (Energi från rotation -> translation)
                let spinVel = vecCross(state.spin, N); 
                let dirFallback = vSpeed > 0.001 ? vecScale(currentV, 1/vSpeed) : [0,1,0];
                let dirDotSpin = spinVel[0]*dirFallback[0] + spinVel[1]*dirFallback[1] + spinVel[2]*dirFallback[2];
                
                // dirDotSpin < 0 (Backspin) ökar friktionen (biter). 
                // dirDotSpin > 0 (Topspin) minskar friktionen (rullar vidare).
                spinTractionMag = dirDotSpin * 0.15; // Tuning coefficient
            }
            
            let frictionAccelMag = mu * normalForceMag;
            
            // Skydda mot okontrollerad Topspin-boost - friktionen får aldrig bli negativ
            let effectiveFriction = Math.max(0, frictionAccelMag - spinTractionMag);
            
            // Friktion verkar rakt mot rörelseriktningen parallellt med marken
            let dir = vSpeed > 0.001 ? vecScale(currentV, 1/vSpeed) : [0,0,0];
            let frictionAccel = vecScale(dir, -effectiveFriction);

            // GRASS GRAIN (Pseudorandom vector based on X/Y position)
            if (state.terrainType === 'GREEN') {
                // Skapa en svag ström baserat på position
                let sx = Math.sin(state.pos[0] * 0.3 + state.pos[1] * 0.2);
                let sy = Math.cos(state.pos[1] * 0.3 - state.pos[0] * 0.2);
                let currentStimp = (typeof window !== 'undefined' && window.GREEN_STIMP) ? window.GREEN_STIMP : 10.0;
                let grainAccelScale = 0.03 * (10.0 / currentStimp); // Grain påverkar mer på tröga greener
                
                // Endast tillämpa grain horisontellt (x/y)
                let gl = Math.sqrt(sx*sx + sy*sy + 1e-6);
                frictionAccel[0] += (sx / gl) * grainAccelScale;
                frictionAccel[1] += (sy / gl) * grainAccelScale;
            }
            
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
        
        // Dynamisk spin decay: baserad på hastighet (Claude/Trackman spec)
        // ~7%/s vid 67m/s (150mph), ~2.8%/s vid 13.4m/s (30mph)
        let speedMs = vecMag(state.vel);
        let t_speed = Math.max(0, Math.min(1, (speedMs - 13.4) / (67.0 - 13.4)));
        let decayRate = 0.028 + t_speed * (0.070 - 0.028);
        
        state.spin = vecScale(state.spin, Math.exp(-decayRate * dt)); 
    }

    /**
     * Konverterar mänsklig input (Simulatordata) till matematisk 3D flight path
     * @param {Object} input - { ballSpeedMph, launchAngleDeg, totalSpinRpm, spinAxisDeg, azimDeg }
     * @param {Object} envCtx - { checkCollisionCallback }
     */
    function simulateFlight(input, envCtx) {
        let startPosXZY = input.startPos || [0, 0, 0];
        let baseSpeedMph = input.ballSpeedMph !== undefined ? input.ballSpeedMph : (input.vMag || 0);
        let baseSpinRpm = input.totalSpinRpm !== undefined ? input.totalSpinRpm : (input.spinTotal || 2500);
        let vla = input.launchAngleDeg !== undefined ? input.launchAngleDeg : (input.vLa || 0);
        let azimDegIn = input.azimDeg !== undefined ? input.azimDeg : (input.vHla || 0);
        let spinAxisIn = input.spinAxisDeg !== undefined ? input.spinAxisDeg : (input.spinAxis || 0);
        
        let lieType = 'FAIRWAY';
        if (envCtx) {
            if (envCtx.getTerrainAt) {
                let li = envCtx.getTerrainAt(startPosXZY[0], startPosXZY[1], startPosXZY[2]);
                if (li && li.type) lieType = li.type;
            } else if (envCtx.checkCollisionCallback) {
                let li = envCtx.checkCollisionCallback(0, 0, 0); // Check precisely at origin
                if (li && li.type) lieType = li.type;
            }
        }
        
        let speedMult = 1.0;
        let spinMult = 1.0;
        
        if (!input.isLiveData) {
            // TEE SHOT OVERRIDE: First shot is always perfectly teed up, regardless of terrain color under it.
            if (input.isTeeShot) lieType = 'FAIRWAY';
            
            if (lieType === 'ROUGH') {
                let vlaFactor = Math.max(0, Math.min(1, (vla - 10) / 35)); 
                if (Math.random() < 0.15 && vla > 15) {
                    speedMult = 1.02; spinMult = 0.40;
                    console.log("💥 TRACKMAN FLYER-LIE DETECTED! Zero spin, hot velocity.");
                } else {
                    // Milder penalty for Arcade: max 15% speed loss for Driver, 5% for Wedge
                    speedMult = 1.0 - (0.15 - (0.10 * vlaFactor)); 
                    spinMult = 1.0 - (0.40 - (0.30 * vlaFactor));
                }
            } else if (lieType === 'SEMI-ROUGH') {
                speedMult = 0.98; spinMult = 0.95; 
            } else if (lieType === 'DEEP ROUGH') {
                let vlaFactor = Math.max(0, Math.min(1, (vla - 10) / 35)); 
                if (Math.random() < 0.25 && vla > 20) {
                    speedMult = 1.03; spinMult = 0.30;
                    console.log("💥 TRACKMAN FLYER-LIE DETECTED (DEEP ROUGH)! Zero spin, hot velocity.");
                } else {
                    // Max 25% speed loss for Driver, 10% for Wedge
                    speedMult = 1.0 - (0.25 - (0.15 * vlaFactor));
                    spinMult = 1.0 - (0.60 - (0.40 * vlaFactor));
                }
            } else if (lieType === 'SAND') {
                let vlaFactor = Math.max(0, Math.min(1, (vla - 20) / 30)); 
                // Max 20% speed loss for low loft, 5% for high loft
                speedMult = 1.0 - (0.20 - (0.15 * vlaFactor));
                spinMult = 1.0 - (0.30 - (0.20 * vlaFactor));
            }
        }
        
        let speedMS = (baseSpeedMph * speedMult) * 0.44704; // mph -> m/s
        let spinFinal = baseSpinRpm * spinMult;
        
        let launchRads = vla * Math.PI / 180;
        let azimRads = azimDegIn * Math.PI / 180;
        
        // Start hastighetsvektor
        // Y: framåt, X: höger, Z: upp
        let vX = speedMS * Math.cos(launchRads) * Math.sin(azimRads);
        let vY = speedMS * Math.cos(launchRads) * Math.cos(azimRads);
        let vZ = speedMS * Math.sin(launchRads);
        let vel = [vX, vY, vZ];

        // Start spinnvektor
        let wRads = spinFinal * 2 * Math.PI / 60; // rpm -> rad/s
        let spinAxisRads = spinAxisIn * Math.PI / 180;
        
        // Om spinAxis = 0 -> rent backspin -> snurrar kring X-axeln.
        // Trackman-konvention (positiv SpinAxis = Slice = Bollen böjer höger)
        // För att det ska böja höger i vår fysik (positiv x-kraft), måste sZ vara negativt.
        let sX = wRads * Math.cos(spinAxisRads);
        let sY = 0;
        let sZ = wRads * Math.sin(spinAxisRads);
        let spin = [sX, sY, sZ];
        
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
        const sampleRate = 0.005; // MÅSTE vara 5ms för att matcha Animation Loops Time-step (100ms kraschade Trackman Look-ahead kameran)
        
        let path = [];
        path.push({ 
            x: startPosXZY[0], y: startPosXZY[1], z: startPosXZY[2], 
            vx: vel[0], vy: vel[1], vz: vel[2],
            time: 0, phase: 'flight' 
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
        let _dbgFirstGroundHit = false;
        let _dbgTreeHitCount = 0;
        
        // === FORENSICS: Scan terrain heights ahead of ball ===
        if (envCtx && envCtx.getTerrainAt) {
            let scanLog = [];
            let fwdX = vel[0] / (vecMag(vel) || 1);
            let fwdY = vel[1] / (vecMag(vel) || 1);
            for (let d = 0; d <= 250; d += 10) {
                let px = startPosXZY[0] + fwdX * d;
                let py = startPosXZY[1] + fwdY * d;
                let ti = envCtx.getTerrainAt(px, py);
                scanLog.push({ dist: d, terrainZ: ti ? ti.z.toFixed(2) : 'N/A', type: ti ? ti.type : '?' });
            }
            console.log('🔬 TERRAIN SCAN (every 10m ahead):', JSON.stringify(scanLog));
            console.log('🔬 BALL START Z:', startPosXZY[2].toFixed(3), 'TERRAIN AT START Z:', (envCtx.getTerrainAt(startPosXZY[0], startPosXZY[1]) || {z:0}).z.toFixed(3));
        }
        
        // lastSampleTime utfasas till förmån för direkta dt-ticks i path.
        // Simulator-loop
        while (state.phase !== "stopped" && state.phase !== "holed" && t < 25.0) { // Safety break efter max 25 sek in-miljö
            
            // Kolla luft-kollisioner (Träd) innan vi flyttar oss
            // SPAWN IMMUNITY: Give the ball 0.2s to escape a bad lie or tree trunk
            if (t > 0.20 && envCtx && envCtx.checkCollisionCallback && state.phase === "flight") {
                let terrain = envCtx.checkCollisionCallback(state.pos[0], state.pos[1], state.pos[2]);
                if (terrain) {
                    if (terrain.type === 'ROCK' || terrain.type === 'CACTUS' || terrain.part === 'TRUNK') {
                        // Solid krock!
                        console.log(`🏌️‍♂️🪨 SOLID KROCK! Bollen träffade ett hårt objekt (${terrain.type} ${terrain.part || ''})`);
                        
                        // Anti-clipping: Tvinga ut bollen från kollisionshöljet
                        if (terrain.safePos) {
                            state.pos[0] = terrain.safePos[0];
                            state.pos[1] = terrain.safePos[1];
                        }

                        // Trigonometrisk Reflektion (Studs) mot fallets normal
                        if (terrain.n) {
                            let n = terrain.n; // [nx, ny, nz]
                            let vDotN = state.vel[0]*n[0] + state.vel[1]*n[1] + state.vel[2]*n[2];
                            
                            // Studsa enbart om vi fysiskt rör oss in i hindret (dot-product < 0)
                            if (vDotN < 0) {
                                let cor = 0.4; // 40% Bevarad rörelseenergi efter studs
                                state.vel[0] -= (1 + cor) * vDotN * n[0];
                                state.vel[1] -= (1 + cor) * vDotN * n[1];
                                state.vel[2] -= (1 + cor) * vDotN * n[2];
                                
                                // Drag-absorbering från ojämna ytor
                                state.vel[0] *= 0.8;
                                state.vel[1] *= 0.8;
                                state.vel[2] *= 0.8;
                            }
                        } else {
                            // Fallback för ofullständig objekt-data
                            state.vel[0] *= -0.2; 
                            state.vel[1] *= -0.2; 
                        }
                        
                        // Spinn dör tvärt mot solida ytor
                        state.spin = [0,0,0];
                    } else if (terrain.type === 'BUSH') {
                        // Segt buskage drar ner farten sekventiellt (Ej solid)
                        let speedXZ = Math.sqrt(state.vel[0]*state.vel[0] + state.vel[1]*state.vel[1]);
                        if (speedXZ > 2.0 && Math.random() < 0.6) {
                            console.log(`🏌️‍♂️🌿 Bollen rasslade rakt in i en tjock buske!`);
                            state.vel[0] *= 0.4;
                            state.vel[1] *= 0.4;
                            state.vel[2] *= 0.5;
                        }
                    } else if (terrain.type === 'TREE' && terrain.part === 'CANOPY') {
                        let treeHeight = terrain.height || 15.0;
                        if (state.pos[2] < treeHeight && state.pos[2] > 0.1) {
                            let speed = vecMag(state.vel);
                            let distTraveled = speed * dt;
                            
                            // Lövverk: ren volymetrisk sannolikhet
                            let hitProbabilityPerMeter = 0.40; 
                            let currentTickRisk = distTraveled * hitProbabilityPerMeter;
                            
                            _dbgTreeHitCount++;
                            let distFromStart = Math.sqrt((state.pos[0]-startPosXZY[0])**2 + (state.pos[1]-startPosXZY[1])**2);
                            if (_dbgTreeHitCount <= 5) {
                                console.log(`🌲 CANOPY CHECK #${_dbgTreeHitCount}: dist=${distFromStart.toFixed(1)}m, ballZ=${state.pos[2].toFixed(1)}m, treeH=${treeHeight.toFixed(1)}m, risk=${currentTickRisk.toFixed(4)}, speed=${speed.toFixed(1)}m/s`);
                            }
                            
                            if (Math.random() < currentTickRisk) {
                                console.log(`🏌️‍♂️🌲 KROCK! Bollen fastnade i lövverket på höjd: ${state.pos[2].toFixed(1)}m, dist=${distFromStart.toFixed(1)}m, treeHeight=${treeHeight.toFixed(1)}m`);
                                state.vel[0] *= 0.1;
                                state.vel[1] *= 0.1;
                                state.vel[2] = -2.0; // Bollen dröser neråt ruffen
                                state.spin = [0,0,0]; 
                            }
                        }
                    }
                }
            }
            
            // Lägg in en hook för att hämta terränginformation varje tick!
            let tInfo = { z: 0, normal: [0,0,1], type: 'FAIRWAY' };
            if (envCtx && envCtx.getTerrainAt) {
                tInfo = envCtx.getTerrainAt(state.pos[0], state.pos[1], state.pos[2]);
            }
            state.terrainNormal = tInfo.normal;
            
            let prevPos = [...state.pos];
            let prevVel = [...state.vel];
            
            stepRK4(state, dt);
            
            // NYTT: Kolla väggkollision (Sargar)
            if (envCtx && envCtx.checkWallCollision) {
                let wallRes = envCtx.checkWallCollision(prevPos, state.pos, state.vel, dt);
                if (wallRes) {
                    state.pos = wallRes.pos;
                    state.vel = wallRes.vel;
                    if (wallRes.spin) state.spin = wallRes.spin;
                    // Låt phase vara kvar (roll/skid/flight)
                }
            }
            
            // Mark-spinn decay (spin dör snabbt ut under Skid/Roll fas tills den matchar rörelsen)
            if (state.phase === "skid" || state.phase === "roll") {
                 let spinDecay = 1.0 - (dt * 2.5); // Dödar spinn successivt
                 if (spinDecay < 0) spinDecay = 0;
                 state.spin[0] *= spinDecay;
                 state.spin[1] *= spinDecay;
                 state.spin[2] *= spinDecay;
            }
            
            if (state.phase === "roll") {
                // BYPASS KOPPEN FÖR ATT INTE TVINGAS TILL GRÄS-YTAN I HÅLET
                let insideCup = false;
                if (envCtx && envCtx.cupPositionLocal) {
                    let dX = state.pos[0] - envCtx.cupPositionLocal[0];
                    let dY = state.pos[1] - envCtx.cupPositionLocal[1];
                    if (dX*dX + dY*dY < 0.054*0.054) insideCup = true;
                }

                if (!insideCup) {
                    // Tvinga bollen att "hug the ground" och uppdatera hastighetsvektor så den är parallell!
                    let freshT = envCtx && envCtx.getTerrainAt ? envCtx.getTerrainAt(state.pos[0], state.pos[1], state.pos[2]) : tInfo;
                    state.pos[2] = freshT.z;
                    
                    let vDotN = state.vel[0]*freshT.normal[0] + state.vel[1]*freshT.normal[1] + state.vel[2]*freshT.normal[2];
                    state.vel[0] -= vDotN * freshT.normal[0];
                    state.vel[1] -= vDotN * freshT.normal[1];
                    state.vel[2] -= vDotN * freshT.normal[2];
                }
            }
            
            t += dt;
            
            // Evaluera Apex
            if (state.pos[2] > metrics.apexMeters) metrics.apexMeters = state.pos[2];

            // Identifiera om vi svävar över koppen
            let overCup = false;
            if (envCtx && envCtx.cupPositionLocal) {
                let dX = state.pos[0] - envCtx.cupPositionLocal[0];
                let dY = state.pos[1] - envCtx.cupPositionLocal[1];
                if (dX*dX + dY*dY < 0.054*0.054) overCup = true;
            }

            // Markkontakt och Fysik-övergång via 3D Slopes (Bypass om vi är över koppen!)
            if (state.pos[2] <= tInfo.z && state.phase !== "stopped" && !overCup) {
                
                // === FORENSICS: Log first ground collision ===
                if (!_dbgFirstGroundHit && state.phase === 'flight') {
                    _dbgFirstGroundHit = true;
                    let distFromStart = Math.sqrt((state.pos[0]-startPosXZY[0])**2 + (state.pos[1]-startPosXZY[1])**2);
                    console.log('🔬 FIRST GROUND HIT:', JSON.stringify({
                        time: t.toFixed(3),
                        distFromStartM: distFromStart.toFixed(1),
                        distFromStartYds: (distFromStart * 1.09361).toFixed(1),
                        ballZ: state.pos[2].toFixed(3),
                        terrainZ: tInfo.z.toFixed(3),
                        prevBallZ: prevPos[2].toFixed(3),
                        terrainType: tInfo.type,
                        ballPos: { x: state.pos[0].toFixed(2), y: state.pos[1].toFixed(2) },
                        velZ: state.vel[2].toFixed(2),
                        treeHitsBeforeGround: _dbgTreeHitCount
                    }));
                }
                
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
                    metrics.carryMeters = Math.sqrt((state.pos[0]-startPosXZY[0])*(state.pos[0]-startPosXZY[0]) + (state.pos[1]-startPosXZY[1])*(state.pos[1]-startPosXZY[1]));
                }
                
                // Bestäm markens fysikegenskaper
                let impactTerrainType = 'FAIRWAY';
                if (envCtx && envCtx.checkCollisionCallback) {
                    let impactRes = envCtx.checkCollisionCallback(impactPos[0], impactPos[1], 0);
                    if (impactRes && impactRes.type) impactTerrainType = impactRes.type;
                }
                
                // Beräkna infallsvinkel (0° = lodrätt, 90° = horisontell längs marken)
                let N = tInfo.normal;
                let vMagImpact = vecMag(impactVel);
                let vDotN_impact = impactVel[0]*N[0] + impactVel[1]*N[1] + impactVel[2]*N[2];
                let incidenceAngleDeg = 90.0;
                if (vMagImpact > 0.001) {
                    incidenceAngleDeg = 90.0 - Math.acos(Math.abs(vDotN_impact) / vMagImpact) * (180.0/Math.PI);
                }
                
                let baseCor = GROUND.restitution;
                let cFriction = GROUND.bounceFriction;
                let cRollingDecel = GROUND.rollingDecel;
                
                if (impactTerrainType === 'GREEN') {
                    // Mjukhet baserad på inställningar
                    let firmness = (typeof window !== 'undefined' && window.matchSettings) ? window.matchSettings.greenFirmness : 'NORMAL';
                    if (firmness === 'SOFT') {
                        baseCor = 0.52; cFriction = 0.20; cRollingDecel = 0.5;
                    } else if (firmness === 'FIRM') {
                        baseCor = 0.72; cFriction = 0.10; cRollingDecel = 0.5;
                    } else {
                        // NORMAL fallback
                        baseCor = 0.62; cFriction = 0.15; cRollingDecel = 0.5;
                    }
                } else if (impactTerrainType === 'TEE' || impactTerrainType === 'FAIRWAY') {
                    baseCor = 0.58; cFriction = 0.15; cRollingDecel = 0.78; // roll_mu 0.08
                } else if (impactTerrainType === 'SEMI-ROUGH') {
                    baseCor = 0.50; cFriction = 0.20; cRollingDecel = 0.98; // roll_mu 0.10
                } else if (impactTerrainType === 'ROUGH') {
                    baseCor = 0.43; cFriction = 0.25; cRollingDecel = 1.47; // roll_mu 0.15
                } else if (impactTerrainType === 'DEEP ROUGH') {
                    baseCor = 0.35; cFriction = 0.35; cRollingDecel = 2.45; // roll_mu 0.25
                } else if (impactTerrainType === 'SAND') {
                    baseCor = 0.30; cFriction = 0.50; cRollingDecel = 3.92; // roll_mu 0.40
                } else if (impactTerrainType === 'WASTE') {
                    baseCor = 0.32; cFriction = 0.25; cRollingDecel = 0.49; // roll_mu 0.05
                }
                
                // Variabel COR-ekvation (Sports Engineering 2023)
                // En brant infallsvinkel (0-20°) droppar COR. Flack vinkel (60-90°) behåller hastigheten.
                let cRestitution = Math.max(0.05, baseCor - 0.004 * incidenceAngleDeg);
                
                if (impactTerrainType === 'WATER') {
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
                        metrics.carryMeters = Math.sqrt((state.pos[0]-startPosXZY[0])*(state.pos[0]-startPosXZY[0]) + (state.pos[1]-startPosXZY[1])*(state.pos[1]-startPosXZY[1]));
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

            // --- KOLLA HÅLET (CUP INTERACTION - 3D RATTLE) ---
            if (envCtx && envCtx.cupPositionLocal && (state.phase === 'roll' || state.phase === 'skid' || state.phase === 'flight')) {
                // Hålets golv ligger vanligtvis ca 10.8 cm (0.108m) under ytan
                let cupBottomZ = tInfo.z - 0.108;
                let isBelowGround = state.pos[2] < tInfo.z;
                let isInsideCupVolume = state.pos[2] >= cupBottomZ;

                // Är vi i närheten av koppen ovanifrån (margin of error för hopp)
                if (state.pos[2] <= (tInfo.z + 0.08) && !isBelowGround) {
                    let dX = state.pos[0] - envCtx.cupPositionLocal[0];
                    let dY = state.pos[1] - envCtx.cupPositionLocal[1];
                    let distToCenter = Math.sqrt(dX*dX + dY*dY);
                    
                    if (distToCenter < 0.054) { // Över hålet (inom 54mm)
                        let speedXY = vecMag([state.vel[0], state.vel[1], 0]);
                        let offsetFactor = distToCenter / 0.054; 
                        
                        let captureThreshold = 1.63 - (offsetFactor * 0.7); 
                        
                        if (speedXY <= captureThreshold || (state.phase !== 'roll' && state.phase !== 'skid' && state.vel[2] < 0)) {
                            // Vi ramlar i hålet! Tillåt gravitation att verka
                            state.phase = "flight"; 
                            // Tryck bollen nedåt direkt för att undvika konstig lip-hanging
                            if (state.vel[2] >= 0) state.vel[2] = -0.5;
                        } else if (speedXY > captureThreshold && speedXY <= 2.2 && offsetFactor > 0.3) {
                            // LIP OUT!
                            console.log("😥 LIP OUT! Fart: " + speedXY.toFixed(2) + " m/s, Offset: " + offsetFactor.toFixed(2));
                            state.vel[0] = state.vel[0] * 0.4 + (dX * 18.0); 
                            state.vel[1] = state.vel[1] * 0.4 + (dY * 18.0);
                            state.vel[2] = 0.5; 
                            state.pos[0] += (dX / distToCenter) * 0.02;
                            state.pos[1] += (dY / distToCenter) * 0.02;
                            state.phase = "bounce"; 
                        }
                    }
                } 
                // Om vi redan ÄR nere i hålet (under markytan Z)
                else if (isBelowGround && isInsideCupVolume) {
                    let dX = state.pos[0] - envCtx.cupPositionLocal[0];
                    let dY = state.pos[1] - envCtx.cupPositionLocal[1];
                    let distToCenter = Math.sqrt(dX*dX + dY*dY);

                    // Studs mot hålets plastiga innervägg (radie 54mm = 0.054)
                    if (distToCenter > 0.032) { // Bollen (radie 21mm) träffar väggen när centrum är ca 32mm från center
                        // Rebound mot väggen (elastisk collision)
                        let nX = dX / distToCenter;
                        let nY = dY / distToCenter;
                        
                        let vDotN = state.vel[0]*nX + state.vel[1]*nY;
                        if (vDotN > 0) {
                            state.vel[0] -= 1.6 * vDotN * nX; // Studs (restitution 0.6)
                            state.vel[1] -= 1.6 * vDotN * nY;
                            // Sänk fart och drag in den lätt mot mitten
                            state.vel[0] *= 0.8;
                            state.vel[1] *= 0.8;
                        }
                        // Dra tillbaka innanför väggen
                        state.pos[0] = envCtx.cupPositionLocal[0] + nX * 0.031;
                        state.pos[1] = envCtx.cupPositionLocal[1] + nY * 0.031;
                    }
                    
                    // Slutligen, om bollen ligger på botten
                    if (state.pos[2] <= cupBottomZ + 0.021) { // 21mm bollradie
                        state.pos[2] = cupBottomZ + 0.021;
                        metrics.holed = true;
                        state.phase = "holed";
                        state.vel = [0,0,0];
                        state.spin = [0,0,0];
                        console.log("⛳ HÅLAD (Till botten)!");
                    } else {
                        state.phase = "flight"; // Fortsätt falla fritt mellan väggarna
                    }
                }
            }

            path.push({ 
                x: state.pos[0], y: state.pos[1], z: state.pos[2], 
                vx: state.vel[0], vy: state.vel[1], vz: state.vel[2],
                time: t, phase: state.phase 
            });
        }

        
        metrics.totalMeters = Math.sqrt((state.pos[0]-startPosXZY[0])*(state.pos[0]-startPosXZY[0]) + (state.pos[1]-startPosXZY[1])*(state.pos[1]-startPosXZY[1]));
        metrics.totalTime = t;

        return { path: path, metrics: metrics };
    }

    return {
        simulateFlight: simulateFlight
    };
})();
