import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_logic = '''// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTexture = new THREE.TextureLoader().load('explosion_sprite.png');
const expTextureRed = new THREE.TextureLoader().load('explosion_sprite_red.png');

window.triggerExplosion = function(x, y, z) {
    let sourceTex = Math.random() > 0.5 ? expTexture : expTextureRed;
    let tex = sourceTex.clone();
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
};'''

new_logic = '''// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTextureRed40 = new THREE.TextureLoader().load('explosion_sprite_40.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTextureRed40.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1/8, 1/5); // 8 columns, 5 rows
    
    let mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    
    let sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 4, z); // slight elevation
    sprite.scale.set(20, 20, 1); // Bigger explosion!
    scene.add(sprite);
    
    window.activeExplosions.push({
        sprite: sprite,
        tex: tex,
        mat: mat,
        currentTile: 0,
        maxTiles: 40,
        tilesH: 8,
        tilesV: 5,
        lastUpdate: performance.now(),
        frameDuration: 30 // 30ms per frame for smooth 40 frames
    });
};'''

if old_logic in text:
    text = text.replace(old_logic, new_logic)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED RED 40")
else:
    print("OLD LOGIC NOT FOUND")
