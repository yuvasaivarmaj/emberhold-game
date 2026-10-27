// Chimney smoke: GPU billboards rising from a list of emitters (the forge stack,
// smithies and hearths). Each emitter owns a few particles that loop forever.
import * as THREE from 'three/webgpu';
import {
  float, vec3, mix, smoothstep, instancedBufferAttribute, positionGeometry, instanceIndex, hash, uint, time, mod,
  uv, varying, mx_noise_float, uniform,
} from 'three/tsl';
import { camAxes } from '../cinematic/Effects';

export interface SmokeEmitter { x: number; y: number; z: number; strength: number }

export class Smoke {
  readonly mesh: THREE.Mesh;
  /** Wind direction (x, z) and strength. */
  readonly uWind = uniform(new THREE.Vector3(1, 0, -0.35));
  /** 0 by day, 1 at night: the forge glows through its smoke after dark. */
  readonly uNight = uniform(0);

  constructor(emitters: SmokeEmitter[]) {
    const per = (e: SmokeEmitter) => Math.max(6, Math.round(10 * Math.sqrt(e.strength) + (e.strength > 2 ? 30 : 0)));
    const total = emitters.reduce((n, e) => n + per(e), 0);
    const data = new Float32Array(total * 4);
    let k = 0;
    for (const e of emitters) for (let i = 0; i < per(e); i++, k++) data.set([e.x, e.y, e.z, e.strength], k * 4);
    const geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    geo.index = q.index;
    geo.setAttribute('position', q.attributes.position);
    geo.setAttribute('uv', q.attributes.uv);
    geo.instanceCount = total;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const attr = new THREE.InstancedBufferAttribute(data, 4);
    geo.setAttribute('aEmit', attr);

    const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 1 });
    const e = instancedBufferAttribute(attr);
    const s = e.w;
    const id = instanceIndex;
    const r1 = hash(id.add(uint(11))), r2 = hash(id.add(uint(12))), r3 = hash(id.add(uint(13)));
    const period = mix(float(14), float(30), s.div(4).min(1));
    const age = mod(time.add(r1.mul(period)), period).div(period);
    const rise = age.pow(0.8).mul(s.sqrt().mul(34.0).add(10.0));
    const wind = this.uWind;
    const drift = vec3(wind.x, 0.0, wind.z).mul(age.pow(1.4).mul(s.sqrt().mul(26.0).add(8.0)));
    const spread = vec3(r2.sub(0.5), 0.0, r3.sub(0.5)).mul(age.mul(s.sqrt().mul(9.0).add(3.0)).add(0.4));
    const center = e.xyz.add(vec3(0.0, rise, 0.0)).add(drift).add(spread);
    const size = age.mul(s.sqrt().mul(18.0).add(6.0)).add(s.sqrt().mul(1.5).add(1.0));
    const off = positionGeometry.xy.mul(size);
    mat.positionNode = center.add(camAxes.right.mul(off.x)).add(camAxes.up.mul(off.y));
    const p = uv().sub(0.5);
    const puff = mx_noise_float(vec3(p.mul(3.0), r1.mul(10.0).add(time.mul(0.04)))).mul(0.35).add(0.65);
    const shape = smoothstep(0.5, 0.12, p.length().div(puff));
    const vAge = varying(age, 'vChimAge');
    const vS = varying(s, 'vChimS');
    mat.colorNode = mix(vec3(0.22, 0.21, 0.2), vec3(0.55, 0.54, 0.53), vAge);
    // The forge's smoke is lit from below after dark.
    mat.emissiveNode = vec3(1.0, 0.42, 0.12).mul(smoothstep(0.25, 0.0, vAge).mul(smoothstep(2.0, 3.0, vS)).mul(this.uNight).mul(0.8));
    mat.opacityNode = shape.mul(smoothstep(0.0, 0.08, vAge)).mul(float(1).sub(vAge).pow(1.5)).mul(vS.sqrt().mul(0.14).add(0.12));
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'Smoke';
  }
}
