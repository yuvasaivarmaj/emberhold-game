// World effects for the prologue: the falling ship's fireball and trail, the impact,
// smoke and fire over the crash, the half-buried wreck, the scorched ground, and the
// faint lines of Scorpius.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, mix, smoothstep, exp, uniform, instancedBufferAttribute, positionGeometry,
  instanceIndex, hash, uint, time, mod, uv, varying, max, color, mx_noise_float, positionLocal, sin,
} from 'three/tsl';
import { Heightfield } from '../world/Heightfield';
import { makeShip } from './SpaceScene';

/** Shared camera axes for camera-facing sprites. */
export const camAxes = { right: uniform(new THREE.Vector3(1, 0, 0)), up: uniform(new THREE.Vector3(0, 1, 0)) };
export function updateCamAxes(camera: THREE.Camera) {
  const e = camera.matrixWorld.elements;
  camAxes.right.value.set(e[0], e[1], e[2]).normalize();
  camAxes.up.value.set(e[4], e[5], e[6]).normalize();
}

function quadGeo(count: number) {
  const geo = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1);
  geo.index = q.index;
  geo.setAttribute('position', q.attributes.position);
  geo.setAttribute('uv', q.attributes.uv);
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return geo;
}

export class Fireball {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight(0xffb070, 0, 0, 2);
  private trail: THREE.InstancedBufferAttribute;
  private hist: THREE.Vector3[] = [];
  private N = 180;
  readonly uBright = uniform(0);

  constructor() {
    const geo = quadGeo(this.N);
    this.trail = new THREE.InstancedBufferAttribute(new Float32Array(this.N * 4), 4);
    this.trail.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aT', this.trail);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    mat.fog = false;
    const a = instancedBufferAttribute(this.trail);
    const age = a.w; // 0 at the head, 1 at the tail
    const size = mix(float(26), float(160), age.pow(0.6));
    const off = positionGeometry.xy.mul(size);
    mat.positionNode = a.xyz.add(camAxes.right.mul(off.x)).add(camAxes.up.mul(off.y));
    const r = uv().sub(0.5).length().mul(2.0);
    const soft = exp(r.mul(r).mul(-4.0));
    const vAge = varying(age, 'vAge');
    const hot = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.45, 0.12), smoothstep(0.0, 0.25, vAge));
    const cool = mix(hot, vec3(0.35, 0.1, 0.05), smoothstep(0.3, 0.9, vAge));
    const fade = float(1).sub(vAge).pow(2.2);
    mat.colorNode = vec4(cool.mul(soft).mul(fade).mul(this.uBright).mul(mix(float(14), float(1.5), vAge)), 1.0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.group.add(mesh, this.light);
    this.group.visible = false;
  }

  /** Move the head; the trail follows the recent path. */
  update(head: THREE.Vector3, brightness: number) {
    this.group.visible = brightness > 0.001;
    this.uBright.value = brightness;
    this.hist.unshift(head.clone());
    if (this.hist.length > this.N) this.hist.pop();
    for (let i = 0; i < this.N; i++) {
      const p = this.hist[Math.min(i, this.hist.length - 1)];
      this.trail.setXYZW(i, p.x, p.y, p.z, i / (this.N - 1));
    }
    this.trail.needsUpdate = true;
    this.light.position.copy(head);
    this.light.intensity = brightness * 1.6e5;
  }

  reset() { this.hist = []; }
}

/** GPU particles: rising smoke and low fire over the crash. */
export class Plume {
  readonly group = new THREE.Group();
  readonly uOrigin = uniform(new THREE.Vector3());
  readonly uAmount = uniform(0);
  readonly light = new THREE.PointLight(0xff7a30, 0, 0, 2);

  constructor() {
    // Smoke
    {
      const n = 260;
      const geo = quadGeo(n);
      const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 1 });
      const id = instanceIndex;
      const r1 = hash(id.add(uint(1))), r2 = hash(id.add(uint(2))), r3 = hash(id.add(uint(3)));
      const period = float(40);
      const age = mod(time.add(r1.mul(period)), period).div(period);
      const rise = age.mul(520.0);
      const drift = vec3(age.pow(1.5).mul(220.0), 0.0, age.pow(1.5).mul(-90.0));
      const spread = vec3(r2.sub(0.5), 0.0, r3.sub(0.5)).mul(age.mul(140.0).add(30.0));
      const center = this.uOrigin.add(vec3(0.0, rise, 0.0)).add(drift).add(spread);
      const size = age.mul(240.0).add(40.0).mul(this.uAmount.sqrt());
      const off = positionGeometry.xy.mul(size);
      mat.positionNode = center.add(camAxes.right.mul(off.x)).add(camAxes.up.mul(off.y));
      const p = uv().sub(0.5);
      const puff = mx_noise_float(vec3(p.mul(3.0), r1.mul(10.0).add(time.mul(0.05)))).mul(0.35).add(0.65);
      const shape = smoothstep(0.5, 0.15, p.length().div(puff));
      const vAge = varying(age, 'vSmokeAge');
      mat.colorNode = mix(vec3(0.05, 0.045, 0.04), vec3(0.22, 0.21, 0.2), vAge);
      mat.emissiveNode = vec3(1.0, 0.35, 0.08).mul(smoothstep(0.12, 0.0, vAge).mul(0.5)).mul(this.uAmount);
      mat.opacityNode = shape.mul(smoothstep(0.0, 0.06, vAge)).mul(float(1).sub(vAge)).mul(0.55).mul(this.uAmount);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.group.add(m);
    }
    // Fire and embers
    {
      const n = 160;
      const geo = quadGeo(n);
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      mat.blending = THREE.AdditiveBlending;
      const id = instanceIndex;
      const r1 = hash(id.add(uint(11))), r2 = hash(id.add(uint(12))), r3 = hash(id.add(uint(13)));
      const period = float(3.5);
      const age = mod(time.add(r1.mul(period)), period).div(period);
      const ring = vec3(r2.sub(0.5), 0.0, r3.sub(0.5)).mul(70.0);
      const center = this.uOrigin.add(ring).add(vec3(0.0, age.mul(60.0), 0.0));
      const size = float(1).sub(age).mul(26.0).add(4.0);
      const off = positionGeometry.xy.mul(size);
      mat.positionNode = center.add(camAxes.right.mul(off.x)).add(camAxes.up.mul(off.y));
      const rr = uv().sub(0.5).length().mul(2.0);
      const vAge = varying(age, 'vFireAge');
      const c = mix(vec3(1.0, 0.75, 0.3), vec3(0.9, 0.2, 0.05), vAge);
      mat.colorNode = vec4(c.mul(exp(rr.mul(rr).mul(-5.0))).mul(float(1).sub(vAge)).mul(5.0).mul(this.uAmount), 1.0);
      mat.fog = false;
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.group.add(m);
    }
    this.group.add(this.light);
    this.group.visible = false;
  }

  set(origin: THREE.Vector3, amount: number) {
    this.uOrigin.value.copy(origin);
    this.uAmount.value = amount;
    this.group.visible = amount > 0.001;
    this.light.position.copy(origin).add(new THREE.Vector3(0, 30, 0));
    this.light.intensity = amount * 5e4 * (0.85 + Math.random() * 0.3);
  }
}

/** The broken ship, half buried, its Emberite seams still glowing. */
export function makeWreck(hf: Heightfield, at: THREE.Vector3) {
  const g = new THREE.Group();
  const ship = makeShip(3.2);
  // Break the ship: tilt it nose-down into the ground and scatter a few plates.
  ship.rotation.set(0.32, 0.9, 0.5);
  ship.position.set(0, 14, 0);
  ship.children.forEach((c) => { if ((c as any).isMesh && (c as THREE.Mesh).geometry.type === 'CylinderGeometry') c.visible = false; });
  g.add(ship);
  const plateMat = new THREE.MeshStandardNodeMaterial({ metalness: 0.7, roughness: 0.5 });
  plateMat.colorNode = mix(color(0x241f1c), color(0x4a3f36), mx_noise_float(positionLocal.mul(2.0)).mul(0.5).add(0.5));
  plateMat.emissiveNode = color(0xff5a18).mul(smoothstep(0.55, 0.75, mx_noise_float(positionLocal.mul(0.8))).mul(sin(time.mul(1.3)).mul(0.3).add(1.0)).mul(1.4));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const d = 70 + Math.random() * 120;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(14 + Math.random() * 10, 14 + Math.random() * 10, 6 + Math.random() * 16, 12, 1, true, 0, 1.2 + Math.random() * 1.4), plateMat);
    const x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d;
    plate.position.set(Math.cos(a) * d, hf.height(x, z) - at.y + 1, Math.sin(a) * d);
    plate.rotation.set(Math.random() * 1.2, Math.random() * 6, Math.random() * 1.2);
    plate.castShadow = true;
    g.add(plate);
  }
  g.position.copy(at);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Burnt ground around the crash, conforming to the terrain. */
export function makeScorch(hf: Heightfield, at: THREE.Vector3, radius: number) {
  const seg = 72;
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + at.x, z = pos.getZ(i) + at.z;
    pos.setY(i, hf.height(x, z) + 0.12);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.95 });
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  const p = uv().sub(0.5).mul(2.0);
  const d = p.length();
  const n = mx_noise_float(vec3(p.mul(4.0), 1.0)).mul(0.2);
  mat.colorNode = mix(vec3(0.02, 0.018, 0.015), vec3(0.12, 0.09, 0.06), smoothstep(0.3, 1.0, d.add(n)));
  mat.opacityNode = smoothstep(1.0, 0.55, d.add(n)).mul(0.92);
  mat.emissiveNode = vec3(1.0, 0.3, 0.05).mul(smoothstep(0.35, 0.0, d.add(n.mul(2.0))).mul(mx_noise_float(vec3(p.mul(12.0), time.mul(0.3))).mul(0.5).add(0.5)).mul(0.8));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(at.x, 0, at.z);
  m.renderOrder = 1;
  return m;
}

// Scorpius stick figure (right ascension hours, declination degrees).
const SCO: Record<string, [number, number]> = {
  beta: [16.0906, -19.806], delta: [16.0056, -22.622], pi: [15.9809, -26.114], sigma: [16.3531, -25.593],
  alpha: [16.4901, -26.432], tau: [16.5981, -28.216], eps: [16.8361, -34.293], mu1: [16.8644, -38.048],
  zeta2: [16.9097, -42.362], eta: [17.2025, -43.239], theta: [17.6220, -42.998], iota1: [17.7931, -40.127],
  kappa: [17.7081, -39.030], lambda: [17.5601, -37.104], upsilon: [17.5127, -37.296],
};
const SCO_LINES = [['beta', 'delta'], ['delta', 'pi'], ['delta', 'sigma'], ['sigma', 'alpha'], ['alpha', 'tau'], ['tau', 'eps'],
  ['eps', 'mu1'], ['mu1', 'zeta2'], ['zeta2', 'eta'], ['eta', 'theta'], ['theta', 'iota1'], ['iota1', 'kappa'], ['kappa', 'lambda'], ['lambda', 'upsilon']];

export function equatorial(raH: number, decD: number) {
  const a = (raH / 24) * Math.PI * 2, d = (decD * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}
export const ANTARES = equatorial(16.4901, -26.432);

export class ScorpiusLines {
  readonly mesh: THREE.LineSegments;
  readonly uOpacity = uniform(0);
  private radius = 7100;

  constructor() {
    const pts: number[] = [];
    for (const [a, b] of SCO_LINES) {
      const pa = equatorial(...SCO[a]).multiplyScalar(this.radius);
      const pb = equatorial(...SCO[b]).multiplyScalar(this.radius);
      pts.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    mat.fog = false;
    mat.colorNode = vec4(vec3(0.9, 0.55, 0.35).mul(this.uOpacity.mul(0.5)), 1.0);
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = -3;
  }

  update(camPos: THREE.Vector3, rot: THREE.Matrix3, opacity: number) {
    this.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;
    const m = this.mesh.matrix;
    const e = rot.elements;
    m.set(e[0], e[3], e[6], camPos.x, e[1], e[4], e[7], camPos.y, e[2], e[5], e[8], camPos.z, 0, 0, 0, 1);
    this.mesh.matrixWorld.copy(m);
  }
}

