import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Show the first HTML block at position 43752 - the full button row
pos = 43752
snippet = text[max(0,pos-150):pos+700]
snippet = snippet.encode('ascii', errors='replace').decode('ascii')
print('=== FIRST cat-btn-TREES HTML block ===')
print(snippet)
print()

# Is there a cat-btn-LANDSCAPE button in the FIRST block?
first_block = text[43000:45000]
has_landscape = 'cat-btn-LANDSCAPE' in first_block
print(f'First block HAS cat-btn-LANDSCAPE: {has_landscape}')
print()

# What does first block look like
print('=== First block around buttons ===')
print(first_block.encode('ascii', errors='replace').decode('ascii')[:1000])
