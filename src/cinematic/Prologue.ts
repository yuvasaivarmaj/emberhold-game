// The opening film: Aethryn, the founder's choice, the crossing, and the night a star
// fell out of Scorpius onto the Verdance. Rendered live in the engine, narrated and subtitled.
import * as THREE from 'three/webgpu';
import { pass, renderOutput, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { SpaceScene } from './SpaceScene';
import { Narrator } from './Narrator';
import { Music } from './Music';
import { uBuilt } from '../world/TerrainShading';
import { Fireball, Plume, ScorpiusLines, makeWreck, makeScorch, updateCamAxes, ANTARES } from './Effects';
import type { Game } from '../core/Game';
import { EMBERHOLD_SITE, SPAWN } from '../world/WorldConfig';

interface Shot {
  space: boolean;
  lines: string[];
  minDur: number;
  setup?: () => void;
  update: (t: number, dt: number) => void;
}

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class Prologue {
  private space = new SpaceScene();
  private spacePipe!: THREE.RenderPipeline;
  private narrator = new Narrator();
  private music: Music | null = null;
  private shots: Shot[] = [];
  private index = -1;
  private t = 0;
  private linesDone = false;
  private running = false;
  private skipHeld = 0;
  private fireball = new Fireball();
  private plume = new Plume();
  private lines = new ScorpiusLines();
  private wreck: THREE.Group | null = null;
  private scorch: THREE.Mesh | null = null;
  private shake = 0;
  private impactDone = false;
  private camTarget = new THREE.Vector3();
  private onDone: (() => void) | null = null;
  private el = {
    root: document.getElementById('cine')!,
    title: document.getElementById('cine-title')!,
    flash: document.getElementById('flash')!,
    skip: document.getElementById('skip')!,
    fill: document.getElementById('skip-fill')!,
  };

  constructor(private game: Game) {}

  async init() {
    await this.space.init();
    const g = this.game;
    this.spacePipe = new THREE.RenderPipeline(g.renderer);
    const sp = pass(this.space.scene, this.space.camera);
    const col = sp.getTextureNode('output');
    this.spacePipe.outputColorTransform = false;
    this.spacePipe.outputNode = vec4(renderOutput(col.add(bloom(col, 0.9, 0.6, 0.55))).rgb, 1.0);
    this.buildShots();
  }

  play(onDone: () => void) {
    const g = this.game;
    this.onDone = onDone;
    this.running = true;
    this.index = -1;
    this.impactDone = false;
    this.fireball.reset();
    g.hands.visible = false;
    g.hands.rig.visible = false;
    // The night of the fall came long before anyone built on the hill.
    this.setBuilt(false);
    g.scene.add(this.fireball.group, this.plume.group, this.lines.mesh);
    const site = new THREE.Vector3(EMBERHOLD_SITE.x, g.hf.height(EMBERHOLD_SITE.x, EMBERHOLD_SITE.z), EMBERHOLD_SITE.z);
    this.wreck = makeWreck(g.hf, site);
    this.scorch = makeScorch(g.hf, site, 150);
    this.wreck.visible = false;
    this.scorch.visible = false;
    g.scene.add(this.wreck, this.scorch);
    this.el.root.hidden = false;
    this.el.title.classList.remove('show');
    if (g.audio.ctx) {
      g.audio.setAmbience(0, 0.5);
      this.music = new Music(g.audio.ctx, g.audio.master);
      this.music.start();
    }
    this.narrator.volume = g.settings.volume;
    this.next();
  }

  private next() {
    this.index++;
    if (this.index >= this.shots.length) { this.finish(); return; }
    const s = this.shots[this.index];
    this.t = 0;
    this.linesDone = s.lines.length === 0;
    s.setup?.();
    const runLines = async () => {
      for (const line of s.lines) {
        if (!this.running) return;
        await this.narrator.say(line);
      }
      this.linesDone = true;
    };
    if (s.lines.length) runLines();
  }

  /** Called every frame while the film plays. Returns false once it has ended. */
  update(dt: number): boolean {
    if (!this.running) return false;
    const g = this.game;
    // Hold Space (or Escape) to skip.
    const holding = g.input.down('Space') || g.input.down('Escape') || g.input.down('Enter');
    this.skipHeld = holding ? this.skipHeld + dt : Math.max(0, this.skipHeld - dt * 2);
    this.el.fill.style.width = `${Math.min(100, (this.skipHeld / 1.2) * 100)}%`;
    this.el.skip.classList.toggle('active', this.skipHeld > 0.05);
    if (this.skipHeld > 1.2) { this.finish(); return false; }

    const s = this.shots[this.index];
    this.t += dt;
    s.update(this.t, dt);
    if (this.linesDone && this.t >= s.minDur) this.next();
    if (!this.running) return false;

    if (s.space) {
      this.space.camera.aspect = g.camera.aspect;
      this.space.camera.updateProjectionMatrix();
      this.space.update(g.renderer.domElement.height);
      this.spacePipe.render();
    } else {
      if (this.shake > 0) {
        g.camera.position.add(v3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
        this.shake *= Math.exp(-2.5 * dt);
      }
      g.camera.updateMatrixWorld();
      updateCamAxes(g.camera);
      g.cineWorldUpdate(dt);
      this.lines.update(g.camera.position, g.sky.rot, this.linesOpacity);
      g.pipeline.render();
    }
    return true;
  }

  private linesOpacity = 0;

  /** Test helper: jump to a shot and time and draw one frame. */
  async debugRender(index: number, t: number) {
    this.play(() => {});
    this.narrator.enabled = false;
    for (let i = 0; i <= index; i++) { this.index = i; this.shots[i].setup?.(); }
    const s = this.shots[index];
    const steps = Math.max(1, Math.round(t * 10));
    for (let k = 1; k <= steps; k++) s.update((k / steps) * t, t / steps);
    this.t = t;
    for (let f = 0; f < 2; f++) {
      const g = this.game;
      if (s.space) {
        this.space.camera.aspect = g.camera.aspect; this.space.camera.updateProjectionMatrix();
        this.space.update(g.renderer.domElement.height);
        this.spacePipe.render();
      } else {
        g.camera.updateMatrixWorld(); updateCamAxes(g.camera); g.cineWorldUpdate(0.016);
        this.lines.update(g.camera.position, g.sky.rot, this.linesOpacity);
        g.pipeline.render();
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  /** Show or hide everything people built later: Emberhold, Quillhaven, bridges, horses. */
  private setBuilt(on: boolean) {
    const g = this.game;
    for (const o of [g.emberhold?.group, g.structures?.group, g.quillhaven?.group, g.horses?.group]) if (o) o.visible = on;
    uBuilt.value = on ? 1 : 0;
  }

  private finish() {
    if (!this.running) return;
    this.running = false;
    const g = this.game;
    this.narrator.stop();
    this.music?.fadeOut(3);
    g.audio.setAmbience(1, 3);
    for (const o of [this.fireball.group, this.plume.group, this.lines.mesh, this.wreck!, this.scorch!]) g.scene.remove(o);
    this.setBuilt(true);
    g.sky.stars && (g.sky.stars.uScorpio.value = 0);
    this.el.root.hidden = true;
    this.el.title.classList.remove('show');
    this.el.flash.style.transition = 'opacity 1.5s';
    this.el.flash.style.opacity = '0';
    setTimeout(() => { this.el.flash.style.background = '#fff'; }, 1600);
    this.onDone?.();
  }

  // ---------------------------------------------------------------------------------
  private buildShots() {
    const g = this.game;
    const sp = this.space;
    const cam = sp.camera;
    const look = (p: THREE.Vector3) => cam.lookAt(p);
    const R = 1000;
    const sunDir = sp.sunDir.value as THREE.Vector3;
    sunDir.set(1, 0.18, 0.35).normalize();
    const nightPoint = sunDir.clone().negate().add(v3(0, 0.25, 0.4)).normalize();

    // World-shot helpers
    const viewer = () => v3(SPAWN.x, g.hf.height(SPAWN.x, SPAWN.z) + 1.7, SPAWN.z);
    const site = () => v3(EMBERHOLD_SITE.x, g.hf.height(EMBERHOLD_SITE.x, EMBERHOLD_SITE.z), EMBERHOLD_SITE.z);
    const antaresDir = () => ANTARES.clone().applyMatrix3(g.sky.rot).normalize();
    const lerpV = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
    let fallStart = new THREE.Vector3(), fallCtrl = new THREE.Vector3(), fallEnd = new THREE.Vector3();
    const bez = (t: number) => {
      const a = fallStart.clone().multiplyScalar((1 - t) * (1 - t));
      return a.add(fallCtrl.clone().multiplyScalar(2 * (1 - t) * t)).add(fallEnd.clone().multiplyScalar(t * t));
    };
    const worldNight = () => {
      g.sky.setHour(20.85);
      g.sky.timeScale = 0;
      g.audio.setAmbience(0.6, 3);
    };

    this.shots = [
      // 1. Stars
      {
        space: true, minDur: 9,
        lines: ['Before the first kings of Kaldmere, before the first songs were sung on this earth, another world burned among the stars.'],
        setup: () => { sp.aethryn.visible = true; sp.earth.visible = false; sp.ships.forEach((s) => (s.visible = false)); g.renderer.toneMappingExposure = 1.0; },
        update: (t) => {
          const k = ease(clamp01(t / 12));
          cam.position.set(9000 - 2500 * k, 2600, 16000 - 4000 * k);
          look(lerpV(v3(-30000, 22000, -40000), v3(0, 0, 0), ease(clamp01((t - 2) / 10))));
        },
      },
      // 2. Aethryn
      {
        space: true, minDur: 10,
        lines: ['Aethryn. A world of towers and furnaces, where sorcery was bent into craft, and even the beasts breathed fire.'],
        update: (t) => {
          const k = ease(clamp01(t / 14));
          cam.position.copy(lerpV(v3(4200, 900, 4600), v3(2300, 420, 2600), k));
          look(v3(-350 * (1 - k), 0, 0));
          sp.aethryn.rotation.y = t * 0.01;
        },
      },
      // 3. Night side, forge cities
      {
        space: true, minDur: 10,
        lines: ['Its great houses ruled from the sky. House Vaelaros ruled nothing. They were smiths, rich in ore, in secrets, and in pride.'],
        update: (t) => {
          const k = ease(clamp01(t / 14));
          const p = nightPoint.clone().multiplyScalar(R * (2.4 - 0.6 * k)).add(v3(400 * (1 - k), 300, 0));
          cam.position.copy(p);
          look(v3(0, -150, 0));
          sp.aethryn.rotation.y = 0.12 + t * 0.008;
        },
      },
      // 4. The founder
      {
        space: true, minDur: 11,
        lines: ['Aeryon Vaelaros looked upon its splendour and saw not greatness, but appetite. So while others built higher, he sold half of all he owned.'],
        update: (t) => {
          const k = ease(clamp01(t / 15));
          const limb = nightPoint.clone().lerp(sunDir, 0.45).normalize();
          cam.position.copy(limb.clone().multiplyScalar(R * 1.25)).add(v3(0, 260 - 60 * k, 0));
          look(limb.clone().multiplyScalar(R * 0.2).add(sunDir.clone().multiplyScalar(2000 * k)));
          sp.aethryn.rotation.y = 0.25 + t * 0.006;
        },
      },
      // 5. Departure
      {
        space: true, minDur: 12,
        lines: ['He gathered his kin, his craftsmen, his sealed ledgers, and the red ore of the deep forges. Emberite. And he left.'],
        setup: () => sp.ships.forEach((s) => (s.visible = true)),
        update: (t) => {
          const base = nightPoint.clone().lerp(sunDir, 0.25).normalize();
          sp.ships.forEach((s, i) => {
            const off = v3(Math.sin(i * 2.3) * 0.08, Math.cos(i * 1.7) * 0.06, Math.sin(i * 3.1) * 0.07);
            const n = base.clone().add(off).normalize();
            const tt = Math.max(0, t - i * 0.9);
            const h = R + 15 + 18 * tt * tt;
            s.position.copy(n.clone().multiplyScalar(h));
            s.lookAt(s.position.clone().sub(n));
          });
          const lead = sp.ships[0].position;
          cam.position.copy(lead.clone().add(base.clone().cross(v3(0, 1, 0)).normalize().multiplyScalar(180)).add(base.clone().multiplyScalar(-60)));
          look(lead.clone().add(base.clone().multiplyScalar(80)));
        },
      },
      // 6. The crossing
      {
        space: true, minDur: 8,
        lines: ['They crossed the dark for longer than any of them would live to remember.'],
        setup: () => { sp.aethryn.visible = false; },
        update: (t) => {
          const dir = v3(0, 0, -1);
          sp.ships.forEach((s, i) => {
            s.position.set(Math.sin(i * 2.1) * 140, Math.cos(i * 1.3) * 60, -i * 120 - t * 200);
            s.lookAt(s.position.clone().sub(dir));
          });
          cam.position.set(260, 70, 220 - t * 200);
          look(v3(0, 0, -200 - t * 200));
        },
      },
      // 7. Earth
      {
        space: true, minDur: 9,
        lines: ['Their road ended at a young blue world, far from any empire.'],
        setup: () => {
          sp.earth.visible = true;
          sp.earth.position.set(0, -500, -6500);
          sunDir.set(0.7, 0.35, 0.6).normalize();
        },
        update: (t) => {
          const k = ease(clamp01(t / 12));
          sp.ships.forEach((s, i) => {
            s.position.set(Math.sin(i * 2.1) * 140, Math.cos(i * 1.3) * 60 - 40 * k, -300 - i * 120 - t * 260);
            s.lookAt(s.position.clone().add(v3(0, 0, 1)));
            s.scale.setScalar((i === 0 ? 1 : 0.75) * (1 - k * 0.3));
          });
          cam.position.set(120, 140 - 60 * k, 600 - 900 * k);
          look(sp.earth.position.clone().add(v3(0, 250, 0)));
          sp.earth.rotation.y = t * 0.01;
        },
      },
      // 8. The Verdance, ancient night: Scorpius
      {
        space: false, minDur: 9,
        lines: ['On a summer night, the people of the green country looked south, to the stars they called the Scorpion.'],
        setup: () => {
          sp.ships.forEach((s) => (s.visible = false));
          worldNight();
          g.camera.fov = 52; g.camera.updateProjectionMatrix();
        },
        update: (t) => {
          const v = viewer();
          g.camera.position.copy(v);
          const a = antaresDir();
          const ground = v.clone().add(v3(a.x, 0.0, a.z).normalize().multiplyScalar(100)).add(v3(0, -8, 0));
          this.camTarget.copy(lerpV(ground, v.clone().add(a.clone().multiplyScalar(100)).add(v3(0, 14, 0)), ease(clamp01((t - 1) / 7))));
          g.camera.lookAt(this.camTarget);
          this.linesOpacity = ease(clamp01((t - 4) / 4));
          if (g.sky.stars) g.sky.stars.uScorpio.value = this.linesOpacity * 0.6;
        },
      },
      // 9. A new star
      {
        space: false, minDur: 6,
        lines: ['A new star rose from the Scorpion’s heart.'],
        setup: () => {
          const v = viewer();
          const a = antaresDir();
          fallStart = v.clone().add(a.clone().multiplyScalar(5200)).add(v3(0, 60, 0));
          fallEnd = site().add(v3(0, 4, 0));
          fallCtrl = v.clone().add(v3(a.x, 0, a.z).normalize().multiplyScalar(500)).add(v3(0, 1100, 0));
          this.fireball.reset();
        },
        update: (t) => {
          const v = viewer();
          g.camera.position.copy(v);
          g.camera.lookAt(this.camTarget);
          const zoom = ease(clamp01(t / 6));
          g.camera.fov = 52 - 14 * zoom; g.camera.updateProjectionMatrix();
          this.fireball.update(fallStart, 0.02 + 0.12 * ease(clamp01(t / 6)));
        },
      },
      // 10. The fall
      {
        space: false, minDur: 8.5,
        lines: ['And then it fell.'],
        setup: () => { this.music?.roar(7.2); },
        update: (t, dt) => {
          const v = viewer();
          g.camera.position.copy(v);
          const k = clamp01(t / 7.2);
          const head = bez(Math.pow(k, 1.6));
          this.linesOpacity = Math.max(0, this.linesOpacity - dt * 0.4);
          if (k < 1) {
            this.fireball.update(head, 0.15 + 0.85 * ease(clamp01(k * 1.4)));
            this.camTarget.lerp(head, 1 - Math.exp(-3.2 * dt));
            this.shake = Math.max(this.shake, 0.04 * k);
          } else if (!this.impactDone) {
            this.impactDone = true;
            this.fireball.update(head, 0);
            this.music?.impact();
            this.shake = 1.6;
            this.el.flash.style.transition = 'none';
            this.el.flash.style.opacity = '0.95';
            requestAnimationFrame(() => { this.el.flash.style.transition = 'opacity 2.6s ease-out'; this.el.flash.style.opacity = '0'; });
            this.plume.set(fallEnd, 1);
          } else {
            this.camTarget.lerp(fallEnd.clone().add(v3(0, 60, 0)), 1 - Math.exp(-1.5 * dt));
          }
          g.camera.fov = 38 + 26 * ease(clamp01(t / 6)); g.camera.updateProjectionMatrix();
          g.camera.lookAt(this.camTarget);
        },
      },
      // 11. Afterglow
      {
        space: false, minDur: 7,
        lines: ['They would call it the night the Scorpion bled.'],
        update: (t) => {
          const v = viewer();
          const toSite = fallEnd.clone().sub(v).setY(0).normalize();
          g.camera.position.copy(v.clone().add(toSite.clone().multiplyScalar(t * 2.2)));
          this.camTarget.lerp(fallEnd.clone().add(v3(0, 80, 0)), 0.05);
          g.camera.lookAt(this.camTarget);
          this.plume.set(fallEnd, 1);
        },
      },
      // 12. Dawn at the crash
      {
        space: false, minDur: 10,
        lines: ['Those who lived buried their broken ship. Over its burning heart, they raised their first forge.'],
        setup: () => {
          g.sky.setHour(6.05);
          this.wreck!.visible = true;
          this.scorch!.visible = true;
          g.camera.fov = 55; g.camera.updateProjectionMatrix();
          g.audio.setAmbience(0.8, 2);
        },
        update: (t) => {
          const s = site();
          const a = -0.9 + t * 0.035;
          const r = 230 - t * 6;
          const p = v3(s.x + Math.cos(a) * r, 0, s.z + Math.sin(a) * r);
          p.y = Math.max(g.hf.height(p.x, p.z) + 3, s.y + 6 + 18 * (1 - t / 12));
          g.camera.position.copy(p);
          g.camera.lookAt(s.clone().add(v3(0, 10, 0)));
          this.plume.set(s, 0.55);
        },
      },
      // 13. The house
      {
        space: false, minDur: 11,
        lines: ['Around that forge a house would grow, with a law older than crowns.', 'The blood must not leave the blood.'],
        update: (t) => {
          const s = site();
          const k = ease(clamp01(t / 12));
          const p = v3(s.x - 320 + 120 * k, s.y + 40 + 170 * k, s.z + 260 - 60 * k);
          g.camera.position.copy(p);
          g.camera.lookAt(s.clone().add(v3(0, 0, -120 * k)));
          this.plume.set(s, 0.5);
        },
      },
      // 14. Title
      {
        space: false, minDur: 8,
        lines: [],
        setup: () => {
          this.el.title.innerHTML = '<div class="t1">The Blood of Emberhold</div><div class="t2">Part One · What the Blood Remembers</div>';
          this.el.title.classList.add('show');
        },
        update: (t) => {
          const s = site();
          g.camera.position.copy(v3(s.x - 200, s.y + 210 + t * 4, s.z + 200));
          g.camera.lookAt(s.clone().add(v3(0, 0, -120)));
          this.plume.set(s, 0.5);
          this.el.title.style.opacity = String(clamp01(t / 2) * clamp01((8 - t) / 1.5));
        },
      },
      // 15. Many generations later
      {
        space: false, minDur: 4.5,
        lines: [],
        setup: () => {
          this.el.title.innerHTML = '<div class="t2">Many generations later…</div>';
          this.el.title.style.opacity = '1';
          this.el.flash.style.transition = 'opacity 1.5s';
          this.el.flash.style.background = '#000';
          this.el.flash.style.opacity = '1';
          this.wreck!.visible = false;
          this.scorch!.visible = false;
          this.plume.set(site(), 0);
        },
        update: (t) => { this.el.title.style.opacity = String(clamp01(t / 1.0) * clamp01((4.5 - t) / 1.0)); },
      },
    ];
  }
}
