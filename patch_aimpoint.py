"""
Patch: Add Aim Point system + remove auto-rotation + update save/load + AIM type in Smart Builder
"""
arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

changes = 0

# === 1. Add aimPoint to courseHoles initialization ===
old_init = """        courseHoles.push({ 
            par: 4, 
            tees: { red: null, yellow: null, white: null, black: null, range: null },
            teeMeshes: { red: null, yellow: null, white: null, black: null, range: null },
            flag: null, 
            flagMesh: null 
        });"""

new_init = """        courseHoles.push({ 
            par: 4, 
            tees: { red: null, yellow: null, white: null, black: null, range: null },
            teeMeshes: { red: null, yellow: null, white: null, black: null, range: null },
            flag: null, 
            flagMesh: null,
            aimPoint: null,
            aimMesh: null
        });"""

if old_init in c:
    c = c.replace(old_init, new_init)
    changes += 1
    print("1. aimPoint added to courseHoles init")
else:
    print("1. FAILED - courseHoles init not found")

# === 2. Add createAimPointMarker function after createHoleLabel ===
old_label_end = """        let sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.0, 2.0, 1);
        sprite.name = 'holeLabel';
        sprite.renderOrder = 999;
        return sprite;
    }

    const teeGeo"""

new_label_end = """        let sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.0, 2.0, 1);
        sprite.name = 'holeLabel';
        sprite.renderOrder = 999;
        return sprite;
    }

    // Create aim point marker (orange target ring on ground + hole label)
    function createAimPointMarker(x, y, z, holeNum) {
        let group = new THREE.Group();
        
        // Outer ring
        let ringGeo = new THREE.RingGeometry(1.5, 2.0, 32);
        let ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        let ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.08;
        group.add(ring);
        
        // Inner dot
        let dotGeo = new THREE.CircleGeometry(0.5, 16);
        let dotMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
        let dot = new THREE.Mesh(dotGeo, dotMat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = 0.09;
        group.add(dot);
        
        // Crosshair lines
        let lineGeo = new THREE.PlaneGeometry(0.15, 4.5);
        let lineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
        let lineH = new THREE.Mesh(lineGeo, lineMat);
        lineH.rotation.x = -Math.PI / 2;
        lineH.rotation.z = Math.PI / 2;
        lineH.position.y = 0.07;
        group.add(lineH);
        let lineV = new THREE.Mesh(lineGeo.clone(), lineMat);
        lineV.rotation.x = -Math.PI / 2;
        lineV.position.y = 0.07;
        group.add(lineV);
        
        // Hole label
        if(appMode === 'BUILD') {
            let label = createHoleLabel(holeNum);
            label.position.set(0, 3.0, 0);
            group.add(label);
        }
        
        group.position.set(x, y, z);
        group.name = 'aimPointMarker';
        scene.add(group);
        return group;
    }

    const teeGeo"""

if old_label_end in c:
    c = c.replace(old_label_end, new_label_end)
    changes += 1
    print("2. createAimPointMarker function added")
else:
    print("2. FAILED - createHoleLabel end not found")

# === 3. Remove auto-sort tees on green build ===
old_auto_sort = """        // Auto-sort tees: black=farthest from flag, red=closest, + rotate to face flag
        let orderedKeys = ['black','white','yellow','red']; // farthest to closest
        let existingTees = [];
        for(let k of orderedKeys) {
            if(hole.tees[k]) existingTees.push(k);
        }
        if(existingTees.length >= 2) {
            // Collect positions and sort by distance to flag (farthest first)
            let positions = existingTees.map(k => ({x: hole.tees[k].x, y: hole.tees[k].y, z: hole.tees[k].z}));
            positions.sort(function(a, b) {
                let da = (a.x-cx)*(a.x-cx) + (a.z-cz)*(a.z-cz);
                let db = (b.x-cx)*(b.x-cx) + (b.z-cz)*(b.z-cz);
                return db - da; // farthest first
            });
            // Reassign: existingTees[0] gets farthest position, last gets closest
            for(let i = 0; i < existingTees.length; i++) {
                let k = existingTees[i];
                let pos = positions[i];
                let rot = Math.atan2(cx - pos.x, cz - pos.z);
                hole.tees[k].x = pos.x; hole.tees[k].y = pos.y; hole.tees[k].z = pos.z;
                hole.tees[k].rot = rot;
                if(hole.teeMeshes[k]) {
                    hole.teeMeshes[k].position.set(pos.x, pos.y, pos.z);
                    hole.teeMeshes[k].rotation.y = rot;
                }
            }
        } else if(existingTees.length === 1) {
            let k = existingTees[0];
            let rot = Math.atan2(cx - hole.tees[k].x, cz - hole.tees[k].z);
            hole.tees[k].rot = rot;
            if(hole.teeMeshes[k]) hole.teeMeshes[k].rotation.y = rot;
        }"""

new_auto_sort = """        // After green is built, prompt user to set aim point
        if(hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black) {
            showBuildToast('\\ud83c\\udfaf Now set Aim Point — select AIM in Smart Builder and click on landing zone', '#f59e0b');
        }"""

if old_auto_sort in c:
    c = c.replace(old_auto_sort, new_auto_sort)
    changes += 1
    print("3. Auto-sort removed, aim point prompt added")
else:
    print("3. FAILED - auto-sort block not found")

# === 4. Add AIM button to Smart Builder type selector ===
old_tee_btn = """        <button id="sb-type-tee" onclick="setSmartBuilderType('TEE')" style="background:#334155; color:#94a3b8; border:none; padding:6px 10px; font-size:10px; border-radius:4px; font-weight:bold; cursor:pointer; flex:1;">🟦 TEE</button>
    </div>"""

new_tee_btn = """        <button id="sb-type-tee" onclick="setSmartBuilderType('TEE')" style="background:#334155; color:#94a3b8; border:none; padding:6px 10px; font-size:10px; border-radius:4px; font-weight:bold; cursor:pointer; flex:1;">🟦 TEE</button>
        <button id="sb-type-aim" onclick="setSmartBuilderType('AIM')" style="background:#334155; color:#94a3b8; border:none; padding:6px 10px; font-size:10px; border-radius:4px; font-weight:bold; cursor:pointer; flex:1;">\U0001f3af AIM</button>
    </div>"""

if old_tee_btn in c:
    c = c.replace(old_tee_btn, new_tee_btn)
    changes += 1
    print("4. AIM button added to Smart Builder panel")
else:
    print("4. FAILED - tee button not found")

# === 5. Add AIM controls panel (simple instruction text) ===
old_tee_controls = """    <!-- TEE controls -->
    <div id="sb-tee-controls" style="display:none;">"""

new_tee_controls = """    <!-- AIM controls -->
    <div id="sb-aim-controls" style="display:none;">
        <div style="background:#1e293b; padding:12px; border-radius:8px; margin-bottom:8px; text-align:center;">
            <div style="color:#f59e0b; font-size:12px; font-weight:bold; margin-bottom:4px;">\U0001f3af Click on fairway to set aim point</div>
            <div style="color:#94a3b8; font-size:10px;">Tees will auto-rotate toward this point.<br>Click again to move it.</div>
        </div>
    </div>

    <!-- TEE controls -->
    <div id="sb-tee-controls" style="display:none;">"""

if old_tee_controls in c:
    c = c.replace(old_tee_controls, new_tee_controls)
    changes += 1
    print("5. AIM controls panel added")
else:
    print("5. FAILED - tee controls not found")

# === 6. Handle AIM type in setSmartBuilderType ===
old_set_type = """        ['GREEN','BUNKER','FAIRWAY','TEE'].forEach(t => {"""

new_set_type = """        ['GREEN','BUNKER','FAIRWAY','TEE','AIM'].forEach(t => {"""

if old_set_type in c:
    c = c.replace(old_set_type, new_set_type)
    changes += 1
    print("6a. AIM added to type toggle forEach")
else:
    print("6a. FAILED - type forEach not found")

# Also handle AIM controls visibility
old_show_controls = """            document.getElementById('sb-green-controls').style.display = (type === 'GREEN') ? '' : 'none';
            document.getElementById('sb-bunker-controls').style.display = (type === 'BUNKER') ? '' : 'none';
            document.getElementById('sb-fairway-controls').style.display = (type === 'FAIRWAY') ? '' : 'none';
            document.getElementById('sb-tee-controls').style.display = (type === 'TEE') ? '' : 'none';"""

new_show_controls = """            document.getElementById('sb-green-controls').style.display = (type === 'GREEN') ? '' : 'none';
            document.getElementById('sb-bunker-controls').style.display = (type === 'BUNKER') ? '' : 'none';
            document.getElementById('sb-fairway-controls').style.display = (type === 'FAIRWAY') ? '' : 'none';
            document.getElementById('sb-tee-controls').style.display = (type === 'TEE') ? '' : 'none';
            document.getElementById('sb-aim-controls').style.display = (type === 'AIM') ? '' : 'none';"""

if old_show_controls in c:
    c = c.replace(old_show_controls, new_show_controls)
    changes += 1
    print("6b. AIM controls visibility toggle added")
else:
    print("6b. FAILED - controls visibility not found")

# === 7. Handle AIM clicks in SMART_BUILDER handler ===
old_smart_click = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            if(e.button === 0 && lastHitPoint) {
                if(!smartAddPoint(lastHitPoint.clone())) {"""

new_smart_click = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            // AIM mode: single click places/moves aim point
            if(window._smartBuilderType === 'AIM' && e.button === 0 && lastHitPoint) {
                let hole = courseHoles[currentHoleIndex];
                let pt = lastHitPoint.clone();
                let surf = localGetTerrainAt(pt.x, -pt.z);
                let py = surf ? surf.z : pt.y;
                
                if(hole.aimMesh) scene.remove(hole.aimMesh);
                hole.aimPoint = { x: pt.x, y: py, z: pt.z };
                hole.aimMesh = createAimPointMarker(pt.x, py, pt.z, currentHoleIndex + 1);
                
                // Auto-rotate tees toward aim point
                for(let tKey of ['red','yellow','white','black']) {
                    if(hole.tees[tKey] && hole.teeMeshes[tKey]) {
                        let rot = Math.atan2(pt.x - hole.tees[tKey].x, pt.z - hole.tees[tKey].z);
                        hole.tees[tKey].rot = rot;
                        hole.teeMeshes[tKey].rotation.y = rot;
                    }
                }
                
                saveLevel();
                showBuildToast('\\ud83c\\udfaf Aim point set for Hole ' + (currentHoleIndex+1), '#4ade80');
                updateSBHoleDisplay();
                controls.enabled = false;
                return;
            }
            if(e.button === 0 && lastHitPoint) {
                if(!smartAddPoint(lastHitPoint.clone())) {"""

if old_smart_click in c:
    c = c.replace(old_smart_click, new_smart_click)
    changes += 1
    print("7. AIM click handler added")
else:
    print("7. FAILED - smart builder click handler not found")

# === 8. Update Build button text for AIM type ===
old_build_btn_text = """            } else if(window._smartBuilderType === 'TEE') {
                buildBtn.textContent = '🟦 Build Tee Box';"""

new_build_btn_text = """            } else if(window._smartBuilderType === 'AIM') {
                buildBtn.textContent = '\\ud83c\\udfaf Click to Place';
                buildBtn.style.display = 'none'; // No build button needed for AIM
            } else if(window._smartBuilderType === 'TEE') {
                buildBtn.textContent = '🟦 Build Tee Box';"""

if old_build_btn_text in c:
    c = c.replace(old_build_btn_text, new_build_btn_text)
    changes += 1
    print("8. Build button hidden for AIM type")
else:
    print("8. FAILED - build button TEE text not found")

# Also make sure build button reappears for other types
old_btn_show = """            buildBtn.textContent = '⛳ Build Green';"""

# Need to ensure buildBtn.style.display is reset
new_btn_show = """            buildBtn.textContent = '⛳ Build Green'; buildBtn.style.display = '';"""

if old_btn_show in c:
    c = c.replace(old_btn_show, new_btn_show, 1)  # Only first occurrence
    changes += 1
    print("8b. Build button shown for GREEN type")
else:
    print("8b. FAILED - build green text not found")

# === 9. Update hole completion check to include aimPoint ===
old_complete_check = """            let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
            let hasFlag = hole.flag;
            let status = '\\u25cb'; // empty
            if(hasTee && hasFlag) status = '\\u2705'; // complete
            else if(hasTee || hasFlag) status = '\\u26a0\\ufe0f'; // partial"""

new_complete_check = """            let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
            let hasFlag = hole.flag;
            let hasAim = hole.aimPoint;
            let status = '\\u25cb'; // empty
            if(hasTee && hasFlag && hasAim) status = '\\u2705'; // complete
            else if(hasTee || hasFlag) status = '\\u26a0\\ufe0f'; // partial"""

if old_complete_check in c:
    c = c.replace(old_complete_check, new_complete_check)
    changes += 1
    print("9. Hole completion check updated with aimPoint")
else:
    print("9. FAILED - completion check not found")

# === 10. Update autoAdvanceHole check ===
old_advance_check = """            let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
            let hasFlag = hole.flag;
            if(hasTee && hasFlag) {"""

new_advance_check = """            let hasTee = hole.tees.yellow || hole.tees.red || hole.tees.white || hole.tees.black;
            let hasFlag = hole.flag;
            let hasAim = hole.aimPoint;
            if(hasTee && hasFlag && hasAim) {"""

if old_advance_check in c:
    c = c.replace(old_advance_check, new_advance_check)
    changes += 1
    print("10a. Auto-advance check updated with aimPoint")
else:
    print("10a. FAILED - advance check not found")

# Also update the inner loop check
old_inner_check = """                    let ht = h.tees.yellow || h.tees.red || h.tees.white || h.tees.black;
                    if(!ht || !h.flag) { nextIdx = i; break; }"""

new_inner_check = """                    let ht = h.tees.yellow || h.tees.red || h.tees.white || h.tees.black;
                    if(!ht || !h.flag || !h.aimPoint) { nextIdx = i; break; }"""

if old_inner_check in c:
    c = c.replace(old_inner_check, new_inner_check)
    changes += 1
    print("10b. Inner advance loop updated with aimPoint")
else:
    print("10b. FAILED - inner advance check not found")

# === 11. Hide aim point markers during capture mode ===
old_capture_hide = """        // Hide hole number labels during photography
        scene.traverse(function(obj) { if(obj.name === 'holeLabel') obj.visible = false; });"""

new_capture_hide = """        // Hide hole number labels and aim markers during photography
        scene.traverse(function(obj) { if(obj.name === 'holeLabel' || obj.name === 'aimPointMarker') obj.visible = false; });"""

if old_capture_hide in c:
    c = c.replace(old_capture_hide, new_capture_hide)
    changes += 1
    print("11. Aim markers hidden during capture")
else:
    print("11. FAILED - capture hide not found")

# === 12. Include aimPoint in save data ===
old_save = """let dumpHoles = courseHoles.map(h => ({ par: h.par, tees: h.tees, flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z, isTarget: h.flag.isTarget} : null, rangeLinesEnabled: h.rangeLinesEnabled }));"""

new_save = """let dumpHoles = courseHoles.map(h => ({ par: h.par, tees: h.tees, flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z, isTarget: h.flag.isTarget} : null, aimPoint: h.aimPoint || null, rangeLinesEnabled: h.rangeLinesEnabled }));"""

if old_save in c:
    c = c.replace(old_save, new_save)
    changes += 1
    print("12. aimPoint added to save data")
else:
    print("12. FAILED - save data not found")

# === 13. Load aimPoint from saved data ===
# Find the load loop for holes
old_load_flag = """                if(hole.flag) {"""
# Check context to find the right one (in the load function)
idx = c.find('arr.holes.length')
if idx > 0:
    # Find the first 'if(hole.flag)' after arr.holes.length
    load_idx = c.find('if(hole.flag) {', idx)
    if load_idx > 0 and load_idx < idx + 2000:
        # Find the end of the flag loading block (next closing brace at same indent)
        # Let's look at context
        context_start = c.rfind('\n', 0, load_idx)
        context_end = c.find('\n', load_idx + 200)
        print(f"13. Load flag context at pos {load_idx}:\n{c[context_start:context_end]}")

with open(arcade_path, 'w', encoding='utf-8') as f:
    f.write(c)

print(f"\n=== {changes} changes applied ===")
