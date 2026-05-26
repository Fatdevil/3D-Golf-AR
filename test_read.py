import sys

with open('admin_assets.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
match = re.search(r'<select id="asset-subcat">.*?</select>', text, re.DOTALL)
if match:
    print(match.group(0))
else:
    print("NOT FOUND")
