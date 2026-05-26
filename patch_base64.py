import sys
import re

# PATCH ADMIN
with open('admin_assets.html', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(
    r'<option value="PLANTS">Plants</option>',
    '<option value="PLANTS">Plants</option>\n                    <option value="LANDSCAPE">Landscape</option>',
    text
)

text = re.sub(
    r"else if \(val === 'PLANTS'\) physSelect\.value = 'sphere';",
    "else if (val === 'PLANTS') physSelect.value = 'sphere';\n            else if (val === 'LANDSCAPE') physSelect.value = 'sphere';",
    text
)

with open('admin_assets.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("PATCHED ADMIN")

# PATCH ARCADE
with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

# Using wildcards for the emoji to avoid unicode string issues in powershell
text = re.sub(
    r'<button id="cat-btn-PLANTS" class="sys-btn" onclick="setNatureCategory\(\'PLANTS\'\)"([^>]*)>(.*?)Plants</button>',
    r'<button id="cat-btn-PLANTS" class="sys-btn" onclick="setNatureCategory(\'PLANTS\')"\1>\2Plants</button>\n                <button id="cat-btn-LANDSCAPE" class="sys-btn" onclick="setNatureCategory(\'LANDSCAPE\')" style="flex:1; padding:6px 0; font-size:12px;">?? Landscape</button>',
    text
)

text = re.sub(
    r"document\.getElementById\('cat-btn-PLANTS'\)\.className = cat === 'PLANTS' \? 'sys-btn active' : 'sys-btn';",
    r"document.getElementById('cat-btn-PLANTS').className = cat === 'PLANTS' ? 'sys-btn active' : 'sys-btn';\n        if(document.getElementById('cat-btn-LANDSCAPE')) document.getElementById('cat-btn-LANDSCAPE').className = cat === 'LANDSCAPE' ? 'sys-btn active' : 'sys-btn';",
    text
)

old_fetch = r"icon: a\.icon \|\| '??',"
new_fetch = r"icon: a.icon || (a.subcategory === 'ROCKS' ? '??' : (a.subcategory === 'LANDSCAPE' ? '??' : (a.subcategory === 'PLANTS' ? '??' : '??'))),"
text = re.sub(old_fetch, new_fetch, text)

with open('arcade.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("PATCHED ARCADE")
