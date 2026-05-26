import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_logic = '''// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTextureGreen20 = new THREE.TextureLoader().load('explosion_sprite_green_20.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTextureGreen20.clone();'''

new_logic = '''// === EXPLOSION PROTOTYPE ===
window.activeExplosions = [];
const expTextureOrange = new THREE.TextureLoader().load('explosion_sprite_orange.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTextureOrange.clone();'''

if old_logic in text:
    text = text.replace(old_logic, new_logic)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED ORANGE")
else:
    print("OLD LOGIC NOT FOUND")
