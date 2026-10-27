// A torch made the way a traveller would: snap a dry branch off a tree (F), strike the
// tinderbox to light it (hold F), carry it on foot or on horseback, and put it out for
// real: plunge it into water, or crouch and grind it into the earth (hold C + F). Q
// drops the branch. A lit torch burns down over about a quarter of an hour.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, mix, smoothstep, exp, positionGeometry, instanceIndex, hash, uint, time, mod, uv, varying,
  mx_noise_float, uniform,
} from 'three/tsl';
import { camAxes } from '../cinematic/Effects';

export type TorchState = 'none' | 'branch' | 'lit' | 'charred';

const BURN_SECONDS = 900;

function barkMaterial() {
  return new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
}

/** The branch in your hand, its flame, and the light it throws. */
export class Torch {
  state: TorchState = 'none';
  /** 0..1 while holding F to light, or C+F to smother. */
  progress = 0;
  fuel = 1;
  readonly light = new THREE.PointLight(0xff9a4a, 0, 20, 2);
  readonly object = new THREE.Group();
  private flame: THREE.Mesh;
  private uFlame = uniform(0);
  private uChar = uniform(0);
  private flicker = 0;
  private tipLocal = new THREE.Vector3(0, 0, -0.62);
  readonly tip = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // The branch: a crooked, tapering stick with a couple of snapped twigs.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(Math.sin(t * 5.1) * 0.012, Math.cos(t * 3.7) * 0.01, 0.12 - t * 0.74));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const stick = new THREE.TubeGeometry(curve, 24, 0.017, 8, false);
    // Taper toward the far end.
    const pos = stick.attributes.position as THREE.BufferAttribute;
    const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const t = THREE.MathUtils.clamp((0.12 - z) / 0.74, 0, 1);
      const pt = curve.getPoint(t, c);
      const k = 1.15 - t * 0.45;
      pos.setXYZ(i, pt.x + (pos.getX(i) - pt.x) * k, pt.y + (pos.getY(i) - pt.y) * k, z);
    }
    stick.computeVertexNormals();
    const bark = barkMaterial();
    // Bark darkens and chars toward the burning end; embers glow in the char.
    bark.colorNode = mix(
      mix(vec3(0.16, 0.11, 0.07), vec3(0.24, 0.17, 0.11), mx_noise_float(uv().mul(vec2(40, 4))).mul(0.5).add(0.5)),
      vec3(0.03, 0.025, 0.02),
      smoothstep(0.55, 0.8, uv().x).mul(this.uChar),
    );
    bark.emissiveNode = vec3(1.0, 0.32, 0.06).mul(smoothstep(0.85, 1.0, uv().x).mul(this.uFlame).mul(mx_noise_float(uv().mul(vec2(30, 6)).add(time.mul(2.0))).mul(0.5).add(0.5)).mul(3.0));
    const stickMesh = new THREE.Mesh(stick, bark);
    for (const [z, a, l] of [[-0.18, 0.7, 0.07], [-0.36, -0.9, 0.05]]) {
      const g = new THREE.CylinderGeometry(0.004, 0.008, l, 5);
      g.translate(0, l / 2, 0);
      const twig = new THREE.Mesh(g, bark);
      twig.position.set(0, 0, z);
      twig.rotation.set(-1.0, 0, a);
      stickMesh.add(twig);
    }
    this.object.add(stickMesh);

    // Flame: soft additive billboards rising from the tip, with sparks.
    const N = 46;
    const geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    geo.index = q.index;
    geo.setAttribute('position', q.attributes.position);
    geo.setAttribute('uv', q.attributes.uv);
    geo.instanceCount = N;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    mat.fog = false;
    const id = instanceIndex;
    const r1 = hash(id.add(uint(7))), r2 = hash(id.add(uint(8))), r3 = hash(id.add(uint(9)));
    const spark = r3.greaterThan(0.86);
    const period = spark.select(float(1.4), float(0.55)).mul(r2.mul(0.5).add(0.75));
    const age = mod(time.add(r1.mul(period)), period).div(period);
    const uTip = this.uTip;
    const rise = age.mul(spark.select(float(0.9), float(0.32)));
    const wob = vec3(mx_noise_float(vec3(r1.mul(9.0), time.mul(2.5), 0.0)), 0.0, mx_noise_float(vec3(r2.mul(9.0), 0.0, time.mul(2.5))))
      .mul(age.mul(spark.select(float(0.25), float(0.05))));
    const center = uTip.add(vec3(0.0, rise, 0.0)).add(wob);
    const size = spark.select(float(0.01), mix(float(0.09), float(0.03), age).mul(r2.mul(0.5).add(0.75))).mul(this.uFlame.sqrt());
    const off = positionGeometry.xy.mul(size);
    mat.positionNode = center.add(camAxes.right.mul(off.x)).add(camAxes.up.mul(off.y));
    const d = uv().sub(0.5).length().mul(2.0);
    const soft = exp(d.mul(d).mul(-3.5));
    const vAge = varying(age, 'vTorchAge');
    const vSpark = varying(spark.select(float(1), float(0)), 'vTorchSpark');
    const hot = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 0.36, 0.08), smoothstep(0.1, 0.7, vAge));
    const fade = float(1).sub(vAge).pow(1.6).mul(smoothstep(0.0, 0.08, vAge));
    mat.colorNode = vec4(hot.mul(soft).mul(fade).mul(mix(float(0.7), float(3.0), vSpark)).mul(this.uFlame), 1.0);
    this.flame = new THREE.Mesh(geo, mat);
    this.flame.frustumCulled = false;
    this.flame.renderOrder = 12;
    scene.add(this.flame);
    this.flame.visible = false;
    this.light.castShadow = false;
    scene.add(this.light); // always present, so lighting it never forces shaders to rebuild
    this.object.visible = false;
    this.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).renderOrder = 11; o.frustumCulled = false; } });
  }
  private uTip = uniform(new THREE.Vector3());

  /** Hang the branch from the hand's grip point. */
  attach(grip: THREE.Object3D) {
    grip.add(this.object);
    // Held like a club, burning end up and forward.
    this.object.rotation.set(0.55, -0.15, 0.0);
    this.object.position.set(0, 0, 0.16);
  }

  get uFlameOn() { return this.uFlame.value > 0.3; }
  /** Called once when a lit torch burns down. */
  onBurnOut: (() => void) | null = null;

  get held() { return this.state === 'branch' || this.state === 'lit' || this.state === 'charred'; }

  update(dt: number) {
    this.object.visible = this.held;
    const lit = this.state === 'lit';
    this.uFlame.value += ((lit ? 1 : 0) - this.uFlame.value) * Math.min(1, dt * (lit ? 2.5 : 6));
    this.uChar.value = this.state === 'branch' ? 0 : 1;
    if (lit) {
      this.fuel -= dt / BURN_SECONDS;
      if (this.fuel <= 0) { this.state = 'charred'; this.fuel = 0; this.onBurnOut?.(); }
    }
    this.object.updateWorldMatrix(true, true);
    this.tip.copy(this.tipLocal).applyMatrix4(this.object.matrixWorld);
    this.uTip.value.copy(this.tip);
    this.flame.visible = this.uFlame.value > 0.01;
    // Flicker: layered noise, gutters as the fuel runs low.
    this.flicker += dt;
    const f = 0.82 + Math.sin(this.flicker * 13.1) * 0.06 + Math.sin(this.flicker * 7.3 + 1.2) * 0.07 + (Math.random() - 0.5) * 0.08;
    const strength = this.uFlame.value * Math.min(1, 0.35 + this.fuel * 1.3);
    this.light.intensity = 5.5 * strength * f;
    this.light.distance = 20;
    this.light.position.copy(this.tip).add(new THREE.Vector3(0, 0.12, 0));
  }
}
