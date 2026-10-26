// GPU-placed grass: blades are generated in the vertex shader on a grid that
// follows the player. Each blade's world cell is hashed, so blades stay put as
// you walk and the patch slides seamlessly.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, int, ivec2, vec2, vec3, uint, hash, floor, mix, smoothstep, clamp, max, dot, pow,
  sin, time, textureLoad, mx_noise_float, positionGeometry, instanceIndex, cameraPosition, positionWorld,
  transformNormalToView, varying,
} from 'three/tsl';
import { Heightfield } from './Heightfield';
import { WORLD_HALF, HF_N, CELL } from './WorldConfig';
import { grassCoverage, meadowColor, PAL } from './TerrainShading';
import type { GrassLayerSpec } from '../core/Settings';
import type { SkySystem } from './SkySystem';

const _dir = new THREE.Vector3();

function bladeGeometry(segments: number): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < segments; k++) {
    const y = k / segments;
    const w = 0.5 * (1 - Math.pow(y, 1.4) * 0.92);
    pos.push(-w, y, 0, w, y, 0);
  }
  pos.push(0, 1, 0);
  for (let k = 0; k < segments - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class GrassLayer {
  readonly mesh: THREE.Mesh;
  private uOrigin = uniform(new THREE.Vector2());
  // Width (in cells) of the rectangle actually drawn this frame: only the part
  // of the patch that can be in view is generated.
  private uRowW = uniform(1, 'uint');
  private gridW: number;
  private geo: THREE.InstancedBufferGeometry;

  constructor(private spec: GrassLayerSpec, hf: Heightfield, sky: SkySystem, innerFade: number | null) {
    const W = Math.ceil((spec.radius * 2) / spec.spacing);
    this.gridW = W;
    const geo = bladeGeometry(spec.segments);
    geo.instanceCount = W * W;
    this.geo = geo;
    this.uRowW.value = W;
    // Rough bounds so the renderer never culls the patch.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    // Matte, low-specular blades that still receive sky (image-based) light.
    const mat = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
    mat.specularIntensity = 0.25;
    const hTex = hf.texture;
    const spacing = float(spec.spacing);
    const uOrigin = this.uOrigin;
    const outerR = float(spec.radius * 0.96);
    const innerR = innerFade !== null ? float(innerFade) : null;

    // --- per-blade attributes (computed once per vertex; cheap enough) ---
    const id = instanceIndex;
    const gx = float(id.mod(this.uRowW));
    const gz = float(id.div(this.uRowW));
    const cell = uOrigin.add(vec2(gx, gz));
    const seed = uint(cell.x.add(65536.0)).mul(uint(73856093)).bitXor(uint(cell.y.add(65536.0)).mul(uint(19349663)));
    const r1 = hash(seed);
    const r2 = hash(seed.add(uint(1)));
    const r3 = hash(seed.add(uint(2)));
    const r4 = hash(seed.add(uint(3)));
    const r5 = hash(seed.add(uint(4)));
    const xz = cell.add(vec2(r1, r2)).mul(spacing);

    // Height + slope from four heightfield texels (bilinear).
    const g = xz.add(WORLD_HALF).div(CELL);
    const i0 = floor(g);
    const f = g.sub(i0);
    const ix = int(clamp(i0.x, 0, HF_N - 2));
    const iz = int(clamp(i0.y, 0, HF_N - 2));
    const h00 = textureLoad(hTex, ivec2(ix, iz)).x;
    const h10 = textureLoad(hTex, ivec2(ix.add(1), iz)).x;
    const h01 = textureLoad(hTex, ivec2(ix, iz.add(1))).x;
    const h11 = textureLoad(hTex, ivec2(ix.add(1), iz.add(1))).x;
    const hgt = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
    const dhdx = mix(h10.sub(h00), h11.sub(h01), f.y).div(CELL);
    const dhdz = mix(h01.sub(h00), h11.sub(h10), f.x).div(CELL);
    const groundN = vec3(dhdx.negate(), 1.0, dhdz.negate()).normalize();

    const cover = grassCoverage(xz, groundN.y, hgt);
    const camDist = vec2(xz.x.sub(cameraPosition.x), xz.y.sub(cameraPosition.z)).length();
    let fade: any = float(1).sub(smoothstep(outerR.mul(0.72), outerR, camDist));
    if (innerR) fade = fade.mul(smoothstep(innerR.mul(0.75), innerR, camDist));
    const present = smoothstep(r4.sub(0.08), r4.add(0.08), cover);
    const tall = mx_noise_float(xz.mul(0.045)).mul(0.5).add(0.5);
    const bladeH = float(spec.height).mul(mix(0.2, 0.55, tall)).mul(r3.mul(0.55).add(0.7))
      .mul(present).mul(fade).mul(cover.sqrt().mul(0.6).add(0.4));
    const bladeW = float(spec.width).mul(r1.mul(0.6).add(0.7)).mul(present.mul(fade).sqrt());

    // Orientation + static lean
    const ang = r5.mul(6.2831853);
    const facing = vec2(ang.cos(), ang.sin());
    const right = vec2(facing.y.negate(), facing.x);
    const lean = r2.mul(0.35).add(0.1);

    // Wind: travelling gusts plus a quick flutter.
    const windDir = vec2(0.82, 0.57);
    const gust = mx_noise_float(xz.mul(0.055).sub(windDir.mul(time.mul(1.6)))).mul(0.5).add(0.5);
    const wind = gust.mul(gust).mul(0.85).add(0.15).mul(sky.uWind);
    const flutter = sin(time.mul(r1.mul(4.0).add(5.0)).add(r2.mul(30.0))).mul(0.04);

    const t = positionGeometry.y;
    const x = positionGeometry.x;
    const t2 = t.mul(t);
    const bendFwd = lean.mul(t2);
    const bendWind = wind.mul(0.75).add(flutter).mul(t2);
    const offset = vec3(
      right.x.mul(x).mul(bladeW).add(facing.x.mul(bendFwd).mul(bladeH)).add(windDir.x.mul(bendWind).mul(bladeH)),
      t.mul(bladeH).mul(float(1).sub(bendWind.mul(bendWind).mul(0.25))),
      right.y.mul(x).mul(bladeW).add(facing.y.mul(bendFwd).mul(bladeH)).add(windDir.y.mul(bendWind).mul(bladeH)),
    );
    mat.positionNode = vec3(xz.x, hgt.sub(0.02), xz.y).add(offset);

    // Soft, rounded normal: mostly the ground normal, curved across the blade.
    const n = groundN.mul(0.75).add(vec3(facing.x, 0.0, facing.y).mul(0.3)).add(vec3(right.x, 0.0, right.y).mul(x.mul(0.9))).normalize();
    mat.normalNode = transformNormalToView(varying(n, 'vGrassNormal'));

    // Colour: dark, occluded roots to sunlit tips that match the meadow.
    const meadow = meadowColor(xz);
    const tip = meadow.mul(r1.mul(0.3).add(1.15));
    const dryTip = mix(tip, PAL.grassDry, smoothstep(0.55, 0.95, r3).mul(0.4));
    const root = mix(meadow, PAL.grassDeep, 0.5).mul(0.55);
    const ht = varying(t, 'vGrassT');
    const col = varying(mix(root, dryTip, smoothstep(0.0, 0.65, t)), 'vGrassColor');
    mat.colorNode = col;

    // Light passing through the blades when you look toward the sun.
    const viewDir = positionWorld.sub(cameraPosition).normalize();
    const back = pow(max(dot(viewDir, sky.uSunDir), 0.0), 3.0);
    mat.emissiveNode = col.mul(sky.uSunColor).mul(back.mul(0.35)).mul(ht);

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'Grass';
  }

  update(camera: THREE.PerspectiveCamera) {
    const s = this.spec.spacing;
    const cam = camera.position;
    const R = this.spec.radius;
    // Bounding box of the view wedge on the ground, plus a margin around the feet.
    camera.getWorldDirection(_dir);
    let fx = _dir.x, fz = _dir.z;
    const fl = Math.hypot(fx, fz);
    let minX = cam.x - 4, maxX = cam.x + 4, minZ = cam.z - 4, maxZ = cam.z + 4;
    if (fl > 0.2) {
      fx /= fl; fz /= fl;
      const hfov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) + 0.25;
      for (const a of [-hfov, -hfov / 2, 0, hfov / 2, hfov]) {
        const c = Math.cos(a), sn = Math.sin(a);
        const px = cam.x + (fx * c - fz * sn) * R, pz = cam.z + (fx * sn + fz * c) * R;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
      }
    } else {
      // Looking straight up or down: draw the whole patch.
      minX = cam.x - R; maxX = cam.x + R; minZ = cam.z - R; maxZ = cam.z + R;
    }
    minX = Math.max(minX, cam.x - R); maxX = Math.min(maxX, cam.x + R);
    minZ = Math.max(minZ, cam.z - R); maxZ = Math.min(maxZ, cam.z + R);
    const x0 = Math.floor(minX / s), z0 = Math.floor(minZ / s);
    const w = Math.max(1, Math.min(this.gridW, Math.ceil(maxX / s) - x0 + 1));
    const h = Math.max(1, Math.min(this.gridW, Math.ceil(maxZ / s) - z0 + 1));
    this.uOrigin.value.set(x0, z0);
    this.uRowW.value = w;
    this.geo.instanceCount = w * h;
  }
}

export class Grass {
  readonly group = new THREE.Group();
  private layers: GrassLayer[] = [];

  constructor(hf: Heightfield, sky: SkySystem, near: GrassLayerSpec, far: GrassLayerSpec | null) {
    const nearLayer = new GrassLayer(near, hf, sky, null);
    this.layers.push(nearLayer);
    this.group.add(nearLayer.mesh);
    if (far) {
      const farLayer = new GrassLayer(far, hf, sky, near.radius * 0.85);
      this.layers.push(farLayer);
      this.group.add(farLayer.mesh);
    }
  }

  update(camera: THREE.PerspectiveCamera) { for (const l of this.layers) l.update(camera); }
}
