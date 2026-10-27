// First-person arms and hands. The hands are real anatomical models with a full finger
// skeleton (WebXR generic hands, MIT); the fingers are posed by forward kinematics and
// blend between natural grips. The arms swing in time with your stride, pump with
// fists when you run, lift as you jump, give on landing, hold the reins on horseback,
// grip a torch, and do a real breaststroke in deep water.
import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, smoothstep, color, uv, sin } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Player } from './Player';

// ------------------------------------------------------------------ materials
function skinMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0 });
  // Skin scatters light: a warm sheen at grazing angles stands in for subsurface glow.
  m.sheen = 0.35;
  m.sheenRoughness = 0.5;
  m.sheenColor = new THREE.Color(0xd9785c);
  m.specularIntensity = 0.45;
  const p = positionLocal;
  const pores = mx_noise_float(p.mul(900.0)).mul(0.5).add(0.5);
  const tone = mx_noise_float(p.mul(60.0)).mul(0.5).add(0.5);
  const blotch = mx_noise_float(p.mul(22.0)).mul(0.5).add(0.5);
  // Fingers (further from the wrist, lower y in the model) are a little redder.
  const tips = smoothstep(-0.02, -0.11, p.y);
  let c: any = mix(color(0xb07a5e), color(0xc08a6c), tone.mul(0.7));
  c = mix(c, color(0xb5654f), blotch.mul(0.25).add(tips.mul(0.35)));
  m.colorNode = c.mul(pores.mul(0.06).add(0.97));
  m.roughnessNode = float(0.46).add(pores.mul(0.12));
  return m;
}

function clothMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.94, metalness: 0 });
  m.sheen = 1.0;
  m.sheenRoughness = 0.75;
  m.sheenColor = new THREE.Color(0x5e5245);
  // Woven wool: fine cross-hatch from the sleeve's UVs, plus uneven dye.
  const weave = sin(uv().x.mul(900.0)).mul(sin(uv().y.mul(420.0))).mul(0.5).add(0.5);
  const dye = mx_noise_float(positionLocal.mul(18.0)).mul(0.5).add(0.5);
  m.colorNode = mix(color(0x2e2620), color(0x463a2f), dye.mul(0.7)).mul(weave.mul(0.18).add(0.9));
  m.roughnessNode = float(0.9).add(weave.mul(0.08));
  return m;
}

// ------------------------------------------------------------------ finger poses
// Per finger (index, middle, ring, little): flexion at the knuckle, middle and end joints.
type Curls = [number, number, number][];
interface HandPose { fingers: Curls; thumb: [number, number, number]; thumbIn: number; spread: number }

const POSES: Record<'relaxed' | 'fist' | 'grip' | 'open' | 'reach', HandPose> = {
  relaxed: { fingers: [[0.22, 0.32, 0.18], [0.3, 0.4, 0.22], [0.38, 0.46, 0.26], [0.46, 0.5, 0.28]], thumb: [0.12, 0.18, 0.15], thumbIn: 0.15, spread: 0.6 },
  fist: { fingers: [[1.45, 1.6, 0.95], [1.5, 1.65, 0.95], [1.5, 1.65, 0.95], [1.45, 1.6, 0.9]], thumb: [0.45, 0.65, 0.55], thumbIn: 0.55, spread: 0 },
  grip: { fingers: [[1.15, 1.35, 0.75], [1.2, 1.4, 0.8], [1.25, 1.4, 0.8], [1.25, 1.35, 0.75]], thumb: [0.35, 0.45, 0.3], thumbIn: 0.5, spread: 0.1 },
  open: { fingers: [[0.05, 0.08, 0.04], [0.04, 0.06, 0.04], [0.05, 0.08, 0.05], [0.07, 0.1, 0.06]], thumb: [0.0, 0.05, 0.05], thumbIn: 0.05, spread: 0.15 },
  reach: { fingers: [[0.45, 0.55, 0.3], [0.5, 0.6, 0.35], [0.55, 0.62, 0.35], [0.6, 0.65, 0.35]], thumb: [0.2, 0.25, 0.2], thumbIn: 0.25, spread: 0.4 },
};
type PoseName = keyof typeof POSES;

const FINGER_NAMES = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const SPREADS = [0.07, 0.0, -0.06, -0.13]; // natural fan of the fingers (radians, scaled by pose.spread)
const CUP = [0.0, 0.02, 0.06, 0.12];     // the palm cups toward the little finger

/** A skinned hand model posed by forward kinematics through its joint chains. */
class SkinnedHand {
  readonly holder = new THREE.Group();
  private bones = new Map<string, THREE.Object3D>();
  private rest = new Map<string, THREE.Matrix4>();
  private rel = new Map<string, THREE.Matrix4>();
  private chains: string[][] = [];
  private thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
  private tmp = new THREE.Matrix4();
  private rot = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(scene: THREE.Object3D, readonly side: 1 | -1, skin: THREE.Material) {
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone || /finger|thumb|wrist/.test(o.name)) this.bones.set(o.name, o);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        const m = o as THREE.SkinnedMesh;
        m.material = skin;
        m.frustumCulled = false;
        m.castShadow = false;
        m.receiveShadow = true;
        m.renderOrder = 10;
      }
    });
    scene.updateMatrixWorld(true);
    for (const [name, b] of this.bones) this.rest.set(name, new THREE.Matrix4().compose(b.position, b.quaternion, b.scale));
    for (const f of FINGER_NAMES) this.chains.push(['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((s) => `${f}-${s}`));
    const relOf = (parent: string, child: string) => {
      this.rel.set(child, this.rest.get(parent)!.clone().invert().multiply(this.rest.get(child)!));
    };
    for (const c of this.chains) { relOf('wrist', c[0]); for (let i = 1; i < c.length; i++) relOf(c[i - 1], c[i]); }
    relOf('wrist', this.thumb[0]);
    for (let i = 1; i < this.thumb.length; i++) relOf(this.thumb[i - 1], this.thumb[i]);
    // Re-base the model: wrist at the origin, fingers forward (-Z), back of the hand up (+Y),
    // thumb toward the body's centre line.
    const wrist = this.bones.get('wrist')!.position.clone();
    scene.position.copy(wrist).multiplyScalar(-1);
    const basis = side === 1
      ? new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
      : new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));
    const inner = new THREE.Group();
    inner.quaternion.setFromRotationMatrix(basis);
    inner.add(scene);
    this.holder.add(inner);
    this.holder.scale.setScalar(1.06);
  }

  private set(name: string, m: THREE.Matrix4) {
    const b = this.bones.get(name);
    if (b) m.decompose(b.position, b.quaternion, b.scale);
  }

  /** Pose the fingers: curls per finger, thumb flexion, thumb across the palm, fan. */
  pose(p: HandPose) {
    const wrist = this.rest.get('wrist')!;
    this.chains.forEach((c, fi) => {
      let m = wrist.clone().multiply(this.rel.get(c[0])!);
      m.multiply(this.rot.makeRotationX(-CUP[fi] * (0.3 + p.fingers[fi][0] * 0.5)));
      this.set(c[0], m);
      for (let k = 1; k < c.length; k++) {
        m = m.clone().multiply(this.rel.get(c[k])!);
        if (k <= 3) {
          const curl = p.fingers[fi][k - 1];
          this.e.set(-curl, k === 1 ? SPREADS[fi] * p.spread : 0, 0, 'YXZ');
          m.multiply(this.tmp.makeRotationFromEuler(this.e));
        }
        this.set(c[k], m);
      }
    });
    let m = wrist.clone().multiply(this.rel.get(this.thumb[0])!);
    // The thumb swings across the palm (about the metacarpal's long axis) as well as bending.
    this.e.set(-p.thumb[0], -p.thumbIn * 0.6, p.thumbIn * 0.5, 'YXZ');
    m.multiply(this.tmp.makeRotationFromEuler(this.e));
    this.set(this.thumb[0], m);
    for (let k = 1; k < this.thumb.length; k++) {
      m = m.clone().multiply(this.rel.get(this.thumb[k])!);
      if (k <= 2) m.multiply(this.rot.makeRotationX(-p.thumb[k]));
      this.set(this.thumb[k], m);
    }
    void this.q;
  }
}

function blendPose(out: HandPose, a: HandPose, b: HandPose, t: number) {
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) out.fingers[i][k] = a.fingers[i][k] + (b.fingers[i][k] - a.fingers[i][k]) * t;
  for (let k = 0; k < 3; k++) out.thumb[k] = a.thumb[k] + (b.thumb[k] - a.thumb[k]) * t;
  out.thumbIn = a.thumbIn + (b.thumbIn - a.thumbIn) * t;
  out.spread = a.spread + (b.spread - a.spread) * t;
  return out;
}
const clonePose = (p: HandPose): HandPose => ({ fingers: p.fingers.map((f) => [...f] as [number, number, number]), thumb: [...p.thumb] as [number, number, number], thumbIn: p.thumbIn, spread: p.spread });

// ------------------------------------------------------------------ arm targets
interface ArmTarget { x: number; y: number; z: number; rx: number; ry: number; rz: number }

/** Breaststroke keyframes for the right hand (left is mirrored): glide, outsweep, insweep, recovery. */
const STROKE: [number, ArmTarget][] = [
  [0.0, { x: 0.05, y: -0.13, z: -0.56, rx: 0.05, ry: 0.0, rz: -0.1 }],  // arms out in front, palms down
  [0.28, { x: 0.3, y: -0.14, z: -0.5, rx: 0.1, ry: -0.5, rz: -0.9 }],    // sweep out, palms turned out
  [0.52, { x: 0.13, y: -0.21, z: -0.33, rx: -0.15, ry: -0.35, rz: -0.75 }], // pull down and in to the chest
  [0.7, { x: 0.075, y: -0.17, z: -0.33, rx: 0.1, ry: 0.2, rz: -0.35 }],    // hands together under the chin
  [0.86, { x: 0.05, y: -0.13, z: -0.56, rx: 0.05, ry: 0.0, rz: -0.1 }],  // shoot forward and glide
  [1.0, { x: 0.05, y: -0.13, z: -0.56, rx: 0.05, ry: 0.0, rz: -0.1 }],
];
function strokeAt(t: number, out: ArmTarget) {
  let i = 0;
  while (i < STROKE.length - 2 && t > STROKE[i + 1][0]) i++;
  const [t0, a] = STROKE[i], [t1, b] = STROKE[i + 1];
  let u = (t - t0) / Math.max(1e-4, t1 - t0);
  u = u * u * (3 - 2 * u);
  for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}

interface Arm {
  root: THREE.Group;      // placed in camera space
  hand: THREE.Group;      // the wrist; the skinned hand hangs from it
  side: 1 | -1;
  skinned: SkinnedHand | null;
  cur: ArmTarget;
  vel: ArmTarget;
  pose: HandPose;
  /** Things held in this hand (a torch) attach here. */
  grip: THREE.Group;
}

export class Viewmodel {
  readonly rig = new THREE.Group();
  private arms: Arm[] = [];
  private lagX = 0;
  private lagY = 0;
  private swim = 0;
  private air = 0;
  private runBlend = 0;
  private walkBlend = 0;
  private t = 0;
  private skin = skinMaterial();
  private cloth = clothMaterial();
  visible = true;
  /** Set while in the saddle; rideBob is the horse's vertical motion for the hands. */
  riding = false;
  rideBob = 0;
  private rideBlend = 0;
  /** What the right hand holds. */
  holding: 'none' | 'torch' = 'none';
  private holdBlend = 0;
  /** 0..1 reaching up to grab a ledge (climbing). */
  reach = 0;

  constructor(camera: THREE.Camera) {
    for (const side of [1, -1] as const) this.arms.push(this.buildArm(side));
    for (const a of this.arms) this.rig.add(a.root);
    this.rig.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        o.frustumCulled = false;
        o.renderOrder = 10;
      }
    });
    camera.add(this.rig);
  }

  /** Load the hand models (call once at start-up). */
  async load(base = document.baseURI) {
    const loader = new GLTFLoader();
    await Promise.all(this.arms.map(async (a) => {
      const gltf = await loader.loadAsync(new URL(`./models/hands/${a.side === 1 ? 'right' : 'left'}.glb`, base).toString());
      a.skinned = new SkinnedHand(gltf.scene, a.side, this.skin);
      a.hand.add(a.skinned.holder);
      a.skinned.pose(a.pose);
    }));
  }

  /** The right hand's grip point, for holding things. */
  get rightGrip() { return this.arms[0].grip; }

  private buildArm(side: 1 | -1): Arm {
    const root = new THREE.Group();
    // Forearm in a wool sleeve, running back from the wrist toward the elbow.
    const profile: THREE.Vector2[] = [];
    const L = 0.36;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const r = 0.033 + t * 0.022 + Math.sin(t * Math.PI) * 0.004;
      profile.push(new THREE.Vector2(r, t * L));
    }
    const sleeveGeo = new THREE.LatheGeometry(profile, 22);
    sleeveGeo.rotateX(Math.PI / 2); // Y axis -> +Z (back toward the elbow)
    sleeveGeo.scale(1.1, 0.92, 1);
    sleeveGeo.translate(0, 0.004, 0.045);
    const sleeve = new THREE.Mesh(sleeveGeo, this.cloth);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 8, 24), this.cloth);
    cuff.scale.set(1.1, 0.92, 1);
    cuff.position.set(0, 0.004, 0.046);
    // Bare wrist between the cuff and the hand.
    const wristGeo = new THREE.CapsuleGeometry(0.024, 0.05, 4, 12);
    wristGeo.rotateX(Math.PI / 2);
    wristGeo.scale(1.25, 0.85, 1);
    const wrist = new THREE.Mesh(wristGeo, this.skin);
    wrist.position.z = 0.03;
    root.add(sleeve, cuff, wrist);
    const hand = new THREE.Group();
    root.add(hand);
    const grip = new THREE.Group();
    grip.position.set(0.0, -0.03, -0.075);
    hand.add(grip);
    const cur: ArmTarget = { x: 0.17 * side, y: -0.3, z: -0.36, rx: 0.3, ry: 0.2 * side, rz: 0 };
    return { root, hand, side, skinned: null, cur, vel: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, pose: clonePose(POSES.relaxed), grip };
  }

  /** World positions of the two fists (for the reins). */
  grips(out: THREE.Vector3[]) {
    this.arms.forEach((a, i) => {
      a.hand.updateWorldMatrix(true, false);
      out[i].set(0, -0.025, -0.05).applyMatrix4(a.hand.matrixWorld);
    });
    return out;
  }

  update(dt: number, p: Player, mouseDX: number, mouseDY: number) {
    this.rig.visible = this.visible;
    if (!this.visible) return;
    this.t += dt;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // Look lag: the arms trail the view a little when turning.
    this.lagX += (THREE.MathUtils.clamp(-mouseDX * 0.0006, -0.06, 0.06) - this.lagX) * k(9);
    this.lagY += (THREE.MathUtils.clamp(mouseDY * 0.0006, -0.05, 0.05) - this.lagY) * k(9);
    this.swim += ((p.swimming ? 1 : 0) - this.swim) * k(3);
    this.air += ((!p.grounded && !p.swimming ? 1 : 0) - this.air) * k(7);
    this.runBlend += ((p.sprinting && p.speed > 3.2 ? 1 : 0) - this.runBlend) * k(5);
    this.walkBlend += ((p.speed > 0.4 && !p.sprinting ? Math.min(1, p.speed / 1.8) : 0) - this.walkBlend) * k(5);
    this.rideBlend += ((this.riding ? 1 : 0) - this.rideBlend) * k(5);
    this.holdBlend += ((this.holding !== 'none' ? 1 : 0) - this.holdBlend) * k(6);
    const breath = Math.sin(this.t * 1.5) * 0.003;

    this.rig.position.set(this.lagX, -this.lagY + breath + p.landDip * 0.5 + this.air * 0.02, 0);
    this.rig.rotation.set(this.lagY * 0.8, this.lagX * 1.3, this.lagX * 0.7);

    const tgt: ArmTarget = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    const sw: ArmTarget = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    for (const a of this.arms) {
      const s = a.side;
      // Arm swing: each arm swings opposite its leg, one full swing per two steps.
      const swing = Math.sin(p.bobPhase + (s === 1 ? 0 : Math.PI));
      const stepBob = -Math.cos(p.bobPhase * 2); // body rises mid-stride, drops at each footfall

      // Standing: hands low at the edges of the view, relaxed.
      tgt.x = 0.17; tgt.y = -0.215; tgt.z = -0.4; tgt.rx = 0.28; tgt.ry = 0.2; tgt.rz = -0.12;
      // Walking: a loose pendulum, hand rising a little as it swings forward.
      const wb = this.walkBlend * (1 - this.runBlend);
      tgt.z += -swing * 0.085 * wb;
      tgt.y += (Math.max(0, swing) * 0.035 - 0.01 + stepBob * 0.008) * wb;
      tgt.rx += swing * 0.22 * wb;
      tgt.x += -Math.abs(swing) * 0.01 * wb;
      // Running: elbows bent, fists pumping up into view.
      const rb = this.runBlend;
      tgt.x = THREE.MathUtils.lerp(tgt.x, 0.15, rb);
      tgt.y = THREE.MathUtils.lerp(tgt.y, -0.2 + Math.max(0, swing) * 0.075 + stepBob * 0.012, rb);
      tgt.z = THREE.MathUtils.lerp(tgt.z, -0.33 - swing * 0.15, rb);
      tgt.rx = THREE.MathUtils.lerp(tgt.rx, 0.75 + swing * 0.55, rb);
      tgt.ry = THREE.MathUtils.lerp(tgt.ry, 0.35, rb);
      tgt.rz = THREE.MathUtils.lerp(tgt.rz, -0.35, rb);
      // In the air: arms come up and out for balance.
      tgt.y += this.air * 0.06; tgt.x += this.air * 0.03; tgt.z -= this.air * 0.04; tgt.rx += this.air * 0.2;
      // Reaching up for a ledge.
      if (this.reach > 0.001) {
        const r = this.reach;
        tgt.x = THREE.MathUtils.lerp(tgt.x, 0.16, r); tgt.y = THREE.MathUtils.lerp(tgt.y, 0.02, r);
        tgt.z = THREE.MathUtils.lerp(tgt.z, -0.42, r); tgt.rx = THREE.MathUtils.lerp(tgt.rx, -0.5, r);
        tgt.rz = THREE.MathUtils.lerp(tgt.rz, 0.2, r);
      }
      // Swimming: a breaststroke.
      if (this.swim > 0.001) {
        strokeAt(p.swimPhase % 1, sw);
        for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) tgt[key] = THREE.MathUtils.lerp(tgt[key], sw[key], this.swim);
      }
      // Riding: both fists low and forward over the withers, holding the reins.
      if (this.rideBlend > 0.001) {
        const r = this.rideBlend, jog = this.rideBob * 0.6;
        tgt.x = THREE.MathUtils.lerp(tgt.x, 0.1, r); tgt.y = THREE.MathUtils.lerp(tgt.y, -0.26 + jog, r);
        tgt.z = THREE.MathUtils.lerp(tgt.z, -0.4, r); tgt.rx = THREE.MathUtils.lerp(tgt.rx, 0.55, r);
        tgt.ry = THREE.MathUtils.lerp(tgt.ry, 0.05, r); tgt.rz = THREE.MathUtils.lerp(tgt.rz, -0.9, r);
      }
      // Holding a torch: the right hand carries it up and forward, swaying with the stride.
      if (s === 1 && this.holdBlend > 0.001) {
        const h = this.holdBlend;
        tgt.x = THREE.MathUtils.lerp(tgt.x, 0.2, h);
        tgt.y = THREE.MathUtils.lerp(tgt.y, -0.24 + stepBob * 0.01 * (wb + rb), h);
        tgt.z = THREE.MathUtils.lerp(tgt.z, -0.42 - swing * 0.03 * (wb + rb), h);
        tgt.rx = THREE.MathUtils.lerp(tgt.rx, 0.55, h); tgt.ry = THREE.MathUtils.lerp(tgt.ry, 0.1, h);
        tgt.rz = THREE.MathUtils.lerp(tgt.rz, -1.35, h);
      }
      // Spring toward the target: arms have weight and overshoot a touch.
      for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) {
        const goal = key === 'x' ? tgt.x * s : key === 'ry' || key === 'rz' ? tgt[key] * s : tgt[key];
        const stiff = 140, damp = 2 * Math.sqrt(stiff) * 0.82;
        a.vel[key] += ((goal - a.cur[key]) * stiff - a.vel[key] * damp) * dt;
        a.cur[key] += a.vel[key] * dt;
      }
      a.root.position.set(a.cur.x, a.cur.y, a.cur.z);
      a.root.rotation.set(a.cur.rx, a.cur.ry, a.cur.rz, 'YXZ');
      // Wrist: palm down and slightly inward, flexing with the swing.
      a.hand.rotation.set(-0.12 + swing * 0.08 * wb, 0.1 * s, -0.3 * s);

      // Fingers.
      let pose = POSES.relaxed;
      const blended = a.pose;
      blendPose(blended, POSES.relaxed, POSES.open, Math.min(1, this.swim * (sw.rz < -0.6 ? 0.9 : 1)));
      if (rb > 0.01) blendPose(blended, clonePose(blended), POSES.fist, rb);
      if (this.rideBlend > 0.01) blendPose(blended, clonePose(blended), POSES.grip, this.rideBlend);
      if (s === 1 && this.holdBlend > 0.01) blendPose(blended, clonePose(blended), POSES.grip, this.holdBlend);
      if (this.reach > 0.01) blendPose(blended, clonePose(blended), POSES.reach, this.reach);
      // Small idle life in the fingers.
      const idle = Math.sin(this.t * 0.7 + s * 1.3) * 0.04 * (1 - rb);
      for (const f of blended.fingers) f[0] += idle;
      void pose;
      pose = blended;
      a.skinned?.pose(pose);
    }
  }
}
