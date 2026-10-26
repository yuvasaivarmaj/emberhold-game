// Post-processing: HDR scene pass, bloom, filmic tone mapping, grading, vignette, FXAA.
import * as THREE from 'three/webgpu';
import { pass, renderOutput, screenUV, float, vec3, vec4, mix, smoothstep, dot, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import type { QualityPreset } from '../core/Settings';

export class Pipeline {
  readonly pipeline: THREE.RenderPipeline;
  readonly uSaturation = uniform(1.06);

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, q: QualityPreset) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: q.msaa });
    const color = scenePass.getTextureNode('output');
    let hdr: any = color;
    if (q.bloom) {
      const b = bloom(color, 0.22, 0.55, 0.92);
      hdr = color.add(b);
    }
    // Tone map to display space, then grade in display space.
    let ldr: any = renderOutput(hdr);
    const luma = dot(ldr.rgb, vec3(0.2126, 0.7152, 0.0722));
    const graded = mix(vec3(luma), ldr.rgb, this.uSaturation);
    const d = screenUV.sub(0.5).length();
    const vignette = float(1).sub(smoothstep(0.45, 0.95, d).mul(0.28));
    ldr = vec4(graded.mul(vignette), 1.0);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = q.fxaa ? fxaa(ldr) : ldr;
  }

  render() { this.pipeline.render(); }
}
