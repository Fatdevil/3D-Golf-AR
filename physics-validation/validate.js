// ================================================================
//  PHYSICS VALIDATION — how far the ball physics (physics.js) is from measured golf shots, per club and per ball speed.
//
//  The reference bank (physics-validation/references):
//    *.json        tables of reference rows (TrackMan tour averages): inputs (ball speed, launch, spin) and targets (carry, apex,
//                  landing angle), with where they come from, whether they are verified, and the conditions (temperature, altitude)
//    shots/*.csv   shot pairs from launch monitors' own apps: the launch values and the carry the launch monitor measured for the same
//                  shot. These are the strongest reference: real shots, amateur speeds, wedges and part swings. A file may have a sidecar
//                  <name>.json with { units, columns, conditions, source } when its headers or units are not recognised.
//  Every row is run through the physics (no wind, flat fairway, the row's conditions) and compared with its targets.
//  Rows are split into calibration and test by a stable hash of their id (about 70 / 30): a later refit of the physics may only look at
//  the calibration rows, and the test rows tell whether it got better on shots it never saw.
//  Tour averages ("average" rows) are not single shots: the carry of the average shot is not the average carry, so they are reported
//  apart from shot pairs and never decide the targets alone. Unverified tables are reported apart and never decide anything.
//  No DOM. Used by tools/physics-validation.js (the report) and tests/test_physics_validation.js (the regression guard).
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REF_DIR = path.join(__dirname, 'references');
const YD = 1.09361;   // yards per metre

// ---- the physics ------------------------------------------------------------------------------------------------------------------
let physics = null;
function loadPhysics() {
  if (physics) return physics;
  const prevWindow = global.window;
  global.window = Object.assign({ GREEN_STIMP: 10, matchSettings: {} }, prevWindow || {});
  delete require.cache[require.resolve(path.join(ROOT, 'physics.js'))];
  require(path.join(ROOT, 'physics.js'));
  physics = global.window.GolfPhysics;
  return physics;
}
// One shot through the physics: { carryM, apexM, landingDeg, hangS }. No wind, a flat fairway, the shot's conditions.
function fly(shot, conditions) {
  const G = loadPhysics();
  const c = conditions || {};
  const env = { getTerrainAt: function () { return { z: 0, normal: [0, 0, 1], type: 'FAIRWAY' }; }, checkCollisionCallback: function () { return null; },
    wind: [0, 0, 0], temperatureC: c.temperatureC === undefined ? 15 : c.temperatureC, altitudeFeet: c.altitudeFeet || 0 };
  const log = console.log; console.log = function () {};
  let r;
  try {
    r = G.simulateFlight({ startPos: [0, 0, 0], azimDeg: shot.hlaDeg || 0, spinAxisDeg: shot.spinAxisDeg || 0, ballSpeedMph: shot.ballSpeedMph,
      launchAngleDeg: shot.launchDeg, totalSpinRpm: shot.spinRpm, isLiveData: true, isTeeShot: false }, env);
  } finally { console.log = log; }
  const p = r.path;
  let i = 1;
  while (i < p.length && p[i].phase === 'flight') i++;
  const q = p[i - 1];
  return { carryM: r.metrics.carryMeters, apexM: r.metrics.apexMeters, landingDeg: Math.atan2(-q.vz, Math.hypot(q.vx, q.vy)) * 180 / Math.PI, hangS: q.time };
}

// ---- the split ----------------------------------------------------------------------------------------------------------------------
// FNV-1a of the id: the same id always lands in the same set, whatever else is in the bank
function splitOf(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 10) < 7 ? 'calibration' : 'test';
}

// ---- groups -------------------------------------------------------------------------------------------------------------------------
function clubGroup(club) {
  const c = String(club || '').toUpperCase().replace(/\s+/g, '');
  if (/^(DR|DRIVER|1W|[2-9]W|WOOD|[0-9]?HY|HYBRID|[0-9]H)/.test(c) || /WOOD|DRIVER|HYBRID/.test(c)) return 'woods';
  if (/^(PW|GW|AW|SW|LW|UW|W|WEDGE)$/.test(c) || /WEDGE|^[4-6][0-9]°?$/.test(c)) return 'wedges';
  if (/^[1-9]I$|^[1-9]IRON|IRON/.test(c)) return 'irons';
  return 'other';
}
function speedBand(mph) { return mph < 60 ? '<60 mph' : (mph < 100 ? '60-100 mph' : (mph < 140 ? '100-140 mph' : '140+ mph')); }

// ---- CSV ----------------------------------------------------------------------------------------------------------------------------
// The words launch monitor apps use for each value, after normalising a header (lower case, letters and digits only, units removed)
const ALIASES = {
  club: ['club', 'clubtype', 'clubname', 'clubid'],
  ballSpeed: ['ballspeed', 'ballspeedmph', 'ballvelocity', 'speed', 'ballspd'],
  launch: ['launchangle', 'vla', 'verticallaunch', 'verticallaunchangle', 'launch', 'launchdeg', 'launchv'],
  spin: ['spinrate', 'totalspin', 'spin', 'spinrpm', 'totalspinrate'],
  backspin: ['backspin', 'backspinrate'],
  sidespin: ['sidespin', 'sidespinrate'],
  axis: ['spinaxis', 'axis', 'spinaxisdeg'],
  hla: ['launchdirection', 'hla', 'horizontallaunch', 'horizontallaunchangle', 'startline', 'launchh', 'direction'],
  carry: ['carry', 'carrydistance', 'carryyd', 'carryyards', 'carrym', 'carrymeters', 'carrymetres'],
  temperature: ['temperature', 'temp', 'airtemp', 'airtemperature'],
  altitude: ['altitude', 'elevation', 'altitudeft', 'altitudem'],
  carryFrom: ['carryfrom']
};
// the unit a header names, if any: "(mph)", "[m/s]", "_yd", "Carry Distance (yds)"
function unitOf(header) {
  const h = String(header).toLowerCase();
  if (/m\/s|mps|\bms\b/.test(h)) return 'm/s';
  if (/km\/h|kmh|kph/.test(h)) return 'km/h';
  if (/mph/.test(h)) return 'mph';
  if (/yds|yards|\byd\b|_yd|yd\)|\(yd/.test(h)) return 'yd';
  if (/metres|meters|\(m\)|\[m\]|_m\b|\bm\b/.test(h)) return 'm';
  if (/°f|degf|\(f\)|fahrenheit/.test(h)) return 'F';
  if (/°c|degc|\(c\)|celsius/.test(h)) return 'C';
  if (/\bft\b|feet|\(ft\)/.test(h)) return 'ft';
  return null;
}
function normHeader(h) { return String(h).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, ''); }
function splitLine(line, delim) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(function (s) { return s.trim(); });
}
function toNum(s, decimalComma) {
  if (s === undefined || s === null) return null;
  let t = String(s).trim().replace(/\s/g, '');
  if (t === '' || t === '-' || t === '–') return null;
  if (decimalComma) t = t.replace(',', '.');
  t = t.replace(/[^0-9eE+\-.]/g, '');   // "12.5°", "150 yds", "R 3.2" keep the number (a side is not a sign here)
  const n = Number(t);
  return t !== '' && isFinite(n) ? n : null;
}
// parseCsv(text, sidecar) -> { rows: [shot], skipped: [{ line, reason }], refused: reason | null, columns }
// shot: { id, club, ballSpeedMph, launchDeg, spinRpm, spinAxisDeg, hlaDeg, carryYd, conditions }
function parseCsv(text, opts) {
  opts = opts || {};
  const name = opts.name || 'shots';
  const side = opts.sidecar || {};
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  if (!lines.length) return { rows: [], skipped: [], refused: 'empty file', columns: {} };
  const delim = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : (lines[0].indexOf('\t') >= 0 && lines[0].split('\t').length > lines[0].split(',').length ? '\t' : ',');
  const decimalComma = delim !== ',';
  const headers = splitLine(lines[0], delim);
  let first = 1;
  // a second header row of units ("[mph]", "yds") as some apps write it
  const second = lines[1] ? splitLine(lines[1], delim) : [];
  const unitsRow = second.length && second.every(function (c) { return c === '' || toNum(c, decimalComma) === null; });
  if (unitsRow) first = 2;
  const columns = {}, units = {};
  headers.forEach(function (h, i) {
    const n = normHeader(h);
    Object.keys(ALIASES).forEach(function (k) {
      if (columns[k] === undefined && ALIASES[k].indexOf(n) >= 0) { columns[k] = i; units[k] = unitOf(h) || (unitsRow ? unitOf('(' + second[i] + ')') : null); }
    });
  });
  // a sidecar can name the columns and units outright
  Object.keys(side.columns || {}).forEach(function (k) { const i = headers.indexOf(side.columns[k]); if (i >= 0) columns[k] = i; });
  Object.keys(side.units || {}).forEach(function (k) { units[k] = side.units[k]; });
  // the carry must be the launch monitor's own: a file exported from this game has its carry from the game's physics
  if (columns.carryFrom !== undefined) {
    const own = lines.slice(first).some(function (l) { return /physics/i.test(splitLine(l, delim)[columns.carryFrom] || ''); });
    if (own) return { rows: [], skipped: [], refused: 'carry from this game\'s physics (an export from the range session), not measured by a launch monitor', columns: columns };
  }
  if (columns.ballSpeed === undefined || columns.launch === undefined || columns.carry === undefined) {
    return { rows: [], skipped: [], refused: 'no ball speed, launch angle or carry column (add a sidecar <file>.json with "columns")', columns: columns };
  }
  const speedK = { 'mph': 1, 'm/s': 2.23694, 'km/h': 0.621371 }[units.ballSpeed || 'mph'] || 1;
  const carryK = (units.carry === 'm') ? YD : 1;
  const rows = [], skipped = [];
  for (let li = first; li < lines.length; li++) {
    const c = splitLine(lines[li], delim);
    const get = function (k) { return columns[k] === undefined ? null : toNum(c[columns[k]], decimalComma); };
    const bs = get('ballSpeed'), la = get('launch'), carry = get('carry');
    let spin = get('spin'), axis = get('axis');
    const back = get('backspin'), sidespin = get('sidespin');
    if (spin === null && back !== null) { spin = Math.hypot(back, sidespin || 0); if (axis === null) axis = Math.atan2(sidespin || 0, back) * 180 / Math.PI; }
    let reason = null;
    if (bs === null || bs <= 0) reason = 'no ball speed';
    else if (la === null) reason = 'no launch angle';
    else if (spin === null) reason = 'no spin (the physics would fly it on a guess)';
    else if (carry === null || carry <= 0) reason = 'no carry';
    if (reason) { skipped.push({ line: li + 1, reason: reason }); continue; }
    let temp = get('temperature'), alt = get('altitude');
    if (temp !== null && units.temperature === 'F') temp = (temp - 32) * 5 / 9;
    if (alt !== null && units.altitude === 'm') alt = alt * 3.28084;
    const cond = Object.assign({}, side.conditions || {});
    if (temp !== null) cond.temperatureC = temp;
    if (alt !== null) cond.altitudeFeet = alt;
    rows.push({ id: name + ':' + (li + 1), club: columns.club !== undefined ? (c[columns.club] || '').trim() : '', ballSpeedMph: bs * speedK, launchDeg: la, spinRpm: spin,
      spinAxisDeg: axis || 0, hlaDeg: get('hla') || 0, carryYd: carry * carryK, conditions: cond });
  }
  return { rows: rows, skipped: skipped, refused: null, columns: columns };
}

// ---- the bank -----------------------------------------------------------------------------------------------------------------------
// { tables: [{ id, title, kind, verified, source, conditions, rows }], files: [{ name, source, rows, skipped, refused }] }
function loadBank(dir) {
  dir = dir || REF_DIR;
  const tables = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort().map(function (f) {
    return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  });
  const shotDir = path.join(dir, 'shots');
  const files = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter(function (f) { return /\.csv$/i.test(f); }).sort().map(function (f) {
    const sidePath = path.join(shotDir, f.replace(/\.csv$/i, '.json'));
    const sidecar = fs.existsSync(sidePath) ? JSON.parse(fs.readFileSync(sidePath, 'utf8')) : {};
    const parsed = parseCsv(fs.readFileSync(path.join(shotDir, f), 'utf8'), { name: f.replace(/\.csv$/i, ''), sidecar: sidecar });
    return { name: f, source: sidecar.source || '', rows: parsed.rows, skipped: parsed.skipped, refused: parsed.refused };
  }) : [];
  return { tables: tables, files: files };
}

// ---- evaluation ---------------------------------------------------------------------------------------------------------------------
// Every row through the physics: { id, set, kind, verified, club, group, band, ...targets, engine, err: { carryYd, apexYd, landingDeg } }
function evaluate(bank) {
  const out = [];
  const add = function (row, kind, verified, conditions, source) {
    const e = fly(row, Object.assign({}, conditions || {}, row.conditions || {}));
    const eng = { carryYd: e.carryM * YD, apexYd: e.apexM * YD, landingDeg: e.landingDeg };
    const err = { carryYd: eng.carryYd - row.carryYd };
    if (typeof row.apexYd === 'number') err.apexYd = eng.apexYd - row.apexYd;
    if (typeof row.landingDeg === 'number') err.landingDeg = eng.landingDeg - row.landingDeg;
    out.push({ id: row.id, source: source, set: splitOf(row.id), kind: kind, verified: verified, club: row.club, group: clubGroup(row.club), band: speedBand(row.ballSpeedMph),
      input: { ballSpeedMph: row.ballSpeedMph, launchDeg: row.launchDeg, spinRpm: row.spinRpm }, target: { carryYd: row.carryYd, apexYd: row.apexYd, landingDeg: row.landingDeg }, engine: eng, err: err });
  };
  bank.tables.forEach(function (t) { t.rows.forEach(function (r) { add(r, t.kind || 'average', t.verified !== false, t.conditions, t.id); }); });
  bank.files.forEach(function (f) { f.rows.forEach(function (r) { add(r, 'shot', true, null, f.name); }); });
  return out;
}

function median(a) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(a, q) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; }
// n, median absolute error, bias (median signed error) and 90th percentile of the absolute error, per measure
function stats(results, key) {
  const v = results.map(function (r) { return r.err[key]; }).filter(function (x) { return typeof x === 'number'; });
  return { n: v.length, medianAbs: median(v.map(Math.abs)), bias: median(v), p90Abs: quantile(v.map(Math.abs), 0.9) };
}
// grouped stats: by(results, 'group') -> { woods: { carryYd: stats, apexYd, landingDeg }, ... }
function by(results, field) {
  const g = {};
  results.forEach(function (r) { (g[r[field]] = g[r[field]] || []).push(r); });
  const out = {};
  Object.keys(g).sort().forEach(function (k) { out[k] = { n: g[k].length, carryYd: stats(g[k], 'carryYd'), apexYd: stats(g[k], 'apexYd'), landingDeg: stats(g[k], 'landingDeg') }; });
  return out;
}

// The goals (from the physics review, 2026-11): aims, not promises. Measured on verified single shots (pairs) only, the test set:
// tour averages cannot show them (see the header). In metres and degrees, as the review set them.
const TARGETS = [
  { id: 'full-carry', title: 'Fullslag: carry, medianfel högst 1,5 m', measure: 'carryYd', limitM: 1.5, filter: function (r) { return r.group !== 'wedges' || r.target.carryYd > 110; } },
  { id: 'wedge-carry', title: 'Wedgar 20-100 m: carry, medianfel högst 1 m', measure: 'carryYd', limitM: 1.0, filter: function (r) { const m = r.target.carryYd / YD; return r.group === 'wedges' && m >= 20 && m <= 100; } },
  { id: 'landing', title: 'Landningsvinkel: medianfel högst 1,5°', measure: 'landingDeg', limitDeg: 1.5, filter: function () { return true; } }
];
function targetStatus(results) {
  const pairs = results.filter(function (r) { return r.kind === 'shot' && r.verified && r.set === 'test'; });
  return TARGETS.map(function (t) {
    const rows = pairs.filter(t.filter);
    const s = stats(rows, t.measure);
    const limit = t.limitM !== undefined ? t.limitM * YD : t.limitDeg;
    return { id: t.id, title: t.title, n: s.n, medianAbs: s.medianAbs, limit: limit, unit: t.measure === 'landingDeg' ? '°' : 'yd', met: s.n > 0 ? s.medianAbs <= limit : null };
  });
}

// ---- the baseline (regression guard) ----------------------------------------------------------------------------------------------
// What the physics gives today for the verified table rows: a change to physics.js may make a row better, never worse by more than the slack
function baselineOf(results) {
  const out = {};
  results.filter(function (r) { return r.kind === 'average'; }).forEach(function (r) {
    out[r.id] = { carryYd: +r.engine.carryYd.toFixed(2), apexYd: +r.engine.apexYd.toFixed(2), landingDeg: +r.engine.landingDeg.toFixed(2),
      absErr: { carryYd: +Math.abs(r.err.carryYd).toFixed(2), apexYd: r.err.apexYd === undefined ? null : +Math.abs(r.err.apexYd).toFixed(2), landingDeg: r.err.landingDeg === undefined ? null : +Math.abs(r.err.landingDeg).toFixed(2) } };
  });
  return out;
}
const SLACK = { carryYd: 0.5, apexYd: 0.5, landingDeg: 0.5 };
// rows whose error grew past the baseline plus the slack: [{ id, measure, was, now }]
function regressions(results, baseline) {
  const out = [];
  results.filter(function (r) { return baseline[r.id]; }).forEach(function (r) {
    ['carryYd', 'apexYd', 'landingDeg'].forEach(function (m) {
      const was = baseline[r.id].absErr[m];
      if (was === null || was === undefined || r.err[m] === undefined) return;
      const now = Math.abs(r.err[m]);
      if (now > was + SLACK[m]) out.push({ id: r.id, measure: m, was: was, now: +now.toFixed(2) });
    });
  });
  return out;
}

module.exports = { fly: fly, splitOf: splitOf, clubGroup: clubGroup, speedBand: speedBand, parseCsv: parseCsv, loadBank: loadBank, evaluate: evaluate,
  stats: stats, by: by, targetStatus: targetStatus, TARGETS: TARGETS, baselineOf: baselineOf, regressions: regressions, SLACK: SLACK, YD: YD, REF_DIR: REF_DIR };
