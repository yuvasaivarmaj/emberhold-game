// Quillhaven: "too small to threaten anyone and too useful to destroy". A modest fold of
// land in a brown-green bend of the Quill Brook. A square tower with three additions that
// leans at one corner, two weak walls, one decent granary, a rookery larger than its
// chapel, a market green, a chapel with a crooked bell, a mill, three inns of different
// honesty (the Green Perch the best of them), a counting hall with better locks than the
// armoury, and a bridge where every wagon wheel is heard. Rooks argue in the old elms.
import * as THREE from 'three/webgpu';
import {
  float, vec3, sin, cos, atan, time, instanceIndex, hash, uint, positionLocal, color, uniform,
} from 'three/tsl';
import { Builder, buildHouse, type Bucket, type Collider, type HouseOpts } from './Emberhold';
import type { SmokeEmitter } from './Smoke';
import { Smoke } from './Smoke';
import { Heightfield } from './Heightfield';
import { QUILLHAVEN, BANYAN, ROADS, RIVERS, smoothPath, distToPath, type P } from './Layout';
import { riverDistance } from './WorldConfig';
import { mulberry32 } from './Noise';
import type { Planting } from './Trees';

const C = { x: QUILLHAVEN.x, z: QUILLHAVEN.z };
/** The tower of House Quillayne, north-east of the crossroads. */
export const TOWER = { x: -1300, z: 1825 };
const GREEN = { x: -1295, z: 1932, r: 26 };

/** Trees that belong to the village: the old elms around the tower, and the banyan. */
export function quillhavenPlantings(): Planting[] {
  const out: Planting[] = [];
  const rand = mulberry32(5150);
  for (let i = 0; i < 9; i++) {
    const a = -2.6 + i * 0.55 + (rand() - 0.5) * 0.2; // around the north side of the tower
    const r = 48 + rand() * 14;
    out.push({ kind: 'elm', x: TOWER.x + Math.cos(a) * r, z: TOWER.z + Math.sin(a) * r, height: 24 + rand() * 6 });
  }
  out.push({ kind: 'banyan', x: BANYAN.x, z: BANYAN.z, height: 22 });
  return out;
}

interface Footprint { x: number; z: number; r: number }

export class Quillhaven {
  readonly group: THREE.Group;
  readonly colliders: Collider[];
  readonly chimneys: SmokeEmitter[] = [];
  private wheel = new THREE.Group();
  private b = new Builder();
  private taken: Footprint[] = [];
  private roadPaths: P[][];
  private smoke: Smoke;
  private rooks: THREE.Mesh;
  /** Where the bridge bell hangs (for sound later). */
  readonly bridgeBell = new THREE.Vector3();

  constructor(private hf: Heightfield, materials: Record<Bucket, THREE.Material>) {
    const rand = mulberry32(1311);
    this.roadPaths = ROADS.map((r) => smoothPath(r.pts, 6));
    this.towerCompound(rand);
    this.green(rand);
    this.landmarks(rand);
    this.mill(materials);
    this.lanes(rand);
    this.outerWall(rand);
    this.bells();
    this.group = this.b.merge(materials);
    this.group.name = 'Quillhaven';
    this.wheel.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; } });
    this.group.add(this.wheel);
    this.group.add(this.sign());
    this.smoke = new Smoke(this.chimneys);
    this.group.add(this.smoke.mesh);
    this.rooks = this.makeRooks();
    this.group.add(this.rooks);
    this.colliders = this.b.colliders;
  }

  update(dt: number, night: number) {
    this.wheel.children[0].rotateOnAxis(new THREE.Vector3(1, 0, 0), -dt * 0.55);
    this.smoke.uNight.value = night;
  }

  private ground(x: number, z: number) { return this.hf.height(x, z); }

  private free(x: number, z: number, r: number, roadClear = 4) {
    if (riverDistance(x, z) < r + 5) return false;
    for (const f of this.taken) if ((f.x - x) ** 2 + (f.z - z) ** 2 < (f.r + r) ** 2) return false;
    for (const p of this.roadPaths) if (distToPath(x, z, p) < r + roadClear) return false;
    return true;
  }

  private take(x: number, z: number, r: number) { this.taken.push({ x, z, r }); }

  private house(x: number, z: number, rot: number, w: number, d: number, h: number, rand: () => number, opts: HouseOpts = {}) {
    buildHouse(this.b, (px, pz) => this.ground(px, pz), this.chimneys, x, z, rot, w, d, h, rand, opts);
    this.take(x, z, Math.hypot(w, d) / 2);
  }

  /** A box tilted a little about its base: the tower leans at one corner. */
  private leaningBox(bucket: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, rotY: number, lean: number, collide = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(w / 2, h / 2, d / 2); // pivot at a corner of the base
    g.rotateZ(-lean);
    g.rotateX(lean * 0.6);
    g.translate(-w / 2, 0, -d / 2);
    g.rotateY(rotY);
    g.translate(x, y, z);
    this.b.add(bucket, g);
    if (collide) this.b.colliders.push({ kind: 'box', x, y: y + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, rotY });
  }

  private towerCompound(rand: () => number) {
    const b = this.b;
    const { x, z } = TOWER;
    const g = this.ground(x, z);
    const rot = 0.18;
    const lean = 0.022;
    // The square tower, leaning slightly at one corner.
    this.leaningBox('stone', 12, 25, 12, x, g - 1.5, z, rot, lean);
    // Its crown of merlons and a slate cap, carried over by the lean.
    const topY = g - 1.5 + 25;
    const dx = Math.sin(lean) * 25 * 0.5, dz = Math.sin(lean * 0.6) * 25 * 0.5;
    const cx = x + dx * Math.cos(rot), cz = z - dx * Math.sin(rot) + dz;
    for (let k = 0; k < 16; k++) {
      const side = Math.floor(k / 4), t = ((k % 4) + 0.5) / 4 - 0.5;
      const u = side === 0 ? t * 12 : side === 1 ? 5.7 : side === 2 ? -t * 12 : -5.7;
      const v = side === 0 ? 5.7 : side === 1 ? t * 12 : side === 2 ? -5.7 : -t * 12;
      b.box('stone', 1.4, 1.2, 1.4, cx + u * Math.cos(rot) + v * Math.sin(rot), topY - 0.2, cz - u * Math.sin(rot) + v * Math.cos(rot), rot, false);
    }
    b.pyramid('roofSlate', 10, 6, cx, topY - 0.3, cz, rot);
    for (let f = 0; f < 6; f++) {
      for (const [u, v, rr] of [[0, 6.05, rot], [0, -6.05, rot], [6.05, 0, rot + Math.PI / 2], [-6.05, 0, rot + Math.PI / 2]] as [number, number, number][]) {
        if (rand() < 0.35) continue;
        const k = (f * 3.6 + 3) / 25;
        b.box('window', 0.6, 1.4, 0.2, x + (u + dx * 2 * k) * Math.cos(rot) + v * Math.sin(rot), g + 2 + f * 3.6, z - u * Math.sin(rot) + v * Math.cos(rot) + dz * 2 * k, rr, false);
      }
    }
    // Three additions of different ages: a hall to the west, a kitchen block to the east,
    // and a later stair turret at the south-east corner.
    const P = (u: number, v: number): [number, number] => [x + u * Math.cos(rot) + v * Math.sin(rot), z - u * Math.sin(rot) + v * Math.cos(rot)];
    const [hx, hz] = P(-14, 1);
    buildHouse(b, (a, c) => this.ground(a, c), this.chimneys, hx, hz, rot, 16, 10, 8, rand, { stone: true, roof: 'roofSlate', chimney: true });
    const [kx, kz] = P(11, -2);
    buildHouse(b, (a, c) => this.ground(a, c), this.chimneys, kx, kz, rot, 9, 9, 7, rand, { stone: true, roof: 'roofTile', chimney: true, forge: false });
    const [sx, sz] = P(6.5, 6.5);
    b.cyl('stone', 2.6, 21, sx, this.ground(sx, sz) - 1, sz, 14);
    b.cone('roofSlate', 3.2, 5, sx, this.ground(sx, sz) + 20, sz, 14);
    this.take(x, z, 26);
    // The rookery, larger than the chapel: a broad round house of stone below and
    // timber above, full of openings, its roof white with droppings.
    const [rx, rz] = P(4, 26);
    const ry = this.ground(rx, rz) - 0.8;
    b.cyl('stone', 7, 6.5, rx, ry, rz, 24);
    b.cyl('plaster', 6.6, 6.5, rx, ry + 6.5, rz, 24, false);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      for (let row = 0; row < 3; row++) {
        b.box('window', 0.4, 0.45, 0.3, rx + Math.cos(a + row * 0.13) * 6.62, ry + 7.2 + row * 1.8, rz + Math.sin(a + row * 0.13) * 6.62, -a + Math.PI / 2, false);
      }
      b.box('timber', 0.18, 6.5, 0.14, rx + Math.cos(a) * 6.66, ry + 6.5, rz + Math.sin(a) * 6.66, -a + Math.PI / 2, false);
    }
    b.cone('roofSlate', 8, 7, rx, ry + 13, rz, 24);
    this.take(rx, rz, 9);
    // The inner wall: low, old, and not much of a wall.
    const R = 44;
    for (let k = 0; k < 28; k++) {
      const a0 = (k / 28) * Math.PI * 2, a1 = ((k + 1) / 28) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      if (Math.abs(((am - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.12) continue; // the inner gate, facing the road
      if (rand() < 0.08) continue; // fallen
      const ax = x + Math.cos(a0) * R, az = z + Math.sin(a0) * R, bx = x + Math.cos(a1) * R, bz = z + Math.sin(a1) * R;
      if (riverDistance((ax + bx) / 2, (az + bz) / 2) < 6) continue;
      const len = Math.hypot(bx - ax, bz - az);
      const yb = Math.min(this.ground(ax, az), this.ground(bx, bz)) - 0.8;
      b.box('stone', len + 0.4, 3.6 + rand() * 0.6, 1.1, (ax + bx) / 2, yb, (az + bz) / 2, -Math.atan2(bz - az, bx - ax));
    }
    // Gate piers.
    for (const s of [-1, 1]) {
      const a = Math.PI / 2 + s * 0.13;
      const gx = x + Math.cos(a) * R, gz = z + Math.sin(a) * R;
      b.box('stone', 1.6, 5, 1.6, gx, this.ground(gx, gz) - 0.5, gz, 0);
    }
  }

  private green(rand: () => number) {
    const b = this.b;
    this.take(GREEN.x, GREEN.z, GREEN.r);
    // The well at the middle of the green.
    const wy = this.ground(GREEN.x, GREEN.z);
    b.cyl('stone', 1.3, 1.0, GREEN.x, wy - 0.2, GREEN.z, 14);
    for (const s of [-1, 1]) b.box('timber', 0.22, 2.8, 0.22, GREEN.x + s * 1.1, wy, GREEN.z, 0, false);
    b.box('timber', 2.6, 0.2, 0.2, GREEN.x, wy + 2.6, GREEN.z, 0, false);
    // Market stalls around the edge: posts and striped awnings.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      const sx = GREEN.x + Math.cos(a) * (GREEN.r - 6), sz = GREEN.z + Math.sin(a) * (GREEN.r - 6);
      const rot = -a + Math.PI / 2;
      const sy = this.ground(sx, sz);
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [u, v, h] of [[-1.6, -1, 2.6], [1.6, -1, 2.6], [-1.6, 1, 2.1], [1.6, 1, 2.1]]) {
        b.box('timber', 0.12, h, 0.12, sx + u * c + v * s, sy, sz - u * s + v * c, rot, false);
      }
      b.box('timber', 3.2, 0.8, 1.6, sx, sy, sz, rot); // counter
      const roof = new THREE.PlaneGeometry(3.8, 2.6);
      roof.rotateX(-Math.PI / 2 + 0.2);
      roof.rotateY(rot);
      roof.translate(sx, sy + 2.4, sz);
      b.add('cloth', roof);
    }
  }

  private landmarks(rand: () => number) {
    const b = this.b;
    const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z); // rot so the door (+v) faces the target
    // The Green Perch: the honest inn, on the south side of the green.
    const inn = { x: GREEN.x - 4, z: GREEN.z + GREEN.r + 11 };
    this.house(inn.x, inn.z, face(inn.x, inn.z, GREEN.x, GREEN.z), 20, 11, 8.5, rand, { timber: true, roof: 'roofTile', chimney: true });
    this.chimneys.push({ x: inn.x + 5, y: this.ground(inn.x, inn.z) + 15, z: inn.z, strength: 0.6 });
    this.innSign.set(inn.x, this.ground(inn.x, inn.z) + 3.2, inn.z - 7);
    // The chapel with its crooked bell: small, plain, on the east side of the green.
    const ch = { x: GREEN.x + GREEN.r + 16, z: GREEN.z - 2 };
    const crot = face(ch.x, ch.z, GREEN.x, GREEN.z);
    this.house(ch.x, ch.z, crot, 8, 15, 6.5, rand, { stone: true, roof: 'roofSlate' });
    const cy = this.ground(ch.x, ch.z) + 6.5;
    const bx = ch.x + Math.sin(crot) * 6, bz = ch.z + Math.cos(crot) * 6;
    b.box('stone', 2.2, 3.4, 1.2, bx, cy, bz, crot);
    // The bell hangs a little askew.
    const bell = new THREE.CylinderGeometry(0.25, 0.5, 0.7, 12, 1, true);
    bell.rotateZ(0.16);
    bell.translate(bx, cy + 2.0, bz);
    this.b.add('iron', bell);
    // The counting hall, with better locks than the armoury, on the west of the green.
    const ct = { x: GREEN.x - GREEN.r - 13, z: GREEN.z + 4 };
    this.house(ct.x, ct.z, face(ct.x, ct.z, GREEN.x, GREEN.z), 15, 9, 7, rand, { stone: true, roof: 'roofSlate', chimney: true });
    // One decent granary, raised on staddle stones against rats.
    const gr = { x: GREEN.x + 46, z: GREEN.z + 50 };
    if (this.free(gr.x, gr.z, 8)) {
      const gy = this.ground(gr.x, gr.z);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) b.cyl('stone', 0.35, 1.0, gr.x - 6 + i * 4, gy - 0.3, gr.z - 3 + j * 3, 8, false);
      buildHouse(b, () => gy + 0.9, this.chimneys, gr.x, gr.z, 0.4, 14, 8, 6, rand, { stone: true, roof: 'roofTile' });
      this.b.colliders.push({ kind: 'box', x: gr.x, y: gy + 3, z: gr.z, hx: 7, hy: 3.5, hz: 4, rotY: 0.4 });
      this.take(gr.x, gr.z, 9);
    }
    // The scribe-house, saddle-house and west store, in the lower lane by the west bridge.
    for (const [px, pz, w, d] of [[-1378, 1916, 11, 8], [-1360, 1932, 13, 9], [-1382, 1942, 16, 9]] as [number, number, number, number][]) {
      if (!this.free(px, pz, Math.hypot(w, d) / 2, 3)) continue;
      this.house(px, pz, face(px, pz, C.x, C.z), w, d, 6 + rand() * 2, rand, { timber: true, roof: 'thatch', chimney: true });
    }
  }
  private innSign = new THREE.Vector3();

  /** The mill on the brook below the village, with a turning undershot wheel. */
  private mill(materials: Record<Bucket, THREE.Material>) {
    const brook = smoothPath(RIVERS.find((r) => r.name === 'Quill Brook')!.pts, 4);
    // Find the bank point nearest the chosen spot, and the brook's direction there.
    let bi = 0, bd = Infinity;
    for (let i = 0; i < brook.length; i++) {
      const d = Math.hypot(brook[i][0] + 1404, brook[i][1] - 1980);
      if (d < bd) { bd = d; bi = i; }
    }
    const [mx, mz] = brook[bi];
    const [nx0, nz0] = brook[Math.min(brook.length - 1, bi + 1)];
    let tx = nx0 - mx, tz = nz0 - mz;
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    let nx = -tz, nz = tx; // normal; point it to the village (east)
    if (nx < 0) { nx = -nx; nz = -nz; }
    const half = 7; // half the brook's width
    const house = { x: mx + nx * (half + 4.8), z: mz + nz * (half + 4.8) };
    const rot = Math.atan2(tx, tz); // long side along the stream
    const rand = mulberry32(8);
    buildHouse(this.b, (a, c) => this.ground(a, c), this.chimneys, house.x, house.z, rot, 9, 12, 7.5, rand, { stone: true, roof: 'thatch' });
    this.take(house.x, house.z, 9);
    // Wheel: two rims, spokes and paddles, on an axle into the mill wall.
    const wx = mx + nx * (half - 1.0), wz = mz + nz * (half - 1.0);
    const wy = Math.max(this.ground(wx, wz), -0.8) + 2.2;
    const wheel = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [];
    const R = 3.0;
    for (const s of [-0.65, 0.65]) {
      const rim = new THREE.TorusGeometry(R, 0.1, 6, 32);
      rim.rotateY(Math.PI / 2);
      rim.translate(s, 0, 0);
      parts.push(rim.toNonIndexed());
      for (let k = 0; k < 8; k++) {
        const sp = new THREE.BoxGeometry(0.12, R * 2, 0.14);
        sp.rotateX((k / 8) * Math.PI);
        sp.translate(s, 0, 0);
        parts.push(sp.toNonIndexed());
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const pd = new THREE.BoxGeometry(1.4, 0.06, 0.7);
      pd.translate(0, R - 0.3, 0);
      pd.rotateX(a);
      parts.push(pd.toNonIndexed());
    }
    const axle = new THREE.CylinderGeometry(0.22, 0.22, 4.4, 10);
    axle.rotateZ(Math.PI / 2);
    axle.translate(1.6, 0, 0);
    parts.push(axle.toNonIndexed());
    for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const geo = this.mergeSimple(parts);
    const mesh = new THREE.Mesh(geo, materials.timber);
    wheel.add(mesh);
    wheel.position.set(wx, wy, wz);
    wheel.rotation.y = Math.atan2(-nz, nx);
    this.wheel = wheel;
    this.millRace = new THREE.Vector3(wx, wy, wz);
  }
  millRace = new THREE.Vector3();

  private mergeSimple(parts: THREE.BufferGeometry[]) {
    let n = 0;
    for (const p of parts) n += p.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array as Float32Array, o * 3);
      nrm.set(p.attributes.normal.array as Float32Array, o * 3);
      o += p.attributes.position.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    return g;
  }

  /** Cottages along the roads and lanes inside the village, facing the way. */
  private lanes(rand: () => number) {
    const names = ['West road', 'Quill road', 'North lane'];
    for (const name of names) {
      const path = this.roadPaths[ROADS.findIndex((r) => r.name === name)];
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const [ax, az] = path[i - 1], [bx, bz] = path[i];
        const seg = Math.hypot(bx - ax, bz - az);
        acc += seg;
        if (acc < 13) continue;
        acc = 0;
        const tx = (bx - ax) / seg, tz = (bz - az) / seg;
        for (const side of [-1, 1]) {
          const off = 10 + rand() * 3;
          const x = bx - tz * side * off, z = bz + tx * side * off;
          if (Math.hypot(x - C.x, z - C.z) > QUILLHAVEN.r + 40) continue;
          const w = 8 + rand() * 4, d = 6.5 + rand() * 2;
          if (!this.free(x, z, Math.hypot(w, d) / 2, 3.5)) continue;
          if (rand() < 0.15) continue; // a garden plot instead
          this.house(x, z, Math.atan2(bx - x, bz - z), w, d, 4.5 + rand() * 3.5, rand, {
            timber: true, roof: rand() < 0.55 ? 'thatch' : 'roofTile', chimney: rand() < 0.8,
          });
        }
      }
    }
    // A loose scatter of cottages, byres and sheds behind the road rows.
    for (let k = 0; k < 260; k++) {
      const a = rand() * Math.PI * 2, r = 30 + Math.sqrt(rand()) * (QUILLHAVEN.r + 10);
      const x = C.x + Math.cos(a) * r + 40, z = C.z + Math.sin(a) * r;
      const w = 7 + rand() * 5, d = 5.5 + rand() * 2.5;
      if (!this.free(x, z, Math.hypot(w, d) / 2 + 2, 6)) continue;
      this.house(x, z, rand() * Math.PI * 2, w, d, 3.8 + rand() * 3, rand, {
        timber: rand() < 0.7, roof: rand() < 0.7 ? 'thatch' : 'roofTile', chimney: rand() < 0.6,
      });
    }
  }

  /** The outer wall: low, broken in places, little more than a line to cross. */
  private outerWall(rand: () => number) {
    const b = this.b;
    const R = QUILLHAVEN.r + 28, cx = C.x + 40, cz = C.z;
    const n = 90;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const ax = cx + Math.cos(a0) * R, az = cz + Math.sin(a0) * R, bx = cx + Math.cos(a1) * R, bz = cz + Math.sin(a1) * R;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (riverDistance(mx, mz) < 8) continue;
      if (this.roadPaths.some((p) => distToPath(mx, mz, p) < 7)) continue;
      if (rand() < 0.14) continue; // gaps where it has fallen
      const len = Math.hypot(bx - ax, bz - az);
      const yb = Math.min(this.ground(ax, az), this.ground(bx, bz)) - 0.6;
      const h = 2.2 + rand() * 0.9;
      b.box('stone', len + 0.3, h, 0.9, mx, yb, mz, -Math.atan2(bz - az, bx - ax));
    }
  }

  /** The bridge bells: the north bridge rings once for a message that arrives bleeding. */
  private bells() {
    const b = this.b;
    const north = { x: -1376, z: 1751 }; // the north lane's bridge
    const nb = (this.hf.meta.bridges ?? []).find((q: any) => Math.hypot(q.x - north.x, q.z - north.z) < 30);
    if (!nb) return;
    // A post at the village end of the bridge, with a hood over the bell.
    const end = nb.length / 2 + 9;
    const s = (nb.dirZ < 0 ? -1 : 1);
    const px = nb.x - nb.dirX * end * s + nb.dirZ * 4.2, pz = nb.z - nb.dirZ * end * s - nb.dirX * 4.2;
    const py = this.ground(px, pz);
    b.box('timber', 0.3, 4.2, 0.3, px, py, pz, 0);
    b.box('timber', 1.6, 0.25, 0.3, px, py + 4.0, pz, 0, false);
    b.gable('roofTile', 1.4, 0.9, 0.6, px, py + 4.25, pz, 0, 0.2);
    const bell = new THREE.CylinderGeometry(0.18, 0.36, 0.5, 12, 1, true);
    bell.translate(px + 0.5, py + 3.6, pz);
    b.add('iron', bell);
    this.bridgeBell.set(px + 0.5, py + 3.6, pz);
  }

  /** The Green Perch's sign: a painted board with a green bird on a branch. */
  private sign() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b2118'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#d8c79a'; g.fillRect(10, 10, 492, 236);
    g.fillStyle = '#3a2a1c'; g.fillRect(70, 150, 380, 10); // the perch
    g.fillStyle = '#3d6b35';
    g.beginPath(); g.ellipse(250, 115, 70, 42, -0.2, 0, Math.PI * 2); g.fill(); // body
    g.beginPath(); g.ellipse(320, 82, 30, 26, 0, 0, Math.PI * 2); g.fill(); // head
    g.beginPath(); g.moveTo(190, 130); g.lineTo(110, 175); g.lineTo(200, 150); g.fill(); // tail
    g.fillStyle = '#d0a530'; g.beginPath(); g.moveTo(345, 82); g.lineTo(372, 90); g.lineTo(345, 96); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(328, 78, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2118'; g.font = 'bold 34px Georgia, serif'; g.textAlign = 'center';
    g.fillText('THE GREEN PERCH', 256, 222);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), mat);
    const grp = new THREE.Group();
    board.position.set(0, -0.7, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.4), new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.5 }));
    arm.position.set(0, 0, 0.6);
    board.position.z = 1.0;
    board.rotation.y = Math.PI / 2;
    grp.add(board, arm);
    grp.position.copy(this.innSign);
    const toGreen = Math.atan2(GREEN.x - this.innSign.x, GREEN.z - this.innSign.z);
    grp.rotation.y = toGreen;
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    return grp;
  }

  /** Rooks wheeling and squabbling over the elms: little black wings on the GPU. */
  private makeRooks() {
    const N = 48;
    const wing = new THREE.BufferGeometry();
    // A body and two wings; the wing tips (marked by uv.x = 1) flap in the shader.
    const v = [
      -0.05, 0, -0.22, 0.05, 0, -0.22, 0, 0, 0.22,
      0, 0, -0.08, 0, 0, 0.1, -0.5, 0, 0.0,
      0, 0, 0.1, 0, 0, -0.08, 0.5, 0, 0.0,
    ];
    const tip = [0, 0, 0, 0, 0, 1, 0, 0, 1];
    wing.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    wing.setAttribute('uv', new THREE.Float32BufferAttribute(tip.flatMap((t) => [t, 0]), 2));
    wing.computeVertexNormals();
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = null;
    geo.setAttribute('position', wing.attributes.position);
    geo.setAttribute('normal', wing.attributes.normal);
    geo.setAttribute('uv', wing.attributes.uv);
    geo.instanceCount = N;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(TOWER.x, 40, TOWER.z), 300);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0x0c0c0e, roughness: 0.6, side: THREE.DoubleSide });
    const id = instanceIndex;
    const r1 = hash(id.add(uint(1))), r2 = hash(id.add(uint(2))), r3 = hash(id.add(uint(3)));
    const uCenter = uniform(new THREE.Vector3(TOWER.x - 10, this.ground(TOWER.x, TOWER.z) + 32, TOWER.z - 25));
    const t = time.mul(r1.mul(0.25).add(0.18)).add(r2.mul(40.0));
    const rad = r3.mul(45.0).add(15.0);
    const pos = vec3(cos(t).mul(rad), sin(t.mul(1.7)).mul(6.0).add(r1.mul(14.0)), sin(t).mul(rad.mul(0.7)));
    const vel = vec3(sin(t).negate(), 0.0, cos(t).mul(0.7)).normalize();
    // Orient the bird along its path (rotate about Y).
    const ang = atan(vel.x, vel.z);
    const flap = sin(time.mul(r2.mul(6.0).add(9.0))).mul(0.35);
    const lp = positionLocal;
    const scale = float(1.4).add(r3.mul(0.4));
    const sx = lp.x.mul(scale), sz = lp.z.mul(scale);
    const isTip = (lp.x.abs().greaterThan(0.2)).select(float(1), float(0));
    const sy = isTip.mul(flap).mul(scale);
    const ca = cos(ang), sa = sin(ang);
    const local = vec3(sx.mul(ca).add(sz.mul(sa)), sy, sz.mul(ca).sub(sx.mul(sa)));
    mat.positionNode = uCenter.add(pos).add(local);
    mat.colorNode = color(0x0b0b0d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'Rooks';
    return mesh;
  }
}
