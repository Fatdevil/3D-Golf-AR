/**
 * GSPro Open Connect-bron (gspro-bridge/).
 * 1. Ramningen: flera meddelanden i ett paket, ett meddelande delat över flera paket, klamrar i strängar, skräp, trasig JSON.
 * 2. normalizeShot: TotalSpin/SpinAxis, BackSpin/SideSpin, hjärtslag, siffror som text.
 * 3. Över riktig TCP + WebSocket: heartbeat+slag i samma paket, delat slag, dubblettskydd per anslutning.
 *    Del 3 hoppas över om `ws` inte är installerat (npm --prefix gspro-bridge install).
 * Run: node tests/test_gspro_bridge.js
 */
const net = require('net');
const path = require('path');
const P = require('../gspro-bridge/protocol.js');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const HB = { DeviceID: 'X', ShotNumber: 0, APIversion: '1', ShotDataOptions: { IsHeartBeat: true, ContainsBallData: false } };
const shot = (n, ball) => ({
  DeviceID: 'X', Units: 'Yards', ShotNumber: n, APIversion: '1',
  BallData: Object.assign({ Speed: 147.5, SpinAxis: -2.3, TotalSpin: 6250, HLA: 1.5, VLA: 16.3 }, ball || {}),
  ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, IsHeartBeat: false }
});

// ---- 1. ramning ----
{
  const a = JSON.stringify(HB), b = JSON.stringify(shot(1));
  let f = P.createFramer();
  check('ett meddelande', f.feed(b).messages.length === 1);
  f = P.createFramer();
  let r = f.feed(a + b);
  check('två meddelanden i ett paket (utan radbrytning)', r.messages.length === 2 && f.pending() === 0, r.messages.length + ' av 2');
  f = P.createFramer();
  r = f.feed(a + '\n' + b + '\n');
  check('två meddelanden med radbrytning', r.messages.length === 2);
  f = P.createFramer();
  const m1 = f.feed(b.slice(0, 40)), m2 = f.feed(b.slice(40, 120)), m3 = f.feed(b.slice(120));
  check('ett meddelande delat över tre paket', m1.messages.length === 0 && m2.messages.length === 0 && m3.messages.length === 1);
  f = P.createFramer();
  let n = 0; for (const ch of a + b) n += f.feed(ch).messages.length;
  check('byte för byte', n === 2, n + ' av 2');
  f = P.createFramer();
  r = f.feed('{"Message":"a } b { c \\" }","N":1}');
  check('klamrar och citattecken inne i strängar', r.messages.length === 1 && r.messages[0].N === 1);
  f = P.createFramer();
  r = f.feed('skräp\r\n' + b);
  check('text före meddelandet hoppas över', r.messages.length === 1);
  f = P.createFramer();
  r = f.feed('{not json}' + b);
  check('trasigt objekt blockerar inte nästa', r.messages.length === 1 && r.invalid === 1);
  f = P.createFramer();
  r = f.feed('{"a":"' + 'x'.repeat(P.MAX_BUFFER + 10));
  check('för stor halvfärdig buffert rensas', r.overflow && f.pending() === 0);
  r = f.feed(b);
  check('ramaren fungerar efter rensning', r.messages.length === 1);
}

// ---- 2. normalizeShot ----
{
  let s = P.normalizeShot(shot(1));
  check('TotalSpin/SpinAxis används rakt av', s && s.ballSpeedMph === 147.5 && s.totalSpinRpm === 6250 && s.spinAxisDeg === -2.3 && s.launchAngleDeg === 16.3 && s.azimDeg === 1.5);
  s = P.normalizeShot(shot(2, { TotalSpin: undefined, SpinAxis: undefined, BackSpin: 2500, SideSpin: -800 }));
  check('bara BackSpin/SideSpin: spinn och axel räknas fram', s && near(s.totalSpinRpm, Math.hypot(2500, 800), 0.01) && near(s.spinAxisDeg, -17.74, 0.05),
    s && s.totalSpinRpm.toFixed(0) + ' rpm, ' + s.spinAxisDeg.toFixed(1) + '°');
  s = P.normalizeShot(shot(3, { TotalSpin: undefined, Spin: 5000 }));
  check('Spin som reserv för TotalSpin', s && s.totalSpinRpm === 5000);
  check('hjärtslag är inget slag', P.normalizeShot(HB) === null && !P.isShot(HB));
  const noBall = shot(4); noBall.ShotDataOptions.ContainsBallData = false;
  check('ContainsBallData=false är inget slag', P.normalizeShot(noBall) === null);
  const bare = shot(5); delete bare.ShotDataOptions;
  check('BallData utan ShotDataOptions är ett slag', P.isShot(bare));
  s = P.normalizeShot(shot(6, { Speed: '147.5', VLA: '16.3', TotalSpin: '6250' }));
  check('siffror som text', s && s.ballSpeedMph === 147.5 && s.launchAngleDeg === 16.3 && s.totalSpinRpm === 6250);
  s = P.normalizeShot(shot(7, { Speed: 'abc', HLA: NaN }));
  check('ogiltiga värden blir 0, inte NaN', s && s.ballSpeedMph === 0 && s.azimDeg === 0);
  const withClub = shot(8); withClub.ClubData = { Speed: 100, Path: 2, FaceToTarget: 3, AngleOfAttack: -4 };
  s = P.normalizeShot(withClub);
  check('klubbdata', s && s.clubSpeedMph === 100 && s.clubPathDeg === 2 && s.faceToPathDeg === 1 && s.clubAoADeg === -4);
  const rep = P.replies();
  check('kvitto 200 + 201', rep[0].Code === 200 && rep[1].Code === 201);
}

// ---- 3. TCP + WebSocket ----
let WebSocket = null;
try { WebSocket = require('../gspro-bridge/node_modules/ws'); } catch (e) { try { WebSocket = require('ws'); } catch (e2) { /* ingen ws */ } }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function integration() {
  const { startBridge } = require('../gspro-bridge/bridge.js');
  const bridge = startBridge({ tcpPort: 0, wsPort: 0, log: () => {} });
  await bridge.ready;
  const received = [];
  const ws = new WebSocket('ws://127.0.0.1:' + bridge.wsPort());
  ws.on('message', (m) => { const o = JSON.parse(m); if (o.type === 'shot') received.push(o.data); });
  await new Promise((r) => ws.on('open', r));

  const connect = () => new Promise((resolve) => {
    const s = net.connect(bridge.tcpPort(), '127.0.0.1', () => resolve(s));
    s.replies = ''; s.on('data', (d) => { s.replies += d; });
  });
  const hb = JSON.stringify(HB), s1 = JSON.stringify(shot(1)), s2 = JSON.stringify(shot(2));

  let c = await connect();
  c.write(hb + s1);                               // heartbeat och slag i samma paket
  await wait(150);
  check('heartbeat+slag i ett paket ger ett slag i webbläsaren', received.length === 1 && received[0].totalSpinRpm === 6250, received.length + ' slag');
  check('kvitto per meddelande (2 x 200 + 2 x 201)', (c.replies.match(/"Code":200/g) || []).length === 2 && (c.replies.match(/"Code":201/g) || []).length === 2);

  c.write(s2.slice(0, 60)); await wait(60); c.write(s2.slice(60));   // slag delat mitt i JSON
  await wait(150);
  check('slag delat över två paket kommer fram', received.length === 2);

  c.write(s2); await wait(150);
  check('dubblett (samma ShotNumber) ignoreras', received.length === 2);
  c.destroy(); await wait(100);

  c = await connect();
  c.write(s2); await wait(150);
  check('samma ShotNumber godtas efter ny anslutning', received.length === 3);
  c.destroy();

  ws.terminate();
  await bridge.close();
}

(async () => {
  if (!WebSocket) {
    console.log('  SKIP  integrationstest över TCP/WebSocket: `ws` saknas (npm --prefix gspro-bridge install)');
  } else {
    try { await integration(); } catch (e) { check('integrationstest', false, e.stack || e.message); }
  }
  console.log(failed ? '\n❌ ' + failed + ' misslyckades' : '\n✅ alla gspro-bridge-tester ok');
  process.exit(failed ? 1 : 0);
})();
