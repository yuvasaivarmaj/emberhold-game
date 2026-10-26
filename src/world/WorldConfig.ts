// Shared constants for the playable region around Emberhold (the Verdance).
// 1 unit = 1 metre.

export const WORLD_SIZE = 2048;          // metres, square
export const WORLD_HALF = WORLD_SIZE / 2;
export const HF_RES = 1024;              // heightfield cells per side
export const HF_N = HF_RES + 1;          // samples per side
export const CELL = WORLD_SIZE / HF_RES; // 2 m between samples

export const WATER_LEVEL = 0;

// Where Emberhold will stand (Phase 2). The terrain is levelled into a plateau here.
export const EMBERHOLD_SITE = { x: 300, z: -470, radius: 140 };

// The river runs west to east across the map. Its centre line as a function of x.
export function riverZ(x: number): number {
  return -60 + 110 * Math.sin(x * 0.0042 + 0.6) + 45 * Math.sin(x * 0.0113 + 2.1) + 12 * Math.sin(x * 0.031);
}

export function riverDzDx(x: number): number {
  return 110 * 0.0042 * Math.cos(x * 0.0042 + 0.6) + 45 * 0.0113 * Math.cos(x * 0.0113 + 2.1) + 12 * 0.031 * Math.cos(x * 0.031);
}

// Distance (approximately perpendicular) from a point to the river centre line.
export function riverDistance(x: number, z: number): number {
  const d = Math.abs(z - riverZ(x));
  const s = riverDzDx(x);
  return d / Math.sqrt(1 + s * s);
}

// Player spawn: a meadow on the south bank, looking north-east across the river
// toward the Emberhold hill.
export const SPAWN = (() => {
  const x = -160;
  const z = riverZ(x) + 85;
  return { x, z, yaw: Math.atan2(-(EMBERHOLD_SITE.x - x), -(EMBERHOLD_SITE.z - z)) };
})();
