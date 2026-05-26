import os

# Read arcade.html
arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Hide palettes
c = c.replace('<div id="pal-tee" class="palette-btn" style="background:#7cb54c; color:#fff; position:relative;" onclick="setPaletteColor(\'tee\', this)">Tee Box', '<div id="pal-tee" class="palette-btn" style="display:none; background:#7cb54c; color:#fff; position:relative;" onclick="setPaletteColor(\'tee\', this)">Tee Box')
c = c.replace('<div id="pal-green" class="palette-btn" style="background:#98ce68; color:#000;" onclick="setPaletteColor(\'green\', this)">Green</div>', '<div id="pal-green" class="palette-btn" style="display:none; background:#98ce68; color:#000;" onclick="setPaletteColor(\'green\', this)">Green</div>')
c = c.replace('<div id="pal-foregreen" class="palette-btn" style="background:#8bc45d; color:#fff;" onclick="setPaletteColor(\'foregreen\', this)">Foregreen</div>', '<div id="pal-foregreen" class="palette-btn" style="display:none; background:#8bc45d; color:#fff;" onclick="setPaletteColor(\'foregreen\', this)">Foregreen</div>')

# 2. Hide buttons
c = c.replace('<button id="btn-flag" onclick="setHoleAction(\'FLAG\')"><span style="font-size:16px;">⛳</span> Flag</button>', '<button id="btn-flag" onclick="setHoleAction(\'FLAG\')" style="display:none;"><span style="font-size:16px;">⛳</span> Flag</button>')
c = c.replace('<button id="btn-red-tee" onclick="setHoleAction(\'TEE_RED\')">🔴 Red Tee</button>', '<button id="btn-red-tee" onclick="setHoleAction(\'TEE_RED\')" style="display:none;">🔴 Red Tee</button>')
c = c.replace('<button id="btn-yellow-tee" onclick="setHoleAction(\'TEE_YELLOW\')">🟡 Yellow Tee</button>', '<button id="btn-yellow-tee" onclick="setHoleAction(\'TEE_YELLOW\')" style="display:none;">🟡 Yellow Tee</button>')
c = c.replace('<button id="btn-white-tee" onclick="setHoleAction(\'TEE_WHITE\')">⚪ White Tee</button>', '<button id="btn-white-tee" onclick="setHoleAction(\'TEE_WHITE\')" style="display:none;">⚪ White Tee</button>')
c = c.replace('<button id="btn-black-tee" onclick="setHoleAction(\'TEE_BLACK\')">⚫ Black Tee</button>', '<button id="btn-black-tee" onclick="setHoleAction(\'TEE_BLACK\')" style="display:none;">⚫ Black Tee</button>')
c = c.replace('<button id="btn-range-tee" onclick="setHoleAction(\'TEE_RANGE\')">🟦 Range Tee</button>', '<button id="btn-range-tee" onclick="setHoleAction(\'TEE_RANGE\')" style="display:none;">🟦 Range Tee</button>')

# 3. Read extracted green and inject it
with open('c:/Antigravety projekt/3D-Golf-AR/extracted_green.js', 'r', encoding='utf-8') as f:
    green_code = f.read()

# Add auto flag logic right before clearSmartGreen();
flag_logic = """
        // Auto-place Flag at centroid
        let cx = 0, cz = 0;
        for(let pt of smartGreenPoints) { cx += pt.x; cz += pt.z; }
        cx /= smartGreenPoints.length;
        cz /= smartGreenPoints.length;
        let surf = localGetTerrainAt(cx, -cz);
        let cy = surf ? surf.z : baseH;

        let hole = courseHoles[currentHoleIndex];
        if (hole.flagMesh) scene.remove(hole.flagMesh);
        hole.flag = { x: cx, y: cy, z: cz };
        hole.flagMesh = createFlagObject(cx, cy, cz);
        
        if(!hole.pins) hole.pins = {};
        hole.pins.easy = { x: cx, y: cy, z: cz };
        hole.pins.medium = { x: cx, y: cy, z: cz };
        hole.pins.hard = { x: cx, y: cy, z: cz };

        clearSmartGreen();
"""
green_code = green_code.replace("        clearSmartGreen();", flag_logic)

# Check if executeSplineSmartGreen is already in the file
if 'window.executeSplineSmartGreen' not in c:
    c = c.replace('        function executeSmartBuilder() {', green_code + '\\n\\n        function executeSmartBuilder() {')

with open(arcade_path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Patch applied successfully")
