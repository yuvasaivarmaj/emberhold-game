// Procedural height function for the Verdance region. Pure, so it can run in a worker.
import { Simplex2, smoothstep, lerp } from './Noise';
import { WORLD_HALF, HF_N, CELL, WATER_LEVEL, EMBERHOLD_SITE, riverDistance } from './WorldConfig';

const noise = new Simplex2(1337);
const noise2 = new Simplex2(4242);

function baseHeight(x: number, z: number): number {
  // Broad rolling farmland and meadows.
  let h = 9 + noise.fbm(x * 0.0021, z * 0.0021, 5) * 20;
  h += noise.fbm(x * 0.0085 + 31, z * 0.0085 - 17, 4) * 4.0;
  h += noise2.fbm(x * 0.03, z * 0.03, 3) * 0.6; // small undulations underfoot

  // Mountains rising toward the edges of the playable area (a natural boundary).
  const ax = Math.abs(x) / WORLD_HALF, az = Math.abs(z) / WORLD_HALF;
  const r = Math.max(Math.hypot(ax, az) * 0.82, Math.max(ax, az));
  const rim = smoothstep(0.68, 0.98, r + noise2.fbm(x * 0.004, z * 0.004, 3) * 0.1);
  if (rim > 0) {
    // Domain-warped ridges read as weathered ranges rather than spikes.
    const wx = x + noise2.fbm(x * 0.0015, z * 0.0015, 3) * 260;
    const wz = z + noise2.fbm(x * 0.0015 + 40, z * 0.0015 - 40, 3) * 260;
    const ridges = noise.ridged(wx * 0.0017 + 5, wz * 0.0017 - 9, 5);
    const massif = 0.5 + 0.5 * noise.fbm(x * 0.0011, z * 0.0011, 3);
    h += rim * (30 + Math.pow(ridges, 1.25) * 185 * (0.55 + 0.6 * massif) + noise2.fbm(x * 0.01, z * 0.01, 4) * 10);
  }

  // A broad hill crowned by a levelled plateau: the future site of Emberhold.
  const de = Math.hypot(x - EMBERHOLD_SITE.x, z - EMBERHOLD_SITE.z);
  h += 26 * Math.exp(-(de * de) / (2 * 260 * 260));
  return h;
}

const PLATEAU_H = (() => {
  // Level the plateau at the average base height around the site, plus a little.
  let s = 0, n = 0;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    s += baseHeight(EMBERHOLD_SITE.x + Math.cos(ang) * 60, EMBERHOLD_SITE.z + Math.sin(ang) * 60);
    n++;
  }
  return s / n + 3;
})();

export function heightAt(x: number, z: number): number {
  let h = baseHeight(x, z);

  // Emberhold plateau.
  const de = Math.hypot(x - EMBERHOLD_SITE.x, z - EMBERHOLD_SITE.z);
  const plateau = 1 - smoothstep(EMBERHOLD_SITE.radius, EMBERHOLD_SITE.radius + 120, de);
  h = lerp(h, PLATEAU_H + noise2.fbm(x * 0.02, z * 0.02, 2) * 0.4, plateau);

  // River valley and channel.
  const d = riverDistance(x, z) + noise.fbm(x * 0.01, z * 0.01, 2) * 6;
  const valley = 1 - smoothstep(16, 110, d);
  const valleyFloor = WATER_LEVEL + 1.1 + Math.max(0, d - 16) * 0.05;
  h = lerp(h, Math.min(h, valleyFloor), valley * valley * (3 - 2 * valley));
  const channel = 1 - smoothstep(9, 17, d);
  if (channel > 0) {
    const t = Math.min(1, d / 15);
    const bed = WATER_LEVEL - 2.4 * (1 - t * t) + noise2.noise(x * 0.08, z * 0.08) * 0.25;
    h = lerp(h, bed, channel);
  }

  // Keep stray hollows from dipping below the waterline (no random ponds).
  if (d > 30 && h < WATER_LEVEL + 1.0) h = WATER_LEVEL + 1.0 - (WATER_LEVEL + 1.0 - h) * 0.15;
  return h;
}

export function generateHeights(onProgress?: (p: number) => void): Float32Array {
  const data = new Float32Array(HF_N * HF_N);
  for (let iz = 0; iz < HF_N; iz++) {
    const z = -WORLD_HALF + iz * CELL;
    for (let ix = 0; ix < HF_N; ix++) {
      data[iz * HF_N + ix] = heightAt(-WORLD_HALF + ix * CELL, z);
    }
    if (onProgress && (iz & 31) === 0) onProgress(iz / HF_N);
  }
  return data;
}
