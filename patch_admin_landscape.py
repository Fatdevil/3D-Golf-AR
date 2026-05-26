import sys

with open('admin_assets.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_select = '''                <select id="asset-subcat">
                    <option value="TREES">Trees</option>
                    <option value="ROCKS">Rocks</option>
                    <option value="PLANTS">Plants</option>
                </select>'''

new_select = '''                <select id="asset-subcat">
                    <option value="TREES">Trees</option>
                    <option value="ROCKS">Rocks</option>
                    <option value="PLANTS">Plants</option>
                    <option value="LANDSCAPE">Landscape</option>
                </select>'''

old_listener = '''              if (val === 'TREES') physSelect.value = 'tree';
              else if (val === 'ROCKS') physSelect.value = 'sphere';
              else if (val === 'PLANTS') physSelect.value = 'sphere';
              const id = document.getElementById('asset-id').value;'''

new_listener = '''              if (val === 'TREES') physSelect.value = 'tree';
              else if (val === 'ROCKS') physSelect.value = 'sphere';
              else if (val === 'PLANTS') physSelect.value = 'sphere';
              else if (val === 'LANDSCAPE') physSelect.value = 'sphere';
              const id = document.getElementById('asset-id').value;'''

if old_select in text and old_listener in text:
    text = text.replace(old_select, new_select)
    text = text.replace(old_listener, new_listener)
    with open('admin_assets.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED ADMIN")
else:
    print("OLD LOGIC NOT FOUND")
