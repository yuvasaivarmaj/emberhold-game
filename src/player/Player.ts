// First-person player: capsule character controller, walking/sprinting/crouching,
// jumping, wading and swimming, plus camera feel (head bob, sway, landing dip, FOV kick).
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Physics } from '../physics/Physics';
import { Input } from '../core/Input';
import { Heightfield } from '../world/Heightfield';
import { WATER_LEVEL, WORLD_HALF } from '../world/WorldConfig';
import { verticalFov, type UserSettings } from '../core/Settings';

export type Surface = 'grass' | 'rock' | 'mud' | 'water';

export interface PlayerEvents {
  footstep: { surface: Surface; intensity: number } | null;
  landed: number; // impact speed, 0 if none
}

const RADIUS = 0.32;
const HALF = 0.58;
const STAND_EYE = 1.64;
const CROUCH_EYE = 1.02;
const GRAVITY = 13.5;

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly feet = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private vel = new THREE.Vector3();
  grounded = false;
  private eye = STAND_EYE;
  bobPhase = 0;
  bobAmp = 0;
  sprinting = false;
  crouching = false;
  private lastStep = 0;
  landDip = 0;
  private landVel = 0;
  private roll = 0;
  private fovKick = 0;
  private airTime = 0;
  private peakFall = 0;
  swimming = false;
  speed = 0;
  surface: Surface = 'grass';

  constructor(private physics: Physics, private hf: Heightfield, start: { x: number; z: number; yaw: number }, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.fovKick = camera.fov;
    const y = hf.height(start.x, start.z) + 0.05;
    this.feet.set(start.x, y, start.z);
    this.yaw = start.yaw;
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, y + RADIUS + HALF, start.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setFriction(0), this.body);
    this.controller = w.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.45, 0.25, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch = 0) {
    this.feet.set(x, y, z);
    this.yaw = yaw; this.pitch = pitch;
    this.body.setTranslation({ x, y: y + RADIUS + HALF, z }, true);
    this.vel.set(0, 0, 0);
  }

  update(dt: number, input: Input, s: UserSettings): PlayerEvents {
    const events: PlayerEvents = { footstep: null, landed: 0 };

    // Look
    const sens = 0.0021 * s.sensitivity;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch));

    // Wish direction
    const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const r = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const crouch = input.down('KeyC') || input.down('ControlLeft');
    const sprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && f > 0 && !crouch;
    this.sprinting = sprint;
    this.crouching = crouch;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * r;
    let wz = -cos * f - sin * r;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    // Water
    const ground = this.hf.height(this.feet.x, this.feet.z);
    const depth = WATER_LEVEL - this.feet.y;
    this.swimming = WATER_LEVEL - ground > 1.25 && depth > 1.1;
    let speed = crouch ? 1.35 : sprint ? 6.1 : 2.75;
    if (depth > 0) speed *= THREE.MathUtils.lerp(1, 0.5, Math.min(1, depth / 1.1));
    if (this.swimming) speed = sprint ? 2.2 : 1.5;

    const accel = this.grounded || this.swimming ? 11 : 1.8;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    if (this.swimming) {
      const target = WATER_LEVEL - 1.32;
      this.vel.y += ((target - this.feet.y) * 4 - this.vel.y) * (1 - Math.exp(-6 * dt));
    } else {
      if (this.grounded && input.hit('Space') && !crouch) {
        this.vel.y = 4.7;
        this.grounded = false;
      }
      this.vel.y -= GRAVITY * dt;
      if (this.grounded && this.vel.y < -1.0) this.vel.y = -1.0;
    }

    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    let nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    const lim = WORLD_HALF - 8;
    nx = Math.max(-lim, Math.min(lim, nx));
    nz = Math.max(-lim, Math.min(lim, nz));
    // Safety net: never fall through the terrain.
    const gh = this.hf.height(nx, nz);
    if (ny - RADIUS - HALF < gh - 0.6) ny = gh + RADIUS + HALF;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

    // Real velocity (for bob + footsteps), and collisions with ceilings/walls.
    const actualH = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);
    if (mv.y > desired.y + 1e-4 && this.vel.y < 0) this.vel.y = Math.max(this.vel.y, mv.y / Math.max(dt, 1e-4));
    if (this.vel.y > 0 && mv.y < desired.y - 1e-4) this.vel.y = 0;
    this.speed = actualH;
    this.feet.set(nx, ny - RADIUS - HALF, nz);

    // Landing
    if (!this.grounded && !this.swimming) {
      this.airTime += dt;
      this.peakFall = Math.min(this.peakFall, this.vel.y);
    } else {
      if (!wasGrounded && this.airTime > 0.15) {
        const impact = -this.peakFall;
        if (impact > 2.5) {
          events.landed = impact;
          this.landVel -= Math.min(2.2, impact * 0.18);
        }
      }
      this.airTime = 0;
      this.peakFall = 0;
    }

    // Surface under the feet
    const n = this.hf.normal(this.feet.x, this.feet.z);
    if (this.feet.y < WATER_LEVEL + 0.04) this.surface = 'water';
    else if (this.feet.y > gh + 0.25 || n.y < 0.78) this.surface = 'rock';
    else if (gh < WATER_LEVEL + 1.8) this.surface = 'mud';
    else this.surface = 'grass';

    // Head bob and footsteps
    const moving = (this.grounded || this.swimming) && actualH > 0.4;
    const stride = sprint ? 1.05 : crouch ? 0.55 : 0.78;
    if (moving) this.bobPhase += (actualH / stride) * Math.PI * dt;
    const targetAmp = moving ? (sprint ? 0.055 : crouch ? 0.018 : 0.032) : 0;
    this.bobAmp += (targetAmp - this.bobAmp) * (1 - Math.exp(-8 * dt));
    const stepIndex = Math.floor(this.bobPhase / Math.PI);
    if (moving && stepIndex !== this.lastStep && !this.swimming) {
      events.footstep = { surface: this.surface, intensity: sprint ? 1 : crouch ? 0.35 : 0.65 };
    }
    if (moving && this.swimming && stepIndex !== this.lastStep && stepIndex % 2 === 0) {
      events.footstep = { surface: 'water', intensity: 0.8 };
    }
    this.lastStep = stepIndex;

    // Landing dip as a damped spring
    this.landVel += (-this.landDip * 60 - this.landVel * 10) * dt;
    this.landDip += this.landVel * dt;

    // Camera
    const eyeTarget = this.swimming ? 1.62 : crouch ? CROUCH_EYE : STAND_EYE;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-10 * dt));
    const bobOn = s.headBob ? 1 : 0.25;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * this.bobAmp * 1.6 * bobOn - this.bobAmp * 0.8 * bobOn;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.6 * bobOn;
    const time = performance.now() / 1000;
    const breathe = Math.sin(time * 1.6) * 0.004;
    const swimBob = this.swimming ? Math.sin(time * 1.3) * 0.05 : 0;

    const cam = this.camera;
    const right = new THREE.Vector3(cos, 0, -sin);
    cam.position.set(this.feet.x, this.feet.y + this.eye + bobY + breathe + this.landDip + swimBob, this.feet.z).addScaledVector(right, bobX);
    this.roll += (-r * 0.012 * (this.grounded ? 1 : 0.4) - this.roll) * (1 - Math.exp(-6 * dt));
    cam.rotation.set(this.pitch + Math.sin(this.bobPhase * 2) * this.bobAmp * 0.06 * bobOn, this.yaw, this.roll, 'YXZ');

    const fovTarget = verticalFov(s.fov + (sprint && actualH > 4 ? 6 : 0), cam.aspect);
    this.fovKick += (fovTarget - this.fovKick) * (1 - Math.exp(-5 * dt));
    if (Math.abs(cam.fov - this.fovKick) > 0.01) { cam.fov = this.fovKick; cam.updateProjectionMatrix(); }
    return events;
  }
}
