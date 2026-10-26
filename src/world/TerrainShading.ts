// Procedural terrain shading in TSL, shared by the terrain and the grass so their
// colours and coverage always agree. Land use (roads, fields, vineyards, forests,
// settlements, water) comes from the baked masks.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, color, mix, smoothstep, clamp, max, texture, fract, abs,
  positionWorld, normalWorld, normalView, positionView, cameraPosition,
  mx_noise_float, mx_fractal_noise_float,
} from 'three/tsl';
import { WATER_LEVEL, WORLD_HALF, WORLD_SIZE, EMBERHOLD } from './Layout';
import type { Heightfield } from './Heightfield';

// Palette (sRGB hex; three converts to linear).
export const PAL = {
  grassLush: color(0x52652d),
  grassDry: color(0x8a844a),
  grassDeep: color(0x2c3a19),
  soil: color(0x5f4b36),
  soilDark: color(0x3c3025),
  tilled: color(0x5a4532),
  road: color(0x7d6c55),
  roadDark: color(0x5b4d3c),
  yard: color(0x6e6252),
  rock: color(0x7c776e),
  rockWarm: color(0x8d7d68),
  rockDark: color(0x4a4742),
  mud: color(0x3d352b),
  pebble: color(0x857a68),
  snow: color(0xe6ebef),
  wheat: color(0xc2a65a),
  barley: color(0x9ea04e),
  flax: color(0x6d8a62),
  pasture: color(0x5c7a32),
  litter: color(0x4a412e),
};

const W = float(WATER_LEVEL);

/** Masks: [road, settlement, forest, water distance/255] and [wheat, barley, flax, vineyard]. */
let maskTex: THREE.Texture | null = null;
let cropTex: THREE.Texture | null = null;
export function bindMasks(hf: Heightfield) { maskTex = hf.maskTexture; cropTex = hf.cropTexture; }

const worldUV = (xz: any) => xz.add(WORLD_HALF).div(WORLD_SIZE);
export const landMask = (xz: any) => texture(maskTex!, worldUV(xz));
export const cropMask = (xz: any) => texture(cropTex!, worldUV(xz));

/** Horse pastures east of Emberhold: shorter, brighter grass. */
export const pastureWeight = Fn(([xz]: any) => {
  const d = vec2(xz.x.sub(2450.0).div(950.0), xz.y.add(1100.0).div(700.0)).length()
    .add(mx_fractal_noise_float(xz.mul(0.0015), 3, 2.0, 0.5).mul(0.3));
  return smoothstep(1.0, 0.92, d);
});

/** 0..1 large-scale variation used for dry vs lush meadows. */
export const macroNoise = Fn(([xz]: any) => mx_fractal_noise_float(xz.mul(0.0035), 3, 2.0, 0.5).mul(0.5).add(0.5));
/** 0..1 medium-scale variation (clumps, patches). */
export const mesoNoise = Fn(([xz]: any) => mx_noise_float(xz.mul(0.045)).mul(0.5).add(0.5));
/** 1 where bare soil patches break up the meadow. */
export const dirtMask = Fn(([xz]: any) =>
  smoothstep(0.66, 0.8, mx_fractal_noise_float(xz.mul(0.016).add(vec2(13.7, -4.1)), 3, 2.0, 0.5).mul(0.5).add(0.5)));
/** Weight of exposed rock from the surface slope (normal.y). */
export const rockWeight = Fn(([slopeY, jitter]: any) => smoothstep(0.86, 0.72, slopeY.add(jitter.mul(0.04))));
/** Weight of the muddy/pebbly river bank. */
export const bankWeight = Fn(([h, jitter]: any) => float(1).sub(smoothstep(W.add(0.25), W.add(1.25), h.add(jitter.mul(0.3)))));

/** Crisp field edges: threshold the blurred 8 m mask with a little noise. */
const crisp = (m: any, xz: any) => smoothstep(0.42, 0.58, m.add(mx_noise_float(xz.mul(0.35)).mul(0.12)));

/** Vine rows run east-west, 2.6 m apart. */
const vineRows = Fn(([xz]: any) => smoothstep(0.32, 0.12, abs(fract(xz.y.div(2.6)).sub(0.5))));

/**
 * Grass parameters at a point: x = coverage (0..1), y = height scale, z = crop blend,
 * w = colour kind (0 meadow, 1 wheat, 2 barley, 3 flax).
 */
export const grassField = Fn(([xz, slopeY, h]: any) => {
  const j = mx_noise_float(xz.mul(0.9));
  const lm = landMask(xz);
  const cm = cropMask(xz);
  const road = smoothstep(0.25, 0.6, lm.x);
  const settle = crisp(lm.y, xz);
  const forest = lm.z;
  const wheat = crisp(cm.x, xz), barley = crisp(cm.y, xz), flax = crisp(cm.z, xz), vine = crisp(cm.w, xz);
  const crop = clamp(wheat.add(barley).add(flax), 0.0, 1.0);
  const rockW = rockWeight(slopeY, j);
  const bankW = bankWeight(h, j);
  const dirt = dirtMask(xz).mul(float(1).sub(crop));
  const high = smoothstep(330.0, 260.0, h);
  let cover: any = float(1).sub(rockW).mul(float(1).sub(bankW)).mul(float(1).sub(dirt.mul(0.95))).mul(high);
  cover = cover.mul(float(1).sub(road)).mul(float(1).sub(settle.mul(0.85)));
  cover = cover.mul(float(1).sub(forest.mul(0.55)));
  cover = cover.mul(float(1).sub(vine.mul(vineRows(xz)).mul(0.9)));
  const pasture = pastureWeight(xz);
  let height: any = mix(float(1), float(0.35), pasture);
  height = height.mul(float(1).sub(forest.mul(0.35))).mul(float(1).sub(settle.mul(0.6))).mul(float(1).sub(vine.mul(0.4)));
  height = mix(height, float(2.0), wheat).mul(mix(float(1), float(0.85), barley)).mul(mix(float(1), float(0.7), flax));
  height = mix(height, float(1.6), barley.mul(float(1).sub(wheat)));
  height = mix(height, float(1.25), flax.mul(float(1).sub(wheat).sub(barley).max(0.0)));
  const kind = wheat.mul(1.0).add(barley.mul(2.0)).add(flax.mul(3.0));
  return vec4(cover, height, crop, kind);
});

/** Meadow colour at a point, matching the grass blades. */
export const meadowColor = Fn(([xz]: any) => {
  const macro = macroNoise(xz);
  const meso = mesoNoise(xz);
  const lm = landMask(xz);
  const nearWater = smoothstep(60.0, 8.0, lm.w.mul(255.0));
  let c: any = mix(PAL.grassLush, PAL.grassDry, smoothstep(0.42, 0.85, macro).mul(float(1).sub(nearWater.mul(0.7))));
  c = mix(c, PAL.pasture, pastureWeight(xz).mul(0.7));
  return c.mul(meso.mul(0.3).add(0.82));
});

/** Colour of the crop or meadow at a point (blade tips / far terrain). */
export const cropColor = Fn(([xz, kind, base]: any) => {
  const v = mx_noise_float(xz.mul(0.08)).mul(0.08).add(1.0);
  let c: any = base;
  c = mix(c, PAL.wheat.mul(v), smoothstep(0.5, 1.0, kind).mul(smoothstep(1.5, 1.0, kind)));
  c = mix(c, PAL.barley.mul(v), smoothstep(1.5, 2.0, kind).mul(smoothstep(2.5, 2.0, kind)));
  c = mix(c, PAL.flax.mul(v), smoothstep(2.5, 3.0, kind));
  return c;
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

export function createTerrainMaterial(hf: Heightfield): THREE.MeshStandardNodeMaterial {
  bindMasks(hf);
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
  const lm = landMask(xz);
  const cm = cropMask(xz);
  const road = smoothstep(0.2, 0.65, lm.x.add(micro.mul(0.08)));
  const settle = crisp(lm.y, xz);
  const forest = lm.z;
  const wheat = crisp(cm.x, xz), barley = crisp(cm.y, xz), flax = crisp(cm.z, xz), vine = crisp(cm.w, xz);
  const crop = clamp(wheat.add(barley).add(flax), 0.0, 1.0);
  const kind = wheat.mul(1.0).add(barley.mul(2.0)).add(flax.mul(3.0));

  // Up close you see soil between the blades; from afar you only see blade tips.
  const meadow = meadowColor(xz);
  const far = smoothstep(6.0, 45.0, camDist);
  const underGrass = mix(mix(meadow, PAL.grassDeep, 0.5), meadow.mul(0.92), far);
  const fieldFar = cropColor(xz, kind, meadow).mul(0.95);
  const fieldNear = mix(PAL.tilled, fieldFar.mul(0.55), 0.35);
  const fieldCol = mix(fieldNear, fieldFar, far);
  const vineCol = mix(PAL.tilled.mul(fine.mul(0.1).add(1.0)), PAL.grassDeep.mul(1.1), vineRows(xz).mul(0.65));

  const dirt = dirtMask(xz).mul(float(1).sub(crop));
  const soilCol = mix(PAL.soil, PAL.soilDark, meso).mul(fine.mul(0.08).add(1.0));
  const roadCol = mix(PAL.road, PAL.roadDark, smoothstep(0.3, 0.8, mx_noise_float(xz.mul(vec2(0.6, 0.15))).mul(0.5).add(0.5)).mul(0.6)).mul(fine.mul(0.1).add(1.0));
  const yardCol = mix(PAL.yard, PAL.soil, meso.mul(0.5)).mul(fine.mul(0.12).add(1.0));

  const rockN = mx_fractal_noise_float(p.mul(vec3(0.11, 0.42, 0.11)), 4, 2.1, 0.55);
  const strata = mx_noise_float(vec3(p.y.mul(0.9), p.x.mul(0.02), p.z.mul(0.02))).mul(0.5).add(0.5);
  const rockCol = mix(mix(PAL.rockDark, PAL.rock, rockN.mul(0.5).add(0.5)), PAL.rockWarm, smoothstep(0.3, 0.8, strata).mul(0.5));
  // Emberhold's terraced hill keeps its grass; elsewhere steep ground shows rock.
  const fortHill = smoothstep(EMBERHOLD.hillR, EMBERHOLD.outerR, xz.sub(vec2(EMBERHOLD.x, EMBERHOLD.z)).length());
  const rockW = rockWeight(n.y, micro).mul(float(1).sub(fortHill.mul(0.7)));

  const bankW = bankWeight(p.y, micro);
  const bankCol = mix(PAL.mud, PAL.pebble, smoothstep(W.sub(0.2), W.add(1.6), p.y).mul(fine.mul(0.3).add(0.7)));
  const snowW = smoothstep(420.0, 470.0, p.y.add(meso.mul(30.0))).mul(smoothstep(0.62, 0.8, n.y));

  let albedo: any = underGrass;
  albedo = mix(albedo, PAL.litter.mul(meso.mul(0.3).add(0.85)), forest.mul(0.55));
  albedo = mix(albedo, soilCol, dirt.mul(float(1).sub(rockW)));
  albedo = mix(albedo, fieldCol, crop);
  albedo = mix(albedo, vineCol, vine);
  albedo = mix(albedo, yardCol, settle);
  albedo = mix(albedo, roadCol, road);
  albedo = mix(albedo, bankCol, bankW.mul(float(1).sub(rockW)));
  albedo = mix(albedo, rockCol, rockW);
  albedo = mix(albedo, PAL.snow, snowW);
  albedo = albedo.mul(macro.mul(0.18).add(0.91));

  const wet = float(1).sub(smoothstep(W.sub(0.1), W.add(1.0), p.y));
  let rough: any = mix(float(0.93), float(0.82), rockW);
  rough = mix(rough, float(0.32), wet.mul(float(1).sub(rockW)));
  rough = mix(rough, float(0.55), snowW);

  // Procedural relief: cracks and lumps in rock, clods in soil, ruts in roads, faint ripple in grass.
  const rockRelief = rockN.mul(0.35).add(mx_noise_float(p.mul(1.7)).mul(0.06));
  const groundRelief = micro.mul(0.02).add(fine.mul(0.012)).add(mx_noise_float(xz.mul(11.0)).mul(0.005));
  const roadRelief = mx_noise_float(xz.mul(2.2)).mul(0.02).add(mx_noise_float(xz.mul(9.0)).mul(0.008));
  let relief: any = mix(groundRelief, rockRelief, rockW);
  relief = mix(relief, roadRelief, road);
  relief = relief.add(vineRows(xz).mul(vine).mul(0.06));

  mat.colorNode = clamp(albedo, 0.0, 1.0);
  mat.roughnessNode = rough;
  mat.metalnessNode = float(0);
  mat.normalNode = bumpFromHeight(relief.mul(near));
  return mat;
}

