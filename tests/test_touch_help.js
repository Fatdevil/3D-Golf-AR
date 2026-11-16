// Help texts on a phone or a tablet: a text that names mouse buttons has a wording of its own under "<key>_touch" in i18n.js.
// t() gives that wording on a touch device and the ordinary one on a computer; every touch text exists in both languages and
// names no mouse button (except to say that something needs a mouse).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8');
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '   ' + JSON.stringify(detail)));
  if (!ok) failed++;
}

// i18n.js in a page of its own: a user agent, a stored language, an empty document
function page(userAgent, maxTouchPoints, lang) {
  const store = { golf_os_lang: lang };
  const win = {};
  const ctx = {
    window: win,
    navigator: { userAgent: userAgent, maxTouchPoints: maxTouchPoints || 0 },
    localStorage: { getItem: function (k) { return store[k] === undefined ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); } },
    document: { readyState: 'complete', documentElement: {}, querySelectorAll: function () { return []; }, getElementById: function () { return null; }, addEventListener: function () {} },
    CustomEvent: function () {}, console: console
  };
  win.dispatchEvent = function () {}; win.addEventListener = function () {};
  vm.runInNewContext(src, ctx);
  return win;
}

const UA = {
  computer: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
};

// which device counts as touch
check('a computer is not a touch device', page(UA.computer, 0, 'sv').isTouchUI() === false);
check('a Mac without touch points is not a touch device', page(UA.mac, 0, 'sv').isTouchUI() === false);
check('an iPhone is a touch device', page(UA.iphone, 5, 'sv').isTouchUI() === true);
check('an Android phone is a touch device', page(UA.android, 5, 'sv').isTouchUI() === true);
check('an iPad (reports itself as a Macintosh with touch points) is a touch device', page(UA.mac, 5, 'sv').isTouchUI() === true);

// the keys with a touch wording, read from the file: each must stand in both languages
const touchKeys = Array.from(new Set((src.match(/"([a-z0-9_]+)_touch":/g) || []).map(function (m) { return m.slice(1, -8); })));
check('there are touch wordings in the dictionary', touchKeys.length >= 10, touchKeys.length);
const counts = {};
(src.match(/"([a-z0-9_]+)_touch":/g) || []).forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
check('every touch wording stands twice (English and Swedish)', Object.keys(counts).every(function (k) { return counts[k] === 2; }), counts);

// what must not be left in a touch text, once "needs a mouse (right-click)" is taken out
const MOUSE = /högerkli|vänsterkli|right[- ]click|left[- ]click|hold left|hold right|håll vänster|håll höger|\bclick\b|\bklicka\b|\bshift\b/i;
const ALLOWED = /kräver mus[:]? ?\(?högerklick\)?|needs a mouse[:]? ?\(?right-click\)?/gi;

['sv', 'en'].forEach(function (lang) {
  const comp = page(UA.computer, 0, lang), tab = page(UA.mac, 5, lang);
  const sameOnComputer = [], notTouch = [], mouseWords = [], same = [];
  touchKeys.forEach(function (k) {
    const onComputer = comp.t(k), onTablet = tab.t(k), touchText = comp.t(k + '_touch');
    if (onComputer === touchText) sameOnComputer.push(k);        // a computer never gets the touch wording
    if (onTablet !== touchText) notTouch.push(k);                // a tablet always does
    if (MOUSE.test(onTablet.replace(ALLOWED, ''))) mouseWords.push(k + ': ' + onTablet);
    if (touchText === k + '_touch') same.push(k);                // the wording exists in this language (or falls back to English)
  });
  check(lang + ': a computer keeps the ordinary wording', sameOnComputer.length === 0, sameOnComputer);
  check(lang + ': a tablet gets the touch wording', notTouch.length === 0, notTouch);
  check(lang + ': no touch wording names a mouse button', mouseWords.length === 0, mouseWords);
  check(lang + ': every touch wording is found', same.length === 0, same);
});

// a key without a touch wording is the same everywhere
check('a text without a touch wording is unchanged on a tablet', page(UA.mac, 5, 'sv').t('mtn_build') === page(UA.computer, 0, 'sv').t('mtn_build'));
// the Swedish and English touch wordings differ (a Swedish player is not given English)
check('Swedish and English touch wordings differ', touchKeys.every(function (k) { return page(UA.mac, 5, 'sv').t(k) !== page(UA.mac, 5, 'en').t(k); }));

if (failed) { console.log('\n❌ ' + failed + ' check(s) failed'); process.exit(1); }
console.log('\nAll touch help checks passed');
