import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# The real question: when Nature tab is clicked, does setNatureCategory ever get called?
# Or does something ELSE show the panel?
# Find where the NATURE tool button is clicked
for m in re.finditer(r"'NATURE'", text):
    start = max(0, m.start()-100)
    end2 = min(len(text), m.end()+150)
    ctx = text[start:end2].encode('ascii', errors='replace').decode('ascii')
    print(ctx)
    print('---')
