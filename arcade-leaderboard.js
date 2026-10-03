    window.showLeaderboard = async function(courseCode) {
        if (!courseCode) {
            let params = new URLSearchParams(window.location.search);
            courseCode = params.get('course') || params.get('edit') || currentEditCode;
        }
        if (!courseCode) return;
        
        // Create or reuse modal
        let modal = document.getElementById('leaderboard-modal');
        if (!modal) {
            // Lägg in animation keyframes om det inte redan finns
            if (!document.getElementById('cr-styles')) {
                let style = document.createElement('style');
                style.id = 'cr-styles';
                style.innerHTML = `
                    @keyframes slideUpIn {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                `;
                document.head.appendChild(style);
            }
            
            modal = document.createElement('div');
            modal.id = 'leaderboard-modal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(5, 8, 15, 0.6);z-index:99998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(15px); -webkit-backdrop-filter: blur(15px);';
            modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
            modal.innerHTML = `
                <div style="background:rgba(30, 41, 59, 0.4);border-radius:24px;padding:30px;max-width:650px;width:95%;max-height:85vh;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);box-shadow:0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                        <h2 style="font-family:Inter,sans-serif;font-size:24px;font-weight:900;color:#fff;margin:0;letter-spacing:1px;text-shadow: 0 0 20px rgba(255,255,255,0.3);">🏆 COURSE RECORDS</h2>
                        <button onclick="document.getElementById('leaderboard-modal').style.display='none'" style="background:none;border:none;color:#94a3b8;font-size:28px;cursor:pointer;transition:color 0.2s;">&times;</button>
                    </div>
                    <div id="lb-tabs" style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                        <button class="lb-tab active" onclick="lbFilter('all',null)" data-mode="all" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#eab308;color:#0f172a;font-weight:bold;font-size:12px;cursor:pointer;">ALL</button>
                        <button class="lb-tab" onclick="lbFilter('SWING_METER',null)" data-mode="SWING_METER" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#334155;color:#fff;font-weight:bold;font-size:12px;cursor:pointer;">📱 Swing Meter</button>
                        <button class="lb-tab" onclick="lbFilter('LAUNCH_MONITOR',null)" data-mode="LAUNCH_MONITOR" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#334155;color:#fff;font-weight:bold;font-size:12px;cursor:pointer;">📡 Launch Monitor</button>
                        <span style="flex-grow:1;"></span>
                        <button class="lb-tab" onclick="lbFilter(null,'all')" data-period="all" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer;">All Time</button>
                        <button class="lb-tab" onclick="lbFilter(null,'month')" data-period="month" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer;">Denna Månad</button>
                    </div>
                    <div id="lb-info" style="color:#64748b;font-size:12px;margin-bottom:10px;"></div>
                    <div id="lb-body" style="color:#94a3b8;text-align:center;padding:20px;">Laddar...</div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        modal.style.display = 'flex';
        modal.dataset.courseCode = courseCode;
        modal.dataset.mode = '';
        modal.dataset.period = '';
        
        loadLeaderboardData(courseCode, null, null);
    };
    
    window.lbFilter = function(mode, period) {
        let modal = document.getElementById('leaderboard-modal');
        if (!modal) return;
        
        if (mode !== null) modal.dataset.mode = (mode === 'all') ? '' : mode;
        if (period !== null) modal.dataset.period = (period === 'all') ? '' : period;
        
        // Update tab styles
        if (mode !== null) {
            document.querySelectorAll('#lb-tabs button[data-mode]').forEach(b => {
                b.style.background = b.getAttribute('data-mode') === (mode || 'all') ? '#eab308' : '#334155';
                b.style.color = b.getAttribute('data-mode') === (mode || 'all') ? '#0f172a' : '#fff';
            });
        }
        if (period !== null) {
            document.querySelectorAll('#lb-tabs button[data-period]').forEach(b => {
                b.style.color = b.getAttribute('data-period') === (period || 'all') ? '#fde047' : '#94a3b8';
            });
        }
        
        loadLeaderboardData(modal.dataset.courseCode, modal.dataset.mode || null, modal.dataset.period || null);
    };
    
    async function loadLeaderboardData(courseCode, mode, period) {
        let body = document.getElementById('lb-body');
        let info = document.getElementById('lb-info');
        if (!body) return;
        body.innerHTML = '<div style="color:#94a3b8;padding:20px;">Laddar...</div>';
        
        try {
            let data = await ArcadeAPI.getLeaderboard(courseCode, mode, period);
            let lb = data.leaderboard || [];
            
            if (info) info.textContent = `${data.total_rounds || 0} rundor spelade totalt`;
            
            if (lb.length === 0) {
                body.innerHTML = '<div style="color:#64748b;padding:30px;font-size:14px;">Inga resultat ännu. Var först att spela!</div>';
                return;
            }
            
            let myId = window.GolfAuth?.userId;
            
            let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
            
            // Header row
            html += '<div style="display:flex; align-items:center; color:#94a3b8; font-size:11px; text-transform:uppercase; font-weight:bold; padding:0 16px 8px 16px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:8px;">';
            html += '<div style="width:40px; text-align:center;">#</div>';
            html += '<div style="flex-grow:1; margin-left:12px;">Spelare</div>';
            html += '<div style="width:70px; text-align:right;">Score</div>';
            html += '<div style="width:80px; text-align:right;">vs Par</div>';
            html += '<div style="width:80px; text-align:right;">Datum</div>';
            html += '</div>';
            
            lb.forEach((r, i) => {
                let pos = i + 1;
                let isMe = r.player_id === myId;
                
                // Medals Logic
                let medalIcon = pos;
                let medalStyle = '';
                let rankColor = '#64748b';
                
                if (pos === 1) {
                    medalIcon = '🥇';
                    medalStyle = 'background: linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.0) 100%); border: 1px solid rgba(251,191,36,0.4); box-shadow: 0 0 15px rgba(251,191,36,0.1);';
                    rankColor = '#fbbf24';
                } else if (pos === 2) {
                    medalIcon = '🥈';
                    medalStyle = 'background: linear-gradient(90deg, rgba(203,213,225,0.1) 0%, rgba(203,213,225,0.0) 100%); border: 1px solid rgba(203,213,225,0.3);';
                    rankColor = '#cbd5e1';
                } else if (pos === 3) {
                    medalIcon = '🥉';
                    medalStyle = 'background: linear-gradient(90deg, rgba(180,83,9,0.1) 0%, rgba(180,83,9,0.0) 100%); border: 1px solid rgba(180,83,9,0.3);';
                    rankColor = '#b45309';
                } else {
                    medalStyle = 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);';
                }
                
                if (isMe && pos > 3) {
                    medalStyle = 'background: rgba(234,179,8,0.05); border: 1px solid rgba(234,179,8,0.2);';
                }

                let nameStyle = isMe ? 'color:#fde047; font-weight:900;' : 'color:#fff; font-weight:bold;';
                
                // Score formatting
                let parColor = r.score_vs_par < 0 ? '#4ade80' : r.score_vs_par > 0 ? '#f87171' : '#fff';
                let parBg = r.score_vs_par < 0 ? 'rgba(74, 222, 128, 0.15)' : r.score_vs_par > 0 ? 'rgba(248, 113, 113, 0.15)' : 'rgba(255, 255, 255, 0.1)';
                let parStr = r.score_vs_par === 0 ? 'E' : (r.score_vs_par > 0 ? '+' + r.score_vs_par : r.score_vs_par);
                
                let inputIcon = r.input_mode === 'LAUNCH_MONITOR' ? '🎮' : '🖱️';
                let dateStr = new Date(r.played_at).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });
                
                // Row HTML with staggered animation
                html += `<div style="display:flex; align-items:center; border-radius:12px; padding:12px 16px; ${medalStyle} opacity:0; animation: slideUpIn 0.4s ease forwards; animation-delay: ${i * 0.05}s; margin-bottom: 4px;">`;
                html += `<div style="width:40px; text-align:center; font-size:16px; font-weight:900; color:${rankColor};">${medalIcon}</div>`;
                html += `<div style="flex-grow:1; margin-left:12px; font-size:15px; ${nameStyle}">${r.player_name}${isMe ? ' <span style="font-size:10px; color:#fde047; opacity:0.8;">(DU)</span>' : ''}</div>`;
                html += `<div style="width:70px; text-align:right; color:#fff; font-size:16px; font-weight:900;">${r.total_score}</div>`;
                html += `<div style="width:80px; text-align:right;"><span style="background:${parBg}; color:${parColor}; padding:4px 10px; border-radius:12px; font-weight:bold; font-size:13px;">${parStr}</span></div>`;
                html += `<div style="width:80px; text-align:right; color:#64748b; font-size:12px; display:flex; flex-direction:column; align-items:flex-end;"><span>${dateStr}</span><span style="font-size:10px; opacity:0.6;">${inputIcon}</span></div>`;
                html += `</div>`;
            });
            html += '</div>';
            body.innerHTML = html;
        } catch (e) {
            body.innerHTML = '<div style="color:#ef4444;padding:20px;">Could not load leaderboard.</div>';
        }
    }
