import sys

html = open('arcade.html', 'r', encoding='utf-8').read()

# 1. Add Tool Button
btn_flatten = """<button id="tool-flatten" onclick="setTool('FLATTEN')" style="background:transparent; color:#94a3b8; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer; transition:all 0.2s;">🧽 FLATTEN</button>"""
btn_smooth = """<button id="tool-smooth" onclick="setTool('SMOOTH')" style="background:transparent; color:#94a3b8; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer; transition:all 0.2s;">🧽 SMOOTH</button>"""
if 'tool-smooth' not in html:
    html = html.replace(btn_flatten, btn_smooth + '\n            ' + btn_flatten)

# 2. Add setTool highlighting
setTool_flatten = """        document.getElementById('tool-flatten').style.background = toolName === 'FLATTEN' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-flatten').style.color = toolName === 'FLATTEN' ? '#0f172a' : '#94a3b8';"""
setTool_smooth = """        document.getElementById('tool-smooth').style.background = toolName === 'SMOOTH' ? '#38bdf8' : 'transparent';
        document.getElementById('tool-smooth').style.color = toolName === 'SMOOTH' ? '#0f172a' : '#94a3b8';"""
if 'toolName === \'SMOOTH\'' not in html:
    html = html.replace(setTool_flatten, setTool_smooth + '\n\n' + setTool_flatten)

# 3. Add to sculpt options whitelist
html = html.replace("toolName === 'SCULPT' || toolName === 'FLATTEN'", "toolName === 'SCULPT' || toolName === 'SMOOTH' || toolName === 'FLATTEN'")
html = html.replace("currentTool !== 'SCULPT' && currentTool !== 'FLATTEN'", "currentTool !== 'SCULPT' && currentTool !== 'SMOOTH' && currentTool !== 'FLATTEN'")
html = html.replace("currentTool === 'SCULPT' || currentTool === 'FLATTEN'", "currentTool === 'SCULPT' || currentTool === 'SMOOTH' || currentTool === 'FLATTEN'")

# 4. Add tool hint
hint_flatten = "else if (toolName === 'FLATTEN') hintHtml = \"Hold Mouse: <b>Flatten Surface</b>\";"
hint_smooth = "else if (toolName === 'SMOOTH') hintHtml = \"Hold Mouse: <b>Smooth Terrain</b>\";"
if "toolName === 'SMOOTH'" not in html.split('tool-hints')[0]: # Just to check if we injected hint
    html = html.replace(hint_flatten, hint_smooth + '\n        ' + hint_flatten)

# 5. Add cursor color
cursor_flatten = """        if(toolName === 'FLATTEN') {
            sculptBrushCursor.material.color.setHex(0xffffff); // Vit"""
cursor_smooth = """        if(toolName === 'SMOOTH') {
            sculptBrushCursor.material.color.setHex(0xa855f7); // Lila
        } else if(toolName === 'FLATTEN') {
            sculptBrushCursor.material.color.setHex(0xffffff); // Vit"""
if "toolName === 'SMOOTH'" not in html.split('0xffffff')[0]:
    html = html.replace(cursor_flatten, cursor_smooth)

# 6. Apply Sculpting Logic
# Find the line before the main loop where we can inject smoothAvg loop
loop_start = """        let wPosArray = waterGeo ? waterGeo.attributes.position.array : null;

        for(let i = 0; i < count; i++) {"""

smooth_calc = """        let wPosArray = waterGeo ? waterGeo.attributes.position.array : null;

        let smoothAvg = 0;
        let smoothCount = 0;
        if (currentTool === 'SMOOTH') {
            for(let i = 0; i < count; i++) {
                let vx = positions[i*3];
                let vz = -positions[i*3 + 1]; 
                let d = 0;
                if (l2 === 0) {
                    d = Math.sqrt((vx - p1.x)*(vx - p1.x) + (vz - p1.z)*(vz - p1.z));
                } else {
                    let t = Math.max(0, Math.min(1, ((vx - p1.x) * (p2.x - p1.x) + (vz - p1.z) * (p2.z - p1.z)) / l2));
                    let pX = p1.x + t * (p2.x - p1.x);
                    let pZ = p1.z + t * (p2.z - p1.z);
                    d = Math.sqrt((vx - pX)*(vx - pX) + (vz - pZ)*(vz - pZ));
                }
                if (d < radius) {
                    smoothAvg += positions[i*3 + 2];
                    smoothCount++;
                }
            }
            if (smoothCount > 0) smoothAvg /= smoothCount;
        }

        for(let i = 0; i < count; i++) {"""

if 'smoothAvg' not in html:
    html = html.replace(loop_start, smooth_calc)


# 7. Add smooth logic into the tool checks
tool_checks = """                if (currentTool === 'SCULPT') {
                    positions[i*3 + 2] += strength * falloff;
                    updatePos = true;
                } else if (currentTool === 'FLATTEN') {"""

tool_checks_smooth = """                if (currentTool === 'SCULPT') {
                    positions[i*3 + 2] += strength * falloff;
                    updatePos = true;
                } else if (currentTool === 'SMOOTH') {
                    positions[i*3 + 2] += (smoothAvg - positions[i*3 + 2]) * 0.15 * brushMultiplier * falloff;
                    updatePos = true;
                } else if (currentTool === 'FLATTEN') {"""

if 'currentTool === \'SMOOTH\'' not in html.split('updatePos = true;')[1]:
    html = html.replace(tool_checks, tool_checks_smooth)

open('arcade.html', 'w', encoding='utf-8').write(html)
print("Patched completely!")
