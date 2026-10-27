// The Verdance region: an 8 x 8 km map. Everything here is in metres; x runs east,
// z runs south (north is -z). These shapes are used both when the map is baked and
// at runtime for gameplay (rivers for sound, roads for travel, places for the story).

export const WORLD_SIZE = 8192;
export const WORLD_HALF = WORLD_SIZE / 2;
export const HF_RES = 2048;              // heightfield cells per side
export const HF_N = HF_RES + 1;          // samples per side
export const CELL = WORLD_SIZE / HF_RES; // 4 m
export const MASK_RES = 1024;            // land-use mask texels per side (8 m)
export const WATER_LEVEL = 0;
export const HEIGHT_MIN = -40;           // range of the 16-bit height encoding
export const HEIGHT_MAX = 760;

export type P = [number, number];

// ------------------------------------------------------------------ places
export const EMBERHOLD = {
  x: 900, z: -700,
  // Concentric rings of the hill-fort (radius from the centre, metres)
  keepR: 170,     // high halls on the summit
  middleR: 330,   // middle courts of the sworn households
  outerR: 470,    // curtain wall around the lower yard
  hillR: 1050,    // the hill itself
  summit: 88,     // summit height above the surrounding plain
  southGate: [928, -262] as P,  // just inside the outer gate
  northGate: [870, -1162] as P,
};

export const QUILLHAVEN = { x: -1350, z: 1900, r: 150 };
export const BANYAN = { x: -1130, z: 2060 };
export const LAKE = { x: -2350, z: -950, r: 330 };

/** Where the story starts for now: the south road, with Emberhold ahead on its hill. */
export const SPAWN = { x: 1010, z: 760, yaw: 0.12 };

// ------------------------------------------------------------------ water
// Rivers are drawn as polylines, smoothed with Catmull-Rom splines when baked.
export const RIVERS: { name: string; width: number; pts: P[] }[] = [
  {
    name: 'Silverrun', width: 34,
    pts: [[-4300, 420], [-3400, 640], [-2600, 380], [-1900, 520], [-1150, 760], [-450, 520], [250, 240],
      [800, 160], [1400, 300], [2000, 60], [2700, 240], [3400, -40], [4300, 120]],
  },
  {
    name: 'Quill Brook', width: 14,
    pts: [[-1650, 4300], [-1780, 3500], [-1500, 2750], [-1300, 2250], [-1420, 1900], [-1280, 1500], [-1350, 1150], [-1180, 790]],
  },
  {
    name: 'Ember Brook', width: 9,
    pts: [[2300, -1500], [1900, -900], [1600, -420], [1200, -170], [880, -120], [600, -40], [380, 200]],
  },
];

// ------------------------------------------------------------------ roads
export const ROADS: { name: string; width: number; pts: P[] }[] = [
  {
    name: 'South road', width: 6,
    pts: [[928, -262], [935, -200], [960, -60], [990, 160], [1010, 520], [1080, 1100], [960, 1800], [780, 2600], [700, 3400], [640, 4300]],
  },
  {
    name: 'Quill road', width: 4.5,
    pts: [[1030, 900], [600, 1050], [0, 1200], [-600, 1500], [-1000, 1780], [-1350, 1900]],
  },
  {
    name: 'West road', width: 5,
    pts: [[-1350, 1900], [-1900, 1750], [-2700, 1600], [-3500, 1450], [-4300, 1400]],
  },
  {
    // Out of Quillhaven over the north bridge, where the watchboy keeps the bell.
    name: 'North lane', width: 3.6,
    pts: [[-1350, 1900], [-1356, 1820], [-1380, 1740], [-1418, 1640], [-1490, 1480], [-1600, 1260]],
  },
  {
    name: 'North road', width: 5,
    pts: [[870, -1162], [858, -1240], [760, -1700], [560, -2400], [420, -3200], [300, -4300]],
  },
  {
    name: 'East road', width: 5,
    pts: [[1330, -760], [1900, -840], [2600, -980], [3400, -1100], [4300, -1150]],
  },
];

// Ancient marker stones along the south road ("the outer watchstones").
export const WATCHSTONES: P[] = [[985, 420], [1000, 300], [970, 120]];

// ------------------------------------------------------------------ helpers
/** Catmull-Rom smoothing, resampled every `step` metres. */
export function smoothPath(pts: P[], step = 8): P[] {
  const out: P[] = [];
  const get = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Distance from a point to a polyline. */
export function distToPath(x: number, z: number, path: P[]) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/** Emberhold's slightly irregular outline: multiply a ring radius by this at angle `a`. */
export function fortShape(a: number) {
  return 1 + 0.05 * Math.sin(2 * a + 1.1) + 0.03 * Math.sin(3 * a + 0.4);
}
