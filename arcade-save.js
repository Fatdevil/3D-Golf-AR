    // fences, walls, hedges and OB stakes drawn as paths: only the path is saved, the meshes are rebuilt when the course opens
    window.serializeEnvObjects = function (h) {
        return (h && h.envObjects ? h.envObjects : []).filter(o => o && o.type && o.splineData && o.splineData.length >= 2)
            .map(o => ({ type: o.type, splineData: o.splineData.map(p => ({ x: p.x, y: p.y, z: p.z })) }));
    };
    window.restoreEnvObjects = function (h, saved) {
        (h.envObjects || []).forEach(o => { if (o && o.mesh) scene.remove(o.mesh); });
        h.envObjects = [];
        if (!Array.isArray(saved) || typeof window.buildFenceMesh !== 'function') return;
        saved.forEach(eo => {
            try {
                const pts = eo.splineData.map(p => new THREE.Vector3(p.x, p.y, p.z));
                if (pts.length < 2) return;
                const mesh = window.buildFenceMesh(eo.type, pts);
                scene.add(mesh);
                h.envObjects.push({ id: Math.random().toString(36).substr(2, 9), type: eo.type, mesh: mesh, splineData: eo.splineData, collisionData: mesh.userData.collisionPts || [] });
            } catch (e) { console.warn('Could not rebuild path object', e); }
        });
    };

    // every hole with all of its editable definitions (greens, fairways, bunkers, tee boxes): what the builder needs to open it again
    window.serializeHolesFull = function () {
        return courseHoles.map(h => ({
            par: h.par, 
            tees: h.tees,
            flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z} : null,
            aimPoint: h.aimPoint ? {x: h.aimPoint.x, y: h.aimPoint.y, z: h.aimPoint.z} : null,
            plannedGreen: h.plannedGreen ? {x: h.plannedGreen.x, z: h.plannedGreen.z, r: h.plannedGreen.r} : null,
            panorama: h.panorama || null,
            surrounding: h.surrounding || null,
            surroundConfig: h.surroundConfig || null,
            envObjects: window.serializeEnvObjects(h),
            greenData: h.greenData ? {
                points: h.greenData.points,
                difficulty: h.greenData.difficulty,
                elevationOffset: h.greenData.elevationOffset,
                blendDistance: h.greenData.blendDistance,
                tiltPct: h.greenData.tiltPct,
                tiltAim: h.greenData.tiltAim,
                mowPattern: h.greenData.mowPattern,
                foregreenWidth: h.greenData.foregreenWidth,
                edgeSharpness: h.greenData.edgeSharpness,
                baseElevation: h.greenData.baseElevation,
                seedOffsetX: h.greenData.seedOffsetX,
                seedOffsetZ: h.greenData.seedOffsetZ,
                bbox: h.greenData.bbox ? {
                    gxStart: h.greenData.bbox.gxStart,
                    gxEnd: h.greenData.bbox.gxEnd,
                    gzStart: h.greenData.bbox.gzStart,
                    gzEnd: h.greenData.bbox.gzEnd,
                    gWidth: h.greenData.bbox.gWidth,
                    gHeight: h.greenData.bbox.gHeight,
                    pxMinX: h.greenData.bbox.pxMinX,
                    pxMaxX: h.greenData.bbox.pxMaxX,
                    pxMinY: h.greenData.bbox.pxMinY,
                    pxMaxY: h.greenData.bbox.pxMaxY,
                    pw: h.greenData.bbox.pw,
                    ph: h.greenData.bbox.ph,
                    margin: h.greenData.bbox.margin
                } : null,
                origHeights: h.greenData.origHeights ? Array.from(h.greenData.origHeights) : null
            } : null,
            fairways: (h.fairways && h.fairways.length > 0 ? h.fairways : (h.fairwayData ? [h.fairwayData] : [])).map(fd => ({
                id: fd.id,
                points: fd.points,
                difficulty: fd.difficulty,
                semiRoughWidth: fd.semiRoughWidth,
                roughWidth: fd.roughWidth,
                roughEnabled: fd.roughEnabled,
                mowPattern: fd.mowPattern,
                edgeSharpness: fd.edgeSharpness,
                maxSlopePct: fd.maxSlopePct,
                maxSlopeAlongPct: fd.maxSlopeAlongPct,
                baseElevation: fd.baseElevation,
                seedOffsetX: fd.seedOffsetX,
                seedOffsetZ: fd.seedOffsetZ,
                bbox: fd.bbox ? {
                    gxStart: fd.bbox.gxStart,
                    gxEnd: fd.bbox.gxEnd,
                    gzStart: fd.bbox.gzStart,
                    gzEnd: fd.bbox.gzEnd,
                    gWidth: fd.bbox.gWidth,
                    gHeight: fd.bbox.gHeight,
                    pxMinX: fd.bbox.pxMinX,
                    pxMaxX: fd.bbox.pxMaxX,
                    pxMinY: fd.bbox.pxMinY,
                    pxMaxY: fd.bbox.pxMaxY,
                    pw: fd.bbox.pw,
                    ph: fd.bbox.ph,
                    margin: fd.bbox.margin
                } : null,
                origHeights: fd.origHeights ? Array.from(fd.origHeights) : null
            })),
            fairwayData: (h.fairways && h.fairways[0]) ? {
                points: h.fairways[0].points,
                difficulty: h.fairways[0].difficulty,
                semiRoughWidth: h.fairways[0].semiRoughWidth,
                roughWidth: h.fairways[0].roughWidth,
                roughEnabled: h.fairways[0].roughEnabled,
                mowPattern: h.fairways[0].mowPattern,
                edgeSharpness: h.fairways[0].edgeSharpness,
                maxSlopePct: h.fairways[0].maxSlopePct,
                maxSlopeAlongPct: h.fairways[0].maxSlopeAlongPct,
                baseElevation: h.fairways[0].baseElevation,
                seedOffsetX: h.fairways[0].seedOffsetX,
                seedOffsetZ: h.fairways[0].seedOffsetZ,
                bbox: h.fairways[0].bbox ? {
                    gxStart: h.fairways[0].bbox.gxStart,
                    gxEnd: h.fairways[0].bbox.gxEnd,
                    gzStart: h.fairways[0].bbox.gzStart,
                    gzEnd: h.fairways[0].bbox.gzEnd,
                    gWidth: h.fairways[0].bbox.gWidth,
                    gHeight: h.fairways[0].bbox.gHeight,
                    pxMinX: h.fairways[0].bbox.pxMinX,
                    pxMaxX: h.fairways[0].bbox.pxMaxX,
                    pxMinY: h.fairways[0].bbox.pxMinY,
                    pxMaxY: h.fairways[0].bbox.pxMaxY,
                    pw: h.fairways[0].bbox.pw,
                    ph: h.fairways[0].bbox.ph,
                    margin: h.fairways[0].bbox.margin
                } : null,
                origHeights: h.fairways[0].origHeights ? Array.from(h.fairways[0].origHeights) : null
            } : (h.fairwayData ? {
                points: h.fairwayData.points,
                difficulty: h.fairwayData.difficulty,
                semiRoughWidth: h.fairwayData.semiRoughWidth,
                roughWidth: h.fairwayData.roughWidth,
                roughEnabled: h.fairwayData.roughEnabled,
                mowPattern: h.fairwayData.mowPattern,
                edgeSharpness: h.fairwayData.edgeSharpness,
                maxSlopePct: h.fairwayData.maxSlopePct,
                maxSlopeAlongPct: h.fairwayData.maxSlopeAlongPct,
                baseElevation: h.fairwayData.baseElevation,
                seedOffsetX: h.fairwayData.seedOffsetX,
                seedOffsetZ: h.fairwayData.seedOffsetZ,
                bbox: h.fairwayData.bbox ? {
                    gxStart: h.fairwayData.bbox.gxStart,
                    gxEnd: h.fairwayData.bbox.gxEnd,
                    gzStart: h.fairwayData.bbox.gzStart,
                    gzEnd: h.fairwayData.bbox.gzEnd,
                    gWidth: h.fairwayData.bbox.gWidth,
                    gHeight: h.fairwayData.bbox.gHeight,
                    pxMinX: h.fairwayData.bbox.pxMinX,
                    pxMaxX: h.fairwayData.bbox.pxMaxX,
                    pxMinY: h.fairwayData.bbox.pxMinY,
                    pxMaxY: h.fairwayData.bbox.pxMaxY,
                    pw: h.fairwayData.bbox.pw,
                    ph: h.fairwayData.bbox.ph,
                    margin: h.fairwayData.bbox.margin
                } : null,
                origHeights: h.fairwayData.origHeights ? Array.from(h.fairwayData.origHeights) : null
            } : null),
            bunkers: (h.bunkers && h.bunkers.length > 0 ? h.bunkers : (h.bunkerData ? [h.bunkerData] : [])).map(bd => ({
                id: bd.id,
                points: bd.points,
                shape: bd.shape || 'BOWL',
                depth: bd.depth !== undefined ? bd.depth : 0.8,
                lipHeight: bd.lipHeight !== undefined ? bd.lipHeight : 0.3,
                edgeSharpness: bd.edgeSharpness !== undefined ? bd.edgeSharpness : 100,
                baseElevation: bd.baseElevation,
                bbox: bd.bbox ? {
                    gxStart: bd.bbox.gxStart,
                    gxEnd: bd.bbox.gxEnd,
                    gzStart: bd.bbox.gzStart,
                    gzEnd: bd.bbox.gzEnd,
                    gWidth: bd.bbox.gWidth,
                    gHeight: bd.bbox.gHeight,
                    pxMinX: bd.bbox.pxMinX,
                    pxMaxX: bd.bbox.pxMaxX,
                    pxMinY: bd.bbox.pxMinY,
                    pxMaxY: bd.bbox.pxMaxY,
                    pw: bd.bbox.pw,
                    ph: bd.bbox.ph,
                    margin: bd.bbox.margin
                } : null,
                origHeights: bd.origHeights ? Array.from(bd.origHeights) : null
            })),
            bunkerData: (h.bunkers && h.bunkers[0]) ? {
                id: h.bunkers[0].id,
                points: h.bunkers[0].points,
                shape: h.bunkers[0].shape || 'BOWL',
                depth: h.bunkers[0].depth !== undefined ? h.bunkers[0].depth : 0.8,
                lipHeight: h.bunkers[0].lipHeight !== undefined ? h.bunkers[0].lipHeight : 0.3,
                edgeSharpness: h.bunkers[0].edgeSharpness !== undefined ? h.bunkers[0].edgeSharpness : 100,
                baseElevation: h.bunkers[0].baseElevation,
                bbox: h.bunkers[0].bbox ? {
                    gxStart: h.bunkers[0].bbox.gxStart,
                    gxEnd: h.bunkers[0].bbox.gxEnd,
                    gzStart: h.bunkers[0].bbox.gzStart,
                    gzEnd: h.bunkers[0].bbox.gzEnd,
                    gWidth: h.bunkers[0].bbox.gWidth,
                    gHeight: h.bunkers[0].bbox.gHeight,
                    pxMinX: h.bunkers[0].bbox.pxMinX,
                    pxMaxX: h.bunkers[0].bbox.pxMaxX,
                    pxMinY: h.bunkers[0].bbox.pxMinY,
                    pxMaxY: h.bunkers[0].bbox.pxMaxY,
                    pw: h.bunkers[0].bbox.pw,
                    ph: h.bunkers[0].bbox.ph,
                    margin: h.bunkers[0].bbox.margin
                } : null,
                origHeights: h.bunkers[0].origHeights ? Array.from(h.bunkers[0].origHeights) : null
            } : (h.bunkerData ? {
                id: h.bunkerData.id,
                points: h.bunkerData.points,
                shape: h.bunkerData.shape || 'BOWL',
                depth: h.bunkerData.depth !== undefined ? h.bunkerData.depth : 0.8,
                lipHeight: h.bunkerData.lipHeight !== undefined ? h.bunkerData.lipHeight : 0.3,
                edgeSharpness: h.bunkerData.edgeSharpness !== undefined ? h.bunkerData.edgeSharpness : 100,
                baseElevation: h.bunkerData.baseElevation,
                bbox: h.bunkerData.bbox ? {
                    gxStart: h.bunkerData.bbox.gxStart,
                    gxEnd: h.bunkerData.bbox.gxEnd,
                    gzStart: h.bunkerData.bbox.gzStart,
                    gzEnd: h.bunkerData.bbox.gzEnd,
                    gWidth: h.bunkerData.bbox.gWidth,
                    gHeight: h.bunkerData.bbox.gHeight,
                    pxMinX: h.bunkerData.bbox.pxMinX,
                    pxMaxX: h.bunkerData.bbox.pxMaxX,
                    pxMinY: h.bunkerData.bbox.pxMinY,
                    pxMaxY: h.bunkerData.bbox.pxMaxY,
                    pw: h.bunkerData.bbox.pw,
                    ph: h.bunkerData.bbox.ph,
                    margin: h.bunkerData.bbox.margin
                } : null,
                origHeights: h.bunkerData.origHeights ? Array.from(h.bunkerData.origHeights) : null
            } : null),
            teeManualColors: h.teeManualColors,
            teeBoxes: (h.teeBoxes && h.teeBoxes.length > 0 ? h.teeBoxes : (h.teeData ? [h.teeData] : [])).map(tb => ({
                id: tb.id,
                points: tb.points,
                raised: tb.raised,
                raiseHeight: tb.raiseHeight !== undefined ? tb.raiseHeight : 0.5,
                blendRadius: tb.blendRadius !== undefined ? tb.blendRadius : 4.0,
                mowPattern: tb.mowPattern || 'SOLID',
                edgeSharpness: tb.edgeSharpness !== undefined ? tb.edgeSharpness : 100,
                activeTees: tb.activeTees || ['black', 'white', 'yellow', 'red'],
                baseElevation: tb.baseElevation,
                seedOffsetX: tb.seedOffsetX,
                seedOffsetZ: tb.seedOffsetZ,
                bbox: tb.bbox ? {
                    gxStart: tb.bbox.gxStart,
                    gxEnd: tb.bbox.gxEnd,
                    gzStart: tb.bbox.gzStart,
                    gzEnd: tb.bbox.gzEnd,
                    gWidth: tb.bbox.gWidth,
                    gHeight: tb.bbox.gHeight,
                    pxMinX: tb.bbox.pxMinX,
                    pxMaxX: tb.bbox.pxMaxX,
                    pxMinY: tb.bbox.pxMinY,
                    pxMaxY: tb.bbox.pxMaxY,
                    pw: tb.bbox.pw,
                    ph: tb.bbox.ph,
                    margin: tb.bbox.margin
                } : null,
                origHeights: tb.origHeights ? Array.from(tb.origHeights) : null
            })),
            teeData: (h.teeBoxes && h.teeBoxes[0]) ? {
                id: h.teeBoxes[0].id,
                points: h.teeBoxes[0].points,
                raised: h.teeBoxes[0].raised,
                raiseHeight: h.teeBoxes[0].raiseHeight !== undefined ? h.teeBoxes[0].raiseHeight : 0.5,
                blendRadius: h.teeBoxes[0].blendRadius !== undefined ? h.teeBoxes[0].blendRadius : 4.0,
                mowPattern: h.teeBoxes[0].mowPattern || 'SOLID',
                edgeSharpness: h.teeBoxes[0].edgeSharpness !== undefined ? h.teeBoxes[0].edgeSharpness : 100,
                activeTees: h.teeBoxes[0].activeTees || ['black', 'white', 'yellow', 'red'],
                baseElevation: h.teeBoxes[0].baseElevation,
                seedOffsetX: h.teeBoxes[0].seedOffsetX,
                seedOffsetZ: h.teeBoxes[0].seedOffsetZ,
                bbox: h.teeBoxes[0].bbox ? {
                    gxStart: h.teeBoxes[0].bbox.gxStart,
                    gxEnd: h.teeBoxes[0].bbox.gxEnd,
                    gzStart: h.teeBoxes[0].bbox.gzStart,
                    gzEnd: h.teeBoxes[0].bbox.gzEnd,
                    gWidth: h.teeBoxes[0].bbox.gWidth,
                    gHeight: h.teeBoxes[0].bbox.gHeight,
                    pxMinX: h.teeBoxes[0].bbox.pxMinX,
                    pxMaxX: h.teeBoxes[0].bbox.pxMaxX,
                    pxMinY: h.teeBoxes[0].bbox.pxMinY,
                    pxMaxY: h.teeBoxes[0].bbox.pxMaxY,
                    pw: h.teeBoxes[0].bbox.pw,
                    ph: h.teeBoxes[0].bbox.ph,
                    margin: h.teeBoxes[0].bbox.margin
                } : null,
                origHeights: h.teeBoxes[0].origHeights ? Array.from(h.teeBoxes[0].origHeights) : null
            } : (h.teeData ? {
                id: h.teeData.id,
                points: h.teeData.points,
                raised: h.teeData.raised,
                raiseHeight: h.teeData.raiseHeight !== undefined ? h.teeData.raiseHeight : 0.5,
                blendRadius: h.teeData.blendRadius !== undefined ? h.teeData.blendRadius : 4.0,
                mowPattern: h.teeData.mowPattern || 'SOLID',
                edgeSharpness: h.teeData.edgeSharpness !== undefined ? h.teeData.edgeSharpness : 100,
                activeTees: h.teeData.activeTees || ['black', 'white', 'yellow', 'red'],
                baseElevation: h.teeData.baseElevation,
                seedOffsetX: h.teeData.seedOffsetX,
                seedOffsetZ: h.teeData.seedOffsetZ,
                bbox: h.teeData.bbox ? {
                    gxStart: h.teeData.bbox.gxStart,
                    gxEnd: h.teeData.bbox.gxEnd,
                    gzStart: h.teeData.bbox.gzStart,
                    gzEnd: h.teeData.bbox.gzEnd,
                    gWidth: h.teeData.bbox.gWidth,
                    gHeight: h.teeData.bbox.gHeight,
                    pxMinX: h.teeData.bbox.pxMinX,
                    pxMaxX: h.teeData.bbox.pxMaxX,
                    pxMinY: h.teeData.bbox.pxMinY,
                    pxMaxY: h.teeData.bbox.pxMaxY,
                    pw: h.teeData.bbox.pw,
                    ph: h.teeData.bbox.ph,
                    margin: h.teeData.bbox.margin
                } : null,
                origHeights: h.teeData.origHeights ? Array.from(h.teeData.origHeights) : null
            } : null)
        }));
    };

    // Until loadLevel has read the stored course, the world is still the empty default. Anything that saved in that window (the surroundings
    // dropdowns, removePanorama and others run while the page starts) overwrote the stored draft with an empty course before it was read,
    // so opening "Snabbutkast" showed nothing. loadLevel clears the flag when it is done. It always runs: arcade.html starts it when the device
    // id is known or after 8 s at the latest, and there is deliberately no timer that releases the flag, since that would let a slow load
    // be overwritten again.
    if (window._courseLoading === undefined) window._courseLoading = true;

    async function saveLevel(isAuto = false, noEdit = false) {
        if (window._courseLoading) return null; // not now: see above
        if (!isAuto && !noEdit) window._editRev = (window._editRev || 0) + 1; // the next-step guide: a direct save (panorama, quick save) means the course changed
        let sText = document.getElementById('save-status-text');
        let sIcon = document.getElementById('save-status-icon');
        let sInd = document.getElementById('save-status-indicator');
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');

        if (sText) sText.textContent = isSv ? 'Sparar' : 'Saving';
        if (sIcon) sIcon.textContent = '⏳';
        if (sInd) {
            sInd.style.color = '#fbbf24';
            sInd.style.background = 'rgba(251,191,36,0.12)';
            sInd.style.borderColor = 'rgba(251,191,36,0.3)';
            sInd.title = isSv ? 'Sparar banan...' : 'Saving course...';
        }

        let dumpTargets = targets.map(t => ({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor }));
        let dumpHoles = window.serializeHolesFull();
        let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({
            type: t.type, x: t.x, z: t.z, s: t.scale, r: t.rot, tilt: t.tiltX, roll: t.rollZ, c: t.color, tc: t.trunkColor, yOffset: t.yOffset || 0, brightness: t.brightness !== undefined ? t.brightness : 1.0
        })) : [];

        // Fast heightmap extraction (1ms instead of 200ms Array.from.filter)
        let hm = [];
        if (typeof planeGeo !== 'undefined' && planeGeo.attributes && planeGeo.attributes.position) {
            let pos = planeGeo.attributes.position.array;
            let vCount = (window.TERRAIN_SEGS + 1) * (window.TERRAIN_SEGS + 1);
            hm = new Array(vCount);
            for (let i = 0; i < vCount; i++) {
                hm[i] = pos[i * 3 + 2];
            }
        }
        let w_hm = window.waterData ? Array.from(window.waterData) : [];

        // Cached 4K texture data URLs to avoid freezing main thread on every save
        if (window._cachedBiomeDataUrl === undefined || window._biomeDirty) {
            if (typeof pCtx !== 'undefined' && pCtx.canvas) {
                window._cachedBiomeDataUrl = pCtx.canvas.toDataURL('image/jpeg', 0.8);
            } else {
                window._cachedBiomeDataUrl = null;
            }
            window._biomeDirty = false;
        }
        let biome = window._cachedBiomeDataUrl;

        if (window._cachedWaterMaskDataUrl === undefined || window._waterMaskDirty) {
            if (typeof wCtx !== 'undefined' && wCtx.canvas) {
                window._cachedWaterMaskDataUrl = wCtx.canvas.toDataURL('image/jpeg', 0.8);
            } else {
                window._cachedWaterMaskDataUrl = null;
            }
            window._waterMaskDirty = false;
        }
        let w_mask = window._cachedWaterMaskDataUrl;

        let fullData = {
            _fullSave: true,
            edit_code: (typeof currentEditCode !== 'undefined' && currentEditCode) ? currentEditCode : null,
            edit_is_published: !!window._editIsPublished,
            name: (document.getElementById('course-name-input') && document.getElementById('course-name-input').value) || 'Quick Draft',
            author: (document.getElementById('author-name-input') && document.getElementById('author-name-input').value) || '',
            targets: dumpTargets,
            holes: dumpHoles,
            trees: dumpTrees,
            terrain_heightmap: {
                ground: hm,
                water: w_hm,
                segs: window.TERRAIN_SEGS || 600,
                size: window.TERRAIN_SIZE || 600,   // metres: the grid and the picture have no size of their own
                terrainGrid: window._terrainGridSegs || window.TERRAIN_SEGS || 600,
                waterTableLevel: window.waterTableLevel !== undefined ? window.waterTableLevel : 0,
                waterType: window.currentWaterType || 'CLEAR'
            },
            terrain_biomemap: biome,
            terrain_watermask: w_mask,
            theme_data: {
                biomeId: window.ACTIVE_BIOME || 'GLOBAL',
                config: window.CURRENT_BIOME_CONFIG,
                particleIntensity: window.ParticleEngine ? window.ParticleEngine.getIntensity() : 0.6,
                particleSize: window.ParticleEngine ? window.ParticleEngine.getSize() : 1.0,
                weatherMode: window.ParticleEngine ? window.ParticleEngine.getWeather() : 'CLEAR',
                enableOrganicNoise: !!window.ENABLE_ORGANIC_NOISE
            }
        };

        if (window.ArcadeStorage && window.ArcadeStorage.saveFullDraft) {
            await window.ArcadeStorage.saveFullDraft('quick_draft', fullData);
        } else if (window.ArcadeStorage) {
            window.ArcadeStorage.saveCustomLevel(fullData);
        }

        try {
            let u = new URL(window.location.href);
            if (u.searchParams.get('autorun') === 'new_build') {
                u.searchParams.set('autorun', 'edit_build');
                window.history.replaceState({}, '', u.toString());
            }
        } catch(e) {}

        window.hasUnsavedChanges = false;

        setTimeout(() => {
            if (sText) sText.textContent = isSv ? 'Sparad' : 'Saved';
            if (sIcon) sIcon.textContent = '✓';
            if (sInd) {
                sInd.style.color = '#4ade80';
                sInd.style.background = 'rgba(74,222,128,0.12)';
                sInd.style.borderColor = 'rgba(74,222,128,0.3)';
                sInd.title = isSv ? 'Banan är sparad (Autosave är aktivt)' : 'Course is saved (Autosave active)';
            }
        }, 200);
        return fullData;
    }
    window.saveLevel = saveLevel;
    window.saveQuickDraft = function(isAuto) {
        return saveLevel(isAuto, true); // saving the course as it is does not change it
    };

    // Debounced course saver: coalesces rapid operations (e.g. sculpt strokes) so UI never stutters
    window.debounceSaveCourse = function(delay = 1500) {
        window._editRev = (window._editRev || 0) + 1; // the next-step guide: the course changed since any playtest
        window.hasUnsavedChanges = true;
        let sText = document.getElementById('save-status-text');
        let sIcon = document.getElementById('save-status-icon');
        let sInd = document.getElementById('save-status-indicator');
        let isSv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
        if (sText) sText.textContent = isSv ? 'Ändrad' : 'Unsaved';
        if (sIcon) sIcon.textContent = '●';
        if (sInd) {
            sInd.style.color = '#fbbf24';
            sInd.style.background = 'rgba(251,191,36,0.1)';
            sInd.style.borderColor = 'rgba(251,191,36,0.3)';
            sInd.title = isSv ? 'Osparade ändringar (Klicka för att spara direkt)' : 'Unsaved changes (Click to save now)';
        }

        if (window._saveDebounceTimer) clearTimeout(window._saveDebounceTimer);
        window._saveDebounceTimer = setTimeout(() => {
            window._saveDebounceTimer = null;
            saveLevel();
        }, delay);
    };
    
    
    // ============================================================
    // COURSE CAPTURE TOOL
    // ============================================================
    window.capturedPhotos = [];
    window.coverImageIndex = 0;
    
    window.startCaptureMode = function() {
        // Hide hole number labels and aim markers during photography
        scene.traverse(function(obj) { if(obj.name === 'holeLabel' || obj.name === 'aimPointMarker') obj.visible = false; });
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

    window.takeStudioScreenshot = function() {
        return new Promise((resolve) => {
            if (!window.renderer || !window.scene || !window.camera || !window.controls) {
                resolve(null);
                return;
            }
            
            const savedPos = window.camera.position.clone();
            const savedTarget = window.controls.target.clone();
            
            const hideIds = ['main-ui', 'build-toolbar', 'minimap-container', 'hud-overlay', 'capture-ui', 'brush-marker'];
            const savedDisplays = {};
            hideIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    savedDisplays[id] = el.style.display;
                    el.style.display = 'none';
                }
            });
            
            // Standard 45° isometric studio viewpoint of the full plate
            window.camera.position.set(135, 105, 135);
            window.controls.target.set(0, 0, 0);
            window.camera.lookAt(0, 0, 0);
            
            setTimeout(() => {
                window.renderer.render(window.scene, window.camera);
                const dataUrl = window.renderer.domElement.toDataURL('image/webp', 0.8);
                
                // Restore camera
                window.camera.position.copy(savedPos);
                window.controls.target.copy(savedTarget);
                window.camera.lookAt(savedTarget);
                
                // Restore UI
                hideIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && savedDisplays[id] !== undefined) {
                        el.style.display = savedDisplays[id];
                    }
                });
                
                resolve(dataUrl);
            }, 60);
        });
    };

    window.takeStudioScreenshotAndAdd = async function() {
        const btn = document.getElementById('btn-studio-snap');
        if (btn) btn.innerText = "⏳ Fotar...";
        const dataUrl = await window.takeStudioScreenshot();
        if (btn) btn.innerHTML = "📐 Studio Snap (45°)";
        
        if (dataUrl) {
            window.capturedPhotos.push(dataUrl);
            const counter = document.getElementById('capture-counter');
            if (counter) counter.innerText = 'Photos: ' + window.capturedPhotos.length + ' / 5';
            if (window.capturedPhotos.length >= 5) {
                endCaptureMode();
            }
        }
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
            html += `<div onclick="selectCoverImage(${i})" id="gallery-img-${i}" style="width:250px; height:140px; background-image:url('${img}'); background-size:cover; background-position:center; border-radius:12px; cursor:pointer; transition:all 0.2s; ${border}"></div>`;
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
        // Proceed with publish directly
        window._bypassCapture = true;
        publishCourse({ isDraft: false });
        window._bypassCapture = false;
    };
    // ── Smart Draft: auto-overwrite if we have an edit_code, otherwise new slot ──
    window.smartSaveDraft = function() {
        // a published course stays published: saving it "as a draft" would take it offline for everybody who plays it. Its edits are
        // published with the publish button (a new version of the same course), the working copy is kept as the quick draft meanwhile.
        if (currentEditCode && window._editIsPublished) {
            const sv = (window.getGolfLanguage && window.getGolfLanguage() === 'sv');
            if (typeof showBuildToast === 'function') showBuildToast(sv ? 'Banan är publicerad. Använd Publicera för att uppdatera den.' : 'This course is published. Use Publish to update it.', '#f59e0b');
            return;
        }
        let hasExistingDraft = !!currentEditCode;
        publishCourse({ isDraft: true, overwrite: hasExistingDraft });
    };

    // Only the person who built the course gets to its builder: a course someone else owns is played, never edited
    window.canEditLoadedCourse = function () {
        return window._loadedCanEdit === true;   // the server says whether the course is yours (its owner's id is not sent)
    };
    window.openBuilderForLoadedCourse = function (ask) {
        if (!window.canEditLoadedCourse() || !window._loadedShareCode) return;
        const tr = (k, fb) => (typeof window.t === 'function' && window.t(k) !== k) ? window.t(k) : fb;
        if (ask && !confirm(tr('sp_leave_round', 'Lämna rundan och gå till byggaren?'))) return;
        window.location.href = 'arcade.html?v=' + Date.now() + '&autorun=edit_build&edit=' + window._loadedShareCode;
    };
    window.refreshBuilderButtons = function () {
        const can = window.canEditLoadedCourse() && !!window._loadedShareCode && !window._isRangeMode;
        const a = document.getElementById('setup-edit-btn'); if (a) a.style.display = can ? 'inline-block' : 'none';
        const b = document.getElementById('btn-round-build'); if (b) b.style.display = (can && appMode === 'PLAY') ? 'inline-flex' : 'none';
    };

    // ── Save & play: the course is saved as a draft and played from that copy (what a player will see) ──
    window.saveAndPlay = async function () {
        if (window._savingForPlay) return;
        const tr = (k, fb) => (typeof window.t === 'function' && window.t(k) !== k) ? window.t(k) : fb;
        let ok = courseHoles.some(h => h && h.flag && h.tees && (h.tees.yellow || h.tees.white || h.tees.red || h.tees.black));
        if (!ok) { showBuildToast(tr('sp_need_hole', 'Lägg ut minst ett hål med tee och flagga först'), '#ef4444'); return; }
        const btn = document.getElementById('btn-mode-play');
        const label = btn ? btn.innerHTML : '';
        window._savingForPlay = true;
        if (btn) btn.innerHTML = '⏳ ' + tr('sp_saving', 'Sparar...');
        // a published course is never overwritten by playing it: its edits go to a separate draft copy that is reused each time
        const origCode = currentEditCode;
        const published = !!origCode && !!window._editIsPublished;
        window._playCopySource = published ? origCode : null; // the copy remembers its course, so deleting the course removes it too
        window._savingPlayCopy = published; // the copy is bookkeeping, not one of the builder's drafts (kept out of "My drafts")
        if (published) { try { currentEditCode = localStorage.getItem('golfPlayCopy_' + origCode) || null; } catch (e) { currentEditCode = null; } }
        let saved = false;
        try { saved = await publishCourse({ isDraft: true, overwrite: !!currentEditCode }); } catch (e) { saved = false; }
        const playCode = currentEditCode;
        if (published) {
            currentEditCode = origCode;
            window._editIsPublished = true; // publishCourse's own bookkeeping must not turn the original into a draft
            if (saved && playCode) { try { localStorage.setItem('golfPlayCopy_' + origCode, playCode); } catch (e) {} }
        }
        window._savingForPlay = false;
        window._savingPlayCopy = false;
        if (!saved || !playCode) {
            if (btn) btn.innerHTML = label;
            showBuildToast(tr('sp_failed', 'Det gick inte att spara banan. Försök igen.'), '#ef4444');
            return;
        }
        window.hasUnsavedChanges = false;
        window.location.href = 'arcade.html?v=' + Date.now() + '&autorun=setup&edit=' + playCode;
    };

    // ── Preview: populate stats when modal opens ──
    window.updatePublishPreview = function() {
        let playable = (typeof courseHoles !== 'undefined') ? courseHoles.filter(h => h.flag && h.tees && (h.tees.red || h.tees.yellow || h.tees.white || h.tees.black)) : [];
        let holeCount = playable.length;
        let totalPar = playable.reduce((s, h) => s + (h.par || 4), 0);
        let biome = window.ACTIVE_BIOME || 'Global';
        if (biome === 'ALL') biome = 'Global';
        
        let el1 = document.getElementById('pub-hole-count');
        let el2 = document.getElementById('pub-total-par');
        let el3 = document.getElementById('pub-biome');
        if (el1) el1.textContent = holeCount || '—';
        if (el2) el2.textContent = holeCount > 0 ? totalPar : '—';
        if (el3) el3.textContent = biome;

        // Pre-fill author from auth
        let authorInput = document.getElementById('author-name-input');
        if (authorInput && !authorInput.value && window.GolfAuth?.user?.display_name) {
            authorInput.value = window.GolfAuth.user.display_name;
        }
    };

    window.publishCourse = async function(options = { isDraft: false }) {
        // a course that was opened from, or already saved to, the server is updated in place: publishing a draft turns that draft into the
        // published course and publishing a published course again is a new version of it, never a second copy
        if (options.overwrite === undefined) options = Object.assign({}, options, { overwrite: !!currentEditCode });
        let name = document.getElementById('course-name-input').value;
        let author = document.getElementById('author-name-input').value;
        let stat = document.getElementById('publish-status');
        stat.innerText = "Processing...";

        function showError(msg) {
            stat.style.color = '#ef4444';
            stat.innerText = "❌ " + msg;
        }

        if(!name && !options.isDraft) { showError("Please enter a course name!"); return; }
        
        if (!options.isDraft) {
            let isRange = (new URLSearchParams(window.location.search)).get('mode') === 'range' || window._isRangeMode;
            if (!isRange) {
                let h1HasTee = courseHoles[0].tees && (courseHoles[0].tees.red || courseHoles[0].tees.yellow || courseHoles[0].tees.white || courseHoles[0].tees.black);
                if(!h1HasTee || !courseHoles[0].flag) {
                    showError("Validation Error: You must build at least Hole 1 with a Tee and a Flag.");
                    return;
                }
            }
        }

                // === CAPTURE REQUIREMENT ===
        if (!options.isDraft && (!window.capturedPhotos || window.capturedPhotos.length === 0) && !window._bypassCapture) {
            document.getElementById('publish-modal').style.display = 'none';
            if (confirm("📸 To publish your course, you need to capture showcase photos first.\n\nEnter Camera Mode?")) {
                startCaptureMode();
            }
            return;
        }

        // === HOLE INTEGRITY VALIDATION ===
        if (!options.isDraft) {
            for (let i = 0; i < MAX_HOLES; i++) {
                let h = courseHoles[i];
                let hasTee = h.tees && (h.tees.red || h.tees.yellow || h.tees.white || h.tees.black);
                let hasFlag = !!h.flag;
                
                // Skip empty holes
                if (!hasTee && !hasFlag) continue;
                
                // Incomplete hole: has tee but no flag, or vice versa
                if (hasTee && !hasFlag) {
                    showError('Hole ' + (i+1) + ' has Tee markers but no Flag! Each hole needs both.');
                    return;
                }
                if (!hasTee && hasFlag) {
                    showError('Hole ' + (i+1) + ' has a Flag but no Tee markers!');
                    return;
                }
                
                // Tee distance validation: Red < Yellow < White < Black from flag
                if (hasFlag && hasTee) {
                    let fx = h.flag.x, fz = h.flag.z;
                    let teeDists = {};
                    let teeOrder = ['red', 'yellow', 'white', 'black'];
                    teeOrder.forEach(t => {
                        if (h.tees[t]) {
                            let dx = h.tees[t].x - fx;
                            let dz = h.tees[t].z - fz;
                            teeDists[t] = Math.sqrt(dx*dx + dz*dz);
                        }
                    });
                    
                    // Check ordering: Red should be closest, Black furthest
                    let keys = Object.keys(teeDists);
                    if (keys.length >= 2) {
                        let orderIdx = t => teeOrder.indexOf(t);
                        for (let a = 0; a < keys.length; a++) {
                            for (let b = a+1; b < keys.length; b++) {
                                if (orderIdx(keys[a]) < orderIdx(keys[b]) && teeDists[keys[a]] > teeDists[keys[b]]) {
                                    showError('Hole ' + (i+1) + ': ' + keys[a].toUpperCase() + ' tee (' + Math.round(teeDists[keys[a]]) + 'm) is further than ' + keys[b].toUpperCase() + ' tee (' + Math.round(teeDists[keys[b]]) + 'm)! Red should be closest, Black furthest.');
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        let dumpTargets = targets.map(t => ({ x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor }));
        // a draft is opened in the builder again, so it keeps every editable definition; a published course only needs what is played
        let dumpHoles = options.isDraft ? window.serializeHolesFull() : courseHoles.map(h => ({
            par: h.par, tees: h.tees, flag: h.flag ? {x: h.flag.x, y: h.flag.y, z: h.flag.z} : null,
            panorama: h.panorama || null,
            surrounding: h.surrounding || null,
            surroundConfig: h.surroundConfig || null,
            envObjects: window.serializeEnvObjects(h)
        }));
        let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({type: t.type, x: t.x, z: t.z, s: t.scale, r: t.rot, tilt: t.tiltX, roll: t.rollZ, c: t.color, tc: t.trunkColor, yOffset: t.yOffset || 0, brightness: t.brightness !== undefined ? t.brightness : 1.0})) : [];
        
        let hm = Array.from(planeGeo.attributes.position.array).filter((v, i) => i % 3 === 2); 
        let w_hm = window.waterData ? Array.from(window.waterData) : [];
        let biome = pCtx.canvas.toDataURL('image/jpeg', 0.8);
        let w_mask = (typeof wCtx !== 'undefined') ? wCtx.canvas.toDataURL('image/jpeg', 0.8) : null;

        try {
            // Count playable holes (have at least one tee + flag)
            let playableHoles = dumpHoles.filter(h => h.flag && h.tees && (h.tees.red || h.tees.yellow || h.tees.white || h.tees.black));
            let holeCount = playableHoles.length;
            let totalPar = playableHoles.reduce((sum, h) => sum + (h.par || 4), 0);

            let payload = {
                name: name || "Draft",
                author: author || "Builder",
                holes: dumpHoles,
                hole_count: holeCount,
                total_par: totalPar,
                targets: dumpTargets,
                trees: dumpTrees,
                terrain_heightmap: JSON.stringify({ground: hm, water: w_hm, segs: TERRAIN_SEGS, size: window.TERRAIN_SIZE || 600, terrainGrid: window._terrainGridSegs || TERRAIN_SEGS, waterTableLevel: window.waterTableLevel, waterType: window.currentWaterType}),
                terrain_biomemap: biome,
                terrain_watermask: w_mask,
                is_draft: options.isDraft,
                // a published course's holes keep only what is played; the builder's own definitions go along for its owner
                builder_holes: options.isDraft ? undefined : window.serializeHolesFull(),
                is_range: (new URLSearchParams(window.location.search)).get('mode') === 'range' || !!window._isRangeMode,
                theme_data: { _playCopy: window._savingPlayCopy ? true : undefined, _playCopyOf: window._savingPlayCopy ? (window._playCopySource || undefined) : undefined, biomeId: window.ACTIVE_BIOME, config: window.CURRENT_BIOME_CONFIG, particleIntensity: window.ParticleEngine ? window.ParticleEngine.getIntensity() : 0.6, particleSize: window.ParticleEngine ? window.ParticleEngine.getSize() : 1.0, weatherMode: window.ParticleEngine ? window.ParticleEngine.getWeather() : 'CLEAR', enableOrganicNoise: window.ENABLE_ORGANIC_NOISE },
                owner_id: window.GolfAuth?.userId || null,
                cover_image: (window.capturedPhotos && window.capturedPhotos.length > 0) 
                    ? window.capturedPhotos[window.coverImageIndex || 0] 
                    : ((typeof renderer !== 'undefined' && renderer && renderer.domElement) ? (() => {
                        try { return renderer.domElement.toDataURL('image/jpeg', 0.8); } catch(e) { return null; }
                      })() : null)
            };
            
            if (options.overwrite && currentEditCode) {
                payload.edit_code = currentEditCode; // the server bumps the version when a published course is published again
            }
            
            let data = await ArcadeAPI.saveCourse(payload);
            if(data.success) {
                currentEditCode = data.share_code;
                window._editIsPublished = !options.isDraft;
                window.hasUnsavedChanges = false;
                
                // "My drafts" holds drafts only: a published course leaves the list, a draft joins it
                if (options.isDraft && window._savingPlayCopy) {
                    // a play copy never shows in the list
                } else if (options.isDraft) {
                    ArcadeStorage.addOrUpdateDraft(data.share_code, payload.name);
                } else if (ArcadeStorage.removeDraft) {
                    ArcadeStorage.removeDraft(data.share_code);
                }
                
                let isRange = (new URLSearchParams(window.location.search)).get('mode') === 'range' || !!window._isRangeMode;
                // the address stays the builder's (a reload must reopen the builder, not start a round); the link to share is the player link
                let builderHref = window.location.origin + window.location.pathname + '?autorun=edit_build&edit=' + data.share_code + (isRange ? '&mode=range' : '');
                let href = options.isDraft ? builderHref : window.location.origin + window.location.pathname + '?course=' + data.share_code + (isRange ? '&mode=range' : '');
                
                window.history.pushState({}, '', builderHref);
                try { window.refreshBuilderButtons && window.refreshBuilderButtons(); } catch (e) {}
                let draftBtn = document.getElementById('btn-save-draft');
                if (draftBtn) draftBtn.style.display = options.isDraft ? 'block' : 'none';
                // the working copy on this device now belongs to the saved course (so a later Publish updates it); not for a play copy,
                // but Save & play on an unpublished course saves the real draft, and that one must be remembered too
                // (awaited: the success below is only reported once the working copy knows, so leaving at once cannot leave it marked as a draft)
                if (!window._savingPlayCopy && typeof window.saveQuickDraft === 'function') {
                    try { await window.saveQuickDraft(true); } catch (e) { console.warn('Quick draft refresh failed:', e); }
                }
                
                stat.style.color = '#4ade80';
                stat.innerHTML = "Saved! Your link:<br><a href='"+href+"' style='color:#38bdf8; word-break: break-all;'>" + href + "</a>";
                return true;
            } else {
                if (data.code === 'already_published') {
                    // saved as published elsewhere (another tab or device): this tab must not offer "Save draft" any more
                    window._editIsPublished = true;
                    let draftBtn = document.getElementById('btn-save-draft');
                    if (draftBtn) draftBtn.style.display = 'none';
                }
                showError("Failed: " + data.error);
            }
        } catch(e) {
            showError("Error connecting to server.");
        }
    };

    // ============================================================
    // COURSE SHARING VIA URL (Offline — no server needed)
    // ============================================================
    window.exportCourseURL = function() {
        let statusEl = document.getElementById('share-link-status');
        try {
            // Gather course data (same format as saveLevel)
            let dumpTargets = targets.map(t => ({x: t.mesh.position.x, y: t.mesh.position.y, z: t.mesh.position.z, c: t.defColor}));
            let dumpHoles = courseHoles.map(h => ({
                par: h.par, tees: h.tees, flag: h.flag ? {x:h.flag.x, y:h.flag.y, z:h.flag.z} : null
            }));
            let dumpTrees = window.placedTrees ? window.placedTrees.map(t => ({t:t.type, x:Math.round(t.x*10)/10, z:Math.round(t.z*10)/10, s:Math.round(t.scale*100)/100, r:Math.round((t.rot||0)*100)/100, tilt:Math.round((t.tiltX||0)*100)/100, roll:Math.round((t.rollZ||0)*100)/100, c:t.color, tc:t.trunkColor, yOffset:Math.round((t.yOffset||0)*100)/100, brightness:t.brightness !== undefined ? Math.round(t.brightness*100)/100 : 1.0})) : [];

            // Compact terrain heightmap (only Y values, rounded to 2 decimals)
            let heights = [];
            let pos = planeGeo.attributes.position.array;
            for (let i = 2; i < pos.length; i += 3) {
                heights.push(Math.round(pos[i] * 100) / 100);
            }

            // Water heightmap
            let waterHeights = [];
            if (window.waterData) {
                for (let i = 0; i < window.waterData.length; i++) {
                    waterHeights.push(Math.round(window.waterData[i] * 100) / 100);
                }
            }

            let payload = {
                v: 2, // Version 2: includes terrain_segs
                h: dumpHoles,
                t: dumpTargets,
                r: dumpTrees,
                m: heights,
                w: waterHeights.length > 0 ? waterHeights : undefined,
                segs: TERRAIN_SEGS // Save current resolution for load-time validation
            };

            let json = JSON.stringify(payload);
            
            // Compress with pako
            if (typeof pako === 'undefined') {
                if (statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = '❌ Compression library not loaded'; }
                return;
            }
            let compressed = pako.deflate(json);
            
            // Convert to base64url
            let binary = '';
            for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
            let base64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            
            let url = window.location.origin + window.location.pathname + '#share=' + base64;
            
            // Copy to clipboard
            navigator.clipboard.writeText(url).then(() => {
                if (statusEl) {
                    statusEl.style.color = '#4ade80';
                    statusEl.innerHTML = '✅ Link copied! (' + Math.round(base64.length/1024) + 'KB)<br><span style="color:#64748b;font-size:10px;word-break:break-all;">' + url.substring(0, 80) + '...</span>';
                }
            }).catch(() => {
                // Fallback: show URL for manual copy
                if (statusEl) {
                    statusEl.style.color = '#fbbf24';
                    statusEl.innerHTML = '📋 Copy this URL:<br><input type="text" value="' + url + '" style="width:100%;padding:4px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:4px;font-size:10px;" onclick="this.select();" readonly>';
                }
            });

            console.log('Share URL generated: ' + Math.round(json.length/1024) + 'KB JSON → ' + Math.round(base64.length/1024) + 'KB compressed');
            
        } catch(e) {
            console.error('Export error:', e);
            if (statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = '❌ Export failed: ' + e.message; }
        }
    };
