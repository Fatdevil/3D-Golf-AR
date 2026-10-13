// Laddar arcade-swing-engine.js i en stubbad webbläsarmiljö så att dess logik kan testas i node. Math.random är fast (0,5 = inget slumpbrus).
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// extra.window: more fields on window (ballMesh, courseHoles, aimTarget ...); extra.globals: more globals (THREE ...); extra.document: replaces document methods
module.exports = function loadSwingEngine(extra) {
  extra = extra || {};
  const el = { classList: { add() {}, remove() {}, contains() { return false; } }, style: {}, setAttribute() {}, addEventListener() {}, appendChild() {}, textContent: '' };
  const win = { location: { search: '' }, innerWidth: 1280, addEventListener() {}, GREEN_STIMP: 10 };
  Object.defineProperties(win, Object.getOwnPropertyDescriptors(extra.window || {}));   // (descriptors: a getter stays live)
  const ctx = vm.createContext(Object.assign({
    window: win, navigator: { maxTouchPoints: 0 }, URLSearchParams: URLSearchParams, console: { log() {}, warn() {}, error() {} },
    document: Object.assign({ body: el, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} }, extra.document || {}),
    setTimeout: setTimeout, requestAnimationFrame() {}, cancelAnimationFrame() {},
  }, extra.globals || {}));
  vm.runInContext('Math.random = function () { return 0.5; };', ctx);
  const code = fs.readFileSync(path.join(__dirname, '..', 'arcade-swing-engine.js'), 'utf8');
  vm.runInContext(code + '\n;__engine = SwingEngine;', ctx);
  return ctx.__engine;
};
