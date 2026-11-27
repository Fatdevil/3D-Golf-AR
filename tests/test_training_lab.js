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
console.log(failed ? '\n' + failed + ' failed' : '\nAll training lab checks passed');
process.exit(failed ? 1 : 0);
