// hitbox-fit.js: the collision profile fitted to a model's triangles, the hit test, and prop-collision.js (what the shot physics calls).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const HF = require(path.join(root, 'hitbox-fit.js'));
const { glbMesh } = require(path.join(root, 'tools', 'glb-mesh.js'));

let failed = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS  ' : '❌ FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- synthetic models (y up): a closed-ish surface of triangles is enough for the slicing
function lathe(profile, cx, cz, seg) {   // profile: [[y, r], ...] bottom to top; a surface of revolution around the vertical line through (cx, cz)
  const positions = [], indices = [];
  profile.forEach(function (pr) { for (let s = 0; s < seg; s++) { const a = s / seg * Math.PI * 2; positions.push(cx + Math.cos(a) * pr[1], pr[0], cz + Math.sin(a) * pr[1]); } });
  for (let k = 0; k + 1 < profile.length; k++) for (let s = 0; s < seg; s++) {
    const a = k * seg + s, b = k * seg + (s + 1) % seg, c = (k + 1) * seg + s, d = (k + 1) * seg + (s + 1) % seg;
    indices.push(a, b, c, b, d, c);
  }
  return { positions, indices };
}
function merge(a, b) { const off = a.positions.length / 3; return { positions: a.positions.concat(b.positions), indices: a.indices.concat(b.indices.map(i => i + off)) }; }

// a cone: radius 4 at the ground to 0 at 12 m
const cone = lathe([[0, 4], [3, 3], [6, 2], [9, 1], [12, 0.001]], 0, 0, 24);
let p = HF.fit(cone, { targetHeight: 12 });
check('cone: band radii shrink with height and follow the cone', p.slices[0].r > 3.3 && p.slices[11].r < 0.6 && p.slices.every((s, i) => i === 0 || s.r <= p.slices[i - 1].r + 0.05),
  p.slices.map(s => s.r).join(' '));
check('cone has no stem: the trunk is a guessed pole', p.trunk.guessed === true && p.trunk.r < 1, JSON.stringify(p.trunk));

// a tree: a stem (r 0.4, 0 to 5 m) with a round crown (radius 3, centre 8 m) on top, the whole crown hanging 2 m to the +x side
const stem = lathe([[0, 0.4], [5, 0.4]], 0, 0, 16);
const crown = lathe([[5, 0.01], [6, 2.4], [8, 3], [10, 2.4], [11, 0.01]], 2, 0, 24);
const tree = merge(stem, crown);
p = HF.fit(tree, { targetHeight: 11 });
const bboxCx = (-0.4 + 5) / 2;   // the x-centre of the box the game centres on: (min x -0.4, max x 5)
check('tree: a real stem is found, with its radius and height', !p.trunk.guessed && near(p.trunk.r, 0.4, 0.15) && p.trunk.h >= 4.5 && p.trunk.h <= 6.5, JSON.stringify(p.trunk));
check('tree: the crown starts above the stem', p.crownY >= 4.5 && p.crownY <= 6.5, String(p.crownY));
const mid = p.slices.find(s => s.y0 <= 8 && s.y1 >= 8);
check('tree: the crown band is as wide as the crown and sits where the crown is (the model is centred on its box)', near(mid.r, 3, 0.4) && near(mid.cx, 2 - bboxCx, 0.4), JSON.stringify(mid));
check('tree: the trunk sits where the stem is', near(p.trunk.cx, 0 - bboxCx, 0.3), JSON.stringify(p.trunk));

// the hit test: object at (10, 20), scale 1, not turned
const ox = 10, oz = 20, tx = ox + p.trunk.cx, tz = oz + p.trunk.cz;
let h = HF.hit(p, 1, 0, ox, oz, tx + 0.2, tz, 1.5);
check('ball inside the trunk: TRUNK, normal away from the trunk, safe spot outside it', h && h.part === 'TRUNK' && h.nx > 0.9 && Math.hypot(h.sx - tx, h.sz - tz) > p.trunk.r, JSON.stringify(h));
h = HF.hit(p, 1, 0, ox, oz, tx + 1.5, tz, 1.5);
check('ball beside the trunk, below the crown: no hit', h === null, JSON.stringify(h));
h = HF.hit(p, 1, 0, ox, oz, ox + mid.cx, oz + mid.cz, 8);
check('ball in the middle of the crown: CANOPY', h && h.part === 'CANOPY', JSON.stringify(h));
h = HF.hit(p, 1, 0, ox, oz, ox + mid.cx + mid.r + 0.5, oz + mid.cz, 8);
check('ball just outside the crown: no hit', h === null, JSON.stringify(h));
h = HF.hit(p, 1, 0, ox, oz, ox + mid.cx, oz + mid.cz, 11.5);
check('ball above the tree: no hit', h === null, JSON.stringify(h));

// turning the object: the crown that hangs to +x goes to -z when turned a quarter turn (three.js: rotation about y by 90 degrees takes +x to -z)
h = HF.hit(p, 1, Math.PI / 2, ox, oz, ox + mid.cz, oz - mid.cx, 8);
check('object turned a quarter turn: the crown moved with it', h && h.part === 'CANOPY', JSON.stringify(h));
let THREE = null; try { THREE = require(path.join(__dirname, 'node_modules', 'three', 'build', 'three.min.js')); } catch (e) { /* no three here: the formula check below is skipped */ }
if (THREE) {
  const rot = 1.1, off = new THREE.Vector3(mid.cx, 0, mid.cz).applyEuler(new THREE.Euler(0, rot, 0, 'YXZ'));
  h = HF.hit(p, 1, rot, ox, oz, ox + off.x, oz + off.z, 8);
  check('the rotation agrees with three.js (the same Euler as the instances)', h && h.part === 'CANOPY', JSON.stringify(h));
}

// scale: a prop placed at twice the size has a hitbox twice the size
h = HF.hit(p, 2, 0, ox, oz, ox + 2 * (mid.cx + mid.r - 0.2), oz + 2 * mid.cz, 16);
check('scale 2: the crown is twice as wide and twice as high', h && h.part === 'CANOPY', JSON.stringify(h));
const q = HF.scale(HF.scale(p, 2), 0.5);
check('scale and back gives the same profile', q.slices.every((s, i) => near(s.r, p.slices[i].r, 0.002) && near(s.cx, p.slices[i].cx, 0.002)) && near(q.height, p.height, 0.002), '');

// bad input
let threw = false; try { HF.fit({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 1] }, { targetHeight: 5 }); } catch (e) { threw = true; }
check('a model with no height is refused with a message, not a crash', threw, '');

// the models in the repo
['Oaktree.glb', 'Oaktree_1.glb', 'cactus_1.glb', 'palm3.glb'].forEach(function (f) {
  const fp = path.join(root, f);
  if (!fs.existsSync(fp)) return;
  const m = glbMesh(fs.readFileSync(fp)), r = HF.fit(m, { targetHeight: 15, bbox: m.bbox });
  check(f + ': fits to 12 bands inside the model, with a trunk and a reach', r.slices.length === 12 && r.slices.every(s => s.r >= 0 && s.r < 30) && r.trunk.r > 0 && r.reach > 0 && r.height === 15, JSON.stringify(r.trunk));
});

// ---- prop-collision.js: what physics.js calls for each placed object
const reg = {
  S: { physics: { type: 'sphere', radius: 2 } },
  C: { physics: { type: 'cylinder', radius: 1, height: 6 } },
  T: { physics: { type: 'tree', trunkRadius: 0.5, canopyRadius: 3, height: 10 } },
  P: { physics: p }
};
const win = { ASSET_REGISTRY: reg, HitboxFit: HF };
vm.runInNewContext(fs.readFileSync(path.join(root, 'prop-collision.js'), 'utf8'), { window: win });
const at = (type, x, z, scale, rot) => ({ type, x, z, scale, rot });
check('sphere: a hit inside, none outside or above', win.propHitAt(at('S', 0, 0, 1), 1, 0, 1).n && !win.propHitAt(at('S', 0, 0, 1), 3, 0, 1) && !win.propHitAt(at('S', 0, 0, 1), 1, 0, 3));
check('cylinder: a hit up to its height', !!win.propHitAt(at('C', 0, 0, 1), 0.5, 0, 5) && !win.propHitAt(at('C', 0, 0, 1), 0.5, 0, 7));
let t = win.propHitAt(at('T', 0, 0, 1), 0.2, 0, 2), c = win.propHitAt(at('T', 0, 0, 1), 2, 0, 6);
check('tree (unchanged): trunk low and near, canopy high', t && t.part === 'TRUNK' && t.n && c && c.part === 'CANOPY' && !c.n);
const pr = win.propHitAt(at('P', ox, oz, 1, 0), tx + 0.2, tz, 1.5), pc = win.propHitAt(at('P', ox, oz, 1, 0), ox + mid.cx, oz + mid.cz, 8);
check('profile: trunk with a normal and safe spot in physics order, canopy without', pr && pr.part === 'TRUNK' && pr.n.length === 3 && pr.n[2] === 0 && pr.safePos.length === 2 && pc && pc.part === 'CANOPY' && !pc.n && pc.height === p.height, JSON.stringify([pr, pc]));
check('an object without physics or of an unknown type is no obstacle', win.propHitAt(at('NOPE', 0, 0, 1), 0, 0, 1) === null);

// ---- the wiring in arcade.html
const html = fs.readFileSync(path.join(root, 'arcade.html'), 'utf8');
check('arcade.html loads both scripts before the game code that uses them', html.indexOf('hitbox-fit.js') > 0 && html.indexOf('prop-collision.js') > html.indexOf('hitbox-fit.js') && html.indexOf('prop-collision.js') < html.indexOf('checkCollisionCallback'));
check('the collision callback asks propHitAt for every placed object', /let hit = window\.propHitAt\(window\.placedTrees\[i\], threeX, threeZ, z\)/.test(html));
const admin = fs.readFileSync(path.join(root, 'admin_assets.html'), 'utf8');
check('the admin page has the profile shape, the fit button and loads the fitter', /<option value="profile">/.test(admin) && /id="btn-fit-hitbox"/.test(admin) && /hitbox-fit\.js/.test(admin));

if (failed) { console.log('\n❌ ' + failed + ' failed'); process.exit(1); }
console.log('\n✅ hitbox fit ok');
