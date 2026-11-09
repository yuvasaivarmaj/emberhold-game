// Real doors for every hollow building: one instanced mesh for all of them, hinged on the
// left of the doorway and swinging inward. Doors near the player get a physics collider
// that follows the leaf. People (and the player) open them; they swing shut on their own.
import * as THREE from 'three/webgpu';
import { float, mix, smoothstep, fract, positionLocal, color, abs, step, hash, uint, floor } from 'three/tsl';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Physics } from '../physics/Physics';
import { type Building, localToWorld } from './Buildings';

const LEAF_W = 1.24, LEAF_H = 2.2, LEAF_T = 0.08;
const OPEN = Math.PI * 0.5 * 0.92;

export interface Door {
  b: Building;
  /** Hinge on the floor, world space. */
  hx: number; hy: number; hz: number;
  /** 0 = shut, 1 = wide open. */
  open: number;
  target: number;
  /** Seconds until it swings shut by itself (if nobody holds it). */
  hold: number;
  locked: boolean;
  collider: RAPIER.Collider | null;
  dirty: boolean;
}

export class Doors {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Door[] = [];
  private byBuilding = new Map<number, Door>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private onSwing: ((d: Door, opening: boolean) => void) | null = null;

  constructor(buildings: Building[], private physics: Physics) {
    for (const b of buildings) {
      if (!b.hollow) continue;
      const fv = b.d / 2 - b.wall / 2;
      const [hx, hz] = localToWorld(b, b.door.u - b.door.w / 2 + 0.03, fv);
      const d: Door = { b, hx, hy: b.fy + 0.04, hz, open: 0, target: 0, hold: 0, locked: false, collider: null, dirty: true };
      this.list.push(d);
      this.byBuilding.set(b.id, d);
    }
    this.mesh = new THREE.InstancedMesh(leafGeometry(), doorMaterial(), this.list.length);
    this.mesh.name = 'Doors';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.list.length; i++) this.place(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Called whenever a door starts to open or close (for the creak). */
  set swingSound(fn: (d: Door, opening: boolean) => void) { this.onSwing = fn; }

  of(b: Building) { return this.byBuilding.get(b.id) ?? null; }

  private yaw(d: Door) { return d.b.rot + d.open * OPEN; }

  private place(i: number) {
    const d = this.list[i];
    this.q.setFromAxisAngle(this.up, this.yaw(d));
    this.m.compose(this.v.set(d.hx, d.hy, d.hz), this.q, this.one);
    this.mesh.setMatrixAt(i, this.m);
    d.dirty = false;
  }

  /** Swing a door open (and keep it open for `hold` seconds). */
  openDoor(d: Door, hold = 5) {
    if (d.target < 1 && this.onSwing) this.onSwing(d, true);
    d.target = 1;
    d.hold = Math.max(d.hold, hold);
  }

  closeDoor(d: Door) {
    if (d.target > 0 && this.onSwing) this.onSwing(d, false);
    d.target = 0;
    d.hold = 0;
  }

  /** The door the player is looking at, within reach. */
  inReach(eye: THREE.Vector3, look: THREE.Vector3, reach = 2.4): Door | null {
    let best: Door | null = null, bestScore = -Infinity;
    for (const d of this.list) {
      const cx = d.b.door.x, cz = d.b.door.z;
      const dx = cx - eye.x, dz = cz - eye.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + 0.8 || Math.abs(eye.y - 1.4 - d.hy) > 1.6) continue;
      const facing = (dx * look.x + dz * look.z) / Math.max(dist, 0.3);
      if (facing < 0.35 && dist > 0.9) continue;
      const score = facing * 2 - dist;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  update(dt: number, player: THREE.Vector3) {
    let changed = false;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      if (d.hold > 0) {
        d.hold -= dt;
        if (d.hold <= 0 && d.target > 0) this.closeDoor(d);
      }
      if (d.open !== d.target) {
        const speed = d.target > d.open ? 1.6 : 1.1;
        d.open = d.target > d.open ? Math.min(d.target, d.open + dt * speed) : Math.max(d.target, d.open - dt * speed);
        d.dirty = true;
      }
      const moved = d.dirty;
      if (moved) { this.place(i); changed = true; }
      // Colliders only for doors near the player.
      const near = Math.abs(d.hx - player.x) < 24 && Math.abs(d.hz - player.z) < 24;
      if (near && !d.collider) {
        d.collider = this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(LEAF_W / 2, LEAF_H / 2, LEAF_T / 2));
        this.poseCollider(d);
      } else if (!near && d.collider) {
        this.physics.world.removeCollider(d.collider, false);
        d.collider = null;
      } else if (d.collider && moved) this.poseCollider(d);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private poseCollider(d: Door) {
    if (!d.collider) return;
    const a = this.yaw(d);
    // Leaf centre: half a leaf along the leaf's own x from the hinge.
    const cx = d.hx + Math.cos(a) * LEAF_W / 2, cz = d.hz - Math.sin(a) * LEAF_W / 2;
    this.q.setFromAxisAngle(this.up, a);
    d.collider.setTranslation({ x: cx, y: d.hy + LEAF_H / 2, z: cz });
    d.collider.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
  }

  /** For saving: which doors stand open. */
  openIds() { return this.list.filter((d) => d.target > 0).map((d) => d.b.id); }
}

/** A plank door with three iron straps and a pull, hinged at x = 0 (kept light: 728 of them). */
function leafGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const leaf = new THREE.BoxGeometry(LEAF_W, LEAF_H, LEAF_T);
  leaf.translate(LEAF_W / 2, LEAF_H / 2, 0);
  parts.push(leaf);
  for (const y of [0.32, 1.1, 1.88]) {
    const strap = new THREE.BoxGeometry(LEAF_W * 0.86, 0.07, LEAF_T + 0.024);
    strap.translate(LEAF_W * 0.43, y, 0);
    parts.push(strap);
  }
  const pull = new THREE.BoxGeometry(0.05, 0.16, LEAF_T + 0.07);
  pull.translate(LEAF_W - 0.18, 1.0, 0);
  parts.push(pull);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  g.computeBoundingSphere();
  return g;
}

function doorMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.72 });
  const p = positionLocal;
  // Vertical planks in local space (so the grain turns with the door), straps in iron.
  const plank = floor(p.x.div(0.155));
  const seam = smoothstep(0.0, 0.06, fract(p.x.div(0.155))).mul(smoothstep(1.0, 0.94, fract(p.x.div(0.155))));
  const tone = hash(uint(plank.add(77.0)));
  const wood = mix(color(0x2a1c13), color(0x4a3323), tone).mul(seam.mul(0.35).add(0.65));
  const iron = step(abs(p.z), float(LEAF_T / 2 + 0.005)).oneMinus();
  m.colorNode = mix(wood, color(0x222224), iron);
  m.metalnessNode = iron.mul(0.7);
  m.roughnessNode = mix(float(0.78), float(0.45), iron);
  return m;
}
