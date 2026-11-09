/**
 * Vegetation in the surroundings (window.SurroundVeg): 2D trees in a belt outside the 600 x 600 m plate, per side (N, E, S, W).
 * Each side has a ground colour already (the horizon panel: deep rough, rough, waste / sand, ocean, lake, mountain horizon, sky, none).
 * Each side now also has a vegetation:
 *   AUTO    after the ground: deep rough / rough a forest (a desert biome: sparse desert plants), waste / sand palms, the mountain horizon a
 *           sparse forest, water and sky nothing
 *   NONE, FOREST, PALMS, DESERT (cacti and shrubs, a few palms), CUSTOM (the types picked in the panel)
 * Each tree has a soft shadow on the ground (cast away from the sun, and a faint patch under the crown; the cards cast nothing into
 * the shadow map).
 * The trees are cards that turn to the camera (the far-away cards of arcade.html, makePropImpostor: the same picture of the 3D model,
 * tinted by the biome like the models). No shadow, no collision: nothing outside the plate is played. A tree belongs to the side whose
 * weight is largest where it stands, the same weights the surround plane blends its colours with, so the vegetation follows the ground.
 * Saved as settings on the holes (hole.surroundVeg: sides, density, depth, custom types, seed, ob), not as thousands of objects: the same
 * belt is grown from them on every load.
 * The OB areas on the plate (painted OB, drawn as rough in play) can be filled the same way (ob: a vegetation, NONE by default; AUTO a
 * forest, desert plants in a desert biome): 2D trees on OB ground, at least OB_INSET m in from its edge (the ball's side of the line stays
 * open), only in play and test mode (in building the OB paint is what is worked on). The cards dissolve close to the camera
 * (PROP_CARD_NEAR in arcade.html). No collision: a ball in there is out of bounds already.
 */
(function (root) {
    'use strict';
    const SIDES = ['N', 'E', 'S', 'W'];
    const VEG = ['AUTO', 'NONE', 'FOREST', 'PALMS', 'DESERT', 'CUSTOM'];
    const DEFAULT = { sides: { N: 'AUTO', E: 'AUTO', S: 'AUTO', W: 'AUTO' }, density: 1, depth: 250, custom: [], seed: 1, ob: 'NONE' };
    const PER_M2 = 1 / 550;              // candidate trees per m² at density 1 (a forest keeps all of them)
    const KEEP = { FOREST: 1, SPARSE: 0.25, PALMS: 0.3, DESERT: 0.22, CUSTOM: 0.8 };
    const GAP = 20;                      // m of open ground between the plate edge and the belt
    const MAX_TREES = 6000;
    const MAX_TYPES = 4;                 // per vegetation: each type is a model to load and a picture to take
    const OB_PER_M2 = 1 / 300;           // candidate trees per m² of the plate for the OB areas at density 1 (denser: they are seen closer)
    const OB_INSET = 10;                 // m between the OB line and the first tree
    const OB_MAX = 4000;

    let cfg = clone(DEFAULT);
    let autoScale = 1;                   // the automatic graphics level's share of the density (arcade-auto-quality.js; not saved)
    let meshes = [];
    let impostors = {};                  // type -> card (texture, plane, material) of our own, when no prop pool has one
    let timer = null, tries = 0;
    let lastStatus = '';

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function reg(t) { return (root.ASSET_REGISTRY && root.ASSET_REGISTRY[t]) || null; }
    function nameOf(t) { const r = reg(t); return String((r && (r.name || (r.polyAttribution && r.polyAttribution.title))) || t); }
    function isPalm(t) { return /palm/i.test(nameOf(t)); }
    function isDesertPlant(t) { return /cact|kaktus|succul|agave|yucca|shrub|bush|buske|sage|joshua/i.test(nameOf(t)); }
    function desertBiome() { return /DESERT/.test(String(root.ACTIVE_BIOME || '')); }
    function types(sub) { return Object.keys(root.ASSET_REGISTRY || {}).filter(function (k) { const r = reg(k); return r && r.subcat === sub; }); }
    function fitsBiome(t) { const r = reg(t), b = r && r.biomes; if (!b || !b.length) return true; const a = String(root.ACTIVE_BIOME || 'GLOBAL'); return b.indexOf('GLOBAL') >= 0 || b.indexOf('ALL') >= 0 || b.indexOf(a) >= 0; }
    function tr(key, fb) { return (root.t && root.t(key) !== key) ? root.t(key) : fb; }

    // what a side grows when it is left on AUTO, from its ground colour
    function autoVeg(groundKey) {
        if (groundKey === 'fescueColor' || groundKey === 'roughColor') return desertBiome() ? 'DESERT' : 'FOREST';
        if (groundKey === 'wasteColor') return 'PALMS';
        if (groundKey === 'horizonColor') return 'SPARSE';
        return 'NONE';
    }
    function vegOf(side) {
        if (side === 'OB') { const o = cfg.ob || 'NONE'; return o === 'AUTO' ? (desertBiome() ? 'DESERT' : 'FOREST') : o; }
        const v = cfg.sides[side] || 'AUTO';
        return v === 'AUTO' ? autoVeg(root.surroundConfig && root.surroundConfig[side]) : v;
    }
    // OB ground at x, z, and all round it OB_INSET m out (8 directions): a tree there stands well inside the OB area
    function obAt(x, z) { const g = root.localGetTerrainAt && root.localGetTerrainAt(x, -z); return !!g && g.type === 'OB'; }
    function obClear(x, z, half) {
        if (Math.abs(x) > half - OB_INSET || Math.abs(z) > half - OB_INSET || !obAt(x, z)) return false;
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (!obAt(x + Math.cos(a) * OB_INSET, z + Math.sin(a) * OB_INSET)) return false; }
        return true;
    }
    function playing() { const m = typeof root.getAppMode === 'function' ? root.getAppMode() : 'PLAY'; return m === 'PLAY' || m === 'TEST'; }

    // the types a vegetation is made of, with weights: a forest is the trees already on the course (as many as they are), else the library's
    function pick(list, n) { return list.slice(0, n).map(function (t) { return { type: t, w: 1 }; }); }
    function poolFor(veg) {
        if (veg === 'CUSTOM') return (cfg.custom || []).filter(reg).slice(0, 8).map(function (t) { return { type: t, w: 1 }; });
        if (veg === 'FOREST' || veg === 'SPARSE') {
            const count = {};
            (root.placedTrees || []).forEach(function (o) { const r = o && reg(o.type); if (r && r.subcat === 'TREES' && !isPalm(o.type)) count[o.type] = (count[o.type] || 0) + 1; });
            const onCourse = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, MAX_TYPES);
            if (onCourse.length) return onCourse.map(function (t) { return { type: t, w: count[t] }; });
            return pick(types('TREES').filter(function (t) { return !isPalm(t) && fitsBiome(t); }), MAX_TYPES);
        }
        if (veg === 'PALMS') return pick(types('TREES').filter(isPalm), 3);
        if (veg === 'DESERT') {
            const plants = pick(types('PLANTS').filter(isDesertPlant).concat(types('TREES').filter(function (t) { return !isPalm(t) && isDesertPlant(t); })), 3);
            const palms = pick(types('TREES').filter(isPalm), 1).map(function (p) { p.w = 0.25; return p; });
            return plants.concat(palms);
        }
        return [];
    }

    // ---- the belt -----------------------------------------------------------------------------------------------------------------------
    function rng(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    // the side whose weight is largest at x, z (as the surround plane's shader: E is +x, S is +z, W is -x, N is -z)
    function sideAt(x, z) {
        const a = Math.atan2(z, x), c = Math.cos(a), s = Math.sin(a);
        const w = { E: Math.max(0, c), S: Math.max(0, s), W: Math.max(0, -c), N: Math.max(0, -s) };
        let best = 'E'; SIDES.forEach(function (k) { if (w[k] > w[best]) best = k; }); return best;
    }

    function clear() {
        meshes.forEach(function (m) {
            if (m.parent) m.parent.remove(m);
            const g = m.geometry, own = g.attributes.instanceTrunkColor;
            g.attributes = {}; g.index = null; if (own) g.setAttribute('instanceTrunkColor', own);
            g.dispose(); if (typeof m.dispose === 'function') m.dispose();
        });
        meshes = [];
    }

    function cardFor(type) {
        const pool = root.instancePools && root.instancePools[type];
        if (pool && pool.impostor) return pool.impostor;
        if (impostors[type]) return impostors[type];
        if (typeof root.makePropImpostor !== 'function') return null;
        const c = root.makePropImpostor(type);
        if (c) impostors[type] = c;
        return c || null;
    }

    function setStatus(msg) {
        lastStatus = msg;
        const el = typeof document !== 'undefined' && document.getElementById('veg-status');
        if (el) el.textContent = msg;
    }

    // grows the belt from the settings; waits for the models it needs (they load on demand)
    function build() {
        timer = null;
        const scene = root.scene || (root.G && root.G.scene);
        if (!scene || !root.THREE || !root.surroundConfig) return;
        clear();
        const sideVeg = {}, pools = {}, missing = [];
        SIDES.concat(['OB']).forEach(function (s) {
            const v = vegOf(s);
            sideVeg[s] = v;
            if (v !== 'NONE' && !pools[v]) { pools[v] = poolFor(v); if (!pools[v].length) missing.push(v); }
        });
        // the models: ask for those not loaded; build again when they are
        let waiting = 0;
        Object.keys(pools).forEach(function (v) {
            pools[v].forEach(function (p) {
                const m = root.customModels && root.customModels[p.type];
                if (!m || m === 'LOADING') { waiting++; if (!m && typeof root.loadAsset === 'function') root.loadAsset(p.type, function () {}); }
            });
        });
        if (waiting && tries < 20) { tries++; timer = setTimeout(build, 1500); setStatus(tr('veg_status_loading', 'Laddar trädmodeller…')); return; }
        tries = 0;

        const half = ((root.G && root.G.TERRAIN_SIZE) || root.TERRAIN_SIZE || 600) / 2 + GAP, outer = half + Math.max(40, cfg.depth || 250);
        const area = 4 * outer * outer - 4 * half * half;
        const r = rng(cfg.seed || 1);
        const per = {};   // type -> side -> [x, z, s, rnd]
        let n = 0;
        const candidates = Math.min(MAX_TREES * 4, Math.round(area * PER_M2 * Math.max(0, cfg.density) * autoScale));
        for (let i = 0; i < candidates && n < MAX_TREES; i++) {
            const x = (r() * 2 - 1) * outer, z = (r() * 2 - 1) * outer, keep = r(), which = r(), sc = r(), tint = r();
            if (Math.abs(x) < half && Math.abs(z) < half) continue;
            const side = sideAt(x, z), v = sideVeg[side];
            if (v === 'NONE' || !pools[v] || !pools[v].length || keep > (KEEP[v] || 0.5)) continue;
            const pool = pools[v];
            let tot = 0; pool.forEach(function (p) { tot += p.w; });
            let acc = which * tot, t = pool[pool.length - 1].type;
            for (let k = 0; k < pool.length; k++) { acc -= pool[k].w; if (acc <= 0) { t = pool[k].type; break; } }
            const byType = per[t] || (per[t] = {});
            (byType[side] || (byType[side] = [])).push([x, z, 0.75 + sc * 0.55, tint, 0]);
            n++;
        }
        // the OB areas on the plate (their own random stream: changing the belt does not move them)
        const obVeg = sideVeg.OB, obPool = pools[obVeg];
        if (obVeg !== 'NONE' && obPool && obPool.length && typeof root.localGetTerrainAt === 'function') {
            const plate = half - GAP, ro = rng(((cfg.seed || 1) * 7919 + 13) >>> 0);
            const cand = Math.min(OB_MAX * 6, Math.round(4 * plate * plate * OB_PER_M2 * Math.max(0, cfg.density) * autoScale));
            let tot = 0; obPool.forEach(function (p) { tot += p.w; });
            let m = 0;
            for (let i = 0; i < cand && m < OB_MAX; i++) {
                const x = (ro() * 2 - 1) * plate, z = (ro() * 2 - 1) * plate, keep = ro(), which = ro(), sc = ro(), tint = ro();
                if (keep > Math.min(1, (KEEP[obVeg] || 0.5) * 1.5) || !obClear(x, z, plate)) continue;
                let acc = which * tot, t = obPool[obPool.length - 1].type;
                for (let k = 0; k < obPool.length; k++) { acc -= obPool[k].w; if (acc <= 0) { t = obPool[k].type; break; } }
                const byType = per[t] || (per[t] = {});
                const y = typeof root.getTerrainHeight === 'function' ? (root.getTerrainHeight(x, z) || 0) : 0;
                (byType.OB || (byType.OB = [])).push([x, z, 0.75 + sc * 0.55, tint, y]);
                m++;
            }
        }

        const THREE = root.THREE, mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3();
        let drawn = 0;
        Object.keys(per).forEach(function (t) {
            const card = cardFor(t);
            if (!card) return;
            SIDES.concat(['OB']).forEach(function (side) {
                const list = per[t][side];
                if (!list || !list.length) return;
                const g = new THREE.BufferGeometry();
                g.setIndex(card.geometry.index);
                for (const k in card.geometry.attributes) g.setAttribute(k, card.geometry.attributes[k]);
                g.setAttribute('instanceTrunkColor', new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3));
                const m = new THREE.InstancedMesh(g, card.material, list.length);
                m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
                let cx = 0, cz = 0, maxS = 0, cy = 0;
                const yAxis = new THREE.Vector3(0, 1, 0), tq = new THREE.Quaternion();
                list.forEach(function (p, i) {
                    // each tree turned its own way: the card shows the side of the model the camera sees on that tree (8 photographs)
                    pos.set(p[0], p[4], p[1]); scl.set(p[2], p[2], p[2]); tq.setFromAxisAngle(yAxis, p[3] * Math.PI * 2);
                    mtx.compose(pos, tq, scl);
                    m.setMatrixAt(i, mtx);
                    // (the colour as a placed tree of the type gets it: the biome's palette by position; a brightness off 1 would turn the
                    // tint shader on with a white colour and grey the crown)
                    const col = typeof root.propColors === 'function' ? root.propColors({ x: p[0], z: p[1] }, true) : null;
                    if (col) { m.setColorAt(i, col.canopy); g.attributes.instanceTrunkColor.setXYZ(i, col.trunk.r, col.trunk.g, col.trunk.b); }
                    else { m.setColorAt(i, new THREE.Color(1, 1, 1)); g.attributes.instanceTrunkColor.setXYZ(i, 1, 1, 1); }
                    cx += p[0]; cz += p[1]; cy += p[4]; maxS = Math.max(maxS, p[2]);
                });
                cx /= list.length; cz /= list.length; cy /= list.length;
                let rad = 0; list.forEach(function (p) { rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cz, p[4] - cy)); });
                g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad + card.radius * maxS + 20);
                m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; g.attributes.instanceTrunkColor.needsUpdate = true;
                m.castShadow = false; m.receiveShadow = false; m.frustumCulled = true;
                m.raycast = function () {};
                m.userData.surroundVeg = { type: t, side: side };
                if (side === 'OB') m.visible = playing();
                scene.add(m);
                meshes.push(m);
                drawn += list.length;
                // the lying card seen from above (arcade.html makePropImpostor): fades in as the camera looks down; each tree turned its own way
                if (card.topGeometry) {
                    const tg = new THREE.BufferGeometry();
                    tg.setIndex(card.topGeometry.index);
                    for (const k in card.topGeometry.attributes) tg.setAttribute(k, card.topGeometry.attributes[k]);
                    tg.setAttribute('instanceTrunkColor', g.attributes.instanceTrunkColor.clone());
                    const tm = new THREE.InstancedMesh(tg, card.topMaterial, list.length);
                    tm.instanceColor = m.instanceColor.clone();
                    list.forEach(function (p, i) {
                        pos.set(p[0], p[4], p[1]); scl.set(p[2], p[2], p[2]); tq.setFromAxisAngle(yAxis, p[3] * Math.PI * 2);
                        mtx.compose(pos, tq, scl);
                        tm.setMatrixAt(i, mtx);
                    });
                    tg.boundingSphere = g.boundingSphere.clone();
                    tm.instanceMatrix.needsUpdate = true; tm.instanceColor.needsUpdate = true; tg.attributes.instanceTrunkColor.needsUpdate = true;
                    tm.castShadow = false; tm.receiveShadow = false; tm.frustumCulled = true;
                    tm.raycast = function () {};
                    tm.userData.surroundVeg = { type: t, side: side, top: true };
                    if (side === 'OB') tm.visible = playing();
                    scene.add(tm);
                    meshes.push(tm);
                }
                // the soft shadow on the ground under each tree (arcade.html makePropImpostor: the cards cast none into the shadow map)
                if (card.shadowGeometry) {
                    const sg = new THREE.BufferGeometry();
                    sg.setIndex(card.shadowGeometry.index);
                    for (const k in card.shadowGeometry.attributes) sg.setAttribute(k, card.shadowGeometry.attributes[k]);
                    const sm = new THREE.InstancedMesh(sg, card.shadowMaterial, list.length);
                    list.forEach(function (p, i) {
                        pos.set(p[0], p[4], p[1]); scl.set(p[2], p[2], p[2]); tq.setFromAxisAngle(yAxis, p[3] * Math.PI * 2);
                        mtx.compose(pos, tq, scl);
                        sm.setMatrixAt(i, mtx);
                    });
                    sg.boundingSphere = g.boundingSphere.clone();
                    sg.boundingSphere.radius += (card.shadowReach || 0) * maxS;   // the cast shadow lies away from the sun
                    sm.instanceMatrix.needsUpdate = true;
                    sm.castShadow = false; sm.receiveShadow = false; sm.frustumCulled = true;
                    sm.raycast = function () {};
                    sm.userData.surroundVeg = { type: t, side: side, shadow: true };
                    if (side === 'OB') sm.visible = playing();
                    scene.add(sm);
                    meshes.push(sm);
                }
            });
        });
        const names = { FOREST: tr('veg_forest', 'Skog'), SPARSE: tr('veg_forest', 'Skog'), PALMS: tr('veg_palms', 'Palmer'), DESERT: tr('veg_desert', 'Öken'), CUSTOM: tr('veg_custom', 'Egen') };
        if (missing.length) setStatus(tr('veg_status_missing', 'Inget i biblioteket för') + ': ' + missing.map(function (v) { return names[v] || v; }).join(', ') + ' · ' + drawn + ' ' + tr('veg_status_trees', 'träd'));
        else setStatus(drawn + ' ' + tr('veg_status_trees', 'träd'));
    }

    function schedule(ms) {
        if (timer) clearTimeout(timer);
        tries = 0;
        timer = setTimeout(build, ms === undefined ? 300 : ms);
    }

    // ---- settings ----------------------------------------------------------------------------------------------------------------------
    function holes() { return (typeof root.courseHolesRef === 'function' ? root.courseHolesRef() : root.courseHoles) || []; }
    function save() {
        const hs = holes();
        hs.forEach(function (h) { if (h) h.surroundVeg = clone(cfg); });   // one setting for the whole plate, like the ground colours
        root._editRev = (root._editRev || 0) + 1;
        if (typeof root.saveLevel === 'function') root.saveLevel(false, true);
    }
    function sanitize(c) {
        const out = clone(DEFAULT);
        if (!c || typeof c !== 'object') return out;
        SIDES.forEach(function (s) { if (c.sides && VEG.indexOf(c.sides[s]) >= 0) out.sides[s] = c.sides[s]; });
        if (isFinite(c.density)) out.density = Math.max(0, Math.min(3, +c.density));
        if (isFinite(c.depth)) out.depth = Math.max(40, Math.min(700, +c.depth));
        if (Array.isArray(c.custom)) out.custom = c.custom.filter(function (t) { return typeof t === 'string'; }).slice(0, 8);
        if (isFinite(c.seed)) out.seed = c.seed | 0;
        if (VEG.indexOf(c.ob) >= 0) out.ob = c.ob;
        return out;
    }
    // the plate's setting from the holes (the first hole that has one), else the default (all sides AUTO)
    function restore() {
        let found = null;
        holes().forEach(function (h) { if (!found && h && h.surroundVeg) found = h.surroundVeg; });
        cfg = sanitize(found);
        syncUI();
        schedule(0);
    }

    function syncUI() {
        if (typeof document === 'undefined') return;
        SIDES.forEach(function (s) { const el = document.getElementById('veg-' + s); if (el) el.value = cfg.sides[s]; });
        const ob = document.getElementById('veg-OB'); if (ob) ob.value = cfg.ob;
        const d = document.getElementById('veg-density'), dv = document.getElementById('veg-density-val');
        if (d) d.value = cfg.density; if (dv) dv.textContent = Math.round(cfg.density * 100) + '%';
        const p = document.getElementById('veg-depth'), pv = document.getElementById('veg-depth-val');
        if (p) p.value = cfg.depth; if (pv) pv.textContent = Math.round(cfg.depth) + ' m';
        renderCustomList();
        if (lastStatus) setStatus(lastStatus);
    }
    function renderCustomList() {
        const box = typeof document !== 'undefined' && document.getElementById('veg-custom-list');
        if (!box) return;
        const any = SIDES.some(function (s) { return cfg.sides[s] === 'CUSTOM'; }) || cfg.ob === 'CUSTOM';
        box.style.display = any ? 'grid' : 'none';
        if (!any) return;
        const list = types('TREES').concat(types('PLANTS'));
        box.innerHTML = '';
        list.forEach(function (t) {
            const on = cfg.custom.indexOf(t) >= 0;
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = (reg(t).icon || '🌳') + ' ' + nameOf(t).slice(0, 18);
            b.setAttribute('data-type', t);
            b.style.cssText = 'border:none; border-radius:6px; padding:5px 4px; font-size:9px; font-weight:bold; cursor:pointer; text-align:left; overflow:hidden; white-space:nowrap; ' +
                (on ? 'background:#4ade80; color:#0f172a;' : 'background:#334155; color:#94a3b8;');
            b.onclick = function () { api.toggleCustom(t); };
            box.appendChild(b);
        });
        if (!list.length) box.textContent = tr('veg_custom_empty', 'Inga träd eller växter i biblioteket.');
    }

    const api = {
        SIDES: SIDES, VEG: VEG,
        config: function () { return clone(cfg); },
        vegOf: vegOf, poolFor: poolFor, sideAt: sideAt,
        meshes: function () { return meshes.slice(); },
        count: function () { let c = 0; meshes.forEach(function (m) { const u = m.userData.surroundVeg; if (!u.top && !u.shadow) c += m.count; }); return c; },
        status: function () { return lastStatus; },
        setSide: function (side, veg) {
            if ((SIDES.indexOf(side) < 0 && side !== 'OB') || VEG.indexOf(veg) < 0) return;
            if (side === 'OB') cfg.ob = veg; else cfg.sides[side] = veg;
            save(); renderCustomList(); schedule();
        },
        // the OB trees show in play and test mode only; entering play also grows them again (the OB paint and the ground may have changed)
        modeChanged: function () {
            const on = playing();
            meshes.forEach(function (m) { if (m.userData.surroundVeg.side === 'OB') m.visible = on; });
            if (on && cfg.ob !== 'NONE') schedule(0);
        },
        obClear: function (x, z) { return obClear(x, z, ((root.G && root.G.TERRAIN_SIZE) || root.TERRAIN_SIZE || 600) / 2); },
        setDensity: function (v, done) { cfg.density = Math.max(0, Math.min(3, +v)); syncUI(); if (done !== false) { save(); schedule(); } },
        setDepth: function (v, done) { cfg.depth = Math.max(40, Math.min(700, +v)); syncUI(); if (done !== false) { save(); schedule(); } },
        toggleCustom: function (t) { const i = cfg.custom.indexOf(t); if (i >= 0) cfg.custom.splice(i, 1); else if (cfg.custom.length < 8) cfg.custom.push(t); save(); renderCustomList(); schedule(); },
        reseed: function () { cfg.seed = ((cfg.seed || 1) * 16807 + 11) % 2147483647; save(); schedule(); },
        // the automatic graphics level thins the trees (0.3-1) without touching the saved density; grows them again when it changes
        setAutoScale: function (f) { f = Math.max(0.3, Math.min(1, +f || 1)); if (f === autoScale) return; autoScale = f; schedule(); },
        autoScale: function () { return autoScale; },
        restore: restore, schedule: schedule, build: build, clear: clear
    };
    root.SurroundVeg = api;
})(typeof window !== 'undefined' ? window : globalThis);
