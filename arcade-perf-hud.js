/**
 * The frame-time meter (?fps=1 in the address turns it on and keeps it on, ?fps=0 turns it off): a small box at the top of the screen
 * for measuring on a real phone what the grass costs. It shows
 *   - the frame time in ms (mean over the last second) and the frames per second, and the slowest frame of the last 2 s
 *     (a stutter shows there, not in the mean)
 *   - the main picture's draw calls and triangles (arcade.html hands them over right after the main render: PerfHud.mainPass)
 *   - the drawing buffer (CSS size x the pixel ratio) and the grass state: the 3D grass level, the 2D grass on / off with its level,
 *     amount, height and the tufts it has built
 * The frame time is the time between two animation frames, so it holds everything the page does in a frame (JS, GPU waits).
 * It only reads: nothing in the game changes while it is on.
 */
(function () {
    'use strict';
    function enabled() {
        let q = null;
        try { q = new URLSearchParams(window.location.search).get('fps'); } catch (e) { /* no location */ }
        try {
            if (q === '1') localStorage.setItem('golf_fps', '1');
            else if (q === '0') localStorage.removeItem('golf_fps');
            return localStorage.getItem('golf_fps') === '1';
        } catch (e) { return q === '1'; }   // storage blocked: only while the address says so
    }

    const frames = [];          // { t, dt } of the last 2 s
    let last = 0, main = null, box = null, lastText = 0;

    // the numbers of a list of frame intervals (ms): mean, frames per second, slowest
    function stats(list) {
        if (!list.length) return null;
        let sum = 0, worst = 0;
        for (const d of list) { sum += d; if (d > worst) worst = d; }
        const mean = sum / list.length;
        return { mean: mean, fps: 1000 / mean, worst: worst };
    }

    function grassText() {
        const sh = window._terrainShells;
        if (!sh) return '';
        let cards = 'av';
        if (sh.cardsOn) {
            let n = 0;
            if (sh.cards) for (const c of sh.cards.values()) n += c.count || 0;
            const lvl = typeof sh.cardLevel === 'function' ? sh.cardLevel() : '?';
            cards = lvl + ' ' + Math.round((sh.cardAmount || 1) * 100) + '% h' + Math.round((sh.cardHeight || 1) * 100) + '% (' + n + ' tuvor)';
        }
        return '3D ' + (sh.quality || '?') + ' · 2D ' + cards;
    }

    function tick(now) {
        if (last) {
            frames.push({ t: now, dt: now - last });
            while (frames.length && now - frames[0].t > 2000) frames.shift();
        }
        last = now;
        if (box && now - lastText > 500) {
            lastText = now;
            const s1 = stats(frames.filter(function (f) { return now - f.t <= 1000; }).map(function (f) { return f.dt; }));
            const s2 = stats(frames.map(function (f) { return f.dt; }));
            const r = window._perfRenderer, cv = r && r.domElement;
            const buf = cv ? cv.width + '×' + cv.height + ' (' + (r.getPixelRatio ? r.getPixelRatio().toFixed(2) : '?') + 'x)' : '';
            box.textContent = (s1 ? s1.mean.toFixed(1) + ' ms · ' + s1.fps.toFixed(0) + ' fps · värst ' + s2.worst.toFixed(0) + ' ms' : '…') + '\n' +
                (main ? main.calls + ' anrop · ' + (main.triangles / 1000).toFixed(0) + 'k tris · ' + buf : '') + '\n' + grassText();
        }
        requestAnimationFrame(tick);
    }

    window.PerfHud = null;
    if (!enabled()) return;
    window.PerfHud = {
        // arcade.html calls this right after the main render: the renderer's numbers are then the main picture's alone
        mainPass: function (renderer) {
            window._perfRenderer = renderer;
            const i = renderer.info.render;
            main = { calls: i.calls, triangles: i.triangles };
        },
        stats: stats
    };
    function mount() {
        box = document.createElement('div');
        box.id = 'fps-meter';
        box.style.cssText = 'position:fixed; top:4px; left:50%; transform:translateX(-50%); z-index:100000; pointer-events:none; white-space:pre; ' +
            'font:600 10px/1.35 ui-monospace,Menlo,Consolas,monospace; color:#e2e8f0; background:rgba(2,6,23,0.72); padding:4px 8px; border-radius:6px; text-align:center;';
        document.body.appendChild(box);
        requestAnimationFrame(tick);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
