// Bakes the Verdance region: an 8 x 8 km heightfield (4 m spacing) and a land-use mask
// (8 m) with roads, fields, vineyards, forests and distance to water.
// Run with `npm run bake`. Output goes to public/data/.
import fs from 'node:fs';
import path from 'node:path';
import { Simplex2, smoothstep, lerp } from '../src/world/Noise';
import {
  WORLD_HALF, HF_N, CELL, MASK_RES, WATER_LEVEL, HEIGHT_MIN, HEIGHT_MAX, EMBERHOLD, QUILLHAVEN, LAKE,
  RIVERS, ROADS, smoothPath, fortShape, type P,
} from '../src/world/Layout';

const t0 = Date.now();
const log = (m: string) => console.log(`[bake ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const N = HF_N;
const nA = new Simplex2(1337), nB = new Simplex2(4242), nC = new Simplex2(777);
const wx = (ix: number) => -WORLD_HALF + ix * CELL;

// ------------------------------------------------------------------ base land
function baseHeight(x: number, z: number) {
  let h = 16 + nA.fbm(x * 0.00042, z * 0.00042, 5) * 42;
  h += nA.fbm(x * 0.0015 + 31, z * 0.0015 - 17, 4) * 13;
  h += nB.fbm(x * 0.006, z * 0.006, 3) * 2.8;
  h += nB.fbm(x * 0.03, z * 0.03, 2) * 0.45;

  // Mountains: high on the north and west, lower hills to the south and east.
  const dn = (z + WORLD_HALF) / WORLD_HALF, dw = (x + WORLD_HALF) / WORLD_HALF;
  const ds = (WORLD_HALF - z) / WORLD_HALF, de = (WORLD_HALF - x) / WORLD_HALF;
  const jitter = nB.fbm(x * 0.0012, z * 0.0012, 3) * 0.12;
  const north = 1 - smoothstep(0.08, 0.5, dn + jitter), west = 1 - smoothstep(0.08, 0.45, dw + jitter);
  const south = 1 - smoothstep(0.02, 0.22, ds + jitter), east = 1 - smoothstep(0.02, 0.22, de + jitter);
  const high = Math.max(north, west);
  const low = Math.max(south, east);
  if (high > 0 || low > 0) {
    const wxp = x + nB.fbm(x * 0.0007, z * 0.0007, 3) * 500;
    const wzp = z + nB.fbm(x * 0.0007 + 40, z * 0.0007 - 40, 3) * 500;
    const ridges = nA.ridged(wxp * 0.0011 + 5, wzp * 0.0011 - 9, 6);
    const massif = 0.5 + 0.5 * nC.fbm(x * 0.0005, z * 0.0005, 3);
    h += high * (40 + Math.pow(ridges, 1.3) * 520 * (0.5 + 0.7 * massif));
    h += low * (20 + ridges * 110);
  }
  // The iron hills north of Emberhold.
  const di = Math.hypot(x - 450, z + 2750) / 1500;
  if (di < 1) {
    const w = Math.pow(1 - di, 1.5);
    h += w * (35 + nA.ridged(x * 0.0024, z * 0.0024, 5) * 120);
  }
  return h;
}

const H = new Float32Array(N * N);
for (let iz = 0; iz < N; iz++) {
  const z = wx(iz);
  for (let ix = 0; ix < N; ix++) H[iz * N + ix] = baseHeight(wx(ix), z);
}
log('base terrain');

// Broad, gentle valleys along the rivers.
const rivers = RIVERS.map((r) => ({ ...r, path: smoothPath(r.pts, 6) }));
const roads = ROADS.map((r) => ({ ...r, path: smoothPath(r.pts, 4) }));

/** Rasterise a path's distance field into `dist` (only within `reach`), keeping the nearest. */
function rasterDistance(pathPts: P[], reach: number, dist: Float32Array, owner?: Int32Array, ownerTag?: (i: number) => number) {
  for (let i = 0; i < pathPts.length - 1; i++) {
    const [ax, az] = pathPts[i], [bx, bz] = pathPts[i + 1];
    const minX = Math.min(ax, bx) - reach, maxX = Math.max(ax, bx) + reach;
    const minZ = Math.min(az, bz) - reach, maxZ = Math.max(az, bz) + reach;
    const ix0 = Math.max(0, Math.floor((minX + WORLD_HALF) / CELL)), ix1 = Math.min(N - 1, Math.ceil((maxX + WORLD_HALF) / CELL));
    const iz0 = Math.max(0, Math.floor((minZ + WORLD_HALF) / CELL)), iz1 = Math.min(N - 1, Math.ceil((maxZ + WORLD_HALF) / CELL));
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = wx(iz);
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = wx(ix);
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        const k = iz * N + ix;
        if (d < dist[k]) { dist[k] = d; if (owner && ownerTag) owner[k] = ownerTag(i); }
      }
    }
  }
}

const riverDist = new Float32Array(N * N).fill(1e9);
const riverWidth = new Float32Array(N * N).fill(0);
for (const r of rivers) {
  const d = new Float32Array(N * N).fill(1e9);
  rasterDistance(r.path, r.name === 'Silverrun' ? 700 : 260, d);
  for (let k = 0; k < d.length; k++) if (d[k] < riverDist[k] - 0.0) { if (d[k] < riverDist[k]) { riverDist[k] = d[k]; riverWidth[k] = r.width; } }
}
for (let k = 0; k < N * N; k++) {
  const d = riverDist[k];
  if (d > 700) continue;
  const big = riverWidth[k] > 20;
  const reach = big ? 650 : 220;
  const w = 1 - smoothstep(0, reach, d);
  const floor = WATER_LEVEL + 1.3 + d * (big ? 0.022 : 0.04);
  H[k] = lerp(H[k], Math.min(H[k], floor), w * w * (3 - 2 * w));
}
log('river valleys');

// ------------------------------------------------------------------ Emberhold hill-fort
const E = EMBERHOLD;
let ringBase = 0;
for (let a = 0; a < 32; a++) {
  const ang = (a / 32) * Math.PI * 2;
  ringBase += baseHeight(E.x + Math.cos(ang) * E.hillR, E.z + Math.sin(ang) * E.hillR);
}
ringBase /= 32;
const HS = ringBase + E.summit; // summit (high halls) height
function fortHeight(r: number): number | null {
  // Terraces from the summit down: keep, wall scarp, middle courts, scarp, lower yard, outer scarp.
  const { keepR, middleR, outerR } = E;
  if (r < keepR) return HS;
  if (r < keepR + 22) return lerp(HS, HS - 12, smoothstep(keepR, keepR + 22, r));
  if (r < middleR) return lerp(HS - 12, HS - 19, (r - keepR - 22) / (middleR - keepR - 22));
  if (r < middleR + 22) return lerp(HS - 19, HS - 31, smoothstep(middleR, middleR + 22, r));
  if (r < outerR) return lerp(HS - 31, HS - 46, (r - middleR - 22) / (outerR - middleR - 22));
  if (r < outerR + 26) return lerp(HS - 46, HS - 56, smoothstep(outerR, outerR + 26, r));
  return null;
}
function avenueHeight(r: number) {
  // A moving average of the terraces turns each scarp into a ~50 m ramp.
  let s = 0, n = 0;
  for (let k = -12; k <= 12; k++) {
    const h = fortHeight(Math.max(0, r + k * 2.2));
    if (h !== null) { s += h; n++; }
  }
  return n ? s / n : HS - 56;
}
const AV_S = Math.atan2(462, 30), AV_N = Math.atan2(-470, -30);
function avenueWeight(x: number, z: number, r: number) {
  let w = 0;
  for (const [a, rMin] of [[AV_S, 0], [AV_N, E.keepR + 26]] as [number, number][]) {
    const ux = Math.cos(a), uz = Math.sin(a);
    const along = (x - E.x) * ux + (z - E.z) * uz;
    if (along < 0) continue;
    const across = Math.abs(-(x - E.x) * uz + (z - E.z) * ux);
    w = Math.max(w, (1 - smoothstep(6, 16, across)) * smoothstep(rMin, rMin + 20, r));
  }
  return w;
}
for (let iz = 0; iz < N; iz++) {
  const z = wx(iz);
  if (Math.abs(z - E.z) > E.hillR + 40) continue;
  for (let ix = 0; ix < N; ix++) {
    const x = wx(ix);
    const dx = x - E.x, dz = z - E.z;
    const ang = Math.atan2(dz, dx);
    // A slightly irregular, organic outline.
    const r = Math.hypot(dx, dz) / fortShape(ang);
    if (r > E.hillR) continue;
    const k = iz * N + ix;
    const fort = fortHeight(r);
    if (fort !== null) {
      H[k] = fort + nB.fbm(x * 0.05, z * 0.05, 2) * 0.25;
      // The processional avenues: the terraces' scarps become ramps where the way
      // climbs from the gates to the high halls.
      const av = avenueWeight(x, z, r);
      if (av > 0) H[k] = lerp(H[k], avenueHeight(r), av);
    } else {
      const t = smoothstep(E.outerR + 26, E.hillR, r);
      const slope = lerp(HS - 56, H[k], Math.pow(t, 0.8));
      H[k] = slope + nA.fbm(x * 0.01, z * 0.01, 3) * 3 * Math.sin(t * Math.PI);
    }
  }
}
log(`Emberhold hill (summit ${HS.toFixed(1)} m)`);

// ------------------------------------------------------------------ Quillhaven and the lake
for (let iz = 0; iz < N; iz++) {
  const z = wx(iz);
  for (let ix = 0; ix < N; ix++) {
    const x = wx(ix);
    const k = iz * N + ix;
    // A modest fold of land: soften the village area.
    const dq = Math.hypot(x - QUILLHAVEN.x, z - QUILLHAVEN.z);
    if (dq < QUILLHAVEN.r * 3) {
      const w = 1 - smoothstep(QUILLHAVEN.r, QUILLHAVEN.r * 3, dq);
      H[k] = lerp(H[k], Math.max(3, H[k] * 0.6 + 2), w * 0.6);
    }
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + nB.fbm(x * 0.006, z * 0.006, 2) * 60;
    if (dl < LAKE.r * 2.2) {
      const bowl = dl < LAKE.r ? WATER_LEVEL - 6 * (1 - (dl / LAKE.r) ** 2) - 0.5 : WATER_LEVEL + (dl - LAKE.r) * 0.05;
      const w = 1 - smoothstep(LAKE.r * 0.9, LAKE.r * 2.2, dl);
      H[k] = lerp(H[k], Math.min(H[k], bowl), w);
    }
  }
}
log('Quillhaven and the lake');

// ------------------------------------------------------------------ roads
function sampleH(x: number, z: number) {
  const gx = (x + WORLD_HALF) / CELL, gz = (z + WORLD_HALF) / CELL;
  const ix = Math.max(0, Math.min(N - 2, Math.floor(gx))), iz = Math.max(0, Math.min(N - 2, Math.floor(gz)));
  const fx = gx - ix, fz = gz - iz;
  const a = H[iz * N + ix], b = H[iz * N + ix + 1], c = H[(iz + 1) * N + ix], d = H[(iz + 1) * N + ix + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
const roadDist = new Float32Array(N * N).fill(1e9);
const roadTarget = new Float32Array(N * N);
const roadHalf = new Float32Array(N * N);
const bridges: { x: number; z: number; dirX: number; dirZ: number; deck: number; length: number; road: string }[] = [];
for (const r of roads) {
  const pts = r.path;
  // Road surface profile: follow the ground, smoothed, never below the water.
  let prof = pts.map(([x, z]) => sampleH(x, z));
  for (let pass = 0; pass < 3; pass++) {
    const s = prof.slice();
    const win = 14;
    for (let i = 0; i < prof.length; i++) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(prof.length - 1, i + win); j++) { sum += prof[j]; n++; }
      s[i] = sum / n;
    }
    prof = s;
  }
  // Roads that start at Emberhold's gates begin at the level of the yard inside and
  // climb to it as an even ramp, instead of ending at the foot of the hill's scarp.
  if (r.name === 'South road' || r.name === 'North road') {
    const gateH = fortHeight(E.outerR - 4)!;
    const K = 34; // ~136 m of ramp
    for (let i = 0; i < Math.min(K, prof.length); i++) {
      const t = i / K;
      prof[i] = lerp(gateH, prof[i], t * t * (3 - 2 * t));
    }
  }
  // Bridges: wherever the road crosses a river, carry it level across.
  let inWater = -1;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const gi = Math.round((z + WORLD_HALF) / CELL) * N + Math.round((x + WORLD_HALF) / CELL);
    const wet = riverDist[gi] < riverWidth[gi] / 2 + 6;
    if (wet && inWater < 0) inWater = i;
    if ((!wet || i === pts.length - 1) && inWater >= 0) {
      const a = Math.max(0, inWater - 3), b = Math.min(pts.length - 1, i + 3);
      const deck = Math.max(prof[a], prof[b], WATER_LEVEL + 4);
      for (let j = a; j <= b; j++) prof[j] = deck;
      const [ax, az] = pts[a], [bx, bz] = pts[b];
      const len = Math.hypot(bx - ax, bz - az);
      bridges.push({ x: (ax + bx) / 2, z: (az + bz) / 2, dirX: (bx - ax) / len, dirZ: (bz - az) / len, deck, length: len, road: r.name });
      inWater = -1;
    }
  }
  const reach = r.width / 2 + 10;
  const d = new Float32Array(N * N).fill(1e9);
  const idx = new Int32Array(N * N).fill(-1);
  rasterDistance(pts, reach, d, idx, (i) => i);
  for (let k = 0; k < d.length; k++) {
    if (d[k] < roadDist[k]) { roadDist[k] = d[k]; roadTarget[k] = prof[Math.max(0, idx[k])]; roadHalf[k] = r.width / 2; }
  }
}
for (let k = 0; k < N * N; k++) {
  const d = roadDist[k];
  if (d > 30) continue;
  const w = 1 - smoothstep(roadHalf[k] + 0.5, roadHalf[k] + 9, d);
  H[k] = lerp(H[k], roadTarget[k] - 0.12 * (1 - smoothstep(0, roadHalf[k], d)), w);
}
log(`roads (${bridges.length} bridges)`);

// ------------------------------------------------------------------ river channels (last, so bridges span them)
for (let k = 0; k < N * N; k++) {
  const d = riverDist[k];
  const half = riverWidth[k] / 2;
  if (half === 0 || d > half + 14) continue;
  const iz = Math.floor(k / N), ix = k % N;
  const x = wx(ix), z = wx(iz);
  if (d < half + 14) {
    const bankTop = WATER_LEVEL + 0.9;
    const bank = 1 - smoothstep(half, half + 14, d);
    H[k] = lerp(H[k], Math.min(H[k], bankTop + (d - half) * 0.08), bank);
  }
  if (d < half + 2) {
    const depth = half > 10 ? 3.0 : 1.4;
    const t = Math.min(1, d / half);
    const bed = WATER_LEVEL - depth * (1 - t * t) - 0.15 + nB.noise(x * 0.05, z * 0.05) * 0.2;
    const w = 1 - smoothstep(half - 1, half + 2, d);
    H[k] = lerp(H[k], Math.min(H[k], bed), w);
  }
}
// Keep stray hollows above the waterline.
const lakeD = (x: number, z: number) => Math.hypot(x - LAKE.x, z - LAKE.z);
for (let iz = 0; iz < N; iz++) {
  for (let ix = 0; ix < N; ix++) {
    const k = iz * N + ix;
    if (riverDist[k] < riverWidth[k] / 2 + 30) continue;
    if (lakeD(wx(ix), wx(iz)) < LAKE.r * 1.6) continue;
    if (H[k] < WATER_LEVEL + 1.0) H[k] = WATER_LEVEL + 1.0 - (WATER_LEVEL + 1.0 - H[k]) * 0.15;
  }
}
log('river channels');

// ------------------------------------------------------------------ land-use mask (8 m)
const M = MASK_RES;
const mask = new Uint8Array(M * M * 4);
const crops = new Uint8Array(M * M * 4);
const MC = (WORLD_HALF * 2) / M;
const hash2 = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
for (let mz = 0; mz < M; mz++) {
  const z = -WORLD_HALF + (mz + 0.5) * MC;
  for (let mx = 0; mx < M; mx++) {
    const x = -WORLD_HALF + (mx + 0.5) * MC;
    const gi = Math.min(N - 1, Math.round((z + WORLD_HALF) / CELL)) * N + Math.min(N - 1, Math.round((x + WORLD_HALF) / CELL));
    const h = H[gi];
    const rd = roadDist[gi], wd = Math.min(riverDist[gi] - riverWidth[gi] / 2, lakeD(x, z) - LAKE.r);
    const de = Math.hypot(x - E.x, z - E.z);
    const dq = Math.hypot(x - QUILLHAVEN.x, z - QUILLHAVEN.z);
    // slope
    const hx = H[Math.min(gi + 1, N * N - 1)] - H[Math.max(gi - 1, 0)];
    const hz = H[Math.min(gi + N, N * N - 1)] - H[Math.max(gi - N, 0)];
    const slope = Math.hypot(hx, hz) / (2 * CELL);

    let use = 0; // 0 wild meadow
    const castle = de < E.outerR + 10;
    const village = dq < QUILLHAVEN.r;
    // Vineyards on the slopes south of the river along the south road ("beyond the vineyards").
    const vd = Math.hypot((x - 1020) / 620, (z - 1060) / 430) + nC.fbm(x * 0.002, z * 0.002, 3) * 0.3;
    const vineyard = vd < 1 && slope < 0.18 && wd > 30 && rd > 4;
    // Farmland on the plains around Emberhold and Quillhaven.
    const farmW = Math.max(1 - smoothstep(900, 2600, de), 1 - smoothstep(250, 1300, dq));
    const farmNoise = nC.fbm(x * 0.0012, z * 0.0012, 3);
    const farm = farmW + farmNoise * 0.35 > 0.55 && slope < 0.09 && h < 70 && wd > 18 && !castle;
    // Horse pastures east of Emberhold.
    const pd = Math.hypot((x - 2450) / 950, (z + 1100) / 700) + nC.fbm(x * 0.0015 + 9, z * 0.0015, 3) * 0.35;
    const pasture = pd < 1 && slope < 0.15 && !castle;
    if (castle || village) use = 6;
    else if (vineyard) use = 4;
    else if (pasture) use = 5;
    else if (farm) {
      // Parcels on a local grid: a hash picks the crop, hedgerow strips separate them.
      const ang = 0.35 + nC.noise(x * 0.0004, z * 0.0004) * 0.5;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const u = x * ca - z * sa, v = x * sa + z * ca;
      const pw = 110, ph = 70;
      const cu = Math.floor(u / pw), cv = Math.floor(v / ph);
      const fu = u / pw - cu, fv = v / ph - cv;
      const edge = fu < 0.05 || fu > 0.95 || fv < 0.07 || fv > 0.93;
      const r = hash2(cu, cv);
      use = edge ? 0 : r < 0.36 ? 1 : r < 0.58 ? 2 : r < 0.68 ? 3 : r < 0.82 ? 7 : 5;
    }
    // Forest density
    let forest = smoothstep(0.1, 0.42, nC.fbm(x * 0.0011, z * 0.0011, 4));
    // The charcoal woods either side of the south road, north of the vineyards.
    if (z > 230 && z < 640 && Math.abs(x - 1000) < 700 && wd > 25) forest = Math.max(forest, 0.75 + nB.noise(x * 0.01, z * 0.01) * 0.2);
    // Oak forests west of Emberhold.
    const dOak = Math.hypot(x + 300, z + 900) / 900;
    if (dOak < 1) forest = Math.max(forest, (1 - dOak) * 1.2);
    forest *= smoothstep(16, 30, rd) * smoothstep(10, 30, wd) * (h < 300 ? 1 : 1 - smoothstep(300, 420, h));
    if (use !== 0 && use !== 5) forest = 0;
    if (use === 5) forest *= 0.08;
    if (castle || de < E.outerR + 70) forest = 0;
    if (slope > 0.9) forest *= 0.3;
    // Road closeness (1 at the centre line)
    let roadC = 1 - smoothstep(roadHalf[gi] - 0.5, roadHalf[gi] + 1.5, rd);
    if (castle) {
      const rr = de / fortShape(Math.atan2(z - E.z, x - E.x));
      const dx2 = x - E.x, dz2 = z - E.z;
      let aw = 0;
      for (const [a, rMin] of [[AV_S, 0], [AV_N, E.keepR + 26]] as [number, number][]) {
        const ux = Math.cos(a), uz = Math.sin(a);
        if (dx2 * ux + dz2 * uz < 0 || rr < rMin) continue;
        aw = Math.max(aw, 1 - smoothstep(4.5, 6.5, Math.abs(-dx2 * uz + dz2 * ux)));
      }
      roadC = Math.max(roadC, aw);
    }
    const o = (mz * M + mx) * 4;
    mask[o] = Math.round(Math.max(0, Math.min(1, roadC)) * 255);
    mask[o + 1] = use === 6 ? 255 : 0;
    crops[o] = use === 1 ? 255 : 0;
    crops[o + 1] = use === 2 ? 255 : 0;
    crops[o + 2] = use === 3 ? 255 : 0;
    crops[o + 3] = use === 4 ? 255 : 0;
    mask[o + 2] = Math.round(Math.max(0, Math.min(1, forest)) * 255);
    mask[o + 3] = Math.round(Math.max(0, Math.min(255, wd < 0 ? 0 : wd)));
  }
}
log('land-use mask');

// ------------------------------------------------------------------ write
const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/data');
fs.mkdirSync(outDir, { recursive: true });
const h16 = new Uint16Array(N * N);
for (let k = 0; k < N * N; k++) h16[k] = Math.round(((Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, H[k])) - HEIGHT_MIN) / (HEIGHT_MAX - HEIGHT_MIN)) * 65535);
fs.writeFileSync(path.join(outDir, 'verdance.h16'), Buffer.from(h16.buffer));
fs.writeFileSync(path.join(outDir, 'verdance.mask'), Buffer.from(mask.buffer));
fs.writeFileSync(path.join(outDir, 'verdance.crops'), Buffer.from(crops.buffer));
let mn = Infinity, mxh = -Infinity;
for (const v of H) { if (v < mn) mn = v; if (v > mxh) mxh = v; }
fs.writeFileSync(path.join(outDir, 'verdance.json'), JSON.stringify({ version: 1, N, cell: CELL, mask: M, summit: HS, min: mn, max: mxh, bridges }, null, 1));
log(`done: heights ${mn.toFixed(1)}..${mxh.toFixed(1)} m`);

// Small preview image for checking the layout (not used by the game).
if (process.argv.includes('--preview')) {
  const P = 1024, img = Buffer.alloc(P * P * 3);
  for (let pz = 0; pz < P; pz++) for (let px = 0; px < P; px++) {
    const gi = Math.round(pz * (N - 1) / (P - 1)) * N + Math.round(px * (N - 1) / (P - 1));
    const h = H[gi];
    const m = ((pz * M / P | 0) * M + (px * M / P | 0)) * 4;
    let r: number, g: number, b: number;
    if (h < WATER_LEVEL) { r = 40; g = 80; b = 140; }
    else { const s = Math.min(1, h / 250); r = 90 + s * 120; g = 120 + s * 90; b = 70 + s * 110; }
    const use = mask[m + 1] ? 6 : crops[m] ? 1 : crops[m + 1] ? 2 : crops[m + 2] ? 3 : crops[m + 3] ? 4 : 0, f = mask[m + 2] / 255, road = mask[m] / 255;
    if (use === 1) { r = 200; g = 180; b = 90; } else if (use === 2) { r = 150; g = 170; b = 80; } else if (use === 3) { r = 120; g = 140; b = 170; }
    else if (use === 4) { r = 120; g = 70; b = 90; } else if (use === 5) { r = 130; g = 170; b = 90; } else if (use === 6) { r = 180; g = 170; b = 160; } else if (use === 7) { r = 160; g = 150; b = 100; }
    r *= 1 - f * 0.55; g *= 1 - f * 0.3; b *= 1 - f * 0.55;
    if (road > 0.3) { r = 230; g = 210; b = 170; }
    const o = (pz * P + px) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b;
  }
  const header = `P6\n${P} ${P}\n255\n`;
  fs.writeFileSync(path.join(outDir, '../../tools/.preview.ppm'), Buffer.concat([Buffer.from(header), img]));
  log('preview written to tools/.preview.ppm');
}
