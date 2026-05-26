
        window._smartBuilderType = 'GREEN';
        window._smartBunkerShape = 'BOWL';
        window._fairwayDifficulty = 'FLAT';
        
        function setSmartBuilderType(type) {
            window._smartBuilderType = type;
            ['GREEN','BUNKER','FAIRWAY','TEE'].forEach(t => {
                let btn = document.getElementById('sb-type-' + t.toLowerCase());
                if(btn) {
                    btn.style.background = (t === type) ? '#4ade80' : '#334155';
                    btn.style.color = (t === type) ? '#0f172a' : '#94a3b8';
                }
            });
            document.getElementById('sb-green-controls').style.display = (type === 'GREEN') ? 'block' : 'none';
            document.getElementById('sb-bunker-controls').style.display = (type === 'BUNKER') ? 'block' : 'none';
            document.getElementById('sb-fairway-controls').style.display = (type === 'FAIRWAY') ? 'block' : 'none';
            document.getElementById('sb-tee-controls').style.display = (type === 'TEE') ? 'block' : 'none';
            // Update panel border color
            let panel = document.getElementById('smart-green-action-panel');
            let colors = {GREEN: '#4ade80', BUNKER: '#f59e0b', FAIRWAY: '#7db952', TEE: '#38bdf8'};
            panel.style.borderColor = colors[type] || '#4ade80';
            // Update build button
            let buildBtn = document.getElementById('sb-build-btn');
            if(buildBtn) {
                if(type === 'BUNKER') {
                    buildBtn.textContent = '🏖️ Build Bunker';
                    buildBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                } else if(type === 'FAIRWAY') {
                    buildBtn.textContent = '🏌️ Build Fairway';
                    buildBtn.style.background = 'linear-gradient(135deg, #7db952, #6b9e3d)';
                } else if(type === 'TEE') {
                    buildBtn.textContent = '🟦 Build Tee Box';
                    buildBtn.style.background = 'linear-gradient(135deg, #38bdf8, #0ea5e9)';
                } else {
                    buildBtn.textContent = '⛳ Build Green';
                    buildBtn.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)';
                }
            }
        }
        function setSmartBunkerShape(shape) {
            window._smartBunkerShape = shape;
            ['BOWL','FLAT'].forEach(s => {
                let btn = document.getElementById('sb-shape-' + s.toLowerCase());
                if(btn) {
                    btn.style.background = (s === shape) ? '#4ade80' : '#334155';
                    btn.style.color = (s === shape) ? '#0f172a' : '#94a3b8';
                }
            });
        }
        
        document.getElementById('sg-foregreen-width').addEventListener('input', function() {
            document.getElementById('sg-foregreen-val').textContent = parseFloat(this.value).toFixed(1) + 'm';
        });
        document.getElementById('sg-edge-sharpness').addEventListener('input', function() {
            let v = parseInt(this.value);
            document.getElementById('sg-edge-val').textContent = v === 0 ? 'Soft' : v === 100 ? 'Sharp' : v + '%';
        });
        document.getElementById('sb-bunker-depth').addEventListener('input', function() {
            document.getElementById('sb-bunker-depth-val').textContent = parseFloat(this.value).toFixed(1) + 'm';
        });
        document.getElementById('sb-bunker-lip').addEventListener('input', function() {
            document.getElementById('sb-bunker-lip-val').textContent = parseFloat(this.value).toFixed(2) + 'm';
        });
        document.getElementById('sf-semirough-width').addEventListener('input', function() {
            document.getElementById('sf-semirough-val').textContent = parseFloat(this.value).toFixed(1) + 'm';
        });
        function setSGDiff(diff) {
            window.greenDifficulty = diff;
            ['FLAT','EASY','MED','HARD'].forEach(d => {
                let btn = document.getElementById('sg-diff-' + d.toLowerCase());
                if(btn) {
                    btn.style.background = (d === diff) ? '#4ade80' : '#334155';
                    btn.style.color = (d === diff) ? '#0f172a' : '#94a3b8';
                }
            });
        }
        function setSFDiff(diff) {
            window._fairwayDifficulty = diff;
            ['FLAT','EASY','MED','HARD'].forEach(d => {
                let btn = document.getElementById('sf-diff-' + d.toLowerCase());
                if(btn) {
                    btn.style.background = (d === diff) ? '#4ade80' : '#334155';
                    btn.style.color = (d === diff) ? '#0f172a' : '#94a3b8';
                }
            });
        }
        
        function executeSmartBuilder() {
            if(window._smartBuilderType === 'BUNKER') {
                executeSmartBunker();
            } else if(window._smartBuilderType === 'FAIRWAY') {
                executeSmartFairway();
            } else if(window._smartBuilderType === 'TEE') {
                executeSmartTee();
            } else {
                executeSplineSmartGreen();
            }
        }

        // ==========================================
        // GOLF OS CORE ENGINE: EVENT LISTENERS (FAS 2)
        // ==========================================
        window.addEventListener('GolfEvent_HoledOut', (e) => {
            let p = e.detail.player;
            if (window.AudioEngine) {
                let audioScoreText = logHoleScoreText(e.detail.total, e.detail.par);
                window.AudioEngine.playHoled(audioScoreText);
                setTimeout(() => window.AudioEngine.playApplause(), 400);
            }
            let pop = document.getElementById('score-popup');
            let scoreText = logHoleScoreText(e.detail.total, e.detail.par);
            
            if (e.detail.isHoleInOne) {
                pop.innerText = '🏆 HOLE IN ONE!';
                pop.style.color = '#fbbf24';
            } else if (e.detail.distanceToPinFt > 5) {
                pop.innerText = '⛳ HOLED FROM ' + window.formatDistStr(e.detail.distanceToPinFt / 3.28084) + '! ' + scoreText;
                pop.style.color = '#4ade80';
            } else {
                pop.innerText = '⛳ HOLED! ' + scoreText;
                pop.style.color = '#4ade80';
            }
            pop.style.opacity = '1';
            pop.style.transform = 'translate(-50%, -60%) scale(1.2)';
            console.log('⛳ HOLED! Total: ' + e.detail.total + ', Par: ' + e.detail.par + ' -> ' + scoreText);
            
            window.players[window.activePlayerIndex] = p; // Sync state back
            window.nextTurnTimeout = setTimeout(() => { 
                pop.style.opacity = '0'; 
                pop.style.transform = 'translate(-50%, -60%) scale(1.0)'; 
                evaluateNextTurn(); 
            }, 1500);
        });

        window.addEventListener('GolfEvent_MatchCompleted', (e) => {
            window.players[window.activePlayerIndex] = e.detail.player;
            let pop = document.getElementById('score-popup');
            if (e.detail.reason === 'CONCEDE') {
                pop.innerText = "AUTO CONCEDE (" + e.detail.maxScore + ")";
                pop.style.color = "#ef4444";
                pop.style.opacity = '1';
                setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 3000);
            }
            evaluateNextTurn(); 
        });

        window.addEventListener('GolfEvent_GimmeAwarded', (e) => {
            let p = e.detail.player;
            if (window.AudioEngine) window.AudioEngine.playClick();
            let pop = document.getElementById('score-popup');
            
            pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
            if (e.detail.type === 'GIMME') {
                pop.innerText = GIMME! ( ft) - 1 Putt;
            } else {
                pop.innerText = AUTO-PUTT ( ft):  Putts;
            }
            pop.style.opacity = '1';
            
            window.players[window.activePlayerIndex] = p; // Sync state back
            window.nextTurnTimeout = setTimeout(() => { 
                pop.style.opacity = '0'; 
                evaluateNextTurn(); 
            }, 1500);
        });

        
        window.addEventListener('GolfEvent_PenaltyApplied', (e) => {
            let p = e.detail.player;
            let type = e.detail.type;
            
            window.players[window.activePlayerIndex] = p; // Sync state back
            if (document.getElementById('hud-play-strokes')) {
                document.getElementById('hud-play-strokes').innerText = p.strokes + p.penaltyStrokes;
            }
            
            if (type === 'WATER') {
                if (window.AudioEngine && window.AudioEngine.playSplash) window.AudioEngine.playSplash();
                window._penaltyEntryPoint = e.detail.entryPoint;
                window._penaltyPrevLie = e.detail.previousLie;
                window.showPenaltyDecision('WATER');
            } else if (type === 'OB') {
                let prevLie = e.detail.previousLie;
                window.ballMesh.position.set(prevLie.x, prevLie.y, prevLie.z);
                window.ballPos.x = prevLie.x;
                window.ballPos.y = prevLie.y;
                window.ballPos.z = prevLie.z;
                
                let pop = document.getElementById('score-popup');
                pop.innerText = '🔴 OUT OF BOUNDS — Stroke & Distance (+1)';
                pop.style.color = '#ef4444';
                pop.style.opacity = '1';
                pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
                
                window.nextTurnTimeout = setTimeout(() => { 
                    pop.style.opacity = '0'; 
                    evaluateNextTurn(); 
                }, 2500);
            }
            isFlying = false;
        });
window.addEventListener('GolfEvent_BallStopped', (e) => {
            let p = e.detail.player;
            if (e.detail.isGreen && e.detail.mode === 'OFF') {
                window.isPuttingMode = true;
                console.log('MANUAL PUTTING ACTIVATED!');
            } else {
                window.isPuttingMode = false;
            }
            
            if (window.camFollowMode !== 'FREE' && window.appMode === 'PLAY') {
                controls.enabled = true;
            }
            
            if (window.SwingEngine && window.SwingEngine.api && window.SwingEngine.api.autoSelectClub) {
                window.SwingEngine.api.autoSelectClub();
            }
            
            window.resetAimTarget();
            
            window.players[window.activePlayerIndex] = p; // Sync state back
            if (typeof updateHUD === 'function') updateHUD();
            isFlying = false;
            evaluateNextTurn();
        });
    