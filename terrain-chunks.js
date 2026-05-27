// ================================================================
//  TERRAIN CHUNK MANAGER — Frustum-culled terrain rendering
//  Splits master terrain into NxN chunks for automatic culling.
//  
//  Architecture:
//  - Master PlaneGeometry (invisible) retains the single position array
//    that ALL existing code reads/writes (sculpting, save, undo, etc.)
//  - Chunk meshes copy their portion from master and render visibly
//  - After terrain modification, call sync to update affected chunks
//
//  Usage:
//    let mgr = new TerrainChunkManager(planeGeo, plane, scene, planeMat, 4);
//    mgr.setEnabled(true);
//    // After sculpting:
//    mgr.markDirty(worldX, worldZ, brushRadius);
//    mgr.syncDirty();
//    // After undo/load:
//    mgr.syncAll();
// ================================================================
(function() {
    'use strict';

    class TerrainChunkManager {
        /**
         * @param {THREE.BufferGeometry} masterGeo - The master PlaneGeometry
         * @param {THREE.Mesh} masterMesh - The terrain mesh (kept for raycasting)
         * @param {THREE.Scene} scene - The scene to add chunks to
         * @param {THREE.Material} material - Shared terrain material
         * @param {number} gridSize - Chunks per axis (4 = 4x4 = 16 chunks)
         */
        constructor(masterGeo, masterMesh, scene, material, gridSize) {
            this.masterGeo = masterGeo;
            this.masterMesh = masterMesh;
            this.scene = scene;
            this.material = material;
            this.gridSize = gridSize || 4;
            this.chunks = [];
            this.enabled = false;
            this._buildChunks();
        }

        // ── Build all chunks from master geometry ────────────────────────
        _buildChunks() {
            // Clean up old chunks
            for (let c of this.chunks) {
                this.scene.remove(c.mesh);
                c.geo.dispose();
            }
            this.chunks = [];

            let segs = window.TERRAIN_SEGS;
            let terrainSize = window.TERRAIN_SIZE;
            let gridSize = this.gridSize;
            let chunkSegs = Math.ceil(segs / gridSize);
            let masterStride = segs + 1;

            let masterPos = this.masterGeo.attributes.position.array;
            let masterUV = this.masterGeo.attributes.uv.array;

            for (let cz = 0; cz < gridSize; cz++) {
                for (let cx = 0; cx < gridSize; cx++) {
                    let gxStart = cx * chunkSegs;
                    let gzStart = cz * chunkSegs;
                    let gxEnd = Math.min(gxStart + chunkSegs, segs);
                    let gzEnd = Math.min(gzStart + chunkSegs, segs);

                    let cWidth  = gxEnd - gxStart + 1; // vertices per row
                    let cHeight = gzEnd - gzStart + 1; // rows
                    let vertCount = cWidth * cHeight;

                    // Allocate chunk arrays
                    let positions = new Float32Array(vertCount * 3);
                    let uvs       = new Float32Array(vertCount * 2);
                    let normals   = new Float32Array(vertCount * 3);

                    // Copy positions + UVs from master
                    for (let lz = 0; lz < cHeight; lz++) {
                        for (let lx = 0; lx < cWidth; lx++) {
                            let mi = (gzStart + lz) * masterStride + (gxStart + lx);
                            let ci = lz * cWidth + lx;

                            positions[ci * 3]     = masterPos[mi * 3];
                            positions[ci * 3 + 1] = masterPos[mi * 3 + 1];
                            positions[ci * 3 + 2] = masterPos[mi * 3 + 2];

                            uvs[ci * 2]     = masterUV[mi * 2];
                            uvs[ci * 2 + 1] = masterUV[mi * 2 + 1];
                        }
                    }

                    // Build index buffer (two triangles per grid cell)
                    let cSegsX = gxEnd - gxStart;
                    let cSegsZ = gzEnd - gzStart;
                    let indexCount = cSegsX * cSegsZ * 6;
                    let useUint32 = vertCount > 65535;
                    let indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
                    let idx = 0;
                    for (let z = 0; z < cSegsZ; z++) {
                        for (let x = 0; x < cSegsX; x++) {
                            let a = z * cWidth + x;
                            let b = a + 1;
                            let c = a + cWidth;
                            let d = c + 1;
                            indices[idx++] = a;
                            indices[idx++] = c;
                            indices[idx++] = b;
                            indices[idx++] = b;
                            indices[idx++] = c;
                            indices[idx++] = d;
                        }
                    }

                    // Create BufferGeometry
                    let geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
                    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
                    geo.setIndex(new THREE.BufferAttribute(indices, 1));
                    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);

                    // Create mesh (same rotation/shadow settings as master)
                    let mesh = new THREE.Mesh(geo, this.material);
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.receiveShadow = true;
                    mesh.castShadow = false;
                    mesh.frustumCulled = true;
                    mesh.name = 'terrain_chunk_' + cx + '_' + cz;

                    this.chunks.push({
                        cx, cz,
                        gxStart, gzStart, gxEnd, gzEnd,
                        cWidth, cHeight,
                        geo, mesh,
                        dirty: true
                    });
                }
            }

            // Initial full sync (positions + normals)
            this.syncAll();
        }

        // ── Sync ALL chunks (positions + normals) ────────────────────────
        // Use after: undo, level load, terrain resize, executeClear
        syncAll() {
            this.masterGeo.computeVertexNormals();
            let masterPos  = this.masterGeo.attributes.position.array;
            let masterNorm = this.masterGeo.attributes.normal.array;
            let masterStride = window.TERRAIN_SEGS + 1;

            for (let chunk of this.chunks) {
                this._syncChunkFull(chunk, masterPos, masterNorm, masterStride);
                chunk.dirty = false;
            }
        }

        // ── Sync only dirty chunks (positions + normals) ─────────────────
        // Use after: sculpting mouseup, smart builder operations
        syncDirty() {
            let hasDirty = false;
            for (let chunk of this.chunks) {
                if (chunk.dirty) { hasDirty = true; break; }
            }
            if (!hasDirty) return;

            this.masterGeo.computeVertexNormals();
            let masterPos  = this.masterGeo.attributes.position.array;
            let masterNorm = this.masterGeo.attributes.normal.array;
            let masterStride = window.TERRAIN_SEGS + 1;

            for (let chunk of this.chunks) {
                if (chunk.dirty) {
                    this._syncChunkFull(chunk, masterPos, masterNorm, masterStride);
                    chunk.dirty = false;
                }
            }
        }

        // ── Fast position-only sync for dirty chunks ─────────────────────
        // Use during: per-frame sculpting (normals deferred to mouseup)
        syncDirtyPositions() {
            let masterPos = this.masterGeo.attributes.position.array;
            let masterStride = window.TERRAIN_SEGS + 1;

            for (let chunk of this.chunks) {
                if (chunk.dirty) {
                    this._syncChunkPositions(chunk, masterPos, masterStride);
                    // Keep dirty=true so normals are synced on mouseup
                }
            }
        }

        // ── Internal: full sync (positions + normals) ────────────────────
        _syncChunkFull(chunk, masterPos, masterNorm, masterStride) {
            let chunkPos  = chunk.geo.attributes.position.array;
            let chunkNorm = chunk.geo.attributes.normal.array;

            for (let lz = 0; lz < chunk.cHeight; lz++) {
                for (let lx = 0; lx < chunk.cWidth; lx++) {
                    let mi = (chunk.gzStart + lz) * masterStride + (chunk.gxStart + lx);
                    let ci = lz * chunk.cWidth + lx;

                    chunkPos[ci * 3]     = masterPos[mi * 3];
                    chunkPos[ci * 3 + 1] = masterPos[mi * 3 + 1];
                    chunkPos[ci * 3 + 2] = masterPos[mi * 3 + 2];

                    chunkNorm[ci * 3]     = masterNorm[mi * 3];
                    chunkNorm[ci * 3 + 1] = masterNorm[mi * 3 + 1];
                    chunkNorm[ci * 3 + 2] = masterNorm[mi * 3 + 2];
                }
            }

            chunk.geo.attributes.position.needsUpdate = true;
            chunk.geo.attributes.normal.needsUpdate = true;
            chunk.geo.computeBoundingBox();
            chunk.geo.computeBoundingSphere();
        }

        // ── Internal: position-only sync (fast, for during sculpting) ────
        _syncChunkPositions(chunk, masterPos, masterStride) {
            let chunkPos = chunk.geo.attributes.position.array;

            for (let lz = 0; lz < chunk.cHeight; lz++) {
                for (let lx = 0; lx < chunk.cWidth; lx++) {
                    let mi = (chunk.gzStart + lz) * masterStride + (chunk.gxStart + lx);
                    let ci = lz * chunk.cWidth + lx;

                    // Only height (Z) changes during sculpting, but copy all 3
                    // in case of terrain resize or other X/Y changes
                    chunkPos[ci * 3]     = masterPos[mi * 3];
                    chunkPos[ci * 3 + 1] = masterPos[mi * 3 + 1];
                    chunkPos[ci * 3 + 2] = masterPos[mi * 3 + 2];
                }
            }

            chunk.geo.attributes.position.needsUpdate = true;
            // Skip normals + bounding updates for per-frame perf
        }

        // ── Mark chunks intersecting a world-space circle as dirty ───────
        markDirty(worldX, worldZ, radius) {
            let segs = window.TERRAIN_SEGS;
            let size = window.TERRAIN_SIZE;
            let half = size / 2;
            let step = size / segs;

            for (let chunk of this.chunks) {
                if (chunk.dirty) continue; // Already dirty

                // Chunk world-space bounds
                let cMinX = -half + chunk.gxStart * step;
                let cMaxX = -half + chunk.gxEnd * step;
                let cMinZ = -half + chunk.gzStart * step;
                let cMaxZ = -half + chunk.gzEnd * step;

                // Circle-AABB intersection
                let closestX = Math.max(cMinX, Math.min(worldX, cMaxX));
                let closestZ = Math.max(cMinZ, Math.min(worldZ, cMaxZ));
                let dx = worldX - closestX;
                let dz = worldZ - closestZ;

                if (dx * dx + dz * dz <= radius * radius) {
                    chunk.dirty = true;
                }
            }
        }

        // ── Mark ALL chunks dirty ────────────────────────────────────────
        markAllDirty() {
            for (let chunk of this.chunks) chunk.dirty = true;
        }

        // ── Enable/disable chunk rendering ───────────────────────────────
        setEnabled(enabled) {
            this.enabled = enabled;

            for (let chunk of this.chunks) {
                if (enabled && !chunk.mesh.parent) {
                    this.scene.add(chunk.mesh);
                } else if (!enabled && chunk.mesh.parent) {
                    this.scene.remove(chunk.mesh);
                }
            }

            // Master mesh: invisible (no rendering) but still raycastable
            // Three.js Raycaster checks layers, NOT visible property
            this.masterMesh.visible = !enabled;
        }

        // ── Rebuild after terrain resize ─────────────────────────────────
        rebuild(newGeo, newMesh) {
            this.masterGeo = newGeo;
            if (newMesh) this.masterMesh = newMesh;
            this._buildChunks();
            if (this.enabled) this.setEnabled(true);
        }

        // ── Debug stats ──────────────────────────────────────────────────
        getStats() {
            let total = this.chunks.length;
            let dirty = 0;
            for (let c of this.chunks) if (c.dirty) dirty++;
            return { total, dirty, enabled: this.enabled };
        }
    }

    window.TerrainChunkManager = TerrainChunkManager;
})();
