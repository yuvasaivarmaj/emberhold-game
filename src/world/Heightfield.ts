// Holds the terrain heights and provides fast CPU sampling plus a GPU texture.
import * as THREE from 'three/webgpu';
import { WORLD_HALF, HF_N, CELL, HEIGHT_MIN, HEIGHT_MAX, MASK_RES } from './Layout';
import { setMask } from './WorldConfig';

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

  /** Loads the baked map: heights, land-use mask and metadata. */
  static async load(onProgress: (p: number) => void): Promise<Heightfield> {
    const base = document.baseURI;
    const get = async (file: string, weight: number, done: number) => {
      const res = await fetch(new URL(`./data/${file}`, base).toString());
      if (!res.ok) throw new Error(`Couldn't load the world map (${file}). Run npm run bake.`);
      const total = +(res.headers.get('content-length') ?? 0);
      if (!res.body || !total) { const b = await res.arrayBuffer(); onProgress(done + weight); return b; }
      // Servers that compress the file (GitHub Pages does) report the compressed size,
      // so collect the chunks as they come and only use the size for the progress bar.
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value); got += value.length;
        onProgress(done + weight * Math.min(1, got / total));
      }
      const out = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      onProgress(done + weight);
      return out.buffer;
    };
    const meta = await (await fetch(new URL('./data/verdance.json', base).toString())).json();
    const h16 = new Uint16Array(await get('verdance.h16', 0.65, 0));
    const mask = new Uint8Array(await get('verdance.mask', 0.17, 0.65));
    const crops = new Uint8Array(await get('verdance.crops', 0.17, 0.82));
    const data = new Float32Array(h16.length);
    const span = (HEIGHT_MAX - HEIGHT_MIN) / 65535;
    for (let i = 0; i < h16.length; i++) data[i] = HEIGHT_MIN + h16[i] * span;
    onProgress(1);
    const hf = new Heightfield(data);
    hf.mask = mask;
    hf.meta = meta;
    setMask(mask);
    const tex = new THREE.DataTexture(mask, MASK_RES, MASK_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    hf.maskTexture = tex;
    const ctex = new THREE.DataTexture(crops, MASK_RES, MASK_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    ctex.magFilter = THREE.LinearFilter;
    ctex.minFilter = THREE.LinearFilter;
    ctex.generateMipmaps = false;
    ctex.needsUpdate = true;
    hf.cropTexture = ctex;
    return hf;
  }

  mask!: Uint8Array;
  maskTexture!: THREE.DataTexture;
  cropTexture!: THREE.DataTexture;
  meta: any;

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
