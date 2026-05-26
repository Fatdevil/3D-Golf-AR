"""
Complete patch: Hole labels + Hole selector in Smart Builder + auto-advance + hide manual buttons
"""

arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

changes = 0

# ============================================================
# 1. Add createHoleLabel() function + modify createTeeObject and createFlagObject
# ============================================================

# Insert createHoleLabel right before createTeeObject
old_tee_start = """    const teeGeo = new THREE.SphereGeometry(0.35, 16, 16); 
    const teeMat = new THREE.MeshLambertMaterial({ color: 0x38bdf8 });"""

new_tee_start = """    // Hole number label (floating sprite, BUILD mode only)
    function createHoleLabel(number) {
        let canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        let ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(number), 32, 33);
        let tex = new THREE.CanvasTexture(canvas);
        let mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        let sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.0, 2.0, 1);
        sprite.name = 'holeLabel';
        sprite.renderOrder = 999;
        return sprite;
    }

    const teeGeo = new THREE.SphereGeometry(0.35, 16, 16); 
    const teeMat = new THREE.MeshLambertMaterial({ color: 0x38bdf8 });"""

if old_tee_start in c:
    c = c.replace(old_tee_start, new_tee_start)
    changes += 1
    print("1a. createHoleLabel() function added")
else:
    print("1a. FAILED - teeGeo target not found")

# Add label to createTeeObject
old_tee_return = """        group.position.set(x, y, z);
        scene.add(group);
        return group;
    }

    function createFlagObject"""

new_tee_return = """        // Hole number label (only in BUILD mode)
        if (appMode === 'BUILD') {
            let label = createHoleLabel(currentHoleIndex + 1);
            label.position.set(0, 2.5, 0);
            group.add(label);
        }

        group.position.set(x, y, z);
        scene.add(group);
        return group;
    }

    function createFlagObject"""

if old_tee_return in c:
    c = c.replace(old_tee_return, new_tee_return)
    changes += 1
    print("1b. Hole label added to createTeeObject")
else:
    print("1b. FAILED - createTeeObject return not found")

# Add label to createFlagObject (before gimme circle)
old_flag_gimme = """        // Gimme circle"""

new_flag_gimme = """        // Hole number label (only in BUILD mode)
        if (appMode === 'BUILD') {
            let label = createHoleLabel(currentHoleIndex + 1);
            label.position.set(0, 7.5, 0);
            group.add(label);
        }

        // Gimme circle"""

if old_flag_gimme in c:
    c = c.replace(old_flag_gimme, new_flag_gimme, 1)  # Only first occurrence
    changes += 1
    print("1c. Hole label added to createFlagObject")
else:
    print("1c. FAILED - gimme circle target not found")


# ============================================================
# 2. Add Hole selector to Smart Builder panel
# ============================================================

old_sb_title = """    <h3 style="margin:0 0 10px 0; color:#fff; font-size:14px; text-transform:uppercase; letter-spacing:1px;">\U0001f3d7\ufe0f Smart Builder</h3>"""

new_sb_title = """    <h3 style="margin:0 0 6px 0; color:#fff; font-size:14px; text-transform:uppercase; letter-spacing:1px;">\U0001f3d7\ufe0f Smart Builder</h3>
    
    <!-- Hole Selector -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; border-radius:8px; padding:4px 8px; margin-bottom:10px;">
        <button onclick="changeHole(-1); updateSBHoleDisplay()" style="background:transparent; color:#94a3b8; border:none; font-weight:bold; cursor:pointer; padding:5px 10px; font-size:16px;">&lt;</button>
        <div id="sb-hole-display" style="color:#4ade80; font-weight:bold; font-size:13px;">Hole 1 (Par 4) \u25cb</div>
        <button onclick="changeHole(1); updateSBHoleDisplay()" style="background:transparent; color:#94a3b8; border:none; font-weight:bold; cursor:pointer; padding:5px 10px; font-size:16px;">&gt;</button>
    </div>"""

if old_sb_title in c:
    c = c.replace(old_sb_title, new_sb_title)
    changes += 1
    print("2. Hole selector added to Smart Builder panel")
else:
    print("2. FAILED - Smart Builder title not found")


# ============================================================
# 3. Add updateSBHoleDisplay function + auto-advance logic
# ============================================================

old_script_end = """        function executeSmartBuilder() {"""

new_script_end = """        // Update hole display in Smart Builder panel
        window.updateSBHoleDisplay = function() {
            let el = document.getElementById('sb-hole-display');
            if(!el) return;
            let hole = courseHoles[currentHoleIndex];
            let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
            let hasFlag = hole.flag;
            let status = '\u25cb'; // empty
            if(hasTee && hasFlag) status = '\u2705'; // complete
            else if(hasTee || hasFlag) status = '\u26a0\ufe0f'; // partial
            el.textContent = 'Hole ' + (currentHoleIndex + 1) + ' (Par ' + hole.par + ') ' + status;
            // Also sync HOLE tool display
            let holeNum = document.getElementById('hole-ui-num');
            if(holeNum) holeNum.innerText = 'Hole ' + (currentHoleIndex + 1);
            let holePar = document.getElementById('hole-ui-par');
            if(holePar) holePar.innerText = 'Par ' + hole.par;
        };

        // Auto-advance to next incomplete hole
        window.autoAdvanceHole = function() {
            let hole = courseHoles[currentHoleIndex];
            let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
            let hasFlag = hole.flag;
            if(hasTee && hasFlag) {
                // Find next incomplete hole
                let nextIdx = -1;
                for(let i = currentHoleIndex + 1; i < MAX_HOLES; i++) {
                    let h = courseHoles[i];
                    let ht = h.tees.yellow || h.tees.red || h.tees.white || h.tees.black;
                    if(!ht || !h.flag) { nextIdx = i; break; }
                }
                if(nextIdx >= 0) {
                    showBuildToast('\u2705 Hole ' + (currentHoleIndex+1) + ' Complete! \u2192 Hole ' + (nextIdx+1), '#4ade80');
                    setTimeout(function() {
                        currentHoleIndex = nextIdx;
                        updateSBHoleDisplay();
                    }, 1500);
                } else {
                    showBuildToast('\U0001f3c6 All holes configured!', '#fbbf24');
                }
            }
            updateSBHoleDisplay();
        };

        function executeSmartBuilder() {"""

if old_script_end in c:
    c = c.replace(old_script_end, new_script_end)
    changes += 1
    print("3. updateSBHoleDisplay + autoAdvanceHole added")
else:
    print("3. FAILED - executeSmartBuilder not found")


# ============================================================
# 4. Call autoAdvanceHole after Smart Tee builds
# ============================================================

old_tee_clear = """        clearSmartGreen();
    };

    window.buildFenceMesh"""

new_tee_clear = """        clearSmartGreen();
        saveLevel();
        window.autoAdvanceHole();
    };

    window.buildFenceMesh"""

if old_tee_clear in c:
    c = c.replace(old_tee_clear, new_tee_clear)
    changes += 1
    print("4. autoAdvanceHole added after Smart Tee")
else:
    print("4. FAILED - Smart Tee clearSmartGreen not found")


# ============================================================
# 5. Call autoAdvanceHole after Smart Green builds (already has saveLevel)
# ============================================================

old_green_save = """        clearSmartGreen();
        saveLevel();

        // Prevent double-click"""

new_green_save = """        clearSmartGreen();
        saveLevel();
        window.autoAdvanceHole();

        // Prevent double-click"""

if old_green_save in c:
    c = c.replace(old_green_save, new_green_save)
    changes += 1
    print("5. autoAdvanceHole added after Smart Green")
else:
    print("5. FAILED - Smart Green saveLevel not found")


# ============================================================
# 6. Hide manual tee/flag buttons in HOLE panel
# ============================================================

# Hide Red Tee button
old_red = 'id="btn-set-tee-red" onclick="setHoleItem(\'TEE_RED\')" class="hole-item-btn" style="background:#1e293b;'
new_red = 'id="btn-set-tee-red" onclick="setHoleItem(\'TEE_RED\')" class="hole-item-btn" style="display:none; background:#1e293b;'
if old_red in c:
    c = c.replace(old_red, new_red)
    changes += 1
    print("6a. Red Tee hidden")

# Hide Yellow Tee button
old_yel = 'id="btn-set-tee-yellow" onclick="setHoleItem(\'TEE_YELLOW\')" class="hole-item-btn active" style="background:#facc15;'
new_yel = 'id="btn-set-tee-yellow" onclick="setHoleItem(\'TEE_YELLOW\')" class="hole-item-btn active" style="display:none; background:#facc15;'
if old_yel in c:
    c = c.replace(old_yel, new_yel)
    changes += 1
    print("6b. Yellow Tee hidden")

# Hide White Tee
old_wht = 'id="btn-set-tee-white" onclick="setHoleItem(\'TEE_WHITE\')" class="hole-item-btn" style="background:#1e293b; color:#fff;'
new_wht = 'id="btn-set-tee-white" onclick="setHoleItem(\'TEE_WHITE\')" class="hole-item-btn" style="display:none; background:#1e293b; color:#fff;'
if old_wht in c:
    c = c.replace(old_wht, new_wht)
    changes += 1
    print("6c. White Tee hidden")

# Hide Black Tee
old_blk = 'id="btn-set-tee-black" onclick="setHoleItem(\'TEE_BLACK\')" class="hole-item-btn" style="background:#1e293b; color:#94a3b8;'
new_blk = 'id="btn-set-tee-black" onclick="setHoleItem(\'TEE_BLACK\')" class="hole-item-btn" style="display:none; background:#1e293b; color:#94a3b8;'
if old_blk in c:
    c = c.replace(old_blk, new_blk)
    changes += 1
    print("6d. Black Tee hidden")

# Hide Flag
old_flag = 'id="btn-set-flag" onclick="setHoleItem(\'FLAG\')" class="hole-item-btn" style="background:#1e293b; color:#94a3b8; border:1px solid #475569;'
new_flag = 'id="btn-set-flag" onclick="setHoleItem(\'FLAG\')" class="hole-item-btn" style="display:none; background:#1e293b; color:#94a3b8; border:1px solid #475569;'
if old_flag in c:
    c = c.replace(old_flag, new_flag)
    changes += 1
    print("6e. Flag hidden")

# Hide Range Tee
old_range = 'id="btn-set-range-tee" onclick="setHoleItem(\'TEE_RANGE\')" class="hole-item-btn" style="background:#1e293b; color:#eab308; border:1px solid #eab308;'
new_range = 'id="btn-set-range-tee" onclick="setHoleItem(\'TEE_RANGE\')" class="hole-item-btn" style="display:none; background:#1e293b; color:#eab308; border:1px solid #eab308;'
if old_range in c:
    c = c.replace(old_range, new_range)
    changes += 1
    print("6f. Range Tee hidden")

# Hide unit toggle (no longer needed without manual placement)
old_unit = 'id="btn-toggle-unit" onclick="toggleRangeUnit()" style="background:#1e293b;'
new_unit = 'id="btn-toggle-unit" onclick="toggleRangeUnit()" style="display:none; background:#1e293b;'
if old_unit in c:
    c = c.replace(old_unit, new_unit)
    changes += 1
    print("6g. Unit toggle hidden")


# ============================================================
# 7. Initialize hole display on Smart Builder panel show
# ============================================================

old_set_tool_smart = """    } else if(toolName === 'SMART_BUILDER') {"""

# Check what's right after it
idx = c.find(old_set_tool_smart)
if idx > 0:
    snippet = c[idx:idx+200]
    print(f"\n7. Context around SMART_BUILDER tool set:\n{snippet[:200]}")

# Add updateSBHoleDisplay call when smart builder tool is selected  
new_set_tool_smart = """    } else if(toolName === 'SMART_BUILDER') {
        if(typeof updateSBHoleDisplay === 'function') updateSBHoleDisplay();"""

# Need to find the exact line after the else if
old_smart_hint = """    } else if(toolName === 'SMART_BUILDER') {
        hintHtml = "Left Click:"""
if old_smart_hint in c:
    new_smart_hint = """    } else if(toolName === 'SMART_BUILDER') {
        if(typeof updateSBHoleDisplay === 'function') updateSBHoleDisplay();
        hintHtml = "Left Click:"""
    c = c.replace(old_smart_hint, new_smart_hint)
    changes += 1
    print("7. updateSBHoleDisplay called on SMART_BUILDER tool select")
else:
    print("7. FAILED - SMART_BUILDER hint not found, trying alt...")
    # Try finding the tool set another way
    if old_set_tool_smart in c:
        c = c.replace(old_set_tool_smart, new_set_tool_smart, 1)
        changes += 1
        print("7. (alt) updateSBHoleDisplay injected after tool set")


# Write result
with open(arcade_path, 'w', encoding='utf-8') as f:
    f.write(c)

print(f"\n=== {changes} changes applied ===")
