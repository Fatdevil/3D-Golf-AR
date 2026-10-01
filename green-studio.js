// ============================================================================
// green-studio.js - Dedicated 3D Green Studio for Smart Builder
// High-fidelity parametric green creation, node manipulation & slope physics
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

    class GreenStudioEngine {
        constructor() {
            this.active = false;
            this.activeTab = 'form';       // 'form' | 'lutning' | 'klippning'
            this.activeFormMode = 'edge';   // 'edge' | 'move' | 'scale' | 'rotate'

            // 3D scene elements
            this.group = null;
            this.handleMeshes = [];
            this.splineMesh = null;
            this.arrowGroup = null;
            this.contourGroup = null;

            // Interaction state
            this.hoveredHandleIndex = -1;
            this.draggingHandleIndex = -1;
            this.draggingWhole = null;     // {sx, sz, cx, cz} while the centre ring is dragged
            this.moveHandle = null;
            this._dragUndoSaved = false;
            this.dragStartPoints = null;
            this.draggingArrow = false;
            this.hoveredArrow = false;

            // Mode 1 draw node editing state (before green is built)
            this.draggingDrawNodeIndex = -1;
            this.hoveredDrawNodeIndex = -1;

            // Camera easing state
            this.camEasing = null;

            // Materials cache
            this.materials = {};
            this.geometries = {};

            // Internal flag for tracking changes
            this._pendingRebuild = false;
        }

        get isOpen() {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartGreen = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'GREEN');
            if (!isSmartGreen) return false;
            let sbPanel = document.getElementById('smart-green-action-panel') || document.getElementById('smart-builder-panel');
            if (sbPanel && sbPanel.style.display === 'none') return false;
            let pBuilt = document.getElementById('gs-panel-built');
            let panelVisible = pBuilt && pBuilt.style.display !== 'none';
            return panelVisible || !!(this.group && this.group.visible);
        }

        init(scene) {
            if (this.group) return; // already initialized
            this.scene = scene || window._arcadeScene;
            if (!this.scene) return;

            this.group = new THREE.Group();
            this.group.name = 'GreenStudioGroup';
            this.scene.add(this.group);

            // Create shared geometries (prominent size for easy clicking & dragging)
            this.geometries.ball = new THREE.SphereGeometry(0.85, 24, 24);
            this.geometries.activeBall = new THREE.SphereGeometry(1.05, 24, 24);
            this.geometries.arrowShaft = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 16);
            this.geometries.arrowCone = new THREE.ConeGeometry(0.35, 0.9, 16);

            // Create shared materials
            // Realistic dimpled golf ball look
            this.materials.ball = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.3,
                metalness: 0.05,
                depthTest: false
            });

            this.materials.ballHover = new THREE.MeshStandardMaterial({
                color: 0x4ade80,
                emissive: 0x22c55e,
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
                color: 0x4ade80,
                linewidth: 3,
                depthTest: false
            });

            this.materials.arrow = new THREE.MeshStandardMaterial({
                color: 0x38bdf8,
                emissive: 0x0284c7,
                emissiveIntensity: 0.6,
                roughness: 0.3,
                depthTest: false
            });

            this.materials.arrowTip = new THREE.MeshStandardMaterial({
                color: 0x67e8f9,
                emissive: 0x06b6d4,
                emissiveIntensity: 0.9,
                roughness: 0.2,
                depthTest: false
            });

            this.materials.contour = new THREE.LineBasicMaterial({
                color: 0x7dd3fc,
                transparent: true,
                opacity: 0.6,
                depthTest: false
            });


            this.contourGroup = new THREE.Group();
            this.contourGroup.name = 'GreenStudioContours';
            this.group.add(this.contourGroup);

            this.buildSlopeArrow();
            this.sync();
        }

        buildSlopeArrow() {
            if (this.arrowGroup) {
                this.group.remove(this.arrowGroup);
            }
            this.arrowGroup = new THREE.Group();
            this.arrowGroup.name = 'GreenStudioSlopeArrow';

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
        // TAB & MODE CONTROLS
        // ====================================================================
        // Completion ticks belong to one green: reset when the hole changes or the green is created/deleted
        _syncVisited() {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let key = window.currentHoleIndex + ':' + ((hole && hole.greenData) ? 'built' : 'none');
            if (this._visitedKey !== key) {
                this._visitedKey = key;
                this._visitedTabs = {};
                ['form', 'lutning', 'klippning'].forEach(t => {
                    let chk = document.getElementById('gs-tabchk-' + t);
                    if (chk) chk.textContent = '';
                });
            }
        }

        setTab(tabName) {
            this._syncVisited();
            this._visitedTabs = this._visitedTabs || {};
            if (this.activeTab) this._visitedTabs[this.activeTab] = true;   // the tab being left counts as visited (Form is shown without setTab)
            this.activeTab = tabName;
            this._visitedTabs[tabName] = true;
            ['form', 'lutning', 'klippning'].forEach(t => {
                let chk = document.getElementById('gs-tabchk-' + t);
                if (chk) chk.textContent = (t !== tabName && this._visitedTabs[t]) ? ' ✓' : '';
            });

            ['form', 'lutning', 'klippning'].forEach(t => {
                let tabBtn = document.getElementById('gs-tab-' + t);
                let content = document.getElementById('gs-content-' + t);
                if (tabBtn) {
                    if (t === tabName) {
                        tabBtn.style.background = '#4ade80';
                        tabBtn.style.color = '#0f172a';
                        tabBtn.style.boxShadow = '0 2px 8px rgba(74, 222, 128, 0.3)';
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

            try {
                // If entering Steg 2 (lutning) or global slope is active, ensure 3D green slope viz is built & visible
                let isGlobalSlope = !!window._globalGreenGridEnabled;
                if (tabName === 'lutning' || isGlobalSlope) {
                    let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
                    if (hole) {
                        if (window._greenSlopeMode === 'OFF') {
                            window._greenSlopeMode = 'GRID';
                            window._globalGreenGridEnabled = true;
                        }
                        this.rebuildSlopeViz(hole);
                    }
                } else {
                    // Leaving Steg 2: hide grid, beads and heatmap if not currently playing a round and global slope is not active
                    let isPlaying = (typeof playState !== 'undefined' && playState === 'ROUND_IDLE');
                    if (!isPlaying && !isGlobalSlope) {
                        if (window.greenGridMesh) window.greenGridMesh.visible = false;
                        if (window.greenHeatmapMesh) window.greenHeatmapMesh.visible = false;
                        if (typeof window.clearGreenBeads === 'function') {
                            window.clearGreenBeads();
                        } else if (window.greenBeads && window.greenBeads.length > 0) {
                            window.greenBeads.forEach(b => { if (window.greenBeadsGroup) window.greenBeadsGroup.remove(b); });
                            window.greenBeads = [];
                        }
                    }
                }
            } catch (err) {
                console.error('GreenStudio setTab grid rebuild error:', err);
            } finally {
                this.updateVisibility();
                this.updateBottomHints();
            }
        }

        rebuildSlopeViz(hole) {
            if (!hole) return;
            let mode = window._greenSlopeMode || (window._globalGreenGridEnabled ? 'GRID' : 'OFF');
            if (mode === 'HEATMAP') {
                if (window.greenGridMesh) window.greenGridMesh.visible = false;
                if (typeof window.clearGreenBeads === 'function') window.clearGreenBeads();
                if (typeof window.buildGreenHeatmapMesh === 'function') {
                    window.buildGreenHeatmapMesh(hole, window.currentHoleIndex, true);
                }
                if (window.greenHeatmapMesh) window.greenHeatmapMesh.visible = true;
            } else if (mode === 'GRID') {
                if (window.greenHeatmapMesh) window.greenHeatmapMesh.visible = false;
                if (typeof window.buildGreenGrid === 'function' && window._studioShowGrid !== false) {
                    window.buildGreenGrid(hole, window.currentHoleIndex, true);
                }
                if (window.greenGridMesh) window.greenGridMesh.visible = (window._studioShowGrid !== false);
            } else {
                if (window.greenGridMesh) window.greenGridMesh.visible = false;
                if (window.greenHeatmapMesh) window.greenHeatmapMesh.visible = false;
                if (typeof window.clearGreenBeads === 'function') window.clearGreenBeads();
            }
            if (typeof window.syncGreenSlopeUI === 'function') {
                window.syncGreenSlopeUI();
            }
        }

        updateBottomHints() {
            let th = document.getElementById('tool-hints');
            let curT = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            if (!th || curT !== 'SMART_BUILDER') return;

            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let isBuilt = !!(hole && hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3);

            if (!isBuilt) {
                th.innerHTML = isSv
                    ? "Vänsterklick: <b>Placera punkt</b><br>Högerklick: <b>Ångra punkt</b><br>Sätt ut minst 3 punkter och klicka Skapa green"
                    : "Left Click: <b>Place Point</b><br>Right Click: <b>Remove Last Point</b><br>Define shape, then Build";
                return;
            }

            if (this.activeTab === 'form') {
                th.innerHTML = isSv
                    ? "💡 <b>Dra de vita golfbollarna</b> för att justera formen • <b>Dra ringen</b> för att flytta hela greenen<br>Klicka på linjen för ny punkt • Högerklicka på boll för att ta bort"
                    : "💡 <b>Drag golf balls</b> to adjust shape • <b>Drag the ring</b> to move the whole green<br>Click line to add point • Right-click ball to remove";
            } else if (this.activeTab === 'lutning') {
                th.innerHTML = isSv
                    ? "💡 <b>Välj hur brant</b> och åt vilket håll greenen lutar, eller dra pilen i 3D<br>Golfbollarna kan dras för att anpassa formen samtidigt"
                    : "💡 <b>Pick how steep</b> and which way the green tilts, or drag the 3D arrow<br>Golf balls can also be dragged to shape simultaneously";
            } else if (this.activeTab === 'klippning') {
                th.innerHTML = isSv
                    ? "💡 <b>Välj gräsmönster</b> för greenen"
                    : "💡 <b>Pick a grass pattern</b> for the green";
            }
            if (typeof window.updateBottomHUDLayout === 'function') {
                window.updateBottomHUDLayout();
            }
        }

        toggleStudioGrid(enabled) {
            window._studioShowGrid = !!enabled;
            if (window.greenGridMesh) {
                window.greenGridMesh.visible = window._studioShowGrid;
            }
            if (window._studioShowGrid && (!window.greenGridMesh || window.greenGridForHoleIndex !== window.currentHoleIndex)) {
                let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
                if (hole && typeof window.buildGreenGrid === 'function') {
                    window.buildGreenGrid(hole, window.currentHoleIndex, true);
                }
            }
        }

        toggleStudioBeads(enabled) {
            window._studioShowBeads = !!enabled;
            if (!window._studioShowBeads) {
                if (typeof window.clearGreenBeads === 'function') {
                    window.clearGreenBeads();
                } else if (window.greenBeads && window.greenBeads.length > 0) {
                    window.greenBeads.forEach(b => { if (window.greenBeadsGroup) window.greenBeadsGroup.remove(b); });
                    window.greenBeads = [];
                }
            }
        }

        setFormMode(mode) {
            this.activeFormMode = mode || 'edge';
            let tipEl = document.getElementById('gs-form-tip-text');
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            if (tipEl) {
                tipEl.innerHTML = isSv
                    ? '💡 <b>Dra</b> de vita golfbollarna för att ändra form. <b>Dra ringen i mitten</b> för att flytta hela greenen. <b>Klicka på linjen</b> för ny punkt, <b>högerklicka</b> för att ta bort.'
                    : '💡 <b>Drag</b> golf balls to shape. <b>Drag the centre ring</b> to move the whole green. <b>Click spline</b> to add a point, <b>right-click</b> to delete one.';
            }
            this.updateVisibility();
        }

        // ====================================================================
        // SYNCHRONIZE STATE WITH COURSE DATA & UI
        // ====================================================================
        sync() {
            if (!this.group && window._arcadeScene) this.init(window._arcadeScene);
            this._syncVisited();
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartGreen = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'GREEN');

            let modeUnbuilt = document.getElementById('gs-panel-unbuilt');
            let modeBuilt = document.getElementById('gs-panel-built');
            let titleText = document.getElementById('gs-title-text');
            let statusBadge = document.getElementById('gs-status-badge');
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

            if (!isSmartGreen) {
                this.hide();
                return;
            }

            let hasBuiltGreen = (hole && hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3);

            if (hasBuiltGreen) {
                if (modeUnbuilt) modeUnbuilt.style.display = 'none';
                if (modeBuilt) modeBuilt.style.display = 'block';
                if (titleText) titleText.textContent = isSv ? 'Redigera green' : 'Edit Green';
                if (statusBadge) {
                    statusBadge.style.display = 'inline-flex';
                    statusBadge.innerHTML = '● ' + (isSv ? 'Sparad' : 'Saved');
                }

                // Show 3D studio group
                if (this.group) this.group.visible = true;

                // Sync bottom hint
                this.updateBottomHints();

                // Ensure existing green uses inward foregreen model
                if (hole.greenData && !hole.greenData._inwardForegreen && typeof window.applyGreenPipeline === 'function') {
                    hole.greenData._inwardForegreen = true;
                    window.applyGreenPipeline(hole, false, true);
                }

                // Sync 3D handles & spline
                try {
                    this.rebuildHandles(hole);
                    this.updateSlopeArrow(hole);
                    this.updateContourLines(hole);
                    this.syncUIValues(hole);
                    if (this.activeTab === 'lutning' || window._globalGreenGridEnabled) {
                        this.rebuildSlopeViz(hole);
                    }
                } catch (err) {
                    console.error('GreenStudio sync error:', err);
                } finally {
                    this.updateVisibility();
                }
            } else {
                if (modeUnbuilt) modeUnbuilt.style.display = 'flex';
                if (modeBuilt) modeBuilt.style.display = 'none';
                if (titleText) titleText.textContent = isSv ? 'Skapa green' : 'Create Green';
                if (statusBadge) statusBadge.style.display = 'none';

                this.updateBottomHints();

                // Update unbuilt draw status
                let pts = window.smartGreenPoints || [];
                let drawStatusEl = document.getElementById('gs-draw-status');
                let buildBtn = document.getElementById('gs-build-green-btn');

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
                    let area = 0;
                    if (pts.length >= 3) {
                        for (let i = 0; i < pts.length; i++) {
                            let next = (i + 1) % pts.length;
                            area += pts[i].x * pts[next].z - pts[next].x * pts[i].z;
                        }
                        area = Math.abs(area) / 2;
                    }
                    let areaText = (pts.length >= 3 && area > 0) ? (' (~' + Math.round(area) + ' m²)') : '';
                    let btnLabel = (isSv ? 'Skapa green' : 'Create Green') + areaText;
                    buildBtn.innerHTML = '⛳ ' + btnLabel;

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

                // Check for legacy un-adopted green flag
                let adoptRow = document.getElementById('gs-adopt-unbuilt-row');
                if (adoptRow) {
                    adoptRow.style.display = (hole && hole.flag) ? 'block' : 'none';
                }

                this.clearHandles();
                if (this.arrowGroup) this.arrowGroup.visible = false;
                if (this.contourGroup) this.contourGroup.clear();
            }
        }

        hide() {
            this.cancelWholeDrag();   // leaving the studio mid-drag must not commit a move later
            if (this.group) this.group.visible = false;
            this.clearHandles();
            let isPlaying = (typeof playState !== 'undefined' && playState === 'ROUND_IDLE');
            let isGlobalSlope = !!window._globalGreenGridEnabled;
            if (!isPlaying && !isGlobalSlope) {
                if (window.greenGridMesh) window.greenGridMesh.visible = false;
                if (typeof window.clearGreenBeads === 'function') {
                    window.clearGreenBeads();
                } else if (window.greenBeads && window.greenBeads.length > 0) {
                    window.greenBeads.forEach(b => { if (window.greenBeadsGroup) window.greenBeadsGroup.remove(b); });
                    window.greenBeads = [];
                }
            }
        }

        updateVisibility() {
            if (!this.group || !this.group.visible) return;

            // Handle spheres and spline visibility
            let showHandles = (this.activeTab === 'form' || this.activeTab === 'lutning');
            for (let mesh of this.handleMeshes) {
                mesh.visible = showHandles;
            }
            if (this.splineMesh) {
                this.splineMesh.visible = (this.activeTab === 'form' || this.activeTab === 'lutning');
            }
            if (this.moveHandle) {
                this.moveHandle.visible = (this.activeTab === 'form');
            }

            // Arrow visibility
            if (this.arrowGroup) {
                this.arrowGroup.visible = (this.activeTab === 'lutning');
            }

            // Contour lines visibility
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let showContours = hole && hole.greenData && hole.greenData.showContours;
            if (this.contourGroup) {
                this.contourGroup.visible = (this.activeTab === 'lutning' && !!showContours);
            }
        }

        // ====================================================================
        // 3D HANDLES & SPLINE MESHES
        // ====================================================================
        clearHandles() {
            for (let m of this.handleMeshes) {
                this.group.remove(m);
            }
            this.handleMeshes = [];
            if (this.moveHandle) {
                this.group.remove(this.moveHandle);
                this.moveHandle = null;
            }
            if (this.splineMesh) {
                this.group.remove(this.splineMesh);
                this.splineMesh = null;
            }
        }

        rebuildHandles(hole) {
            this.clearHandles();
            if (!hole || !hole.greenData || !hole.greenData.points) return;

            let pts = hole.greenData.points;
            let tension = 0.5;

            // Build closed CatmullRom spline
            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.18, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(120, pts.length * 30);
            let curvePts = curve.getPoints(samples);

            let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
            this.splineMesh = new THREE.Line(lineGeo, this.materials.spline);
            this.splineMesh.renderOrder = 997;
            this.group.add(this.splineMesh);

            // Build golf ball handles
            pts.forEach((pt, idx) => {
                let ballMesh = new THREE.Mesh(this.geometries.ball, this.materials.ball);
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(pt.x, pt.z)
                    : (pt.y || 0);
                ballMesh.position.set(pt.x, y + 0.85, pt.z);
                ballMesh.renderOrder = 999;
                ballMesh.userData = { handleIndex: idx };
                ballMesh.visible = (this.activeTab === 'form' || this.activeTab === 'lutning');
                this.group.add(ballMesh);
                this.handleMeshes.push(ballMesh);
            });

            // Centre ring: drag it to move the whole green (flag and pins follow)
            if (!this.geometries.moveRing) {
                this.geometries.moveRing = new THREE.TorusGeometry(1.6, 0.24, 10, 36);
                this.geometries.moveCore = new THREE.SphereGeometry(0.4, 16, 16);
                this.materials.move = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 0.7, roughness: 0.4 });
            }
            let cx = 0, cz = 0;
            pts.forEach(p => { cx += p.x; cz += p.z; });
            cx /= pts.length; cz /= pts.length;      // arithmetic centre: what moveSmartGreen expects
            // The ring itself must sit on the putting surface, so concave greens use a guaranteed interior point
            let hp = this._interiorPoint(pts, cx, cz);
            let cy = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(hp.x, hp.z) : 0;
            let ring = new THREE.Mesh(this.geometries.moveRing, this.materials.move);
            ring.rotation.x = Math.PI / 2;
            let core = new THREE.Mesh(this.geometries.moveCore, this.materials.move);
            let mh = new THREE.Group();
            mh.add(ring);
            mh.add(core);
            mh.position.set(hp.x, cy + 0.7, hp.z);
            mh.renderOrder = 999;
            mh.children.forEach(c => { c.renderOrder = 999; c.userData = { moveWhole: true }; });
            mh.userData = { moveWhole: true, cx: cx, cz: cz };
            mh.visible = (this.activeTab === 'form');
            this.group.add(mh);
            this.moveHandle = mh;

            this.updateVisibility();
        }

        // Point well inside the outline: the centre if it is inside, else the deepest point of a coarse grid search
        _interiorPoint(pts, cx, cz) {
            let dense = (typeof window.getDenseGreenPoints === 'function') ? window.getDenseGreenPoints(pts, 0.5) : pts;
            if (!dense || dense.length < 3 || typeof window.pointInPolygon !== 'function') return { x: cx, z: cz };
            if (window.pointInPolygon(cx, cz, dense)) return { x: cx, z: cz };
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            dense.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
            let best = null, bestD = -1;
            const N = 24;
            for (let i = 0; i <= N; i++) {
                for (let j = 0; j <= N; j++) {
                    let x = minX + (maxX - minX) * i / N, z = minZ + (maxZ - minZ) * j / N;
                    if (!window.pointInPolygon(x, z, dense)) continue;
                    let d = (typeof window.distToPolygon === 'function') ? window.distToPolygon(x, z, dense) : 0;
                    if (d > bestD) { bestD = d; best = { x: x, z: z }; }
                }
            }
            return best || { x: cx, z: cz };
        }

        updateSplineOnly(hole) {
            if (!hole || !hole.greenData || !this.splineMesh) return;
            let pts = hole.greenData.points;
            let tension = 0.5;

            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.18, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(120, pts.length * 30);
            let curvePts = curve.getPoints(samples);
            this.splineMesh.geometry.setFromPoints(curvePts);
            this.splineMesh.geometry.attributes.position.needsUpdate = true;
        }

        // ====================================================================
        // 3D SLOPE ARROW & COMPASS ROSE
        // ====================================================================
        updateSlopeArrow(hole) {
            if (!this.arrowGroup || !hole || !hole.greenData) return;
            let gd = hole.greenData;
            let pts = gd.points;
            if (!pts || pts.length < 3) return;

            // Centroid
            let cx = 0, cz = 0;
            for (let p of pts) { cx += p.x; cz += p.z; }
            cx /= pts.length; cz /= pts.length;
            let cy = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(cx, cz) : (gd.baseElevation || 0);

            this.arrowGroup.position.set(cx, cy + 0.25, cz);

            // Calculate tilt angle
            let angle = 0;
            if (gd.tiltToFlag !== false && hole.flag) {
                let fx = hole.flag.x !== undefined ? hole.flag.x : hole.flag.position.x;
                let fz = hole.flag.z !== undefined ? hole.flag.z : hole.flag.position.z;
                let dx = fx - cx;
                let dz = fz - cz;
                angle = Math.atan2(dx, dz);
                gd.tiltAngle = angle;
            } else if (gd.tiltAngle !== undefined) {
                angle = gd.tiltAngle;
            }

            this.arrowGroup.rotation.y = angle;

            // Update HTML Compass Rose needle
            let needle = document.getElementById('gs-compass-needle');
            let degText = document.getElementById('gs-compass-deg');
            let deg = Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360);
            if (needle) needle.style.transform = `rotate(${deg}deg)`;
            if (degText) {
                let card = this.getCardinalName(deg);
                degText.textContent = `${deg}° ${card}`;
            }
        }

        getCardinalName(deg) {
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let dirsSv = ['Nord', 'Nordost', 'Ost', 'Sydost', 'Syd', 'Sydväst', 'Väst', 'Nordväst'];
            let dirsEn = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
            let idx = Math.round(deg / 45) % 8;
            return isSv ? dirsSv[idx] : dirsEn[idx];
        }

        setTiltDirection(deg) {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            if (!hole || !hole.greenData) return;
            let gd = hole.greenData;
            gd.tiltToFlag = false;
            let rad = (deg * Math.PI) / 180;
            gd.tiltAngle = rad;

            // Sync Mot flaggan switch
            let flagCb = document.getElementById('gs-tilt-to-flag-cb');
            if (flagCb) flagCb.checked = false;

            this.updateSlopeArrow(hole);
            window.applyGreenPipeline(hole, false, false);
            if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
            if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
        }

        // ====================================================================
        // 3D CONTOUR LINES (HÖJDKURVOR)
        // ====================================================================
        updateContourLines(hole) {
            if (!this.contourGroup) return;
            this.contourGroup.clear();

            if (!hole || !hole.greenData || !hole.greenData.showContours) return;
            let gd = hole.greenData;
            let pts = gd.points;
            if (!pts || pts.length < 3) return;

            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (let p of pts) {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
            }

            let step = 0.8;
            let isoStep = 0.10; // 10 cm contour lines
            let lineSegments = [];

            // Grid sample elevation and build isoline segments
            for (let x = minX; x <= maxX; x += step) {
                for (let z = minZ; z <= maxZ; z += step) {
                    if (!window.pointInPolygon(x, z, pts)) continue;
                    let h00 = window.getTerrainHeight(x, z);
                    let h10 = window.getTerrainHeight(x + step, z);
                    let h01 = window.getTerrainHeight(x, z + step);

                    // Check if an isoline passes through horizontal segment
                    let minH = Math.min(h00, h10);
                    let maxH = Math.max(h00, h10);
                    let isoH = Math.ceil(minH / isoStep) * isoStep;
                    if (isoH >= minH && isoH <= maxH && Math.abs(h10 - h00) > 0.001) {
                        let t = (isoH - h00) / (h10 - h00);
                        let pX = x + t * step;
                        let pZ = z;
                        lineSegments.push(new THREE.Vector3(pX, isoH + 0.06, pZ));
                        lineSegments.push(new THREE.Vector3(pX + 0.15, isoH + 0.06, pZ + 0.15));
                    }
                }
            }

            if (lineSegments.length > 0) {
                let geo = new THREE.BufferGeometry().setFromPoints(lineSegments);
                let lines = new THREE.LineSegments(geo, this.materials.contour);
                lines.renderOrder = 996;
                this.contourGroup.add(lines);
            }
        }

        // ====================================================================
        // CAMERA EASING TO GREEN
        // ====================================================================
        focusCameraOnGreen() {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            if (!hole || !hole.greenData || !hole.greenData.points || !window.controls) return;
            let pts = hole.greenData.points;
            let cx = 0, cz = 0;
            for (let p of pts) { cx += p.x; cz += p.z; }
            cx /= pts.length; cz /= pts.length;
            let cy = (typeof window.getTerrainHeight === 'function') ? window.getTerrainHeight(cx, cz) : 0;

            let targetLook = new THREE.Vector3(cx, cy, cz);
            let targetCam = new THREE.Vector3(cx - 18, cy + 16, cz + 18);

            this.camEasing = {
                startLook: window.controls.target.clone(),
                endLook: targetLook,
                startPos: window._arcadeCamera.position.clone(),
                endPos: targetCam,
                startTime: performance.now(),
                duration: 650
            };
        }

        // ====================================================================
        // ANIMATION LOOP UPDATE (called from animate())
        // ====================================================================
        update(dt) {
            // 1. Camera easing
            if (this.camEasing) {
                let elapsed = performance.now() - this.camEasing.startTime;
                let t = Math.min(1.0, elapsed / this.camEasing.duration);
                // Cubic ease-out
                let ease = 1 - Math.pow(1 - t, 3);

                window.controls.target.lerpVectors(this.camEasing.startLook, this.camEasing.endLook, ease);
                window._arcadeCamera.position.lerpVectors(this.camEasing.startPos, this.camEasing.endPos, ease);

                if (t >= 1.0) {
                    this.camEasing = null;
                }
            }
        }

        // ====================================================================
        // EVENT HANDLERS (POINTERDOWN, MOVE, UP, RIGHTCLICK)
        // ====================================================================
        onPointerDown(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartGreen = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'GREEN');
            if (!isSmartGreen) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let hasBuiltGreen = (hole && hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3);

            // ========================================================
            // MODE 1: INTERACTIVE NODES & SPLINE BEFORE GREEN IS BUILT
            // ========================================================
            if (!hasBuiltGreen) {
                // 1. Check if clicking an existing golf ball handle
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
                                    window.showBuildToast(isSv ? '🔒 Greenformen är stängd! Klicka på [Bygg Green] för att skapa.' : '🔒 Green shape closed! Click [Build Green] to create.', '#4ade80');
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

                // 2. Check if clicking spline to insert a new golf ball node
                if (window.smartGreenPoints && window.smartGreenPoints.length >= 2 && lastHitPoint) {
                    let pts = window.smartGreenPoints;
                    let minEdgeDist = Infinity;
                    let insertIdx = -1;
                    let maxThreshold = window.smartInsertRadius(pts); // within 2.5m of spline
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
                        if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny golfboll infogad på linjen!' : '➕ New golf ball inserted on line!', '#4ade80');
                        }
                        return true;
                    }
                }

                // Return false so smartAddPoint in arcade.html places next point on terrain
                return false;
            }

            // ========================================================
            // MODE 2: REDIGERA GREEN (BUILT GREEN)
            // ========================================================
            if (!hole || !hole.greenData) return false;

            // Centre ring: start moving the whole green
            if (this.activeTab === 'form' && this.moveHandle && this.moveHandle.visible && raycaster && lastHitPoint) {
                let ringHits = raycaster.intersectObject(this.moveHandle, true);
                let ballHits = this.handleMeshes.length ? raycaster.intersectObjects(this.handleMeshes) : [];
                // a golf ball in front of the ring wins, so boundary points stay draggable
                if (ringHits.length > 0 && (ballHits.length === 0 || ringHits[0].distance <= ballHits[0].distance)) {
                    this.draggingWhole = { sx: lastHitPoint.x, sz: lastHitPoint.z, cx: this.moveHandle.userData.cx, cz: this.moveHandle.userData.cz, dx: 0, dz: 0, hole: window.currentHoleIndex, pointerId: (e && e.pointerId !== undefined) ? e.pointerId : null };
                    if (window.controls) window.controls.enabled = false;
                    document.body.style.cursor = 'grabbing';
                    return true;
                }
            }

            // Check if clicking golf ball handle
            if ((this.activeTab === 'form' || this.activeTab === 'lutning') && this.handleMeshes.length > 0) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (handleIdx !== undefined) {
                        this.draggingHandleIndex = handleIdx;
                        if (hole && hole.greenData && hole.greenData.points) {
                            this.dragStartPoints = hole.greenData.points.map(p => ({ x: p.x, y: p.y, z: p.z }));
                        }
                        if (window.controls) window.controls.enabled = false;
                        hitMesh.material = this.materials.ballActive || this.materials.ballHover;
                        hitMesh.scale.set(1.25, 1.25, 1.25);
                        return true;
                    }
                }

                // Check if clicking spline to insert a new node
                if (this.splineMesh && lastHitPoint) {
                    let pts = hole.greenData.points;
                    let minEdgeDist = Infinity;
                    let insertIdx = -1;
                    let maxThreshold = window.smartInsertRadius(pts); // within 2.5m of spline

                    for (let i = 0; i < pts.length; i++) {
                        let next = (i + 1) % pts.length;
                        let p0 = pts[i];
                        let p1 = pts[next];

                        // Distance from point to line segment
                        let d = this.distToSegment(lastHitPoint.x, lastHitPoint.z, p0.x, p0.z, p1.x, p1.z);
                        if (d < minEdgeDist && d < maxThreshold) {
                            minEdgeDist = d;
                            insertIdx = next;
                        }
                    }

                    if (insertIdx !== -1) {
                        if (window.insertWouldCross(pts, insertIdx, lastHitPoint.x, lastHitPoint.z)) { window.warnSelfCrossing(); return true; }
                        window.saveUndoState();
                        let oldGd = { ...hole.greenData, points: (hole.greenData.lastBuiltPoints || hole.greenData.points) };
                        window.restoreGreenBase(hole, true, oldGd);

                        let newPt = { x: lastHitPoint.x, y: lastHitPoint.y || 0, z: lastHitPoint.z };
                        pts.splice(insertIdx, 0, newPt);

                        let snap = window.captureGreenSnapshot(hole, pts, 25);
                        hole.greenData.baseElevation = snap.baseElevation;
                        hole.greenData.bbox = snap.bbox;
                        hole.greenData.origHeights = snap.origHeights;
                        hole.greenData.origCanvasPixels = snap.origCanvasPixels;

                        window.applyGreenPipeline(hole, false, true);
                        this.rebuildHandles(hole);
                        if (this.activeTab === 'lutning' || window._globalGreenGridEnabled) {
                            this.rebuildSlopeViz(hole);
                        }
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        window.showBuildToast(isSv ? '➕ Ny nod tillagd på greenen!' : '➕ New green handle added!', '#4ade80');
                        return true;
                    }
                }
            }

            // Check if clicking 3D slope arrow tip in Lutning tab
            if (this.activeTab === 'lutning' && this.arrowGroup && this.arrowGroup.visible) {
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
            let isSmartGreen = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'GREEN');
            if (!isSmartGreen) return;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let hasBuiltGreen = (hole && hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3);

            // ========================================================
            // MODE 1: LIVE DRAG & HOVER BEFORE GREEN IS BUILT
            // ========================================================
            if (!hasBuiltGreen) {
                // 0a. Dragging draw node in Mode 1
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
                    if (d < window.smartSnapRadius(window.smartGreenPoints)) {
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

                // 0b. Hovering over draw nodes in Mode 1
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
            // MODE 2: LIVE DRAG & HOVER (BUILT GREEN)
            // ========================================================
            if (!hole || !hole.greenData) return;

            // 1. Dragging golf ball handle
            if (this.draggingHandleIndex >= 0 && lastHitPoint) {
                let idx = this.draggingHandleIndex;
                let pt = hole.greenData.points[idx];
                if (pt) {
                    if (window.moveWouldCross(hole.greenData.points, idx, lastHitPoint.x, lastHitPoint.z, true)) { document.body.style.cursor = 'not-allowed'; return; }
                    // Undo point = state BEFORE the first movement of this drag
                    if (!this._dragUndoSaved) { this._dragUndoSaved = true; window.saveUndoState(); }
                    pt.x = lastHitPoint.x;
                    pt.z = lastHitPoint.z;

                    // Update handle mesh position
                    let mesh = this.handleMeshes[idx];
                    if (mesh) {
                        let y = (typeof window.getTerrainHeight === 'function')
                            ? window.getTerrainHeight(pt.x, pt.z)
                            : lastHitPoint.y;
                        mesh.position.set(pt.x, y + 0.85, pt.z);
                        mesh.scale.set(1.25, 1.25, 1.25);
                    }

                    // Live 60 FPS spline update
                    this.updateSplineOnly(hole);
                    this._pendingRebuild = true;
                }
                return;
            }

            // 1b. Dragging the whole green: the studio group slides as a ghost, the terrain is rebuilt on drop
            if (this.draggingWhole) {
                if (lastHitPoint && this._isDragPointer(e)) {
                    let w = this.draggingWhole;
                    w.dx = lastHitPoint.x - w.sx;
                    w.dz = lastHitPoint.z - w.sz;
                    this.group.position.set(w.dx, 0, w.dz);
                }
                return;
            }

            // 2. Dragging slope arrow tip
            if (this.draggingArrow && lastHitPoint) {
                let cx = this.arrowGroup.position.x;
                let cz = this.arrowGroup.position.z;
                let dx = lastHitPoint.x - cx;
                let dz = lastHitPoint.z - cz;
                let angle = Math.atan2(dx, dz);
                let deg = Math.round(((angle * 180 / Math.PI) % 360 + 360) % 360);
                this.setTiltDirection(deg);
                return;
            }

            // 3a. Hovering the centre ring
            if (this.activeTab === 'form' && this.moveHandle && this.moveHandle.visible && raycaster) {
                let ringHits2 = raycaster.intersectObject(this.moveHandle, true);
                let ballHits2 = this.handleMeshes.length ? raycaster.intersectObjects(this.handleMeshes) : [];
                let overRing = ringHits2.length > 0 && (ballHits2.length === 0 || ringHits2[0].distance <= ballHits2[0].distance);
                if (overRing) {
                    document.body.style.cursor = 'move';
                    this._ringHover = true;
                    return;
                } else if (this._ringHover) {
                    this._ringHover = false;
                    document.body.style.cursor = 'default';
                }
            }

            // 3. Hovering over handles
            if ((this.activeTab === 'form' || this.activeTab === 'lutning') && this.handleMeshes.length > 0 && raycaster) {
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

        // Pointer cancelled or window lost focus mid-drag: drop the ghost without moving the green
        // True when the event belongs to the pointer that started the whole-green drag (or carries no pointer id)
        _isDragPointer(e) {
            let w = this.draggingWhole;
            if (!w || w.pointerId === null || w.pointerId === undefined) return true;
            return !e || e.pointerId === undefined || e.pointerId === w.pointerId;
        }

        cancelWholeDrag(e) {
            if (!this.draggingWhole) return;
            if (e && !this._isDragPointer(e)) return;
            this.draggingWhole = null;
            if (this.group) this.group.position.set(0, 0, 0);
            if (window.controls) window.controls.enabled = true;
            document.body.style.cursor = 'default';
        }

        onPointerUp(e) {
            let wasDragging = (this.draggingHandleIndex >= 0 || this.draggingArrow || this.draggingDrawNodeIndex >= 0 || !!this.draggingWhole);

            // Dropped the centre ring: move the green (flag, pins and terrain follow) unless it barely moved
            if (this.draggingWhole) {
                if (!this._isDragPointer(e)) return;   // another finger/pointer: ignore until the dragging one ends
                let w = this.draggingWhole;
                this.draggingWhole = null;
                this.group.position.set(0, 0, 0);
                if (window.controls) window.controls.enabled = true;
                document.body.style.cursor = 'default';
                let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
                let sameContext = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'GREEN' && w.hole === window.currentHoleIndex);
                if (sameContext && Math.hypot(w.dx, w.dz) >= 0.5 && typeof window.moveSmartGreen === 'function') {
                    window.moveSmartGreen(w.hole, w.cx + w.dx, w.cz + w.dz);
                }
                return;
            }

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
                if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
            }

            if (this.draggingHandleIndex >= 0) {
                let mesh = this.handleMeshes[this.draggingHandleIndex];
                if (mesh) {
                    mesh.material = this.materials.ball;
                    mesh.scale.set(1.0, 1.0, 1.0);
                }
                this.draggingHandleIndex = -1;
                this._dragUndoSaved = false;

                // Re-sculpt terrain & repaint 2D canvas on drop
                let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
                if (hole && hole.greenData && this._pendingRebuild) {
                    let oldGd = { ...hole.greenData, points: (this.dragStartPoints || hole.greenData.lastBuiltPoints || hole.greenData.points) };
                    window.restoreGreenBase(hole, true, oldGd);
                    this.dragStartPoints = null;

                    let snap = window.captureGreenSnapshot(hole, hole.greenData.points, 25);
                    hole.greenData.baseElevation = snap.baseElevation;
                    hole.greenData.bbox = snap.bbox;
                    hole.greenData.origHeights = snap.origHeights;
                    hole.greenData.origCanvasPixels = snap.origCanvasPixels;

                    window.applyGreenPipeline(hole, false, true);
                    this.rebuildHandles(hole);
                    this.updateSlopeArrow(hole);
                    if (this.activeTab === 'lutning' || window._globalGreenGridEnabled) {
                        this.rebuildSlopeViz(hole);
                    }
                    this._pendingRebuild = false;
                    if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
                    if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
                }
            }

            if (this.draggingArrow) {
                this.draggingArrow = false;
            }

            if (window.controls) {
                window.controls.enabled = true;
            }
            document.body.style.cursor = 'default';
        }

        onRightClick(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartGreen = (curTool === 'SMART_BUILDER' && window._smartBuilderType === 'GREEN');
            if (!isSmartGreen) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let hasBuiltGreen = (hole && hole.greenData && hole.greenData.points && hole.greenData.points.length >= 3);

            // ========================================================
            // MODE 1: RIGHT-CLICK SPECIFIC GOLF BALL DELETES NODE
            // ========================================================
            if (!hasBuiltGreen && window.smartGreenSpheres && window.smartGreenSpheres.length > 0 && raycaster) {
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
                        if (typeof window.updateSBGreenControls === 'function') window.updateSBGreenControls();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? `🗑️ Boll #${ptIdx + 1} borttagen` : `🗑️ Ball #${ptIdx + 1} removed`, '#f87171');
                        }
                        return true;
                    }
                }
                return false;
            }

            // ========================================================
            // MODE 2: RIGHT-CLICK HANDLE DELETES BUILT GREEN NODE
            // ========================================================
            if (!hole || !hole.greenData) return false;

            // Right-click on golf ball handle deletes that point
            if ((this.activeTab === 'form' || this.activeTab === 'lutning') && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    let pts = hole.greenData.points;
                    let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

                    if (pts.length <= 3) {
                        window.showBuildToast(isSv ? '⚠️ Minst 3 punkter krävs för en green!' : '⚠️ Minimum 3 points required for green!', '#ef4444');
                        return true;
                    }

                    window.saveUndoState();
                    let oldGd = { ...hole.greenData, points: (hole.greenData.lastBuiltPoints || hole.greenData.points) };
                    window.restoreGreenBase(hole, true, oldGd);

                    pts.splice(handleIdx, 1);

                    let snap = window.captureGreenSnapshot(hole, pts, 25);
                    hole.greenData.baseElevation = snap.baseElevation;
                    hole.greenData.bbox = snap.bbox;
                    hole.greenData.origHeights = snap.origHeights;
                    hole.greenData.origCanvasPixels = snap.origCanvasPixels;

                    window.applyGreenPipeline(hole, false, true);
                    this.rebuildHandles(hole);
                    if (this.activeTab === 'lutning' || window._globalGreenGridEnabled) {
                        this.rebuildSlopeViz(hole);
                    }
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
                let s = window.smartGreenSpheres[this.hoveredDrawNodeIndex];
                if (s && s.material) s.material = this.materials.ball;
                if (s) s.scale.set(1.0, 1.0, 1.0);
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

        // ====================================================================
        // SYNC UI SLIDERS & BUTTON STATES WITH HOLE DATA
        // ====================================================================
        syncUIValues(hole) {
            if (!hole || !hole.greenData) return;
            let gd = hole.greenData;

            // Ensure locked defaults
            if (gd.tension === undefined) gd.tension = 0.5;
            if (gd.edgeSharpness === undefined) gd.edgeSharpness = 100;

            // Form Tab: Foregreen Slider
            let fgSlider = document.getElementById('gs-foregreen-slider');
            let fgVal = document.getElementById('gs-foregreen-val');
            if (fgSlider) {
                let w = (gd.foregreenWidth !== undefined) ? gd.foregreenWidth : 1.0;
                if (document.activeElement !== fgSlider) fgSlider.value = w;
                if (fgVal) fgVal.textContent = w.toFixed(2) + 'm';
            }

            // Lutning & Höjd Tab: Blend (Slänt) Slider
            let blendSlider = document.getElementById('gs-blend-slider');
            let blendVal = document.getElementById('gs-blend-val');
            if (blendSlider) {
                let b = (gd.blendDistance !== undefined) ? gd.blendDistance : 8.0;
                if (document.activeElement !== blendSlider) blendSlider.value = b;
                if (blendVal) blendVal.textContent = b.toFixed(0) + 'm';
            }

            // Lutning Tab: Presets, Slider, Toggles
            let tiltPct = (gd.tiltPct !== undefined) ? gd.tiltPct * 100 : 2.0;
            let tiltSlider = document.getElementById('gs-tilt-slider');
            let tiltVal = document.getElementById('gs-tilt-val');
            if (tiltSlider && document.activeElement !== tiltSlider) tiltSlider.value = tiltPct;
            if (tiltVal) tiltVal.textContent = tiltPct.toFixed(1) + '%';

            // Slope preset cards highlight
            let curDiff = gd.difficulty || 'FLAT';
            ['flat', 'easy', 'med', 'hard'].forEach(d => {
                let btn = document.getElementById('gs-slope-card-' + d);
                if (btn) {
                    let match = (d.toUpperCase() === curDiff.toUpperCase());
                    btn.style.background = match ? 'rgba(56, 189, 248, 0.25)' : '#1e293b';
                    btn.style.borderColor = match ? '#38bdf8' : '#334155';
                    btn.style.color = match ? '#38bdf8' : '#94a3b8';
                }
            });

            // Green height slider
            let elevSlider = document.getElementById('gs-elev-slider');
            let elevVal = document.getElementById('gs-elev-val');
            let ev = gd.elevationOffset !== undefined ? gd.elevationOffset : 0.0;
            if (elevSlider && document.activeElement !== elevSlider) elevSlider.value = ev;
            if (elevVal) elevVal.textContent = (ev >= 0 ? '+' : '') + ev.toFixed(1) + 'm';

            // Mot flaggan switch
            let flagCb = document.getElementById('gs-tilt-to-flag-cb');
            if (flagCb) flagCb.checked = (gd.tiltToFlag !== false);

            // Höjdkurvor toggle
            let contourCb = document.getElementById('gs-show-contours-cb');
            if (contourCb) contourCb.checked = !!gd.showContours;

            // 3D Rutnät & Fallinjer toggles
            let gridCb = document.getElementById('gs-show-grid-cb');
            if (gridCb) gridCb.checked = (window._studioShowGrid !== false);

            let beadsCb = document.getElementById('gs-show-beads-cb');
            if (beadsCb) beadsCb.checked = (window._studioShowBeads !== false);

            // Klippning Tab: Mow patterns (Slät, Ränder, Schack, Diamant)
            let mp = gd.mowPattern || 'SOLID';
            ['solid', 'stripes', 'checkerboard', 'diamond'].forEach(p => {
                let card = document.getElementById('gs-mow-' + p);
                if (card) {
                    let match = (p.toUpperCase() === mp.toUpperCase());
                    card.style.borderColor = match ? '#4ade80' : '#334155';
                    card.style.background = match ? 'rgba(74, 222, 128, 0.15)' : '#1e293b';
                }
            });
        }
    }

    // Instantiate and expose globally
    window.GreenStudio = new GreenStudioEngine();

    // Helper functions for UI clicks
    window.rotateSmartGreen = function(holeIndex, dDeg) {
        if (holeIndex === undefined) holeIndex = window.currentHoleIndex;
        let hole = window.courseHoles && window.courseHoles[holeIndex];
        if (!hole || !hole.greenData) return;

        window.saveUndoState();
        let gd = hole.greenData;
        let oldGd = { ...gd, points: (gd.lastBuiltPoints || gd.points) };
        window.restoreGreenBase(hole, true, oldGd);

        let cx = 0, cz = 0;
        for (let pt of gd.points) { cx += pt.x; cz += pt.z; }
        cx /= gd.points.length; cz /= gd.points.length;

        let dRad = (dDeg * Math.PI) / 180;
        let cosA = Math.cos(dRad);
        let sinA = Math.sin(dRad);

        for (let pt of gd.points) {
            let rx = pt.x - cx;
            let rz = pt.z - cz;
            pt.x = cx + rx * cosA - rz * sinA;
            pt.z = cz + rx * sinA + rz * cosA;
        }

        if (hole.flag) {
            let fx = (hole.flag.x !== undefined ? hole.flag.x : hole.flag.position.x) - cx;
            let fz = (hole.flag.z !== undefined ? hole.flag.z : hole.flag.position.z) - cz;
            let nfx = cx + fx * cosA - fz * sinA;
            let nfz = cz + fx * sinA + fz * cosA;
            if (hole.flag.x !== undefined) {
                hole.flag.x = nfx;
                hole.flag.z = nfz;
            } else if (hole.flag.position) {
                hole.flag.position.x = nfx;
                hole.flag.position.z = nfz;
            }
        }

        let snap = window.captureGreenSnapshot(hole, gd.points, 25);
        gd.baseElevation = snap.baseElevation;
        gd.bbox = snap.bbox;
        gd.origHeights = snap.origHeights;
        gd.origCanvasPixels = snap.origCanvasPixels;

        window.applyGreenPipeline(hole, false, true);
        if (window.GreenStudio) window.GreenStudio.sync();
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);

        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        window.showBuildToast(isSv ? `↻ Green roterad ${dDeg > 0 ? '+' : ''}${dDeg}°` : `↻ Green rotated ${dDeg > 0 ? '+' : ''}${dDeg}°`, '#4ade80');
    };

    window.resetGreenSlope = function() {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (!hole || !hole.greenData) return;
        hole.greenData.difficulty = 'FLAT';
        hole.greenData.tiltPct = 0.005;
        hole.greenData.elevationOffset = 0.0;
        hole.greenData.tiltToFlag = true;
        window.applyGreenPipeline(hole, false, false);
        if (window.GreenStudio) window.GreenStudio.sync();
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        window.showBuildToast(isSv ? '↺ Greenlutning nollställd' : '↺ Green slope reset', '#38bdf8');
    };

    window.resetGreenMowing = function() {
        let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
        if (!hole || !hole.greenData) return;
        hole.greenData.stimp = 10.0;
        hole.greenData.mowPattern = 'SOLID';
        hole.greenData.firmness = 'NORMAL';
        window.applyGreenPipeline(hole, false, true);
        if (window.GreenStudio) window.GreenStudio.sync();
        if (typeof window.debounceSaveCourse === 'function') window.debounceSaveCourse(1500);
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        window.showBuildToast(isSv ? '↺ Klippning återställd till standard' : '↺ Mowing reset to default', '#4ade80');
    };

})();
