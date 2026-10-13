// Flight camera for game mode (no THREE, no DOM): a camera plan made from the finished flight, so the camera can be directed instead of chasing.
//
// The whole flight is known before the ball moves (path of the physics engine), so the camera works like a broadcast director:
//   1. tee cam    the camera stays where it was at address and only pans, tilts and zooms with the ball (a quick punch-in at impact)
//   2. hand-over  from the apex the camera flies, along an arc, to a landing view: behind, above and a little to the side of the landing point,
//                 and is there before the ball comes down
//   3. landing    slow motion around touch-down (speedAt), the camera keeps its distance to the ball while it bounces and rolls
// Everything runs on time (path time for the plan, real dt for the smoothing), so it looks the same at 30 and 144 fps.
// Four kinds of shot (profile): 'ground' (putts and rollers keep the old chase camera), 'short' (chips and pitches), 'approach' (full shots to a green)
// and 'long' (drives and long irons), each with its own landing view, zoom and slow motion. The camera keeps clear of trees (obstacles), and for an
// approach shot it keeps the pin in the picture after the landing.
// Coordinates: the path is in physics space {x, y, z = height}; everything this module takes and returns is THREE space (x, y = height, z).
(function (root) {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const smoother = (u) => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };   // smootherstep: speed 0 at both ends
    const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
    const cp = (a) => ({ x: a.x, y: a.y, z: a.z });
    const lerp3 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const UP = { x: 0, y: 1, z: 0 };

    // critically damped follow (frame-rate independent): value, velocity in/out
    function damp(cur, target, vel, smoothTime, dt) {
        const omega = 2 / Math.max(0.0001, smoothTime), x = omega * dt;
        const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const change = cur - target, temp = (vel + omega * change) * dt;
        return { v: target + (change + temp) * e, vel: (vel - omega * temp) * e };
    }
    function damp3(cur, target, vel, smoothTime, dt) {   // updates cur and vel in place
        for (const k of ['x', 'y', 'z']) { const r = damp(cur[k], target[k], vel[k], smoothTime, dt); cur[k] = r.v; vel[k] = r.vel; }
    }

    const toThree = (p) => ({ x: p.x, y: p.z, z: -p.y });

    // The shape of the flight: start, apex, landing (first contact with the ground), end, line of the shot, carry, times
    function analyze(path) {
        const n = path.length;
        let landI = n - 1;
        for (let i = 1; i < n; i++) if (path[i].phase !== 'flight') { landI = i; break; }
        let apexI = 0;
        for (let i = 0; i <= landI; i++) if (path[i].z > path[apexI].z) apexI = i;
        const start = toThree(path[0]), apex = toThree(path[apexI]), land = toThree(path[landI]), end = toThree(path[n - 1]);
        const dx = land.x - start.x, dz = land.z - start.z, carry = Math.hypot(dx, dz);
        let dir = { x: 0, y: 0, z: -1 };
        if (carry > 0.5) dir = { x: dx / carry, y: 0, z: dz / carry };
        else { const ex = end.x - start.x, ez = end.z - start.z, el = Math.hypot(ex, ez); if (el > 0.5) dir = { x: ex / el, y: 0, z: ez / el }; }
        return { start: start, apex: apex, land: land, end: end, dir: dir, carry: carry, apexH: apex.y - start.y,
                 tApex: path[apexI].time, tLand: path[landI].time, tEnd: path[n - 1].time };
    }

    // 'ground' (putts, rollers: the old chase camera stays), 'short' (chips, pitches), 'approach' (full shots to a green), 'long' (drives)
    function profile(an) {
        if (an.apexH < 1.0 || an.tLand < 0.9) return 'ground';
        if (an.carry < 35) return 'short';
        return an.carry < 140 ? 'approach' : 'long';
    }

    // What differs between the kinds of shot. D: how far before the landing point the camera ends up (share of the carry, min, max);
    // Hg: its height (share of the carry, constant, min, max); arc: how far the hand-over swings out to the side (share of the distance travelled);
    // zoomMin: the narrowest lens of the tee cam; slow: slow-motion speed at touch-down (null = none); hold: how long of the climb the tee cam stays
    const PROFILES = {
        short:    { D: [0.50, 0, 7, 18],  Hg: [0.08, 2.0, 3.0, 5],  arc: 0.08, zoomMin: 28, slow: null, hold: 0.8 },
        approach: { D: [0.32, 0, 12, 45], Hg: [0.10, 2.5, 3.5, 12], arc: 0.11, zoomMin: 22, slow: 0.35, hold: 1.0 },
        long:     { D: [0.38, 0, 12, 90], Hg: [0.09, 2.5, 3.5, 16], arc: 0.13, zoomMin: 17, slow: 0.45, hold: 1.0 }
    };

    const SLOW = { before: 0.55, rampIn: 0.25, hold: 0.45 };   // slow motion window around touch-down (path seconds); the speed comes with the profile
    const CLEAR = 1.6, TREE_CLEAR = 1.8, CAM_R = 1.5;           // metres: above the ground, above a treetop, and the reach around a tree
    const PIN_NEAR = 35;                                        // an approach whose pin is this close to the landing point keeps the pin in the picture

    // The lowest the camera may be at (x, z): above the ground and above any tree it is over (obstacles: { x, z, r, top }, top = absolute height)
    function clearAt(obstacles, ground, x, z) {
        let y = ground(x, z) + CLEAR;
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (Math.hypot(x - o.x, z - o.z) < o.r + CAM_R) y = Math.max(y, o.top + TREE_CLEAR);
        }
        return y;
    }

    // The camera plan. camStart: where the camera is at address. opts: { ground(x, z), obstacles: [{ x, z, r, top }], pin: { x, y, z } }
    function plan(an, camStart, opts) {
        opts = opts || {};
        const ground = opts.ground || (() => 0), obstacles = opts.obstacles || [];
        const prof = profile(an), P = PROFILES[prof] || PROFILES.approach;
        const side = { x: -an.dir.z, y: 0, z: an.dir.x };   // to the right of the shot
        const D = clamp(P.D[0] * an.carry + P.D[1], P.D[2], P.D[3]);
        const Hg = clamp(P.Hg[0] * an.carry + P.Hg[1], P.Hg[2], P.Hg[3]);
        const L = { x: an.land.x - an.dir.x * D + side.x * 0.28 * D, y: 0, z: an.land.z - an.dir.z * D + side.z * 0.28 * D };
        L.y = Math.max(an.land.y + Hg, clearAt(obstacles, ground, L.x, L.z) + 0.6);
        const H = cp(camStart);
        H.y = Math.max(H.y, ground(H.x, H.z) + 1.8, clearAt(obstacles, ground, H.x, H.z));
        const tHandStart = clamp(an.tApex * P.hold, 0.25, an.tLand * 0.6);
        const tHandEnd = Math.min(an.tLand - 0.05, Math.max(tHandStart + 0.5, an.tLand - 0.30));
        const len = dist3(H, L);
        const p = { profile: prof, an: an, H: H, L: L, side: side, tHandStart: tHandStart, tHandEnd: tHandEnd,
                    arcA: clamp(P.arc * len, 0, 25), arcB: clamp(0.06 * len, 0, 12), ground: ground, obstacles: obstacles,
                    slowMo: P.slow !== null && an.tLand >= 1.5, slowSpeed: P.slow === null ? 1 : P.slow, zoomMin: P.zoomMin,
                    pin: opts.pin || null, pinNear: false, lift: null };
        if (p.pin && prof === 'approach') p.pinNear = Math.hypot(p.pin.x - an.land.x, p.pin.z - an.land.z) <= PIN_NEAR;   // approach shots only: chips and drives keep their own look

        // trees on the way: a lift added to the height of the arc, worked out from sample points of the arc, widened and softened so that the camera
        // rises smoothly before a tree and not at it
        if (obstacles.length) {
            const N = 48, need = [];
            for (let i = 0; i <= N; i++) {
                const q = arcPoint(p, i / N, 0);
                need.push(Math.max(0, clearAt(obstacles, ground, q.x, q.z) - q.y));
            }
            let env = need.map((v, i) => { let m = 0; for (let k = -3; k <= 3; k++) m = Math.max(m, need[clamp(i + k, 0, N)]); return m; });
            for (let pass = 0; pass < 3; pass++) env = env.map((v, i) => (env[Math.max(0, i - 1)] + v + env[Math.min(N, i + 1)]) / 3);
            env = env.map((v, i) => Math.max(v, need[i] * 0.999));   // the blur must not lower a lift below what a tree needs
            env[0] = 0; env[N] = 0;
            p.lift = env;
        }
        return p;
    }

    // A point on the arc of the hand-over at e (0..1, already eased), without the lift for trees
    function arcPoint(p, e, lift) {
        const bulge = Math.sin(Math.PI * e), q = lerp3(p.H, p.L, e);
        return { x: q.x + p.side.x * p.arcA * bulge, y: q.y + p.arcB * bulge + (lift || 0), z: q.z + p.side.z * p.arcA * bulge };
    }
    function liftAt(p, e) {
        if (!p.lift) return 0;
        const N = p.lift.length - 1, k = clamp(e, 0, 1) * N, i = Math.min(N - 1, Math.floor(k)), f = k - i;
        return p.lift[i] + (p.lift[i + 1] - p.lift[i]) * f;
    }

    // Playback speed of the ball (1 = real time): slow motion around the landing of a full shot
    function speedAt(p, t) {
        if (!p || !p.slowMo) return 1;
        const t0 = p.an.tLand - SLOW.before, t1 = t0 + SLOW.rampIn, t2 = t1 + SLOW.hold, t3 = t2 + SLOW.rampIn;
        let k = 0;   // 0 = real time, 1 = full slow motion
        if (t > t0 && t < t1) k = smooth((t - t0) / SLOW.rampIn);
        else if (t >= t1 && t <= t2) k = 1;
        else if (t > t2 && t < t3) k = 1 - smooth((t - t2) / SLOW.rampIn);
        return 1 - (1 - p.slowSpeed) * k;
    }

    // The camera rig for one shot. Returns null for flights the old chase camera should keep (putts, rollers)
    function create(path, camStart, opts) {
        opts = opts || {};
        if (!path || path.length < 3) return null;
        const an = analyze(path);
        const p = plan(an, camStart, opts);
        if (p.profile === 'ground') return null;
        const fov0 = opts.fov || 60;
        return { plan: p, pos: cp(p.H), posVel: { x: 0, y: 0, z: 0 }, look: null, lookVel: { x: 0, y: 0, z: 0 }, fov: fov0, fovVel: 0, fov0: fov0,
                 d0: 0, prevBall: null, teeFovEnd: null, zoomMin: opts.zoomMin || p.zoomMin };
    }

    // Advance the rig by dt real seconds. t = path time of the ball (seconds), ball = ball position (THREE space). Returns { pos, look, fov, phase }
    function step(rig, dt, t, ball) {
        const p = rig.plan;
        dt = clamp(dt, 0.0005, 0.05);
        const bv = rig.prevBall ? { x: (ball.x - rig.prevBall.x) / dt, y: (ball.y - rig.prevBall.y) / dt, z: (ball.z - rig.prevBall.z) / dt } : { x: 0, y: 0, z: 0 };
        rig.prevBall = cp(ball);

        // position
        let phase;
        if (t < p.tHandStart) {
            phase = 'tee';
            rig.pos = cp(p.H);
        } else if (t < p.tHandEnd) {
            phase = 'handover';
            const e = smoother((t - p.tHandStart) / (p.tHandEnd - p.tHandStart));
            rig.pos = arcPoint(p, e, liftAt(p, e));
            rig.posVel = { x: 0, y: 0, z: 0 };
        } else {
            phase = 'landing';
            const off = { x: p.L.x - p.an.land.x, y: p.L.y - p.an.land.y, z: p.L.z - p.an.land.z };   // keep the landing view's offset to the ball
            const tgt = { x: ball.x + off.x, y: ball.y + off.y, z: ball.z + off.z };
            tgt.y = Math.max(tgt.y, p.obstacles.length ? clearAt(p.obstacles, p.ground, tgt.x, tgt.z) : tgt.y);
            damp3(rig.pos, tgt, rig.posVel, 0.45, dt);
        }
        rig.pos.y = Math.max(rig.pos.y, clearAt(p.obstacles, p.ground, rig.pos.x, rig.pos.z));   // never into the ground or a treetop

        // zoom
        const d = Math.max(0.5, dist3(ball, rig.pos));
        if (!rig.d0) rig.d0 = Math.max(3, d);
        const landFov = rig.fov0 * (p.pinNear ? 0.82 : 0.72);   // a little wider when the pin has to fit in too
        let fovT;
        if (phase === 'tee') {
            fovT = clamp(rig.fov0 * Math.pow(rig.d0 / d, 0.6), rig.zoomMin, rig.fov0) * (1 - 0.06 * Math.exp(-t / 0.12));   // zoom with the distance, a punch-in at impact
            rig.teeFovEnd = fovT;
        } else if (phase === 'handover') {
            fovT = (rig.teeFovEnd || rig.fov0) + (landFov - (rig.teeFovEnd || rig.fov0)) * smooth((t - p.tHandStart) / (p.tHandEnd - p.tHandStart));
        } else fovT = landFov;
        const fr = damp(rig.fov, fovT, rig.fovVel, 0.2, dt);
        rig.fov = fr.v; rig.fovVel = fr.vel;

        // look: at the ball, a little ahead of it, so that it sits a bit above the middle of the picture; after the landing of an approach
        // shot a share of the way to the pin, so that ball and pin are in the picture together
        const half = d * Math.tan(rig.fov * Math.PI / 360);
        const lead = 0.07;
        const target = { x: ball.x + bv.x * lead, y: ball.y + bv.y * lead - 0.12 * half, z: ball.z + bv.z * lead };
        if (phase === 'landing' && p.pinNear) {
            const w = 0.35;
            target.x += (p.pin.x - ball.x) * w; target.y += (p.pin.y - ball.y) * w; target.z += (p.pin.z - ball.z) * w;
        }
        if (!rig.look) rig.look = cp(target);
        else damp3(rig.look, target, rig.lookVel, phase === 'tee' ? 0.10 : phase === 'handover' ? 0.12 : 0.14, dt);
        return { pos: cp(rig.pos), look: cp(rig.look), fov: rig.fov, phase: phase };
    }

    // Where a point is on the screen (x, y in -1..1, z = distance in front of the camera) for a camera state, aspect = width / height
    function project(state, pt, aspect) {
        let f = { x: state.look.x - state.pos.x, y: state.look.y - state.pos.y, z: state.look.z - state.pos.z };
        const fl = Math.hypot(f.x, f.y, f.z) || 1; f = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
        let r = { x: f.y * UP.z - f.z * UP.y, y: f.z * UP.x - f.x * UP.z, z: f.x * UP.y - f.y * UP.x };   // right = forward x up
        const rl = Math.hypot(r.x, r.y, r.z) || 1; r = { x: r.x / rl, y: r.y / rl, z: r.z / rl };
        const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };   // up = right x forward
        const rel = { x: pt.x - state.pos.x, y: pt.y - state.pos.y, z: pt.z - state.pos.z };
        const zf = rel.x * f.x + rel.y * f.y + rel.z * f.z;
        const th = Math.tan(state.fov * Math.PI / 360);
        return { x: (rel.x * r.x + rel.y * r.y + rel.z * r.z) / (zf * th * aspect), y: (rel.x * u.x + rel.y * u.y + rel.z * u.z) / (zf * th), z: zf };
    }

    const FlightCam = { analyze: analyze, profile: profile, plan: plan, create: create, step: step, speedAt: speedAt, project: project, clearAt: clearAt,
                        PROFILES: PROFILES, SLOW: SLOW, damp: damp, smoother: smoother };
    root.FlightCam = FlightCam;
    if (typeof module !== 'undefined' && module.exports) module.exports = FlightCam;
})(typeof window !== 'undefined' ? window : globalThis);
