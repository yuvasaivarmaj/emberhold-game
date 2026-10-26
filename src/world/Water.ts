// River water: refracts the riverbed, darkens with depth, reflects the sky, and flows downstream.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, mix, smoothstep, clamp, max, time, mx_noise_float, positionWorld, positionView,
  screenUV, viewportSharedTexture, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar,
  transformNormalToView, color, exp,
} from 'three/tsl';
import { WATER_LEVEL, WORLD_SIZE } from './WorldConfig';
import type { SkySystem } from './SkySystem';

export class Water {
  readonly mesh: THREE.Mesh;

  constructor(sky: SkySystem) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 32, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
    const xz = positionWorld.xz;
    const flow = vec2(1.0, 0.12).mul(time.mul(0.9));

    // Surface ripples: two scrolling noise layers give a normal perturbation.
    const camDist = positionView.z.negate();
    const detail = float(1).sub(smoothstep(12.0, 70.0, camDist));
    const waveNormal = Fn(() => {
      const e = float(0.15);
      const hgt = (p: any) =>
        mx_noise_float(p.mul(0.35).sub(flow.mul(0.35))).mul(0.6)
          .add(mx_noise_float(p.mul(1.1).sub(flow.mul(1.1)).add(vec2(4.0, 1.0))).mul(0.2).mul(detail.mul(0.8).add(0.2)))
          .add(mx_noise_float(p.mul(3.3).sub(flow.mul(2.2))).mul(0.05).mul(detail));
      const h0 = hgt(xz);
      const hx = hgt(xz.add(vec2(e, 0.0)));
      const hz = hgt(xz.add(vec2(0.0, e)));
      return vec3(h0.sub(hx).div(e).mul(0.14), 1.0, h0.sub(hz).div(e).mul(0.14)).normalize();
    })();
    mat.normalNode = transformNormalToView(waveNormal);

    // Water thickness from the depth buffer behind the surface.
    const distortion = waveNormal.xz.mul(0.035);
    const sceneDepthRaw = viewportDepthTexture(screenUV).x;
    const sceneZ = perspectiveDepthToViewZ(sceneDepthRaw, cameraNear, cameraFar);
    const thickness = max(positionView.z.sub(sceneZ), 0.0);
    const refrUV = screenUV.add(distortion.mul(clamp(thickness.mul(0.6), 0.0, 1.0)));
    const behind = viewportSharedTexture(refrUV).rgb;

    // Beer-Lambert absorption: green-brown river water.
    const absorb = vec3(0.45, 0.22, 0.16);
    const transmit = exp(absorb.mul(thickness).mul(-1.2));
    const deep = color(0x0f2a26).mul(sky.uSunColor.length().mul(0.25).add(0.03));
    const murk = float(1).sub(exp(thickness.mul(-0.65)));
    const body = mix(behind.mul(transmit), deep, murk.mul(0.85));

    // Foam where the water meets the bank or stones.
    const foamNoise = mx_noise_float(xz.mul(2.2).sub(flow.mul(1.6))).mul(0.5).add(0.5);
    const foam = smoothstep(0.35, 0.0, thickness).mul(smoothstep(0.35, 0.75, foamNoise)).mul(0.6);

    mat.colorNode = mix(vec3(0.0), vec3(0.85), foam);
    mat.emissiveNode = body.mul(float(1).sub(foam));
    mat.roughnessNode = mix(mix(float(0.04), float(0.12), smoothstep(20.0, 160.0, camDist)), float(0.6), foam);
    mat.metalnessNode = float(0);
    // Fade the very edge so the shoreline isn't a hard line.
    mat.opacityNode = smoothstep(0.0, 0.08, thickness);

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'Water';
  }
}
