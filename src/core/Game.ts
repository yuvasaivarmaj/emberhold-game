// Boots the world and runs the frame loop.
import * as THREE from 'three/webgpu';
import { Heightfield } from '../world/Heightfield';
import { Terrain } from '../world/Terrain';
import { SkySystem } from '../world/SkySystem';
import { Grass } from '../world/Grass';
import { Trees } from '../world/Trees';
import { Rocks } from '../world/Rocks';
import { Water } from '../world/Water';
import { Emberhold } from '../world/Emberhold';
import { Structures } from '../world/Structures';
import { Quillhaven, quillhavenPlantings } from '../world/Quillhaven';
import { Horses } from '../world/Horses';
import { Hud } from '../ui/Hud';
import { Torch } from '../player/Torch';
import { updateCamAxes } from '../cinematic/Effects';
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
import { SPAWN, riverDistance, roadAt, settlementAt, WATER_LEVEL } from '../world/WorldConfig';

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
  emberhold!: Emberhold;
  structures!: Structures;
  quillhaven!: Quillhaven;
  horses!: Horses;
  hud!: Hud;
  torch!: Torch;
  private reachT = 0;
  private strikeT = 0;
  private hudTimer = 0;
  private grips = [new THREE.Vector3(), new THREE.Vector3()];
  private eye = new THREE.Vector3();
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
    this.camera = new THREE.PerspectiveCamera(verticalFov(this.settings.fov, innerWidth / innerHeight), innerWidth / innerHeight, 0.05, 9000);
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

      ui.progress(0.05, 'Loading the Verdance…');
      this.hf = await Heightfield.load((p) => ui.progress(0.05 + p * 0.33, 'Loading the Verdance…'));

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
      this.trees = new Trees(this.hf, this.sky, this.q.treeDensity, this.q.treeFullDistance, this.q.treeMidDistance, this.q.msaa > 0, quillhavenPlantings());
      this.trees.bakeImpostors(this.renderer);
      if (!this.params.has('notrees')) this.scene.add(this.trees.group);
      ui.progress(0.74, 'Scattering stone…');
      await nextFrame();
      this.rocks = new Rocks(this.hf, this.q.treeDensity);
      this.scene.add(this.rocks.group);
      ui.progress(0.77, 'Raising Emberhold…');
      await nextFrame();
      this.emberhold = new Emberhold(this.hf);
      this.scene.add(this.emberhold.group);
      this.structures = new Structures(this.hf, this.emberhold.materials);
      this.scene.add(this.structures.group);
      this.quillhaven = new Quillhaven(this.hf, this.emberhold.materials);
      this.scene.add(this.quillhaven.group);
      if (this.params.has('nofortshadow')) this.emberhold.group.traverse((o) => { o.castShadow = false; });

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
      this.physics.addStatic(this.emberhold.colliders);
      this.physics.addStatic(this.structures.colliders);
      this.physics.addStatic(this.quillhaven.colliders);
      this.player = new Player(this.physics, this.hf, SPAWN, this.camera);
      this.hud = new Hud(this.hf);
      this.hud.onDiscover = (name, sub) => this.hud.message(`<span class="found">Discovered</span><span class="place">${name}</span>${sub ? `<br><i>${sub}</i>` : ''}`, 10000);
      this.horses = new Horses(this.hf, this.physics);
      this.scene.add(this.horses.group);
      this.hands = new Viewmodel(this.camera);
      await this.hands.load();
      this.torch = new Torch(this.scene);
      this.torch.attach(this.hands.rightGrip);
      this.torch.onBurnOut = () => this.hud.message('The torch has burned down to a stub.', 5000);
      this.extraActions = () => this.torchActions();
      this.hands.visible = this.settings.showHands;
      this.restorePose();
      this.physics.stream(this.player.feet, true);
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
        if (this.params.has('mount')) {
          // Test: in the saddle of the nearest horse, moving at the given speed.
          const h = this.horses.list.reduce((a, b) => (Math.hypot(a.x - this.player.feet.x, a.z - this.player.feet.z) < Math.hypot(b.x - this.player.feet.x, b.z - this.player.feet.z) ? a : b));
          this.mountHorse(h);
          h.speed = +(this.params.get('mount') || 0);
          h.phase = +(this.params.get('phase') ?? 0.3);
        }
        if (this.params.has('map')) this.hud.toggleMap(true);
        if (this.params.has('torch')) { this.torch.state = this.params.get('torch') === 'lit' ? 'lit' : 'branch'; this.torch['uFlame'].value = this.torch.state === 'lit' ? 1 : 0; }
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
      const rode = this.horses.list.find((h) => h.name === save.flags.riding);
      if (rode && !this.horses.mounted) {
        rode.x = save.x; rode.z = save.z; rode.yaw = +(save.flags.horseYaw ?? rode.yaw);
        rode.place(this.hf);
        this.mountHorse(rode);
      }
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

  /** The map, the things-to-do panel and hints, refreshed as you play. */
  private guide(dt: number) {
    const p = this.player, h = this.horses;
    this.hud.update(p.feet.x, p.feet.z, p.yaw, { horses: h.list.map((x) => ({ x: x.x, z: x.z })) });
    this.hudTimer += dt;
    if (this.hudTimer < 0.25) return;
    this.hudTimer = 0;
    const ch = chapterById(this.chapter);
    const can: string[] = [];
    if (h.mounted) {
      can.push('<kbd>W</kbd> trot · <kbd>Shift</kbd> canter, gallop · <kbd>Ctrl</kbd> walk');
      can.push('<kbd>A</kbd> <kbd>D</kbd> turn · <kbd>S</kbd> rein in · <kbd>E</kbd> dismount when slow');
    } else {
      const look = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      if (h.nearest(p.feet, look)) can.push('<kbd>E</kbd> ride this horse');
      if (p.swimming) can.push('<kbd>W</kbd> swim · <kbd>Shift</kbd> stronger strokes');
    }
    for (const a of this.extraActions()) can.push(a);
    can.push('<kbd>M</kbd> map');
    this.hud.objectives(ch.title, ch.objective, can);
    // One-time hints, when they become useful.
    if (this.playSeconds > 2) this.hud.tip('move', 'Walk with <kbd>W A S D</kbd>, run with <kbd>Shift</kbd>, jump with <kbd>Space</kbd>. Jump at a ledge to climb it.');
    if (this.playSeconds > 25) this.hud.tip('map', 'Press <kbd>M</kbd> for the map of the Verdance. The circle at the bottom right turns with you.');
    if (!h.mounted && h.list.some((x) => Math.hypot(x.x - p.feet.x, x.z - p.feet.z) < 12)) this.hud.tip('horse', 'Walk up to a horse and press <kbd>E</kbd> to ride. Ashfoot, your own horse, waits by the south road.');
    if (p.swimming) this.hud.tip('swim', 'You are swimming. Horses won\'t go into deep water.');
    const hr = this.sky.hour;
    if ((hr > 18.4 || hr < 5.5)) this.hud.tip('dark', 'Night is coming. Stand by a tree and press <kbd>F</kbd> to break off a branch, then <kbd>F</kbd> again to light it as a torch.');
  }

  /** A dry branch off a nearby tree, if there is one within reach. */
  private treeInReach() {
    const f = this.player.feet;
    for (const t of this.trees.near(f.x, f.z, 4)) {
      if (t.kind.startsWith('bush') || t.height < 4) continue;
      const d = Math.hypot(t.x - f.x, t.z - f.z);
      if (d < Math.max(0.4, t.trunkRadius) + 2.4) return t;
    }
    return null;
  }

  private torchActions() {
    const t = this.torch, out: string[] = [];
    const tree = this.treeInReach();
    if (!t.held && tree) out.push('<kbd>F</kbd> break off a branch');
    if (t.state === 'branch' || (t.state === 'charred' && t.fuel > 0.03)) out.push('Hold <kbd>F</kbd> strike the tinderbox to light it');
    if (t.state === 'charred' && t.fuel <= 0.03 && tree) out.push('<kbd>F</kbd> break off a fresh branch');
    if (t.state === 'lit') out.push(this.horses.mounted ? 'Ride into water to put the torch out' : 'Hold <kbd>C</kbd> + <kbd>F</kbd> grind it into the earth, or plunge it in water');
    if (t.held) out.push('<kbd>Q</kbd> drop the branch');
    return out;
  }

  /** Branch, tinderbox, flame, water and earth. */
  private torchControl(dt: number) {
    const t = this.torch, input = this.input, a = this.audio;
    // Reaching up to snap a branch.
    if (this.reachT > 0) {
      this.reachT -= dt;
      this.hands.reach = Math.min(1, Math.sin(Math.max(0, this.reachT) / 0.7 * Math.PI) * 1.4);
      if (this.reachT <= 0.3 && t.state !== 'branch' && this.reachT + dt > 0.3) {
        t.state = 'branch'; t.fuel = 1;
        a.crack();
        this.hud.message('You snap a dry branch off the tree.', 5000);
      }
      if (this.reachT <= 0) this.hands.reach = 0;
    } else if (input.hit('KeyF')) {
      const tree = this.treeInReach();
      if ((!t.held || (t.state === 'charred' && t.fuel <= 0.03)) && tree && !this.horses.mounted) this.reachT = 0.7;
      else if (!t.held && !tree) this.hud.message('There is no tree within reach.', 3000);
    }
    if (input.hit('KeyQ') && t.held) {
      t.state = 'none';
      this.hud.message(t.uFlameOn ? 'You throw the torch down.' : 'You drop the branch.', 3000);
    }
    const holdF = input.down('KeyF');
    const crouch = input.down('KeyC') || input.down('ControlLeft');
    if ((t.state === 'branch' || (t.state === 'charred' && t.fuel > 0.03)) && holdF && this.reachT <= 0) {
      t.progress += dt / 1.8;
      this.strikeT -= dt;
      if (this.strikeT <= 0) { a.strike(); this.strikeT = 0.28 + Math.random() * 0.15; }
      if (t.progress >= 1) { t.state = 'lit'; t.progress = 0; a.ignite(); this.hud.message('The branch catches. The torch is lit.', 4000); }
    } else if (t.state === 'lit' && holdF && crouch && !this.horses.mounted && this.player.grounded) {
      t.progress += dt / 2.2;
      if (t.progress >= 1) { t.state = 'charred'; t.progress = 0; a.hiss(false); this.hud.message('You grind the burning end into the earth until it dies.', 5000); }
    } else t.progress = Math.max(0, t.progress - dt * 2);
    this.hands.holding = t.held ? 'torch' : 'none';
    t.update(dt);
    // Water puts it out.
    if (t.state === 'lit' && (t.tip.y < WATER_LEVEL + 0.02 || this.player.swimming)) {
      t.state = 'charred'; a.hiss(true);
      this.hud.message('The torch hisses out in the water.', 4000);
    }
    a.setFire(t.state === 'lit' ? Math.min(1, 0.4 + t.fuel) : 0);
    this.ui.progressRing(t.progress);
  }

  /** Extra contextual actions (torch, climbing) contributed by other systems. */
  extraActions: () => string[] = () => [];

  private mountHorse(h: import('../world/Horses').Horse) {
    this.player.setActive(false);
    this.horses.mount(h);
    this.hands.riding = true;
    // Face the way the horse faces.
    this.player.yaw = h.yaw;
    this.player.pitch = Math.min(this.player.pitch, -0.12);
  }

  /** Used by the opening film to keep the world (terrain, grass, trees, sky) updating. */
  cineWorldUpdate(dt: number) { this.updateWorld(dt); }

  save() {
    if (!this.player) return;
    const p = this.player;
    const d: SaveData = {
      v: 1, chapter: this.chapter, x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, pitch: p.pitch,
      hour: this.sky.hour,
      flags: this.horses?.mounted ? { riding: this.horses.mounted.name, horseYaw: this.horses.mounted.yaw } : {},
      savedAt: Date.now(), playSeconds: Math.round(this.playSeconds),
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
    const dc = this.params.get('cam');
    if (dc) {
      // Debug: a free camera for test shots (?cam=x,y,z&look=x,y,z).
      const [x, y, z] = dc.split(',').map(Number);
      const [lx, ly, lz] = (this.params.get('look') ?? '900,60,-700').split(',').map(Number);
      this.camera.position.set(x, y, z);
      this.camera.lookAt(lx, ly, lz);
      this.hands.rig.visible = false;
    }
    const cam = this.camera.position;
    this.terrain.update(cam);
    this.grass.update(this.camera);
    this.camera.updateMatrixWorld();
    this.trees.update(this.camera);
    this.rocks.update(cam);
    updateCamAxes(this.camera);
    this.sky.update(dt, this.renderer, cam);
    this.emberhold.update(dt, this.sky.uNight.value as number);
    this.quillhaven.update(dt, this.sky.uNight.value as number);
    if (this.horses) {
      const ridden = this.horses.mounted;
      this.horses.update(dt, this.clock.getElapsed(), cam, (h, leg) => {
        const d = Math.hypot(h.x - cam.x, h.z - cam.z);
        const road = roadAt(h.x, h.z) > 0.4 || settlementAt(h.x, h.z) > 0.5;
        const surf = h.y < WATER_LEVEL + 0.1 ? 'water' : road ? 'rock' : 'grass';
        const pace = Math.min(1, 0.35 + Math.abs(h.speed) / 10);
        this.audio.hoof(surf, (h === ridden ? 0.75 : 1 / (1 + d * 0.15)) * pace, h === ridden ? (leg % 2 ? -0.25 : 0.25) : 0);
      });
    }
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
      const horses = this.horses;
      if (horses.mounted) {
        const h = horses.mounted;
        const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
        const r = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
        const yaw0 = h.yaw;
        horses.ride(dt, {
          f, r, run: input.down('ShiftLeft') || input.down('ShiftRight'),
          walk: input.down('ControlLeft') || input.down('KeyC'), jump: input.hit('Space'),
        }, this.eye);
        this.player.rideLook(dt, input, this.settings, this.eye, h.yaw - yaw0, Math.abs(h.speed), h.y);
        this.hands.riding = true;
        this.hands.rideBob = h.model.body.position.y - 1.22;
        this.ui.prompt(Math.abs(h.speed) < 0.3 ? `<kbd>E</kbd> Dismount` : null);
        if (input.hit('KeyE') && Math.abs(h.speed) < 2.6) {
          const p = horses.dismount();
          this.player.setActive(true);
          this.player.setPose(p.x, p.y, p.z, this.player.yaw, this.player.pitch);
          this.hands.riding = false;
        }
      } else {
        const ev = this.player.update(dt, input, this.settings);
        this.hands.reach = Math.max(this.hands.reach * (this.reachT > 0 ? 1 : 0), this.player.climbReach);
        if (ev.footstep) this.audio.footstep(ev.footstep.surface, ev.footstep.intensity);
        if (ev.landed) this.audio.landed(ev.landed, this.player.surface);
        const look = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
        const near = horses.nearest(this.player.feet, look);
        this.ui.prompt(near ? `<kbd>E</kbd> Ride${near.name === 'Ashfoot' ? ' Ashfoot' : ''}` : null);
        if (near && input.hit('KeyE')) this.mountHorse(near);
      }
      if (input.hit('KeyM')) this.hud.toggleMap();
      this.torchControl(dt);
      this.guide(dt);
      this.physics.stream(this.player.feet);
      this.hands.visible = this.settings.showHands;
      this.hands.update(dt, this.player, input.mouseDX, input.mouseDY);
      if (horses.mounted) {
        this.hands.grips(this.grips);
        if (this.torch.held) this.grips[0].copy(this.grips[1]); // both reins in the left hand
        horses.updateReins(this.grips);
      }
      this.physics.step();
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
