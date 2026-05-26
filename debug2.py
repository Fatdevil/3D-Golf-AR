import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Find the full buildNatureUI function
idx = text.find('window.buildNatureUI = function')
end = text.find('};', idx) + 2
snippet = text[idx:end]
snippet = snippet.encode('ascii', errors='replace').decode('ascii')
print('=== buildNatureUI full body ===')
print(snippet)
print()

# Check if setNatureCategory is defined twice 
matches = [m.start() for m in re.finditer(r'window\.setNatureCategory\s*=', text)]
print(f'setNatureCategory defined {len(matches)} times at positions: {matches}')

# Show each definition
for pos in matches:
    snippet2 = text[pos:pos+400].encode('ascii', errors='replace').decode('ascii')
    print(snippet2)
    print('---')
