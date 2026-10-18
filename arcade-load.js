    // === HEIGHTMAP RESAMPLE UTILITY (top-level — used by ALL load paths) ===
    // Bilinear interpolation to convert heightmap between different TERRAIN_SEGS
    window._resampleHeightmap = function(srcArr, srcSegs, dstSegs) {
        let srcStride = srcSegs + 1;
        let dstStride = dstSegs + 1;
        let result = new Array(dstStride * dstStride);
        for (let dz = 0; dz < dstStride; dz++) {
            for (let dx = 0; dx < dstStride; dx++) {
                let sx = (dx / dstSegs) * srcSegs;
                let sz = (dz / dstSegs) * srcSegs;
                let x0 = Math.floor(sx), x1 = Math.min(x0 + 1, srcSegs);
                let z0 = Math.floor(sz), z1 = Math.min(z0 + 1, srcSegs);
                let fx = sx - x0, fz = sz - z0;
                let h00 = srcArr[z0 * srcStride + x0] || 0;
                let h10 = srcArr[z0 * srcStride + x1] || 0;
                let h01 = srcArr[z1 * srcStride + x0] || 0;
                let h11 = srcArr[z1 * srcStride + x1] || 0;
                result[dz * dstStride + dx] = (h00*(1-fx)*(1-fz) + h10*fx*(1-fz) + h01*(1-fx)*fz + h11*fx*fz);
            }
        }
        return result;
    };

    function importCourseHash() {
        try {
            let hash = window.location.hash;
            if (!hash || !hash.startsWith('#share=')) return null;
            
            let base64 = hash.substring(7); // Remove '#share='
            // Restore base64 from base64url
            base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            
            let binary = atob(base64);
            let bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            
            let json = pako.inflate(bytes, { to: 'string' });
            let data = JSON.parse(json);
            
            if (data.v !== 1) { console.warn('Unknown share format version:', data.v); }
            
            // Convert compact format back to loadLevel format
            let result = {
                targets: data.t || [],
                holes: data.h || [],
                trees: (data.r || []).map(t => ({type: t.t, x: t.x, z: t.z, s: t.s, r: t.r, tilt: t.tilt, roll: t.roll}))
            };
            
            // _resampleHeightmap is now defined at top-level scope (always available)

            // Restore terrain heightmap
            if (data.m && data.m.length > 0) {
                let heightData = data.m;
                let savedSegs = data.segs || Math.round(Math.sqrt(data.m.length) - 1);
                // Resample if segment count doesn't match
                if (savedSegs !== TERRAIN_SEGS) {
                    console.warn('[TERRAIN] Resampling heightmap:', savedSegs, '→', TERRAIN_SEGS);
                    heightData = _resampleHeightmap(heightData, savedSegs, TERRAIN_SEGS);
                }
                let pos = planeGeo.attributes.position.array;
                let vertCount = (TERRAIN_SEGS + 1) * (TERRAIN_SEGS + 1);
                for (let i = 0; i < vertCount && i < heightData.length; i++) {
                    pos[i * 3 + 2] = heightData[i];
                }

                planeGeo.attributes.position.needsUpdate = true;
                planeGeo.computeVertexNormals();
                if (window._terrainChunks) window._terrainChunks.syncAll();
            }

            // RESET water mesh to -99 BEFORE loading — prevents ghost water
            if (window.waterData) {
                window.waterData.fill(-99);
                window.waterBaseZ.fill(-99);
                if (window.syncWaterVisual) window.syncWaterVisual();
                if (typeof wCtx !== 'undefined') {
                    wCtx.fillStyle = '#000000';
                    wCtx.fillRect(0, 0, 4096, 4096);
                    if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
                }
            }

            // Restore water heightmap
            if (data.w && data.w.length > 0 && window.waterData) {
                for (let i = 0; i < data.w.length && i < window.waterData.length; i++) {
                    window.waterData[i] = data.w[i];
                    window.waterBaseZ[i] = data.w[i];
                }
                if (window.syncWaterVisual) window.syncWaterVisual();
                // Rebuild water alpha mask from loaded heightmap
                rebuildWaterMask();
            }
            
            console.log('Imported shared course: ' + (result.trees ? result.trees.length : 0) + ' trees, ' + (result.holes ? result.holes.length : 0) + ' holes');
            return result;
            
        } catch(e) {
            console.error('Import error:', e);
            return null;
        }
    }

    window.applyStarterTemplate = async function(template, biome) {
        console.log(`🚀 Applying Starter Template: ${template} with Biome: ${biome}`);
        
        // 1. Cleanly set the chosen biome
        if (biome && typeof window.changeBiome === 'function') {
            window.changeBiome(biome);
        }

        // Try to fetch custom cloud starter plate
        try {
            const res = await fetch(`/api/starter-plates/${template}`);
            if (res.ok) {
                const plate = await res.json();
                if (plate && plate.course_data) {
                    console.log('✅ Loaded handcrafted 3D starter plate:', plate.name);
                    const data = typeof plate.course_data === 'string' ? JSON.parse(plate.course_data) : plate.course_data;
                    
                    if (data.theme_data && data.theme_data.biome && typeof window.changeBiome === 'function') {
                        window.changeBiome(data.theme_data.biome);
                    }

                    if (data.terrain_heightmap) {
                        let mapData = (typeof data.terrain_heightmap === 'string') ? JSON.parse(data.terrain_heightmap) : data.terrain_heightmap;
                        let pos = planeGeo.attributes.position;
                        if (window.waterData) {
                            window.waterData.fill(-99);
                            window.waterBaseZ.fill(-99);
                        }
                        if (typeof wCtx !== 'undefined') {
                            wCtx.fillStyle = '#000000';
                            wCtx.fillRect(0, 0, 4096, 4096);
                            if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
                        }

                        let groundArr = Array.isArray(mapData) ? mapData : mapData.ground;
                        let waterArr = Array.isArray(mapData) ? null : mapData.water;

                        if (groundArr) {
                            let savedSegs = mapData.segs || Math.round(Math.sqrt(groundArr.length) - 1);
                            let heightData = groundArr;
                            if (savedSegs !== TERRAIN_SEGS && savedSegs > 0 && typeof _resampleHeightmap === 'function') {
                                heightData = _resampleHeightmap(groundArr, savedSegs, TERRAIN_SEGS);
                            }
                            let vertCount = (TERRAIN_SEGS + 1) * (TERRAIN_SEGS + 1);
                            for(let i=0; i<vertCount && i<heightData.length; i++) pos.setZ(i, heightData[i]);
                        }
                        if (waterArr && window.waterData) {
                            for(let i=0; i<waterArr.length && i<window.waterData.length; i++) {
                                window.waterData[i] = waterArr[i];
                                window.waterBaseZ[i] = waterArr[i];
                            }
                        }

                        pos.needsUpdate = true;
                        if (window.syncWaterVisual) window.syncWaterVisual();
                        planeGeo.computeVertexNormals();
                        if (window._terrainChunks) window._terrainChunks.syncAll();
                        if (waterArr && waterArr.some(v => v > -90) && typeof rebuildWaterMask === 'function') {
                            rebuildWaterMask();
                        }
                    }

                    if (data.terrain_biomemap && window.pCtx) {
                        let img = new Image();
                        img.onload = () => {
                            pCtx.drawImage(img, 0, 0);
                            if (typeof mapTex !== 'undefined') mapTex.needsUpdate = true;
                            window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
                            if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
                            if (window._terrainShells) window._terrainShells.refresh();
                        };
                        img.src = data.terrain_biomemap;
                    }

                    if (data.trees && Array.isArray(data.trees) && typeof createTree === 'function') {
                        let uniqueTypes = new Set();
                        data.trees.forEach(t => {
                            createTree(t.type || t.t, t.x, t.z, t.s, t.r, t.c, t.tc, t.yOffset || 0, t.brightness !== undefined ? t.brightness : 1.0, true, t.tilt, t.roll);
                            uniqueTypes.add(t.type || t.t);
                        });
                        uniqueTypes.forEach(type => {
                            if (typeof window.rebuildInstancePool === 'function') window.rebuildInstancePool(type);
                        });
                    }

                    setTimeout(() => { if (typeof snapObjectsToGround === 'function') snapObjectsToGround(); }, 150);
                    return;
                }
            }
        } catch(e) {
            console.log("Using procedural template fallback:", e);
        }

        let half = TERRAIN_SIZE / 2;
        let tSegs = window.TERRAIN_SEGS || 128;
        let pos = planeGeo.attributes.position;
        let tStep = TERRAIN_SIZE / tSegs;

        // Reset all heights to 0
        for (let i = 0; i < pos.count; i++) {
            pos.setZ(i, 0);
        }

        // Reset water data
        if (window.waterData) {
            window.waterData.fill(-99);
            if (window.waterBaseZ) window.waterBaseZ.fill(-99);
        }
        if (typeof wCtx !== 'undefined') {
            wCtx.fillStyle = '#000000';
            wCtx.fillRect(0, 0, 4096, 4096);
        }

        // Base ground color re-fill based on biome
        if (window.pCtx && window.CURRENT_BIOME_CONFIG) {
            let baseColor = window.CURRENT_BIOME_CONFIG.fescueColor || '#315b2b';
            if (biome === 'DESERT') baseColor = window.CURRENT_BIOME_CONFIG.wasteColor || '#c2853a';
            else if (biome === 'MOON') baseColor = window.CURRENT_BIOME_CONFIG.roughColor || '#334155';
            
            pCtx.fillStyle = baseColor;
            pCtx.fillRect(0, 0, 4096, 4096);
        }

        // Helper to add water
        function addWaterBody(waterShapeCheck, waterZ = -0.5) {
            if (!window.waterData) return;
            for (let tz = 0; tz <= tSegs; tz++) {
                for (let tx = 0; tx <= tSegs; tx++) {
                    let worldX = -half + tx * tStep;
                    let worldY = -half + tz * tStep;
                    let idx = tz * (tSegs + 1) + tx;
                    if (waterShapeCheck(worldX, worldY)) {
                        window.waterData[idx] = waterZ;
                        if (window.waterBaseZ) window.waterBaseZ[idx] = waterZ;
                    }
                }
            }
        }

        // Helper to draw colored ellipses on ground canvas
        function drawCanvasFeature(worldX, worldY, rx, ry, color, rotation = 0) {
            if (!window.pCtx) return;
            let cx = 2048 + (worldX / half) * 2048;
            let cy = 2048 - (worldY / half) * 2048;
            let prx = (rx / half) * 2048;
            let pry = (ry / half) * 2048;
            pCtx.save();
            pCtx.translate(cx, cy);
            pCtx.rotate(rotation);
            pCtx.fillStyle = color;
            pCtx.beginPath();
            pCtx.ellipse(0, 0, Math.max(1, prx), Math.max(1, pry), 0, 0, Math.PI * 2);
            pCtx.fill();
            pCtx.restore();
        }

        // Helper to add water oval
        function createOvalWater(worldX, worldY, rx, ry, depth = -3.5, waterZ = -0.5) {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i);
                let y = pos.getY(i);
                let dx = (x - worldX) / rx;
                let dy = (y - worldY) / ry;
                let dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1.0) {
                    let dip = depth * Math.cos(dist * Math.PI / 2);
                    let currentZ = pos.getZ(i);
                    pos.setZ(i, Math.min(currentZ, dip));
                }
            }
            addWaterBody((wx, wy) => {
                let dx = (wx - worldX) / (rx * 0.95);
                let dy = (wy - worldY) / (ry * 0.95);
                return (dx * dx + dy * dy) < 1.0;
            }, waterZ);

            let bunkerColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.bunkerColor) || '#e0d8a4';
            let waterColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.waterColor) || '#38bdf8';
            drawCanvasFeature(worldX, worldY, rx * 1.08, ry * 1.08, bunkerColor);
            drawCanvasFeature(worldX, worldY, rx * 0.95, ry * 0.95, waterColor);
        }

        function applyCraters(craters) {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let z = pos.getZ(i);
                for (let c of craters) {
                    let d = Math.hypot(x - c.cx, y - c.cy);
                    if (d < c.r) {
                        let frac = d / c.r;
                        let bowl = -c.depth * (1 - frac * frac);
                        let rim = (frac > 0.72) ? (c.rim * Math.sin((frac - 0.72) / 0.28 * Math.PI)) : 0;
                        z += bowl + rim;
                    }
                }
                pos.setZ(i, z);
            }
        }

        // --- TEMPLATE GENERATORS ---

        // 1. Pure Flat (Classic Flat / Flat Sand / Lunar Flat / Clean Slate)
        if (template === 'flat' || template === 'flat_sand' || template === 'lunar_flat' || template === 'clean') {
            // Already 0
        }
        
        // 2. Grid Studio
        else if (template === 'grid_guide') {
            if (window.pCtx) {
                pCtx.strokeStyle = 'rgba(255,255,255,0.15)';
                pCtx.lineWidth = 4;
                for (let x = 0; x <= 4096; x += 256) {
                    pCtx.beginPath(); pCtx.moveTo(x, 0); pCtx.lineTo(x, 4096); pCtx.stroke();
                    pCtx.beginPath(); pCtx.moveTo(0, x); pCtx.lineTo(4096, x); pCtx.stroke();
                }
            }
        }

        // 3. Central Lake
        else if (template === 'lake') {
            createOvalWater(20, 10, 120, 85, -3.8, -0.5);
        }

        // 4. Island Green
        else if (template === 'island') {
            let cx = 0, cy = 60, innerR = 32, outerR = 125;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let d = Math.hypot(x - cx, y - cy);
                if (d < innerR) {
                    pos.setZ(i, 1.2 * Math.cos(d / innerR * Math.PI / 4));
                } else if (d < outerR) {
                    let frac = (d - innerR) / (outerR - innerR);
                    let dip = -4.0 * Math.sin(frac * Math.PI);
                    pos.setZ(i, dip);
                }
            }
            addWaterBody((wx, wy) => {
                let d = Math.hypot(wx - cx, wy - cy);
                return d > innerR * 0.95 && d < outerR * 0.95;
            }, -0.5);

            let waterColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.waterColor) || '#38bdf8';
            let greenColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.greenColor) || '#8acf72';
            let bunkerColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.bunkerColor) || '#e0d8a4';
            drawCanvasFeature(cx, cy, outerR, outerR, waterColor);
            drawCanvasFeature(cx, cy, innerR * 1.15, innerR * 1.15, bunkerColor);
            drawCanvasFeature(cx, cy, innerR, innerR, greenColor);
        }

        // 5. Winding Creek
        else if (template === 'creek' || template === 'oasis_creek') {
            let riverFunc = (y) => 40 * Math.sin(y * 0.015) + 15 * Math.cos(y * 0.04);
            let riverW = 20;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let rx = riverFunc(y);
                let dist = Math.abs(x - rx);
                if (dist < riverW) {
                    let dip = -3.2 * Math.cos((dist / riverW) * Math.PI / 2);
                    pos.setZ(i, dip);
                }
            }
            addWaterBody((wx, wy) => {
                return Math.abs(wx - riverFunc(wy)) < riverW * 0.85;
            }, -0.5);

            if (window.pCtx) {
                let waterColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.waterColor) || '#38bdf8';
                pCtx.strokeStyle = waterColor;
                pCtx.lineWidth = (riverW * 1.7 / half) * 2048;
                pCtx.lineCap = 'round';
                pCtx.beginPath();
                for (let y = -half; y <= half; y += 10) {
                    let rx = riverFunc(y);
                    let cx = 2048 + (rx / half) * 2048;
                    let cy = 2048 - (y / half) * 2048;
                    if (y === -half) pCtx.moveTo(cx, cy);
                    else pCtx.lineTo(cx, cy);
                }
                pCtx.stroke();
            }
        }

        // 6. Highland Cliff
        else if (template === 'highland') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let z = 0;
                if (y < -70) {
                    let frac = Math.min(1.0, (-70 - y) / 80);
                    z = 14.0 * frac * frac * (3 - 2 * frac) + Math.sin(x * 0.02) * 1.5;
                } else if (y > 60 && y < 240) {
                    let dist = Math.hypot(x - 80, y - 150);
                    if (dist < 100) z = 5.5 * Math.cos(dist / 100 * Math.PI / 2);
                }
                pos.setZ(i, z);
            }
        }

        // 7. Rolling Hills
        else if (template === 'hills') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let h = Math.sin(x * 0.025) * Math.cos(y * 0.022) * 4.5
                      + Math.sin((x + y) * 0.035) * 2.2
                      + Math.cos(x * 0.05) * 1.0;
                pos.setZ(i, h);
            }
        }

        // 8. Valley Pass
        else if (template === 'valley') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let ax = Math.abs(x);
                let h = 0;
                if (ax > 50) {
                    let frac = Math.min(1.0, (ax - 50) / 130);
                    h = 13.0 * frac * frac * (3 - 2 * frac) + Math.sin(y * 0.03) * 2.0;
                }
                pos.setZ(i, h);
            }
        }

        // 9. Coastal Links
        else if (template === 'coastal') {
            let dropX = 70;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let cliffEdge = dropX + Math.sin(y * 0.025) * 20;
                let z = 0;
                if (x > cliffEdge) {
                    let frac = Math.min(1.0, (x - cliffEdge) / 30);
                    z = -6.0 * frac;
                } else {
                    z = Math.sin(x * 0.02) * 2.0;
                }
                pos.setZ(i, z);
            }
            addWaterBody((wx, wy) => {
                let cliffEdge = dropX + Math.sin(wy * 0.025) * 20;
                return wx > (cliffEdge + 12);
            }, -0.5);

            if (window.pCtx) {
                let oceanColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.waterColor) || '#1e3a5f';
                pCtx.fillStyle = oceanColor;
                pCtx.fillRect(2048 + ((dropX + 15) / half) * 2048, 0, 2048, 4096);
            }
        }

        // 10. Twin Lakes
        else if (template === 'double_lake') {
            createOvalWater(-85, 45, 70, 55, -3.5, -0.5);
            createOvalWater(85, -25, 65, 50, -3.5, -0.5);
        }

        // 11. Elevated Plateau Green
        else if (template === 'plateau_green') {
            let gx = 0, gy = 110, pr = 50;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let d = Math.hypot(x - gx, y - gy);
                let z = 0;
                if (d < pr) {
                    let frac = d / pr;
                    if (frac < 0.65) z = 8.5;
                    else z = 8.5 * (1 - (frac - 0.65) / 0.35);
                }
                pos.setZ(i, z);
            }
            drawCanvasFeature(gx, gy, pr * 0.7, pr * 0.7, (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.greenColor) || '#8acf72');
        }

        // 12. Stadium Bowl Fairway
        else if (template === 'bowl_fairway') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let d = Math.hypot(x, y - 20);
                let z = 0;
                if (d > 60) {
                    let frac = Math.min(1.0, (d - 60) / 160);
                    z = 7.5 * frac * frac;
                } else {
                    z = -1.5 * (1 - d / 60);
                }
                pos.setZ(i, z);
            }
        }

        // 13. Peninsula Point
        else if (template === 'peninsula') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let z = 0;
                if (y > 10) {
                    let isPeninsula = (Math.abs(x) < 32 && y < 130);
                    if (!isPeninsula) {
                        let dFromPeninsula = Math.abs(x) - 32;
                        let frac = Math.min(1.0, Math.max(0, dFromPeninsula) / 25);
                        z = -4.0 * frac;
                    } else {
                        z = 0.5;
                    }
                }
                pos.setZ(i, z);
            }
            addWaterBody((wx, wy) => {
                let isPeninsula = (Math.abs(wx) < 36 && wy < 134);
                return wy > 15 && !isPeninsula;
            }, -0.5);

            let waterColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.waterColor) || '#38bdf8';
            drawCanvasFeature(0, 150, 260, 140, waterColor);
            drawCanvasFeature(0, 70, 34, 65, (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.fairwayColor) || '#79b84f');
        }

        // 14. Ridge Spine Runner
        else if (template === 'ridge_runner') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let ax = Math.abs(x);
                let z = 0;
                if (ax < 35) {
                    z = 5.0 * Math.cos((ax / 35) * Math.PI / 2);
                } else {
                    z = -2.5 * Math.sin(Math.min(1.0, (ax - 35) / 60) * Math.PI / 2);
                }
                pos.setZ(i, z);
            }
        }

        // 15. Tiered Terraces / Cascade
        else if (template === 'cascade') {
            for (let i = 0; i < pos.count; i++) {
                let y = pos.getY(i);
                let z = 0;
                if (y < -60) z = 0;
                else if (y < 40) {
                    let frac = Math.min(1.0, (y + 60) / 20);
                    z = 4.5 * frac;
                } else {
                    let frac = Math.min(1.0, (y - 40) / 20);
                    z = 4.5 + 4.5 * frac;
                }
                pos.setZ(i, z);
            }
        }

        // ═══ DESERT TEMPLATES ═══
        
        // 16. Desert Oasis
        else if (template === 'oasis') {
            let greenColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.greenColor) || '#4ade80';
            drawCanvasFeature(0, 30, 95, 75, greenColor);
            createOvalWater(0, 30, 75, 55, -3.8, -0.5);
        }

        // 17. Dune Waves
        else if (template === 'dunes') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let wave = Math.sin(x * 0.02 + y * 0.015);
                let z = (wave > 0 ? Math.pow(wave, 0.7) : -Math.pow(-wave, 1.4)) * 6.0 
                      + Math.cos(x * 0.04 - y * 0.02) * 2.0;
                pos.setZ(i, z);
            }
        }

        // 18. Red Canyon Pass
        else if (template === 'canyon') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let ax = Math.abs(x);
                let z = 0;
                if (ax > 45) {
                    let frac = Math.min(1.0, (ax - 45) / 110);
                    let wall = 16.0 * Math.pow(frac, 0.5);
                    wall += Math.sin(y * 0.1) * 1.5 + Math.cos(ax * 0.08) * 1.0;
                    z = wall;
                }
                pos.setZ(i, z);
            }
        }

        // 19. The Great Mesa
        else if (template === 'mesa') {
            let mx = 0, my = 15, mw = 85, ml = 110;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let dx = Math.abs(x - mx) / mw;
                let dy = Math.abs(y - my) / ml;
                let d = Math.max(dx, dy);
                let z = 0;
                if (d < 0.8) {
                    z = 12.0;
                } else if (d < 1.0) {
                    let frac = (1.0 - d) / 0.2;
                    z = 12.0 * frac * frac;
                }
                pos.setZ(i, z);
            }
        }

        // 20. Cactus Basin
        else if (template === 'cactus_valley') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let d = Math.hypot(x, y);
                let z = -4.0 * Math.cos(Math.min(1.0, d / 120) * Math.PI / 2)
                      + (d > 130 ? (d - 130) * 0.08 : 0);
                pos.setZ(i, z);
            }
        }

        // 21. Sunken Arroyo
        else if (template === 'arroyo') {
            let arroyoX = (y) => 25 * Math.sin(y * 0.02) - 10;
            let w = 24;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let dist = Math.abs(x - arroyoX(y));
                if (dist < w) {
                    let dip = -4.5 * Math.cos((dist / w) * Math.PI / 2);
                    pos.setZ(i, dip);
                }
            }
            if (window.pCtx) {
                let sandColor = (window.CURRENT_BIOME_CONFIG && window.CURRENT_BIOME_CONFIG.bunkerColor) || '#fde047';
                pCtx.strokeStyle = sandColor;
                pCtx.lineWidth = (w * 1.8 / half) * 2048;
                pCtx.lineCap = 'round';
                pCtx.beginPath();
                for (let y = -half; y <= half; y += 15) {
                    let cx = 2048 + (arroyoX(y) / half) * 2048;
                    let cy = 2048 - (y / half) * 2048;
                    if (y === -half) pCtx.moveTo(cx, cy);
                    else pCtx.lineTo(cx, cy);
                }
                pCtx.stroke();
            }
        }

        // 22. Twin Butte Gateway
        else if (template === 'twin_buttes') {
            let b1 = { x: -95, y: 35, r: 40, h: 15 };
            let b2 = { x: 95, y: 35, r: 40, h: 15 };
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let z = 0;
                for (let b of [b1, b2]) {
                    let d = Math.hypot(x - b.x, y - b.y);
                    if (d < b.r) {
                        let frac = d / b.r;
                        if (frac < 0.55) z += b.h;
                        else z += b.h * Math.cos((frac - 0.55) / 0.45 * Math.PI / 2);
                    }
                }
                pos.setZ(i, z);
            }
        }

        // 23. Dune Ridge Carry
        else if (template === 'dune_ridge') {
            let ridgeY = -10;
            for (let i = 0; i < pos.count; i++) {
                let y = pos.getY(i);
                let dy = Math.abs(y - ridgeY);
                let z = 0;
                if (dy < 45) {
                    z = 9.5 * Math.cos((dy / 45) * Math.PI / 2);
                }
                pos.setZ(i, z);
            }
        }

        // 24. Desert Meteor Basin
        else if (template === 'desert_crater') {
            let cx = 10, cy = 40, r = 70;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let d = Math.hypot(x - cx, y - cy);
                let z = 0;
                if (d < r) {
                    let frac = d / r;
                    let bowl = -5.5 * (1 - frac * frac);
                    let rim = (frac > 0.7) ? 2.5 * Math.sin((frac - 0.7) / 0.3 * Math.PI) : 0;
                    z = bowl + rim;
                }
                pos.setZ(i, z);
            }
        }

        // 25. Salt Flats
        else if (template === 'salt_flats') {
            if (window.pCtx) {
                pCtx.fillStyle = '#f8fafc';
                pCtx.beginPath();
                pCtx.ellipse(2048, 2048, 1400, 1100, 0, 0, Math.PI * 2);
                pCtx.fill();
            }
        }

        // 26. Horseshoe Canyon
        else if (template === 'horseshoe_canyon') {
            let cx = 0, cy = 90, r = 85;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let d = Math.hypot(x - cx, y - cy);
                let z = 0;
                if (y > 20 && Math.abs(d - r) < 35) {
                    let frac = Math.abs(d - r) / 35;
                    z = 15.0 * Math.cos(frac * Math.PI / 2);
                }
                pos.setZ(i, z);
            }
        }

        // ═══ MOON TEMPLATES ═══
        
        // 27. Impact Basin
        else if (template === 'impact_basin') {
            let craters = [{ cx: 10, cy: 30, r: 85, depth: 6.5, rim: 3.0 }];
            applyCraters(craters);
        }

        // 28. Triple Craters
        else if (template === 'triple_craters') {
            let craters = [
                { cx: -65, cy: 60, r: 50, depth: 4.8, rim: 2.2 },
                { cx: 70, cy: 30, r: 55, depth: 5.2, rim: 2.4 },
                { cx: 10, cy: -80, r: 42, depth: 4.0, rim: 1.8 }
            ];
            applyCraters(craters);
        }

        // 29. Lunar Ridge
        else if (template === 'lunar_ridge') {
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let z = 0;
                if (y > 40) {
                    let frac = Math.min(1.0, (y - 40) / 100);
                    z = 18.0 * frac + Math.sin(x * 0.05) * 3.5 + Math.cos(y * 0.08) * 2.0;
                }
                pos.setZ(i, z);
            }
        }

        // 30. Lunar Rille
        else if (template === 'lunar_rille') {
            let rilleX = (y) => 20 * Math.sin(y * 0.02) + 10;
            let w = 22;
            for (let i = 0; i < pos.count; i++) {
                let x = pos.getX(i), y = pos.getY(i);
                let dist = Math.abs(x - rilleX(y));
                if (dist < w) {
                    let dip = -6.5 * Math.cos((dist / w) * Math.PI / 2);
                    pos.setZ(i, dip);
                }
            }
        }

        // 31. Double Crater
        else if (template === 'double_crater') {
            let craters = [
                { cx: -40, cy: 40, r: 60, depth: 5.0, rim: 2.2 },
                { cx: 35, cy: 50, r: 55, depth: 4.8, rim: 2.0 }
            ];
            applyCraters(craters);
        }

        // 3. Sync 3D Heightmap Normals and Chunks
        pos.needsUpdate = true;
        planeGeo.computeVertexNormals();
        if (window._terrainChunks) window._terrainChunks.syncAll();

        // 4. Sync Water mesh & Alpha mask
        if (window.syncWaterVisual) window.syncWaterVisual();
        if (typeof window.rebuildWaterMask === 'function') window.rebuildWaterMask();

        // 5. Update ground textures
        if (window.mapTex) window.mapTex.needsUpdate = true;
        if (window.waterTex) window.waterTex.needsUpdate = true;
        if (window.pCtx) window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;

        // 6. Save level so builder opens with active state
        saveLevel();
    };

    // Saves are held back while the course is read (see arcade-save.js). A new course asks for its first save once the page is set up.
    async function loadLevel() {
        window._courseLoading = true;
        const startsNew = new URLSearchParams(window.location.search).get('autorun') === 'new_build';
        try {
            await loadLevelBody();
        } finally {
            window._courseLoading = false;
        }
        if (startsNew && typeof saveLevel === 'function') saveLevel(true, true);
    }

    async function loadLevelBody() {
        let params = new URLSearchParams(window.location.search);
        let courseCode = params.get('course');
        let editCode = params.get('edit');
        let autoRun = params.get('autorun');
        let collectionId = params.get('collection');
        let plateIndex = parseInt(params.get('plate') || '0');
        
        let savedStr = null;
        let isCloud = false;
        
        if (autoRun === 'new_build') {
            if (typeof executeClear === 'function') executeClear();
            else ArcadeStorage.removeCustomLevel();
            
            let template = params.get('template_id') || params.get('template') || 'blank';
            let biome = params.get('biome') || 'GLOBAL';
            let season = params.get('season');
            if (season && season !== 'undefined') {
                biome = season;
            }
            
            // Range mode initialization (keep standard tools active)
            if (params.get('mode') === 'range') {
                window._isRangeMode = true;
                // Auto-select Range Tee as default tool
                setTimeout(() => {
                    if (typeof setTool === 'function') setTool('HOLE');
                    if (typeof setHoleItem === 'function') setHoleItem('TEE_RANGE');
                }, 500);
            }
            
            if (typeof window.applyStarterTemplate === 'function') {
                await window.applyStarterTemplate(template, biome);
            }
            
            if (biome && typeof window.changeBiome === 'function') {
                window.changeBiome(biome);
            }
            
            // a mood from the new-course page also decides what meets the eye on each side of the plate
            const mood = params.get('mood');
            // N is the far horizon, the other three sides share one colour
            const MOOD_EDGES = {
                forest:   { N: 'horizonColor', rest: 'fescueColor' },   // not all start values, so the guide still sees the surroundings as done after a reload
                sea:      { N: 'horizonColor', rest: 'oceanColor' },
                mountain: { N: 'horizonColor', rest: 'horizonColor' },
                desert:   { N: 'horizonColor', rest: 'wasteColor' }
            };
            if (mood && Object.prototype.hasOwnProperty.call(MOOD_EDGES, mood) && typeof window.updateSurroundColors === 'function') {
                ['N', 'E', 'S', 'W'].forEach(function (side) {
                    const sel = document.getElementById('surr-' + side);
                    if (sel) sel.value = side === 'N' ? MOOD_EDGES[mood].N : MOOD_EDGES[mood].rest;
                });
                window._surroundTouched = true;   // the next-step guide counts the surroundings as started
                window.updateSurroundColors();
            }
            
            setMode('BUILD');
            try {
                let u = new URL(window.location.href);
                if (u.searchParams.get('autorun') === 'new_build') {
                    u.searchParams.set('autorun', 'edit_build');
                    window.history.replaceState({}, '', u.toString());
                }
            } catch(e) {}
            setTimeout(() => {
                let loader = document.getElementById('global-loader');
                if (loader) loader.classList.add('hidden');
            }, 800);
            return;
        }

        // Check for offline shared course in URL hash
        if (window.location.hash && window.location.hash.startsWith('#share=')) {
            let imported = importCourseHash();
            if (imported) {
                savedStr = imported;
                isCloud = false;
                console.log('Loaded shared course from URL hash!');
            }
        }

        let targetCode = courseCode || editCode;

        if (targetCode) {
            try {
                let data = await ArcadeAPI.loadCourse(targetCode);
                if(data.share_code) {
                    savedStr = data;
                    isCloud = true;
                    // Store course metadata for Round Setup header
                    window._loadedUpdatedAt = String(data.updated_at || data.created_at || 'none'); // which saved revision this page shows
                    window._loadedOwnerId = data.owner_id || null;
                    window._loadedCanEdit = data.can_edit === true;
                    window._loadedShareCode = data.share_code;
                    // a course somebody else built is played, not edited: the builder link sends everyone but the owner to the round
                    if (editCode && (autoRun === 'edit_build' || autoRun === 'build') && data.owner_id && !window.canEditLoadedCourse()) {
                        window.location.replace('arcade.html?v=' + Date.now() + '&autorun=setup&course=' + data.share_code);
                        return;
                    }
                    window._loadedIsDraft = data.is_draft === true; // an unpublished draft is a builder preview: its rounds never count
                    window._loadedCourseName = data.name || null;
                    window._loadedCourseAuthor = data.author || null;
                    window._loadedCourseHoles = data.hole_count || null;
                    window._loadedCoursePar = data.total_par || null;
                    window._loadedCourseStrokeIndex = data.stroke_index || null;
                    window._loadedCourseCR = data.course_rating || null;
                    window._loadedCourseSR = data.slope_rating || null;
                    // Collection support: load collection metadata
                    if (collectionId) {
                        try {
                            let colRes = await ArcadeAPI.getCollection(collectionId);
                            if (colRes && colRes.plates) {
                                window._activeCollection = colRes;
                                window._activePlateIndex = plateIndex;
                                // Plate 1 is where a collection round starts, whichever page it was started from (build.html, courses.html, a link): what an
                                // earlier, abandoned go left behind (scores, round token, players) must not carry into this one
                                if (plateIndex === 0) {
                                    try { ['collection_scores_', 'collection_round_', 'collection_roster_', 'collection_plates_'].forEach(function (k) { sessionStorage.removeItem(k + collectionId); }); } catch (e) {}
                                    // the plates in the order they were when the round started: the collection can be edited meanwhile (another tab, another device)
                                    try { sessionStorage.setItem('collection_plates_' + collectionId, JSON.stringify(colRes.plates.map(function (p) { return typeof p === 'string' ? { plate_code: p } : { plate_code: p.plate_code, plate_name: p.plate_name }; }))); } catch (e) {}
                                } else {
                                    // Plate 2 and on follow the order the round started with, as long as this plate is in it (else the collection as it is now)
                                    try {
                                        let frozen = JSON.parse(sessionStorage.getItem('collection_plates_' + collectionId) || 'null');
                                        if (Array.isArray(frozen) && frozen.length > plateIndex && frozen[plateIndex] && String(frozen[plateIndex].plate_code).toUpperCase() === String(courseCode).toUpperCase()) colRes.plates = frozen;
                                    } catch (e) {}
                                }
                                window._collectionScores = JSON.parse(sessionStorage.getItem('collection_scores_' + collectionId) || '[]');
                                // Override displayed hole numbers based on plate position
                                window._holeNumberOffset = plateIndex * MAX_HOLES;
                                // Plate 2 and on: the players of the round come along (the page started over with one player)
                                try {
                                    let roster = JSON.parse(sessionStorage.getItem('collection_roster_' + collectionId) || 'null');
                                    if (plateIndex > 0 && Array.isArray(roster) && roster.length > 0 && Array.isArray(window.setupPlayers)) {
                                        window.setupPlayers = roster.slice(0, 4).map(function (p) { return { name: p.name, tee: p.tee || 'yellow', hcp: p.hcp === undefined ? null : p.hcp, slot: p.slot }; });
                                    }
                                } catch (e) {}
                                console.log('📦 Collection loaded:', colRes.name, '| Plate', plateIndex + 1, '/', colRes.plates.length);
                            }
                        } catch(e) { console.warn('Collection load failed:', e); }
                    }
                    if (editCode) {
                        window._editIsPublished = data.is_draft !== true;
                        currentEditCode = data.share_code; 
                        if(document.getElementById('course-name-input')) document.getElementById('course-name-input').value = data.name;
                        if(document.getElementById('author-name-input')) document.getElementById('author-name-input').value = data.author;
                        // a published course is updated with Publish (a new version of it); only a draft is saved as a draft
                        if (document.getElementById('btn-save-draft')) document.getElementById('btn-save-draft').style.display = data.is_draft === true ? 'block' : 'none';
                        // the owner opens the builder with the builder's own definitions (greens, fairways, bunkers, tee boxes), not the played copy
                        if ((autoRun === 'edit_build' || autoRun === 'build') && data.builder_holes) savedStr.holes = data.builder_holes;
                    }
                    if(typeof savedStr.holes === 'string') savedStr.holes = JSON.parse(savedStr.holes);
                    if(typeof savedStr.targets === 'string') savedStr.targets = JSON.parse(savedStr.targets);
                    if(typeof savedStr.trees === 'string') savedStr.trees = JSON.parse(savedStr.trees);
                    if(typeof savedStr.theme_data === 'string') savedStr.theme_data = JSON.parse(savedStr.theme_data);
                } else {
                    console.error("Course not found!");
                }
            } catch(e) { console.error("Cloud fetch fail:", e); }
        }
        // === LOCAL BRIDGE: Builder saved full course to localStorage ===
        let localSource = params.get('source');
        if (localSource === 'local' && !savedStr) {
            // Try compressed format first (pako — handled by ArcadeStorage)
            let compressed = ArcadeStorage.loadCompressedLevel();
            if (compressed) {
                if (compressed._fullSave) {
                    savedStr = compressed;
                    isCloud = true; // So terrain heightmap gets loaded
                } else {
                    savedStr = compressed;
                }
            }
            // Fallback: uncompressed key
            if (!savedStr) {
                let parsed = ArcadeStorage.loadCustomLevel();
                if (parsed) {
                    if (parsed._fullSave) {
                        savedStr = parsed;
                        isCloud = true;
                        console.log('✅ Loaded course from builder (uncompressed)');
                    } else {
                        savedStr = parsed;
                    }
                }
            }
        }
        
        if (!isCloud && !savedStr) {
            // Check IndexedDB full course draft first (heightmap, water, painted textures, objects)
            if (window.ArcadeStorage && window.ArcadeStorage.loadFullDraft) {
                try {
                    let fullDraft = await window.ArcadeStorage.loadFullDraft('quick_draft');
                    if (fullDraft && fullDraft._fullSave) {
                        savedStr = fullDraft;
                        isCloud = true; // Triggers full terrain, water & biomemap reconstruction below
                        // the working copy remembers which saved course it belongs to, so Publish / Save draft update that one instead of making a copy
                        // the course name and author the builder had typed in
                        let nameEl = document.getElementById('course-name-input'), authorEl = document.getElementById('author-name-input');
                        if (nameEl && fullDraft.name && fullDraft.name !== 'Quick Draft') nameEl.value = fullDraft.name;
                        if (authorEl && fullDraft.author) authorEl.value = fullDraft.author;
                        if (fullDraft.edit_code && !editCode && !courseCode) {
                            currentEditCode = fullDraft.edit_code;
                            window._editIsPublished = !!fullDraft.edit_is_published;
                            if (document.getElementById('btn-save-draft')) document.getElementById('btn-save-draft').style.display = window._editIsPublished ? 'none' : 'block';
                        }
                        console.log('✅ Loaded FULL course draft from IndexedDB (terrain + textures + objects)');
                    }
                } catch(e) {
                    console.warn('IndexedDB draft load failed:', e);
                }
            }
            if (!savedStr) {
                let ls = ArcadeStorage.loadCustomLevel();
                if(ls) savedStr = ls;
            }
        }

        if(savedStr) {
            targets.forEach(t => scene.remove(t.mesh));
            targets.length = 0;
            
            for(let i=0; i<MAX_HOLES; i++) {
                let h = courseHoles[i];
                for(let key in h.tees) {
                    if(h.teeMeshes[key]) { scene.remove(h.teeMeshes[key]); h.teeMeshes[key]=null; }
                }
                if(h.flagMesh) { scene.remove(h.flagMesh); h.flagMesh=null; }
                if(h.aimMesh) { scene.remove(h.aimMesh); h.aimMesh=null; }
                h.teeManualColors=undefined; h.tees={red:null,yellow:null,white:null,black:null,range:null}; h.flag=null; h.aimPoint=null; h.greenData=null; h.fairwayData=null; h.fairways=[]; h.activeFairwayIndex=null; h.bunkerData=null; h.bunkers=[]; h.activeBunkerIndex=null; h.teeData=null; h.teeBoxes=[]; h.activeTeeBoxIndex=null; h.pins={};
            }
            window._allFlagCloths = [];  // Clear wave animation references
            
            try {
                var arr = savedStr;
                
                // Ladda tema och färger
                if (arr.theme_data && typeof arr.theme_data === 'object' && Object.keys(arr.theme_data).length > 0) {
                    let td = arr.theme_data;
                    if (td.config) {
                        window.CURRENT_BIOME_CONFIG = td.config;
                        if(td.biomeId) {
                            window.ACTIVE_BIOME = td.biomeId;
                            if (typeof window.refreshSunLight === 'function') window.refreshSunLight();
                            let select = document.getElementById('biome-select');
                            if(select) select.value = td.biomeId;
                        }
                        
                        if (td.enableOrganicNoise !== undefined) {
                            window.ENABLE_ORGANIC_NOISE = !!td.enableOrganicNoise;
                            let hdCb = document.getElementById('hd-checkbox');
                            if (hdCb) hdCb.checked = window.ENABLE_ORGANIC_NOISE;
                            window.lastRecolorHadNoise = window.ENABLE_ORGANIC_NOISE;
                        } else {
                            window.ENABLE_ORGANIC_NOISE = false;
                            let hdCb = document.getElementById('hd-checkbox');
                            if (hdCb) hdCb.checked = false;
                            window.lastRecolorHadNoise = false;
                        }
                        
                        // Uppdatera sky och vatten
                        if (typeof scene !== 'undefined' && scene) {
                            scene.background = new THREE.Color(window.CURRENT_BIOME_CONFIG.skyColor);
                            if (scene.fog) scene.fog.color.setHex(parseInt(window.CURRENT_BIOME_CONFIG.skyColor.replace('#','0x')));
                        }
                        if (typeof window.waterMat !== 'undefined' && window.waterMat) {
                            window.waterMat.color.setHex(parseInt(window.CURRENT_BIOME_CONFIG.waterColor.replace('#','0x')));
                        }
                        
                        // Uppdatera material palettens UI
                        let keys = ['ob', 'bunker', 'waste', 'tee', 'green', 'foregreen', 'fairway', 'semi', 'rough', 'fescue'];
                        keys.forEach(k => {
                            let el = document.getElementById('pal-' + k);
                            if(el) {
                                el.style.background = window.CURRENT_BIOME_CONFIG[k + 'Color'];
                            }
                        });
                        
                        // Toggle gear icons
                        let gearIcons = document.querySelectorAll('.color-edit-icon');
                        let isCustom = (window.ACTIVE_BIOME === 'CUSTOM');
                        gearIcons.forEach(icon => {
                            icon.style.display = isCustom ? 'inline-block' : 'none';
                        });
                        
                        if(isCustom) {
                            window.CLOUD_BIOMES['CUSTOM'] = Object.assign({}, window.CURRENT_BIOME_CONFIG);
                        }
                        
                        // Uppdatera även 4-riktningars horisontfärger så de matchar nya biomet
                        if (window.updateSurroundColors) {
                            window.updateSurroundColors();
                        }
                    }
                }

                // === PARTICLE ENGINE: Restore intensity & activate biome ===
                if (arr.theme_data && window.ParticleEngine) {
                    if (typeof arr.theme_data.particleIntensity === 'number') {
                        window.ParticleEngine.setIntensity(arr.theme_data.particleIntensity);
                    }
                    if (typeof arr.theme_data.particleSize === 'number') {
                        window.ParticleEngine.setSize(arr.theme_data.particleSize);
                    }
                    if (arr.theme_data.biomeId) {
                        window.ParticleEngine.activateBiome(arr.theme_data.biomeId);
                    }
                    if (arr.theme_data.weatherMode) {
                        window.ParticleEngine.setWeather(arr.theme_data.weatherMode);
                    }
                }

                if (arr.targets && Array.isArray(arr.targets)) {
                    arr.targets.forEach(function(a) {
                        if(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)) {
                            createTargetAbsolute(a.x, a.y, a.z, a.c);
                        }
                    });
                }
                
                if (arr.holes && Array.isArray(arr.holes)) {
                    for(let i=0; i<MAX_HOLES && i<arr.holes.length; i++) {
                        let hSync = arr.holes[i];
                        let h = courseHoles[i];
                        h.par = hSync.par || 4;
                        if(hSync.panorama) h.panorama = hSync.panorama;
                        if(hSync.surrounding) h.surrounding = hSync.surrounding;
                        if(hSync.surroundConfig) h.surroundConfig = hSync.surroundConfig;   // the four edges of the plate (restoreSurrounding reads them from the holes)
                        if(hSync.tee) { h.tees.yellow = {x: hSync.tee.x, y: hSync.tee.y, z: hSync.tee.z}; }
                        if(hSync.tees) {
                            for(let tType in hSync.tees) {
                                if(hSync.tees[tType]) h.tees[tType] = hSync.tees[tType];
                            }
                        }
                        if(h.tees.red) { h.teeMeshes.red = createTeeObject(h.tees.red.x, h.tees.red.y, h.tees.red.z, 0xef4444); if(h.tees.red.rot) h.teeMeshes.red.rotation.y = h.tees.red.rot; }
                        if(h.tees.yellow) { h.teeMeshes.yellow = createTeeObject(h.tees.yellow.x, h.tees.yellow.y, h.tees.yellow.z, 0xfacc15); if(h.tees.yellow.rot) h.teeMeshes.yellow.rotation.y = h.tees.yellow.rot; }
                        if(h.tees.white) { h.teeMeshes.white = createTeeObject(h.tees.white.x, h.tees.white.y, h.tees.white.z, 0xffffff); if(h.tees.white.rot) h.teeMeshes.white.rotation.y = h.tees.white.rot; }
                        if(h.tees.black) { h.teeMeshes.black = createTeeObject(h.tees.black.x, h.tees.black.y, h.tees.black.z, 0x111111); if(h.tees.black.rot) h.teeMeshes.black.rotation.y = h.tees.black.rot; }
                        if(h.tees.range) { h.teeMeshes.range = createRangeTeeObject(h.tees.range.x, h.tees.range.y, h.tees.range.z); if(h.tees.range.rot) h.teeMeshes.range.rotation.y = h.tees.range.rot; }
                        
                        if(hSync.flag) {
                            h.flag = hSync.flag;
                            h.flagMesh = createFlagObject(h.flag.x, h.flag.y, h.flag.z);
                        }
                        h.plannedGreen = hSync.plannedGreen ? { x: hSync.plannedGreen.x, z: hSync.plannedGreen.z, r: hSync.plannedGreen.r } : null;
                        if(hSync.aimPoint) {
                            h.aimPoint = { x: hSync.aimPoint.x, y: hSync.aimPoint.y, z: hSync.aimPoint.z };
                            h.aimMesh = createAimPointMarker(h.aimPoint.x, h.aimPoint.y, h.aimPoint.z, i + 1);
                        }
                        if(hSync.greenData) {
                            h.greenData = hSync.greenData;
                            if (h.greenData.origHeights && Array.isArray(h.greenData.origHeights)) {
                                h.greenData.origHeights = new Float32Array(h.greenData.origHeights);
                            }
                        }
                        if(hSync.fairways && Array.isArray(hSync.fairways) && hSync.fairways.length > 0) {
                            h.fairways = hSync.fairways.map(fd => {
                                if (fd.origHeights && Array.isArray(fd.origHeights)) {
                                    fd.origHeights = new Float32Array(fd.origHeights);
                                }
                                if (typeof window.syncFairwaySculptFlag === 'function') window.syncFairwaySculptFlag(fd);
                                return fd;
                            });
                            h.activeFairwayIndex = 0;
                            h.fairwayData = h.fairways[0];
                        } else if(hSync.fairwayData) {
                            h.fairwayData = hSync.fairwayData;
                            if (h.fairwayData.origHeights && Array.isArray(h.fairwayData.origHeights)) {
                                h.fairwayData.origHeights = new Float32Array(h.fairwayData.origHeights);
                            }
                            if (typeof window.syncFairwaySculptFlag === 'function') window.syncFairwaySculptFlag(h.fairwayData);
                            h.fairways = [h.fairwayData];
                            h.activeFairwayIndex = 0;
                        } else {
                            h.fairways = [];
                            h.activeFairwayIndex = null;
                            h.fairwayData = null;
                        }
                        if(hSync.bunkers && Array.isArray(hSync.bunkers) && hSync.bunkers.length > 0) {
                            h.bunkers = hSync.bunkers.map(bd => {
                                if (bd.origHeights && Array.isArray(bd.origHeights)) {
                                    bd.origHeights = new Float32Array(bd.origHeights);
                                }
                                return bd;
                            });
                            h.activeBunkerIndex = 0;
                            h.bunkerData = h.bunkers[0];
                        } else if(hSync.bunkerData) {
                            h.bunkerData = hSync.bunkerData;
                            if (h.bunkerData.origHeights && Array.isArray(h.bunkerData.origHeights)) {
                                h.bunkerData.origHeights = new Float32Array(h.bunkerData.origHeights);
                            }
                            h.bunkers = [h.bunkerData];
                            h.activeBunkerIndex = 0;
                        } else {
                            h.bunkers = [];
                            h.activeBunkerIndex = null;
                            h.bunkerData = null;
                        }
                        h.teeManualColors = hSync.teeManualColors; // absent in legacy saves -> stays undefined (manual)
                        if(hSync.teeBoxes && Array.isArray(hSync.teeBoxes) && hSync.teeBoxes.length > 0) {
                            h.teeBoxes = hSync.teeBoxes.map(tb => {
                                if (tb.origHeights && Array.isArray(tb.origHeights)) {
                                    tb.origHeights = new Float32Array(tb.origHeights);
                                }
                                return tb;
                            });
                            h.activeTeeBoxIndex = 0;
                            h.teeData = h.teeBoxes[0];
                        } else if(hSync.teeData) {
                            h.teeData = hSync.teeData;
                            if (h.teeData.origHeights && Array.isArray(h.teeData.origHeights)) {
                                h.teeData.origHeights = new Float32Array(h.teeData.origHeights);
                            }
                            h.teeBoxes = [h.teeData];
                            h.activeTeeBoxIndex = 0;
                        } else {
                            h.teeBoxes = [];
                            h.activeTeeBoxIndex = null;
                            h.teeData = null;
                        }
                        // path objects are rebuilt after the terrain below has been applied (hedges follow the ground)
                        setTimeout(() => window.restoreEnvObjects(h, hSync.envObjects), 0);
                    }
                    if(document.getElementById('hole-ui-par')) { document.getElementById('hole-ui-par').innerText = "Par " + courseHoles[currentHoleIndex].par; }
                }

                if (isCloud && arr.terrain_heightmap) {
                    let mapData = (typeof arr.terrain_heightmap === 'string') ? JSON.parse(arr.terrain_heightmap) : arr.terrain_heightmap;
                    let pos = planeGeo.attributes.position;
                    // RESET water data to -99 BEFORE loading — prevents ghost water in bunkers
                    if (window.waterData) {
                        window.waterData.fill(-99);
                        window.waterBaseZ.fill(-99);
                    }
                    // Clear water mask to black (no water visible)
                    if (typeof wCtx !== 'undefined') {
                        wCtx.fillStyle = '#000000';
                        wCtx.fillRect(0, 0, 4096, 4096);
                        if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
                    }
                    
                    let groundArr = Array.isArray(mapData) ? mapData : mapData.ground;
                    let waterArr = Array.isArray(mapData) ? null : mapData.water;

                    if(groundArr) {
                        // Detect saved segment count: use explicit segs if available, fallback to √(length)-1
                        let savedSegs = mapData.segs || Math.round(Math.sqrt(groundArr.length) - 1);
                        let heightData = groundArr;
                        if (savedSegs !== TERRAIN_SEGS && savedSegs > 0) {
                            console.warn('[TERRAIN] Cloud resample:', savedSegs, '→', TERRAIN_SEGS);
                            heightData = _resampleHeightmap(groundArr, savedSegs, TERRAIN_SEGS);
                        }
                        let vertCount = (TERRAIN_SEGS + 1) * (TERRAIN_SEGS + 1);
                        for(let i=0; i<vertCount && i<heightData.length; i++) pos.setZ(i, heightData[i]);

                    }
                    if(waterArr && window.waterData) {
                        for(let i=0; i<waterArr.length && i<window.waterData.length; i++) {
                            window.waterData[i] = waterArr[i];
                            window.waterBaseZ[i] = waterArr[i];
                        }
                    }

                    pos.needsUpdate = true;
                    if (window.syncWaterVisual) window.syncWaterVisual();
                    planeGeo.computeVertexNormals();
                    if (window._terrainChunks) window._terrainChunks.syncAll();

                    // Rebuild water alpha mask from loaded heightmap
                    if (waterArr && waterArr.some(v => v > -90)) {
                        rebuildWaterMask();
                    }
                    
                    // Restore water table level and water type
                    if (mapData.waterTableLevel != null) {
                        window.waterTableLevel = mapData.waterTableLevel;
                        let slider = document.getElementById('water-table-slider');
                        let val = document.getElementById('water-table-val');
                        if (slider) slider.value = mapData.waterTableLevel;
                        if (val) val.textContent = parseFloat(mapData.waterTableLevel).toFixed(1) + 'm';
                    }
                    if (mapData.waterType) {
                        setTimeout(() => { if (window.setWaterType) window.setWaterType(mapData.waterType); }, 100);
                    }

                    // Restore terrain grid LOD setting
                    if (mapData.terrainGrid && window._terrainChunks) {
                        window._terrainGridSegs = mapData.terrainGrid;
                        window._terrainChunks.updateLOD(mapData.terrainGrid);
                        let tSlider = document.getElementById('terrain-res-slider');
                        let tVal = document.getElementById('terrain-res-val');
                        if (tSlider) tSlider.value = mapData.terrainGrid;
                        if (tVal) tVal.textContent = mapData.terrainGrid + 'x' + mapData.terrainGrid;
                    }

                    if(arr.terrain_biomemap) {
                        let img = new Image();
                        img.onload = () => {
                            pCtx.drawImage(img, 0, 0);
                            if(typeof mapTex !== 'undefined') mapTex.needsUpdate = true;
                            // Fix loading race condition: update biome data and rebuild rough mask once loaded
                            window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
                            if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
                            if (window._terrainShells) window._terrainShells.refresh();
                        };
                        img.src = arr.terrain_biomemap;
                    }
                    
                    if(arr.terrain_watermask) {
                        let wImg = new Image();
                        wImg.onload = () => {
                            if (typeof wCtx !== 'undefined') wCtx.drawImage(wImg, 0, 0);
                            if (typeof waterTex !== 'undefined') waterTex.needsUpdate = true;
                        };
                        wImg.src = arr.terrain_watermask;
                    }

                    if(arr.trees && Array.isArray(arr.trees)) {
                        let uniqueTypes = new Set();
                        arr.trees.forEach(t => {
                            createTree(t.type || t.t, t.x, t.z, t.s, t.r, t.c, t.tc, t.yOffset || 0, t.brightness !== undefined ? t.brightness : 1.0, true, t.tilt, t.roll);
                            uniqueTypes.add(t.type || t.t);
                        });
                        uniqueTypes.forEach(type => {
                            if (typeof window.rebuildInstancePool === 'function') window.rebuildInstancePool(type);
                        });
                    }
                    
                    // Restore panorama and surrounding for current hole
                    if(typeof window.restorePanorama === 'function') window.restorePanorama();
                    if(typeof window.restoreSurrounding === 'function') window.restoreSurrounding();
                    
                    // Snap all objects (flags, tees, trees) to updated terrain
                    // Fixes flags/gimme rings buried under terrain after sculpting
                    setTimeout(() => { snapObjectsToGround(); }, 100);
                }
            } catch(e) {
                console.error("Parse error", e);
            }
        }
        
        if (autoRun === 'setup') {
            setMode('PLAY');
            if (typeof startRound === 'function') setTimeout(startRound, 500);
        } else if (autoRun === 'edit_build' || autoRun === 'build') {
            setMode('BUILD');
        } else if (courseCode || editCode) {
            let isRange = params.get('mode') === 'range';
            if (isRange) {
                window._isRangeMode = true;
                setMode('TEST');
            } else {
                setMode('PLAY');
                if (typeof startRound === 'function') setTimeout(startRound, 500);
            }
        } else if (!autoRun && !courseCode && !editCode) {
            setMode('BUILD');
        }
        
        setTimeout(() => {
            if (typeof pCtx !== 'undefined') window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
            if (typeof window.rebuildRoughMask === 'function') window.rebuildRoughMask();
            if (typeof window.updateTopbarHoleDistance === 'function') window.updateTopbarHoleDistance();
            if (typeof window.updateTerrainGridUniforms === 'function') window.updateTerrainGridUniforms();
            let loader = document.getElementById('global-loader');
            if (loader) loader.classList.add('hidden');
        }, 800);
    }
