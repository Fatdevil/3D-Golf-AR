import re

with open('admin_assets.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

for m in re.finditer(r'<input[^>]+type=["\']range["\'][^>]*>', text):
    print(m.group(0))
    print()
