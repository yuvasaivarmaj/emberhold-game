// The opening film, told in ink-and-wash sketches with narration: Aethryn and its
// fire-hounds, the house of smiths and their blood-bound ore, the Doom, the flight of
// the houses, the dark that took them, the one ship that reached the young blue world
// and fell out of Scorpius, the first forge, and the other ship that drifted in
// centuries late, whose beasts grew wings under the new sun.
import { Narrator } from './Narrator';
import { Music } from './Music';
import { Ink, paper, W, H, C, type Pt } from './Sketch';
import type { Game } from '../core/Game';

interface Panel {
  lines: string[];
  minDur: number;
  /** Static drawing, made once. */
  bake: (k: Ink) => void;
  /** Living details drawn every frame on top (t = seconds into the panel). */
  anim?: (k: Ink, t: number) => void;
  /** Slow camera drift: start and end zoom and offset. */
  move?: [number, number, number, number, number, number];
  onStart?: (film: Prologue) => void;
  dark?: boolean;
}

const SCORPIUS: Pt[] = [[1020, 180], [1050, 215], [1060, 262], [1050, 215], [985, 296], [955, 322], [925, 352], [900, 412], [880, 472], [870, 532], [890, 586], [930, 616], [975, 620], [996, 600], [1011, 580]];

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class Prologue {
  private narrator = new Narrator();
  private music: Music | null = null;
  private panels: Panel[] = [];
  private bakes: (HTMLCanvasElement | null)[] = [];
  private index = -1;
  private t = 0;
  private linesDone = false;
  private running = false;
  private skipHeld = 0;
  private prev: { canvas: HTMLCanvasElement; t: number; panel: Panel } | null = null;
  private onDone: (() => void) | null = null;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private shake = 0;
  private el = {
    root: document.getElementById('cine')!,
    title: document.getElementById('cine-title')!,
    flash: document.getElementById('flash')!,
    skip: document.getElementById('skip')!,
    fill: document.getElementById('skip-fill')!,
  };

  constructor(private game: Game) {
    this.cv = document.getElementById('sketch') as HTMLCanvasElement;
    this.ctx = this.cv.getContext('2d')!;
    this.layer.width = W; this.layer.height = H;
  }

  async init() {
    this.buildPanels();
    this.bakes = this.panels.map(() => null);
  }

  private bake(i: number) {
    if (this.bakes[i]) return this.bakes[i]!;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;
    c.drawImage(paper(), 0, 0);
    this.panels[i].bake(new Ink(c, 100 + i * 17));
    this.bakes[i] = cv;
    return cv;
  }

  play(onDone: () => void) {
    const g = this.game;
    this.onDone = onDone;
    this.running = true;
    this.index = -1;
    this.prev = null;
    g.hands.visible = false;
    g.hands.rig.visible = false;
    this.el.root.hidden = false;
    this.cv.hidden = false;
    this.el.title.classList.remove('show');
    this.el.title.innerHTML = '';
    if (g.audio.ctx) {
      g.audio.setAmbience(0, 0.5);
      this.music = new Music(g.audio.ctx, g.audio.master);
      this.music.start();
    }
    this.narrator.volume = g.settings.volume;
    this.bake(0);
    this.next();
  }

  get musicNode() { return this.music; }
  set shakeAmount(v: number) { this.shake = v; }
  showTitle(t1: string, t2: string) {
    this.el.title.innerHTML = `<div class="t1">${t1}</div><div class="t2">${t2}</div>`;
    this.el.title.classList.add('show');
  }

  private next() {
    if (this.index >= 0) this.prev = { canvas: this.bakes[this.index]!, t: this.t, panel: this.panels[this.index] };
    this.index++;
    if (this.index >= this.panels.length) { this.finish(); return; }
    const p = this.panels[this.index];
    this.bake(this.index);
    // Draw the next one ahead, while this one plays.
    setTimeout(() => { if (this.index + 1 < this.panels.length) this.bake(this.index + 1); }, 400);
    this.t = 0;
    this.linesDone = p.lines.length === 0;
    p.onStart?.(this);
    const runLines = async () => {
      for (const line of p.lines) {
        if (!this.running) return;
        await this.narrator.say(line);
      }
      this.linesDone = true;
    };
    if (p.lines.length) runLines();
  }

  /** Called every frame while the film plays. */
  update(dt: number): boolean {
    if (!this.running) return false;
    const g = this.game;
    const holding = g.input.down('Space') || g.input.down('Escape') || g.input.down('Enter');
    this.skipHeld = holding ? this.skipHeld + dt : Math.max(0, this.skipHeld - dt * 2);
    this.el.fill.style.width = `${Math.min(100, (this.skipHeld / 1.2) * 100)}%`;
    this.el.skip.classList.toggle('active', this.skipHeld > 0.05);
    if (this.skipHeld > 1.2) { this.finish(); return false; }
    this.t += dt;
    const p = this.panels[this.index];
    if (this.linesDone && this.t >= p.minDur) this.next();
    if (!this.running) return false;
    this.draw();
    return true;
  }

  /** Paint the current panel (and the last one fading out). */
  private draw() {
    const cv = this.cv;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const c = this.ctx;
    c.fillStyle = '#0c0907'; c.fillRect(0, 0, w, h);
    const fade = clamp01(this.t / 1.6);
    if (this.prev && fade < 1) this.paint(this.prev.canvas, this.prev.panel, this.prev.t + this.t, 1);
    this.paint(this.bakes[this.index]!, this.panels[this.index], this.t, this.prev ? ease(fade) : clamp01(this.t / 1.2));
    this.shake *= 0.94;
  }

  private paint(bake: HTMLCanvasElement, p: Panel, t: number, alpha: number) {
    const c = this.ctx, cw = this.cv.width, ch = this.cv.height;
    // Fit the 16:9 sheet to cover the screen, then drift slowly.
    const m = p.move ?? [1.0, 1.06, 0, 0, -20, -8];
    const u = ease(clamp01(t / Math.max(8, p.minDur + 4)));
    const zoom = m[0] + (m[1] - m[0]) * u;
    const ox = m[2] + (m[4] - m[2]) * u, oy = m[3] + (m[5] - m[3]) * u;
    const s = Math.max(cw / W, ch / H) * zoom;
    // Draw the living details into a layer the size of the sheet, then place it.
    const L = this.layer.getContext('2d')!;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, W, H);
    L.drawImage(bake, 0, 0);
    if (p.anim) p.anim(new Ink(L, 999 + Math.floor(t * 12)), t);
    c.save();
    c.globalAlpha = alpha;
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    c.translate(cw / 2 + ox * s / zoom + sx, ch / 2 + oy * s / zoom + sy);
    c.scale(s, s);
    c.drawImage(this.layer, -W / 2, -H / 2);
    c.restore();
  }

  /** Test helper: draw one panel at a moment. */
  async debugRender(index: number, t: number) {
    this.buildPanels();
    this.bakes = this.panels.map(() => null);
    this.el.root.hidden = false;
    this.cv.hidden = false;
    this.narrator.enabled = false;
    this.index = Math.min(index, this.panels.length - 1);
    this.bake(this.index);
    this.t = t;
    this.panels[this.index].onStart?.(this);
    const sub = document.getElementById('subtitle')!;
    sub.textContent = this.panels[this.index].lines[0] ?? '';
    sub.classList.toggle('show', !!sub.textContent);
    this.shake = 0;
    this.draw();
    await new Promise((r) => requestAnimationFrame(r));
  }

  private finish() {
    if (!this.running) return;
    this.running = false;
    const g = this.game;
    this.narrator.stop();
    this.music?.fadeOut(3);
    g.audio.setAmbience(1, 3);
    this.el.root.hidden = true;
    this.cv.hidden = true;
    this.el.title.classList.remove('show');
    this.bakes = this.panels.map(() => null); // free the drawings
    this.onDone?.();
  }

  // ---------------------------------------------------------------------------------
  private buildPanels() {
    const P: Panel[] = [];

    // 1. A burning world among the stars.
    P.push({
      lines: ['Before the first kings of Kaldmere, before the first songs were sung on this earth, another world burned among the stars.'],
      minDur: 7, dark: true, move: [1.08, 1.0, 0, 0, 0, 0],
      bake: (k) => {
        k.fill(C.night, 0.92);
        k.wash(500, 300, 520, 260, '#5a3050', 0.28, 7, 'screen');
        k.wash(1150, 600, 500, 300, '#2c4466', 0.3, 7, 'screen');
        k.stars(520, H, 1);
        // Aethryn, far off, its night side lit by fires.
        const c = k.c;
        c.save();
        const g = c.createRadialGradient(1120, 330, 10, 1120, 330, 120);
        g.addColorStop(0, '#c9763c'); g.addColorStop(0.7, '#6a2d17'); g.addColorStop(1, '#2a120a');
        c.fillStyle = g; c.beginPath(); c.arc(1120, 330, 110, 0, Math.PI * 2); c.fill();
        c.restore();
        k.hatch(circle(1150, 345, 106), 0.6, 4, 1, 0.35, '#120806');
        k.line(circle(1120, 330, 111), 2, '#e3a066', 0.6);
      },
      anim: (k, t) => {
        const c = k.c;
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 12; i++) {
          const a = i * 0.9 + 0.4, r = 40 + (i % 4) * 18;
          const x = 1105 + Math.cos(a) * r * 0.8, y = 335 + Math.sin(a) * r * 0.6;
          c.fillStyle = `rgba(255,150,70,${0.35 + 0.3 * Math.sin(t * 2 + i)})`;
          c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
        }
        c.restore();
      },
    });

    // 2. Aethryn: towers and furnaces.
    P.push({
      lines: ['Aethryn. A world of towers and furnaces, where sorcery was bent into craft.'],
      minDur: 6, move: [1.0, 1.08, -40, 10, 40, -10],
      bake: (k) => {
        k.gradient([[0, '#7a3b22'], [0.55, '#d08a4d'], [1, '#e9dcc1']], 0, H, 'multiply', 0.75);
        k.ridge(560, 90, 0.004, '#8a6a52', C.sepia, 1.2);
        for (let i = 0; i < 18; i++) {
          const x = 120 + i * 80 + k.rnd(-25, 25), h = k.rnd(220, 470), w = k.rnd(34, 62);
          k.tower(x, 700, w, h, 0.55);
        }
        // Sky bridges between towers.
        for (let i = 0; i < 7; i++) {
          const x0 = 180 + i * 190, x1 = x0 + k.rnd(90, 170), y = k.rnd(380, 520);
          k.line([[x0, y], [(x0 + x1) / 2, y + 22], [x1, y]], 2.2, C.ink, 0.8);
        }
        // Furnace stacks along the foreground.
        for (const x of [260, 690, 1130, 1420]) {
          k.shape([[x - 30, 760], [x - 20, 600], [x + 20, 600], [x + 30, 760]], '#2b1d15', C.ink, 2);
          k.hatch([[x - 30, 760], [x - 20, 600], [x + 20, 600], [x + 30, 760]], 1.2, 5, 1, 0.4);
        }
        k.ridge(780, 30, 0.006, '#3a2a20', C.ink, 4);
        k.hatch([[0, 760], [W, 760], [W, H], [0, H]], 0.3, 7, 1, 0.3);
      },
      anim: (k, t) => {
        for (const x of [260, 690, 1130, 1420]) {
          k.smoke(x, 600, 380, t + x, '50,40,34', 0.32, 120);
          k.flame(x, 604, 30, -Math.PI / 2, t + x, 0.7);
        }
        k.embers(t, 40, 0, W, 300, 780, 50);
      },
    });

    // 3. The fire-hounds.
    P.push({
      lines: ['Even its beasts breathed fire. The great houses kept them as other worlds keep hounds.'],
      minDur: 6, move: [1.04, 1.1, 20, 0, -30, 6],
      bake: (k) => {
        k.gradient([[0, '#b76a3c'], [1, '#e9dcc1']], 0, H, 'multiply', 0.5);
        // A terrace with a balustrade, towers beyond.
        for (let i = 0; i < 8; i++) k.tower(80 + i * 210 + k.rnd(-30, 30), 520, 30, k.rnd(160, 300), 0.4, C.sepia);
        k.shape([[0, 560], [W, 560], [W, H], [0, H]], '#c9b08a', C.ink, 2, 0.8);
        for (let x = 20; x < W; x += 46) k.line([[x, 560], [x, 520]], 4, C.ink, 0.8);
        k.line([[0, 520], [W, 520]], 5, C.ink, 0.9);
        k.hatch([[0, 600], [W, 600], [W, H], [0, H]], 0.15, 9, 1, 0.25);
        // A handler holding a leash.
        k.figure(980, 800, 230, C.ink);
        k.line([[1005, 680], [1090, 700], [1150, 740]], 2, C.ink, 0.9);
        k.beast(1260, 800, 1.6, -1);
        k.beast(560, 830, 1.9, 1);
      },
      anim: (k, t) => {
        // The near beast snorts a lick of flame now and then.
        const on = Math.max(0, Math.sin(t * 1.4)) ** 3;
        if (on > 0.02) k.flame(560 + 78 * 1.9 - 4, 830 - 52 * 1.9, 120 * on, -0.15, t, on);
        k.embers(t, 14, 640, 820, 640, 760, 40);
      },
    });

    // 4. The smiths and their ore.
    P.push({
      lines: ['House Vaelaros ruled nothing. They were smiths, rich in ore and in secrets.', 'Their ore was Emberite: red stone from the deep forges, that answers to blood.'],
      minDur: 9, move: [1.1, 1.0, 0, 20, 0, 0],
      bake: (k) => {
        k.fill('#2a1a12', 0.85);
        k.wash(800, 640, 520, 260, '#d8642a', 0.45);
        // The forge mouth.
        const mouth: Pt[] = [[560, 760], [600, 470], [800, 400], [1000, 470], [1040, 760]];
        k.shape(mouth, '#1a100b', C.ink, 3);
        k.wash(800, 640, 200, 120, '#ffb060', 0.4);
        // Anvil.
        k.shape([[380, 800], [400, 720], [560, 720], [600, 700], [520, 690], [370, 700], [340, 720], [380, 740], [360, 800]], '#1e140f', C.ink, 2);
        // Ore on the bench: red crystals.
        for (let i = 0; i < 9; i++) {
          const x = 1120 + i * 34 + k.rnd(-8, 8), y = 760 + k.rnd(-6, 6), s = k.rnd(12, 24);
          k.shape([[x - s * 0.6, y], [x - s * 0.3, y - s], [x + s * 0.35, y - s * 0.8], [x + s * 0.6, y]], '#9e2f1c', C.ink, 1.5);
        }
        k.wash(1270, 740, 200, 60, '#ff6040', 0.25);
      },
      anim: (k, t) => {
        // A smith at the anvil, hammer rising and falling.
        const phase = (t * 1.1) % 1;
        const up = phase < 0.7 ? ease(phase / 0.7) : 1 - ease((phase - 0.7) / 0.3);
        k.figure(470, 880, 260, '#140c08');
        const c = k.c;
        c.save(); c.translate(500, 650); c.rotate(-1.4 * up + 0.2);
        c.strokeStyle = '#140c08'; c.lineWidth = 9; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(60, -10); c.stroke();
        c.fillStyle = '#140c08'; c.fillRect(56, -24, 22, 28);
        c.restore();
        if (phase > 0.97 || phase < 0.06) k.embers(t * 3, 30, 460, 600, 600, 720, 260, '255,200,120');
        k.embers(t, 20, 620, 980, 420, 760, 70);
        // The ore glows, as if breathing.
        k.wash(1270, 740, 200, 50, '#ff5030', 0.12 + 0.1 * Math.sin(t * 2.2));
      },
    });

    // 5. Aeryon sees appetite.
    P.push({
      lines: ['Aeryon Vaelaros looked upon its splendour and saw not greatness, but appetite.'],
      minDur: 6, move: [1.0, 1.1, 0, 0, 20, 20],
      bake: (k) => {
        k.gradient([[0, '#5a2c1c'], [0.6, '#c7834e'], [1, '#e9dcc1']], 0, H, 'multiply', 0.7);
        for (let i = 0; i < 22; i++) k.tower(60 + i * 72 + k.rnd(-20, 20), 640, k.rnd(20, 40), k.rnd(150, 380), 0.6, C.sepia);
        k.ridge(650, 18, 0.01, '#6a4a33', null, 2);
        // A balcony in the foreground.
        k.shape([[0, 740], [W, 740], [W, H], [0, H]], '#2a1c13', C.ink, 3);
        for (let x = 10; x < W; x += 40) k.line([[x, 740], [x, 690]], 5, C.ink, 0.95);
        k.line([[0, 690], [W, 690]], 8, C.ink, 1);
      },
      anim: (k, t) => {
        k.figure(1060, 760, 330, '#1a110b', Math.sin(t * 0.9) * 10, 1);
        k.embers(t, 18, 0, W, 300, 640, 30);
      },
    });

    // 6. The Doom.
    P.push({
      lines: ['Then came the Doom. The mountains split. The sky caught fire.'],
      minDur: 6, move: [1.0, 1.12, 0, 0, 0, -30],
      onStart: (f) => { f.musicNode?.impact(); f.shakeAmount = 22; },
      bake: (k) => {
        k.gradient([[0, '#3a0f08'], [0.5, '#a8321e'], [1, '#d8642a']], 0, H, 'multiply', 0.85);
        const ridge = k.ridge(520, 260, 0.0035, '#2a120c', C.ink, 3, 1);
        // Burning fissures down the mountains.
        for (let i = 0; i < 9; i++) {
          let x = 120 + i * 170 + k.rnd(-40, 40), y = 360 + k.rnd(0, 120);
          const pts: Pt[] = [[x, y]];
          for (let j = 0; j < 8; j++) { x += k.rnd(-25, 25); y += k.rnd(30, 60); pts.push([x, y]); }
          k.line(pts, 5, '#ff8a3a', 0.9, 2);
          k.line(pts, 12, '#ff5a20', 0.25, 4);
        }
        void ridge;
        // Towers toppling.
        const c = k.c;
        for (const [x, a] of [[300, 0.35], [760, -0.5], [1220, 0.6]]) {
          c.save(); c.translate(x, 760); c.rotate(a); c.translate(-x, -760);
          k.tower(x, 760, 46, 380, 0.2);
          c.restore();
        }
        k.ridge(820, 40, 0.01, '#120806', C.ink, 6);
      },
      anim: (k, t) => {
        for (const x of [380, 820, 1300]) k.smoke(x, 420, 420, t + x * 0.01, '30,14,10', 0.5, -60);
        k.embers(t, 110, 0, W, 100, 880, 120, '255,140,60');
        const c = k.c;
        c.save(); c.globalCompositeOperation = 'lighter';
        c.fillStyle = `rgba(255,90,30,${0.08 + 0.07 * Math.sin(t * 5)})`; c.fillRect(0, 0, W, H);
        c.restore();
      },
    });

    // 7. The houses flee.
    P.push({
      lines: ['Every house that could, fled. A hundred ships rose through the smoke, into the dark.'],
      minDur: 6, move: [1.0, 1.06, 0, 30, 0, -30],
      bake: (k) => {
        k.gradient([[0, '#14100f'], [0.5, '#4a1c12'], [1, '#a8321e']], 0, H, 'multiply', 0.85);
        k.stars(120, 300, 0.7);
        k.ridge(820, 60, 0.008, '#1a0c08', C.ink, 9);
      },
      anim: (k, t) => {
        for (const x of [200, 600, 1000, 1400]) k.smoke(x, 900, 700, t * 0.6 + x, '40,24,18', 0.4, 80);
        for (let i = 0; i < 16; i++) {
          const r1 = Math.sin(i * 91.7) * 0.5 + 0.5, r2 = Math.sin(i * 37.1) * 0.5 + 0.5;
          const len = 60 + r1 * 150;
          const y = 900 - ((t * (40 + r2 * 50) + r2 * 700) % 1100);
          const x = 100 + ((i * 97) % 14) * 105 + Math.sin(t * 0.3 + i) * 20;
          k.ship(x, y, len, -Math.PI / 2 + (r1 - 0.5) * 0.4, 1);
        }
      },
    });

    // 8. The dark takes them.
    P.push({
      lines: ['But the dark between the stars is wide. It took them, one by one.'],
      minDur: 7, dark: true, move: [1.05, 1.0, 0, 0, 0, 0],
      bake: (k) => {
        k.fill(C.night, 0.95);
        k.wash(800, 450, 700, 300, '#3a3060', 0.25, 7, 'screen');
        k.stars(600, H, 0.9);
      },
      anim: (k, t) => {
        // Twelve ships scattered across the dark; they wink out, one after another.
        for (let i = 0; i < 12; i++) {
          const x = 140 + ((i * 131) % 1320), y = 140 + ((i * 263) % 620);
          const gone = t > 0.6 + i * 0.5;
          const blink = t > 0.6 + i * 0.5 - 0.25 && !gone;
          if (blink) {
            const c = k.c; c.save(); c.globalCompositeOperation = 'lighter';
            const g = c.createRadialGradient(x, y, 0, x, y, 40); g.addColorStop(0, 'rgba(255,200,140,0.8)'); g.addColorStop(1, 'rgba(255,120,40,0)');
            c.fillStyle = g; c.beginPath(); c.arc(x, y, 40, 0, Math.PI * 2); c.fill(); c.restore();
          }
          if (!gone || i === 5) k.ship(x + t * 6, y, 46, 0.1 + i * 0.3, i === 5 ? 1 : 0.5, i === 5 ? 0 : 0);
        }
      },
    });

    // 9. Only one reached the blue world.
    P.push({
      lines: ['Only one ship reached a young blue world, far from any empire: the ship of House Vaelaros, heavy with kin, craftsmen, sealed ledgers, and Emberite.'],
      minDur: 9, dark: true, move: [1.0, 1.1, 0, 0, -60, 0],
      bake: (k) => {
        k.fill(C.night, 0.95);
        k.stars(400, H, 0.8);
        const c = k.c;
        // The Earth, a crescent lit from the right.
        c.save();
        const g = c.createRadialGradient(1260, 520, 40, 1160, 600, 520);
        g.addColorStop(0, '#9cc3d9'); g.addColorStop(0.5, '#4d7ea6'); g.addColorStop(1, '#0f1a2a');
        c.fillStyle = g; c.beginPath(); c.arc(1100, 640, 480, 0, Math.PI * 2); c.fill();
        c.restore();
        for (let i = 0; i < 6; i++) k.wash(1150 + k.rnd(-260, 200), 560 + k.rnd(-200, 260), k.rnd(60, 140), k.rnd(40, 90), '#4e6a36', 0.5);
        k.hatch(circle(960, 680, 470), 0.5, 5, 1.2, 0.55, '#0a1020');
        k.line(circle(1100, 640, 481), 2.4, '#b9dcea', 0.6);
      },
      anim: (k, t) => {
        const u = Math.min(1, t / 10);
        k.ship(280 + u * 420, 300 + u * 120, 170 + u * 60, 0.22, 0.9);
      },
    });

    // 10. Out of the Scorpion.
    P.push({
      lines: ['On a summer night, the people of the green country looked south, to the stars they called the Scorpion.', 'A new star rose from the Scorpion’s heart. And then it fell.'],
      minDur: 12, dark: true, move: [1.0, 1.04, 0, -10, 0, 10],
      bake: (k) => {
        k.gradient([[0, '#0d1222'], [0.7, '#1d2a3c'], [1, '#2a3040']], 0, H, 'multiply', 0.96);
        k.stars(500, 650, 0.85);
        k.line(SCORPIUS, 1.2, '#b9c4d8', 0.35, 0.5, 1);
        const c = k.c;
        for (const [x, y] of SCORPIUS) { c.fillStyle = '#eef0f6'; c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fill(); }
        k.ridge(700, 70, 0.005, '#121812', C.ink, 2);
        // Trees and a hamlet fire.
        for (let i = 0; i < 26; i++) {
          const x = k.rnd(0, W), y = 700 + k.rnd(-30, 60), s = k.rnd(20, 45);
          k.shape([[x, y - s * 2], [x - s * 0.6, y], [x + s * 0.6, y]], '#0c120c', null);
        }
        k.ridge(820, 26, 0.012, '#090c09', C.ink, 7);
        k.wash(330, 790, 60, 30, '#d8642a', 0.5);
        k.figure(300, 830, 70, '#060806'); k.figure(350, 834, 56, '#060806');
      },
      anim: (k, t) => {
        const c = k.c;
        // Antares brightens into a new star...
        const rise = clamp01((t - 4) / 3);
        const [ax, ay] = SCORPIUS[5];
        c.save(); c.globalCompositeOperation = 'lighter';
        const r = 6 + rise * 40;
        const g = c.createRadialGradient(ax, ay, 0, ax, ay, r);
        g.addColorStop(0, `rgba(255,210,170,${0.5 + rise * 0.5})`); g.addColorStop(1, 'rgba(255,90,40,0)');
        c.fillStyle = g; c.beginPath(); c.arc(ax, ay, r, 0, Math.PI * 2); c.fill();
        c.restore();
        // ...and falls, trailing fire toward the hills.
        const fall = clamp01((t - 8) / 2.6);
        if (fall > 0) {
          const ex = ax + fall * 380, ey = ay + fall * 420;
          c.save(); c.globalCompositeOperation = 'lighter';
          const lg = c.createLinearGradient(ax, ay, ex, ey);
          lg.addColorStop(0, 'rgba(255,120,50,0)'); lg.addColorStop(1, 'rgba(255,200,150,0.9)');
          c.strokeStyle = lg; c.lineWidth = 6; c.lineCap = 'round';
          c.beginPath(); c.moveTo(ax + fall * 120, ay + fall * 132); c.lineTo(ex, ey); c.stroke();
          k.flame(ex, ey, 40, Math.atan2(-(ey - ay), -(ex - ax)), t, 1);
          c.restore();
          if (fall >= 1) {
            const flash = clamp01(1 - (t - 10.6) / 1.2);
            c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,220,180,${flash * 0.8})`; c.fillRect(0, 0, W, H); c.restore();
          }
        }
      },
      onStart: (f) => { setTimeout(() => { f.musicNode?.impact(); f.shakeAmount = 30; }, 10600); },
    });

    // 11. The wreck at dawn.
    P.push({
      lines: ['They would call it the night the Scorpion bled.', 'Those who lived buried their broken ship. Over its burning heart, they raised their first forge.'],
      minDur: 10, move: [1.08, 1.0, 0, 0, 0, 0],
      bake: (k) => {
        k.gradient([[0, '#6a6a7a'], [0.45, '#e2b27a'], [1, '#e9dcc1']], 0, H, 'multiply', 0.6);
        k.ridge(640, 60, 0.004, '#8a7a5e', C.sepia, 5);
        const hill: Pt[] = [];
        for (let x = 300; x <= 1300; x += 20) hill.push([x, 720 - Math.sin(((x - 300) / 1000) * Math.PI) * 190]);
        k.shape([...hill, [1300, H], [300, H]], '#6a7a48', C.ink, 2.4, 0.7);
        k.hatch([...hill, [1300, H], [300, H]], 0.9, 8, 1, 0.3);
        // The broken hull, nose buried in the hilltop.
        k.ship(840, 560, 420, 0.32, 0, 1);
        k.ridge(860, 30, 0.01, '#3a4a28', C.ink, 3);
      },
      anim: (k, t) => {
        k.smoke(930, 560, 420, t, '70,64,58', 0.42, -90);
        k.smoke(760, 520, 360, t + 7, '70,64,58', 0.32, -70);
        for (let i = 0; i < 6; i++) k.figure(560 + i * 70 + Math.sin(i) * 20, 800 + (i % 2) * 14, 74 + (i % 3) * 8, '#1c140e', Math.sin(t * 0.6 + i) * 2);
      },
    });

    // 12. The law of the blood.
    P.push({
      lines: ['Around that forge a house would grow, with a law older than crowns.', 'The blood must not leave the blood.'],
      minDur: 9, move: [1.0, 1.12, 0, 0, 0, 20],
      bake: (k) => {
        k.fill('#2a1a12', 0.6);
        k.wash(800, 500, 520, 300, '#9e2f1c', 0.3);
        // An Emberite crystal, large, at the centre.
        const cr: Pt[] = [[700, 700], [740, 420], [820, 340], [880, 430], [900, 700]];
        k.shape(cr, '#7a1f12', C.ink, 3);
        k.hatch(cr, 1.2, 6, 1.4, 0.4);
        k.line([[740, 420], [800, 520], [820, 340]], 2, '#e07040', 0.6);
        k.line([[800, 520], [900, 700]], 2, '#e07040', 0.4);
      },
      anim: (k, t) => {
        // A drop of blood falls onto the stone, and the stone wakes.
        const c = k.c;
        const d = clamp01((t - 2.5) / 1.6);
        const y = 120 + d * d * 230;
        if (d < 1) {
          c.fillStyle = '#8a1208';
          c.beginPath(); c.moveTo(815, y - 22); c.quadraticCurveTo(830, y, 815, y + 8); c.quadraticCurveTo(800, y, 815, y - 22); c.fill();
        }
        const wake = clamp01((t - 4.1) / 2);
        if (wake > 0) {
          c.save(); c.globalCompositeOperation = 'lighter';
          const g = c.createRadialGradient(810, 520, 10, 810, 520, 280);
          g.addColorStop(0, `rgba(255,90,50,${0.6 * wake})`); g.addColorStop(1, 'rgba(255,60,30,0)');
          c.fillStyle = g; c.beginPath(); c.arc(810, 520, 280, 0, Math.PI * 2); c.fill(); c.restore();
          k.embers(t, 30, 700, 920, 300, 700, 50, '255,120,80');
        }
      },
    });

    // 13. The ship that drifted.
    P.push({
      lines: ['One other ship had not died in the dark. Its engines failed, and it drifted, slower than a falling leaf, for centuries.'],
      minDur: 9, dark: true, move: [1.0, 1.05, 0, 0, 0, 0],
      bake: (k) => {
        k.fill(C.night, 0.95);
        k.wash(600, 300, 600, 300, '#2c3456', 0.3, 7, 'screen');
        k.stars(550, H, 0.75);
      },
      anim: (k, t) => {
        const c = k.c;
        // Tumbling, dark, lights failing.
        const lights = Math.sin(t * 7) > 0.6 ? 0.4 : 0;
        k.ship(700 + t * 8, 430 + t * 2, 300, t * 0.07 - 0.4, lights, 0.6);
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 5; i++) {
          const x = 680 + t * 8 + Math.cos(t * 0.07 - 0.4) * (i * 40 - 80), y = 430 + Math.sin(t * 0.07 - 0.4) * (i * 40 - 80);
          c.fillStyle = `rgba(255,${Math.random() < 0.5 ? 160 : 90},60,${Math.random() < 0.15 ? 0.9 : 0.15})`;
          c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill();
        }
        c.restore();
      },
    });

    // 14. Wings under a new sun.
    P.push({
      lines: ['When at last it came down, the fire-hounds it carried changed under the new sun.', 'They grew. And they took wing.'],
      minDur: 10, move: [1.12, 1.0, 40, 10, 0, 0],
      onStart: (f) => setTimeout(() => f.musicNode?.roar(3), 5500),
      bake: (k) => {
        k.gradient([[0, '#9a5a32'], [0.5, '#d9a26a'], [1, '#e9dcc1']], 0, H, 'multiply', 0.7);
        k.ridge(560, 300, 0.003, '#7a6a5a', C.sepia, 11, 1);
        k.ridge(700, 140, 0.005, '#5a4a3c', C.ink, 4, 1);
        // A crag in the foreground.
        k.shape([[900, H], [980, 640], [1080, 600], [1180, 620], [1300, 700], [1360, H]], '#2a1c13', C.ink, 3);
        k.hatch([[900, H], [980, 640], [1080, 600], [1180, 620], [1300, 700], [1360, H]], 1.1, 6, 1, 0.45);
        // Far below, the broken ship smoking in a valley.
        k.ship(420, 760, 180, -0.2, 0, 1);
      },
      anim: (k, t) => {
        k.smoke(440, 750, 260, t, '60,52,46', 0.35, -40);
        const grow = clamp01(t / 7);
        k.beast(1120, 612, 1.4 + grow * 1.0, -1, ease(grow));
        const breathe = clamp01((t - 5.5) / 0.6) * (1 - clamp01((t - 8.5) / 0.8));
        if (breathe > 0) {
          const s = 1.4 + grow;
          k.flame(1120 - 76 * s, 612 - 52 * s, 260 * breathe, Math.PI + 0.1, t, breathe);
        }
      },
    });

    // 15. Title.
    P.push({
      lines: [],
      minDur: 7, dark: true, move: [1.0, 1.04, 0, 0, 0, 0],
      onStart: (f) => setTimeout(() => f.showTitle('The Blood of Emberhold', 'Part One · What the Blood Remembers'), 600),
      bake: (k) => {
        k.fill('#1a120d', 0.9);
        k.wash(800, 470, 420, 200, '#9e2f1c', 0.35, 7, 'screen');
      },
      anim: (k, t) => k.embers(t, 50, 300, 1300, 200, 900, 40),
    });
    P.push({
      lines: [],
      minDur: 4, dark: true,
      onStart: (f) => { f.showTitle('', 'Many generations later'); },
      bake: (k) => k.fill('#0e0a08', 0.96),
    });

    this.panels = P;
  }
}

function circle(cx: number, cy: number, r: number, n = 64): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
