// Horses: a procedural body with jointed legs, real gaits (walk, trot, canter, gallop),
// grazing and wandering when left alone, and riding. The Maegyr families breed them in
// the horse fields east of Emberhold; Ilyan's own horse waits by the south road.
import * as THREE from 'three/webgpu';
import { float, vec3, mix, positionWorld, mx_noise_float, color, smoothstep } from 'three/tsl';
import RAPIER from '@dimforge/rapier3d-compat';
import { Heightfield } from './Heightfield';
import { Physics } from '../physics/Physics';
import { WATER_LEVEL, SPAWN } from './Layout';
import { mulberry32 } from './Noise';
import { riverDistance } from './WorldConfig';

export type Gait = 'idle' | 'walk' | 'trot' | 'canter' | 'gallop';

interface GaitSpec { freq: number; stance: number; swing: number; fold: number; bob: number; offsets: [number, number, number, number] }
// Leg order: left fore, right fore, left hind, right hind.
const GAITS: Record<Exclude<Gait, 'idle'>, GaitSpec> = {
  walk: { freq: 0.95, stance: 0.64, swing: 0.32, fold: 0.7, bob: 0.025, offsets: [0.25, 0.75, 0.0, 0.5] },
  trot: { freq: 1.45, stance: 0.48, swing: 0.42, fold: 1.1, bob: 0.06, offsets: [0.0, 0.5, 0.5, 0.0] },
  canter: { freq: 1.7, stance: 0.42, swing: 0.58, fold: 1.25, bob: 0.09, offsets: [0.32, 0.5, 0.0, 0.3] },
  gallop: { freq: 2.15, stance: 0.36, swing: 0.75, fold: 1.45, bob: 0.08, offsets: [0.5, 0.6, 0.0, 0.1] },
};

export function gaitForSpeed(v: number): Gait {
  const a = Math.abs(v);
  return a < 0.15 ? 'idle' : a < 2.6 ? 'walk' : a < 5.6 ? 'trot' : a < 9.2 ? 'canter' : 'gallop';
}
const GAIT_SPEED: Record<Gait, number> = { idle: 0, walk: 1.7, trot: 4.0, canter: 7.4, gallop: 12.5 };

// ------------------------------------------------------------------ materials
const COATS = {
  bay: { coat: 0x4a2a1a, points: 0x1a1210, mane: 0x15100d },
  chestnut: { coat: 0x6a3a1f, points: 0x5a321c, mane: 0x5b331e },
  black: { coat: 0x1b1714, points: 0x141110, mane: 0x0e0c0b },
  grey: { coat: 0x9a968f, points: 0x5f5a55, mane: 0xc8c4bc },
  dun: { coat: 0x9f8458, points: 0x2a211a, mane: 0x2a211a },
  brown: { coat: 0x3b2618, points: 0x1c1410, mane: 0x16110e },
};
type CoatName = keyof typeof COATS;

function coatMaterial(hex: number, dapple: boolean) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62 });
  const p = positionWorld;
  const n = mx_noise_float(p.mul(3.0)).mul(0.5).add(0.5);
  let c: any = color(hex).mul(n.mul(0.14).add(0.92));
  if (dapple) {
    const d = smoothstep(0.55, 0.75, mx_noise_float(p.mul(5.5)).mul(0.5).add(0.5));
    c = mix(c, c.mul(0.72), d);
  }
  m.colorNode = c;
  // A soft sheen along the coat.
  m.roughnessNode = float(0.55).add(n.mul(0.15));
  return m;
}
function hairMaterial(hex: number) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
  const p = positionWorld;
  const strands = mx_noise_float(vec3(p.x.mul(40.0), p.y.mul(3.0), p.z.mul(40.0))).mul(0.5).add(0.5);
  m.colorNode = color(hex).mul(strands.mul(0.35).add(0.8));
  return m;
}
const SHARED = {
  hoof: new THREE.MeshStandardNodeMaterial({ color: 0x2a2420, roughness: 0.55 }),
  eye: new THREE.MeshStandardNodeMaterial({ color: 0x050403, roughness: 0.08 }),
  leather: new THREE.MeshStandardNodeMaterial({ color: 0x3a2416, roughness: 0.6 }),
  cloth: new THREE.MeshStandardNodeMaterial({ color: 0x5c2a24, roughness: 0.95 }),
  iron: new THREE.MeshStandardNodeMaterial({ color: 0x8a8a88, roughness: 0.35, metalness: 0.9 }),
};

// ------------------------------------------------------------------ the body
/** Hind legs stand with the gaskin sloping back and the hock behind. */
const HIND_REST = 0.32;
/** A tapered limb segment hanging down from its pivot. */
function limb(r0: number, r1: number, len: number, mat: THREE.Material, flatten = 0.8) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, 2);
  g.translate(0, -len / 2, 0);
  g.scale(flatten, 1, 1);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** A tube from a to b, tapering from ra to rb, flattened sideways. */
function tube(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, mat: THREE.Material, flatten = 0.75, seg = 12) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 4);
  g.scale(flatten, 1, 1);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

class Leg {
  readonly upper = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly pastern = new THREE.Group();
  touched = true;
  constructor(parent: THREE.Object3D, at: THREE.Vector3, fore: boolean, coat: THREE.Material, points: THREE.Material) {
    this.upper.position.copy(at);
    parent.add(this.upper);
    const u = fore ? 0.58 : 0.56, l = fore ? 0.44 : 0.5;
    // Forearm or gaskin: muscled above, slim below.
    this.upper.add(limb(fore ? 0.135 : 0.17, 0.07, u, coat, fore ? 0.8 : 0.6));
    if (!fore) {
      // The thigh and stifle fill out the hindquarters.
      const th = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), coat);
      th.scale.set(0.7, 1.4, 1.1); th.position.set(0, -0.08, 0.02); th.castShadow = true;
      this.upper.add(th);
    }
    this.lower.position.set(0, -u, 0);
    this.upper.add(this.lower);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), points);
    joint.scale.set(0.8, 1, 1);
    this.lower.add(joint);
    this.lower.add(limb(0.06, 0.05, l, points, 0.8));
    this.pastern.position.set(0, -l, 0);
    this.lower.add(this.pastern);
    const fet = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), points);
    this.pastern.add(fet);
    const p = limb(0.05, 0.055, 0.13, points, 0.85);
    p.rotation.x = -0.35;
    this.pastern.add(p);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.078, 0.1, 12), SHARED.hoof);
    hoof.position.set(0, -0.17, 0.05);
    hoof.castShadow = true;
    this.pastern.add(hoof);
  }
}

export class HorseModel extends THREE.Group {
  readonly body = new THREE.Group();
  readonly neck = new THREE.Group();
  readonly head = new THREE.Group();
  readonly tail = new THREE.Group();
  readonly legs: Leg[] = [];
  /** Where the bit sits, for the reins (local to the head). */
  readonly bit = new THREE.Vector3(0, -0.36, 0.5);
  readonly saddle: THREE.Group | null = null;

  constructor(coatName: CoatName, saddled: boolean) {
    super();
    const spec = COATS[coatName];
    const coat = coatMaterial(spec.coat, coatName === 'grey');
    const points = coatMaterial(spec.points, false);
    const hair = hairMaterial(spec.mane);
    this.add(this.body);
    this.body.position.y = 1.22;

    // Barrel: a lathe profile along the body, narrower than it is deep.
    const prof = [[0.0, -1.0], [0.25, -0.96], [0.39, -0.8], [0.45, -0.5], [0.47, -0.15], [0.46, 0.2], [0.44, 0.5], [0.38, 0.75], [0.26, 0.9], [0.0, 0.96]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const barrel = new THREE.LatheGeometry(prof, 28);
    barrel.rotateX(Math.PI / 2);
    barrel.scale(0.74, 0.92, 0.86);
    const bm = new THREE.Mesh(barrel, coat);
    bm.castShadow = true; bm.receiveShadow = true;
    this.body.add(bm);
    // Croup, shoulders, chest and withers.
    const lump = (r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), coat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true;
      this.body.add(m);
    };
    lump(0.36, 0, 0.1, -0.56, 0.98, 0.82, 1.05); // croup
    lump(0.32, 0, 0.08, 0.46, 0.94, 0.95, 0.95); // shoulders
    lump(0.26, 0, -0.06, 0.66, 0.95, 1.0, 0.75); // chest
    lump(0.16, 0, 0.32, 0.36, 0.5, 0.65, 1.4); // withers

    // Legs.
    const LF = new THREE.Vector3(0.19, -0.02, 0.56), LH = new THREE.Vector3(0.2, 0.05, -0.6);
    this.legs.push(new Leg(this.body, LF, true, coat, points));
    this.legs.push(new Leg(this.body, LF.clone().setX(-0.19), true, coat, points));
    this.legs.push(new Leg(this.body, LH, false, coat, points));
    this.legs.push(new Leg(this.body, LH.clone().setX(-0.2), false, coat, points));

    // Neck, rising forward from the chest; the head hangs from the poll.
    this.neck.position.set(0, 0.12, 0.62);
    this.body.add(this.neck);
    const poll = new THREE.Vector3(0, 0.78, 0.48);
    this.neck.add(tube(new THREE.Vector3(0, -0.05, -0.05), poll, 0.3, 0.16, coat, 0.62, 14));
    // Crest of the neck and the mane along it.
    const crest = tube(new THREE.Vector3(0, 0.18, -0.2), poll.clone().add(new THREE.Vector3(0, 0.02, -0.08)), 0.1, 0.06, hair, 0.35, 8);
    crest.position.x += 0.0;
    this.neck.add(crest);
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const a = new THREE.Vector3(0, 0.2, -0.22).lerp(poll.clone().add(new THREE.Vector3(0, 0.05, -0.08)), t);
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.09), hair);
      strand.position.copy(a).add(new THREE.Vector3(0.05, -0.08, 0));
      strand.rotation.set(0.5, 0, 0.25);
      strand.castShadow = true;
      this.neck.add(strand);
    }
    this.head.position.copy(poll);
    this.neck.add(this.head);
    // Skull to muzzle, angled down; cheeks; jaw; ears; eyes; nostrils.
    const muzzle = new THREE.Vector3(0, -0.4, 0.5);
    this.head.add(tube(new THREE.Vector3(0, 0.02, -0.02), muzzle, 0.15, 0.085, coat, 0.72, 14));
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), coat);
    cheek.position.set(0, -0.1, 0.1); cheek.scale.set(0.75, 1, 1.2); cheek.castShadow = true;
    this.head.add(cheek);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), points);
    nose.position.copy(muzzle).add(new THREE.Vector3(0, 0, 0.01)); nose.scale.set(0.85, 0.9, 1.1);
    this.head.add(nose);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 8), coat);
      ear.position.set(s * 0.06, 0.1, 0.0); ear.rotation.set(-0.25, 0, s * -0.2);
      this.head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), SHARED.eye);
      eye.position.set(s * 0.1, -0.06, 0.14);
      this.head.add(eye);
    }
    // Forelock.
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.03), hair);
    fl.position.set(0, 0.0, 0.08); fl.rotation.x = 0.7;
    this.head.add(fl);

    // Tail: dock and a long fall of hair in two segments so it can swish.
    this.tail.position.set(0, 0.22, -0.86);
    this.body.add(this.tail);
    const dock = tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.2, -0.14), 0.07, 0.06, hair, 1, 8);
    this.tail.add(dock);
    const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.75, 10, 3), hair);
    fall.geometry.translate(0, -0.375, 0);
    fall.position.set(0, -0.18, -0.15); fall.rotation.x = -0.18; fall.castShadow = true;
    fall.name = 'fall';
    this.tail.add(fall);

    if (saddled) {
      const saddle = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.62, 18, 1, true, -1.25, 2.5), SHARED.leather);
      seat.rotation.set(-Math.PI / 2, 0, 0); seat.scale.set(0.82, 1, 1);
      seat.position.set(0, 0.0, 0.05);
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), SHARED.leather);
      pommel.position.set(0, 0.47, 0.32); pommel.scale.set(1.3, 0.8, 0.8);
      const cantle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), SHARED.leather);
      cantle.position.set(0, 0.47, -0.24); cantle.scale.set(1.5, 0.7, 0.5);
      const blanket = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.82, 18, 1, true, -1.45, 2.9), SHARED.cloth);
      blanket.rotation.set(-Math.PI / 2, 0, 0); blanket.scale.set(0.8, 1, 1);
      blanket.position.set(0, -0.02, 0.05);
      saddle.add(seat, pommel, cantle, blanket);
      for (const s of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.05), SHARED.leather);
        strap.position.set(s * 0.37, -0.1, 0.08);
        const stirrup = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), SHARED.iron);
        stirrup.position.set(s * 0.38, -0.45, 0.08); stirrup.rotation.y = Math.PI / 2;
        saddle.add(strap, stirrup);
      }
      // Bridle: a noseband and cheek straps.
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16), SHARED.leather);
      band.position.copy(muzzle).add(new THREE.Vector3(0, 0.08, -0.1)); band.rotation.x = Math.PI / 2 - 0.7; band.scale.set(0.8, 1, 1);
      this.head.add(band);
      saddle.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      saddle.position.set(0, 0.0, 0.0);
      this.body.add(saddle);
      (this as any).saddle = saddle;
    }
  }

  /**
   * Pose the legs for a gait at a cycle phase (0..1); `blend` fades from standing.
   * Returns the legs whose hoof just touched down (for hoofbeats).
   */
  animate(gait: Gait, phase: number, blend: number, t: number, graze: number, dt: number) {
    const touched: number[] = [];
    if (gait === 'idle') {
      const e = Math.min(1, dt * 6);
      this.legs.forEach((l, i) => {
        const rest = i < 2 ? 0 : HIND_REST;
        l.upper.rotation.x += (rest - l.upper.rotation.x) * e;
        l.lower.rotation.x += (-rest * 2 - l.lower.rotation.x) * e;
        l.pastern.rotation.x += (rest - l.pastern.rotation.x) * e;
      });
      this.body.position.y += (1.22 - this.body.position.y) * Math.min(1, dt * 4);
      this.body.rotation.x *= 1 - Math.min(1, dt * 4);
    } else {
      const g = GAITS[gait];
      this.legs.forEach((l, i) => {
        const p = (phase + g.offsets[i]) % 1;
        const fore = i < 2;
        let ang: number, fold = 0;
        if (p < g.stance) {
          const s = p / g.stance;
          ang = -g.swing + 2 * g.swing * s; // forward to back while planted
          if (!l.touched) { l.touched = true; touched.push(i); }
        } else {
          const s = (p - g.stance) / (1 - g.stance);
          ang = g.swing - 2 * g.swing * (0.5 - 0.5 * Math.cos(Math.PI * s));
          fold = Math.sin(Math.PI * s) * g.fold;
          l.touched = false;
        }
        const k = Math.min(1, blend);
        const rest = fore ? 0 : HIND_REST;
        l.upper.rotation.x = rest + ang * k * (fore ? 1 : 0.85);
        // Fore knees fold the cannon back; hocks bend the other way.
        l.lower.rotation.x = (fore ? fold : -fold * 0.8) * k - rest * 2;
        l.pastern.rotation.x = (fore ? fold * 0.6 : fold * 0.7) * k;
      });
      const bob = Math.sin(phase * Math.PI * 4) * g.bob;
      this.body.position.y = 1.22 + bob * blend;
      // The canter and gallop rock the body fore and aft.
      const rock = gait === 'canter' || gait === 'gallop' ? Math.sin(phase * Math.PI * 2) * 0.05 : 0;
      this.body.rotation.x = rock * blend;
    }
    // Head: nods with the stride, drops to graze when idle.
    const nod = gait === 'walk' ? Math.sin(phase * Math.PI * 4) * 0.06 : gait === 'idle' ? 0 : Math.sin(phase * Math.PI * 2) * 0.05;
    this.neck.rotation.x = graze * 1.05 + nod - (gait === 'gallop' ? 0.25 : 0);
    this.head.rotation.x = graze * 0.4 + (gait === 'gallop' ? 0.2 : 0);
    // Tail: swish when standing, stream out behind at speed.
    const fall = this.tail.getObjectByName('fall')!;
    const speedLift = gait === 'gallop' ? 1 : gait === 'canter' ? 0.6 : gait === 'trot' ? 0.3 : 0;
    this.tail.rotation.x = -0.15 - speedLift * 0.7;
    this.tail.rotation.z = Math.sin(t * (gait === 'idle' ? 1.3 : 3)) * (gait === 'idle' ? 0.25 : 0.08);
    fall.rotation.x = -0.18 - speedLift * 0.5 + Math.sin(t * 2.1) * 0.05;
    return touched;
  }
}

// ------------------------------------------------------------------ a horse in the world
export class Horse {
  readonly model: HorseModel;
  x: number; z: number; y = 0;
  /** Heading: forward is (-sin yaw, -cos yaw), as for the player. */
  yaw: number;
  speed = 0;
  gait: Gait = 'idle';
  phase = 0;
  blend = 0;
  graze = 0;
  ridden = false;
  name: string;
  // Wandering
  private aiTimer = 0;
  target: THREE.Vector2 | null = null;
  private home: THREE.Vector2;
  private roam: number;
  private rand: () => number;

  constructor(name: string, coat: CoatName, saddled: boolean, x: number, z: number, yaw: number, roam: number, seed: number) {
    this.name = name;
    this.model = new HorseModel(coat, saddled);
    this.x = x; this.z = z; this.yaw = yaw;
    this.home = new THREE.Vector2(x, z);
    this.roam = roam;
    this.rand = mulberry32(seed);
    this.aiTimer = this.rand() * 8;
    const s = 0.94 + this.rand() * 0.12;
    this.model.scale.setScalar(s);
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  /** Left to itself: graze, amble to a new patch, now and then trot. */
  think(dt: number) {
    this.aiTimer -= dt;
    if (this.roam <= 0) { this.speed = 0; this.graze += ((Math.sin(this.aiTimer * 0.2) > 0.3 ? 1 : 0) - this.graze) * Math.min(1, dt * 0.8); return; }
    if (this.target) {
      const dx = this.target.x - this.x, dz = this.target.y - this.z;
      const d = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += Math.max(-1, Math.min(1, dy)) * dt * 0.9;
      const run = this.aiTimer < -100;
      const v = d < 3 ? 0 : run ? GAIT_SPEED.trot : GAIT_SPEED.walk * 0.85;
      this.speed += (v - this.speed) * Math.min(1, dt * 1.5);
      this.graze += (0 - this.graze) * Math.min(1, dt * 2);
      if (d < 3 || this.aiTimer < -30) { this.target = null; this.aiTimer = 6 + this.rand() * 18; }
    } else {
      this.speed += (0 - this.speed) * Math.min(1, dt * 2);
      this.graze += (1 - this.graze) * Math.min(1, dt * 0.6);
      if (this.aiTimer < 0) {
        const a = this.rand() * Math.PI * 2, r = this.rand() * this.roam;
        const tx = this.home.x + Math.cos(a) * r, tz = this.home.y + Math.sin(a) * r;
        if (riverDistance(tx, tz) > 6) this.target = new THREE.Vector2(tx, tz);
        this.aiTimer = this.rand() < 0.12 ? -101 : 0; // sometimes a short trot
      }
    }
    const f = this.forward;
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
  }

  /** Advance the stride and pose the body. Returns legs that touched down. */
  animate(dt: number, t: number) {
    const g = gaitForSpeed(this.speed);
    if (g !== 'idle' && this.gait !== 'idle' && g !== this.gait) {
      // Keep the phase continuous when changing gait.
    }
    this.gait = g;
    this.blend += ((g === 'idle' ? 0 : 1) - this.blend) * Math.min(1, dt * 5);
    if (g !== 'idle') {
      const spec = GAITS[g];
      // Stride frequency scales a little with speed inside a gait.
      const ratio = Math.abs(this.speed) / GAIT_SPEED[g];
      this.phase = (this.phase + dt * spec.freq * (0.75 + 0.25 * ratio) * Math.sign(this.speed || 1) + 1) % 1;
    }
    return this.model.animate(g, this.phase, this.blend, t, this.graze, dt);
  }

  place(hf: Heightfield) {
    // Sit on the ground, pitched to the slope between fore and hind hooves.
    const f = this.forward;
    const hf1 = hf.height(this.x + f.x * 0.75, this.z + f.z * 0.75);
    const hb = hf.height(this.x - f.x * 0.75, this.z - f.z * 0.75);
    const groundY = Math.max((hf1 + hb) / 2, WATER_LEVEL - 1.2);
    this.y = this.ridden ? this.y : groundY - 0.08;
    this.model.position.set(this.x, this.y, this.z);
    this.model.rotation.set(0, this.yaw + Math.PI, 0);
    this.model.rotateX(-Math.atan2(hf1 - hb, 1.5) * 0.9);
  }
}

// ------------------------------------------------------------------ the herd and riding
export class Horses {
  readonly group = new THREE.Group();
  readonly list: Horse[] = [];
  mounted: Horse | null = null;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;
  private controller: RAPIER.KinematicCharacterController | null = null;
  private vy = 0;
  private reins: THREE.Mesh[] = [];

  constructor(private hf: Heightfield, private physics: Physics) {
    const rand = mulberry32(4040);
    // Ilyan's horse, waiting by the south road.
    this.add(new Horse('Ashfoot', 'bay', true, SPAWN.x + 7, SPAWN.z - 4, SPAWN.yaw + 0.4, 0, 1));
    // The Maegyr horse fields east of Emberhold.
    const coats: CoatName[] = ['bay', 'chestnut', 'black', 'grey', 'dun', 'brown', 'bay', 'chestnut', 'bay', 'grey', 'brown', 'chestnut'];
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2, r = rand() * 260;
      this.add(new Horse(`horse ${i}`, coats[i], false, 2450 + Math.cos(a) * r, -1100 + Math.sin(a) * r * 0.7, rand() * Math.PI * 2, 320, 100 + i));
    }
    // Saddled horses tied by the stables in Emberhold's lower yard and at the Green Perch.
    const stable = [[1000, -330], [1006, -334], [800, -330]];
    stable.forEach(([x, z], i) => this.add(new Horse(`stable ${i}`, i === 1 ? 'black' : 'chestnut', true, x, z, rand() * 6, 0, 200 + i)));
    this.add(new Horse('Green Perch mare', 'grey', true, -1310, 1985, 1.2, 0, 300));
    this.add(new Horse('Quillhaven cob', 'dun', false, -1250, 2010, 2.6, 30, 301));
    for (const h of this.list) h.place(hf);
    // Reins: two thin straps from the rider's hands to the bit.
    const rmat = new THREE.MeshStandardNodeMaterial({ color: 0x2c1c12, roughness: 0.7 });
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 5), rmat);
      r.visible = false;
      r.frustumCulled = false;
      this.reins.push(r);
      this.group.add(r);
    }
  }

  private add(h: Horse) { this.list.push(h); this.group.add(h.model); }

  /** The horse the player could mount: close, and roughly in front. */
  nearest(p: THREE.Vector3, look: THREE.Vector3) {
    let best: Horse | null = null, bd = 3.6;
    for (const h of this.list) {
      const dx = h.x - p.x, dz = h.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (d > 1.2 && (dx * look.x + dz * look.z) / d < 0.2) continue;
      best = h; bd = d;
    }
    return best;
  }

  mount(h: Horse) {
    this.mounted = h;
    h.ridden = true;
    h.target = null;
    h.graze = 0;
    const w = this.physics.world;
    const cy = h.y + 1.06;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(h.x, cy, h.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.6).setFriction(0), this.body);
    this.controller = w.createCharacterController(0.03);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.5, 0.3, false);
    this.controller.enableSnapToGround(0.6);
    this.controller.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
    this.vy = 0;
    for (const r of this.reins) r.visible = true;
  }

  /** Get down on the horse's left side. Returns where to stand. */
  dismount(): THREE.Vector3 {
    const h = this.mounted!;
    const f = h.forward;
    const left = new THREE.Vector3(f.z, 0, -f.x).multiplyScalar(-1);
    let p = new THREE.Vector3(h.x + left.x * 1.3, 0, h.z + left.z * 1.3);
    if (riverDistance(p.x, p.z) < 1) p = new THREE.Vector3(h.x - left.x * 1.3, 0, h.z - left.z * 1.3);
    p.y = this.hf.height(p.x, p.z) + 0.05;
    h.ridden = false;
    h.speed = 0;
    this.mounted = null;
    const w = this.physics.world;
    if (this.collider) w.removeCollider(this.collider, false);
    if (this.body) w.removeRigidBody(this.body);
    if (this.controller) w.removeCharacterController(this.controller);
    this.body = null; this.collider = null; this.controller = null;
    for (const r of this.reins) r.visible = false;
    return p;
  }

  /**
   * Ride: W to go (trot), Shift for canter then gallop, Ctrl to keep to a walk, S to
   * rein in and back up, A/D to turn, Space to jump. Returns the rider's eye position.
   */
  ride(dt: number, keys: { f: number; r: number; run: boolean; walk: boolean; jump: boolean }, out: THREE.Vector3) {
    const h = this.mounted!;
    let target = 0;
    if (keys.f > 0) target = keys.walk ? GAIT_SPEED.walk : keys.run ? (h.speed > 7 ? GAIT_SPEED.gallop : GAIT_SPEED.canter + 0.6) : GAIT_SPEED.trot;
    else if (keys.f < 0) target = h.speed > 0.5 ? 0 : -1.1;
    const accel = target > h.speed ? (h.speed < 4 ? 2.2 : 1.6) : 4.5;
    h.speed += Math.sign(target - h.speed) * Math.min(Math.abs(target - h.speed), accel * dt);
    // Turning is quicker at a walk than at a gallop.
    const turn = THREE.MathUtils.lerp(1.6, 0.75, Math.min(1, Math.abs(h.speed) / 12));
    const dyaw = -keys.r * turn * dt * (Math.abs(h.speed) > 0.1 || keys.r ? 1 : 0);
    h.yaw += dyaw;
    const f = h.forward;
    let dx = f.x * h.speed * dt, dz = f.z * h.speed * dt;
    // Horses won't walk into deep water.
    const ahead = this.hf.height(h.x + f.x * 2.5 * Math.sign(h.speed || 1), h.z + f.z * 2.5 * Math.sign(h.speed || 1));
    if (ahead < WATER_LEVEL - 1.3 && h.speed > 0) { dx = 0; dz = 0; h.speed *= 0.5; }
    // Gravity and a modest jump.
    const grounded = this.controller!.computedGrounded();
    if (grounded) { this.vy = -1; if (keys.jump && h.speed > 2) this.vy = 4.6; }
    this.vy -= 9.81 * dt;
    const desired = { x: dx, y: this.vy * dt, z: dz };
    this.controller!.computeColliderMovement(this.collider!, desired);
    const m = this.controller!.computedMovement();
    const t = this.body!.translation();
    const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    // If something stopped us, lose speed.
    const moved = Math.hypot(m.x, m.z), wanted = Math.hypot(dx, dz);
    if (wanted > 0.001 && moved < wanted * 0.4) h.speed *= 0.85;
    this.body!.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    h.x = nx; h.z = nz;
    h.y = ny - 1.05;
    h.y = Math.max(h.y, this.hf.height(nx, nz) - 0.1);
    // The rider's eyes: above the saddle, moving with the body.
    h.place(this.hf);
    const body = h.model.body;
    body.updateWorldMatrix(true, false);
    out.set(0, 1.3, -0.14).applyMatrix4(body.matrixWorld);
    return out;
  }

  /** Stretch the reins from the rider's hands to the bit. */
  updateReins(hands: THREE.Vector3[]) {
    const h = this.mounted;
    if (!h) return;
    h.model.head.updateWorldMatrix(true, false);
    for (let i = 0; i < 2; i++) {
      const bit = new THREE.Vector3((i ? -1 : 1) * 0.09, -0.32, 0.42).applyMatrix4(h.model.head.matrixWorld);
      const a = hands[i];
      const r = this.reins[i];
      const len = a.distanceTo(bit);
      r.position.copy(a).add(bit).multiplyScalar(0.5);
      r.scale.set(1, len, 1);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bit.clone().sub(a).normalize());
    }
  }

  /** Animate horses near the camera; hide distant ones. */
  update(dt: number, t: number, cam: THREE.Vector3, onHoof: (h: Horse, leg: number) => void) {
    for (const h of this.list) {
      const d = Math.hypot(h.x - cam.x, h.z - cam.z);
      h.model.visible = d < 900;
      if (!h.ridden) {
        if (d > 450) continue; // too far to matter
        h.think(dt);
        h.place(this.hf);
      }
      if (d < 300) {
        const touched = h.animate(dt, t);
        if (d < 60) for (const leg of touched) onHoof(h, leg);
      }
    }
  }
}
