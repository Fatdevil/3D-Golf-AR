// What a launch-monitor shot really measured (lm-shot-quality.js): refused, measured, estimated, missing. A missing value is never a zero.
const Q = require('../lm-shot-quality.js');
const P = require('../gspro-bridge/protocol.js');

let failed = 0;
function check(name, ok, detail) { console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; }

// a full shot as the bridge sends it now (with `measured`)
const gspro = function (ball, club) {
  return P.normalizeShot({ DeviceID: 'Test LM', ShotNumber: 1, BallData: Object.assign({ Speed: 120, VLA: 16.3, HLA: -1.2, TotalSpin: 7000, SpinAxis: 2.5 }, ball || {}), ClubData: club });
};

console.log('1. Ett helt slag');
{
  const r = Q.check(gspro(null, { Speed: 87, Path: -2, FaceToTarget: 1, AngleOfAttack: -4 }));
  check('allt uppmätt, inget uppskattat eller saknat', r.ok && r.estimated.length === 0 && r.missing.length === 0 && r.measured.length === 9, r);
  check('värdena är orörda', r.shot.totalSpinRpm === 7000 && r.shot.spinAxisDeg === 2.5 && r.shot.azimDeg === -1.2 && r.shot.clubPathDeg === -2 && r.shot.faceToPathDeg === 3, r.shot);
  const noClub = Q.check(gspro());
  check('utan klubbdata: klubbvärdena saknas (null), inte 0, och inget uppskattas', noClub.ok && noClub.estimated.length === 0 && noClub.missing.length === 4 &&
    noClub.shot.clubSpeedMph === null && noClub.shot.clubAoADeg === null, noClub);
}

console.log('\n2. Saknade värden');
{
  const noSpin = Q.check(gspro({ TotalSpin: undefined, SpinAxis: undefined }));
  check('saknat spinn: uppskattat ur utgångsvinkeln (16,3° → 7 120 rpm), inte 0, och märkt', noSpin.ok && noSpin.shot.totalSpinRpm === Q.spinFromLaunch(16.3) && noSpin.shot.totalSpinRpm === 7120 && noSpin.estimated.indexOf('totalSpinRpm') >= 0, noSpin);
  check('saknad spinnaxel: rak (0) men märkt som uppskattad', noSpin.shot.spinAxisDeg === 0 && noSpin.estimated.indexOf('spinAxisDeg') >= 0, noSpin.estimated);
  const noHla = Q.check(gspro({ HLA: undefined }));
  check('saknad startriktning: rak men märkt', noHla.ok && noHla.shot.azimDeg === 0 && noHla.estimated.join() === 'azimDeg', noHla.estimated);
  const noSpeed = Q.check(gspro({ Speed: undefined }));
  check('saknad bollfart: slaget spelas inte', !noSpeed.ok && noSpeed.reason === 'no_ball_speed', noSpeed);
  const noVla = Q.check(gspro({ VLA: undefined }));
  check('saknad utgångsvinkel: slaget spelas inte', !noVla.ok && noVla.reason === 'no_launch_angle', noVla);
  check('ett meddelande på svenska som säger vad som saknades', /bollfart/.test(Q.refusedText(noSpeed, true)) && /launch angle/.test(Q.refusedText(noVla, false)));
}

console.log('\n3. Orimliga värden');
{
  const fast = Q.check(gspro({ Speed: 400 }));
  check('bollfart 400 mph: spelas inte, fältet namnges', !fast.ok && fast.reason === 'out_of_range' && fast.field === 'ballSpeedMph', fast);
  const spin = Q.check(gspro({ TotalSpin: 40000 }));
  check('40 000 rpm: spelas inte', !spin.ok && spin.field === 'totalSpinRpm', spin);
  const zero = Q.check(gspro({ Speed: 0 }));
  check('bollfart 0: spelas inte', !zero.ok && zero.reason === 'no_ball_speed', zero);
  const badClub = Q.check(gspro(null, { Speed: 90, Path: 75 }));
  check('en orimlig klubbana flyger bollen ändå men räknas som saknad', badClub.ok && badClub.shot.clubPathDeg === null && badClub.missing.indexOf('clubPathDeg') >= 0 && badClub.measured.indexOf('clubSpeedMph') >= 0, badClub);
}

console.log('\n4. En äldre brygga (inga `measured`, 0 där värden saknades)');
{
  const old = { ballSpeedMph: 150, launchAngleDeg: 11, totalSpinRpm: 0, spinAxisDeg: 0, azimDeg: 0, clubSpeedMph: 0, clubPathDeg: 0, faceToPathDeg: 0, clubAoADeg: 0 };
  const r = Q.check(old);
  check('spinn 0 vid 150 mph kan inte vara verkligt: uppskattat', r.ok && r.shot.totalSpinRpm > 2000 && r.estimated.indexOf('totalSpinRpm') >= 0, r);
  check('klubbfart 0: ingen klubbdata (alla fyra saknas, inga nollor kvar)', r.missing.length === 4 && r.shot.clubPathDeg === null, r.missing);
  check('spinnaxel och startriktning 0 går inte att skilja från uppmätt 0: de räknas som uppmätta', r.measured.indexOf('spinAxisDeg') >= 0 && r.measured.indexOf('azimDeg') >= 0, r.measured);
  const chip = Q.check({ ballSpeedMph: 20, launchAngleDeg: 30, totalSpinRpm: 0, spinAxisDeg: 0, azimDeg: 0 });
  check('en långsam chip med 0 rpm kan vara verklig: uppmätt', chip.ok && chip.shot.totalSpinRpm === 0 && chip.estimated.length === 0, chip);
}

console.log('\n5. Spinnet ur utgångsvinkeln');
{
  const s = [10, 16, 24].map(Q.spinFromLaunch);
  check('driver, 7-järn och PW enligt tour-snitten', s[0] === 2600 && s[1] === 7000 && s[2] === 9300, s);
  check('stiger med vinkeln och har gränser i båda ändar', Q.spinFromLaunch(-30) === 2000 && Q.spinFromLaunch(90) === 10000 && Q.spinFromLaunch(13) < Q.spinFromLaunch(14));
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll launch monitor shot quality checks passed');
process.exit(failed ? 1 : 0);
