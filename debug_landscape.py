import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Check how many times buildNatureUI is defined
matches = [m.start() for m in re.finditer(r'window\.buildNatureUI\s*=', text)]
print(f'buildNatureUI defined {len(matches)} times at positions: {matches}')
print()

# Find each definition and show it
for pos in matches:
    snippet = text[pos:pos+500]
    # Remove emoji chars for safety
    snippet = snippet.encode('ascii', errors='replace').decode('ascii')
    print(snippet)
    print('---')

# Check LANDSCAPE mentions
print('\n=== LANDSCAPE mentions ===')
for m in re.finditer(r'LANDSCAPE', text):
    start = max(0, m.start()-100)
    end = min(len(text), m.end()+100)
    ctx = text[start:end].encode('ascii', errors='replace').decode('ascii')
    print(ctx)
    print()
