// The real night sky: 8,700 catalogued stars (Yale Bright Star Catalog) placed by right
// ascension and declination, coloured by temperature and sized by brightness, turning
// with the hour. Scorpius rides low in the south on summer evenings, with the bright
// core of the Milky Way beside it.
import * as THREE from 'three/webgpu';
import {
  float, vec3, vec4, uniform, instancedBufferAttribute, positionGeometry, cameraPosition,
  smoothstep, exp, max, mix, sin, time, uv, varying, clamp, pow,
} from 'three/tsl';

export const LATITUDE_DEG = 38;

/** Columns map an equatorial unit vector (x: RA 0h, y: RA 6h, z: pole) to world space. */
export function equatorialToWorld(lstRad: number, latRad: number, out = new THREE.Matrix3()) {
  // World: north = -z, east = +x, up = +y.
  const e1 = new THREE.Vector3(0, Math.cos(latRad), Math.sin(latRad));   // equator on the meridian (south side)
  const W = new THREE.Vector3(-1, 0, 0);                                 // west
  const P = new THREE.Vector3(0, Math.sin(latRad), -Math.cos(latRad));   // north celestial pole
  const c = Math.cos(lstRad), s = Math.sin(lstRad);
  const colX = e1.clone().multiplyScalar(c).addScaledVector(W, s);
  const colY = e1.clone().multiplyScalar(s).addScaledVector(W, -c);
  return out.set(colX.x, colY.x, P.x, colX.y, colY.y, P.y, colX.z, colY.z, P.z);
}

/** Approximate blackbody colour for a star temperature (Kelvin). */
function tempColor(K: number) {
  const t = K / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = new THREE.Color(Math.min(255, Math.max(0, r)) / 255, Math.min(255, Math.max(0, g)) / 255, Math.min(255, Math.max(0, b)) / 255);
  // Pull toward white: real stars look far less saturated than blackbody curves suggest.
  return c.lerp(new THREE.Color(1, 1, 1), 0.45);
}

export class Starfield {
  readonly mesh: THREE.Mesh;
  readonly uRot = uniform(new THREE.Matrix3());
  readonly uRight = uniform(new THREE.Vector3(1, 0, 0));
  readonly uUp = uniform(new THREE.Vector3(0, 1, 0));
  readonly uPx = uniform(3);          // world units per pixel at the star sphere
  readonly uScorpio = uniform(0);     // extra emphasis on Scorpius (cinematics)
  readonly radius: number;

  private constructor(data: Float32Array, uNight: any, radius: number) {
    this.radius = radius;
    const n = data.length / 6;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const dirMag = new Float32Array(n * 4);
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      dirMag.set([data[o], data[o + 1], data[o + 2], data[o + 3]], i * 4);
      const c = tempColor(data[o + 4]);
      col.set([c.r, c.g, c.b, data[o + 5]], i * 4);
    }
    const aDir = new THREE.InstancedBufferAttribute(dirMag, 4);
    const aCol = new THREE.InstancedBufferAttribute(col, 4);
    geo.setAttribute('aDir', aDir);
    geo.setAttribute('aCol', aCol);
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    mat.fog = false;
    const d4 = instancedBufferAttribute(aDir);
    const c4 = instancedBufferAttribute(aCol);
    const world = this.uRot.mul(d4.xyz).normalize();
    const mag = d4.w;
    const scorpio = c4.w.mul(this.uScorpio);
    // Brightness relative to a magnitude-1 star; brighter stars also grow a little.
    const flux = pow(float(10.0), mag.sub(1.0).mul(-0.4)).add(scorpio.mul(1.5));
    const sizePx = clamp(flux.sqrt().mul(2.6).add(2.2), 2.2, 9.0).add(scorpio.mul(3.0));
    const center = cameraPosition.add(world.mul(radius));
    const off = positionGeometry.xy.mul(sizePx).mul(this.uPx);
    mat.positionNode = center.add(this.uRight.mul(off.x)).add(this.uUp.mul(off.y));

    const alt = world.y;
    // Atmospheric extinction: stars dim and redden toward the horizon.
    const airmass = smoothstep(-0.02, 0.35, alt);
    const vFlux = varying(flux.mul(airmass), 'vStarFlux');
    const vCol = varying(mix(c4.rgb.mul(vec3(1.0, 0.75, 0.55)), c4.rgb, airmass), 'vStarCol');
    const vTw = varying(sin(time.mul(mag.mul(1.7).add(3.0)).add(d4.x.mul(900.0))).mul(float(1).sub(airmass).mul(0.35).add(0.08)), 'vTwinkle');
    const r = uv().sub(0.5).length().mul(2.0);
    const core = exp(r.mul(r).mul(-9.0));
    const intensity = clamp(vFlux, 0.0, 6.0).mul(1.6).add(0.22).mul(float(1).add(vTw));
    mat.colorNode = vec4(vCol.mul(core).mul(intensity).mul(uNight), 1.0);
    mat.opacityNode = float(1);

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -4;
    this.mesh.name = 'Stars';
  }

  static async load(uNight: any, radius = 3000): Promise<Starfield> {
    const res = await fetch(new URL('./data/stars.bin', document.baseURI).toString());
    const buf = await res.arrayBuffer();
    return new Starfield(new Float32Array(buf), uNight, radius);
  }

  update(camera: THREE.PerspectiveCamera, rot: THREE.Matrix3, viewportHeightPx: number) {
    (this.uRot.value as THREE.Matrix3).copy(rot);
    const e = camera.matrixWorld.elements;
    this.uRight.value.set(e[0], e[1], e[2]).normalize();
    this.uUp.value.set(e[4], e[5], e[6]).normalize();
    const radPerPx = ((camera.fov * Math.PI) / 180) / Math.max(1, viewportHeightPx);
    this.uPx.value = radPerPx * this.radius;
  }
}

