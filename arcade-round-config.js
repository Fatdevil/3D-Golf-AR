/**
 * The round configuration (window.RoundConfig): one object that says how a round is played. The setup popup builds it when a round starts
 * (commitSettingsAndStart in arcade.html), and a collection round carries it from plate to plate, so the settings are chosen once for the
 * whole course. Later the setup page and the server (tournaments, online play) are to build and read the same object.
 *
 *   {
 *     v: 1,                                  version: an object of another version is not read (the popup is shown as before)
 *     mode: 'local', format: 'stroke',       the only ones today (room for online play, match play, skins)
 *     ruleset: 'standard' | 'tournament',    tournament: gimme at most 12 ft, no mulligans (enforced here, whatever the rules say)
 *     course: { code, collection: { id, plates: [{ code, version }] } | null },
 *     players: [{ name, tee, hcp, slot }],   1 to 4; tee red / yellow / white / black; hcp 0-54 or null
 *     rules: { gimmeDist, autoPutt, puttAssist, mulligans, autoConcede },
 *     conditions: { windStrength, greenStimp, greenFirmness, altitude, temperatureC }
 *   }
 *
 * normalize() is the only way in: an unknown key is dropped, a number is clamped to its range, a value not in its list falls back to the
 * default, and the tournament limits are applied after everything else (so a stored object cannot give a tournament mulligans).
 * Pure: no page needed (tests/test_round_config.js).
 */
(function (root) {
    'use strict';

    const VERSION = 1;
    const TEES = ['red', 'yellow', 'white', 'black'];
    const AUTO_PUTT = ['TOUR_PRO', 'FIXED', 'OFF'];
    const PUTT_ASSIST = ['FULL', 'SLOPE', 'OFF'];
    const CONCEDE = [99, 2, 3];            // 99: off; else par + n (the popup's choices)
    const FIRMNESS = ['SOFT', 'NORMAL', 'FIRM'];
    const TOURNAMENT_GIMME_MAX = 12;
    const MAX_PLAYERS = 4;

    const DEFAULT_RULES = { gimmeDist: 10, autoPutt: 'TOUR_PRO', puttAssist: 'FULL', mulligans: true, autoConcede: 99 };
    const DEFAULT_CONDITIONS = { windStrength: 0, greenStimp: 10, greenFirmness: 'NORMAL', altitude: 0, temperatureC: 15 };

    function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    function num(v, lo, hi, def, step) {
        let n = typeof v === 'string' && v.trim() !== '' ? Number(v) : (typeof v === 'number' ? v : NaN);
        if (!isFinite(n)) return def;
        n = Math.min(hi, Math.max(lo, n));
        return step ? Math.round(n / step) * step : n;
    }
    function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
    function text(v, max, def) { const s = typeof v === 'string' ? v.trim().slice(0, max) : ''; return s || def; }

    function normPlayers(list) {
        const out = (Array.isArray(list) ? list : []).slice(0, MAX_PLAYERS).map(function (p, i) {
            p = obj(p);
            const hcp = p.hcp === null || p.hcp === undefined || p.hcp === '' ? null : num(p.hcp, 0, 54, null, 0.1);
            const slot = num(p.slot, 0, MAX_PLAYERS - 1, i, 1);
            return { name: text(p.name, 40, 'Player ' + (i + 1)), tee: oneOf(p.tee, TEES, 'yellow'), hcp: hcp === null ? null : +hcp.toFixed(1), slot: slot };
        });
        return out.length ? out : [{ name: 'Player 1', tee: 'yellow', hcp: null, slot: 0 }];
    }

    function normCourse(c) {
        c = obj(c);
        const code = text(c.code, 64, null);
        let collection = null;
        const col = obj(c.collection);
        const id = text(col.id === undefined || col.id === null ? '' : String(col.id), 64, null);
        if (id) {
            const plates = (Array.isArray(col.plates) ? col.plates : []).slice(0, 12).map(function (p) {
                p = obj(p);
                const v = num(p.version, 1, 1e9, null, 1);
                return { code: text(p.code, 64, null), version: v };
            }).filter(function (p) { return p.code; });
            collection = { id: id, plates: plates };
        }
        return { code: code ? code.toUpperCase() : null, collection: collection };
    }

    // the one way in: anything else (another version, not an object) is null
    function normalize(raw) {
        if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
        const r = obj(raw.rules), c = obj(raw.conditions);
        const cfg = {
            v: VERSION,
            mode: 'local',
            format: 'stroke',
            ruleset: raw.ruleset === 'tournament' ? 'tournament' : 'standard',
            course: normCourse(raw.course),
            players: normPlayers(raw.players),
            rules: {
                gimmeDist: num(r.gimmeDist, 4, 20, DEFAULT_RULES.gimmeDist, 1),
                autoPutt: oneOf(r.autoPutt, AUTO_PUTT, DEFAULT_RULES.autoPutt),
                puttAssist: oneOf(r.puttAssist, PUTT_ASSIST, DEFAULT_RULES.puttAssist),
                mulligans: typeof r.mulligans === 'boolean' ? r.mulligans : DEFAULT_RULES.mulligans,
                autoConcede: oneOf(num(r.autoConcede, 0, 99, DEFAULT_RULES.autoConcede, 1), CONCEDE, DEFAULT_RULES.autoConcede)
            },
            conditions: {
                windStrength: num(c.windStrength, 0, 4, DEFAULT_CONDITIONS.windStrength, 1),
                greenStimp: num(c.greenStimp, 6, 14, DEFAULT_CONDITIONS.greenStimp, 0.5),
                greenFirmness: oneOf(c.greenFirmness, FIRMNESS, DEFAULT_CONDITIONS.greenFirmness),
                altitude: num(c.altitude, -500, 5000, DEFAULT_CONDITIONS.altitude, 1),
                temperatureC: num(c.temperatureC, -5, 40, DEFAULT_CONDITIONS.temperatureC, 1)
            }
        };
        // the tournament's limits come last: no setting above can lift them
        if (cfg.ruleset === 'tournament') {
            cfg.rules.gimmeDist = Math.min(cfg.rules.gimmeDist, TOURNAMENT_GIMME_MAX);
            cfg.rules.mulligans = false;
        }
        return cfg;
    }

    // from the game's settings (window.matchSettings), the players and the course
    function fromMatchSettings(ms, players, course) {
        ms = obj(ms);
        return normalize({
            v: VERSION,
            ruleset: ms.tournamentMode ? 'tournament' : 'standard',
            course: course,
            players: players,
            rules: { gimmeDist: ms.gimmeDist, autoPutt: ms.autoPutt, puttAssist: ms.puttAssist, mulligans: ms.mulligans, autoConcede: ms.autoConcede },
            conditions: { windStrength: ms.windStrength, greenStimp: ms.greenStimp, greenFirmness: ms.greenFirmness, altitude: ms.altitude, temperatureC: ms.temperatureC }
        });
    }

    // the game's settings from a configuration (the fields window.matchSettings has)
    function toMatchSettings(cfg) {
        const r = cfg.rules, c = cfg.conditions;
        return {
            tournamentMode: cfg.ruleset === 'tournament',
            gimmeDist: r.gimmeDist, autoPutt: r.autoPutt, puttAssist: r.puttAssist, mulligans: r.mulligans, autoConcede: r.autoConcede,
            windStrength: c.windStrength, greenStimp: c.greenStimp, greenFirmness: c.greenFirmness, altitude: c.altitude, temperatureC: c.temperatureC
        };
    }

    // sessionStorage, read through normalize (a broken or old entry is null)
    function save(storage, key, cfg) {
        try { storage.setItem(key, JSON.stringify(cfg)); return true; } catch (e) { return false; }
    }
    function load(storage, key) {
        try { const s = storage.getItem(key); return s ? normalize(JSON.parse(s)) : null; } catch (e) { return null; }
    }

    // the key a collection round keeps its configuration under (the same key style as its players and scores)
    function collectionKey(id) { return 'collection_config_' + String(id).toUpperCase(); }

    const api = {
        VERSION: VERSION, TEES: TEES, AUTO_PUTT: AUTO_PUTT, PUTT_ASSIST: PUTT_ASSIST, CONCEDE: CONCEDE, FIRMNESS: FIRMNESS,
        TOURNAMENT_GIMME_MAX: TOURNAMENT_GIMME_MAX, MAX_PLAYERS: MAX_PLAYERS,
        normalize: normalize, fromMatchSettings: fromMatchSettings, toMatchSettings: toMatchSettings,
        save: save, load: load, collectionKey: collectionKey
    };
    root.RoundConfig = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
