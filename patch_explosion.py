import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

explosion_func = '''
// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTexture = new THREE.TextureLoader().load('explosion_sprite.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTexture.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1/5, 1/4);
    
    let mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    
    let sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 2, z); // slight elevation
    sprite.scale.set(15, 15, 1); // 15x15 meters
    scene.add(sprite);
    
    window.activeExplosions.push({
        sprite: sprite,
        tex: tex,
        mat: mat,
        currentTile: 0,
        maxTiles: 20,
        tilesH: 5,
        tilesV: 4,
        lastUpdate: performance.now(),
        frameDuration: 40 // 40ms per frame = 25 FPS
    });
};
'''

text = text.replace("function animate() {", explosion_func + "\n    function animate() {")

animation_logic = '''
        // --- Process Explosions ---
        if (window.activeExplosions && window.activeExplosions.length > 0) {
            let now = performance.now();
            for(let i = window.activeExplosions.length - 1; i >= 0; i--) {
                let exp = window.activeExplosions[i];
                if (now - exp.lastUpdate > exp.frameDuration) {
                    exp.lastUpdate = now;
                    exp.currentTile++;
                    if (exp.currentTile >= exp.maxTiles) {
                        scene.remove(exp.sprite);
                        exp.mat.dispose();
                        exp.tex.dispose();
                        window.activeExplosions.splice(i, 1);
                    } else {
                        let currentColumn = exp.currentTile % exp.tilesH;
                        let currentRow = Math.floor(exp.currentTile / exp.tilesH);
                        // Invert Y for THREE.js texture coords
                        exp.tex.offset.x = currentColumn / exp.tilesH;
                        exp.tex.offset.y = 1.0 - ((currentRow + 1) / exp.tilesV);
                    }
                }
            }
        }
'''
text = text.replace("if (window.updateTracerFade) window.updateTracerFade(); // Tracer fade-out after landing", 
                    "if (window.updateTracerFade) window.updateTracerFade(); // Tracer fade-out after landing\n" + animation_logic)

keyx_logic = '''
        if (e.code === 'KeyX' && typeof lastHitPoint !== 'undefined' && lastHitPoint) {
            window.triggerExplosion(lastHitPoint.x, lastHitPoint.y, lastHitPoint.z);
            return;
        }
'''
text = text.replace("if (e.ctrlKey && e.key.toLowerCase() === 'z') {", keyx_logic + "\n          if (e.ctrlKey && e.key.toLowerCase() === 'z') {")

with open('arcade.html', 'w', encoding='utf-8') as f:
    f.write(text)
print("PATCHED")
