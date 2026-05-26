import re

with open('arcade.html', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'<input type=\"range\" id=\"sb-bunker-depth\" min=\"[\d\.]+\" max=\"[\d\.]+\"'
replacement = r'<input type=\"range\" id=\"sb-bunker-depth\" min=\"0.0\" max=\"3.0\"'

if re.search(pattern, content):
    content = re.sub(pattern, replacement, content, count=1)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS')
else:
    print('FAILED TO FIND PATTERN')
