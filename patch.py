import sys

def patch_file():
    with open('arcade.html', 'r', encoding='utf-8') as f:
        html = f.read()

    start_sig = 'window.actuallyStartRound = function'
    end_sig = 'function renderScorecard()'

    if start_sig not in html or end_sig not in html:
        print('Failed to find signatures')
        sys.exit(1)

    start_idx = html.index(start_sig)
    end_idx = html.index(end_sig)

    new_block = """
    function getTeeOrder() {
        let players = window.players;
        let pIndices = players.map((p,i) => i);
        if (playingHoleIndex === 0) {
            // Hole 1: Distance based from hole for TEE ordering (or list order)
            return pIndices; // List order for hole 1 as per user spec
        }
        
        let prevHole = playingHoleIndex - 1;
        
        // Honours: Lowest scoreVsPar plays FIRST
        pIndices.sort((a,b) => {
            let aScore = players[a].scoreVsPar[prevHole] || 0;
            let bScore = players[b].scoreVsPar[prevHole] || 0;
            if (aScore !== bScore) return aScore - bScore; // Ascending (lägst först)
            return a - b; 
        });
        return pIndices;
    }
    
    function getNextPlayerIndex() {
        let players = window.players;
        let notHoledOut = players.map((p,i) => i).filter(i => !players[i].holedOut);
        if (notHoledOut.length === 0) return -1; // Alla är klara
        
        // Är alla kvar på tee? (Ingen har slagit slag)
        let allOnTee = notHoledOut.every(i => players[i].strokes === 0 && players[i].penaltyStrokes === 0);
        if (allOnTee) {
            let teeOrder = getTeeOrder();
            // Nästa från tee-order som inte slagit!
            let nextId = teeOrder.find(id => notHoledOut.includes(id) && players[id].strokes === 0);
            if(nextId !== undefined) return nextId;
        }
        
        // Ute på banan -> Furthest from hole goes first!
        let hole = courseHoles[playingHoleIndex];
        let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        notHoledOut.sort((a,b) => {
            let pA = players[a]; let pB = players[b];
            let dA = new THREE.Vector3(pA.lie.x, pA.lie.y, pA.lie.z).distanceTo(fv);
            let dB = new THREE.Vector3(pB.lie.x, pB.lie.y, pB.lie.z).distanceTo(fv);
            return dB - dA; // Descending (längst slår först)
        });
        return notHoledOut[0];
    }
    
    function teleportToHole(index) {
        let hole = courseHoles[index];
        let anyTee = hole ? (hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black) : null;
        if(!hole || !anyTee || !hole.flag) {
            alert("Hole " + (index+1) + " is not fully built! Needs both a Tee and a Flag.");
            return;
        }

        // Sätt initiala LIES & TEES för alla players
        window.players.forEach((p, idx) => {
            p.holedOut = false;
            p.strokes = 0;
            p.penaltyStrokes = 0;
            
            // Hitta deras valda tee (eller fallback)
            let activeT = hole.tees[p.tee] || hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black;
            p.teePosition = { x: activeT.x, y: activeT.y, z: activeT.z };
            p.lie = { x: activeT.x, y: activeT.y + 0.3, z: activeT.z }; // Startar på peggen!
        });

        let startPlayerIdx = getNextPlayerIndex();
        switchTurnTo(startPlayerIdx);
    }
    
    function switchTurnTo(idx) {
        if(idx === -1) {
            nextHole(); // Hela fältet är klara
            return;
        }
        
        window.activePlayerIndex = idx;
        let p = window.players[idx];
        
        // Visa ställningen för den aktiva spelaren
        updatePlayerBanner();
        
        // Återställ boll-statusen till idle för denna spelare
        window.ballLocked = false;
        if (playState !== 'ROUND_PUTTING') playState = 'ROUND_IDLE'; // eller behåll putting logik  
        
        // Ställ upp bollen på deras nuvarande lie
        ball.visible = true;
        ball.position.set(p.lie.x, p.lie.y, p.lie.z);
        ball.velocity = new THREE.Vector3(0,0,0);
        ball.angularVelocity = new THREE.Vector3(0,0,0);
        
        window.aimTarget = new THREE.Vector3();
        
        // Vänd kameran framåt
        let hole = courseHoles[playingHoleIndex];
        let fv = new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z);
        let dir = new THREE.Vector3().subVectors(fv, ball.position).normalize();
        
        let camDist = 5; let camHeight = 3;
        camera.position.copy(ball.position).add(new THREE.Vector3(-dir.x * camDist, camHeight, -dir.z * camDist)); 
        controls.target.copy(ball.position).add(new THREE.Vector3(dir.x * 20, 0, dir.z * 20)); 
        controls.enabled = true;
        controls.update();

        // Uppdatera Trackers
        let trck = document.getElementById('ball-tracker');
        if (trck) trck.style.display = 'none';

        // Flash turn message om vi har slagit slag och byter spelare
        let pop = document.getElementById('score-popup');
        pop.innerText = p.name.toUpperCase() + "'S TURN";
        pop.style.color = "#38bdf8";
        pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
        pop.style.opacity = '1';
        setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 2500);
    }
    
    window.evaluateNextTurn = function() {
        let p = window.players[window.activePlayerIndex];
        let hole = courseHoles[playingHoleIndex];
        let maxConcede = window.matchSettings ? window.matchSettings.autoConcede : 99;
        let maxScore = hole ? (hole.par || 4) + maxConcede : 99;
        
        // Spara deras position eftersom dom precis slagit bollen (vi antar bollen stannat)
        p.lie = {x: ball.position.x, y: ball.position.y, z: ball.position.z};

        if (p.strokes + p.penaltyStrokes >= maxScore && maxConcede !== 99 && !p.holedOut) {
            p.holedOut = true;
            p.strokes = maxScore;
            
            // Pop-up för concede!
            let pop = document.getElementById('score-popup');
            pop.innerText = "AUTO CONCEDE (" + maxScore + ")";
            pop.style.color = "#ef4444";
            pop.style.opacity = '1';
            setTimeout(() => { pop.style.opacity = '0'; pop.style.color = "#fcd34d"; }, 3000);
        }
        
        if (p.holedOut) {
            let total = p.strokes + p.penaltyStrokes;
            p.scores[playingHoleIndex] = total;
            p.scoreVsPar[playingHoleIndex] = total - (hole.par || 4);
            
            let flash = document.getElementById('pb-flash');
            if(flash) {
                let diff = total - (hole.par || 4);
                flash.innerText = logHoleScoreText(total, hole.par || 4);
                if(diff < 0) flash.style.color = '#4ade80';
                else if(diff > 0) flash.style.color = '#f87171';
                else flash.style.color = '#e2e8f0';
                flash.style.opacity = '1';
                setTimeout(() => { flash.style.opacity = '0'; }, 3000);
            }
        }
        
        // Hitta vem som ska slå näst
        let nextPlayer = getNextPlayerIndex();
        if(nextPlayer === -1) {
            setTimeout(nextHole, 2500);
        } else {
            // Om nextPlayer är samma spelare (pga farthest, eller ensam), uppdatera inte kameran direkt för man ser landningen
            // Om de hålade ut måste vi vänta så de ser bollen trilla i
            setTimeout(() => {
                switchTurnTo(nextPlayer);
            }, p.holedOut ? 2500 : 1000);
        }
    }

    window.actuallyStartRound = function() {
        document.getElementById('settings-modal').style.display = 'none';

        playState = 'ROUND_IDLE';
        playingHoleIndex = 0;
        
        window.players = window.setupPlayers.map(sp => ({
            id: sp.name + "_" + Math.random().toString(36).substring(7),
            name: sp.name,
            tee: sp.tee,
            strokes: 0,
            penaltyStrokes: 0,
            scores: Array(18).fill(null),
            scoreVsPar: Array(18).fill(null),
            lie: null,
            teePosition: null,
            holedOut: false,
            honours: false
        }));
        
        window.activePlayerIndex = 0;
        
        document.getElementById('play-tools').style.display = 'flex';
        document.getElementById('btn-start-round').style.display = 'none';
        document.getElementById('playing-hud').style.display = 'none'; 
        document.getElementById('player-banner').style.display = 'block'; 
        document.getElementById('player-banner').querySelector('#pb-name').style.display = 'inline-block'; // Visa Namn!
        
        teleportToHole(playingHoleIndex);
    };

    window.updatePlayerBanner = function() {
        let hole = courseHoles[playingHoleIndex];
        if(!hole || !window.players) return;
        
        let p = window.players[window.activePlayerIndex];
        if(!p) return;

        let totalVsPar = p.scoreVsPar.reduce((sum, s) => s !== null ? sum + s : sum, 0);
        
        let totalDisplay = "E";
        if (totalVsPar > 0) totalDisplay = "+" + totalVsPar;
        else if (totalVsPar < 0) totalDisplay = totalVsPar.toString();
        
        // Uppdatera Namnet & Score
        document.getElementById('pb-score').innerHTML = totalDisplay + " <span style='font-size:12px; color:#94a3b8;'>| " + p.name + "</span>";
        
        // Uppdatera Shot X
        let totalStrokes = p.strokes + p.penaltyStrokes;
        document.getElementById('pb-shot').innerText = "Shot " + (totalStrokes + 1);
        
        // Uppdatera Distans om vi har the pin
        if (hole.flag && ball.visible && p.lie) {
            let dist = new THREE.Vector3(p.lie.x, p.lie.y, p.lie.z).distanceTo(new THREE.Vector3(hole.flag.x, hole.flag.y, hole.flag.z)) * 1.09361;
            document.getElementById('pb-dist').innerText = dist.toFixed(1) + " YDS";
        }
    };
    
    function logHoleScoreText(strokes, par) {
        let diff = strokes - par;
        if(strokes === 1) return "HOLE IN ONE!";
        if(diff <= -3) return "ALBATROSS";
        if(diff === -2) return "EAGLE";
        if(diff === -1) return "BIRDIE";
        if(diff === 0) return "PAR";
        if(diff === 1) return "BOGEY";
        if(diff === 2) return "DOUBLE BOGEY";
        return diff >= 3 ? "+" + diff : "";
    }
    
    function nextHole() {
        startNextHole();
    }
    
    function startNextHole() {
        playingHoleIndex++;
        let activeT = courseHoles[playingHoleIndex] ? (courseHoles[playingHoleIndex].tees.yellow || courseHoles[playingHoleIndex].tees.white || courseHoles[playingHoleIndex].tees.red || courseHoles[playingHoleIndex].tees.black) : null;
        if(playingHoleIndex > 17 || !activeT) {
            let pop = document.getElementById('score-popup');
            pop.innerText = "ROUND COMPLETE!";
            pop.style.opacity = '1';
            pop.style.transform = 'translate(-50%, -60%) scale(1.0)';
            setTimeout(() => { pop.style.opacity = '0'; }, 3000);
            
            playState = 'IDLE';
            document.getElementById('player-banner').style.display = 'none';
            document.getElementById('play-tools').style.display = 'none';
            document.getElementById('btn-start-round').style.display = 'block';
            
            renderScorecard();
            document.getElementById('scorecard-modal').style.display = 'flex';
            return;
        }
        
        teleportToHole(playingHoleIndex);
    }
    """

    html = html[:start_idx] + new_block + html[end_idx:]
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print('Patched successfully')

if __name__ == '__main__':
    patch_file()
