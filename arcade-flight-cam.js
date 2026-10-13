// Flight camera for game mode (no THREE, no DOM): a camera plan made from the finished flight, so the camera can be directed instead of chasing.
//
// The whole flight is known before the ball moves (path of the physics engine), so the camera works like a broadcast director:
//   1. tee cam    the camera stays where it was at address and only pans, tilts and zooms with the ball (a quick punch-in at impact)
//   2. hand-over  from the apex the camera flies, along an arc, to a landing view: behind, above and a little to the side of the landing point,
//                 and is there before the ball comes down
//   3. landing    slow motion around touch-down (speedAt), the camera keeps its distance to the ball while it bounces and rolls
// Everything runs on time (path time for the plan, real dt for the smoothing), so it looks the same at 30 and 144 fps.
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

    // 'ground' (putts, rollers: the old chase camera stays), 'short' (chips, pitches), 'full'
    function profile(an) {
        if (an.apexH < 1.0 || an.tLand < 0.9) return 'ground';
        return an.carry < 35 ? 'short' : 'full';
    }

    const SLOW = { before: 0.55, rampIn: 0.25, hold: 0.45, speed: 0.4 };   // slow motion window around touch-down (path seconds)

    // The camera plan. camStart: where the camera is at address, ground(x, z): terrain height
    function plan(an, camStart, ground) {
        ground = ground || (() => 0);
        const prof = profile(an);
        const side = { x: -an.dir.z, y: 0, z: an.dir.x };   // to the right of the shot
        const short = prof === 'short';
        const D = short ? clamp(0.5 * an.carry, 7, 18) : clamp(0.38 * an.carry, 12, 90);      // how far before the landing point the camera ends up
        const Hg = short ? clamp(0.08 * an.carry + 2, 3, 5) : clamp(0.09 * an.carry + 2.5, 3.5, 16);
        const L = { x: an.land.x - an.dir.x * D + side.x * 0.28 * D, y: 0, z: an.land.z - an.dir.z * D + side.z * 0.28 * D };
        L.y = Math.max(an.land.y + Hg, ground(L.x, L.z) + 2.2);
        const H = cp(camStart);
        H.y = Math.max(H.y, ground(H.x, H.z) + 1.8);
        const tHandStart = clamp(an.tApex * (short ? 0.8 : 1.0), 0.25, an.tLand * 0.6);
        const tHandEnd = Math.min(an.tLand - 0.05, Math.max(tHandStart + 0.5, an.tLand - 0.30));
        const len = dist3(H, L);
        const slowMo = prof === 'full' && an.tLand >= 1.5;
        return { profile: prof, an: an, H: H, L: L, side: side, tHandStart: tHandStart, tHandEnd: tHandEnd,
                 arcA: clamp(0.12 * len, 0, 25), arcB: clamp(0.06 * len, 0, 12), ground: ground, slowMo: slowMo };
    }

    // Playback speed of the ball (1 = real time): slow motion around the landing of a full shot
    function speedAt(p, t) {
        if (!p || !p.slowMo) return 1;
        const t0 = p.an.tLand - SLOW.before, t1 = t0 + SLOW.rampIn, t2 = t1 + SLOW.hold, t3 = t2 + SLOW.rampIn;
        let k = 0;   // 0 = real time, 1 = full slow motion
        if (t > t0 && t < t1) k = smooth((t - t0) / SLOW.rampIn);
        else if (t >= t1 && t <= t2) k = 1;
        else if (t > t2 && t < t3) k = 1 - smooth((t - t2) / SLOW.rampIn);
        return 1 - (1 - SLOW.speed) * k;
    }

    // The camera rig for one shot. Returns null for flights the old chase camera should keep (putts, rollers)
    function create(path, camStart, opts) {
        opts = opts || {};
        if (!path || path.length < 3) return null;
        const an = analyze(path);
        const p = plan(an, camStart, opts.ground);
        if (p.profile === 'ground') return null;
        const fov0 = opts.fov || 60;
        return { plan: p, pos: cp(p.H), posVel: { x: 0, y: 0, z: 0 }, look: null, lookVel: { x: 0, y: 0, z: 0 }, fov: fov0, fovVel: 0, fov0: fov0,
                 d0: 0, prevBall: null, teeFovEnd: null, zoomMin: opts.zoomMin || 18 };
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
            const e = smoother((t - p.tHandStart) / (p.tHandEnd - p.tHandStart)), bulge = Math.sin(Math.PI * e);
            const q = lerp3(p.H, p.L, e);
            rig.pos = { x: q.x + p.side.x * p.arcA * bulge, y: q.y + p.arcB * bulge, z: q.z + p.side.z * p.arcA * bulge };
            rig.posVel = { x: 0, y: 0, z: 0 };
        } else {
            phase = 'landing';
            const off = { x: p.L.x - p.an.land.x, y: p.L.y - p.an.land.y, z: p.L.z - p.an.land.z };   // keep the landing view's offset to the ball
            damp3(rig.pos, { x: ball.x + off.x, y: ball.y + off.y, z: ball.z + off.z }, rig.posVel, 0.45, dt);
        }
        rig.pos.y = Math.max(rig.pos.y, p.ground(rig.pos.x, rig.pos.z) + 1.6);   // never into the ground

        // zoom
        const d = Math.max(0.5, dist3(ball, rig.pos));
        if (!rig.d0) rig.d0 = Math.max(3, d);
        let fovT;
        if (phase === 'tee') {
            fovT = clamp(rig.fov0 * Math.pow(rig.d0 / d, 0.6), rig.zoomMin, rig.fov0) * (1 - 0.06 * Math.exp(-t / 0.12));   // zoom with the distance, a punch-in at impact
            rig.teeFovEnd = fovT;
        } else if (phase === 'handover') {
            fovT = (rig.teeFovEnd || rig.fov0) + (rig.fov0 * 0.72 - (rig.teeFovEnd || rig.fov0)) * smooth((t - p.tHandStart) / (p.tHandEnd - p.tHandStart));
        } else fovT = rig.fov0 * 0.72;
        const fr = damp(rig.fov, fovT, rig.fovVel, 0.2, dt);
        rig.fov = fr.v; rig.fovVel = fr.vel;

        // look: at the ball, a little ahead of it, so that it sits a bit above the middle of the picture
        const half = d * Math.tan(rig.fov * Math.PI / 360);
        const lead = 0.07;
        const target = { x: ball.x + bv.x * lead, y: ball.y + bv.y * lead - 0.12 * half, z: ball.z + bv.z * lead };
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

    const FlightCam = { analyze: analyze, profile: profile, plan: plan, create: create, step: step, speedAt: speedAt, project: project, SLOW: SLOW,
                        damp: damp, smoother: smoother };
    root.FlightCam = FlightCam;
    if (typeof module !== 'undefined' && module.exports) module.exports = FlightCam;
})(typeof window !== 'undefined' ? window : globalThis);
