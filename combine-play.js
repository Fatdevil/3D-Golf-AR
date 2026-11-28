// ================================================================
//  GOLF COMBINE 9 ON THE RANGE (window.CombinePlay) — the test as the player plays it, in the range session panel's "Combine" tab.
//
//  The player picks a level, then hits one shot at each of the nine targets, shortest first (the aim goes to the target's distance). Each
//  shot is a normal range shot (it goes to the shot bank) marked with the test, its level and the target's index (combine-core.js); the
//  panel shows a preliminary score from the shot's own standard landing. A shot may only be hit again when it was not a measurement
//  (a misread, or a value the launch monitor did not send): the player marks it, the reason goes with it. After the ninth shot the server
//  scores the test from the shot bank with its own ball flight (/api/combine/finish); until then (offline, shots still waiting) the card
//  says the result is preliminary and asks again when the shots have gone.
//  The test in progress is kept on the device (localStorage 'golf_combine_active'), so a reload carries on where it was.
// ================================================================
(function (root) {
    'use strict';
    const KEY = 'golf_combine_active';
    const C = root.CombineCore;
    const TXT = {
        sv: { tab: '🏆 Combine', title: 'Golf Combine 9', pick: 'Välj nivå. Ett slag mot vart och ett av nio mål, kortast först. Resultat jämförs bara inom samma nivå.',
              levels: { beginner: 'Nybörjare', standard: 'Standard', advanced: 'Avancerad' }, start: 'Starta testet', target: 'Mål {i} av 9', of: 'av',
              last: 'Förra slaget: {s} p ({long} {side})', short: 'kort', long: 'långt', left: 'V', right: 'H', retake: 'Slå om: {why}',
              why: { misread: 'felmätning', missing_value: 'mätvärde saknas' }, cancel: 'Avbryt testet', confirmCancel: 'Avbryta testet? Slagen finns kvar i slagbanken men testet räknas inte.',
              notOfficial: 'Din launch monitor skickade inte alla värden (spinnaxel eller startriktning) för senaste slaget: testet blir ett träningsresultat, inte officiellt.',
              lowSpeed: 'Mål under 60 m slås med bollfarter där spelets bollflykt inte är kontrollerad mot uppmätta slag. Poängen jämför dig med dig själv.',
              result: 'Resultat', official: 'Officiellt', practice: 'Träningsresultat', prelim: 'Preliminärt: verifieras när slagen nått servern', verifying: 'Servern räknar…',
              costly: 'Kostade mest: {list}.', train: 'Träna på de här avstånden.', again: 'Nytt test', retry: 'Försök igen', points: 'p', total: 'Totalt',
              physics: 'Räknat av serverns bollflykt ({v}) i standardförhållanden.', dist: 'Mål', score: 'Poäng', err: 'Längd / sidled', close: 'Stäng' },
        en: { tab: '🏆 Combine', title: 'Golf Combine 9', pick: 'Pick a level. One shot at each of nine targets, shortest first. Results compare only within one level.',
              levels: { beginner: 'Beginner', standard: 'Standard', advanced: 'Advanced' }, start: 'Start the test', target: 'Target {i} of 9', of: 'of',
              last: 'Last shot: {s} pts ({long} {side})', short: 'short', long: 'long', left: 'L', right: 'R', retake: 'Hit again: {why}',
              why: { misread: 'misread', missing_value: 'value missing' }, cancel: 'Cancel the test', confirmCancel: 'Cancel the test? The shots stay in the shot bank but the test does not count.',
              notOfficial: 'Your launch monitor did not send every value (spin axis or start direction) for the last shot: the test becomes a practice result, not official.',
              lowSpeed: 'Targets under 60 m are hit at ball speeds where the game\'s ball flight is not checked against measured shots. The score compares you with yourself.',
              result: 'Result', official: 'Official', practice: 'Practice result', prelim: 'Preliminary: verified once the shots reach the server', verifying: 'The server is scoring…',
              costly: 'Cost the most: {list}.', train: 'Practise these distances.', again: 'New test', retry: 'Try again', points: 'pts', total: 'Total',
              physics: 'Worked out by the server\'s ball flight ({v}) in standard conditions.', dist: 'Target', score: 'Points', err: 'Length / side', close: 'Close' }
    };
    const YD = 1.09361;
    function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function L() { return (root.getGolfLanguage && root.getGolfLanguage() === 'en') ? TXT.en : TXT.sv; }
    function dist(m) { return root.useMeters === false ? Math.round(m * YD) + ' yd' : Math.round(m) + ' m'; }
    function load() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.test && C.LEVELS[s.level] ? s : null; } catch (e) { return null; } }
    function save(s) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) { /* this page only */ } }
    let st = load(), level = 'standard', busy = false, onChange = function () {};

    const api = {};
    api.active = function () { return !!(st && !st.result && st.index < 9); };
    api.state = function () { return st ? JSON.parse(JSON.stringify(st)) : null; };
    api.target = function () { return api.active() ? C.LEVELS[st.level][st.index] : null; };
    api.setOnChange = function (f) { onChange = f || function () {}; };
    function changed() { save(st); aim(); onChange(); overlay(); }
    // the result card on its own over the range once the ninth shot is in (preliminary, then the server's), until the player closes it
    function overlay() {
        if (typeof document === 'undefined') return;
        let el = document.getElementById('cb-overlay');
        const show = st && st.index >= 9 && !st.cardClosed;
        if (!show) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'cb-overlay';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'false');
            el.addEventListener('click', function (e) {
                const b = e.target.closest('button');
                if (!b) return;
                if (b.dataset.cbAct === 'close') { st.cardClosed = true; save(st); overlay(); return; }
                api.click(b, root.RangeSession && root.RangeSession.shots ? root.RangeSession.shots() : []);
                onChange(); overlay();
            });
            ['pointerdown', 'pointerup', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
            document.body.appendChild(el);
        }
        const t = L();
        el.innerHTML = '<div class="cb-overlay-box"><button class="cb-close" data-cb-act="close" aria-label="' + esc(t.close) + '">×</button>' + card(t) + '</div>';
    }
    // the aim down the range at the current target's distance (arcade.html placeRangeBall)
    function aim() {
        root._combineAimDist = api.target();
        if (typeof root.placeRangeBall === 'function' && !(typeof root.rangeShotBusy === 'function' && root.rangeShotBusy())) { try { root.placeRangeBall(true); } catch (e) { /* not on a range */ } }
    }
    api.start = function (lvl) {
        if (!C.LEVELS[lvl]) return;
        const id = root.ShotSync && root.ShotSync.newCid ? root.ShotSync.newCid() : ('cb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        st = { test: id, level: lvl, index: 0, started: Date.now(), shots: [], result: null };
        changed();
    };
    api.cancel = function () { st = null; root._combineAimDist = null; save(null); aim(); onChange(); overlay(); };
    // the combine part of a range shot about to be recorded (arcade-range-session.js record): which test and target
    api.tag = function () { return api.active() ? { test: st.test, level: st.level, index: st.index } : null; };
    // a shot recorded at the current target: its preliminary score, and on to the next target (no free retakes)
    api.recorded = function (rec) {
        if (!api.active() || !rec || !rec.combine || rec.combine.test !== st.test) return;
        const D = C.LEVELS[st.level][st.index];
        const sc = C.shotScore(D, rec.carryStd, rec.offlineStd);
        st.shots.push({ cid: rec.cid, index: st.index, score: sc ? sc.score : null, long: sc ? sc.long : null, side: sc ? sc.side : null,
                        measured: C.measured(rec), why: C.voidReason(rec) });
        st.index++;
        changed();
        // after the ninth shot the server scores the test; a ninth shot that was not a measurement may be hit again first
        if (st.index >= 9 && !st.shots[st.shots.length - 1].why) api.finish();
    };
    // the last shot hit again: only when it was not a measurement; the shot is marked void with the reason (shot bank) and its target comes back
    api.retake = function (shots) {
        if (!st || !st.shots.length || st.result) return false;
        const last = st.shots[st.shots.length - 1];
        if (!last.why) return false;
        const rec = (shots || []).filter(function (s) { return s.cid === last.cid; })[0];
        if (!rec) return false;
        rec.combine = Object.assign({}, rec.combine, { void: last.why });
        rec.edited = Date.now();
        if (root.ShotSync && root.ShotSync.enqueue) root.ShotSync.enqueue(rec);
        last.voided = last.why;
        st.index = last.index;
        st.pendingFinish = false;
        changed();
        return rec;
    };
    // the finished test scored by the server (after what still waits in the outbox has gone); until then the card is preliminary
    api.finish = async function () {
        if (!st || st.index < 9 || busy) return;
        busy = true; st.verifying = true; onChange();
        try {
            if (root.ShotSync && root.ShotSync.flush) await root.ShotSync.flush();
            const id = (root.GolfAuth && root.GolfAuth.userId) || localStorage.getItem('golf_os_device_id');
            const res = await root.fetch('/api/combine/finish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': id }, body: JSON.stringify({ test_id: st.test, level: st.level }) });
            if (res.ok) { st.result = await res.json(); st.error = null; }
            else st.error = res.status === 409 ? 'waiting' : 'server';
        } catch (e) { st.error = 'offline'; }
        busy = false; st.verifying = false;
        changed();
    };
    // when the outbox has sent something: a test waiting for its shots is asked for again
    root.addEventListener && root.addEventListener('shotsync', function () {
        if (st && st.index >= 9 && !st.result && !busy && root.ShotSync && root.ShotSync.pending && root.ShotSync.pending() === 0) api.finish();
    });
    root.addEventListener && root.addEventListener('online', function () { if (st && st.index >= 9 && !st.result) api.finish(); });

    // ── The tab's HTML ──
    function prelimTotal() {
        const by = {};
        st.shots.forEach(function (x) { if (!x.voided) by[x.index] = by[x.index] === undefined ? x : by[x.index]; });
        const xs = Object.keys(by).map(function (k) { return by[k]; }).filter(function (x) { return typeof x.score === 'number'; });
        return xs.length ? Math.round(10 * xs.reduce(function (s, x) { return s + x.score; }, 0) / xs.length) / 10 : null;
    }
    function errText(t, x) {
        if (typeof x.long !== 'number') return '–';
        const lg = Math.abs(x.long) < 0.5 ? '±0' : Math.abs(x.long).toFixed(0) + ' ' + (x.long < 0 ? t.short : t.long);
        const sd = Math.abs(x.side) < 0.5 ? '' : ' · ' + Math.abs(x.side).toFixed(0) + ' ' + (x.side < 0 ? t.left : t.right);
        return lg + sd;
    }
    function card(t) {
        const r = st.result, targets = C.LEVELS[st.level];
        let h = '<div class="cb-card" data-cb="card"><div class="cb-card-head"><span>' + esc(t.result + ' · ' + t.levels[st.level]) + '</span>';
        if (r) h += '<span class="cb-badge ' + (r.official ? 'cb-official' : 'cb-practice') + '">' + esc(r.official ? t.official : t.practice) + '</span>';
        h += '</div>';
        const total = r ? r.total : prelimTotal();
        h += '<div class="cb-total"><b data-cb="total">' + (total === null ? '–' : String(total).replace('.', root.getGolfLanguage && root.getGolfLanguage() === 'en' ? '.' : ',')) + '</b> ' + esc(t.points) + '</div>';
        if (!r) h += '<div class="cb-note" data-cb="prelim">' + esc(st.verifying ? t.verifying : t.prelim) + '</div>';
        const rows = r ? r.shots : targets.map(function (D, i) { const x = st.shots.filter(function (s) { return s.index === i && !s.voided; })[0] || {}; return { index: i, target: D, score: x.score, long: x.long, side: x.side }; });
        const worst = r ? r.worst : rows.filter(function (x) { return typeof x.score === 'number'; }).slice().sort(function (a, b) { return a.score - b.score; }).slice(0, 3).map(function (x) { return x.index; });
        h += '<table class="cb-table"><thead><tr><th>' + esc(t.dist) + '</th><th>' + esc(t.score) + '</th><th>' + esc(t.err) + '</th></tr></thead><tbody>';
        rows.forEach(function (x) {
            h += '<tr' + (worst.indexOf(x.index) >= 0 ? ' class="cb-worst"' : '') + '><td>' + esc(dist(x.target)) + '</td><td>' + (typeof x.score === 'number' ? x.score : '–') + '</td><td>' + esc(errText(t, x)) + '</td></tr>';
        });
        h += '</tbody></table>';
        if (worst.length) h += '<div class="cb-costly" data-cb="costly">' + esc(t.costly.replace('{list}', worst.map(function (i) { return dist(targets[i]); }).join(', '))) + ' ' + esc(t.train) + '</div>';
        if (r) h += '<div class="cb-note">' + esc(t.physics.replace('{v}', r.physics)) + '</div>';
        if (st.level === 'beginner' || targets[0] < 60) h += '<div class="cb-note">' + esc(t.lowSpeed) + '</div>';
        h += '<div class="cb-actions">' + (!r && !st.verifying ? '<button data-cb-act="finish">' + esc(t.retry) + '</button>' : '') + '<button data-cb-act="new">' + esc(t.again) + '</button></div>';
        return h + '</div>';
    }
    api.html = function () {
        const t = L();
        let h = '<div class="cb" data-cb="panel"><div class="rs-sub">' + esc(t.title) + '</div>';
        if (!st) {
            h += '<div class="rs-note">' + esc(t.pick) + '</div><div class="cb-levels" role="radiogroup">';
            Object.keys(C.LEVELS).forEach(function (l) {
                const ds = C.LEVELS[l];
                h += '<button role="radio" aria-checked="' + (level === l) + '" data-cb-level="' + l + '"><b>' + esc(t.levels[l]) + '</b><span>' + esc(dist(ds[0]) + ' – ' + dist(ds[8])) + '</span></button>';
            });
            h += '</div><div class="cb-actions"><button data-cb-act="start" class="cb-go">' + esc(t.start) + '</button></div>';
            return h + '</div>';
        }
        if (st.index >= 9) {
            const last9 = st.shots[st.shots.length - 1];
            if (!st.result && last9 && last9.why && !last9.voided) h += '<div class="cb-warn">⚠ ' + esc(t.retake.replace('{why}', t.why[last9.why])) + '</div><div class="cb-actions"><button data-cb-act="retake">' + esc(t.retake.replace('{why}', t.why[last9.why])) + '</button></div>';
            return h + card(t) + '</div>';
        }
        const D = C.LEVELS[st.level][st.index];
        h += '<div class="cb-target" data-cb="target"><span>' + esc(t.target.replace('{i}', st.index + 1)) + '</span><b>' + esc(dist(D)) + '</b></div>';
        h += '<div class="cb-dots">' + C.LEVELS[st.level].map(function (d, i) {
            const x = st.shots.filter(function (s) { return s.index === i && !s.voided; })[0];
            return '<span class="cb-dot' + (i === st.index ? ' cb-now' : '') + '" title="' + esc(dist(d)) + '">' + (x && typeof x.score === 'number' ? x.score : '') + '</span>';
        }).join('') + '</div>';
        const last = st.shots[st.shots.length - 1];
        if (last && !last.voided) {
            h += '<div class="cb-last" data-cb="last">' + esc(t.last.replace('{s}', typeof last.score === 'number' ? last.score : '–').replace('{long}', errText(t, last)).replace(' {side}', '')) + '</div>';
            if (!last.measured) h += '<div class="cb-warn" data-cb="not-official">⚠ ' + esc(t.notOfficial) + '</div>';
            if (last.why) h += '<div class="cb-actions"><button data-cb-act="retake">' + esc(t.retake.replace('{why}', t.why[last.why])) + '</button></div>';
        }
        if (C.LEVELS[st.level][0] < 60 && st.index === 0) h += '<div class="rs-note">' + esc(t.lowSpeed) + '</div>';
        h += '<div class="cb-actions"><button data-cb-act="cancel" class="cb-cancel">' + esc(t.cancel) + '</button></div>';
        return h + '</div>';
    };
    // a click in the tab: true when it was the combine's (the panel then draws again)
    api.click = function (b, shots) {
        if (b.dataset.cbLevel) { level = b.dataset.cbLevel; return true; }
        const act = b.dataset.cbAct;
        if (!act) return false;
        if (act === 'start') api.start(level);
        else if (act === 'cancel') { if (!root.confirm || root.confirm(L().confirmCancel)) api.cancel(); }
        else if (act === 'retake') api.retake(shots);
        else if (act === 'finish') api.finish();
        else if (act === 'new') { st = null; save(null); root._combineAimDist = null; onChange(); overlay(); }
        return true;
    };
    api.TXT = TXT;
    if (st && !st.result) root._combineAimDist = api.target();
    root.CombinePlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
