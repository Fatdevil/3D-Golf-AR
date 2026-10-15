/**
 * GOLF OS CORE ENGINE
 * Headless State Machine and Rules Engine for Golf OS.
 * Decoupled from Three.js and DOM elements. Communicates via Events.
 */

const GameEvent = {
    STATE_CHANGED: 'GolfEvent_StateChanged',
    BALL_LANDED: 'GolfEvent_BallLanded',
    HOLED_OUT: 'GolfEvent_HoledOut',
    GIMME_AWARDED: 'GolfEvent_GimmeAwarded',
    PENALTY_APPLIED: 'GolfEvent_PenaltyApplied',
    OUT_OF_BOUNDS: 'GolfEvent_OutOfBounds',
    TURN_CHANGED: 'GolfEvent_TurnChanged',
    MATCH_COMPLETED: 'GolfEvent_MatchCompleted',
    BALL_STOPPED: 'GolfEvent_BallStopped',       // a normal stop: no penalty, not holed, no gimme or auto-putt
    HOLE_STARTED: 'GolfEvent_HoleStarted',       // a new hole is up: { holeIndex, par }
    ROUND_COMPLETED: 'GolfEvent_RoundCompleted'  // the last hole is done: { scorecard }
};

const GolfEngine = (function() {
    
    // --- STATE ---
    let state = {
        playState: 'IDLE', // 'IDLE', 'ROUND_IDLE', 'ROUND_FLYING'
        players: [],
        activePlayerIndex: 0,
        teeOrder: [],    // indices of the players in the order they tee off (the honour goes to the best score of the hole before)
        holeIndex: 0,
        holes: [],       // [{ par }] of the course being played (setCourse)
        isFlying: false,
        settings: {
            gimmeDist: 10, // ft
            autoPutt: 'TOUR_PRO',
            autoConcede: 99
        }
    };

    // --- EVENT DISPATCHER ---
    function emit(eventName, payload = {}) {
        const event = new CustomEvent(eventName, { detail: payload });
        window.dispatchEvent(event);
        console.log(`[GolfEngine] Emitted: ${eventName}`, payload);
    }

    // --- STATE MUTATORS ---
    function setPlayState(newState) {
        if (state.playState === newState) return;
        state.playState = newState;
        emit(GameEvent.STATE_CHANGED, { playState: state.playState });
    }

    function initPlayers(playerData) {
        state.players = playerData.map(sp => ({
            id: sp.id,
            name: sp.name,
            color: sp.color,
            strokes: 0,
            penaltyStrokes: 0,
            scores: [],
            totalScore: 0,
            holedOut: false,
            lie: { x: 0, y: 0, z: 0, type: 'TEE' }
        }));
        state.activePlayerIndex = 0;
        state.teeOrder = state.players.map((_, i) => i);
    }

    function getActivePlayer() {
        return state.players[state.activePlayerIndex];
    }

    // --- ROUND: holes, scores, the scorecard ---
    // holes: [{ par }]. The first hole is up and every player starts it fresh.
    function startRound(holes) {
        state.holes = (holes || []).map(h => ({ par: (h && h.par) || 4 }));
        state.holeIndex = 0;
        state.teeOrder = state.players.map((_, i) => i);
        state.activePlayerIndex = 0;
        state.players.forEach(p => { p.scores = []; p.totalScore = 0; _resetHole(p); });
        emit(GameEvent.HOLE_STARTED, { holeIndex: 0, par: holePar(0) });
    }

    function _resetHole(p) {
        p.strokes = 0; p.penaltyStrokes = 0; p.holedOut = false;
    }

    function holePar(i) {
        const h = state.holes[i === undefined ? state.holeIndex : i];
        return h ? h.par : 4;
    }

    // what the player has on the current hole: strokes plus penalty strokes
    function holeScore(p) { return p.strokes + p.penaltyStrokes; }

    // the hole is over for the player: its score goes on the scorecard
    function _finishHole(p) {
        p.holedOut = true;
        p.scores[state.holeIndex] = holeScore(p);
        p.totalScore = p.scores.reduce((a, b) => a + (b || 0), 0);
    }

    // The player who plays next: of those still playing the hole, the one whose ball is farthest from the flag. distanceOf(player) gives the
    // distance (metres). Equal distances (everyone on the tee) go by the tee order, so the honour decides.
    function nextPlayer(distanceOf) {
        const cands = state.teeOrder.map(i => state.players[i]).filter(p => !p.holedOut);
        if (cands.length === 0) return null;
        let best = cands[0], bd = distanceOf(best);
        for (let k = 1; k < cands.length; k++) {
            const d = distanceOf(cands[k]);
            if (d > bd + 0.05) { best = cands[k]; bd = d; }
        }
        const changed = state.players[state.activePlayerIndex] !== best;
        state.activePlayerIndex = state.players.indexOf(best);
        emit(GameEvent.TURN_CHANGED, { player: best, changed: changed });
        return best;
    }

    // the players still to play the hole
    function playersLeft() { return state.players.filter(p => !p.holedOut); }

    // the next hole, or null (and ROUND_COMPLETED) after the last one
    function nextHole() {
        if (state.holeIndex + 1 >= state.holes.length) {
            emit(GameEvent.ROUND_COMPLETED, { scorecard: scorecard(state.players[0]), scorecards: state.players.map(p => Object.assign({ player: p }, scorecard(p))) });
            return null;
        }
        // the honour: the best score of the hole just played tees off first, ties keep the order they had
        const h = state.holeIndex, pos = i => state.teeOrder.indexOf(i);
        const sc = i => (typeof state.players[i].scores[h] === 'number' ? state.players[i].scores[h] : Infinity);   // no score: last
        state.teeOrder = state.teeOrder.slice().sort((a, b) => (sc(a) === sc(b) ? 0 : (sc(a) < sc(b) ? -1 : 1)) || (pos(a) - pos(b)));
        state.holeIndex++;
        state.players.forEach(_resetHole);
        state.activePlayerIndex = state.teeOrder[0];
        emit(GameEvent.HOLE_STARTED, { holeIndex: state.holeIndex, par: holePar() });
        return state.holeIndex;
    }

    // [{ hole, par, score }] for every hole, and the totals of the holes that are done
    function scorecard(p) {
        const rows = state.holes.map((h, i) => ({ hole: i + 1, par: h.par, score: p.scores[i] === undefined ? null : p.scores[i] }));
        const done = rows.filter(r => r.score !== null);
        const score = done.reduce((a, r) => a + r.score, 0), par = done.reduce((a, r) => a + r.par, 0);
        return { rows: rows, score: score, par: par, vsPar: score - par, holesPlayed: done.length };
    }

    function updateSettings(newSettings) {
        if (newSettings) {
            state.settings = { ...state.settings, ...newSettings };
        }
    }

    // --- RULES ENGINE ---
    function handleShotResult(player, distanceToPinFt, isGreen, isFringe, isHoled, holePar, finalTerrain, penaltyEntryPoint, penaltyPrevLie) {
        // OB / Water Check
        if (isHoled === false) { // Don't penalize if it's magically in the hole
            if (finalTerrain === 'WATER') {
                player.penaltyStrokes++;
                emit(GameEvent.PENALTY_APPLIED, { player, type: 'WATER', entryPoint: penaltyEntryPoint, previousLie: penaltyPrevLie });
                return;
            }
            if (finalTerrain === 'OB') {
                player.penaltyStrokes++;
                emit(GameEvent.PENALTY_APPLIED, { player, type: 'OB', previousLie: penaltyPrevLie });
                return;
            }
        }
        
        // Auto Concede check
        let maxConcede = state.settings.autoConcede;
        let maxScore = holePar + maxConcede;
        let shouldConcede = (player.strokes + player.penaltyStrokes) >= maxScore && maxConcede !== 99;

        if (isHoled) {
            _finishHole(player);
            let total = player.strokes + player.penaltyStrokes;
            emit(GameEvent.HOLED_OUT, { 
                player, total, par: holePar, isHoleInOne: (total === 1), distanceToPinFt 
            });
            return;
        }

        if (shouldConcede) {
            player.strokes = maxScore - player.penaltyStrokes;
            _finishHole(player);
            emit(GameEvent.MATCH_COMPLETED, { player, reason: 'CONCEDE', maxScore });
            return;
        }

        // Gimme check
        if (isGreen && distanceToPinFt <= state.settings.gimmeDist) {
            player.strokes += 1;
            _finishHole(player);
            emit(GameEvent.GIMME_AWARDED, { player, distanceToPinFt, putts: 1, type: 'GIMME' });
            return;
        }

        // Auto-Putt check
        let mode = state.settings.autoPutt;
        if ((isGreen || isFringe) && mode !== 'OFF') {
            let putts = 2;
            if (mode === 'TOUR_PRO') {
                let p1 = Math.max(0, 100 - (distanceToPinFt * 6.2));
                let p3 = distanceToPinFt > 30 ? (distanceToPinFt - 30) * 0.15 : 0;
                let rand = Math.random() * 100;
                if (rand < p1) putts = 1;
                else if (rand > (100 - p3)) putts = 3;
                else putts = 2;
            } else {
                putts = distanceToPinFt < 10 ? 1 : (distanceToPinFt < 40 ? 2 : 3);
            }
            player.strokes += putts;
            _finishHole(player);
            emit(GameEvent.GIMME_AWARDED, { player, distanceToPinFt, putts, type: 'AUTO-PUTT' });
            return;
        }

        // Normal stop (not holed, no gimme)
        emit(GameEvent.BALL_STOPPED, { player, distanceToPinFt, isGreen, mode });
    }

    // --- PUBLIC API ---
    return {
        GameEvent,
        getState: () => state,
        setPlayState,
        initPlayers,
        getActivePlayer,
        nextPlayer,
        playersLeft,
        updateSettings,
        handleShotResult,
        startRound,
        nextHole,
        holePar,
        holeScore,
        scorecard,
        emit
    };

})();

window.GolfEngine = GolfEngine;
window.GameEvent = GameEvent;

// node (the tests): the engine without a browser, with a window that has dispatchEvent
if (typeof module !== 'undefined' && module.exports) module.exports = { GolfEngine, GameEvent };
