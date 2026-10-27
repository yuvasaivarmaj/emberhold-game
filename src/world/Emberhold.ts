// Emberhold, built from the Part One description: a hill-fort that is "a market, a
// furnace-seat, a noble house, and a sealed memory built on top of one another".
//   Outer yards (its hands): smithies, stables, storehouses, furnace sheds, granary
//     towers and barracks, like a small town inside a curtain wall of pale stone and
//     dark fused brick, entered by blackwood gates.
//   Middle courts (its ribs): the halls of the sworn households and the rookery.
//   High halls (its face): the Hall of Cinders, the keep's pale towers, the family
//     wings and the forge hall, whose stack smokes over the Verdance.
// Everything is generated, merged by material into a handful of meshes, and given
// simple colliders.
import * as THREE from 'three/webgpu';
import {
  float, vec3, mix, smoothstep, floor, fract, abs, positionWorld, normalWorld, step, hash, uint,
  mx_noise_float, color, uniform, cameraPosition,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Heightfield } from './Heightfield';
import { EMBERHOLD as E, fortShape } from './Layout';
import { mulberry32 } from './Noise';
import { bumpFromHeight } from './TerrainShading';
import { Smoke, type SmokeEmitter } from './Smoke';

export interface BoxCollider { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY: number }
export interface CylCollider { kind: 'cyl'; x: number; y: number; z: number; r: number; hh: number }
export type Collider = BoxCollider | CylCollider;

export type Bucket = 'stone' | 'plaster' | 'roofTile' | 'roofSlate' | 'timber' | 'window' | 'door' | 'iron' | 'monolith' | 'cloth' | 'thatch';

const SOUTH = Math.atan2(462, 30);   // angle of the south gate from the centre
const NORTH = Math.atan2(-470, -30); // and the north gate

function angDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// ------------------------------------------------------------------ materials
/** World-space ashlar blocks with courses of dark fused brick. */
function stoneMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const p = positionWorld;
  const n = normalWorld;
  const side = abs(n.x).greaterThan(abs(n.z));
  const u = side.select(p.z, p.x);
  const top = abs(n.y).greaterThan(0.7);
  // Ashlar courses of pale Reach stone (uneven course heights read as hand-laid).
  const row = floor(p.y.div(0.46));
  const rowH = hash(uint(row.add(7000.0)));
  const blockW = rowH.mul(0.5).add(0.75);
  const off = fract(row.mul(0.618)).mul(blockW);
  const col = floor(u.add(off).div(blockW));
  const fy = fract(p.y.div(0.46)), fu = fract(u.add(off).div(blockW));
  const joint = smoothstep(0.0, 0.07, fy).mul(smoothstep(1.0, 0.93, fy)).mul(smoothstep(0.0, 0.045, fu)).mul(smoothstep(1.0, 0.955, fu));
  const v = hash(uint(row.add(4096.0)).mul(uint(73856093)).bitXor(uint(col.add(4096.0)).mul(uint(19349663))));
  const grain = mx_noise_float(p.mul(2.6)).mul(0.5).add(0.5);
  let stone: any = mix(color(0x9d917b), color(0x91897a), smoothstep(0.2, 0.8, v));
  stone = mix(stone, color(0x7c7262), step(0.94, v));
  stone = stone.mul(grain.mul(0.12).add(0.9));
  // Bands of dark fused brick: small bricks with a glassy, fire-hardened face.
  const bandY = fract(p.y.div(3.7));
  const band = step(bandY, 0.17);
  const brow = floor(p.y.div(0.2));
  const boff = fract(brow.mul(0.5)).mul(0.46);
  const bfy = fract(p.y.div(0.2)), bfu = fract(u.add(boff).div(0.46));
  const bjoint = smoothstep(0.0, 0.1, bfy).mul(smoothstep(1.0, 0.9, bfy)).mul(smoothstep(0.0, 0.05, bfu)).mul(smoothstep(1.0, 0.95, bfu));
  const bv = hash(uint(brow.add(4096.0)).mul(uint(83492791)).bitXor(uint(floor(u.add(boff).div(0.46)).add(4096.0)).mul(uint(19349663))));
  const brick = mix(color(0x2f2421), color(0x553a2e), bv);
  const mortarC = color(0x7a7366);
  const blockJ = mix(joint, bjoint, band);
  let c: any = mix(mix(mortarC, stone, joint), mix(mortarC.mul(0.7), brick, bjoint), band);
  // Weathering: rain streaks from the wall walk, soot and lichen.
  const streak = mx_noise_float(vec3(u.mul(1.3), p.y.mul(0.06), side.select(p.x, p.z).mul(0.5))).mul(0.5).add(0.5);
  c = c.mul(mix(float(0.72), float(1.0), smoothstep(0.25, 0.65, streak)));
  const soot = mx_noise_float(p.mul(0.08)).mul(0.5).add(0.5);
  c = c.mul(mix(float(0.78), float(1.0), soot));
  const lichen = smoothstep(0.62, 0.8, mx_noise_float(p.mul(0.9).add(vec3(3.0, 1.0, 7.0))).mul(0.5).add(0.5));
  c = mix(c, color(0x807b5e), lichen.mul(0.2).mul(float(1).sub(band)));
  const topC = mix(color(0x7a7366), color(0x5f594f), v).mul(grain.mul(0.2).add(0.85));
  m.colorNode = top.select(topC, c);
  m.roughnessNode = mix(float(0.9), float(0.42), band.mul(bjoint));
  const near = float(1).sub(smoothstep(30.0, 140.0, cameraPosition.distance(p)));
  m.normalNode = bumpFromHeight(blockJ.mul(0.018).add(grain.mul(0.004)).mul(near));
  return m;
}

function plasterMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
  const p = positionWorld;
  const v = mx_noise_float(p.mul(0.7)).mul(0.5).add(0.5);
  const stain = mx_noise_float(vec3(p.x.mul(0.2), p.y.mul(1.5), p.z.mul(0.2))).mul(0.5).add(0.5);
  // Limewash in a few tints per house (keyed on a coarse cell), stained by rain.
  const id = hash(uint(floor(p.x.div(9.0)).add(3000.0)).mul(uint(73856093)).bitXor(uint(floor(p.z.div(9.0)).add(3000.0)).mul(uint(19349663))));
  const tint = mix(mix(color(0xa99e89), color(0xa38e6d), step(0.55, id)), color(0x8f897b), step(0.85, id));
  m.colorNode = tint.mul(mix(float(0.88), float(1), v)).mul(mix(float(0.8), float(1), stain));
  return m;
}

function roofMaterial(kind: 'tile' | 'slate') {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: kind === 'tile' ? 0.8 : 0.6 });
  const p = positionWorld;
  const rows = fract(p.y.div(0.28));
  const ridge = smoothstep(0.0, 0.25, rows);
  const course = floor(p.y.div(0.28));
  const col = floor(p.x.add(p.z).div(0.33).add(course.mul(0.5)));
  const v = hash(uint(course.add(9000.0)).mul(uint(374761393)).bitXor(uint(col.add(9000.0)).mul(uint(668265263))));
  const base = kind === 'tile' ? mix(color(0x8a4630), color(0xa45a3a), v) : mix(color(0x34363b), color(0x4a4c52), v);
  const moss = smoothstep(0.6, 0.85, mx_noise_float(p.mul(0.25)).mul(0.5).add(0.5)).mul(kind === 'tile' ? 0.25 : 0.15);
  m.colorNode = mix(base.mul(mix(float(0.7), float(1), ridge)), color(0x5a6630), moss);
  return m;
}

function timberMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
  const p = positionWorld;
  const grain = mx_noise_float(vec3(p.x.mul(2.0), p.y.mul(18.0), p.z.mul(2.0))).mul(0.5).add(0.5);
  m.colorNode = mix(color(0x2c1f17), color(0x46322a), grain);
  return m;
}

function windowMaterial(night: any) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.0 });
  const p = positionWorld;
  const id = hash(uint(floor(p.x.mul(0.5)).add(5000.0)).mul(uint(73856093)).bitXor(uint(floor(p.z.mul(0.5)).add(5000.0)).mul(uint(19349663))).bitXor(uint(floor(p.y.mul(0.5)).add(500.0))));
  const lit = step(0.35, id);
  m.colorNode = color(0x0b0a08);
  // Candle and hearth light behind the shutters after dusk.
  const warmth = hash(uint(floor(p.x.add(p.z).mul(0.7)).add(9000.0)));
  const glow = mix(color(0xff8a3a), color(0xffc070), warmth);
  m.emissiveNode = glow.mul(lit.mul(night).mul(warmth.mul(0.6).add(0.7)).mul(2.4));
  return m;
}

function doorMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  const p = positionWorld;
  const planks = fract(p.x.add(p.z).div(0.18));
  m.colorNode = mix(color(0x1e1712), color(0x2e231a), smoothstep(0.1, 0.2, planks));
  return m;
}

function monolithMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
  const p = positionWorld;
  const big = mx_noise_float(p.mul(0.6)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(5.0)).mul(0.5).add(0.5);
  const lichen = smoothstep(0.55, 0.75, mx_noise_float(p.mul(1.7).add(vec3(5.0, 2.0, 1.0))).mul(0.5).add(0.5));
  const base = mix(color(0x55524c), color(0x76726a), big).mul(fine.mul(0.15).add(0.9));
  m.colorNode = mix(base, color(0x8a8a62), lichen.mul(0.45));
  m.normalNode = bumpFromHeight(big.mul(0.05).add(fine.mul(0.01)));
  return m;
}

/** Market awnings: striped, faded cloth in a few dyes, keyed per stall. */
function clothMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, side: THREE.DoubleSide });
  const p = positionWorld;
  const id = hash(uint(floor(p.x.div(5.0)).add(3000.0)).mul(uint(73856093)).bitXor(uint(floor(p.z.div(5.0)).add(3000.0)).mul(uint(19349663))));
  const dye = mix(mix(color(0x7a2f24), color(0x2f4a5e), step(0.33, id)), color(0x8a7a2e), step(0.66, id));
  const stripe = step(0.5, fract(p.x.add(p.z).mul(1.6)));
  m.colorNode = mix(dye, color(0xcfc4ab), stripe.mul(0.8)).mul(mx_noise_float(p.mul(1.3)).mul(0.08).add(0.92));
  return m;
}

/** Thatch: straw reed bundles, darker and mossy with age. */
function thatchMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const p = positionWorld;
  const straw = mx_noise_float(vec3(p.x.mul(9.0), p.y.mul(1.5), p.z.mul(9.0))).mul(0.5).add(0.5);
  const age = mx_noise_float(p.mul(0.2)).mul(0.5).add(0.5);
  m.colorNode = mix(mix(color(0x8a7650), color(0x6b5a3c), straw), color(0x4f4a30), age.mul(0.5));
  m.normalNode = bumpFromHeight(straw.mul(0.02));
  return m;
}

/** The shared set of building materials (Emberhold, Quillhaven, bridges). */
export function buildingMaterials(night: any): Record<Bucket, THREE.Material> {
  return {
    stone: stoneMaterial(), plaster: plasterMaterial(), roofTile: roofMaterial('tile'), roofSlate: roofMaterial('slate'),
    timber: timberMaterial(), window: windowMaterial(night), door: doorMaterial(), iron: ironMaterial(), monolith: monolithMaterial(),
    cloth: clothMaterial(), thatch: thatchMaterial(),
  };
}

function ironMaterial() {
  return new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.8 });
}

// ------------------------------------------------------------------ geometry helpers
export class Builder {
  buckets: Record<Bucket, THREE.BufferGeometry[]> = {
    stone: [], plaster: [], roofTile: [], roofSlate: [], timber: [], window: [], door: [], iron: [], monolith: [], cloth: [], thatch: [],
  };
  colliders: Collider[] = [];

  add(bucket: Bucket, g: THREE.BufferGeometry) {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ng.attributes.position.count) * 2), 2));
    this.buckets[bucket].push(ng);
  }

  box(bucket: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, collide = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(rotY);
    g.translate(x, y + h / 2, z);
    this.add(bucket, g);
    if (collide) this.colliders.push({ kind: 'box', x, y: y + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, rotY });
  }

  cyl(bucket: Bucket, r: number, h: number, x: number, y: number, z: number, seg = 16, collide = true) {
    const g = new THREE.CylinderGeometry(r, r * 1.03, h, seg, 1);
    g.translate(x, y + h / 2, z);
    this.add(bucket, g);
    if (collide) this.colliders.push({ kind: 'cyl', x, y: y + h / 2, z, r, hh: h / 2 });
  }

  cone(bucket: Bucket, r: number, h: number, x: number, y: number, z: number, seg = 16) {
    const g = new THREE.ConeGeometry(r, h, seg, 1);
    g.translate(x, y + h / 2, z);
    this.add(bucket, g);
  }

  /** A pyramid roof on a square tower. */
  pyramid(bucket: Bucket, w: number, h: number, x: number, y: number, z: number, rotY = 0) {
    const g = new THREE.ConeGeometry(w * 0.72, h, 4, 1);
    g.rotateY(Math.PI / 4 + rotY);
    g.translate(x, y + h / 2, z);
    this.add(bucket, g);
  }

  /** Gable roof over a w x d footprint, ridge along the local x axis. */
  gable(bucket: Bucket, w: number, d: number, h: number, x: number, y: number, z: number, rotY: number, over = 0.5) {
    const W = w / 2 + over, D = d / 2 + over;
    const v = [
      // two slopes
      -W, 0, D, W, 0, D, W, h, 0, -W, 0, D, W, h, 0, -W, h, 0,
      W, 0, -D, -W, 0, -D, -W, h, 0, W, 0, -D, -W, h, 0, W, h, 0,
      // gable ends
      -W, 0, -D, -W, 0, D, -W, h, 0,
      W, 0, D, W, 0, -D, W, h, 0,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    g.rotateY(rotY);
    g.translate(x, y, z);
    this.add(bucket, g);
  }

  merge(materials: Record<Bucket, THREE.Material>) {
    const group = new THREE.Group();
    for (const k of Object.keys(this.buckets) as Bucket[]) {
      const list = this.buckets[k];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[k]);
      mesh.castShadow = k !== 'window';
      mesh.receiveShadow = true;
      mesh.name = `emberhold_${k}`;
      group.add(mesh);
    }
    return group;
  }
}

export interface HouseOpts { timber?: boolean; roof?: 'roofTile' | 'roofSlate' | 'thatch'; chimney?: boolean; stone?: boolean; forge?: boolean; doorSide?: number }

/** A house: walls on a stone footing, timber framing, door, shuttered windows, roof and chimney. */
export function buildHouse(b: Builder, ground: (x: number, z: number) => number, chimneys: SmokeEmitter[],
x: number, z: number, rot: number, w: number, d: number, h: number, rand: () => number, opts: HouseOpts = {}) {
  // Sit on the lowest corner so nothing floats on the terraces' slopes.
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([u, v]) => ground(...P(u, v)));
  const y = Math.min(...corners) - 0.6;
  const fy = Math.max(...corners);
  let top = fy + h;
  const stone = !!opts.stone;
  const floors = Math.max(1, Math.floor(h / 3.1));
  // Timber houses with two floors or more often jetty the upper storey out over the street.
  const jetty = !stone && opts.timber && floors >= 2 && rand() < 0.6 ? 0.45 : 0;
  const groundTop = jetty ? fy + 3.1 : top;
  b.box(stone ? 'stone' : 'plaster', w, groundTop - y, d, x, y, z, rot);
  if (!stone) b.box('stone', w + 0.12, fy + 0.7 - y, d + 0.12, x, y, z, rot, false); // stone footing
  let W = w, D = d;
  if (jetty) {
    W = w + jetty * 2; D = d + jetty * 2;
    b.box('timber', W + 0.1, 0.3, D + 0.1, x, groundTop - 0.15, z, rot, false);
    b.box('plaster', W, top - groundTop, D, x, groundTop, z, rot, false);
  }
  // Timber framing: posts, a rail at each floor and braces on the long walls.
  if (opts.timber && !stone) {
    const posts = Math.max(2, Math.round(W / 2.0));
    for (let k = 0; k <= posts; k++) {
      const u = -W / 2 + (k / posts) * W;
      const y0 = jetty ? groundTop : fy + 0.7;
      for (const v of [-D / 2 - 0.06, D / 2 + 0.06]) {
        const [px, pz] = P(u, v);
        b.box('timber', 0.2, top - y0, 0.12, px, y0, pz, rot, false);
      }
    }
    for (let f = 1; f < floors; f++) {
      for (const v of [-D / 2 - 0.07, D / 2 + 0.07]) {
        const [px, pz] = P(0, v);
        b.box('timber', W, 0.2, 0.14, px, fy + f * 3.1 - 0.1, pz, rot, false);
      }
    }
    for (const v of [-D / 2 - 0.07, D / 2 + 0.07]) {
      const [px, pz] = P(0, v);
      b.box('timber', W, 0.2, 0.14, px, top - 0.2, pz, rot, false);
    }
  }
  // Door on the front (the side facing +v), with a stone step.
  {
    const [dx, dz] = P((rand() - 0.5) * w * 0.3, d / 2 + 0.05);
    b.box('door', 1.25, 2.2, 0.12, dx, fy, dz, rot, false);
    b.box('timber', 1.6, 0.22, 0.2, dx, fy + 2.2, dz, rot, false);
  }
  // Windows with open shutters on both long sides.
  const nwin = Math.max(1, Math.floor(w / 3.2));
  for (let f = 0; f < floors; f++) {
    const ww = f === 0 ? w : W, dd = f === 0 ? d : D;
    for (let k = 0; k < nwin; k++) {
      const u = -ww / 2 + (k + 0.5) * (ww / nwin);
      if (f === 0 && Math.abs(u) < 1.6) continue;
      for (const v of [dd / 2 + 0.06, -dd / 2 - 0.06]) {
        if (rand() < 0.18) continue;
        const wy = fy + 1.0 + f * 3.1;
        const [wx, wz] = P(u, v);
        b.box('window', 0.75, 1.05, 0.1, wx, wy, wz, rot, false);
        if (!stone || rand() < 0.5) {
          const sv = v > 0 ? 0.1 : -0.1;
          for (const side of [-1, 1]) {
            const [sx, sz] = P(u + side * 0.62, v + sv);
            b.box('timber', 0.42, 1.1, 0.05, sx, wy - 0.02, sz, rot, false);
          }
        }
        b.box(stone ? 'stone' : 'timber', 0.95, 0.12, 0.22, wx, wy - 0.12, wz, rot, false); // sill
      }
    }
  }
  const thatch = opts.roof === 'thatch';
  const roofH = Math.min(W, D) * (thatch ? 0.7 + rand() * 0.1 : 0.42 + rand() * 0.18);
  b.gable(opts.roof ?? 'roofTile', W, D, roofH, x, top, z, rot, thatch ? 0.75 : 0.45);
  if (opts.chimney) {
    const u = W * (rand() < 0.5 ? 0.3 : -0.3);
    const [cx, cz] = P(u, (rand() - 0.5) * D * 0.3);
    b.box('stone', 0.9, roofH + 1.6, 0.9, cx, top, cz, rot);
    b.box('stone', 1.1, 0.25, 1.1, cx, top + roofH + 1.6, cz, rot, false);
    if (opts.forge || rand() < 0.04) chimneys.push({ x: cx, y: top + roofH + 1.9, z: cz, strength: opts.forge ? 1.4 : 0.45 });
  }
}


// ------------------------------------------------------------------ the fort
export class Emberhold {
  readonly group: THREE.Group;
  readonly colliders: Collider[];
  readonly uNight = uniform(0);
  /** Top of the forge stack, for the smoke plume. */
  readonly forgeStack = new THREE.Vector3();
  readonly gates: { south: THREE.Vector3; north: THREE.Vector3 };
  /** Smoking chimneys: smithies always, a share of the hearths. */
  readonly chimneys: SmokeEmitter[] = [];
  readonly smoke: Smoke;
  readonly materials: Record<Bucket, THREE.Material>;
  private b = new Builder();

  constructor(private hf: Heightfield) {
    const rand = mulberry32(1919);
    const at = (a: number, r: number) => {
      const rr = r * fortShape(a);
      return new THREE.Vector2(E.x + Math.cos(a) * rr, E.z + Math.sin(a) * rr);
    };
    this.gates = { south: new THREE.Vector3(), north: new THREE.Vector3() };

    // Curtain walls: outer (lower yard), middle (sworn courts), inner (high halls).
    this.wallRing(E.outerR + 3, 13, 4.2, 74, 5.6, 20, [SOUTH, NORTH], true, 'outer');
    this.wallRing(E.middleR + 4, 11, 3.6, 62, 5.0, 17, [SOUTH, NORTH], false, 'middle');
    this.wallRing(E.keepR + 3, 10, 3.2, 52, 5.2, 22, [SOUTH], false, 'inner');
    // Stone-faced slopes below each wall instead of bare earth, with walled ramps at the gates.
    this.glacis(E.outerR + 3, 4.2, E.outerR + 26, [SOUTH, NORTH]);
    this.glacis(E.middleR + 4, 3.6, E.middleR + 22, [SOUTH, NORTH]);
    this.glacis(E.keepR + 3, 3.2, E.keepR + 22, [SOUTH]);

    this.lowerYard(rand, at);
    this.middleCourts(rand, at);
    this.highHalls(rand, at);

    this.chimneys.push({ x: this.forgeStack.x, y: this.forgeStack.y, z: this.forgeStack.z, strength: 4 });
    this.materials = buildingMaterials(this.uNight);
    this.group = this.b.merge(this.materials);
    this.smoke = new Smoke(this.chimneys);
    this.group.add(this.smoke.mesh);
    this.group.name = 'Emberhold';
    this.colliders = this.b.colliders;
    console.info(`[emberhold] ${this.colliders.length} colliders, ${this.group.children.length} meshes`);
  }

  update(_dt: number, night: number) {
    // Shutters open and candles lit a little before full dark.
    this.uNight.value += (Math.min(1, night * 1.6) - this.uNight.value) * 0.05;
    this.smoke.uNight.value = this.uNight.value;
  }

  private ground(x: number, z: number) { return this.hf.height(x, z); }

  /**
   * A battered stone revetment over the scarp below a wall, following the ground from
   * under the wall's outer face to the foot of the slope. Gaps at the gates take the
   * ramps, which get low parapet walls on both sides so nobody walks off the edge.
   */
  private glacis(rWall: number, thick: number, rEnd: number, gates: number[]) {
    const b = this.b;
    const ROWS = 8, GAP = 7.5;
    const r0 = rWall + thick / 2 - 0.4, r1 = rEnd + 3;
    const nCol = Math.ceil((Math.PI * 2 * rWall) / 3);
    const pt = (a: number, r: number, lift: number) => {
      const rr = r * fortShape(a);
      const x = E.x + Math.cos(a) * rr, z = E.z + Math.sin(a) * rr;
      return [x, this.ground(x, z) + lift, z];
    };
    const pos: number[] = [];
    for (let c = 0; c < nCol; c++) {
      const a0 = (c / nCol) * Math.PI * 2, a1 = ((c + 1) / nCol) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      if (gates.some((g) => angDiff(am, g) * rWall * fortShape(g) < GAP)) continue;
      for (let row = 0; row < ROWS; row++) {
        const ra = r0 + (r1 - r0) * (row / ROWS), rb = r0 + (r1 - r0) * ((row + 1) / ROWS);
        const la = row === 0 ? 0.6 : 0.18, lb = row === ROWS - 1 ? -0.6 : 0.18;
        const p00 = pt(a0, ra, la), p10 = pt(a1, ra, la), p01 = pt(a0, rb, lb), p11 = pt(a1, rb, lb);
        pos.push(...p00, ...p10, ...p01, ...p10, ...p11, ...p01);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    b.add('stone', g);
    // Parapets along the ramps through the gaps.
    for (const gA of gates) {
      const ux = Math.cos(gA), uz = Math.sin(gA), tx = -uz, tz = ux;
      const sh = fortShape(gA);
      for (const side of [-1, 1]) {
        for (let r = r0 + 1; r < r1 + 10; r += 3) {
          const cx = E.x + ux * r * sh + tx * side * GAP, cz = E.z + uz * r * sh + tz * side * GAP;
          const y = this.ground(cx, cz);
          b.box('stone', 0.7, 1.3, 3.2, cx, y - 0.3, cz, -Math.atan2(tz, tx));
        }
      }
    }
  }

  /** A ring of wall segments with towers, gaps for gates flanked by gatehouses. */
  private wallRing(r: number, height: number, thick: number, towerEvery: number, towerR: number, towerH: number,
    gateAngles: number[], blackwood: boolean, name: string) {
    const b = this.b;
    const circ = Math.PI * 2 * r;
    const towers = Math.max(8, Math.round(circ / towerEvery));
    const gateHalf = 9 / r; // half-width of the gate opening (radians)
    const pts: { a: number; x: number; z: number }[] = [];
    for (let i = 0; i < towers; i++) {
      const a = (i / towers) * Math.PI * 2;
      if (gateAngles.some((g) => angDiff(a, g) < gateHalf * 2.6)) continue;
      const rr = r * fortShape(a);
      pts.push({ a, x: E.x + Math.cos(a) * rr, z: E.z + Math.sin(a) * rr });
    }
    // Add gate-flank points so walls meet the gatehouses exactly.
    for (const g of gateAngles) {
      for (const s of [-1, 1]) {
        const a = (g + s * gateHalf * 1.6 + Math.PI * 4) % (Math.PI * 2);
        const rr = r * fortShape(a);
        pts.push({ a, x: E.x + Math.cos(a) * rr, z: E.z + Math.sin(a) * rr });
      }
    }
    pts.sort((p, q) => p.a - q.a);
    // Wall base: the terrace level just inside the wall line.
    const baseAt = (x: number, z: number) => {
      const dx = x - E.x, dz = z - E.z, l = Math.hypot(dx, dz);
      return this.ground(E.x + (dx / l) * (l - thick), E.z + (dz / l) * (l - thick));
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const mid = (p.a + (q.a < p.a ? q.a + Math.PI * 2 : q.a)) / 2;
      if (gateAngles.some((g) => angDiff(mid, g) < gateHalf * 1.7)) continue; // the gate opening
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz);
      const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2;
      const rot = -Math.atan2(dz, dx);
      const base = Math.min(baseAt(p.x, p.z), baseAt(q.x, q.z)) - 4;
      const top = Math.max(baseAt(p.x, p.z), baseAt(q.x, q.z)) + height;
      b.box('stone', len + 0.6, top - base, thick, cx, base, cz, rot);
      // Crenellations along the outer edge of the wall walk.
      const nx = Math.cos(mid), nz = Math.sin(mid);
      const merlons = Math.floor(len / 2.2);
      for (let m = 0; m < merlons; m++) {
        const t = (m + 0.5) / merlons;
        const mx = p.x + dx * t + nx * (thick / 2 - 0.35), mz = p.z + dz * t + nz * (thick / 2 - 0.35);
        b.box('stone', 1.1, 1.3, 0.7, mx, top, mz, rot, false);
      }
    }
    // Towers at each point that isn't a gate flank.
    for (const p of pts) {
      if (gateAngles.some((g) => angDiff(p.a, g) < gateHalf * 2)) continue;
      const base = baseAt(p.x, p.z) - 5;
      const top = baseAt(p.x, p.z) + towerH;
      b.cyl('stone', towerR, top - base, p.x, base, p.z, 18);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        b.box('stone', 1.2, 1.3, 0.8, p.x + Math.cos(a) * (towerR - 0.4), top, p.z + Math.sin(a) * (towerR - 0.4), -a + Math.PI / 2, false);
      }
      if (name !== 'outer') b.cone('roofSlate', towerR + 0.8, towerR * 1.6, p.x, top, p.z, 18);
    }
    // Gatehouses: twin towers, an arch over the passage, and the gates themselves.
    for (const g of gateAngles) {
      const rr = r * fortShape(g);
      const gx = E.x + Math.cos(g) * rr, gz = E.z + Math.sin(g) * rr;
      const tx = -Math.sin(g), tz = Math.cos(g);
      const base = baseAt(gx, gz) - 5;
      const gateTop = baseAt(gx, gz) + towerH + 6;
      const gr = towerR + 1.2;
      const half = 4.4 + gr; // tower centres either side of an 8.8 m passage
      for (const s of [-1, 1]) {
        const x = gx + tx * s * half, z = gz + tz * s * half;
        b.cyl('stone', gr, gateTop - base, x, base, z, 20);
        b.cone('roofSlate', gr + 0.9, gr * 1.9, x, gateTop, z, 20);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          b.box('stone', 1.3, 1.3, 0.8, x + Math.cos(a) * (gr - 0.4), gateTop - 1.3, z + Math.sin(a) * (gr - 0.4), -a + Math.PI / 2, false);
        }
      }
      const rot = -Math.atan2(tz, tx);
      const floorY = baseAt(gx, gz);
      // The arch over the passage (8 m clear beneath), with a wall walk between the towers.
      b.box('stone', half * 2, gateTop - floorY - 8 - 2, thick + 4, gx, floorY + 8, gz, rot);
      b.box('stone', 8.8, 0.9, thick + 4.4, gx, floorY + 7.4, gz, rot, false); // lintel
      if (blackwood) {
        // The great blackwood gates banded in old iron, standing open against the passage walls.
        const ix = -Math.cos(g), iz = -Math.sin(g);
        for (const s of [-1, 1]) {
          const hx = gx + tx * s * 4.1 + ix * (thick / 2 + 2.4), hz = gz + tz * s * 4.1 + iz * (thick / 2 + 2.4);
          b.box('door', 0.45, 7.2, 4.4, hx, floorY - 0.2, hz, rot, false);
          for (let k = 0; k < 4; k++) b.box('iron', 0.55, 0.2, 4.45, hx, floorY + 0.8 + k * 1.8, hz, rot, false);
        }
      } else {
        // An iron portcullis, raised.
        for (let k = -3; k <= 3; k++) b.box('iron', 0.18, 2.4, 0.18, gx + tx * k * 1.2, floorY + 7.4 - 2.4, gz + tz * k * 1.2, rot, false);
      }
      if (name === 'outer') {
        if (Math.abs(g - SOUTH) < 0.01) this.gates.south.set(gx, floorY, gz);
        else this.gates.north.set(gx, floorY, gz);
      }
    }
  }

  /** A house: walls, door, windows, roof and maybe a chimney. */
  private house(x: number, z: number, rot: number, w: number, d: number, h: number, rand: () => number, opts: HouseOpts = {}) {
    buildHouse(this.b, (px, pz) => this.ground(px, pz), this.chimneys, x, z, rot, w, d, h, rand, opts);
  }

  private lowerYard(rand: () => number, at: (a: number, r: number) => THREE.Vector2) {
    const b = this.b;
    // Rows of buildings along ring streets; radial lanes every so often.
    // Back-to-back pairs of rows with lanes between, and a last row against the wall.
    const rows = [E.middleR + 36, E.middleR + 56, E.middleR + 76, E.middleR + 96, E.outerR - 24];
    for (const r of rows) {
      const inward = r === E.middleR + 56 || r === E.middleR + 96 || r === E.outerR - 24;
      let a = 0;
      while (a < Math.PI * 2) {
        const w = 8 + rand() * 7;
        const step = (w + 2 + rand() * 4) / (r * fortShape(a));
        a += step;
        const nearGate = angDiff(a, SOUTH) < 0.07 || angDiff(a, NORTH) < 0.07;
        const lane = (a % 0.42) < 0.035;
        if (nearGate || lane) continue;
        const p = at(a, r);
        const d = 7 + rand() * 3;
        const h = 4.5 + rand() * 4;
        const rot = -a + Math.PI / 2 + (inward ? Math.PI : 0); // fronts face the lanes
        const kind = rand();
        if (kind < 0.07) {
          // Granary tower
          const y = this.ground(p.x, p.y) - 1;
          b.cyl('stone', 5, 15, p.x, y, p.y, 18);
          b.cone('roofTile', 6, 7, p.x, y + 15, p.y, 18);
        } else if (kind < 0.16) {
          // Smithy / furnace shed: stone, big chimney
          this.house(p.x, p.y, rot, w + 3, d + 2, h, rand, { stone: true, chimney: true, roof: 'roofSlate', forge: true });
        } else if (kind < 0.24 && r > E.middleR + 90) {
          // Stable: long and low
          this.house(p.x, p.y, rot, w + 10, d, 4.2, rand, { timber: true });
        } else {
          this.house(p.x, p.y, rot, w, d, h, rand, { timber: rand() < 0.7, chimney: rand() < 0.5 });
        }
      }
    }
    // Barracks by the south gate.
    for (const s of [-1, 1]) {
      const p = at(SOUTH + s * 0.12, E.outerR - 35);
      this.house(p.x, p.y, -(SOUTH + s * 0.12) + Math.PI / 2, 30, 10, 7, rand, { stone: true, roof: 'roofSlate', chimney: true });
    }
  }

  private middleCourts(rand: () => number, at: (a: number, r: number) => THREE.Vector2) {
    const b = this.b;
    // The halls of the sworn households: Vhassarin, Ashmantle, Qelbar, Marrowyn, Halvane.
    const halls = [SOUTH + 0.55, SOUTH + 1.6, SOUTH + 2.7, SOUTH - 0.6, SOUTH - 1.7, SOUTH - 2.75];
    halls.forEach((a, i) => {
      const r = (E.keepR + E.middleR) / 2 + 12;
      const p = at(a, r);
      const rot = -a + Math.PI / 2;
      this.house(p.x, p.y, rot, 34, 14, 11, rand, { stone: true, roof: 'roofSlate', chimney: true });
      // Courtyard wall around each hall.
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [u, v, len, along] of [[0, 16, 44, true], [0, -14, 44, true], [-22, 1, 30, false], [22, 1, 30, false]] as [number, number, number, boolean][]) {
        const x = p.x + u * c + v * s, z = p.y - u * s + v * c;
        const gap = along && v > 0 ? 6 : 0;
        if (gap) {
          for (const side of [-1, 1]) {
            const uu = side * (len / 4 + gap / 4);
            b.box('stone', len / 2 - gap / 2, 4, 1.2, x + uu * c, this.ground(x + uu * c, z - uu * s) - 1, z - uu * s, rot);
          }
        } else {
          b.box('stone', along ? len : 1.2, 4, along ? 1.2 : len, x, this.ground(x, z) - 1, z, rot);
        }
      }
      // The Vhassarin hall keeps the rookery: a slender tower.
      if (i === 0) {
        const t = at(a + 0.08, r - 20);
        const y = this.ground(t.x, t.y) - 1;
        b.cyl('stone', 3.4, 30, t.x, y, t.y, 16);
        b.cone('roofSlate', 4.4, 8, t.x, y + 30, t.y, 16);
      }
    });
    // Houses of the sworn families in two rings between the halls, with gardens behind.
    for (const [r0, inward] of [[E.middleR - 22, true], [E.keepR + 48, false]] as [number, boolean][]) {
      for (let a = 0; a < Math.PI * 2;) {
        const w = 10 + rand() * 7;
        a += (w + 5 + rand() * 6) / r0;
        if (halls.some((h) => angDiff(a, h) < 0.2) || angDiff(a, SOUTH) < 0.09 || angDiff(a, NORTH) < 0.09) continue;
        const p = at(a, r0 + (rand() - 0.5) * 4);
        this.house(p.x, p.y, -a + Math.PI / 2 + (inward ? Math.PI : 0), w, 9 + rand() * 3, 6.5 + rand() * 4, rand,
          { stone: rand() < 0.65, roof: rand() < 0.55 ? 'roofSlate' : 'roofTile', chimney: true, timber: true });
      }
    }
  }

  private highHalls(rand: () => number, at: (a: number, r: number) => THREE.Vector2) {
    const b = this.b;
    const cx = E.x, cz = E.z;
    const y0 = this.ground(cx, cz);
    // The Hall of Cinders: a long hall facing the inner gate.
    const hall = at(SOUTH, 70);
    const rotHall = -SOUTH; // long axis points toward the gate
    this.house(hall.x, hall.y, rotHall + Math.PI / 2, 26, 58, 20, rand, { stone: true, roof: 'roofSlate' });
    // The keep: a tall square tower with corner turrets.
    const kx = cx - 10, kz = cz - 20;
    b.box('stone', 24, 62, 24, kx, y0 - 2, kz, 0.1);
    for (const [u, v] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
      const x = kx + u * Math.cos(0.1) + v * Math.sin(0.1), z = kz - u * Math.sin(0.1) + v * Math.cos(0.1);
      b.cyl('stone', 4, 72, x, y0 - 2, z, 16);
      b.cone('roofSlate', 4.9, 11, x, y0 + 70, z, 16);
    }
    b.pyramid('roofSlate', 24, 14, kx, y0 + 60, kz, 0.1);
    for (let f = 0; f < 12; f++) {
      for (const [u, v, rr] of [[0, 12.1, 0.1], [0, -12.1, 0.1], [12.1, 0, 0.1 + Math.PI / 2], [-12.1, 0, 0.1 + Math.PI / 2]]) {
        const x = kx + u * Math.cos(0.1) + v * Math.sin(0.1), z = kz - u * Math.sin(0.1) + v * Math.cos(0.1);
        if (f > 1 && rand() < 0.3) continue;
        b.box('window', 1.0, 1.8, 0.2, x, y0 + 4 + f * 4.6, z, rr, false);
      }
    }
    // Ranges of lesser buildings along the inside of the summit wall: kitchens,
    // bakehouse, stores, servants' halls, the household's records.
    for (let a = SOUTH + 0.16; a < SOUTH + Math.PI * 2 - 0.16;) {
      const w = 22 + rand() * 16;
      const r0 = E.keepR - 13;
      const step = w / (r0 * fortShape(a));
      const mid = a + step / 2;
      a += step + 4 / r0;
      if ([0.9, -0.9, 2.4, -2.4].some((o) => angDiff(mid, SOUTH + o) < 0.08)) continue;
      if (angDiff(mid, NORTH) < 0.32 || angDiff(mid, SOUTH - 1.3) < 0.2 || angDiff(mid, SOUTH + 1.3) < 0.2) continue;
      const p = at(mid, r0);
      this.house(p.x, p.y, -mid + Math.PI / 2 + Math.PI, w, 10, 8 + rand() * 3, rand, { stone: true, roof: 'roofSlate', chimney: rand() < 0.6 });
    }
    // A well in the great court and an orchard wall around the nursery garden.
    const well = at(SOUTH + 0.5, 40);
    b.cyl('stone', 1.6, 1.1, well.x, this.ground(well.x, well.y) - 0.2, well.y, 16);
    b.box('timber', 0.25, 3, 0.25, well.x - 1.3, this.ground(well.x, well.y), well.y, 0, false);
    b.box('timber', 0.25, 3, 0.25, well.x + 1.3, this.ground(well.x, well.y), well.y, 0, false);
    b.gable('roofTile', 3, 2.4, 1.2, well.x, this.ground(well.x, well.y) + 3, well.y, 0, 0.2);
    // Pale towers on the summit wall's shoulders.
    for (const a of [SOUTH + 0.9, SOUTH - 0.9, SOUTH + 2.4, SOUTH - 2.4]) {
      const p = at(a, E.keepR - 4);
      const y = this.ground(p.x, p.y) - 1;
      b.cyl('stone', 6.5, 44, p.x, y, p.y, 20);
      b.cone('roofSlate', 7.7, 14, p.x, y + 44, p.y, 20);
    }
    // Family wing (east) and nursery wing (west).
    const east = at(SOUTH - 1.3, 95), west = at(SOUTH + 1.3, 95);
    this.house(east.x, east.y, -(SOUTH - 1.3) + Math.PI / 2, 40, 14, 13, rand, { stone: true, roof: 'roofSlate', chimney: true });
    this.house(west.x, west.y, -(SOUTH + 1.3) + Math.PI / 2, 34, 13, 12, rand, { stone: true, roof: 'roofSlate', chimney: true });
    // The forge hall to the north, with the great stack whose smoke rises over the land.
    const forge = at(NORTH, 95);
    this.house(forge.x, forge.y, -NORTH + Math.PI / 2, 36, 20, 12, rand, { stone: true, roof: 'roofSlate' });
    const sy = this.ground(forge.x, forge.y) - 1;
    b.box('stone', 7, 52, 7, forge.x, sy, forge.y, -NORTH);
    this.forgeStack.set(forge.x, sy + 52, forge.y);
    // The vault stair: a low stone house over the way down.
    const vault = at(NORTH + 0.5, 60);
    this.house(vault.x, vault.y, -(NORTH + 0.5) + Math.PI / 2, 8, 8, 5, rand, { stone: true, roof: 'roofSlate' });
  }
}

