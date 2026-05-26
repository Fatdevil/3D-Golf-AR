arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

old = """        } else if(currentTool === 'SMART_BUILDER') {
            if(e.button === 0 && lastHitPoint) {
                smartGreenPoints.push(lastHitPoint.clone());"""

new = """        } else if(currentTool === 'SMART_BUILDER') {
            if(window._smartBuildCooldown) { controls.enabled = false; return; }
            if(e.button === 0 && lastHitPoint) {
                smartGreenPoints.push(lastHitPoint.clone());"""

if old in c:
    c = c.replace(old, new)
    with open(arcade_path, 'w', encoding='utf-8') as f:
        f.write(c)
    print("Cooldown guard added to point handler")
else:
    print("Target not found")
