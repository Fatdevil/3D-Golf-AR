// ================================================================
//  SHOT BANK CORE — what a range shot from a device may look like before the server keeps it (server.js, /api/shots).
//
//  The shot bank is the long-term store of every range shot a player has hit, on every device they use: the base of the training
//  analysis to come. It is not the session and not the bag:
//    - a shot is never deleted, and starting a new range session (which only clears the session list on the device) leaves it alone
//    - what was measured (the launch data, the raw launch monitor message, the game's carry) is written once: a later copy of the same
//      shot can fill in what the first copy lacked, never change it
//    - what the player decides (the club, counting a flagged shot anyway, the review that follows from the club) may change: the copy
//      edited last (by the device's own clock, `edited`) wins
//  Each shot has an id the device made (cid), so sending it twice (a retry, two tabs, a lost answer) stores it once.
//  It also has the training session it was hit in (session: one range session on one device, a new one after "New session" or a long
//  break) and the version of the ball flight that worked out its distances (physics, physics.js VERSION). Both are written once and never
//  guessed: a shot from before they existed has neither, and statistics treat it as such.
//  No DB here: normalize() checks one shot and returns the row server.js writes. Tested in tests/test_shot_bank.js.
// ================================================================
'use strict';

const CLUBS = ['Dr', '3W', '5W', 'Hy', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];
const FLAGS = ['topped', 'thin', 'short', 'offline_start', 'smash_impossible', 'wrong_club'];
const ESTIMATED = ['totalSpinRpm', 'spinAxisDeg', 'azimDeg'];
const MAX_BATCH = 200;
const MAX_RAW = 2048;          // characters of the launch monitor's message as JSON
const EARLIEST = Date.UTC(2020, 0, 1);

// the measured numbers a shot may have, with what a golf shot (and the game's result of it) can be; outside these the shot is refused
const NUMBERS = {
  ballSpeed: [0, 250], clubSpeed: [0, 200], launch: [-30, 90], hla: [-90, 90], spin: [0, 20000], spinAxis: [-90, 90],
  clubPath: [-60, 60], faceToPath: [-60, 60], aoa: [-40, 40],
  carry: [0, 500], total: [0, 600], offline: [-300, 300], apex: [0, 200], carryStd: [0, 500], totalStd: [0, 600], offlineStd: [-300, 300]
};
// the parts of an approach practice shot that are kept (all numbers but the flags)
const PRACTICE_NUM = { dist: [0, 400], prox: [0, 500], along: [-500, 500], across: [-500, 500], points: [0, 100], hole: [0, 100] };
const PRACTICE_BOOL = ['onGreen', 'holed', 'test'];

function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

// normalize(input, now) -> { ok: true, shot } | { ok: false, reason }. shot uses the column names of the shots table.
function normalize(input, now) {
  now = now === undefined ? Date.now() : now;
  const s = input && typeof input === 'object' ? input : null;
  if (!s) return { ok: false, reason: 'not_a_shot' };
  if (typeof s.cid !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(s.cid)) return { ok: false, reason: 'bad_cid' };
  const t = num(s.t);
  if (t === null || t < EARLIEST || t > now + 86400000) return { ok: false, reason: 'bad_time' };
  if (s.source !== 'LM' && s.source !== 'SIM') return { ok: false, reason: 'bad_source' };
  if (s.club !== null && s.club !== undefined && CLUBS.indexOf(s.club) < 0) return { ok: false, reason: 'bad_club' };
  const out = {
    client_id: s.cid, shot_at: new Date(t).toISOString(), source: s.source, club: s.club || null,
    range_key: typeof s.range === 'string' && s.range ? s.range.slice(0, 80) : null,
    lm_device: typeof s.device === 'string' && s.device ? s.device.slice(0, 64) : null,
    accepted: s.accepted === true,
    training_session_id: null, physics_version: null,
    edited_at: num(s.edited) !== null && s.edited >= t && s.edited <= now + 86400000 ? Math.round(s.edited) : Math.round(t)
  };
  // the training session and the flight's version: a shot from before them has none; a malformed one is a fault of the device, refused
  if (s.session !== undefined && s.session !== null) {
    if (typeof s.session !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(s.session)) return { ok: false, reason: 'bad_session' };
    out.training_session_id = s.session;
  }
  if (s.physics !== undefined && s.physics !== null) {
    if (typeof s.physics !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(s.physics)) return { ok: false, reason: 'bad_physics' };
    out.physics_version = s.physics;
  }
  // the numbers: missing is null; present but impossible refuses the shot (a bad value must not go into the bank)
  const cols = { ballSpeed: 'ball_speed', clubSpeed: 'club_speed', launch: 'launch', hla: 'hla', spin: 'spin', spinAxis: 'spin_axis', clubPath: 'club_path',
                 faceToPath: 'face_to_path', aoa: 'aoa', carry: 'carry', total: 'total', offline: 'offline_m', apex: 'apex', carryStd: 'carry_std', totalStd: 'total_std', offlineStd: 'offline_std' };
  for (const k of Object.keys(NUMBERS)) {
    const v = s[k];
    if (v === null || v === undefined) { out[cols[k]] = null; continue; }
    if (num(v) === null || v < NUMBERS[k][0] || v > NUMBERS[k][1]) return { ok: false, reason: 'bad_' + k };
    out[cols[k]] = v;
  }
  // what the game estimated (lm-shot-quality.js)
  if (s.estimated !== undefined && s.estimated !== null) {
    if (!Array.isArray(s.estimated) || s.estimated.some(function (f) { return ESTIMATED.indexOf(f) < 0; })) return { ok: false, reason: 'bad_estimated' };
    out.estimated = s.estimated.length ? Array.from(new Set(s.estimated)) : null;
  } else out.estimated = null;
  // the review (lm-shot-review.js)
  if (s.review !== undefined && s.review !== null) {
    const r = s.review;
    if (typeof r !== 'object' || !Array.isArray(r.flags) || r.flags.some(function (f) { return FLAGS.indexOf(f) < 0; })) return { ok: false, reason: 'bad_review' };
    if (r.looksLike !== null && r.looksLike !== undefined && CLUBS.indexOf(r.looksLike) < 0) return { ok: false, reason: 'bad_review' };
    out.review = { flags: Array.from(new Set(r.flags)), mishit: r.mishit === true, misread: r.misread === true, looksLike: r.looksLike || null };
  } else out.review = null;
  // an approach practice shot: only its known parts
  if (s.practice !== undefined && s.practice !== null) {
    if (typeof s.practice !== 'object') return { ok: false, reason: 'bad_practice' };
    const p = {};
    for (const k of Object.keys(PRACTICE_NUM)) {
      const v = s.practice[k];
      if (v === null || v === undefined) continue;
      if (num(v) === null || v < PRACTICE_NUM[k][0] || v > PRACTICE_NUM[k][1]) return { ok: false, reason: 'bad_practice' };
      p[k] = v;
    }
    PRACTICE_BOOL.forEach(function (k) { if (s.practice[k] === true) p[k] = true; });
    out.practice = p;
  } else out.practice = null;
  // the launch monitor's message as it came: flat values (and its list of measured fields) only, and not too long
  if (s.raw !== undefined && s.raw !== null) {
    if (typeof s.raw !== 'object' || Array.isArray(s.raw)) return { ok: false, reason: 'bad_raw' };
    const raw = {};
    for (const k of Object.keys(s.raw).slice(0, 40)) {
      const v = s.raw[k];
      if (k === 'measured') { if (Array.isArray(v) && v.every(function (x) { return typeof x === 'string' && x.length <= 40; })) raw.measured = v.slice(0, 40); continue; }
      if (v === null || typeof v === 'boolean' || num(v) !== null || (typeof v === 'string' && v.length <= 64)) raw[k.slice(0, 40)] = v;
    }
    if (JSON.stringify(raw).length > MAX_RAW) return { ok: false, reason: 'raw_too_long' };
    out.raw = raw;
  } else out.raw = null;
  return { ok: true, shot: out };
}

// A row of the shots table as the devices see it (the names of the range session's shots; no player or device ids)
function toClient(row) {
  const n = function (v) { return v === null || v === undefined ? null : Number(v); };
  return {
    cid: row.client_id, t: new Date(row.shot_at).getTime(), source: row.source, club: row.club, range: row.range_key, device: row.lm_device,
    ballSpeed: n(row.ball_speed), clubSpeed: n(row.club_speed), launch: n(row.launch), hla: n(row.hla), spin: n(row.spin), spinAxis: n(row.spin_axis),
    clubPath: n(row.club_path), faceToPath: n(row.face_to_path), aoa: n(row.aoa), carry: n(row.carry), total: n(row.total), offline: n(row.offline_m),
    apex: n(row.apex), carryStd: n(row.carry_std), totalStd: n(row.total_std), offlineStd: n(row.offline_std), estimated: row.estimated || undefined, review: row.review || undefined,
    accepted: !!row.accepted, practice: row.practice || undefined, raw: row.raw || undefined, edited: n(row.edited_at),
    session: row.training_session_id || null, physics: row.physics_version || null
  };
}

// A short code another device types to join this player's shot bank: 8 characters, no 0/O or 1/I/L to misread
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode(bytes) {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
function cleanCode(c) { return typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''; }

module.exports = { CLUBS: CLUBS, FLAGS: FLAGS, NUMBERS: NUMBERS, MAX_BATCH: MAX_BATCH, normalize: normalize, toClient: toClient, makeCode: makeCode, cleanCode: cleanCode, CODE_ALPHABET: CODE_ALPHABET };
