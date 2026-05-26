import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('arcade.html', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Fix buildNatureUI to show thumbnail if available, else fallback to emoji icon
old_build = '''                    let biomes = asset.biomes || ['GLOBAL'];
                if (window.ACTIVE_BIOME === 'ALL' || biomes.includes('GLOBAL') || biomes.includes(window.ACTIVE_BIOME)) {
                    natureGroup.innerHTML += <div class="palette-btn" style="background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px;" onclick="setNatureType('', this)" title=""></div>;
                }'''

new_build = '''                    let biomes = asset.biomes || ['GLOBAL'];
                if (window.ACTIVE_BIOME === 'ALL' || biomes.includes('GLOBAL') || biomes.includes(window.ACTIVE_BIOME)) {
                    let subcatEmoji = asset.subcat === 'ROCKS' ? '\\u{1faa8}' : asset.subcat === 'LANDSCAPE' ? '\\u26f0\\uFE0F' : asset.subcat === 'PLANTS' ? '\\u{1f33f}' : '\\u{1f332}';
                    let btnContent = (asset.thumbnail && asset.thumbnail.length > 10)
                        ? <img src="" style="width:100%;height:100%;object-fit:cover;border-radius:4px;" onerror="this.style.display='none';this.parentNode.innerHTML=''">
                        : (asset.icon && asset.icon !== '?' && asset.icon.length < 10 ? asset.icon : subcatEmoji);
                    natureGroup.innerHTML += <div class="palette-btn" style="background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px; padding:2px; overflow:hidden;" onclick="setNatureType('', this)" title=""></div>;
                }'''

if old_build in text:
    text = text.replace(old_build, new_build)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print('PATCHED OK')
else:
    print('NOT FOUND - trying exact match...')
    # Show what the current code looks like
    idx = text.find("palette-btn\" style=\"background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px;\" onclick=\"setNatureType")
    if idx > 0:
        print(repr(text[idx-200:idx+300]))
