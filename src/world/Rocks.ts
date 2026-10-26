// Procedural boulders and stones with moss, placed on slopes, in meadows and along the river.
import * as THREE from 'three/webgpu';
import {
  float, vec3, mix, smoothstep, positionWorld, normalWorld, mx_noise_float, mx_fractal_noise_float, color, cameraPosition,
} from 'three/tsl';
import { Heightfield } from './Heightfield';
import { Simplex2, mulberry32, smoothstep as sstep } from './Noise';
import { WORLD_HALF, EMBERHOLD_SITE, SPAWN, riverDistance } from './WorldConfig';
import { bumpFromHeight } from './TerrainShading';

export interface RockInstance { x: number; y: number; z: number; scale: THREE.Vector3; quat: THREE.Quaternion; variant: number }

function rockGeometry(seed: number): THREE.BufferGeometry {
  const n = new Simplex2(seed);
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // Three planar 2D noises approximate a 3D field.
    const f = (a: number, b: number, s: number) => n.fbm(a * s, b * s, 4);
    let d = 1 + 0.28 * (f(v.x, v.y, 1.1) + f(v.y, v.z, 1.3) + f(v.z, v.x, 1.2)) / 3;
    d += 0.08 * (f(v.x + 3, v.z, 3.5) + f(v.y, v.x - 2, 3.1));
    // Flat facets: quantise a little for a fractured look.
    d = Math.round(d * 9) / 9 * 0.35 + d * 0.65;
    v.multiplyScalar(d);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3; // flattened base sits in the ground
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export class Rocks {
  readonly group = new THREE.Group();
  readonly instances: RockInstance[] = [];
  readonly geometries: THREE.BufferGeometry[] = [];

  constructor(hf: Heightfield, density: number) {
    for (let i = 0; i < 6; i++) this.geometries.push(rockGeometry(100 + i * 31));
    this.place(hf, density);
    const mat = this.material();
    const groups: RockInstance[][] = this.geometries.map(() => []);
    for (const r of this.instances) groups[r.variant].push(r);
    const m = new THREE.Matrix4();
    groups.forEach((list, vi) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(this.geometries[vi], mat, list.length);
      list.forEach((r, k) => { m.compose(new THREE.Vector3(r.x, r.y, r.z), r.quat, r.scale); mesh.setMatrixAt(k, m); });
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    });
    this.group.name = 'Rocks';
  }

  private place(hf: Heightfield, density: number) {
    const rand = mulberry32(2024);
    const noise = new Simplex2(55);
    const nrm = new THREE.Vector3();
    const total = Math.floor(5200 * density);
    for (let k = 0; k < total; k++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF - 30);
      const z = (rand() * 2 - 1) * (WORLD_HALF - 30);
      const h = hf.height(x, z);
      hf.normal(x, z, nrm);
      const rd = riverDistance(x, z);
      const de = Math.hypot(x - EMBERHOLD_SITE.x, z - EMBERHOLD_SITE.z);
      if (de < EMBERHOLD_SITE.radius) continue;
      const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z);
      if (ds < 6) continue;
      const steep = 1 - sstep(0.7, 0.92, nrm.y);
      const outcrop = sstep(0.35, 0.6, noise.fbm(x * 0.006, z * 0.006, 3));
      const bank = sstep(20, 9, rd);
      let p = steep * 0.7 + outcrop * 0.25 + bank * 0.5 + 0.02;
      if (rand() > p) continue;
      let size: number;
      if (bank > 0.3 && rand() < 0.8) size = 0.25 + rand() * 0.7;        // river stones
      else if (steep > 0.4) size = 1.2 + rand() * rand() * 5;           // boulders on slopes
      else size = 0.3 + rand() * rand() * 2.2;                          // meadow stones
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm.clone().lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize());
      quat.premultiply(tilt);
      const scale = new THREE.Vector3(size * (0.8 + rand() * 0.5), size * (0.45 + rand() * 0.45), size * (0.8 + rand() * 0.5));
      this.instances.push({ x, y: h - scale.y * 0.15, z, scale, quat, variant: Math.floor(rand() * this.geometries.length) });
    }
  }

  private material() {
    const mat = new THREE.MeshStandardNodeMaterial();
    const p = positionWorld;
    const n = normalWorld;
    const big = mx_fractal_noise_float(p.mul(0.35), 4, 2.1, 0.55);
    const fine = mx_noise_float(p.mul(4.5));
    const base = mix(color(0x5a5650), color(0x8a857b), big.mul(0.5).add(0.5)).mul(fine.mul(0.08).add(1.0));
    const lichen = smoothstep(0.55, 0.75, mx_noise_float(p.mul(1.3).add(vec3(7.0, 0.0, 3.0))).mul(0.5).add(0.5));
    const withLichen = mix(base, color(0x9c9a7e), lichen.mul(0.35));
    const moss = smoothstep(0.45, 0.85, n.y.add(big.mul(0.25))).mul(smoothstep(-0.2, 0.3, mx_noise_float(p.mul(0.8))));
    mat.colorNode = mix(withLichen, color(0x3f5422), moss.mul(0.85));
    mat.roughnessNode = mix(float(0.86), float(0.95), moss);
    const near = float(1).sub(smoothstep(20.0, 80.0, cameraPosition.distance(p)));
    mat.normalNode = bumpFromHeight(big.mul(0.06).add(fine.mul(0.012)).mul(near));
    return mat;
  }
}
