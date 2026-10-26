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
import { Viewmodel } from '../player/Viewmodel';
import { GameAudio } from '../audio/Audio';
import { Pipeline } from '../render/Pipeline';
import { Prologue } from '../cinematic/Prologue';
import { loadSave, writeSave, clearSave, timeAgo, type SaveData } from '../story/Save';
import { chapterById } from '../story/Chapters';
import { Input } from './Input';
import { UI } from '../ui/UI';
import { PRESETS, loadSettings, saveSettings, verticalFov, type UserSettings, type QualityPreset } from './Settings';
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
  hands!: Viewmodel;
  audio = new GameAudio();
  pipeline!: Pipeline;
  state: 'loading' | 'title' | 'cinematic' | 'ready' | 'playing' | 'paused' = 'loading';
  prologue!: Prologue;
  chapter = 'verdance';
  private playSeconds = 0;
  private autosaveTimer = 0;
  private shownIntro = false;
  private clock = new THREE.Timer();
  private fpsFrames = 0;
  private fpsTime = 0;
  private titleT = 0;
  private baseDpr = 1;
  private resScale = 1;
  private perfTime = 0;
  private perfFrames = 0;
  private params = new URLSearchParams(location.search);

  constructor() {
    this.settings = loadSettings();
    const qp = this.params.get('quality');
    if (qp && qp in PRESETS) this.settings.quality = qp as any;
    this.q = PRESETS[this.settings.quality];
    this.camera = new THREE.PerspectiveCamera(verticalFov(this.settings.fov, innerWidth / innerHeight), innerWidth / innerHeight, 0.05, 6000);
    this.scene.add(this.camera);
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
      this.baseDpr = Math.min(devicePixelRatio, this.q.pixelRatio) * this.q.renderScale;
      this.renderer.setPixelRatio(this.baseDpr);
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
      await this.sky.loadStars();
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
      this.hands = new Viewmodel(this.camera);
      this.hands.visible = this.settings.showHands;
      this.restorePose();
      this.physics.step();
      const pos = this.params.get('pos');
      if (pos) {
        const [x, z] = pos.split(',').map(Number);
        this.player.setPose(x, this.hf.height(x, z) + 0.05, z, +(this.params.get('yaw') ?? SPAWN.yaw), +(this.params.get('pitch') ?? 0));
      }
      this.player.update(0.016, this.input, this.settings);
      this.hands.update(0.016, this.player, 0, 0);
      this.updateWorld(0.016, true);

      this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.q);
      ui.progress(0.9, 'Remembering Aethryn…');
      this.prologue = new Prologue(this);
      await this.prologue.init();

      ui.progress(0.92, 'Preparing shaders…');
      await nextFrame();
      try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compile on first frame instead */ }
      ui.progress(1, 'Ready');

      this.wireUI();
      const backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
      const save = loadSave();
      ui.showStart(`Renderer: ${backend} · Quality: ${this.settings.quality} · ${this.trees.count} trees`,
        save ? { label: `${chapterById(save.chapter).title} · saved ${timeAgo(save.savedAt)}` } : null);
      this.state = 'title';
      window.addEventListener('resize', () => this.resize());
      (window as any).__game = this;
      if (this.params.has('gpuprobe')) {
        // Test mode for headless WebGPU: render offscreen and show the result as an image.
        await this.probeOffscreen();
        (this as any).stillDone = true;
        return;
      }
      if (this.params.has('cineshot')) {
        // Test mode: render one frame of the opening film.
        this.state = 'cinematic';
        ui.cinematic();
        await this.prologue.debugRender(+(this.params.get('cineshot') ?? 0), +(this.params.get('cinet') ?? 3));
        (this as any).stillDone = true;
        return;
      }
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

  private async probeOffscreen() {
    const w = 960, h = 540;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const rt = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType });
    for (let i = 0; i < 2; i++) {
      this.updateWorld(0.016);
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
    }
    const px = await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h) as Uint16Array;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const f = (v: number) => THREE.DataUtils.fromHalfFloat(v);
    const flip = !(this.renderer.backend as any).isWebGPUBackend;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((flip ? h - 1 - y : y) * w + x) * 4, di = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let v = f(px[si + c]) * this.renderer.toneMappingExposure;
          v = v / (1 + v); // simple Reinhard for preview only
          img.data[di + c] = Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255);
        }
        img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const out = new Image();
    out.src = cv.toDataURL();
    out.style.cssText = 'position:fixed;inset:0;z-index:100;width:100%;height:100%;object-fit:contain;background:#000';
    document.body.appendChild(out);
    this.renderer.domElement.style.display = 'none';
  }

  private wireUI() {
    const ui = this.ui;
    ui.onContinue = () => this.continueGame();
    ui.onNewGame = () => this.newGame();
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
    window.addEventListener('beforeunload', () => { if (this.state === 'playing' || this.state === 'paused') this.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.save(); });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') {
        this.save();
        this.state = 'paused';
        this.audio.suspend();
        ui.paused();
      }
    };
  }

  private continueGame() {
    const save = loadSave();
    if (save) {
      this.chapter = save.chapter;
      this.playSeconds = save.playSeconds;
      this.player.setPose(save.x, save.y + 0.05, save.z, save.yaw, save.pitch);
      this.sky.setHour(save.hour);
    }
    this.enter(true);
  }

  private newGame() {
    clearSave();
    this.audio.start(this.settings.volume);
    this.audio.resume();
    this.state = 'cinematic';
    this.ui.cinematic();
    this.prologue.play(async () => {
      // The story proper begins: back in the present day of the Verdance.
      this.chapter = 'verdance';
      this.playSeconds = 0;
      this.player.setPose(SPAWN.x, this.hf.height(SPAWN.x, SPAWN.z) + 0.05, SPAWN.z, SPAWN.yaw, 0);
      this.player.update(0.016, this.input, this.settings);
      this.sky.setHour(16.6);
      this.sky.timeScale = this.settings.timeScale;
      this.camera.fov = verticalFov(this.settings.fov, this.camera.aspect);
      this.camera.updateProjectionMatrix();
      this.state = 'ready';
      const ch = chapterById('verdance');
      await this.ui.clickToPlay(ch.part, ch.title, ch.objective);
      this.save();
      this.enter(true);
    });
  }

  /** Used by the opening film to keep the world (terrain, grass, trees, sky) updating. */
  cineWorldUpdate(dt: number) { this.updateWorld(dt); }

  save() {
    if (!this.player) return;
    const p = this.player;
    const d: SaveData = {
      v: 1, chapter: this.chapter, x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, pitch: p.pitch,
      hour: this.sky.hour, flags: {}, savedAt: Date.now(), playSeconds: Math.round(this.playSeconds),
    };
    writeSave(d);
  }

  private enter(lock: boolean) {
    if (lock) {
      this.input.lock();
      // Some embedded pages can't capture the mouse; fall back to drag-to-look.
      setTimeout(() => {
        if (this.state === 'playing' && !this.input.locked) this.ui.toast('Drag to look', 'Mouse capture is unavailable here', 3500);
      }, 700);
    }
    this.audio.start(this.settings.volume);
    this.audio.resume();
    const first = !this.shownIntro;
    this.shownIntro = true;
    this.state = 'playing';
    this.ui.playing();
    this.hands.visible = this.settings.showHands;
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
    this.camera.fov = verticalFov(this.settings.fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  private updateWorld(dt: number, _force = false) {
    const cam = this.camera.position;
    this.terrain.update(cam);
    this.grass.update(this.camera);
    this.camera.updateMatrixWorld();
    this.trees.update(this.camera);
    this.sky.update(dt, this.renderer, cam);
    this.sky.updateStars(this.camera, this.renderer.domElement.height);
  }

  private frame() {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    const input = this.input;

    if (this.state === 'cinematic') {
      this.prologue.update(dt);
      input.endFrame();
      return;
    }

    if (this.state === 'playing') {
      this.playSeconds += dt;
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 20) { this.autosaveTimer = 0; this.save(); }
      if (input.hit('Escape') && !input.locked) {
        this.state = 'paused';
        this.audio.suspend();
        this.ui.paused();
      }
      if (input.hit('F3')) { this.settings.showFps = !this.settings.showFps; saveSettings(this.settings); }
      const fast = input.down('KeyT');
      this.sky.timeScale = fast ? 90 : this.settings.timeScale;
      const ev = this.player.update(dt, input, this.settings);
      this.hands.visible = this.settings.showHands;
      this.hands.update(dt, this.player, input.mouseDX, input.mouseDY);
      this.physics.step();
      if (ev.footstep) this.audio.footstep(ev.footstep.surface, ev.footstep.intensity);
      if (ev.landed) this.audio.landed(ev.landed, this.player.surface);
      this.updateWorld(dt);
      const f = this.player.feet;
      this.audio.update(dt, {
        day: this.sky.dayFactor, riverDist: riverDistance(f.x, f.z), altitude: f.y,
        wind: 1, treesNear: this.treesNear(f),
      });
    } else if (this.state === 'title' || this.state === 'ready') {
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

    this.adaptResolution(dt);
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      if (this.settings.showFps) {
        const info = this.renderer.info.render;
        const p = this.player.feet;
        this.ui.fps(`${Math.round(this.fpsFrames / this.fpsTime)} fps · ${Math.round(this.resScale * 100)}% res\n${(info.triangles / 1e6).toFixed(2)}M tris · ${info.drawCalls} draws\n${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}`);
      } else this.ui.fps(null);
      this.fpsFrames = 0; this.fpsTime = 0;
    }
  }

  /** Lower the internal resolution a little when the frame rate drops, raise it back when there's headroom. */
  private adaptResolution(dt: number) {
    if (this.state !== 'playing') return;
    this.perfFrames++;
    this.perfTime += dt;
    if (this.perfTime < 1.5) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfFrames = 0; this.perfTime = 0;
    let next = this.resScale;
    if (!this.settings.adaptiveResolution) next = 1;
    else if (fps < 50) next = Math.max(0.6, this.resScale - 0.08);
    else if (fps > 68) next = Math.min(1, this.resScale + 0.05);
    if (Math.abs(next - this.resScale) > 0.001) {
      this.resScale = next;
      this.renderer.setPixelRatio(this.baseDpr * next);
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
