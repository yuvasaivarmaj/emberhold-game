// The building registry: every building in Emberhold as a record the rest of the game can
// use (doors, interiors, who lives and works there). Shapes come from buildHouse(); kinds,
// households and names are assigned by Emberhold as it places them.

/** What buildHouse() built, in enough detail to put a door, an interior and people in it. */
export interface HouseShape {
  x: number; z: number; rot: number;
  /** Ground-storey footprint (local x = w, local z = d) and wall height above the floor. */
  w: number; d: number; h: number;
  /** Upper storeys' footprint (bigger than w x d when jettied). */
  W: number; D: number;
  /** Bottom of the footing, the ground-floor level, the top of the ground storey, the eaves. */
  y0: number; fy: number; groundTop: number; top: number;
  floors: number;
  stone: boolean;
  /** Wall thickness. */
  wall: number;
  hollow: boolean;
  /** The doorway: offset along the front wall, size, and the outside threshold point. */
  door: { u: number; w: number; h: number; x: number; y: number; z: number };
  windows: { u: number; v: number; floor: number; y: number }[];
  roofH: number;
  chimney: { u: number; v: number } | null;
}

export type BuildingKind =
  | 'house' | 'smithy' | 'stable' | 'barracks' | 'inn' | 'bakery' | 'chandlery' | 'weaver' | 'cooper'
  | 'swornHall' | 'swornHouse'
  | 'hallOfCinders' | 'kitchen' | 'bakehouse' | 'store' | 'servants' | 'records'
  | 'familyWing' | 'nurseryWing' | 'forgeHall' | 'vaultStair' | 'keep';

export type Ring = 'lower' | 'middle' | 'summit';

export interface Building extends HouseShape {
  id: number;
  kind: BuildingKind;
  ring: Ring;
  /** The sworn household or family the building belongs to. */
  household: string;
  /** Shown when you look at the door. */
  name: string;
  /** Beds, for the population. */
  beds: number;
  /** Who can't just walk in: 'open' by day, 'private' (locked at night), 'restricted' (always locked to Ilyan). */
  access: 'open' | 'private' | 'restricted';
  /** Why a restricted door stays shut. */
  lockedWhy?: string;
  /** Which of Emberhold's colliders are this building's (walls, slab, steps). */
  colRange?: [number, number];
}

/** Local (u, v) on a building to world (x, z). */
export function localToWorld(b: { x: number; z: number; rot: number }, u: number, v: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [b.x + u * c + v * s, b.z - u * s + v * c];
}

/** World (x, z) to local (u, v) on a building. */
export function worldToLocal(b: { x: number; z: number; rot: number }, x: number, z: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = x - b.x, dz = z - b.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Is a world point inside the building's ground-floor walls? */
export function insideBuilding(b: Building, x: number, z: number, margin = 0) {
  const [u, v] = worldToLocal(b, x, z);
  return Math.abs(u) < b.w / 2 - b.wall + margin && Math.abs(v) < b.d / 2 - b.wall + margin;
}

/** Oriented-rectangle overlap (separating axis test), for keeping buildings apart. */
export interface Footprint { x: number; z: number; rot: number; hw: number; hd: number }
export function footprintsOverlap(a: Footprint, b: Footprint) {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2];
  const corners = (f: Footprint) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const u = su * f.hw, v = sv * f.hd;
    return [f.x + u * c + v * s, f.z - u * s + v * c];
  });
  const ca = corners(a), cb = corners(b);
  for (const ang of axes) {
    const ax = Math.cos(ang), az = -Math.sin(ang);
    const pa = ca.map(([x, z]) => x * ax + z * az), pb = cb.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

/** Readable names for the kinds, used on door prompts. */
export const KIND_NAMES: Record<BuildingKind, string> = {
  house: 'House', smithy: 'Smithy', stable: 'Stable', barracks: 'Barracks', inn: 'Alehouse', bakery: 'Bakery',
  chandlery: 'Chandlery', weaver: 'Weaver\'s house', cooper: 'Cooperage',
  swornHall: 'Hall', swornHouse: 'House', hallOfCinders: 'The Hall of Cinders', kitchen: 'Kitchens', bakehouse: 'Bakehouse',
  store: 'Storehouse', servants: 'Servants\' hall', records: 'Record house', familyWing: 'The family wing',
  nurseryWing: 'The nursery wing', forgeHall: 'The forge hall', vaultStair: 'The vault stair', keep: 'The keep',
};
