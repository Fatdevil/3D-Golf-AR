import sys

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

old_fetch = '''              assets.forEach(a => {
                  let conf = a.config || {};
                  window.ASSET_REGISTRY[a.id] = {
                      icon: a.icon || '??',
                      cat: a.category || 'nature',
                      subcat: a.subcategory || 'TREES','''

new_fetch = '''              assets.forEach(a => {
                  let conf = a.config || {};
                  let defaultIcon = '??';
                  if (a.subcategory === 'ROCKS') defaultIcon = '??';
                  if (a.subcategory === 'PLANTS') defaultIcon = '??';
                  
                  window.ASSET_REGISTRY[a.id] = {
                      icon: a.icon || defaultIcon,
                      thumbnail: conf.thumbnail,
                      cat: a.category || 'nature',
                      subcat: a.subcategory || 'TREES','''

old_build = '''                  if (window.ACTIVE_BIOME === 'ALL' || biomes.includes('GLOBAL') || biomes.includes(window.ACTIVE_BIOME)) {
                      natureGroup.innerHTML += <div class="palette-btn" style="background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px;" onclick="setNatureType('', this)" title=""></div>;
                  }'''

new_build = '''                  if (window.ACTIVE_BIOME === 'ALL' || biomes.includes('GLOBAL') || biomes.includes(window.ACTIVE_BIOME)) {
                      let content = asset.thumbnail ? <img src="\" style="width:100%; height:100%; object-fit:cover; border-radius:4px;"> : asset.icon;
                      natureGroup.innerHTML += <div class="palette-btn" style="background:#334155; display:flex; justify-content:center; align-items:center; font-size:18px; padding:2px;" onclick="setNatureType('\', this)" title="\">\</div>;
                  }'''

if old_fetch in text and old_build in text:
    text = text.replace(old_fetch, new_fetch)
    text = text.replace(old_build, new_build)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED HUD ICONS")
else:
    print("OLD LOGIC NOT FOUND")
