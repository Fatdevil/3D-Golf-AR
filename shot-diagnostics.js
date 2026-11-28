// ================================================================
//  SHOT DIAGNOSTICS — the validation report of Golf Combine 9 and the ball flight: per shot, per test and over many tests, what was
//  measured, where the game's ball flight puts the shot, what it scored, and how far that is from the launch monitor's own values.
//  Used by server.js (/api/diagnostics) with the server's own ball flight (server-physics.js); no DB, no DOM. It only reads: nothing here
//  writes to a shot, a score or a test. Tested in tests/test_shot_diagnostics.js.
//
//  What is compared with what (and nothing else):
//    carry  the game's radial carry (the straight distance from the tee to where it came down, side included) against the launch monitor's
//           carry, which is radial too. Not the distance down the target line: that is what a Combine target is scored on, and is
//           shown apart (along)
//    side   where it came down across the target line, right positive, against the launch monitor's side at landing
//    total  shown, never summed into the carry error: the game's total rolls on a flat fairway, the launch monitor's on its own ground model
//  Both in metres, the game's in standard conditions (no wind, 15 °C, sea level). Delta = the game's minus the reference: + means the game
//  flies it longer (or further right) than the launch monitor says.
//  A launch monitor's own carry (lm_calculated) is a second model, not where the ball came down; a measured landing (measured_landing) is.
//  They are summarised apart. Only shots with every launch value measured (raw.measured, nothing estimated) and no misread are compared.
// ================================================================
'use strict';

const CombineCore = require('./combine-core.js');

const BANDS = [[0, 40], [40, 60], [60, 80], [80, 120], [120, 180], [180, 250], [250, Infinity]];
const CONVENTIONS = {
  units: 'metres (m); ball speed mph, angles degrees, spin rpm',
  side: 'across the target line where the ball came down, right positive (+R)',
  carry: 'radial: straight distance from the tee to the landing point, side included (the game and the launch monitor alike)',
  along: 'distance down the target line to the landing point: what a Golf Combine target is scored on; not compared with a reference',
  delta: 'the game minus the reference: + = the game flies it longer / further right',
  conditions: 'the game: standard conditions (no wind, 15 °C, sea level, flat fairway); the reference: as the launch monitor reports it (often normalised too)',
  quality: 'lm_calculated = the launch monitor\'s own model of the flight; measured_landing = a landing point that was measured. Summarised apart',
  compared: 'only shots whose five launch values were all measured (raw.measured, none estimated) and that were not a misread'
};

function num(v) { return typeof v === 'number' && isFinite(v); }
function r2(v) { return num(v) ? Math.round(v * 100) / 100 : null; }
function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
function sd(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1)); }
function median(a) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function stat(a) { return { n: a.length, mean: r2(mean(a)), median: r2(median(a)), sd: r2(sd(a)), meanAbs: r2(mean(a.map(Math.abs))) }; }

// What a shot's launch values are: measured (all five in the bridge's own list, none estimated), estimated (one filled in by the game),
// unproven (no list from the bridge: an older bridge, or not from a launch monitor), and which of the five are not measured
function measurement(shot) {
  if (!shot || shot.source !== 'LM') return { status: 'not_lm', notMeasured: [] };
  const est = (Array.isArray(shot.estimated) ? shot.estimated : []).filter(function (f) { return CombineCore.NEEDED.indexOf(f) >= 0; });
  const list = shot.raw && Array.isArray(shot.raw.measured) ? shot.raw.measured : null;
  const notMeasured = CombineCore.NEEDED.filter(function (f) { return est.indexOf(f) >= 0 || (list && list.indexOf(f) < 0); });
  if (est.length) return { status: 'estimated', notMeasured: notMeasured, estimated: est };
  if (!list) return { status: 'unproven', notMeasured: CombineCore.NEEDED.slice() };
  return { status: CombineCore.measured(shot) ? 'measured' : 'estimated', notMeasured: notMeasured };
}

// shotDiag(shot, refs, flight): one shot. shot: toClient of the shot bank; refs: its rows of shot_references; flight: { standard, misread,
// version } (server-physics.js)
function shotDiag(shot, refs, flight) {
  const m = measurement(shot);
  const st = flight.standard(shot);
  const ours = st ? { carry: r2(st.carry), along: r2(st.along), side: r2(st.side), total: r2(st.total) } : null;
  const misread = shot.source === 'LM' ? flight.misread(shot) : false;
  const now = flight.version();
  const out = {
    cid: shot.cid, t: shot.t, club: shot.club || null, session: shot.session || null, lmDevice: shot.device || null,
    combine: shot.combine ? { test: shot.combine.test, level: shot.combine.level, index: shot.combine.index, void: shot.combine.void || null } : null,
    status: m.status, notMeasured: m.notMeasured, misread: misread,
    smash: num(shot.ballSpeed) && num(shot.clubSpeed) && shot.clubSpeed > 0 ? r2(shot.ballSpeed / shot.clubSpeed) : null,
    physics: { shot: shot.physics || null, now: now, same: shot.physics === now },
    inputs: { ballSpeed: shot.ballSpeed, launch: shot.launch, spin: shot.spin, spinAxis: shot.spinAxis, hla: shot.hla, clubSpeed: num(shot.clubSpeed) ? shot.clubSpeed : null },
    measuredList: shot.raw && Array.isArray(shot.raw.measured) ? shot.raw.measured.slice() : null,
    shotNumber: shot.raw && num(shot.raw.shotNumber) ? shot.raw.shotNumber : null,
    ours: ours,
    // what the device worked out itself (its own flight version): told apart from the server's, never used for anything
    device: { carryStd: num(shot.carryStd) ? shot.carryStd : null, offlineStd: num(shot.offlineStd) ? shot.offlineStd : null,
              carryDiff: ours && num(shot.carryStd) ? r2(shot.carryStd - ours.carry) : null },
    comparable: m.status === 'measured' && !misread && !!ours,
    refs: (refs || []).map(function (r) {
      const x = { source: r.source, origin: r.origin, quality: r.quality, carry: num(r.carry_m) ? r.carry_m : null, total: num(r.total_m) ? r.total_m : null,
                  side: num(r.side_m) ? r.side_m : null, orig: r.orig || {} };
      x.delta = {
        carry: ours && x.carry !== null ? r2(ours.carry - x.carry) : null,
        side: ours && x.side !== null && num(ours.side) ? r2(ours.side - x.side) : null,
        total: ours && x.total !== null ? r2(ours.total - x.total) : null
      };
      return x;
    })
  };
  return out;
}

// testDiag(shots, level, stored, flight): one Golf Combine test from its shots, worked out again with the server's flight, beside what was
// stored when it finished (stored: the combine_results row as combineRow gives it, or null if it never finished)
function testDiag(testId, shots, level, stored, flight) {
  const res = CombineCore.score(shots, level, flight.landing, { misread: flight.misread });
  const sorted = shots.slice().sort(function (a, b) { return a.t - b.t; });
  const counted = CombineCore.pick(shots, flight.misread);
  const targets = (res ? res.shots : []).map(function (x) {
    const at = sorted.filter(function (s) { return s.combine && s.combine.index === x.index; });
    const c = counted[x.index];
    return {
      index: x.index, target: x.target, counted: c ? c.cid : null, score: num(x.score) ? x.score : null, error: r2(x.error), long: r2(x.long), side: r2(x.side),
      notMeasured: c ? measurement(c).notMeasured : [],
      shots: at.map(function (s) {
        const why = CombineCore.voidReason(s, flight.misread);
        return { cid: s.cid, t: s.t, mark: s.combine.void || null, voidHolds: CombineCore.voided(s, flight.misread), reason: why,
                 role: s === c ? 'counted' : (CombineCore.voided(s, flight.misread) ? 'voided' : 'extra_ignored') };
      })
    };
  });
  const practice = [];
  targets.forEach(function (t) { if (t.counted && t.notMeasured.length) practice.push({ index: t.index, cid: t.counted, notMeasured: t.notMeasured }); });
  const now = flight.version();
  return {
    test: testId, level: level, physics: now, complete: !!(res && res.complete), official: !!(res && res.official), total: res ? res.total : null, missing: res ? res.missing : [],
    practiceReasons: practice,
    retakes: targets.reduce(function (n, t) { return n + t.shots.filter(function (s) { return s.role === 'voided'; }).length; }, 0),
    rejectedVoids: targets.reduce(function (n, t) { return n + t.shots.filter(function (s) { return s.mark && !s.voidHolds; }).length; }, 0),
    extras: targets.reduce(function (n, t) { return n + t.shots.filter(function (s) { return s.role === 'extra_ignored'; }).length; }, 0),
    stored: stored ? { total: stored.total, official: stored.official, physics: stored.physics, finished: stored.finished,
                       samePhysics: stored.physics === now, sameTotal: res && res.total === stored.total, sameOfficial: res && res.official === stored.official } : null,
    targets: targets
  };
}

function bandOf(m) { for (const b of BANDS) if (m >= b[0] && m < b[1]) return b; return null; }
function bandLabel(b) { return b[1] === Infinity ? b[0] + '+ m' : b[0] + '–' + b[1] + ' m'; }

// summary(shots, results, now): over many shots and tests. Per kind of reference and band of the reference's carry: how far the game's
// carry and side are from it. One reference per shot and kind (the live one before an imported one: it came with the shot itself).
// Repeatability: per level, the official tests of this flight (now): the spread of the totals and of each target's error.
function summary(shotDiags, results, now) {
  const excluded = { estimated: 0, unproven: 0, misread: 0, noReference: 0, notLm: 0 };
  const by = {};
  shotDiags.forEach(function (d) {
    if (d.status === 'not_lm') { excluded.notLm++; return; }
    if (!d.refs.length) { excluded.noReference++; return; }
    if (d.status === 'estimated') { excluded.estimated++; return; }
    if (d.status === 'unproven') { excluded.unproven++; return; }
    if (d.misread) { excluded.misread++; return; }
    if (!d.comparable) return;
    const seen = {};
    d.refs.slice().sort(function (a, b) { return (a.origin === 'live' ? 0 : 1) - (b.origin === 'live' ? 0 : 1); }).forEach(function (r) {
      if (seen[r.quality]) return;
      seen[r.quality] = true;
      const q = by[r.quality] || (by[r.quality] = {});
      const b = r.carry !== null ? bandOf(r.carry) : null;
      const key = b ? bandLabel(b) : 'no carry';
      const g = q[key] || (q[key] = { band: b ? [b[0], b[1] === Infinity ? null : b[1]] : null, carry: [], side: [], total: [] });
      if (r.delta.carry !== null) g.carry.push(r.delta.carry);
      if (r.delta.side !== null) g.side.push(r.delta.side);
      if (r.delta.total !== null) g.total.push(r.delta.total);
    });
  });
  const references = {};
  Object.keys(by).forEach(function (q) {
    references[q] = BANDS.map(bandLabel).concat(['no carry']).filter(function (k) { return by[q][k]; }).map(function (k) {
      const g = by[q][k];
      return { band: k, from: g.band ? g.band[0] : null, to: g.band ? g.band[1] : null, carry: stat(g.carry), side: stat(g.side), total: stat(g.total) };
    });
  });
  const repeat = {};
  Object.keys(CombineCore.LEVELS).forEach(function (level) {
    const mine = (results || []).filter(function (r) { return r.level === level && r.official && r.physics === now; });
    if (!mine.length) return;
    const totals = mine.map(function (r) { return r.total; });
    repeat[level] = {
      tests: mine.length, total: { mean: r2(mean(totals)), sd: r2(sd(totals)), min: Math.min.apply(null, totals), max: Math.max.apply(null, totals) },
      targets: CombineCore.LEVELS[level].map(function (D, i) {
        const e = [], s = [];
        mine.forEach(function (r) { const x = (r.shots || [])[i]; if (x && num(x.error)) { e.push(x.error); s.push(x.score); } });
        return { index: i, target: D, n: e.length, score: { mean: r2(mean(s)), sd: r2(sd(s)) }, error: { mean: r2(mean(e)), sd: r2(sd(e)) } };
      })
    };
  });
  return { references: references, excluded: excluded, repeatability: repeat, compared: shotDiags.filter(function (d) { return d.comparable && d.refs.length; }).length };
}

// ---- CSV ----------------------------------------------------------------------------------------------------------------------------
// one row per shot and reference (a shot without one: one row, the reference columns empty)
const CSV_HEAD = ['cid', 'time', 'club', 'session', 'combine_test', 'combine_level', 'combine_index', 'combine_void', 'status', 'not_measured', 'misread', 'smash',
  'physics_shot', 'physics_now', 'ball_speed_mph', 'launch_deg', 'spin_rpm', 'spin_axis_deg', 'hla_deg', 'club_speed_mph', 'lm_shot_number',
  'game_carry_m', 'game_along_m', 'game_side_m_R', 'game_total_m', 'device_carry_std_m', 'device_side_std_m_R',
  'ref_source', 'ref_origin', 'ref_quality', 'ref_carry_m', 'ref_total_m', 'ref_side_m_R', 'ref_carry_as_given', 'ref_total_as_given', 'ref_side_as_given',
  'delta_carry_m', 'delta_side_m', 'delta_total_m'];
// a text cell: quoted when it needs to be, and never read as a formula by a spreadsheet (a cell that starts with = + - @ gets a ')
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function given(o) { return o ? o.value + ' ' + o.unit : null; }
function toCsv(shotDiags) {
  const lines = [CSV_HEAD.join(',')];
  shotDiags.forEach(function (d) {
    const base = [d.cid, new Date(d.t).toISOString(), d.club, d.session, d.combine && d.combine.test, d.combine && d.combine.level, d.combine ? d.combine.index : null,
      d.combine && d.combine.void, d.status, d.notMeasured.join(' '), d.misread, d.smash, d.physics.shot, d.physics.now,
      d.inputs.ballSpeed, d.inputs.launch, d.inputs.spin, d.inputs.spinAxis, d.inputs.hla, d.inputs.clubSpeed, d.shotNumber,
      d.ours && d.ours.carry, d.ours && d.ours.along, d.ours && d.ours.side, d.ours && d.ours.total, d.device.carryStd, d.device.offlineStd];
    const refs = d.refs.length ? d.refs : [null];
    refs.forEach(function (r) {
      const rest = r ? [r.source, r.origin, r.quality, r.carry, r.total, r.side, given(r.orig.carry), given(r.orig.total), given(r.orig.side), r.delta.carry, r.delta.side, r.delta.total]
        : [null, null, null, null, null, null, null, null, null, null, null, null];
      lines.push(base.concat(rest).map(cell).join(','));
    });
  });
  return lines.join('\n') + '\n';
}

module.exports = { BANDS: BANDS, CONVENTIONS: CONVENTIONS, CSV_HEAD: CSV_HEAD, measurement: measurement, shotDiag: shotDiag, testDiag: testDiag, summary: summary, toCsv: toCsv, cell: cell, bandLabel: bandLabel };
