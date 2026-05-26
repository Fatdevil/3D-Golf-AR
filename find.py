import re

with open('c:/Antigravety projekt/3D-Golf-AR/arcade.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, l in enumerate(lines):
    if 'id=\"pal-' in l or 'id=\"btn-' in l or 'executeSmart' in l:
        print(str(i+1) + ': ' + l.strip()[:100])
