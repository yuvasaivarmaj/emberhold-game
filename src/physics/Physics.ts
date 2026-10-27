// Rapier physics world: the terrain heightfield plus tree trunks and rocks, whose
// colliders are streamed in around the player so the huge map stays light.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Heightfield } from '../world/Heightfield';
import { HF_N, HF_RES, WORLD_SIZE, WORLD_HALF } from '../world/Layout';
import type { TreeInstance } from '../world/Trees';
import type { RockInstance } from '../world/Rocks';
import type { Collider } from '../world/Emberhold';

interface Streamed { x: number; z: number; make: () => RAPIER.ColliderDesc | null; collider: RAPIER.Collider | null }

const CELL = 128;
const ADD_R = 110;
const DROP_R = 170;

export class Physics {
  world!: RAPIER.World;
  static R = RAPIER;
  private grid = new Map<number, Streamed[]>();
  private live = new Set<Streamed>();
  private last = new THREE.Vector3(1e9, 0, 0);

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

  private register(x: number, z: number, make: () => RAPIER.ColliderDesc | null) {
    const k = Math.floor((z + WORLD_HALF) / CELL) * 1024 + Math.floor((x + WORLD_HALF) / CELL);
    let l = this.grid.get(k);
    if (!l) { l = []; this.grid.set(k, l); }
    l.push({ x, z, make, collider: null });
  }

  addTrees(trees: TreeInstance[]) {
    for (const t of trees) {
      if (t.trunkRadius <= 0.05 || t.height < 4) continue;
      const r = Math.min(1.4, Math.max(0.12, t.trunkRadius * 0.9));
      this.register(t.x, t.z, () => RAPIER.ColliderDesc.cylinder(2.5, r).setTranslation(t.x, t.y + 2.5, t.z));
    }
  }

  addRocks(rocks: RockInstance[], geometries: THREE.BufferGeometry[]) {
    // Convex hulls from a decimated set of each rock's vertices, scaled per instance.
    const hullPoints = geometries.map((g) => {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const pts: number[] = [];
      for (let i = 0; i < pos.count; i += 5) pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      return pts;
    });
    const v = new THREE.Vector3();
    for (const r of rocks) {
      if (r.scale.y < 0.35) continue; // pebbles: walk over them
      this.register(r.x, r.z, () => {
        const src = hullPoints[r.variant];
        const pts = new Float32Array(src.length);
        for (let i = 0; i < src.length; i += 3) {
          v.set(src[i] * r.scale.x, src[i + 1] * r.scale.y, src[i + 2] * r.scale.z).applyQuaternion(r.quat);
          pts[i] = v.x; pts[i + 1] = v.y; pts[i + 2] = v.z;
        }
        const desc = RAPIER.ColliderDesc.convexHull(pts);
        return desc ? desc.setTranslation(r.x, r.y, r.z) : null;
      });
    }
  }

  /** Buildings and walls: streamed like the rest, as boxes and cylinders. */
  addStatic(list: Collider[]) {
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const c of list) {
      if (c.kind === 'box') {
        this.register(c.x, c.z, () => {
          q.setFromAxisAngle(up, c.rotY);
          return RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        });
      } else {
        this.register(c.x, c.z, () => RAPIER.ColliderDesc.cylinder(c.hh, c.r).setTranslation(c.x, c.y, c.z));
      }
    }
  }

  /** Bring colliders near the player into the world and drop far ones. */
  stream(p: THREE.Vector3, force = false) {
    if (!force && this.last.distanceToSquared(p) < 15 * 15) return;
    this.last.copy(p);
    for (const s of [...this.live]) {
      if ((s.x - p.x) ** 2 + (s.z - p.z) ** 2 > DROP_R * DROP_R) {
        if (s.collider) this.world.removeCollider(s.collider, false);
        s.collider = null;
        this.live.delete(s);
      }
    }
    const c0 = Math.floor((p.x - ADD_R + WORLD_HALF) / CELL), c1 = Math.floor((p.x + ADD_R + WORLD_HALF) / CELL);
    const r0 = Math.floor((p.z - ADD_R + WORLD_HALF) / CELL), r1 = Math.floor((p.z + ADD_R + WORLD_HALF) / CELL);
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const list = this.grid.get(cz * 1024 + cx);
      if (!list) continue;
      for (const s of list) {
        if (s.collider || (s.x - p.x) ** 2 + (s.z - p.z) ** 2 > ADD_R * ADD_R) continue;
        const desc = s.make();
        if (!desc) continue;
        s.collider = this.world.createCollider(desc);
        this.live.add(s);
      }
    }
  }

  step() { this.world.step(); }
}
