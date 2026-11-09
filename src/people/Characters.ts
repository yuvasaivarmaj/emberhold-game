// Real people for Emberhold: CC0 human bodies (from the Dramatis character library) dressed
// by tools/people/build_people.py in medieval clothes, animated with the Universal Animation
// Library's clips (idle, walk, jog), with sitting, working, talking, guarding, sleeping and
// looking-at-you layered on top of the clips by turning joints in the body's own space.
//
// Each person is a clone of the male or female model with the garments for their walk of
// life switched on and recoloured. Clones are pooled and reused as people come and go.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Look } from './Body';
import { DYES } from './Body';
import type { PoseState } from './Pose';

const GARMENTS = ['body', 'bodyDressed', 'bodyRobed', 'shirt', 'coat', 'hose', 'boots', 'tunicSkirt', 'robeSkirt', 'coatSkirt', 'dressSkirt',
  'belt', 'apron', 'cloak', 'tabard', 'coif', 'hood', 'helmet', 'cap', 'beard'] as const;
type Garment = typeof GARMENTS[number];

/**
 * Garments that share a material are merged into one skinned mesh per person, so a person
 * costs three or four draw calls instead of ten. Each person's merged mesh shares the
 * vertex data and keeps its own index (only the garments they wear) and, for cloth, its own
 * vertex colours (the dyes they wear).
 */
const MERGED: Record<string, readonly Garment[]> = {
  cloth: ['shirt', 'coat', 'hose', 'tunicSkirt', 'robeSkirt', 'coatSkirt', 'dressSkirt', 'apron', 'cloak', 'tabard', 'coif', 'hood', 'cap'],
  leather: ['boots', 'belt'],
};
interface Part { group: string; v0: number; vn: number; i0: number; n: number }

/** The base models' heights (metres), for scaling to each person. */
const BASE_H = { male: 1.897, female: 1.901 };

export interface Char {
  sex: 'male' | 'female';
  outer: THREE.Group;          // placed and turned in the world
  pose: THREE.Group;           // sitting drop, lying down
  model: THREE.Object3D;       // the cloned scene
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  jog: THREE.AnimationAction;
  bones: Record<string, THREE.Bone>;
  meshes: Record<string, THREE.SkinnedMesh>;
  scale: number;
  shadow: boolean;
}

export class Characters {
  private src: Record<'male' | 'female', THREE.Object3D> = {} as any;
  private clips: Record<string, THREE.AnimationClip> = {};
  private pool: Char[] = [];
  private parts: Record<'male' | 'female', Partial<Record<Garment, Part>>> = { male: {}, female: {} };
  private srcIndex: Record<'male' | 'female', Record<string, Uint32Array>> = { male: {}, female: {} };
  ready = false;

  async load(base = document.baseURI) {
    const L = new GLTFLoader();
    const url = (f: string) => new URL(`./models/people/${f}`, base).toString();
    const [m, f, c] = await Promise.all([L.loadAsync(url('male.glb')), L.loadAsync(url('female.glb')), L.loadAsync(url('clips.glb'))]);
    this.src.male = m.scene;
    this.src.female = f.scene;
    for (const a of c.animations) this.clips[a.name] = a;
    for (const s of [m.scene, f.scene]) s.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) { mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; }
    });
    this.merge('male');
    this.merge('female');
    this.ready = true;
  }

  /** Merge each material's garments into one skinned mesh on the source model. */
  private merge(sex: 'male' | 'female') {
    const root = this.src[sex];
    const byName: Record<string, THREE.SkinnedMesh> = {};
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) byName[o.name] = o as THREE.SkinnedMesh; });
    for (const [group, names] of Object.entries(MERGED)) {
      const list = names.map((n) => byName[n]).filter(Boolean);
      if (!list.length) continue;
      let nv = 0, ni = 0;
      for (const m of list) { nv += m.geometry.attributes.position.count; ni += m.geometry.index!.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      const sk = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), idx = new Uint32Array(ni);
      let v = 0, i = 0;
      for (const m of list) {
        const g = m.geometry, A = g.attributes;
        const c = A.position.count;
        for (let k = 0; k < c; k++) {
          const o = v + k;
          pos[o * 3] = A.position.getX(k); pos[o * 3 + 1] = A.position.getY(k); pos[o * 3 + 2] = A.position.getZ(k);
          nor[o * 3] = A.normal.getX(k); nor[o * 3 + 1] = A.normal.getY(k); nor[o * 3 + 2] = A.normal.getZ(k);
          uv[o * 2] = A.uv.getX(k); uv[o * 2 + 1] = A.uv.getY(k);
          sk[o * 4] = A.skinIndex.getX(k); sk[o * 4 + 1] = A.skinIndex.getY(k); sk[o * 4 + 2] = A.skinIndex.getZ(k); sk[o * 4 + 3] = A.skinIndex.getW(k);
          sw[o * 4] = A.skinWeight.getX(k); sw[o * 4 + 1] = A.skinWeight.getY(k); sw[o * 4 + 2] = A.skinWeight.getZ(k); sw[o * 4 + 3] = A.skinWeight.getW(k);
        }
        const I = g.index!;
        for (let k = 0; k < I.count; k++) idx[i + k] = I.getX(k) + v;
        this.parts[sex][m.name as Garment] = { group, v0: v, vn: c, i0: i, n: I.count };
        v += c; i += I.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(sk, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const first = list[0];
      const mat = (first.material as THREE.MeshStandardMaterial).clone();
      if (group === 'cloth') { mat.color.setRGB(1, 1, 1); mat.vertexColors = true; }
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.name = group;
      this.srcIndex[sex][group] = idx;
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
      first.parent!.add(mesh);
      mesh.bind(first.skeleton, first.bindMatrix);
      for (const m of list) m.removeFromParent();
    }
  }

  /** A dressed, animated person for this look (from the pool if one is free). */
  make(L: Look, seed: number): Char {
    const sex: 'male' | 'female' = L.garb === 'dress' || L.garb === 'nobleGown' || (L.garb === 'servant' && L.apron !== null && L.hairStyle === 'coif') ? 'female' : 'male';
    const i = this.pool.findIndex((c) => c.sex === sex);
    const ch = i >= 0 ? this.pool.splice(i, 1)[0] : this.clone(sex);
    this.dress(ch, L, seed);
    return ch;
  }

  release(ch: Char) {
    ch.outer.removeFromParent();
    ch.mixer.stopAllAction();
    for (const c of ch.outer.children.slice()) if (c !== ch.pose) ch.outer.remove(c);
    if (this.pool.length < 40) this.pool.push(ch);
  }

  private clone(sex: 'male' | 'female'): Char {
    const model = SkeletonUtils.clone(this.src[sex]);
    const bones: Record<string, THREE.Bone> = {};
    const meshes: Record<string, THREE.SkinnedMesh> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        meshes[m.name] = m;
        // Each person wears their own colours.
        if (m.material && (m.material as THREE.Material).name !== 'iron') m.material = (m.material as THREE.Material).clone();
        m.frustumCulled = false;
        if (MERGED[m.name]) {
          // Shared vertex data, a private index (what this person wears) and private dyes.
          const src = m.geometry, g = new THREE.BufferGeometry();
          for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
          g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index!.count), 1));
          if (m.name === 'cloth') g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 3), 3));
          m.geometry = g;
        }
      }
    });
    const pose = new THREE.Group();
    pose.add(model);
    const outer = new THREE.Group();
    outer.add(pose);
    const mixer = new THREE.AnimationMixer(model);
    const idle = mixer.clipAction(this.clips.Idle_Loop);
    const walk = mixer.clipAction(this.clips.Walk_Loop);
    const jog = mixer.clipAction(this.clips.Jog_Fwd_Loop ?? this.clips.Walk_Loop);
    return { sex, outer, pose, model, mixer, idle, walk, jog, bones, meshes, scale: 1, shadow: false };
  }

  private dress(ch: Char, L: Look, seed: number) {
    const female = ch.sex === 'female';
    const on = new Set<Garment>();
    const col: Partial<Record<Garment, number>> = {};
    const g = L.garb;
    const longSkirt = g === 'robe' || g === 'dress' || g === 'nobleGown' || (female && g !== 'guard');
    on.add(longSkirt ? 'bodyRobed' : 'bodyDressed');
    on.add('boots');
    if (g === 'noble' || g === 'nobleGown') { on.add('coat'); col.coat = L.cloth; } else { on.add('shirt'); col.shirt = g === 'guard' ? DYES.charcoal : L.cloth; }
    if (longSkirt) {
      if (female) { on.add('dressSkirt'); col.dressSkirt = g === 'nobleGown' ? L.cloth : L.cloth; }
      else { on.add('robeSkirt'); col.robeSkirt = L.cloth; }
    } else if (g === 'noble') { on.add('coatSkirt'); col.coatSkirt = L.cloth; on.add('hose'); col.hose = L.legs; }
    else { on.add('tunicSkirt'); col.tunicSkirt = g === 'guard' ? DYES.charcoal : L.cloth; on.add('hose'); col.hose = L.legs; }
    on.add('belt'); // it also hides the seam where a bodice meets the skirt
    if (L.apron != null) { on.add('apron'); col.apron = L.apron; }
    if (L.cloak != null) { on.add('cloak'); col.cloak = L.cloak; }
    if (g === 'guard') { on.add('tabard'); col.tabard = L.cloth; if (L.helmet) on.add('helmet'); }
    if (L.hairStyle === 'coif') { on.add('coif'); col.coif = L.cloth2; }
    else if (L.hairStyle === 'hood' && !female) { on.add('cap'); col.cap = L.cloak ?? L.cloth; }
    else if (!female && seed > 0.72 && g !== 'noble' && g !== 'guard') { on.add('cap'); col.cap = [DYES.brown, DYES.grey, DYES.moss, DYES.charcoal][Math.floor(seed * 40) % 4]; }
    if (!female && L.beard) { on.add('beard'); col.beard = L.hair; }
    for (const name of GARMENTS) {
      const m = ch.meshes[name];
      if (!m) continue;
      m.visible = on.has(name);
      if (!m.visible) continue;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (name === 'body' || name === 'bodyDressed' || name === 'bodyRobed') skinTint(L.skin, female, mat.color);
      else if (col[name] !== undefined && mat.name !== 'iron') mat.color.setHex(col[name]!).multiplyScalar(name === 'beard' ? 1.0 : 1.25);
    }
    const parts = this.parts[ch.sex];
    const c = new THREE.Color();
    for (const group of Object.keys(MERGED)) {
      const m = ch.meshes[group];
      if (!m) continue;
      const g = m.geometry, I = g.index!, out = I.array as Uint32Array, src = this.srcIndex[ch.sex][group];
      const C = g.attributes.color as THREE.BufferAttribute | undefined;
      let n = 0;
      for (const name of MERGED[group]) {
        const p = parts[name];
        if (!p || !on.has(name)) continue;
        out.set(src.subarray(p.i0, p.i0 + p.n), n);
        n += p.n;
        if (C) {
          c.setHex(col[name] ?? 0x808080).multiplyScalar(1.25);
          const arr = C.array as Float32Array;
          for (let k = p.v0; k < p.v0 + p.vn; k++) { arr[k * 3] = c.r; arr[k * 3 + 1] = c.g; arr[k * 3 + 2] = c.b; }
        }
      }
      g.setDrawRange(0, n);
      I.needsUpdate = true;
      if (C) C.needsUpdate = true;
      m.visible = n > 0;
    }
    // Size: the base models are tall; children are small adults with bigger heads.
    const child = L.height < 1.4;
    ch.scale = L.height / BASE_H[ch.sex];
    ch.model.scale.setScalar(ch.scale * (0.96 + L.build * 0.04));
    ch.model.scale.x *= 0.92 + L.build * 0.08;
    ch.bones.Head?.scale.setScalar(child ? 1.28 : 1);
    ch.idle.reset().play().setEffectiveWeight(1);
    ch.walk.reset().play().setEffectiveWeight(0);
    ch.jog.reset().play().setEffectiveWeight(0);
    ch.mixer.setTime(seed * 3);
  }

  /** Animate and pose one person for this frame. */
  animate(ch: Char, st: PoseState, dt: number) {
    const v = st.mode === 'walk' ? st.speed : 0;
    const wWalk = Math.min(1, v / 0.6) * (v > 2.2 ? Math.max(0, 1 - (v - 2.2) / 0.8) : 1);
    const wJog = v > 2.2 ? Math.min(1, (v - 2.2) / 0.8) : 0;
    ch.walk.setEffectiveWeight(wWalk);
    ch.walk.setEffectiveTimeScale(Math.max(0.6, v / (1.25 * ch.scale * 1.05)));
    ch.jog.setEffectiveWeight(wJog);
    ch.jog.setEffectiveTimeScale(Math.max(0.6, v / (3.0 * ch.scale)));
    ch.idle.setEffectiveWeight(Math.max(0, 1 - wWalk - wJog));
    ch.mixer.update(dt);
    poseOver(ch, st);
  }
}

/**
 * A cheap stand-in for people far away: the dressed model posed mid-idle, baked into one
 * static mesh with flat colours, and simplified by merging vertices on a ~4 cm grid.
 */
export function bakeFar(chars: Characters, L: Look, seed: number, cell = 0.04): THREE.BufferGeometry {
  const ch = chars.make(L, seed);
  ch.mixer.setTime(0.6);
  ch.mixer.update(0);
  ch.outer.updateMatrixWorld(true);
  const pos: number[] = [], colr: number[] = [], idx: number[] = [];
  const key = new Map<string, number>();
  const v = new THREE.Vector3();
  for (const m of Object.values(ch.meshes)) {
    if (!m.visible) continue;
    m.skeleton.update();
    const mat = m.material as THREE.MeshStandardMaterial;
    const base = mat.color.clone();
    if (m.name.startsWith('body')) base.multiply(new THREE.Color(0.55, 0.4, 0.32));
    else if (mat.name === 'cloth') base.multiplyScalar(0.62);
    const P = m.geometry.attributes.position as THREE.BufferAttribute;
    const C = m.geometry.attributes.color as THREE.BufferAttribute | undefined;
    const I = m.geometry.index!;
    const count = Math.min(I.count, m.geometry.drawRange.count);
    const local = new Int32Array(P.count).fill(-1);
    const c = new THREE.Color();
    const at = (i: number) => {
      if (local[i] >= 0) return local[i];
      v.fromBufferAttribute(P, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      const k = `${Math.round(v.x / cell)},${Math.round(v.y / cell)},${Math.round(v.z / cell)}`;
      let n = key.get(k);
      if (n === undefined) {
        n = pos.length / 3; key.set(k, n); pos.push(v.x, v.y, v.z);
        c.copy(base);
        if (C) c.multiply(new THREE.Color(C.getX(i), C.getY(i), C.getZ(i)));
        colr.push(c.r, c.g, c.b);
      }
      return (local[i] = n);
    };
    for (let t = 0; t + 2 < count; t += 3) {
      const a = at(I.getX(t)), b = at(I.getX(t + 1)), d = at(I.getX(t + 2));
      if (a !== b && b !== d && a !== d) idx.push(a, b, d);
    }
  }
  chars.release(ch);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const WHITE = new THREE.Color(1, 1, 1);
function skinTint(hex: number, female: boolean, out: THREE.Color) {
  // The male base is fair, the female base dark: lighten or darken toward the person's skin,
  // and warm it with the skin's own hue so nobody looks like grey plaster.
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const k = female ? 0.75 + lum * 0.75 : 0.35 + lum * 0.95;
  const m = Math.max(c.r, c.g, c.b);
  return out.setRGB(c.r / m, c.g / m, c.b / m).lerp(WHITE, female ? 0.7 : 0.5).multiplyScalar(k * (female ? 1 : 1.08));
}

// ------------------------------------------------------------------ poses over the clips
const X = new THREE.Vector3(1, 0, 0), Yv = new THREE.Vector3(0, 1, 0), Zv = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), qb = new THREE.Quaternion();

/** The bone's rotation in the model's space (the clone's root, facing +z). */
function modelQuat(o: THREE.Object3D, stop: THREE.Object3D, out: THREE.Quaternion) {
  out.identity();
  for (let p: THREE.Object3D | null = o; p && p !== stop; p = p.parent) out.premultiply(p.quaternion);
  return out;
}

/** Turn a joint about an axis given in the body's space (x: its left, y: up, z: forward). */
function turn(ch: Char, name: string, axis: THREE.Vector3, angle: number) {
  const b = ch.bones[name];
  if (!b || !angle) return;
  modelQuat(b.parent!, ch.model, qp);
  qb.copy(qp).multiply(b.quaternion);
  qa.setFromAxisAngle(axis, angle);
  qb.premultiply(qa);
  b.quaternion.copy(qp.invert().multiply(qb));
}

function poseOver(ch: Char, st: PoseState) {
  const t = st.t + st.seed * 10;
  ch.pose.position.set(0, 0, 0);
  ch.pose.rotation.set(0, 0, 0);
  const s = ch.scale;
  const seated = st.mode === 'sit' || (st.mode === 'work' && (st.task === 'write' || st.task === 'cipher' || st.task === 'weave'));
  if (st.mode === 'sleep') {
    // On the back, head to the bed's head, the whole body lifted onto the mattress.
    ch.pose.rotation.x = -Math.PI / 2;
    ch.pose.position.set(0, 0.12 * s, 0.9 * s);
    turn(ch, 'Head', Yv, Math.sin(st.seed * 7) * 0.5);
    return;
  }
  if (seated) {
    ch.pose.position.y = -0.44 * s;
    for (const sd of ['l', 'r']) {
      turn(ch, `thigh_${sd}`, X, -1.45);
      turn(ch, `calf_${sd}`, X, 1.4);
      turn(ch, `upperarm_${sd}`, X, -0.35);
      turn(ch, `lowerarm_${sd}`, X, -0.85);
    }
    turn(ch, 'spine_01', X, 0.06);
  }
  switch (st.mode) {
    case 'guard':
      turn(ch, 'upperarm_r', X, -0.25); turn(ch, 'lowerarm_r', X, -1.2);
      turn(ch, 'upperarm_l', Zv, -0.25); turn(ch, 'lowerarm_l', X, -0.8);
      break;
    case 'hearth':
      for (const sd of ['l', 'r']) { turn(ch, `upperarm_${sd}`, X, -0.75); turn(ch, `lowerarm_${sd}`, X, -0.7); }
      break;
    case 'talk': {
      const gst = Math.max(0, Math.sin(t * 1.3 + st.seed * 5));
      turn(ch, 'upperarm_r', X, -0.3 - 0.5 * gst); turn(ch, 'lowerarm_r', X, -0.6 - 0.5 * gst);
      const g2 = Math.max(0, Math.sin(t * 0.9 + 2 + st.seed * 3));
      turn(ch, 'upperarm_l', X, -0.15 - 0.3 * g2); turn(ch, 'lowerarm_l', X, -0.4 - 0.4 * g2);
      turn(ch, 'Head', X, Math.sin(t * 2.3) * 0.05);
      break;
    }
    case 'work': work(ch, st.task ?? 'hammer', t, seated); break;
  }
  if (st.lookYaw) {
    const ly = Math.max(-1.1, Math.min(1.1, st.lookYaw));
    turn(ch, 'neck_01', Yv, ly * 0.35);
    turn(ch, 'Head', Yv, ly * 0.65);
  }
  if (st.lookPitch) turn(ch, 'Head', X, -Math.max(-0.4, Math.min(0.4, st.lookPitch)));
}

function work(ch: Char, task: string, t: number, seated: boolean) {
  switch (task) {
    case 'hammer': {
      const c = (t * 0.9) % 1, lift = c < 0.7 ? c / 0.7 : 1 - (c - 0.7) / 0.3, e = lift * lift * (3 - 2 * lift);
      turn(ch, 'spine_01', X, 0.16 - 0.06 * e);
      turn(ch, 'upperarm_r', X, -0.5 - 1.5 * e); turn(ch, 'lowerarm_r', X, -0.5 - 0.8 * e);
      turn(ch, 'upperarm_l', X, -0.7); turn(ch, 'lowerarm_l', X, -0.7);
      turn(ch, 'Head', X, 0.3);
      break;
    }
    case 'bellows': case 'file': case 'knead': case 'bake': case 'dip': {
      const k = Math.sin(t * (task === 'file' ? 4 : task === 'knead' ? 2.2 : 1.6));
      turn(ch, 'spine_01', X, 0.2 + 0.06 * k);
      for (const sd of ['l', 'r']) { turn(ch, `upperarm_${sd}`, X, -0.75 - 0.25 * k); turn(ch, `lowerarm_${sd}`, X, -0.5 + 0.3 * k); }
      turn(ch, 'Head', X, 0.3);
      break;
    }
    case 'chop': {
      const c = (t * 1.6) % 1, e = c < 0.6 ? c / 0.6 : 1 - (c - 0.6) / 0.4;
      turn(ch, 'spine_01', X, 0.2);
      turn(ch, 'upperarm_r', X, -0.6 - 0.9 * e); turn(ch, 'lowerarm_r', X, -0.5 - 0.6 * e);
      turn(ch, 'upperarm_l', X, -0.65); turn(ch, 'lowerarm_l', X, -0.75);
      break;
    }
    case 'brush':
      turn(ch, 'upperarm_r', X, -0.9 + 0.35 * Math.sin(t * 3)); turn(ch, 'upperarm_r', Zv, -0.25 + 0.2 * Math.cos(t * 3)); turn(ch, 'lowerarm_r', X, -0.6);
      break;
    case 'write': case 'cipher':
      turn(ch, 'spine_01', X, 0.16);
      turn(ch, 'upperarm_r', X, -0.25); turn(ch, 'lowerarm_r', X, -0.35 + 0.06 * Math.sin(t * 6));
      turn(ch, 'upperarm_l', X, -0.2); turn(ch, 'lowerarm_l', X, -0.4);
      turn(ch, 'Head', X, 0.45);
      break;
    case 'weave': {
      const k = Math.sin(t * 2.5);
      for (const sd of ['l', 'r']) { turn(ch, `upperarm_${sd}`, X, -0.5); turn(ch, `lowerarm_${sd}`, X, -0.3); }
      turn(ch, 'upperarm_l', Yv, 0.2 * k); turn(ch, 'upperarm_r', Yv, 0.2 * k);
      break;
    }
    case 'serve':
      for (const sd of ['l', 'r']) { turn(ch, `upperarm_${sd}`, X, -0.5); turn(ch, `lowerarm_${sd}`, X, -0.7); }
      break;
    case 'sweep': {
      const k = Math.sin(t * 2.2);
      turn(ch, 'spine_01', X, 0.25); turn(ch, 'spine_03', Yv, 0.3 * k);
      turn(ch, 'upperarm_l', X, -0.5); turn(ch, 'upperarm_r', X, -0.35); turn(ch, 'lowerarm_l', X, -0.4); turn(ch, 'lowerarm_r', X, -0.6);
      break;
    }
    case 'drill': {
      const c = (t * 0.7) % 1, e = c < 0.25 ? c / 0.25 : c < 0.5 ? 1 : 1 - (c - 0.5) / 0.5;
      turn(ch, 'spine_01', X, 0.1 + 0.12 * e); turn(ch, 'spine_03', Yv, -0.25 * e);
      turn(ch, 'upperarm_r', X, -0.9 - 0.5 * e); turn(ch, 'lowerarm_r', X, -0.9 + 0.7 * e);
      turn(ch, 'upperarm_l', X, -1.1 - 0.3 * e); turn(ch, 'lowerarm_l', X, -0.4 + 0.2 * e);
      break;
    }
    case 'spar': {
      const k = Math.sin(((t * 0.8) % 1) * Math.PI * 2);
      turn(ch, 'spine_03', Yv, 0.35 * k);
      turn(ch, 'upperarm_r', X, -1.2 - 0.9 * Math.max(0, k)); turn(ch, 'upperarm_r', Zv, -0.3 + 0.5 * Math.max(0, -k));
      turn(ch, 'lowerarm_r', X, -0.5 - 0.4 * Math.max(0, k));
      turn(ch, 'upperarm_l', X, -0.6); turn(ch, 'lowerarm_l', X, -1.0);
      break;
    }
  }
  void seated;
}
