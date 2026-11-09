/**
 * The automatic graphics level (window.AutoQuality). The picture's options used to be set once at the start from the kind of device (a
 * computer or a phone), so a mid-range phone and a new one got the same. Now the frame time is measured in play and test mode and the
 * level steps down when frames are slow and back up when there is room, between five levels (1 the highest):
 *   1  colour grading (PostFX LOW), ground detail, the full pixel ratio, all the trees in the surroundings and the OB areas
 *   2  grading off
 *   3  pixel ratio at most 1.25
 *   4  ground detail off, the 2D trees thinned to 60 %
 *   5  pixel ratio 1, the 2D trees at 40 %
 * Bloom (PostFX HIGH) is never chosen by it: it is the player's. An option the player has set (golf_post_q, golf_ground_detail in
 * localStorage, as the buttons store them) is theirs and is left as it is; the other levers still move. The first start begins at level 1
 * on a computer and 2 on a phone (as before); after that at the level the device ended on (golf_auto_q).
 * How it decides (decide()): frames are gathered over WINDOW_MS (hitches over 250 ms, a tab switch or a load, are left out).
 *   slow:   the mean over SLOW_MS (under 45 frames a second): one step down at once
 *   smooth: the mean under SMOOTH_MS and nine frames in ten under 21 ms, three windows in a row: one step up, if that level has not
 *           failed lately; a level that is slow within two windows of stepping up to it is blocked for 1 minute, then 2, 4 ... minutes
 * After a change the next 1.5 s are not counted (shaders compile, the trees regrow). With vsync a frame never shows its room, so a step
 * up is a try, taken back when it does not hold.
 * Off (golf_auto_q_on = 0): nothing moves; the level stays where it is. Turning it on again forgets the player's own light & colour and
 * ground detail choices (the levers are its again).
 */
(function (root) {
    'use strict';
    const LEVELS = [
        { post: 'LOW', detail: true,  pixel: Infinity, veg: 1 },
        { post: 'OFF', detail: true,  pixel: Infinity, veg: 1 },
        { post: 'OFF', detail: true,  pixel: 1.25,     veg: 1 },
        { post: 'OFF', detail: false, pixel: 1.25,     veg: 0.6 },
        { post: 'OFF', detail: false, pixel: 1,        veg: 0.4 }
    ];
    const WINDOW_MS = 3000, SETTLE_MS = 1500, HITCH_MS = 250;
    const SLOW_MS = 1000 / 45, SMOOTH_MS = 1000 / 57, SMOOTH_P90 = 21, SMOOTH_WINDOWS = 3, BLOCK_MS = 60000;

    // the numbers of a window of frame times (ms), hitches left out
    function stats(dts) {
        const d = dts.filter(function (v) { return v > 0 && v < HITCH_MS; }).sort(function (a, b) { return a - b; });
        if (!d.length) return null;
        let sum = 0; d.forEach(function (v) { sum += v; });
        return { mean: sum / d.length, p90: d[Math.min(d.length - 1, Math.floor(d.length * 0.9))], n: d.length };
    }

    // the decision after a window: { level, smooth, blocked } in, the same out (pure: the unit test drives it)
    //   st.level      the current level (0-based)
    //   st.smooth     smooth windows in a row
    //   st.blocked    level -> { until, tries }
    //   st.upAt       the time of the last step up and the level left (to tell a failed try)
    function decide(st, s, now) {
        const out = { level: st.level, smooth: st.smooth, blocked: Object.assign({}, st.blocked), upAt: st.upAt, changed: false };
        if (!s || s.n < 20) return out;
        if (s.mean > SLOW_MS) {
            out.smooth = 0;
            if (out.level < LEVELS.length - 1) {
                // a step up that did not hold: that level is blocked for a while, longer each time
                if (out.upAt && now - out.upAt.t < WINDOW_MS * 2 + SETTLE_MS && out.upAt.to === out.level) {
                    const b = out.blocked[out.level] || { tries: 0 };
                    b.tries++; b.until = now + BLOCK_MS * Math.pow(2, b.tries - 1);
                    out.blocked[out.level] = b;
                }
                out.level++; out.changed = true; out.upAt = null;
            }
            return out;
        }
        if (s.mean <= SMOOTH_MS && s.p90 <= SMOOTH_P90) {
            out.smooth++;
            if (out.smooth >= SMOOTH_WINDOWS && out.level > 0) {
                const b = out.blocked[out.level - 1];
                if (!b || now >= b.until) { out.upAt = { t: now, to: out.level - 1 }; out.level--; out.changed = true; out.smooth = 0; }
            }
        } else out.smooth = 0;
        return out;
    }

    // ---- the levers ---------------------------------------------------------------------------------------------------------------------
    function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function store(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (e) { /* storage blocked */ } }
    // a lever the player has set is theirs
    function locked() { return { post: stored('golf_post_q') !== null, detail: stored('golf_ground_detail') !== null }; }

    let st = { level: 0, smooth: 0, blocked: {}, upAt: null };
    let on = true, started = false, dts = [], last = 0, windowStart = 0, settleUntil = 0, lastStats = null;

    function apply(level) {
        const L = LEVELS[level], lk = locked();
        if (!lk.post && root.PostFX && root.PostFX.level() !== L.post) root.PostFX.setLevel(L.post, false);
        if (!lk.detail && typeof root.setGroundDetail === 'function') root.setGroundDetail(L.detail, false);
        if (root._autoPixelCap !== L.pixel) {
            root._autoPixelCap = L.pixel;
            let r = null;
            try { r = renderer; } catch (e) { /* not made yet */ }
            if (r && typeof root.getCapPixelRatio === 'function') {
                const el = r.domElement, w = el.clientWidth || root.innerWidth, h = el.clientHeight || root.innerHeight;
                r.setPixelRatio(root.getCapPixelRatio());
                if (w > 0 && h > 0) r.setSize(w, h, false);
            }
        }
        if (root.SurroundVeg && root.SurroundVeg.setAutoScale) root.SurroundVeg.setAutoScale(L.veg);
        store('golf_auto_q', String(level + 1));
        syncUI();
    }

    function setLevel(level, now) {
        st.level = Math.max(0, Math.min(LEVELS.length - 1, level | 0));
        apply(st.level);
        settleUntil = (now || 0) + SETTLE_MS; dts = []; windowStart = 0;
    }

    function playing() {
        const m = typeof root.getAppMode === 'function' ? root.getAppMode() : 'PLAY';
        return (m === 'PLAY' || m === 'TEST') && !(typeof document !== 'undefined' && document.hidden) && root._courseLoading !== true;
    }

    // one frame's time; a window's worth is weighed by decide()
    function feed(dt, now) {
        if (!on || now < settleUntil) return;
        if (!windowStart) windowStart = now;
        dts.push(dt);
        if (now - windowStart < WINDOW_MS) return;
        lastStats = stats(dts);
        dts = []; windowStart = 0;
        const next = decide(st, lastStats, now);
        st = { level: next.level, smooth: next.smooth, blocked: next.blocked, upAt: next.upAt };
        if (next.changed) setLevel(st.level, now); else syncUI();
    }

    function frame(now) {
        if (last && playing()) feed(now - last, now);
        else if (!playing()) { dts = []; windowStart = 0; }
        last = now;
        root.requestAnimationFrame(frame);
    }

    // the start: the stored level, else 1 on a computer and 2 on a phone; on unless the player turned it off
    function start(isMobile) {
        on = stored('golf_auto_q_on') !== '0';
        const saved = parseInt(stored('golf_auto_q'), 10);
        setLevel(saved >= 1 && saved <= LEVELS.length ? saved - 1 : (isMobile ? 1 : 0), 0);
        if (!started && typeof root.requestAnimationFrame === 'function') { started = true; root.requestAnimationFrame(frame); }
    }

    // on / off (the panel's buttons). Turning it on hands the levers back to it: the player's own light & colour and ground detail
    // choices are forgotten (the option they set goes back to the level's)
    function setOn(v) {
        on = !!v; store('golf_auto_q_on', on ? null : '0');
        st.smooth = 0; st.blocked = {}; dts = []; windowStart = 0;
        if (on) { store('golf_post_q', null); store('golf_ground_detail', null); apply(st.level); }
        syncUI();
        return on;
    }

    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }
    function syncUI() {
        if (typeof document === 'undefined') return;
        ['0', '1'].forEach(function (v) {
            const b = document.getElementById('auto-q-' + v), act = (v === '1') === on;
            if (b) { b.style.background = act ? '#4ade80' : '#334155'; b.style.color = act ? '#0f172a' : '#94a3b8'; }
        });
        const el = document.getElementById('auto-q-status');
        if (el) {
            const fps = lastStats ? Math.round(1000 / lastStats.mean) : null, lk = locked();
            const mine = (lk.post ? [tr('auto_q_mine_post', 'ljus & färg')] : []).concat(lk.detail ? [tr('auto_q_mine_detail', 'markdetalj')] : []);
            el.textContent = tr('auto_q_level', 'Nivå') + ' ' + (st.level + 1) + '/' + LEVELS.length + (fps ? ' · ' + fps + ' fps' : '') +
                (on ? '' : ' · ' + tr('auto_q_off', 'låst')) + (mine.length ? ' · ' + tr('auto_q_mine', 'ditt val') + ': ' + mine.join(', ') : '');
        }
    }

    root.AutoQuality = {
        LEVELS: LEVELS, stats: stats, decide: decide,
        start: start, setOn: setOn, setLevel: function (l) { setLevel(l - 1, root.performance ? root.performance.now() : 0); return st.level + 1; },
        level: function () { return st.level + 1; }, on: function () { return on; }, locked: locked,
        feed: feed, lastStats: function () { return lastStats; }, syncUI: syncUI
    };
    root.setAutoQuality = function (v) { return setOn(v); };
})(typeof window !== 'undefined' ? window : globalThis);
