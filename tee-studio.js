// ============================================================================
// tee-studio.js - Dedicated 3D Multi-Tee Studio for Smart Builder
// High-fidelity parametric tee box manipulation, 3D golf ball handles,
// active cyan outline, multi-tee support, live spline & terrain pipeline
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

    class TeeStudioEngine {
        constructor() {
            this.active = false;
            this.activeTab = 'form';       // 'form' | 'hojd' | 'klippning'

            // 3D scene elements
            this.group = null;
            this.handleMeshes = [];
            this.outlineMesh = null;

            // Interaction state
            this.hoveredHandleIndex = -1;
            this.draggingHandleIndex = -1;
            this._dragUndoSaved = false;
            this.dragStartPoints = null;

            // Mode 1 draw node editing state (before tee box is built)
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
            let isSmartTee = (curTool === 'SMART_BUILDER' && (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM'));
            if (!isSmartTee) return false;
            let sbPanel = document.getElementById('smart-green-action-panel') || document.getElementById('smart-builder-panel');
            if (sbPanel && sbPanel.style.display === 'none') return false;
            let pBuilt = document.getElementById('st-panel-built');
            let panelVisible = pBuilt && pBuilt.style.display !== 'none';
            return panelVisible || !!(this.group && this.group.visible);
        }

        init(scene) {
            if (this.group) return; // already initialized
            this.scene = scene || window._arcadeScene;
            if (!this.scene) return;

            this.group = new THREE.Group();
            this.group.name = 'TeeStudioGroup';
            this.scene.add(this.group);

            // Shared geometries
            this.geometries.ball = new THREE.SphereGeometry(0.85, 24, 24);
            this.geometries.activeBall = new THREE.SphereGeometry(1.05, 24, 24);

            // Shared materials
            // Realistic white golf ball
            this.materials.ball = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.3,
                metalness: 0.05,
                depthTest: false
            });

            // Sky blue hover (0x38bdf8)
            this.materials.ballHover = new THREE.MeshStandardMaterial({
                color: 0x38bdf8,
                emissive: 0x0284c7,
                emissiveIntensity: 0.8,
                roughness: 0.2,
                metalness: 0.1,
                depthTest: false
            });

            // Cyan/sky blue active dragging state
            this.materials.ballActive = new THREE.MeshStandardMaterial({
                color: 0x0ea5e9,
                emissive: 0x0369a1,
                emissiveIntensity: 0.9,
                roughness: 0.2,
                metalness: 0.1,
                depthTest: false
            });

            // Active cyan/sky blue outline line
            this.materials.outline = new THREE.LineBasicMaterial({
                color: 0x38bdf8,
                linewidth: 3,
                depthTest: false
            });

            this.sync();
        }

        // ====================================================================
        // TAB CONTROLS ('form' | 'hojd' | 'klippning')
        // ====================================================================
        setTab(tabName) {
            this.activeTab = tabName;

            ['form', 'hojd', 'klippning'].forEach(t => {
                let tabBtn = document.getElementById('st-tab-' + t);
                let content = document.getElementById('st-content-' + t);
                if (tabBtn) {
                    if (t === tabName) {
                        tabBtn.style.background = '#38bdf8';
                        tabBtn.style.color = '#0f172a';
                        tabBtn.style.boxShadow = '0 2px 8px rgba(56, 189, 248, 0.35)';
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
            if (!th || curT !== 'SMART_BUILDER' || (window._smartBuilderType !== 'TEE' && window._smartBuilderType !== 'AIM')) return;

            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeTb = (typeof window.getActiveTeeBox === 'function') ? window.getActiveTeeBox(hole) : null;
            let isBuilt = !!(activeTb && activeTb.points && activeTb.points.length >= 3 && hole.activeTeeBoxIndex !== null);

            if (!isBuilt) {
                th.innerHTML = isSv
                    ? "Vänsterklick: <b>Placera punkt</b><br>Högerklick: <b>Ångra punkt</b><br>Sätt ut minst 3 punkter och klicka Skapa tee box"
                    : "Left Click: <b>Place Point</b><br>Right Click: <b>Remove Last Point</b><br>Define shape, then Build Tee Box";
                return;
            }

            if (this.activeTab === 'form') {
                th.innerHTML = isSv
                    ? "💡 <b>Dra de vita golfbollarna</b> för att justera formen på tee-boxen<br>Klicka på linjen för ny punkt • Högerklicka på boll för att ta bort"
                    : "💡 <b>Drag white golf balls</b> to adjust tee box shape<br>Click outline to add point • Right-click ball to remove";
            } else if (this.activeTab === 'hojd') {
                th.innerHTML = isSv
                    ? "💡 <b>Justera platåhöjd och slänt</b> med reglagen<br>Välj vilka teer som placeras på denna box och rikta mot siktpunkten"
                    : "💡 <b>Adjust plateau height & blend</b> with sliders<br>Select which tees are placed on this box and align to aim point";
            } else if (this.activeTab === 'klippning') {
                th.innerHTML = isSv
                    ? "💡 <b>Välj klippmönster och kantskärpa</b> för tee-boxens gräsyta"
                    : "💡 <b>Select mowing pattern & edge sharpness</b> for tee box turf";
            }

            if (typeof window.updateBottomHUDLayout === 'function') {
                window.updateBottomHUDLayout();
            }
        }

        updateVisibility() {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartTee = (curTool === 'SMART_BUILDER' && (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM'));

            if (!isSmartTee) {
                this.hide();
                return;
            }

            if (!this.group) return;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeIdx = (hole && hole.activeTeeBoxIndex !== undefined) ? hole.activeTeeBoxIndex : null;
            let activeTb = (hole && hole.teeBoxes && activeIdx !== null && activeIdx !== undefined) ? hole.teeBoxes[activeIdx] : null;
            let hasBuilt = !!(activeTb && activeTb.points && activeTb.points.length >= 3);

            if (!hasBuilt) {
                this.group.visible = false;
                if (this.outlineMesh) this.outlineMesh.visible = false;
                return;
            }

            this.group.visible = true;

            // Handle spheres visible in Form and Hojd tabs
            let showHandles = (this.activeTab === 'form' || this.activeTab === 'hojd');
            for (let mesh of this.handleMeshes) {
                mesh.visible = showHandles;
            }

            // Outline always visible for active tee box
            if (this.outlineMesh) {
                this.outlineMesh.visible = true;
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
        }

        clearHandles() {
            for (let m of this.handleMeshes) {
                if (this.group) this.group.remove(m);
            }
            this.handleMeshes = [];
        }

        rebuildHandles(hole, targetTeeBox) {
            this.clearHandles();
            if (this.outlineMesh && this.group) {
                this.group.remove(this.outlineMesh);
                if (this.outlineMesh.geometry) this.outlineMesh.geometry.dispose();
                this.outlineMesh = null;
            }

            let tb = targetTeeBox || (typeof window.getActiveTeeBox === 'function' ? window.getActiveTeeBox(hole) : null);
            if (!tb || !tb.points || tb.points.length < 3) return;

            let pts = tb.points;
            let tension = 0.5;

            // Smooth CatmullRom curve for outline
            let v3Pts = pts.map(p => {
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(p.x, p.z)
                    : (p.y || 0);
                return new THREE.Vector3(p.x, y + 0.22, p.z);
            });

            let curve = new THREE.CatmullRomCurve3(v3Pts, true, 'catmullrom', tension);
            let samples = Math.max(120, pts.length * 30);
            let curvePts = curve.getPoints(samples);
            if (curvePts.length > 0) {
                curvePts.push(curvePts[0].clone());
            }

            let lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
            this.outlineMesh = new THREE.Line(lineGeo, this.materials.outline);
            this.outlineMesh.renderOrder = 998;
            this.group.add(this.outlineMesh);

            // Large white golf ball handles on perimeter
            pts.forEach((pt, idx) => {
                let ballMesh = new THREE.Mesh(this.geometries.ball, this.materials.ball);
                let y = (typeof window.getTerrainHeight === 'function')
                    ? window.getTerrainHeight(pt.x, pt.z)
                    : (pt.y || 0);
                ballMesh.position.set(pt.x, y + 0.85, pt.z);
                ballMesh.renderOrder = 999;
                ballMesh.userData = { handleIndex: idx };
                ballMesh.visible = (this.activeTab === 'form' || this.activeTab === 'hojd');
                this.group.add(ballMesh);
                this.handleMeshes.push(ballMesh);
            });

            this.updateVisibility();
        }

        updateSplineOnly(hole, targetTeeBox) {
            let tb = targetTeeBox || (typeof window.getActiveTeeBox === 'function' ? window.getActiveTeeBox(hole) : null);
            if (!tb || !tb.points || !this.outlineMesh) return;
            let pts = tb.points;
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
            this.outlineMesh.geometry.dispose();
            this.outlineMesh.geometry = new THREE.BufferGeometry().setFromPoints(curvePts);
        }

        calculateArea(points) {
            if (!points || points.length < 3) return 0;
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                let next = (i + 1) % points.length;
                area += points[i].x * points[next].z - points[next].x * points[i].z;
            }
            return Math.round(Math.abs(area) / 2);
        }

        distToSegment(px, pz, x1, z1, x2, z2) {
            let dx = x2 - x1, dz = z2 - z1;
            let len2 = dx * dx + dz * dz;
            if (len2 < 1e-6) return Math.hypot(px - x1, pz - z1);
            let t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2));
            let projX = x1 + t * dx;
            let projZ = z1 + t * dz;
            return Math.hypot(px - projX, pz - projZ);
        }

        renderSelectorBar(hole, teeBoxes, activeIdx, isSv) {
            let headerRow = document.getElementById('st-header-row');
            let countEl = document.getElementById('st-count');
            let addBtn = document.getElementById('st-add-tee-btn');
            let selectorBar = document.getElementById('st-selector-bar');
            let delAllBtn = document.getElementById('st-delete-all-btn');

            let hasAny = (teeBoxes && teeBoxes.length > 0);
            if (delAllBtn) {
                delAllBtn.style.display = (teeBoxes && teeBoxes.length > 1) ? 'block' : 'none';
            }

            if (hasAny) {
                if (headerRow) headerRow.style.display = 'flex';
                if (countEl) countEl.textContent = teeBoxes.length;

                let isDrawingNew = (activeIdx === null || activeIdx === undefined);
                if (addBtn) {
                    addBtn.style.cssText = isDrawingNew
                        ? 'background:rgba(56,189,248,0.25); color:#38bdf8; border:1px solid #38bdf8; border-radius:5px; padding:3px 8px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:3px; box-shadow:0 0 8px rgba(56,189,248,0.35);'
                        : 'background:#0f172a; color:#38bdf8; border:1px dashed rgba(56,189,248,0.6); border-radius:5px; padding:3px 8px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:3px; transition:all 0.2s;';
                    addBtn.innerHTML = `<span>➕</span> <span>${isSv ? 'Ny Tee Box' : 'New Tee Box'}</span>`;
                    addBtn.onclick = function() {
                        if (typeof window.startNewTeeBoxDrawing === 'function') {
                            window.startNewTeeBoxDrawing();
                        }
                    };
                }

                if (selectorBar) {
                    selectorBar.style.display = 'flex';
                    selectorBar.innerHTML = '';

                    let count = teeBoxes.length;
                    teeBoxes.forEach((tb, idx) => {
                        let tArea = this.calculateArea(tb.points || []);
                        let isSelected = (activeIdx === idx);
                        let btn = document.createElement('button');
                        btn.type = 'button';
                        btn.title = `Tee Box ${idx + 1} (~${tArea} m²)`;

                        let label = (count === 1)
                            ? `<span>🟦 Tee 1</span><span style="font-size:8px; opacity:0.85;">(~${tArea}m²)</span>`
                            : `<span>🟦 Tee ${idx + 1}</span><span style="font-size:8px; opacity:0.8;">(~${tArea}m²)</span>`;

                        btn.style.cssText = isSelected 
                            ? 'flex:1 1 auto; min-width:48px; background:#38bdf8; color:#0f172a; border:1px solid #0284c7; border-radius:5px; padding:5px 6px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:3px; box-shadow:0 0 8px rgba(56,189,248,0.4); transition:all 0.15s;'
                            : 'flex:1 1 auto; min-width:48px; background:#1e293b; color:#94a3b8; border:1px solid #334155; border-radius:5px; padding:5px 6px; font-size:9.5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:3px; transition:all 0.15s;';
                        btn.innerHTML = label;

                        btn.onclick = () => {
                            hole.activeTeeBoxIndex = idx;
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

        syncUIValues(hole, targetTeeBox) {
            let tb = targetTeeBox || (typeof window.getActiveTeeBox === 'function' ? window.getActiveTeeBox(hole) : null);
            if (!tb) return;

            // Height & Blend sliders
            let hS = document.getElementById('st-raise-height');
            let hV = document.getElementById('st-raise-height-val');
            let h = tb.raiseHeight !== undefined ? tb.raiseHeight : 0.5;
            if (hS && document.activeElement !== hS) hS.value = h;
            if (hV) hV.textContent = (h >= 0 ? '+' : '') + h.toFixed(1) + 'm';
            if (hS && !hS._boundTeeInput) {
                hS._boundTeeInput = true;
                hS.addEventListener('input', function() {
                    if (typeof window.onTeeHeightSlider === 'function') window.onTeeHeightSlider(this.value);
                });
            }

            let bS = document.getElementById('st-raise-blend');
            let bV = document.getElementById('st-raise-blend-val');
            let b = tb.blendRadius !== undefined ? tb.blendRadius : 4.0;
            if (bS && document.activeElement !== bS) bS.value = b;
            if (bV) bV.textContent = b.toFixed(1) + 'm';
            if (bS && !bS._boundTeeInput) {
                bS._boundTeeInput = true;
                bS.addEventListener('input', function() {
                    if (typeof window.onTeeBlendSlider === 'function') window.onTeeBlendSlider(this.value);
                });
            }

            // Markers checkboxes
            let activeTees = tb.activeTees || ['black', 'white', 'yellow', 'red'];
            ['red', 'yellow', 'white', 'black'].forEach(c => {
                let cb = document.getElementById('st-tee-' + c);
                if (cb) cb.checked = activeTees.includes(c);
            });

            // Mowing Pattern Cards
            let curPattern = tb.mowPattern || 'SOLID';
            ['solid', 'stripes', 'checkerboard', 'diamond'].forEach(p => {
                let card = document.getElementById('st-mow-' + p);
                if (card) {
                    let match = (p.toUpperCase() === curPattern.toUpperCase());
                    card.style.background = match ? 'rgba(56, 189, 248, 0.25)' : '#1e293b';
                    card.style.borderColor = match ? '#38bdf8' : '#334155';
                    card.style.color = match ? '#38bdf8' : '#cbd5e1';
                }
            });

            // Edge sharpness
            let esS = document.getElementById('st-edge-sharpness');
            let esV = document.getElementById('st-edge-val');
            let es = tb.edgeSharpness !== undefined ? tb.edgeSharpness : 100;
            if (esS && document.activeElement !== esS) esS.value = es;
            if (esV) esV.textContent = (es === 100) ? 'Skarp (100%)' : (es === 0 ? 'Mjuk (0%)' : es + '%');
        }

        // ====================================================================
        // SYNCHRONIZE STATE WITH COURSE DATA & UI
        // ====================================================================
        sync() {
            if (!this.group && window._arcadeScene) this.init(window._arcadeScene);
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartTee = (curTool === 'SMART_BUILDER' && (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM'));

            let modeUnbuilt = document.getElementById('st-panel-unbuilt');
            let modeBuilt = document.getElementById('st-panel-built');
            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

            if (!isSmartTee) {
                this.hide();
                return;
            }

            let teeBoxes = (typeof window.ensureHoleTeeBoxes === 'function') ? window.ensureHoleTeeBoxes(hole) : (hole && hole.teeBoxes ? hole.teeBoxes : []);
            let activeIdx = (hole && hole.activeTeeBoxIndex !== undefined) ? hole.activeTeeBoxIndex : null;
            let activeTb = (teeBoxes && activeIdx !== null && activeIdx !== undefined && teeBoxes[activeIdx]) ? teeBoxes[activeIdx] : null;

            // 1. Render Multi-Tee Selector Bar
            this.renderSelectorBar(hole, teeBoxes, activeIdx, isSv);

            // 2. Sync Aim Point cards in both unbuilt and built modes
            this.syncAimStatus(hole, isSv);

            let hasBuiltTee = !!(activeTb && activeTb.points && activeTb.points.length >= 3);

            if (hasBuiltTee) {
                if (modeUnbuilt) modeUnbuilt.style.display = 'none';
                if (modeBuilt) modeBuilt.style.display = 'block';

                let area = this.calculateArea(activeTb.points);
                let tbNum = (activeIdx !== null && activeIdx !== undefined) ? (activeIdx + 1) : 1;

                let areaBadge = document.getElementById('st-form-area-val');
                if (areaBadge) areaBadge.textContent = `~${area} m²`;

                let formStatusBadge = document.getElementById('st-form-title-badge');
                if (formStatusBadge) {
                    formStatusBadge.textContent = isSv ? `● Tee Box ${tbNum} vald` : `● Tee Box ${tbNum} selected`;
                }

                if (this.group) this.group.visible = true;
                this.updateBottomHints();

                try {
                    this.rebuildHandles(hole, activeTb);
                    this.syncUIValues(hole, activeTb);
                } catch (err) {
                    console.error('TeeStudio sync error:', err);
                } finally {
                    this.updateVisibility();
                }
            } else {
                // Unbuilt drawing mode
                if (modeUnbuilt) modeUnbuilt.style.display = 'flex';
                if (modeBuilt) modeBuilt.style.display = 'none';

                this.updateBottomHints();

                let pts = window.smartGreenPoints || [];
                let drawStatusEl = document.getElementById('st-draw-status');
                let buildBtn = document.getElementById('st-build-tee-btn');

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
                            ? `<span style="color:#38bdf8; font-weight:bold;">✓ ${pts.length} punkter valda — Formen är redo!</span>`
                            : `<span style="color:#38bdf8; font-weight:bold;">✓ ${pts.length} points placed — Shape is ready!</span>`;
                    }
                }

                if (buildBtn) {
                    let area = this.calculateArea(pts);
                    let areaText = (pts.length >= 3 && area > 0) ? (' (~' + area + ' m²)') : '';
                    let tbNextNum = (teeBoxes ? teeBoxes.length + 1 : 1);
                    let btnLabel = (isSv ? `Skapa Tee Box ${tbNextNum}` : `Create Tee Box ${tbNextNum}`) + areaText;
                    buildBtn.innerHTML = '🟦 ' + btnLabel;

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

        syncAimStatus(hole, isSv) {
            let hasAim = !!(hole && hole.aimPoint);
            let badgeUnbuilt = document.getElementById('st-aim-badge-unbuilt');
            let btnTxtUnbuilt = document.getElementById('st-aim-btn-txt-unbuilt');
            let delBtnUnbuilt = document.getElementById('st-aim-del-unbuilt');
            let badgeBuilt = document.getElementById('st-aim-badge-built');

            let distStr = '';
            if (hasAim && hole.tees) {
                let anyTee = hole.tees.yellow || hole.tees.white || hole.tees.red || hole.tees.black;
                if (anyTee) {
                    let dist = Math.round(Math.hypot(hole.aimPoint.x - anyTee.x, hole.aimPoint.z - anyTee.z));
                    distStr = ` (${dist}m)`;
                }
            }

            if (badgeUnbuilt) {
                if (hasAim) {
                    badgeUnbuilt.textContent = (isSv ? '✅ Sikte satt' : '✅ Aim set') + distStr;
                    badgeUnbuilt.style.background = 'rgba(74,222,128,0.15)';
                    badgeUnbuilt.style.color = '#4ade80';
                    badgeUnbuilt.style.borderColor = 'rgba(74,222,128,0.4)';
                } else {
                    badgeUnbuilt.textContent = isSv ? '⚠️ Krävs' : '⚠️ Required';
                    badgeUnbuilt.style.background = 'rgba(239,68,68,0.15)';
                    badgeUnbuilt.style.color = '#ef4444';
                    badgeUnbuilt.style.borderColor = 'rgba(239,68,68,0.4)';
                }
            }

            if (btnTxtUnbuilt) {
                btnTxtUnbuilt.textContent = hasAim
                    ? (isSv ? 'Flytta siktpunkt' : 'Move Aim Point')
                    : (isSv ? 'Sätt siktpunkt på kartan' : 'Set Aim Point on Map');
            }

            if (delBtnUnbuilt) {
                delBtnUnbuilt.style.display = hasAim ? 'block' : 'none';
            }

            if (badgeBuilt) {
                if (hasAim) {
                    badgeBuilt.textContent = (isSv ? '✅ Satt' : '✅ Set') + distStr;
                    badgeBuilt.style.background = 'rgba(74,222,128,0.15)';
                    badgeBuilt.style.color = '#4ade80';
                    badgeBuilt.style.borderColor = 'rgba(74,222,128,0.4)';
                } else {
                    badgeBuilt.textContent = isSv ? '⚠️ Saknas' : '⚠️ Missing';
                    badgeBuilt.style.background = 'rgba(239,68,68,0.15)';
                    badgeBuilt.style.color = '#ef4444';
                    badgeBuilt.style.borderColor = 'rgba(239,68,68,0.4)';
                }
            }
        }

        // ====================================================================
        // EVENT HANDLERS (POINTERDOWN, MOVE, UP, RIGHTCLICK)
        // ====================================================================
        onPointerDown(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartTee = (curTool === 'SMART_BUILDER' && (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM'));
            if (!isSmartTee) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeTb = (typeof window.getActiveTeeBox === 'function') ? window.getActiveTeeBox(hole) : null;
            let hasBuiltTee = !!(activeTb && activeTb.points && activeTb.points.length >= 3 && hole.activeTeeBoxIndex !== null);

            // MODE 1: UNBUILT
            if (!hasBuiltTee) {
                // Drag existing unbuilt golf ball
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
                                    window.showBuildToast(isSv ? '🔒 Tee-formen är stängd! Klicka på [Bygg Tee Box] för att skapa.' : '🔒 Tee shape closed! Click [Build Tee Box] to create.', '#38bdf8');
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

                // Click line to insert new node
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
                        let y = (typeof window.getTerrainHeight === 'function')
                            ? window.getTerrainHeight(lastHitPoint.x, lastHitPoint.z)
                            : (lastHitPoint.y || 0);
                        let newPt = new THREE.Vector3(lastHitPoint.x, y, lastHitPoint.z);
                        pts.splice(insertIdx, 0, newPt);
                        if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                        this.sync();
                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny golfboll infogad på linjen!' : '➕ New golf ball inserted on line!', '#38bdf8');
                        }
                        return true;
                    }
                }

                return false;
            }

            // MODE 2: BUILT TEE BOX
            if (!activeTb) return false;

            // Click handle ball
            if ((this.activeTab === 'form' || this.activeTab === 'hojd') && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (handleIdx !== undefined) {
                        this.draggingHandleIndex = handleIdx;
                        this.dragStartPoints = activeTb.points.map(p => ({ x: p.x, y: p.y, z: p.z }));
                        if (window.controls) window.controls.enabled = false;
                        hitMesh.material = this.materials.ballActive || this.materials.ballHover;
                        hitMesh.scale.set(1.25, 1.25, 1.25);
                        document.body.style.cursor = 'grabbing';
                        return true;
                    }
                }

                // Click outline line to insert new node
                if (this.outlineMesh && lastHitPoint) {
                    let pts = activeTb.points;
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
                        let oldTb = { ...activeTb, points: activeTb.points.map(p => ({ x: p.x, y: p.y, z: p.z })) };
                        if (typeof window.restoreTeeBase === 'function') window.restoreTeeBase(hole, true, oldTb);

                        let newPt = { x: lastHitPoint.x, y: lastHitPoint.y || 0, z: lastHitPoint.z };
                        pts.splice(insertIdx, 0, newPt);

                        if (typeof window.captureTeeSnapshot === 'function') {
                            let snap = window.captureTeeSnapshot(hole, pts, 25);
                            activeTb.bbox = snap.bbox;
                            activeTb.origHeights = snap.origHeights;
                            activeTb.origCanvasPixels = snap.origCanvasPixels;
                            activeTb.baseElevation = snap.baseElevation;
                        }

                        if (typeof window.applyTeePipeline === 'function') {
                            window.applyTeePipeline(hole, false, true, activeTb);
                        }
                        this.rebuildHandles(hole, activeTb);

                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '➕ Ny vit boll tillagd på tee-boxen!' : '➕ New white ball added to tee box!', '#38bdf8');
                        }
                        return true;
                    }
                }
            }

            return false;
        }

        onMouseMove(event, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartTee = (curTool === 'SMART_BUILDER' && (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM'));
            if (!isSmartTee) return;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeTb = (typeof window.getActiveTeeBox === 'function') ? window.getActiveTeeBox(hole) : null;
            let hasBuiltTee = !!(activeTb && activeTb.points && activeTb.points.length >= 3 && hole.activeTeeBoxIndex !== null);

            // Dragging in Mode 1
            if (!hasBuiltTee && this.draggingDrawNodeIndex !== -1 && lastHitPoint) {
                let pts = window.smartGreenPoints;
                if (pts && pts[this.draggingDrawNodeIndex]) {
                    pts[this.draggingDrawNodeIndex].x = lastHitPoint.x;
                    pts[this.draggingDrawNodeIndex].z = lastHitPoint.z;
                    let y = (typeof window.getTerrainHeight === 'function')
                        ? window.getTerrainHeight(lastHitPoint.x, lastHitPoint.z)
                        : (lastHitPoint.y || 0);
                    pts[this.draggingDrawNodeIndex].y = y;

                    let ball = window.smartGreenSpheres[this.draggingDrawNodeIndex];
                    if (ball) ball.position.set(lastHitPoint.x, y + 0.35, lastHitPoint.z);

                    if (typeof window.updateSmartGreenPreview === 'function') window.updateSmartGreenPreview();
                    this.sync();
                }
                return;
            }

            // Magnetic snap hover when >= 3 points and shape is open (Mode 1)
            if (!hasBuiltTee && window.smartGreenPoints && window.smartGreenPoints.length >= 3 && !window._smartShapeClosed && lastHitPoint) {
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
                    if (ball0) {
                        ball0.scale.set(1.0, 1.0, 1.0);
                        if (ball0.material) ball0.material = this.materials.ball;
                    }
                    document.body.style.cursor = 'default';
                }
            }

            // Dragging in Mode 2
            if (hasBuiltTee && this.draggingHandleIndex !== -1 && lastHitPoint && activeTb) {
                let pt = activeTb.points[this.draggingHandleIndex];
                if (pt) {
                    // Undo point = state BEFORE the first movement of this drag
                    if (!this._dragUndoSaved) { this._dragUndoSaved = true; window.saveUndoState(); }
                    pt.x = lastHitPoint.x;
                    pt.z = lastHitPoint.z;
                    let y = (typeof window.getTerrainHeight === 'function')
                        ? window.getTerrainHeight(lastHitPoint.x, lastHitPoint.z)
                        : (lastHitPoint.y || 0);
                    pt.y = y;

                    let mesh = this.handleMeshes[this.draggingHandleIndex];
                    if (mesh) mesh.position.set(lastHitPoint.x, y + 0.85, lastHitPoint.z);

                    this.updateSplineOnly(hole, activeTb);
                    this._pendingRebuild = true;
                }
                return;
            }

            // Hover effects for handle balls
            if (hasBuiltTee && (this.activeTab === 'form' || this.activeTab === 'hojd') && raycaster && this.handleMeshes.length > 0) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let idx = hitMesh.userData.handleIndex;
                    if (idx !== undefined && idx !== this.hoveredHandleIndex) {
                        this.resetHoveredHandle();
                        this.hoveredHandleIndex = idx;
                        hitMesh.material = this.materials.ballHover;
                        hitMesh.scale.set(1.2, 1.2, 1.2);
                        document.body.style.cursor = 'grab';
                    }
                } else {
                    this.resetHoveredHandle();
                }
            }
        }

        resetHoveredHandle() {
            if (this.hoveredHandleIndex !== -1 && this.handleMeshes[this.hoveredHandleIndex]) {
                let mesh = this.handleMeshes[this.hoveredHandleIndex];
                mesh.material = this.materials.ball;
                mesh.scale.set(1, 1, 1);
                this.hoveredHandleIndex = -1;
                document.body.style.cursor = 'default';
            }
        }

        onPointerUp(e) {
            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeTb = (typeof window.getActiveTeeBox === 'function') ? window.getActiveTeeBox(hole) : null;

            if (this.draggingDrawNodeIndex !== -1) {
                let ball = window.smartGreenSpheres[this.draggingDrawNodeIndex];
                if (ball) {
                    if (ball.material) ball.material = this.materials.ball;
                    ball.scale.set(1, 1, 1);
                }
                this.draggingDrawNodeIndex = -1;
                if (window.controls) window.controls.enabled = true;
                document.body.style.cursor = 'default';
                return;
            }

            if (this.draggingHandleIndex !== -1) {
                let mesh = this.handleMeshes[this.draggingHandleIndex];
                if (mesh) {
                    mesh.material = this.materials.ball;
                    mesh.scale.set(1, 1, 1);
                }
                this.draggingHandleIndex = -1;
                this._dragUndoSaved = false;
                if (window.controls) window.controls.enabled = true;
                document.body.style.cursor = 'default';

                if (this._pendingRebuild && activeTb) {
                    this._pendingRebuild = false;
                    let oldTb = {
                        ...activeTb,
                        points: (this.dragStartPoints || activeTb.points)
                    };
                    if (typeof window.restoreTeeBase === 'function') {
                        window.restoreTeeBase(hole, true, oldTb);
                    }
                    this.dragStartPoints = null;

                    if (typeof window.captureTeeSnapshot === 'function') {
                        let snap = window.captureTeeSnapshot(hole, activeTb.points, 25);
                        activeTb.bbox = snap.bbox;
                        activeTb.origHeights = snap.origHeights;
                        activeTb.origCanvasPixels = snap.origCanvasPixels;
                        activeTb.baseElevation = snap.baseElevation;
                    }
                    if (typeof window.applyTeePipeline === 'function') {
                        window.applyTeePipeline(hole, false, true, activeTb);
                    }
                    this.rebuildHandles(hole, activeTb);
                    if (typeof window.debounceSaveCourse === 'function') {
                        window.debounceSaveCourse(1500);
                    }
                }
                this.dragStartPoints = null;
            }
        }

        onRightClick(e, lastHitPoint, raycaster) {
            let curTool = window.currentTool || (typeof currentTool !== 'undefined' ? currentTool : null);
            let isSmartTee = (curTool === 'SMART_BUILDER' && (window._smartBuilderType === 'TEE' || window._smartBuilderType === 'AIM'));
            if (!isSmartTee) return false;

            let hole = window.courseHoles && window.courseHoles[window.currentHoleIndex];
            let activeTb = (typeof window.getActiveTeeBox === 'function') ? window.getActiveTeeBox(hole) : null;
            let hasBuiltTee = !!(activeTb && activeTb.points && activeTb.points.length >= 3 && hole.activeTeeBoxIndex !== null);

            // Right click in Mode 2: remove white ball handle
            if (hasBuiltTee && this.handleMeshes.length > 0 && raycaster) {
                let intersects = raycaster.intersectObjects(this.handleMeshes);
                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    let handleIdx = hitMesh.userData.handleIndex;
                    if (handleIdx !== undefined) {
                        if (activeTb.points.length <= 3) {
                            let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                            if (typeof window.showBuildToast === 'function') {
                                window.showBuildToast(isSv ? '⚠️ En tee box måste ha minst 3 punkter!' : '⚠️ A tee box must have at least 3 points!', '#ef4444');
                            }
                            return true;
                        }

                        window.saveUndoState();
                        let oldTb = { ...activeTb, points: activeTb.points.map(p => ({ x: p.x, y: p.y, z: p.z })) };
                        if (typeof window.restoreTeeBase === 'function') window.restoreTeeBase(hole, true, oldTb);

                        activeTb.points.splice(handleIdx, 1);

                        if (typeof window.captureTeeSnapshot === 'function') {
                            let snap = window.captureTeeSnapshot(hole, activeTb.points, 25);
                            activeTb.bbox = snap.bbox;
                            activeTb.origHeights = snap.origHeights;
                            activeTb.origCanvasPixels = snap.origCanvasPixels;
                            activeTb.baseElevation = snap.baseElevation;
                        }

                        if (typeof window.applyTeePipeline === 'function') {
                            window.applyTeePipeline(hole, false, true, activeTb);
                        }
                        this.rebuildHandles(hole, activeTb);

                        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
                        if (typeof window.showBuildToast === 'function') {
                            window.showBuildToast(isSv ? '🗑️ Vit boll borttagen från tee-boxen!' : '🗑️ White ball removed from tee box!', '#38bdf8');
                        }
                        return true;
                    }
                }
            }

            return false;
        }

        update(dt) {
            // Placeholder for optional animation/easing if needed
        }
    }

    // Expose global instance
    window.TeeStudio = new TeeStudioEngine();

})();
