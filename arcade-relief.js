// Where a ball may be dropped when it is taken out of play (an unplayable ball, a water hazard): the checks of the drop, shared by the game and
// the tests (no browser needed to test it). Distances in metres; x/z are the scene's ground coordinates.
(function (root) {
    'use strict';

    const DROP_RADIUS = 2.5;      // two club lengths
    const LINE_TOLERANCE = 1.5;   // how far off the line a "back on the line" drop may be
    const LINE_MAX = 60;          // how far back on the line
    const PATH_STEP = 0.25;       // how finely the ground between the ball and the drop is looked at

    // The direction away from the hole, from the ball (unit vector), or null when the ball lies on the hole.
    function backLine(ref, flag) {
        if (!flag) return null;
        const vx = ref.x - flag.x, vz = ref.z - flag.z, len = Math.hypot(vx, vz);
        return len < 0.01 ? null : { x: vx / len, z: vz / len };
    }

    // o: { ref, flag, drop, surface, mode, mustBeIn, mustBeOutOf }
    //   mode 'lateral' (default): inside two club lengths of ref, not nearer the hole
    //   mode 'line': behind the ball on the line from the hole through it, outside the bunker (the relief that costs two strokes from a bunker)
    //   mustBeIn / mustBeOutOf: a surface type the drop has to be on / may not be on (SAND: the bunker)
//   surfaceAt(x, z): the surface type at a point; with mustBeIn the whole way from the ball to the drop has to be that surface (the same bunker)
    // Returns null when the drop is fine, else the reason.
    function checkDrop(o) {
        const ref = o.ref, flag = o.flag, drop = o.drop;
        if (o.mode === 'line') {
            const dir = backLine(ref, flag);
            if (!dir) return 'No line to the hole from here.';
            const rx = drop.x - ref.x, rz = drop.z - ref.z;
            const along = rx * dir.x + rz * dir.z, off = Math.abs(rx * dir.z - rz * dir.x);
            if (along < 0.5) return 'Must be behind the ball, on the line from the hole through the ball.';
            if (along > LINE_MAX) return 'Too far back! Max ' + LINE_MAX + ' m on the line.';
            if (off > LINE_TOLERANCE) return 'Must be on the line from the hole through the ball.';
        } else {
            if (Math.hypot(drop.x - ref.x, drop.z - ref.z) > DROP_RADIUS + 0.05) return 'Too far away! Max 2 club lengths (inside the blue circle).';
            if (flag && Math.hypot(drop.x - flag.x, drop.z - flag.z) < Math.hypot(ref.x - flag.x, ref.z - flag.z) - 0.5) return 'Cannot drop closer to the hole!';
        }
        const type = o.surface || null;
        if (type === 'WATER' || type === 'OB') return 'Cannot drop in ' + type + '!';
        if (o.mustBeIn && type !== o.mustBeIn) return 'Must stay in the bunker. (Or take two penalty strokes and drop outside it.)';
        // the same bunker, not the one next to it: the ground between the ball and the drop is all the same surface (a painted map has no bunker names)
        if (o.mustBeIn && o.surfaceAt) {
            const dx = drop.x - ref.x, dz = drop.z - ref.z, steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / PATH_STEP));
            for (let i = 1; i < steps; i++) {
                if (o.surfaceAt(ref.x + dx * i / steps, ref.z + dz * i / steps) !== o.mustBeIn) return 'Must stay in the same bunker as the ball.';
            }
        }
        if (o.mustBeOutOf && type === o.mustBeOutOf) return 'Must be outside the bunker.';
        return null;
    }

    const api = { DROP_RADIUS: DROP_RADIUS, LINE_TOLERANCE: LINE_TOLERANCE, LINE_MAX: LINE_MAX, backLine: backLine, checkDrop: checkDrop };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ReliefRules = api;
})(typeof window !== 'undefined' ? window : this);
