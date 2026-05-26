html = open('arcade.html', 'r', encoding='utf-8').read()

old_sculpt_dir = "sculptDirection = (e.button === 2 || e.shiftKey) ? -1 : 1;"
new_sculpt_dir = "sculptDirection = (e.button === 2 || e.shiftKey || window.ipadSculptDir === -1) ? -1 : 1;"

html = html.replace(old_sculpt_dir, new_sculpt_dir)

old_ui_block = """            <div style="display:flex; justify-content:space-between; width:80px;">
                <button onclick="setBrushMultiplier(1, this)" class="brush-mult-btn active" style="background:#38bdf8; color:#0f172a; border:none; padding:2px; font-size:9px; border-radius:3px; font-weight:bold; cursor:pointer; width:30%;">1x</button>
                <button onclick="setBrushMultiplier(4, this)" class="brush-mult-btn" style="background:#334155; color:#94a3b8; border:none; padding:2px; font-size:9px; border-radius:3px; font-weight:bold; cursor:pointer; width:30%;">4x</button>
                <button onclick="setBrushMultiplier(10, this)" class="brush-mult-btn" style="background:#334155; color:#94a3b8; border:none; padding:2px; font-size:9px; border-radius:3px; font-weight:bold; cursor:pointer; width:30%;">10x</button>
            </div>
        </div>"""

new_ui_block = """            <div style="display:flex; justify-content:space-between; width:80px;">
                <button onclick="setBrushMultiplier(1, this)" class="brush-mult-btn active" style="background:#38bdf8; color:#0f172a; border:none; padding:2px; font-size:9px; border-radius:3px; font-weight:bold; cursor:pointer; width:30%;">1x</button>
                <button onclick="setBrushMultiplier(4, this)" class="brush-mult-btn" style="background:#334155; color:#94a3b8; border:none; padding:2px; font-size:9px; border-radius:3px; font-weight:bold; cursor:pointer; width:30%;">4x</button>
                <button onclick="setBrushMultiplier(10, this)" class="brush-mult-btn" style="background:#334155; color:#94a3b8; border:none; padding:2px; font-size:9px; border-radius:3px; font-weight:bold; cursor:pointer; width:30%;">10x</button>
            </div>
            
            <button id="ipad-sculpt-btn" onclick="toggleIpadSculpt()" style="width:80px; margin-top:4px; background:#4ade80; color:#0f172a; border:none; padding:4px 0; font-size:10px; border-radius:3px; font-weight:bold; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.5);" title="Ändra riktning på penseln (för iPads utan högerklick)">⬆️ RAISE</button>
            
        </div>"""

html = html.replace(old_ui_block, new_ui_block)

old_script = "window.setBrushMultiplier = function(val, btn) {"
new_script = """window.ipadSculptDir = 1;
    window.toggleIpadSculpt = function() {
        window.ipadSculptDir = window.ipadSculptDir === 1 ? -1 : 1;
        let btn = document.getElementById('ipad-sculpt-btn');
        if (window.ipadSculptDir === 1) {
            btn.innerText = "⬆️ RAISE";
            btn.style.background = "#4ade80"; // green
            btn.style.color = "#0f172a";
        } else {
            btn.innerText = "⬇️ LOWER";
            btn.style.background = "#ef4444"; // red
            btn.style.color = "#fff";
        }
    };
    
    window.setBrushMultiplier = function(val, btn) {"""

html = html.replace(old_script, new_script)

open('arcade.html', 'w', encoding='utf-8').write(html)
print('Patched successfully')
