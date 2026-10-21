/**
 * Gränserna för anrop: rate-limit.js (hur ofta en adress får ändra något, hur stor en kropp får vara)
 * Run: node tests/test_rate_limit.js
 */
const RL = require('../rate-limit');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

let l = RL.limiter({ windowMs: 1000, max: 3 });
check('de tre första anropen i ett fönster går igenom', l.hit('a', 0).ok && l.hit('a', 10).ok && l.hit('a', 20).ok);
let r = l.hit('a', 30);
check('det fjärde nekas, med tiden till nästa fönster', !r.ok && r.retryAfter === 1, JSON.stringify(r));
check('en annan adress påverkas inte', l.hit('b', 40).ok);
check('när fönstret är slut börjar det om', l.hit('a', 1000).ok && l.hit('a', 1001).ok && l.hit('a', 1002).ok && !l.hit('a', 1003).ok);
l = RL.limiter({ windowMs: 1000, max: 1 });
for (let i = 0; i < 50; i++) l.hit('k' + i, 0);
l.hit('x', 5000);
check('adresser som gått därifrån glöms bort så minnet inte växer', l.size() === 1, String(l.size()));
r = RL.limiter({ windowMs: 60000, max: 1 }); r.hit('a', 0);
check('tiden till nästa fönster rundas uppåt (minst en sekund)', r.hit('a', 59990).retryAfter === 1 && r.hit('a', 100).retryAfter === 60);

check('inloggning som admin är sin egen gräns', RL.classify('POST', '/api/admin/login') === 'login');
check('att skapa konton är sin egen gräns', RL.classify('POST', '/api/auth/register') === 'register');
check('alla andra ändringar under /api räknas som skrivningar', ['POST', 'PUT', 'DELETE', 'PATCH'].every(m => RL.classify(m, '/api/courses') === 'write'));
check('läsning och filer räknas inte', RL.classify('GET', '/api/courses') === null && RL.classify('GET', '/arcade.html') === null && RL.classify('POST', '/other') === null && RL.classify('OPTIONS', '/api/courses') === null);

check('konto och inloggning får små kroppar', RL.bodyLimit('/api/auth/register') === '100kb' && RL.bodyLimit('/api/users/x') === '100kb' && RL.bodyLimit('/api/admin/login') === '100kb');
check('resultat, gilla och samlingar får 1 MB', RL.bodyLimit('/api/courses/ABC/results') === '1mb' && RL.bodyLimit('/api/courses/ABC/like') === '1mb' && RL.bodyLimit('/api/collections') === '1mb' && RL.bodyLimit('/api/collections/X') === '1mb');
check('banor, modeller och bilder behåller den stora gränsen', RL.bodyLimit('/api/courses') === '50mb' && RL.bodyLimit('/api/assets') === '50mb' && RL.bodyLimit('/api/starter-plates') === '50mb' && RL.bodyLimit('/api/biomes') === '50mb');

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
