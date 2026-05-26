import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Show second occurrence of cat-btn-TREES
positions = [m.start() for m in re.finditer(r'cat-btn-TREES', text)]
print(f'cat-btn-TREES at positions: {positions}')
print()

# Show context of SECOND occurrence
pos2 = positions[1]
snippet = text[max(0,pos2-300):pos2+600].encode('ascii', errors='replace').decode('ascii')
print('=== SECOND cat-btn-TREES context ===')
print(snippet)
