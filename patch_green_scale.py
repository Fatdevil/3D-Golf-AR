import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_logic = '''    let sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 4, z); // slight elevation
    sprite.scale.set(20, 20, 1); // Bigger explosion!'''

new_logic = '''    let sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 3, z); // slight elevation
    // Cell aspect ratio is 204.8 / 136 = ~1.5
    sprite.scale.set(15, 10, 1); // Respect aspect ratio to prevent clipping!'''

if old_logic in text:
    text = text.replace(old_logic, new_logic)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED GREEN SCALE")
else:
    print("OLD LOGIC NOT FOUND")
