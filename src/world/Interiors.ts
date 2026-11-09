// Inside every building. Each interior is planned deterministically from its building
// record (so the townsfolk know where the hearth, the benches and the beds are even when
// nobody is looking) and only built as meshes and colliders when the player comes near.
//
// Everything is placed in the building's local frame: u runs along the front wall
// (local x), v runs front-to-back with +v at the door, y is absolute height.
import * as THREE from 'three/webgpu';
import { float, vec3, mix, color, positionWorld, mx_noise_float, uniform, time, sin, attribute, smoothstep } from 'three/tsl';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Physics } from '../physics/Physics';
import { type Building, type BuildingKind, localToWorld, worldToLocal } from './Buildings';
import { mulberry32 } from './Noise';

export type Mat = 'paint' | 'fire' | 'day' | 'iron' | 'flame';

/** Somewhere a person can be inside: sit at the table, work the anvil, sleep, warm by the fire. */
export interface Spot {
  kind: 'sit' | 'work' | 'stand' | 'bed' | 'hearth' | 'serve' | 'desk' | 'seat';
  u: number; v: number; level: number; y: number;
  /** Facing, in the building's local frame (radians, 0 = facing +v). */
  face: number;
  /** What the work is, for the animation (hammer, knead, write, sweep...). */
  task?: string;
  taken?: boolean;
}

export interface Plan {
  levels: number[];               // floor heights above fy
  spots: Spot[];
  stairs: { level: number; u0: number; u1: number; v: number }[];
  hearth: { u: number; v: number; y: number } | null;
}

// ------------------------------------------------------------------ palette
const C = {
  oak: 0x5a3e28, darkOak: 0x3a281b, pine: 0x7a5a3a, plank: 0x6b4c33, stone: 0x8a8273, flag: 0x6f685d, soot: 0x2a2522,
  plaster: 0xb8ad97, straw: 0x9c8550, hay: 0xb59a58, linen: 0xcfc6b0, wool: 0x7a5a48, red: 0x7a2f24, blue: 0x2f4a5e,
  green: 0x4a5a32, ochre: 0x8a6a2e, clay: 0x8a5a3a, iron: 0x2a2a2c, coal: 0x161414, paper: 0xd8ccb0, leather: 0x5a3a22,
  wax: 0xe0d6b8, bread: 0x9a6a32, flour: 0xd8d0c0, ash: 0x4a4440, brass: 0x8a7a3a, black: 0x1a1614,
};

// ------------------------------------------------------------------ the sink
/** Where layout output goes: geometry and colliders when building, just spots when planning. */
interface Sink {
  box(mat: Mat, w: number, h: number, d: number, u: number, v: number, y: number, ry?: number, col?: number, collide?: boolean): void;
  cyl(mat: Mat, r: number, h: number, u: number, v: number, y: number, col?: number, seg?: number, collide?: boolean, r2?: number): void;
  /** A sloped box (stair ramp): rises along local u by `pitch`. */
  ramp(w: number, d: number, u: number, v: number, y: number, pitch: number): void;
  spot(s: Spot): void;
}

class DrySink implements Sink {
  spots: Spot[] = [];
  box() { /* planning only */ }
  cyl() { /* planning only */ }
  ramp() { /* planning only */ }
  spot(s: Spot) { this.spots.push(s); }
}

const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/**
 * Builds an interior's geometry straight into flat arrays (no three.js geometry objects per
 * piece, no merging), which keeps a room's build to a few milliseconds.
 */
const BOX_FACES: [number[], [number, number, number]][] = (() => {
  // Corner i: bit 0 = +x, bit 1 = +y, bit 2 = +z. Each face's four corners, wound so the
  // triangles face outward (checked here rather than trusted).
  const c = (i: number) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
  const faces: [number[], [number, number, number]][] = [
    [[1, 3, 7, 5], [1, 0, 0]], [[0, 4, 6, 2], [-1, 0, 0]], [[2, 6, 7, 3], [0, 1, 0]],
    [[0, 1, 5, 4], [0, -1, 0]], [[4, 5, 7, 6], [0, 0, 1]], [[0, 2, 3, 1], [0, 0, -1]],
  ];
  return faces.map(([q, n]) => {
    const a = c(q[0]), b = c(q[1]), d = c(q[2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const order = x[0] * n[0] + x[1] * n[1] + x[2] * n[2] < 0 ? [...q].reverse() : q;
    return [order, n] as [number[], [number, number, number]];
  });
})();
class GeoSink implements Sink {
  spots: Spot[] = [];
  parts: Record<Mat, { p: number[]; n: number[]; c: number[] }> = {
    paint: { p: [], n: [], c: [] }, fire: { p: [], n: [], c: [] }, day: { p: [], n: [], c: [] }, iron: { p: [], n: [], c: [] }, flame: { p: [], n: [], c: [] },
  };
  colliders: RAPIER.ColliderDesc[] = [];
  private col = new THREE.Color();
  constructor(private b: Building) {}

  box(mat: Mat, w: number, h: number, d: number, u: number, v: number, y: number, ry = 0, col = C.oak, collide = false) {
    const yaw = this.b.rot + ry, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const [x, z] = localToWorld(this.b, u, v);
    const P = this.parts[mat];
    this.col.set(col);
    const cr = this.col.r, cg = this.col.g, cb = this.col.b;
    // Corners: bit 0 = +x, bit 1 = +y, bit 2 = +z (box local, before the turn).
    const cx: number[] = [], cy: number[] = [], cz: number[] = [];
    for (let i = 0; i < 8; i++) {
      const lx = (i & 1 ? 0.5 : -0.5) * w, ly = i & 2 ? h : 0, lz = (i & 4 ? 0.5 : -0.5) * d;
      cx.push(x + lx * cs + lz * sn); cy.push(y + ly); cz.push(z - lx * sn + lz * cs);
    }
    for (const [q, [nx, ny, nz]] of BOX_FACES) {
      const wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs;
      for (const i of [q[0], q[1], q[2], q[0], q[2], q[3]]) {
        P.p.push(cx[i], cy[i], cz[i]); P.n.push(wx, ny, wz); P.c.push(cr, cg, cb);
      }
    }
    if (collide) {
      tmpQ.setFromAxisAngle(Y, yaw);
      this.colliders.push(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y + h / 2, z)
        .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }));
    }
  }

  cyl(mat: Mat, r: number, h: number, u: number, v: number, y: number, col = C.oak, seg = 10, collide = false, r2?: number) {
    const [x, z] = localToWorld(this.b, u, v);
    const P = this.parts[mat];
    this.col.set(col);
    const cr = this.col.r, cg = this.col.g, cb = this.col.b, rt = r2 ?? r;
    const n = Math.max(5, Math.min(seg, 14));
    const put = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => { P.p.push(px, py, pz); P.n.push(nx, ny, nz); P.c.push(cr, cg, cb); };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      // Side.
      put(x + c0 * r, y, z + s0 * r, c0, 0, s0); put(x + c1 * rt, y + h, z + s1 * rt, c1, 0, s1); put(x + c1 * r, y, z + s1 * r, c1, 0, s1);
      put(x + c0 * r, y, z + s0 * r, c0, 0, s0); put(x + c0 * rt, y + h, z + s0 * rt, c0, 0, s0); put(x + c1 * rt, y + h, z + s1 * rt, c1, 0, s1);
      // Top cap.
      if (rt > 0.001) { put(x, y + h, z, 0, 1, 0); put(x + c1 * rt, y + h, z + s1 * rt, 0, 1, 0); put(x + c0 * rt, y + h, z + s0 * rt, 0, 1, 0); }
    }
    if (collide) this.colliders.push(RAPIER.ColliderDesc.cylinder(h / 2, Math.max(r, rt)).setTranslation(x, y + h / 2, z));
  }

  ramp(w: number, d: number, u: number, v: number, y: number, pitch: number) {
    const len = w / Math.cos(pitch);
    const [x, z] = localToWorld(this.b, u, v);
    tmpQ.setFromAxisAngle(Y, this.b.rot);
    tmpQ2.setFromAxisAngle(Z, pitch);
    tmpQ.multiply(tmpQ2);
    this.colliders.push(RAPIER.ColliderDesc.cuboid(len / 2, 0.06, d / 2).setTranslation(x, y, z)
      .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }));
  }

  spot(s: Spot) { this.spots.push(s); }

  geometry(mat: Mat) {
    const P = this.parts[mat];
    if (!P.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(P.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(P.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------ planning helpers
interface Rect { u0: number; u1: number; v0: number; v1: number; level: number }

class Room {
  taken: Rect[] = [];
  constructor(public b: Building, public sink: Sink, public rand: () => number, public plan: Plan) {}
  get t() { return this.b.wall; }
  /** Inner extents of a level (upper storeys may be jettied out). */
  ext(level: number) {
    const up = level > 0 && this.b.W > this.b.w + 0.1;
    const W = up ? this.b.W : this.b.w, D = up ? this.b.D : this.b.d, t = up ? 0.25 : this.t;
    return { u0: -W / 2 + t, u1: W / 2 - t, v0: -D / 2 + t, v1: D / 2 - t };
  }
  y(level: number) { return this.b.fy + 0.04 + this.plan.levels[level]; }
  fits(r: Rect) {
    const e = this.ext(r.level);
    // (Padding may reach into the wall; the item itself must be inside.)
    if (r.u0 < e.u0 - 0.22 || r.u1 > e.u1 + 0.22 || r.v0 < e.v0 - 0.22 || r.v1 > e.v1 + 0.22) return false;
    return !this.taken.some((o) => o.level === r.level && r.u0 < o.u1 && r.u1 > o.u0 && r.v0 < o.v1 && r.v1 > o.v0);
  }
  take(r: Rect) { this.taken.push(r); }
  /** Try to claim a w x d rectangle (local axes) centred at u, v. */
  claim(level: number, u: number, v: number, w: number, d: number, pad = 0.15) {
    const r = { u0: u - w / 2 - pad, u1: u + w / 2 + pad, v0: v - d / 2 - pad, v1: v + d / 2 + pad, level };
    if (!this.fits(r)) return false;
    this.take(r);
    return true;
  }
  /** Find room for a w x d item against a wall (back, left, right, front-corners), facing into the room. */
  againstWall(level: number, w: number, d: number, tries = 24): { u: number; v: number; ry: number } | null {
    const e = this.ext(level);
    for (let i = 0; i < tries; i++) {
      const side = Math.floor(this.rand() * 4);
      if (side === 0) { // back wall, facing +v
        const u = e.u0 + w / 2 + this.rand() * Math.max(0, e.u1 - e.u0 - w);
        if (this.claim(level, u, e.v0 + d / 2 + 0.02, w, d, 0.1)) return { u, v: e.v0 + d / 2 + 0.02, ry: 0 };
      } else if (side === 1 || side === 2) { // side walls, item rotated 90 degrees
        const s = side === 1 ? -1 : 1;
        const v = e.v0 + w / 2 + this.rand() * Math.max(0, e.v1 - e.v0 - w);
        const u = s < 0 ? e.u0 + d / 2 + 0.02 : e.u1 - d / 2 - 0.02;
        if (this.claim(level, u, v, d, w, 0.1)) return { u, v, ry: s < 0 ? Math.PI / 2 : -Math.PI / 2 };
      } else { // front wall, facing -v
        const u = e.u0 + w / 2 + this.rand() * Math.max(0, e.u1 - e.u0 - w);
        if (this.claim(level, u, e.v1 - d / 2 - 0.02, w, d, 0.1)) return { u, v: e.v1 - d / 2 - 0.02, ry: Math.PI };
      }
    }
    return null;
  }
  /** Free space somewhere in the middle of the floor. */
  inMiddle(level: number, w: number, d: number, tries = 20): { u: number; v: number } | null {
    const e = this.ext(level);
    for (let i = 0; i < tries; i++) {
      const u = e.u0 + w / 2 + 0.8 + this.rand() * Math.max(0, e.u1 - e.u0 - w - 1.6);
      const v = e.v0 + d / 2 + 0.8 + this.rand() * Math.max(0, e.v1 - e.v0 - d - 1.6);
      if (this.claim(level, u, v, w, d, 0.5)) return { u, v };
    }
    return null;
  }
}

/** Rotate a local offset by ry (same convention as rotateY). */
function rot(ry: number, du: number, dv: number): [number, number] {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [du * c + dv * s, -du * s + dv * c];
}

// ------------------------------------------------------------------ furniture
const F = {
  table(r: Room, level: number, u: number, v: number, len: number, wid: number, ry: number, seats: boolean, col = C.oak) {
    const k = r.sink, y = r.y(level);
    k.box('paint', len, 0.06, wid, u, v, y + 0.72, ry, col, true);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const [du, dv] = rot(ry, a * (len / 2 - 0.12), b * (wid / 2 - 0.1));
      k.box('paint', 0.08, 0.72, 0.08, u + du, v + dv, y, ry, C.darkOak);
    }
    if (seats) {
      for (const sd of [-1, 1]) {
        const [du, dv] = rot(ry, 0, sd * (wid / 2 + 0.32));
        k.box('paint', len * 0.92, 0.05, 0.3, u + du, v + dv, y + 0.42, ry, C.pine);
        for (const a of [-1, 1]) {
          const [eu, ev] = rot(ry, a * len * 0.4, sd * (wid / 2 + 0.32));
          k.box('paint', 0.06, 0.42, 0.26, u + eu, v + ev, y, ry, C.darkOak);
        }
        const n = Math.max(1, Math.floor(len / 0.75));
        for (let i = 0; i < n; i++) {
          const along = -len / 2 + (i + 0.5) * (len / n);
          const [su, sv] = rot(ry, along, sd * (wid / 2 + 0.36));
          k.spot({ kind: 'sit', u: u + su, v: v + sv, level, y: y + 0.45, face: ry + (sd > 0 ? Math.PI : 0) });
        }
      }
      // Things on the table.
      for (let i = 0; i < Math.floor(len / 0.9); i++) {
        const [du, dv] = rot(ry, -len / 2 + 0.4 + r.rand() * (len - 0.8), (r.rand() - 0.5) * wid * 0.6);
        if (r.rand() < 0.5) k.cyl('paint', 0.05, 0.12, u + du, v + dv, y + 0.78, r.rand() < 0.5 ? C.clay : C.pine, 8);
        else k.cyl('paint', 0.13, 0.03, u + du, v + dv, y + 0.78, C.pine, 10);
      }
    }
  },
  stool(r: Room, level: number, u: number, v: number) {
    r.sink.cyl('paint', 0.17, 0.05, u, v, r.y(level) + 0.42, C.pine, 8);
    r.sink.cyl('paint', 0.03, 0.42, u, v, r.y(level), C.darkOak, 5);
  },
  bed(r: Room, level: number, u: number, v: number, ry: number, double = false, col = C.wool) {
    const k = r.sink, y = r.y(level), w = double ? 1.4 : 0.95, L = 2.0;
    k.box('paint', w, 0.36, L, u, v, y, ry, C.oak, true);
    k.box('paint', w - 0.06, 0.14, L - 0.1, u, v, y + 0.36, ry, C.linen);
    const [bu, bv] = rot(ry, 0, 0.25);
    k.box('paint', w - 0.04, 0.08, L * 0.6, u + bu, v + bv, y + 0.5, ry, col);
    const [hu, hv] = rot(ry, 0, -L / 2 + 0.05);
    k.box('paint', w + 0.06, 0.9, 0.08, u + hu, v + hv, y, ry, C.darkOak);
    const [pu, pv] = rot(ry, 0, -L / 2 + 0.3);
    k.box('paint', w * 0.7, 0.1, 0.32, u + pu, v + pv, y + 0.5, ry, C.linen);
    const [su, sv] = rot(ry, 0, -0.1);
    k.spot({ kind: 'bed', u: u + su, v: v + sv, level, y: y + 0.55, face: ry });
  },
  bunk(r: Room, level: number, u: number, v: number, ry: number) {
    const k = r.sink, y = r.y(level);
    for (const tier of [0, 1.15]) {
      k.box('paint', 0.9, 0.12, 1.95, u, v, y + 0.3 + tier, ry, C.pine, tier === 0);
      k.box('paint', 0.84, 0.1, 1.85, u, v, y + 0.42 + tier, ry, tier ? C.wool : C.linen);
    }
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const [du, dv] = rot(ry, a * 0.42, b * 0.94);
      k.box('paint', 0.07, 1.85, 0.07, u + du, v + dv, y, ry, C.darkOak);
    }
    k.spot({ kind: 'bed', u, v, level, y: y + 0.55, face: ry });
  },
  chest(r: Room, level: number, u: number, v: number, ry: number, col = C.oak) {
    const k = r.sink, y = r.y(level);
    k.box('paint', 0.9, 0.5, 0.5, u, v, y, ry, col, true);
    k.box('iron', 0.92, 0.05, 0.52, u, v, y + 0.42, ry, C.iron);
  },
  barrel(r: Room, level: number, u: number, v: number, s = 1) {
    const k = r.sink, y = r.y(level);
    k.cyl('paint', 0.3 * s, 0.85 * s, u, v, y, C.oak, 12, true, 0.27 * s);
    k.cyl('iron', 0.31 * s, 0.05, u, v, y + 0.15 * s, C.iron, 12);
    k.cyl('iron', 0.31 * s, 0.05, u, v, y + 0.65 * s, C.iron, 12);
  },
  crate(r: Room, level: number, u: number, v: number, s = 0.6) {
    r.sink.box('paint', s, s, s, u, v, r.y(level), r.rand() * 0.6, C.pine, true);
  },
  sack(r: Room, level: number, u: number, v: number, col = C.linen) {
    r.sink.cyl('paint', 0.26, 0.6, u, v, r.y(level), col, 8, false, 0.18);
  },
  /** Shelving against a wall with pots, jars, bread, ledgers... */
  shelf(r: Room, level: number, u: number, v: number, ry: number, len: number, h: number, stock: 'pots' | 'books' | 'bread' | 'candles' | 'cloth' | 'tools') {
    const k = r.sink, y = r.y(level);
    const n = Math.max(2, Math.floor(h / 0.5));
    for (const a of [-1, 1]) {
      const [du, dv] = rot(ry, a * len / 2, 0);
      k.box('paint', 0.06, h, 0.4, u + du, v + dv, y, ry, C.darkOak);
    }
    k.box('paint', len, h, 0.03, ...rot2(r, u, v, ry, 0, -0.19), y, ry, C.darkOak, true);
    for (let i = 0; i < n; i++) {
      const sy = y + 0.12 + i * (h - 0.15) / n;
      k.box('paint', len, 0.04, 0.38, u, v, sy, ry, C.pine);
      const items = Math.floor(len / 0.22);
      for (let j = 0; j < items; j++) {
        if (r.rand() < 0.3) continue;
        const along = -len / 2 + 0.12 + j * (len - 0.24) / Math.max(1, items - 1);
        const [du, dv] = rot(ry, along, (r.rand() - 0.5) * 0.12);
        const hh = (h - 0.15) / n - 0.08;
        if (stock === 'books') k.box('paint', 0.07 + r.rand() * 0.05, Math.min(hh, 0.24 + r.rand() * 0.08), 0.26, u + du, v + dv, sy + 0.04, ry, [C.red, C.leather, C.blue, C.green, C.darkOak, C.ochre][Math.floor(r.rand() * 6)]);
        else if (stock === 'bread') k.cyl('paint', 0.1, 0.08, u + du, v + dv, sy + 0.04, C.bread, 8, false, 0.07);
        else if (stock === 'candles') k.cyl('paint', 0.025, 0.2, u + du, v + dv, sy + 0.04, C.wax, 6);
        else if (stock === 'cloth') k.box('paint', 0.2, 0.12, 0.3, u + du, v + dv, sy + 0.04, ry, [C.red, C.blue, C.green, C.ochre, C.linen][Math.floor(r.rand() * 5)]);
        else if (stock === 'tools') k.box('iron', 0.05, Math.min(hh, 0.3), 0.04, u + du, v + dv, sy + 0.04, ry, C.iron);
        else k.cyl('paint', 0.06 + r.rand() * 0.04, Math.min(hh, 0.12 + r.rand() * 0.14), u + du, v + dv, sy + 0.04, r.rand() < 0.6 ? C.clay : C.stone, 8, false, 0.05);
      }
    }
  },
  /** A stone hearth against a wall: fire, hood and flue. Records the hearth for the light. */
  hearth(r: Room, level: number, u: number, v: number, ry: number, size = 1.6, big = false) {
    const k = r.sink, y = r.y(level);
    k.box('paint', size + 0.6, 0.3, 1.0, u, v, y, ry, C.stone, true);
    for (const a of [-1, 1]) {
      const [du, dv] = rot(ry, a * (size / 2 + 0.15), -0.05);
      k.box('paint', 0.3, 1.3, 0.9, u + du, v + dv, y, ry, C.stone, true);
    }
    const [hu, hv] = rot(ry, 0, -0.1);
    k.box('paint', size + 0.7, 0.35, 1.05, u + hu, v + hv, y + 1.3, ry, C.stone);
    const flueH = Math.max(0.5, r.b.top - y - 1.7);
    const [fu, fv] = rot(ry, 0, -0.25);
    k.box('paint', size * 0.8, flueH, 0.6, u + fu, v + fv, y + 1.65, ry, C.soot);
    const [bu, bv] = rot(ry, 0, -0.42);
    k.box('paint', size, 1.3, 0.06, u + bu, v + bv, y, ry, C.soot);
    // Fire: logs and a bed of coals.
    k.box('paint', size * 0.8, 0.1, 0.5, u, v, y + 0.3, ry, C.ash);
    for (let i = 0; i < 3; i++) {
      const [lu, lv] = rot(ry, (i - 1) * 0.22, 0.02);
      k.box('paint', 0.12, 0.12, 0.55, u + lu, v + lv, y + 0.38, ry + (i - 1) * 0.3, C.darkOak);
    }
    k.box('fire', size * 0.55, 0.14, 0.32, u, v, y + 0.4, ry, 0xffffff);
    k.box('flame', size * 0.35, big ? 0.6 : 0.42, 0.04, u, v, y + 0.48, ry, 0xffffff);
    if (big) {
      const [cu, cv] = rot(ry, 0, 0.0);
      k.cyl('iron', 0.28, 0.4, u + cu, v + cv, y + 0.55, C.black, 12, false, 0.34); // cauldron
    }
    if (!r.plan.hearth) r.plan.hearth = { u, v, y: y + 0.6 };
    const [su, sv] = rot(ry, 0.6, 1.2);
    k.spot({ kind: 'hearth', u: u + su, v: v + sv, level, y, face: ry + Math.PI });
  },
  candle(r: Room, level: number, u: number, v: number, yOff: number) {
    r.sink.cyl('paint', 0.03, 0.14, u, v, r.y(level) + yOff, C.wax, 6);
    r.sink.box('flame', 0.025, 0.05, 0.025, u, v, r.y(level) + yOff + 0.14, 0, 0xffffff);
  },
  rug(r: Room, level: number, u: number, v: number, w: number, d: number, ry: number) {
    r.sink.box('paint', w, 0.015, d, u, v, r.y(level) + 0.005, ry, [C.red, C.blue, C.ochre, C.green][Math.floor(r.rand() * 4)]);
  },
  desk(r: Room, level: number, u: number, v: number, ry: number, task = 'write') {
    const k = r.sink, y = r.y(level);
    k.box('paint', 1.3, 0.05, 0.7, u, v, y + 0.76, ry, C.oak, true);
    k.box('paint', 1.25, 0.76, 0.06, ...rot2(r, u, v, ry, 0, -0.3), y, ry, C.darkOak);
    for (const a of [-1, 1]) k.box('paint', 0.06, 0.76, 0.66, ...rot2(r, u, v, ry, a * 0.6, 0), y, ry, C.darkOak);
    // Ledger, inkpot and a candle.
    k.box('paint', 0.42, 0.04, 0.3, ...rot2(r, u, v, ry, -0.1, 0.05), y + 0.81, ry + 0.1, C.paper);
    k.cyl('paint', 0.035, 0.06, ...rot2(r, u, v, ry, 0.38, -0.12), y + 0.81, C.black, 8);
    F.candle(r, level, ...rot2(r, u, v, ry, -0.5, -0.15), 0.81);
    const [su, sv] = rot(ry, 0, 0.62);
    F.stool(r, level, u + su, v + sv);
    k.spot({ kind: 'desk', u: u + su, v: v + sv, level, y: y + 0.45, face: ry + Math.PI, task });
  },
};
/** u, v of a point offset (du, dv) from (u, v) in a frame turned by ry. */
function rot2(_r: Room, u: number, v: number, ry: number, du: number, dv: number): [number, number] {
  const [a, b] = rot(ry, du, dv);
  return [u + a, v + b];
}

// ------------------------------------------------------------------ shell: floors, stairs, ceilings
const SINGLE: BuildingKind[] = ['smithy', 'stable', 'kitchen', 'bakehouse', 'store', 'hallOfCinders', 'forgeHall', 'vaultStair', 'keep'];

export function levelsFor(b: Building): number[] {
  const H = b.top - b.fy;
  if (SINGLE.includes(b.kind) || H < 5.6) return [0];
  if (b.kind === 'swornHall') return H > 9 ? [0, 6.0] : [0];
  const out = [0];
  for (let y = 3.1; H - y >= 2.4; y += 3.1) out.push(y);
  return out;
}

function shell(r: Room) {
  const b = r.b, k = r.sink, plan = r.plan, L = plan.levels;
  const stoneFloor = b.stone && (b.kind !== 'swornHouse' && b.kind !== 'house' && b.kind !== 'records');
  const e0 = r.ext(0);
  // Ground floor: boards, flags or straw.
  const floorCol = b.kind === 'stable' ? C.straw : stoneFloor ? C.flag : C.plank;
  k.box('paint', e0.u1 - e0.u0, 0.03, e0.v1 - e0.v0, (e0.u0 + e0.u1) / 2, (e0.v0 + e0.v1) / 2, r.y(0) - 0.02, 0, floorCol);
  // Keep the way in clear.
  r.take({ u0: b.door.u - 0.9, u1: b.door.u + 0.9, v0: e0.v1 - 2.2, v1: e0.v1 + 0.5, level: 0 });
  // Stairs between levels, along the back wall, switching ends each flight.
  for (let i = 0; i + 1 < L.length; i++) {
    const rise = L[i + 1] - L[i];
    const n = Math.round(rise / 0.2), run = n * 0.23;
    const e = r.ext(i);
    const fwd = i % 2 === 0 ? 1 : -1;
    const u0 = fwd > 0 ? e.u0 + 1.1 : e.u1 - 1.1;
    const u1 = u0 + fwd * run;
    const v = e.v0 + 0.5;
    const y0 = r.y(i);
    for (let s = 0; s < n; s++) {
      const uu = u0 + fwd * (s + 0.5) * 0.23;
      k.box('paint', 0.23, (s + 1) * (rise / n), 0.95, uu, v, y0, 0, s % 2 ? C.oak : C.darkOak);
    }
    k.ramp(run, 0.95, (u0 + u1) / 2, v, y0 + rise / 2 - 0.04, Math.atan2(rise, run) * fwd);
    // A rail.
    k.box('paint', 0.05, 0.05, 0.05, u1, v + 0.5, y0 + rise, 0, C.darkOak);
    plan.stairs.push({ level: i, u0, u1, v });
    // Keep the flight and the foot of it clear (the approach runs from the wall corner).
    r.take({ u0: Math.min(u0, u1) - (fwd > 0 ? 1.2 : 0.3), u1: Math.max(u0, u1) + (fwd > 0 ? 0.3 : 1.2), v0: e.v0 - 0.1, v1: v + 1.1, level: i });
  }
  // Upper floors: board slabs with a stairwell over the flight that arrives there.
  for (let i = 1; i < L.length; i++) {
    const e = r.ext(i), st = plan.stairs[i - 1];
    const y = r.y(i) - 0.2;
    const lo = Math.min(st.u0, st.u1), hi = Math.max(st.u0, st.u1);
    const holeU0 = st.u1 > st.u0 ? lo + (hi - lo) * 0.25 : lo - 0.2, holeU1 = st.u1 > st.u0 ? hi + 0.2 : lo + (hi - lo) * 0.75;
    const holeV1 = st.v + 0.55;
    const slab = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.05 || v1 - v0 < 0.05) return;
      k.box('paint', u1 - u0, 0.2, v1 - v0, (u0 + u1) / 2, (v0 + v1) / 2, y, 0, C.plank, true);
    };
    slab(e.u0, e.u1, holeV1, e.v1);
    slab(e.u0, holeU0, e.v0, holeV1);
    slab(holeU1, e.u1, e.v0, holeV1);
    // Joists under the floor, read as the ground floor's ceiling.
    for (let u = e.u0 + 0.4; u < e.u1; u += 0.9) {
      if (u > holeU0 && u < holeU1) continue;
      k.box('paint', 0.14, 0.18, e.v1 - e.v0, u, (e.v0 + e.v1) / 2, y - 0.18, 0, C.darkOak);
    }
    r.take({ u0: holeU0 - 0.2, u1: holeU1 + 0.2, v0: e.v0, v1: holeV1 + 0.6, level: i });
  }
  // The ceiling under the roof, with beams.
  const et = r.ext(L.length - 1);
  const ceil = b.top - 0.05;
  k.box('paint', et.u1 - et.u0, 0.05, et.v1 - et.v0, (et.u0 + et.u1) / 2, (et.v0 + et.v1) / 2, ceil, 0, C.darkOak);
  for (let u = et.u0 + 0.5; u < et.u1; u += 1.6) k.box('paint', 0.22, 0.24, et.v1 - et.v0, u, (et.v0 + et.v1) / 2, ceil - 0.24, 0, C.oak);
  // Lime-washed (or bare stone) linings on the inside of the walls, each storey.
  const lineCol = b.stone ? 0x8f8676 : C.plaster;
  for (let i = 0; i < L.length; i++) {
    const e = r.ext(i);
    const y0 = r.y(i) - 0.02, y1 = i + 1 < L.length ? r.y(i + 1) - 0.2 : b.top - 0.05;
    const H = y1 - y0, cu = (e.u0 + e.u1) / 2, cv = (e.v0 + e.v1) / 2, LW = e.u1 - e.u0, LD = e.v1 - e.v0;
    k.box('paint', LW, H, 0.01, cu, e.v0 + 0.005, y0, 0, lineCol);
    k.box('paint', 0.01, H, LD, e.u0 + 0.005, cv, y0, 0, lineCol);
    k.box('paint', 0.01, H, LD, e.u1 - 0.005, cv, y0, 0, lineCol);
    if (i === 0) {
      const d0 = b.door.u - b.door.w / 2, d1 = b.door.u + b.door.w / 2;
      if (d0 > e.u0) k.box('paint', d0 - e.u0, H, 0.01, (e.u0 + d0) / 2, e.v1 - 0.005, y0, 0, lineCol);
      if (e.u1 > d1) k.box('paint', e.u1 - d1, H, 0.01, (d1 + e.u1) / 2, e.v1 - 0.005, y0, 0, lineCol);
      const dt = b.fy + b.door.h;
      if (y1 > dt) k.box('paint', d1 - d0, y1 - dt, 0.01, b.door.u, e.v1 - 0.005, dt, 0, lineCol);
    } else k.box('paint', LW, H, 0.01, cu, e.v1 - 0.005, y0, 0, lineCol);
    // A darker skirting of wear along the floor.
    for (const [w, d, u, v] of [[LW, 0.02, cu, e.v0 + 0.012], [0.02, LD, e.u0 + 0.012, cv], [0.02, LD, e.u1 - 0.012, cv]] as number[][]) k.box('paint', w, 0.18, d, u, v, y0, 0, C.darkOak);
  }
  // Daylight at the windows (panels on the inside face that glow with the sky).
  for (const w of b.windows) {
    const lev = Math.min(w.floor, L.length - 1);
    if (w.floor >= L.length && L.length === 1 && w.y > b.top - 0.4) continue;
    const e = r.ext(w.floor > 0 ? Math.min(lev, L.length - 1) : 0);
    const v = w.v > 0 ? e.v1 - 0.01 : e.v0 + 0.01;
    const sv = w.v > 0 ? -1 : 1;
    k.box('day', 0.7, 1.0, 0.02, w.u, v + sv * 0.01, w.y + 0.02, 0, 0xffffff);
    // Frame, mullion and transom.
    k.box('paint', 0.86, 0.07, 0.06, w.u, v + sv * 0.03, w.y - 0.03, 0, C.darkOak);
    k.box('paint', 0.86, 0.07, 0.06, w.u, v + sv * 0.03, w.y + 1.03, 0, C.darkOak);
    for (const a of [-0.4, 0, 0.4]) k.box('paint', a === 0 ? 0.04 : 0.07, 1.06, 0.05, w.u + a, v + sv * 0.03, w.y, 0, C.darkOak);
    k.box('paint', 0.8, 0.04, 0.05, w.u, v + sv * 0.03, w.y + 0.55, 0, C.darkOak);
    k.box('paint', 0.9, 0.05, 0.22, w.u, v + sv * 0.1, w.y - 0.06, 0, C.oak);
  }
}

// ------------------------------------------------------------------ rooms by kind
function furnish(r: Room) {
  const b = r.b, plan = r.plan, L = plan.levels, rand = r.rand;
  const e = r.ext(0);
  const hearthAt = (level: number, big = false, size = 1.6): boolean => {
    // Under the chimney if there is one (on the nearer of the back or side walls), else on the back wall.
    const ch = b.chimney;
    const ee = r.ext(level);
    let u = ch ? Math.max(ee.u0 + size, Math.min(ee.u1 - size, ch.u)) : (rand() < 0.5 ? -1 : 1) * (ee.u1 - ee.u0) * 0.25;
    for (let k = 0; k < 8; k++) {
      const base = { u0: u - (size + 0.8) / 2 - 0.05, u1: u + (size + 0.8) / 2 + 0.05, v0: ee.v0 + 0.5 - 0.6, v1: ee.v0 + 0.5 + 0.6, level };
      // The flue rises through every floor above, so it needs room there too.
      const flues = L.map((_, lv) => ({ u0: u - size * 0.45, u1: u + size * 0.45, v0: r.ext(lv).v0, v1: r.ext(lv).v0 + 0.7, level: lv })).filter((f) => f.level > level);
      if (r.fits(base) && flues.every((f) => r.fits(f))) {
        r.take(base); for (const f of flues) r.take(f);
        F.hearth(r, level, u, ee.v0 + 0.5, 0, size, big);
        return true;
      }
      u = ee.u0 + size + rand() * Math.max(0, ee.u1 - ee.u0 - 2 * size);
    }
    return false;
  };
  const tableMid = (level: number, len: number, wid: number) => {
    const ee = r.ext(level);
    const along = (ee.u1 - ee.u0) > (ee.v1 - ee.v0);
    const tw = along ? len : wid, td = along ? wid : len;
    const p = r.inMiddle(level, tw + 0.9, td + 1.3);
    if (p) F.table(r, level, p.u, p.v, len, wid, along ? 0 : Math.PI / 2, true);
  };
  const scatter = (level: number, n: number, what: 'barrel' | 'crate' | 'sack' | 'chest') => {
    for (let i = 0; i < n; i++) {
      const s = what === 'chest' ? [0.9, 0.5] : what === 'sack' ? [0.55, 0.55] : what === 'barrel' ? [0.65, 0.65] : [0.65, 0.65];
      const p = r.againstWall(level, s[0], s[1]);
      if (!p) continue;
      if (what === 'barrel') F.barrel(r, level, p.u, p.v);
      else if (what === 'crate') F.crate(r, level, p.u, p.v);
      else if (what === 'sack') F.sack(r, level, p.u, p.v);
      else F.chest(r, level, p.u, p.v, p.ry);
    }
  };
  const beds = (level: number, n: number, double = false) => {
    let made = 0;
    for (let i = 0; i < n * 3 && made < n; i++) {
      const p = r.againstWall(level, double ? 1.6 : 1.15, 2.15);
      if (!p) continue;
      F.bed(r, level, ...rot2(r, p.u, p.v, p.ry, 0, 0), p.ry, double);
      made++;
    }
    return made;
  };
  const shelves = (level: number, n: number, stock: Parameters<typeof F.shelf>[7], h = 1.8) => {
    for (let i = 0; i < n; i++) {
      const len = 1.2 + rand() * 0.8;
      const p = r.againstWall(level, len + 0.1, 0.45);
      if (p) F.shelf(r, level, p.u, p.v, p.ry, len, h, stock);
    }
  };
  const top = L.length - 1;
  switch (b.kind) {
    case 'house': case 'swornHouse': case 'bakery': case 'chandlery': case 'weaver': case 'cooper': {
      hearthAt(0, true);
      tableMid(0, Math.min(2.4, (e.u1 - e.u0) * 0.4), 0.85);
      shelves(0, 1, 'pots');
      if (b.kind === 'swornHouse') { const p = r.inMiddle(0, 2.4, 1.6); if (p) F.rug(r, 0, p.u, p.v, 2.2, 1.4, 0); }
      // The trade, on the ground floor.
      if (b.kind === 'bakery') {
        const p = r.againstWall(0, 2.0, 1.6);
        if (p) { oven(r, 0, p.u, p.v, p.ry); }
        shelves(0, 2, 'bread', 1.5); scatter(0, 3, 'sack');
        const q = r.inMiddle(0, 2.0, 0.9); if (q) { workTable(r, 0, q.u, q.v, 0, 'knead'); }
      } else if (b.kind === 'chandlery') {
        shelves(0, 2, 'candles', 1.6);
        const q = r.inMiddle(0, 2.0, 0.9); if (q) workTable(r, 0, q.u, q.v, 0, 'dip');
        const p = r.againstWall(0, 0.8, 0.8); if (p) r.sink.cyl('iron', 0.35, 0.7, p.u, p.v, r.y(0), C.black, 12, true);
      } else if (b.kind === 'weaver') {
        for (let i = 0; i < 2; i++) { const p = r.againstWall(0, 1.8, 1.4); if (p) loom(r, 0, p.u, p.v, p.ry); }
        shelves(0, 1, 'cloth', 1.6); scatter(0, 2, 'sack');
      } else if (b.kind === 'cooper') {
        for (let i = 0; i < 4; i++) { const p = r.inMiddle(0, 0.8, 0.8); if (p) F.barrel(r, 0, p.u, p.v, 0.9 + rand() * 0.2); }
        const q = r.inMiddle(0, 2.0, 0.9); if (q) workTable(r, 0, q.u, q.v, 0, 'hammer');
        scatter(0, 2, 'crate');
      } else {
        scatter(0, 2, rand() < 0.5 ? 'barrel' : 'crate');
        scatter(0, 1, 'sack');
      }
      // Beds: upstairs if there is an upstairs, else round the walls downstairs.
      const people = Math.max(2, b.beds);
      if (top === 0) { beds(0, Math.min(3, Math.ceil(people / 2)), true); scatter(0, 1, 'chest'); }
      else {
        let left = people;
        for (let lv = 1; lv <= top && left > 0; lv++) {
          left -= beds(lv, 1, true) * 2;
          left -= beds(lv, Math.min(3, Math.max(0, left)), false);
          scatter(lv, 2, 'chest');
          if (b.kind === 'swornHouse') { const p = r.inMiddle(lv, 2, 1.4); if (p) F.rug(r, lv, p.u, p.v, 2, 1.3, 0); }
        }
      }
      break;
    }
    case 'inn': {
      hearthAt(0, true, 2.0);
      // The counter, with casks behind.
      const p = r.againstWall(0, 3.2, 1.6);
      if (p) {
        const [cu, cv] = rot2(r, p.u, p.v, p.ry, 0, 0.25);
        r.sink.box('paint', 3.0, 1.05, 0.55, cu, cv, r.y(0), p.ry, C.darkOak, true);
        r.sink.box('paint', 3.1, 0.06, 0.65, cu, cv, r.y(0) + 1.05, p.ry, C.oak);
        for (let i = 0; i < 3; i++) { const [bu, bv] = rot2(r, p.u, p.v, p.ry, -1.0 + i, -0.45); F.barrel(r, 0, bu, bv, 0.8); }
        const [su, sv] = rot2(r, p.u, p.v, p.ry, 0, -0.15);
        r.sink.spot({ kind: 'serve', u: su, v: sv, level: 0, y: r.y(0), face: p.ry, task: 'serve' });
      }
      for (let i = 0; i < 4; i++) {
        const q = r.inMiddle(0, 2.3, 1.9);
        if (q) F.table(r, 0, q.u, q.v, 1.5, 0.8, rand() < 0.5 ? 0 : Math.PI / 2, true);
      }
      if (top > 0) for (let lv = 1; lv <= top; lv++) { beds(lv, 3); scatter(lv, 1, 'chest'); }
      else beds(0, 1);
      break;
    }
    case 'smithy': {
      // The forge: a raised hearth with a hood, bellows, anvil, quench trough, racks of tools and bar.
      const p = r.againstWall(0, 2.4, 1.6) ?? { u: 0, v: e.v0 + 0.8, ry: 0 };
      forge(r, 0, p.u, p.v, p.ry);
      const [au, av] = rot2(r, p.u, p.v, p.ry, 0.2, 1.9);
      anvil(r, 0, au, av, p.ry);
      const q = r.againstWall(0, 1.6, 0.6); if (q) trough(r, 0, q.u, q.v, q.ry);
      shelves(0, 2, 'tools', 1.7);
      const w = r.inMiddle(0, 2.0, 0.9); if (w) workTable(r, 0, w.u, w.v, 0, 'file');
      scatter(0, 2, 'barrel');
      const c = r.againstWall(0, 1.2, 1.0); if (c) r.sink.cyl('paint', 0.6, 0.45, c.u, c.v, r.y(0), C.coal, 10, false, 0.15);
      break;
    }
    case 'stable': {
      // Stalls along the back wall, hay and troughs, saddles by the door.
      const stalls = Math.floor((e.u1 - e.u0) / 3.0);
      for (let i = 0; i < stalls; i++) {
        const u = e.u0 + (i + 0.5) * ((e.u1 - e.u0) / stalls);
        if (Math.abs(u - b.door.u) < 1.6) continue;
        const depth = Math.min(3.2, (e.v1 - e.v0) * 0.55);
        if (!r.claim(0, u, e.v0 + depth / 2, 2.8, depth, 0)) continue;
        for (const a of [-1, 1]) r.sink.box('paint', 0.08, 1.3, depth, u + a * 1.45, e.v0 + depth / 2, r.y(0), 0, C.darkOak, true);
        r.sink.box('paint', 1.4, 0.4, 0.45, u, e.v0 + 0.3, r.y(0) + 0.5, 0, C.oak);
        r.sink.box('paint', 2.4, 0.25, depth * 0.6, u, e.v0 + depth * 0.4, r.y(0), 0, C.hay);
        r.sink.spot({ kind: 'work', u, v: e.v0 + depth + 0.4, level: 0, y: r.y(0), face: Math.PI, task: 'brush' });
      }
      for (let i = 0; i < 3; i++) { const p = r.againstWall(0, 1.1, 0.6); if (p) r.sink.box('paint', 1.0, 0.5, 0.5, p.u, p.v, r.y(0), p.ry + rand() * 0.2, C.hay, true); }
      for (let i = 0; i < 2; i++) { const p = r.againstWall(0, 0.8, 0.5); if (p) { r.sink.box('paint', 0.7, 0.9, 0.08, p.u, p.v, r.y(0), p.ry, C.darkOak); r.sink.box('paint', 0.5, 0.25, 0.4, p.u, p.v, r.y(0) + 0.9, p.ry, C.leather); } }
      break;
    }
    case 'barracks': {
      hearthAt(0, true, 1.8);
      tableMid(0, 4.5, 0.9);
      for (let lv = 0; lv <= top; lv++) {
        for (let i = 0; i < 12; i++) { const p = r.againstWall(lv, 1.0, 2.05); if (p) { F.bunk(r, lv, p.u, p.v, p.ry); } }
        scatter(lv, 3, 'chest');
      }
      for (let i = 0; i < 2; i++) { const p = r.againstWall(0, 1.6, 0.4); if (p) weaponRack(r, 0, p.u, p.v, p.ry); }
      break;
    }
    case 'hallOfCinders': hallOfCinders(r); break;
    case 'keep': {
      // The guard hall at the foot of the keep: a fire, a table, the racks, and the stair up.
      hearthAt(0, false, 2.2);
      tableMid(0, 3.6, 1.0);
      for (let i = 0; i < 3; i++) { const p = r.againstWall(0, 1.6, 0.4); if (p) weaponRack(r, 0, p.u, p.v, p.ry); }
      scatter(0, 3, 'chest');
      const ee = r.ext(0);
      // A stone stair climbing the wall to a shut door: the lord's floors above.
      for (let i = 0; i < 14; i++) r.sink.box('paint', 0.3, 0.2 * (i + 1), 1.2, ee.u1 - 1.0 - i * 0.3, ee.v0 + 0.7, r.y(0), 0, C.stone, true);
      r.sink.box('paint', 1.0, 2.1, 0.1, ee.u1 - 0.6 - 14 * 0.3, ee.v0 + 0.06, r.y(0) + 2.8, 0, C.darkOak);
      break;
    }
    case 'swornHall': {
      hearthAt(0, false, 2.4);
      // The long table and the high seat.
      const ee = r.ext(0);
      const len = Math.min(10, (ee.u1 - ee.u0) * 0.5);
      if (r.claim(0, 0, (ee.v0 + ee.v1) / 2 + 0.6, len + 1.2, 2.4)) F.table(r, 0, 0, (ee.v0 + ee.v1) / 2 + 0.6, len, 1.1, 0, true, C.darkOak);
      const hs = ee.u0 + 1.2;
      if (r.claim(0, hs, (ee.v0 + ee.v1) / 2 + 0.6, 1.2, 1.2)) {
        r.sink.box('paint', 0.9, 0.5, 0.8, hs, (ee.v0 + ee.v1) / 2 + 0.6, r.y(0), 0, C.darkOak, true);
        r.sink.box('paint', 0.9, 1.6, 0.12, hs - 0.4, (ee.v0 + ee.v1) / 2 + 0.6, r.y(0), Math.PI / 2, C.darkOak);
      }
      for (let i = 0; i < 3; i++) { const p = r.againstWall(0, 1.2, 0.08); if (p) r.sink.box('paint', 1.1, 2.2, 0.03, p.u, p.v, r.y(0) + 1.4, p.ry, [C.red, C.blue, C.green][i % 3]); }
      scatter(0, 3, 'chest');
      if (b.household === 'Vhassarin') { cipherRoom(r, Math.min(1, top)); if (top > 0) { beds(top, 3); scatter(top, 2, 'chest'); } }
      else for (let lv = 1; lv <= top; lv++) { beds(lv, 4); scatter(lv, 2, 'chest'); shelves(lv, 1, 'books'); }
      break;
    }
    case 'kitchen': {
      hearthAt(0, true, 2.4);
      hearthAt(0, true, 1.8);
      for (let i = 0; i < 2; i++) { const q = r.inMiddle(0, 3.0, 1.2); if (q) workTable(r, 0, q.u, q.v, 0, 'chop', 2.6); }
      shelves(0, 3, 'pots'); scatter(0, 3, 'sack'); scatter(0, 3, 'barrel');
      break;
    }
    case 'bakehouse': {
      for (let i = 0; i < 2; i++) { const p = r.againstWall(0, 2.0, 1.6); if (p) oven(r, 0, p.u, p.v, p.ry); }
      for (let i = 0; i < 2; i++) { const q = r.inMiddle(0, 2.4, 1.0); if (q) workTable(r, 0, q.u, q.v, 0, 'knead', 2.2); }
      shelves(0, 3, 'bread', 1.5); scatter(0, 4, 'sack');
      break;
    }
    case 'store': {
      for (let i = 0; i < 5; i++) shelves(0, 1, rand() < 0.5 ? 'pots' : 'cloth', 2.2);
      scatter(0, 6, 'sack'); scatter(0, 5, 'barrel'); scatter(0, 4, 'crate');
      break;
    }
    case 'servants': {
      hearthAt(0, true);
      tableMid(0, 3.5, 0.9);
      for (let lv = 0; lv <= top; lv++) { for (let i = 0; i < 8; i++) { const p = r.againstWall(lv, 1.0, 2.05); if (p) F.bunk(r, lv, p.u, p.v, p.ry); } scatter(lv, 3, 'chest'); }
      break;
    }
    case 'records': {
      hearthAt(0, false, 1.4);
      for (let lv = 0; lv <= top; lv++) {
        shelves(lv, 6, 'books', 2.4);
        for (let i = 0; i < 3; i++) { const q = r.inMiddle(lv, 1.5, 1.6); if (q) F.desk(r, lv, q.u, q.v, 0, 'write'); }
        scatter(lv, 2, 'chest');
      }
      break;
    }
    case 'familyWing': case 'nurseryWing': {
      hearthAt(0, false, 2.0);
      tableMid(0, 3.0, 1.0);
      for (let i = 0; i < 2; i++) { const p = r.inMiddle(0, 2.4, 1.6); if (p) F.rug(r, 0, p.u, p.v, 2.2, 1.4, 0); }
      for (let lv = 1; lv <= top; lv++) {
        beds(lv, 2, true);
        if (b.kind === 'nurseryWing') { const p = r.inMiddle(lv, 1.2, 0.8); if (p) cradle(r, lv, p.u, p.v); }
        scatter(lv, 2, 'chest');
        const p = r.inMiddle(lv, 2.4, 1.6); if (p) F.rug(r, lv, p.u, p.v, 2.2, 1.4, 0);
      }
      break;
    }
    case 'forgeHall': {
      for (let i = 0; i < 3; i++) {
        const p = r.againstWall(0, 2.4, 1.6);
        if (!p) continue;
        forge(r, 0, p.u, p.v, p.ry);
        const [au, av] = rot2(r, p.u, p.v, p.ry, 0.2, 1.9);
        anvil(r, 0, au, av, p.ry);
      }
      for (let i = 0; i < 2; i++) { const q = r.againstWall(0, 1.6, 0.6); if (q) trough(r, 0, q.u, q.v, q.ry); }
      shelves(0, 3, 'tools', 2.0); scatter(0, 4, 'crate'); scatter(0, 3, 'barrel');
      break;
    }
    case 'vaultStair': {
      // A bare stone room over a barred stair (the vault itself stays shut).
      const ee = r.ext(0);
      r.sink.box('iron', 2.0, 0.12, 2.6, 0, (ee.v0 + ee.v1) / 2 - 0.5, r.y(0), 0, C.iron, true);
      for (let i = 0; i < 6; i++) r.sink.box('iron', 0.06, 0.1, 2.6, -0.85 + i * 0.34, (ee.v0 + ee.v1) / 2 - 0.5, r.y(0) + 0.12, 0, C.black);
      break;
    }
  }
}

// ------------------------------------------------------------------ the Hall of Cinders
/**
 * Emberhold's council hall, by hand: a long hall of stone pillars with the dais and the high
 * seat at the far end, two long tables down the middle, hearths in the side walls, the house's
 * red hung between the pillars, and the great carved beam across the hall before the dais.
 */
function hallOfCinders(r: Room) {
  const k = r.sink, y = r.y(0), e = r.ext(0);
  const W = e.u1 - e.u0, back = e.v0, front = e.v1;
  // Flagged aisle.
  k.box('paint', 4, 0.02, front - back - 2, 0, (front + back) / 2, y, 0, C.stone);
  // Pillars in two rows, and red hangings between them.
  for (let v = back + 9; v < front - 4; v += 6) {
    for (const su of [-1, 1]) {
      k.cyl('paint', 0.55, r.b.top - y, su * 7.5, v, y, 0x8f8676, 12, true);
      k.cyl('paint', 0.75, 0.5, su * 7.5, v, y, 0x6f685d, 12);
      r.take({ u0: su * 7.5 - 0.9, u1: su * 7.5 + 0.9, v0: v - 0.9, v1: v + 0.9, level: 0 });
    }
    if (v + 3 < front - 4) for (const su of [-1, 1]) k.box('paint', 0.05, 5.5, 2.2, su * 7.5, v + 3, y + 7, 0, C.red);
  }
  // The dais and the high seat.
  const dv = back + 3.0;
  k.box('paint', 11, 0.45, 4.6, 0, dv, y, 0, C.stone, true);
  k.box('paint', 11.2, 0.05, 4.8, 0, dv, y + 0.45, 0, C.red);
  r.take({ u0: -5.8, u1: 5.8, v0: back, v1: dv + 2.6, level: 0 });
  const seat = (u: number, big: boolean) => {
    const sy = y + 0.5;
    k.box('paint', big ? 1.1 : 0.8, 0.5, big ? 0.9 : 0.7, u, dv - 0.6, sy, 0, C.darkOak, true);
    k.box('paint', big ? 1.1 : 0.8, big ? 2.4 : 1.4, 0.14, u, dv - 1.05, sy, 0, C.darkOak);
    if (big) k.box('paint', 1.25, 0.25, 0.2, u, dv - 1.05, sy + 2.4, 0, C.red);
    k.spot({ kind: big ? 'seat' : 'sit', u, v: dv - 0.45, level: 0, y: sy, face: 0 });
  };
  seat(0, true); seat(-2.2, false); seat(2.2, false);
  // Two long tables down the hall.
  for (const su of [-1, 1]) {
    const len = 16, tv = back + 9 + len / 2 + 2;
    F.table(r, 0, su * 3.3, tv, len, 1.1, Math.PI / 2, true, C.darkOak);
    r.take({ u0: su * 3.3 - 1.4, u1: su * 3.3 + 1.4, v0: tv - len / 2 - 0.5, v1: tv + len / 2 + 0.5, level: 0 });
  }
  // Hearths in the side walls.
  for (const su of [-1, 1]) {
    const u = su < 0 ? e.u0 + 0.5 : e.u1 - 0.5;
    F.hearth(r, 0, u, back + 18, su < 0 ? Math.PI / 2 : -Math.PI / 2, 2.6);
  }
  // Candle stands either side of the dais, and braziers down the aisle.
  for (const su of [-1, 1]) {
    k.cyl('iron', 0.05, 1.5, su * 4.6, dv + 2.0, y, C.iron, 6);
    for (let i = 0; i < 3; i++) F.candle(r, 0, su * 4.6 + (i - 1) * 0.12, dv + 2.0, 1.5);
  }
  for (let v = back + 12; v < front - 6; v += 12) {
    k.cyl('iron', 0.4, 0.25, 0, v, y + 0.75, C.black, 12);
    k.cyl('iron', 0.06, 0.75, 0, v, y, C.iron, 6);
    k.box('fire', 0.5, 0.1, 0.5, 0, v, y + 0.95, 0, 0xffffff);
    k.box('flame', 0.35, 0.5, 0.04, 0, v, y + 1.0, 0.7, 0xffffff);
  }
  // The great beam across the hall before the dais (its words are cut into the face; see HALL_BEAM).
  k.box('paint', W, 0.75, 0.7, 0, back + 7.5, y + 8, 0, C.darkOak);
  for (const su of [-1, 1]) k.box('paint', 0.6, 1.4, 1.4, su * (W / 2 - 0.3), back + 7.5, y + 7.4, 0, C.darkOak);
  // People standing about the hall.
  for (let i = 0; i < 6; i++) k.spot({ kind: 'stand', u: (i % 2 ? -1 : 1) * (5 + (i % 3)), v: back + 12 + i * 5, level: 0, y, face: (i % 2 ? 1 : -1) * Math.PI / 2 });
}

/** The words carved into the great beam of the Hall of Cinders (from the Story Bible). */
export const HALL_BEAM = 'THE BLOOD DOES NOT LEAVE THE BLOOD';

// ------------------------------------------------------------------ trade furniture
function workTable(r: Room, level: number, u: number, v: number, ry: number, task: string, len = 1.8) {
  F.table(r, level, u, v, len, 0.8, ry, false, C.pine);
  for (const sd of [-1, 1]) {
    const [su, sv] = rot(ry, sd * len * 0.25, 0.75);
    r.sink.spot({ kind: 'work', u: u + su, v: v + sv, level, y: r.y(level), face: ry + Math.PI, task });
  }
  const [iu, iv] = rot(ry, 0.2, 0);
  if (task === 'knead') r.sink.box('paint', 0.5, 0.1, 0.35, u + iu, v + iv, r.y(level) + 0.78, ry, C.flour);
  else if (task === 'chop') r.sink.box('paint', 0.5, 0.06, 0.3, u + iu, v + iv, r.y(level) + 0.78, ry, C.pine);
  else if (task === 'dip') for (let i = 0; i < 5; i++) r.sink.cyl('paint', 0.02, 0.22, u + iu + i * 0.06, v + iv, r.y(level) + 0.78, C.wax, 5);
}

function oven(r: Room, level: number, u: number, v: number, ry: number) {
  const k = r.sink, y = r.y(level);
  k.box('paint', 1.8, 0.9, 1.4, u, v, y, ry, C.stone, true);
  k.cyl('paint', 0.75, 0.6, u, v, y + 0.9, C.clay, 14, false, 0.3);
  const [fu, fv] = rot(ry, 0, 0.71);
  k.box('fire', 0.5, 0.3, 0.02, u + fu, v + fv, y + 0.95, ry, 0xffffff);
  const [su, sv] = rot(ry, 0.3, 1.4);
  k.spot({ kind: 'work', u: u + su, v: v + sv, level, y, face: ry + Math.PI, task: 'bake' });
}

function loom(r: Room, level: number, u: number, v: number, ry: number) {
  const k = r.sink, y = r.y(level);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const [du, dv] = rot(ry, a * 0.8, b * 0.55);
    k.box('paint', 0.08, 1.6, 0.08, u + du, v + dv, y, ry, C.oak);
  }
  k.box('paint', 1.6, 0.06, 1.1, u, v, y + 1.6, ry, C.oak, true);
  k.box('paint', 1.4, 0.9, 0.02, u, v, y + 0.6, ry, [C.red, C.blue, C.ochre, C.linen][Math.floor(r.rand() * 4)]);
  const [su, sv] = rot(ry, 0, 0.95);
  F.stool(r, level, u + su, v + sv);
  k.spot({ kind: 'work', u: u + su, v: v + sv, level, y: y + 0.45, face: ry + Math.PI, task: 'weave' });
}

function forge(r: Room, level: number, u: number, v: number, ry: number) {
  const k = r.sink, y = r.y(level);
  k.box('paint', 1.8, 0.85, 1.3, u, v, y, ry, C.stone, true);
  k.box('fire', 0.9, 0.08, 0.6, u, v, y + 0.85, ry, 0xffffff);
  k.box('flame', 0.5, 0.25, 0.05, u, v, y + 0.9, ry, 0xffffff);
  const [hu, hv] = rot(ry, 0, -0.15);
  k.box('paint', 1.9, 0.6, 1.1, u + hu, v + hv, y + 2.1, ry, C.soot);
  k.box('paint', 0.9, Math.max(0.5, r.b.top - y - 2.7), 0.7, u + hu, v + hv, y + 2.7, ry, C.soot);
  const [bu, bv] = rot(ry, -1.2, 0);
  k.box('paint', 0.6, 0.35, 0.9, u + bu, v + bv, y + 0.5, ry, C.leather); // bellows
  if (!r.plan.hearth) r.plan.hearth = { u, v, y: y + 1.0 };
  const [su, sv] = rot(ry, -0.9, 1.0);
  k.spot({ kind: 'work', u: u + su, v: v + sv, level, y, face: ry + Math.PI, task: 'bellows' });
}

function anvil(r: Room, level: number, u: number, v: number, ry: number) {
  const k = r.sink, y = r.y(level);
  k.cyl('paint', 0.32, 0.5, u, v, y, C.darkOak, 10, true);
  k.box('iron', 0.7, 0.28, 0.24, u, v, y + 0.5, ry, C.iron);
  const [hu, hv] = rot(ry, 0.45, 0);
  k.box('iron', 0.25, 0.12, 0.16, u + hu, v + hv, y + 0.62, ry, C.iron);
  r.claim(level, u, v, 0.9, 0.9, 0);
  const [su, sv] = rot(ry, 0, 0.75);
  k.spot({ kind: 'work', u: u + su, v: v + sv, level, y, face: ry + Math.PI, task: 'hammer' });
}

function trough(r: Room, level: number, u: number, v: number, ry: number) {
  r.sink.box('paint', 1.4, 0.6, 0.5, u, v, r.y(level), ry, C.oak, true);
  r.sink.box('paint', 1.3, 0.02, 0.4, u, v, r.y(level) + 0.55, ry, 0x2a3a40);
}

function weaponRack(r: Room, level: number, u: number, v: number, ry: number) {
  const k = r.sink, y = r.y(level);
  k.box('paint', 1.5, 0.1, 0.3, u, v, y + 0.3, ry, C.darkOak);
  k.box('paint', 1.5, 0.1, 0.3, u, v, y + 1.4, ry, C.darkOak);
  for (let i = 0; i < 6; i++) {
    const [du, dv] = rot(ry, -0.65 + i * 0.26, 0);
    k.cyl('paint', 0.02, 2.3, u + du, v + dv, y, C.oak, 5);
    k.cyl('iron', 0.035, 0.25, u + du, v + dv, y + 2.3, C.iron, 5, false, 0.0);
  }
}

function cradle(r: Room, level: number, u: number, v: number) {
  const k = r.sink, y = r.y(level);
  k.box('paint', 0.9, 0.45, 0.55, u, v, y + 0.12, 0, C.oak, true);
  k.box('paint', 0.8, 0.06, 0.45, u, v, y + 0.52, 0, C.linen);
  for (const a of [-1, 1]) k.box('paint', 0.06, 0.18, 0.62, u + a * 0.4, v, y, 0, C.darkOak);
}

/** The Vhassarin cipher room: Ilyan's desk among the ministers', the cipher wheels, ledgers and the rook post. */
function cipherRoom(r: Room, level: number) {
  const e = r.ext(level), k = r.sink, y = r.y(level);
  // Ledger walls.
  for (let i = 0; i < 6; i++) { const p = r.againstWall(level, 1.9, 0.45); if (p) F.shelf(r, level, p.u, p.v, p.ry, 1.8, 2.6, 'books'); }
  // A long copying table with desks for the clerks, and the master's desk.
  for (let i = 0; i < 4; i++) {
    const q = r.inMiddle(level, 1.5, 1.6);
    if (q) F.desk(r, level, q.u, q.v, 0, i === 0 ? 'cipher' : 'write');
  }
  // The cipher wheels: brass rings on a stand.
  const q = r.inMiddle(level, 1.0, 1.0);
  if (q) {
    k.cyl('paint', 0.06, 1.0, q.u, q.v, y, C.darkOak, 8, true);
    for (let i = 0; i < 3; i++) k.cyl('iron', 0.28 - i * 0.07, 0.04, q.u, q.v, y + 1.0 + i * 0.05, C.brass, 20);
  }
  // Locked chests for the secret records.
  for (let i = 0; i < 3; i++) { const p = r.againstWall(level, 0.9, 0.5); if (p) F.chest(r, level, p.u, p.v, p.ry, C.darkOak); }
  // The rook post: a perch and message tubes by the window.
  const p = r.againstWall(level, 1.0, 0.5);
  if (p) {
    k.box('paint', 0.9, 1.3, 0.06, p.u, p.v, y, p.ry, C.darkOak);
    k.cyl('paint', 0.03, 0.8, p.u, p.v, y + 1.3, C.oak, 5);
    for (let i = 0; i < 5; i++) k.cyl('paint', 0.02, 0.14, p.u - 0.3 + i * 0.15, p.v, y + 1.0, C.leather, 6);
  }
  void e;
}

// ------------------------------------------------------------------ the manager
const planCache = new Map<number, Plan>();

/** The interior plan (levels, spots, stairs, hearth) without building any geometry. */
export function planOf(b: Building): Plan {
  let p = planCache.get(b.id);
  if (p) return p;
  const plan: Plan = { levels: levelsFor(b), spots: [], stairs: [], hearth: null };
  const sink = new DrySink();
  const room = new Room(b, sink, mulberry32(9000 + b.id * 7919), plan);
  shell(room);
  furnish(room);
  plan.spots = sink.spots;
  planCache.set(b.id, plan);
  return plan;
}

interface Live { b: Building; group: THREE.Group; colliders: RAPIER.Collider[]; plan: Plan }

export class Interiors {
  readonly group = new THREE.Group();
  private live = new Map<number, Live>();
  private mats: Record<Mat, THREE.Material>;
  readonly uDay = uniform(1);
  /** A few hearth lights, given to the nearest burning hearths. */
  private lights: THREE.PointLight[] = [];
  private queue: Building[] = [];
  private cool = 0;

  constructor(private buildings: Building[], private physics: Physics) {
    this.group.name = 'Interiors';
    this.mats = interiorMaterials(this.uDay);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff9a50, 0, 9, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  /** The building whose walls you're inside, if any. */
  inside(p: THREE.Vector3): Building | null {
    for (const l of this.live.values()) {
      const b = l.b;
      const [u, v] = worldToLocal(b, p.x, p.z);
      const W = p.y > b.groundTop - 0.2 ? b.W : b.w, D = p.y > b.groundTop - 0.2 ? b.D : b.d;
      if (Math.abs(u) < W / 2 - 0.1 && Math.abs(v) < D / 2 - 0.1 && p.y > b.fy - 0.5 && p.y < b.top + 0.5) return b;
    }
    return null;
  }

  isLive(b: Building) { return this.live.has(b.id); }

  update(player: THREE.Vector3, day: number, night: number, t: number) {
    this.uDay.value = day;
    uFill.value = 0.035 + 0.05 * day;
    // Stream: interiors within ~24 m of their door come in (one every few frames, nearest
    // first), and go out beyond 40 m. No more than 12 at once.
    this.cool -= 1;
    for (const b of this.buildings) {
      if (!b.hollow) continue;
      const dx = b.door.x - player.x, dz = b.door.z - player.z;
      if (Math.abs(dx) > 50 || Math.abs(dz) > 50) {
        if (this.live.has(b.id)) this.unload(b.id);
        continue;
      }
      const d = Math.hypot(dx, dz);
      const reach = 24 + Math.max(b.w, b.d) * 0.5;
      if (d < reach && !this.live.has(b.id) && !this.queue.includes(b)) this.queue.push(b);
      else if (d > reach + 16 && this.live.has(b.id)) this.unload(b.id);
    }
    if (this.queue.length && this.cool <= 0) {
      const dist = (b: Building) => Math.hypot(b.door.x - player.x, b.door.z - player.z);
      this.queue.sort((a, b) => dist(a) - dist(b));
      const b = this.queue.shift()!;
      if (!this.live.has(b.id) && dist(b) < 24 + Math.max(b.w, b.d) * 0.5) {
        if (this.live.size >= 12) {
          let far: Live | null = null, fd = -1;
          for (const l of this.live.values()) { const dd = dist(l.b); if (dd > fd) { fd = dd; far = l; } }
          if (far && fd > dist(b)) this.unload(far.b.id);
        }
        if (this.live.size < 12) { this.load(b); this.cool = 3; }
      }
    }
    // Hearth lights: the nearest few live hearths, flickering; brighter at night.
    const hearths: { x: number; y: number; z: number; d: number }[] = [];
    for (const l of this.live.values()) {
      const h = l.plan.hearth;
      if (!h) continue;
      const [x, z] = localToWorld(l.b, h.u, h.v + 0.5);
      hearths.push({ x, y: h.y, z, d: Math.hypot(x - player.x, z - player.z) });
    }
    hearths.sort((a, b) => a.d - b.d);
    this.lights.forEach((light, i) => {
      const h = hearths[i];
      if (!h || h.d > 30) { light.intensity = 0; return; }
      light.position.set(h.x, h.y + 0.3, h.z);
      const flick = 0.85 + 0.1 * Math.sin(t * 9.3 + i * 2) + 0.05 * Math.sin(t * 23.1 + i);
      light.intensity = (6 + night * 10) * flick;
    });
  }

  private load(b: Building) {
    const plan = planOf(b);
    const sink = new GeoSink(b);
    const room = new Room(b, sink, mulberry32(9000 + b.id * 7919), { ...plan, spots: [], stairs: [], hearth: null });
    shell(room);
    furnish(room);
    const group = new THREE.Group();
    group.name = `interior_${b.id}`;
    for (const k of Object.keys(sink.parts) as Mat[]) {
      const g = sink.geometry(k);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, this.mats[k]);
      mesh.castShadow = false;
      mesh.receiveShadow = k === 'paint';
      group.add(mesh);
    }
    if (b.kind === 'hallOfCinders') group.add(beamWords(b));
    const colliders = sink.colliders.map((d) => this.physics.world.createCollider(d));
    this.group.add(group);
    this.live.set(b.id, { b, group, colliders, plan });
  }

  private unload(id: number) {
    const l = this.live.get(id);
    if (!l) return;
    this.group.remove(l.group);
    l.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    for (const c of l.colliders) this.physics.world.removeCollider(c, false);
    this.live.delete(id);
  }

  get count() { return this.live.size; }
}

/** The beam's carved words, as a texture on its face. */
function beamWords(b: Building) {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 96;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#2a1c13'; c.fillRect(0, 0, cv.width, cv.height);
  c.font = '600 58px Cinzel, Georgia, serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // Cut letters: a dark shadow and a lighter worn edge.
  c.fillStyle = '#120c08'; c.fillText(HALL_BEAM, cv.width / 2 + 2, cv.height / 2 + 3);
  c.fillStyle = '#8a6a48'; c.fillText(HALL_BEAM, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.8 });
  m.aoNode = float(0.3);
  m.emissiveNode = color(0x2a1608).mul(float(0.6));
  const W = b.w - 2 * b.wall;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, W * 0.9 * cv.height / cv.width), m);
  const e = { v0: -b.d / 2 + b.wall };
  const [x, z] = localToWorld(b, 0, e.v0 + 7.5 + 0.36);
  mesh.position.set(x, b.fy + 0.04 + 8.37, z);
  mesh.rotation.y = b.rot;
  return mesh;
}

const uFill = uniform(0.06);
function interiorMaterials(uDay: any): Record<Mat, THREE.Material> {
  const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const p = positionWorld;
  const grain = mx_noise_float(vec3(p.x.mul(3.0), p.y.mul(9.0), p.z.mul(3.0))).mul(0.5).add(0.5);
  const big = mx_noise_float(p.mul(0.7)).mul(0.5).add(0.5);
  const vc = attribute('color', 'vec3');
  paint.colorNode = vc.mul(grain.mul(0.18).add(0.86)).mul(big.mul(0.12).add(0.92));
  // Indoors the sky only gets in through the doors and windows: damp the ambient (indirect)
  // light, keep the hearth and candle light (direct) at full strength.
  paint.aoNode = float(0.22);
  // A little warm light everywhere indoors (firelight and lamplight bouncing about).
  paint.emissiveNode = vc.mul(color(0xffb070)).mul(uFill);
  const fire = new THREE.MeshBasicNodeMaterial();
  const flick = sin(time.mul(7.0).add(p.x.mul(3.0))).mul(0.15).add(sin(time.mul(17.0).add(p.z.mul(5.0))).mul(0.1)).add(1.0);
  const ember = mx_noise_float(p.mul(9.0).add(vec3(0, time.mul(0.6), 0))).mul(0.5).add(0.5);
  fire.colorNode = mix(color(0x8a1a04), color(0xffa040), ember).mul(flick).mul(3.0);
  const flame = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  flame.colorNode = mix(color(0xff7a20), color(0xffe0a0), smoothstep(0.3, 0.9, ember)).mul(flick).mul(4.0);
  flame.opacityNode = float(0.85);
  const day = new THREE.MeshBasicNodeMaterial();
  day.colorNode = mix(color(0x0a0c10), color(0xd8e4f0), uDay).mul(float(1.6));
  const iron = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.75 });
  iron.colorNode = vc;
  iron.aoNode = float(0.25);
  return { paint, fire, day, iron, flame };
}
