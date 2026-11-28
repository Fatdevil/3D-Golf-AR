// ================================================================
//  SHOT SYNC (window.ShotSync) — the range shots of this device go to the player's shot bank on the server (/api/shots, shot-bank-core.js).
//
//  Every shot the range session books is put in an outbox kept on the device and sent from there:
//  at once when the server can be reached, later when it cannot (offline, the server down, no database). Nothing is ever dropped quietly:
//    - a shot leaves the outbox only when the server says it stored it
//    - a shot the server refuses (a value it cannot take) moves to a failed queue ('golf_shot_failed_<cid>', with the reason), shown in
//      the range panel with an export and a retry; it is never deleted by the game
//    - the outbox has no size limit; when the device's storage is full a shot is kept in the page's memory until sent, and the panel says
//      so and offers the export (a file with every waiting and failed shot)
//  The outbox is one localStorage key per
//  shot ('golf_shot_out_<cid>'): two tabs of the same device see each other's writes late (Chromium keeps a copy of localStorage per tab
//  process), so a single list read, changed and written back by both would lose one tab's shot. Each shot carries an id made on this
//  device (cid): sending it again (a retry, two tabs) stores it once.
//  A club changed or a flagged shot counted anyway is sent again with the time of the change (edited): the server keeps the latest.
//  Shots this device had before the shot bank (the range sessions and the bag kept on it) are sent once, with ids made from the device and
//  the shot's time, so sending them again from another tab, or after a reload, adds nothing.
//  The bag (arcade-bag.js) is then the server's (all the player's devices) together with the shots still waiting in the outbox.
//  Starting a new range session clears the session list only: the shots stay in the outbox until sent, and in the bank for good.
//  Another device joins the player's bank with a code this device shows (linkCode / link).
//  The core (cids, old shots, the outbox) has no DOM and is tested in tests/test_shot_sync.js; the page part needs fetch and localStorage.
// ================================================================
(function (root) {
    'use strict';
    const OUTBOX = 'golf_shot_out_', FAILED = 'golf_shot_failed_', LEGACY = 'golf_shot_legacy_v1', SESSION_PREFIX = 'golf_range_session_', BAG = 'golf_bag_v1';
    const BATCH = 100;

    // FNV-1a, 8 hex digits: a device's mark in the ids of its old shots (not the device id itself)
    function fnv(s) {
        let h = 0x811c9dc5;
        s = String(s);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return ('0000000' + h.toString(16)).slice(-8);
    }
    // the id of a shot recorded before shots had ids: the same on every run, from the device and the shot's time
    function legacyCid(deviceId, t) { return 'L' + fnv(deviceId || 'device') + '-' + Math.round(t); }
    function newCid() {
        try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID().replace(/-/g, ''); } catch (e) { /* fall back */ }
        let s = '';
        for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
    }

    // The shots this device had before the shot bank, from what is stored on it: every range session's shots (with the range as their
    // range), then the bag's entries whose session was cleared since (their carry and club only, marked range 'bag'). One per time.
    function legacyShots(store, deviceId) {
        const byT = {}, out = [];
        const add = function (s) { if (!s || typeof s.t !== 'number' || byT[s.t]) return; byT[s.t] = true; out.push(s); };
        store.keys().filter(function (k) { return k.indexOf(SESSION_PREFIX) === 0 && k !== SESSION_PREFIX + 'open'; }).sort().forEach(function (k) {
            let st = null;
            try { st = JSON.parse(store.get(k) || 'null'); } catch (e) { st = null; }
            if (!st || !Array.isArray(st.shots)) return;
            st.shots.forEach(function (s) { add(Object.assign({}, s, { cid: s.cid || legacyCid(deviceId, s.t), range: s.range || k.slice(SESSION_PREFIX.length), edited: s.edited || s.t })); });
        });
        let bag = null;
        try { bag = JSON.parse(store.get(BAG) || 'null'); } catch (e) { bag = null; }
        if (bag && Array.isArray(bag.shots)) bag.shots.forEach(function (e) {
            add({ cid: legacyCid(deviceId, e.t), t: e.t, source: 'LM', club: e.club, carry: e.carry, total: e.total, ballSpeed: e.ballSpeed, range: 'bag', edited: e.t });
        });
        return out;
    }

    // The outbox: shots waiting for the server, one per cid (a newer copy of the same shot replaces the older), oldest first. No limit:
    // a shot is never dropped to make room
    function put(list, shot) {
        const out = list.filter(function (s) { return s.cid !== shot.cid; });
        out.push(shot);
        out.sort(function (a, b) { return a.t - b.t; });
        return out;
    }
    // What the server's answer means for each shot sent: { stored: [cid], failed: [{ shot, reason }], keep: [shot] }. A shot changed since
    // it was sent (current is the outbox's copy now) is kept, to go again; a refused one goes to the failed queue with its reason.
    function settle(current, sent, answer) {
        const stored = {}, refused = {};
        ((answer && answer.stored) || []).forEach(function (c) { stored[c] = true; });
        ((answer && answer.refused) || []).forEach(function (r) { if (r && r.cid) refused[r.cid] = r.reason || 'refused'; });
        const out = { stored: [], failed: [], keep: [] };
        sent.forEach(function (x) {
            const cur = current[x.cid] || x;
            const changed = (cur.edited || cur.t) > (x.edited || x.t);
            if (stored[x.cid] && !changed) out.stored.push(x.cid);
            else if (refused[x.cid] !== undefined && !changed) out.failed.push({ shot: cur, reason: refused[x.cid] });
            else out.keep.push(cur);   // not answered for (a short answer), or changed meanwhile: it stays
        });
        return out;
    }
    // Of two copies of the same shot (the stored one and one kept in memory while the storage was full), the one edited last
    function newer(a, b) { if (!a) return b || null; if (!b) return a; return (b.edited || b.t) > (a.edited || a.t) ? b : a; }
    // The file the player can save: every shot still waiting and every shot the server refused, as they are on this device
    function exportFile(pending, failed, now) {
        return JSON.stringify({ kind: 'golf-shot-export', version: 1, exported_at: new Date(now || Date.now()).toISOString(),
                                pending: pending, failed: failed }, null, 1);
    }
    // the bag: the server's entries with the outbox's shots that count (an outbox shot replaces the server's entry of the same time)
    function mergeBag(serverEntries, outbox, Bag) {
        let list = (serverEntries || []).slice();
        outbox.forEach(function (s) { list = list.filter(function (e) { return e.t !== s.t; }); const e = Bag.entryOf(s); if (e) list.push(e); });
        return Bag.trim(list);
    }

    const api = { legacyCid: legacyCid, newCid: newCid, legacyShots: legacyShots, put: put, settle: settle, mergeBag: mergeBag, exportFile: exportFile, newer: newer, fnv: fnv,
                  OUTBOX: OUTBOX, FAILED: FAILED, LEGACY: LEGACY, BATCH: BATCH };

    // ── In the page ──
    if (typeof localStorage !== 'undefined' && typeof root.fetch === 'function' && typeof document !== 'undefined') {
        const store = {
            get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
            set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
            remove: function (k) { try { localStorage.removeItem(k); } catch (e) { /* none */ } },
            keys: function () { const out = []; try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) { /* none */ } return out; }
        };
        const deviceId = function () { return (root.GolfAuth && root.GolfAuth.userId) || store.get('golf_os_device_id'); };
        // the outbox: one key per shot (see the top), oldest first; a shot the full storage could not take waits in memory (this page) instead
        const memory = {}, memoryFailed = {};
        const parse = function (k) { try { return JSON.parse(store.get(k) || 'null'); } catch (e) { return null; } };
        const readOne = function (cid) { return newer(parse(OUTBOX + cid), memory[cid]); };
        const keysOf = function (prefix) { return store.keys().filter(function (k) { return k && k.indexOf(prefix) === 0; }); };
        const readBox = function () {
            const byCid = {};
            keysOf(OUTBOX).forEach(function (k) { const s = parse(k); if (s && typeof s.t === 'number') byCid[s.cid] = s; });
            Object.keys(memory).forEach(function (c) { byCid[c] = newer(byCid[c], memory[c]); });   // an edit kept in memory beats the older stored copy
            return Object.keys(byCid).map(function (c) { return byCid[c]; }).sort(function (a, b) { return a.t - b.t; });
        };
        const changed = function () { try { root.dispatchEvent(new CustomEvent('shotsync')); } catch (e) { /* none */ } };
        const writeOne = function (s) {
            const old = readOne(s.cid);
            if (old && (old.edited || old.t) > (s.edited || s.t)) return;   // a later edit of this shot is already waiting
            if (store.set(OUTBOX + s.cid, JSON.stringify(s))) {
                delete memory[s.cid];
                if (!Object.keys(memory).length && !Object.keys(memoryFailed).length) status.storageFull = false;
                return;
            }
            memory[s.cid] = s;   // the storage is full: the shot waits in this page's memory, and the panel says so (never dropped)
            status.storageFull = true;
        };
        const removeOne = function (cid) { store.remove(OUTBOX + cid); delete memory[cid]; };
        // the failed queue: shots the server refused, with the reason; kept until the player sends them again (retry) or exports them
        const readFailed = function () {
            const byCid = {};
            keysOf(FAILED).forEach(function (k) { const f = parse(k); if (f && f.shot) byCid[f.shot.cid] = f; });
            Object.keys(memoryFailed).forEach(function (c) { byCid[c] = !byCid[c] || memoryFailed[c].at > byCid[c].at ? memoryFailed[c] : byCid[c]; });
            return Object.keys(byCid).map(function (c) { return byCid[c]; }).sort(function (a, b) { return a.shot.t - b.shot.t; });
        };
        const writeFailed = function (shot, reason) {
            const f = { shot: shot, reason: reason, at: Date.now() };
            if (store.set(FAILED + shot.cid, JSON.stringify(f))) delete memoryFailed[shot.cid];
            else { memoryFailed[shot.cid] = f; status.storageFull = true; }
        };
        const headers = function () { const h = { 'Content-Type': 'application/json' }, id = deviceId(); if (id) h['x-user-id'] = id; return h; };
        const base = function () { return (root.ArcadeAPI && root.ArcadeAPI.base) || ''; };
        let busy = false, timer = null, delay = 30000, status = { lastOk: null, lastError: null, bankTotal: null, blocked: false, storageFull: false };

        api.cidFor = function (shot) { return shot.cid || legacyCid(deviceId(), shot.t); };
        api.pending = function () { return readBox().length; };
        api.status = function () {
            return Object.assign({ pending: readBox().length, failed: readFailed().length, inMemory: Object.keys(memory).length + Object.keys(memoryFailed).length }, status);
        };
        api.failed = function () { return readFailed(); };
        // the refused shots go back to the outbox, to be sent again (the server's rules may take them now); they stay listed until then
        api.retryFailed = function () {
            readFailed().forEach(function (f) { writeOne(Object.assign({}, f.shot)); store.remove(FAILED + f.shot.cid); delete memoryFailed[f.shot.cid]; });
            changed();
            return api.flush();
        };
        // every waiting and failed shot of this device as a file the player saves (a copy: nothing is removed)
        api.exportText = function () { return exportFile(readBox(), readFailed()); };
        api.exportDownload = function () {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([api.exportText()], { type: 'application/json' }));
            a.download = 'golf-shots-waiting-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        };
        // a shot booked or changed: into the outbox, then sent when possible
        api.enqueue = function (shot) {
            if (!shot || typeof shot.t !== 'number') return;
            const s = Object.assign({}, shot);
            s.cid = api.cidFor(s);
            if (!s.edited) s.edited = s.t;
            delete s.landX; delete s.landZ;   // where it landed in this course's scene: no use elsewhere
            writeOne(s);
            api.bagFromOutbox();
            changed();
            schedule(50);
        };
        // the shots of this device from before the shot bank go in once (the ids make a second time harmless)
        api.migrate = function () {
            if (store.get(LEGACY) === '1' || !deviceId()) return 0;
            const old = legacyShots(store, deviceId());
            old.forEach(function (s) { if (!readOne(s.cid)) writeOne(s); });
            store.set(LEGACY, '1');
            return old.length;
        };
        function schedule(ms) { clearTimeout(timer); timer = setTimeout(api.flush, ms); }
        // send the outbox, a batch at a time; on any failure it stays and is tried again later (longer and longer, at most 5 minutes)
        // A flush asked for while another runs waits for that one (and gets its answer), instead of returning at once: a caller such as
        // Training Lab reads the server after it, and must not read before the shots already on their way have arrived
        let inflight = null;
        api.flush = function () {
            if (!deviceId()) return Promise.resolve(false);
            if (inflight) return inflight;
            inflight = flushOnce().finally(function () { inflight = null; });
            return inflight;
        };
        async function flushOnce() {
            busy = true;
            try {
                let box = readBox();
                while (box.length) {
                    const sent = box.slice(0, BATCH);
                    let res;
                    try { res = await root.fetch(base() + '/api/shots/sync', { method: 'POST', headers: headers(), body: JSON.stringify({ shots: sent }) }); }
                    catch (e) { status.lastError = 'offline'; throw e; }
                    if (res.status === 401) { status.blocked = true; status.lastError = 'not_this_device'; return false; }
                    if (!res.ok) { status.lastError = 'server_' + res.status; throw new Error('server ' + res.status); }
                    const answer = await res.json();
                    // stored: out of the outbox; refused: to the failed queue with its reason; changed meanwhile (this tab or another): stays
                    const current = {};
                    sent.forEach(function (x) { const c = readOne(x.cid); if (c) current[x.cid] = c; });
                    const out = settle(current, sent, answer);
                    out.stored.forEach(removeOne);
                    out.failed.forEach(function (f) { writeFailed(f.shot, f.reason); removeOne(f.shot.cid); });
                    box = readBox();
                    changed();
                    status.lastOk = Date.now(); status.lastError = null; status.blocked = false;
                    if (!out.stored.length && !out.failed.length) break;   // nothing moved: do not loop
                }
                delay = 30000;
                await api.refreshBag();
                return true;
            } catch (e) {
                delay = Math.min(300000, delay * 2);
                if (readBox().length) schedule(delay);
                return false;
            } finally { busy = false; }
        }
        // the bag from the shot bank (every device of the player), with what is still in the outbox
        api.refreshBag = async function () {
            if (!deviceId() || !root.PlayerBag || !root.PlayerBag.replace) return false;
            try {
                const res = await root.fetch(base() + '/api/bag', { headers: headers() });
                if (!res.ok) return false;
                const j = await res.json();
                if (!j || !Array.isArray(j.shots)) return false;   // no database (local dev mode answers [])
                api._serverBag = j.shots;
                root.PlayerBag.replace(mergeBag(j.shots, readBox(), root.PlayerBag));
                return true;
            } catch (e) { return false; }
        };
        // the bag while the server is not reached: the last server bag (if any) with the outbox
        api.bagFromOutbox = function () {
            if (!root.PlayerBag || !root.PlayerBag.replace || !api._serverBag) return;
            root.PlayerBag.replace(mergeBag(api._serverBag, readBox(), root.PlayerBag));
        };
        api.bankCount = async function () {
            try {
                const res = await root.fetch(base() + '/api/shots?limit=1', { headers: headers() });
                if (!res.ok) return null;
                const j = await res.json();
                status.bankTotal = j && typeof j.total === 'number' ? j.total : null;
                return status.bankTotal;
            } catch (e) { return null; }
        };
        // joining devices: a code from this device for another one, or another device's code typed in here
        api.linkCode = async function () {
            const res = await root.fetch(base() + '/api/devices/link-code', { method: 'POST', headers: headers(), body: '{}' });
            const j = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(j.error || ('server ' + res.status));
            return j;
        };
        api.link = async function (code) {
            await api.flush();   // what this device has goes first, so it joins the account with it
            const res = await root.fetch(base() + '/api/devices/link', { method: 'POST', headers: headers(), body: JSON.stringify({ code: code }) });
            const j = await res.json().catch(function () { return {}; });
            if (!res.ok) { const e = new Error(j.error || ('server ' + res.status)); e.status = res.status; throw e; }
            await api.refreshBag();
            return j;
        };
        api.start = function () {
            api.migrate();
            api.flush();
            root.addEventListener('online', function () { delay = 30000; schedule(100); });
            setInterval(function () { if (readBox().length && !busy) api.flush(); }, 60000);
        };
    }

    root.ShotSync = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
