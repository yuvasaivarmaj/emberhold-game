// First-person arms and hands. Built from simple shapes for now, posed and animated
// in code: they swing with your stride, pump when you run, lag slightly behind the
// camera as you look around, rise when you jump and stroke when you swim.
import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, smoothstep, color, uv, sin } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Player } from './Player';

interface FingerSpec { x: number; z: number; lens: [number, number, number]; r: number; splay: number; curl: [number, number, number] }

const FINGERS: FingerSpec[] = [
  { x: -0.027, z: -0.044, lens: [0.041, 0.025, 0.02], r: 0.0088, splay: 0.06, curl: [0.25, 0.42, 0.3] },  // index
  { x: -0.009, z: -0.047, lens: [0.045, 0.028, 0.021], r: 0.009, splay: 0.0, curl: [0.32, 0.5, 0.32] },   // middle
  { x: 0.009, z: -0.045, lens: [0.042, 0.026, 0.02], r: 0.0086, splay: -0.05, curl: [0.4, 0.56, 0.34] },  // ring
  { x: 0.026, z: -0.04, lens: [0.033, 0.02, 0.018], r: 0.0076, splay: -0.12, curl: [0.48, 0.6, 0.36] },   // little
];

function segment(len: number, r: number) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -len / 2);
  return g;
}

function skinMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.52, metalness: 0 });
  m.sheen = 0.2;
  m.sheenRoughness = 0.6;
  m.sheenColor = new THREE.Color(0xffb59a);
  const n = mx_noise_float(positionLocal.mul(120.0)).mul(0.5).add(0.5);
  const blotch = mx_noise_float(positionLocal.mul(35.0)).mul(0.5).add(0.5);
  const base = mix(color(0x8f5f45), color(0xa87458), n.mul(0.6));
  m.colorNode = mix(base, color(0x9a5446), smoothstep(0.6, 0.9, blotch).mul(0.35));
  // A hint of light scattering through skin.
  m.emissiveNode = color(0x5a1f12).mul(0.06);
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

interface Arm {
  root: THREE.Group;      // placed in camera space
  hand: THREE.Group;
  joints: THREE.Group[][]; // per finger, three joints
  thumb: THREE.Group[];
  side: 1 | -1;
}

export class Viewmodel {
  readonly rig = new THREE.Group();
  private arms: Arm[] = [];
  private lagX = 0;
  private lagY = 0;
  private swim = 0;
  private air = 0;
  private sprintBlend = 0;
  private t = 0;
  visible = true;

  constructor(camera: THREE.Camera) {
    const skin = skinMaterial();
    const cloth = clothMaterial();
    for (const side of [1, -1] as const) this.arms.push(this.buildArm(side, skin, cloth));
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

  private buildArm(side: 1 | -1, skin: THREE.Material, cloth: THREE.Material): Arm {
    const root = new THREE.Group();
    root.scale.x = side; // left arm mirrors the right

    // Forearm in a wool sleeve, running back from the wrist toward the elbow.
    const profile: THREE.Vector2[] = [];
    const L = 0.34;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 0.036 + t * 0.02 + Math.sin(t * Math.PI) * 0.004;
      profile.push(new THREE.Vector2(r, t * L));
    }
    const sleeveGeo = new THREE.LatheGeometry(profile, 20);
    sleeveGeo.rotateX(Math.PI / 2); // Y axis -> +Z (back toward the elbow)
    sleeveGeo.translate(0, 0, 0.055);
    const sleeve = new THREE.Mesh(sleeveGeo, cloth);
    const cuffGeo = new THREE.TorusGeometry(0.037, 0.0055, 8, 24);
    const cuff = new THREE.Mesh(cuffGeo, cloth);
    cuff.position.z = 0.056;
    const wrist = new THREE.Mesh(segment(0.06, 0.027), skin);
    wrist.position.z = 0.068;
    wrist.scale.set(1.15, 0.8, 1);
    root.add(sleeve, cuff, wrist);

    // Hand: palm, four fingers, thumb. Palm faces down (-Y), fingers point forward (-Z).
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.084, 0.027, 0.092, 3, 0.012), skin);
    palm.position.z = 0.0;
    hand.add(palm);
    const joints: THREE.Group[][] = [];
    for (const f of FINGERS) {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = hand;
      let r = f.r;
      for (let k = 0; k < 3; k++) {
        const j = new THREE.Group();
        if (k === 0) { j.position.set(f.x, -0.002, f.z); j.rotation.y = f.splay; }
        else j.position.z = -f.lens[k - 1];
        j.add(new THREE.Mesh(segment(f.lens[k], r), skin));
        parent.add(j);
        chain.push(j);
        parent = j;
        r *= 0.9;
      }
      joints.push(chain);
    }
    const thumb: THREE.Group[] = [];
    let tp: THREE.Object3D = hand;
    const tl = [0.034, 0.028, 0.022];
    let tr = 0.0115;
    for (let k = 0; k < 3; k++) {
      const j = new THREE.Group();
      if (k === 0) { j.position.set(-0.034, -0.007, 0.02); j.rotation.set(-0.25, 0.75, 0.5); }
      else j.position.z = -tl[k - 1];
      j.add(new THREE.Mesh(segment(tl[k], tr), skin));
      tp.add(j);
      thumb.push(j);
      tp = j;
      tr *= 0.88;
    }
    // Wrist joint: hand sits just ahead of the cuff.
    hand.position.set(0, 0, -0.005);
    root.add(hand);
    return { root, hand, joints, thumb, side };
  }

  update(dt: number, p: Player, mouseDX: number, mouseDY: number) {
    this.rig.visible = this.visible;
    if (!this.visible) return;
    this.t += dt;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // Lag behind the view a little when turning.
    this.lagX += (THREE.MathUtils.clamp(-mouseDX * 0.0005, -0.05, 0.05) - this.lagX) * k(10);
    this.lagY += (THREE.MathUtils.clamp(mouseDY * 0.0005, -0.04, 0.04) - this.lagY) * k(10);
    this.swim += ((p.swimming ? 1 : 0) - this.swim) * k(4);
    this.air += ((!p.grounded && !p.swimming ? 1 : 0) - this.air) * k(8);
    this.sprintBlend += ((p.sprinting && p.speed > 3.5 ? 1 : 0) - this.sprintBlend) * k(6);
    const moving = Math.min(1, p.speed / 2.5);
    const breath = Math.sin(this.t * 1.7) * 0.0035;

    this.rig.position.set(this.lagX, -this.lagY + breath + p.landDip * 0.35 + this.air * 0.025, p.crouching ? -0.02 : 0);
    this.rig.rotation.set(this.lagY * 0.8, this.lagX * 1.2, this.lagX * 0.6);

    for (const a of this.arms) {
      const s = a.side;
      const phase = p.bobPhase + (s === 1 ? 0 : Math.PI);
      const swingAmp = 0.1 * moving * (1 - this.sprintBlend) + 0.32 * this.sprintBlend;
      const swing = Math.sin(phase) * swingAmp;

      // Rest pose: wrists low at the sides of the view, forearms angled back and out.
      let x = 0.2, y = -0.2, z = -0.42;
      let rx = 0.3, ry = 0.3, rz = 0;
      // Running: elbows bent, hands higher and pumping.
      x -= 0.03 * this.sprintBlend; y += 0.04 * this.sprintBlend; rx += 0.25 * this.sprintBlend;
      z += swing * 0.12; y += Math.abs(swing) * 0.03; rx += swing * 0.5;
      // Swimming: a slow breaststroke out in front.
      if (this.swim > 0.01) {
        const sp = this.t * 1.6 + (s === 1 ? 0 : 0.05);
        const sweep = Math.sin(sp);
        x = THREE.MathUtils.lerp(x, 0.09 + Math.max(0, sweep) * 0.16, this.swim);
        y = THREE.MathUtils.lerp(y, -0.16 + Math.cos(sp) * 0.02, this.swim);
        z = THREE.MathUtils.lerp(z, -0.46 + Math.cos(sp) * 0.06, this.swim);
        rx = THREE.MathUtils.lerp(rx, 0.15, this.swim);
        ry = THREE.MathUtils.lerp(ry, 0.1 + sweep * 0.4, this.swim);
      }
      a.root.position.set(x * s, y, z);
      a.root.rotation.set(rx, ry, rz); // the left arm is mirrored by its negative x scale

      // Hand: fingers forward and a little down, palm turned in toward the body.
      a.hand.rotation.set(-0.62 - this.sprintBlend * 0.2 + this.swim * 0.4, 0.18, -0.62 + this.swim * 0.5);

      // Fingers rest loosely curled; tighten into a loose fist when running.
      const fist = this.sprintBlend * 0.9;
      const idle = Math.sin(this.t * 0.6 + s) * 0.04;
      a.joints.forEach((chain, i) => {
        const c = FINGERS[i].curl;
        const open = this.swim;
        chain[0].rotation.x = -(c[0] * 0.8 + fist * 0.9 + idle) * (1 - open * 0.8);
        chain[1].rotation.x = -(c[1] * 0.75 + fist * 0.8 + idle) * (1 - open * 0.8);
        chain[2].rotation.x = -(c[2] + fist * 0.5) * (1 - open * 0.8);
      });
      a.thumb[1].rotation.x = -0.2 - fist * 0.4;
      a.thumb[2].rotation.x = -0.25 - fist * 0.3;
    }
  }
}
