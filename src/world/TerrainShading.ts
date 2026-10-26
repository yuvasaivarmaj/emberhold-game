// Procedural terrain shading in TSL, shared by the terrain and the grass so their
// colours and coverage always agree.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, color, mix, smoothstep, clamp, max,
  positionWorld, normalWorld, normalView, positionView, cameraPosition,
  mx_noise_float, mx_fractal_noise_float,
} from 'three/tsl';
import { WATER_LEVEL } from './WorldConfig';

// Palette (sRGB hex; three converts to linear).
export const PAL = {
  grassLush: color(0x52652d),
  grassDry: color(0x8a844a),
  grassDeep: color(0x2c3a19),
  soil: color(0x5f4b36),
  soilDark: color(0x3c3025),
  rock: color(0x7c776e),
  rockWarm: color(0x8d7d68),
  rockDark: color(0x4a4742),
  mud: color(0x3d352b),
  pebble: color(0x857a68),
  snow: color(0xe6ebef),
};

const W = float(WATER_LEVEL);

/** 0..1 large-scale variation used for dry vs lush meadows. */
export const macroNoise = Fn(([xz]: any) => mx_fractal_noise_float(xz.mul(0.0035), 3, 2.0, 0.5).mul(0.5).add(0.5));

/** 0..1 medium-scale variation (clumps, patches). */
export const mesoNoise = Fn(([xz]: any) => mx_noise_float(xz.mul(0.045)).mul(0.5).add(0.5));

/** 1 where bare soil patches break up the meadow. */
export const dirtMask = Fn(([xz]: any) =>
  smoothstep(0.62, 0.78, mx_fractal_noise_float(xz.mul(0.016).add(vec2(13.7, -4.1)), 3, 2.0, 0.5).mul(0.5).add(0.5)));

/** Weight of exposed rock from the surface slope (normal.y). */
export const rockWeight = Fn(([slopeY, jitter]: any) => smoothstep(0.86, 0.72, slopeY.add(jitter.mul(0.04))));

/** Weight of the muddy/pebbly river bank. */
export const bankWeight = Fn(([h, jitter]: any) => float(1).sub(smoothstep(W.add(0.25), W.add(1.25), h.add(jitter.mul(0.3)))));

/** How much grass grows here (0..1). Used to place grass blades. */
export const grassCoverage = Fn(([xz, slopeY, h]: any) => {
  const j = mx_noise_float(xz.mul(0.9));
  const rockW = rockWeight(slopeY, j);
  const bankW = bankWeight(h, j);
  const dirt = dirtMask(xz);
  const high = smoothstep(150.0, 120.0, h);
  return float(1).sub(rockW).mul(float(1).sub(bankW)).mul(float(1).sub(dirt.mul(0.95))).mul(high);
});

/** Meadow colour at a point, matching the grass blades. */
export const meadowColor = Fn(([xz]: any) => {
  const macro = macroNoise(xz);
  const meso = mesoNoise(xz);
  const c = mix(PAL.grassLush, PAL.grassDry, smoothstep(0.42, 0.85, macro));
  return c.mul(meso.mul(0.3).add(0.82));
});

// Bump mapping from a procedural height (Mikkelsen, surface gradient), in view space.
export const bumpFromHeight = Fn(([hgt]: any) => {
  const dHdx = hgt.dFdx();
  const dHdy = hgt.dFdy();
  const sigX = positionView.dFdx();
  const sigY = positionView.dFdy();
  const N = normalView;
  const R1 = sigY.cross(N);
  const R2 = N.cross(sigX);
  const det = sigX.dot(R1);
  const grad = det.sign().mul(dHdx.mul(R1).add(dHdy.mul(R2)));
  return det.abs().mul(N).sub(grad).normalize();
});

export function createTerrainMaterial(): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const xz = p.xz;
  const n = normalWorld;
  const camDist = cameraPosition.distance(p);
  const near = float(1).sub(smoothstep(25.0, 140.0, camDist));

  const macro = macroNoise(xz);
  const meso = mesoNoise(xz);
  const micro = mx_noise_float(xz.mul(0.9));
  const fine = mx_noise_float(xz.mul(4.3));

  // Up close you see soil between the blades; from afar you only see blade tips.
  const meadow = meadowColor(xz);
  const underGrass = mix(mix(meadow, PAL.grassDeep, 0.5), meadow.mul(0.92), smoothstep(6.0, 40.0, camDist));

  const dirt = dirtMask(xz);
  const soilCol = mix(PAL.soil, PAL.soilDark, meso).mul(fine.mul(0.08).add(1.0));

  const rockN = mx_fractal_noise_float(p.mul(vec3(0.11, 0.42, 0.11)), 4, 2.1, 0.55);
  const strata = mx_noise_float(vec3(p.y.mul(0.9), p.x.mul(0.02), p.z.mul(0.02))).mul(0.5).add(0.5);
  const rockCol = mix(mix(PAL.rockDark, PAL.rock, rockN.mul(0.5).add(0.5)), PAL.rockWarm, smoothstep(0.3, 0.8, strata).mul(0.5));
  const rockW = rockWeight(n.y, micro);

  const bankW = bankWeight(p.y, micro);
  const bankCol = mix(PAL.mud, PAL.pebble, smoothstep(W.sub(0.2), W.add(1.6), p.y).mul(fine.mul(0.3).add(0.7)));

  const snowW = smoothstep(205.0, 228.0, p.y.add(meso.mul(18.0))).mul(smoothstep(0.62, 0.8, n.y));

  let albedo: any = underGrass;
  albedo = mix(albedo, soilCol, dirt.mul(float(1).sub(rockW)));
  albedo = mix(albedo, bankCol, bankW.mul(float(1).sub(rockW)));
  albedo = mix(albedo, rockCol, rockW);
  albedo = mix(albedo, PAL.snow, snowW);
  // Subtle far-distance variation so hills don't look flat.
  albedo = albedo.mul(macro.mul(0.18).add(0.91));

  const wet = float(1).sub(smoothstep(W.sub(0.1), W.add(1.0), p.y));
  let rough: any = mix(float(0.93), float(0.82), rockW);
  rough = mix(rough, float(0.32), wet.mul(float(1).sub(rockW)));
  rough = mix(rough, float(0.55), snowW);

  // Procedural relief: cracks and lumps in rock, clods in soil, faint ripple in grass.
  const rockRelief = rockN.mul(0.35).add(mx_noise_float(p.mul(1.7)).mul(0.06));
  const groundRelief = micro.mul(0.02).add(fine.mul(0.012)).add(mx_noise_float(xz.mul(11.0)).mul(0.005));
  const relief = mix(groundRelief, rockRelief, rockW).mul(near);

  mat.colorNode = clamp(albedo, 0.0, 1.0);
  mat.roughnessNode = rough;
  mat.metalnessNode = float(0);
  mat.normalNode = bumpFromHeight(relief);
  return mat;
}

