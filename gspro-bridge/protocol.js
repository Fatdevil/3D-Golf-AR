'use strict';
// GSPro Open Connect v1: the parts of the protocol that need no network, so they can be tested.
//   createFramer()   cuts the TCP byte stream into JSON messages (several per packet, or one split over several packets)
//   normalizeShot()  turns a GSPro message into the shot the game's triggerRealShot() takes, or null for heartbeats and non-shots
//   replies()        what the bridge answers to every message

const MAX_BUFFER = 1024 * 1024;   // a message is a few hundred bytes; a megabyte of unfinished text is garbage

// Finds complete top-level {...} objects in a stream. Braces inside strings do not count, text between objects (newlines, noise) is skipped,
// and an object that is cut off waits for the rest. A complete object that is not valid JSON is dropped without blocking the ones after it.
function createFramer() {
  let buf = '';
  return {
    feed(chunk) {
      buf += chunk;
      const messages = [];
      let invalid = 0, overflow = false;
      for (;;) {
        const start = buf.indexOf('{');
        if (start === -1) { buf = ''; break; }
        let depth = 0, inString = false, escaped = false, end = -1;
        for (let i = start; i < buf.length; i++) {
          const c = buf[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
          } else if (c === '"') inString = true;
          else if (c === '{') depth++;
          else if (c === '}' && --depth === 0) { end = i; break; }
        }
        if (end === -1) {                    // unfinished: keep it and wait for more
          buf = buf.slice(start);
          if (buf.length > MAX_BUFFER) { buf = ''; overflow = true; }
          break;
        }
        const text = buf.slice(start, end + 1);
        buf = buf.slice(end + 1);
        try { messages.push(JSON.parse(text)); } catch (e) { invalid++; }
      }
      return { messages, invalid, overflow };
    },
    pending() { return buf.length; }
  };
}

// A finite number, or undefined. Numeric strings are accepted: some launch monitors send "147.5".
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return isFinite(n) ? n : undefined; }
  return undefined;
}

// A message is a shot when it carries ball data and is not flagged as a heartbeat / without ball data.
function isShot(data) {
  if (!data || typeof data !== 'object') return false;
  const o = data.ShotDataOptions;
  if (o && typeof o === 'object' && (o.IsHeartBeat === true || o.ContainsBallData === false)) return false;
  return !!data.BallData && typeof data.BallData === 'object';
}

// The shot in the game's units: mph, degrees, rpm. SpinAxis follows atan2(SideSpin, BackSpin): positive sidespin = positive axis = curves right
// (the same conversion arcade.html does for manual input).
function normalizeShot(data) {
  if (!isShot(data)) return null;
  const ball = data.BallData, club = data.ClubData || {};

  const back = num(ball.BackSpin), side = num(ball.SideSpin);
  let totalSpin = num(ball.TotalSpin);
  if (totalSpin === undefined) totalSpin = num(ball.Spin);
  let axis = num(ball.SpinAxis);
  // TotalSpin / SpinAxis are optional when BackSpin / SideSpin are sent
  if (totalSpin === undefined && back !== undefined) totalSpin = Math.hypot(back, side || 0);
  if (axis === undefined && back !== undefined) axis = Math.atan2(side || 0, back) * 180 / Math.PI;

  const path = num(club.Path);
  const faceToTarget = num(club.FaceToTarget);
  const faceToPath = faceToTarget !== undefined ? faceToTarget - (path || 0) : num(club.FaceToPath);
  return {
    ballSpeedMph: num(ball.Speed) || 0,
    launchAngleDeg: num(ball.VLA) || 0,
    totalSpinRpm: totalSpin || 0,
    spinAxisDeg: axis || 0,
    azimDeg: num(ball.HLA) || 0,
    clubSpeedMph: num(club.Speed) || 0,
    clubPathDeg: path || 0,
    faceToPathDeg: faceToPath || 0,
    clubAoADeg: num(club.AngleOfAttack) || 0
  };
}

// GSPro wants a receipt for every message or the launch monitor closes the socket; third-party monitors also expect the player info (Code 201).
function replies() {
  return [
    { Code: 200, Message: 'OK' },
    { Code: 201, Message: 'GSPro Player Information', Player: { Handed: 'RH', Club: 'IRON' } }
  ];
}

module.exports = { createFramer, normalizeShot, isShot, replies, num, MAX_BUFFER };
