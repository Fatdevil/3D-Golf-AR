// ================================================================
//  PERLIN NOISE ENGINE — Unity-grade procedural terrain noise
//  Classic 2D Perlin + fBM (fractal Brownian Motion).
//  Self-contained, zero external dependencies.
//
//  Exposes:
//  - window.perlin2D(x, y) — raw 2D Perlin noise (-1 to 1)
//  - window.fbm(x, y, octaves, lacunarity, persistence) — layered fBM
//  - window.noisePatterns — { PERLIN, RIDGED, DUNES, MOGULS, ERODED }
//  - window.currentNoisePattern — active pattern key
//  - window.noiseScale — frequency/zoom control
// ================================================================
(function() {
    const _perm = new Uint8Array(512);
    const _grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    (function initPerlin() {
        let p = [];
        for(let i = 0; i < 256; i++) p[i] = i;
        for(let i = 255; i > 0; i--) { let j = Math.floor(Math.random() * (i+1)); [p[i], p[j]] = [p[j], p[i]]; }
        for(let i = 0; i < 512; i++) _perm[i] = p[i & 255];
    })();

    function perlin2D(x, y) {
        let xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
        let xf = x - Math.floor(x), yf = y - Math.floor(y);
        let u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
        let v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

        let aa = _perm[_perm[xi] + yi], ab = _perm[_perm[xi] + yi + 1];
        let ba = _perm[_perm[xi + 1] + yi], bb = _perm[_perm[xi + 1] + yi + 1];

        let g = _grad[aa & 7], x1 = g[0]*xf + g[1]*yf;
        g = _grad[ba & 7]; let x2 = g[0]*(xf-1) + g[1]*yf;
        let l1 = x1 + u * (x2 - x1);

        g = _grad[ab & 7]; x1 = g[0]*xf + g[1]*(yf-1);
        g = _grad[bb & 7]; x2 = g[0]*(xf-1) + g[1]*(yf-1);
        let l2 = x1 + u * (x2 - x1);

        return l1 + v * (l2 - l1); // Returns -1 to 1
    }

    // fBM — fractal Brownian Motion (layered octaves)
    function fbm(x, y, octaves, lacunarity, persistence) {
        let val = 0, amp = 1, freq = 1, max = 0;
        for(let i = 0; i < octaves; i++) {
            val += perlin2D(x * freq, y * freq) * amp;
            max += amp;
            amp *= persistence;
            freq *= lacunarity;
        }
        return val / max;
    }

    // Expose core functions for direct use
    window.perlin2D = perlin2D;
    window.fbm = fbm;

    // Noise pattern generators
    window.noisePatterns = {
        PERLIN:  (x, z) => fbm(x, z, 4, 2.0, 0.5),
        RIDGED:  (x, z) => { let n = fbm(x, z, 4, 2.0, 0.5); return 1 - Math.abs(n) * 2; },
        DUNES:   (x, z) => fbm(x * 0.5, z * 1.5, 3, 2.2, 0.45),
        MOGULS:  (x, z) => { let n = fbm(x, z, 2, 3.0, 0.6); return Math.abs(n); },
        ERODED:  (x, z) => { let p = fbm(x, z, 5, 2.1, 0.45); let r = 1 - Math.abs(fbm(x+50, z+50, 3, 2.0, 0.5)) * 2; return p * 0.6 + r * 0.4; }
    };
    window.currentNoisePattern = 'PERLIN';
    window.noiseScale = 0.15; // Controls frequency/zoom of noise
})();
