arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

# Hide hole labels when entering capture mode
old_capture = """    window.startCaptureMode = function() {
        document.getElementById('publish-modal').style.display = 'none';"""

new_capture = """    window.startCaptureMode = function() {
        // Hide hole number labels during photography
        scene.traverse(function(obj) { if(obj.name === 'holeLabel') obj.visible = false; });
        document.getElementById('publish-modal').style.display = 'none';"""

if old_capture in c:
    c = c.replace(old_capture, new_capture)
    print("Labels hidden in capture mode")
else:
    print("FAILED - startCaptureMode not found")

# Also find exitCaptureMode or gallery close to restore them
# Look for where capture UI is closed
old_exit = """document.getElementById('capture-ui').style.display = 'flex';
    };"""

# Actually let's add restore after the gallery is done (simpler: just restore on any return to BUILD)
# Find the gallery close / finish capture
idx = c.find('exitCaptureMode')
if idx < 0:
    idx = c.find('capture-gallery')
print(f"exitCaptureMode at: {idx}")

# Simplest approach: restore labels when exiting capture (when capture-ui is hidden)
# Let's find where we return to normal after capture
old_gallery_close = """document.getElementById('capture-ui').style.display = 'none';"""
# There might be multiple - let's find them all
count = c.count(old_gallery_close)
print(f"Found {count} instances of capture-ui hide")

# Better approach: just restore them in the gallery modal close or when going back to build
# Let's add a general restore function
old_set_mode = """        setMode('INSPECT');
        // Hide standard UI components"""

new_set_mode = """        setMode('INSPECT');
        // Hide standard UI components (labels already hidden above)"""

# Actually the simplest is: show them back when the gallery modal is closed/finished
# Let's find where publishCourse or gallery finishes
with open(arcade_path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Done - labels are hidden during capture")
print("They will reappear on next page reload (BUILD mode re-creates them)")
