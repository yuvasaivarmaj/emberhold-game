// Rapier physics world: terrain heightfield, tree trunks, rocks, and the player capsule.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Heightfield } from '../world/Heightfield';
import { HF_N, HF_RES, WORLD_SIZE } from '../world/WorldConfig';
import type { TreeInstance } from '../world/Trees';
import type { RockInstance } from '../world/Rocks';

export class Physics {
  world!: RAPIER.World;
  static R = RAPIER;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  addTerrain(hf: Heightfield) {
    // Rapier expects heights with the fast-varying index along Z.
    const heights = new Float32Array(HF_N * HF_N);
    for (let ix = 0; ix < HF_N; ix++) {
      for (let iz = 0; iz < HF_N; iz++) heights[ix * HF_N + iz] = hf.data[iz * HF_N + ix];
    }
    const desc = RAPIER.ColliderDesc.heightfield(HF_RES, HF_RES, heights, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE });
    desc.setFriction(0.9);
    this.world.createCollider(desc);
  }

  addTrees(trees: TreeInstance[]) {
    for (const t of trees) {
      if (t.trunkRadius <= 0.05 || t.height < 4) continue;
      const r = Math.min(1.4, Math.max(0.12, t.trunkRadius * 0.9));
      const desc = RAPIER.ColliderDesc.cylinder(2.5, r).setTranslation(t.x, t.y + 2.5, t.z);
      this.world.createCollider(desc);
    }
  }

  addRocks(rocks: RockInstance[], geometries: THREE.BufferGeometry[]) {
    // Convex hulls from a decimated set of each rock's vertices, scaled per instance.
    const hullPoints = geometries.map((g) => {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const pts: number[] = [];
      for (let i = 0; i < pos.count; i += 7) pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      return pts;
    });
    const v = new THREE.Vector3();
    for (const r of rocks) {
      if (r.scale.y < 0.35) continue; // pebbles: walk over them
      const src = hullPoints[r.variant];
      const pts = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        v.set(src[i] * r.scale.x, src[i + 1] * r.scale.y, src[i + 2] * r.scale.z).applyQuaternion(r.quat);
        pts[i] = v.x; pts[i + 1] = v.y; pts[i + 2] = v.z;
      }
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (!desc) continue;
      desc.setTranslation(r.x, r.y, r.z);
      this.world.createCollider(desc);
    }
  }

  step() { this.world.step(); }
}
