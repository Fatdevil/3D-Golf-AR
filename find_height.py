import re

with open('admin_assets.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

for m in re.finditer(r'<input[^>]+target-height[^>]*>', text):
    print(m.group(0))
    print()

print("---")
# Also search for text near target-height input
idx = text.find('target-height')
print(text[max(0,idx-200):idx+400])
