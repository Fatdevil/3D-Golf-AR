// ================================================================
//  TRAINING LAB · CLUB INTELLIGENCE (window.TrainingLab) — the page training.html: how each club of the player's shot bank is, and changes.
//
//  The numbers come from the server (/api/training/clubs, training-stats.js), so every device of the player shows the same. This file
//  only shows them: view(data, state) gives the page's HTML (no DOM, tested in tests/test_training_lab.js), and the page part fetches,
//  sends what still waits in the outbox first (shot-sync.js: a shot hit offline is in the numbers once it is sent), and draws.
//  Every number says how many shots it rests on; under 5 it is shown with "too few shots" and no change is drawn from it, under 20 it is
//  marked as uncertain. Measured and worked-out values are told apart: ball speed and spin are the launch monitor's, carry and side
//  spread the game's ball flight (one version) in standard conditions.
// ================================================================
(function (root) {
    'use strict';
    const YD = 1.09361;
    const TXT = {
        sv: {
            title: 'Training Lab', sub: 'Ditt spel, klubba för klubba, ur din slagbank på alla dina enheter.',
            periods: { session: 'Senaste passet', '30d': '30 dagar', '90d': '90 dagar', all: 'Hela historiken' },
            carry: 'Carry', side: 'Sidledsspridning', mishit: 'Felträffar', ball: 'Bollfart', spin: 'Spinn', shots: 'Slag',
            change: { '30d': 'mot 30 dagarna före', '90d': 'mot 90 dagarna före', session: 'mot passet före', all: '' },
            basedOn: '{n} slag', fewNone: 'För få slag ({n}) för att dra slutsatser', fewLow: 'Osäkert: bara {n} slag',
            valid: '{v} giltiga av {n}', noData: 'Inga launch monitor-slag med klubba i den här perioden.',
            empty: 'Slå några slag på rangen med en launch monitor och välj klubba i panelen, så syns de här.',
            trend: 'Carry vecka för vecka – {c}', trendFew: 'Trenden visas när det finns giltiga slag från minst två veckor.',
            table: 'Alla klubbor', club: 'Klubba', measured: 'uppmätt', worked: 'spelets bollflykt',
            notes: 'Carry och sidledsspridning räknas av spelets bollflykt ({v}) i standardförhållanden (vindstilla, 15 °C, havsnivå, plan mark): sidled är var bollen landar, inte var den stannar på rangen. Bollfart och spinn är launch monitorns egna värden.',
            otherFlight: '{n} slag från en annan eller okänd version av bollflykten räknas inte in i carry och spridning.',
            mishitNote: 'Felträffar (toppade, tunna, korta och shankar) räknas i andelen men inte i carry och spridning, om du inte valt att räkna dem ändå. Slag som ser ut som en annan klubba och felmätningar räknas inte alls.',
            estimatedNote: 'Slag där launch monitorn inte skickade spinn: spinnet och carry räknas inte (de bygger på en uppskattning).',
            others: 'Räknas inte: {sim} svingmätarslag, {practice} inspelsslag, {noclub} slag utan klubba.',
            pending: '{n} slag väntar på uppladdning från den här enheten och ingår inte ännu.',
            offline: 'Servern går inte att nå. Statistiken visas när enheten är ansluten.',
            blocked: 'Den här enheten tillhör ett annat konto: koppla den under ☁ Slagbank på rangen.',
            loading: 'Hämtar…', back: '← Tillbaka', total: '{n} slag i slagbanken',
            cb: { title: 'Golf Combine 9', none: 'Inget genomfört test ännu. Starta det på rangen, i panelens flik 🏆 Combine.', latest: 'Senaste', best: 'Personbästa', last5: 'De fem senaste',
                  levels: { beginner: 'Nybörjare', standard: 'Standard', advanced: 'Avancerad' }, costly: 'Kostade mest senast: {list}', practice: '{n} träningsresultat (inte officiella) räknas inte här.',
                  note: 'Officiella resultat: alla mätvärden uppmätta, poängen räknad av servern. Jämför bara inom samma nivå och samma bollflykt ({v}).',
                  older: '{n} resultat från en äldre version av bollflykten ({list}) jämförs inte med dessa.' },
            va: { title: 'Validering av bollflykten', intro: 'Hur långt spelets bollflykt ({v}) ligger från launch monitorns egna värden, de senaste 90 dagarna. Plus betyder att spelet flyger bollen längre eller mer åt höger.',
                  none: 'Inga referensvärden ännu. Bryggan sparar launch monitorns egen carry när den skickar en, och du kan importera en CSV-export från launch monitorns app nedan.',
                  quality: { lm_calculated: 'Mot launch monitorns egen beräkning (en annan modell, inte uppmätt landning)', measured_landing: 'Mot uppmätt landning' },
                  band: 'Referensens carry', n: 'Slag', carry: 'Carryfel', side: 'Sidledsfel', abs: 'medel av |fel|',
                  excluded: 'Jämförs inte: {est} med uppskattade värden, {unp} utan bryggans mätlista, {mis} felmätningar. {none} slag saknar referens.',
                  few: 'Under 5 slag i ett band: för få för slutsatser.',
                  repeat: 'Upprepbarhet', repeatRow: '{level}: {n} officiella test, snitt {mean}, spridning ±{sd} ({min}–{max})',
                  export: 'Ladda ner rapporten', json: 'JSON', csv: 'CSV (kalkylblad)',
                  imp: 'Importera referensvärden (CSV från launch monitorns app)', file: 'Fil', source: 'Källa (launch monitor eller app)', qualityLabel: 'Vad värdena är',
                  unit: 'Avståndsenhet om filen inte anger den', unitFile: 'Ur filen', sideSign: 'Sidled som tal utan L/R', right: 'Plus är höger', left: 'Plus är vänster',
                  from: 'Slagen från', to: 'till', go: 'Importera och matcha',
                  impNote: 'Ett slag i filen kopplas bara till ett slag i slagbanken när bollfart, utgångsvinkel och spinn (och slagnummer om båda har det) passar exakt ett slag. Osäkra rader sparas inte. Inget slag, ingen poäng och inget test ändras.',
                  result: '{rows} rader: {stored} sparade, {already} fanns redan, {un} inte matchade.', reasons: { no_candidate: 'inget slag med de värdena', ambiguous: 'flera möjliga slag', shared: 'flera rader passar samma slag' },
                  refused: { unknown_distance_unit: 'Filen anger inte avståndsenhet: välj meter eller yards.', game_export: 'Filen är en export från spelet själv (carry från spelets fysik), inte från launch monitorn.',
                             no_columns: 'Filen saknar kolumner för bollfart, utgångsvinkel eller carry.', empty_file: 'Filen är tom.', too_many_rows: 'Filen har för många rader (högst 2000).' },
                  needFile: 'Välj en fil och skriv källan.', failed: 'Importen gick inte att göra. Försök igen när enheten är ansluten.' }
        },
        en: {
            title: 'Training Lab', sub: 'Your game, club by club, from your shot bank on all your devices.',
            periods: { session: 'Latest session', '30d': '30 days', '90d': '90 days', all: 'All history' },
            carry: 'Carry', side: 'Side spread', mishit: 'Mishits', ball: 'Ball speed', spin: 'Spin', shots: 'Shots',
            change: { '30d': 'vs the 30 days before', '90d': 'vs the 90 days before', session: 'vs the session before', all: '' },
            basedOn: '{n} shots', fewNone: 'Too few shots ({n}) to draw conclusions', fewLow: 'Uncertain: only {n} shots',
            valid: '{v} valid of {n}', noData: 'No launch monitor shots with a club in this period.',
            empty: 'Hit some shots on the range with a launch monitor and pick the club in the panel, and they show up here.',
            trend: 'Carry week by week – {c}', trendFew: 'The trend shows once there are valid shots from at least two weeks.',
            table: 'All clubs', club: 'Club', measured: 'measured', worked: 'the game\'s ball flight',
            notes: 'Carry and side spread are worked out by the game\'s ball flight ({v}) in standard conditions (no wind, 15 °C, sea level, flat ground): side is where the ball comes down, not where it stops on the range. Ball speed and spin are the launch monitor\'s own values.',
            otherFlight: '{n} shots from another or unknown version of the ball flight are not in the carry and spread.',
            mishitNote: 'Mishits (topped, thin, short and shanks) count in the rate but not in carry and spread, unless you counted them anyway. Shots that look like another club and misreads do not count at all.',
            estimatedNote: 'Shots where the launch monitor sent no spin: their spin and carry do not count (they rest on an estimate).',
            others: 'Not counted: {sim} swing-meter shots, {practice} approach practice shots, {noclub} shots without a club.',
            pending: '{n} shots are waiting to upload from this device and are not in yet.',
            offline: 'The server cannot be reached. The statistics show when the device is connected.',
            blocked: 'This device belongs to another account: link it under ☁ Shot bank on the range.',
            loading: 'Loading…', back: '← Back', total: '{n} shots in the shot bank',
            cb: { title: 'Golf Combine 9', none: 'No test finished yet. Start one on the range, in the panel\'s 🏆 Combine tab.', latest: 'Latest', best: 'Personal best', last5: 'The last five',
                  levels: { beginner: 'Beginner', standard: 'Standard', advanced: 'Advanced' }, costly: 'Cost the most last time: {list}', practice: '{n} practice results (not official) are not counted here.',
                  note: 'Official results: every value measured, the score worked out by the server. Compare only within one level and one ball flight ({v}).',
                  older: '{n} results from an older version of the ball flight ({list}) are not compared with these.' },
            va: { title: 'Ball flight validation', intro: 'How far the game\'s ball flight ({v}) is from the launch monitor\'s own values, the last 90 days. Plus means the game flies the ball longer or further right.',
                  none: 'No reference values yet. The bridge keeps the launch monitor\'s own carry when it sends one, and you can import a CSV export from the launch monitor\'s app below.',
                  quality: { lm_calculated: 'Against the launch monitor\'s own calculation (another model, not a measured landing)', measured_landing: 'Against measured landings' },
                  band: 'Reference carry', n: 'Shots', carry: 'Carry error', side: 'Side error', abs: 'mean |error|',
                  excluded: 'Not compared: {est} with estimated values, {unp} without the bridge\'s list of measured values, {mis} misreads. {none} shots have no reference.',
                  few: 'Under 5 shots in a band: too few for conclusions.',
                  repeat: 'Repeatability', repeatRow: '{level}: {n} official tests, mean {mean}, spread ±{sd} ({min}–{max})',
                  export: 'Download the report', json: 'JSON', csv: 'CSV (spreadsheet)',
                  imp: 'Import reference values (CSV from the launch monitor\'s app)', file: 'File', source: 'Source (launch monitor or app)', qualityLabel: 'What the values are',
                  unit: 'Distance unit if the file does not say', unitFile: 'From the file', sideSign: 'Side as a number without L/R', right: 'Plus is right', left: 'Plus is left',
                  from: 'Shots from', to: 'to', go: 'Import and match',
                  impNote: 'A shot in the file is tied to a shot in the shot bank only when ball speed, launch and spin (and the shot number if both have it) fit exactly one shot. Uncertain rows are not stored. No shot, score or test is changed.',
                  result: '{rows} rows: {stored} stored, {already} already there, {un} not matched.', reasons: { no_candidate: 'no shot with those values', ambiguous: 'several possible shots', shared: 'several rows fit the same shot' },
                  refused: { unknown_distance_unit: 'The file does not give its distance unit: pick metres or yards.', game_export: 'The file is an export from the game itself (carry from the game\'s physics), not from the launch monitor.',
                             no_columns: 'The file has no columns for ball speed, launch angle or carry.', empty_file: 'The file is empty.', too_many_rows: 'The file has too many rows (at most 2000).' },
                  needFile: 'Pick a file and write the source.', failed: 'The import could not be done. Try again when the device is online.' }
        }
    };
    function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function num(v) { return typeof v === 'number' && isFinite(v); }
    // a number with d decimals, with the decimal comma in Swedish
    let decimalComma = true;
    function f(v, d) { const t = v.toFixed(d); return decimalComma ? t.replace('.', ',') : t; }
    function sgn(v, d) { return (v > 0 ? '+' : (v < 0 ? '−' : '±')) + f(Math.abs(v), d); }
    function fill(s, o) { return s.replace(/\{(\w+)\}/g, function (m, k) { return o[k] === undefined ? m : o[k]; }); }

    // one key number: its value, its change, what it rests on, how reliable it is
    function kpi(o) {
        const few = o.n < 5, low = !few && o.n < 20;
        let h = '<div class="tl-kpi' + (few ? ' tl-few' : '') + '" data-kpi="' + o.key + '"><div class="tl-kpi-label">' + esc(o.label) + ' <span class="tl-src">' + esc(o.src) + '</span></div>';
        h += '<div class="tl-kpi-value">' + (o.value === null ? '–' : esc(o.value)) + '</div>';
        if (o.change !== null && o.change !== undefined && !few) h += '<div class="tl-kpi-change ' + (o.better === null ? '' : (o.better ? 'tl-good' : 'tl-bad')) + '">' + esc(o.change) + ' <span>' + esc(o.changeLabel) + '</span></div>';
        h += '<div class="tl-kpi-n">' + esc(o.basedOn) + '</div>';
        if (few) h += '<div class="tl-warn" role="note">⚠ ' + esc(o.fewNone) + '</div>';
        else if (low) h += '<div class="tl-warn tl-warn-low" role="note">' + esc(o.fewLow) + '</div>';
        return h + '</div>';
    }

    // The weekly carry as a small line chart (SVG), in the player's unit
    function trendSvg(trend, unit, k) {
        if (!trend || trend.length < 2) return null;
        const W = 560, H = 160, P = 34, vals = trend.map(function (p) { return p.carry * k; });
        let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
        const x = function (i) { return P + (W - 2 * P) * (trend.length === 1 ? 0.5 : i / (trend.length - 1)); };
        const y = function (v) { return H - 24 - (H - 44) * (v - lo) / (hi - lo); };
        let path = '', dots = '', labels = '';
        trend.forEach(function (p, i) {
            const v = p.carry * k;
            path += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
            dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4"><title>' + esc(new Date(p.week).toISOString().slice(0, 10) + ': ' + v.toFixed(1) + ' ' + unit + ' (' + p.n + ')') + '</title></circle>';
            labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(weekLabel(p.week)) + '</text>';
        });
        return '<svg class="tl-trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="trend">' +
            '<text x="4" y="' + (y(hi) + 4).toFixed(1) + '">' + hi.toFixed(0) + '</text><text x="4" y="' + (y(lo) + 4).toFixed(1) + '">' + lo.toFixed(0) + '</text>' +
            '<path d="' + path + '" fill="none"/>' + dots + labels + '</svg>';
    }
    // ISO week number of a Monday (UTC)
    function weekLabel(t) {
        const d = new Date(t), day = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - day + 3);
        const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        return 'V' + (1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7));
    }

    // Golf Combine 9: per level the latest result, the personal best and the last five (official only), from /api/combine/results
    function combineHtml(cb, L, state) {
        const T = L.cb, levels = cb && cb.levels ? cb.levels : {}, order = ['beginner', 'standard', 'advanced'];
        const any = order.some(function (l) { return levels[l] && levels[l].count; });
        let h = '<section class="tl-card tl-combine" data-tl="combine"><h2>' + esc(T.title) + '</h2>';
        if (!any) h += '<p class="tl-muted">' + esc(T.none) + '</p>';
        order.forEach(function (l) {
            const x = levels[l];
            if (!x || !x.count) return;
            const day = function (t) { return new Date(t).toISOString().slice(0, 10); };
            h += '<div class="tl-cb-level" data-level="' + l + '"><div class="tl-cb-head"><b>' + esc(T.levels[l]) + '</b><span>' + x.count + '</span></div>';
            h += '<div class="tl-cb-row"><div><span>' + esc(T.latest) + '</span><b data-cb="latest">' + esc(f(x.latest.total, 1)) + '</b><small>' + esc(day(x.latest.finished)) + '</small></div>' +
                 '<div><span>' + esc(T.best) + '</span><b data-cb="best">' + esc(f(x.best.total, 1)) + '</b><small>' + esc(day(x.best.finished)) + '</small></div></div>';
            h += '<div class="tl-cb-bars" aria-label="' + esc(T.last5) + '">' + x.last5.map(function (r) {
                return '<span title="' + esc(day(r.finished) + ': ' + f(r.total, 1)) + '"><i style="height:' + Math.max(4, Math.round(r.total * 0.5)) + 'px"></i><em>' + Math.round(r.total) + '</em></span>';
            }).join('') + '</div>';
            if (x.latest.worst && x.latest.worst.length && x.latest.shots) {
                const k = state.meters ? 1 : YD, u = state.meters ? 'm' : 'yd';
                h += '<div class="tl-muted" data-cb="costly">' + esc(fill(T.costly, { list: x.latest.worst.map(function (i) { return Math.round(x.latest.shots[i].target * k) + ' ' + u; }).join(', ') })) + '</div>';
            }
            h += '</div>';
        });
        const practice = (cb && cb.results || []).filter(function (r) { return !r.official && (!cb.physics || r.physics === cb.physics); }).length;
        if (practice) h += '<p class="tl-muted">' + esc(fill(T.practice, { n: practice })) + '</p>';
        const older = cb && cb.older ? Object.keys(cb.older) : [];
        if (older.length) h += '<p class="tl-muted" data-cb="older">' + esc(fill(T.older, { n: older.reduce(function (s, v) { return s + cb.older[v]; }, 0), list: older.join(', ') })) + '</p>';
        if (any) h += '<p class="tl-muted">' + esc(fill(T.note, { v: cb.physics || '?' })) + '</p>';
        return h + '</section>';
    }

    // The validation of the ball flight (/api/diagnostics, shot-diagnostics.js): per kind of reference and band of carry, how far the game's
    // carry and side are from the launch monitor's own; repeatability of Golf Combine; the export and the import of reference values
    function validationHtml(dg, L, state) {
        const V = L.va, k = state.meters ? 1 : YD, u = state.meters ? 'm' : 'yd';
        const day = function (t) { return new Date(t).toISOString().slice(0, 10); };
        let h = '<section class="tl-card tl-validation" data-tl="validation"><h2>' + esc(V.title) + '</h2>';
        h += '<p class="tl-muted">' + esc(fill(V.intro, { v: (dg && dg.physics) || '?' })) + '</p>';
        const sm = dg && dg.summary, refs = sm ? sm.references : {};
        const kinds = ['measured_landing', 'lm_calculated'].filter(function (q) { return refs[q] && refs[q].length; });
        if (!kinds.length) h += '<p data-va="none">' + esc(V.none) + '</p>';
        kinds.forEach(function (q) {
            h += '<h3 class="tl-va-kind" data-va-kind="' + q + '">' + esc(V.quality[q]) + '</h3><div class="tl-table-wrap"><table class="tl-table"><thead><tr><th>' + esc(V.band) + '</th><th>' + esc(V.n) +
                 '</th><th>' + esc(V.carry) + '</th><th>' + esc(V.abs) + '</th><th>' + esc(V.side) + '</th></tr></thead><tbody>';
            refs[q].forEach(function (b) {
                const few = b.carry.n < 5;
                const lab = b.from === null ? b.band : (b.to === null ? Math.round(b.from * k) + '+ ' + u : Math.round(b.from * k) + '–' + Math.round(b.to * k) + ' ' + u);
                h += '<tr' + (few ? ' class="tl-few-row"' : '') + ' data-va-band="' + esc(b.band) + '"><td>' + esc(lab) + (few ? ' ⚠' : '') + '</td><td>' + b.carry.n + '</td><td>' +
                     (num(b.carry.mean) ? sgn(b.carry.mean * k, 1) + (num(b.carry.sd) ? ' ±' + f(b.carry.sd * k, 1) : '') : '–') + '</td><td>' + (num(b.carry.meanAbs) ? f(b.carry.meanAbs * k, 1) : '–') +
                     '</td><td>' + (num(b.side.mean) ? sgn(b.side.mean * k, 1) + (num(b.side.sd) ? ' ±' + f(b.side.sd * k, 1) : '') : '–') + '</td></tr>';
            });
            h += '</tbody></table></div><div class="tl-unit">' + esc(u) + ' · ⚠ ' + esc(V.few) + '</div>';
        });
        if (sm) h += '<p class="tl-muted" data-va="excluded">' + esc(fill(V.excluded, { est: sm.excluded.estimated, unp: sm.excluded.unproven, mis: sm.excluded.misread, none: sm.excluded.noReference })) + '</p>';
        const rep = sm ? sm.repeatability : {}, lv = ['beginner', 'standard', 'advanced'].filter(function (l) { return rep[l]; });
        if (lv.length) {
            h += '<h3>' + esc(V.repeat) + '</h3>';
            lv.forEach(function (l) {
                const r = rep[l];
                h += '<p data-va-repeat="' + l + '">' + esc(fill(V.repeatRow, { level: L.cb.levels[l], n: r.tests, mean: f(r.total.mean, 1), sd: num(r.total.sd) ? f(r.total.sd, 1) : '–', min: f(r.total.min, 1), max: f(r.total.max, 1) })) + '</p>';
            });
        }
        h += '<div class="tl-va-export"><span>' + esc(V.export) + ':</span> <button data-diag="json">' + esc(V.json) + '</button> <button data-diag="csv">' + esc(V.csv) + '</button></div>';
        // the import
        const now = state.today || Date.now();
        h += '<details class="tl-va-import"' + (state.importResult ? ' open' : '') + '><summary>' + esc(V.imp) + '</summary><form data-va="import" onsubmit="return false">' +
             '<label>' + esc(V.file) + ' <input type="file" name="file" accept=".csv,text/csv"></label>' +
             '<label>' + esc(V.source) + ' <input type="text" name="source" maxlength="64" placeholder="Garmin R10"></label>' +
             '<label>' + esc(V.qualityLabel) + ' <select name="quality"><option value="lm_calculated">' + esc(V.quality.lm_calculated) + '</option><option value="measured_landing">' + esc(V.quality.measured_landing) + '</option></select></label>' +
             '<label>' + esc(V.unit) + ' <select name="distanceUnit"><option value="">' + esc(V.unitFile) + '</option><option value="m">m</option><option value="yd">yd</option></select></label>' +
             '<label>' + esc(V.sideSign) + ' <select name="sideSign"><option value="right_positive">' + esc(V.right) + '</option><option value="left_positive">' + esc(V.left) + '</option></select></label>' +
             '<label>' + esc(V.from) + ' <input type="date" name="from" value="' + day(now - 30 * 86400000) + '"></label><label>' + esc(V.to) + ' <input type="date" name="to" value="' + day(now) + '"></label>' +
             '<button data-va-act="import">' + esc(V.go) + '</button></form><p class="tl-muted">' + esc(V.impNote) + '</p>';
        const ir = state.importResult;
        if (ir) {
            if (ir.error) h += '<div class="tl-banner tl-error" role="alert" data-va="import-error">' + esc(ir.refused ? (V.refused[ir.refused] || ir.refused) : (ir.error === 'need' ? V.needFile : (ir.message || V.failed))) + '</div>';
            else {
                h += '<div class="tl-banner" role="status" data-va="import-result">' + esc(fill(V.result, { rows: ir.rows, stored: ir.stored, already: ir.already, un: ir.unmatched.length })) + '</div>';
                if (ir.unmatched.length) h += '<ul class="tl-muted" data-va="unmatched">' + ir.unmatched.slice(0, 20).map(function (x) { return '<li>' + esc('#' + x.line + ': ' + (V.reasons[x.reason] || x.reason)) + '</li>'; }).join('') + '</ul>';
            }
        }
        return h + '</details></section>';
    }

    // view(data, state): the page's content. data: /api/training/clubs; state: { lang, meters, club, period, pending, error }
    function view(data, state) {
        const L = state.lang === 'en' ? TXT.en : TXT.sv, k = state.meters ? 1 : YD, u = state.meters ? 'm' : 'yd';
        decimalComma = state.lang !== 'en';
        let h = '<nav class="tl-periods" role="group">' + ['session', '30d', '90d', 'all'].map(function (p) {
            return '<button data-period="' + p + '" aria-pressed="' + (state.period === p) + '">' + esc(L.periods[p]) + '</button>';
        }).join('') + '</nav>';
        if (state.pending) h += '<div class="tl-banner" role="status">' + esc(fill(L.pending, { n: state.pending })) + '</div>';
        if (state.error) return h + '<div class="tl-banner tl-error" role="alert">' + esc(state.error === 'blocked' ? L.blocked : L.offline) + '</div>';
        if (!data) return h + '<div class="tl-empty">' + esc(L.loading) + '</div>';
        if (state.combine) h += combineHtml(state.combine, L, state);
        // the validation of the ball flight, last on the page (also when there are no clubs to show)
        const va = state.diag !== undefined ? validationHtml(state.diag, L, state) : '';
        const clubs = (data.clubs || []).filter(function (c) { return c.now.shots > 0; });
        if (!clubs.length) return h + '<div class="tl-empty">' + esc(data.total ? L.noData : L.empty) + '</div>' + va;
        const pick = clubs.filter(function (c) { return c.club === state.club; })[0] || clubs.slice().sort(function (a, b) { return b.now.valid - a.now.valid; })[0];
        h += '<div class="tl-clubs" role="tablist">' + clubs.map(function (c) {
            return '<button role="tab" data-club="' + esc(c.club) + '" aria-selected="' + (c === pick) + '">' + esc(c.club) + '<span>' + c.now.valid + '</span></button>';
        }).join('') + '</div>';
        const n = pick.now, ch = pick.change, cl = L.change[data.period] || '';
        const few = function (x) { return { basedOn: fill(L.basedOn, { n: x }), fewNone: fill(L.fewNone, { n: x }), fewLow: fill(L.fewLow, { n: x }) }; };
        h += '<section class="tl-kpis" aria-label="' + esc(pick.club) + '">';
        h += kpi(Object.assign({ key: 'carry', label: pick.club + ' ' + L.carry, src: L.worked, n: n.carry.n, value: num(n.carry.median) ? f(n.carry.median * k, 1) + ' ' + u : null,
            change: ch && num(ch.carry) ? sgn(ch.carry * k, 1) + ' ' + u : null, better: ch && num(ch.carry) ? null : null, changeLabel: cl }, few(n.carry.n)));
        h += kpi(Object.assign({ key: 'side', label: L.side, src: L.worked, n: n.side.n, value: num(n.side.sd) ? '±' + f(n.side.sd * k, 1) + ' ' + u : null,
            change: ch && num(ch.side) ? sgn(ch.side * k, 1) + ' ' + u : null, better: ch && num(ch.side) ? ch.side < 0 : null, changeLabel: cl }, few(n.side.n)));
        h += kpi(Object.assign({ key: 'mishit', label: L.mishit, src: L.measured, n: n.shots, value: num(n.mishitRate) ? Math.round(n.mishitRate * 100) + ' %' : null,
            change: ch && num(ch.mishitRate) ? sgn(ch.mishitRate * 100, 0) + ' pp' : null, better: ch && num(ch.mishitRate) ? ch.mishitRate < 0 : null, changeLabel: cl }, few(n.shots)));
        h += kpi(Object.assign({ key: 'ball', label: L.ball, src: L.measured, n: n.ballSpeed.n, value: num(n.ballSpeed.mean) ? f(n.ballSpeed.mean, 1) + ' mph' : null,
            change: ch && num(ch.ballSpeed) ? sgn(ch.ballSpeed, 1) + ' mph' : null, better: null, changeLabel: cl }, few(n.ballSpeed.n)));
        h += kpi(Object.assign({ key: 'spin', label: L.spin, src: L.measured, n: n.spin.n, value: num(n.spin.mean) ? Math.round(n.spin.mean) + ' rpm' : null, change: null, better: null, changeLabel: '' }, few(n.spin.n)));
        h += kpi(Object.assign({ key: 'shots', label: L.shots, src: '', n: n.valid, value: fill(L.valid, { v: n.valid, n: n.shots }), change: null, better: null, changeLabel: '' }, few(n.valid)));
        h += '</section>';
        const svg = trendSvg(pick.trend, u, k);
        h += '<section class="tl-card"><h2>' + esc(fill(L.trend, { c: pick.club })) + '</h2>' + (svg || '<p class="tl-muted">' + esc(L.trendFew) + '</p>') + '</section>';
        // every club at a glance
        h += '<section class="tl-card"><h2>' + esc(L.table) + '</h2><div class="tl-table-wrap"><table class="tl-table"><thead><tr><th>' + esc(L.club) + '</th><th>' + esc(L.shots) + '</th><th>' + esc(L.carry) + '</th><th>' + esc(L.side) +
             '</th><th>' + esc(L.mishit) + '</th><th>' + esc(L.ball) + '</th><th>' + esc(L.spin) + '</th></tr></thead><tbody>';
        clubs.forEach(function (c) {
            // a club with too few valid shots: the whole row is muted and says why
            const x = c.now, fewRow = x.valid < 5, cls = (c === pick ? 'tl-row-sel' : '') + (fewRow ? ' tl-few-row' : '');
            h += '<tr' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + (fewRow ? ' title="' + esc(fill(L.fewNone, { n: x.valid })) + '"' : '') + '><td>' + esc(c.club) + (fewRow ? ' ⚠' : '') + '</td><td>' + x.valid + '/' + x.shots + '</td><td>' +
                 (num(x.carry.median) ? f(x.carry.median * k, 1) : '–') +
                 '</td><td>' + (num(x.side.sd) ? '±' + f(x.side.sd * k, 1) : '–') + '</td><td>' + (num(x.mishitRate) ? Math.round(x.mishitRate * 100) + ' %' : '–') +
                 '</td><td>' + (num(x.ballSpeed.mean) ? f(x.ballSpeed.mean, 1) : '–') + '</td><td>' + (num(x.spin.mean) ? Math.round(x.spin.mean) : '–') + '</td></tr>';
        });
        h += '</tbody></table></div><div class="tl-unit">' + esc(u) + ' · mph · rpm' + (clubs.some(function (c) { return c.now.valid < 5; }) ? ' · ⚠ ' + esc(fill(L.fewNone, { n: '<5' })) : '') + '</div></section>';
        // what the numbers are, and what is left out
        const other = clubs.reduce(function (s, c) { return s + c.now.otherFlight; }, 0);
        h += '<section class="tl-notes"><p>' + esc(fill(L.notes, { v: data.version || '?' })) + '</p>';
        if (other) h += '<p>' + esc(fill(L.otherFlight, { n: other })) + '</p>';
        h += '<p>' + esc(L.mishitNote) + '</p><p>' + esc(L.estimatedNote) + '</p>';
        h += '<p>' + esc(fill(L.others, { sim: data.sim || 0, practice: data.practice || 0, noclub: data.noClub || 0 })) + '</p>';
        if (typeof data.total === 'number') h += '<p>' + esc(fill(L.total, { n: data.total })) + '</p>';
        return h + '</section>' + va;
    }

    const api = { view: view, trendSvg: trendSvg, weekLabel: weekLabel, combineHtml: combineHtml, validationHtml: validationHtml, TXT: TXT };

    // ── In the page ──
    if (typeof document !== 'undefined' && document.getElementById && typeof root.fetch === 'function') {
        const state = { period: '30d', club: null, lang: 'sv', meters: true, pending: 0, error: null };
        let data = null, el = null, seq = 0;   // seq: the latest load; an answer to an older one (the player picked another period meanwhile) is dropped
        try { const p = localStorage.getItem('golf_training_period'); if (p && TXT.sv.periods[p]) state.period = p; state.club = localStorage.getItem('golf_training_club'); } catch (e) { /* none */ }
        const draw = function () {
            if (!el) return;
            state.lang = (root.getGolfLanguage && root.getGolfLanguage() === 'en') ? 'en' : 'sv';
            try { state.meters = localStorage.getItem('golfos_units') !== 'yd'; } catch (e) { state.meters = true; }
            el.innerHTML = view(data, state);
        };
        api.load = async function () {
            const mine = ++seq;
            state.error = null; data = null; draw();
            const S = root.ShotSync;
            // what this device still has waiting goes first: a shot hit offline is in the numbers once it is sent
            if (S && S.flush) { try { await S.flush(); } catch (e) { /* the numbers come without them */ } }
            if (mine !== seq) return;
            state.pending = S && S.pending ? S.pending() : 0;
            if (S && S.status && S.status().blocked) { state.error = 'blocked'; draw(); return; }
            const id = (root.GolfAuth && root.GolfAuth.userId) || (function () { try { return localStorage.getItem('golf_os_device_id'); } catch (e) { return null; } })();
            try {
                const res = await root.fetch('/api/training/clubs?period=' + encodeURIComponent(state.period), { headers: id ? { 'x-user-id': id } : {} });
                if (mine !== seq) return;
                if (res.status === 401) { state.error = 'blocked'; draw(); return; }
                const j = await res.json();
                if (mine !== seq) return;
                if (!res.ok || !j || !Array.isArray(j.clubs) || j.period !== state.period) throw new Error('no data');
                // Golf Combine 9 results (the same for every period)
                try {
                    const rc = await root.fetch('/api/combine/results', { headers: id ? { 'x-user-id': id } : {} });
                    const jc = rc.ok ? await rc.json() : null;
                    if (mine !== seq) return;
                    state.combine = jc && jc.levels ? jc : null;
                } catch (e) { state.combine = null; }
                // the validation of the ball flight (the last 90 days)
                try {
                    const rd = await root.fetch('/api/diagnostics', { headers: headers() });
                    const jd = rd.ok ? await rd.json() : null;
                    if (mine !== seq) return;
                    state.diag = jd && jd.summary ? jd : null;
                } catch (e) { state.diag = null; }
                data = j;
            } catch (e) { if (mine !== seq) return; state.error = 'offline'; }
            draw();
        };
        const headers = function (extra) {
            const id = (root.GolfAuth && root.GolfAuth.userId) || (function () { try { return localStorage.getItem('golf_os_device_id'); } catch (e) { return null; } })();
            return Object.assign(id ? { 'x-user-id': id } : {}, extra || {});
        };
        // the report as a file: fetched with the device's id (the page's fetch adds its token), then saved
        api.download = async function (format) {
            const res = await root.fetch('/api/diagnostics' + (format === 'csv' ? '?format=csv' : ''), { headers: headers() });
            if (!res.ok) throw new Error('diagnostics ' + res.status);
            const blob = format === 'csv' ? await res.blob() : new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'golf-validation-' + new Date().toISOString().slice(0, 10) + '.' + (format === 'csv' ? 'csv' : 'json');
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
            return blob;
        };
        api.importFile = async function (form) {
            const fd = new FormData(form), file = form.querySelector('input[type=file]').files[0], source = String(fd.get('source') || '').trim();
            if (!file || !source) { state.importResult = { error: 'need' }; draw(); return state.importResult; }
            try {
                const csv = await file.text();
                const res = await root.fetch('/api/references/import', { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ csv: csv, source: source, quality: fd.get('quality'), distanceUnit: fd.get('distanceUnit') || undefined, sideSign: fd.get('sideSign'), from: fd.get('from'), to: fd.get('to') }) });
                const j = await res.json();
                state.importResult = res.ok ? j : { error: 'refused', refused: j && j.refused, message: res.status === 400 && j && j.error ? j.error : null };
            } catch (e) { state.importResult = { error: 'failed' }; }
            if (!state.importResult.error) return api.load().then(function () { return state.importResult; });
            draw();
            return state.importResult;
        };
        api.state = function () { return Object.assign({}, state); };
        api.data = function () { return data; };
        api.start = function (target) {
            el = target;
            el.addEventListener('click', function (e) {
                const b = e.target.closest('button');
                if (!b) return;
                if (b.dataset.diag) { api.download(b.dataset.diag).catch(function () { state.importResult = { error: 'failed' }; draw(); }); return; }
                if (b.dataset.vaAct === 'import') { api.importFile(b.closest('form')); return; }
                if (b.dataset.period) { state.period = b.dataset.period; try { localStorage.setItem('golf_training_period', state.period); } catch (err) { /* none */ } api.load(); }
                else if (b.dataset.club) { state.club = b.dataset.club; try { localStorage.setItem('golf_training_club', state.club); } catch (err) { /* none */ } draw(); }
            });
            root.addEventListener('golf_lang_changed', draw);
            root.addEventListener('online', function () { api.load(); });
            return api.load();
        };
    }
    root.TrainingLab = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
