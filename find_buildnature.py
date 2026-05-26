import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'asset.icon' in line or ('palette-btn' in line and 'setNatureType' in line):
        print(f"Line {i+1}: {repr(line[:200])}")
