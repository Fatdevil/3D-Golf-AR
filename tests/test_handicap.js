/**
 * Handicapslag på scorekortet (arcade-handicap.js): samma räkning för en enskild bana och för en samling plattor.
 *   - den delade funktionen ger exakt samma slag som den räkning som låg inbyggd i scorekortet (jämförd över många handicap och slagindex)
 *   - kända fall, och att slagen läggs på de svåraste hålen i hela samlingen (inte på varje platta för sig)
 * Run: node tests/test_handicap.js
 */
const fs = require('fs');
const path = require('path');
const H = require('../arcade-handicap.js');

let failed = 0;
function check(name, ok, detail) { console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; }

// the count that used to sit inside the scorecard, copied as it was
function oldStrokes(hcp, courseStrokeIndex, playableIdx) {
  const playingHcp = Math.round(hcp * Math.min(1, playableIdx.length / 18));
  const siRank = [];
  const order = [];
  for (const k of playableIdx) order.push({ k: k, si: courseStrokeIndex ? (courseStrokeIndex[k] || 99) : (k + 1) });
  order.sort((a, b) => a.si - b.si || a.k - b.k);
  order.forEach((o, r) => { siRank[o.k] = r + 1; });
  const out = {};
  for (const i of playableIdx) out[i] = Math.floor(playingHcp / playableIdx.length) + (siRank[i] <= (playingHcp % playableIdx.length) ? 1 : 0);
  return out;
}

let same = true, n = 0, detail = '';
const sis = [null, [1, 2, 3], [3, 1, 2], [2, 3, 1, 4, 6, 5], [6, 5, 4, 3, 2, 1, 9, 8, 7], [0, 2, 1]];
for (const si of sis) for (const holes of [[0, 1, 2], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6, 7, 8], [1, 2], [0, 2, 4], [0]]) for (let hcp = 0; hcp <= 54; hcp += 1.5) {
  const a = oldStrokes(hcp, si, holes), b = H.strokesPerHole(hcp, si, holes); n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { same = false; detail = 'hcp ' + hcp + ' si ' + JSON.stringify(si) + ' holes ' + holes.join(','); }
}
check('samma slag som den gamla räkningen i scorekortet (' + n + ' kombinationer av handicap, slagindex och spelade hål)', same, detail);

const eighteen = Array.from({ length: 18 }, (_, i) => i);
check('18 hål, handicap 18: ett slag på varje hål', eighteen.every(i => H.strokesPerHole(18, null, eighteen)[i] === 1));
check('18 hål, handicap 5: fem slag, på de fem svåraste (slagindex 1-5)', (() => {
  const si = eighteen.map(i => 18 - i);   // hole 17 is SI 1
  const s = H.strokesPerHole(5, si, eighteen);
  return eighteen.filter(i => s[i] === 1).join(',') === '13,14,15,16,17' && eighteen.every(i => s[i] <= 1);
})());
check('en samling om 6 hål, handicap 18: 6 slag (6/18 av handicapet), ett per hål', (() => { const s = H.strokesPerHole(18, [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5]); return [0, 1, 2, 3, 4, 5].every(i => s[i] === 1); })());
// slagindex över hela samlingen: hål 5 (platta 2) är det svåraste, hål 0 (platta 1) näst svåraste: ett slag går till hål 5, två slag till 5 och 0
const collSI = [2, 5, 6, 4, 3, 1];
const one = H.strokesPerHole(3, collSI, [0, 1, 2, 3, 4, 5]), two = H.strokesPerHole(6, collSI, [0, 1, 2, 3, 4, 5]);
check('slagen går till de svåraste hålen i hela samlingen, inte per platta: 1 slag => hål 6 (SI 1), 2 slag => hål 6 och hål 1 (SI 2)', JSON.stringify(Object.keys(one).filter(k => one[k] === 1)) === '["5"]' && JSON.stringify(Object.keys(two).filter(k => two[k] === 1)) === '["0","5"]', JSON.stringify(one) + ' ' + JSON.stringify(two));
check('utan handicap eller utan hål blir det inga slag', Object.keys(H.strokesPerHole(null, null, [0, 1, 2])).length === 0 && Object.keys(H.strokesPerHole(12, null, [])).length === 0);

// scorekortet använder den delade funktionen, och samlingens scorekort visar slagindex och nettoresultat
const arcade = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
check('arcade.html laddar arcade-handicap.js', /<script src="arcade-handicap\.js\?v=1"><\/script>/.test(arcade));
check('både banans och samlingens scorekort räknar slag med HandicapStrokes.strokesPerHole', (arcade.match(/HandicapStrokes\.strokesPerHole\(/g) || []).length === 2);
check('samlingens scorekort visar slagindex (SI) och nettoresultat (NET) från samlingens stroke_index', /globalSI = Array\.isArray\(col\.stroke_index\)/.test(arcade) && /NET<\/td>/.test(arcade.slice(arcade.indexOf('function renderCollectionScorecard'), arcade.indexOf('function renderScorecard'))));

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
