import sys

with open('admin_assets.html', 'r', encoding='utf-8') as f:
    text = f.read()

head_old = '''    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>'''

head_new = '''    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>'''

logic_old = '''        function loadModelFromBase64(b64) {
            const loader = new THREE.GLTFLoader();
            loader.load(b64, function(gltf) {'''

logic_new = '''        function loadModelFromBase64(b64) {
            const dracoLoader = new THREE.DRACOLoader();
            dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');
            const loader = new THREE.GLTFLoader();
            loader.setDRACOLoader(dracoLoader);
            
            loader.load(b64, function(gltf) {'''

if head_old in text and logic_old in text:
    text = text.replace(head_old, head_new)
    text = text.replace(logic_old, logic_new)
    with open('admin_assets.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("PATCHED ADMIN")
else:
    print("OLD LOGIC NOT FOUND")
