    // === LEADERBOARD SYSTEM ===
    
    // opts.silent: no position badge on the scorecard (a plate of a collection that is not the last one: the page is about to move on)
    async function submitRoundResult(opts) {
        opts = opts || {};
        if (window._loadedIsDraft) { console.log('Draft preview — skipping leaderboard submit'); return; }
        let params = new URLSearchParams(window.location.search);
        let courseCode = params.get('course') || params.get('edit') || currentEditCode;
        if (!courseCode) { console.log('No course code — skipping leaderboard submit'); return; }
        
        let players = window.players || [];
        if (players.length === 0) return;

        // A plate of a collection is a round of its own on that plate; the collection ties the plates of one go together, so its
        // leaderboard can add them up. Read before anything is awaited: the last plate clears it right after calling this.
        let col = window._activeCollection;
        let collStats = null;
        if (col && col.id) {
            let key = 'collection_round_' + col.id;
            let collRound = null;
            try { collRound = sessionStorage.getItem(key); } catch (e) {}
            if (!collRound) {
                collRound = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
                try { sessionStorage.setItem(key, collRound); } catch (e) {}
            }
            collStats = { collection_id: col.id, collection_round_id: collRound, plate_index: window._activePlateIndex || 0 };
        }
        
        // BUG-L03 FIX: Submit ALL players' results, not just player[0]
        // All players at once: a plate of a collection is left right after, and a player sent last would not make it
        const sendPlayer = async function (pi) {
            let pl = players[pi];
            let seat = pl.slot !== undefined ? pl.slot : pi;   // the seat stays the same on every plate of a collection
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
            
            if (holeScores.length === 0) return;
            
            let scoreVsPar = totalScore - totalPar;
            let displayName = (pi === 0 && window.GolfAuth?.user?.display_name) ? window.GolfAuth.user.display_name : (pl.name || 'Player ' + (pi + 1));
            
            try {
                let result = await ArcadeAPI.submitResult(courseCode, {
                    total_score: totalScore,
                    score_vs_par: scoreVsPar,
                    hole_scores: holeScores,
                    input_mode: window.G?.inputMode || 'SWING_METER',
                    lm_device: window.lmDeviceName || null,
                    // the seat goes with every result: the account is the player in seat 0, a guest's round does not count for the handicap (server.js)
                    stats: collStats ? Object.assign({ round_id: collStats.collection_round_id + '-p' + collStats.plate_index + '-' + seat, player_slot: seat }, collStats) : { player_slot: seat },
                    player_name: displayName
                }, collStats ? { keepalive: true } : undefined);
                
                // Only show leaderboard badge for primary player
                if (pi === 0 && result.success) {
                    console.log('🏆 Result submitted! Position:', result.position);
                    
                    let endBtns = opts.silent ? null : document.getElementById('scorecard-endround-btns');
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
        };
        await Promise.all(players.map(function (_, pi) { return sendPlayer(pi); }));
    }
