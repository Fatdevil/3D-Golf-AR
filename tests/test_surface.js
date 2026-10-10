/**
 * Underlagsklassificeringen (arcade-surface.js) som lie-visningen och bollfysiken delar.
 * 1. Samma svar som den gamla localGetTerrainAt-logiken (ordagrann kopia nedan) för vanliga pixlar.
 * 2. Snö ändrar aldrig underlaget: en snöblandad pixel läses som ytan under snön.
 * 3. Nymålad yta över snö tolkas inte som snö.
 * 4. arcade.html använder klassificeraren i både localGetTerrainAt och physicsTerrainAt.
 * Run: node tests/test_surface.js
 */
const fs = require('fs');
const path = require('path');
const S = require('../arcade-surface.js');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed++;
}

// ---- gamla localGetTerrainAt, ordagrant (före arcade-surface.js) ----
function oldLocalClassify(r, g, b, cfg) {
  let biomeType = 'ROUGH';
  function cDist(r1, g1, b1, r2, g2, b2) { return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2; }
  function hexToRgbArr(hex) {
    if (!hex) return null;
    hex = hex.replace('#', '');
    return [parseInt(hex.substring(0,2),16), parseInt(hex.substring(2,4),16), parseInt(hex.substring(4,6),16)];
  }
  cfg = cfg || {};
  let _ob = hexToRgbArr(cfg.obColor) || [239,68,68];
  let _sand = hexToRgbArr(cfg.bunkerColor) || [224,216,164];
  let _waste = hexToRgbArr(cfg.wasteColor) || [194,175,124];
  let _tee = hexToRgbArr(cfg.teeColor) || [124,181,76];
  let _green = hexToRgbArr(cfg.greenColor) || [138,207,114];
  let _foregreen = hexToRgbArr(cfg.foregreenColor) || [154,203,103];
  let _fairway = hexToRgbArr(cfg.fairwayColor) || [121,184,79];
  let _semi = hexToRgbArr(cfg.semiColor) || [101,154,63];
  let _rough = hexToRgbArr(cfg.roughColor) || [76,125,50];
  let _fescue = hexToRgbArr(cfg.fescueColor) || [49,91,43];
  let _water = hexToRgbArr(cfg.waterColor) || [56,189,248];
  let dOB = cDist(r,g,b, _ob[0],_ob[1],_ob[2]);
  let dSand = cDist(r,g,b, _sand[0],_sand[1],_sand[2]);
  let dWaste = cDist(r,g,b, _waste[0],_waste[1],_waste[2]);
  let dTee = cDist(r,g,b, _tee[0],_tee[1],_tee[2]);
  let dGreen = cDist(r,g,b, _green[0],_green[1],_green[2]);
  let dForegreen = cDist(r,g,b, _foregreen[0],_foregreen[1],_foregreen[2]);
  let dFairway = cDist(r,g,b, _fairway[0],_fairway[1],_fairway[2]);
  let dSemiRough = cDist(r,g,b, _semi[0],_semi[1],_semi[2]);
  let dRough = cDist(r,g,b, _rough[0],_rough[1],_rough[2]);
  let dDeepRough = cDist(r,g,b, _fescue[0],_fescue[1],_fescue[2]);
  let dWater = cDist(r,g,b, _water[0],_water[1],_water[2]);
  let minD = Math.min(dOB, dSand, dWaste, dTee, dGreen, dForegreen, dFairway, dSemiRough, dRough, dDeepRough, dWater);
  if (minD >= 100) {
    const vr = 1.0, vg = 1.1, vb = 0.75;
    const vLenSq = 2.7725;
    function getProjDist(rVal, gVal, bVal, baseColor) {
      let dr_p = rVal - baseColor[0];
      let dg_p = gVal - baseColor[1];
      let db_p = bVal - baseColor[2];
      let t = (dr_p * vr + dg_p * vg + db_p * vb) / vLenSq;
      t = Math.max(-35, Math.min(35, t));
      let diffR = dr_p - t * vr;
      let diffG = dg_p - t * vg;
      let diffB = db_p - t * vb;
      return diffR*diffR + diffG*diffG + diffB*diffB;
    }
    dSand = getProjDist(r,g,b, _sand);
    dWaste = getProjDist(r,g,b, _waste);
    dTee = getProjDist(r,g,b, _tee);
    dGreen = getProjDist(r,g,b, _green);
    dForegreen = getProjDist(r,g,b, _foregreen);
    dFairway = getProjDist(r,g,b, _fairway);
    dSemiRough = getProjDist(r,g,b, _semi);
    dRough = getProjDist(r,g,b, _rough);
    dDeepRough = getProjDist(r,g,b, _fescue);
    minD = Math.min(dOB, dSand, dWaste, dTee, dGreen, dForegreen, dFairway, dSemiRough, dRough, dDeepRough, dWater);
  }
  if (minD === dSand) biomeType = 'SAND';
  else if (minD === dWaste) biomeType = 'WASTE';
  else if (minD === dGreen) biomeType = 'GREEN';
  else if (minD === dTee) biomeType = 'TEE';
  else if (minD === dForegreen) biomeType = 'FOREGREEN';
  else if (minD === dOB) biomeType = 'OB';
  else if (minD === dWater) biomeType = 'WATER';
  else if (minD === dFairway) biomeType = 'FAIRWAY';
  else if (minD === dSemiRough) biomeType = 'SEMI-ROUGH';
  else if (minD === dDeepRough) biomeType = 'DEEP ROUGH';
  else biomeType = 'ROUGH';
  return biomeType;
}

// spelets riktiga biompaletter (arcade-biomes.js)
const vm = require('vm');
const biomeCtx = { window: {}, Object: Object };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'arcade-biomes.js'), 'utf8'), biomeCtx);
const BIOMES = biomeCtx.window.CLOUD_BIOMES;
const BIOME_NAMES = Object.keys(BIOMES);

// liten deterministisk slumpgenerator
let seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const hex2 = n => ('0' + n.toString(16)).slice(-2);
const toHex = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
const KEYS = ['obColor', 'bunkerColor', 'wasteColor', 'teeColor', 'greenColor', 'foregreenColor', 'fairwayColor', 'semiColor', 'roughColor', 'fescueColor', 'waterColor'];
const DEF = { obColor: '#ef4444', bunkerColor: '#e0d8a4', wasteColor: '#c2af7c', teeColor: '#7cb54c', greenColor: '#8acf72', foregreenColor: '#9acb67',
              fairwayColor: '#79b84f', semiColor: '#659a3f', roughColor: '#4c7d32', fescueColor: '#315b2b', waterColor: '#38bdf8' };
function randomCfg() { const c = {}; KEYS.forEach(k => { c[k] = toHex([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)]); }); return c; }

console.log('1. Samma svar som den gamla localGetTerrainAt');
{
  const cfgs = [undefined, DEF, randomCfg(), randomCfg(), randomCfg()];
  let n = 0, diff = 0, first = null;
  cfgs.forEach(cfg => {
    for (let i = 0; i < 60000; i++) {
      const r = Math.floor(rnd() * 256), g = Math.floor(rnd() * 256), b = Math.floor(rnd() * 256);
      n++;
      if (S.classify(r, g, b, cfg) !== oldLocalClassify(r, g, b, cfg)) { diff++; if (!first) first = [r, g, b]; }
    }
    // pixlar nära paletten (där lie-valet faktiskt avgörs)
    const pal = KEYS.map(k => { const h = (cfg && cfg[k]) || DEF[k]; return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; });
    for (let i = 0; i < 20000; i++) {
      const c = pal[Math.floor(rnd() * pal.length)];
      const px = c.map(x => Math.max(0, Math.min(255, x + Math.round((rnd() - 0.5) * 80))));
      n++;
      if (S.classify(px[0], px[1], px[2], cfg) !== oldLocalClassify(px[0], px[1], px[2], cfg)) { diff++; if (!first) first = px; }
    }
  });
  check(n + ' pixlar ger samma underlag som gamla logiken', diff === 0, diff ? '(' + diff + ' skiljer, t.ex. ' + first + ')' : '');
}

console.log('\n2. Snö ändrar aldrig underlaget');
// Snölagret läggs bara på i WINTER (arcade.html), så strikta krav gäller den paletten och GLOBAL. Övriga paletter rapporteras.
function rgbOf(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
const SHADOW = [210, 220, 235], SNOW = [250, 252, 255];
const lerp = (a, b, t) => a + (b - a) * t;
function snowRecovery(cfg) {
  let bad = 0, total = 0, example = null;
  for (const k of KEYS) {
    const c = rgbOf(cfg[k]);
    for (const shift of [-20, -8, 0, 8, 20]) {   // ljus/mörk variation av ytan
      const base = c.map((x, i) => Math.max(0, Math.min(255, x + Math.round(shift * [1, 1.1, 0.75][i]))));
      const want = S.classify(base[0], base[1], base[2], cfg);
      for (const amount of [0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0]) {
        for (const t of [0, 0.3, 0.6, 1]) {
          const sc = [0, 1, 2].map(i => lerp(SHADOW[i], SNOW[i], t));
          const live = base.map((x, i) => Math.round(lerp(x, sc[i], amount)));   // exakt som applySnowLayer
          const px = S.pixelAt(Uint8ClampedArray.from([live[0], live[1], live[2], 255]), 0, Uint8ClampedArray.from([base[0], base[1], base[2], 255]), cfg);
          total++;
          if (S.classify(px[0], px[1], px[2], cfg) !== want) { bad++; if (!example) example = k + ' skift ' + shift + ' mängd ' + amount + ' t ' + t; }
        }
      }
    }
  }
  return { bad: bad, total: total, example: example };
}
{
  const glob = snowRecovery(BIOMES.GLOBAL), winter = snowRecovery(BIOMES.WINTER);
  check('GLOBAL: alla ' + glob.total + ' snöblandade pixlar läses som ytan under snön', glob.bad === 0, glob.bad ? '(' + glob.bad + ' fel, t.ex. ' + glob.example + ')' : '');
  check('WINTER: minst 99,5 % av ' + winter.total + ' snöblandade pixlar läses som ytan under snön', winter.bad <= winter.total * 0.005,
        '(' + winter.bad + ' fel; en snöad waste-pixel som landar exakt på blek sand går inte att skilja åt' + (winter.example ? ', t.ex. ' + winter.example : '') + ')');
  const rows = BIOME_NAMES.map(n => { const r = snowRecovery(BIOMES[n]); return n + ' ' + r.bad + '/' + r.total; });
  console.log('     (alla paletter: ' + rows.join(', ') + ')');
  // och bevis för varför det behövs: utan före-snö-data blir snön fel underlag
  const plain = S.classify(175, 210, 162, DEF);
  check('utan före-snö-data tolkas en halv-snöad fairwaypixel fel (som förut)', plain !== 'FAIRWAY', '(blir ' + plain + ')');
}

console.log('\n3. Nymålad yta över snö tolkas inte som snö');
{
  // målar ytan j över en pixel som ytan i (med snö) låg på: ska läsas som j. Enda undantaget är en palettfärg som själv är snöfärg
  // (WINTER:s DEEP ROUGH är snövitt) eftersom den inte går att skilja från helt snö.
  let bad = 0, ambiguous = 0, total = 0, example = null;
  for (const n of BIOME_NAMES) {
    const cfg = BIOMES[n];
    for (const ki of KEYS) for (const kj of KEYS) {
      if (ki === kj) continue;
      const ci = rgbOf(cfg[ki]), cj = rgbOf(cfg[kj]);
      for (const shift of [-12, 0, 12]) {
        const base = ci.map((x, i) => Math.max(0, Math.min(255, x + Math.round(shift * [1, 1.1, 0.75][i]))));
        const px = S.pixelAt(Uint8ClampedArray.from([cj[0], cj[1], cj[2], 255]), 0, Uint8ClampedArray.from([base[0], base[1], base[2], 255]), cfg);
        total++;
        if (px[0] !== cj[0] || px[1] !== cj[1] || px[2] !== cj[2]) {
          if (S.isSnowColour(cj)) ambiguous++;
          else { bad++; if (!example) example = n + ': ' + ki + ' -> ' + kj; }
        }
      }
    }
  }
  check(total + ' omålningar (alla ytpar, ' + BIOME_NAMES.length + ' biompaletter) läses som den nya färgen', bad === 0, bad ? '(' + bad + ' fel, t.ex. ' + example + ')' : '(' + ambiguous + ' tvetydiga med snöfärgad palettfärg undantagna)');
  check('orörd pixel (samma som före snön) läses som den är', (() => { const d = Uint8ClampedArray.from([10, 20, 30, 255]); const px = S.pixelAt(d, 0, d, DEF); return px[0] === 10 && px[1] === 20 && px[2] === 30; })());
}

console.log('\n4. arcade.html använder klassificeraren på båda ställena');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'arcade.html'), 'utf8');
  const local = html.slice(html.indexOf('window.localGetTerrainAt = function'), html.indexOf('const greenBeadsGroup'));
  const phys = html.slice(html.indexOf('function physicsTerrainAt'), html.indexOf('window.calibratePuttSpeed'));
  check('localGetTerrainAt anropar SurfaceClassifier.classify', /SurfaceClassifier\.classify\(/.test(local));
  check('physicsTerrainAt anropar SurfaceClassifier.classify', /SurfaceClassifier\.classify\(/.test(phys));
  check('physicsTerrainAt har ingen egen färgtabell kvar', !/surfaceMap/.test(phys));
  check('arcade.html laddar arcade-surface.js före användningen', /<script src="arcade-surface\.js[^"]*"><\/script>/.test(html));
}

console.log(failed ? '\nOVERALL:  ❌ REGRESSION (' + failed + ' failed)' : '\nOVERALL:  ✅ ALL PASS');
process.exit(failed ? 1 : 0);
