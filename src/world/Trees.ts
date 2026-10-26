// Procedural trees (ez-tree geometry) placed in groves and along the river.
// Three levels of detail: full trees up close, simplified trees in the middle
// distance, and baked billboard "impostors" for far forests.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, uint, hash, sin, time, positionLocal, positionGeometry, instanceIndex,
  texture, max, dot, pow, positionWorld, cameraPosition, uv, mx_noise_float, instancedBufferAttribute,
  atan, floor, mod, varying, transformNormalToView, normalize, color,
} from 'three/tsl';
// @ts-ignore - ez-tree source module (JS)
import { Tree } from 'ez-tree-src';
import { Heightfield } from './Heightfield';
import { Simplex2, mulberry32, smoothstep as sstep } from './Noise';
import { WORLD_HALF, EMBERHOLD_SITE, SPAWN, riverDistance } from './WorldConfig';
import type { SkySystem } from './SkySystem';

interface Species {
  preset: string;
  height: [number, number];
  leafTint: number;
  bush?: boolean;
}

const SPECIES: Record<string, Species> = {
  oakL: { preset: 'Oak Large', height: [16, 23], leafTint: 0xd9e2a8 },
  oakM: { preset: 'Oak Medium', height: [11, 16], leafTint: 0xe2e6b0 },
  ashL: { preset: 'Ash Large', height: [15, 21], leafTint: 0xe4e8b4 },
  ashM: { preset: 'Ash Medium', height: [10, 15], leafTint: 0xe8ebba },
  aspen: { preset: 'Aspen Medium', height: [12, 17], leafTint: 0xa9cf86 },
  pineL: { preset: 'Pine Large', height: [18, 27], leafTint: 0xc2cfa6 },
  pineM: { preset: 'Pine Medium', height: [11, 17], leafTint: 0xcad6ac },
  bush1: { preset: 'Bush 1', height: [1.4, 2.4], leafTint: 0xd6dea6, bush: true },
  bush2: { preset: 'Bush 2', height: [1.1, 2.0], leafTint: 0xdee4b0, bush: true },
};

export interface TreeInstance {
  kind: string;
  x: number; y: number; z: number;
  scale: number; yaw: number;
  trunkRadius: number;
  height: number;
}

interface TreeGeo {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  barkMaps: any;
  leafMap: THREE.Texture;
  trunkRadius: number;
  alphaTest: number;
}

interface Impostor {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  inst: THREE.InstancedBufferAttribute; // x, y, z, scale
  yaw: THREE.InstancedBufferAttribute;
  size: number;
}

interface Variant {
  kind: string;
  bush: boolean;
  baseH: number;
  full: TreeGeo;
  lods: { branches: THREE.InstancedMesh; leaves: THREE.InstancedMesh }[];
  impostor: Impostor | null;
  members: TreeInstance[];
  // Trees currently assigned to the full / simplified meshes, with their matrices,
  // so each frame we only copy the ones inside the view.
  cand: { list: TreeInstance[]; mats: Float32Array }[];
}

const _pv = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

const FRAMES = 8;           // impostor views around the tree
const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
const CELL_PX = 256;

function makeTreeGeometry(preset: string, lod: number, targetHeight: number): TreeGeo {
  const tree = new Tree();
  tree.loadPreset(preset); // generates
  if (lod > 0) {
    const o = tree.options;
    for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(2, Math.ceil(o.branch.sections[k] * 0.35));
    for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.ceil(o.branch.segments[k] * 0.4));
    o.leaves.count = Math.max(2, Math.ceil(o.leaves.count * 0.3));
    o.leaves.size *= 1.75;
    tree.generate();
  }
  const bGeo: THREE.BufferGeometry = tree.branchesMesh.geometry;
  const lGeo: THREE.BufferGeometry = tree.leavesMesh.geometry;
  bGeo.computeBoundingBox();
  lGeo.computeBoundingBox();
  const box = bGeo.boundingBox!.clone().union(lGeo.boundingBox!);
  const s = targetHeight / Math.max(0.01, box.max.y - box.min.y);
  bGeo.scale(s, s, s);
  lGeo.scale(s, s, s);
  // Canopy-shaped normals give leaves soft, volumetric lighting instead of flat cards.
  lGeo.computeBoundingBox();
  const lb = lGeo.boundingBox!;
  const center = new THREE.Vector3((lb.min.x + lb.max.x) / 2, (lb.min.y + lb.max.y) / 2, (lb.min.z + lb.max.z) / 2);
  const pos = lGeo.attributes.position as THREE.BufferAttribute;
  const nrm = (lGeo.attributes.normal as THREE.BufferAttribute) ?? new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center).normalize();
    n.fromBufferAttribute(nrm, i);
    n.lerp(v, 0.75).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  lGeo.setAttribute('normal', nrm);
  bGeo.computeBoundingSphere();
  lGeo.computeBoundingSphere();
  const bark = tree.branchesMesh.material as THREE.MeshPhongMaterial;
  const leaf = tree.leavesMesh.material as THREE.MeshPhongMaterial;
  return {
    branches: bGeo, leaves: lGeo,
    barkMaps: { map: bark.map, normalMap: bark.normalMap, roughnessMap: bark.roughnessMap, aoMap: bark.aoMap, color: bark.color.clone() },
    leafMap: leaf.map,
    trunkRadius: tree.options.branch.radius[0] * s,
    alphaTest: tree.options.leaves.alphaTest,
  };
}

export class Trees {
  readonly group = new THREE.Group();
  readonly instances: TreeInstance[] = [];
  private variants: Variant[] = [];
  private lastUpdate = new THREE.Vector3(1e9, 0, 0);

  constructor(
    private hf: Heightfield, private sky: SkySystem, density: number,
    private fullDistance: number, private midDistance: number, private a2c: boolean,
  ) {
    this.place(density);
    const byKind = new Map<string, TreeInstance[]>();
    for (const t of this.instances) {
      if (!byKind.has(t.kind)) byKind.set(t.kind, []);
      byKind.get(t.kind)!.push(t);
    }
    for (const [kind, members] of byKind) {
      const sp = SPECIES[kind];
      const baseH = (sp.height[0] + sp.height[1]) / 2;
      let full!: TreeGeo;
      const lods = [0, 1].map((lod) => {
        const g = makeTreeGeometry(sp.preset, lod, baseH);
        if (lod === 0) full = g;
        const barkMat = this.barkMaterial(g.barkMaps, baseH);
        const leafMat = this.leafMaterial(g.leafMap, sp.leafTint, g.alphaTest, baseH);
        const b = new THREE.InstancedMesh(g.branches, barkMat, members.length);
        const l = new THREE.InstancedMesh(g.leaves, leafMat, members.length);
        for (const m of [b, l]) {
          m.castShadow = true; m.receiveShadow = true; m.count = 0;
          m.frustumCulled = false;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m);
        }
        if (lod === 0) for (const t of members) t.trunkRadius = g.trunkRadius * t.scale;
        return { branches: b, leaves: l };
      });
      this.variants.push({ kind, bush: !!sp.bush, baseH, full, lods, impostor: null, members, cand: [{ list: [], mats: new Float32Array(members.length * 16) }, { list: [], mats: new Float32Array(members.length * 16) }] });
    }
    this.group.name = 'Trees';
  }

  /** Render each species from eight directions into a texture atlas for far-away billboards. */
  bakeImpostors(renderer: THREE.WebGPURenderer) {
    const capScene = new THREE.Scene();
    capScene.add(new THREE.AmbientLight(0xffffff, 1));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;

    for (const v of this.variants) {
      if (v.bush) continue;
      const sp = SPECIES[v.kind];
      const g = v.full;
      const barkMat = new THREE.MeshBasicNodeMaterial({ map: g.barkMaps.map });
      barkMat.color.copy(g.barkMaps.color).multiplyScalar(0.55);
      const leafMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, alphaTest: g.alphaTest });
      const tex = texture(g.leafMap, uv());
      // Darken toward the canopy core to fake self-shadowing inside the crown.
      const core = normalize(positionLocal.sub(vec3(0, v.baseH * 0.62, 0))).y.mul(0.25).add(0.75);
      leafMat.colorNode = tex.rgb.mul(new THREE.Color(sp.leafTint)).mul(core).mul(0.82);
      leafMat.opacityNode = tex.a;
      const bark = new THREE.Mesh(g.branches, barkMat);
      const leaves = new THREE.Mesh(g.leaves, leafMat);
      capScene.add(bark, leaves);

      const box = new THREE.Box3().setFromObject(bark).union(new THREE.Box3().setFromObject(leaves));
      const radial = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
      const size = Math.max(radial * 2, box.max.y) * 1.04;
      cam.left = -size / 2; cam.right = size / 2; cam.top = size; cam.bottom = 0;
      cam.updateProjectionMatrix();

      const rt = new THREE.RenderTarget(CELL_PX * ATLAS_COLS, CELL_PX * ATLAS_ROWS, { generateMipmaps: true });
      rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(new THREE.Color(0x2c3a1e), 0);
      renderer.autoClear = false;
      renderer.clear();
      for (let f = 0; f < FRAMES; f++) {
        const a = (f / FRAMES) * Math.PI * 2;
        cam.position.set(Math.sin(a) * 200, 0, Math.cos(a) * 200);
        cam.lookAt(0, 0, 0);
        const col = f % ATLAS_COLS, row = Math.floor(f / ATLAS_COLS);
        rt.viewport.set(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
        rt.scissor.set(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
        renderer.render(capScene, cam);
      }
      renderer.setRenderTarget(null);
      capScene.remove(bark, leaves);
      v.impostor = this.makeImpostor(v, rt.texture, size);
    }
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTone;
    this.lastUpdate.set(1e9, 0, 0);
  }

  private makeImpostor(v: Variant, atlas: THREE.Texture, size: number): Impostor {
    const n = v.members.length;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    quad.translate(0, 0.5, 0);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const inst = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const yaw = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    inst.setUsage(THREE.DynamicDrawUsage); yaw.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInst', inst);
    geo.setAttribute('aYaw', yaw);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.45, side: THREE.DoubleSide });
    const aInst = instancedBufferAttribute(inst);
    const aYaw = instancedBufferAttribute(yaw);
    const center = aInst.xyz;
    const s = aInst.w.mul(size);
    const toCam = vec2(cameraPosition.x.sub(center.x), cameraPosition.z.sub(center.z)).normalize();
    const right = vec3(toCam.y, 0.0, toCam.x.negate());
    const local = positionGeometry;
    mat.positionNode = center.add(right.mul(local.x.mul(s))).add(vec3(0.0, local.y.mul(s), 0.0));

    // Pick the baked view closest to the current viewing direction.
    const ang = atan(toCam.x, toCam.y).sub(aYaw);
    const frame = mod(floor(ang.div(Math.PI * 2).mul(FRAMES).add(0.5)), FRAMES);
    const fv = varying(frame, 'vImpFrame');
    const colIdx = mod(fv, ATLAS_COLS);
    const rowIdx = floor(fv.div(ATLAS_COLS));
    const auv = vec2(colIdx.add(uv().x).div(ATLAS_COLS), rowIdx.add(uv().y).div(ATLAS_ROWS));
    const t = texture(atlas, auv);
    const variation = hash(instanceIndex.add(uint(5))).mul(0.2).add(0.9);
    mat.colorNode = t.rgb.mul(variation).mul(1.15);
    mat.opacityNode = t.a;
    mat.roughnessNode = float(0.85);
    // Rounded canopy normal so distant forests catch the light like volumes.
    const nWorld = vec3(right.x.mul(uv().x.sub(0.5).mul(1.4)), uv().y.mul(0.8).add(0.45), right.z.mul(uv().x.sub(0.5).mul(1.4)))
      .add(vec3(toCam.x, 0.0, toCam.y).mul(0.35)).normalize();
    mat.normalNode = transformNormalToView(varying(nWorld, 'vImpNormal'));
    // Leaves let light through: brighten crowns seen against the sun.
    const viewDir = positionWorld.sub(cameraPosition).normalize();
    const back = pow(max(dot(viewDir, this.sky.uSunDir), 0.0), 3.0);
    mat.emissiveNode = mat.colorNode.mul(this.sky.uSunColor).mul(back.mul(0.4).add(0.05));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `impostor_${v.kind}`;
    this.group.add(mesh);
    return { mesh, geo, inst, yaw, size };
  }

  private place(density: number) {
    const noise = new Simplex2(777);
    const rand = mulberry32(99);
    const spacing = 7.5 / Math.sqrt(Math.max(0.2, density));
    const n = Math.floor((WORLD_HALF * 2 - 40) / spacing);
    const nrm = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + 20 + (i + rand()) * spacing;
        const z = -WORLD_HALF + 20 + (j + rand()) * spacing;
        const h = this.hf.height(x, z);
        if (h < 1.4 || h > 175) continue;
        this.hf.normal(x, z, nrm);
        if (nrm.y < 0.82) continue;
        const rd = riverDistance(x, z);
        if (rd < 19) continue;
        const de = Math.hypot(x - EMBERHOLD_SITE.x, z - EMBERHOLD_SITE.z);
        if (de < EMBERHOLD_SITE.radius + 25) continue;
        const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z);

        const forest = sstep(0.12, 0.42, noise.fbm(x * 0.0032, z * 0.0032, 4));
        const riverside = sstep(70, 24, rd) * 0.35;
        const highland = sstep(55, 110, h);
        let p = forest * 0.85 + riverside + 0.012; // a few lone meadow trees
        p *= 1 - sstep(60, 26, ds) * 0.97;           // keep the spawn meadow open
        p *= 1 - sstep(EMBERHOLD_SITE.radius + 120, EMBERHOLD_SITE.radius + 30, de) * 0.8;
        if (rand() > p) {
          // Bushes on forest edges and along the river
          const pb = (forest * (1 - forest) * 2.2 + riverside * 0.8) * (1 - sstep(40, 15, ds));
          if (rand() < pb * 0.5) {
            this.instances.push({ kind: rand() < 0.5 ? 'bush1' : 'bush2', x, y: h - 0.1, z, scale: 0.7 + rand() * 0.6, yaw: rand() * Math.PI * 2, trunkRadius: 0, height: 0 });
          }
          continue;
        }
        let kind: string;
        const r = rand();
        if (highland > 0.5 || noise.noise(x * 0.002 + 50, z * 0.002) > 0.45) kind = r < 0.6 ? 'pineL' : 'pineM';
        else if (rd < 60) kind = r < 0.45 ? 'aspen' : r < 0.75 ? 'ashM' : 'oakM';
        else kind = r < 0.32 ? 'oakL' : r < 0.55 ? 'oakM' : r < 0.78 ? 'ashL' : r < 0.9 ? 'ashM' : 'aspen';
        const sp = SPECIES[kind];
        const baseH = (sp.height[0] + sp.height[1]) / 2;
        const target = sp.height[0] + rand() * (sp.height[1] - sp.height[0]);
        this.instances.push({ kind, x, y: h - 0.25, z, scale: target / baseH, yaw: rand() * Math.PI * 2, trunkRadius: 0, height: target });
      }
    }
  }

  private windOffset(treeHeight: number) {
    const sky = this.sky;
    return Fn(() => {
      const phase = hash(instanceIndex.add(uint(11))).mul(6.283);
      const hNorm = positionGeometry.y.div(treeHeight).max(0.0);
      const sway = hNorm.mul(hNorm);
      const gust = sin(time.mul(0.55).add(phase)).mul(0.6).add(sin(time.mul(1.3).add(phase.mul(1.7))).mul(0.25));
      const amp = sway.mul(gust.add(0.5)).mul(0.18).mul(sky.uWind);
      return vec3(amp.mul(0.82), float(0), amp.mul(0.57));
    })();
  }

  private barkMaterial(m: any, treeHeight: number) {
    const mat = new THREE.MeshStandardNodeMaterial({
      map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, aoMap: m.aoMap,
    });
    mat.color.copy(m.color).multiplyScalar(0.92);
    mat.normalScale = new THREE.Vector2(1.2, 1.2);
    mat.positionNode = positionLocal.add(this.windOffset(treeHeight).mul(0.6));
    return mat;
  }

  private leafMaterial(map: THREE.Texture, tint: number, alphaTest: number, treeHeight: number) {
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest });
    mat.alphaToCoverage = this.a2c;
    const variation = hash(instanceIndex.add(uint(5))).mul(0.25).add(0.85);
    const tex = texture(map, uv());
    const base = tex.rgb.mul(color(tint)).mul(variation);
    mat.colorNode = base;
    mat.opacityNode = tex.a;
    mat.roughnessNode = float(0.78);
    const flutter = Fn(() => {
      const p = positionGeometry;
      const nz = mx_noise_float(p.mul(0.35).add(vec3(time.mul(1.4), 0.0, time.mul(0.9))));
      return vec3(nz, nz.mul(0.5), nz.negate()).mul(0.06).mul(this.sky.uWind);
    })();
    mat.positionNode = positionLocal.add(this.windOffset(treeHeight)).add(flutter);
    // Sunlight glowing through the canopy when looking toward the sun.
    const viewDir = positionWorld.sub(cameraPosition).normalize();
    const back = pow(max(dot(viewDir, this.sky.uSunDir), 0.0), 4.0);
    mat.emissiveNode = base.mul(this.sky.uSunColor).mul(back.mul(0.35));
    return mat;
  }

  update(camera: THREE.PerspectiveCamera) {
    const cam = camera.position;
    if (this.lastUpdate.distanceToSquared(cam) >= 64) this.assign(cam);
    this.cull(camera);
  }

  /** Decide each tree's level of detail (only when the player has moved a few metres). */
  private assign(cam: THREE.Vector3) {
    this.lastUpdate.copy(cam);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const full2 = this.fullDistance ** 2;
    const mid2 = this.midDistance ** 2;
    const bush2 = (this.midDistance * 0.6) ** 2;
    for (const v of this.variants) {
      let c2 = 0;
      const imp = v.impostor;
      v.cand[0].list.length = 0;
      v.cand[1].list.length = 0;
      for (const t of v.members) {
        const d2 = (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2;
        let lod: number;
        if (v.bush) lod = d2 < bush2 ? 0 : -1;
        else lod = d2 < full2 ? 0 : d2 < mid2 || !imp ? 1 : 2;
        if (lod < 0) continue;
        if (lod === 2) {
          imp!.inst.setXYZW(c2, t.x, t.y, t.z, t.scale);
          imp!.yaw.setX(c2, t.yaw);
          c2++;
          continue;
        }
        q.setFromAxisAngle(up, t.yaw);
        s.setScalar(t.scale);
        p.set(t.x, t.y, t.z);
        m.compose(p, q, s);
        const c = v.cand[lod];
        m.toArray(c.mats, c.list.length * 16);
        c.list.push(t);
      }
      if (imp) {
        imp.geo.instanceCount = c2;
        imp.inst.needsUpdate = true;
        imp.yaw.needsUpdate = true;
        imp.mesh.visible = c2 > 0;
      }
    }
  }

  /** Every frame: draw only the detailed trees that can be seen (or are close enough to shade the view). */
  private cull(camera: THREE.PerspectiveCamera) {
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cam = camera.position;
    for (const v of this.variants) {
      for (let lod = 0; lod < 2; lod++) {
        const c = v.cand[lod];
        const b = v.lods[lod].branches, l = v.lods[lod].leaves;
        const bArr = b.instanceMatrix.array as Float32Array;
        const lArr = l.instanceMatrix.array as Float32Array;
        let n = 0;
        for (let i = 0; i < c.list.length; i++) {
          const t = c.list[i];
          const h = Math.max(t.height, 2.5);
          _sphere.center.set(t.x, t.y + h * 0.5, t.z);
          _sphere.radius = h * 0.75 + 4;
          const near = (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 < 900;
          if (!near && !_frustum.intersectsSphere(_sphere)) continue;
          bArr.set(c.mats.subarray(i * 16, i * 16 + 16), n * 16);
          lArr.set(c.mats.subarray(i * 16, i * 16 + 16), n * 16);
          n++;
        }
        b.count = l.count = n;
        b.instanceMatrix.needsUpdate = true;
        l.instanceMatrix.needsUpdate = true;
      }
    }
  }

  get count() { return this.instances.filter((t) => !SPECIES[t.kind].bush).length; }
}
