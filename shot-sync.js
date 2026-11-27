// ================================================================
//  SHOT SYNC (window.ShotSync) — the range shots of this device go to the player's shot bank on the server (/api/shots, shot-bank-core.js).
//
//  Every shot the range session books is put in an outbox kept on the device and sent from there:
//  at once when the server can be reached, later when it cannot (offline, the server down, no database). A shot leaves the outbox only
//  when the server says it stored it (or refused it as not a shot), so nothing is lost on the way. The outbox is one localStorage key per
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
    const OUTBOX = 'golf_shot_out_', LEGACY = 'golf_shot_legacy_v1', SESSION_PREFIX = 'golf_range_session_', BAG = 'golf_bag_v1';
    const MAX_OUTBOX = 5000, BATCH = 100;

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

    // The outbox: shots waiting for the server, one per cid (a newer copy of the same shot replaces the older), oldest first
    function put(list, shot) {
        const out = list.filter(function (s) { return s.cid !== shot.cid; });
        out.push(shot);
        out.sort(function (a, b) { return a.t - b.t; });
        return out.length > MAX_OUTBOX ? out.slice(out.length - MAX_OUTBOX) : out;
    }
    // after the server answered: the shots it stored or refused leave (a copy edited after it was sent stays, to go again)
    function settle(list, sent, answer) {
        const done = {};
        (answer.stored || []).forEach(function (c) { done[c] = true; });
        (answer.refused || []).forEach(function (r) { if (r && r.cid) done[r.cid] = true; });
        const sentEdit = {};
        sent.forEach(function (s) { sentEdit[s.cid] = s.edited || s.t; });
        return list.filter(function (s) { return !(done[s.cid] && (s.edited || s.t) <= sentEdit[s.cid]); });
    }
    // the bag: the server's entries with the outbox's shots that count (an outbox shot replaces the server's entry of the same time)
    function mergeBag(serverEntries, outbox, Bag) {
        let list = (serverEntries || []).slice();
        outbox.forEach(function (s) { list = list.filter(function (e) { return e.t !== s.t; }); const e = Bag.entryOf(s); if (e) list.push(e); });
        return Bag.trim(list);
    }

    const api = { legacyCid: legacyCid, newCid: newCid, legacyShots: legacyShots, put: put, settle: settle, mergeBag: mergeBag, fnv: fnv,
                  OUTBOX: OUTBOX, LEGACY: LEGACY, BATCH: BATCH, MAX_OUTBOX: MAX_OUTBOX };

    // ── In the page ──
    if (typeof localStorage !== 'undefined' && typeof root.fetch === 'function' && typeof document !== 'undefined') {
        const store = {
            get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
            set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
            remove: function (k) { try { localStorage.removeItem(k); } catch (e) { /* none */ } },
            keys: function () { const out = []; try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) { /* none */ } return out; }
        };
        const deviceId = function () { return (root.GolfAuth && root.GolfAuth.userId) || store.get('golf_os_device_id'); };
        // the outbox: one key per shot (see the top), oldest first
        const readOne = function (cid) { try { return JSON.parse(store.get(OUTBOX + cid) || 'null'); } catch (e) { return null; } };
        const readBox = function () {
            return store.keys().filter(function (k) { return k && k.indexOf(OUTBOX) === 0; }).map(function (k) { return readOne(k.slice(OUTBOX.length)); })
                .filter(function (s) { return s && typeof s.t === 'number'; }).sort(function (a, b) { return a.t - b.t; });
        };
        const writeOne = function (s) {
            const old = readOne(s.cid);
            if (old && (old.edited || old.t) > (s.edited || s.t)) return;   // a later edit of this shot is already waiting
            store.set(OUTBOX + s.cid, JSON.stringify(s));
            const box = readBox();   // a device that never reaches the server: the oldest go first, at MAX_OUTBOX
            if (box.length > MAX_OUTBOX) box.slice(0, box.length - MAX_OUTBOX).forEach(function (o) { store.remove(OUTBOX + o.cid); });
        };
        const headers = function () { const h = { 'Content-Type': 'application/json' }, id = deviceId(); if (id) h['x-user-id'] = id; return h; };
        const base = function () { return (root.ArcadeAPI && root.ArcadeAPI.base) || ''; };
        let busy = false, timer = null, delay = 30000, status = { lastOk: null, lastError: null, bankTotal: null, blocked: false };

        api.cidFor = function (shot) { return shot.cid || legacyCid(deviceId(), shot.t); };
        api.pending = function () { return readBox().length; };
        api.status = function () { return Object.assign({ pending: readBox().length }, status); };
        // a shot booked or changed: into the outbox, then sent when possible
        api.enqueue = function (shot) {
            if (!shot || typeof shot.t !== 'number') return;
            const s = Object.assign({}, shot);
            s.cid = api.cidFor(s);
            if (!s.edited) s.edited = s.t;
            delete s.landX; delete s.landZ;   // where it landed in this course's scene: no use elsewhere
            writeOne(s);
            api.bagFromOutbox();
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
        api.flush = async function () {
            if (busy || !deviceId()) return false;
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
                    // the shots the server stored (or refused) leave, unless this tab or another changed them since they were sent
                    const keep = settle(sent.map(function (x) { return readOne(x.cid) || x; }), sent, answer);
                    sent.forEach(function (x) { if (!keep.some(function (k) { return k.cid === x.cid; })) store.remove(OUTBOX + x.cid); });
                    box = readBox();
                    status.lastOk = Date.now(); status.lastError = null; status.blocked = false;
                    if (!answer.stored || (!answer.stored.length && !(answer.refused || []).length)) break;   // nothing moved: do not loop
                }
                delay = 30000;
                await api.refreshBag();
                return true;
            } catch (e) {
                delay = Math.min(300000, delay * 2);
                if (readBox().length) schedule(delay);
                return false;
            } finally { busy = false; }
        };
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
