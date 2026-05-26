import re

with open('c:/Antigravety projekt/3D-Golf-AR/arcade.html', 'r', encoding='utf-8') as f:
    c = f.read()

# Inject HTML
capture_html = '''
    <!-- CAPTURE UI OVERLAY -->
    <div id="capture-ui" style="display:none; position:fixed; bottom:0; left:0; width:100%; height:150px; background:linear-gradient(to top, rgba(0,0,0,0.9), transparent); z-index:9999; flex-direction:column; align-items:center; justify-content:flex-end; padding-bottom:30px; pointer-events:none;">
        <div style="pointer-events:auto; display:flex; flex-direction:column; align-items:center; gap:15px; width:400px; max-width:90%;">
            <div style="width:100%; background:rgba(15,23,42,0.8); backdrop-filter:blur(10px); border-radius:12px; padding:15px; border:1px solid rgba(255,255,255,0.1);">
                <div style="color:#fbbf24; font-size:12px; font-weight:800; margin-bottom:5px; text-transform:uppercase; text-align:center;">Time of Day / Sun Position</div>
                <input type="range" id="capture-time" min="0" max="24" step="0.5" value="12" oninput="if(window.setTimeOfDay) window.setTimeOfDay(parseFloat(this.value));" style="width:100%; accent-color:#fbbf24;">
            </div>
            <button onclick="takeScreenshot()" style="background:#ef4444; color:#fff; border:4px solid #fff; width:70px; height:70px; border-radius:50%; font-weight:bold; font-size:24px; cursor:pointer; box-shadow:0 5px 15px rgba(239,68,68,0.5); transition:transform 0.1s;">??</button>
            <div id="capture-counter" style="color:#fff; font-weight:900; font-size:16px; text-shadow:0 2px 4px rgba(0,0,0,1);">Photos: 0 / 5</div>
        </div>
        <button onclick="endCaptureMode()" style="position:absolute; top:-40px; right:20px; background:#475569; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:bold; cursor:pointer; pointer-events:auto;">Finish Early</button>
    </div>

    <!-- GALLERY MODAL -->
    <div id="gallery-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.95); backdrop-filter:blur(10px); z-index:9999; align-items:center; justify-content:center; flex-direction:column;">
        <h2 style="color:#fff; font-weight:900; font-size:32px; margin-bottom:10px;">SELECT COVER IMAGE</h2>
        <p style="color:#94a3b8; font-size:16px; margin-bottom:30px;">Click the best photo to set as the main cover in the Hub.</p>
        <div id="gallery-container" style="display:flex; flex-wrap:wrap; gap:15px; justify-content:center; max-width:900px; margin-bottom:40px;">
        </div>
        <div style="display:flex; gap:20px;">
            <button onclick="document.getElementById('gallery-modal').style.display='none'; document.getElementById('publish-modal').style.display='flex';" style="background:#475569; color:#fff; border:none; padding:15px 30px; border-radius:12px; font-weight:bold; font-size:18px; cursor:pointer;">Cancel</button>
            <button id="btn-gallery-publish" onclick="finalizePublish()" style="background:#10b981; color:#fff; border:none; padding:15px 30px; border-radius:12px; font-weight:bold; font-size:18px; cursor:pointer; box-shadow:0 10px 20px rgba(16,185,129,0.4);" disabled>PUBLISH NOW</button>
        </div>
    </div>

    <!-- PENALTY DECISION MODAL -->'''

c = c.replace('<!-- PENALTY DECISION MODAL -->', capture_html)

# Inject Javascript
capture_js = '''
    // ============================================================
    // COURSE CAPTURE TOOL
    // ============================================================
    window.capturedPhotos = [];
    window.coverImageIndex = 0;
    
    window.startCaptureMode = function() {
        document.getElementById('publish-modal').style.display = 'none';
        setMode('INSPECT');
        // Hide standard UI components
        document.getElementById('main-ui').style.display = 'none';
        document.getElementById('build-toolbar').style.display = 'none';
        if(document.getElementById('minimap-container')) document.getElementById('minimap-container').style.display = 'none';
        
        window.capturedPhotos = [];
        document.getElementById('capture-counter').innerText = 'Photos: 0 / 5';
        document.getElementById('capture-ui').style.display = 'flex';
    };
    
    window.takeScreenshot = function() {
        let ui = document.getElementById('capture-ui');
        ui.style.display = 'none'; // hide briefly
        
        setTimeout(() => {
            if(window.renderer && window.scene && window.camera) {
                window.renderer.render(window.scene, window.camera);
                // Lower resolution webp to save db space
                let dataUrl = window.renderer.domElement.toDataURL('image/webp', 0.6);
                window.capturedPhotos.push(dataUrl);
            }
            
            document.getElementById('capture-counter').innerText = 'Photos: ' + window.capturedPhotos.length + ' / 5';
            
            if (window.capturedPhotos.length >= 5) {
                endCaptureMode();
            } else {
                ui.style.display = 'flex';
            }
        }, 100);
    };
    
    window.endCaptureMode = function() {
        document.getElementById('capture-ui').style.display = 'none';
        
        // Restore UI
        setMode('BUILD');
        document.getElementById('main-ui').style.display = 'flex';
        // build toolbar will be handled by setMode
        
        if (window.capturedPhotos.length > 0) {
            showGalleryModal();
        } else {
            document.getElementById('publish-modal').style.display = 'flex';
        }
    };
    
    window.showGalleryModal = function() {
        let container = document.getElementById('gallery-container');
        let html = '';
        window.coverImageIndex = 0;
        
        window.capturedPhotos.forEach((img, i) => {
            let border = i === 0 ? 'border: 4px solid #10b981;' : 'border: 4px solid transparent; opacity: 0.5;';
            html += <div onclick="selectCoverImage()" id="gallery-img-" style="width:250px; height:140px; background-image:url(''); background-size:cover; background-position:center; border-radius:12px; cursor:pointer; transition:all 0.2s; "></div>;
        });
        
        container.innerHTML = html;
        document.getElementById('btn-gallery-publish').removeAttribute('disabled');
        document.getElementById('gallery-modal').style.display = 'flex';
    };
    
    window.selectCoverImage = function(index) {
        window.coverImageIndex = index;
        window.capturedPhotos.forEach((img, i) => {
            let el = document.getElementById('gallery-img-' + i);
            if(el) {
                if (i === index) {
                    el.style.border = '4px solid #10b981';
                    el.style.opacity = '1';
                } else {
                    el.style.border = '4px solid transparent';
                    el.style.opacity = '0.5';
                }
            }
        });
    };
    
    window.finalizePublish = function() {
        document.getElementById('gallery-modal').style.display = 'none';
        document.getElementById('publish-modal').style.display = 'flex';
        // Proceed with publish directly (we set a flag to bypass capture requirement)
        window._bypassCapture = true;
        publishCourse({ isDraft: false });
        window._bypassCapture = false;
    };

    window.publishCourse = async function(options = { isDraft: false, overwrite: false }) {'''

c = c.replace('window.publishCourse = async function(options = { isDraft: false, overwrite: false }) {', capture_js)

# Inject Validation Logic
validation_logic = '''        // === CAPTURE REQUIREMENT ===
        if (!options.isDraft && (!window.capturedPhotos || window.capturedPhotos.length === 0) && !window._bypassCapture) {
            document.getElementById('publish-modal').style.display = 'none';
            if (confirm("?? To publish your course, you need to capture showcase photos first.\\n\\nEnter Camera Mode?")) {
                startCaptureMode();
            }
            return;
        }

        // === HOLE INTEGRITY VALIDATION ==='''
c = c.replace('// === HOLE INTEGRITY VALIDATION ===', validation_logic)

# Inject Payload logic
payload_logic = '''            let payload = {
                name: name,
                author: author,
                total_par: totalPar,
                hole_count: holeCount,
                course_data: JSON.stringify({ targets: dumpTargets, holes: dumpHoles }),
                terrain_data: compressedTerrain,
                is_range: (new URLSearchParams(window.location.search)).get('mode') === 'range' || !!window._isRangeMode,
                theme_data: { biomeId: window.ACTIVE_BIOME, config: window.CURRENT_BIOME_CONFIG, particleIntensity: window.ParticleEngine ? window.ParticleEngine.getIntensity() : 0.6, particleSize: window.ParticleEngine ? window.ParticleEngine.getSize() : 1.0, weatherMode: window.ParticleEngine ? window.ParticleEngine.getWeather() : 'CLEAR' },
                owner_id: window.GolfAuth?.userId || null
            };
            
            if (!options.isDraft && window.capturedPhotos && window.capturedPhotos.length > 0) {
                payload.cover_image = window.capturedPhotos[window.coverImageIndex];
                
                // Backup all photos into theme_data so they don't bloat the primary index but are retrievable
                payload.theme_data.gallery = window.capturedPhotos;
            }'''

c = c.replace('''            let payload = {
                name: name,
                author: author,
                total_par: totalPar,
                hole_count: holeCount,
                course_data: JSON.stringify({ targets: dumpTargets, holes: dumpHoles }),
                terrain_data: compressedTerrain,
                is_range: (new URLSearchParams(window.location.search)).get('mode') === 'range' || !!window._isRangeMode,
                theme_data: { biomeId: window.ACTIVE_BIOME, config: window.CURRENT_BIOME_CONFIG, particleIntensity: window.ParticleEngine ? window.ParticleEngine.getIntensity() : 0.6, particleSize: window.ParticleEngine ? window.ParticleEngine.getSize() : 1.0, weatherMode: window.ParticleEngine ? window.ParticleEngine.getWeather() : 'CLEAR' },
                owner_id: window.GolfAuth?.userId || null
            };''', payload_logic)

with open('c:/Antigravety projekt/3D-Golf-AR/arcade.html', 'w', encoding='utf-8') as f:
    f.write(c)

print('Patched arcade.html')
