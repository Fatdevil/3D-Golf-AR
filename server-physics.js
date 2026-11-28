// The game's ball flight on the server (physics.js, in a sandbox of its own: it is a browser script): where a shot comes down in standard
// conditions (lm-shot-review.js standard), worked out here from the shot's launch values, so a score never rests on a distance a device
// sent. Used by server.js (Golf Combine 9, combine-core.js). Its VERSION must be the one recorded in physics-validation/physics-version.json.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let flight = null;
function load() {
  if (flight) return flight;
  const quiet = function () {};
  const ctx = { window: { GREEN_STIMP: 10, matchSettings: {} }, console: { log: quiet, warn: quiet, error: quiet }, Math: Math, Object: Object, Array: Array, JSON: JSON, isFinite: isFinite, Number: Number };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'physics.js'), 'utf8'), ctx, { filename: 'physics.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'lm-shot-review.js'), 'utf8'), ctx, { filename: 'lm-shot-review.js' });
  flight = { G: ctx.window.GolfPhysics, R: ctx.window.LMShotReview };
  return flight;
}
function version() { return load().G.VERSION; }
// { carry, side } where a shot ({ ballSpeed, launch, spin, spinAxis, hla } as the shot bank has them) comes down in standard conditions
function landing(shot) {
  const f = load();
  const st = f.R.standard(f.G, { ballSpeed: shot.ballSpeed, launch: shot.launch, spin: shot.spin, spinAxis: shot.spinAxis, hla: shot.hla });
  // scored on where it came down: down the target line (along, not the straight carry, which includes the side) and across it
  return st && typeof st.side === 'number' && typeof st.along === 'number' ? { carry: st.along, side: st.side } : null;
}
// Whether a shot was a misread, from its own ball and club speed (the review's smash factor limits per kind of club), never from what a device
// says: the rule for a Golf Combine retake (combine-core.js voidReason)
function misread(shot) {
  const f = load();
  const r = f.R.review({ source: 'LM', club: shot.club, ballSpeed: shot.ballSpeed, clubSpeed: shot.clubSpeed, launch: shot.launch, hla: shot.hla }, {});
  return !!(r && r.misread);
}
module.exports = { landing: landing, version: version, misread: misread };
