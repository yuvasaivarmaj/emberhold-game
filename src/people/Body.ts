// People's bodies: a procedural, skinned human built from simple shapes (like the horses),
// with an 18-bone skeleton and clothing for each walk of life. One geometry is shared by
// everyone who looks alike; each person gets their own skeleton to pose.
import * as THREE from 'three/webgpu';
import { attribute, positionWorld, mx_noise_float, float } from 'three/tsl';

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = typeof BONES[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;
const PARENT: number[] = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 3, 9, 10, 1, 12, 13, 1, 15, 16];

/** Joint positions in the rest pose for a 1.75 m adult (model faces +z). */
const JOINT: [number, number, number][] = [
  [0, 0, 0], [0, 0.95, 0], [0, 1.08, 0], [0, 1.30, 0], [0, 1.49, 0], [0, 1.57, 0],
  [0.185, 1.44, 0], [0.215, 1.16, -0.015], [0.235, 0.9, 0.0],
  [-0.185, 1.44, 0], [-0.215, 1.16, -0.015], [-0.235, 0.9, 0.0],
  [0.095, 0.92, 0], [0.1, 0.5, 0.01], [0.1, 0.085, -0.02],
  [-0.095, 0.92, 0], [-0.1, 0.5, 0.01], [-0.1, 0.085, -0.02],
];

export type Garb = 'tunic' | 'dress' | 'robe' | 'guard' | 'noble' | 'nobleGown' | 'child' | 'smith' | 'servant';

export interface Look {
  garb: Garb;
  height: number;           // metres
  build: number;            // 0.85 slight .. 1.2 heavy
  skin: number; hair: number;
  hairStyle: 'short' | 'long' | 'bald' | 'coif' | 'hood' | 'tied';
  beard: boolean;
  cloth: number; cloth2: number; legs: number; boots: number;
  cloak: number | null;
  apron: number | null;
  helmet: boolean;
  /** A patch over the right eye. */
  patch?: boolean;
}

export const SKIN = [0xe2bc9e, 0xd0a283, 0xb98463, 0x9a6648, 0x7a4e34, 0x5e3a28];
export const HAIR = [0x16110e, 0x2a1d14, 0x3f2b1c, 0x5a3a22, 0x7a4a26, 0x9a7a4a, 0x8a8680, 0xb8b4ac];
export const DYES = {
  linen: 0xcfc6b0, undyed: 0xa8a08a, brown: 0x6a5040, russet: 0x7a3a24, madder: 0x8a2a20, woad: 0x3a4a68,
  navy: 0x2a3448, green: 0x4a5a32, moss: 0x5a6238, ochre: 0x9a7a3a, grey: 0x6a6660, charcoal: 0x2e2a28, black: 0x1a1716,
  leather: 0x4a3222, darkLeather: 0x2e2018, iron: 0x3a3a3c,
};

// ------------------------------------------------------------------ geometry building
interface Part { g: THREE.BufferGeometry; col: number; bone: number | ((p: THREE.Vector3) => [number, number, number, number]) }

function tube(r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, seg = 8, zs = 1) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 2);
  g.scale(1, 1, zs);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}
function ball(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ws = 10, hs = 8) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function lathe(profile: [number, number][], seg = 14, zs = 0.72) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(1, 1, zs);
  return g;
}
function boxAt(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Torso weights by height: hips below the waist, spine in the middle, chest above. */
function torsoWeights(p: THREE.Vector3): [number, number, number, number] {
  const y = p.y;
  if (y < 1.04) return [B.hips, B.spine, 1, 0];
  if (y < 1.12) { const t = (y - 1.04) / 0.08; return [B.hips, B.spine, 1 - t, t]; }
  if (y < 1.26) return [B.spine, B.chest, 1, 0];
  if (y < 1.34) { const t = (y - 1.26) / 0.08; return [B.spine, B.chest, 1 - t, t]; }
  return [B.chest, B.chest, 1, 0];
}
/** Skirts and coat-tails: follow the hips, and the legs a little lower down. */
function skirtWeights(stiff: number) {
  return (p: THREE.Vector3): [number, number, number, number] => {
    const side = p.x >= 0 ? B.thighL : B.thighR;
    const a = Math.max(0, Math.min(1, (0.9 - p.y) / 0.45)) * stiff * Math.min(1, Math.abs(p.x) / 0.08);
    return [B.hips, side, 1 - a, a];
  };
}
function cloakWeights(p: THREE.Vector3): [number, number, number, number] {
  if (p.y > 1.3) return [B.chest, B.chest, 1, 0];
  if (p.y > 1.05) { const t = (p.y - 1.05) / 0.25; return [B.spine, B.chest, 1 - t, t]; }
  return [B.hips, B.spine, 1, 0];
}

function bodyParts(L: Look): Part[] {
  const parts: Part[] = [];
  const P = (g: THREE.BufferGeometry, col: number, bone: Part['bone']) => parts.push({ g, col, bone });
  const V = (i: number) => new THREE.Vector3(...JOINT[i]);
  const bw = L.build;
  const long = L.garb === 'dress' || L.garb === 'robe' || L.garb === 'nobleGown';
  const female = L.garb === 'dress' || L.garb === 'nobleGown';
  // Head and face.
  P(ball(0.104, 0, 1.665, 0.012, 0.88, 1.08, 0.98, 12, 10), L.skin, B.head);
  P(boxAt(0.03, 0.05, 0.04, 0, 1.655, 0.112), L.skin, B.head);                       // nose
  for (const s of [-1, 1]) {
    P(ball(0.013, s * 0.036, 1.685, 0.094, 1, 0.8, 0.6, 6, 4), 0x141010, B.head);    // eyes
    P(ball(0.022, s * 0.093, 1.665, 0.0, 0.5, 1, 0.8, 6, 4), L.skin, B.head);         // ears
  }
  P(boxAt(0.05, 0.008, 0.01, 0, 1.612, 0.103), 0x6a3a32, B.head);                      // mouth
  // Hair, hood or coif.
  if (L.hairStyle === 'short' || L.hairStyle === 'tied' || L.hairStyle === 'long') {
    P(ball(0.112, 0, 1.69, -0.008, 0.9, 0.86, 0.98, 12, 8).translate(0, 0.0, 0), L.hair, B.head);
    if (L.hairStyle === 'long') P(boxAt(0.17, 0.24, 0.07, 0, 1.56, -0.075), L.hair, (p) => p.y > 1.5 ? [B.head, B.head, 1, 0] : [B.neck, B.chest, 0.5, 0.5]);
    if (L.hairStyle === 'tied') P(ball(0.045, 0, 1.64, -0.12), L.hair, B.head);
  } else if (L.hairStyle === 'coif') {
    P(ball(0.118, 0, 1.685, -0.006, 0.92, 0.9, 1.0, 12, 8), L.cloth2, B.head);
    P(tube(0.075, 0.09, new THREE.Vector3(0, 1.48, -0.01), new THREE.Vector3(0, 1.6, -0.02), 10), L.cloth2, (p) => p.y > 1.55 ? [B.head, B.head, 1, 0] : [B.neck, B.neck, 1, 0]);
  } else if (L.hairStyle === 'hood') {
    P(ball(0.125, 0, 1.69, -0.02, 0.95, 0.98, 1.05, 12, 8), L.cloak ?? L.cloth, B.head);
  }
  if (L.beard) P(ball(0.07, 0, 1.6, 0.06, 1.05, 0.9, 0.8, 8, 6), L.hair, B.head);
  if (L.patch) {
    P(ball(0.024, -0.036, 1.686, 0.1, 1.1, 1, 0.5, 8, 6), 0x0e0c0b, B.head);
    P(tube(0.107, 0.107, new THREE.Vector3(0, 1.7, 0.0), new THREE.Vector3(0, 1.708, 0.0), 14), 0x0e0c0b, B.head);
  }
  if (L.helmet) {
    P(ball(0.123, 0, 1.7, 0, 1, 0.75, 1.05, 12, 6), DYES.iron, B.head);
    P(tube(0.15, 0.15, new THREE.Vector3(0, 1.665, 0), new THREE.Vector3(0, 1.675, 0), 14), DYES.iron, B.head); // brim
  }
  // Neck.
  P(tube(0.048, 0.044, new THREE.Vector3(0, 1.46, 0), new THREE.Vector3(0, 1.6, 0.0), 8), L.skin, (p) => p.y > 1.55 ? [B.head, B.head, 1, 0] : [B.neck, B.neck, 1, 0]);
  // Torso: a body garment from hip to shoulder.
  const chestR = (female ? 0.165 : 0.175) * bw, waistR = (female ? 0.13 : 0.15) * bw, hipR = (female ? 0.17 : 0.155) * bw;
  P(lathe([[0.001, 0.86], [hipR, 0.88], [waistR, 1.04], [chestR, 1.24], [chestR * 1.02, 1.36], [0.16, 1.44], [0.07, 1.5], [0.001, 1.51]], 14, 0.7),
    L.garb === 'guard' ? DYES.charcoal : L.cloth, torsoWeights);
  if (L.garb === 'guard') {
    // Tabard in the house's red over a dark gambeson, and a belt.
    P(boxAt(0.3 * bw, 0.62, 0.03, 0, 1.12, 0.13 * bw), L.cloth, (p) => torsoWeights(p));
    P(boxAt(0.3 * bw, 0.62, 0.03, 0, 1.12, -0.13 * bw), L.cloth, (p) => torsoWeights(p));
  }
  P(tube(waistR * 1.02, waistR * 1.02, new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0, 1.0, 0), 14, 0.72), L.boots === DYES.black ? DYES.leather : DYES.darkLeather, B.hips); // belt
  // Skirts: tunic to mid-thigh, dress and robe to the ankle.
  if (long) {
    const hem = L.garb === 'nobleGown' ? 0.36 : 0.32;
    P(lathe([[waistR * 1.03, 1.0], [hipR * 1.15, 0.88], [hipR * 1.5, 0.5], [hem * bw, 0.06], [0.001, 0.06]], 16, 0.8), L.garb === 'robe' ? L.cloth : L.cloth, skirtWeights(0.35));
  } else {
    const len = L.garb === 'guard' ? 0.5 : L.garb === 'noble' ? 0.42 : 0.55;
    P(lathe([[waistR * 1.03, 1.0], [hipR * 1.12, 0.86], [hipR * 1.38, len], [0.001, len]], 14, 0.78), L.garb === 'guard' ? DYES.charcoal : L.cloth, skirtWeights(0.75));
  }
  if (L.apron != null) P(boxAt(0.3 * bw, long ? 0.75 : 0.55, 0.02, 0, long ? 0.38 : 0.55, 0.16 * bw).translate(0, 0, 0), L.apron, skirtWeights(0.5));
  if (L.cloak != null) {
    const g = lathe([[0.17, 1.47], [0.22 * bw, 1.36], [0.25 * bw, 0.9], [0.29 * bw, 0.35]], 12, 0.9);
    // Keep only the back half of the cloak.
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 0.02) pos.setZ(i, 0.02 + (pos.getZ(i) - 0.02) * 0.08);
    g.translate(0, 0, -0.03);
    P(g, L.cloak, cloakWeights);
  }
  // Arms: sleeves, then hands.
  for (const s of ['L', 'R'] as const) {
    const sh = V(B[`arm${s}`]), el = V(B[`fore${s}`]), wr = V(B[`hand${s}`]);
    const sleeve = L.garb === 'guard' ? DYES.charcoal : L.cloth;
    P(ball(0.068 * bw, sh.x, sh.y - 0.01, sh.z, 1, 1, 1, 8, 6), sleeve, B[`arm${s}`]);
    P(tube(0.058 * bw, 0.048 * bw, sh, el, 8), sleeve, B[`arm${s}`]);
    P(tube(0.047 * bw, 0.04 * bw, el, wr.clone().add(new THREE.Vector3(0, 0.03, 0)), 8), L.garb === 'smith' ? L.skin : sleeve, B[`fore${s}`]);
    const hand = boxAt(0.065, 0.15, 0.035, wr.x, wr.y - 0.07, wr.z + 0.01);
    P(hand, L.skin, B[`hand${s}`]);
  }
  // Legs: hose or trousers, then boots.
  for (const s of ['L', 'R'] as const) {
    const hp = V(B[`thigh${s}`]), kn = V(B[`shin${s}`]), an = V(B[`foot${s}`]);
    P(tube(0.08 * bw, 0.06, hp.clone().add(new THREE.Vector3(0, 0.04, 0)), kn, 8), L.legs, B[`thigh${s}`]);
    P(ball(0.058, kn.x, kn.y, kn.z, 1, 1, 1, 6, 5), L.legs, B[`shin${s}`]);
    P(tube(0.058, 0.044, kn, an.clone().add(new THREE.Vector3(0, 0.18, 0)), 8), L.legs, B[`shin${s}`]);
    P(tube(0.05, 0.055, an.clone().add(new THREE.Vector3(0, -0.02, 0)), an.clone().add(new THREE.Vector3(0, 0.2, 0)), 8), L.boots, B[`shin${s}`]);
    P(boxAt(0.095, 0.075, 0.25, an.x, 0.0375, an.z + 0.06), L.boots, B[`foot${s}`]);
  }
  return parts;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/** One merged, skinned geometry for a look (cached: people who look alike share it). */
export function bodyGeometry(L: Look): THREE.BufferGeometry {
  const key = JSON.stringify(L);
  const hit = geoCache.get(key);
  if (hit) return hit;
  const s = L.height / 1.75;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [];
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (const p of bodyParts(L)) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    g.computeVertexNormals();
    const pa = g.attributes.position as THREE.BufferAttribute, na = g.attributes.normal as THREE.BufferAttribute;
    c.set(p.col);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      const w = typeof p.bone === 'number' ? [p.bone, p.bone, 1, 0] : p.bone(v);
      pos.push(v.x * s, v.y * s, v.z * s);
      nor.push(na.getX(i), na.getY(i), na.getZ(i));
      col.push(c.r, c.g, c.b);
      si.push(w[0], w[1], 0, 0);
      sw.push(w[2], w[3], 0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.computeBoundingSphere();
  g.boundingSphere!.radius = 1.4 * s;
  geoCache.set(key, g);
  return g;
}

/** A fresh skeleton in the rest pose, scaled to the person's height. */
export function makeSkeleton(height: number) {
  const s = height / 1.75;
  const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  bones.forEach((b, i) => {
    const p = PARENT[i];
    const j = JOINT[i];
    if (p < 0) b.position.set(j[0] * s, j[1] * s, j[2] * s);
    else {
      const q = JOINT[p];
      b.position.set((j[0] - q[0]) * s, (j[1] - q[1]) * s, (j[2] - q[2]) * s);
      bones[p].add(b);
    }
  });
  return bones;
}

let sharedMat: THREE.Material | null = null;
export function bodyMaterial() {
  if (sharedMat) return sharedMat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82 });
  const n = mx_noise_float(positionWorld.mul(14.0)).mul(0.5).add(0.5);
  m.colorNode = attribute('color', 'vec3').mul(n.mul(0.12).add(0.92));
  m.roughnessNode = float(0.8);
  sharedMat = m;
  return m;
}

/** A skinned person ready to pose: mesh, bones by name. */
export function makePerson(L: Look) {
  const geo = bodyGeometry(L);
  const mesh = new THREE.SkinnedMesh(geo, bodyMaterial());
  const bones = makeSkeleton(L.height);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  return { mesh, bones };
}

/** A cheap unskinned copy of a look in the rest pose, for people far away. */
export function staticGeometry(L: Look) {
  const g = bodyGeometry(L).clone();
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  return g;
}
