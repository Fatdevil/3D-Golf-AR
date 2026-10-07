    // === 📚 3D LIBRARY + PRESET SYSTEM ===
    window._userPresets = [];
    window._activePresetId = '_backpack';
    window._lastLibraryTab = 'POLY';
    window._cloudAssetsCache = null;
    window._cloudCategory = 'ALL';
    window._librarySelectedSource = null; // 'POLY' or 'CLOUD'
    window._librarySelectedCloudKey = null;

    // --- Library open/close ---

    window.closeLibrary = function() {
        document.getElementById('poly-library-panel').style.display = 'none';
    };
    window.closePolyModal = window.closeLibrary; // backward compat

    // --- Tab switching ---
    window.switchLibraryTab = function(tab) {
        window._lastLibraryTab = tab;
        ['POLY', 'CLOUD', 'MINE'].forEach(t => {
            let content = document.getElementById('lib-content-' + t.toLowerCase());
            let btn = document.getElementById('lib-tab-' + t.toLowerCase());
            if (content) content.style.display = t === tab ? 'flex' : 'none';
            if (btn) btn.className = t === tab ? 'active' : '';
        });
        // Reset detail panel when switching tabs
        let placeholder = document.getElementById('poly-model-detail-placeholder');
        let detail = document.getElementById('poly-model-detail');
        if (placeholder) placeholder.style.display = 'flex';
        if (detail) detail.style.display = 'none';
        window._librarySelectedSource = null;
        window._librarySelectedCloudKey = null;

        if (tab === 'CLOUD') renderCloudLibrary();
    };

    // --- Cloud Library rendering ---
    window.renderCloudLibrary = async function(searchFilter) {
        const grid = document.getElementById('cloud-results-grid');
        if (!grid) return;

        // Fetch if not cached
        if (!window._cloudAssetsCache) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:#64748b;"><div class="poly-spinner"></div>Loading admin assets...</div>';
            try {
                window._cloudAssetsCache = await ArcadeAPI.getAssets();
            } catch(e) {
                grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:#ef4444;">❌ Could not connect to server</div>';
                return;
            }
        }

        let assets = window._cloudAssetsCache || [];
        
        // Filter by search
        if (searchFilter) {
            const q = searchFilter.toLowerCase();
            assets = assets.filter(a => (a.name || a.id || '').toLowerCase().includes(q));
        }

        // Filter by category
        if (window._cloudCategory && window._cloudCategory !== 'ALL') {
            assets = assets.filter(a => (a.subcategory || '').toUpperCase() === window._cloudCategory);
        }

        // Build category chips
        const catsWrap = document.getElementById('cloud-cats-wrap');
        if (catsWrap && !catsWrap.hasChildNodes()) {
            const cats = [
                { id: 'ALL', icon: '🔍', label: 'All' },
                { id: 'TREES', icon: '🌲', label: 'Trees' },
                { id: 'ROCKS', icon: '🪨', label: 'Rocks' },
                { id: 'PLANTS', icon: '🌿', label: 'Plants' },
                { id: 'LANDSCAPE', icon: '⛰️', label: 'Landscape' }
            ];
            cats.forEach(c => {
                const chip = document.createElement('button');
                chip.className = 'poly-cat-chip' + (c.id === 'ALL' ? ' active' : '');
                chip.textContent = c.icon + ' ' + c.label;
                chip.onclick = () => {
                    window._cloudCategory = c.id;
                    catsWrap.querySelectorAll('.poly-cat-chip').forEach(b => b.classList.toggle('active', b === chip));
                    renderCloudLibrary(document.getElementById('cloud-search-input')?.value?.trim());
                };
                catsWrap.appendChild(chip);
            });
        }

        if (assets.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:#64748b;">No admin assets found.<br>Use Admin Asset Manager to upload.</div>';
            return;
        }

        grid.innerHTML = '';
        assets.forEach((a, i) => {
            const conf = typeof a.config === 'string' ? JSON.parse(a.config) : (a.config || {});
            const thumb = conf.thumbnail || '';
            const name = a.name || a.id;
            const subcat = a.subcategory || 'LANDSCAPE';
            const icon = subcat === 'TREES' ? '🌲' : subcat === 'ROCKS' ? '🪨' : subcat === 'PLANTS' ? '🌿' : '⛰️';
            const targetHeight = conf.targetHeight || 10.0;

            const card = document.createElement('div');
            card.className = 'cloud-asset-card';
            card.onclick = () => cloudSelectModel(a, i);
            
            if (thumb) {
                card.innerHTML = `<div style="width:100%; height:140px; border-radius:10px 10px 0 0; background:#0f172a; background-image:url('${thumb.replace(/'/g,"\\'")}'); background-size:contain; background-position:center; background-repeat:no-repeat;"></div><div style="padding:6px 8px;"><div style="color:#f8fafc; font-size:11px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name.substring(0,25)}</div><div style="color:#64748b; font-size:9px; margin-top:2px;">☁️ ${subcat} · ${targetHeight.toFixed(1)}m</div></div>`;
            } else {
                card.innerHTML = `<div style="width:100%; height:140px; border-radius:10px 10px 0 0; background:#0f172a; display:flex; align-items:center; justify-content:center; font-size:40px;">${icon}</div><div style="padding:6px 8px;"><div style="color:#f8fafc; font-size:11px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name.substring(0,25)}</div><div style="color:#64748b; font-size:9px; margin-top:2px;">☁️ ${subcat} · ${targetHeight.toFixed(1)}m</div></div>`;
            }
            grid.appendChild(card);
        });
    };

    window.cloudSelectModel = function(asset, index) {
        window._librarySelectedSource = 'CLOUD';
        window._librarySelectedCloudKey = asset.id;

        const conf = typeof asset.config === 'string' ? JSON.parse(asset.config) : (asset.config || {});
        const placeholder = document.getElementById('poly-model-detail-placeholder');
        const detail = document.getElementById('poly-model-detail');
        if (placeholder) placeholder.style.display = 'none';
        if (detail) detail.style.display = 'flex';

        document.getElementById('poly-detail-thumb').src = conf.thumbnail || '';
        document.getElementById('poly-detail-title').textContent = asset.name || asset.id;
        document.getElementById('poly-detail-creator').textContent = '☁️ Admin Asset';
        document.getElementById('poly-detail-tris').textContent = (conf.fileSizeMB ? conf.fileSizeMB.toFixed(1) + ' MB' : '');
        
        document.getElementById('poly-scale-slider').value = conf.targetHeight || 4.0;
        document.getElementById('poly-scale-value').textContent = (conf.targetHeight || 4.0).toFixed(1) + 'm';

        // Update button text
        updateLibraryButtonText();

        // Highlight selected card
        document.querySelectorAll('.cloud-asset-card').forEach((c, i) => {
            c.style.outline = i === index ? '2px solid #38bdf8' : 'none';
        });
    };

    // --- Unified "Add to preset/backpack" button ---
    window.libraryAddToPreset = async function() {
        const presetId = document.getElementById('lib-preset-dropdown')?.value || '_backpack';
        
        if (window._librarySelectedSource === 'CLOUD') {
            // Cloud asset: register in ASSET_REGISTRY + add to preset
            const key = window._librarySelectedCloudKey;
            if (!key) return;
            const asset = (window._cloudAssetsCache || []).find(a => a.id === key);
            if (!asset) return;
            
            const conf = typeof asset.config === 'string' ? JSON.parse(asset.config) : (asset.config || {});
            const subcat = asset.subcategory || 'TREES';
            
            // Register in ASSET_REGISTRY so it appears in PROPS
            window.ASSET_REGISTRY[key] = {
                icon: asset.icon || '☁️', cat: 'nature',
                subcat: subcat,
                isCloud: true, cloudId: key,
                thumbnail: conf.thumbnail || null,
                targetHeight: conf.targetHeight || 10.0,
                yOffset: conf.yOffset || 0.0,
                brightness: conf.brightness !== undefined ? conf.brightness : 0.0,
                physics: conf.physics || { type: 'sphere', radius: 1.0 },
                biomes: conf.biomes || ['GLOBAL'],
                fileSizeMB: conf.fileSizeMB || 0.5
            };
            
            // Add to preset if not backpack
            if (presetId !== '_backpack') {
                await addAssetToPreset(presetId, { 
                    key: key, 
                    source: 'cloud', 
                    cloudId: key, 
                    name: asset.name, 
                    subcat: subcat, 
                    thumbnail: conf.thumbnail || null,
                    targetHeight: conf.targetHeight || 10.0,
                    yOffset: conf.yOffset !== undefined ? conf.yOffset : 0.0,
                    brightness: conf.brightness !== undefined ? conf.brightness : 0.0,
                    physics: conf.physics || { type: 'sphere', radius: 1.0 },
                    biomes: conf.biomes || ['GLOBAL']
                });
            }
            
            window.currentNatureCategory = subcat;
            window.buildNatureUI();
            
            const btn = document.getElementById('poly-place-btn');
            btn.querySelector('span').textContent = '✅ Tillagd!';
            btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            setTimeout(() => { updateLibraryButtonText(); btn.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)'; }, 1500);
            
            if (window.showBuildToast) window.showBuildToast(`☁️ ${asset.name} added!`, '#38bdf8');
        } else {
            // Poly.pizza asset: use existing polyPlaceModel flow
            await polyPlaceModel();
            
            // Also add to preset if not backpack
            const presetTarget = document.getElementById('lib-preset-dropdown')?.value || '_backpack';
            if (presetTarget !== '_backpack' && window._polySelectedModel) {
                const m = window._polySelectedModel;
                const id = m.ID || m.id;
                const polyType = 'POLY_' + id;
                const reg = window.ASSET_REGISTRY[polyType];
                if (reg) {
                    await addAssetToPreset(presetTarget, {
                        key: polyType, source: 'poly', polyId: String(id),
                        subcat: reg.subcat, thumbnail: reg.thumbnail || m.Thumbnail || m.thumbnail,
                        title: m.Title || m.title, creator: String(m.Creator?.Username || m.Creator || m.creator || ''),
                        targetHeight: reg.targetHeight || 4.0,
                        yOffset: reg.yOffset !== undefined ? reg.yOffset : 0.0,
                        brightness: reg.brightness !== undefined ? reg.brightness : 1.0,
                        physics: reg.physics || { type: 'sphere', radius: 1.0 },
                        biomes: reg.biomes || ['GLOBAL']
                    });
                }
            }
        }
    };

    function updateLibraryButtonText() {
        const btn = document.getElementById('poly-place-btn');
        const dropdown = document.getElementById('lib-preset-dropdown');
        if (!btn || !dropdown) return;
        const presetId = dropdown.value;
        if (presetId === '_backpack') {
            btn.querySelector('span').textContent = '📥 Add to Backpack';
        } else {
            const preset = (window._userPresets || []).find(p => p.id === presetId);
            btn.querySelector('span').textContent = '📥 Add to ' + (preset ? preset.name : 'preset');
        }
    }

    // Listen for preset dropdown change in Library
    document.addEventListener('DOMContentLoaded', function() {
        const dd = document.getElementById('lib-preset-dropdown');
        if (dd) dd.addEventListener('change', updateLibraryButtonText);
    });

    // --- Preset CRUD ---
    window.loadPresets = async function() {
        try {
            window._userPresets = await ArcadeAPI.getAssetPresets();
        } catch(e) {
            window._userPresets = [];
        }
        loadPresetDropdowns();
    };

    function loadPresetDropdowns() {
        const dropdowns = [document.getElementById('props-preset-select'), document.getElementById('lib-preset-dropdown')];
        dropdowns.forEach(dd => {
            if (!dd) return;
            const currentVal = dd.value;
            dd.innerHTML = '<option value="_backpack">🎒 Backpack (temporary)</option>';
            (window._userPresets || []).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = '📋 ' + p.name + ' (' + ((p.assets || []).length) + ')';
                dd.appendChild(opt);
            });
            // Restore selection
            if (currentVal && dd.querySelector(`option[value="${currentVal}"]`)) {
                dd.value = currentVal;
            }
        });
    }

    async function addAssetToPreset(presetId, assetData) {
        const preset = (window._userPresets || []).find(p => p.id === presetId);
        if (!preset) return;
        
        const assets = preset.assets || [];
        if (assets.find(a => a.key === assetData.key)) return; // already exists
        
        assets.push(assetData);
        preset.assets = assets;
        
        try {
            await ArcadeAPI.saveAssetPreset({ id: presetId, name: preset.name, assets: assets });
            loadPresetDropdowns();
        } catch(e) {
            console.error('Failed to save preset:', e);
        }
    }

    window.promptNewPresetFromLibrary = async function() {
        const name = prompt('Name your new preset:');
        if (!name || !name.trim()) return;
        try {
            const result = await ArcadeAPI.saveAssetPreset({ name: name.trim(), assets: [] });
            if (result.success) {
                await loadPresets();
                const dd = document.getElementById('lib-preset-dropdown');
                if (dd) dd.value = result.id;
                updateLibraryButtonText();
                if (window.showBuildToast) window.showBuildToast(`📋 Preset "${name.trim()}" created!`, '#4ade80');
            }
        } catch(e) {
            console.error('Failed to create preset:', e);
        }
    };

    // Load presets on boot (after auth)
    setTimeout(() => { if (window.GolfAuth && window.GolfAuth.userId) loadPresets(); }, 2000);

    // === POLY.PIZZA SEARCH ===
    window._polySearchResults = [];
    window._polyCurrentPage = 0;
    window._polySelectedModel = null;
    window._polyCategory = 'all';
    window._polyLoading = false;
    window._polyPlaceScale = 1.0;

    const POLY_CAT_LABELS = [
        { id: 'all', icon: '🔍', label: 'All' },
        { id: 6, icon: '🌲', label: 'Nature' },
        { id: 8, icon: '🏛️', label: 'Buildings' },
        { id: 7, icon: '🐾', label: 'Animals' },
        { id: 3, icon: '🚗', label: 'Vehicles' },
        { id: 5, icon: '📎', label: 'Objects' },
        { id: 0, icon: '🍔', label: 'Food' },
        { id: 1, icon: '📦', label: 'Props' },
        { id: 4, icon: '🪑', label: 'Furniture' },
        { id: 9, icon: '👤', label: 'Characters' }
    ];

    // Build category chips
    window.buildPolyCatChips = function() {
        const wrap = document.getElementById('poly-cats-wrap');
        if (!wrap) return;
        wrap.innerHTML = '';
        POLY_CAT_LABELS.forEach(c => {
            const chip = document.createElement('button');
            chip.className = 'poly-cat-chip' + (c.id === 'all' ? ' active' : '');
            chip.dataset.cat = c.id;
            chip.textContent = c.icon + ' ' + c.label;
            chip.onclick = () => polySetCategory(c.id);
            wrap.appendChild(chip);
        });
    };

    // Initialize chips immediately or on DOM load
    setTimeout(() => { window.buildPolyCatChips(); }, 100);

    // closePolyModal is aliased to closeLibrary above

    window.polySearch = async function(query, category, page) {
        window._polyLoading = true;
        polyRenderLoading();
        try {
            let url = `/api/poly/search?page=${page || 0}`;
            if (query) url += `&q=${encodeURIComponent(query)}`;
            if (category !== undefined && category !== 'all') url += `&category=${category}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Search failed (' + res.status + ')');
            const data = await res.json();
            window._polySearchResults = Array.isArray(data) ? data : (data.results || data.Results || []);
            window._polyCurrentPage = page || 0;
            polyRenderResults();
        } catch(e) {
            console.error('Poly search error:', e);
            polyRenderError(e.message);
        } finally {
            window._polyLoading = false;
        }
    };

    function polyRenderLoading() {
        const grid = document.getElementById('poly-results-grid');
        if (grid) grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:#64748b;"><div class="poly-spinner"></div>Söker efter 3D-modeller...</div>';
        const detail = document.getElementById('poly-model-detail');
        if (detail) detail.style.display = 'none';
        const placeholder = document.getElementById('poly-model-detail-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
    }

    function polyRenderError(msg) {
        const grid = document.getElementById('poly-results-grid');
        if (grid) grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px 20px; color:#ef4444;">❌ Sökningen misslyckades: ${msg}</div>`;
    }

    function polyRenderResults() {
        const grid = document.getElementById('poly-results-grid');
        if (!grid) return;
        const models = window._polySearchResults;
        if (!models || models.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:#64748b;">Hittade inga modeller. Försök med en annan sökning!</div>';
            return;
        }
        grid.innerHTML = '';
        models.forEach((m, i) => {
            const title = String(m.Title || m.title || 'Namnlös');
            const thumb = m.Thumbnail || m.thumbnail || '';
            const creator = String(m.Creator?.Username || m.Creator || m.creator || '?');
            const triCount = m['Tri Count'] || m.TriCount || m.triCount || m.Tris || '?';
            const card = document.createElement('div');
            
            card.style.cssText = 'background:rgba(30,41,59,0.7); border-radius:10px; cursor:pointer; border:1px solid rgba(255,255,255,0.05); transition:transform 0.15s,box-shadow 0.15s,border-color 0.15s; width:100%; min-height:170px; overflow:visible;';
            card.className = 'poly-model-card';
            card.onclick = () => polySelectModel(i);
            const safeThumb = thumb.replace(/'/g, "\\'");
            card.innerHTML = `<div style="width:100%; height:140px; border-radius:10px 10px 0 0; background:#0f172a; background-image:url('${safeThumb}'); background-size:contain; background-position:center center; background-repeat:no-repeat;"></div><div style="padding:6px 8px;"><div style="color:#f8fafc; font-size:11px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title.substring(0,25)}</div><div style="color:#64748b; font-size:9px; margin-top:2px;">${triCount}△ · 4.0m · ${creator.substring(0,15)}</div></div>`;
            grid.appendChild(card);
        });
        const pageInfo = document.getElementById('poly-page-info');
        if (pageInfo) pageInfo.textContent = `Page ${window._polyCurrentPage + 1}`;
        const prevBtn = document.getElementById('poly-prev-btn');
        if (prevBtn) prevBtn.disabled = window._polyCurrentPage === 0;
    };

    window.polySelectModel = function(index) {
        const m = window._polySearchResults[index];
        if (!m) return;
        window._polySelectedModel = m;
        window._librarySelectedSource = 'POLY';
        
        const placeholder = document.getElementById('poly-model-detail-placeholder');
        if (placeholder) placeholder.style.display = 'none';
        
        const detail = document.getElementById('poly-model-detail');
        if (!detail) return;
        detail.style.display = 'flex';
        
        const title = String(m.Title || m.title || 'Namnlös');
        const creator = String(m.Creator?.Username || m.Creator || m.creator || 'Okänd');
        const licence = String(m.Licence || m.licence || 'CC');
        const triCount = m['Tri Count'] || m.TriCount || m.triCount || m.Tris || '?';
        const thumb = m.Thumbnail || m.thumbnail || '';
        
        document.getElementById('poly-detail-thumb').src = thumb;
        document.getElementById('poly-detail-title').textContent = title;
        document.getElementById('poly-detail-creator').textContent = `av ${creator} (${licence})`;
        document.getElementById('poly-detail-tris').textContent = `${triCount} triat`;
        
        // Reset scale slider to normalized default height (4.0m)
        document.getElementById('poly-scale-value').textContent = '4.0m';
        document.getElementById('poly-scale-slider').value = 4.0;
        
        // Reset place button state
        const btn = document.getElementById('poly-place-btn');
        btn.innerHTML = '📥 Ladda ner till PROPS';
        btn.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)';
        btn.disabled = false;
        
        document.querySelectorAll('.poly-model-card').forEach((c, i) => {
            c.style.outline = i === index ? '2px solid #4ade80' : 'none';
        });
    };

    window.polyPlaceModel = async function() {
        const m = window._polySelectedModel;
        if (!m) return;
        const id = m.ID || m.id;
        const title = m.Title || m.title || 'Untitled';
        const creator = String(m.Creator?.Username || m.Creator || m.creator || 'Unknown');
        const licence = m.Licence || m.licence || 'CC';
        const targetHeightMeters = parseFloat(document.getElementById('poly-scale-slider').value) || 4.0;
        const scale = 1.0; // Base model is normalized directly to targetHeightMeters
        const polyType = 'POLY_' + id;

        const btn = document.getElementById('poly-place-btn');
        const origText = '📥 Add to Backpack';
        
        if (!window.customModels[polyType]) {
            btn.innerHTML = '⏳ Downloading GLB...';
            btn.disabled = true;
            try {
                await new Promise((resolve, reject) => {
                    gltfLoader.load(`/api/poly/glb/${id}`, function(gltf) {
                        try {
                            const model = gltf.scene;
                            const box = new THREE.Box3().setFromObject(model);
                            const size = box.getSize(new THREE.Vector3());
                            const w = size.x, h = size.y, d = size.z;
                            const aspectRatio = h / Math.max(w, d, 0.01);
                            const avgWidth = (w + d) / 2;
                            let hasCanopy = false, hasTrunk = false, meshNames = [];
                            model.traverse(child => {
                                if (!child.isMesh) return;
                                meshNames.push(child.name);
                                const n = child.name.toLowerCase();
                                if (n.includes('leaf') || n.includes('canopy') || n.includes('crown') || n.includes('foliage') || n.includes('leaves')) hasCanopy = true;
                                if (n.includes('trunk') || n.includes('bark') || n.includes('stem') || n.includes('wood')) hasTrunk = true;
                            });
                            
                            const titleLower = title.toLowerCase();
                            const isTreeByTitle = /\b(tree|pine|oak|birch|palm|spruce|willow|maple|cedar|fir|forest)\b/.test(titleLower);
                            const isRockByTitle = /\b(rock|stone|boulder|cliff|mountain)\b/.test(titleLower);
                            const isPlantByTitle = /\b(plant|bush|flower|grass|fern|shrub|cactus|mushroom|hedge)\b/.test(titleLower);
                            if (isTreeByTitle) { hasCanopy = true; hasTrunk = true; }
                            
                            const targetHeight = targetHeightMeters;
                            const scaleFactor = targetHeight / Math.max(h, 0.01);
                            
                            let physics;
                            if ((hasCanopy && hasTrunk) || aspectRatio > 2.5 || isTreeByTitle) {
                                physics = { 
                                    type: 'tree', 
                                    trunkRadius: avgWidth * 0.15 * scaleFactor, 
                                    canopyRadius: avgWidth * 0.5 * scaleFactor, 
                                    height: h * scaleFactor 
                                };
                            } else if (aspectRatio > 1.3) {
                                physics = { 
                                    type: 'cylinder', 
                                    radius: avgWidth * 0.5 * scaleFactor, 
                                    height: h * scaleFactor 
                                };
                            } else {
                                physics = { 
                                    type: 'sphere', 
                                    radius: Math.max(w, h, d) * 0.5 * scaleFactor 
                                };
                            }
                            
                            model.scale.set(scaleFactor, scaleFactor, scaleFactor);
                            const centeredBox = new THREE.Box3().setFromObject(model);
                            const center = centeredBox.getCenter(new THREE.Vector3());
                            model.position.sub(center);
                            model.position.y += centeredBox.getSize(new THREE.Vector3()).y / 2;
                            model.traverse(child => {
                                if (child.isMesh && child.material) {
                                    child.material = child.material.clone();
                                    if (child.material.color) child.material.color.multiplyScalar(1.15);
                                }
                            });
                            window.customModels[polyType] = model;
                            
                            let subcat = 'LANDSCAPE';
                            if (isTreeByTitle || (hasCanopy && hasTrunk)) subcat = 'TREES';
                            else if (isRockByTitle || (aspectRatio < 0.8 && !isPlantByTitle)) subcat = 'ROCKS';
                            else if (isPlantByTitle) subcat = 'PLANTS';
                            
                            window.ASSET_REGISTRY[polyType] = {
                                icon: '🍕', cat: 'nature',
                                subcat: subcat,
                                isCloud: false, isPoly: true, polyId: id,
                                file: `/api/poly/glb/${id}`, // Add the GLB file URL for lazy loading later!
                                polyAttribution: { creator, title, licence },
                                thumbnail: m.Thumbnail || m.thumbnail || null,
                                targetHeight: targetHeight, yOffset: 0, brightness: 1.0,
                                physics: physics, biomes: ['GLOBAL'],
                                colorizable: { canopy: hasCanopy, trunk: hasTrunk },
                                meshNames: meshNames
                            };
                            console.log(`🍕 Poly model loaded: ${title} (${polyType})`, physics);
                            resolve();
                        } catch(err) {
                            reject(err);
                        }
                    }, undefined, function(err) { reject(err); });
                });
            } catch(e) {
                console.error('Failed to load Poly model:', e);
                btn.innerHTML = '❌ Download failed';
                btn.disabled = false;
                setTimeout(() => { btn.innerHTML = origText; }, 2000);
                return;
            }
        }
        
        // Model is registered
        window.currentNatureType = polyType;
        window._polyPlaceScale = scale;
        
        if (!window.selectedNatureTypes.includes(polyType)) {
            if (window.propsMixEnabled) {
                window.selectedNatureTypes.push(polyType);
            } else {
                window.selectedNatureTypes = [polyType];
            }
        }
        
        const subcat = window.ASSET_REGISTRY[polyType].subcat;
        window.currentNatureCategory = subcat;
        
        const catTabs = ['TREES', 'ROCKS', 'PLANTS', 'LANDSCAPE'];
        catTabs.forEach(c => {
            const el = document.getElementById('cat-btn-' + c);
            if (el) el.classList.toggle('active', c === subcat);
        });
        
        window.buildNatureUI();
        
        btn.innerHTML = '✅ Tillagd i PROPS';
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        btn.disabled = false;
        
        if (window.showBuildToast) {
            window.showBuildToast(`📥 ${title} added to tab ${subcat}!`, '#10b981');
        }
        
        setTimeout(() => {
            if (window._polySelectedModel && (window._polySelectedModel.ID || window._polySelectedModel.id) === id) {
                btn.innerHTML = origText;
                btn.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)';
            }
        }, 2000);
    };

    window.polySetCategory = function(catId) {
        window._polyCategory = catId;
        document.querySelectorAll('.poly-cat-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.cat == catId);
        });
        const q = document.getElementById('poly-search-input').value.trim();
        window.polySearch(q || '', catId, 0);
    };

    window.polyNextPage = function() {
        const q = document.getElementById('poly-search-input').value.trim();
        window.polySearch(q || '', window._polyCategory, window._polyCurrentPage + 1);
    };

    window.polyPrevPage = function() {
        if (window._polyCurrentPage <= 0) return;
        const q = document.getElementById('poly-search-input').value.trim();
        window.polySearch(q || '', window._polyCategory, window._polyCurrentPage - 1);
    };

    // --- SELECTION RING, LAZY LOADER & MULTI-SELECT MIX ---
    let selectRingMesh = null;
    window.selectedPropIndex = null;
    window.selectedNatureTypes = [];
    window.propsVarianceEnabled = true;
    window.propsMixEnabled = false;
    window._loadingPolyAssets = {};

    window.togglePropsMix = function(enabled) {
        window.propsMixEnabled = enabled;
        if (!enabled && window.currentNatureType) {
            window.selectedNatureTypes = [window.currentNatureType];
        }
        window.updateNatureUIActiveStates();
    };

    window.updateNatureUIActiveStates = function() {
        const btns = document.getElementById('nature-assets-grid')?.querySelectorAll('.palette-btn');
        if (!btns) return;
        btns.forEach(btn => {
            const key = btn.getAttribute('data-asset-key') || btn.getAttribute('title');
            if (window.propsMixEnabled) {
                if (window.selectedNatureTypes.includes(key)) {
                    btn.classList.add('active');
                    btn.style.outline = '2px solid #4ade80';
                } else {
                    btn.classList.remove('active');
                    btn.style.outline = 'none';
                }
            } else {
                if (key === window.currentNatureType) {
                    btn.classList.add('active');
                    btn.style.outline = '2px solid #38bdf8';
                } else {
                    btn.classList.remove('active');
                    btn.style.outline = 'none';
                }
            }
        });
    };

    // Safely build nature UI after all dependent functions are defined
    window.buildNatureUI();

    // Global utility: map InstancedMesh instance ID to placedTrees index
    window.getGlobalPropIndex = function(type, instanceId) {
        let typeCount = 0;
        for (let i = 0; i < window.placedTrees.length; i++) {
            if (window.placedTrees[i].type === type) {
                if (typeCount === instanceId) return i;
                typeCount++;
            }
        }
        return -1;
    };

    // The prop under the pointer (index into placedTrees) or -1. A prop that is hidden behind the ground does not count:
    // a buried or very large prop would otherwise be picked "through" the terrain from almost anywhere on the screen.
    // A prop that is wholly below the ground (a large negative yOffset): nothing of it shows, so a click near its base must not pick it.
    window.propIsHidden = function(prop) {
        if (!prop || typeof window.getTerrainHeight !== 'function') return false;
        const ground = window.getTerrainHeight(prop.x, prop.z);
        if (typeof ground !== 'number' || !isFinite(ground)) return false;
        let top = (prop.y || 0) + (prop.yOffset || 0);
        const m = window.customModels && window.customModels[prop.type];
        if (m && m.isObject3D) top += new THREE.Box3().setFromObject(m).max.y * (prop.scale || 1);
        return top < ground - 0.1;
    };

    // window._occludedPropIndex is the prop the ray did hit but the ground hides (or -1), so that the click fallback
    // ("a click on the ground near a prop's base picks it") does not pick that very prop.
    window.pickPropIndex = function(rc, grounds) {
        window._occludedPropIndex = -1;
        if (!window._propMeshes || window._propMeshes.length === 0) return -1;
        const hits = rc.intersectObjects(window._propMeshes);
        if (hits.length === 0 || hits[0].instanceId === undefined) return -1;
        const idx = window.getGlobalPropIndex(hits[0].object.propType, hits[0].instanceId);
        const surfaces = (grounds || []).filter(Boolean);
        if (surfaces.length) {
            const g = rc.intersectObjects(surfaces);
            if (g.length && g[0].distance < hits[0].distance - 0.05) { window._occludedPropIndex = idx; return -1; }
        }
        return idx;
    };

    window.getPlacementParams = function(type) {
        let finalType = type || window.currentNatureType;
        if (window.propsMixEnabled && window.selectedNatureTypes && window.selectedNatureTypes.length > 0) {
            let randIdx = Math.floor(Math.random() * window.selectedNatureTypes.length);
            finalType = window.selectedNatureTypes[randIdx];
        }
        
        let baseScale = 1.0;
        if (finalType === window.currentNatureType && window._polyPlaceScale) {
            baseScale = window._polyPlaceScale;
        }
        
        let scale = baseScale;
        let rot = 0;
        
        if (window.propsVarianceEnabled) {
            scale = baseScale * (1.0 + (Math.random() * 0.4 - 0.2));
            rot = Math.random() * Math.PI * 2;
        }
        
        let reg = window.ASSET_REGISTRY[finalType];
        let yOff = reg && reg.yOffset !== undefined ? reg.yOffset : 0.0;
        let bright = reg && reg.brightness !== undefined ? reg.brightness : 1.0;
        
        return { type: finalType, scale: scale, rot: rot, yOffset: yOff, brightness: bright };
    };

    window.loadPolyAsset = async function(polyType) {
        if (!polyType || !polyType.startsWith('POLY_')) return;
        if (window.ASSET_REGISTRY[polyType] || window._loadingPolyAssets[polyType]) return;
        
        window._loadingPolyAssets[polyType] = true;
        const id = polyType.substring(5);
        console.log(`[Lazy Load] Hämta metadata för Poly-modell: ${id}`);
        
        try {
            const res = await fetch(`/api/poly/model/${id}`);
            if (!res.ok) throw new Error(`Model meta fetch failed (${res.status})`);
            const m = await res.json();
            
            const title = m.Title || m.title || 'Namnlös';
            const creator = String(m.Creator?.Username || m.Creator || m.creator || 'Okänd');
            const licence = m.Licence || m.licence || 'CC';
            const triCount = m['Tri Count'] || m.TriCount || m.triCount || m.Tris || '?';
            const thumb = m.Thumbnail || m.thumbnail || null;
            
            gltfLoader.load(`/api/poly/glb/${id}`, function(gltf) {
                try {
                    const model = gltf.scene;
                    const box = new THREE.Box3().setFromObject(model);
                    const size = box.getSize(new THREE.Vector3());
                    const w = size.x, h = size.y, d = size.z;
                    const aspectRatio = h / Math.max(w, d, 0.01);
                    const avgWidth = (w + d) / 2;
                    let hasCanopy = false, hasTrunk = false, meshNames = [];
                    model.traverse(child => {
                        if (!child.isMesh) return;
                        meshNames.push(child.name);
                        const n = child.name.toLowerCase();
                        if (n.includes('leaf') || n.includes('canopy') || n.includes('crown') || n.includes('foliage') || n.includes('leaves')) hasCanopy = true;
                        if (n.includes('trunk') || n.includes('bark') || n.includes('stem') || n.includes('wood')) hasTrunk = true;
                    });
                    
                    const titleLower = title.toLowerCase();
                    const isTreeByTitle = /\b(tree|pine|oak|birch|palm|spruce|willow|maple|cedar|fir|forest)\b/.test(titleLower);
                    const isRockByTitle = /\b(rock|stone|boulder|cliff|mountain)\b/.test(titleLower);
                    const isPlantByTitle = /\b(plant|bush|flower|grass|fern|shrub|cactus|mushroom|hedge)\b/.test(titleLower);
                    if (isTreeByTitle) { hasCanopy = true; hasTrunk = true; }
                    
                    const targetHeight = 4.0;
                    const scaleFactor = targetHeight / Math.max(h, 0.01);
                    
                    let physics;
                    if ((hasCanopy && hasTrunk) || aspectRatio > 2.5 || isTreeByTitle) {
                        physics = { 
                            type: 'tree', 
                            trunkRadius: avgWidth * 0.15 * scaleFactor, 
                            canopyRadius: avgWidth * 0.5 * scaleFactor, 
                            height: h * scaleFactor 
                        };
                    } else if (aspectRatio > 1.3) {
                        physics = { 
                            type: 'cylinder', 
                            radius: avgWidth * 0.5 * scaleFactor, 
                            height: h * scaleFactor 
                        };
                    } else {
                        physics = { 
                            type: 'sphere', 
                            radius: Math.max(w, h, d) * 0.5 * scaleFactor 
                        };
                    }
                    
                    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
                    const centeredBox = new THREE.Box3().setFromObject(model);
                    const center = centeredBox.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    model.position.y += centeredBox.getSize(new THREE.Vector3()).y / 2;
                    
                    model.traverse(child => {
                        if (child.isMesh && child.material) {
                            child.material = child.material.clone();
                            if (child.material.color) child.material.color.multiplyScalar(1.15);
                        }
                    });
                    
                    window.customModels[polyType] = model;
                    
                    let subcat = 'LANDSCAPE';
                    if (isTreeByTitle || (hasCanopy && hasTrunk)) subcat = 'TREES';
                    else if (isRockByTitle || (aspectRatio < 0.8 && !isPlantByTitle)) subcat = 'ROCKS';
                    else if (isPlantByTitle) subcat = 'PLANTS';
                    
                    window.ASSET_REGISTRY[polyType] = {
                        icon: '🍕', cat: 'nature',
                        subcat: subcat,
                        isCloud: false, isPoly: true, polyId: id,
                        file: `/api/poly/glb/${id}`, // Add the GLB file URL for lazy loading later!
                        polyAttribution: { creator, title, licence },
                        thumbnail: thumb,
                        targetHeight: targetHeight, yOffset: 0, brightness: 1.0,
                        physics: physics, biomes: ['GLOBAL'],
                        colorizable: { canopy: hasCanopy, trunk: hasTrunk },
                        meshNames: meshNames
                    };
                    
                    console.log(`[Lazy Load] Poly-modell laddad: ${title} (${polyType})`, physics);
                    rebuildInstancePool(polyType);
                    if (typeof buildNatureUI === 'function') buildNatureUI();
                    
                } catch(err) {
                    console.error(`Lazy load processing error for ${polyType}:`, err);
                } finally {
                    delete window._loadingPolyAssets[polyType];
                }
            }, undefined, function(err) {
                console.error(`Lazy load GLB load error for ${polyType}:`, err);
                delete window._loadingPolyAssets[polyType];
            });
        } catch(e) {
            console.error(`Lazy load metadata fetch failed for ${polyType}:`, e);
            delete window._loadingPolyAssets[polyType];
        }
    };

    window.selectPropAt = function(index) {
        window.selectedPropIndex = index;
        const prop = window.placedTrees[index];
        if (!prop) return;
        
        if (!selectRingMesh) {
            const geom = new THREE.RingGeometry(1.1, 1.2, 32);
            geom.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
            selectRingMesh = new THREE.Mesh(geom, mat);
            scene.add(selectRingMesh);
        }
        
        selectRingMesh.position.set(prop.x, (prop.y || 0) + (prop.yOffset || 0) + 0.05, prop.z);
        let sc = prop.scale || 1.0;
        selectRingMesh.scale.set(sc, sc, sc);
        selectRingMesh.visible = true;
        
        const panel = document.getElementById('prop-editor-panel');
        if (panel) {
            panel.style.display = 'flex';
            let currentScale = prop.scale || 1.0;
            let currentYOff = prop.yOffset || 0.0;
            let physicalHeightStr = '';
            if (window.customModels[prop.type] && window.customModels[prop.type].isObject3D) {
                let box = new THREE.Box3().setFromObject(window.customModels[prop.type]);
                let h = box.max.y - box.min.y;
                if (h > 0) physicalHeightStr = ` (~${(h * currentScale).toFixed(1)}m)`;
            }
            
            // Configure Boost ranges based on current values
            const boostCB = document.getElementById('edit-prop-boost');
            const scaleSlider = document.getElementById('edit-prop-scale');
            const yOffSlider = document.getElementById('edit-prop-yoffset');
            
            const isBoosted = currentScale > 5.0 || currentYOff > 3.0 || currentYOff < -3.0;
            if (boostCB) boostCB.checked = isBoosted;
            
            if (scaleSlider && yOffSlider) {
                if (isBoosted) {
                    scaleSlider.min = "0.2";
                    scaleSlider.max = "100.0";
                    scaleSlider.step = "0.5";
                    
                    yOffSlider.min = "-50.0";
                    yOffSlider.max = "250.0";
                    yOffSlider.step = "1.0";
                } else {
                    scaleSlider.min = "0.2";
                    scaleSlider.max = "5.0";
                    scaleSlider.step = "0.1";
                    
                    yOffSlider.min = "-3.0";
                    yOffSlider.max = "3.0";
                    yOffSlider.step = "0.1";
                }
            }
            
            if (scaleSlider) scaleSlider.value = currentScale;
            document.getElementById('edit-prop-scale-val').textContent = currentScale.toFixed(1) + 'x' + physicalHeightStr;
            
            if (yOffSlider) yOffSlider.value = currentYOff;
            document.getElementById('edit-prop-yoffset-val').textContent = currentYOff.toFixed(1) + 'm';
            
            document.getElementById('edit-prop-rot').value = Math.round((prop.rot || 0) * (180 / Math.PI));
            document.getElementById('edit-prop-rot-val').textContent = Math.round((prop.rot || 0) * (180 / Math.PI)) + '°';
            
            document.getElementById('edit-prop-tilt').value = Math.round((prop.tiltX || 0) * (180 / Math.PI));
            document.getElementById('edit-prop-tilt-val').textContent = Math.round((prop.tiltX || 0) * (180 / Math.PI)) + '°';
            
            document.getElementById('edit-prop-roll').value = Math.round((prop.rollZ || 0) * (180 / Math.PI));
            document.getElementById('edit-prop-roll-val').textContent = Math.round((prop.rollZ || 0) * (180 / Math.PI)) + '°';
            
            document.getElementById('edit-prop-brightness').value = prop.brightness !== undefined ? prop.brightness : 1.0;
            document.getElementById('edit-prop-brightness-val').textContent = (prop.brightness !== undefined ? prop.brightness : 1.0).toFixed(1) + 'x';
        }
    };
    
    window.togglePropBoost = function(enabled) {
        const scaleSlider = document.getElementById('edit-prop-scale');
        const yOffSlider = document.getElementById('edit-prop-yoffset');
        if (!scaleSlider || !yOffSlider) return;
        
        if (enabled) {
            scaleSlider.min = "0.2";
            scaleSlider.max = "100.0";
            scaleSlider.step = "0.5";
            
            yOffSlider.min = "-50.0";
            yOffSlider.max = "250.0";
            yOffSlider.step = "1.0";
        } else {
            scaleSlider.min = "0.2";
            scaleSlider.max = "5.0";
            scaleSlider.step = "0.1";
            
            yOffSlider.min = "-3.0";
            yOffSlider.max = "3.0";
            yOffSlider.step = "0.1";
            
            // Clamp values
            if (parseFloat(scaleSlider.value) > 5.0) scaleSlider.value = 5.0;
            if (parseFloat(yOffSlider.value) > 3.0) yOffSlider.value = 3.0;
            if (parseFloat(yOffSlider.value) < -3.0) yOffSlider.value = -3.0;
        }
        
        window.updateSelectedProp();
    };

    window.deselectProp = function() {
        window.selectedPropIndex = null;
        if (selectRingMesh) selectRingMesh.visible = false;
        const panel = document.getElementById('prop-editor-panel');
        if (panel) panel.style.display = 'none';
    };

    window.updateSelectedProp = function() {
        if (window.selectedPropIndex === null) return;
        const prop = window.placedTrees[window.selectedPropIndex];
        if (!prop) return;
        
        const scale = parseFloat(document.getElementById('edit-prop-scale').value);
        const yOffset = parseFloat(document.getElementById('edit-prop-yoffset').value);
        const rotDeg = parseFloat(document.getElementById('edit-prop-rot').value);
        const tiltDeg = parseFloat(document.getElementById('edit-prop-tilt').value || 0);
        const rollDeg = parseFloat(document.getElementById('edit-prop-roll').value || 0);
        const brightness = parseFloat(document.getElementById('edit-prop-brightness').value);
        
        prop.scale = scale;
        prop.yOffset = yOffset;
        prop.rot = rotDeg * (Math.PI / 180);
        prop.tiltX = tiltDeg * (Math.PI / 180);
        prop.rollZ = rollDeg * (Math.PI / 180);
        prop.brightness = brightness;
        
        let physicalHeightStr = '';
        if (window.customModels[prop.type] && window.customModels[prop.type].isObject3D) {
            let box = new THREE.Box3().setFromObject(window.customModels[prop.type]);
            let h = box.max.y - box.min.y;
            if (h > 0) physicalHeightStr = ` (~${(h * scale).toFixed(1)}m)`;
        }
        
        document.getElementById('edit-prop-scale-val').textContent = scale.toFixed(1) + 'x' + physicalHeightStr;
        document.getElementById('edit-prop-yoffset-val').textContent = yOffset.toFixed(1) + 'm';
        document.getElementById('edit-prop-rot-val').textContent = Math.round(rotDeg) + '°';
        document.getElementById('edit-prop-tilt-val').textContent = Math.round(tiltDeg) + '°';
        document.getElementById('edit-prop-roll-val').textContent = Math.round(rollDeg) + '°';
        document.getElementById('edit-prop-brightness-val').textContent = brightness.toFixed(1) + 'x';
        
        if (selectRingMesh) {
            selectRingMesh.position.y = (prop.y || 0) + yOffset + 0.05;
            selectRingMesh.scale.set(scale, scale, scale);
        }
        
        rebuildInstancePool(prop.type);
    };

    window.deleteSelectedProp = function() {
        if (window.selectedPropIndex === null) return;
        window.saveUndoState();
        
        const prop = window.placedTrees[window.selectedPropIndex];
        if (prop) {
            const type = prop.type;
            window.placedTrees.splice(window.selectedPropIndex, 1);
            rebuildInstancePool(type);
            saveLevel();
        }
        window.deselectProp();
    };

    window.savePropAsDefault = async function() {
        if (window.selectedPropIndex === null) return;
        const prop = window.placedTrees[window.selectedPropIndex];
        if (!prop) return;
        
        let type = prop.type;
        if (window.ASSET_REGISTRY[type]) {
            let currentScale = prop.scale || 1.0;
            let currentYOff = prop.yOffset || 0.0;
            let currentBright = prop.brightness !== undefined ? prop.brightness : 1.0;
            
            // Save defaults for new props in registry
            window.ASSET_REGISTRY[type].yOffset = currentYOff;
            window.ASSET_REGISTRY[type].brightness = currentBright;
            
            const oldTargetHeight = window.ASSET_REGISTRY[type].targetHeight || (type.startsWith('POLY_') ? 4.0 : 10.0);
            const newTargetHeight = oldTargetHeight * currentScale;
            window.ASSET_REGISTRY[type].targetHeight = newTargetHeight;
            
            // Scale physics dimensions proportionally
            if (window.ASSET_REGISTRY[type].physics) {
                let phys = window.ASSET_REGISTRY[type].physics;
                if (phys.radius !== undefined) phys.radius *= currentScale;
                if (phys.trunkRadius !== undefined) phys.trunkRadius *= currentScale;
                if (phys.canopyRadius !== undefined) phys.canopyRadius *= currentScale;
                if (phys.height !== undefined) phys.height *= currentScale;
            }

            // Save back to active user preset in database
            if (window._activePresetId && window._activePresetId !== '_backpack') {
                const preset = (window._userPresets || []).find(p => p.id === window._activePresetId);
                if (preset && preset.assets) {
                    const assetData = preset.assets.find(a => a.key === type);
                    if (assetData) {
                        assetData.targetHeight = newTargetHeight;
                        assetData.yOffset = currentYOff;
                        assetData.brightness = currentBright;
                        assetData.physics = JSON.parse(JSON.stringify(window.ASSET_REGISTRY[type].physics));
                        
                        try {
                            await ArcadeAPI.saveAssetPreset({ id: preset.id, name: preset.name, assets: preset.assets });
                            loadPresetDropdowns();
                        } catch (e) {
                            console.error('Failed to save updated preset settings:', e);
                        }
                    }
                }
            }
            
            if (window.customModels[type] && currentScale !== 1.0) {
                // Physically scale the base model
                window.customModels[type].scale.multiplyScalar(currentScale);
                window.customModels[type].updateMatrixWorld(true);
                
                // Adjust all existing props to maintain their physical size
                window.placedTrees.forEach(t => {
                    if (t.type === type) {
                        t.scale = (t.scale || 1.0) / currentScale;
                    }
                });
                
                // Destroy old pool to force geometry rebuild
                if (typeof destroyInstancePool === 'function') {
                    destroyInstancePool(type);
                }
            }
            
            prop.scale = 1.0;
            prop.yOffset = currentYOff;
            prop.brightness = currentBright;
            
            rebuildInstancePool(type);
            saveLevel(); // Persist the adjusted scales in the level JSON!
            
            document.getElementById('edit-prop-scale').value = 1.0;
            document.getElementById('edit-prop-scale-val').textContent = '1.0x';
            window.updateSelectedProp();
            
            if (window.showBuildToast) {
                window.showBuildToast('💾 Default settings updated!', '#10b981');
            }
        }
    };
    // === END POLY.PIZZA ===
