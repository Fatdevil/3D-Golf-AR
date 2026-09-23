// ============================================================================
// fairway-studio.js - Dedicated 3D Fairway Studio for Smart Builder
// Parametric fairway manipulation, 3D handles, live spline & terrain pipeline
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

    class FairwayStudioEngine {
        constructor() {
            this.active = false;
            this.activeTab = 'form';       // 'form' | 'bredd' | 'klippning'

            // 3D scene elements
            this.group = null;
            this.handleMeshes = [];
            this.splineMesh = null;

            // Interaction state
            this.hoveredHandleIndex = -1;
            this.draggingHandleIndex = -1;
            this.dragStartPoints = null;

            // Mode 1 draw node editing state (before fairway is built)
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
            let isSmartFairway = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'FAIRWAY');
            if (!isSmartFairway) return false;
            let sbPanel = document.getElementById('smart-green-action-panel') || document.getElementById('smart-builder-panel');
            if (sbPanel && sbPanel.style.display === 'none') return false;
            let pBuilt = document.getElementById('sf-panel-built');
            let panelVisible = pBuilt && pBuilt.style.display !== 'none';
            return panelVisible || !!(this.group && this.group.visible);
        }

        init(scene) {
            if (this.group) return; // already initialized
            this.scene = scene || window._arcadeScene;
            if (!this.scene) return;

            this.group = new THREE.Group();
            this.group.name = 'FairwayStudioGroup';
            this.scene.add(this.group);

            // Create shared geometries
            this.geometries.ball = new THREE.SphereGeometry(0.9, 24, 24);
            this.geometries.activeBall = new THREE.SphereGeometry(1.15, 24, 24);

            // Create shared materials
            // Realistic golf ball look with fairway-green hover
            this.materials.ball = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.3,
                metalness: 0.05,
                depthTest: false
            });

            this.materials.ballHover = new THREE.MeshStandardMaterial({
                color: 0x7db952,
                emissive: 0x4ade80,
                emissiveIntensity: 0.8,
                roughness: 0.2,
                metalness: 0.1,
                depthTest: false
            });

            this.materials.ballActive = new THREE.MeshStandardMaterial({
                color: 0xfbbf24,
                emissive: 0xd97706,
                emissiveIntensity: 0.8,
                roughness: 0.2,
                metalness: 0.1,
                depthTest: false
            });

            this.materials.spline = new THREE.LineBasicMaterial({
                color: 0x7db952,
                linewidth: 3,
                depthTest: false
            });
        }

        // ====================================================================
        // TAB & MODE CONTROLS
        // ====================================================================
        setTab(tabName) {
            this.activeTab = tabName;

            ['form', 'bredd', 'klippning'].forEach(t => {
                let tabBtn = document.getElementById('sf-tab-' + t);
                let content = document.getElementById('sf-content-' + t);
                if (tabBtn) {
                    if (t === tabName) {
                        tabBtn.style.background = '#7db952';
                        tabBtn.style.color = '#0f172a';
                        tabBtn.style.boxShadow = '0 2px 8px rgba(125, 185, 82, 0.35)';
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
            if (!th || curT !== 'SMART_BUILDER' || window._smartBuilderType !== 'FAIRWAY') return;

            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeFd = (typeof window.getActiveFairway === 'function') ? window.getActiveFairway(hole) : null;
            let isBuilt = !!(activeFd && activeFd.points && activeFd.points.length >= 3 && hole.activeFairwayIndex !== null);

            if (!isBuilt) {
                th.innerHTML = isSv
                    ? "Vänsterklick: <b>Placera punkt</b><br>Högerklick: <b>Ångra punkt</b><br>Sätt ut minst 3 punkter och klicka Skapa fairway"
                    : "Left Click: <b>Place Point</b><br>Right Click: <b>Remove Last Point</b><br>Define shape, then Build Fairway";
                return;
            }

            if (this.activeTab === 'form') {
                th.innerHTML = isSv
                    ? "💡 <b>Dra de vita golfbollarna</b> för att justera formen<br>Klicka på linjen för ny punkt • Högerklicka på boll för att ta bort"
                    : "💡 <b>Drag golf balls</b> to adjust shape<br>Click line to add point • Right-click ball to remove";
            } else if (this.activeTab === 'bredd') {
                th.innerHTML = isSv
                    ? "💡 <b>Justera semi-rough och rough</b> med reglagen<br>Välj markens böljande profil bland de 4 terrängkorten"
                    : "💡 <b>Adjust semi-rough & rough</b> with sliders<br>Select terrain waviness preset from the 4 cards";
            } else if (this.activeTab === 'klippning') {
                th.innerHTML = isSv
                    ? "💡 <b>Välj klippmönster</b> för fairwayens gräsyta"
                    : "💡 <b>Select mowing pattern</b> for fairway turf";
            }

            if (typeof window.updateBottomHUDLayout === 'function') {
                window.updateBottomHUDLayout();
            }
        }

        // ====================================================================
        // SYNCHRONIZE STATE WITH COURSE DATA & UI
        // ====================================================================
        sync() {
            if (!this.group && window._arcadeScene) this.init(window._arcadeScene);
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartFairway = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'FAIRWAY');

            let modeUnbuilt = document.getElementById('sf-panel-unbuilt');
            let modeBuilt = document.getElementById('sf-panel-built');
            let statusBadge = document.getElementById('sf-status-badge');
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

            if (!isSmartFairway) {
                this.hide();
                return;
            }

            let fairways = (typeof window.ensureHoleFairways === 'function') ? window.ensureHoleFairways(hole) : (hole && hole.fairways ? hole.fairways : []);
            let activeIdx = (hole && hole.activeFairwayIndex !== undefined) ? hole.activeFairwayIndex : null;
            let activeFd = (fairways && activeIdx !== null && activeIdx !== undefined && fairways[activeIdx]) ? fairways[activeIdx] : null;

            // 1. Render Multi-Fairway Header & Selector Pills Bar
            this.renderSelectorBar(hole, fairways, activeIdx, isSv);

            let hasBuiltFairway = !!(activeFd && activeFd.points && activeFd.points.length >= 3);

            if (hasBuiltFairway) {
                if (modeUnbuilt) modeUnbuilt.style.display = 'none';
                if (modeBuilt) modeBuilt.style.display = 'block';
                if (statusBadge) {
                    statusBadge.style.display = 'inline-flex';
                    let area = this.calculateArea(activeFd.points);
                    let fwNum = (activeIdx !== null && activeIdx !== undefined) ? (activeIdx + 1) : 1;
                    statusBadge.innerHTML = (isSv ? `● Fairway ${fwNum} (~${area} m²)` : `● Fairway ${fwNum} (~${area} m²)`);
                }

                // Show 3D studio group
                if (this.group) this.group.visible = true;

                // Sync bottom hint
                this.updateBottomHints();

                // Rebuild 3D handles & spline
                try {
                    this.rebuildHandles(hole, activeFd);
                    this.syncUIValues(hole, activeFd);
                } catch (err) {
                    console.error('FairwayStudio sync error:', err);
                } finally {
                    this.updateVisibility();
                }
            } else {
                if (modeUnbuilt) modeUnbuilt.style.display = 'flex';
                if (modeBuilt) modeBuilt.style.display = 'none';
                if (statusBadge) statusBadge.style.display = 'none';

                this.updateBottomHints();

                // Update unbuilt draw status & build button
                let pts = window.smartGreenPoints || [];
                let drawStatusEl = document.getElementById('sf-draw-status');
                let buildBtn = document.getElementById('sf-build-fairway-btn');

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
                    let fwNextNum = (fairways ? fairways.length + 1 : 1);
                    let btnLabel = (isSv ? `Skapa Fairway ${fwNextNum}` : `Create Fairway ${fwNextNum}`) + areaText;
                    buildBtn.innerHTML = '🏌️ ' + btnLabel;

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
            }
        }

        renderSelectorBar(hole, fairways, activeIdx, isSv) {
            let headerRow = document.getElementById('sf-header-row');
            let countEl = document.getElementById('sf-count');
            let addBtn = document.getElementById('sf-add-fairway-btn');
            let selectorBar = document.getElementById('sf-selector-bar');

            if (fairways && fairways.length > 0) {
                if (headerRow) headerRow.style.display = 'flex';
                if (countEl) countEl.textContent = fairways.length;

                let isDrawingNew = (activeIdx === null);
                if (addBtn) {
                    addBtn.style.cssText = isDrawingNew
                        ? 'background:rgba(56,189,248,0.25); color:#38bdf8; border:1px solid #38bdf8; border-radius:5px; padding:3px 8px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:3px; box-shadow:0 0 8px rgba(56,189,248,0.35);'
                        : 'background:#0f172a; color:#38bdf8; border:1px dashed rgba(56,189,248,0.6); border-radius:5px; padding:3px 8px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:3px; transition:all 0.2s;';
                    addBtn.innerHTML = `<span>➕</span> <span>${isSv ? 'Ny Fairway' : 'New Fairway'}</span>`;
                }

                if (selectorBar) {
                    selectorBar.style.display = 'flex';
                    selectorBar.innerHTML = '';

                    let count = fairways.length;
                    fairways.forEach((fd, idx) => {
                        let fArea = this.calculateArea(fd.points);
                        let isSelected = (activeIdx === idx);
                        let btn = document.createElement('button');
                        btn.type = 'button';
                        btn.title = `Fairway ${idx + 1} (~${fArea} m²)`;

                        let label = '';
                        if (count === 1) {
                            label = `<span>🏌️ Fairway 1</span><span style="font-size:8px; opacity:0.85;">(~${fArea}m²)</span>`;
                        } else if (count === 2) {
                            label = `<span>🏌️ FW ${idx + 1}</span><span style="font-size:8px; opacity:0.8;">(~${fArea}m²)</span>`;
                        } else {
                            label = `<span>🏌️ FW ${idx + 1}</span>`;
                        }

                        btn.style.cssText = isSelected 
                            ? 'flex:1 1 auto; min-width:48px; background:#7db952; color:#0f172a; border:1px solid #4ade80; border-radius:5px; padding:5px 6px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:3px; box-shadow:0 0 6px rgba(125,185,82,0.4); transition:all 0.15s;'
                            : 'flex:1 1 auto; min-width:48px; background:#1e293b; color:#94a3b8; border:1px solid #334155; border-radius:5px; padding:5px 6px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:3px; transition:all 0.15s;';
                        btn.innerHTML = label;
                        btn.onclick = () => {
                            if (typeof window.selectActiveFairway === 'function') {
                                window.selectActiveFairway(window.currentHoleIndex, idx);
                            }
                        };
                        selectorBar.appendChild(btn);
                    });

                    // Quick delete all if multiple fairways exist
                    if (count > 1) {
                        let delAllPill = document.createElement('button');
                        delAllPill.type = 'button';
                        delAllPill.title = isSv ? 'Radera alla fairways på hålet' : 'Delete all fairways on hole';
                        delAllPill.style.cssText = 'flex:0 0 auto; background:rgba(239,68,68,0.15); color:#ef4444; border:1px dashed #ef4444; border-radius:5px; padding:5px 7px; font-size:9.5px; font-weight:bold; cursor:pointer; transition:all 0.15s;';
                        delAllPill.innerHTML = '<span>🗑️</span>';
                        delAllPill.onclick = () => {
                            if (typeof window.deleteAllSmartFairways === 'function') {
                                window.deleteAllSmartFairways(window.currentHoleIndex);
                            }
                        };
                        selectorBar.appendChild(delAllPill);
                    }
                }
            } else {
                if (headerRow) headerRow.style.display = 'none';
                if (selectorBar) {
                    selectorBar.style.display = 'none';
                    selectorBar.innerHTML = '';
                }
            }
        }

        hide() {
            if (this.group) this.group.visible = false;
            this.clearHandles();
        }

        updateVisibility() {
            if (!this.group || !this.group.visible) return;

            // Handle spheres are interactive in Form tab
            let showHandles = (this.activeTab === 'form');
            for (let mesh of this.handleMeshes) {
                mesh.visible = showHandles;
            }

            // Spline is ALWAYS visible for active fairway in all tabs while editing!
            if (this.splineMesh) {
                this.splineMesh.visible = true;
            }
        }

        clearHandles() {
            for (let m of this.handleMeshes) {
                this.group.remove(m);
            }
            this.handleMeshes = [];
            if (this.splineMesh) {
                this.group.remove(this.splineMesh);
                this.splineMesh = null;
            }
        }

        rebuildHandles(hole, fd) {
            this.clearHandles();
            if (!hole || !fd || !fd.points || fd.points.length < 3) return;

            let pts = fd.points;
            let tension = 0.5;

            // Build closed CatmullRom spline
            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.25, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(160, pts.length * 35);
            let curvePts = curve.getPoints(samples);

            let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
            this.splineMesh = new THREE.Line(lineGeo, this.materials.spline);
            this.splineMesh.renderOrder = 997;
            this.group.add(this.splineMesh);

            // Build golf ball handles along contour
            pts.forEach((pt, idx) => {
                let ballMesh = new THREE.Mesh(this.geometries.ball, this.materials.ball);
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(pt.x, pt.z)
                    : (pt.y || 0);
                ballMesh.position.set(pt.x, y + 0.9, pt.z);
                ballMesh.renderOrder = 999;
                ballMesh.userData = { handleIndex: idx };
                ballMesh.visible = (this.activeTab === 'form');
                this.group.add(ballMesh);
                this.handleMeshes.push(ballMesh);
            });

            this.updateVisibility();
        }

        updateSplineOnly(hole, fd) {
            if (!hole || !fd || !this.splineMesh) return;
            let pts = fd.points;
            let tension = 0.5;

            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.25, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(160, pts.length * 35);
            let curvePts = curve.getPoints(samples);
            this.splineMesh.geometry.setFromPoints(curvePts);
            this.splineMesh.geometry.attributes.position.needsUpdate = true;
        }

        // ====================================================================
        // POINTER / MOUSE INTERACTIONS
        // ====================================================================
        onPointerDown(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartFairway = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'FAIRWAY');
            if (!isSmartFairway) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeFd = (typeof window.getActiveFairway === 'function') ? window.getActiveFairway(hole) : null;
            let hasBuiltFairway = !!(activeFd && activeFd.points && activeFd.points.length >= 3 && hole.activeFairwayIndex !== null);

            // ========================================================
            // MODE 1: INTERACTIVE NODES & SPLINE BEFORE FAIRWAY IS BUILT
            // ========================================================
            if (!hasBuiltFairway) {
                // 1. Check if clicking an existing golf ball handle in drawing mode
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
                                window._smartShapeClosed = true;
                                let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                                if (typeof window.showBuildToast === 'function') {
                                    window.showBuildToast(isSv ? '🔒 Fairwayformen är stängd! Klicka på [Bygg Fairway] för att skapa.' : '🔒 Fairway shape closed! Click [Build Fairway] to create.', '#7db952');
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

                // 2. Check if clicking spline line to insert a new node
                if (window.smartGreenPoints && window.smartGreenPoints.length >= 2 && lastHitPoint) {
                    let pts = window.smartGreenPoints;
                    let minEdgeDist = Infinity;
                    let insertIdx = -1;
                    let maxThreshold = 2.5; // within 2.5m of line
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
                        let y = (typeof window.getTerrainHeight === 'function')
                            ? window.getTerrainHeight(lastHitPoint.x, lastHitPoint.z)
                            : (lastHitPoint.y || 0);
                        let newPt = new THREE.Vector3(lastHitPoint.x, y, lastHitPoint.z);
                        pts.splice(insertIdx, 0, newPt);
                        if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                        this.sync();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny punkt infogad på linjen!' : '➕ New point inserted on line!', '#7db952');
                        }
                        return true;
                    }
                }

                // Return false to allow smartAddPoint to place next point on terrain
                return false;
            }

            // ========================================================
            // MODE 2: REDIGERA FAIRWAY (BUILT FAIRWAY)
            // ========================================================
            if (!activeFd) return false;

            // Only allow handle dragging and node insertion in Form tab
            if (this.activeTab === 'form' && this.handleMeshes.length > 0) {
                // 1. Check if clicking handle mesh
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (handleIdx !== undefined) {
                        this.draggingHandleIndex = handleIdx;
                        this.dragStartPoints = activeFd.points.map(p => ({ x: p.x, y: p.y, z: p.z }));
                        if (window.controls) window.controls.enabled = false;
                        hitMesh.material = this.materials.ballActive || this.materials.ballHover;
                        hitMesh.scale.set(1.25, 1.25, 1.25);
                        document.body.style.cursor = 'grabbing';
                        return true;
                    }
                }

                // 2. Check if clicking spline to insert a new node into built fairway
                if (this.splineMesh && lastHitPoint) {
                    let pts = activeFd.points;
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
                        window.saveUndoState();
                        let oldFd = { ...activeFd, points: activeFd.points.map(p => ({ ...p })) };
                        if (typeof window.restoreFairwayBase === 'function') {
                            window.restoreFairwayBase(hole, true, oldFd);
                        }

                        let newPt = { x: lastHitPoint.x, y: lastHitPoint.y || 0, z: lastHitPoint.z };
                        pts.splice(insertIdx, 0, newPt);

                        // Ensure SHARP edge
                        activeFd.edgeSharpness = 100;

                        let margin = (activeFd.semiRoughWidth || 2.0) + (activeFd.roughEnabled !== false ? (activeFd.roughWidth || 5.0) : 0) + 12;
                        let snap = window.captureFairwaySnapshot(hole, pts, margin);
                        activeFd.baseElevation = snap.baseElevation;
                        activeFd.bbox = snap.bbox;
                        activeFd.origHeights = snap.origHeights;
                        activeFd.origCanvasPixels = snap.origCanvasPixels;

                        if (typeof window.applyFairwayPipeline === 'function') {
                            window.applyFairwayPipeline(hole, false, true, activeFd);
                        }
                        this.rebuildHandles(hole, activeFd);
                        this.syncUIValues(hole, activeFd);

                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny nod tillagd på fairwayen!' : '➕ New fairway handle added!', '#7db952');
                        }
                        return true;
                    }
                }
            }

            return false;
        }

        onMouseMove(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartFairway = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'FAIRWAY');
            if (!isSmartFairway) return;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeFd = (typeof window.getActiveFairway === 'function') ? window.getActiveFairway(hole) : null;
            let hasBuiltFairway = !!(activeFd && activeFd.points && activeFd.points.length >= 3 && hole.activeFairwayIndex !== null);

            // Mode 1: Drag / Hover before build
            if (!hasBuiltFairway) {
                if (this.draggingDrawNodeIndex >= 0 && lastHitPoint) {
                    let idx = this.draggingDrawNodeIndex;
                    if (window.smartGreenPoints && window.smartGreenPoints[idx]) {
                        let pt = window.smartGreenPoints[idx];
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

            // Mode 2: Built Fairway Node Dragging & Hovering
            if (this.activeTab === 'form') {
                if (this.draggingHandleIndex >= 0 && lastHitPoint) {
                    let idx = this.draggingHandleIndex;
                    let pt = activeFd.points[idx];
                    if (pt) {
                        pt.x = lastHitPoint.x;
                        pt.z = lastHitPoint.z;

                        let mesh = this.handleMeshes[idx];
                        if (mesh) {
                            let y = (typeof window.getTerrainHeight === 'function')
                                ? window.getTerrainHeight(pt.x, pt.z)
                                : lastHitPoint.y;
                            mesh.position.set(pt.x, y + 0.9, pt.z);
                            mesh.scale.set(1.25, 1.25, 1.25);
                        }

                        this.updateSplineOnly(hole, activeFd);
                        this._pendingRebuild = true;
                    }
                    return;
                }

                // Hovering over handles
                if (this.handleMeshes.length > 0 && raycaster) {
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
        }

        onPointerUp(e) {
            let wasDragging = (this.draggingHandleIndex >= 0 || this.draggingDrawNodeIndex >= 0);

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

            // Mode 2: Finished dragging built fairway handle
            if (this.draggingHandleIndex >= 0) {
                let mesh = this.handleMeshes[this.draggingHandleIndex];
                if (mesh) {
                    mesh.material = this.materials.ball;
                    mesh.scale.set(1.0, 1.0, 1.0);
                }
                this.draggingHandleIndex = -1;

                let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
                let activeFd = (typeof window.getActiveFairway === 'function') ? window.getActiveFairway(hole) : null;

                if (hole && activeFd && this._pendingRebuild) {
                    // Restore pristine terrain heights & canvas using dragStartPoints
                    let oldFd = { ...activeFd, points: (this.dragStartPoints || activeFd.points) };
                    if (typeof window.restoreFairwayBase === 'function') {
                        window.restoreFairwayBase(hole, true, oldFd);
                    }
                    this.dragStartPoints = null;

                    // Ensure SHARP edge standard
                    activeFd.edgeSharpness = 100;

                    let margin = (activeFd.semiRoughWidth || 2.0) + (activeFd.roughEnabled !== false ? (activeFd.roughWidth || 5.0) : 0) + 12;
                    let snap = window.captureFairwaySnapshot(hole, activeFd.points, margin);
                    activeFd.baseElevation = snap.baseElevation;
                    activeFd.bbox = snap.bbox;
                    activeFd.origHeights = snap.origHeights;
                    activeFd.origCanvasPixels = snap.origCanvasPixels;

                    if (typeof window.applyFairwayPipeline === 'function') {
                        window.applyFairwayPipeline(hole, false, true, activeFd);
                    }

                    this.rebuildHandles(hole, activeFd);
                    this._pendingRebuild = false;
                    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
                    this.syncUIValues(hole, activeFd);
                }
            }

            if (window.controls) {
                window.controls.enabled = true;
            }
            document.body.style.cursor = 'default';
        }

        onRightClick(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartFairway = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'FAIRWAY');
            if (!isSmartFairway) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeFd = (typeof window.getActiveFairway === 'function') ? window.getActiveFairway(hole) : null;
            let hasBuiltFairway = !!(activeFd && activeFd.points && activeFd.points.length >= 3 && hole.activeFairwayIndex !== null);

            // Mode 1: Right-click specific golf ball deletes node
            if (!hasBuiltFairway && window.smartGreenSpheres && window.smartGreenSpheres.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(window.smartGreenSpheres, true);
                if (intersects.length > 0) {
                    let hit = intersects[0].object;
                    while (hit && hit.userData.pointIndex === undefined && hit.parent && hit.parent !== window._arcadeScene) {
                        hit = hit.parent;
                    }
                    let ptIdx = hit ? hit.userData.pointIndex : undefined;
                    if (ptIdx !== undefined && ptIdx >= 0 && window.smartGreenPoints && ptIdx < window.smartGreenPoints.length) {
                        window.smartGreenPoints.splice(ptIdx, 1);
                        this.clearDrawHover();
                        if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                        this.sync();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? `🗑️ Punkt #${ptIdx + 1} borttagen` : `🗑️ Point #${ptIdx + 1} removed`, '#f87171');
                        }
                        return true;
                    }
                }
                return false;
            }

            // Mode 2: Right-click handle deletes node from built fairway
            if (hasBuiltFairway && this.activeTab === 'form' && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    let pts = activeFd.points;
                    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

                    if (pts.length <= 3) {
                        window.showBuildToast(isSv ? '⚠️ Minst 3 punkter krävs för en fairway!' : '⚠️ Minimum 3 points required for fairway!', '#ef4444');
                        return true;
                    }

                    window.saveUndoState();
                    let oldFd = { ...activeFd, points: pts.map(p => ({ ...p })) };
                    if (typeof window.restoreFairwayBase === 'function') {
                        window.restoreFairwayBase(hole, true, oldFd);
                    }

                    pts.splice(handleIdx, 1);
                    activeFd.edgeSharpness = 100;

                    let margin = (activeFd.semiRoughWidth || 2.0) + (activeFd.roughEnabled !== false ? (activeFd.roughWidth || 5.0) : 0) + 12;
                    let snap = window.captureFairwaySnapshot(hole, pts, margin);
                    activeFd.baseElevation = snap.baseElevation;
                    activeFd.bbox = snap.bbox;
                    activeFd.origHeights = snap.origHeights;
                    activeFd.origCanvasPixels = snap.origCanvasPixels;

                    if (typeof window.applyFairwayPipeline === 'function') {
                        window.applyFairwayPipeline(hole, false, true, activeFd);
                    }
                    this.rebuildHandles(hole, activeFd);
                    this.syncUIValues(hole, activeFd);

                    window.showBuildToast(isSv ? '🗑️ Punkt raderad' : '🗑️ Point deleted', '#f87171');
                    return true;
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
                let ball = window.smartGreenSpheres[this.hoveredDrawNodeIndex];
                if (ball.material) ball.material = this.materials.ball;
                ball.scale.set(1.0, 1.0, 1.0);
                this.hoveredDrawNodeIndex = -1;
            }
        }

        distToSegment(px, pz, x1, z1, x2, z2) {
            let dx = x2 - x1;
            let dz = z2 - z1;
            let lenSq = dx * dx + dz * dz;
            if (lenSq === 0) return Math.hypot(px - x1, pz - z1);
            let t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
            let projX = x1 + t * dx;
            let projZ = z1 + t * dz;
            return Math.hypot(px - projX, pz - projZ);
        }

        calculateArea(points) {
            if (!points || points.length < 3) return 0;
            let area = 0;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                let p1 = points[j];
                let p2 = points[i];
                area += (p1.x + p2.x) * (p1.z - p2.z);
            }
            return Math.round(Math.abs(area / 2));
        }

        // ====================================================================
        // SYNC UI VALUES
        // ====================================================================
        syncUIValues(hole, fd) {
            if (!hole || !fd) return;

            // Ensure SHARP edge standard
            fd.edgeSharpness = 100;

            // Flik 1 (Form): Area card
            let areaVal = document.getElementById('sf-area-val');
            if (areaVal) {
                let area = this.calculateArea(fd.points);
                areaVal.textContent = `~${area} m²`;
            }

            // Flik 2 (Bredd & Terräng): Semi-rough
            let srS = document.getElementById('sf-semirough-width');
            let srV = document.getElementById('sf-semirough-val');
            let srw = fd.semiRoughWidth !== undefined ? fd.semiRoughWidth : 2.0;
            if (srS && document.activeElement !== srS) srS.value = srw;
            if (srV) srV.textContent = srw.toFixed(1) + 'm';

            // Flik 2 (Bredd & Terräng): Rough
            let rCb = document.getElementById('sf-rough-cb');
            if (rCb) rCb.checked = (fd.roughEnabled !== false);
            let rS = document.getElementById('sf-rough-width');
            let rV = document.getElementById('sf-rough-val');
            let rw = fd.roughWidth !== undefined ? fd.roughWidth : 5.0;
            if (rS && document.activeElement !== rS) rS.value = rw;
            if (rV) rV.textContent = rw.toFixed(0) + 'm';

            // Flik 2 (Bredd & Terräng): Difficulty cards
            let diff = fd.difficulty || 'FLAT';
            window._fairwayDifficulty = diff;
            ['flat', 'easy', 'med', 'hard'].forEach(d => {
                let card = document.getElementById('sf-diff-' + d);
                if (card) {
                    let match = (d.toUpperCase() === diff.toUpperCase());
                    card.style.borderColor = match ? '#7db952' : '#334155';
                    card.style.background = match ? 'rgba(125, 185, 82, 0.25)' : '#1e293b';
                    card.style.color = match ? '#7db952' : '#94a3b8';
                }
            });

            // Flik 3 (Klippning): Mowing Pattern cards
            let mp = fd.mowPattern || 'SOLID';
            window._smartMowPattern = mp;
            ['solid', 'stripes', 'checkerboard', 'diamond'].forEach(p => {
                let card = document.getElementById('sf-mow-' + p);
                if (card) {
                    let match = (p.toUpperCase() === mp.toUpperCase());
                    card.style.borderColor = match ? '#7db952' : '#334155';
                    card.style.background = match ? 'rgba(125, 185, 82, 0.25)' : '#1e293b';
                }
            });
        }

        update(dt) {
            // Can be used for handle easing/rotation if needed
        }
    }

    // Instantiate and expose globally
    window.FairwayStudio = new FairwayStudioEngine();

})();
