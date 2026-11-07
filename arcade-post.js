/**
 * Light and colour after the picture is drawn (window.PostFX). A graphics option with three levels:
 *   OFF   the picture as drawn (as before)
 *   LOW   colour grading in one full-screen pass: a little warmer, a little more saturation and contrast, a soft vignette
 *   HIGH  LOW plus bloom: bright parts of the picture (sun, sky glare, white ball, sand in the sun) get a soft glow
 * The game's colours are not converted: the grade is applied on top of the picture as it is drawn.
 * How: the scene is drawn into a picture of its own (multisampled on WebGL2, so the edges stay smooth), then one full-screen pass
 * draws it to the screen with the grade (and the bloom). The bloom is a bright pass at half size and a blur at quarter size, there and
 * back twice. The cost could not be measured in a headless browser (software rendering): the frame-time meter (?fps=1) shows it on a
 * real device. LOW is one extra full-screen pass; HIGH adds a half-size and four quarter-size passes.
 * Stored in localStorage (golf_post_q). Default: LOW on a computer, OFF on a phone (the extra passes cost fill rate).
 */
(function () {
    'use strict';
    const LEVELS = ['OFF', 'LOW', 'HIGH'];
    const GRADE = { saturation: 1.12, contrast: 1.05, tint: [1.035, 1.0, 0.955], vignette: 0.2 };
    const BLOOM = { threshold: 0.78, knee: 0.18, strength: 0.55 };

    let level = 'OFF';
    let size = { w: 0, h: 0 }, rtScene = null, rtBright = null, rtA = null, rtB = null;
    let quadScene = null, quadCam = null, quad = null, matGrade = null, matBright = null, matBlur = null;

    const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const FRAG_GRADE = [
        'uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom;',
        'uniform float uSat; uniform float uContrast; uniform float uVignette; uniform vec3 uTint;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec3 c = texture2D(tScene, vUv).rgb;',
        '  if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;',
        '  c *= uTint;',
        '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
        '  c = mix(vec3(l), c, uSat);',
        '  c = (c - 0.5) * uContrast + 0.5;',
        '  vec2 d = vUv - 0.5;',
        '  c *= 1.0 - uVignette * dot(d, d) * 1.6;',
        '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
        '}'].join('\n');
    const FRAG_BRIGHT = [
        'uniform sampler2D tScene; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;',
        'void main() {',
        '  vec3 c = texture2D(tScene, vUv).rgb;',
        '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
        '  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + uKnee, l), 1.0);',
        '}'].join('\n');
    const FRAG_BLUR = [
        'uniform sampler2D tIn; uniform vec2 uStep; varying vec2 vUv;',
        'void main() {',
        '  vec3 s = texture2D(tIn, vUv).rgb * 0.227027;',
        '  s += (texture2D(tIn, vUv + uStep * 1.3846).rgb + texture2D(tIn, vUv - uStep * 1.3846).rgb) * 0.316216;',
        '  s += (texture2D(tIn, vUv + uStep * 3.2308).rgb + texture2D(tIn, vUv - uStep * 3.2308).rgb) * 0.070270;',
        '  gl_FragColor = vec4(s, 1.0);',
        '}'].join('\n');

    function shader(frag, uniforms) {
        return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    }

    function setup() {
        if (quadScene) return;
        quadScene = new THREE.Scene();
        quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        matGrade = shader(FRAG_GRADE, {
            tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 },
            uSat: { value: GRADE.saturation }, uContrast: { value: GRADE.contrast }, uVignette: { value: GRADE.vignette },
            uTint: { value: new THREE.Vector3(GRADE.tint[0], GRADE.tint[1], GRADE.tint[2]) }
        });
        matBright = shader(FRAG_BRIGHT, { tScene: { value: null }, uThreshold: { value: BLOOM.threshold }, uKnee: { value: BLOOM.knee } });
        matBlur = shader(FRAG_BLUR, { tIn: { value: null }, uStep: { value: new THREE.Vector2() } });
        quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matGrade);
        quad.frustumCulled = false;
        quadScene.add(quad);
    }

    // the scene's picture (with depth; multisampled on WebGL2) or a picture for the bloom passes (no depth)
    function target(w, h, forScene, renderer) {
        const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: forScene, stencilBuffer: false };
        if (forScene && renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) {
            const t = new THREE.WebGLMultisampleRenderTarget(w, h, opts);
            t.samples = 4;
            return t;
        }
        return new THREE.WebGLRenderTarget(w, h, opts);
    }

    function ensureTargets(renderer) {
        const v = renderer.getDrawingBufferSize(new THREE.Vector2());
        const w = Math.max(1, Math.floor(v.x)), h = Math.max(1, Math.floor(v.y));
        if (w === size.w && h === size.h && rtScene) return;
        dispose();
        size = { w: w, h: h };
        rtScene = target(w, h, true, renderer);
        rtBright = target(Math.max(1, w >> 1), Math.max(1, h >> 1), false, renderer);
        rtA = target(Math.max(1, w >> 2), Math.max(1, h >> 2), false, renderer);
        rtB = target(Math.max(1, w >> 2), Math.max(1, h >> 2), false, renderer);
    }

    function dispose() {
        [rtScene, rtBright, rtA, rtB].forEach(function (t) { if (t) t.dispose(); });
        rtScene = rtBright = rtA = rtB = null;
        size = { w: 0, h: 0 };
    }

    function pass(renderer, mat, out) {
        quad.material = mat;
        renderer.setRenderTarget(out);
        renderer.render(quadScene, quadCam);
    }

    // Draws the scene with the grade (and the bloom) to the screen. The main picture's draw calls are handed to the frame-time meter
    // (?fps=1) right after the scene itself, before the full-screen passes.
    function render(renderer, scene, camera) {
        setup();
        ensureTargets(renderer);
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rtScene);
        // the game draws with renderer.autoClear off (the minimap), and its own clear in the frame loop is for the screen: this picture is
        // cleared here, colour and depth, or with the textured sky (which does not force a clear) last frame's depth hid what moved behind it
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        if (window.PerfHud) window.PerfHud.mainPass(renderer);
        let bloom = 0;
        if (level === 'HIGH') {
            matBright.uniforms.tScene.value = rtScene.texture;
            pass(renderer, matBright, rtBright);
            let src = rtBright;
            for (let i = 0; i < 2; i++) {
                matBlur.uniforms.tIn.value = src.texture;
                matBlur.uniforms.uStep.value.set(1 / rtA.width, 0);
                pass(renderer, matBlur, rtA);
                matBlur.uniforms.tIn.value = rtA.texture;
                matBlur.uniforms.uStep.value.set(0, 1 / rtA.height);
                pass(renderer, matBlur, rtB);
                src = rtB;
            }
            bloom = BLOOM.strength;
        }
        matGrade.uniforms.tScene.value = rtScene.texture;
        matGrade.uniforms.tBloom.value = rtB ? rtB.texture : null;
        matGrade.uniforms.uBloom.value = bloom;
        pass(renderer, matGrade, prev);
    }

    function setLevel(q, remember) {
        if (LEVELS.indexOf(q) < 0) q = 'OFF';
        level = q;
        if (q === 'OFF') dispose();
        if (remember) { try { localStorage.setItem('golf_post_q', q); } catch (e) { /* storage blocked: not remembered */ } }
        if (typeof document !== 'undefined') {
            LEVELS.forEach(function (l) {
                const b = document.getElementById('post-q-' + l.toLowerCase());
                if (b) { b.style.background = l === q ? '#4ade80' : '#334155'; b.style.color = l === q ? '#0f172a' : '#94a3b8'; }
            });
        }
        return level;
    }

    // the stored choice, else LOW on a computer and OFF on a phone
    function initLevel(isMobile) {
        let saved = null;
        try { saved = localStorage.getItem('golf_post_q'); } catch (e) { /* storage blocked */ }
        return setLevel(LEVELS.indexOf(saved) >= 0 ? saved : (isMobile ? 'OFF' : 'LOW'), false);
    }

    window.PostFX = {
        LEVELS: LEVELS, GRADE: GRADE, BLOOM: BLOOM,
        active: function () { return level !== 'OFF'; },
        level: function () { return level; },
        setLevel: setLevel,
        initLevel: initLevel,
        render: render
    };
    window.setPostQuality = function (q) { return setLevel(q, true); };
})();
