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
    totalPar += c.total_par || (c.hole_count || HOLES_PER_PLATE) * 4;
    out.push({ plate_code: plates[i].plate_code, plate_name: c.name || plates[i].plate_name || '' });
  }
  return { plates: out, totalPar: totalPar };
}

module.exports = { HOLES_PER_PLATE, TYPES, plateCode, checkPlateList, checkPlatesExist };
