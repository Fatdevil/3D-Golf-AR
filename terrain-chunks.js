// ================================================================
//  TERRAIN CHUNK MANAGER v2 — Per-chunk LOD with green detection
//
//  Master PlaneGeometry (invisible) = single source of truth.
//  ALL existing code reads/writes master as before.
//  Chunks render with per-chunk LOD: green chunks = full res,
//  non-green chunks = downsampled for mobile performance.
//
//  Skirt geometry hides cracks between different LOD levels.
//
//  Usage:
//    let mgr = new TerrainChunkManager(planeGeo, plane, scene, mat, 4, {
//        terrainGrid: 200   // non-green chunk resolution
//    });
//    mgr.setEnabled(true);
// ================================================================
(function() {
    'use strict';

    const SKIRT_DEPTH = 5.0; // Meters below edge to extend skirt

    class TerrainChunkManager {
        /**
         * @param {THREE.BufferGeometry} masterGeo
         * @param {THREE.Mesh} masterMesh - kept invisible for raycasting
         * @param {THREE.Scene} scene
         * @param {THREE.Material} material - shared terrain material
         * @param {number} gridSize - chunks per axis (4 = 4×4 = 16)
         * @param {object} [options]
         * @param {number} [options.terrainGrid] - non-green rendering segs (default = master segs)
         */
        constructor(masterGeo, masterMesh, scene, material, gridSize, options) {
            this.masterGeo = masterGeo;
            this.masterMesh = masterMesh;
            this.scene = scene;
            this.material = material;
            this.gridSize = gridSize || 4;
            this.chunks = [];
            this.enabled = false;

            options = options || {};
            this.greenGrid = window.TERRAIN_SEGS;
            this.terrainGrid = options.terrainGrid || this.greenGrid;

            this._buildChunks();
        }

        // ─────────────────────────────────────────────────────────────
        //  PUBLIC API
        // ─────────────────────────────────────────────────────────────

        /** Enable/disable chunk rendering */
        setEnabled(enabled) {
            this.enabled = enabled;
            for (let c of this.chunks) {
                if (enabled && !c.mesh.parent) this.scene.add(c.mesh);
                else if (!enabled && c.mesh.parent) this.scene.remove(c.mesh);
            }
            // Master mesh: invisible (no rendering) but still raycastable
            this.masterMesh.visible = !enabled;
            // Grid overlay shares master planeGeo — hide it too to avoid double-rendering
            if (window._gridPlane) window._gridPlane.visible = !enabled;
        }

        /** Full sync: positions + normals from master → all chunks */
        syncAll() {
            this.masterGeo.computeVertexNormals();
            let mPos = this.masterGeo.attributes.position.array;
            let mNorm = this.masterGeo.attributes.normal.array;
            let stride = window.TERRAIN_SEGS + 1;
            for (let c of this.chunks) {
                this._syncFull(c, mPos, mNorm, stride);
                c.dirty = false;
            }
        }

        /** Sync dirty chunks: positions + normals (after mouseup) */
        syncDirty() {
            let any = false;
            for (let c of this.chunks) if (c.dirty) { any = true; break; }
            if (!any) return;
            this.masterGeo.computeVertexNormals();
            let mPos = this.masterGeo.attributes.position.array;
            let mNorm = this.masterGeo.attributes.normal.array;
            let stride = window.TERRAIN_SEGS + 1;
            for (let c of this.chunks) {
                if (c.dirty) {
                    this._syncFull(c, mPos, mNorm, stride);
                    c.dirty = false;
                }
            }
        }

        /** Fast position-only sync (during sculpting, normals deferred) */
        syncDirtyPositions() {
            let mPos = this.masterGeo.attributes.position.array;
            let stride = window.TERRAIN_SEGS + 1;
            for (let c of this.chunks) {
                if (c.dirty) this._syncPositions(c, mPos, stride);
            }
        }

        /** Mark chunks intersecting world circle as dirty */
        markDirty(worldX, worldZ, radius) {
            let size = window.TERRAIN_SIZE;
            let segs = window.TERRAIN_SEGS;
            let half = size / 2;
            let step = size / segs;
            for (let c of this.chunks) {
                if (c.dirty) continue;
                let x0 = -half + c.gxStart * step;
                let x1 = -half + c.gxEnd * step;
                let z0 = -half + c.gzStart * step;
                let z1 = -half + c.gzEnd * step;
                let cx = Math.max(x0, Math.min(worldX, x1));
                let cz = Math.max(z0, Math.min(worldZ, z1));
                if ((worldX-cx)*(worldX-cx) + (worldZ-cz)*(worldZ-cz) <= radius*radius) {
                    c.dirty = true;
                }
            }
        }

        /** Mark all dirty */
        markAllDirty() {
            for (let c of this.chunks) c.dirty = true;
        }

        /** Change non-green chunk LOD (Terrain Grid slider) */
        updateLOD(terrainGrid) {
            terrainGrid = Math.min(terrainGrid, this.greenGrid);
            this.terrainGrid = terrainGrid;
            window._terrainGridSegs = terrainGrid;
            this._buildChunks();
            if (this.enabled) this.setEnabled(true);
        }

        /** Rebuild after master geometry replaced (terrain resize) */
        rebuild(newGeo, newMesh) {
            this.masterGeo = newGeo;
            if (newMesh) this.masterMesh = newMesh;
            this.greenGrid = window.TERRAIN_SEGS;
            this._buildChunks();
            if (this.enabled) this.setEnabled(true);
        }

        /** Re-scan biome data and rebuild if green chunks changed */
        refreshGreenDetection() {
            let changed = false;
            let segs = window.TERRAIN_SEGS;
            let chunkSegs = Math.ceil(segs / this.gridSize);
            for (let c of this.chunks) {
                let gxS = c.cx * chunkSegs, gzS = c.cz * chunkSegs;
                let gxE = Math.min(gxS + chunkSegs, segs);
                let gzE = Math.min(gzS + chunkSegs, segs);
                let nowGreen = this._hasGreen(gxS, gzS, gxE, gzE);
                if (nowGreen !== c.isGreen) changed = true;
            }
            if (changed) {
                this._buildChunks();
                if (this.enabled) this.setEnabled(true);
            }
        }

        /** Debug stats */
        getStats() {
            let hiRes = 0, loRes = 0, totalTris = 0;
            for (let c of this.chunks) {
                if (c.isGreen) hiRes++; else loRes++;
                totalTris += c.lodSegs * c.lodSegs * 2;
            }
            return { total: this.chunks.length, hiRes, loRes, totalTris,
                     greenGrid: this.greenGrid, terrainGrid: this.terrainGrid };
        }

        // ─────────────────────────────────────────────────────────────
        //  CHUNK BUILDING
        // ─────────────────────────────────────────────────────────────

        _buildChunks() {
            // Remove old chunks
            for (let c of this.chunks) {
                if (c.mesh.parent) this.scene.remove(c.mesh);
                c.geo.dispose();
            }
            this.chunks = [];

            let segs = window.TERRAIN_SEGS;
            let gs = this.gridSize;
            let chunkSegs = Math.ceil(segs / gs);
            let masterStride = segs + 1;
            let mPos = this.masterGeo.attributes.position.array;
            let mUV = this.masterGeo.attributes.uv.array;

            // Compute LOD step for non-green chunks
            let lodRatio = Math.max(1, Math.round(this.greenGrid / this.terrainGrid));

            for (let cz = 0; cz < gs; cz++) {
                for (let cx = 0; cx < gs; cx++) {
                    let gxS = cx * chunkSegs;
                    let gzS = cz * chunkSegs;
                    let gxE = Math.min(gxS + chunkSegs, segs);
                    let gzE = Math.min(gzS + chunkSegs, segs);
                    let masterSegsX = gxE - gxS;
                    let masterSegsZ = gzE - gzS;

                    let isGreen = this._hasGreen(gxS, gzS, gxE, gzE);
                    let lodStep = isGreen ? 1 : lodRatio;

                    // Effective LOD segments for this chunk
                    let lodSegsX = Math.max(4, Math.round(masterSegsX / lodStep));
                    let lodSegsZ = Math.max(4, Math.round(masterSegsZ / lodStep));
                    // Use same in both directions for simplicity
                    let lodSegs = Math.min(lodSegsX, lodSegsZ);

                    let cW = lodSegs + 1; // vertices per row
                    let cH = lodSegs + 1;
                    let gridVertCount = cW * cH;

                    // ── Precompute master index mapping ──
                    let masterIndices = new Int32Array(gridVertCount);
                    for (let lz = 0; lz < cH; lz++) {
                        let mGz = gzS + Math.round(lz * masterSegsZ / lodSegs);
                        for (let lx = 0; lx < cW; lx++) {
                            let mGx = gxS + Math.round(lx * masterSegsX / lodSegs);
                            masterIndices[lz * cW + lx] = mGz * masterStride + mGx;
                        }
                    }

                    // ── Grid positions + UVs ──
                    let positions = new Float32Array(gridVertCount * 3);
                    let uvs = new Float32Array(gridVertCount * 2);
                    for (let ci = 0; ci < gridVertCount; ci++) {
                        let mi = masterIndices[ci];
                        positions[ci*3]   = mPos[mi*3];
                        positions[ci*3+1] = mPos[mi*3+1];
                        positions[ci*3+2] = mPos[mi*3+2];
                        uvs[ci*2]   = mUV[mi*2];
                        uvs[ci*2+1] = mUV[mi*2+1];
                    }

                    // ── Grid indices (triangulation) ──
                    let gridIdxCount = lodSegs * lodSegs * 6;
                    let gridIndices = [];
                    for (let z = 0; z < lodSegs; z++) {
                        for (let x = 0; x < lodSegs; x++) {
                            let a = z * cW + x;
                            let b = a + 1;
                            let c = a + cW;
                            let d = c + 1;
                            gridIndices.push(a, c, b, b, c, d);
                        }
                    }

                    // ── Skirt geometry ──
                    let skirtData = this._buildSkirt(lodSegs, cW, gridVertCount, positions);

                    // ── Merge grid + skirt into final buffers ──
                    let totalVerts = gridVertCount + skirtData.vertCount;
                    let finalPos = new Float32Array(totalVerts * 3);
                    let finalUV = new Float32Array(totalVerts * 2);
                    let finalNorm = new Float32Array(totalVerts * 3);
                    finalPos.set(positions);
                    finalUV.set(uvs);

                    // Skirt positions
                    for (let si = 0; si < skirtData.vertCount; si++) {
                        let gi = skirtData.gridMap[si]; // grid vert index
                        let vi = gridVertCount + si;
                        finalPos[vi*3]   = positions[gi*3];
                        finalPos[vi*3+1] = positions[gi*3+1];
                        finalPos[vi*3+2] = positions[gi*3+2] - SKIRT_DEPTH;
                        finalUV[vi*2]    = uvs[gi*2];
                        finalUV[vi*2+1]  = uvs[gi*2+1];
                    }

                    // Merge indices
                    let allIndices = gridIndices.concat(skirtData.indices);
                    let use32 = totalVerts > 65535;
                    let idxArr = use32 ? new Uint32Array(allIndices) : new Uint16Array(allIndices);

                    // ── Create BufferGeometry ──
                    let geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.BufferAttribute(finalPos, 3));
                    geo.setAttribute('uv', new THREE.BufferAttribute(finalUV, 2));
                    geo.setAttribute('normal', new THREE.BufferAttribute(finalNorm, 3));
                    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
                    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);

                    let mesh = new THREE.Mesh(geo, this.material);
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.receiveShadow = true;
                    mesh.castShadow = false;
                    mesh.frustumCulled = true;
                    mesh.name = 'terrain_chunk_' + cx + '_' + cz;

                    this.chunks.push({
                        cx, cz,
                        gxStart: gxS, gzStart: gzS, gxEnd: gxE, gzEnd: gzE,
                        lodSegs, isGreen, gridVertCount,
                        masterIndices,
                        skirtGridMap: skirtData.gridMap,
                        skirtVertCount: skirtData.vertCount,
                        geo, mesh,
                        dirty: true
                    });
                }
            }

            // Initial full sync
            this.syncAll();

            let stats = this.getStats();
            console.log('[TerrainChunks] Built', stats.total, 'chunks:',
                stats.hiRes, 'hi-res (green),', stats.loRes, 'lo-res.',
                'Total terrain tris:', stats.totalTris.toLocaleString(),
                '| Green grid:', stats.greenGrid, '| Terrain grid:', stats.terrainGrid);
        }

        // ─────────────────────────────────────────────────────────────
        //  SKIRT GEOMETRY
        // ─────────────────────────────────────────────────────────────

        /**
         * Build skirt vertices+indices for one chunk.
         * Skirts extend downward from all 4 edges.
         * @returns {{ vertCount, gridMap: Int32Array, indices: number[] }}
         */
        _buildSkirt(lodSegs, cW, gridVertCount, gridPositions) {
            // If no LOD difference, minimal skirts (still add them for safety)
            let edgeVerts = [];  // grid vertex indices on edges

            // Top edge (lz=0)
            for (let x = 0; x <= lodSegs; x++) edgeVerts.push(x);
            // Bottom edge (lz=lodSegs)
            for (let x = 0; x <= lodSegs; x++) edgeVerts.push(lodSegs * cW + x);
            // Left edge (lx=0, skip corners)
            for (let z = 1; z < lodSegs; z++) edgeVerts.push(z * cW);
            // Right edge (lx=lodSegs, skip corners)
            for (let z = 1; z < lodSegs; z++) edgeVerts.push(z * cW + lodSegs);

            let vertCount = edgeVerts.length;
            let gridMap = new Int32Array(vertCount);
            for (let i = 0; i < vertCount; i++) gridMap[i] = edgeVerts[i];

            // Build skirt triangle strips along each edge
            let indices = [];
            let skirtBase = gridVertCount;

            // Helper: connect edge segment (gi0→gi1) with their skirt verts (si0→si1)
            function addSkirtQuad(gi0, gi1, si0, si1) {
                // Two triangles forming a quad
                indices.push(gi0, gi1, skirtBase + si0);
                indices.push(gi1, skirtBase + si1, skirtBase + si0);
            }

            // Map grid vert index → skirt vert index
            let gridToSkirt = {};
            for (let si = 0; si < vertCount; si++) {
                gridToSkirt[edgeVerts[si]] = si;
            }

            // Top edge (z=0): x = 0..lodSegs
            for (let x = 0; x < lodSegs; x++) {
                let g0 = x, g1 = x + 1;
                addSkirtQuad(g0, g1, gridToSkirt[g0], gridToSkirt[g1]);
            }
            // Bottom edge (z=lodSegs)
            for (let x = 0; x < lodSegs; x++) {
                let g0 = lodSegs * cW + x, g1 = g0 + 1;
                addSkirtQuad(g1, g0, gridToSkirt[g1], gridToSkirt[g0]); // reversed winding
            }
            // Left edge (x=0): z = 0..lodSegs
            for (let z = 0; z < lodSegs; z++) {
                let g0 = z * cW, g1 = (z+1) * cW;
                addSkirtQuad(g1, g0, gridToSkirt[g1], gridToSkirt[g0]); // reversed
            }
            // Right edge (x=lodSegs)
            for (let z = 0; z < lodSegs; z++) {
                let g0 = z * cW + lodSegs, g1 = (z+1) * cW + lodSegs;
                addSkirtQuad(g0, g1, gridToSkirt[g0], gridToSkirt[g1]);
            }

            return { vertCount, gridMap, indices };
        }

        // ─────────────────────────────────────────────────────────────
        //  GREEN DETECTION
        // ─────────────────────────────────────────────────────────────

        /** Check if a chunk region contains green or foregreen biome pixels */
        _hasGreen(gxS, gzS, gxE, gzE) {
            // If LOD ratio is 1 (same grid), skip detection — everything is full res
            if (this.terrainGrid >= this.greenGrid) return true;

            let biome = window.terrainBiomeData;
            if (!biome) return true; // Default to high-res if no biome data yet

            let cfg = window.CURRENT_BIOME_CONFIG || {};
            let gh = cfg.greenColor || '#98ce68';
            let fh = cfg.foregreenColor || '#8bc45d';
            let gR = parseInt(gh.slice(1,3),16), gG = parseInt(gh.slice(3,5),16), gB = parseInt(gh.slice(5,7),16);
            let fR = parseInt(fh.slice(1,3),16), fG = parseInt(fh.slice(3,5),16), fB = parseInt(fh.slice(5,7),16);

            let segs = window.TERRAIN_SEGS;
            let pxS = Math.floor((gxS / segs) * 4096);
            let pxE = Math.ceil((gxE / segs) * 4096);
            let pzS = Math.floor((gzS / segs) * 4096);
            let pzE = Math.ceil((gzE / segs) * 4096);

            let step = Math.max(1, Math.floor((pxE - pxS) / 50)); // ~50 samples per axis
            for (let pz = pzS; pz < pzE; pz += step) {
                for (let px = pxS; px < pxE; px += step) {
                    let idx = (pz * 4096 + px) * 4;
                    let r = biome[idx], g = biome[idx+1], b = biome[idx+2];
                    let dG = (r-gR)*(r-gR) + (g-gG)*(g-gG) + (b-gB)*(b-gB);
                    if (dG < 2000) return true;
                    let dF = (r-fR)*(r-fR) + (g-fG)*(g-fG) + (b-fB)*(b-fB);
                    if (dF < 2000) return true;
                }
            }
            return false;
        }

        // ─────────────────────────────────────────────────────────────
        //  SYNC: Master → Chunks
        // ─────────────────────────────────────────────────────────────

        /** Full sync: positions + normals + skirts */
        _syncFull(chunk, mPos, mNorm, stride) {
            let cPos = chunk.geo.attributes.position.array;
            let cNorm = chunk.geo.attributes.normal.array;
            let mi, ci;

            // Grid vertices
            for (ci = 0; ci < chunk.gridVertCount; ci++) {
                mi = chunk.masterIndices[ci];
                cPos[ci*3]   = mPos[mi*3];
                cPos[ci*3+1] = mPos[mi*3+1];
                cPos[ci*3+2] = mPos[mi*3+2];
                cNorm[ci*3]   = mNorm[mi*3];
                cNorm[ci*3+1] = mNorm[mi*3+1];
                cNorm[ci*3+2] = mNorm[mi*3+2];
            }

            // Skirt vertices (follow edge positions, offset downward)
            for (let si = 0; si < chunk.skirtVertCount; si++) {
                let gi = chunk.skirtGridMap[si];
                let vi = chunk.gridVertCount + si;
                cPos[vi*3]   = cPos[gi*3];
                cPos[vi*3+1] = cPos[gi*3+1];
                cPos[vi*3+2] = cPos[gi*3+2] - SKIRT_DEPTH;
                // Skirt normals: point outward (approximate — use grid normal)
                cNorm[vi*3]   = cNorm[gi*3];
                cNorm[vi*3+1] = cNorm[gi*3+1];
                cNorm[vi*3+2] = cNorm[gi*3+2];
            }

            chunk.geo.attributes.position.needsUpdate = true;
            chunk.geo.attributes.normal.needsUpdate = true;
            chunk.geo.computeBoundingBox();
            chunk.geo.computeBoundingSphere();
        }

        /** Position-only sync (fast, for during sculpting) */
        _syncPositions(chunk, mPos, stride) {
            let cPos = chunk.geo.attributes.position.array;

            // Grid vertices
            for (let ci = 0; ci < chunk.gridVertCount; ci++) {
                let mi = chunk.masterIndices[ci];
                cPos[ci*3]   = mPos[mi*3];
                cPos[ci*3+1] = mPos[mi*3+1];
                cPos[ci*3+2] = mPos[mi*3+2];
            }

            // Skirt vertices
            for (let si = 0; si < chunk.skirtVertCount; si++) {
                let gi = chunk.skirtGridMap[si];
                let vi = chunk.gridVertCount + si;
                cPos[vi*3]   = cPos[gi*3];
                cPos[vi*3+1] = cPos[gi*3+1];
                cPos[vi*3+2] = cPos[gi*3+2] - SKIRT_DEPTH;
            }

            chunk.geo.attributes.position.needsUpdate = true;
        }
    }

    window.TerrainChunkManager = TerrainChunkManager;
})();
