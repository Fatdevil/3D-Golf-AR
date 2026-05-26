arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'id="pal-green"' in line and 'display:none' not in line:
        lines[i] = line.replace('style="background:', 'style="display:none; background:')
        print(f"Line {i+1}: Green palette hidden")

with open(arcade_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Done!")
