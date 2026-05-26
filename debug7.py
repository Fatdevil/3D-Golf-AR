import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Check the full fetchCloudAssets - does it pass cat correctly?
idx = text.find('window.fetchCloudAssets = async function')
end = text.find('window.buildNatureUI();', idx) + 25
snippet = text[idx:end].encode('ascii', errors='replace').decode('ascii')
print('=== fetchCloudAssets body ===')
print(snippet)
print()

# Also check what ACTIVE_BIOME is initialized to
for m in re.finditer(r'ACTIVE_BIOME', text):
    start = max(0, m.start()-40)
    end2 = min(len(text), m.end()+80)
    ctx = text[start:end2].encode('ascii', errors='replace').decode('ascii')
    print(ctx)
