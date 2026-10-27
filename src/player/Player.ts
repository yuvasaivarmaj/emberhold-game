// First-person player: capsule character controller, walking/sprinting/crouching,
// jumping, wading and swimming, plus camera feel (head bob, sway, landing dip, FOV kick).
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Physics } from '../physics/Physics';
import { Input } from '../core/Input';
import { Heightfield } from '../world/Heightfield';
import { WATER_LEVEL, WORLD_HALF, roadAt, settlementAt, EMBERHOLD, QUILLHAVEN } from '../world/WorldConfig';
import { fortShape } from '../world/Layout';

/** What the ground is like inside Emberhold and Quillhaven (matches the terrain shading). */
function fortGround(x: number, z: number): 'flags' | 'lawn' | 'earth' {
  const dx = x - EMBERHOLD.x, dz = z - EMBERHOLD.z;
  const r = Math.hypot(dx, dz) / fortShape(Math.atan2(dz, dx));
  if (r < EMBERHOLD.keepR) return r < 76 || r > EMBERHOLD.keepR - 37 ? 'flags' : 'lawn';
  if (r < EMBERHOLD.middleR + 20) return 'lawn';
  if (r < EMBERHOLD.outerR + 10) return 'earth';
  return Math.hypot(x - QUILLHAVEN.x, z - QUILLHAVEN.z) < QUILLHAVEN.r ? 'lawn' : 'earth';
}
import { verticalFov, type UserSettings } from '../core/Settings';

export type Surface = 'grass' | 'rock' | 'mud' | 'water' | 'gravel' | 'stone' | 'wood';

export interface PlayerEvents {
  footstep: { surface: Surface; intensity: number } | null;
  landed: number; // impact speed, 0 if none
}

const RADIUS = 0.32;
const HALF = 0.58;
const STAND_EYE = 1.64;
const CROUCH_EYE = 1.02;
const GRAVITY = 11.2;
const WALK = 1.8, RUN = 5.6, CROUCH = 1.1, JUMP_V = 3.8;

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
  private jumped = false;
  /** Mantling over a ledge: where from, where to, and how far through. */
  private climb: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; rise: number } | null = null;
  /** 0..1 while the arms reach up and pull (for the hands). */
  climbReach = 0;
  get climbing() { return this.climb !== null; }
  private jumpTilt = 0;
  swimming = false;
  /** Breaststroke cycle, 0..1 per stroke. */
  swimPhase = 0;
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

  /** Turn the walking body's collider off while riding (the horse has its own). */
  setActive(on: boolean) { this.collider.setEnabled(on); }

  /** Look around from the saddle: the horse carries the eye, the mouse turns the head. */
  rideLook(dt: number, input: Input, s: UserSettings, eye: THREE.Vector3, turn: number, speed: number, ground: number) {
    const sens = 0.0021 * s.sensitivity;
    this.yaw += turn - input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch));
    this.feet.set(eye.x, ground, eye.z);
    this.speed = 0; this.grounded = true; this.swimming = false; this.sprinting = false; this.crouching = false;
    const cam = this.camera;
    cam.position.copy(eye);
    this.roll += (-turn / Math.max(dt, 1e-3) * 0.01 - this.roll) * (1 - Math.exp(-4 * dt));
    cam.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    const fovTarget = verticalFov(s.fov + (speed > 9 ? 8 : speed > 6 ? 4 : 0), cam.aspect);
    this.fovKick += (fovTarget - this.fovKick) * (1 - Math.exp(-4 * dt));
    if (Math.abs(cam.fov - this.fovKick) > 0.01) { cam.fov = this.fovKick; cam.updateProjectionMatrix(); }
  }

  /**
   * Look for a ledge just ahead: something solid in front at waist or chest height,
   * with a top no higher than we can reach and room to stand on it.
   */
  private tryMantle(maxH: number) {
    const w = this.physics.world;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const f = this.feet;
    let hitD = Infinity;
    for (const hgt of [0.55, 1.0, 1.5]) {
      const ray = new RAPIER.Ray({ x: f.x, y: f.y + hgt, z: f.z }, { x: fwd.x, y: 0, z: fwd.z });
      const hit = w.castRay(ray, 1.0, true, undefined, undefined, this.collider);
      if (hit) hitD = Math.min(hitD, hit.timeOfImpact);
    }
    if (!isFinite(hitD)) return false;
    // Find the top surface just beyond the face.
    const px = f.x + fwd.x * (hitD + 0.3), pz = f.z + fwd.z * (hitD + 0.3);
    const down = new RAPIER.Ray({ x: px, y: f.y + maxH + 0.6, z: pz }, { x: 0, y: -1, z: 0 });
    const top = w.castRayAndGetNormal(down, maxH + 0.6, true, undefined, undefined, this.collider);
    if (!top || top.normal.y < 0.7) return false;
    const topY = f.y + maxH + 0.6 - top.timeOfImpact;
    const h = topY - f.y;
    if (h < 0.5 || h > maxH) return false;
    // Room to stand up there?
    const tx = f.x + fwd.x * (hitD + 0.45), tz = f.z + fwd.z * (hitD + 0.45);
    const clear = w.intersectionWithShape({ x: tx, y: topY + RADIUS + HALF + 0.08, z: tz }, { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(HALF, RADIUS * 0.95), undefined, undefined, this.collider);
    if (clear) return false;
    this.climb = { from: f.clone(), to: new THREE.Vector3(tx, topY + 0.02, tz), t: 0, dur: 0.42 + h * 0.22, rise: h };
    this.vel.set(0, 0, 0);
    return true;
  }

  /** Pull up and over: rise close to the face, then roll forward onto the top. */
  private climbStep(dt: number, s: UserSettings, events: PlayerEvents): PlayerEvents {
    const c = this.climb!;
    c.t = Math.min(1, c.t + dt / c.dur);
    const up = Math.min(1, c.t / 0.65), over = Math.max(0, (c.t - 0.55) / 0.45);
    const eu = 1 - Math.pow(1 - up, 2.2), eo = over * over * (3 - 2 * over);
    const x = c.from.x + (c.to.x - c.from.x) * eo, z = c.from.z + (c.to.z - c.from.z) * eo;
    const y = c.from.y + (c.to.y - c.from.y) * eu;
    this.feet.set(x, y, z);
    this.body.setNextKinematicTranslation({ x, y: y + RADIUS + HALF, z });
    this.climbReach = Math.sin(Math.min(1, c.t * 1.3) * Math.PI) ** 0.6;
    this.grounded = false; this.speed = 0; this.airTime = 0; this.peakFall = 0;
    // The view dips as you haul yourself up, then levels out.
    const cam = this.camera;
    const strain = Math.sin(c.t * Math.PI);
    cam.position.set(x, y + this.eye - strain * 0.18, z);
    cam.rotation.set(this.pitch - strain * 0.12, this.yaw, Math.sin(c.t * Math.PI * 2) * 0.02, 'YXZ');
    if (c.t >= 1) {
      this.climb = null;
      this.climbReach = 0;
      this.grounded = true;
      events.footstep = { surface: this.surface, intensity: 0.8 };
      this.landVel -= 0.4;
    }
    void s;
    return events;
  }

  update(dt: number, input: Input, s: UserSettings): PlayerEvents {
    const events: PlayerEvents = { footstep: null, landed: 0 };
    if (this.climb) {
      const sens = 0.0021 * s.sensitivity;
      this.yaw -= input.mouseDX * sens * 0.4;
      return this.climbStep(dt, s, events);
    }

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
    let speed = crouch ? CROUCH : sprint ? RUN : WALK;
    if (depth > 0) speed *= THREE.MathUtils.lerp(1, 0.45, Math.min(1, depth / 1.1));
    if (this.swimming) {
      // Each stroke drives you forward on the pull, then you glide and slow.
      const rate = wl > 0 ? (sprint ? 0.75 : 0.55) : 0.3;
      this.swimPhase = (this.swimPhase + rate * dt) % 1;
      const surge = 0.55 + 0.9 * Math.max(0, Math.sin((this.swimPhase - 0.25) * Math.PI * 2));
      speed = (sprint ? 1.7 : 1.15) * surge;
    }

    // A body has weight: it takes a moment to get going and to stop.
    const cur = Math.hypot(this.vel.x, this.vel.z);
    const want = wl > 0 ? speed : 0;
    const accel = !(this.grounded || this.swimming) ? 1.2 : want > cur ? (sprint ? 3.2 : 5.5) : 7.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    if (this.swimming) {
      const target = WATER_LEVEL - 1.32;
      this.vel.y += ((target - this.feet.y) * 4 - this.vel.y) * (1 - Math.exp(-6 * dt));
    } else {
      // Space at a ledge climbs it; in mid-air, holding Space grabs a ledge within reach.
      const wantsClimb = (this.grounded && input.hit('Space')) || (!this.grounded && input.down('Space') && this.airTime > 0.05);
      if (wantsClimb && !crouch && this.tryMantle(this.grounded ? 2.4 : 2.2)) return this.climbStep(dt, s, events);
      if (this.grounded && input.hit('Space') && !crouch) {
        this.vel.y = JUMP_V + Math.min(0.5, Math.hypot(this.vel.x, this.vel.z) * 0.08);
        this.jumped = true;
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
    const fx = this.feet.x, fz = this.feet.z;
    const onBuilt = this.feet.y > gh + 0.25; // standing on a wall, a step, a bridge or a rock
    if (this.feet.y < WATER_LEVEL + 0.04) this.surface = 'water';
    else if (onBuilt) this.surface = settlementAt(fx, fz) > 0.3 || roadAt(fx, fz) > 0.3 ? 'stone' : 'rock';
    else if (roadAt(fx, fz) > 0.45) this.surface = settlementAt(fx, fz) > 0.5 && fortGround(fx, fz) === 'flags' ? 'stone' : 'gravel';
    else if (settlementAt(fx, fz) > 0.5) this.surface = fortGround(fx, fz) === 'flags' ? 'stone' : fortGround(fx, fz) === 'lawn' ? 'grass' : 'gravel';
    else if (n.y < 0.78) this.surface = 'rock';
    else if (gh < WATER_LEVEL + 1.8) this.surface = 'mud';
    else this.surface = 'grass';

    // Head bob and footsteps
    const moving = (this.grounded || this.swimming) && actualH > 0.3;
    // Step length grows with speed: ~0.75 m strolling, ~1.6 m running.
    const stride = crouch ? 0.5 : THREE.MathUtils.clamp(0.55 + actualH * 0.19, 0.7, 1.7);
    if (moving && !this.swimming) this.bobPhase += (actualH / stride) * Math.PI * dt;
    const targetAmp = moving && !this.swimming ? THREE.MathUtils.clamp(0.012 + actualH * 0.0055, 0.014, 0.042) * (crouch ? 0.6 : 1) : 0;
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
    // The head is lowest as each foot strikes and highest mid-stride; it sways toward the
    // standing leg once per two steps.
    const bobY = -Math.cos(this.bobPhase * 2) * this.bobAmp * bobOn;
    const bobX = Math.sin(this.bobPhase) * this.bobAmp * 0.55 * bobOn;
    const time = performance.now() / 1000;
    const breathe = Math.sin(time * 1.5) * 0.004;
    // Swimming: the head lifts to breathe as the arms pull, and sinks on the glide.
    const swimBob = this.swimming ? Math.sin((this.swimPhase - 0.3) * Math.PI * 2) * 0.06 : 0;

    const cam = this.camera;
    const right = new THREE.Vector3(cos, 0, -sin);
    cam.position.set(this.feet.x, this.feet.y + this.eye + bobY + breathe + this.landDip + swimBob, this.feet.z).addScaledVector(right, bobX);
    this.roll += (-r * 0.012 * (this.grounded ? 1 : 0.4) - this.roll) * (1 - Math.exp(-6 * dt));
    // Jump: a quick upward tilt on take-off; landing pitches the view down with the dip.
    this.jumpTilt += ((this.jumped ? 0.03 : 0) - this.jumpTilt) * (1 - Math.exp(-6 * dt));
    if (this.grounded) this.jumped = false;
    const nod = -Math.cos(this.bobPhase * 2) * this.bobAmp * 0.35 * bobOn;
    const sway = Math.sin(this.bobPhase) * this.bobAmp * 0.25 * bobOn;
    cam.rotation.set(this.pitch + nod + this.jumpTilt + this.landDip * 0.25, this.yaw, this.roll + sway, 'YXZ');

    const fovTarget = verticalFov(s.fov + (sprint && actualH > 4 ? 4 : 0), cam.aspect);
    this.fovKick += (fovTarget - this.fovKick) * (1 - Math.exp(-5 * dt));
    if (Math.abs(cam.fov - this.fovKick) > 0.01) { cam.fov = this.fovKick; cam.updateProjectionMatrix(); }
    return events;
  }
}
