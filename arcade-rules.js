    window.takeMulligan = function() {
        if (typeof appMode === 'undefined' || (appMode !== 'PLAY' && appMode !== 'TEST')) return;
        if (appMode === 'PLAY' && (!window.matchSettings || !window.matchSettings.mulligans)) return;
        if (playState !== 'ROUND_IDLE') return;

        let lastIdx = window.lastShotPlayerIndex !== undefined ? window.lastShotPlayerIndex : window.activePlayerIndex;
        let p = window.players[lastIdx];
        
        if (p && p.prevPos) {
            if (window.nextTurnTimeout) clearTimeout(window.nextTurnTimeout);
            
            if (window.activePlayerIndex !== lastIdx) {
                window.activePlayerIndex = lastIdx;
            }
            
            p.holedOut = false;
            if (p.scores) p.scores[playingHoleIndex] = null;
            if (p.scoreVsPar) p.scoreVsPar[playingHoleIndex] = null;

            window.ballMesh.position.set(p.prevPos.x, p.prevPos.y, p.prevPos.z);
            p.strokes = (p.prevStrokes !== undefined) ? p.prevStrokes : p.strokes;
            p.penaltyStrokes = (p.prevPenalty !== undefined) ? p.prevPenalty : p.penaltyStrokes;
            
            p.prevPos = null;
            window.lastShotPlayerIndex = undefined;

            document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            if(typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
            
            camera.position.set(window.ballMesh.position.x, window.ballMesh.position.y + 4, window.ballMesh.position.z + 10);
            controls.target.copy(window.ballMesh.position);
            controls.update();

            let pop = document.getElementById('score-popup');
            if(pop) {
                pop.innerText = "MULLIGAN!";
                pop.style.color = "#ef4444";
                pop.style.opacity = '1';
                setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 2000);
            }

            let mBtn = document.getElementById('btn-mulligan');
            if (mBtn) mBtn.style.display = 'none';
            
            if (window.resetAimTarget) window.resetAimTarget();
        }
    };

    // Relief by dropping: the player places the ball inside a circle (two club lengths) around a reference point, not nearer the hole than
    // that point, and never in water or out of bounds. Used for the water hazard drop (reference = where the ball entered the water) and for an
    // unplayable ball (reference = where the ball lies). onDone runs once the drop is confirmed.
    // opts: { mode: 'lateral' (default) | 'line', mustBeIn, mustBeOutOf } as in arcade-relief.js (an unplayable ball in a bunker)
    const DROP_RADIUS = window.ReliefRules.DROP_RADIUS;   // two club lengths, in metres
    window.startLateralDrop = function(ref, label, doneText, opts) {
        opts = opts || {};
        let p = window.players[window.activePlayerIndex];
        let hole = courseHoles[playingHoleIndex];
        let flag = hole ? hole.flag : null;
        let btnCam = document.getElementById('btn-cam-mode');
        const popup = (text, color, ms) => {
            let pop = document.getElementById('score-popup');
            pop.innerText = text; pop.style.color = color; pop.style.opacity = '1';
            pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
            if (ms) setTimeout(() => { pop.style.opacity = '0'; }, ms);
        };

        // camera to the reference point, free camera so the player can move the aim point
        let h = 0.3;
        if (typeof localGetTerrainAt === 'function') {
            let surf = localGetTerrainAt(ref.x, -ref.z);
            if (surf) h = surf.z + 0.1;
        }
        window.ballMesh.position.set(ref.x, h, ref.z);
        window.camFollowMode = 'FREE';
        if (btnCam) { btnCam.innerText = '🎥 DROP MODE'; btnCam.style.background = '#3b82f6'; }
        camera.position.set(ref.x, h + 8, ref.z + 12);
        controls.target.set(ref.x, h, ref.z);
        controls.enabled = true;
        controls.update();

        // the drop circle (or, back on the line, the line behind the ball)
        if (window._dropZoneCircle) { scene.remove(window._dropZoneCircle); }
        let circGeo = new THREE.BufferGeometry();
        let pts = [];
        const lineDir = opts.mode === 'line' ? window.ReliefRules.backLine(ref, flag) : null;
        if (lineDir) {
            for (let d = 0; d <= window.ReliefRules.LINE_MAX; d += 2) {
                let lx = ref.x + lineDir.x * d, lz = ref.z + lineDir.z * d, lh = 0.3;
                if (typeof localGetTerrainAt === 'function') {
                    let ls = localGetTerrainAt(lx, -lz);
                    if (ls) lh = ls.z + 0.15;
                }
                pts.push(lx, lh, lz);
            }
        }
        for (let a = 0; !lineDir && a <= 64; a++) {
            let angle = (a / 64) * Math.PI * 2;
            let cx = ref.x + Math.cos(angle) * DROP_RADIUS;
            let cz = ref.z + Math.sin(angle) * DROP_RADIUS;
            let ch = 0.3;
            if (typeof localGetTerrainAt === 'function') {
                let cs = localGetTerrainAt(cx, -cz);
                if (cs) ch = cs.z + 0.15;
            }
            pts.push(cx, ch, cz);
        }
        circGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        window._dropZoneCircle = new THREE.Line(circGeo, new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 }));
        window._dropZoneCircle.name = 'dropZoneCircle';
        scene.add(window._dropZoneCircle);

        // confirm button with the same checks for both kinds of drop
        let tools = document.getElementById('play-tools');
        let existingConfirm = document.getElementById('btn-confirm-drop');
        if (existingConfirm) existingConfirm.remove();
        let confirmBtn = document.createElement('button');
        confirmBtn.id = 'btn-confirm-drop';
        confirmBtn.innerText = '✅ CONFIRM DROP';
        confirmBtn.style.cssText = 'background:#10b981; color:#fff; padding:10px 20px; font-weight:900; border:none; border-radius:8px; cursor:pointer; font-size:13px;';
        confirmBtn.onclick = function () {
            let dropX = controls.target.x;
            let dropZ = controls.target.z;
            let dropSurf = (typeof localGetTerrainAt === 'function') ? localGetTerrainAt(dropX, -dropZ) : null;
            let why = window.ReliefRules.checkDrop({ ref: ref, flag: flag, drop: { x: dropX, z: dropZ }, surface: dropSurf ? dropSurf.type : null,
                                                     mode: opts.mode, mustBeIn: opts.mustBeIn, mustBeOutOf: opts.mustBeOutOf,
                                                     surfaceAt: function (x, z) { let s = (typeof localGetTerrainAt === 'function') ? localGetTerrainAt(x, -z) : null; return s ? s.type : null; } });
            if (why) {
                popup('❌ ' + why, '#ef4444', 2500);
                return;
            }
            let dh = dropSurf ? dropSurf.z + 0.1 : 0.3;
            window.ballMesh.position.set(dropX, dh, dropZ);
            if (window.ballMesh.velocity) window.ballMesh.velocity.set(0, 0, 0);
            if (window.ballMesh.angularVelocity) window.ballMesh.angularVelocity.set(0, 0, 0);
            window.ballPos.x = dropX; window.ballPos.y = dh; window.ballPos.z = dropZ;
            p.lie = {x: dropX, y: dh, z: dropZ};
            p.prevPos = {x: dropX, y: dh, z: dropZ};
            if (window.resetAimTarget) window.resetAimTarget();
            if (window._dropZoneCircle) { scene.remove(window._dropZoneCircle); window._dropZoneCircle = null; }
            window.camFollowMode = 'AUTO';
            if (btnCam) { btnCam.innerText = '🎥 AUTO'; btnCam.style.background = '#4f46e5'; }
            camera.position.set(dropX, dh + 4, dropZ + 10);
            controls.target.copy(window.ballMesh.position);
            controls.update();
            this.remove();
            popup(doneText, '#3b82f6', 0);
            setTimeout(() => { document.getElementById('score-popup').style.opacity = '0'; evaluateNextTurn(); }, 1500);
        };
        if (tools) tools.insertBefore(confirmBtn, tools.firstChild);
        popup(opts.mode === 'line' ? '📍 Place the drop on the blue line behind the ball, outside the bunker' : (opts.mustBeIn ? '📍 Place the drop inside the blue circle, in the bunker, not closer to the hole' : '📍 Place the drop inside the blue circle, not closer to the hole'), '#3b82f6', 0);
    };

    // Unplayable ball: +1 penalty and a drop within two club lengths of where the ball lies, not nearer the hole.
    // In a bunker the +1 drop has to stay in the bunker; to get out of it the player takes two penalty strokes and drops back on the line
    // from the hole through the ball, outside the bunker.
    window.takePenaltyDrop = function() {
        if (typeof appMode === 'undefined' || (appMode !== 'PLAY' && appMode !== 'TEST')) return;
        if (playState !== 'ROUND_IDLE') return;
        let p = window.players[window.activePlayerIndex];
        if (!p || !p.lie) return;
        let here = (typeof localGetTerrainAt === 'function') ? localGetTerrainAt(p.lie.x, -p.lie.z) : null;
        let inBunker = !!here && here.type === 'SAND';
        let opts = {}, penalty = 1;
        if (inBunker) {
            if (window.confirm('The ball is in a bunker.\n\nOK: drop in the bunker (+1)\nCancel: drop outside, back on the line from the hole (+2)')) {
                opts = { mustBeIn: 'SAND' };
            } else {
                opts = { mode: 'line', mustBeOutOf: 'SAND' };
                penalty = 2;
            }
        }
        if (window.nextTurnTimeout) clearTimeout(window.nextTurnTimeout);
        p.penaltyStrokes += penalty;
        document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
        if (typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
        window.startLateralDrop({ x: p.lie.x, z: p.lie.z }, 'PENALTY DROP', '📍 Penalty drop (+' + penalty + ') — play on', opts);
    };

    // === RULES ENGINE ===
    
    window.showPenaltyDecision = function(type) {
        let modal = document.getElementById('penalty-decision-modal');
        let title = document.getElementById('penalty-title');
        let subtitle = document.getElementById('penalty-subtitle');
        let dropBtn = document.getElementById('penalty-btn-drop');
        let info = document.getElementById('penalty-info');
        
        if (type === 'WATER') {
            title.innerHTML = '💦 WATER HAZARD';
            title.style.color = '#38bdf8';
            subtitle.textContent = '+1 Penalty Stroke (Lateral Relief)';
            dropBtn.style.display = '';
            info.textContent = 'Rehit: Play from previous position | Drop: Within 2 club lengths of water entry, not closer to hole';
        } else if (type === 'OB') {
            title.innerHTML = '🔴 OUT OF BOUNDS';
            title.style.color = '#ef4444';
            subtitle.textContent = 'Stroke & Distance (+1)';
            dropBtn.style.display = 'none';
            info.textContent = 'Ball returns to previous position with +1 penalty stroke';
        }
        
        modal.style.display = 'flex';
    };
    
    window.penaltyDecisionRehit = function() {
        document.getElementById('penalty-decision-modal').style.display = 'none';
        let p = window.players[window.activePlayerIndex];
        let prevLie = window._penaltyPrevLie || p.teePosition || p.lie;
        
        window.ballMesh.position.set(prevLie.x, prevLie.y, prevLie.z);
        window.ballPos.x = prevLie.x;
        window.ballPos.y = prevLie.y;
        window.ballPos.z = prevLie.z;
        
        let pop = document.getElementById('score-popup');
        pop.innerText = '🔄 REHIT from previous (+1)';
        pop.style.color = '#f59e0b';
        pop.style.opacity = '1';
        pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
        
        window.nextTurnTimeout = setTimeout(() => { pop.style.opacity = '0'; evaluateNextTurn(); }, 2000);
    };
    
    window.penaltyDecisionDrop = function() {
        document.getElementById('penalty-decision-modal').style.display = 'none';
        let entry = window._penaltyEntryPoint;
        if (!entry) {
            // Fallback to rehit
            window.penaltyDecisionRehit();
            return;
        }
        window.startLateralDrop({ x: entry.x, z: entry.z }, 'LATERAL DROP', '📍 Lateral Drop — Play On');
    };

    // Rehit button (+1 penalty, back to previous)
    window.takeRehit = function() {
        if (typeof appMode === 'undefined' || (appMode !== 'PLAY' && appMode !== 'TEST')) return;
        if (playState !== 'ROUND_IDLE') return;
        
        let p = window.players[window.activePlayerIndex];
        if (!p || !p.prevPos) return;
        
        if (window.nextTurnTimeout) clearTimeout(window.nextTurnTimeout);
        
        p.penaltyStrokes++;
        window.ballMesh.position.set(p.prevPos.x, p.prevPos.y, p.prevPos.z);
        p.prevPos = null;
        window.lastShotPlayerIndex = undefined;
        
        document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
        if (typeof window.updatePlayerBanner === 'function') window.updatePlayerBanner();
        
        camera.position.set(window.ballMesh.position.x, window.ballMesh.position.y + 4, window.ballMesh.position.z + 10);
        controls.target.copy(window.ballMesh.position);
        controls.update();
        
        let pop = document.getElementById('score-popup');
        pop.innerText = '↩️ REHIT (+1 Penalty)';
        pop.style.color = '#f59e0b';
        pop.style.opacity = '1';
        setTimeout(() => { pop.style.opacity = '0'; }, 2500);
    };

    setInterval(() => {
        let mBtn = document.getElementById('btn-mulligan');
        let rBtn = document.getElementById('btn-rehit');
        let dBtn = document.getElementById('btn-drop');
        let actionsContainer = document.getElementById('actions-menu-container');
        let actionsPopup = document.getElementById('actions-popup');
        if (mBtn) {
            if (typeof appMode !== 'undefined' && appMode === 'PLAY' && typeof playState !== 'undefined' && playState === 'ROUND_IDLE') {
                let lastIdx = window.lastShotPlayerIndex !== undefined ? window.lastShotPlayerIndex : window.activePlayerIndex;
                let p = window.players ? window.players[lastIdx] : null;
                if (p && p.prevPos) {
                    if (actionsContainer) actionsContainer.style.display = 'block';
                    if (window.matchSettings && window.matchSettings.mulligans) mBtn.style.display = 'block';
                    if (rBtn) rBtn.style.display = 'block';
                    if (dBtn) dBtn.style.display = 'block';
                    return;
                }
            }
            // Hide everything
            mBtn.style.display = 'none';
            if (rBtn) rBtn.style.display = 'none';
            if (dBtn) dBtn.style.display = 'none';
            if (actionsContainer) actionsContainer.style.display = 'none';
            if (actionsPopup) actionsPopup.classList.remove('open');
        }
    }, 500);
