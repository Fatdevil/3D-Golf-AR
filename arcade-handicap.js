// Handicap strokes per hole on the scorecard: shared by a single course and a collection of plates (no browser needed to test it).
(function (root) {
    'use strict';

    // The playing handicap is scaled to the holes played (a 3-hole plate gets 3/18 of the strokes). Whole laps of strokes go to every hole,
    // the remainder to the hardest holes (lowest stroke index) among the ones played.
    //   hcp: handicap index; siByHole: stroke index per hole (null when the course has none: the holes then rank in playing order);
    //   playableIdx: the holes (indexes) that count. Returns { holeIndex: strokes } for those holes.
    function strokesPerHole(hcp, siByHole, playableIdx) {
        const out = {};
        const n = playableIdx ? playableIdx.length : 0;
        if (!n || hcp === null || hcp === undefined) return out;
        const playingHcp = Math.round(hcp * Math.min(1, n / 18));
        const order = playableIdx.map(function (k) { return { k: k, si: siByHole ? (siByHole[k] || 99) : (k + 1) }; });
        order.sort(function (a, b) { return a.si - b.si || a.k - b.k; });
        const rank = {};
        order.forEach(function (o, r) { rank[o.k] = r + 1; });
        playableIdx.forEach(function (k) {
            out[k] = Math.floor(playingHcp / n) + (rank[k] <= (playingHcp % n) ? 1 : 0);
        });
        return out;
    }

    const api = { strokesPerHole: strokesPerHole };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.HandicapStrokes = api;
})(typeof window !== 'undefined' ? window : this);
