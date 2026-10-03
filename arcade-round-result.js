    // === LEADERBOARD SYSTEM ===
    
    async function submitRoundResult() {
        if (window._loadedIsDraft) { console.log('Draft preview — skipping leaderboard submit'); return; }
        let params = new URLSearchParams(window.location.search);
        let courseCode = params.get('course') || params.get('edit') || currentEditCode;
        if (!courseCode) { console.log('No course code — skipping leaderboard submit'); return; }
        
        let players = window.players || [];
        if (players.length === 0) return;
        
        // BUG-L03 FIX: Submit ALL players' results, not just player[0]
        for (let pi = 0; pi < players.length; pi++) {
            let pl = players[pi];
            let totalScore = 0;
            let totalPar = 0;
            let holeScores = [];
            
            for (let i = 0; i < MAX_HOLES; i++) {
                if (pl.scores && pl.scores[i] !== null && pl.scores[i] !== undefined) {
                    totalScore += pl.scores[i];
                    holeScores.push(pl.scores[i]);
                    totalPar += courseHoles[i] ? (courseHoles[i].par || 4) : 4;
                }
            }
            
            if (holeScores.length === 0) continue;
            
            let scoreVsPar = totalScore - totalPar;
            let displayName = (pi === 0 && window.GolfAuth?.user?.display_name) ? window.GolfAuth.user.display_name : (pl.name || 'Player ' + (pi + 1));
            
            try {
                let result = await ArcadeAPI.submitResult(courseCode, {
                    total_score: totalScore,
                    score_vs_par: scoreVsPar,
                    hole_scores: holeScores,
                    input_mode: window.G?.inputMode || 'SWING_METER',
                    lm_device: window.lmDeviceName || null,
                    player_name: displayName
                });
                
                // Only show leaderboard badge for primary player
                if (pi === 0 && result.success) {
                    console.log('🏆 Result submitted! Position:', result.position);
                    
                    let endBtns = document.getElementById('scorecard-endround-btns');
                    if (endBtns) {
                        let posText = result.position === 1 ? '🥇 #1' : result.position === 2 ? '🥈 #2' : result.position === 3 ? '🥉 #3' : '#' + result.position;
                        let badge = document.createElement('div');
                        badge.style.cssText = 'color:#fde047; font-size:18px; font-weight:900; margin-bottom:10px; text-align:center; width:100%;';
                        badge.innerHTML = `🏆 Course Record Position: ${posText} <button onclick="showLeaderboard('${courseCode}')" style="background:#38bdf8; color:#0f172a; border:none; padding:8px 16px; border-radius:8px; font-weight:bold; cursor:pointer; margin-left:10px;">Se Course Records</button>`;
                        
                        if (result.handicap && result.handicap.new !== null) {
                            let hcpBadge = document.createElement('div');
                            hcpBadge.style.cssText = 'color:#a78bfa; font-size:15px; font-weight:700; margin-bottom:8px; text-align:center; width:100%;';
                            let prev = result.handicap.previous !== null ? result.handicap.previous : '—';
                            let curr = result.handicap.new;
                            let diff = result.handicap.previous !== null ? (curr - result.handicap.previous) : 0;
                            let arrow = diff < 0 ? '▼' : (diff > 0 ? '▲' : '—');
                            let diffColor = diff < 0 ? '#4ade80' : (diff > 0 ? '#f87171' : '#94a3b8');
                            let diffText = diff !== 0 ? (' <span style="color:' + diffColor + '">' + arrow + ' ' + Math.abs(diff).toFixed(1) + '</span>') : '';
                            hcpBadge.innerHTML = '🏌️ Handicap: ' + prev + ' → ' + curr.toFixed(1) + diffText;
                            endBtns.parentNode.insertBefore(hcpBadge, endBtns);
                        }
                        endBtns.parentNode.insertBefore(badge, endBtns);
                    }
                } else if (pi > 0 && result.success) {
                    console.log('🏆 Player', pi + 1, 'result submitted! Position:', result.position);
                }
            } catch (e) {
                console.warn('Could not submit round result for player', pi + 1, ':', e);
            }
        }
    }
