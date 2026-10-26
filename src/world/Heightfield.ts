// Holds the terrain heights and provides fast CPU sampling plus a GPU texture.
import * as THREE from 'three/webgpu';
import { WORLD_HALF, HF_N, CELL } from './WorldConfig';

export class Heightfield {
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  min = Infinity;
  max = -Infinity;

  constructor(data: Float32Array) {
    this.data = data;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < this.min) this.min = v;
      if (v > this.max) this.max = v;
    }
    const tex = new THREE.DataTexture(data, HF_N, HF_N, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  static load(onProgress: (p: number) => void): Promise<Heightfield> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./heightWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.type === 'progress') onProgress(e.data.p);
        else if (e.data.type === 'done') {
          worker.terminate();
          resolve(new Heightfield(e.data.data));
        }
      };
      worker.onerror = (e) => reject(e);
      worker.postMessage('go');
    });
  }

  /** Raw sample at grid indices (clamped). */
  at(ix: number, iz: number): number {
    ix = ix < 0 ? 0 : ix >= HF_N ? HF_N - 1 : ix;
    iz = iz < 0 ? 0 : iz >= HF_N ? HF_N - 1 : iz;
    return this.data[iz * HF_N + ix];
  }

  /** Bilinear height at world x/z. */
  height(x: number, z: number): number {
    const gx = (x + WORLD_HALF) / CELL;
    const gz = (z + WORLD_HALF) / CELL;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h00 = this.at(ix, iz), h10 = this.at(ix + 1, iz);
    const h01 = this.at(ix, iz + 1), h11 = this.at(ix + 1, iz + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** Surface normal at world x/z (central differences over one cell). */
  normal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = CELL;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Normal at an exact grid sample (used when building terrain meshes). */
  gridNormal(ix: number, iz: number, out: number[], o: number) {
    const hl = this.at(ix - 1, iz), hr = this.at(ix + 1, iz);
    const hd = this.at(ix, iz - 1), hu = this.at(ix, iz + 1);
    let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
    const len = Math.hypot(nx, ny, nz);
    out[o] = nx / len; out[o + 1] = ny / len; out[o + 2] = nz / len;
  }
}
