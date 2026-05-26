import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# The real issue: check if there's a SECOND setNatureCategory call that resets currentNatureCategory
# Search for calls to buildNatureUI() to see if it's called with wrong state
idx = text.find('window.buildNatureUI();')
while idx != -1:
    ctx = text[max(0,idx-200):idx+50].encode('ascii', errors='replace').decode('ascii')
    print(f'buildNatureUI() called at {idx}:')
    print(ctx[-200:])
    print('---')
    idx = text.find('window.buildNatureUI();', idx+1)

# CRITICAL: What about currentNatureCategory being RESET after fetchCloudAssets?
# buildNatureUI at end sets: window.currentNatureType = 'RANDOM'  (resets the SELECTED item, not category)
# But does anything reset currentNatureCategory back to 'TREES'?

print('\n=== currentNatureCategory assignments ===')
for m in re.finditer(r'currentNatureCategory\s*=', text):
    start = max(0, m.start()-50)
    end2 = min(len(text), m.end()+80)
    ctx = text[start:end2].encode('ascii', errors='replace').decode('ascii')
    print(ctx)
    print()
