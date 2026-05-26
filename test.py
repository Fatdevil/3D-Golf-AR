import sys
import re
with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()
match = re.search(r'.{0,10}Landscape', text)
if match:
    print(repr(match.group(0)))
