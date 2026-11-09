// The things in Emberhold's streets and courts: market stalls on the gate avenues, wells,
// carts, barrels, hay and benches by the trades, signs, the house's banners, torches and
// braziers that are lit at dusk, and stone stairs up onto the outer wall walk.
import * as THREE from 'three/webgpu';
import { color, mix, positionWorld, mx_noise_float, time, sin, float, uniform, smoothstep } from 'three/tsl';
import { Builder, SOUTH, NORTH, type Bucket, type Collider } from './Emberhold';
import type { Heightfield } from './Heightfield';
import { type Building, localToWorld } from './Buildings';
import { EMBERHOLD as E, fortShape } from './Layout';
import { mulberry32 } from './Noise';

export interface Fire { x: number; y: number; z: number; strength: number }
export interface Stall { x: number; z: number; face: number }

export class Props {
  readonly group = new THREE.Group();
  readonly colliders: Collider[];
  /** Torches and braziers: where the light comes from at night. */
  readonly fires: Fire[] = [];
  /** Market stalls (each wants a seller in the day). */
  readonly stalls: Stall[] = [];
  /** Wells in the yard (people fetch water). */
  readonly wells: { x: number; z: number }[] = [];
  readonly uNight = uniform(0);
  private lights: THREE.PointLight[] = [];
  private b = new Builder();
  private flames: THREE.InstancedMesh;

  constructor(private hf: Heightfield, buildings: Building[], walls: { ring: string; ax: number; az: number; bx: number; bz: number; top: number; thick: number; mid: number }[],
    materials: Record<Bucket, THREE.Material>) {
    const rand = mulberry32(2718);
    this.market(rand);
    for (const b of buildings) this.byTrade(b, rand);
    this.banners(buildings);
    this.gateFires();
    this.wallStairs(walls);
    this.group.add(this.b.merge(materials));
    this.colliders = this.b.colliders;
    // Flames: one instanced quad cross per fire, flickering, brighter at night.
    const g = new THREE.PlaneGeometry(0.34, 0.6); g.translate(0, 0.3, 0);
    const g2 = g.clone(); g2.rotateY(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    const a = g.toNonIndexed(), c = g2.toNonIndexed();
    const pos = new Float32Array(a.attributes.position.array.length * 2);
    pos.set(a.attributes.position.array as Float32Array); pos.set(c.attributes.position.array as Float32Array, a.attributes.position.array.length);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const p = positionWorld;
    const n = mx_noise_float(p.mul(6.0).add(time.mul(2.5).mul(float(1)))).mul(0.5).add(0.5);
    const flick = sin(time.mul(11.0).add(p.x.mul(3.0))).mul(0.12).add(1.0);
    m.colorNode = mix(color(0xff6a18), color(0xffd58a), n).mul(flick).mul(mix(float(0.0), float(3.2), this.uNight));
    m.opacityNode = smoothstep(0.15, 0.6, n).mul(this.uNight).mul(0.95);
    this.flames = new THREE.InstancedMesh(merged, m, this.fires.length);
    const M = new THREE.Matrix4();
    this.fires.forEach((f, i) => { M.makeScale(f.strength, f.strength, f.strength).setPosition(f.x, f.y, f.z); this.flames.setMatrixAt(i, M); });
    this.flames.frustumCulled = false;
    this.group.add(this.flames);
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
      this.lights.push(l);
      this.group.add(l);
    }
    this.group.name = 'Props';
  }

  /** Lights on the fires nearest the player, after dusk. */
  update(player: THREE.Vector3, night: number, t: number) {
    this.uNight.value = Math.min(1, night * 1.5);
    if (night < 0.05) { for (const l of this.lights) l.visible = false; return; }
    const near = this.fires.map((f) => ({ f, d: Math.hypot(f.x - player.x, f.z - player.z) })).filter((x) => x.d < 60).sort((a, b) => a.d - b.d);
    this.lights.forEach((l, i) => {
      const n = near[i];
      if (!n) { l.visible = false; return; }
      l.visible = true;
      l.position.set(n.f.x, n.f.y + 0.4, n.f.z);
      l.intensity = (14 + 6 * Math.sin(t * 9 + i * 1.7) * 0.3) * this.uNight.value * n.f.strength;
    });
  }

  private ground(x: number, z: number) { return this.hf.height(x, z); }
  private at(a: number, r: number): [number, number] {
    const rr = r * fortShape(a);
    return [E.x + Math.cos(a) * rr, E.z + Math.sin(a) * rr];
  }

  // ---------------------------------------------------------------- market
  private market(rand: () => number) {
    for (const g of [SOUTH, NORTH]) {
      for (const side of [-1, 1]) {
        for (let r = 362; r < 432; r += 9.5) {
          const a = g + side * (17 / r);
          const [x, z] = this.at(a, r);
          // Face across the avenue, toward its middle.
          const face = Math.atan2(side * Math.sin(g), -side * Math.cos(g));
          this.stall(x, z, face, rand);
        }
        // A well at each end of the market.
        const [wx, wz] = this.at(g + side * 0.012, 352 + (side > 0 ? 0 : 88));
        this.well(wx, wz);
      }
    }
  }

  private stall(x: number, z: number, face: number, rand: () => number) {
    const b = this.b, y = this.ground(x, z);
    const c = Math.cos(face), s = Math.sin(face);
    // Local frame: u across the stall front, v toward the customer (rotY = face - pi/2 maps +z to facing).
    const rot = face;
    const P = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    for (const [u, v] of [[-1.3, -0.8], [1.3, -0.8], [-1.3, 0.8], [1.3, 0.8]]) {
      const [px, pz] = P(u, v);
      b.box('timber', 0.12, 2.5, 0.12, px, y - 0.2, pz, rot, false);
    }
    const [cx, cz] = P(0, 0.5);
    b.box('timber', 2.7, 0.9, 0.8, cx, y - 0.1, cz, rot);
    // Striped awning, sloping toward the customer.
    const awn = new THREE.BoxGeometry(3.0, 0.04, 2.1);
    awn.rotateX(0.22); awn.rotateY(rot); awn.translate(x, y + 2.35, z);
    b.add('cloth', awn);
    // Goods: baskets, crates, cloth, bread, pots.
    for (let i = 0; i < 6; i++) {
      const [gx, gz] = P(-1.1 + i * 0.44, 0.5 + (rand() - 0.5) * 0.3);
      const k = rand();
      if (k < 0.3) b.cyl('thatch', 0.17, 0.18, gx, y + 0.8, gz, 8, false);
      else if (k < 0.6) b.box('timber', 0.35, 0.22, 0.3, gx, y + 0.8, gz, rot + rand() * 0.3, false);
      else if (k < 0.8) b.box('cloth', 0.36, 0.12, 0.3, gx, y + 0.8, gz, rot, false);
      else b.cyl('roofTile', 0.1, 0.22, gx, y + 0.8, gz, 8, false);
    }
    const [sx, sz] = P(0, -0.6);
    this.stalls.push({ x: sx, z: sz, face });
  }

  private well(x: number, z: number) {
    const b = this.b, y = this.ground(x, z);
    b.cyl('stone', 1.4, 1.0, x, y - 0.2, z, 16);
    b.box('timber', 0.22, 2.8, 0.22, x - 1.15, y, z, 0, false);
    b.box('timber', 0.22, 2.8, 0.22, x + 1.15, y, z, 0, false);
    b.box('timber', 2.6, 0.18, 0.18, x, y + 2.6, z, 0, false);
    b.gable('roofTile', 2.8, 2.0, 1.0, x, y + 2.75, z, 0, 0.15);
    this.wells.push({ x, z });
  }

  // ---------------------------------------------------------------- by the doors
  private byTrade(bd: Building, rand: () => number) {
    const b = this.b;
    const side = rand() < 0.5 ? -1 : 1;
    // Beside the door, against the front wall, clear of the doorway and its steps.
    const spot = (along: number, out: number): [number, number, number] => {
      const u = bd.door.u + side * (bd.door.w / 2 + 1.1 + along);
      if (Math.abs(u) > bd.w / 2 - 0.4) return [NaN, NaN, NaN];
      const [x, z] = localToWorld(bd, u, bd.d / 2 + out);
      return [x, this.ground(x, z), z];
    };
    const sign = (col: Bucket) => {
      // A hanging sign on a bracket over the door.
      const [x, z] = localToWorld(bd, bd.door.u + side * 1.2, bd.d / 2 + 0.55);
      const y = bd.fy + 2.75;
      b.box('iron', 0.05, 0.05, 0.9, x, y + 0.5, z, bd.rot, false);
      b.box(col, 0.6, 0.45, 0.05, x, y, z, bd.rot + Math.PI / 2, false);
    };
    switch (bd.kind) {
      case 'smithy': {
        for (let i = 0; i < 2; i++) { const [x, y, z] = spot(i * 0.8, 0.5); if (!isNaN(x)) b.cyl('timber', 0.3, 0.85, x, y - 0.05, z, 10); }
        const [x, y, z] = spot(2.2, 1.2);
        if (!isNaN(x) && rand() < 0.6) this.cart(x, y, z, bd.rot + Math.PI / 2 + (rand() - 0.5) * 0.4);
        sign('iron');
        break;
      }
      case 'stable': {
        for (let i = 0; i < 3; i++) { const [x, y, z] = spot(i * 1.2, 0.6); if (!isNaN(x)) b.box('thatch', 1.0, 0.5, 0.5, x, y - 0.05, z, bd.rot + rand() * 0.2); }
        const [x, y, z] = spot(4, 0.6); if (!isNaN(x)) b.box('timber', 1.6, 0.55, 0.5, x, y - 0.05, z, bd.rot);
        break;
      }
      case 'inn': {
        for (let i = 0; i < 2; i++) { const [x, y, z] = spot(i * 2.2, 0.9); if (!isNaN(x)) b.box('timber', 1.6, 0.45, 0.35, x, y - 0.03, z, bd.rot); }
        const [x, y, z] = spot(4.6, 0.5); if (!isNaN(x)) { b.cyl('timber', 0.3, 0.85, x, y - 0.05, z, 10); }
        sign('cloth');
        this.fires.push(this.lantern(bd));
        break;
      }
      case 'bakery': case 'chandlery': case 'weaver': case 'cooper': {
        const [x, y, z] = spot(0.2, 0.5);
        if (!isNaN(x)) { if (bd.kind === 'cooper') b.cyl('timber', 0.3, 0.85, x, y - 0.05, z, 10); else b.cyl('thatch', 0.25, 0.55, x, y - 0.05, z, 8); }
        sign(bd.kind === 'bakery' ? 'thatch' : bd.kind === 'weaver' ? 'cloth' : 'timber');
        break;
      }
      case 'house': {
        if (rand() < 0.25) { const [x, y, z] = spot(0.2 + rand(), 0.45); if (!isNaN(x)) (rand() < 0.5 ? b.cyl('timber', 0.28, 0.8, x, y - 0.05, z, 10) : b.box('timber', 0.6, 0.6, 0.6, x, y - 0.05, z, bd.rot + rand())); }
        if (rand() < 0.12) { const [x, y, z] = spot(0.4, 0.55); if (!isNaN(x)) b.box('timber', 1.5, 0.45, 0.35, x, y - 0.03, z, bd.rot); }
        break;
      }
      case 'vaultStair': {
        // The door is barred outside with old iron.
        const [x, z] = localToWorld(bd, bd.door.u, bd.d / 2 + 0.12);
        b.box('iron', 1.6, 0.14, 0.08, x, bd.fy + 1.05, z, bd.rot, false);
        b.box('iron', 1.6, 0.14, 0.08, x, bd.fy + 1.75, z, bd.rot, false);
        for (const s of [-1, 1]) { const [sx, sz] = localToWorld(bd, bd.door.u + s * 0.82, bd.d / 2 + 0.14); b.box('iron', 0.16, 0.9, 0.12, sx, bd.fy + 0.95, sz, bd.rot, false); }
        break;
      }
      case 'swornHall': case 'hallOfCinders': case 'familyWing': case 'nurseryWing': case 'forgeHall': {
        // Iron brackets with torches either side of the great doors.
        for (const s of [-1, 1]) {
          const [x, z] = localToWorld(bd, bd.door.u + s * 1.25, bd.d / 2 + 0.25);
          const y = bd.fy + 2.2;
          b.box('iron', 0.08, 0.5, 0.25, x, y - 0.25, z, bd.rot, false);
          b.cyl('timber', 0.04, 0.5, x, y, z, 6, false);
          this.fires.push({ x, y: y + 0.45, z, strength: 0.6 });
        }
        break;
      }
    }
  }

  private lantern(bd: Building): Fire {
    const [x, z] = localToWorld(bd, bd.door.u - 1.0, bd.d / 2 + 0.35);
    const y = bd.fy + 2.3;
    this.b.box('iron', 0.2, 0.3, 0.2, x, y, z, bd.rot, false);
    return { x, y: y + 0.02, z, strength: 0.35 };
  }

  private cart(x: number, y: number, z: number, rot: number) {
    const b = this.b, c = Math.cos(rot), s = Math.sin(rot);
    const P = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    b.box('timber', 1.3, 0.12, 2.2, x, y + 0.6, z, rot);
    for (const su of [-1, 1]) {
      const [sx, sz] = P(su * 0.65, 0); b.box('timber', 0.06, 0.4, 2.2, sx, y + 0.7, sz, rot, false);
      const [wx, wz] = P(su * 0.72, -0.2);
      const wheel = new THREE.CylinderGeometry(0.48, 0.48, 0.08, 14); wheel.rotateZ(Math.PI / 2); wheel.rotateY(rot); wheel.translate(wx, y + 0.48, wz);
      b.add('timber', wheel);
    }
    for (const su of [-1, 1]) { const [hx, hz] = P(su * 0.3, 1.9); b.box('timber', 0.07, 0.07, 1.8, hx, y + 0.55, hz, rot, false); }
    const [lx, lz] = P(0, -0.3); b.box('thatch', 1.0, 0.4, 1.2, lx, y + 0.72, lz, rot, false);
  }

  // ---------------------------------------------------------------- the house's colours
  private banners(buildings: Building[]) {
    // The Vaelaros colours, black on red, hung from the great buildings of the summit.
    const b = this.b;
    for (const bd of buildings) {
      if (bd.kind !== 'hallOfCinders' && bd.kind !== 'familyWing' && bd.kind !== 'forgeHall' && bd.kind !== 'nurseryWing') continue;
      const n = bd.kind === 'hallOfCinders' ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const u = (i - (n - 1) / 2) * Math.min(5, bd.w / (n + 1));
        if (Math.abs(u - bd.door.u) < 1.8) continue;
        const [x, z] = localToWorld(bd, u, bd.d / 2 + 0.08);
        const top = bd.top - 0.6;
        b.box('iron', 1.6, 0.06, 0.06, x, top + 0.05, z, bd.rot, false);
        b.box('banner', 1.3, 4.2, 0.02, x, top - 4.2, z, bd.rot, false);
        b.box('door', 1.32, 0.3, 0.03, x, top - 1.1, z, bd.rot, false);
        b.box('door', 1.32, 0.3, 0.03, x, top - 3.6, z, bd.rot, false);
      }
    }
  }

  // ---------------------------------------------------------------- night fires
  private gateFires() {
    const b = this.b;
    const gates: [number, number, number][] = [[SOUTH, E.outerR + 3, 4.2], [NORTH, E.outerR + 3, 4.2], [SOUTH, E.middleR + 4, 3.6], [NORTH, E.middleR + 4, 3.6], [SOUTH, E.keepR + 3, 3.2]];
    for (const [a, r, thick] of gates) {
      // A brazier on a stone foot either side of the inner mouth of each gate.
      const [gx, gz] = this.at(a, r - thick / 2 - 6.5);
      const tx = -Math.sin(a), tz = Math.cos(a);
      for (const s of [-1, 1]) {
        const x = gx + tx * s * 6, z = gz + tz * s * 6, y = this.ground(x, z);
        b.cyl('stone', 0.35, 0.9, x, y - 0.1, z, 10);
        b.cyl('iron', 0.42, 0.3, x, y + 0.8, z, 12, false);
        this.fires.push({ x, y: y + 1.05, z, strength: 1.3 });
      }
    }
    // Braziers in the summit's great court.
    for (const da of [-0.35, 0.35]) {
      const [x, z] = this.at(SOUTH + da, 52);
      const y = this.ground(x, z);
      b.cyl('stone', 0.35, 0.9, x, y - 0.1, z, 10);
      b.cyl('iron', 0.42, 0.3, x, y + 0.8, z, 12, false);
      this.fires.push({ x, y: y + 1.05, z, strength: 1.3 });
    }
  }

  // ---------------------------------------------------------------- up on the walls
  private wallStairs(walls: { ring: string; ax: number; az: number; bx: number; bz: number; top: number; thick: number; mid: number }[]) {
    // Stone stairs against the inside of the outer wall: beside each gate and at the quarters.
    const want = [SOUTH + 0.16, SOUTH - 0.16, NORTH + 0.16, NORTH - 0.16, SOUTH + Math.PI / 2, SOUTH - Math.PI / 2];
    for (const a of want) {
      let best: typeof walls[number] | null = null, bd = Infinity;
      for (const w of walls) {
        if (w.ring !== 'outer') continue;
        let d = Math.abs(w.mid - ((a + Math.PI * 4) % (Math.PI * 2)));
        d = Math.min(d, Math.PI * 2 - d);
        if (d < bd) { bd = d; best = w; }
      }
      if (best) this.stair(best);
    }
  }

  private stair(w: { ax: number; az: number; bx: number; bz: number; top: number; thick: number }) {
    const b = this.b;
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const dx = (w.bx - w.ax) / len, dz = (w.bz - w.az) / len;
    // Inward normal (toward the fort's centre).
    let nx = -dz, nz = dx;
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
    if ((E.x - mx) * nx + (E.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
    const off = w.thick / 2 + 0.85;
    // Start at ground level near one end; climb along the wall to the top.
    const sx = mx + nx * off - dx * 2, sz = mz + nz * off - dz * 2;
    const y0 = this.ground(sx, sz);
    const rise = w.top - y0;
    if (rise < 3 || rise > 20) return;
    const n = Math.ceil(rise / 0.22), run = n * 0.26;
    if (run > len - 6) return;
    const rot = -Math.atan2(dz, dx); // box x axis along the wall
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * 0.26;
      const x = sx + dx * t, z = sz + dz * t;
      const top = y0 + (i + 1) * (rise / n);
      const gy = this.ground(x, z);
      b.box('stone', 0.26, top - (gy - 0.5), 1.6, x, gy - 0.5, z, rot, false);
    }
    // Landing against the wall walk, and a parapet on the open side.
    const ex = sx + dx * (run + 0.8), ez = sz + dz * (run + 0.8);
    b.box('stone', 1.6, 0.4, 1.7, ex, w.top - 0.4, ez, rot, true);
    const pitch = Math.atan2(rise, run);
    const cx = sx + dx * run / 2 + nx * 0, cz = sz + dz * run / 2;
    // The walking surface: a ramp collider along the treads.
    // The walking surface: a ramp collider along the treads (local z runs up the stair).
    this.b.colliders.push({ kind: 'box', x: cx, y: y0 + rise / 2 - 0.06, z: cz, hx: 0.8, hy: 0.08, hz: Math.hypot(run, rise) / 2, rotY: Math.atan2(dx, dz), rotX: -pitch });
    // A low parapet along the open side, solid enough to stop a fall.
    this.b.colliders.push({ kind: 'box', x: cx + nx * 0.85, y: y0 + rise / 2 + 0.55, z: cz + nz * 0.85, hx: 0.1, hy: 0.55, hz: Math.hypot(run, rise) / 2, rotY: Math.atan2(dx, dz), rotX: -pitch });
    for (let i = 0; i < n; i += 3) {
      const t = (i + 0.5) * 0.26;
      const x = sx + dx * t + nx * 0.85, z = sz + dz * t + nz * 0.85;
      b.box('stone', 0.8, 0.9, 0.2, x, y0 + (i + 1) * (rise / n), z, rot, false);
    }
  }
}
