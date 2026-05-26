arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

old = r"\U0001f6e1\ufe0f Protected zone!"
new = "\U0001f6e1\ufe0f Protected zone!"

if old in c:
    c = c.replace(old, new)
    with open(arcade_path, 'w', encoding='utf-8') as f:
        f.write(c)
    print("Emoji fixed!")
else:
    print("Target not found - checking what's there...")
    idx = c.find('Protected zone')
    if idx > 0:
        print(repr(c[idx-30:idx+50]))
