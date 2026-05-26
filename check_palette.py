arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

# Check current state
tee_hidden = 'id="pal-tee"' in c and 'display:none' in c[c.index('id="pal-tee"')-50:c.index('id="pal-tee"')+200]
green_hidden = 'id="pal-green"' in c and 'display:none' in c[c.index('id="pal-green"')-50:c.index('id="pal-green"')+200]
foregreen_hidden = 'id="pal-foregreen"' in c and 'display:none' in c[c.index('id="pal-foregreen"')-50:c.index('id="pal-foregreen"')+200]

print(f"Tee palette hidden: {tee_hidden}")
print(f"Green palette hidden: {green_hidden}")
print(f"Foregreen palette hidden: {foregreen_hidden}")

# Show the actual lines for context
for i, line in enumerate(c.split('\n')):
    if 'pal-tee' in line or 'pal-green' in line or 'pal-foregreen' in line:
        print(f"\nLine {i+1}: {line.strip()[:120]}")
