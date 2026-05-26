import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Check setNatureCategory position vs buildNatureUI position
cat_pos = text.find('window.setNatureCategory = function')
build_pos = text.find('window.buildNatureUI = function')
fetch_pos = text.find('window.fetchCloudAssets = async function')

print(f'setNatureCategory defined at position: {cat_pos}')
print(f'buildNatureUI defined at position:     {build_pos}')
print(f'fetchCloudAssets defined at position:  {fetch_pos}')
print()

# The issue: setNatureCategory is at 148586 and buildNatureUI at 163491
# setNatureCategory calls buildNatureUI BEFORE buildNatureUI is defined!
# But wait, these are function definitions - they should be hoisted... no, window.* assignments are NOT hoisted

# Check what's between setNatureCategory and buildNatureUI
between = text[cat_pos:build_pos]
print(f'Code between setNatureCategory and buildNatureUI ({len(between)} chars):')
print(between[:300].encode('ascii', errors='replace').decode('ascii'))
print()

# The real question: Does createTree handle LANDSCAPE subcat?
idx = text.find('function createTree')
if idx < 0:
    idx = text.find('createTree = function')
if idx < 0:
    idx = text.find('window.createTree')
print(f'createTree found at: {idx}')

# Let's find where assets are placed - what happens when you click on terrain with NATURE tool
idx2 = text.find("selectedType = currentNatureType")
print(f'Nature placement code at: {idx2}')
snippet = text[idx2:idx2+600].encode('ascii', errors='replace').decode('ascii')
print(snippet)
