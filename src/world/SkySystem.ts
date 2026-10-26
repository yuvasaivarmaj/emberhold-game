// Sky, sun and moon, day/night cycle, atmospheric fog, image-based lighting and stars.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec3, vec4, mix, max, dot, smoothstep, pow, floor, fract, hash, uint,
  positionWorld, cameraPosition, fog, densityFogFactor, time, sin, abs,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { QualityPreset } from '../core/Settings';

const DEG = Math.PI / 180;
const LATITUDE = 38 * DEG;
const DECLINATION = 14 * DEG; // late summer

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function lerpColor(a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) {
  return out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));
}
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class SkySystem {
  readonly sky: SkyMesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** Hours, 0..24. */
  hour = 16.6;
  /** In-game minutes per real second. 1 => a full day lasts 24 minutes. */
  timeScale = 1;
  dayFactor = 1;

  private envScene = new THREE.Scene();
  private envSky: SkyMesh;
  private cubeRT: THREE.CubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private envTimer = 0;
  private lastEnvSun = new THREE.Vector3(0, -1, 0);
  private csm: CSMShadowNode | null = null;

  // Uniforms consumed by fog, stars and other shaders.
  readonly uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  readonly uMoonDir = uniform(new THREE.Vector3(0, -1, 0));
  readonly uFogColor = uniform(new THREE.Color(0.6, 0.7, 0.8));
  readonly uFogSunColor = uniform(new THREE.Color(1, 0.8, 0.6));
  readonly uFogDensity = uniform(0.00075);
  readonly uNight = uniform(0);
  readonly uTwilight = uniform(0);
  readonly uSunColor = uniform(new THREE.Color(1, 1, 1));
  readonly uWind = uniform(1);

  constructor(private scene: THREE.Scene, q: QualityPreset) {
    // Visible sky
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.configureSky(this.sky, true);
    scene.add(this.sky);

    // Sky used only to light the world (no sun disc, softer clouds)
    this.envSky = new SkyMesh();
    this.envSky.scale.setScalar(1000);
    this.configureSky(this.envSky, false);
    this.envScene.add(this.envSky);
    this.cubeRT = new THREE.CubeRenderTarget(q.envSize, { type: THREE.HalfFloatType, generateMipmaps: true });
    this.cubeCam = new THREE.CubeCamera(1, 2000, this.cubeRT);
    this.envScene.add(this.cubeCam);
    scene.environment = this.cubeRT.texture;
    scene.environmentIntensity = 1.0;

    // Sun / moon key light with cascaded shadows
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 3000;
    this.sun.shadow.camera.left = -500; this.sun.shadow.camera.right = 500;
    this.sun.shadow.camera.top = 500; this.sun.shadow.camera.bottom = -500;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.6;
    if (q.shadows) {
      this.csm = new CSMShadowNode(this.sun, { cascades: q.cascades, maxFar: q.shadowFar, mode: 'practical', lightMargin: 250 });
      (this.sun.shadow as any).shadowNode = this.csm;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Soft fill: sky above, warm earth bounce below
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4030, 0.25);
    scene.add(this.hemi);

    // Atmospheric fog with a glow toward the sun
    const fogColor = Fn(() => {
      const viewDir = positionWorld.sub(cameraPosition).normalize();
      const sunAmount = pow(max(dot(viewDir, this.uSunDir), 0.0), 6.0);
      return mix(this.uFogColor, this.uFogSunColor, sunAmount);
    })();
    // Height falloff: valleys hold more haze than peaks.
    const heightFade = Fn(() => float(1).sub(smoothstep(40.0, 320.0, positionWorld.y).mul(0.55)))();
    scene.fogNode = fog(fogColor, densityFogFactor(this.uFogDensity).mul(heightFade));

    this.createStars();
  }

  private configureSky(s: SkyMesh, visible: boolean) {
    s.turbidity.value = 4.5;
    s.rayleigh.value = 1.6;
    s.mieCoefficient.value = 0.004;
    s.mieDirectionalG.value = 0.78;
    s.cloudCoverage.value = 0.38;
    s.cloudDensity.value = 0.55;
    s.cloudElevation.value = 0.55;
    s.cloudScale.value = 0.00022;
    s.cloudSpeed.value = 0.00003;
    s.showSunDisc.value = visible ? 1 : 0;
  }

  private createStars() {
    // Procedural star field + moon disc on a dome, added on top of the night sky.
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    mat.fog = false;
    mat.blending = THREE.AdditiveBlending;
    const uNight = this.uNight;
    const uTw = this.uTwilight;
    const uSun = this.uSunDir;
    const uMoon = this.uMoonDir;
    mat.colorNode = Fn(() => {
      const dir = positionWorld.sub(cameraPosition).normalize();
      const g = dir.mul(220.0);
      const cell = floor(g);
      const local = fract(g).sub(0.5);
      const seed = uint(cell.x.add(512.0)).mul(uint(73856093))
        .bitXor(uint(cell.y.add(512.0)).mul(uint(19349663)))
        .bitXor(uint(cell.z.add(512.0)).mul(uint(83492791)));
      const h = hash(seed);
      const h2 = hash(seed.add(uint(7)));
      const isStar = smoothstep(0.985, 0.999, h);
      const d = local.length();
      const core = smoothstep(0.32, 0.0, d);
      const twinkle = sin(time.mul(h2.mul(3.0).add(1.0)).add(h2.mul(40.0))).mul(0.3).add(0.7);
      const tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.75), h2);
      const above = smoothstep(-0.02, 0.15, dir.y);
      // Faint milky band
      const band = smoothstep(0.35, 0.0, abs(dot(dir, vec3(0.42, 0.55, -0.72).normalize())));
      const stars = tint.mul(isStar.mul(core).mul(twinkle).mul(h2.mul(2.5).add(0.6)));
      const milky = vec3(0.35, 0.38, 0.5).mul(band.mul(0.035));
      // Moon
      const md = dot(dir, uMoon);
      const disc = smoothstep(0.99955, 0.9997, md);
      const glow = pow(max(md, 0.0), 300.0).mul(0.25).add(pow(max(md, 0.0), 12.0).mul(0.03));
      const moon = vec3(1.0, 0.97, 0.9).mul(disc.mul(2.2).add(glow));
      // Twilight: the physical sky model goes dark right after sunset, so paint the
      // afterglow ourselves: warm along the horizon toward the sun, deep blue above.
      const sunFlat = vec3(uSun.x, 0.0, uSun.z).normalize();
      const toward = max(dot(vec3(dir.x, 0.0, dir.z).normalize(), sunFlat), 0.0);
      const horizon = pow(float(1).sub(max(dir.y, 0.0)), 5.0);
      const warm = vec3(0.55, 0.24, 0.1).mul(pow(toward, 2.0)).add(vec3(0.16, 0.1, 0.2));
      const twGlow = mix(vec3(0.015, 0.03, 0.09), warm, horizon).mul(smoothstep(-0.25, 0.02, dir.y));
      const night = stars.add(milky).mul(above).add(moon.mul(smoothstep(-0.05, 0.05, uMoon.y))).mul(uNight);
      return vec4(night.add(twGlow.mul(uTw)), 1.0);
    })();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3500, 48, 24), mat);
    dome.frustumCulled = false;
    dome.renderOrder = -5;
    dome.onBeforeRender = (_r, _s, cam) => dome.position.copy(cam.position);
    this.scene.add(dome);
  }

  private computeDirections() {
    const H = ((this.hour - 12) / 24) * Math.PI * 2;
    const sinEl = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(H);
    const el = Math.asin(sinEl);
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LATITUDE) - Math.tan(DECLINATION) * Math.cos(LATITUDE)) + Math.PI;
    // az measured clockwise from north (-z) toward east (+x)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    // Moon roughly opposite, a little off-axis
    const Hm = H + Math.PI * 0.97;
    const sinElM = Math.sin(LATITUDE) * Math.sin(-DECLINATION * 0.6) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(Hm);
    const elM = Math.asin(sinElM);
    const azM = Math.atan2(Math.sin(Hm), Math.cos(Hm) * Math.sin(LATITUDE) - Math.tan(-DECLINATION * 0.6) * Math.cos(LATITUDE)) + Math.PI;
    this.moonDir.set(Math.sin(azM) * Math.cos(elM), Math.sin(elM), -Math.cos(azM) * Math.cos(elM)).normalize();
  }

  update(dt: number, renderer: THREE.WebGPURenderer, camPos: THREE.Vector3) {
    this.hour = (this.hour + (dt * this.timeScale) / 60) % 24;
    this.computeDirections();
    const sunY = this.sunDir.y;
    const day = sstep(-0.1, 0.12, sunY);
    this.dayFactor = day;
    const night = 1 - sstep(-0.18, 0.02, sunY);

    // Sky shader takes a position; distance only matters for its sun-fade term.
    this.sky.sunPosition.value.copy(this.sunDir);
    this.envSky.sunPosition.value.copy(this.sunDir);

    // Key light: sun by day, moon by night.
    const useMoon = sunY < -0.04;
    const keyDir = useMoon ? this.moonDir : this.sunDir;
    const warm = sstep(0.0, 0.42, sunY);
    lerpColor(_c1.setRGB(1.0, 0.42, 0.16), _c2.setRGB(1.0, 0.95, 0.88), warm, this.sun.color);
    let intensity = 4.4 * sstep(-0.02, 0.1, sunY) * (0.55 + 0.45 * warm);
    if (useMoon) {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      intensity = 0.32 * sstep(-0.05, 0.25, this.moonDir.y) * (1 - day);
    }
    this.sun.intensity = intensity;
    this.sun.position.copy(camPos).addScaledVector(keyDir, 800);
    this.sun.target.position.copy(camPos);
    this.sun.target.updateMatrixWorld();

    // Twilight peaks just after sunset and before sunrise.
    const tw = sstep(-0.24, -0.02, sunY) * (1 - sstep(0.0, 0.14, sunY));
    this.uTwilight.value = tw;
    this.hemi.intensity = 0.03 + 0.07 * day + 0.22 * tw;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.68 + 0.15 * day - 0.1 * tw, 1.0);
    this.hemi.groundColor.setRGB(0.29 * (0.3 + day), 0.25 * (0.3 + day), 0.19 * (0.3 + day));

    // Fog/haze colour follows the horizon.
    const golden = sstep(0.35, 0.02, sunY) * day;
    lerpColor(_c1.setRGB(0.020, 0.028, 0.045), _c2.setRGB(0.56, 0.66, 0.78), day, this.uFogColor.value as THREE.Color);
    (this.uFogColor.value as THREE.Color).lerp(_c1.setRGB(0.78, 0.6, 0.48), golden * 0.55);
    lerpColor(_c1.setRGB(0.05, 0.06, 0.09), _c2.setRGB(1.0, 0.82, 0.6), day, this.uFogSunColor.value as THREE.Color);
    (this.uFogSunColor.value as THREE.Color).lerp(_c1.setRGB(1.0, 0.55, 0.28), golden);
    this.uSunDir.value.copy(this.sunDir);
    this.uMoonDir.value.copy(this.moonDir);
    this.uNight.value = night;
    (this.uSunColor.value as THREE.Color).copy(this.sun.color).multiplyScalar(this.sun.intensity / 4.4);

    // Exposure: open up at night so moonlit scenes stay readable.
    renderer.toneMappingExposure = THREE.MathUtils.lerp(2.6, 0.66, sstep(-0.2, 0.15, sunY));
    this.scene.environmentIntensity = 0.3 + 0.2 * day;

    // Refresh image-based lighting from the sky when the sun has moved.
    this.envTimer -= dt;
    if (this.envTimer <= 0 || this.lastEnvSun.distanceToSquared(this.sunDir) > 0.0004) {
      this.cubeCam.update(renderer, this.envScene);
      this.cubeRT.texture.needsPMREMUpdate = true;
      this.lastEnvSun.copy(this.sunDir);
      this.envTimer = 4;
    }
  }

  setHour(h: number) { this.hour = ((h % 24) + 24) % 24; this.envTimer = 0; }
}
