// Where buildings stand, as a 1 m texture over Emberhold, so the meadow grass (and anything
// else drawn on the GPU) knows not to grow up through floors.
import * as THREE from 'three/webgpu';
import { EMBERHOLD as E } from './Layout';
import type { Building } from './Buildings';

const N = 1040;
export const noGrass: { tex: THREE.DataTexture | null; ox: number; oz: number; n: number } = { tex: null, ox: E.x - N / 2, oz: E.z - N / 2, n: N };

export function buildFootprints(buildings: Building[], extra: { x: number; z: number; rot: number; hw: number; hd: number }[] = []) {
  const data = new Uint8Array(N * N);
  const raster = (cx: number, cz: number, rot: number, hw: number, hd: number) => {
    const r = Math.hypot(hw, hd) + 1, cs = Math.cos(rot), sn = Math.sin(rot);
    for (let x = Math.floor(cx - r - noGrass.ox); x <= cx + r - noGrass.ox; x++) for (let z = Math.floor(cz - r - noGrass.oz); z <= cz + r - noGrass.oz; z++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const dx = noGrass.ox + x + 0.5 - cx, dz = noGrass.oz + z + 0.5 - cz;
      if (Math.abs(dx * cs - dz * sn) <= hw && Math.abs(dx * sn + dz * cs) <= hd) data[z * N + x] = 255;
    }
  };
  for (const b of buildings) raster(b.x, b.z, b.rot, b.W / 2 + 0.3, b.D / 2 + 0.3);
  for (const e of extra) raster(e.x, e.z, e.rot, e.hw, e.hd);
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  noGrass.tex = tex;
}
