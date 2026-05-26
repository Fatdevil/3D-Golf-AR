import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_logic = '''const expTexture = new THREE.TextureLoader().load('explosion_sprite.png');

window.triggerExplosion = function(x, y, z) {
    let tex = expTexture.clone();'''

new_logic = '''const expTexture = new THREE.TextureLoader().load('explosion_sprite.png');
const expTextureRed = new THREE.TextureLoader().load('explosion_sprite_red.png');

window.triggerExplosion = function(x, y, z) {
    let sourceTex = Math.random() > 0.5 ? expTexture : expTextureRed;
    let tex = sourceTex.clone();'''

text = text.replace(old_logic, new_logic)

with open('arcade.html', 'w', encoding='utf-8') as f:
    f.write(text)
print("PATCHED RED")
