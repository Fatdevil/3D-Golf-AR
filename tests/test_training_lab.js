/**
 * Training Lab's page (training-lab.js view): what the player sees for known statistics — the key numbers in the player's unit with the
 * decimal comma, the change only when both sides have enough shots, a warning on every number that rests on too few shots, what is measured
 * and what is the ball flight, and the waiting, offline and empty states. Run: node tests/test_training_lab.js
 */
const S = require('../training-stats.js');
const T = require('../training-lab.js');
let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }
const V = 'flight-2024.1', NOW = Date.UTC(2026, 10, 27, 12), DAY = 86400000;
const shot = o => Object.assign({ source: 'LM', club: '7i', t: NOW - DAY, physics: V, carryStd: 150, offlineStd: 0, ballSpeed: 120, spin: 7000, session: 'S2' }, o);
const shots = Array.from({ length: 20 }, (_, i) => shot({ carryStd: 140 + i, offlineStd: -9.5 + i })).concat(
  Array.from({ length: 5 }, (_, i) => shot({ t: NOW - 40 * DAY, carryStd: 130 + i, session: 'S1' })), [shot({ club: 'PW', carryStd: 110 }), shot({ club: 'PW', carryStd: 111 })]);
const data = Object.assign(S.compute(shots, { period: '30d', now: NOW, version: V }), { total: 27 });
const sv = T.view(data, { lang: 'sv', meters: true, period: '30d', club: '7i' });
const kpi = (html, key) => { const m = html.match(new RegExp('data-kpi="' + key + '">([\\s\\S]*?)</div></div>')); const i = html.indexOf('data-kpi="' + key + '"'); return i < 0 ? '' : html.slice(i, html.indexOf('data-kpi=', i + 10) < 0 ? i + 800 : html.indexOf('data-kpi=', i + 10)); };
check('carry i meter med decimalkomma, och förändringen mot perioden före', /149,5 m/.test(kpi(sv, 'carry')) && /\+17,5 m/.test(kpi(sv, 'carry')) && /mot 30 dagarna före/.test(kpi(sv, 'carry')), kpi(sv, 'carry'));
check('varje nyckeltal säger hur många slag det bygger på', /20 slag/.test(kpi(sv, 'carry')) && /20 slag/.test(kpi(sv, 'side')));
check('carry och spridning märks som spelets bollflykt, bollfart och spinn som uppmätta', /spelets bollflykt/.test(kpi(sv, 'carry')) && /uppmätt/.test(kpi(sv, 'ball')) && /uppmätt/.test(kpi(sv, 'spin')));
const pw = T.view(data, { lang: 'sv', meters: true, period: '30d', club: 'PW' });
check('en klubba med 2 slag: "För få slag (2)" och ingen förändring', /För få slag \(2\)/.test(kpi(pw, 'carry')) && !/tl-kpi-change/.test(pw.slice(pw.indexOf('tl-kpis'), pw.indexOf('</section>'))), kpi(pw, 'carry'));
check('i tabellen är klubbor med för få slag markerade', /tl-few-row[^>]*title="För få slag \(2\)/.test(sv));
const yd = T.view(data, { lang: 'en', meters: false, period: '30d', club: '7i' });
check('yards och engelska: punkt som decimaltecken, 163,5 yd', /163\.5 yd/.test(kpi(yd, 'carry')) && /vs the 30 days before/.test(yd), kpi(yd, 'carry'));
check('fysikens version står i förklaringen', sv.indexOf(V) > 0);
check('väntande slag sägs ut', /3 slag väntar på uppladdning/.test(T.view(data, { lang: 'sv', meters: true, period: '30d', pending: 3 })));
check('offline och fel konto: tydliga meddelanden, inga siffror', /Servern går inte att nå/.test(T.view(null, { lang: 'sv', period: '30d', error: 'offline' })) && /koppla den under/.test(T.view(null, { lang: 'sv', period: '30d', error: 'blocked' })));
check('ingen data: hur man får slag hit', /Slå några slag/.test(T.view({ clubs: [], total: 0 }, { lang: 'sv', period: '30d' })) && /Inga launch monitor-slag/.test(T.view({ clubs: [], total: 5 }, { lang: 'sv', period: '30d' })));
check('perioden som valts är markerad', /data-period="30d" aria-pressed="true"/.test(sv) && /data-period="all" aria-pressed="false"/.test(sv));
const evil = Object.assign({}, data, { clubs: [Object.assign({}, data.clubs[0], { club: '<img src=x onerror=alert(1)>' })] });
check('text från data skrivs aldrig som HTML', T.view(evil, { lang: 'sv', meters: true, period: '30d' }).indexOf('<img src=x') < 0);
check('trenden: en linje med en punkt per vecka (minst två veckor)', /<path d="M/.test(T.trendSvg([{ week: NOW - 7 * DAY, n: 3, carry: 140 }, { week: NOW, n: 4, carry: 145 }], 'm', 1)) && T.trendSvg([{ week: NOW, n: 3, carry: 140 }], 'm', 1) === null);
check('veckonumret (ISO): måndag 23 nov 2026 är vecka 48', T.weekLabel(Date.UTC(2026, 10, 23)) === 'V48' && T.weekLabel(Date.UTC(2026, 0, 5)) === 'V2', T.weekLabel(Date.UTC(2026, 10, 23)));
// the validation card (/api/diagnostics)
const diag = { physics: V, summary: { compared: 6, excluded: { estimated: 2, unproven: 1, misread: 1, noReference: 9, notLm: 0 },
  references: { lm_calculated: [{ band: '40–60 m', from: 40, to: 60, carry: { n: 5, mean: 2.25, median: 2, sd: 1.5, meanAbs: 2.5 }, side: { n: 5, mean: -0.8, sd: 2.1 }, total: { n: 0 } },
                                { band: '120–180 m', from: 120, to: 180, carry: { n: 1, mean: -3, sd: null, meanAbs: 3 }, side: { n: 0, mean: null }, total: { n: 0 } }] },
  repeatability: { standard: { tests: 3, total: { mean: 74, sd: 4, min: 70, max: 78 }, targets: [] } } } };
const va = T.view(data, { lang: 'sv', meters: true, period: '30d', club: '7i', diag: diag, today: NOW });
check('valideringen visar carryfelet per band med tecken och spridning, och sidledsfelet', /data-va-band="40–60 m"[\s\S]*?\+2,3 ±1,5[\s\S]*?−0,8 ±2,1/.test(va), va.slice(va.indexOf('tl-validation'), va.indexOf('tl-validation') + 1500));
check('LM:s egen beräkning sägs inte vara en uppmätt landning', /Mot launch monitorns egen beräkning \(en annan modell, inte uppmätt landning\)/.test(va) && !/data-va-kind="measured_landing"/.test(va));
check('ett band med under 5 slag är markerat', /tl-few-row" data-va-band="120–180 m"/.test(va));
check('det som inte jämförs räknas upp', /2 med uppskattade värden, 1 utan bryggans mätlista, 1 felmätningar\. 9 slag saknar referens/.test(va));
check('upprepbarhet för Combine', /Standard: 3 officiella test, snitt 74,0, spridning ±4,0 \(70,0–78,0\)/.test(va));
check('export som JSON och CSV, och import med enhet, sidledskonvention och tidsperiod', /data-diag="json"/.test(va) && /data-diag="csv"/.test(va) && /name="distanceUnit"/.test(va) && /name="sideSign"/.test(va) &&
  /name="from" value="2026-10-28"/.test(va) && /name="to" value="2026-11-27"/.test(va));
const vyd = T.view(data, { lang: 'en', meters: false, period: '30d', diag: diag, today: NOW });
check('i yards: banden och felen räknas om', /44–66 yd/.test(vyd) && /\+2\.5 ±1\.6/.test(vyd), vyd.slice(vyd.indexOf('tl-validation'), vyd.indexOf('tl-validation') + 1200));
const none = T.view(data, { lang: 'sv', meters: true, period: '30d', diag: { physics: V, summary: { references: {}, excluded: { estimated: 0, unproven: 0, misread: 0, noReference: 4 }, repeatability: {} } }, today: NOW });
check('inga referenser: hur man får in dem', /data-va="none"/.test(none) && /importera en CSV-export/.test(none));
check('valideringen syns också utan klubbor att visa', /tl-validation/.test(T.view({ clubs: [], total: 0 }, { lang: 'sv', period: '30d', diag: diag, today: NOW })));
const res = T.view(data, { lang: 'sv', meters: true, period: '30d', diag: diag, today: NOW, importResult: { rows: 4, stored: 2, already: 0, unmatched: [{ line: 3, reason: 'ambiguous' }, { line: 5, reason: 'no_candidate' }] } });
check('importens resultat: sparade och inte matchade rader med skäl', /4 rader: 2 sparade, 0 fanns redan, 2 inte matchade/.test(res) && /#3: flera möjliga slag/.test(res) && /#5: inget slag med de värdena/.test(res));
check('en avvisad fil förklaras', /Filen anger inte avståndsenhet/.test(T.view(data, { lang: 'sv', meters: true, period: '30d', diag: diag, today: NOW, importResult: { error: 'refused', refused: 'unknown_distance_unit' } })));
check('utan diagnos (ingen inläsning ännu) inget kort', !/tl-validation/.test(sv));
console.log(failed ? '\n' + failed + ' failed' : '\nAll training lab checks passed');
process.exit(failed ? 1 : 0);
