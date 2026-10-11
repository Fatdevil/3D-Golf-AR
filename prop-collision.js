// What a placed prop (tree, rock, building ...) does to a ball at one point: the test the shot physics calls for every placed object.
// Returns null (no hit) or what physics.js understands: { type, height, part?, n?, safePos? }. n is the outward normal in physics order
// (x, forward y, up z) and safePos a spot just outside the surface (x, forward y). Shapes come from the asset's `physics`:
// sphere, cylinder, tree (one trunk radius + one crown radius) or profile (fitted to the model's triangles, see hitbox-fit.js).
(function (root) {
  'use strict';
  // obj: a placedTrees entry; threeX/threeZ: where the ball is (three.js x and z); z: its height above the ground there
  root.propHitAt = function (obj, threeX, threeZ, z) {
    const dx = obj.x - threeX, dz = obj.z - threeZ, distSq = dx * dx + dz * dz, dist = Math.sqrt(distSq) || 0.001;
    const nxThree = -dx / dist, nzThree = -dz / dist, nxPhys = nxThree, nyPhys = -nzThree;
    const assetDef = root.ASSET_REGISTRY && root.ASSET_REGISTRY[obj.type] ? root.ASSET_REGISTRY[obj.type] : null;
    if (!assetDef || !assetDef.physics) return null;
    const phys = assetDef.physics;

    if (phys.type === 'sphere') {
      const rad = phys.radius * obj.scale;
      if (distSq < rad * rad && z < rad) {
        const sX = obj.x + nxThree * (rad + 0.05), sZ = obj.z + nzThree * (rad + 0.05);
        return { type: obj.type, height: rad, n: [nxPhys, nyPhys, 0], safePos: [sX, -sZ] };
      }
    } else if (phys.type === 'cylinder') {
      const rad = phys.radius * obj.scale, h = phys.height * obj.scale;
      if (distSq < rad * rad && z < h) {
        const sX = obj.x + nxThree * (rad + 0.05), sZ = obj.z + nzThree * (rad + 0.05);
        return { type: obj.type, height: h, n: [nxPhys, nyPhys, 0], safePos: [sX, -sZ] };
      }
    } else if (phys.type === 'tree') {
      const trunkRadius = phys.trunkRadius * obj.scale, treeHeight = phys.height * obj.scale, canopyRadius = phys.canopyRadius * obj.scale;
      if (distSq < canopyRadius * canopyRadius) {
        if (distSq < trunkRadius * trunkRadius && z < treeHeight * 0.4) {
          const sX = obj.x + nxThree * (trunkRadius + 0.05), sZ = obj.z + nzThree * (trunkRadius + 0.05);
          return { type: obj.type, height: treeHeight, part: 'TRUNK', n: [nxPhys, nyPhys, 0], safePos: [sX, -sZ] };
        } else if (z > treeHeight * 0.3 && z < treeHeight) {
          return { type: obj.type, height: treeHeight, part: 'CANOPY' };
        }
      }
    } else if (phys.type === 'profile' && root.HitboxFit) {
      const h = root.HitboxFit.hit(phys, obj.scale, obj.rot || 0, obj.x, obj.z, threeX, threeZ, z), height = phys.height * obj.scale;
      if (h) {
        if (h.part === 'TRUNK') return { type: obj.type, height: height, part: 'TRUNK', n: [h.nx, -h.nz, 0], safePos: [h.sx, -h.sz] };
        return { type: obj.type, height: height, part: 'CANOPY' };
      }
    }
    return null;
  };
})(typeof window !== 'undefined' ? window : this);
