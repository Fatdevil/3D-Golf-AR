// ================================================================
//  RANGE SESSION — the shots of a driving-range session: list, per-club averages (gapping), landing dots and a dispersion
//  ellipse on the range, CSV export.
//
//  Distances are kept in metres; the panel shows them in the player's unit (window.useMeters).
//  arcade.html calls start() when a range is played (test mode), stop() in the builder, and record() when a shot has come
//  to rest (before the ball goes back to the tee). The club of a launch-monitor shot is the one picked in the panel (a launch
//  monitor does not send it); a swing or typed shot takes the swing engine's club unless one is picked in the panel.
//  The maths (averages, spread, CSV, range frame) has no DOM and is tested in tests/test_range_session.js.
// ================================================================
(function (root) {
    // a full bag; the swing engine knows fewer clubs
    const CLUBS = ['Dr', '3W', '5W', 'Hy', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];
    const FROM_SWING = { DRIVER: 'Dr', W3: '3W', I5: '5i', I7: '7i', I9: '9i', PW: 'PW', SW: 'SW', LW: 'LW' };
    const MAX_SHOTS = 500;

    function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
    // sample standard deviation (0 for fewer than two values)
    function sd(a) {
        if (a.length < 2) return 0;
        const m = mean(a);
        return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1));
    }
    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

    // A landing point in the range's own frame: metres down the range (along) and to the right of its centre line (across).
    // The range points along (sin rot, cos rot) in scene x/z; right of that is (-cos rot, sin rot).
    function rangeFrame(tee, x, z) {
        const dx = x - tee.x, dz = z - tee.z, r = tee.rot || 0;
        return { along: dx * Math.sin(r) + dz * Math.cos(r), across: -dx * Math.cos(r) + dz * Math.sin(r) };
    }
    function fromRangeFrame(tee, along, across) {
        const r = tee.rot || 0;
        return { x: tee.x + Math.sin(r) * along - Math.cos(r) * across, z: tee.z + Math.cos(r) * along + Math.sin(r) * across };
    }

    // Per club, in bag order (clubs without shots left out, unknown club last): averages and spread of carry, total and offline
    function clubStats(shots) {
        const by = {};
        shots.forEach(function (s) { const c = s.club || '?'; (by[c] = by[c] || []).push(s); });
        const order = CLUBS.concat(Object.keys(by).filter(function (c) { return CLUBS.indexOf(c) < 0; }).sort());
        return order.filter(function (c) { return by[c]; }).map(function (c) {
            const list = by[c], pick = function (k) { return list.map(function (s) { return s[k]; }).filter(function (v) { return num(v) !== null; }); };
            const carry = pick('carry'), total = pick('total'), off = pick('offline'), bs = pick('ballSpeed');
            return { club: c, n: list.length, carry: mean(carry), carrySd: sd(carry), total: mean(total), offline: mean(off), offlineSd: sd(off),
                     ballSpeed: bs.length ? mean(bs) : null, longest: carry.length ? Math.max.apply(null, carry) : 0 };
        });
    }

    // The middle of a club's landing points and how widely they spread, in the range frame (needs the tee the shots were hit from)
    function dispersion(shots, tee) {
        const pts = shots.filter(function (s) { return num(s.landX) !== null && num(s.landZ) !== null; }).map(function (s) { return rangeFrame(tee, s.landX, s.landZ); });
        if (pts.length < 3) return null;
        const al = pts.map(function (p) { return p.along; }), ac = pts.map(function (p) { return p.across; });
        return { n: pts.length, along: mean(al), across: mean(ac), sdAlong: sd(al), sdAcross: sd(ac) };
    }

    // The shots that tell how far a club goes: approach practice shots (to a pin, often a part swing, from a spot other than the tee) are
    // listed with the others but left out of the club averages, the aim billboard's average and the ellipse, as they are out of the bag
    function fullSwings(shots) { return shots.filter(function (s) { return !s.practice; }); }

    function toCSV(shots, useMeters) {
        const k = useMeters ? 1 : 1.09361, u = useMeters ? 'm' : 'yd';
        const f = function (v, d) { return num(v) === null ? '' : v.toFixed(d); };
        const head = ['#', 'time', 'club', 'source', 'carry_' + u, 'total_' + u, 'offline_' + u + '(+R)', 'apex_' + u, 'ball_speed_mph', 'club_speed_mph', 'launch_deg', 'start_line_deg', 'spin_rpm', 'spin_axis_deg'];
        const rows = shots.map(function (s, i) {
            return [i + 1, s.t ? new Date(s.t).toISOString() : '', s.club || '', s.source || '',
                f(num(s.carry) !== null ? s.carry * k : null, 1), f(num(s.total) !== null ? s.total * k : null, 1), f(num(s.offline) !== null ? s.offline * k : null, 1),
                f(num(s.apex) !== null ? s.apex * k : null, 1), f(s.ballSpeed, 1), f(s.clubSpeed, 1), f(s.launch, 1), f(s.hla, 1), f(s.spin, 0), f(s.spinAxis, 1)].join(',');
        });
        return head.join(',') + '\n' + rows.join('\n') + (rows.length ? '\n' : '');
    }

    const api = { CLUBS: CLUBS, FROM_SWING: FROM_SWING, MAX_SHOTS: MAX_SHOTS, mean: mean, sd: sd, rangeFrame: rangeFrame, fromRangeFrame: fromRangeFrame,
                  clubStats: clubStats, dispersion: dispersion, fullSwings: fullSwings, toCSV: toCSV };

    // ── In the page: the panel, the dots and the ellipse ──
    if (typeof document !== 'undefined') {
        const TXT = {
            sv: { title: 'Session', shots: 'slag', pick: 'Vilken klubba slår du?', tabShots: 'Slag', tabClubs: 'Klubbor', club: 'Klubba', carry: 'Carry', total: 'Total',
                  offline: 'Offline', n: 'Antal', spread: 'Spridning', empty: 'Slå ett slag så hamnar det här.', csv: 'Exportera CSV', clear: 'Ny session',
                  confirmClear: 'Börja en ny session? Slagen i den här sessionen tas bort.', ellipse: 'Ellipsen visar var ungefär 2 av 3 slag med {c} landar.',
                  lmHint: 'Launch monitorn skickar inte klubban: välj den här.',
                  bagNote: 'Dina launch monitor-slag sparas i din bag (senaste 40 per klubba) och styr klubbförslaget på banan från 3 slag.',
                  tabApproach: 'Inspel', distance: 'Avstånd', greens: 'Green', toPin: 'Till pinne', best: 'Bäst', toPinNote: 'Snitt och bästa avstånd till pinnen per övat avstånd',
                  tests: 'Inspeltest', last: 'Senast', avg5: 'Snitt 5 senaste', played: 'test', testTip: 'Test {i}: {v} p', rateRange: 'Rangen',
                  board: 'Topplista på rangen', you: 'Du', of: 'av', pts: 'p' },
            en: { title: 'Session', shots: 'shots', pick: 'Which club are you hitting?', tabShots: 'Shots', tabClubs: 'Clubs', club: 'Club', carry: 'Carry', total: 'Total',
                  offline: 'Offline', n: 'Shots', spread: 'Spread', empty: 'Hit a shot and it shows up here.', csv: 'Export CSV', clear: 'New session',
                  confirmClear: 'Start a new session? The shots of this session are removed.', ellipse: 'The ellipse shows where about 2 in 3 shots with {c} land.',
                  lmHint: 'The launch monitor does not send the club: pick it here.',
                  bagNote: 'Your launch monitor shots go to your bag (the last 40 per club) and set the club suggestion on a course from 3 shots.',
                  tabApproach: 'Approach', distance: 'Distance', greens: 'Greens', toPin: 'To pin', best: 'Best', toPinNote: 'Average and best distance to the pin per practised distance',
                  tests: 'Approach tests', last: 'Latest', avg5: 'Avg of last 5', played: 'tests', testTip: 'Test {i}: {v} pts', rateRange: 'The range',
                  board: 'Leaderboard on this range', you: 'You', of: 'of', pts: 'pts' }
        };
        const COLORS = { Dr: 0xef4444, '3W': 0xf97316, '5W': 0xf59e0b, Hy: 0xeab308, '4i': 0x84cc16, '5i': 0x22c55e, '6i': 0x10b981, '7i': 0x14b8a6,
                         '8i': 0x06b6d4, '9i': 0x0ea5e9, PW: 0x3b82f6, GW: 0x6366f1, SW: 0x8b5cf6, LW: 0xd946ef };
        const hex = function (c) { return '#' + ((COLORS[c] === undefined ? 0x94a3b8 : COLORS[c]) >>> 0).toString(16).padStart(6, '0'); };
        const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };

        let state = { key: null, shots: [], club: null, tab: 'shots', open: true };
        let ctx = null;              // { scene, tee }
        let panel = null, dots = [], ellipse = null, dotGeo = null;
        let marksShown = true;   // off while practising approaches (the green has its own spread then)

        const t = function (k) { const L = (root.getGolfLanguage && root.getGolfLanguage() === 'sv') ? TXT.sv : TXT.en; return L[k]; };
        const dist = function (m) { return num(m) === null ? '–' : (root.useMeters ? m : m * 1.09361).toFixed(0); };
        const unit = function () { return root.useMeters ? 'm' : 'yd'; };
        const side0 = function (m) { return num(m) === null ? '–' : (root.useMeters ? m : m * 1.09361).toFixed(1); };
        const side = function (m) { if (num(m) === null) return '–'; const a = Math.abs(root.useMeters ? m : m * 1.09361); return a.toFixed(1) + (a < 0.05 ? '' : (m > 0 ? ' R' : ' L')); };

        function storageKey() { return 'golf_range_session_' + state.key; }
        function load() {
            try {
                const s = JSON.parse(localStorage.getItem(storageKey()) || 'null');
                state.shots = (s && Array.isArray(s.shots)) ? s.shots.slice(-MAX_SHOTS) : [];
                state.club = (s && typeof s.club === 'string') ? s.club : null;
            } catch (e) { state.shots = []; state.club = null; }
            // folded by default on a phone (the range would be covered); what the player chose last time wins
            const phone = !!(window.matchMedia && window.matchMedia('(max-width: 520px)').matches);
            try { const v = localStorage.getItem('golf_range_session_open'); state.open = v === null ? !phone : v !== '0'; } catch (e) { state.open = !phone; }
        }
        function save() {
            try { localStorage.setItem(storageKey(), JSON.stringify({ shots: state.shots, club: state.club })); } catch (e) { /* private mode or full: the session lives on this page */ }
        }

        function ensurePanel() {
            if (panel) return panel;
            panel = document.createElement('div');
            panel.id = 'range-session';
            panel.addEventListener('click', onClick);
            panel.addEventListener('change', onChange);
            // the panel's own clicks and keys are not the game's (aim taps, swing keys)
            ['pointerdown', 'pointerup', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) { panel.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
            document.body.appendChild(panel);
            return panel;
        }

        function render() {
            if (!panel) return;
            const shots = state.shots;
            let h = '<div class="rs-head"><button class="rs-toggle" data-act="toggle" aria-expanded="' + state.open + '">' + (state.open ? '▾' : '▸') + ' ' + esc(t('title')) +
                ' <span class="rs-count">' + shots.length + ' ' + esc(t('shots')) + '</span></button></div>';
            if (state.open) {
                h += '<div class="rs-clubs" role="group" aria-label="' + esc(t('club')) + '">' + CLUBS.map(function (c) {
                    return '<button class="rs-club' + (state.club === c ? ' selected' : '') + '" data-club="' + c + '" style="--c:' + hex(c) + '">' + c + '</button>';
                }).join('') + '</div>';
                if (!state.club && root.SwingEngine && root.SwingEngine.getInputMode && root.SwingEngine.getInputMode() === 'LM') h += '<div class="rs-hint">' + esc(t('lmHint')) + '</div>';
                const practised = root.RangePractice && root.RangePractice.byDistance ? root.RangePractice.byDistance(shots) : [];
                const tests = root.RangePractice && root.RangePractice.trends ? root.RangePractice.trends(3) : [];   // kept apart from the session's shots
                if (state.tab === 'approach' && !practised.length && !tests.length) state.tab = 'shots';
                h += '<div class="rs-tabs"><button data-tab="shots" class="' + (state.tab === 'shots' ? 'selected' : '') + '">' + esc(t('tabShots')) + '</button>' +
                     '<button data-tab="clubs" class="' + (state.tab === 'clubs' ? 'selected' : '') + '">' + esc(t('tabClubs')) + '</button>' +
                     (practised.length || tests.length ? '<button data-tab="approach" class="' + (state.tab === 'approach' ? 'selected' : '') + '">' + esc(t('tabApproach')) + '</button>' : '') + '</div>';
                h += '<div class="rs-body">';
                if (state.tab === 'approach') {
                    // the approach tests on this range: how each one's scores go over time (the latest five, the best), then per practised distance
                    if (tests.length) {
                        h += '<div class="rs-tests"><div class="rs-sub">' + esc(t('tests')) + '</div>';
                        tests.forEach(function (x) {
                            const tr = x.trend;
                            h += '<div class="rs-test"><div class="rs-test-head"><span class="rs-test-name">' + esc(x.label) + '</span><span class="rs-test-n">' + tr.n + ' ' + esc(t('played')) + '</span></div>' +
                                 root.RangePractice.sparkSVG(tr.series, { width: 256, height: 44, best: tr.best, label: x.label, tip: function (i, v) { return t('testTip').replace('{i}', tr.n - tr.series.length + i + 1).replace('{v}', v); } }) +
                                 '<div class="rs-test-stats"><span>' + esc(t('last')) + ' <b>' + tr.last + '</b></span><span>' + esc(t('best')) + ' <b>' + tr.best + '</b></span><span>' + esc(t('avg5')) + ' <b>' + tr.avg5 + '</b></span></div>' +
                                 boardHtml(root.RangePractice.board && root.RangePractice.board(x.key)) + '</div>';
                        });
                        h += '</div>';
                    }
                    if (practised.length) {
                    // per practised distance: greens hit and how close to the pin
                    h += '<table><thead><tr><th>' + esc(t('distance')) + '</th><th>' + esc(t('n')) + '</th><th>' + esc(t('greens')) + '</th><th>' + esc(t('toPin')) + '</th><th>' + esc(t('best')) + '</th></tr></thead><tbody>';
                    practised.forEach(function (r) {
                        h += '<tr><td>' + dist(r.dist) + ' ' + unit() + '</td><td>' + r.n + '</td><td>' + Math.round(100 * r.greens / r.n) + ' %</td><td>' + side0(r.prox) + '</td><td>' + side0(r.best) + '</td></tr>';
                    });
                    h += '</tbody></table><div class="rs-unit">' + esc(t('toPinNote')) + '</div>';
                    }
                } else if (!shots.length) h += '<div class="rs-empty">' + esc(t('empty')) + '</div>';
                else if (state.tab === 'shots') {
                    h += '<table><thead><tr><th>#</th><th>' + esc(t('club')) + '</th><th>' + esc(t('carry')) + '</th><th>' + esc(t('total')) + '</th><th>' + esc(t('offline')) + '</th></tr></thead><tbody>';
                    for (let i = shots.length - 1; i >= 0; i--) {
                        const s = shots[i];
                        h += '<tr' + (i === shots.length - 1 ? ' class="rs-last"' : '') + '><td>' + (i + 1) + '</td><td><select data-shot="' + i + '" aria-label="' + esc(t('club')) + ' ' + (i + 1) + '">' +
                             '<option value="">–</option>' + CLUBS.map(function (c) { return '<option' + (s.club === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
                             '</select></td><td>' + dist(s.carry) + '</td><td>' + dist(s.total) + '</td><td>' + side(s.offline) + '</td></tr>';
                    }
                    h += '</tbody></table>';
                } else {
                    h += '<table><thead><tr><th>' + esc(t('club')) + '</th><th>' + esc(t('n')) + '</th><th>' + esc(t('carry')) + '</th><th>±</th><th>' + esc(t('total')) + '</th><th>' + esc(t('spread')) + '</th></tr></thead><tbody>';
                    clubStats(fullSwings(shots)).forEach(function (r) {
                        h += '<tr><td><span class="rs-dot" style="background:' + hex(r.club) + '"></span>' + esc(r.club) + '</td><td>' + r.n + '</td><td>' + dist(r.carry) + '</td><td>' +
                             (r.n > 1 ? dist(r.carrySd) : '–') + '</td><td>' + dist(r.total) + '</td><td>' + (r.n > 1 ? '±' + dist(r.offlineSd) : '–') + '</td></tr>';
                    });
                    h += '</tbody></table><div class="rs-unit">' + unit() + '</div>';
                    h += '<div class="rs-note">' + esc(t('bagNote')) + '</div>';
                }
                h += '</div>';
                const ell = ellipseClub();
                if (ell && ellipse && marksShown) h += '<div class="rs-note">' + esc(t('ellipse').replace('{c}', ell)) + '</div>';
                // a published range: the player's stars for it (ratings.js keeps them, so a redraw shows the same)
                if (ctx && ctx.rateCode && root.GolfRatings) h += '<div class="rs-rate"><span class="rs-sub">' + esc(t('rateRange')) + '</span>' + root.GolfRatings.widget(ctx.rateCode) + '</div>';
                h += '<div class="rs-actions"><button data-act="csv"' + (shots.length ? '' : ' disabled') + '>⬇ ' + esc(t('csv')) + '</button><button data-act="clear"' + (shots.length ? '' : ' disabled') + '>' + esc(t('clear')) + '</button></div>';
            }
            panel.innerHTML = h;
            panel.classList.toggle('collapsed', !state.open);
        }

        // A test's leaderboard on this range (RangePractice fetches it): the top five, and the player's own place when they are further down
        function boardHtml(b) {
            if (!b || !b.top || !b.top.length) return '';
            let h = '<div class="rs-board"><div class="rs-sub">' + esc(t('board')) + '</div><ol>';
            b.top.slice(0, 5).forEach(function (r) {
                h += '<li class="' + (r.is_me ? 'me' : '') + '"><span class="rs-board-rank">' + r.rank + '</span><span class="rs-board-name">' + esc(r.player_name) + '</span><b>' + r.score + '</b></li>';
            });
            h += '</ol>';
            if (b.me && b.me.rank > 5) h += '<div class="rs-board-me">' + esc(t('you')) + ': ' + b.me.rank + ' ' + esc(t('of')) + ' ' + b.players + ' · ' + b.me.best + ' ' + esc(t('pts')) + '</div>';
            return h + '</div>';
        }
        function onClick(e) {
            const b = e.target.closest('button');
            if (!b) return;
            if (b.dataset.club) { state.club = state.club === b.dataset.club ? null : b.dataset.club; save(); redraw(); return; }
            if (b.dataset.tab) { state.tab = b.dataset.tab; render(); return; }
            const act = b.dataset.act;
            if (act === 'toggle') { state.open = !state.open; try { localStorage.setItem('golf_range_session_open', state.open ? '1' : '0'); } catch (err) {} render(); }
            else if (act === 'csv') exportCSV();
            else if (act === 'clear' && root.confirm(t('confirmClear'))) { state.shots = []; save(); redraw(); }
        }
        function onChange(e) {
            const sel = e.target;
            if (!sel || sel.tagName !== 'SELECT' || sel.dataset.shot === undefined) return;
            const s = state.shots[+sel.dataset.shot];
            if (!s) return;
            s.club = sel.value || null;
            if (root.PlayerBag && root.PlayerBag.book) root.PlayerBag.book(s);   // the bag follows the corrected club
            save(); redraw();
        }

        function exportCSV() {
            const csv = toCSV(state.shots, !!root.useMeters);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            a.download = 'range-session-' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }

        // ── 3D: a dot where each ball landed (carry), the newest larger; the ellipse of the picked club (or of the last shot's) ──
        function groundY(x, z, fallback) {
            const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null;
            return (s && typeof s.z === 'number') ? s.z : fallback;
        }
        function clearMarks() {
            if (!ctx || !ctx.scene) { dots = []; ellipse = null; return; }
            dots.forEach(function (d) { ctx.scene.remove(d); if (d.material) d.material.dispose(); });
            dots = [];
            if (ellipse) { ctx.scene.remove(ellipse); ellipse.geometry.dispose(); ellipse.material.dispose(); ellipse = null; }
        }
        function ellipseClub() {
            if (state.club) return state.club;
            const last = state.shots[state.shots.length - 1];
            return last ? last.club : null;
        }
        function drawMarks() {
            clearMarks();
            const THREE = root.THREE;
            if (!ctx || !ctx.scene || !THREE) return;
            if (!dotGeo) dotGeo = new THREE.CircleGeometry(1.1, 18);
            const n = state.shots.length;
            state.shots.forEach(function (s, i) {
                if (num(s.landX) === null || num(s.landZ) === null) return;
                const last = i === n - 1;
                const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: COLORS[s.club] === undefined ? 0xe2e8f0 : COLORS[s.club], transparent: true, opacity: last ? 1 : 0.75, depthWrite: false }));
                m.rotation.x = -Math.PI / 2;
                m.position.set(s.landX, groundY(s.landX, s.landZ, ctx.tee.y) + 0.08, s.landZ);
                if (last) m.scale.setScalar(1.7);
                m.renderOrder = 2;
                m.visible = marksShown;
                m.userData.rangeSessionDot = true;
                ctx.scene.add(m);
                dots.push(m);
            });
            const club = ellipseClub();
            const d = club ? dispersion(fullSwings(state.shots).filter(function (s) { return s.club === club; }), ctx.tee) : null;
            if (d) {
                // 1.5 standard deviations each way: about 2 in 3 shots of a round spread land inside
                const ra = Math.max(1.5, 1.5 * d.sdAlong), rc = Math.max(1.5, 1.5 * d.sdAcross), pts = [];
                for (let k = 0; k < 64; k++) {
                    const a = k / 64 * Math.PI * 2, p = fromRangeFrame(ctx.tee, d.along + Math.cos(a) * ra, d.across + Math.sin(a) * rc);
                    pts.push(new THREE.Vector3(p.x, groundY(p.x, p.z, ctx.tee.y) + 0.25, p.z));
                }
                ellipse = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS[club] === undefined ? 0xffffff : COLORS[club], transparent: true, opacity: 0.95 }));
                ellipse.renderOrder = 3;
                ellipse.visible = marksShown;
                ctx.scene.add(ellipse);
            }
        }
        function redraw() { drawMarks(); render(); }

        api.start = function (opts) {
            if (!opts || !opts.tee) return;
            const key = String(opts.key || 'draft');
            if (key !== state.key) { state.key = key; load(); }
            ctx = { scene: opts.scene || null, tee: { x: opts.tee.x, y: opts.tee.y, z: opts.tee.z, rot: opts.tee.rot || 0 }, rateCode: opts.rateCode || null };
            ensurePanel().style.display = '';
            redraw();
        };
        api.stop = function () {
            clearMarks();
            ctx = null;
            if (panel) panel.style.display = 'none';
        };
        api.active = function () { return !!ctx; };
        // The club a shot is booked to: the one picked in the panel, else (not a launch monitor) the swing engine's
        api.clubFor = function (source, swingClub) {
            if (state.club) return state.club;
            if (source !== 'LM' && swingClub && FROM_SWING[swingClub]) return FROM_SWING[swingClub];
            return null;
        };
        api.record = function (shot) {
            if (!ctx || !shot) return;
            const rec = Object.assign({ t: Date.now() }, shot);
            state.shots.push(rec);
            if (root.PlayerBag && root.PlayerBag.book) root.PlayerBag.book(rec);   // launch-monitor shots also go to the player's bag (club suggestions on a course)
            if (state.shots.length > MAX_SHOTS) state.shots.splice(0, state.shots.length - MAX_SHOTS);
            save();
            redraw();
        };
        // What the aim billboard shows on the range instead of the club suggestion: the club picked in the panel and the player's own
        // average with it. null when the panel is not up, or no club is picked and the shots are not from a launch monitor (then the
        // suggestion stays); { needClub } when a launch monitor is the input and no club is picked.
        api.aimPlan = function () {
            if (!ctx) return null;
            const lm = !!(root.SwingEngine && root.SwingEngine.getInputMode && root.SwingEngine.getInputMode() === 'LM');
            if (!state.club) return lm ? { needClub: true } : null;
            const st = clubStats(fullSwings(state.shots).filter(function (s) { return s.club === state.club; }))[0];
            return st ? { club: state.club, n: st.n, carry: st.carry, carrySd: st.carrySd, total: st.total } : { club: state.club, n: 0 };
        };
        api.shots = function () { return state.shots.slice(); };
        api.getClub = function () { return state.club; };
        api.setClub = function (c) { state.club = (c && CLUBS.indexOf(c) >= 0) ? c : null; save(); if (ctx) redraw(); };
        api.setMarksVisible = function (v) { if (marksShown === !!v) return; marksShown = !!v; dots.forEach(function (d) { d.visible = marksShown; }); if (ellipse) ellipse.visible = marksShown; render(); };
        api.render = render;   // after a language or unit change
    }

    root.RangeSession = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
