// Quadtree terrain: 256 m tiles at full detail near the player, merging into larger,
// coarser tiles with distance, out to the full 8 km map. Skirts hide seams between levels.
import * as THREE from 'three/webgpu';
import { Heightfield } from './Heightfield';
import { WORLD_HALF, WORLD_SIZE, CELL } from './Layout';
import { createTerrainMaterial } from './TerrainShading';

const SEG = 64;          // grid segments per tile side
const LEAF = 256;        // smallest tile, metres (4 m spacing)
const CACHE_MAX = 420;

interface Node { x0: number; z0: number; size: number; key: string }

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardNodeMaterial;
  private cache = new Map<string, { mesh: THREE.Mesh; used: number }>();
  private active = new Set<string>();
  private frame = 0;
  private splitK: number;
  private lastCam = new THREE.Vector3(1e9, 0, 0);

  constructor(private hf: Heightfield, viewScale = 1) {
    this.material = createTerrainMaterial(hf);
    this.splitK = 1.55 * Math.max(0.6, viewScale);
    this.group.name = 'Terrain';
  }

  private build(n: Node): THREE.Mesh {
    const step = n.size / SEG;
    const vRow = SEG + 1;
    const hf = this.hf;
    const count = vRow * vRow + SEG * 4;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const nv = new THREE.Vector3();
    let v = 0;
    for (let j = 0; j <= SEG; j++) {
      for (let i = 0; i <= SEG; i++) {
        const x = n.x0 + i * step, z = n.z0 + j * step;
        positions[v * 3] = x;
        positions[v * 3 + 1] = hf.height(x, z);
        positions[v * 3 + 2] = z;
        const e = Math.max(CELL, step);
        const hl = hf.height(x - e, z), hr = hf.height(x + e, z), hd = hf.height(x, z - e), hu = hf.height(x, z + e);
        nv.set(hl - hr, 2 * e, hd - hu).normalize();
        normals[v * 3] = nv.x; normals[v * 3 + 1] = nv.y; normals[v * 3 + 2] = nv.z;
        v++;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * vRow + i, b = a + 1, c = a + vRow, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    // Skirts around the edge hide cracks against neighbouring tiles of another level.
    const drop = 2 + step * 1.6;
    const edge: number[] = [];
    for (let i = 0; i < SEG; i++) edge.push(i);
    for (let j = 0; j < SEG; j++) edge.push(j * vRow + SEG);
    for (let i = SEG; i > 0; i--) edge.push(SEG * vRow + i);
    for (let j = SEG; j > 0; j--) edge.push(j * vRow);
    const ring = v;
    for (let k = 0; k < edge.length; k++) {
      const s = edge[k];
      positions[v * 3] = positions[s * 3];
      positions[v * 3 + 1] = positions[s * 3 + 1] - drop;
      positions[v * 3 + 2] = positions[s * 3 + 2];
      normals.copyWithin(v * 3, s * 3, s * 3 + 3);
      v++;
    }
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const a2 = ring + k, b2 = ring + ((k + 1) % edge.length);
      indices.push(a, b, a2, b, b2, a2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = `terrain_${n.key}`;
    return mesh;
  }

  private select(cam: THREE.Vector3, out: Node[]) {
    const visit = (x0: number, z0: number, size: number) => {
      const dx = Math.max(0, Math.abs(cam.x - (x0 + size / 2)) - size / 2);
      const dz = Math.max(0, Math.abs(cam.z - (z0 + size / 2)) - size / 2);
      const d = Math.hypot(dx, dz, Math.max(0, cam.y - this.hf.max) * 0.5);
      if (size > LEAF && d < size * this.splitK) {
        const h = size / 2;
        visit(x0, z0, h); visit(x0 + h, z0, h); visit(x0, z0 + h, h); visit(x0 + h, z0 + h, h);
      } else {
        out.push({ x0, z0, size, key: `${x0}_${z0}_${size}` });
      }
    };
    visit(-WORLD_HALF, -WORLD_HALF, WORLD_SIZE);
  }

  update(cam: THREE.Vector3) {
    if (this.lastCam.distanceToSquared(cam) < 16) return;
    this.lastCam.copy(cam);
    this.frame++;
    const nodes: Node[] = [];
    this.select(cam, nodes);
    const next = new Set(nodes.map((n) => n.key));
    for (const key of this.active) {
      if (!next.has(key)) { const c = this.cache.get(key); if (c) this.group.remove(c.mesh); }
    }
    for (const n of nodes) {
      let c = this.cache.get(n.key);
      if (!c) { c = { mesh: this.build(n), used: this.frame }; this.cache.set(n.key, c); }
      c.used = this.frame;
      if (!this.active.has(n.key)) this.group.add(c.mesh);
    }
    this.active = next;
    // Forget tiles that haven't been needed for a while.
    if (this.cache.size > CACHE_MAX) {
      const old = [...this.cache.entries()].filter(([k]) => !next.has(k)).sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < old.length && this.cache.size > CACHE_MAX; i++) {
        old[i][1].mesh.geometry.dispose();
        this.cache.delete(old[i][0]);
      }
    }
  }
}
