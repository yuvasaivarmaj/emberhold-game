// Runtime view of the world layout. Shapes and constants live in Layout.ts; this module
// adds lookups into the baked land-use mask (distance to water, roads, land use).
export {
  WORLD_SIZE, WORLD_HALF, HF_RES, HF_N, CELL, WATER_LEVEL, SPAWN, EMBERHOLD, QUILLHAVEN, MASK_RES,
} from './Layout';
import { EMBERHOLD, WORLD_HALF, MASK_RES } from './Layout';

/** Compatibility shape used by older modules: the fort's outer wall as a circle. */
export const EMBERHOLD_SITE = { x: EMBERHOLD.x, z: EMBERHOLD.z, radius: EMBERHOLD.outerR };

let maskData: Uint8Array | null = null;
export function setMask(m: Uint8Array) { maskData = m; }

function maskAt(x: number, z: number, ch: number) {
  if (!maskData) return 0;
  const mx = Math.max(0, Math.min(MASK_RES - 1, Math.floor(((x + WORLD_HALF) / (WORLD_HALF * 2)) * MASK_RES)));
  const mz = Math.max(0, Math.min(MASK_RES - 1, Math.floor(((z + WORLD_HALF) / (WORLD_HALF * 2)) * MASK_RES)));
  return maskData[(mz * MASK_RES + mx) * 4 + ch];
}

/** Metres to the nearest river or lake edge (0 in the water, capped at 255). */
export function riverDistance(x: number, z: number) { return maskData ? maskAt(x, z, 3) : 999; }
/** 0..1, 1 on a road. */
export function roadAt(x: number, z: number) { return maskAt(x, z, 0) / 255; }
/** 0..1, 1 inside Emberhold's walls or Quillhaven. */
export function settlementAt(x: number, z: number) { return maskAt(x, z, 1) / 255; }
/** 0..1 forest density. */
export function forestAt(x: number, z: number) { return maskAt(x, z, 2) / 255; }
