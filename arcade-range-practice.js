// ================================================================
//  RANGE PRACTICE — approach shots on the range: hit from a chosen distance to the pin of one of the range's greens.
//  The ball is put on the line from the pin back towards the Range Tee, at the chosen distance (moved around the pin when that spot
//  is in water or out of bounds), and goes back there after every shot. Each shot is scored against the pin: on the green or not,
//  how far from the pin, short or long, left or right. The lie is the Range Tee's mat, or the ground where the ball lies.
//
//  The test: a number of shots, each from a distance drawn from a band (spread over the band, in a shuffled order), each worth up to
//  100 points by how close to the pin it finishes; the score is their average, and the best one per range, test and unit is kept.
//  Every finished test is kept (per range, the newest HISTORY_MAX), so the panel can show how the scores of each test go over time.
//  The spread: where the shots at this green finished around the pin (dots, and the ellipse where about 2 in 3 of them finish) on the
//  green itself, and drawn small in the test's result.
//
//  window.RangePractice: the maths (targets, spot, result, per-distance stats, test plan, points, spread, plot) has no DOM and is tested in tests/test_range_practice.js;
//  in the page it also draws the bar at the top of the range (target green, distance, lie) and keeps the choice per range on this device.
//  arcade.html starts it with the range (start), stops it in the builder (stop), and does the game side through onRangePracticeChange
//  (where the ball goes, the camera, the aim, which hole's cup counts).
// ================================================================
(function (root) {
    const PRESETS = [50, 75, 100, 125, 150];   // in the player's unit
    const MIN = 10, MAX = 300;
    const TEST_SHOTS = [9, 18];
    const BANDS = [[30, 80], [50, 150], [100, 180]];   // the test's distances, in the player's unit
    const SPREAD_SD = 1.5;
    const HISTORY_MAX = 200;   // the ellipse: 1.5 standard deviations each way, about 2 in 3 shots of a round spread finish inside

    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

    // The range's greens: every hole with a flag (the Range Tee's own hole too), in hole order, with how far the pin is from the tee
    function targetsFrom(holes, tee) {
        const out = [];
        (holes || []).forEach(function (h, i) {
            if (!h || !h.flag || num(h.flag.x) === null || num(h.flag.z) === null) return;
            out.push({ hole: i, n: out.length + 1, x: h.flag.x, y: num(h.flag.y) !== null ? h.flag.y : 0, z: h.flag.z,
                       fromTee: tee ? Math.hypot(h.flag.x - tee.x, h.flag.z - tee.z) : null });
        });
        return out;
    }

    // Where to hit from: `dist` metres from the pin, on the line from the pin towards the tee, turned `angleDeg` around the pin
    // (+ turns it to the right as seen from the spot looking at the pin)
    function spotFor(pin, tee, dist, angleDeg) {
        let ux = tee.x - pin.x, uz = tee.z - pin.z, len = Math.hypot(ux, uz);
        if (len < 0.5) { const r = tee.rot || 0; ux = -Math.sin(r); uz = -Math.cos(r); len = 1; }   // the pin on the tee: straight back down the range
        ux /= len; uz /= len;
        const a = (angleDeg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const rx = ux * c - uz * s, rz = ux * s + uz * c;
        return { x: pin.x + rx * dist, z: pin.z + rz * dist };
    }

    // The spot, or the nearest one around the pin at the same distance that is not blocked (water, out of bounds): a few degrees either way,
    // all the way round the pin if need be (blocked: nowhere at this distance)
    function playableSpot(pin, tee, dist, blocked) {
        for (let k = 0; k <= 60; k++) {
            const tries = k === 0 ? [0] : (k === 60 ? [180] : [3 * k, -3 * k]);
            for (let j = 0; j < tries.length; j++) {
                const p = spotFor(pin, tee, dist, tries[j]);
                if (!blocked || !blocked(p.x, p.z)) return { x: p.x, z: p.z, angle: tries[j], moved: tries[j] !== 0 };
            }
        }
        const p = spotFor(pin, tee, dist, 0);
        return { x: p.x, z: p.z, angle: 0, moved: false, blocked: true };
    }

    // A shot against the pin: rest is where the ball stopped. along: past (+) or short (-) of the pin, along the line from the spot;
    // across: right (+) or left (-) of it; prox: metres from the pin
    function result(rest, pin, spot, onGreen) {
        const dx = rest.x - pin.x, dz = rest.z - pin.z;
        let ux = pin.x - spot.x, uz = pin.z - spot.z;
        const len = Math.hypot(ux, uz) || 1; ux /= len; uz /= len;
        return { prox: Math.hypot(dx, dz), along: dx * ux + dz * uz, across: dx * -uz + dz * ux, onGreen: !!onGreen };
    }

    // Per practised distance (the distance chosen, in metres): shots, greens hit, average distance from the pin
    function byDistance(shots) {
        const by = {};
        shots.forEach(function (s) {
            const p = s.practice;
            if (!p || num(p.dist) === null || num(p.prox) === null) return;
            const k = Math.round(p.dist);
            const b = by[k] || (by[k] = { dist: k, n: 0, greens: 0, proxSum: 0, best: null });
            b.n++; if (p.onGreen) b.greens++; b.proxSum += p.prox;
            if (b.best === null || p.prox < b.best) b.best = p.prox;
        });
        return Object.keys(by).map(function (k) { const b = by[k]; return { dist: b.dist, n: b.n, greens: b.greens, prox: b.proxSum / b.n, best: b.best }; })
            .sort(function (a, b) { return a.dist - b.dist; });
    }

    // The test's distances (in the unit of lo and hi, whole numbers): one from each of n equal parts of the band, in a shuffled order,
    // so a test covers the whole band. rand: () => [0, 1)
    function testPlan(n, lo, hi, rand) {
        rand = rand || Math.random;
        const out = [];
        for (let i = 0; i < n; i++) out.push(Math.round(lo + (hi - lo) * (i + rand()) / n));
        for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)), t = out[i]; out[i] = out[j]; out[j] = t; }
        return out;
    }
    // A test shot's points: 100 in the hole, else less the further from the pin it finishes, none from a fifth of the distance away
    // (from 100 m: 5 m away is 75 points, 10 m is 50, 20 m or more is 0)
    function points(prox, dist, holed) {
        if (holed) return 100;
        if (num(prox) === null || !(dist > 0)) return 0;
        return Math.round(100 * Math.max(0, 1 - prox / (0.2 * dist)));
    }
    // Where shots finish around the pin, in the frame of the shot (along: past the pin +, across: right +): the middle and the spread
    function spread(shots) {
        const pts = (shots || []).filter(function (p) { return p && num(p.along) !== null && num(p.across) !== null; });
        if (pts.length < 3) return null;
        const m = function (k) { return pts.reduce(function (a, p) { return a + p[k]; }, 0) / pts.length; };
        const sd = function (k, mean) { return Math.sqrt(pts.reduce(function (a, p) { return a + (p[k] - mean) * (p[k] - mean); }, 0) / (pts.length - 1)); };
        const along = m('along'), across = m('across');
        return { n: pts.length, along: along, across: across, sdAlong: sd('along', along), sdAcross: sd('across', across) };
    }
    // The shots around the pin as a small picture (SVG): the pin in the middle, past the pin up, right to the right, rings every
    // `ring` metres; each shot a dot (gold in the hole, green on the green, red off it), and the spread's ellipse
    function plotSVG(shots, opts) {
        opts = opts || {};
        const size = opts.size || 140, c = size / 2, pts = (shots || []).filter(function (p) { return p && num(p.along) !== null && num(p.across) !== null; });
        const far = pts.reduce(function (a, p) { return Math.max(a, Math.hypot(p.along, p.across)); }, 0);
        const ring = opts.ring || (far > 24 ? 10 : 5), reach = Math.max(2 * ring, Math.ceil(far * 1.1 / ring) * ring), k = (c - 6) / reach;
        let h = '<svg xmlns="http://www.w3.org/2000/svg" class="rp-plot" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img"' +
                (opts.label ? ' aria-label="' + String(opts.label).replace(/"/g, '&quot;') + '"' : '') + '>';
        h += '<rect width="' + size + '" height="' + size + '" rx="10" fill="#14532d" fill-opacity="0.55"/>';
        for (let r = ring; r <= reach; r += ring) h += '<circle cx="' + c + '" cy="' + c + '" r="' + (r * k).toFixed(1) + '" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>';
        const sp = spread(pts);
        if (sp) h += '<ellipse cx="' + (c + sp.across * k).toFixed(1) + '" cy="' + (c - sp.along * k).toFixed(1) + '" rx="' + Math.max(2, SPREAD_SD * sp.sdAcross * k).toFixed(1) +
                     '" ry="' + Math.max(2, SPREAD_SD * sp.sdAlong * k).toFixed(1) + '" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.8" stroke-dasharray="3 2"/>';
        h += '<line x1="' + c + '" y1="' + (c - 9) + '" x2="' + c + '" y2="' + c + '" stroke="#ffffff" stroke-width="1.5"/><path d="M' + c + ' ' + (c - 9) + 'l6 2.5-6 2.5z" fill="#ef4444"/>';
        pts.forEach(function (p, i) {
            const col = p.holed ? '#fbbf24' : (p.onGreen ? '#4ade80' : '#f87171'), last = i === pts.length - 1;
            h += '<circle class="rp-shot" cx="' + (c + p.across * k).toFixed(1) + '" cy="' + (c - p.along * k).toFixed(1) + '" r="' + (last ? 4.5 : 3.2) + '" fill="' + col + '" stroke="#0f172a" stroke-width="1"/>';
        });
        return h + '</svg>';
    }

    // Which test a result belongs to: number of shots, band and unit (a band in yards is another test than the same numbers in metres)
    function testKey(n, band, meters) { return n + '|' + band[0] + '-' + band[1] + '|' + (meters ? 'm' : 'yd'); }
    // The history after a finished test: the newest HISTORY_MAX kept
    function addResult(list, r) { return (list || []).concat([r]).slice(-HISTORY_MAX); }
    // How one test goes over time (results of that key, oldest first): how many, the latest and the one before, the best, the average
    // of the latest five, and the latest `keep` scores to draw. null when it was never played
    function trend(list, key, keep) {
        const rs = (list || []).filter(function (r) { return r && r.k === key && num(r.score) !== null; });
        if (!rs.length) return null;
        const sc = rs.map(function (r) { return r.score; }), last5 = sc.slice(-5);
        return { n: sc.length, last: sc[sc.length - 1], prev: sc.length > 1 ? sc[sc.length - 2] : null, best: Math.max.apply(null, sc),
                 avg5: Math.round(last5.reduce(function (a, v) { return a + v; }, 0) / last5.length), at: rs[rs.length - 1].t || 0, series: sc.slice(-(keep || 20)) };
    }
    // The tests played on a range, the latest played first
    function testsPlayed(list) {
        const seen = {}, out = [];
        for (let i = (list || []).length - 1; i >= 0; i--) { const k = list[i] && list[i].k; if (k && !seen[k]) { seen[k] = true; out.push(k); } }
        return out;
    }
    // The span of points a spark line shows: the scores with some room, at least 30 points tall, inside 0 to 100 (a fixed 0 to 100 would
    // draw a player's few points of progress as a flat line)
    function sparkRange(scores) {
        if (!scores || !scores.length) return [0, 100];
        let lo = Math.max(0, Math.min.apply(null, scores) - 8), hi = Math.min(100, Math.max.apply(null, scores) + 8);
        if (hi - lo < 30) { const mid = (lo + hi) / 2; lo = Math.max(0, mid - 15); hi = Math.min(100, lo + 30); lo = Math.max(0, hi - 30); }
        return [lo, hi];
    }
    // The scores of one test as a small line (SVG): one dot per test (the latest larger, each with its score as a tooltip), a dashed line at
    // the best (opts.best: the test's record, which may be older than the scores drawn), a faint line at each ten points. One series, so
    // no legend: the label beside it names the test
    function sparkSVG(scores, opts) {
        opts = opts || {};
        const n = (scores || []).length, best = num(opts.best) !== null ? opts.best : (n ? Math.max.apply(null, scores) : null);
        const W = opts.width || 240, H = opts.height || 56, pad = 6, r = sparkRange(best !== null ? (scores || []).concat([best]) : scores);
        const x = function (i) { return n < 2 ? W / 2 : pad + (W - 2 * pad) * i / (n - 1); }, y = function (v) { return pad + (H - 2 * pad) * (1 - (v - r[0]) / (r[1] - r[0])); };
        let h = '<svg xmlns="http://www.w3.org/2000/svg" class="rp-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img"' +
                (opts.label ? ' aria-label="' + String(opts.label).replace(/"/g, '&quot;') + '"' : '') + '>';
        for (let g = Math.ceil(r[0] / 10) * 10; g <= r[1]; g += 10) h += '<line x1="0" x2="' + W + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" stroke="#ffffff" stroke-opacity="0.06"/>';
        if (!n) return h + '</svg>';
        h += '<line class="rp-spark-best" x1="0" x2="' + W + '" y1="' + y(best).toFixed(1) + '" y2="' + y(best).toFixed(1) + '" stroke="#facc15" stroke-opacity="0.7" stroke-dasharray="3 3"/>';
        if (n > 1) h += '<polyline points="' + scores.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ') + '" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        const unitP = opts.unit || 'p';
        scores.forEach(function (v, i) {
            const last = i === n - 1;
            h += '<circle class="rp-spark-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + (last ? 5 : 4) + '" fill="' + (last ? '#ffffff' : '#38bdf8') +
                 '" stroke="#0f172a" stroke-width="2"><title>' + (opts.tip ? opts.tip(i, v) : v + ' ' + unitP) + '</title></circle>';
        });
        return h + '</svg>';
    }

    // The distance the player picks, in metres, from a value in their unit; held between MIN and MAX (in their unit)
    function toMetres(value, useMeters) { const v = Math.max(MIN, Math.min(MAX, Math.round(value))); return useMeters ? v : v * 0.9144; }
    function inUnit(metres, useMeters) { return Math.round(useMeters ? metres : metres / 0.9144); }

    const api = { PRESETS: PRESETS, MIN: MIN, MAX: MAX, targetsFrom: targetsFrom, spotFor: spotFor, playableSpot: playableSpot, result: result,
                  byDistance: byDistance, toMetres: toMetres, inUnit: inUnit, TEST_SHOTS: TEST_SHOTS, BANDS: BANDS, SPREAD_SD: SPREAD_SD,
                  testPlan: testPlan, points: points, spread: spread, plotSVG: plotSVG, HISTORY_MAX: HISTORY_MAX, testKey: testKey, addResult: addResult,
                  trend: trend, testsPlayed: testsPlayed, sparkRange: sparkRange, sparkSVG: sparkSVG };

    if (typeof document !== 'undefined') {
        const TXT = {
            sv: { open: '🎯 Inspel mot green', green: 'Green', mat: 'Matta', ground: 'Som marken', lie: 'Läge', close: 'Tillbaka till rangen',
                  none: 'Bygg en green med flagga för att öva inspel', onGreen: 'På green', miss: 'Miss', fromPin: 'från pinnen', short: 'kort', long: 'långt',
                  left: 'vänster', right: 'höger', holed: 'I hål!', moved: 'Flyttad åt sidan (vatten eller utanför banan)',
                  blocked: 'Inget spelbart läge på det avståndet (vatten eller utanför banan) – välj ett annat', later: 'Gäller från nästa slag',
                  test: '🏆 Test', testTitle: 'Inspeltest', shots: 'slag', start: 'Starta test', cancel: 'Avbryt', record: 'Rekord', noRecord: 'Inget rekord än',
                  shot: 'Slag', avg: 'snitt', p: 'p', result: 'Resultat', newRecord: '🏆 Nytt rekord!', again: 'Kör igen', done: 'Klar', greens: 'Green',
                  toPin: 'till pinnen', testBlocked: 'Testet avbröts: inget spelbart läge på avstånden', plot: 'Var slagen hamnade runt pinnen',
                  testHint: 'Slumpade avstånd · upp till 100 p per slag efter hur nära pinnen', bagAvg: 'snitt', plays: 'spelar', prev: 'Förra gången',
                  bagTip: 'Klubban i din bag vars snittlängd ligger närmast (launch monitor-slag från rangen)',
                  mic: 'Röststyrning: säg till exempel 75 meter, green två, matta eller starta test', locked: 'Låst under testet', noGreen: 'Ingen green',
                  opened: 'Inspel', closed: 'Tillbaka till rangen', cancelled: 'Testet avbrutet', noTest: 'Inget test pågår' },
            en: { open: '🎯 Approach to a green', green: 'Green', mat: 'Mat', ground: 'As it lies', lie: 'Lie', close: 'Back to the range',
                  none: 'Build a green with a flag to practise approaches', onGreen: 'On the green', miss: 'Missed', fromPin: 'from the pin', short: 'short', long: 'long',
                  left: 'left', right: 'right', holed: 'In the hole!', moved: 'Moved aside (water or out of bounds)',
                  blocked: 'Nowhere playable at that distance (water or out of bounds) – pick another', later: 'From the next shot',
                  test: '🏆 Test', testTitle: 'Approach test', shots: 'shots', start: 'Start test', cancel: 'Cancel', record: 'Best', noRecord: 'No best yet',
                  shot: 'Shot', avg: 'avg', p: 'pts', result: 'Score', newRecord: '🏆 New best!', again: 'Go again', done: 'Done', greens: 'Greens',
                  toPin: 'to the pin', testBlocked: 'Test stopped: nowhere playable at its distances', plot: 'Where the shots finished around the pin',
                  testHint: 'Random distances · up to 100 pts a shot by how close to the pin', bagAvg: 'avg', plays: 'plays', prev: 'Last time',
                  bagTip: 'The club in your bag whose average length is nearest (launch monitor shots from the range)',
                  mic: 'Voice control: say for example 75 metres, green two, mat or start test', locked: 'Locked during the test', noGreen: 'No green',
                  opened: 'Approach', closed: 'Back to the range', cancelled: 'Test cancelled', noTest: 'No test running' }
        };
        const t = function (k) { return ((root.getGolfLanguage && root.getGolfLanguage() === 'sv') ? TXT.sv : TXT.en)[k]; };
        const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
        const unit = function () { return root.useMeters ? 'm' : 'yd'; };
        const fmt = function (m, d) { return (root.useMeters ? m : m * 1.09361).toFixed(d === undefined ? 0 : d); };

        let ctx = null;   // { key, tee, holes(), scene }
        let state = { on: false, hole: null, dist: 100, lie: 'mat', testN: 9, testBand: 1 };   // dist in metres; the test last picked
        let bar = null, spot = null;
        let pending = false, noSpot = false;   // a change made while the ball flies (it waits for the shot to be scored); no playable spot
        // The test: null, or { phase: 'setup' | 'run' | 'done', n, band [lo, hi] and plan (in the unit it was started in, meters), i (the
        // shot being played), ready (the ball is on its spot: a shot already in the air when the test started does not count), hole, shots [{ dist, along, across, prox, onGreen, holed, points }], score, best (before it), record, stopped }
        let test = null;
        let marks = [], dotGeo = null;   // the spread on the green (3D)

        function storageKey() { return 'golf_range_practice_' + ctx.key; }
        function load() {
            try {
                const s = JSON.parse(localStorage.getItem(storageKey()) || 'null');
                if (s) state = { on: !!s.on, hole: s.hole, dist: num(s.dist) || 100, lie: s.lie === 'ground' ? 'ground' : 'mat',
                                 testN: TEST_SHOTS.indexOf(s.testN) >= 0 ? s.testN : 9, testBand: BANDS[s.testBand] ? s.testBand : 1 };
            } catch (e) { /* keep the default */ }
        }
        function save() { try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* this page only */ } }
        // The best test scores on this range: per number of shots, band and unit
        const bestKey = testKey;
        function history() { try { const h = JSON.parse(localStorage.getItem('golf_range_practice_tests_' + ctx.key) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
        function saveHistory(h) { try { localStorage.setItem('golf_range_practice_tests_' + ctx.key, JSON.stringify(h)); } catch (e) { /* this page only */ } }
        function bests() { try { return JSON.parse(localStorage.getItem('golf_range_practice_best_' + ctx.key) || '{}') || {}; } catch (e) { return {}; } }
        function saveBest(k, v) { const b = bests(); b[k] = v; try { localStorage.setItem('golf_range_practice_best_' + ctx.key, JSON.stringify(b)); } catch (e) { /* this page only */ } }
        function targets() { return ctx ? targetsFrom(ctx.holes(), ctx.tee) : []; }
        function current() {
            const list = targets();
            return list.find(function (g) { return g.hole === state.hole; }) || list[0] || null;
        }
        function running() { return !!(test && test.phase === 'run'); }

        // Works out the spot for the chosen green and distance and tells the game (arcade.html) where the ball goes now
        // (while the ball flies the shot keeps the spot it was hit from: the change waits, settle() makes it once the shot is scored)
        function apply() {
            if (root.rangeShotBusy && root.rangeShotBusy()) { pending = true; render(); return; }
            pending = false; noSpot = false;
            const g = state.on ? current() : null;
            if (!g) { spot = null; test = null; if (root.onRangePracticeChange) root.onRangePracticeChange(null); drawSpread(); render(); return; }
            state.hole = g.hole;
            const blocked = function (x, z) { const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null; return !!(s && (s.type === 'WATER' || s.type === 'OB')); };
            let p = playableSpot(g, ctx.tee, state.dist, blocked);
            if (p.blocked && running()) {
                // a test distance with nowhere to hit from: the nearest one in its band that has a spot takes its place
                const d0 = test.plan[test.i];
                for (let k = 1; k <= test.band[1] - test.band[0] && p.blocked; k++) {
                    [d0 - k, d0 + k].forEach(function (d) {
                        if (!p.blocked || d < test.band[0] || d > test.band[1]) return;
                        const q = playableSpot(g, ctx.tee, toMetres(d, test.meters), blocked);
                        if (!q.blocked) { p = q; test.plan[test.i] = d; state.dist = toMetres(d, test.meters); }
                    });
                }
                if (p.blocked) { test.stopped = true; finishTest(); }
            }
            if (p.blocked) { noSpot = !test || !test.stopped; spot = null; if (root.onRangePracticeChange) root.onRangePracticeChange(null); drawSpread(); render(); return; }   // back to the tee
            const s = root.localGetTerrainAt ? root.localGetTerrainAt(p.x, -p.z) : null;
            spot = { x: p.x, z: p.z, y: (s && num(s.z) !== null) ? s.z : g.y, moved: p.moved, pin: { x: g.x, y: g.y, z: g.z }, hole: g.hole, dist: state.dist, lie: state.lie };
            if (running()) test.ready = true;   // the ball is on the test's spot: the next shot counts
            if (root.onRangePracticeChange) root.onRangePracticeChange(spot);
            drawSpread();
            render();
        }

        // ── The test ──
        function startTest(n, band, plan) {
            const meters = !!root.useMeters, g = current();
            if (!g) return;
            test = { phase: 'run', n: n, band: band.slice(), meters: meters, plan: plan ? plan.slice(0, n) : testPlan(n, band[0], band[1]), i: 0, hole: g.hole, shots: [] };
            test.n = test.plan.length;
            state.dist = toMetres(test.plan[0], meters);
            save(); apply();
        }
        function finishTest() {
            const sum = test.shots.reduce(function (a, s) { return a + s.points; }, 0);
            test.phase = 'done';
            test.score = test.shots.length ? Math.round(sum / test.shots.length) : 0;
            const k = bestKey(test.n, test.band, test.meters), b = bests()[k];
            test.best = num(b);
            test.record = !test.stopped && (test.best === null || test.score > test.best);   // a stopped test is no record
            if (test.record) saveBest(k, test.score);
            if (!test.stopped && test.shots.length) {
                // kept for the history in the session panel (a stopped test is not a result); prev: the same test the time before
                const h = history(), tr = trend(h, k);
                test.prev = tr ? tr.last : null;
                const greens = test.shots.filter(function (s) { return s.onGreen || s.holed; }).length;
                const prox = test.shots.reduce(function (a, s) { return a + s.prox; }, 0) / test.shots.length;
                saveHistory(addResult(h, { t: Date.now(), k: k, score: test.score, greens: greens, shots: test.shots.length, prox: Math.round(prox * 10) / 10 }));
            }
        }

        // ── 3D: where the shots at this green finished around the pin (the test's, else those from this distance), and their ellipse ──
        function spreadShots() {
            if (!spot) return [];
            if (test && test.phase !== 'setup' && test.hole === spot.hole) return test.shots;
            const all = root.RangeSession && root.RangeSession.shots ? root.RangeSession.shots() : [];
            return all.map(function (s) { return s.practice; }).filter(function (p) {
                return p && p.hole === spot.hole && num(p.dist) !== null && Math.round(p.dist) === Math.round(spot.dist);
            }).slice(-30);
        }
        function clearSpread() {
            marks.forEach(function (m) { if (m.parent) m.parent.remove(m); if (m.material) m.material.dispose(); if (m.isLine) m.geometry.dispose(); });
            marks = [];
        }
        function drawSpread() {
            clearSpread();
            const THREE = root.THREE;
            if (!spot || !ctx || !ctx.scene || !THREE) return;
            const pin = spot.pin, len = Math.hypot(pin.x - spot.x, pin.z - spot.z) || 1, ux = (pin.x - spot.x) / len, uz = (pin.z - spot.z) / len;
            const at = function (along, across) { return { x: pin.x + ux * along - uz * across, z: pin.z + uz * along + ux * across }; };
            const ground = function (x, z) { const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null; return (s && num(s.z) !== null) ? s.z : pin.y; };
            if (!dotGeo) dotGeo = new THREE.CircleGeometry(0.5, 18);
            // each shot where it stopped (its along/across are against the spot it was hit from, which a test may have turned since),
            // seen from the spot now: the ellipse is then in the same frame as the dots
            const shots = spreadShots().map(function (p) {
                if (num(p.x) !== null && num(p.z) !== null) {
                    const dx = p.x - pin.x, dz = p.z - pin.z;
                    return { along: dx * ux + dz * uz, across: -dx * uz + dz * ux, onGreen: p.onGreen, holed: p.holed };
                }
                return p;
            });
            shots.forEach(function (p, i) {
                if (num(p.along) === null || num(p.across) === null) return;
                const q = at(p.along, p.across), last = i === shots.length - 1;
                const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: p.holed ? 0xfbbf24 : (p.onGreen ? 0x4ade80 : 0xf87171), transparent: true, opacity: last ? 1 : 0.85, depthWrite: false }));
                m.rotation.x = -Math.PI / 2;
                m.position.set(q.x, ground(q.x, q.z) + 0.07, q.z);
                if (last) m.scale.setScalar(1.6);
                m.renderOrder = 4;
                m.userData.rangePracticeDot = true;
                ctx.scene.add(m);
                marks.push(m);
            });
            const sp = spread(shots);
            if (sp) {
                const ra = Math.max(0.6, SPREAD_SD * sp.sdAlong), rc = Math.max(0.6, SPREAD_SD * sp.sdAcross), pts = [];
                for (let k = 0; k < 64; k++) {
                    const a = k / 64 * Math.PI * 2, q = at(sp.along + Math.cos(a) * ra, sp.across + Math.sin(a) * rc);
                    pts.push(new THREE.Vector3(q.x, ground(q.x, q.z) + 0.12, q.z));
                }
                const e = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
                e.renderOrder = 5;
                e.userData.rangePracticeSpread = true;
                ctx.scene.add(e);
                marks.push(e);
            }
        }

        // The club from the player's bag for this shot: the one whose average total is nearest to what it plays like (the distance to the
        // pin, less what wind and slope add once the shot plan for this spot is worked out). Empty without a known club in the bag
        function bagHtml() {
            if (!spot || !root.PlayerBag || !root.PlayerBag.suggestFor) return '';
            const d = Math.hypot(spot.pin.x - spot.x, spot.pin.z - spot.z), pl = root.shotPlan;
            let plays = d;
            if (pl && !pl.stale && num(pl.target) !== null && Math.abs(pl.target - d) < 1 && num(pl.wind) !== null && num(pl.terrain) !== null) plays = pl.target - pl.wind - pl.terrain;
            const sug = root.PlayerBag.suggestFor(plays);
            if (!sug) return '';
            return '<span class="rp-bag" title="' + esc(t('bagTip')) + '">🎒 <b>' + esc(sug.club) + '</b> · ' + esc(t('bagAvg')) + ' ' + fmt(sug.total) + ' ' + unit() +
                   (Math.abs(plays - d) >= 1 ? ' · ' + esc(t('plays')) + ' ' + fmt(plays) + ' ' + unit() : '') + '</span>';
        }

        function ensureBar() {
            if (bar) return bar;
            bar = document.createElement('div');
            bar.id = 'range-practice';
            bar.addEventListener('click', onClick);
            bar.addEventListener('change', onChange);
            ['pointerdown', 'pointerup', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) { bar.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
            document.body.appendChild(bar);
            return bar;
        }
        // the microphone (voice-commands.js): the same switch as the builder's, here so a player at the mat sees and reaches it
        function micHtml() {
            const V = root.VoiceCommands;
            if (!V || !V.supported) return '';
            const on = !!(V.listening && V.listening());
            return '<button class="rp-mic' + (on ? ' on' : '') + '" data-act="mic" aria-pressed="' + on + '" title="' + esc(t('mic')) + '" aria-label="' + esc(t('mic')) + '">🎙️</button>';
        }
        function chips(attr, values, selected, label) {
            return values.map(function (v, i) { return '<button ' + attr + '="' + i + '" class="' + (i === selected ? 'selected' : '') + '">' + esc(label(v)) + '</button>'; }).join('');
        }
        function render() {
            if (!bar || !ctx) return;
            const list = targets();
            let h = '';
            if (!list.length) h = '<div class="rp-hint">' + esc(t('none')) + '</div>';
            else if (!state.on) h = '<button class="rp-open" data-act="open">' + esc(t('open')) + '</button>' + micHtml();
            else {
                const g = current(), d = inUnit(state.dist, !!root.useMeters), locked = running();
                h += '<select class="rp-green" aria-label="' + esc(t('green')) + '"' + (test && test.phase !== 'done' ? ' disabled' : '') + '>' + list.map(function (x) {
                    return '<option value="' + x.hole + '"' + (x.hole === g.hole ? ' selected' : '') + '>' + esc(t('green')) + ' ' + x.n + (x.fromTee !== null ? ' · ' + fmt(x.fromTee) + ' ' + unit() : '') + '</option>';
                }).join('') + '</select>';
                if (test && test.phase === 'setup') {
                    const band = BANDS[state.testBand], best = bests()[bestKey(state.testN, band, !!root.useMeters)];
                    h += '<span class="rp-label">' + esc(t('testTitle')) + '</span>';
                    h += '<div class="rp-presets" role="group" aria-label="' + esc(t('shots')) + '">' + chips('data-tn', TEST_SHOTS, TEST_SHOTS.indexOf(state.testN), function (n) { return n + ' ' + t('shots'); }) + '</div>';
                    h += '<div class="rp-presets" role="group" aria-label="' + esc(unit()) + '">' + chips('data-tb', BANDS, state.testBand, function (b) { return b[0] + '–' + b[1] + ' ' + unit(); }) + '</div>';
                    h += '<button class="rp-start" data-act="start">' + esc(t('start')) + '</button><button class="rp-text" data-act="cancel">' + esc(t('cancel')) + '</button>';
                    h += '<button class="rp-close" data-act="close" title="' + esc(t('close')) + '" aria-label="' + esc(t('close')) + '">✕</button>';
                    h += '<div class="rp-sub">' + esc(t('testHint')) + ' · ' + esc(num(best) !== null ? t('record') + ' ' + best + ' ' + t('p') : t('noRecord')) + '</div>';
                } else if (test && test.phase === 'done') {
                    h += '<span class="rp-label">🏆 ' + esc(t('testTitle')) + '</span>';
                } else if (locked) {
                    const sum = test.shots.reduce(function (a, s) { return a + s.points; }, 0);
                    h += '<span class="rp-label">🏆 ' + esc(t('shot')) + ' ' + (test.i + 1) + '/' + test.n + '</span>';
                    h += '<span class="rp-big">' + d + '<span class="rp-unit">' + unit() + '</span></span>';
                    if (test.shots.length) h += '<span class="rp-sub-inline">' + esc(t('avg')) + ' ' + Math.round(sum / test.shots.length) + ' ' + esc(t('p')) + '</span>';
                    h += '<span class="rp-bag-slot">' + bagHtml() + '</span>';
                    h += '<button class="rp-text" data-act="cancel">' + esc(t('cancel')) + '</button>';
                } else {
                    h += '<div class="rp-dist"><button data-step="-5" aria-label="−5">−5</button><button data-step="-1" aria-label="−1">−1</button>' +
                         '<input type="number" class="rp-value" min="' + MIN + '" max="' + MAX + '" value="' + d + '" aria-label="' + esc(unit()) + '"><span class="rp-unit">' + unit() + '</span>' +
                         '<button data-step="1" aria-label="+1">+1</button><button data-step="5" aria-label="+5">+5</button></div>';
                    h += '<div class="rp-presets">' + PRESETS.map(function (p) { return '<button data-preset="' + p + '" class="' + (p === d ? 'selected' : '') + '">' + p + '</button>'; }).join('') + '</div>';
                    h += '<span class="rp-bag-slot">' + bagHtml() + '</span>';
                    h += '<button class="rp-test" data-act="test">' + esc(t('test')) + '</button>';
                }
                if (!test || test.phase === 'run') {
                    h += '<div class="rp-lie" role="group" aria-label="' + esc(t('lie')) + '"><button data-lie="mat" class="' + (state.lie === 'mat' ? 'selected' : '') + '"' + (locked ? ' disabled' : '') + '>' + esc(t('mat')) + '</button>' +
                         '<button data-lie="ground" class="' + (state.lie === 'ground' ? 'selected' : '') + '"' + (locked ? ' disabled' : '') + '>' + esc(t('ground')) + '</button></div>';
                }
                h += micHtml();
                if (!test || test.phase !== 'setup') h += '<button class="rp-close" data-act="close" title="' + esc(t('close')) + '" aria-label="' + esc(t('close')) + '">✕</button>';
                if (test && test.phase === 'done') {
                    const n = test.shots.length, greens = test.shots.filter(function (s) { return s.onGreen || s.holed; }).length;
                    const prox = n ? test.shots.reduce(function (a, s) { return a + s.prox; }, 0) / n : 0;
                    h += '<div class="rp-summary">' + plotSVG(test.shots, { label: t('plot'), size: 112 }) + '<div class="rp-sum-text">';
                    if (test.stopped) h += '<div class="rp-sub">' + esc(t('testBlocked')) + '</div>';
                    h += '<div class="rp-sum-title">' + esc(t('result')) + '</div><div class="rp-score">' + test.score + '<span>' + esc(t('p')) + '</span></div>';
                    if (test.record) h += '<div class="rp-sum-best rp-new">' + esc(t('newRecord')) + '</div>';
                    else if (test.best !== null) h += '<div class="rp-sum-best">' + esc(t('record') + ' ' + test.best + ' ' + t('p')) + '</div>';
                    if (num(test.prev) !== null) {
                        const dd = test.score - test.prev;
                        h += '<div class="rp-sub">' + esc(t('prev')) + ' ' + test.prev + ' ' + esc(t('p')) + ' <span class="' + (dd > 0 ? 'rp-up' : (dd < 0 ? 'rp-down' : '')) + '">(' + (dd > 0 ? '+' : (dd < 0 ? '−' : '±')) + Math.abs(dd) + ')</span></div>';
                    }
                    h += '<div class="rp-sub">' + esc(t('greens')) + ' ' + greens + '/' + n + ' · ' + esc(t('avg')) + ' ' + fmt(prox, 1) + ' ' + unit() + ' ' + esc(t('toPin')) + ' · ' +
                         test.band[0] + '–' + test.band[1] + ' ' + (test.meters ? 'm' : 'yd') + '</div>';
                    h += '<div class="rp-sum-actions"><button class="rp-start" data-act="again">' + esc(t('again')) + '</button><button class="rp-text" data-act="cancel">' + esc(t('done')) + '</button></div>';
                    h += '</div></div>';
                } else if (noSpot) h += '<div class="rp-note">' + esc(t('blocked')) + '</div>';
                else if (pending) h += '<div class="rp-note">' + esc(t('later')) + '</div>';
                else if (spot && spot.moved) h += '<div class="rp-note">' + esc(t('moved')) + '</div>';
            }
            bar.innerHTML = h;
            bar.classList.toggle('on', !!state.on && list.length > 0);
        }
        function setDist(metres) { state.dist = Math.max(toMetres(MIN, true), Math.min(MAX, metres)); save(); apply(); }
        function onClick(e) {
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            const unitM = root.useMeters ? 1 : 0.9144, act = b.dataset.act;
            if (act === 'open') {
                const g = current();
                state.on = true;
                if (g && (state.hole === null || state.hole === undefined)) state.hole = g.hole;
                save(); apply();
            } else if (act === 'close') { state.on = false; test = null; save(); apply(); }
            else if (act === 'mic') { if (root.VoiceCommands && root.VoiceCommands.toggle) root.VoiceCommands.toggle(); }
            else if (act === 'test') { test = { phase: 'setup' }; render(); }
            else if (act === 'start') startTest(state.testN, BANDS[state.testBand]);
            else if (act === 'again') startTest(test.n, test.band);
            else if (act === 'cancel') { test = null; apply(); }
            else if (b.dataset.tn !== undefined) { state.testN = TEST_SHOTS[+b.dataset.tn]; save(); render(); }
            else if (b.dataset.tb !== undefined) { state.testBand = +b.dataset.tb; save(); render(); }
            else if (b.dataset.step) setDist(toMetres(inUnit(state.dist, !!root.useMeters) + Number(b.dataset.step), !!root.useMeters));
            else if (b.dataset.preset) setDist(Number(b.dataset.preset) * unitM);
            else if (b.dataset.lie) { state.lie = b.dataset.lie; save(); apply(); }
        }
        function onChange(e) {
            const el = e.target;
            if (el.classList.contains('rp-green')) { state.hole = Number(el.value); if (test && test.phase === 'done') test = null; save(); apply(); }
            else if (el.classList.contains('rp-value')) { const v = Number(el.value); if (isFinite(v)) setDist(toMetres(v, !!root.useMeters)); }
        }

        api.start = function (opts) {
            if (!opts || !opts.tee) return;
            ctx = { key: String(opts.key || 'draft'), tee: { x: opts.tee.x, y: opts.tee.y, z: opts.tee.z, rot: opts.tee.rot || 0 }, holes: opts.holes || function () { return []; },
                    scene: opts.scene || null };
            test = null;
            load();
            ensureBar().style.display = '';
            apply();
            if (root.RangeSession && root.RangeSession.render) root.RangeSession.render();   // its Approach tab shows this range's tests
        };
        api.stop = function () {
            if (bar) bar.style.display = 'none';
            if (spot && root.onRangePracticeChange) root.onRangePracticeChange(null);
            clearSpread();
            spot = null; ctx = null; pending = false; noSpot = false; test = null;
        };
        api.active = function () { return !!spot; };
        api.spot = function () { return spot; };
        // The shot that just came to rest at `rest` (scene x/z), on the green or not: scored against the pin, with the text to show.
        // In a test it also gets its points, and the next distance waits for settle() (the shot is booked first)
        api.score = function (rest, onGreen, holed) {
            if (!spot) return null;
            const r = result(rest, spot.pin, spot, onGreen || holed);
            r.dist = spot.dist; r.holed = !!holed; r.hole = spot.hole; r.x = rest.x; r.z = rest.z;   // where it stopped (the spread on the green)
            const u = ' ' + unit();
            if (holed) r.text = '🎯 ' + t('holed');
            else {
                const where = [];
                if (Math.abs(r.along) >= 1) where.push(fmt(Math.abs(r.along)) + u + ' ' + (r.along < 0 ? t('short') : t('long')));
                if (Math.abs(r.across) >= 1) where.push(fmt(Math.abs(r.across)) + u + ' ' + (r.across < 0 ? t('left') : t('right')));
                r.text = (r.onGreen ? '✅ ' + t('onGreen') : '❌ ' + t('miss')) + ' · ' + fmt(r.prox, 1) + u + ' ' + t('fromPin') + (r.onGreen || !where.length ? '' : ' · ' + where.join(', '));
            }
            if (running() && test.ready && test.hole === spot.hole) {
                test.ready = false;
                r.points = points(r.prox, r.dist, r.holed);
                r.test = { shot: test.i + 1, of: test.n };
                r.text += ' · +' + r.points + ' ' + t('p');
                test.shots.push({ dist: r.dist, along: r.along, across: r.across, x: r.x, z: r.z, prox: r.prox, onGreen: r.onGreen, holed: r.holed, points: r.points });
                test.i++;
                if (test.i >= test.n) finishTest();
                else { state.dist = toMetres(test.plan[test.i], test.meters); save(); }
                pending = true;   // settle(): the next spot, the spread and the bar
            }
            return r;
        };
        // The shot is scored and booked: a change made during it (or the test's next distance) now, and the spread with the new shot
        api.settle = function () { if (!ctx) return; if (pending) apply(); else { drawSpread(); render(); } };
        api.render = render;   // after a language or unit change
        // the shot plan for the spot is worked out: the bag's club with what wind and slope do (only that bit, so typing is not disturbed)
        api.planReady = function () { const el = bar && bar.querySelector('.rp-bag-slot'); if (el) el.innerHTML = bagHtml(); };
        api.refresh = function () { if (ctx) apply(); };   // the greens may have changed
        api.getState = function () { return Object.assign({}, state); };
        api.set = function (s) { if (!ctx) return; Object.assign(state, s || {}); save(); apply(); };   // for tests and voice commands
        // A test from code (tests, voice): n shots in a band of the player's unit, or the given distances
        api.startTest = function (n, band, plan) { if (ctx && state.on) startTest(n, band || BANDS[1], plan); };
        api.test = function () { return test ? JSON.parse(JSON.stringify(test)) : null; };
        // Voice (voice-commands.js parseRange): runs a command and says what it did, { ok, text }. During a test the distance, the green and
        // the lie stay as the test has them
        api.voiceReady = function () { return !!ctx && !!bar && bar.style.display !== 'none'; };
        api.voice = function (cmd) {
            if (!ctx || !cmd) return null;
            const list = targets(), u = root.useMeters ? 'm' : 'yd';
            if (!list.length) return { ok: false, text: t('none') };
            const openIt = function () { if (!state.on) { state.on = true; if (state.hole === null || state.hole === undefined) state.hole = list[0].hole; } };
            const locked = running() && (cmd.action === 'dist' || cmd.action === 'green' || cmd.action === 'lie');
            if (locked) return { ok: false, text: t('locked') };
            switch (cmd.action) {
                case 'open': openIt(); save(); apply(); return { ok: true, text: t('opened') };
                case 'close': state.on = false; test = null; save(); apply(); return { ok: true, text: t('closed') };
                case 'dist': {
                    // in the unit said, else the player's
                    const unitSaid = cmd.unit || u, metres = unitSaid === 'm' ? cmd.value : cmd.value * 0.9144;
                    openIt(); if (test && test.phase !== 'run') test = null;
                    setDist(metres);
                    return { ok: true, text: '🎯 ' + inUnit(state.dist, !!root.useMeters) + ' ' + u };
                }
                case 'green': {
                    const g = list[cmd.value - 1];
                    if (!g) return { ok: false, text: t('noGreen') + ' ' + cmd.value };
                    openIt(); if (test && test.phase !== 'run') test = null;
                    state.hole = g.hole; save(); apply();
                    return { ok: true, text: t('green') + ' ' + g.n };
                }
                case 'lie': openIt(); state.lie = cmd.value === 'ground' ? 'ground' : 'mat'; save(); apply(); return { ok: true, text: t(state.lie === 'ground' ? 'ground' : 'mat') };
                case 'test': case 'again': {
                    if (running()) return { ok: false, text: t('locked') };
                    openIt();
                    const again = cmd.action === 'again' && test && test.phase === 'done';
                    const n = again ? test.n : state.testN, band = again ? test.band : BANDS[state.testBand];
                    startTest(n, band);
                    return { ok: true, text: '🏆 ' + n + ' ' + t('shots') + ' · ' + band[0] + '–' + band[1] + ' ' + u };
                }
                case 'cancel': if (!test) return { ok: false, text: t('noTest') }; test = null; apply(); return { ok: true, text: t('cancelled') };
            }
            return null;
        };
        // The tests played on this range, the latest played first (at most `max`): what each is, and how its scores go
        api.trends = function (max) {
            if (!ctx) return [];
            const h = history();
            return testsPlayed(h).slice(0, max || 3).map(function (k) {
                const m = /^(\d+)\|(\d+)-(\d+)\|(m|yd)$/.exec(k);
                return { key: k, label: m ? m[1] + ' ' + t('shots') + ' · ' + m[2] + '–' + m[3] + ' ' + m[4] : k, trend: trend(h, k) };
            });
        };
    }

    root.RangePractice = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
