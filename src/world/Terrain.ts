// Chunked terrain with distance-based level of detail and skirts to hide seams.
import * as THREE from 'three/webgpu';
import { Heightfield } from './Heightfield';
import { WORLD_HALF, HF_RES, CELL } from './WorldConfig';
import { createTerrainMaterial } from './TerrainShading';

const CHUNK_CELLS = 64;                 // 64 cells * 2 m = 128 m chunks
const CHUNK_SIZE = CHUNK_CELLS * CELL;
const CHUNKS = HF_RES / CHUNK_CELLS;    // 16 x 16
const LOD_STEPS = [1, 2, 4, 8];         // sample stride in cells per LOD

interface Chunk {
  cx: number; cz: number;
  center: THREE.Vector3;
  meshes: (THREE.Mesh | null)[];
  current: number;
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardNodeMaterial;
  private chunks: Chunk[] = [];
  private lodDistances: number[];

  constructor(private hf: Heightfield, viewScale = 1) {
    this.material = createTerrainMaterial();
    this.lodDistances = [190, 420, 850].map((d) => d * viewScale);
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const x = -WORLD_HALF + (cx + 0.5) * CHUNK_SIZE;
        const z = -WORLD_HALF + (cz + 0.5) * CHUNK_SIZE;
        const y = hf.height(x, z);
        this.chunks.push({ cx, cz, center: new THREE.Vector3(x, y, z), meshes: [null, null, null, null], current: -1 });
      }
    }
    this.group.name = 'Terrain';
  }

  private build(chunk: Chunk, lod: number): THREE.Mesh {
    const step = LOD_STEPS[lod];
    const segs = CHUNK_CELLS / step;
    const vRow = segs + 1;
    const ix0 = chunk.cx * CHUNK_CELLS, iz0 = chunk.cz * CHUNK_CELLS;
    const mainCount = vRow * vRow;
    const skirtCount = segs * 4;
    const positions = new Float32Array((mainCount + skirtCount * 2) * 3);
    const normals: number[] = new Array((mainCount + skirtCount * 2) * 3);
    const hf = this.hf;

    let v = 0;
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const gx = ix0 + i * step, gz = iz0 + j * step;
        positions[v * 3] = -WORLD_HALF + gx * CELL;
        positions[v * 3 + 1] = hf.at(gx, gz);
        positions[v * 3 + 2] = -WORLD_HALF + gz * CELL;
        hf.gridNormal(gx, gz, normals, v * 3);
        v++;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * vRow + i, b = a + 1, c = a + vRow, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    // Skirts: drop a curtain along each edge to cover cracks between LODs.
    const drop = 2 + step * 2.5;
    const edge: number[] = [];
    for (let i = 0; i < segs; i++) edge.push(i);                       // north (j=0)
    for (let j = 0; j < segs; j++) edge.push(j * vRow + segs);         // east
    for (let i = segs; i > 0; i--) edge.push(segs * vRow + i);         // south
    for (let j = segs; j > 0; j--) edge.push(j * vRow);                // west
    const ringStart = v;
    for (let k = 0; k < edge.length; k++) {
      const src = edge[k];
      positions[v * 3] = positions[src * 3];
      positions[v * 3 + 1] = positions[src * 3 + 1] - drop;
      positions[v * 3 + 2] = positions[src * 3 + 2];
      normals[v * 3] = normals[src * 3]; normals[v * 3 + 1] = normals[src * 3 + 1]; normals[v * 3 + 2] = normals[src * 3 + 2];
      v++;
    }
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const a2 = ringStart + k, b2 = ringStart + ((k + 1) % edge.length);
      indices.push(a, b, a2, b, b2, a2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals.slice(0, v * 3)), 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    // Terrain doesn't cast shadows: self-shadowing at ground level causes acne on grass.
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = `terrain_${chunk.cx}_${chunk.cz}_lod${lod}`;
    return mesh;
  }

  update(camera: THREE.Vector3) {
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(camera.x - c.center.x) - CHUNK_SIZE / 2);
      const dz = Math.max(0, Math.abs(camera.z - c.center.z) - CHUNK_SIZE / 2);
      const d = Math.hypot(dx, dz);
      let lod = 3;
      for (let i = 0; i < this.lodDistances.length; i++) if (d < this.lodDistances[i]) { lod = i; break; }
      if (lod === c.current) continue;
      if (c.current >= 0 && c.meshes[c.current]) this.group.remove(c.meshes[c.current]!);
      if (!c.meshes[lod]) c.meshes[lod] = this.build(c, lod);
      this.group.add(c.meshes[lod]!);
      c.current = lod;
    }
  }
}
