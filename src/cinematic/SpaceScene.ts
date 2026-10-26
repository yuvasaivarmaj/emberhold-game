// Space for the prologue: a nebula backdrop, the catalogued stars, Aethryn with its
// forge-lit night side, the Vaelaros ships, and the young Earth.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, mix, smoothstep, pow, max, dot, normalWorld, positionLocal, positionWorld,
  cameraPosition, mx_fractal_noise_float, mx_noise_float, uniform, color, time, abs, exp,
} from 'three/tsl';
import { Starfield } from '../world/Starfield';

function planetMaterial(kind: 'aethryn' | 'earth', sunDir: any) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const p = positionLocal.normalize();
  const cont = mx_fractal_noise_float(p.mul(kind === 'aethryn' ? 1.6 : 1.9).add(vec3(3.1, 0.7, 1.9)), 6, 2.0, 0.52);
  const detail = mx_fractal_noise_float(p.mul(9.0), 4, 2.0, 0.5);
  const lat = abs(p.y);
  const N = normalWorld;
  const night = smoothstep(0.1, -0.25, dot(N, sunDir));
  if (kind === 'aethryn') {
    // A hot, arid world: ochre and rust continents, dark wine-coloured seas, ash plains.
    const land = smoothstep(-0.02, 0.06, cont);
    const sea = mix(color(0x1a0e14), color(0x2a1820), detail.mul(0.5).add(0.5));
    const ground = mix(mix(color(0x8a4a24), color(0xb8834a), detail.mul(0.5).add(0.5)), color(0x3a2a24), smoothstep(0.25, 0.5, cont));
    m.colorNode = mix(sea, ground, land).mul(float(1).sub(smoothstep(0.85, 0.97, lat).mul(0.3)));
    m.roughnessNode = mix(float(0.35), float(0.9), land);
    // Forge-cities glowing on the night side, strung along coasts and ridges.
    const city = smoothstep(0.62, 0.8, mx_noise_float(p.mul(60.0)).mul(0.5).add(0.5))
      .mul(smoothstep(0.0, 0.08, cont)).mul(smoothstep(0.35, 0.05, cont));
    const forge = smoothstep(0.78, 0.92, mx_noise_float(p.mul(23.0).add(5.0)).mul(0.5).add(0.5)).mul(land);
    m.emissiveNode = color(0xff7a2a).mul(city.mul(3.5).add(forge.mul(1.8))).mul(night);
  } else {
    const land = smoothstep(0.0, 0.05, cont);
    const sea = mix(color(0x06203f), color(0x0d3a66), detail.mul(0.5).add(0.5));
    const ground = mix(mix(color(0x3d5a26), color(0x6b6a3a), smoothstep(0.1, 0.4, cont)), color(0x8a7a5a), smoothstep(0.35, 0.55, cont));
    const ice = smoothstep(0.82, 0.9, lat.add(detail.mul(0.05)));
    m.colorNode = mix(mix(sea, ground, land), color(0xf0f4f8), ice);
    m.roughnessNode = mix(float(0.2), float(0.9), land);
  }
  return m;
}

function atmosphere(radius: number, tint: number, sunDir: any, strength = 1) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  m.blending = THREE.AdditiveBlending;
  const view = cameraPosition.sub(positionWorld).normalize();
  const rim = pow(float(1).sub(max(dot(normalWorld, view), 0.0)), 3.0);
  const lit = smoothstep(-0.35, 0.35, dot(normalWorld, sunDir));
  m.colorNode = vec4(color(tint).mul(rim.mul(lit).mul(2.2 * strength)), 1.0);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 96, 48), m);
  return mesh;
}

function clouds(radius: number, sunDir: any) {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 1 });
  const p = positionLocal.normalize();
  const c = mx_fractal_noise_float(p.mul(3.2).add(vec3(time.mul(0.004), 0.0, 0.0)), 6, 2.1, 0.55);
  m.colorNode = vec3(1.0);
  m.opacityNode = smoothstep(0.05, 0.35, c).mul(0.85);
  void sunDir;
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 96, 48), m);
}

export function makeShip(scale = 1) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardNodeMaterial({ metalness: 0.75, roughness: 0.38 });
  const plates = mx_noise_float(positionLocal.mul(vec3(0.6, 3.0, 0.6))).mul(0.5).add(0.5);
  hullMat.colorNode = mix(color(0x2c2a2a), color(0x5a524a), plates);
  // Thin seams of Emberite light along the hull.
  const seam = smoothstep(0.93, 0.99, float(1).sub(abs(mx_noise_float(positionLocal.mul(vec3(0.15, 1.6, 0.15))))));
  hullMat.emissiveNode = color(0xff6a20).mul(seam.mul(2.5));
  const pts: THREE.Vector2[] = [];
  const L = 60;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = Math.sin(Math.pow(t, 0.7) * Math.PI) * 5.5 * (t < 0.15 ? 0.8 : 1) + (t > 0.85 ? 1.2 : 0);
    pts.push(new THREE.Vector2(Math.max(0.2, r), t * L - L / 2));
  }
  const hull = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), hullMat);
  hull.rotation.x = Math.PI / 2; // nose toward -z
  g.add(hull);
  for (const a of [0, 2.1, 4.2]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 14), hullMat);
    fin.position.set(Math.cos(a) * 6, Math.sin(a) * 6, 18);
    fin.rotation.z = a;
    g.add(fin);
  }
  for (const z of [-8, 4, 14]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.5, 8, 32), hullMat);
    ring.position.z = z;
    g.add(ring);
  }
  // Engine glow
  const glowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  glowMat.blending = THREE.AdditiveBlending;
  const flick = mx_noise_float(vec3(time.mul(9.0), 0.0, 0.0)).mul(0.15).add(1.0);
  const r = positionLocal.xy.length();
  glowMat.colorNode = vec4(color(0xffb070).mul(exp(r.mul(r).mul(-0.12))).mul(flick).mul(8.0), 1.0);
  const plume = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 0.2, 30, 16, 1, true), glowMat);
  plume.rotation.x = Math.PI / 2;
  plume.position.z = L / 2 + 15;
  g.add(plume);
  const core = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), glowMat);
  core.position.z = L / 2 + 1;
  g.add(core);
  g.scale.setScalar(scale);
  return g;
}

export class SpaceScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 2e6);
  readonly aethryn = new THREE.Group();
  readonly earth = new THREE.Group();
  readonly ships: THREE.Group[] = [];
  readonly sunDir = uniform(new THREE.Vector3(1, 0.15, 0.3).normalize());
  stars: Starfield | null = null;
  private sun: THREE.DirectionalLight;
  private rot = new THREE.Matrix3();

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    this.sun = new THREE.DirectionalLight(0xfff0dd, 4);
    s.add(this.sun);
    s.add(new THREE.AmbientLight(0x101018, 0.4));

    // Nebula backdrop
    const neb = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    neb.colorNode = Fn(() => {
      const d = positionWorld.sub(cameraPosition).normalize();
      const n1 = mx_fractal_noise_float(d.mul(2.2), 6, 2.0, 0.55).mul(0.5).add(0.5);
      const n2 = mx_fractal_noise_float(d.mul(3.7).add(4.0), 5, 2.0, 0.5).mul(0.5).add(0.5);
      const band = exp(dot(d, vec3(0.2, 0.9, 0.3).normalize()).pow(2.0).mul(-6.0));
      const c = mix(vec3(0.12, 0.05, 0.16), vec3(0.45, 0.16, 0.08), n2).mul(smoothstep(0.5, 0.85, n1)).mul(band.mul(0.8).add(0.2));
      return vec4(c.mul(0.18), 1.0);
    })();
    const nebula = new THREE.Mesh(new THREE.SphereGeometry(5e5, 48, 24), neb);
    nebula.frustumCulled = false;
    s.add(nebula);

    // Aethryn
    const R = 1000;
    const aMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), planetMaterial('aethryn', this.sunDir));
    this.aethryn.add(aMesh, atmosphere(R, 0xff9a5a, this.sunDir, 0.9));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(180, 64, 32), new THREE.MeshStandardNodeMaterial({ color: 0x8a8378, roughness: 1 }));
    moon.position.set(-2600, 600, -1800);
    this.aethryn.add(moon);
    s.add(this.aethryn);

    // Earth
    const eMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), planetMaterial('earth', this.sunDir));
    this.earth.add(eMesh, clouds(R, this.sunDir), atmosphere(R, 0x5fa8ff, this.sunDir, 1.1));
    this.earth.position.set(0, 0, -400000);
    this.earth.visible = false;
    s.add(this.earth);

    for (let i = 0; i < 4; i++) {
      const ship = makeShip(i === 0 ? 1 : 0.75);
      ship.visible = false;
      this.ships.push(ship);
      s.add(ship);
    }
  }

  async init() {
    this.stars = await Starfield.load(uniform(1), 1.5e6).catch(() => null);
    if (this.stars) this.scene.add(this.stars.mesh);
  }

  update(viewportHeight: number) {
    this.sun.position.copy(this.sunDir.value).multiplyScalar(10000);
    this.camera.updateMatrixWorld();
    this.rot.identity();
    this.stars?.update(this.camera, this.rot, viewportHeight);
  }
}

