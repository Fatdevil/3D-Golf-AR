import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_logic = '''// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTextureOrange = new THREE.TextureLoader().load('explosion_sprite_orange.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTextureOrange.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1/5, 1/4); // 5 columns, 4 rows
    
    let mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    
    let sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 3, z); // slight elevation
    // Cell aspect ratio is 204.8 / 136 = ~1.5
    sprite.scale.set(15, 10, 1); // Respect aspect ratio to prevent clipping!
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
        frameDuration: 50 // Slower frame duration since there are only 20 frames (approx 1 sec total)
    });
};'''

new_logic = '''// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTextureOrange25 = new THREE.TextureLoader().load('explosion_sprite_orange_25.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTextureOrange25.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1/5, 1/5); // 5 columns, 5 rows
    
    let mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    
    let sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 4, z); // slight elevation
    // Cell aspect ratio is 1:1 (204.8 x 204.8)
    sprite.scale.set(20, 20, 1); // Perfect square
    scene.add(sprite);
    
    window.activeExplosions.push({
        sprite: sprite,
        tex: tex,
        mat: mat,
        currentTile: 0,
        maxTiles: 25,
        tilesH: 5,
        tilesV: 5,
        lastUpdate: performance.now(),
        frameDuration: 40 // 40ms per frame = 25 FPS (1 sec total)
    });
};'''

if old_logic in text:
    text = text.replace(old_logic, new_logic)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED ORANGE 25")
else:
    print("OLD LOGIC NOT FOUND")
