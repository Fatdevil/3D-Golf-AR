// ================================================================
//  SHOT REFERENCE — what a launch monitor itself made of a shot (its own carry, total and side), kept apart from the game's ball flight,
//  so the ball flight can be checked against it (shot-diagnostics.js). Used by server.js (the shot_references table); no DB, no DOM.
//
//  A reference comes from one of two places:
//    live     with the shot from the bridge (gspro-bridge/protocol.js lmResult: Open Connect's optional CarryDistance, yards)
//    import   a CSV file from the launch monitor's own app, matched to the shots of the shot bank (match() below)
//  Each value is kept as it came (value and unit) and in metres. Side is across the target line, right positive, as everywhere in the game.
//  Two kinds (quality), never mixed in a comparison:
//    lm_calculated     the launch monitor's own software worked it out from what it measured: a second model, not where the ball came down
//    measured_landing  where the ball was seen to come down (a radar that tracked the whole flight, a measured landing spot)
//  A reference is written once: the same source cannot overwrite it, and nothing here touches the shot, its score or its test.
// ================================================================
'use strict';

const V = require('./physics-validation/validate.js');

const YD = 1.09361;                 // yards per metre
const QUALITIES = ['lm_calculated', 'measured_landing'];
const LIMITS = { carry: [0, 500], total: [0, 600], side: [-300, 300] };   // metres, as for the shot bank's own distances
const UNITS = { m: 1, yd: 1 / YD };
const MAX_ROWS = 2000;

function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function cleanSource(s) { return typeof s === 'string' && /^[A-Za-z0-9 ._:()\/-]{1,64}$/.test(s.trim()) ? s.trim() : null; }
function round(v, d) { const k = Math.pow(10, d); return Math.round(v * k) / k; }

// One value as it came ({ value, unit }) -> { m, orig } | null (missing) | false (present but not a distance a shot can have)
function distance(x, key) {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'object' || num(x.value) === null || !UNITS[x.unit]) return false;
  const m = x.value * UNITS[x.unit];
  if (m < LIMITS[key][0] || m > LIMITS[key][1]) return false;
  return { m: round(m, 2), orig: { value: x.value, unit: x.unit } };
}

// normalizeRef(input) -> { ok, ref: { source, quality, carry_m, total_m, side_m, orig } } | { ok: false, reason }. input as the bridge sends
// it (lmResult): { source, quality, carry: { value, unit }, total: {...}, side: {...} }; a value it lacks stays null, never a zero.
function normalizeRef(input) {
  const r = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!r) return { ok: false, reason: 'not_a_reference' };
  const source = cleanSource(r.source);
  if (!source) return { ok: false, reason: 'bad_source' };
  if (QUALITIES.indexOf(r.quality) < 0) return { ok: false, reason: 'bad_quality' };
  const out = { source: source, quality: r.quality, carry_m: null, total_m: null, side_m: null, orig: {} };
  for (const k of ['carry', 'total', 'side']) {
    const d = distance(r[k], k);
    if (d === false) return { ok: false, reason: 'bad_' + k };
    if (d) { out[k + '_m'] = d.m; out.orig[k] = d.orig; }
  }
  if (out.carry_m === null && out.total_m === null && out.side_m === null) return { ok: false, reason: 'no_value' };
  return { ok: true, ref: out };
}

// ---- import -------------------------------------------------------------------------------------------------------------------------
// parseImport(text, opts) -> { rows, skipped, refused, units }. opts: { name, distanceUnit ('m' | 'yd', for distances whose unit the file
// does not say), sideSign ('right_positive' | 'left_positive', for a side written as a plain number) }. A distance whose unit is neither in the
// file nor given is not guessed: the file is refused. rows: { line, shotNumber, ballSpeedMph, launchDeg, spinRpm, hlaDeg, carry, total, side }
// (carry/total/side as { value, unit }, side right positive).
function parseImport(text, opts) {
  opts = opts || {};
  if (typeof text !== 'string' || !text.trim()) return { rows: [], skipped: [], refused: 'empty_file', units: {} };
  const p = V.parseCsv(text, { name: opts.name || 'import' });
  if (p.refused) return { rows: [], skipped: p.skipped, refused: /physics/.test(p.refused) ? 'game_export' : 'no_columns', units: p.units || {} };
  const fallback = UNITS[opts.distanceUnit] ? opts.distanceUnit : null;
  // the player's unit is only for a column that says none: a unit the file names but this import does not take (feet, a speed) refuses the file
  const named = function (k) { return p.columns[k] !== undefined && p.units && p.units[k] ? p.units[k] : null; };
  const odd = ['carry', 'total', 'side'].filter(function (k) { return named(k) && !UNITS[named(k)]; });
  if (odd.length) return { rows: [], skipped: p.skipped, refused: 'unsupported_distance_unit', units: { carry: named('carry'), total: named('total'), side: named('side') } };
  const unit = function (k) { return named(k) || fallback; };
  const units = { carry: unit('carry'), total: p.columns.total !== undefined ? unit('total') : null, side: p.columns.side !== undefined ? unit('side') : null };
  if (!units.carry || (p.columns.total !== undefined && !units.total) || (p.columns.side !== undefined && !units.side)) {
    return { rows: [], skipped: p.skipped, refused: 'unknown_distance_unit', units: units };
  }
  const flip = opts.sideSign === 'left_positive' ? -1 : 1;
  if (p.rows.length > MAX_ROWS) return { rows: [], skipped: p.skipped, refused: 'too_many_rows', units: units };
  const rows = p.rows.map(function (r) {
    const side = r.orig.side ? (r.orig.side.explicit ? r.orig.side.value : flip * r.orig.side.value) : null;
    return { line: r.line, shotNumber: r.shotNumber === undefined ? null : r.shotNumber, ballSpeedMph: r.ballSpeedMph, launchDeg: r.launchDeg, spinRpm: r.spinRpm,
             hlaDeg: r.orig.hla,   // an empty cell is no start line, never 0°
             carry: { value: r.orig.carry, unit: units.carry }, total: r.orig.total === null ? null : { value: r.orig.total, unit: units.total },
             side: side === null ? null : { value: side, unit: units.side } };
  });
  return { rows: rows, skipped: p.skipped, refused: null, units: units };
}

// How close a row's launch values must be to a shot's for the two to be the same shot: the file and the bridge have the same launch monitor's
// numbers, only rounded (0.1 mph or 0.1 m/s, 0.1°, whole rpm)
const TOL = { ballSpeedMph: 0.5, launchDeg: 0.5, spinAbs: 50, spinRel: 0.02, hlaDeg: 1.0 };
function fits(row, shot) {
  if (num(shot.ballSpeed) === null || num(shot.launch) === null) return false;
  if (Math.abs(row.ballSpeedMph - shot.ballSpeed) > TOL.ballSpeedMph) return false;
  if (Math.abs(row.launchDeg - shot.launch) > TOL.launchDeg) return false;
  if (num(row.spinRpm) !== null && num(shot.spin) !== null && !(shot.estimated || []).includes('totalSpinRpm') &&
      Math.abs(row.spinRpm - shot.spin) > Math.max(TOL.spinAbs, TOL.spinRel * row.spinRpm)) return false;
  if (num(row.hlaDeg) !== null && num(shot.hla) !== null && !(shot.estimated || []).includes('azimDeg') && Math.abs(row.hlaDeg - shot.hla) > TOL.hlaDeg) return false;
  // the launch monitor's own shot number, when both have it, must be the same
  const sn = shot.raw ? num(shot.raw.shotNumber) : null;   // a shot without its raw message (an older one) has no number: null, never undefined
  if (num(row.shotNumber) !== null && sn !== null && row.shotNumber !== sn) return false;
  return true;
}
// match(rows, shots) -> { matched: [{ row, cid }], unmatched: [{ line, reason }] }. shots: the shot bank's launch monitor shots (toClient)
// in the time span the player picked. A row is matched only when it fits exactly one shot and that shot fits no other row: anything less
// certain is left unmatched with its reason, never guessed.
//   no_candidate  no shot has these launch values
//   ambiguous     more than one shot has them
//   shared        another row of the file fits the same shot
function match(rows, shots) {
  const lm = (shots || []).filter(function (s) { return s && s.source === 'LM'; });
  const cand = rows.map(function (r) { return lm.filter(function (s) { return fits(r, s); }).map(function (s) { return s.cid; }); });
  const claims = {};
  cand.forEach(function (c) { c.forEach(function (cid) { claims[cid] = (claims[cid] || 0) + 1; }); });
  const matched = [], unmatched = [];
  rows.forEach(function (r, i) {
    const c = cand[i];
    if (!c.length) unmatched.push({ line: r.line, reason: 'no_candidate' });
    else if (c.length > 1) unmatched.push({ line: r.line, reason: 'ambiguous', candidates: c.length });
    else if (claims[c[0]] > 1) unmatched.push({ line: r.line, reason: 'shared' });
    else matched.push({ row: r, cid: c[0] });
  });
  return { matched: matched, unmatched: unmatched };
}

module.exports = { QUALITIES: QUALITIES, LIMITS: LIMITS, TOL: TOL, MAX_ROWS: MAX_ROWS, YD: YD, normalizeRef: normalizeRef, parseImport: parseImport, match: match, fits: fits, cleanSource: cleanSource };
