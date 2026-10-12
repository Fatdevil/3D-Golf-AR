// Aim maths for game mode (no THREE, no DOM): the shot goes along ball -> aimTarget (see executeArcadeShot), bearing 0 = -Z, positive = towards +X (right).
(function (root) {
    const RAD = Math.PI / 180;

    const AimMath = {
        // compass-style bearing from a to b on the ground plane, degrees
        bearingDeg: function (a, b) { return Math.atan2(b.x - a.x, -(b.z - a.z)) / RAD; },

        // how far the aim is turned from the flag line, signed degrees (+ right, - left), in (-180, 180]
        offsetFromFlagDeg: function (ball, aim, flag) {
            let d = AimMath.bearingDeg(ball, aim) - AimMath.bearingDeg(ball, flag);
            while (d > 180) d -= 360;
            while (d <= -180) d += 360;
            return d;
        },

        // the aim point turned by deg around the ball (+ right), same ground distance; y is left to the caller (it must be re-read from the terrain)
        rotateAim: function (ball, aim, deg) {
            const dx = aim.x - ball.x, dz = aim.z - ball.z;
            const dist = Math.hypot(dx, dz);
            const b = Math.atan2(dx, -dz) + deg * RAD;
            return { x: ball.x + Math.sin(b) * dist, z: ball.z - Math.cos(b) * dist };
        },

        // a hand-set aim survives the shot only while it is still a place to play towards: far enough from the ball and on the hole's side of it
        keepManualAim: function (ball, aim, flag, minDist) {
            minDist = minDist === undefined ? 10 : minDist;
            const ax = aim.x - ball.x, az = aim.z - ball.z;
            if (Math.hypot(ax, az) < minDist) return false;
            return ax * (flag.x - ball.x) + az * (flag.z - ball.z) > 0;
        },

        // a press and release that stayed put and was quick is a tap (aim), anything else is a camera drag
        isTap: function (down, up, maxMovePx, maxMs) {
            maxMovePx = maxMovePx === undefined ? 6 : maxMovePx;
            maxMs = maxMs === undefined ? 350 : maxMs;
            return Math.hypot(up.x - down.x, up.y - down.y) <= maxMovePx && (up.t - down.t) <= maxMs;
        },

        // "2.0° R", "0.5° L", "0.0°"
        formatOffset: function (deg) {
            const a = Math.abs(deg);
            return a.toFixed(1) + '°' + (a < 0.05 ? '' : (deg > 0 ? ' R' : ' L'));
        }
    };

    root.AimMath = AimMath;
    if (typeof module !== 'undefined' && module.exports) module.exports = AimMath;
})(typeof window !== 'undefined' ? window : globalThis);
