// ============================================================================
// bunker-studio.js - Dedicated 3D Bunker Studio for Smart Builder
// High-fidelity parametric bunker manipulation, 3D golf ball handles, 
// automatic active yellow outline, live Catmull-Rom spline & terrain pipeline
// ============================================================================

(function() {
    'use strict';

    // Global fallback for point-in-polygon
    window.pointInPolygon = window.pointInPolygon || function(px, pz, polyPts) {
        if (!polyPts || polyPts.length < 3) return false;
        let inside = false;
        for (let i = 0, j = polyPts.length - 1; i < polyPts.length; j = i++) {
            let pi = polyPts[i];
            let pj = polyPts[j];
            if (!pi || !pj) continue;
            let xi = pi.x !== undefined ? pi.x : pi[0];
            let zi = pi.z !== undefined ? pi.z : (pi.y !== undefined ? pi.y : pi[1]);
            let xj = pj.x !== undefined ? pj.x : pj[0];
            let zj = pj.z !== undefined ? pj.z : (pj.y !== undefined ? pj.y : pj[1]);
            if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi + 1e-12) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    };

    class BunkerStudioEngine {
        constructor() {
            this.active = false;
            this.activeTab = 'form';       // 'form' | 'profil' | 'sand'
            this.activeFormMode = 'edge';

            // 3D scene elements
            this.group = null;
            this.handleMeshes = [];
            this.outlineMesh = null;
            this.arrowGroup = null;

            // Interaction state
            this.hoveredHandleIndex = -1;
            this.draggingHandleIndex = -1;
            this._dragUndoSaved = false;
            this.dragStartPoints = null;
            this.draggingArrow = false;
            this.hoveredArrow = false;

            // Mode 1 draw node editing state (before bunker is built)
            this.draggingDrawNodeIndex = -1;
            this.hoveredDrawNodeIndex = -1;

            // Materials & Geometries cache
            this.materials = {};
            this.geometries = {};

            // Internal flag for tracking changes
            this._pendingRebuild = false;
        }

        get isOpen() {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartBunker = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'BUNKER');
            if (!isSmartBunker) return false;
            let sbPanel = document.getElementById('smart-green-action-panel') || document.getElementById('smart-builder-panel');
            if (sbPanel && sbPanel.style.display === 'none') return false;
            let pBuilt = document.getElementById('sbk-panel-built');
            let panelVisible = pBuilt && pBuilt.style.display !== 'none';
            return panelVisible || !!(this.group && this.group.visible);
        }

        init(scene) {
            if (this.group) return; // already initialized
            this.scene = scene || window._arcadeScene;
            if (!this.scene) return;

            this.group = new THREE.Group();
            this.group.name = 'BunkerStudioGroup';
            this.scene.add(this.group);

            // Create shared geometries (prominent size for easy clicking & dragging)
            this.geometries.ball = new THREE.SphereGeometry(0.85, 24, 24);
            this.geometries.activeBall = new THREE.SphereGeometry(1.05, 24, 24);
            this.geometries.arrowShaft = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 16);
            this.geometries.arrowCone = new THREE.ConeGeometry(0.35, 0.9, 16);

            // Create shared materials
            // Realistic dimpled golf ball look (white)
            this.materials.ball = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.3,
                metalness: 0.05,
                depthTest: false
            });

            // Golden amber hover
            this.materials.ballHover = new THREE.MeshStandardMaterial({
                color: 0xfbbf24,
                emissive: 0xf59e0b,
                emissiveIntensity: 0.8,
                roughness: 0.2,
                metalness: 0.1,
                depthTest: false
            });

            // Golden active dragging state
            this.materials.ballActive = new THREE.MeshStandardMaterial({
                color: 0xf59e0b,
                emissive: 0xd97706,
                emissiveIntensity: 0.9,
                roughness: 0.2,
                metalness: 0.1,
                depthTest: false
            });

            // The famous active Yellow Outline (linewidth 3, amber/gold 0xfbbf24)
            this.materials.outline = new THREE.LineBasicMaterial({
                color: 0xfbbf24,
                linewidth: 3,
                depthTest: false
            });

            // Lip direction 3D arrow
            this.materials.arrow = new THREE.MeshStandardMaterial({
                color: 0xf59e0b,
                emissive: 0xd97706,
                emissiveIntensity: 0.6,
                roughness: 0.3,
                depthTest: false
            });

            this.materials.arrowTip = new THREE.MeshStandardMaterial({
                color: 0xfbbf24,
                emissive: 0xb45309,
                emissiveIntensity: 0.9,
                roughness: 0.2,
                depthTest: false
            });

            this.buildLipArrow();
            this.sync();
        }

        buildLipArrow() {
            if (this.arrowGroup) {
                this.group.remove(this.arrowGroup);
            }
            this.arrowGroup = new THREE.Group();
            this.arrowGroup.name = 'BunkerStudioLipArrow';

            // Shaft (runs along Z axis)
            let shaft = new THREE.Mesh(this.geometries.arrowShaft, this.materials.arrow);
            shaft.rotation.x = Math.PI / 2;
            shaft.position.z = 1.6;
            shaft.renderOrder = 998;
            this.arrowGroup.add(shaft);

            // Cone (arrow head)
            let cone = new THREE.Mesh(this.geometries.arrowCone, this.materials.arrowTip);
            cone.rotation.x = Math.PI / 2;
            cone.position.z = 3.6;
            cone.renderOrder = 999;
            this.arrowGroup.add(cone);

            this.arrowGroup.visible = false;
            this.group.add(this.arrowGroup);
        }

        // ====================================================================
        // TAB CONTROLS ('form' | 'profil' | 'sand')
        // ====================================================================
        setTab(tabName) {
            this.activeTab = tabName;

            ['form', 'profil', 'sand'].forEach(t => {
                let tabBtn = document.getElementById('sbk-tab-' + t);
                let content = document.getElementById('sbk-content-' + t);
                if (tabBtn) {
                    if (t === tabName) {
                        tabBtn.style.background = '#fbbf24';
                        tabBtn.style.color = '#0f172a';
                        tabBtn.style.boxShadow = '0 2px 8px rgba(251, 191, 36, 0.35)';
                    } else {
                        tabBtn.style.background = 'transparent';
                        tabBtn.style.color = '#94a3b8';
                        tabBtn.style.boxShadow = 'none';
                    }
                }
                if (content) {
                    content.style.display = (t === tabName) ? 'block' : 'none';
                }
            });

            this.updateVisibility();
            this.updateBottomHints();
        }

        updateBottomHints() {
            let th = document.getElementById('tool-hints');
            let curT = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            if (!th || curT !== 'SMART_BUILDER' || window._smartBuilderType !== 'BUNKER') return;

            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeBd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
            let isBuilt = !!(activeBd && activeBd.points && activeBd.points.length >= 3 && hole.activeBunkerIndex !== null);

            if (!isBuilt) {
                th.innerHTML = isSv
                    ? "Vänsterklick: <b>Placera punkt</b><br>Högerklick: <b>Ångra punkt</b><br>Sätt ut minst 3 punkter och klicka Skapa bunker"
                    : "Left Click: <b>Place Point</b><br>Right Click: <b>Remove Last Point</b><br>Define shape, then Build Bunker";
                return;
            }

            if (this.activeTab === 'form') {
                th.innerHTML = isSv
                    ? "💡 <b>Dra de stora vita golfbollarna</b> för att justera formen<br>Klicka på linjen för ny punkt • Högerklicka på boll för att ta bort"
                    : "💡 <b>Drag white golf balls</b> to adjust shape<br>Click outline to add point • Right-click ball to remove";
            } else if (this.activeTab === 'profil') {
                th.innerHTML = isSv
                    ? "💡 <b>Välj profil och justera djup/vall</b><br>Vrid kompassen eller dra pilen i 3D för att rikta vallen"
                    : "💡 <b>Select profile & adjust depth/lip</b><br>Rotate compass or drag 3D arrow to orient bunker lip";
            } else if (this.activeTab === 'sand') {
                th.innerHTML = isSv
                    ? "💡 <b>Välj sandtyp och kantskärpa</b> för bunkerns utseende"
                    : "💡 <b>Select sand type and edge sharpness</b> for bunker aesthetics";
            }

            if (typeof window.updateBottomHUDLayout === 'function') {
                window.updateBottomHUDLayout();
            }
        }

        // ====================================================================
        // STRICT VISIBILITY RULES
        // ====================================================================
        updateVisibility() {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartBunker = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'BUNKER');

            // 1. If not currently in BUNKER mode, HIDE EVERYTHING
            if (!isSmartBunker) {
                this.hide();
                return;
            }

            if (!this.group) return;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeIdx = (hole && hole.activeBunkerIndex !== undefined) ? hole.activeBunkerIndex : null;
            let activeBd = (hole && hole.bunkers && activeIdx !== null && activeIdx !== undefined) ? hole.bunkers[activeIdx] : null;
            let hasBuilt = !!(activeBd && activeBd.points && activeBd.points.length >= 3);

            if (!hasBuilt) {
                // Drawing / Unbuilt mode
                this.group.visible = false;
                if (this.outlineMesh) this.outlineMesh.visible = false;
                if (this.arrowGroup) this.arrowGroup.visible = false;
                return;
            }

            this.group.visible = true;

            // Handle spheres and yellow outline visibility
            // Stora vita bollar syns i Form och Profil
            let showHandles = (this.activeTab === 'form' || this.activeTab === 'profil');
            for (let mesh of this.handleMeshes) {
                mesh.visible = showHandles;
            }

            // GUL KONTUR: Ska ALLTID synas för den aktiva bunkern i Bunker-läge!
            if (this.outlineMesh) {
                this.outlineMesh.visible = true;
            }

            // Vallpil i 3D: visas i Profil-fliken
            if (this.arrowGroup) {
                this.arrowGroup.visible = (this.activeTab === 'profil');
            }
        }

        hide() {
            if (this.group) this.group.visible = false;
            this.clearHandles();
            if (this.outlineMesh && this.group) {
                this.group.remove(this.outlineMesh);
                if (this.outlineMesh.geometry) this.outlineMesh.geometry.dispose();
                this.outlineMesh = null;
            }
            if (this.arrowGroup) {
                this.arrowGroup.visible = false;
            }
        }

        // ====================================================================
        // 3D HANDLES & ACTIVE YELLOW OUTLINE
        // ====================================================================
        clearHandles() {
            for (let m of this.handleMeshes) {
                if (this.group) this.group.remove(m);
            }
            this.handleMeshes = [];
        }

        rebuildHandles(hole, targetBunker) {
            this.clearHandles();
            if (this.outlineMesh && this.group) {
                this.group.remove(this.outlineMesh);
                if (this.outlineMesh.geometry) this.outlineMesh.geometry.dispose();
                this.outlineMesh = null;
            }

            let bd = targetBunker || (typeof window.getActiveBunker === 'function' ? window.getActiveBunker(hole) : null);
            if (!bd || !bd.points || bd.points.length < 3) return;

            let pts = bd.points;
            let tension = 0.5;

            // Build smooth CatmullRom curve for the Yellow Outline
            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.22, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(120, pts.length * 30);
            let curvePts = curve.getPoints(samples);

            // Close the loop
            if (curvePts.length > 0) {
                curvePts.push(curvePts[0].clone());
            }

            let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
            this.outlineMesh = new THREE.Line(lineGeo, this.materials.outline);
            this.outlineMesh.renderOrder = 998;
            this.group.add(this.outlineMesh);

            // Build large white golf ball handles on the rim
            pts.forEach((pt, idx) => {
                let ballMesh = new THREE.Mesh(this.geometries.ball, this.materials.ball);
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(pt.x, pt.z)
                    : (pt.y || 0);
                ballMesh.position.set(pt.x, y + 0.85, pt.z);
                ballMesh.renderOrder = 999;
                ballMesh.userData = { handleIndex: idx };
                ballMesh.visible = (this.activeTab === 'form' || this.activeTab === 'profil');
                this.group.add(ballMesh);
                this.handleMeshes.push(ballMesh);
            });

            this.updateVisibility();
        }

        updateSplineOnly(hole, targetBunker) {
            let bd = targetBunker || (typeof window.getActiveBunker === 'function' ? window.getActiveBunker(hole) : null);
            if (!bd || !bd.points || !this.outlineMesh) return;
            let pts = bd.points;
            let tension = 0.5;

            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.22, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(120, pts.length * 30);
            let curvePts = curve.getPoints(samples);
            if (curvePts.length > 0) curvePts.push(curvePts[0].clone());

            this.outlineMesh.geometry.setFromPoints(curvePts);
            this.outlineMesh.geometry.attributes.position.needsUpdate = true;
        }

        // ====================================================================
        // 3D LIP ARROW & COMPASS ROSE (PROFIL TAB)
        // ====================================================================
        updateLipArrow(hole, targetBunker) {
            if (!this.arrowGroup) return;
            let bd = targetBunker || (typeof window.getActiveBunker === 'function' ? window.getActiveBunker(hole) : null);
            if (!bd || !bd.points || bd.points.length < 3) {
                this.arrowGroup.visible = false;
                return;
            }

            // Centroid
            let cx = 0, cz = 0;
            for (let p of bd.points) { cx += p.x; cz += p.z; }
            cx /= bd.points.length; cz /= bd.points.length;
            let cy = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(cx, cz) : (bd.baseElevation || 0);

            this.arrowGroup.position.set(cx, cy + 0.35, cz);

            // Calculate lip angle
            let angle = 0;
            if (bd.lipToFlag && hole && hole.flag) {
                let fx = hole.flag.x !== undefined ? hole.flag.x : (hole.flag.position ? hole.flag.position.x : 0);
                let fz = hole.flag.z !== undefined ? hole.flag.z : (hole.flag.position ? hole.flag.position.z : 0);
                angle = Math.atan2(fx - cx, fz - cz);
                bd.lipAngle = angle;
            } else if (bd.lipAngle !== undefined) {
                angle = bd.lipAngle;
            } else {
                // Default: points[0] direction
                let facePt = bd.points[0];
                angle = Math.atan2(facePt.x - cx, facePt.z - cz);
                bd.lipAngle = angle;
            }

            this.arrowGroup.rotation.y = angle;

            // Update HTML Compass Rose needle
            let needle = document.getElementById('sbk-compass-needle');
            let degText = document.getElementById('sbk-compass-deg');
            let deg = Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360);
            if (needle) needle.style.transform = `rotate(${deg}deg)`;
            if (degText) {
                let card = this.getCardinalName(deg);
                degText.textContent = `${deg}° ${card}`;
            }

            let flagBtn = document.getElementById('sbk-lip-to-flag-btn');
            if (flagBtn) {
                let active = !!bd.lipToFlag;
                flagBtn.style.background = active ? 'rgba(251,191,36,0.25)' : '#0f172a';
                flagBtn.style.color = active ? '#fbbf24' : '#94a3b8';
                flagBtn.style.borderColor = active ? '#fbbf24' : '#334155';
            }
        }

        getCardinalName(deg) {
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let dirsSv = ['Nord', 'Nordost', 'Ost', 'Sydost', 'Syd', 'Sydväst', 'Väst', 'Nordväst'];
            let dirsEn = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
            let idx = Math.round(deg / 45) % 8;
            return isSv ? dirsSv[idx] : dirsEn[idx];
        }

        setLipDirection(deg) {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let bd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
            if (!hole || !bd) return;

            bd.lipToFlag = false;
            let rad = (deg * Math.PI) / 180;
            bd.lipAngle = rad;

            this.updateLipArrow(hole, bd);
            if (typeof window.applyBunkerPipeline === 'function') {
                window.applyBunkerPipeline(hole, false, false, bd);
            }
            if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
            this.syncUIValues(hole, bd);
        }

        setLipToFlag(enable) {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let bd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
            if (!hole || !bd) return;

            bd.lipToFlag = (enable !== undefined) ? enable : !bd.lipToFlag;
            this.updateLipArrow(hole, bd);
            if (typeof window.applyBunkerPipeline === 'function') {
                window.applyBunkerPipeline(hole, false, false, bd);
            }
            if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
            this.syncUIValues(hole, bd);
        }

        // ====================================================================
        // SYNCHRONIZE STATE WITH COURSE DATA & UI
        // ====================================================================
        sync() {
            if (!this.group && window._arcadeScene) this.init(window._arcadeScene);
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartBunker = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'BUNKER');

            let modeUnbuilt = document.getElementById('sbk-panel-unbuilt');
            let modeBuilt = document.getElementById('sbk-panel-built');
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

            if (!isSmartBunker) {
                this.hide();
                return;
            }

            let bunkers = (typeof window.ensureHoleBunkers === 'function') ? window.ensureHoleBunkers(hole) : (hole && hole.bunkers ? hole.bunkers : []);
            let activeIdx = (hole && hole.activeBunkerIndex !== undefined) ? hole.activeBunkerIndex : null;
            let activeBd = (bunkers && activeIdx !== null && activeIdx !== undefined && bunkers[activeIdx]) ? bunkers[activeIdx] : null;

            // 1. Render Multi-Bunker Selector Bar (NO camera movement)
            this.renderSelectorBar(hole, bunkers, activeIdx, isSv);

            let hasBuiltBunker = !!(activeBd && activeBd.points && activeBd.points.length >= 3);

            if (hasBuiltBunker) {
                if (modeUnbuilt) modeUnbuilt.style.display = 'none';
                if (modeBuilt) modeBuilt.style.display = 'block';

                let area = this.calculateArea(activeBd.points);
                let bkNum = (activeIdx !== null && activeIdx !== undefined) ? (activeIdx + 1) : 1;

                // Sync area text in Form tab
                let areaBadge = document.getElementById('sbk-form-area-val');
                if (areaBadge) areaBadge.textContent = `~${area} m²`;

                let formStatusBadge = document.getElementById('sbk-form-title-badge');
                if (formStatusBadge) {
                    formStatusBadge.textContent = isSv ? `● Bunker ${bkNum} vald` : `● Bunker ${bkNum} selected`;
                }

                // Show 3D studio group
                if (this.group) this.group.visible = true;

                // Sync bottom hint
                this.updateBottomHints();

                // Rebuild 3D handles (white balls) & yellow outline (ONLY for active bunker!)
                try {
                    this.rebuildHandles(hole, activeBd);
                    this.updateLipArrow(hole, activeBd);
                    this.syncUIValues(hole, activeBd);
                } catch (err) {
                    console.error('BunkerStudio sync error:', err);
                } finally {
                    this.updateVisibility();
                }
            } else {
                // Drawing new bunker mode
                if (modeUnbuilt) modeUnbuilt.style.display = 'flex';
                if (modeBuilt) modeBuilt.style.display = 'none';

                this.updateBottomHints();

                let pts = window.smartGreenPoints || [];
                let drawStatusEl = document.getElementById('sbk-draw-status');
                let buildBtn = document.getElementById('sbk-build-bunker-btn');

                if (drawStatusEl) {
                    if (pts.length === 0) {
                        drawStatusEl.innerHTML = isSv
                            ? '<span style="color:#94a3b8;">0 punkter valda (minst 3 krävs)</span>'
                            : '<span style="color:#94a3b8;">0 points placed (min 3 required)</span>';
                    } else if (pts.length < 3) {
                        drawStatusEl.innerHTML = isSv
                            ? `<span style="color:#f59e0b;">${pts.length} punkter valda (behöver minst 3)</span>`
                            : `<span style="color:#f59e0b;">${pts.length} points placed (need at least 3)</span>`;
                    } else {
                        drawStatusEl.innerHTML = isSv
                            ? `<span style="color:#4ade80; font-weight:bold;">✓ ${pts.length} punkter valda — Formen är redo!</span>`
                            : `<span style="color:#4ade80; font-weight:bold;">✓ ${pts.length} points placed — Shape is ready!</span>`;
                    }
                }

                if (buildBtn) {
                    let area = this.calculateArea(pts);
                    let areaText = (pts.length >= 3 && area > 0) ? (' (~' + area + ' m²)') : '';
                    let bkNextNum = (bunkers ? bunkers.length + 1 : 1);
                    let btnLabel = (isSv ? `Skapa Bunker ${bkNextNum}` : `Create Bunker ${bkNextNum}`) + areaText;
                    buildBtn.innerHTML = '🏖️ ' + btnLabel;

                    if (pts.length >= 3) {
                        buildBtn.style.opacity = '1';
                        buildBtn.style.cursor = 'pointer';
                        buildBtn.classList.add('pulse-green-btn');
                    } else {
                        buildBtn.style.opacity = '0.5';
                        buildBtn.style.cursor = 'not-allowed';
                        buildBtn.classList.remove('pulse-green-btn');
                    }
                }

                this.clearHandles();
                if (this.outlineMesh && this.group) {
                    this.group.remove(this.outlineMesh);
                    if (this.outlineMesh.geometry) this.outlineMesh.geometry.dispose();
                    this.outlineMesh = null;
                }
                if (this.arrowGroup) this.arrowGroup.visible = false;
            }
        }

        renderSelectorBar(hole, bunkers, activeIdx, isSv) {
            let headerRow = document.getElementById('sbk-header-row');
            let countEl = document.getElementById('sbk-count');
            let addBtn = document.getElementById('sbk-add-bunker-btn');
            let selectorBar = document.getElementById('sbk-selector-bar');

            if (bunkers && bunkers.length > 0) {
                if (headerRow) headerRow.style.display = 'flex';
                if (countEl) countEl.textContent = bunkers.length;

                let isDrawingNew = (activeIdx === null);
                if (addBtn) {
                    addBtn.style.cssText = isDrawingNew
                        ? 'background:rgba(251,191,36,0.25); color:#fbbf24; border:1px solid #fbbf24; border-radius:5px; padding:3px 8px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:3px; box-shadow:0 0 8px rgba(251,191,36,0.35);'
                        : 'background:#0f172a; color:#fbbf24; border:1px dashed rgba(251,191,36,0.6); border-radius:5px; padding:3px 8px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:3px; transition:all 0.2s;';
                    addBtn.innerHTML = `<span>➕</span> <span>${isSv ? 'Ny Bunker' : 'New Bunker'}</span>`;
                    addBtn.onclick = function() {
                        if (typeof window.startNewBunkerDrawing === 'function') {
                            window.startNewBunkerDrawing();
                        }
                    };
                }

                if (selectorBar) {
                    selectorBar.style.display = 'flex';
                    selectorBar.innerHTML = '';

                    let count = bunkers.length;
                    bunkers.forEach((bd, idx) => {
                        let bArea = this.calculateArea(bd.points || []);
                        let isSelected = (activeIdx === idx);
                        let btn = document.createElement('button');
                        btn.type = 'button';
                        btn.title = `Bunker ${idx + 1} (~${bArea} m²)`;

                        let label = (count === 1)
                            ? `<span>🏖️ Bunker 1</span><span style="font-size:8px; opacity:0.85;">(~${bArea}m²)</span>`
                            : (count === 2)
                                ? `<span>🏖️ BK ${idx + 1}</span><span style="font-size:8px; opacity:0.8;">(~${bArea}m²)</span>`
                                : `<span>🏖️ BK ${idx + 1}</span>`;

                        // STRICT USER RULE: Selecting a bunker lights up the yellow outline ONLY on this bunker,
                        // and the camera stays 100% untouched!
                        btn.style.cssText = isSelected 
                            ? 'flex:1 1 auto; min-width:48px; background:#fbbf24; color:#0f172a; border:1px solid #f59e0b; border-radius:5px; padding:5px 6px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:3px; box-shadow:0 0 8px rgba(251,191,36,0.4); transition:all 0.15s;'
                            : 'flex:1 1 auto; min-width:48px; background:#1e293b; color:#94a3b8; border:1px solid #334155; border-radius:5px; padding:5px 6px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:3px; transition:all 0.15s;';
                        btn.innerHTML = label;

                        btn.onclick = () => {
                            // Select bunker WITHOUT moving camera
                            hole.activeBunkerIndex = idx;
                            if (typeof window.clearSmartGreen === 'function') window.clearSmartGreen();
                            this.sync();
                        };
                        selectorBar.appendChild(btn);
                    });
                }
            } else {
                if (headerRow) headerRow.style.display = 'none';
                if (selectorBar) {
                    selectorBar.style.display = 'none';
                    selectorBar.innerHTML = '';
                }
            }
        }

        syncUIValues(hole, targetBunker) {
            let bd = targetBunker || (typeof window.getActiveBunker === 'function' ? window.getActiveBunker(hole) : null);
            if (!bd) return;

            // Profil Tab: Presets
            let shape = bd.shape || 'BOWL';
            ['bowl', 'pot', 'flat', 'waste'].forEach(s => {
                let card = document.getElementById('sbk-preset-' + s);
                if (card) {
                    let match = (s.toUpperCase() === shape.toUpperCase());
                    card.style.background = match ? 'rgba(251, 191, 36, 0.25)' : '#1e293b';
                    card.style.borderColor = match ? '#fbbf24' : '#334155';
                    card.style.color = match ? '#fbbf24' : '#cbd5e1';
                }
            });

            // Profil Tab: Sliders
            let dS = document.getElementById('sb-bunker-depth');
            let dV = document.getElementById('sb-bunker-depth-val');
            let depth = bd.depth !== undefined ? bd.depth : 0.8;
            if (dS && document.activeElement !== dS) dS.value = depth;
            if (dV) dV.textContent = depth.toFixed(1) + 'm';

            let lS = document.getElementById('sb-bunker-lip');
            let lV = document.getElementById('sb-bunker-lip-val');
            let lip = bd.lipHeight !== undefined ? bd.lipHeight : 0.3;
            if (lS && document.activeElement !== lS) lS.value = lip;
            if (lV) lV.textContent = lip.toFixed(2) + 'm';

            // Sand & Finish Tab: Sand Type Cards
            let curSand = bd.sandType || 'BIOME';
            ['augusta', 'golden', 'links', 'coastal', 'biome'].forEach(st => {
                let card = document.getElementById('sbk-sand-' + st);
                if (card) {
                    let match = (st.toUpperCase() === curSand.toUpperCase());
                    card.style.background = match ? 'rgba(251, 191, 36, 0.25)' : '#1e293b';
                    card.style.borderColor = match ? '#fbbf24' : '#334155';
                    card.style.color = match ? '#fbbf24' : '#cbd5e1';
                }
            });

            // Edge sharpness
            let esS = document.getElementById('sg-edge-sharpness') || document.getElementById('sbk-edge-sharpness');
            let esV = document.getElementById('sg-edge-val') || document.getElementById('sbk-edge-val');
            let es = bd.edgeSharpness !== undefined ? bd.edgeSharpness : 100;
            if (esS && document.activeElement !== esS) esS.value = es;
            if (esV) esV.textContent = (es === 100) ? 'Skarp (Sod Wall)' : (es === 0 ? 'Mjuk (Soft)' : es + '%');
        }

        // ====================================================================
        // EVENT HANDLERS (POINTERDOWN, MOVE, UP, RIGHTCLICK)
        // ====================================================================
        onPointerDown(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartBunker = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'BUNKER');
            if (!isSmartBunker) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeBd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
            let hasBuiltBunker = !!(activeBd && activeBd.points && activeBd.points.length >= 3 && hole.activeBunkerIndex !== null);

            // ========================================================
            // MODE 1: UNBUILT (DRAWING NEW BUNKER)
            // ========================================================
            if (!hasBuiltBunker) {
                // 1. Dragging an existing placed golf ball before bunker is built
                if (window.smartGreenSpheres && window.smartGreenSpheres.length > 0 && raycaster) {
                    let intersects = raycaster.intersectObjects(window.smartGreenSpheres, true);
                    if (intersects.length > 0) {
                        let hit = intersects[0].object;
                        while (hit && hit.userData.pointIndex === undefined && hit.parent && hit.parent !== window._arcadeScene) {
                            hit = hit.parent;
                        }
                        let ptIdx = hit ? hit.userData.pointIndex : undefined;
                        if (ptIdx !== undefined && ptIdx >= 0) {
                            if (ptIdx === 0 && !window._smartShapeClosed && window.smartGreenPoints && window.smartGreenPoints.length >= 3) {
                                if (window.polylineSelfIntersects(window.smartGreenPoints, true)) { window.warnSelfCrossing(); return true; }
                                window._smartShapeClosed = true;
                                let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                                if (typeof window.showBuildToast === 'function') {
                                    window.showBuildToast(isSv ? '🔒 Bunkerformen är stängd! Klicka på [Bygg Bunker] för att skapa.' : '🔒 Bunker shape closed! Click [Build Bunker] to create.', '#fbbf24');
                                }
                                if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                                if (window.controls) window.controls.enabled = false;
                                return true;
                            }
                            this.draggingDrawNodeIndex = ptIdx;
                            if (window.controls) window.controls.enabled = false;
                            let ball = window.smartGreenSpheres[ptIdx];
                            if (ball) {
                                if (ball.material) ball.material = this.materials.ballActive || this.materials.ballHover;
                                ball.scale.set(1.25, 1.25, 1.25);
                            }
                            document.body.style.cursor = 'grabbing';
                            return true;
                        }
                    }
                }

                // 2. Click line to insert new golf ball
                if (window.smartGreenPoints && window.smartGreenPoints.length >= 2 && lastHitPoint) {
                    let pts = window.smartGreenPoints;
                    let minEdgeDist = Infinity;
                    let insertIdx = -1;
                    let maxThreshold = 2.5;
                    let isClosed = (pts.length >= 3);
                    let segCount = isClosed ? pts.length : pts.length - 1;

                    for (let i = 0; i < segCount; i++) {
                        let next = (i + 1) % pts.length;
                        let p0 = pts[i];
                        let p1 = pts[next];
                        let d = this.distToSegment(lastHitPoint.x, lastHitPoint.z, p0.x, p0.z, p1.x, p1.z);
                        if (d < minEdgeDist && d < maxThreshold) {
                            minEdgeDist = d;
                            insertIdx = i + 1;
                        }
                    }

                    if (insertIdx !== -1) {
                        if (window.insertWouldCross(pts, insertIdx, lastHitPoint.x, lastHitPoint.z)) { window.warnSelfCrossing(); return true; }
                        let y = (typeof window.getTerrainHeight === 'function')
                            ? window.getTerrainHeight(lastHitPoint.x, lastHitPoint.z)
                            : (lastHitPoint.y || 0);
                        let newPt = new THREE.Vector3(lastHitPoint.x, y, lastHitPoint.z);
                        pts.splice(insertIdx, 0, newPt);
                        if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                        this.sync();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny golfboll infogad på linjen!' : '➕ New golf ball inserted on line!', '#fbbf24');
                        }
                        return true;
                    }
                }

                return false;
            }

            // ========================================================
            // MODE 2: BUILT BUNKER (ACTIVE STUDIO)
            // ========================================================
            if (!activeBd) return false;

            // 1. Click on large white golf ball handle
            if ((this.activeTab === 'form' || this.activeTab === 'profil') && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (handleIdx !== undefined) {
                        this.draggingHandleIndex = handleIdx;
                        this.dragStartPoints = activeBd.points.map(p => ({ x: p.x, y: p.y, z: p.z }));
                        if (window.controls) window.controls.enabled = false;
                        hitMesh.material = this.materials.ballActive || this.materials.ballHover;
                        hitMesh.scale.set(1.25, 1.25, 1.25);
                        document.body.style.cursor = 'grabbing';
                        return true;
                    }
                }

                // 2. Click on the yellow outline to insert new node
                if (this.outlineMesh && lastHitPoint) {
                    let pts = activeBd.points;
                    let minEdgeDist = Infinity;
                    let insertIdx = -1;
                    let maxThreshold = 2.5;

                    for (let i = 0; i < pts.length; i++) {
                        let next = (i + 1) % pts.length;
                        let p0 = pts[i];
                        let p1 = pts[next];
                        let d = this.distToSegment(lastHitPoint.x, lastHitPoint.z, p0.x, p0.z, p1.x, p1.z);
                        if (d < minEdgeDist && d < maxThreshold) {
                            minEdgeDist = d;
                            insertIdx = next;
                        }
                    }

                    if (insertIdx !== -1) {
                        if (window.insertWouldCross(pts, insertIdx, lastHitPoint.x, lastHitPoint.z)) { window.warnSelfCrossing(); return true; }
                        window.saveUndoState();
                        window.restoreBunkerBase(hole, true, activeBd);

                        let newPt = { x: lastHitPoint.x, y: lastHitPoint.y || 0, z: lastHitPoint.z };
                        pts.splice(insertIdx, 0, newPt);

                        let snap = window.captureBunkerSnapshot(hole, pts, 15);
                        activeBd.bbox = snap.bbox;
                        activeBd.origHeights = snap.origHeights;
                        activeBd.origCanvasPixels = snap.origCanvasPixels;
                        if (activeBd.baseElevation === undefined) activeBd.baseElevation = snap.baseElevation;

                        window.applyBunkerPipeline(hole, false, true, activeBd);
                        this.rebuildHandles(hole, activeBd);
                        this.updateLipArrow(hole, activeBd);

                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny vit boll tillagd på bunkern!' : '➕ New white ball added to bunker!', '#fbbf24');
                        }
                        return true;
                    }
                }
            }

            // 3. Click on 3D lip arrow in Profil tab
            if (this.activeTab === 'profil' && this.arrowGroup && this.arrowGroup.visible && raycaster) {
                let intersects = raycaster.intersectObjects(this.arrowGroup.children);
                if (intersects.length > 0) {
                    this.draggingArrow = true;
                    if (window.controls) window.controls.enabled = false;
                    return true;
                }
            }

            return false;
        }

        onMouseMove(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartBunker = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'BUNKER');
            if (!isSmartBunker) return;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeBd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
            let hasBuiltBunker = !!(activeBd && activeBd.points && activeBd.points.length >= 3 && hole.activeBunkerIndex !== null);

            // ========================================================
            // MODE 1: UNBUILT (DRAWING NEW BUNKER)
            // ========================================================
            if (!hasBuiltBunker) {
                if (this.draggingDrawNodeIndex >= 0 && lastHitPoint) {
                    let idx = this.draggingDrawNodeIndex;
                    if (window.smartGreenPoints && window.smartGreenPoints[idx]) {
                        let pt = window.smartGreenPoints[idx];
                        if (window.moveWouldCross(window.smartGreenPoints, idx, lastHitPoint.x, lastHitPoint.z, !!window._smartShapeClosed)) { document.body.style.cursor = 'not-allowed'; return; }
                        pt.x = lastHitPoint.x;
                        pt.z = lastHitPoint.z;
                        let y = (typeof window.getTerrainHeight === 'function')
                            ? window.getTerrainHeight(lastHitPoint.x, lastHitPoint.z)
                            : (lastHitPoint.y || 0);
                        pt.y = y;

                        let mesh = (window.smartGreenSpheres && window.smartGreenSpheres[idx]);
                        if (mesh) {
                            mesh.position.set(lastHitPoint.x, y + 0.85, lastHitPoint.z);
                            mesh.scale.set(1.25, 1.25, 1.25);
                        }

                        if (typeof window.updateSmartGreenSplineOnly === 'function') {
                            window.updateSmartGreenSplineOnly();
                        }
                    }
                    return;
                }

                // Magnetic snap hover when >= 3 points and shape is open
                if (window.smartGreenPoints && window.smartGreenPoints.length >= 3 && !window._smartShapeClosed && lastHitPoint) {
                    let p0 = window.smartGreenPoints[0];
                    let d = Math.hypot(lastHitPoint.x - p0.x, lastHitPoint.z - p0.z);
                    let ball0 = (window.smartGreenSpheres && window.smartGreenSpheres[0]);
                    if (d < 4.0) {
                        window._smartSnapHover = true;
                        if (ball0) {
                            ball0.scale.set(1.45, 1.45, 1.45);
                            if (ball0.material) ball0.material = this.materials.ballActive || this.materials.ballHover;
                        }
                        document.body.style.cursor = 'pointer';
                    } else if (window._smartSnapHover) {
                        window._smartSnapHover = false;
                        if (ball0 && this.hoveredDrawNodeIndex !== 0) {
                            ball0.scale.set(1.0, 1.0, 1.0);
                            if (ball0.material) ball0.material = this.materials.ball;
                        }
                        document.body.style.cursor = 'default';
                    }
                }

                // Hovering over draw nodes
                if (window.smartGreenSpheres && window.smartGreenSpheres.length > 0 && raycaster) {
                    let intersects = raycaster.intersectObjects(window.smartGreenSpheres, true);
                    if (intersects.length > 0) {
                        let hit = intersects[0].object;
                        while (hit && hit.userData.pointIndex === undefined && hit.parent && hit.parent !== window._arcadeScene) {
                            hit = hit.parent;
                        }
                        let ptIdx = hit ? hit.userData.pointIndex : undefined;
                        if (ptIdx !== undefined && this.hoveredDrawNodeIndex !== ptIdx) {
                            this.clearDrawHover();
                            this.hoveredDrawNodeIndex = ptIdx;
                            let ball = window.smartGreenSpheres[ptIdx];
                            if (ball) {
                                if (ball.material) ball.material = this.materials.ballHover;
                                ball.scale.set(1.25, 1.25, 1.25);
                            }
                            document.body.style.cursor = 'grab';
                        }
                    } else if (this.hoveredDrawNodeIndex >= 0) {
                        this.clearDrawHover();
                        document.body.style.cursor = 'default';
                    }
                }
                return;
            }

            // ========================================================
            // MODE 2: BUILT BUNKER (ACTIVE STUDIO)
            // ========================================================
            if (!activeBd) return;

            // 1. Dragging large white golf ball handle
            if (this.draggingHandleIndex >= 0 && lastHitPoint) {
                let idx = this.draggingHandleIndex;
                let pt = activeBd.points[idx];
                if (pt) {
                    if (window.moveWouldCross(activeBd.points, idx, lastHitPoint.x, lastHitPoint.z, true)) { document.body.style.cursor = 'not-allowed'; return; }
                    // Undo point = state BEFORE the first movement of this drag
                    if (!this._dragUndoSaved) { this._dragUndoSaved = true; window.saveUndoState(); }
                    pt.x = lastHitPoint.x;
                    pt.z = lastHitPoint.z;

                    let mesh = this.handleMeshes[idx];
                    if (mesh) {
                        let y = (typeof window.getTerrainHeight === 'function')
                            ? window.getTerrainHeight(pt.x, pt.z)
                            : lastHitPoint.y;
                        mesh.position.set(pt.x, y + 0.85, pt.z);
                        mesh.scale.set(1.25, 1.25, 1.25);
                    }

                    // Live 60 FPS yellow outline update
                    this.updateSplineOnly(hole, activeBd);
                    this._pendingRebuild = true;
                }
                return;
            }

            // 2. Dragging lip direction arrow
            if (this.draggingArrow && lastHitPoint && this.arrowGroup) {
                let cx = this.arrowGroup.position.x;
                let cz = this.arrowGroup.position.z;
                let dx = lastHitPoint.x - cx;
                let dz = lastHitPoint.z - cz;
                let angle = Math.atan2(dx, dz);
                let deg = Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360);
                this.setLipDirection(deg);
                return;
            }

            // 3. Hovering over handles
            if ((this.activeTab === 'form' || this.activeTab === 'profil') && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (this.hoveredHandleIndex !== handleIdx) {
                        this.clearHover();
                        this.hoveredHandleIndex = handleIdx;
                        hitMesh.material = this.materials.ballHover;
                        hitMesh.scale.set(1.25, 1.25, 1.25);
                        document.body.style.cursor = 'grab';
                    }
                } else if (this.hoveredHandleIndex >= 0) {
                    this.clearHover();
                    document.body.style.cursor = 'default';
                }
            }
        }

        onPointerUp(e) {
            let wasDragging = (this.draggingHandleIndex >= 0 || this.draggingArrow || this.draggingDrawNodeIndex >= 0);

            // Mode 1: Finished dragging a draw node
            if (this.draggingDrawNodeIndex >= 0) {
                let idx = this.draggingDrawNodeIndex;
                let mesh = (window.smartGreenSpheres && window.smartGreenSpheres[idx]);
                if (mesh) {
                    if (mesh.material) mesh.material = this.materials.ball;
                    mesh.scale.set(1.0, 1.0, 1.0);
                }
                this.draggingDrawNodeIndex = -1;
                if (window.controls) window.controls.enabled = true;
                document.body.style.cursor = 'default';
                if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                this.sync();
            }

            // Mode 2: Finished dragging a white ball on built bunker
            if (this.draggingHandleIndex >= 0) {
                let mesh = this.handleMeshes[this.draggingHandleIndex];
                if (mesh) {
                    mesh.material = this.materials.ball;
                    mesh.scale.set(1.0, 1.0, 1.0);
                }
                this.draggingHandleIndex = -1;
                this._dragUndoSaved = false;

                let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
                let activeBd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
                if (hole && activeBd && this._pendingRebuild) {
                    // (undo point was saved before the first movement of the drag)

                    // Restore base and re-capture snapshot using original pre-drag points
                    let oldBd = { ...activeBd, points: (this.dragStartPoints || activeBd.points) };
                    window.restoreBunkerBase(hole, true, oldBd);
                    this.dragStartPoints = null;

                    let snap = window.captureBunkerSnapshot(hole, activeBd.points, 15);
                    activeBd.bbox = snap.bbox;
                    activeBd.origHeights = snap.origHeights;
                    activeBd.origCanvasPixels = snap.origCanvasPixels;
                    if (activeBd.baseElevation === undefined) activeBd.baseElevation = snap.baseElevation;

                    window.applyBunkerPipeline(hole, false, true, activeBd);
                    this.rebuildHandles(hole, activeBd);
                    this.updateLipArrow(hole, activeBd);
                    this._pendingRebuild = false;

                    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
                    this.sync();
                }
            }

            if (this.draggingArrow) {
                this.draggingArrow = false;
            }

            if (wasDragging && window.controls) {
                window.controls.enabled = true;
                document.body.style.cursor = 'default';
            }
        }

        onRightClick(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartBunker = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'BUNKER');
            if (!isSmartBunker) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeBd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
            let hasBuiltBunker = !!(activeBd && activeBd.points && activeBd.points.length >= 3 && hole.activeBunkerIndex !== null);

            // Mode 1: Delete node while drawing
            if (!hasBuiltBunker && window.smartGreenSpheres && window.smartGreenSpheres.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(window.smartGreenSpheres, true);
                if (intersects.length > 0) {
                    let hit = intersects[0].object;
                    while (hit && hit.userData.pointIndex === undefined && hit.parent && hit.parent !== window._arcadeScene) {
                        hit = hit.parent;
                    }
                    let ptIdx = hit ? hit.userData.pointIndex : undefined;
                    if (ptIdx !== undefined && window.smartGreenPoints) {
                        window.smartGreenPoints.splice(ptIdx, 1);
                        if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                        this.sync();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '🗑️ Nod raderad' : '🗑️ Node deleted', '#f87171');
                        }
                        return true;
                    }
                }
                return false;
            }

            // Mode 2: Delete node from built bunker (min 3 points must remain)
            if (hasBuiltBunker && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (handleIdx !== undefined && activeBd.points) {
                        if (activeBd.points.length <= 3) {
                            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                            if (typeof window.showBuildToast === 'function') {
                                window.showBuildToast(isSv ? '⚠️ Bunkern måste ha minst 3 punkter' : '⚠️ Bunker must have at least 3 points', '#ef4444');
                            }
                            return true;
                        }

                        window.saveUndoState();
                        window.restoreBunkerBase(hole, true, activeBd);

                        activeBd.points.splice(handleIdx, 1);

                        let snap = window.captureBunkerSnapshot(hole, activeBd.points, 15);
                        activeBd.bbox = snap.bbox;
                        activeBd.origHeights = snap.origHeights;
                        activeBd.origCanvasPixels = snap.origCanvasPixels;

                        window.applyBunkerPipeline(hole, false, true, activeBd);
                        this.rebuildHandles(hole, activeBd);
                        this.updateLipArrow(hole, activeBd);

                        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
                        this.sync();

                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '🗑️ Vit boll raderad' : '🗑️ White ball deleted', '#f87171');
                        }
                        return true;
                    }
                }
            }

            return false;
        }

        clearHover() {
            if (this.hoveredHandleIndex >= 0 && this.handleMeshes[this.hoveredHandleIndex]) {
                let mesh = this.handleMeshes[this.hoveredHandleIndex];
                mesh.material = this.materials.ball;
                mesh.scale.set(1.0, 1.0, 1.0);
                this.hoveredHandleIndex = -1;
            }
        }

        clearDrawHover() {
            if (this.hoveredDrawNodeIndex >= 0 && window.smartGreenSpheres && window.smartGreenSpheres[this.hoveredDrawNodeIndex]) {
                let mesh = window.smartGreenSpheres[this.hoveredDrawNodeIndex];
                if (mesh.material) mesh.material = this.materials.ball;
                mesh.scale.set(1.0, 1.0, 1.0);
                this.hoveredDrawNodeIndex = -1;
            }
        }

        // ====================================================================
        // ANIMATION LOOP UPDATE (NO camera movement)
        // ====================================================================
        update(dt) {
            // BunkerStudio does not alter camera positions.
        }

        // ====================================================================
        // GEOMETRIC HELPERS
        // ====================================================================
        distToSegment(px, pz, x1, z1, x2, z2) {
            let dx = x2 - x1;
            let dz = z2 - z1;
            let len2 = dx * dx + dz * dz;
            if (len2 === 0) return Math.sqrt((px - x1) * (px - x1) + (pz - z1) * (pz - z1));
            let t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2));
            let projX = x1 + t * dx;
            let projZ = z1 + t * dz;
            return Math.sqrt((px - projX) * (px - projX) + (pz - projZ) * (pz - projZ));
        }

        calculateArea(points) {
            if (!points || points.length < 3) return 0;
            let area = 0;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                area += (points[j].x + points[i].x) * (points[j].z - points[i].z);
            }
            return Math.round(Math.abs(area / 2));
        }
    }

    // Instantiate and expose globally
    window.BunkerStudio = new BunkerStudioEngine();

    // ====================================================================
    // GLOBAL HELPER FUNCTIONS FOR BUNKER STUDIO UI
    // ====================================================================
    window.setBunkerProfilePreset = function(preset) {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        let bd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
        if (!hole || !bd) return;

        bd.shape = preset.toUpperCase();

        // Preset configurations
        if (preset === 'BOWL') {
            bd.depth = 0.8;
            bd.lipHeight = 0.3;
        } else if (preset === 'POT') {
            bd.depth = 1.6;
            bd.lipHeight = 0.8;
        } else if (preset === 'FLAT') {
            bd.depth = 0.6;
            bd.lipHeight = 0.15;
        } else if (preset === 'WASTE') {
            bd.depth = 0.35;
            bd.lipHeight = 0.05;
        }

        if (typeof window.applyBunkerPipeline === 'function') {
            window.applyBunkerPipeline(hole, false, false, bd);
        }
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
        if (window.BunkerStudio) window.BunkerStudio.sync();

        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        let names = {
            BOWL: isSv ? '🥣 Profil: Skålad (Classic)' : '🥣 Profile: Bowl (Classic)',
            POT: isSv ? '🕳️ Profil: Pot Bunker (Brant & Djup)' : '🕳️ Profile: Pot Bunker (Steep & Deep)',
            FLAT: isSv ? '🥞 Profil: Platt botten' : '🥞 Profile: Flat Bottom',
            WASTE: isSv ? '🏜️ Profil: Waste Bunker (Flack)' : '🏜️ Profile: Waste Bunker (Shallow)'
        };
        if (typeof window.showBuildToast === 'function') {
            window.showBuildToast(names[preset.toUpperCase()] || preset, '#fbbf24');
        }
    };

    window.setBunkerSandType = function(type) {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        let bd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
        if (!hole || !bd) return;

        bd.sandType = type.toUpperCase();

        let colors = {
            AUGUSTA: '#f4f1ea', // Pure white quartz
            GOLDEN: '#e0d8a4',  // Classic golden parkland
            LINKS: '#c2b396',   // Scottish natural grey-tan
            COASTAL: '#ebd5b3', // Soft coastal dune
            BIOME: null         // Follow biome
        };

        bd.sandColor = colors[type.toUpperCase()] || null;

        if (typeof window.applyBunkerPipeline === 'function') {
            window.applyBunkerPipeline(hole, false, true, bd);
        }
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
        if (window.BunkerStudio) window.BunkerStudio.sync();

        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        let names = {
            AUGUSTA: isSv ? '🏖️ Sand: Augusta Vit (Kvartssand)' : '🏖️ Sand: Augusta White (Quartz)',
            GOLDEN: isSv ? '🏖️ Sand: Gyllene Sand (Parkbana)' : '🏖️ Sand: Golden Amber (Parkland)',
            LINKS: isSv ? '🏖️ Sand: Skotsk Links (Gråbrun)' : '🏖️ Sand: Scottish Links (Grey-Tan)',
            COASTAL: isSv ? '🏖️ Sand: Kustsand (Dyner)' : '🏖️ Sand: Coastal Dune',
            BIOME: isSv ? '🏖️ Sand: Standard från Biome' : '🏖️ Sand: Standard Biome Color'
        };
        if (typeof window.showBuildToast === 'function') {
            window.showBuildToast(names[type.toUpperCase()] || type, '#fbbf24');
        }
    };

    window.resetBunkerProfile = function() {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        let bd = (typeof window.getActiveBunker === 'function') ? window.getActiveBunker(hole) : null;
        if (!hole || !bd) return;

        bd.shape = 'BOWL';
        bd.depth = 0.8;
        bd.lipHeight = 0.3;
        bd.lipAngle = undefined;
        bd.lipToFlag = false;

        if (typeof window.applyBunkerPipeline === 'function') {
            window.applyBunkerPipeline(hole, false, false, bd);
        }
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
        if (window.BunkerStudio) window.BunkerStudio.sync();

        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        if (typeof window.showBuildToast === 'function') {
            window.showBuildToast(isSv ? '↺ Bunkerprofil återställd' : '↺ Bunker profile reset', '#fbbf24');
        }
    };

})();
