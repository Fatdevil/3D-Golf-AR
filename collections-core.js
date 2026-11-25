// Rules for a multi-plate collection (a 6, 9 or 18 hole course made of 3-hole plates). Used by server.js; no database in here.
'use strict';

const HOLES_PER_PLATE = 3;
const TYPES = ['3', '6', '9', '18'];

// one entry of `plates` is { plate_code, plate_name } (older rows held the bare code)
function plateCode(p) {
  const c = typeof p === 'string' ? p : (p && typeof p.plate_code === 'string' ? p.plate_code : '');
  return c.trim().toUpperCase();
}

// the shape of the plate list, before any database is asked: how many fit, that each has a code, that none is used twice
// returns { error } or { plates: [{ plate_code, plate_name }] }
function checkPlateList(type, plates) {
  if (plates === undefined || plates === null) plates = [];
  if (!Array.isArray(plates)) return { error: 'plates must be a list' };
  const room = Math.floor(parseInt(type, 10) / HOLES_PER_PLATE);
  if (plates.length > room) return { error: 'a ' + type + ' hole course has room for ' + room + ' plates, got ' + plates.length };
  const seen = {};
  const out = [];
  for (let i = 0; i < plates.length; i++) {
    const code = plateCode(plates[i]);
    if (!/^[A-Z0-9_-]{1,32}$/.test(code)) return { error: 'plate ' + (i + 1) + ' has no valid plate_code' };
    if (seen[code]) return { error: 'plate ' + code + ' is used twice' };
    seen[code] = true;
    const name = plates[i] && typeof plates[i].plate_name === 'string' ? plates[i].plate_name.slice(0, 120) : '';
    out.push({ plate_code: code, plate_name: name });
  }
  return { plates: out };
}

// the plates the database knows about, against the list: every plate must be there, published and a course (not a range)
// `found` is the rows of courses for those codes: { share_code, name, total_par, hole_count, is_draft, is_range }
function checkPlatesExist(plates, found) {
  const byCode = {};
  (found || []).forEach(function (c) { byCode[String(c.share_code).toUpperCase()] = c; });
  let totalPar = 0;
  const out = [];
  for (let i = 0; i < plates.length; i++) {
    const c = byCode[plates[i].plate_code];
    if (!c) return { error: 'plate ' + plates[i].plate_code + ' does not exist' };
    if (c.is_draft === true) return { error: 'plate ' + plates[i].plate_code + ' is not published' };
    if (c.is_range === true) return { error: 'plate ' + plates[i].plate_code + ' is a range, not a course' };
    // a plate is three holes: a course of one or two would number, add up and rank as a short collection (no count: an old row, taken as 3)
    if (c.hole_count && c.hole_count !== HOLES_PER_PLATE) return { error: 'plate ' + plates[i].plate_code + ' has ' + c.hole_count + ' holes, a plate has ' + HOLES_PER_PLATE };
    totalPar += c.total_par || (c.hole_count || HOLES_PER_PLATE) * 4;
    out.push({ plate_code: plates[i].plate_code, plate_name: c.name || plates[i].plate_name || '' });
  }
  return { plates: out, totalPar: totalPar };
}

// The holes of all plates of a collection as one list, in the order of the plates, three per plate (a plate with fewer entries is padded with empty
// holes, one with more is cut): hole n of the collection is hole (n % 3) of plate (n / 3), the same numbering the game uses when it plays them.
// `holesByPlate` is a list of hole lists (an array or the JSON text of one).
function combineHoles(holesByPlate) {
  const out = [];
  (holesByPlate || []).forEach(function (h) {
    let arr = h;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    for (let i = 0; i < HOLES_PER_PLATE; i++) out.push(arr[i] && typeof arr[i] === 'object' ? arr[i] : {});
  });
  return out;
}

// ---- the scorecard of a whole collection -----------------------------------------------------------------------------------------
// The world a plate was built in, from its theme (the builder saves the biome as theme_data.biomeId, older rows as .biome):
// 'desert' | 'moon' | 'grass'. Plates of different worlds side by side make one course look like several.
function worldOf(theme) {
  let t = theme;
  if (typeof t === 'string') { try { t = JSON.parse(t); } catch (e) { t = null; } }
  const id = String((t && (t.biomeId || t.biome)) || 'GLOBAL').toUpperCase();
  if (id.indexOf('DESERT') >= 0) return 'desert';
  if (id.indexOf('MOON') >= 0) return 'moon';
  return 'grass';
}
// par and length (m, from the back-most tee there is to the flag; 0 when the hole has no tee or flag) of a played hole
function holeCard(h) {
  const tees = (h && h.tees) || {};
  const tee = tees.black || tees.white || tees.yellow || tees.red;
  const flag = h && h.flag;
  const ok = tee && flag && typeof tee.x === 'number' && typeof flag.x === 'number';
  return { par: (h && h.par) || 4, length: ok ? Math.round(Math.hypot(flag.x - tee.x, flag.z - tee.z)) : 0 };
}
// The scorecard of a collection of `type` holes from its plates in order, each { plate_code, name, holes, theme_data }:
// { type, room (plates it has room for), filled (plates it has), holes: [{ no, par, length, plate }], plates: [{ code, name, world }],
//   front / back (holes 1-9 / 10-18 of an 18 hole course, else null) and total: { par, length, holes } over the holes there are,
//   worlds: the different worlds of its plates }
function courseCard(type, plateRows) {
  const room = Math.floor(parseInt(type, 10) / HOLES_PER_PLATE) || 0;
  const rows = (plateRows || []).slice(0, room);
  const holes = [], plates = [], worlds = [];
  rows.forEach(function (r, k) {
    let arr = r && r.holes;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    const w = worldOf(r && r.theme_data);
    if (worlds.indexOf(w) < 0) worlds.push(w);
    plates.push({ code: plateCode(r && (r.plate_code || r.share_code)), name: (r && r.name) || '', world: w });
    for (let i = 0; i < HOLES_PER_PLATE; i++) {
      const c = holeCard(arr[i]);
      holes.push({ no: k * HOLES_PER_PLATE + i + 1, par: c.par, length: c.length, plate: k });
    }
  });
  const sum = function (from, to) {
    const part = holes.filter(function (h) { return h.no >= from && h.no <= to; });
    return { par: part.reduce(function (a, h) { return a + h.par; }, 0), length: part.reduce(function (a, h) { return a + h.length; }, 0), holes: part.length };
  };
  const eighteen = parseInt(type, 10) === 18;
  return {
    type: String(type), room: room, filled: rows.length, holes: holes, plates: plates, worlds: worlds,
    front: eighteen ? sum(1, 9) : null, back: eighteen ? sum(10, 18) : null, total: sum(1, 1e9)
  };
}
// The usual mix of pars for a course of n holes: about 4 par 3s, 10 par 4s and 4 par 5s in 18 (par 72), in proportion for fewer
function parTargets(n) {
  const short = Math.round(n * 4 / 18), long = Math.round(n * 4 / 18);
  return { 3: short, 4: Math.max(0, n - short - long), 5: long };
}

module.exports = { HOLES_PER_PLATE, TYPES, plateCode, checkPlateList, checkPlatesExist, combineHoles, worldOf, holeCard, courseCard, parTargets };
