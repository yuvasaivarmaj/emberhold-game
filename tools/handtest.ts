// Dev-only page for posing the first-person hands quickly.
import * as THREE from 'three/webgpu';
import { Viewmodel } from '../src/player/Viewmodel';
const params = new URLSearchParams(location.search);
const r = new THREE.WebGPURenderer({ forceWebGL: true });
r.setSize(innerWidth, innerHeight);
document.body.appendChild(r.domElement);
await r.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a9a7a);
const cam = new THREE.PerspectiveCamera(59, 16 / 9, 0.05, 100);
scene.add(cam);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x554433, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(-2, 3, 1); scene.add(sun);
const anchor = new THREE.Object3D(); scene.add(anchor);
const vm = new Viewmodel(anchor);
const fake: any = { bobPhase: +(params.get('phase') ?? 0), grounded: true, swimming: params.has('swim'), sprinting: params.has('sprint'), speed: +(params.get('speed') ?? 0), crouching: false, landDip: 0 };
for (let i = 0; i < 60; i++) vm.update(1 / 30, fake, 0, 0);
const side = params.get('view');
if (side === 'top') { cam.position.set(0, 0.5, -0.32); cam.lookAt(0, -0.22, -0.4); }
if (side === 'side') { cam.position.set(0.8, -0.2, -0.35); cam.lookAt(0, -0.22, -0.38); }
if (side === 'front') { cam.position.set(0, -0.1, -1.2); cam.lookAt(0, -0.22, -0.4); }
r.render(scene, cam);
(window as any).__game = { stillDone: true, renderer: r, state: 'x' };
