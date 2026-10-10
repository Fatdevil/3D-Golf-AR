// ================================================================
//  SURFACE CLASSIFIER — one place that turns a painted pixel into a surface type
//  Used by localGetTerrainAt (lie, club choice, hazards) and physicsTerrainAt (the ball physics),
//  so the lie the player sees and the ground the ball hits always agree.
//
//  - classify(r, g, b, cfg): nearest palette colour; a pixel that is lighter or darker than every palette colour
//    (distance >= 100) is matched along the light axis instead, so shaded paint still finds its surface.
//  - pixelAt(data, i, base, cfg): the colour to classify. While the snow layer is on, `base` is the canvas from before the snow
//    (terrain-auto-paint.js, window._preSnowSurfaceData): a pixel that is a blend of that pixel and the snow colours is
//    read as the surface under the snow, so snow never changes what the ground is. Fresh paint does not match such a
//    blend and is read as it is.
//  Exposes window.SurfaceClassifier (and module.exports for the node tests).
// ================================================================
(function (root) {

    const DEFAULTS = {
        ob: [239, 68, 68], bunker: [224, 216, 164], waste: [194, 175, 124], tee: [124, 181, 76], green: [138, 207, 114],
        foregreen: [154, 203, 103], fairway: [121, 184, 79], semi: [101, 154, 63], rough: [76, 125, 50],
        fescue: [49, 91, 43], water: [56, 189, 248]
    };
    const CFG_KEY = {
        ob: 'obColor', bunker: 'bunkerColor', waste: 'wasteColor', tee: 'teeColor', green: 'greenColor',
        foregreen: 'foregreenColor', fairway: 'fairwayColor', semi: 'semiColor', rough: 'roughColor',
        fescue: 'fescueColor', water: 'waterColor'
    };

    function hexToRgb(hex) {
        if (!hex) return null;
        hex = hex.replace('#', '');
        return [parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16)];
    }
    function dist2(r1, g1, b1, c) { return (r1 - c[0]) * (r1 - c[0]) + (g1 - c[1]) * (g1 - c[1]) + (b1 - c[2]) * (b1 - c[2]); }

    // Light axis of the paint (lighter/darker variants of one colour), and how far along it a pixel may be shifted
    const LIGHT = [1.0, 1.1, 0.75], LIGHT_LEN_SQ = 2.7725, LIGHT_MAX = 35;
    function lightDist2(r, g, b, c) {
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        let t = (dr * LIGHT[0] + dg * LIGHT[1] + db * LIGHT[2]) / LIGHT_LEN_SQ;
        t = Math.max(-LIGHT_MAX, Math.min(LIGHT_MAX, t));
        const er = dr - t * LIGHT[0], eg = dg - t * LIGHT[1], eb = db - t * LIGHT[2];
        return er * er + eg * eg + eb * eb;
    }

    function classify(r, g, b, cfg) {
        cfg = cfg || {};
        const c = {};
        for (const k in DEFAULTS) c[k] = hexToRgb(cfg[CFG_KEY[k]]) || DEFAULTS[k];

        let dOB = dist2(r, g, b, c.ob), dSand = dist2(r, g, b, c.bunker), dWaste = dist2(r, g, b, c.waste), dTee = dist2(r, g, b, c.tee);
        let dGreen = dist2(r, g, b, c.green), dForegreen = dist2(r, g, b, c.foregreen), dFairway = dist2(r, g, b, c.fairway);
        let dSemi = dist2(r, g, b, c.semi), dRough = dist2(r, g, b, c.rough), dDeep = dist2(r, g, b, c.fescue), dWater = dist2(r, g, b, c.water);
        let minD = Math.min(dOB, dSand, dWaste, dTee, dGreen, dForegreen, dFairway, dSemi, dRough, dDeep, dWater);

        if (minD >= 100) {
            dSand = lightDist2(r, g, b, c.bunker); dWaste = lightDist2(r, g, b, c.waste); dTee = lightDist2(r, g, b, c.tee);
            dGreen = lightDist2(r, g, b, c.green); dForegreen = lightDist2(r, g, b, c.foregreen); dFairway = lightDist2(r, g, b, c.fairway);
            dSemi = lightDist2(r, g, b, c.semi); dRough = lightDist2(r, g, b, c.rough); dDeep = lightDist2(r, g, b, c.fescue);
            minD = Math.min(dOB, dSand, dWaste, dTee, dGreen, dForegreen, dFairway, dSemi, dRough, dDeep, dWater);
        }

        if (minD === dSand) return 'SAND';
        if (minD === dWaste) return 'WASTE';
        if (minD === dGreen) return 'GREEN';
        if (minD === dTee) return 'TEE';
        if (minD === dForegreen) return 'FOREGREEN';
        if (minD === dOB) return 'OB';
        if (minD === dWater) return 'WATER';
        if (minD === dFairway) return 'FAIRWAY';
        if (minD === dSemi) return 'SEMI-ROUGH';
        if (minD === dDeep) return 'DEEP ROUGH';
        return 'ROUGH';
    }

    // Snow colours of applySnowLayer in terrain-auto-paint.js: a pixel becomes lerp(pixel, lerp(SNOW_SHADOW, SNOW, t), amount)
    const SNOW_SHADOW = [210, 220, 235], SNOW_DELTA = [40, 32, 20];   // SNOW - SNOW_SHADOW
    const SNOW_TOLERANCE_SQ = 16;                                      // rounding of the blend, in colour units squared

    // Is (r,g,b) = pixel + a * (snow colour - pixel) for some a in [0,1] and some snow colour between shadow and snow?
    // That is: (r,g,b) - pixel = a * (SHADOW - pixel) + u * DELTA with 0 <= u <= a <= 1. Solved by least squares.
    function isSnowBlend(r, g, b, p0, p1, p2) {
        const v0 = r - p0, v1 = g - p1, v2 = b - p2;
        if (v0 === 0 && v1 === 0 && v2 === 0) return false;           // untouched pixel: nothing to undo
        const e0 = SNOW_SHADOW[0] - p0, e1 = SNOW_SHADOW[1] - p1, e2 = SNOW_SHADOW[2] - p2;
        const ee = e0 * e0 + e1 * e1 + e2 * e2;
        const ed = e0 * SNOW_DELTA[0] + e1 * SNOW_DELTA[1] + e2 * SNOW_DELTA[2];
        const dd = SNOW_DELTA[0] * SNOW_DELTA[0] + SNOW_DELTA[1] * SNOW_DELTA[1] + SNOW_DELTA[2] * SNOW_DELTA[2];
        const det = ee * dd - ed * ed;
        if (det < 1e-3 * ee * dd) return false;                        // pixel already snow coloured: cannot tell
        const ev = e0 * v0 + e1 * v1 + e2 * v2;
        const dv = SNOW_DELTA[0] * v0 + SNOW_DELTA[1] * v1 + SNOW_DELTA[2] * v2;
        const a = (ev * dd - dv * ed) / det;
        const u = (dv * ee - ev * ed) / det;
        // slack: rounding of the blend (+-0.5 per channel) moves a and u by a few hundredths because the two directions are not far apart
        if (a < -0.05 || a > 1.05 || u < -0.06 || u > a + 0.06) return false;
        const x0 = v0 - a * e0 - u * SNOW_DELTA[0], x1 = v1 - a * e1 - u * SNOW_DELTA[1], x2 = v2 - a * e2 - u * SNOW_DELTA[2];
        return x0 * x0 + x1 * x1 + x2 * x2 <= SNOW_TOLERANCE_SQ;
    }

    // Paint is the exact palette colour; a snow blend almost never lands on one. A pixel that already is a palette colour
    // (fresh paint, or a pixel the snow left alone) is therefore read as it is, even when it could also be a blend
    // (pale sand over rough looks like rough under snow).
    // A palette colour that is itself a snow colour (the WINTER palette's DEEP ROUGH is the snow white) cannot be told from snow,
    // so it does not count: a fully snowed pixel must still be read as the ground under it.
    const PALETTE_EXACT_SQ = 12, SNOW_COLOUR_SQ = 9;
    function isSnowColour(c) {
        const d0 = c[0] - SNOW_SHADOW[0], d1 = c[1] - SNOW_SHADOW[1], d2 = c[2] - SNOW_SHADOW[2];
        const t = Math.max(0, Math.min(1, (d0 * SNOW_DELTA[0] + d1 * SNOW_DELTA[1] + d2 * SNOW_DELTA[2]) / (SNOW_DELTA[0] * SNOW_DELTA[0] + SNOW_DELTA[1] * SNOW_DELTA[1] + SNOW_DELTA[2] * SNOW_DELTA[2])));
        const x0 = d0 - t * SNOW_DELTA[0], x1 = d1 - t * SNOW_DELTA[1], x2 = d2 - t * SNOW_DELTA[2];
        return x0 * x0 + x1 * x1 + x2 * x2 <= SNOW_COLOUR_SQ;
    }
    function isPaletteColor(r, g, b, cfg) {
        cfg = cfg || {};
        for (const k in DEFAULTS) {
            const c = hexToRgb(cfg[CFG_KEY[k]]) || DEFAULTS[k];
            if (dist2(r, g, b, c) <= PALETTE_EXACT_SQ && !isSnowColour(c)) return true;
        }
        return false;
    }

    function pixelAt(data, i, base, cfg) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (base && isSnowBlend(r, g, b, base[i], base[i + 1], base[i + 2]) && !isPaletteColor(r, g, b, cfg)) return [base[i], base[i + 1], base[i + 2]];
        return [r, g, b];
    }

    const api = { classify: classify, pixelAt: pixelAt, isSnowBlend: isSnowBlend, isPaletteColor: isPaletteColor, isSnowColour: isSnowColour };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SurfaceClassifier = api;

})(typeof window !== 'undefined' ? window : null);
