import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Check what setNatureType does with LANDSCAPE (or non-standard types)
idx = text.find("window.setNatureType = function")
snippet = text[idx:idx+600].encode('ascii', errors='replace').decode('ascii')
print('=== setNatureType ===')
print(snippet)
print()

# Check createTree function
idx2 = text.find("function createTree(")
snippet2 = text[idx2:idx2+800].encode('ascii', errors='replace').decode('ascii')
print('=== createTree ===')
print(snippet2)
print()

# Where the randomAsset happens at click time - near window.currentNatureType
idx3 = text.find("let type = window.currentNatureType")
snippet3 = text[max(0,idx3-100):idx3+500].encode('ascii', errors='replace').decode('ascii')
print('=== Placement from window.currentNatureType ===')
print(snippet3)
