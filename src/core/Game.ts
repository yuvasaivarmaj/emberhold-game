// Boots the world and runs the frame loop.
import * as THREE from 'three/webgpu';
import { Heightfield } from '../world/Heightfield';
import { Terrain } from '../world/Terrain';
import { SkySystem } from '../world/SkySystem';
import { Grass } from '../world/Grass';
import { Trees } from '../world/Trees';
import { Rocks } from '../world/Rocks';
import { Water } from '../world/Water';
import { Physics } from '../physics/Physics';
import { Player } from '../player/Player';
import { GameAudio } from '../audio/Audio';
import { Pipeline } from '../render/Pipeline';
import { Input } from './Input';
import { UI } from '../ui/UI';
import { PRESETS, loadSettings, saveSettings, type UserSettings, type QualityPreset } from './Settings';
import { SPAWN, riverDistance } from '../world/WorldConfig';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class Game {
  settings: UserSettings;
  q: QualityPreset;
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  ui: UI;
  input!: Input;
  hf!: Heightfield;
  terrain!: Terrain;
  sky!: SkySystem;
  grass!: Grass;
  trees!: Trees;
  rocks!: Rocks;
  water!: Water;
  physics = new Physics();
  player!: Player;
  audio = new GameAudio();
  pipeline!: Pipeline;
  state: 'loading' | 'title' | 'playing' | 'paused' = 'loading';
  private clock = new THREE.Timer();
  private fpsFrames = 0;
  private fpsTime = 0;
  private titleT = 0;
  private params = new URLSearchParams(location.search);

  constructor() {
    this.settings = loadSettings();
    const qp = this.params.get('quality');
    if (qp && qp in PRESETS) this.settings.quality = qp as any;
    this.q = PRESETS[this.settings.quality];
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.08, 6000);
    this.ui = new UI(this.settings);
  }

  async start() {
    const ui = this.ui;
    try {
      ui.progress(0.02, 'Waking the renderer…');
      this.renderer = new THREE.WebGPURenderer({
        antialias: false,
        powerPreference: 'high-performance',
        forceWebGL: this.params.has('webgl'),
      });
      const dpr = Math.min(devicePixelRatio, this.q.pixelRatio) * this.q.renderScale;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.shadowMap.enabled = this.q.shadows;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      document.getElementById('app')!.appendChild(this.renderer.domElement);
      await this.renderer.init();
      this.input = new Input(this.renderer.domElement);

      ui.progress(0.05, 'Raising the land…');
      this.hf = await Heightfield.load((p) => ui.progress(0.05 + p * 0.33, 'Raising the land…'));

      ui.progress(0.4, 'Settling the earth…');
      await this.physics.init();
      this.physics.addTerrain(this.hf);
      this.terrain = new Terrain(this.hf, this.q.viewScale);
      this.scene.add(this.terrain.group);
      await nextFrame();

      ui.progress(0.46, 'Lighting the sky…');
      this.sky = new SkySystem(this.scene, this.q);
      const hp = this.params.get('hour');
      this.sky.setHour(hp ? +hp : 16.6);
      this.sky.timeScale = this.settings.timeScale;
      await nextFrame();

      ui.progress(0.5, 'Growing the trees…');
      await nextFrame();
      this.trees = new Trees(this.hf, this.sky, this.q.treeDensity, this.q.treeFullDistance, this.q.treeMidDistance, this.q.msaa > 0);
      this.trees.bakeImpostors(this.renderer);
      if (!this.params.has('notrees')) this.scene.add(this.trees.group);
      ui.progress(0.74, 'Scattering stone…');
      await nextFrame();
      this.rocks = new Rocks(this.hf, this.q.treeDensity);
      this.scene.add(this.rocks.group);

      ui.progress(0.8, 'Sowing the meadows…');
      await nextFrame();
      this.grass = new Grass(this.hf, this.sky, this.q.grassNear, this.q.grassFar);
      if (!this.params.has('nograss')) this.scene.add(this.grass.group);
      this.water = new Water(this.sky);
      this.scene.add(this.water.mesh);

      ui.progress(0.86, 'Placing you in the world…');
      await nextFrame();
      this.physics.addTrees(this.trees.instances);
      this.physics.addRocks(this.rocks.instances, this.rocks.geometries);
      this.player = new Player(this.physics, this.hf, SPAWN, this.camera);
      this.restorePose();
      this.physics.step();
      const pos = this.params.get('pos');
      if (pos) {
        const [x, z] = pos.split(',').map(Number);
        this.player.setPose(x, this.hf.height(x, z) + 0.05, z, +(this.params.get('yaw') ?? SPAWN.yaw), +(this.params.get('pitch') ?? 0));
      }
      this.player.update(0.016, this.input, this.settings);
      this.updateWorld(0.016, true);

      this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.q);

      ui.progress(0.92, 'Preparing shaders…');
      await nextFrame();
      try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compile on first frame instead */ }
      ui.progress(1, 'Ready');

      this.wireUI();
      const backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
      ui.showStart(`Renderer: ${backend} · Quality: ${this.settings.quality} · ${this.trees.count} trees`);
      this.state = 'title';
      window.addEventListener('resize', () => this.resize());
      (window as any).__game = this;
      if (this.params.has('still')) {
        // Test mode: render a few frames then stop (for slow software renderers).
        this.enter(false);
        for (let i = 0; i < +(this.params.get('still') || 3); i++) { this.frame(); await nextFrame(); }
        (this as any).stillDone = true;
        return;
      }
      this.renderer.setAnimationLoop(() => this.frame());
      if (this.params.has('autostart')) this.enter(false);
    } catch (err: any) {
      console.error(err);
      ui.error(err?.message ?? String(err));
    }
  }

  private wireUI() {
    const ui = this.ui;
    ui.onEnter = () => this.enter(true);
    ui.onResume = () => this.enter(true);
    ui.getHour = () => this.sky.hour;
    ui.onHourChange = (h) => this.sky.setHour(h);
    ui.onSettingsChange = (s, qualityChanged) => {
      saveSettings(s);
      this.audio.setVolume(s.volume);
      this.sky.timeScale = s.timeScale;
      if (qualityChanged) {
        this.savePose();
        location.reload();
      }
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') {
        this.state = 'paused';
        this.audio.suspend();
        ui.paused();
      }
    };
  }

  private enter(lock: boolean) {
    if (lock) this.input.lock();
    this.audio.start(this.settings.volume);
    this.audio.resume();
    const first = this.state === 'title';
    this.state = 'playing';
    this.ui.playing();
    if (first) {
      setTimeout(() => this.ui.toast('The Verdance', 'South bank of the Silverrun'), 600);
      setTimeout(() => this.ui.hideHint(), 14000);
    }
  }

  private savePose() {
    const p = this.player;
    try { sessionStorage.setItem('emberhold.pose', JSON.stringify({ x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, pitch: p.pitch, hour: this.sky.hour })); } catch { /* ignore */ }
  }

  private restorePose() {
    try {
      const raw = sessionStorage.getItem('emberhold.pose');
      if (!raw) return;
      sessionStorage.removeItem('emberhold.pose');
      const p = JSON.parse(raw);
      this.player.setPose(p.x, p.y + 0.1, p.z, p.yaw, p.pitch);
      this.sky.setHour(p.hour);
    } catch { /* ignore */ }
  }

  private resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  private updateWorld(dt: number, _force = false) {
    const cam = this.camera.position;
    this.terrain.update(cam);
    this.grass.update(cam);
    this.trees.update(cam);
    this.sky.update(dt, this.renderer, cam);
  }

  private frame() {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    const input = this.input;

    if (this.state === 'playing') {
      if (input.hit('F3')) { this.settings.showFps = !this.settings.showFps; saveSettings(this.settings); }
      const fast = input.down('KeyT');
      this.sky.timeScale = fast ? 90 : this.settings.timeScale;
      const ev = this.player.update(dt, input, this.settings);
      this.physics.step();
      if (ev.footstep) this.audio.footstep(ev.footstep.surface, ev.footstep.intensity);
      if (ev.landed) this.audio.landed(ev.landed, this.player.surface);
      this.updateWorld(dt);
      const f = this.player.feet;
      this.audio.update(dt, {
        day: this.sky.dayFactor, riverDist: riverDistance(f.x, f.z), altitude: f.y,
        wind: 1, treesNear: this.treesNear(f),
      });
    } else if (this.state === 'title') {
      // Gentle look-around behind the title screen.
      this.titleT += dt;
      this.camera.rotation.set(-0.02 + Math.sin(this.titleT * 0.11) * 0.015, this.player.yaw + Math.sin(this.titleT * 0.07) * 0.12, 0, 'YXZ');
      this.sky.timeScale = 0.4;
      this.updateWorld(dt);
    } else {
      this.sky.timeScale = 0;
      this.updateWorld(0);
    }

    this.ui.clock(this.sky.hour);
    this.pipeline.render();
    input.endFrame();

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      if (this.settings.showFps) {
        const info = this.renderer.info.render;
        const p = this.player.feet;
        this.ui.fps(`${Math.round(this.fpsFrames / this.fpsTime)} fps\n${(info.triangles / 1e6).toFixed(2)}M tris · ${info.drawCalls} draws\n${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}`);
      } else this.ui.fps(null);
      this.fpsFrames = 0; this.fpsTime = 0;
    }
  }

  private treesNear(p: THREE.Vector3) {
    // Cheap estimate: sample a handful of trees.
    const list = this.trees.instances;
    let n = 0;
    for (let i = 0; i < list.length; i += 7) {
      const t = list[i];
      if (Math.abs(t.x - p.x) < 40 && Math.abs(t.z - p.z) < 40) n++;
    }
    return Math.min(1, n / 6);
  }
}
