// ================================================================
//  SWING ENGINE — 2-tap Golf Clash style swing mechanic
//  Works with touch (mobile) and pointer/click (desktop).
//  All physics parameters calibrated against Trackman PGA Tour data.
//
//  Extracted from arcade.html — Compatibility contract:
//  - Exposes window.SwingEngine (IIFE public API)
//  - Exposes window.toggleSwingMode, window.enableSwingMode,
//    window.disableSwingMode, window.handleSwingTap
//  - Depends on: window.ballMesh, window.courseHoles,
//    window.playingHoleIndex, window.triggerRealShot,
//    window.currentBallSurface, window.GREEN_STIMP,
//    window.formatDistStr, THREE.Vector3
// ================================================================
const SwingEngine = (function() {

    // -----------------------------------------------------------
    // CLUB_PROFILES — Trackman PGA Tour averages (verified)
    // Fields: maxSpeed (mph), baseLaunchAngle (°), baseSpin (rpm),
    //         maxSpread (°): max azimuth deviation on full miss
    // -----------------------------------------------------------
    const CLUB_PROFILES = {
        DRIVER: { maxSpeed: 167, baseLaunchAngle: 10.5, baseSpin:  2500, maxSpread: 12, name: 'Driver',  icon: '🏌️' },
        W3:     { maxSpeed: 155, baseLaunchAngle: 12.0, baseSpin:  3500, maxSpread: 10, name: '3 Wood',  icon: '🪵' },
        I5:     { maxSpeed: 140, baseLaunchAngle: 16.0, baseSpin:  5300, maxSpread:  8, name: '5 Iron',  icon: '⛳' },
        I7:     { maxSpeed: 128, baseLaunchAngle: 18.5, baseSpin:  7100, maxSpread:  7, name: '7 Iron',  icon: '⛳' },
        I9:     { maxSpeed: 115, baseLaunchAngle: 22.0, baseSpin:  8700, maxSpread:  6, name: '9 Iron',  icon: '⛳' },
        PW:     { maxSpeed: 103, baseLaunchAngle: 26.0, baseSpin:  9300, maxSpread:  5, name: 'Pitching', icon: '🏌️' },
        SW:     { maxSpeed:  85, baseLaunchAngle: 32.0, baseSpin: 10200, maxSpread:  5, name: 'Sand',    icon: '🏖️' },
        LW:     { maxSpeed:  72, baseLaunchAngle: 36.0, baseSpin: 10800, maxSpread:  4, name: 'Lob',     icon: '🎯' },
        PUTT:   { maxSpeed:  22, baseLaunchAngle:  1.5, baseSpin:   300, maxSpread:  3, name: 'Putter',  icon: '🥅' },
    };

    // Andel av klubbens spinn som finns kvar vid 0 % kraft (spinn = baseSpin * (denna + (1 - denna) * kraft))
    const SPIN_AT_ZERO_POWER = 0.2;

    // Hur mycket spinaxel en miss får, i grader per grad azimut (startlinjefel). Positiv axel kurvar åt höger, så en miss åt höger blir en
    // push-fade och en miss åt vänster en pull-draw. En riktig fysik ger stor kurva för driver (10 graders axel ca 31 yd), så faktorn
    // håller missarna nära vad de var innan sidospinnet rättades: över träffpunkterna 0,1-0,9 blir snittmissen för en driver ca 20 %
    // större (19,5 yd mot 16,3 yd), 7-järn ca 13 % och PW oförändrad. 0 ger bara startlinjefel, 0,8 var den ursprungliga faktorn.
    const MISS_SPIN_AXIS_PER_DEG = 0.35;

    // SVG constants — circumference of r=100 ring
    const CIRC = 2 * Math.PI * 100; // 628.32

    // Timing constants
    const POWER_CYCLE_MS  = 1600; // Full 0→100→0 power cycle duration
    const ARM_RPM         = 90;   // Direction arm: degrees per second (1 full rev = 4s)

    // State
    let _enabled    = false;
    let _clubKey    = 'DRIVER';
    let _phase      = 'idle';   // 'idle' | 'power' | 'direction' | 'fired'
    let _powerPct   = 0;        // 0.0–1.0, captured on tap 1
    let _armDeg     = 0;        // 0–360, captured on tap 2
    let _raf        = null;
    let _phaseStart = 0;

    // DOM refs (lazy — elements exist after HTML parse)
    function _el(id) { return document.getElementById(id); }

    // -----------------------------------------------------------
    // autoSelectClub — distance in THREE.js world units (metres)
    // GREEN surface always forces PUTT regardless of distance.
    // window.currentBallSurface is populated by the animate-loop
    // terrain detector (localGetTerrainAt on every frame).
    // -----------------------------------------------------------
    function autoSelectClub(distMeters) {
        // Green override: ball on putting surface → Putter always
        if (window.currentBallSurface === 'GREEN') return 'PUTT';
        if (distMeters > 201) return 'DRIVER';
        if (distMeters > 174) return 'W3';
        if (distMeters > 151) return 'I5';
        if (distMeters > 133) return 'I7';
        if (distMeters > 114) return 'I9';
        if (distMeters >  91) return 'PW';
        if (distMeters >  55) return 'SW';
        if (distMeters >   9) return 'LW';
        return 'PUTT';
    }

    // -----------------------------------------------------------
    // puttForceToSpeed — a first guess of the ball speed for a putt that should roll targetDistMeters.
    // The real speed is worked out against the actual green (slope, stimp) by window.calibratePuttSpeed
    // when the shot is fired; this is the fallback and the starting point for that search.
    // mu comes from physics.js so both sides use the same stimp formula. A putt starts rolling at once in the physics,
    // so the ball rolls v^2 / (2 mu g).
    // -----------------------------------------------------------
    function puttForceToSpeed(targetDistMeters, stimp) {
        const mu   = (window.GolfPhysics && window.GolfPhysics.greenMu) ? window.GolfPhysics.greenMu(stimp) : 0.56 / stimp;
        const v0ms = Math.sqrt(2 * mu * 9.81 * targetDistMeters);
        return v0ms / 0.44704;                            // m/s → mph
    }
    // 100 % power rolls the ball to the hole plus this much past it (about 17 inches, the pace a putt should die at)
    const PUTT_OVERROLL_M = 0.45;

    // -----------------------------------------------------------
    // mapCircleToPhysics — converts tap results to launchData
    // powerPct:  0.0 (empty) → 1.0 (perfect full power)
    // armDeg:    0–360, 0 = top (perfect direction)
    //            offset from top: positive = right, negative = left
    // -----------------------------------------------------------
    function mapCircleToPhysics(powerPct, armDeg, clubKey, distToHoleM) {
        const club  = CLUB_PROFILES[clubKey];
        const stimp = window.GREEN_STIMP || 10.0;

        // Arm offset from top: map 0–360 → −180 to +180
        let armOffset = armDeg;
        if (armOffset > 180) armOffset -= 360; // −180…+180

        // API Contract variables
        const impactDirection = armOffset < 0 ? -1 : 1; // -1 = left, +1 = right
        const impactOffset    = Math.abs(armOffset) / 90.0; // 0.0 (perfect) to 1.0 (extreme edge)
        
        // Distance Loss Logic (Shot Deviation Model)
        let effectivePower = powerPct;
        if (impactOffset > 0.9) {
            // Skull: Extreme miss, halve the power
            effectivePower *= 0.5;
        } else if (impactOffset > 0.6) {
            // Miss (Red zone): Lose up to 30% distance
            const penalty = 0.10 + 0.20 * ((impactOffset - 0.6) / 0.3); // 10% to 30%
            effectivePower *= (1 - penalty);
        } else if (impactOffset > 0.2) {
            // Good (Yellow zone): Lose up to 10% distance
            const penalty = 0.10 * ((impactOffset - 0.2) / 0.4); // 0% to 10%
            effectivePower *= (1 - penalty);
        }

        // Normalised miss for sideways curve: −1 (full left) → 0 (perfect) → +1 (full right)
        // We use the raw impactOffset to calculate curve, maintaining direction
        const normMiss = (impactOffset * impactDirection);

        // Deterministic component of azimuth error (85%)
        const deterministicMiss = normMiss * club.maxSpread;

        // Random noise (15%)
        const randomNoise = (Math.random() - 0.5) * 2 * club.maxSpread;
        const azimDeg     = deterministicMiss * 0.85 + randomNoise * 0.15;

        // PUTT special case
        if (clubKey === 'PUTT') {
            // power scales the whole roll: 100 % = to the hole and a little past it
            const targetDist  = (Math.max(0.02, distToHoleM) + PUTT_OVERROLL_M) * effectivePower;
            const puttSpeedMph = puttForceToSpeed(targetDist, stimp);
            return {
                ballSpeedMph:   Math.min(puttSpeedMph, club.maxSpeed),
                puttTargetDistM: targetDist,   // executeArcadeShot turns this into a speed that fits the green under the ball
                launchAngleDeg: club.baseLaunchAngle,
                totalSpinRpm:   club.baseSpin,
                spinAxisDeg:    azimDeg * 0.5, 
                azimDeg:        azimDeg,
                isLiveData:     false,
                impactData:     { offset: impactOffset, direction: impactDirection }
            };
        }

        // All other clubs
        const speedMph = club.maxSpeed * effectivePower;
        // Spinnet följer klubbhuvudets fart: full kraft ger klubbens fulla spinn, en chip på 10-20 % ca en fjärdedel till en tredjedel.
        // Förut gav 10 % kraft ändå 73 % av spinnet (7900 rpm på en 10 mph-chip), långt mer än farten kan ge.
        const spinMult = SPIN_AT_ZERO_POWER + (1 - SPIN_AT_ZERO_POWER) * effectivePower;
        const spinRpm  = club.baseSpin * spinMult;

        const vlaOffset = (Math.abs(effectivePower - 0.85) > 0.2) ? -1.5 : 0;

        return {
            ballSpeedMph:   Math.max(speedMph, 10),
            launchAngleDeg: club.baseLaunchAngle + vlaOffset,
            totalSpinRpm:   spinRpm,
            spinAxisDeg:    azimDeg * MISS_SPIN_AXIS_PER_DEG,
            azimDeg:        azimDeg,
            isLiveData:     false,
            impactData:     { offset: impactOffset, direction: impactDirection }
        };
    }

    // -----------------------------------------------------------
    // _getQuality — categorise result for flash feedback
    // -----------------------------------------------------------
    function _getQuality(powerPct, armDeg) {
        let armOffset = armDeg; if (armOffset > 180) armOffset -= 360;
        const normArm   = Math.abs(armOffset) / 180;
        const normPower = Math.abs(powerPct - 0.90); // Perfect power ≈ 90%
        const score     = (1 - normArm) * 0.6 + (1 - normPower * 5) * 0.4;
        if (score > 0.80) return { label: '✨ PERFECT!',  color: '#4ade80' };
        if (score > 0.55) return { label: '👍 GOOD',      color: '#fbbf24' };
        if (score > 0.30) return { label: '😬 OK',        color: '#fb923c' };
        return              { label: '❌ MISS',            color: '#f87171' };
    }

    // -----------------------------------------------------------
    // _showFlash — result feedback animation
    // -----------------------------------------------------------
    function _showFlash(quality) {
        const el = _el('swing-result-flash');
        if (!el) return;
        el.textContent  = quality.label;
        el.style.color  = quality.color;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 900);
    }

    // -----------------------------------------------------------
    // _updateRing — drives SVG power ring via stroke-dashoffset
    // pct: 0.0–1.0, ring colour changes at thresholds
    // -----------------------------------------------------------
    function _updateRing(pct) {
        const ring = _el('power-ring-fill');
        if (!ring) return;
        const offset = CIRC * (1 - pct);
        ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
        // Colour: red < 50%, yellow 50–80%, green > 80%
        ring.style.stroke = pct < 0.50 ? '#ef4444'
                          : pct < 0.80 ? '#fbbf24'
                          : '#4ade80';
    }

    // -----------------------------------------------------------
    // _updateArm — rotates direction arm
    // -----------------------------------------------------------
    function _updateArm(deg) {
        const arm = _el('dir-arm');
        if (!arm) return;
        // If arm is an SVG element, use setAttribute. If it is an HTML div, use style.transform.
        if (arm.tagName.toLowerCase() === 'div') {
            // A div pointing down needs +180 to point up at deg=0. CSS rotation is clockwise.
            arm.style.transform = `rotate(${deg + 180}deg)`;
        } else {
            arm.setAttribute('transform', `rotate(${deg.toFixed(1)} 130 130)`);
        }
    }

    // -----------------------------------------------------------
    // _setPhaseLabel
    // -----------------------------------------------------------
    function _setPhaseLabel(txt) {
        const el = _el('swing-phase-label');
        if (el) el.textContent = txt;
    }

    // -----------------------------------------------------------
    // _rafLoop — main animation loop (runs during swing)
    // -----------------------------------------------------------
    function _rafLoop(ts) {
        if (_phase === 'idle' || _phase === 'fired') return;

        if (_phase === 'power') {
            // Oscillating power: 0→1→0 over POWER_CYCLE_MS
            const elapsed = (ts - _phaseStart) % POWER_CYCLE_MS;
            const raw     = elapsed / POWER_CYCLE_MS; // 0→1 linear
            // Sinusoidal: 0→1→0 per cycle
            const pct = Math.sin(raw * Math.PI);
            _updateRing(pct);
            _raf = requestAnimationFrame(_rafLoop);

        } else if (_phase === 'direction') {
            // Pendulum swing (Golf Clash style)
            // Swings from Left (-90°) to Right (+90°) and back.
            // Base time is 1800ms. If power > 95%, speed up to 1000ms max.
            let cycleTime = 1800;
            if (_powerPct > 0.95) {
                // Scale from 1800ms (at 95%) to 1000ms (at 100%)
                const overload = (_powerPct - 0.95) / 0.05; // 0.0 to 1.0
                cycleTime = 1800 - (800 * overload);
            }
            
            const elapsed = (ts - _phaseStart) % cycleTime; 
            const raw = elapsed / cycleTime; // 0.0 -> 1.0
            
            // -Math.cos starts at -1 (left edge), goes to 0 (top/perfect), +1 (right edge), back to 0.
            _armDeg = -Math.cos(raw * Math.PI * 2) * 90;
            
            _updateArm(_armDeg);
            _raf = requestAnimationFrame(_rafLoop);
        }
    }

    // -----------------------------------------------------------
    // _haptic — cross-platform haptic feedback
    // Android: navigator.vibrate() (standard Vibration API)
    // iOS:     Silent AudioContext pulse — triggers Taptic Engine
    //          via the Web Audio scheduling path.
    //          Note: requires user gesture before first call
    //          (satisfied by the tap itself).
    // -----------------------------------------------------------
    let _audioCtx = null;
    function _haptic(pattern) {
        // Android / Chrome (Vibration API)
        if (navigator.vibrate) {
            navigator.vibrate(pattern);
            return;
        }
        // iOS Safari (AudioContext silent pulse)
        try {
            if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = _audioCtx.createOscillator();
            const gain = _audioCtx.createGain();
            osc.connect(gain);
            gain.connect(_audioCtx.destination);
            gain.gain.setValueAtTime(0.001, _audioCtx.currentTime); // Silent — haptic only
            osc.start(_audioCtx.currentTime);
            osc.stop(_audioCtx.currentTime + 0.010);                // 10ms pulse
        } catch(e) { /* no haptics available */ }
    }

    // -----------------------------------------------------------
    // onTap — primary user interaction (both phases)
    // -----------------------------------------------------------
    function onTap() {
        if (!_enabled) return;

        if (_phase === 'idle') {
            // Hide LM data panel and distance panel if visible from previous shot
            const lmPanel = document.getElementById('lm-data-panel');
            if (lmPanel) lmPanel.classList.remove('active');
            const distPanel = document.getElementById('distance-panel');
            if (distPanel) distPanel.classList.remove('active');

            // Show overlay and start power ring
            _phase      = 'power';
            _phaseStart = performance.now();
            _el('swing-overlay').classList.add('active');
            _setPhaseLabel('TAP TO SET POWER');
            _raf = requestAnimationFrame(_rafLoop);

        } else if (_phase === 'power') {
            // Haptic: strong short pulse — power locked
            _haptic(15);

            // Capture current power from ring fill
            const ringEl = _el('power-ring-fill');
            const offset = parseFloat(ringEl.getAttribute('stroke-dashoffset')) || CIRC;
            _powerPct = Math.max(0, Math.min(1, (CIRC - offset) / CIRC));

            // Transition to direction phase
            _phase      = 'direction';
            _phaseStart = performance.now();
            _armDeg     = 0;
            const arm   = _el('dir-arm');
            if (arm) arm.classList.add('active');
            _setPhaseLabel('TAP TO AIM');

            // Update ring to locked state (no more oscillation)
            _updateRing(_powerPct);
            cancelAnimationFrame(_raf);
            _raf = requestAnimationFrame(_rafLoop);

        } else if (_phase === 'direction') {
            // Haptic: double-tap pattern — shot fired
            _haptic([8, 50, 8]);

            // Capture current arm angle
            cancelAnimationFrame(_raf);
            _phase = 'fired';

            // Hide overlay
            _el('swing-overlay').classList.remove('active');
            const arm = _el('dir-arm');
            if (arm) arm.classList.remove('active');

            // Reset ring for next swing
            _updateRing(0);
            _updateArm(0);
            _setPhaseLabel('TAP TO SET POWER');

            // Build launchData and fire
            let distToHoleM = 50; // fallback
            if (window.ballMesh && window.courseHoles && window.playingHoleIndex !== undefined) {
                const h = window.courseHoles[window.playingHoleIndex];
                if (h && h.flag) {
                    distToHoleM = window.ballMesh.position.distanceTo(
                        new THREE.Vector3(h.flag.x, h.flag.y, h.flag.z)
                    );
                }
            }

            const launchData = mapCircleToPhysics(_powerPct, _armDeg, _clubKey, distToHoleM);
            const quality    = _getQuality(_powerPct, _armDeg);
            _showFlash(quality);

            // Fire through existing pipeline — untouched
            if (typeof window.triggerRealShot === 'function') {
                window.triggerRealShot(launchData);
            }

            // Ready for next shot
            setTimeout(() => { _phase = 'idle'; }, 300);
        }
    }

    // -----------------------------------------------------------
    // selectClub — called by club-btn onclick
    // -----------------------------------------------------------
    function selectClub(key) {
        if (!CLUB_PROFILES[key]) return;
        _clubKey = key;
        // Update selector highlight
        document.querySelectorAll('.club-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.club === key);
        });
        updateSwingInfoBar();
    }

    // -----------------------------------------------------------
    // updateSwingInfoBar — shows club name + distance to pin
    // Called on club change and on landing (ball position update)
    // -----------------------------------------------------------
    function updateSwingInfoBar() {
        const club   = CLUB_PROFILES[_clubKey];
        const nameEl = _el('si-club-name');
        const distEl = _el('si-dist-label');
        if (nameEl) nameEl.textContent = `${club.icon} ${club.name}`;

        if (distEl && window.ballMesh && window.courseHoles && window.playingHoleIndex !== undefined) {
            const h = window.courseHoles[window.playingHoleIndex];
            if (h && h.flag) {
                const distM   = window.ballMesh.position.distanceTo(
                    new THREE.Vector3(h.flag.x, h.flag.y, h.flag.z)
                );
                const distYds = (distM * 1.09361).toFixed(0);
                distEl.textContent = `${distYds} yds  (${distM.toFixed(0)} m)`;

                // Auto-select club based on distance
                const suggested = autoSelectClub(distM);
                if (suggested !== _clubKey) selectClub(suggested);
            }
        }
    }

    // -----------------------------------------------------------
    // enableSwingMode / disableSwingMode
    // RAF guard: cancel any running loop before enabling to prevent
    // multiple parallel _rafLoop chains if toggled on/off rapidly.
    // -----------------------------------------------------------
    function enableSwingMode() {
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; } // Kill any orphaned loop
        _phase   = 'idle';
        _enabled = true;
        document.body.classList.add('swing-mode');
        updateSwingInfoBar();
        console.log('[SwingEngine] Swing mode enabled');
    }

    function disableSwingMode() {
        _enabled = false;
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; } // Null after cancel
        _phase = 'idle';
        // Hide overlay if open mid-swing
        const overlay = document.getElementById('swing-overlay');
        if (overlay) overlay.classList.remove('active');
        document.body.classList.remove('swing-mode');
        console.log('[SwingEngine] Swing mode disabled');
    }

    // -----------------------------------------------------------
    // Public API
    // -----------------------------------------------------------
    return { onTap, selectClub, enableSwingMode, disableSwingMode,
             updateSwingInfoBar, autoSelectClub, mapCircleToPhysics, CLUB_PROFILES };
})();

// Expose for devtools access
window.SwingEngine = SwingEngine;

// ----------------------------------------------------------------
// MOBILE DETECTION — auto-enable swing mode on touch devices.
// Uses ontouchstart (best for tablets/hybrids), fallback to width.
// Match Settings "Force Mobile UI" toggle can override.
// ----------------------------------------------------------------
(function detectAndEnableMobile() {
    const isTouch  = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isNarrow = window.innerWidth < 768;
    const params   = new URLSearchParams(window.location.search);
    const isBuild  = params.get('autorun') === 'new_build' || params.has('edit') || (typeof appMode !== 'undefined' && appMode === 'BUILD');
    if (!isBuild && (isTouch || isNarrow)) {
        SwingEngine.enableSwingMode();
        console.log('[SwingEngine] Auto-enabled (touch/narrow:', isTouch, isNarrow, ')');
    }
})();

// Expose toggle for Match Settings "Force Mobile UI" checkbox
window.toggleSwingMode = function(force) {
    if (force || document.body.classList.contains('swing-mode')) {
        if (!document.body.classList.contains('swing-mode')) SwingEngine.enableSwingMode();
        else SwingEngine.disableSwingMode();
    }
};
window.enableSwingMode  = () => SwingEngine.enableSwingMode();
window.disableSwingMode = () => SwingEngine.disableSwingMode();

// handleSwingTap — wrapper for ontouchstart on #swing-launch-btn.
// Calls e.preventDefault() to cancel the synthetic mousedown→click
// chain that touch browsers emit ~300ms after touchstart.
// Without this, onTap() fires twice per finger press:
//   touchstart (immediate) → mousedown/click (300ms later)
// resulting in idle→power→direction in one tap, skipping power phase.
window.handleSwingTap = function(e) {
    if (e && e.preventDefault) e.preventDefault();
    SwingEngine.onTap();
};
