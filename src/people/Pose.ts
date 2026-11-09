// Procedural animation for people: walking, standing, sitting, sleeping, talking and the
// work of each trade, written straight onto the skeleton's joints every frame.
//
// Joint conventions (rest pose has everything hanging straight, the body facing +z):
// a negative x rotation swings a thigh or arm forward; a positive x rotation bends a knee;
// a negative x rotation bends an elbow; +z lifts the left arm sideways, -z the right.
import type * as THREE from 'three/webgpu';

export type Mode = 'idle' | 'walk' | 'sit' | 'sleep' | 'work' | 'talk' | 'guard' | 'hearth';

export interface PoseState {
  mode: Mode;
  /** Walk cycle, 0..1 per two steps. */
  phase: number;
  speed: number;
  task?: string;
  /** Head turn toward something (radians, + to the person's left) and up/down. */
  lookYaw: number;
  lookPitch: number;
  /** Seconds, for breathing and work rhythms. */
  t: number;
  /** A per-person offset so a crowd doesn't move in step. */
  seed: number;
  /** 1.0 for a 1.75 m adult. */
  scale: number;
}

const TAU = Math.PI * 2;

export function applyPose(bones: THREE.Bone[], st: PoseState) {
  const [root, hips, spine, chest, neck, head, armL, foreL, handL, armR, foreR, handR, thighL, shinL, footL, thighR, shinR, footR] = bones;
  for (const b of bones) b.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  const s = st.scale;
  hips.position.set(0, 0.95 * s, 0);
  const t = st.t + st.seed * 10;
  const breathe = Math.sin(t * 1.6) * 0.025;
  // Default: arms hang a little out from the body, elbows soft.
  armL.rotation.z = 0.08; armR.rotation.z = -0.08;
  foreL.rotation.x = -0.15; foreR.rotation.x = -0.15;
  chest.rotation.x = breathe;

  switch (st.mode) {
    case 'walk': {
      const A = Math.min(1.35, st.speed / 1.35);
      const ph = st.phase * TAU;
      const sw = Math.sin(ph);
      thighL.rotation.x = -0.45 * A * sw;
      thighR.rotation.x = 0.45 * A * sw;
      // The knee bends as the leg swings through, and a little at heel strike.
      shinL.rotation.x = A * (0.12 + 0.7 * Math.max(0, Math.sin(ph + 0.9)));
      shinR.rotation.x = A * (0.12 + 0.7 * Math.max(0, Math.sin(ph + 0.9 + Math.PI)));
      footL.rotation.x = -thighL.rotation.x * 0.3 - shinL.rotation.x * 0.45;
      footR.rotation.x = -thighR.rotation.x * 0.3 - shinR.rotation.x * 0.45;
      armL.rotation.x = 0.36 * A * sw;
      armR.rotation.x = -0.36 * A * sw;
      foreL.rotation.x = -0.25 - 0.25 * A * Math.max(0, -sw);
      foreR.rotation.x = -0.25 - 0.25 * A * Math.max(0, sw);
      hips.position.y = (0.95 - 0.028 * A * Math.cos(ph * 2)) * s;
      hips.rotation.y = 0.09 * A * sw;
      chest.rotation.y = -0.12 * A * sw;
      spine.rotation.x = 0.04 * A;
      if (st.speed > 3) { spine.rotation.x = 0.16; foreL.rotation.x -= 0.6; foreR.rotation.x -= 0.6; }
      break;
    }
    case 'sit': case 'work': case 'talk': case 'idle': case 'guard': case 'hearth': {
      const seated = st.mode === 'sit' || (st.mode === 'work' && (st.task === 'write' || st.task === 'cipher' || st.task === 'weave'));
      if (seated) {
        hips.position.y = 0.5 * s;
        thighL.rotation.x = thighR.rotation.x = -1.5;
        shinL.rotation.x = shinR.rotation.x = 1.45;
        thighL.rotation.z = 0.06; thighR.rotation.z = -0.06;
        armL.rotation.x = armR.rotation.x = -0.35;
        foreL.rotation.x = foreR.rotation.x = -0.9;
        spine.rotation.x = 0.06;
      } else {
        // Standing: the weight shifts from foot to foot now and then.
        const shift = Math.sin(t * 0.37) * 0.035;
        hips.rotation.z = shift;
        thighL.rotation.z = -shift; thighR.rotation.z = -shift;
        shinL.rotation.x = 0.04 + Math.max(0, shift) * 2;
        shinR.rotation.x = 0.04 + Math.max(0, -shift) * 2;
        thighL.rotation.x = -shinL.rotation.x * 0.5;
        thighR.rotation.x = -shinR.rotation.x * 0.5;
      }
      if (st.mode === 'work') work(bones, st, t);
      else if (st.mode === 'talk') {
        const g = Math.max(0, Math.sin(t * 1.3 + st.seed * 5));
        armR.rotation.x = -0.35 - 0.55 * g; foreR.rotation.x = -0.6 - 0.5 * g;
        armR.rotation.z = -0.15;
        const g2 = Math.max(0, Math.sin(t * 0.9 + 2 + st.seed * 3));
        armL.rotation.x = -0.2 - 0.35 * g2; foreL.rotation.x = -0.5 - 0.4 * g2;
        head.rotation.x = Math.sin(t * 2.3) * 0.05;
      } else if (st.mode === 'guard') {
        // Spear upright in the right hand, left thumb in the belt.
        armR.rotation.x = -0.25; armR.rotation.z = -0.12; foreR.rotation.x = -1.25; handR.rotation.y = 0.2;
        armL.rotation.x = 0.05; armL.rotation.z = 0.25; foreL.rotation.x = -0.9;
        chest.rotation.x = -0.03 + breathe;
      } else if (st.mode === 'hearth') {
        armL.rotation.x = armR.rotation.x = -0.75; foreL.rotation.x = foreR.rotation.x = -0.75;
        armL.rotation.z = -0.15; armR.rotation.z = 0.15;
        handL.rotation.x = handR.rotation.x = -0.4;
      }
      break;
    }
    case 'sleep': {
      root.rotation.x = -Math.PI / 2;
      root.position.set(0, 0.13 * s, 0.86 * s);
      armL.rotation.z = 0.12; armR.rotation.z = -0.12;
      head.rotation.y = Math.sin(st.seed * 7) * 0.5;
      chest.rotation.x = breathe * 0.6;
      break;
    }
  }
  // Look toward something (added to whatever the pose is doing).
  if (st.mode !== 'sleep') {
    const ly = Math.max(-1.1, Math.min(1.1, st.lookYaw));
    neck.rotation.y += ly * 0.35;
    head.rotation.y += ly * 0.65;
    head.rotation.x += Math.max(-0.4, Math.min(0.4, st.lookPitch));
  }
}

function work(bones: THREE.Bone[], st: PoseState, t: number) {
  const [, , spine, chest, , head, armL, foreL, handL, armR, foreR, handR] = bones;
  const task = st.task ?? 'hammer';
  switch (task) {
    case 'hammer': {
      // Lift, then a quick fall onto the anvil; the left hand holds the work with tongs.
      const c = (t * 0.9) % 1;
      const lift = c < 0.7 ? c / 0.7 : 1 - (c - 0.7) / 0.3;
      const e = lift * lift * (3 - 2 * lift);
      armR.rotation.x = -0.5 - 1.6 * e; foreR.rotation.x = -0.6 - 0.9 * e; armR.rotation.z = -0.2;
      armL.rotation.x = -0.75; foreL.rotation.x = -0.7; armL.rotation.z = -0.1;
      spine.rotation.x = 0.18 - 0.08 * e; head.rotation.x = 0.35;
      break;
    }
    case 'bellows': case 'file': case 'knead': case 'bake': case 'dip': {
      const k = Math.sin(t * (task === 'file' ? 4 : task === 'knead' ? 2.2 : 1.6));
      armL.rotation.x = armR.rotation.x = -0.75 - 0.25 * k;
      foreL.rotation.x = foreR.rotation.x = -0.55 + 0.3 * k;
      armL.rotation.z = -0.12; armR.rotation.z = 0.12;
      spine.rotation.x = 0.2 + 0.06 * k; head.rotation.x = 0.3;
      break;
    }
    case 'chop': {
      const c = (t * 1.6) % 1, e = c < 0.6 ? c / 0.6 : 1 - (c - 0.6) / 0.4;
      armR.rotation.x = -0.6 - 0.9 * e; foreR.rotation.x = -0.5 - 0.6 * e;
      armL.rotation.x = -0.65; foreL.rotation.x = -0.75;
      spine.rotation.x = 0.2; head.rotation.x = 0.35;
      break;
    }
    case 'brush': {
      armR.rotation.x = -0.9 + 0.35 * Math.sin(t * 3); armR.rotation.z = -0.25 + 0.2 * Math.cos(t * 3);
      foreR.rotation.x = -0.6; armL.rotation.x = -0.4; foreL.rotation.x = -0.9;
      break;
    }
    case 'write': case 'cipher': {
      armR.rotation.x = -0.65; foreR.rotation.x = -1.0 + 0.06 * Math.sin(t * 6); handR.rotation.z = 0.1 * Math.sin(t * 5);
      armL.rotation.x = -0.5; foreL.rotation.x = -1.1;
      spine.rotation.x = 0.18; head.rotation.x = 0.45 + (task === 'cipher' ? 0.05 * Math.sin(t * 0.8) : 0);
      chest.rotation.y = 0.05 * Math.sin(t * 0.3);
      break;
    }
    case 'weave': {
      const k = Math.sin(t * 2.5);
      armL.rotation.x = armR.rotation.x = -0.8; foreL.rotation.x = foreR.rotation.x = -0.6;
      armL.rotation.z = -0.15 + 0.15 * k; armR.rotation.z = 0.15 + 0.15 * k;
      spine.rotation.x = 0.1;
      break;
    }
    case 'serve': {
      armL.rotation.x = armR.rotation.x = -0.55; foreL.rotation.x = foreR.rotation.x = -0.7;
      handL.rotation.x = handR.rotation.x = -0.3;
      head.rotation.x = Math.sin(t * 0.7) * 0.08;
      break;
    }
    case 'drill': {
      // Spear drill: step in and thrust, recover.
      const c = (t * 0.7) % 1, e = c < 0.25 ? c / 0.25 : c < 0.5 ? 1 : 1 - (c - 0.5) / 0.5;
      armR.rotation.x = -0.9 - 0.5 * e; foreR.rotation.x = -0.9 + 0.7 * e;
      armL.rotation.x = -1.1 - 0.3 * e; foreL.rotation.x = -0.4 + 0.2 * e;
      spine.rotation.x = 0.1 + 0.12 * e; chest.rotation.y = -0.25 * e;
      break;
    }
    case 'spar': {
      // Swinging a practice blade: overhead, cut, guard.
      const c = (t * 0.8) % 1;
      const k = Math.sin(c * Math.PI * 2);
      armR.rotation.x = -1.2 - 0.9 * Math.max(0, k); armR.rotation.z = -0.3 + 0.5 * Math.max(0, -k);
      foreR.rotation.x = -0.5 - 0.4 * Math.max(0, k);
      armL.rotation.x = -0.6; foreL.rotation.x = -1.0;
      chest.rotation.y = 0.35 * k; spine.rotation.x = 0.1;
      break;
    }
    case 'sweep': {
      const k = Math.sin(t * 2.2);
      armL.rotation.x = -0.5; armR.rotation.x = -0.35; foreL.rotation.x = -0.4; foreR.rotation.x = -0.6;
      chest.rotation.y = 0.3 * k; spine.rotation.x = 0.25;
      break;
    }
  }
}
