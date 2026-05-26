import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Check if there's a second cat button definition earlier (duplicate HTML)
matches = [m.start() for m in re.finditer(r'cat-btn-TREES', text)]
print(f'cat-btn-TREES found {len(matches)} times at: {matches}')
print()

# Show the HTML for the category button row
for pos in matches:
    snippet = text[max(0,pos-100):pos+800].encode('ascii', errors='replace').decode('ascii')
    print(snippet[:500])
    print('---')
