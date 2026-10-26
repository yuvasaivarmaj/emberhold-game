// Procedural boulders and stones with moss, placed on slopes, in meadows and along rivers.
// Two levels of detail; small stones are only drawn near the player.
import * as THREE from 'three/webgpu';
import {
  float, vec3, mix, smoothstep, positionWorld, normalWorld, mx_noise_float, mx_fractal_noise_float, color, cameraPosition,
} from 'three/tsl';
import { Heightfield } from './Heightfield';
import { Simplex2, mulberry32, smoothstep as sstep } from './Noise';
import { WORLD_HALF, EMBERHOLD_SITE, riverDistance, roadAt, settlementAt } from './WorldConfig';
import { bumpFromHeight } from './TerrainShading';

export interface RockInstance { x: number; y: number; z: number; scale: THREE.Vector3; quat: THREE.Quaternion; variant: number; size: number }

function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const n = new Simplex2(seed);
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const f = (a: number, b: number, s: number) => n.fbm(a * s, b * s, 4);
    let d = 1 + 0.28 * (f(v.x, v.y, 1.1) + f(v.y, v.z, 1.3) + f(v.z, v.x, 1.2)) / 3;
    d += 0.08 * (f(v.x + 3, v.z, 3.5) + f(v.y, v.x - 2, 3.1));
    d = Math.round(d * 9) / 9 * 0.35 + d * 0.65;
    v.multiplyScalar(d);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const VARIANTS = 6;
const NEAR = 140;        // full-detail radius
const FAR_SMALL = 380;   // small stones vanish beyond this
const FAR_BIG = 2200;    // boulders stay visible far away

export class Rocks {
  readonly group = new THREE.Group();
  readonly instances: RockInstance[] = [];
  readonly geometries: THREE.BufferGeometry[] = [];
  private lowGeos: THREE.BufferGeometry[] = [];
  private meshes: { hi: THREE.InstancedMesh; lo: THREE.InstancedMesh }[] = [];
  private byVariant: RockInstance[][] = [];
  private mats: Float32Array[] = [];
  private last = new THREE.Vector3(1e9, 0, 0);

  constructor(hf: Heightfield, density: number) {
    for (let i = 0; i < VARIANTS; i++) {
      this.geometries.push(rockGeometry(100 + i * 31, 3));
      this.lowGeos.push(rockGeometry(100 + i * 31, 1));
    }
    this.place(hf, density);
    const mat = this.material();
    this.byVariant = this.geometries.map(() => []);
    for (const r of this.instances) this.byVariant[r.variant].push(r);
    const m = new THREE.Matrix4();
    this.byVariant.forEach((list, vi) => {
      const arr = new Float32Array(list.length * 16);
      list.forEach((r, k) => { m.compose(new THREE.Vector3(r.x, r.y, r.z), r.quat, r.scale); m.toArray(arr, k * 16); });
      this.mats.push(arr);
      const hi = new THREE.InstancedMesh(this.geometries[vi], mat, Math.max(1, list.length));
      const lo = new THREE.InstancedMesh(this.lowGeos[vi], mat, Math.max(1, list.length));
      for (const mesh of [hi, lo]) {
        mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
      }
      hi.castShadow = true;
      this.meshes.push({ hi, lo });
    });
    this.group.name = 'Rocks';
  }

  private place(hf: Heightfield, density: number) {
    const rand = mulberry32(2024);
    const noise = new Simplex2(55);
    const nrm = new THREE.Vector3();
    const total = Math.floor(52000 * density);
    for (let k = 0; k < total; k++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF - 30);
      const z = (rand() * 2 - 1) * (WORLD_HALF - 30);
      const rd = riverDistance(x, z);
      const de = Math.hypot(x - EMBERHOLD_SITE.x, z - EMBERHOLD_SITE.z);
      if (de < EMBERHOLD_SITE.radius + 30) continue;
      if (roadAt(x, z) > 0.05 || settlementAt(x, z) > 0.1) continue;
      hf.normal(x, z, nrm);
      const steep = 1 - sstep(0.7, 0.92, nrm.y);
      const outcrop = sstep(0.35, 0.6, noise.fbm(x * 0.002, z * 0.002, 3));
      const bank = rd < 18 ? sstep(18, 4, rd) : 0;
      const p = steep * 0.7 + outcrop * 0.25 + bank * 0.5 + 0.015;
      if (rand() > p) continue;
      const h = hf.height(x, z);
      let size: number;
      if (bank > 0.3 && rand() < 0.8) size = 0.25 + rand() * 0.7;
      else if (steep > 0.4) size = 1.2 + rand() * rand() * 5;
      else size = 0.3 + rand() * rand() * 2.2;
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm.clone().lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize());
      quat.premultiply(tilt);
      const scale = new THREE.Vector3(size * (0.8 + rand() * 0.5), size * (0.45 + rand() * 0.45), size * (0.8 + rand() * 0.5));
      this.instances.push({ x, y: h - scale.y * 0.15, z, scale, quat, variant: Math.floor(rand() * VARIANTS), size });
    }
  }

  update(cam: THREE.Vector3) {
    if (this.last.distanceToSquared(cam) < 100) return;
    this.last.copy(cam);
    this.byVariant.forEach((list, vi) => {
      const { hi, lo } = this.meshes[vi];
      const src = this.mats[vi];
      const hiArr = hi.instanceMatrix.array as Float32Array, loArr = lo.instanceMatrix.array as Float32Array;
      let nh = 0, nl = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const d2 = (r.x - cam.x) ** 2 + (r.z - cam.z) ** 2;
        const limit = r.size > 2 ? FAR_BIG : FAR_SMALL;
        if (d2 > limit * limit) continue;
        if (d2 < NEAR * NEAR) { hiArr.set(src.subarray(i * 16, i * 16 + 16), nh * 16); nh++; }
        else { loArr.set(src.subarray(i * 16, i * 16 + 16), nl * 16); nl++; }
      }
      hi.count = nh; lo.count = nl;
      hi.instanceMatrix.needsUpdate = true; lo.instanceMatrix.needsUpdate = true;
    });
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
