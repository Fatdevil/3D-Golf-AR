import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix the broken emojis
text = text.replace('?? Trees', '?? Trees')
text = text.replace('?? Rocks', '?? Rocks')
text = text.replace('?? Plants', '?? Plants')
text = text.replace('?? Landscape', '?? Landscape')

# Fix the broken quotes
text = text.replace("\\'PLANTS\\'", "'PLANTS'")
text = text.replace("\\'LANDSCAPE\\'", "'LANDSCAPE'")

with open('arcade.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("FIXED")
